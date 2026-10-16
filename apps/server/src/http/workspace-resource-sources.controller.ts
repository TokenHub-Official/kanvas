import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  CreateResourceSourceBodySchema,
  PublishResourceSourceBodySchema,
  ResourceAdoptionRequestSchema,
  ResourceSourceVersionBodySchema,
  RotateResourceSourceCredentialBodySchema,
  ValidateResourceSourceBodySchema,
  adoptResourceCatalogCandidateRoute,
  createWorkspaceResourceSourceRoute,
  disableWorkspaceResourceSourceRoute,
  listResourceSourceTypesRoute,
  listResourceCatalogSourcesRoute,
  listWorkspaceArtTextCatalogRoute,
  listWorkspaceFontCatalogRoute,
  listWorkspaceResourceSourcesRoute,
  publishWorkspaceResourceSourceRoute,
  rotateWorkspaceResourceSourceCredentialRoute,
  searchResourceCatalogRoute,
  ResourceCatalogSearchQuerySchema,
  validateWorkspaceResourceSourceRoute,
  type CreateResourceSourceBody,
  type ResourceCatalogSearchQuery,
  type ResourceCatalogSearchResult,
  type ResourceCatalogSourceList,
  type WorkspaceArtTextCatalog,
  type WorkspaceFontCatalog,
  type WorkspaceFontRevision,
  type ResourceAdoptionRequest,
  type ResourceAdoptionResult,
  type PublishResourceSourceBody,
  type ResourceSourceCreated,
  type ResourceSourceMutationResult,
  type ResourceSourceSummary,
  type ResourceSourceTypeList,
  type ResourceSourceVersionBody,
  type RotateResourceSourceCredentialBody,
  type ValidateResourceSourceBody,
  type WorkspaceResourceSources,
} from "@kanvas/contracts/api";
import {
  digestProviderValue,
  ResourceSourceStoreError,
  SecretVersionStoreError,
  type ControlPlaneAuditContext,
  type ResourceSourceOperationClaim,
  type ResourceSourceRecord,
} from "@kanvas/database/runtime";
import {
  ProviderSecretPersistenceError,
  type ProviderSecretDatabaseWriter,
  type ProviderSecretMaterialResolver,
} from "@kanvas/secrets";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { decodeTime, ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import type { ServerConfig } from "../config.js";
import {
  ResourceSourceAdapterError,
  listResourceSourceAdapterTypes,
  resolveResourceSourceCandidate,
  resourceSourceAdapterCapabilities,
  resourceSourceAdapterType,
  searchResourceSourceAdapter,
  validateResourceSourceAdapter,
} from "../resource-sources/resource-source-adapters.js";
import {
  requestProviderBinary,
  requestProviderProbeJson,
  type ProviderProbeRequester,
} from "../provider/provider-setting-probe.js";
import {
  DATABASE_RUNTIME,
  PROVIDER_SECRET_DATABASE_WRITER,
  PROVIDER_SECRET_MATERIAL_RESOLVER,
  SERVER_CONFIG,
} from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";
import { ContentTransferService } from "../storage/content-transfer.service.js";

const secretDrainMilliseconds = 5 * 60 * 1_000;
const maximumExternalImageBytes = 40 * 1_024 * 1_024;

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:resource-source-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(
  scope: TrustedWorkspaceScope,
  request: FastifyRequest,
  auditEventId = ulid(),
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId,
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

function mutationKey(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException("A valid Idempotency-Key is required.");
  }
  return normalized;
}

function summaryFrom(record: ResourceSourceRecord): ResourceSourceSummary {
  return {
    id: record.id,
    displayName: record.displayName,
    adapterKind: record.adapterKind,
    adapterVersion: record.adapterVersion,
    authMode: record.authMode,
    endpointOrigin: record.endpointOrigin,
    configuration:
      record.configuration as ResourceSourceSummary["configuration"],
    configurationDigest: record.configurationDigest,
    licensePolicy: record.licensePolicy,
    lifecycleStatus: record.lifecycleStatus,
    validationStatus: record.validationStatus,
    ...(record.validationReasonCode
      ? { validationReasonCode: record.validationReasonCode }
      : {}),
    secretConfigured: record.secretConfigured,
    ...(record.currentRevisionId
      ? { currentRevisionId: record.currentRevisionId }
      : {}),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.disabledAt
      ? { disabledAt: record.disabledAt.toISOString() }
      : {}),
  };
}

function mapSourceError(error: unknown): never {
  if (error instanceof ResourceSourceStoreError) {
    if (error.code === "resource_source.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "resource_source.version_conflict" ||
      error.code === "resource_source.idempotency_conflict" ||
      error.code === "resource_source.lifecycle_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    if (error.code === "resource_source.secret_not_ready") {
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  if (error instanceof ProviderSecretPersistenceError) {
    throw new ServiceUnavailableException(error.message);
  }
  throw error;
}

function materialFrom(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function materialFingerprint(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:resource-source-credential:v1\0")
    .update(value)
    .digest("hex")}`;
}

function externalImageFilename(name: string, mediaType: string): string {
  let extension = "jpg";
  if (mediaType === "image/png") extension = "png";
  if (mediaType === "image/webp") extension = "webp";
  const basename = name
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, "")
    .replace(/[\\/:*?"<>|]/gu, "-")
    .trim()
    .slice(0, 220);
  return `${basename || "external-image"}.${extension}`;
}

function externalVectorFilename(name: string): string {
  return externalImageFilename(name, "image/svg+xml").replace(
    /\.jpg$/u,
    ".svg",
  );
}

function oneChunk(value: Uint8Array): AsyncIterable<Uint8Array> {
  return Readable.from([value]);
}

@Controller()
export class WorkspaceResourceSourcesController {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    @Inject(PROVIDER_SECRET_DATABASE_WRITER)
    private readonly secretWriter: ProviderSecretDatabaseWriter,
    @Inject(PROVIDER_SECRET_MATERIAL_RESOLVER)
    private readonly secretResolver: ProviderSecretMaterialResolver,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly transfers: ContentTransferService,
  ) {}

  private requester(): ProviderProbeRequester {
    return (request) =>
      requestProviderProbeJson(
        request,
        this.config.providerProxyUrl
          ? { proxyUrl: this.config.providerProxyUrl }
          : {},
      );
  }

  @ContractRoute(listResourceCatalogSourcesRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listCatalogSources(
    @Req() request: FastifyRequest,
  ): Promise<ResourceCatalogSourceList> {
    const { scope } = this.contexts.require(request);
    const sources = await this.database.resourceSources.listPublished(
      scope,
      new Date(),
    );
    return {
      sources: sources.map((source) => ({
        ...source,
        capabilities: [...source.capabilities],
      })),
    };
  }

  @ContractRoute(listWorkspaceFontCatalogRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listFontCatalog(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceFontCatalog> {
    const { scope } = this.contexts.require(request);
    const fonts = await this.database.resourceSources.listFontRevisions(
      scope,
      new Date(),
    );
    return {
      fonts: fonts.map((font) => ({
        id: font.id,
        family: font.family,
        category: font.category,
        scripts: [...font.scripts],
        languages: [...font.languages],
        license: font.license as WorkspaceFontRevision["license"],
        files: font.files.map((file) => ({ ...file })),
        createdAt: font.createdAt.toISOString(),
      })),
    };
  }

  @ContractRoute(listWorkspaceArtTextCatalogRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listArtTextCatalog(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceArtTextCatalog> {
    const { scope } = this.contexts.require(request);
    const presets = await this.database.resourceSources.listArtTextPresets(
      scope,
      new Date(),
    );
    return {
      presets: presets.map((preset) => ({
        id: preset.id,
        manifest: preset.manifest,
        createdAt: preset.createdAt.toISOString(),
      })),
    };
  }

  @ContractRoute(searchResourceCatalogRoute)
  @RequireWorkspacePermission("asset.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async searchCatalog(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(ResourceCatalogSearchQuerySchema))
    query: ResourceCatalogSearchQuery,
  ): Promise<ResourceCatalogSearchResult> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const identity =
        await this.database.resourceSources.resolveCatalogIdentity(
          scope,
          query.sourceId,
          undefined,
          now,
        );
      const search = (material?: Uint8Array) =>
        searchResourceSourceAdapter({
          adapterKind: identity.adapterKind,
          sourceInstanceId: identity.id,
          sourceRevisionId: identity.revisionId,
          endpointOrigin: identity.endpointOrigin,
          configuration: identity.configuration,
          licensePolicy: identity.licensePolicy,
          query: query.q.trim(),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          limit: Number(query.limit ?? 24),
          ...(material ? { material } : {}),
          request: this.requester(),
          now,
        });
      const result = identity.secret
        ? await this.secretResolver.withResolvedMaterial(
            identity.secret,
            search,
          )
        : await search();
      return {
        sourceId: identity.id,
        sourceRevisionId: identity.revisionId,
        candidates: [...result.candidates],
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    } catch (error) {
      if (error instanceof ResourceSourceAdapterError) {
        if (error.code === "unavailable" || error.code === "rate_limited") {
          throw new ServiceUnavailableException(error.message);
        }
        throw new BadRequestException(error.message);
      }
      return mapSourceError(error);
    }
  }

  @ContractRoute(adoptResourceCatalogCandidateRoute)
  @RequireWorkspacePermission("asset.write")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async adoptCatalogCandidate(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ResourceAdoptionRequestSchema))
    body: ResourceAdoptionRequest,
  ): Promise<ResourceAdoptionResult> {
    const operationKey = mutationKey(idempotencyKey);
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const identity = await this.database.resourceSources.resolveCatalogIdentity(
      scope,
      body.sourceInstanceId,
      body.sourceRevisionId,
      now,
    );
    const resolve = (material?: Uint8Array) =>
      resolveResourceSourceCandidate({
        adapterKind: identity.adapterKind,
        sourceInstanceId: identity.id,
        sourceRevisionId: identity.revisionId,
        endpointOrigin: identity.endpointOrigin,
        configuration: identity.configuration,
        licensePolicy: identity.licensePolicy,
        externalId: body.externalId,
        ...(material ? { material } : {}),
        request: this.requester(),
        now,
      });
    const candidate = identity.secret
      ? await this.secretResolver.withResolvedMaterial(identity.secret, resolve)
      : await resolve();
    if (
      candidate.kind !== body.candidateKind ||
      candidate.externalId !== body.externalId ||
      candidate.license.termsDigest !== body.expectedTermsDigest
    ) {
      throw new ConflictException(
        "The external resource or its license changed before adoption.",
      );
    }
    const pinnedLicense = {
      ...candidate.license,
      capturedAt: new Date(decodeTime(identity.revisionId)).toISOString(),
    };
    if (candidate.kind === "art_text") {
      const adopted = await this.database.resourceSources.adoptArtTextPreset({
        scope,
        sourceId: identity.id,
        sourceRevisionId: identity.revisionId,
        artTextPresetRevisionId: ulid(),
        externalId: candidate.externalId,
        manifest: candidate.manifest,
        provenance: {
          sourcePageUrl: candidate.sourcePageUrl,
          license: candidate.license,
          providerObligations: candidate.providerObligations,
        },
        idempotencyKey: operationKey,
        now,
        audit: auditFor(scope, request),
      });
      return {
        kind: "art_text_preset_revision",
        artTextPresetRevisionId: adopted.value.id,
      };
    }
    if (candidate.kind === "font") {
      if (candidate.license.embeddingAllowed !== true) {
        throw new BadRequestException(
          "The selected font license does not explicitly allow embedding.",
        );
      }
      const adoptedFiles: Array<{
        readonly artifactId: string;
        readonly format: "otf" | "ttf";
        readonly weight: number;
        readonly style: "italic" | "normal";
        readonly subset: string;
      }> = [];
      for (const variant of candidate.fileVariants) {
        if (variant.format !== "ttf" && variant.format !== "otf") {
          throw new BadRequestException(
            "The selected font contains an unsupported file format.",
          );
        }
        const download = await requestProviderBinary(
          {
            url: variant.url,
            headers: {},
            maximumBytes: maximumExternalImageBytes,
          },
          this.config.providerProxyUrl
            ? { proxyUrl: this.config.providerProxyUrl }
            : {},
        );
        if (download.statusCode < 200 || download.statusCode >= 300) {
          throw new ServiceUnavailableException(
            "The external font file is unavailable.",
          );
        }
        const bytes = Buffer.from(download.body);
        try {
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const committed = await this.transfers.adoptExternalFont({
            scope,
            idempotencyKey: `pinned:${operationKey}:${String(variant.weight)}:${variant.style}:${variant.subset}`,
            body: oneChunk(bytes),
            byteSize: bytes.byteLength,
            sha256,
            mediaType: variant.format === "otf" ? "font/otf" : "font/ttf",
            displayName: `${candidate.family}-${String(variant.weight)}-${variant.style}.${variant.format}`,
            metadata: {
              importedFrom: "external_resource_source",
              sourceInstanceId: identity.id,
              sourceRevisionId: identity.revisionId,
              externalId: candidate.externalId,
              family: candidate.family,
              upstreamVersion: candidate.upstreamVersion,
              variant: {
                format: variant.format,
                weight: variant.weight,
                style: variant.style,
                subset: variant.subset,
              },
              license: pinnedLicense,
            },
            createAsset: false,
            requestId: request.id,
          });
          adoptedFiles.push({
            artifactId: committed.artifactId,
            format: variant.format,
            weight: variant.weight,
            style: variant.style,
            subset: variant.subset,
          });
        } finally {
          bytes.fill(0);
        }
      }
      const adopted = await this.database.resourceSources.adoptFontRevision({
        scope,
        sourceId: identity.id,
        sourceRevisionId: identity.revisionId,
        fontRevisionId: ulid(),
        externalId: candidate.externalId,
        family: candidate.family,
        upstreamVersion: candidate.upstreamVersion,
        descriptor: {
          category: candidate.category,
          scripts: candidate.scripts,
          languages: candidate.languages,
          weights: candidate.weights,
          styles: candidate.styles,
          license: pinnedLicense,
          providerObligations: candidate.providerObligations,
          sourcePageUrl: candidate.sourcePageUrl,
        },
        files: adoptedFiles,
        idempotencyKey: operationKey,
        now,
        audit: auditFor(scope, request),
      });
      return {
        kind: "font_revision",
        fontRevisionId: adopted.value.id,
      };
    }
    if (candidate.kind === "vector") {
      const download = await requestProviderBinary(
        {
          url: candidate.original.url,
          headers: {},
          maximumBytes: maximumExternalImageBytes,
        },
        this.config.providerProxyUrl
          ? { proxyUrl: this.config.providerProxyUrl }
          : {},
      );
      if (
        download.statusCode < 200 ||
        download.statusCode >= 300 ||
        download.contentType !== "image/svg+xml"
      ) {
        throw new ServiceUnavailableException(
          "The external vector did not return the expected SVG representation.",
        );
      }
      const bytes = Buffer.from(download.body);
      try {
        const committed = await this.transfers.adoptExternalVector({
          scope,
          idempotencyKey: `pinned:${operationKey}`,
          body: oneChunk(bytes),
          byteSize: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          mediaType: "image/svg+xml",
          displayName: externalVectorFilename(body.displayName),
          metadata: {
            importedFrom: "external_resource_source",
            sourceInstanceId: identity.id,
            sourceRevisionId: identity.revisionId,
            externalId: candidate.externalId,
            sourcePageUrl: candidate.sourcePageUrl,
            license: pinnedLicense,
            providerObligations: candidate.providerObligations,
          },
          createAsset: false,
          requestId: request.id,
        });
        return {
          kind: "artifact",
          artifactId: committed.artifactId,
        };
      } finally {
        bytes.fill(0);
      }
    }
    if (candidate.kind !== "image") {
      throw new BadRequestException(
        "This resource type requires a governed file adoption path.",
      );
    }
    const mediaType = candidate.original.mediaType;
    if (mediaType === "image/svg+xml") {
      throw new BadRequestException(
        "Vector resources require the governed vector adoption path.",
      );
    }
    const download = await requestProviderBinary(
      {
        url: candidate.original.url,
        headers: {},
        maximumBytes: maximumExternalImageBytes,
      },
      this.config.providerProxyUrl
        ? { proxyUrl: this.config.providerProxyUrl }
        : {},
    );
    if (
      download.statusCode < 200 ||
      download.statusCode >= 300 ||
      download.contentType !== mediaType
    ) {
      throw new ServiceUnavailableException(
        "The external resource did not return the expected image representation.",
      );
    }
    const bytes = Buffer.from(download.body);
    try {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const allocation = await this.transfers.allocateUserImport(
        scope,
        `external-resource:pinned:${operationKey}`,
        {
          expectedSize: String(bytes.byteLength),
          expectedMediaType: mediaType,
          expectedSha256: sha256,
        },
      );
      await this.transfers.uploadUserImport(
        scope,
        allocation.uploadSessionId,
        oneChunk(bytes),
      );
      const committed = await this.transfers.commitUserImport(
        scope,
        allocation.uploadSessionId,
        {
          artifactType: "image.source",
          dataClassification: "internal",
          displayFilename: externalImageFilename(body.displayName, mediaType),
          metadata: {
            importedFrom: "external_resource_source",
            sourceInstanceId: identity.id,
            sourceRevisionId: identity.revisionId,
            externalId: candidate.externalId,
            sourcePageUrl: candidate.sourcePageUrl,
            license: pinnedLicense,
            providerObligations: candidate.providerObligations,
          },
        },
        request.id,
      );
      return {
        kind: "artifact",
        artifactId: committed.artifactId,
      };
    } finally {
      bytes.fill(0);
    }
  }

  @ContractRoute(listWorkspaceResourceSourcesRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceResourceSources> {
    const { scope } = this.contexts.require(request);
    const sources = await this.database.resourceSources.list(scope, new Date());
    return { sources: sources.map(summaryFrom) };
  }

  @ContractRoute(listResourceSourceTypesRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public listTypes(@Req() request: FastifyRequest): ResourceSourceTypeList {
    this.contexts.require(request);
    return { sourceTypes: [...listResourceSourceAdapterTypes()] };
  }

  @ContractRoute(createWorkspaceResourceSourceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateResourceSourceBodySchema))
    body: CreateResourceSourceBody,
  ): Promise<ResourceSourceCreated> {
    const operationKey = mutationKey(idempotencyKey);
    if (
      (body.authMode === "none" && body.credentialMaterial !== undefined) ||
      (body.authMode !== "none" && body.credentialMaterial === undefined)
    ) {
      throw new BadRequestException(
        "Credential material must match the selected authentication mode.",
      );
    }
    try {
      const sourceType = resourceSourceAdapterType(body.adapterKind);
      if (
        sourceType.adapterVersion !== body.adapterVersion ||
        !sourceType.authModes.includes(body.authMode)
      ) {
        throw new BadRequestException(
          "The selected Adapter version or authentication mode is unsupported.",
        );
      }
    } catch (error) {
      if (error instanceof ResourceSourceAdapterError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const sourceId = ulid();
    const endpointId = ulid();
    const credentialId = body.authMode === "none" ? undefined : ulid();
    let material: Buffer | undefined;
    try {
      const created = await this.database.resourceSources.createDraft({
        scope,
        sourceId,
        providerEndpointId: endpointId,
        ...(credentialId ? { credentialId } : {}),
        displayName: body.displayName.trim(),
        adapterKind: body.adapterKind,
        adapterVersion: body.adapterVersion,
        authMode: body.authMode,
        endpointOrigin: body.endpointOrigin,
        configuration: body.configuration,
        licensePolicy: body.licensePolicy,
        idempotencyKey: operationKey,
        now,
        audit: auditFor(scope, request),
      });
      let source = created.value;
      if (
        body.credentialMaterial &&
        source.credentialId &&
        !source.secretConfigured
      ) {
        material = materialFrom(body.credentialMaterial);
        const secretVersionId = source.id;
        const prepared = await this.secretWriter.prepare(
          {
            instanceId: this.config.instanceId,
            workspaceId: scope.workspaceId,
            credentialId: source.credentialId,
            secretVersionId,
            providerKind: source.adapterKind,
            formatVersion: 1,
          },
          material,
        );
        await this.database.secretVersions.create({
          workspaceId: scope.workspaceId,
          credentialId: source.credentialId,
          secretVersionId,
          expectedCredentialVersion: 1,
          source: prepared.source,
          aadDigest: prepared.aadDigest,
          materialFingerprint: prepared.materialFingerprint,
          formatVersion: 1,
          createdByPrincipalId: scope.principalId,
          now,
          audit: auditFor(scope, request),
        });
        await this.database.secretVersions.verify({
          workspaceId: scope.workspaceId,
          credentialId: source.credentialId,
          secretVersionId,
          expectedCredentialVersion: 1,
          now,
          audit: auditFor(scope, request),
        });
        await this.database.secretVersions.rotateActive({
          workspaceId: scope.workspaceId,
          credentialId: source.credentialId,
          candidateSecretVersionId: secretVersionId,
          expectedCredentialVersion: 1,
          previousDrainDeadlineAt: new Date(
            now.getTime() + secretDrainMilliseconds,
          ),
          now,
          audit: auditFor(scope, request),
        });
        source = await this.database.resourceSources.get(scope, source.id, now);
      }
      return { source: summaryFrom(source), replayed: created.replayed };
    } catch (error) {
      return mapSourceError(error);
    } finally {
      material?.fill(0);
    }
  }

  @ContractRoute(validateWorkspaceResourceSourceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async validate(
    @Req() request: FastifyRequest,
    @Param("resourceSourceId") resourceSourceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ValidateResourceSourceBodySchema))
    body: ValidateResourceSourceBody,
  ): Promise<ResourceSourceMutationResult> {
    const operationKey = mutationKey(idempotencyKey);
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const requestHash = digestProviderValue({
      operation: "validate",
      resourceSourceId,
      expectedVersion: body.expectedVersion,
    });
    let claim: ResourceSourceOperationClaim;
    try {
      claim = await this.database.resourceSources.claimOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: ulid(),
        operationKind: "validate",
        idempotencyKey: operationKey,
        requestHash,
        expectedSourceVersion: body.expectedVersion,
        now,
        audit: auditFor(scope, request),
      });
    } catch (error) {
      return mapSourceError(error);
    }
    if (claim.replayed) {
      if (
        claim.resultReasonCode &&
        claim.resultReasonCode !== "resource_source.connection_verified"
      ) {
        throw new BadRequestException(
          "The resource source configuration check did not pass.",
        );
      }
      return { source: summaryFrom(claim.source), replayed: true };
    }
    if (claim.resumed && claim.source.version !== body.expectedVersion) {
      await this.database.resourceSources.completeOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: claim.operationId,
        idempotencyKey: operationKey,
        requestHash,
        resultSourceVersion: claim.source.version,
        resultReasonCode:
          claim.source.validationReasonCode ??
          "resource_source.validation_recovered",
        now,
        audit: auditFor(scope, request),
      });
      return { source: summaryFrom(claim.source), replayed: true };
    }
    try {
      const identity =
        await this.database.resourceSources.resolveValidationIdentity(
          scope,
          resourceSourceId,
          now,
        );
      const validate = (material?: Uint8Array) =>
        validateResourceSourceAdapter({
          adapterKind: identity.source.adapterKind,
          endpointOrigin: identity.source.endpointOrigin,
          ...(material ? { material } : {}),
          request: this.requester(),
        });
      const validation = identity.secret
        ? await this.secretResolver.withResolvedMaterial(
            identity.secret,
            validate,
          )
        : await validate();
      const source = await this.database.resourceSources.recordValidation({
        scope,
        sourceId: resourceSourceId,
        expectedVersion: body.expectedVersion,
        outcome: "passed",
        validationDigest: validation.validationDigest,
        reasonCode: validation.reasonCode,
        now,
        audit: auditFor(scope, request),
      });
      await this.database.resourceSources.completeOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: claim.operationId,
        idempotencyKey: operationKey,
        requestHash,
        resultSourceVersion: source.version,
        resultReasonCode: validation.reasonCode,
        now,
        audit: auditFor(scope, request),
      });
      return { source: summaryFrom(source), replayed: false };
    } catch (error) {
      if (error instanceof ResourceSourceAdapterError) {
        try {
          const source = await this.database.resourceSources.recordValidation({
            scope,
            sourceId: resourceSourceId,
            expectedVersion: body.expectedVersion,
            outcome: "failed",
            validationDigest: digestProviderValue({
              adapterError: error.code,
              resourceSourceId,
            }),
            reasonCode: `resource_source.${error.code}`,
            now,
            audit: auditFor(scope, request),
          });
          await this.database.resourceSources.completeOperation({
            scope,
            sourceId: resourceSourceId,
            operationId: claim.operationId,
            idempotencyKey: operationKey,
            requestHash,
            resultSourceVersion: source.version,
            resultReasonCode: `resource_source.${error.code}`,
            now,
            audit: auditFor(scope, request),
          });
        } catch {
          // Preserve the Adapter failure; concurrent state is re-read by UI.
        }
        if (error.code === "unavailable" || error.code === "rate_limited") {
          throw new ServiceUnavailableException(error.message);
        }
        throw new BadRequestException(error.message);
      }
      return mapSourceError(error);
    }
  }

  @ContractRoute(publishWorkspaceResourceSourceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publish(
    @Req() request: FastifyRequest,
    @Param("resourceSourceId") resourceSourceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(PublishResourceSourceBodySchema))
    body: PublishResourceSourceBody,
  ): Promise<ResourceSourceMutationResult> {
    const operationKey = mutationKey(idempotencyKey);
    const { scope } = this.contexts.require(request);
    const source = await this.database.resourceSources.get(
      scope,
      resourceSourceId,
      new Date(),
    );
    const supported = resourceSourceAdapterCapabilities(source.adapterKind);
    if (
      body.capabilities.length !== supported.length ||
      body.capabilities.some((capability) => !supported.includes(capability))
    ) {
      throw new BadRequestException(
        "Published capabilities must match the validated Adapter.",
      );
    }
    try {
      const revision = await this.database.resourceSources.publish({
        scope,
        sourceId: resourceSourceId,
        sourceRevisionId: ulid(),
        expectedVersion: body.expectedVersion,
        capabilities: body.capabilities,
        idempotencyKey: operationKey,
        now: new Date(),
        audit: auditFor(scope, request),
      });
      const updated = await this.database.resourceSources.get(
        scope,
        resourceSourceId,
        new Date(),
      );
      return {
        source: summaryFrom(updated),
        replayed: revision.replayed,
        revision: {
          ...revision.value,
          capabilities: [...revision.value.capabilities],
          publishedAt: revision.value.publishedAt.toISOString(),
        },
      };
    } catch (error) {
      return mapSourceError(error);
    }
  }

  @ContractRoute(disableWorkspaceResourceSourceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async disable(
    @Req() request: FastifyRequest,
    @Param("resourceSourceId") resourceSourceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ResourceSourceVersionBodySchema))
    body: ResourceSourceVersionBody,
  ): Promise<ResourceSourceMutationResult> {
    const operationKey = mutationKey(idempotencyKey);
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const requestHash = digestProviderValue({
      operation: "disable",
      resourceSourceId,
      expectedVersion: body.expectedVersion,
    });
    try {
      const claim = await this.database.resourceSources.claimOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: ulid(),
        operationKind: "disable",
        idempotencyKey: operationKey,
        requestHash,
        expectedSourceVersion: body.expectedVersion,
        now,
        audit: auditFor(scope, request),
      });
      if (claim.replayed) {
        return { source: summaryFrom(claim.source), replayed: true };
      }
      if (claim.resumed && claim.source.version !== body.expectedVersion) {
        await this.database.resourceSources.completeOperation({
          scope,
          sourceId: resourceSourceId,
          operationId: claim.operationId,
          idempotencyKey: operationKey,
          requestHash,
          resultSourceVersion: claim.source.version,
          resultReasonCode: "resource_source.disabled",
          now,
          audit: auditFor(scope, request),
        });
        return { source: summaryFrom(claim.source), replayed: true };
      }
      const source = await this.database.resourceSources.disable({
        scope,
        sourceId: resourceSourceId,
        expectedVersion: body.expectedVersion,
        now,
        audit: auditFor(scope, request),
      });
      await this.database.resourceSources.completeOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: claim.operationId,
        idempotencyKey: operationKey,
        requestHash,
        resultSourceVersion: source.version,
        resultReasonCode: "resource_source.disabled",
        now,
        audit: auditFor(scope, request),
      });
      return { source: summaryFrom(source), replayed: false };
    } catch (error) {
      return mapSourceError(error);
    }
  }

  @ContractRoute(rotateWorkspaceResourceSourceCredentialRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async rotateCredential(
    @Req() request: FastifyRequest,
    @Param("resourceSourceId") resourceSourceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(RotateResourceSourceCredentialBodySchema))
    body: RotateResourceSourceCredentialBody,
  ): Promise<ResourceSourceMutationResult> {
    const operationKey = mutationKey(idempotencyKey);
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const requestHash = digestProviderValue({
      operation: "rotate_secret",
      resourceSourceId,
      expectedVersion: body.expectedVersion,
      materialFingerprint: materialFingerprint(body.credentialMaterial),
    });
    let claim: ResourceSourceOperationClaim;
    try {
      claim = await this.database.resourceSources.claimOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: ulid(),
        operationKind: "rotate_secret",
        idempotencyKey: operationKey,
        requestHash,
        expectedSourceVersion: body.expectedVersion,
        plannedResourceId: ulid(),
        now,
        audit: auditFor(scope, request),
      });
    } catch (error) {
      return mapSourceError(error);
    }
    if (claim.replayed) {
      return { source: summaryFrom(claim.source), replayed: true };
    }
    if (claim.resumed && claim.source.version !== body.expectedVersion) {
      await this.database.resourceSources.completeOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: claim.operationId,
        idempotencyKey: operationKey,
        requestHash,
        resultSourceVersion: claim.source.version,
        resultReasonCode: "resource_source.credential_rotated",
        now,
        audit: auditFor(scope, request),
      });
      return { source: summaryFrom(claim.source), replayed: true };
    }
    if (!claim.plannedResourceId) {
      throw new ConflictException(
        "Credential rotation identity is incomplete.",
      );
    }
    const material = materialFrom(body.credentialMaterial);
    try {
      const identity =
        await this.database.resourceSources.resolveSecretWriteIdentity(
          scope,
          resourceSourceId,
          body.expectedVersion,
          now,
        );
      const prepared = await this.secretWriter.prepare(
        {
          instanceId: this.config.instanceId,
          workspaceId: scope.workspaceId,
          credentialId: identity.credentialId,
          secretVersionId: claim.plannedResourceId,
          providerKind: identity.source.adapterKind,
          formatVersion: 1,
        },
        material,
      );
      await this.database.secretVersions.create({
        workspaceId: scope.workspaceId,
        credentialId: identity.credentialId,
        secretVersionId: claim.plannedResourceId,
        expectedCredentialVersion: identity.credentialVersion,
        source: prepared.source,
        aadDigest: prepared.aadDigest,
        materialFingerprint: prepared.materialFingerprint,
        formatVersion: 1,
        createdByPrincipalId: scope.principalId,
        now,
        audit: auditFor(scope, request),
      });
      await this.database.secretVersions.verify({
        workspaceId: scope.workspaceId,
        credentialId: identity.credentialId,
        secretVersionId: claim.plannedResourceId,
        expectedCredentialVersion: identity.credentialVersion,
        now,
        audit: auditFor(scope, request),
      });
      await this.database.secretVersions.rotateActive({
        workspaceId: scope.workspaceId,
        credentialId: identity.credentialId,
        candidateSecretVersionId: claim.plannedResourceId,
        expectedCredentialVersion: identity.credentialVersion,
        previousDrainDeadlineAt: new Date(
          now.getTime() + secretDrainMilliseconds,
        ),
        now,
        audit: auditFor(scope, request),
      });
      const source = await this.database.resourceSources.recordSecretRotation({
        scope,
        sourceId: resourceSourceId,
        expectedVersion: body.expectedVersion,
        secretVersionId: claim.plannedResourceId,
        now,
        audit: auditFor(scope, request),
      });
      await this.database.resourceSources.completeOperation({
        scope,
        sourceId: resourceSourceId,
        operationId: claim.operationId,
        idempotencyKey: operationKey,
        requestHash,
        resultSourceVersion: source.version,
        resultReasonCode: "resource_source.credential_rotated",
        now,
        audit: auditFor(scope, request),
      });
      return { source: summaryFrom(source), replayed: false };
    } catch (error) {
      if (error instanceof SecretVersionStoreError) {
        throw new ConflictException(error.message);
      }
      return mapSourceError(error);
    } finally {
      material.fill(0);
    }
  }
}
