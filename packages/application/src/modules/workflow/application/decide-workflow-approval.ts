import type { TrustedWorkspaceScope } from "../../authorization/index.js";
import type { Clock } from "../../../foundation/clock.js";
import { DomainError } from "../../../foundation/domain-error.js";
import type { IdGenerator } from "../../../foundation/id-generator.js";
import type { RuntimeStateReader } from "../../../foundation/runtime-fence.js";
import type { CanonicalDigest } from "./create-workflow-run.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumIdempotencyKeyLength = 160;

export interface WorkflowApprovalDecisionContextRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly nodeKey: string;
  readonly requestPayload: unknown;
  readonly decisionSchema: Readonly<Record<string, unknown>>;
  readonly authorizationContextDigest: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly lifecycleStatus: "pending" | "decided" | "expired" | "cancelled";
}

export interface WorkflowApprovalQueryRepository {
  findApprovalDecisionContext(
    workspaceId: string,
    workflowRunId: string,
    approvalRequestId: string,
  ): Promise<WorkflowApprovalDecisionContextRecord | undefined>;
}

export interface WorkflowApprovalDecisionPort {
  decide(options: {
    readonly approvalRequestId: string;
    readonly workspaceId: string;
    readonly authority: TrustedWorkspaceScope;
    readonly idempotencyKeyDigest: string;
    readonly decisionId: string;
    readonly outboxEventId: string;
    readonly decision: Readonly<Record<string, unknown>>;
    readonly authorization: {
      readonly effect: "allow";
      readonly authorizationDecisionId: string;
      readonly workspaceId: string;
      readonly approvalRequestId: string;
      readonly actorPrincipalId: string;
      readonly permission: "approval.decide";
      readonly bindingDigest: string;
      readonly policyRevision: string;
      readonly authorizedAt: Date;
      readonly validUntil: Date;
    };
    readonly executionGeneration: number;
    readonly now: Date;
  }): Promise<
    | {
        readonly status: "recorded" | "replayed";
        readonly decisionId: string;
        readonly workflowRunId: string;
      }
    | {
        readonly status: "conflict";
        readonly existingDecisionId: string;
        readonly workflowRunId: string;
      }
    | {
        readonly status: "no_progress";
        readonly reason: "cancelled" | "expired" | "run_terminal";
        readonly workflowRunId: string;
      }
  >;
}

export interface DecideWorkflowApprovalCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly workflowRunId: string;
  readonly approvalRequestId: string;
  readonly decision: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface WorkflowApprovalDecisionResult {
  readonly workflowRunId: string;
  readonly approvalRequestId: string;
  readonly decisionId: string;
  readonly result: "recorded" | "replayed";
}

export type DecideWorkflowApproval = (
  command: DecideWorkflowApprovalCommand,
) => Promise<WorkflowApprovalDecisionResult>;

export interface DecideWorkflowApprovalDependencies {
  readonly clock: Clock;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly ids: IdGenerator;
  readonly digest: CanonicalDigest;
  readonly queries: WorkflowApprovalQueryRepository;
  readonly decisions: WorkflowApprovalDecisionPort;
}

export function workflowApprovalAuthorizationDecisionId(
  approvalRequestId: string,
  idempotencyKeyDigest: string,
): string {
  return `workflow-approval:${approvalRequestId}:${idempotencyKeyDigest.slice("sha256:".length)}`;
}

function validDecision(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).length <= 200
  );
}

function noProgress(reason: "cancelled" | "expired" | "run_terminal"): never {
  let message = "This Workflow Run can no longer accept an approval decision.";
  if (reason === "expired") message = "This approval request has expired.";
  else if (reason === "cancelled") {
    message = "This approval request was cancelled.";
  }
  throw new DomainError(`workflow_approval.${reason}`, message);
}

export function createDecideWorkflowApproval(
  dependencies: DecideWorkflowApprovalDependencies,
): DecideWorkflowApproval {
  return async (command) => {
    if (!command.authority.effectivePermissions.includes("approval.decide")) {
      throw new DomainError(
        "workflow_approval.forbidden",
        "Current authority cannot decide Workflow approvals.",
      );
    }
    if (
      command.idempotencyKey.length < 1 ||
      command.idempotencyKey.length > maximumIdempotencyKeyLength
    ) {
      throw new DomainError(
        "workflow_approval.idempotency_key_invalid",
        "Approval decision idempotency key must contain 1 to 160 characters.",
      );
    }
    if (!validDecision(command.decision)) {
      throw new DomainError(
        "workflow_approval.decision_invalid",
        "Approval decision must be a non-empty bounded JSON object.",
      );
    }
    const approval = await dependencies.queries.findApprovalDecisionContext(
      command.authority.workspaceId,
      command.workflowRunId,
      command.approvalRequestId,
    );
    if (!approval) {
      throw new DomainError(
        "workflow_approval.not_found",
        "Approval request was not found for this Workflow Run.",
      );
    }
    const now = dependencies.clock.now();
    if (approval.lifecycleStatus === "expired" || approval.expiresAt <= now) {
      return noProgress("expired");
    }
    if (approval.lifecycleStatus === "cancelled") {
      return noProgress("cancelled");
    }
    const runtime = await dependencies.runtimeStateReader.read();
    const idempotencyKeyDigest = dependencies.digest.of({
      kind: "workflow_approval_decision_idempotency",
      workspaceId: command.authority.workspaceId,
      approvalRequestId: approval.id,
      actorPrincipalId: command.authority.principalId,
      idempotencyKey: command.idempotencyKey,
    });
    if (!digestPattern.test(idempotencyKeyDigest)) {
      throw new DomainError(
        "workflow_approval.idempotency_key_invalid",
        "Approval decision idempotency identity could not be derived.",
      );
    }
    const result = await dependencies.decisions.decide({
      approvalRequestId: approval.id,
      workspaceId: approval.workspaceId,
      authority: command.authority,
      idempotencyKeyDigest,
      decisionId: dependencies.ids.next(),
      outboxEventId: dependencies.ids.next(),
      decision: command.decision,
      authorization: {
        effect: "allow",
        authorizationDecisionId: workflowApprovalAuthorizationDecisionId(
          approval.id,
          idempotencyKeyDigest,
        ),
        workspaceId: command.authority.workspaceId,
        approvalRequestId: approval.id,
        actorPrincipalId: command.authority.principalId,
        permission: "approval.decide",
        bindingDigest: approval.authorizationContextDigest,
        policyRevision: `authorization-model.v${String(command.authority.authorizationModelVersion)}`,
        authorizedAt: now,
        validUntil: approval.expiresAt,
      },
      executionGeneration: runtime.executionGeneration,
      now,
    });
    if (result.status === "conflict") {
      throw new DomainError(
        "workflow_approval.already_decided",
        "This approval request already has a different immutable decision.",
      );
    }
    if (result.status === "no_progress") {
      return noProgress(result.reason);
    }
    return Object.freeze({
      workflowRunId: result.workflowRunId,
      approvalRequestId: approval.id,
      decisionId: result.decisionId,
      result: result.status,
    });
  };
}
