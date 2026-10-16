import type { CanvasBrandContext } from "@kanvas/contracts/api";

import { DomainError } from "../../../foundation/domain-error.js";
import type { WorkflowCancellationReasonCode } from "./cancel-workflow-run.js";

export interface WorkflowRunView {
  readonly id: string;
  readonly workspaceId: string;
  readonly pendingApprovals?: readonly {
    readonly id: string;
    readonly nodeRunId: string;
    readonly nodeKey: string;
    readonly title?: string;
    readonly message?: string;
    readonly decisionSchema: Readonly<Record<string, unknown>>;
    readonly expiresAt: Date;
  }[];
  readonly browserExecution?: {
    readonly requiredCapabilityKeys: readonly string[];
  };
  readonly brand?: CanvasBrandContext;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId?: string;
  readonly publicationCandidateId?: string;
  readonly nonProduction: boolean;
  readonly lifecycleStatus:
    | "queued"
    | "running"
    | "waiting"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
  readonly outcome:
    "full_success" | "partial_success" | "no_usable_output" | null;
  readonly version: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly nodes: readonly {
    readonly id: string;
    readonly nodeKey: string;
    readonly scopeKey: string;
    readonly kind: "invoke" | "switch" | "map" | "approval";
    readonly lifecycleStatus: string;
    readonly waitingReason?: string;
    readonly output: unknown;
    readonly error: unknown;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly completedAt?: Date;
  }[];
  readonly executionDeadlineAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
  readonly cancelRequestedAt?: Date;
  readonly cancelReasonCode?: WorkflowCancellationReasonCode;
  readonly cancelDeadlineAt?: Date;
}

export interface WorkflowRunSummaryView {
  readonly id: string;
  readonly brand?: CanvasBrandContext;
  readonly workflowRevisionId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly lifecycleStatus: WorkflowRunView["lifecycleStatus"];
  readonly outcome: WorkflowRunView["outcome"];
  readonly output: unknown;
  readonly createdAt: Date;
  readonly completedAt?: Date;
}

export interface WorkflowRunListCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export type WorkflowRunListState =
  "all" | "active" | "completed" | "unfinished";

export interface WorkflowRunListResult {
  readonly items: readonly WorkflowRunSummaryView[];
  readonly nextCursor?: WorkflowRunListCursor;
}

export interface WorkflowRunQueryRepository {
  findById(
    workspaceId: string,
    workflowRunId: string,
    actorId?: string,
  ): Promise<WorkflowRunView | undefined>;
  listForActor(query: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly workflowRevisionId?: string;
    readonly state: WorkflowRunListState;
    readonly cursor?: WorkflowRunListCursor;
    readonly limit: number;
  }): Promise<WorkflowRunListResult>;
}

export interface GetWorkflowRunCommand {
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly actorId?: string;
}

export type GetWorkflowRun = (
  command: GetWorkflowRunCommand,
) => Promise<WorkflowRunView>;

export interface ListWorkflowRunsCommand {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly workflowRevisionId?: string;
  readonly state: WorkflowRunListState;
  readonly cursor?: WorkflowRunListCursor;
  readonly limit: number;
}

export type ListWorkflowRuns = (
  command: ListWorkflowRunsCommand,
) => Promise<WorkflowRunListResult>;

export function createGetWorkflowRun(
  repository: WorkflowRunQueryRepository,
): GetWorkflowRun {
  return async (command) => {
    const run = await repository.findById(
      command.workspaceId,
      command.workflowRunId,
      ...(command.actorId ? [command.actorId] : []),
    );
    if (!run) {
      throw new DomainError(
        "workflow_run.not_found",
        "Workflow run was not found.",
      );
    }
    return run;
  };
}

export function createListWorkflowRuns(
  repository: WorkflowRunQueryRepository,
): ListWorkflowRuns {
  return (command) =>
    repository.listForActor({
      workspaceId: command.workspaceId,
      actorId: command.actorId,
      ...(command.workflowRevisionId
        ? { workflowRevisionId: command.workflowRevisionId }
        : {}),
      state: command.state,
      ...(command.cursor ? { cursor: command.cursor } : {}),
      limit: Math.min(40, Math.max(1, command.limit)),
    });
}
