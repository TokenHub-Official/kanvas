import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserControlPlaneStoreError,
  createBrowserControlPlaneStore,
  type AuthorizeBrowserAttemptOutputOptions,
  type BrowserHumanAuthorityFacts,
  type ClaimNextBrowserAttemptOptions,
  type HeartbeatBrowserAttemptOptions,
  type RegisterBrowserExecutorSessionOptions,
} from "../src/runtime/browser-control-plane-store.js";
import { parseExecutionPlan } from "../src/runtime/execution-plan.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (value: string): string => `sha256:${value.repeat(64)}`;
const hash = (value: string): string => value.repeat(64);

const now = new Date("2026-07-27T21:00:00.000Z");
const leaseUntil = new Date("2026-07-27T21:06:00.000Z");
const executionDeadlineAt = new Date("2026-07-27T21:30:00.000Z");
const sessionExpiresAt = new Date("2026-07-27T22:00:00.000Z");

const ids = {
  workspace: identity(1),
  principal: identity(2),
  session: identity(3),
  runtimeRelease: identity(4),
  executorCapability: identity(5),
  implementation: identity(6),
  assignment: identity(7),
  claimedEvent: identity(8),
  transitionEvent: identity(9),
  capabilityRun: identity(10),
  attempt: identity(11),
  nodeRun: identity(12),
  workflowRun: identity(13),
  contractRevision: identity(14),
  binding: identity(15),
  runtimeAdapterRevision: identity(16),
} as const;

const identityInputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
  direction: "input" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "input" as const,
    path: Object.freeze([]),
  }),
});

const authority: BrowserHumanAuthorityFacts = {
  workspaceId: ids.workspace,
  createdByPrincipalId: ids.principal,
  authenticationRefHash: hash("a"),
  authorityVersion: 3,
};

const registration: RegisterBrowserExecutorSessionOptions = {
  sessionId: ids.session,
  authority,
  runtimeReleaseId: ids.runtimeRelease,
  runtimeReleaseDigest: digest("1"),
  capabilityManifestVersion: 4,
  capabilityManifestDigest: digest("2"),
  capabilities: [
    {
      id: ids.executorCapability,
      implementationRevisionId: ids.implementation,
      implementationDigest: digest("3"),
      adapterKey: "browser.remove-background",
      backend: "webgpu",
      probeProfileVersion: 2,
      probeResultDigest: digest("4"),
    },
  ],
  now,
  expiresAt: sessionExpiresAt,
};

const claimOptions: ClaimNextBrowserAttemptOptions = {
  sessionId: ids.session,
  authority,
  assignmentId: ids.assignment,
  claimedEventId: ids.claimedEvent,
  attemptGrantTokenHash: hash("b"),
  domainLeaseTokenHash: hash("c"),
  executionGeneration: 7,
  candidateLimit: 20,
  now,
  leaseUntil,
};

const heartbeatOptions: HeartbeatBrowserAttemptOptions = {
  workspaceId: ids.workspace,
  sessionId: ids.session,
  assignmentId: ids.assignment,
  attemptId: ids.attempt,
  attemptGrantTokenHash: hash("b"),
  domainLeaseTokenHash: hash("c"),
  attemptLeaseGeneration: 3,
  executionGeneration: 7,
  transitionEventId: ids.transitionEvent,
  now: new Date("2026-07-27T21:01:00.000Z"),
  leaseUntil,
};

const outputAuthorizationOptions: AuthorizeBrowserAttemptOutputOptions = {
  workspaceId: ids.workspace,
  sessionId: ids.session,
  assignmentId: ids.assignment,
  attemptId: ids.attempt,
  attemptGrantTokenHash: hash("b"),
  domainLeaseTokenHash: hash("c"),
  attemptLeaseGeneration: 3,
  executionGeneration: 7,
  now: new Date("2026-07-27T21:01:00.000Z"),
};

interface SqlHarness {
  readonly pool: Pool;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly beginTransaction: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

function sqlText(value: unknown): string {
  return String(value).replaceAll(/\s+/gu, " ").trim();
}

function createHarness(
  queryHandler: (sql: string, parameters: unknown) => unknown,
  executeHandler: (sql: string, parameters: unknown) => unknown,
): SqlHarness {
  const query = vi.fn(
    (sql: string, parameters: unknown): Promise<readonly [unknown]> =>
      Promise.resolve([queryHandler(sqlText(sql), parameters)]),
  );
  const execute = vi.fn(
    (sql: string, parameters: unknown): Promise<readonly [unknown]> =>
      Promise.resolve([executeHandler(sqlText(sql), parameters)]),
  );
  const beginTransaction = vi.fn((): Promise<void> => Promise.resolve());
  const commit = vi.fn((): Promise<void> => Promise.resolve());
  const rollback = vi.fn((): Promise<void> => Promise.resolve());
  const release = vi.fn();
  const connection = {
    execute,
    beginTransaction,
    commit,
    rollback,
    release,
  } as unknown as PoolConnection;
  const pool = {
    query,
    getConnection: vi.fn(() => Promise.resolve(connection)),
  } as unknown as Pool;
  return {
    pool,
    query,
    execute,
    beginTransaction,
    commit,
    rollback,
    release,
  };
}

function result(affectedRows = 1): Readonly<{ affectedRows: number }> {
  return Object.freeze({ affectedRows });
}

function capabilityRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: ids.capabilityRun,
    workspaceId: ids.workspace,
    invocationKind: "workflow",
    nodeRunId: ids.nodeRun,
    contractRevisionId: ids.contractRevision,
    bindingId: ids.binding,
    implementationRevisionId: ids.implementation,
    lifecycleStatus: "queued",
    currentAttemptId: ids.attempt,
    acceptedAttemptId: null,
    cancelRequestedAt: null,
    version: 4,
    ...overrides,
  };
}

function attemptRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: ids.attempt,
    workspaceId: ids.workspace,
    capabilityRunId: ids.capabilityRun,
    bindingId: ids.binding,
    routeCandidateIndex: 0,
    candidateAttemptNumber: 1,
    executionTarget: "browser",
    implementationRevisionId: ids.implementation,
    lifecycleStatus: "created",
    sideEffectState: "not_started",
    notBefore: new Date("2026-07-27T20:59:00.000Z"),
    leaseGeneration: 2,
    leaseTokenHash: null,
    leaseExpiresAt: null,
    executionDeadlineAt,
    cancelRequestedAt: null,
    version: 5,
    ...overrides,
  };
}

function sessionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: ids.session,
    workspaceId: ids.workspace,
    createdByPrincipalId: ids.principal,
    authenticationRefHash: authority.authenticationRefHash,
    authorityVersion: authority.authorityVersion,
    runtimeReleaseId: ids.runtimeRelease,
    runtimeReleaseDigest: registration.runtimeReleaseDigest,
    capabilityManifestVersion: registration.capabilityManifestVersion,
    capabilityManifestDigest: registration.capabilityManifestDigest,
    state: "active",
    lastSeenAt: now,
    expiresAt: sessionExpiresAt,
    terminalAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function executionPlan(adapterKey = "browser.remove-background"): unknown {
  return {
    schemaVersion: 1,
    topology: {
      schemaVersion: 1,
      key: "browser_claim_test",
      entryNodeKey: "remove_background",
      limits: { maxNodeRuns: 1, timeoutMs: 300_000 },
      nodes: [
        {
          key: "remove_background",
          kind: "invoke",
          capability: {
            contractId: "image.remove-background",
            revision: 1,
            canonicalDigest: digest("5"),
          },
          input: {},
          next: [],
        },
      ],
      outputs: {},
    },
    routes: [
      {
        nodeKey: "remove_background",
        contractRevisionId: ids.contractRevision,
        contractKey: "image.remove-background",
        contractRevision: 1,
        contractDigest: digest("5"),
        candidates: [
          {
            candidateIndex: 0,
            idempotencyMode: "keyed",
            bindingId: ids.binding,
            bindingVersion: 6,
            implementationRevisionId: ids.implementation,
            implementationDigest:
              registration.capabilities[0]?.implementationDigest,
            executionTarget: "browser",
            adapterKey,
            retryPolicy: {
              maxAttempts: 1,
              backoff: "fixed",
              initialDelayMs: 0,
              maxDelayMs: 0,
            },
            attemptTimeoutMs: 300_000,
            fallbackOn: [],
          },
        ],
      },
    ],
  };
}

function routeSnapshot(adapterKey = "browser.remove-background"): unknown {
  const plan = executionPlan(adapterKey) as {
    readonly routes: readonly unknown[];
  };
  return plan.routes[0];
}

function contextRow(
  snapshot: unknown = routeSnapshot(),
): Readonly<Record<string, unknown>> {
  const declared = registration.capabilities[0];
  if (!declared) {
    throw new Error("Missing test declaration.");
  }
  return {
    executorCapabilityId: declared.id,
    executorWorkspaceId: ids.workspace,
    executorSessionId: ids.session,
    executorImplementationRevisionId: ids.implementation,
    executorImplementationDigest: declared.implementationDigest,
    executorAdapterKey: declared.adapterKey,
    backend: declared.backend,
    probeProfileVersion: declared.probeProfileVersion,
    probeResultDigest: declared.probeResultDigest,
    invocationKind: "workflow",
    workflowRunId: ids.workflowRun,
    workflowWorkspaceId: ids.workspace,
    routeSnapshot: snapshot,
    nodeRunId: ids.nodeRun,
    nodeWorkspaceId: ids.workspace,
    nodeKey: "remove_background",
    nodeInput: JSON.stringify({ assetId: "asset-1" }),
    bindingId: ids.binding,
    bindingWorkspaceId: ids.workspace,
    bindingContractRevisionId: ids.contractRevision,
    bindingImplementationRevisionId: ids.implementation,
    bindingVersion: 6,
    bindingLifecycleStatus: "active",
    contractLifecycleStatus: "published",
    implementationRevisionId: ids.implementation,
    implementationWorkspaceId: ids.workspace,
    implementationDigest: declared.implementationDigest,
    implementationExecutionTarget: "browser",
    implementationAdapterKey: declared.adapterKey,
    implementationLifecycleStatus: "published",
    implementationContractRevisionId: ids.contractRevision,
    implementationConfiguration: {},
    inputMappingDigest: digestProviderValue(identityInputMapping),
    compiledInputMapping: identityInputMapping,
    runtimeAdapterRevisionId: ids.runtimeAdapterRevision,
    runtimeAdapterRevisionDigest: digest("6"),
    runtimeAdapterRevisionStatus: "published",
    runtimeAdapterExecutionTarget: "browser",
    runtimeAdapterKey: declared.adapterKey,
    runtimeAdapterDefinitionStatus: "active",
  };
}

function claimHarness(
  options: {
    readonly duplicateAssignmentKey?: string;
    readonly existingAssignment?: boolean;
    readonly capability?: Readonly<Record<string, unknown>>;
    readonly attempt?: Readonly<Record<string, unknown>>;
    readonly session?: Readonly<Record<string, unknown>>;
    readonly snapshot?: unknown;
    readonly context?: Readonly<Record<string, unknown>>;
  } = {},
): SqlHarness {
  return createHarness(
    () => [
      {
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
      },
    ],
    (sql) => {
      if (sql.includes("FROM capability_run")) {
        return [capabilityRow(options.capability)];
      }
      if (sql.includes("FROM capability_attempt")) {
        return [attemptRow(options.attempt)];
      }
      if (sql.includes("FROM capability_implementation_revision")) {
        const declared = registration.capabilities[0];
        if (!declared) {
          throw new Error("Missing test declaration.");
        }
        return [
          {
            id: ids.implementation,
            workspaceId: ids.workspace,
            lifecycleStatus: "published",
            executionTarget: "browser",
            adapterKey: declared.adapterKey,
            canonicalDigest: declared.implementationDigest,
            contractRevisionId: ids.contractRevision,
            runtimeAdapterRevisionId: ids.runtimeAdapterRevision,
          },
        ];
      }
      if (sql.includes("FROM browser_executor_session")) {
        return [sessionRow(options.session)];
      }
      if (
        sql.startsWith("SELECT id") &&
        sql.includes("FROM browser_attempt_assignment")
      ) {
        return options.existingAssignment ? [{ id: identity(99) }] : [];
      }
      if (
        sql.includes("FROM browser_executor_capability AS executor_capability")
      ) {
        return [
          {
            ...contextRow(options.snapshot),
            ...options.context,
          },
        ];
      }
      if (
        options.duplicateAssignmentKey &&
        sql.startsWith("INSERT INTO browser_attempt_assignment (")
      ) {
        throw Object.assign(
          new Error(
            `Duplicate entry for key '${options.duplicateAssignmentKey}'`,
          ),
          {
            code: "ER_DUP_ENTRY",
            errno: 1062,
            sqlMessage: `Duplicate entry for key 'browser_attempt_assignment.${options.duplicateAssignmentKey}'`,
          },
        );
      }
      if (sql.startsWith("UPDATE") || sql.startsWith("INSERT")) {
        return result();
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  );
}

interface HeartbeatHarnessOptions {
  readonly capability?: Readonly<Record<string, unknown>>;
  readonly attempt?: Readonly<Record<string, unknown>>;
  readonly assignment?: Readonly<Record<string, unknown>>;
  readonly session?: Readonly<Record<string, unknown>>;
}

function heartbeatHarness(options: HeartbeatHarnessOptions = {}): SqlHarness {
  const attempt = attemptRow({
    lifecycleStatus: "running",
    leaseGeneration: 3,
    leaseTokenHash: heartbeatOptions.domainLeaseTokenHash,
    leaseExpiresAt: new Date("2026-07-27T21:05:00.000Z"),
    executionDeadlineAt,
    ...options.attempt,
  });
  const assignment = {
    id: ids.assignment,
    workspaceId: ids.workspace,
    browserExecutorSessionId: ids.session,
    capabilityAttemptId: ids.attempt,
    attemptLeaseGeneration: 3,
    executionGeneration: 7,
    attemptGrantTokenHash: heartbeatOptions.attemptGrantTokenHash,
    state: "active",
    claimedAt: now,
    lastHeartbeatAt: now,
    leaseExpiresAt: new Date("2026-07-27T21:05:00.000Z"),
    ...options.assignment,
  };
  return createHarness(
    () => [
      {
        attemptId: ids.attempt,
        capabilityRunId: ids.capabilityRun,
      },
    ],
    (sql) => {
      if (sql.includes("FROM capability_run")) {
        return [
          capabilityRow({
            lifecycleStatus: "running",
            ...options.capability,
          }),
        ];
      }
      if (sql.includes("FROM capability_attempt")) {
        return [attempt];
      }
      if (sql.includes("FROM browser_attempt_assignment")) {
        return [assignment];
      }
      if (sql.includes("FROM browser_executor_session")) {
        return [sessionRow(options.session)];
      }
      if (sql.startsWith("UPDATE") || sql.startsWith("INSERT")) {
        return result();
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  );
}

describe("BrowserControlPlaneStore", () => {
  it("keeps browser claiming disabled by default without opening the database", async () => {
    const query = vi.fn();
    const getConnection = vi.fn();
    const store = createBrowserControlPlaneStore({
      query,
      getConnection,
    } as unknown as Pool);

    await expect(store.claimNextAttempt(claimOptions)).rejects.toMatchObject({
      code: "browser_control.claiming_disabled",
    });
    expect(query).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("registers only declarations that exactly match published browser implementations", async () => {
    const declared = registration.capabilities[0];
    if (!declared) {
      throw new Error("Missing test declaration.");
    }
    const harness = createHarness(
      () => [],
      (sql) => {
        if (sql.includes("FROM capability_implementation_revision")) {
          return [
            {
              id: ids.implementation,
              workspaceId: ids.workspace,
              lifecycleStatus: "published",
              executionTarget: "browser",
              adapterKey: declared.adapterKey,
              canonicalDigest: declared.implementationDigest,
            },
          ];
        }
        if (sql.startsWith("INSERT")) {
          return result();
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const store = createBrowserControlPlaneStore(harness.pool);

    const registered = await store.registerExecutorSession(registration);

    expect(registered).toEqual({
      sessionId: ids.session,
      workspaceId: ids.workspace,
      state: "active",
      expiresAt: sessionExpiresAt,
      capabilityIds: [ids.executorCapability],
    });
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.capabilityIds)).toBe(true);
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).includes("INSERT INTO browser_executor_session"),
      ),
    ).toBe(true);
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).includes("INSERT INTO browser_executor_capability"),
      ),
    ).toBe(true);
  });

  it("rejects implementation mismatches and raw environment facts during registration", async () => {
    const harness = createHarness(
      () => [],
      (sql) => {
        if (sql.includes("FROM capability_implementation_revision")) {
          return [
            {
              id: ids.implementation,
              workspaceId: ids.workspace,
              lifecycleStatus: "published",
              executionTarget: "browser",
              adapterKey: "different-adapter",
              canonicalDigest:
                registration.capabilities[0]?.implementationDigest,
            },
          ];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(
      store.registerExecutorSession(registration),
    ).rejects.toMatchObject({
      code: "browser_control.registration_mismatch",
    });
    expect(harness.rollback).toHaveBeenCalledTimes(1);

    const noDatabase = createBrowserControlPlaneStore({
      getConnection: vi.fn(),
    } as unknown as Pool);
    await expect(
      noDatabase.registerExecutorSession({
        ...registration,
        userAgent: "raw-browser-fingerprint",
      } as RegisterBrowserExecutorSessionOptions),
    ).rejects.toMatchObject({
      code: "browser_control.invalid_argument",
    });
    await expect(
      noDatabase.registerExecutorSession({
        ...registration,
        sessionId: ids.session.toLowerCase(),
      }),
    ).rejects.toMatchObject({
      code: "browser_control.invalid_argument",
    });
    await expect(
      noDatabase.registerExecutorSession({
        ...registration,
        capabilities: [],
      }),
    ).rejects.toMatchObject({
      code: "browser_control.invalid_argument",
    });
  });

  it("claims with strict lock order and exact execution-plan compatibility", async () => {
    expect(() => parseExecutionPlan(executionPlan())).not.toThrow();
    const harness = claimHarness();
    const store = createBrowserControlPlaneStore(harness.pool, {
      claimingEnabled: true,
    });

    const claimed = await store.claimNextAttempt(claimOptions);

    expect(claimed).toMatchObject({
      assignmentId: ids.assignment,
      sessionId: ids.session,
      workspaceId: ids.workspace,
      workflowRunId: ids.workflowRun,
      nodeRunId: ids.nodeRun,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      implementationRevisionId: ids.implementation,
      implementationDigest: registration.capabilities[0]?.implementationDigest,
      adapterKey: "browser.remove-background",
      leaseGeneration: 3,
      executionGeneration: 7,
      input: {
        assetId: "asset-1",
      },
    });
    expect(Object.isFrozen(claimed)).toBe(true);
    expect(claimed).not.toHaveProperty("attemptGrantToken");
    expect(claimed).not.toHaveProperty("attemptGrantTokenHash");
    expect(claimed).not.toHaveProperty("domainLeaseTokenHash");

    const lockSql = harness.execute.mock.calls
      .map(([sql]) => sqlText(sql))
      .filter((sql) => sql.includes("FOR UPDATE"));
    expect(
      lockSql.slice(0, 4).map((sql) => {
        if (sql.includes("FROM capability_run")) {
          return "capability";
        }
        if (sql.includes("FROM capability_attempt")) {
          return "attempt";
        }
        if (sql.includes("FROM capability_implementation_revision")) {
          return "implementation";
        }
        if (sql.includes("FROM browser_executor_session")) {
          return "session";
        }
        return "other";
      }),
    ).toEqual(["capability", "attempt", "implementation", "session"]);
    const executionContextSql = harness.execute.mock.calls
      .map(([sql]) => sqlText(sql))
      .find((sql) =>
        sql.includes("FROM browser_executor_capability AS executor_capability"),
      );
    expect(executionContextSql).toBeDefined();
    expect(executionContextSql).not.toContain("FOR UPDATE");
  });

  it("claims a retry while its capability remains running", async () => {
    const harness = claimHarness({
      capability: {
        lifecycleStatus: "running",
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool, {
      claimingEnabled: true,
    });

    await expect(store.claimNextAttempt(claimOptions)).resolves.toMatchObject({
      attemptId: ids.attempt,
      leaseGeneration: 3,
    });
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE capability_run"),
      ),
    ).toBe(false);
  });

  it("rejects incompatible snapshots and an existing attempt or session assignment", async () => {
    const incompatible = claimHarness({
      snapshot: routeSnapshot("browser.wrong-adapter"),
    });
    const incompatibleStore = createBrowserControlPlaneStore(
      incompatible.pool,
      {
        claimingEnabled: true,
      },
    );
    await expect(
      incompatibleStore.claimNextAttempt(claimOptions),
    ).resolves.toBeUndefined();
    expect(
      incompatible.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE capability_attempt"),
      ),
    ).toBe(false);

    const assigned = claimHarness({ existingAssignment: true });
    const assignedStore = createBrowserControlPlaneStore(assigned.pool, {
      claimingEnabled: true,
    });
    await expect(
      assignedStore.claimNextAttempt(claimOptions),
    ).resolves.toBeUndefined();
    expect(
      assigned.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("INSERT INTO browser_attempt_assignment"),
      ),
    ).toBe(false);
  });

  it("blocks a new browser claim when the pinned contract is revoked", async () => {
    const harness = claimHarness({
      context: {
        contractLifecycleStatus: "revoked",
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool, {
      claimingEnabled: true,
    });

    await expect(store.claimNextAttempt(claimOptions)).resolves.toBeUndefined();
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE capability_attempt"),
      ),
    ).toBe(false);
  });

  it("treats the pinned execution deadline as a half-open boundary", async () => {
    const harness = claimHarness({
      attempt: {
        executionDeadlineAt: now,
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool, {
      claimingEnabled: true,
    });

    await expect(store.claimNextAttempt(claimOptions)).resolves.toBeUndefined();
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE capability_attempt"),
      ),
    ).toBe(false);
  });

  it("caps the lease at session expiry without rewriting the pinned deadline and safely loses duplicate-key races", async () => {
    const cappedExpiry = new Date("2026-07-27T21:10:00.000Z");
    const capped = claimHarness({
      session: {
        expiresAt: cappedExpiry,
      },
    });
    const cappedStore = createBrowserControlPlaneStore(capped.pool, {
      claimingEnabled: true,
    });

    await expect(
      cappedStore.claimNextAttempt(claimOptions),
    ).resolves.toMatchObject({
      executionDeadlineAt,
    });
    const attemptUpdate = capped.execute.mock.calls.find(([sql]) =>
      sqlText(sql).startsWith("UPDATE capability_attempt"),
    );
    expect(attemptUpdate?.[1]).not.toContain(cappedExpiry);

    const duplicate = claimHarness({
      duplicateAssignmentKey: "uq_browser_attempt_assignment_attempt",
    });
    const duplicateStore = createBrowserControlPlaneStore(duplicate.pool, {
      claimingEnabled: true,
    });
    await expect(
      duplicateStore.claimNextAttempt(claimOptions),
    ).resolves.toBeUndefined();
    expect(duplicate.rollback).toHaveBeenCalledTimes(1);

    const tokenCollision = claimHarness({
      duplicateAssignmentKey: "uq_browser_attempt_assignment_grant_token",
    });
    const tokenCollisionStore = createBrowserControlPlaneStore(
      tokenCollision.pool,
      {
        claimingEnabled: true,
      },
    );
    await expect(
      tokenCollisionStore.claimNextAttempt(claimOptions),
    ).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
  });

  it("renews both leases monotonically without writing a heartbeat event", async () => {
    const harness = heartbeatHarness();
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(store.heartbeatAttempt(heartbeatOptions)).resolves.toBe(
      "renewed",
    );

    const sql = harness.execute.mock.calls.map(([statement]) =>
      sqlText(statement),
    );
    expect(
      sql
        .filter((statement) => statement.includes("FOR UPDATE"))
        .slice(0, 4)
        .map((statement) => {
          if (statement.includes("FROM capability_run")) {
            return "capability";
          }
          if (statement.includes("FROM capability_attempt")) {
            return "attempt";
          }
          if (statement.includes("FROM browser_attempt_assignment")) {
            return "assignment";
          }
          if (statement.includes("FROM browser_executor_session")) {
            return "session";
          }
          return "other";
        }),
    ).toEqual(["capability", "attempt", "assignment", "session"]);
    expect(
      sql.some((statement) =>
        statement.startsWith("INSERT INTO browser_attempt_assignment_event"),
      ),
    ).toBe(false);
  });

  it("authorizes output allocation without extending the attempt lease", async () => {
    const harness = heartbeatHarness();
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(
      store.authorizeAttemptOutput(outputAuthorizationOptions),
    ).resolves.toEqual({
      status: "authorized",
      actorId: ids.principal,
      expiresAt: executionDeadlineAt,
    });

    const sql = harness.execute.mock.calls.map(([statement]) =>
      sqlText(statement),
    );
    expect(
      sql
        .filter((statement) => statement.includes("FOR UPDATE"))
        .slice(0, 4)
        .map((statement) => {
          if (statement.includes("FROM capability_run")) {
            return "capability";
          }
          if (statement.includes("FROM capability_attempt")) {
            return "attempt";
          }
          if (statement.includes("FROM browser_attempt_assignment")) {
            return "assignment";
          }
          if (statement.includes("FROM browser_executor_session")) {
            return "session";
          }
          return "other";
        }),
    ).toEqual(["capability", "attempt", "assignment", "session"]);
    expect(sql.some((statement) => statement.startsWith("UPDATE"))).toBe(false);
  });

  it("projects cancellation and returns cancel_requested", async () => {
    const harness = heartbeatHarness({
      capability: {
        cancelRequestedAt: new Date("2026-07-27T21:00:30.000Z"),
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(store.heartbeatAttempt(heartbeatOptions)).resolves.toBe(
      "cancel_requested",
    );
    const sql = harness.execute.mock.calls.map(([statement]) =>
      sqlText(statement),
    );
    expect(
      sql.some(
        (statement) =>
          statement.startsWith("UPDATE browser_attempt_assignment") &&
          statement.includes("state = 'cancel_requested'"),
      ),
    ).toBe(true);
    expect(
      sql.some(
        (statement) =>
          statement.startsWith(
            "INSERT INTO browser_attempt_assignment_event",
          ) && statement.includes("'cancel_signaled'"),
      ),
    ).toBe(true);
  });

  it("converges a revoked session by fencing the assignment and compressing the attempt lease", async () => {
    const harness = heartbeatHarness({
      session: {
        state: "revoked",
        terminalAt: new Date("2026-07-27T21:00:30.000Z"),
        updatedAt: new Date("2026-07-27T21:00:30.000Z"),
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(store.heartbeatAttempt(heartbeatOptions)).resolves.toBe(
      "revoked",
    );
    const sql = harness.execute.mock.calls.map(([statement]) =>
      sqlText(statement),
    );
    expect(
      sql.some(
        (statement) =>
          statement.startsWith("UPDATE capability_attempt") &&
          statement.includes("LEAST(lease_expires_at, ?)"),
      ),
    ).toBe(true);
    expect(
      sql.some(
        (statement) =>
          statement.startsWith("UPDATE browser_attempt_assignment") &&
          statement.includes("state = 'revoked'"),
      ),
    ).toBe(true);
  });

  it("rejects stale execution generation without mutating facts", async () => {
    const harness = heartbeatHarness({
      assignment: {
        executionGeneration: 8,
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(store.heartbeatAttempt(heartbeatOptions)).resolves.toBe(
      "rejected",
    );
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE"),
      ),
    ).toBe(false);
  });

  it("treats an exactly expired lease as lost ownership", async () => {
    const harness = heartbeatHarness({
      attempt: {
        leaseExpiresAt: heartbeatOptions.now,
      },
      assignment: {
        leaseExpiresAt: heartbeatOptions.now,
      },
    });
    const store = createBrowserControlPlaneStore(harness.pool);

    await expect(store.heartbeatAttempt(heartbeatOptions)).resolves.toBe(
      "rejected",
    );
    expect(
      harness.execute.mock.calls.some(([sql]) =>
        sqlText(sql).startsWith("UPDATE"),
      ),
    ).toBe(false);
  });

  it("drains and revokes only the session row with compare-and-set state", async () => {
    const drainHarness = createHarness(
      () => [],
      (sql) => {
        if (sql.includes("FROM browser_executor_session")) {
          return [sessionRow()];
        }
        if (sql.startsWith("UPDATE browser_executor_session")) {
          return result();
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const drained = await createBrowserControlPlaneStore(
      drainHarness.pool,
    ).drainSession({
      sessionId: ids.session,
      authority,
      now: heartbeatOptions.now,
    });
    expect(drained).toEqual({
      sessionId: ids.session,
      state: "draining",
      changed: true,
    });
    expect(Object.isFrozen(drained)).toBe(true);

    const revokeHarness = createHarness(
      () => [],
      (sql) => {
        if (sql.includes("FROM browser_executor_session")) {
          return [sessionRow({ state: "draining" })];
        }
        if (sql.startsWith("UPDATE browser_executor_session")) {
          return result();
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const revoked = await createBrowserControlPlaneStore(
      revokeHarness.pool,
    ).revokeSession({
      sessionId: ids.session,
      authority,
      now: heartbeatOptions.now,
    });
    expect(revoked).toEqual({
      sessionId: ids.session,
      state: "revoked",
      changed: true,
    });
    expect(
      revokeHarness.execute.mock.calls.some(([sql]) =>
        /capability_(?:run|attempt)/u.test(sqlText(sql)),
      ),
    ).toBe(false);
  });

  it("maps native Browser output through the pinned immutable plan", async () => {
    const outputMapping = {
      schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
      direction: "output" as const,
      expression: {
        op: "object" as const,
        properties: [
          [
            "foreground",
            {
              op: "source" as const,
              root: "result" as const,
              path: ["image"],
            },
          ] as const,
        ],
      },
    };
    const harness = createHarness(
      (sql) => {
        if (sql.includes("FROM capability_implementation_revision")) {
          return [
            {
              implementationDigest:
                registration.capabilities[0]?.implementationDigest,
              implementationStatus: "published",
              adapterKey: "browser.remove-background",
              outputMappingDigest: digestProviderValue(outputMapping),
              compiledOutputMapping: outputMapping,
              runtimeAdapterStatus: "published",
              runtimeAdapterKey: "browser.remove-background",
              runtimeAdapterExecutionTarget: "browser",
              runtimeAdapterDefinitionStatus: "active",
            },
          ];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      (sql) => {
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );

    await expect(
      createBrowserControlPlaneStore(harness.pool).mapAttemptOutput({
        workspaceId: ids.workspace,
        implementationRevisionId: ids.implementation,
        implementationDigest: digest("3"),
        adapterKey: "browser.remove-background",
        adapterOutput: { image: "native-image" },
      }),
    ).resolves.toEqual({ foreground: "native-image" });
  });

  it("uses typed control-plane errors", () => {
    const error = new BrowserControlPlaneStoreError(
      "browser_control.state_conflict",
      "conflict",
    );
    expect(error.name).toBe("BrowserControlPlaneStoreError");
  });
});
