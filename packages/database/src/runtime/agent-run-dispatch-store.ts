import {
  authorizationModelVersion,
  parseAgentProfileManifestV1,
  permissionsForWorkspaceRole,
  type AgentRunDispatchRepository,
  type AgentRuntimeRepository,
  type AgentReasoningLevel,
  type AgentWebSearchMode,
  type TrustedWorkspaceScope,
  type WorkspaceRole,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

interface ClaimRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly agentRunId: string;
  readonly actorPrincipalId: string;
  readonly principalStatus: string;
  readonly runStatus:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_for_user"
    | "succeeded"
    | "failed"
    | "cancelled";
  readonly runVersion: number;
  readonly workspaceStatus: string;
  readonly membershipId: string | null;
  readonly membershipRole: WorkspaceRole | null;
  readonly membershipStatus: string | null;
  readonly membershipVersion: number | null;
  readonly profileManifest: unknown;
  readonly defaultModelBindingKey: string | null;
  readonly fastModelBindingKey: string | null;
  readonly reasoningLevel: AgentReasoningLevel | null;
  readonly webSearchMode: AgentWebSearchMode | null;
  readonly dispatchVersion: number;
}

interface CompleteRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly runStatus: string;
  readonly dispatchVersion: number;
}

export class AgentRunDispatchStoreError extends Error {
  public constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentRunDispatchStoreError";
  }
}

function fail(code: string, message: string): never {
  throw new AgentRunDispatchStoreError(code, message);
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const workerPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u;

function assertClaimInput(options: {
  readonly workerId: string;
  readonly claimTokenDigest: string;
  readonly leaseExpiresAt: Date;
  readonly now: Date;
}): void {
  const duration = options.leaseExpiresAt.getTime() - options.now.getTime();
  if (
    !workerPattern.test(options.workerId) ||
    !digestPattern.test(options.claimTokenDigest) ||
    duration < 5_000 ||
    duration > 5 * 60_000
  ) {
    fail("agent_dispatch.invalid", "Agent Run claim input is invalid.");
  }
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

async function closeOrphanedTerminalModelCalls(
  connection: PoolConnection,
  workspaceId: string,
  agentRunId: string,
  now: Date,
): Promise<void> {
  const terminalReasonCode = "agent.model_call_orphaned";
  await connection.execute<ResultSetHeader>(
    `UPDATE agent_model_attempt AS attempt
       INNER JOIN agent_model_call AS model_call
         ON model_call.workspace_id = attempt.workspace_id
        AND model_call.id = attempt.agent_model_call_id
       LEFT JOIN budget_reservation AS reservation
         ON reservation.workspace_id = model_call.workspace_id
        AND reservation.agent_model_call_id = model_call.id
        SET attempt.lifecycle_status = 'unknown',
            attempt.accepted_marker = NULL,
            attempt.terminal_reason_code = ?,
            attempt.completed_at = ?
       WHERE model_call.workspace_id = ?
         AND model_call.agent_run_id = ?
         AND model_call.lifecycle_status IN ('pending', 'running')
         AND attempt.lifecycle_status = 'running'
         AND (
           reservation.id IS NULL
           OR reservation.lifecycle_status IN ('settled', 'released', 'unknown')
         )`,
    [terminalReasonCode, now, workspaceId, agentRunId],
  );
  await connection.execute<ResultSetHeader>(
    `UPDATE agent_model_call AS model_call
       LEFT JOIN budget_reservation AS reservation
         ON reservation.workspace_id = model_call.workspace_id
        AND reservation.agent_model_call_id = model_call.id
        SET model_call.lifecycle_status = 'failed',
            model_call.terminal_reason_code = ?,
            model_call.version = model_call.version + 1,
            model_call.updated_at = ?,
            model_call.completed_at = ?
       WHERE model_call.workspace_id = ?
         AND model_call.agent_run_id = ?
         AND model_call.lifecycle_status IN ('pending', 'running')
         AND (
           reservation.id IS NULL
           OR reservation.lifecycle_status IN ('settled', 'released', 'unknown')
         )`,
    [terminalReasonCode, now, now, workspaceId, agentRunId],
  );
}

async function closeNextOrphanedTerminalModelCallRun(
  connection: PoolConnection,
  now: Date,
): Promise<void> {
  const [rows] = await connection.execute<
    (RowDataPacket & {
      readonly workspaceId: string;
      readonly agentRunId: string;
    })[]
  >(
    `SELECT model_call.workspace_id AS workspaceId,
            model_call.agent_run_id AS agentRunId
       FROM agent_model_call AS model_call
       INNER JOIN agent_run AS run
         ON run.workspace_id = model_call.workspace_id
        AND run.id = model_call.agent_run_id
       LEFT JOIN budget_reservation AS reservation
         ON reservation.workspace_id = model_call.workspace_id
        AND reservation.agent_model_call_id = model_call.id
       WHERE model_call.lifecycle_status IN ('pending', 'running')
         AND run.lifecycle_status IN (
           'waiting_approval', 'waiting_for_user',
           'succeeded', 'failed', 'cancelled'
         )
         AND (
           reservation.id IS NULL
           OR reservation.lifecycle_status IN ('settled', 'released', 'unknown')
         )
       ORDER BY model_call.updated_at, model_call.id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
  );
  const row = rows[0];
  if (!row) return;
  await closeOrphanedTerminalModelCalls(
    connection,
    row.workspaceId,
    row.agentRunId,
    now,
  );
}

function authority(row: ClaimRow): TrustedWorkspaceScope {
  if (
    !row.membershipId ||
    !row.membershipRole ||
    row.membershipVersion === null
  ) {
    return fail(
      "agent_dispatch.integrity",
      "Authorized Agent Run membership facts are incomplete.",
    );
  }
  return Object.freeze({
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    principalId: row.actorPrincipalId,
    principalType: "human",
    authenticationRefType: "session",
    authenticationRefId: `agent-run:${row.agentRunId}`,
    authorityType: "human_membership",
    authorityId: row.membershipId,
    authorityVersion: row.membershipVersion,
    authorizationModelVersion,
    effectivePermissions: permissionsForWorkspaceRole(row.membershipRole),
    trusted: true,
  });
}

function currentlyAuthorized(row: ClaimRow): boolean {
  return (
    row.principalStatus === "active" &&
    row.workspaceStatus === "active" &&
    row.membershipStatus === "active" &&
    row.membershipRole !== null &&
    permissionsForWorkspaceRole(row.membershipRole).includes("agent.run")
  );
}

export function createAgentRunDispatchStore(
  pool: Pool,
  runs: AgentRuntimeRepository,
): AgentRunDispatchRepository {
  return Object.freeze({
    async cancel(options: Parameters<AgentRunDispatchRepository["cancel"]>[0]) {
      if (!idPattern.test(options.agentRunId)) {
        return fail("agent_dispatch.invalid", "Agent Run ID is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        // Match visible-message writers' thread -> Run -> dispatch lock order.
        const [owners] = await connection.execute<
          (RowDataPacket & { threadId: string })[]
        >(
          "SELECT thread_id AS threadId FROM agent_run WHERE workspace_id = ? AND id = ? AND actor_principal_id = ?",
          [
            options.authority.workspaceId,
            options.agentRunId,
            options.authority.principalId,
          ],
        );
        if (owners[0])
          await connection.execute(
            "SELECT id FROM agent_thread WHERE workspace_id = ? AND id = ? FOR UPDATE",
            [options.authority.workspaceId, owners[0].threadId],
          );
        const [rows] = await connection.execute<
          (RowDataPacket & {
            readonly runStatus:
              | "queued"
              | "running"
              | "waiting_approval"
              | "waiting_for_user"
              | "succeeded"
              | "failed"
              | "cancelled";
            readonly runVersion: number;
            readonly threadId: string;
            readonly dispatchVersion: number;
            readonly dispatchStatus: "claimed" | "completed" | "queued";
          })[]
        >(
          `SELECT run.thread_id AS threadId,
                  run.lifecycle_status AS runStatus,
                  run.version AS runVersion,
                  dispatch.delivery_status AS dispatchStatus,
                  dispatch.version AS dispatchVersion
             FROM agent_run AS run
             INNER JOIN agent_run_dispatch AS dispatch
               ON dispatch.workspace_id = run.workspace_id
              AND dispatch.agent_run_id = run.id
             INNER JOIN agent_thread AS thread
               ON thread.workspace_id = run.workspace_id
              AND thread.id = run.thread_id
            WHERE run.workspace_id = ? AND run.id = ?
              AND run.actor_principal_id = ?
              AND thread.created_by_principal_id = ?
            LIMIT 1 FOR UPDATE`,
          [
            options.authority.workspaceId,
            options.agentRunId,
            options.authority.principalId,
            options.authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail("agent.run_not_found", "Agent Run was not found.");
        }
        if (row.runStatus === "cancelled") {
          return Object.freeze({
            id: options.agentRunId,
            lifecycleStatus: "cancelled" as const,
          });
        }
        if (
          !["queued", "running", "waiting_for_user"].includes(row.runStatus)
        ) {
          return fail(
            "agent.state_conflict",
            "Agent Run is no longer producing output.",
          );
        }
        const [runUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run
              SET lifecycle_status = 'cancelled',
                  terminal_reason_code = 'agent.cancelled_by_user',
                  version = version + 1, updated_at = ?, completed_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?
              AND lifecycle_status IN (
                'queued', 'running', 'waiting_for_user'
              )`,
          [
            options.now,
            options.now,
            options.authority.workspaceId,
            options.agentRunId,
            row.runVersion,
          ],
        );
        await connection.execute(
          "UPDATE agent_thread SET view_revision = view_revision + 1 WHERE workspace_id = ? AND active_run_id = ?",
          [options.authority.workspaceId, options.agentRunId],
        );
        const [dispatchUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run_dispatch
              SET delivery_status = 'completed', claim_owner = NULL,
                  claim_token_digest = NULL, lease_expires_at = NULL,
                  version = version + 1, updated_at = ?, completed_at = ?
            WHERE workspace_id = ? AND agent_run_id = ? AND version = ?
              AND delivery_status IN ('queued', 'claimed')`,
          [
            options.now,
            options.now,
            options.authority.workspaceId,
            options.agentRunId,
            row.dispatchVersion,
          ],
        );
        if (
          runUpdate.affectedRows !== 1 ||
          (row.dispatchStatus !== "completed" &&
            dispatchUpdate.affectedRows !== 1)
        ) {
          return fail(
            "agent.state_conflict",
            "Agent Run cancellation lost concurrency.",
          );
        }
        if (row.runStatus === "waiting_for_user") {
          await connection.execute<ResultSetHeader>(
            `UPDATE agent_interaction
                SET lifecycle_status = 'cancelled',
                    response_document = JSON_OBJECT(
                      'schemaVersion', 1, 'outcome', 'cancelled'
                    ),
                    response_digest = ?, resolution_request_key = ?,
                    resolved_by_principal_id = ?, version = version + 1,
                    updated_at = ?, completed_at = ?
              WHERE workspace_id = ? AND agent_run_id = ?
                AND lifecycle_status = 'pending'`,
            [
              digestProviderValue({ schemaVersion: 1, outcome: "cancelled" }),
              `agent-run-cancel:${options.agentRunId}`,
              options.authority.principalId,
              options.now,
              options.now,
              options.authority.workspaceId,
              options.agentRunId,
            ],
          );
        }
        return Object.freeze({
          id: options.agentRunId,
          lifecycleStatus: "cancelled" as const,
        });
      });
    },
    async claimNext(
      options: Parameters<AgentRunDispatchRepository["claimNext"]>[0],
    ) {
      assertClaimInput(options);
      const claimed = await inTransaction(pool, async (connection) => {
        await closeNextOrphanedTerminalModelCallRun(connection, options.now);
        const [rows] = await connection.execute<ClaimRow[]>(
          `SELECT
             dispatch.workspace_id AS workspaceId,
             workspace.organization_id AS organizationId,
             run.id AS agentRunId,
             run.actor_principal_id AS actorPrincipalId,
             principal.status AS principalStatus,
             run.lifecycle_status AS runStatus,
             run.version AS runVersion,
             workspace.status AS workspaceStatus,
             membership.id AS membershipId,
             membership.role AS membershipRole,
             membership.status AS membershipStatus,
             membership.version AS membershipVersion,
             profile.manifest_document AS profileManifest,
             (
               SELECT selected_binding.binding_key
               FROM agent_model_binding AS selected_binding
               INNER JOIN model_profile_revision AS selected_profile
                 ON selected_profile.workspace_id = selected_binding.workspace_id
                AND selected_profile.id = selected_binding.model_profile_revision_id
               INNER JOIN model_deployment AS selected_deployment
                 ON selected_deployment.workspace_id = selected_binding.workspace_id
                AND selected_deployment.id = selected_binding.model_deployment_id
               INNER JOIN pricing_revision AS selected_pricing
                 ON selected_pricing.workspace_id = selected_binding.workspace_id
                AND selected_pricing.id = selected_binding.pricing_revision_id
               WHERE selected_binding.workspace_id = dispatch.workspace_id
                 AND selected_profile.canonical_model_id =
                     model_settings.default_canonical_model_id
                 AND selected_binding.lifecycle_status = 'enabled'
                 AND selected_deployment.lifecycle_status = 'active'
                 AND selected_pricing.lifecycle_status = 'published'
                 AND JSON_UNQUOTE(JSON_EXTRACT(
                       selected_pricing.pricing_document,
                       '$.billingMode'
                     )) IN ('metered', 'fixed')
               ORDER BY selected_binding.updated_at DESC, selected_binding.id DESC
               LIMIT 1
             ) AS defaultModelBindingKey,
             (
               SELECT selected_binding.binding_key
               FROM agent_model_binding AS selected_binding
               INNER JOIN model_profile_revision AS selected_profile
                 ON selected_profile.workspace_id = selected_binding.workspace_id
                AND selected_profile.id = selected_binding.model_profile_revision_id
               INNER JOIN model_deployment AS selected_deployment
                 ON selected_deployment.workspace_id = selected_binding.workspace_id
                AND selected_deployment.id = selected_binding.model_deployment_id
               INNER JOIN pricing_revision AS selected_pricing
                 ON selected_pricing.workspace_id = selected_binding.workspace_id
                AND selected_pricing.id = selected_binding.pricing_revision_id
               WHERE selected_binding.workspace_id = dispatch.workspace_id
                 AND selected_profile.canonical_model_id =
                     model_settings.fast_canonical_model_id
                 AND selected_binding.lifecycle_status = 'enabled'
                 AND selected_deployment.lifecycle_status = 'active'
                 AND selected_pricing.lifecycle_status = 'published'
                 AND JSON_UNQUOTE(JSON_EXTRACT(
                       selected_pricing.pricing_document,
                       '$.billingMode'
                     )) IN ('metered', 'fixed')
               ORDER BY selected_binding.updated_at DESC, selected_binding.id DESC
               LIMIT 1
             ) AS fastModelBindingKey,
             model_settings.reasoning_level AS reasoningLevel,
             model_settings.web_search_mode AS webSearchMode,
             dispatch.version AS dispatchVersion
           FROM agent_run_dispatch AS dispatch
           INNER JOIN agent_run AS run
             ON run.workspace_id = dispatch.workspace_id
            AND run.id = dispatch.agent_run_id
           INNER JOIN workspace ON workspace.id = run.workspace_id
           INNER JOIN principal
             ON principal.id = run.actor_principal_id
            AND principal.principal_type = 'human'
           LEFT JOIN workspace_membership AS membership
             ON membership.workspace_id = run.workspace_id
            AND membership.organization_id = workspace.organization_id
            AND membership.principal_id = run.actor_principal_id
           INNER JOIN agent_run_foundation_context AS foundation
             ON foundation.workspace_id = run.workspace_id
            AND foundation.agent_run_id = run.id
           INNER JOIN agent_profile_revision AS profile
             ON profile.workspace_id = foundation.workspace_id
            AND profile.id = foundation.profile_revision_id
           LEFT JOIN workspace_agent_model_settings AS model_settings
             ON model_settings.workspace_id = dispatch.workspace_id
           WHERE dispatch.available_at <= ?
             AND (
               (dispatch.delivery_status = 'queued' AND run.lifecycle_status = 'queued')
               OR (
                 dispatch.delivery_status = 'claimed'
                 AND dispatch.lease_expires_at <= ?
                 AND (
                   run.lifecycle_status = 'running'
                   OR (
                     run.lifecycle_status IN (
                       'waiting_approval', 'waiting_for_user',
                       'succeeded', 'failed', 'cancelled'
                     )
                     AND NOT EXISTS (
                       SELECT 1
                       FROM agent_model_call AS unresolved_call
                       INNER JOIN budget_reservation AS unresolved_reservation
                         ON unresolved_reservation.workspace_id =
                            unresolved_call.workspace_id
                        AND unresolved_reservation.agent_model_call_id =
                            unresolved_call.id
                       WHERE unresolved_call.workspace_id = run.workspace_id
                         AND unresolved_call.agent_run_id = run.id
                         AND unresolved_call.lifecycle_status IN (
                           'pending', 'running'
                         )
                         AND unresolved_reservation.lifecycle_status =
                             'reserved'
                     )
                   )
                 )
               )
             )
           ORDER BY dispatch.available_at, dispatch.agent_run_id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [options.now, options.now],
        );
        const row = rows[0];
        if (!row) return undefined;
        if (!["queued", "running"].includes(row.runStatus)) {
          await closeOrphanedTerminalModelCalls(
            connection,
            row.workspaceId,
            row.agentRunId,
            options.now,
          );
          const [dispatchUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run_dispatch
                 SET delivery_status = 'completed', claim_owner = NULL,
                     claim_token_digest = NULL, lease_expires_at = NULL,
                     version = version + 1, updated_at = ?, completed_at = ?
                 WHERE workspace_id = ? AND agent_run_id = ? AND version = ?
                   AND delivery_status = 'claimed'
                   AND lease_expires_at <= ?`,
            [
              options.now,
              options.now,
              row.workspaceId,
              row.agentRunId,
              row.dispatchVersion,
              options.now,
            ],
          );
          if (dispatchUpdate.affectedRows !== 1) {
            return fail(
              "agent_dispatch.state_conflict",
              "Terminal Agent Run dispatch reconciliation lost concurrency.",
            );
          }
          return Object.freeze({ terminalized: true as const });
        }
        if (!currentlyAuthorized(row)) {
          const reason = "agent.authorization_revoked";
          const [runUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run
               SET lifecycle_status = 'cancelled', terminal_reason_code = ?,
                   version = version + 1, updated_at = ?, completed_at = ?
               WHERE workspace_id = ? AND id = ? AND version = ?
                 AND lifecycle_status = ?`,
            [
              reason,
              options.now,
              options.now,
              row.workspaceId,
              row.agentRunId,
              row.runVersion,
              row.runStatus,
            ],
          );
          await connection.execute(
            "UPDATE agent_thread SET view_revision = view_revision + 1 WHERE workspace_id = ? AND active_run_id = ?",
            [row.workspaceId, row.agentRunId],
          );
          const [dispatchUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run_dispatch
               SET delivery_status = 'completed', claim_owner = NULL,
                   claim_token_digest = NULL, lease_expires_at = NULL,
                   version = version + 1, updated_at = ?, completed_at = ?
               WHERE workspace_id = ? AND agent_run_id = ? AND version = ?
                 AND delivery_status IN ('queued', 'claimed')`,
            [
              options.now,
              options.now,
              row.workspaceId,
              row.agentRunId,
              row.dispatchVersion,
            ],
          );
          if (
            runUpdate.affectedRows !== 1 ||
            dispatchUpdate.affectedRows !== 1
          ) {
            return fail(
              "agent_dispatch.state_conflict",
              "Unauthorized Agent Run terminalization lost concurrency.",
            );
          }
          return Object.freeze({ terminalized: true as const });
        }
        const manifest = parseAgentProfileManifestV1(row.profileManifest);
        if (!manifest) {
          return fail(
            "agent_dispatch.integrity",
            "Claimed Agent Profile manifest is invalid.",
          );
        }
        const [dispatchUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run_dispatch
             SET delivery_status = 'claimed', claim_owner = ?,
                 claim_token_digest = ?, lease_expires_at = ?,
                 delivery_count = delivery_count + 1,
                 version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND agent_run_id = ? AND version = ?`,
          [
            options.workerId,
            options.claimTokenDigest,
            options.leaseExpiresAt,
            options.now,
            row.workspaceId,
            row.agentRunId,
            row.dispatchVersion,
          ],
        );
        if (dispatchUpdate.affectedRows !== 1) {
          return fail(
            "agent_dispatch.state_conflict",
            "Agent Run dispatch claim lost concurrency.",
          );
        }
        if (row.runStatus === "queued") {
          const [runUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run
               SET lifecycle_status = 'running', version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ? AND id = ?
                 AND lifecycle_status = 'queued'`,
            [options.now, row.workspaceId, row.agentRunId],
          );
          if (runUpdate.affectedRows !== 1) {
            return fail(
              "agent_dispatch.state_conflict",
              "Agent Run changed before dispatch claim.",
            );
          }
        }
        await connection.execute(
          "UPDATE agent_thread SET view_revision = view_revision + 1 WHERE workspace_id = ? AND active_run_id = ?",
          [row.workspaceId, row.agentRunId],
        );
        return Object.freeze({
          terminalized: false as const,
          row,
          authority: authority(row),
          modelBindingKey:
            row.defaultModelBindingKey ?? manifest.modelBindingKey,
          fastModelBindingKey:
            row.fastModelBindingKey ??
            row.defaultModelBindingKey ??
            manifest.modelBindingKey,
          modelControls: Object.freeze({
            reasoningLevel: row.reasoningLevel ?? "medium",
            webSearchMode: row.webSearchMode ?? "off",
          }),
        });
      });
      if (!claimed || claimed.terminalized) return undefined;
      const run = await runs.getRun(
        claimed.authority,
        claimed.row.agentRunId,
        options.now,
      );
      if (!run || run.lifecycleStatus !== "running") {
        return fail(
          "agent_dispatch.integrity",
          "Claimed Agent Run could not be reloaded.",
        );
      }
      return Object.freeze({
        workerId: options.workerId,
        claimTokenDigest: options.claimTokenDigest,
        leaseExpiresAt: new Date(options.leaseExpiresAt),
        authority: claimed.authority,
        run,
        modelBindingKey: claimed.modelBindingKey,
        fastModelBindingKey: claimed.fastModelBindingKey,
        modelControls: claimed.modelControls,
      });
    },

    async heartbeat(
      options: Parameters<AgentRunDispatchRepository["heartbeat"]>[0],
    ): Promise<void> {
      if (!idPattern.test(options.agentRunId)) {
        return fail("agent_dispatch.invalid", "Agent Run ID is invalid.");
      }
      assertClaimInput(options);
      await inTransaction(pool, async (connection) => {
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run_dispatch
             SET lease_expires_at = ?, version = version + 1, updated_at = ?
             WHERE agent_run_id = ? AND delivery_status = 'claimed'
               AND claim_owner = ? AND claim_token_digest = ?
               AND lease_expires_at > ?`,
          [
            options.leaseExpiresAt,
            options.now,
            options.agentRunId,
            options.workerId,
            options.claimTokenDigest,
            options.now,
          ],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "agent_dispatch.lease_lost",
            "Agent Run dispatch lease is no longer owned.",
          );
        }
      });
    },

    async complete(
      options: Parameters<AgentRunDispatchRepository["complete"]>[0],
    ): Promise<void> {
      if (
        !idPattern.test(options.agentRunId) ||
        !workerPattern.test(options.workerId) ||
        !digestPattern.test(options.claimTokenDigest)
      ) {
        return fail("agent_dispatch.invalid", "Completion input is invalid.");
      }
      await inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<CompleteRow[]>(
          `SELECT run.workspace_id AS workspaceId,
                  run.lifecycle_status AS runStatus,
                  dispatch.version AS dispatchVersion
           FROM agent_run_dispatch AS dispatch
           INNER JOIN agent_run AS run
             ON run.workspace_id = dispatch.workspace_id
            AND run.id = dispatch.agent_run_id
           WHERE dispatch.agent_run_id = ?
             AND dispatch.delivery_status = 'claimed'
             AND dispatch.claim_owner = ?
             AND dispatch.claim_token_digest = ?
             AND dispatch.lease_expires_at > ?
           LIMIT 1
           FOR UPDATE`,
          [
            options.agentRunId,
            options.workerId,
            options.claimTokenDigest,
            options.now,
          ],
        );
        const row = rows[0];
        if (
          !row ||
          ![
            "waiting_approval",
            "waiting_for_user",
            "succeeded",
            "failed",
            "cancelled",
          ].includes(row.runStatus)
        ) {
          return fail(
            "agent_dispatch.state_conflict",
            "Agent Run is not terminal under the current dispatch lease.",
          );
        }
        await closeOrphanedTerminalModelCalls(
          connection,
          row.workspaceId,
          options.agentRunId,
          options.now,
        );
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run_dispatch
             SET delivery_status = 'completed', claim_owner = NULL,
                 claim_token_digest = NULL, lease_expires_at = NULL,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE agent_run_id = ? AND version = ?
               AND delivery_status = 'claimed'`,
          [options.now, options.now, options.agentRunId, row.dispatchVersion],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "agent_dispatch.state_conflict",
            "Agent Run dispatch completion lost concurrency.",
          );
        }
      });
    },
  });
}
