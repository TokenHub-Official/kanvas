import {
  Body,
  BadRequestException,
  Controller,
  Headers,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ApplicationRuntime } from "@kanvas/application";
import {
  CancelWorkflowRunBodySchema,
  cancelWorkflowRunRoute,
  CreateWorkflowRunBodySchema,
  createWorkflowRunRoute,
  getWorkflowRunRoute,
  decideWorkflowApprovalRoute,
  DecideWorkflowApprovalBodySchema,
  listWorkflowRunsRoute,
  WorkflowRunListQuerySchema,
  WorkflowRunPathSchema,
  type CancelWorkflowRunBody,
  type CreateWorkflowRunBody,
  type DecideWorkflowApprovalBody,
  type WorkflowRunAccepted,
  type WorkflowRunCancellationAccepted,
  type WorkflowRunDetails,
  type WorkflowRunList,
  type WorkflowRunListQuery,
  type WorkflowApprovalDecisionResult,
} from "@kanvas/contracts/api";

import type { FastifyRequest } from "fastify";

import { APPLICATION_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { projectRunError } from "./run-error-projection.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function decodeWorkflowRunCursor(cursor: string): {
  readonly createdAt: Date;
  readonly id: string;
} {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Cursor payload must be an object.");
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof record.createdAt !== "string" ||
      typeof record.id !== "string" ||
      !idPattern.test(record.id)
    ) {
      throw new TypeError("Cursor fields are invalid.");
    }
    const createdAt = new Date(record.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      throw new TypeError("Cursor timestamp is invalid.");
    }
    return { createdAt, id: record.id };
  } catch {
    throw new BadRequestException("Workflow run cursor is invalid.");
  }
}

function encodeWorkflowRunCursor(cursor: {
  readonly createdAt: Date;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

@Controller()
export class WorkflowRunController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(createWorkflowRunRoute)
  @RequireWorkspacePermission("workflow.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateWorkflowRunBodySchema))
    body: CreateWorkflowRunBody,
  ): Promise<WorkflowRunAccepted> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workflow.createRun({
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      workflowRevisionId: body.workflowRevisionId,
      ...(body.brandKitRevisionId !== undefined
        ? { brandKitRevisionId: body.brandKitRevisionId }
        : {}),
      canReadBrand: scope.effectivePermissions.includes("brand.read"),
      idempotencyKey: idempotencyKey ?? "",
      input: body.input,
    });

    return {
      id: result.run.id,
      ...(result.run.brand ? { brand: result.run.brand } : {}),
      definitionKind: result.run.definitionKind,
      ...(result.run.workflowRevisionId
        ? { workflowRevisionId: result.run.workflowRevisionId }
        : {}),
      ...(result.run.publicationCandidateId
        ? {
            publicationCandidateId: result.run.publicationCandidateId,
          }
        : {}),
      nonProduction: result.run.nonProduction,
      lifecycleStatus: result.run.lifecycleStatus,
      outcome: result.run.outcome,
      ...(result.run.executionDeadlineAt
        ? {
            executionDeadlineAt: result.run.executionDeadlineAt.toISOString(),
          }
        : {}),
      createdAt: result.run.createdAt.toISOString(),
      replayed: result.replayed,
    };
  }

  @ContractRoute(listWorkflowRunsRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkflowRunListQuerySchema))
    query: WorkflowRunListQuery,
  ): Promise<WorkflowRunList> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workflow.listRuns({
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      ...(query.workflowRevisionId
        ? { workflowRevisionId: query.workflowRevisionId }
        : {}),
      state: query.state ?? "all",
      ...(query.cursor
        ? { cursor: decodeWorkflowRunCursor(query.cursor) }
        : {}),
      limit: Number(query.limit ?? "20"),
    });
    return {
      items: result.items.map((run) => ({
        id: run.id,
        ...(run.brand ? { brand: run.brand } : {}),
        workflowRevisionId: run.workflowRevisionId,
        displayName: run.displayName,
        ...(run.description ? { description: run.description } : {}),
        lifecycleStatus: run.lifecycleStatus,
        outcome: run.outcome,
        output: run.output,
        createdAt: run.createdAt.toISOString(),
        ...(run.completedAt
          ? { completedAt: run.completedAt.toISOString() }
          : {}),
      })),
      ...(result.nextCursor
        ? { nextCursor: encodeWorkflowRunCursor(result.nextCursor) }
        : {}),
    };
  }

  @ContractRoute(getWorkflowRunRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowRunPathSchema))
    params: { readonly workflowRunId: string },
  ): Promise<WorkflowRunDetails> {
    const { scope } = this.contexts.require(request);
    const run = await this.runtime.workflow.getRun({
      workspaceId: scope.workspaceId,
      workflowRunId: params.workflowRunId,
      actorId: scope.principalId,
    });
    return {
      id: run.id,
      ...(run.pendingApprovals
        ? {
            pendingApprovals: run.pendingApprovals.map((approval) => ({
              id: approval.id,
              nodeRunId: approval.nodeRunId,
              nodeKey: approval.nodeKey,
              ...(approval.title ? { title: approval.title } : {}),
              ...(approval.message ? { message: approval.message } : {}),
              decisionSchema: approval.decisionSchema,
              expiresAt: approval.expiresAt.toISOString(),
            })),
          }
        : {}),
      ...(run.browserExecution
        ? {
            browserExecution: {
              requiredCapabilityKeys: [
                ...run.browserExecution.requiredCapabilityKeys,
              ],
            },
          }
        : {}),
      ...(run.brand ? { brand: run.brand } : {}),
      definitionKind: run.definitionKind ?? "published_revision",
      ...(run.workflowRevisionId
        ? { workflowRevisionId: run.workflowRevisionId }
        : {}),
      ...(run.publicationCandidateId
        ? {
            publicationCandidateId: run.publicationCandidateId,
          }
        : {}),
      nonProduction: run.nonProduction ?? false,
      lifecycleStatus: run.lifecycleStatus,
      outcome: run.outcome,
      version: run.version,
      input: run.input,
      output: run.output,
      nodes: (run.nodes ?? []).map((node) => ({
        id: node.id,
        nodeKey: node.nodeKey,
        scopeKey: node.scopeKey,
        kind: node.kind,
        lifecycleStatus: node.lifecycleStatus,
        ...(node.waitingReason ? { waitingReason: node.waitingReason } : {}),
        output: node.output,
        error: projectRunError(
          node.error,
          scope.effectivePermissions.includes("audit.read"),
        ),
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        ...(node.completedAt
          ? { completedAt: node.completedAt.toISOString() }
          : {}),
      })),
      ...(run.executionDeadlineAt
        ? {
            executionDeadlineAt: run.executionDeadlineAt.toISOString(),
          }
        : {}),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      ...(run.completedAt
        ? { completedAt: run.completedAt.toISOString() }
        : {}),
      ...(run.cancelRequestedAt
        ? { cancelRequestedAt: run.cancelRequestedAt.toISOString() }
        : {}),
      ...(run.cancelReasonCode
        ? { cancelReasonCode: run.cancelReasonCode }
        : {}),
      ...(run.cancelDeadlineAt
        ? { cancelDeadlineAt: run.cancelDeadlineAt.toISOString() }
        : {}),
    };
  }

  @ContractRoute(decideWorkflowApprovalRoute)
  @RequireWorkspacePermission("approval.decide")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async decideApproval(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(WorkflowRunPathSchema))
    params: { readonly workflowRunId: string },
    @Body(new ContractBodyPipe(DecideWorkflowApprovalBodySchema))
    body: DecideWorkflowApprovalBody,
  ): Promise<WorkflowApprovalDecisionResult> {
    const { scope } = this.contexts.require(request);
    return this.runtime.workflow.decideApproval({
      authority: scope,
      workflowRunId: params.workflowRunId,
      approvalRequestId: body.approvalRequestId,
      decision: body.decision,
      idempotencyKey: idempotencyKey ?? "",
    });
  }

  @ContractRoute(cancelWorkflowRunRoute)
  @RequireWorkspacePermission("workflow.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async cancel(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowRunPathSchema))
    params: { readonly workflowRunId: string },
    @Body(new ContractBodyPipe(CancelWorkflowRunBodySchema))
    body: CancelWorkflowRunBody,
  ): Promise<WorkflowRunCancellationAccepted> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workflow.cancelRun({
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      workflowRunId: params.workflowRunId,
      ...(body.reasonCode ? { reasonCode: body.reasonCode } : {}),
    });
    return {
      id: result.run.id,
      lifecycleStatus: result.run.lifecycleStatus,
      version: result.run.version,
      cancelRequestedAt: result.run.cancelRequestedAt.toISOString(),
      cancelReasonCode: result.run.cancelReasonCode,
      cancelDeadlineAt: result.run.cancelDeadlineAt.toISOString(),
      replayed: result.replayed,
    };
  }
}
