import {
  authorizationModelVersion,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  EditorDraftContentV1,
  EditorNodeV1,
  EditorPageV1,
} from "@kanvas/contracts/editor";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { ulid } from "ulid";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import {
  AuthorizationStoreError,
  revalidateTrustedWorkspaceScopeInTransaction,
} from "./authorization-store.js";

export type CanvasExportFormat = "jpeg" | "png" | "webp";
export type CanvasExportDataClassification =
  "internal" | "confidential" | "restricted";

export interface CanvasExportRequest {
  readonly canvasDraftId: string;
  readonly documentVersion: number;
  readonly pageId: string;
  readonly format: CanvasExportFormat;
  readonly width: number;
  readonly height: number;
  readonly transparentBackground: boolean;
  readonly displayFilename: string;
  readonly requestHash: string;
}

export type CanvasExportTarget =
  | Readonly<{ kind: "artifact_only" }>
  | Readonly<{
      kind: "new_asset";
      assetId: string;
      name: string;
      assetType: string;
    }>
  | Readonly<{
      kind: "existing_asset";
      assetId: string;
      expectedVersion: number;
    }>;

export interface CanvasExportAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface CommitCanvasExportOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly exportSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly outboxEventId: string;
  readonly request: CanvasExportRequest;
  readonly target: CanvasExportTarget;
  readonly audit: CanvasExportAuditContext;
  readonly now: Date;
}

export interface CommittedCanvasExport {
  readonly status: "committed" | "replayed";
  readonly exportSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly assetId?: string;
  readonly assetVersion?: number;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly committedAt: Date;
}

export interface CanvasExportSessionRecord {
  readonly sourceRequest?: Pick<
    CanvasExportRequest,
    | "canvasDraftId"
    | "documentVersion"
    | "pageId"
    | "format"
    | "displayFilename"
  >;
  readonly exportSessionId: string;
  readonly state: "open" | "sealing" | "verifying" | "verified" | "committed";
  readonly expiresAt: Date;
  readonly expectedSize?: string;
  readonly replayed: boolean;
  readonly result?: CommittedCanvasExport;
}

export interface CanvasExportStore {
  get(
    authority: TrustedWorkspaceScope,
    exportSessionId: string,
    now: Date,
  ): Promise<CanvasExportSessionRecord>;
  commit(options: CommitCanvasExportOptions): Promise<CommittedCanvasExport>;
}

export type CanvasExportStoreErrorCode =
  | "canvas_export.invalid_argument"
  | "canvas_export.not_found"
  | "canvas_export.forbidden"
  | "canvas_export.runtime_fenced"
  | "canvas_export.state_conflict"
  | "canvas_export.idempotency_conflict";

export class CanvasExportStoreError extends Error {
  public constructor(
    public readonly code: CanvasExportStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanvasExportStoreError";
  }
}

export interface CreateCanvasExportStoreOptions {
  readonly instanceId: string;
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
}

interface ExportUploadRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string | null;
  readonly allocationRequestHash: string | null;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedIdentityHash: string | null;
  readonly state: string;
  readonly version: number;
  readonly expectedSize: string | null;
  readonly expiresAt: Date;
  readonly cleanupState: string;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly committedStoredObjectId: string | null;
  readonly committedAt: Date | null;
}

interface CanvasDraftRow extends RowDataPacket {
  readonly document: EditorDraftContentV1 | string;
  readonly contentDigest: string;
  readonly version: number;
}

interface AssetRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface SourceArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly availabilityStatus: string;
  readonly dataClassification: string;
}

interface CommittedExportRow extends RowDataPacket {
  readonly exportSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly assetId: string | null;
  readonly metadata: unknown;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly committedAt: Date;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const pageIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function fail(code: CanvasExportStoreErrorCode, message: string): never {
  throw new CanvasExportStoreError(code, message);
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
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

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

function parseRecord(value: unknown): Record<string, unknown> {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail(
      "canvas_export.state_conflict",
      "Canvas Export metadata is invalid.",
    );
  }
  return parsed as Record<string, unknown>;
}

function expectedMediaType(format: CanvasExportFormat): string {
  return `image/${format}`;
}

function targetFacts(
  target: CanvasExportTarget,
): Readonly<Record<string, unknown>> {
  if (target.kind === "artifact_only") {
    return { kind: target.kind };
  }
  if (target.kind === "new_asset") {
    return {
      kind: target.kind,
      name: target.name,
      assetType: target.assetType,
    };
  }
  return {
    kind: target.kind,
    assetId: target.assetId,
    expectedVersion: target.expectedVersion,
  };
}

function validateRequest(request: CanvasExportRequest): void {
  if (
    !idPattern.test(request.canvasDraftId) ||
    !Number.isSafeInteger(request.documentVersion) ||
    request.documentVersion < 1 ||
    !pageIdPattern.test(request.pageId) ||
    request.pageId.length > 160 ||
    (request.format !== "png" &&
      request.format !== "jpeg" &&
      request.format !== "webp") ||
    !Number.isSafeInteger(request.width) ||
    request.width < 64 ||
    request.width > 32_768 ||
    !Number.isSafeInteger(request.height) ||
    request.height < 64 ||
    request.height > 32_768 ||
    (request.format === "jpeg" && request.transparentBackground) ||
    !boundedText(request.displayFilename, 255) ||
    !digestPattern.test(request.requestHash)
  ) {
    fail(
      "canvas_export.invalid_argument",
      "Invalid Canvas Export request facts.",
    );
  }
}

function validateCommit(options: CommitCanvasExportOptions): void {
  validateRequest(options.request);
  if (
    options.authority.trusted !== true ||
    !idPattern.test(options.exportSessionId) ||
    !idPattern.test(options.storedObjectId) ||
    !idPattern.test(options.artifactId) ||
    !idPattern.test(options.outboxEventId) ||
    !idPattern.test(options.audit.auditEventId) ||
    !digestPattern.test(options.audit.authenticationRefHash) ||
    !validDate(options.now) ||
    (options.target.kind === "new_asset" &&
      (!idPattern.test(options.target.assetId) ||
        !boundedText(options.target.name, 240) ||
        !boundedText(options.target.assetType, 120))) ||
    (options.target.kind === "existing_asset" &&
      (!idPattern.test(options.target.assetId) ||
        !Number.isSafeInteger(options.target.expectedVersion) ||
        options.target.expectedVersion < 1))
  ) {
    fail(
      "canvas_export.invalid_argument",
      "Invalid Canvas Export commit facts.",
    );
  }
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
      "canvas_export.runtime_fenced",
      "Canvas Export is unavailable while the instance is fenced.",
    );
  }
  return row.executionGeneration;
}

async function readUpload(
  connection: PoolConnection,
  workspaceId: string,
  principalId: string,
  exportSessionId: string,
  lock: boolean,
): Promise<ExportUploadRow | undefined> {
  const [rows] = await connection.execute<ExportUploadRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       actor_id AS actorId,
       allocation_request_hash AS allocationRequestHash,
       storage_profile_id AS storageProfileId,
       container,
       object_key AS objectKey,
       storage_version_id AS storageVersionId,
       provider_etag AS providerEtag,
       sealed_identity_hash AS sealedIdentityHash,
       state,
       version,
       CAST(expected_size AS CHAR) AS expectedSize,
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
       AND purpose = 'canvas_export'
       AND actor_id = ?
     LIMIT 1
     ${lock ? "FOR UPDATE" : "FOR SHARE"}`,
    [workspaceId, exportSessionId, principalId],
  );
  return rows[0];
}

async function readCommitted(
  connection: PoolConnection,
  workspaceId: string,
  exportSessionId: string,
): Promise<CommittedExportRow | undefined> {
  const [rows] = await connection.execute<CommittedExportRow[]>(
    `SELECT
       upload_session.id AS exportSessionId,
       stored_object.id AS storedObjectId,
       artifact.id AS artifactId,
       artifact.asset_id AS assetId,
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
     WHERE upload_session.workspace_id = ?
       AND upload_session.id = ?
       AND upload_session.purpose = 'canvas_export'
       AND upload_session.state = 'committed'
     LIMIT 1`,
    [workspaceId, exportSessionId],
  );
  return rows[0];
}

function resultFromRow(
  row: CommittedExportRow,
  status: "committed" | "replayed",
): CommittedCanvasExport {
  const metadata = parseRecord(row.metadata);
  const exportMetadata = parseRecord(metadata.canvasExport);
  const assetVersion =
    typeof exportMetadata.assetVersion === "number" &&
    Number.isSafeInteger(exportMetadata.assetVersion) &&
    exportMetadata.assetVersion >= 1
      ? exportMetadata.assetVersion
      : undefined;
  if (
    !digestPattern.test(row.contentDigest) ||
    !mediaTypePattern.test(row.mediaType) ||
    !uint64Pattern.test(row.byteSize) ||
    !validDate(row.committedAt)
  ) {
    return fail(
      "canvas_export.state_conflict",
      "Committed Canvas Export facts are incomplete.",
    );
  }
  return Object.freeze({
    status,
    exportSessionId: row.exportSessionId,
    storedObjectId: row.storedObjectId,
    artifactId: row.artifactId,
    ...(row.assetId ? { assetId: row.assetId } : {}),
    ...(assetVersion ? { assetVersion } : {}),
    contentDigest: row.contentDigest,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    committedAt: row.committedAt,
  });
}

function parseDocument(
  value: EditorDraftContentV1 | string,
): EditorDraftContentV1 {
  const document =
    typeof value === "string"
      ? (JSON.parse(value) as EditorDraftContentV1)
      : value;
  if (
    document.schemaVersion !== "kanvas.editor-document/v1" ||
    !Array.isArray(document.pages)
  ) {
    return fail(
      "canvas_export.state_conflict",
      "Canvas Draft document is invalid.",
    );
  }
  return document;
}

function collectNodeSourceArtifactIds(
  node: EditorNodeV1,
  ids: Set<string>,
): void {
  if (node.kind === "image") {
    ids.add(node.image.source.artifactId);
    return;
  }
  if (node.kind === "graphic" && node.source.kind === "artifact") {
    ids.add(node.source.artifactId);
    return;
  }
  if (node.kind === "frame" && node.content) {
    ids.add(node.content.image.source.artifactId);
    return;
  }
  if (node.kind === "grid") {
    for (const cell of node.cells) {
      if (cell.content) {
        ids.add(cell.content.image.source.artifactId);
      }
    }
    return;
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      collectNodeSourceArtifactIds(child, ids);
    }
  }
}

function sourceArtifactIds(page: EditorPageV1): readonly string[] {
  const ids = new Set<string>();
  if (page.background.kind === "image") {
    ids.add(page.background.image.source.artifactId);
  }
  for (const node of page.nodes) {
    collectNodeSourceArtifactIds(node, ids);
  }
  return [...ids].sort();
}

const dataClassificationRank = Object.freeze({
  internal: 0,
  confidential: 1,
  restricted: 2,
} satisfies Record<CanvasExportDataClassification, number>);

function parseDataClassification(
  value: string,
): CanvasExportDataClassification {
  if (
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
  ) {
    return value;
  }
  return fail(
    "canvas_export.state_conflict",
    "A Canvas Export dependency has an unsupported data classification.",
  );
}

function mostRestrictiveClassification(
  classifications: readonly CanvasExportDataClassification[],
): CanvasExportDataClassification {
  return classifications.reduce<CanvasExportDataClassification>(
    (mostRestrictive, classification) =>
      dataClassificationRank[classification] >
      dataClassificationRank[mostRestrictive]
        ? classification
        : mostRestrictive,
    "internal",
  );
}

async function requireSourceArtifacts(
  connection: PoolConnection,
  workspaceId: string,
  artifactIds: readonly string[],
): Promise<CanvasExportDataClassification> {
  if (artifactIds.length === 0) {
    return "internal";
  }
  const placeholders = artifactIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<SourceArtifactRow[]>(
    `SELECT
       id,
       availability_status AS availabilityStatus,
       data_classification AS dataClassification
     FROM artifact
     WHERE workspace_id = ?
       AND id IN (${placeholders})
     FOR SHARE`,
    [workspaceId, ...artifactIds],
  );
  if (
    rows.length !== artifactIds.length ||
    rows.some((row) => row.availabilityStatus !== "available")
  ) {
    return fail(
      "canvas_export.state_conflict",
      "A source Artifact is no longer available for export.",
    );
  }
  return mostRestrictiveClassification(
    rows.map((row) => parseDataClassification(row.dataClassification)),
  );
}

async function translateAuthorization<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthorizationStoreError) {
      return fail(
        error.code === "authorization.forbidden"
          ? "canvas_export.forbidden"
          : "canvas_export.state_conflict",
        "Workspace authority changed before the Canvas Export completed.",
      );
    }
    throw error;
  }
}

export function createCanvasExportStore(
  pool: Pool,
  options: CreateCanvasExportStoreOptions,
): CanvasExportStore {
  if (!boundedText(options.instanceId, 120)) {
    throw new CanvasExportStoreError(
      "canvas_export.invalid_argument",
      "Canvas Export Store requires a bounded instance identity.",
    );
  }

  return Object.freeze({
    async get(
      authority: TrustedWorkspaceScope,
      exportSessionId: string,
      now: Date,
    ) {
      if (
        authority.trusted !== true ||
        !idPattern.test(exportSessionId) ||
        !validDate(now)
      ) {
        return fail(
          "canvas_export.invalid_argument",
          "Invalid Canvas Export lookup.",
        );
      }
      return translateAuthorization(() =>
        inTransaction(pool, async (connection) => {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            authority,
            "asset.write",
            now,
          );
          const upload = await readUpload(
            connection,
            authority.workspaceId,
            authority.principalId,
            exportSessionId,
            false,
          );
          if (!upload) {
            return fail(
              "canvas_export.not_found",
              "Canvas Export was not found.",
            );
          }
          const result =
            upload.state === "committed"
              ? await readCommitted(connection, upload.workspaceId, upload.id)
              : undefined;
          if (upload.state === "committed" && !result) {
            return fail(
              "canvas_export.state_conflict",
              "Committed Canvas Export facts are incomplete.",
            );
          }
          if (
            upload.state !== "open" &&
            upload.state !== "sealing" &&
            upload.state !== "verifying" &&
            upload.state !== "verified" &&
            upload.state !== "committed"
          ) {
            return fail(
              "canvas_export.state_conflict",
              "Canvas Export is no longer recoverable.",
            );
          }
          const sourceMetadata = result
            ? parseRecord(parseRecord(result.metadata).canvasExport)
            : undefined;
          const sourceRequest = sourceMetadata?.request
            ? parseRecord(sourceMetadata.request)
            : undefined;
          const verifiedSource: CanvasExportSessionRecord["sourceRequest"] =
            sourceRequest &&
            typeof sourceRequest.canvasDraftId === "string" &&
            idPattern.test(sourceRequest.canvasDraftId) &&
            typeof sourceRequest.documentVersion === "number" &&
            Number.isSafeInteger(sourceRequest.documentVersion) &&
            sourceRequest.documentVersion > 0 &&
            typeof sourceRequest.pageId === "string" &&
            typeof sourceRequest.displayFilename === "string" &&
            (sourceRequest.format === "png" ||
              sourceRequest.format === "jpeg" ||
              sourceRequest.format === "webp")
              ? {
                  canvasDraftId: sourceRequest.canvasDraftId,
                  documentVersion: sourceRequest.documentVersion,
                  pageId: sourceRequest.pageId,
                  displayFilename: sourceRequest.displayFilename,
                  format: sourceRequest.format,
                }
              : undefined;
          return Object.freeze({
            ...(verifiedSource ? { sourceRequest: verifiedSource } : {}),
            exportSessionId: upload.id,
            state: upload.state,
            expiresAt: upload.expiresAt,
            ...(upload.expectedSize
              ? { expectedSize: upload.expectedSize }
              : {}),
            replayed: false,
            ...(result ? { result: resultFromRow(result, "replayed") } : {}),
          });
        }),
      );
    },

    async commit(commitOptions: CommitCanvasExportOptions) {
      validateCommit(commitOptions);
      return translateAuthorization(() =>
        inTransaction(pool, async (connection) => {
          const expectedGeneration = await requireActiveRuntime(
            connection,
            options.instanceId,
          );
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            commitOptions.authority,
            "asset.write",
            commitOptions.now,
          );
          const upload = await readUpload(
            connection,
            commitOptions.authority.workspaceId,
            commitOptions.authority.principalId,
            commitOptions.exportSessionId,
            true,
          );
          if (!upload) {
            return fail(
              "canvas_export.not_found",
              "Canvas Export was not found.",
            );
          }
          if (
            upload.allocationRequestHash !== commitOptions.request.requestHash
          ) {
            return fail(
              "canvas_export.idempotency_conflict",
              "Canvas Export allocation is bound to different request facts.",
            );
          }
          if (upload.state === "committed") {
            const existing = await readCommitted(
              connection,
              upload.workspaceId,
              upload.id,
            );
            if (!existing) {
              return fail(
                "canvas_export.state_conflict",
                "Committed Canvas Export facts are incomplete.",
              );
            }
            const metadata = parseRecord(existing.metadata);
            const canvasExport = parseRecord(metadata.canvasExport);
            if (
              canonicalize(canvasExport.request) !==
                canonicalize({
                  canvasDraftId: commitOptions.request.canvasDraftId,
                  documentVersion: commitOptions.request.documentVersion,
                  pageId: commitOptions.request.pageId,
                  format: commitOptions.request.format,
                  width: commitOptions.request.width,
                  height: commitOptions.request.height,
                  transparentBackground:
                    commitOptions.request.transparentBackground,
                  displayFilename: commitOptions.request.displayFilename,
                }) ||
              canonicalize(canvasExport.target) !==
                canonicalize(targetFacts(commitOptions.target))
            ) {
              return fail(
                "canvas_export.idempotency_conflict",
                "Canvas Export was already committed with different facts.",
              );
            }
            return resultFromRow(existing, "replayed");
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
            upload.detectedMediaType !==
              expectedMediaType(commitOptions.request.format) ||
            upload.committedStoredObjectId !== null
          ) {
            return fail(
              "canvas_export.state_conflict",
              "Canvas Export is not eligible for commit.",
            );
          }

          const [draftRows] = await connection.execute<CanvasDraftRow[]>(
            `SELECT
                 document,
                 content_digest AS contentDigest,
                 version
               FROM canvas_draft
               WHERE workspace_id = ?
                 AND id = ?
               LIMIT 1
               FOR SHARE`,
            [upload.workspaceId, commitOptions.request.canvasDraftId],
          );
          const draft = draftRows[0];
          if (!draft) {
            return fail(
              "canvas_export.not_found",
              "Canvas Draft was not found.",
            );
          }
          if (draft.version !== commitOptions.request.documentVersion) {
            return fail(
              "canvas_export.state_conflict",
              "Canvas Draft changed after this export was rendered.",
            );
          }
          const document = parseDocument(draft.document);
          const page = document.pages.find(
            (candidate) => candidate.id === commitOptions.request.pageId,
          );
          if (
            !page ||
            Math.abs(
              page.width * commitOptions.request.height -
                page.height * commitOptions.request.width,
            ) >
              page.width / 2
          ) {
            return fail(
              "canvas_export.state_conflict",
              "Canvas Export page or output ratio does not match the saved Draft.",
            );
          }
          const sourceIds = sourceArtifactIds(page);
          const sourceClassification = await requireSourceArtifacts(
            connection,
            upload.workspaceId,
            sourceIds,
          );

          let assetVersion: number | undefined;
          if (commitOptions.target.kind === "existing_asset") {
            const [assetRows] = await connection.execute<AssetRow[]>(
              `SELECT
                   id,
                   lifecycle_status AS lifecycleStatus,
                   version
                 FROM asset
                 WHERE workspace_id = ?
                   AND id = ?
                 LIMIT 1
                 FOR UPDATE`,
              [upload.workspaceId, commitOptions.target.assetId],
            );
            const asset = assetRows[0];
            if (!asset) {
              return fail(
                "canvas_export.not_found",
                "Target Asset was not found.",
              );
            }
            if (
              asset.lifecycleStatus !== "active" ||
              asset.version !== commitOptions.target.expectedVersion
            ) {
              return fail(
                "canvas_export.state_conflict",
                "Target Asset changed before this export was adopted.",
              );
            }
            assetVersion = asset.version + 1;
          } else if (commitOptions.target.kind === "new_asset") {
            assetVersion = 1;
          }

          const dataClassification = sourceClassification;

          if (commitOptions.target.kind === "new_asset") {
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
                commitOptions.target.assetId,
                upload.workspaceId,
                `canvas.export.${upload.id}`,
                commitOptions.target.name,
                commitOptions.target.assetType,
                commitOptions.authority.principalId,
                commitOptions.now,
                commitOptions.now,
              ],
            );
          }

          const contentDigest = `sha256:${upload.verifiedSha256}`;
          const artifactAssetId =
            commitOptions.target.kind === "artifact_only"
              ? null
              : commitOptions.target.assetId;
          const requestFacts = {
            canvasDraftId: commitOptions.request.canvasDraftId,
            documentVersion: commitOptions.request.documentVersion,
            pageId: commitOptions.request.pageId,
            format: commitOptions.request.format,
            width: commitOptions.request.width,
            height: commitOptions.request.height,
            transparentBackground: commitOptions.request.transparentBackground,
            displayFilename: commitOptions.request.displayFilename,
          };
          const metadata = {
            dataClassification,
            canvasExport: {
              request: requestFacts,
              target: targetFacts(commitOptions.target),
              documentDigest: draft.contentDigest,
              sourcePage: {
                width: page.width,
                height: page.height,
              },
              sourceArtifactCount: sourceIds.length,
              ...(assetVersion ? { assetVersion } : {}),
            },
          };
          const metadataJson = canonicalize(metadata);
          if (Buffer.byteLength(metadataJson, "utf8") > 65_535) {
            return fail(
              "canvas_export.invalid_argument",
              "Canvas Export metadata exceeds the bounded JSON limit.",
            );
          }

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
               ?, ?, ?, NULL, ?, ?, NULL, ?, 'image.canvas_export',
               'available', ?, ?, CAST(? AS JSON), ?
             )`,
            [
              commitOptions.artifactId,
              upload.workspaceId,
              artifactAssetId,
              commitOptions.authority.principalId,
              commitOptions.storedObjectId,
              contentDigest,
              dataClassification,
              commitOptions.request.displayFilename,
              metadataJson,
              commitOptions.now,
            ],
          );

          if (commitOptions.target.kind === "new_asset") {
            const [selected] = await connection.execute<ResultSetHeader>(
              `UPDATE asset
                 SET current_artifact_id = ?,
                     updated_at = ?
                 WHERE workspace_id = ?
                   AND id = ?
                   AND current_artifact_id IS NULL
                   AND version = 1
                   AND lifecycle_status = 'active'`,
              [
                commitOptions.artifactId,
                commitOptions.now,
                upload.workspaceId,
                commitOptions.target.assetId,
              ],
            );
            if (selected.affectedRows !== 1) {
              return fail(
                "canvas_export.state_conflict",
                "New Canvas Export Asset changed before selection.",
              );
            }
          } else if (commitOptions.target.kind === "existing_asset") {
            const [selected] = await connection.execute<ResultSetHeader>(
              `UPDATE asset
                 SET current_artifact_id = ?,
                     version = version + 1,
                     updated_at = ?
                 WHERE workspace_id = ?
                   AND id = ?
                   AND version = ?
                   AND lifecycle_status = 'active'`,
              [
                commitOptions.artifactId,
                commitOptions.now,
                upload.workspaceId,
                commitOptions.target.assetId,
                commitOptions.target.expectedVersion,
              ],
            );
            if (selected.affectedRows !== 1) {
              return fail(
                "canvas_export.state_conflict",
                "Target Asset changed before Artifact selection.",
              );
            }
          }

          for (const sourceArtifactId of sourceIds) {
            await connection.execute<ResultSetHeader>(
              `INSERT INTO artifact_edge (
                 id,
                 workspace_id,
                 source_artifact_id,
                 target_artifact_id,
                 relation,
                 created_by_principal_id,
                 created_at
               ) VALUES (?, ?, ?, ?, 'composed_from', ?, ?)`,
              [
                ulid(),
                upload.workspaceId,
                sourceArtifactId,
                commitOptions.artifactId,
                commitOptions.authority.principalId,
                commitOptions.now,
              ],
            );
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
                 AND purpose = 'canvas_export'
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
              "canvas_export.state_conflict",
              "Canvas Export changed before its commit transaction.",
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
               ?, ?, 'artifact.canvas_exported', 1, 'artifact', ?, 1, ?,
               'pending', ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?
             )`,
            [
              commitOptions.outboxEventId,
              upload.workspaceId,
              commitOptions.artifactId,
              canonicalize({
                artifactId: commitOptions.artifactId,
                ...(artifactAssetId ? { assetId: artifactAssetId } : {}),
                storedObjectId: commitOptions.storedObjectId,
                uploadSessionId: upload.id,
                canvasDraftId: commitOptions.request.canvasDraftId,
                documentVersion: commitOptions.request.documentVersion,
                pageId: commitOptions.request.pageId,
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
            authenticationRefType:
              commitOptions.authority.authenticationRefType,
            authenticationRefHash: commitOptions.audit.authenticationRefHash,
            authorityType: commitOptions.authority.authorityType,
            authorityId: commitOptions.authority.authorityId,
            authorityVersion: commitOptions.authority.authorityVersion,
            authorizationModelVersion,
            authorizationDecision: {
              permission: "asset.write",
              authorityVersion: commitOptions.authority.authorityVersion,
            },
            eventType: "artifact.canvas_exported",
            action: "artifact.export",
            resourceType: "artifact",
            resourceId: commitOptions.artifactId,
            outcome: "succeeded",
            decisionReasonCode: "authorized",
            severity: dataClassification === "restricted" ? "high" : "info",
            requestId: commitOptions.audit.requestId ?? null,
            traceId: commitOptions.audit.traceId ?? null,
            details: {
              sourceUploadId: upload.id,
              canvasDraftId: commitOptions.request.canvasDraftId,
              documentVersion: commitOptions.request.documentVersion,
              pageId: commitOptions.request.pageId,
              format: commitOptions.request.format,
              width: commitOptions.request.width,
              height: commitOptions.request.height,
              contentDigest,
              ...(artifactAssetId ? { assetId: artifactAssetId } : {}),
              ...(assetVersion ? { assetVersion } : {}),
            },
            occurredAt: commitOptions.now,
            recordedAt: commitOptions.now,
          });

          return Object.freeze({
            status: "committed" as const,
            exportSessionId: upload.id,
            storedObjectId: commitOptions.storedObjectId,
            artifactId: commitOptions.artifactId,
            ...(artifactAssetId ? { assetId: artifactAssetId } : {}),
            ...(assetVersion ? { assetVersion } : {}),
            contentDigest,
            mediaType: upload.detectedMediaType,
            byteSize: upload.verifiedSize,
            committedAt: commitOptions.now,
          });
        }),
      );
    },
  });
}
