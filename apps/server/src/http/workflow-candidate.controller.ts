import { createHash } from "node:crypto";

import {
  Body,
  Controller,
  Header,
  Headers,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DomainError,
  type ApplicationRuntime,
  type TrustedWorkspaceScope,
  type WorkflowCandidateReview as ApplicationCandidateReview,
  type WorkflowPublicationCandidateRecord,
} from "@kanvas/application";
import {
  getWorkflowCandidateRoute,
  listWorkflowCandidatesRoute,
  publishWorkflowCandidateRoute,
  PublishWorkflowCandidateBodySchema,
  recordWorkflowCandidateEvalRoute,
  RecordWorkflowCandidateEvalBodySchema,
  reviewWorkflowCandidateRoute,
  ReviewWorkflowCandidateBodySchema,
  startWorkflowCandidateTestRoute,
  StartWorkflowCandidateTestBodySchema,
  submitWorkflowCandidateRoute,
  SubmitWorkflowCandidateBodySchema,
  WorkflowCandidateListQuerySchema,
  WorkflowCandidatePathSchema,
  WorkflowDraftPathSchema,
  type PublishWorkflowCandidateBody,
  type RecordWorkflowCandidateEvalBody,
  type ReviewWorkflowCandidateBody,
  type StartWorkflowCandidateTestBody,
  type SubmitWorkflowCandidateBody,
  type WorkflowCandidate,
  type WorkflowCandidateList,
  type WorkflowCandidateListQuery,
  type WorkflowCandidateReview,
  type WorkflowRunAccepted,
} from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import { APPLICATION_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:workflow-publication-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(scope: TrustedWorkspaceScope, request: FastifyRequest) {
  return Object.freeze({
    auditEventId: ulid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    requestId: request.id,
  });
}

function toCandidate(
  value: WorkflowPublicationCandidateRecord,
): WorkflowCandidate {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    subjectKind: "workflow",
    subjectKey: value.subjectKey,
    sourceDraftId: value.sourceDraftId,
    sourceDraftVersion: value.sourceDraftVersion,
    schemaVersion: 1,
    contentDocument:
      value.contentDocument as WorkflowCandidate["contentDocument"],
    canonicalDigest: value.canonicalDigest,
    parserProfileVersion: value.parserProfileVersion,
    createdByPrincipalId: value.createdByPrincipalId,
    createdAt: value.createdAt.toISOString(),
  };
}

function toReview(value: ApplicationCandidateReview): WorkflowCandidateReview {
  return {
    candidate: toCandidate(value.candidate),
    ...(value.latestTestRunId
      ? { latestTestRunId: value.latestTestRunId }
      : {}),
    ...(value.activeTestRunIds
      ? { activeTestRunIds: [...value.activeTestRunIds] }
      : {}),
    checks: value.checks.map((check) => ({
      ...check,
      checkedAt: check.checkedAt.toISOString(),
    })),
    ...(value.review
      ? {
          review: {
            ...value.review,
            decidedAt: value.review.decidedAt.toISOString(),
          },
        }
      : {}),
    ...(value.publishedRevision
      ? {
          publishedRevision: {
            ...value.publishedRevision,
            publishedAt: value.publishedRevision.publishedAt.toISOString(),
          },
        }
      : {}),
  };
}

function toAccepted(
  run: Awaited<
    ReturnType<ApplicationRuntime["workflow"]["createCandidateTestRun"]>
  >,
): WorkflowRunAccepted {
  return {
    id: run.run.id,
    definitionKind: run.run.definitionKind,
    ...(run.run.publicationCandidateId
      ? {
          publicationCandidateId: run.run.publicationCandidateId,
        }
      : {}),
    nonProduction: run.run.nonProduction,
    lifecycleStatus: run.run.lifecycleStatus,
    outcome: run.run.outcome,
    ...(run.run.executionDeadlineAt
      ? {
          executionDeadlineAt: run.run.executionDeadlineAt.toISOString(),
        }
      : {}),
    createdAt: run.run.createdAt.toISOString(),
    replayed: run.replayed,
  };
}

@Controller()
export class WorkflowCandidateController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listWorkflowCandidatesRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkflowCandidateListQuerySchema))
    query: WorkflowCandidateListQuery,
  ): Promise<WorkflowCandidateList> {
    const { scope } = this.contexts.require(request);
    const items = await this.runtime.workflowPublication.list(
      scope,
      query.workflowKey,
    );
    return { items: items.map(toCandidate) };
  }

  @ContractRoute(submitWorkflowCandidateRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async submit(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowDraftPathSchema))
    params: {
      readonly workflowDefinitionId: string;
      readonly workflowDraftId: string;
    },
    @Body(new ContractBodyPipe(SubmitWorkflowCandidateBodySchema))
    body: SubmitWorkflowCandidateBody,
  ): Promise<WorkflowCandidateReview> {
    const { scope } = this.contexts.require(request);
    const draft = await this.runtime.workflowAuthoring.get(
      scope,
      params.workflowDefinitionId,
    );
    if (draft.draft.id !== params.workflowDraftId) {
      throw new DomainError(
        "workflow_publication.not_found",
        "Workflow Draft does not belong to this Workflow Definition.",
      );
    }
    return toReview(
      await this.runtime.workflowPublication.submit({
        authority: scope,
        draftId: params.workflowDraftId,
        expectedDraftVersion: body.expectedDraftVersion,
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(getWorkflowCandidateRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowCandidatePathSchema))
    params: { readonly workflowCandidateId: string },
  ): Promise<WorkflowCandidateReview> {
    const { scope } = this.contexts.require(request);
    return toReview(
      await this.runtime.workflowPublication.get(
        scope,
        params.workflowCandidateId,
      ),
    );
  }

  @ContractRoute(startWorkflowCandidateTestRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async startTest(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(WorkflowCandidatePathSchema))
    params: { readonly workflowCandidateId: string },
    @Body(new ContractBodyPipe(StartWorkflowCandidateTestBodySchema))
    body: StartWorkflowCandidateTestBody,
  ): Promise<WorkflowRunAccepted> {
    const { scope } = this.contexts.require(request);
    if (!scope.effectivePermissions.includes("workflow.run")) {
      throw new DomainError(
        "workflow_publication.forbidden",
        "Candidate testing also requires workflow.run.",
      );
    }
    return toAccepted(
      await this.runtime.workflow.createCandidateTestRun({
        workspaceId: scope.workspaceId,
        actorId: scope.principalId,
        publicationCandidateId: params.workflowCandidateId,
        idempotencyKey: idempotencyKey ?? "",
        input: body.input,
      }),
    );
  }

  @ContractRoute(recordWorkflowCandidateEvalRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async recordEval(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowCandidatePathSchema))
    params: { readonly workflowCandidateId: string },
    @Body(new ContractBodyPipe(RecordWorkflowCandidateEvalBodySchema))
    body: RecordWorkflowCandidateEvalBody,
  ): Promise<WorkflowCandidateReview> {
    const { scope } = this.contexts.require(request);
    const run = await this.runtime.workflow.getRun({
      workspaceId: scope.workspaceId,
      workflowRunId: body.workflowRunId,
      actorId: scope.principalId,
    });
    return toReview(
      await this.runtime.workflowPublication.recordEval({
        authority: scope,
        candidateId: params.workflowCandidateId,
        expectedCandidateDigest: body.expectedCandidateDigest,
        run,
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(reviewWorkflowCandidateRoute)
  @RequireWorkspacePermission("workflow.publish")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async review(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowCandidatePathSchema))
    params: { readonly workflowCandidateId: string },
    @Body(new ContractBodyPipe(ReviewWorkflowCandidateBodySchema))
    body: ReviewWorkflowCandidateBody,
  ): Promise<WorkflowCandidateReview> {
    const { scope } = this.contexts.require(request);
    return toReview(
      await this.runtime.workflowPublication.review({
        authority: scope,
        candidateId: params.workflowCandidateId,
        expectedCandidateDigest: body.expectedCandidateDigest,
        decision: body.decision,
        ...(body.commentSummary ? { commentSummary: body.commentSummary } : {}),
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(publishWorkflowCandidateRoute)
  @RequireWorkspacePermission("workflow.publish")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publish(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowCandidatePathSchema))
    params: { readonly workflowCandidateId: string },
    @Body(new ContractBodyPipe(PublishWorkflowCandidateBodySchema))
    body: PublishWorkflowCandidateBody,
  ): Promise<WorkflowCandidateReview> {
    const { scope } = this.contexts.require(request);
    return toReview(
      await this.runtime.workflowPublication.publish({
        authority: scope,
        candidateId: params.workflowCandidateId,
        expectedCandidateDigest: body.expectedCandidateDigest,
        audit: auditFor(scope, request),
      }),
    );
  }
}
