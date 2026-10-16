import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { ModelProfileDocumentV1 } from "@kanvas/application";
import {
  CreateCanonicalModelBodySchema,
  ImportProviderModelsBodySchema,
  MapProviderModelBodySchema,
  ModelReferenceSearchQuerySchema,
  SyncModelReferenceBodySchema,
  PublishCanonicalModelBodySchema,
  PublishProviderModelBodySchema,
  createWorkspaceModelRoute,
  getWorkspaceModelsRoute,
  getWorkspaceProviderModelCatalogRoute,
  importWorkspaceProviderModelsRoute,
  mapWorkspaceProviderModelRoute,
  publishWorkspaceModelRoute,
  publishWorkspaceProviderModelRoute,
  searchModelReferenceRoute,
  syncWorkspaceModelReferenceRoute,
  type CanonicalModelMutationResult,
  type CanonicalModelSummary,
  type CreateCanonicalModelBody,
  type ImportProviderModelsBody,
  type MapProviderModelBody,
  type ModelReferenceSearchQuery,
  type ModelReferenceSearchResult,
  type ModelReferenceSyncResult,
  type ProviderModelCatalog,
  type ProviderModelsImported,
  type PublishCanonicalModelBody,
  type PublishProviderModelBody,
  type SyncModelReferenceBody,
  type WorkspaceModels,
} from "@kanvas/contracts/api";
import {
  getProviderDefinition,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";
import {
  digestProviderValue,
  type ControlPlaneAuditContext,
  type WorkspaceModelRecord,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import {
  loadLatestModelReference,
  resolveModelReferenceDefaults,
} from "../model-reference-sync.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

type ModelProfileSummary = NonNullable<CanonicalModelSummary["profile"]>;
type ModelOperationKey = keyof ModelProfileDocumentV1["operations"];

const operationKeys = [
  "text.generate",
  "image.generate",
  "image.edit",
] as const satisfies readonly ModelOperationKey[];

const modelSlugPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u;

function usableModelSlug(value: string): string {
  if (modelSlugPattern.test(value)) return value;
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._/-]+/gu, "-")
      .replace(/^[^A-Za-z0-9]+/u, "")
      .slice(0, 160) || "model"
  );
}

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:model-control-plane-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(
  scope: ReturnType<RequestAuthorizationContextStore["require"]>["scope"],
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

function profileSummary(profile: ModelProfileDocumentV1): ModelProfileSummary {
  const { description, contextWindow, maximumOutputTokens } = profile.model;
  if (
    description === undefined ||
    profile.model.inputModalities.includes("mask") ||
    profile.model.outputModalities.includes("mask")
  ) {
    throw new Error("Canonical Model profile is missing required model facts.");
  }
  const operations = Object.fromEntries(
    operationKeys.flatMap((key) => {
      const operation = profile.operations[key];
      if (!operation) return [];
      return [
        [
          key,
          {
            parameters: operation.parameters.map(
              ({ evidence, ...parameter }) => {
                void evidence;
                return parameter;
              },
            ),
          },
        ],
      ];
    }),
  ) as ModelProfileSummary["operations"];
  return {
    displayName: profile.model.displayName,
    family: profile.model.family,
    description,
    inputModalities: profile.model.inputModalities.filter(
      (modality) => modality !== "mask",
    ),
    outputModalities: profile.model.outputModalities.filter(
      (modality) => modality !== "mask",
    ),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(profile.model.maximumInputTokens === undefined
      ? {}
      : { maximumInputTokens: profile.model.maximumInputTokens }),
    ...(maximumOutputTokens === undefined ? {} : { maximumOutputTokens }),
    ...(profile.model.attachment === undefined
      ? {}
      : { attachment: profile.model.attachment }),
    ...(profile.model.reasoning === undefined
      ? {}
      : { reasoning: profile.model.reasoning }),
    ...(profile.model.toolCall === undefined
      ? {}
      : { toolCall: profile.model.toolCall }),
    ...(profile.model.structuredOutput === undefined
      ? {}
      : { structuredOutput: profile.model.structuredOutput }),
    ...(profile.model.temperature === undefined
      ? {}
      : { temperature: profile.model.temperature }),
    operations,
  };
}

function modelSummary(model: WorkspaceModelRecord): CanonicalModelSummary {
  return {
    id: model.id,
    slug: model.slug,
    lifecycle: model.lifecycle,
    sourceKind: model.sourceKind,
    ...(model.sourceReference
      ? { sourceReference: model.sourceReference }
      : {}),
    version: model.version,
    ...(model.profile ? { profile: profileSummary(model.profile) } : {}),
    providers: model.providers.map((provider) => ({
      id: provider.id,
      providerSettingId: provider.providerSettingId,
      providerName: provider.providerName,
      providerPreset:
        provider.providerPreset as CanonicalModelSummary["providers"][number]["providerPreset"],
      upstreamModelId: provider.upstreamModelId,
      lifecycle: provider.lifecycle,
      ...(provider.agentTextTransport
        ? { agentTextTransport: { ...provider.agentTextTransport } }
        : {}),
      supportedAgentTextTransports: provider.supportedAgentTextTransports.map(
        (transport) => ({ ...transport }),
      ),
      supportedOperations: [...provider.supportedOperations],
      operations: Object.fromEntries(
        Object.entries(provider.operations).map(([key, operation]) => [
          key,
          {
            parameters: operation.parameters.map((parameter) => ({
              ...parameter,
            })),
          },
        ]),
      ),
      providerReportedPricingAvailable:
        provider.providerReportedPricingAvailable,
      ...(provider.maximumCharge
        ? { maximumCharge: { ...provider.maximumCharge } }
        : {}),
      version: provider.version,
    })),
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

function mapModelControlPlaneError(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  if (error.message.includes("was not found")) {
    throw new NotFoundException(error.message);
  }
  if (
    error.message.includes("changed before") ||
    error.message.includes("already belongs") ||
    error.message.includes("cannot be changed")
  ) {
    throw new ConflictException(error.message);
  }
  if (error instanceof TypeError || error.name === "DomainError") {
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Controller()
export class WorkspaceModelsController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  private async model(
    scope: Parameters<
      ServerDatabaseRuntime["modelControlPlane"]["listModels"]
    >[0],
    id: string,
  ) {
    const model = (
      await this.database.modelControlPlane.listModels(scope, new Date())
    ).find((candidate) => candidate.id === id);
    if (!model) throw new NotFoundException("Canonical Model was not found.");
    return modelSummary(model);
  }

  private async profileDocument(
    current: WorkspaceModelRecord,
    body: PublishCanonicalModelBody,
    now: Date,
  ): Promise<ModelProfileDocumentV1> {
    if (
      body.outputModalities.includes("text") &&
      (body.contextWindow === undefined ||
        body.maximumOutputTokens === undefined)
    ) {
      throw new BadRequestException(
        "Text models require confirmed context and output token limits.",
      );
    }
    const modelReference =
      current.sourceKind === "models_dev"
        ? await this.database.modelReferences.getCurrent()
        : undefined;
    const referenceKey = current.sourceReference ?? current.slug;
    const referenceModel = modelReference?.document.canonicalModels.find(
      (candidate) => candidate.key === referenceKey,
    );
    if (current.sourceKind === "models_dev" && !referenceModel) {
      throw new BadRequestException(
        "模型能力参考数据暂时不可用，请刷新模型目录后重试。",
      );
    }
    const sourceDigest =
      modelReference?.sourceDigest ?? digestProviderValue(body);
    const observedAt = modelReference?.document.observedAt ?? now.toISOString();
    const attachment = body.attachment ?? referenceModel?.attachment;
    const reasoning = body.reasoning ?? referenceModel?.reasoning;
    const toolCall = body.toolCall ?? referenceModel?.toolCall;
    const structuredOutput =
      body.structuredOutput ?? referenceModel?.structuredOutput;
    const temperature = body.temperature ?? referenceModel?.temperature;
    const maximumInputTokens =
      body.maximumInputTokens ?? referenceModel?.limit?.input;
    const evidence = Object.freeze({
      kind: "administrator" as const,
      reference: current.sourceReference ?? current.slug,
      observedAt: now.toISOString(),
      sourceDigest,
      confidence: "high" as const,
      claim: "supported" as const,
    });
    const operations = Object.fromEntries(
      operationKeys.flatMap((key) => {
        const operation = body.operations[key];
        if (!operation) return [];
        return [
          [
            key,
            {
              parameters: operation.parameters.map((parameter) => ({
                ...parameter,
                evidence: [evidence],
              })),
              evidence: [evidence],
            },
          ],
        ];
      }),
    ) as ModelProfileDocumentV1["operations"];
    return {
      schemaVersion: 1,
      model: {
        slug: current.slug,
        displayName: body.displayName,
        family: body.family,
        description: body.description,
        inputModalities: [...body.inputModalities],
        outputModalities: [...body.outputModalities],
        ...(body.contextWindow === undefined
          ? {}
          : { contextWindow: body.contextWindow }),
        ...(maximumInputTokens === undefined ? {} : { maximumInputTokens }),
        ...(body.maximumOutputTokens === undefined
          ? {}
          : { maximumOutputTokens: body.maximumOutputTokens }),
        ...(attachment === undefined ? {} : { attachment }),
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(toolCall === undefined ? {} : { toolCall }),
        ...(structuredOutput === undefined ? {} : { structuredOutput }),
        ...(temperature === undefined ? {} : { temperature }),
      },
      operations,
      sources: [
        {
          kind: current.sourceKind,
          reference: referenceKey,
          observedAt,
          sourceDigest,
        },
      ],
    };
  }

  @ContractRoute(getWorkspaceModelsRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(@Req() request: FastifyRequest): Promise<WorkspaceModels> {
    const { scope } = this.contexts.require(request);
    return {
      models: (
        await this.database.modelControlPlane.listModels(scope, new Date())
      ).map(modelSummary),
    };
  }

  @ContractRoute(getWorkspaceProviderModelCatalogRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async getProviderModelCatalog(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
  ): Promise<ProviderModelCatalog> {
    const { scope } = this.contexts.require(request);
    try {
      const now = new Date();
      const [catalogModels, providerSettings, reference] = await Promise.all([
        this.database.modelControlPlane.listProviderCatalogModels(
          scope,
          providerSettingId,
          now,
        ),
        this.database.providerSettings.list(scope, now),
        this.database.modelReferences.getCurrent(),
      ]);
      const provider = providerSettings.find(
        (candidate) => candidate.id === providerSettingId,
      );
      if (!provider) throw new NotFoundException("Provider was not found.");
      const providerKey = getProviderDefinition(
        provider.preset,
      ).modelsDevProviderKey;
      const exact = new Map<string, string>();
      const candidates = new Map<string, Set<string>>();
      for (const referenceProvider of reference?.document.providers ?? []) {
        for (const referenceModel of referenceProvider.models) {
          if (!referenceModel.canonicalModelKey) continue;
          const values =
            candidates.get(referenceModel.upstreamModelId) ?? new Set<string>();
          values.add(referenceModel.canonicalModelKey);
          candidates.set(referenceModel.upstreamModelId, values);
          if (providerKey && referenceProvider.slug === providerKey) {
            exact.set(
              referenceModel.upstreamModelId,
              referenceModel.canonicalModelKey,
            );
          }
        }
      }
      return {
        models: catalogModels.map((model) => {
          const possible = candidates.get(model.upstreamModelId);
          const suggestedCanonicalSlug = usableModelSlug(
            exact.get(model.upstreamModelId) ??
              (possible?.size === 1
                ? [...possible][0]!
                : model.upstreamModelId),
          );
          return {
            upstreamModelId: model.upstreamModelId,
            displayName: model.displayName,
            ...(model.description ? { description: model.description } : {}),
            inputModalities: [
              ...model.inputModalities,
            ] as ProviderModelCatalog["models"][number]["inputModalities"],
            outputModalities: [
              ...model.outputModalities,
            ] as ProviderModelCatalog["models"][number]["outputModalities"],
            completeness: model.completeness,
            suggestedCanonicalSlug,
            suggestionSource:
              exact.has(model.upstreamModelId) || possible?.size === 1
                ? ("models_dev" as const)
                : ("provider" as const),
            ...(model.imported
              ? {
                  imported: {
                    id: model.imported.id,
                    ...(model.imported.canonicalModelId
                      ? { canonicalModelId: model.imported.canonicalModelId }
                      : {}),
                    lifecycle: model.imported.lifecycle,
                    version: model.imported.version,
                  },
                }
              : {}),
          };
        }),
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }

  @ContractRoute(searchModelReferenceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async searchReference(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(ModelReferenceSearchQuerySchema))
    query: ModelReferenceSearchQuery,
  ): Promise<ModelReferenceSearchResult> {
    this.contexts.require(request);
    const snapshot = await this.database.modelReferences.getCurrent();
    if (!snapshot) return { models: [] };
    const needle = query.q?.trim().toLocaleLowerCase() ?? "";
    return {
      models: snapshot.document.canonicalModels
        .filter((model) =>
          needle
            ? [model.key, model.displayName, model.family ?? ""].some((value) =>
                value.toLocaleLowerCase().includes(needle),
              )
            : true,
        )
        .slice(0, 50)
        .map((model) => ({
          key: model.key,
          displayName: model.displayName,
          description: model.description,
          ...(model.family ? { family: model.family } : {}),
          ...(model.attachment === undefined
            ? {}
            : { attachment: model.attachment }),
          ...(model.reasoning === undefined
            ? {}
            : { reasoning: model.reasoning }),
          ...(model.toolCall === undefined ? {} : { toolCall: model.toolCall }),
          ...(model.structuredOutput === undefined
            ? {}
            : { structuredOutput: model.structuredOutput }),
          ...(model.temperature === undefined
            ? {}
            : { temperature: model.temperature }),
          inputModalities: [...(model.modalities?.input ?? [])],
          outputModalities: [...(model.modalities?.output ?? [])],
          ...(model.limit?.context
            ? { contextWindow: model.limit.context }
            : {}),
          ...(model.limit?.input
            ? { maximumInputTokens: model.limit.input }
            : {}),
          ...(model.limit?.output
            ? { maximumOutputTokens: model.limit.output }
            : {}),
          providers: snapshot.document.providers.flatMap((provider) =>
            provider.models
              .filter((candidate) => candidate.canonicalModelKey === model.key)
              .map((candidate) => ({
                providerSlug: provider.slug,
                providerName: provider.displayName,
                upstreamModelId: candidate.upstreamModelId,
                ...(candidate.cost ? { cost: { ...candidate.cost } } : {}),
              })),
          ),
        })),
    };
  }

  @ContractRoute(syncWorkspaceModelReferenceRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async syncReference(
    @Req() request: FastifyRequest,
    @Param("modelId") modelId: string,
    @Body(new ContractBodyPipe(SyncModelReferenceBodySchema))
    body: SyncModelReferenceBody,
  ): Promise<ModelReferenceSyncResult> {
    const { scope } = this.contexts.require(request);
    const model = (
      await this.database.modelControlPlane.listModels(scope, new Date())
    ).find((candidate) => candidate.id === modelId);
    if (!model) throw new NotFoundException("Canonical Model was not found.");
    const provider = model.providers.find(
      (candidate) => candidate.id === body.providerModelId,
    );
    if (!provider) throw new NotFoundException("Provider Model was not found.");
    try {
      const latest = await loadLatestModelReference({
        store: this.database.modelReferences,
        actorPrincipalId: scope.principalId,
        now: new Date(),
        ...(body.force ? { force: true } : {}),
      });
      return resolveModelReferenceDefaults({
        document: latest.snapshot.document,
        canonicalReference: model.sourceReference ?? model.slug,
        upstreamModelId: provider.upstreamModelId,
        providerPreset: provider.providerPreset as ProviderDefinitionSlug,
        stale: latest.stale,
      });
    } catch {
      throw new ServiceUnavailableException(
        "无法获取 models.dev 模型数据，请稍后重试。",
      );
    }
  }

  @ContractRoute(createWorkspaceModelRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(CreateCanonicalModelBodySchema))
    body: CreateCanonicalModelBody,
  ): Promise<CanonicalModelMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.modelControlPlane.createCanonicalModel(
        {
          scope,
          id: ulid(),
          slug: body.slug,
          sourceKind: body.sourceKind,
          ...(body.sourceReference
            ? { sourceReference: body.sourceReference }
            : {}),
          now: new Date(),
          audit: auditFor(scope, request),
        },
      );
      return {
        model: modelSummary({ ...result.model, providers: [] }),
        result: result.replayed ? "replayed" : "created",
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }

  @ContractRoute(publishWorkspaceModelRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publish(
    @Req() request: FastifyRequest,
    @Param("modelId") modelId: string,
    @Body(new ContractBodyPipe(PublishCanonicalModelBodySchema))
    body: PublishCanonicalModelBody,
  ): Promise<CanonicalModelMutationResult> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const current = (
        await this.database.modelControlPlane.listModels(scope, now)
      ).find((candidate) => candidate.id === modelId);
      if (!current)
        throw new NotFoundException("Canonical Model was not found.");
      const result =
        await this.database.modelControlPlane.publishCanonicalModel({
          scope,
          canonicalModelId: modelId,
          expectedVersion: body.expectedVersion,
          profileRevisionId: ulid(),
          profileDocument: await this.profileDocument(current, body, now),
          now,
          audit: auditFor(scope, request),
        });
      return {
        model: await this.model(scope, modelId),
        result: result.replayed ? "replayed" : "published",
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }

  @ContractRoute(importWorkspaceProviderModelsRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async importProviderModels(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Body(new ContractBodyPipe(ImportProviderModelsBodySchema))
    body: ImportProviderModelsBody,
  ): Promise<ProviderModelsImported> {
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.modelControlPlane.importProviderModels(
        {
          scope,
          providerSettingId,
          models: body.upstreamModelIds.map((upstreamModelId) => ({
            id: ulid(),
            upstreamModelId,
          })),
          now: new Date(),
          audit: auditFor(scope, request),
        },
      );
      return {
        models: result.models.map((model) => ({
          id: model.id,
          upstreamModelId: model.upstreamModelId,
          lifecycle: model.lifecycle,
          version: model.version,
        })),
        created: result.created,
        refreshed: result.refreshed,
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }

  @ContractRoute(mapWorkspaceProviderModelRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async mapProviderModel(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Param("providerModelId") providerModelId: string,
    @Body(new ContractBodyPipe(MapProviderModelBodySchema))
    body: MapProviderModelBody,
  ): Promise<CanonicalModelMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      const result = await this.database.modelControlPlane.mapProviderModel({
        scope,
        providerSettingId,
        providerModelId,
        expectedVersion: body.expectedVersion,
        canonicalModelId: body.canonicalModelId,
        mappingSource: body.mappingSource,
        mappingConfidence: body.mappingConfidence,
        now: new Date(),
        audit: auditFor(scope, request),
      });
      return {
        model: await this.model(scope, body.canonicalModelId),
        result: result.replayed ? "replayed" : "mapped",
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }

  @ContractRoute(publishWorkspaceProviderModelRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async publishProviderModel(
    @Req() request: FastifyRequest,
    @Param("providerSettingId") providerSettingId: string,
    @Param("providerModelId") providerModelId: string,
    @Body(new ContractBodyPipe(PublishProviderModelBodySchema))
    body: PublishProviderModelBody,
  ): Promise<CanonicalModelMutationResult> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const providerAudit = auditFor(scope, request);
      const provider = {
        scope,
        providerSettingId,
        providerModelId,
        expectedVersion: body.expectedVersion,
        modelDeploymentId: ulid(),
        pricingRevisionId: ulid(),
        agentModelBindingId: ulid(),
        routePolicyRevisionIds: Array.from({ length: 32 }, () => ulid()),
        ...(body.agentTextTransport
          ? { agentTextTransport: body.agentTextTransport }
          : {}),
        pricing: body.pricing,
        now,
        audit: providerAudit,
      };
      const current = body.profile
        ? (await this.database.modelControlPlane.listModels(scope, now)).find(
            (candidate) =>
              candidate.providers.some(
                (candidateProvider) =>
                  candidateProvider.id === providerModelId &&
                  candidateProvider.providerSettingId === providerSettingId,
              ),
          )
        : undefined;
      if (body.profile && !current) {
        throw new NotFoundException("Canonical Model was not found.");
      }
      const result = body.profile
        ? await this.database.modelControlPlane.publishConfiguredModel({
            canonical: {
              scope,
              canonicalModelId: current!.id,
              expectedVersion: body.profile.expectedVersion,
              profileRevisionId: ulid(),
              profileDocument: await this.profileDocument(
                current!,
                body.profile,
                now,
              ),
              now,
              audit: auditFor(scope, request),
            },
            provider,
          })
        : await this.database.modelControlPlane.publishProviderModel(provider);
      if (!result.model.canonicalModelId) {
        throw new ConflictException(
          "Published Provider Model has no Canonical Model mapping.",
        );
      }
      return {
        model: await this.model(scope, result.model.canonicalModelId),
        result: result.replayed ? "replayed" : "published",
      };
    } catch (error) {
      return mapModelControlPlaneError(error);
    }
  }
}
