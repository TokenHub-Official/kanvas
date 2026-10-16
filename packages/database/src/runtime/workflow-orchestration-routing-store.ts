import type { Pool, RowDataPacket } from "mysql2/promise";

export type WorkflowExecutionProtocolVersion = 1;

export interface WorkflowOrchestrationRoutingFact {
  readonly workflowRunId: string;
  readonly workspaceId: string;
  readonly protocolVersion: WorkflowExecutionProtocolVersion;
  readonly lifecycleStatus:
    | "queued"
    | "running"
    | "waiting"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
  readonly cancelReasonCode: string | null;
}

export interface WorkflowOrchestrationRoutingStore {
  read(
    workspaceId: string,
    workflowRunId: string,
  ): Promise<WorkflowOrchestrationRoutingFact | undefined>;
}

export type WorkflowOrchestrationRoutingErrorCode =
  "workflow_routing.invalid_argument" | "workflow_routing.plan_invalid";

export class WorkflowOrchestrationRoutingError extends Error {
  public constructor(
    public readonly code: WorkflowOrchestrationRoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowOrchestrationRoutingError";
  }
}

interface RoutingRow extends RowDataPacket {
  readonly workflowRunId: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: WorkflowOrchestrationRoutingFact["lifecycleStatus"];
  readonly cancelReasonCode: string | null;
  readonly executionPlanSnapshot: unknown;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function invalid(message: string): never {
  throw new WorkflowOrchestrationRoutingError(
    "workflow_routing.invalid_argument",
    message,
  );
}

function assertId(value: string, label: string): void {
  if (!idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function protocolVersionOf(value: unknown): WorkflowExecutionProtocolVersion {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    throw new WorkflowOrchestrationRoutingError(
      "workflow_routing.plan_invalid",
      "Workflow execution plan is not valid JSON.",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowOrchestrationRoutingError(
      "workflow_routing.plan_invalid",
      "Workflow execution plan must be a JSON object.",
    );
  }
  const version = (parsed as Readonly<Record<string, unknown>>).schemaVersion;
  if (version !== 1) {
    throw new WorkflowOrchestrationRoutingError(
      "workflow_routing.plan_invalid",
      "Workflow execution plan has an unsupported schemaVersion.",
    );
  }
  return 1;
}

export function createWorkflowOrchestrationRoutingStore(
  pool: Pool,
): WorkflowOrchestrationRoutingStore {
  return Object.freeze({
    async read(
      workspaceId: string,
      workflowRunId: string,
    ): Promise<WorkflowOrchestrationRoutingFact | undefined> {
      assertId(workspaceId, "workspaceId");
      assertId(workflowRunId, "workflowRunId");
      const [rows] = await pool.execute<RoutingRow[]>(
        `SELECT
           id AS workflowRunId,
           workspace_id AS workspaceId,
           lifecycle_status AS lifecycleStatus,
           cancel_reason_code AS cancelReasonCode,
           execution_plan_snapshot AS executionPlanSnapshot
         FROM workflow_run
         WHERE id = ?
           AND workspace_id = ?
         LIMIT 1`,
        [workflowRunId, workspaceId],
      );
      const row = rows[0];
      if (!row) {
        return undefined;
      }
      return Object.freeze({
        workflowRunId: row.workflowRunId,
        workspaceId: row.workspaceId,
        protocolVersion: protocolVersionOf(row.executionPlanSnapshot),
        lifecycleStatus: row.lifecycleStatus,
        cancelReasonCode: row.cancelReasonCode,
      });
    },
  });
}
