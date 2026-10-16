import {
  readLibraryTextSource,
  writeLibraryTextIndex,
} from "./resource-library-text-store.js";
import {
  assertLibraryId,
  DomainError,
  libraryMediaTypes,
  libraryTextMaximumBytes,
  normalizeResourceLibraryDocument,
  type ResourceLibraryRepository,
  type ResourceLibraryRevision,
  type ResourceLibrarySummary,
  type SaveResourceLibrary,
  type TrustedWorkspaceScope,
  type WorkspacePermissionId,
  type LibraryAuditContext,
} from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { appendControlPlaneAuditEventInTransaction } from "./control-plane-audit.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";

interface LibraryRow extends RowDataPacket {
  id: string;
  version: number;
  lifecycleStatus: "active" | "archived";
  currentRevisionId: string | null;
}
interface SummaryRow extends LibraryRow {
  name: string;
  description: string;
  entryCount: number;
  updatedAt: Date;
}
interface RevisionRow extends RowDataPacket {
  id: string;
  libraryId: string;
  revisionNumber: number;
  document: unknown;
  contentDigest: string;
  requestHash: string;
  createdAt: Date;
}
const revisionSelect = `SELECT id, library_id AS libraryId, revision_number AS revisionNumber,
  content_document AS document, content_digest AS contentDigest,
  request_hash AS requestHash, created_at AS createdAt FROM resource_library_revision`;

function fail(code: string, message: string): never {
  throw new DomainError(`resource_library.${code}`, message);
}
function revisionFrom(row: RevisionRow): ResourceLibraryRevision {
  const document = normalizeResourceLibraryDocument(
    typeof row.document === "string" ? JSON.parse(row.document) : row.document,
  );
  if (digestProviderValue(document) !== row.contentDigest) {
    return fail(
      "integrity",
      "Library revision content does not match its digest.",
    );
  }
  return Object.freeze({
    id: row.id,
    libraryId: row.libraryId,
    revisionNumber: row.revisionNumber,
    document,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
}
async function transaction<T>(
  pool: Pool,
  action: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function lockLibrary(
  connection: PoolConnection,
  workspaceId: string,
  libraryId: string,
): Promise<LibraryRow | undefined> {
  const [rows] = await connection.execute<LibraryRow[]>(
    `SELECT id, version, lifecycle_status AS lifecycleStatus, current_revision_id AS currentRevisionId
     FROM resource_library WHERE workspace_id = ? AND id = ? FOR UPDATE`,
    [workspaceId, libraryId],
  );
  return rows[0];
}
async function audit(
  connection: PoolConnection,
  options: {
    authority: TrustedWorkspaceScope;
    audit: LibraryAuditContext;
    libraryId: string;
    now: Date;
  },
  action: string,
  version: number,
): Promise<void> {
  const { authority } = options;
  await appendControlPlaneAuditEventInTransaction(
    connection,
    {
      auditEventId: options.audit.auditEventId,
      actorPrincipalId: authority.principalId,
      actorType: authority.principalType,
      authenticationRefType: authority.authenticationRefType,
      authenticationRefHash: options.audit.authenticationRefHash,
      authorityType: authority.authorityType,
      authorityId: authority.authorityId,
      authorityVersion: authority.authorityVersion,
      ...(options.audit.requestId
        ? { requestId: options.audit.requestId }
        : {}),
    },
    {
      organizationId: authority.organizationId,
      workspaceId: authority.workspaceId,
      eventType: action,
      action,
      resourceType: "resource_library",
      resourceId: options.libraryId,
      outcome: "succeeded",
      decisionReasonCode: action,
      severity: "info",
      authorizationDecision: {
        permission: "library.manage",
        authorityVersion: authority.authorityVersion,
      },
      details: { version },
      occurredAt: options.now,
    },
  );
}

async function validateEntries(
  connection: PoolConnection,
  options: SaveResourceLibrary,
): Promise<void> {
  if (
    options.document.entries.some((entry) => entry.sourceAssetId !== undefined)
  ) {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "asset.read",
      options.now,
    );
  }
  for (const entry of options.document.entries) {
    const [rows] = await connection.execute<
      (RowDataPacket & { mediaType: string; byteSize: string | number })[]
    >(
      `SELECT object.media_type AS mediaType, object.byte_size AS byteSize
       FROM artifact
       INNER JOIN stored_object AS object ON object.workspace_id = artifact.workspace_id AND object.id = artifact.stored_object_id
       WHERE artifact.workspace_id = ? AND artifact.id = ?
         AND artifact.availability_status = 'available' AND object.delete_state = 'active'
         AND artifact.content_digest = CONCAT('sha256:', object.sha256)
         AND ${
           entry.sourceAssetId !== undefined
             ? `artifact.asset_id = ? AND EXISTS (SELECT 1 FROM asset WHERE asset.workspace_id = artifact.workspace_id AND asset.id = artifact.asset_id AND asset.lifecycle_status = 'active')`
             : `EXISTS (SELECT 1 FROM resource_library_upload AS upload WHERE upload.workspace_id = artifact.workspace_id AND upload.library_id = ? AND upload.artifact_id = artifact.id)`
         }
       FOR SHARE`,
      [
        options.authority.workspaceId,
        entry.artifactId,
        entry.sourceAssetId ?? options.libraryId,
      ],
    );
    const row = rows[0];
    if (
      !row ||
      !libraryMediaTypes.some((media) => media === row.mediaType) ||
      (row.mediaType.startsWith("text/") &&
        (Number(row.byteSize) < 1 ||
          Number(row.byteSize) > libraryTextMaximumBytes))
    ) {
      fail(
        "reference_unavailable",
        "One selected reference is unavailable or not eligible for this library.",
      );
    }
  }
}

export function createResourceLibraryStore(
  pool: Pool,
): ResourceLibraryRepository {
  function authorized<T>(
    authority: TrustedWorkspaceScope,
    permission: WorkspacePermissionId,
    now: Date,
    action: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    return transaction(pool, async (connection) => {
      await revalidateTrustedWorkspaceScopeInTransaction(
        connection,
        authority,
        permission,
        now,
      );
      return action(connection);
    });
  }
  return {
    getTextSource(options) {
      assertLibraryId(options.libraryId);
      assertLibraryId(options.artifactId);
      return transaction(pool, (connection) =>
        readLibraryTextSource(connection, options),
      );
    },
    indexText(options) {
      assertLibraryId(options.libraryId);
      assertLibraryId(options.artifactId);
      return transaction(pool, (connection) =>
        writeLibraryTextIndex(connection, options),
      );
    },
    authorizeUpload(options) {
      assertLibraryId(options.libraryId);
      return authorized(
        options.authority,
        "library.manage",
        options.now,
        async (connection) => {
          const library = await lockLibrary(
            connection,
            options.authority.workspaceId,
            options.libraryId,
          );
          if (!library || library.lifecycleStatus !== "active")
            fail("unavailable", "The library is not available for uploads.");
        },
      );
    },
    getSummary(options) {
      assertLibraryId(options.libraryId);
      return authorized(
        options.authority,
        "library.read",
        options.now,
        async (connection) => {
          const [rows] = await connection.execute<SummaryRow[]>(
            `SELECT id, name, description, lifecycle_status AS lifecycleStatus, version, current_revision_id AS currentRevisionId, updated_at AS updatedAt,
           (SELECT COUNT(*) FROM resource_library_entry WHERE workspace_id = ? AND revision_id = library.current_revision_id) AS entryCount
           FROM resource_library AS library WHERE workspace_id = ? AND id = ?`,
            [
              options.authority.workspaceId,
              options.authority.workspaceId,
              options.libraryId,
            ],
          );
          const row = rows[0];
          if (!row?.currentRevisionId)
            return fail("not_found", "Resource Library was not found.");
          return {
            id: row.id,
            name: row.name,
            description: row.description,
            lifecycleStatus: row.lifecycleStatus,
            version: row.version,
            currentRevisionId: row.currentRevisionId,
            entryCount: Number(row.entryCount),
            updatedAt: row.updatedAt,
          };
        },
      );
    },
    list(options) {
      if (
        !Number.isInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 100 ||
        (options.query?.length ?? 0) > 200
      ) {
        fail("invalid_argument", "Invalid library list bounds.");
      }
      if (options.afterId) assertLibraryId(options.afterId);
      return authorized(
        options.authority,
        "library.read",
        options.now,
        async (connection) => {
          const query = options.query?.trim() ?? "";
          const [rows] = await connection.execute<SummaryRow[]>(
            `SELECT library.id, library.name, library.description, library.lifecycle_status AS lifecycleStatus,
           library.version, library.current_revision_id AS currentRevisionId, library.updated_at AS updatedAt,
           (SELECT COUNT(*) FROM resource_library_entry AS entry WHERE entry.workspace_id = library.workspace_id AND entry.revision_id = library.current_revision_id) AS entryCount
           FROM resource_library AS library
           WHERE library.workspace_id = ? AND library.lifecycle_status = ? AND library.id > ?
             AND (? = '' OR LOCATE(?, library.name) > 0 OR LOCATE(?, library.description) > 0
               OR EXISTS (SELECT 1 FROM resource_library_entry AS entry WHERE entry.workspace_id = library.workspace_id
                 AND entry.revision_id = library.current_revision_id AND (LOCATE(?, entry.name) > 0 OR LOCATE(?, entry.purpose) > 0)))
           ORDER BY library.id LIMIT ?`,
            [
              options.authority.workspaceId,
              options.lifecycleStatus,
              options.afterId ?? "",
              query,
              query,
              query,
              query,
              query,
              String(options.limit),
            ],
          );
          return Object.freeze(
            rows.map((row): ResourceLibrarySummary => {
              if (!row.currentRevisionId)
                return fail("integrity", "Library has no current revision.");
              return Object.freeze({
                id: row.id,
                name: row.name,
                description: row.description,
                lifecycleStatus: row.lifecycleStatus,
                version: row.version,
                currentRevisionId: row.currentRevisionId,
                entryCount: Number(row.entryCount),
                updatedAt: row.updatedAt,
              });
            }),
          );
        },
      );
    },
    getRevision(options) {
      assertLibraryId(options.libraryId);
      if (options.revisionId) assertLibraryId(options.revisionId);
      return authorized(
        options.authority,
        "library.read",
        options.now,
        async (connection) => {
          const [rows] = await connection.execute<RevisionRow[]>(
            `${revisionSelect} WHERE workspace_id = ? AND library_id = ? AND id = ${options.revisionId ? "?" : "(SELECT current_revision_id FROM resource_library WHERE workspace_id = ? AND id = ?)"}`,
            [
              options.authority.workspaceId,
              options.libraryId,
              ...(options.revisionId
                ? [options.revisionId]
                : [options.authority.workspaceId, options.libraryId]),
            ],
          );
          if (!rows[0])
            return fail(
              "not_found",
              "Resource Library revision was not found.",
            );
          return revisionFrom(rows[0]);
        },
      );
    },
    save(input) {
      assertLibraryId(input.libraryId);
      assertLibraryId(input.revisionId);
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0 ||
        !/^[\x21-\x7e]{1,160}$/u.test(input.requestKey)
      ) {
        fail("invalid_argument", "Invalid library version or request key.");
      }
      const options = {
        ...input,
        document: normalizeResourceLibraryDocument(input.document),
      };
      const requestHash = digestProviderValue({
        document: options.document,
        expectedVersion: options.expectedVersion,
        actor: options.authority.principalId,
      });
      return authorized(
        options.authority,
        "library.manage",
        options.now,
        async (connection) => {
          // A unique identity insert serializes concurrent create requests. The transaction
          // rolls back a conflicting or failed create instead of leaving an empty library.
          if (options.expectedVersion === 0) {
            await connection.execute(
              `INSERT INTO resource_library (id, workspace_id, name, description, lifecycle_status, version,
             created_by_principal_id, updated_by_principal_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = resource_library.id`,
              [
                options.libraryId,
                options.authority.workspaceId,
                options.document.name,
                options.document.description,
                options.authority.principalId,
                options.authority.principalId,
                options.now,
                options.now,
              ],
            );
          }
          const library = await lockLibrary(
            connection,
            options.authority.workspaceId,
            options.libraryId,
          );
          if (!library)
            return fail("not_found", "Resource Library was not found.");
          const [replays] = await connection.execute<RevisionRow[]>(
            `${revisionSelect} WHERE workspace_id = ? AND library_id = ? AND request_key = ?`,
            [
              options.authority.workspaceId,
              options.libraryId,
              options.requestKey,
            ],
          );
          if (replays[0]) {
            if (replays[0].requestHash !== requestHash)
              return fail(
                "request_conflict",
                "Request key was already used for another mutation.",
              );
            return { revision: revisionFrom(replays[0]), replayed: true };
          }
          if (library.version !== options.expectedVersion)
            return fail(
              "version_conflict",
              "The library changed. Reload before saving.",
            );
          if (library.lifecycleStatus !== "active")
            return fail("archived", "Restore the library before editing.");
          await validateEntries(connection, options);
          const revisionNumber = library.version + 1;
          const contentDigest = digestProviderValue(options.document);
          await connection.execute(
            `INSERT INTO resource_library_revision (id, workspace_id, library_id, revision_number, content_document,
           content_digest, request_key, request_hash, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              options.revisionId,
              options.authority.workspaceId,
              options.libraryId,
              revisionNumber,
              canonicalizeProviderValue(options.document),
              contentDigest,
              options.requestKey,
              requestHash,
              options.authority.principalId,
              options.now,
            ],
          );
          for (const [position, entry] of options.document.entries.entries()) {
            await connection.execute(
              `INSERT INTO resource_library_entry (workspace_id, library_id, revision_id, entry_id, artifact_id,
             source_asset_id, name, purpose, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                options.authority.workspaceId,
                options.libraryId,
                options.revisionId,
                entry.id,
                entry.artifactId,
                entry.sourceAssetId ?? null,
                entry.name,
                entry.purpose,
                position,
              ],
            );
          }
          await connection.execute(
            `UPDATE resource_library SET name = ?, description = ?, version = ?, current_revision_id = ?, updated_by_principal_id = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
            [
              options.document.name,
              options.document.description,
              revisionNumber,
              options.revisionId,
              options.authority.principalId,
              options.now,
              options.authority.workspaceId,
              options.libraryId,
            ],
          );
          await audit(
            connection,
            options,
            "resource_library.saved",
            revisionNumber,
          );
          return {
            revision: Object.freeze({
              id: options.revisionId,
              libraryId: options.libraryId,
              revisionNumber,
              document: options.document,
              contentDigest,
              createdAt: options.now,
            }),
            replayed: false,
          };
        },
      );
    },
    setLifecycle(options) {
      assertLibraryId(options.libraryId);
      if (
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1 ||
        !["active", "archived"].includes(options.lifecycleStatus)
      ) {
        fail("invalid_argument", "Invalid lifecycle mutation.");
      }
      return authorized(
        options.authority,
        "library.manage",
        options.now,
        async (connection) => {
          const library = await lockLibrary(
            connection,
            options.authority.workspaceId,
            options.libraryId,
          );
          if (!library)
            return fail("not_found", "Resource Library was not found.");
          if (library.version !== options.expectedVersion)
            return fail(
              "version_conflict",
              "The library changed. Reload before saving.",
            );
          if (library.lifecycleStatus === options.lifecycleStatus) return;
          await connection.execute(
            `UPDATE resource_library SET lifecycle_status = ?, version = version + 1, updated_by_principal_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
            [
              options.lifecycleStatus,
              options.authority.principalId,
              options.now,
              options.authority.workspaceId,
              options.libraryId,
            ],
          );
          await audit(
            connection,
            options,
            `resource_library.${options.lifecycleStatus}`,
            library.version + 1,
          );
        },
      );
    },
  };
}
