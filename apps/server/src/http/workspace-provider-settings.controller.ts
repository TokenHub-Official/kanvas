import { createHash, timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  CreateProviderSettingBodySchema,
  RenameProviderSettingBodySchema,
  renameWorkspaceProviderSettingRoute,
  type RenameProviderSettingBody,
  ActivateProviderSettingBodySchema,
  DiscoverProviderModelsBodySchema,
  RefreshProviderModelCatalogBodySchema,
  AdoptProviderModelCatalogBodySchema,
  activateWorkspaceProviderSettingRoute,
  adoptWorkspaceProviderModelCatalogRoute,
  createWorkspaceProviderSettingRoute,
  disableWorkspaceProviderSettingRoute,
  deleteWorkspaceProviderSettingRoute,
  discoverWorkspaceProviderModelsRoute,
  refreshWorkspaceProviderModelCatalogRoute,
  reviewWorkspaceProviderModelCatalogRoute,
  getWorkspaceProviderSettingsRoute,
  ProviderSettingVersionBodySchema,
  RotateProviderSettingSecretBodySchema,
  ValidateProviderSettingBodySchema,
  rotateWorkspaceProviderSettingSecretRoute,
  validateWorkspaceProviderSettingRoute,
  type CreateProviderSettingBody,
  type ActivateProviderSettingBody,
  type DiscoverProviderModelsBody,
  type ProviderModelDiscoveryResult,
  type ProviderModelCatalogRefreshResult,
  type ProviderModelCatalogReview,
  type ProviderModelCatalogAdoptionResult,
  type ProviderSettingCreated,
  type ProviderSettingMutationResult,
  type ProviderSettingSummary,
  type ProviderSettingVersionBody,
  type RefreshProviderModelCatalogBody,
  type AdoptProviderModelCatalogBody,
  type RotateProviderSettingSecretBody,
  type ValidateProviderSettingBody,
  type WorkspaceProviderSettings,
} from "@kanvas/contracts/api";
import {
  digestProviderValue,
  providerSettingValidationDigest,
  selectedCatalogRuntimeDigest,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import type {
  ProviderModelOperationDefinition,
  ProviderModelParameterDefinition,
} from "@kanvas/contracts/provider-model";
import { parseProviderModelCatalogDocument } from "@kanvas/contracts/provider-model";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  getProviderDefinition,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";
import {
  ProviderSecretPersistenceError,
  ProviderSecretResolutionError,
  type ProviderSecretDatabaseWriter,
  type ProviderSecretMaterialResolver,
} from "@kanvas/secrets";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import type { ServerConfig } from "../config.js";
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
import {
  discoverProviderModelCatalog,
  ProviderModelDiscoveryError,
} from "../provider/provider-model-discovery.js";
import {
  probeProviderSetting,
  ProviderSettingProbeError,
  requestProviderProbeJson,
  type ProviderProbeRequester,
} from "../provider/provider-setting-probe.js";

interface NormalizedProviderInput {
  readonly displayName: string;
  readonly preset: ProviderDefinitionSlug;
  readonly adapterKind:
    | "openai_native"
    | "openrouter_native"
    | "openai_compatible"
    | "gemini_native"
    | "anthropic_native";
  readonly baseUrl: string;
  readonly canonicalOrigin: string;
  readonly hardLimitAmount: string;
  readonly regionCode: "global" | "us" | "private";
  readonly modelKeys: readonly string[];
  readonly providerKind: string;
}

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const modelDiscoveryResponseLimit = 4 * 1_024 * 1_024;

function fallbackCanonicalSlug(upstreamModelId: string): string {
  const normalized = upstreamModelId
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/gu, "-")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .slice(0, 160);
  return normalized || "model";
}
export function normalizeProviderSettingBaseUrl(
  preset: NormalizedProviderInput["preset"],
  requested: string | undefined,
): {
  readonly baseUrl: string;
  readonly canonicalOrigin: string;
} {
  const definition = getProviderDefinition(preset);
  const fallback = definition.defaultBaseUrl;
  const raw = requested?.trim() || fallback;
  if (!raw) {
    throw new BadRequestException(
      "NewAPI / OpenAI-compatible requires a Base URL.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException("Provider Base URL must be an absolute URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestException(
      "Provider Base URL must use HTTPS without credentials, query, or fragment.",
    );
  }
  const normalizedPath = url.pathname
    .replace(/\/+$/u, "")
    .replace(/\/generation\/tasks$/u, "");
  const baseUrl =
    normalizedPath === "" ? url.origin : `${url.origin}${normalizedPath}`;
  return Object.freeze({
    baseUrl,
    canonicalOrigin: url.origin,
  });
}

function normalizeInput(
  body: CreateProviderSettingBody,
): NormalizedProviderInput {
  const displayName = body.displayName.trim();
  if (!displayName) {
    throw new BadRequestException("Provider display name cannot be blank.");
  }
  const modelKeys = [
    ...new Set((body.modelKeys ?? []).map((value) => value.trim())),
  ];
  if (modelKeys.some((value) => !value)) {
    throw new BadRequestException("Provider model keys cannot be blank.");
  }
  const endpoint = normalizeProviderSettingBaseUrl(body.preset, body.baseUrl);
  const definition = getProviderDefinition(body.preset);
  return Object.freeze({
    displayName,
    preset: body.preset,
    adapterKind: definition.adapterKind,
    ...endpoint,
    hardLimitAmount: body.hardLimitAmount,
    modelKeys: Object.freeze(modelKeys),
    providerKind: body.preset,
    regionCode: definition.regionCode,
  });
}

function providerKeyMaterial(value: string): Buffer {
  if (
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[^\x21-\x7e]/u.test(value)
  ) {
    throw new BadRequestException(
      "Provider API Key must be bounded printable ASCII without surrounding whitespace.",
    );
  }
  return Buffer.from(value, "utf8");
}

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:provider-settings-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function providerKeyFingerprint(material: Uint8Array): string {
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

function assertProviderKeyFingerprint(
  material: Uint8Array,
  expected: string,
): void {
  const actual = Buffer.from(providerKeyFingerprint(material), "ascii");
  const expectedBytes = Buffer.from(expected, "ascii");
  try {
    if (
      actual.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(actual, expectedBytes)
    ) {
      throw new BadRequestException(
        "请输入此服务当前保存的 API Key；如需更换，请使用更新 API Key。",
      );
    }
  } finally {
    actual.fill(0);
    expectedBytes.fill(0);
  }
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

function requireMutationIdentity(
  providerSettingId: string,
  idempotencyKey: string | undefined,
): string {
  if (!ulidPattern.test(providerSettingId)) {
    throw new BadRequestException(
      "Provider setting ID must be a canonical uppercase ULID.",
    );
  }
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException("Idempotency-Key is required.");
  }
  return idempotencyKey.trim();
}

function mapProviderSettingsError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }
  if (error instanceof ProviderSettingProbeError) {
    throw new BadRequestException({
      code: `provider_validation.${error.code}`,
      message: error.message,
    });
  }
  if (error instanceof ProviderModelDiscoveryError) {
    const response = {
      code: `provider_model_discovery.${error.code}`,
      message: error.message,
    };
    if (error.code === "unavailable" || error.code === "rate_limited") {
      throw new ServiceUnavailableException(response);
    }
    throw new BadRequestException(response);
  }
  if (error instanceof ProviderSecretResolutionError) {
    throw new ServiceUnavailableException({
      code: error.code,
      message:
        "Stored Provider credential material is temporarily unavailable.",
    });
  }
  if (
    error.message === "Instance Provider policy is not configured." ||
    error.message === "Workspace Provider policy is not configured."
  ) {
    throw new ServiceUnavailableException({
      code: "provider_settings.policy_not_initialized",
      message:
        "Provider policy initialization is incomplete. Run the release database initialization before connecting a Provider.",
    });
  }
  if (error.message.includes("was not found")) {
    throw new NotFoundException(error.message);
  }
  if (
    error.message.includes("changed before") ||
    error.message.includes("Only a") ||
    error.message.includes("idempotency key") ||
    error.message.includes("policy")
  ) {
    throw new ConflictException(error.message);
  }
  if (
    error.message.includes("positive bounded decimal") ||
    error.message.includes("absent from the current Provider catalog") ||
    error.message.includes("does not expose the OpenAI-compatible")
  ) {
    throw new BadRequestException(error.message);
  }
  throw error;
}

function assertSelectedImageModels(
  catalog: ProviderModelDiscoveryResult,
  modelKeys: readonly string[],
): void {
  for (const modelKey of modelKeys) {
    const model = catalog.models.find(
      (candidate) => candidate.providerModelId === modelKey,
    );
    if (!model) {
      throw new BadRequestException({
        code: "provider_model_discovery.model_not_found",
        message: "至少一个所选模型不在当前 API Key 返回的模型目录中。",
      });
    }
    if (
      model.completeness === "identity_only" ||
      !model.outputModalities.includes("image") ||
      (!model.operations["image.generate"] && !model.operations["image.edit"])
    ) {
      throw new BadRequestException({
        code: "provider_model_discovery.capability_unverified",
        message: `模型 ${modelKey} 只有身份信息，尚无可用于图片调用的受信能力描述。`,
      });
    }
  }
}

async function discoverModels(
  input: {
    readonly preset: NormalizedProviderInput["preset"];
    readonly baseUrl: string;
    readonly apiKey: Uint8Array;
    readonly observedAt: Date;
    readonly refineModelKeys?: readonly string[];
  },
  requester: ProviderProbeRequester = requestProviderProbeJson,
): Promise<ProviderModelDiscoveryResult> {
  const catalog = await discoverProviderModelCatalog(input, (request) =>
    requester({
      ...request,
      maximumResponseBytes: modelDiscoveryResponseLimit,
    }),
  );
  type ApiModel = ProviderModelDiscoveryResult["models"][number];
  type EvidencedApiModel = Extract<
    ApiModel,
    { completeness: "partial" | "complete" }
  >;
  type ApiOperation = NonNullable<
    EvidencedApiModel["operations"]["image.generate"]
  >;
  const cloneParameter = (
    parameter: ProviderModelParameterDefinition,
  ): ApiOperation["parameters"][number] => {
    const common = {
      key: parameter.key,
      label: parameter.label,
      ...(parameter.description ? { description: parameter.description } : {}),
      required: parameter.required,
      evidence: parameter.evidence.map((item) => ({
        ...item,
      })),
    };
    if (parameter.valueType === "enum") {
      return {
        ...common,
        valueType: "enum",
        values: [...parameter.values],
      };
    }
    if (parameter.valueType === "integer") {
      return {
        ...common,
        valueType: "integer",
        minimum: parameter.minimum,
        maximum: parameter.maximum,
        ...(parameter.step === undefined ? {} : { step: parameter.step }),
      };
    }
    if (parameter.valueType === "boolean") {
      return {
        ...common,
        valueType: "boolean",
      };
    }
    return {
      ...common,
      valueType: "string",
      maxLength: parameter.maxLength,
    };
  };
  const cloneOperation = (
    operation: ProviderModelOperationDefinition,
  ): ApiOperation => ({
    apiSurfaces: [...operation.apiSurfaces],
    parameters: operation.parameters.map(cloneParameter),
    evidence: operation.evidence.map((item) => ({
      ...item,
    })),
  });
  const cloneModel = (model: (typeof catalog.models)[number]): ApiModel => {
    const generate = model.operations["image.generate"];
    const edit = model.operations["image.edit"];
    return {
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      ...(model.description ? { description: model.description } : {}),
      inputModalities: [...model.inputModalities],
      outputModalities: [...model.outputModalities],
      operations: {
        ...(generate ? { "image.generate": cloneOperation(generate) } : {}),
        ...(edit ? { "image.edit": cloneOperation(edit) } : {}),
      },
      completeness: model.completeness,
      evidence: model.evidence.map((item) => ({
        ...item,
      })),
    } as ApiModel;
  };
  return {
    schemaVersion: 1,
    providerPreset: input.preset,
    discoveryMethod: catalog.discoveryMethod,
    sourceDigest: catalog.sourceDigest,
    discoveredAt: input.observedAt.toISOString(),
    models: catalog.models.map(cloneModel),
  };
}

function responseFrom(
  record: Awaited<
    ReturnType<ServerDatabaseRuntime["providerSettings"]["list"]>
  >[number],
): ProviderSettingSummary {
  return {
    id: record.id,
    displayName: record.displayName,
    preset: record.preset,
    baseUrl: record.baseUrl,
    modelKeys: [...record.modelKeys],
    ...(record.modelCatalog
      ? {
          modelCatalog: {
            revision: record.modelCatalog.revision,
            discoveredAt: record.modelCatalog.discoveredAt.toISOString(),
            sourceDigest: record.modelCatalog.sourceDigest,
            discoveryMethod: record.modelCatalog.discoveryMethod,
            ...(record.modelCatalog.activatedRevision
              ? {
                  activatedRevision: record.modelCatalog.activatedRevision,
                }
              : {}),
            changesPendingReview: record.modelCatalog.changesPendingReview,
          },
        }
      : {}),
    lifecycle: record.lifecycle,
    validation: record.validation,
    secretConfigured: record.secretConfigured,
    canRefreshModelCatalog: record.canRefreshModelCatalog,
    ...(record.secretFingerprintSuffix
      ? {
          secretFingerprintSuffix: record.secretFingerprintSuffix,
        }
      : {}),
    ...(record.secretRotatedAt
      ? {
          secretRotatedAt: record.secretRotatedAt.toISOString(),
        }
      : {}),
    ...(record.validatedAt
      ? { validatedAt: record.validatedAt.toISOString() }
      : {}),
    ...(record.activatedAt
      ? { activatedAt: record.activatedAt.toISOString() }
      : {}),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Controller()
export class WorkspaceProviderSettingsController {
  public constructor(
    @Inject(SERVER_CONFIG)
    private readonly config: ServerConfig,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    @Inject(PROVIDER_SECRET_DATABASE_WRITER)
    private readonly secretWriter: ProviderSecretDatabaseWriter,
    @Inject(PROVIDER_SECRET_MATERIAL_RESOLVER)
    private readonly secretResolver: ProviderSecretMaterialResolver,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  private providerRequester(): ProviderProbeRequester {
    return (request) =>
      requestProviderProbeJson(
        request,
        this.config.providerProxyUrl
          ? {
              proxyUrl: this.config.providerProxyUrl,
            }
          : {},
      );
  }

  @ContractRoute(getWorkspaceProviderSettingsRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceProviderSettings> {
    const { scope } = this.contexts.require(request);
    const providers = await this.database.providerSettings.list(
      scope,
      new Date(),
    );
    return {
      credentialStorage: this.secretWriter.readiness(),
      providers: providers.map(responseFrom),
    };
  }

  @ContractRoute(renameWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async rename(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Body(new ContractBodyPipe(RenameProviderSettingBodySchema))
    body: RenameProviderSettingBody,
  ): Promise<ProviderSettingMutationResult> {
    const displayName = body.displayName.trim();
    if (!displayName || displayName.length > 160) {
      throw new BadRequestException(
        "Provider display name must contain between 1 and 160 characters.",
      );
    }
    const { scope } = this.contexts.require(request);
    try {
      const provider = await this.database.providerSettings.rename({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        displayName,
        now: new Date(),
        audit: auditFor(scope, request),
      });
      return { provider: responseFrom(provider), result: "renamed" };
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(discoverWorkspaceProviderModelsRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async discover(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(DiscoverProviderModelsBodySchema))
    body: DiscoverProviderModelsBody,
  ): Promise<ProviderModelDiscoveryResult> {
    this.contexts.require(request);
    const endpoint = normalizeProviderSettingBaseUrl(body.preset, body.baseUrl);
    const material = providerKeyMaterial(body.apiKey);
    try {
      const discovery = await discoverModels(
        {
          preset: body.preset,
          baseUrl: endpoint.baseUrl,
          apiKey: material,
          observedAt: new Date(),
        },
        this.providerRequester(),
      );
      const snapshot = await this.database.modelReferences.getCurrent();
      const providerKey = getProviderDefinition(
        body.preset,
      ).modelsDevProviderKey;
      const exact = new Map<string, string>();
      const all = new Map<string, Set<string>>();
      for (const provider of snapshot?.document.providers ?? []) {
        for (const model of provider.models) {
          if (!model.canonicalModelKey) continue;
          const candidates =
            all.get(model.upstreamModelId) ?? new Set<string>();
          candidates.add(model.canonicalModelKey);
          all.set(model.upstreamModelId, candidates);
          if (providerKey && provider.slug === providerKey) {
            exact.set(model.upstreamModelId, model.canonicalModelKey);
          }
        }
      }
      return {
        ...discovery,
        models: discovery.models.map((model) => {
          const candidates = all.get(model.providerModelId);
          const modelsDevSlug =
            exact.get(model.providerModelId) ??
            (candidates?.size === 1 ? [...candidates][0] : undefined);
          return {
            ...model,
            suggestedCanonicalSlug:
              modelsDevSlug ?? fallbackCanonicalSlug(model.providerModelId),
            suggestionSource: modelsDevSlug ? "models_dev" : "provider",
          };
        }),
      };
    } catch (error) {
      return mapProviderSettingsError(error);
    } finally {
      material.fill(0);
    }
  }

  @ContractRoute(refreshWorkspaceProviderModelCatalogRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async refreshModelCatalog(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(RefreshProviderModelCatalogBodySchema))
    body: RefreshProviderModelCatalogBody,
  ): Promise<ProviderModelCatalogRefreshResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    const observedAt = new Date();
    try {
      const identity =
        await this.database.providerSettings.resolveModelCatalogRefreshIdentity(
          scope,
          providerSettingId,
          observedAt,
        );
      return await this.secretResolver.withResolvedMaterial(
        identity.secret,
        async (material) => {
          const catalog = await discoverModels(
            {
              preset: identity.preset,
              baseUrl: identity.baseUrl,
              apiKey: material,
              observedAt,
              refineModelKeys: identity.modelKeys,
            },
            this.providerRequester(),
          );
          if (identity.mode === "staged") {
            assertSelectedImageModels(catalog, identity.modelKeys);
          }
          const probeModelKeys =
            identity.mode === "staged"
              ? identity.modelKeys
              : identity.modelKeys.filter((modelKey) => {
                  const model = catalog.models.find(
                    (candidate) => candidate.providerModelId === modelKey,
                  );
                  return Boolean(
                    model &&
                    model.completeness !== "identity_only" &&
                    model.outputModalities.includes("image") &&
                    (model.operations["image.generate"] ||
                      model.operations["image.edit"]),
                  );
                });
          if (probeModelKeys.length > 0) {
            await probeProviderSetting(
              {
                preset: identity.preset,
                baseUrl: identity.baseUrl,
                apiKey: material,
                modelKeys: probeModelKeys,
              },
              this.providerRequester(),
            );
          }
          const { discoveredAt, ...catalogDocument } = catalog;
          const result =
            await this.database.providerSettings.refreshModelCatalog({
              scope,
              settingId: providerSettingId,
              expectedVersion: body.expectedVersion,
              idempotencyKey: operationKey,
              requestDigest: digestProviderValue({
                operation: "refresh_model_catalog",
                providerSettingId,
                expectedVersion: body.expectedVersion,
              }),
              snapshotId: ulid(),
              document: catalogDocument,
              discoveredAt: new Date(discoveredAt),
              expectedActiveSecretVersionId: identity.secret.id,
              expectedSecretMaterialGeneration:
                identity.secret.materialGeneration,
              now: new Date(),
              audit: auditFor(scope, request),
              relatedAuditEventIds: [],
            });
          return {
            provider: responseFrom(result.provider),
            result: result.result,
            changesPendingReview: result.changesPendingReview,
          };
        },
      );
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(reviewWorkspaceProviderModelCatalogRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async reviewModelCatalog(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
  ): Promise<ProviderModelCatalogReview> {
    const { scope } = this.contexts.require(request);
    try {
      const review = await this.database.providerSettings.getModelCatalogReview(
        scope,
        providerSettingId,
        new Date(),
      );
      return JSON.parse(JSON.stringify(review)) as ProviderModelCatalogReview;
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(adoptWorkspaceProviderModelCatalogRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async adoptModelCatalog(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(AdoptProviderModelCatalogBodySchema))
    body: AdoptProviderModelCatalogBody,
  ): Promise<ProviderModelCatalogAdoptionResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    const observedAt = new Date();
    try {
      const identity =
        await this.database.providerSettings.resolveModelCatalogAdoptionIdentity(
          scope,
          providerSettingId,
          observedAt,
        );
      if (
        identity.currentRevision !== body.currentRevision ||
        identity.activatedRevision !== body.activatedRevision
      ) {
        throw new ConflictException(
          "Provider model catalog revisions changed before adoption.",
        );
      }
      return await this.secretResolver.withResolvedMaterial(
        identity.secret,
        async (material) => {
          const catalog = await discoverModels(
            {
              preset: identity.preset,
              baseUrl: identity.baseUrl,
              apiKey: material,
              observedAt,
              refineModelKeys: identity.modelKeys,
            },
            this.providerRequester(),
          );
          assertSelectedImageModels(catalog, identity.modelKeys);
          await probeProviderSetting(
            {
              preset: identity.preset,
              baseUrl: identity.baseUrl,
              apiKey: material,
              modelKeys: identity.modelKeys,
            },
            this.providerRequester(),
          );
          const catalogDocument = parseProviderModelCatalogDocument({
            schemaVersion: catalog.schemaVersion,
            providerPreset: catalog.providerPreset,
            discoveryMethod: catalog.discoveryMethod,
            sourceDigest: catalog.sourceDigest,
            models: catalog.models,
          });
          const runtimeDigest = selectedCatalogRuntimeDigest(
            catalogDocument,
            identity.modelKeys,
          );
          if (runtimeDigest !== identity.currentRuntimeDigest) {
            throw new ConflictException(
              "Provider model facts changed after review; refresh the catalog before adoption.",
            );
          }
          const result = await this.database.providerSettings.adoptModelCatalog(
            {
              scope,
              settingId: providerSettingId,
              expectedVersion: body.expectedVersion,
              expectedCurrentRevision: body.currentRevision,
              expectedActivatedRevision: body.activatedRevision,
              idempotencyKey: operationKey,
              requestDigest: digestProviderValue({
                operation: "adopt_model_catalog",
                providerSettingId,
                expectedVersion: body.expectedVersion,
                currentRevision: body.currentRevision,
                activatedRevision: body.activatedRevision,
              }),
              rediscoveredSourceDigest: catalog.sourceDigest,
              rediscoveredRuntimeDigest: runtimeDigest,
              expectedActiveSecretVersionId: identity.secret.id,
              expectedSecretMaterialGeneration:
                identity.secret.materialGeneration,
              resources: {
                models: Array.from({ length: 32 }, () => ({
                  modelProfileRevisionId: ulid(),
                  modelDeploymentId: ulid(),
                  pricingRevisionId: ulid(),
                  routePolicyRevisionIds: Array.from({ length: 32 }, () =>
                    ulid(),
                  ),
                })),
              },
              now: new Date(),
              audit: auditFor(scope, request),
              relatedAuditEventIds: [],
            },
          );
          return {
            provider: responseFrom(result.provider),
            result: result.result,
            adoptedRevision: result.adoptedRevision,
          };
        },
      );
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(createWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateProviderSettingBodySchema))
    body: CreateProviderSettingBody,
  ): Promise<ProviderSettingCreated> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException("Idempotency-Key is required.");
    }
    const normalized = normalizeInput(body);
    const context = this.contexts.require(request);
    const settingId = ulid();
    const endpointId = ulid();
    const credentialId = ulid();
    const secretVersionId = ulid();
    const material = providerKeyMaterial(body.apiKey);
    try {
      const catalog = await discoverModels(
        {
          preset: normalized.preset,
          baseUrl: normalized.baseUrl,
          apiKey: material,
          observedAt: new Date(),
          refineModelKeys: normalized.modelKeys,
        },
        this.providerRequester(),
      );
      if (normalized.modelKeys.length > 0) {
        assertSelectedImageModels(catalog, normalized.modelKeys);
        await probeProviderSetting(
          {
            preset: normalized.preset,
            baseUrl: normalized.baseUrl,
            apiKey: material,
            modelKeys: normalized.modelKeys,
          },
          this.providerRequester(),
        );
      }
      const prepared = await this.secretWriter.prepare(
        {
          instanceId: this.config.instanceId,
          workspaceId: context.scope.workspaceId,
          credentialId,
          secretVersionId,
          providerKind: normalized.providerKind,
          formatVersion: 1,
        },
        material,
      );
      const baseUrlDigest = digestProviderValue({
        baseUrl: normalized.baseUrl,
      });
      const credentialIdentityDigest = digestProviderValue({
        credentialKey: `provider-setting-${settingId}`,
        providerEndpointId: endpointId,
        identityEpoch: 1,
      });
      const requestDigest = digestProviderValue({
        displayName: normalized.displayName,
        preset: normalized.preset,
        baseUrl: normalized.baseUrl,
        hardLimitAmount: normalized.hardLimitAmount,
        modelKeys: normalized.modelKeys,
        secretMaterialFingerprint: prepared.materialFingerprint,
      });
      const now = new Date();
      const { discoveredAt: catalogDiscoveredAt, ...catalogDocument } = catalog;
      const modelCatalogDigest = digestProviderValue(catalogDocument);
      const validationDigest = providerSettingValidationDigest({
        providerSettingId: settingId,
        providerEndpointId: endpointId,
        preset: normalized.preset,
        baseUrlDigest,
        modelCatalogDigest,
        modelCatalogSourceDigest: catalogDocument.sourceDigest,
        selectedModelKeys: normalized.modelKeys,
        secretMaterialFingerprint: prepared.materialFingerprint,
        validatedAt: now,
      });
      const result = await this.database.providerSettings.create({
        scope: context.scope,
        settingId,
        endpointId,
        credentialId,
        secretVersionId,
        displayName: normalized.displayName,
        preset: normalized.preset,
        adapterKind: normalized.adapterKind,
        baseUrl: normalized.baseUrl,
        canonicalOrigin: normalized.canonicalOrigin,
        regionCode: normalized.regionCode,
        baseUrlDigest,
        modelKeys: normalized.modelKeys,
        modelCatalog: {
          snapshotId: ulid(),
          document: catalogDocument,
          discoveredAt: new Date(catalogDiscoveredAt),
        },
        providerKind: normalized.providerKind,
        authorityDigest: digestProviderValue({
          authority: "workspace-managed-provider",
        }),
        billingIdentityDigest: digestProviderValue({
          billingIdentity: `workspace:${context.scope.workspaceId}`,
        }),
        egressIdentityDigest: digestProviderValue({
          canonicalOrigin: normalized.canonicalOrigin,
        }),
        credentialIdentityDigest,
        secretAadDigest: prepared.aadDigest,
        secretMaterialFingerprint: prepared.materialFingerprint,
        secretSource: prepared.source,
        validationDigest,
        validatedAt: now,
        idempotencyKey: idempotencyKey.trim(),
        requestDigest,
        createdAt: now,
        audit: {
          auditEventId: ulid(),
          actorPrincipalId: context.scope.principalId,
          actorType: context.scope.principalType,
          authenticationRefType: context.scope.authenticationRefType,
          authenticationRefHash: authenticationReferenceHash(
            context.scope.authenticationRefId,
          ),
          authorityType: context.scope.authorityType,
          authorityId: context.scope.authorityId,
          authorityVersion: context.scope.authorityVersion,
          requestId: request.id,
        },
        secretAuditEventId: ulid(),
      });
      const provider =
        result.provider.lifecycle === "active"
          ? result.provider
          : (
              await this.database.providerSettings.activate({
                scope: context.scope,
                settingId: result.provider.id,
                expectedVersion: result.provider.version,
                idempotencyKey: `activate-${createHash("sha256")
                  .update(idempotencyKey.trim())
                  .digest("hex")}`,
                requestDigest: digestProviderValue({
                  operation: "activate",
                  providerSettingId: result.provider.id,
                  expectedVersion: result.provider.version,
                  hardLimitAmount: normalized.hardLimitAmount,
                }),
                hardLimitAmount: normalized.hardLimitAmount,
                now: new Date(),
                audit: auditFor(context.scope, request),
                relatedAuditEventIds: [ulid()],
                resources: {
                  budgetAccountId: ulid(),
                  models: Array.from({ length: 32 }, () => ({
                    modelProfileRevisionId: ulid(),
                    modelDeploymentId: ulid(),
                    pricingRevisionId: ulid(),
                    routePolicyRevisionIds: Array.from({ length: 32 }, () =>
                      ulid(),
                    ),
                  })),
                  workspacePolicyRevisionId: ulid(),
                },
              })
            ).provider;
      return {
        provider: responseFrom(provider),
        result: result.result,
      };
    } catch (error) {
      if (error instanceof ProviderSecretPersistenceError) {
        throw new ServiceUnavailableException(error.message);
      }
      return mapProviderSettingsError(error);
    } finally {
      material.fill(0);
    }
  }

  @ContractRoute(validateWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async validate(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ValidateProviderSettingBodySchema))
    body: ValidateProviderSettingBody,
  ): Promise<ProviderSettingMutationResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    const material = providerKeyMaterial(body.apiKey);
    try {
      const identity =
        await this.database.providerSettings.resolveValidationIdentity(
          scope,
          providerSettingId,
          new Date(),
        );
      assertProviderKeyFingerprint(
        material,
        identity.secretMaterialFingerprint,
      );
      await probeProviderSetting(
        {
          preset: identity.preset,
          baseUrl: identity.baseUrl,
          apiKey: material,
          modelKeys: identity.modelKeys,
        },
        this.providerRequester(),
      );
      const result = await this.database.providerSettings.validate({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        idempotencyKey: operationKey,
        requestDigest: digestProviderValue({
          operation: "validate",
          providerSettingId,
          expectedVersion: body.expectedVersion,
        }),
        now: new Date(),
        audit: auditFor(scope, request),
        relatedAuditEventIds: [ulid()],
      });
      return {
        provider: responseFrom(result.provider),
        result: result.result,
      };
    } catch (error) {
      return mapProviderSettingsError(error);
    } finally {
      material.fill(0);
    }
  }

  @ContractRoute(activateWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async activate(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ActivateProviderSettingBodySchema))
    body: ActivateProviderSettingBody,
  ): Promise<ProviderSettingMutationResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.providerSettings.activate({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        ...(body.modelPricingConfigurations
          ? {
              modelPricingConfigurations: body.modelPricingConfigurations,
            }
          : {}),
        idempotencyKey: operationKey,
        requestDigest: digestProviderValue({
          operation: "activate",
          providerSettingId,
          expectedVersion: body.expectedVersion,
          hardLimitAmount: body.hardLimitAmount,
          modelPricingConfigurations: body.modelPricingConfigurations,
        }),
        hardLimitAmount: body.hardLimitAmount,
        now: new Date(),
        audit: auditFor(scope, request),
        relatedAuditEventIds: [ulid()],
        resources: {
          budgetAccountId: ulid(),
          models: Array.from({ length: 32 }, () => ({
            modelProfileRevisionId: ulid(),
            modelDeploymentId: ulid(),
            pricingRevisionId: ulid(),
            routePolicyRevisionIds: Array.from({ length: 32 }, () => ulid()),
          })),
          workspacePolicyRevisionId: ulid(),
        },
      });
      return {
        provider: responseFrom(result.provider),
        result: result.result,
      };
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(rotateWorkspaceProviderSettingSecretRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async rotateSecret(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(RotateProviderSettingSecretBodySchema))
    body: RotateProviderSettingSecretBody,
  ): Promise<ProviderSettingMutationResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const identity =
      await this.database.providerSettings.resolveSecretWriteIdentity(
        scope,
        providerSettingId,
        now,
      );
    const secretVersionId = ulid();
    const material = providerKeyMaterial(body.apiKey);
    try {
      const validation =
        await this.database.providerSettings.resolveValidationIdentity(
          scope,
          providerSettingId,
          now,
        );
      await probeProviderSetting(
        {
          preset: validation.preset,
          baseUrl: validation.baseUrl,
          apiKey: material,
          modelKeys: validation.modelKeys,
        },
        this.providerRequester(),
      );
      const prepared = await this.secretWriter.prepare(
        {
          instanceId: this.config.instanceId,
          workspaceId: scope.workspaceId,
          credentialId: identity.credentialId,
          secretVersionId,
          providerKind: identity.providerKind,
          formatVersion: 1,
        },
        material,
      );
      const mode = body.mode ?? "graceful";
      const result = await this.database.providerSettings.rotateSecret({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        idempotencyKey: operationKey,
        requestDigest: digestProviderValue({
          operation: "rotate_secret",
          providerSettingId,
          expectedVersion: body.expectedVersion,
          mode,
          materialFingerprint: prepared.materialFingerprint,
        }),
        now,
        audit: auditFor(scope, request),
        relatedAuditEventIds: [ulid(), ulid()],
        secretVersionId,
        secretAadDigest: prepared.aadDigest,
        secretMaterialFingerprint: prepared.materialFingerprint,
        secretSource: prepared.source,
        mode,
        drainDeadlineAt: new Date(now.getTime() + 15 * 60 * 1_000),
      });
      return {
        provider: responseFrom(result.provider),
        result: result.result,
      };
    } catch (error) {
      if (error instanceof ProviderSecretPersistenceError) {
        throw new ServiceUnavailableException(error.message);
      }
      return mapProviderSettingsError(error);
    } finally {
      material.fill(0);
    }
  }

  @ContractRoute(disableWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async disable(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key")
    idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ProviderSettingVersionBodySchema))
    body: ProviderSettingVersionBody,
  ): Promise<ProviderSettingMutationResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.providerSettings.disable({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        idempotencyKey: operationKey,
        requestDigest: digestProviderValue({
          operation: "disable",
          providerSettingId,
          expectedVersion: body.expectedVersion,
        }),
        now: new Date(),
        audit: auditFor(scope, request),
        relatedAuditEventIds: [],
      });
      return {
        provider: responseFrom(result.provider),
        result: result.result,
      };
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }

  @ContractRoute(deleteWorkspaceProviderSettingRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async delete(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(ProviderSettingVersionBodySchema))
    body: ProviderSettingVersionBody,
  ): Promise<ProviderSettingMutationResult> {
    const operationKey = requireMutationIdentity(
      providerSettingId,
      idempotencyKey,
    );
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.providerSettings.delete({
        scope,
        settingId: providerSettingId,
        expectedVersion: body.expectedVersion,
        idempotencyKey: operationKey,
        requestDigest: digestProviderValue({
          operation: "delete",
          providerSettingId,
          expectedVersion: body.expectedVersion,
        }),
        now: new Date(),
        audit: auditFor(scope, request),
        relatedAuditEventIds: [],
      });
      return {
        provider: responseFrom(result.provider),
        result: result.result,
      };
    } catch (error) {
      return mapProviderSettingsError(error);
    }
  }
}
