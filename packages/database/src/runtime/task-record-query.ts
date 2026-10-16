import type { TaskRecordList, TaskRecordQuery } from "@kanvas/contracts/api";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

interface TaskRow extends RowDataPacket {
  id: string;
  kind: "agent" | "workflow" | "capability";
  title: string;
  status: string;
  outcome: string | null;
  creatorId: string;
  creatorName: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  agentRunId: string | null;
  threadId: string | null;
}

/** Called only inside an audit.read transaction after authority revalidation. */
export async function queryTaskRecords(
  connection: PoolConnection,
  workspaceId: string,
  query: TaskRecordQuery,
): Promise<TaskRecordList> {
  const limit = Number(query.limit ?? 50);
  const conditions: string[] = [];
  const values: unknown[] = [
    workspaceId,
    workspaceId,
    `$.catalog.title."${query.locale ?? "en-US"}"`,
    workspaceId,
  ];
  if (query.reference) {
    conditions.push(
      "(task.id = ? OR task.agentRunId = ? OR agent.thread_id = ?)",
    );
    values.push(query.reference, query.reference, query.reference);
  }
  if (query.kind) {
    conditions.push("task.kind = ?");
    values.push(query.kind);
  }
  if (query.creator) {
    conditions.push("(task.creatorId = ? OR user.name LIKE ?)");
    values.push(
      query.creator,
      `%${query.creator.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    );
  }
  if (query.from) {
    conditions.push("task.createdAt >= ?");
    values.push(new Date(query.from));
  }
  if (query.to) {
    conditions.push("task.createdAt <= ?");
    values.push(new Date(query.to));
  }
  if (query.status) {
    const statuses = {
      active: [
        "queued",
        "running",
        "waiting",
        "cancelling",
        "waiting_approval",
        "waiting_for_user",
      ],
      succeeded: ["completed", "succeeded"],
      failed: ["failed"],
      cancelled: ["cancelled"],
    }[query.status];
    conditions.push(`task.status IN (${statuses.map(() => "?").join(",")})`);
    values.push(...statuses);
  }
  if (query.cursor) {
    const cursor: unknown = JSON.parse(
      Buffer.from(query.cursor, "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 3 ||
      typeof cursor[0] !== "string" ||
      !Number.isFinite(Date.parse(cursor[0])) ||
      typeof cursor[1] !== "string" ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(cursor[1]) ||
      !["agent", "workflow", "capability"].includes(String(cursor[2]))
    )
      throw new TypeError("Invalid task cursor");
    conditions.push("(task.createdAt, task.id, task.kind) < (?, ?, ?)");
    values.push(new Date(cursor[0]), cursor[1], cursor[2]);
  }
  values.push(limit + 1);
  const [rows] = await connection.query<TaskRow[]>(
    `
    WITH task AS (
      SELECT run.id, 'agent' AS kind, COALESCE(thread.title, 'Agent') AS title,
        run.lifecycle_status AS status, NULL AS outcome, run.actor_principal_id AS creatorId,
        run.created_at AS createdAt, run.updated_at AS updatedAt, run.completed_at AS completedAt,
        run.id AS agentRunId
      FROM agent_run run JOIN agent_thread thread ON thread.workspace_id = run.workspace_id AND thread.id = run.thread_id
      WHERE run.workspace_id = ?
      UNION ALL
      SELECT run.id, 'workflow', COALESCE(definition.display_name, revision.workflow_key, 'Workflow'),
        run.lifecycle_status, run.outcome, run.created_by, run.created_at, run.updated_at, run.completed_at,
        (SELECT action.agent_run_id FROM agent_action_receipt action WHERE action.workspace_id = run.workspace_id AND action.workflow_run_id = run.id ORDER BY action.created_at, action.id LIMIT 1)
      FROM workflow_run run
      LEFT JOIN workflow_revision revision ON revision.workspace_id = run.workspace_id AND revision.id = run.workflow_revision_id
      LEFT JOIN workflow_definition definition ON definition.workspace_id = revision.workspace_id AND definition.id = revision.workflow_definition_id
      WHERE run.workspace_id = ?
      UNION ALL
      SELECT run.id, 'capability', COALESCE(
        (SELECT JSON_UNQUOTE(JSON_EXTRACT(declaration.declaration, ?)) FROM capability_declaration_revision declaration
         WHERE declaration.workspace_id = run.workspace_id AND declaration.contract_revision_id = run.contract_revision_id
           AND (declaration.id = run.declaration_revision_id OR (run.declaration_revision_id IS NULL AND declaration.published_at <= run.created_at))
         ORDER BY declaration.revision DESC LIMIT 1), contract.contract_key),
        run.lifecycle_status, NULL, run.created_by, run.created_at, run.updated_at, run.completed_at,
        (SELECT action.agent_run_id FROM agent_action_receipt action WHERE action.workspace_id = run.workspace_id AND action.capability_run_id = run.id ORDER BY action.created_at, action.id LIMIT 1)
      FROM capability_run run JOIN capability_contract_revision contract ON contract.workspace_id = run.workspace_id AND contract.id = run.contract_revision_id
      WHERE run.workspace_id = ? AND run.node_run_id IS NULL
    )
    SELECT task.*, COALESCE(user.name, task.creatorId) AS creatorName, agent.thread_id AS threadId
    FROM task
    LEFT JOIN human_principal human ON human.principal_id = task.creatorId
    LEFT JOIN auth_user user ON user.id = human.auth_subject_id
    LEFT JOIN agent_run agent ON agent.id = task.agentRunId
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY task.createdAt DESC, task.id DESC, task.kind DESC LIMIT ?`,
    values,
  );
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      ...(row.outcome ? { outcome: row.outcome } : {}),
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.completedAt
        ? { completedAt: row.completedAt.toISOString() }
        : {}),
      ...(row.threadId ? { threadId: row.threadId } : {}),
      ...(row.agentRunId ? { agentRunId: row.agentRunId } : {}),
    })),
    ...(rows.length > limit && last
      ? {
          nextCursor: Buffer.from(
            JSON.stringify([last.createdAt.toISOString(), last.id, last.kind]),
          ).toString("base64url"),
        }
      : {}),
  };
}
