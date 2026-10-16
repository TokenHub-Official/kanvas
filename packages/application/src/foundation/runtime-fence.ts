import type { InstanceRuntimeState } from "@kanvas/contracts/primitives";

import type { Clock } from "./clock.js";
import { DomainError } from "./domain-error.js";

export type WorkerRole =
  | "orchestration"
  | "execution"
  | "provider-execution"
  | "outbox-relay"
  | "scheduler"
  | "reconciler"
  | "maintenance"
  | "agent";

export type RuntimeFenceAction =
  | "claim"
  | "dispatch"
  | "heartbeat"
  | "complete"
  | "cancel"
  | "provider-call"
  | "provider-callback"
  | "relay"
  | "schedule"
  | "repair"
  | "garbage-collect";

export interface RuntimeStateSnapshot {
  readonly state: InstanceRuntimeState;
  readonly executionGeneration: number;
  readonly stateVersion: number;
  readonly deadline?: Date;
}

export interface RuntimeFenceCheck {
  readonly action: RuntimeFenceAction;
  readonly expectedGeneration: number;
}

export type RuntimeFenceRejectionReason =
  "stale_execution_generation" | "runtime_state_disallowed";

export interface RuntimeStateReader {
  read(): Promise<RuntimeStateSnapshot>;
}

export class RuntimeFenceRejectedError extends DomainError {
  public constructor(
    public readonly action: RuntimeFenceAction,
    public readonly state: InstanceRuntimeState,
    public readonly reasonCode: RuntimeFenceRejectionReason,
    reason: string,
  ) {
    super("runtime_fence_rejected", reason);
    this.name = "RuntimeFenceRejectedError";
  }
}

export interface RuntimeFenceGuard {
  assertAllowed(check: RuntimeFenceCheck): Promise<RuntimeStateSnapshot>;
}

export function createRuntimeFenceGuard(
  reader: RuntimeStateReader,
  clock: Clock,
): RuntimeFenceGuard {
  return Object.freeze({
    async assertAllowed(
      check: RuntimeFenceCheck,
    ): Promise<RuntimeStateSnapshot> {
      const snapshot = await reader.read();

      if (snapshot.executionGeneration !== check.expectedGeneration) {
        throw new RuntimeFenceRejectedError(
          check.action,
          snapshot.state,
          "stale_execution_generation",
          "Execution generation is stale.",
        );
      }

      if (snapshot.state === "ACTIVE") {
        return snapshot;
      }

      const isDrainCompletion =
        snapshot.state === "DRAINING" &&
        (check.action === "heartbeat" || check.action === "complete") &&
        snapshot.deadline !== undefined &&
        clock.now().getTime() <= snapshot.deadline.getTime();

      const isSafetyCancellation =
        check.action === "cancel" &&
        (snapshot.state === "MAINTENANCE" ||
          (snapshot.state === "DRAINING" &&
            snapshot.deadline !== undefined &&
            clock.now().getTime() <= snapshot.deadline.getTime()));

      if (isDrainCompletion || isSafetyCancellation) {
        return snapshot;
      }

      throw new RuntimeFenceRejectedError(
        check.action,
        snapshot.state,
        "runtime_state_disallowed",
        `Action ${check.action} is not permitted while runtime state is ${snapshot.state}.`,
      );
    },
  });
}
