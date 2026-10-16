import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ModelResourceFormat,
  ModelResourceLicense,
  ModelResourceManifest,
  ModelResourceNativeInterface,
  ModelResourceSourceProvenance,
} from "@kanvas/contracts/api";
import type {
  LocalizedTextV1,
  ModelResourceCatalogAssetV1,
  RuntimeAdapterDefinitionRevision,
} from "@kanvas/contracts/capability";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
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
import type { UploadSessionRecord } from "./storage-upload-store.js";
import { reconcileCatalogRuntimeInTransaction } from "./catalog-runtime-reconciler.js";
import { digestProviderValue } from "./provider-value-digest.js";

export type ModelResourceImportStatus =
  | "waiting_upload"
  | "fetching"
  | "analyzing"
  | "needs_input"
  | "ready"
  | "published"
  | "failed"
  | "cancelled";

export interface CompatibleRuntimeAdapter {
  readonly adapterKey: string;
  readonly displayName: LocalizedTextV1;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly executionTarget: "browser" | "worker" | "provider";
  readonly confidence: "exact" | "probable";
  readonly reasonCode: string;
}

export interface ModelResourceImportFailure {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface ModelResourceImportFileRecord {
  readonly path: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly immutableIdentityHash: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

export interface ModelResourceImportRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly sourceKind: "url" | "upload";
  readonly source: ModelResourceSourceProvenance;
  readonly catalogEntryId?: string;
  readonly catalogDocument?: ModelResourceCatalogAssetV1;
  readonly expectedByteSize?: string;
  readonly downloadedBytes: string;
  readonly cancelRequestedAt?: Date;
  readonly uploadSessionId: string;
  readonly uploadExpiresAt: Date;
  readonly status: ModelResourceImportStatus;
  readonly suggestedKey?: string;
  readonly suggestedDisplayName?: string;
  readonly format?: ModelResourceFormat;
  readonly license?: ModelResourceLicense;
  readonly nativeInterface?: ModelResourceNativeInterface;
  readonly compatibleAdapters: readonly CompatibleRuntimeAdapter[];
  readonly requiredUserInputs: readonly string[];
  readonly failure?: ModelResourceImportFailure;
  readonly files: readonly ModelResourceImportFileRecord[];
  readonly publishedModelResourceRevisionId?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CatalogModelResourcePublication {
  readonly key: string;
  readonly revision: number;
  readonly displayName: string;
  readonly description?: string;
  readonly manifest: ModelResourceManifest;
  readonly revisionDigest: string;
  readonly requestHash: string;
}

export function prepareCatalogModelResourcePublication(
  record: ModelResourceImportRecord,
): CatalogModelResourcePublication {
  const catalog = record.catalogDocument;
  const primary = record.files[0];
  if (
    !catalog ||
    !primary ||
    record.status !== "ready" ||
    record.requiredUserInputs.length > 0 ||
    record.format !== catalog.format ||
    record.license?.spdxId !== catalog.license.spdxId ||
    JSON.stringify(record.nativeInterface) !==
      JSON.stringify(catalog.nativeInterface) ||
    `sha256:${primary.sha256}` !== catalog.expectedSha256 ||
    (catalog.expectedByteSize !== undefined &&
      primary.byteSize !== catalog.expectedByteSize)
  ) {
    fail(
      "model_resource_import.state_conflict",
      "Catalog model resource is not ready for automatic publication.",
    );
  }
  const manifest: ModelResourceManifest = Object.freeze({
    schemaVersion: "kanvas.model-resource/v1",
    family: catalog.family,
    variant: catalog.variant,
    format: catalog.format,
    executionTargets: [...catalog.executionTargets].toSorted(),
    sha256: catalog.expectedSha256,
    ...(catalog.expectedByteSize ? { byteSize: catalog.expectedByteSize } : {}),
    mediaType: catalog.mediaType,
    license: catalog.license,
    source: record.source,
    nativeInterface: catalog.nativeInterface,
    runtime: {},
  });
  const revisionDigest = digestProviderValue({
    schemaVersion: 1,
    key: catalog.resourceKey,
    manifest,
  });
  if (revisionDigest !== catalog.revisionDigest) {
    fail(
      "model_resource_import.state_conflict",
      "Catalog model resource publication identity changed after analysis.",
    );
  }
  return Object.freeze({
    key: catalog.resourceKey,
    revision: catalog.revision,
    displayName: resolveLocalizedTextV1(
      catalog.displayName,
      catalog.displayName.defaultLocale,
    ),
    ...(catalog.description
      ? {
          description: resolveLocalizedTextV1(
            catalog.description,
            catalog.description.defaultLocale,
          ),
        }
      : {}),
    manifest,
    revisionDigest,
    requestHash: digestProviderValue({
      contract: "kanvas.catalog-model-resource-publication/v1",
      importId: record.id,
      revisionDigest,
    }),
  });
}

export interface StartModelResourceImportOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly importId: string;
  readonly uploadSessionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly sourceKind: "url" | "upload";
  readonly source: ModelResourceSourceProvenance;
  readonly catalogEntryId?: string;
  readonly expectedSha256?: string;
  readonly expectedByteSize?: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ReadModelResourceImportOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly importId: string;
  readonly now: Date;
}

export interface CommitUploadedModelResourceOptions extends ReadModelResourceImportOptions {
  readonly storedObjectId: string;
  readonly path: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

export interface ClaimNextModelResourceImportOptions {
  readonly processingLeaseTokenHash: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface ModelResourceImportClaim {
  readonly record: ModelResourceImportRecord;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string;
  readonly processingLeaseExpiresAt: Date;
  readonly uploadSession: UploadSessionRecord;
}

interface ClaimedMutationIdentity {
  readonly importId: string;
  readonly workspaceId: string;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string;
  readonly now: Date;
}

export interface CommitDownloadedModelResourceOptions extends ClaimedMutationIdentity {
  readonly storedObjectId: string;
  readonly path: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

export interface ReportModelResourceDownloadProgressOptions extends ClaimedMutationIdentity {
  readonly downloadedBytes: string;
}

export interface RequestModelResourceImportCancellationOptions extends ReadModelResourceImportOptions {
  readonly audit: ControlPlaneAuditContext;
}

export type CompleteModelResourceImportCancellationOptions =
  ClaimedMutationIdentity;

export interface CompleteModelResourceAnalysisOptions extends ClaimedMutationIdentity {
  readonly source: ModelResourceSourceProvenance;
  readonly suggestedKey?: string;
  readonly suggestedDisplayName?: string;
  readonly format?: ModelResourceFormat;
  readonly license?: ModelResourceLicense;
  readonly nativeInterface?: ModelResourceNativeInterface;
  readonly compatibleAdapters: readonly CompatibleRuntimeAdapter[];
  readonly requiredUserInputs: readonly string[];
}

export interface FailModelResourceImportOptions extends ClaimedMutationIdentity {
  readonly failure: ModelResourceImportFailure;
}

export interface FinalizePublishedModelResourceImportOptions extends ReadModelResourceImportOptions {
  readonly expectedVersion: number;
  readonly resourceId: string;
  readonly revisionId: string;
  readonly target:
    | Readonly<{ kind: "new"; key: string; revision?: number }>
    | Readonly<{
        kind: "new_revision";
        expectedResourceVersion: number;
        key: string;
      }>;
  readonly displayName: string;
  readonly description?: string;
  readonly manifest: ModelResourceManifest;
  readonly revisionDigest: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishedRuntimeAdapterRecord {
  readonly id: string;
  readonly adapterKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly document: RuntimeAdapterDefinitionRevision;
}

export interface ModelResourceImportStore {
  start(options: StartModelResourceImportOptions): Promise<{
    readonly value: ModelResourceImportRecord;
    readonly replayed: boolean;
  }>;
  read(
    options: ReadModelResourceImportOptions,
  ): Promise<ModelResourceImportRecord>;
  readForUpload(options: ReadModelResourceImportOptions): Promise<{
    readonly record: ModelResourceImportRecord;
    readonly uploadSessionId: string;
  }>;
  commitUploaded(
    options: CommitUploadedModelResourceOptions,
  ): Promise<ModelResourceImportRecord>;
  claimNext(
    options: ClaimNextModelResourceImportOptions,
  ): Promise<ModelResourceImportClaim | undefined>;
  commitDownloaded(
    options: CommitDownloadedModelResourceOptions,
  ): Promise<ModelResourceImportRecord>;
  reportDownloadProgress(
    options: ReportModelResourceDownloadProgressOptions,
  ): Promise<"continue" | "cancel_requested">;
  requestCancellation(
    options: RequestModelResourceImportCancellationOptions,
  ): Promise<ModelResourceImportRecord>;
  completeCancellation(
    options: CompleteModelResourceImportCancellationOptions,
  ): Promise<ModelResourceImportRecord>;
  completeAnalysis(
    options: CompleteModelResourceAnalysisOptions,
  ): Promise<ModelResourceImportRecord>;
  fail(
    options: FailModelResourceImportOptions,
  ): Promise<ModelResourceImportRecord>;
  finalizePublished(
    options: FinalizePublishedModelResourceImportOptions,
  ): Promise<
    Readonly<{
      resourceId: string;
      revisionId: string;
      replayed: boolean;
    }>
  >;
  listPublishedRuntimeAdapters(
    workspaceId: string,
  ): Promise<readonly PublishedRuntimeAdapterRecord[]>;
}

export type ModelResourceImportStoreErrorCode =
  | "model_resource_import.invalid_argument"
  | "model_resource_import.not_found"
  | "model_resource_import.idempotency_conflict"
  | "model_resource_import.state_conflict"
  | "model_resource_import.lease_conflict";

export class ModelResourceImportStoreError extends Error {
  public constructor(
    readonly code: ModelResourceImportStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelResourceImportStoreError";
  }
}

interface ImportRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly sourceKind: "url" | "upload";
  readonly source: ModelResourceSourceProvenance;
  readonly catalogEntryId: string | null;
  readonly expectedSha256: string | null;
  readonly expectedByteSize: string | null;
  readonly downloadedBytes: string | number;
  readonly cancelRequestedAt: Date | null;
  readonly catalogDocument: ModelResourceCatalogAssetV1 | null;
  readonly uploadSessionId: string;
  readonly uploadExpiresAt: Date;
  readonly lifecycleStatus: ModelResourceImportStatus;
  readonly suggestedKey: string | null;
  readonly suggestedDisplayName: string | null;
  readonly detectedFormat: ModelResourceFormat | null;
  readonly detectedLicense: ModelResourceLicense | null;
  readonly nativeInterface: ModelResourceNativeInterface | null;
  readonly compatibleAdapters: readonly CompatibleRuntimeAdapter[];
  readonly requiredUserInputs: readonly string[];
  readonly failure: ModelResourceImportFailure | null;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string | null;
  readonly processingLeaseExpiresAt: Date | null;
  readonly publishedModelResourceRevisionId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ModelResourcePublishRow extends RowDataPacket {
  readonly id: string;
  readonly resourceKey: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly currentRevisionId: string | null;
  readonly version: number;
  readonly currentRevision: number | null;
}

interface ImportFileRow extends RowDataPacket {
  readonly modelResourceImportId: string;
  readonly path: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly immutableIdentityHash: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

interface UploadCommitRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedIdentityHash: string | null;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly state: string;
  readonly committedStoredObjectId: string | null;
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupState: string;
}

interface UploadClaimRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: "model_resource";
  readonly expectedSize: string | null;
  readonly expectedMediaType: string | null;
  readonly expectedSha256: string | null;
  readonly storageProfileId: string;
  readonly compatibilityProbeId: string;
  readonly profileConfigurationHash: string;
  readonly container: string;
  readonly objectKey: string;
  readonly uploadMode: "server_stream";
  readonly writeProtectionMode: "server_owned";
  readonly state: UploadSessionRecord["state"];
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupEligibleAt: Date;
  readonly verificationProfileVersion: string;
}

interface AdapterRow extends RowDataPacket {
  readonly id: string;
  readonly adapterKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly document: RuntimeAdapterDefinitionRevision;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const tokenHashPattern = /^[0-9a-f]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const pathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]{1,700}$/u;

function fail(code: ModelResourceImportStoreErrorCode, message: string): never {
  throw new ModelResourceImportStoreError(code, message);
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStart(options: StartModelResourceImportOptions): void {
  if (
    !idPattern.test(options.importId) ||
    !idPattern.test(options.uploadSessionId) ||
    options.idempotencyKey.length < 1 ||
    options.idempotencyKey.length > 160 ||
    !digestPattern.test(options.requestHash) ||
    (options.sourceKind !== "url" && options.sourceKind !== "upload") ||
    !validJsonObject(options.source) ||
    (options.catalogEntryId !== undefined &&
      !idPattern.test(options.catalogEntryId)) ||
    (options.expectedSha256 !== undefined &&
      !tokenHashPattern.test(options.expectedSha256)) ||
    (options.expectedByteSize !== undefined &&
      (!uint64Pattern.test(options.expectedByteSize) ||
        options.expectedByteSize === "0")) ||
    (options.catalogEntryId === undefined) !==
      (options.expectedSha256 === undefined) ||
    !validDate(options.now)
  ) {
    fail(
      "model_resource_import.invalid_argument",
      "Invalid model resource import request.",
    );
  }
}

function assertRead(options: ReadModelResourceImportOptions): void {
  if (!idPattern.test(options.importId) || !validDate(options.now)) {
    fail(
      "model_resource_import.invalid_argument",
      "Invalid model resource import lookup.",
    );
  }
}

function assertClaimIdentity(options: ClaimedMutationIdentity): void {
  if (
    !idPattern.test(options.importId) ||
    !idPattern.test(options.workspaceId) ||
    !Number.isSafeInteger(options.processingLeaseGeneration) ||
    options.processingLeaseGeneration < 1 ||
    !tokenHashPattern.test(options.processingLeaseTokenHash) ||
    !validDate(options.now)
  ) {
    fail(
      "model_resource_import.invalid_argument",
      "Invalid model resource import claim.",
    );
  }
}

const importSelect = `SELECT
  model_import.id,
  model_import.workspace_id AS workspaceId,
  model_import.created_by_principal_id AS createdByPrincipalId,
  model_import.idempotency_key AS idempotencyKey,
  model_import.request_hash AS requestHash,
  model_import.source_kind AS sourceKind,
  model_import.source,
  model_import.catalog_entry_id AS catalogEntryId,
  model_import.expected_sha256 AS expectedSha256,
  model_import.expected_byte_size AS expectedByteSize,
  model_import.downloaded_bytes AS downloadedBytes,
  model_import.cancel_requested_at AS cancelRequestedAt,
  catalog_entry.document AS catalogDocument,
  model_import.upload_session_id AS uploadSessionId,
  upload.expires_at AS uploadExpiresAt,
  model_import.lifecycle_status AS lifecycleStatus,
  model_import.suggested_key AS suggestedKey,
  model_import.suggested_display_name AS suggestedDisplayName,
  model_import.detected_format AS detectedFormat,
  model_import.detected_license AS detectedLicense,
  model_import.native_interface AS nativeInterface,
  model_import.compatible_adapters AS compatibleAdapters,
  model_import.required_user_inputs AS requiredUserInputs,
  model_import.failure,
  model_import.processing_lease_generation AS processingLeaseGeneration,
  model_import.processing_lease_token_hash AS processingLeaseTokenHash,
  model_import.processing_lease_expires_at AS processingLeaseExpiresAt,
  model_import.published_model_resource_revision_id AS publishedModelResourceRevisionId,
  model_import.version,
  model_import.created_at AS createdAt,
  model_import.updated_at AS updatedAt
FROM model_resource_import AS model_import
INNER JOIN upload_session AS upload
  ON upload.workspace_id = model_import.workspace_id
 AND upload.id = model_import.upload_session_id
LEFT JOIN model_resource_catalog_entry AS catalog_entry
  ON catalog_entry.workspace_id = model_import.workspace_id
 AND catalog_entry.id = model_import.catalog_entry_id`;

const fileSelect = `SELECT
  import_file.model_resource_import_id AS modelResourceImportId,
  import_file.path,
  import_file.stored_object_id AS storedObjectId,
  stored_object_record.storage_profile_id AS storageProfileId,
  stored_object_record.container,
  stored_object_record.object_key AS objectKey,
  stored_object_record.storage_version_id AS storageVersionId,
  stored_object_record.immutable_identity_hash AS immutableIdentityHash,
  import_file.media_type AS mediaType,
  import_file.byte_size AS byteSize,
  import_file.sha256,
  import_file.source_metadata AS sourceMetadata
FROM model_resource_import_file AS import_file
INNER JOIN stored_object AS stored_object_record
  ON stored_object_record.workspace_id = import_file.workspace_id
 AND stored_object_record.id = import_file.stored_object_id`;

async function inTransaction<TResult>(
  pool: Pool,
  callback: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function filesFor(
  connection: PoolConnection,
  workspaceId: string,
  importIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ModelResourceImportFileRecord[]>> {
  if (importIds.length === 0) return new Map();
  const placeholders = importIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<ImportFileRow[]>(
    `${fileSelect}
     WHERE import_file.workspace_id = ?
       AND import_file.model_resource_import_id IN (${placeholders})
     ORDER BY import_file.model_resource_import_id, import_file.path`,
    [workspaceId, ...importIds],
  );
  const grouped = new Map<string, ModelResourceImportFileRecord[]>();
  for (const row of rows) {
    const items = grouped.get(row.modelResourceImportId) ?? [];
    items.push(
      Object.freeze({
        path: row.path,
        storedObjectId: row.storedObjectId,
        storageProfileId: row.storageProfileId,
        container: row.container,
        objectKey: row.objectKey,
        ...(row.storageVersionId
          ? { storageVersionId: row.storageVersionId }
          : {}),
        immutableIdentityHash: row.immutableIdentityHash,
        mediaType: row.mediaType,
        byteSize: row.byteSize,
        sha256: row.sha256,
        sourceMetadata: row.sourceMetadata,
      }),
    );
    grouped.set(row.modelResourceImportId, items);
  }
  return new Map(
    [...grouped].map(([id, items]) => [id, Object.freeze(items)] as const),
  );
}

function recordFrom(
  row: ImportRow,
  files: readonly ModelResourceImportFileRecord[],
): ModelResourceImportRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    createdByPrincipalId: row.createdByPrincipalId,
    sourceKind: row.sourceKind,
    source: row.source,
    ...(row.catalogEntryId ? { catalogEntryId: row.catalogEntryId } : {}),
    ...(row.catalogDocument ? { catalogDocument: row.catalogDocument } : {}),
    ...(row.expectedByteSize ? { expectedByteSize: row.expectedByteSize } : {}),
    downloadedBytes: String(row.downloadedBytes),
    ...(row.cancelRequestedAt
      ? { cancelRequestedAt: row.cancelRequestedAt }
      : {}),
    uploadSessionId: row.uploadSessionId,
    uploadExpiresAt: row.uploadExpiresAt,
    status: row.lifecycleStatus,
    ...(row.suggestedKey ? { suggestedKey: row.suggestedKey } : {}),
    ...(row.suggestedDisplayName
      ? { suggestedDisplayName: row.suggestedDisplayName }
      : {}),
    ...(row.detectedFormat ? { format: row.detectedFormat } : {}),
    ...(row.detectedLicense ? { license: row.detectedLicense } : {}),
    ...(row.nativeInterface ? { nativeInterface: row.nativeInterface } : {}),
    compatibleAdapters: Object.freeze([...(row.compatibleAdapters ?? [])]),
    requiredUserInputs: Object.freeze([...(row.requiredUserInputs ?? [])]),
    ...(row.failure ? { failure: row.failure } : {}),
    files,
    ...(row.publishedModelResourceRevisionId
      ? {
          publishedModelResourceRevisionId:
            row.publishedModelResourceRevisionId,
        }
      : {}),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function loadRecord(
  connection: PoolConnection,
  workspaceId: string,
  importId: string,
  lock = false,
): Promise<{
  readonly row: ImportRow;
  readonly value: ModelResourceImportRecord;
}> {
  const [rows] = await connection.execute<ImportRow[]>(
    `${importSelect}
     WHERE model_import.workspace_id = ?
       AND model_import.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, importId],
  );
  const row = rows[0];
  if (!row) {
    fail(
      "model_resource_import.not_found",
      "Model resource import was not found.",
    );
  }
  const files = await filesFor(connection, workspaceId, [importId]);
  return Object.freeze({
    row,
    value: recordFrom(row, files.get(importId) ?? []),
  });
}

async function lockUpload(
  connection: PoolConnection,
  workspaceId: string,
  uploadSessionId: string,
): Promise<UploadCommitRow> {
  const [rows] = await connection.execute<UploadCommitRow[]>(
    `SELECT
       id, workspace_id AS workspaceId, actor_id AS actorId, purpose,
       storage_profile_id AS storageProfileId, container,
       object_key AS objectKey, storage_version_id AS storageVersionId,
       provider_etag AS providerEtag,
       sealed_identity_hash AS sealedIdentityHash,
       verified_size AS verifiedSize, verified_sha256 AS verifiedSha256,
       detected_media_type AS detectedMediaType, state,
       committed_stored_object_id AS committedStoredObjectId,
       version, expires_at AS expiresAt, cleanup_state AS cleanupState
     FROM upload_session
     WHERE workspace_id = ? AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, uploadSessionId],
  );
  const row = rows[0];
  if (!row)
    fail(
      "model_resource_import.not_found",
      "Model resource upload was not found.",
    );
  return row;
}

async function commitVerifiedUpload(
  connection: PoolConnection,
  options: {
    readonly importRow: ImportRow;
    readonly upload: UploadCommitRow;
    readonly storedObjectId: string;
    readonly path: string;
    readonly sourceMetadata: Readonly<Record<string, unknown>>;
    readonly now: Date;
  },
): Promise<void> {
  if (
    !idPattern.test(options.storedObjectId) ||
    !pathPattern.test(options.path) ||
    !validJsonObject(options.sourceMetadata)
  ) {
    fail(
      "model_resource_import.invalid_argument",
      "Invalid imported model file identity.",
    );
  }
  if (
    options.upload.purpose !== "model_resource" ||
    options.upload.id !== options.importRow.uploadSessionId ||
    options.upload.workspaceId !== options.importRow.workspaceId ||
    options.upload.actorId !== options.importRow.createdByPrincipalId
  ) {
    fail(
      "model_resource_import.state_conflict",
      "Upload does not belong to this model import.",
    );
  }
  if (options.upload.state === "committed") {
    if (options.upload.committedStoredObjectId !== options.storedObjectId) {
      fail(
        "model_resource_import.state_conflict",
        "Model upload was committed with another object identity.",
      );
    }
    return;
  }
  if (
    options.upload.state !== "verified" ||
    options.upload.cleanupState !== "none" ||
    options.upload.expiresAt <= options.now ||
    !options.upload.sealedIdentityHash ||
    !options.upload.verifiedSize ||
    !options.upload.verifiedSha256 ||
    !options.upload.detectedMediaType ||
    !uint64Pattern.test(options.upload.verifiedSize)
  ) {
    fail(
      "model_resource_import.state_conflict",
      "Model upload is not ready to commit.",
    );
  }
  if (
    (options.importRow.expectedSha256 &&
      options.upload.verifiedSha256 !== options.importRow.expectedSha256) ||
    (options.importRow.expectedByteSize &&
      options.upload.verifiedSize !== options.importRow.expectedByteSize)
  ) {
    fail(
      "model_resource_import.state_conflict",
      "Downloaded model bytes do not match the selected Catalog release.",
    );
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO stored_object (
       id, workspace_id, created_from_upload_session_id,
       storage_profile_id, container, object_key, storage_version_id,
       provider_etag, immutable_identity_hash, byte_size, sha256,
       media_type, delete_state, created_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
    [
      options.storedObjectId,
      options.upload.workspaceId,
      options.upload.id,
      options.upload.storageProfileId,
      options.upload.container,
      options.upload.objectKey,
      options.upload.storageVersionId,
      options.upload.providerEtag,
      options.upload.sealedIdentityHash,
      options.upload.verifiedSize,
      options.upload.verifiedSha256,
      options.upload.detectedMediaType,
      options.now,
    ],
  );
  await connection.execute<ResultSetHeader>(
    `INSERT INTO model_resource_import_file (
       workspace_id, model_resource_import_id, path, stored_object_id,
       media_type, byte_size, sha256, source_metadata, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.upload.workspaceId,
      options.importRow.id,
      options.path,
      options.storedObjectId,
      options.upload.detectedMediaType,
      options.upload.verifiedSize,
      options.upload.verifiedSha256,
      JSON.stringify(options.sourceMetadata),
      options.now,
    ],
  );
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE upload_session
     SET state = 'committed', committed_stored_object_id = ?, committed_at = ?,
         version = version + 1, updated_at = ?
     WHERE workspace_id = ? AND id = ? AND version = ?
       AND state = 'verified' AND cleanup_state = 'none'
       AND expires_at > ? AND committed_stored_object_id IS NULL`,
    [
      options.storedObjectId,
      options.now,
      options.now,
      options.upload.workspaceId,
      options.upload.id,
      options.upload.version,
      options.now,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "model_resource_import.state_conflict",
      "Model upload changed before commit.",
    );
  }
}

function assertActiveClaim(
  row: ImportRow,
  options: ClaimedMutationIdentity,
): void {
  if (
    row.processingLeaseGeneration !== options.processingLeaseGeneration ||
    row.processingLeaseTokenHash !== options.processingLeaseTokenHash ||
    !row.processingLeaseExpiresAt ||
    row.processingLeaseExpiresAt <= options.now
  ) {
    fail(
      "model_resource_import.lease_conflict",
      "Model resource import lease is stale.",
    );
  }
}

function uploadSessionFrom(row: UploadClaimRow): UploadSessionRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    purpose: row.purpose,
    ...(row.expectedSize ? { expectedSize: row.expectedSize } : {}),
    ...(row.expectedMediaType
      ? { expectedMediaType: row.expectedMediaType }
      : {}),
    ...(row.expectedSha256 ? { expectedSha256: row.expectedSha256 } : {}),
    storageProfileId: row.storageProfileId,
    compatibilityProbeId: row.compatibilityProbeId,
    profileConfigurationHash: row.profileConfigurationHash,
    container: row.container,
    objectKey: row.objectKey,
    uploadMode: row.uploadMode,
    writeProtectionMode: row.writeProtectionMode,
    state: row.state,
    version: row.version,
    expiresAt: row.expiresAt,
    cleanupEligibleAt: row.cleanupEligibleAt,
    verificationProfileVersion: row.verificationProfileVersion,
    replayed: false,
  });
}

export function createModelResourceImportStore(
  pool: Pool,
): ModelResourceImportStore {
  return Object.freeze<ModelResourceImportStore>({
    async start(options) {
      assertStart(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const [replays] = await connection.execute<ImportRow[]>(
          `${importSelect}
           WHERE model_import.workspace_id = ?
             AND model_import.idempotency_key = ?
           LIMIT 1
           FOR UPDATE`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replays[0];
        if (replay) {
          if (replay.requestHash !== options.requestHash) {
            fail(
              "model_resource_import.idempotency_conflict",
              "Idempotency key was used for another model import.",
            );
          }
          const files = await filesFor(connection, replay.workspaceId, [
            replay.id,
          ]);
          return Object.freeze({
            value: recordFrom(replay, files.get(replay.id) ?? []),
            replayed: true,
          });
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO model_resource_import (
             id, workspace_id, created_by_principal_id,
             idempotency_key, request_hash, source_kind, source,
             catalog_entry_id, expected_sha256, expected_byte_size,
             upload_session_id, lifecycle_status, suggested_key,
             suggested_display_name, detected_format, detected_license,
             native_interface, compatible_adapters, required_user_inputs,
             failure, processing_lease_generation,
             processing_lease_token_hash, processing_lease_expires_at,
             processing_attempts, published_model_resource_revision_id,
             version, created_at, updated_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
             NULL, JSON_ARRAY(), JSON_ARRAY(), NULL, 0, NULL, NULL, 0,
             NULL, 1, ?, ?, NULL)`,
          [
            options.importId,
            options.scope.workspaceId,
            options.scope.principalId,
            options.idempotencyKey,
            options.requestHash,
            options.sourceKind,
            JSON.stringify(options.source),
            options.catalogEntryId ?? null,
            options.expectedSha256 ?? null,
            options.expectedByteSize ?? null,
            options.uploadSessionId,
            options.sourceKind === "url" ? "fetching" : "waiting_upload",
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
            eventType: "model_resource_import.started",
            action: "model_resource_import.start",
            resourceType: "model_resource_import",
            resourceId: options.importId,
            outcome: "succeeded",
            decisionReasonCode: "authorized",
            severity: "info",
            authorizationDecision: Object.freeze({
              permission: "capability.configure",
              authorityVersion: options.scope.authorityVersion,
            }),
            details: Object.freeze({ sourceKind: options.sourceKind }),
            occurredAt: options.now,
          },
        );
        const loaded = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.importId,
        );
        return Object.freeze({ value: loaded.value, replayed: false });
      });
    },

    async read(options) {
      assertRead(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        return (
          await loadRecord(
            connection,
            options.scope.workspaceId,
            options.importId,
          )
        ).value;
      });
    },

    async readForUpload(options) {
      assertRead(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const loaded = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.importId,
        );
        if (loaded.row.sourceKind !== "upload") {
          fail(
            "model_resource_import.state_conflict",
            "URL imports do not accept uploaded content.",
          );
        }
        if (
          loaded.row.lifecycleStatus !== "waiting_upload" &&
          loaded.row.lifecycleStatus !== "analyzing" &&
          loaded.row.lifecycleStatus !== "needs_input" &&
          loaded.row.lifecycleStatus !== "ready"
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model import is not accepting content.",
          );
        }
        return Object.freeze({
          record: loaded.value,
          uploadSessionId: loaded.row.uploadSessionId,
        });
      });
    },

    async commitUploaded(options) {
      assertRead(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const loaded = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.importId,
          true,
        );
        if (loaded.row.sourceKind !== "upload") {
          fail(
            "model_resource_import.state_conflict",
            "URL imports cannot commit browser uploads.",
          );
        }
        if (loaded.row.lifecycleStatus !== "waiting_upload") {
          if (
            loaded.value.files.some(
              (file) => file.storedObjectId === options.storedObjectId,
            )
          ) {
            return loaded.value;
          }
          fail(
            "model_resource_import.state_conflict",
            "Model import already consumed another upload.",
          );
        }
        const upload = await lockUpload(
          connection,
          loaded.row.workspaceId,
          loaded.row.uploadSessionId,
        );
        await commitVerifiedUpload(connection, {
          importRow: loaded.row,
          upload,
          storedObjectId: options.storedObjectId,
          path: options.path,
          sourceMetadata: options.sourceMetadata,
          now: options.now,
        });
        await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET lifecycle_status = 'analyzing', version = version + 1,
               updated_at = ?, failure = NULL
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async claimNext(options) {
      if (
        !tokenHashPattern.test(options.processingLeaseTokenHash) ||
        !validDate(options.now) ||
        !validDate(options.leaseExpiresAt) ||
        options.leaseExpiresAt <= options.now
      ) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid model resource import lease.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const [candidates] = await connection.execute<ImportRow[]>(
          `${importSelect}
           WHERE model_import.lifecycle_status IN ('fetching', 'analyzing')
             AND (model_import.processing_lease_expires_at IS NULL
               OR model_import.processing_lease_expires_at <= ?)
           ORDER BY model_import.updated_at, model_import.id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [options.now],
        );
        const candidate = candidates[0];
        if (!candidate) return undefined;
        const nextGeneration = candidate.processingLeaseGeneration + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET processing_lease_generation = ?, processing_lease_token_hash = ?,
               processing_lease_expires_at = ?, processing_attempts = processing_attempts + 1,
               downloaded_bytes = CASE
                 WHEN lifecycle_status = 'fetching' THEN 0
                 ELSE downloaded_bytes
               END,
               updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            nextGeneration,
            options.processingLeaseTokenHash,
            options.leaseExpiresAt,
            options.now,
            candidate.workspaceId,
            candidate.id,
            candidate.version,
          ],
        );
        if (updated.affectedRows !== 1) return undefined;
        const [uploadRows] = await connection.execute<UploadClaimRow[]>(
          `SELECT
             id, workspace_id AS workspaceId, actor_id AS actorId, purpose,
             expected_size AS expectedSize, expected_media_type AS expectedMediaType,
             expected_sha256 AS expectedSha256,
             storage_profile_id AS storageProfileId,
             compatibility_probe_id AS compatibilityProbeId,
             profile_configuration_hash AS profileConfigurationHash,
             container, object_key AS objectKey, upload_mode AS uploadMode,
             write_protection_mode AS writeProtectionMode, state, version,
             expires_at AS expiresAt, cleanup_eligible_at AS cleanupEligibleAt,
             verification_profile_version AS verificationProfileVersion
           FROM upload_session
           WHERE workspace_id = ? AND id = ? AND purpose = 'model_resource'
           LIMIT 1`,
          [candidate.workspaceId, candidate.uploadSessionId],
        );
        const upload = uploadRows[0];
        if (!upload) {
          fail(
            "model_resource_import.state_conflict",
            "Model resource upload allocation is missing.",
          );
        }
        const files = await filesFor(connection, candidate.workspaceId, [
          candidate.id,
        ]);
        const claimedRow: ImportRow = Object.freeze({
          ...candidate,
          processingLeaseGeneration: nextGeneration,
          processingLeaseTokenHash: options.processingLeaseTokenHash,
          processingLeaseExpiresAt: options.leaseExpiresAt,
          updatedAt: options.now,
        });
        return Object.freeze({
          record: recordFrom(claimedRow, files.get(candidate.id) ?? []),
          processingLeaseGeneration: nextGeneration,
          processingLeaseTokenHash: options.processingLeaseTokenHash,
          processingLeaseExpiresAt: options.leaseExpiresAt,
          uploadSession: uploadSessionFrom(upload),
        });
      });
    },

    async commitDownloaded(options) {
      assertClaimIdentity(options);
      return inTransaction(pool, async (connection) => {
        const loaded = await loadRecord(
          connection,
          options.workspaceId,
          options.importId,
          true,
        );
        assertActiveClaim(loaded.row, options);
        if (
          loaded.row.sourceKind !== "url" ||
          loaded.row.lifecycleStatus !== "fetching"
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model import is not fetching URL content.",
          );
        }
        const upload = await lockUpload(
          connection,
          loaded.row.workspaceId,
          loaded.row.uploadSessionId,
        );
        await commitVerifiedUpload(connection, {
          importRow: loaded.row,
          upload,
          storedObjectId: options.storedObjectId,
          path: options.path,
          sourceMetadata: options.sourceMetadata,
          now: options.now,
        });
        await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET lifecycle_status = 'analyzing', version = version + 1,
               processing_lease_token_hash = NULL,
               processing_lease_expires_at = NULL, updated_at = ?, failure = NULL
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async reportDownloadProgress(options) {
      assertClaimIdentity(options);
      if (!uint64Pattern.test(options.downloadedBytes)) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid model download progress.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const loaded = await loadRecord(
          connection,
          options.workspaceId,
          options.importId,
          true,
        );
        assertActiveClaim(loaded.row, options);
        if (
          loaded.row.sourceKind !== "url" ||
          loaded.row.lifecycleStatus !== "fetching"
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model import is not downloading URL content.",
          );
        }
        if (loaded.row.cancelRequestedAt) return "cancel_requested";
        const downloaded = BigInt(options.downloadedBytes);
        const current = BigInt(loaded.row.downloadedBytes);
        const expected = loaded.row.expectedByteSize
          ? BigInt(loaded.row.expectedByteSize)
          : undefined;
        if (
          downloaded < current ||
          (expected !== undefined && downloaded > expected)
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model download progress is not monotonic or exceeds its expected size.",
          );
        }
        if (downloaded > current) {
          await connection.execute<ResultSetHeader>(
            `UPDATE model_resource_import
             SET downloaded_bytes = ?, updated_at = ?
             WHERE workspace_id = ? AND id = ?`,
            [
              options.downloadedBytes,
              options.now,
              loaded.row.workspaceId,
              loaded.row.id,
            ],
          );
        }
        return "continue";
      });
    },

    async requestCancellation(options) {
      assertRead(options);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const loaded = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.importId,
          true,
        );
        if (loaded.row.lifecycleStatus === "cancelled") return loaded.value;
        if (
          loaded.row.lifecycleStatus !== "fetching" ||
          loaded.row.sourceKind !== "url"
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Only an active model download can be cancelled.",
          );
        }
        if (!loaded.row.cancelRequestedAt) {
          await connection.execute<ResultSetHeader>(
            `UPDATE model_resource_import
             SET cancel_requested_at = ?, version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?`,
            [
              options.now,
              options.now,
              loaded.row.workspaceId,
              loaded.row.id,
              loaded.row.version,
            ],
          );
          await appendControlPlaneAuditEventInTransaction(
            connection,
            options.audit,
            {
              organizationId: options.scope.organizationId,
              workspaceId: options.scope.workspaceId,
              eventType: "model_resource_import.cancellation_requested",
              action: "model_resource_import.cancel",
              resourceType: "model_resource_import",
              resourceId: loaded.row.id,
              outcome: "succeeded",
              decisionReasonCode: "user_requested",
              severity: "info",
              authorizationDecision: Object.freeze({
                permission: "capability.configure",
                authorityVersion: options.scope.authorityVersion,
              }),
              details: Object.freeze({}),
              occurredAt: options.now,
            },
          );
        }
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async completeCancellation(options) {
      assertClaimIdentity(options);
      return inTransaction(pool, async (connection) => {
        const loaded = await loadRecord(
          connection,
          options.workspaceId,
          options.importId,
          true,
        );
        assertActiveClaim(loaded.row, options);
        if (
          loaded.row.lifecycleStatus !== "fetching" ||
          !loaded.row.cancelRequestedAt
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model download cancellation was not requested.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET lifecycle_status = 'cancelled',
               processing_lease_token_hash = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1, updated_at = ?, completed_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET expires_at = LEAST(expires_at, ?),
               cleanup_eligible_at = LEAST(cleanup_eligible_at, ?),
               updated_at = ?
           WHERE workspace_id = ? AND id = ? AND state <> 'committed'`,
          [
            options.now,
            new Date(options.now.getTime() + 1),
            options.now,
            loaded.row.workspaceId,
            loaded.row.uploadSessionId,
          ],
        );
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async completeAnalysis(options) {
      assertClaimIdentity(options);
      if (
        !validJsonObject(options.source) ||
        options.compatibleAdapters.length > 64 ||
        options.requiredUserInputs.length > 4
      ) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid model resource analysis result.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const loaded = await loadRecord(
          connection,
          options.workspaceId,
          options.importId,
          true,
        );
        assertActiveClaim(loaded.row, options);
        if (
          loaded.row.lifecycleStatus !== "analyzing" ||
          loaded.value.files.length < 1
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model import has no file ready for analysis.",
          );
        }
        const nextStatus =
          options.requiredUserInputs.length === 0 ? "ready" : "needs_input";
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET source = ?, lifecycle_status = ?, suggested_key = ?,
               suggested_display_name = ?, detected_format = ?,
               detected_license = ?, native_interface = ?, compatible_adapters = ?,
               required_user_inputs = ?, failure = NULL,
               processing_lease_token_hash = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            JSON.stringify(options.source),
            nextStatus,
            options.suggestedKey ?? null,
            options.suggestedDisplayName ?? null,
            options.format ?? null,
            options.license ? JSON.stringify(options.license) : null,
            options.nativeInterface
              ? JSON.stringify(options.nativeInterface)
              : null,
            JSON.stringify(options.compatibleAdapters),
            JSON.stringify(options.requiredUserInputs),
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "model_resource_import.lease_conflict",
            "Model import changed before analysis completed.",
          );
        }
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async fail(options) {
      assertClaimIdentity(options);
      if (
        !options.failure.code ||
        options.failure.code.length > 120 ||
        !options.failure.message ||
        options.failure.message.length > 500
      ) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid model resource import failure.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const loaded = await loadRecord(
          connection,
          options.workspaceId,
          options.importId,
          true,
        );
        assertActiveClaim(loaded.row, options);
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET lifecycle_status = 'failed', failure = ?,
               processing_lease_token_hash = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1, updated_at = ?, completed_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            JSON.stringify(options.failure),
            options.now,
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "model_resource_import.lease_conflict",
            "Model import changed before failure was recorded.",
          );
        }
        return (
          await loadRecord(connection, loaded.row.workspaceId, loaded.row.id)
        ).value;
      });
    },

    async finalizePublished(options) {
      assertRead(options);
      if (
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1 ||
        !idPattern.test(options.resourceId) ||
        !idPattern.test(options.revisionId) ||
        !digestPattern.test(options.revisionDigest) ||
        options.idempotencyKey.length < 1 ||
        options.idempotencyKey.length > 160 ||
        !digestPattern.test(options.requestHash) ||
        !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u.test(options.target.key) ||
        (options.target.kind === "new" &&
          options.target.revision !== undefined &&
          (!Number.isSafeInteger(options.target.revision) ||
            options.target.revision < 1)) ||
        options.displayName.trim().length < 1 ||
        options.displayName.length > 160 ||
        (options.description !== undefined &&
          (options.description.trim().length < 1 ||
            options.description.length > 2_000)) ||
        (options.target.kind === "new_revision" &&
          (!Number.isSafeInteger(options.target.expectedResourceVersion) ||
            options.target.expectedResourceVersion < 1))
      ) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid model resource publication result.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const loaded = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.importId,
          true,
        );
        if (loaded.row.lifecycleStatus === "published") {
          if (
            loaded.row.publishedModelResourceRevisionId !== options.revisionId
          ) {
            fail(
              "model_resource_import.state_conflict",
              "Model import was published as another revision.",
            );
          }
          return Object.freeze({
            resourceId: options.resourceId,
            revisionId: options.revisionId,
            replayed: true,
          });
        }
        if (
          loaded.row.version !== options.expectedVersion ||
          (loaded.row.lifecycleStatus !== "ready" &&
            loaded.row.lifecycleStatus !== "needs_input") ||
          loaded.value.files.length < 1
        ) {
          fail(
            "model_resource_import.state_conflict",
            "Model import changed before publication.",
          );
        }

        let revision =
          options.target.kind === "new" ? (options.target.revision ?? 1) : 1;
        let previousRevisionId: string | undefined;
        if (options.target.kind === "new") {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO model_resource (
               id, workspace_id, resource_key, lifecycle_status,
               current_revision_id, create_request_key, create_request_hash,
               version, created_at, updated_at, archived_at
             ) VALUES (?, ?, ?, 'active', NULL, ?, ?, 1, ?, ?, NULL)`,
            [
              options.resourceId,
              loaded.row.workspaceId,
              options.target.key,
              options.idempotencyKey,
              options.requestHash,
              options.now,
              options.now,
            ],
          );
        } else {
          const [resources] = await connection.execute<
            ModelResourcePublishRow[]
          >(
            `SELECT
               resource.id,
               resource.resource_key AS resourceKey,
               resource.lifecycle_status AS lifecycleStatus,
               resource.current_revision_id AS currentRevisionId,
               resource.version,
               revision.revision AS currentRevision
             FROM model_resource AS resource
             LEFT JOIN model_resource_revision AS revision
               ON revision.workspace_id = resource.workspace_id
              AND revision.id = resource.current_revision_id
             WHERE resource.workspace_id = ? AND resource.id = ?
             LIMIT 1 FOR UPDATE`,
            [loaded.row.workspaceId, options.resourceId],
          );
          const resource = resources[0];
          if (
            !resource ||
            resource.version !== options.target.expectedResourceVersion ||
            resource.lifecycleStatus !== "active" ||
            resource.resourceKey !== options.target.key ||
            !resource.currentRevisionId ||
            !resource.currentRevision
          ) {
            fail(
              "model_resource_import.state_conflict",
              "Model resource changed before this revision was published.",
            );
          }
          revision = resource.currentRevision + 1;
          previousRevisionId = resource.currentRevisionId;
        }

        await connection.execute<ResultSetHeader>(
          `INSERT INTO model_resource_revision (
             id, workspace_id, model_resource_id, revision,
             lifecycle_status, schema_version, display_name, description,
             canonical_digest, manifest, publication_request_key,
             publication_request_hash, created_at, published_at
           ) VALUES (?, ?, ?, ?, 'published', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.revisionId,
            loaded.row.workspaceId,
            options.resourceId,
            revision,
            options.displayName.trim(),
            options.description?.trim() ?? null,
            options.revisionDigest,
            JSON.stringify(options.manifest),
            options.idempotencyKey,
            options.requestHash,
            options.now,
            options.now,
          ],
        );
        if (previousRevisionId) {
          await connection.execute<ResultSetHeader>(
            `UPDATE model_resource_revision
             SET lifecycle_status = 'deprecated'
             WHERE workspace_id = ? AND id = ?
               AND lifecycle_status = 'published'`,
            [loaded.row.workspaceId, previousRevisionId],
          );
        }
        const [resourceUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource
           SET current_revision_id = ?,
               version = version + ?,
               updated_at = ?
           WHERE workspace_id = ? AND id = ?
             AND version = ?`,
          [
            options.revisionId,
            options.target.kind === "new" ? 0 : 1,
            options.now,
            loaded.row.workspaceId,
            options.resourceId,
            options.target.kind === "new"
              ? 1
              : options.target.expectedResourceVersion,
          ],
        );
        if (resourceUpdated.affectedRows !== 1) {
          fail(
            "model_resource_import.state_conflict",
            "Model resource changed before publication.",
          );
        }

        for (const [index, file] of loaded.value.files.entries()) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO model_resource_revision_file (
               workspace_id, model_resource_revision_id, path,
               stored_object_id, role, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              loaded.row.workspaceId,
              options.revisionId,
              file.path,
              file.storedObjectId,
              index === 0 ? "primary" : "supporting",
              options.now,
            ],
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO capability_implementation_model_resource (
             workspace_id, implementation_revision_id,
             model_resource_revision_id, resource_role, created_at
           )
           SELECT implementation.workspace_id, implementation.id,
                  revision.id, 'primary', ?
           FROM model_resource_revision AS revision
           INNER JOIN model_resource AS resource
             ON resource.workspace_id = revision.workspace_id
            AND resource.id = revision.model_resource_id
           INNER JOIN capability_implementation_revision AS implementation
             ON implementation.workspace_id = revision.workspace_id
            AND implementation.source_kind = 'model_resource'
            AND JSON_UNQUOTE(
              JSON_EXTRACT(implementation.source_reference, '$.resource.key')
            ) = resource.resource_key
            AND CAST(JSON_UNQUOTE(
              JSON_EXTRACT(implementation.source_reference, '$.resource.revision')
            ) AS UNSIGNED) = revision.revision
            AND JSON_UNQUOTE(
              JSON_EXTRACT(
                implementation.source_reference,
                '$.resource.canonicalDigest'
              )
            ) = revision.canonical_digest
           WHERE revision.workspace_id = ? AND revision.id = ?`,
          [options.now, loaded.row.workspaceId, options.revisionId],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE capability_binding AS binding
           INNER JOIN capability_implementation_model_resource AS reference
             ON reference.workspace_id = binding.workspace_id
            AND reference.implementation_revision_id =
                binding.implementation_revision_id
            AND reference.model_resource_revision_id = ?
           SET binding.lifecycle_status = CASE
                 WHEN JSON_EXTRACT(
                   binding.route_policy,
                   '$.catalogDesiredEnabled'
                 ) = TRUE
                 THEN 'active'
                 ELSE binding.lifecycle_status
               END,
               binding.route_policy = JSON_SET(
                 binding.route_policy,
                 '$.dependencyReady',
                 TRUE
               ),
               binding.version = binding.version + 1,
               binding.updated_at = ?
           WHERE binding.workspace_id = ?
             AND JSON_EXTRACT(binding.route_policy, '$.dependencyReady') = FALSE`,
          [options.revisionId, options.now, loaded.row.workspaceId],
        );
        await reconcileCatalogRuntimeInTransaction(connection, {
          workspaceId: loaded.row.workspaceId,
          actorPrincipalId: loaded.row.createdByPrincipalId,
          now: options.now,
        });
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource_import
           SET lifecycle_status = 'published',
               published_model_resource_revision_id = ?,
               version = version + 1, updated_at = ?, completed_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?
             AND lifecycle_status IN ('ready', 'needs_input')`,
          [
            options.revisionId,
            options.now,
            options.now,
            loaded.row.workspaceId,
            loaded.row.id,
            loaded.row.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "model_resource_import.state_conflict",
            "Model import changed before publication.",
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType:
              options.target.kind === "new"
                ? "model_resource.created"
                : "model_resource.revised",
            action:
              options.target.kind === "new"
                ? "model_resource.created"
                : "model_resource.revised",
            resourceType: "model_resource",
            resourceId: options.resourceId,
            outcome: "succeeded",
            decisionReasonCode:
              options.target.kind === "new"
                ? "model_resource.created"
                : "model_resource.revised",
            severity: "info",
            authorizationDecision: Object.freeze({
              permission: "capability.configure",
              authorityVersion: options.scope.authorityVersion,
            }),
            details: Object.freeze({
              resourceKey: options.target.key,
              revision,
              importId: options.importId,
            }),
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          resourceId: options.resourceId,
          revisionId: options.revisionId,
          replayed: false,
        });
      });
    },
    async listPublishedRuntimeAdapters(workspaceId) {
      if (!idPattern.test(workspaceId)) {
        fail(
          "model_resource_import.invalid_argument",
          "Invalid Runtime Adapter workspace.",
        );
      }
      const [rows] = await pool.execute<AdapterRow[]>(
        `SELECT
           revision.id,
           definition.adapter_key AS adapterKey,
           revision.revision,
           revision.canonical_digest AS canonicalDigest,
           revision.document
         FROM runtime_adapter_revision AS revision
         INNER JOIN runtime_adapter_definition AS definition
           ON definition.workspace_id = revision.workspace_id
          AND definition.id = revision.runtime_adapter_definition_id
          AND definition.current_revision_id = revision.id
         WHERE definition.lifecycle_status = 'active'
           AND definition.workspace_id = ?
           AND revision.lifecycle_status = 'published'
         ORDER BY definition.adapter_key, revision.revision`,
        [workspaceId],
      );
      return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    },
  });
}
