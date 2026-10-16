import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  CapabilityInstallationSummary,
  InstallCapabilityRecommendationBody,
} from "@kanvas/contracts/api";
import {
  CapabilityInstallationStoreError,
  type CapabilityInstallationRecord,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ModelResourceImportService } from "../model-resources/model-resource-import.service.js";

const nextUlid = monotonicFactory();

function auditFor(
  scope: TrustedWorkspaceScope,
  requestId: string | undefined,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: nextUlid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: `sha256:${createHash("sha256")
      .update("kanvas:capability-installation-auth-ref:v1\0")
      .update(scope.authenticationRefId)
      .digest("hex")}`,
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    ...(requestId ? { requestId } : {}),
  });
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException("A valid Idempotency-Key is required.");
  }
  return normalized;
}

function dependencyRequestKey(value: string): string {
  return `capability-dependency:${createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function mapError(error: unknown): never {
  if (error instanceof CapabilityInstallationStoreError) {
    if (error.code === "capability_installation.catalog_entry_not_found") {
      throw new NotFoundException(error.message);
    }
    if (error.code === "capability_installation.invalid_argument") {
      throw new BadRequestException(error.message);
    }
    throw new ConflictException(error.message);
  }
  throw error;
}

function summaryFrom(
  record: CapabilityInstallationRecord,
  sourceKind: "model_resource" | "model_service" | "plugin",
): CapabilityInstallationSummary {
  let requiredAction: CapabilityInstallationSummary["requiredAction"] = "none";
  if (record.status === "failed") {
    requiredAction = "retry";
  } else if (record.status === "waiting_dependency") {
    requiredAction =
      sourceKind === "model_resource"
        ? "importing_model_resource"
        : "configure_model_service";
  }
  return Object.freeze({
    id: record.id,
    catalogEntryId: record.catalogEntryId,
    status: record.status,
    requiredAction,
    ...(record.modelResourceImportId
      ? { modelResourceImportId: record.modelResourceImportId }
      : {}),
    ...(record.installedDefinitionId
      ? { installedDefinitionId: record.installedDefinitionId }
      : {}),
    version: record.version,
    replayed: record.replayed,
  });
}

@Injectable()
export class CapabilityInstallationService {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly modelImports: ModelResourceImportService,
  ) {}

  public async install(
    scope: TrustedWorkspaceScope,
    catalogEntryId: string,
    idempotencyKeyValue: string,
    body: InstallCapabilityRecommendationBody,
    requestId?: string,
  ): Promise<CapabilityInstallationSummary> {
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyValue);
    const now = new Date();
    const recommendation = (
      await this.database.capabilityInstallations.listCatalogEntries(scope, now)
    ).find((entry) => entry.id === catalogEntryId);
    if (!recommendation) {
      throw new NotFoundException("Capability recommendation was not found.");
    }
    if (recommendation.canonicalDigest !== body.expectedCatalogDigest) {
      throw new ConflictException(
        "Capability recommendation changed before installation.",
      );
    }
    try {
      let operation = await this.database.capabilityInstallations.install({
        scope,
        operationId: nextUlid(),
        catalogEntryId,
        idempotencyKey,
        ...(body.selectedRoutePolicyRevisionId
          ? {
              selectedRoutePolicyRevisionId: body.selectedRoutePolicyRevisionId,
            }
          : {}),
        now,
        nextId: nextUlid,
        requestedAudit: auditFor(scope, requestId),
        completedAudit: auditFor(scope, requestId),
      });
      if (
        operation.status === "waiting_dependency" &&
        recommendation.sourceKind === "model_resource" &&
        operation.requiredModelResourceAssetKey &&
        !operation.modelResourceImportId
      ) {
        const modelCatalogEntry = (
          await this.database.modelResources.listCatalogEntries(scope, now)
        ).find(
          (entry) => entry.assetKey === operation.requiredModelResourceAssetKey,
        );
        if (!modelCatalogEntry) {
          throw new ConflictException(
            "Recommended model resource is not available in the Catalog.",
          );
        }
        const imported = await this.modelImports.start(
          scope,
          dependencyRequestKey(idempotencyKey),
          {
            source: {
              kind: "catalog",
              catalogEntryId: modelCatalogEntry.id,
            },
          },
          requestId,
        );
        operation =
          await this.database.capabilityInstallations.attachModelResourceImport(
            {
              scope,
              operationId: operation.id,
              expectedVersion: operation.version,
              modelResourceImportId: imported.id,
              now: new Date(),
            },
          );
      }
      return summaryFrom(operation, recommendation.sourceKind);
    } catch (error) {
      return mapError(error);
    }
  }
}
