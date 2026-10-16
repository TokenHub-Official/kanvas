import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
  disposableIntegrationDatabase,
} from "./disposable-integration-database.js";
import { createInstanceAccessStore } from "../src/runtime/instance-access-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-09-15T12:00:00.000Z");

interface MembershipRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly role: string;
  readonly status: string;
  readonly version: number;
}

interface OrganizationMembershipProjection extends RowDataPacket {
  readonly organizationId: string;
  readonly role: string;
  readonly status: string;
  readonly version: number;
}

interface AuditDetailRow extends RowDataPacket {
  readonly details: unknown;
}

describe.skipIf(!disposableIntegrationDatabase)(
  "Instance Access Store against disposable MySQL 8.0",
  () => {
    const instanceId = "instance-access-integration";
    const adminAuthSubjectId = id(1);
    const targetAuthSubjectId = id(2);
    const administratorPrincipalId = id(3);
    const targetPrincipalId = id(4);
    const organizationId = id(5);
    const workspaceOneId = id(6);
    const workspaceTwoId = id(7);
    const organizationTwoId = id(11);
    const workspaceThreeId = id(12);
    let pool!: Pool;
    let generatedIds: string[];

    const authority: TrustedInstanceAdministratorScope = {
      instanceId,
      principalId: administratorPrincipalId,
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "instance-access-session",
      authorityType: "instance_administrator",
      authorityId: administratorPrincipalId,
      authorityVersion: 1,
      authorizationModelVersion: 1,
      trusted: true,
    };

    beforeAll(async () => {
      pool = createDisposableIntegrationPool(4);
      const fixtureConnection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(fixtureConnection);
      } finally {
        fixtureConnection.release();
      }
      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (?, 'ACTIVE', 1, 1, 'instance access integration',
                   NULL, 'integration-test', ?)`,
        [instanceId, now],
      );
      await pool.execute(
        `INSERT INTO auth_user
           (id, name, email, email_verified, image, created_at, updated_at)
         VALUES
           (?, 'Administrator', 'admin@example.com', 1, NULL, ?, ?),
           (?, 'New Member', 'member@example.com', 1, NULL, ?, ?)`,
        [adminAuthSubjectId, now, now, targetAuthSubjectId, now, now],
      );
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES
           (?, 'human', 'active', 1, ?, ?),
           (?, 'human', 'active', 1, ?, ?)`,
        [administratorPrincipalId, now, now, targetPrincipalId, now, now],
      );
      await pool.execute(
        `INSERT INTO human_principal (principal_id, auth_subject_id, created_at)
         VALUES (?, ?, ?), (?, ?, ?)`,
        [
          administratorPrincipalId,
          adminAuthSubjectId,
          now,
          targetPrincipalId,
          targetAuthSubjectId,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO instance_administrator
           (principal_id, status, version, created_at, updated_at)
         VALUES (?, 'active', 1, ?, ?)`,
        [administratorPrincipalId, now, now],
      );
      await pool.execute(
        `INSERT INTO organization
           (id, slug, name, status, version, created_at, updated_at)
         VALUES
           (?, 'instance-access', 'Instance Access', 'active', 1, ?, ?),
           (?, 'cross-organization', 'Cross Organization', 'active', 1, ?, ?)`,
        [organizationId, now, now, organizationTwoId, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace
           (id, organization_id, slug, name, status, version,
            created_at, updated_at)
         VALUES
           (?, ?, 'design', 'Design', 'active', 1, ?, ?),
           (?, ?, 'review', 'Review', 'active', 1, ?, ?),
           (?, ?, 'delivery', 'Delivery', 'active', 1, ?, ?)`,
        [
          workspaceOneId,
          organizationId,
          now,
          now,
          workspaceTwoId,
          organizationId,
          now,
          now,
          workspaceThreeId,
          organizationTwoId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO organization_membership
           (id, organization_id, principal_id, role, status, version,
            created_at, updated_at)
         VALUES
           (?, ?, ?, 'owner', 'active', 1, ?, ?),
           (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          id(8),
          organizationId,
          administratorPrincipalId,
          now,
          now,
          id(13),
          organizationTwoId,
          administratorPrincipalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO workspace_membership
           (id, organization_id, workspace_id, principal_id, role,
            status, version, created_at, updated_at)
         VALUES
           (?, ?, ?, ?, 'owner', 'active', 1, ?, ?),
           (?, ?, ?, ?, 'owner', 'active', 1, ?, ?),
           (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [
          id(9),
          organizationId,
          workspaceOneId,
          administratorPrincipalId,
          now,
          now,
          id(10),
          organizationId,
          workspaceTwoId,
          administratorPrincipalId,
          now,
          now,
          id(14),
          organizationTwoId,
          workspaceThreeId,
          administratorPrincipalId,
          now,
          now,
        ],
      );
    }, 30_000);

    afterAll(async () => {
      await pool?.end();
    });

    it("opens OIDC registration, grants multiple Workspaces, and restores revoked access", async () => {
      generatedIds = [
        id(20),
        id(21),
        id(22),
        id(23),
        id(24),
        id(25),
        id(26),
        id(27),
      ];
      const store = createInstanceAccessStore(pool, {
        instanceId,
        nextId: () => {
          const value = generatedIds.shift();
          if (!value) throw new Error("Integration ID inventory exhausted.");
          return value;
        },
      });
      await expect(
        store.updateRegistrationPolicy({
          authority,
          expectedVersion: 0,
          mode: "account_only",
          emailPasswordEnabled: true,
          emailVerificationRequired: true,
          oidcProviderIds: ["matrix"],
          now,
          audit: {
            auditEventId: id(19),
            authenticationRefHash: digest("a"),
          },
        }),
      ).resolves.toMatchObject({
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: ["matrix"],
        version: 1,
      });
      await expect(
        store.registrationAllowed({ kind: "email_password" }),
      ).resolves.toBe(true);
      await expect(
        store.registrationAllowed({ kind: "oidc", providerId: "matrix" }),
      ).resolves.toBe(true);
      await expect(
        store.registrationAllowed({ kind: "oidc", providerId: "other" }),
      ).resolves.toBe(false);
      const initialOverview = await store.listAccessOverview(authority);
      expect(initialOverview.principals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principalId: targetPrincipalId,
            memberships: [],
          }),
        ]),
      );
      expect(initialOverview.workspaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workspaceId: workspaceThreeId }),
          expect.objectContaining({ workspaceId: workspaceOneId }),
          expect.objectContaining({ workspaceId: workspaceTwoId }),
        ]),
      );

      await expect(
        store.grantWorkspaceAccess({
          authority,
          targetPrincipalId,
          assignments: [
            { workspaceId: workspaceOneId, role: "editor" },
            { workspaceId: workspaceTwoId, role: "reviewer" },
            { workspaceId: workspaceThreeId, role: "viewer" },
          ],
          now,
          audit: { authenticationRefHash: digest("b") },
        }),
      ).resolves.toHaveLength(3);
      const assignedOverview = await store.listAccessOverview(authority);
      expect(
        assignedOverview.principals.find(
          (principal) => principal.principalId === targetPrincipalId,
        )?.memberships,
      ).toHaveLength(3);

      await pool.execute(
        `UPDATE workspace_membership
         SET status = 'revoked', version = version + 1, updated_at = ?
         WHERE principal_id = ?`,
        [new Date(now.getTime() + 1_000), targetPrincipalId],
      );
      await pool.execute(
        `UPDATE organization_membership
         SET role = 'admin', status = 'revoked', version = version + 1,
             updated_at = ?
         WHERE principal_id = ?`,
        [new Date(now.getTime() + 1_000), targetPrincipalId],
      );
      generatedIds = [id(30), id(31), id(32)];
      await expect(
        store.grantWorkspaceAccess({
          authority,
          targetPrincipalId,
          assignments: [
            { workspaceId: workspaceOneId, role: "operator" },
            { workspaceId: workspaceTwoId, role: "viewer" },
            { workspaceId: workspaceThreeId, role: "admin" },
          ],
          now: new Date(now.getTime() + 2_000),
          audit: { authenticationRefHash: digest("c") },
        }),
      ).resolves.toHaveLength(3);

      const [membershipRows] = await pool.query<MembershipRow[]>(
        `SELECT workspace_id AS workspaceId, role, status, version
         FROM workspace_membership
         WHERE principal_id = ?
         ORDER BY workspace_id`,
        [targetPrincipalId],
      );
      expect(membershipRows).toEqual([
        {
          workspaceId: workspaceOneId,
          role: "operator",
          status: "active",
          version: 3,
        },
        {
          workspaceId: workspaceTwoId,
          role: "viewer",
          status: "active",
          version: 3,
        },
        {
          workspaceId: workspaceThreeId,
          role: "admin",
          status: "active",
          version: 3,
        },
      ]);

      const [organizationMembershipRows] = await pool.query<
        OrganizationMembershipProjection[]
      >(
        `SELECT organization_id AS organizationId, role, status, version
         FROM organization_membership
         WHERE principal_id = ?
         ORDER BY organization_id`,
        [targetPrincipalId],
      );
      expect(organizationMembershipRows).toEqual([
        {
          organizationId,
          role: "member",
          status: "active",
          version: 3,
        },
        {
          organizationId: organizationTwoId,
          role: "member",
          status: "active",
          version: 3,
        },
      ]);

      await expect(
        store.updateRegistrationPolicy({
          authority,
          expectedVersion: 1,
          mode: "closed",
          emailPasswordEnabled: false,
          emailVerificationRequired: true,
          oidcProviderIds: [],
          now: new Date(now.getTime() + 3_000),
          audit: {
            auditEventId: id(40),
            authenticationRefHash: digest("d"),
          },
        }),
      ).resolves.toEqual({
        mode: "closed",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: [],
        version: 2,
      });
      await expect(
        store.registrationAllowed({ kind: "email_password" }),
      ).resolves.toBe(false);
      await expect(
        store.registrationAllowed({ kind: "oidc", providerId: "matrix" }),
      ).resolves.toBe(false);

      const [auditRows] = await pool.query<AuditDetailRow[]>(
        `SELECT details
         FROM audit_event
         WHERE event_type = 'instance.registration_policy.updated'
         ORDER BY occurred_at, id`,
      );
      const auditDetails = auditRows.map((row) =>
        typeof row.details === "string"
          ? (JSON.parse(row.details) as unknown)
          : row.details,
      );
      expect(auditDetails).toEqual([
        expect.objectContaining({
          previousMode: "closed",
          nextMode: "account_only",
          previousDirectLocalMethodEnabled: false,
          nextDirectLocalMethodEnabled: true,
          previousOidcProviderIds: [],
          nextOidcProviderIds: ["matrix"],
          previousVersion: 0,
          nextVersion: 1,
        }),
        expect.objectContaining({
          previousMode: "account_only",
          nextMode: "closed",
          previousDirectLocalMethodEnabled: true,
          nextDirectLocalMethodEnabled: false,
          previousOidcProviderIds: ["matrix"],
          nextOidcProviderIds: [],
          previousVersion: 1,
          nextVersion: 2,
        }),
      ]);
    });
  },
);
