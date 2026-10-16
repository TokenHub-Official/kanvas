import { recordAgentLibraryToolInputsInTransaction } from "./agent-library-store.js";
import { createHash } from "node:crypto";

import type {
  TrustedWorkspaceScope,
  WorkspacePermissionId,
} from "@kanvas/application";
import type { CanvasBrandContext } from "@kanvas/contracts/api";
import type {
  EditorDocumentV1,
  EditorDraftContentV1,
  EditorNodeV1,
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

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumDocumentBytes = 4 * 1024 * 1024;
const maximumRetainedRevisions = 30;

export interface CanvasDraftAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface CanvasDraftRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly brand?: CanvasBrandContext;
  readonly document: EditorDocumentV1;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CanvasDraftMutationResult {
  readonly draft: CanvasDraftRecord;
  readonly replayed: boolean;
}

export interface CanvasDraftMutationRecovery {
  readonly kind: "create" | "update";
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly revision: CanvasDraftRevisionRecord;
}

export interface CanvasDraftSummaryRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly brand?: CanvasBrandContext;
  readonly title: string;
  readonly pageCount: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CanvasDraftListResult {
  readonly items: readonly CanvasDraftSummaryRecord[];
  readonly truncated: boolean;
}

export type CanvasDraftRevisionKind = "brand_update" | "restore" | "save";

export interface CanvasDraftRevisionSummary {
  readonly version: number;
  readonly title: string;
  readonly contentDigest: string;
  readonly kind: CanvasDraftRevisionKind;
  readonly restoredFromVersion?: number;
  readonly brand?: CanvasBrandContext;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
}

export interface CanvasDraftRevisionRecord extends CanvasDraftRevisionSummary {
  readonly canvasDraftId: string;
  readonly workspaceId: string;
  readonly document: EditorDocumentV1;
}

export interface ListCanvasDraftRevisionsOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly canvasDraftId: string;
  readonly beforeVersion?: number;
  readonly limit: number;
}

export interface ListCanvasDraftsOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly limit: number;
}

export interface CreateCanvasDraftOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly canvasDraftId: string;
  readonly idempotencyKey: string;
  readonly document: EditorDraftContentV1;
  readonly brandKitRevisionId?: string | null;
  readonly now: Date;
  readonly audit: CanvasDraftAuditContext;
}

export interface UpdateCanvasDraftOptions {
  readonly libraryInput?: {
    readonly actionReceiptId: string;
    readonly artifactId: string;
    readonly libraryId: string;
    readonly entryId: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly canvasDraftId: string;
  readonly expectedVersion: number;
  readonly document: EditorDraftContentV1;
  readonly now: Date;
  readonly audit: CanvasDraftAuditContext;
}

export interface UpdateCanvasDraftBrandOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly canvasDraftId: string;
  readonly expectedVersion: number;
  readonly brandKitRevisionId: string;
  readonly now: Date;
  readonly audit: CanvasDraftAuditContext;
}

export interface RestoreCanvasDraftOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly canvasDraftId: string;
  readonly expectedVersion: number;
  readonly sourceVersion: number;
  readonly now: Date;
  readonly audit: CanvasDraftAuditContext;
}

export interface CanvasDraftStore {
  list(options: ListCanvasDraftsOptions): Promise<CanvasDraftListResult>;
  get(
    authority: TrustedWorkspaceScope,
    canvasDraftId: string,
  ): Promise<CanvasDraftRecord | undefined>;
  create(options: CreateCanvasDraftOptions): Promise<CanvasDraftMutationResult>;
  getRevision(
    authority: TrustedWorkspaceScope,
    canvasDraftId: string,
    version: number,
  ): Promise<CanvasDraftRevisionRecord | undefined>;
  recoverMutation(
    authority: TrustedWorkspaceScope,
    auditEventId: string,
  ): Promise<CanvasDraftMutationRecovery | undefined>;
  listRevisions(
    options: ListCanvasDraftRevisionsOptions,
  ): Promise<readonly CanvasDraftRevisionSummary[]>;
  restore(
    options: RestoreCanvasDraftOptions,
  ): Promise<CanvasDraftMutationResult>;
  update(options: UpdateCanvasDraftOptions): Promise<CanvasDraftMutationResult>;
  updateBrand(
    options: UpdateCanvasDraftBrandOptions,
  ): Promise<CanvasDraftMutationResult>;
}

export type CanvasDraftStoreErrorCode =
  | "canvas_draft.invalid_argument"
  | "canvas_draft.forbidden"
  | "canvas_draft.not_found"
  | "canvas_draft.concurrent_change"
  | "canvas_draft.idempotency_conflict";

export class CanvasDraftStoreError extends Error {
  public constructor(
    public readonly code: CanvasDraftStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanvasDraftStoreError";
  }
}

interface CanvasDraftRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly document: EditorDraftContentV1 | string;
  readonly contentDigest: string;
  readonly createRequestHash: string;
  readonly version: number | string;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CanvasDraftRevisionRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly canvasDraftId: string;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly version: number | string;
  readonly document: EditorDraftContentV1 | string;
  readonly contentDigest: string;
  readonly revisionKind: string;
  readonly restoredFromVersion: number | string | null;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
}

interface CanvasDraftSummaryRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly title: string;
  readonly pageCount: number | string;
  readonly version: number | string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface BrandRevisionRow extends RowDataPacket {
  readonly brandKitRevisionId: string;
  readonly brandKitId: string;
  readonly brandName: string;
  readonly brandRevisionNumber: number | string;
}

interface CanvasDraftMutationAuditRow extends RowDataPacket {
  readonly action: "canvas_draft.create" | "canvas_draft.update";
  readonly resourceId: string;
  readonly version: number | string;
}

type RevalidateAuthority = (
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
  now: Date,
) => Promise<void>;

type AppendAudit = (
  connection: PoolConnection,
  input: {
    readonly authority: TrustedWorkspaceScope;
    readonly audit: CanvasDraftAuditContext;
    readonly action:
      | "canvas_draft.brand_update"
      | "canvas_draft.create"
      | "canvas_draft.restore"
      | "canvas_draft.update";
    readonly eventType:
      | "canvas_draft.brand_updated"
      | "canvas_draft.created"
      | "canvas_draft.restored"
      | "canvas_draft.updated";
    readonly resourceId: string;
    readonly version: number;
    readonly contentDigest: string;
    readonly restoredFromVersion?: number;
    readonly brandKitRevisionId?: string;
    readonly previousBrandKitRevisionId?: string;
    readonly occurredAt: Date;
  },
) => Promise<void>;

export interface CreateCanvasDraftStoreOptions {
  readonly revalidateAuthority?: RevalidateAuthority;
  readonly appendAudit?: AppendAudit;
}

function fail(code: CanvasDraftStoreErrorCode, message: string): never {
  throw new CanvasDraftStoreError(code, message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    fail(
      "canvas_draft.invalid_argument",
      `${label} must be a canonical uppercase ULID.`,
    );
  }
}

function assertAuthority(
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
): void {
  if (
    authority.trusted !== true ||
    !idPattern.test(authority.workspaceId) ||
    !idPattern.test(authority.organizationId) ||
    !idPattern.test(authority.principalId) ||
    !authority.effectivePermissions.includes(permission)
  ) {
    fail(
      "canvas_draft.forbidden",
      "Workspace authority cannot access this Canvas Draft.",
    );
  }
}

function assertAudit(audit: CanvasDraftAuditContext): void {
  assertId(audit.auditEventId, "audit.auditEventId");
  if (!digestPattern.test(audit.authenticationRefHash)) {
    fail(
      "canvas_draft.invalid_argument",
      "audit.authenticationRefHash must be a canonical SHA-256 digest.",
    );
  }
}

function assertVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "canvas_draft.invalid_argument",
      `${label} must be a positive safe integer.`,
    );
  }
}

function serializeDocument(document: EditorDraftContentV1): string {
  if (
    document.schemaVersion !== "kanvas.editor-document/v1" ||
    typeof document.title !== "string" ||
    document.title.length < 1 ||
    document.title.length > 240 ||
    document.pages.length < 1
  ) {
    fail("canvas_draft.invalid_argument", "Canvas Draft document is invalid.");
  }
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, "utf8") > maximumDocumentBytes) {
    fail(
      "canvas_draft.invalid_argument",
      "Canvas Draft document exceeds the current persistence limit.",
    );
  }
  return serialized;
}

function digest(namespace: string, ...parts: readonly string[]): string {
  const hash = createHash("sha256").update(namespace).update("\0");
  for (const part of parts) {
    hash.update(part).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function digestCanvasDraftContent(
  document: EditorDraftContentV1,
): string {
  return digest("kanvas:canvas-draft-content:v1", serializeDocument(document));
}

export function digestCanvasDraftCreateRequest(
  document: EditorDraftContentV1,
  requestedBrandKitRevisionId: string | null | undefined,
): string {
  return digest(
    "kanvas:canvas-draft-create-payload:v1",
    digestCanvasDraftContent(document),
    requestedBrandKitRevisionId === null
      ? "without-brand"
      : (requestedBrandKitRevisionId ?? "workspace-default"),
  );
}

function digestCreateRequestKey(
  workspaceId: string,
  idempotencyKey: string,
): string {
  if (idempotencyKey.length < 1 || idempotencyKey.length > 160) {
    fail(
      "canvas_draft.invalid_argument",
      "idempotencyKey must contain between 1 and 160 characters.",
    );
  }
  return digest(
    "kanvas:canvas-draft-create-request:v1",
    workspaceId,
    idempotencyKey,
  );
}

function parseDocument(
  value: EditorDraftContentV1 | string,
): EditorDraftContentV1 {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as EditorDraftContentV1)
      : value;
  serializeDocument(parsed);
  return parsed;
}

function draftContentFromDocument(
  document: EditorDocumentV1,
): EditorDraftContentV1 {
  return {
    schemaVersion: document.schemaVersion,
    title: document.title,
    pages: document.pages,
    metadata: document.metadata,
  };
}

function mapBrandContext(row: {
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
}): CanvasBrandContext | undefined {
  if (
    row.brandKitRevisionId == null &&
    row.brandKitId == null &&
    row.brandName == null &&
    row.brandRevisionNumber == null
  ) {
    return undefined;
  }
  const revisionNumber = Number(row.brandRevisionNumber);
  if (
    !row.brandKitRevisionId ||
    !row.brandKitId ||
    !row.brandName ||
    !Number.isSafeInteger(revisionNumber) ||
    revisionNumber < 1
  ) {
    fail(
      "canvas_draft.concurrent_change",
      "Canvas Draft Brand Revision facts are invalid.",
    );
  }
  return Object.freeze({
    brandKitId: row.brandKitId,
    brandKitRevisionId: row.brandKitRevisionId,
    name: row.brandName,
    revisionNumber,
  });
}

function mapRow(row: CanvasDraftRow): CanvasDraftRecord {
  const document = parseDocument(row.document);
  const brand = mapBrandContext(row);
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    ...(brand ? { brand } : {}),
    document: Object.freeze({
      documentId: row.id,
      workspaceId: row.workspaceId,
      ...document,
    }),
    version: Number(row.version),
    createdByPrincipalId: row.createdByPrincipalId,
    updatedByPrincipalId: row.updatedByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapRevisionRow(
  row: CanvasDraftRevisionRow,
): CanvasDraftRevisionRecord {
  const version = Number(row.version);
  const restoredFromVersion =
    row.restoredFromVersion === null
      ? undefined
      : Number(row.restoredFromVersion);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (row.revisionKind !== "save" &&
      row.revisionKind !== "restore" &&
      row.revisionKind !== "brand_update") ||
    ((row.revisionKind === "save" || row.revisionKind === "brand_update") &&
      restoredFromVersion !== undefined) ||
    (row.revisionKind === "restore" &&
      (restoredFromVersion === undefined ||
        !Number.isSafeInteger(restoredFromVersion) ||
        restoredFromVersion < 1 ||
        restoredFromVersion >= version)) ||
    !digestPattern.test(row.contentDigest)
  ) {
    fail(
      "canvas_draft.concurrent_change",
      "Canvas Draft revision facts are invalid.",
    );
  }
  const document = parseDocument(row.document);
  const brand = mapBrandContext(row);
  // MySQL normalizes JSON object key order when CAST stores the
  // document. The digest intentionally remains the write-time
  // fingerprint used by Canvas Draft concurrency and cannot be
  // recomputed from the normalized read representation.
  return Object.freeze({
    workspaceId: row.workspaceId,
    canvasDraftId: row.canvasDraftId,
    version,
    title: document.title,
    document: Object.freeze({
      documentId: row.canvasDraftId,
      workspaceId: row.workspaceId,
      ...document,
    }),
    contentDigest: row.contentDigest,
    kind: row.revisionKind,
    ...(restoredFromVersion !== undefined ? { restoredFromVersion } : {}),
    ...(brand ? { brand } : {}),
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
  });
}

function revisionSummary(
  record: CanvasDraftRevisionRecord,
): CanvasDraftRevisionSummary {
  return Object.freeze({
    version: record.version,
    title: record.title,
    contentDigest: record.contentDigest,
    kind: record.kind,
    ...(record.restoredFromVersion !== undefined
      ? { restoredFromVersion: record.restoredFromVersion }
      : {}),
    ...(record.brand ? { brand: record.brand } : {}),
    createdByPrincipalId: record.createdByPrincipalId,
    createdAt: record.createdAt,
  });
}

export interface CanvasDraftArtifactReference {
  readonly artifactId: string;
  readonly role:
    | "editor.frame.content"
    | "editor.graphic.source"
    | "editor.grid.content"
    | "editor.image.source"
    | "editor.page.background";
}

function addArtifactReference(
  references: Map<string, CanvasDraftArtifactReference>,
  artifactId: string,
  role: CanvasDraftArtifactReference["role"],
): void {
  assertId(artifactId, `${role} artifactId`);
  const reference = {
    artifactId,
    role,
  };
  references.set(`${reference.role}:${reference.artifactId}`, reference);
}

function collectV1NodeArtifactReferences(
  references: Map<string, CanvasDraftArtifactReference>,
  node: EditorNodeV1,
): void {
  if (node.kind === "image") {
    addArtifactReference(
      references,
      node.image.source.artifactId,
      "editor.image.source",
    );
    return;
  }
  if (node.kind === "graphic" && node.source.kind === "artifact") {
    addArtifactReference(
      references,
      node.source.artifactId,
      "editor.graphic.source",
    );
    return;
  }
  if (node.kind === "frame" && node.content) {
    addArtifactReference(
      references,
      node.content.image.source.artifactId,
      "editor.frame.content",
    );
    return;
  }
  if (node.kind === "grid") {
    for (const cell of node.cells) {
      if (cell.content) {
        addArtifactReference(
          references,
          cell.content.image.source.artifactId,
          "editor.grid.content",
        );
      }
    }
    return;
  }
  if (node.kind === "group") {
    for (const child of node.children) {
      collectV1NodeArtifactReferences(references, child);
    }
  }
}

export function canvasDraftArtifactReferences(
  document: EditorDraftContentV1,
): readonly CanvasDraftArtifactReference[] {
  const references = new Map<string, CanvasDraftArtifactReference>();
  for (const page of document.pages) {
    if (page.background.kind === "image") {
      addArtifactReference(
        references,
        page.background.image.source.artifactId,
        "editor.page.background",
      );
    }
    for (const node of page.nodes) {
      collectV1NodeArtifactReferences(references, node);
    }
  }
  return [...references.values()];
}

async function retainReferencedArtifacts(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  canvasDraftId: string,
  document: EditorDraftContentV1,
  now: Date,
): Promise<void> {
  for (const reference of canvasDraftArtifactReferences(document)) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO canvas_draft_artifact_reference (
         id,
         workspace_id,
         canvas_draft_id,
         artifact_id,
         reference_role,
         created_by_principal_id,
         created_at
       )
       SELECT
         ?, ?, ?, ?, ?, ?, ?
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1
         FROM canvas_draft_artifact_reference
         WHERE workspace_id = ?
           AND canvas_draft_id = ?
           AND artifact_id = ?
           AND reference_role = ?
       )`,
      [
        ulid(),
        authority.workspaceId,
        canvasDraftId,
        reference.artifactId,
        reference.role,
        authority.principalId,
        now,
        authority.workspaceId,
        canvasDraftId,
        reference.artifactId,
        reference.role,
      ],
    );
  }
}

async function selectById(
  connection: Pick<PoolConnection, "execute">,
  workspaceId: string,
  canvasDraftId: string,
  lock: boolean,
): Promise<CanvasDraftRow | undefined> {
  const [rows] = await connection.execute<CanvasDraftRow[]>(
    `SELECT
       draft.id,
       draft.workspace_id AS workspaceId,
       draft.brand_kit_revision_id AS brandKitRevisionId,
       brand_revision.brand_kit_id AS brandKitId,
       JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
       brand_revision.revision_number AS brandRevisionNumber,
       draft.document,
       draft.content_digest AS contentDigest,
       draft.create_request_hash AS createRequestHash,
       draft.version,
       draft.created_by_principal_id AS createdByPrincipalId,
       draft.updated_by_principal_id AS updatedByPrincipalId,
       draft.created_at AS createdAt,
       draft.updated_at AS updatedAt
     FROM canvas_draft AS draft
     LEFT JOIN brand_kit_revision AS brand_revision
       ON brand_revision.workspace_id = draft.workspace_id
       AND brand_revision.id = draft.brand_kit_revision_id
     WHERE draft.workspace_id = ?
       AND draft.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, canvasDraftId],
  );
  return rows[0];
}

async function selectRevision(
  connection: Pick<PoolConnection, "execute">,
  workspaceId: string,
  canvasDraftId: string,
  version: number,
  lock: boolean,
): Promise<CanvasDraftRevisionRow | undefined> {
  const [rows] = await connection.execute<CanvasDraftRevisionRow[]>(
    `SELECT
         history.workspace_id AS workspaceId,
         history.canvas_draft_id AS canvasDraftId,
         history.brand_kit_revision_id AS brandKitRevisionId,
         brand_revision.brand_kit_id AS brandKitId,
         JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
         brand_revision.revision_number AS brandRevisionNumber,
         history.version,
         history.document,
         history.content_digest AS contentDigest,
         history.revision_kind AS revisionKind,
         history.restored_from_version AS restoredFromVersion,
         history.created_by_principal_id AS createdByPrincipalId,
         history.created_at AS createdAt
       FROM canvas_draft_revision AS history
       LEFT JOIN brand_kit_revision AS brand_revision
         ON brand_revision.workspace_id = history.workspace_id
         AND brand_revision.id = history.brand_kit_revision_id
       WHERE history.workspace_id = ?
         AND history.canvas_draft_id = ?
         AND history.version = ?
       LIMIT 1${lock ? " FOR SHARE" : ""}`,
    [workspaceId, canvasDraftId, version],
  );
  return rows[0];
}

async function insertRevision(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  canvasDraftId: string,
  version: number,
  document: EditorDraftContentV1,
  contentDigest: string,
  brandKitRevisionId: string | undefined,
  kind: CanvasDraftRevisionKind,
  restoredFromVersion: number | undefined,
  now: Date,
): Promise<void> {
  const documentJson = serializeDocument(document);
  await connection.execute<ResultSetHeader>(
    `INSERT INTO canvas_draft_revision (
       workspace_id,
       canvas_draft_id,
       version,
       brand_kit_revision_id,
       title,
       schema_version,
       document,
       content_digest,
       revision_kind,
       restored_from_version,
       created_by_principal_id,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
    [
      authority.workspaceId,
      canvasDraftId,
      version,
      brandKitRevisionId ?? null,
      document.title,
      document.schemaVersion,
      documentJson,
      contentDigest,
      kind,
      restoredFromVersion ?? null,
      authority.principalId,
      now,
    ],
  );
  const oldestRetainedVersion = version - maximumRetainedRevisions + 1;
  if (oldestRetainedVersion > 1) {
    await connection.execute<ResultSetHeader>(
      `DELETE FROM canvas_draft_revision
       WHERE workspace_id = ?
         AND canvas_draft_id = ?
         AND version < ?`,
      [authority.workspaceId, canvasDraftId, oldestRetainedVersion],
    );
  }
}

async function selectByCreateRequest(
  connection: Pick<PoolConnection, "execute">,
  workspaceId: string,
  requestKey: string,
): Promise<CanvasDraftRow | undefined> {
  const [rows] = await connection.execute<CanvasDraftRow[]>(
    `SELECT
       draft.id,
       draft.workspace_id AS workspaceId,
       draft.brand_kit_revision_id AS brandKitRevisionId,
       brand_revision.brand_kit_id AS brandKitId,
       JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
       brand_revision.revision_number AS brandRevisionNumber,
       draft.document,
       draft.content_digest AS contentDigest,
       draft.create_request_hash AS createRequestHash,
       draft.version,
       draft.created_by_principal_id AS createdByPrincipalId,
       draft.updated_by_principal_id AS updatedByPrincipalId,
       draft.created_at AS createdAt,
       draft.updated_at AS updatedAt
     FROM canvas_draft AS draft
     LEFT JOIN brand_kit_revision AS brand_revision
       ON brand_revision.workspace_id = draft.workspace_id
       AND brand_revision.id = draft.brand_kit_revision_id
     WHERE draft.workspace_id = ?
       AND draft.create_request_key = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, requestKey],
  );
  return rows[0];
}

async function resolveBrandRevision(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  requestedBrandKitRevisionId: string | null | undefined,
  now: Date,
  revalidateAuthority: RevalidateAuthority,
): Promise<CanvasBrandContext | undefined> {
  if (requestedBrandKitRevisionId === null) {
    return undefined;
  }
  if (!authority.effectivePermissions.includes("brand.read")) {
    if (requestedBrandKitRevisionId !== undefined) {
      fail(
        "canvas_draft.forbidden",
        "Workspace authority cannot use the selected brand.",
      );
    }
    return undefined;
  }
  await revalidateAuthority(connection, authority, "brand.read", now);
  const parameters = [authority.workspaceId];
  const selection = requestedBrandKitRevisionId
    ? "AND revision.id = ?"
    : `AND kit.default_marker = TRUE
       AND revision.id = kit.latest_published_revision_id`;
  if (requestedBrandKitRevisionId) {
    parameters.push(requestedBrandKitRevisionId);
  }
  const [rows] = await connection.execute<BrandRevisionRow[]>(
    `SELECT
       revision.id AS brandKitRevisionId,
       revision.brand_kit_id AS brandKitId,
       JSON_UNQUOTE(JSON_EXTRACT(revision.content_document, '$.name')) AS brandName,
       revision.revision_number AS brandRevisionNumber
     FROM brand_kit AS kit
     INNER JOIN brand_kit_revision AS revision
       ON revision.workspace_id = kit.workspace_id
       AND revision.brand_kit_id = kit.id
     WHERE kit.workspace_id = ?
       AND kit.lifecycle_status = 'active'
       ${selection}
     LIMIT 1
     FOR SHARE`,
    parameters,
  );
  const row = rows[0];
  if (!row) {
    if (requestedBrandKitRevisionId) {
      fail(
        "canvas_draft.not_found",
        "Selected Brand Revision is unavailable in this Workspace.",
      );
    }
    return undefined;
  }
  return mapBrandContext({
    brandKitRevisionId: row.brandKitRevisionId,
    brandKitId: row.brandKitId,
    brandName: row.brandName,
    brandRevisionNumber: row.brandRevisionNumber,
  });
}

const defaultRevalidateAuthority: RevalidateAuthority = async (
  connection,
  authority,
  permission,
  now,
) => {
  try {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      authority,
      permission,
      now,
    );
  } catch (error) {
    if (error instanceof AuthorizationStoreError) {
      fail(
        "canvas_draft.forbidden",
        "Workspace authority is stale or no longer authorized.",
      );
    }
    throw error;
  }
};

const defaultAppendAudit: AppendAudit = async (connection, input) => {
  const { authority, audit } = input;
  await appendAuditEventInTransaction(connection, {
    id: audit.auditEventId,
    schemaVersion: auditEventSchemaVersion,
    organizationId: authority.organizationId,
    workspaceId: authority.workspaceId,
    actorPrincipalId: authority.principalId,
    actorType: authority.principalType,
    authenticationRefType: authority.authenticationRefType,
    authenticationRefHash: audit.authenticationRefHash,
    authorityType: authority.authorityType,
    authorityId: authority.authorityId,
    authorityVersion: authority.authorityVersion,
    authorizationModelVersion: authority.authorizationModelVersion,
    authorizationDecision: Object.freeze({
      action: input.action,
      authorityId: authority.authorityId,
      authorityType: authority.authorityType,
      authorityVersion: authority.authorityVersion,
      modelVersion: authority.authorizationModelVersion,
      outcome: "succeeded",
      reasonCode: input.eventType,
    }),
    eventType: input.eventType,
    action: input.action,
    resourceType: "canvas_draft",
    resourceId: input.resourceId,
    outcome: "succeeded",
    decisionReasonCode: input.eventType,
    severity: "info",
    requestId: audit.requestId ?? null,
    traceId: audit.traceId ?? null,
    details: {
      version: input.version,
      contentDigest: input.contentDigest,
      ...(input.restoredFromVersion !== undefined
        ? { restoredFromVersion: input.restoredFromVersion }
        : {}),
      ...(input.brandKitRevisionId
        ? { brandKitRevisionId: input.brandKitRevisionId }
        : {}),
      ...(input.previousBrandKitRevisionId
        ? { previousBrandKitRevisionId: input.previousBrandKitRevisionId }
        : {}),
    },
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
  });
};

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

export function createCanvasDraftStore(
  pool: Pool,
  options: CreateCanvasDraftStoreOptions = {},
): CanvasDraftStore {
  const revalidateAuthority =
    options.revalidateAuthority ?? defaultRevalidateAuthority;
  const appendAudit = options.appendAudit ?? defaultAppendAudit;

  return Object.freeze({
    async list(input: ListCanvasDraftsOptions): Promise<CanvasDraftListResult> {
      assertAuthority(input.authority, "canvas.read");
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 50
      ) {
        fail(
          "canvas_draft.invalid_argument",
          "limit must be between 1 and 50.",
        );
      }
      const [rows] = await pool.execute<CanvasDraftSummaryRow[]>(
        `SELECT
             draft.id,
             draft.workspace_id AS workspaceId,
             draft.brand_kit_revision_id AS brandKitRevisionId,
             brand_revision.brand_kit_id AS brandKitId,
             JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
             brand_revision.revision_number AS brandRevisionNumber,
             draft.title,
             JSON_LENGTH(draft.document, '$.pages') AS pageCount,
             draft.version,
             draft.created_at AS createdAt,
             draft.updated_at AS updatedAt
           FROM canvas_draft AS draft
           LEFT JOIN brand_kit_revision AS brand_revision
             ON brand_revision.workspace_id = draft.workspace_id
             AND brand_revision.id = draft.brand_kit_revision_id
           WHERE draft.workspace_id = ?
           ORDER BY draft.updated_at DESC, draft.id DESC
           LIMIT ${String(input.limit + 1)}`,
        [input.authority.workspaceId],
      );
      const truncated = rows.length > input.limit;
      return Object.freeze({
        items: Object.freeze(
          rows.slice(0, input.limit).map((row) => {
            const brand = mapBrandContext(row);
            return Object.freeze({
              id: row.id,
              workspaceId: row.workspaceId,
              ...(brand ? { brand } : {}),
              title: row.title,
              pageCount: Number(row.pageCount),
              version: Number(row.version),
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
          }),
        ),
        truncated,
      });
    },

    async get(
      authority: TrustedWorkspaceScope,
      canvasDraftId: string,
    ): Promise<CanvasDraftRecord | undefined> {
      assertAuthority(authority, "canvas.read");
      assertId(canvasDraftId, "canvasDraftId");
      const row = await selectById(
        pool,
        authority.workspaceId,
        canvasDraftId,
        false,
      );
      return row ? mapRow(row) : undefined;
    },

    async getRevision(
      authority: TrustedWorkspaceScope,
      canvasDraftId: string,
      version: number,
    ): Promise<CanvasDraftRevisionRecord | undefined> {
      assertAuthority(authority, "canvas.read");
      assertId(canvasDraftId, "canvasDraftId");
      assertVersion(version, "version");
      const row = await selectRevision(
        pool,
        authority.workspaceId,
        canvasDraftId,
        version,
        false,
      );
      return row ? mapRevisionRow(row) : undefined;
    },

    async recoverMutation(
      authority: TrustedWorkspaceScope,
      auditEventId: string,
    ): Promise<CanvasDraftMutationRecovery | undefined> {
      assertAuthority(authority, "canvas.read");
      assertId(auditEventId, "auditEventId");
      const [rows] = await pool.execute<CanvasDraftMutationAuditRow[]>(
        `SELECT
           action,
           resource_id AS resourceId,
           JSON_UNQUOTE(JSON_EXTRACT(details, '$.version')) AS version
         FROM audit_event
         WHERE workspace_id = ?
           AND id = ?
           AND actor_principal_id = ?
           AND resource_type = 'canvas_draft'
           AND outcome = 'succeeded'
           AND action IN ('canvas_draft.create', 'canvas_draft.update')
         LIMIT 1`,
        [authority.workspaceId, auditEventId, authority.principalId],
      );
      const row = rows[0];
      if (!row) return undefined;
      const version = Number(row.version);
      if (
        !idPattern.test(row.resourceId) ||
        !Number.isSafeInteger(version) ||
        version < 1
      ) {
        fail(
          "canvas_draft.concurrent_change",
          "Canvas Draft recovery facts are invalid.",
        );
      }
      const revision = await selectRevision(
        pool,
        authority.workspaceId,
        row.resourceId,
        version,
        false,
      );
      if (!revision) {
        fail(
          "canvas_draft.concurrent_change",
          "Canvas Draft recovery revision is unavailable.",
        );
      }
      return Object.freeze({
        kind: row.action === "canvas_draft.create" ? "create" : "update",
        beforeVersion: row.action === "canvas_draft.create" ? 0 : version - 1,
        afterVersion: version,
        revision: mapRevisionRow(revision),
      });
    },

    async listRevisions(
      input: ListCanvasDraftRevisionsOptions,
    ): Promise<readonly CanvasDraftRevisionSummary[]> {
      assertAuthority(input.authority, "canvas.read");
      assertId(input.canvasDraftId, "canvasDraftId");
      if (input.beforeVersion !== undefined) {
        assertVersion(input.beforeVersion, "beforeVersion");
      }
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > maximumRetainedRevisions
      ) {
        fail(
          "canvas_draft.invalid_argument",
          `limit must be between 1 and ${String(maximumRetainedRevisions)}.`,
        );
      }
      const parameters: Array<number | string> = [
        input.authority.workspaceId,
        input.canvasDraftId,
      ];
      const before =
        input.beforeVersion === undefined ? "" : " AND history.version < ?";
      if (input.beforeVersion !== undefined) {
        parameters.push(input.beforeVersion);
      }
      const [rows] = await pool.execute<CanvasDraftRevisionRow[]>(
        `SELECT
             history.workspace_id AS workspaceId,
             history.canvas_draft_id AS canvasDraftId,
             history.brand_kit_revision_id AS brandKitRevisionId,
             brand_revision.brand_kit_id AS brandKitId,
             JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
             brand_revision.revision_number AS brandRevisionNumber,
             history.version,
             history.document,
             history.content_digest AS contentDigest,
             history.revision_kind AS revisionKind,
             history.restored_from_version AS restoredFromVersion,
             history.created_by_principal_id AS createdByPrincipalId,
             history.created_at AS createdAt
           FROM canvas_draft_revision AS history
           LEFT JOIN brand_kit_revision AS brand_revision
             ON brand_revision.workspace_id = history.workspace_id
             AND brand_revision.id = history.brand_kit_revision_id
           WHERE history.workspace_id = ?
             AND history.canvas_draft_id = ?${before}
           ORDER BY history.version DESC
           LIMIT ${String(input.limit)}`,
        parameters,
      );
      return Object.freeze(
        rows.map((row) => revisionSummary(mapRevisionRow(row))),
      );
    },

    async create(
      input: CreateCanvasDraftOptions,
    ): Promise<CanvasDraftMutationResult> {
      assertAuthority(input.authority, "canvas.write");
      assertId(input.canvasDraftId, "canvasDraftId");
      if (typeof input.brandKitRevisionId === "string") {
        assertId(input.brandKitRevisionId, "brandKitRevisionId");
        assertAuthority(input.authority, "brand.read");
      }
      assertAudit(input.audit);
      const documentJson = serializeDocument(input.document);
      const contentDigest = digestCanvasDraftContent(input.document);
      const requestHash = digestCanvasDraftCreateRequest(
        input.document,
        input.brandKitRevisionId,
      );
      const requestKey = digestCreateRequestKey(
        input.authority.workspaceId,
        input.idempotencyKey,
      );

      return inTransaction(pool, async (connection) => {
        await revalidateAuthority(
          connection,
          input.authority,
          "canvas.write",
          input.now,
        );
        const existing = await selectByCreateRequest(
          connection,
          input.authority.workspaceId,
          requestKey,
        );
        if (existing) {
          if (existing.createRequestHash !== requestHash) {
            fail(
              "canvas_draft.idempotency_conflict",
              "The Canvas Draft create key was already used for different content.",
            );
          }
          return Object.freeze({
            draft: mapRow(existing),
            replayed: true,
          });
        }

        const brand = await resolveBrandRevision(
          connection,
          input.authority,
          input.brandKitRevisionId,
          input.now,
          revalidateAuthority,
        );

        await connection.execute<ResultSetHeader>(
          `INSERT INTO canvas_draft (
             id,
             workspace_id,
             brand_kit_revision_id,
             title,
             schema_version,
             document,
             content_digest,
             create_request_key,
             create_request_hash,
             version,
             created_by_principal_id,
             updated_by_principal_id,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            input.canvasDraftId,
            input.authority.workspaceId,
            brand?.brandKitRevisionId ?? null,
            input.document.title,
            input.document.schemaVersion,
            documentJson,
            contentDigest,
            requestKey,
            requestHash,
            input.authority.principalId,
            input.authority.principalId,
            input.now,
            input.now,
          ],
        );
        await retainReferencedArtifacts(
          connection,
          input.authority,
          input.canvasDraftId,
          input.document,
          input.now,
        );
        await insertRevision(
          connection,
          input.authority,
          input.canvasDraftId,
          1,
          input.document,
          contentDigest,
          brand?.brandKitRevisionId,
          "save",
          undefined,
          input.now,
        );
        await appendAudit(connection, {
          authority: input.authority,
          audit: input.audit,
          action: "canvas_draft.create",
          eventType: "canvas_draft.created",
          resourceId: input.canvasDraftId,
          version: 1,
          contentDigest,
          ...(brand ? { brandKitRevisionId: brand.brandKitRevisionId } : {}),
          occurredAt: input.now,
        });
        const created = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          false,
        );
        if (!created) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft creation was not observable.",
          );
        }
        return Object.freeze({
          draft: mapRow(created),
          replayed: false,
        });
      });
    },

    async restore(
      input: RestoreCanvasDraftOptions,
    ): Promise<CanvasDraftMutationResult> {
      assertAuthority(input.authority, "canvas.write");
      assertId(input.canvasDraftId, "canvasDraftId");
      assertAudit(input.audit);
      assertVersion(input.expectedVersion, "expectedVersion");
      assertVersion(input.sourceVersion, "sourceVersion");
      if (input.sourceVersion >= input.expectedVersion) {
        fail(
          "canvas_draft.invalid_argument",
          "sourceVersion must identify an older retained revision.",
        );
      }

      return inTransaction(pool, async (connection) => {
        await revalidateAuthority(
          connection,
          input.authority,
          "canvas.write",
          input.now,
        );
        const existing = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          true,
        );
        if (!existing) {
          fail("canvas_draft.not_found", "Canvas Draft does not exist.");
        }
        const currentVersion = Number(existing.version);
        if (currentVersion !== input.expectedVersion) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft changed before the revision was restored.",
          );
        }
        const sourceRow = await selectRevision(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          input.sourceVersion,
          true,
        );
        if (!sourceRow) {
          fail(
            "canvas_draft.not_found",
            "The requested Canvas Draft revision is no longer retained.",
          );
        }
        const source = mapRevisionRow(sourceRow);
        if (
          source.contentDigest === existing.contentDigest &&
          source.brand?.brandKitRevisionId ===
            (existing.brandKitRevisionId ?? undefined)
        ) {
          fail(
            "canvas_draft.invalid_argument",
            "Canvas Draft already matches the requested revision.",
          );
        }
        const document = draftContentFromDocument(source.document);
        const documentJson = serializeDocument(document);
        const contentDigest = digestCanvasDraftContent(document);
        const nextVersion = currentVersion + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE canvas_draft
             SET
               brand_kit_revision_id = ?,
               title = ?,
               schema_version = ?,
               document = CAST(? AS JSON),
               content_digest = ?,
               version = ?,
               updated_by_principal_id = ?,
               updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?`,
          [
            source.brand?.brandKitRevisionId ?? null,
            document.title,
            document.schemaVersion,
            documentJson,
            contentDigest,
            nextVersion,
            input.authority.principalId,
            input.now,
            input.authority.workspaceId,
            input.canvasDraftId,
            currentVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft changed during revision restore.",
          );
        }
        await retainReferencedArtifacts(
          connection,
          input.authority,
          input.canvasDraftId,
          document,
          input.now,
        );
        await insertRevision(
          connection,
          input.authority,
          input.canvasDraftId,
          nextVersion,
          document,
          contentDigest,
          source.brand?.brandKitRevisionId,
          "restore",
          input.sourceVersion,
          input.now,
        );
        await appendAudit(connection, {
          authority: input.authority,
          audit: input.audit,
          action: "canvas_draft.restore",
          eventType: "canvas_draft.restored",
          resourceId: input.canvasDraftId,
          version: nextVersion,
          contentDigest,
          restoredFromVersion: input.sourceVersion,
          ...(source.brand
            ? { brandKitRevisionId: source.brand.brandKitRevisionId }
            : {}),
          occurredAt: input.now,
        });
        const restored = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          false,
        );
        if (!restored) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft restore was not observable.",
          );
        }
        return Object.freeze({
          draft: mapRow(restored),
          replayed: false,
        });
      });
    },

    async update(
      input: UpdateCanvasDraftOptions,
    ): Promise<CanvasDraftMutationResult> {
      assertAuthority(input.authority, "canvas.write");
      assertId(input.canvasDraftId, "canvasDraftId");
      assertAudit(input.audit);
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1
      ) {
        fail(
          "canvas_draft.invalid_argument",
          "expectedVersion must be a positive safe integer.",
        );
      }
      if (
        input.libraryInput &&
        !canvasDraftArtifactReferences(input.document).some(
          (reference) =>
            reference.artifactId === input.libraryInput!.artifactId,
        )
      )
        fail(
          "canvas_draft.invalid_argument",
          "The library input must be placed in the Canvas document.",
        );
      const documentJson = serializeDocument(input.document);
      const contentDigest = digestCanvasDraftContent(input.document);

      return inTransaction(pool, async (connection) => {
        await revalidateAuthority(
          connection,
          input.authority,
          "canvas.write",
          input.now,
        );
        const existing = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          true,
        );
        if (!existing) {
          fail("canvas_draft.not_found", "Canvas Draft does not exist.");
        }
        const currentVersion = Number(existing.version);
        if (currentVersion !== input.expectedVersion) {
          if (
            !input.libraryInput &&
            currentVersion === input.expectedVersion + 1 &&
            existing.contentDigest === contentDigest
          ) {
            return Object.freeze({
              draft: mapRow(existing),
              replayed: true,
            });
          }
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft was updated from another editing session.",
          );
        }

        const nextVersion = currentVersion + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE canvas_draft
             SET
               title = ?,
               schema_version = ?,
               document = CAST(? AS JSON),
               content_digest = ?,
               version = ?,
               updated_by_principal_id = ?,
               updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?`,
          [
            input.document.title,
            input.document.schemaVersion,
            documentJson,
            contentDigest,
            nextVersion,
            input.authority.principalId,
            input.now,
            input.authority.workspaceId,
            input.canvasDraftId,
            currentVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft version changed during save.",
          );
        }
        await retainReferencedArtifacts(
          connection,
          input.authority,
          input.canvasDraftId,
          input.document,
          input.now,
        );
        if (input.libraryInput)
          await recordAgentLibraryToolInputsInTransaction(connection, {
            authority: input.authority,
            invocationKind: "agent",
            invocationReferenceId: input.libraryInput.actionReceiptId,
            consumerKind: "canvas",
            requirePinnedInputs: true,
            libraryReference: input.libraryInput,
            consumerId: `${input.canvasDraftId}:${nextVersion}`,
            input: { artifactId: input.libraryInput.artifactId },
            now: input.now,
          });
        await insertRevision(
          connection,
          input.authority,
          input.canvasDraftId,
          nextVersion,
          input.document,
          contentDigest,
          existing.brandKitRevisionId ?? undefined,
          "save",
          undefined,
          input.now,
        );
        await appendAudit(connection, {
          authority: input.authority,
          audit: input.audit,
          action: "canvas_draft.update",
          eventType: "canvas_draft.updated",
          resourceId: input.canvasDraftId,
          version: nextVersion,
          contentDigest,
          ...(existing.brandKitRevisionId
            ? { brandKitRevisionId: existing.brandKitRevisionId }
            : {}),
          occurredAt: input.now,
        });
        const saved = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          false,
        );
        if (!saved) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft update was not observable.",
          );
        }
        return Object.freeze({
          draft: mapRow(saved),
          replayed: false,
        });
      });
    },

    async updateBrand(
      input: UpdateCanvasDraftBrandOptions,
    ): Promise<CanvasDraftMutationResult> {
      assertAuthority(input.authority, "canvas.write");
      assertAuthority(input.authority, "brand.read");
      assertId(input.canvasDraftId, "canvasDraftId");
      assertId(input.brandKitRevisionId, "brandKitRevisionId");
      assertAudit(input.audit);
      assertVersion(input.expectedVersion, "expectedVersion");

      return inTransaction(pool, async (connection) => {
        await revalidateAuthority(
          connection,
          input.authority,
          "canvas.write",
          input.now,
        );
        const existing = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          true,
        );
        if (!existing) {
          fail("canvas_draft.not_found", "Canvas Draft does not exist.");
        }
        const currentVersion = Number(existing.version);
        if (currentVersion !== input.expectedVersion) {
          if (
            currentVersion === input.expectedVersion + 1 &&
            existing.brandKitRevisionId === input.brandKitRevisionId
          ) {
            return Object.freeze({
              draft: mapRow(existing),
              replayed: true,
            });
          }
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft changed before the Brand Revision was adopted.",
          );
        }
        if (existing.brandKitRevisionId === input.brandKitRevisionId) {
          return Object.freeze({ draft: mapRow(existing), replayed: true });
        }
        const brand = await resolveBrandRevision(
          connection,
          input.authority,
          input.brandKitRevisionId,
          input.now,
          revalidateAuthority,
        );
        if (!brand) {
          fail(
            "canvas_draft.not_found",
            "Selected Brand Revision is unavailable in this Workspace.",
          );
        }
        const document = parseDocument(existing.document);
        const nextVersion = currentVersion + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE canvas_draft
           SET brand_kit_revision_id = ?,
               version = ?,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            brand.brandKitRevisionId,
            nextVersion,
            input.authority.principalId,
            input.now,
            input.authority.workspaceId,
            input.canvasDraftId,
            currentVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft changed during Brand Revision adoption.",
          );
        }
        await insertRevision(
          connection,
          input.authority,
          input.canvasDraftId,
          nextVersion,
          document,
          existing.contentDigest,
          brand.brandKitRevisionId,
          "brand_update",
          undefined,
          input.now,
        );
        await appendAudit(connection, {
          authority: input.authority,
          audit: input.audit,
          action: "canvas_draft.brand_update",
          eventType: "canvas_draft.brand_updated",
          resourceId: input.canvasDraftId,
          version: nextVersion,
          contentDigest: existing.contentDigest,
          brandKitRevisionId: brand.brandKitRevisionId,
          ...(existing.brandKitRevisionId
            ? {
                previousBrandKitRevisionId: existing.brandKitRevisionId,
              }
            : {}),
          occurredAt: input.now,
        });
        const saved = await selectById(
          connection,
          input.authority.workspaceId,
          input.canvasDraftId,
          false,
        );
        if (!saved) {
          fail(
            "canvas_draft.concurrent_change",
            "Canvas Draft Brand Revision adoption was not observable.",
          );
        }
        return Object.freeze({ draft: mapRow(saved), replayed: false });
      });
    },
  });
}
