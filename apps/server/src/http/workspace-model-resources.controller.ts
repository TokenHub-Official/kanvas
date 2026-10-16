import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  cancelWorkspaceModelResourceImportRoute,
  CancelModelResourceImportBodySchema,
  getWorkspaceModelResourceImportRoute,
  ModelResourcePathSchema,
  ModelResourceImportPathSchema,
  publishWorkspaceModelResourceImportRoute,
  PublishModelResourceImportBodySchema,
  startWorkspaceModelResourceImportRoute,
  StartModelResourceImportBodySchema,
  SetModelResourceStatusBodySchema,
  uploadWorkspaceModelResourceImportRoute,
  listWorkspaceModelResourcesRoute,
  setWorkspaceModelResourceStatusRoute,
  type ModelResourceImportIngestion,
  type ModelResourceImportSummary,
  type CancelModelResourceImportBody,
  type ModelResourceMutationResult,
  type PublishModelResourceImportBody,
  type SetModelResourceStatusBody,
  type StartModelResourceImportBody,
  type WorkspaceModelResources,
} from "@kanvas/contracts/api";
import {
  ModelResourceAdminStoreError,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { ModelResourceImportService } from "../model-resources/model-resource-import.service.js";
import {
  modelResourceMutationFrom,
  modelResourceSummaryFrom,
} from "../model-resources/model-resource-presenter.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:model-resource-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function requireByteStream(body: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof (body as { readonly [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] !== "function"
  ) {
    throw new BadRequestException(
      "Model resource content must be a binary stream.",
    );
  }
  return body as AsyncIterable<Uint8Array>;
}

function auditFor(
  scope: TrustedWorkspaceScope,
  request: FastifyRequest,
): ControlPlaneAuditContext {
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

function mapError(error: unknown): never {
  if (error instanceof ModelResourceAdminStoreError) {
    if (error.code === "model_resource.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "model_resource.version_conflict" ||
      error.code === "model_resource.lifecycle_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Controller()
export class WorkspaceModelResourcesController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly imports: ModelResourceImportService,
  ) {}

  @ContractRoute(startWorkspaceModelResourceImportRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async startImport(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body(new ContractBodyPipe(StartModelResourceImportBodySchema))
    body: StartModelResourceImportBody,
  ): Promise<ModelResourceImportSummary> {
    const { scope } = this.contexts.require(request);
    return this.imports.start(scope, requestKey ?? "", body, request.id);
  }

  @ContractRoute(getWorkspaceModelResourceImportRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async getImport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(ModelResourceImportPathSchema))
    params: { readonly modelResourceImportId: string },
  ): Promise<ModelResourceImportSummary> {
    const { scope } = this.contexts.require(request);
    return this.imports.get(scope, params.modelResourceImportId);
  }

  @ContractRoute(cancelWorkspaceModelResourceImportRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async cancelImport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(ModelResourceImportPathSchema))
    params: { readonly modelResourceImportId: string },
    @Body(new ContractBodyPipe(CancelModelResourceImportBodySchema))
    body: CancelModelResourceImportBody,
  ): Promise<ModelResourceImportSummary> {
    void body;
    const { scope } = this.contexts.require(request);
    return this.imports.cancel(scope, params.modelResourceImportId, request.id);
  }

  @ContractRoute(uploadWorkspaceModelResourceImportRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async uploadImport(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(ModelResourceImportPathSchema))
    params: { readonly modelResourceImportId: string },
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<ModelResourceImportIngestion> {
    if (
      contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/octet-stream"
    ) {
      throw new UnsupportedMediaTypeException(
        "Model resource content type must be application/octet-stream.",
      );
    }
    const { scope } = this.contexts.require(request);
    return this.imports.upload(
      scope,
      params.modelResourceImportId,
      requireByteStream(body),
    );
  }

  @ContractRoute(publishWorkspaceModelResourceImportRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publishImport(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Param(new ContractBodyPipe(ModelResourceImportPathSchema))
    params: { readonly modelResourceImportId: string },
    @Body(new ContractBodyPipe(PublishModelResourceImportBodySchema))
    body: PublishModelResourceImportBody,
  ): Promise<ModelResourceMutationResult> {
    const { scope } = this.contexts.require(request);
    return this.imports.publish(
      scope,
      params.modelResourceImportId,
      requestKey ?? "",
      body,
      request.id,
    );
  }

  @ContractRoute(listWorkspaceModelResourcesRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceModelResources> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const [records, catalogEntries] = await Promise.all([
      this.database.modelResources.list(scope, now),
      this.database.modelResources.listCatalogEntries(scope, now),
    ]);
    return {
      generatedAt: now.toISOString(),
      resources: records.map(modelResourceSummaryFrom),
      catalogCandidates: catalogEntries.map((entry) => ({
        id: entry.id,
        key: entry.document.resourceKey,
        revision: entry.document.revision,
        displayName: entry.document.displayName,
        ...(entry.document.description
          ? { description: entry.document.description }
          : {}),
        format: entry.document.format,
        ...(entry.document.expectedByteSize
          ? { expectedByteSize: entry.document.expectedByteSize }
          : {}),
        executionTargets: [...entry.document.executionTargets],
        sourceHost: new URL(entry.document.sourceUrl).hostname,
        installed: records.some(
          (record) =>
            record.key === entry.document.resourceKey &&
            record.revision === entry.document.revision &&
            record.revisionDigest === entry.document.revisionDigest,
        ),
      })),
    };
  }

  @ContractRoute(setWorkspaceModelResourceStatusRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async setStatus(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(ModelResourcePathSchema))
    params: { readonly modelResourceId: string },
    @Body(new ContractBodyPipe(SetModelResourceStatusBodySchema))
    body: SetModelResourceStatusBody,
  ): Promise<ModelResourceMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return modelResourceMutationFrom(
        await this.database.modelResources.setStatus({
          scope,
          resourceId: params.modelResourceId,
          expectedVersion: body.expectedVersion,
          status: body.status,
          now: new Date(),
          audit: auditFor(scope, request),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
