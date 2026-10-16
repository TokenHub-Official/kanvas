import {
  parseModelProfileDocumentV1,
  parseProviderPricingDocumentV1,
  type ModelProfileDocumentV1,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  parseProviderModelCatalogDocument,
  type ProviderModelCapabilityKey,
  type ProviderModelCatalogEntry,
} from "@kanvas/contracts/provider-model";
import type { ModelParameterInput } from "@kanvas/contracts/api";
import type { ProviderPricingDocumentV1 } from "@kanvas/contracts/provider-billing";
import {
  getProviderDefinition,
  type ProviderAgentTextTransport,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { normalizeUnsignedDecimal } from "./fixed-decimal.js";
import { digestProviderValue } from "./provider-value-digest.js";
import {
  buildProviderSettingControlPlaneDefinition,
  loadProviderRuntimeAdapterProfilesInTransaction,
  parseProviderSettingModelPricingConfigurations,
  type ProviderRuntimeAdapterProfile,
  type ProviderSettingModelPricingConfiguration,
  type ProviderSettingRouteDefinition,
} from "./provider-setting-control-plane.js";
import { reconcilePublishedProviderImageCapabilityBindingsInTransaction } from "./provider-setting-capability-reconciler.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u;

export type CanonicalModelSourceKind = "models_dev" | "provider" | "manual";
export type ProviderModelMappingConfidence = "exact" | "suggested" | "manual";

export interface CanonicalModelRecord {
  readonly id: string;
  readonly slug: string;
  readonly lifecycle: "draft" | "active" | "disabled" | "revoked";
  readonly sourceKind: CanonicalModelSourceKind;
  readonly sourceReference?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProviderModelRecord {
  readonly id: string;
  readonly providerSettingId: string;
  readonly upstreamModelId: string;
  readonly canonicalModelId?: string;
  readonly catalogSnapshotId: string;
  readonly mappingSource?: CanonicalModelSourceKind;
  readonly mappingConfidence?: ProviderModelMappingConfidence;
  readonly maximumCharge?: {
    readonly currencyCode: string;
    readonly amount: string;
  };
  readonly lifecycle:
    "discovered" | "mapped" | "active" | "disabled" | "removed";
  readonly lastSeenAt: Date;
  readonly version: number;
}

export interface ProviderCatalogModelRecord {
  readonly upstreamModelId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly completeness: "identity_only" | "partial" | "complete";
  readonly imported?: ProviderModelRecord;
}

export interface CreateCanonicalModelOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly id: string;
  readonly slug: string;
  readonly sourceKind: CanonicalModelSourceKind;
  readonly sourceReference?: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ImportProviderModelsOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly providerSettingId: string;
  readonly catalogSnapshotId?: string;
  readonly models: readonly {
    readonly id: string;
    readonly upstreamModelId: string;
  }[];
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface MapProviderModelOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly providerSettingId: string;
  readonly providerModelId: string;
  readonly expectedVersion: number;
  readonly canonicalModelId: string;
  readonly mappingSource: CanonicalModelSourceKind;
  readonly mappingConfidence: ProviderModelMappingConfidence;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishCanonicalModelOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly canonicalModelId: string;
  readonly expectedVersion: number;
  readonly profileRevisionId: string;
  readonly profileDocument: ModelProfileDocumentV1;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishProviderModelOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly providerSettingId: string;
  readonly providerModelId: string;
  readonly expectedVersion: number;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly routePolicyRevisionIds: readonly string[];
  readonly agentModelBindingId: string;
  readonly agentTextTransport?: ProviderAgentTextTransport;
  readonly pricing: ProviderSettingModelPricingConfiguration;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishConfiguredModelOptions {
  readonly canonical: PublishCanonicalModelOptions;
  readonly provider: PublishProviderModelOptions;
}

export interface ModelControlPlaneStore {
  listModels(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly WorkspaceModelRecord[]>;
  listProviderCatalogModels(
    scope: TrustedWorkspaceScope,
    providerSettingId: string,
    now: Date,
  ): Promise<readonly ProviderCatalogModelRecord[]>;
  createCanonicalModel(options: CreateCanonicalModelOptions): Promise<{
    readonly model: CanonicalModelRecord;
    readonly replayed: boolean;
  }>;
  importProviderModels(options: ImportProviderModelsOptions): Promise<{
    readonly models: readonly ProviderModelRecord[];
    readonly created: number;
    readonly refreshed: number;
  }>;
  mapProviderModel(options: MapProviderModelOptions): Promise<{
    readonly model: ProviderModelRecord;
    readonly replayed: boolean;
  }>;
  publishCanonicalModel(options: PublishCanonicalModelOptions): Promise<{
    readonly model: CanonicalModelRecord;
    readonly profileRevisionId: string;
    readonly replayed: boolean;
  }>;
  publishProviderModel(options: PublishProviderModelOptions): Promise<{
    readonly model: ProviderModelRecord;
    readonly modelDeploymentId: string;
    readonly pricingRevisionId: string;
    readonly replayed: boolean;
  }>;
  publishConfiguredModel(options: PublishConfiguredModelOptions): Promise<{
    readonly model: ProviderModelRecord;
    readonly modelDeploymentId: string;
    readonly pricingRevisionId: string;
    readonly replayed: boolean;
  }>;
}

interface CanonicalModelRow extends RowDataPacket {
  readonly id: string;
  readonly slug: string;
  readonly lifecycle: CanonicalModelRecord["lifecycle"];
  readonly sourceKind: CanonicalModelSourceKind;
  readonly sourceReference: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ProviderModelRow extends RowDataPacket {
  readonly id: string;
  readonly providerSettingId: string;
  readonly upstreamModelId: string;
  readonly canonicalModelId: string | null;
  readonly catalogSnapshotId: string;
  readonly mappingSource: CanonicalModelSourceKind | null;
  readonly mappingConfidence: ProviderModelMappingConfidence | null;
  readonly maximumChargeCurrencyCode: string | null;
  readonly maximumChargeAmount: string | null;
  readonly lifecycle: ProviderModelRecord["lifecycle"];
  readonly lastSeenAt: Date;
  readonly version: number;
}

interface CatalogRow extends RowDataPacket {
  readonly id: string;
  readonly catalogDocument: unknown;
}

export interface WorkspaceModelRecord extends CanonicalModelRecord {
  readonly profile?: ModelProfileDocumentV1;
  readonly providers: readonly {
    readonly id: string;
    readonly providerSettingId: string;
    readonly providerName: string;
    readonly providerPreset: string;
    readonly upstreamModelId: string;
    readonly lifecycle: ProviderModelRecord["lifecycle"];
    readonly version: number;
    readonly agentTextTransport?: ProviderAgentTextTransport;
    readonly supportedAgentTextTransports: readonly ProviderAgentTextTransport[];
    readonly supportedOperations: readonly (
      "text.generate" | "image.generate" | "image.edit"
    )[];
    readonly operations: Readonly<
      Partial<
        Record<
          ProviderModelCapabilityKey,
          Readonly<{ readonly parameters: readonly ModelParameterInput[] }>
        >
      >
    >;
    readonly providerReportedPricingAvailable: boolean;
    readonly modelDeploymentId?: string;
    readonly pricingRevisionId?: string;
    readonly maximumCharge?: {
      readonly currencyCode: string;
      readonly amount: string;
    };
  }[];
}

interface WorkspaceModelRow extends CanonicalModelRow {
  readonly profileDocument: unknown;
  readonly providerModelRecordId: string | null;
  readonly providerSettingId: string | null;
  readonly providerDisplayName: string | null;
  readonly providerPreset: string | null;
  readonly upstreamModelId: string | null;
  readonly providerModelLifecycle: ProviderModelRecord["lifecycle"] | null;
  readonly providerModelVersion: number | null;
  readonly modelDeploymentId: string | null;
  readonly pricingRevisionId: string | null;
  readonly maximumChargeCurrencyCode: string | null;
  readonly maximumChargeAmount: string | null;
  readonly agentApiSurface: ProviderAgentTextTransport["apiSurface"] | null;
  readonly agentProtocolKind: ProviderAgentTextTransport["protocolKind"] | null;
  readonly catalogDocument: unknown;
}

interface ProfileRow extends RowDataPacket {
  readonly id: string;
  readonly revision: number;
  readonly canonicalDigest: string;
}

interface ProviderModelPublicationRow extends ProviderModelRow {
  readonly canonicalModelLifecycle: CanonicalModelRecord["lifecycle"];
  readonly providerEndpointId: string;
  readonly endpointLifecycle: string;
  readonly validationStatus: string;
  readonly providerAdapterKind: string;
  readonly providerPreset: string;
  readonly credentialId: string;
  readonly credentialLifecycle: string;
  readonly budgetAccountId: string | null;
  readonly budgetLifecycle: string | null;
  readonly profileRevisionId: string;
  readonly profileDocument: unknown;
  readonly catalogDocument: unknown;
}

interface CurrentModelDeploymentRow extends RowDataPacket {
  readonly currentDeploymentId: string | null;
  readonly currentGeneration: number | null;
  readonly currentDeploymentDigest: string | null;
  readonly currentDeploymentLifecycle: string | null;
  readonly currentPricingRevisionId: string | null;
  readonly currentPricingDigest: string | null;
}

const textUsageMetrics = new Set([
  "input_tokens:token",
  "input_tokens_no_cache:token",
  "output_tokens:token",
  "total_tokens:token",
  "input_text_tokens:token",
  "input_image_tokens:token",
  "output_text_tokens:token",
  "cache_read_tokens:token",
  "cache_write_tokens:token",
  "reasoning_tokens:token",
]);

function publicationPricing(options: {
  readonly row: ProviderModelPublicationRow;
  readonly catalogEntry: ProviderModelCatalogEntry;
  readonly pricing: ProviderSettingModelPricingConfiguration;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly routePolicyRevisionIds: readonly string[];
  readonly runtimeAdapters: readonly ProviderRuntimeAdapterProfile[];
}): {
  readonly document: ProviderPricingDocumentV1;
  readonly digest: string;
  readonly maximumChargeAmount: string;
  readonly routes: readonly ProviderSettingRouteDefinition[];
} {
  const configuration = parseProviderSettingModelPricingConfigurations(
    [options.pricing],
    [options.row.upstreamModelId],
  )[0]!;
  const imageReady = Boolean(
    options.catalogEntry.operations["image.generate"] ||
    options.catalogEntry.operations["image.edit"],
  );
  if (imageReady) {
    const control = buildProviderSettingControlPlaneDefinition({
      ids: {
        endpointId: options.row.providerEndpointId,
        credentialId: options.row.credentialId,
        budgetAccountId: options.row.budgetAccountId!,
        modelProfileRevisionId: options.row.profileRevisionId,
        modelDeploymentId: options.modelDeploymentId,
        pricingRevisionId: options.pricingRevisionId,
        routePolicyRevisionIds: options.routePolicyRevisionIds,
      },
      providerSettingId: options.row.providerSettingId,
      preset: options.row.providerPreset as Parameters<
        typeof buildProviderSettingControlPlaneDefinition
      >[0]["preset"],
      providerModelId: options.row.upstreamModelId,
      catalogEntry: options.catalogEntry,
      pricingConfiguration: configuration,
      runtimeAdapters: options.runtimeAdapters,
      observedAt: options.row.lastSeenAt,
    });
    return Object.freeze({
      document: control.pricingDocument,
      digest: control.pricingDigest,
      maximumChargeAmount: control.maximumCharge.amount,
      routes: control.routes,
    });
  }
  if (
    configuration.billingMode === "metered" &&
    configuration.rates.some(
      (rate) => !textUsageMetrics.has(`${rate.metricKey}:${rate.unitCode}`),
    )
  ) {
    invalid("Provider Model pricing requires unsupported usage metrics.");
  }
  if (configuration.billingMode === "provider_reported") {
    invalid(
      "Provider-reported pricing is unavailable for synchronous text models.",
    );
  }
  const evidenceDigest = digestProviderValue({
    domain: "kanvas.provider-model-pricing-contract.v1",
    providerSettingId: options.row.providerSettingId,
    providerModelId: options.row.upstreamModelId,
    configuration,
  });
  const sourceReference = `kanvas:provider-model:${digestProviderValue({
    providerSettingId: options.row.providerSettingId,
    providerModelId: options.row.upstreamModelId,
  }).slice(7, 39)}`;
  const evidence = {
    priceVerified: true as const,
    sourceKind: "contract" as const,
    sourceReference,
    observedAt: options.row.lastSeenAt.toISOString(),
    sourceDigest: evidenceDigest,
  };
  let rawDocument: unknown;
  if (configuration.billingMode === "fixed") {
    rawDocument = {
      schemaVersion: 1,
      billingMode: "fixed",
      fixedChargeAmount: configuration.fixedChargeAmount,
      evidence,
    };
  } else {
    rawDocument = {
      schemaVersion: 1,
      billingMode: "metered",
      rates: configuration.rates,
      ...(configuration.minimumChargeAmount
        ? { minimumChargeAmount: configuration.minimumChargeAmount }
        : {}),
      evidence,
    };
  }
  const document = parseProviderPricingDocumentV1(rawDocument);
  const maximumChargeAmount =
    configuration.billingMode === "fixed"
      ? configuration.fixedChargeAmount
      : configuration.maximumChargeAmount;
  return Object.freeze({
    document,
    digest: digestProviderValue(document),
    maximumChargeAmount: normalizeUnsignedDecimal(
      maximumChargeAmount,
      "Provider Model maximum charge",
    ),
    routes: Object.freeze([]),
  });
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function agentTextTransports(
  preset: string,
  adapterKind: string,
): readonly ProviderAgentTextTransport[] {
  let definition;
  try {
    definition = getProviderDefinition(preset as ProviderDefinitionSlug);
  } catch {
    return invalid("Provider has no supported Agent text protocol.");
  }
  if (definition.adapterKind !== adapterKind) {
    return invalid("Provider Agent text protocol does not match its endpoint.");
  }
  return definition.agentTextTransports;
}

function agentTextTransport(
  preset: string,
  adapterKind: string,
  selected: ProviderAgentTextTransport | undefined,
  providerApiSurfaces: readonly string[] | undefined,
): ProviderAgentTextTransport {
  const supported = agentTextTransports(preset, adapterKind).filter(
    (candidate) =>
      providerApiSurfaces === undefined ||
      providerApiSurfaces.includes(candidate.apiSurface),
  );
  const transport = selected ?? supported[0];
  if (
    !transport ||
    !supported.some(
      (candidate) =>
        candidate.apiSurface === transport.apiSurface &&
        candidate.protocolKind === transport.protocolKind,
    )
  ) {
    return invalid(
      "Provider does not support the selected Agent text protocol.",
    );
  }
  return transport;
}

function authorizationDecision(scope: TrustedWorkspaceScope) {
  return {
    permission: "credential.manage",
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    authorizationModelVersion: scope.authorizationModelVersion,
  } as const;
}

function assertId(value: string, label: string): void {
  if (!idPattern.test(value)) invalid(`${label} must be a canonical ULID.`);
}

function assertUpstreamModelId(value: string): void {
  if (
    value.length < 1 ||
    value.length > 512 ||
    value !== value.trim() ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    invalid("Provider upstream Model ID is invalid.");
  }
}

function canonicalFrom(row: CanonicalModelRow): CanonicalModelRecord {
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    lifecycle: row.lifecycle,
    sourceKind: row.sourceKind,
    ...(row.sourceReference ? { sourceReference: row.sourceReference } : {}),
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });
}

function providerFrom(row: ProviderModelRow): ProviderModelRecord {
  return Object.freeze({
    id: row.id,
    providerSettingId: row.providerSettingId,
    upstreamModelId: row.upstreamModelId,
    ...(row.canonicalModelId ? { canonicalModelId: row.canonicalModelId } : {}),
    catalogSnapshotId: row.catalogSnapshotId,
    ...(row.mappingSource ? { mappingSource: row.mappingSource } : {}),
    ...(row.mappingConfidence
      ? { mappingConfidence: row.mappingConfidence }
      : {}),
    ...(row.maximumChargeCurrencyCode && row.maximumChargeAmount
      ? {
          maximumCharge: Object.freeze({
            currencyCode: row.maximumChargeCurrencyCode,
            amount: row.maximumChargeAmount,
          }),
        }
      : {}),
    lifecycle: row.lifecycle,
    lastSeenAt: new Date(row.lastSeenAt),
    version: row.version,
  });
}

async function readCanonicalModel(
  connection: PoolConnection,
  workspaceId: string,
  id: string,
): Promise<CanonicalModelRecord> {
  const [rows] = await connection.execute<CanonicalModelRow[]>(
    `SELECT
       id, slug, lifecycle_status AS lifecycle,
       source_kind AS sourceKind, source_reference AS sourceReference,
       version, created_at AS createdAt, updated_at AS updatedAt
     FROM canonical_model
     WHERE workspace_id = ? AND id = ?
     LIMIT 1`,
    [workspaceId, id],
  );
  if (!rows[0]) invalid("Canonical Model was not found after mutation.");
  return canonicalFrom(rows[0]);
}

async function readProviderModels(
  connection: PoolConnection,
  workspaceId: string,
  providerSettingId: string,
  upstreamModelIds: readonly string[],
): Promise<readonly ProviderModelRecord[]> {
  if (upstreamModelIds.length === 0) return Object.freeze([]);
  const placeholders = upstreamModelIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<ProviderModelRow[]>(
    `SELECT
       id, provider_setting_id AS providerSettingId,
       upstream_model_id AS upstreamModelId,
       canonical_model_id AS canonicalModelId,
       catalog_snapshot_id AS catalogSnapshotId,
       mapping_source AS mappingSource,
       mapping_confidence AS mappingConfidence,
       maximum_charge_currency_code AS maximumChargeCurrencyCode,
       maximum_charge_amount AS maximumChargeAmount,
       lifecycle_status AS lifecycle,
       last_seen_at AS lastSeenAt, version
     FROM provider_model
     WHERE workspace_id = ? AND provider_setting_id = ?
       AND upstream_model_id IN (${placeholders})
     ORDER BY upstream_model_id`,
    [workspaceId, providerSettingId, ...upstreamModelIds],
  );
  return Object.freeze(rows.map(providerFrom));
}

async function inTransaction<TResult>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createModelControlPlaneStore(
  pool: Pool,
  transactionConnection?: PoolConnection,
): ModelControlPlaneStore {
  const transact = <TResult>(
    work: (connection: PoolConnection) => Promise<TResult>,
  ) =>
    transactionConnection
      ? work(transactionConnection)
      : inTransaction(pool, work);
  return Object.freeze({
    async listProviderCatalogModels(
      scope: TrustedWorkspaceScope,
      providerSettingId: string,
      now: Date,
    ) {
      assertId(providerSettingId, "Provider Setting ID");
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<CatalogRow[]>(
          `SELECT catalog.id, catalog.catalog_document AS catalogDocument
           FROM provider_setting AS setting
           INNER JOIN provider_model_catalog_snapshot AS catalog
             ON catalog.workspace_id = setting.workspace_id
            AND catalog.id = setting.model_catalog_snapshot_id
           WHERE setting.workspace_id = ? AND setting.id = ?
           LIMIT 1`,
          [scope.workspaceId, providerSettingId],
        );
        const row = rows[0];
        if (!row) invalid("Provider Model catalog snapshot was not found.");
        const catalog = parseProviderModelCatalogDocument(
          typeof row.catalogDocument === "string"
            ? (JSON.parse(row.catalogDocument) as unknown)
            : row.catalogDocument,
        );
        const imported = new Map(
          catalog.models.length > 0
            ? (
                await readProviderModels(
                  connection,
                  scope.workspaceId,
                  providerSettingId,
                  catalog.models.map((model) => model.providerModelId),
                )
              ).map((model) => [model.upstreamModelId, model])
            : [],
        );
        return Object.freeze(
          catalog.models.map((model) =>
            Object.freeze({
              upstreamModelId: model.providerModelId,
              displayName: model.displayName,
              ...(model.description ? { description: model.description } : {}),
              inputModalities: Object.freeze([...model.inputModalities]),
              outputModalities: Object.freeze([...model.outputModalities]),
              completeness: model.completeness,
              ...(imported.has(model.providerModelId)
                ? { imported: imported.get(model.providerModelId)! }
                : {}),
            }),
          ),
        );
      });
    },

    async listModels(scope: TrustedWorkspaceScope, now: Date) {
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<WorkspaceModelRow[]>(
          `SELECT
             model.id, model.slug,
             model.lifecycle_status AS lifecycle,
             model.source_kind AS sourceKind,
             model.source_reference AS sourceReference,
             model.version, model.created_at AS createdAt,
             model.updated_at AS updatedAt,
             profile.profile_document AS profileDocument,
             provider_model.id AS providerModelRecordId,
             provider_model.provider_setting_id AS providerSettingId,
             setting.display_name AS providerDisplayName,
             endpoint.preset_kind AS providerPreset,
             provider_model.upstream_model_id AS upstreamModelId,
             provider_model.lifecycle_status AS providerModelLifecycle,
             provider_model.version AS providerModelVersion,
             deployment.id AS modelDeploymentId,
             pricing.id AS pricingRevisionId,
             agent_binding.api_surface AS agentApiSurface,
             agent_binding.protocol_kind AS agentProtocolKind,
             provider_model.maximum_charge_currency_code
               AS maximumChargeCurrencyCode,
             provider_model.maximum_charge_amount AS maximumChargeAmount,
             catalog.catalog_document AS catalogDocument
           FROM canonical_model AS model
           LEFT JOIN model_profile_revision AS profile
             ON profile.workspace_id = model.workspace_id
            AND profile.canonical_model_id = model.id
            AND profile.revision = (
              SELECT MAX(latest.revision)
              FROM model_profile_revision AS latest
              WHERE latest.workspace_id = model.workspace_id
                AND latest.canonical_model_id = model.id
            )
           LEFT JOIN provider_model
             ON provider_model.workspace_id = model.workspace_id
            AND provider_model.canonical_model_id = model.id
            AND provider_model.lifecycle_status <> 'removed'
           LEFT JOIN provider_setting AS setting
             ON setting.workspace_id = provider_model.workspace_id
            AND setting.id = provider_model.provider_setting_id
           LEFT JOIN provider_model_catalog_snapshot AS catalog
             ON catalog.workspace_id = provider_model.workspace_id
            AND catalog.id = provider_model.catalog_snapshot_id
           LEFT JOIN provider_endpoint AS endpoint
             ON endpoint.workspace_id = setting.workspace_id
            AND endpoint.id = setting.provider_endpoint_id
           LEFT JOIN model_deployment AS deployment
             ON deployment.workspace_id = provider_model.workspace_id
            AND deployment.provider_model_record_id = provider_model.id
            AND deployment.lifecycle_status = 'active'
           LEFT JOIN pricing_revision AS pricing
             ON pricing.workspace_id = deployment.workspace_id
            AND pricing.model_deployment_id = deployment.id
            AND pricing.lifecycle_status = 'published'
           LEFT JOIN agent_model_binding AS agent_binding
             ON agent_binding.workspace_id = deployment.workspace_id
            AND agent_binding.model_deployment_id = deployment.id
            AND agent_binding.lifecycle_status = 'enabled'
           WHERE model.workspace_id = ?
             AND model.lifecycle_status <> 'revoked'
             AND EXISTS (
               SELECT 1
               FROM provider_model AS visible_provider_model
               INNER JOIN provider_setting AS visible_setting
                 ON visible_setting.workspace_id = visible_provider_model.workspace_id
                AND visible_setting.id = visible_provider_model.provider_setting_id
                AND visible_setting.deleted_at IS NULL
               WHERE visible_provider_model.workspace_id = model.workspace_id
                 AND visible_provider_model.canonical_model_id = model.id
                 AND visible_provider_model.lifecycle_status <> 'removed'
             )
           ORDER BY model.updated_at DESC, model.id, provider_model.id`,
          [scope.workspaceId],
        );
        type ProviderLink = WorkspaceModelRecord["providers"][number];
        const models = new Map<
          string,
          {
            readonly model: CanonicalModelRecord;
            readonly profile?: ModelProfileDocumentV1;
            readonly providers: ProviderLink[];
          }
        >();
        for (const row of rows) {
          let entry = models.get(row.id);
          if (!entry) {
            entry = {
              model: canonicalFrom(row),
              ...(row.profileDocument
                ? {
                    profile: parseModelProfileDocumentV1(
                      typeof row.profileDocument === "string"
                        ? (JSON.parse(row.profileDocument) as unknown)
                        : row.profileDocument,
                    ),
                  }
                : {}),
              providers: [],
            };
            models.set(row.id, entry);
          }
          if (
            row.providerModelRecordId &&
            row.providerSettingId &&
            row.providerDisplayName &&
            row.providerPreset &&
            row.upstreamModelId &&
            row.providerModelLifecycle &&
            row.providerModelVersion
          ) {
            const supportedAgentTextTransports = agentTextTransports(
              row.providerPreset,
              getProviderDefinition(
                row.providerPreset as ProviderDefinitionSlug,
              ).adapterKind,
            );
            const selectedAgentTextTransport =
              row.agentApiSurface && row.agentProtocolKind
                ? (supportedAgentTextTransports.find(
                    (transport) =>
                      transport.apiSurface === row.agentApiSurface &&
                      transport.protocolKind === row.agentProtocolKind,
                  ) ??
                  invalid(
                    "Stored Provider Agent text protocol is not supported.",
                  ))
                : undefined;
            const catalog = row.catalogDocument
              ? parseProviderModelCatalogDocument(
                  typeof row.catalogDocument === "string"
                    ? (JSON.parse(row.catalogDocument) as unknown)
                    : row.catalogDocument,
                )
              : undefined;
            const catalogModel = catalog?.models.find(
              (model) => model.providerModelId === row.upstreamModelId,
            );
            const operations = Object.fromEntries(
              (
                ["text.generate", "image.generate", "image.edit"] as const
              ).flatMap((operation) => {
                const definition = catalogModel?.operations[operation];
                return definition
                  ? [
                      [
                        operation,
                        {
                          parameters: definition.parameters.map(
                            ({ evidence, ...parameter }) => {
                              void evidence;
                              return Object.freeze(parameter);
                            },
                          ),
                        },
                      ],
                    ]
                  : [];
              }),
            ) as WorkspaceModelRecord["providers"][number]["operations"];
            entry.providers.push(
              Object.freeze({
                id: row.providerModelRecordId,
                providerSettingId: row.providerSettingId,
                providerName: row.providerDisplayName,
                providerPreset: row.providerPreset,
                upstreamModelId: row.upstreamModelId,
                lifecycle: row.providerModelLifecycle,
                version: row.providerModelVersion,
                ...(selectedAgentTextTransport
                  ? {
                      agentTextTransport: Object.freeze({
                        ...selectedAgentTextTransport,
                      }),
                    }
                  : {}),
                supportedAgentTextTransports: Object.freeze(
                  supportedAgentTextTransports.map((transport) =>
                    Object.freeze({ ...transport }),
                  ),
                ),
                supportedOperations: Object.freeze(
                  (
                    ["text.generate", "image.generate", "image.edit"] as const
                  ).filter(
                    (operation) =>
                      catalogModel?.operations[operation] !== undefined,
                  ),
                ),
                operations: Object.freeze(operations),
                providerReportedPricingAvailable: Boolean(
                  catalogModel?.operations["image.generate"] ||
                  catalogModel?.operations["image.edit"],
                ),
                ...(row.modelDeploymentId
                  ? { modelDeploymentId: row.modelDeploymentId }
                  : {}),
                ...(row.pricingRevisionId
                  ? { pricingRevisionId: row.pricingRevisionId }
                  : {}),
                ...(row.maximumChargeCurrencyCode && row.maximumChargeAmount
                  ? {
                      maximumCharge: Object.freeze({
                        currencyCode: row.maximumChargeCurrencyCode,
                        amount: row.maximumChargeAmount,
                      }),
                    }
                  : {}),
              }),
            );
          }
        }
        return Object.freeze(
          [...models.values()].map((entry) =>
            Object.freeze({
              ...entry.model,
              ...(entry.profile ? { profile: entry.profile } : {}),
              providers: Object.freeze(entry.providers),
            }),
          ),
        );
      });
    },

    async createCanonicalModel(options: CreateCanonicalModelOptions) {
      assertId(options.id, "Canonical Model ID");
      if (!slugPattern.test(options.slug)) {
        invalid("Canonical Model slug is invalid.");
      }
      if (
        options.sourceReference !== undefined &&
        (options.sourceReference.length > 512 ||
          options.sourceReference !== options.sourceReference.trim())
      ) {
        invalid("Canonical Model source reference is invalid.");
      }
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [existingRows] = await connection.execute<CanonicalModelRow[]>(
          `SELECT
             id, slug, lifecycle_status AS lifecycle,
             source_kind AS sourceKind, source_reference AS sourceReference,
             version, created_at AS createdAt, updated_at AS updatedAt
           FROM canonical_model
           WHERE workspace_id = ? AND slug = ?
           LIMIT 1 FOR UPDATE`,
          [options.scope.workspaceId, options.slug],
        );
        const existing = existingRows[0];
        if (existing) {
          if (existing.lifecycle === "revoked") {
            invalid("Canonical Model slug is no longer available.");
          }
          return Object.freeze({
            model: canonicalFrom(existing),
            replayed: true,
          });
        }
        await connection.execute(
          `INSERT INTO canonical_model (
             id, workspace_id, slug, lifecycle_status,
             source_kind, source_reference, version,
             created_by_principal_id, updated_by_principal_id,
             created_at, updated_at, activated_at, disabled_at, revoked_at
           ) VALUES (?, ?, ?, 'draft', ?, ?, 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
          [
            options.id,
            options.scope.workspaceId,
            options.slug,
            options.sourceKind,
            options.sourceReference ?? null,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "model.created",
            action: "create_model",
            resourceType: "canonical_model",
            resourceId: options.id,
            outcome: "succeeded",
            decisionReasonCode: "model.created",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              slug: options.slug,
              sourceKind: options.sourceKind,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          model: await readCanonicalModel(
            connection,
            options.scope.workspaceId,
            options.id,
          ),
          replayed: false,
        });
      });
    },

    async importProviderModels(options: ImportProviderModelsOptions) {
      assertId(options.providerSettingId, "Provider Setting ID");
      if (options.catalogSnapshotId) {
        assertId(options.catalogSnapshotId, "Provider catalog snapshot ID");
      }
      if (options.models.length < 1 || options.models.length > 2_000) {
        invalid(
          "Provider Model import must contain between 1 and 2000 models.",
        );
      }
      const upstreamIds = new Set<string>();
      for (const model of options.models) {
        assertId(model.id, "Provider Model ID");
        assertUpstreamModelId(model.upstreamModelId);
        if (upstreamIds.has(model.upstreamModelId)) {
          invalid("Provider Model import contains duplicate upstream IDs.");
        }
        upstreamIds.add(model.upstreamModelId);
      }
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [catalogRows] = await connection.execute<CatalogRow[]>(
          `SELECT catalog.id, catalog.catalog_document AS catalogDocument
           FROM provider_model_catalog_snapshot AS catalog
           INNER JOIN provider_setting AS setting
             ON setting.workspace_id = catalog.workspace_id
            AND setting.id = catalog.provider_setting_id
           WHERE catalog.workspace_id = ?
             AND catalog.provider_setting_id = ?
             AND catalog.id = COALESCE(?, setting.model_catalog_snapshot_id)
           LIMIT 1 FOR SHARE`,
          [
            options.scope.workspaceId,
            options.providerSettingId,
            options.catalogSnapshotId ?? null,
          ],
        );
        const catalogRow = catalogRows[0];
        if (!catalogRow)
          invalid("Provider Model catalog snapshot was not found.");
        const catalogSnapshotId = catalogRow.id;
        const catalog = parseProviderModelCatalogDocument(
          typeof catalogRow.catalogDocument === "string"
            ? (JSON.parse(catalogRow.catalogDocument) as unknown)
            : catalogRow.catalogDocument,
        );
        const catalogIds = new Set(
          catalog.models.map(({ providerModelId }) => providerModelId),
        );
        if ([...upstreamIds].some((id) => !catalogIds.has(id))) {
          invalid(
            "Provider Model import contains an ID absent from the snapshot.",
          );
        }
        const current = await readProviderModels(
          connection,
          options.scope.workspaceId,
          options.providerSettingId,
          [...upstreamIds],
        );
        const currentIds = new Set(
          current.map(({ upstreamModelId }) => upstreamModelId),
        );
        for (const model of options.models) {
          await connection.execute(
            `INSERT INTO provider_model (
               id, workspace_id, provider_setting_id, upstream_model_id,
               canonical_model_id, catalog_snapshot_id,
               mapping_source, mapping_confidence, lifecycle_status,
               last_seen_at, version,
               created_by_principal_id, updated_by_principal_id,
               created_at, updated_at, mapped_at, activated_at,
               disabled_at, removed_at
             ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 'discovered',
                       ?, 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
             ON DUPLICATE KEY UPDATE
               version = IF(
                 NOT (catalog_snapshot_id <=> VALUES(catalog_snapshot_id)),
                 version + 1,
                 version
               ),
               last_seen_at = IF(
                 NOT (catalog_snapshot_id <=> VALUES(catalog_snapshot_id)),
                 VALUES(last_seen_at),
                 last_seen_at
               ),
               updated_by_principal_id = IF(
                 NOT (catalog_snapshot_id <=> VALUES(catalog_snapshot_id)),
                 VALUES(updated_by_principal_id),
                 updated_by_principal_id
               ),
               updated_at = IF(
                 NOT (catalog_snapshot_id <=> VALUES(catalog_snapshot_id)),
                 VALUES(updated_at),
                 updated_at
               ),
               catalog_snapshot_id = VALUES(catalog_snapshot_id)`,
            [
              model.id,
              options.scope.workspaceId,
              options.providerSettingId,
              model.upstreamModelId,
              catalogSnapshotId,
              options.now,
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "provider_models.imported",
            action: "import_provider_models",
            resourceType: "provider_setting",
            resourceId: options.providerSettingId,
            outcome: "succeeded",
            decisionReasonCode: "provider_models.imported",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              catalogSnapshotId,
              modelCount: options.models.length,
              modelSetDigest: digestProviderValue([...upstreamIds].sort()),
            },
            occurredAt: options.now,
          },
        );
        const models = await readProviderModels(
          connection,
          options.scope.workspaceId,
          options.providerSettingId,
          [...upstreamIds],
        );
        return Object.freeze({
          models,
          created: options.models.length - currentIds.size,
          refreshed: currentIds.size,
        });
      });
    },

    async mapProviderModel(options: MapProviderModelOptions) {
      assertId(options.providerSettingId, "Provider Setting ID");
      assertId(options.providerModelId, "Provider Model ID");
      assertId(options.canonicalModelId, "Canonical Model ID");
      if (
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1
      ) {
        invalid("Provider Model expected version is invalid.");
      }
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [canonicalRows] = await connection.execute<CanonicalModelRow[]>(
          `SELECT
             id, slug, lifecycle_status AS lifecycle,
             source_kind AS sourceKind, source_reference AS sourceReference,
             version, created_at AS createdAt, updated_at AS updatedAt
           FROM canonical_model
           WHERE workspace_id = ? AND id = ?
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, options.canonicalModelId],
        );
        if (!canonicalRows[0] || canonicalRows[0].lifecycle === "revoked") {
          invalid("Canonical Model is unavailable for mapping.");
        }
        const [rows] = await connection.execute<ProviderModelRow[]>(
          `SELECT
             id, provider_setting_id AS providerSettingId,
             upstream_model_id AS upstreamModelId,
             canonical_model_id AS canonicalModelId,
             catalog_snapshot_id AS catalogSnapshotId,
             mapping_source AS mappingSource,
             mapping_confidence AS mappingConfidence,
             maximum_charge_currency_code AS maximumChargeCurrencyCode,
             maximum_charge_amount AS maximumChargeAmount,
             lifecycle_status AS lifecycle,
             last_seen_at AS lastSeenAt, version
           FROM provider_model
           WHERE workspace_id = ? AND provider_setting_id = ? AND id = ?
           LIMIT 1 FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.providerSettingId,
            options.providerModelId,
          ],
        );
        const current = rows[0];
        if (!current) invalid("Provider Model was not found.");
        if (!["discovered", "mapped"].includes(current.lifecycle)) {
          invalid("Published Provider Model mapping cannot be changed.");
        }
        if (
          current.lifecycle === "mapped" &&
          current.canonicalModelId === options.canonicalModelId &&
          current.mappingSource === options.mappingSource &&
          current.mappingConfidence === options.mappingConfidence
        ) {
          return Object.freeze({
            model: providerFrom(current),
            replayed: true,
          });
        }
        if (current.version !== options.expectedVersion) {
          invalid("Provider Model version changed before mapping.");
        }
        await connection.execute(
          `UPDATE provider_model
           SET canonical_model_id = ?, mapping_source = ?,
               mapping_confidence = ?, lifecycle_status = 'mapped',
               mapped_at = ?, updated_by_principal_id = ?,
               updated_at = ?, version = version + 1
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.canonicalModelId,
            options.mappingSource,
            options.mappingConfidence,
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.providerModelId,
            options.expectedVersion,
          ],
        );
        const mapped = (
          await readProviderModels(
            connection,
            options.scope.workspaceId,
            current.providerSettingId,
            [current.upstreamModelId],
          )
        )[0];
        if (!mapped) invalid("Mapped Provider Model could not be read.");
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "provider_model.mapped",
            action: "map_provider_model",
            resourceType: "provider_model",
            resourceId: options.providerModelId,
            outcome: "succeeded",
            decisionReasonCode: "provider_model.mapped",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              canonicalModelId: options.canonicalModelId,
              mappingSource: options.mappingSource,
              mappingConfidence: options.mappingConfidence,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({ model: mapped, replayed: false });
      });
    },

    async publishCanonicalModel(options: PublishCanonicalModelOptions) {
      assertId(options.canonicalModelId, "Canonical Model ID");
      assertId(options.profileRevisionId, "Model profile revision ID");
      if (
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1
      ) {
        invalid("Canonical Model expected version is invalid.");
      }
      const profile = parseModelProfileDocumentV1(options.profileDocument);
      const canonicalDigest = digestProviderValue(profile);
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [rows] = await connection.execute<CanonicalModelRow[]>(
          `SELECT
             id, slug, lifecycle_status AS lifecycle,
             source_kind AS sourceKind, source_reference AS sourceReference,
             version, created_at AS createdAt, updated_at AS updatedAt
           FROM canonical_model
           WHERE workspace_id = ? AND id = ?
           LIMIT 1 FOR UPDATE`,
          [options.scope.workspaceId, options.canonicalModelId],
        );
        const current = rows[0];
        if (!current || current.lifecycle === "revoked") {
          invalid("Canonical Model is unavailable for publication.");
        }
        if (profile.model.slug !== current.slug) {
          invalid("Model profile slug does not match the Canonical Model.");
        }
        const [profileRows] = await connection.execute<ProfileRow[]>(
          `SELECT id, revision, canonical_digest AS canonicalDigest
           FROM model_profile_revision
           WHERE workspace_id = ? AND canonical_model_id = ?
           ORDER BY revision DESC
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, options.canonicalModelId],
        );
        const latest = profileRows[0];
        if (
          current.lifecycle === "active" &&
          latest?.canonicalDigest === canonicalDigest
        ) {
          return Object.freeze({
            model: canonicalFrom(current),
            profileRevisionId: latest.id,
            replayed: true,
          });
        }
        if (current.version !== options.expectedVersion) {
          invalid("Canonical Model version changed before publication.");
        }
        const nextRevision = (latest?.revision ?? 0) + 1;
        await connection.execute(
          `INSERT INTO model_profile_revision (
             id, workspace_id, canonical_model_id, profile_key, revision,
             schema_version, profile_document, canonical_digest,
             lifecycle_status, created_by_principal_id,
             published_by_principal_id, created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'published', ?, ?, ?, ?)`,
          [
            options.profileRevisionId,
            options.scope.workspaceId,
            options.canonicalModelId,
            current.slug,
            nextRevision,
            JSON.stringify(profile),
            canonicalDigest,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute(
          `UPDATE canonical_model
           SET lifecycle_status = 'active',
               activated_at = COALESCE(activated_at, ?),
               disabled_at = NULL,
               updated_by_principal_id = ?, updated_at = ?,
               version = version + 1
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.canonicalModelId,
            options.expectedVersion,
          ],
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "model.published",
            action: "publish_model",
            resourceType: "canonical_model",
            resourceId: options.canonicalModelId,
            outcome: "succeeded",
            decisionReasonCode: "model.published",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              profileRevisionId: options.profileRevisionId,
              revision: nextRevision,
              profileDigest: canonicalDigest,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          model: await readCanonicalModel(
            connection,
            options.scope.workspaceId,
            options.canonicalModelId,
          ),
          profileRevisionId: options.profileRevisionId,
          replayed: false,
        });
      });
    },

    async publishProviderModel(options: PublishProviderModelOptions) {
      assertId(options.providerSettingId, "Provider Setting ID");
      assertId(options.providerModelId, "Provider Model ID");
      assertId(options.modelDeploymentId, "Model Deployment ID");
      assertId(options.pricingRevisionId, "Pricing Revision ID");
      assertId(options.agentModelBindingId, "Agent Model Binding ID");
      for (const id of options.routePolicyRevisionIds) {
        assertId(id, "Route Policy Revision ID");
      }
      if (
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1
      ) {
        invalid("Provider Model expected version is invalid.");
      }
      return transact(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [rows] = await connection.execute<ProviderModelPublicationRow[]>(
          `SELECT
               provider_model.id,
               provider_model.provider_setting_id AS providerSettingId,
               provider_model.upstream_model_id AS upstreamModelId,
               provider_model.canonical_model_id AS canonicalModelId,
               provider_model.catalog_snapshot_id AS catalogSnapshotId,
               provider_model.mapping_source AS mappingSource,
               provider_model.mapping_confidence AS mappingConfidence,
               provider_model.maximum_charge_currency_code
                 AS maximumChargeCurrencyCode,
               provider_model.maximum_charge_amount AS maximumChargeAmount,
               provider_model.lifecycle_status AS lifecycle,
               provider_model.last_seen_at AS lastSeenAt,
               provider_model.version,
               canonical.lifecycle_status AS canonicalModelLifecycle,
               endpoint.id AS providerEndpointId,
               endpoint.lifecycle_status AS endpointLifecycle,
               endpoint.validation_status AS validationStatus,
               endpoint.adapter_kind AS providerAdapterKind,
               endpoint.preset_kind AS providerPreset,
               credential.id AS credentialId,
               credential.lifecycle_status AS credentialLifecycle,
               setting.budget_account_id AS budgetAccountId,
               budget.lifecycle_status AS budgetLifecycle,
               profile.id AS profileRevisionId,
               profile.profile_document AS profileDocument,
               catalog.catalog_document AS catalogDocument
             FROM provider_model
             INNER JOIN provider_setting AS setting
               ON setting.workspace_id = provider_model.workspace_id
              AND setting.id = provider_model.provider_setting_id
             INNER JOIN provider_endpoint AS endpoint
               ON endpoint.workspace_id = setting.workspace_id
              AND endpoint.id = setting.provider_endpoint_id
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             LEFT JOIN budget_account AS budget
               ON budget.workspace_id = setting.workspace_id
              AND budget.id = setting.budget_account_id
             INNER JOIN canonical_model AS canonical
               ON canonical.workspace_id = provider_model.workspace_id
              AND canonical.id = provider_model.canonical_model_id
             INNER JOIN model_profile_revision AS profile
               ON profile.workspace_id = canonical.workspace_id
              AND profile.canonical_model_id = canonical.id
              AND profile.lifecycle_status = 'published'
              AND profile.revision = (
                SELECT MAX(latest.revision)
                FROM model_profile_revision AS latest
                WHERE latest.workspace_id = canonical.workspace_id
                  AND latest.canonical_model_id = canonical.id
                  AND latest.lifecycle_status = 'published'
              )
             INNER JOIN provider_model_catalog_snapshot AS catalog
               ON catalog.workspace_id = provider_model.workspace_id
              AND catalog.id = provider_model.catalog_snapshot_id
             WHERE provider_model.workspace_id = ?
               AND provider_model.provider_setting_id = ?
               AND provider_model.id = ?
             LIMIT 1 FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.providerSettingId,
            options.providerModelId,
          ],
        );
        const row = rows[0];
        if (!row) invalid("Provider Model was not found.");
        if (
          !row.canonicalModelId ||
          row.canonicalModelLifecycle !== "active" ||
          !["mapped", "active"].includes(row.lifecycle)
        ) {
          invalid("Only a mapped active Canonical Model can be published.");
        }
        if (
          row.endpointLifecycle !== "active" ||
          row.validationStatus !== "passed" ||
          row.credentialLifecycle !== "active" ||
          !row.budgetAccountId ||
          row.budgetLifecycle !== "active"
        ) {
          invalid("Only an active funded Provider can publish a model.");
        }
        const catalog = parseProviderModelCatalogDocument(
          typeof row.catalogDocument === "string"
            ? (JSON.parse(row.catalogDocument) as unknown)
            : row.catalogDocument,
        );
        const catalogEntry = catalog.models.find(
          (candidate) => candidate.providerModelId === row.upstreamModelId,
        );
        if (!catalogEntry) {
          invalid("Provider Model is absent from its pinned catalog.");
        }
        const runtimeAdapters =
          await loadProviderRuntimeAdapterProfilesInTransaction(
            connection,
            options.scope.workspaceId,
          );
        const pricing = publicationPricing({
          row,
          catalogEntry,
          pricing: options.pricing,
          modelDeploymentId: options.modelDeploymentId,
          pricingRevisionId: options.pricingRevisionId,
          routePolicyRevisionIds: options.routePolicyRevisionIds,
          runtimeAdapters,
        });
        const profile = parseModelProfileDocumentV1(
          typeof row.profileDocument === "string"
            ? (JSON.parse(row.profileDocument) as unknown)
            : row.profileDocument,
        );
        const providerTextOperation = catalogEntry.operations["text.generate"];
        let textTransport: ProviderAgentTextTransport | undefined;
        if (
          profile.operations["text.generate"] &&
          (providerTextOperation || options.agentTextTransport)
        ) {
          textTransport = agentTextTransport(
            row.providerPreset,
            row.providerAdapterKind,
            options.agentTextTransport,
            providerTextOperation?.apiSurfaces,
          );
        } else if (options.agentTextTransport) {
          invalid("Provider Model does not publish a text generation route.");
        }
        const [deploymentRows] = await connection.execute<
          CurrentModelDeploymentRow[]
        >(
          `SELECT
               deployment.id AS currentDeploymentId,
               deployment.generation AS currentGeneration,
               deployment.deployment_digest AS currentDeploymentDigest,
               deployment.lifecycle_status AS currentDeploymentLifecycle,
               pricing.id AS currentPricingRevisionId,
               pricing.canonical_digest AS currentPricingDigest
             FROM model_deployment AS deployment
             LEFT JOIN pricing_revision AS pricing
               ON pricing.workspace_id = deployment.workspace_id
              AND pricing.model_deployment_id = deployment.id
              AND pricing.lifecycle_status = 'published'
             WHERE deployment.workspace_id = ?
               AND deployment.provider_endpoint_id = ?
               AND deployment.provider_model_id = ?
             ORDER BY deployment.generation DESC
             LIMIT 1 FOR UPDATE`,
          [
            options.scope.workspaceId,
            row.providerEndpointId,
            row.upstreamModelId,
          ],
        );
        const current = deploymentRows[0];
        const generation = (current?.currentGeneration ?? 0) + 1;
        const deploymentDigest = digestProviderValue({
          canonicalModelId: row.canonicalModelId,
          modelProfileRevisionId: row.profileRevisionId,
          providerSettingId: row.providerSettingId,
          providerModelRecordId: row.id,
          upstreamModelId: row.upstreamModelId,
          providerEndpointId: row.providerEndpointId,
          pricingDigest: pricing.digest,
          ...(textTransport ? { agentTextTransport: textTransport } : {}),
        });
        if (
          row.lifecycle === "active" &&
          current?.currentDeploymentLifecycle === "active" &&
          current.currentDeploymentDigest === deploymentDigest &&
          current.currentPricingDigest === pricing.digest &&
          current.currentPricingRevisionId
        ) {
          return Object.freeze({
            model: providerFrom(row),
            modelDeploymentId: current.currentDeploymentId!,
            pricingRevisionId: current.currentPricingRevisionId,
            replayed: true,
          });
        }
        if (row.version !== options.expectedVersion) {
          invalid("Provider Model version changed before publication.");
        }
        if (current?.currentDeploymentLifecycle === "active") {
          await connection.execute(
            `UPDATE model_deployment
             SET lifecycle_status = 'superseded', version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ? AND id = ?
               AND lifecycle_status = 'active'`,
            [
              options.now,
              options.scope.workspaceId,
              current.currentDeploymentId,
            ],
          );
        }
        const keyBase = `model.${digestProviderValue({
          providerSettingId: row.providerSettingId,
          providerModelId: row.id,
        }).slice(7, 39)}`;
        await connection.execute(
          `INSERT INTO model_deployment (
             id, workspace_id, provider_endpoint_id,
             provider_model_record_id, model_profile_revision_id,
             deployment_key, provider_model_id, generation,
             supersedes_model_deployment_id, deployment_digest,
             lifecycle_status, version, created_by_principal_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
          [
            options.modelDeploymentId,
            options.scope.workspaceId,
            row.providerEndpointId,
            row.id,
            row.profileRevisionId,
            `${keyBase}.g${String(generation)}`,
            row.upstreamModelId,
            generation,
            current?.currentDeploymentId ?? null,
            deploymentDigest,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute(
          `INSERT INTO pricing_revision (
             id, workspace_id, provider_endpoint_id, model_deployment_id,
             pricing_key, revision, schema_version, currency_code,
             pricing_document, canonical_digest, lifecycle_status,
             source_kind, verified_at, effective_at,
             created_by_principal_id, published_by_principal_id,
             created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, 'USD', ?, ?, 'published',
                     'contract', ?, ?, ?, ?, ?, ?)`,
          [
            options.pricingRevisionId,
            options.scope.workspaceId,
            row.providerEndpointId,
            options.modelDeploymentId,
            keyBase,
            generation,
            JSON.stringify(pricing.document),
            pricing.digest,
            options.now,
            options.now,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        for (const [index, route] of pricing.routes.entries()) {
          await connection.execute(
            `INSERT INTO route_policy_revision (
               id, workspace_id, route_key, revision, schema_version,
               route_document, canonical_digest, lifecycle_status,
               created_by_principal_id, published_by_principal_id,
               created_at, published_at
             ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
            [
              route.routePolicyRevisionId,
              options.scope.workspaceId,
              `${keyBase}.${route.capabilityKey}.${String(index + 1)}.g${String(
                generation,
              )}`,
              JSON.stringify(route.routePolicyDocument),
              route.routePolicyDigest,
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
        }
        if (pricing.routes.length > 0) {
          await reconcilePublishedProviderImageCapabilityBindingsInTransaction(
            connection,
            {
              workspaceId: options.scope.workspaceId,
              actorPrincipalId: options.scope.principalId,
              now: options.now,
            },
          );
          if (current?.currentDeploymentId) {
            await connection.execute(
              `UPDATE capability_binding AS binding
               INNER JOIN route_policy_revision AS route
                 ON route.workspace_id = binding.workspace_id
                AND route.id = binding.route_policy_revision_id
               SET binding.lifecycle_status = 'disabled',
                   binding.version = binding.version + 1,
                   binding.updated_at = ?
               WHERE binding.workspace_id = ?
                 AND binding.lifecycle_status = 'active'
                 AND JSON_UNQUOTE(
                   JSON_EXTRACT(route.route_document, '$.modelDeploymentId')
                 ) = ?`,
              [
                options.now,
                options.scope.workspaceId,
                current.currentDeploymentId,
              ],
            );
          }
        }
        if (textTransport) {
          await connection.execute(
            `UPDATE agent_model_binding AS binding
             INNER JOIN model_deployment AS deployment
               ON deployment.workspace_id = binding.workspace_id
              AND deployment.id = binding.model_deployment_id
             SET binding.lifecycle_status = 'disabled',
                 binding.disabled_at = ?, binding.version = binding.version + 1,
                 binding.updated_by_principal_id = ?, binding.updated_at = ?
             WHERE binding.workspace_id = ?
               AND deployment.provider_model_record_id = ?
               AND binding.lifecycle_status = 'enabled'`,
            [
              options.now,
              options.scope.principalId,
              options.now,
              options.scope.workspaceId,
              row.id,
            ],
          );
          const bindingKey = `agent.${keyBase.slice("model.".length)}.g${String(
            generation,
          )}`;
          const routeFacts = Object.freeze({
            schemaVersion: 1,
            bindingId: options.agentModelBindingId,
            bindingKey,
            modelProfileRevisionId: row.profileRevisionId,
            modelDeploymentId: options.modelDeploymentId,
            providerEndpointId: row.providerEndpointId,
            credentialId: row.credentialId,
            pricingRevisionId: options.pricingRevisionId,
            budgetAccountId: row.budgetAccountId,
            maximumCharge: Object.freeze({
              currencyCode: "USD",
              amount: pricing.maximumChargeAmount,
            }),
            apiSurface: textTransport.apiSurface,
            protocolKind: textTransport.protocolKind,
            providerModelId: row.upstreamModelId,
          });
          const routeDigest = digestProviderValue(routeFacts);
          await connection.execute(
            `INSERT INTO agent_model_binding (
               id, workspace_id, binding_key, model_profile_revision_id,
               model_deployment_id, provider_endpoint_id, credential_id,
               budget_account_id, maximum_charge_currency_code,
               maximum_charge_amount, pricing_revision_id, api_surface,
               protocol_kind, lifecycle_status, route_digest,
               idempotency_key, request_hash, version,
               created_by_principal_id, updated_by_principal_id,
               created_at, updated_at, disabled_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 'enabled',
                       ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
            [
              options.agentModelBindingId,
              options.scope.workspaceId,
              bindingKey,
              row.profileRevisionId,
              options.modelDeploymentId,
              row.providerEndpointId,
              row.credentialId,
              row.budgetAccountId,
              pricing.maximumChargeAmount,
              options.pricingRevisionId,
              textTransport.apiSurface,
              textTransport.protocolKind,
              routeDigest,
              `model-deployment:${deploymentDigest}`,
              digestProviderValue({
                routeDigest,
                source: "model_control_plane",
              }),
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
          await connection.execute(
            `INSERT IGNORE INTO workspace_agent_model_settings (
               workspace_id, default_canonical_model_id,
               fast_canonical_model_id, reasoning_level, web_search_mode,
               version, updated_by_principal_id, updated_at
             ) VALUES (?, ?, ?, 'medium', 'off', 1, ?, ?)`,
            [
              options.scope.workspaceId,
              row.canonicalModelId,
              row.canonicalModelId,
              options.scope.principalId,
              options.now,
            ],
          );
        }
        await connection.execute(
          `UPDATE provider_model
           SET maximum_charge_currency_code = 'USD',
               maximum_charge_amount = ?, lifecycle_status = 'active',
               activated_at = COALESCE(activated_at, ?),
               disabled_at = NULL, updated_by_principal_id = ?,
               updated_at = ?, version = version + 1
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            pricing.maximumChargeAmount,
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            row.id,
            options.expectedVersion,
          ],
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "provider_model.published",
            action: "publish_provider_model",
            resourceType: "provider_model",
            resourceId: row.id,
            outcome: "succeeded",
            decisionReasonCode: "provider_model.published",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              canonicalModelId: row.canonicalModelId,
              modelDeploymentId: options.modelDeploymentId,
              pricingRevisionId: options.pricingRevisionId,
              generation,
              pricingDigest: pricing.digest,
              routeCount: pricing.routes.length,
              ...(textTransport
                ? {
                    agentTextTransport: {
                      apiSurface: textTransport.apiSurface,
                      protocolKind: textTransport.protocolKind,
                    },
                  }
                : {}),
            },
            occurredAt: options.now,
          },
        );
        const published = (
          await readProviderModels(
            connection,
            options.scope.workspaceId,
            row.providerSettingId,
            [row.upstreamModelId],
          )
        )[0];
        if (!published) invalid("Published Provider Model could not be read.");
        return Object.freeze({
          model: published,
          modelDeploymentId: options.modelDeploymentId,
          pricingRevisionId: options.pricingRevisionId,
          replayed: false,
        });
      });
    },

    async publishConfiguredModel(options: PublishConfiguredModelOptions) {
      if (
        options.canonical.scope.workspaceId !==
          options.provider.scope.workspaceId ||
        options.canonical.scope.principalId !==
          options.provider.scope.principalId ||
        options.canonical.now.getTime() !== options.provider.now.getTime()
      ) {
        invalid("Configured Model publication context does not match.");
      }
      return transact(async (connection) => {
        const transactional = createModelControlPlaneStore(pool, connection);
        const canonical = await transactional.publishCanonicalModel(
          options.canonical,
        );
        const provider = await transactional.publishProviderModel(
          options.provider,
        );
        return Object.freeze({
          ...provider,
          replayed: canonical.replayed && provider.replayed,
        });
      });
    },
  });
}
