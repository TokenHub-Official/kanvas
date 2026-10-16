import type { TrustedWorkspaceScope } from "../../authorization/index.js";
import { DomainError } from "../../../foundation/domain-error.js";
import type { WorkflowRunView } from "../../workflow/index.js";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import { validateWorkflowTopology } from "../../workflow/index.js";

export type WorkflowPublicationCheckKind =
  "schema" | "resources" | "security" | "compatibility" | "eval";

export interface WorkflowPublicationCandidateRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKind: "workflow";
  readonly subjectKey: string;
  readonly sourceDraftId: string;
  readonly sourceDraftVersion: number;
  readonly schemaVersion: 1;
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly canonicalDigest: string;
  readonly parserProfileVersion: string;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
}

export interface WorkflowCandidateReview {
  readonly candidate: WorkflowPublicationCandidateRecord;
  readonly latestTestRunId?: string;
  readonly activeTestRunIds?: readonly string[];
  readonly checks: readonly {
    readonly id: string;
    readonly checkKind: WorkflowPublicationCheckKind;
    readonly checkProfileVersion: string;
    readonly outcome: "passed" | "failed";
    readonly evidenceSummary: Readonly<Record<string, unknown>>;
    readonly evidenceDigest: string;
    readonly checkedAt: Date;
  }[];
  readonly review?: {
    readonly id: string;
    readonly decision: "approved" | "rejected";
    readonly commentSummary?: string;
    readonly reviewerPrincipalId: string;
    readonly decidedAt: Date;
  };
  readonly publishedRevision?: {
    readonly id: string;
    readonly workspaceId: string;
    readonly subjectKind: "workflow";
    readonly subjectKey: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly runtimeStatus: "enabled";
    readonly publishedAt: Date;
  };
}

export interface WorkflowPublicationAuditContext {
  readonly auditEventId: string;
  readonly actorPrincipalId: string | null;
  readonly actorType: "human" | "service" | "system";
  readonly authenticationRefType:
    "session" | "service_api_token" | "deployment" | "cli_recovery" | "none";
  readonly authenticationRefHash: string | null;
  readonly authorityType:
    | "human_membership"
    | "service_grant"
    | "instance_administrator"
    | "system"
    | "none";
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly requestId?: string;
  readonly traceId?: string;
}

interface CommonPublicationCommand {
  readonly workspaceId: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: WorkflowPublicationAuditContext;
}

export interface WorkflowPublicationPort {
  listWorkflowCandidates(
    workspaceId: string,
    workflowKey?: string,
  ): Promise<readonly WorkflowPublicationCandidateRecord[]>;
  getWorkflowCandidateReview(
    workspaceId: string,
    candidateId: string,
  ): Promise<WorkflowCandidateReview | undefined>;
  submitCandidate(
    options: CommonPublicationCommand & {
      readonly candidateId: string;
      readonly draftId: string;
      readonly subjectKind: "workflow";
      readonly expectedDraftVersion: number;
      readonly parserProfileVersion: string;
    },
  ): Promise<WorkflowPublicationCandidateRecord>;
  recordCheck(
    options: CommonPublicationCommand & {
      readonly checkId: string;
      readonly candidateId: string;
      readonly checkKind: WorkflowPublicationCheckKind;
      readonly checkProfileVersion: string;
      readonly outcome: "passed" | "failed";
      readonly evidenceSummary: Readonly<Record<string, unknown>>;
      readonly expectedCandidateDigest: string;
    },
  ): Promise<void>;
  reviewCandidate(
    options: CommonPublicationCommand & {
      readonly reviewDecisionId: string;
      readonly candidateId: string;
      readonly decision: "approved" | "rejected";
      readonly expectedCandidateDigest: string;
      readonly commentSummary?: string;
    },
  ): Promise<void>;
  publishWorkflow(
    options: CommonPublicationCommand & {
      readonly candidateId: string;
      readonly workflowRevisionId: string;
      readonly expectedCandidateDigest: string;
    },
  ): Promise<NonNullable<WorkflowCandidateReview["publishedRevision"]>>;
}

export interface WorkflowPublicationDependencies {
  readonly port: WorkflowPublicationPort;
  readonly now: () => Date;
  readonly nextId: () => string;
}

function requirePermission(
  authority: TrustedWorkspaceScope,
  permission:
    "workflow.read" | "workflow.author" | "workflow.publish" | "workflow.run",
): void {
  if (!authority.effectivePermissions.includes(permission)) {
    throw new DomainError(
      "workflow_publication.forbidden",
      `Current authority does not have ${permission}.`,
    );
  }
}

function topologyFrom(candidate: WorkflowPublicationCandidateRecord) {
  const topology = candidate.contentDocument.topology;
  if (!isWorkflowTopology(topology)) {
    throw new DomainError(
      "workflow_publication.candidate_invalid",
      "Workflow Candidate topology is missing.",
    );
  }
  return topology;
}

export interface WorkflowPublication {
  list(
    authority: TrustedWorkspaceScope,
    workflowKey?: string,
  ): Promise<readonly WorkflowPublicationCandidateRecord[]>;
  get(
    authority: TrustedWorkspaceScope,
    candidateId: string,
  ): Promise<WorkflowCandidateReview>;
  submit(command: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly audit: WorkflowPublicationAuditContext;
  }): Promise<WorkflowCandidateReview>;
  recordEval(command: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly expectedCandidateDigest: string;
    readonly run: WorkflowRunView;
    readonly audit: WorkflowPublicationAuditContext;
  }): Promise<WorkflowCandidateReview>;
  review(command: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly expectedCandidateDigest: string;
    readonly decision: "approved" | "rejected";
    readonly commentSummary?: string;
    readonly audit: WorkflowPublicationAuditContext;
  }): Promise<WorkflowCandidateReview>;
  publish(command: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly expectedCandidateDigest: string;
    readonly audit: WorkflowPublicationAuditContext;
  }): Promise<WorkflowCandidateReview>;
}

export function createWorkflowPublication(
  dependencies: WorkflowPublicationDependencies,
): WorkflowPublication {
  const read = async (
    authority: TrustedWorkspaceScope,
    candidateId: string,
  ) => {
    const value = await dependencies.port.getWorkflowCandidateReview(
      authority.workspaceId,
      candidateId,
    );
    if (!value) {
      throw new DomainError(
        "workflow_publication.not_found",
        "Workflow Candidate was not found.",
      );
    }
    return value;
  };
  const publication: WorkflowPublication = {
    list(authority, workflowKey) {
      requirePermission(authority, "workflow.read");
      return dependencies.port.listWorkflowCandidates(
        authority.workspaceId,
        workflowKey,
      );
    },
    get(authority, candidateId) {
      requirePermission(authority, "workflow.read");
      return read(authority, candidateId);
    },
    async submit(command) {
      requirePermission(command.authority, "workflow.author");
      const existingCandidates = await dependencies.port.listWorkflowCandidates(
        command.authority.workspaceId,
      );
      const existing = existingCandidates.find(
        (candidate) =>
          candidate.sourceDraftId === command.draftId &&
          candidate.sourceDraftVersion === command.expectedDraftVersion,
      );
      if (existing) {
        return read(command.authority, existing.id);
      }
      const now = dependencies.now();
      const candidate = await dependencies.port.submitCandidate({
        candidateId: dependencies.nextId(),
        draftId: command.draftId,
        workspaceId: command.authority.workspaceId,
        subjectKind: "workflow",
        expectedDraftVersion: command.expectedDraftVersion,
        parserProfileVersion: "workflow-v1",
        actorPrincipalId: command.authority.principalId,
        now,
        audit: command.audit,
      });
      const validation = validateWorkflowTopology({
        topology: topologyFrom(candidate),
      });
      const checks: readonly {
        readonly kind: Exclude<WorkflowPublicationCheckKind, "eval">;
        readonly outcome: "passed" | "failed";
        readonly evidence: Readonly<Record<string, unknown>>;
      }[] = [
        {
          kind: "schema",
          outcome: validation.valid ? "passed" : "failed",
          evidence: {
            diagnosticCount: validation.diagnostics.length,
          },
        },
        {
          kind: "resources",
          outcome: "passed",
          evidence: {
            profile: "workflow-inline-definition",
            externalResourceCount: 0,
          },
        },
        {
          kind: "security",
          outcome: "passed",
          evidence: {
            profile: "declarative-workflow-v1",
            executablePackageScripts: false,
          },
        },
        {
          kind: "compatibility",
          outcome:
            candidate.contentDocument.schemaVersion === 1 ? "passed" : "failed",
          evidence: {
            documentSchemaVersion:
              candidate.contentDocument.schemaVersion ?? null,
          },
        },
      ];
      for (const check of checks) {
        await dependencies.port.recordCheck({
          checkId: dependencies.nextId(),
          candidateId: candidate.id,
          workspaceId: command.authority.workspaceId,
          checkKind: check.kind,
          checkProfileVersion: "workflow-v1",
          outcome: check.outcome,
          evidenceSummary: check.evidence,
          expectedCandidateDigest: candidate.canonicalDigest,
          actorPrincipalId: command.authority.principalId,
          now,
          audit: {
            ...command.audit,
            auditEventId: dependencies.nextId(),
          },
        });
      }
      return read(command.authority, candidate.id);
    },
    async recordEval(command) {
      requirePermission(command.authority, "workflow.author");
      requirePermission(command.authority, "workflow.run");
      if (
        command.run.definitionKind !== "publication_candidate" ||
        command.run.publicationCandidateId !== command.candidateId ||
        !command.run.nonProduction
      ) {
        throw new DomainError(
          "workflow_publication.eval_run_mismatch",
          "Eval evidence must come from the same non-production Candidate Test Run.",
        );
      }
      if (
        command.run.lifecycleStatus !== "completed" &&
        command.run.lifecycleStatus !== "failed" &&
        command.run.lifecycleStatus !== "cancelled"
      ) {
        throw new DomainError(
          "workflow_publication.eval_run_active",
          "Candidate Test Run must be terminal before recording Eval evidence.",
        );
      }
      const passed =
        command.run.lifecycleStatus === "completed" &&
        command.run.outcome !== "no_usable_output";
      await dependencies.port.recordCheck({
        checkId: dependencies.nextId(),
        candidateId: command.candidateId,
        workspaceId: command.authority.workspaceId,
        checkKind: "eval",
        checkProfileVersion: "candidate-test-v1",
        outcome: passed ? "passed" : "failed",
        evidenceSummary: {
          workflowRunId: command.run.id,
          lifecycleStatus: command.run.lifecycleStatus,
          outcome: command.run.outcome,
        },
        expectedCandidateDigest: command.expectedCandidateDigest,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
      return read(command.authority, command.candidateId);
    },
    async review(command) {
      requirePermission(command.authority, "workflow.publish");
      const current = await read(command.authority, command.candidateId);
      if (
        current.review?.decision === command.decision &&
        current.candidate.canonicalDigest === command.expectedCandidateDigest
      ) {
        return current;
      }
      await dependencies.port.reviewCandidate({
        reviewDecisionId: dependencies.nextId(),
        candidateId: command.candidateId,
        workspaceId: command.authority.workspaceId,
        decision: command.decision,
        expectedCandidateDigest: command.expectedCandidateDigest,
        ...(command.commentSummary
          ? { commentSummary: command.commentSummary }
          : {}),
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
      return read(command.authority, command.candidateId);
    },
    async publish(command) {
      requirePermission(command.authority, "workflow.publish");
      const current = await read(command.authority, command.candidateId);
      if (current.publishedRevision) {
        return current;
      }
      await dependencies.port.publishWorkflow({
        candidateId: command.candidateId,
        workflowRevisionId: dependencies.nextId(),
        workspaceId: command.authority.workspaceId,
        expectedCandidateDigest: command.expectedCandidateDigest,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
      return read(command.authority, command.candidateId);
    },
  };
  return Object.freeze(publication);
}
