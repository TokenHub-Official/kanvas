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
import { createContentDomainStore } from "../src/runtime/content-domain-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { createWorkspaceContentQueryStore } from "../src/runtime/workspace-content-query-store.js";
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

interface OutboxRow extends RowDataPacket {
  readonly id: string;
}

function disposableDatabaseName(): string {
  const name = `kanvas_content_transfer_${String(process.pid)}_${String(Date.now())}`;
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
  "ContentTransferStore against disposable MySQL 8.0",
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

    it("serializes commit, persists one immutable content fact set, and consumes its durable event", async () => {
      const now = new Date("2026-07-28T15:06:00.000Z");
      const common = {
        authority,
        uploadSessionId: ids.upload,
        artifactType: "image",
        dataClassification: "restricted" as const,
        displayFilename: "product.png",
        metadata: Object.freeze({
          source: "user_import",
          revision: 1,
        }),
        now,
      };
      const results = await Promise.all([
        transfers.commitUserImport({
          ...common,
          storedObjectId: ids.storedObjectOne,
          artifactId: ids.artifactOne,
          asset: {
            assetId: ids.assetOne,
            name: "产品原图",
            assetType: "image.source",
          },
          outboxEventId: ids.outboxOne,
          audit: {
            auditEventId: ids.auditOne,
            authenticationRefHash: digest("8"),
            requestId: "content-transfer-request-one",
          },
        }),
        transfers.commitUserImport({
          ...common,
          storedObjectId: ids.storedObjectTwo,
          artifactId: ids.artifactTwo,
          asset: {
            assetId: ids.assetTwo,
            name: "产品原图",
            assetType: "image.source",
          },
          outboxEventId: ids.outboxTwo,
          audit: {
            auditEventId: ids.auditTwo,
            authenticationRefHash: digest("8"),
            requestId: "content-transfer-request-two",
          },
        }),
      ]);
      expect(results.map(({ status }) => status).sort()).toEqual([
        "committed",
        "replayed",
      ]);
      expect(new Set(results.map(({ artifactId }) => artifactId)).size).toBe(1);
      expect(
        new Set(results.map(({ storedObjectId }) => storedObjectId)).size,
      ).toBe(1);
      expect(new Set(results.map(({ assetId }) => assetId)).size).toBe(1);

      for (const table of [
        "stored_object",
        "artifact",
        "asset",
        "outbox_event",
        "audit_event",
      ]) {
        const [rows] = await pool.query<CountRow[]>(
          `SELECT COUNT(*) AS count FROM \`${table}\``,
        );
        expect(Number(rows[0]?.count ?? 0), table).toBe(1);
      }
      await expect(
        transfers.commitUserImport({
          ...common,
          storedObjectId: id(12_000_021),
          artifactId: id(12_000_022),
          outboxEventId: id(12_000_023),
          artifactType: "different-image",
          audit: {
            auditEventId: id(12_000_024),
            authenticationRefHash: digest("8"),
          },
        }),
      ).rejects.toMatchObject({
        code: "content_transfer.idempotency_conflict",
      });

      const [outboxRows] = await pool.query<OutboxRow[]>(
        "SELECT id FROM outbox_event LIMIT 1",
      );
      const outboxId = outboxRows[0]?.id;
      if (!outboxId) {
        throw new Error("Artifact import Outbox event is missing.");
      }
      const committed = results[0];
      const delivery = {
        consumerName: "content-event.v1",
        eventId: outboxId,
        workspaceId: ids.workspace,
        messageType: "artifact.user_imported",
        schemaVersion: 1,
        aggregateType: "artifact",
        aggregateId: committed.artifactId,
        aggregateVersion: 1,
        expectedGeneration: 1,
        receivedAt: new Date("2026-07-28T15:07:00.000Z"),
      } as const;
      await expect(
        transfers.consumeArtifactContentEvent(delivery),
      ).resolves.toMatchObject({
        deliveryStatus: "processed",
        outcome: "noop",
        resultCode: "artifact.import_recorded",
      });
      await expect(
        transfers.consumeArtifactContentEvent({
          ...delivery,
          receivedAt: new Date("2026-07-28T15:08:00.000Z"),
        }),
      ).resolves.toMatchObject({
        deliveryStatus: "duplicate",
        resultCode: "artifact.import_recorded",
      });
    });

    it("keeps a conversation Artifact private through download and Asset adoption until its owner promotes it", async () => {
      const artifactId = id(12_000_030);
      const teammateId = id(12_000_031);
      const teammateMembershipId = id(12_000_032);
      const content = { reference: "private-agent-attachment" };
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [teammateId, seededAt, seededAt],
      );
      await pool.execute(
        `INSERT INTO human_principal
           (principal_id, auth_subject_id, created_at)
         VALUES (?, 'content-transfer-teammate', ?)`,
        [teammateId, seededAt],
      );
      await pool.execute(
        `INSERT INTO workspace_membership
           (id, organization_id, workspace_id, principal_id, role,
            status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'editor', 'active', 1, ?, ?)`,
        [
          teammateMembershipId,
          ids.organization,
          ids.workspace,
          teammateId,
          seededAt,
          seededAt,
        ],
      );
      const teammate: TrustedWorkspaceScope = {
        ...authority,
        principalId: teammateId,
        authorityId: teammateMembershipId,
        authenticationRefId: "content-transfer-teammate-session",
        effectivePermissions: permissionsForWorkspaceRole("editor"),
      };
      const contentStore = createContentDomainStore(pool);
      await contentStore.createStructuredArtifact({
        authority,
        artifactId,
        artifactType: "image.source",
        structuredContent: content,
        contentDigest: digestProviderValue(content),
        metadata: { importedFrom: "agent-composer" },
        target: { kind: "workspace" },
        now: new Date("2026-07-28T15:08:00.000Z"),
      });
      const contentQueries = createWorkspaceContentQueryStore(pool);
      await expect(
        contentQueries.getAgentAttachmentArtifact(
          authority,
          artifactId,
          id(12_000_039),
        ),
      ).resolves.toMatchObject({ id: artifactId });
      await expect(
        contentQueries.getAgentAttachmentArtifact(
          authority,
          ids.artifactOne,
          id(12_000_039),
        ),
      ).rejects.toMatchObject({ code: "workspace_content.not_found" });
      const downloadAt = new Date("2026-07-28T15:08:10.000Z");
      const request = {
        artifactId,
        purpose: "artifact-preview",
        audit: { authenticationRefHash: digest("9") },
        now: downloadAt,
        validUntil: new Date(downloadAt.getTime() + 30_000),
      } as const;
      await expect(
        transfers.authorizeArtifactDownload({
          ...request,
          authority: teammate,
          decisionId: id(12_000_033),
          audit: { ...request.audit, auditEventId: id(12_000_034) },
        }),
      ).resolves.toEqual({
        decision: "deny",
        disclosure: "forbidden",
        reasonCode: "artifact_private_to_principal",
      });
      await expect(
        contentStore.createAsset({
          authority: teammate,
          assetId: id(12_000_035),
          assetKey: "unauthorized-private-conversation-image",
          name: "Private conversation image",
          assetType: "image",
          initialArtifact: { kind: "adopt", artifactId },
          now: downloadAt,
        }),
      ).rejects.toMatchObject({ code: "content_domain.forbidden" });
      const [noLeakedAsset] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM asset WHERE id = ?",
        [id(12_000_035)],
      );
      expect(Number(noLeakedAsset[0]?.count ?? 0)).toBe(0);

      await expect(
        contentStore.createAsset({
          authority,
          assetId: id(12_000_036),
          assetKey: "saved-private-conversation-image",
          name: "Chosen conversation image",
          assetType: "image",
          initialArtifact: { kind: "adopt", artifactId },
          now: downloadAt,
        }),
      ).resolves.toMatchObject({ status: "created", artifactId });
      await expect(
        transfers.authorizeArtifactDownload({
          ...request,
          authority: teammate,
          decisionId: id(12_000_037),
          audit: { ...request.audit, auditEventId: id(12_000_038) },
        }),
      ).resolves.toMatchObject({ decision: "allow", artifactId });
    });

    it("authorizes a bounded proxy download and denies revalidation after authority revocation", async () => {
      const [artifactRows] = await pool.query<
        Array<RowDataPacket & { readonly id: string }>
      >("SELECT id FROM artifact WHERE id = ? LIMIT 1", [ids.artifactOne]);
      const artifactId = artifactRows[0]?.id;
      if (!artifactId) {
        throw new Error("Committed Artifact is missing.");
      }
      const now = new Date("2026-07-28T15:09:00.000Z");
      const decision = await transfers.authorizeArtifactDownload({
        authority,
        artifactId,
        purpose: "artifact-content",
        decisionId: ids.decision,
        audit: {
          auditEventId: ids.downloadAudit,
          authenticationRefHash: digest("9"),
        },
        now,
        validUntil: new Date(now.getTime() + 30_000),
      });
      expect(decision).toMatchObject({
        decision: "allow",
        artifactId,
        dataClassification: "restricted",
        proxyRequired: true,
      });
      if (decision.decision !== "allow") {
        throw new Error("Expected an allowed download decision.");
      }
      await expect(
        transfers.revalidateArtifactDownload({
          authority,
          decision,
          now: new Date(now.getTime() + 1_000),
        }),
      ).resolves.toMatchObject({
        decision: "allow",
      });
      await pool.execute(
        `UPDATE workspace_membership
         SET status = 'revoked', version = version + 1, updated_at = ?
         WHERE id = ?`,
        [new Date(now.getTime() + 2_000), ids.workspaceMembership],
      );
      await expect(
        transfers.revalidateArtifactDownload({
          authority,
          decision,
          now: new Date(now.getTime() + 3_000),
        }),
      ).resolves.toEqual({
        decision: "deny",
        disclosure: "not_found",
        reasonCode: "authorization_changed",
      });
    });
  },
);
