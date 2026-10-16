import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { DatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  AuthorizationStoreError,
  createAuthorizationStore,
} from "../src/runtime/authorization-store.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-28T12:00:00.000Z");

interface WorkspaceOrganizationRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly workspaceOrganizationId: string;
  readonly workspaceStatus: string;
  readonly workspaceVersion: number;
  readonly organizationId: string;
  readonly organizationStatus: string;
  readonly organizationVersion: number;
}

interface CountRow extends RowDataPacket {
  readonly count: number;
}

function databaseName(suffix: string): string {
  const name = `kanvas_identity_${String(process.pid)}_${String(Date.now())}_${suffix}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

describe.skipIf(!integrationEnabled)(
  "identity and authorization on disposable MySQL 8.0 databases",
  () => {
    const freshDatabase = databaseName("fresh");
    const authorizationDatabase = databaseName("authorization");
    let adminPool!: Pool;
    let authorizationPool!: Pool;

    beforeAll(async () => {
      const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
      let networkConfig: DatabaseConnectionConfig | undefined;
      if (socketPath) {
        adminPool = createPool({
          socketPath,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 2,
          multipleStatements: true,
          timezone: "Z",
          decimalNumbers: false,
        });
      } else {
        networkConfig = loadDatabaseConnectionConfig(process.env);
        adminPool = createPool({
          host: networkConfig.host,
          port: networkConfig.port,
          user: networkConfig.user,
          password: networkConfig.password,
          connectionLimit: 2,
          multipleStatements: true,
          timezone: "Z",
          decimalNumbers: false,
        });
      }
      await adminPool.query(
        `CREATE DATABASE \`${freshDatabase}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      await adminPool.query(
        `CREATE DATABASE \`${authorizationDatabase}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const inventory = await readMigrationInventory(
        resolve(import.meta.dirname, "../migrations"),
      );
      const freshConnection = await adminPool.getConnection();
      try {
        await freshConnection.query(`USE \`${freshDatabase}\``);
        for (const migration of inventory) {
          await freshConnection.query(migration.sql);
        }
      } finally {
        freshConnection.release();
      }

      const authorizationConnection = await adminPool.getConnection();
      try {
        await authorizationConnection.query(`USE \`${authorizationDatabase}\``);
        for (const migration of inventory) {
          await authorizationConnection.query(migration.sql);
        }
        await authorizationConnection.execute(
          `INSERT INTO organization
             (id, slug, name, status, version, created_at, updated_at)
           VALUES (?, 'test-organization', 'Test Organization',
                   'setup_required', 1, ?, ?)`,
          [id(1), now, now],
        );
        await authorizationConnection.execute(
          `INSERT INTO workspace
             (id, organization_id, slug, name, status, version,
              created_at, updated_at)
           VALUES (?, ?, 'test-workspace', 'Test Workspace',
                   'setup_required', 1, ?, ?)`,
          [id(1), id(1), now, now],
        );
      } finally {
        authorizationConnection.release();
      }

      if (socketPath) {
        authorizationPool = createPool({
          socketPath,
          database: authorizationDatabase,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 4,
          timezone: "Z",
          decimalNumbers: false,
        });
      } else {
        if (!networkConfig) {
          throw new Error("Network database configuration is missing.");
        }
        authorizationPool = createPool({
          host: networkConfig.host,
          port: networkConfig.port,
          database: authorizationDatabase,
          user: networkConfig.user,
          password: networkConfig.password,
          connectionLimit: 4,
          timezone: "Z",
          decimalNumbers: false,
        });
      }
    }, 120_000);

    afterAll(async () => {
      if (authorizationPool) {
        await authorizationPool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${freshDatabase}\``);
        await adminPool.query(
          `DROP DATABASE IF EXISTS \`${authorizationDatabase}\``,
        );
        await adminPool.end();
      }
    }, 30_000);

    it("applies the full migration inventory to a fresh database", async () => {
      const [rows] = await adminPool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = ?
           AND table_name IN (
             'organization',
             'workspace_membership',
             'service_api_token',
             'audit_event'
           )`,
        [freshDatabase],
      );
      expect(Number(rows[0]?.count ?? 0)).toBe(4);
    });

    it("keeps Workspace and Organization authorization scopes aligned", async () => {
      const [rows] = await authorizationPool.query<WorkspaceOrganizationRow[]>(
        `SELECT
           workspace.id AS workspaceId,
           workspace.organization_id AS workspaceOrganizationId,
           workspace.status AS workspaceStatus,
           workspace.version AS workspaceVersion,
           organization.id AS organizationId,
           organization.status AS organizationStatus,
           organization.version AS organizationVersion
         FROM workspace
         INNER JOIN organization
           ON organization.id = workspace.organization_id
         WHERE workspace.id = ?`,
        [id(1)],
      );
      expect(rows[0]).toMatchObject({
        workspaceId: id(1),
        workspaceOrganizationId: id(1),
        workspaceStatus: "setup_required",
        workspaceVersion: 1,
        organizationId: id(1),
        organizationStatus: "setup_required",
        organizationVersion: 1,
      });
    });

    it("serializes concurrent Owner changes at both scopes and preserves one active Owner", async () => {
      const ownerOne = id(2);
      const ownerTwo = id(3);
      const membershipOne = id(4);
      const membershipTwo = id(5);
      await authorizationPool.execute(
        `UPDATE organization
         SET status = 'active', version = 2, updated_at = ?
         WHERE id = ?`,
        [now, id(1)],
      );
      await authorizationPool.execute(
        `UPDATE workspace
         SET status = 'active', version = 2, updated_at = ?
         WHERE id = ?`,
        [now, id(1)],
      );
      await authorizationPool.execute(
        `INSERT INTO principal
          (id, principal_type, status, version, created_at, updated_at)
         VALUES
          (?, 'human', 'active', 1, ?, ?),
          (?, 'human', 'active', 1, ?, ?)`,
        [ownerOne, now, now, ownerTwo, now, now],
      );
      await authorizationPool.execute(
        `INSERT INTO human_principal
          (principal_id, auth_subject_id, created_at)
         VALUES
          (?, 'owner-one', ?),
          (?, 'owner-two', ?)`,
        [ownerOne, now, ownerTwo, now],
      );
      await authorizationPool.execute(
        `INSERT INTO workspace_membership
          (id, organization_id, workspace_id, principal_id, role,
           status, version, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, 'owner', 'active', 1, ?, ?),
          (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          membershipOne,
          id(1),
          id(1),
          ownerOne,
          now,
          now,
          membershipTwo,
          id(1),
          id(1),
          ownerTwo,
          now,
          now,
        ],
      );
      const store = createAuthorizationStore(authorizationPool);
      const results = await Promise.allSettled([
        store.changeWorkspaceMembership({
          workspaceId: id(1),
          authority: {
            workspaceId: id(1),
            organizationId: id(1),
            principalId: ownerOne,
            principalType: "human",
            authenticationRefType: "session",
            authenticationRefId: "owner-one-session",
            authorityType: "human_membership",
            authorityId: membershipOne,
            authorityVersion: 1,
            authorizationModelVersion: 1,
            effectivePermissions: ["membership.manage"],
            trusted: true,
          },
          targetPrincipalId: ownerOne,
          expectedTargetVersion: 1,
          nextRole: "viewer",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(6),
            authenticationRefHash: digest("a"),
          },
        }),
        store.changeWorkspaceMembership({
          workspaceId: id(1),
          authority: {
            workspaceId: id(1),
            organizationId: id(1),
            principalId: ownerTwo,
            principalType: "human",
            authenticationRefType: "session",
            authenticationRefId: "owner-two-session",
            authorityType: "human_membership",
            authorityId: membershipTwo,
            authorityVersion: 1,
            authorizationModelVersion: 1,
            effectivePermissions: ["membership.manage"],
            trusted: true,
          },
          targetPrincipalId: ownerTwo,
          expectedTargetVersion: 1,
          nextRole: "viewer",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(7),
            authenticationRefHash: digest("b"),
          },
        }),
      ]);

      expect(
        results.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(({ status }) => status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(AuthorizationStoreError);
        expect(rejected.reason).toMatchObject({
          code: "authorization.last_owner",
        });
      }
      const [ownerRows] = await authorizationPool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM workspace_membership
         WHERE workspace_id = ?
           AND role = 'owner'
           AND status = 'active'`,
        [id(1)],
      );
      expect(Number(ownerRows[0]?.count ?? 0)).toBe(1);
      const [auditRows] = await authorizationPool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE workspace_id = ?
           AND schema_version = 1
           AND authorization_decision_digest
             REGEXP '^sha256:[0-9a-f]{64}$'
           AND integrity_digest REGEXP '^sha256:[0-9a-f]{64}$'`,
        [id(1)],
      );
      expect(Number(auditRows[0]?.count ?? 0)).toBe(1);
      const [originalAudit] = await authorizationPool.query<RowDataPacket[]>(
        "SELECT * FROM audit_event WHERE workspace_id = ? ORDER BY id",
        [id(1)],
      );

      const organizationMembershipOne = id(8);
      const organizationMembershipTwo = id(9);
      await authorizationPool.execute(
        `INSERT INTO organization_membership
          (id, organization_id, principal_id, role, status, version,
           created_at, updated_at)
         VALUES
          (?, ?, ?, 'owner', 'active', 1, ?, ?),
          (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          organizationMembershipOne,
          id(1),
          ownerOne,
          now,
          now,
          organizationMembershipTwo,
          id(1),
          ownerTwo,
          now,
          now,
        ],
      );
      const organizationResults = await Promise.allSettled([
        store.changeOrganizationMembership({
          organizationId: id(1),
          actorPrincipalId: ownerOne,
          targetPrincipalId: ownerOne,
          expectedTargetVersion: 1,
          nextRole: "member",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(10),
            authenticationRefHash: digest("c"),
          },
        }),
        store.changeOrganizationMembership({
          organizationId: id(1),
          actorPrincipalId: ownerTwo,
          targetPrincipalId: ownerTwo,
          expectedTargetVersion: 1,
          nextRole: "member",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(11),
            authenticationRefHash: digest("d"),
          },
        }),
      ]);
      expect(
        organizationResults.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const organizationRejected = organizationResults.find(
        ({ status }) => status === "rejected",
      );
      expect(organizationRejected?.status).toBe("rejected");
      if (organizationRejected?.status === "rejected") {
        expect(organizationRejected.reason).toMatchObject({
          code: "authorization.last_owner",
        });
      }
      const [organizationOwnerRows] = await authorizationPool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM organization_membership
           WHERE organization_id = ?
             AND role = 'owner'
             AND status = 'active'`,
        [id(1)],
      );
      expect(Number(organizationOwnerRows[0]?.count ?? 0)).toBe(1);
      const [retainedAudit] = await authorizationPool.query<RowDataPacket[]>(
        "SELECT * FROM audit_event WHERE workspace_id = ? ORDER BY id",
        [id(1)],
      );
      expect(retainedAudit).toEqual(originalAudit);
    }, 30_000);

    it("shares membership rules across Workspace and Instance Administrator authority", async () => {
      const workspaceOne = id(100);
      const workspaceTwo = id(101);
      const siteAdministrator = id(102);
      const workspaceOwner = id(103);
      const workspaceAdministrator = id(104);
      const targetPrincipal = id(105);
      const lastOwner = id(106);
      const ownerMembership = id(107);
      const administratorMembership = id(108);
      const targetMembershipOne = id(109);
      const targetMembershipTwo = id(110);
      const lastOwnerMembership = id(111);
      await authorizationPool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES
          (?, ?, 'authority-one', 'Authority One', 'active', 1, ?, ?),
          (?, ?, 'authority-two', 'Authority Two', 'active', 1, ?, ?)`,
        [workspaceOne, id(1), now, now, workspaceTwo, id(1), now, now],
      );
      await authorizationPool.execute(
        `INSERT INTO principal
          (id, principal_type, status, version, created_at, updated_at)
         VALUES
          (?, 'human', 'active', 1, ?, ?),
          (?, 'human', 'active', 1, ?, ?),
          (?, 'human', 'active', 1, ?, ?),
          (?, 'human', 'active', 1, ?, ?),
          (?, 'human', 'active', 1, ?, ?)`,
        [
          siteAdministrator,
          now,
          now,
          workspaceOwner,
          now,
          now,
          workspaceAdministrator,
          now,
          now,
          targetPrincipal,
          now,
          now,
          lastOwner,
          now,
          now,
        ],
      );
      await authorizationPool.execute(
        `INSERT INTO human_principal
          (principal_id, auth_subject_id, created_at)
         VALUES
          (?, 'site-administrator', ?),
          (?, 'workspace-owner', ?),
          (?, 'workspace-administrator', ?),
          (?, 'membership-target', ?),
          (?, 'last-owner', ?)`,
        [
          siteAdministrator,
          now,
          workspaceOwner,
          now,
          workspaceAdministrator,
          now,
          targetPrincipal,
          now,
          lastOwner,
          now,
        ],
      );
      await authorizationPool.execute(
        `INSERT INTO instance_administrator
          (principal_id, status, version, created_at, updated_at)
         VALUES (?, 'active', 1, ?, ?)`,
        [siteAdministrator, now, now],
      );
      await authorizationPool.execute(
        `INSERT INTO workspace_membership
          (id, organization_id, workspace_id, principal_id, role,
           status, version, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, 'owner', 'active', 1, ?, ?),
          (?, ?, ?, ?, 'admin', 'active', 1, ?, ?),
          (?, ?, ?, ?, 'editor', 'active', 1, ?, ?),
          (?, ?, ?, ?, 'viewer', 'active', 1, ?, ?),
          (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          ownerMembership,
          id(1),
          workspaceOne,
          workspaceOwner,
          now,
          now,
          administratorMembership,
          id(1),
          workspaceOne,
          workspaceAdministrator,
          now,
          now,
          targetMembershipOne,
          id(1),
          workspaceOne,
          targetPrincipal,
          now,
          now,
          targetMembershipTwo,
          id(1),
          workspaceTwo,
          targetPrincipal,
          now,
          now,
          lastOwnerMembership,
          id(1),
          workspaceTwo,
          lastOwner,
          now,
          now,
        ],
      );

      const store = createAuthorizationStore(authorizationPool, {
        instanceId: "authority-integration",
      });
      const instanceAuthority = {
        instanceId: "authority-integration",
        principalId: siteAdministrator,
        principalType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefId: "site-admin-session",
        authorityType: "instance_administrator" as const,
        authorityId: siteAdministrator,
        authorityVersion: 1,
        authorizationModelVersion: 1 as const,
        trusted: true as const,
      };
      await expect(
        store.changeWorkspaceMembership({
          authority: instanceAuthority,
          workspaceId: workspaceOne,
          targetPrincipalId: targetPrincipal,
          expectedTargetVersion: 1,
          nextRole: "reviewer",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(112),
            authenticationRefHash: digest("e"),
          },
        }),
      ).resolves.toMatchObject({ role: "reviewer", version: 2 });

      const workspaceAdministratorAuthority = {
        workspaceId: workspaceOne,
        organizationId: id(1),
        principalId: workspaceAdministrator,
        principalType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefId: "workspace-admin-session",
        authorityType: "human_membership" as const,
        authorityId: administratorMembership,
        authorityVersion: 1,
        authorizationModelVersion: 1 as const,
        effectivePermissions: ["membership.manage"] as const,
        trusted: true as const,
      };
      await expect(
        store.changeWorkspaceMembership({
          authority: workspaceAdministratorAuthority,
          workspaceId: workspaceTwo,
          targetPrincipalId: targetPrincipal,
          expectedTargetVersion: 1,
          nextRole: "editor",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(113),
            authenticationRefHash: digest("f"),
          },
        }),
      ).rejects.toMatchObject({ code: "authorization.forbidden" });

      await expect(
        store.changeWorkspaceMembership({
          authority: instanceAuthority,
          workspaceId: workspaceTwo,
          targetPrincipalId: lastOwner,
          expectedTargetVersion: 1,
          nextRole: "viewer",
          nextStatus: "active",
          now,
          audit: {
            auditEventId: id(114),
            authenticationRefHash: digest("1"),
          },
        }),
      ).rejects.toMatchObject({ code: "authorization.last_owner" });

      const [siteAdministratorMembershipRows] = await authorizationPool.query<
        CountRow[]
      >(
        `SELECT COUNT(*) AS count
             FROM workspace_membership
            WHERE principal_id = ?`,
        [siteAdministrator],
      );
      expect(Number(siteAdministratorMembershipRows[0]?.count ?? 0)).toBe(0);
      const [lastOwnerRows] = await authorizationPool.query<RowDataPacket[]>(
        `SELECT role, status, version
           FROM workspace_membership
          WHERE id = ?`,
        [lastOwnerMembership],
      );
      expect(lastOwnerRows[0]).toMatchObject({
        role: "owner",
        status: "active",
        version: 1,
      });
    }, 30_000);
  },
);
