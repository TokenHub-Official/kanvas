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
  createWorkspaceAssetFromArtifactRoute,
  CreateWorkspaceAssetFromArtifactBodySchema,
  getWorkspaceAssetRoute,
  listWorkspaceAssetsRoute,
  listWorkspaceCreationEntrypointsRoute,
  WorkspaceAssetListQuerySchema,
  WorkspaceAssetDetailQuerySchema,
  WorkspaceAssetPathSchema,
  type CreateWorkspaceAssetFromArtifactBody,
  type WorkspaceAssetAdoption,
  type WorkspaceAssetList,
  type WorkspaceAssetDetail,
  type WorkspaceAssetDetailQuery,
  type WorkspaceAssetListQuery,
  type WorkspaceCreationEntrypointList,
} from "@kanvas/contracts/api";
import {
  ContentDomainStoreError,
  WorkspaceContentQueryStoreError,
  type WorkspaceAssetQuery,
  type WorkspaceAssetDetailQuery as DatabaseWorkspaceAssetDetailQuery,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function mapQueryError(error: unknown): never {
  if (
    error instanceof WorkspaceContentQueryStoreError &&
    error.code === "workspace_content.invalid_query"
  ) {
    throw new BadRequestException(error.message);
  }
  if (
    error instanceof WorkspaceContentQueryStoreError &&
    error.code === "workspace_content.not_found"
  ) {
    throw new NotFoundException("Workspace content was not found.");
  }
  if (
    error instanceof WorkspaceContentQueryStoreError &&
    error.code === "workspace_content.forbidden"
  ) {
    throw new ForbiddenException(
      "Current Workspace authority cannot read this content.",
    );
  }
  throw error;
}

function mapAssetMutationError(error: unknown): never {
  if (!(error instanceof ContentDomainStoreError)) {
    throw error;
  }
  if (error.code === "content_domain.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "content_domain.forbidden") {
    throw new ForbiddenException(error.message);
  }
  if (error.code === "content_domain.not_found") {
    throw new NotFoundException(error.message);
  }
  throw new ConflictException(error.message);
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function decodeAssetCursor(
  cursor: string,
): NonNullable<WorkspaceAssetQuery["cursor"]> {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Cursor payload must be an object.");
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof record.updatedAt !== "string" ||
      typeof record.id !== "string" ||
      !idPattern.test(record.id)
    ) {
      throw new TypeError("Cursor fields are invalid.");
    }
    const updatedAt = new Date(record.updatedAt);
    if (!Number.isFinite(updatedAt.getTime())) {
      throw new TypeError("Cursor timestamp is invalid.");
    }
    return {
      updatedAt,
      id: record.id,
    };
  } catch {
    throw new BadRequestException("Workspace Asset cursor is invalid.");
  }
}

function encodeAssetCursor(
  cursor: NonNullable<WorkspaceAssetQuery["cursor"]>,
): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: cursor.updatedAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeAssetDetailCursor(
  cursor: string,
  historyKind: NonNullable<WorkspaceAssetDetailQuery["historyKind"]>,
): NonNullable<DatabaseWorkspaceAssetDetailQuery["cursor"]> {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Cursor payload must be an object.");
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof record.occurredAt !== "string" ||
      typeof record.id !== "string" ||
      !idPattern.test(record.id)
    ) {
      throw new TypeError("Cursor fields are invalid.");
    }
    const occurredAt = new Date(record.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new TypeError("Cursor timestamp is invalid.");
    }
    if (
      historyKind === "artifacts" &&
      record.currentRank !== 0 &&
      record.currentRank !== 1
    ) {
      throw new TypeError("Artifact cursor rank is invalid.");
    }
    if (historyKind === "lineage" && record.currentRank !== undefined) {
      throw new TypeError("Lineage cursor rank is invalid.");
    }
    return {
      occurredAt,
      id: record.id,
      ...(historyKind === "artifacts"
        ? { currentRank: record.currentRank as 0 | 1 }
        : {}),
    };
  } catch {
    throw new BadRequestException("Workspace Asset detail cursor is invalid.");
  }
}

function encodeAssetDetailCursor(
  cursor: NonNullable<DatabaseWorkspaceAssetDetailQuery["cursor"]>,
): string {
  return Buffer.from(
    JSON.stringify({
      occurredAt: cursor.occurredAt.toISOString(),
      id: cursor.id,
      ...(cursor.currentRank !== undefined
        ? { currentRank: cursor.currentRank }
        : {}),
    }),
    "utf8",
  ).toString("base64url");
}

@Controller()
export class WorkspaceContentController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listWorkspaceAssetsRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async listAssets(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkspaceAssetListQuerySchema))
    query: WorkspaceAssetListQuery,
  ): Promise<WorkspaceAssetList> {
    try {
      const result = await this.database.workspaceContentQueries.listAssets(
        this.contexts.require(request).scope,
        {
          ...(query.q ? { search: query.q } : {}),
          ...(query.mediaKind ? { mediaKind: query.mediaKind } : {}),
          ...(query.assetType ? { assetType: query.assetType } : {}),
          ...(query.ids ? { ids: query.ids.split(",") } : {}),
          ...(query.lifecycleStatus
            ? { lifecycleStatus: query.lifecycleStatus }
            : {}),
          ...(query.cursor ? { cursor: decodeAssetCursor(query.cursor) } : {}),
          limit: Number(query.limit ?? "100"),
        },
      );
      return {
        items: result.items.map((asset) => ({
          id: asset.id,
          assetKey: asset.assetKey,
          name: asset.name,
          assetType: asset.assetType,
          lifecycleStatus: asset.lifecycleStatus,
          ...(asset.currentArtifact
            ? {
                currentArtifact: {
                  id: asset.currentArtifact.id,
                  artifactType: asset.currentArtifact.artifactType,
                  ...(asset.currentArtifact.displayFilename
                    ? {
                        displayFilename: asset.currentArtifact.displayFilename,
                      }
                    : {}),
                  ...(asset.currentArtifact.mediaType
                    ? {
                        mediaType: asset.currentArtifact.mediaType,
                      }
                    : {}),
                  ...(asset.currentArtifact.byteSize
                    ? {
                        byteSize: asset.currentArtifact.byteSize,
                      }
                    : {}),
                  availabilityStatus: asset.currentArtifact.availabilityStatus,
                  dataClassification: asset.currentArtifact.dataClassification,
                  ...(asset.currentArtifact.brand
                    ? { brand: asset.currentArtifact.brand }
                    : {}),
                  createdAt: asset.currentArtifact.createdAt.toISOString(),
                },
              }
            : {}),
          version: asset.version,
          createdAt: asset.createdAt.toISOString(),
          updatedAt: asset.updatedAt.toISOString(),
        })),
        truncated: result.truncated,
        ...(result.facets
          ? {
              facets: {
                assetTypes: [...result.facets.assetTypes],
              },
            }
          : {}),
        ...(result.nextCursor
          ? { nextCursor: encodeAssetCursor(result.nextCursor) }
          : {}),
      };
    } catch (error) {
      return mapQueryError(error);
    }
  }

  @ContractRoute(getWorkspaceAssetRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async getAsset(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkspaceAssetPathSchema))
    params: { readonly assetId: string },
    @Query(new ContractBodyPipe(WorkspaceAssetDetailQuerySchema))
    query: WorkspaceAssetDetailQuery,
  ): Promise<WorkspaceAssetDetail> {
    try {
      if (query.cursor && !query.historyKind) {
        throw new BadRequestException(
          "A history kind is required with the cursor.",
        );
      }
      const { scope } = this.contexts.require(request);
      const asset = await this.database.workspaceContentQueries.getAsset(
        scope,
        params.assetId,
        {
          ...(query.historyKind ? { historyKind: query.historyKind } : {}),
          ...(query.cursor && query.historyKind
            ? {
                cursor: decodeAssetDetailCursor(
                  query.cursor,
                  query.historyKind,
                ),
              }
            : {}),
          ...(query.limit ? { limit: Number.parseInt(query.limit, 10) } : {}),
        },
      );
      const mapArtifact = (artifact: (typeof asset.artifacts)[number]) => ({
        ...artifact,
        createdAt: artifact.createdAt.toISOString(),
      });
      return {
        id: asset.id,
        name: asset.name,
        assetType: asset.assetType,
        lifecycleStatus: asset.lifecycleStatus,
        version: asset.version,
        ...(asset.currentArtifact
          ? {
              currentArtifact: mapArtifact(asset.currentArtifact),
            }
          : {}),
        artifacts: asset.artifacts.map(mapArtifact),
        artifactsTruncated: asset.artifactsTruncated,
        ...(asset.artifactsNextCursor
          ? {
              artifactsNextCursor: encodeAssetDetailCursor(
                asset.artifactsNextCursor,
              ),
            }
          : {}),
        lineage: asset.lineage.map((item) => ({
          ...item,
          artifact: {
            ...item.artifact,
            createdAt: item.artifact.createdAt.toISOString(),
          },
        })),
        lineageTruncated: asset.lineageTruncated,
        ...(asset.lineageNextCursor
          ? {
              lineageNextCursor: encodeAssetDetailCursor(
                asset.lineageNextCursor,
              ),
            }
          : {}),
        usedByBrands: [...asset.usedByBrands],
        availableActions: [
          ...(scope.effectivePermissions.includes("artifact.download")
            ? (["download_artifacts"] as const)
            : []),
          ...(asset.currentArtifact?.availabilityStatus === "available"
            ? [
                ...(scope.effectivePermissions.includes("canvas.write") &&
                scope.effectivePermissions.includes("artifact.download") &&
                asset.currentArtifact.mediaType?.startsWith("image/")
                  ? (["reuse_on_canvas"] as const)
                  : []),
                ...(scope.effectivePermissions.includes("artifact.download")
                  ? (["download_current"] as const)
                  : []),
              ]
            : []),
        ],
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapQueryError(error);
    }
  }

  @ContractRoute(createWorkspaceAssetFromArtifactRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async createAssetFromArtifact(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateWorkspaceAssetFromArtifactBodySchema))
    body: CreateWorkspaceAssetFromArtifactBody,
  ): Promise<WorkspaceAssetAdoption> {
    if (idempotencyKey !== body.assetId) {
      throw new BadRequestException(
        "Asset adoption idempotency key must equal assetId.",
      );
    }
    try {
      const result = await this.database.content.createAsset({
        authority: this.contexts.require(request).scope,
        assetId: body.assetId,
        assetKey: `canvas-result-${body.assetId.toLowerCase()}`,
        name: body.name,
        assetType: "image",
        initialArtifact: {
          kind: "adopt",
          artifactId: body.artifactId,
        },
        now: new Date(),
      });
      return {
        status: result.status,
        assetId: result.assetId,
        artifactId: body.artifactId,
        version: result.version,
      };
    } catch (error) {
      mapAssetMutationError(error);
    }
  }

  @ContractRoute(listWorkspaceCreationEntrypointsRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  @Header("Cache-Control", "private, no-store")
  public async listCreationEntrypoints(
    @Req() request: FastifyRequest,
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<WorkspaceCreationEntrypointList> {
    try {
      const result =
        await this.database.workspaceContentQueries.listCreationEntrypoints(
          this.contexts.require(request).scope,
          acceptLanguage?.split(",", 1)[0]?.split(";", 1)[0]?.trim() || "zh-CN",
        );
      return {
        items: result.items.map((entrypoint) => ({
          skillRevisionId: entrypoint.skillRevisionId,
          skillKey: entrypoint.skillKey,
          skillRevision: entrypoint.skillRevision,
          entrypointKey: entrypoint.entrypointKey,
          workflowRevisionId: entrypoint.workflowRevisionId,
          workflowRevision: entrypoint.workflowRevision,
          displayName: entrypoint.displayName,
          ...(entrypoint.description
            ? { description: entrypoint.description }
            : {}),
          ...(entrypoint.category ? { category: entrypoint.category } : {}),
          nonProduction: entrypoint.nonProduction,
          outputPresentation: entrypoint.outputPresentation,
          inputSchema: { ...entrypoint.inputSchema },
          outputSchema: { ...entrypoint.outputSchema },
          effectiveInvocationSchema: entrypoint.effectiveInvocationSchema,
          ...(entrypoint.inputUiSchema
            ? {
                inputUiSchema: {
                  ...entrypoint.inputUiSchema,
                },
              }
            : {}),
          ...(entrypoint.capability
            ? {
                capability: {
                  ...entrypoint.capability,
                  surfaces: [...entrypoint.capability.surfaces],
                  parameters: entrypoint.capability.parameters.map(
                    (parameter) => ({ ...parameter }),
                  ),
                  outputs: entrypoint.capability.outputs.map((output) => ({
                    ...output,
                  })),
                },
              }
            : {}),
        })),
        truncated: result.truncated,
      };
    } catch (error) {
      return mapQueryError(error);
    }
  }
}
