export type ExecutionTarget = "browser" | "worker" | "provider";

export type QueueExecutionTarget = Exclude<ExecutionTarget, "browser">;

export interface ExecutionTargetGate {
  readonly enabledExecutionTargets: readonly ExecutionTarget[];
  allows(executionTarget: ExecutionTarget): boolean;
}

export const defaultEnabledExecutionTargets = Object.freeze<
  readonly ExecutionTarget[]
>(["worker"]);

export function isExecutionTarget(value: unknown): value is ExecutionTarget {
  return value === "browser" || value === "worker" || value === "provider";
}

export function isQueueExecutionTarget(
  value: unknown,
): value is QueueExecutionTarget {
  return value === "worker" || value === "provider";
}

export function createExecutionTargetGate(
  enabledExecutionTargets: readonly ExecutionTarget[] = defaultEnabledExecutionTargets,
): ExecutionTargetGate {
  const enabled = new Set<ExecutionTarget>();
  for (const executionTarget of enabledExecutionTargets) {
    if (!isExecutionTarget(executionTarget)) {
      throw new TypeError(
        `Unknown enabled execution target: ${String(executionTarget)}`,
      );
    }
    enabled.add(executionTarget);
  }
  const snapshot = Object.freeze([...enabled]);

  return Object.freeze({
    enabledExecutionTargets: snapshot,
    allows(executionTarget: ExecutionTarget) {
      return enabled.has(executionTarget);
    },
  });
}
