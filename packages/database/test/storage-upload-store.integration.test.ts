import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import {
  createStorageUploadStore,
  type StorageUploadStore,
} from "../src/runtime/storage-upload-store.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (character: string): string => character.repeat(64);

const ids = Object.freeze({
  workspace: identity(11_200_001),
  actor: identity(11_200_002),
  profile: identity(11_200_003),
  probe: identity(11_200_004),
  verifiedUpload: identity(11_200_005),
  expiredUpload: identity(11_200_006),
  cleanupUpload: identity(11_200_007),
  storedObject: identity(11_200_008),
  artifact: identity(11_200_009),
  concurrentUpload: identity(11_200_010),
  workspaceMembership: identity(11_200_011),
});

let userImportAuthority: TrustedWorkspaceScope;

function createIntegrationPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    const database = process.env.KANVAS_DATABASE_NAME?.trim();
    if (!database) {
      throw new Error(
        "KANVAS_DATABASE_NAME is required with KANVAS_DATABASE_SOCKET.",
      );
    }
    return createPool({
      socketPath,
      database,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 3,
      timezone: "Z",
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  const connection = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    connectionLimit: 3,
    timezone: "Z",
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

async function removeFixtures(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    if (await resetDisposableIntegrationDatabase(connection)) {
      return;
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of [
      "artifact",
      "stored_object",
      "upload_session",
      "storage_compatibility_probe",
      "workspace_membership",
    ]) {
      await connection.query(`DELETE FROM ${table} WHERE workspace_id = ?`, [
        ids.workspace,
      ]);
    }
    await connection.query("DELETE FROM workspace WHERE id = ?", [
      ids.workspace,
    ]);
    await connection.query("DELETE FROM organization WHERE id = ?", [
      ids.workspace,
    ]);
    await connection.query(
      "DELETE FROM human_principal WHERE principal_id = ?",
      [ids.actor],
    );
    await connection.query("DELETE FROM principal WHERE id = ?", [ids.actor]);
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    connection.release();
  }
}

describe.skipIf(!integrationEnabled)(
  "StorageUploadStore against MySQL 8.0",
  () => {
    let pool!: Pool;
    let store!: StorageUploadStore;

    beforeAll(async () => {
      pool = createIntegrationPool();
      store = createStorageUploadStore(pool);
      await removeFixtures(pool);
      const at = new Date("2026-07-27T22:00:00.000Z");
      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'storage-upload-runtime', 'Storage Upload Runtime',
           'active', 1, ?, ?)`,
        [ids.workspace, at, at],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES (?, ?, 'storage-upload-runtime',
           'Storage Upload Runtime', 'active', 1, ?, ?)`,
        [ids.workspace, ids.workspace, at, at],
      );
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [ids.actor, at, at],
      );
      await pool.execute(
        `INSERT INTO human_principal
           (principal_id, auth_subject_id, created_at)
         VALUES (?, 'storage-upload-subject', ?)`,
        [ids.actor, at],
      );
      await pool.execute(
        `INSERT INTO workspace_membership (
           id, organization_id, workspace_id, principal_id, role,
           status, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          ids.workspaceMembership,
          ids.workspace,
          ids.workspace,
          ids.actor,
          at,
          at,
        ],
      );
      userImportAuthority = Object.freeze({
        workspaceId: ids.workspace,
        organizationId: ids.workspace,
        principalId: ids.actor,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: "storage-upload-session",
        authorityType: "human_membership",
        authorityId: ids.workspaceMembership,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: permissionsForWorkspaceRole("owner"),
        trusted: true,
      });
    });

    afterAll(async () => {
      if (pool) {
        await removeFixtures(pool);
        await pool.end();
      }
    });

    it("preserves old probes while admitting a new release in the same month", async () => {
      const now = new Date("2026-09-20T00:00:00Z");
      const base = {
        workspaceId: ids.workspace,
        storageProfileId: ids.profile,
        profileConfigurationHash: digest("a"),
        adapterKey: "local.v1",
        capabilityContractVersion: 1,
        capabilities: {
          supportsConditionalCreate: false,
          supportsServerOwnedWrite: true,
          supportsMultipart: false,
          supportsRangeRead: true,
          supportsVersionBoundIdentity: false,
          supportsFullObjectChecksum: false,
          sealedIdentityImmutable: true,
        },
        status: "passed" as const,
        evidence: { rangeRead: true },
        testedAt: now,
        validUntil: new Date("2026-10-01T00:00:00Z"),
        createdAt: now,
      };
      const old = {
        ...base,
        id: identity(11_200_090),
        probeKey: "local.v1:profile:2026-09",
        adapterVersion: "old",
        requestHash: digest("b"),
        resultHash: digest("c"),
      };
      await store.recordCompatibilityProbe(old);
      const next = {
        ...old,
        id: identity(11_200_091),
        adapterVersion: "new",
        requestHash: digest("d"),
        resultHash: digest("e"),
      };
      await expect(store.recordCompatibilityProbe(next)).rejects.toMatchObject({
        code: "storage_upload.idempotency_conflict",
      });
      const upgraded = {
        ...next,
        probeKey: `storage-probe:v2:${next.requestHash}`,
      };
      await expect(
        store.recordCompatibilityProbe(upgraded),
      ).resolves.toMatchObject({ status: "passed", replayed: false });
      await expect(
        store.recordCompatibilityProbe({
          ...upgraded,
          id: identity(11_200_092),
        }),
      ).resolves.toMatchObject({ id: upgraded.id, replayed: true });
      await expect(store.recordCompatibilityProbe(old)).resolves.toMatchObject({
        id: old.id,
        replayed: true,
      });
      const [preserved] = await pool.execute<RowDataPacket[]>(
        "SELECT adapter_version AS adapterVersion, request_hash AS requestHash FROM storage_compatibility_probe WHERE id = ?",
        [old.id],
      );
      expect(preserved[0]).toEqual({
        adapterVersion: "old",
        requestHash: old.requestHash,
      });
    });

    it("runs certified allocate, seal, inspect, verify, commit, and authorized read", async () => {
      const now = new Date("2026-07-27T22:00:00.000Z");
      const expiresAt = new Date("2026-07-27T22:30:00.000Z");
      const cleanupAt = new Date("2026-07-27T23:00:00.000Z");
      const profileConfigurationHash = digest("2");

      await expect(
        store.recordCompatibilityProbe({
          id: ids.probe,
          workspaceId: ids.workspace,
          probeKey: "local.profile.v1",
          requestHash: digest("1"),
          storageProfileId: ids.profile,
          profileConfigurationHash,
          adapterKey: "local.v1",
          adapterVersion: "1.0.0",
          capabilityContractVersion: 1,
          capabilities: {
            supportsConditionalCreate: false,
            supportsServerOwnedWrite: true,
            supportsMultipart: false,
            supportsRangeRead: true,
            supportsVersionBoundIdentity: false,
            supportsFullObjectChecksum: false,
            sealedIdentityImmutable: true,
          },
          status: "passed",
          resultHash: digest("3"),
          evidence: {
            exclusiveRename: true,
            rangeRead: true,
          },
          testedAt: now,
          validUntil: new Date("2026-07-28T22:00:00.000Z"),
          createdAt: now,
        }),
      ).resolves.toMatchObject({
        status: "passed",
        replayed: false,
      });

      const allocation = {
        id: ids.verifiedUpload,
        workspaceId: ids.workspace,
        actorId: ids.actor,
        authority: userImportAuthority,
        allocationRequestKey: "user-import.primary.v1",
        allocationRequestHash: digest("4"),
        purpose: "user_import" as const,
        expectedSize: "18446744073709551615",
        expectedMediaType: "image/png",
        expectedSha256: hash("a"),
        storageProfileId: ids.profile,
        compatibilityProbeId: ids.probe,
        profileConfigurationHash,
        container: "kanvas-test",
        objectKey: `v1/w/${ids.workspace}/u/${ids.verifiedUpload}/o/main`,
        uploadMode: "server_stream" as const,
        writeProtectionMode: "server_owned" as const,
        verificationProfileVersion: "image-v1",
        now,
        expiresAt,
        cleanupEligibleAt: cleanupAt,
      };
      await expect(
        store.allocateUploadSession(allocation),
      ).resolves.toMatchObject({
        state: "open",
        expectedSize: "18446744073709551615",
        replayed: false,
      });
      await expect(
        store.allocateUploadSession(allocation),
      ).resolves.toMatchObject({
        state: "open",
        replayed: true,
      });
      await expect(
        store.allocateUploadSession({
          ...allocation,
          id: identity(11_299_999),
          allocationRequestHash: digest("9"),
        }),
      ).rejects.toMatchObject({
        code: "storage_upload.idempotency_conflict",
      });

      await expect(
        store.beginUpload({
          workspaceId: ids.workspace,
          uploadSessionId: ids.verifiedUpload,
          now: new Date("2026-07-27T22:01:00.000Z"),
        }),
      ).resolves.toMatchObject({
        state: "open",
        changed: true,
      });
      await expect(
        store.beginSeal({
          workspaceId: ids.workspace,
          uploadSessionId: ids.verifiedUpload,
          sealManifestHash: digest("5"),
          now: new Date("2026-07-27T22:02:00.000Z"),
        }),
      ).resolves.toMatchObject({
        state: "sealing",
        changed: true,
      });
      await expect(
        store.recordSeal({
          workspaceId: ids.workspace,
          uploadSessionId: ids.verifiedUpload,
          sealManifestHash: digest("5"),
          sealedIdentityHash: digest("6"),
          providerEtag: '"local-etag"',
          now: new Date("2026-07-27T22:03:00.000Z"),
        }),
      ).resolves.toMatchObject({
        state: "verifying",
        changed: true,
      });
      const verificationToken = hash("b");
      const verification = await store.claimVerification({
        workspaceId: ids.workspace,
        uploadSessionId: ids.verifiedUpload,
        processingLeaseTokenHash: verificationToken,
        now: new Date("2026-07-27T22:04:00.000Z"),
        leaseExpiresAt: new Date("2026-07-27T22:10:00.000Z"),
      });
      expect(verification).toMatchObject({
        processingLeaseGeneration: 1,
        sealedIdentityHash: digest("6"),
        expectedSize: "18446744073709551615",
      });
      await expect(
        store.recordVerified({
          workspaceId: ids.workspace,
          uploadSessionId: ids.verifiedUpload,
          processingLeaseGeneration: verification.processingLeaseGeneration,
          processingLeaseTokenHash: verificationToken,
          verifiedSize: "18446744073709551615",
          verifiedSha256: hash("a"),
          detectedMediaType: "image/png",
          verificationResultHash: digest("7"),
          now: new Date("2026-07-27T22:05:00.000Z"),
        }),
      ).resolves.toMatchObject({
        state: "verified",
        changed: true,
      });

      const committedAt = new Date("2026-07-27T22:06:00.000Z");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `INSERT INTO stored_object (
             id, workspace_id, created_from_upload_session_id,
             storage_profile_id, container, object_key, storage_version_id,
             provider_etag, immutable_identity_hash, byte_size, sha256,
             media_type, delete_state, created_at, deleted_at
           ) VALUES (?, ?, ?, ?, 'kanvas-test', ?, NULL, ?, ?,
                     ?, ?, 'image/png', 'active', ?, NULL)`,
          [
            ids.storedObject,
            ids.workspace,
            ids.verifiedUpload,
            ids.profile,
            allocation.objectKey,
            '"local-etag"',
            digest("6"),
            "18446744073709551615",
            hash("a"),
            committedAt,
          ],
        );
        await connection.execute(
          `UPDATE upload_session
           SET state = 'committed',
               committed_stored_object_id = ?,
               committed_at = ?,
               updated_at = ?,
               version = version + 1
           WHERE id = ?`,
          [ids.storedObject, committedAt, committedAt, ids.verifiedUpload],
        );
        await connection.execute(
          `INSERT INTO artifact (
             id, workspace_id, stored_object_id, content_digest,
             artifact_type,
             availability_status, data_classification, display_filename,
             metadata, created_at
           ) VALUES (?, ?, ?, ?, 'image', 'available', 'restricted',
                     'design.png', '{}', ?)`,
          [
            ids.artifact,
            ids.workspace,
            ids.storedObject,
            digest("a"),
            committedAt,
          ],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await expect(
        store.readAuthorizedCommittedObject({
          workspaceId: ids.workspace,
          artifactId: ids.artifact,
          allowedDataClassifications: ["restricted"],
        }),
      ).resolves.toMatchObject({
        artifactId: ids.artifact,
        byteSize: "18446744073709551615",
        immutableIdentityHash: digest("6"),
        dataClassification: "restricted",
      });
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

    it("rejects exact expiry and performs retryable GC with DB-only CAS facts", async () => {
      const now = new Date("2026-07-27T23:10:00.000Z");
      const expiresAt = new Date("2026-07-27T23:12:00.000Z");
      const cleanupAt = new Date("2026-07-27T23:13:00.000Z");
      const common = {
        workspaceId: ids.workspace,
        actorId: ids.actor,
        authority: userImportAuthority,
        purpose: "user_import" as const,
        storageProfileId: ids.profile,
        compatibilityProbeId: ids.probe,
        profileConfigurationHash: digest("2"),
        container: "kanvas-test",
        uploadMode: "server_stream" as const,
        writeProtectionMode: "server_owned" as const,
        verificationProfileVersion: "image-v1",
        now,
        expiresAt,
        cleanupEligibleAt: cleanupAt,
      };
      await store.allocateUploadSession({
        ...common,
        id: ids.expiredUpload,
        allocationRequestKey: "expiry-boundary.v1",
        allocationRequestHash: digest("8"),
        objectKey: `v1/w/${ids.workspace}/u/${ids.expiredUpload}/o/main`,
      });
      await expect(
        store.beginUpload({
          workspaceId: ids.workspace,
          uploadSessionId: ids.expiredUpload,
          now: expiresAt,
        }),
      ).rejects.toMatchObject({
        code: "storage_upload.expired",
      });

      await store.allocateUploadSession({
        ...common,
        id: ids.cleanupUpload,
        allocationRequestKey: "cleanup-retry.v1",
        allocationRequestHash: digest("9"),
        objectKey: `v1/w/${ids.workspace}/u/${ids.cleanupUpload}/o/main`,
      });
      const tokenOne = hash("c");
      const firstClaim = await store.claimNextCleanup({
        cleanupTokenHash: tokenOne,
        now: cleanupAt,
        leaseExpiresAt: new Date("2026-07-27T23:14:00.000Z"),
      });
      expect(firstClaim).toMatchObject({
        uploadSessionId: ids.expiredUpload,
        cleanupAttempt: 1,
      });
      await store.finalizeCleanupSuccess({
        workspaceId: ids.workspace,
        uploadSessionId: ids.expiredUpload,
        cleanupTokenHash: tokenOne,
        result: "missing",
        now: new Date("2026-07-27T23:13:30.000Z"),
      });

      const tokenTwo = hash("d");
      const secondClaim = await store.claimNextCleanup({
        cleanupTokenHash: tokenTwo,
        now: cleanupAt,
        leaseExpiresAt: new Date("2026-07-27T23:14:00.000Z"),
      });
      expect(secondClaim).toMatchObject({
        uploadSessionId: ids.cleanupUpload,
        cleanupAttempt: 1,
      });
      const retryAt = new Date("2026-07-27T23:14:30.000Z");
      await store.finalizeCleanupFailure({
        workspaceId: ids.workspace,
        uploadSessionId: ids.cleanupUpload,
        cleanupTokenHash: tokenTwo,
        errorCode: "storage.delete_transient",
        now: new Date("2026-07-27T23:13:30.000Z"),
        retryAt,
      });
      const tokenThree = hash("e");
      const retryClaim = await store.claimNextCleanup({
        cleanupTokenHash: tokenThree,
        now: retryAt,
        leaseExpiresAt: new Date("2026-07-27T23:16:00.000Z"),
      });
      expect(retryClaim).toMatchObject({
        uploadSessionId: ids.cleanupUpload,
        cleanupAttempt: 2,
      });
      await store.finalizeCleanupSuccess({
        workspaceId: ids.workspace,
        uploadSessionId: ids.cleanupUpload,
        cleanupTokenHash: tokenThree,
        result: "deleted",
        now: new Date("2026-07-27T23:15:00.000Z"),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT state, cleanup_state AS cleanupState,
                cleanup_attempts AS cleanupAttempts,
                cleanup_result AS cleanupResult
         FROM upload_session
         WHERE id = ?`,
        [ids.cleanupUpload],
      );
      expect(rows[0]).toMatchObject({
        state: "aborted",
        cleanupState: "done",
        cleanupAttempts: 2,
        cleanupResult: "deleted",
      });
    });

    it("serializes concurrent allocation replay to one UploadSession fact", async () => {
      const now = new Date("2026-07-27T23:20:00.000Z");
      const options = {
        id: ids.concurrentUpload,
        workspaceId: ids.workspace,
        actorId: ids.actor,
        authority: userImportAuthority,
        allocationRequestKey: "concurrent-allocation.v1",
        allocationRequestHash: digest("b"),
        purpose: "user_import" as const,
        storageProfileId: ids.profile,
        compatibilityProbeId: ids.probe,
        profileConfigurationHash: digest("2"),
        container: "kanvas-test",
        objectKey: `v1/w/${ids.workspace}/u/${ids.concurrentUpload}/o/main`,
        uploadMode: "server_stream" as const,
        writeProtectionMode: "server_owned" as const,
        verificationProfileVersion: "image-v1",
        now,
        expiresAt: new Date("2026-07-27T23:50:00.000Z"),
        cleanupEligibleAt: new Date("2026-07-28T00:20:00.000Z"),
      };
      const results = await Promise.all([
        store.allocateUploadSession(options),
        store.allocateUploadSession(options),
      ]);
      expect(results.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
         FROM upload_session
         WHERE workspace_id = ?
           AND allocation_request_key = ?`,
        [ids.workspace, options.allocationRequestKey],
      );
      expect(Number(rows[0]?.count ?? 0)).toBe(1);
    });
  },
);
