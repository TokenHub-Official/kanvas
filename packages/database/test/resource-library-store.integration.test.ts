import { resolve } from "node:path";
import {
  authorizationModelVersion,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const now = new Date("2026-10-13T12:00:00Z");
const authenticationRefHash = `sha256:${"a".repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
function disposableDatabaseName(): string {
  const name = `kanvas_library_${String(process.pid)}_${String(Date.now())}`;
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

function createLibraryPool(databaseName: string): Pool {
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
      "library.read",
      "library.manage",
      "canvas.read",
      "canvas.write",
      "asset.read",
      "asset.write",
    ] as const),
    trusted: true,
  });
}

describe.skipIf(!integrationEnabled)(
  "Resource Libraries on disposable MySQL",
  () => {
    const databaseName = disposableDatabaseName();
    let adminPool: Pool;
    let pool: Pool;
    beforeAll(async () => {
      adminPool = createAdminPool();
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${databaseName}\``);
        for (const migration of await readMigrationInventory(
          resolve(import.meta.dirname, "../migrations"),
        ))
          await connection.query(migration.sql);
      } finally {
        connection.release();
      }
      pool = createLibraryPool(databaseName);
    }, 120_000);
    afterAll(async () => {
      if (pool) await pool.end();
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await adminPool.end();
      }
    });
    it("isolates owners, serializes saves, replays exact requests, and preserves historical revisions", async () => {
      const authority = await seedAuthority(pool, 40000);
      const other = await seedAuthority(pool, 50000);
      const store = createResourceLibraryStore(pool);
      let sequence = 60000;
      const command = (
        expectedVersion: number,
        requestKey: string,
        name = "Product A",
      ) => ({
        authority,
        libraryId: id(41000),
        revisionId: id(++sequence),
        expectedVersion,
        requestKey,
        document: {
          schemaVersion: 1 as const,
          name,
          description: "Product facts",
          entries: [],
        },
        audit: { auditEventId: id(++sequence), authenticationRefHash },
        now,
      });
      const first = command(0, "create");
      const created = await store.save(first);
      expect(created.revision.revisionNumber).toBe(1);
      expect(
        (await store.save({ ...first, revisionId: id(++sequence) })).replayed,
      ).toBe(true);
      await expect(
        store.save({
          ...first,
          document: { ...first.document, name: "Changed" },
        }),
      ).rejects.toMatchObject({ code: "resource_library.request_conflict" });
      await expect(
        store.getRevision({
          authority: other,
          libraryId: first.libraryId,
          now,
        }),
      ).rejects.toMatchObject({ code: "resource_library.not_found" });
      const concurrent = await Promise.allSettled([
        store.save(command(1, "save-a", "A")),
        store.save(command(1, "save-b", "B")),
      ]);
      expect(
        concurrent.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        concurrent.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { code: "resource_library.version_conflict" },
      });
      expect(
        (
          await store.getRevision({
            authority,
            libraryId: first.libraryId,
            revisionId: created.revision.id,
            now,
          })
        ).document.name,
      ).toBe("Product A");
      expect(
        (
          await store.getRevision({
            authority,
            libraryId: first.libraryId,
            now,
          })
        ).revisionNumber,
      ).toBe(2);
      await store.setLifecycle({
        authority,
        libraryId: first.libraryId,
        expectedVersion: 2,
        lifecycleStatus: "archived",
        audit: { auditEventId: id(++sequence), authenticationRefHash },
        now,
      });
      expect(
        await store.list({
          authority,
          lifecycleStatus: "active",
          limit: 10,
          now,
        }),
      ).toHaveLength(0);
      expect(
        await store.list({
          authority,
          lifecycleStatus: "archived",
          limit: 10,
          now,
        }),
      ).toHaveLength(1);
      await expect(
        store.save(command(3, "archived-save")),
      ).rejects.toMatchObject({ code: "resource_library.archived" });
      expect(
        (
          await store.getRevision({
            authority,
            libraryId: first.libraryId,
            revisionId: created.revision.id,
            now,
          })
        ).id,
      ).toBe(created.revision.id);
      await pool.execute(
        "UPDATE workspace_membership SET status = 'revoked', version = version + 1 WHERE id = ?",
        [authority.authorityId],
      );
      await expect(
        store.getRevision({
          authority,
          libraryId: first.libraryId,
          revisionId: created.revision.id,
          now,
        }),
      ).rejects.toThrow();
    });
    it("rolls back a create with an unavailable file instead of leaving a partial library", async () => {
      const authority = await seedAuthority(pool, 70000);
      const store = createResourceLibraryStore(pool);
      await expect(
        store.save({
          authority,
          libraryId: id(71000),
          revisionId: id(71001),
          expectedVersion: 0,
          requestKey: "invalid-create",
          now,
          document: {
            schemaVersion: 1,
            name: "Invalid",
            description: "",
            entries: [
              {
                id: id(71002),
                artifactId: id(71003),
                name: "Private file",
                purpose: "",
              },
            ],
          },
          audit: { auditEventId: id(71004), authenticationRefHash },
        }),
      ).rejects.toMatchObject({
        code: "resource_library.reference_unavailable",
      });
      expect(
        await store.list({
          authority,
          lifecycleStatus: "active",
          limit: 10,
          now,
        }),
      ).toHaveLength(0);
    });
  },
);
