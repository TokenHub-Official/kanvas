import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { TaskRecordQuery, TaskRecordList } from "@kanvas/contracts/api";
import { queryTaskRecords } from "./task-record-query.js";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  AuthorizationStoreError,
  revalidateTrustedWorkspaceScopeInTransaction,
} from "./authorization-store.js";

export type OperationalTimelineSource =
  | "workflow_run"
  | "node_run"
  | "capability_run"
  | "capability_attempt"
  | "outbox_event"
  | "inbox_receipt"
  | "provider_invocation"
  | "provider_observation"
  | "usage_ledger"
  | "budget_reservation"
  | "budget_ledger"
  | "artifact_commit"
  | "audit_event";

export type OperationalTimelineFactValue = string | number | boolean | null;

export interface OperationalTimelineItem {
  readonly id: string;
  readonly source: OperationalTimelineSource;
  readonly kind: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly status?: string;
  readonly outcome?: string;
  readonly occurredAt: Date;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly facts: Readonly<Record<string, OperationalTimelineFactValue>>;
}

export interface OperationalTimeline {
  readonly workflowRunId: string;
  readonly generatedAt: Date;
  readonly items: readonly OperationalTimelineItem[];
  readonly truncated: boolean;
}

export interface GetOperationalTimelineOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly workflowRunId: string;
  readonly kind?: "workflow" | "capability";
  readonly now: Date;
  readonly limit?: number;
}

export type OperationalTimelineStoreErrorCode =
  | "operational_timeline.invalid_argument"
  | "operational_timeline.not_found"
  | "operational_timeline.forbidden";

export class OperationalTimelineStoreError extends Error {
  public constructor(
    readonly code: OperationalTimelineStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OperationalTimelineStoreError";
  }
}

export interface OperationalTimelineStore {
  list(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly query: TaskRecordQuery;
    readonly now: Date;
  }): Promise<TaskRecordList>;
  get(options: GetOperationalTimelineOptions): Promise<OperationalTimeline>;
}

interface TimelineRow extends RowDataPacket {
  readonly id: string;
  readonly source: OperationalTimelineSource;
  readonly kind: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly status: string | null;
  readonly outcome: string | null;
  readonly occurredAt: Date;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly facts: unknown;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const minimumLimit = 1;
const maximumLimit = 1_000;
const defaultLimit = 500;
const responseStructureKindPattern = "[unoasbifx]";
const responseStructureDiagnosticPattern = [
  `r-${responseStructureKindPattern}(?:`,
  `\\.c-${responseStructureKindPattern}`,
  `\\.d-${responseStructureKindPattern}`,
  `\\.e-${responseStructureKindPattern}`,
  `\\.m-${responseStructureKindPattern}`,
  `\\.t-${responseStructureKindPattern}`,
  `\\.s-${responseStructureKindPattern}`,
  "\\.x-[0-9])?",
  `|d-${responseStructureKindPattern}`,
  `\\.t-${responseStructureKindPattern}`,
  `\\.s-${responseStructureKindPattern}`,
  `\\.r-${responseStructureKindPattern}`,
  `\\.u-${responseStructureKindPattern}`,
  `\\.c-${responseStructureKindPattern}`,
  `\\.e-${responseStructureKindPattern}`,
  `\\.m-${responseStructureKindPattern}`,
  "\\.x-[0-9]",
].join("");
const providerResponseStructurePattern = new RegExp(
  `^(?:submit|query):error:[0-9]+:[0-9a-f]{64}:(${responseStructureDiagnosticPattern})(?::unqueryable)?$`,
  "u",
);

function fail(
  code: OperationalTimelineStoreErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new OperationalTimelineStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function validate(options: GetOperationalTimelineOptions): number {
  const limit = options.limit ?? defaultLimit;
  if (
    options.authority.trusted !== true ||
    !idPattern.test(options.workflowRunId) ||
    !validDate(options.now) ||
    !Number.isSafeInteger(limit) ||
    limit < minimumLimit ||
    limit > maximumLimit
  ) {
    return fail(
      "operational_timeline.invalid_argument",
      "Operational Timeline query is invalid.",
    );
  }
  return limit;
}

function parseFacts(
  value: unknown,
): Readonly<Record<string, OperationalTimelineFactValue>> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return fail(
        "operational_timeline.invalid_argument",
        "Operational Timeline facts are not valid JSON.",
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "operational_timeline.invalid_argument",
      "Operational Timeline facts are not a JSON object.",
    );
  }
  const facts: Record<string, OperationalTimelineFactValue> = {};
  for (const [key, candidate] of Object.entries(
    parsed as Readonly<Record<string, unknown>>,
  )) {
    if (
      candidate !== null &&
      typeof candidate !== "string" &&
      typeof candidate !== "number" &&
      typeof candidate !== "boolean"
    ) {
      return fail(
        "operational_timeline.invalid_argument",
        "Operational Timeline facts contain an unsupported value.",
      );
    }
    facts[key] = candidate;
  }
  return Object.freeze(facts);
}

export function projectProviderObservationFacts(
  facts: Readonly<Record<string, OperationalTimelineFactValue>>,
  resultFacts: unknown = facts.resultFacts,
): Readonly<Record<string, OperationalTimelineFactValue>> {
  const projected: Record<string, OperationalTimelineFactValue> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (key !== "observationKey" && key !== "resultFacts") {
      projected[key] = value;
    }
  }
  const observationKey = facts.observationKey;
  const responseStructure =
    typeof observationKey === "string"
      ? providerResponseStructurePattern.exec(observationKey)?.[1]
      : undefined;
  if (responseStructure) {
    projected.responseStructure = responseStructure;
  }
  try {
    const document: unknown =
      typeof resultFacts === "string" ? JSON.parse(resultFacts) : resultFacts;
    const evidence =
      document && typeof document === "object" && "resultEvidence" in document
        ? document.resultEvidence
        : undefined;
    const evidenceUrls =
      evidence &&
      typeof evidence === "object" &&
      "urls" in evidence &&
      Array.isArray(evidence.urls)
        ? evidence.urls
        : undefined;
    const legacyUrls =
      document &&
      typeof document === "object" &&
      "resultUrls" in document &&
      Array.isArray(document.resultUrls)
        ? document.resultUrls
        : undefined;
    const urls = evidenceUrls ?? legacyUrls;
    if (urls) {
      const origins = new Set<string>();
      let originsTruncated = urls.length > 32;
      for (const value of urls.slice(0, 32)) {
        if (typeof value !== "string") continue;
        try {
          const url = new URL(value);
          if (
            (url.protocol === "https:" || url.protocol === "http:") &&
            !url.username &&
            !url.password
          ) {
            if (origins.has(url.origin)) continue;
            if ([...origins, url.origin].join(", ").length <= 1024)
              origins.add(url.origin);
            else originsTruncated = true;
          }
        } catch {
          /* Historical malformed URLs are not diagnostics. */
        }
      }
      projected.resultCount = urls.length;
      if (
        evidence &&
        typeof evidence === "object" &&
        "totalCount" in evidence &&
        typeof evidence.totalCount === "number" &&
        Number.isSafeInteger(evidence.totalCount) &&
        evidence.totalCount >= urls.length
      ) {
        projected.resultCount = evidence.totalCount;
        projected.resultEvidenceOmitted = evidence.totalCount - urls.length;
        originsTruncated ||= evidence.totalCount > urls.length;
      }
      if (origins.size) projected.resultOrigins = [...origins].join(", ");
      if (originsTruncated) projected.resultOriginsTruncated = true;
    }
  } catch {
    /* Legacy records without valid result facts remain readable. */
  }
  return Object.freeze(projected);
}

function toItem(row: TimelineRow): OperationalTimelineItem {
  if (!validDate(row.occurredAt)) {
    return fail(
      "operational_timeline.invalid_argument",
      "Operational Timeline contains an invalid timestamp.",
    );
  }
  const facts = parseFacts(row.facts);
  return Object.freeze({
    id: row.id,
    source: row.source,
    kind: row.kind,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ...(row.status ? { status: row.status } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    occurredAt: row.occurredAt,
    ...(row.requestId ? { requestId: row.requestId } : {}),
    ...(row.traceId ? { traceId: row.traceId } : {}),
    facts:
      row.source === "provider_observation"
        ? projectProviderObservationFacts(facts)
        : facts,
  });
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

const timelineQuery = `
WITH
selected_scope AS (SELECT ? AS workspace_id, ? AS id, ? AS kind),
selected_run AS (
  SELECT run.id, run.workspace_id FROM workflow_run run
  JOIN selected_scope scope ON scope.workspace_id = run.workspace_id AND scope.id = run.id AND scope.kind = 'workflow'
),
run_nodes AS (
  SELECT node.*
  FROM node_run AS node
  INNER JOIN selected_run AS run
    ON run.workspace_id = node.workspace_id
   AND run.id = node.workflow_run_id
),
run_capabilities AS (
  SELECT capability.*
  FROM capability_run AS capability
  INNER JOIN selected_scope scope ON scope.workspace_id = capability.workspace_id
  WHERE capability.node_run_id IN (SELECT id FROM run_nodes)
    OR (scope.kind = 'capability' AND scope.id = capability.id)
),
run_attempts AS (
  SELECT attempt.*
  FROM capability_attempt AS attempt
  INNER JOIN run_capabilities AS capability
    ON capability.workspace_id = attempt.workspace_id
   AND capability.id = attempt.capability_run_id
),
run_outbox AS (
  SELECT event.*
  FROM outbox_event AS event
  INNER JOIN selected_scope AS run
    ON run.workspace_id = event.workspace_id
   AND (
     (
       event.aggregate_type = CONCAT(run.kind, '_run')
       AND event.aggregate_id = run.id
     )
     OR JSON_UNQUOTE(
       JSON_EXTRACT(event.payload, '$.workflowRunId')
     ) IN (SELECT id FROM selected_run)
     OR event.aggregate_id IN (SELECT id FROM run_attempts)
     OR JSON_UNQUOTE(JSON_EXTRACT(event.payload, '$.capabilityRunId')) IN (SELECT id FROM run_capabilities)
   )
),
run_artifacts AS (
  SELECT
    output.id AS output_id,
    output.output_role,
    output.output_index,
    output.created_at AS output_created_at,
    artifact.id AS artifact_id,
    artifact.stored_object_id,
    artifact.artifact_type,
    artifact.availability_status,
    artifact.data_classification,
    object_record.byte_size,
    object_record.media_type,
    object_record.delete_state,
    attempt.id AS attempt_id
  FROM attempt_output AS output
  INNER JOIN run_attempts AS attempt
    ON attempt.workspace_id = output.workspace_id
   AND attempt.id = output.capability_attempt_id
  INNER JOIN artifact
    ON artifact.workspace_id = output.workspace_id
   AND artifact.id = output.artifact_id
  LEFT JOIN stored_object AS object_record
    ON object_record.workspace_id = artifact.workspace_id
   AND object_record.id = artifact.stored_object_id
),
run_resources AS (
  SELECT 'workflow_run' AS resource_type, id
  FROM selected_run
  UNION ALL
  SELECT 'node_run', id FROM run_nodes
  UNION ALL
  SELECT 'capability_run', id FROM run_capabilities
  UNION ALL
  SELECT 'capability_attempt', id FROM run_attempts
  UNION ALL
  SELECT 'artifact', artifact_id FROM run_artifacts
)
SELECT *
FROM (
  SELECT
    run.id AS id,
    'workflow_run' AS source,
    'workflow.snapshot' AS kind,
    'workflow_run' AS resourceType,
    run.id AS resourceId,
    run.lifecycle_status AS status,
    run.outcome,
    run.updated_at AS occurredAt,
    NULL AS requestId,
    NULL AS traceId,
    JSON_OBJECT(
      'version', run.version,
      'workflowRevisionId', run.workflow_revision_id,
      'createdAt', DATE_FORMAT(run.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
      'completedAt', IF(
        run.completed_at IS NULL,
        NULL,
        DATE_FORMAT(run.completed_at, '%Y-%m-%dT%H:%i:%s.%fZ')
      ),
      'cancelReasonCode', run.cancel_reason_code
    ) AS facts
  FROM workflow_run AS run
  INNER JOIN selected_run AS selected
    ON selected.workspace_id = run.workspace_id
   AND selected.id = run.id

  UNION ALL

  SELECT
    node.id,
    'node_run',
    'node.snapshot',
    'node_run',
    node.id,
    node.lifecycle_status,
    NULL,
    node.updated_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'version', node.version,
      'nodeKey', node.node_key,
      'scopeKey', node.scope_key,
      'nodeKind', node.kind,
      'waitingReason', node.waiting_reason
    )
  FROM run_nodes AS node

  UNION ALL

  SELECT
    capability.id,
    'capability_run',
    'capability.snapshot',
    'capability_run',
    capability.id,
    capability.lifecycle_status,
    NULL,
    capability.updated_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'version', capability.version,
      'nodeRunId', capability.node_run_id,
      'implementationRevisionId',
        capability.implementation_revision_id,
      'currentAttemptId', capability.current_attempt_id,
      'acceptedAttemptId', capability.accepted_attempt_id,
      'createdAt', DATE_FORMAT(capability.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
      'invocationKind', capability.invocation_kind,
      'invocationReferenceId', capability.invocation_reference_id
    )
  FROM run_capabilities AS capability

  UNION ALL

  SELECT
    attempt.id,
    'capability_attempt',
    'attempt.snapshot',
    'capability_attempt',
    attempt.id,
    attempt.lifecycle_status,
    attempt.retry_disposition,
    attempt.updated_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'version', attempt.version,
      'capabilityRunId', attempt.capability_run_id,
      'attemptNumber', attempt.attempt_number,
      'executionTarget', attempt.execution_target,
      'transitionKind', attempt.transition_kind,
      'transitionReasonCode', attempt.transition_reason_code,
      'sideEffectState', attempt.side_effect_state,
      'leaseGeneration', attempt.lease_generation,
      'errorCode', JSON_UNQUOTE(JSON_EXTRACT(attempt.error, '$.code')),
      'providerRequestId', JSON_UNQUOTE(JSON_EXTRACT(attempt.error, '$.upstream.requestId'))
    )
  FROM run_attempts AS attempt

  UNION ALL

  SELECT
    event.id,
    'outbox_event',
    event.message_type,
    event.aggregate_type,
    event.aggregate_id,
    event.status,
    event.last_error_code,
    event.created_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'schemaVersion', event.schema_version,
      'aggregateVersion', event.aggregate_version,
      'publishAttempts', event.publish_attempts,
      'publishedAt', IF(
        event.published_at IS NULL,
        NULL,
        DATE_FORMAT(event.published_at, '%Y-%m-%dT%H:%i:%s.%fZ')
      )
    )
  FROM run_outbox AS event

  UNION ALL

  SELECT
    CONCAT(receipt.consumer_name, ':', receipt.event_id),
    'inbox_receipt',
    receipt.message_type,
    receipt.aggregate_type,
    receipt.aggregate_id,
    receipt.effect_outcome,
    receipt.result_code,
    receipt.processed_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'consumerName', receipt.consumer_name,
      'eventId', receipt.event_id,
      'schemaVersion', receipt.schema_version,
      'aggregateVersion', receipt.aggregate_version,
      'expectedGeneration', receipt.expected_generation
    )
  FROM inbox_receipt AS receipt
  INNER JOIN run_outbox AS event
    ON event.workspace_id = receipt.workspace_id
   AND event.id = receipt.event_id

  UNION ALL

  SELECT
    invocation.id,
    'provider_invocation',
    'provider.invocation.snapshot',
    'provider_invocation',
    invocation.id,
    invocation.remote_status,
    invocation.side_effect_state,
    invocation.updated_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'attemptId', invocation.capability_attempt_id,
      'providerKey', invocation.provider_key,
      'apiSurface', invocation.api_surface,
      'providerRequestId', invocation.provider_request_id,
      'workState', invocation.work_state,
      'submissionAttempts', invocation.submission_attempts,
      'queryAttempts', invocation.query_attempts,
      'cancelAttempts', invocation.cancel_attempts,
      'version', invocation.version
    )
  FROM provider_invocation AS invocation
  INNER JOIN run_attempts AS attempt
    ON attempt.workspace_id = invocation.workspace_id
   AND attempt.id = invocation.capability_attempt_id

  UNION ALL

  SELECT
    observation.id,
    'provider_observation',
    CONCAT('provider.', observation.operation_kind, '.observed'),
    'provider_invocation',
    observation.provider_invocation_id,
    observation.normalized_status,
    observation.stable_error_code,
    observation.recorded_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'source', observation.source,
      'adoptionOutcome', observation.adoption_outcome,
      'executionGeneration', observation.execution_generation,
      'observationKey', observation.observation_key,
      'resultFacts', CAST(observation.result_facts AS CHAR),
      'observedAt',
        DATE_FORMAT(observation.observed_at, '%Y-%m-%dT%H:%i:%s.%fZ')
    )
  FROM provider_invocation_observation AS observation
  INNER JOIN provider_invocation AS invocation
    ON invocation.workspace_id = observation.workspace_id
   AND invocation.id = observation.provider_invocation_id
  INNER JOIN run_attempts AS attempt
    ON attempt.workspace_id = invocation.workspace_id
   AND attempt.id = invocation.capability_attempt_id

  UNION ALL

  SELECT
    decision.id,
    'provider_observation',
    'provider.result_policy.checked',
    'provider_invocation',
    decision.provider_invocation_id,
    IF(decision.outcome = 'allowed', 'succeeded', 'failed'),
    decision.outcome,
    decision.occurred_at,
    NULL,
    NULL,
    JSON_OBJECT('policyVersion', decision.policy_version, 'policySource', decision.source, 'resultOrigin', decision.origin)
  FROM provider_result_policy_decision AS decision
  INNER JOIN provider_invocation AS invocation
    ON invocation.workspace_id = decision.workspace_id AND invocation.id = decision.provider_invocation_id
  INNER JOIN run_attempts AS attempt
    ON attempt.workspace_id = invocation.workspace_id AND attempt.id = invocation.capability_attempt_id

  UNION ALL

  SELECT
    usage_entry.id,
    'usage_ledger',
    'usage.recorded',
    'capability_attempt',
    usage_entry.capability_attempt_id,
    usage_entry.entry_kind,
    NULL,
    usage_entry.recorded_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'metricKey', usage_entry.metric_key,
      'valueDimension', usage_entry.value_dimension,
      'numericValue', CAST(usage_entry.numeric_value AS CHAR),
      'unitCode', usage_entry.unit_code,
      'currencyCode', usage_entry.currency_code,
      'recordingPhase', usage_entry.recording_phase,
      'sourceKind', usage_entry.source_kind,
      'observedAt',
        DATE_FORMAT(usage_entry.observed_at, '%Y-%m-%dT%H:%i:%s.%fZ')
    )
  FROM usage_ledger_entry AS usage_entry
  INNER JOIN run_attempts AS attempt
    ON attempt.workspace_id = usage_entry.workspace_id
   AND attempt.id = usage_entry.capability_attempt_id

  UNION ALL

  SELECT
    reservation.id,
    'budget_reservation',
    'budget.reservation.snapshot',
    'budget_reservation',
    reservation.id,
    reservation.lifecycle_status,
    NULL,
    reservation.updated_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'capabilityRunId', reservation.capability_run_id,
      'attemptId', reservation.capability_attempt_id,
      'currencyCode', reservation.currency_code,
      'reservedAmount', CAST(reservation.reserved_amount AS CHAR),
      'settledAmount', CAST(reservation.settled_amount AS CHAR),
      'unknownHoldAmount',
        CAST(reservation.unknown_hold_amount AS CHAR),
      'version', reservation.version
    )
  FROM budget_reservation AS reservation
  INNER JOIN selected_scope AS run
    ON run.workspace_id = reservation.workspace_id
   AND (
     (run.kind = 'workflow' AND reservation.workflow_run_id = run.id)
     OR reservation.capability_run_id IN (SELECT id FROM run_capabilities)
     OR reservation.capability_attempt_id IN (
       SELECT id FROM run_attempts
     )
   )

  UNION ALL

  SELECT
    ledger.id,
    'budget_ledger',
    CONCAT('budget.', ledger.entry_kind),
    'budget_reservation',
    reservation.id,
    ledger.entry_kind,
    NULL,
    ledger.recorded_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'currencyCode', ledger.currency_code,
      'reservedDelta', CAST(ledger.reserved_delta AS CHAR),
      'consumedDelta', CAST(ledger.consumed_delta AS CHAR),
      'unknownHeldDelta',
        CAST(ledger.unknown_held_delta AS CHAR),
      'occurredAt',
        DATE_FORMAT(ledger.occurred_at, '%Y-%m-%dT%H:%i:%s.%fZ')
    )
  FROM budget_ledger_entry AS ledger
  INNER JOIN budget_reservation AS reservation
    ON reservation.workspace_id = ledger.workspace_id
   AND reservation.id = ledger.budget_reservation_id
  INNER JOIN selected_scope AS run
    ON run.workspace_id = reservation.workspace_id
   AND (
     (run.kind = 'workflow' AND reservation.workflow_run_id = run.id)
     OR reservation.capability_run_id IN (SELECT id FROM run_capabilities)
     OR reservation.capability_attempt_id IN (
       SELECT id FROM run_attempts
     )
   )

  UNION ALL

  SELECT
    artifact.output_id,
    'artifact_commit',
    'artifact.committed',
    'artifact',
    artifact.artifact_id,
    artifact.availability_status,
    artifact.delete_state,
    artifact.output_created_at,
    NULL,
    NULL,
    JSON_OBJECT(
      'attemptId', artifact.attempt_id,
      'storedObjectId', artifact.stored_object_id,
      'outputRole', artifact.output_role,
      'outputIndex', artifact.output_index,
      'artifactType', artifact.artifact_type,
      'dataClassification', artifact.data_classification,
      'byteSize', CAST(artifact.byte_size AS CHAR),
      'mediaType', artifact.media_type
    )
  FROM run_artifacts AS artifact

  UNION ALL

  SELECT
    audit.id,
    'audit_event',
    audit.event_type,
    audit.resource_type,
    COALESCE(audit.resource_id, audit.id),
    audit.outcome,
    audit.decision_reason_code,
    audit.occurred_at,
    audit.request_id,
    audit.trace_id,
    JSON_OBJECT(
      'action', audit.action,
      'actorType', audit.actor_type,
      'severity', audit.severity,
      'recordedAt',
        DATE_FORMAT(audit.recorded_at, '%Y-%m-%dT%H:%i:%s.%fZ')
    )
  FROM audit_event AS audit
  INNER JOIN run_resources AS resource
    ON resource.resource_type = audit.resource_type
   AND resource.id = audit.resource_id
  INNER JOIN selected_scope AS run
    ON run.workspace_id = audit.workspace_id
) AS timeline
ORDER BY occurredAt DESC, source DESC, id DESC
LIMIT ?`;

export function createOperationalTimelineStore(
  pool: Pool,
): OperationalTimelineStore {
  return Object.freeze<OperationalTimelineStore>({
    async list(options) {
      const { query } = options;
      if (
        !validDate(options.now) ||
        (query.from && !Number.isFinite(Date.parse(query.from))) ||
        (query.to && !Number.isFinite(Date.parse(query.to))) ||
        (query.from &&
          query.to &&
          Date.parse(query.from) > Date.parse(query.to)) ||
        (query.limit !== undefined &&
          (!Number.isInteger(Number(query.limit)) ||
            Number(query.limit) < 1 ||
            Number(query.limit) > 100))
      ) {
        return fail(
          "operational_timeline.invalid_argument",
          "Task record query is invalid.",
        );
      }
      try {
        return await inTransaction(pool, async (connection) => {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            options.authority,
            "audit.read",
            options.now,
          );
          return queryTaskRecords(
            connection,
            options.authority.workspaceId,
            query,
          );
        });
      } catch (error) {
        if (error instanceof AuthorizationStoreError)
          return fail(
            "operational_timeline.forbidden",
            "Task record authorization is no longer valid.",
            error,
          );
        if (error instanceof SyntaxError || error instanceof TypeError)
          return fail(
            "operational_timeline.invalid_argument",
            "Task record cursor is invalid.",
            error,
          );
        throw error;
      }
    },
    async get(options) {
      const limit = validate(options);
      try {
        return await inTransaction(pool, async (connection) => {
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            options.authority,
            "audit.read",
            options.now,
          );
          const [exists] = await connection.execute<RowDataPacket[]>(
            `SELECT id
             FROM ${options.kind === "capability" ? "capability_run" : "workflow_run"}
             WHERE workspace_id = ? AND id = ?
             LIMIT 1`,
            [options.authority.workspaceId, options.workflowRunId],
          );
          if (!exists[0]) {
            return fail(
              "operational_timeline.not_found",
              "Workflow Run was not found.",
            );
          }
          const [rows] = await connection.query<TimelineRow[]>(timelineQuery, [
            options.authority.workspaceId,
            options.workflowRunId,
            options.kind ?? "workflow",
            limit + 1,
          ]);
          return Object.freeze({
            workflowRunId: options.workflowRunId,
            generatedAt: options.now,
            items: Object.freeze(rows.slice(0, limit).reverse().map(toItem)),
            truncated: rows.length > limit,
          });
        });
      } catch (error) {
        if (error instanceof OperationalTimelineStoreError) {
          throw error;
        }
        if (error instanceof AuthorizationStoreError) {
          return fail(
            "operational_timeline.forbidden",
            "Operational Timeline authorization is no longer valid.",
            error,
          );
        }
        throw error;
      }
    },
  });
}
