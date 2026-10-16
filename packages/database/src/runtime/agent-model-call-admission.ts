import type { AgentModelCallPurpose } from "@kanvas/application";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/** Auxiliary work can finish after the visible Run, but never outlive its owner. */
export async function agentModelCallAdmitted(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly agentRunId: string;
    readonly lifecycleStatus: string;
    readonly executionDeadlineAt: Date;
    readonly purpose?: AgentModelCallPurpose;
    readonly lockLease?: boolean;
    readonly workerClaim?: {
      readonly workerId: string;
      readonly claimTokenDigest: string;
    };
    readonly now: Date;
  },
): Promise<boolean> {
  if (options.executionDeadlineAt.getTime() <= options.now.getTime())
    return false;
  const auxiliary =
    options.purpose === "memory_observation" ||
    options.purpose === "thread_title";
  if (
    options.lifecycleStatus !== "running" &&
    !(
      auxiliary &&
      options.workerClaim &&
      ["succeeded", "waiting_approval"].includes(options.lifecycleStatus)
    )
  )
    return false;
  if (!options.workerClaim) return true;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT agent_run_id FROM agent_run_dispatch
     WHERE workspace_id = ? AND agent_run_id = ? AND delivery_status = 'claimed'
       AND claim_owner = ? AND claim_token_digest = ? AND lease_expires_at > ?${options.lockLease ? " FOR UPDATE" : ""}`,
    [
      options.workspaceId,
      options.agentRunId,
      options.workerClaim.workerId,
      options.workerClaim.claimTokenDigest,
      options.now,
    ],
  );
  return rows.length === 1;
}
