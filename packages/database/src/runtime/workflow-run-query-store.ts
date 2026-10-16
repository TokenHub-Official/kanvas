import type {
  WorkflowApprovalDecisionContextRecord,
  WorkflowApprovalQueryRepository,
  WorkflowRunQueryRepository,
  WorkflowRunSummaryView,
  WorkflowRunView,
} from "@kanvas/application";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { parseExecutionPlan } from "./execution-plan.js";
import { digestProviderValue } from "./provider-value-digest.js";

interface WorkflowRunViewRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly definitionKind: WorkflowRunView["definitionKind"];
  readonly workflowRevisionId: string | null;
  readonly publicationCandidateId: string | null;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly nonProduction: number | boolean;
  readonly lifecycleStatus: WorkflowRunView["lifecycleStatus"];
  readonly outcome: WorkflowRunView["outcome"];
  readonly version: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly executionPlanSnapshot: unknown;
  readonly executionPlanHash: string;
  readonly executionDeadlineAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelReasonCode: WorkflowRunView["cancelReasonCode"] | null;
  readonly cancelDeadlineAt: Date | null;
}

interface WorkflowApprovalViewRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly nodeKey: string;
  readonly requestPayload: unknown;
  readonly decisionSchema: unknown;
  readonly authorizationContextDigest: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly lifecycleStatus: WorkflowApprovalDecisionContextRecord["lifecycleStatus"];
}

interface WorkflowNodeRunViewRow extends RowDataPacket {
  readonly id: string;
  readonly nodeKey: string;
  readonly scopeKey: string;
  readonly kind: "invoke" | "switch" | "map" | "approval";
  readonly lifecycleStatus: string;
  readonly waitingReason: string | null;
  readonly output: unknown;
  readonly error: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

interface WorkflowRunSummaryRow extends RowDataPacket {
  readonly id: string;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly workflowRevisionId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly lifecycleStatus: WorkflowRunSummaryView["lifecycleStatus"];
  readonly outcome: WorkflowRunSummaryView["outcome"];
  readonly output: unknown;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const parsed = parseJson(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function boundedText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
    ? value.trim()
    : undefined;
}

function approvalContextFromRow(
  row: WorkflowApprovalViewRow,
): WorkflowApprovalDecisionContextRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    workflowRunId: row.workflowRunId,
    nodeRunId: row.nodeRunId,
    nodeKey: row.nodeKey,
    requestPayload: parseJson(row.requestPayload),
    decisionSchema: record(row.decisionSchema, "Approval decision schema"),
    authorizationContextDigest: row.authorizationContextDigest,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lifecycleStatus: row.lifecycleStatus,
  });
}

function browserExecutionFromPlan(
  value: unknown,
  expectedHash: string,
): WorkflowRunView["browserExecution"] {
  const snapshot = parseJson(value);
  if (digestProviderValue(snapshot) !== expectedHash) {
    throw new Error(
      "Workflow execution plan identity does not match its snapshot.",
    );
  }
  const plan = parseExecutionPlan(snapshot);
  const requiredCapabilityKeys = [
    ...new Set(
      plan.routes.flatMap((route) =>
        route.candidates.some(
          (candidate) => candidate.executionTarget === "browser",
        )
          ? [route.contractKey]
          : [],
      ),
    ),
  ];
  return requiredCapabilityKeys.length > 0
    ? Object.freeze({
        requiredCapabilityKeys: Object.freeze(requiredCapabilityKeys),
      })
    : undefined;
}

function mapBrand(row: {
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
}): WorkflowRunView["brand"] {
  if (
    !row.brandKitRevisionId ||
    !row.brandKitId ||
    !row.brandName ||
    row.brandRevisionNumber === null
  ) {
    return undefined;
  }
  return Object.freeze({
    brandKitId: row.brandKitId,
    brandKitRevisionId: row.brandKitRevisionId,
    name: row.brandName,
    revisionNumber: Number(row.brandRevisionNumber),
  });
}

export function createWorkflowRunQueryStore(
  pool: Pool,
): WorkflowRunQueryRepository & WorkflowApprovalQueryRepository {
  return Object.freeze<
    WorkflowRunQueryRepository & WorkflowApprovalQueryRepository
  >({
    async listForActor(query) {
      const limit = Math.min(40, Math.max(1, Math.trunc(query.limit)));
      const conditions = [
        "run.workspace_id = ?",
        "run.created_by = ?",
        "run.definition_kind = 'published_revision'",
        "run.non_production = FALSE",
      ];
      const parameters: Array<string | number | Date> = [
        query.workspaceId,
        query.actorId,
      ];
      if (query.workflowRevisionId) {
        conditions.push("run.workflow_revision_id = ?");
        parameters.push(query.workflowRevisionId);
      }
      if (query.state === "active") {
        conditions.push(
          "run.lifecycle_status IN ('queued', 'running', 'waiting', 'cancelling')",
        );
      } else if (query.state === "completed") {
        conditions.push("run.lifecycle_status = 'completed'");
        conditions.push("run.outcome IN ('full_success', 'partial_success')");
      } else if (query.state === "unfinished") {
        conditions.push(
          "(run.lifecycle_status IN ('failed', 'cancelled') OR (run.lifecycle_status = 'completed' AND run.outcome = 'no_usable_output'))",
        );
      }
      if (query.cursor) {
        conditions.push(
          "(run.created_at < ? OR (run.created_at = ? AND run.id < ?))",
        );
        parameters.push(
          query.cursor.createdAt,
          query.cursor.createdAt,
          query.cursor.id,
        );
      }
      const [rows] = await pool.execute<WorkflowRunSummaryRow[]>(
        `SELECT
           run.id,
           run.brand_kit_revision_id AS brandKitRevisionId,
           brand_revision.brand_kit_id AS brandKitId,
           JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
           brand_revision.revision_number AS brandRevisionNumber,
           run.workflow_revision_id AS workflowRevisionId,
           COALESCE(definition.display_name, revision.workflow_key) AS displayName,
           definition.description,
           run.lifecycle_status AS lifecycleStatus,
           run.outcome,
           run.output,
           run.created_at AS createdAt,
           run.completed_at AS completedAt
         FROM workflow_run AS run
         INNER JOIN workflow_revision AS revision
           ON revision.workspace_id = run.workspace_id
          AND revision.id = run.workflow_revision_id
         LEFT JOIN workflow_definition AS definition
           ON definition.workspace_id = revision.workspace_id
          AND definition.id = revision.workflow_definition_id
         LEFT JOIN brand_kit_revision AS brand_revision
           ON brand_revision.workspace_id = run.workspace_id
          AND brand_revision.id = run.brand_kit_revision_id
         WHERE ${conditions.join("\n           AND ")}
         ORDER BY run.created_at DESC, run.id DESC
         LIMIT ${String(limit + 1)}`,
        parameters,
      );
      const visibleRows = rows.slice(0, limit);
      const last = visibleRows.at(-1);
      return Object.freeze({
        items: Object.freeze(
          visibleRows.map((row) => {
            const brand = mapBrand(row);
            return Object.freeze({
              id: row.id,
              ...(brand ? { brand } : {}),
              workflowRevisionId: row.workflowRevisionId,
              displayName: row.displayName,
              ...(row.description ? { description: row.description } : {}),
              lifecycleStatus: row.lifecycleStatus,
              outcome: row.outcome,
              output: row.output === null ? null : parseJson(row.output),
              createdAt: row.createdAt,
              ...(row.completedAt ? { completedAt: row.completedAt } : {}),
            });
          }),
        ),
        ...(rows.length > limit && last
          ? {
              nextCursor: Object.freeze({
                createdAt: last.createdAt,
                id: last.id,
              }),
            }
          : {}),
      });
    },
    async findById(workspaceId, workflowRunId, actorId) {
      const [rows] = await pool.execute<WorkflowRunViewRow[]>(
        `SELECT
           run.id,
           run.workspace_id AS workspaceId,
           run.definition_kind AS definitionKind,
           run.workflow_revision_id AS workflowRevisionId,
           run.publication_candidate_id AS publicationCandidateId,
           run.brand_kit_revision_id AS brandKitRevisionId,
           brand_revision.brand_kit_id AS brandKitId,
           JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
           brand_revision.revision_number AS brandRevisionNumber,
           run.non_production AS nonProduction,
           run.lifecycle_status AS lifecycleStatus,
           run.outcome,
           run.version,
           run.input,
           run.output,
           run.execution_plan_snapshot AS executionPlanSnapshot,
           run.execution_plan_hash AS executionPlanHash,
           run.execution_deadline_at AS executionDeadlineAt,
           run.created_at AS createdAt,
           run.updated_at AS updatedAt,
           run.completed_at AS completedAt,
           run.cancel_requested_at AS cancelRequestedAt,
           run.cancel_reason_code AS cancelReasonCode,
           run.cancel_deadline_at AS cancelDeadlineAt
         FROM workflow_run AS run
         LEFT JOIN brand_kit_revision AS brand_revision
           ON brand_revision.workspace_id = run.workspace_id
          AND brand_revision.id = run.brand_kit_revision_id
         WHERE run.id = ?
           AND run.workspace_id = ?
           ${actorId ? "AND (run.idempotency_key NOT LIKE 'agent-workflow:%' OR run.created_by = ?)" : ""}
         LIMIT 1`,
        [workflowRunId, workspaceId, ...(actorId ? [actorId] : [])],
      );
      const row = rows[0];
      if (!row) {
        return undefined;
      }
      const brand = mapBrand(row);
      const [nodeResult, approvalResult] = await Promise.all([
        pool.execute<WorkflowNodeRunViewRow[]>(
          `SELECT
             id,
             node_key AS nodeKey,
             scope_key AS scopeKey,
             kind,
             lifecycle_status AS lifecycleStatus,
             waiting_reason AS waitingReason,
             output,
             error,
             created_at AS createdAt,
             updated_at AS updatedAt,
             completed_at AS completedAt
           FROM node_run
           WHERE workspace_id = ?
             AND workflow_run_id = ?
           ORDER BY created_at, id`,
          [workspaceId, workflowRunId],
        ),
        pool.execute<WorkflowApprovalViewRow[]>(
          `SELECT
             request.id,
             request.workspace_id AS workspaceId,
             request.workflow_run_id AS workflowRunId,
             request.node_run_id AS nodeRunId,
             node.node_key AS nodeKey,
             request.request_payload AS requestPayload,
             request.decision_schema AS decisionSchema,
             request.authorization_context_digest AS authorizationContextDigest,
             request.expires_at AS expiresAt,
             request.created_at AS createdAt,
             state.lifecycle_status AS lifecycleStatus
           FROM workflow_approval_request AS request
           INNER JOIN workflow_approval_state AS state
             ON state.approval_request_id = request.id
            AND state.workspace_id = request.workspace_id
           INNER JOIN node_run AS node
             ON node.id = request.node_run_id
            AND node.workflow_run_id = request.workflow_run_id
            AND node.workspace_id = request.workspace_id
           WHERE request.workspace_id = ?
             AND request.workflow_run_id = ?
             AND state.lifecycle_status = 'pending'
           ORDER BY request.created_at, request.id`,
          [workspaceId, workflowRunId],
        ),
      ]);
      const [nodeRows] = nodeResult;
      const [approvalRows] = approvalResult;
      const pendingApprovals = approvalRows.map((approval) => {
        const context = approvalContextFromRow(approval);
        const payload =
          context.requestPayload !== null &&
          typeof context.requestPayload === "object" &&
          !Array.isArray(context.requestPayload)
            ? (context.requestPayload as Readonly<Record<string, unknown>>)
            : {};
        const title = boundedText(payload.title, 500);
        const message = boundedText(payload.message, 8_000);
        return Object.freeze({
          id: context.id,
          nodeRunId: context.nodeRunId,
          nodeKey: context.nodeKey,
          ...(title ? { title } : {}),
          ...(message ? { message } : {}),
          decisionSchema: context.decisionSchema,
          expiresAt: context.expiresAt,
        });
      });
      const browserExecution = browserExecutionFromPlan(
        row.executionPlanSnapshot,
        row.executionPlanHash,
      );
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        ...(pendingApprovals.length > 0 ? { pendingApprovals } : {}),
        ...(browserExecution ? { browserExecution } : {}),
        ...(brand ? { brand } : {}),
        definitionKind: row.definitionKind,
        ...(row.workflowRevisionId
          ? { workflowRevisionId: row.workflowRevisionId }
          : {}),
        ...(row.publicationCandidateId
          ? {
              publicationCandidateId: row.publicationCandidateId,
            }
          : {}),
        nonProduction: Boolean(row.nonProduction),
        lifecycleStatus: row.lifecycleStatus,
        outcome: row.outcome,
        version: row.version,
        input: parseJson(row.input),
        output: row.output === null ? null : parseJson(row.output),
        nodes: Object.freeze(
          nodeRows.map((node) =>
            Object.freeze({
              id: node.id,
              nodeKey: node.nodeKey,
              scopeKey: node.scopeKey,
              kind: node.kind,
              lifecycleStatus: node.lifecycleStatus,
              ...(node.waitingReason
                ? { waitingReason: node.waitingReason }
                : {}),
              output: node.output === null ? null : parseJson(node.output),
              error: node.error === null ? null : parseJson(node.error),
              createdAt: node.createdAt,
              updatedAt: node.updatedAt,
              ...(node.completedAt ? { completedAt: node.completedAt } : {}),
            }),
          ),
        ),
        executionDeadlineAt: row.executionDeadlineAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(row.completedAt ? { completedAt: row.completedAt } : {}),
        ...(row.cancelRequestedAt
          ? { cancelRequestedAt: row.cancelRequestedAt }
          : {}),
        ...(row.cancelReasonCode
          ? { cancelReasonCode: row.cancelReasonCode }
          : {}),
        ...(row.cancelDeadlineAt
          ? { cancelDeadlineAt: row.cancelDeadlineAt }
          : {}),
      };
    },
    async findApprovalDecisionContext(
      workspaceId,
      workflowRunId,
      approvalRequestId,
    ) {
      const [rows] = await pool.execute<WorkflowApprovalViewRow[]>(
        `SELECT
           request.id,
           request.workspace_id AS workspaceId,
           request.workflow_run_id AS workflowRunId,
           request.node_run_id AS nodeRunId,
           node.node_key AS nodeKey,
           request.request_payload AS requestPayload,
           request.decision_schema AS decisionSchema,
           request.authorization_context_digest AS authorizationContextDigest,
           request.expires_at AS expiresAt,
           request.created_at AS createdAt,
           state.lifecycle_status AS lifecycleStatus
         FROM workflow_approval_request AS request
         INNER JOIN workflow_approval_state AS state
           ON state.approval_request_id = request.id
          AND state.workspace_id = request.workspace_id
         INNER JOIN node_run AS node
           ON node.id = request.node_run_id
          AND node.workflow_run_id = request.workflow_run_id
          AND node.workspace_id = request.workspace_id
         WHERE request.workspace_id = ?
           AND request.workflow_run_id = ?
           AND request.id = ?
         LIMIT 1`,
        [workspaceId, workflowRunId, approvalRequestId],
      );
      return rows[0] ? approvalContextFromRow(rows[0]) : undefined;
    },
  });
}
