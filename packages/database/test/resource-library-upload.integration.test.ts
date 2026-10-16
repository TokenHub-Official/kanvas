import { resolve } from "node:path";

import {
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { DatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  createContentTransferStore,
  type ContentTransferStore,
} from "../src/runtime/content-transfer-store.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
import {
  createStorageUploadStore,
  type StorageUploadStore,
} from "../src/runtime/storage-upload-store.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (character: string): string => character.repeat(64);
const instanceId = "content-transfer-integration";
const seededAt = new Date("2026-07-28T15:00:00.000Z");

const ids = Object.freeze({
  principal: id(12_000_001),
  organization: id(12_000_002),
  workspace: id(12_000_003),
  organizationMembership: id(12_000_004),
  workspaceMembership: id(12_000_005),
  profile: id(12_000_006),
  probe: id(12_000_007),
  upload: id(12_000_008),
  storedObjectOne: id(12_000_009),
  storedObjectTwo: id(12_000_010),
  artifactOne: id(12_000_011),
  artifactTwo: id(12_000_012),
  outboxOne: id(12_000_013),
  outboxTwo: id(12_000_014),
  auditOne: id(12_000_015),
  auditTwo: id(12_000_016),
  decision: id(12_000_017),
  downloadAudit: id(12_000_018),
  assetOne: id(12_000_019),
  assetTwo: id(12_000_020),
});

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function disposableDatabaseName(): string {
  const name = `kanvas_library_upload_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function createAdminPool(): {
  readonly pool: Pool;
  readonly networkConfig?: DatabaseConnectionConfig;
} {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return {
      pool: createPool({
        socketPath,
        user: process.env.KANVAS_DATABASE_USER ?? "root",
        password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
        connectionLimit: 2,
        multipleStatements: true,
        timezone: "Z",
        decimalNumbers: false,
      }),
    };
  }
  const networkConfig = loadDatabaseConnectionConfig(process.env);
  return {
    networkConfig,
    pool: createPool({
      host: networkConfig.host,
      port: networkConfig.port,
      user: networkConfig.user,
      password: networkConfig.password,
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
      decimalNumbers: false,
    }),
  };
}

function createDomainPool(
  databaseName: string,
  networkConfig?: DatabaseConnectionConfig,
): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      database: databaseName,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 8,
      timezone: "Z",
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  if (!networkConfig) {
    throw new Error(
      "Network database configuration is required without a socket.",
    );
  }
  return createPool({
    host: networkConfig.host,
    port: networkConfig.port,
    database: databaseName,
    user: networkConfig.user,
    password: networkConfig.password,
    connectionLimit: 8,
    timezone: "Z",
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

describe.skipIf(!integrationEnabled)(
  "Library upload ownership on disposable MySQL",
  () => {
    const databaseName = disposableDatabaseName();
    let adminPool!: Pool;
    let pool!: Pool;
    let storage!: StorageUploadStore;
    let transfers!: ContentTransferStore;
    let authority!: TrustedWorkspaceScope;

    beforeAll(async () => {
      const admin = createAdminPool();
      adminPool = admin.pool;
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const migrationConnection = await adminPool.getConnection();
      try {
        await migrationConnection.query(`USE \`${databaseName}\``);
        const inventory = await readMigrationInventory(
          resolve(import.meta.dirname, "../migrations"),
        );
        for (const migration of inventory) {
          await migrationConnection.query(migration.sql);
        }
      } finally {
        migrationConnection.release();
      }
      pool = createDomainPool(databaseName, admin.networkConfig);
      storage = createStorageUploadStore(pool);
      transfers = createContentTransferStore(pool, {
        instanceId,
      });

      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (?, 'ACTIVE', 1, 1, 'content transfer integration',
                   NULL, 'integration-test', ?)`,
        [instanceId, seededAt],
      );
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [ids.principal, seededAt, seededAt],
      );
      await pool.execute(
        `INSERT INTO human_principal
           (principal_id, auth_subject_id, created_at)
         VALUES (?, 'content-transfer-subject', ?)`,
        [ids.principal, seededAt],
      );
      await pool.execute(
        `INSERT INTO organization
           (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'content-transfer', 'Content Transfer', 'active', 1, ?, ?)`,
        [ids.organization, seededAt, seededAt],
      );
      await pool.execute(
        `INSERT INTO workspace
           (id, organization_id, slug, name, status, version,
            created_at, updated_at)
         VALUES (?, ?, 'content-transfer', 'Content Transfer',
                 'active', 1, ?, ?)`,
        [ids.workspace, ids.organization, seededAt, seededAt],
      );
      await pool.execute(
        `INSERT INTO organization_membership (
           id, organization_id, principal_id, role, status, version,
           created_at, updated_at
         ) VALUES (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          ids.organizationMembership,
          ids.organization,
          ids.principal,
          seededAt,
          seededAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workspace_membership (
           id, organization_id, workspace_id, principal_id, role,
           status, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          ids.workspaceMembership,
          ids.organization,
          ids.workspace,
          ids.principal,
          seededAt,
          seededAt,
        ],
      );
      authority = Object.freeze({
        workspaceId: ids.workspace,
        organizationId: ids.organization,
        principalId: ids.principal,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: "content-transfer-session",
        authorityType: "human_membership",
        authorityId: ids.workspaceMembership,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: permissionsForWorkspaceRole("owner"),
        trusted: true,
      });

      await storage.recordCompatibilityProbe({
        id: ids.probe,
        workspaceId: ids.workspace,
        probeKey: "local.content-transfer.v1",
        requestHash: digest("1"),
        storageProfileId: ids.profile,
        profileConfigurationHash: digest("2"),
        adapterKey: "local-filesystem.v1",
        adapterVersion: "0.0.0-test",
        capabilityContractVersion: 1,
        capabilities: {
          supportsConditionalCreate: false,
          supportsServerOwnedWrite: true,
          supportsMultipart: false,
          supportsRangeRead: true,
          supportsVersionBoundIdentity: false,
          supportsFullObjectChecksum: true,
          sealedIdentityImmutable: true,
        },
        status: "passed",
        resultHash: digest("3"),
        evidence: {
          serverOwned: true,
        },
        testedAt: seededAt,
        validUntil: new Date("2026-08-28T15:00:00.000Z"),
        createdAt: seededAt,
      });
      await storage.allocateUploadSession({
        id: ids.upload,
        workspaceId: ids.workspace,
        actorId: ids.principal,
        authority,
        allocationRequestKey: "content-transfer-primary",
        allocationRequestHash: digest("4"),
        purpose: "user_import",
        expectedSize: "68",
        expectedMediaType: "image/png",
        expectedSha256: hash("a"),
        storageProfileId: ids.profile,
        compatibilityProbeId: ids.probe,
        profileConfigurationHash: digest("2"),
        container: "objects",
        objectKey: `workspaces/${ids.workspace}/user-imports/${ids.upload}`,
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: "trusted-image-structural-v1",
        now: seededAt,
        expiresAt: new Date("2026-07-28T16:00:00.000Z"),
        cleanupEligibleAt: new Date("2026-07-28T17:00:00.000Z"),
      });
      await storage.beginUpload({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        now: new Date("2026-07-28T15:01:00.000Z"),
      });
      await storage.beginSeal({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        sealManifestHash: digest("5"),
        now: new Date("2026-07-28T15:02:00.000Z"),
      });
      await storage.recordSeal({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        sealManifestHash: digest("5"),
        sealedIdentityHash: digest("6"),
        now: new Date("2026-07-28T15:03:00.000Z"),
      });
      const verificationToken = hash("b");
      const claim = await storage.claimVerification({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        processingLeaseTokenHash: verificationToken,
        now: new Date("2026-07-28T15:04:00.000Z"),
        leaseExpiresAt: new Date("2026-07-28T15:10:00.000Z"),
      });
      await storage.recordVerified({
        workspaceId: ids.workspace,
        uploadSessionId: ids.upload,
        processingLeaseGeneration: claim.processingLeaseGeneration,
        processingLeaseTokenHash: verificationToken,
        verifiedSize: "68",
        verifiedSha256: hash("a"),
        detectedMediaType: "image/png",
        verificationResultHash: digest("7"),
        now: new Date("2026-07-28T15:05:00.000Z"),
      });
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await adminPool.end();
      }
    }, 30_000);

    it("commits shared ownership atomically, preserves references, and prevents import relabeling", async () => {
      const now = new Date("2026-07-28T15:06:00.000Z");
      const libraries = createResourceLibraryStore(pool);
      const libraryId = id(13000001);
      await libraries.save({
        authority,
        libraryId,
        revisionId: id(13000002),
        expectedVersion: 0,
        requestKey: "create-library",
        document: {
          schemaVersion: 1,
          name: "Product A",
          description: "Specs",
          entries: [],
        },
        audit: {
          auditEventId: id(13000003),
          authenticationRefHash: digest("8"),
        },
        now,
      });
      const commit = {
        authority,
        libraryId,
        uploadSessionId: ids.upload,
        artifactType: "image.png",
        dataClassification: "internal" as const,
        displayFilename: "product.png",
        metadata: { importedFrom: "resource-library", libraryId },
        storedObjectId: ids.storedObjectOne,
        artifactId: ids.artifactOne,
        outboxEventId: ids.outboxOne,
        audit: {
          auditEventId: ids.auditOne,
          authenticationRefHash: digest("8"),
        },
        now,
      };
      const result = await transfers.commitUserImport(commit);
      expect(result.status).toBe("committed");
      expect(result.assetId).toBeUndefined();
      expect(
        (
          await transfers.commitUserImport({
            ...commit,
            artifactId: ids.artifactTwo,
            audit: { ...commit.audit, auditEventId: ids.auditTwo },
          })
        ).status,
      ).toBe("replayed");
      const { libraryId: ignoredLibrary, ...genericCommit } = commit;
      expect(ignoredLibrary).toBe(libraryId);
      await expect(
        transfers.commitUserImport(genericCommit),
      ).rejects.toMatchObject({
        code: "content_transfer.idempotency_conflict",
      });
      const [ownership] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM resource_library_upload",
      );
      const [assets] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM asset",
      );
      expect(Number(ownership[0]?.count)).toBe(1);
      expect(Number(assets[0]?.count)).toBe(0);
      const revision = await libraries.save({
        authority,
        libraryId,
        revisionId: id(13000004),
        expectedVersion: 1,
        requestKey: "attach",
        document: {
          schemaVersion: 1,
          name: "Product A",
          description: "Specs",
          entries: [
            {
              id: id(13000005),
              artifactId: result.artifactId,
              name: "Product photo",
              purpose: "Shape",
            },
          ],
        },
        audit: {
          auditEventId: id(13000006),
          authenticationRefHash: digest("8"),
        },
        now,
      });
      await libraries.save({
        authority,
        libraryId,
        revisionId: id(13000007),
        expectedVersion: 2,
        requestKey: "remove",
        document: {
          schemaVersion: 1,
          name: "Product A",
          description: "Specs",
          entries: [],
        },
        audit: {
          auditEventId: id(13000008),
          authenticationRefHash: digest("8"),
        },
        now,
      });
      expect(
        (
          await libraries.getRevision({
            authority,
            libraryId,
            revisionId: revision.revision.id,
            now,
          })
        ).document.entries[0]?.artifactId,
      ).toBe(result.artifactId);
      const download = {
        authority,
        artifactId: result.artifactId,
        purpose: "library-preview",
        decisionId: ids.decision,
        audit: {
          auditEventId: ids.downloadAudit,
          authenticationRefHash: digest("8"),
        },
        now,
        validUntil: new Date(now.getTime() + 30000),
      };
      const allowed = await transfers.authorizeArtifactDownload(download);
      expect(allowed.decision).toBe("allow");
      await pool.execute(
        "UPDATE workspace_membership SET status = 'revoked', version = version + 1 WHERE id = ?",
        [authority.authorityId],
      );
      const restricted = authority;
      await expect(
        transfers.authorizeArtifactDownload({
          ...download,
          authority: restricted,
          decisionId: id(13000009),
          audit: { ...download.audit, auditEventId: id(13000010) },
        }),
      ).rejects.toMatchObject({ code: "content_transfer.state_conflict" });
    });
  },
);
