import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  assertPinnedCandidateIdentity,
  assertPinnedRouteIdentity,
  findPinnedCandidate,
  parsePinnedCapabilityRoute,
  type PinnedCapabilityRoute,
} from "./execution-plan.js";
import type { AttemptTransitionCause } from "./attempt-transition-policy.js";
import {
  transitionAttemptFailureInTransaction,
  type AttemptFailureBudgetGate,
  type AttemptFailureTransitionDependencies,
} from "./attempt-failure-store.js";
import {
  createExecutionTargetGate,
  isExecutionTarget,
  isQueueExecutionTarget,
  type ExecutionTarget,
  type ExecutionTargetGate,
} from "./execution-target.js";

export type ReconciliationCandidate =
  | {
      readonly kind: "workflow_wakeup";
      readonly workflowRunId: string;
    }
  | {
      readonly kind: "workflow_cancel";
      readonly workflowRunId: string;
    }
  | {
      readonly kind: "attempt_dispatch";
      readonly capabilityRunId: string;
      readonly attemptId: string;
    }
  | {
      readonly kind: "capability_terminal";
      readonly workflowRunId: string;
      readonly nodeRunId: string;
      readonly capabilityRunId: string;
    }
  | {
      readonly kind: "expired_attempt";
      readonly capabilityRunId: string;
      readonly attemptId: string;
    };

export type ReconciliationResult =
  | "noop"
  | "workflow_wakeup_rebuilt"
  | "workflow_cancel_rebuilt"
  | "attempt_dispatch_rebuilt"
  | "capability_terminal_rebuilt"
  | "attempt_retried"
  | "attempt_fallback"
  | "capability_failed"
  | "capability_cancelled";

interface CommonReconcileOptions {
  readonly now: Date;
  readonly staleBefore: Date;
  readonly executionGeneration: number;
  readonly outboxEventId: string;
}

export interface WorkflowReconcilerStore {
  scanCandidates(options: {
    readonly now: Date;
    readonly staleBefore: Date;
    readonly batchSize: number;
  }): Promise<readonly ReconciliationCandidate[]>;
  reconcileWorkflowWakeup(
    workflowRunId: string,
    options: CommonReconcileOptions,
  ): Promise<ReconciliationResult>;
  reconcileWorkflowCancellation(
    workflowRunId: string,
    options: CommonReconcileOptions,
  ): Promise<ReconciliationResult>;
  reconcileAttemptDispatch(
    capabilityRunId: string,
    attemptId: string,
    options: CommonReconcileOptions,
  ): Promise<ReconciliationResult>;
  reconcileCapabilityTerminal(
    workflowRunId: string,
    nodeRunId: string,
    capabilityRunId: string,
    options: CommonReconcileOptions,
  ): Promise<ReconciliationResult>;
  reconcileExpiredAttempt(
    capabilityRunId: string,
    attemptId: string,
    options: CommonReconcileOptions & {
      readonly nextAttemptId: string;
      readonly browserAssignmentEventId: string;
    },
  ): Promise<ReconciliationResult>;
}

export interface CreateWorkflowReconcilerStoreOptions {
  readonly instanceId: string;
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
  readonly budgetGate?: AttemptFailureBudgetGate;
}

interface IdRow extends RowDataPacket {
  readonly id: string;
}

interface AttemptCandidateRow extends RowDataPacket {
  readonly capabilityRunId: string;
  readonly attemptId: string;
}

interface CapabilityCandidateRow extends RowDataPacket {
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
}

interface WorkflowRepairRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly updatedAt: Date;
}

interface CapabilityRepairRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly nodeRunId: string | null;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly contractRevisionId: string;
  readonly bindingId: string;
  readonly lifecycleStatus: string;
  readonly currentAttemptId: string | null;
  readonly acceptedAttemptId: string | null;
  readonly implementationRevisionId: string;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly updatedAt: Date;
}

interface AttemptRepairRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly attemptNumber: number;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly transitionKind: "initial" | "retry" | "fallback";
  readonly transitionReasonCode: string;
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
  readonly sideEffectState: "not_started" | "started" | "committed" | "unknown";
  readonly notBefore: Date;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

interface BrowserAssignmentRepairRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly browserExecutorSessionId: string;
  readonly capabilityAttemptId: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly state: string;
  readonly stableReasonCode: string | null;
  readonly leaseExpiresAt: Date;
  readonly terminalAt: Date | null;
}

interface CandidateAuthorityRow extends RowDataPacket {
  readonly bindingId: string;
  readonly bindingWorkspaceId: string;
  readonly bindingContractRevisionId: string;
  readonly bindingLifecycleStatus: string;
  readonly contractDigest: string;
  readonly contractLifecycleStatus: string;
  readonly implementationRevisionId: string;
  readonly implementationWorkspaceId: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
  readonly implementationDigest: string;
  readonly implementationLifecycleStatus: string;
}

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId: string | null;
  readonly nodeRunId: string | null;
  readonly routeSnapshot: unknown;
}

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

function assertBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("Reconciler batch size must be between 1 and 100.");
  }
}

async function hasPendingOutbox(
  connection: PoolConnection,
  messageType: string,
  aggregateId: string,
): Promise<boolean> {
  const [rows] = await connection.execute<IdRow[]>(
    `SELECT id
     FROM outbox_event
     WHERE message_type = ?
       AND aggregate_id = ?
       AND status IN ('pending', 'leased', 'quarantined')
     LIMIT 1`,
    [messageType, aggregateId],
  );
  return rows.length > 0;
}

async function insertOutbox(
  connection: PoolConnection,
  options: {
    readonly id: string;
    readonly workspaceId: string;
    readonly messageType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly availableAt: Date;
    readonly createdAt: Date;
  },
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO outbox_event (
       id,
       workspace_id,
       message_type,
       aggregate_type,
       aggregate_id,
       aggregate_version,
       payload,
       status,
       available_at,
       publish_attempts,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    [
      options.id,
      options.workspaceId,
      options.messageType,
      options.aggregateType,
      options.aggregateId,
      options.aggregateVersion,
      JSON.stringify(options.payload),
      options.availableAt,
      options.createdAt,
    ],
  );
}

interface PinnedAttemptAuthority {
  readonly route: PinnedCapabilityRoute;
  readonly executionTarget: ExecutionTarget;
  readonly executable: boolean;
}

async function loadPinnedAttemptAuthority(
  connection: PoolConnection,
  capability: CapabilityRepairRow,
  attempt: AttemptRepairRow,
  context: ExecutionContextRow,
): Promise<PinnedAttemptAuthority> {
  const route = parsePinnedCapabilityRoute(context.routeSnapshot);
  const candidate = findPinnedCandidate(route, attempt.routeCandidateIndex);
  const [rows] = await connection.execute<CandidateAuthorityRow[]>(
    `SELECT
       binding.id AS bindingId,
       binding.workspace_id AS bindingWorkspaceId,
       binding.contract_revision_id AS bindingContractRevisionId,
       binding.lifecycle_status AS bindingLifecycleStatus,
       contract.canonical_digest AS contractDigest,
       contract.lifecycle_status AS contractLifecycleStatus,
       implementation.id AS implementationRevisionId,
       implementation.workspace_id AS implementationWorkspaceId,
       implementation.execution_target AS executionTarget,
       implementation.adapter_key AS adapterKey,
       implementation.canonical_digest AS implementationDigest,
       implementation.lifecycle_status AS implementationLifecycleStatus
     FROM capability_binding AS binding
     INNER JOIN capability_contract_revision AS contract
       ON contract.id = binding.contract_revision_id
       AND contract.workspace_id = binding.workspace_id
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.id = ?
       AND implementation.workspace_id = binding.workspace_id
     WHERE binding.id = ?
       AND binding.workspace_id = ?
     LIMIT 1
     FOR UPDATE`,
    [
      attempt.implementationRevisionId,
      attempt.bindingId,
      capability.workspaceId,
    ],
  );
  const authority = rows[0];
  if (
    !authority ||
    authority.bindingId !== attempt.bindingId ||
    authority.bindingWorkspaceId !== capability.workspaceId ||
    authority.bindingContractRevisionId !== capability.contractRevisionId ||
    authority.implementationRevisionId !== attempt.implementationRevisionId ||
    authority.implementationWorkspaceId !== capability.workspaceId ||
    !isExecutionTarget(authority.executionTarget) ||
    !isExecutionTarget(attempt.executionTarget)
  ) {
    throw new Error(
      "Attempt route authority does not match its immutable plan.",
    );
  }
  assertPinnedRouteIdentity(route, {
    nodeKey: route.nodeKey,
    contractRevisionId: capability.contractRevisionId,
    contractDigest: authority.contractDigest,
  });
  assertPinnedCandidateIdentity(candidate, {
    candidateIndex: attempt.routeCandidateIndex,
    bindingId: attempt.bindingId,
    implementationRevisionId: attempt.implementationRevisionId,
    implementationDigest: authority.implementationDigest,
    executionTarget: authority.executionTarget,
    adapterKey: authority.adapterKey,
  });
  if (authority.executionTarget !== attempt.executionTarget) {
    throw new Error(
      "Attempt execution target does not match its pinned candidate.",
    );
  }
  return Object.freeze({
    route,
    executionTarget: authority.executionTarget,
    executable:
      ["active", "disabled"].includes(authority.bindingLifecycleStatus) &&
      ["published", "deprecated"].includes(authority.contractLifecycleStatus) &&
      ["published", "deprecated"].includes(
        authority.implementationLifecycleStatus,
      ),
  });
}

async function lockBrowserAssignment(
  connection: PoolConnection,
  capability: CapabilityRepairRow,
  attempt: AttemptRepairRow,
): Promise<BrowserAssignmentRepairRow> {
  const [rows] = await connection.execute<BrowserAssignmentRepairRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       browser_executor_session_id AS browserExecutorSessionId,
       capability_attempt_id AS capabilityAttemptId,
       attempt_lease_generation AS attemptLeaseGeneration,
       execution_generation AS executionGeneration,
       state,
       stable_reason_code AS stableReasonCode,
       lease_expires_at AS leaseExpiresAt,
       terminal_at AS terminalAt
     FROM browser_attempt_assignment
     WHERE capability_attempt_id = ?
     LIMIT 1
     FOR UPDATE`,
    [attempt.id],
  );
  const assignment = rows[0];
  const active =
    assignment?.state === "active" || assignment?.state === "cancel_requested";
  const alreadyFenced =
    assignment?.state === "revoked" &&
    assignment.stableReasonCode !== null &&
    assignment.terminalAt !== null;
  if (
    !assignment ||
    assignment.workspaceId !== capability.workspaceId ||
    assignment.capabilityAttemptId !== attempt.id ||
    assignment.attemptLeaseGeneration !== attempt.leaseGeneration ||
    (!active && !alreadyFenced) ||
    !attempt.leaseExpiresAt ||
    assignment.leaseExpiresAt.getTime() !== attempt.leaseExpiresAt.getTime()
  ) {
    throw new Error(
      "Running browser attempt has no consistent active assignment.",
    );
  }
  return assignment;
}

async function expireBrowserAssignment(
  connection: PoolConnection,
  assignment: BrowserAssignmentRepairRow,
  options: CommonReconcileOptions & {
    readonly browserAssignmentEventId: string;
  },
  stableReasonCode: string,
): Promise<void> {
  if (assignment.state === "revoked") {
    return;
  }
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE browser_attempt_assignment
     SET state = 'expired',
         stable_reason_code = ?,
         lease_expires_at = LEAST(lease_expires_at, ?),
         terminal_at = ?,
         updated_at = ?
     WHERE id = ?
       AND state IN ('active', 'cancel_requested')
       AND attempt_lease_generation = ?
       AND execution_generation = ?`,
    [
      stableReasonCode,
      options.now,
      options.now,
      options.now,
      assignment.id,
      assignment.attemptLeaseGeneration,
      assignment.executionGeneration,
    ],
  );
  if (updated.affectedRows !== 1) {
    throw new Error(
      "Browser assignment changed while its attempt was expiring.",
    );
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO browser_attempt_assignment_event (
       id,
       workspace_id,
       browser_attempt_assignment_id,
       event_key,
       event_type,
       attempt_lease_generation,
       execution_generation,
       stable_reason_code,
       occurred_at,
       recorded_at
     ) VALUES (?, ?, ?, ?, 'expired', ?, ?, ?, ?, ?)`,
    [
      options.browserAssignmentEventId,
      assignment.workspaceId,
      assignment.id,
      `expired:${String(assignment.attemptLeaseGeneration)}:${String(
        assignment.executionGeneration,
      )}`,
      assignment.attemptLeaseGeneration,
      assignment.executionGeneration,
      stableReasonCode,
      options.now,
      options.now,
    ],
  );
}

export function createWorkflowReconcilerStore(
  pool: Pool,
  options: CreateWorkflowReconcilerStoreOptions,
): WorkflowReconcilerStore {
  const instanceId = options.instanceId;
  const executionTargetGate: ExecutionTargetGate = createExecutionTargetGate(
    options.enabledExecutionTargets,
  );
  const failureDependencies: AttemptFailureTransitionDependencies = {
    executionTargetGate,
    budgetGate: options.budgetGate ?? (() => true),
  };
  return Object.freeze<WorkflowReconcilerStore>({
    async scanCandidates(options) {
      assertBatchSize(options.batchSize);
      const [expiredRows] = await pool.query<AttemptCandidateRow[]>(
        `SELECT
           attempt.capability_run_id AS capabilityRunId,
           attempt.id AS attemptId
         FROM capability_attempt AS attempt
         INNER JOIN capability_run AS capability
           ON capability.id = attempt.capability_run_id
           AND capability.current_attempt_id = attempt.id
           AND capability.lifecycle_status IN ('queued', 'running')
         WHERE (
           (
             attempt.lifecycle_status = 'created'
             AND attempt.execution_deadline_at <= ?
           )
           OR (
             attempt.lifecycle_status = 'running'
             AND attempt.execution_target <> 'provider'
             AND (
               attempt.lease_expires_at <= ?
               OR (
                 attempt.cancel_requested_at IS NOT NULL
                 AND attempt.cancel_deadline_at <= ?
               )
               OR (
                 capability.cancel_requested_at IS NOT NULL
                 AND capability.cancel_deadline_at <= ?
               )
             )
           )
         )
         ORDER BY
           LEAST(
             COALESCE(
               attempt.execution_deadline_at,
               '9999-12-31 23:59:59.999'
             ),
             COALESCE(attempt.lease_expires_at, '9999-12-31 23:59:59.999'),
             COALESCE(attempt.cancel_deadline_at, '9999-12-31 23:59:59.999'),
             COALESCE(
               capability.cancel_deadline_at,
               '9999-12-31 23:59:59.999'
             )
           ),
           attempt.id
         LIMIT ?`,
        [options.now, options.now, options.now, options.now, options.batchSize],
      );
      const [terminalRows] = await pool.query<CapabilityCandidateRow[]>(
        `SELECT
           workflow.id AS workflowRunId,
           node.id AS nodeRunId,
           capability.id AS capabilityRunId
         FROM capability_run AS capability
         INNER JOIN node_run AS node
           ON node.id = capability.node_run_id
           AND node.lifecycle_status = 'running'
         INNER JOIN workflow_run AS workflow
           ON workflow.id = node.workflow_run_id
           AND workflow.lifecycle_status IN ('running', 'cancelling')
         WHERE capability.lifecycle_status IN (
             'completed',
             'failed',
             'cancelled'
           )
           AND capability.updated_at <= ?
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_event AS event
             WHERE event.aggregate_id = capability.id
               AND event.message_type = CASE capability.lifecycle_status
                 WHEN 'completed' THEN 'capability.run.completed'
                 WHEN 'failed' THEN 'capability.run.failed'
                 ELSE 'capability.run.cancelled'
               END
               AND event.status IN ('pending', 'leased', 'quarantined')
           )
         ORDER BY capability.updated_at, capability.id
         LIMIT ?`,
        [options.staleBefore, options.batchSize],
      );
      const [dispatchRows] = await pool.query<AttemptCandidateRow[]>(
        `SELECT
           attempt.capability_run_id AS capabilityRunId,
           attempt.id AS attemptId
         FROM capability_attempt AS attempt
         INNER JOIN capability_run AS capability
           ON capability.id = attempt.capability_run_id
           AND capability.current_attempt_id = attempt.id
           AND capability.lifecycle_status IN ('queued', 'running')
           AND capability.cancel_requested_at IS NULL
         LEFT JOIN node_run AS node
           ON node.id = capability.node_run_id
         LEFT JOIN workflow_run AS workflow
           ON workflow.id = node.workflow_run_id
         WHERE attempt.lifecycle_status = 'created'
           AND attempt.execution_target IN ('worker', 'provider')
           AND attempt.cancel_requested_at IS NULL
           AND attempt.not_before <= ?
           AND attempt.updated_at <= ?
           AND (
             capability.invocation_kind <> 'workflow'
             OR (
               workflow.lifecycle_status = 'running'
               AND workflow.cancel_requested_at IS NULL
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_event AS event
             WHERE event.aggregate_id = attempt.id
               AND event.message_type = 'attempt.dispatch.requested'
               AND event.status IN ('pending', 'leased', 'quarantined')
           )
         ORDER BY attempt.updated_at, attempt.id
         LIMIT ?`,
        [options.now, options.staleBefore, options.batchSize],
      );
      const [workflowCancellationRows] = await pool.query<IdRow[]>(
        `SELECT run.id
         FROM workflow_run AS run
         WHERE run.lifecycle_status = 'cancelling'
           AND run.cancel_requested_at IS NOT NULL
           AND run.updated_at <= ?
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_event AS event
             WHERE event.aggregate_id = run.id
               AND event.message_type = 'workflow.cancel.requested'
               AND event.status IN ('pending', 'leased', 'quarantined')
           )
         ORDER BY run.updated_at, run.id
         LIMIT ?`,
        [options.staleBefore, options.batchSize],
      );
      const [workflowRows] = await pool.query<IdRow[]>(
        `SELECT run.id
         FROM workflow_run AS run
         WHERE run.lifecycle_status = 'queued'
           AND run.updated_at <= ?
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_event AS event
             WHERE event.aggregate_id = run.id
               AND event.message_type = 'workflow.wakeup.requested'
               AND event.status IN ('pending', 'leased', 'quarantined')
           )
         ORDER BY run.updated_at, run.id
         LIMIT ?`,
        [options.staleBefore, options.batchSize],
      );

      return Object.freeze(
        [
          ...expiredRows.map<ReconciliationCandidate>((row) => ({
            kind: "expired_attempt",
            capabilityRunId: row.capabilityRunId,
            attemptId: row.attemptId,
          })),
          ...terminalRows.map<ReconciliationCandidate>((row) => ({
            kind: "capability_terminal",
            workflowRunId: row.workflowRunId,
            nodeRunId: row.nodeRunId,
            capabilityRunId: row.capabilityRunId,
          })),
          ...workflowCancellationRows.map<ReconciliationCandidate>((row) => ({
            kind: "workflow_cancel",
            workflowRunId: row.id,
          })),
          ...dispatchRows.map<ReconciliationCandidate>((row) => ({
            kind: "attempt_dispatch",
            capabilityRunId: row.capabilityRunId,
            attemptId: row.attemptId,
          })),
          ...workflowRows.map<ReconciliationCandidate>((row) => ({
            kind: "workflow_wakeup",
            workflowRunId: row.id,
          })),
        ].slice(0, options.batchSize),
      );
    },

    async reconcileWorkflowWakeup(workflowRunId, options) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<WorkflowRepairRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             version,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             updated_at AS updatedAt
           FROM workflow_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [workflowRunId],
        );
        const run = rows[0];
        if (
          !run ||
          run.lifecycleStatus !== "queued" ||
          run.cancelRequestedAt ||
          run.updatedAt > options.staleBefore ||
          (await hasPendingOutbox(
            connection,
            "workflow.wakeup.requested",
            run.id,
          ))
        ) {
          return "noop";
        }
        const nextVersion = run.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE workflow_run
           SET version = ?, updated_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = 'queued'
             AND cancel_requested_at IS NULL`,
          [nextVersion, options.now, run.id, run.version],
        );
        if (updated.affectedRows !== 1) {
          return "noop";
        }
        await insertOutbox(connection, {
          id: options.outboxEventId,
          workspaceId: run.workspaceId,
          messageType: "workflow.wakeup.requested",
          aggregateType: "workflow_run",
          aggregateId: run.id,
          aggregateVersion: nextVersion,
          payload: {
            workflowRunId: run.id,
            cause: "reconciler.redis_recovery",
            expectedGeneration: options.executionGeneration,
          },
          availableAt: options.now,
          createdAt: options.now,
        });
        return "workflow_wakeup_rebuilt";
      });
    },

    async reconcileWorkflowCancellation(workflowRunId, options) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<WorkflowRepairRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             version,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             updated_at AS updatedAt
           FROM workflow_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [workflowRunId],
        );
        const run = rows[0];
        if (
          !run ||
          run.lifecycleStatus !== "cancelling" ||
          !run.cancelRequestedAt ||
          !run.cancelDeadlineAt ||
          run.updatedAt > options.staleBefore ||
          (await hasPendingOutbox(
            connection,
            "workflow.cancel.requested",
            run.id,
          ))
        ) {
          return "noop";
        }
        const nextVersion = run.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE workflow_run
           SET version = ?, updated_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = 'cancelling'
             AND cancel_requested_at IS NOT NULL`,
          [nextVersion, options.now, run.id, run.version],
        );
        if (updated.affectedRows !== 1) {
          return "noop";
        }
        await insertOutbox(connection, {
          id: options.outboxEventId,
          workspaceId: run.workspaceId,
          messageType: "workflow.cancel.requested",
          aggregateType: "workflow_run",
          aggregateId: run.id,
          aggregateVersion: nextVersion,
          payload: {
            workflowRunId: run.id,
            expectedGeneration: options.executionGeneration,
            cause: "reconciler.redis_recovery",
          },
          availableAt: options.now,
          createdAt: options.now,
        });
        return "workflow_cancel_rebuilt";
      });
    },

    async reconcileAttemptDispatch(capabilityRunId, attemptId, options) {
      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<
          CapabilityRepairRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               invocation_kind AS invocationKind,
               contract_revision_id AS contractRevisionId,
               binding_id AS bindingId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt,
               updated_at AS updatedAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.currentAttemptId !== attemptId ||
          capability.acceptedAttemptId ||
          capability.cancelRequestedAt ||
          !["queued", "running"].includes(capability.lifecycleStatus)
        ) {
          return "noop";
        }
        const [attemptRows] = await connection.execute<AttemptRepairRow[]>(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             attempt_number AS attemptNumber,
             binding_id AS bindingId,
             route_candidate_index AS routeCandidateIndex,
             candidate_attempt_number AS candidateAttemptNumber,
             transition_kind AS transitionKind,
             transition_reason_code AS transitionReasonCode,
             execution_target AS executionTarget,
             implementation_revision_id AS implementationRevisionId,
             side_effect_state AS sideEffectState,
             not_before AS notBefore,
             lease_generation AS leaseGeneration,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version,
             updated_at AS updatedAt
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
          [attemptId, capabilityRunId],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          !isQueueExecutionTarget(attempt.executionTarget) ||
          attempt.lifecycleStatus !== "created" ||
          attempt.cancelRequestedAt ||
          attempt.notBefore > options.now ||
          !attempt.executionDeadlineAt ||
          attempt.executionDeadlineAt <= options.now ||
          attempt.updatedAt > options.staleBefore ||
          (await hasPendingOutbox(
            connection,
            "attempt.dispatch.requested",
            attempt.id,
          ))
        ) {
          return "noop";
        }
        const [contextRows] = await connection.execute<ExecutionContextRow[]>(
          `SELECT
             capability.invocation_kind AS invocationKind,
             workflow.id AS workflowRunId,
             node.id AS nodeRunId,
             capability.route_snapshot AS routeSnapshot
           FROM capability_run AS capability
           LEFT JOIN node_run AS node
             ON node.id = capability.node_run_id
            AND node.workspace_id = capability.workspace_id
           LEFT JOIN workflow_run AS workflow
             ON workflow.id = node.workflow_run_id
            AND workflow.workspace_id = capability.workspace_id
           WHERE capability.id = ?
           LIMIT 1`,
          [capability.id],
        );
        const context = contextRows[0];
        if (
          !context ||
          context.invocationKind !== capability.invocationKind ||
          context.nodeRunId !== capability.nodeRunId ||
          (capability.invocationKind === "workflow"
            ? context.workflowRunId === null
            : context.workflowRunId !== null)
        ) {
          throw new Error("Attempt reconciliation context is missing.");
        }
        const authority = await loadPinnedAttemptAuthority(
          connection,
          capability,
          attempt,
          context,
        );
        if (
          !authority.executable ||
          !executionTargetGate.allows(authority.executionTarget)
        ) {
          return "noop";
        }
        const executionTarget = authority.executionTarget;
        const nextVersion = attempt.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
           SET version = ?, updated_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = 'created'
             AND cancel_requested_at IS NULL`,
          [nextVersion, options.now, attempt.id, attempt.version],
        );
        if (updated.affectedRows !== 1) {
          return "noop";
        }
        await insertOutbox(connection, {
          id: options.outboxEventId,
          workspaceId: capability.workspaceId,
          messageType: "attempt.dispatch.requested",
          aggregateType: "capability_attempt",
          aggregateId: attempt.id,
          aggregateVersion: nextVersion,
          payload: {
            ...(context.invocationKind === "workflow"
              ? {
                  workflowRunId: context.workflowRunId,
                  nodeRunId: context.nodeRunId,
                }
              : { invocationKind: context.invocationKind }),
            capabilityRunId: capability.id,
            attemptId: attempt.id,
            executionTarget,
            expectedGeneration: options.executionGeneration,
            cause: "reconciler.redis_recovery",
          },
          availableAt: options.now,
          createdAt: options.now,
        });
        return "attempt_dispatch_rebuilt";
      });
    },

    async reconcileCapabilityTerminal(
      workflowRunId,
      nodeRunId,
      capabilityRunId,
      options,
    ) {
      return inTransaction(pool, async (connection) => {
        const [runRows] = await connection.execute<WorkflowRepairRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             version,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             updated_at AS updatedAt
           FROM workflow_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [workflowRunId],
        );
        const run = runRows[0];
        if (!run || !["running", "cancelling"].includes(run.lifecycleStatus)) {
          return "noop";
        }
        const [nodeRows] = await connection.execute<IdRow[]>(
          `SELECT id
           FROM node_run
           WHERE id = ?
             AND workflow_run_id = ?
             AND lifecycle_status IN ('queued', 'running')
           LIMIT 1
           FOR UPDATE`,
          [nodeRunId, workflowRunId],
        );
        if (!nodeRows[0]) {
          return "noop";
        }
        const [capabilityRows] = await connection.execute<
          CapabilityRepairRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               invocation_kind AS invocationKind,
               contract_revision_id AS contractRevisionId,
               binding_id AS bindingId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt,
               updated_at AS updatedAt
             FROM capability_run
             WHERE id = ?
               AND node_run_id = ?
             LIMIT 1
             FOR UPDATE`,
          [capabilityRunId, nodeRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          !["completed", "failed", "cancelled"].includes(
            capability.lifecycleStatus,
          ) ||
          capability.updatedAt > options.staleBefore
        ) {
          return "noop";
        }
        const messageType = {
          completed: "capability.run.completed",
          failed: "capability.run.failed",
          cancelled: "capability.run.cancelled",
        }[capability.lifecycleStatus];
        if (!messageType) {
          return "noop";
        }
        if (await hasPendingOutbox(connection, messageType, capability.id)) {
          return "noop";
        }
        const nextVersion = capability.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_run
           SET version = ?, updated_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = ?`,
          [
            nextVersion,
            options.now,
            capability.id,
            capability.version,
            capability.lifecycleStatus,
          ],
        );
        if (updated.affectedRows !== 1) {
          return "noop";
        }
        await insertOutbox(connection, {
          id: options.outboxEventId,
          workspaceId: capability.workspaceId,
          messageType,
          aggregateType: "capability_run",
          aggregateId: capability.id,
          aggregateVersion: nextVersion,
          payload: {
            workflowRunId: run.id,
            nodeRunId,
            capabilityRunId: capability.id,
            expectedGeneration: options.executionGeneration,
            cause: "reconciler.redis_recovery",
          },
          availableAt: options.now,
          createdAt: options.now,
        });
        return "capability_terminal_rebuilt";
      });
    },

    async reconcileExpiredAttempt(capabilityRunId, attemptId, options) {
      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<
          CapabilityRepairRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               invocation_kind AS invocationKind,
               contract_revision_id AS contractRevisionId,
               binding_id AS bindingId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt,
               updated_at AS updatedAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          !["queued", "running"].includes(capability.lifecycleStatus) ||
          capability.currentAttemptId !== attemptId ||
          capability.acceptedAttemptId
        ) {
          return "noop";
        }
        const [attemptRows] = await connection.execute<AttemptRepairRow[]>(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             attempt_number AS attemptNumber,
             binding_id AS bindingId,
             route_candidate_index AS routeCandidateIndex,
             candidate_attempt_number AS candidateAttemptNumber,
             transition_kind AS transitionKind,
             transition_reason_code AS transitionReasonCode,
             execution_target AS executionTarget,
             implementation_revision_id AS implementationRevisionId,
             side_effect_state AS sideEffectState,
             not_before AS notBefore,
             lease_generation AS leaseGeneration,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version,
             updated_at AS updatedAt
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
          [attemptId, capabilityRunId],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          !["created", "running"].includes(attempt.lifecycleStatus)
        ) {
          return "noop";
        }
        if (
          attempt.lifecycleStatus === "running" &&
          attempt.executionTarget === "provider"
        ) {
          return "noop";
        }
        const browserAssignment =
          attempt.executionTarget === "browser" &&
          attempt.lifecycleStatus === "running"
            ? await lockBrowserAssignment(connection, capability, attempt)
            : undefined;
        const leaseExpired =
          attempt.lifecycleStatus === "running" &&
          attempt.leaseExpiresAt !== null &&
          attempt.leaseExpiresAt <= options.now;
        const executionDeadlineElapsed =
          attempt.executionDeadlineAt !== null &&
          attempt.executionDeadlineAt <= options.now;
        const cancelRequestedAt =
          capability.cancelRequestedAt ?? attempt.cancelRequestedAt;
        const cancelDeadlineAt =
          capability.cancelDeadlineAt ?? attempt.cancelDeadlineAt;
        const cancellationRequested =
          cancelRequestedAt !== null && cancelDeadlineAt !== null;
        const cancellationDeadlineElapsed =
          cancelDeadlineAt !== null && cancelDeadlineAt <= options.now;
        if (
          !leaseExpired &&
          !executionDeadlineElapsed &&
          !cancellationDeadlineElapsed
        ) {
          return "noop";
        }
        const [contextRows] = await connection.execute<ExecutionContextRow[]>(
          `SELECT
             capability.invocation_kind AS invocationKind,
             workflow.id AS workflowRunId,
             node.id AS nodeRunId,
             capability.route_snapshot AS routeSnapshot
           FROM capability_run AS capability
           LEFT JOIN node_run AS node
             ON node.id = capability.node_run_id
            AND node.workspace_id = capability.workspace_id
           LEFT JOIN workflow_run AS workflow
             ON workflow.id = node.workflow_run_id
            AND workflow.workspace_id = capability.workspace_id
           WHERE capability.id = ?
           LIMIT 1`,
          [capability.id],
        );
        const context = contextRows[0];
        if (
          !context ||
          context.invocationKind !== capability.invocationKind ||
          context.nodeRunId !== capability.nodeRunId ||
          (capability.invocationKind === "workflow"
            ? context.workflowRunId === null
            : context.workflowRunId !== null)
        ) {
          throw new Error("Expired attempt reconciliation context is missing.");
        }
        if (cancellationRequested) {
          let terminalSideEffectState = "unknown";
          if (attempt.sideEffectState === "not_started") {
            terminalSideEffectState = "not_started";
          } else if (attempt.sideEffectState === "committed") {
            terminalSideEffectState = "committed";
          }
          const retryDisposition =
            terminalSideEffectState === "not_started" ? "terminal" : "manual";
          const terminalAttemptLifecycle =
            attempt.lifecycleStatus === "created" ? "cancelled" : "abandoned";
          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
               SET lifecycle_status = ?,
                   side_effect_state = ?,
                   retry_disposition = ?,
                   cancel_requested_at = COALESCE(cancel_requested_at, ?),
                   cancel_deadline_at = COALESCE(cancel_deadline_at, ?),
                   lease_token_hash = NULL,
                   lease_expires_at = NULL,
                   error = ?,
                   version = version + 1,
                   updated_at = ?,
                   completed_at = ?
               WHERE id = ?
                 AND version = ?
                 AND lifecycle_status = ?`,
            [
              terminalAttemptLifecycle,
              terminalSideEffectState,
              retryDisposition,
              cancelRequestedAt,
              cancelDeadlineAt,
              JSON.stringify({
                code: cancellationDeadlineElapsed
                  ? "attempt_cancellation_deadline_expired"
                  : "attempt_cancelled_after_lease_expired",
                observedAt: options.now.toISOString(),
              }),
              options.now,
              options.now,
              attempt.id,
              attempt.version,
              attempt.lifecycleStatus,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            return "noop";
          }
          if (browserAssignment) {
            await expireBrowserAssignment(
              connection,
              browserAssignment,
              options,
              "browser.cancel_deadline_expired",
            );
          }
          const nextCapabilityVersion = capability.version + 1;
          const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
               SET lifecycle_status = 'cancelled',
                   cancel_requested_at = COALESCE(cancel_requested_at, ?),
                   cancel_deadline_at = COALESCE(cancel_deadline_at, ?),
                   version = ?,
                   updated_at = ?,
                   completed_at = ?
               WHERE id = ?
                 AND version = ?
                 AND lifecycle_status IN ('queued', 'running')
                 AND current_attempt_id = ?
                 AND accepted_attempt_id IS NULL`,
            [
              cancelRequestedAt,
              cancelDeadlineAt,
              nextCapabilityVersion,
              options.now,
              options.now,
              capability.id,
              capability.version,
              attempt.id,
            ],
          );
          if (capabilityUpdate.affectedRows !== 1) {
            throw new Error(
              "Capability cancellation lost its expired attempt transition.",
            );
          }
          await insertOutbox(connection, {
            id: options.outboxEventId,
            workspaceId: capability.workspaceId,
            messageType: "capability.run.cancelled",
            aggregateType: "capability_run",
            aggregateId: capability.id,
            aggregateVersion: nextCapabilityVersion,
            payload: {
              ...(context.invocationKind === "workflow"
                ? {
                    workflowRunId: context.workflowRunId,
                    nodeRunId: context.nodeRunId,
                  }
                : { invocationKind: context.invocationKind }),
              capabilityRunId: capability.id,
              expectedGeneration: options.executionGeneration,
              cause: cancellationDeadlineElapsed
                ? "reconciler.cancel_deadline_expired"
                : "reconciler.cancelled_after_lease_expired",
            },
            availableAt: options.now,
            createdAt: options.now,
          });
          return "capability_cancelled";
        }

        if (!isExecutionTarget(attempt.executionTarget)) {
          throw new Error(
            "Expired Attempt has an unsupported execution target.",
          );
        }
        let transitionCause: AttemptTransitionCause = "failed";
        if (
          attempt.lifecycleStatus !== "created" &&
          attempt.executionTarget === "browser"
        ) {
          transitionCause =
            browserAssignment?.state === "revoked"
              ? "browser_executor_fenced"
              : "browser_lease_expired";
        }
        let stableErrorCode = "attempt.lease_expired";
        if (attempt.lifecycleStatus === "created") {
          stableErrorCode = "attempt.execution_deadline_expired";
        } else if (transitionCause === "browser_executor_fenced") {
          stableErrorCode = "browser.executor_fenced";
        } else if (transitionCause === "browser_lease_expired") {
          stableErrorCode = "browser.lease_expired";
        }
        const transition = await transitionAttemptFailureInTransaction(
          connection,
          instanceId,
          {
            workspaceId: capability.workspaceId,
            capabilityRunId: capability.id,
            attemptId: attempt.id,
            nextAttemptId: options.nextAttemptId,
            outboxEventId: options.outboxEventId,
            executionGeneration: options.executionGeneration,
            target: {
              reporter: "reconciler",
              executionTarget: attempt.executionTarget,
              expectedAttemptVersion: attempt.version,
              ...(attempt.executionTarget === "browser"
                ? {
                    browserAssignmentEventId: options.browserAssignmentEventId,
                  }
                : {}),
            },
            failure: {
              stableErrorCode,
              sideEffectState: attempt.sideEffectState,
              retryability: "retryable",
              cause: transitionCause,
            },
            now: options.now,
          },
          failureDependencies,
        );
        switch (transition.status) {
          case "retried":
            return "attempt_retried";
          case "fallback":
            return "attempt_fallback";
          case "failed":
          case "manual":
            return "capability_failed";
          case "cancelled":
          case "noop":
            return "noop";
        }
      });
    },
  });
}
