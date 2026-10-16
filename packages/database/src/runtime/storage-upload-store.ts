import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import type {
  TrustedWorkspaceScope,
  WorkspacePermissionId,
} from "@kanvas/application";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";

export type StorageUploadMode = "server_stream" | "single_put" | "multipart";

export type StorageWriteProtectionMode =
  "server_owned" | "conditional_create" | "version_bound" | "multipart_sealed";

export type UploadSessionPurpose =
  | "attempt_output"
  | "canvas_export"
  | "user_import"
  | "model_resource"
  | "server_package";

export type UploadSessionState =
  | "open"
  | "sealing"
  | "verifying"
  | "verified"
  | "committed"
  | "rejected"
  | "aborted";

export type UploadCleanupState = "none" | "claimed" | "failed" | "done";

export type ArtifactDataClassification =
  "internal" | "confidential" | "restricted";

export interface StorageCompatibilityCapabilities {
  readonly supportsConditionalCreate: boolean;
  readonly supportsServerOwnedWrite: boolean;
  readonly supportsMultipart: boolean;
  readonly supportsRangeRead: boolean;
  readonly supportsVersionBoundIdentity: boolean;
  readonly supportsFullObjectChecksum: boolean;
  readonly sealedIdentityImmutable: boolean;
}

export interface RecordStorageCompatibilityProbeOptions {
  readonly id: string;
  readonly workspaceId: string;
  readonly probeKey: string;
  readonly requestHash: string;
  readonly storageProfileId: string;
  readonly profileConfigurationHash: string;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly capabilityContractVersion: number;
  readonly capabilities: StorageCompatibilityCapabilities;
  readonly status: "passed" | "failed";
  readonly failureCode?: string;
  readonly resultHash: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly testedAt: Date;
  readonly validUntil: Date;
  readonly createdAt: Date;
}

export interface StorageCompatibilityProbeRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly probeKey: string;
  readonly storageProfileId: string;
  readonly profileConfigurationHash: string;
  readonly status: "passed" | "failed";
  readonly capabilities: StorageCompatibilityCapabilities;
  readonly validUntil: Date;
  readonly replayed: boolean;
}

export interface AllocateUploadSessionOptions {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  /**
   * User imports are authority-bearing content commands. Attempt outputs are
   * authorized by their execution control plane and therefore omit this.
   */
  readonly authority?: TrustedWorkspaceScope;
  readonly allocationRequestKey: string;
  readonly allocationRequestHash: string;
  readonly purpose: UploadSessionPurpose;
  readonly attemptId?: string;
  readonly outputRole?: string;
  readonly outputIndex?: number;
  readonly expectedSize?: string;
  readonly expectedMediaType?: string;
  readonly expectedSha256?: string;
  readonly storageProfileId: string;
  readonly compatibilityProbeId: string;
  readonly profileConfigurationHash: string;
  readonly container: string;
  readonly objectKey: string;
  readonly uploadMode: StorageUploadMode;
  readonly writeProtectionMode: StorageWriteProtectionMode;
  readonly verificationProfileVersion: string;
  readonly now: Date;
  readonly expiresAt: Date;
  readonly cleanupEligibleAt: Date;
}

export interface UploadSessionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: UploadSessionPurpose;
  readonly attemptId?: string;
  readonly outputRole?: string;
  readonly outputIndex?: number;
  readonly expectedSize?: string;
  readonly expectedMediaType?: string;
  readonly expectedSha256?: string;
  readonly storageProfileId: string;
  readonly compatibilityProbeId: string;
  readonly profileConfigurationHash: string;
  readonly container: string;
  readonly objectKey: string;
  readonly uploadMode: StorageUploadMode;
  readonly writeProtectionMode: StorageWriteProtectionMode;
  readonly state: UploadSessionState;
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupEligibleAt: Date;
  readonly verificationProfileVersion: string;
  readonly replayed: boolean;
}

export interface BeginUploadOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly now: Date;
}

export interface BeginSealOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly sealManifestHash: string;
  readonly providerUploadId?: string;
  readonly now: Date;
}

export interface RecordSealOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly sealManifestHash: string;
  readonly sealedIdentityHash: string;
  readonly storageVersionId?: string;
  readonly providerEtag?: string;
  readonly now: Date;
}

export interface UploadSessionTransitionResult {
  readonly uploadSessionId: string;
  readonly state: UploadSessionState;
  readonly version: number;
  readonly changed: boolean;
}

export interface ClaimUploadVerificationOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly processingLeaseTokenHash: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface ClaimedUploadVerification {
  readonly uploadSessionId: string;
  readonly workspaceId: string;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string;
  readonly processingLeaseExpiresAt: Date;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly providerEtag?: string;
  readonly sealedIdentityHash: string;
  readonly expectedSize?: string;
  readonly expectedMediaType?: string;
  readonly expectedSha256?: string;
  readonly verificationProfileVersion: string;
}

export interface RecordUploadVerifiedOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string;
  readonly verifiedSize: string;
  readonly verifiedSha256: string;
  readonly detectedMediaType: string;
  readonly verificationResultHash: string;
  readonly now: Date;
}

export interface RecordUploadRejectedOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string;
  readonly reasonCode: string;
  readonly verificationResultHash: string;
  readonly now: Date;
}

export interface ClaimNextUploadCleanupOptions {
  readonly cleanupTokenHash: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface ClaimedUploadCleanup {
  readonly uploadSessionId: string;
  readonly workspaceId: string;
  readonly cleanupTokenHash: string;
  readonly cleanupLeaseExpiresAt: Date;
  readonly cleanupAttempt: number;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly providerEtag?: string;
  readonly providerUploadId?: string;
  readonly uploadMode: StorageUploadMode;
  readonly sealedIdentityHash?: string;
  readonly expectedSize?: string;
  readonly expectedSha256?: string;
  readonly verifiedSize?: string;
  readonly verifiedSha256?: string;
}

export interface FinalizeUploadCleanupSuccessOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly cleanupTokenHash: string;
  readonly result: "deleted" | "missing";
  readonly now: Date;
}

export interface FinalizeUploadCleanupFailureOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly cleanupTokenHash: string;
  readonly errorCode: string;
  readonly now: Date;
  readonly retryAt: Date;
}

export interface ReadAuthorizedCommittedObjectOptions {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly allowedDataClassifications: readonly ArtifactDataClassification[];
}

export interface ReadAttemptOutputUploadSessionOptions {
  readonly workspaceId: string;
  readonly uploadSessionId: string;
  readonly attemptId: string;
  readonly outputRole: string;
  readonly outputIndex: number;
}

export interface ReadUserImportUploadSessionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly uploadSessionId: string;
  readonly now: Date;
}

export type ReadCanvasExportUploadSessionOptions =
  ReadUserImportUploadSessionOptions;
export type ReadModelResourceUploadSessionOptions =
  ReadUserImportUploadSessionOptions;
export type ReadServerPackageUploadSessionOptions =
  ReadUserImportUploadSessionOptions;

export interface AuthorizedCommittedObject {
  readonly artifactId: string;
  readonly storedObjectId: string;
  readonly artifactType: string;
  readonly dataClassification: ArtifactDataClassification;
  readonly displayFilename?: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly providerEtag?: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: string;
}

export interface StorageUploadStore {
  recordCompatibilityProbe(
    options: RecordStorageCompatibilityProbeOptions,
  ): Promise<StorageCompatibilityProbeRecord>;
  allocateUploadSession(
    options: AllocateUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  beginUpload(
    options: BeginUploadOptions,
  ): Promise<UploadSessionTransitionResult>;
  beginSeal(options: BeginSealOptions): Promise<UploadSessionTransitionResult>;
  recordSeal(
    options: RecordSealOptions,
  ): Promise<UploadSessionTransitionResult>;
  claimVerification(
    options: ClaimUploadVerificationOptions,
  ): Promise<ClaimedUploadVerification>;
  recordVerified(
    options: RecordUploadVerifiedOptions,
  ): Promise<UploadSessionTransitionResult>;
  recordRejected(
    options: RecordUploadRejectedOptions,
  ): Promise<UploadSessionTransitionResult>;
  claimNextCleanup(
    options: ClaimNextUploadCleanupOptions,
  ): Promise<ClaimedUploadCleanup | undefined>;
  finalizeCleanupSuccess(
    options: FinalizeUploadCleanupSuccessOptions,
  ): Promise<UploadSessionTransitionResult>;
  finalizeCleanupFailure(
    options: FinalizeUploadCleanupFailureOptions,
  ): Promise<UploadSessionTransitionResult>;
  readAttemptOutputUploadSession(
    options: ReadAttemptOutputUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  readUserImportUploadSession(
    options: ReadUserImportUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  readModelResourceUploadSession(
    options: ReadModelResourceUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  readServerPackageUploadSession(
    options: ReadServerPackageUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  readCanvasExportUploadSession(
    options: ReadCanvasExportUploadSessionOptions,
  ): Promise<UploadSessionRecord>;
  readAuthorizedCommittedObject(
    options: ReadAuthorizedCommittedObjectOptions,
  ): Promise<AuthorizedCommittedObject>;
}

export type StorageUploadStoreErrorCode =
  | "storage_upload.invalid_argument"
  | "storage_upload.idempotency_conflict"
  | "storage_upload.not_found"
  | "storage_upload.state_conflict"
  | "storage_upload.expired"
  | "storage_upload.lease_conflict"
  | "storage_upload.compatibility_not_certified"
  | "storage_upload.access_denied";

export class StorageUploadStoreError extends Error {
  constructor(
    readonly code: StorageUploadStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageUploadStoreError";
  }
}

interface CompatibilityProbeRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly probeKey: string;
  readonly requestHash: string;
  readonly storageProfileId: string;
  readonly profileConfigurationHash: string;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly capabilityContractVersion: number;
  readonly supportsConditionalCreate: number;
  readonly supportsServerOwnedWrite: number;
  readonly supportsMultipart: number;
  readonly supportsRangeRead: number;
  readonly supportsVersionBoundIdentity: number;
  readonly supportsFullObjectChecksum: number;
  readonly sealedIdentityImmutable: number;
  readonly probeStatus: string;
  readonly failureCode: string | null;
  readonly resultHash: string;
  readonly validUntil: Date;
}

interface UploadSessionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string | null;
  readonly allocationRequestKey: string | null;
  readonly allocationRequestHash: string | null;
  readonly attemptId: string | null;
  readonly purpose: string;
  readonly outputRole: string | null;
  readonly outputIndex: number | null;
  readonly expectedSize: string | null;
  readonly expectedMediaType: string | null;
  readonly expectedSha256: string | null;
  readonly storageProfileId: string;
  readonly compatibilityProbeId: string | null;
  readonly profileConfigurationHash: string | null;
  readonly container: string;
  readonly objectKey: string;
  readonly uploadMode: string;
  readonly writeProtectionMode: string;
  readonly providerUploadId: string | null;
  readonly uploadStartedAt: Date | null;
  readonly sealManifestHash: string | null;
  readonly sealStartedAt: Date | null;
  readonly sealedIdentityHash: string | null;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedAt: Date | null;
  readonly state: string;
  readonly stateReasonCode: string | null;
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupEligibleAt: Date;
  readonly cleanupState: string;
  readonly processingLeaseGeneration: number;
  readonly processingLeaseTokenHash: string | null;
  readonly processingClaimedAt: Date | null;
  readonly processingLeaseExpiresAt: Date | null;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly verificationResultHash: string | null;
  readonly verificationCompletedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly verificationProfileVersion: string;
  readonly committedStoredObjectId: string | null;
  readonly cleanupTokenHash: string | null;
  readonly cleanupClaimedAt: Date | null;
  readonly cleanupLeaseExpiresAt: Date | null;
  readonly cleanupAttempts: number;
  readonly cleanupRetryAt: Date | null;
  readonly cleanupErrorCode: string | null;
  readonly cleanupResult: string | null;
  readonly cleanedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly committedAt: Date | null;
}

interface AuthorizedObjectRow extends RowDataPacket {
  readonly artifactId: string;
  readonly artifactWorkspaceId: string;
  readonly artifactType: string;
  readonly availabilityStatus: string;
  readonly dataClassification: string;
  readonly displayFilename: string | null;
  readonly storedObjectId: string;
  readonly storedWorkspaceId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly immutableIdentityHash: string | null;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly deleteState: string;
  readonly uploadSessionId: string;
  readonly uploadWorkspaceId: string;
  readonly uploadState: string;
  readonly uploadCleanupState: string;
  readonly committedStoredObjectId: string | null;
  readonly allocationRequestKey: string | null;
  readonly uploadStorageProfileId: string;
  readonly uploadContainer: string;
  readonly uploadObjectKey: string;
  readonly uploadStorageVersionId: string | null;
  readonly uploadProviderEtag: string | null;
  readonly uploadSealedIdentityHash: string | null;
}

const idPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const tokenHashPattern = /^[0-9a-f]{64}$/u;
const errorCodePattern = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const asciiPattern = /^[\x21-\x7e]+$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const maximumUint64 = 18_446_744_073_709_551_615n;

const uploadSessionSelect = `SELECT
  id,
  workspace_id AS workspaceId,
  actor_id AS actorId,
  allocation_request_key AS allocationRequestKey,
  allocation_request_hash AS allocationRequestHash,
  attempt_id AS attemptId,
  purpose,
  output_role AS outputRole,
  output_index AS outputIndex,
  CAST(expected_size AS CHAR) AS expectedSize,
  expected_media_type AS expectedMediaType,
  expected_sha256 AS expectedSha256,
  storage_profile_id AS storageProfileId,
  compatibility_probe_id AS compatibilityProbeId,
  profile_configuration_hash AS profileConfigurationHash,
  container,
  object_key AS objectKey,
  upload_mode AS uploadMode,
  write_protection_mode AS writeProtectionMode,
  provider_upload_id AS providerUploadId,
  upload_started_at AS uploadStartedAt,
  seal_manifest_hash AS sealManifestHash,
  seal_started_at AS sealStartedAt,
  sealed_identity_hash AS sealedIdentityHash,
  storage_version_id AS storageVersionId,
  provider_etag AS providerEtag,
  sealed_at AS sealedAt,
  state,
  state_reason_code AS stateReasonCode,
  version,
  expires_at AS expiresAt,
  cleanup_eligible_at AS cleanupEligibleAt,
  cleanup_state AS cleanupState,
  processing_lease_generation AS processingLeaseGeneration,
  processing_lease_token_hash AS processingLeaseTokenHash,
  processing_claimed_at AS processingClaimedAt,
  processing_lease_expires_at AS processingLeaseExpiresAt,
  CAST(verified_size AS CHAR) AS verifiedSize,
  verified_sha256 AS verifiedSha256,
  detected_media_type AS detectedMediaType,
  verification_result_hash AS verificationResultHash,
  verification_completed_at AS verificationCompletedAt,
  verified_at AS verifiedAt,
  verification_profile_version AS verificationProfileVersion,
  committed_stored_object_id AS committedStoredObjectId,
  cleanup_token_hash AS cleanupTokenHash,
  cleanup_claimed_at AS cleanupClaimedAt,
  cleanup_lease_expires_at AS cleanupLeaseExpiresAt,
  cleanup_attempts AS cleanupAttempts,
  cleanup_retry_at AS cleanupRetryAt,
  cleanup_error_code AS cleanupErrorCode,
  cleanup_result AS cleanupResult,
  cleaned_at AS cleanedAt,
  created_at AS createdAt,
  updated_at AS updatedAt,
  committed_at AS committedAt
FROM upload_session`;

function fail(code: StorageUploadStoreErrorCode, message: string): never {
  throw new StorageUploadStoreError(code, message);
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function validId(value: string): boolean {
  return idPattern.test(value);
}

function boundedAscii(value: string, maximum: number): boolean {
  return (
    value.length >= 1 && value.length <= maximum && asciiPattern.test(value)
  );
}

function boundedText(value: string, maximum: number): boolean {
  return (
    value.length >= 1 &&
    value.length <= maximum &&
    [...value].every((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && code >= 32 && code !== 127;
    })
  );
}

function validUint64(value: string): boolean {
  if (!uint64Pattern.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= maximumUint64;
  } catch {
    return false;
  }
}

function sameDate(left: Date | null, right: Date | undefined): boolean {
  return (
    (left === null && right === undefined) ||
    (left !== null && right !== undefined && left.getTime() === right.getTime())
  );
}

function parsePurpose(value: string): UploadSessionPurpose {
  if (
    value === "attempt_output" ||
    value === "canvas_export" ||
    value === "user_import" ||
    value === "model_resource" ||
    value === "server_package"
  ) {
    return value;
  }
  return fail(
    "storage_upload.state_conflict",
    "UploadSession has an unsupported purpose.",
  );
}

function parseState(value: string): UploadSessionState {
  if (
    value === "open" ||
    value === "sealing" ||
    value === "verifying" ||
    value === "verified" ||
    value === "committed" ||
    value === "rejected" ||
    value === "aborted"
  ) {
    return value;
  }
  return fail(
    "storage_upload.state_conflict",
    "UploadSession has an unsupported state.",
  );
}

function parseUploadMode(value: string): StorageUploadMode {
  if (
    value === "server_stream" ||
    value === "single_put" ||
    value === "multipart"
  ) {
    return value;
  }
  return fail(
    "storage_upload.state_conflict",
    "UploadSession has an unsupported upload mode.",
  );
}

function parseWriteProtection(value: string): StorageWriteProtectionMode {
  if (
    value === "server_owned" ||
    value === "conditional_create" ||
    value === "version_bound" ||
    value === "multipart_sealed"
  ) {
    return value;
  }
  return fail(
    "storage_upload.state_conflict",
    "UploadSession has an unsupported write-protection mode.",
  );
}

function parseClassification(value: string): ArtifactDataClassification {
  if (
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
  ) {
    return value;
  }
  return fail(
    "storage_upload.access_denied",
    "The artifact classification is not authorized.",
  );
}

function assertJsonRecord(value: Readonly<Record<string, unknown>>): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 65_535) {
      fail(
        "storage_upload.invalid_argument",
        "Compatibility probe evidence is too large.",
      );
    }
    return serialized;
  } catch {
    return fail(
      "storage_upload.invalid_argument",
      "Compatibility probe evidence must be serializable JSON.",
    );
  }
}

function capabilitiesFromRow(
  row: CompatibilityProbeRow,
): StorageCompatibilityCapabilities {
  return Object.freeze({
    supportsConditionalCreate: row.supportsConditionalCreate === 1,
    supportsServerOwnedWrite: row.supportsServerOwnedWrite === 1,
    supportsMultipart: row.supportsMultipart === 1,
    supportsRangeRead: row.supportsRangeRead === 1,
    supportsVersionBoundIdentity: row.supportsVersionBoundIdentity === 1,
    supportsFullObjectChecksum: row.supportsFullObjectChecksum === 1,
    sealedIdentityImmutable: row.sealedIdentityImmutable === 1,
  });
}

function assertProbeOptions(
  options: RecordStorageCompatibilityProbeOptions,
): string {
  if (
    !validId(options.id) ||
    !validId(options.workspaceId) ||
    !validId(options.storageProfileId) ||
    !boundedAscii(options.probeKey, 160) ||
    !digestPattern.test(options.requestHash) ||
    !digestPattern.test(options.profileConfigurationHash) ||
    !boundedAscii(options.adapterKey, 160) ||
    !boundedAscii(options.adapterVersion, 80) ||
    !Number.isInteger(options.capabilityContractVersion) ||
    options.capabilityContractVersion < 1 ||
    options.capabilityContractVersion > 65_535 ||
    !digestPattern.test(options.resultHash) ||
    !validDate(options.testedAt) ||
    !validDate(options.validUntil) ||
    !validDate(options.createdAt) ||
    options.validUntil <= options.testedAt ||
    options.createdAt < options.testedAt ||
    (options.status !== "passed" && options.status !== "failed") ||
    (options.status === "passed" &&
      (options.failureCode !== undefined ||
        !options.capabilities.sealedIdentityImmutable ||
        !options.capabilities.supportsRangeRead)) ||
    (options.status === "failed" &&
      (options.failureCode === undefined ||
        !errorCodePattern.test(options.failureCode)))
  ) {
    return fail(
      "storage_upload.invalid_argument",
      "Invalid storage compatibility probe facts.",
    );
  }
  return assertJsonRecord(options.evidence);
}

function assertAllocationOptions(options: AllocateUploadSessionOptions): void {
  const attemptShape =
    options.purpose === "attempt_output"
      ? options.attemptId !== undefined &&
        validId(options.attemptId) &&
        options.outputRole !== undefined &&
        boundedAscii(options.outputRole, 80) &&
        options.outputIndex !== undefined &&
        Number.isInteger(options.outputIndex) &&
        options.outputIndex >= 0 &&
        options.outputIndex <= 4_294_967_295
      : options.attemptId === undefined &&
        options.outputRole === undefined &&
        options.outputIndex === undefined;
  const authorityShape =
    options.purpose === "user_import" ||
    options.purpose === "canvas_export" ||
    options.purpose === "model_resource" ||
    options.purpose === "server_package"
      ? options.authority !== undefined &&
        options.authority.trusted === true &&
        options.authority.workspaceId === options.workspaceId &&
        options.authority.principalId === options.actorId
      : options.authority === undefined;
  if (
    (options.purpose !== "attempt_output" &&
      options.purpose !== "canvas_export" &&
      options.purpose !== "user_import" &&
      options.purpose !== "model_resource" &&
      options.purpose !== "server_package") ||
    (options.uploadMode !== "server_stream" &&
      options.uploadMode !== "single_put" &&
      options.uploadMode !== "multipart") ||
    (options.writeProtectionMode !== "server_owned" &&
      options.writeProtectionMode !== "conditional_create" &&
      options.writeProtectionMode !== "version_bound" &&
      options.writeProtectionMode !== "multipart_sealed") ||
    !validId(options.id) ||
    !validId(options.workspaceId) ||
    !validId(options.actorId) ||
    !validId(options.storageProfileId) ||
    !validId(options.compatibilityProbeId) ||
    !boundedAscii(options.allocationRequestKey, 160) ||
    !digestPattern.test(options.allocationRequestHash) ||
    !digestPattern.test(options.profileConfigurationHash) ||
    !attemptShape ||
    !authorityShape ||
    (options.expectedSize !== undefined &&
      !validUint64(options.expectedSize)) ||
    (options.expectedMediaType !== undefined &&
      (!mediaTypePattern.test(options.expectedMediaType) ||
        options.expectedMediaType.length > 160)) ||
    (options.expectedSha256 !== undefined &&
      !sha256Pattern.test(options.expectedSha256)) ||
    !boundedAscii(options.container, 160) ||
    !boundedText(options.objectKey, 800) ||
    !boundedAscii(options.verificationProfileVersion, 80) ||
    !validDate(options.now) ||
    !validDate(options.expiresAt) ||
    !validDate(options.cleanupEligibleAt) ||
    options.expiresAt <= options.now ||
    options.cleanupEligibleAt <= options.expiresAt ||
    (options.uploadMode === "server_stream" &&
      options.writeProtectionMode !== "server_owned") ||
    (options.uploadMode === "multipart" &&
      options.writeProtectionMode !== "multipart_sealed") ||
    (options.writeProtectionMode === "multipart_sealed" &&
      options.uploadMode !== "multipart")
  ) {
    fail(
      "storage_upload.invalid_argument",
      "Invalid UploadSession allocation facts.",
    );
  }
}

function assertTransitionIdentity(
  workspaceId: string,
  uploadSessionId: string,
  now: Date,
): void {
  if (!validId(workspaceId) || !validId(uploadSessionId) || !validDate(now)) {
    fail(
      "storage_upload.invalid_argument",
      "Invalid UploadSession transition identity.",
    );
  }
}

function assertTokenHash(value: string): void {
  if (!tokenHashPattern.test(value)) {
    fail("storage_upload.invalid_argument", "Invalid lease token hash.");
  }
}

function toProbeRecord(
  row: CompatibilityProbeRow,
  replayed: boolean,
): StorageCompatibilityProbeRecord {
  if (row.probeStatus !== "passed" && row.probeStatus !== "failed") {
    return fail(
      "storage_upload.state_conflict",
      "Compatibility probe has an unsupported status.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    probeKey: row.probeKey,
    storageProfileId: row.storageProfileId,
    profileConfigurationHash: row.profileConfigurationHash,
    status: row.probeStatus,
    capabilities: capabilitiesFromRow(row),
    validUntil: row.validUntil,
    replayed,
  });
}

function toUploadRecord(
  row: UploadSessionRow,
  replayed: boolean,
): UploadSessionRecord {
  if (
    !row.actorId ||
    !row.compatibilityProbeId ||
    !row.profileConfigurationHash
  ) {
    return fail(
      "storage_upload.state_conflict",
      "Allocated UploadSession is missing certified identity facts.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    purpose: parsePurpose(row.purpose),
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    ...(row.outputRole ? { outputRole: row.outputRole } : {}),
    ...(row.outputIndex !== null ? { outputIndex: row.outputIndex } : {}),
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
    uploadMode: parseUploadMode(row.uploadMode),
    writeProtectionMode: parseWriteProtection(row.writeProtectionMode),
    state: parseState(row.state),
    version: row.version,
    expiresAt: row.expiresAt,
    cleanupEligibleAt: row.cleanupEligibleAt,
    verificationProfileVersion: row.verificationProfileVersion,
    replayed,
  });
}

async function inTransaction<T>(
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

async function selectProbeByRequest(
  connection: PoolConnection,
  workspaceId: string,
  probeKey: string,
): Promise<CompatibilityProbeRow | undefined> {
  const [rows] = await connection.execute<CompatibilityProbeRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       probe_key AS probeKey,
       request_hash AS requestHash,
       storage_profile_id AS storageProfileId,
       profile_configuration_hash AS profileConfigurationHash,
       adapter_key AS adapterKey,
       adapter_version AS adapterVersion,
       capability_contract_version AS capabilityContractVersion,
       supports_conditional_create AS supportsConditionalCreate,
       supports_server_owned_write AS supportsServerOwnedWrite,
       supports_multipart AS supportsMultipart,
       supports_range_read AS supportsRangeRead,
       supports_version_bound_identity AS supportsVersionBoundIdentity,
       supports_full_object_checksum AS supportsFullObjectChecksum,
       sealed_identity_immutable AS sealedIdentityImmutable,
       probe_status AS probeStatus,
       failure_code AS failureCode,
       result_hash AS resultHash,
       valid_until AS validUntil
     FROM storage_compatibility_probe
     WHERE workspace_id = ?
       AND probe_key = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, probeKey],
  );
  return rows[0];
}

async function lockProbeForAllocation(
  connection: PoolConnection,
  options: AllocateUploadSessionOptions,
): Promise<CompatibilityProbeRow> {
  const [rows] = await connection.execute<CompatibilityProbeRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       probe_key AS probeKey,
       request_hash AS requestHash,
       storage_profile_id AS storageProfileId,
       profile_configuration_hash AS profileConfigurationHash,
       adapter_key AS adapterKey,
       adapter_version AS adapterVersion,
       capability_contract_version AS capabilityContractVersion,
       supports_conditional_create AS supportsConditionalCreate,
       supports_server_owned_write AS supportsServerOwnedWrite,
       supports_multipart AS supportsMultipart,
       supports_range_read AS supportsRangeRead,
       supports_version_bound_identity AS supportsVersionBoundIdentity,
       supports_full_object_checksum AS supportsFullObjectChecksum,
       sealed_identity_immutable AS sealedIdentityImmutable,
       probe_status AS probeStatus,
       failure_code AS failureCode,
       result_hash AS resultHash,
       valid_until AS validUntil
     FROM storage_compatibility_probe
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [options.workspaceId, options.compatibilityProbeId],
  );
  const probe = rows[0];
  if (
    !probe ||
    probe.storageProfileId !== options.storageProfileId ||
    probe.profileConfigurationHash !== options.profileConfigurationHash ||
    probe.probeStatus !== "passed" ||
    probe.validUntil <= options.now
  ) {
    return fail(
      "storage_upload.compatibility_not_certified",
      "The storage profile does not have a current passing compatibility probe.",
    );
  }
  const capabilities = capabilitiesFromRow(probe);
  const compatible =
    capabilities.sealedIdentityImmutable &&
    capabilities.supportsRangeRead &&
    ((options.writeProtectionMode === "server_owned" &&
      capabilities.supportsServerOwnedWrite) ||
      (options.writeProtectionMode === "conditional_create" &&
        capabilities.supportsConditionalCreate) ||
      (options.writeProtectionMode === "version_bound" &&
        capabilities.supportsVersionBoundIdentity) ||
      (options.writeProtectionMode === "multipart_sealed" &&
        capabilities.supportsMultipart));
  if (!compatible) {
    return fail(
      "storage_upload.compatibility_not_certified",
      "The compatibility probe does not certify the requested upload and write-protection mode.",
    );
  }
  return probe;
}

async function lockSession(
  connection: PoolConnection,
  workspaceId: string,
  uploadSessionId: string,
): Promise<UploadSessionRow> {
  const [rows] = await connection.execute<UploadSessionRow[]>(
    `${uploadSessionSelect}
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, uploadSessionId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "storage_upload.not_found",
      "UploadSession was not found in the workspace.",
    );
  }
  return row;
}

function assertSessionOpenForMutation(row: UploadSessionRow, now: Date): void {
  if (row.cleanupState !== "none") {
    fail(
      "storage_upload.state_conflict",
      "UploadSession cleanup has already started.",
    );
  }
  if (row.expiresAt <= now) {
    fail(
      "storage_upload.expired",
      "UploadSession is expired at the requested transition time.",
    );
  }
}

function transitionResult(
  row: UploadSessionRow,
  changed: boolean,
  state = parseState(row.state),
  version = row.version,
): UploadSessionTransitionResult {
  return Object.freeze({
    uploadSessionId: row.id,
    state,
    version,
    changed,
  });
}

function sameNullable(left: string | null, right: string | undefined): boolean {
  return left === (right ?? null);
}

function assertAllocationReplay(
  row: UploadSessionRow,
  options: AllocateUploadSessionOptions,
): void {
  if (
    row.allocationRequestHash !== options.allocationRequestHash ||
    row.actorId !== options.actorId ||
    row.purpose !== options.purpose ||
    row.attemptId !== (options.attemptId ?? null) ||
    row.outputRole !== (options.outputRole ?? null) ||
    row.outputIndex !== (options.outputIndex ?? null) ||
    row.expectedSize !== (options.expectedSize ?? null) ||
    row.expectedMediaType !== (options.expectedMediaType ?? null) ||
    row.expectedSha256 !== (options.expectedSha256 ?? null) ||
    row.storageProfileId !== options.storageProfileId ||
    row.compatibilityProbeId !== options.compatibilityProbeId ||
    row.profileConfigurationHash !== options.profileConfigurationHash ||
    row.container !== options.container ||
    row.uploadMode !== options.uploadMode ||
    row.writeProtectionMode !== options.writeProtectionMode ||
    row.verificationProfileVersion !== options.verificationProfileVersion
  ) {
    fail(
      "storage_upload.idempotency_conflict",
      "Allocation request key is already bound to different UploadSession facts.",
    );
  }
}

function assertProbeReplay(
  row: CompatibilityProbeRow,
  options: RecordStorageCompatibilityProbeOptions,
): void {
  const capabilities = capabilitiesFromRow(row);
  if (
    row.requestHash !== options.requestHash ||
    row.storageProfileId !== options.storageProfileId ||
    row.profileConfigurationHash !== options.profileConfigurationHash ||
    row.adapterKey !== options.adapterKey ||
    row.adapterVersion !== options.adapterVersion ||
    row.capabilityContractVersion !== options.capabilityContractVersion ||
    row.probeStatus !== options.status ||
    row.failureCode !== (options.failureCode ?? null) ||
    row.resultHash !== options.resultHash ||
    row.validUntil.getTime() !== options.validUntil.getTime() ||
    capabilities.supportsConditionalCreate !==
      options.capabilities.supportsConditionalCreate ||
    capabilities.supportsServerOwnedWrite !==
      options.capabilities.supportsServerOwnedWrite ||
    capabilities.supportsMultipart !== options.capabilities.supportsMultipart ||
    capabilities.supportsRangeRead !== options.capabilities.supportsRangeRead ||
    capabilities.supportsVersionBoundIdentity !==
      options.capabilities.supportsVersionBoundIdentity ||
    capabilities.supportsFullObjectChecksum !==
      options.capabilities.supportsFullObjectChecksum ||
    capabilities.sealedIdentityImmutable !==
      options.capabilities.sealedIdentityImmutable
  ) {
    fail(
      "storage_upload.idempotency_conflict",
      "Probe request key is already bound to different compatibility facts.",
    );
  }
}

export function createStorageUploadStore(pool: Pool): StorageUploadStore {
  return Object.freeze<StorageUploadStore>({
    async recordCompatibilityProbe(options) {
      const evidence = assertProbeOptions(options);
      return inTransaction(pool, async (connection) => {
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO storage_compatibility_probe (
             id,
             workspace_id,
             probe_key,
             request_hash,
             storage_profile_id,
             profile_configuration_hash,
             adapter_key,
             adapter_version,
             capability_contract_version,
             supports_conditional_create,
             supports_server_owned_write,
             supports_multipart,
             supports_range_read,
             supports_version_bound_identity,
             supports_full_object_checksum,
             sealed_identity_immutable,
             probe_status,
             failure_code,
             result_hash,
             evidence,
             tested_at,
             valid_until,
             created_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?
           )
           ON DUPLICATE KEY UPDATE
             capability_contract_version =
               LAST_INSERT_ID(capability_contract_version)`,
          [
            options.id,
            options.workspaceId,
            options.probeKey,
            options.requestHash,
            options.storageProfileId,
            options.profileConfigurationHash,
            options.adapterKey,
            options.adapterVersion,
            options.capabilityContractVersion,
            options.capabilities.supportsConditionalCreate ? 1 : 0,
            options.capabilities.supportsServerOwnedWrite ? 1 : 0,
            options.capabilities.supportsMultipart ? 1 : 0,
            options.capabilities.supportsRangeRead ? 1 : 0,
            options.capabilities.supportsVersionBoundIdentity ? 1 : 0,
            options.capabilities.supportsFullObjectChecksum ? 1 : 0,
            options.capabilities.sealedIdentityImmutable ? 1 : 0,
            options.status,
            options.failureCode ?? null,
            options.resultHash,
            evidence,
            options.testedAt,
            options.validUntil,
            options.createdAt,
          ],
        );
        const persisted = await selectProbeByRequest(
          connection,
          options.workspaceId,
          options.probeKey,
        );
        if (!persisted) {
          return fail(
            "storage_upload.idempotency_conflict",
            "Compatibility probe identity collides with a different request.",
          );
        }
        assertProbeReplay(persisted, options);
        return toProbeRecord(persisted, insertResult.insertId > 0);
      });
    },

    async allocateUploadSession(options) {
      assertAllocationOptions(options);
      return inTransaction(pool, async (connection) => {
        if (
          options.purpose === "user_import" ||
          options.purpose === "canvas_export" ||
          options.purpose === "model_resource" ||
          options.purpose === "server_package"
        ) {
          let permission: WorkspacePermissionId = "asset.write";
          if (options.purpose === "model_resource") {
            permission = "capability.configure";
          } else if (options.purpose === "server_package") {
            permission = "skill.manage";
          }
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            options.authority as TrustedWorkspaceScope,
            permission,
            options.now,
          );
        }
        await lockProbeForAllocation(connection, options);
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO upload_session (
             id,
             workspace_id,
             attempt_id,
             purpose,
             actor_id,
             allocation_request_key,
             allocation_request_hash,
             output_role,
             output_index,
             expected_size,
             expected_media_type,
             expected_sha256,
             storage_profile_id,
             compatibility_probe_id,
             profile_configuration_hash,
             container,
             object_key,
             upload_mode,
             write_protection_mode,
             state,
             state_reason_code,
             version,
             expires_at,
             cleanup_eligible_at,
             cleanup_state,
             processing_lease_generation,
             verification_profile_version,
             cleanup_attempts,
             created_at,
             updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'open', NULL, 1, ?, ?, 'none', 0, ?, 0, ?, ?
           )
           ON DUPLICATE KEY UPDATE
             version = LAST_INSERT_ID(version)`,
          [
            options.id,
            options.workspaceId,
            options.attemptId ?? null,
            options.purpose,
            options.actorId,
            options.allocationRequestKey,
            options.allocationRequestHash,
            options.outputRole ?? null,
            options.outputIndex ?? null,
            options.expectedSize ?? null,
            options.expectedMediaType ?? null,
            options.expectedSha256 ?? null,
            options.storageProfileId,
            options.compatibilityProbeId,
            options.profileConfigurationHash,
            options.container,
            options.objectKey,
            options.uploadMode,
            options.writeProtectionMode,
            options.expiresAt,
            options.cleanupEligibleAt,
            options.verificationProfileVersion,
            options.now,
            options.now,
          ],
        );
        const [persistedRows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
             WHERE workspace_id = ?
               AND allocation_request_key = ?
             LIMIT 1
             FOR UPDATE`,
          [options.workspaceId, options.allocationRequestKey],
        );
        const persisted = persistedRows[0];
        if (!persisted) {
          return fail(
            "storage_upload.idempotency_conflict",
            "Upload target identity collides with a different allocation request.",
          );
        }
        assertAllocationReplay(persisted, options);
        return toUploadRecord(persisted, insertResult.insertId > 0);
      });
    },

    async beginUpload(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        const state = parseState(row.state);
        if (
          row.uploadStartedAt !== null &&
          state !== "rejected" &&
          state !== "aborted"
        ) {
          if (state === "open") {
            assertSessionOpenForMutation(row, options.now);
          }
          return transitionResult(row, false);
        }
        if (state !== "open") {
          return fail(
            "storage_upload.state_conflict",
            "Only an open UploadSession can begin its producer write.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET upload_started_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [options.now, options.now, row.id, row.workspaceId, row.version],
        );
        return transitionResult(row, true, "open", row.version + 1);
      });
    },

    async beginSeal(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      if (
        !digestPattern.test(options.sealManifestHash) ||
        (options.providerUploadId !== undefined &&
          !boundedAscii(options.providerUploadId, 240))
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid seal request facts.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (row.sealManifestHash !== null) {
          if (
            row.sealManifestHash !== options.sealManifestHash ||
            !sameNullable(row.providerUploadId, options.providerUploadId)
          ) {
            return fail(
              "storage_upload.idempotency_conflict",
              "UploadSession is already bound to a different seal manifest.",
            );
          }
          if (row.state === "sealing") {
            assertSessionOpenForMutation(row, options.now);
          }
          return transitionResult(row, false);
        }
        if (row.state !== "open" || row.uploadStartedAt === null) {
          return fail(
            "storage_upload.state_conflict",
            "Only an open UploadSession with a recorded producer write can begin sealing.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET state = 'sealing',
               seal_manifest_hash = ?,
               provider_upload_id = ?,
               seal_started_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.sealManifestHash,
            options.providerUploadId ?? null,
            options.now,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(row, true, "sealing", row.version + 1);
      });
    },

    async recordSeal(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      if (
        !digestPattern.test(options.sealManifestHash) ||
        !digestPattern.test(options.sealedIdentityHash) ||
        (options.storageVersionId !== undefined &&
          !boundedAscii(options.storageVersionId, 240)) ||
        (options.providerEtag !== undefined &&
          !boundedText(options.providerEtag, 240))
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid sealed object identity facts.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (
          row.state === "verifying" ||
          row.state === "verified" ||
          row.state === "committed"
        ) {
          if (
            row.sealManifestHash !== options.sealManifestHash ||
            row.sealedIdentityHash !== options.sealedIdentityHash ||
            !sameNullable(row.storageVersionId, options.storageVersionId) ||
            !sameNullable(row.providerEtag, options.providerEtag)
          ) {
            return fail(
              "storage_upload.idempotency_conflict",
              "UploadSession is already sealed to a different immutable identity.",
            );
          }
          return transitionResult(row, false);
        }
        if (
          row.state !== "sealing" ||
          row.sealManifestHash !== options.sealManifestHash ||
          row.sealStartedAt === null
        ) {
          return fail(
            "storage_upload.state_conflict",
            "UploadSession does not have the matching in-progress seal.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        if (
          row.writeProtectionMode === "version_bound" &&
          options.storageVersionId === undefined
        ) {
          return fail(
            "storage_upload.invalid_argument",
            "Version-bound storage requires a sealed storage version.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET state = 'verifying',
               sealed_identity_hash = ?,
               storage_version_id = ?,
               provider_etag = ?,
               sealed_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.sealedIdentityHash,
            options.storageVersionId ?? null,
            options.providerEtag ?? null,
            options.now,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(row, true, "verifying", row.version + 1);
      });
    },

    async claimVerification(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      assertTokenHash(options.processingLeaseTokenHash);
      if (
        !validDate(options.leaseExpiresAt) ||
        options.leaseExpiresAt <= options.now
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Verification lease must end after its claim time.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (
          row.state !== "verifying" ||
          !row.sealedIdentityHash ||
          !row.sealManifestHash
        ) {
          return fail(
            "storage_upload.state_conflict",
            "Only a verifying UploadSession can be claimed for byte inspection.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        if (options.leaseExpiresAt > row.expiresAt) {
          return fail(
            "storage_upload.invalid_argument",
            "Verification lease cannot outlive the UploadSession.",
          );
        }
        if (
          row.processingLeaseTokenHash !== null &&
          row.processingLeaseExpiresAt !== null &&
          row.processingLeaseExpiresAt > options.now
        ) {
          if (
            row.processingLeaseTokenHash === options.processingLeaseTokenHash
          ) {
            if (
              row.processingLeaseExpiresAt.getTime() !==
              options.leaseExpiresAt.getTime()
            ) {
              return fail(
                "storage_upload.lease_conflict",
                "Verification lease token is bound to a different deadline.",
              );
            }
            return Object.freeze({
              uploadSessionId: row.id,
              workspaceId: row.workspaceId,
              processingLeaseGeneration: row.processingLeaseGeneration,
              processingLeaseTokenHash: row.processingLeaseTokenHash,
              processingLeaseExpiresAt: row.processingLeaseExpiresAt,
              storageProfileId: row.storageProfileId,
              container: row.container,
              objectKey: row.objectKey,
              ...(row.storageVersionId
                ? { storageVersionId: row.storageVersionId }
                : {}),
              ...(row.providerEtag ? { providerEtag: row.providerEtag } : {}),
              sealedIdentityHash: row.sealedIdentityHash,
              ...(row.expectedSize ? { expectedSize: row.expectedSize } : {}),
              ...(row.expectedMediaType
                ? { expectedMediaType: row.expectedMediaType }
                : {}),
              ...(row.expectedSha256
                ? { expectedSha256: row.expectedSha256 }
                : {}),
              verificationProfileVersion: row.verificationProfileVersion,
            });
          }
          return fail(
            "storage_upload.lease_conflict",
            "UploadSession has a live verification lease.",
          );
        }
        const generation = row.processingLeaseGeneration + 1;
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET processing_lease_generation = ?,
               processing_lease_token_hash = ?,
               processing_claimed_at = ?,
               processing_lease_expires_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            generation,
            options.processingLeaseTokenHash,
            options.now,
            options.leaseExpiresAt,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return Object.freeze({
          uploadSessionId: row.id,
          workspaceId: row.workspaceId,
          processingLeaseGeneration: generation,
          processingLeaseTokenHash: options.processingLeaseTokenHash,
          processingLeaseExpiresAt: options.leaseExpiresAt,
          storageProfileId: row.storageProfileId,
          container: row.container,
          objectKey: row.objectKey,
          ...(row.storageVersionId
            ? { storageVersionId: row.storageVersionId }
            : {}),
          ...(row.providerEtag ? { providerEtag: row.providerEtag } : {}),
          sealedIdentityHash: row.sealedIdentityHash,
          ...(row.expectedSize ? { expectedSize: row.expectedSize } : {}),
          ...(row.expectedMediaType
            ? { expectedMediaType: row.expectedMediaType }
            : {}),
          ...(row.expectedSha256 ? { expectedSha256: row.expectedSha256 } : {}),
          verificationProfileVersion: row.verificationProfileVersion,
        });
      });
    },

    async recordVerified(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      assertTokenHash(options.processingLeaseTokenHash);
      if (
        !Number.isInteger(options.processingLeaseGeneration) ||
        options.processingLeaseGeneration < 1 ||
        !validUint64(options.verifiedSize) ||
        !sha256Pattern.test(options.verifiedSha256) ||
        !mediaTypePattern.test(options.detectedMediaType) ||
        options.detectedMediaType.length > 160 ||
        !digestPattern.test(options.verificationResultHash)
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid trusted verification result.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (row.state === "verified" || row.state === "committed") {
          if (
            row.verifiedSize !== options.verifiedSize ||
            row.verifiedSha256 !== options.verifiedSha256 ||
            row.detectedMediaType !== options.detectedMediaType ||
            row.verificationResultHash !== options.verificationResultHash
          ) {
            return fail(
              "storage_upload.idempotency_conflict",
              "UploadSession already has a different trusted verification result.",
            );
          }
          return transitionResult(row, false);
        }
        if (row.state !== "verifying") {
          return fail(
            "storage_upload.state_conflict",
            "Only a verifying UploadSession can record verification.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        if (
          row.processingLeaseGeneration !== options.processingLeaseGeneration ||
          row.processingLeaseTokenHash !== options.processingLeaseTokenHash ||
          row.processingLeaseExpiresAt === null ||
          row.processingLeaseExpiresAt <= options.now
        ) {
          return fail(
            "storage_upload.lease_conflict",
            "Verification lease is missing, stale, or expired.",
          );
        }
        if (
          (row.expectedSize !== null &&
            row.expectedSize !== options.verifiedSize) ||
          (row.expectedSha256 !== null &&
            row.expectedSha256 !== options.verifiedSha256) ||
          (row.expectedMediaType !== null &&
            row.expectedMediaType !== options.detectedMediaType)
        ) {
          return fail(
            "storage_upload.state_conflict",
            "Trusted verification result violates allocated constraints.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET state = 'verified',
               verified_size = ?,
               verified_sha256 = ?,
               detected_media_type = ?,
               verification_result_hash = ?,
               verification_completed_at = ?,
               verified_at = ?,
               processing_lease_token_hash = NULL,
               processing_claimed_at = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.verifiedSize,
            options.verifiedSha256,
            options.detectedMediaType,
            options.verificationResultHash,
            options.now,
            options.now,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(row, true, "verified", row.version + 1);
      });
    },

    async recordRejected(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      assertTokenHash(options.processingLeaseTokenHash);
      if (
        !Number.isInteger(options.processingLeaseGeneration) ||
        options.processingLeaseGeneration < 1 ||
        !errorCodePattern.test(options.reasonCode) ||
        !digestPattern.test(options.verificationResultHash)
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid verification rejection facts.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (row.state === "rejected") {
          if (
            row.stateReasonCode !== options.reasonCode ||
            row.verificationResultHash !== options.verificationResultHash
          ) {
            return fail(
              "storage_upload.idempotency_conflict",
              "UploadSession already has a different rejection result.",
            );
          }
          return transitionResult(row, false);
        }
        if (row.state !== "verifying") {
          return fail(
            "storage_upload.state_conflict",
            "Only a verifying UploadSession can record rejection.",
          );
        }
        assertSessionOpenForMutation(row, options.now);
        if (
          row.processingLeaseGeneration !== options.processingLeaseGeneration ||
          row.processingLeaseTokenHash !== options.processingLeaseTokenHash ||
          row.processingLeaseExpiresAt === null ||
          row.processingLeaseExpiresAt <= options.now
        ) {
          return fail(
            "storage_upload.lease_conflict",
            "Verification lease is missing, stale, or expired.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET state = 'rejected',
               state_reason_code = ?,
               verification_result_hash = ?,
               verification_completed_at = ?,
               verified_at = NULL,
               processing_lease_token_hash = NULL,
               processing_claimed_at = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.reasonCode,
            options.verificationResultHash,
            options.now,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(row, true, "rejected", row.version + 1);
      });
    },

    async claimNextCleanup(options) {
      assertTokenHash(options.cleanupTokenHash);
      if (
        !validDate(options.now) ||
        !validDate(options.leaseExpiresAt) ||
        options.leaseExpiresAt <= options.now
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid cleanup claim lease.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
           WHERE state <> 'committed'
             AND cleanup_eligible_at <= ?
             AND (
               cleanup_retry_at IS NULL
               OR cleanup_retry_at <= ?
             )
             AND (
               cleanup_state IN ('none', 'failed')
               OR (
                 cleanup_state = 'claimed'
                 AND cleanup_lease_expires_at <= ?
               )
             )
             AND (
               processing_lease_expires_at IS NULL
               OR processing_lease_expires_at <= ?
             )
           ORDER BY
             cleanup_eligible_at,
             id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [options.now, options.now, options.now, options.now],
        );
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        const state = row.state === "rejected" ? "rejected" : "aborted";
        const reason =
          state === "rejected" ? row.stateReasonCode : "upload.expired";
        const attempt = row.cleanupAttempts + 1;
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET state = ?,
               state_reason_code = ?,
               cleanup_state = 'claimed',
               cleanup_token_hash = ?,
               cleanup_claimed_at = ?,
               cleanup_lease_expires_at = ?,
               cleanup_attempts = ?,
               cleanup_retry_at = NULL,
               cleanup_error_code = NULL,
               cleanup_result = NULL,
               cleaned_at = NULL,
               processing_lease_token_hash = NULL,
               processing_claimed_at = NULL,
               processing_lease_expires_at = NULL,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND version = ?`,
          [
            state,
            reason,
            options.cleanupTokenHash,
            options.now,
            options.leaseExpiresAt,
            attempt,
            options.now,
            row.id,
            row.version,
          ],
        );
        return Object.freeze({
          uploadSessionId: row.id,
          workspaceId: row.workspaceId,
          cleanupTokenHash: options.cleanupTokenHash,
          cleanupLeaseExpiresAt: options.leaseExpiresAt,
          cleanupAttempt: attempt,
          storageProfileId: row.storageProfileId,
          container: row.container,
          objectKey: row.objectKey,
          ...(row.storageVersionId
            ? { storageVersionId: row.storageVersionId }
            : {}),
          ...(row.providerEtag ? { providerEtag: row.providerEtag } : {}),
          ...(row.providerUploadId
            ? { providerUploadId: row.providerUploadId }
            : {}),
          uploadMode: parseUploadMode(row.uploadMode),
          ...(row.sealedIdentityHash
            ? { sealedIdentityHash: row.sealedIdentityHash }
            : {}),
          ...(row.expectedSize ? { expectedSize: row.expectedSize } : {}),
          ...(row.expectedSha256 ? { expectedSha256: row.expectedSha256 } : {}),
          ...(row.verifiedSize ? { verifiedSize: row.verifiedSize } : {}),
          ...(row.verifiedSha256 ? { verifiedSha256: row.verifiedSha256 } : {}),
        });
      });
    },

    async finalizeCleanupSuccess(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      assertTokenHash(options.cleanupTokenHash);
      if (options.result !== "deleted" && options.result !== "missing") {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid cleanup success result.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (
          row.cleanupState === "done" &&
          row.cleanupTokenHash === options.cleanupTokenHash &&
          row.cleanupResult === options.result
        ) {
          return transitionResult(row, false);
        }
        if (
          row.cleanupState !== "claimed" ||
          row.cleanupTokenHash !== options.cleanupTokenHash ||
          row.cleanupLeaseExpiresAt === null ||
          row.cleanupLeaseExpiresAt <= options.now
        ) {
          return fail(
            "storage_upload.lease_conflict",
            "Cleanup lease is missing, stale, or expired.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET cleanup_state = 'done',
               cleanup_lease_expires_at = NULL,
               cleanup_retry_at = NULL,
               cleanup_error_code = NULL,
               cleanup_result = ?,
               cleaned_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.result,
            options.now,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(
          row,
          true,
          parseState(row.state),
          row.version + 1,
        );
      });
    },

    async finalizeCleanupFailure(options) {
      assertTransitionIdentity(
        options.workspaceId,
        options.uploadSessionId,
        options.now,
      );
      assertTokenHash(options.cleanupTokenHash);
      if (
        !errorCodePattern.test(options.errorCode) ||
        !validDate(options.retryAt) ||
        options.retryAt <= options.now
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid cleanup failure facts.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const row = await lockSession(
          connection,
          options.workspaceId,
          options.uploadSessionId,
        );
        if (
          row.cleanupState === "failed" &&
          row.cleanupTokenHash === options.cleanupTokenHash &&
          row.cleanupErrorCode === options.errorCode &&
          sameDate(row.cleanupRetryAt, options.retryAt)
        ) {
          return transitionResult(row, false);
        }
        if (
          row.cleanupState !== "claimed" ||
          row.cleanupTokenHash !== options.cleanupTokenHash ||
          row.cleanupLeaseExpiresAt === null ||
          row.cleanupLeaseExpiresAt <= options.now
        ) {
          return fail(
            "storage_upload.lease_conflict",
            "Cleanup lease is missing, stale, or expired.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
           SET cleanup_state = 'failed',
               cleanup_lease_expires_at = NULL,
               cleanup_retry_at = ?,
               cleanup_error_code = ?,
               cleanup_result = NULL,
               cleaned_at = NULL,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND workspace_id = ?
             AND version = ?`,
          [
            options.retryAt,
            options.errorCode,
            options.now,
            row.id,
            row.workspaceId,
            row.version,
          ],
        );
        return transitionResult(
          row,
          true,
          parseState(row.state),
          row.version + 1,
        );
      });
    },

    async readAttemptOutputUploadSession(options) {
      if (
        !validId(options.workspaceId) ||
        !validId(options.uploadSessionId) ||
        !validId(options.attemptId) ||
        !boundedAscii(options.outputRole, 80) ||
        !Number.isInteger(options.outputIndex) ||
        options.outputIndex < 0 ||
        options.outputIndex > 4_294_967_295
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid Attempt output UploadSession lookup.",
        );
      }
      const [rows] = await pool.execute<UploadSessionRow[]>(
        `${uploadSessionSelect}
         WHERE workspace_id = ?
           AND id = ?
           AND purpose = 'attempt_output'
           AND attempt_id = ?
           AND output_role = ?
           AND output_index = ?
         LIMIT 1`,
        [
          options.workspaceId,
          options.uploadSessionId,
          options.attemptId,
          options.outputRole,
          options.outputIndex,
        ],
      );
      const row = rows[0];
      if (!row) {
        return fail(
          "storage_upload.not_found",
          "Attempt output UploadSession was not found.",
        );
      }
      return toUploadRecord(row, true);
    },

    async readUserImportUploadSession(options) {
      if (
        !validId(options.uploadSessionId) ||
        !validDate(options.now) ||
        options.authority.trusted !== true
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid User Import UploadSession lookup.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "asset.write",
          options.now,
        );
        const [rows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
           WHERE workspace_id = ?
             AND id = ?
             AND purpose = 'user_import'
             AND actor_id = ?
           LIMIT 1
           FOR SHARE`,
          [
            options.authority.workspaceId,
            options.uploadSessionId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "storage_upload.not_found",
            "User Import UploadSession was not found.",
          );
        }
        return toUploadRecord(row, true);
      });
    },

    async readCanvasExportUploadSession(options) {
      if (
        !validId(options.uploadSessionId) ||
        !validDate(options.now) ||
        options.authority.trusted !== true
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid Canvas Export UploadSession lookup.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "asset.write",
          options.now,
        );
        const [rows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
           WHERE workspace_id = ?
             AND id = ?
             AND purpose = 'canvas_export'
             AND actor_id = ?
           LIMIT 1
           FOR SHARE`,
          [
            options.authority.workspaceId,
            options.uploadSessionId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "storage_upload.not_found",
            "Canvas Export UploadSession was not found.",
          );
        }
        return toUploadRecord(row, true);
      });
    },

    async readModelResourceUploadSession(options) {
      if (
        !validId(options.uploadSessionId) ||
        !validDate(options.now) ||
        options.authority.trusted !== true
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid Model Resource UploadSession lookup.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "capability.configure",
          options.now,
        );
        const [rows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
           WHERE workspace_id = ?
             AND id = ?
             AND purpose = 'model_resource'
             AND actor_id = ?
           LIMIT 1
           FOR SHARE`,
          [
            options.authority.workspaceId,
            options.uploadSessionId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "storage_upload.not_found",
            "Model Resource UploadSession was not found.",
          );
        }
        return toUploadRecord(row, true);
      });
    },

    async readServerPackageUploadSession(options) {
      if (
        !validId(options.uploadSessionId) ||
        !validDate(options.now) ||
        options.authority.trusted !== true
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid Skill package UploadSession lookup.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        const [rows] = await connection.execute<UploadSessionRow[]>(
          `${uploadSessionSelect}
           WHERE workspace_id = ?
             AND id = ?
             AND purpose = 'server_package'
             AND actor_id = ?
           LIMIT 1
           FOR SHARE`,
          [
            options.authority.workspaceId,
            options.uploadSessionId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "storage_upload.not_found",
            "Skill package UploadSession was not found.",
          );
        }
        return toUploadRecord(row, true);
      });
    },

    async readAuthorizedCommittedObject(options) {
      if (
        !validId(options.workspaceId) ||
        !validId(options.artifactId) ||
        options.allowedDataClassifications.length < 1 ||
        options.allowedDataClassifications.some(
          (classification) =>
            classification !== "internal" &&
            classification !== "confidential" &&
            classification !== "restricted",
        )
      ) {
        return fail(
          "storage_upload.invalid_argument",
          "Invalid committed-object authorization request.",
        );
      }
      const [rows] = await pool.execute<AuthorizedObjectRow[]>(
        `SELECT
           artifact.id AS artifactId,
           artifact.workspace_id AS artifactWorkspaceId,
           artifact.artifact_type AS artifactType,
           artifact.availability_status AS availabilityStatus,
           artifact.data_classification AS dataClassification,
           artifact.display_filename AS displayFilename,
           stored_object.id AS storedObjectId,
           stored_object.workspace_id AS storedWorkspaceId,
           stored_object.storage_profile_id AS storageProfileId,
           stored_object.container,
           stored_object.object_key AS objectKey,
           stored_object.storage_version_id AS storageVersionId,
           stored_object.provider_etag AS providerEtag,
           stored_object.immutable_identity_hash AS immutableIdentityHash,
           CAST(stored_object.byte_size AS CHAR) AS byteSize,
           stored_object.sha256,
           stored_object.media_type AS mediaType,
           stored_object.delete_state AS deleteState,
           upload_session.id AS uploadSessionId,
           upload_session.workspace_id AS uploadWorkspaceId,
           upload_session.state AS uploadState,
           upload_session.cleanup_state AS uploadCleanupState,
           upload_session.committed_stored_object_id AS committedStoredObjectId,
           upload_session.allocation_request_key AS allocationRequestKey,
           upload_session.storage_profile_id AS uploadStorageProfileId,
           upload_session.container AS uploadContainer,
           upload_session.object_key AS uploadObjectKey,
           upload_session.storage_version_id AS uploadStorageVersionId,
           upload_session.provider_etag AS uploadProviderEtag,
           upload_session.sealed_identity_hash AS uploadSealedIdentityHash
         FROM artifact
         INNER JOIN stored_object
           ON stored_object.workspace_id = artifact.workspace_id
          AND stored_object.id = artifact.stored_object_id
         INNER JOIN upload_session
           ON upload_session.workspace_id = stored_object.workspace_id
          AND upload_session.id =
            stored_object.created_from_upload_session_id
         WHERE artifact.workspace_id = ?
           AND artifact.id = ?
         LIMIT 1`,
        [options.workspaceId, options.artifactId],
      );
      const row = rows[0];
      if (
        !row ||
        row.artifactWorkspaceId !== options.workspaceId ||
        row.storedWorkspaceId !== options.workspaceId ||
        row.uploadWorkspaceId !== options.workspaceId ||
        row.availabilityStatus !== "available" ||
        row.deleteState !== "active" ||
        row.uploadState !== "committed" ||
        row.uploadCleanupState !== "none" ||
        row.committedStoredObjectId !== row.storedObjectId ||
        row.allocationRequestKey === null ||
        row.uploadStorageProfileId !== row.storageProfileId ||
        row.uploadContainer !== row.container ||
        row.uploadObjectKey !== row.objectKey ||
        row.uploadStorageVersionId !== row.storageVersionId ||
        row.uploadProviderEtag !== row.providerEtag ||
        row.uploadSealedIdentityHash !== row.immutableIdentityHash ||
        !validUint64(row.byteSize) ||
        !sha256Pattern.test(row.sha256) ||
        !mediaTypePattern.test(row.mediaType) ||
        !row.immutableIdentityHash ||
        !digestPattern.test(row.immutableIdentityHash)
      ) {
        return fail(
          "storage_upload.access_denied",
          "Committed object facts are missing, unavailable, or unauthorized.",
        );
      }
      const classification = parseClassification(row.dataClassification);
      if (!options.allowedDataClassifications.includes(classification)) {
        return fail(
          "storage_upload.access_denied",
          "Committed object classification is not authorized.",
        );
      }
      return Object.freeze({
        artifactId: row.artifactId,
        storedObjectId: row.storedObjectId,
        artifactType: row.artifactType,
        dataClassification: classification,
        ...(row.displayFilename
          ? { displayFilename: row.displayFilename }
          : {}),
        storageProfileId: row.storageProfileId,
        container: row.container,
        objectKey: row.objectKey,
        ...(row.storageVersionId
          ? { storageVersionId: row.storageVersionId }
          : {}),
        ...(row.providerEtag ? { providerEtag: row.providerEtag } : {}),
        immutableIdentityHash: row.immutableIdentityHash,
        byteSize: row.byteSize,
        sha256: row.sha256,
        mediaType: row.mediaType,
      });
    },
  });
}
