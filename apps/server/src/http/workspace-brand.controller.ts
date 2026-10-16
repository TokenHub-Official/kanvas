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
  BrandKitDraftRecord,
  BrandKitRevisionRecord,
  BrandKitSummaryRecord,
  PublishedBrandRevisionSummary,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  BrandKitListQuerySchema,
  BrandKitPathSchema,
  BrandKitRevisionPathSchema,
  CreateBrandKitBodySchema,
  createBrandKitRoute,
  getBrandKitDraftRoute,
  getBrandKitRevisionRoute,
  getDefaultBrandKitRevisionRoute,
  listBrandKitRevisionsRoute,
  listBrandKitsRoute,
  PublishBrandKitBodySchema,
  publishBrandKitRoute,
  SetDefaultBrandKitBodySchema,
  setDefaultBrandKitRoute,
  UpdateBrandKitDraftBodySchema,
  updateBrandKitDraftRoute,
  type BrandKitDraft,
  type BrandKitList,
  type BrandKitListQuery,
  type BrandKitRevision,
  type BrandKitRevisionList,
  type BrandKitSummary,
  type CreateBrandKitBody,
  type PublishBrandKitBody,
  type SetDefaultBrandKitBody,
  type UpdateBrandKitDraftBody,
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
    .update("kanvas:workspace-brand-auth-ref:v1\0")
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

function toSummary(value: BrandKitSummaryRecord): BrandKitSummary {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    name: value.name,
    ...(value.description !== undefined
      ? { description: value.description }
      : {}),
    lifecycleStatus: value.lifecycleStatus,
    isDefault: value.isDefault,
    version: value.version,
    draftVersion: value.draftVersion,
    ...(value.latestPublishedRevision
      ? {
          latestPublishedRevision: {
            id: value.latestPublishedRevision.id,
            revisionNumber: value.latestPublishedRevision.revisionNumber,
            publishedAt:
              value.latestPublishedRevision.publishedAt.toISOString(),
          },
        }
      : {}),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toDraft(value: BrandKitDraftRecord): BrandKitDraft {
  return {
    brandKitId: value.brandKitId,
    workspaceId: value.workspaceId,
    name: value.document.name,
    ...(value.document.description !== undefined
      ? { description: value.document.description }
      : {}),
    lifecycleStatus: value.lifecycleStatus,
    isDefault: value.isDefault,
    brandKitVersion: value.brandKitVersion,
    draftVersion: value.draftVersion,
    colors: value.document.colors.map((color) => ({ ...color })),
    logos: value.document.logos.map((logo) => ({ ...logo })),
    referenceImages: value.document.referenceImages.map((reference) => ({
      ...reference,
    })),
    textStyles: value.document.textStyles.map((style) => ({ ...style })),
    guidelines: {
      ...(value.document.guidelines.voice !== undefined
        ? { voice: value.document.guidelines.voice }
        : {}),
      principles: [...value.document.guidelines.principles],
      avoid: [...value.document.guidelines.avoid],
    },
    ...(value.latestPublishedRevision
      ? {
          latestPublishedRevision: {
            id: value.latestPublishedRevision.id,
            revisionNumber: value.latestPublishedRevision.revisionNumber,
            publishedAt:
              value.latestPublishedRevision.publishedAt.toISOString(),
          },
        }
      : {}),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toRevision(value: BrandKitRevisionRecord): BrandKitRevision {
  return {
    id: value.id,
    brandKitId: value.brandKitId,
    workspaceId: value.workspaceId,
    revisionNumber: value.revisionNumber,
    name: value.document.name,
    ...(value.document.description !== undefined
      ? { description: value.document.description }
      : {}),
    colors: value.document.colors.map((color) => ({ ...color })),
    logos: value.document.logos.map((logo) => ({ ...logo })),
    referenceImages: value.document.referenceImages.map((reference) => ({
      ...reference,
    })),
    textStyles: value.document.textStyles.map((style) => ({ ...style })),
    guidelines: {
      ...(value.document.guidelines.voice !== undefined
        ? { voice: value.document.guidelines.voice }
        : {}),
      principles: [...value.document.guidelines.principles],
      avoid: [...value.document.guidelines.avoid],
    },
    contentDigest: value.contentDigest,
    publishedByPrincipalId: value.publishedByPrincipalId,
    publishedAt: value.publishedAt.toISOString(),
  };
}

function toRevisionSummary(value: PublishedBrandRevisionSummary) {
  return {
    id: value.id,
    revisionNumber: value.revisionNumber,
    publishedAt: value.publishedAt.toISOString(),
  };
}

@Controller()
export class WorkspaceBrandController {
  public constructor(
    @Inject(APPLICATION_RUNTIME)
    private readonly runtime: ApplicationRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listBrandKitsRoute)
  @RequireWorkspacePermission("brand.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(BrandKitListQuerySchema))
    query: BrandKitListQuery,
  ): Promise<BrandKitList> {
    const { scope } = this.contexts.require(request);
    const items = await this.runtime.workspaceBrand.list(scope, {
      lifecycleStatus: query.lifecycleStatus ?? "active",
    });
    return { items: items.map(toSummary) };
  }

  @ContractRoute(createBrandKitRoute)
  @RequireWorkspacePermission("brand.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateBrandKitBodySchema))
    body: CreateBrandKitBody,
  ): Promise<BrandKitDraft> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workspaceBrand.create({
      authority: scope,
      name: body.name,
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      idempotencyKey: idempotencyKey ?? "",
      audit: auditFor(scope, request),
    });
    return toDraft(result.value);
  }

  @ContractRoute(getBrandKitDraftRoute)
  @RequireWorkspacePermission("brand.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async getDraft(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrandKitPathSchema))
    params: { readonly brandKitId: string },
  ): Promise<BrandKitDraft> {
    const { scope } = this.contexts.require(request);
    return toDraft(
      await this.runtime.workspaceBrand.getDraft(scope, params.brandKitId),
    );
  }

  @ContractRoute(updateBrandKitDraftRoute)
  @RequireWorkspacePermission("brand.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async updateDraft(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrandKitPathSchema))
    params: { readonly brandKitId: string },
    @Body(new ContractBodyPipe(UpdateBrandKitDraftBodySchema))
    body: UpdateBrandKitDraftBody,
  ): Promise<BrandKitDraft> {
    const { scope } = this.contexts.require(request);
    return toDraft(
      await this.runtime.workspaceBrand.updateDraft({
        authority: scope,
        brandKitId: params.brandKitId,
        expectedDraftVersion: body.expectedDraftVersion,
        name: body.name,
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        colors: body.colors,
        logos: body.logos,
        referenceImages: body.referenceImages,
        textStyles: body.textStyles,
        guidelines: body.guidelines,
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(publishBrandKitRoute)
  @RequireWorkspacePermission("brand.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publish(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param(new ContractBodyPipe(BrandKitPathSchema))
    params: { readonly brandKitId: string },
    @Body(new ContractBodyPipe(PublishBrandKitBodySchema))
    body: PublishBrandKitBody,
  ): Promise<BrandKitRevision> {
    const { scope } = this.contexts.require(request);
    const result = await this.runtime.workspaceBrand.publish({
      authority: scope,
      brandKitId: params.brandKitId,
      expectedDraftVersion: body.expectedDraftVersion,
      idempotencyKey: idempotencyKey ?? "",
      audit: auditFor(scope, request),
    });
    return toRevision(result.value);
  }

  @ContractRoute(listBrandKitRevisionsRoute)
  @RequireWorkspacePermission("brand.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async listRevisions(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrandKitPathSchema))
    params: { readonly brandKitId: string },
  ): Promise<BrandKitRevisionList> {
    const { scope } = this.contexts.require(request);
    const items = await this.runtime.workspaceBrand.listRevisions(
      scope,
      params.brandKitId,
    );
    return { items: items.map(toRevisionSummary) };
  }

  @ContractRoute(setDefaultBrandKitRoute)
  @RequireWorkspacePermission("brand.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async setDefault(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrandKitPathSchema))
    params: { readonly brandKitId: string },
    @Body(new ContractBodyPipe(SetDefaultBrandKitBodySchema))
    body: SetDefaultBrandKitBody,
  ): Promise<BrandKitSummary> {
    const { scope } = this.contexts.require(request);
    return toSummary(
      await this.runtime.workspaceBrand.setDefault({
        authority: scope,
        brandKitId: params.brandKitId,
        expectedBrandKitVersion: body.expectedBrandKitVersion,
        audit: auditFor(scope, request),
      }),
    );
  }

  @ContractRoute(getDefaultBrandKitRevisionRoute)
  @RequireWorkspacePermission("brand.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async getDefaultRevision(
    @Req() request: FastifyRequest,
  ): Promise<BrandKitRevision> {
    const { scope } = this.contexts.require(request);
    return toRevision(
      await this.runtime.workspaceBrand.getDefaultRevision(scope),
    );
  }

  @ContractRoute(getBrandKitRevisionRoute)
  @RequireWorkspacePermission("brand.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async getRevision(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(BrandKitRevisionPathSchema))
    params: {
      readonly brandKitId: string;
      readonly brandKitRevisionId: string;
    },
  ): Promise<BrandKitRevision> {
    const { scope } = this.contexts.require(request);
    return toRevision(
      await this.runtime.workspaceBrand.getRevision(
        scope,
        params.brandKitId,
        params.brandKitRevisionId,
      ),
    );
  }
}
