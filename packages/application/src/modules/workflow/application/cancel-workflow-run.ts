import type { Clock } from "../../../foundation/clock.js";
import { DomainError } from "../../../foundation/domain-error.js";
import type { IdGenerator } from "../../../foundation/id-generator.js";
import type { RuntimeStateReader } from "../../../foundation/runtime-fence.js";
import type {
  TransactionContext,
  TransactionManager,
} from "../../../foundation/transaction-context.js";

export type WorkflowCancellationReasonCode =
  | "user_requested"
  | "superseded"
  | "policy_denied"
  | "budget_exceeded"
  | "runtime_shutdown"
  | "other";

const cancellationReasonCodes: readonly WorkflowCancellationReasonCode[] =
  Object.freeze([
    "user_requested",
    "superseded",
    "policy_denied",
    "budget_exceeded",
    "runtime_shutdown",
    "other",
  ]);

export interface WorkflowCancellationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: "cancelling" | "cancelled";
  readonly version: number;
  readonly cancelRequestedAt: Date;
  readonly cancelRequestedBy: string;
  readonly cancelReasonCode: WorkflowCancellationReasonCode;
  readonly cancelDeadlineAt: Date;
}

export interface RequestWorkflowCancellationOptions {
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly actorId: string;
  readonly reasonCode: WorkflowCancellationReasonCode;
  readonly now: Date;
  readonly cancelDeadlineAt: Date;
  readonly outboxEventId: string;
  readonly executionGeneration: number;
}

export interface WorkflowCancellationRepository {
  request(
    options: RequestWorkflowCancellationOptions,
    context: TransactionContext,
  ): Promise<
    | {
        readonly run: WorkflowCancellationRecord;
        readonly replayed: boolean;
      }
    | undefined
  >;
}

export interface CancelWorkflowRunCommand {
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly actorId: string;
  readonly reasonCode?: WorkflowCancellationReasonCode;
}

export interface CancelWorkflowRunResult {
  readonly run: WorkflowCancellationRecord;
  readonly replayed: boolean;
}

export type CancelWorkflowRun = (
  command: CancelWorkflowRunCommand,
) => Promise<CancelWorkflowRunResult>;

export interface CancelWorkflowRunDependencies {
  readonly clock: Clock;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly ids: IdGenerator;
  readonly transactionManager: TransactionManager;
  readonly cancellations: WorkflowCancellationRepository;
  readonly cancellationGraceMs: number;
}

function assertCommand(command: CancelWorkflowRunCommand): void {
  if (
    command.reasonCode !== undefined &&
    !cancellationReasonCodes.includes(command.reasonCode)
  ) {
    throw new DomainError(
      "workflow_run.cancel_reason_invalid",
      "Cancellation reason code is not supported.",
    );
  }
}

export function createCancelWorkflowRun(
  dependencies: CancelWorkflowRunDependencies,
): CancelWorkflowRun {
  if (
    !Number.isSafeInteger(dependencies.cancellationGraceMs) ||
    dependencies.cancellationGraceMs < 1
  ) {
    throw new RangeError("Cancellation grace period must be positive.");
  }

  return async (command) => {
    assertCommand(command);
    const now = dependencies.clock.now();
    const runtimeState = await dependencies.runtimeStateReader.read();
    const drainingBeforeDeadline =
      (runtimeState.state === "DRAINING" ||
        runtimeState.state === "MAINTENANCE") &&
      (runtimeState.state === "MAINTENANCE" ||
        (runtimeState.deadline !== undefined && now <= runtimeState.deadline));
    if (runtimeState.state !== "ACTIVE" && !drainingBeforeDeadline) {
      throw new DomainError(
        "workflow_run.runtime_not_cancellable",
        `Workflow cancellation is not accepted while runtime state is ${runtimeState.state}.`,
      );
    }

    const result = await dependencies.transactionManager.run((context) =>
      dependencies.cancellations.request(
        {
          workspaceId: command.workspaceId,
          workflowRunId: command.workflowRunId,
          actorId: command.actorId,
          reasonCode: command.reasonCode ?? "user_requested",
          now,
          cancelDeadlineAt: new Date(
            now.getTime() + dependencies.cancellationGraceMs,
          ),
          outboxEventId: dependencies.ids.next(),
          executionGeneration: runtimeState.executionGeneration,
        },
        context,
      ),
    );
    if (!result) {
      throw new DomainError(
        "workflow_run.not_found",
        "Workflow run was not found.",
      );
    }
    return result;
  };
}
