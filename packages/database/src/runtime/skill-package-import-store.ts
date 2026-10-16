import { createHash } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { AuditJsonObject } from "./audit-event-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";
import {
  skillArchiveMediaTypes,
  type ExtractedSkillArchiveEntry,
  type ExtractedSkillPackageArchive,
} from "./skill-package-archive.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const rawHashPattern = /^[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const profilePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const reasonPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const archivePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/).+$/u;
const allowedArchiveMediaTypes = new Set<string>(skillArchiveMediaTypes);

export type SkillPackageImportState =
  | "quarantined"
  | "validated"
  | "rejected"
  | "draft_adopted"
  | "candidate_linked";

export interface SkillPackageImportRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceStoredObjectId: string;
  readonly rawArchiveSha256: string;
  readonly parserProfileVersion: string;
  readonly state: SkillPackageImportState;
  readonly inventorySummary: Readonly<Record<string, unknown>> | null;
  readonly inventoryDigest: string | null;
  readonly logicalPackageDigest: string | null;
  readonly rejectionCode: string | null;
  readonly adoptedSkillDraftId: string | null;
  readonly adoptedPublicationCandidateId: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ImportCommand {
  readonly importId: string;
  readonly workspaceId: string;
  readonly expectedVersion: number;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CreateSkillPackageImportOptions {
  readonly importId: string;
  readonly workspaceId: string;
  readonly sourceStoredObjectId: string;
  readonly rawArchiveSha256: string;
  readonly parserProfileVersion: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface RecordValidatedSkillPackageOptions extends ImportCommand {
  readonly archive: ExtractedSkillPackageArchive;
}

export interface RejectSkillPackageImportOptions extends ImportCommand {
  readonly rejectionCode: string;
}

export interface LinkSkillPackageDraftOptions extends ImportCommand {
  readonly skillDraftId: string;
}

export interface LinkSkillPackageCandidateOptions extends ImportCommand {
  readonly publicationCandidateId: string;
}

export interface SkillPackageImportStore {
  createQuarantine(
    options: CreateSkillPackageImportOptions,
  ): Promise<SkillPackageImportRecord>;
  recordValidated(
    options: RecordValidatedSkillPackageOptions,
  ): Promise<SkillPackageImportRecord>;
  reject(
    options: RejectSkillPackageImportOptions,
  ): Promise<SkillPackageImportRecord>;
  linkDraft(
    options: LinkSkillPackageDraftOptions,
  ): Promise<SkillPackageImportRecord>;
  linkCandidate(
    options: LinkSkillPackageCandidateOptions,
  ): Promise<SkillPackageImportRecord>;
}

export type SkillPackageImportStoreErrorCode =
  | "skill_import.invalid_argument"
  | "skill_import.not_found"
  | "skill_import.identity_conflict"
  | "skill_import.version_conflict"
  | "skill_import.lifecycle_conflict"
  | "skill_import.integrity_violation";

export class SkillPackageImportStoreError extends Error {
  public constructor(
    public readonly code: SkillPackageImportStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillPackageImportStoreError";
  }
}

interface WorkspaceRow extends RowDataPacket {
  readonly organizationId: string;
}

interface StoredObjectRow extends RowDataPacket {
  readonly sha256: string;
  readonly mediaType: string;
  readonly deleteState: string;
}

interface ImportRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceStoredObjectId: string;
  readonly rawArchiveSha256: string;
  readonly parserProfileVersion: string;
  readonly state: SkillPackageImportState;
  readonly inventorySummary: unknown;
  readonly inventoryDigest: string | null;
  readonly logicalPackageDigest: string | null;
  readonly rejectionCode: string | null;
  readonly adoptedSkillDraftId: string | null;
  readonly adoptedPublicationCandidateId: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface DraftRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
}

interface CandidateRow extends RowDataPacket {
  readonly id: string;
  readonly subjectKind: string;
  readonly sourceDraftId: string;
}

function fail(
  code: SkillPackageImportStoreErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new SkillPackageImportStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function invalid(message: string): never {
  return fail("skill_import.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid("expectedVersion must be a positive safe integer.");
  }
}

function assertAuditActor(
  actorPrincipalId: string,
  audit: ControlPlaneAuditContext,
): void {
  assertId(actorPrincipalId, "actorPrincipalId");
  assertId(audit.auditEventId, "audit.auditEventId");
  if (
    audit.actorType !== "system" &&
    audit.actorPrincipalId !== actorPrincipalId
  ) {
    invalid("Audit actor does not match the Skill import actor.");
  }
}

function validateCommand(options: ImportCommand): void {
  assertId(options.importId, "importId");
  assertId(options.workspaceId, "workspaceId");
  assertVersion(options.expectedVersion);
  assertDate(options.now, "now");
  assertAuditActor(options.actorPrincipalId, options.audit);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function validateExtractedArchive(
  archive: ExtractedSkillPackageArchive,
): Readonly<{
  inventoryText: string;
  inventoryDigest: string;
}> {
  const candidateEntries: unknown = archive.entries;
  if (
    !rawHashPattern.test(archive.archiveSha256) ||
    !digestPattern.test(archive.logicalPackageDigest) ||
    !Array.isArray(candidateEntries) ||
    candidateEntries.length < 1 ||
    candidateEntries.length > 256
  ) {
    invalid("Extracted archive identity is invalid.");
  }
  const entries = candidateEntries as readonly ExtractedSkillArchiveEntry[];
  const identities: Array<{
    readonly path: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly mediaType: string;
  }> = [];
  let previousPath: string | undefined;
  for (const entry of entries) {
    if (
      !archivePathPattern.test(entry.path) ||
      hasControlCharacter(entry.path) ||
      entry.path !== entry.path.normalize("NFC") ||
      entry.path.length > 500 ||
      !Number.isSafeInteger(entry.byteSize) ||
      entry.byteSize < 0 ||
      entry.byteSize > 32 * 1024 * 1024 ||
      !rawHashPattern.test(entry.sha256) ||
      !allowedArchiveMediaTypes.has(entry.mediaType) ||
      !(entry.bytes instanceof Uint8Array) ||
      entry.bytes.byteLength !== entry.byteSize
    ) {
      invalid("Extracted archive entry identity is invalid.");
    }
    if (previousPath !== undefined && entry.path <= previousPath) {
      invalid("Extracted archive entries must have unique canonical order.");
    }
    const actualSha256 = createHash("sha256").update(entry.bytes).digest("hex");
    if (actualSha256 !== entry.sha256) {
      invalid("Extracted archive entry bytes differ from its SHA-256.");
    }
    identities.push(
      Object.freeze({
        path: entry.path,
        byteSize: entry.byteSize,
        sha256: entry.sha256,
        mediaType: entry.mediaType,
      }),
    );
    previousPath = entry.path;
  }
  if (digestProviderValue(identities) !== archive.logicalPackageDigest) {
    invalid(
      "Extracted archive entries differ from the logical package digest.",
    );
  }
  const inventorySummary = Object.freeze({
    schemaVersion: 1,
    entries: Object.freeze(identities),
  });
  return Object.freeze({
    inventoryText: canonicalizeProviderValue(inventorySummary),
    inventoryDigest: digestProviderValue(inventorySummary),
  });
}

function parseInventory(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch (error) {
    return fail(
      "skill_import.integrity_violation",
      "Persisted Skill import inventory is not valid JSON.",
      error,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "skill_import.integrity_violation",
      "Persisted Skill import inventory is not a JSON object.",
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function recordFromRow(row: ImportRow): SkillPackageImportRecord {
  const inventorySummary = parseInventory(row.inventorySummary);
  if (
    inventorySummary &&
    (!row.inventoryDigest ||
      digestProviderValue(inventorySummary) !== row.inventoryDigest)
  ) {
    fail(
      "skill_import.integrity_violation",
      "Skill import inventory differs from its persisted digest.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    sourceStoredObjectId: row.sourceStoredObjectId,
    rawArchiveSha256: row.rawArchiveSha256,
    parserProfileVersion: row.parserProfileVersion,
    state: row.state,
    inventorySummary,
    inventoryDigest: row.inventoryDigest,
    logicalPackageDigest: row.logicalPackageDigest,
    rejectionCode: row.rejectionCode,
    adoptedSkillDraftId: row.adoptedSkillDraftId,
    adoptedPublicationCandidateId: row.adoptedPublicationCandidateId,
    version: row.version,
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function transaction<TResult>(
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
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function organizationIdFor(
  connection: PoolConnection,
  workspaceId: string,
): Promise<string> {
  const [rows] = await connection.execute<WorkspaceRow[]>(
    `SELECT organization_id AS organizationId
     FROM workspace
     WHERE id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId],
  );
  const organizationId = rows[0]?.organizationId;
  if (!organizationId || !idPattern.test(organizationId)) {
    fail("skill_import.not_found", "Workspace does not exist.");
  }
  return organizationId;
}

async function readImport(
  connection: PoolConnection,
  workspaceId: string,
  importId: string,
  lock: "FOR UPDATE" | "FOR SHARE",
): Promise<SkillPackageImportRecord | undefined> {
  const [rows] = await connection.execute<ImportRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       source_stored_object_id AS sourceStoredObjectId,
       raw_archive_sha256 AS rawArchiveSha256,
       parser_profile_version AS parserProfileVersion,
       state,
       inventory_summary AS inventorySummary,
       inventory_digest AS inventoryDigest,
       logical_package_digest AS logicalPackageDigest,
       rejection_code AS rejectionCode,
       adopted_skill_draft_id AS adoptedSkillDraftId,
       adopted_publication_candidate_id
         AS adoptedPublicationCandidateId,
       version,
       created_by_principal_id AS createdByPrincipalId,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM skill_package_import
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     ${lock}`,
    [workspaceId, importId],
  );
  return rows[0] ? recordFromRow(rows[0]) : undefined;
}

function auditDecision(workspaceId: string, action: string): AuditJsonObject {
  return Object.freeze({
    effect: "allow",
    workspaceId,
    action,
  });
}

async function appendAudit(
  connection: PoolConnection,
  organizationId: string,
  context: ControlPlaneAuditContext,
  options: {
    readonly workspaceId: string;
    readonly importId: string;
    readonly action: string;
    readonly eventType: string;
    readonly reasonCode: string;
    readonly details: AuditJsonObject;
    readonly now: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, context, {
    organizationId,
    workspaceId: options.workspaceId,
    eventType: options.eventType,
    action: options.action,
    resourceType: "skill_package_import",
    resourceId: options.importId,
    outcome: "succeeded",
    decisionReasonCode: options.reasonCode,
    severity: options.reasonCode.endsWith("rejected") ? "warning" : "info",
    authorizationDecision: auditDecision(options.workspaceId, options.action),
    details: options.details,
    occurredAt: options.now,
  });
}

async function requireImportForTransition(
  connection: PoolConnection,
  options: ImportCommand,
  allowedStates: readonly SkillPackageImportState[],
): Promise<SkillPackageImportRecord> {
  const current = await readImport(
    connection,
    options.workspaceId,
    options.importId,
    "FOR UPDATE",
  );
  if (!current) {
    fail("skill_import.not_found", "Skill package Import does not exist.");
  }
  if (current.version !== options.expectedVersion) {
    fail("skill_import.version_conflict", "Skill package Import CAS failed.");
  }
  if (!allowedStates.includes(current.state)) {
    fail(
      "skill_import.lifecycle_conflict",
      "Skill package Import transition is not allowed.",
    );
  }
  return current;
}

async function readBack(
  connection: PoolConnection,
  options: ImportCommand,
): Promise<SkillPackageImportRecord> {
  const record = await readImport(
    connection,
    options.workspaceId,
    options.importId,
    "FOR SHARE",
  );
  if (!record) {
    return fail(
      "skill_import.integrity_violation",
      "Updated Skill package Import cannot be read back.",
    );
  }
  return record;
}

export function createSkillPackageImportStore(
  pool: Pool,
): SkillPackageImportStore {
  return Object.freeze({
    async createQuarantine(
      options: CreateSkillPackageImportOptions,
    ): Promise<SkillPackageImportRecord> {
      assertId(options.importId, "importId");
      assertId(options.workspaceId, "workspaceId");
      assertId(options.sourceStoredObjectId, "sourceStoredObjectId");
      if (!rawHashPattern.test(options.rawArchiveSha256)) {
        invalid("rawArchiveSha256 must be a lowercase SHA-256 hex value.");
      }
      if (!profilePattern.test(options.parserProfileVersion)) {
        invalid("parserProfileVersion is invalid.");
      }
      assertDate(options.now, "now");
      assertAuditActor(options.actorPrincipalId, options.audit);
      return transaction(pool, async (connection) => {
        const organizationId = await organizationIdFor(
          connection,
          options.workspaceId,
        );
        const [objectRows] = await connection.execute<StoredObjectRow[]>(
          `SELECT
             sha256,
             media_type AS mediaType,
             delete_state AS deleteState
           FROM stored_object
           WHERE workspace_id = ?
             AND id = ?
           LIMIT 1
           FOR SHARE`,
          [options.workspaceId, options.sourceStoredObjectId],
        );
        const object = objectRows[0];
        if (
          !object ||
          object.deleteState !== "active" ||
          object.sha256 !== options.rawArchiveSha256 ||
          !["application/zip", "application/octet-stream"].includes(
            object.mediaType.toLowerCase(),
          )
        ) {
          fail(
            "skill_import.identity_conflict",
            "Source StoredObject is unavailable or differs from the archive identity.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO skill_package_import (
             id,
             workspace_id,
             source_stored_object_id,
             raw_archive_sha256,
             parser_profile_version,
             state,
             inventory_summary,
             inventory_digest,
             logical_package_digest,
             rejection_code,
             adopted_skill_draft_id,
             adopted_publication_candidate_id,
             version,
             created_by_principal_id,
             created_at,
             updated_at
           )
           VALUES (
             ?, ?, ?, ?, ?, 'quarantined',
             NULL, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, ?
           )`,
          [
            options.importId,
            options.workspaceId,
            options.sourceStoredObjectId,
            options.rawArchiveSha256,
            options.parserProfileVersion,
            options.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        const record = await readImport(
          connection,
          options.workspaceId,
          options.importId,
          "FOR SHARE",
        );
        if (!record) {
          fail(
            "skill_import.integrity_violation",
            "Quarantined Skill package Import cannot be read back.",
          );
        }
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          importId: options.importId,
          action: "skill_package.import.quarantine",
          eventType: "skill_package.import.quarantined",
          reasonCode: "skill_package.import.quarantined",
          details: Object.freeze({
            sourceStoredObjectId: options.sourceStoredObjectId,
            rawArchiveSha256: options.rawArchiveSha256,
            parserProfileVersion: options.parserProfileVersion,
          }),
          now: options.now,
        });
        return record;
      });
    },

    async recordValidated(
      options: RecordValidatedSkillPackageOptions,
    ): Promise<SkillPackageImportRecord> {
      validateCommand(options);
      const { inventoryText, inventoryDigest } = validateExtractedArchive(
        options.archive,
      );
      return transaction(pool, async (connection) => {
        const organizationId = await organizationIdFor(
          connection,
          options.workspaceId,
        );
        const current = await requireImportForTransition(connection, options, [
          "quarantined",
        ]);
        if (current.rawArchiveSha256 !== options.archive.archiveSha256) {
          fail(
            "skill_import.identity_conflict",
            "Validated archive differs from the quarantined source hash.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE skill_package_import
           SET state = 'validated',
               inventory_summary = CAST(? AS JSON),
               inventory_digest = ?,
               logical_package_digest = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND state = 'quarantined'`,
          [
            inventoryText,
            inventoryDigest,
            options.archive.logicalPackageDigest,
            options.now,
            options.workspaceId,
            options.importId,
            options.expectedVersion,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "skill_import.version_conflict",
            "Skill import validation update lost its CAS.",
          );
        }
        const record = await readBack(connection, options);
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          importId: options.importId,
          action: "skill_package.import.validate",
          eventType: "skill_package.import.validated",
          reasonCode: "skill_package.import.validated",
          details: Object.freeze({
            inventoryDigest,
            logicalPackageDigest: options.archive.logicalPackageDigest,
            entryCount: options.archive.entries.length,
          }),
          now: options.now,
        });
        return record;
      });
    },

    async reject(
      options: RejectSkillPackageImportOptions,
    ): Promise<SkillPackageImportRecord> {
      validateCommand(options);
      if (!reasonPattern.test(options.rejectionCode)) {
        invalid("rejectionCode must use the stable reason-code profile.");
      }
      return transaction(pool, async (connection) => {
        const organizationId = await organizationIdFor(
          connection,
          options.workspaceId,
        );
        const current = await requireImportForTransition(connection, options, [
          "quarantined",
          "validated",
        ]);
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE skill_package_import
           SET state = 'rejected',
               rejection_code = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND state = ?`,
          [
            options.rejectionCode,
            options.now,
            options.workspaceId,
            options.importId,
            options.expectedVersion,
            current.state,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "skill_import.version_conflict",
            "Skill import rejection update lost its CAS.",
          );
        }
        const record = await readBack(connection, options);
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          importId: options.importId,
          action: "skill_package.import.reject",
          eventType: "skill_package.import.rejected",
          reasonCode: "skill_package.import.rejected",
          details: Object.freeze({
            rejectionCode: options.rejectionCode,
            rejectedFromState: current.state,
          }),
          now: options.now,
        });
        return record;
      });
    },

    async linkDraft(
      options: LinkSkillPackageDraftOptions,
    ): Promise<SkillPackageImportRecord> {
      validateCommand(options);
      assertId(options.skillDraftId, "skillDraftId");
      return transaction(pool, async (connection) => {
        const organizationId = await organizationIdFor(
          connection,
          options.workspaceId,
        );
        await requireImportForTransition(connection, options, ["validated"]);
        const [draftRows] = await connection.execute<DraftRow[]>(
          `SELECT id, lifecycle_status AS lifecycleStatus
           FROM skill_draft
           WHERE workspace_id = ?
             AND id = ?
           LIMIT 1
           FOR SHARE`,
          [options.workspaceId, options.skillDraftId],
        );
        if (draftRows[0]?.lifecycleStatus !== "active") {
          fail(
            "skill_import.identity_conflict",
            "Adopted Skill Draft is missing or unavailable.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE skill_package_import
           SET state = 'draft_adopted',
               adopted_skill_draft_id = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND state = 'validated'`,
          [
            options.skillDraftId,
            options.now,
            options.workspaceId,
            options.importId,
            options.expectedVersion,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "skill_import.version_conflict",
            "Skill import Draft link lost its CAS.",
          );
        }
        const record = await readBack(connection, options);
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          importId: options.importId,
          action: "skill_package.import.adopt_draft",
          eventType: "skill_package.import.draft_adopted",
          reasonCode: "skill_package.import.draft_adopted",
          details: Object.freeze({
            skillDraftId: options.skillDraftId,
          }),
          now: options.now,
        });
        return record;
      });
    },

    async linkCandidate(
      options: LinkSkillPackageCandidateOptions,
    ): Promise<SkillPackageImportRecord> {
      validateCommand(options);
      assertId(options.publicationCandidateId, "publicationCandidateId");
      return transaction(pool, async (connection) => {
        const organizationId = await organizationIdFor(
          connection,
          options.workspaceId,
        );
        const current = await requireImportForTransition(connection, options, [
          "draft_adopted",
        ]);
        const [candidateRows] = await connection.execute<CandidateRow[]>(
          `SELECT
               id,
               subject_kind AS subjectKind,
               source_draft_id AS sourceDraftId
             FROM publication_candidate
             WHERE workspace_id = ?
               AND id = ?
             LIMIT 1
             FOR SHARE`,
          [options.workspaceId, options.publicationCandidateId],
        );
        const candidate = candidateRows[0];
        if (
          !candidate ||
          candidate.subjectKind !== "skill" ||
          candidate.sourceDraftId !== current.adoptedSkillDraftId
        ) {
          fail(
            "skill_import.identity_conflict",
            "Publication Candidate does not freeze the adopted Skill Draft.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE skill_package_import
           SET state = 'candidate_linked',
               adopted_publication_candidate_id = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND state = 'draft_adopted'`,
          [
            options.publicationCandidateId,
            options.now,
            options.workspaceId,
            options.importId,
            options.expectedVersion,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "skill_import.version_conflict",
            "Skill import Candidate link lost its CAS.",
          );
        }
        const record = await readBack(connection, options);
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          importId: options.importId,
          action: "skill_package.import.link_candidate",
          eventType: "skill_package.import.candidate_linked",
          reasonCode: "skill_package.import.candidate_linked",
          details: Object.freeze({
            skillDraftId: current.adoptedSkillDraftId,
            publicationCandidateId: options.publicationCandidateId,
          }),
          now: options.now,
        });
        return record;
      });
    },
  });
}
