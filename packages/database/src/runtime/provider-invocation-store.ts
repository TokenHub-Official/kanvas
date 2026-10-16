import { parseProviderReportedCharge } from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { consumeInboxEvent, InboxDeliveryError } from "./inbox-receipt.js";
import {
  captureProviderResultEvidence,
  providerResultUrls,
} from "./provider-result-links.js";
import {
  completeAttemptInTransaction,
  type CompleteAttemptOptions,
} from "./attempt-completion-store.js";
import {
  transitionAttemptFailureInTransaction,
  type AttemptFailureBudgetGate,
  type AttemptFailureTransitionDependencies,
} from "./attempt-failure-store.js";
import {
  ProviderInvocationStoreError,
  type AppendProviderObservationOptions,
  type ProviderInvocationStore,
  type ProviderInvocationWorkKind,
  type ProviderObservationAdoption,
  type ProviderRecoveryReason,
} from "./provider-invocation-contract.js";
import {
  assertCanonicalDispatchEvent,
  assertDate,
  assertId,
  assertLeaseWindow,
  assertObservation,
  claimFrom,
  classifyVersion,
  inTransaction,
  invalidArgument,
  invocationMatchesPinnedContext,
  isCanonicalLeaseTokenHash,
  isDuplicateEntryError,
  isTerminalRemoteStatus,
  loadPinnedProviderContext,
  lockAttempt,
  lockCapability,
  lockInvocation,
  requireExecutableProviderImplementation,
  type AttemptRow,
  type CapabilityRow,
  type InvocationRow,
} from "./provider-invocation-identity.js";
import {
  digestProviderValue,
  ProviderValueCanonicalizationError,
} from "./provider-value-digest.js";
import {
  createExecutionTargetGate,
  type ExecutionTarget,
} from "./execution-target.js";
import type { AttemptFailureRetryability } from "./attempt-transition-policy.js";

export * from "./provider-invocation-contract.js";

interface ExistingObservationRow extends RowDataPacket {
  readonly id: string;
  readonly operationKind: string;
  readonly source: string;
  readonly normalizedStatus: string;
  readonly stableErrorCode: string | null;
  readonly requestDigest: string | null;
  readonly responseDigest: string | null;
  readonly providerEventDigest: string | null;
  readonly adoptionOutcome: ProviderObservationAdoption;
}

interface RecoveryCandidateRow extends RowDataPacket {
  readonly invocationId: string;
  readonly reason: ProviderRecoveryReason;
}

interface InvocationIdentityRow extends RowDataPacket {
  readonly invocationId: string;
  readonly attemptId: string;
  readonly capabilityRunId: string;
}

export function providerExecutionDeadlineDisposition(facts: {
  readonly remoteStatus: string;
  readonly sideEffectState: string;
  readonly submissionStartedAt: Date | null;
  readonly notFoundIsAuthoritative: number | boolean;
}): Readonly<{
  invocationRemoteStatus: "failed" | "not_found" | "unknown";
  invocationSideEffectState: "not_started" | "unknown";
  invocationWorkState: "terminal" | "manual";
  attemptLifecycleStatus: "failed" | "abandoned";
  attemptRetryDisposition: "terminal" | "manual";
}> {
  const noExternalEffect =
    facts.remoteStatus === "prepared" &&
    facts.sideEffectState === "not_started" &&
    facts.submissionStartedAt === null;
  let invocationRemoteStatus: "failed" | "not_found" | "unknown" = "unknown";
  if (noExternalEffect) {
    invocationRemoteStatus = facts.notFoundIsAuthoritative
      ? "not_found"
      : "failed";
  }
  return Object.freeze({
    invocationRemoteStatus,
    invocationSideEffectState: noExternalEffect ? "not_started" : "unknown",
    invocationWorkState: noExternalEffect ? "terminal" : "manual",
    attemptLifecycleStatus: noExternalEffect ? "failed" : "abandoned",
    attemptRetryDisposition: noExternalEffect ? "terminal" : "manual",
  });
}

function terminalFailureRetryability(
  options: AppendProviderObservationOptions,
): AttemptFailureRetryability | undefined {
  if (options.status === "failed" || options.status === "cancelled") {
    return options.retryability;
  }
  return options.status === "not_found" ? "retryable" : undefined;
}

function terminalObservationSideEffectState(
  options: AppendProviderObservationOptions,
  callNotStarted: boolean,
): "committed" | "not_started" | "started" {
  if (options.status === "succeeded") {
    return "committed";
  }
  if (options.status === "not_found" || callNotStarted) {
    return "not_started";
  }
  return "started";
}

function persistedAttemptRetryability(
  error: unknown,
): AttemptFailureRetryability | undefined {
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
  const retryability = (value as Readonly<Record<string, unknown>>)
    .retryability;
  return retryability === "retryable" ||
    retryability === "terminal" ||
    retryability === "manual"
    ? retryability
    : undefined;
}

async function findObservation(
  connection: PoolConnection,
  invocationId: string,
  observationKey: string,
): Promise<ExistingObservationRow | undefined> {
  const [rows] = await connection.execute<ExistingObservationRow[]>(
    `SELECT
       id,
       operation_kind AS operationKind,
       source,
       normalized_status AS normalizedStatus,
       stable_error_code AS stableErrorCode,
       request_digest AS requestDigest,
       response_digest AS responseDigest,
       provider_event_digest AS providerEventDigest,
       adoption_outcome AS adoptionOutcome
     FROM provider_invocation_observation
     WHERE provider_invocation_id = ?
       AND observation_key = ?
     LIMIT 1
     FOR UPDATE`,
    [invocationId, observationKey],
  );
  return rows[0];
}

async function appendObservation(
  connection: PoolConnection,
  invocation: InvocationRow,
  options: AppendProviderObservationOptions,
  adoption: ProviderObservationAdoption,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO provider_invocation_observation (
       id,
       workspace_id,
       provider_invocation_id,
       observation_key,
       operation_kind,
       source,
       normalized_status,
       stable_error_code,
       request_digest,
       response_digest,
       provider_event_digest,
       execution_generation,
       adoption_outcome,
       observed_at,
       recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.observationId,
      invocation.workspaceId,
      invocation.id,
      options.observationKey,
      options.operationKind,
      options.source,
      options.status,
      options.stableErrorCode ?? null,
      options.requestDigest ?? null,
      options.responseDigest ?? null,
      options.providerEventDigest ?? null,
      options.executionGeneration,
      adoption,
      options.observedAt,
      options.recordedAt,
    ],
  );
}

async function loadWorkflowIdentity(
  connection: PoolConnection,
  capability: CapabilityRow,
): Promise<{
  readonly invocationKind?: "user" | "agent" | "canvas";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
}> {
  if (capability.invocationKind !== "workflow") {
    return { invocationKind: capability.invocationKind };
  }
  const [rows] = await connection.execute<
    (RowDataPacket & {
      readonly workflowRunId: string;
      readonly nodeRunId: string;
    })[]
  >(
    `SELECT
       workflow_run_id AS workflowRunId,
       id AS nodeRunId
     FROM node_run
     WHERE id = ?
     LIMIT 1`,
    [capability.nodeRunId],
  );
  const row = rows[0];
  if (!row) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.identity_conflict",
      "Provider capability node identity is missing.",
    );
  }
  return row;
}

async function appendCapabilityTerminalEvent(
  connection: PoolConnection,
  options: {
    readonly terminalOutboxEventId?: string;
    readonly executionGeneration: number;
    readonly recordedAt: Date;
  },
  capability: CapabilityRow,
  capabilityVersion: number,
  messageType:
    | "capability.run.completed"
    | "capability.run.failed"
    | "capability.run.cancelled",
  cause: string,
): Promise<void> {
  if (!options.terminalOutboxEventId) {
    invalidArgument("Terminal outbox identity is missing.");
  }
  const workflow = await loadWorkflowIdentity(connection, capability);
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
     ) VALUES (?, ?, ?, 'capability_run', ?, ?, ?, 'pending', ?, 0, ?)`,
    [
      options.terminalOutboxEventId,
      capability.workspaceId,
      messageType,
      capability.id,
      capabilityVersion,
      JSON.stringify({
        ...workflow,
        capabilityRunId: capability.id,
        expectedGeneration: options.executionGeneration,
        cause,
      }),
      options.recordedAt,
      options.recordedAt,
    ],
  );
}

function canQuery(
  invocation: InvocationRow,
  providerRequestId: string | null,
): boolean {
  return (
    invocation.queryMode === "client_request_id" ||
    (invocation.queryMode === "provider_request_id" &&
      providerRequestId !== null)
  );
}

function succeededCompletionOptions(
  options: Extract<
    AppendProviderObservationOptions,
    { readonly status: "succeeded" }
  >,
  capability: CapabilityRow,
  attempt: AttemptRow,
  invocation: InvocationRow,
  implementationDigest: string,
  adapterKey: string,
  succeededObservationId: string,
): CompleteAttemptOptions {
  let responseDigest: string;
  try {
    responseDigest = digestProviderValue(options.output);
  } catch (error) {
    if (error instanceof ProviderValueCanonicalizationError) {
      return invalidArgument(
        `Provider succeeded output is not canonical JSON: ${error.message}`,
      );
    }
    throw error;
  }
  if (options.responseDigest !== responseDigest) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.identity_conflict",
      "Provider succeeded output does not match responseDigest.",
    );
  }
  return {
    workspaceId: capability.workspaceId,
    capabilityRunId: capability.id,
    attemptId: attempt.id,
    completionId: options.completionId,
    terminalOutboxEventId: options.terminalOutboxEventId,
    executionGeneration: options.executionGeneration,
    target: {
      executionTarget: "provider",
      implementationRevisionId: attempt.implementationRevisionId,
      implementationDigest,
      adapterKey,
      invocationId: invocation.id,
      succeededObservationId,
      invocationLeaseGeneration: options.leaseGeneration,
      routeCandidateDigest: invocation.routeCandidateDigest,
      requestFingerprint: invocation.requestFingerprint,
      stableRequestKey: invocation.stableRequestKey,
      responseDigest,
    },
    capabilityOutput: options.output,
    outputs: options.outputs ?? [],
    initialUsage: options.initialUsage ?? [],
    now: options.recordedAt,
  };
}

export interface CreateProviderInvocationStoreOptions {
  readonly instanceId: string;
  readonly claimingEnabled?: boolean;
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
  readonly budgetGate?: AttemptFailureBudgetGate;
}

export function createProviderInvocationStore(
  pool: Pool,
  factoryOptions: CreateProviderInvocationStoreOptions,
): ProviderInvocationStore {
  if (
    typeof factoryOptions.instanceId !== "string" ||
    factoryOptions.instanceId.length < 1 ||
    factoryOptions.instanceId.length > 120
  ) {
    invalidArgument("instanceId must contain 1-120 characters.");
  }
  const instanceId = factoryOptions.instanceId;
  const claimingEnabled = factoryOptions.claimingEnabled ?? false;
  const failureDependencies: AttemptFailureTransitionDependencies = {
    executionTargetGate: createExecutionTargetGate(
      factoryOptions.enabledExecutionTargets ??
        (claimingEnabled ? ["worker", "provider"] : ["worker"]),
    ),
    budgetGate: factoryOptions.budgetGate ?? (() => true),
  };
  return Object.freeze<ProviderInvocationStore>({
    async recordConfirmedResult(options) {
      assertId(options.observationId, "observationId");
      assertDate(options.now, "now");
      const seen = new Set<string>();
      if (
        !Array.isArray(options.facts.usage) ||
        options.facts.usage.length > 32
      )
        invalidArgument("Invalid confirmed result usage.");
      const usage = options.facts.usage.map(
        (metric: {
          readonly metricKey: string;
          readonly unitCode: string;
          readonly numericValue: string;
        }) => {
          if (
            !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(metric.metricKey) ||
            !/^[a-z0-9][a-z0-9._-]{0,39}$/u.test(metric.unitCode) ||
            !/^(?:0|[1-9][0-9]{0,19})$/u.test(metric.numericValue) ||
            seen.has(metric.metricKey)
          )
            invalidArgument("Invalid confirmed result metric.");
          seen.add(metric.metricKey);
          return {
            metricKey: metric.metricKey,
            unitCode: metric.unitCode,
            numericValue: metric.numericValue,
          };
        },
      );
      const facts = {
        schemaVersion: 1,
        usage,
        ...(options.facts.resultEvidence
          ? {
              resultEvidence: captureProviderResultEvidence(
                options.facts.resultEvidence.urls,
                options.facts.resultEvidence.totalCount,
              ),
            }
          : {}),
        ...(options.facts.resultUrls?.length
          ? { resultUrls: providerResultUrls(options.facts.resultUrls) }
          : {}),
        ...(options.facts.reportedCharge
          ? {
              reportedCharge: parseProviderReportedCharge(
                options.facts.reportedCharge,
              ),
            }
          : {}),
      };
      const digest = digestProviderValue(facts);
      const key = `remote-result:${options.operationKind}:${digest}`;
      return inTransaction(pool, async (connection) => {
        const capability = await lockCapability(
          connection,
          options.capabilityRunId,
        );
        const attempt = capability
          ? await lockAttempt(connection, capability.id, options.attemptId)
          : undefined;
        const invocation = attempt
          ? await lockInvocation(connection, options.invocationId, attempt.id)
          : undefined;
        if (
          !capability ||
          !attempt ||
          !invocation ||
          attempt.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== attempt.id ||
          !invocation.submissionStartedAt ||
          !["submit_leased", "query_leased"].includes(invocation.workState) ||
          invocation.reconcileLeaseTokenHash !== options.leaseTokenHash ||
          invocation.reconcileLeaseGeneration !== options.leaseGeneration ||
          invocation.reconcileExecutionGeneration !==
            options.executionGeneration ||
          !invocation.reconcileLeaseExpiresAt ||
          invocation.reconcileLeaseExpiresAt <= options.now
        )
          return false;
        if (
          options.providerRequestId &&
          (options.providerRequestId.length > 512 ||
            !/^[\x21-\x7e]+$/u.test(options.providerRequestId) ||
            (invocation.providerRequestId &&
              invocation.providerRequestId !== options.providerRequestId))
        )
          invalidArgument("Confirmed result task identity changed.");
        if (await findObservation(connection, invocation.id, key)) return true;
        await connection.execute(
          `INSERT INTO provider_invocation_observation
          (id, workspace_id, provider_invocation_id, observation_key, operation_kind, source, normalized_status,
           request_digest, response_digest, result_facts, execution_generation, adoption_outcome, observed_at, recorded_at)
          VALUES (?, ?, ?, ?, ?, 'adapter', 'succeeded', ?, ?, ?, ?, 'applied', ?, ?)`,
          [
            options.observationId,
            invocation.workspaceId,
            invocation.id,
            key,
            options.operationKind,
            invocation.requestFingerprint,
            digest,
            JSON.stringify(facts),
            options.executionGeneration,
            options.now,
            options.now,
          ],
        );
        if (!invocation.providerRequestId && options.providerRequestId)
          await connection.execute(
            "UPDATE provider_invocation SET provider_request_id = ?, version = version + 1 WHERE id = ?",
            [options.providerRequestId, invocation.id],
          );
        return true;
      });
    },
    async renewLease(options) {
      assertId(options.invocationId, "invocationId");
      assertLeaseWindow(
        options.now,
        options.leaseUntil,
        options.leaseTokenHash,
        options.executionGeneration,
      );
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE provider_invocation AS invocation
         INNER JOIN capability_attempt AS attempt ON attempt.id = invocation.capability_attempt_id
         INNER JOIN capability_run AS capability ON capability.id = attempt.capability_run_id
         INNER JOIN instance_runtime_state AS runtime ON runtime.instance_id = ?
         SET invocation.reconcile_lease_expires_at = LEAST(?, attempt.execution_deadline_at),
             invocation.updated_at = ?, invocation.version = invocation.version + 1
         WHERE invocation.id = ? AND attempt.id = ? AND capability.id = ?
           AND invocation.work_state IN ('submit_leased', 'query_leased')
           AND invocation.reconcile_lease_token_hash = ? AND invocation.reconcile_lease_generation = ?
           AND invocation.reconcile_execution_generation = ? AND invocation.reconcile_lease_expires_at > ?
           AND attempt.execution_deadline_at > ? AND attempt.lifecycle_status = 'running'
           AND capability.lifecycle_status = 'running' AND capability.current_attempt_id = attempt.id
           AND capability.cancel_requested_at IS NULL AND attempt.cancel_requested_at IS NULL
           AND runtime.state = 'ACTIVE' AND runtime.execution_generation = ?`,
        [
          instanceId,
          options.leaseUntil,
          options.now,
          options.invocationId,
          options.attemptId,
          options.capabilityRunId,
          options.leaseTokenHash,
          options.leaseGeneration,
          options.executionGeneration,
          options.now,
          options.now,
          options.executionGeneration,
        ],
      );
      if (result.affectedRows !== 1) return undefined;
      const [rows] = await pool.execute<
        (RowDataPacket & { expiresAt: Date })[]
      >(
        `SELECT reconcile_lease_expires_at AS expiresAt FROM provider_invocation
         WHERE id = ? AND reconcile_lease_token_hash = ? AND reconcile_lease_generation = ?`,
        [options.invocationId, options.leaseTokenHash, options.leaseGeneration],
      );
      return rows[0]?.expiresAt;
    },
    async claimDispatch(options) {
      if (!claimingEnabled) {
        throw new ProviderInvocationStoreError(
          "provider_invocation.claiming_disabled",
          "Provider attempt claiming is disabled for this runtime.",
        );
      }
      assertId(options.invocationId, "invocationId");
      assertId(options.capabilityRunId, "capabilityRunId");
      assertId(options.attemptId, "attemptId");
      assertLeaseWindow(
        options.now,
        options.leaseUntil,
        options.leaseTokenHash,
        options.executionGeneration,
      );

      return inTransaction(pool, (connection) =>
        consumeInboxEvent(connection, options.delivery, async (event) => {
          const eventFacts = assertCanonicalDispatchEvent(event, options);
          const capability = await lockCapability(
            connection,
            options.capabilityRunId,
          );
          if (!capability || capability.workspaceId !== event.workspaceId) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          const attempt = await lockAttempt(
            connection,
            capability.id,
            options.attemptId,
          );
          if (
            !attempt ||
            attempt.workspaceId !== capability.workspaceId ||
            capability.invocationKind !== eventFacts.invocationKind ||
            capability.nodeRunId !== (eventFacts.nodeRunId ?? null)
          ) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          if (
            classifyVersion(attempt.version, event.aggregateVersion) === "stale"
          ) {
            return {
              outcome: "noop" as const,
              resultCode: "provider.dispatch.stale_event",
              value: undefined,
            };
          }
          if (
            !["queued", "running"].includes(capability.lifecycleStatus) ||
            capability.currentAttemptId !== attempt.id ||
            capability.acceptedAttemptId ||
            capability.cancelRequestedAt ||
            attempt.lifecycleStatus !== "created" ||
            attempt.sideEffectState !== "not_started" ||
            attempt.cancelRequestedAt ||
            attempt.executionTarget !== "provider" ||
            !attempt.executionDeadlineAt ||
            attempt.executionDeadlineAt <= options.now ||
            options.leaseUntil > attempt.executionDeadlineAt
          ) {
            return {
              outcome: "noop" as const,
              resultCode: "provider.dispatch.not_claimable",
              value: undefined,
            };
          }
          const context = await loadPinnedProviderContext(
            connection,
            capability,
            attempt,
            true,
          );
          if (
            context.invocationKind !== eventFacts.invocationKind ||
            context.workflowRunId !== eventFacts.workflowRunId ||
            context.nodeRunId !== eventFacts.nodeRunId
          ) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }

          const [existingRows] = await connection.execute<InvocationRow[]>(
            `SELECT
                   id,
                   workspace_id AS workspaceId,
                   capability_attempt_id AS capabilityAttemptId,
                   implementation_revision_id AS implementationRevisionId,
                   provider_endpoint_id AS providerEndpointId,
                   provider_key AS providerKey,
                   api_surface AS apiSurface,
                   credential_identity_id AS credentialIdentityId,
                   credential_identity_epoch AS credentialIdentityEpoch,
                   pinned_secret_version_id AS pinnedSecretVersionId,
                   model_deployment_id AS modelDeploymentId,
                   pricing_revision_id AS pricingRevisionId,
                   route_candidate_digest AS routeCandidateDigest,
                   request_scope_digest AS requestScopeDigest,
                   stable_request_key AS stableRequestKey,
                   request_fingerprint AS requestFingerprint,
                   provider_request_id AS providerRequestId,
                   remote_status AS remoteStatus,
                   side_effect_state AS sideEffectState,
                   query_mode AS queryMode,
                   not_found_is_authoritative AS notFoundIsAuthoritative,
                   work_state AS workState,
                   reconcile_lease_generation AS reconcileLeaseGeneration,
                   reconcile_execution_generation AS reconcileExecutionGeneration,
                   reconcile_lease_token_hash AS reconcileLeaseTokenHash,
                   reconcile_lease_expires_at AS reconcileLeaseExpiresAt,
                   next_reconcile_at AS nextReconcileAt,
                   version,
                   submission_started_at AS submissionStartedAt,
                   acknowledged_at AS acknowledgedAt
                 FROM provider_invocation
                 WHERE capability_attempt_id = ?
                    OR id = ?
                    OR (
                      request_scope_digest = ?
                      AND stable_request_key = ?
                    )
                 FOR UPDATE`,
            [
              attempt.id,
              options.invocationId,
              context.route.requestScopeDigest,
              context.stableRequestKey,
            ],
          );
          if (existingRows.length > 0) {
            const existing = existingRows[0];
            if (
              existingRows.length !== 1 ||
              !existing ||
              existing.id !== options.invocationId ||
              !invocationMatchesPinnedContext(
                existing,
                context,
                capability,
                attempt,
              )
            ) {
              throw new ProviderInvocationStoreError(
                "provider_invocation.identity_conflict",
                "Stable provider request identity conflicts with an existing invocation.",
              );
            }
            return {
              outcome: "noop" as const,
              resultCode: "provider.dispatch.already_claimed",
              value: undefined,
            };
          }

          const route = context.route;
          try {
            await connection.execute<ResultSetHeader>(
              `INSERT INTO provider_invocation (
                   id,
                   workspace_id,
                   capability_attempt_id,
                   implementation_revision_id,
                   provider_endpoint_id,
                   provider_key,
                   api_surface,
                   credential_identity_id,
                   credential_identity_epoch,
                   pinned_secret_version_id,
                   model_deployment_id,
                   pricing_revision_id,
                   route_candidate_digest,
                   request_scope_digest,
                   stable_request_key,
                   request_fingerprint,
                   parameter_resolution_snapshot,
                   parameter_resolution_digest,
                   prepared_request_snapshot,
                   prepared_request_digest,
                   provider_request_id,
                   remote_status,
                   side_effect_state,
                   query_mode,
                   not_found_is_authoritative,
                   work_state,
                   reconcile_lease_generation,
                   reconcile_execution_generation,
                   reconcile_lease_token_hash,
                   reconcile_lease_expires_at,
                   next_reconcile_at,
                   submission_attempts,
                   query_attempts,
                   cancel_attempts,
                   version,
                   prepared_at,
                   submission_started_at,
                   acknowledged_at,
                   last_observed_at,
                   terminal_at,
                   created_at,
                   updated_at
                 ) VALUES (
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   NULL, NULL, NULL,
                   'prepared', 'not_started', ?, ?, 'submit_leased',
                   1, ?, ?, ?, NULL, 1, 0, 0, 1, ?, NULL, NULL, NULL,
                   NULL, ?, ?
                 )`,
              [
                options.invocationId,
                capability.workspaceId,
                attempt.id,
                attempt.implementationRevisionId,
                route.providerEndpointId,
                route.providerKey,
                route.apiSurface,
                route.credentialIdentityId,
                route.credentialIdentityEpoch,
                route.pinnedSecretVersionId,
                route.modelDeploymentId ?? null,
                route.pricingRevisionId ?? null,
                route.routeCandidateDigest,
                route.requestScopeDigest,
                context.stableRequestKey,
                context.requestFingerprint,
                context.parameterResolutionSnapshot
                  ? JSON.stringify(context.parameterResolutionSnapshot)
                  : null,
                context.parameterResolutionDigest ?? null,
                route.queryMode,
                route.notFoundIsAuthoritative,
                options.executionGeneration,
                options.leaseTokenHash,
                options.leaseUntil,
                options.now,
                options.now,
                options.now,
              ],
            );
          } catch (error) {
            if (isDuplicateEntryError(error)) {
              throw new ProviderInvocationStoreError(
                "provider_invocation.identity_conflict",
                "Provider invocation identity collided during claim.",
              );
            }
            throw error;
          }

          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
                 SET lifecycle_status = 'running',
                     version = version + 1,
                     updated_at = ?
                 WHERE id = ?
                   AND capability_run_id = ?
                   AND version = ?
                   AND lifecycle_status = 'created'
                   AND side_effect_state = 'not_started'
                   AND execution_target = 'provider'
                   AND execution_deadline_at >= ?
                   AND cancel_requested_at IS NULL`,
            [
              options.now,
              attempt.id,
              capability.id,
              attempt.version,
              options.leaseUntil,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider attempt changed during invocation claim.",
            );
          }
          let nextCapabilityVersion = capability.version;
          if (capability.lifecycleStatus === "queued") {
            const [capabilityUpdate] =
              await connection.execute<ResultSetHeader>(
                `UPDATE capability_run
                   SET lifecycle_status = 'running',
                       version = version + 1,
                       updated_at = ?
                   WHERE id = ?
                     AND version = ?
                     AND lifecycle_status = 'queued'
                     AND current_attempt_id = ?
                     AND accepted_attempt_id IS NULL
                     AND cancel_requested_at IS NULL`,
                [options.now, capability.id, capability.version, attempt.id],
              );
            if (capabilityUpdate.affectedRows !== 1) {
              throw new ProviderInvocationStoreError(
                "provider_invocation.identity_conflict",
                "Provider capability changed during invocation claim.",
              );
            }
            nextCapabilityVersion += 1;
          }

          const invocation = await lockInvocation(
            connection,
            options.invocationId,
            attempt.id,
          );
          if (!invocation) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Claimed provider invocation could not be reloaded.",
            );
          }
          return {
            outcome: "applied" as const,
            resultCode: "provider.dispatch.claimed",
            value: claimFrom(
              "submit",
              invocation,
              {
                ...capability,
                lifecycleStatus: "running",
                version: nextCapabilityVersion,
              },
              {
                ...attempt,
                lifecycleStatus: "running",
                version: attempt.version + 1,
              },
              context,
            ),
          };
        }),
      );
    },

    async recordPreparedRequest(options) {
      assertId(options.invocationId, "invocationId");
      assertId(options.capabilityRunId, "capabilityRunId");
      assertId(options.attemptId, "attemptId");
      assertDate(options.now, "now");
      if (
        !isCanonicalLeaseTokenHash(options.leaseTokenHash) ||
        !Number.isSafeInteger(options.leaseGeneration) ||
        options.leaseGeneration < 1 ||
        !Number.isSafeInteger(options.executionGeneration) ||
        options.executionGeneration < 1 ||
        !/^sha256:[0-9a-f]{64}$/u.test(options.digest)
      ) {
        invalidArgument("Prepared request lease facts are invalid.");
      }
      let actualDigest: string;
      try {
        actualDigest = digestProviderValue(options.snapshot);
      } catch (error) {
        if (error instanceof ProviderValueCanonicalizationError) {
          return invalidArgument(
            "Prepared Provider request is not canonical JSON.",
          );
        }
        throw error;
      }
      if (actualDigest !== options.digest) {
        return invalidArgument(
          "Prepared Provider request differs from its digest.",
        );
      }
      return inTransaction(pool, async (connection) => {
        const capability = await lockCapability(
          connection,
          options.capabilityRunId,
        );
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== options.attemptId ||
          capability.acceptedAttemptId ||
          capability.cancelRequestedAt
        ) {
          return false;
        }
        const attempt = await lockAttempt(
          connection,
          capability.id,
          options.attemptId,
        );
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.executionTarget !== "provider" ||
          attempt.cancelRequestedAt
        ) {
          return false;
        }
        const invocation = await lockInvocation(
          connection,
          options.invocationId,
          attempt.id,
        );
        if (
          !invocation ||
          invocation.reconcileLeaseTokenHash !== options.leaseTokenHash ||
          invocation.reconcileLeaseGeneration !== options.leaseGeneration ||
          invocation.reconcileExecutionGeneration !==
            options.executionGeneration ||
          !invocation.reconcileLeaseExpiresAt ||
          invocation.reconcileLeaseExpiresAt <= options.now ||
          invocation.workState !== "submit_leased"
        ) {
          return false;
        }
        if (invocation.preparedRequestDigest) {
          if (
            invocation.preparedRequestDigest !== options.digest ||
            digestProviderValue(
              typeof invocation.preparedRequestSnapshot === "string"
                ? (JSON.parse(invocation.preparedRequestSnapshot) as unknown)
                : invocation.preparedRequestSnapshot,
            ) !== options.digest
          ) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Prepared Provider request conflicts with its immutable snapshot.",
            );
          }
          return true;
        }
        if (
          invocation.submissionStartedAt ||
          invocation.remoteStatus !== "prepared" ||
          invocation.sideEffectState !== "not_started"
        ) {
          return false;
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_invocation
             SET prepared_request_snapshot = ?,
                 prepared_request_digest = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND capability_attempt_id = ?
               AND version = ?
               AND prepared_request_snapshot IS NULL
               AND prepared_request_digest IS NULL
               AND submission_started_at IS NULL
               AND remote_status = 'prepared'
               AND side_effect_state = 'not_started'
               AND work_state = 'submit_leased'`,
          [
            JSON.stringify(options.snapshot),
            options.digest,
            options.now,
            invocation.id,
            attempt.id,
            invocation.version,
          ],
        );
        return updated.affectedRows === 1;
      });
    },

    async markSubmissionStarted(options) {
      assertId(options.invocationId, "invocationId");
      assertId(options.capabilityRunId, "capabilityRunId");
      assertId(options.attemptId, "attemptId");
      assertDate(options.now, "now");
      if (
        !isCanonicalLeaseTokenHash(options.leaseTokenHash) ||
        !Number.isSafeInteger(options.leaseGeneration) ||
        options.leaseGeneration < 1 ||
        !Number.isSafeInteger(options.executionGeneration) ||
        options.executionGeneration < 1
      ) {
        invalidArgument("Submission lease facts are invalid.");
      }

      return inTransaction(pool, async (connection) => {
        const capability = await lockCapability(
          connection,
          options.capabilityRunId,
        );
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== options.attemptId ||
          capability.acceptedAttemptId ||
          capability.cancelRequestedAt
        ) {
          return false;
        }
        const attempt = await lockAttempt(
          connection,
          capability.id,
          options.attemptId,
        );
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.executionTarget !== "provider" ||
          attempt.cancelRequestedAt
        ) {
          return false;
        }
        const invocation = await lockInvocation(
          connection,
          options.invocationId,
          attempt.id,
        );
        if (
          !invocation ||
          invocation.reconcileLeaseTokenHash !== options.leaseTokenHash ||
          invocation.reconcileLeaseGeneration !== options.leaseGeneration ||
          invocation.reconcileExecutionGeneration !==
            options.executionGeneration ||
          !invocation.reconcileLeaseExpiresAt ||
          invocation.reconcileLeaseExpiresAt <= options.now ||
          invocation.workState !== "submit_leased"
        ) {
          return false;
        }
        if (
          invocation.remoteStatus === "submitting" &&
          invocation.sideEffectState === "unknown" &&
          attempt.sideEffectState === "unknown"
        ) {
          return true;
        }
        if (
          invocation.remoteStatus !== "prepared" ||
          invocation.sideEffectState !== "not_started" ||
          !invocation.preparedRequestDigest ||
          attempt.sideEffectState !== "not_started"
        ) {
          return false;
        }
        const [invocationUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_invocation
             SET remote_status = 'submitting',
                 side_effect_state = 'unknown',
                 submission_started_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND capability_attempt_id = ?
               AND version = ?
               AND remote_status = 'prepared'
               AND prepared_request_digest IS NOT NULL
               AND work_state = 'submit_leased'
               AND reconcile_lease_token_hash = ?
               AND reconcile_lease_generation = ?
               AND reconcile_execution_generation = ?
               AND reconcile_lease_expires_at > ?`,
          [
            options.now,
            options.now,
            invocation.id,
            attempt.id,
            invocation.version,
            options.leaseTokenHash,
            options.leaseGeneration,
            options.executionGeneration,
            options.now,
          ],
        );
        if (invocationUpdate.affectedRows !== 1) {
          return false;
        }
        const [attemptUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
             SET side_effect_state = 'unknown',
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND capability_run_id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND side_effect_state = 'not_started'
               AND execution_target = 'provider'
               AND cancel_requested_at IS NULL`,
          [options.now, attempt.id, capability.id, attempt.version],
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Attempt side-effect intent changed after invocation intent commit.",
          );
        }
        return true;
      });
    },

    async appendAndAdoptObservation(options) {
      assertObservation(options);
      return inTransaction(pool, async (connection) => {
        const capability = await lockCapability(
          connection,
          options.capabilityRunId,
        );
        if (!capability) {
          return {
            recorded: false,
            adoption: "rejected",
            terminal: false,
          };
        }
        const attempt = await lockAttempt(
          connection,
          capability.id,
          options.attemptId,
        );
        if (!attempt) {
          return {
            recorded: false,
            adoption: "rejected",
            terminal: false,
          };
        }
        const invocation = await lockInvocation(
          connection,
          options.invocationId,
          attempt.id,
        );
        if (!invocation) {
          return {
            recorded: false,
            adoption: "rejected",
            terminal: false,
          };
        }
        if (
          capability.workspaceId !== invocation.workspaceId ||
          attempt.executionTarget !== "provider" ||
          invocation.implementationRevisionId !==
            attempt.implementationRevisionId
        ) {
          return {
            recorded: false,
            adoption: "rejected",
            terminal: isTerminalRemoteStatus(invocation.remoteStatus),
          };
        }
        const context = await loadPinnedProviderContext(
          connection,
          capability,
          attempt,
        );
        if (
          !invocationMatchesPinnedContext(
            invocation,
            context,
            capability,
            attempt,
          )
        ) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Provider observation does not match pinned request identity.",
          );
        }
        if (
          invocation.providerRequestId &&
          options.providerRequestId &&
          invocation.providerRequestId !== options.providerRequestId
        ) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Provider request identity changed across observations.",
          );
        }
        const existing = await findObservation(
          connection,
          invocation.id,
          options.observationKey,
        );
        if (existing) {
          const replayRetryability = terminalFailureRetryability(options);
          if (
            existing.operationKind !== options.operationKind ||
            existing.source !== options.source ||
            existing.normalizedStatus !== options.status ||
            existing.stableErrorCode !== (options.stableErrorCode ?? null) ||
            existing.requestDigest !== (options.requestDigest ?? null) ||
            existing.responseDigest !== (options.responseDigest ?? null) ||
            existing.providerEventDigest !==
              (options.providerEventDigest ?? null) ||
            (replayRetryability !== undefined &&
              (existing.adoptionOutcome === "applied" ||
                existing.adoptionOutcome === "noop_cancelled") &&
              persistedAttemptRetryability(attempt.error) !==
                replayRetryability)
          ) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "A Provider observation key cannot be replayed with different facts.",
            );
          }
          if (
            existing.normalizedStatus === "succeeded" &&
            existing.adoptionOutcome === "applied"
          ) {
            if (options.status !== "succeeded") {
              throw new ProviderInvocationStoreError(
                "provider_invocation.identity_conflict",
                "A succeeded observation key cannot be replayed with another status.",
              );
            }
            await completeAttemptInTransaction(
              connection,
              instanceId,
              succeededCompletionOptions(
                options,
                capability,
                attempt,
                invocation,
                context.implementationDigest,
                context.adapterKey,
                existing.id,
              ),
            );
          }
          return {
            recorded: false,
            adoption: existing.adoptionOutcome,
            terminal: isTerminalRemoteStatus(invocation.remoteStatus),
          };
        }
        const callNotStarted =
          (options.status === "failed" || options.status === "cancelled") &&
          options.callEffect === "not_started";
        const validLease =
          invocation.reconcileLeaseTokenHash === options.leaseTokenHash &&
          invocation.reconcileLeaseGeneration === options.leaseGeneration &&
          invocation.reconcileExecutionGeneration ===
            options.executionGeneration &&
          invocation.reconcileLeaseExpiresAt !== null &&
          invocation.reconcileLeaseExpiresAt > options.recordedAt &&
          (invocation.workState === "submit_leased" ||
            invocation.workState === "query_leased");
        if (!validLease) {
          await appendObservation(
            connection,
            invocation,
            options,
            "noop_stale",
          );
          return {
            recorded: true,
            adoption: "noop_stale",
            terminal: isTerminalRemoteStatus(invocation.remoteStatus),
          };
        }
        if (
          capability.currentAttemptId !== attempt.id ||
          capability.acceptedAttemptId ||
          attempt.lifecycleStatus !== "running" ||
          (invocation.remoteStatus === "prepared" && !callNotStarted)
        ) {
          return {
            recorded: false,
            adoption: "rejected",
            terminal: isTerminalRemoteStatus(invocation.remoteStatus),
          };
        }
        const providerRequestId =
          invocation.providerRequestId ?? options.providerRequestId ?? null;
        const cancelFirst =
          capability.cancelRequestedAt !== null ||
          attempt.cancelRequestedAt !== null ||
          capability.lifecycleStatus === "cancelled";

        let remoteStatus: string = options.status;
        let sideEffectState: string;
        let workState: string;
        let nextReconcileAt: Date | null = null;
        let adoption: ProviderObservationAdoption = cancelFirst
          ? "noop_cancelled"
          : "applied";
        let terminal = isTerminalRemoteStatus(options.status);

        if (
          options.status === "not_found" &&
          !invocation.notFoundIsAuthoritative
        ) {
          remoteStatus = "unknown";
          sideEffectState = "unknown";
          terminal = false;
          adoption = "rejected";
          if (canQuery(invocation, providerRequestId)) {
            if (!options.nextReconcileAt) {
              invalidArgument(
                "Rejected non-authoritative not-found requires another query schedule.",
              );
            }
            workState = "query_pending";
            nextReconcileAt = options.nextReconcileAt;
          } else {
            workState = "manual";
          }
        } else if (
          options.status === "accepted" ||
          options.status === "running"
        ) {
          sideEffectState = "started";
          if (canQuery(invocation, providerRequestId)) {
            if (!options.nextReconcileAt) {
              invalidArgument(
                "Queryable provider observation requires nextReconcileAt.",
              );
            }
            workState = "query_pending";
            nextReconcileAt = options.nextReconcileAt;
          } else if (invocation.queryMode === "none") {
            workState = "waiting_remote";
          } else {
            remoteStatus = "unknown";
            sideEffectState = "unknown";
            workState = "manual";
            adoption = "manual";
          }
        } else if (options.status === "unknown") {
          sideEffectState = "unknown";
          if (canQuery(invocation, providerRequestId)) {
            if (!options.nextReconcileAt) {
              invalidArgument(
                "Queryable unknown observation requires nextReconcileAt.",
              );
            }
            workState = "query_pending";
            nextReconcileAt = options.nextReconcileAt;
          } else {
            workState = "manual";
            adoption = "manual";
          }
        } else {
          workState = "terminal";
          sideEffectState = terminalObservationSideEffectState(
            options,
            callNotStarted,
          );
        }

        const acknowledge =
          options.status === "accepted" ||
          options.status === "running" ||
          terminal;
        const [invocationUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_invocation
             SET provider_request_id = ?,
                 remote_status = ?,
                 side_effect_state = ?,
                 work_state = ?,
                 reconcile_execution_generation = NULL,
                 reconcile_lease_token_hash = NULL,
                 reconcile_lease_expires_at = NULL,
                 next_reconcile_at = ?,
                 acknowledged_at = CASE
                   WHEN ? THEN COALESCE(acknowledged_at, ?)
                   ELSE acknowledged_at
                 END,
                 last_observed_at = ?,
                 terminal_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND capability_attempt_id = ?
               AND version = ?
               AND work_state IN ('submit_leased', 'query_leased')
               AND reconcile_lease_token_hash = ?
               AND reconcile_lease_generation = ?
               AND reconcile_execution_generation = ?
               AND reconcile_lease_expires_at > ?`,
          [
            providerRequestId,
            remoteStatus,
            sideEffectState,
            workState,
            nextReconcileAt,
            acknowledge,
            options.observedAt,
            options.observedAt,
            terminal ? options.recordedAt : null,
            options.recordedAt,
            invocation.id,
            attempt.id,
            invocation.version,
            options.leaseTokenHash,
            options.leaseGeneration,
            options.executionGeneration,
            options.recordedAt,
          ],
        );
        if (invocationUpdate.affectedRows !== 1) {
          return {
            recorded: false,
            adoption: "noop_stale",
            terminal: false,
          };
        }

        if (options.status === "succeeded" && !cancelFirst) {
          await appendObservation(connection, invocation, options, "applied");
          await completeAttemptInTransaction(
            connection,
            instanceId,
            succeededCompletionOptions(
              options,
              capability,
              attempt,
              invocation,
              context.implementationDigest,
              context.adapterKey,
              options.observationId,
            ),
          );
          return {
            recorded: true,
            adoption: "applied",
            terminal: true,
          };
        }

        if (
          !cancelFirst &&
          (options.status === "failed" ||
            options.status === "cancelled" ||
            options.status === "not_found")
        ) {
          await appendObservation(connection, invocation, options, "applied");
          const failureTransition = await transitionAttemptFailureInTransaction(
            connection,
            instanceId,
            {
              workspaceId: capability.workspaceId,
              capabilityRunId: capability.id,
              attemptId: attempt.id,
              nextAttemptId: options.nextAttemptId,
              outboxEventId: options.terminalOutboxEventId,
              executionGeneration: options.executionGeneration,
              target: {
                reporter: "provider",
                executionTarget: "provider",
                implementationRevisionId: attempt.implementationRevisionId,
                implementationDigest: context.implementationDigest,
                adapterKey: context.adapterKey,
                invocationId: invocation.id,
                failureObservationId: options.observationId,
                invocationLeaseGeneration: options.leaseGeneration,
                routeCandidateDigest: invocation.routeCandidateDigest,
                requestFingerprint: invocation.requestFingerprint,
                stableRequestKey: invocation.stableRequestKey,
              },
              failure: {
                ...(options.upstreamError
                  ? { upstreamError: options.upstreamError }
                  : {}),
                stableErrorCode:
                  options.status === "not_found"
                    ? "provider.not_found_authoritative"
                    : options.stableErrorCode,
                sideEffectState: terminalObservationSideEffectState(
                  options,
                  callNotStarted,
                ),
                retryability: terminalFailureRetryability(options) ?? "manual",
                cause: "failed",
                ...(options.providerEventDigest
                  ? {
                      evidenceDigest: options.providerEventDigest,
                    }
                  : {}),
              },
              now: options.recordedAt,
            },
            failureDependencies,
          );
          return {
            recorded: true,
            adoption: "applied",
            terminal: true,
            failureTransition: failureTransition.status,
          };
        }

        if (!terminal) {
          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
               SET side_effect_state = ?,
                   retry_disposition = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND capability_run_id = ?
                 AND version = ?
                 AND lifecycle_status = 'running'
                 AND execution_target = 'provider'`,
            [
              sideEffectState,
              workState === "manual" ? "manual" : null,
              options.recordedAt,
              attempt.id,
              capability.id,
              attempt.version,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider observation lost the current attempt transition.",
            );
          }
          await appendObservation(connection, invocation, options, adoption);
          return {
            recorded: true,
            adoption,
            terminal: false,
          };
        }

        const nextCapabilityVersion = capability.version + 1;
        let capabilityStatus: "failed" | "cancelled";
        let attemptStatus: "failed" | "cancelled" | "abandoned";
        let retryDisposition: "retryable" | "terminal" | "manual";
        let messageType: "capability.run.failed" | "capability.run.cancelled";
        let cause: string;

        if (cancelFirst) {
          capabilityStatus = "cancelled";
          attemptStatus =
            options.status === "succeeded" ? "abandoned" : "cancelled";
          retryDisposition =
            options.status === "succeeded" ? "manual" : "terminal";
          messageType = "capability.run.cancelled";
          cause = "provider_terminal_after_cancel_request";
          adoption = "noop_cancelled";
        } else {
          capabilityStatus = "failed";
          attemptStatus = "failed";
          retryDisposition =
            options.status === "not_found" ||
            options.status === "failed" ||
            options.status === "cancelled"
              ? "retryable"
              : "terminal";
          messageType = "capability.run.failed";
          cause =
            options.status === "not_found"
              ? "provider_not_found_authoritative"
              : `provider_${options.status}`;
        }

        const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_run
             SET lifecycle_status = ?,
                 accepted_attempt_id = ?,
                 output = ?,
                 version = ?,
                 updated_at = ?,
                 completed_at = ?
             WHERE id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND current_attempt_id = ?
               AND accepted_attempt_id IS NULL
               AND (
                 (? = 'cancelled' AND cancel_requested_at IS NOT NULL)
                 OR
                 (? <> 'cancelled' AND cancel_requested_at IS NULL)
               )`,
          [
            capabilityStatus,
            null,
            null,
            nextCapabilityVersion,
            options.recordedAt,
            options.recordedAt,
            capability.id,
            capability.version,
            attempt.id,
            capabilityStatus,
            capabilityStatus,
          ],
        );
        if (capabilityUpdate.affectedRows !== 1) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Provider terminal observation lost capability arbitration.",
          );
        }
        const error = JSON.stringify({
          code: options.stableErrorCode ?? `provider_${options.status}`,
          ...(terminalFailureRetryability(options)
            ? {
                retryability: terminalFailureRetryability(options),
              }
            : {}),
          observedAt: options.observedAt.toISOString(),
        });
        const [attemptUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
             SET lifecycle_status = ?,
                 side_effect_state = ?,
                 retry_disposition = ?,
                 error = ?,
                 lease_token_hash = NULL,
                 lease_expires_at = NULL,
                 version = version + 1,
                 updated_at = ?,
                 completed_at = ?
             WHERE id = ?
               AND capability_run_id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND execution_target = 'provider'
               AND (
                 (? IN ('cancelled', 'abandoned')
                   AND cancel_requested_at IS NOT NULL)
                 OR
                 (? NOT IN ('cancelled', 'abandoned')
                   AND cancel_requested_at IS NULL)
               )`,
          [
            attemptStatus,
            sideEffectState,
            retryDisposition,
            error,
            options.recordedAt,
            options.recordedAt,
            attempt.id,
            capability.id,
            attempt.version,
            attemptStatus,
            attemptStatus,
          ],
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Provider terminal observation lost attempt arbitration.",
          );
        }
        await appendObservation(connection, invocation, options, adoption);
        await appendCapabilityTerminalEvent(
          connection,
          options,
          capability,
          nextCapabilityVersion,
          messageType,
          cause,
        );
        return {
          recorded: true,
          adoption,
          terminal: true,
        };
      });
    },

    async scanRecoveryCandidates(options) {
      assertDate(options.now, "now");
      if (
        !Number.isSafeInteger(options.batchSize) ||
        options.batchSize < 1 ||
        options.batchSize > 100
      ) {
        invalidArgument("Provider recovery batchSize must be 1-100.");
      }
      const [rows] = await pool.query<RecoveryCandidateRow[]>(
        `SELECT
           invocation.id AS invocationId,
           CASE
             WHEN capability.cancel_requested_at IS NOT NULL
               THEN 'cancel_deadline'
             WHEN attempt.execution_deadline_at <= ?
               THEN 'execution_deadline'
             WHEN invocation.work_state = 'submit_leased'
               THEN 'expired_submit_lease'
             WHEN invocation.work_state = 'query_leased'
               THEN 'expired_query_lease'
             ELSE 'due_query'
           END AS reason
         FROM provider_invocation AS invocation
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = invocation.capability_attempt_id
         INNER JOIN capability_run AS capability
           ON capability.id = attempt.capability_run_id
         WHERE capability.lifecycle_status = 'running'
           AND capability.current_attempt_id = attempt.id
           AND capability.accepted_attempt_id IS NULL
           AND attempt.lifecycle_status = 'running'
           AND attempt.execution_target = 'provider'
           AND (
             (
               capability.cancel_requested_at IS NOT NULL
               AND attempt.cancel_requested_at IS NOT NULL
               AND COALESCE(
                 attempt.cancel_deadline_at,
                 capability.cancel_deadline_at
               ) <= ?
               AND invocation.work_state <> 'terminal'
             )
             OR
             (
               capability.cancel_requested_at IS NULL
               AND attempt.cancel_requested_at IS NULL
               AND attempt.execution_deadline_at <= ?
               AND invocation.work_state <> 'terminal'
             )
             OR
             (
               capability.cancel_requested_at IS NULL
               AND attempt.cancel_requested_at IS NULL
               AND attempt.execution_deadline_at > ?
               AND (
                 (
                   invocation.work_state IN (
                     'submit_leased',
                     'query_leased'
                   )
                   AND invocation.reconcile_lease_expires_at <= ?
                 )
                 OR
                 (
                   invocation.work_state = 'query_pending'
                   AND invocation.next_reconcile_at <= ?
                 )
               )
             )
           )
         ORDER BY
           COALESCE(
             attempt.cancel_deadline_at,
             capability.cancel_deadline_at,
             attempt.execution_deadline_at,
             invocation.next_reconcile_at,
             invocation.reconcile_lease_expires_at
           ),
           invocation.id
         LIMIT ?`,
        [
          options.now,
          options.now,
          options.now,
          options.now,
          options.now,
          options.now,
          options.batchSize,
        ],
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            invocationId: row.invocationId,
            reason: row.reason,
          }),
        ),
      );
    },

    async claimRecovery(options) {
      assertId(options.invocationId, "invocationId");
      if (options.terminalOutboxEventId !== undefined) {
        assertId(options.terminalOutboxEventId, "terminalOutboxEventId");
      }
      assertLeaseWindow(
        options.now,
        options.leaseUntil,
        options.leaseTokenHash,
        options.executionGeneration,
      );
      return inTransaction(pool, async (connection) => {
        const [identityRows] = await connection.execute<
          InvocationIdentityRow[]
        >(
          `SELECT
               invocation.id AS invocationId,
               attempt.id AS attemptId,
               attempt.capability_run_id AS capabilityRunId
             FROM provider_invocation AS invocation
             INNER JOIN capability_attempt AS attempt
               ON attempt.id = invocation.capability_attempt_id
             WHERE invocation.id = ?
             LIMIT 1`,
          [options.invocationId],
        );
        const identity = identityRows[0];
        if (!identity) {
          return undefined;
        }
        const capability = await lockCapability(
          connection,
          identity.capabilityRunId,
        );
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== identity.attemptId ||
          capability.acceptedAttemptId
        ) {
          return undefined;
        }
        const attempt = await lockAttempt(
          connection,
          capability.id,
          identity.attemptId,
        );
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.executionTarget !== "provider"
        ) {
          return undefined;
        }
        const invocation = await lockInvocation(
          connection,
          options.invocationId,
          attempt.id,
        );
        if (!invocation || isTerminalRemoteStatus(invocation.remoteStatus)) {
          return undefined;
        }
        const context = await loadPinnedProviderContext(
          connection,
          capability,
          attempt,
        );
        if (
          !invocationMatchesPinnedContext(
            invocation,
            context,
            capability,
            attempt,
          )
        ) {
          throw new ProviderInvocationStoreError(
            "provider_invocation.identity_conflict",
            "Recovery candidate conflicts with pinned provider identity.",
          );
        }

        const cancellationRequested =
          capability.cancelRequestedAt !== null ||
          attempt.cancelRequestedAt !== null;
        const cancellationFactsComplete =
          capability.cancelRequestedAt !== null &&
          capability.cancelDeadlineAt !== null &&
          attempt.cancelRequestedAt !== null &&
          attempt.cancelDeadlineAt !== null;
        const cancellationDeadlineAt = cancellationFactsComplete
          ? new Date(
              Math.min(
                capability.cancelDeadlineAt.getTime(),
                attempt.cancelDeadlineAt.getTime(),
              ),
            )
          : null;
        if (cancellationRequested) {
          if (
            !cancellationFactsComplete ||
            !cancellationDeadlineAt ||
            cancellationDeadlineAt > options.now
          ) {
            return undefined;
          }
          if (!options.terminalOutboxEventId) {
            invalidArgument(
              "Cancellation deadline recovery requires terminalOutboxEventId.",
            );
          }

          const noExternalEffect =
            invocation.remoteStatus === "prepared" &&
            invocation.sideEffectState === "not_started" &&
            invocation.submissionStartedAt === null;
          const [invocationUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE provider_invocation
               SET remote_status = ?,
                   side_effect_state = ?,
                   work_state = ?,
                   reconcile_execution_generation = NULL,
                   reconcile_lease_token_hash = NULL,
                   reconcile_lease_expires_at = NULL,
                   next_reconcile_at = NULL,
                   terminal_at = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND capability_attempt_id = ?
                 AND version = ?
                 AND work_state <> 'terminal'`,
            [
              noExternalEffect ? "cancelled" : "unknown",
              noExternalEffect ? "not_started" : "unknown",
              noExternalEffect ? "terminal" : "manual",
              noExternalEffect ? options.now : null,
              options.now,
              invocation.id,
              attempt.id,
              invocation.version,
            ],
          );
          if (invocationUpdate.affectedRows !== 1) {
            return undefined;
          }

          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
               SET lifecycle_status = 'abandoned',
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
                 AND lifecycle_status = 'running'
                 AND execution_target = 'provider'
                 AND cancel_requested_at IS NOT NULL
                 AND cancel_deadline_at <= ?`,
            [
              noExternalEffect ? "not_started" : "unknown",
              noExternalEffect ? "terminal" : "manual",
              JSON.stringify({
                code: "provider_cancel_deadline_expired",
                externalState: noExternalEffect ? "not_started" : "unknown",
                observedAt: options.now.toISOString(),
              }),
              options.now,
              options.now,
              attempt.id,
              capability.id,
              attempt.version,
              options.now,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider cancellation deadline lost attempt arbitration.",
            );
          }

          const nextCapabilityVersion = capability.version + 1;
          const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
               SET lifecycle_status = 'cancelled',
                   accepted_attempt_id = NULL,
                   output = NULL,
                   version = ?,
                   updated_at = ?,
                   completed_at = ?
               WHERE id = ?
                 AND version = ?
                 AND lifecycle_status = 'running'
                 AND current_attempt_id = ?
                 AND accepted_attempt_id IS NULL
                 AND cancel_requested_at IS NOT NULL
                 AND cancel_deadline_at <= ?`,
            [
              nextCapabilityVersion,
              options.now,
              options.now,
              capability.id,
              capability.version,
              attempt.id,
              options.now,
            ],
          );
          if (capabilityUpdate.affectedRows !== 1) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider cancellation deadline lost capability arbitration.",
            );
          }
          await appendCapabilityTerminalEvent(
            connection,
            {
              terminalOutboxEventId: options.terminalOutboxEventId,
              executionGeneration: options.executionGeneration,
              recordedAt: options.now,
            },
            capability,
            nextCapabilityVersion,
            "capability.run.cancelled",
            "provider_cancel_deadline_expired",
          );
          return undefined;
        }

        const executionDeadlineElapsed =
          attempt.executionDeadlineAt !== null &&
          attempt.executionDeadlineAt <= options.now;
        if (executionDeadlineElapsed) {
          if (!options.terminalOutboxEventId) {
            invalidArgument(
              "Execution deadline recovery requires terminalOutboxEventId.",
            );
          }
          const disposition = providerExecutionDeadlineDisposition(invocation);
          const [invocationUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE provider_invocation
               SET remote_status = ?,
                   side_effect_state = ?,
                   work_state = ?,
                   reconcile_execution_generation = NULL,
                   reconcile_lease_token_hash = NULL,
                   reconcile_lease_expires_at = NULL,
                   next_reconcile_at = NULL,
                   terminal_at = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND capability_attempt_id = ?
                 AND version = ?
                 AND work_state <> 'terminal'`,
            [
              disposition.invocationRemoteStatus,
              disposition.invocationSideEffectState,
              disposition.invocationWorkState,
              disposition.invocationWorkState === "terminal"
                ? options.now
                : null,
              options.now,
              invocation.id,
              attempt.id,
              invocation.version,
            ],
          );
          if (invocationUpdate.affectedRows !== 1) {
            return undefined;
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
                 AND lifecycle_status = 'running'
                 AND execution_target = 'provider'
                 AND cancel_requested_at IS NULL
                 AND execution_deadline_at <= ?`,
            [
              disposition.attemptLifecycleStatus,
              disposition.invocationSideEffectState,
              disposition.attemptRetryDisposition,
              JSON.stringify({
                code: "attempt.execution_deadline_expired",
                externalState: disposition.invocationSideEffectState,
                observedAt: options.now.toISOString(),
              }),
              options.now,
              options.now,
              attempt.id,
              capability.id,
              attempt.version,
              options.now,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider execution deadline lost attempt arbitration.",
            );
          }

          const nextCapabilityVersion = capability.version + 1;
          const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
               SET lifecycle_status = 'failed',
                   accepted_attempt_id = NULL,
                   output = NULL,
                   version = ?,
                   updated_at = ?,
                   completed_at = ?
               WHERE id = ?
                 AND version = ?
                 AND lifecycle_status = 'running'
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
            throw new ProviderInvocationStoreError(
              "provider_invocation.identity_conflict",
              "Provider execution deadline lost capability arbitration.",
            );
          }
          await appendCapabilityTerminalEvent(
            connection,
            {
              terminalOutboxEventId: options.terminalOutboxEventId,
              executionGeneration: options.executionGeneration,
              recordedAt: options.now,
            },
            capability,
            nextCapabilityVersion,
            "capability.run.failed",
            "attempt.execution_deadline_expired",
          );
          return undefined;
        }

        requireExecutableProviderImplementation(context);
        let workKind: ProviderInvocationWorkKind;
        if (
          invocation.workState === "submit_leased" &&
          invocation.reconcileLeaseExpiresAt &&
          invocation.reconcileLeaseExpiresAt <= options.now &&
          invocation.remoteStatus === "prepared"
        ) {
          workKind = "submit";
        } else if (
          ((invocation.workState === "submit_leased" ||
            invocation.workState === "query_leased") &&
            invocation.reconcileLeaseExpiresAt !== null &&
            invocation.reconcileLeaseExpiresAt <= options.now) ||
          (invocation.workState === "query_pending" &&
            invocation.nextReconcileAt !== null &&
            invocation.nextReconcileAt <= options.now)
        ) {
          workKind = "query";
        } else {
          return undefined;
        }

        const providerRequestId = invocation.providerRequestId;
        if (workKind === "query" && !canQuery(invocation, providerRequestId)) {
          const [manualUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE provider_invocation
               SET remote_status = 'unknown',
                   side_effect_state = 'unknown',
                   work_state = 'manual',
                   reconcile_execution_generation = NULL,
                   reconcile_lease_token_hash = NULL,
                   reconcile_lease_expires_at = NULL,
                   next_reconcile_at = NULL,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND capability_attempt_id = ?
                 AND version = ?
                 AND work_state IN (
                   'submit_leased',
                   'query_leased',
                   'query_pending'
                 )`,
            [options.now, invocation.id, attempt.id, invocation.version],
          );
          if (manualUpdate.affectedRows !== 1) {
            return undefined;
          }
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
             SET side_effect_state = 'unknown',
                 retry_disposition = 'manual',
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND capability_run_id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND execution_target = 'provider'`,
            [options.now, attempt.id, capability.id, attempt.version],
          );
          return undefined;
        }

        const nextLeaseGeneration = invocation.reconcileLeaseGeneration + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_invocation
           SET work_state = ?,
               reconcile_lease_generation = ?,
               reconcile_execution_generation = ?,
               reconcile_lease_token_hash = ?,
               reconcile_lease_expires_at = ?,
               next_reconcile_at = NULL,
               submission_attempts =
                 submission_attempts + ?,
               query_attempts =
                 query_attempts + ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND capability_attempt_id = ?
             AND version = ?
             AND (
               (
                 work_state IN ('submit_leased', 'query_leased')
                 AND reconcile_lease_expires_at <= ?
               )
               OR
               (
                 work_state = 'query_pending'
                 AND next_reconcile_at <= ?
               )
             )`,
          [
            workKind === "submit" ? "submit_leased" : "query_leased",
            nextLeaseGeneration,
            options.executionGeneration,
            options.leaseTokenHash,
            options.leaseUntil,
            workKind === "submit" ? 1 : 0,
            workKind === "query" ? 1 : 0,
            options.now,
            invocation.id,
            attempt.id,
            invocation.version,
            options.now,
            options.now,
          ],
        );
        if (updated.affectedRows !== 1) {
          return undefined;
        }
        return claimFrom(
          workKind,
          {
            ...invocation,
            workState: workKind === "submit" ? "submit_leased" : "query_leased",
            reconcileLeaseGeneration: nextLeaseGeneration,
            reconcileExecutionGeneration: options.executionGeneration,
            reconcileLeaseTokenHash: options.leaseTokenHash,
            reconcileLeaseExpiresAt: options.leaseUntil,
            nextReconcileAt: null,
            version: invocation.version + 1,
          },
          capability,
          attempt,
          context,
        );
      });
    },
  });
}
