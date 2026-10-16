import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowReconcilerStore } from "../src/runtime/workflow-reconciler-store.js";

const now = new Date("2026-07-27T12:01:00.000Z");
const staleBefore = new Date("2026-07-27T12:00:45.000Z");
const oldDate = new Date("2026-07-27T12:00:00.000Z");
const executionDeadlineAt = new Date("2026-07-27T12:05:00.000Z");
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

const retryPolicy = Object.freeze({
  maxAttempts: 2,
  backoff: "fixed",
  initialDelayMs: 0,
  maxDelayMs: 0,
});

function candidate(
  candidateIndex: number,
  executionTarget: "browser" | "provider" | "worker",
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const suffix = executionTarget;
  return {
    candidateIndex,
    bindingId: `binding-${suffix}`,
    bindingVersion: 1,
    implementationRevisionId: `implementation-${suffix}`,
    implementationDigest: digest(["b", "c", "d"][candidateIndex] ?? "e"),
    executionTarget,
    adapterKey: `${executionTarget}.test`,
    idempotencyMode: "intrinsic",
    retryPolicy,
    attemptTimeoutMs: 120_000,
    fallbackOn:
      executionTarget === "browser"
        ? ["browser_executor_fenced", "browser_lease_expired"]
        : [],
    ...(executionTarget === "provider"
      ? {
          providerRoute: {
            providerProtocolVersion: 1,
            providerKey: "test",
            apiSurface: "responses.v1",
            providerEndpointId: id(1),
            credentialIdentityId: id(2),
            credentialIdentityEpoch: 1,
            modelDeploymentId: id(3),
            pricingRevisionId: id(4),
            pinnedSecretVersionId: id(101),
            credentialIdentityDigest: digest("f"),
            instancePolicyRevisionId: id(102),
            workspacePolicyRevisionId: id(103),
            routePolicyRevisionId: id(104),
            modelProfileRevisionId: id(105),
            budgetAccountId: id(106),
            routingMode: "kanvas_fixed",
            executionTransparency: "full",
            maximumCharge: { currencyCode: "USD", amount: "1" },
            routeCandidateDigest: digest("e"),
            requestScopeDigest: digest("f"),
            queryMode: "client_request_id",
            notFoundIsAuthoritative: true,
          },
        }
      : {}),
    ...overrides,
  };
}

function executionPlan(
  candidates: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    workflowRevision: {
      id: id(5),
      canonicalDigest: digest("a"),
    },
    topology: {
      schemaVersion: 1,
      key: "test",
      entryNodeKey: "invoke",
      limits: { maxNodeRuns: 1, timeoutMs: 300_000 },
      nodes: [
        {
          key: "invoke",
          kind: "invoke",
          capability: {
            contractId: "image.test",
            revision: 1,
            canonicalDigest: digest("a"),
          },
          input: {},
          next: [],
        },
      ],
      outputs: {},
    },
    routes: [
      {
        nodeKey: "invoke",
        contractRevisionId: "contract",
        contractKey: "image.test",
        contractRevision: 1,
        contractDigest: digest("a"),
        candidates,
      },
    ],
  };
}

function routeSnapshot(
  candidates: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  const routes = executionPlan(candidates).routes;
  if (!Array.isArray(routes) || routes.length !== 1) {
    throw new Error("Test execution plan must contain exactly one route.");
  }
  return routes[0] as Readonly<Record<string, unknown>>;
}

function workflowExecutionContext(
  candidates: readonly Readonly<Record<string, unknown>>[],
  executionDeadlineAt: Date | null = null,
): Readonly<Record<string, unknown>> {
  return {
    invocationKind: "workflow",
    workflowRunId: "workflow-run",
    nodeRunId: "node-run",
    routeSnapshot: routeSnapshot(candidates),
    executionDeadlineAt,
  };
}

function authorityRow(
  routeCandidate: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    bindingId: routeCandidate.bindingId,
    bindingWorkspaceId: "workspace",
    bindingContractRevisionId: "contract",
    bindingLifecycleStatus: "active",
    contractDigest: digest("a"),
    contractLifecycleStatus: "published",
    implementationRevisionId: routeCandidate.implementationRevisionId,
    implementationWorkspaceId: "workspace",
    executionTarget: routeCandidate.executionTarget,
    adapterKey: routeCandidate.adapterKey,
    implementationDigest: routeCandidate.implementationDigest,
    implementationLifecycleStatus: "published",
    ...overrides,
  };
}

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
  } as ResultSetHeader;
}

function transactionPool(execute: ReturnType<typeof vi.fn>): Pool {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute,
  } as unknown as PoolConnection;
  return {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool;
}

describe("WorkflowReconcilerStore cancellation recovery", () => {
  it("scans cancellation deadlines and excludes cancelled dispatch work", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [{ capabilityRunId: "cap-expired", attemptId: "attempt-expired" }],
      ])
      .mockResolvedValueOnce([
        [
          {
            workflowRunId: "workflow-terminal",
            nodeRunId: "node-terminal",
            capabilityRunId: "cap-terminal",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [{ capabilityRunId: "cap-dispatch", attemptId: "attempt-dispatch" }],
      ])
      .mockResolvedValueOnce([[{ id: "workflow-cancel" }]])
      .mockResolvedValueOnce([[{ id: "workflow-wakeup" }]]);
    const store = createWorkflowReconcilerStore(
      {
        query,
      } as unknown as Pool,
      { instanceId: "kanvas-test" },
    );

    await expect(
      store.scanCandidates({
        now,
        staleBefore,
        batchSize: 10,
      }),
    ).resolves.toEqual([
      {
        kind: "expired_attempt",
        capabilityRunId: "cap-expired",
        attemptId: "attempt-expired",
      },
      {
        kind: "capability_terminal",
        workflowRunId: "workflow-terminal",
        nodeRunId: "node-terminal",
        capabilityRunId: "cap-terminal",
      },
      {
        kind: "workflow_cancel",
        workflowRunId: "workflow-cancel",
      },
      {
        kind: "attempt_dispatch",
        capabilityRunId: "cap-dispatch",
        attemptId: "attempt-dispatch",
      },
      {
        kind: "workflow_wakeup",
        workflowRunId: "workflow-wakeup",
      },
    ]);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("attempt.cancel_deadline_at <= ?");
    expect(statements[0]).toContain("attempt.lease_expires_at <= ?");
    expect(statements[0]).toContain("capability.cancel_deadline_at <= ?");
    expect(statements[0]).toContain("attempt.execution_target <> 'provider'");
    expect(statements[1]).toContain("'cancelled'");
    expect(statements[1]).toContain("'capability.run.cancelled'");
    expect(statements[2]).toContain("capability.cancel_requested_at IS NULL");
    expect(statements[2]).toContain("attempt.cancel_requested_at IS NULL");
    expect(statements[2]).toContain(
      "attempt.execution_target IN ('worker', 'provider')",
    );
    expect(statements[3]).toContain(
      "event.message_type = 'workflow.cancel.requested'",
    );
  });

  it("settles a running attempt at its cancel deadline without retrying", async () => {
    const cancelRequestedAt = new Date("2026-07-27T12:00:20.000Z");
    const cancelDeadlineAt = new Date("2026-07-27T12:00:50.000Z");
    const capability = {
      id: "capability-run",
      workspaceId: "workspace",
      nodeRunId: "node-run",
      invocationKind: "workflow",
      lifecycleStatus: "running",
      currentAttemptId: "attempt",
      acceptedAttemptId: null,
      implementationRevisionId: "implementation",
      version: 4,
      cancelRequestedAt,
      cancelDeadlineAt,
      updatedAt: oldDate,
    };
    const attempt = {
      id: "attempt",
      lifecycleStatus: "running",
      attemptNumber: 1,
      executionTarget: "worker",
      implementationRevisionId: "implementation",
      sideEffectState: "started",
      notBefore: oldDate,
      leaseExpiresAt: new Date("2026-07-27T12:02:00.000Z"),
      cancelRequestedAt,
      cancelDeadlineAt,
      version: 3,
      updatedAt: oldDate,
    };
    const insertedEvents: Array<{
      readonly sql: string;
      readonly parameters: readonly unknown[];
    }> = [];
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [[workflowExecutionContext([candidate(0, "worker")])]];
        }
        if (sql.includes("FROM capability_run")) {
          return [[{ ...capability }]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[{ ...attempt }]];
        }
        if (sql.includes("FROM capability_implementation_revision")) {
          return [[{ executionTarget: "worker" }]];
        }
        if (sql.includes("UPDATE capability_attempt")) {
          attempt.lifecycleStatus = "abandoned";
          return [result()];
        }
        if (sql.includes("UPDATE capability_run")) {
          capability.lifecycleStatus = "cancelled";
          return [result()];
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          insertedEvents.push({
            sql,
            parameters: parameters ?? [],
          });
          return [result()];
        }
        throw new Error(`Unexpected SQL in cancellation test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
    });
    const options = {
      now,
      staleBefore,
      executionGeneration: 7,
      outboxEventId: "cancelled-event",
      nextAttemptId: "must-not-be-used",
      browserAssignmentEventId: "unused-browser-assignment-event",
    };

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", options),
    ).resolves.toBe("capability_cancelled");
    expect(attempt.lifecycleStatus).toBe("abandoned");
    expect(capability.lifecycleStatus).toBe("cancelled");
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]?.parameters).toContain("capability.run.cancelled");
    expect(insertedEvents[0]?.parameters.join(" ")).toContain(
      "reconciler.cancel_deadline_expired",
    );
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO capability_attempt"),
      ),
    ).toBe(false);

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        ...options,
        outboxEventId: "duplicate-event",
      }),
    ).resolves.toBe("noop");
    expect(insertedEvents).toHaveLength(1);
  });

  it("rebuilds missing workflow cancellation and cancelled terminal events", async () => {
    const workflow = {
      id: "workflow-run",
      workspaceId: "workspace",
      lifecycleStatus: "cancelling",
      version: 2,
      cancelRequestedAt: oldDate,
      cancelDeadlineAt: now,
      updatedAt: oldDate,
    };
    const capability = {
      id: "capability-run",
      workspaceId: "workspace",
      nodeRunId: "node-run",
      lifecycleStatus: "cancelled",
      currentAttemptId: "attempt",
      acceptedAttemptId: null,
      implementationRevisionId: "implementation",
      version: 5,
      cancelRequestedAt: oldDate,
      cancelDeadlineAt: now,
      updatedAt: oldDate,
    };
    const insertedEvents: string[] = [];
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM workflow_run")) {
          return [[{ ...workflow }]];
        }
        if (sql.includes("FROM node_run")) {
          return [[{ id: "node-run" }]];
        }
        if (sql.includes("FROM capability_run")) {
          return [[{ ...capability }]];
        }
        if (sql.includes("FROM outbox_event")) {
          return [[]];
        }
        if (sql.includes("UPDATE workflow_run")) {
          workflow.version += 1;
          workflow.updatedAt = now;
          return [result()];
        }
        if (sql.includes("UPDATE capability_run")) {
          capability.version += 1;
          capability.updatedAt = now;
          return [result()];
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          insertedEvents.push(`${sql} ${(parameters ?? []).join(" ")}`);
          return [result()];
        }
        throw new Error(`Unexpected SQL in outbox repair test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
    });
    const common = {
      now,
      staleBefore,
      executionGeneration: 7,
      outboxEventId: "workflow-cancel-event",
    };

    await expect(
      store.reconcileWorkflowCancellation("workflow-run", common),
    ).resolves.toBe("workflow_cancel_rebuilt");

    workflow.updatedAt = oldDate;
    await expect(
      store.reconcileCapabilityTerminal(
        "workflow-run",
        "node-run",
        "capability-run",
        {
          ...common,
          outboxEventId: "capability-cancelled-event",
        },
      ),
    ).resolves.toBe("capability_terminal_rebuilt");

    expect(insertedEvents).toHaveLength(2);
    expect(insertedEvents[0]).toContain("workflow.cancel.requested");
    expect(insertedEvents[1]).toContain("capability.run.cancelled");
  });
});

describe("WorkflowReconcilerStore execution-target dispatch", () => {
  const capability = {
    id: "capability-run",
    workspaceId: "workspace",
    nodeRunId: "node-run",
    invocationKind: "workflow",
    contractRevisionId: "contract",
    bindingId: "binding-provider",
    lifecycleStatus: "queued",
    currentAttemptId: "attempt",
    acceptedAttemptId: null,
    implementationRevisionId: "implementation",
    version: 1,
    cancelRequestedAt: null,
    cancelDeadlineAt: null,
    updatedAt: oldDate,
  };

  it("rebuilds a provider dispatch with an explicit canonical target", async () => {
    const providerCandidate = candidate(0, "provider");
    let authorityContractDigest = digest("9");
    const attempt = {
      id: "attempt",
      workspaceId: "workspace",
      lifecycleStatus: "created",
      attemptNumber: 1,
      bindingId: "binding-provider",
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      transitionKind: "initial",
      transitionReasonCode: "workflow.start.initial",
      executionTarget: "provider",
      implementationRevisionId: "implementation-provider",
      sideEffectState: "not_started",
      notBefore: oldDate,
      leaseGeneration: 0,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      executionDeadlineAt,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      retryDisposition: null,
      error: null,
      version: 1,
      updatedAt: oldDate,
    };
    const insertedPayloads: Readonly<Record<string, unknown>>[] = [];
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [[workflowExecutionContext([providerCandidate])]];
        }
        if (sql.includes("FROM capability_run")) {
          return [[{ ...capability }]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[{ ...attempt }]];
        }
        if (sql.includes("FROM outbox_event")) {
          return [[]];
        }
        if (sql.includes("FROM capability_binding AS binding")) {
          return [
            [
              authorityRow(providerCandidate, {
                contractDigest: authorityContractDigest,
              }),
            ],
          ];
        }
        if (sql.includes("UPDATE capability_attempt")) {
          return [result()];
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          insertedPayloads.push(
            JSON.parse(String(parameters?.[6])) as Readonly<
              Record<string, unknown>
            >,
          );
          return [result()];
        }
        throw new Error(`Unexpected SQL in provider dispatch test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
      enabledExecutionTargets: ["provider"],
    });

    await expect(
      store.reconcileAttemptDispatch("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "must-not-be-written",
      }),
    ).rejects.toThrow(/route identity/u);
    expect(insertedPayloads).toHaveLength(0);

    authorityContractDigest = digest("a");
    await expect(
      store.reconcileAttemptDispatch("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "dispatch-event",
      }),
    ).resolves.toBe("attempt_dispatch_rebuilt");
    expect(insertedPayloads).toEqual([
      expect.objectContaining({
        workflowRunId: "workflow-run",
        nodeRunId: "node-run",
        capabilityRunId: "capability-run",
        attemptId: "attempt",
        executionTarget: "provider",
        expectedGeneration: 7,
      }),
    ]);
  });

  it("does not rebuild a queue dispatch for a browser attempt", async () => {
    const attempt = {
      id: "attempt",
      lifecycleStatus: "created",
      attemptNumber: 1,
      executionTarget: "browser",
      implementationRevisionId: "implementation",
      sideEffectState: "not_started",
      notBefore: oldDate,
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      version: 1,
      updatedAt: oldDate,
    };
    const execute = vi.fn(async (sqlValue: unknown) => {
      await Promise.resolve();
      const sql = String(sqlValue);
      if (sql.includes("FROM capability_run")) {
        return [[{ ...capability }]];
      }
      if (sql.includes("FROM capability_attempt")) {
        return [[attempt]];
      }
      throw new Error(`Browser dispatch attempted an unexpected query: ${sql}`);
    });
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
    });

    await expect(
      store.reconcileAttemptDispatch("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "unused-event",
      }),
    ).resolves.toBe("noop");
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO outbox_event"),
      ),
    ).toBe(false);
  });

  it("retries a created worker attempt at its fixed deadline on the same candidate", async () => {
    const workerCandidate = candidate(0, "worker");
    const queuedCapability = {
      ...capability,
      bindingId: "binding-worker",
      implementationRevisionId: "implementation-worker",
    };
    const attempt = {
      id: "attempt",
      workspaceId: "workspace",
      lifecycleStatus: "created",
      attemptNumber: 1,
      bindingId: "binding-worker",
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      transitionKind: "initial",
      transitionReasonCode: "workflow.start.initial",
      executionTarget: "worker",
      implementationRevisionId: "implementation-worker",
      sideEffectState: "not_started",
      notBefore: oldDate,
      leaseGeneration: 0,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      executionDeadlineAt: now,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      retryDisposition: null,
      error: null,
      version: 1,
      updatedAt: oldDate,
    };
    const insertedAttempts: unknown[][] = [];
    let workflowExecutionDeadline = new Date(now.getTime() + 60_000);
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [
            [
              workflowExecutionContext(
                [workerCandidate],
                workflowExecutionDeadline,
              ),
            ],
          ];
        }
        if (sql.includes("FROM capability_run")) {
          return [[queuedCapability]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[attempt]];
        }
        if (sql.includes("FROM instance_runtime_state")) {
          return [
            [
              {
                state: "ACTIVE",
                executionGeneration: 7,
                deadline: null,
              },
            ],
          ];
        }
        if (sql.includes("FROM capability_binding AS binding")) {
          return [[authorityRow(workerCandidate)]];
        }
        if (
          sql.includes("UPDATE capability_attempt") ||
          sql.includes("UPDATE capability_run") ||
          sql.includes("INSERT INTO outbox_event")
        ) {
          return [result()];
        }
        if (sql.includes("INSERT INTO capability_attempt")) {
          insertedAttempts.push([...(parameters ?? [])]);
          return [result()];
        }
        throw new Error(`Unexpected SQL in created worker retry test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
    });

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "retry-dispatch",
        nextAttemptId: "next-worker-attempt",
        browserAssignmentEventId: "unused-browser-event",
      }),
    ).resolves.toBe("attempt_retried");
    expect(insertedAttempts).toHaveLength(1);
    expect(insertedAttempts[0]).toEqual(
      expect.arrayContaining([
        "binding-worker",
        "retry",
        "attempt.transition.retry.not_started",
        "worker",
        "implementation-worker",
      ]),
    );
    expect(insertedAttempts[0]?.[4]).toBe(0);
    expect(insertedAttempts[0]?.[5]).toBe(2);
    expect(insertedAttempts[0]?.[8]).toBe(2);
    expect(insertedAttempts[0]?.[12]).toEqual(workflowExecutionDeadline);

    insertedAttempts.length = 0;
    const budgetGate = vi.fn().mockReturnValue(false);
    const budgetDeniedStore = createWorkflowReconcilerStore(
      transactionPool(execute),
      {
        instanceId: "kanvas-test",
        enabledExecutionTargets: ["worker"],
        budgetGate,
      },
    );
    await expect(
      budgetDeniedStore.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "budget-terminal-event",
        nextAttemptId: "budget-denied-attempt",
        browserAssignmentEventId: "unused-browser-event",
      }),
    ).resolves.toBe("capability_failed");
    expect(budgetGate).toHaveBeenCalledOnce();
    expect(insertedAttempts).toHaveLength(0);

    workflowExecutionDeadline = now;
    const deadlineStore = createWorkflowReconcilerStore(
      transactionPool(execute),
      {
        instanceId: "kanvas-test",
        enabledExecutionTargets: ["worker"],
      },
    );
    await expect(
      deadlineStore.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "workflow-deadline-terminal-event",
        nextAttemptId: "deadline-blocked-attempt",
        browserAssignmentEventId: "unused-browser-event",
      }),
    ).resolves.toBe("capability_failed");
    expect(insertedAttempts).toHaveLength(0);
  });

  it("creates a Browser retry without emitting a queue dispatch", async () => {
    const browserCandidate = candidate(0, "browser");
    const queuedCapability = {
      ...capability,
      bindingId: "binding-browser",
      implementationRevisionId: "implementation-browser",
    };
    const attempt = {
      id: "attempt",
      workspaceId: "workspace",
      lifecycleStatus: "created",
      attemptNumber: 1,
      bindingId: "binding-browser",
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      transitionKind: "initial",
      transitionReasonCode: "workflow.start.initial",
      executionTarget: "browser",
      implementationRevisionId: "implementation-browser",
      sideEffectState: "not_started",
      retryDisposition: null,
      notBefore: oldDate,
      leaseGeneration: 0,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      executionDeadlineAt: now,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      error: null,
      version: 1,
      updatedAt: oldDate,
    };
    const insertedAttempts: unknown[][] = [];
    let outboxWrites = 0;
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [[workflowExecutionContext([browserCandidate])]];
        }
        if (sql.includes("FROM capability_run")) {
          return [[queuedCapability]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[attempt]];
        }
        if (sql.includes("FROM instance_runtime_state")) {
          return [
            [
              {
                state: "ACTIVE",
                executionGeneration: 7,
                deadline: null,
              },
            ],
          ];
        }
        if (sql.includes("FROM capability_binding AS binding")) {
          return [[authorityRow(browserCandidate)]];
        }
        if (sql.includes("INSERT INTO capability_attempt")) {
          insertedAttempts.push([...(parameters ?? [])]);
          return [result()];
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          outboxWrites += 1;
          return [result()];
        }
        if (
          sql.includes("UPDATE capability_attempt") ||
          sql.includes("UPDATE capability_run")
        ) {
          return [result()];
        }
        throw new Error(`Unexpected SQL in created Browser retry test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
      enabledExecutionTargets: ["browser"],
    });

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "unused-queue-event",
        nextAttemptId: "next-browser-attempt",
        browserAssignmentEventId: "unused-browser-event",
      }),
    ).resolves.toBe("attempt_retried");
    expect(insertedAttempts).toHaveLength(1);
    expect(insertedAttempts[0]?.[9]).toBe("browser");
    expect(outboxWrites).toBe(0);
  });

  it("falls back from an expired browser attempt to a pinned worker candidate", async () => {
    const browserCandidate = candidate(0, "browser");
    const workerCandidate = candidate(1, "worker");
    const runningCapability = {
      ...capability,
      bindingId: "binding-browser",
      implementationRevisionId: "implementation-browser",
      lifecycleStatus: "running",
      version: 4,
    };
    const attempt = {
      id: "attempt",
      workspaceId: "workspace",
      lifecycleStatus: "running",
      attemptNumber: 1,
      bindingId: "binding-browser",
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      transitionKind: "initial",
      transitionReasonCode: "workflow.start.initial",
      executionTarget: "browser",
      implementationRevisionId: "implementation-browser",
      sideEffectState: "not_started",
      notBefore: oldDate,
      leaseGeneration: 2,
      leaseTokenHash: null,
      leaseExpiresAt: now,
      executionDeadlineAt,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      retryDisposition: null,
      error: null,
      version: 3,
      updatedAt: oldDate,
    };
    const insertedAttempts: unknown[][] = [];
    const assignmentEvents: string[] = [];
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [
            [workflowExecutionContext([browserCandidate, workerCandidate])],
          ];
        }
        if (sql.includes("FROM capability_run")) {
          return [[runningCapability]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[attempt]];
        }
        if (sql.includes("FROM instance_runtime_state")) {
          return [
            [
              {
                state: "ACTIVE",
                executionGeneration: 7,
                deadline: null,
              },
            ],
          ];
        }
        if (sql.includes("FROM capability_binding AS binding")) {
          return [
            [
              authorityRow(
                parameters?.[0] === "implementation-worker"
                  ? workerCandidate
                  : browserCandidate,
              ),
            ],
          ];
        }
        if (sql.includes("FROM browser_attempt_assignment")) {
          return [
            [
              {
                id: "browser-assignment",
                workspaceId: "workspace",
                browserExecutorSessionId: "browser-session",
                capabilityAttemptId: "attempt",
                attemptLeaseGeneration: 2,
                executionGeneration: 7,
                state: "active",
                stableReasonCode: null,
                leaseExpiresAt: now,
                terminalAt: null,
              },
            ],
          ];
        }
        if (
          sql.includes("UPDATE capability_attempt") ||
          sql.includes("UPDATE capability_run") ||
          sql.includes("UPDATE browser_attempt_assignment")
        ) {
          return [result()];
        }
        if (sql.includes("INSERT INTO browser_attempt_assignment_event")) {
          assignmentEvents.push(`${sql} ${(parameters ?? []).join(" ")}`);
          return [result()];
        }
        if (sql.includes("INSERT INTO capability_attempt")) {
          insertedAttempts.push([...(parameters ?? [])]);
          return [result()];
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          return [result()];
        }
        throw new Error(`Unexpected SQL in browser retry test: ${sql}`);
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
      enabledExecutionTargets: ["browser", "worker"],
    });

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "unused-event",
        nextAttemptId: "next-browser-attempt",
        browserAssignmentEventId: "browser-expired-event",
      }),
    ).resolves.toBe("attempt_fallback");
    expect(insertedAttempts).toHaveLength(1);
    expect(insertedAttempts[0]?.[3]).toBe("binding-worker");
    expect(insertedAttempts[0]?.[4]).toBe(1);
    expect(insertedAttempts[0]?.[5]).toBe(1);
    expect(insertedAttempts[0]?.[6]).toBe("fallback");
    expect(insertedAttempts[0]?.[9]).toBe("worker");
    expect(assignmentEvents).toHaveLength(1);
    expect(assignmentEvents[0]).toContain("browser.lease_expired");
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO outbox_event"),
      ),
    ).toBe(true);
  });

  it("settles a browser attempt whose assignment was already revoked", async () => {
    const browserCandidate = candidate(0, "browser");
    const workerCandidate = candidate(1, "worker");
    const runningCapability = {
      ...capability,
      bindingId: "binding-browser",
      implementationRevisionId: "implementation-browser",
      lifecycleStatus: "running",
      version: 4,
    };
    const attempt = {
      id: "attempt",
      workspaceId: "workspace",
      lifecycleStatus: "running",
      attemptNumber: 1,
      bindingId: "binding-browser",
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      transitionKind: "initial",
      transitionReasonCode: "workflow.start.initial",
      executionTarget: "browser",
      implementationRevisionId: "implementation-browser",
      sideEffectState: "not_started",
      notBefore: oldDate,
      leaseGeneration: 2,
      leaseTokenHash: null,
      leaseExpiresAt: now,
      executionDeadlineAt,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      retryDisposition: null,
      error: null,
      version: 3,
      updatedAt: oldDate,
    };
    const insertedAttempts: unknown[][] = [];
    const attemptRetryDispositions: unknown[] = [];
    let currentBindingLifecycleStatus = "active";
    const execute = vi.fn(
      async (sqlValue: unknown, parameters?: readonly unknown[]) => {
        await Promise.resolve();
        const sql = String(sqlValue);
        if (sql.includes("FROM capability_run AS capability")) {
          return [
            [workflowExecutionContext([browserCandidate, workerCandidate])],
          ];
        }
        if (sql.includes("FROM capability_run")) {
          return [[runningCapability]];
        }
        if (sql.includes("FROM capability_attempt")) {
          return [[attempt]];
        }
        if (sql.includes("FROM instance_runtime_state")) {
          return [
            [
              {
                state: "ACTIVE",
                executionGeneration: 7,
                deadline: null,
              },
            ],
          ];
        }
        if (sql.includes("FROM capability_binding AS binding")) {
          return [
            [
              authorityRow(
                parameters?.[0] === "implementation-worker"
                  ? workerCandidate
                  : browserCandidate,
                parameters?.[0] === "implementation-worker"
                  ? {}
                  : {
                      bindingLifecycleStatus: currentBindingLifecycleStatus,
                    },
              ),
            ],
          ];
        }
        if (sql.includes("FROM browser_attempt_assignment")) {
          return [
            [
              {
                id: "browser-assignment",
                workspaceId: "workspace",
                browserExecutorSessionId: "browser-session",
                capabilityAttemptId: "attempt",
                attemptLeaseGeneration: 2,
                executionGeneration: 7,
                state: "revoked",
                stableReasonCode: "browser.session_revoked",
                leaseExpiresAt: now,
                terminalAt: now,
              },
            ],
          ];
        }
        if (sql.includes("UPDATE capability_attempt")) {
          attemptRetryDispositions.push(parameters?.[2]);
          return [result()];
        }
        if (sql.includes("UPDATE capability_run")) {
          return [result()];
        }
        if (sql.includes("INSERT INTO capability_attempt")) {
          insertedAttempts.push([...(parameters ?? [])]);
          return [result()];
        }
        if (
          sql.includes("UPDATE browser_attempt_assignment") ||
          sql.includes("INSERT INTO browser_attempt_assignment_event")
        ) {
          throw new Error(
            "An already revoked assignment must not be transitioned twice.",
          );
        }
        if (sql.includes("INSERT INTO outbox_event")) {
          return [result()];
        }
        throw new Error(
          `Unexpected SQL in revoked browser reconciliation test: ${sql}`,
        );
      },
    );
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
      enabledExecutionTargets: ["browser", "worker"],
    });

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "unused-event",
        nextAttemptId: "next-browser-attempt",
        browserAssignmentEventId: "must-not-be-used",
      }),
    ).resolves.toBe("attempt_fallback");
    expect(insertedAttempts).toHaveLength(1);
    expect(insertedAttempts[0]?.[3]).toBe("binding-worker");
    expect(insertedAttempts[0]?.[9]).toBe("worker");

    currentBindingLifecycleStatus = "revoked";
    attempt.sideEffectState = "committed";
    insertedAttempts.length = 0;
    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "terminal-event",
        nextAttemptId: "must-not-be-created",
        browserAssignmentEventId: "must-not-be-used",
      }),
    ).resolves.toBe("capability_failed");
    expect(insertedAttempts).toHaveLength(0);
    expect(attemptRetryDispositions.at(-1)).toBe("manual");
  });

  it("leaves an expired provider attempt to invocation reconciliation", async () => {
    const runningCapability = {
      ...capability,
      lifecycleStatus: "running",
      version: 4,
    };
    const attempt = {
      id: "attempt",
      lifecycleStatus: "running",
      attemptNumber: 1,
      executionTarget: "provider",
      implementationRevisionId: "implementation",
      sideEffectState: "unknown",
      notBefore: oldDate,
      leaseExpiresAt: oldDate,
      cancelRequestedAt: null,
      cancelDeadlineAt: null,
      version: 3,
      updatedAt: oldDate,
    };
    const execute = vi.fn(async (sqlValue: unknown) => {
      await Promise.resolve();
      const sql = String(sqlValue);
      if (sql.includes("FROM capability_run AS capability")) {
        return [[workflowExecutionContext([candidate(0, "provider")])]];
      }
      if (sql.includes("FROM capability_run")) {
        return [[runningCapability]];
      }
      if (sql.includes("FROM capability_attempt")) {
        return [[attempt]];
      }
      if (sql.includes("FROM capability_implementation_revision")) {
        return [[{ executionTarget: "provider" }]];
      }
      throw new Error(
        `Provider lease expiry attempted an unexpected mutation: ${sql}`,
      );
    });
    const store = createWorkflowReconcilerStore(transactionPool(execute), {
      instanceId: "kanvas-test",
    });

    await expect(
      store.reconcileExpiredAttempt("capability-run", "attempt", {
        now,
        staleBefore,
        executionGeneration: 7,
        outboxEventId: "unused-event",
        nextAttemptId: "must-not-be-created",
        browserAssignmentEventId: "unused-browser-assignment-event",
      }),
    ).resolves.toBe("noop");
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE capability_attempt"),
      ),
    ).toBe(false);
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO capability_attempt"),
      ),
    ).toBe(false);
  });
});
