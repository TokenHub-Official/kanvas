import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { transitionAttemptFailureInTransaction } from "../src/runtime/attempt-failure-store.js";

describe("Provider failure before invocation ownership", () => {
  it.each([
    ["provider.parameter_resolution_rejected", "not_started", true],
    ["attempt.execution_deadline_expired", "not_started", false],
    ["provider.parameter_resolution_rejected", "unknown", false],
  ] as const)(
    "gates %s with side effects %s",
    async (code, sideEffectState, shouldReachRuntimeGate) => {
      const now = new Date("2026-09-08T08:00:00Z");
      const gate = new Error("runtime fence validation reached");
      const execute = vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: "run",
              workspaceId: "workspace",
              currentAttemptId: "attempt",
              acceptedAttemptId: null,
              lifecycleStatus: "queued",
              cancelRequestedAt: null,
            },
          ],
          [],
        ])
        .mockResolvedValueOnce([
          [
            {
              id: "attempt",
              workspaceId: "workspace",
              lifecycleStatus: "created",
              version: 1,
              executionTarget: "provider",
              sideEffectState,
              cancelRequestedAt: null,
              executionDeadlineAt: new Date(now.getTime() + 240000),
            },
          ],
          [],
        ])
        .mockRejectedValue(gate);
      const completion = transitionAttemptFailureInTransaction(
        { execute } as unknown as PoolConnection,
        "test",
        {
          workspaceId: "workspace",
          capabilityRunId: "run",
          attemptId: "attempt",
          nextAttemptId: "next",
          outboxEventId: "event",
          executionGeneration: 1,
          target: {
            reporter: "reconciler",
            executionTarget: "provider",
            expectedAttemptVersion: 1,
          },
          failure: {
            stableErrorCode: code,
            sideEffectState,
            retryability: "terminal",
            cause: "failed",
          },
          now,
        },
        { executionTargetGate: {} as never, budgetGate: () => false },
      );
      if (shouldReachRuntimeGate) {
        await expect(completion).rejects.toBe(gate);
        expect(execute).toHaveBeenCalledTimes(3);
      } else {
        await expect(completion).rejects.toMatchObject({
          code: "attempt_failure.state_conflict",
        });
        expect(execute).toHaveBeenCalledTimes(2);
      }
    },
  );
});
