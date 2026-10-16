import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createStorageUploadStore,
  type AllocateUploadSessionOptions,
} from "../src/runtime/storage-upload-store.js";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (character: string): string => character.repeat(64);

const ids = Object.freeze({
  workspace: identity(11_100_001),
  actor: identity(11_100_002),
  attempt: identity(11_100_003),
  profile: identity(11_100_004),
  probe: identity(11_100_005),
  upload: identity(11_100_006),
  artifact: identity(11_100_007),
  stored: identity(11_100_008),
});

const now = new Date("2026-07-27T22:00:00.000Z");
const expiresAt = new Date("2026-07-27T22:30:00.000Z");
const cleanupAt = new Date("2026-07-27T23:00:00.000Z");

function result(affectedRows = 1): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function probeRow() {
  return {
    id: ids.probe,
    workspaceId: ids.workspace,
    probeKey: "profile.probe.v1",
    requestHash: digest("1"),
    storageProfileId: ids.profile,
    profileConfigurationHash: digest("2"),
    adapterKey: "local.v1",
    adapterVersion: "1.0.0",
    capabilityContractVersion: 1,
    supportsConditionalCreate: 0,
    supportsServerOwnedWrite: 1,
    supportsMultipart: 0,
    supportsRangeRead: 1,
    supportsVersionBoundIdentity: 0,
    supportsFullObjectChecksum: 0,
    sealedIdentityImmutable: 1,
    probeStatus: "passed",
    failureCode: null,
    resultHash: digest("3"),
    validUntil: new Date("2026-07-28T22:00:00.000Z"),
  };
}

function uploadRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: ids.upload,
    workspaceId: ids.workspace,
    actorId: ids.actor,
    allocationRequestKey: "upload.allocate.v1",
    allocationRequestHash: digest("4"),
    attemptId: ids.attempt,
    purpose: "attempt_output",
    outputRole: "primary",
    outputIndex: 0,
    expectedSize: "18446744073709551615",
    expectedMediaType: "image/png",
    expectedSha256: hash("a"),
    storageProfileId: ids.profile,
    compatibilityProbeId: ids.probe,
    profileConfigurationHash: digest("2"),
    container: "kanvas-test",
    objectKey: `v1/w/${ids.workspace}/u/${ids.upload}/o/one`,
    uploadMode: "server_stream",
    writeProtectionMode: "server_owned",
    providerUploadId: null,
    uploadStartedAt: null,
    sealManifestHash: null,
    sealStartedAt: null,
    sealedIdentityHash: null,
    storageVersionId: null,
    providerEtag: null,
    sealedAt: null,
    state: "open",
    stateReasonCode: null,
    version: 1,
    expiresAt,
    cleanupEligibleAt: cleanupAt,
    cleanupState: "none",
    processingLeaseGeneration: 0,
    processingLeaseTokenHash: null,
    processingClaimedAt: null,
    processingLeaseExpiresAt: null,
    verifiedSize: null,
    verifiedSha256: null,
    detectedMediaType: null,
    verificationResultHash: null,
    verificationCompletedAt: null,
    verifiedAt: null,
    verificationProfileVersion: "image-v1",
    committedStoredObjectId: null,
    cleanupTokenHash: null,
    cleanupClaimedAt: null,
    cleanupLeaseExpiresAt: null,
    cleanupAttempts: 0,
    cleanupRetryAt: null,
    cleanupErrorCode: null,
    cleanupResult: null,
    cleanedAt: null,
    createdAt: now,
    updatedAt: now,
    committedAt: null,
    ...overrides,
  };
}

const allocation: AllocateUploadSessionOptions = {
  id: ids.upload,
  workspaceId: ids.workspace,
  actorId: ids.actor,
  allocationRequestKey: "upload.allocate.v1",
  allocationRequestHash: digest("4"),
  purpose: "attempt_output",
  attemptId: ids.attempt,
  outputRole: "primary",
  outputIndex: 0,
  expectedSize: "18446744073709551615",
  expectedMediaType: "image/png",
  expectedSha256: hash("a"),
  storageProfileId: ids.profile,
  compatibilityProbeId: ids.probe,
  profileConfigurationHash: digest("2"),
  container: "kanvas-test",
  objectKey: `v1/w/${ids.workspace}/u/${ids.upload}/o/one`,
  uploadMode: "server_stream",
  writeProtectionMode: "server_owned",
  verificationProfileVersion: "image-v1",
  now,
  expiresAt,
  cleanupEligibleAt: cleanupAt,
};

function transactionalPool(execute: ReturnType<typeof vi.fn>): {
  readonly pool: Pool;
  readonly begin: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
} {
  const begin = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const connection = {
    execute,
    beginTransaction: begin,
    commit,
    rollback,
    release,
  } as unknown as PoolConnection;
  return {
    pool: {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool,
    begin,
    commit,
    rollback,
    release,
  };
}

describe("StorageUploadStore", () => {
  it("allocates against a passing mode-specific probe and preserves uint64 strings", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[probeRow()]])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([[uploadRow()]]);
    const transaction = transactionalPool(execute);
    const store = createStorageUploadStore(transaction.pool);

    await expect(
      store.allocateUploadSession(allocation),
    ).resolves.toMatchObject({
      id: ids.upload,
      state: "open",
      expectedSize: "18446744073709551615",
      replayed: false,
    });
    expect(String(execute.mock.calls[0]?.[0])).toContain("FOR SHARE");
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      "allocation_request_key",
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it("rejects an allocation-key replay with a different immutable request", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[probeRow()]])
      .mockResolvedValueOnce([result(0)])
      .mockResolvedValueOnce([
        [uploadRow({ allocationRequestHash: digest("9") })],
      ]);
    const transaction = transactionalPool(execute);
    const store = createStorageUploadStore(transaction.pool);

    await expect(store.allocateUploadSession(allocation)).rejects.toMatchObject(
      {
        code: "storage_upload.idempotency_conflict",
      },
    );
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it("returns the originally allocated identity when an idempotent retry generates fresh output ids", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[probeRow()]])
      .mockResolvedValueOnce([
        {
          ...result(0),
          insertId: 1,
        },
      ])
      .mockResolvedValueOnce([[uploadRow()]]);
    const transaction = transactionalPool(execute);
    const store = createStorageUploadStore(transaction.pool);

    await expect(
      store.allocateUploadSession({
        ...allocation,
        id: identity(11_199_999),
        objectKey: `v1/w/${ids.workspace}/u/${identity(11_199_999)}/o/retry`,
      }),
    ).resolves.toMatchObject({
      id: ids.upload,
      objectKey: uploadRow().objectKey,
      replayed: true,
    });
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it("uses a half-open UploadSession deadline at the exact boundary", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      [
        uploadRow({
          state: "open",
          uploadStartedAt: now,
        }),
      ],
    ]);
    const transaction = transactionalPool(execute);
    const store = createStorageUploadStore(transaction.pool);

    await expect(
      store.beginUpload({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        now: expiresAt,
      }),
    ).rejects.toMatchObject({
      code: "storage_upload.expired",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it("reads an Attempt output session only through its complete binding", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[uploadRow()]]);
    const store = createStorageUploadStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.readAttemptOutputUploadSession({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        attemptId: ids.attempt,
        outputRole: "primary",
        outputIndex: 0,
      }),
    ).resolves.toMatchObject({
      id: ids.upload,
      workspaceId: ids.workspace,
      attemptId: ids.attempt,
      outputRole: "primary",
      outputIndex: 0,
      replayed: true,
    });
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "purpose = 'attempt_output'",
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([
      ids.workspace,
      ids.upload,
      ids.attempt,
      "primary",
      0,
    ]);
  });

  it("claims one cleanup row without joining or performing object I/O", async () => {
    const cleanupLease = new Date("2026-07-27T23:05:00.000Z");
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          uploadRow({
            state: "verifying",
            uploadStartedAt: now,
            sealManifestHash: digest("5"),
            sealStartedAt: now,
            sealedIdentityHash: digest("6"),
            sealedAt: now,
            cleanupEligibleAt: cleanupAt,
            uploadMode: "server_stream",
          }),
        ],
      ])
      .mockResolvedValueOnce([result()]);
    const transaction = transactionalPool(execute);
    const store = createStorageUploadStore(transaction.pool);

    await expect(
      store.claimNextCleanup({
        cleanupTokenHash: hash("b"),
        now: cleanupAt,
        leaseExpiresAt: cleanupLease,
      }),
    ).resolves.toMatchObject({
      uploadSessionId: ids.upload,
      cleanupAttempt: 1,
      objectKey: uploadRow().objectKey,
      sealedIdentityHash: digest("6"),
      expectedSize: "18446744073709551615",
      expectedSha256: hash("a"),
    });
    const claimSql = String(execute.mock.calls[0]?.[0]);
    expect(claimSql).toContain("FROM upload_session");
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claimSql).not.toMatch(/\bJOIN\b/u);
  });

  it("fails closed when an artifact classification is not allowed", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      [
        {
          artifactId: ids.artifact,
          artifactWorkspaceId: ids.workspace,
          artifactType: "image",
          availabilityStatus: "available",
          dataClassification: "restricted",
          displayFilename: "design.png",
          storedObjectId: ids.stored,
          storedWorkspaceId: ids.workspace,
          storageProfileId: ids.profile,
          container: "kanvas-test",
          objectKey: uploadRow().objectKey,
          storageVersionId: null,
          providerEtag: null,
          immutableIdentityHash: digest("6"),
          byteSize: "18446744073709551615",
          sha256: hash("a"),
          mediaType: "image/png",
          deleteState: "active",
          uploadSessionId: ids.upload,
          uploadWorkspaceId: ids.workspace,
          uploadState: "committed",
          uploadCleanupState: "none",
          committedStoredObjectId: ids.stored,
          allocationRequestKey: "upload.allocate.v1",
          uploadStorageProfileId: ids.profile,
          uploadContainer: "kanvas-test",
          uploadObjectKey: uploadRow().objectKey,
          uploadStorageVersionId: null,
          uploadProviderEtag: null,
          uploadSealedIdentityHash: digest("6"),
        },
      ],
    ]);
    const store = createStorageUploadStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.readAuthorizedCommittedObject({
        workspaceId: ids.workspace,
        artifactId: ids.artifact,
        allowedDataClassifications: ["internal"],
      }),
    ).rejects.toMatchObject({
      code: "storage_upload.access_denied",
    });
  });
});
