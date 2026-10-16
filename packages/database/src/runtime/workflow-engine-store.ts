import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import {
  parseCompiledCapabilityMappingPlanV1,
  parseRuntimeAdapterDefinitionRevision,
  type CompiledCapabilityMappingPlanV1,
  type RuntimeAdapterDefinitionRevision,
} from "@kanvas/contracts/capability";
import type { ModelResourceManifest } from "@kanvas/contracts/api";

import {
  assertPinnedCandidateIdentity,
  assertPinnedRouteIdentity,
  findPinnedCandidate,
  findPinnedRoute,
  parseExecutionPlan,
  parsePinnedCapabilityRoute,
  parseJson,
} from "./execution-plan.js";
import {
  consumeInboxEvent,
  InboxDeliveryError,
  type CanonicalInboxEvent,
  type InboxConsumptionResult,
  type InboxDelivery,
  type InboxEffectResult,
} from "./inbox-receipt.js";
import {
  createExecutionTargetGate,
  isExecutionTarget,
  isQueueExecutionTarget,
  type ExecutionTarget,
  type ExecutionTargetGate,
  type QueueExecutionTarget,
} from "./execution-target.js";
import {
  digestProviderValue,
  ProviderValueCanonicalizationError,
} from "./provider-value-digest.js";

export interface EngineIds {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly outboxEventId: string;
}

export interface StartWorkflowOptions {
  readonly workflowRunId: string;
  readonly ids: EngineIds;
  readonly now: Date;
  readonly executionGeneration: number;
  readonly delivery: InboxDelivery;
}

export interface StartWorkflowResult {
  readonly started: boolean;
  readonly capabilityRunId?: string;
  readonly attemptId?: string;
}

export interface CreateWorkflowEngineStoreOptions {
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
}

export class ExecutionTargetDisabledError extends Error {
  readonly code = "workflow.execution_target_disabled";

  constructor(readonly executionTarget: ExecutionTarget) {
    super(
      `Execution target ${executionTarget} is not enabled for this workflow engine runtime.`,
    );
    this.name = "ExecutionTargetDisabledError";
  }
}

export interface ClaimedAttempt {
  readonly attemptId: string;
  readonly capabilityRunId: string;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly executionTarget: QueueExecutionTarget;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapter: RuntimeAdapterDefinitionRevision;
  readonly implementationConfiguration: unknown;
  readonly compiledInputMapping: CompiledCapabilityMappingPlanV1;
  readonly compiledOutputMapping: CompiledCapabilityMappingPlanV1;
  readonly input: unknown;
  readonly modelResource?: ClaimedModelResource;
  readonly leaseGeneration: number;
  readonly executionDeadlineAt: Date;
}

export interface ClaimedModelResource {
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly manifest: ModelResourceManifest;
  readonly storage: Readonly<{
    storageProfileId: string;
    container: string;
    objectKey: string;
    storageVersionId?: string;
    immutableIdentityHash: string;
    byteSize: string;
    sha256: string;
  }>;
}

export interface ClaimAttemptOptions {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly executionGeneration: number;
  readonly expectedExecutionTarget: QueueExecutionTarget;
  readonly delivery: InboxDelivery;
}

export interface MarkAttemptStartedOptions {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly now: Date;
}

export interface HeartbeatAttemptOptions {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly now: Date;
  readonly leaseUntil: Date;
}

export type HeartbeatAttemptResult =
  "renewed" | "cancel_requested" | "rejected";

export interface ProcessWorkflowCancellationOptions {
  readonly workflowRunId: string;
  readonly now: Date;
  readonly outboxEventId: string;
  readonly executionGeneration: number;
  readonly delivery: InboxDelivery;
}

export type ProcessWorkflowCancellationResult =
  "noop" | "pending" | "capability_cancelled";

export interface AcknowledgeAttemptCancellationOptions {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly now: Date;
  readonly outboxEventId: string;
  readonly executionGeneration: number;
}

export interface SettleWorkflowCancellationOptions {
  readonly workflowRunId: string;
  readonly now: Date;
}

export interface ConsumeCancellationCapabilityTerminalOptions {
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly now: Date;
  readonly delivery: InboxDelivery;
  readonly executionGeneration: number;
}

export interface ConsumeCancellationCapabilityTerminalResult {
  readonly finished: boolean;
  readonly cancellationSettled: boolean;
}

export interface ConsumeWorkflowCancellationSettlementOptions extends SettleWorkflowCancellationOptions {
  readonly delivery: InboxDelivery;
  readonly executionGeneration: number;
}

export interface WorkflowEngineStore {
  startWorkflow(
    options: StartWorkflowOptions,
  ): Promise<InboxConsumptionResult<StartWorkflowResult>>;
  claimAttempt(
    options: ClaimAttemptOptions,
  ): Promise<InboxConsumptionResult<ClaimedAttempt | undefined>>;
  markAttemptStarted(options: MarkAttemptStartedOptions): Promise<boolean>;
  heartbeatAttempt(
    options: HeartbeatAttemptOptions,
  ): Promise<HeartbeatAttemptResult>;
  processWorkflowCancellation(
    options: ProcessWorkflowCancellationOptions,
  ): Promise<InboxConsumptionResult<ProcessWorkflowCancellationResult>>;
  acknowledgeAttemptCancellation(
    options: AcknowledgeAttemptCancellationOptions,
  ): Promise<boolean>;
  settleWorkflowCancellation(
    options: SettleWorkflowCancellationOptions,
  ): Promise<boolean>;
  consumeWorkflowCancellationSettlement(
    options: ConsumeWorkflowCancellationSettlementOptions,
  ): Promise<InboxConsumptionResult<boolean>>;
  consumeCancellationCapabilityTerminal(
    options: ConsumeCancellationCapabilityTerminalOptions,
  ): Promise<
    InboxConsumptionResult<ConsumeCancellationCapabilityTerminalResult>
  >;
}

interface WorkflowRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly input: unknown;
  readonly executionPlanSnapshot: unknown;
  readonly executionDeadlineAt: Date;
  readonly createdBy: string;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
}

interface NodeRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
}

interface CapabilityRunRow extends RowDataPacket {
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
  readonly output: unknown;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
}

interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly transitionKind: "initial" | "retry" | "fallback";
  readonly transitionReasonCode: string;
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
  readonly lifecycleStatus: string;
  readonly sideEffectState: string;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly version: number;
}

type ClaimableAttemptRow = AttemptRow;

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId: string | null;
  readonly workflowWorkspaceId: string | null;
  readonly nodeRunId: string | null;
  readonly nodeWorkspaceId: string | null;
  readonly actorId: string;
  readonly input: unknown;
  readonly inputDigest: string;
  readonly routeSnapshot: unknown;
  readonly nodeKey: string;
  readonly bindingId: string;
  readonly bindingWorkspaceId: string;
  readonly bindingContractRevisionId: string;
  readonly bindingImplementationRevisionId: string;
  readonly bindingLifecycleStatus: string;
  readonly contractKey: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly contractLifecycleStatus: string;
  readonly implementationContractRevisionId: string;
  readonly adapterKey: string;
  readonly implementationExecutionTarget: string;
  readonly implementationWorkspaceId: string;
  readonly implementationLifecycleStatus: string;
  readonly implementationDigest: string;
  readonly implementationSourceKind: string;
  readonly implementationConfiguration: unknown;
  readonly inputMappingDigest: string;
  readonly compiledInputMapping: unknown;
  readonly outputMappingDigest: string;
  readonly compiledOutputMapping: unknown;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapterRevisionStatus: string;
  readonly runtimeAdapterExecutionTarget: string;
  readonly runtimeAdapterDocument: unknown;
  readonly runtimeAdapterKey: string;
  readonly runtimeAdapterDefinitionStatus: string;
  readonly modelResourceRevisionId: string | null;
  readonly modelResourceRevisionDigest: string | null;
  readonly modelResourceManifest: unknown;
  readonly modelResourceLifecycleStatus: string | null;
  readonly modelStorageProfileId: string | null;
  readonly modelContainer: string | null;
  readonly modelObjectKey: string | null;
  readonly modelStorageVersionId: string | null;
  readonly modelImmutableIdentityHash: string | null;
  readonly modelByteSize: string | null;
  readonly modelSha256: string | null;
}

function runtimeAdapterFrom(
  context: ExecutionContextRow,
): RuntimeAdapterDefinitionRevision {
  try {
    const document = parseRuntimeAdapterDefinitionRevision(
      parseJson(context.runtimeAdapterDocument),
    );
    if (
      document.adapterKey !== context.adapterKey ||
      document.executionTarget !== context.implementationExecutionTarget
    ) {
      throw new TypeError("Runtime Adapter identity is inconsistent.");
    }
    return document;
  } catch {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
}

function claimedModelResourceFrom(
  context: ExecutionContextRow,
): ClaimedModelResource | undefined {
  const values = [
    context.modelResourceRevisionId,
    context.modelResourceRevisionDigest,
    context.modelResourceManifest,
    context.modelResourceLifecycleStatus,
    context.modelStorageProfileId,
    context.modelContainer,
    context.modelObjectKey,
    context.modelImmutableIdentityHash,
    context.modelByteSize,
    context.modelSha256,
  ];
  if (context.implementationSourceKind !== "model_resource") {
    if (values.some((value) => value !== null)) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
    return undefined;
  }
  if (values.some((value) => value === null)) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  const manifest = parseJson(
    context.modelResourceManifest,
  ) as ModelResourceManifest;
  if (
    !manifest ||
    manifest.schemaVersion !== "kanvas.model-resource/v1" ||
    !["published", "deprecated"].includes(
      context.modelResourceLifecycleStatus!,
    ) ||
    !manifest.executionTargets.includes(
      context.implementationExecutionTarget as "browser" | "worker",
    ) ||
    manifest.sha256 !== `sha256:${context.modelSha256!}` ||
    (manifest.byteSize !== undefined &&
      manifest.byteSize !== context.modelByteSize)
  ) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return Object.freeze({
    revisionId: context.modelResourceRevisionId!,
    revisionDigest: context.modelResourceRevisionDigest!,
    manifest,
    storage: Object.freeze({
      storageProfileId: context.modelStorageProfileId!,
      container: context.modelContainer!,
      objectKey: context.modelObjectKey!,
      ...(context.modelStorageVersionId
        ? { storageVersionId: context.modelStorageVersionId }
        : {}),
      immutableIdentityHash: context.modelImmutableIdentityHash!,
      byteSize: context.modelByteSize!,
      sha256: context.modelSha256!,
    }),
  });
}

function verifiedNodeInput(
  value: unknown,
  expectedDigest: string | null,
): unknown {
  if (!expectedDigest) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  const input = parseJson(value);
  try {
    if (digestProviderValue(input) !== expectedDigest) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
  } catch (error) {
    if (error instanceof ProviderValueCanonicalizationError) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
    throw error;
  }
  return input;
}

function verifiedCompiledMapping(
  value: unknown,
  expectedDigest: string,
  direction: "input" | "output",
): CompiledCapabilityMappingPlanV1 {
  let mapping: CompiledCapabilityMappingPlanV1;
  try {
    mapping = parseCompiledCapabilityMappingPlanV1(parseJson(value));
    if (
      mapping.direction !== direction ||
      digestProviderValue(mapping) !== expectedDigest
    ) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
  } catch (error) {
    if (error instanceof InboxDeliveryError) throw error;
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return mapping;
}

interface CanonicalStartBindingRow extends RowDataPacket {
  readonly bindingId: string;
  readonly bindingWorkspaceId: string;
  readonly contractRevisionId: string;
  readonly bindingImplementationRevisionId: string;
  readonly bindingVersion: number;
  readonly bindingLifecycleStatus: string;
  readonly contractWorkspaceId: string;
  readonly contractKey: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly contractLifecycleStatus: string;
  readonly implementationRevisionId: string;
  readonly implementationWorkspaceId: string;
  readonly implementationDigest: string;
  readonly implementationExecutionTarget: string;
  readonly implementationAdapterKey: string;
  readonly implementationLifecycleStatus: string;
}

interface CancellationWorkflowRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
}

interface CancellationNodeRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
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

function requireCanonicalPayloadId(
  event: CanonicalInboxEvent,
  key: "workflowRunId" | "nodeRunId" | "capabilityRunId" | "attemptId",
): string {
  const value = event.payload[key];
  if (typeof value !== "string" || value.length !== 26) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

function optionalCanonicalPayloadId(
  event: CanonicalInboxEvent,
  key: "workflowRunId" | "nodeRunId",
): string | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length !== 26) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

function requireCanonicalQueueExecutionTarget(
  event: CanonicalInboxEvent,
): QueueExecutionTarget {
  const value = event.payload.executionTarget;
  if (!isQueueExecutionTarget(value)) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

function requireExecutionTarget(value: unknown): ExecutionTarget {
  if (!isExecutionTarget(value)) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

function assertCanonicalEvent(
  event: CanonicalInboxEvent,
  expected: {
    readonly messageTypes: readonly string[];
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly executionGeneration: number;
  },
): void {
  if (
    !expected.messageTypes.includes(event.messageType) ||
    event.aggregateType !== expected.aggregateType
  ) {
    throw new InboxDeliveryError("inbox.event.route_mismatch");
  }
  if (event.aggregateId !== expected.aggregateId) {
    throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
  }
  if (event.expectedGeneration !== expected.executionGeneration) {
    throw new InboxDeliveryError("inbox.event.envelope_mismatch");
  }
}

function classifyAggregateVersion(
  currentVersion: number,
  eventVersion: number,
): "current" | "stale" {
  if (currentVersion < eventVersion) {
    throw new InboxDeliveryError("inbox.event.future_version");
  }
  return currentVersion === eventVersion ? "current" : "stale";
}

async function settleWorkflowCancellationInTransaction(
  connection: PoolConnection,
  options: SettleWorkflowCancellationOptions,
): Promise<boolean> {
  const [runRows] = await connection.execute<CancellationWorkflowRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       lifecycle_status AS lifecycleStatus,
       version,
       cancel_requested_at AS cancelRequestedAt,
       cancel_deadline_at AS cancelDeadlineAt
     FROM workflow_run
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [options.workflowRunId],
  );
  const run = runRows[0];
  if (!run) {
    return false;
  }
  if (run.lifecycleStatus === "cancelled") {
    return true;
  }
  if (run.lifecycleStatus !== "cancelling") {
    return false;
  }
  const [nodeRows] = await connection.execute<CancellationNodeRow[]>(
    `SELECT id, lifecycle_status AS lifecycleStatus
     FROM node_run
     WHERE workflow_run_id = ?
     ORDER BY id
     FOR UPDATE`,
    [run.id],
  );
  let hasActiveCapability = false;
  for (const node of nodeRows) {
    if (
      ["completed", "failed", "skipped", "cancelled"].includes(
        node.lifecycleStatus,
      )
    ) {
      continue;
    }
    const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
      `SELECT
           id,
           workspace_id AS workspaceId,
           node_run_id AS nodeRunId,
           lifecycle_status AS lifecycleStatus,
           current_attempt_id AS currentAttemptId,
           accepted_attempt_id AS acceptedAttemptId,
           implementation_revision_id AS implementationRevisionId,
           output,
           version,
           cancel_requested_at AS cancelRequestedAt,
           cancel_deadline_at AS cancelDeadlineAt
         FROM capability_run
         WHERE node_run_id = ?
         LIMIT 1
         FOR UPDATE`,
      [node.id],
    );
    const capability = capabilityRows[0];
    if (
      capability &&
      ["queued", "running"].includes(capability.lifecycleStatus)
    ) {
      hasActiveCapability = true;
      continue;
    }
    await connection.execute<ResultSetHeader>(
      `UPDATE node_run
       SET lifecycle_status = 'cancelled',
           waiting_reason = NULL,
           version = version + 1,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND lifecycle_status IN ('pending', 'running', 'waiting')`,
      [options.now, options.now, node.id],
    );
  }
  if (hasActiveCapability) {
    return false;
  }
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE workflow_run
     SET lifecycle_status = 'cancelled',
         outcome = NULL,
         version = version + 1,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND version = ?
       AND lifecycle_status = 'cancelling'`,
    [options.now, options.now, run.id, run.version],
  );
  return updated.affectedRows === 1;
}

export function createWorkflowEngineStore(
  pool: Pool,
  options: CreateWorkflowEngineStoreOptions = {},
): WorkflowEngineStore {
  const executionTargetGate: ExecutionTargetGate = createExecutionTargetGate(
    options.enabledExecutionTargets,
  );

  return Object.freeze<WorkflowEngineStore>({
    async startWorkflow(options) {
      return inTransaction(pool, async (connection) => {
        return consumeInboxEvent<InboxEffectResult<StartWorkflowResult>>(
          connection,
          options.delivery,
          async (event) => {
            assertCanonicalEvent(event, {
              messageTypes: ["workflow.wakeup.requested"],
              aggregateType: "workflow_run",
              aggregateId: options.workflowRunId,
              executionGeneration: options.executionGeneration,
            });
            if (
              requireCanonicalPayloadId(event, "workflowRunId") !==
              options.workflowRunId
            ) {
              throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
            }
            const [runRows] = await connection.execute<WorkflowRow[]>(
              `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             input,
             execution_plan_snapshot AS executionPlanSnapshot,
             execution_deadline_at AS executionDeadlineAt,
             created_by AS createdBy,
             version,
             cancel_requested_at AS cancelRequestedAt
           FROM workflow_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
              [options.workflowRunId],
            );
            const run = runRows[0];
            if (!run || run.workspaceId !== event.workspaceId) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            if (
              classifyAggregateVersion(run.version, event.aggregateVersion) ===
              "stale"
            ) {
              return {
                outcome: "noop",
                resultCode: "workflow.start.stale_event",
                value: {
                  started: false,
                },
              };
            }
            if (run.lifecycleStatus !== "queued") {
              return {
                outcome: "noop",
                resultCode: "workflow.start.not_queued",
                value: {
                  started: false,
                },
              };
            }

            const plan = parseExecutionPlan(run.executionPlanSnapshot);
            const targeted = new Set(
              plan.topology.nodes.flatMap((node) => [...node.next]),
            );
            const entries = plan.topology.nodes.filter(
              (node) => !targeted.has(node.key),
            );
            const entry = entries[0];
            if (entries.length !== 1 || !entry || entry.kind !== "invoke") {
              throw new Error(
                "The current engine slice requires exactly one Invoke entry node.",
              );
            }
            const route = findPinnedRoute(plan, entry.key);
            const candidate = findPinnedCandidate(route, 0);
            const snapshotExecutionTarget = requireExecutionTarget(
              candidate.executionTarget,
            );
            const [canonicalBindingRows] = await connection.execute<
              CanonicalStartBindingRow[]
            >(
              `SELECT
                   binding.id AS bindingId,
                   binding.workspace_id AS bindingWorkspaceId,
                   binding.contract_revision_id AS contractRevisionId,
                   binding.implementation_revision_id AS bindingImplementationRevisionId,
                   binding.version AS bindingVersion,
                   binding.lifecycle_status AS bindingLifecycleStatus,
                   contract.workspace_id AS contractWorkspaceId,
                   contract.contract_key AS contractKey,
                   contract.revision AS contractRevision,
                   contract.canonical_digest AS contractDigest,
                   contract.lifecycle_status AS contractLifecycleStatus,
                   implementation.id AS implementationRevisionId,
                   implementation.workspace_id AS implementationWorkspaceId,
                   implementation.canonical_digest AS implementationDigest,
                   implementation.execution_target AS implementationExecutionTarget,
                   implementation.adapter_key AS implementationAdapterKey,
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
                run.workspaceId,
              ],
            );
            const canonicalBinding = canonicalBindingRows[0];
            if (
              !canonicalBinding ||
              canonicalBinding.bindingWorkspaceId !== run.workspaceId ||
              canonicalBinding.contractWorkspaceId !== run.workspaceId ||
              canonicalBinding.implementationWorkspaceId !== run.workspaceId ||
              canonicalBinding.contractRevisionId !==
                route.contractRevisionId ||
              canonicalBinding.contractKey !== route.contractKey ||
              canonicalBinding.contractRevision !== route.contractRevision ||
              canonicalBinding.contractDigest !== route.contractDigest ||
              canonicalBinding.implementationRevisionId !==
                candidate.implementationRevisionId ||
              canonicalBinding.implementationDigest !==
                candidate.implementationDigest ||
              canonicalBinding.implementationAdapterKey !==
                candidate.adapterKey ||
              canonicalBinding.bindingLifecycleStatus === "revoked" ||
              !["published", "deprecated"].includes(
                canonicalBinding.contractLifecycleStatus,
              ) ||
              !["published", "deprecated"].includes(
                canonicalBinding.implementationLifecycleStatus,
              )
            ) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            const executionTarget = requireExecutionTarget(
              canonicalBinding.implementationExecutionTarget,
            );
            if (executionTarget !== snapshotExecutionTarget) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            if (!executionTargetGate.allows(executionTarget)) {
              throw new ExecutionTargetDisabledError(executionTarget);
            }
            const executionDeadlineAt = new Date(
              options.now.getTime() + candidate.attemptTimeoutMs,
            );

            const [nodeRows] = await connection.execute<NodeRow[]>(
              `SELECT id, lifecycle_status AS lifecycleStatus
           FROM node_run
           WHERE workflow_run_id = ?
             AND node_key = ?
             AND scope_key = 'root'
           LIMIT 1
           FOR UPDATE`,
              [run.id, entry.key],
            );
            const node = nodeRows[0];
            if (!node) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            if (node.lifecycleStatus !== "pending") {
              return {
                outcome: "noop",
                resultCode: "workflow.start.node_not_pending",
                value: {
                  started: false,
                },
              };
            }

            await connection.execute<ResultSetHeader>(
              `INSERT INTO capability_run (
             id,
             workspace_id,
             node_run_id,
             invocation_kind,
             invocation_reference_id,
             idempotency_key,
             request_hash,
             created_by,
             input,
             input_digest,
             route_snapshot,
             route_snapshot_hash,
             execution_deadline_at,
             contract_revision_id,
             binding_id,
             implementation_revision_id,
             lifecycle_status,
             version,
             created_at,
             updated_at
           ) VALUES (
             ?, ?, ?, 'workflow', ?, NULL, NULL, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, 'queued', 1, ?, ?
           )`,
              [
                options.ids.capabilityRunId,
                run.workspaceId,
                node.id,
                node.id,
                run.createdBy,
                JSON.stringify(parseJson(run.input)),
                digestProviderValue(parseJson(run.input)),
                JSON.stringify(route),
                digestProviderValue(route),
                run.executionDeadlineAt,
                route.contractRevisionId,
                candidate.bindingId,
                candidate.implementationRevisionId,
                options.now,
                options.now,
              ],
            );
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
             ?, ?, ?, ?, 0, 1, 'initial', 'workflow.start.initial',
             1, ?, ?, 'created', 'not_started', ?, ?, 0, 1, ?, ?
           )`,
              [
                options.ids.attemptId,
                run.workspaceId,
                options.ids.capabilityRunId,
                candidate.bindingId,
                executionTarget,
                candidate.implementationRevisionId,
                options.now,
                executionDeadlineAt,
                options.now,
                options.now,
              ],
            );
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_run
           SET current_attempt_id = ?, updated_at = ?
           WHERE id = ? AND current_attempt_id IS NULL`,
              [options.ids.attemptId, options.now, options.ids.capabilityRunId],
            );
            await connection.execute<ResultSetHeader>(
              `UPDATE node_run
           SET lifecycle_status = 'running',
               input = ?,
               input_digest = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ? AND lifecycle_status = 'pending'`,
              [
                JSON.stringify(parseJson(run.input)),
                digestProviderValue(parseJson(run.input)),
                options.now,
                node.id,
              ],
            );
            await connection.execute<ResultSetHeader>(
              `UPDATE workflow_run
           SET lifecycle_status = 'running',
               version = version + 1,
               updated_at = ?
           WHERE id = ? AND lifecycle_status = 'queued'`,
              [options.now, run.id],
            );
            if (isQueueExecutionTarget(executionTarget)) {
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
           ) VALUES (?, ?, 'attempt.dispatch.requested', 'capability_attempt', ?, 1, ?, 'pending', ?, 0, ?)`,
                [
                  options.ids.outboxEventId,
                  run.workspaceId,
                  options.ids.attemptId,
                  JSON.stringify({
                    workflowRunId: run.id,
                    nodeRunId: node.id,
                    capabilityRunId: options.ids.capabilityRunId,
                    attemptId: options.ids.attemptId,
                    executionTarget,
                    expectedGeneration: options.executionGeneration,
                  }),
                  options.now,
                  options.now,
                ],
              );
            }

            return {
              outcome: "applied",
              resultCode: "workflow.start.applied",
              value: {
                started: true,
                capabilityRunId: options.ids.capabilityRunId,
                attemptId: options.ids.attemptId,
              },
            };
          },
        );
      });
    },

    async claimAttempt(options) {
      if (options.leaseUntil <= options.now) {
        throw new RangeError("Attempt lease must end after claim time.");
      }
      return inTransaction(pool, async (connection) => {
        return consumeInboxEvent<InboxEffectResult<ClaimedAttempt | undefined>>(
          connection,
          options.delivery,
          async (event) => {
            assertCanonicalEvent(event, {
              messageTypes: ["attempt.dispatch.requested"],
              aggregateType: "capability_attempt",
              aggregateId: options.attemptId,
              executionGeneration: options.executionGeneration,
            });
            const workflowRunId = optionalCanonicalPayloadId(
              event,
              "workflowRunId",
            );
            const nodeRunId = optionalCanonicalPayloadId(event, "nodeRunId");
            const capabilityRunId = requireCanonicalPayloadId(
              event,
              "capabilityRunId",
            );
            const attemptId = requireCanonicalPayloadId(event, "attemptId");
            const canonicalExecutionTarget =
              requireCanonicalQueueExecutionTarget(event);
            if (
              capabilityRunId !== options.capabilityRunId ||
              attemptId !== options.attemptId
            ) {
              throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
            }
            if (canonicalExecutionTarget !== options.expectedExecutionTarget) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }

            const [capabilityRows] = await connection.execute<
              CapabilityRunRow[]
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
               output,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
              [options.capabilityRunId],
            );
            const capability = capabilityRows[0];
            if (!capability || capability.workspaceId !== event.workspaceId) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            const payloadInvocationKind = event.payload.invocationKind;
            if (
              capability.nodeRunId !== (nodeRunId ?? null) ||
              (capability.invocationKind === "workflow"
                ? !workflowRunId || payloadInvocationKind !== undefined
                : workflowRunId !== undefined ||
                  nodeRunId !== undefined ||
                  payloadInvocationKind !== capability.invocationKind)
            ) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }

            const [attemptRows] = await connection.execute<
              ClaimableAttemptRow[]
            >(
              `SELECT
             id,
             binding_id AS bindingId,
             route_candidate_index AS routeCandidateIndex,
             candidate_attempt_number AS candidateAttemptNumber,
             transition_kind AS transitionKind,
             transition_reason_code AS transitionReasonCode,
             lifecycle_status AS lifecycleStatus,
             side_effect_state AS sideEffectState,
             execution_target AS executionTarget,
             implementation_revision_id AS implementationRevisionId,
             lease_generation AS leaseGeneration,
             lease_token_hash AS leaseTokenHash,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
              [options.attemptId, options.capabilityRunId],
            );
            const attempt = attemptRows[0];
            if (!attempt) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            const attemptExecutionTarget = requireExecutionTarget(
              attempt.executionTarget,
            );
            if (
              !isQueueExecutionTarget(attemptExecutionTarget) ||
              attemptExecutionTarget !== canonicalExecutionTarget
            ) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            if (!executionTargetGate.allows(attemptExecutionTarget)) {
              throw new ExecutionTargetDisabledError(attemptExecutionTarget);
            }
            if (
              classifyAggregateVersion(
                attempt.version,
                event.aggregateVersion,
              ) === "stale"
            ) {
              return {
                outcome: "noop",
                resultCode: "attempt.claim.stale_event",
                value: undefined,
              };
            }
            if (
              capability.currentAttemptId !== options.attemptId ||
              capability.acceptedAttemptId ||
              capability.cancelRequestedAt ||
              !["queued", "running"].includes(capability.lifecycleStatus) ||
              attempt.lifecycleStatus !== "created" ||
              attempt.cancelRequestedAt ||
              !attempt.executionDeadlineAt ||
              attempt.executionDeadlineAt <= options.now ||
              options.leaseUntil > attempt.executionDeadlineAt
            ) {
              return {
                outcome: "noop",
                resultCode: "attempt.claim.not_claimable",
                value: undefined,
              };
            }
            const [contextRows] = await connection.execute<
              ExecutionContextRow[]
            >(
              `SELECT
             source.invocation_kind AS invocationKind,
             workflow.id AS workflowRunId,
             workflow.workspace_id AS workflowWorkspaceId,
             node.id AS nodeRunId,
             node.workspace_id AS nodeWorkspaceId,
             source.created_by AS actorId,
             source.input,
             source.input_digest AS inputDigest,
             source.route_snapshot AS routeSnapshot,
             binding.id AS bindingId,
             binding.workspace_id AS bindingWorkspaceId,
             binding.contract_revision_id AS bindingContractRevisionId,
             binding.implementation_revision_id AS bindingImplementationRevisionId,
             binding.lifecycle_status AS bindingLifecycleStatus,
             contract.contract_key AS contractKey,
             contract.revision AS contractRevision,
             contract.canonical_digest AS contractDigest,
             contract.lifecycle_status AS contractLifecycleStatus,
             implementation.contract_revision_id AS implementationContractRevisionId,
             implementation.adapter_key AS adapterKey,
             implementation.execution_target AS implementationExecutionTarget,
             implementation.workspace_id AS implementationWorkspaceId,
             implementation.lifecycle_status AS implementationLifecycleStatus,
             implementation.canonical_digest AS implementationDigest,
             implementation.source_kind AS implementationSourceKind,
             implementation.configuration AS implementationConfiguration,
             implementation.input_mapping_digest AS inputMappingDigest,
             implementation.compiled_input_mapping AS compiledInputMapping,
             implementation.output_mapping_digest AS outputMappingDigest,
             implementation.compiled_output_mapping AS compiledOutputMapping,
             runtime_adapter.id AS runtimeAdapterRevisionId,
             runtime_adapter.canonical_digest AS runtimeAdapterRevisionDigest,
             runtime_adapter.lifecycle_status AS runtimeAdapterRevisionStatus,
             runtime_adapter.execution_target AS runtimeAdapterExecutionTarget,
             runtime_adapter.document AS runtimeAdapterDocument,
             runtime_adapter_definition.adapter_key AS runtimeAdapterKey,
             runtime_adapter_definition.lifecycle_status AS runtimeAdapterDefinitionStatus,
             model_revision.id AS modelResourceRevisionId,
             model_revision.canonical_digest AS modelResourceRevisionDigest,
             model_revision.manifest AS modelResourceManifest,
             model_revision.lifecycle_status AS modelResourceLifecycleStatus,
             model_object.storage_profile_id AS modelStorageProfileId,
             model_object.container AS modelContainer,
             model_object.object_key AS modelObjectKey,
             model_object.storage_version_id AS modelStorageVersionId,
             model_object.immutable_identity_hash AS modelImmutableIdentityHash,
             model_object.byte_size AS modelByteSize,
             model_object.sha256 AS modelSha256
           FROM capability_run AS source
           LEFT JOIN node_run AS node
             ON node.id = source.node_run_id
            AND node.workspace_id = source.workspace_id
           LEFT JOIN workflow_run AS workflow
             ON workflow.id = node.workflow_run_id
            AND workflow.workspace_id = source.workspace_id
           INNER JOIN capability_binding AS binding
             ON binding.id = ?
             AND binding.workspace_id = source.workspace_id
           INNER JOIN capability_contract_revision AS contract
             ON contract.id = binding.contract_revision_id
             AND contract.workspace_id = source.workspace_id
           INNER JOIN capability_implementation_revision AS implementation
             ON implementation.id = ?
             AND implementation.workspace_id = source.workspace_id
           INNER JOIN runtime_adapter_revision AS runtime_adapter
             ON runtime_adapter.id = implementation.runtime_adapter_revision_id
             AND runtime_adapter.workspace_id = source.workspace_id
           INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
             ON runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
             AND runtime_adapter_definition.workspace_id = source.workspace_id
           LEFT JOIN capability_implementation_model_resource AS model_reference
             ON model_reference.workspace_id = implementation.workspace_id
            AND model_reference.implementation_revision_id = implementation.id
            AND model_reference.resource_role = 'primary'
           LEFT JOIN model_resource_revision AS model_revision
             ON model_revision.workspace_id = model_reference.workspace_id
            AND model_revision.id = model_reference.model_resource_revision_id
           LEFT JOIN model_resource_revision_file AS model_file
             ON model_file.workspace_id = model_revision.workspace_id
            AND model_file.model_resource_revision_id = model_revision.id
            AND model_file.role = 'primary'
           LEFT JOIN stored_object AS model_object
             ON model_object.workspace_id = model_file.workspace_id
            AND model_object.id = model_file.stored_object_id
            AND model_object.delete_state = 'active'
           WHERE source.id = ?
           LIMIT 1
           FOR UPDATE`,
              [
                attempt.bindingId,
                attempt.implementationRevisionId,
                capability.id,
              ],
            );
            const executionContext = contextRows[0];
            if (
              !executionContext ||
              executionContext.invocationKind !== capability.invocationKind ||
              executionContext.workflowRunId !== (workflowRunId ?? null) ||
              executionContext.nodeRunId !== capability.nodeRunId ||
              (capability.invocationKind === "workflow"
                ? executionContext.workflowWorkspaceId !==
                    capability.workspaceId ||
                  executionContext.nodeWorkspaceId !== capability.workspaceId
                : executionContext.workflowWorkspaceId !== null ||
                  executionContext.nodeWorkspaceId !== null) ||
              executionContext.bindingId !== attempt.bindingId ||
              executionContext.bindingWorkspaceId !== capability.workspaceId ||
              executionContext.bindingContractRevisionId !==
                capability.contractRevisionId ||
              executionContext.implementationContractRevisionId !==
                capability.contractRevisionId ||
              !["active", "disabled"].includes(
                executionContext.bindingLifecycleStatus,
              ) ||
              !["published", "deprecated"].includes(
                executionContext.contractLifecycleStatus,
              ) ||
              executionContext.implementationWorkspaceId !==
                capability.workspaceId ||
              !["published", "deprecated"].includes(
                executionContext.implementationLifecycleStatus,
              ) ||
              executionContext.runtimeAdapterDefinitionStatus !== "active" ||
              !["published", "deprecated"].includes(
                executionContext.runtimeAdapterRevisionStatus,
              ) ||
              executionContext.runtimeAdapterKey !==
                executionContext.adapterKey ||
              executionContext.runtimeAdapterExecutionTarget !==
                executionContext.implementationExecutionTarget ||
              requireExecutionTarget(
                executionContext.implementationExecutionTarget,
              ) !== canonicalExecutionTarget
            ) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            const route = parsePinnedCapabilityRoute(
              executionContext.routeSnapshot,
            );
            const pinnedCandidate = findPinnedCandidate(
              route,
              attempt.routeCandidateIndex,
            );
            assertPinnedRouteIdentity(route, {
              nodeKey: route.nodeKey,
              contractRevisionId: capability.contractRevisionId,
              contractDigest: executionContext.contractDigest,
            });
            if (
              route.contractKey !== executionContext.contractKey ||
              route.contractRevision !== executionContext.contractRevision
            ) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            assertPinnedCandidateIdentity(pinnedCandidate, {
              candidateIndex: attempt.routeCandidateIndex,
              bindingId: attempt.bindingId,
              implementationRevisionId: attempt.implementationRevisionId,
              implementationDigest: executionContext.implementationDigest,
              executionTarget: canonicalExecutionTarget,
              adapterKey: executionContext.adapterKey,
            });
            const runtimeAdapter = runtimeAdapterFrom(executionContext);
            const modelResource = claimedModelResourceFrom(executionContext);
            const nextLeaseGeneration = attempt.leaseGeneration + 1;
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_attempt
           SET lifecycle_status = 'running',
               lease_generation = ?,
               lease_token_hash = ?,
               lease_expires_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'created'
             AND execution_deadline_at >= ?`,
              [
                nextLeaseGeneration,
                options.leaseTokenHash,
                options.leaseUntil,
                options.now,
                attempt.id,
                options.leaseUntil,
              ],
            );
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_run
           SET lifecycle_status = 'running',
               version = version + 1,
               updated_at = ?
           WHERE id = ? AND lifecycle_status = 'queued'`,
              [options.now, capability.id],
            );

            return {
              outcome: "applied",
              resultCode: "attempt.claim.applied",
              value: {
                attemptId: attempt.id,
                capabilityRunId: capability.id,
                invocationKind: capability.invocationKind,
                ...(executionContext.workflowRunId
                  ? { workflowRunId: executionContext.workflowRunId }
                  : {}),
                ...(capability.nodeRunId
                  ? { nodeRunId: capability.nodeRunId }
                  : {}),
                workspaceId: capability.workspaceId,
                actorId: executionContext.actorId,
                executionTarget: canonicalExecutionTarget,
                bindingId: attempt.bindingId,
                routeCandidateIndex: attempt.routeCandidateIndex,
                candidateAttemptNumber: attempt.candidateAttemptNumber,
                implementationRevisionId: attempt.implementationRevisionId,
                implementationDigest: executionContext.implementationDigest,
                adapterKey: executionContext.adapterKey,
                runtimeAdapterRevisionId:
                  executionContext.runtimeAdapterRevisionId,
                runtimeAdapterRevisionDigest:
                  executionContext.runtimeAdapterRevisionDigest,
                runtimeAdapter,
                implementationConfiguration: parseJson(
                  executionContext.implementationConfiguration,
                ),
                compiledInputMapping: verifiedCompiledMapping(
                  executionContext.compiledInputMapping,
                  executionContext.inputMappingDigest,
                  "input",
                ),
                compiledOutputMapping: verifiedCompiledMapping(
                  executionContext.compiledOutputMapping,
                  executionContext.outputMappingDigest,
                  "output",
                ),
                input: verifiedNodeInput(
                  executionContext.input,
                  executionContext.inputDigest,
                ),
                ...(modelResource ? { modelResource } : {}),
                leaseGeneration: nextLeaseGeneration,
                executionDeadlineAt: attempt.executionDeadlineAt,
              },
            };
          },
        );
      });
    },

    async markAttemptStarted(options) {
      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               output,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [options.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== options.attemptId ||
          capability.acceptedAttemptId ||
          capability.cancelRequestedAt
        ) {
          return false;
        }
        const [attemptRows] = await connection.execute<AttemptRow[]>(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             side_effect_state AS sideEffectState,
             lease_generation AS leaseGeneration,
             lease_token_hash AS leaseTokenHash,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
          [options.attemptId, options.capabilityRunId],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.leaseTokenHash !== options.leaseTokenHash ||
          attempt.leaseGeneration !== options.leaseGeneration ||
          attempt.cancelRequestedAt ||
          !attempt.leaseExpiresAt ||
          attempt.leaseExpiresAt <= options.now
        ) {
          return false;
        }
        if (attempt.sideEffectState === "started") {
          return true;
        }
        if (attempt.sideEffectState !== "not_started") {
          return false;
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
           SET side_effect_state = 'started',
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'running'
             AND side_effect_state = 'not_started'
             AND lease_token_hash = ?
             AND lease_generation = ?`,
          [
            options.now,
            attempt.id,
            options.leaseTokenHash,
            options.leaseGeneration,
          ],
        );
        return result.affectedRows === 1;
      });
    },

    async heartbeatAttempt(options) {
      if (options.leaseUntil <= options.now) {
        return "rejected";
      }
      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               output,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [options.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== options.attemptId ||
          capability.acceptedAttemptId
        ) {
          return "rejected";
        }
        const [attemptRows] = await connection.execute<AttemptRow[]>(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             side_effect_state AS sideEffectState,
             lease_generation AS leaseGeneration,
             lease_token_hash AS leaseTokenHash,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
          [options.attemptId, options.capabilityRunId],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.leaseTokenHash !== options.leaseTokenHash ||
          attempt.leaseGeneration !== options.leaseGeneration
        ) {
          return "rejected";
        }
        if (capability.cancelRequestedAt || attempt.cancelRequestedAt) {
          return "cancel_requested";
        }
        if (
          !attempt.leaseExpiresAt ||
          attempt.leaseExpiresAt <= options.now ||
          !attempt.executionDeadlineAt ||
          options.leaseUntil > attempt.executionDeadlineAt ||
          options.leaseUntil <= attempt.leaseExpiresAt
        ) {
          return "rejected";
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
           SET lease_expires_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'running'
             AND lease_token_hash = ?
             AND lease_generation = ?
             AND lease_expires_at > ?
             AND execution_deadline_at >= ?`,
          [
            options.leaseUntil,
            options.now,
            attempt.id,
            options.leaseTokenHash,
            options.leaseGeneration,
            options.now,
            options.leaseUntil,
          ],
        );
        return result.affectedRows === 1 ? "renewed" : "rejected";
      });
    },

    async processWorkflowCancellation(options) {
      return inTransaction(pool, async (connection) => {
        return consumeInboxEvent<
          InboxEffectResult<ProcessWorkflowCancellationResult>
        >(connection, options.delivery, async (event) => {
          assertCanonicalEvent(event, {
            messageTypes: ["workflow.cancel.requested"],
            aggregateType: "workflow_run",
            aggregateId: options.workflowRunId,
            executionGeneration: options.executionGeneration,
          });
          if (
            requireCanonicalPayloadId(event, "workflowRunId") !==
            options.workflowRunId
          ) {
            throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
          }
          const [runRows] = await connection.execute<CancellationWorkflowRow[]>(
            `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             version,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt
           FROM workflow_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
            [options.workflowRunId],
          );
          const run = runRows[0];
          if (!run || run.workspaceId !== event.workspaceId) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          if (
            classifyAggregateVersion(run.version, event.aggregateVersion) ===
            "stale"
          ) {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.stale_event",
              value: "noop",
            };
          }
          if (
            run.lifecycleStatus !== "cancelling" ||
            !run.cancelRequestedAt ||
            !run.cancelDeadlineAt
          ) {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.not_cancelling",
              value: "noop",
            };
          }
          const [nodeRows] = await connection.execute<CancellationNodeRow[]>(
            `SELECT id, lifecycle_status AS lifecycleStatus
           FROM node_run
           WHERE workflow_run_id = ?
           ORDER BY id
           LIMIT 1
           FOR UPDATE`,
            [run.id],
          );
          const node = nodeRows[0];
          if (!node) {
            throw new Error("Cancelling workflow has no node run.");
          }
          const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
            `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               output,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt
             FROM capability_run
             WHERE node_run_id = ?
             LIMIT 1
             FOR UPDATE`,
            [node.id],
          );
          const capability = capabilityRows[0];
          if (
            !capability ||
            ["completed", "failed", "cancelled"].includes(
              capability.lifecycleStatus,
            )
          ) {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.capability_terminal",
              value: "noop",
            };
          }
          if (!capability.currentAttemptId) {
            throw new Error(
              "Cancelling capability has no current attempt identity.",
            );
          }
          const [attemptRows] = await connection.execute<AttemptRow[]>(
            `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             side_effect_state AS sideEffectState,
             lease_generation AS leaseGeneration,
             lease_token_hash AS leaseTokenHash,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
            [capability.currentAttemptId, capability.id],
          );
          const attempt = attemptRows[0];
          if (!attempt) {
            throw new Error("Cancelling capability attempt is missing.");
          }
          if (attempt.lifecycleStatus === "running") {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.worker_pending",
              value: "pending",
            };
          }
          if (attempt.lifecycleStatus !== "created") {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.attempt_not_created",
              value: "noop",
            };
          }

          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
           SET lifecycle_status = 'cancelled',
               side_effect_state = 'not_started',
               retry_disposition = 'terminal',
               cancel_requested_at = COALESCE(cancel_requested_at, ?),
               cancel_deadline_at = COALESCE(cancel_deadline_at, ?),
               lease_token_hash = NULL,
               lease_expires_at = NULL,
               version = version + 1,
               updated_at = ?,
               completed_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = 'created'`,
            [
              run.cancelRequestedAt,
              run.cancelDeadlineAt,
              options.now,
              options.now,
              attempt.id,
              attempt.version,
            ],
          );
          if (attemptUpdate.affectedRows !== 1) {
            return {
              outcome: "noop",
              resultCode: "workflow.cancel.transition_lost",
              value: "noop",
            };
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
               AND accepted_attempt_id IS NULL`,
            [
              run.cancelRequestedAt,
              run.cancelDeadlineAt,
              nextCapabilityVersion,
              options.now,
              options.now,
              capability.id,
              capability.version,
            ],
          );
          if (capabilityUpdate.affectedRows !== 1) {
            throw new Error(
              "Capability cancellation lost its current attempt transition.",
            );
          }
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
           ) VALUES (?, ?, 'capability.run.cancelled', 'capability_run', ?, ?, ?, 'pending', ?, 0, ?)`,
            [
              options.outboxEventId,
              capability.workspaceId,
              capability.id,
              nextCapabilityVersion,
              JSON.stringify({
                workflowRunId: run.id,
                nodeRunId: node.id,
                capabilityRunId: capability.id,
                expectedGeneration: options.executionGeneration,
                cause: "attempt_cancelled_before_dispatch",
              }),
              options.now,
              options.now,
            ],
          );
          return {
            outcome: "applied",
            resultCode: "workflow.cancel.capability_cancelled",
            value: "capability_cancelled",
          };
        });
      });
    },

    async acknowledgeAttemptCancellation(options) {
      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
          `SELECT
               id,
               workspace_id AS workspaceId,
               node_run_id AS nodeRunId,
               invocation_kind AS invocationKind,
               lifecycle_status AS lifecycleStatus,
               current_attempt_id AS currentAttemptId,
               accepted_attempt_id AS acceptedAttemptId,
               implementation_revision_id AS implementationRevisionId,
               output,
               version,
               cancel_requested_at AS cancelRequestedAt,
               cancel_deadline_at AS cancelDeadlineAt
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [options.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (!capability) {
          return false;
        }
        if (
          capability.lifecycleStatus === "cancelled" &&
          capability.currentAttemptId === options.attemptId
        ) {
          return true;
        }
        if (
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== options.attemptId ||
          capability.acceptedAttemptId ||
          !capability.cancelRequestedAt ||
          !capability.cancelDeadlineAt
        ) {
          return false;
        }
        const [attemptRows] = await connection.execute<AttemptRow[]>(
          `SELECT
             id,
             lifecycle_status AS lifecycleStatus,
             side_effect_state AS sideEffectState,
             lease_generation AS leaseGeneration,
             lease_token_hash AS leaseTokenHash,
             lease_expires_at AS leaseExpiresAt,
             execution_deadline_at AS executionDeadlineAt,
             cancel_requested_at AS cancelRequestedAt,
             cancel_deadline_at AS cancelDeadlineAt,
             version
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?
           LIMIT 1
           FOR UPDATE`,
          [options.attemptId, capability.id],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.lifecycleStatus !== "running" ||
          attempt.leaseTokenHash !== options.leaseTokenHash ||
          attempt.leaseGeneration !== options.leaseGeneration ||
          !attempt.cancelRequestedAt
        ) {
          return false;
        }

        const nextCapabilityVersion = capability.version + 1;
        const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_run
             SET lifecycle_status = 'cancelled',
                 version = ?,
                 updated_at = ?,
                 completed_at = ?
             WHERE id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND current_attempt_id = ?
               AND accepted_attempt_id IS NULL
               AND cancel_requested_at IS NOT NULL`,
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
          return false;
        }
        const [attemptUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
           SET lifecycle_status = 'abandoned',
               side_effect_state = 'unknown',
               retry_disposition = 'manual',
               lease_token_hash = NULL,
               lease_expires_at = NULL,
               error = ?,
               version = version + 1,
               updated_at = ?,
               completed_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status = 'running'
             AND lease_token_hash = ?
             AND lease_generation = ?
             AND cancel_requested_at IS NOT NULL`,
          [
            JSON.stringify({
              code: "attempt_cancelled_after_start",
              observedAt: options.now.toISOString(),
            }),
            options.now,
            options.now,
            attempt.id,
            attempt.version,
            options.leaseTokenHash,
            options.leaseGeneration,
          ],
        );
        if (attemptUpdate.affectedRows !== 1) {
          throw new Error(
            "Attempt cancellation lost its execution lease after capability settlement.",
          );
        }
        let node: (NodeRow & { workflowRunId: string }) | undefined;
        if (capability.invocationKind === "workflow") {
          const [nodeRows] = await connection.execute<
            (NodeRow & { workflowRunId: string })[]
          >(
            `SELECT
               id,
               workflow_run_id AS workflowRunId,
               lifecycle_status AS lifecycleStatus
             FROM node_run
             WHERE id = ?
             LIMIT 1`,
            [capability.nodeRunId],
          );
          node = nodeRows[0];
        }
        if (capability.invocationKind === "workflow" && !node) {
          throw new Error("Capability cancellation node run is missing.");
        }
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
           ) VALUES (?, ?, 'capability.run.cancelled', 'capability_run', ?, ?, ?, 'pending', ?, 0, ?)`,
          [
            options.outboxEventId,
            capability.workspaceId,
            capability.id,
            nextCapabilityVersion,
            JSON.stringify({
              ...(node
                ? {
                    workflowRunId: node.workflowRunId,
                    nodeRunId: node.id,
                  }
                : { invocationKind: capability.invocationKind }),
              capabilityRunId: capability.id,
              expectedGeneration: options.executionGeneration,
              cause: "worker_abort_acknowledged",
            }),
            options.now,
            options.now,
          ],
        );
        return true;
      });
    },

    async settleWorkflowCancellation(options) {
      return inTransaction(pool, (connection) =>
        settleWorkflowCancellationInTransaction(connection, options),
      );
    },

    async consumeWorkflowCancellationSettlement(options) {
      return inTransaction(pool, async (connection) =>
        consumeInboxEvent<InboxEffectResult<boolean>>(
          connection,
          options.delivery,
          async (event) => {
            assertCanonicalEvent(event, {
              messageTypes: ["workflow.cancel.requested"],
              aggregateType: "workflow_run",
              aggregateId: options.workflowRunId,
              executionGeneration: options.executionGeneration,
            });
            if (
              requireCanonicalPayloadId(event, "workflowRunId") !==
              options.workflowRunId
            ) {
              throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
            }
            const [runRows] = await connection.execute<
              CancellationWorkflowRow[]
            >(
              `SELECT
                   id,
                   workspace_id AS workspaceId,
                   lifecycle_status AS lifecycleStatus,
                   version,
                   cancel_requested_at AS cancelRequestedAt,
                   cancel_deadline_at AS cancelDeadlineAt
                 FROM workflow_run
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
              [options.workflowRunId],
            );
            const run = runRows[0];
            if (!run || run.workspaceId !== event.workspaceId) {
              throw new InboxDeliveryError("inbox.event.fact_mismatch");
            }
            if (
              classifyAggregateVersion(run.version, event.aggregateVersion) ===
              "stale"
            ) {
              return {
                outcome: "noop",
                resultCode: "workflow.settle.stale_event",
                value: false,
              };
            }
            if (run.lifecycleStatus !== "cancelling") {
              return {
                outcome: "noop",
                resultCode: "workflow.settle.not_cancelling",
                value: false,
              };
            }
            const settled = await settleWorkflowCancellationInTransaction(
              connection,
              options,
            );
            return {
              outcome: settled ? "applied" : "noop",
              resultCode: settled
                ? "workflow.settle.cancelled"
                : "workflow.settle.capability_active",
              value: settled,
            };
          },
        ),
      );
    },

    async consumeCancellationCapabilityTerminal(options) {
      return inTransaction(pool, async (connection) =>
        consumeInboxEvent<
          InboxEffectResult<ConsumeCancellationCapabilityTerminalResult>
        >(connection, options.delivery, async (event) => {
          assertCanonicalEvent(event, {
            messageTypes: [
              "capability.run.completed",
              "capability.run.failed",
              "capability.run.cancelled",
            ],
            aggregateType: "capability_run",
            aggregateId: options.capabilityRunId,
            executionGeneration: options.executionGeneration,
          });
          const workflowRunId = requireCanonicalPayloadId(
            event,
            "workflowRunId",
          );
          const nodeRunId = requireCanonicalPayloadId(event, "nodeRunId");
          const capabilityRunId = requireCanonicalPayloadId(
            event,
            "capabilityRunId",
          );
          if (
            workflowRunId !== options.workflowRunId ||
            nodeRunId !== options.nodeRunId ||
            capabilityRunId !== options.capabilityRunId
          ) {
            throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
          }

          const [runRows] = await connection.execute<WorkflowRow[]>(
            `SELECT
                 id,
                 workspace_id AS workspaceId,
                 lifecycle_status AS lifecycleStatus,
                 input,
                 execution_plan_snapshot AS executionPlanSnapshot,
                 version,
                 cancel_requested_at AS cancelRequestedAt
               FROM workflow_run
               WHERE id = ?
               LIMIT 1
               FOR UPDATE`,
            [options.workflowRunId],
          );
          const run = runRows[0];
          if (!run || run.workspaceId !== event.workspaceId) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          const [nodeRows] = await connection.execute<NodeRow[]>(
            `SELECT id, lifecycle_status AS lifecycleStatus
               FROM node_run
               WHERE id = ? AND workflow_run_id = ?
               LIMIT 1
               FOR UPDATE`,
            [options.nodeRunId, options.workflowRunId],
          );
          if (!nodeRows[0]) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
            `SELECT
                   id,
                   workspace_id AS workspaceId,
                   node_run_id AS nodeRunId,
                   lifecycle_status AS lifecycleStatus,
                   current_attempt_id AS currentAttemptId,
                   accepted_attempt_id AS acceptedAttemptId,
                   implementation_revision_id AS implementationRevisionId,
                   output,
                   version,
                   cancel_requested_at AS cancelRequestedAt,
                   cancel_deadline_at AS cancelDeadlineAt
                 FROM capability_run
                 WHERE id = ? AND node_run_id = ?
                 LIMIT 1
                 FOR UPDATE`,
            [options.capabilityRunId, options.nodeRunId],
          );
          const capability = capabilityRows[0];
          if (!capability || capability.workspaceId !== event.workspaceId) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          if (
            classifyAggregateVersion(
              capability.version,
              event.aggregateVersion,
            ) === "stale"
          ) {
            return {
              outcome: "noop",
              resultCode: "capability.terminal.stale_event",
              value: {
                finished: false,
                cancellationSettled: false,
              },
            };
          }

          let expectedCapabilityStatus = "cancelled";
          if (event.messageType === "capability.run.completed") {
            expectedCapabilityStatus = "completed";
          } else if (event.messageType === "capability.run.failed") {
            expectedCapabilityStatus = "failed";
          }
          if (capability.lifecycleStatus !== expectedCapabilityStatus) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }

          if (!["cancelling", "cancelled"].includes(run.lifecycleStatus)) {
            throw new InboxDeliveryError("inbox.event.fact_mismatch");
          }
          const wasCancelling = run.lifecycleStatus === "cancelling";
          const cancellationSettled =
            await settleWorkflowCancellationInTransaction(connection, options);
          return {
            outcome: wasCancelling && cancellationSettled ? "applied" : "noop",
            resultCode:
              wasCancelling && cancellationSettled
                ? "workflow.terminal.cancelled"
                : "workflow.terminal.cancellation_pending",
            value: {
              finished: false,
              cancellationSettled,
            },
          };
        }),
      );
    },
  });
}
