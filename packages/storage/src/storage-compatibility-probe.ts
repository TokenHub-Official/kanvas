import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { StoragePort, StorageWriteResult } from "@kanvas/application";

export type StorageCompatibilityProbeErrorCode =
  | "storage_probe.invalid_adapter"
  | "storage_probe.same_key_overwrite"
  | "storage_probe.identity_mismatch"
  | "storage_probe.range_mismatch"
  | "storage_probe.delete_mismatch";

export class StorageCompatibilityProbeError extends Error {
  constructor(
    readonly code: StorageCompatibilityProbeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageCompatibilityProbeError";
  }
}

export interface StorageCompatibilityProbeEvidence extends Readonly<
  Record<string, boolean>
> {
  readonly adapterInitialized: true;
  readonly serverOwnedWrite: true;
  readonly sameKeyReplayRejected: true;
  readonly immutableSealRecovery: true;
  readonly fullObjectChecksum: true;
  readonly rangeRead: true;
  readonly idempotentExactDelete: true;
}

function fail(
  code: StorageCompatibilityProbeErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StorageCompatibilityProbeError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isObjectExists(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = Reflect.get(error, "code");
  return (
    code === "local_storage.object_exists" ||
    code === "s3_storage.object_exists" ||
    code === "oss_storage.object_exists"
  );
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function runStorageCompatibilityProbe(
  adapter: StoragePort,
  container: string,
): Promise<StorageCompatibilityProbeEvidence> {
  if (
    adapter.storageProfileId.length < 1 ||
    !adapter.capabilities.uploadModes.includes("server_stream") ||
    !adapter.capabilities.writeProtectionModes.includes("server_owned") ||
    !adapter.capabilities.fullObjectChecksum ||
    !adapter.capabilities.rangeRead ||
    !adapter.capabilities.sealedIdentityImmutable
  ) {
    return fail(
      "storage_probe.invalid_adapter",
      "Storage adapter does not declare the required server-owned V0 contract.",
    );
  }
  const identity = Object.freeze({
    storageProfileId: adapter.storageProfileId,
    container,
    objectKey: `compatibility-probes/${randomUUID()}`,
  });
  const bytes = Buffer.from(`kanvas-${adapter.kind}-compatibility-v1`, "utf8");
  let written: StorageWriteResult | undefined;
  try {
    written = await adapter.writeObject({
      identity,
      maximumBytes: bytes.byteLength.toString(),
      body: Readable.from([bytes]),
    });
    let replayRejected = false;
    try {
      await adapter.writeObject({
        identity,
        maximumBytes: bytes.byteLength.toString(),
        body: Readable.from([bytes]),
      });
    } catch (error) {
      if (isObjectExists(error)) {
        replayRejected = true;
      } else {
        throw error;
      }
    }
    if (!replayRejected) {
      return fail(
        "storage_probe.same_key_overwrite",
        "Storage compatibility probe allowed same-key overwrite.",
      );
    }
    const sealed = await adapter.sealObject({
      identity,
      expectedByteSize: written.byteSize,
      expectedSha256: written.sha256,
    });
    const inspected = await adapter.inspectObject(identity);
    if (
      !inspected ||
      inspected.immutableIdentityHash !== sealed.immutableIdentityHash ||
      inspected.sha256 !== written.sha256 ||
      inspected.byteSize !== written.byteSize
    ) {
      return fail(
        "storage_probe.identity_mismatch",
        "Storage compatibility probe could not recover its sealed identity.",
      );
    }
    const rangeStart = Math.min(7, bytes.byteLength - 1);
    const rangeEnd = Math.min(rangeStart + 4, bytes.byteLength - 1);
    const range = await adapter.openRead({
      identity,
      expectedByteSize: sealed.byteSize,
      expectedSha256: sealed.sha256,
      expectedImmutableIdentityHash: sealed.immutableIdentityHash,
      range: {
        start: String(rangeStart),
        endInclusive: String(rangeEnd),
      },
    });
    const expectedRange = bytes.subarray(rangeStart, rangeEnd + 1);
    if (!(await collect(range.body)).equals(expectedRange)) {
      return fail(
        "storage_probe.range_mismatch",
        "Storage compatibility probe returned incorrect range bytes.",
      );
    }
    const deleted = await adapter.deleteObject({
      identity,
      expectedByteSize: sealed.byteSize,
      expectedSha256: sealed.sha256,
      expectedImmutableIdentityHash: sealed.immutableIdentityHash,
    });
    const missing = await adapter.deleteObject({
      identity,
      expectedByteSize: sealed.byteSize,
      expectedSha256: sealed.sha256,
      expectedImmutableIdentityHash: sealed.immutableIdentityHash,
    });
    if (
      deleted.disposition !== "deleted" ||
      missing.disposition !== "missing"
    ) {
      return fail(
        "storage_probe.delete_mismatch",
        "Storage compatibility probe did not provide idempotent exact deletion.",
      );
    }
    return Object.freeze({
      adapterInitialized: true,
      serverOwnedWrite: true,
      sameKeyReplayRejected: true,
      immutableSealRecovery: true,
      fullObjectChecksum: true,
      rangeRead: true,
      idempotentExactDelete: true,
      localOwnerControlledRoot: adapter.kind === "local",
      distributedProfile:
        adapter.capabilities.deploymentScope === "distributed",
      serverSideEncryptionConfigured:
        adapter.capabilities.serverSideEncryption !== "not_provided",
    });
  } finally {
    if (written) {
      await adapter
        .deleteObject({
          identity,
          expectedByteSize: written.byteSize,
          expectedSha256: written.sha256,
          expectedImmutableIdentityHash: written.immutableIdentityHash,
        })
        .catch(() => undefined);
    } else {
      await adapter.cleanupUnpublishedObject(identity).catch(() => undefined);
    }
  }
}
