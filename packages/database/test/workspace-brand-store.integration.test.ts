import { resolve } from "node:path";

import {
  authorizationModelVersion,
  createWorkspaceBrand,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import { createWorkspaceBrandStore } from "../src/runtime/workspace-brand-store.js";
import { createCanvasDraftStore } from "../src/runtime/canvas-draft-store.js";
import { createContentDomainStore } from "../src/runtime/content-domain-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const now = new Date("2026-08-21T22:00:00.000Z");
const authenticationRefHash = `sha256:${"a".repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function disposableDatabaseName(): string {
  const name = `kanvas_brand_${String(process.pid)}_${String(Date.now())}`;
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

function createBrandPool(databaseName: string): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      database: databaseName,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 6,
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
    connectionLimit: 6,
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
  const organizationMembershipId = id(base + 4);
  const workspaceMembershipId = id(base + 5);
  const slug = `brand-it-${String(base)}`;

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
    [principalId, `brand-subject-${String(base)}`, now],
  );
  await pool.execute(
    `INSERT INTO organization
       (id, slug, name, status, version, created_at, updated_at)
     VALUES (?, ?, 'Brand Integration', 'active', 1, ?, ?)`,
    [organizationId, slug, now, now],
  );
  await pool.execute(
    `INSERT INTO workspace
       (id, organization_id, slug, name, status, version,
        created_at, updated_at)
     VALUES (?, ?, ?, 'Brand Integration', 'active', 1, ?, ?)`,
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
    authenticationRefId: `brand-session-${String(base)}`,
    authorityType: "human_membership",
    authorityId: workspaceMembershipId,
    authorityVersion: 1,
    authorizationModelVersion,
    effectivePermissions: Object.freeze([
      "brand.read",
      "brand.manage",
      "canvas.read",
      "canvas.write",
      "asset.read",
      "asset.write",
    ] as const),
    trusted: true,
  });
}

describe.skipIf(!integrationEnabled)(
  "Workspace Brand Store against a disposable MySQL 8.0 database",
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
      pool = createBrandPool(databaseName);
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

    it("creates, updates, publishes, defaults, replays, and isolates one fixed Brand Revision", async () => {
      const authority = await seedAuthority(pool, 10_000);
      const otherAuthority = await seedAuthority(pool, 20_000);
      const brandKitId = id(10_010);
      const brandKitRevisionId = id(10_011);
      const logoAssetId = id(10_014);
      const logoArtifactId = id(10_015);
      const ids = [brandKitId, brandKitRevisionId, id(10_012), id(10_013)];
      const brand = createWorkspaceBrand({
        repository: createWorkspaceBrandStore(pool),
        now: () => now,
        nextId: () => {
          const next = ids.shift();
          if (!next) throw new Error("Brand test ID inventory exhausted.");
          return next;
        },
      });
      const audit = (value: number) => ({
        auditEventId: id(10_100 + value),
        authenticationRefHash,
      });
      const logoContent = { kind: "brand-logo", variant: "primary" };
      await createContentDomainStore(pool).createAsset({
        authority,
        assetId: logoAssetId,
        assetKey: "acme-primary-logo",
        name: "Acme 主 Logo",
        assetType: "image.source",
        initialArtifact: {
          kind: "structured",
          artifactId: logoArtifactId,
          artifactType: "image.source",
          structuredContent: logoContent,
          contentDigest: digestProviderValue(logoContent),
        },
        now,
      });

      const created = await brand.create({
        authority,
        name: "Acme 主品牌",
        idempotencyKey: "brand-create-1",
        audit: audit(1),
      });
      expect(created).toMatchObject({
        replayed: false,
        value: { brandKitId, draftVersion: 1, brandKitVersion: 1 },
      });

      const updated = await brand.updateDraft({
        authority,
        brandKitId,
        expectedDraftVersion: 1,
        name: "Acme 主品牌",
        colors: [
          {
            key: "color.primary",
            name: "主色",
            role: "primary",
            value: "#2457f5",
            position: 0,
          },
        ],
        logos: [
          {
            key: "logo.primary",
            name: "主 Logo",
            role: "primary",
            assetId: logoAssetId,
            artifactId: logoArtifactId,
            position: 0,
          },
        ],
        referenceImages: [
          {
            key: "reference.photography",
            name: "产品摄影参考",
            description: "自然光与克制构图",
            assetId: logoAssetId,
            artifactId: logoArtifactId,
            position: 0,
          },
        ],
        textStyles: [
          {
            key: "text.title",
            name: "品牌标题",
            role: "title",
            fontId: "noto-sans-sc",
            fontRevision: "google-fonts-2026-07-31",
            fontFamily: "Noto Sans SC",
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: 0,
            colorKey: "color.primary",
            position: 0,
          },
        ],
        guidelines: {
          voice: "清晰、克制、可信",
          principles: ["作品优先"],
          avoid: ["避免魔法式表达"],
        },
        audit: audit(2),
      });
      expect(updated).toMatchObject({
        draftVersion: 2,
        brandKitVersion: 2,
        document: { colors: [{ value: "#2457F5" }] },
      });
      await expect(
        brand.updateDraft({
          authority,
          brandKitId,
          expectedDraftVersion: 1,
          name: "过期修改",
          colors: updated.document.colors,
          logos: updated.document.logos,
          referenceImages: updated.document.referenceImages,
          textStyles: updated.document.textStyles,
          guidelines: updated.document.guidelines,
          audit: audit(3),
        }),
      ).rejects.toMatchObject({ code: "brand.version_conflict" });

      const published = await brand.publish({
        authority,
        brandKitId,
        expectedDraftVersion: 2,
        idempotencyKey: "brand-publish-1",
        audit: audit(4),
      });
      expect(published).toMatchObject({
        replayed: false,
        value: {
          id: brandKitRevisionId,
          revisionNumber: 1,
          document: { colors: [{ value: "#2457F5" }] },
        },
      });

      const replayed = await brand.publish({
        authority,
        brandKitId,
        expectedDraftVersion: 2,
        idempotencyKey: "brand-publish-1",
        audit: audit(5),
      });
      expect(replayed).toMatchObject({
        replayed: true,
        value: { id: brandKitRevisionId },
      });

      const afterPublish = await brand.getDraft(authority, brandKitId);
      expect(afterPublish.brandKitVersion).toBe(3);
      await brand.setDefault({
        authority,
        brandKitId,
        expectedBrandKitVersion: 3,
        audit: audit(6),
      });
      await expect(
        brand.list(authority, { lifecycleStatus: "active" }),
      ).resolves.toMatchObject([{ id: brandKitId, isDefault: true }]);
      await expect(
        brand.listRevisions(authority, brandKitId),
      ).resolves.toMatchObject([{ id: brandKitRevisionId, revisionNumber: 1 }]);
      await expect(brand.getDefaultRevision(authority)).resolves.toMatchObject({
        id: brandKitRevisionId,
        brandKitId,
        contentDigest: updated.contentDigest,
      });

      const canvasDraftId = id(10_020);
      const canvas = createCanvasDraftStore(pool);
      const canvasDocument = {
        schemaVersion: "kanvas.editor-document/v1" as const,
        title: "品牌画板",
        pages: [
          {
            id: "page-1",
            name: "页面 1",
            width: 1080,
            height: 1080,
            background: {
              kind: "paint" as const,
              paint: { kind: "solid" as const, color: "#FFFFFF" },
            },
            nodes: [],
          },
        ],
        metadata: { createdWith: "brand-integration" },
      };
      await expect(
        canvas.create({
          authority,
          canvasDraftId,
          idempotencyKey: "brand-canvas-create-1",
          document: canvasDocument,
          now,
          audit: {
            auditEventId: id(10_107),
            authenticationRefHash,
          },
        }),
      ).resolves.toMatchObject({
        draft: {
          id: canvasDraftId,
          brand: {
            brandKitId,
            brandKitRevisionId,
            revisionNumber: 1,
          },
        },
      });
      await expect(
        canvas.getRevision(authority, canvasDraftId, 1),
      ).resolves.toMatchObject({
        brand: { brandKitRevisionId },
      });
      await expect(
        canvas.recoverMutation(authority, id(10_107)),
      ).resolves.toMatchObject({
        kind: "create",
        beforeVersion: 0,
        afterVersion: 1,
        revision: { canvasDraftId, version: 1 },
      });

      await expect(
        brand.getRevision(otherAuthority, brandKitId, brandKitRevisionId),
      ).rejects.toMatchObject({ code: "brand.revision_not_found" });

      const [defaultRows] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM brand_kit
         WHERE workspace_id = ?
           AND default_marker = TRUE`,
        [authority.workspaceId],
      );
      expect(Number(defaultRows[0]?.count ?? 0)).toBe(1);
      const [auditRows] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE workspace_id = ?
           AND event_type LIKE 'brand.%'`,
        [authority.workspaceId],
      );
      expect(Number(auditRows[0]?.count ?? 0)).toBe(4);
    });
  },
);
