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
import type {
  ApplicationRuntime,
  TrustedWorkspaceScope,
  WorkflowDefinitionSummary as ApplicationWorkflowDefinitionSummary,
  WorkflowDraftMutationResult as ApplicationWorkflowDraftMutationResult,
  WorkflowDraftView as ApplicationWorkflowDraftView,
} from "@kanvas/application";
import {
  ArchiveWorkflowDraftBodySchema,
  archiveWorkflowDraftRoute,
  CreateWorkflowDraftBodySchema,
  createWorkflowDraftRoute,
  getWorkflowDraftRoute,
  listWorkflowDefinitionsRoute,
  listWorkflowAuthoringCapabilitiesRoute,
  UpdateWorkflowDraftBodySchema,
  updateWorkflowDraftRoute,
  WorkflowDefinitionListQuerySchema,
  WorkflowDefinitionPathSchema,
  WorkflowDraftPathSchema,
  type ArchiveWorkflowDraftBody,
  type CreateWorkflowDraftBody,
  type UpdateWorkflowDraftBody,
  type WorkflowDefinitionList,
  type WorkflowDefinitionListQuery,
  type WorkflowDefinitionSummary,
  type WorkflowDraft,
  type WorkflowDraftMutationResult,
  type WorkflowAuthoringCapabilityList,
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
    .update("kanvas:workflow-authoring-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(scope: TrustedWorkspaceScope, request: FastifyRequest) {
  return Object.freeze({
    auditEventId: ulid(),
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    requestId: request.id,
  });
}

function toSummary(
  value: ApplicationWorkflowDefinitionSummary,
): WorkflowDefinitionSummary {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    workflowKey: value.workflowKey,
    displayName: value.displayName,
    ...(value.description ? { description: value.description } : {}),
    ...(value.category ? { category: value.category } : {}),
    lifecycleStatus: value.lifecycleStatus,
    version: value.version,
    ...(value.draft
      ? {
          draft: {
            id: value.draft.id,
            version: value.draft.version,
            lifecycleStatus: value.draft.lifecycleStatus,
            updatedAt: value.draft.updatedAt.toISOString(),
          },
        }
      : {}),
    ...(value.latestRevision
      ? {
          latestRevision: {
            id: value.latestRevision.id,
            revision: value.latestRevision.revision,
            lifecycleStatus: value.latestRevision.lifecycleStatus,
            ...(value.latestRevision.runtimeStatus
              ? {
                  runtimeStatus: value.latestRevision.runtimeStatus,
                }
              : {}),
            ...(value.latestRevision.publishedAt
              ? {
                  publishedAt: value.latestRevision.publishedAt.toISOString(),
                }
              : {}),
          },
        }
      : {}),
    createdByPrincipalId: value.createdByPrincipalId,
    updatedByPrincipalId: value.updatedByPrincipalId,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toDraft(value: ApplicationWorkflowDraftView): WorkflowDraft {
  return {
    definition: toSummary(value.definition),
    draft: {
      id: value.draft.id,
      version: value.draft.version,
      lifecycleStatus: value.draft.lifecycleStatus,
      canonicalDigest: value.draft.canonicalDigest,
      document: value.draft.document,
      ...(value.draft.derivedFromWorkflowRevisionId
        ? {
            derivedFromWorkflowRevisionId:
              value.draft.derivedFromWorkflowRevisionId,
          }
        : {}),
      createdByPrincipalId: value.draft.createdByPrincipalId,
      updatedByPrincipalId: value.draft.updatedByPrincipalId,
      createdAt: value.draft.createdAt.toISOString(),
      updatedAt: value.draft.updatedAt.toISOString(),
    },
  };
}

function toMutation(
  value: ApplicationWorkflowDraftMutationResult,
): WorkflowDraftMutationResult {
  return {
    value: toDraft(value.value),
    replayed: value.replayed,
  };
}

@Controller()
export class WorkflowAuthoringController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listWorkflowAuthoringCapabilitiesRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async listCapabilities(
    @Req() request: FastifyRequest,
  ): Promise<WorkflowAuthoringCapabilityList> {
    const { scope } = this.contexts.require(request);
    const items = await this.runtime.workflowAuthoring.listCapabilities(scope);
    return {
      items: items.map((item) => ({ ...item })),
    };
  }

  @ContractRoute(listWorkflowDefinitionsRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkflowDefinitionListQuerySchema))
    query: WorkflowDefinitionListQuery,
  ): Promise<WorkflowDefinitionList> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workflowAuthoring.list(scope, {
      includeArchived: query.includeArchived === "true",
      limit: Number(query.limit ?? "50"),
    });
    return {
      items: result.items.map(toSummary),
      truncated: result.truncated,
    };
  }

  @ContractRoute(createWorkflowDraftRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateWorkflowDraftBodySchema))
    body: CreateWorkflowDraftBody,
  ): Promise<WorkflowDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    return toMutation(
      await this.runtime.workflowAuthoring.create({
        authority: scope,
        workflowKey: body.workflowKey,
        displayName: body.displayName,
        ...(body.description ? { description: body.description } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.derivedFromWorkflowRevisionId
          ? {
              derivedFromWorkflowRevisionId: body.derivedFromWorkflowRevisionId,
            }
          : {}),
        document: body.document,
        idempotencyKey: idempotencyKey ?? "",
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(getWorkflowDraftRoute)
  @RequireWorkspacePermission("workflow.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowDefinitionPathSchema))
    params: { readonly workflowDefinitionId: string },
  ): Promise<WorkflowDraft> {
    const { scope } = this.contexts.require(request);
    return toDraft(
      await this.runtime.workflowAuthoring.get(
        scope,
        params.workflowDefinitionId,
      ),
    );
  }

  @ContractRoute(updateWorkflowDraftRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async update(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowDraftPathSchema))
    params: {
      readonly workflowDefinitionId: string;
      readonly workflowDraftId: string;
    },
    @Body(new ContractBodyPipe(UpdateWorkflowDraftBodySchema))
    body: UpdateWorkflowDraftBody,
  ): Promise<WorkflowDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    return toMutation(
      await this.runtime.workflowAuthoring.update({
        authority: scope,
        definitionId: params.workflowDefinitionId,
        draftId: params.workflowDraftId,
        expectedDefinitionVersion: body.expectedDefinitionVersion,
        expectedDraftVersion: body.expectedDraftVersion,
        displayName: body.displayName,
        ...(body.description ? { description: body.description } : {}),
        ...(body.category ? { category: body.category } : {}),
        document: body.document,
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(archiveWorkflowDraftRoute)
  @RequireWorkspacePermission("workflow.author")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async archive(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkflowDraftPathSchema))
    params: {
      readonly workflowDefinitionId: string;
      readonly workflowDraftId: string;
    },
    @Body(new ContractBodyPipe(ArchiveWorkflowDraftBodySchema))
    body: ArchiveWorkflowDraftBody,
  ): Promise<WorkflowDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    return toMutation(
      await this.runtime.workflowAuthoring.archive({
        authority: scope,
        definitionId: params.workflowDefinitionId,
        draftId: params.workflowDraftId,
        expectedDefinitionVersion: body.expectedDefinitionVersion,
        expectedDraftVersion: body.expectedDraftVersion,
        audit: auditFor(scope, request),
      }),
    );
  }
}
