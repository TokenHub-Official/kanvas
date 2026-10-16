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
  UseGuards,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  CapabilityDefinitionPathSchema,
  CapabilityCatalogEntryPathSchema,
  CreateCapabilityDefinitionBodySchema,
  InstallCapabilityRecommendationBodySchema,
  PublishCapabilityImplementationRevisionBodySchema,
  SetCapabilityDefinitionStatusBodySchema,
  UpdateCapabilityDefinitionBodySchema,
  createWorkspaceCapabilityDefinitionRoute,
  installCapabilityRecommendationRoute,
  publishCapabilityDefinitionImplementationRoute,
  listWorkspaceCapabilityDefinitionsRoute,
  setWorkspaceCapabilityDefinitionStatusRoute,
  updateWorkspaceCapabilityDefinitionRoute,
  type CapabilityAdminSummary,
  type CapabilityBindingSummary,
  type CapabilityBindingMutationResult,
  type CapabilityDefinitionMutationResult,
  type CapabilityInstallationSummary,
  type CapabilityDefinitionSummary,
  type CreateCapabilityDefinitionBody,
  type InstallCapabilityRecommendationBody,
  type PublishCapabilityImplementationRevisionBody,
  type ProviderExecutionRouteSummary,
  type SetCapabilityDefinitionStatusBody,
  type UpdateCapabilityDefinitionBody,
  type WorkspaceCapabilityDefinitions,
} from "@kanvas/contracts/api";
import {
  CapabilityDefinitionAdminStoreError,
  type CapabilityBindingAdminRecord,
  type CapabilityDefinitionRecord,
  type ControlPlaneAuditContext,
  type ProviderRouteAdminRecord,
  type PublishedRuntimeAdapterRecord,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { CapabilityImplementationService } from "../capabilities/capability-implementation.service.js";
import { CapabilityInstallationService } from "../capabilities/capability-installation.service.js";
import {
  CapabilityDefinitionValidationError,
  validateCapabilityDefinitionPublication,
} from "./capability-definition-validation.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:capability-definition-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
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

function idempotencyKey(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException("A valid Idempotency-Key is required.");
  }
  return normalized;
}

function mapError(error: unknown): never {
  if (error instanceof CapabilityDefinitionValidationError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof CapabilityDefinitionAdminStoreError) {
    if (error.code === "capability_definition.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "capability_definition.key_conflict" ||
      error.code === "capability_definition.version_conflict" ||
      error.code === "capability_definition.idempotency_conflict" ||
      error.code === "capability_definition.lifecycle_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  throw error;
}

function bindingStatusFrom(
  value: CapabilityBindingAdminRecord["bindingStatus"],
): CapabilityBindingSummary["status"] {
  if (value === "active") return "enabled";
  if (value === "disabled") return "paused";
  return "retired";
}

function providerParameterDefinitionsFrom(
  value: NonNullable<ProviderRouteAdminRecord["providerParameterDefinitions"]>,
): NonNullable<ProviderExecutionRouteSummary["providerParameterDefinitions"]> {
  return JSON.parse(JSON.stringify(value)) as NonNullable<
    ProviderExecutionRouteSummary["providerParameterDefinitions"]
  >;
}

function providerParameterPoliciesFrom(
  value: NonNullable<ProviderRouteAdminRecord["providerParameterPolicies"]>,
): NonNullable<ProviderExecutionRouteSummary["providerParameterPolicies"]> {
  return JSON.parse(JSON.stringify(value)) as NonNullable<
    ProviderExecutionRouteSummary["providerParameterPolicies"]
  >;
}

function bindingFrom(
  record: CapabilityBindingAdminRecord,
): CapabilityBindingSummary {
  return {
    id: record.id,
    status: bindingStatusFrom(record.bindingStatus),
    order: record.priority,
    version: record.version,
    executionTarget: record.executionTarget,
    displayName: record.implementationDisplayName,
    ...(record.implementationDescription
      ? { description: record.implementationDescription }
      : {}),
    sourceKind: record.sourceKind,
    ...(record.providerName ? { providerName: record.providerName } : {}),
    availabilityReason: record.availabilityReason,
    implementationKey: record.implementationKey,
    implementationRevision: record.implementationRevision,
    adapterKey: record.adapterKey,
    ...(record.routePolicyRevisionId
      ? { routePolicyRevisionId: record.routePolicyRevisionId }
      : {}),
    ...(record.providerModelId
      ? { providerModelId: record.providerModelId }
      : {}),
    ...(record.apiSurface ? { apiSurface: record.apiSurface } : {}),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function providerRouteFrom(
  record: ProviderRouteAdminRecord,
): WorkspaceCapabilityDefinitions["providerRoutes"][number] {
  return {
    routePolicyRevisionId: record.routePolicyRevisionId,
    providerName: record.providerName,
    providerModelId: record.providerModelId,
    providerPreset: record.providerPreset,
    apiSurface: record.apiSurface,
    ...(record.modelOperation ? { modelOperation: record.modelOperation } : {}),
    ...(record.modelInputModalities
      ? { modelInputModalities: [...record.modelInputModalities] }
      : {}),
    ...(record.providerParameterDefinitions
      ? {
          providerParameterDefinitions: providerParameterDefinitionsFrom(
            record.providerParameterDefinitions,
          ),
        }
      : {}),
    ...(record.providerParameterPolicies
      ? {
          providerParameterPolicies: providerParameterPoliciesFrom(
            record.providerParameterPolicies,
          ),
        }
      : {}),
    availabilityReason: record.availabilityReason,
    availableBudgetAmount: record.availableBudgetAmount,
  };
}

function runtimeAdapterFrom(
  record: PublishedRuntimeAdapterRecord,
): WorkspaceCapabilityDefinitions["runtimeAdapters"][number] {
  return {
    id: record.id,
    key: record.adapterKey,
    revision: record.revision,
    digest: record.canonicalDigest,
    displayName: record.document.displayName,
    ...(record.document.description
      ? { description: record.document.description }
      : {}),
    executionTarget: record.document.executionTarget,
    sourceKinds: [...record.document.sourceKinds],
    supportedModelFormats: [...record.document.supportedModelFormats],
    ...(record.document.modelResourceInterfaceDigest
      ? {
          modelResourceInterfaceDigest:
            record.document.modelResourceInterfaceDigest,
        }
      : {}),
    invocationInputSchema: record.document.invocationInputSchema,
    invocationOutputSchema: record.document.invocationOutputSchema,
    configurationSchema: record.document.configurationSchema,
    ...(record.document.modelServiceSelector
      ? { modelServiceSelector: record.document.modelServiceSelector }
      : {}),
  };
}

function summaryFrom(
  record: CapabilityDefinitionRecord,
): CapabilityDefinitionSummary {
  return {
    id: record.id,
    key: record.key,
    status: record.status,
    version: record.version,
    contractRevisionId: record.contractRevisionId,
    contractRevision: record.contractRevision,
    contractDigest: record.contractDigest,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    idempotencyMode: record.idempotencyMode,
    supportedInvokers: [...record.supportedInvokers],
    declarationRevisionId: record.declarationRevisionId,
    declarationRevision: record.declarationRevision,
    declarationDigest: record.declarationDigest,
    declaration: record.declaration,
    bindingCount: record.bindingCount,
    activeBindingCount: record.activeBindingCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function adminSummaryFrom(
  record: CapabilityDefinitionRecord,
  bindingRecords: readonly CapabilityBindingAdminRecord[],
): CapabilityAdminSummary {
  return {
    ...summaryFrom(record),
    ...(record.agentAvailability
      ? { agentAvailability: record.agentAvailability }
      : {}),
    bindings: bindingRecords.map((binding) => bindingFrom(binding)),
  };
}

function mutationFrom(
  mutation: Readonly<{
    readonly value: CapabilityDefinitionRecord;
    readonly replayed: boolean;
  }>,
): CapabilityDefinitionMutationResult {
  return {
    definition: summaryFrom(mutation.value),
    replayed: mutation.replayed,
  };
}

@Controller()
export class WorkspaceCapabilityDefinitionsController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly implementations: CapabilityImplementationService,
    private readonly installations: CapabilityInstallationService,
  ) {}

  @ContractRoute(listWorkspaceCapabilityDefinitionsRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceCapabilityDefinitions> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const [
      records,
      bindingRecords,
      providerRoutes,
      runtimeAdapters,
      recommendations,
    ] = await Promise.all([
      this.database.capabilityDefinitions.list(scope, now),
      this.database.capabilityBindingAdmin.list(scope, now),
      this.database.capabilityBindingAdmin.listProviderRoutes(scope, now),
      this.database.modelResourceImports.listPublishedRuntimeAdapters(
        scope.workspaceId,
      ),
      this.database.capabilityInstallations.listCatalogEntries(scope, now),
    ]);
    const bindingsByContractRevision = new Map<
      string,
      CapabilityBindingAdminRecord[]
    >();
    for (const binding of bindingRecords) {
      if (binding.bindingStatus === "revoked") continue;
      const current =
        bindingsByContractRevision.get(binding.contractRevisionId) ?? [];
      current.push(binding);
      bindingsByContractRevision.set(binding.contractRevisionId, current);
    }
    return {
      generatedAt: now.toISOString(),
      definitions: records.map((record) =>
        adminSummaryFrom(
          record,
          bindingsByContractRevision.get(record.contractRevisionId) ?? [],
        ),
      ),
      providerRoutes: providerRoutes.map(providerRouteFrom),
      runtimeAdapters: runtimeAdapters
        .filter(
          (adapter) =>
            adapter.document.selectionPolicy?.scope !== "capability_private",
        )
        .map(runtimeAdapterFrom),
      recommendations: recommendations.map((recommendation) => {
        const selector = recommendation.modelServiceSelector;
        return {
          id: recommendation.id,
          recommendationKey: recommendation.recommendationKey,
          capabilityKey: recommendation.capabilityKey,
          packageVersion: recommendation.packageVersion,
          canonicalDigest: recommendation.canonicalDigest,
          title: recommendation.title,
          ...(recommendation.description
            ? { description: recommendation.description }
            : {}),
          category: recommendation.category,
          sourceKind: recommendation.sourceKind,
          compatibleModelRoutePolicyRevisionIds: selector
            ? providerRoutes
                .filter(
                  (route) =>
                    route.availabilityReason === "ready" &&
                    route.modelOperation === selector.operation &&
                    (selector.apiSurface === undefined ||
                      selector.apiSurface === route.apiSurface) &&
                    (selector.providerPreset === undefined ||
                      selector.providerPreset === route.providerPreset),
                )
                .map((route) => route.routePolicyRevisionId)
            : [],
          ...(recommendation.installedDefinitionId
            ? { installedDefinitionId: recommendation.installedDefinitionId }
            : {}),
          ...(recommendation.installationStatus
            ? { installationStatus: recommendation.installationStatus }
            : {}),
          updateAvailable: recommendation.updateAvailable,
        };
      }),
    };
  }

  @ContractRoute(createWorkspaceCapabilityDefinitionRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body(new ContractBodyPipe(CreateCapabilityDefinitionBodySchema))
    body: CreateCapabilityDefinitionBody,
  ): Promise<CapabilityDefinitionMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      const publication = validateCapabilityDefinitionPublication(body);
      const requestKeyValue = idempotencyKey(requestKey);
      const created = await this.implementations.create(
        scope,
        {
          scope,
          definitionId: ulid(),
          contractRevisionId: ulid(),
          declarationRevisionId: ulid(),
          idempotencyKey: requestKeyValue,
          now: new Date(),
          audit: auditFor(scope, request),
          ...publication,
          requestHash: publication.publicationDigest,
        },
        requestKeyValue,
        {
          ...body.runMethod,
          expectedDefinitionVersion: 1,
        },
        request.id,
      );
      return mutationFrom(created.definition);
    } catch (error) {
      return mapError(error);
    }
  }

  @ContractRoute(installCapabilityRecommendationRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async installRecommendation(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Param(new ContractBodyPipe(CapabilityCatalogEntryPathSchema))
    params: { readonly catalogEntryId: string },
    @Body(new ContractBodyPipe(InstallCapabilityRecommendationBodySchema))
    body: InstallCapabilityRecommendationBody,
  ): Promise<CapabilityInstallationSummary> {
    const { scope } = this.contexts.require(request);
    return this.installations.install(
      scope,
      params.catalogEntryId,
      requestKey ?? "",
      body,
      request.id,
    );
  }

  @ContractRoute(publishCapabilityDefinitionImplementationRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async publishImplementation(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Param(new ContractBodyPipe(CapabilityDefinitionPathSchema))
    params: { readonly capabilityDefinitionId: string },
    @Body(
      new ContractBodyPipe(PublishCapabilityImplementationRevisionBodySchema),
    )
    body: PublishCapabilityImplementationRevisionBody,
  ): Promise<CapabilityBindingMutationResult> {
    const { scope } = this.contexts.require(request);
    return this.implementations.publish(
      scope,
      params.capabilityDefinitionId,
      requestKey ?? "",
      body,
      request.id,
    );
  }

  @ContractRoute(updateWorkspaceCapabilityDefinitionRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async update(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Param(new ContractBodyPipe(CapabilityDefinitionPathSchema))
    params: { readonly capabilityDefinitionId: string },
    @Body(new ContractBodyPipe(UpdateCapabilityDefinitionBodySchema))
    body: UpdateCapabilityDefinitionBody,
  ): Promise<CapabilityDefinitionMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return mutationFrom(
        await this.database.capabilityDefinitions.update({
          scope,
          definitionId: params.capabilityDefinitionId,
          declarationRevisionId: ulid(),
          expectedVersion: body.expectedVersion,
          idempotencyKey: idempotencyKey(requestKey),
          now: new Date(),
          audit: auditFor(scope, request),
          title: body.title,
          ...(body.description ? { description: body.description } : {}),
          category: body.category,
          tags: body.tags,
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @ContractRoute(setWorkspaceCapabilityDefinitionStatusRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async setStatus(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CapabilityDefinitionPathSchema))
    params: { readonly capabilityDefinitionId: string },
    @Body(new ContractBodyPipe(SetCapabilityDefinitionStatusBodySchema))
    body: SetCapabilityDefinitionStatusBody,
  ): Promise<CapabilityDefinitionMutationResult> {
    const { scope } = this.contexts.require(request);
    try {
      return mutationFrom(
        await this.database.capabilityDefinitions.setStatus({
          scope,
          definitionId: params.capabilityDefinitionId,
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
