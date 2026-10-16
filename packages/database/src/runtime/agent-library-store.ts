import {
  readLibraryTextSource,
  readLibraryTextIndex,
  writeLibraryTextIndex,
} from "./resource-library-text-store.js";
import { retainLibraryConsumerAuthority } from "./library-consumer-access.js";
import {
  assertLibraryId,
  DomainError,
  libraryMediaTypes,
  libraryTextPassages,
  type LibraryTextPassage,
  normalizeResourceLibraryDocument,
  type TrustedWorkspaceScope,
  type LibraryTextSource,
  type LibraryTextExtraction,
  type ResourceLibraryRevision,
} from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

export interface AgentLibraryScope {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly now: Date;
}
export interface AgentLibraryReference {
  readonly revisionNumber: number;
  readonly libraryId: string;
  readonly revisionId: string;
  readonly entryId: string;
  readonly name: string;
  readonly purpose: string;
  readonly artifactId: string;
  readonly sourceAssetId?: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly dataClassification: "internal" | "confidential" | "restricted";
  readonly byteSize: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string;
}
export type LibraryUseLocation = Omit<LibraryTextPassage, "text">;
export type LibraryUseKind = "text_read" | "image_view" | "tool_input";
export interface AgentLibraryUseView {
  readonly artifactId: string;
  readonly revisionId: string;
  readonly locations?: readonly LibraryUseLocation[];
  readonly runId: string;
  readonly libraryId: string;
  readonly libraryName: string;
  readonly revisionNumber: number;
  readonly entryId: string;
  readonly name: string;
  readonly kind: LibraryUseKind;
}
export interface AgentLibraryStore {
  pendingText(
    this: void,
    options: AgentLibraryScope & { readonly libraryId?: string },
  ): Promise<readonly (LibraryTextSource & { libraryId: string })[]>;
  cacheText(
    this: void,
    options: AgentLibraryScope & {
      libraryId: string;
      artifactId: string;
      contentDigest: string;
      sourceBytes: Uint8Array;
      extraction: LibraryTextExtraction;
    },
  ): Promise<void>;
  text(
    options: AgentLibraryScope & { libraryId: string; entryId: string },
  ): Promise<LibraryTextExtraction | undefined>;

  searchText(
    this: void,
    options: AgentLibraryScope & {
      readonly query: string;
      readonly libraryId?: string;
    },
  ): Promise<
    readonly {
      reference: AgentLibraryReference;
      text: string;
      extraction: LibraryTextExtraction;
      libraryName: string;
      revisionNumber: number;
    }[]
  >;

  listUses(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly runIds: readonly string[];
    readonly now: Date;
  }): Promise<readonly AgentLibraryUseView[]>;
  pin(
    options: AgentLibraryScope & { readonly libraryId: string },
  ): Promise<ResourceLibraryRevision>;
  reference(
    options: AgentLibraryScope & {
      readonly libraryId: string;
      readonly entryId: string;
    },
  ): Promise<AgentLibraryReference>;
  recordUse(
    options: AgentLibraryScope & {
      readonly reference: AgentLibraryReference;
      readonly useKey: string;
      readonly kind: LibraryUseKind;
      readonly locations?: readonly LibraryUseLocation[];
    },
  ): Promise<void>;
  catalog(options: AgentLibraryScope & { readonly query?: string }): Promise<
    readonly {
      id: string;
      name: string;
      description: string;
      bound: boolean;
      selected: boolean;
    }[]
  >;
}
interface RevisionRow extends RowDataPacket {
  id: string;
  libraryId: string;
  revisionNumber: number;
  document: unknown;
  contentDigest: string;
  createdAt: Date;
}
function fail(reason: string, message: string): never {
  throw new DomainError(`resource_library.${reason}`, message);
}
async function authorizeRun(
  connection: PoolConnection,
  options: AgentLibraryScope,
): Promise<void> {
  assertLibraryId(options.runId);
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    options.authority,
    "library.read",
    options.now,
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM agent_run WHERE workspace_id = ? AND id = ? AND actor_principal_id = ?
     AND lifecycle_status = 'running' AND execution_deadline_at > ? FOR UPDATE`,
    [
      options.authority.workspaceId,
      options.runId,
      options.authority.principalId,
      options.now,
    ],
  );
  if (!rows[0])
    fail("run_unavailable", "Library access requires an active owned Run.");
}

/** Caller must already lock and authorize the Run; creation uses its existing transaction. */
export async function pinAgentLibrariesInTransaction(
  connection: PoolConnection,
  options: AgentLibraryScope & {
    readonly libraryIds: readonly string[];
    readonly source: "explicit" | "discovered";
  },
): Promise<void> {
  if (options.libraryIds.length === 0) return;
  if (
    options.libraryIds.length > 8 ||
    new Set(options.libraryIds).size !== options.libraryIds.length
  )
    fail(
      "invalid_argument",
      "A Run can select up to eight distinct libraries.",
    );
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    options.authority,
    "library.read",
    options.now,
  );
  const [existing] = await connection.execute<
    (RowDataPacket & { libraryId: string })[]
  >(
    "SELECT library_id AS libraryId FROM agent_run_library WHERE workspace_id = ? AND run_id = ?",
    [options.authority.workspaceId, options.runId],
  );
  const selected = new Set(existing.map((row) => row.libraryId));
  for (const libraryId of options.libraryIds) {
    assertLibraryId(libraryId);
    if (selected.has(libraryId)) continue;
    if (selected.size >= 8)
      fail("limit", "This Run has reached its library limit.");
    const [libraries] = await connection.execute<
      (RowDataPacket & { revisionId: string | null })[]
    >(
      `SELECT current_revision_id AS revisionId FROM resource_library WHERE workspace_id = ? AND id = ? AND lifecycle_status = 'active' FOR SHARE`,
      [options.authority.workspaceId, libraryId],
    );
    const revisionId = libraries[0]?.revisionId;
    if (!revisionId)
      fail("unavailable", "The selected library is unavailable.");
    await connection.execute(
      `INSERT INTO agent_run_library (workspace_id, run_id, library_id, revision_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        options.authority.workspaceId,
        options.runId,
        libraryId,
        revisionId,
        options.source,
        options.now,
      ],
    );
    selected.add(libraryId);
  }
}
async function readPinned(
  connection: PoolConnection,
  options: AgentLibraryScope & { libraryId: string },
): Promise<ResourceLibraryRevision> {
  const [rows] = await connection.execute<RevisionRow[]>(
    `SELECT revision.id, revision.library_id AS libraryId, revision.revision_number AS revisionNumber,
      revision.content_document AS document, revision.content_digest AS contentDigest, revision.created_at AS createdAt
     FROM agent_run_library AS pin INNER JOIN resource_library_revision AS revision
       ON revision.workspace_id = pin.workspace_id AND revision.library_id = pin.library_id AND revision.id = pin.revision_id
     WHERE pin.workspace_id = ? AND pin.run_id = ? AND pin.library_id = ?`,
    [options.authority.workspaceId, options.runId, options.libraryId],
  );
  const row = rows[0];
  if (!row) return fail("not_found", "The Run has not selected this library.");
  const document = normalizeResourceLibraryDocument(
    typeof row.document === "string" ? JSON.parse(row.document) : row.document,
  );
  if (digestProviderValue(document) !== row.contentDigest)
    fail("integrity", "Pinned library content failed its digest check.");
  return {
    id: row.id,
    libraryId: row.libraryId,
    revisionNumber: row.revisionNumber,
    document,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}
async function readReference(
  connection: PoolConnection,
  options: AgentLibraryScope & { libraryId: string; entryId: string },
): Promise<AgentLibraryReference> {
  const revision = await readPinned(connection, options);
  const entry = revision.document.entries.find(
    (candidate) => candidate.id === options.entryId,
  );
  if (!entry)
    return fail(
      "not_found",
      "The reference is not in this Run's library revision.",
    );
  if (entry.sourceAssetId)
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "asset.read",
      options.now,
    );
  const [rows] = await connection.execute<
    (RowDataPacket &
      Omit<
        AgentLibraryReference,
        | "libraryId"
        | "revisionId"
        | "revisionNumber"
        | "entryId"
        | "name"
        | "purpose"
      >)[]
  >(
    `SELECT artifact.id AS artifactId, artifact.content_digest AS contentDigest, artifact.data_classification AS dataClassification, object.id AS storedObjectId,
      object.media_type AS mediaType, CAST(object.byte_size AS CHAR) AS byteSize, object.storage_profile_id AS storageProfileId,
      object.container, object.object_key AS objectKey, object.sha256, object.immutable_identity_hash AS immutableIdentityHash
     FROM artifact INNER JOIN stored_object AS object ON object.workspace_id = artifact.workspace_id AND object.id = artifact.stored_object_id
     WHERE artifact.workspace_id = ? AND artifact.id = ? AND artifact.availability_status = 'available' AND object.delete_state = 'active'
       AND artifact.content_digest = CONCAT('sha256:', object.sha256)
       AND ${entry.sourceAssetId ? "artifact.asset_id = ?" : "EXISTS (SELECT 1 FROM resource_library_upload AS upload WHERE upload.workspace_id = artifact.workspace_id AND upload.artifact_id = artifact.id AND upload.library_id = ?)"}
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
    !row.immutableIdentityHash ||
    !libraryMediaTypes.some((media) => media === row.mediaType)
  )
    return fail(
      "reference_unavailable",
      "Library content is no longer available.",
    );
  return {
    ...row,
    libraryId: options.libraryId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    entryId: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    ...(entry.sourceAssetId ? { sourceAssetId: entry.sourceAssetId } : {}),
  };
}
export function createAgentLibraryStore(pool: Pool): AgentLibraryStore {
  async function transaction<T>(
    options: AgentLibraryScope,
    action: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await authorizeRun(connection, options);
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
  return {
    async listUses(options) {
      assertLibraryId(options.threadId);
      if (options.runIds.length > 200)
        fail("input_limit", "Too many Runs for a library-use query.");
      options.runIds.forEach(assertLibraryId);
      if (!options.runIds.length) return [];
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.read",
          options.now,
        );
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "library.read",
          options.now,
        );
        const [threads] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM agent_thread WHERE workspace_id = ? AND id = ? AND created_by_principal_id = ? FOR SHARE",
          [
            options.authority.workspaceId,
            options.threadId,
            options.authority.principalId,
          ],
        );
        if (!threads[0]) fail("not_found", "Conversation not found.");
        const placeholders = options.runIds.map(() => "?").join(",");
        const [rows] = await connection.execute<
          (RowDataPacket & AgentLibraryUseView)[]
        >(
          `SELECT use_record.artifact_id AS artifactId, use_record.revision_id AS revisionId, use_record.locations, use_record.run_id AS runId, revision.library_id AS libraryId,
            JSON_UNQUOTE(JSON_EXTRACT(revision.content_document, '$.name')) AS libraryName,
            revision.revision_number AS revisionNumber, entry.entry_id AS entryId, entry.name, use_record.use_kind AS kind
           FROM agent_run_library_use AS use_record INNER JOIN agent_run AS run ON run.workspace_id = use_record.workspace_id AND run.id = use_record.run_id
           INNER JOIN resource_library_revision AS revision ON revision.workspace_id = use_record.workspace_id AND revision.id = use_record.revision_id
           INNER JOIN resource_library_entry AS entry ON entry.workspace_id = use_record.workspace_id AND entry.revision_id = use_record.revision_id AND entry.entry_id = use_record.entry_id
           WHERE use_record.workspace_id = ? AND run.thread_id = ? AND run.actor_principal_id = ? AND run.id IN (${placeholders})
           ORDER BY runId, libraryName, revisionNumber, entryId, kind`,
          [
            options.authority.workspaceId,
            options.threadId,
            options.authority.principalId,
            ...options.runIds,
          ],
        );
        await connection.commit();
        const uses = rows.map((row) => ({
          artifactId: row.artifactId,
          revisionId: row.revisionId,
          ...(row.locations
            ? {
                locations: (typeof row.locations === "string"
                  ? JSON.parse(row.locations)
                  : row.locations) as readonly LibraryUseLocation[],
              }
            : {}),
          runId: row.runId,
          libraryId: row.libraryId,
          libraryName: row.libraryName,
          revisionNumber: row.revisionNumber,
          entryId: row.entryId,
          name: row.name,
          kind: row.kind,
        }));
        return [
          ...new Map(
            uses.map((use) => [digestProviderValue(use), use]),
          ).values(),
        ];
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    pin(options) {
      assertLibraryId(options.libraryId);
      return transaction(options, async (connection) => {
        await pinAgentLibrariesInTransaction(connection, {
          ...options,
          libraryIds: [options.libraryId],
          source: "discovered",
        });
        return readPinned(connection, options);
      });
    },
    reference(options) {
      assertLibraryId(options.libraryId);
      assertLibraryId(options.entryId);
      return transaction(options, (connection) =>
        readReference(connection, options),
      );
    },
    recordUse(options) {
      if (
        !/^[\x21-\x7e]{1,160}$/u.test(options.useKey) ||
        !["text_read", "image_view", "tool_input"].includes(options.kind)
      )
        fail("invalid_argument", "Invalid library use identity.");
      return transaction(options, async (connection) => {
        const reference = await readReference(connection, {
          ...options,
          libraryId: options.reference.libraryId,
          entryId: options.reference.entryId,
        });
        if (
          reference.revisionId !== options.reference.revisionId ||
          reference.artifactId !== options.reference.artifactId ||
          reference.contentDigest !== options.reference.contentDigest
        )
          fail(
            "integrity",
            "Library content changed before its use was recorded.",
          );
        if (
          (options.kind === "text_read" &&
            reference.mediaType.startsWith("image/")) ||
          (options.kind === "image_view" &&
            !reference.mediaType.startsWith("image/"))
        )
          fail(
            "invalid_argument",
            "The content type does not match the recorded use.",
          );
        if (options.locations) {
          if (options.kind !== "text_read" || options.locations.length > 12)
            fail("invalid_argument", "Invalid source locations.");
          const extraction = await readLibraryTextIndex(
            connection,
            options.authority.workspaceId,
            reference.artifactId,
            reference.contentDigest,
          );
          if (!extraction)
            fail("integrity", "Source locations require indexed text.");
          const passages = libraryTextPassages(
            extraction.text,
            extraction.pageRanges,
          );
          for (const location of options.locations) {
            const passage = passages[location.number - 1];
            if (!passage)
              fail("invalid_argument", "Source passage does not exist.");
            const { text: _text, ...expected } = passage;
            void _text;
            if (digestProviderValue(expected) !== digestProviderValue(location))
              fail(
                "integrity",
                "Source location does not match the indexed document.",
              );
          }
        }
        const [existing] = await connection.execute<
          (RowDataPacket & {
            artifactId: string;
            kind: string;
            revisionId: string;
            entryId: string;
          })[]
        >(
          "SELECT artifact_id AS artifactId, use_kind AS kind, revision_id AS revisionId, entry_id AS entryId FROM agent_run_library_use WHERE workspace_id = ? AND run_id = ? AND use_key = ?",
          [options.authority.workspaceId, options.runId, options.useKey],
        );
        if (existing[0]) {
          if (
            existing[0].artifactId !== reference.artifactId ||
            existing[0].kind !== options.kind ||
            existing[0].revisionId !== reference.revisionId ||
            existing[0].entryId !== reference.entryId
          )
            fail(
              "request_conflict",
              "Use identity already records another reference.",
            );
          return;
        }
        await connection.execute(
          `INSERT INTO agent_run_library_use (workspace_id, run_id, revision_id, entry_id, artifact_id, use_key, use_kind, content_digest, locations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.authority.workspaceId,
            options.runId,
            reference.revisionId,
            reference.entryId,
            reference.artifactId,
            options.useKey,
            options.kind,
            reference.contentDigest,
            options.locations ? JSON.stringify(options.locations) : null,
            options.now,
          ],
        );
      });
    },
    pendingText(options) {
      if (options.libraryId) assertLibraryId(options.libraryId);
      return transaction(options, async (connection) => {
        const [rows] = await connection.execute<
          (RowDataPacket & { libraryId: string; artifactId: string })[]
        >(
          `SELECT DISTINCT library.id AS libraryId, entry.artifact_id AS artifactId FROM resource_library AS library
           LEFT JOIN agent_run_library AS pin ON pin.workspace_id = library.workspace_id AND pin.library_id = library.id AND pin.run_id = ?
           INNER JOIN resource_library_entry AS entry ON entry.workspace_id = library.workspace_id AND entry.revision_id = COALESCE(pin.revision_id, library.current_revision_id)
           INNER JOIN artifact ON artifact.workspace_id = entry.workspace_id AND artifact.id = entry.artifact_id
           INNER JOIN stored_object AS object ON object.workspace_id = artifact.workspace_id AND object.id = artifact.stored_object_id
           LEFT JOIN resource_library_text AS indexed ON indexed.workspace_id = entry.workspace_id AND indexed.artifact_id = entry.artifact_id
           WHERE library.workspace_id = ? AND (library.lifecycle_status = 'active' OR pin.run_id IS NOT NULL)
             AND (? IS NULL OR library.id = ?) AND (? OR entry.source_asset_id IS NULL) AND indexed.artifact_id IS NULL
             AND artifact.availability_status = 'available' AND object.delete_state = 'active'
             AND object.media_type IN ('text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
           ORDER BY library.id, entry.artifact_id LIMIT 9`,
          [
            options.runId,
            options.authority.workspaceId,
            options.libraryId ?? null,
            options.libraryId ?? null,
            options.authority.effectivePermissions.includes("asset.read"),
          ],
        );
        const sources = [];
        for (const row of rows)
          sources.push({
            ...(await readLibraryTextSource(connection, {
              ...options,
              libraryId: row.libraryId,
              artifactId: row.artifactId,
            })),
            libraryId: row.libraryId,
          });
        return sources;
      });
    },
    cacheText(options) {
      return transaction(options, (connection) =>
        writeLibraryTextIndex(connection, {
          ...options,
          text: options.extraction.text,
        }),
      );
    },
    text(options) {
      return transaction(options, async (connection) => {
        const reference = await readReference(connection, options);
        return readLibraryTextIndex(
          connection,
          options.authority.workspaceId,
          reference.artifactId,
          reference.contentDigest,
        );
      });
    },
    searchText(options) {
      const query = options.query.trim();
      if (!query || query.length > 200)
        fail("invalid_argument", "Search needs 1 to 200 characters.");
      const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
      const booleanQuery = terms.map((term) => `"${term}"`).join(" ");
      if (!booleanQuery)
        fail("invalid_argument", "Search needs a word or number.");
      if (options.libraryId) assertLibraryId(options.libraryId);
      return transaction(options, async (connection) => {
        const [rows] = await connection.execute<
          (RowDataPacket & {
            libraryId: string;
            entryId: string;
            artifactId: string;
            revisionId: string;
            text: string;
          })[]
        >(
          `SELECT library.id AS libraryId, entry.entry_id AS entryId, entry.artifact_id AS artifactId,
            entry.revision_id AS revisionId, indexed.text_content AS text
           FROM resource_library AS library
           LEFT JOIN agent_run_library AS pin ON pin.workspace_id = library.workspace_id AND pin.library_id = library.id AND pin.run_id = ?
           INNER JOIN resource_library_entry AS entry ON entry.workspace_id = library.workspace_id AND entry.revision_id = COALESCE(pin.revision_id, library.current_revision_id)
           INNER JOIN resource_library_text AS indexed ON indexed.workspace_id = entry.workspace_id AND indexed.artifact_id = entry.artifact_id
           INNER JOIN artifact ON artifact.workspace_id = entry.workspace_id AND artifact.id = entry.artifact_id AND artifact.content_digest = indexed.content_digest
           INNER JOIN stored_object AS object ON object.workspace_id = artifact.workspace_id AND object.id = artifact.stored_object_id
           WHERE library.workspace_id = ? AND (library.lifecycle_status = 'active' OR pin.run_id IS NOT NULL)
             AND (? IS NULL OR library.id = ?) AND (? OR entry.source_asset_id IS NULL) AND artifact.availability_status = 'available' AND object.delete_state = 'active'
             AND (MATCH(indexed.text_content) AGAINST (? IN BOOLEAN MODE) > 0 OR LOCATE(?, indexed.text_content) > 0)
           ORDER BY (pin.run_id IS NOT NULL) DESC, MATCH(indexed.text_content) AGAINST (? IN NATURAL LANGUAGE MODE) DESC, library.id, entry.position LIMIT 20`,
          [
            options.runId,
            options.authority.workspaceId,
            options.libraryId ?? null,
            options.libraryId ?? null,
            options.authority.effectivePermissions.includes("asset.read"),
            booleanQuery,
            query,
            query,
          ],
        );
        const [pins] = await connection.execute<
          (RowDataPacket & { libraryId: string })[]
        >(
          "SELECT library_id AS libraryId FROM agent_run_library WHERE workspace_id = ? AND run_id = ?",
          [options.authority.workspaceId, options.runId],
        );
        const selected = new Set(pins.map((row) => row.libraryId));
        const results = [];
        for (const row of rows) {
          if (!selected.has(row.libraryId) && selected.size >= 8) continue;
          await pinAgentLibrariesInTransaction(connection, {
            ...options,
            libraryIds: [row.libraryId],
            source: "discovered",
          });
          selected.add(row.libraryId);
          const revision = await readPinned(connection, {
            ...options,
            libraryId: row.libraryId,
          });
          if (revision.id !== row.revisionId)
            fail(
              "request_conflict",
              "Library changed while searching; retry against the pinned revision.",
            );
          const reference = await readReference(connection, {
            ...options,
            libraryId: row.libraryId,
            entryId: row.entryId,
          });
          const extraction = await readLibraryTextIndex(
            connection,
            options.authority.workspaceId,
            reference.artifactId,
            reference.contentDigest,
          );
          if (!extraction) continue;
          results.push({
            reference,
            extraction,
            text: extraction.text,
            libraryName: revision.document.name,
            revisionNumber: revision.revisionNumber,
          });
        }
        return results;
      });
    },
    catalog(options) {
      const query = options.query?.trim() ?? "";
      if (query.length > 200)
        fail("invalid_argument", "Library search is too long.");
      return transaction(options, async (connection) => {
        const [rows] = await connection.execute<
          (RowDataPacket & {
            id: string;
            name: string;
            description: string;
            bound: number | string;
            selected: number | string;
          })[]
        >(
          `SELECT library.id,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pinned.content_document, '$.name')), library.name) AS name,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pinned.content_document, '$.description')), library.description) AS description,
             EXISTS (SELECT 1 FROM agent_revision_library_binding AS binding INNER JOIN agent_thread AS thread
               ON thread.workspace_id = binding.workspace_id AND thread.agent_profile_revision_id = binding.profile_revision_id
               INNER JOIN agent_run AS run ON run.workspace_id = thread.workspace_id AND run.thread_id = thread.id
               WHERE binding.workspace_id = library.workspace_id AND binding.library_id = library.id AND run.id = ?) AS bound,
             EXISTS (SELECT 1 FROM agent_run_library AS pin WHERE pin.workspace_id = library.workspace_id AND pin.library_id = library.id AND pin.run_id = ?) AS selected
           FROM resource_library AS library
             LEFT JOIN agent_run_library AS current_pin ON current_pin.workspace_id = library.workspace_id AND current_pin.library_id = library.id AND current_pin.run_id = ?
             LEFT JOIN resource_library_revision AS pinned ON pinned.workspace_id = current_pin.workspace_id AND pinned.id = current_pin.revision_id
           WHERE library.workspace_id = ? AND (library.lifecycle_status = 'active' OR EXISTS
             (SELECT 1 FROM agent_run_library AS pin WHERE pin.workspace_id = library.workspace_id AND pin.library_id = library.id AND pin.run_id = ?))
             AND (? = '' OR LOCATE(?, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pinned.content_document, '$.name')), library.name)) > 0 OR LOCATE(?, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pinned.content_document, '$.description')), library.description)) > 0)
           ORDER BY selected DESC, bound DESC, library.name, library.id LIMIT 50`,
          [
            options.runId,
            options.runId,
            options.runId,
            options.authority.workspaceId,
            options.runId,
            query,
            query,
            query,
          ],
        );
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          bound: Number(row.bound) !== 0,
          selected: Number(row.selected) !== 0,
        }));
      });
    },
  };
}

/** Capture accepted execution input, not a proposal or a claim that the provider finished. */
export async function recordAgentLibraryToolInputsInTransaction(
  connection: PoolConnection,
  options: {
    readonly authority: TrustedWorkspaceScope;
    readonly invocationKind: string;
    readonly invocationReferenceId: string;
    readonly consumerId: string;
    readonly libraryReference?: {
      readonly libraryId: string;
      readonly entryId: string;
    };
    readonly requirePinnedInputs?: boolean;
    readonly consumerKind?: "capability" | "canvas" | "workflow";
    readonly input: unknown;
    readonly now: Date;
  },
): Promise<void> {
  const artifactIds = new Set<string>();
  let visited = 0;
  function visit(value: unknown, key: string, depth: number): void {
    if (++visited > 4096 || depth > 32)
      fail("input_limit", "Tool input exceeds reference inspection bounds.");
    if (
      typeof value === "string" &&
      /artifactids?$/iu.test(key) &&
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value)
    )
      artifactIds.add(value);
    else if (Array.isArray(value))
      value.forEach((item) => visit(item, key, depth + 1));
    else if (value && typeof value === "object")
      for (const [childKey, child] of Object.entries(value))
        visit(child, childKey, depth + 1);
  }
  visit(options.input, "", 0);
  if (artifactIds.size === 0) return;
  if (artifactIds.size > 64)
    fail("input_limit", "Too many tool Artifact inputs.");
  const placeholders = [...artifactIds].map(() => "?").join(",");
  const [uploads] = await connection.execute<
    (RowDataPacket & { artifactId: string })[]
  >(
    `SELECT artifact_id AS artifactId FROM resource_library_upload WHERE workspace_id = ? AND artifact_id IN (${placeholders})`,
    [options.authority.workspaceId, ...artifactIds],
  );
  if (uploads.length)
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "library.read",
      options.now,
    );
  const consumerKind = options.consumerKind ?? "capability";
  const consumerArtifacts = new Map(
    uploads.map((upload) => [upload.artifactId, false]),
  );
  const retainAuthority = () =>
    consumerKind === "canvas"
      ? Promise.resolve()
      : retainLibraryConsumerAuthority(connection, {
          authority: options.authority,
          consumerKind,
          consumerId: options.consumerId,
          artifacts: consumerArtifacts,
          now: options.now,
        });
  if (options.invocationKind !== "agent") {
    await retainAuthority();
    return;
  }
  const [pinnedReferences] = await connection.execute<
    (RowDataPacket & {
      runId: string;
      libraryId: string;
      entryId: string;
      artifactId: string;
    })[]
  >(
    `SELECT run.id AS runId, pin.library_id AS libraryId, entry.entry_id AS entryId, entry.artifact_id AS artifactId
     FROM agent_action_receipt AS action
     INNER JOIN agent_run AS run ON run.workspace_id = action.workspace_id AND run.id = action.agent_run_id
     INNER JOIN agent_run_library AS pin ON pin.workspace_id = run.workspace_id AND pin.run_id = run.id
     INNER JOIN resource_library_entry AS entry ON entry.workspace_id = pin.workspace_id AND entry.library_id = pin.library_id AND entry.revision_id = pin.revision_id
     WHERE action.workspace_id = ? AND action.id = ? AND action.lifecycle_status = 'running' AND run.actor_principal_id = ?
       AND run.lifecycle_status IN ('running','waiting_approval') AND run.execution_deadline_at > ?
       AND entry.artifact_id IN (${placeholders}) FOR SHARE`,
    [
      options.authority.workspaceId,
      options.invocationReferenceId,
      options.authority.principalId,
      options.now,
      ...artifactIds,
    ],
  );
  const references = options.libraryReference
    ? pinnedReferences.filter(
        (reference) =>
          reference.libraryId === options.libraryReference!.libraryId &&
          reference.entryId === options.libraryReference!.entryId,
      )
    : pinnedReferences;
  if (
    uploads.some(
      (upload) =>
        !references.some(
          (reference) => reference.artifactId === upload.artifactId,
        ),
    )
  )
    fail("not_selected", "A library input is not selected in this Agent Run.");
  if (
    options.requirePinnedInputs &&
    [...artifactIds].some(
      (artifactId) =>
        !references.some((reference) => reference.artifactId === artifactId),
    )
  )
    fail(
      "not_selected",
      "The tool input is not pinned in an active Agent Run.",
    );
  if (!references.length) return;
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    options.authority,
    "library.read",
    options.now,
  );
  for (const candidate of references) {
    const reference = await readReference(connection, {
      authority: options.authority,
      runId: candidate.runId,
      libraryId: candidate.libraryId,
      entryId: candidate.entryId,
      now: options.now,
    });
    consumerArtifacts.set(
      reference.artifactId,
      Boolean(reference.sourceAssetId) ||
        consumerArtifacts.get(reference.artifactId) === true,
    );
    if (
      options.consumerKind === "canvas" &&
      !reference.mediaType.startsWith("image/")
    )
      fail("reference_unavailable", "Canvas library inputs must be images.");
    await connection.execute(
      `INSERT INTO agent_run_library_use (workspace_id, run_id, revision_id, entry_id, artifact_id, use_key, use_kind, content_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, 'tool_input', ?, ?)`,
      [
        options.authority.workspaceId,
        candidate.runId,
        reference.revisionId,
        reference.entryId,
        reference.artifactId,
        `${options.consumerKind ?? "capability"}:${options.consumerId}:${reference.revisionId}:${reference.entryId}`,
        reference.contentDigest,
        options.now,
      ],
    );
  }
  await retainAuthority();
}
