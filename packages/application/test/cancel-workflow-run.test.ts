import { describe, expect, it, vi } from "vitest";

import {
  createCancelWorkflowRun,
  DomainError,
  type CancelWorkflowRunDependencies,
  type RuntimeStateSnapshot,
  type TransactionContext,
  type WorkflowCancellationRecord,
} from "../src/index.js";

const now = new Date("2026-07-27T12:00:00.000Z");
const transactionContext = {} as TransactionContext;
const workspaceId = "01K000000000000000000000001";
const workflowRunId = "01K000000000000000000000002";
const actorId = "01K000000000000000000000003";
const outboxEventId = "01K000000000000000000000004";

function cancellationRecord(
  overrides: Partial<WorkflowCancellationRecord> = {},
): WorkflowCancellationRecord {
  return {
    id: workflowRunId,
    workspaceId,
    lifecycleStatus: "cancelling",
    version: 4,
    cancelRequestedAt: now,
    cancelRequestedBy: actorId,
    cancelReasonCode: "user_requested",
    cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
    ...overrides,
  };
}

function createHarness(
  runtimeState: RuntimeStateSnapshot = {
    state: "ACTIVE",
    executionGeneration: 7,
    stateVersion: 2,
  },
): {
  readonly dependencies: CancelWorkflowRunDependencies;
  readonly request: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
  readonly runTransaction: ReturnType<typeof vi.fn>;
} {
  const request = vi
    .fn<CancelWorkflowRunDependencies["cancellations"]["request"]>()
    .mockResolvedValue({
      run: cancellationRecord(),
      replayed: false,
    });
  const read = vi.fn().mockResolvedValue(runtimeState);
  const runTransaction = vi.fn();

  return {
    dependencies: {
      clock: {
        now: () => now,
      },
      runtimeStateReader: {
        read,
      },
      ids: {
        next: () => outboxEventId,
      },
      transactionManager: {
        run: <TResult>(
          callback: (context: TransactionContext) => Promise<TResult>,
        ) => {
          runTransaction(callback);
          return callback(transactionContext);
        },
      },
      cancellations: {
        request,
      },
      cancellationGraceMs: 30_000,
    },
    request,
    read,
    runTransaction,
  };
}

describe("cancel workflow run", () => {
  it("writes a monotonic cancellation request with a bounded deadline", async () => {
    const harness = createHarness();
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
      }),
    ).resolves.toEqual({
      run: cancellationRecord(),
      replayed: false,
    });

    expect(harness.request).toHaveBeenCalledWith(
      {
        workspaceId,
        workflowRunId,
        actorId,
        reasonCode: "user_requested",
        now,
        cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
        outboxEventId,
        executionGeneration: 7,
      },
      transactionContext,
    );
    expect(harness.runTransaction).toHaveBeenCalledTimes(1);
  });

  it("preserves the first durable cancellation facts on replay", async () => {
    const harness = createHarness();
    const firstRequestedAt = new Date("2026-07-27T11:59:00.000Z");
    const firstDeadlineAt = new Date("2026-07-27T11:59:30.000Z");
    const firstRecord = cancellationRecord({
      lifecycleStatus: "cancelled",
      version: 8,
      cancelRequestedAt: firstRequestedAt,
      cancelReasonCode: "policy_denied",
      cancelDeadlineAt: firstDeadlineAt,
    });
    harness.request.mockResolvedValue({
      run: firstRecord,
      replayed: true,
    });
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
        reasonCode: "superseded",
      }),
    ).resolves.toEqual({
      run: firstRecord,
      replayed: true,
    });
  });

  it.each([
    {
      state: "DRAINING" as const,
      deadline: new Date("2026-07-27T12:00:00.000Z"),
    },
    {
      state: "MAINTENANCE" as const,
    },
  ])(
    "accepts the safety command while runtime state is $state",
    async (state) => {
      const harness = createHarness({
        ...state,
        executionGeneration: 9,
        stateVersion: 3,
      });
      const cancelRun = createCancelWorkflowRun(harness.dependencies);

      await expect(
        cancelRun({
          workspaceId,
          workflowRunId,
          actorId,
          reasonCode: "runtime_shutdown",
        }),
      ).resolves.toMatchObject({
        replayed: false,
      });
      expect(harness.request).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode: "runtime_shutdown",
          executionGeneration: 9,
        }),
        transactionContext,
      );
    },
  );

  it.each([
    {
      state: "DRAINING" as const,
      deadline: new Date("2026-07-27T11:59:59.999Z"),
    },
    {
      state: "DRAINING" as const,
    },
    {
      state: "RESTORING" as const,
    },
    {
      state: "VERIFYING" as const,
    },
    {
      state: "READ_ONLY" as const,
    },
  ])("fails closed while runtime state is $state", async (state) => {
    const harness = createHarness({
      ...state,
      executionGeneration: 9,
      stateVersion: 3,
    });
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
      }),
    ).rejects.toMatchObject({
      code: "workflow_run.runtime_not_cancellable",
    });
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unsupported runtime reason before reading mutable state", async () => {
    const harness = createHarness();
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
        reasonCode: "free_form_reason",
      } as unknown as Parameters<typeof cancelRun>[0]),
    ).rejects.toMatchObject({
      code: "workflow_run.cancel_reason_invalid",
    });
    expect(harness.read).not.toHaveBeenCalled();
    expect(harness.request).not.toHaveBeenCalled();
  });

  it("returns not found without synthesizing cancellation facts", async () => {
    const harness = createHarness();
    harness.request.mockResolvedValue(undefined);
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
      }),
    ).rejects.toMatchObject({
      code: "workflow_run.not_found",
    });
  });

  it("rejects invalid cancellation grace configuration at composition time", () => {
    const harness = createHarness();

    expect(() =>
      createCancelWorkflowRun({
        ...harness.dependencies,
        cancellationGraceMs: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createCancelWorkflowRun({
        ...harness.dependencies,
        cancellationGraceMs: 1.5,
      }),
    ).toThrow(RangeError);
  });

  it("preserves repository domain errors from terminal and race outcomes", async () => {
    const harness = createHarness();
    const repositoryError = new DomainError(
      "workflow_run.already_terminal",
      "Workflow run is already completed.",
    );
    harness.request.mockRejectedValue(repositoryError);
    const cancelRun = createCancelWorkflowRun(harness.dependencies);

    await expect(
      cancelRun({
        workspaceId,
        workflowRunId,
        actorId,
      }),
    ).rejects.toBe(repositoryError);
  });
});
