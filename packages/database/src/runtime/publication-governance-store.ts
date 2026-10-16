import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { DomainError } from "@kanvas/application";

import type { AuditJsonObject } from "./audit-event-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  parseSkillPublicationDocument,
  parseWorkflowPublicationDocument,
  skillPackageDigest,
  type SkillPublicationDocumentV1,
  type WorkflowPublicationDocumentV1,
} from "./publication-documents.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const stableKeyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const profilePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const reasonPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const requiredCheckKinds = Object.freeze([
  "schema",
  "resources",
  "security",
  "compatibility",
  "eval",
] as const);

export type PublicationSubjectKind = "workflow" | "skill";
export type PublicationCheckKind = (typeof requiredCheckKinds)[number];
export type PublicationRuntimeStatus = "enabled" | "disabled" | "revoked";

export interface PublicationDraftRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectKey: string;
  readonly skillDefinitionId?: string;
  readonly schemaVersion: 1;
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly derivedFromRevisionId: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublicationCandidateRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectKey: string;
  readonly sourceDraftId: string;
  readonly sourceDraftVersion: number;
  readonly schemaVersion: 1;
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly canonicalDigest: string;
  readonly parserProfileVersion: string;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
}

export type WorkflowPublicationCandidateRecord = PublicationCandidateRecord & {
  readonly subjectKind: "workflow";
};

export interface PublicationCandidateReviewRecord {
  readonly candidate: WorkflowPublicationCandidateRecord;
  readonly latestTestRunId?: string;
  readonly activeTestRunIds?: readonly string[];
  readonly checks: readonly {
    readonly id: string;
    readonly checkKind: PublicationCheckKind;
    readonly checkProfileVersion: string;
    readonly outcome: "passed" | "failed";
    readonly evidenceSummary: Readonly<Record<string, unknown>>;
    readonly evidenceDigest: string;
    readonly checkedAt: Date;
  }[];
  readonly review?: {
    readonly id: string;
    readonly decision: "approved" | "rejected";
    readonly commentSummary?: string;
    readonly reviewerPrincipalId: string;
    readonly decidedAt: Date;
  };
  readonly publishedRevision?: PublishedRevisionRecord & {
    readonly subjectKind: "workflow";
  };
}

export interface SavePublicationDraftOptions {
  readonly draftId: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectKey: string;
  readonly visibility?: "private" | "workspace";
  readonly contentDocument: unknown;
  /**
   * Zero creates a Draft. A positive value performs an exact CAS update.
   */
  readonly expectedVersion: number;
  readonly derivedFromRevisionId?: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ArchivePublicationDraftOptions {
  readonly draftId: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly expectedVersion: number;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface SubmitPublicationCandidateOptions {
  readonly candidateId: string;
  readonly draftId: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly expectedDraftVersion: number;
  readonly parserProfileVersion: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface RecordPublicationCheckOptions {
  readonly checkId: string;
  readonly candidateId: string;
  readonly workspaceId: string;
  readonly checkKind: PublicationCheckKind;
  readonly checkProfileVersion: string;
  readonly outcome: "passed" | "failed";
  readonly evidenceSummary: Readonly<Record<string, unknown>>;
  readonly expectedCandidateDigest: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ReviewPublicationCandidateOptions {
  readonly reviewDecisionId: string;
  readonly candidateId: string;
  readonly workspaceId: string;
  readonly decision: "approved" | "rejected";
  readonly expectedCandidateDigest: string;
  readonly commentSummary?: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishWorkflowCandidateOptions {
  readonly candidateId: string;
  readonly workflowRevisionId: string;
  readonly workspaceId: string;
  readonly expectedCandidateDigest: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishSkillCandidateOptions {
  readonly candidateId: string;
  readonly skillRevisionId: string;
  readonly workspaceId: string;
  readonly expectedCandidateDigest: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublishedRevisionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly runtimeStatus: "enabled";
  readonly publishedAt: Date;
}

export interface ChangePublicationRuntimeStatusOptions {
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly revisionId: string;
  readonly expectedVersion: number;
  readonly runtimeStatus: PublicationRuntimeStatus;
  readonly reasonCode?: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface PublicationRuntimeStatusRecord {
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly revisionId: string;
  readonly runtimeStatus: PublicationRuntimeStatus;
  readonly reasonCode: string | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PublicationValidationPort {
  validateWorkflow(document: WorkflowPublicationDocumentV1): readonly string[];
  validateSkill(document: SkillPublicationDocumentV1): readonly string[];
}

export interface PublicationGovernanceStore {
  getDraft(
    workspaceId: string,
    subjectKind: PublicationSubjectKind,
    draftId: string,
  ): Promise<PublicationDraftRecord | undefined>;
  getCandidate(
    workspaceId: string,
    candidateId: string,
  ): Promise<PublicationCandidateRecord | undefined>;
  listCandidateChecks(
    workspaceId: string,
    candidateId: string,
  ): Promise<readonly PublicationCheckKind[]>;
  listWorkflowCandidates(
    workspaceId: string,
    workflowKey?: string,
  ): Promise<readonly WorkflowPublicationCandidateRecord[]>;
  getWorkflowCandidateReview(
    workspaceId: string,
    candidateId: string,
  ): Promise<PublicationCandidateReviewRecord | undefined>;
  saveDraft(
    options: SavePublicationDraftOptions,
  ): Promise<PublicationDraftRecord>;
  archiveDraft(
    options: ArchivePublicationDraftOptions,
  ): Promise<PublicationDraftRecord>;
  submitCandidate(
    options: SubmitPublicationCandidateOptions,
  ): Promise<PublicationCandidateRecord>;
  recordCheck(options: RecordPublicationCheckOptions): Promise<void>;
  reviewCandidate(options: ReviewPublicationCandidateOptions): Promise<void>;
  publishWorkflow(
    options: PublishWorkflowCandidateOptions,
  ): Promise<PublishedRevisionRecord>;
  publishSkill(
    options: PublishSkillCandidateOptions,
  ): Promise<PublishedRevisionRecord>;
  changeRuntimeStatus(
    options: ChangePublicationRuntimeStatusOptions,
  ): Promise<PublicationRuntimeStatusRecord>;
}

export type PublicationGovernanceStoreErrorCode =
  | "publication.invalid_argument"
  | "publication.not_found"
  | "publication.identity_conflict"
  | "publication.version_conflict"
  | "publication.lifecycle_conflict"
  | "publication.checks_incomplete"
  | "publication.review_required"
  | "publication.validation_failed"
  | "publication.integrity_violation";

export class PublicationGovernanceStoreError extends DomainError {
  public constructor(
    public override readonly code: PublicationGovernanceStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
    this.name = "PublicationGovernanceStoreError";
  }
}

interface WorkspaceRow extends RowDataPacket {
  readonly organizationId: string;
}

interface WorkflowDefinitionRow extends RowDataPacket {
  readonly id: string;
}

interface DraftRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKey: string;
  readonly skillDefinitionId: string | null;
  readonly schemaVersion: number;
  readonly contentDocument: unknown;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly derivedFromRevisionId: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CandidateRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectKey: string;
  readonly sourceDraftId: string;
  readonly sourceDraftVersion: number;
  readonly schemaVersion: number;
  readonly contentDocument: unknown;
  readonly canonicalDigest: string;
  readonly parserProfileVersion: string;
  readonly createdByPrincipalId: string;
  readonly createdAt: Date;
}

interface CheckRow extends RowDataPacket {
  readonly checkKind: PublicationCheckKind;
  readonly outcome: "passed" | "failed";
}

interface ReviewRow extends RowDataPacket {
  readonly decision: "approved" | "rejected";
  readonly candidateDigest: string;
}

interface PublishedRow extends RowDataPacket {
  readonly id: string;
  readonly subjectKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly publishedAt: Date;
}

interface StoredObjectRow extends RowDataPacket {
  readonly id: string;
  readonly sha256: string;
  readonly byteSize: number | string;
  readonly mediaType: string;
  readonly deleteState: string;
}

interface WorkflowEntrypointRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly runtimeStatus: string | null;
}

interface ActivationRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly revisionId: string;
  readonly runtimeStatus: PublicationRuntimeStatus;
  readonly reasonCode: string | null;
  readonly version: number;
  readonly updatedAt: Date;
}

function fail(
  code: PublicationGovernanceStoreErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new PublicationGovernanceStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function invalid(message: string): never {
  return fail("publication.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !stableKeyPattern.test(value)) {
    invalid(`${label} must use the stable lowercase key profile.`);
  }
}

function assertProfile(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !profilePattern.test(value)) {
    invalid(`${label} must use the stable profile version format.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertPositiveVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid(`${label} must be a positive safe integer.`);
  }
}

function parseJsonObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch (error) {
    return fail(
      "publication.integrity_violation",
      `${label} is not valid JSON.`,
      error,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "publication.integrity_violation",
      `${label} is not a JSON object.`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function canonicalJson(value: unknown): {
  readonly text: string;
  readonly digest: string;
} {
  return Object.freeze({
    text: canonicalizeProviderValue(value),
    digest: digestProviderValue(value),
  });
}

function assertActor(
  actorPrincipalId: string,
  audit: ControlPlaneAuditContext,
): void {
  assertId(actorPrincipalId, "actorPrincipalId");
  assertId(audit.auditEventId, "audit.auditEventId");
  if (
    audit.actorType !== "system" &&
    audit.actorPrincipalId !== actorPrincipalId
  ) {
    invalid("Audit actor does not match the publication command actor.");
  }
}

function draftTable(subjectKind: PublicationSubjectKind): string {
  return subjectKind === "workflow" ? "workflow_draft" : "skill_draft";
}

function subjectKeyColumn(subjectKind: PublicationSubjectKind): string {
  return subjectKind === "workflow" ? "workflow_key" : "skill_key";
}

function derivedColumn(subjectKind: PublicationSubjectKind): string {
  return subjectKind === "workflow"
    ? "derived_from_workflow_revision_id"
    : "derived_from_skill_revision_id";
}

function activationTable(subjectKind: PublicationSubjectKind): string {
  return subjectKind === "workflow"
    ? "workflow_revision_activation"
    : "skill_revision_activation";
}

function activationRevisionColumn(subjectKind: PublicationSubjectKind): string {
  return subjectKind === "workflow"
    ? "workflow_revision_id"
    : "skill_revision_id";
}

async function inTransaction<TResult>(
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

async function requireOrganizationId(
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
  const row = rows[0];
  if (!row || !idPattern.test(row.organizationId)) {
    fail("publication.not_found", "Workspace does not exist.");
  }
  return row.organizationId;
}

async function requireWorkflowDefinitionId(
  connection: PoolConnection,
  workspaceId: string,
  workflowKey: string,
): Promise<string> {
  const [rows] = await connection.execute<WorkflowDefinitionRow[]>(
    `SELECT id
     FROM workflow_definition
     WHERE workspace_id = ?
       AND workflow_key = ?
       AND lifecycle_status = 'active'
     LIMIT 1
     FOR SHARE`,
    [workspaceId, workflowKey],
  );
  const definitionId = rows[0]?.id;
  if (!definitionId || !idPattern.test(definitionId)) {
    fail(
      "publication.not_found",
      "Workflow Definition does not exist or is not active.",
    );
  }
  return definitionId;
}

async function ensureSkillDefinition(
  connection: PoolConnection,
  options: SavePublicationDraftOptions,
  document: SkillPublicationDocumentV1,
): Promise<string> {
  const [rows] = await connection.execute<
    (RowDataPacket & {
      readonly id: string;
      readonly lifecycleStatus: string;
    })[]
  >(
    `SELECT id, lifecycle_status AS lifecycleStatus
     FROM skill_definition
     WHERE workspace_id = ? AND skill_key = ?
     LIMIT 1
     FOR UPDATE`,
    [options.workspaceId, options.subjectKey],
  );
  const existing = rows[0];
  if (existing) {
    if (existing.lifecycleStatus !== "active") {
      fail(
        "publication.lifecycle_conflict",
        "The Skill is archived and cannot be edited.",
      );
    }
    return existing.id;
  }
  const manifest = document.manifest;
  const agent =
    manifest.agent &&
    typeof manifest.agent === "object" &&
    !Array.isArray(manifest.agent)
      ? (manifest.agent as Readonly<Record<string, unknown>>)
      : {};
  const displayName =
    typeof manifest.displayName === "string"
      ? manifest.displayName.slice(0, 160)
      : options.subjectKey;
  const summary =
    typeof agent.summary === "string"
      ? agent.summary.slice(0, 600)
      : `Instructions for ${displayName}`;
  const examples = Array.isArray(agent.exampleRequests)
    ? agent.exampleRequests
        .filter((value): value is string => typeof value === "string")
        .slice(0, 20)
    : [];
  const visibility = options.visibility ?? "private";
  const creationRequestKey = `skill-draft:${options.draftId}`;
  await connection.execute<ResultSetHeader>(
    `INSERT INTO skill_definition (
       id, workspace_id, skill_key, owner_principal_id, visibility,
       lifecycle_status, creation_request_key, creation_request_hash,
       version, created_by_principal_id, updated_by_principal_id,
       created_at, updated_at, archived_at
     ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?, NULL)`,
    [
      options.draftId,
      options.workspaceId,
      options.subjectKey,
      options.actorPrincipalId,
      visibility,
      creationRequestKey,
      digestProviderValue({
        workspaceId: options.workspaceId,
        subjectKey: options.subjectKey,
        draftId: options.draftId,
      }),
      options.actorPrincipalId,
      options.actorPrincipalId,
      options.now,
      options.now,
    ],
  );
  await connection.execute<ResultSetHeader>(
    `INSERT INTO skill_presentation (
       workspace_id, skill_definition_id, display_name, summary,
       cover_asset_id, category, tags, example_requests,
       version, updated_by_principal_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, NULL, CAST(? AS JSON), CAST(? AS JSON),
               1, ?, ?, ?)`,
    [
      options.workspaceId,
      options.draftId,
      displayName,
      summary,
      JSON.stringify([]),
      JSON.stringify(examples),
      options.actorPrincipalId,
      options.now,
      options.now,
    ],
  );
  return options.draftId;
}

function draftFromRow(
  subjectKind: PublicationSubjectKind,
  row: DraftRow,
): PublicationDraftRecord {
  const document = parseJsonObject(row.contentDocument, "Draft document");
  if (
    row.schemaVersion !== 1 ||
    digestProviderValue(document) !== row.canonicalDigest
  ) {
    fail(
      "publication.integrity_violation",
      "Draft document differs from its persisted identity.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    subjectKind,
    subjectKey: row.subjectKey,
    ...(row.skillDefinitionId
      ? { skillDefinitionId: row.skillDefinitionId }
      : {}),
    schemaVersion: 1,
    contentDocument: document,
    canonicalDigest: row.canonicalDigest,
    lifecycleStatus: row.lifecycleStatus,
    derivedFromRevisionId: row.derivedFromRevisionId,
    version: row.version,
    createdByPrincipalId: row.createdByPrincipalId,
    updatedByPrincipalId: row.updatedByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function candidateFromRow(row: CandidateRow): PublicationCandidateRecord {
  const document = parseJsonObject(
    row.contentDocument,
    "Publication Candidate document",
  );
  if (
    row.schemaVersion !== 1 ||
    digestProviderValue(document) !== row.canonicalDigest
  ) {
    fail(
      "publication.integrity_violation",
      "Publication Candidate differs from its persisted identity.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    subjectKind: row.subjectKind,
    subjectKey: row.subjectKey,
    sourceDraftId: row.sourceDraftId,
    sourceDraftVersion: row.sourceDraftVersion,
    schemaVersion: 1,
    contentDocument: document,
    canonicalDigest: row.canonicalDigest,
    parserProfileVersion: row.parserProfileVersion,
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
  });
}

async function readDraft(
  connection: PoolConnection,
  workspaceId: string,
  subjectKind: PublicationSubjectKind,
  draftId: string,
  lock: "FOR UPDATE" | "FOR SHARE",
): Promise<PublicationDraftRecord | undefined> {
  const table = draftTable(subjectKind);
  const keyColumn = subjectKeyColumn(subjectKind);
  const sourceColumn = derivedColumn(subjectKind);
  const [rows] = await connection.execute<DraftRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       ${keyColumn} AS subjectKey,
       ${subjectKind === "skill" ? "skill_definition_id" : "NULL"} AS skillDefinitionId,
       schema_version AS schemaVersion,
       content_document AS contentDocument,
       canonical_digest AS canonicalDigest,
       lifecycle_status AS lifecycleStatus,
       ${sourceColumn} AS derivedFromRevisionId,
       version,
       created_by_principal_id AS createdByPrincipalId,
       updated_by_principal_id AS updatedByPrincipalId,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM ${table}
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     ${lock}`,
    [workspaceId, draftId],
  );
  const row = rows[0];
  if (
    row?.skillDefinitionId &&
    subjectKind === "skill" &&
    lock === "FOR UPDATE"
  ) {
    const [definitions] = await connection.execute<
      (RowDataPacket & { lifecycleStatus: string })[]
    >(
      "SELECT lifecycle_status AS lifecycleStatus FROM skill_definition WHERE workspace_id = ? AND id = ? FOR UPDATE",
      [workspaceId, row.skillDefinitionId],
    );
    if (definitions[0]?.lifecycleStatus !== "active")
      fail(
        "publication.lifecycle_conflict",
        "This Skill was deleted and cannot be changed or published.",
      );
  }

  return row ? draftFromRow(subjectKind, row) : undefined;
}

async function readCandidate(
  connection: PoolConnection,
  workspaceId: string,
  candidateId: string,
  lock: "FOR UPDATE" | "FOR SHARE",
): Promise<PublicationCandidateRecord | undefined> {
  const [rows] = await connection.execute<CandidateRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       subject_kind AS subjectKind,
       subject_key AS subjectKey,
       source_draft_id AS sourceDraftId,
       source_draft_version AS sourceDraftVersion,
       schema_version AS schemaVersion,
       content_document AS contentDocument,
       canonical_digest AS canonicalDigest,
       parser_profile_version AS parserProfileVersion,
       created_by_principal_id AS createdByPrincipalId,
       created_at AS createdAt
     FROM publication_candidate
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     ${lock}`,
    [workspaceId, candidateId],
  );
  return rows[0] ? candidateFromRow(rows[0]) : undefined;
}

function validateDocument(
  subjectKind: PublicationSubjectKind,
  document: unknown,
): WorkflowPublicationDocumentV1 | SkillPublicationDocumentV1 {
  return subjectKind === "workflow"
    ? parseWorkflowPublicationDocument(document)
    : parseSkillPublicationDocument(document);
}

function authorizationDecision(
  operation: string,
  workspaceId: string,
): AuditJsonObject {
  return Object.freeze({
    effect: "allow",
    operation,
    workspaceId,
  });
}

async function appendAudit(
  connection: PoolConnection,
  organizationId: string,
  context: ControlPlaneAuditContext,
  event: {
    readonly workspaceId: string;
    readonly eventType: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly reasonCode: string;
    readonly details: AuditJsonObject;
    readonly occurredAt: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, context, {
    organizationId,
    workspaceId: event.workspaceId,
    eventType: event.eventType,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: "succeeded",
    decisionReasonCode: event.reasonCode,
    severity: "info",
    authorizationDecision: authorizationDecision(
      event.action,
      event.workspaceId,
    ),
    details: event.details,
    occurredAt: event.occurredAt,
  });
}

function validateCommonCommand(options: {
  readonly workspaceId: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}): void {
  assertId(options.workspaceId, "workspaceId");
  assertActor(options.actorPrincipalId, options.audit);
  assertDate(options.now, "now");
}

async function requirePublishGate(
  connection: PoolConnection,
  candidate: PublicationCandidateRecord,
): Promise<void> {
  const [checkRows] = await connection.execute<CheckRow[]>(
    `SELECT
       check_kind AS checkKind,
       outcome
     FROM publication_check
     WHERE workspace_id = ?
       AND publication_candidate_id = ?
     FOR SHARE`,
    [candidate.workspaceId, candidate.id],
  );
  const outcomes = new Map(
    checkRows.map((row) => [row.checkKind, row.outcome]),
  );
  if (requiredCheckKinds.some((kind) => outcomes.get(kind) !== "passed")) {
    fail(
      "publication.checks_incomplete",
      "All required Publication Checks must pass.",
    );
  }
  const [reviewRows] = await connection.execute<ReviewRow[]>(
    `SELECT
       decision,
       candidate_digest AS candidateDigest
     FROM publication_review_decision
     WHERE workspace_id = ?
       AND publication_candidate_id = ?
     LIMIT 1
     FOR SHARE`,
    [candidate.workspaceId, candidate.id],
  );
  const review = reviewRows[0];
  if (
    !review ||
    review.decision !== "approved" ||
    review.candidateDigest !== candidate.canonicalDigest
  ) {
    fail(
      "publication.review_required",
      "Publication Candidate has no matching approval.",
    );
  }
}

function assertValidationPassed(issues: readonly string[]): void {
  if (issues.length > 0) {
    fail(
      "publication.validation_failed",
      `Publication validation failed with ${String(issues.length)} issue(s).`,
    );
  }
}

async function nextRevision(
  connection: PoolConnection,
  table: "workflow_revision" | "skill_revision",
  keyColumn: "workflow_key" | "skill_key",
  workspaceId: string,
  subjectKey: string,
): Promise<number> {
  const [rows] = await connection.execute<
    (RowDataPacket & { readonly revision: number })[]
  >(
    `SELECT revision
     FROM ${table}
     WHERE workspace_id = ?
       AND ${keyColumn} = ?
     ORDER BY revision DESC
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, subjectKey],
  );
  const current = rows[0]?.revision ?? 0;
  if (!Number.isSafeInteger(current) || current < 0) {
    fail(
      "publication.integrity_violation",
      "Published Revision counter is invalid.",
    );
  }
  return current + 1;
}

async function findPublishedWorkflowReplay(
  connection: PoolConnection,
  workspaceId: string,
  candidateId: string,
): Promise<PublishedRow | undefined> {
  const [rows] = await connection.execute<PublishedRow[]>(
    `SELECT
       revision.id,
       revision.workflow_key AS subjectKey,
       revision.revision,
       revision.canonical_digest AS canonicalDigest,
       publication.published_at AS publishedAt
     FROM workflow_revision_publication publication
     INNER JOIN workflow_revision revision
       ON revision.workspace_id = publication.workspace_id
      AND revision.id = publication.workflow_revision_id
     WHERE publication.workspace_id = ?
       AND publication.publication_candidate_id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, candidateId],
  );
  return rows[0];
}

async function findPublishedSkillReplay(
  connection: PoolConnection,
  workspaceId: string,
  candidateId: string,
): Promise<PublishedRow | undefined> {
  const [rows] = await connection.execute<PublishedRow[]>(
    `SELECT
       id,
       skill_key AS subjectKey,
       revision,
       canonical_digest AS canonicalDigest,
       published_at AS publishedAt
     FROM skill_revision
     WHERE workspace_id = ?
       AND publication_candidate_id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, candidateId],
  );
  return rows[0];
}

function replayResult(
  subjectKind: PublicationSubjectKind,
  workspaceId: string,
  row: PublishedRow,
  expectedId: string,
  expectedDigest: string,
): PublishedRevisionRecord {
  if (row.id !== expectedId || row.canonicalDigest !== expectedDigest) {
    fail(
      "publication.identity_conflict",
      "Publication Candidate is already bound to another Revision identity.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId,
    subjectKind,
    subjectKey: row.subjectKey,
    revision: row.revision,
    canonicalDigest: row.canonicalDigest,
    runtimeStatus: "enabled",
    publishedAt: row.publishedAt,
  });
}

async function validateSkillReferences(
  connection: PoolConnection,
  workspaceId: string,
  document: SkillPublicationDocumentV1,
): Promise<void> {
  for (const resource of document.resources) {
    const [rows] = await connection.execute<StoredObjectRow[]>(
      `SELECT
         id,
         sha256,
         byte_size AS byteSize,
         media_type AS mediaType,
         delete_state AS deleteState
       FROM stored_object
       WHERE workspace_id = ?
         AND id = ?
       LIMIT 1
       FOR SHARE`,
      [workspaceId, resource.storedObjectId],
    );
    const row = rows[0];
    if (!row || !skillResourceMatchesStoredObject(row, resource)) {
      fail(
        "publication.integrity_violation",
        "Skill resource does not match its immutable StoredObject.",
      );
    }
  }
  for (const entrypoint of document.workflowEntrypoints) {
    const [rows] = await connection.execute<WorkflowEntrypointRow[]>(
      `SELECT
         revision.id,
         revision.lifecycle_status AS lifecycleStatus,
         activation.runtime_status AS runtimeStatus
       FROM workflow_revision revision
       LEFT JOIN workflow_revision_activation activation
         ON activation.workspace_id = revision.workspace_id
        AND activation.workflow_revision_id = revision.id
       WHERE revision.workspace_id = ?
         AND revision.id = ?
       LIMIT 1
       FOR SHARE`,
      [workspaceId, entrypoint.workflowRevisionId],
    );
    const row = rows[0];
    if (
      !row ||
      !["published", "deprecated"].includes(row.lifecycleStatus) ||
      row.runtimeStatus === "revoked"
    ) {
      fail(
        "publication.lifecycle_conflict",
        "Skill entrypoint does not reference an available Workflow Revision.",
      );
    }
  }
}

export function skillResourceMatchesStoredObject(
  row: Pick<
    StoredObjectRow,
    "sha256" | "byteSize" | "mediaType" | "deleteState"
  >,
  resource: Pick<
    SkillPublicationDocumentV1["resources"][number],
    "contentDigest" | "byteSize" | "mediaType"
  >,
): boolean {
  return (
    row.deleteState === "active" &&
    `sha256:${row.sha256}` === resource.contentDigest &&
    String(row.byteSize) === String(resource.byteSize) &&
    row.mediaType.toLowerCase() === resource.mediaType
  );
}

export function createPublicationGovernanceStore(
  pool: Pool,
  validation: PublicationValidationPort,
): PublicationGovernanceStore {
  return Object.freeze({
    async getDraft(
      workspaceId: string,
      subjectKind: PublicationSubjectKind,
      draftId: string,
    ) {
      assertId(workspaceId, "workspaceId");
      assertId(draftId, "draftId");
      const connection = await pool.getConnection();
      try {
        return await readDraft(
          connection,
          workspaceId,
          subjectKind,
          draftId,
          "FOR SHARE",
        );
      } finally {
        connection.release();
      }
    },

    async getCandidate(workspaceId: string, candidateId: string) {
      assertId(workspaceId, "workspaceId");
      assertId(candidateId, "candidateId");
      const connection = await pool.getConnection();
      try {
        return await readCandidate(
          connection,
          workspaceId,
          candidateId,
          "FOR SHARE",
        );
      } finally {
        connection.release();
      }
    },

    async listCandidateChecks(workspaceId: string, candidateId: string) {
      assertId(workspaceId, "workspaceId");
      assertId(candidateId, "candidateId");
      const [rows] = await pool.execute<
        (RowDataPacket & { readonly checkKind: PublicationCheckKind })[]
      >(
        `SELECT check_kind AS checkKind
           FROM publication_check
          WHERE workspace_id = ? AND publication_candidate_id = ?
          ORDER BY check_kind`,
        [workspaceId, candidateId],
      );
      return Object.freeze(rows.map((row) => row.checkKind));
    },

    async listWorkflowCandidates(workspaceId: string, workflowKey?: string) {
      const [rows] = await pool.execute<CandidateRow[]>(
        `SELECT
           id,
           workspace_id AS workspaceId,
           subject_kind AS subjectKind,
           subject_key AS subjectKey,
           source_draft_id AS sourceDraftId,
           source_draft_version AS sourceDraftVersion,
           schema_version AS schemaVersion,
           content_document AS contentDocument,
           canonical_digest AS canonicalDigest,
           parser_profile_version AS parserProfileVersion,
           created_by_principal_id AS createdByPrincipalId,
           created_at AS createdAt
         FROM publication_candidate
         WHERE workspace_id = ?
           AND subject_kind = 'workflow'
           ${workflowKey ? "AND subject_key = ?" : ""}
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        workflowKey ? [workspaceId, workflowKey] : [workspaceId],
      );
      return Object.freeze(
        rows.map((row) => ({
          ...candidateFromRow(row),
          subjectKind: "workflow" as const,
        })),
      );
    },

    async getWorkflowCandidateReview(workspaceId: string, candidateId: string) {
      const connection = await pool.getConnection();
      try {
        const candidate = await readCandidate(
          connection,
          workspaceId,
          candidateId,
          "FOR SHARE",
        );
        if (!candidate || candidate.subjectKind !== "workflow") {
          return undefined;
        }
        const workflowCandidate: WorkflowPublicationCandidateRecord = {
          ...candidate,
          subjectKind: "workflow",
        };
        const [checkRows] = await connection.execute<
          (RowDataPacket & {
            readonly id: string;
            readonly checkKind: PublicationCheckKind;
            readonly checkProfileVersion: string;
            readonly outcome: "passed" | "failed";
            readonly evidenceSummary: unknown;
            readonly evidenceDigest: string;
            readonly checkedAt: Date;
          })[]
        >(
          `SELECT
             id,
             check_kind AS checkKind,
             check_profile_version AS checkProfileVersion,
             outcome,
             evidence_summary AS evidenceSummary,
             evidence_digest AS evidenceDigest,
             checked_at AS checkedAt
           FROM publication_check
           WHERE workspace_id = ?
             AND publication_candidate_id = ?
           ORDER BY check_kind`,
          [workspaceId, candidateId],
        );
        const [reviewRows] = await connection.execute<
          (RowDataPacket & {
            readonly id: string;
            readonly decision: "approved" | "rejected";
            readonly commentSummary: string | null;
            readonly reviewerPrincipalId: string;
            readonly decidedAt: Date;
          })[]
        >(
          `SELECT
             id,
             decision,
             comment_summary AS commentSummary,
             reviewer_principal_id AS reviewerPrincipalId,
             decided_at AS decidedAt
           FROM publication_review_decision
           WHERE workspace_id = ?
             AND publication_candidate_id = ?
           LIMIT 1`,
          [workspaceId, candidateId],
        );
        const [revisionRows] = await connection.execute<
          (RowDataPacket & {
            readonly id: string;
            readonly subjectKey: string;
            readonly revision: number;
            readonly canonicalDigest: string;
            readonly publishedAt: Date;
          })[]
        >(
          `SELECT
             revision.id,
             revision.workflow_key AS subjectKey,
             revision.revision,
             revision.canonical_digest AS canonicalDigest,
             publication.published_at AS publishedAt
           FROM workflow_revision_publication AS publication
           INNER JOIN workflow_revision AS revision
             ON revision.id = publication.workflow_revision_id
             AND revision.workspace_id = publication.workspace_id
           WHERE publication.workspace_id = ?
             AND publication.publication_candidate_id = ?
           LIMIT 1`,
          [workspaceId, candidateId],
        );
        const [testRunRows] = await connection.execute<
          (RowDataPacket & {
            readonly id: string;
            readonly lifecycleStatus: string;
          })[]
        >(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus
           FROM workflow_run
           WHERE workspace_id = ?
             AND definition_kind = 'publication_candidate'
             AND publication_candidate_id = ?
             AND non_production = TRUE
           ORDER BY created_at DESC, id DESC
           LIMIT 100`,
          [workspaceId, candidateId],
        );
        const review = reviewRows[0];
        const revision = revisionRows[0];
        const latestTestRun = testRunRows[0];
        const activeTestRunIds = testRunRows
          .filter((run) =>
            ["queued", "running", "waiting", "cancelling"].includes(
              run.lifecycleStatus,
            ),
          )
          .map((run) => run.id);
        return Object.freeze({
          candidate: workflowCandidate,
          ...(latestTestRun ? { latestTestRunId: latestTestRun.id } : {}),
          ...(activeTestRunIds.length > 0 ? { activeTestRunIds } : {}),
          checks: Object.freeze(
            checkRows.map((row) =>
              Object.freeze({
                id: row.id,
                checkKind: row.checkKind,
                checkProfileVersion: row.checkProfileVersion,
                outcome: row.outcome,
                evidenceSummary: parseJsonObject(
                  row.evidenceSummary,
                  "Publication Check evidence",
                ),
                evidenceDigest: row.evidenceDigest,
                checkedAt: row.checkedAt,
              }),
            ),
          ),
          ...(review
            ? {
                review: Object.freeze({
                  id: review.id,
                  decision: review.decision,
                  ...(review.commentSummary
                    ? {
                        commentSummary: review.commentSummary,
                      }
                    : {}),
                  reviewerPrincipalId: review.reviewerPrincipalId,
                  decidedAt: review.decidedAt,
                }),
              }
            : {}),
          ...(revision
            ? {
                publishedRevision: Object.freeze({
                  id: revision.id,
                  workspaceId,
                  subjectKind: "workflow" as const,
                  subjectKey: revision.subjectKey,
                  revision: revision.revision,
                  canonicalDigest: revision.canonicalDigest,
                  runtimeStatus: "enabled" as const,
                  publishedAt: revision.publishedAt,
                }),
              }
            : {}),
        });
      } finally {
        connection.release();
      }
    },

    async saveDraft(
      options: SavePublicationDraftOptions,
    ): Promise<PublicationDraftRecord> {
      validateCommonCommand(options);
      assertId(options.draftId, "draftId");
      assertKey(options.subjectKey, "subjectKey");
      if (
        options.expectedVersion !== 0 &&
        (!Number.isSafeInteger(options.expectedVersion) ||
          options.expectedVersion < 1)
      ) {
        invalid("expectedVersion must be zero or a positive safe integer.");
      }
      if (options.derivedFromRevisionId !== undefined) {
        assertId(options.derivedFromRevisionId, "derivedFromRevisionId");
      }
      const parsed = validateDocument(
        options.subjectKind,
        options.contentDocument,
      );
      const canonical = canonicalJson(parsed);
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const table = draftTable(options.subjectKind);
        const keyColumn = subjectKeyColumn(options.subjectKind);
        const sourceColumn = derivedColumn(options.subjectKind);
        if (options.expectedVersion === 0) {
          const definitionId =
            options.subjectKind === "workflow"
              ? await requireWorkflowDefinitionId(
                  connection,
                  options.workspaceId,
                  options.subjectKey,
                )
              : await ensureSkillDefinition(
                  connection,
                  options,
                  parsed as SkillPublicationDocumentV1,
                );
          const definitionColumn =
            options.subjectKind === "workflow"
              ? "workflow_definition_id"
              : "skill_definition_id";
          await connection.execute<ResultSetHeader>(
            `INSERT INTO ${table} (
               id,
               workspace_id,
               ${definitionColumn},
               ${keyColumn},
               schema_version,
               content_document,
               canonical_digest,
               lifecycle_status,
               ${sourceColumn},
               version,
               created_by_principal_id,
               updated_by_principal_id,
               created_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, 1, CAST(? AS JSON), ?, 'active', ?, 1, ?, ?, ?, ?)`,
            [
              options.draftId,
              options.workspaceId,
              definitionId,
              options.subjectKey,
              canonical.text,
              canonical.digest,
              options.derivedFromRevisionId ?? null,
              options.actorPrincipalId,
              options.actorPrincipalId,
              options.now,
              options.now,
            ],
          );
        } else {
          const existing = await readDraft(
            connection,
            options.workspaceId,
            options.subjectKind,
            options.draftId,
            "FOR UPDATE",
          );
          if (!existing) {
            fail("publication.not_found", "Publication Draft does not exist.");
          }
          if (
            existing.subjectKey !== options.subjectKey ||
            existing.derivedFromRevisionId !==
              (options.derivedFromRevisionId ?? null)
          ) {
            fail(
              "publication.identity_conflict",
              "Publication Draft identity cannot change.",
            );
          }
          if (
            existing.lifecycleStatus !== "active" ||
            existing.version !== options.expectedVersion
          ) {
            fail(
              "publication.version_conflict",
              "Publication Draft CAS or lifecycle check failed.",
            );
          }
          const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE ${table}
             SET schema_version = 1,
                 content_document = CAST(? AS JSON),
                 canonical_digest = ?,
                 version = version + 1,
                 updated_by_principal_id = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = 'active'`,
            [
              canonical.text,
              canonical.digest,
              options.actorPrincipalId,
              options.now,
              options.workspaceId,
              options.draftId,
              options.expectedVersion,
            ],
          );
          if (result.affectedRows !== 1) {
            fail(
              "publication.version_conflict",
              "Publication Draft update lost its CAS.",
            );
          }
        }
        const saved = await readDraft(
          connection,
          options.workspaceId,
          options.subjectKind,
          options.draftId,
          "FOR SHARE",
        );
        if (!saved) {
          fail(
            "publication.integrity_violation",
            "Saved Publication Draft cannot be read back.",
          );
        }
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.draft.saved",
          action: "publication.draft.save",
          resourceType: `${options.subjectKind}_draft`,
          resourceId: options.draftId,
          reasonCode: "publication.draft.saved",
          details: Object.freeze({
            subjectKind: options.subjectKind,
            subjectKey: options.subjectKey,
            version: saved.version,
            canonicalDigest: saved.canonicalDigest,
          }),
          occurredAt: options.now,
        });
        return saved;
      });
    },

    async archiveDraft(
      options: ArchivePublicationDraftOptions,
    ): Promise<PublicationDraftRecord> {
      validateCommonCommand(options);
      assertId(options.draftId, "draftId");
      assertPositiveVersion(options.expectedVersion, "expectedVersion");
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const existing = await readDraft(
          connection,
          options.workspaceId,
          options.subjectKind,
          options.draftId,
          "FOR UPDATE",
        );
        if (!existing) {
          fail("publication.not_found", "Publication Draft does not exist.");
        }
        if (
          existing.lifecycleStatus !== "active" ||
          existing.version !== options.expectedVersion
        ) {
          fail(
            "publication.version_conflict",
            "Publication Draft archive CAS failed.",
          );
        }
        const table = draftTable(options.subjectKind);
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE ${table}
           SET lifecycle_status = 'archived',
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status = 'active'`,
          [
            options.actorPrincipalId,
            options.now,
            options.workspaceId,
            options.draftId,
            options.expectedVersion,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "publication.version_conflict",
            "Publication Draft archive lost its CAS.",
          );
        }
        const archived = await readDraft(
          connection,
          options.workspaceId,
          options.subjectKind,
          options.draftId,
          "FOR SHARE",
        );
        if (!archived) {
          fail(
            "publication.integrity_violation",
            "Archived Publication Draft cannot be read back.",
          );
        }
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.draft.archived",
          action: "publication.draft.archive",
          resourceType: `${options.subjectKind}_draft`,
          resourceId: options.draftId,
          reasonCode: "publication.draft.archived",
          details: Object.freeze({
            subjectKind: options.subjectKind,
            version: archived.version,
          }),
          occurredAt: options.now,
        });
        return archived;
      });
    },

    async submitCandidate(
      options: SubmitPublicationCandidateOptions,
    ): Promise<PublicationCandidateRecord> {
      validateCommonCommand(options);
      assertId(options.candidateId, "candidateId");
      assertId(options.draftId, "draftId");
      assertPositiveVersion(
        options.expectedDraftVersion,
        "expectedDraftVersion",
      );
      assertProfile(options.parserProfileVersion, "parserProfileVersion");
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const existingCandidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR SHARE",
        );
        if (existingCandidate) {
          if (
            existingCandidate.sourceDraftId !== options.draftId ||
            existingCandidate.sourceDraftVersion !==
              options.expectedDraftVersion ||
            existingCandidate.subjectKind !== options.subjectKind ||
            existingCandidate.parserProfileVersion !==
              options.parserProfileVersion
          ) {
            fail(
              "publication.identity_conflict",
              "Candidate ID is already bound to another Draft snapshot.",
            );
          }
          return existingCandidate;
        }
        const draft = await readDraft(
          connection,
          options.workspaceId,
          options.subjectKind,
          options.draftId,
          "FOR UPDATE",
        );
        if (!draft) {
          fail("publication.not_found", "Publication Draft does not exist.");
        }
        if (
          draft.lifecycleStatus !== "active" ||
          draft.version !== options.expectedDraftVersion
        ) {
          fail(
            "publication.version_conflict",
            "Publication Draft changed before Candidate submission.",
          );
        }
        validateDocument(options.subjectKind, draft.contentDocument);
        const canonical = canonicalJson(draft.contentDocument);
        if (canonical.digest !== draft.canonicalDigest) {
          fail(
            "publication.integrity_violation",
            "Publication Draft digest changed before submission.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO publication_candidate (
             id,
             workspace_id,
             subject_kind,
             subject_key,
             source_draft_id,
             source_draft_version,
             schema_version,
             content_document,
             canonical_digest,
             parser_profile_version,
             created_by_principal_id,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, 1, CAST(? AS JSON), ?, ?, ?, ?)`,
          [
            options.candidateId,
            options.workspaceId,
            options.subjectKind,
            draft.subjectKey,
            draft.id,
            draft.version,
            canonical.text,
            canonical.digest,
            options.parserProfileVersion,
            options.actorPrincipalId,
            options.now,
          ],
        );
        const candidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR SHARE",
        );
        if (!candidate) {
          fail(
            "publication.integrity_violation",
            "Publication Candidate cannot be read back.",
          );
        }
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.candidate.submitted",
          action: "publication.candidate.submit",
          resourceType: "publication_candidate",
          resourceId: options.candidateId,
          reasonCode: "publication.candidate.submitted",
          details: Object.freeze({
            subjectKind: candidate.subjectKind,
            subjectKey: candidate.subjectKey,
            sourceDraftId: candidate.sourceDraftId,
            sourceDraftVersion: candidate.sourceDraftVersion,
            canonicalDigest: candidate.canonicalDigest,
            parserProfileVersion: candidate.parserProfileVersion,
          }),
          occurredAt: options.now,
        });
        return candidate;
      });
    },

    async recordCheck(options: RecordPublicationCheckOptions): Promise<void> {
      validateCommonCommand(options);
      assertId(options.checkId, "checkId");
      assertId(options.candidateId, "candidateId");
      assertDigest(options.expectedCandidateDigest, "expectedCandidateDigest");
      assertProfile(options.checkProfileVersion, "checkProfileVersion");
      if (!requiredCheckKinds.includes(options.checkKind)) {
        invalid("checkKind is not supported.");
      }
      const evidence = canonicalJson(options.evidenceSummary);
      await inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const candidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR SHARE",
        );
        if (!candidate) {
          fail(
            "publication.not_found",
            "Publication Candidate does not exist.",
          );
        }
        if (candidate.canonicalDigest !== options.expectedCandidateDigest) {
          fail(
            "publication.identity_conflict",
            "Publication Check targets another Candidate digest.",
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO publication_check (
             id,
             workspace_id,
             publication_candidate_id,
             check_kind,
             check_profile_version,
             outcome,
             evidence_summary,
             evidence_digest,
             checked_by_principal_id,
             checked_at
           )
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
          [
            options.checkId,
            options.workspaceId,
            options.candidateId,
            options.checkKind,
            options.checkProfileVersion,
            options.outcome,
            evidence.text,
            evidence.digest,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.check.recorded",
          action: "publication.check.record",
          resourceType: "publication_candidate",
          resourceId: options.candidateId,
          reasonCode: `publication.check.${options.outcome}`,
          details: Object.freeze({
            checkId: options.checkId,
            checkKind: options.checkKind,
            checkProfileVersion: options.checkProfileVersion,
            outcome: options.outcome,
            evidenceDigest: evidence.digest,
          }),
          occurredAt: options.now,
        });
      });
    },

    async reviewCandidate(
      options: ReviewPublicationCandidateOptions,
    ): Promise<void> {
      validateCommonCommand(options);
      assertId(options.reviewDecisionId, "reviewDecisionId");
      assertId(options.candidateId, "candidateId");
      assertDigest(options.expectedCandidateDigest, "expectedCandidateDigest");
      if (
        options.commentSummary !== undefined &&
        (options.commentSummary.length < 1 ||
          options.commentSummary.length > 1000)
      ) {
        invalid("commentSummary must contain between 1 and 1000 characters.");
      }
      await inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const candidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR SHARE",
        );
        if (!candidate) {
          fail(
            "publication.not_found",
            "Publication Candidate does not exist.",
          );
        }
        if (candidate.canonicalDigest !== options.expectedCandidateDigest) {
          fail(
            "publication.identity_conflict",
            "Review targets another Candidate digest.",
          );
        }
        if (options.decision === "approved") {
          await requirePublishGateChecksOnly(connection, candidate);
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO publication_review_decision (
             id,
             workspace_id,
             publication_candidate_id,
             decision,
             comment_summary,
             candidate_digest,
             reviewer_principal_id,
             decided_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.reviewDecisionId,
            options.workspaceId,
            options.candidateId,
            options.decision,
            options.commentSummary ?? null,
            options.expectedCandidateDigest,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.review.recorded",
          action: "publication.review.record",
          resourceType: "publication_candidate",
          resourceId: options.candidateId,
          reasonCode: `publication.review.${options.decision}`,
          details: Object.freeze({
            reviewDecisionId: options.reviewDecisionId,
            decision: options.decision,
            candidateDigest: options.expectedCandidateDigest,
            hasComment: options.commentSummary !== undefined,
          }),
          occurredAt: options.now,
        });
      });
    },

    async publishWorkflow(
      options: PublishWorkflowCandidateOptions,
    ): Promise<PublishedRevisionRecord> {
      validateCommonCommand(options);
      assertId(options.candidateId, "candidateId");
      assertId(options.workflowRevisionId, "workflowRevisionId");
      assertDigest(options.expectedCandidateDigest, "expectedCandidateDigest");
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const candidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR UPDATE",
        );
        if (!candidate || candidate.subjectKind !== "workflow") {
          fail(
            "publication.not_found",
            "Workflow Publication Candidate does not exist.",
          );
        }
        if (candidate.canonicalDigest !== options.expectedCandidateDigest) {
          fail(
            "publication.identity_conflict",
            "Workflow publish targets another Candidate digest.",
          );
        }
        const replay = await findPublishedWorkflowReplay(
          connection,
          options.workspaceId,
          options.candidateId,
        );
        if (replay) {
          return replayResult(
            "workflow",
            options.workspaceId,
            replay,
            options.workflowRevisionId,
            options.expectedCandidateDigest,
          );
        }
        const sourceDraft = await readDraft(
          connection,
          options.workspaceId,
          "workflow",
          candidate.sourceDraftId,
          "FOR UPDATE",
        );
        if (!sourceDraft) {
          fail(
            "publication.integrity_violation",
            "Workflow Candidate source Draft is missing.",
          );
        }
        const [definitionRows] = await connection.execute<
          (RowDataPacket & {
            readonly workflowDefinitionId: string | null;
          })[]
        >(
          `SELECT workflow_definition_id AS workflowDefinitionId
           FROM workflow_draft
           WHERE workspace_id = ?
             AND id = ?
           LIMIT 1`,
          [options.workspaceId, sourceDraft.id],
        );
        const workflowDefinitionId = definitionRows[0]?.workflowDefinitionId;
        if (!workflowDefinitionId) {
          fail(
            "publication.integrity_violation",
            "Workflow Candidate source Draft is not attached to a Workflow Definition.",
          );
        }
        await requirePublishGate(connection, candidate);
        const document = parseWorkflowPublicationDocument(
          candidate.contentDocument,
        );
        assertValidationPassed(validation.validateWorkflow(document));
        const revision = await nextRevision(
          connection,
          "workflow_revision",
          "workflow_key",
          options.workspaceId,
          candidate.subjectKey,
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_revision (
             id,
             workspace_id,
             workflow_definition_id,
             workflow_key,
             revision,
             lifecycle_status,
             canonical_digest,
             topology,
             input_schema,
             output_schema,
             presentation,
             created_at,
             published_at
           )
           VALUES (
             ?, ?, ?, ?, ?, 'published', ?,
             CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), ?, ?
           )`,
          [
            options.workflowRevisionId,
            options.workspaceId,
            workflowDefinitionId,
            candidate.subjectKey,
            revision,
            candidate.canonicalDigest,
            canonicalizeProviderValue(document.topology),
            canonicalizeProviderValue(document.inputSchema),
            canonicalizeProviderValue(document.outputSchema),
            document.presentation
              ? canonicalizeProviderValue(document.presentation)
              : null,
            candidate.createdAt,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_revision_publication (
             workflow_revision_id,
             workspace_id,
             publication_candidate_id,
             published_by_principal_id,
             published_at
           )
           VALUES (?, ?, ?, ?, ?)`,
          [
            options.workflowRevisionId,
            options.workspaceId,
            options.candidateId,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_revision_activation (
             workspace_id,
             workflow_revision_id,
             runtime_status,
             reason_code,
             version,
             updated_by_principal_id,
             updated_at
           )
           VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
          [
            options.workspaceId,
            options.workflowRevisionId,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "workflow.revision.published",
          action: "workflow.revision.publish",
          resourceType: "workflow_revision",
          resourceId: options.workflowRevisionId,
          reasonCode: "workflow.revision.published",
          details: Object.freeze({
            publicationCandidateId: options.candidateId,
            workflowKey: candidate.subjectKey,
            revision,
            canonicalDigest: candidate.canonicalDigest,
          }),
          occurredAt: options.now,
        });
        return Object.freeze({
          id: options.workflowRevisionId,
          workspaceId: options.workspaceId,
          subjectKind: "workflow",
          subjectKey: candidate.subjectKey,
          revision,
          canonicalDigest: candidate.canonicalDigest,
          runtimeStatus: "enabled",
          publishedAt: options.now,
        });
      });
    },

    async publishSkill(
      options: PublishSkillCandidateOptions,
    ): Promise<PublishedRevisionRecord> {
      validateCommonCommand(options);
      assertId(options.candidateId, "candidateId");
      assertId(options.skillRevisionId, "skillRevisionId");
      assertDigest(options.expectedCandidateDigest, "expectedCandidateDigest");
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const candidate = await readCandidate(
          connection,
          options.workspaceId,
          options.candidateId,
          "FOR UPDATE",
        );
        if (!candidate || candidate.subjectKind !== "skill") {
          fail(
            "publication.not_found",
            "Skill Publication Candidate does not exist.",
          );
        }
        if (candidate.canonicalDigest !== options.expectedCandidateDigest) {
          fail(
            "publication.identity_conflict",
            "Skill publish targets another Candidate digest.",
          );
        }
        const replay = await findPublishedSkillReplay(
          connection,
          options.workspaceId,
          options.candidateId,
        );
        if (replay) {
          return replayResult(
            "skill",
            options.workspaceId,
            replay,
            options.skillRevisionId,
            options.expectedCandidateDigest,
          );
        }
        const sourceDraft = await readDraft(
          connection,
          options.workspaceId,
          "skill",
          candidate.sourceDraftId,
          "FOR UPDATE",
        );
        if (!sourceDraft) {
          fail(
            "publication.integrity_violation",
            "Skill Candidate source Draft is missing.",
          );
        }
        if (!sourceDraft.skillDefinitionId) {
          fail(
            "publication.integrity_violation",
            "Skill Candidate source identity is missing.",
          );
        }
        // Skill publishing is permission-gated and requires trusted checks,
        // but it does not require a separate reviewer in V1.
        await requirePublishGateChecksOnly(connection, candidate);
        const document = parseSkillPublicationDocument(
          candidate.contentDocument,
        );
        assertValidationPassed(validation.validateSkill(document));
        await validateSkillReferences(
          connection,
          options.workspaceId,
          document,
        );
        const revision = await nextRevision(
          connection,
          "skill_revision",
          "skill_key",
          options.workspaceId,
          candidate.subjectKey,
        );
        const packageDigest = skillPackageDigest(document);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO skill_revision (
             id,
             workspace_id,
             skill_definition_id,
             skill_key,
             revision,
             lifecycle_status,
             publication_candidate_id,
             schema_version,
             manifest_document,
             canonical_digest,
             package_digest,
             parser_profile_version,
             created_by_principal_id,
             published_by_principal_id,
             created_at,
             published_at
           )
           VALUES (
             ?, ?, ?, ?, ?, 'published', ?, 1, CAST(? AS JSON),
             ?, ?, ?, ?, ?, ?, ?
           )`,
          [
            options.skillRevisionId,
            options.workspaceId,
            sourceDraft.skillDefinitionId,
            candidate.subjectKey,
            revision,
            options.candidateId,
            canonicalizeProviderValue(document.manifest),
            candidate.canonicalDigest,
            packageDigest,
            candidate.parserProfileVersion,
            candidate.createdByPrincipalId,
            options.actorPrincipalId,
            candidate.createdAt,
            options.now,
          ],
        );
        for (const [ordinal, resource] of document.resources.entries()) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO skill_revision_resource (
               skill_revision_id,
               workspace_id,
               resource_path,
               resource_kind,
               stored_object_id,
               content_digest,
               media_type,
               byte_size,
               ordinal
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              options.skillRevisionId,
              options.workspaceId,
              resource.path,
              resource.resourceKind,
              resource.storedObjectId,
              resource.contentDigest,
              resource.mediaType,
              resource.byteSize,
              ordinal,
            ],
          );
        }
        for (const [
          ordinal,
          entrypoint,
        ] of document.workflowEntrypoints.entries()) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO skill_revision_workflow_entrypoint (
               skill_revision_id,
               workspace_id,
               entrypoint_key,
               workflow_revision_id,
               ordinal
             )
             VALUES (?, ?, ?, ?, ?)`,
            [
              options.skillRevisionId,
              options.workspaceId,
              entrypoint.entrypointKey,
              entrypoint.workflowRevisionId,
              ordinal,
            ],
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO skill_revision_activation (
             workspace_id,
             skill_revision_id,
             runtime_status,
             reason_code,
             version,
             updated_by_principal_id,
             updated_at
           )
           VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
          [
            options.workspaceId,
            options.skillRevisionId,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "skill.revision.published",
          action: "skill.revision.publish",
          resourceType: "skill_revision",
          resourceId: options.skillRevisionId,
          reasonCode: "skill.revision.published",
          details: Object.freeze({
            publicationCandidateId: options.candidateId,
            skillKey: candidate.subjectKey,
            revision,
            canonicalDigest: candidate.canonicalDigest,
            packageDigest,
            resourceCount: document.resources.length,
            workflowEntrypointCount: document.workflowEntrypoints.length,
          }),
          occurredAt: options.now,
        });
        return Object.freeze({
          id: options.skillRevisionId,
          workspaceId: options.workspaceId,
          subjectKind: "skill",
          subjectKey: candidate.subjectKey,
          revision,
          canonicalDigest: candidate.canonicalDigest,
          runtimeStatus: "enabled",
          publishedAt: options.now,
        });
      });
    },

    async changeRuntimeStatus(
      options: ChangePublicationRuntimeStatusOptions,
    ): Promise<PublicationRuntimeStatusRecord> {
      validateCommonCommand(options);
      assertId(options.revisionId, "revisionId");
      assertPositiveVersion(options.expectedVersion, "expectedVersion");
      if (options.runtimeStatus === "revoked") {
        if (
          options.reasonCode === undefined ||
          !reasonPattern.test(options.reasonCode)
        ) {
          invalid("Revocation requires a stable reasonCode.");
        }
      } else if (
        options.reasonCode !== undefined &&
        !reasonPattern.test(options.reasonCode)
      ) {
        invalid("reasonCode does not use the stable code profile.");
      }
      return inTransaction(pool, async (connection) => {
        const organizationId = await requireOrganizationId(
          connection,
          options.workspaceId,
        );
        const table = activationTable(options.subjectKind);
        const revisionColumn = activationRevisionColumn(options.subjectKind);
        const [rows] = await connection.execute<ActivationRow[]>(
          `SELECT
             workspace_id AS workspaceId,
             ${revisionColumn} AS revisionId,
             runtime_status AS runtimeStatus,
             reason_code AS reasonCode,
             version,
             updated_at AS updatedAt
           FROM ${table}
           WHERE workspace_id = ?
             AND ${revisionColumn} = ?
           LIMIT 1
           FOR UPDATE`,
          [options.workspaceId, options.revisionId],
        );
        const existing = rows[0];
        if (!existing) {
          fail(
            "publication.not_found",
            "Published Revision activation does not exist.",
          );
        }
        if (existing.version !== options.expectedVersion) {
          fail(
            "publication.version_conflict",
            "Published Revision activation CAS failed.",
          );
        }
        if (
          existing.runtimeStatus === "revoked" &&
          options.runtimeStatus !== "revoked"
        ) {
          fail(
            "publication.lifecycle_conflict",
            "Revoked Revision cannot be re-enabled.",
          );
        }
        const nextVersion = existing.version + 1;
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE ${table}
           SET runtime_status = ?,
               reason_code = ?,
               version = ?,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND ${revisionColumn} = ?
             AND version = ?`,
          [
            options.runtimeStatus,
            options.reasonCode ?? null,
            nextVersion,
            options.actorPrincipalId,
            options.now,
            options.workspaceId,
            options.revisionId,
            options.expectedVersion,
          ],
        );
        if (result.affectedRows !== 1) {
          fail(
            "publication.version_conflict",
            "Published Revision activation update lost its CAS.",
          );
        }
        await appendAudit(connection, organizationId, options.audit, {
          workspaceId: options.workspaceId,
          eventType: "publication.runtime_status.changed",
          action: "publication.runtime_status.change",
          resourceType: `${options.subjectKind}_revision`,
          resourceId: options.revisionId,
          reasonCode: `publication.runtime_status.${options.runtimeStatus}`,
          details: Object.freeze({
            subjectKind: options.subjectKind,
            previousStatus: existing.runtimeStatus,
            runtimeStatus: options.runtimeStatus,
            reasonCode: options.reasonCode ?? null,
            version: nextVersion,
          }),
          occurredAt: options.now,
        });
        return Object.freeze({
          workspaceId: options.workspaceId,
          subjectKind: options.subjectKind,
          revisionId: options.revisionId,
          runtimeStatus: options.runtimeStatus,
          reasonCode: options.reasonCode ?? null,
          version: nextVersion,
          updatedAt: options.now,
        });
      });
    },
  });
}

async function requirePublishGateChecksOnly(
  connection: PoolConnection,
  candidate: PublicationCandidateRecord,
): Promise<void> {
  const [rows] = await connection.execute<CheckRow[]>(
    `SELECT
       check_kind AS checkKind,
       outcome
     FROM publication_check
     WHERE workspace_id = ?
       AND publication_candidate_id = ?
     FOR SHARE`,
    [candidate.workspaceId, candidate.id],
  );
  const outcomes = new Map(rows.map((row) => [row.checkKind, row.outcome]));
  const publishChecks =
    candidate.subjectKind === "skill"
      ? requiredCheckKinds.filter((kind) => kind !== "eval")
      : requiredCheckKinds;
  if (publishChecks.some((kind) => outcomes.get(kind) !== "passed")) {
    fail(
      "publication.checks_incomplete",
      "Candidate approval requires all Publication Checks to pass.",
    );
  }
}
