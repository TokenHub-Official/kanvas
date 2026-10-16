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
  type PinnedRouteCandidate,
} from "./execution-plan.js";
import {
  evaluateAttemptTransition,
  type AttemptFailureRetryability,
  type AttemptSideEffectState,
  type AttemptTransitionCause,
  type AttemptTransitionDecision,
} from "./attempt-transition-policy.js";
import { retryDelayMs } from "./execution-retry-policy.js";
import {
  createExecutionTargetGate,
  isExecutionTarget,
  isQueueExecutionTarget,
  type ExecutionTarget,
  type ExecutionTargetGate,
} from "./execution-target.js";

export type AttemptFailureTransitionStatus =
  "retried" | "fallback" | "failed" | "manual" | "cancelled" | "noop";

export interface AttemptFailureTransitionResult {
  readonly status: AttemptFailureTransitionStatus;
  readonly reasonCode: string;
  readonly nextAttemptId?: string;
  readonly nextExecutionTarget?: ExecutionTarget;
}

export interface AttemptFailureFacts {
  readonly upstreamError?: {
    readonly statusCode: number;
    readonly requestId?: string;
    readonly body: string;
  };
  readonly stableErrorCode: string;
  readonly sideEffectState: AttemptSideEffectState;
  readonly retryability: AttemptFailureRetryability;
  readonly cause: AttemptTransitionCause;
  readonly evidenceDigest?: string;
  readonly stableIdempotencyKeyAvailable?: boolean;
}

export type AttemptFailureTargetIdentity =
  | {
      readonly reporter: "worker";
      readonly executionTarget: "worker";
      readonly implementationRevisionId: string;
      readonly implementationDigest: string;
      readonly adapterKey: string;
      readonly attemptLeaseGeneration: number;
      readonly domainLeaseTokenHash: string;
    }
  | {
      readonly reporter: "provider";
      readonly executionTarget: "provider";
      readonly implementationRevisionId: string;
      readonly implementationDigest: string;
      readonly adapterKey: string;
      readonly invocationId: string;
      readonly failureObservationId: string;
      readonly invocationLeaseGeneration: number;
      readonly routeCandidateDigest: string;
      readonly requestFingerprint: string;
      readonly stableRequestKey: string;
    }
  | {
      readonly reporter: "reconciler";
      readonly executionTarget: ExecutionTarget;
      readonly expectedAttemptVersion: number;
      readonly browserAssignmentEventId?: string;
    };

export interface ReportAttemptFailureOptions {
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly nextAttemptId: string;
  readonly outboxEventId: string;
  readonly executionGeneration: number;
  readonly target: AttemptFailureTargetIdentity;
  readonly failure: AttemptFailureFacts;
  readonly now: Date;
}

export interface AttemptFailureStore {
  reportAttemptFailure(
    options: ReportAttemptFailureOptions,
  ): Promise<AttemptFailureTransitionResult>;
}

export interface AttemptFailureBudgetContext {
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly decision: Exclude<
    AttemptTransitionDecision,
    { readonly action: "stop" }
  >;
  readonly nextCandidate: PinnedRouteCandidate;
}

export type AttemptFailureBudgetGate = (
  context: AttemptFailureBudgetContext,
) => boolean;

export interface CreateAttemptFailureStoreOptions {
  readonly instanceId: string;
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
  /**
   * Pure, synchronous policy hook. It must not perform I/O because it runs
   * while the Attempt transition transaction owns row locks.
   */
  readonly budgetGate?: AttemptFailureBudgetGate;
}

export type AttemptFailureStoreErrorCode =
  | "attempt_failure.invalid_argument"
  | "attempt_failure.identity_conflict"
  | "attempt_failure.runtime_fenced"
  | "attempt_failure.state_conflict";

export class AttemptFailureStoreError extends Error {
  public constructor(
    public readonly code: AttemptFailureStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttemptFailureStoreError";
  }
}

interface CapabilityRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly nodeRunId: string | null;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly contractRevisionId: string;
  readonly lifecycleStatus: string;
  readonly currentAttemptId: string | null;
  readonly acceptedAttemptId: string | null;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
}

interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly attemptNumber: number;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
  readonly sideEffectState: AttemptSideEffectState;
  readonly retryDisposition: string | null;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly error: unknown;
  readonly version: number;
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
  readonly deadline: Date | null;
}

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId: string | null;
  readonly nodeRunId: string | null;
  readonly routeSnapshot: unknown;
  readonly executionDeadlineAt: Date | null;
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

interface ProviderFailureTargetRow extends RowDataPacket {
  readonly invocationId: string;
  readonly workspaceId: string;
  readonly capabilityAttemptId: string;
  readonly implementationRevisionId: string;
  readonly routeCandidateDigest: string;
  readonly requestFingerprint: string;
  readonly stableRequestKey: string;
  readonly remoteStatus: string;
  readonly sideEffectState: string;
  readonly workState: string;
  readonly reconcileLeaseGeneration: number;
  readonly observationId: string;
  readonly observationStatus: string;
  readonly observationAdoption: string;
  readonly observationExecutionGeneration: number;
}

interface BrowserFailureTargetRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityAttemptId: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly state: string;
  readonly stableReasonCode: string | null;
  readonly leaseExpiresAt: Date;
  readonly terminalAt: Date | null;
}

interface PinnedAttemptAuthority {
  readonly route: PinnedCapabilityRoute;
  readonly candidate: PinnedRouteCandidate;
  readonly executionTarget: ExecutionTarget;
  readonly adapterKey: string;
  readonly implementationDigest: string;
  readonly executable: boolean;
}

export interface AttemptFailureTransitionDependencies {
  readonly executionTargetGate: ExecutionTargetGate;
  readonly budgetGate: AttemptFailureBudgetGate;
}

const kanvasIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const leaseTokenHashPattern = /^[a-f0-9]{64}$/;
const stableCodePattern = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const sideEffectStates = new Set<AttemptSideEffectState>([
  "not_started",
  "started",
  "committed",
  "unknown",
]);
const failureRetryabilities = new Set<AttemptFailureRetryability>([
  "retryable",
  "terminal",
  "manual",
]);
const transitionCauses = new Set<AttemptTransitionCause>([
  "browser_executor_fenced",
  "browser_lease_expired",
  "cancel_requested",
  "failed",
  "provider_result_unknown",
]);

function fail(code: AttemptFailureStoreErrorCode, message: string): never {
  throw new AttemptFailureStoreError(code, message);
}

function validateOptions(options: ReportAttemptFailureOptions): void {
  for (const [label, value] of [
    ["workspaceId", options.workspaceId],
    ["capabilityRunId", options.capabilityRunId],
    ["attemptId", options.attemptId],
    ["nextAttemptId", options.nextAttemptId],
    ["outboxEventId", options.outboxEventId],
  ] as const) {
    if (!kanvasIdPattern.test(value)) {
      fail(
        "attempt_failure.invalid_argument",
        `${label} must be a canonical Kanvas ULID.`,
      );
    }
  }
  if (
    !Number.isSafeInteger(options.executionGeneration) ||
    options.executionGeneration < 1 ||
    !(options.now instanceof Date) ||
    Number.isNaN(options.now.getTime()) ||
    !stableCodePattern.test(options.failure.stableErrorCode) ||
    !sideEffectStates.has(options.failure.sideEffectState) ||
    !failureRetryabilities.has(options.failure.retryability) ||
    !transitionCauses.has(options.failure.cause) ||
    (options.failure.stableIdempotencyKeyAvailable !== undefined &&
      typeof options.failure.stableIdempotencyKeyAvailable !== "boolean") ||
    (options.failure.evidenceDigest !== undefined &&
      !digestPattern.test(options.failure.evidenceDigest))
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Attempt failure generation, timestamp, code, or evidence is invalid.",
    );
  }
  const target = options.target;
  if (
    !isExecutionTarget(target.executionTarget) ||
    !["worker", "provider", "reconciler"].includes(target.reporter) ||
    (target.reporter === "worker" && target.executionTarget !== "worker") ||
    (target.reporter === "provider" && target.executionTarget !== "provider")
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Attempt failure reporter and execution target are invalid.",
    );
  }
  if (
    target.reporter !== "reconciler" &&
    (!kanvasIdPattern.test(target.implementationRevisionId) ||
      !digestPattern.test(target.implementationDigest) ||
      target.adapterKey.length < 1 ||
      target.adapterKey.length > 160)
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Attempt failure target implementation identity is invalid.",
    );
  }
  if (
    target.reporter === "worker" &&
    (!Number.isSafeInteger(target.attemptLeaseGeneration) ||
      target.attemptLeaseGeneration < 1 ||
      !leaseTokenHashPattern.test(target.domainLeaseTokenHash))
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Worker failure lease identity is invalid.",
    );
  }
  if (
    target.reporter === "provider" &&
    (!kanvasIdPattern.test(target.invocationId) ||
      !kanvasIdPattern.test(target.failureObservationId) ||
      !Number.isSafeInteger(target.invocationLeaseGeneration) ||
      target.invocationLeaseGeneration < 1 ||
      !digestPattern.test(target.routeCandidateDigest) ||
      !digestPattern.test(target.requestFingerprint) ||
      target.stableRequestKey.length < 1 ||
      target.stableRequestKey.length > 191)
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Provider failure target identity is invalid.",
    );
  }
  if (
    target.reporter === "reconciler" &&
    (!Number.isSafeInteger(target.expectedAttemptVersion) ||
      target.expectedAttemptVersion < 1 ||
      (target.browserAssignmentEventId !== undefined &&
        !kanvasIdPattern.test(target.browserAssignmentEventId)))
  ) {
    fail(
      "attempt_failure.invalid_argument",
      "Reconciler failure target identity is invalid.",
    );
  }
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

async function lockCapability(
  connection: PoolConnection,
  capabilityRunId: string,
): Promise<CapabilityRow | undefined> {
  const [rows] = await connection.execute<CapabilityRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       node_run_id AS nodeRunId,
       invocation_kind AS invocationKind,
       contract_revision_id AS contractRevisionId,
       lifecycle_status AS lifecycleStatus,
       current_attempt_id AS currentAttemptId,
       accepted_attempt_id AS acceptedAttemptId,
       version,
       cancel_requested_at AS cancelRequestedAt
     FROM capability_run
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [capabilityRunId],
  );
  return rows[0];
}

async function lockAttempt(
  connection: PoolConnection,
  capabilityRunId: string,
  attemptId: string,
): Promise<AttemptRow | undefined> {
  const [rows] = await connection.execute<AttemptRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       lifecycle_status AS lifecycleStatus,
       attempt_number AS attemptNumber,
       binding_id AS bindingId,
       route_candidate_index AS routeCandidateIndex,
       candidate_attempt_number AS candidateAttemptNumber,
       execution_target AS executionTarget,
       implementation_revision_id AS implementationRevisionId,
       side_effect_state AS sideEffectState,
       retry_disposition AS retryDisposition,
       lease_generation AS leaseGeneration,
       lease_token_hash AS leaseTokenHash,
       lease_expires_at AS leaseExpiresAt,
       execution_deadline_at AS executionDeadlineAt,
       cancel_requested_at AS cancelRequestedAt,
       error,
       version
     FROM capability_attempt
     WHERE id = ?
       AND capability_run_id = ?
     LIMIT 1
     FOR UPDATE`,
    [attemptId, capabilityRunId],
  );
  return rows[0];
}

function persistedFailureCode(error: unknown): string | undefined {
  let value = error;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const code = (value as Readonly<Record<string, unknown>>).code;
  return typeof code === "string" ? code : undefined;
}

function replayOrConflict(
  attempt: AttemptRow,
  stableErrorCode: string,
): AttemptFailureTransitionResult {
  if (
    ["failed", "abandoned"].includes(attempt.lifecycleStatus) &&
    persistedFailureCode(attempt.error) === stableErrorCode
  ) {
    return Object.freeze({
      status: "noop",
      reasonCode: stableErrorCode,
    });
  }
  return fail(
    "attempt_failure.state_conflict",
    "Attempt failure no longer owns the current transition.",
  );
}

async function lockRuntimeFence(
  connection: PoolConnection,
  instanceId: string,
  executionGeneration: number,
  now: Date,
): Promise<void> {
  const [rows] = await connection.execute<RuntimeStateRow[]>(
    `SELECT
       state,
       execution_generation AS executionGeneration,
       deadline
     FROM instance_runtime_state
     WHERE instance_id = ?
     LIMIT 1
     FOR SHARE`,
    [instanceId],
  );
  const runtime = rows[0];
  const drainAllowed =
    runtime?.state === "DRAINING" &&
    runtime.deadline !== null &&
    runtime.deadline > now;
  if (
    !runtime ||
    runtime.executionGeneration !== executionGeneration ||
    (runtime.state !== "ACTIVE" && !drainAllowed)
  ) {
    fail(
      "attempt_failure.runtime_fenced",
      "Runtime state or execution generation rejects failure transition.",
    );
  }
}

async function loadExecutionContext(
  connection: PoolConnection,
  capability: CapabilityRow,
): Promise<ExecutionContextRow> {
  const [rows] = await connection.execute<ExecutionContextRow[]>(
    `SELECT
       capability.invocation_kind AS invocationKind,
       workflow.id AS workflowRunId,
       node.id AS nodeRunId,
       capability.route_snapshot AS routeSnapshot,
       capability.execution_deadline_at AS executionDeadlineAt
     FROM capability_run AS capability
     LEFT JOIN node_run AS node
       ON node.id = capability.node_run_id
      AND node.workspace_id = capability.workspace_id
     LEFT JOIN workflow_run AS workflow
       ON workflow.id = node.workflow_run_id
      AND workflow.workspace_id = capability.workspace_id
     WHERE capability.id = ?
       AND capability.workspace_id = ?
     LIMIT 1`,
    [capability.id, capability.workspaceId],
  );
  const context = rows[0];
  if (
    !context ||
    context.invocationKind !== capability.invocationKind ||
    context.nodeRunId !== capability.nodeRunId ||
    (capability.invocationKind === "workflow"
      ? context.workflowRunId === null
      : context.workflowRunId !== null)
  ) {
    return fail(
      "attempt_failure.identity_conflict",
      "Attempt execution context is missing.",
    );
  }
  return context;
}

async function loadCandidateAuthority(
  connection: PoolConnection,
  capability: CapabilityRow,
  candidate: PinnedRouteCandidate,
): Promise<{
  readonly executionTarget: ExecutionTarget;
  readonly adapterKey: string;
  readonly implementationDigest: string;
  readonly contractDigest: string;
  readonly executable: boolean;
}> {
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
      candidate.implementationRevisionId,
      candidate.bindingId,
      capability.workspaceId,
    ],
  );
  const authority = rows[0];
  if (
    !authority ||
    authority.bindingId !== candidate.bindingId ||
    authority.bindingWorkspaceId !== capability.workspaceId ||
    authority.bindingContractRevisionId !== capability.contractRevisionId ||
    authority.implementationRevisionId !== candidate.implementationRevisionId ||
    authority.implementationWorkspaceId !== capability.workspaceId ||
    authority.implementationDigest !== candidate.implementationDigest ||
    authority.adapterKey !== candidate.adapterKey ||
    authority.executionTarget !== candidate.executionTarget ||
    !isExecutionTarget(authority.executionTarget)
  ) {
    return fail(
      "attempt_failure.identity_conflict",
      "Pinned candidate no longer matches its immutable authority.",
    );
  }
  return Object.freeze({
    executionTarget: authority.executionTarget,
    adapterKey: authority.adapterKey,
    implementationDigest: authority.implementationDigest,
    contractDigest: authority.contractDigest,
    executable:
      ["active", "disabled"].includes(authority.bindingLifecycleStatus) &&
      ["published", "deprecated"].includes(authority.contractLifecycleStatus) &&
      ["published", "deprecated"].includes(
        authority.implementationLifecycleStatus,
      ),
  });
}

async function loadPinnedAttemptAuthority(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  context: ExecutionContextRow,
): Promise<PinnedAttemptAuthority> {
  const route = parsePinnedCapabilityRoute(context.routeSnapshot);
  const candidate = findPinnedCandidate(route, attempt.routeCandidateIndex);
  assertPinnedCandidateIdentity(candidate, {
    candidateIndex: attempt.routeCandidateIndex,
    bindingId: attempt.bindingId,
    implementationRevisionId: attempt.implementationRevisionId,
    implementationDigest: candidate.implementationDigest,
    executionTarget: candidate.executionTarget,
    adapterKey: candidate.adapterKey,
  });
  const authority = await loadCandidateAuthority(
    connection,
    capability,
    candidate,
  );
  assertPinnedRouteIdentity(route, {
    nodeKey: route.nodeKey,
    contractRevisionId: capability.contractRevisionId,
    contractDigest: authority.contractDigest,
  });
  if (
    authority.executionTarget !== attempt.executionTarget ||
    !isExecutionTarget(attempt.executionTarget)
  ) {
    return fail(
      "attempt_failure.identity_conflict",
      "Attempt target differs from its pinned candidate.",
    );
  }
  return Object.freeze({
    route,
    candidate,
    executionTarget: authority.executionTarget,
    adapterKey: authority.adapterKey,
    implementationDigest: authority.implementationDigest,
    executable: authority.executable,
  });
}

async function lockProviderTarget(
  connection: PoolConnection,
  options: ReportAttemptFailureOptions,
  attempt: AttemptRow,
  target: Extract<
    AttemptFailureTargetIdentity,
    { readonly reporter: "provider" }
  >,
): Promise<void> {
  const [rows] = await connection.execute<ProviderFailureTargetRow[]>(
    `SELECT
       invocation.id AS invocationId,
       invocation.workspace_id AS workspaceId,
       invocation.capability_attempt_id AS capabilityAttemptId,
       invocation.implementation_revision_id AS implementationRevisionId,
       invocation.route_candidate_digest AS routeCandidateDigest,
       invocation.request_fingerprint AS requestFingerprint,
       invocation.stable_request_key AS stableRequestKey,
       invocation.remote_status AS remoteStatus,
       invocation.side_effect_state AS sideEffectState,
       invocation.work_state AS workState,
       invocation.reconcile_lease_generation AS reconcileLeaseGeneration,
       observation.id AS observationId,
       observation.normalized_status AS observationStatus,
       observation.adoption_outcome AS observationAdoption,
       observation.execution_generation AS observationExecutionGeneration
     FROM provider_invocation AS invocation
     INNER JOIN provider_invocation_observation AS observation
       ON observation.provider_invocation_id = invocation.id
       AND observation.id = ?
     WHERE invocation.id = ?
       AND invocation.capability_attempt_id = ?
     LIMIT 1
     FOR UPDATE`,
    [target.failureObservationId, target.invocationId, attempt.id],
  );
  const row = rows[0];
  if (
    !row ||
    row.workspaceId !== options.workspaceId ||
    row.capabilityAttemptId !== attempt.id ||
    row.implementationRevisionId !== target.implementationRevisionId ||
    row.routeCandidateDigest !== target.routeCandidateDigest ||
    row.requestFingerprint !== target.requestFingerprint ||
    row.stableRequestKey !== target.stableRequestKey ||
    row.reconcileLeaseGeneration !== target.invocationLeaseGeneration ||
    row.workState !== "terminal" ||
    row.remoteStatus === "succeeded" ||
    row.remoteStatus === "unknown" ||
    row.sideEffectState !== options.failure.sideEffectState ||
    row.observationStatus !== row.remoteStatus ||
    row.observationAdoption !== "applied" ||
    row.observationExecutionGeneration !== options.executionGeneration
  ) {
    fail(
      "attempt_failure.identity_conflict",
      "Provider terminal failure facts do not match the report.",
    );
  }
}

async function lockBrowserTarget(
  connection: PoolConnection,
  options: ReportAttemptFailureOptions,
  attempt: AttemptRow,
  target: Extract<
    AttemptFailureTargetIdentity,
    { readonly reporter: "reconciler" }
  >,
): Promise<BrowserFailureTargetRow> {
  const [rows] = await connection.execute<BrowserFailureTargetRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
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
  const fenced =
    assignment?.state === "revoked" &&
    assignment.stableReasonCode !== null &&
    assignment.terminalAt !== null;
  if (
    !assignment ||
    assignment.workspaceId !== options.workspaceId ||
    assignment.capabilityAttemptId !== attempt.id ||
    assignment.attemptLeaseGeneration !== attempt.leaseGeneration ||
    assignment.executionGeneration !== options.executionGeneration ||
    (!active && !fenced) ||
    (!fenced && assignment.leaseExpiresAt > options.now) ||
    !target.browserAssignmentEventId
  ) {
    return fail(
      "attempt_failure.identity_conflict",
      "Browser failure does not own an expired or fenced assignment.",
    );
  }
  return assignment;
}

async function lockTargetFacts(
  connection: PoolConnection,
  options: ReportAttemptFailureOptions,
  attempt: AttemptRow,
): Promise<BrowserFailureTargetRow | undefined> {
  const target = options.target;
  if (target.executionTarget !== attempt.executionTarget) {
    fail(
      "attempt_failure.identity_conflict",
      "Failure reporter target differs from the Attempt target.",
    );
  }
  if (target.reporter === "worker") {
    if (
      attempt.lifecycleStatus !== "running" ||
      attempt.leaseGeneration !== target.attemptLeaseGeneration ||
      attempt.leaseTokenHash !== target.domainLeaseTokenHash ||
      !attempt.leaseExpiresAt ||
      attempt.leaseExpiresAt <= options.now ||
      !attempt.executionDeadlineAt ||
      attempt.executionDeadlineAt <= options.now
    ) {
      fail(
        "attempt_failure.state_conflict",
        "Worker failure report lost its active Attempt lease.",
      );
    }
    return undefined;
  }
  if (target.reporter === "provider") {
    if (attempt.lifecycleStatus !== "running") {
      fail(
        "attempt_failure.state_conflict",
        "Provider failure report no longer owns a running Attempt.",
      );
    }
    await lockProviderTarget(connection, options, attempt, target);
    return undefined;
  }
  if (
    target.expectedAttemptVersion !== attempt.version ||
    !["created", "running"].includes(attempt.lifecycleStatus)
  ) {
    fail(
      "attempt_failure.state_conflict",
      "Reconciler failure report is stale.",
    );
  }
  if (attempt.lifecycleStatus === "created") {
    // Parameter rejection happens before a Provider invocation owns a lease.
    // It is already terminal; waiting for a deadline would hide the failure.
    if (
      attempt.executionTarget === "provider" &&
      attempt.sideEffectState === "not_started" &&
      options.failure.stableErrorCode ===
        "provider.parameter_resolution_rejected" &&
      options.failure.sideEffectState === "not_started" &&
      options.failure.retryability === "terminal" &&
      options.failure.cause === "failed"
    )
      return undefined;
    if (
      !attempt.executionDeadlineAt ||
      attempt.executionDeadlineAt > options.now
    ) {
      fail(
        "attempt_failure.state_conflict",
        "Created Attempt deadline has not elapsed.",
      );
    }
    return undefined;
  }
  if (attempt.executionTarget === "provider") {
    fail(
      "attempt_failure.state_conflict",
      "Generic Attempt reconciliation cannot expire Provider ownership.",
    );
  }
  if (attempt.executionTarget === "browser") {
    return lockBrowserTarget(connection, options, attempt, target);
  }
  if (!attempt.leaseExpiresAt || attempt.leaseExpiresAt > options.now) {
    fail(
      "attempt_failure.state_conflict",
      "Running Worker Attempt lease has not elapsed.",
    );
  }
  return undefined;
}

async function expireBrowserAssignment(
  connection: PoolConnection,
  options: ReportAttemptFailureOptions,
  assignment: BrowserFailureTargetRow,
): Promise<void> {
  if (assignment.state === "revoked") {
    return;
  }
  const target = options.target;
  if (target.reporter !== "reconciler" || !target.browserAssignmentEventId) {
    fail(
      "attempt_failure.identity_conflict",
      "Browser assignment terminal event identity is missing.",
    );
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
      options.failure.stableErrorCode,
      options.now,
      options.now,
      options.now,
      assignment.id,
      assignment.attemptLeaseGeneration,
      assignment.executionGeneration,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "attempt_failure.state_conflict",
      "Browser assignment changed during failure transition.",
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
      target.browserAssignmentEventId,
      options.workspaceId,
      assignment.id,
      `expired:${String(assignment.attemptLeaseGeneration)}:${String(
        assignment.executionGeneration,
      )}`,
      assignment.attemptLeaseGeneration,
      assignment.executionGeneration,
      options.failure.stableErrorCode,
      options.now,
      options.now,
    ],
  );
}

async function insertOutbox(
  connection: PoolConnection,
  options: {
    readonly id: string;
    readonly workspaceId: string;
    readonly messageType:
      "attempt.dispatch.requested" | "capability.run.failed";
    readonly aggregateType: "capability_attempt" | "capability_run";
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

function reporterMatchesAuthority(
  target: AttemptFailureTargetIdentity,
  attempt: AttemptRow,
  authority: PinnedAttemptAuthority,
): void {
  if (target.reporter === "reconciler") {
    return;
  }
  if (
    target.implementationRevisionId !== attempt.implementationRevisionId ||
    target.implementationDigest !== authority.implementationDigest ||
    target.adapterKey !== authority.adapterKey
  ) {
    fail(
      "attempt_failure.identity_conflict",
      "Failure reporter implementation differs from the pinned Attempt.",
    );
  }
}

function resultForStop(
  decision: Extract<AttemptTransitionDecision, { readonly action: "stop" }>,
  retryability: AttemptFailureRetryability,
): AttemptFailureTransitionResult {
  return Object.freeze({
    status:
      retryability === "manual" ||
      decision.reasonCode.includes("unsafe") ||
      decision.reasonCode.includes("provider_result_unknown") ||
      decision.reasonCode.includes("committed") ||
      decision.reasonCode.includes("keyed_without")
        ? "manual"
        : "failed",
    reasonCode: decision.reasonCode,
  });
}

/**
 * Shared transaction kernel. Callers that already own this transaction
 * (Provider observation reducer and Reconciler) use this directly.
 */
export async function transitionAttemptFailureInTransaction(
  connection: PoolConnection,
  instanceId: string,
  options: ReportAttemptFailureOptions,
  dependencies: AttemptFailureTransitionDependencies,
): Promise<AttemptFailureTransitionResult> {
  const capability = await lockCapability(connection, options.capabilityRunId);
  if (!capability || capability.workspaceId !== options.workspaceId) {
    return fail(
      "attempt_failure.identity_conflict",
      "Capability failure identity does not exist in the workspace.",
    );
  }
  const attempt = await lockAttempt(
    connection,
    capability.id,
    options.attemptId,
  );
  if (!attempt || attempt.workspaceId !== options.workspaceId) {
    return fail(
      "attempt_failure.identity_conflict",
      "Attempt failure identity does not belong to the capability.",
    );
  }
  if (
    capability.currentAttemptId !== attempt.id ||
    capability.acceptedAttemptId ||
    !["queued", "running"].includes(capability.lifecycleStatus)
  ) {
    return replayOrConflict(attempt, options.failure.stableErrorCode);
  }
  if (
    capability.cancelRequestedAt !== null ||
    attempt.cancelRequestedAt !== null
  ) {
    return Object.freeze({
      status: "cancelled",
      reasonCode: "attempt.transition.blocked.cancel_requested",
    });
  }

  // Required lock order: Capability -> Attempt -> target-specific facts.
  const browserAssignment = await lockTargetFacts(connection, options, attempt);
  await lockRuntimeFence(
    connection,
    instanceId,
    options.executionGeneration,
    options.now,
  );
  const context = await loadExecutionContext(connection, capability);
  const authority = await loadPinnedAttemptAuthority(
    connection,
    capability,
    attempt,
    context,
  );
  reporterMatchesAuthority(options.target, attempt, authority);

  const decision = evaluateAttemptTransition({
    route: authority.route,
    currentCandidateIndex: attempt.routeCandidateIndex,
    candidateAttemptNumber: attempt.candidateAttemptNumber,
    sideEffectState: options.failure.sideEffectState,
    cause: options.failure.cause,
    cancellationRequested: false,
    retryability: options.failure.retryability,
    ...(options.failure.stableIdempotencyKeyAvailable === undefined
      ? {}
      : {
          stableIdempotencyKeyAvailable:
            options.failure.stableIdempotencyKeyAvailable,
        }),
  });

  let transitionBlockedReason: string | undefined = authority.executable
    ? undefined
    : "attempt.transition.blocked.candidate_revoked";
  let nextCandidate: PinnedRouteCandidate | undefined;
  let nextExecutionTarget: ExecutionTarget | undefined;
  let nextNotBefore: Date | undefined;
  if (decision.action !== "stop" && transitionBlockedReason === undefined) {
    nextCandidate = findPinnedCandidate(
      authority.route,
      decision.action === "retry"
        ? decision.candidateIndex
        : decision.toCandidateIndex,
    );
    const nextAuthority = await loadCandidateAuthority(
      connection,
      capability,
      nextCandidate,
    );
    if (!nextAuthority.executable) {
      transitionBlockedReason = "attempt.transition.blocked.candidate_revoked";
    } else if (
      !dependencies.executionTargetGate.allows(nextAuthority.executionTarget)
    ) {
      transitionBlockedReason = "attempt.transition.blocked.target_disabled";
    } else if (
      !dependencies.budgetGate({
        workspaceId: options.workspaceId,
        capabilityRunId: capability.id,
        attemptId: attempt.id,
        decision,
        nextCandidate,
      })
    ) {
      transitionBlockedReason = "attempt.transition.blocked.budget_denied";
    } else {
      const proposedNotBefore =
        decision.action === "retry"
          ? new Date(
              options.now.getTime() +
                retryDelayMs(
                  nextCandidate.retryPolicy,
                  decision.nextCandidateAttemptNumber,
                ),
            )
          : options.now;
      if (
        context.executionDeadlineAt !== null &&
        proposedNotBefore >= context.executionDeadlineAt
      ) {
        transitionBlockedReason =
          "attempt.transition.blocked.workflow_deadline";
      } else {
        nextExecutionTarget = nextAuthority.executionTarget;
        nextNotBefore = proposedNotBefore;
      }
    }
  }
  const willTransition =
    decision.action !== "stop" &&
    transitionBlockedReason === undefined &&
    nextCandidate !== undefined &&
    nextExecutionTarget !== undefined &&
    nextNotBefore !== undefined;
  const terminalReason = transitionBlockedReason ?? decision.reasonCode;
  const reporterExpired =
    options.target.reporter === "reconciler" &&
    attempt.lifecycleStatus === "running";
  const terminalLifecycle = reporterExpired ? "abandoned" : "failed";
  const terminalSideEffectState =
    reporterExpired &&
    (options.failure.sideEffectState === "started" ||
      options.failure.sideEffectState === "unknown")
      ? "unknown"
      : options.failure.sideEffectState;
  let retryDisposition = "terminal";
  if (willTransition) {
    retryDisposition = "retryable";
  } else if (
    options.failure.retryability === "manual" ||
    terminalSideEffectState === "unknown" ||
    terminalSideEffectState === "committed" ||
    terminalReason.includes("unsafe") ||
    terminalReason.includes("keyed_without")
  ) {
    retryDisposition = "manual";
  }
  const [attemptUpdate] = await connection.execute<ResultSetHeader>(
    `UPDATE capability_attempt
       SET lifecycle_status = ?,
           side_effect_state = ?,
           retry_disposition = ?,
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           error = ?,
           version = version + 1,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND capability_run_id = ?
         AND version = ?
         AND lifecycle_status = ?
         AND cancel_requested_at IS NULL`,
    [
      terminalLifecycle,
      terminalSideEffectState,
      retryDisposition,
      JSON.stringify({
        code: options.failure.stableErrorCode,
        ...(options.failure.upstreamError
          ? { upstream: options.failure.upstreamError }
          : {}),
        transitionReasonCode: terminalReason,
        retryability: options.failure.retryability,
        sideEffectState: terminalSideEffectState,
        ...(options.failure.evidenceDigest
          ? { evidenceDigest: options.failure.evidenceDigest }
          : {}),
        observedAt: options.now.toISOString(),
      }),
      options.now,
      options.now,
      attempt.id,
      capability.id,
      attempt.version,
      attempt.lifecycleStatus,
    ],
  );
  if (attemptUpdate.affectedRows !== 1) {
    return fail(
      "attempt_failure.state_conflict",
      "Attempt failure lost terminal arbitration.",
    );
  }
  if (browserAssignment) {
    await expireBrowserAssignment(connection, options, browserAssignment);
  }

  if (willTransition && nextCandidate && nextExecutionTarget && nextNotBefore) {
    const candidateExecutionDeadlineAt = new Date(
      options.now.getTime() + nextCandidate.attemptTimeoutMs,
    );
    const executionDeadlineAt =
      context.executionDeadlineAt !== null &&
      context.executionDeadlineAt < candidateExecutionDeadlineAt
        ? context.executionDeadlineAt
        : candidateExecutionDeadlineAt;
    await connection.execute<ResultSetHeader>(
      `INSERT INTO capability_attempt (
         id,
         workspace_id,
         capability_run_id,
         binding_id,
         route_candidate_index,
         candidate_attempt_number,
         transition_kind,
         transition_reason_code,
         attempt_number,
         execution_target,
         implementation_revision_id,
         lifecycle_status,
         side_effect_state,
         not_before,
         execution_deadline_at,
         lease_generation,
         version,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         'created', 'not_started', ?, ?, 0, 1, ?, ?
       )`,
      [
        options.nextAttemptId,
        options.workspaceId,
        capability.id,
        nextCandidate.bindingId,
        nextCandidate.candidateIndex,
        decision.nextCandidateAttemptNumber,
        decision.action,
        decision.reasonCode,
        attempt.attemptNumber + 1,
        nextExecutionTarget,
        nextCandidate.implementationRevisionId,
        nextNotBefore,
        executionDeadlineAt,
        options.now,
        options.now,
      ],
    );
    const nextCapabilityVersion = capability.version + 1;
    const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE capability_run
         SET current_attempt_id = ?,
             version = ?,
             updated_at = ?
         WHERE id = ?
           AND version = ?
           AND lifecycle_status IN ('queued', 'running')
           AND current_attempt_id = ?
           AND accepted_attempt_id IS NULL
           AND cancel_requested_at IS NULL`,
      [
        options.nextAttemptId,
        nextCapabilityVersion,
        options.now,
        capability.id,
        capability.version,
        attempt.id,
      ],
    );
    if (capabilityUpdate.affectedRows !== 1) {
      return fail(
        "attempt_failure.state_conflict",
        "Capability current Attempt changed during failure transition.",
      );
    }
    if (isQueueExecutionTarget(nextExecutionTarget)) {
      await insertOutbox(connection, {
        id: options.outboxEventId,
        workspaceId: options.workspaceId,
        messageType: "attempt.dispatch.requested",
        aggregateType: "capability_attempt",
        aggregateId: options.nextAttemptId,
        aggregateVersion: 1,
        payload: {
          ...(context.invocationKind === "workflow"
            ? {
                workflowRunId: context.workflowRunId,
                nodeRunId: context.nodeRunId,
              }
            : { invocationKind: context.invocationKind }),
          capabilityRunId: capability.id,
          attemptId: options.nextAttemptId,
          executionTarget: nextExecutionTarget,
          expectedGeneration: options.executionGeneration,
          cause: decision.reasonCode,
        },
        availableAt: nextNotBefore,
        createdAt: options.now,
      });
    }
    return Object.freeze({
      status: decision.action === "retry" ? "retried" : "fallback",
      reasonCode: decision.reasonCode,
      nextAttemptId: options.nextAttemptId,
      nextExecutionTarget,
    });
  }

  const nextCapabilityVersion = capability.version + 1;
  const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
    `UPDATE capability_run
       SET lifecycle_status = 'failed',
           version = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND version = ?
         AND lifecycle_status IN ('queued', 'running')
         AND current_attempt_id = ?
         AND accepted_attempt_id IS NULL
         AND cancel_requested_at IS NULL`,
    [
      nextCapabilityVersion,
      options.now,
      options.now,
      capability.id,
      capability.version,
      attempt.id,
    ],
  );
  if (capabilityUpdate.affectedRows !== 1) {
    return fail(
      "attempt_failure.state_conflict",
      "Capability failure lost terminal arbitration.",
    );
  }
  await insertOutbox(connection, {
    id: options.outboxEventId,
    workspaceId: options.workspaceId,
    messageType: "capability.run.failed",
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
      cause: terminalReason,
    },
    availableAt: options.now,
    createdAt: options.now,
  });
  if (decision.action === "stop") {
    return resultForStop(decision, options.failure.retryability);
  }
  return Object.freeze({
    status: retryDisposition === "manual" ? "manual" : "failed",
    reasonCode: terminalReason,
  });
}

export function createAttemptFailureStore(
  pool: Pool,
  options: CreateAttemptFailureStoreOptions,
): AttemptFailureStore {
  if (options.instanceId.length < 1 || options.instanceId.length > 120) {
    fail(
      "attempt_failure.invalid_argument",
      "instanceId must contain 1-120 characters.",
    );
  }
  const dependencies: AttemptFailureTransitionDependencies = {
    executionTargetGate: createExecutionTargetGate(
      options.enabledExecutionTargets,
    ),
    budgetGate: options.budgetGate ?? (() => true),
  };
  return Object.freeze({
    reportAttemptFailure(report: ReportAttemptFailureOptions) {
      validateOptions(report);
      return inTransaction(pool, (connection) =>
        transitionAttemptFailureInTransaction(
          connection,
          options.instanceId,
          report,
          dependencies,
        ),
      );
    },
  });
}
