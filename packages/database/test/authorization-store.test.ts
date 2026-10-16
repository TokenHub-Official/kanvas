import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  createAuthorizationStore,
  revalidateTrustedWorkspaceScopeInTransaction,
  type AuthorizationStoreError,
  type ResolveHumanWorkspaceScopeOptions,
} from "../src/runtime/authorization-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-28T12:00:00.000Z");
const workspaceA = id(1);
const workspaceB = id(2);
const organizationId = id(3);
const principalId = id(4);
const membershipId = id(5);

function canonicalPermissionDigest(permissions: readonly string[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify([...permissions].sort()))
    .digest("hex")}`;
}

interface Harness {
  readonly pool: Pool;
  readonly connection: PoolConnection;
  readonly statements: string[];
  readonly parameters: readonly (readonly unknown[])[];
  readonly transactions: string[];
}

function createHarness(
  handler: (
    sql: string,
    parameters: readonly unknown[],
  ) => readonly [unknown, unknown] | Promise<readonly [unknown, unknown]>,
): Harness {
  const statements: string[] = [];
  const parameters: (readonly unknown[])[] = [];
  const transactions: string[] = [];
  const execute = vi.fn(
    async (
      sqlValue: string | { readonly sql: string },
      values: readonly unknown[] = [],
    ) => {
      const sql = typeof sqlValue === "string" ? sqlValue : sqlValue.sql;
      const normalized = sql.replaceAll(/\s+/gu, " ").trim();
      statements.push(normalized);
      parameters.push(values);
      return handler(normalized, values);
    },
  );
  const connection = {
    execute,
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
  return {
    pool,
    connection,
    statements,
    parameters,
    transactions,
  };
}

function humanScopeOptions(
  overrides: Partial<ResolveHumanWorkspaceScopeOptions> = {},
): ResolveHumanWorkspaceScopeOptions {
  return {
    authSubjectId: "better-auth-subject-1",
    sessionId: "better-auth-session-1",
    requestedWorkspaceId: workspaceA,
    requiredPermission: "asset.read",
    now,
    ...overrides,
  };
}

function humanScopeRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    principalId,
    principalStatus: "active",
    membershipId,
    membershipRole: "editor",
    membershipStatus: "active",
    membershipVersion: 3,
    organizationId,
    workspaceId: workspaceA,
    workspaceStatus: "active",
    ...overrides,
  };
}

function membershipManagementScope(
  actorPrincipalId: string,
  actorMembershipId: string,
  authorityVersion: number,
) {
  return {
    workspaceId: workspaceA,
    organizationId,
    principalId: actorPrincipalId,
    principalType: "human" as const,
    authenticationRefType: "session" as const,
    authenticationRefId: "membership-management-session",
    authorityType: "human_membership" as const,
    authorityId: actorMembershipId,
    authorityVersion,
    authorizationModelVersion: 1 as const,
    effectivePermissions: ["membership.manage"] as const,
    trusted: true as const,
  };
}

describe("Authorization Store", () => {
  it("lists only active Human Workspace contexts with role-derived permissions", async () => {
    const harness = createHarness((sql, parameters) => {
      if (
        sql.includes("FROM principal") &&
        sql.includes("INNER JOIN workspace_membership")
      ) {
        expect(parameters).toEqual([principalId]);
        return [
          [
            {
              organizationId,
              organizationName: "Kanvas",
              organizationVersion: 2,
              workspaceId: workspaceA,
              workspaceSlug: "visual-design",
              workspaceName: "视觉设计",
              workspaceVersion: 3,
              membershipId,
              membershipRole: "reviewer",
              membershipVersion: 4,
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).listHumanWorkspaceContexts({
        principalId,
      }),
    ).resolves.toEqual([
      {
        organizationId,
        organizationName: "Kanvas",
        organizationVersion: 2,
        workspaceId: workspaceA,
        workspaceSlug: "visual-design",
        workspaceName: "视觉设计",
        workspaceVersion: 3,
        membershipId,
        membershipRole: "reviewer",
        membershipVersion: 4,
        permissions: [
          "workspace.read",
          "canvas.read",
          "asset.read",
          "artifact.download",
          "library.read",
          "brand.read",
          "agent.read",
          "agent.run",
          "skill.read",
          "skill.use",
          "workflow.read",
          "approval.decide",
        ],
      },
    ]);
    expect(harness.statements[0]).toContain(
      "workspace_membership.status = 'active'",
    );
    expect(harness.statements[0]).toContain("organization.status = 'active'");
    expect(harness.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("does not turn a client Workspace ID into a Human scope without a matching Membership", async () => {
    const harness = createHarness((sql) => {
      if (sql.includes("FROM human_principal AS human")) {
        return [[], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).resolveHumanWorkspaceScope(
        humanScopeOptions({
          requestedWorkspaceId: workspaceB,
        }),
      ),
    ).resolves.toEqual({
      status: "not_found",
      reason: "workspace_not_visible",
    });
    expect(harness.statements).toHaveLength(1);
    expect(harness.statements[0]).toContain("membership.workspace_id = ?");
    expect(harness.parameters[0]).toEqual([
      workspaceB,
      "better-auth-subject-1",
    ]);
    expect(harness.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("re-reads Human Membership so suspension is effective on the next request", async () => {
    let reads = 0;
    const harness = createHarness((sql) => {
      if (sql.includes("FROM human_principal AS human")) {
        reads += 1;
        return [
          [
            humanScopeRow({
              membershipStatus: reads === 1 ? "active" : "suspended",
            }),
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createAuthorizationStore(harness.pool);

    const first = await store.resolveHumanWorkspaceScope(humanScopeOptions());
    expect(first).toMatchObject({
      status: "authorized",
      scope: {
        workspaceId: workspaceA,
        principalId,
        authorityId: membershipId,
        authorityVersion: 3,
        trusted: true,
      },
    });
    await expect(
      store.resolveHumanWorkspaceScope(humanScopeOptions()),
    ).resolves.toEqual({
      status: "forbidden",
      reason: "membership_inactive",
    });
    expect(reads).toBe(2);
  });

  it("rejects a stale Human scope when the transaction sees a new Membership version", async () => {
    const resolver = createHarness((sql) => {
      if (sql.includes("FROM human_principal AS human")) {
        return [[humanScopeRow()], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const resolved = await createAuthorizationStore(
      resolver.pool,
    ).resolveHumanWorkspaceScope(humanScopeOptions());
    if (resolved.status !== "authorized") {
      throw new Error("Expected an authorized scope.");
    }
    const transaction = createHarness((sql) => {
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [
          [
            humanScopeRow({
              membershipVersion: 4,
            }),
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      revalidateTrustedWorkspaceScopeInTransaction(
        transaction.connection,
        resolved.scope,
        "asset.read",
        now,
      ),
    ).rejects.toMatchObject({
      code: "authorization.scope_stale",
    });
    expect(transaction.statements[0]).toContain("FOR SHARE");
  });

  it("resolves Service scope only when token permissions are a valid subset of its Grant", async () => {
    let tokenRevokedAt: Date | null = null;
    const tokenHash = digest("a");
    const tokenId = id(20);
    const grantId = id(21);
    const servicePrincipalId = id(22);
    const grantPermissions = ["asset.read"] as const;
    const tokenPermissions = ["asset.read"] as const;
    const harness = createHarness((sql) => {
      if (sql.includes("FROM service_api_token AS token")) {
        return [
          [
            {
              tokenId,
              tokenPermissionSet: JSON.stringify(tokenPermissions),
              tokenPermissionDigest:
                canonicalPermissionDigest(tokenPermissions),
              tokenExpiresAt: new Date(now.getTime() + 1),
              tokenRevokedAt,
              grantId,
              grantPermissionSet: JSON.stringify(grantPermissions),
              grantPermissionDigest:
                canonicalPermissionDigest(grantPermissions),
              grantStatus: "active",
              grantVersion: 7,
              principalId: servicePrincipalId,
              principalStatus: "active",
              organizationId,
              serviceOrganizationId: organizationId,
              workspaceId: workspaceA,
              workspaceOrganizationId: organizationId,
              workspaceStatus: "active",
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = createAuthorizationStore(harness.pool);

    const authorized = await store.resolveServiceWorkspaceScope({
      tokenHash,
      requestedWorkspaceId: workspaceA,
      requiredPermission: "asset.read",
      now,
    });
    expect(authorized).toMatchObject({
      status: "authorized",
      scope: {
        principalType: "service",
        authenticationRefType: "service_api_token",
        authenticationRefId: tokenId,
        authorityId: grantId,
        authorityVersion: 7,
        effectivePermissions: ["asset.read"],
      },
    });
    expect(JSON.stringify(authorized)).not.toContain(tokenHash);
    await expect(
      store.resolveServiceWorkspaceScope({
        tokenHash,
        requestedWorkspaceId: workspaceB,
        requiredPermission: "asset.read",
        now,
      }),
    ).resolves.toMatchObject({
      status: "not_found",
      reason: "workspace_not_visible",
    });
    await expect(
      store.resolveServiceWorkspaceScope({
        tokenHash,
        requestedWorkspaceId: workspaceA,
        requiredPermission: "approval.decide",
        now,
      }),
    ).resolves.toMatchObject({
      status: "forbidden",
      reason: "service_action_disallowed",
    });
    expect(
      harness.statements.every(
        (sql) => !sql.includes("raw_token") && !sql.includes("plaintext_token"),
      ),
    ).toBe(true);
    if (authorized.status !== "authorized")
      throw new Error("Expected service scope");
    await expect(
      revalidateTrustedWorkspaceScopeInTransaction(
        harness.connection,
        authorized.scope,
        "asset.read",
        now,
      ),
    ).resolves.toBeUndefined();
    await expect(
      revalidateTrustedWorkspaceScopeInTransaction(
        harness.connection,
        authorized.scope,
        "asset.read",
        new Date(now.getTime() + 2),
      ),
    ).rejects.toMatchObject({ code: "authorization.forbidden" });
    tokenRevokedAt = now;
    await expect(
      revalidateTrustedWorkspaceScopeInTransaction(
        harness.connection,
        authorized.scope,
        "asset.read",
        now,
      ),
    ).rejects.toMatchObject({ code: "authorization.forbidden" });
  });

  it("fails closed when persisted Service token permissions exceed the Grant", async () => {
    const tokenHash = digest("f");
    const grantPermissions = ["asset.read"] as const;
    const tokenPermissions = ["asset.read", "asset.write"] as const;
    const harness = createHarness((sql) => {
      if (sql.includes("FROM service_api_token AS token")) {
        return [
          [
            {
              tokenId: id(23),
              tokenPermissionSet: JSON.stringify(tokenPermissions),
              tokenPermissionDigest:
                canonicalPermissionDigest(tokenPermissions),
              tokenExpiresAt: new Date(now.getTime() + 1),
              tokenRevokedAt: null,
              grantId: id(24),
              grantPermissionSet: JSON.stringify(grantPermissions),
              grantPermissionDigest:
                canonicalPermissionDigest(grantPermissions),
              grantStatus: "active",
              grantVersion: 1,
              principalId: id(25),
              principalStatus: "active",
              organizationId,
              serviceOrganizationId: organizationId,
              workspaceId: workspaceA,
              workspaceOrganizationId: organizationId,
              workspaceStatus: "active",
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).resolveServiceWorkspaceScope({
        tokenHash,
        requestedWorkspaceId: workspaceA,
        requiredPermission: "asset.read",
        now,
      }),
    ).resolves.toEqual({
      status: "forbidden",
      reason: "authorization_state_invalid",
    });
  });

  it("resolves an existing Human Principal idempotently without another Audit event", async () => {
    const harness = createHarness((sql) => {
      if (sql.includes("FROM human_principal AS human")) {
        return [
          [
            {
              principalId,
              principalStatus: "active",
              principalVersion: 2,
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).resolveHumanPrincipal({
        principalId: id(30),
        authSubjectId: "better-auth-subject-1",
        now,
        audit: {
          auditEventId: id(31),
          authenticationRefHash: digest("b"),
        },
      }),
    ).resolves.toEqual({
      principalId,
      status: "active",
      version: 2,
      created: false,
    });
    expect(harness.statements.some((sql) => sql.startsWith("INSERT"))).toBe(
      false,
    );
  });

  it("locks the Workspace and owner set and rejects removal of the last active Owner", async () => {
    const ownerPrincipalId = id(40);
    const ownerMembershipId = id(41);
    const harness = createHarness((sql) => {
      if (sql.includes("FROM workspace") && !sql.includes("membership")) {
        return [
          [
            {
              id: workspaceA,
              organizationId,
              status: "active",
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("principal_id = ?")
      ) {
        return [
          [
            {
              id: ownerMembershipId,
              organizationId,
              workspaceId: workspaceA,
              principalId: ownerPrincipalId,
              role: "owner",
              status: "active",
              version: 1,
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("role = 'owner'")
      ) {
        return [
          [
            {
              id: ownerMembershipId,
              principalId: ownerPrincipalId,
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).changeWorkspaceMembership({
        workspaceId: workspaceA,
        authority: membershipManagementScope(
          ownerPrincipalId,
          ownerMembershipId,
          1,
        ),
        targetPrincipalId: ownerPrincipalId,
        expectedTargetVersion: 1,
        nextRole: "viewer",
        nextStatus: "active",
        now,
        audit: {
          auditEventId: id(42),
          authenticationRefHash: digest("c"),
        },
      }),
    ).rejects.toMatchObject({
      code: "authorization.last_owner",
    });
    const workspaceLock = harness.statements.findIndex(
      (sql) => sql.includes("FROM workspace") && sql.includes("FOR UPDATE"),
    );
    const ownerLock = harness.statements.findIndex(
      (sql) => sql.includes("role = 'owner'") && sql.includes("FOR UPDATE"),
    );
    expect(workspaceLock).toBeGreaterThanOrEqual(0);
    expect(workspaceLock).toBeLessThan(ownerLock);
    expect(
      harness.statements.some((sql) =>
        sql.startsWith("INSERT INTO audit_event"),
      ),
    ).toBe(false);
    expect(harness.transactions).toEqual(["begin", "rollback", "release"]);
  });

  it("changes one of two Owners with CAS and a secret-free append-only Audit payload", async () => {
    const actorPrincipalId = id(50);
    const actorMembershipId = id(51);
    const targetPrincipalId = id(52);
    const targetMembershipId = id(53);
    const harness = createHarness((sql, parameters) => {
      if (sql.includes("FROM workspace") && !sql.includes("membership")) {
        return [
          [
            {
              id: workspaceA,
              organizationId,
              status: "active",
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("principal_id = ?")
      ) {
        const requestedPrincipal = parameters[1];
        return [
          [
            requestedPrincipal === actorPrincipalId
              ? {
                  id: actorMembershipId,
                  organizationId,
                  workspaceId: workspaceA,
                  principalId: actorPrincipalId,
                  role: "owner",
                  status: "active",
                  version: 4,
                }
              : {
                  id: targetMembershipId,
                  organizationId,
                  workspaceId: workspaceA,
                  principalId: targetPrincipalId,
                  role: "owner",
                  status: "active",
                  version: 6,
                },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("role = 'owner'")
      ) {
        return [
          [
            {
              id: actorMembershipId,
              principalId: actorPrincipalId,
            },
            {
              id: targetMembershipId,
              principalId: targetPrincipalId,
            },
          ],
          [],
        ];
      }
      if (
        sql.startsWith("UPDATE workspace_membership") ||
        sql.startsWith("INSERT INTO audit_event")
      ) {
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      createAuthorizationStore(harness.pool).changeWorkspaceMembership({
        workspaceId: workspaceA,
        authority: membershipManagementScope(
          actorPrincipalId,
          actorMembershipId,
          4,
        ),
        targetPrincipalId,
        expectedTargetVersion: 6,
        nextRole: "admin",
        nextStatus: "active",
        now,
        audit: {
          auditEventId: id(54),
          authenticationRefHash: digest("d"),
          requestId: "request-1",
          traceId: "trace-1",
        },
      }),
    ).resolves.toEqual({
      membershipId: targetMembershipId,
      role: "admin",
      status: "active",
      version: 7,
    });
    const auditIndex = harness.statements.findIndex((sql) =>
      sql.startsWith("INSERT INTO audit_event"),
    );
    expect(auditIndex).toBeGreaterThanOrEqual(0);
    const auditParameters = harness.parameters[auditIndex] ?? [];
    const auditDetails = auditParameters.find(
      (value) => typeof value === "string" && value.startsWith("{"),
    );
    expect(auditDetails).toBeTypeOf("string");
    expect(String(auditDetails)).not.toMatch(
      /(token|secret|password|credential|authorization|cookie|session|email)/iu,
    );
    expect(harness.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("lets an Instance Administrator change membership without becoming a member", async () => {
    const instanceAdministratorId = id(60);
    const targetPrincipalId = id(61);
    const targetMembershipId = id(62);
    const harness = createHarness((sql) => {
      if (sql.includes("FROM workspace") && !sql.includes("membership")) {
        return [[{ id: workspaceA, organizationId, status: "active" }], []];
      }
      if (sql.includes("FROM instance_administrator AS administrator")) {
        return [
          [
            {
              principalId: instanceAdministratorId,
              principalStatus: "active",
              administratorStatus: "active",
              administratorVersion: 2,
            },
          ],
          [],
        ];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("principal_id = ?")
      ) {
        return [
          [
            {
              id: targetMembershipId,
              organizationId,
              workspaceId: workspaceA,
              principalId: targetPrincipalId,
              role: "editor",
              status: "active",
              version: 3,
            },
          ],
          [],
        ];
      }
      if (sql.includes("role = 'owner'")) {
        return [[{ id: id(63), principalId: id(64) }], []];
      }
      return [{ affectedRows: 1 }, []];
    });
    const store = createAuthorizationStore(harness.pool, {
      instanceId: "kanvas-test",
    });

    await expect(
      store.changeWorkspaceMembership({
        authority: {
          instanceId: "kanvas-test",
          principalId: instanceAdministratorId,
          principalType: "human",
          authenticationRefType: "session",
          authenticationRefId: "instance-session",
          authorityType: "instance_administrator",
          authorityId: instanceAdministratorId,
          authorityVersion: 2,
          authorizationModelVersion: 1,
          trusted: true,
        },
        workspaceId: workspaceA,
        targetPrincipalId,
        expectedTargetVersion: 3,
        nextRole: "reviewer",
        nextStatus: "active",
        now,
        audit: {
          auditEventId: id(65),
          authenticationRefHash: digest("f"),
        },
      }),
    ).resolves.toEqual({
      membershipId: targetMembershipId,
      role: "reviewer",
      status: "active",
      version: 4,
    });
    expect(
      harness.statements.filter(
        (sql) =>
          sql.includes("FROM workspace_membership") &&
          sql.includes("principal_id = ?"),
      ),
    ).toHaveLength(1);
    const auditIndex = harness.statements.findIndex((sql) =>
      sql.startsWith("INSERT INTO audit_event"),
    );
    expect(harness.parameters[auditIndex]).toContain("instance_administrator");
  });

  it("adds one unverified account only while the Instance policy allows it", async () => {
    const actorPrincipalId = id(70);
    const actorMembershipId = id(71);
    const targetPrincipalId = id(72);
    const organizationMembershipId = id(73);
    const workspaceMembershipId = id(74);
    const generatedIds = [organizationMembershipId, workspaceMembershipId];
    const harness = createHarness((sql, parameters) => {
      if (sql.includes("FROM workspace") && !sql.includes("membership")) {
        return [[{ id: workspaceA, organizationId, status: "active" }], []];
      }
      if (
        sql.includes("FROM workspace_membership") &&
        sql.includes("principal_id = ?")
      ) {
        const requestedPrincipalId = parameters[1];
        return requestedPrincipalId === actorPrincipalId
          ? [
              [
                {
                  id: actorMembershipId,
                  organizationId,
                  workspaceId: workspaceA,
                  principalId: actorPrincipalId,
                  role: "admin",
                  status: "active",
                  version: 2,
                },
              ],
              [],
            ]
          : [[], []];
      }
      if (sql.includes("FROM instance_registration_policy")) {
        return [[{ emailVerificationRequired: 0 }], []];
      }
      if (sql.includes("FROM auth_user")) {
        expect(parameters).toEqual(["member@example.com", false]);
        return [[{ principalId: targetPrincipalId }], []];
      }
      if (sql.includes("FROM organization_membership")) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    const store = createAuthorizationStore(harness.pool, {
      instanceId: "kanvas-test",
      nextId: () => generatedIds.shift() ?? id(99),
    });

    await expect(
      store.addExistingWorkspaceMember({
        authority: membershipManagementScope(
          actorPrincipalId,
          actorMembershipId,
          2,
        ),
        workspaceId: workspaceA,
        email: "Member@Example.com",
        role: "editor",
        now,
        audit: {
          auditEventId: id(75),
          authenticationRefHash: digest("a"),
        },
      }),
    ).resolves.toEqual({
      membershipId: workspaceMembershipId,
      role: "editor",
      status: "active",
      version: 1,
    });
    expect(
      harness.statements.some((sql) =>
        sql.startsWith("INSERT INTO organization_membership"),
      ),
    ).toBe(true);
    expect(
      harness.statements.some((sql) =>
        sql.startsWith("INSERT INTO workspace_membership"),
      ),
    ).toBe(true);
  });
});

describe("Workspace membership batches", () => {
  it("rejects duplicate targets before opening a transaction", () => {
    const getConnection = vi.fn();
    const store = createAuthorizationStore({
      getConnection,
    } as unknown as Pool);
    const targetPrincipalId = id(90);
    const base = {
      workspaceId: workspaceA,
      authority: membershipManagementScope(principalId, membershipId, 1),
      targetPrincipalId,
      expectedTargetVersion: 1,
      nextRole: "editor" as const,
      nextStatus: "suspended" as const,
      now,
      audit: {
        auditEventId: id(91),
        authenticationRefHash: digest("e"),
      },
    };

    expect(() =>
      store.changeWorkspaceMemberships([
        base,
        {
          ...base,
          audit: {
            ...base.audit,
            auditEventId: id(92),
          },
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AuthorizationStoreError>>({
        code: "authorization.invalid_argument",
      }),
    );
    expect(getConnection).not.toHaveBeenCalled();
  });
});
