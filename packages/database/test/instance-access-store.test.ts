import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createInstanceAccessStore,
  type InstanceAccessStore,
} from "../src/runtime/instance-access-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const instanceId = "kanvas-test";
const principalId = id(1);
const now = new Date("2026-09-15T12:00:00.000Z");

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
    changedRows: 0,
  } as unknown as ResultSetHeader;
}

function harness(
  execute: (
    sql: string,
    parameters: readonly unknown[],
  ) => readonly [unknown, unknown] | Promise<readonly [unknown, unknown]>,
  generatedIds: readonly string[] = [],
): {
  readonly store: InstanceAccessStore;
  readonly statements: string[];
  readonly transactions: string[];
} {
  const statements: string[] = [];
  const transactions: string[] = [];
  const connection = {
    execute: vi.fn(
      async (
        sqlValue: string | { readonly sql: string },
        parameters: readonly unknown[] = [],
      ) => {
        const sql = typeof sqlValue === "string" ? sqlValue : sqlValue.sql;
        const normalized = sql.replaceAll(/\s+/gu, " ").trim();
        statements.push(normalized);
        return execute(normalized, parameters);
      },
    ),
    beginTransaction: () => {
      transactions.push("begin");
      return Promise.resolve();
    },
    commit: () => {
      transactions.push("commit");
      return Promise.resolve();
    },
    rollback: () => {
      transactions.push("rollback");
      return Promise.resolve();
    },
    release: () => {
      transactions.push("release");
    },
  } as unknown as PoolConnection;
  const pool = {
    getConnection: () => Promise.resolve(connection),
  } as unknown as Pool;
  let generatedIndex = 0;
  return {
    store: createInstanceAccessStore(pool, {
      instanceId,
      ...(generatedIds.length > 0
        ? { nextId: () => generatedIds[generatedIndex++] ?? id(999) }
        : {}),
    }),
    statements,
    transactions,
  };
}

function administratorRow() {
  return {
    principalId,
    principalStatus: "active",
    administratorStatus: "active",
    administratorVersion: 3,
  };
}

function authority() {
  return {
    instanceId,
    principalId,
    principalType: "human" as const,
    authenticationRefType: "session" as const,
    authenticationRefId: "better-auth-session",
    authorityType: "instance_administrator" as const,
    authorityId: principalId,
    authorityVersion: 3,
    authorizationModelVersion: 1 as const,
    trusted: true as const,
  };
}

describe("InstanceAccessStore", () => {
  it("defaults a missing Registration Policy to closed", async () => {
    const test = harness((sql) => {
      expect(sql).toContain("FROM instance_registration_policy");
      return [[], []];
    });

    await expect(test.store.readRegistrationPolicy()).resolves.toEqual({
      mode: "closed",
      emailPasswordEnabled: false,
      emailVerificationRequired: true,
      oidcProviderIds: [],
      version: 0,
    });
    await expect(
      test.store.registrationAllowed({
        kind: "oidc",
        providerId: "matrix",
      }),
    ).resolves.toBe(false);
    expect(test.transactions).toEqual([
      "begin",
      "commit",
      "release",
      "begin",
      "commit",
      "release",
    ]);
  });

  it("resolves only an active Instance Administrator", async () => {
    const test = harness((sql, parameters) => {
      expect(sql).toContain("FROM human_principal AS human");
      expect(parameters).toEqual(["auth-subject"]);
      return [[administratorRow()], []];
    });

    await expect(
      test.store.resolveAdministrator({
        authSubjectId: "auth-subject",
        sessionId: "session-id",
      }),
    ).resolves.toEqual({
      status: "authorized",
      scope: {
        ...authority(),
        authenticationRefId: "session-id",
      },
    });
  });

  it("creates an audited account-only OIDC policy from the implicit version", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (sql.includes("FROM instance_registration_policy")) {
        return [[], []];
      }
      return [result(), []];
    });

    await expect(
      test.store.updateRegistrationPolicy({
        authority: authority(),
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: false,
        oidcProviderIds: ["matrix"],
        now,
        audit: {
          auditEventId: id(2),
          authenticationRefHash: digest("a"),
          requestId: "request-1",
        },
      }),
    ).resolves.toEqual({
      mode: "account_only",
      emailPasswordEnabled: false,
      emailVerificationRequired: false,
      oidcProviderIds: ["matrix"],
      version: 1,
    });
    expect(
      test.statements.some((sql) =>
        sql.startsWith("INSERT INTO instance_registration_policy"),
      ),
    ).toBe(true);
    expect(
      test.statements.some((sql) => sql.startsWith("INSERT INTO audit_event")),
    ).toBe(true);
    expect(test.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("revokes unverified sessions when email verification is required again", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (sql.includes("FROM instance_registration_policy")) {
        return [
          [
            {
              mode: "account_only",
              emailPasswordEnabled: 1,
              emailVerificationRequired: 0,
              oidcProviderIds: [],
              version: 2,
            },
          ],
          [],
        ];
      }
      if (sql.startsWith("DELETE session")) return [result(2), []];
      return [result(), []];
    });

    await expect(
      test.store.updateRegistrationPolicy({
        authority: authority(),
        expectedVersion: 2,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: [],
        now,
        audit: {
          auditEventId: id(3),
          authenticationRefHash: digest("b"),
        },
      }),
    ).resolves.toEqual({
      mode: "account_only",
      emailPasswordEnabled: true,
      emailVerificationRequired: true,
      oidcProviderIds: [],
      version: 3,
    });
    expect(
      test.statements.some((sql) => sql.startsWith("DELETE session")),
    ).toBe(true);
  });

  it("rolls back a stale policy update", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (sql.includes("FROM instance_registration_policy")) {
        return [
          [
            {
              mode: "account_only",
              emailPasswordEnabled: 0,
              emailVerificationRequired: 1,
              oidcProviderIds: ["matrix"],
              version: 2,
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      test.store.updateRegistrationPolicy({
        authority: authority(),
        expectedVersion: 1,
        mode: "closed",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: [],
        now,
        audit: {
          auditEventId: id(2),
          authenticationRefHash: digest("a"),
        },
      }),
    ).rejects.toMatchObject({
      code: "instance_access.concurrent_change",
    });
    expect(test.transactions).toEqual(["begin", "rollback", "release"]);
  });

  it("lists site Principals with their Workspace memberships", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (sql.includes("FROM principal INNER JOIN human_principal")) {
        return [
          [
            {
              principalId: id(3),
              displayName: "New Member",
              email: "member@example.com",
              emailVerified: 1,
              status: "active",
              version: 2,
              isInstanceAdministrator: "0",
              registeredAt: now,
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [
          [
            {
              membershipId: id(6),
              principalId: id(3),
              workspaceId: id(5),
              role: "editor",
              status: "active",
              version: 1,
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM workspace INNER JOIN organization")) {
        return [
          [
            {
              organizationId: id(4),
              organizationName: "Kanvas",
              workspaceId: id(5),
              workspaceName: "Design",
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM invitation")) return [[], []];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(test.store.listAccessOverview(authority())).resolves.toEqual({
      principals: [
        {
          principalId: id(3),
          displayName: "New Member",
          email: "member@example.com",
          emailVerified: true,
          status: "active",
          version: 2,
          isInstanceAdministrator: false,
          memberships: [
            {
              membershipId: id(6),
              workspaceId: id(5),
              role: "editor",
              status: "active",
              version: 1,
            },
          ],
          registeredAt: now,
        },
      ],
      workspaces: [
        {
          organizationId: id(4),
          organizationName: "Kanvas",
          workspaceId: id(5),
          workspaceName: "Design",
        },
      ],
      invitations: [],
    });
  });

  it("atomically grants Organization and Workspace Membership from Instance authority", async () => {
    const organizationMembershipId = id(10);
    const workspaceMembershipId = id(11);
    const auditEventId = id(12);
    const test = harness(
      (sql) => {
        if (sql.includes("FROM instance_administrator AS administrator")) {
          return [[administratorRow()], []];
        }
        if (sql.includes("INNER JOIN auth_user") && sql.includes("FOR SHARE")) {
          return [[{ principalId: id(3), status: "active" }], []];
        }
        if (sql.includes("FROM workspace INNER JOIN organization")) {
          return [
            [
              {
                organizationId: id(4),
                organizationName: "Kanvas",
                workspaceId: id(5),
                workspaceName: "Design",
              },
            ],
            [],
          ];
        }
        if (sql.includes("FROM organization_membership")) return [[], []];
        if (sql.includes("FROM workspace_membership")) return [[], []];
        return [result(), []];
      },
      [organizationMembershipId, workspaceMembershipId, auditEventId],
    );

    await expect(
      test.store.grantWorkspaceAccess({
        authority: authority(),
        targetPrincipalId: id(3),
        assignments: [{ workspaceId: id(5), role: "editor" }],
        now,
        audit: {
          authenticationRefHash: digest("a"),
          requestId: "request-grant",
        },
      }),
    ).resolves.toEqual([
      {
        workspaceId: id(5),
        membershipId: workspaceMembershipId,
        role: "editor",
        status: "active",
        version: 1,
      },
    ]);
    expect(
      test.statements.some((sql) =>
        sql.startsWith("INSERT INTO organization_membership"),
      ),
    ).toBe(true);
    expect(
      test.statements.some((sql) =>
        sql.startsWith("INSERT INTO workspace_membership"),
      ),
    ).toBe(true);
    expect(
      test.statements.some((sql) => sql.startsWith("INSERT INTO audit_event")),
    ).toBe(true);
    expect(test.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("restores revoked Membership facts without creating duplicate identities", async () => {
    const auditEventId = id(20);
    const test = harness(
      (sql) => {
        if (sql.includes("FROM instance_administrator AS administrator")) {
          return [[administratorRow()], []];
        }
        if (sql.includes("INNER JOIN auth_user") && sql.includes("FOR SHARE")) {
          return [[{ principalId: id(3), status: "active" }], []];
        }
        if (sql.includes("FROM workspace INNER JOIN organization")) {
          return [
            [
              {
                organizationId: id(4),
                organizationName: "Kanvas",
                workspaceId: id(5),
                workspaceName: "Design",
              },
            ],
            [],
          ];
        }
        if (sql.includes("FROM organization_membership")) {
          return [
            [
              {
                id: id(6),
                role: "member",
                status: "revoked",
                version: 2,
              },
            ],
            [],
          ];
        }
        if (sql.includes("FROM workspace_membership")) {
          return [
            [
              {
                id: id(7),
                role: "viewer",
                status: "revoked",
                version: 3,
              },
            ],
            [],
          ];
        }
        return [result(), []];
      },
      [auditEventId],
    );

    await expect(
      test.store.grantWorkspaceAccess({
        authority: authority(),
        targetPrincipalId: id(3),
        assignments: [{ workspaceId: id(5), role: "reviewer" }],
        now,
        audit: { authenticationRefHash: digest("a") },
      }),
    ).resolves.toEqual([
      {
        workspaceId: id(5),
        membershipId: id(7),
        role: "reviewer",
        status: "active",
        version: 4,
      },
    ]);
    expect(
      test.statements.filter((sql) =>
        sql.startsWith("INSERT INTO organization_membership"),
      ),
    ).toHaveLength(0);
    expect(
      test.statements.filter((sql) =>
        sql.startsWith("INSERT INTO workspace_membership"),
      ),
    ).toHaveLength(0);
    expect(
      test.statements.some(
        (sql) =>
          sql.startsWith("UPDATE organization_membership") &&
          sql.includes("SET role = 'member'"),
      ),
    ).toBe(true);
    expect(
      test.statements.some((sql) =>
        sql.startsWith("UPDATE workspace_membership"),
      ),
    ).toBe(true);
  });

  it("does not bypass Workspace role and Last Owner management", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (sql.includes("INNER JOIN auth_user") && sql.includes("FOR SHARE")) {
        return [[{ principalId: id(3), status: "active" }], []];
      }
      if (sql.includes("FROM workspace INNER JOIN organization")) {
        return [
          [
            {
              organizationId: id(4),
              organizationName: "Kanvas",
              workspaceId: id(5),
              workspaceName: "Design",
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM organization_membership")) {
        return [
          [{ id: id(6), role: "owner", status: "active", version: 1 }],
          [],
        ];
      }
      if (sql.includes("FROM workspace_membership")) {
        return [
          [{ id: id(7), role: "owner", status: "active", version: 1 }],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      test.store.grantWorkspaceAccess({
        authority: authority(),
        targetPrincipalId: id(3),
        assignments: [{ workspaceId: id(5), role: "editor" }],
        now,
        audit: { authenticationRefHash: digest("a") },
      }),
    ).rejects.toMatchObject({ code: "instance_access.state_invalid" });
    expect(test.transactions).toEqual(["begin", "rollback", "release"]);
    expect(
      test.statements.some((sql) =>
        sql.startsWith("UPDATE workspace_membership"),
      ),
    ).toBe(false);
  });

  it("suspends an ordinary account with audited Instance authority", async () => {
    const targetPrincipalId = id(30);
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (
        sql.includes("FROM principal") &&
        sql.includes("WHERE id = ? AND principal_type = 'human'")
      ) {
        return [
          [
            {
              principalId: targetPrincipalId,
              status: "active",
              version: 4,
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM instance_administrator") &&
        sql.includes("principal_id = ?")
      ) {
        return [[], []];
      }
      if (sql.includes("membership.workspace_id AS workspaceId")) {
        return [[], []];
      }
      return [result(), []];
    });

    await expect(
      test.store.changePrincipalStatus({
        authority: authority(),
        targetPrincipalId,
        expectedVersion: 4,
        status: "suspended",
        now,
        audit: {
          auditEventId: id(31),
          authenticationRefHash: digest("d"),
        },
      }),
    ).resolves.toEqual({
      principalId: targetPrincipalId,
      status: "suspended",
      version: 5,
    });
    expect(
      test.statements.some((sql) => sql.startsWith("UPDATE principal")),
    ).toBe(true);
    expect(
      test.statements.some((sql) => sql.startsWith("INSERT INTO audit_event")),
    ).toBe(true);
  });

  it("keeps the last effective Workspace Owner active", async () => {
    const targetPrincipalId = id(40);
    const test = harness((sql) => {
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [[administratorRow()], []];
      }
      if (
        sql.includes("FROM principal") &&
        sql.includes("WHERE id = ? AND principal_type = 'human'")
      ) {
        return [
          [
            {
              principalId: targetPrincipalId,
              status: "active",
              version: 2,
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM instance_administrator") &&
        sql.includes("principal_id = ?")
      ) {
        return [[], []];
      }
      if (
        sql.includes("membership.role = 'owner'") &&
        sql.includes("membership.principal_id = ?")
      ) {
        return [[{ workspaceId: id(41) }], []];
      }
      if (
        sql.startsWith("SELECT id FROM workspace WHERE") &&
        sql.includes("FOR UPDATE")
      ) {
        return [[{ id: id(41) }], []];
      }
      if (
        sql.includes("membership.role = 'owner'") &&
        sql.includes("membership.workspace_id = ?")
      ) {
        return [[{ principalId: targetPrincipalId }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      test.store.changePrincipalStatus({
        authority: authority(),
        targetPrincipalId,
        expectedVersion: 2,
        status: "suspended",
        now,
        audit: {
          auditEventId: id(42),
          authenticationRefHash: digest("e"),
        },
      }),
    ).rejects.toMatchObject({ code: "instance_access.last_owner" });
    expect(test.transactions).toEqual(["begin", "rollback", "release"]);
    expect(
      test.statements.some((sql) => sql.startsWith("UPDATE principal")),
    ).toBe(false);
  });
});
