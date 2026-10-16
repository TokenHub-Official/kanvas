import {
  RuntimeFenceRejectedError,
  type ApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import type { WorkflowReconcilerStore } from "@kanvas/database/runtime";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { WorkflowReconciler } from "../src/reconciler/workflow-reconciler.js";

describe("WorkflowReconciler", () => {
  it("repairs database candidates under the runtime generation fence", async () => {
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const runtime = {
      runtimeFence: {
        assertAllowed,
      },
    } as unknown as ApplicationRuntime;
    const runtimeStateReader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    };
    const reconcileWorkflowWakeup = vi
      .fn()
      .mockResolvedValue("workflow_wakeup_rebuilt");
    const reconcileWorkflowCancellation = vi
      .fn()
      .mockResolvedValue("workflow_cancel_rebuilt");
    const reconcileExpiredAttempt = vi
      .fn()
      .mockResolvedValue("attempt_retried");
    const store = {
      scanCandidates: () =>
        Promise.resolve([
          {
            kind: "expired_attempt",
            capabilityRunId: "capability-run",
            attemptId: "attempt",
          },
          {
            kind: "workflow_cancel",
            workflowRunId: "cancelling-workflow-run",
          },
          {
            kind: "workflow_wakeup",
            workflowRunId: "workflow-run",
          },
        ]),
      reconcileWorkflowWakeup,
      reconcileWorkflowCancellation,
      reconcileExpiredAttempt,
    } as unknown as WorkflowReconcilerStore;
    const nextId = vi
      .fn()
      .mockReturnValueOnce("expired-outbox")
      .mockReturnValueOnce("next-attempt")
      .mockReturnValueOnce("browser-assignment-event")
      .mockReturnValueOnce("cancel-outbox")
      .mockReturnValueOnce("workflow-outbox");
    const reconciler = new WorkflowReconciler({
      runtime,
      runtimeStateReader,
      store,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      nextId,
      now: () => new Date("2026-07-27T12:00:30.000Z"),
      staleAfterMs: 15_000,
      batchSize: 20,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      attempt_retried: 1,
      workflow_cancel_rebuilt: 1,
      workflow_wakeup_rebuilt: 1,
      noop: 0,
    });
    expect(assertAllowed).toHaveBeenCalledTimes(4);
    expect(reconcileExpiredAttempt).toHaveBeenCalledWith(
      "capability-run",
      "attempt",
      expect.objectContaining({
        executionGeneration: 7,
        outboxEventId: "expired-outbox",
        nextAttemptId: "next-attempt",
        browserAssignmentEventId: "browser-assignment-event",
      }),
    );
    expect(reconcileWorkflowCancellation).toHaveBeenCalledWith(
      "cancelling-workflow-run",
      expect.objectContaining({
        executionGeneration: 7,
        outboxEventId: "cancel-outbox",
      }),
    );
    expect(reconcileWorkflowWakeup).toHaveBeenCalledWith(
      "workflow-run",
      expect.objectContaining({
        executionGeneration: 7,
        outboxEventId: "workflow-outbox",
      }),
    );
  });

  it("isolates a failed candidate and continues with later healthy candidates", async () => {
    const assertAllowed = vi.fn().mockResolvedValue({
      state: "ACTIVE",
      executionGeneration: 7,
      stateVersion: 1,
    });
    const runtime = {
      runtimeFence: {
        assertAllowed,
      },
    } as unknown as ApplicationRuntime;
    const runtimeStateReader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    };
    const reconcileCapabilityTerminal = vi
      .fn()
      .mockRejectedValue(
        new Error("provider response contained sensitive details"),
      );
    const reconcileWorkflowWakeup = vi
      .fn()
      .mockResolvedValue("workflow_wakeup_rebuilt");
    const store = {
      scanCandidates: () =>
        Promise.resolve([
          {
            kind: "capability_terminal",
            workflowRunId: "failed-workflow-run",
            nodeRunId: "failed-node-run",
            capabilityRunId: "failed-capability-run",
          },
          {
            kind: "workflow_wakeup",
            workflowRunId: "healthy-workflow-run",
          },
        ]),
      reconcileCapabilityTerminal,
      reconcileWorkflowWakeup,
    } as unknown as WorkflowReconcilerStore;
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const reconciler = new WorkflowReconciler({
      runtime,
      runtimeStateReader,
      store,
      logger: logger as unknown as Logger,
      nextId: vi
        .fn()
        .mockReturnValueOnce("failed-outbox")
        .mockReturnValueOnce("healthy-outbox"),
      now: () => new Date("2026-07-27T12:00:30.000Z"),
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      capability_terminal_rebuilt: 0,
      workflow_wakeup_rebuilt: 1,
    });
    expect(reconcileWorkflowWakeup).toHaveBeenCalledWith(
      "healthy-workflow-run",
      expect.objectContaining({
        outboxEventId: "healthy-outbox",
      }),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      {
        reconciliationKind: "capability_terminal",
        workflowRunId: "failed-workflow-run",
        nodeRunId: "failed-node-run",
        capabilityRunId: "failed-capability-run",
        errorCode: "workflow.reconciliation.candidate_failed",
        errorType: "Error",
      },
      "Workflow reconciliation candidate failed; continuing.",
    );
    expect(JSON.stringify(logger.error.mock.calls[0]?.[0])).not.toContain(
      "sensitive details",
    );
  });

  it("stops the iteration when the runtime generation fence rejects", async () => {
    const fenceError = new RuntimeFenceRejectedError(
      "repair",
      "ACTIVE",
      "stale_execution_generation",
      "Execution generation is stale.",
    );
    const allowedSnapshot = {
      state: "ACTIVE" as const,
      executionGeneration: 7,
      stateVersion: 1,
    };
    const assertAllowed = vi
      .fn()
      .mockResolvedValueOnce(allowedSnapshot)
      .mockResolvedValueOnce(allowedSnapshot)
      .mockRejectedValueOnce(fenceError);
    const runtime = {
      runtimeFence: {
        assertAllowed,
      },
    } as unknown as ApplicationRuntime;
    const runtimeStateReader: RuntimeStateReader = {
      read: () => Promise.resolve(allowedSnapshot),
    };
    const reconcileWorkflowWakeup = vi
      .fn()
      .mockResolvedValue("workflow_wakeup_rebuilt");
    const store = {
      scanCandidates: () =>
        Promise.resolve([
          {
            kind: "workflow_wakeup",
            workflowRunId: "first-workflow-run",
          },
          {
            kind: "workflow_wakeup",
            workflowRunId: "must-not-run",
          },
        ]),
      reconcileWorkflowWakeup,
    } as unknown as WorkflowReconcilerStore;
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const reconciler = new WorkflowReconciler({
      runtime,
      runtimeStateReader,
      store,
      logger: logger as unknown as Logger,
      nextId: vi.fn().mockReturnValue("outbox"),
      now: () => new Date("2026-07-27T12:00:30.000Z"),
    });

    await expect(reconciler.runOnce()).rejects.toBe(fenceError);
    expect(reconcileWorkflowWakeup).toHaveBeenCalledTimes(1);
    expect(reconcileWorkflowWakeup).toHaveBeenCalledWith(
      "first-workflow-run",
      expect.any(Object),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
