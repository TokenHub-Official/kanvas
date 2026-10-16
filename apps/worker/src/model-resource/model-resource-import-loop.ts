import { createHash, randomBytes } from "node:crypto";

import type {
  ApplicationRuntime,
  RuntimeStateReader,
  StorageProfileRegistry,
} from "@kanvas/application";
import type {
  ModelResourceImportClaim,
  ModelResourceImportStore,
} from "@kanvas/database/runtime";
import type { ServerStreamUploadCoordinator } from "@kanvas/storage";
import type { Logger } from "pino";

import {
  analyzeModelResource,
  detectModelResourceFormat,
} from "./model-resource-analyzer.js";
import { inspectOnnxNativeInterface } from "./model-resource-onnx-inspector.js";
import {
  downloadModelResource,
  SecureModelDownloadError,
  type SecureModelDownloadOptions,
} from "./secure-model-download.js";

export interface ModelResourceImportLoopOptions {
  readonly runtime: ApplicationRuntime;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly store: Pick<
    ModelResourceImportStore,
    | "claimNext"
    | "commitDownloaded"
    | "reportDownloadProgress"
    | "completeCancellation"
    | "completeAnalysis"
    | "fail"
    | "listPublishedRuntimeAdapters"
  >;
  readonly profiles: StorageProfileRegistry;
  readonly uploads: ServerStreamUploadCoordinator;
  readonly maximumBytes: number;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly downloadTimeoutMs: number;
  readonly proxyUrl?: string;
  readonly logger: Pick<Logger, "error" | "info">;
  readonly nextId: () => string;
  readonly continueCatalogInstallations?: () => Promise<boolean>;
  readonly now?: () => Date;
  readonly download?: (
    options: SecureModelDownloadOptions,
  ) => Promise<Awaited<ReturnType<typeof downloadModelResource>>>;
  readonly inspectOnnx?: typeof inspectOnnxNativeInterface;
}

function assertDuration(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} is outside its supported range.`);
  }
}

function leaseTokenHash(): string {
  return createHash("sha256")
    .update("kanvas:model-resource-import-lease:v1\0")
    .update(randomBytes(32))
    .digest("hex");
}

const downloadProgressIntervalBytes = 1_048_576n;

class ModelResourceDownloadCancelled extends Error {
  public constructor() {
    super("Model resource download was cancelled.");
    this.name = "ModelResourceDownloadCancelled";
  }
}

function causedByDownloadCancellation(error: unknown): boolean {
  let current = error;
  const visited = new Set<unknown>();
  while (
    current instanceof Error &&
    !visited.has(current) &&
    visited.size < 8
  ) {
    if (current instanceof ModelResourceDownloadCancelled) return true;
    visited.add(current);
    current = current.cause;
  }
  return false;
}

async function* reportDownloadProgress(
  body: AsyncIterable<Uint8Array>,
  options: {
    readonly claim: ModelResourceImportClaim;
    readonly store: Pick<ModelResourceImportStore, "reportDownloadProgress">;
    readonly now: () => Date;
  },
): AsyncGenerator<Uint8Array> {
  let downloaded = 0n;
  let lastReported = 0n;
  for await (const chunk of body) {
    downloaded += BigInt(chunk.byteLength);
    if (downloaded - lastReported >= downloadProgressIntervalBytes) {
      const decision = await options.store.reportDownloadProgress({
        importId: options.claim.record.id,
        workspaceId: options.claim.record.workspaceId,
        processingLeaseGeneration: options.claim.processingLeaseGeneration,
        processingLeaseTokenHash: options.claim.processingLeaseTokenHash,
        downloadedBytes: String(downloaded),
        now: options.now(),
      });
      if (decision === "cancel_requested") {
        throw new ModelResourceDownloadCancelled();
      }
      lastReported = downloaded;
    }
    yield chunk;
  }
  if (downloaded !== lastReported) {
    const decision = await options.store.reportDownloadProgress({
      importId: options.claim.record.id,
      workspaceId: options.claim.record.workspaceId,
      processingLeaseGeneration: options.claim.processingLeaseGeneration,
      processingLeaseTokenHash: options.claim.processingLeaseTokenHash,
      downloadedBytes: String(downloaded),
      now: options.now(),
    });
    if (decision === "cancel_requested") {
      throw new ModelResourceDownloadCancelled();
    }
  }
}

async function readHeader(
  claim: ModelResourceImportClaim,
  profiles: StorageProfileRegistry,
): Promise<Uint8Array> {
  const file = claim.record.files[0];
  if (!file) {
    throw new Error("Model resource import has no committed file.");
  }
  const profile = profiles.resolve(file.storageProfileId);
  if (!profile) {
    throw new Error("Model resource storage profile is unavailable.");
  }
  const bytesToRead = Number(
    BigInt(file.byteSize) < 65_536n ? BigInt(file.byteSize) : 65_536n,
  );
  const opened = await profile.adapter.openRead({
    identity: {
      storageProfileId: file.storageProfileId,
      container: file.container,
      objectKey: file.objectKey,
      ...(file.storageVersionId
        ? { storageVersionId: file.storageVersionId }
        : {}),
    },
    expectedByteSize: file.byteSize,
    expectedSha256: file.sha256,
    expectedImmutableIdentityHash: file.immutableIdentityHash,
    range: { start: "0", endInclusive: String(bytesToRead - 1) },
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of opened.body) {
    total += chunk.byteLength;
    if (total > bytesToRead) {
      throw new Error("Model resource header read exceeded its bounded range.");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

async function readModelBytes(
  claim: ModelResourceImportClaim,
  profiles: StorageProfileRegistry,
  maximumBytes: number,
): Promise<Uint8Array> {
  const file = claim.record.files[0];
  if (!file) throw new Error("Model resource import has no committed file.");
  const byteSize = Number(file.byteSize);
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > maximumBytes
  ) {
    throw new Error("Model resource is outside the analysis byte limit.");
  }
  const profile = profiles.resolve(file.storageProfileId);
  if (!profile)
    throw new Error("Model resource storage profile is unavailable.");
  const opened = await profile.adapter.openRead({
    identity: {
      storageProfileId: file.storageProfileId,
      container: file.container,
      objectKey: file.objectKey,
      ...(file.storageVersionId
        ? { storageVersionId: file.storageVersionId }
        : {}),
    },
    expectedByteSize: file.byteSize,
    expectedSha256: file.sha256,
    expectedImmutableIdentityHash: file.immutableIdentityHash,
  });
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for await (const chunk of opened.body) {
    if (offset + chunk.byteLength > byteSize) {
      throw new Error(
        "Model resource analysis read exceeded its declared size.",
      );
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== byteSize) {
    throw new Error("Model resource analysis read is incomplete.");
  }
  return bytes;
}

function failureFrom(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
} {
  if (error instanceof SecureModelDownloadError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      recoverable:
        error.code === "model_import.dns_failed" ||
        error.code === "model_import.http_failed" ||
        error.code === "model_import.deadline_exceeded" ||
        error.code === "model_import.http_status",
    });
  }
  return Object.freeze({
    code: "model_import.analysis_failed",
    message: "Model resource analysis could not be completed.",
    recoverable: false,
  });
}

export class ModelResourceImportLoop {
  readonly #options: ModelResourceImportLoopOptions;
  readonly #now: () => Date;
  readonly #download: NonNullable<ModelResourceImportLoopOptions["download"]>;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: ModelResourceImportLoopOptions) {
    assertDuration(
      options.pollIntervalMs,
      "Model import poll interval",
      100,
      60_000,
    );
    assertDuration(
      options.leaseDurationMs,
      "Model import lease",
      60_000,
      3_600_000,
    );
    assertDuration(
      options.downloadTimeoutMs,
      "Model import download timeout",
      10_000,
      3_600_000,
    );
    if (
      !Number.isSafeInteger(options.maximumBytes) ||
      options.maximumBytes < 1_048_576
    ) {
      throw new RangeError("Model import byte limit is invalid.");
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#download = options.download ?? downloadModelResource;
  }

  public start(): void {
    if (this.#timer || this.#running) return;
    this.#stopping = false;
    this.#schedule(0);
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#running;
  }

  public async runOnce(): Promise<boolean> {
    const snapshot = await this.#options.runtimeStateReader.read();
    await this.#options.runtime.runtimeFence.assertAllowed({
      action: "claim",
      expectedGeneration: snapshot.executionGeneration,
    });
    if (await this.#options.continueCatalogInstallations?.()) return true;
    const claimedAt = this.#now();
    const tokenHash = leaseTokenHash();
    const claim = await this.#options.store.claimNext({
      processingLeaseTokenHash: tokenHash,
      now: claimedAt,
      leaseExpiresAt: new Date(
        claimedAt.getTime() + this.#options.leaseDurationMs,
      ),
    });
    if (!claim) return false;
    try {
      if (claim.record.status === "fetching") {
        if (claim.record.source.kind !== "https") {
          throw new Error("URL model import has invalid source provenance.");
        }
        const initialDecision =
          await this.#options.store.reportDownloadProgress({
            importId: claim.record.id,
            workspaceId: claim.record.workspaceId,
            processingLeaseGeneration: claim.processingLeaseGeneration,
            processingLeaseTokenHash: claim.processingLeaseTokenHash,
            downloadedBytes: "0",
            now: this.#now(),
          });
        if (initialDecision === "cancel_requested") {
          throw new ModelResourceDownloadCancelled();
        }
        const downloaded = await this.#download({
          url: claim.record.source.url,
          maximumBytes: this.#options.maximumBytes,
          deadlineAt: new Date(
            claimedAt.getTime() + this.#options.downloadTimeoutMs,
          ),
          ...(this.#options.proxyUrl
            ? { proxyUrl: this.#options.proxyUrl }
            : {}),
        });
        await this.#options.uploads.ingest({
          session: claim.uploadSession,
          body: reportDownloadProgress(downloaded.body, {
            claim,
            store: this.#options.store,
            now: this.#now,
          }),
        });
        await this.#options.store.commitDownloaded({
          importId: claim.record.id,
          workspaceId: claim.record.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          storedObjectId: this.#options.nextId(),
          path: downloaded.path,
          sourceMetadata: downloaded.sourceMetadata,
          now: this.#now(),
        });
        return true;
      }

      const file = claim.record.files[0];
      if (!file) throw new Error("Model resource import file is missing.");
      const [header, adapters] = await Promise.all([
        readHeader(claim, this.#options.profiles),
        this.#options.store.listPublishedRuntimeAdapters(
          claim.record.workspaceId,
        ),
      ]);
      const detectedFormat = detectModelResourceFormat(file.path, header);
      const detectedNativeInterface =
        detectedFormat === "onnx"
          ? await (this.#options.inspectOnnx ?? inspectOnnxNativeInterface)(
              await readModelBytes(
                claim,
                this.#options.profiles,
                this.#options.maximumBytes,
              ),
            )
          : undefined;
      const analysis = analyzeModelResource({
        originalSource: claim.record.source,
        file,
        header,
        adapters,
        ...(detectedNativeInterface ? { detectedNativeInterface } : {}),
        ...(claim.record.catalogDocument
          ? { catalogDocument: claim.record.catalogDocument }
          : {}),
      });
      await this.#options.store.completeAnalysis({
        importId: claim.record.id,
        workspaceId: claim.record.workspaceId,
        processingLeaseGeneration: claim.processingLeaseGeneration,
        processingLeaseTokenHash: claim.processingLeaseTokenHash,
        now: this.#now(),
        ...analysis,
      });
      this.#options.logger.info(
        {
          modelResourceImportId: claim.record.id,
          detectedFormat: analysis.format ?? "unknown",
          requiredUserInputCount: analysis.requiredUserInputs.length,
        },
        "Model resource import analysis completed.",
      );
      return true;
    } catch (error) {
      if (causedByDownloadCancellation(error)) {
        await this.#options.store.completeCancellation({
          importId: claim.record.id,
          workspaceId: claim.record.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          now: this.#now(),
        });
        this.#options.logger.info(
          { modelResourceImportId: claim.record.id },
          "Model resource download cancelled.",
        );
        return true;
      }
      const failure = failureFrom(error);
      try {
        await this.#options.store.fail({
          importId: claim.record.id,
          workspaceId: claim.record.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          failure,
          now: this.#now(),
        });
      } catch (recordError) {
        this.#options.logger.error(
          {
            modelResourceImportId: claim.record.id,
            errorType:
              recordError instanceof Error ? recordError.name : "unknown",
          },
          "Model import failure could not be recorded.",
        );
      }
      this.#options.logger.error(
        {
          modelResourceImportId: claim.record.id,
          errorCode: failure.code,
          errorType: error instanceof Error ? error.name : "unknown",
        },
        "Model resource import failed.",
      );
      return true;
    }
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#options.logger.error(
            {
              errorCode: "model_import.iteration_failed",
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Model resource import iteration failed.",
          );
        })
        .finally(() => {
          this.#running = undefined;
          if (!this.#stopping) this.#schedule(this.#options.pollIntervalMs);
        });
    }, delay);
  }
}
