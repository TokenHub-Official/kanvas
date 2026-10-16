import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import { ulid } from "ulid";
import { inTransaction } from "./instance-access-store.js";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { captureProviderResultEvidence } from "./provider-result-links.js";

export interface ProviderResultRecoveryItem {
  readonly id: string;
  readonly resultIndex: number;
  readonly state: "queued" | "running" | "succeeded" | "failed";
  readonly errorCode?: string;
  readonly artifactId?: string;
  readonly createdAt: string;
  readonly initiatedByAdministrator: boolean;
}
export interface ProviderResultRecoveryView {
  readonly canRecover: boolean;
  readonly canDownload: boolean;
  readonly unavailableReason?: "no_results";
  readonly resultCount: number;
  readonly items: ProviderResultRecoveryItem[];
  readonly truncated: boolean;
}
export interface ClaimedProviderResultRecovery {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly providerEndpointId: string;
  readonly invocationId: string;
  readonly url: string;
  readonly authority: TrustedWorkspaceScope;
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly leaseToken: string;
}
export interface ProviderResultRecoveryStore {
  view(
    authority: TrustedWorkspaceScope,
    runId: string,
    now: Date,
  ): Promise<ProviderResultRecoveryView>;
  enqueue(
    authority: TrustedWorkspaceScope,
    runId: string,
    requestKey: string,
    now: Date,
  ): Promise<ProviderResultRecoveryView>;
  claim(
    leaseToken: string,
    now: Date,
  ): Promise<ClaimedProviderResultRecovery | undefined>;
  renew(id: string, leaseToken: string, now: Date): Promise<boolean>;
  fail(id: string, leaseToken: string, code: string, now: Date): Promise<void>;
  recordPolicy(
    id: string,
    leaseToken: string,
    version: number | null,
  ): Promise<void>;
}
interface TaskRow extends RowDataPacket {
  id: string;
  currentAttemptId: string;
  createdBy: string;
  lifecycleStatus: string;
}

/** Delegation authorizes the operator; it never impersonates the task owner. */
async function authorizeRecoveryActor(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  ownerId: string,
  now: Date,
): Promise<void> {
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    authority,
    "capability.run",
    now,
  );
  if (ownerId === authority.principalId) return;
  if (authority.principalType !== "human")
    throw new DomainError(
      "result_recovery.not_found",
      "This task is not available for recovery.",
    );
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    authority,
    "workspace.manage",
    now,
  );
}
function urls(value: unknown): readonly string[] {
  let facts: unknown;
  try {
    facts = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return [];
  }
  if (!facts || typeof facts !== "object") return [];
  const evidence = "resultEvidence" in facts ? facts.resultEvidence : undefined;
  let candidates: unknown;
  if (evidence && typeof evidence === "object" && "urls" in evidence)
    candidates = evidence.urls;
  else if ("resultUrls" in facts) candidates = facts.resultUrls;
  return Array.isArray(candidates)
    ? captureProviderResultEvidence(candidates).urls
    : [];
}
async function task(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  runId: string,
  now: Date,
) {
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    authority,
    "capability.run",
    now,
  );
  const [rows] = await connection.execute<TaskRow[]>(
    "SELECT id,current_attempt_id AS currentAttemptId,created_by AS createdBy,lifecycle_status AS lifecycleStatus FROM capability_run WHERE workspace_id=? AND id=? FOR UPDATE",
    [authority.workspaceId, runId],
  );
  if (!rows[0])
    throw new DomainError(
      "result_recovery.not_found",
      "This task is not available for recovery.",
    );
  await authorizeRecoveryActor(connection, authority, rows[0].createdBy, now);
  return rows[0];
}
async function evidence(
  connection: PoolConnection,
  workspaceId: string,
  attemptId: string,
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT o.id,o.result_facts AS facts FROM provider_invocation_observation o JOIN provider_invocation i ON i.id=o.provider_invocation_id AND i.workspace_id=o.workspace_id WHERE i.workspace_id=? AND i.capability_attempt_id=? AND o.normalized_status='succeeded' AND o.adoption_outcome='applied' AND o.result_facts IS NOT NULL ORDER BY o.recorded_at DESC,o.id DESC LIMIT 1",
    [workspaceId, attemptId],
  );
  return rows[0]
    ? { id: String(rows[0].id), urls: urls(rows[0].facts) }
    : undefined;
}
async function view(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  run: TaskRow,
): Promise<ProviderResultRecoveryView> {
  const source = await evidence(
    connection,
    authority.workspaceId,
    run.currentAttemptId,
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT id,result_index AS resultIndex,state,error_code AS errorCode,artifact_id AS artifactId,actor_id AS actorId,created_at AS createdAt FROM provider_result_recovery WHERE workspace_id=? AND capability_run_id=? AND attempt_id=? ORDER BY created_at DESC,id DESC LIMIT 101",
    [authority.workspaceId, run.id, run.currentAttemptId],
  );
  const completed = await completedResults(
    connection,
    authority.workspaceId,
    run.id,
    source?.id,
  );
  return {
    canRecover:
      run.lifecycleStatus === "failed" &&
      Boolean(source?.urls.some((_, index) => !completed.has(index))),
    canDownload: run.createdBy === authority.principalId,
    ...(run.lifecycleStatus === "failed" && !source?.urls.length
      ? { unavailableReason: "no_results" as const }
      : {}),
    resultCount: source?.urls.length ?? 0,
    items: rows.slice(0, 100).map((row) => ({
      id: String(row.id),
      resultIndex: Number(row.resultIndex),
      state: row.state as ProviderResultRecoveryItem["state"],
      ...(typeof row.errorCode === "string"
        ? { errorCode: row.errorCode }
        : {}),
      ...(row.state === "succeeded"
        ? { artifactId: String(row.artifactId) }
        : {}),
      createdAt: (row.createdAt as Date).toISOString(),
      initiatedByAdministrator: row.actorId !== run.createdBy,
    })),
    truncated: rows.length > 100,
  };
}

async function completedResults(
  connection: PoolConnection,
  workspaceId: string,
  runId: string,
  observationId?: string,
): Promise<Set<number>> {
  if (!observationId) return new Set();
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT result_index AS resultIndex FROM provider_result_recovery WHERE workspace_id=? AND capability_run_id=? AND observation_id=? AND state='succeeded'",
    [workspaceId, runId, observationId],
  );
  return new Set(rows.map((row) => Number(row.resultIndex)));
}
export function createProviderResultRecoveryStore(
  pool: Pool,
  instanceId: string,
): ProviderResultRecoveryStore {
  return {
    view: (authority, runId, now) =>
      inTransaction(pool, async (connection) =>
        view(
          connection,
          authority,
          await task(connection, authority, runId, now),
        ),
      ),
    enqueue: (authority, runId, requestKey, now) =>
      inTransaction(pool, async (connection) => {
        if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(requestKey))
          throw new DomainError(
            "result_recovery.invalid",
            "A valid recovery request key is required.",
          );
        const run = await task(connection, authority, runId, now);
        if (run.lifecycleStatus !== "failed")
          throw new DomainError(
            "result_recovery.conflict",
            "Only failed deliveries can be recovered.",
          );
        const source = await evidence(
          connection,
          authority.workspaceId,
          run.currentAttemptId,
        );
        if (!source?.urls.length)
          throw new DomainError(
            "result_recovery.unavailable",
            "No stored upstream result is available.",
          );
        const [active] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM provider_result_recovery WHERE workspace_id=? AND capability_run_id=? AND state IN ('queued','running') LIMIT 1",
          [authority.workspaceId, runId],
        );
        if (active.length) return view(connection, authority, run);
        const completed = await completedResults(
          connection,
          authority.workspaceId,
          runId,
          source.id,
        );
        for (let index = 0; index < source.urls.length; index += 1) {
          if (completed.has(index)) continue;
          await connection.execute(
            "INSERT INTO provider_result_recovery (id,instance_id,workspace_id,capability_run_id,attempt_id,observation_id,result_index,request_key,actor_id,authority_snapshot,state,upload_session_id,stored_object_id,artifact_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
            [
              ulid(),
              instanceId,
              authority.workspaceId,
              runId,
              run.currentAttemptId,
              source.id,
              index,
              requestKey,
              authority.principalId,
              JSON.stringify(authority),
              ulid(),
              ulid(),
              ulid(),
              now,
              now,
            ],
          );
        }
        return view(connection, authority, run);
      }),
    claim: (leaseToken, now) =>
      inTransaction(pool, async (connection) => {
        const [runtime] = await connection.execute<RowDataPacket[]>(
          "SELECT state FROM instance_runtime_state WHERE instance_id=?",
          [instanceId],
        );
        if (runtime[0]?.state !== "ACTIVE") return undefined;
        const [rows] = await connection.execute<RowDataPacket[]>(
          "SELECT r.*,i.id AS invocationId,i.provider_endpoint_id AS providerEndpointId,o.result_facts AS facts,c.current_attempt_id AS currentAttemptId,c.created_by AS currentOwner,c.lifecycle_status AS originalState FROM provider_result_recovery r JOIN capability_run c ON c.id=r.capability_run_id AND c.workspace_id=r.workspace_id JOIN provider_invocation_observation o ON o.id=r.observation_id AND o.workspace_id=r.workspace_id JOIN provider_invocation i ON i.id=o.provider_invocation_id AND i.workspace_id=o.workspace_id WHERE r.instance_id=? AND (r.state='queued' OR (r.state='running' AND r.lease_until < ?)) ORDER BY r.created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
          [instanceId, now],
        );
        const row = rows[0];
        if (!row) return undefined;
        let authority: TrustedWorkspaceScope;
        try {
          authority = (
            typeof row.authority_snapshot === "string"
              ? JSON.parse(row.authority_snapshot)
              : row.authority_snapshot
          ) as TrustedWorkspaceScope;
          if (
            authority.principalId !== row.actor_id ||
            authority.workspaceId !== row.workspace_id
          )
            throw new Error("Recovery actor does not match its authority.");
          await authorizeRecoveryActor(
            connection,
            authority,
            String(row.currentOwner),
            now,
          );
        } catch {
          await connection.execute(
            "UPDATE provider_result_recovery SET state='failed',error_code='result_recovery.authority_changed',updated_at=? WHERE id=?",
            [now, row.id],
          );
          return undefined;
        }
        const url = urls(row.facts)[Number(row.result_index)];
        if (
          now.getTime() - (row.created_at as Date).getTime() > 600_000 ||
          !url ||
          row.currentAttemptId !== row.attempt_id ||
          row.originalState !== "failed"
        ) {
          await connection.execute(
            "UPDATE provider_result_recovery SET state='failed',error_code='result_recovery.source_changed',updated_at=? WHERE id=?",
            [now, row.id],
          );
          return undefined;
        }
        await connection.execute(
          "UPDATE provider_result_recovery SET state='running',lease_token=?,lease_until=?,updated_at=? WHERE id=?",
          [leaseToken, new Date(now.getTime() + 45_000), now, row.id],
        );
        return {
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          capabilityRunId: String(row.capability_run_id),
          attemptId: String(row.attempt_id),
          providerEndpointId: String(row.providerEndpointId),
          invocationId: String(row.invocationId),
          url,
          authority,
          uploadSessionId: String(row.upload_session_id),
          storedObjectId: String(row.stored_object_id),
          artifactId: String(row.artifact_id),
          leaseToken,
        };
      }),
    renew: async (id, token, now) => {
      const [result] = await pool.execute<ResultSetHeader>(
        "UPDATE provider_result_recovery SET lease_until=?,updated_at=? WHERE id=? AND state='running' AND lease_token=? AND lease_until>=?",
        [new Date(now.getTime() + 45_000), now, id, token, now],
      );
      return result.affectedRows === 1;
    },
    fail: async (id, token, code, now) => {
      await pool.execute(
        "UPDATE provider_result_recovery SET state='failed',error_code=?,lease_until=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?",
        [code.slice(0, 160), now, id, token],
      );
    },
    recordPolicy: async (id, token, version) => {
      await pool.execute(
        "UPDATE provider_result_recovery SET policy_version=? WHERE id=? AND state='running' AND lease_token=?",
        [version, id, token],
      );
    },
  };
}

export async function authorizeRecoveryCommit(
  connection: PoolConnection,
  options: {
    readonly id: string;
    readonly leaseToken: string;
    readonly authority: TrustedWorkspaceScope;
    readonly uploadSessionId: string;
    readonly storedObjectId: string;
    readonly artifactId: string;
    readonly now: Date;
  },
): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT r.capability_run_id AS capabilityRunId,c.created_by AS ownerId FROM provider_result_recovery r JOIN capability_run c ON c.id=r.capability_run_id AND c.workspace_id=r.workspace_id WHERE r.id=? AND r.workspace_id=? AND r.actor_id=? AND r.state='running' AND r.lease_token=? AND r.lease_until>=? AND r.upload_session_id=? AND r.stored_object_id=? AND r.artifact_id=? AND c.current_attempt_id=r.attempt_id AND c.lifecycle_status='failed' FOR UPDATE",
    [
      options.id,
      options.authority.workspaceId,
      options.authority.principalId,
      options.leaseToken,
      options.now,
      options.uploadSessionId,
      options.storedObjectId,
      options.artifactId,
    ],
  );
  if (!rows[0])
    throw new DomainError(
      "result_recovery.conflict",
      "Recovery authority or claim changed before commit.",
    );
  await authorizeRecoveryActor(
    connection,
    options.authority,
    String(rows[0].ownerId),
    options.now,
  );
  return String(rows[0].capabilityRunId);
}
export async function completeRecoveryCommit(
  connection: PoolConnection,
  id: string,
  token: string,
  now: Date,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    "UPDATE provider_result_recovery SET state='succeeded',error_code=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?",
    [now, id, token],
  );
  if (result.affectedRows !== 1)
    throw new DomainError(
      "result_recovery.conflict",
      "Recovery claim changed before completion.",
    );
}
