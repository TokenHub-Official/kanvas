import type { StorageCapabilities, StoragePort } from "@kanvas/application";
import type {
  ClaimedUploadCleanup,
  StorageUploadStore,
} from "@kanvas/database";
import { describe, expect, it, vi } from "vitest";

import {
  createStorageGarbageCollectionCoordinator,
  type StorageGarbageCollectionStore,
} from "../src/garbage-collection-coordinator.js";
import { createStorageProfileRegistry } from "../src/storage-profile-registry.js";

const ids = Object.freeze({
  upload: "01K00000000000000000000101",
  workspace: "01K00000000000000000000102",
  profile: "01K00000000000000000000103",
});
const sha256 = "a".repeat(64);
const identityHash = `sha256:${"b".repeat(64)}`;

const capabilities: StorageCapabilities = Object.freeze({
  uploadModes: ["server_stream"] as const,
  writeProtectionModes: ["server_owned"] as const,
  multipart: false,
  fullObjectChecksum: true,
  rangeRead: true,
  versionBoundIdentity: false,
  sealedIdentityImmutable: true,
  deploymentScope: "single_node",
  maximumObjectBytes: String(Number.MAX_SAFE_INTEGER),
  serverSideEncryption: "not_provided",
});

function adapter(
  deleteObject: StoragePort["deleteObject"] = vi
    .fn()
    .mockResolvedValue({ disposition: "missing" }),
  cleanupUnpublishedObject: StoragePort["cleanupUnpublishedObject"] = vi
    .fn()
    .mockResolvedValue({ disposition: "missing" }),
  kind: StoragePort["kind"] = "local",
): StoragePort {
  return {
    storageProfileId: ids.profile,
    kind,
    capabilities:
      kind === "local"
        ? capabilities
        : {
            ...capabilities,
            deploymentScope: "distributed",
            serverSideEncryption: "provider_managed",
          },
    writeObject: vi.fn(),
    sealObject: vi.fn(),
    inspectObject: vi.fn(),
    openRead: vi.fn(),
    deleteObject,
    cleanupUnpublishedObject,
  };
}

function claim(
  overrides: Partial<ClaimedUploadCleanup> = {},
  includeExactFacts = true,
): ClaimedUploadCleanup {
  return {
    uploadSessionId: ids.upload,
    workspaceId: ids.workspace,
    cleanupTokenHash: "d".repeat(64),
    cleanupLeaseExpiresAt: new Date("2026-07-28T00:01:00.000Z"),
    cleanupAttempt: 1,
    storageProfileId: ids.profile,
    container: "artifacts",
    objectKey: "v1/object.bin",
    uploadMode: "server_stream",
    ...(includeExactFacts
      ? {
          sealedIdentityHash: identityHash,
          verifiedSize: "5",
          verifiedSha256: sha256,
        }
      : {}),
    ...overrides,
  };
}

function store(
  overrides: Partial<StorageGarbageCollectionStore> = {},
): StorageGarbageCollectionStore {
  return {
    claimNextCleanup: vi.fn().mockResolvedValue(claim()),
    finalizeCleanupSuccess: vi.fn().mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "aborted",
      version: 2,
      changed: true,
    }),
    finalizeCleanupFailure: vi.fn().mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "aborted",
      version: 2,
      changed: true,
    }),
    ...overrides,
  };
}

function clock(): () => Date {
  let tick = 0;
  return () =>
    new Date(Date.parse("2026-07-28T00:00:00.000Z") + tick++ * 1_000);
}

function coordinator(
  storage: StorageGarbageCollectionStore,
  port: StoragePort,
  overrides: Partial<{
    readonly baseRetryMilliseconds: number;
    readonly maximumRetryMilliseconds: number;
  }> = {},
) {
  return createStorageGarbageCollectionCoordinator({
    store: storage,
    profiles: createStorageProfileRegistry([
      {
        storageProfileId: ids.profile,
        kind: port.kind,
        adapter: port,
      },
    ]),
    now: clock(),
    claimLeaseMilliseconds: 60_000,
    baseRetryMilliseconds: overrides.baseRetryMilliseconds ?? 1_000,
    maximumRetryMilliseconds: overrides.maximumRetryMilliseconds ?? 60_000,
    cleanupTokenHashFactory: () => "d".repeat(64),
  });
}

describe("storage garbage collection coordinator", () => {
  it("converges after delete succeeds but DB finalize fails", async () => {
    const deleteObject = vi
      .fn<StoragePort["deleteObject"]>()
      .mockResolvedValueOnce({ disposition: "deleted" })
      .mockResolvedValueOnce({ disposition: "missing" });
    const port = adapter(deleteObject);
    const finalizeCleanupSuccess = vi
      .fn<StorageUploadStore["finalizeCleanupSuccess"]>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({
        uploadSessionId: ids.upload,
        state: "aborted",
        version: 3,
        changed: true,
      });
    const storage = store({ finalizeCleanupSuccess });
    const gc = coordinator(storage, port);

    await expect(gc.runNext()).rejects.toThrow("database unavailable");
    await expect(gc.runNext()).resolves.toEqual({
      status: "completed",
      uploadSessionId: ids.upload,
      disposition: "missing",
    });
    expect(deleteObject).toHaveBeenNthCalledWith(1, {
      identity: {
        storageProfileId: ids.profile,
        container: "artifacts",
        objectKey: "v1/object.bin",
      },
      expectedByteSize: "5",
      expectedSha256: sha256,
      expectedImmutableIdentityHash: identityHash,
    });
    expect(storage.finalizeCleanupFailure).not.toHaveBeenCalled();
  });

  it("cleans only staging artifacts for an unsealed claim", async () => {
    const cleanupUnpublishedObject = vi
      .fn<StoragePort["cleanupUnpublishedObject"]>()
      .mockResolvedValue({ disposition: "deleted" });
    const port = adapter(
      vi.fn().mockResolvedValue({ disposition: "missing" }),
      cleanupUnpublishedObject,
    );
    const deleteObject = vi.mocked(port.deleteObject);
    const storage = store({
      claimNextCleanup: vi.fn().mockResolvedValue(claim({}, false)),
    });

    await expect(coordinator(storage, port).runNext()).resolves.toMatchObject({
      status: "completed",
      disposition: "deleted",
    });
    expect(cleanupUnpublishedObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("uses the same exact cleanup protocol for an S3 profile", async () => {
    const deleteObject = vi
      .fn<StoragePort["deleteObject"]>()
      .mockResolvedValue({ disposition: "deleted" });
    const port = adapter(
      deleteObject,
      vi.fn().mockResolvedValue({ disposition: "missing" }),
      "s3",
    );

    await expect(coordinator(store(), port).runNext()).resolves.toMatchObject({
      status: "completed",
      disposition: "deleted",
    });
    expect(deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSha256: sha256,
        expectedImmutableIdentityHash: identityHash,
      }),
    );
  });

  it("fails closed and schedules bounded backoff when exact sealed facts are missing", async () => {
    const port = adapter();
    const deleteObject = vi.mocked(port.deleteObject);
    const finalizeCleanupFailure = vi
      .fn<StorageUploadStore["finalizeCleanupFailure"]>()
      .mockResolvedValue({
        uploadSessionId: ids.upload,
        state: "rejected",
        version: 9,
        changed: true,
      });
    const storage = store({
      claimNextCleanup: vi.fn().mockResolvedValue(
        claim(
          {
            cleanupAttempt: 40,
            sealedIdentityHash: identityHash,
          },
          false,
        ),
      ),
      finalizeCleanupFailure,
    });
    const result = await coordinator(storage, port, {
      baseRetryMilliseconds: 500,
      maximumRetryMilliseconds: 2_000,
    }).runNext();

    expect(result).toMatchObject({
      status: "retry_scheduled",
      errorCode: "storage_gc.exact_facts_missing",
    });
    expect(finalizeCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "storage_gc.exact_facts_missing",
        retryAt: new Date("2026-07-28T00:00:03.000Z"),
      }),
    );
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("never falls back when a claimed profile is unavailable or incompatible", async () => {
    const finalizeCleanupFailure = vi
      .fn<StorageUploadStore["finalizeCleanupFailure"]>()
      .mockResolvedValue({
        uploadSessionId: ids.upload,
        state: "aborted",
        version: 4,
        changed: true,
      });
    const storage = store({
      claimNextCleanup: vi
        .fn()
        .mockResolvedValue(claim({ storageVersionId: "remote-version" })),
      finalizeCleanupFailure,
    });
    const port = adapter();
    const deleteObject = vi.mocked(port.deleteObject);

    await expect(coordinator(storage, port).runNext()).resolves.toMatchObject({
      status: "retry_scheduled",
      errorCode: "storage_gc.profile_mismatch",
    });
    expect(deleteObject).not.toHaveBeenCalled();

    const missingProfileStorage = store();
    const missing = createStorageGarbageCollectionCoordinator({
      store: missingProfileStorage,
      profiles: createStorageProfileRegistry([]),
      now: clock(),
      claimLeaseMilliseconds: 60_000,
      baseRetryMilliseconds: 1_000,
      maximumRetryMilliseconds: 60_000,
      cleanupTokenHashFactory: () => "d".repeat(64),
    });
    await expect(missing.runNext()).resolves.toMatchObject({
      status: "retry_scheduled",
      errorCode: "storage_gc.profile_unavailable",
    });
  });
});
