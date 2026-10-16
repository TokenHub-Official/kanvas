import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CanvasDraftListQuerySchema,
  CanvasDraftPathSchema,
  CanvasDraftRevisionListQuerySchema,
  CanvasDraftRevisionPathSchema,
  CreateCanvasDraftBodySchema,
  createCanvasDraftRoute,
  getCanvasDraftRoute,
  getCanvasDraftRevisionRoute,
  listCanvasDraftsRoute,
  listCanvasDraftRevisionsRoute,
  RestoreCanvasDraftBodySchema,
  restoreCanvasDraftRoute,
  UpdateCanvasDraftBodySchema,
  UpdateCanvasDraftBrandBodySchema,
  updateCanvasDraftBrandRoute,
  updateCanvasDraftRoute,
  type CanvasDraft,
  type CanvasDraftList,
  type CanvasDraftListQuery,
  type CanvasDraftMutationResult,
  type CanvasDraftRevision,
  type CanvasDraftRevisionList,
  type CanvasDraftRevisionListQuery,
  type CanvasDraftRevisionSummary,
  type CreateCanvasDraftBody,
  type RestoreCanvasDraftBody,
  type UpdateCanvasDraftBody,
  type UpdateCanvasDraftBrandBody,
} from "@kanvas/contracts/api";
import {
  CanvasDraftStoreError,
  type CanvasDraftRecord,
  type CanvasDraftRevisionRecord,
  type CanvasDraftRevisionSummary as DatabaseCanvasDraftRevisionSummary,
  type CanvasDraftSummaryRecord,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:canvas-draft-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function problem(
  status: number,
  code: string,
  detail: string,
): Readonly<Record<string, unknown>> {
  return {
    type: `https://kanvas.invalid/problems/${code.replaceAll(".", "-")}`,
    title: "Canvas Draft request was rejected",
    status,
    code,
    detail,
  };
}

function mapCanvasDraftError(error: unknown): never {
  if (!(error instanceof CanvasDraftStoreError)) {
    throw error;
  }
  if (error.code === "canvas_draft.invalid_argument") {
    throw new BadRequestException(problem(400, error.code, error.message));
  }
  if (error.code === "canvas_draft.forbidden") {
    throw new ForbiddenException(problem(403, error.code, error.message));
  }
  if (error.code === "canvas_draft.not_found") {
    throw new NotFoundException(problem(404, error.code, error.message));
  }
  throw new ConflictException(problem(409, error.code, error.message));
}

function toApiDraft(draft: CanvasDraftRecord): CanvasDraft {
  return {
    id: draft.id,
    workspaceId: draft.workspaceId,
    ...(draft.brand ? { brand: draft.brand } : {}),
    document: draft.document,
    version: draft.version,
    createdByPrincipalId: draft.createdByPrincipalId,
    updatedByPrincipalId: draft.updatedByPrincipalId,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function toMutationResult(
  result: Awaited<ReturnType<ServerDatabaseRuntime["canvasDrafts"]["create"]>>,
): CanvasDraftMutationResult {
  return {
    draft: toApiDraft(result.draft),
    replayed: result.replayed,
  };
}

function toRevisionSummary(
  revision: DatabaseCanvasDraftRevisionSummary,
): CanvasDraftRevisionSummary {
  return {
    version: revision.version,
    title: revision.title,
    contentDigest: revision.contentDigest,
    kind: revision.kind,
    ...(revision.restoredFromVersion !== undefined
      ? {
          restoredFromVersion: revision.restoredFromVersion,
        }
      : {}),
    ...(revision.brand ? { brand: revision.brand } : {}),
    createdByPrincipalId: revision.createdByPrincipalId,
    createdAt: revision.createdAt.toISOString(),
  };
}

function toRevision(revision: CanvasDraftRevisionRecord): CanvasDraftRevision {
  return {
    canvasDraftId: revision.canvasDraftId,
    workspaceId: revision.workspaceId,
    ...toRevisionSummary(revision),
    document: revision.document,
  };
}

@Controller()
export class CanvasDraftController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listCanvasDraftsRoute)
  @RequireWorkspacePermission("canvas.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(CanvasDraftListQuerySchema))
    query: CanvasDraftListQuery,
  ): Promise<CanvasDraftList> {
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.canvasDrafts.list({
        authority: scope,
        limit: Number(query.limit ?? "12"),
      });
      return {
        items: result.items.map((draft: CanvasDraftSummaryRecord) => ({
          id: draft.id,
          workspaceId: draft.workspaceId,
          ...(draft.brand ? { brand: draft.brand } : {}),
          title: draft.title,
          pageCount: draft.pageCount,
          version: draft.version,
          createdAt: draft.createdAt.toISOString(),
          updatedAt: draft.updatedAt.toISOString(),
        })),
        truncated: result.truncated,
      };
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(createCanvasDraftRoute)
  @RequireWorkspacePermission("canvas.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateCanvasDraftBodySchema))
    body: CreateCanvasDraftBody,
  ): Promise<CanvasDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return toMutationResult(
        await this.database.canvasDrafts.create({
          authority: scope,
          canvasDraftId: ulid(),
          idempotencyKey: idempotencyKey ?? "",
          document: body.document,
          ...(body.brandKitRevisionId !== undefined
            ? { brandKitRevisionId: body.brandKitRevisionId }
            : {}),
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        }),
      );
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(getCanvasDraftRoute)
  @RequireWorkspacePermission("canvas.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftPathSchema))
    params: { readonly canvasDraftId: string },
  ): Promise<CanvasDraft> {
    const { scope } = this.contexts.require(request);
    try {
      const draft = await this.database.canvasDrafts.get(
        scope,
        params.canvasDraftId,
      );
      if (!draft) {
        throw new NotFoundException(
          problem(
            404,
            "canvas_draft.not_found",
            "Canvas Draft does not exist.",
          ),
        );
      }
      return toApiDraft(draft);
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(listCanvasDraftRevisionsRoute)
  @RequireWorkspacePermission("canvas.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async listRevisions(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftPathSchema))
    params: { readonly canvasDraftId: string },
    @Query(new ContractBodyPipe(CanvasDraftRevisionListQuerySchema))
    query: CanvasDraftRevisionListQuery,
  ): Promise<CanvasDraftRevisionList> {
    const { scope } = this.contexts.require(request);
    try {
      const limit = Number(query.limit ?? "20");
      const items = await this.database.canvasDrafts.listRevisions({
        authority: scope,
        canvasDraftId: params.canvasDraftId,
        ...(query.beforeVersion
          ? { beforeVersion: Number(query.beforeVersion) }
          : {}),
        limit,
      });
      if (items.length === 0) {
        const draft = await this.database.canvasDrafts.get(
          scope,
          params.canvasDraftId,
        );
        if (!draft) {
          throw new NotFoundException(
            problem(
              404,
              "canvas_draft.not_found",
              "Canvas Draft does not exist.",
            ),
          );
        }
      }
      const last = items.at(-1);
      return {
        items: items.map(toRevisionSummary),
        ...(items.length === limit && last && last.version > 1
          ? { nextBeforeVersion: last.version }
          : {}),
      };
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(getCanvasDraftRevisionRoute)
  @RequireWorkspacePermission("canvas.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async getRevision(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftRevisionPathSchema))
    params: {
      readonly canvasDraftId: string;
      readonly version: string;
    },
  ): Promise<CanvasDraftRevision> {
    const { scope } = this.contexts.require(request);
    try {
      const revision = await this.database.canvasDrafts.getRevision(
        scope,
        params.canvasDraftId,
        Number(params.version),
      );
      if (!revision) {
        throw new NotFoundException(
          problem(
            404,
            "canvas_draft.revision_not_found",
            "Canvas Draft revision is no longer retained.",
          ),
        );
      }
      return toRevision(revision);
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(restoreCanvasDraftRoute)
  @RequireWorkspacePermission("canvas.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async restore(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftPathSchema))
    params: { readonly canvasDraftId: string },
    @Body(new ContractBodyPipe(RestoreCanvasDraftBodySchema))
    body: RestoreCanvasDraftBody,
  ): Promise<CanvasDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return toMutationResult(
        await this.database.canvasDrafts.restore({
          authority: scope,
          canvasDraftId: params.canvasDraftId,
          expectedVersion: body.expectedVersion,
          sourceVersion: body.sourceVersion,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        }),
      );
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(updateCanvasDraftRoute)
  @RequireWorkspacePermission("canvas.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async update(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftPathSchema))
    params: { readonly canvasDraftId: string },
    @Body(new ContractBodyPipe(UpdateCanvasDraftBodySchema))
    body: UpdateCanvasDraftBody,
  ): Promise<CanvasDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return toMutationResult(
        await this.database.canvasDrafts.update({
          authority: scope,
          canvasDraftId: params.canvasDraftId,
          expectedVersion: body.expectedVersion,
          document: body.document,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        }),
      );
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }

  @ContractRoute(updateCanvasDraftBrandRoute)
  @RequireWorkspacePermission("canvas.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async updateBrand(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CanvasDraftPathSchema))
    params: { readonly canvasDraftId: string },
    @Body(new ContractBodyPipe(UpdateCanvasDraftBrandBodySchema))
    body: UpdateCanvasDraftBrandBody,
  ): Promise<CanvasDraftMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return toMutationResult(
        await this.database.canvasDrafts.updateBrand({
          authority: scope,
          canvasDraftId: params.canvasDraftId,
          expectedVersion: body.expectedVersion,
          brandKitRevisionId: body.brandKitRevisionId,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        }),
      );
    } catch (error) {
      return mapCanvasDraftError(error);
    }
  }
}
