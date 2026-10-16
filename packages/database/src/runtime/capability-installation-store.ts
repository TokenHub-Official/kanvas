import {
  authorizationModelVersion,
  normalizeWorkspacePermissionSet,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  parseCapabilityCatalogRecommendationV1,
  type CapabilityCatalogRecommendationV1,
} from "@kanvas/contracts/capability";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  CatalogPackageInstallError,
  installPreparedCatalogPackageV1,
  prepareCatalogPackageV1,
  type PreparedCatalogPackageV1,
} from "../cli/catalog-package-installer.js";
import { registerCapabilityCatalogEntryInTransaction } from "../cli/catalog-package-registrar.js";
import type { LoadedCatalogPackageV1 } from "../cli/catalog-package-loader.js";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { digestProviderValue } from "./provider-value-digest.js";
import {
  createModelResourceImportStore,
  prepareCatalogModelResourcePublication,
} from "./model-resource-import-store.js";

export type CapabilityInstallationStatus =
  "waiting_dependency" | "installing" | "installed" | "failed";

export interface CapabilityCatalogEntryRecord {
  readonly id: string;
  readonly recommendationKey: string;
  readonly capabilityKey: string;
  readonly packageVersion: string;
  readonly canonicalDigest: string;
  readonly document: CapabilityCatalogRecommendationV1;
  readonly title: Readonly<{
    defaultLocale: string;
    values: Readonly<Record<string, string>>;
  }>;
  readonly description?: Readonly<{
    defaultLocale: string;
    values: Readonly<Record<string, string>>;
  }>;
  readonly category: Readonly<{
    defaultLocale: string;
    values: Readonly<Record<string, string>>;
  }>;
  readonly sourceKind: "model_resource" | "model_service" | "plugin";
  readonly modelServiceSelector?: Readonly<{
    readonly operation: string;
    readonly apiSurface?: string;
    readonly providerPreset?: string;
  }>;
  readonly installedDefinitionId?: string;
  readonly installationStatus?: CapabilityInstallationStatus;
  readonly updateAvailable: boolean;
}

export interface CapabilityInstallationRecord {
  readonly id: string;
  readonly catalogEntryId: string;
  readonly status: CapabilityInstallationStatus;
  readonly selectedRoutePolicyRevisionId?: string;
  readonly modelResourceImportId?: string;
  readonly installedDefinitionId?: string;
  readonly requiredModelResourceAssetKey?: string;
  readonly failure?: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly replayed: boolean;
}

export interface RegisterCapabilityCatalogEntryOptions {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly document: CapabilityCatalogRecommendationV1;
  readonly now: Date;
}

export interface InstallCapabilityRecommendationOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly operationId: string;
  readonly catalogEntryId: string;
  readonly idempotencyKey: string;
  readonly selectedRoutePolicyRevisionId?: string;
  readonly now: Date;
  readonly nextId: () => string;
  readonly requestedAudit: ControlPlaneAuditContext;
  readonly completedAudit: ControlPlaneAuditContext;
}

export interface AttachCapabilityInstallationImportOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly operationId: string;
  readonly expectedVersion: number;
  readonly modelResourceImportId: string;
  readonly now: Date;
}

export interface ResumeCapabilityInstallationsForImportOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly modelResourceImportId: string;
  readonly now: Date;
  readonly nextId: () => string;
  readonly nextAudit: () => ControlPlaneAuditContext;
}

export interface ContinueCatalogModelInstallationOptions {
  readonly now: Date;
  readonly nextId: () => string;
  readonly leaseTokenHash: string;
  readonly leaseExpiresAt: Date;
}

export interface CapabilityInstallationStore {
  registerCatalogEntry(
    options: RegisterCapabilityCatalogEntryOptions,
  ): Promise<{ readonly entryId: string; readonly replayed: boolean }>;
  listCatalogEntries(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly CapabilityCatalogEntryRecord[]>;
  install(
    options: InstallCapabilityRecommendationOptions,
  ): Promise<CapabilityInstallationRecord>;
  attachModelResourceImport(
    options: AttachCapabilityInstallationImportOptions,
  ): Promise<CapabilityInstallationRecord>;
  resumeForModelResourceImport(
    options: ResumeCapabilityInstallationsForImportOptions,
  ): Promise<readonly CapabilityInstallationRecord[]>;
  continueNextCatalogModelInstallation(
    options: ContinueCatalogModelInstallationOptions,
  ): Promise<boolean>;
}

export type CapabilityInstallationStoreErrorCode =
  | "capability_installation.invalid_argument"
  | "capability_installation.catalog_entry_not_found"
  | "capability_installation.idempotency_conflict"
  | "capability_installation.capability_key_conflict"
  | "capability_installation.route_incompatible"
  | "capability_installation.state_conflict";

export class CapabilityInstallationStoreError extends Error {
  public constructor(
    readonly code: CapabilityInstallationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityInstallationStoreError";
  }
}

interface CatalogRow extends RowDataPacket {
  readonly id: string;
  readonly recommendationKey: string;
  readonly capabilityKey: string;
  readonly packageVersion: string;
  readonly canonicalDigest: string;
  readonly document: CapabilityCatalogRecommendationV1;
  readonly lifecycleStatus: "active" | "retired";
  readonly installedDefinitionId: string | null;
  readonly installationStatus: CapabilityInstallationStatus | null;
}

interface OperationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly catalogEntryId: string;
  readonly organizationId: string;
  readonly createdByPrincipalId: string;
  readonly principalType: "human" | "service";
  readonly authenticationRefType: "session" | "service_api_token";
  readonly authenticationRefId: string;
  readonly authenticationRefHash: string;
  readonly authorityType: "human_membership" | "service_grant";
  readonly authorityId: string;
  readonly authorityVersion: number;
  readonly authorizationModelVersion: number;
  readonly effectivePermissions: unknown;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly lifecycleStatus: CapabilityInstallationStatus;
  readonly selectedRoutePolicyRevisionId: string | null;
  readonly modelResourceImportId: string | null;
  readonly installedDefinitionId: string | null;
  readonly failure: Readonly<Record<string, unknown>> | null;
  readonly version: number;
}

interface ContinuationRow extends OperationRow {
  readonly importStatus: "ready" | "published";
}

interface IdentityRow extends RowDataPacket {
  readonly id: string;
  readonly createRequestKey?: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function fail(
  code: CapabilityInstallationStoreErrorCode,
  message: string,
): never {
  throw new CapabilityInstallationStoreError(code, message);
}

async function transaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function loadedPackage(
  document: CapabilityCatalogRecommendationV1,
): LoadedCatalogPackageV1 {
  return Object.freeze({
    manifest: Object.freeze({
      schemaVersion: "kanvas.catalog-package/v1" as const,
      packageKey: document.package.packageKey,
      version: document.package.version,
      displayName: document.package.displayName,
      dependencies: document.package.dependencies,
      recommendations: [],
      assets: document.assets.map((asset) => asset.descriptor),
      contentDigest: document.package.contentDigest,
    }),
    assets: document.assets,
  });
}

function one<T>(values: readonly T[], label: string): T {
  if (values.length !== 1) {
    fail(
      "capability_installation.invalid_argument",
      `Capability recommendation must contain exactly one ${label}.`,
    );
  }
  return values[0]!;
}

function prepareRecommendation(value: unknown): {
  readonly document: CapabilityCatalogRecommendationV1;
  readonly prepared: PreparedCatalogPackageV1;
  readonly capabilityKey: string;
  readonly implementationAssetKey: string;
  readonly sourceKind: "model_resource" | "model_service" | "plugin";
  readonly requiredModelResourceAssetKey?: string;
} {
  const document = parseCapabilityCatalogRecommendationV1(value);
  const prepared = prepareCatalogPackageV1(loadedPackage(document));
  if (prepared.workflows.size > 0 || prepared.skills.length > 0) {
    fail(
      "capability_installation.invalid_argument",
      "Capability recommendation must not contain Workflow or Skill assets.",
    );
  }
  const contract = one([...prepared.contracts.values()], "Contract");
  one(prepared.declarations, "Declaration");
  const adapter = one([...prepared.adapters.values()], "Runtime Adapter");
  const implementation = one(
    [...prepared.implementations.values()],
    "Implementation",
  );
  const binding = one(prepared.bindings, "Binding");
  if (
    binding.assetKey !== document.defaultBindingAssetKey ||
    !binding.document.enabled
  ) {
    fail(
      "capability_installation.invalid_argument",
      "Capability recommendation default Binding must be enabled and exact.",
    );
  }
  const sourceKind = implementation.document.source.kind;
  const modelResources = [...prepared.modelResources.values()];
  if (
    (sourceKind === "model_resource" && modelResources.length !== 1) ||
    (sourceKind !== "model_resource" && modelResources.length !== 0)
  ) {
    fail(
      "capability_installation.invalid_argument",
      "Capability recommendation dependency set does not match its default route.",
    );
  }
  if (
    sourceKind === "model_service" &&
    JSON.stringify(adapter.document.modelServiceSelector) !==
      JSON.stringify(implementation.document.source.selector)
  ) {
    fail(
      "capability_installation.invalid_argument",
      "Capability recommendation model selector differs from its Runtime Adapter.",
    );
  }
  const policy = adapter.document.selectionPolicy;
  if (
    policy?.scope === "capability_private" &&
    policy.capabilityKey !== contract.document.contractKey
  ) {
    fail(
      "capability_installation.invalid_argument",
      "Private Runtime Adapter belongs to another Capability.",
    );
  }
  if (
    sourceKind === "plugin" &&
    adapter.document.executable.kind === "built_in" &&
    policy?.scope !== "capability_private"
  ) {
    fail(
      "capability_installation.invalid_argument",
      "Built-in private algorithms must declare their owning Capability.",
    );
  }
  return Object.freeze({
    document,
    prepared,
    capabilityKey: contract.document.contractKey,
    implementationAssetKey: implementation.assetKey,
    sourceKind,
    ...(modelResources[0]
      ? { requiredModelResourceAssetKey: modelResources[0].assetKey }
      : {}),
  });
}

function operationRecord(
  row: OperationRow,
  requiredModelResourceAssetKey?: string,
  replayed = false,
): CapabilityInstallationRecord {
  return Object.freeze({
    id: row.id,
    catalogEntryId: row.catalogEntryId,
    status: row.lifecycleStatus,
    ...(row.selectedRoutePolicyRevisionId
      ? { selectedRoutePolicyRevisionId: row.selectedRoutePolicyRevisionId }
      : {}),
    ...(row.modelResourceImportId
      ? { modelResourceImportId: row.modelResourceImportId }
      : {}),
    ...(row.installedDefinitionId
      ? { installedDefinitionId: row.installedDefinitionId }
      : {}),
    ...(requiredModelResourceAssetKey ? { requiredModelResourceAssetKey } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    version: row.version,
    replayed,
  });
}

const operationSelect = `SELECT
  id,
  workspace_id AS workspaceId,
  catalog_entry_id AS catalogEntryId,
  organization_id AS organizationId,
  created_by_principal_id AS createdByPrincipalId,
  principal_type AS principalType,
  authentication_ref_type AS authenticationRefType,
  authentication_ref_id AS authenticationRefId,
  authentication_ref_hash AS authenticationRefHash,
  authority_type AS authorityType,
  authority_id AS authorityId,
  authority_version AS authorityVersion,
  authorization_model_version AS authorizationModelVersion,
  effective_permissions AS effectivePermissions,
  request_hash AS requestHash,
  idempotency_key AS idempotencyKey,
  lifecycle_status AS lifecycleStatus,
  selected_route_policy_revision_id AS selectedRoutePolicyRevisionId,
  model_resource_import_id AS modelResourceImportId,
  installed_capability_definition_id AS installedDefinitionId,
  failure,
  version
FROM capability_installation_operation`;

function scopeFromOperation(
  row: OperationRow,
  workspaceId: string,
): TrustedWorkspaceScope {
  const permissions = normalizeWorkspacePermissionSet(
    typeof row.effectivePermissions === "string"
      ? (JSON.parse(row.effectivePermissions) as unknown)
      : row.effectivePermissions,
  );
  if (
    !permissions ||
    row.authorizationModelVersion !== authorizationModelVersion ||
    !idPattern.test(workspaceId) ||
    !idPattern.test(row.organizationId) ||
    !idPattern.test(row.createdByPrincipalId) ||
    !idPattern.test(row.authorityId) ||
    !Number.isSafeInteger(row.authorityVersion) ||
    row.authorityVersion < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(row.authenticationRefHash) ||
    (row.principalType === "human" &&
      (row.authenticationRefType !== "session" ||
        row.authorityType !== "human_membership")) ||
    (row.principalType === "service" &&
      (row.authenticationRefType !== "service_api_token" ||
        row.authorityType !== "service_grant"))
  ) {
    fail(
      "capability_installation.state_conflict",
      "Capability installation authority snapshot is invalid.",
    );
  }
  return Object.freeze({
    workspaceId,
    organizationId: row.organizationId,
    principalId: row.createdByPrincipalId,
    principalType: row.principalType,
    authenticationRefType: row.authenticationRefType,
    authenticationRefId: row.authenticationRefId,
    authorityType: row.authorityType,
    authorityId: row.authorityId,
    authorityVersion: row.authorityVersion,
    authorizationModelVersion,
    effectivePermissions: permissions,
    trusted: true,
  });
}

function auditFromOperation(
  row: OperationRow,
  auditEventId: string,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId,
    actorPrincipalId: row.createdByPrincipalId,
    actorType: row.principalType,
    authenticationRefType: row.authenticationRefType,
    authenticationRefHash: row.authenticationRefHash,
    authorityType: row.authorityType,
    authorityId: row.authorityId,
    authorityVersion: row.authorityVersion,
  });
}

async function readOperation(
  connection: PoolConnection,
  workspaceId: string,
  operationId: string,
  forUpdate = false,
): Promise<OperationRow> {
  const [rows] = await connection.execute<OperationRow[]>(
    `${operationSelect}
     WHERE workspace_id = ? AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [workspaceId, operationId],
  );
  return (
    rows[0] ??
    fail(
      "capability_installation.state_conflict",
      "Capability installation was not found.",
    )
  );
}

async function dependencyReady(
  connection: PoolConnection,
  workspaceId: string,
  prepared: ReturnType<typeof prepareRecommendation>,
  selectedRoutePolicyRevisionId: string | undefined,
  now: Date,
): Promise<boolean> {
  const implementation = one(
    [...prepared.prepared.implementations.values()],
    "Implementation",
  );
  const source = implementation.document.source;
  if (source.kind !== "model_service" && selectedRoutePolicyRevisionId) {
    fail(
      "capability_installation.invalid_argument",
      "Only a model-service recommendation accepts a selected model route.",
    );
  }
  if (source.kind === "plugin") return true;
  if (source.kind === "model_resource") {
    const [rows] = await connection.execute<IdentityRow[]>(
      `SELECT revision.id
       FROM model_resource_revision AS revision
       INNER JOIN model_resource AS resource
         ON resource.workspace_id = revision.workspace_id
        AND resource.id = revision.model_resource_id
       INNER JOIN model_resource_revision_file AS model_file
         ON model_file.workspace_id = revision.workspace_id
        AND model_file.model_resource_revision_id = revision.id
        AND model_file.role = 'primary'
       INNER JOIN stored_object AS model_object
         ON model_object.workspace_id = model_file.workspace_id
        AND model_object.id = model_file.stored_object_id
        AND model_object.delete_state = 'active'
       WHERE revision.workspace_id = ?
         AND resource.resource_key = ?
         AND resource.lifecycle_status = 'active'
         AND revision.revision = ?
         AND revision.canonical_digest = ?
         AND revision.lifecycle_status IN ('published', 'deprecated')
       LIMIT 1 FOR SHARE`,
      [
        workspaceId,
        source.resource.key,
        source.resource.revision,
        source.resource.canonicalDigest,
      ],
    );
    return Boolean(rows[0]);
  }
  if (!selectedRoutePolicyRevisionId) return false;
  const selector = source.selector;
  const [rows] = await connection.execute<IdentityRow[]>(
    `SELECT route.id
     FROM route_policy_revision AS route
     INNER JOIN model_deployment AS deployment
       ON deployment.workspace_id = route.workspace_id
      AND deployment.id = JSON_UNQUOTE(
        JSON_EXTRACT(route.route_document, '$.modelDeploymentId')
      )
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = deployment.workspace_id
      AND endpoint.id = deployment.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = route.workspace_id
      AND credential.id = JSON_UNQUOTE(
        JSON_EXTRACT(route.route_document, '$.credentialId')
      )
     INNER JOIN budget_account AS budget
       ON budget.workspace_id = route.workspace_id
      AND budget.id = JSON_UNQUOTE(
        JSON_EXTRACT(route.route_document, '$.budgetAccountId')
      )
     WHERE route.workspace_id = ? AND route.id = ?
       AND route.lifecycle_status = 'published'
       AND deployment.lifecycle_status = 'active'
       AND endpoint.lifecycle_status = 'active'
       AND endpoint.validation_status = 'passed'
       AND credential.lifecycle_status = 'active'
       AND credential.active_secret_version_id IS NOT NULL
       AND budget.lifecycle_status = 'active'
       AND budget.period_start_at <= ? AND budget.period_end_at > ?
       AND JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.capabilityKey')) = ?
       AND (? IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.apiSurface')) = ?)
       AND (? IS NULL OR endpoint.preset_kind = ?)
     LIMIT 1 FOR SHARE`,
    [
      workspaceId,
      selectedRoutePolicyRevisionId,
      now,
      now,
      selector.operation,
      selector.apiSurface ?? null,
      selector.apiSurface ?? null,
      selector.providerPreset ?? null,
      selector.providerPreset ?? null,
    ],
  );
  if (!rows[0]) {
    fail(
      "capability_installation.route_incompatible",
      "Selected model service route is not compatible and ready.",
    );
  }
  return true;
}

async function appendInstallAudit(
  connection: PoolConnection,
  scope: TrustedWorkspaceScope,
  audit: ControlPlaneAuditContext,
  input: {
    readonly operationId: string;
    readonly action: string;
    readonly outcome: "succeeded" | "failed";
    readonly reasonCode: string;
    readonly details: Readonly<Record<string, string | number | boolean>>;
    readonly now: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, audit, {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    eventType: input.action,
    action: input.action,
    resourceType: "capability_installation",
    resourceId: input.operationId,
    outcome: input.outcome,
    decisionReasonCode: input.reasonCode,
    severity: input.outcome === "failed" ? "warning" : "info",
    authorizationDecision: Object.freeze({
      permission: "capability.configure",
      authorityVersion: scope.authorityVersion,
    }),
    details: input.details,
    occurredAt: input.now,
  });
}

export function createCapabilityInstallationStore(
  pool: Pool,
): CapabilityInstallationStore {
  return Object.freeze<CapabilityInstallationStore>({
    async registerCatalogEntry(options) {
      if (
        !idPattern.test(options.workspaceId) ||
        !idPattern.test(options.entryId) ||
        !(options.now instanceof Date) ||
        !Number.isFinite(options.now.getTime())
      ) {
        fail(
          "capability_installation.invalid_argument",
          "Invalid Capability Catalog registration.",
        );
      }
      const prepared = prepareRecommendation(options.document);
      try {
        return await transaction(pool, (connection) =>
          registerCapabilityCatalogEntryInTransaction(connection, {
            workspaceId: options.workspaceId,
            entryId: options.entryId,
            document: prepared.document,
            now: options.now,
          }),
        );
      } catch (error) {
        if (
          error instanceof CatalogPackageInstallError &&
          error.code === "installed_revision_conflict"
        ) {
          fail(
            "capability_installation.idempotency_conflict",
            "Capability Catalog version differs from its registered digest.",
          );
        }
        throw error;
      }
    },

    async listCatalogEntries(scope, now) {
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<CatalogRow[]>(
          `SELECT
             catalog.id,
             catalog.recommendation_key AS recommendationKey,
             catalog.capability_key AS capabilityKey,
             catalog.package_version AS packageVersion,
             catalog.canonical_digest AS canonicalDigest,
             catalog.document,
             catalog.lifecycle_status AS lifecycleStatus,
             definition.id AS installedDefinitionId,
             operation.lifecycle_status AS installationStatus
           FROM capability_catalog_entry AS catalog
           LEFT JOIN capability_definition AS definition
             ON definition.workspace_id = catalog.workspace_id
            AND definition.capability_key = catalog.capability_key
           LEFT JOIN capability_installation_operation AS operation
             ON operation.workspace_id = catalog.workspace_id
            AND operation.catalog_entry_id = catalog.id
            AND operation.id = (
              SELECT newer.id
              FROM capability_installation_operation AS newer
              WHERE newer.workspace_id = catalog.workspace_id
                AND newer.catalog_entry_id = catalog.id
              ORDER BY newer.created_at DESC, newer.id DESC
              LIMIT 1
            )
           WHERE catalog.workspace_id = ?
             AND catalog.lifecycle_status = 'active'
           ORDER BY catalog.capability_key, catalog.recommendation_key
           LIMIT 500`,
          [scope.workspaceId],
        );
        return Object.freeze(
          rows.map((row) => {
            const prepared = prepareRecommendation(row.document);
            const declaration = one(
              prepared.prepared.declarations,
              "Declaration",
            ).document.declaration;
            const implementation = one(
              [...prepared.prepared.implementations.values()],
              "Implementation",
            ).document;
            return Object.freeze({
              id: row.id,
              recommendationKey: row.recommendationKey,
              capabilityKey: row.capabilityKey,
              packageVersion: row.packageVersion,
              canonicalDigest: row.canonicalDigest,
              document: row.document,
              title: declaration.catalog.title,
              ...(declaration.catalog.description
                ? { description: declaration.catalog.description }
                : {}),
              category: declaration.catalog.category,
              sourceKind: prepared.sourceKind,
              ...(implementation.source.kind === "model_service"
                ? { modelServiceSelector: implementation.source.selector }
                : {}),
              ...(row.installedDefinitionId
                ? { installedDefinitionId: row.installedDefinitionId }
                : {}),
              ...(row.installationStatus
                ? { installationStatus: row.installationStatus }
                : {}),
              updateAvailable: Boolean(
                row.installedDefinitionId && !row.installationStatus,
              ),
            });
          }),
        );
      });
    },

    async install(options) {
      if (
        !idPattern.test(options.operationId) ||
        !idPattern.test(options.catalogEntryId) ||
        (options.selectedRoutePolicyRevisionId !== undefined &&
          !idPattern.test(options.selectedRoutePolicyRevisionId)) ||
        options.idempotencyKey.length < 1 ||
        options.idempotencyKey.length > 160 ||
        !options.requestedAudit.authenticationRefHash
      ) {
        fail(
          "capability_installation.invalid_argument",
          "Invalid Capability installation request.",
        );
      }
      const begun = await transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const [catalogRows] = await connection.execute<CatalogRow[]>(
          `SELECT
             id,
             recommendation_key AS recommendationKey,
             capability_key AS capabilityKey,
             package_version AS packageVersion,
             canonical_digest AS canonicalDigest,
             document,
             lifecycle_status AS lifecycleStatus,
             NULL AS installedDefinitionId,
             NULL AS installationStatus
           FROM capability_catalog_entry
           WHERE workspace_id = ? AND id = ?
             AND lifecycle_status = 'active'
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, options.catalogEntryId],
        );
        const catalog = catalogRows[0];
        if (!catalog) {
          fail(
            "capability_installation.catalog_entry_not_found",
            "Capability recommendation was not found.",
          );
        }
        const prepared = prepareRecommendation(catalog.document);
        const requestHash = digestProviderValue({
          contract: "kanvas.capability-installation.request/v1",
          catalogDigest: catalog.canonicalDigest,
        });
        const [replays] = await connection.execute<OperationRow[]>(
          `${operationSelect}
           WHERE workspace_id = ? AND idempotency_key = ?
           LIMIT 1 FOR UPDATE`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replays[0];
        if (replay && replay.requestHash !== requestHash) {
          fail(
            "capability_installation.idempotency_conflict",
            "Idempotency key was used for another Capability installation.",
          );
        }
        if (replay?.lifecycleStatus === "installed") {
          return Object.freeze({ prepared, operation: replay, replayed: true });
        }
        const [definitions] = await connection.execute<IdentityRow[]>(
          `SELECT id, create_request_key AS createRequestKey
           FROM capability_definition
           WHERE workspace_id = ? AND capability_key = ?
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, prepared.capabilityKey],
        );
        const definition = definitions[0];
        const expectedCatalogPrefix = `catalog:${prepared.document.package.packageKey}:${prepared.document.package.version}:`;
        if (
          definition &&
          !definition.createRequestKey?.startsWith(expectedCatalogPrefix)
        ) {
          fail(
            "capability_installation.capability_key_conflict",
            "Capability key is already owned by another installation.",
          );
        }
        const ready = await dependencyReady(
          connection,
          options.scope.workspaceId,
          prepared,
          options.selectedRoutePolicyRevisionId,
          options.now,
        );
        const status: CapabilityInstallationStatus = ready
          ? "installing"
          : "waiting_dependency";
        let operation: OperationRow;
        if (replay) {
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_installation_operation
             SET lifecycle_status = ?, selected_route_policy_revision_id = ?,
                 failure = NULL, completed_at = NULL,
                 version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?`,
            [
              status,
              options.selectedRoutePolicyRevisionId ?? null,
              options.now,
              options.scope.workspaceId,
              replay.id,
              replay.version,
            ],
          );
          operation = await readOperation(
            connection,
            options.scope.workspaceId,
            replay.id,
          );
        } else {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO capability_installation_operation (
               id, workspace_id, catalog_entry_id, organization_id,
               created_by_principal_id, principal_type,
               authentication_ref_type, authentication_ref_id,
               authentication_ref_hash, authority_type, authority_id,
               authority_version, authorization_model_version,
               effective_permissions,
               idempotency_key, request_hash, lifecycle_status,
               selected_route_policy_revision_id, model_resource_import_id,
               installed_capability_definition_id, failure, version,
               created_at, updated_at, completed_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, NULL
             )`,
            [
              options.operationId,
              options.scope.workspaceId,
              options.catalogEntryId,
              options.scope.organizationId,
              options.scope.principalId,
              options.scope.principalType,
              options.scope.authenticationRefType,
              options.scope.authenticationRefId,
              options.requestedAudit.authenticationRefHash,
              options.scope.authorityType,
              options.scope.authorityId,
              options.scope.authorityVersion,
              options.scope.authorizationModelVersion,
              JSON.stringify(options.scope.effectivePermissions),
              options.idempotencyKey,
              requestHash,
              status,
              options.selectedRoutePolicyRevisionId ?? null,
              options.now,
              options.now,
            ],
          );
          operation = await readOperation(
            connection,
            options.scope.workspaceId,
            options.operationId,
          );
          await appendInstallAudit(
            connection,
            options.scope,
            options.requestedAudit,
            {
              operationId: options.operationId,
              action: "capability_installation.requested",
              outcome: "succeeded",
              reasonCode: ready ? "dependency_ready" : "dependency_required",
              details: Object.freeze({
                catalogEntryId: options.catalogEntryId,
                capabilityKey: prepared.capabilityKey,
              }),
              now: options.now,
            },
          );
        }
        return Object.freeze({
          prepared,
          operation,
          replayed: Boolean(replay),
        });
      });
      if (
        begun.operation.lifecycleStatus === "installed" ||
        begun.operation.lifecycleStatus === "waiting_dependency"
      ) {
        return operationRecord(
          begun.operation,
          begun.prepared.requiredModelResourceAssetKey,
          begun.replayed,
        );
      }
      try {
        await installPreparedCatalogPackageV1({
          pool,
          workspaceId: options.scope.workspaceId,
          actorPrincipalId: options.scope.principalId,
          prepared: begun.prepared.prepared,
          now: options.now,
          nextId: options.nextId,
          ...(options.selectedRoutePolicyRevisionId
            ? {
                providerRouteSelections: new Map([
                  [
                    begun.prepared.implementationAssetKey,
                    options.selectedRoutePolicyRevisionId,
                  ],
                ]),
              }
            : {}),
        });
      } catch (error) {
        return transaction(pool, async (connection) => {
          const failure = Object.freeze({
            code: "installation_failed",
            message:
              error instanceof Error ? error.message : "Installation failed.",
          });
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_installation_operation
             SET lifecycle_status = 'failed', failure = ?,
                 continuation_lease_token_hash = NULL,
                 continuation_lease_expires_at = NULL,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ?
               AND lifecycle_status = 'installing'`,
            [
              JSON.stringify(failure),
              options.now,
              options.now,
              options.scope.workspaceId,
              begun.operation.id,
            ],
          );
          await appendInstallAudit(
            connection,
            options.scope,
            options.completedAudit,
            {
              operationId: begun.operation.id,
              action: "capability_installation.completed",
              outcome: "failed",
              reasonCode: "installation_failed",
              details: Object.freeze({
                capabilityKey: begun.prepared.capabilityKey,
              }),
              now: options.now,
            },
          );
          return operationRecord(
            await readOperation(
              connection,
              options.scope.workspaceId,
              begun.operation.id,
            ),
            begun.prepared.requiredModelResourceAssetKey,
            begun.replayed,
          );
        });
      }
      return transaction(pool, async (connection) => {
        const [definitions] = await connection.execute<IdentityRow[]>(
          `SELECT id
           FROM capability_definition
           WHERE workspace_id = ? AND capability_key = ?
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, begun.prepared.capabilityKey],
        );
        const definition = definitions[0];
        if (!definition) {
          fail(
            "capability_installation.state_conflict",
            "Installed Capability could not be read back.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_installation_operation
           SET lifecycle_status = 'installed',
               installed_capability_definition_id = ?, failure = NULL,
               continuation_lease_token_hash = NULL,
               continuation_lease_expires_at = NULL,
               version = version + 1, updated_at = ?, completed_at = ?
           WHERE workspace_id = ? AND id = ?
             AND lifecycle_status = 'installing'`,
          [
            definition.id,
            options.now,
            options.now,
            options.scope.workspaceId,
            begun.operation.id,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "capability_installation.state_conflict",
            "Capability installation changed before completion.",
          );
        }
        await appendInstallAudit(
          connection,
          options.scope,
          options.completedAudit,
          {
            operationId: begun.operation.id,
            action: "capability_installation.completed",
            outcome: "succeeded",
            reasonCode: "installed",
            details: Object.freeze({
              capabilityDefinitionId: definition.id,
              capabilityKey: begun.prepared.capabilityKey,
            }),
            now: options.now,
          },
        );
        return operationRecord(
          await readOperation(
            connection,
            options.scope.workspaceId,
            begun.operation.id,
          ),
          undefined,
          begun.replayed,
        );
      });
    },

    async attachModelResourceImport(options) {
      if (
        !idPattern.test(options.operationId) ||
        !idPattern.test(options.modelResourceImportId) ||
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1
      ) {
        fail(
          "capability_installation.invalid_argument",
          "Invalid Capability dependency import attachment.",
        );
      }
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const operation = await readOperation(
          connection,
          options.scope.workspaceId,
          options.operationId,
          true,
        );
        if (
          operation.version !== options.expectedVersion ||
          operation.lifecycleStatus !== "waiting_dependency" ||
          (operation.modelResourceImportId &&
            operation.modelResourceImportId !== options.modelResourceImportId)
        ) {
          fail(
            "capability_installation.state_conflict",
            "Capability installation changed before its dependency was attached.",
          );
        }
        const [imports] = await connection.execute<IdentityRow[]>(
          `SELECT id
           FROM model_resource_import
           WHERE workspace_id = ? AND id = ?
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, options.modelResourceImportId],
        );
        if (!imports[0]) {
          fail(
            "capability_installation.state_conflict",
            "Model resource import was not found.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE capability_installation_operation
           SET model_resource_import_id = ?, version = version + 1,
               updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.modelResourceImportId,
            options.now,
            options.scope.workspaceId,
            options.operationId,
            options.expectedVersion,
          ],
        );
        return operationRecord(
          await readOperation(
            connection,
            options.scope.workspaceId,
            options.operationId,
          ),
        );
      });
    },

    async resumeForModelResourceImport(options) {
      if (!idPattern.test(options.modelResourceImportId)) {
        fail(
          "capability_installation.invalid_argument",
          "Invalid Capability dependency import resume request.",
        );
      }
      const waiting = await transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const [rows] = await connection.execute<OperationRow[]>(
          `${operationSelect}
           WHERE workspace_id = ? AND model_resource_import_id = ?
             AND lifecycle_status = 'waiting_dependency'
           ORDER BY created_at, id
           LIMIT 32`,
          [options.scope.workspaceId, options.modelResourceImportId],
        );
        return rows;
      });
      const results: CapabilityInstallationRecord[] = [];
      for (const operation of waiting) {
        results.push(
          await this.install({
            scope: options.scope,
            operationId: operation.id,
            catalogEntryId: operation.catalogEntryId,
            idempotencyKey: operation.idempotencyKey,
            ...(operation.selectedRoutePolicyRevisionId
              ? {
                  selectedRoutePolicyRevisionId:
                    operation.selectedRoutePolicyRevisionId,
                }
              : {}),
            now: options.now,
            nextId: options.nextId,
            requestedAudit: options.nextAudit(),
            completedAudit: options.nextAudit(),
          }),
        );
      }
      return Object.freeze(results);
    },

    async continueNextCatalogModelInstallation(options) {
      if (
        !/^[0-9a-f]{64}$/u.test(options.leaseTokenHash) ||
        !(options.now instanceof Date) ||
        !(options.leaseExpiresAt instanceof Date) ||
        options.leaseExpiresAt <= options.now
      ) {
        fail(
          "capability_installation.invalid_argument",
          "Invalid Capability installation continuation lease.",
        );
      }
      const continuation = await transaction(pool, async (connection) => {
        const [rows] = await connection.execute<ContinuationRow[]>(
          `SELECT operation.*, model_import.lifecycle_status AS importStatus
           FROM (${operationSelect}) AS operation
           INNER JOIN capability_installation_operation AS locked_operation
             ON locked_operation.workspace_id = operation.workspaceId
            AND locked_operation.id = operation.id
           INNER JOIN model_resource_import AS model_import
             ON model_import.workspace_id = operation.workspaceId
            AND model_import.id = operation.modelResourceImportId
           WHERE operation.lifecycleStatus = 'waiting_dependency'
             AND model_import.lifecycle_status IN ('ready', 'published')
             AND (
               locked_operation.continuation_lease_expires_at IS NULL
               OR locked_operation.continuation_lease_expires_at <= ?
             )
           ORDER BY locked_operation.updated_at, locked_operation.id
           LIMIT 1 FOR UPDATE`,
          [options.now],
        );
        const operation = rows[0];
        if (!operation) return undefined;
        const [claimed] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_installation_operation
           SET continuation_lease_token_hash = ?,
               continuation_lease_expires_at = ?,
               continuation_attempts = continuation_attempts + 1,
               version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?
             AND lifecycle_status = 'waiting_dependency'
             AND (
               continuation_lease_expires_at IS NULL
               OR continuation_lease_expires_at <= ?
             )`,
          [
            options.leaseTokenHash,
            options.leaseExpiresAt,
            options.now,
            operation.workspaceId,
            operation.id,
            operation.version,
            options.now,
          ],
        );
        if (claimed.affectedRows !== 1) return undefined;
        const claimedOperation = Object.freeze({
          ...operation,
          version: operation.version + 1,
        });
        const scope = scopeFromOperation(
          claimedOperation,
          claimedOperation.workspaceId,
        );
        try {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            scope,
            "capability.configure",
            options.now,
          );
        } catch {
          const failure = Object.freeze({
            code: "authorization_revoked",
            message:
              "Capability installation authorization is no longer valid.",
          });
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_installation_operation
             SET lifecycle_status = 'failed', failure = ?,
                 continuation_lease_token_hash = NULL,
                 continuation_lease_expires_at = NULL,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?`,
            [
              JSON.stringify(failure),
              options.now,
              options.now,
              claimedOperation.workspaceId,
              claimedOperation.id,
              claimedOperation.version,
            ],
          );
          await appendInstallAudit(
            connection,
            scope,
            auditFromOperation(claimedOperation, options.nextId()),
            {
              operationId: claimedOperation.id,
              action: "capability_installation.completed",
              outcome: "failed",
              reasonCode: "authorization_revoked",
              details: Object.freeze({
                catalogEntryId: claimedOperation.catalogEntryId,
              }),
              now: options.now,
            },
          );
          return Object.freeze({ handled: true as const });
        }
        return Object.freeze({
          handled: false as const,
          operation: claimedOperation,
          scope,
        });
      });
      if (!continuation) return false;
      if (continuation.handled) return true;
      const { operation, scope } = continuation;
      try {
        if (operation.importStatus === "ready") {
          const modelStore = createModelResourceImportStore(pool);
          const imported = await modelStore.read({
            scope,
            importId: operation.modelResourceImportId!,
            now: options.now,
          });
          const publication = prepareCatalogModelResourcePublication(imported);
          await modelStore.finalizePublished({
            scope,
            importId: imported.id,
            expectedVersion: imported.version,
            resourceId: options.nextId(),
            revisionId: options.nextId(),
            target: {
              kind: "new",
              key: publication.key,
              revision: publication.revision,
            },
            displayName: publication.displayName,
            ...(publication.description
              ? { description: publication.description }
              : {}),
            manifest: publication.manifest,
            revisionDigest: publication.revisionDigest,
            idempotencyKey: `capability-installation:${operation.id}:model`,
            requestHash: publication.requestHash,
            audit: auditFromOperation(operation, options.nextId()),
            now: options.now,
          });
        }
        const installed = await this.install({
          scope,
          operationId: operation.id,
          catalogEntryId: operation.catalogEntryId,
          idempotencyKey: operation.idempotencyKey,
          ...(operation.selectedRoutePolicyRevisionId
            ? {
                selectedRoutePolicyRevisionId:
                  operation.selectedRoutePolicyRevisionId,
              }
            : {}),
          now: options.now,
          nextId: options.nextId,
          requestedAudit: auditFromOperation(operation, options.nextId()),
          completedAudit: auditFromOperation(operation, options.nextId()),
        });
        if (installed.status === "waiting_dependency") {
          throw new Error(
            "Published Catalog model did not satisfy the Capability dependency.",
          );
        }
        return true;
      } catch (error) {
        await transaction(pool, async (connection) => {
          const [installedRows] = await connection.execute<IdentityRow[]>(
            `SELECT definition.id
             FROM capability_catalog_entry AS catalog
             INNER JOIN capability_definition AS definition
               ON definition.workspace_id = catalog.workspace_id
              AND definition.capability_key = catalog.capability_key
              AND definition.create_request_key LIKE CONCAT(
                'catalog:', catalog.package_key, ':', catalog.package_version, ':%'
              )
             WHERE catalog.workspace_id = ? AND catalog.id = ?
             LIMIT 1 FOR SHARE`,
            [operation.workspaceId, operation.catalogEntryId],
          );
          const installedDefinition = installedRows[0];
          if (installedDefinition) {
            const [recovered] = await connection.execute<ResultSetHeader>(
              `UPDATE capability_installation_operation
               SET lifecycle_status = 'installed',
                   installed_capability_definition_id = ?, failure = NULL,
                   continuation_lease_token_hash = NULL,
                   continuation_lease_expires_at = NULL,
                   version = version + 1, updated_at = ?, completed_at = ?
               WHERE workspace_id = ? AND id = ?
                 AND lifecycle_status IN ('waiting_dependency', 'installing')`,
              [
                installedDefinition.id,
                options.now,
                options.now,
                operation.workspaceId,
                operation.id,
              ],
            );
            if (recovered.affectedRows > 0) {
              await appendInstallAudit(
                connection,
                scope,
                auditFromOperation(operation, options.nextId()),
                {
                  operationId: operation.id,
                  action: "capability_installation.completed",
                  outcome: "succeeded",
                  reasonCode: "installed_state_recovered",
                  details: Object.freeze({
                    catalogEntryId: operation.catalogEntryId,
                    capabilityDefinitionId: installedDefinition.id,
                  }),
                  now: options.now,
                },
              );
            }
            return;
          }
          const [importRows] = await connection.execute<
            (RowDataPacket & { lifecycleStatus: string })[]
          >(
            `SELECT lifecycle_status AS lifecycleStatus
             FROM model_resource_import
             WHERE workspace_id = ? AND id = ?
             LIMIT 1 FOR SHARE`,
            [operation.workspaceId, operation.modelResourceImportId],
          );
          if (importRows[0]?.lifecycleStatus === "published") {
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_installation_operation
               SET continuation_lease_token_hash = NULL,
                   continuation_lease_expires_at = NULL,
                   version = version + 1, updated_at = ?
               WHERE workspace_id = ? AND id = ?
                 AND lifecycle_status = 'waiting_dependency'`,
              [options.now, operation.workspaceId, operation.id],
            );
            return;
          }
          const failure = Object.freeze({
            code: "dependency_publication_failed",
            message:
              error instanceof Error
                ? error.message
                : "Capability dependency publication failed.",
          });
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_installation_operation
             SET lifecycle_status = 'failed', failure = ?,
                 continuation_lease_token_hash = NULL,
                 continuation_lease_expires_at = NULL,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ?
               AND lifecycle_status IN ('waiting_dependency', 'installing')`,
            [
              JSON.stringify(failure),
              options.now,
              options.now,
              operation.workspaceId,
              operation.id,
            ],
          );
          if (updated.affectedRows > 0) {
            await appendInstallAudit(
              connection,
              scope,
              auditFromOperation(operation, options.nextId()),
              {
                operationId: operation.id,
                action: "capability_installation.completed",
                outcome: "failed",
                reasonCode: "dependency_publication_failed",
                details: Object.freeze({
                  catalogEntryId: operation.catalogEntryId,
                }),
                now: options.now,
              },
            );
          }
        });
        return true;
      }
    },
  });
}
