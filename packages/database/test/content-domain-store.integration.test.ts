import { resolve } from "node:path";

import {
  authorizationModelVersion,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  ContentDomainStoreError,
  createContentDomainStore,
  type ContentDomainStore,
} from "../src/runtime/content-domain-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const now = new Date("2026-07-29T12:00:00.000Z");
const auditHash = `sha256:${"a".repeat(64)}`;

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface ArtifactOwnershipRow extends RowDataPacket {
  readonly assetId: string | null;
}

interface AssetSelectionRow extends RowDataPacket {
  readonly currentArtifactId: string | null;
  readonly version: number;
}

function disposableDatabaseName(): string {
  const name = `kanvas_content_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function createAdminPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectionLimit: 2,
    multipleStatements: true,
    timezone: "Z",
    decimalNumbers: false,
  });
}

function createDomainPool(databaseName: string): Pool {
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
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    database: databaseName,
    user: config.user,
    password: config.password,
    connectionLimit: 8,
    timezone: "Z",
    decimalNumbers: false,
  });
}

async function seedAuthority(
  pool: Pool,
  base: number,
): Promise<TrustedWorkspaceScope> {
  const organizationId = id(base + 1);
  const workspaceId = id(base + 2);
  const principalId = id(base + 3);
  const authenticationRefId = id(base + 4);
  const organizationMembershipId = id(base + 5);
  const workspaceMembershipId = id(base + 6);
  const slug = `content-it-${String(base)}`;

  await pool.execute(
    `INSERT INTO principal
       (id, principal_type, status, version, created_at, updated_at)
     VALUES (?, 'human', 'active', 1, ?, ?)`,
    [principalId, now, now],
  );
  await pool.execute(
    `INSERT INTO human_principal
       (principal_id, auth_subject_id, created_at)
     VALUES (?, ?, ?)`,
    [principalId, `content-subject-${String(base)}`, now],
  );
  await pool.execute(
    `INSERT INTO organization
       (id, slug, name, status, version, created_at, updated_at)
     VALUES (?, ?, 'Content Integration', 'active', 1, ?, ?)`,
    [organizationId, slug, now, now],
  );
  await pool.execute(
    `INSERT INTO workspace
       (id, organization_id, slug, name, status, version,
        created_at, updated_at)
     VALUES (?, ?, ?, 'Content Integration', 'active', 1, ?, ?)`,
    [workspaceId, organizationId, slug, now, now],
  );
  await pool.execute(
    `INSERT INTO organization_membership
       (id, organization_id, principal_id, role, status, version,
        created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
    [organizationMembershipId, organizationId, principalId, now, now],
  );
  await pool.execute(
    `INSERT INTO workspace_membership
       (id, organization_id, workspace_id, principal_id, role,
        status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
    [workspaceMembershipId, organizationId, workspaceId, principalId, now, now],
  );

  return Object.freeze({
    workspaceId,
    organizationId,
    principalId,
    principalType: "human",
    authenticationRefType: "session",
    authenticationRefId,
    authorityType: "human_membership",
    authorityId: workspaceMembershipId,
    authorityVersion: 1,
    authorizationModelVersion,
    effectivePermissions: Object.freeze([
      "canvas.write",
      "asset.write",
      "approval.decide",
    ] as const),
    trusted: true,
  });
}

async function createStandaloneStructuredAsset(
  store: ContentDomainStore,
  authority: TrustedWorkspaceScope,
  base: number,
): Promise<{
  readonly assetId: string;
  readonly artifactId: string;
}> {
  const assetId = id(base + 1);
  const artifactId = id(base + 2);
  const content = Object.freeze({
    label: `artifact-${String(base)}`,
  });
  await store.createAsset({
    authority,
    assetId,
    assetKey: `asset-${String(base)}`,
    name: `Asset ${String(base)}`,
    assetType: "document",
    initialArtifact: {
      kind: "structured",
      artifactId,
      artifactType: "application/vnd.kanvas.document+json",
      structuredContent: content,
      contentDigest: digestProviderValue(content),
    },
    now,
  });
  return Object.freeze({
    assetId,
    artifactId,
  });
}

describe.skipIf(!integrationEnabled)(
  "Content Domain Store against a disposable MySQL 8.0 database",
  () => {
    const databaseName = disposableDatabaseName();
    let adminPool!: Pool;
    let pool!: Pool;

    beforeAll(async () => {
      adminPool = createAdminPool();
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const inventory = await readMigrationInventory(
        resolve(import.meta.dirname, "../migrations"),
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${databaseName}\``);
        for (const migration of inventory) {
          await connection.query(migration.sql);
        }
      } finally {
        connection.release();
      }
      pool = createDomainPool(databaseName);
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

    it("keeps Artifact ownership, Editorial Selection, Relations, References, and Audit atomic", async () => {
      const authority = await seedAuthority(pool, 1_000);
      const store = createContentDomainStore(pool);
      const assetId = id(1_012);
      const rejectedAssetId = id(1_013);
      const secondAssetId = id(1_014);
      const artifactId = id(1_015);
      const secondArtifactId = id(1_016);
      const relationId = id(1_017);
      const referenceId = id(1_018);
      const unownedContent = Object.freeze({
        blocks: [{ type: "text", value: "draft" }],
      });
      const unownedCommand = {
        authority,
        artifactId,
        artifactType: "application/vnd.kanvas.document+json",
        structuredContent: unownedContent,
        contentDigest: digestProviderValue(unownedContent),
        target: {
          kind: "workspace" as const,
        },
        now,
      };
      await expect(
        store.createStructuredArtifact(unownedCommand),
      ).resolves.toMatchObject({
        status: "created",
        assetId: null,
      });
      await expect(
        store.createStructuredArtifact(unownedCommand),
      ).resolves.toMatchObject({
        status: "existing",
      });

      await store.createAsset({
        authority,
        assetId,
        assetKey: "launch-master",
        name: "Launch Master",
        assetType: "document",
        now,
      });
      const adoptionCommand = {
        authority,
        artifactId,
        target: {
          kind: "asset" as const,
          assetId,
        },
        now,
      };
      await expect(store.adoptArtifact(adoptionCommand)).resolves.toMatchObject(
        {
          status: "adopted",
          assetId,
        },
      );
      await expect(store.adoptArtifact(adoptionCommand)).resolves.toMatchObject(
        {
          status: "existing",
        },
      );

      await expect(
        store.createAsset({
          authority,
          assetId: rejectedAssetId,
          assetKey: "must-roll-back",
          name: "Must Roll Back",
          assetType: "document",
          initialArtifact: {
            kind: "adopt",
            artifactId,
          },
          now,
        }),
      ).rejects.toMatchObject({
        code: "content_domain.identity_conflict",
      });
      const [rolledBackRows] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM asset WHERE id = ?",
        [rejectedAssetId],
      );
      expect(Number(rolledBackRows[0]?.count ?? 0)).toBe(0);

      await store.createAsset({
        authority,
        assetId: secondAssetId,
        assetKey: "launch-variant",
        name: "Launch Variant",
        assetType: "document",
        now,
      });
      await expect(
        store.adoptArtifact({
          authority,
          artifactId,
          target: {
            kind: "asset",
            assetId: secondAssetId,
          },
          now,
        }),
      ).rejects.toMatchObject({
        code: "content_domain.identity_conflict",
      });
      const [ownershipRows] = await pool.query<ArtifactOwnershipRow[]>(
        `SELECT
             asset_id AS assetId
           FROM artifact
           WHERE id = ?`,
        [artifactId],
      );
      expect(ownershipRows[0]).toMatchObject({
        assetId,
      });

      const secondContent = Object.freeze({
        blocks: [{ type: "image", value: "variant" }],
      });
      await store.createStructuredArtifact({
        authority,
        artifactId: secondArtifactId,
        artifactType: "application/vnd.kanvas.document+json",
        structuredContent: secondContent,
        contentDigest: digestProviderValue(secondContent),
        target: {
          kind: "asset",
          assetId: secondAssetId,
        },
        now,
      });

      const relationCommand = {
        authority,
        relationId,
        sourceAssetId: secondAssetId,
        targetAssetId: assetId,
        relation: "variant_of" as const,
        now,
      };
      await expect(
        store.addAssetRelation(relationCommand),
      ).resolves.toMatchObject({ status: "created" });
      await expect(
        store.addAssetRelation(relationCommand),
      ).resolves.toMatchObject({ status: "existing" });

      const referenceCommand = {
        authority,
        referenceId,
        artifactId,
        referenceRole: "related-asset",
        target: {
          type: "asset" as const,
          id: secondAssetId,
        },
        now,
      };
      await expect(
        store.addArtifactReference(referenceCommand),
      ).resolves.toMatchObject({ status: "created" });
      await expect(
        store.addArtifactReference(referenceCommand),
      ).resolves.toMatchObject({ status: "existing" });

      const failingAuditStore = createContentDomainStore(pool, {
        auditPort: {
          appendInTransaction() {
            return Promise.reject(new Error("audit unavailable"));
          },
        },
      });
      await expect(
        failingAuditStore.selectCurrentArtifact({
          authority,
          assetId,
          artifactId,
          expectedAssetVersion: 1,
          audit: {
            auditEventId: id(1_020),
            authenticationRefHash: auditHash,
          },
          now,
        }),
      ).rejects.toThrow("audit unavailable");
      const [rolledBackSelectionRows] = await pool.query<AssetSelectionRow[]>(
        `SELECT
             current_artifact_id AS currentArtifactId,
             version
           FROM asset
           WHERE id = ?`,
        [assetId],
      );
      expect(rolledBackSelectionRows[0]).toMatchObject({
        currentArtifactId: null,
        version: 1,
      });

      await expect(
        store.selectCurrentArtifact({
          authority,
          assetId,
          artifactId,
          expectedAssetVersion: 1,
          audit: {
            auditEventId: id(1_021),
            authenticationRefHash: auditHash,
          },
          now,
        }),
      ).resolves.toMatchObject({
        artifactId,
        version: 2,
      });
      const [auditRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE id = ?
           AND resource_id = ?
           AND authorization_decision_digest
             REGEXP '^sha256:[0-9a-f]{64}$'
           AND integrity_digest REGEXP '^sha256:[0-9a-f]{64}$'`,
        [id(1_021), assetId],
      );
      expect(Number(auditRows[0]?.count ?? 0)).toBe(1);
    }, 30_000);

    it("serializes lineage writers and rejects cycles across every relation", async () => {
      const authority = await seedAuthority(pool, 2_000);
      const storeOne = createContentDomainStore(pool);
      const storeTwo = createContentDomainStore(pool);
      const first = await createStandaloneStructuredAsset(
        storeOne,
        authority,
        2_010,
      );
      const second = await createStandaloneStructuredAsset(
        storeOne,
        authority,
        2_020,
      );
      const third = await createStandaloneStructuredAsset(
        storeOne,
        authority,
        2_030,
      );
      const concurrentLeft = await createStandaloneStructuredAsset(
        storeOne,
        authority,
        2_040,
      );
      const concurrentRight = await createStandaloneStructuredAsset(
        storeOne,
        authority,
        2_050,
      );

      await storeOne.addArtifactEdge({
        authority,
        edgeId: id(2_060),
        sourceArtifactId: first.artifactId,
        targetArtifactId: second.artifactId,
        relation: "derived_from",
        now,
      });
      await storeOne.addArtifactEdge({
        authority,
        edgeId: id(2_061),
        sourceArtifactId: second.artifactId,
        targetArtifactId: third.artifactId,
        relation: "generated_from",
        now,
      });
      await expect(
        storeOne.addArtifactEdge({
          authority,
          edgeId: id(2_062),
          sourceArtifactId: third.artifactId,
          targetArtifactId: first.artifactId,
          relation: "composed_from",
          now,
        }),
      ).rejects.toMatchObject({
        code: "content_domain.lineage_cycle",
      });

      const concurrent = await Promise.allSettled([
        storeOne.addArtifactEdge({
          authority,
          edgeId: id(2_063),
          sourceArtifactId: concurrentLeft.artifactId,
          targetArtifactId: concurrentRight.artifactId,
          relation: "derived_from",
          now,
        }),
        storeTwo.addArtifactEdge({
          authority,
          edgeId: id(2_064),
          sourceArtifactId: concurrentRight.artifactId,
          targetArtifactId: concurrentLeft.artifactId,
          relation: "supersedes",
          now,
        }),
      ]);
      expect(
        concurrent.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = concurrent.find(({ status }) => status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(ContentDomainStoreError);
        expect(rejected.reason).toMatchObject({
          code: "content_domain.lineage_cycle",
        });
      }
      const [edgeRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM artifact_edge
         WHERE source_artifact_id IN (?, ?)
           AND target_artifact_id IN (?, ?)`,
        [
          concurrentLeft.artifactId,
          concurrentRight.artifactId,
          concurrentLeft.artifactId,
          concurrentRight.artifactId,
        ],
      );
      expect(Number(edgeRows[0]?.count ?? 0)).toBe(1);
    }, 30_000);

    it("rejects a stale authority inside the same write transaction", async () => {
      const authority = await seedAuthority(pool, 4_000);
      const store = createContentDomainStore(pool);
      await pool.execute(
        `UPDATE workspace_membership
         SET version = 2,
             updated_at = ?
         WHERE id = ?`,
        [new Date(now.getTime() + 1_000), authority.authorityId],
      );

      await expect(
        store.createAsset({
          authority,
          assetId: id(4_010),
          assetKey: "must-not-write",
          name: "Must Not Write",
          assetType: "document",
          now: new Date(now.getTime() + 2_000),
        }),
      ).rejects.toMatchObject({
        code: "content_domain.forbidden",
      });
      const [assetRows] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM asset WHERE id = ?",
        [id(4_010)],
      );
      expect(Number(assetRows[0]?.count ?? 0)).toBe(0);
    }, 30_000);
  },
);
