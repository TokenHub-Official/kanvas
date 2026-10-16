import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { parseSkillPublicationDocument } from "./publication-documents.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export interface SkillPackageResourceRecord {
  readonly storedObjectId: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly contentDigest: string;
  readonly mediaType: string;
}

export interface SkillDraftSummaryRecord {
  readonly id: string;
  readonly skillDefinitionId: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly coverAssetId?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly exampleRequests: readonly string[];

  readonly visibility: "private" | "workspace";
  readonly definitionVersion: number;
  readonly presentationVersion: number;
  readonly draftVersion: number;
  readonly canonicalDigest: string;
  readonly candidateId?: string;
  readonly candidateDigest?: string;
  readonly passedCheckCount: number;
  readonly publishedSkillRevisionId?: string;
  readonly publishedSkillRevision?: number;
  readonly publishedCurrent: boolean;
  readonly updatedAt: Date;
}

export interface SkillRevisionPackageRecord {
  readonly skillDefinitionId: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly skillRevisionId: string;
  readonly skillRevision: number;
  readonly packageDigest: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly resources: readonly {
    readonly path: string;
    readonly resourceKind:
      "instructions" | "reference" | "template" | "asset" | "eval";
    readonly mediaType: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly contentDigest: string;
    readonly storageProfileId: string;
    readonly container: string;
    readonly objectKey: string;
    readonly storageVersionId?: string;
    readonly immutableIdentityHash: string;
  }[];
}

export interface SkillDraftResourceRecord {
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface SkillLibraryStore {
  materializeRunImage(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly runId: string;
    readonly skillRevisionId: string;
    readonly path: string;
    readonly artifactId: string;
    readonly now: Date;
  }): Promise<string>;
  commitPackageResource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly uploadSessionId: string;
    readonly storedObjectId: string;
    readonly now: Date;
  }): Promise<SkillPackageResourceRecord>;
  listDrafts(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly SkillDraftSummaryRecord[]>;
  readDraftResource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly storedObjectId: string;
    readonly now: Date;
  }): Promise<SkillDraftResourceRecord>;
  updatePresentation(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId: string;
    readonly expectedVersion: number;
    readonly displayName: string;
    readonly summary: string;
    readonly coverAssetId?: string;
    readonly category?: string;
    readonly tags: readonly string[];
    readonly exampleRequests: readonly string[];

    readonly now: Date;
  }): Promise<void>;
  recordDerivation(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId: string;
    readonly sourceThreadId: string;
    readonly sourceRunId: string;
    readonly sourceArtifactId?: string;
    readonly sourceDigest: string;
    readonly now: Date;
  }): Promise<void>;
  resolveDerivationSource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly artifactId: string;
    readonly now: Date;
  }): Promise<{ readonly sourceRunId: string }>;
  verifyCandidateTestEvidence(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly threadId: string;
    readonly runId: string;
    readonly artifactId?: string;
    readonly now: Date;
  }): Promise<void>;
  readRevisionPackage(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId: string;
    readonly skillRevisionId?: string;
    readonly now: Date;
  }): Promise<SkillRevisionPackageRecord>;
}

export class SkillLibraryStoreError extends Error {
  public constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SkillLibraryStoreError";
  }
}

interface UploadRow extends RowDataPacket {
  readonly state: string;
  readonly actorId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedIdentityHash: string | null;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly committedStoredObjectId: string | null;
  readonly expiresAt: Date;
}

interface DraftRow extends RowDataPacket {
  readonly id: string;
  readonly skillDefinitionId: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly coverAssetId: string | null;
  readonly category: string | null;
  readonly tags: unknown;
  readonly exampleRequests: unknown;

  readonly visibility: "private" | "workspace";
  readonly definitionVersion: number;
  readonly presentationVersion: number;
  readonly draftVersion: number;
  readonly canonicalDigest: string;
  readonly candidateId: string | null;
  readonly candidateDigest: string | null;
  readonly passedCheckCount: number | string;
  readonly publishedSkillRevisionId: string | null;
  readonly publishedSkillRevision: number | null;
  readonly publishedCurrent: number | string;
  readonly updatedAt: Date;
}

interface RevisionRow extends RowDataPacket {
  readonly skillDefinitionId: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly skillRevisionId: string;
  readonly skillRevision: number;
  readonly packageDigest: string;
  readonly manifest: unknown;
}

interface ResourceRow extends RowDataPacket {
  readonly path: string;
  readonly resourceKind: SkillRevisionPackageRecord["resources"][number]["resourceKind"];
  readonly mediaType: string;
  readonly byteSize: string | number | bigint;
  readonly sha256: string;
  readonly contentDigest: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly immutableIdentityHash: string;
}

function fail(code: string, message: string): never {
  throw new SkillLibraryStoreError(code, message);
}

function requireId(value: string, label: string): void {
  if (!idPattern.test(value))
    fail("skill_library.invalid_argument", `${label} is invalid.`);
}

function stringList(value: unknown): readonly string[] {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return fail(
        "skill_library.integrity",
        "Stored Skill presentation is invalid.",
      );
    }
  }
  if (
    !Array.isArray(decoded) ||
    !decoded.every((item) => typeof item === "string")
  ) {
    return fail(
      "skill_library.integrity",
      "Stored Skill presentation is invalid.",
    );
  }
  return Object.freeze(decoded);
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return fail(
        "skill_library.integrity",
        "Stored Skill manifest is invalid.",
      );
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return fail("skill_library.integrity", "Stored Skill manifest is invalid.");
  }
  return Object.freeze(decoded as Record<string, unknown>);
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
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

export function createSkillLibraryStore(pool: Pool): SkillLibraryStore {
  return Object.freeze({
    materializeRunImage(
      options: Parameters<SkillLibraryStore["materializeRunImage"]>[0],
    ) {
      requireId(options.runId, "runId");
      requireId(options.skillRevisionId, "skillRevisionId");
      requireId(options.artifactId, "artifactId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.use",
          options.now,
        );
        const [runs] = await connection.execute<RowDataPacket[]>(
          `SELECT run.id FROM agent_run AS run
           INNER JOIN agent_run_foundation_context AS context ON context.agent_run_id = run.id
           WHERE run.workspace_id = ? AND run.id = ? AND run.actor_principal_id = ?
             AND run.lifecycle_status = 'running'
             AND JSON_CONTAINS(context.skill_context_snapshot, JSON_OBJECT('skillRevisionId', ?))`,
          [
            options.authority.workspaceId,
            options.runId,
            options.authority.principalId,
            options.skillRevisionId,
          ],
        );
        if (!runs.length)
          return fail(
            "skill_library.not_found",
            "The image is not part of this active Run.",
          );
        const [published] = await connection.execute<RowDataPacket[]>(
          `SELECT resource.stored_object_id AS storedObjectId, resource.content_digest AS contentDigest, resource.media_type AS mediaType
           FROM skill_revision_resource AS resource
           INNER JOIN skill_revision AS revision ON revision.workspace_id = resource.workspace_id AND revision.id = resource.skill_revision_id
           INNER JOIN skill_definition AS definition ON definition.workspace_id = revision.workspace_id AND definition.id = revision.skill_definition_id
           INNER JOIN skill_revision_activation AS activation ON activation.workspace_id = revision.workspace_id AND activation.skill_revision_id = revision.id
           WHERE resource.workspace_id = ? AND resource.skill_revision_id = ? AND resource.resource_path = ?
             AND resource.resource_kind IN ('asset', 'reference') AND revision.lifecycle_status = 'published'
             AND activation.runtime_status = 'enabled' AND definition.lifecycle_status = 'active'
             AND (definition.visibility = 'workspace' OR definition.owner_principal_id = ?)`,
          [
            options.authority.workspaceId,
            options.skillRevisionId,
            options.path,
            options.authority.principalId,
          ],
        );
        let resource = published[0] as
          | { storedObjectId: string; contentDigest: string; mediaType: string }
          | undefined;
        if (!resource) {
          const [candidates] = await connection.execute<RowDataPacket[]>(
            `SELECT candidate.content_document AS document FROM publication_candidate AS candidate
             INNER JOIN skill_draft AS draft ON draft.workspace_id = candidate.workspace_id AND draft.id = candidate.source_draft_id AND draft.version = candidate.source_draft_version
             INNER JOIN skill_definition AS definition ON definition.workspace_id = draft.workspace_id AND definition.id = draft.skill_definition_id
             WHERE candidate.workspace_id = ? AND candidate.id = ? AND candidate.subject_kind = 'skill'
               AND draft.lifecycle_status = 'active' AND definition.lifecycle_status = 'active' AND definition.owner_principal_id = ?`,
            [
              options.authority.workspaceId,
              options.skillRevisionId,
              options.authority.principalId,
            ],
          );
          const document: unknown = candidates[0]?.document;
          if (document)
            resource = parseSkillPublicationDocument(
              typeof document === "string" ? JSON.parse(document) : document,
            ).resources.find(
              (item) =>
                item.path === options.path &&
                ["asset", "reference"].includes(item.resourceKind),
            );
        }
        if (
          !resource ||
          !["image/png", "image/jpeg", "image/webp"].includes(
            resource.mediaType,
          )
        )
          return fail(
            "skill_library.not_found",
            "The Skill image is unavailable.",
          );
        const [objects] = await connection.execute<RowDataPacket[]>(
          `SELECT object_fact.id, COALESCE((SELECT a.data_classification FROM artifact AS a WHERE a.workspace_id = object_fact.workspace_id AND a.stored_object_id = object_fact.id ORDER BY FIELD(a.data_classification, 'internal', 'confidential', 'restricted') DESC LIMIT 1), 'internal') AS dataClassification
           FROM stored_object AS object_fact WHERE object_fact.workspace_id = ? AND object_fact.id = ? AND object_fact.delete_state = 'active' AND CONCAT('sha256:', object_fact.sha256) = ? AND object_fact.media_type = ?`,
          [
            options.authority.workspaceId,
            resource.storedObjectId,
            resource.contentDigest,
            resource.mediaType,
          ],
        );
        if (!objects.length)
          return fail(
            "skill_library.integrity",
            "The Skill image changed or is missing.",
          );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO artifact (id, workspace_id, created_by_principal_id, stored_object_id, content_digest, artifact_type, availability_status, data_classification, display_filename, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, 'image.source', 'available', ?, ?, CAST(? AS JSON), ?)
           ON DUPLICATE KEY UPDATE id = artifact.id`,
          [
            options.artifactId,
            options.authority.workspaceId,
            options.authority.principalId,
            resource.storedObjectId,
            resource.contentDigest,
            String(objects[0]!.dataClassification),
            options.path.split("/").at(-1) ?? "image",
            JSON.stringify({
              source: "skill-resource",
              skillRevisionId: options.skillRevisionId,
              path: options.path,
            }),
            options.now,
          ],
        );
        const [artifacts] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM artifact WHERE workspace_id = ? AND id = ? AND stored_object_id = ? AND content_digest = ? AND availability_status = 'available'`,
          [
            options.authority.workspaceId,
            options.artifactId,
            resource.storedObjectId,
            resource.contentDigest,
          ],
        );
        if (!artifacts.length)
          return fail(
            "skill_library.integrity",
            "The image identity is already bound to another resource.",
          );
        return options.artifactId;
      });
    },
    commitPackageResource(
      options: Parameters<SkillLibraryStore["commitPackageResource"]>[0],
    ) {
      requireId(options.uploadSessionId, "uploadSessionId");
      requireId(options.storedObjectId, "storedObjectId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        const [rows] = await connection.execute<UploadRow[]>(
          `SELECT state, actor_id AS actorId,
                  storage_profile_id AS storageProfileId, container, object_key AS objectKey,
                  storage_version_id AS storageVersionId, provider_etag AS providerEtag,
                  sealed_identity_hash AS sealedIdentityHash,
                  CAST(verified_size AS CHAR) AS verifiedSize,
                  verified_sha256 AS verifiedSha256,
                  detected_media_type AS detectedMediaType,
                  committed_stored_object_id AS committedStoredObjectId,
                  expires_at AS expiresAt
             FROM upload_session
            WHERE workspace_id = ? AND id = ? AND purpose = 'server_package'
            LIMIT 1 FOR UPDATE`,
          [options.authority.workspaceId, options.uploadSessionId],
        );
        const upload = rows[0];
        if (!upload || upload.actorId !== options.authority.principalId) {
          return fail(
            "skill_library.not_found",
            "Skill package upload was not found.",
          );
        }
        if (upload.state === "committed") {
          if (upload.committedStoredObjectId !== options.storedObjectId) {
            return fail(
              "skill_library.identity_conflict",
              "Skill package upload was already committed differently.",
            );
          }
        } else {
          if (
            upload.state !== "verified" ||
            upload.expiresAt <= options.now ||
            !upload.sealedIdentityHash ||
            !upload.verifiedSize ||
            !upload.verifiedSha256 ||
            !upload.detectedMediaType
          ) {
            return fail(
              "skill_library.lifecycle_conflict",
              "Skill package upload is not ready to commit.",
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
              options.authority.workspaceId,
              options.uploadSessionId,
              upload.storageProfileId,
              upload.container,
              upload.objectKey,
              upload.storageVersionId,
              upload.providerEtag,
              upload.sealedIdentityHash,
              upload.verifiedSize,
              upload.verifiedSha256,
              upload.detectedMediaType,
              options.now,
            ],
          );
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE upload_session
                SET state = 'committed', committed_stored_object_id = ?,
                    committed_at = ?, updated_at = ?, version = version + 1
              WHERE workspace_id = ? AND id = ? AND state = 'verified'
                AND committed_stored_object_id IS NULL`,
            [
              options.storedObjectId,
              options.now,
              options.now,
              options.authority.workspaceId,
              options.uploadSessionId,
            ],
          );
          if (updated.affectedRows !== 1) {
            return fail(
              "skill_library.version_conflict",
              "Skill package commit lost its state transition.",
            );
          }
        }
        const [storedRows] = await connection.execute<
          (RowDataPacket & {
            readonly byteSize: string;
            readonly sha256: string;
            readonly mediaType: string;
          })[]
        >(
          `SELECT CAST(byte_size AS CHAR) AS byteSize, sha256, media_type AS mediaType
             FROM stored_object
            WHERE workspace_id = ? AND id = ? AND delete_state = 'active'
            LIMIT 1 FOR SHARE`,
          [options.authority.workspaceId, options.storedObjectId],
        );
        const stored = storedRows[0];
        if (!stored)
          return fail(
            "skill_library.integrity",
            "Committed Skill resource is unavailable.",
          );
        const byteSize = Number(stored.byteSize);
        return Object.freeze({
          storedObjectId: options.storedObjectId,
          byteSize,
          sha256: stored.sha256,
          contentDigest: `sha256:${stored.sha256}`,
          mediaType: stored.mediaType,
        });
      });
    },

    listDrafts(authority: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "skill.read",
          now,
        );
        const [rows] = await connection.execute<DraftRow[]>(
          `SELECT draft.id, draft.skill_definition_id AS skillDefinitionId,
                  draft.skill_key AS skillKey, presentation.display_name AS displayName,
                  presentation.summary, presentation.cover_asset_id AS coverAssetId,
                  presentation.category, presentation.tags,
                  presentation.example_requests AS exampleRequests,

                  definition.visibility, definition.version AS definitionVersion,
                  presentation.version AS presentationVersion,
                  draft.version AS draftVersion, draft.canonical_digest AS canonicalDigest,
                  candidate.id AS candidateId, candidate.canonical_digest AS candidateDigest,
                  (SELECT COUNT(*) FROM publication_check AS checks
                    WHERE checks.workspace_id = draft.workspace_id
                      AND checks.publication_candidate_id = candidate.id
                      AND checks.outcome = 'passed') AS passedCheckCount,
                  published.id AS publishedSkillRevisionId,
                  published.revision AS publishedSkillRevision,
                  COALESCE(published.publication_candidate_id = candidate.id, FALSE)
                    AS publishedCurrent,
                  draft.updated_at AS updatedAt
             FROM skill_draft AS draft
             INNER JOIN skill_definition AS definition
               ON definition.workspace_id = draft.workspace_id
              AND definition.id = draft.skill_definition_id
             INNER JOIN skill_presentation AS presentation
               ON presentation.workspace_id = definition.workspace_id
              AND presentation.skill_definition_id = definition.id
             LEFT JOIN publication_candidate AS candidate
               ON candidate.workspace_id = draft.workspace_id
              AND candidate.subject_kind = 'skill'
              AND candidate.source_draft_id = draft.id
              AND candidate.source_draft_version = draft.version
             LEFT JOIN skill_revision AS published
               ON published.workspace_id = definition.workspace_id
              AND published.skill_definition_id = definition.id
              AND published.lifecycle_status = 'published'
              AND NOT EXISTS (
                SELECT 1 FROM skill_revision AS newer
                 WHERE newer.workspace_id = published.workspace_id
                   AND newer.skill_definition_id = published.skill_definition_id
                   AND newer.lifecycle_status = 'published'
                   AND (newer.revision > published.revision
                     OR (newer.revision = published.revision AND newer.id > published.id)))
            WHERE draft.workspace_id = ?
              AND draft.lifecycle_status = 'active'
              AND definition.lifecycle_status = 'active'
              AND definition.owner_principal_id = ?
              AND draft.skill_key LIKE 'workspace.%'
            ORDER BY draft.updated_at DESC, draft.id DESC
            LIMIT 100`,
          [authority.workspaceId, authority.principalId],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              id: row.id,
              skillDefinitionId: row.skillDefinitionId,
              skillKey: row.skillKey,
              displayName: row.displayName,
              summary: row.summary,
              ...(row.coverAssetId ? { coverAssetId: row.coverAssetId } : {}),
              ...(row.category ? { category: row.category } : {}),
              tags: stringList(row.tags),
              exampleRequests: stringList(row.exampleRequests),

              visibility: row.visibility,
              definitionVersion: row.definitionVersion,
              presentationVersion: row.presentationVersion,
              draftVersion: row.draftVersion,
              canonicalDigest: row.canonicalDigest,
              ...(row.candidateId ? { candidateId: row.candidateId } : {}),
              ...(row.candidateDigest
                ? { candidateDigest: row.candidateDigest }
                : {}),
              passedCheckCount: Number(row.passedCheckCount),
              ...(row.publishedSkillRevisionId
                ? { publishedSkillRevisionId: row.publishedSkillRevisionId }
                : {}),
              ...(row.publishedSkillRevision
                ? { publishedSkillRevision: row.publishedSkillRevision }
                : {}),
              publishedCurrent:
                row.publishedCurrent === 1 || row.publishedCurrent === "1",
              updatedAt: new Date(row.updatedAt),
            }),
          ),
        );
      });
    },

    readDraftResource(
      options: Parameters<SkillLibraryStore["readDraftResource"]>[0],
    ) {
      requireId(options.draftId, "draftId");
      requireId(options.storedObjectId, "storedObjectId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.read",
          options.now,
        );
        const [rows] = await connection.execute<
          (RowDataPacket & {
            readonly storageProfileId: string;
            readonly container: string;
            readonly objectKey: string;
            readonly storageVersionId: string | null;
            readonly immutableIdentityHash: string | null;
            readonly byteSize: string;
            readonly sha256: string;
          })[]
        >(
          `SELECT object.storage_profile_id AS storageProfileId,
                  object.container, object.object_key AS objectKey,
                  object.storage_version_id AS storageVersionId,
                  object.immutable_identity_hash AS immutableIdentityHash,
                  CAST(object.byte_size AS CHAR) AS byteSize, object.sha256
             FROM skill_draft AS draft
             INNER JOIN skill_definition AS definition
               ON definition.workspace_id = draft.workspace_id
              AND definition.id = draft.skill_definition_id
             INNER JOIN stored_object AS object
               ON object.workspace_id = draft.workspace_id
              AND object.id = ? AND object.delete_state = 'active'
            WHERE draft.workspace_id = ? AND draft.id = ?
              AND draft.lifecycle_status = 'active'
              AND definition.lifecycle_status = 'active'
              AND definition.owner_principal_id = ?
              AND JSON_CONTAINS(
                    draft.content_document,
                    JSON_OBJECT('storedObjectId', ?),
                    '$.resources'
                  )
            LIMIT 1 FOR SHARE`,
          [
            options.storedObjectId,
            options.authority.workspaceId,
            options.draftId,
            options.authority.principalId,
            options.storedObjectId,
          ],
        );
        const row = rows[0];
        if (!row || !row.immutableIdentityHash) {
          return fail(
            "skill_library.not_found",
            "Skill Draft resource was not found.",
          );
        }
        return Object.freeze({
          storageProfileId: row.storageProfileId,
          container: row.container,
          objectKey: row.objectKey,
          ...(row.storageVersionId
            ? { storageVersionId: row.storageVersionId }
            : {}),
          immutableIdentityHash: row.immutableIdentityHash,
          byteSize: Number(row.byteSize),
          sha256: row.sha256,
        });
      });
    },

    updatePresentation(
      options: Parameters<SkillLibraryStore["updatePresentation"]>[0],
    ) {
      requireId(options.skillDefinitionId, "skillDefinitionId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE skill_presentation AS presentation
             INNER JOIN skill_definition AS definition
               ON definition.workspace_id = presentation.workspace_id
              AND definition.id = presentation.skill_definition_id
              SET presentation.display_name = ?, presentation.summary = ?,
                  presentation.cover_asset_id = ?, presentation.category = ?,
                  presentation.tags = CAST(? AS JSON),
                  presentation.example_requests = CAST(? AS JSON),
                  presentation.version = presentation.version + 1,
                  presentation.updated_by_principal_id = ?, presentation.updated_at = ?
           WHERE presentation.workspace_id = ?
             AND presentation.skill_definition_id = ?
             AND presentation.version = ?
             AND definition.lifecycle_status = 'active'
             AND (definition.owner_principal_id = ? OR ? = 1)`,
          [
            options.displayName,
            options.summary,
            options.coverAssetId ?? null,
            options.category ?? null,
            JSON.stringify(options.tags),
            JSON.stringify(options.exampleRequests),
            options.authority.principalId,
            options.now,
            options.authority.workspaceId,
            options.skillDefinitionId,
            options.expectedVersion,
            options.authority.principalId,
            options.authority.effectivePermissions.includes("workspace.manage")
              ? 1
              : 0,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "skill_library.version_conflict",
            "Skill presentation changed or is unavailable.",
          );
        }
      });
    },

    recordDerivation(
      options: Parameters<SkillLibraryStore["recordDerivation"]>[0],
    ) {
      requireId(options.skillDefinitionId, "skillDefinitionId");
      requireId(options.sourceThreadId, "sourceThreadId");
      requireId(options.sourceRunId, "sourceRunId");
      if (options.sourceArtifactId)
        requireId(options.sourceArtifactId, "sourceArtifactId");
      if (!digestPattern.test(options.sourceDigest)) {
        return Promise.reject(
          new SkillLibraryStoreError(
            "skill_library.invalid_argument",
            "sourceDigest is invalid.",
          ),
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO skill_derivation (
             workspace_id, skill_definition_id, source_thread_id, source_run_id,
             source_artifact_id, source_digest, created_by_principal_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.authority.workspaceId,
            options.skillDefinitionId,
            options.sourceThreadId,
            options.sourceRunId,
            options.sourceArtifactId ?? null,
            options.sourceDigest,
            options.authority.principalId,
            options.now,
          ],
        );
      });
    },

    resolveDerivationSource(
      options: Parameters<SkillLibraryStore["resolveDerivationSource"]>[0],
    ) {
      requireId(options.threadId, "threadId");
      requireId(options.artifactId, "artifactId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        const [rows] = await connection.execute<
          (RowDataPacket & { readonly sourceRunId: string })[]
        >(
          `SELECT receipt.agent_run_id AS sourceRunId
             FROM agent_action_receipt AS receipt
             INNER JOIN agent_run AS run
               ON run.workspace_id = receipt.workspace_id
              AND run.id = receipt.agent_run_id
             INNER JOIN agent_thread AS thread
               ON thread.workspace_id = run.workspace_id
              AND thread.id = run.thread_id
             INNER JOIN artifact
               ON artifact.workspace_id = receipt.workspace_id
              AND artifact.id = ?
              AND artifact.availability_status = 'available'
             INNER JOIN stored_object AS object
               ON object.workspace_id = artifact.workspace_id
              AND object.id = artifact.stored_object_id
              AND object.delete_state = 'active'
            WHERE receipt.workspace_id = ?
              AND thread.id = ?
              AND thread.created_by_principal_id = ?
              AND receipt.lifecycle_status = 'succeeded'
              AND (
                receipt.capability_run_id = artifact.created_by_capability_run_id
                OR EXISTS (
                  SELECT 1
                    FROM capability_run AS capability
                    INNER JOIN node_run AS node
                      ON node.workspace_id = capability.workspace_id
                     AND node.id = capability.node_run_id
                   WHERE capability.workspace_id = artifact.workspace_id
                     AND capability.id = artifact.created_by_capability_run_id
                     AND node.workflow_run_id = receipt.workflow_run_id
                )
              )
            ORDER BY receipt.created_at DESC, receipt.id DESC
            LIMIT 1 FOR SHARE`,
          [
            options.artifactId,
            options.authority.workspaceId,
            options.threadId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "skill_library.derivation_unavailable",
            "Choose an image produced in the current conversation.",
          );
        }
        return Object.freeze({ sourceRunId: row.sourceRunId });
      });
    },

    verifyCandidateTestEvidence(
      options: Parameters<SkillLibraryStore["verifyCandidateTestEvidence"]>[0],
    ) {
      requireId(options.candidateId, "candidateId");
      requireId(options.threadId, "threadId");
      requireId(options.runId, "runId");
      if (options.artifactId) requireId(options.artifactId, "artifactId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.manage",
          options.now,
        );
        const [candidateRows] = await connection.execute<RowDataPacket[]>(
          `SELECT candidate.id
             FROM publication_candidate AS candidate
             INNER JOIN skill_draft AS draft
               ON draft.workspace_id = candidate.workspace_id
              AND draft.id = candidate.source_draft_id
              AND draft.version = candidate.source_draft_version
             INNER JOIN skill_definition AS definition
               ON definition.workspace_id = draft.workspace_id
              AND definition.id = draft.skill_definition_id
            WHERE candidate.workspace_id = ? AND candidate.id = ?
              AND candidate.subject_kind = 'skill'
              AND definition.owner_principal_id = ?
            LIMIT 1 FOR SHARE`,
          [
            options.authority.workspaceId,
            options.candidateId,
            options.authority.principalId,
          ],
        );
        const candidate = candidateRows[0];
        if (!candidate) {
          return fail(
            "skill_library.not_found",
            "Skill Candidate was not found.",
          );
        }
        const [runRows] = await connection.execute<RowDataPacket[]>(
          `SELECT run.id
             FROM agent_run AS run
             INNER JOIN agent_thread AS thread
               ON thread.workspace_id = run.workspace_id
              AND thread.id = run.thread_id
            WHERE run.workspace_id = ? AND run.id = ? AND run.thread_id = ?
              AND run.actor_principal_id = ?
              AND run.lifecycle_status = 'succeeded'
              AND JSON_UNQUOTE(JSON_EXTRACT(
                    run.context_snapshot,
                    '$.requestedSkill.skillRevisionId'
                  )) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(
                    run.context_snapshot,
                    '$.requestedSkill.source'
                  )) = 'candidate'
            LIMIT 1 FOR SHARE`,
          [
            options.authority.workspaceId,
            options.runId,
            options.threadId,
            options.authority.principalId,
            options.candidateId,
          ],
        );
        if (!runRows[0]) {
          return fail(
            "skill_library.test_evidence_invalid",
            "The selected Agent Run did not successfully execute this Skill Candidate.",
          );
        }
        if (!options.artifactId) return;
        const [artifactRows] = await connection.execute<RowDataPacket[]>(
          `SELECT artifact.id
             FROM artifact
             INNER JOIN stored_object AS object
               ON object.workspace_id = artifact.workspace_id
              AND object.id = artifact.stored_object_id
              AND object.delete_state = 'active'
            WHERE artifact.workspace_id = ? AND artifact.id = ?
              AND artifact.availability_status = 'available'
              AND EXISTS (
                SELECT 1 FROM agent_action_receipt AS receipt
                 WHERE receipt.workspace_id = artifact.workspace_id
                   AND receipt.agent_run_id = ?
                   AND receipt.lifecycle_status = 'succeeded'
                   AND (
                     receipt.capability_run_id = artifact.created_by_capability_run_id
                     OR EXISTS (
                       SELECT 1
                         FROM capability_run AS capability
                         INNER JOIN node_run AS node
                           ON node.workspace_id = capability.workspace_id
                          AND node.id = capability.node_run_id
                        WHERE capability.workspace_id = artifact.workspace_id
                          AND capability.id = artifact.created_by_capability_run_id
                          AND node.workflow_run_id = receipt.workflow_run_id
                     )
                   )
              )
            LIMIT 1 FOR SHARE`,
          [options.authority.workspaceId, options.artifactId, options.runId],
        );
        if (!artifactRows[0]) {
          return fail(
            "skill_library.test_artifact_invalid",
            "The selected artifact was not produced by this Skill Candidate test.",
          );
        }
      });
    },

    readRevisionPackage(
      options: Parameters<SkillLibraryStore["readRevisionPackage"]>[0],
    ) {
      requireId(options.skillDefinitionId, "skillDefinitionId");
      if (options.skillRevisionId)
        requireId(options.skillRevisionId, "skillRevisionId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.read",
          options.now,
        );
        const [rows] = await connection.execute<RevisionRow[]>(
          `SELECT definition.id AS skillDefinitionId, definition.skill_key AS skillKey,
                  presentation.display_name AS displayName, presentation.summary,
                  revision.id AS skillRevisionId, revision.revision AS skillRevision,
                  revision.package_digest AS packageDigest,
                  revision.manifest_document AS manifest
             FROM skill_definition AS definition
             INNER JOIN skill_presentation AS presentation
               ON presentation.workspace_id = definition.workspace_id
              AND presentation.skill_definition_id = definition.id
             INNER JOIN skill_revision AS revision
               ON revision.workspace_id = definition.workspace_id
              AND revision.skill_definition_id = definition.id
            WHERE definition.workspace_id = ? AND definition.id = ?
              AND definition.lifecycle_status = 'active'
              AND revision.lifecycle_status = 'published'
              AND (definition.visibility = 'workspace' OR definition.owner_principal_id = ?)
              AND (? IS NULL OR revision.id = ?)
            ORDER BY revision.revision DESC, revision.id DESC
            LIMIT 1 FOR SHARE`,
          [
            options.authority.workspaceId,
            options.skillDefinitionId,
            options.authority.principalId,
            options.skillRevisionId ?? null,
            options.skillRevisionId ?? null,
          ],
        );
        const revision = rows[0];
        if (!revision)
          return fail(
            "skill_library.not_found",
            "Published Skill was not found.",
          );
        const [resourceRows] = await connection.execute<ResourceRow[]>(
          `SELECT resource.resource_path AS path, resource.resource_kind AS resourceKind,
                  resource.media_type AS mediaType, CAST(resource.byte_size AS CHAR) AS byteSize,
                  object.sha256, resource.content_digest AS contentDigest,
                  object.storage_profile_id AS storageProfileId, object.container,
                  object.object_key AS objectKey, object.storage_version_id AS storageVersionId,
                  object.immutable_identity_hash AS immutableIdentityHash
             FROM skill_revision_resource AS resource
             INNER JOIN stored_object AS object
               ON object.workspace_id = resource.workspace_id
              AND object.id = resource.stored_object_id
              AND object.delete_state = 'active'
            WHERE resource.workspace_id = ? AND resource.skill_revision_id = ?
            ORDER BY resource.ordinal ASC`,
          [options.authority.workspaceId, revision.skillRevisionId],
        );
        if (resourceRows.length < 1)
          return fail(
            "skill_library.integrity",
            "Published Skill has no resources.",
          );
        return Object.freeze({
          skillDefinitionId: revision.skillDefinitionId,
          skillKey: revision.skillKey,
          displayName: revision.displayName,
          summary: revision.summary,
          skillRevisionId: revision.skillRevisionId,
          skillRevision: revision.skillRevision,
          packageDigest: revision.packageDigest,
          manifest: jsonObject(revision.manifest),
          resources: Object.freeze(
            resourceRows.map((resource) =>
              Object.freeze({
                path: resource.path,
                resourceKind: resource.resourceKind,
                mediaType: resource.mediaType,
                byteSize: Number(resource.byteSize),
                sha256: resource.sha256,
                contentDigest: resource.contentDigest,
                storageProfileId: resource.storageProfileId,
                container: resource.container,
                objectKey: resource.objectKey,
                ...(resource.storageVersionId
                  ? { storageVersionId: resource.storageVersionId }
                  : {}),
                immutableIdentityHash: resource.immutableIdentityHash,
              }),
            ),
          ),
        });
      });
    },
  });
}
