import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ArtTextPresetManifest,
  ResourceLicensePolicy,
  ResourceSourceCapability,
} from "@kanvas/contracts/resource-source";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { digestProviderValue } from "./provider-value-digest.js";
import {
  loadPinnedSecretVersionMetadataInTransaction,
  type PinnedSecretVersionMetadata,
} from "./secret-version-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const resourceSourceCapabilities = new Set<ResourceSourceCapability>([
  "image.search",
  "image.import",
  "vector.search",
  "vector.import",
  "font.list",
  "font.import",
  "art_text.list",
  "art_text.import",
]);
const resourceSourceOperationKinds = new Set<ResourceSourceOperationKind>([
  "validate",
  "disable",
  "rotate_secret",
]);

export type ResourceSourceAuthMode = "none" | "api_key" | "client_credentials";
export type ResourceSourceLifecycle =
  "draft" | "validating" | "ready" | "published" | "failed" | "disabled";
export type ResourceSourceValidationStatus =
  "not_checked" | "pending" | "passed" | "failed";

export interface ResourceSourceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly authMode: ResourceSourceAuthMode;
  readonly endpointOrigin: string;
  readonly providerEndpointId: string;
  readonly credentialId: string | null;
  readonly secretConfigured: boolean;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly configurationDigest: string;
  readonly licensePolicy: ResourceLicensePolicy;
  readonly lifecycleStatus: ResourceSourceLifecycle;
  readonly validationStatus: ResourceSourceValidationStatus;
  readonly validationReasonCode: string | null;
  readonly currentRevisionId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disabledAt: Date | null;
}

export interface ResourceSourceRevisionRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly revisionNumber: number;
  readonly contentDigest: string;
  readonly capabilities: readonly ResourceSourceCapability[];
  readonly publishedAt: Date;
}

export interface ResourceSourceMutation<T> {
  readonly replayed: boolean;
  readonly value: T;
}

export interface ResourceSourceValidationIdentity {
  readonly source: ResourceSourceRecord;
  readonly secret?: PinnedSecretVersionMetadata;
}

export interface ResourceSourceSecretWriteIdentity {
  readonly source: ResourceSourceRecord;
  readonly credentialId: string;
  readonly credentialVersion: number;
}

export interface ResourceCatalogSourceRecord {
  readonly id: string;
  readonly displayName: string;
  readonly adapterKind: string;
  readonly revisionId: string;
  readonly capabilities: readonly ResourceSourceCapability[];
}

export interface ResourceCatalogRuntimeIdentity extends ResourceCatalogSourceRecord {
  readonly adapterVersion: string;
  readonly endpointOrigin: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly licensePolicy: ResourceLicensePolicy;
  readonly secret?: PinnedSecretVersionMetadata;
}

export interface ArtTextPresetRevisionRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly externalId: string;
  readonly manifestDigest: string;
  readonly createdAt: Date;
}

export interface FontRevisionRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly externalId: string;
  readonly family: string;
  readonly contentDigest: string;
  readonly createdAt: Date;
}

export interface FontRevisionFileInput {
  readonly artifactId: string;
  readonly format: "otf" | "ttf";
  readonly weight: number;
  readonly style: "italic" | "normal";
  readonly subset: string;
}

export interface WorkspaceFontRevisionRecord {
  readonly id: string;
  readonly family: string;
  readonly category:
    "sans" | "serif" | "display" | "handwriting" | "monospace" | "other";
  readonly scripts: readonly string[];
  readonly languages: readonly string[];
  readonly license: Readonly<Record<string, unknown>>;
  readonly files: readonly FontRevisionFileInput[];
  readonly createdAt: Date;
}

export interface WorkspaceArtTextPresetRecord {
  readonly id: string;
  readonly manifest: ArtTextPresetManifest;
  readonly createdAt: Date;
}

export type ResourceSourceOperationKind =
  "validate" | "disable" | "rotate_secret";

export interface ResourceSourceOperationClaim {
  readonly source: ResourceSourceRecord;
  readonly operationId: string;
  readonly operationKind: ResourceSourceOperationKind;
  readonly plannedResourceId: string | null;
  readonly replayed: boolean;
  readonly resumed: boolean;
  readonly resultReasonCode: string | null;
}

interface ResourceSourceCommand {
  readonly scope: TrustedWorkspaceScope;
  readonly sourceId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CreateResourceSourceOptions extends ResourceSourceCommand {
  readonly providerEndpointId: string;
  readonly credentialId?: string;
  readonly displayName: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly authMode: ResourceSourceAuthMode;
  readonly endpointOrigin: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly licensePolicy: ResourceLicensePolicy;
  readonly idempotencyKey: string;
}

export interface RecordResourceSourceValidationOptions extends ResourceSourceCommand {
  readonly expectedVersion: number;
  readonly outcome: "passed" | "failed";
  readonly validationDigest: string;
  readonly reasonCode: string;
}

export interface PublishResourceSourceOptions extends ResourceSourceCommand {
  readonly sourceRevisionId: string;
  readonly expectedVersion: number;
  readonly capabilities: readonly ResourceSourceCapability[];
  readonly idempotencyKey: string;
}

export interface DisableResourceSourceOptions extends ResourceSourceCommand {
  readonly expectedVersion: number;
}

export interface RecordResourceSourceSecretRotationOptions extends ResourceSourceCommand {
  readonly expectedVersion: number;
  readonly secretVersionId: string;
}

export interface AdoptArtTextPresetOptions extends ResourceSourceCommand {
  readonly sourceRevisionId: string;
  readonly artTextPresetRevisionId: string;
  readonly externalId: string;
  readonly manifest: ArtTextPresetManifest;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface AdoptFontRevisionOptions extends ResourceSourceCommand {
  readonly sourceRevisionId: string;
  readonly fontRevisionId: string;
  readonly externalId: string;
  readonly family: string;
  readonly upstreamVersion: string;
  readonly descriptor: Readonly<Record<string, unknown>>;
  readonly files: readonly FontRevisionFileInput[];
  readonly idempotencyKey: string;
}

export interface ClaimResourceSourceOperationOptions extends ResourceSourceCommand {
  readonly operationId: string;
  readonly operationKind: ResourceSourceOperationKind;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly expectedSourceVersion: number;
  readonly plannedResourceId?: string;
}

export interface CompleteResourceSourceOperationOptions extends ResourceSourceCommand {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly resultSourceVersion: number;
  readonly resultReasonCode: string;
}

export interface ResourceSourceStore {
  list(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ResourceSourceRecord[]>;
  listPublished(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ResourceCatalogSourceRecord[]>;
  resolveCatalogIdentity(
    scope: TrustedWorkspaceScope,
    sourceId: string,
    sourceRevisionId: string | undefined,
    now: Date,
  ): Promise<ResourceCatalogRuntimeIdentity>;
  get(
    scope: TrustedWorkspaceScope,
    sourceId: string,
    now: Date,
  ): Promise<ResourceSourceRecord>;
  resolveValidationIdentity(
    scope: TrustedWorkspaceScope,
    sourceId: string,
    now: Date,
  ): Promise<ResourceSourceValidationIdentity>;
  resolveSecretWriteIdentity(
    scope: TrustedWorkspaceScope,
    sourceId: string,
    expectedSourceVersion: number,
    now: Date,
  ): Promise<ResourceSourceSecretWriteIdentity>;
  claimOperation(
    options: ClaimResourceSourceOperationOptions,
  ): Promise<ResourceSourceOperationClaim>;
  completeOperation(
    options: CompleteResourceSourceOperationOptions,
  ): Promise<ResourceSourceOperationClaim>;
  createDraft(
    options: CreateResourceSourceOptions,
  ): Promise<ResourceSourceMutation<ResourceSourceRecord>>;
  recordValidation(
    options: RecordResourceSourceValidationOptions,
  ): Promise<ResourceSourceRecord>;
  publish(
    options: PublishResourceSourceOptions,
  ): Promise<ResourceSourceMutation<ResourceSourceRevisionRecord>>;
  disable(options: DisableResourceSourceOptions): Promise<ResourceSourceRecord>;
  recordSecretRotation(
    options: RecordResourceSourceSecretRotationOptions,
  ): Promise<ResourceSourceRecord>;
  adoptArtTextPreset(
    options: AdoptArtTextPresetOptions,
  ): Promise<ResourceSourceMutation<ArtTextPresetRevisionRecord>>;
  adoptFontRevision(
    options: AdoptFontRevisionOptions,
  ): Promise<ResourceSourceMutation<FontRevisionRecord>>;
  listFontRevisions(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly WorkspaceFontRevisionRecord[]>;
  listArtTextPresets(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly WorkspaceArtTextPresetRecord[]>;
}

export type ResourceSourceStoreErrorCode =
  | "resource_source.invalid_argument"
  | "resource_source.not_found"
  | "resource_source.idempotency_conflict"
  | "resource_source.version_conflict"
  | "resource_source.lifecycle_conflict"
  | "resource_source.secret_not_ready";

export class ResourceSourceStoreError extends Error {
  public constructor(
    public readonly code: ResourceSourceStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResourceSourceStoreError";
  }
}

interface ResourceSourceRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly authMode: ResourceSourceAuthMode;
  readonly endpointOrigin: string;
  readonly providerEndpointId: string;
  readonly credentialId: string | null;
  readonly activeSecretVersionId: string | null;
  readonly activeSecretLifecycle: string | null;
  readonly credentialIdentityEpoch: number | null;
  readonly credentialIdentityDigest: string | null;
  readonly credentialVersion: number | null;
  readonly configurationDocument: Readonly<Record<string, unknown>> | string;
  readonly configurationDigest: string;
  readonly licensePolicy: ResourceLicensePolicy | string;
  readonly lifecycleStatus: ResourceSourceLifecycle;
  readonly validationStatus: ResourceSourceValidationStatus;
  readonly validationReasonCode: string | null;
  readonly currentRevisionId: string | null;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disabledAt: Date | null;
}

interface RevisionReplayRow extends RowDataPacket {
  readonly id: string;
  readonly sourceId: string;
  readonly revisionNumber: number;
  readonly contentDigest: string;
  readonly capabilities: readonly ResourceSourceCapability[] | string;
  readonly publicationRequestHash: string;
  readonly publishedAt: Date;
}

interface RevisionNumberRow extends RowDataPacket {
  readonly nextRevisionNumber: number;
}

interface ResourceSourceOperationRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly operationId: string;
  readonly sourceId: string;
  readonly operationKind: ResourceSourceOperationKind;
  readonly requestHash: string;
  readonly plannedResourceId: string | null;
  readonly status: "pending" | "succeeded";
  readonly resultSourceVersion: number | null;
  readonly resultReasonCode: string | null;
}

interface ResourceCatalogRow extends RowDataPacket {
  readonly id: string;
  readonly displayName: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly authMode: ResourceSourceAuthMode;
  readonly endpointOrigin: string;
  readonly providerEndpointId: string;
  readonly credentialId: string | null;
  readonly credentialIdentityEpoch: number | null;
  readonly credentialIdentityDigest: string | null;
  readonly activeSecretVersionId: string | null;
  readonly revisionId: string;
  readonly configurationDocument: Readonly<Record<string, unknown>> | string;
  readonly licensePolicy: ResourceLicensePolicy | string;
  readonly capabilities: readonly ResourceSourceCapability[] | string;
}

interface ArtTextPresetRevisionRow extends RowDataPacket {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly externalId: string;
  readonly manifestDigest: string;
  readonly requestHash: string;
  readonly createdAt: Date;
}

interface FontRevisionRow extends RowDataPacket {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly externalId: string;
  readonly family: string;
  readonly contentDigest: string;
  readonly requestHash: string;
  readonly createdAt: Date;
}

interface WorkspaceFontRevisionRow extends RowDataPacket {
  readonly id: string;
  readonly family: string;
  readonly descriptorDocument: Readonly<Record<string, unknown>> | string;
  readonly createdAt: Date;
  readonly artifactId: string;
  readonly format: "otf" | "ttf";
  readonly weight: number;
  readonly style: "italic" | "normal";
  readonly subset: string;
}

interface WorkspaceArtTextPresetRow extends RowDataPacket {
  readonly id: string;
  readonly manifestDocument: ArtTextPresetManifest | string;
  readonly createdAt: Date;
}

function fail(code: ResourceSourceStoreErrorCode, message: string): never {
  throw new ResourceSourceStoreError(code, message);
}

function assertId(value: string, label: string): void {
  if (!idPattern.test(value)) {
    fail("resource_source.invalid_argument", `${label} is invalid.`);
  }
}

function assertText(value: string, label: string, maximumLength: number): void {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    fail("resource_source.invalid_argument", `${label} is invalid.`);
  }
}

function assertVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("resource_source.invalid_argument", `${label} is invalid.`);
  }
}

function assertDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    fail("resource_source.invalid_argument", `${label} is invalid.`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) {
    fail("resource_source.invalid_argument", `${label} is invalid.`);
  }
}

function assertLicensePolicy(policy: ResourceLicensePolicy): void {
  const flags = [
    policy.requireCommercialUse,
    policy.allowAttribution,
    policy.allowShareAlike,
    policy.allowStandaloneRedistributionRestriction,
    policy.allowUnknownModelRelease,
    policy.allowUnknownPropertyRelease,
  ];
  if (
    flags.some((value) => typeof value !== "boolean") ||
    !Array.isArray(policy.allowedLicenseIds) ||
    policy.allowedLicenseIds.length > 64 ||
    new Set(policy.allowedLicenseIds).size !==
      policy.allowedLicenseIds.length ||
    policy.allowedLicenseIds.some(
      (licenseId) => !stableIdentifierPattern.test(licenseId),
    )
  ) {
    fail("resource_source.invalid_argument", "licensePolicy is invalid.");
  }
}

function endpointOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      "resource_source.invalid_argument",
      "endpointOrigin is invalid.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password
  ) {
    return fail(
      "resource_source.invalid_argument",
      "endpointOrigin must be a canonical HTTPS origin.",
    );
  }
  return url.origin;
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function sourceFrom(row: ResourceSourceRow): ResourceSourceRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    adapterKind: row.adapterKind,
    adapterVersion: row.adapterVersion,
    authMode: row.authMode,
    endpointOrigin: row.endpointOrigin,
    providerEndpointId: row.providerEndpointId,
    credentialId: row.credentialId,
    secretConfigured:
      row.authMode === "none" ||
      (row.activeSecretVersionId !== null &&
        row.activeSecretLifecycle === "active"),
    configuration: Object.freeze(parseJson(row.configurationDocument)),
    configurationDigest: row.configurationDigest,
    licensePolicy: Object.freeze(parseJson(row.licensePolicy)),
    lifecycleStatus: row.lifecycleStatus,
    validationStatus: row.validationStatus,
    validationReasonCode: row.validationReasonCode,
    currentRevisionId: row.currentRevisionId,
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    disabledAt: row.disabledAt ? new Date(row.disabledAt) : null,
  });
}

function revisionFrom(row: RevisionReplayRow): ResourceSourceRevisionRecord {
  return Object.freeze({
    id: row.id,
    sourceId: row.sourceId,
    revisionNumber: row.revisionNumber,
    contentDigest: row.contentDigest,
    capabilities: Object.freeze(parseJson(row.capabilities)),
    publishedAt: new Date(row.publishedAt),
  });
}

function authorizationDecision(scope: TrustedWorkspaceScope) {
  return Object.freeze({
    permission: "credential.manage",
    authorityVersion: scope.authorityVersion,
  });
}

async function auditSource(
  connection: PoolConnection,
  options: ResourceSourceCommand,
  event: {
    readonly eventType: string;
    readonly action: string;
    readonly reasonCode: string;
    readonly severity?: "info" | "warning";
    readonly details: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, options.audit, {
    organizationId: options.scope.organizationId,
    workspaceId: options.scope.workspaceId,
    eventType: event.eventType,
    action: event.action,
    resourceType: "resource_source",
    resourceId: options.sourceId,
    outcome: "succeeded",
    decisionReasonCode: event.reasonCode,
    severity: event.severity ?? "info",
    authorizationDecision: authorizationDecision(options.scope),
    details: event.details,
    occurredAt: options.now,
  });
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
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

const sourceSelect = `SELECT
  source.id,
  source.workspace_id AS workspaceId,
  source.display_name AS displayName,
  source.adapter_kind AS adapterKind,
  source.adapter_version AS adapterVersion,
  source.auth_mode AS authMode,
  endpoint.base_url AS endpointOrigin,
  source.provider_endpoint_id AS providerEndpointId,
  source.credential_id AS credentialId,
  credential.active_secret_version_id AS activeSecretVersionId,
  active_secret.lifecycle_status AS activeSecretLifecycle,
  credential.identity_epoch AS credentialIdentityEpoch,
  credential.identity_digest AS credentialIdentityDigest,
  credential.version AS credentialVersion,
  source.configuration_document AS configurationDocument,
  source.configuration_digest AS configurationDigest,
  source.license_policy AS licensePolicy,
  source.lifecycle_status AS lifecycleStatus,
  source.validation_status AS validationStatus,
  source.validation_reason_code AS validationReasonCode,
  source.current_revision_id AS currentRevisionId,
  source.idempotency_key AS idempotencyKey,
  source.request_hash AS requestHash,
  source.version,
  source.created_at AS createdAt,
  source.updated_at AS updatedAt,
  source.disabled_at AS disabledAt
FROM resource_source AS source
INNER JOIN provider_endpoint AS endpoint
  ON endpoint.workspace_id = source.workspace_id
 AND endpoint.id = source.provider_endpoint_id
LEFT JOIN credential
  ON credential.workspace_id = source.workspace_id
 AND credential.id = source.credential_id
LEFT JOIN secret_version AS active_secret
  ON active_secret.workspace_id = credential.workspace_id
 AND active_secret.credential_id = credential.id
 AND active_secret.id = credential.active_secret_version_id`;

const catalogSelect = `SELECT
  source.id,
  source.display_name AS displayName,
  revision.adapter_kind AS adapterKind,
  revision.adapter_version AS adapterVersion,
  source.auth_mode AS authMode,
  endpoint.base_url AS endpointOrigin,
  revision.provider_endpoint_id AS providerEndpointId,
  revision.credential_id AS credentialId,
  credential.identity_epoch AS credentialIdentityEpoch,
  credential.identity_digest AS credentialIdentityDigest,
  credential.active_secret_version_id AS activeSecretVersionId,
  revision.id AS revisionId,
  revision.configuration_document AS configurationDocument,
  revision.license_policy AS licensePolicy,
  revision.capabilities
FROM resource_source AS source
INNER JOIN resource_source_revision AS revision
  ON revision.workspace_id = source.workspace_id
 AND revision.source_id = source.id
 AND revision.id = source.current_revision_id
INNER JOIN provider_endpoint AS endpoint
  ON endpoint.workspace_id = revision.workspace_id
 AND endpoint.id = revision.provider_endpoint_id
LEFT JOIN credential
  ON credential.workspace_id = revision.workspace_id
 AND credential.id = revision.credential_id`;

async function readSource(
  connection: PoolConnection,
  workspaceId: string,
  sourceId: string,
  lock: boolean,
): Promise<ResourceSourceRow> {
  const [rows] = await connection.execute<ResourceSourceRow[]>(
    `${sourceSelect}
WHERE source.workspace_id = ?
  AND source.id = ?
LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, sourceId],
  );
  return (
    rows[0] ??
    fail("resource_source.not_found", "Resource source was not found.")
  );
}

async function readOperation(
  connection: PoolConnection,
  workspaceId: string,
  idempotencyKey: string,
): Promise<ResourceSourceOperationRow | undefined> {
  const [rows] = await connection.execute<ResourceSourceOperationRow[]>(
    `SELECT workspace_id AS workspaceId,
            idempotency_key AS idempotencyKey,
            operation_id AS operationId,
            source_id AS sourceId,
            operation_kind AS operationKind,
            request_hash AS requestHash,
            planned_resource_id AS plannedResourceId,
            status,
            result_source_version AS resultSourceVersion,
            result_reason_code AS resultReasonCode
       FROM resource_source_operation
      WHERE workspace_id = ? AND idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [workspaceId, idempotencyKey],
  );
  return rows[0];
}

function operationClaim(
  source: ResourceSourceRow,
  operation: ResourceSourceOperationRow,
  flags: { readonly replayed: boolean; readonly resumed: boolean },
): ResourceSourceOperationClaim {
  return Object.freeze({
    source: sourceFrom(source),
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    plannedResourceId: operation.plannedResourceId,
    replayed: flags.replayed,
    resumed: flags.resumed,
    resultReasonCode: operation.resultReasonCode,
  });
}

function assertOperationIdentity(
  operation: ResourceSourceOperationRow,
  options: {
    readonly sourceId: string;
    readonly operationId?: string;
    readonly operationKind?: ResourceSourceOperationKind;
    readonly requestHash: string;
  },
): void {
  if (
    operation.sourceId !== options.sourceId ||
    operation.requestHash !== options.requestHash ||
    (options.operationId !== undefined &&
      operation.operationId !== options.operationId) ||
    (options.operationKind !== undefined &&
      operation.operationKind !== options.operationKind)
  ) {
    fail(
      "resource_source.idempotency_conflict",
      "Resource source operation identity was reused with different input.",
    );
  }
}

function assertCreate(options: CreateResourceSourceOptions): {
  readonly endpointOrigin: string;
  readonly configurationDigest: string;
  readonly requestHash: string;
} {
  assertId(options.sourceId, "sourceId");
  assertId(options.providerEndpointId, "providerEndpointId");
  assertText(options.displayName, "displayName", 160);
  assertText(options.adapterKind, "adapterKind", 120);
  assertText(options.adapterVersion, "adapterVersion", 80);
  assertText(options.idempotencyKey, "idempotencyKey", 160);
  assertDate(options.now, "now");
  if (!stableIdentifierPattern.test(options.adapterKind)) {
    fail("resource_source.invalid_argument", "adapterKind is invalid.");
  }
  assertLicensePolicy(options.licensePolicy);
  if (options.authMode === "none") {
    if (options.credentialId) {
      fail(
        "resource_source.invalid_argument",
        "Unauthenticated sources cannot bind a Credential.",
      );
    }
  } else if (!options.credentialId) {
    fail(
      "resource_source.invalid_argument",
      "Authenticated sources require a Credential identity.",
    );
  } else {
    assertId(options.credentialId, "credentialId");
  }
  const configurationDigest = digestProviderValue(options.configuration);
  return Object.freeze({
    endpointOrigin: endpointOrigin(options.endpointOrigin),
    configurationDigest,
    requestHash: digestProviderValue({
      displayName: options.displayName,
      adapterKind: options.adapterKind,
      adapterVersion: options.adapterVersion,
      authMode: options.authMode,
      endpointOrigin: options.endpointOrigin,
      configurationDigest,
      licensePolicy: options.licensePolicy,
    }),
  });
}

async function insertEndpoint(
  connection: PoolConnection,
  options: CreateResourceSourceOptions,
  origin: string,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO provider_endpoint (
       id, workspace_id, endpoint_key, adapter_kind, preset_kind, base_url,
       canonical_origin, base_url_digest, region_code, network_policy,
       data_policy, lifecycle_status, validation_status, validation_digest,
       validated_at, version, created_by_principal_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'resource_catalog', 'none', ?, ?, ?, 'global', ?, ?,
       'active', 'pending', NULL, NULL, 1, ?, ?, ?)`,
    [
      options.providerEndpointId,
      options.scope.workspaceId,
      `resource-source:${options.sourceId}`,
      origin,
      origin,
      digestProviderValue({ origin }),
      JSON.stringify({ allowRedirects: false, canonicalOrigin: origin }),
      JSON.stringify({
        classification: "workspace_configured",
        resourceSourceId: options.sourceId,
      }),
      options.scope.principalId,
      options.now,
      options.now,
    ],
  );
}

async function insertCredential(
  connection: PoolConnection,
  options: CreateResourceSourceOptions,
  origin: string,
): Promise<void> {
  if (!options.credentialId) {
    return;
  }
  const authorityDigest = digestProviderValue({
    sourceId: options.sourceId,
    adapterKind: options.adapterKind,
    authMode: options.authMode,
  });
  const billingIdentityDigest = digestProviderValue({ billing: "unmanaged" });
  const egressIdentityDigest = digestProviderValue({ origin });
  const identityDigest = digestProviderValue({
    authorityDigest,
    billingIdentityDigest,
    egressIdentityDigest,
  });
  await connection.execute<ResultSetHeader>(
    `INSERT INTO credential (
       id, workspace_id, provider_endpoint_id, credential_key, provider_kind,
       authority_digest, billing_identity_digest, egress_identity_digest,
       identity_digest, identity_epoch, material_generation,
       active_secret_version_id, lifecycle_status, version,
       created_by_principal_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, 'active', 1, ?, ?, ?)`,
    [
      options.credentialId,
      options.scope.workspaceId,
      options.providerEndpointId,
      `resource-source:${options.sourceId}`,
      options.adapterKind,
      authorityDigest,
      billingIdentityDigest,
      egressIdentityDigest,
      identityDigest,
      options.scope.principalId,
      options.now,
      options.now,
    ],
  );
}

export function createResourceSourceStore(pool: Pool): ResourceSourceStore {
  return Object.freeze({
    async list(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly ResourceSourceRecord[]> {
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<ResourceSourceRow[]>(
          `${sourceSelect}
WHERE source.workspace_id = ?
ORDER BY source.updated_at DESC, source.id ASC
LIMIT 200`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map(sourceFrom));
      });
    },

    async listPublished(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly ResourceCatalogSourceRecord[]> {
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "asset.read",
          now,
        );
        const [rows] = await connection.execute<ResourceCatalogRow[]>(
          `${catalogSelect}
WHERE source.workspace_id = ?
  AND source.lifecycle_status = 'published'
  AND endpoint.lifecycle_status = 'active'
ORDER BY source.display_name ASC, source.id ASC
LIMIT 200`,
          [scope.workspaceId],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              id: row.id,
              displayName: row.displayName,
              adapterKind: row.adapterKind,
              revisionId: row.revisionId,
              capabilities: Object.freeze(parseJson(row.capabilities)),
            }),
          ),
        );
      });
    },

    async resolveCatalogIdentity(
      scope: TrustedWorkspaceScope,
      sourceId: string,
      sourceRevisionId: string | undefined,
      now: Date,
    ): Promise<ResourceCatalogRuntimeIdentity> {
      assertId(sourceId, "sourceId");
      if (sourceRevisionId) assertId(sourceRevisionId, "sourceRevisionId");
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "asset.read",
          now,
        );
        const revisionPredicate = sourceRevisionId
          ? "AND revision.id = ?"
          : "AND revision.id = source.current_revision_id";
        const [rows] = await connection.execute<ResourceCatalogRow[]>(
          `${catalogSelect.replace(
            " AND revision.id = source.current_revision_id",
            "",
          )}
WHERE source.workspace_id = ?
  AND source.id = ?
  AND source.lifecycle_status = 'published'
  AND endpoint.lifecycle_status = 'active'
  ${revisionPredicate}
LIMIT 1`,
          [
            scope.workspaceId,
            sourceId,
            ...(sourceRevisionId ? [sourceRevisionId] : []),
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "resource_source.not_found",
            "Published resource source was not found.",
          );
        }
        const common = {
          id: row.id,
          displayName: row.displayName,
          adapterKind: row.adapterKind,
          adapterVersion: row.adapterVersion,
          revisionId: row.revisionId,
          endpointOrigin: row.endpointOrigin,
          configuration: Object.freeze(parseJson(row.configurationDocument)),
          licensePolicy: Object.freeze(parseJson(row.licensePolicy)),
          capabilities: Object.freeze(parseJson(row.capabilities)),
        };
        if (row.authMode === "none") {
          return Object.freeze(common);
        }
        if (
          !row.credentialId ||
          !row.activeSecretVersionId ||
          !row.credentialIdentityEpoch ||
          !row.credentialIdentityDigest
        ) {
          return fail(
            "resource_source.secret_not_ready",
            "Published resource source credential is unavailable.",
          );
        }
        const secret = await loadPinnedSecretVersionMetadataInTransaction(
          connection,
          {
            workspaceId: scope.workspaceId,
            credentialId: row.credentialId,
            pinnedSecretVersionId: row.activeSecretVersionId,
            expectedCredentialIdentityEpoch: row.credentialIdentityEpoch,
            expectedCredentialIdentityDigest: row.credentialIdentityDigest,
            expectedProviderEndpointId: row.providerEndpointId,
            now,
          },
        );
        return Object.freeze({ ...common, secret });
      });
    },

    async get(
      scope: TrustedWorkspaceScope,
      sourceId: string,
      now: Date,
    ): Promise<ResourceSourceRecord> {
      assertId(sourceId, "sourceId");
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        return sourceFrom(
          await readSource(connection, scope.workspaceId, sourceId, false),
        );
      });
    },

    async resolveValidationIdentity(
      scope: TrustedWorkspaceScope,
      sourceId: string,
      now: Date,
    ): Promise<ResourceSourceValidationIdentity> {
      assertId(sourceId, "sourceId");
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const source = await readSource(
          connection,
          scope.workspaceId,
          sourceId,
          false,
        );
        if (source.authMode === "none") {
          return Object.freeze({ source: sourceFrom(source) });
        }
        if (
          !source.credentialId ||
          !source.activeSecretVersionId ||
          !source.credentialIdentityEpoch ||
          !source.credentialIdentityDigest
        ) {
          return fail(
            "resource_source.secret_not_ready",
            "Resource source credential does not have an active SecretVersion.",
          );
        }
        const secret = await loadPinnedSecretVersionMetadataInTransaction(
          connection,
          {
            workspaceId: scope.workspaceId,
            credentialId: source.credentialId,
            pinnedSecretVersionId: source.activeSecretVersionId,
            expectedCredentialIdentityEpoch: source.credentialIdentityEpoch,
            expectedCredentialIdentityDigest: source.credentialIdentityDigest,
            expectedProviderEndpointId: source.providerEndpointId,
            now,
          },
        );
        return Object.freeze({ source: sourceFrom(source), secret });
      });
    },

    async resolveSecretWriteIdentity(
      scope: TrustedWorkspaceScope,
      sourceId: string,
      expectedSourceVersion: number,
      now: Date,
    ): Promise<ResourceSourceSecretWriteIdentity> {
      assertId(sourceId, "sourceId");
      assertVersion(expectedSourceVersion, "expectedSourceVersion");
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const source = await readSource(
          connection,
          scope.workspaceId,
          sourceId,
          false,
        );
        if (source.version !== expectedSourceVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before credential rotation.",
          );
        }
        if (
          source.lifecycleStatus === "disabled" ||
          source.authMode === "none" ||
          !source.credentialId ||
          !source.credentialVersion
        ) {
          return fail(
            "resource_source.lifecycle_conflict",
            "Resource source cannot rotate credentials in its current state.",
          );
        }
        return Object.freeze({
          source: sourceFrom(source),
          credentialId: source.credentialId,
          credentialVersion: source.credentialVersion,
        });
      });
    },

    async claimOperation(
      options: ClaimResourceSourceOperationOptions,
    ): Promise<ResourceSourceOperationClaim> {
      assertId(options.sourceId, "sourceId");
      assertId(options.operationId, "operationId");
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      assertDigest(options.requestHash, "requestHash");
      assertVersion(options.expectedSourceVersion, "expectedSourceVersion");
      assertDate(options.now, "now");
      if (!resourceSourceOperationKinds.has(options.operationKind)) {
        fail("resource_source.invalid_argument", "operationKind is invalid.");
      }
      if (options.plannedResourceId) {
        assertId(options.plannedResourceId, "plannedResourceId");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        const existing = await readOperation(
          connection,
          options.scope.workspaceId,
          options.idempotencyKey,
        );
        if (existing) {
          assertOperationIdentity(existing, {
            sourceId: options.sourceId,
            operationKind: options.operationKind,
            requestHash: options.requestHash,
          });
          return operationClaim(source, existing, {
            replayed: existing.status === "succeeded",
            resumed: existing.status === "pending",
          });
        }
        if (source.version !== options.expectedSourceVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before the operation began.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO resource_source_operation (
             workspace_id, idempotency_key, operation_id, source_id,
             operation_kind, request_hash, planned_resource_id, status,
             result_source_version, result_reason_code, created_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)`,
          [
            options.scope.workspaceId,
            options.idempotencyKey,
            options.operationId,
            options.sourceId,
            options.operationKind,
            options.requestHash,
            options.plannedResourceId ?? null,
            options.now,
          ],
        );
        return Object.freeze({
          source: sourceFrom(source),
          operationId: options.operationId,
          operationKind: options.operationKind,
          plannedResourceId: options.plannedResourceId ?? null,
          replayed: false,
          resumed: false,
          resultReasonCode: null,
        });
      });
    },

    async completeOperation(
      options: CompleteResourceSourceOperationOptions,
    ): Promise<ResourceSourceOperationClaim> {
      assertId(options.sourceId, "sourceId");
      assertId(options.operationId, "operationId");
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      assertDigest(options.requestHash, "requestHash");
      assertVersion(options.resultSourceVersion, "resultSourceVersion");
      assertText(options.resultReasonCode, "resultReasonCode", 120);
      assertDate(options.now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        const operation = await readOperation(
          connection,
          options.scope.workspaceId,
          options.idempotencyKey,
        );
        if (!operation) {
          return fail(
            "resource_source.not_found",
            "Resource source operation was not found.",
          );
        }
        assertOperationIdentity(operation, options);
        if (operation.status === "succeeded") {
          return operationClaim(source, operation, {
            replayed: true,
            resumed: false,
          });
        }
        if (source.version !== options.resultSourceVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source result changed before operation completion.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE resource_source_operation
              SET status = 'succeeded', result_source_version = ?,
                  result_reason_code = ?, completed_at = ?
            WHERE workspace_id = ? AND idempotency_key = ?
              AND operation_id = ? AND status = 'pending'`,
          [
            options.resultSourceVersion,
            options.resultReasonCode,
            options.now,
            options.scope.workspaceId,
            options.idempotencyKey,
            options.operationId,
          ],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "resource_source.idempotency_conflict",
            "Resource source operation completion lost its compare-and-swap.",
          );
        }
        return Object.freeze({
          source: sourceFrom(source),
          operationId: operation.operationId,
          operationKind: operation.operationKind,
          plannedResourceId: operation.plannedResourceId,
          replayed: false,
          resumed: false,
          resultReasonCode: options.resultReasonCode,
        });
      });
    },

    async createDraft(
      options: CreateResourceSourceOptions,
    ): Promise<ResourceSourceMutation<ResourceSourceRecord>> {
      const input = assertCreate(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const [existingRows] = await connection.execute<ResourceSourceRow[]>(
          `${sourceSelect}
WHERE source.workspace_id = ?
  AND source.idempotency_key = ?
LIMIT 1`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const existing = existingRows[0];
        if (existing) {
          if (existing.requestHash !== input.requestHash) {
            return fail(
              "resource_source.idempotency_conflict",
              "Resource source idempotency key was reused with different input.",
            );
          }
          return Object.freeze({ replayed: true, value: sourceFrom(existing) });
        }
        await insertEndpoint(connection, options, input.endpointOrigin);
        await insertCredential(connection, options, input.endpointOrigin);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO resource_source (
             id, workspace_id, display_name, adapter_kind, adapter_version,
             auth_mode, provider_endpoint_id, credential_id,
             configuration_document, configuration_digest, license_policy,
             lifecycle_status, validation_status, validation_digest,
             validation_reason_code, validated_at, current_revision_id,
             idempotency_key, request_hash, version,
             created_by_principal_id, updated_by_principal_id,
             created_at, updated_at, disabled_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft',
             'not_checked', NULL, NULL, NULL, NULL, ?, ?, 1, ?, ?, ?, ?, NULL)`,
          [
            options.sourceId,
            options.scope.workspaceId,
            options.displayName,
            options.adapterKind,
            options.adapterVersion,
            options.authMode,
            options.providerEndpointId,
            options.credentialId ?? null,
            JSON.stringify(options.configuration),
            input.configurationDigest,
            JSON.stringify(options.licensePolicy),
            options.idempotencyKey,
            input.requestHash,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await auditSource(connection, options, {
          eventType: "resource_source.created",
          action: "create",
          reasonCode: "resource_source.draft_created",
          details: {
            adapterKind: options.adapterKind,
            authMode: options.authMode,
            providerEndpointId: options.providerEndpointId,
          },
        });
        const value: ResourceSourceRecord = Object.freeze({
          id: options.sourceId,
          workspaceId: options.scope.workspaceId,
          displayName: options.displayName,
          adapterKind: options.adapterKind,
          adapterVersion: options.adapterVersion,
          authMode: options.authMode,
          endpointOrigin: input.endpointOrigin,
          providerEndpointId: options.providerEndpointId,
          credentialId: options.credentialId ?? null,
          secretConfigured: options.authMode === "none",
          configuration: Object.freeze(options.configuration),
          configurationDigest: input.configurationDigest,
          licensePolicy: Object.freeze(options.licensePolicy),
          lifecycleStatus: "draft",
          validationStatus: "not_checked",
          validationReasonCode: null,
          currentRevisionId: null,
          version: 1,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
          disabledAt: null,
        });
        return Object.freeze({ replayed: false, value });
      });
    },

    async recordValidation(
      options: RecordResourceSourceValidationOptions,
    ): Promise<ResourceSourceRecord> {
      assertId(options.sourceId, "sourceId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertDate(options.now, "now");
      if (!digestPattern.test(options.validationDigest)) {
        fail(
          "resource_source.invalid_argument",
          "validationDigest is invalid.",
        );
      }
      assertText(options.reasonCode, "reasonCode", 120);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        if (source.version !== options.expectedVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before validation completed.",
          );
        }
        if (source.lifecycleStatus === "published") {
          return fail(
            "resource_source.lifecycle_conflict",
            "Resource source cannot be validated in its current state.",
          );
        }
        if (
          options.outcome === "passed" &&
          source.authMode !== "none" &&
          (source.activeSecretVersionId === null ||
            source.activeSecretLifecycle !== "active")
        ) {
          return fail(
            "resource_source.secret_not_ready",
            "Resource source credential does not have an active SecretVersion.",
          );
        }
        const lifecycleStatus =
          options.outcome === "passed" ? "ready" : "failed";
        await connection.execute<ResultSetHeader>(
          `UPDATE resource_source
             SET lifecycle_status = ?,
                 validation_status = ?,
                 validation_digest = ?,
                 validation_reason_code = ?,
                 validated_at = ?,
                 disabled_at = NULL,
                 version = version + 1,
                 updated_by_principal_id = ?,
                 updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            lifecycleStatus,
            options.outcome,
            options.validationDigest,
            options.reasonCode,
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.sourceId,
            source.version,
          ],
        );
        const [endpointUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_endpoint
             SET lifecycle_status = CASE WHEN ? = 'passed' THEN 'active' ELSE lifecycle_status END,
                 validation_status = ?, validation_digest = ?, validated_at = ?,
                 version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND lifecycle_status <> 'revoked'`,
          [
            options.outcome,
            options.outcome,
            options.validationDigest,
            options.now,
            options.now,
            options.scope.workspaceId,
            source.providerEndpointId,
          ],
        );
        if (endpointUpdated.affectedRows !== 1) {
          return fail(
            "resource_source.lifecycle_conflict",
            "A revoked or missing Provider endpoint cannot be revalidated.",
          );
        }
        await auditSource(connection, options, {
          eventType: "resource_source.validation_recorded",
          action: "validate",
          reasonCode: options.reasonCode,
          severity: options.outcome === "failed" ? "warning" : "info",
          details: {
            outcome: options.outcome,
            previousVersion: source.version,
            nextVersion: source.version + 1,
          },
        });
        return Object.freeze({
          ...sourceFrom(source),
          lifecycleStatus,
          validationStatus: options.outcome,
          validationReasonCode: options.reasonCode,
          disabledAt: null,
          version: source.version + 1,
          updatedAt: new Date(options.now),
        });
      });
    },

    async publish(
      options: PublishResourceSourceOptions,
    ): Promise<ResourceSourceMutation<ResourceSourceRevisionRecord>> {
      assertId(options.sourceId, "sourceId");
      assertId(options.sourceRevisionId, "sourceRevisionId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      assertDate(options.now, "now");
      if (
        options.capabilities.length < 1 ||
        options.capabilities.length > 8 ||
        new Set(options.capabilities).size !== options.capabilities.length ||
        options.capabilities.some(
          (capability) => !resourceSourceCapabilities.has(capability),
        )
      ) {
        fail("resource_source.invalid_argument", "capabilities are invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        const contentDigest = digestProviderValue({
          schemaVersion: 1,
          adapterKind: source.adapterKind,
          adapterVersion: source.adapterVersion,
          providerEndpointId: source.providerEndpointId,
          credentialId: source.credentialId,
          configurationDigest: source.configurationDigest,
          capabilities: options.capabilities,
          licensePolicy: parseJson(source.licensePolicy),
        });
        const requestHash = digestProviderValue({
          sourceId: options.sourceId,
          sourceRevisionId: options.sourceRevisionId,
          expectedVersion: options.expectedVersion,
          contentDigest,
        });
        const [replayRows] = await connection.execute<RevisionReplayRow[]>(
          `SELECT id, source_id AS sourceId, revision_number AS revisionNumber,
                  content_digest AS contentDigest, capabilities,
                  publication_request_hash AS publicationRequestHash,
                  published_at AS publishedAt
             FROM resource_source_revision
            WHERE workspace_id = ? AND publication_request_key = ?
            LIMIT 1`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (replay.publicationRequestHash !== requestHash) {
            return fail(
              "resource_source.idempotency_conflict",
              "Publication idempotency key was reused with different input.",
            );
          }
          return Object.freeze({ replayed: true, value: revisionFrom(replay) });
        }
        const [contentRows] = await connection.execute<RevisionReplayRow[]>(
          `SELECT id, source_id AS sourceId, revision_number AS revisionNumber,
                  content_digest AS contentDigest, capabilities,
                  publication_request_hash AS publicationRequestHash,
                  published_at AS publishedAt
             FROM resource_source_revision
            WHERE workspace_id = ? AND source_id = ? AND content_digest = ?
            LIMIT 1`,
          [options.scope.workspaceId, options.sourceId, contentDigest],
        );
        const existingContent = contentRows[0];
        if (
          existingContent &&
          source.lifecycleStatus === "published" &&
          source.currentRevisionId === existingContent.id
        ) {
          return Object.freeze({
            replayed: true,
            value: revisionFrom(existingContent),
          });
        }
        if (source.version !== options.expectedVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before publication.",
          );
        }
        if (
          source.lifecycleStatus !== "ready" ||
          source.validationStatus !== "passed"
        ) {
          return fail(
            "resource_source.lifecycle_conflict",
            "Only a validated ready resource source can be published.",
          );
        }
        if (existingContent) {
          await connection.execute<ResultSetHeader>(
            `UPDATE resource_source
                SET lifecycle_status = 'published', current_revision_id = ?,
                    version = version + 1, updated_by_principal_id = ?,
                    updated_at = ?
              WHERE workspace_id = ? AND id = ? AND version = ?`,
            [
              existingContent.id,
              options.scope.principalId,
              options.now,
              options.scope.workspaceId,
              options.sourceId,
              source.version,
            ],
          );
          await auditSource(connection, options, {
            eventType: "resource_source.published",
            action: "publish",
            reasonCode: "resource_source.revision_reactivated",
            details: {
              sourceRevisionId: existingContent.id,
              revisionNumber: existingContent.revisionNumber,
              previousVersion: source.version,
              nextVersion: source.version + 1,
            },
          });
          return Object.freeze({
            replayed: true,
            value: revisionFrom(existingContent),
          });
        }
        const [numberRows] = await connection.execute<RevisionNumberRow[]>(
          `SELECT COALESCE(MAX(revision_number), 0) + 1 AS nextRevisionNumber
             FROM resource_source_revision
            WHERE workspace_id = ? AND source_id = ?`,
          [options.scope.workspaceId, options.sourceId],
        );
        const revisionNumber = Number(numberRows[0]?.nextRevisionNumber ?? 1);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO resource_source_revision (
             id, workspace_id, source_id, revision_number, schema_version,
             adapter_kind, adapter_version, provider_endpoint_id, credential_id,
             configuration_document, configuration_digest, capabilities,
             license_policy, content_digest, publication_request_key,
             publication_request_hash, published_by_principal_id, published_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.sourceRevisionId,
            options.scope.workspaceId,
            options.sourceId,
            revisionNumber,
            source.adapterKind,
            source.adapterVersion,
            source.providerEndpointId,
            source.credentialId,
            JSON.stringify(parseJson(source.configurationDocument)),
            source.configurationDigest,
            JSON.stringify(options.capabilities),
            JSON.stringify(parseJson(source.licensePolicy)),
            contentDigest,
            options.idempotencyKey,
            requestHash,
            options.scope.principalId,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE resource_source
             SET lifecycle_status = 'published', current_revision_id = ?,
                 version = version + 1, updated_by_principal_id = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.sourceRevisionId,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.sourceId,
            source.version,
          ],
        );
        await auditSource(connection, options, {
          eventType: "resource_source.published",
          action: "publish",
          reasonCode: "resource_source.revision_published",
          details: {
            sourceRevisionId: options.sourceRevisionId,
            revisionNumber,
            previousVersion: source.version,
            nextVersion: source.version + 1,
          },
        });
        return Object.freeze({
          replayed: false,
          value: Object.freeze({
            id: options.sourceRevisionId,
            sourceId: options.sourceId,
            revisionNumber,
            contentDigest,
            capabilities: Object.freeze([...options.capabilities]),
            publishedAt: new Date(options.now),
          }),
        });
      });
    },

    async disable(
      options: DisableResourceSourceOptions,
    ): Promise<ResourceSourceRecord> {
      assertId(options.sourceId, "sourceId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertDate(options.now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        if (source.version !== options.expectedVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before disablement.",
          );
        }
        if (source.lifecycleStatus === "disabled") {
          return sourceFrom(source);
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE resource_source
             SET lifecycle_status = 'disabled', disabled_at = ?,
                 version = version + 1, updated_by_principal_id = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.sourceId,
            source.version,
          ],
        );
        await auditSource(connection, options, {
          eventType: "resource_source.disabled",
          action: "disable",
          reasonCode: "resource_source.disabled",
          severity: "warning",
          details: {
            previousVersion: source.version,
            nextVersion: source.version + 1,
            historicalRevisionRetained: source.currentRevisionId !== null,
          },
        });
        return Object.freeze({
          ...sourceFrom(source),
          lifecycleStatus: "disabled",
          version: source.version + 1,
          updatedAt: new Date(options.now),
          disabledAt: new Date(options.now),
        });
      });
    },

    async recordSecretRotation(
      options: RecordResourceSourceSecretRotationOptions,
    ): Promise<ResourceSourceRecord> {
      assertId(options.sourceId, "sourceId");
      assertId(options.secretVersionId, "secretVersionId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertDate(options.now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const source = await readSource(
          connection,
          options.scope.workspaceId,
          options.sourceId,
          true,
        );
        if (source.version !== options.expectedVersion) {
          return fail(
            "resource_source.version_conflict",
            "Resource source changed before credential rotation was recorded.",
          );
        }
        if (source.authMode === "none" || !source.credentialId) {
          return fail(
            "resource_source.lifecycle_conflict",
            "Unauthenticated resource sources cannot rotate credentials.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE resource_source
              SET version = version + 1, updated_by_principal_id = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            options.sourceId,
            source.version,
          ],
        );
        await auditSource(connection, options, {
          eventType: "resource_source.credential_rotated",
          action: "rotate_credential",
          reasonCode: "resource_source.credential_rotated",
          details: {
            credentialId: source.credentialId,
            secretVersionId: options.secretVersionId,
            previousVersion: source.version,
            nextVersion: source.version + 1,
          },
        });
        return Object.freeze({
          ...sourceFrom(source),
          secretConfigured: true,
          version: source.version + 1,
          updatedAt: new Date(options.now),
        });
      });
    },

    async adoptArtTextPreset(
      options: AdoptArtTextPresetOptions,
    ): Promise<ResourceSourceMutation<ArtTextPresetRevisionRecord>> {
      assertId(options.sourceId, "sourceId");
      assertId(options.sourceRevisionId, "sourceRevisionId");
      assertId(options.artTextPresetRevisionId, "artTextPresetRevisionId");
      assertText(options.externalId, "externalId", 500);
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      assertDate(options.now, "now");
      if (
        options.manifest.schemaVersion !== 1 ||
        !digestPattern.test(options.manifest.revision)
      ) {
        return fail(
          "resource_source.invalid_argument",
          "Art Text manifest identity is invalid.",
        );
      }
      const manifestDigest = digestProviderValue(options.manifest);
      const requestHash = digestProviderValue({
        sourceId: options.sourceId,
        sourceRevisionId: options.sourceRevisionId,
        externalId: options.externalId,
        manifestDigest,
        provenance: options.provenance,
      });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "asset.write",
          options.now,
        );
        const [replayRows] = await connection.execute<
          ArtTextPresetRevisionRow[]
        >(
          `SELECT id, source_id AS sourceId,
                  source_revision_id AS sourceRevisionId,
                  external_id AS externalId,
                  manifest_digest AS manifestDigest,
                  request_hash AS requestHash,
                  created_at AS createdAt
             FROM art_text_preset_revision
            WHERE workspace_id = ? AND idempotency_key = ?
            LIMIT 1`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (replay.requestHash !== requestHash) {
            return fail(
              "resource_source.idempotency_conflict",
              "Art Text adoption identity was reused with different input.",
            );
          }
          return Object.freeze({
            replayed: true,
            value: Object.freeze({
              id: replay.id,
              sourceId: replay.sourceId,
              sourceRevisionId: replay.sourceRevisionId,
              externalId: replay.externalId,
              manifestDigest: replay.manifestDigest,
              createdAt: new Date(replay.createdAt),
            }),
          });
        }
        const [sourceRows] = await connection.execute<RowDataPacket[]>(
          `SELECT revision.id
             FROM resource_source_revision AS revision
             INNER JOIN resource_source AS source
               ON source.workspace_id = revision.workspace_id
              AND source.id = revision.source_id
            WHERE revision.workspace_id = ?
              AND revision.source_id = ?
              AND revision.id = ?
              AND source.lifecycle_status = 'published'
            LIMIT 1
            FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.sourceId,
            options.sourceRevisionId,
          ],
        );
        if (!sourceRows[0]) {
          return fail(
            "resource_source.not_found",
            "Published Art Text source revision was not found.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO art_text_preset_revision (
             id, workspace_id, source_id, source_revision_id, external_id,
             schema_version, manifest_document, manifest_digest,
             provenance_document, idempotency_key, request_hash,
             created_by_principal_id, created_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.artTextPresetRevisionId,
            options.scope.workspaceId,
            options.sourceId,
            options.sourceRevisionId,
            options.externalId,
            JSON.stringify(options.manifest),
            manifestDigest,
            JSON.stringify(options.provenance),
            options.idempotencyKey,
            requestHash,
            options.scope.principalId,
            options.now,
          ],
        );
        await auditSource(connection, options, {
          eventType: "art_text_preset_revision.adopted",
          action: "adopt_art_text",
          reasonCode: "art_text_preset_revision.adopted",
          details: {
            artTextPresetRevisionId: options.artTextPresetRevisionId,
            sourceRevisionId: options.sourceRevisionId,
            manifestDigest,
          },
        });
        return Object.freeze({
          replayed: false,
          value: Object.freeze({
            id: options.artTextPresetRevisionId,
            sourceId: options.sourceId,
            sourceRevisionId: options.sourceRevisionId,
            externalId: options.externalId,
            manifestDigest,
            createdAt: new Date(options.now),
          }),
        });
      });
    },

    async adoptFontRevision(
      options: AdoptFontRevisionOptions,
    ): Promise<ResourceSourceMutation<FontRevisionRecord>> {
      assertId(options.sourceId, "sourceId");
      assertId(options.sourceRevisionId, "sourceRevisionId");
      assertId(options.fontRevisionId, "fontRevisionId");
      assertText(options.externalId, "externalId", 500);
      assertText(options.family, "family", 240);
      assertText(options.upstreamVersion, "upstreamVersion", 80);
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      assertDate(options.now, "now");
      if (
        options.files.length < 1 ||
        options.files.length > 4 ||
        new Set(options.files.map((file) => file.artifactId)).size !==
          options.files.length
      ) {
        return fail(
          "resource_source.invalid_argument",
          "Font Revision files are invalid.",
        );
      }
      for (const file of options.files) {
        assertId(file.artifactId, "artifactId");
        assertText(file.subset, "subset", 80);
        if (
          (file.format !== "ttf" && file.format !== "otf") ||
          (file.style !== "normal" && file.style !== "italic") ||
          !Number.isSafeInteger(file.weight) ||
          file.weight < 1 ||
          file.weight > 1_000
        ) {
          return fail(
            "resource_source.invalid_argument",
            "Font Revision file metadata is invalid.",
          );
        }
      }
      const contentDigest = digestProviderValue({
        descriptor: options.descriptor,
        files: options.files,
      });
      const requestHash = digestProviderValue({
        sourceId: options.sourceId,
        sourceRevisionId: options.sourceRevisionId,
        externalId: options.externalId,
        family: options.family,
        upstreamVersion: options.upstreamVersion,
        contentDigest,
      });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "asset.write",
          options.now,
        );
        const [replayRows] = await connection.execute<FontRevisionRow[]>(
          `SELECT id, source_id AS sourceId,
                  source_revision_id AS sourceRevisionId,
                  external_id AS externalId, family,
                  content_digest AS contentDigest,
                  request_hash AS requestHash,
                  created_at AS createdAt
             FROM font_revision
            WHERE workspace_id = ? AND idempotency_key = ?
            LIMIT 1`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (replay.requestHash !== requestHash) {
            return fail(
              "resource_source.idempotency_conflict",
              "Font adoption identity was reused with different input.",
            );
          }
          return Object.freeze({
            replayed: true,
            value: Object.freeze({
              id: replay.id,
              sourceId: replay.sourceId,
              sourceRevisionId: replay.sourceRevisionId,
              externalId: replay.externalId,
              family: replay.family,
              contentDigest: replay.contentDigest,
              createdAt: new Date(replay.createdAt),
            }),
          });
        }
        const [sourceRows] = await connection.execute<RowDataPacket[]>(
          `SELECT revision.id
             FROM resource_source_revision AS revision
             INNER JOIN resource_source AS source
               ON source.workspace_id = revision.workspace_id
              AND source.id = revision.source_id
            WHERE revision.workspace_id = ?
              AND revision.source_id = ?
              AND revision.id = ?
              AND source.lifecycle_status = 'published'
            LIMIT 1
            FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.sourceId,
            options.sourceRevisionId,
          ],
        );
        if (!sourceRows[0]) {
          return fail(
            "resource_source.not_found",
            "Published Font source revision was not found.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO font_revision (
             id, workspace_id, source_id, source_revision_id, external_id,
             family, upstream_version, descriptor_document, content_digest,
             idempotency_key, request_hash, created_by_principal_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.fontRevisionId,
            options.scope.workspaceId,
            options.sourceId,
            options.sourceRevisionId,
            options.externalId,
            options.family,
            options.upstreamVersion,
            JSON.stringify(options.descriptor),
            contentDigest,
            options.idempotencyKey,
            requestHash,
            options.scope.principalId,
            options.now,
          ],
        );
        for (const [position, file] of options.files.entries()) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO font_revision_file (
               workspace_id, font_revision_id, variant_key, artifact_id,
               format, weight, style, subset, position
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              options.scope.workspaceId,
              options.fontRevisionId,
              `${String(file.weight)}.${file.style}.${file.subset}`,
              file.artifactId,
              file.format,
              file.weight,
              file.style,
              file.subset,
              position,
            ],
          );
        }
        await auditSource(connection, options, {
          eventType: "font_revision.adopted",
          action: "adopt_font",
          reasonCode: "font_revision.adopted",
          details: {
            fontRevisionId: options.fontRevisionId,
            sourceRevisionId: options.sourceRevisionId,
            contentDigest,
            fileCount: options.files.length,
          },
        });
        return Object.freeze({
          replayed: false,
          value: Object.freeze({
            id: options.fontRevisionId,
            sourceId: options.sourceId,
            sourceRevisionId: options.sourceRevisionId,
            externalId: options.externalId,
            family: options.family,
            contentDigest,
            createdAt: new Date(options.now),
          }),
        });
      });
    },

    async listFontRevisions(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly WorkspaceFontRevisionRecord[]> {
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "asset.read",
          now,
        );
        const [rows] = await connection.execute<WorkspaceFontRevisionRow[]>(
          `SELECT revision.id, revision.family,
                  revision.descriptor_document AS descriptorDocument,
                  revision.created_at AS createdAt,
                  file.artifact_id AS artifactId,
                  file.format, file.weight, file.style, file.subset
             FROM font_revision AS revision
             INNER JOIN font_revision_file AS file
               ON file.workspace_id = revision.workspace_id
              AND file.font_revision_id = revision.id
            WHERE revision.workspace_id = ?
            ORDER BY revision.created_at DESC, revision.id ASC, file.position ASC
            LIMIT 2000`,
          [scope.workspaceId],
        );
        const grouped = new Map<string, WorkspaceFontRevisionRecord>();
        for (const row of rows) {
          const descriptor = parseJson(row.descriptorDocument);
          const category = descriptor.category;
          const scripts = descriptor.scripts;
          const languages = descriptor.languages;
          const license = descriptor.license;
          if (
            (category !== "sans" &&
              category !== "serif" &&
              category !== "display" &&
              category !== "handwriting" &&
              category !== "monospace" &&
              category !== "other") ||
            !Array.isArray(scripts) ||
            !scripts.every((value) => typeof value === "string") ||
            !Array.isArray(languages) ||
            !languages.every((value) => typeof value === "string") ||
            !license ||
            typeof license !== "object" ||
            Array.isArray(license)
          ) {
            return fail(
              "resource_source.lifecycle_conflict",
              "Stored Font Revision descriptor is invalid.",
            );
          }
          const file: FontRevisionFileInput = Object.freeze({
            artifactId: row.artifactId,
            format: row.format,
            weight: row.weight,
            style: row.style,
            subset: row.subset,
          });
          const existing = grouped.get(row.id);
          if (existing) {
            grouped.set(
              row.id,
              Object.freeze({
                ...existing,
                files: Object.freeze([...existing.files, file]),
              }),
            );
          } else {
            grouped.set(
              row.id,
              Object.freeze({
                id: row.id,
                family: row.family,
                category,
                scripts: Object.freeze([...scripts] as string[]),
                languages: Object.freeze([...languages] as string[]),
                license: Object.freeze(
                  license as Readonly<Record<string, unknown>>,
                ),
                files: Object.freeze([file]),
                createdAt: new Date(row.createdAt),
              }),
            );
          }
        }
        return Object.freeze([...grouped.values()].slice(0, 500));
      });
    },

    async listArtTextPresets(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly WorkspaceArtTextPresetRecord[]> {
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "asset.read",
          now,
        );
        const [rows] = await connection.execute<WorkspaceArtTextPresetRow[]>(
          `SELECT id, manifest_document AS manifestDocument,
                  created_at AS createdAt
             FROM art_text_preset_revision
            WHERE workspace_id = ?
            ORDER BY created_at DESC, id ASC
            LIMIT 500`,
          [scope.workspaceId],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              id: row.id,
              manifest: Object.freeze(parseJson(row.manifestDocument)),
              createdAt: new Date(row.createdAt),
            }),
          ),
        );
      });
    },
  });
}
