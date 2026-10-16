import { resolve } from "node:path";

import {
  authorizationModelVersion,
  workspacePermissionIds,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { DatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import { createAuthorizationStore } from "../src/runtime/authorization-store.js";
import {
  createInstanceBootstrapStore,
  digestInstanceSetupBinding,
  digestInstanceSetupToken,
  instanceSetupTokenPrefix,
} from "../src/runtime/instance-bootstrap-store.js";
import {
  createTeamStore,
  digestInvitationToken,
  invitationTokenPrefix,
} from "../src/runtime/team-store.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const setupToken = "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567";
const originalInvitationToken = `knv_invite_v1_${"a".repeat(43)}`;
const replacementInvitationToken = `knv_invite_v1_${"b".repeat(43)}`;
const instanceInvitationToken = `knv_invite_v1_${"c".repeat(43)}`;
const issuedAt = new Date("2026-08-05T12:00:00.000Z");
const acceptedAt = new Date("2026-08-05T12:05:00.000Z");

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function disposableDatabaseName(): string {
  const name = `kanvas_team_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

describe.skipIf(!integrationEnabled)(
  "TeamStore invitation recovery against disposable MySQL 8.0",
  () => {
    const databaseName = disposableDatabaseName();
    const instanceId = "team-store-integration";
    const ownerPrincipalId = id(9_000_001);
    const organizationId = id(9_000_002);
    const organizationMembershipId = id(9_000_003);
    const workspaceId = id(9_000_004);
    const ownerWorkspaceMembershipId = id(9_000_005);
    const invitedPrincipalId = id(9_000_006);
    let adminPool!: Pool;
    let pool!: Pool;

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
        });
      }
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${databaseName}\``);
        const inventory = await readMigrationInventory(
          resolve(import.meta.dirname, "../migrations"),
        );
        for (const migration of inventory) {
          await connection.query(migration.sql);
        }
      } finally {
        connection.release();
      }
      if (socketPath) {
        pool = createPool({
          socketPath,
          database: databaseName,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 6,
          timezone: "Z",
        });
      } else {
        if (!networkConfig) {
          throw new Error("Network database configuration is missing.");
        }
        pool = createPool({
          host: networkConfig.host,
          port: networkConfig.port,
          database: databaseName,
          user: networkConfig.user,
          password: networkConfig.password,
          connectionLimit: 6,
          timezone: "Z",
        });
      }
      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (?, 'ACTIVE', 1, 1, 'team integration',
                   NULL, 'integration-test', ?)`,
        [instanceId, issuedAt],
      );
      const bootstrap = createInstanceBootstrapStore(pool, {
        instanceId,
      });
      await bootstrap.issueSetupToken({
        setupTokenId: id(9_000_007),
        tokenPrefix: instanceSetupTokenPrefix(setupToken),
        tokenHash: digestInstanceSetupToken(setupToken),
        hashVersion: 1,
        bindingMode: "verified_email_hash",
        bindingHash: digestInstanceSetupBinding(
          "verified_email_hash",
          "owner@example.com",
        ),
        expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1_000),
        now: issuedAt,
        auditEventId: id(9_000_008),
      });
      await bootstrap.redeemSetupToken({
        tokenHash: digestInstanceSetupToken(setupToken),
        authSubjectId: "owner-auth-subject",
        verifiedEmail: "owner@example.com",
        principalId: ownerPrincipalId,
        organizationId,
        organizationMembershipId,
        organizationSlug: "kanvas-team",
        organizationName: "Kanvas Team",
        workspaceId,
        workspaceMembershipId: ownerWorkspaceMembershipId,
        workspaceSlug: "design",
        workspaceName: "Design",
        now: new Date(issuedAt.getTime() + 60_000),
        authenticationRefHash: digest("c"),
        requestId: "team-bootstrap",
        auditEventId: id(9_000_009),
      });
      await createAuthorizationStore(pool).resolveHumanPrincipal({
        principalId: invitedPrincipalId,
        authSubjectId: "invited-auth-subject",
        now: new Date(issuedAt.getTime() + 120_000),
        audit: {
          auditEventId: id(9_000_010),
          authenticationRefHash: digest("d"),
          requestId: "team-invited-principal",
        },
      });
      await pool.execute(
        `INSERT INTO instance_registration_policy (
           instance_id, mode, email_password_enabled,
           email_verification_required, oidc_provider_ids, version,
           updated_by_principal_id, created_at, updated_at
         ) VALUES (?, 'account_only', 1, 0, JSON_ARRAY(), 1, ?, ?, ?)`,
        [instanceId, ownerPrincipalId, issuedAt, issuedAt],
      );
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

    it("invites an operator, supersedes the old token, rejects the wrong identity, and replays acceptance without duplicate membership", async () => {
      const team = createTeamStore(pool, { instanceId });
      const authority: TrustedWorkspaceScope = {
        workspaceId,
        organizationId,
        principalId: ownerPrincipalId,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: "owner-session",
        authorityType: "human_membership",
        authorityId: ownerWorkspaceMembershipId,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: workspacePermissionIds,
        trusted: true,
      };
      const invitationId = id(9_000_011);
      await team.createWorkspaceInvitation({
        authority,
        workspaceId,
        invitationId,
        targetEmail: "Designer@Example.com",
        workspaceRole: "operator",
        tokenHash: digestInvitationToken(originalInvitationToken),
        tokenPrefix: invitationTokenPrefix(originalInvitationToken),
        expiresAt: new Date(issuedAt.getTime() + 24 * 60 * 60 * 1_000),
        now: new Date(issuedAt.getTime() + 180_000),
        audit: {
          auditEventId: id(9_000_012),
          authenticationRefHash: digest("e"),
          requestId: "create-invitation",
        },
      });

      const replacementInvitationId = id(9_000_013);
      await team.resendWorkspaceInvitation({
        authority,
        invitationId,
        expectedVersion: 1,
        replacementInvitationId,
        tokenHash: digestInvitationToken(replacementInvitationToken),
        tokenPrefix: invitationTokenPrefix(replacementInvitationToken),
        expiresAt: new Date(issuedAt.getTime() + 48 * 60 * 60 * 1_000),
        now: new Date(issuedAt.getTime() + 240_000),
        audit: {
          auditEventId: id(9_000_014),
          authenticationRefHash: digest("f"),
          requestId: "resend-invitation",
        },
      });

      await expect(
        team.resolveInvitation(
          digestInvitationToken(originalInvitationToken),
          acceptedAt,
        ),
      ).resolves.toMatchObject({
        invitationId,
        state: "revoked",
      });
      await expect(
        team.acceptWorkspaceInvitation({
          tokenHash: digestInvitationToken(originalInvitationToken),
          principalId: invitedPrincipalId,
          email: "designer@example.com",
          emailVerified: true,
          organizationMembershipId: id(9_000_015),
          workspaceMembershipId: id(9_000_016),
          now: acceptedAt,
          audit: {
            auditEventId: id(9_000_017),
            authenticationRefHash: digest("1"),
          },
        }),
      ).rejects.toMatchObject({
        code: "team.invitation_inactive",
      });
      await expect(
        team.acceptWorkspaceInvitation({
          tokenHash: digestInvitationToken(replacementInvitationToken),
          principalId: invitedPrincipalId,
          email: "someone-else@example.com",
          emailVerified: true,
          organizationMembershipId: id(9_000_018),
          workspaceMembershipId: id(9_000_019),
          now: acceptedAt,
          audit: {
            auditEventId: id(9_000_020),
            authenticationRefHash: digest("2"),
          },
        }),
      ).rejects.toMatchObject({
        code: "team.identity_mismatch",
      });

      const first = await team.acceptWorkspaceInvitation({
        tokenHash: digestInvitationToken(replacementInvitationToken),
        principalId: invitedPrincipalId,
        email: "DESIGNER@example.com",
        emailVerified: false,
        organizationMembershipId: id(9_000_021),
        workspaceMembershipId: id(9_000_022),
        now: acceptedAt,
        audit: {
          auditEventId: id(9_000_023),
          authenticationRefHash: digest("3"),
          requestId: "accept-invitation",
        },
      });
      expect(first).toMatchObject({
        invitationId: replacementInvitationId,
        membershipRole: "operator",
        replayed: false,
      });

      const replayed = await team.acceptWorkspaceInvitation({
        tokenHash: digestInvitationToken(replacementInvitationToken),
        principalId: invitedPrincipalId,
        email: "designer@example.com",
        emailVerified: true,
        organizationMembershipId: id(9_000_024),
        workspaceMembershipId: id(9_000_025),
        now: new Date(acceptedAt.getTime() + 1_000),
        audit: {
          auditEventId: id(9_000_026),
          authenticationRefHash: digest("4"),
          requestId: "accept-invitation-replay",
        },
      });
      expect(replayed).toMatchObject({
        invitationId: replacementInvitationId,
        membershipId: first.membershipId,
        membershipVersion: first.membershipVersion,
        replayed: true,
      });

      const [membershipRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM workspace_membership
         WHERE workspace_id = ?
           AND principal_id = ?`,
        [workspaceId, invitedPrincipalId],
      );
      expect(Number(membershipRows[0]?.count ?? 0)).toBe(1);
      const [acceptanceAuditRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE event_type = 'workspace.invitation.accepted'
           AND resource_id = ?`,
        [replacementInvitationId],
      );
      expect(Number(acceptanceAuditRows[0]?.count ?? 0)).toBe(1);
    });

    it("lets an Instance Administrator create and revoke without Workspace membership", async () => {
      const administratorPrincipalId = id(9_000_030);
      const invitationId = id(9_000_031);
      await pool.execute(
        `INSERT INTO principal
          (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [administratorPrincipalId, acceptedAt, acceptedAt],
      );
      await pool.execute(
        `INSERT INTO human_principal
          (principal_id, auth_subject_id, created_at)
         VALUES (?, 'instance-inviter', ?)`,
        [administratorPrincipalId, acceptedAt],
      );
      await pool.execute(
        `INSERT INTO instance_administrator
          (principal_id, status, version, created_at, updated_at)
         VALUES (?, 'active', 1, ?, ?)`,
        [administratorPrincipalId, acceptedAt, acceptedAt],
      );
      const team = createTeamStore(pool, { instanceId });
      const authority = {
        instanceId,
        principalId: administratorPrincipalId,
        principalType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefId: "instance-inviter-session",
        authorityType: "instance_administrator" as const,
        authorityId: administratorPrincipalId,
        authorityVersion: 1,
        authorizationModelVersion: 1 as const,
        trusted: true as const,
      };

      await expect(
        team.createWorkspaceInvitation({
          authority,
          workspaceId,
          invitationId,
          targetEmail: "new-member@example.com",
          workspaceRole: "reviewer",
          tokenHash: digestInvitationToken(instanceInvitationToken),
          tokenPrefix: invitationTokenPrefix(instanceInvitationToken),
          expiresAt: new Date(acceptedAt.getTime() + 24 * 60 * 60 * 1_000),
          now: acceptedAt,
          audit: {
            auditEventId: id(9_000_032),
            authenticationRefHash: digest("5"),
          },
        }),
      ).resolves.toMatchObject({ invitationId, version: 1 });
      await expect(
        team.revokeWorkspaceInvitation({
          authority,
          workspaceId,
          invitationId,
          expectedVersion: 1,
          reasonCode: "cancelled",
          now: new Date(acceptedAt.getTime() + 1_000),
          audit: {
            auditEventId: id(9_000_033),
            authenticationRefHash: digest("6"),
          },
        }),
      ).resolves.toMatchObject({ state: "revoked", version: 2 });

      const [membershipRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM workspace_membership
          WHERE principal_id = ?`,
        [administratorPrincipalId],
      );
      expect(Number(membershipRows[0]?.count ?? 0)).toBe(0);
      const [auditRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM audit_event
          WHERE resource_id = ?
            AND authority_type = 'instance_administrator'`,
        [invitationId],
      );
      expect(Number(auditRows[0]?.count ?? 0)).toBe(2);
    });
  },
);
