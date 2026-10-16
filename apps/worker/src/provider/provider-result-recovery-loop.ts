import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import type {
  ProviderResultRecoveryStore,
  ClaimedProviderResultRecovery,
  StorageUploadStore,
  ContentTransferStore,
} from "@kanvas/database/runtime";
import {
  digestProviderValue,
  StorageUploadStoreError,
} from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import { ProviderAdapterCallError } from "./provider-adapter.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";

const pollMilliseconds = 1000;
const heartbeatMilliseconds = 15_000;
const recoveryMilliseconds = 600_000;
const mediaTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export class ProviderResultRecoveryLoop {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private controller: AbortController | undefined;
  constructor(
    private readonly options: {
      readonly store: ProviderResultRecoveryStore;
      readonly uploads: StorageUploadStore;
      readonly content: ContentTransferStore;
      readonly storage: TrustedImageStorageRuntime;
      readonly transport: ProviderHttpTransport;
      readonly onError: () => void;
    },
  ) {}
  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMilliseconds);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.pending;
  }
  async tick(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.processNext()
      .catch(() => this.options.onError())
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async processNext(): Promise<void> {
    const claim = await this.options.store.claim(
      randomBytes(32).toString("hex"),
      new Date(),
    );
    if (!claim) return;
    const controller = new AbortController();
    this.controller = controller;
    const deadline = new Date(Date.now() + recoveryMilliseconds);
    const timeout = setTimeout(() => controller.abort(), recoveryMilliseconds);
    const heartbeat = setInterval(() => {
      void this.options.store
        .renew(claim.id, claim.leaseToken, new Date())
        .then((held) => {
          if (!held) controller.abort();
        })
        .catch(() => controller.abort());
    }, heartbeatMilliseconds);
    try {
      await this.recover(claim, deadline, controller.signal);
    } catch (error) {
      let code = "result_recovery.failed";
      if (error instanceof ProviderAdapterCallError)
        code = error.stableErrorCode;
      else if (error instanceof StorageUploadStoreError) code = error.code;
      else if (controller.signal.aborted) code = "result_recovery.interrupted";
      await this.options.store.fail(
        claim.id,
        claim.leaseToken,
        code,
        new Date(),
      );
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      this.controller = undefined;
    }
  }
  private async recover(
    claim: ClaimedProviderResultRecovery,
    deadline: Date,
    signal: AbortSignal,
  ): Promise<void> {
    const url = new URL(claim.url);
    // No Provider generation or status-query API is used by this path.
    const response = await this.options.transport.request({
      baseUrl: url.origin,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {},
      responseMode: "binary",
      targetKind: "provider_result",
      resultPolicyContext: {
        invocationId: claim.invocationId,
        workspaceId: claim.workspaceId,
        providerEndpointId: claim.providerEndpointId,
      },
      onResultPolicyResolved: (policy) =>
        this.options.store.recordPolicy(
          claim.id,
          claim.leaseToken,
          policy?.version ?? null,
        ),
      deadlineAt: deadline,
      signal,
    });
    if (response.statusCode === 404 || response.statusCode === 410)
      throw new ProviderAdapterCallError(
        "result_recovery.expired",
        "not_started",
      );
    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      !Buffer.isBuffer(response.body)
    )
      throw new ProviderAdapterCallError(
        "result_recovery.download_failed",
        "not_started",
      );
    const mediaType = response.headers["content-type"]
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!mediaType || !mediaTypes.has(mediaType))
      throw new ProviderAdapterCallError(
        "provider.output_media_type_invalid",
        "not_started",
      );
    signal.throwIfAborted();
    const storage = this.options.storage;
    const now = new Date();
    const probe = await storage.ensureCompatibilityProbe(
      claim.workspaceId,
      ulid(),
      now,
    );
    const session = await this.options.uploads.allocateUploadSession({
      id: claim.uploadSessionId,
      workspaceId: claim.workspaceId,
      actorId: claim.authority.principalId,
      authority: claim.authority,
      allocationRequestKey: `result-recovery:${claim.id}`,
      allocationRequestHash: digestProviderValue({
        recoveryId: claim.id,
        artifactId: claim.artifactId,
      }),
      purpose: "user_import",
      expectedMediaType: mediaType,
      storageProfileId: storage.profileId,
      compatibilityProbeId: probe.id,
      profileConfigurationHash: storage.profileConfigurationHash,
      container: storage.container,
      objectKey: `v1/w/${claim.workspaceId}/recovery/${claim.id}/${claim.storedObjectId}`,
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      verificationProfileVersion: storage.verificationProfileVersion,
      now,
      expiresAt: deadline,
      cleanupEligibleAt: new Date(
        deadline.getTime() + storage.cleanupGraceMilliseconds,
      ),
    });
    const bytes = response.body;
    await storage.uploads.ingest({
      session,
      body: (async function* () {
        signal.throwIfAborted();
        yield await Promise.resolve(bytes);
      })(),
    });
    signal.throwIfAborted();
    await this.options.content.commitRecoveredProviderResult({
      recoveryId: claim.id,
      leaseToken: claim.leaseToken,
      authority: claim.authority,
      uploadSessionId: claim.uploadSessionId,
      storedObjectId: claim.storedObjectId,
      artifactId: claim.artifactId,
      outboxEventId: ulid(),
      artifactType: "image",
      dataClassification: "internal",
      metadata: {
        recoveredFromCapabilityRunId: claim.capabilityRunId,
        recoveryId: claim.id,
      },
      audit: {
        auditEventId: ulid(),
        authenticationRefHash: `sha256:${createHash("sha256").update(claim.authority.authenticationRefId).digest("hex")}`,
      },
      now: new Date(),
    });
  }
}
