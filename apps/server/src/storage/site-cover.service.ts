import { Readable } from "node:stream";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  StorageObjectInspection,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type { AllocateSiteCover } from "@kanvas/contracts/api";
import type { StoredSiteToolImage } from "@kanvas/database";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME, SERVER_STORAGE_RUNTIME } from "../tokens.js";
import type { ServerStorageRuntime } from "./server-storage-runtime.js";
import { normalizeToolImage } from "../tools/tool-image.js";
const maximumBytes = 2 * 1024 * 1024;
const cleanupInterval = 60_000;
@Injectable()
export class SiteCoverService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined,
  ) {}
  onModuleInit() {
    if (this.storage) {
      this.timer = setInterval(() => {
        void this.cleanup();
      }, cleanupInterval);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private runtime() {
    if (!this.storage)
      throw new ServiceUnavailableException("File storage is not configured.");
    return this.storage;
  }
  allocate(
    scope: TrustedInstanceAdministratorScope,
    key: string,
    body: AllocateSiteCover,
  ) {
    const runtime = this.runtime();
    return this.database.siteCovers
      .allocate(scope, key, {
        ...body,
        identity: {
          storageProfileId: runtime.profileId,
          container: runtime.container,
          objectKey: `sites/${encodeURIComponent(scope.instanceId)}/covers/${ulid()}.png`,
        },
      })
      .then((session) => ({
        uploadSessionId: session.record.id,
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
      }));
  }
  async upload(
    scope: TrustedInstanceAdministratorScope,
    id: string,
    body: unknown,
  ) {
    const session = await this.database.siteCovers.get(scope, id);
    if (session.state === "verified" || session.state === "committed")
      return { state: session.state };
    if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body))
      throw new BadRequestException(
        "Cover upload requires binary image content.",
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > maximumBytes)
        throw new PayloadTooLargeException("Image exceeds the upload limit.");
      chunks.push(chunk);
    }
    if (size !== session.record.expectedSize)
      throw new BadRequestException(
        "Uploaded size does not match the selected file.",
      );
    const normalized = await normalizeToolImage(Buffer.concat(chunks));
    const { session: claimed, token } = await this.database.siteCovers.claim(
      scope,
      id,
    );
    if (!token) return { state: claimed.state };
    try {
      const adapter = this.runtime().profiles.resolve(
        claimed.record.identity.storageProfileId,
      )?.adapter;
      if (!adapter)
        throw new ServiceUnavailableException(
          "Cover storage profile is unavailable.",
        );
      let stored = await adapter.inspectObject(claimed.record.identity);
      if (!stored)
        stored = await adapter.writeObject({
          identity: claimed.record.identity,
          maximumBytes: String(normalized.bytes.length),
          body: Readable.from([normalized.bytes]),
        });
      if (
        stored.sha256 !== normalized.sha256 ||
        Number(stored.byteSize) !== normalized.bytes.length
      )
        throw new ConflictException(
          "Upload session already contains a different image.",
        );
      const sealed = await adapter.sealObject({
        identity: stored.identity,
        expectedByteSize: stored.byteSize,
        expectedSha256: stored.sha256,
      });
      await this.database.siteCovers.verified(
        scope,
        id,
        token,
        sealed,
        normalized.width,
        normalized.height,
      );
      return { state: "verified" };
    } catch (error) {
      // A token guard prevents an old request from releasing another writer's lease.
      await this.database.siteCovers
        .release(scope, id, token)
        .catch(() => undefined);
      throw error;
    }
  }
  commit(scope: TrustedInstanceAdministratorScope, id: string) {
    return this.database.siteCovers.commit(scope, id);
  }
  list(scope: TrustedInstanceAdministratorScope) {
    return this.database.siteCovers.list(scope).then((items) => ({ items }));
  }
  async materialize(image: StoredSiteToolImage): Promise<StoredSiteToolImage> {
    if (!image.storageObject) return image;
    const object = image.storageObject;
    const adapter = this.runtime().profiles.resolve(
      object.identity.storageProfileId,
    )?.adapter;
    if (!adapter)
      throw new ServiceUnavailableException(
        "Cover storage profile is unavailable.",
      );
    const handle = await adapter.openRead({
      identity: object.identity,
      expectedByteSize: object.byteSize,
      expectedSha256: object.sha256,
      expectedImmutableIdentityHash: object.immutableIdentityHash,
    });
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of handle.body) {
      length += chunk.byteLength;
      if (length > 524288)
        throw new BadRequestException(
          "Stored image exceeds its verified size.",
        );
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (
      String(bytes.length) !== object.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== object.sha256
    )
      throw new BadRequestException("Stored cover integrity check failed.");
    return { ...image, bytes };
  }
  private async cleanup() {
    if (this.cleaning || !this.storage) return;
    this.cleaning = true;
    try {
      const job = await this.database.siteCovers.claimCleanup();
      if (!job) return;
      const adapter = this.storage.profiles.resolve(
        job.record.identity.storageProfileId,
      )?.adapter;
      if (!adapter) return;
      const object: StorageObjectInspection | undefined =
        job.record.inspection ??
        (await adapter.inspectObject(job.record.identity));
      if (object)
        await adapter.deleteObject({
          identity: object.identity,
          expectedByteSize: object.byteSize,
          expectedSha256: object.sha256,
          expectedImmutableIdentityHash: object.immutableIdentityHash,
        });
      else await adapter.cleanupUnpublishedObject(job.record.identity);
      await this.database.siteCovers.finishCleanup(job.id, job.token);
    } catch {
      /* Durable cleanup lease expires; a later sweep retries safely. */
    } finally {
      this.cleaning = false;
    }
  }
}
