import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export interface ArtifactRepresentationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceArtifactId: string;
  readonly variantKey: string;
  readonly profileVersion: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: "image/webp";
  readonly width: number;
  readonly height: number;
  readonly state: "available" | "deleted" | "deletion_pending" | "missing";
  readonly createdAt: Date;
}

export interface ArtifactRepresentationSource {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface CommitArtifactRepresentationOptions {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceArtifactId: string;
  readonly variantKey: string;
  readonly profileVersion: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: "image/webp";
  readonly width: number;
  readonly height: number;
  readonly now: Date;
}

export interface ClaimedArtifactRepresentationCleanup extends ArtifactRepresentationRecord {
  readonly cleanupTokenHash: string;
  readonly cleanupAttempt: number;
}

export interface ArtifactRepresentationStore {
  readonly findAvailable: (options: {
    readonly workspaceId: string;
    readonly sourceArtifactId: string;
    readonly variantKey: string;
    readonly profileVersion: string;
  }) => Promise<ArtifactRepresentationRecord | undefined>;
  readonly readSource: (options: {
    readonly workspaceId: string;
    readonly artifactId: string;
  }) => Promise<ArtifactRepresentationSource | undefined>;
  readonly commit: (
    options: CommitArtifactRepresentationOptions,
  ) => Promise<ArtifactRepresentationRecord>;
  readonly claimNextCleanup: (options: {
    readonly cleanupTokenHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }) => Promise<ClaimedArtifactRepresentationCleanup | undefined>;
  readonly finalizeCleanupSuccess: (options: {
    readonly id: string;
    readonly cleanupTokenHash: string;
    readonly result: "deleted" | "missing";
    readonly now: Date;
  }) => Promise<void>;
  readonly finalizeCleanupFailure: (options: {
    readonly id: string;
    readonly cleanupTokenHash: string;
    readonly errorCode: string;
    readonly retryAt: Date;
  }) => Promise<void>;
}

export class ArtifactRepresentationStoreError extends Error {
  public constructor(
    public readonly code:
      | "artifact_representation.invalid_argument"
      | "artifact_representation.source_unavailable"
      | "artifact_representation.identity_conflict"
      | "artifact_representation.state_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactRepresentationStoreError";
  }
}

interface RepresentationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceArtifactId: string;
  readonly variantKey: string;
  readonly profileVersion: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
  readonly state: string;
  readonly cleanupTokenHash: string | null;
  readonly cleanupAttempts: number;
  readonly createdAt: Date;
}

interface SourceRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly availabilityStatus: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly deleteState: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const identityHashPattern = /^sha256:[0-9a-f]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const tokenPattern = /^[0-9a-f]{64}$/u;

function fail(
  code: ArtifactRepresentationStoreError["code"],
  message: string,
): never {
  throw new ArtifactRepresentationStoreError(code, message);
}

function bounded(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function representation(row: RepresentationRow): ArtifactRepresentationRecord {
  if (
    row.mediaType !== "image/webp" ||
    !["available", "deleted", "deletion_pending", "missing"].includes(row.state)
  ) {
    return fail(
      "artifact_representation.state_conflict",
      "Artifact representation contains invalid persisted facts.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    sourceArtifactId: row.sourceArtifactId,
    variantKey: row.variantKey,
    profileVersion: row.profileVersion,
    storageProfileId: row.storageProfileId,
    container: row.container,
    objectKey: row.objectKey,
    immutableIdentityHash: row.immutableIdentityHash,
    byteSize: row.byteSize,
    sha256: row.sha256,
    mediaType: "image/webp" as const,
    width: row.width,
    height: row.height,
    state: row.state as ArtifactRepresentationRecord["state"],
    createdAt: row.createdAt,
  });
}

const representationSelect = `SELECT
  id,
  workspace_id AS workspaceId,
  source_artifact_id AS sourceArtifactId,
  variant_key AS variantKey,
  profile_version AS profileVersion,
  storage_profile_id AS storageProfileId,
  container,
  object_key AS objectKey,
  immutable_identity_hash AS immutableIdentityHash,
  CAST(byte_size AS CHAR) AS byteSize,
  sha256,
  media_type AS mediaType,
  width,
  height,
  state,
  cleanup_token_hash AS cleanupTokenHash,
  cleanup_attempts AS cleanupAttempts,
  created_at AS createdAt
FROM artifact_representation`;

async function transaction<T>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
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

function assertIdentity(options: CommitArtifactRepresentationOptions): void {
  if (
    !idPattern.test(options.id) ||
    !idPattern.test(options.workspaceId) ||
    !idPattern.test(options.sourceArtifactId) ||
    !idPattern.test(options.storageProfileId) ||
    !bounded(options.variantKey, 160) ||
    !bounded(options.profileVersion, 120) ||
    !bounded(options.container, 160) ||
    !bounded(options.objectKey, 800) ||
    !identityHashPattern.test(options.immutableIdentityHash) ||
    !uint64Pattern.test(options.byteSize) ||
    !sha256Pattern.test(options.sha256) ||
    options.mediaType !== "image/webp" ||
    !Number.isSafeInteger(options.width) ||
    options.width < 1 ||
    !Number.isSafeInteger(options.height) ||
    options.height < 1 ||
    !validDate(options.now)
  ) {
    fail(
      "artifact_representation.invalid_argument",
      "Artifact representation identity is invalid.",
    );
  }
}

function sameRepresentation(
  existing: ArtifactRepresentationRecord,
  options: CommitArtifactRepresentationOptions,
): boolean {
  return (
    existing.workspaceId === options.workspaceId &&
    existing.sourceArtifactId === options.sourceArtifactId &&
    existing.variantKey === options.variantKey &&
    existing.profileVersion === options.profileVersion &&
    existing.storageProfileId === options.storageProfileId &&
    existing.container === options.container &&
    existing.objectKey === options.objectKey &&
    existing.immutableIdentityHash === options.immutableIdentityHash &&
    existing.byteSize === options.byteSize &&
    existing.sha256 === options.sha256 &&
    existing.mediaType === options.mediaType &&
    existing.width === options.width &&
    existing.height === options.height
  );
}

export function createArtifactRepresentationStore(
  pool: Pool,
): ArtifactRepresentationStore {
  return Object.freeze({
    async findAvailable(
      options: Parameters<ArtifactRepresentationStore["findAvailable"]>[0],
    ) {
      const [rows] = await pool.execute<RepresentationRow[]>(
        `${representationSelect}
         WHERE workspace_id = ?
           AND source_artifact_id = ?
           AND variant_key = ?
           AND profile_version = ?
           AND state = 'available'
           AND EXISTS (
             SELECT 1 FROM artifact
             WHERE artifact.workspace_id = artifact_representation.workspace_id
               AND artifact.id = artifact_representation.source_artifact_id
               AND artifact.availability_status = 'available'
           )
         LIMIT 1`,
        [
          options.workspaceId,
          options.sourceArtifactId,
          options.variantKey,
          options.profileVersion,
        ],
      );
      return rows[0] ? representation(rows[0]) : undefined;
    },

    async readSource(
      options: Parameters<ArtifactRepresentationStore["readSource"]>[0],
    ) {
      const [rows] = await pool.execute<SourceRow[]>(
        `SELECT
           artifact.workspace_id AS workspaceId,
           artifact.id AS artifactId,
           artifact.availability_status AS availabilityStatus,
           stored_object.storage_profile_id AS storageProfileId,
           stored_object.container,
           stored_object.object_key AS objectKey,
           stored_object.immutable_identity_hash AS immutableIdentityHash,
           CAST(stored_object.byte_size AS CHAR) AS byteSize,
           stored_object.sha256,
           stored_object.media_type AS mediaType,
           stored_object.delete_state AS deleteState
         FROM artifact
         INNER JOIN stored_object
           ON stored_object.workspace_id = artifact.workspace_id
          AND stored_object.id = artifact.stored_object_id
         WHERE artifact.workspace_id = ?
           AND artifact.id = ?
         LIMIT 1`,
        [options.workspaceId, options.artifactId],
      );
      const row = rows[0];
      if (
        !row ||
        row.availabilityStatus !== "available" ||
        row.deleteState !== "active" ||
        !["image/jpeg", "image/png", "image/webp"].includes(row.mediaType)
      ) {
        return undefined;
      }
      return Object.freeze({
        workspaceId: row.workspaceId,
        artifactId: row.artifactId,
        storageProfileId: row.storageProfileId,
        container: row.container,
        objectKey: row.objectKey,
        immutableIdentityHash: row.immutableIdentityHash,
        byteSize: row.byteSize,
        sha256: row.sha256,
        mediaType: row.mediaType as ArtifactRepresentationSource["mediaType"],
      });
    },

    async commit(options: CommitArtifactRepresentationOptions) {
      assertIdentity(options);
      return transaction(pool, async (connection) => {
        const [sourceRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id
             FROM artifact
            WHERE workspace_id = ?
              AND id = ?
              AND availability_status = 'available'
            LIMIT 1
            FOR UPDATE`,
          [options.workspaceId, options.sourceArtifactId],
        );
        if (sourceRows.length !== 1) {
          return fail(
            "artifact_representation.source_unavailable",
            "Source Artifact is unavailable for representation commit.",
          );
        }
        const [existingRows] = await connection.execute<RepresentationRow[]>(
          `${representationSelect}
           WHERE workspace_id = ?
             AND source_artifact_id = ?
             AND variant_key = ?
             AND profile_version = ?
           LIMIT 1
           FOR UPDATE`,
          [
            options.workspaceId,
            options.sourceArtifactId,
            options.variantKey,
            options.profileVersion,
          ],
        );
        if (existingRows[0]) {
          const existing = representation(existingRows[0]);
          if (!sameRepresentation(existing, options)) {
            return fail(
              "artifact_representation.identity_conflict",
              "Artifact representation variant is bound to different facts.",
            );
          }
          return existing;
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO artifact_representation (
             id, workspace_id, source_artifact_id, variant_key,
             profile_version, storage_profile_id, container, object_key,
             immutable_identity_hash, byte_size, sha256, media_type,
             width, height, state, cleanup_token_hash,
             cleanup_lease_expires_at, cleanup_attempts, cleanup_retry_at,
             cleanup_error_code, created_at, deleted_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available',
             NULL, NULL, 0, NULL, NULL, ?, NULL
           )`,
          [
            options.id,
            options.workspaceId,
            options.sourceArtifactId,
            options.variantKey,
            options.profileVersion,
            options.storageProfileId,
            options.container,
            options.objectKey,
            options.immutableIdentityHash,
            options.byteSize,
            options.sha256,
            options.mediaType,
            options.width,
            options.height,
            options.now,
          ],
        );
        const [inserted] = await connection.execute<RepresentationRow[]>(
          `${representationSelect} WHERE id = ? LIMIT 1`,
          [options.id],
        );
        if (!inserted[0]) {
          return fail(
            "artifact_representation.state_conflict",
            "Committed Artifact representation could not be read back.",
          );
        }
        return representation(inserted[0]);
      });
    },

    async claimNextCleanup(
      options: Parameters<ArtifactRepresentationStore["claimNextCleanup"]>[0],
    ) {
      if (
        !tokenPattern.test(options.cleanupTokenHash) ||
        !validDate(options.now) ||
        !validDate(options.leaseExpiresAt) ||
        options.leaseExpiresAt <= options.now
      ) {
        return fail(
          "artifact_representation.invalid_argument",
          "Artifact representation cleanup claim is invalid.",
        );
      }
      return transaction(pool, async (connection) => {
        const [rows] = await connection.execute<RepresentationRow[]>(
          `${representationSelect}
           WHERE (state = 'deletion_pending' OR (
             state = 'available' AND EXISTS (
               SELECT 1 FROM artifact
               WHERE artifact.workspace_id = artifact_representation.workspace_id
                 AND artifact.id = artifact_representation.source_artifact_id
                 AND artifact.availability_status = 'expired'
             )
           ))
             AND (cleanup_retry_at IS NULL OR cleanup_retry_at <= ?)
             AND (
               cleanup_token_hash IS NULL
               OR cleanup_lease_expires_at <= ?
             )
           ORDER BY id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [options.now, options.now],
        );
        const row = rows[0];
        if (!row) return undefined;
        const attempt = row.cleanupAttempts + 1;
        await connection.execute<ResultSetHeader>(
          `UPDATE artifact_representation
              SET state = 'deletion_pending',
                  cleanup_token_hash = ?,
                  cleanup_lease_expires_at = ?,
                  cleanup_attempts = ?,
                  cleanup_retry_at = NULL,
                  cleanup_error_code = NULL
            WHERE id = ? AND state IN ('available', 'deletion_pending')`,
          [options.cleanupTokenHash, options.leaseExpiresAt, attempt, row.id],
        );
        return Object.freeze({
          ...representation({ ...row, state: "deletion_pending" }),
          cleanupTokenHash: options.cleanupTokenHash,
          cleanupAttempt: attempt,
        });
      });
    },

    async finalizeCleanupSuccess(
      options: Parameters<
        ArtifactRepresentationStore["finalizeCleanupSuccess"]
      >[0],
    ) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE artifact_representation
            SET state = ?,
                cleanup_lease_expires_at = NULL,
                deleted_at = ?
          WHERE id = ?
            AND state = 'deletion_pending'
            AND cleanup_token_hash = ?`,
        [options.result, options.now, options.id, options.cleanupTokenHash],
      );
      if (result.affectedRows !== 1) {
        fail(
          "artifact_representation.state_conflict",
          "Artifact representation cleanup success lost its claim.",
        );
      }
    },

    async finalizeCleanupFailure(
      options: Parameters<
        ArtifactRepresentationStore["finalizeCleanupFailure"]
      >[0],
    ) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE artifact_representation
            SET cleanup_token_hash = NULL,
                cleanup_lease_expires_at = NULL,
                cleanup_retry_at = ?,
                cleanup_error_code = ?
          WHERE id = ?
            AND state = 'deletion_pending'
            AND cleanup_token_hash = ?`,
        [
          options.retryAt,
          options.errorCode,
          options.id,
          options.cleanupTokenHash,
        ],
      );
      if (result.affectedRows !== 1) {
        fail(
          "artifact_representation.state_conflict",
          "Artifact representation cleanup failure lost its claim.",
        );
      }
    },
  });
}
