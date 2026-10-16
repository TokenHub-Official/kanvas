import {
  requireLibraryUploadTarget,
  revalidateLibraryArtifactAccess,
} from "./resource-library-artifact-access.js";
import {
  libraryMediaTypes,
  libraryTextMaximumBytes,
} from "@kanvas/application";
import {
  authorizeRecoveryCommit,
  completeRecoveryCommit,
} from "./provider-result-recovery-store.js";
import {
  authorizationModelVersion,
  type ArtifactDownloadAuthorizationAllow,
  type ArtifactDownloadAuthorizationDecision,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import {
  AuthorizationStoreError,
  revalidateTrustedWorkspaceScopeInTransaction,
} from "./authorization-store.js";
import { privateConversationArtifactOwner } from "./conversation-artifact-privacy.js";
import {
  consumeInboxEvent,
  type InboxConsumptionResult,
  type InboxDelivery,
} from "./inbox-receipt.js";

export type UserImportDataClassification =
  "internal" | "confidential" | "restricted";

export interface ContentTransferAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface CommitUserImportOptions {
  /** Trusted library commit context; never accepted from generic import metadata. */
  readonly libraryId?: string;
  readonly authority: TrustedWorkspaceScope;
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly outboxEventId: string;
  readonly artifactType: string;
  readonly dataClassification: UserImportDataClassification;
  readonly displayFilename?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly asset?: {
    readonly assetId: string;
    readonly name: string;
    readonly assetType: string;
  };
  readonly audit: ContentTransferAuditContext;
  readonly now: Date;
}

export interface CommittedUserImport {
  readonly status: "committed" | "replayed";
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly assetId?: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly committedAt: Date;
}

export interface AuthorizeArtifactDownloadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly artifactId: string;
  readonly purpose: string;
  readonly decisionId: string;
  readonly audit: ContentTransferAuditContext;
  readonly now: Date;
  readonly validUntil: Date;
}

export interface RevalidateArtifactDownloadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly decision: ArtifactDownloadAuthorizationAllow;
  readonly now: Date;
}

export interface ContentTransferStore {
  commitRecoveredProviderResult(
    options: CommitUserImportOptions & {
      readonly recoveryId: string;
      readonly leaseToken: string;
    },
  ): Promise<CommittedUserImport>;
  commitUserImport(
    options: CommitUserImportOptions,
  ): Promise<CommittedUserImport>;
  authorizeArtifactDownload(
    options: AuthorizeArtifactDownloadOptions,
  ): Promise<ArtifactDownloadAuthorizationDecision>;
  revalidateArtifactDownload(
    options: RevalidateArtifactDownloadOptions,
  ): Promise<ArtifactDownloadAuthorizationDecision>;
  consumeArtifactContentEvent(delivery: InboxDelivery): Promise<
    InboxConsumptionResult<
      Readonly<{
        artifactId: string;
      }>
    >
  >;
}

export type ContentTransferStoreErrorCode =
  | "content_transfer.invalid_argument"
  | "content_transfer.not_found"
  | "content_transfer.forbidden"
  | "content_transfer.runtime_fenced"
  | "content_transfer.state_conflict"
  | "content_transfer.idempotency_conflict";

export class ContentTransferStoreError extends Error {
  public constructor(
    public readonly code: ContentTransferStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContentTransferStoreError";
  }
}

export interface CreateContentTransferStoreOptions {
  readonly instanceId: string;
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
}

interface UserImportUploadRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string | null;
  readonly purpose: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedIdentityHash: string | null;
  readonly state: string;
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupState: string;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly committedStoredObjectId: string | null;
  readonly committedAt: Date | null;
}

interface CommittedImportRow extends RowDataPacket {
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly assetId: string | null;
  readonly assetName: string | null;
  readonly assetType: string | null;
  readonly currentArtifactId: string | null;
  readonly artifactType: string;
  readonly dataClassification: string;
  readonly displayFilename: string | null;
  readonly metadata: unknown;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly committedAt: Date;
}

interface DownloadArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly assetId: string | null;
  readonly createdByPrincipalId: string | null;
  readonly createdByCapabilityPrincipalId: string | null;
  readonly capabilityInvocationKind: string | null;
  readonly createdByWorkflowPrincipalId: string | null;
  readonly workflowIdempotencyKey: string | null;
  readonly dataClassification: string;
  readonly availabilityStatus: string;
  readonly metadata: unknown;
}

interface ImportedArtifactFactRow extends RowDataPacket {
  readonly artifactId: string;
  readonly storedObjectId: string;
  readonly uploadSessionId: string;
  readonly uploadPurpose: string;
  readonly uploadState: string;
  readonly committedStoredObjectId: string | null;
  readonly deleteState: string;
  readonly availabilityStatus: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function fail(code: ContentTransferStoreErrorCode, message: string): never {
  throw new ContentTransferStoreError(code, message);
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function boundedText(
  value: string,
  maximum: number,
  allowEmpty = false,
): boolean {
  return (
    (allowEmpty ? value.length >= 0 : value.length >= 1) &&
    value.length <= maximum &&
    [...value].every((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && code >= 32 && code !== 127;
    })
  );
}

function canonicalize(
  value: unknown,
  ancestors = new WeakSet<object>(),
): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(
        "content_transfer.invalid_argument",
        "Metadata contains a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return fail(
        "content_transfer.invalid_argument",
        "Metadata contains a cyclic array.",
      );
    }
    ancestors.add(value);
    const result = `[${value
      .map((item) => canonicalize(item, ancestors))
      .join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (value && typeof value === "object") {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      return fail(
        "content_transfer.invalid_argument",
        "Metadata must contain JSON objects only.",
      );
    }
    if (ancestors.has(value)) {
      return fail(
        "content_transfer.invalid_argument",
        "Metadata contains a cyclic object.",
      );
    }
    ancestors.add(value);
    const entries = Object.entries(
      value as Readonly<Record<string, unknown>>,
    ).sort(([left], [right]) => {
      if (left < right) {
        return -1;
      }
      return left > right ? 1 : 0;
    });
    for (const [, item] of entries) {
      if (item === undefined) {
        return fail(
          "content_transfer.invalid_argument",
          "Metadata cannot contain undefined.",
        );
      }
    }
    const result = `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalize(item, ancestors)}`,
      )
      .join(",")}}`;
    ancestors.delete(value);
    return result;
  }
  return fail(
    "content_transfer.invalid_argument",
    `Metadata contains unsupported ${typeof value}.`,
  );
}

function parseJsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return fail(
        "content_transfer.state_conflict",
        "Committed Artifact metadata is not valid JSON.",
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "content_transfer.state_conflict",
      "Committed Artifact metadata is not a JSON object.",
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function validateCommit(options: CommitUserImportOptions): string {
  if (
    (options.libraryId !== undefined &&
      (!idPattern.test(options.libraryId) || options.asset !== undefined)) ||
    options.authority.trusted !== true ||
    !idPattern.test(options.uploadSessionId) ||
    !idPattern.test(options.storedObjectId) ||
    !idPattern.test(options.artifactId) ||
    !idPattern.test(options.outboxEventId) ||
    !boundedText(options.artifactType, 120) ||
    !["internal", "confidential", "restricted"].includes(
      options.dataClassification,
    ) ||
    (options.displayFilename !== undefined &&
      !boundedText(options.displayFilename, 255)) ||
    (options.asset !== undefined &&
      (!idPattern.test(options.asset.assetId) ||
        !boundedText(options.asset.name, 240) ||
        !boundedText(options.asset.assetType, 120))) ||
    !idPattern.test(options.audit.auditEventId) ||
    !digestPattern.test(options.audit.authenticationRefHash) ||
    !validDate(options.now)
  ) {
    return fail(
      "content_transfer.invalid_argument",
      "Invalid User Import commit facts.",
    );
  }
  const metadataJson = canonicalize(options.metadata);
  if (Buffer.byteLength(metadataJson, "utf8") > 65_535) {
    return fail(
      "content_transfer.invalid_argument",
      "User Import metadata exceeds the bounded JSON limit.",
    );
  }
  return metadataJson;
}

function parseClassification(value: string): UserImportDataClassification {
  if (
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
  ) {
    return value;
  }
  return fail(
    "content_transfer.state_conflict",
    "Artifact has an unsupported data classification.",
  );
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

async function requireActiveRuntime(
  connection: PoolConnection,
  instanceId: string,
): Promise<number> {
  const [rows] = await connection.execute<RuntimeStateRow[]>(
    `SELECT
       state,
       execution_generation AS executionGeneration
     FROM instance_runtime_state
     WHERE instance_id = ?
     LIMIT 1
     FOR SHARE`,
    [instanceId],
  );
  const row = rows[0];
  if (
    !row ||
    row.state !== "ACTIVE" ||
    !Number.isSafeInteger(row.executionGeneration) ||
    row.executionGeneration < 1
  ) {
    return fail(
      "content_transfer.runtime_fenced",
      "Content transfer is unavailable while the instance is fenced.",
    );
  }
  return row.executionGeneration;
}

async function lockUserImport(
  connection: PoolConnection,
  workspaceId: string,
  uploadSessionId: string,
): Promise<UserImportUploadRow> {
  const [rows] = await connection.execute<UserImportUploadRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       actor_id AS actorId,
       purpose,
       storage_profile_id AS storageProfileId,
       container,
       object_key AS objectKey,
       storage_version_id AS storageVersionId,
       provider_etag AS providerEtag,
       sealed_identity_hash AS sealedIdentityHash,
       state,
       version,
       expires_at AS expiresAt,
       cleanup_state AS cleanupState,
       CAST(verified_size AS CHAR) AS verifiedSize,
       verified_sha256 AS verifiedSha256,
       detected_media_type AS detectedMediaType,
       committed_stored_object_id AS committedStoredObjectId,
       committed_at AS committedAt
     FROM upload_session
     WHERE workspace_id = ?
       AND id = ?
       AND purpose = 'user_import'
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, uploadSessionId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "content_transfer.not_found",
      "User Import UploadSession was not found.",
    );
  }
  return row;
}

async function readCommittedImport(
  connection: PoolConnection,
  workspaceId: string,
  uploadSessionId: string,
): Promise<CommittedImportRow | undefined> {
  const [rows] = await connection.execute<CommittedImportRow[]>(
    `SELECT
       upload_session.id AS uploadSessionId,
       stored_object.id AS storedObjectId,
       artifact.id AS artifactId,
       asset.id AS assetId,
       asset.name AS assetName,
       asset.asset_type AS assetType,
       asset.current_artifact_id AS currentArtifactId,
       artifact.artifact_type AS artifactType,
       artifact.data_classification AS dataClassification,
       artifact.display_filename AS displayFilename,
       artifact.metadata,
       artifact.content_digest AS contentDigest,
       stored_object.media_type AS mediaType,
       CAST(stored_object.byte_size AS CHAR) AS byteSize,
       upload_session.committed_at AS committedAt
     FROM upload_session
     INNER JOIN stored_object
       ON stored_object.workspace_id = upload_session.workspace_id
      AND stored_object.id = upload_session.committed_stored_object_id
      AND stored_object.created_from_upload_session_id = upload_session.id
     INNER JOIN artifact
       ON artifact.workspace_id = stored_object.workspace_id
      AND artifact.stored_object_id = stored_object.id
     LEFT JOIN asset
       ON asset.workspace_id = artifact.workspace_id
      AND asset.id = artifact.asset_id
     WHERE upload_session.workspace_id = ?
       AND upload_session.id = ?
       AND upload_session.state = 'committed'
     LIMIT 1`,
    [workspaceId, uploadSessionId],
  );
  return rows[0];
}

function assertReplay(
  row: CommittedImportRow,
  options: CommitUserImportOptions,
  metadataJson: string,
): CommittedUserImport {
  if (
    row.artifactType !== options.artifactType ||
    row.dataClassification !== options.dataClassification ||
    row.displayFilename !== (options.displayFilename ?? null) ||
    canonicalize(parseJsonRecord(row.metadata)) !== metadataJson ||
    (options.asset
      ? row.assetId === null ||
        row.assetName !== options.asset.name ||
        row.assetType !== options.asset.assetType ||
        row.currentArtifactId !== row.artifactId
      : row.assetId !== null) ||
    !digestPattern.test(row.contentDigest) ||
    !mediaTypePattern.test(row.mediaType) ||
    !uint64Pattern.test(row.byteSize) ||
    !validDate(row.committedAt)
  ) {
    return fail(
      "content_transfer.idempotency_conflict",
      "User Import was already committed with different Artifact facts.",
    );
  }
  return Object.freeze<CommittedUserImport>({
    status: "replayed",
    uploadSessionId: row.uploadSessionId,
    storedObjectId: row.storedObjectId,
    artifactId: row.artifactId,
    ...(row.assetId ? { assetId: row.assetId } : {}),
    contentDigest: row.contentDigest,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    committedAt: row.committedAt,
  });
}

function validateDownloadRequest(
  authority: TrustedWorkspaceScope,
  artifactId: string,
  purpose: string,
  now: Date,
): void {
  if (
    authority.trusted !== true ||
    !idPattern.test(artifactId) ||
    !boundedText(purpose, 120) ||
    !validDate(now)
  ) {
    fail(
      "content_transfer.invalid_argument",
      "Invalid Artifact download authorization request.",
    );
  }
}

async function readDownloadArtifact(
  connection: PoolConnection,
  workspaceId: string,
  artifactId: string,
): Promise<DownloadArtifactRow | undefined> {
  const [rows] = await connection.execute<DownloadArtifactRow[]>(
    `SELECT
       artifact.id,
       artifact.asset_id AS assetId,
       artifact.created_by_principal_id AS createdByPrincipalId,
       capability.created_by AS createdByCapabilityPrincipalId,
       capability.invocation_kind AS capabilityInvocationKind,
       workflow.created_by AS createdByWorkflowPrincipalId,
       workflow.idempotency_key AS workflowIdempotencyKey,
       artifact.data_classification AS dataClassification,
       artifact.availability_status AS availabilityStatus,
       artifact.metadata
     FROM artifact
     LEFT JOIN capability_run capability
       ON capability.workspace_id = artifact.workspace_id
      AND capability.id = artifact.created_by_capability_run_id
     LEFT JOIN node_run node
       ON node.workspace_id = capability.workspace_id
      AND node.id = capability.node_run_id
     LEFT JOIN workflow_run workflow
       ON workflow.workspace_id = node.workspace_id
      AND workflow.id = node.workflow_run_id
     WHERE artifact.workspace_id = ?
       AND artifact.id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, artifactId],
  );
  return rows[0];
}

function deny(
  reasonCode: string,
  disclosure: "not_found" | "forbidden" = "not_found",
): ArtifactDownloadAuthorizationDecision {
  return Object.freeze({
    decision: "deny",
    disclosure,
    reasonCode,
  });
}

function authorizationError(error: unknown): never {
  if (error instanceof AuthorizationStoreError) {
    return fail(
      error.code === "authorization.forbidden"
        ? "content_transfer.forbidden"
        : "content_transfer.state_conflict",
      "Workspace authority changed before the content transfer completed.",
    );
  }
  throw error;
}

export function createContentTransferStore(
  pool: Pool,
  options: CreateContentTransferStoreOptions,
): ContentTransferStore {
  if (!boundedText(options.instanceId, 120)) {
    throw new ContentTransferStoreError(
      "content_transfer.invalid_argument",
      "Content Transfer Store requires a bounded instance identity.",
    );
  }

  async function commitImport(
    commitOptions: CommitUserImportOptions,
    recovery?: { readonly id: string; readonly leaseToken: string },
  ): Promise<CommittedUserImport> {
    const metadataJson = validateCommit(commitOptions);
    try {
      return await inTransaction(pool, async (connection) => {
        const expectedGeneration = await requireActiveRuntime(
          connection,
          options.instanceId,
        );
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          commitOptions.authority,
          recovery ? "capability.run" : "asset.write",
          commitOptions.now,
        );
        if (commitOptions.libraryId) {
          if (recovery)
            return fail(
              "content_transfer.invalid_argument",
              "Recovered outputs cannot become library uploads.",
            );
          await requireLibraryUploadTarget(
            connection,
            commitOptions.authority,
            commitOptions.libraryId,
            commitOptions.now,
          );
        }
        if (recovery && commitOptions.asset)
          return fail(
            "content_transfer.invalid_argument",
            "Recovered outputs cannot be implicitly adopted into the asset library.",
          );
        const recoveredRunId = recovery
          ? await authorizeRecoveryCommit(connection, {
              ...recovery,
              authority: commitOptions.authority,
              uploadSessionId: commitOptions.uploadSessionId,
              storedObjectId: commitOptions.storedObjectId,
              artifactId: commitOptions.artifactId,
              now: commitOptions.now,
            })
          : null;
        const upload = await lockUserImport(
          connection,
          commitOptions.authority.workspaceId,
          commitOptions.uploadSessionId,
        );
        if (upload.actorId !== commitOptions.authority.principalId) {
          return fail(
            "content_transfer.not_found",
            "User Import UploadSession was not found.",
          );
        }
        if (upload.state === "committed") {
          const existing = await readCommittedImport(
            connection,
            upload.workspaceId,
            upload.id,
          );
          if (!existing) {
            return fail(
              "content_transfer.state_conflict",
              "Committed User Import facts are incomplete.",
            );
          }
          const [owners] = await connection.execute<
            (RowDataPacket & { libraryId: string })[]
          >(
            "SELECT library_id AS libraryId FROM resource_library_upload WHERE workspace_id = ? AND artifact_id = ?",
            [upload.workspaceId, existing.artifactId],
          );
          if ((owners[0]?.libraryId ?? undefined) !== commitOptions.libraryId) {
            return fail(
              "content_transfer.idempotency_conflict",
              "The import belongs to a different resource owner.",
            );
          }
          return assertReplay(existing, commitOptions, metadataJson);
        }
        if (
          upload.state !== "verified" ||
          upload.cleanupState !== "none" ||
          upload.expiresAt <= commitOptions.now ||
          !upload.sealedIdentityHash ||
          !digestPattern.test(upload.sealedIdentityHash) ||
          !upload.verifiedSize ||
          !uint64Pattern.test(upload.verifiedSize) ||
          !upload.verifiedSha256 ||
          !sha256Pattern.test(upload.verifiedSha256) ||
          !upload.detectedMediaType ||
          !mediaTypePattern.test(upload.detectedMediaType) ||
          upload.committedStoredObjectId !== null
        ) {
          return fail(
            "content_transfer.state_conflict",
            "User Import UploadSession is not eligible for commit.",
          );
        }
        if (
          commitOptions.libraryId &&
          (!libraryMediaTypes.some(
            (media) => media === upload.detectedMediaType,
          ) ||
            (upload.detectedMediaType.startsWith("text/") &&
              Number(upload.verifiedSize) > libraryTextMaximumBytes))
        ) {
          return fail(
            "content_transfer.invalid_argument",
            "Unsupported library file type or text size.",
          );
        }
        const contentDigest = `sha256:${upload.verifiedSha256}`;
        await connection.execute<ResultSetHeader>(
          `INSERT INTO stored_object (
               id,
               workspace_id,
               created_from_upload_session_id,
               storage_profile_id,
               container,
               object_key,
               storage_version_id,
               provider_etag,
               immutable_identity_hash,
               byte_size,
               sha256,
               media_type,
               delete_state,
               created_at,
               deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
          [
            commitOptions.storedObjectId,
            upload.workspaceId,
            upload.id,
            upload.storageProfileId,
            upload.container,
            upload.objectKey,
            upload.storageVersionId,
            upload.providerEtag,
            upload.sealedIdentityHash,
            upload.verifiedSize,
            upload.verifiedSha256,
            upload.detectedMediaType,
            commitOptions.now,
          ],
        );
        if (commitOptions.asset) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO asset (
                 id,
                 workspace_id,
                 asset_key,
                 name,
                 asset_type,
                 lifecycle_status,
                 current_artifact_id,
                 version,
                 created_by_principal_id,
                 created_at,
                 updated_at
               ) VALUES (
                 ?, ?, ?, ?, ?, 'active', NULL, 1, ?, ?, ?
               )`,
            [
              commitOptions.asset.assetId,
              upload.workspaceId,
              `canvas.import.${upload.id}`,
              commitOptions.asset.name,
              commitOptions.asset.assetType,
              commitOptions.authority.principalId,
              commitOptions.now,
              commitOptions.now,
            ],
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO artifact (
               id,
               workspace_id,
               asset_id,
               created_by_capability_run_id,
               created_by_principal_id,
               stored_object_id,
               structured_content,
               content_digest,
               artifact_type,
               availability_status,
               data_classification,
               display_filename,
               metadata,
               created_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'available', ?, ?, ?, ?
             )`,
          [
            commitOptions.artifactId,
            upload.workspaceId,
            commitOptions.asset?.assetId ?? null,
            recoveredRunId,
            recoveredRunId ? null : commitOptions.authority.principalId,
            commitOptions.storedObjectId,
            contentDigest,
            commitOptions.artifactType,
            commitOptions.dataClassification,
            commitOptions.displayFilename ?? null,
            metadataJson,
            commitOptions.now,
          ],
        );
        if (commitOptions.libraryId) {
          await connection.execute(
            `INSERT INTO resource_library_upload (workspace_id, library_id, artifact_id, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?)`,
            [
              upload.workspaceId,
              commitOptions.libraryId,
              commitOptions.artifactId,
              commitOptions.authority.principalId,
              commitOptions.now,
            ],
          );
        }
        if (commitOptions.asset) {
          const [selected] = await connection.execute<ResultSetHeader>(
            `UPDATE asset
                 SET current_artifact_id = ?,
                     updated_at = ?
                 WHERE workspace_id = ?
                   AND id = ?
                   AND current_artifact_id IS NULL
                   AND lifecycle_status = 'active'`,
            [
              commitOptions.artifactId,
              commitOptions.now,
              upload.workspaceId,
              commitOptions.asset.assetId,
            ],
          );
          if (selected.affectedRows !== 1) {
            return fail(
              "content_transfer.state_conflict",
              "Imported Asset changed before its Artifact selection.",
            );
          }
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE upload_session
             SET state = 'committed',
                 committed_stored_object_id = ?,
                 committed_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND state = 'verified'
               AND cleanup_state = 'none'
               AND expires_at > ?
               AND committed_stored_object_id IS NULL`,
          [
            commitOptions.storedObjectId,
            commitOptions.now,
            commitOptions.now,
            upload.workspaceId,
            upload.id,
            upload.version,
            commitOptions.now,
          ],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "content_transfer.state_conflict",
            "User Import changed before its commit transaction.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO outbox_event (
               id,
               workspace_id,
               message_type,
               schema_version,
               aggregate_type,
               aggregate_id,
               aggregate_version,
               payload,
               status,
               available_at,
               lease_token_hash,
               lease_expires_at,
               publish_attempts,
               published_at,
               last_error_code,
               quarantined_at,
               superseded_at,
               created_at
             ) VALUES (
               ?, ?, 'artifact.user_imported', 1, 'artifact', ?, 1, ?,
               'pending', ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?
             )`,
          [
            commitOptions.outboxEventId,
            upload.workspaceId,
            commitOptions.artifactId,
            canonicalize({
              artifactId: commitOptions.artifactId,
              ...(commitOptions.asset
                ? { assetId: commitOptions.asset.assetId }
                : {}),
              storedObjectId: commitOptions.storedObjectId,
              uploadSessionId: upload.id,
              expectedGeneration,
            }),
            commitOptions.now,
            commitOptions.now,
          ],
        );
        await appendAuditEventInTransaction(connection, {
          id: commitOptions.audit.auditEventId,
          schemaVersion: auditEventSchemaVersion,
          organizationId: commitOptions.authority.organizationId,
          workspaceId: upload.workspaceId,
          actorPrincipalId: commitOptions.authority.principalId,
          actorType: commitOptions.authority.principalType,
          authenticationRefType: commitOptions.authority.authenticationRefType,
          authenticationRefHash: commitOptions.audit.authenticationRefHash,
          authorityType: commitOptions.authority.authorityType,
          authorityId: commitOptions.authority.authorityId,
          authorityVersion: commitOptions.authority.authorityVersion,
          authorizationModelVersion,
          authorizationDecision: {
            permission: recovery ? "capability.run" : "asset.write",
            authorityVersion: commitOptions.authority.authorityVersion,
          },
          eventType: recovery
            ? "artifact.result_recovered"
            : "artifact.user_imported",
          action: recovery ? "artifact.recover_result" : "artifact.import",
          resourceType: "artifact",
          resourceId: commitOptions.artifactId,
          outcome: "succeeded",
          decisionReasonCode: "authorized",
          severity:
            commitOptions.dataClassification === "restricted" ? "high" : "info",
          requestId: commitOptions.audit.requestId ?? null,
          traceId: commitOptions.audit.traceId ?? null,
          details: {
            sourceUploadId: upload.id,
            storedObjectId: commitOptions.storedObjectId,
            mediaType: upload.detectedMediaType,
            byteSize: upload.verifiedSize,
            contentDigest,
            dataClassification: commitOptions.dataClassification,
            ...(commitOptions.asset
              ? { assetId: commitOptions.asset.assetId }
              : {}),
          },
          occurredAt: commitOptions.now,
          recordedAt: commitOptions.now,
        });
        if (recovery)
          await completeRecoveryCommit(
            connection,
            recovery.id,
            recovery.leaseToken,
            commitOptions.now,
          );
        return Object.freeze({
          status: "committed" as const,
          uploadSessionId: upload.id,
          storedObjectId: commitOptions.storedObjectId,
          artifactId: commitOptions.artifactId,
          ...(commitOptions.asset
            ? { assetId: commitOptions.asset.assetId }
            : {}),
          contentDigest,
          mediaType: upload.detectedMediaType,
          byteSize: upload.verifiedSize,
          committedAt: commitOptions.now,
        });
      });
    } catch (error) {
      authorizationError(error);
    }
  }

  return Object.freeze<ContentTransferStore>({
    commitUserImport: (input) => commitImport(input),
    commitRecoveredProviderResult: (input) =>
      commitImport(input, {
        id: input.recoveryId,
        leaseToken: input.leaseToken,
      }),

    async authorizeArtifactDownload(downloadOptions) {
      validateDownloadRequest(
        downloadOptions.authority,
        downloadOptions.artifactId,
        downloadOptions.purpose,
        downloadOptions.now,
      );
      if (
        !idPattern.test(downloadOptions.decisionId) ||
        !idPattern.test(downloadOptions.audit.auditEventId) ||
        !digestPattern.test(downloadOptions.audit.authenticationRefHash) ||
        !validDate(downloadOptions.validUntil) ||
        downloadOptions.validUntil <= downloadOptions.now ||
        downloadOptions.validUntil.getTime() - downloadOptions.now.getTime() >
          60_000
      ) {
        return fail(
          "content_transfer.invalid_argument",
          "Invalid Artifact download decision facts.",
        );
      }
      try {
        return await inTransaction(pool, async (connection) => {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            downloadOptions.authority,
            "artifact.download",
            downloadOptions.now,
          );
          const artifact = await readDownloadArtifact(
            connection,
            downloadOptions.authority.workspaceId,
            downloadOptions.artifactId,
          );
          if (!artifact || artifact.availabilityStatus !== "available") {
            return deny("artifact_not_available");
          }
          await revalidateLibraryArtifactAccess(
            connection,
            downloadOptions.authority,
            artifact.id,
            downloadOptions.now,
          );
          const privateOwner = privateConversationArtifactOwner(artifact);
          if (
            privateOwner &&
            privateOwner !== downloadOptions.authority.principalId
          ) {
            return deny("artifact_private_to_principal", "forbidden");
          }
          const classification = parseClassification(
            artifact.dataClassification,
          );
          await appendAuditEventInTransaction(connection, {
            id: downloadOptions.audit.auditEventId,
            schemaVersion: auditEventSchemaVersion,
            organizationId: downloadOptions.authority.organizationId,
            workspaceId: downloadOptions.authority.workspaceId,
            actorPrincipalId: downloadOptions.authority.principalId,
            actorType: downloadOptions.authority.principalType,
            authenticationRefType:
              downloadOptions.authority.authenticationRefType,
            authenticationRefHash: downloadOptions.audit.authenticationRefHash,
            authorityType: downloadOptions.authority.authorityType,
            authorityId: downloadOptions.authority.authorityId,
            authorityVersion: downloadOptions.authority.authorityVersion,
            authorizationModelVersion,
            authorizationDecision: {
              permission: "artifact.download",
              authorityVersion: downloadOptions.authority.authorityVersion,
              dataClassification: classification,
            },
            eventType: "artifact.download_authorized",
            action: "artifact.download",
            resourceType: "artifact",
            resourceId: artifact.id,
            outcome: "succeeded",
            decisionReasonCode: "authorized_proxy_stream",
            severity: classification === "restricted" ? "high" : "info",
            requestId: downloadOptions.audit.requestId ?? null,
            traceId: downloadOptions.audit.traceId ?? null,
            details: {
              decisionId: downloadOptions.decisionId,
              purpose: downloadOptions.purpose,
              delivery: "proxy",
              dataClassification: classification,
            },
            occurredAt: downloadOptions.now,
            recordedAt: downloadOptions.now,
          });
          return Object.freeze({
            decision: "allow" as const,
            decisionId: downloadOptions.decisionId,
            principalId: downloadOptions.authority.principalId,
            workspaceId: downloadOptions.authority.workspaceId,
            artifactId: artifact.id,
            purpose: downloadOptions.purpose,
            dataClassification: classification,
            authorizationVersion: downloadOptions.authority.authorityVersion,
            proxyRequired: true,
            validUntil: downloadOptions.validUntil,
          });
        });
      } catch (error) {
        authorizationError(error);
      }
    },

    async revalidateArtifactDownload(revalidateOptions) {
      validateDownloadRequest(
        revalidateOptions.authority,
        revalidateOptions.decision.artifactId,
        revalidateOptions.decision.purpose,
        revalidateOptions.now,
      );
      if (
        revalidateOptions.decision.principalId !==
          revalidateOptions.authority.principalId ||
        revalidateOptions.decision.workspaceId !==
          revalidateOptions.authority.workspaceId ||
        revalidateOptions.decision.authorizationVersion !==
          revalidateOptions.authority.authorityVersion ||
        !idPattern.test(revalidateOptions.decision.decisionId) ||
        !validDate(revalidateOptions.decision.validUntil) ||
        revalidateOptions.decision.validUntil <= revalidateOptions.now
      ) {
        return deny("authorization_changed");
      }
      try {
        return await inTransaction(pool, async (connection) => {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            revalidateOptions.authority,
            "artifact.download",
            revalidateOptions.now,
          );
          const artifact = await readDownloadArtifact(
            connection,
            revalidateOptions.authority.workspaceId,
            revalidateOptions.decision.artifactId,
          );
          if (
            !artifact ||
            artifact.availabilityStatus !== "available" ||
            artifact.dataClassification !==
              revalidateOptions.decision.dataClassification
          ) {
            return deny("authorization_changed");
          }
          await revalidateLibraryArtifactAccess(
            connection,
            revalidateOptions.authority,
            artifact.id,
            revalidateOptions.now,
          );
          const privateOwner = privateConversationArtifactOwner(artifact);
          if (
            privateOwner &&
            privateOwner !== revalidateOptions.authority.principalId
          ) {
            return deny("authorization_changed", "forbidden");
          }
          return revalidateOptions.decision;
        });
      } catch (error) {
        if (error instanceof AuthorizationStoreError) {
          return deny("authorization_changed");
        }
        throw error;
      }
    },

    async consumeArtifactContentEvent(delivery) {
      return inTransaction(pool, (connection) =>
        consumeInboxEvent(connection, delivery, async (event) => {
          if (
            (event.messageType !== "artifact.user_imported" &&
              event.messageType !== "artifact.canvas_exported") ||
            event.aggregateType !== "artifact" ||
            event.payload.artifactId !== event.aggregateId ||
            typeof event.payload.storedObjectId !== "string" ||
            !idPattern.test(event.payload.storedObjectId) ||
            typeof event.payload.uploadSessionId !== "string" ||
            !idPattern.test(event.payload.uploadSessionId)
          ) {
            return fail(
              "content_transfer.state_conflict",
              "Artifact content event does not match its canonical envelope.",
            );
          }
          const [rows] = await connection.execute<ImportedArtifactFactRow[]>(
            `SELECT
                 artifact.id AS artifactId,
                 stored_object.id AS storedObjectId,
                 upload_session.id AS uploadSessionId,
                 upload_session.purpose AS uploadPurpose,
                 upload_session.state AS uploadState,
                 upload_session.committed_stored_object_id AS committedStoredObjectId,
                 stored_object.delete_state AS deleteState,
                 artifact.availability_status AS availabilityStatus
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
               LIMIT 1
               FOR SHARE`,
            [event.workspaceId, event.aggregateId],
          );
          const row = rows[0];
          if (
            !row ||
            row.storedObjectId !== event.payload.storedObjectId ||
            row.uploadSessionId !== event.payload.uploadSessionId ||
            row.uploadPurpose !==
              (event.messageType === "artifact.canvas_exported"
                ? "canvas_export"
                : "user_import") ||
            row.uploadState !== "committed" ||
            row.committedStoredObjectId !== row.storedObjectId ||
            row.deleteState !== "active" ||
            row.availabilityStatus !== "available"
          ) {
            return fail(
              "content_transfer.state_conflict",
              "Artifact content event has no matching committed facts.",
            );
          }
          return Object.freeze({
            outcome: "noop" as const,
            resultCode:
              event.messageType === "artifact.canvas_exported"
                ? "artifact.export_recorded"
                : "artifact.import_recorded",
            value: Object.freeze({
              artifactId: row.artifactId,
            }),
          });
        }),
      );
    },
  });
}
