import { recordAgentLibraryToolInputsInTransaction } from "./agent-library-store.js";
import { projectProviderResultLinks } from "./provider-result-links.js";
import { createRuntimeConfigurationReader } from "./runtime-configuration-reader.js";
import { readRuntimeConfiguration } from "./runtime-configuration-store.js";
import type { ResultDownloadRule } from "@kanvas/contracts/api";
import {
  authorizeToolSessionRunInTransaction,
  type ToolSessionRunContext,
} from "./tool-session-store.js";
import {
  parseModelProfileDocumentV1,
  parseProviderRouteSnapshot,
  type CapabilityExecutionTarget,
  type CapabilityIdempotencyMode,
  type CapabilityRouteSnapshot,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  CanvasCapabilitySummary,
  UserCapabilitySummary,
  WorkflowCapabilityAuthoringDeclaration,
  WorkflowCapabilityOutputDeclaration,
  WorkflowCapabilityParameterDeclaration,
} from "@kanvas/contracts/api";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { availableCapabilityBindingCountSql } from "./capability-binding-availability-query.js";
import {
  parseProviderDeploymentHardBounds,
  type ProviderDeploymentHardBounds,
} from "./configuration-policy.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  normalizeAttemptTimeoutMs,
  normalizeRetryPolicy,
} from "./execution-retry-policy.js";
import {
  createExecutionTargetGate,
  isQueueExecutionTarget,
  type ExecutionTarget,
  type ExecutionTargetGate,
} from "./execution-target.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { resolvePinnedProviderParameters } from "./provider-invocation-identity.js";
import {
  ProviderRouteStoreError,
  resolveProviderRouteInTransaction,
} from "./provider-route-store.js";

export type DirectCapabilityInvocationKind = "user" | "agent" | "canvas";

export interface DirectCapabilityRunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly contractRevisionId: string;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly lifecycleStatus:
    "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly input: unknown;
  readonly output?: unknown;
  readonly externalResultUrls?: readonly string[];
  readonly outputDeclarations?: readonly WorkflowCapabilityOutputDeclaration[];
  readonly inputDeclarations?: readonly WorkflowCapabilityParameterDeclaration[];
  readonly error?: Readonly<Record<string, unknown>>;
  readonly browserExecution?: {
    readonly requiredCapabilityKeys: readonly string[];
  };
  readonly version: number;
  readonly executionDeadlineAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
  readonly cancelRequestedAt?: Date;
}

export interface InvokableCapabilityRecord {
  readonly contractRevisionId: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface CreateDirectCapabilityRunOptions {
  readonly toolSession?: ToolSessionRunContext;
  readonly scope: TrustedWorkspaceScope;
  readonly invocationKind: DirectCapabilityInvocationKind;
  readonly invocationReferenceId: string;
  readonly contractRevisionId: string;
  readonly idempotencyKey: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly runId: string;
  readonly attemptId: string;
  readonly outboxEventId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CapabilityRunStore {
  listUserCapabilities(
    scope: TrustedWorkspaceScope,
    locale: "zh-CN" | "en-US",
    now: Date,
    allowedContractRevisionIds?: readonly string[],
  ): Promise<readonly UserCapabilitySummary[]>;
  listCanvasCapabilities(
    scope: TrustedWorkspaceScope,
    query: {
      readonly actionGroup: string;
      readonly selectedSemanticType: string;
      readonly locale: "zh-CN" | "en-US";
    },
    now: Date,
  ): Promise<readonly CanvasCapabilitySummary[]>;
  getInvokable(
    scope: TrustedWorkspaceScope,
    contractRevisionId: string,
    invocationKind: DirectCapabilityInvocationKind,
    now: Date,
  ): Promise<InvokableCapabilityRecord>;
  createDirect(
    options: CreateDirectCapabilityRunOptions,
  ): Promise<Readonly<{ run: DirectCapabilityRunRecord; replayed: boolean }>>;
  get(
    scope: TrustedWorkspaceScope,
    capabilityRunId: string,
    now: Date,
  ): Promise<DirectCapabilityRunRecord>;
  cancelDirect(
    scope: TrustedWorkspaceScope,
    capabilityRunId: string,
    now: Date,
    audit: ControlPlaneAuditContext,
  ): Promise<DirectCapabilityRunRecord>;
}

export type CapabilityRunStoreErrorCode =
  | "capability_run.invalid_argument"
  | "capability_run.input_invalid"
  | "capability_run.not_found"
  | "capability_run.unavailable"
  | "capability_run.idempotency_conflict"
  | "capability_run.lifecycle_conflict"
  | "capability_run.runtime_not_active";

export class CapabilityRunStoreError extends Error {
  public constructor(
    readonly code: CapabilityRunStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityRunStoreError";
  }
}

interface CapabilityRow extends RowDataPacket {
  readonly declarationRevisionId: string;
  readonly capabilityKey: string;
  readonly contractRevisionId: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
}

interface CapabilityAvailabilityRow extends RowDataPacket {
  readonly contractRevisionId: string;
  readonly activeBindingCount: number | string;
}

interface BindingRow extends RowDataPacket {
  readonly contractRevisionId: string;
  readonly contractKey: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly idempotencyMode: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
  readonly routePolicyRevisionId: string | null;
  readonly routePolicy: unknown;
}

interface RunRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly contractRevisionId: string;
  readonly invocationKind: DirectCapabilityRunRecord["invocationKind"];
  readonly createdBy: string;
  readonly workflowIdempotencyKey: string | null;
  readonly workflowCreatedBy: string | null;
  readonly requestHash: string | null;
  readonly lifecycleStatus: DirectCapabilityRunRecord["lifecycleStatus"];
  readonly input: unknown;
  readonly output: unknown;
  readonly declaration: unknown;
  readonly error: unknown;
  readonly outputMaterializationFailed?: number;
  readonly routeSnapshot: unknown;
  readonly routeSnapshotHash: string;
  readonly currentAttemptExecutionTarget: string | null;
  readonly currentAttemptRouteCandidateIndex: number | null;
  readonly version: number;
  readonly executionDeadlineAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly cancelRequestedAt: Date | null;
}

interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface RuntimeRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const semanticPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const maximumDirectRunDurationMs = 24 * 60 * 60 * 1_000;

function fail(code: CapabilityRunStoreErrorCode, message: string): never {
  throw new CapabilityRunStoreError(code, message);
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : undefined;
}

function executionTarget(value: string): CapabilityExecutionTarget {
  if (value === "browser" || value === "provider" || value === "worker") {
    return value;
  }
  return fail("capability_run.unavailable", "Capability route is invalid.");
}

function idempotencyMode(value: string): CapabilityIdempotencyMode {
  if (
    value === "intrinsic" ||
    value === "keyed" ||
    value === "non_idempotent"
  ) {
    return value;
  }
  return fail("capability_run.unavailable", "Capability contract is invalid.");
}

function fallbackOn(
  routePolicy: Readonly<Record<string, unknown>>,
  target: CapabilityExecutionTarget,
): readonly (
  "browser_executor_fenced" | "browser_lease_expired" | "not_started"
)[] {
  const values = routePolicy.fallbackOn;
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) {
    return fail(
      "capability_run.unavailable",
      "Capability route policy is invalid.",
    );
  }
  const supported = new Set([
    "browser_executor_fenced",
    "browser_lease_expired",
    "not_started",
  ]);
  const normalized = values.filter(
    (
      value,
    ): value is
      "browser_executor_fenced" | "browser_lease_expired" | "not_started" =>
      typeof value === "string" && supported.has(value),
  );
  if (
    normalized.length !== values.length ||
    new Set(normalized).size !== normalized.length ||
    (target !== "browser" &&
      normalized.some((value) => value !== "not_started"))
  ) {
    return fail(
      "capability_run.unavailable",
      "Capability route policy is invalid.",
    );
  }
  return Object.freeze(normalized);
}

// A remote success can be followed by local storage failure and a later lease
// deadline. The preserved Provider observation is more specific than that deadline.
export function capabilityRunError(
  error: unknown,
  outputMaterializationFailed: boolean,
): Readonly<Record<string, unknown>> | undefined {
  const original = record(error);
  const deliveryFailureWasMasked =
    outputMaterializationFailed &&
    (!original ||
      original.code === "attempt.execution_deadline_expired" ||
      original.code === "provider.output_materialization_failed");
  return deliveryFailureWasMasked
    ? {
        ...original,
        code: "provider.output_materialization_failed",
        remoteStatus: "succeeded",
        failureStage: "result_storage",
      }
    : original;
}

const outputMaterializationFailureSql = `EXISTS (
  SELECT 1 FROM provider_invocation invocation
  JOIN provider_invocation_observation observation ON observation.provider_invocation_id = invocation.id
  WHERE invocation.workspace_id = capability.workspace_id
    AND invocation.capability_attempt_id = attempt.id
    AND observation.stable_error_code = 'provider.output_materialization_failed'
    AND observation.adoption_outcome = 'applied'
) AS outputMaterializationFailed`;

function runFrom(row: RunRow): DirectCapabilityRunRecord {
  const output = parseJson(row.output);
  const declaration = parseJson(
    row.declaration,
  ) as WorkflowCapabilityAuthoringDeclaration | null;
  const outputDeclarations = declaration?.outputs;
  const inputDeclarations = declaration?.parameters;
  const error = capabilityRunError(
    row.error,
    row.lifecycleStatus === "failed" &&
      Number(row.outputMaterializationFailed) === 1,
  );
  const browserExecution = directCapabilityBrowserExecution({
    executionTarget: row.currentAttemptExecutionTarget,
    routeCandidateIndex: row.currentAttemptRouteCandidateIndex,
    routeSnapshot: row.routeSnapshot,
    routeSnapshotHash: row.routeSnapshotHash,
  });
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    contractRevisionId: row.contractRevisionId,
    invocationKind: row.invocationKind,
    lifecycleStatus: row.lifecycleStatus,
    input: parseJson(row.input),
    ...(inputDeclarations
      ? { inputDeclarations: Object.freeze([...inputDeclarations]) }
      : {}),
    ...(output === null || output === undefined ? {} : { output }),
    ...(outputDeclarations
      ? { outputDeclarations: Object.freeze([...outputDeclarations]) }
      : {}),
    ...(error ? { error } : {}),
    ...(browserExecution ? { browserExecution } : {}),
    version: row.version,
    executionDeadlineAt: row.executionDeadlineAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.cancelRequestedAt
      ? { cancelRequestedAt: row.cancelRequestedAt }
      : {}),
  });
}

export function directCapabilityBrowserExecution(options: {
  readonly executionTarget: string | null;
  readonly routeCandidateIndex: number | null;
  readonly routeSnapshot: unknown;
  readonly routeSnapshotHash: string;
}): DirectCapabilityRunRecord["browserExecution"] {
  if (options.executionTarget !== "browser") return undefined;
  const snapshot = parseJson(options.routeSnapshot);
  if (digestProviderValue(snapshot) !== options.routeSnapshotHash) {
    return fail(
      "capability_run.unavailable",
      "Capability route identity does not match its snapshot.",
    );
  }
  const route = record(snapshot);
  const contractKey = route?.contractKey;
  const candidates = Array.isArray(route?.candidates) ? route.candidates : [];
  const candidate =
    options.routeCandidateIndex === null
      ? undefined
      : record(candidates[options.routeCandidateIndex]);
  if (
    typeof contractKey !== "string" ||
    !semanticPattern.test(contractKey) ||
    candidate?.executionTarget !== "browser"
  ) {
    return fail(
      "capability_run.unavailable",
      "Capability browser route projection is invalid.",
    );
  }
  return Object.freeze({
    requiredCapabilityKeys: Object.freeze([contractKey]),
  });
}

async function transaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
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

async function loadRun(
  connection: PoolConnection,
  workspaceId: string,
  capabilityRunId: string,
  lock = false,
): Promise<RunRow | undefined> {
  const [rows] = await connection.execute<RunRow[]>(
    `SELECT
       capability.id,
       capability.workspace_id AS workspaceId,
       capability.contract_revision_id AS contractRevisionId,
       capability.invocation_kind AS invocationKind,
       capability.created_by AS createdBy,
       workflow.idempotency_key AS workflowIdempotencyKey,
       workflow.created_by AS workflowCreatedBy,
       capability.request_hash AS requestHash,
       capability.lifecycle_status AS lifecycleStatus,
       capability.input,
       capability.output,
       (
         SELECT declaration.declaration
         FROM capability_declaration_revision AS declaration
         WHERE declaration.workspace_id = capability.workspace_id
           AND declaration.contract_revision_id = capability.contract_revision_id
           AND (
             declaration.id = capability.declaration_revision_id
             OR (capability.declaration_revision_id IS NULL
               AND declaration.published_at <= capability.created_at
               AND declaration.lifecycle_status <> 'draft')
           )
         ORDER BY declaration.revision DESC
         LIMIT 1
       ) AS declaration,
       attempt.error,
       ${outputMaterializationFailureSql},
       capability.route_snapshot AS routeSnapshot,
       capability.route_snapshot_hash AS routeSnapshotHash,
       attempt.execution_target AS currentAttemptExecutionTarget,
       attempt.route_candidate_index AS currentAttemptRouteCandidateIndex,
       capability.version,
       capability.execution_deadline_at AS executionDeadlineAt,
       capability.created_at AS createdAt,
       capability.updated_at AS updatedAt,
       capability.completed_at AS completedAt,
       capability.cancel_requested_at AS cancelRequestedAt
     FROM capability_run AS capability
     LEFT JOIN capability_attempt AS attempt
       ON attempt.workspace_id = capability.workspace_id
      AND attempt.id = capability.current_attempt_id
     LEFT JOIN node_run AS node
       ON node.workspace_id = capability.workspace_id
      AND node.id = capability.node_run_id
     LEFT JOIN workflow_run AS workflow
       ON workflow.workspace_id = node.workspace_id
      AND workflow.id = node.workflow_run_id
     WHERE capability.workspace_id = ? AND capability.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, capabilityRunId],
  );
  return rows[0];
}

function validateInvocationArguments(
  options: CreateDirectCapabilityRunOptions,
): void {
  if (
    !idPattern.test(options.contractRevisionId) ||
    !idPattern.test(options.runId) ||
    !idPattern.test(options.attemptId) ||
    !idPattern.test(options.outboxEventId) ||
    options.invocationReferenceId.length < 1 ||
    options.invocationReferenceId.length > 160 ||
    options.idempotencyKey.length < 1 ||
    options.idempotencyKey.length > 160 ||
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime())
  ) {
    fail(
      "capability_run.invalid_argument",
      "Capability Run request is invalid.",
    );
  }
}

function capabilityFilter(
  invocationKind: DirectCapabilityInvocationKind,
): string {
  const surfaceFilter =
    invocationKind === "user"
      ? ""
      : `AND JSON_CONTAINS(
      JSON_EXTRACT(declaration.declaration, '$.catalog.surfaces'),
      JSON_QUOTE('${invocationKind}')
    ) = 1`;
  return `definition.lifecycle_status = 'active'
    AND contract.lifecycle_status = 'published'
    AND JSON_CONTAINS(contract.supported_invokers, JSON_QUOTE('${invocationKind}')) = 1
    ${surfaceFilter}`;
}

async function loadAvailableContractIds(
  connection: PoolConnection,
  workspaceId: string,
  now: Date,
  contractRevisionId?: string,
): Promise<ReadonlySet<string>> {
  const [rows] = await connection.execute<CapabilityAvailabilityRow[]>(
    `SELECT contract.id AS contractRevisionId,
            ${availableCapabilityBindingCountSql} AS activeBindingCount
     FROM capability_definition AS definition
     INNER JOIN capability_contract_revision AS contract
       ON contract.workspace_id = definition.workspace_id
      AND contract.id = definition.current_contract_revision_id
     WHERE definition.workspace_id = ?
       ${contractRevisionId ? "AND contract.id = ?" : ""}
     LIMIT 501`,
    [
      now,
      now,
      workspaceId,
      ...(contractRevisionId ? [contractRevisionId] : []),
    ],
  );
  return new Set(
    rows
      .filter((row) => Number(row.activeBindingCount) > 0)
      .map((row) => row.contractRevisionId),
  );
}

async function loadInvokable(
  connection: PoolConnection,
  workspaceId: string,
  contractRevisionId: string,
  invocationKind: DirectCapabilityInvocationKind,
  now: Date,
): Promise<CapabilityRow> {
  const [rows] = await connection.execute<CapabilityRow[]>(
    `SELECT
       definition.capability_key AS capabilityKey,
       contract.id AS contractRevisionId,
       contract.input_schema AS inputSchema,
       declaration.id AS declarationRevisionId,
       declaration.declaration
     FROM capability_definition AS definition
     INNER JOIN capability_contract_revision AS contract
       ON contract.workspace_id = definition.workspace_id
      AND contract.id = definition.current_contract_revision_id
     INNER JOIN capability_declaration_revision AS declaration
       ON declaration.workspace_id = definition.workspace_id
      AND declaration.id = definition.current_declaration_revision_id
     WHERE definition.workspace_id = ?
       AND contract.id = ?
       AND ${capabilityFilter(invocationKind)}
     LIMIT 1
     FOR SHARE`,
    [workspaceId, contractRevisionId],
  );
  const row = rows[0];
  const available = row
    ? await loadAvailableContractIds(
        connection,
        workspaceId,
        now,
        contractRevisionId,
      )
    : new Set<string>();
  if (!row || !available.has(contractRevisionId)) {
    return fail(
      "capability_run.unavailable",
      "Capability is unavailable for this invocation surface.",
    );
  }
  return row;
}

async function resolveRoute(
  connection: PoolConnection,
  workspaceId: string,
  contractRevisionId: string,
  requestScopeDigest: string,
  now: Date,
  providerDeploymentHardBounds: ProviderDeploymentHardBounds | undefined,
  targetGate: ExecutionTargetGate,
): Promise<CapabilityRouteSnapshot> {
  const [rows] = await connection.execute<BindingRow[]>(
    `SELECT
       contract.id AS contractRevisionId,
       contract.contract_key AS contractKey,
       contract.revision AS contractRevision,
       contract.canonical_digest AS contractDigest,
       contract.idempotency_mode AS idempotencyMode,
       binding.id AS bindingId,
       binding.version AS bindingVersion,
       implementation.id AS implementationRevisionId,
       implementation.canonical_digest AS implementationDigest,
       implementation.execution_target AS executionTarget,
       implementation.adapter_key AS adapterKey,
       binding.route_policy_revision_id AS routePolicyRevisionId,
       binding.route_policy AS routePolicy
     FROM capability_contract_revision AS contract
     INNER JOIN capability_binding AS binding
       ON binding.workspace_id = contract.workspace_id
      AND binding.contract_revision_id = contract.id
      AND binding.lifecycle_status = 'active'
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.workspace_id = binding.workspace_id
      AND implementation.id = binding.implementation_revision_id
      AND implementation.lifecycle_status = 'published'
     WHERE contract.workspace_id = ?
       AND contract.id = ?
       AND contract.lifecycle_status = 'published'
       AND (
         implementation.source_kind <> 'model_resource'
         OR EXISTS (
           SELECT 1
           FROM capability_implementation_model_resource AS resource_ref
           INNER JOIN model_resource_revision AS resource_revision
             ON resource_revision.workspace_id = resource_ref.workspace_id
            AND resource_revision.id = resource_ref.model_resource_revision_id
            AND resource_revision.lifecycle_status = 'published'
           INNER JOIN model_resource AS resource
             ON resource.workspace_id = resource_revision.workspace_id
            AND resource.id = resource_revision.model_resource_id
            AND resource.lifecycle_status = 'active'
           INNER JOIN model_resource_revision_file AS resource_file
             ON resource_file.workspace_id = resource_revision.workspace_id
            AND resource_file.model_resource_revision_id = resource_revision.id
            AND resource_file.role = 'primary'
           INNER JOIN stored_object AS resource_object
             ON resource_object.workspace_id = resource_file.workspace_id
            AND resource_object.id = resource_file.stored_object_id
            AND resource_object.delete_state = 'active'
           WHERE resource_ref.workspace_id = implementation.workspace_id
             AND resource_ref.implementation_revision_id = implementation.id
             AND resource_ref.resource_role = 'primary'
         )
       )
     ORDER BY binding.priority ASC
     LIMIT 65
     FOR SHARE`,
    [workspaceId, contractRevisionId],
  );
  if (rows.length === 0) {
    return fail(
      "capability_run.unavailable",
      "Capability has no available route.",
    );
  }
  if (rows.length > 64) {
    return fail("capability_run.unavailable", "Capability route is too broad.");
  }
  const candidates: CapabilityRouteSnapshot["candidates"][number][] = [];
  let totalAttempts = 0;
  for (const row of rows) {
    const target = executionTarget(row.executionTarget);
    if (!targetGate.allows(target)) continue;
    const policy = record(row.routePolicy);
    if (!policy) {
      return fail(
        "capability_run.unavailable",
        "Capability route policy is invalid.",
      );
    }
    const retryPolicy = normalizeRetryPolicy(policy);
    const facts = {
      candidateIndex: candidates.length,
      bindingId: row.bindingId,
      bindingVersion: row.bindingVersion,
      implementationRevisionId: row.implementationRevisionId,
      implementationDigest: row.implementationDigest,
      executionTarget: target,
      adapterKey: row.adapterKey,
      idempotencyMode: idempotencyMode(row.idempotencyMode),
      retryPolicy,
      attemptTimeoutMs: normalizeAttemptTimeoutMs(policy),
      fallbackOn: fallbackOn(policy, target),
    } as const;
    if (target === "provider") {
      if (!row.routePolicyRevisionId) continue;
      try {
        const providerRoute = await resolveProviderRouteInTransaction(
          connection,
          providerDeploymentHardBounds,
          {
            workspaceId,
            capabilityBindingId: row.bindingId,
            requestScopeDigest,
            now,
          },
        );
        candidates.push(
          Object.freeze({ ...facts, executionTarget: target, providerRoute }),
        );
      } catch (error) {
        if (
          error instanceof ProviderRouteStoreError &&
          (error.code === "provider_route.not_configured" ||
            error.code === "provider_route.unavailable")
        ) {
          continue;
        }
        throw error;
      }
    } else {
      candidates.push(Object.freeze({ ...facts, executionTarget: target }));
    }
    totalAttempts += retryPolicy.maxAttempts;
    if (candidates.length > 8 || totalAttempts > 32) {
      return fail(
        "capability_run.unavailable",
        "Capability route exceeds execution bounds.",
      );
    }
  }
  const contract = rows[0]!;
  if (candidates.length === 0) {
    return fail(
      "capability_run.unavailable",
      "Capability has no dispatchable route.",
    );
  }
  return Object.freeze({
    nodeKey: "direct",
    contractRevisionId: contract.contractRevisionId,
    contractKey: contract.contractKey,
    contractRevision: contract.contractRevision,
    contractDigest: contract.contractDigest,
    candidates: Object.freeze(candidates),
  });
}

export function createCapabilityRunStore(
  pool: Pool,
  settings: {
    readonly instanceId: string;
    readonly enabledExecutionTargets?: readonly ExecutionTarget[];
    readonly providerDeploymentHardBounds?: unknown;
    readonly resultDownloadDeployment?: ResultDownloadRule;
  },
): CapabilityRunStore {
  const targetGate = createExecutionTargetGate(
    settings.enabledExecutionTargets,
  );
  const instanceId = settings.instanceId;
  const providerDeploymentHardBounds =
    settings.providerDeploymentHardBounds === undefined
      ? undefined
      : parseProviderDeploymentHardBounds(
          settings.providerDeploymentHardBounds,
        );

  return Object.freeze<CapabilityRunStore>({
    async listUserCapabilities(scope, locale, now, allowedContractRevisionIds) {
      if (
        allowedContractRevisionIds &&
        (allowedContractRevisionIds.length > 32 ||
          allowedContractRevisionIds.some((id) => !idPattern.test(id)))
      )
        fail(
          "capability_run.invalid_argument",
          "Tool capability filter is invalid.",
        );
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<CapabilityRow[]>(
          `SELECT definition.capability_key AS capabilityKey,
                  contract.id AS contractRevisionId, contract.input_schema AS inputSchema,
                  declaration.declaration
           FROM capability_definition AS definition
           INNER JOIN capability_contract_revision AS contract
             ON contract.workspace_id = definition.workspace_id
            AND contract.id = definition.current_contract_revision_id
           INNER JOIN capability_declaration_revision AS declaration
             ON declaration.workspace_id = definition.workspace_id
            AND declaration.id = definition.current_declaration_revision_id
           WHERE definition.workspace_id = ? AND ${capabilityFilter("user")}
           ${allowedContractRevisionIds ? "AND JSON_CONTAINS(CAST(? AS JSON), JSON_QUOTE(contract.id))=1" : ""}
           ORDER BY definition.capability_key LIMIT 501`,
          [
            scope.workspaceId,
            ...(allowedContractRevisionIds
              ? [JSON.stringify(allowedContractRevisionIds)]
              : []),
          ],
        );
        const available = await loadAvailableContractIds(
          connection,
          scope.workspaceId,
          now,
        );
        return rows
          .filter((row) => available.has(row.contractRevisionId))
          .slice(0, 101)
          .map((row) => ({
            contractRevisionId: row.contractRevisionId,
            capabilityKey: row.capabilityKey,
            displayName: row.declaration.catalog.title[locale],
            ...(row.declaration.catalog.description
              ? { description: row.declaration.catalog.description[locale] }
              : {}),
            category: row.declaration.catalog.category[locale],
            inputSchema: row.inputSchema,
            parameters: row.declaration.parameters,
            outputs: row.declaration.outputs,
          }));
      });
    },
    async listCanvasCapabilities(scope, query, now) {
      if (
        !semanticPattern.test(query.actionGroup) ||
        !semanticPattern.test(query.selectedSemanticType)
      ) {
        fail(
          "capability_run.invalid_argument",
          "Canvas capability query is invalid.",
        );
      }
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<CapabilityRow[]>(
          `SELECT
             definition.capability_key AS capabilityKey,
             contract.id AS contractRevisionId,
             contract.input_schema AS inputSchema,
             declaration.declaration
           FROM capability_definition AS definition
           INNER JOIN capability_contract_revision AS contract
             ON contract.workspace_id = definition.workspace_id
            AND contract.id = definition.current_contract_revision_id
           INNER JOIN capability_declaration_revision AS declaration
             ON declaration.workspace_id = definition.workspace_id
            AND declaration.id = definition.current_declaration_revision_id
           WHERE definition.workspace_id = ?
             AND ${capabilityFilter("canvas")}
           ORDER BY definition.capability_key
           LIMIT 501`,
          [scope.workspaceId],
        );
        const availableContractIds = await loadAvailableContractIds(
          connection,
          scope.workspaceId,
          now,
        );
        return Object.freeze(
          rows
            .filter(
              (row) =>
                row.declaration.canvas?.actionGroup === query.actionGroup &&
                row.declaration.parameters.some(
                  (parameter) =>
                    parameter.semanticType === query.selectedSemanticType &&
                    parameter.sourcePolicy.allowed.includes("canvas_selection"),
                ),
            )
            .filter((row) => availableContractIds.has(row.contractRevisionId))
            .slice(0, 101)
            .map((row) => {
              const declaration = row.declaration;
              if (!declaration.canvas) {
                return fail(
                  "capability_run.unavailable",
                  "Canvas capability declaration is incomplete.",
                );
              }
              return Object.freeze({
                contractRevisionId: row.contractRevisionId,
                capabilityKey: row.capabilityKey,
                displayName: declaration.catalog.title[query.locale],
                ...(declaration.catalog.description
                  ? {
                      description:
                        declaration.catalog.description[query.locale],
                    }
                  : {}),
                category: declaration.catalog.category[query.locale],
                inputSchema: row.inputSchema,
                parameters: declaration.parameters,
                outputs: declaration.outputs,
                canvas: declaration.canvas,
              });
            }),
        );
      });
    },

    async getInvokable(scope, contractRevisionId, invocationKind, now) {
      if (!idPattern.test(contractRevisionId)) {
        fail(
          "capability_run.invalid_argument",
          "Capability identity is invalid.",
        );
      }
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const capability = await loadInvokable(
          connection,
          scope.workspaceId,
          contractRevisionId,
          invocationKind,
          now,
        );
        return Object.freeze({
          contractRevisionId: capability.contractRevisionId,
          inputSchema: capability.inputSchema,
        });
      });
    },

    async createDirect(options) {
      validateInvocationArguments(options);
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.run",
          options.now,
        );
        if (options.toolSession) {
          if (
            options.invocationKind !== "user" ||
            options.invocationReferenceId !==
              `tool:${options.toolSession.sessionId}` ||
            options.idempotencyKey !==
              `tool:${options.toolSession.sessionId}:${options.toolSession.requestKey}`
          )
            fail(
              "capability_run.invalid_argument",
              "Tool execution identity is invalid.",
            );
          await authorizeToolSessionRunInTransaction(
            connection,
            instanceId,
            options.scope,
            options.toolSession,
            options.contractRevisionId,
            options.now,
          );
        }
        const capability = await loadInvokable(
          connection,
          options.scope.workspaceId,
          options.contractRevisionId,
          options.invocationKind,
          options.now,
        );
        const requestHash = digestProviderValue({
          schemaVersion: 1,
          ...(options.toolSession ? { toolSession: options.toolSession } : {}),
          invocationKind: options.invocationKind,
          contractRevisionId: options.contractRevisionId,
          input: options.input,
        });
        const [replays] = await connection.execute<RunRow[]>(
          `SELECT
             capability.id,
             capability.workspace_id AS workspaceId,
             capability.contract_revision_id AS contractRevisionId,
             capability.invocation_kind AS invocationKind,
             capability.request_hash AS requestHash,
             capability.lifecycle_status AS lifecycleStatus,
             capability.input,
             capability.output,
             attempt.error,
       ${outputMaterializationFailureSql},
             capability.route_snapshot AS routeSnapshot,
             capability.route_snapshot_hash AS routeSnapshotHash,
             attempt.execution_target AS currentAttemptExecutionTarget,
             attempt.route_candidate_index AS currentAttemptRouteCandidateIndex,
             capability.version,
             capability.execution_deadline_at AS executionDeadlineAt,
             capability.created_at AS createdAt,
             capability.updated_at AS updatedAt,
             capability.completed_at AS completedAt,
             capability.cancel_requested_at AS cancelRequestedAt
           FROM capability_run AS capability
           LEFT JOIN capability_attempt AS attempt
             ON attempt.workspace_id = capability.workspace_id
            AND attempt.id = capability.current_attempt_id
           WHERE capability.workspace_id = ?
             AND capability.invocation_kind = ?
             AND capability.idempotency_key = ?
           LIMIT 1
           FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.invocationKind,
            options.idempotencyKey,
          ],
        );
        const replay = replays[0];
        if (replay) {
          if (replay.requestHash !== requestHash) {
            fail(
              "capability_run.idempotency_conflict",
              "Idempotency key is already used by another Capability Run.",
            );
          }
          const replayDetails = await loadRun(
            connection,
            options.scope.workspaceId,
            replay.id,
          );
          return Object.freeze({
            run: runFrom(replayDetails!),
            replayed: true,
          });
        }
        const [runtimeRows] = await connection.execute<RuntimeRow[]>(
          `SELECT state, execution_generation AS executionGeneration
           FROM instance_runtime_state
           WHERE instance_id = ?
           LIMIT 1
           FOR SHARE`,
          [instanceId],
        );
        const runtime = runtimeRows[0];
        if (!runtime || runtime.state !== "ACTIVE") {
          fail(
            "capability_run.runtime_not_active",
            "Runtime is not accepting new Capability Runs.",
          );
        }
        const route = await resolveRoute(
          connection,
          options.scope.workspaceId,
          options.contractRevisionId,
          requestHash,
          options.now,
          providerDeploymentHardBounds,
          targetGate,
        );
        const candidate = route.candidates[0]!;
        if (candidate.executionTarget === "provider") {
          const providerRoute = parseProviderRouteSnapshot(
            candidate.providerRoute,
          );
          const [profiles] = await connection.execute<
            (RowDataPacket & {
              profileDocument: unknown;
              canonicalDigest: string;
            })[]
          >(
            `SELECT profile_document AS profileDocument, canonical_digest AS canonicalDigest
             FROM model_profile_revision WHERE workspace_id = ? AND id = ?
               AND lifecycle_status = 'published' LIMIT 1 FOR SHARE`,
            [options.scope.workspaceId, providerRoute.modelProfileRevisionId],
          );
          const profile = profiles[0];
          if (
            !profile ||
            digestProviderValue(parseJson(profile.profileDocument)) !==
              profile.canonicalDigest
          ) {
            fail(
              "capability_run.unavailable",
              "The selected model profile is unavailable.",
            );
          }
          const modelProfileDocument = parseJson(profile.profileDocument);
          try {
            parseModelProfileDocumentV1(modelProfileDocument);
            resolvePinnedProviderParameters({
              route: providerRoute,
              modelProfileDocument,
              modelProfileDigest: profile.canonicalDigest,
              capabilityInputSchema: capability.inputSchema,
              input: options.input,
            });
          } catch {
            fail(
              "capability_run.input_invalid",
              "Selected options are not supported by the active service. Review the available options.",
            );
          }
        }
        const routeSnapshotHash = digestProviderValue(route);
        const inputDigest = digestProviderValue(options.input);
        const executionDeadlineAt = new Date(
          options.now.getTime() + maximumDirectRunDurationMs,
        );
        const attemptDeadlineAt = new Date(
          Math.min(
            executionDeadlineAt.getTime(),
            options.now.getTime() + candidate.attemptTimeoutMs,
          ),
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_run (
             id, workspace_id, node_run_id, invocation_kind,
             invocation_reference_id, idempotency_key, request_hash,
             created_by, input, input_digest, route_snapshot,
             route_snapshot_hash, execution_deadline_at,
             contract_revision_id, declaration_revision_id, binding_id,
             implementation_revision_id, lifecycle_status,
             version, created_at, updated_at
           ) VALUES (
             ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'queued', 1, ?, ?
           )`,
          [
            options.runId,
            options.scope.workspaceId,
            options.invocationKind,
            options.invocationReferenceId,
            options.idempotencyKey,
            requestHash,
            options.scope.principalId,
            JSON.stringify(options.input),
            inputDigest,
            JSON.stringify(route),
            routeSnapshotHash,
            executionDeadlineAt,
            options.contractRevisionId,
            capability.declarationRevisionId,
            candidate.bindingId,
            candidate.implementationRevisionId,
            options.now,
            options.now,
          ],
        );
        await recordAgentLibraryToolInputsInTransaction(connection, {
          authority: options.scope,
          invocationKind: options.invocationKind,
          invocationReferenceId: options.invocationReferenceId,
          consumerId: options.runId,
          input: options.input,
          now: options.now,
        });
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_attempt (
             id, workspace_id, capability_run_id, binding_id,
             route_candidate_index, candidate_attempt_number,
             transition_kind, transition_reason_code, attempt_number,
             execution_target, implementation_revision_id,
             lifecycle_status, side_effect_state, not_before,
             execution_deadline_at, lease_generation, version,
             created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, 0, 1, 'initial', 'capability.direct.initial', 1,
             ?, ?, 'created', 'not_started', ?, ?, 0, 1, ?, ?
           )`,
          [
            options.attemptId,
            options.scope.workspaceId,
            options.runId,
            candidate.bindingId,
            candidate.executionTarget,
            candidate.implementationRevisionId,
            options.now,
            attemptDeadlineAt,
            options.now,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE capability_run
           SET current_attempt_id = ?
           WHERE workspace_id = ? AND id = ? AND current_attempt_id IS NULL`,
          [options.attemptId, options.scope.workspaceId, options.runId],
        );
        if (isQueueExecutionTarget(candidate.executionTarget)) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO outbox_event (
               id, workspace_id, message_type, aggregate_type,
               aggregate_id, aggregate_version, payload, status,
               available_at, publish_attempts, created_at
             ) VALUES (
               ?, ?, 'attempt.dispatch.requested', 'capability_attempt',
               ?, 1, ?, 'pending', ?, 0, ?
             )`,
            [
              options.outboxEventId,
              options.scope.workspaceId,
              options.attemptId,
              JSON.stringify({
                invocationKind: options.invocationKind,
                capabilityRunId: options.runId,
                attemptId: options.attemptId,
                executionTarget: candidate.executionTarget,
                expectedGeneration: runtime.executionGeneration,
              }),
              options.now,
              options.now,
            ],
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "capability.run.created",
            action: "capability.run.create",
            resourceType: "capability_run",
            resourceId: options.runId,
            outcome: "succeeded",
            decisionReasonCode: `capability.run.${options.invocationKind}_approved`,
            severity: "info",
            authorizationDecision: {
              permission: "capability.run",
              invocationKind: options.invocationKind,
            },
            details: {
              contractRevisionId: options.contractRevisionId,
              bindingId: candidate.bindingId,
              implementationRevisionId: candidate.implementationRevisionId,
            },
            occurredAt: options.now,
          },
        );
        if (options.toolSession) {
          await connection.execute(
            "INSERT INTO site_tool_session_run (workspace_id, session_id, request_key, capability_run_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [
              options.scope.workspaceId,
              options.toolSession.sessionId,
              options.toolSession.requestKey,
              options.runId,
              options.now,
            ],
          );
        }
        const created = await loadRun(
          connection,
          options.scope.workspaceId,
          options.runId,
        );
        if (!created)
          throw new Error("Capability Run disappeared after creation.");
        return Object.freeze({ run: runFrom(created), replayed: false });
      });
    },

    async get(scope, capabilityRunId, now) {
      if (!idPattern.test(capabilityRunId)) {
        fail(
          "capability_run.invalid_argument",
          "Capability Run identity is invalid.",
        );
      }
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const row = await loadRun(
          connection,
          scope.workspaceId,
          capabilityRunId,
        );
        if (!row)
          fail("capability_run.not_found", "Capability Run was not found.");
        if (
          (row.invocationKind === "agent" &&
            row.createdBy !== scope.principalId) ||
          (row.workflowIdempotencyKey?.startsWith("agent-workflow:") &&
            row.workflowCreatedBy !== scope.principalId)
        ) {
          fail("capability_run.not_found", "Capability Run was not found.");
        }
        const run = runFrom(row);
        if (run.lifecycleStatus !== "failed") return run;
        // Authorization above must precede reading external bearer links. Only
        // the current attempt contributes results; never expose another retry.
        const [results] = await connection.execute<
          (RowDataPacket & {
            resultFacts: unknown;
            providerEndpointId: string;
          })[]
        >(
          `SELECT observed.result_facts AS resultFacts, invocation.provider_endpoint_id AS providerEndpointId
           FROM capability_run capability
           INNER JOIN provider_invocation invocation ON invocation.capability_attempt_id = capability.current_attempt_id
           INNER JOIN provider_invocation_observation observed ON observed.provider_invocation_id = invocation.id
           WHERE capability.id = ? AND capability.workspace_id = ?
             AND observed.workspace_id = capability.workspace_id
             AND observed.normalized_status = 'succeeded' AND observed.adoption_outcome = 'applied'
             AND JSON_LENGTH(COALESCE(JSON_EXTRACT(observed.result_facts, '$.resultEvidence.urls'), JSON_EXTRACT(observed.result_facts, '$.resultUrls'))) > 0
           ORDER BY observed.recorded_at DESC, observed.id DESC LIMIT 1`,
          [capabilityRunId, scope.workspaceId],
        );
        const source = results[0];
        if (!source) return run;
        const snapshot = await createRuntimeConfigurationReader(() =>
          readRuntimeConfiguration(connection, instanceId),
        ).read();
        const rule = snapshot.resultDownloads(
          {
            workspaceId: scope.workspaceId,
            providerEndpointId: source.providerEndpointId,
          },
          settings.resultDownloadDeployment ?? {
            enabled: true,
            allowedOrigins: null,
          },
        ).value;
        const urls = projectProviderResultLinks(
          parseJson(source.resultFacts),
          rule,
        );
        return urls.length
          ? Object.freeze({ ...run, externalResultUrls: urls })
          : run;
      });
    },

    async cancelDirect(scope, capabilityRunId, now, audit) {
      if (!idPattern.test(capabilityRunId)) {
        fail(
          "capability_run.invalid_argument",
          "Capability Run identity is invalid.",
        );
      }
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const run = await loadRun(
          connection,
          scope.workspaceId,
          capabilityRunId,
          true,
        );
        if (!run)
          fail("capability_run.not_found", "Capability Run was not found.");
        if (
          (run.invocationKind === "agent" &&
            run.createdBy !== scope.principalId) ||
          (run.workflowIdempotencyKey?.startsWith("agent-workflow:") &&
            run.workflowCreatedBy !== scope.principalId)
        ) {
          fail("capability_run.not_found", "Capability Run was not found.");
        }
        if (run.invocationKind === "workflow") {
          fail(
            "capability_run.lifecycle_conflict",
            "Workflow-owned Capability Runs must be cancelled through their Workflow.",
          );
        }
        if (
          ["completed", "failed", "cancelled"].includes(run.lifecycleStatus)
        ) {
          return runFrom(run);
        }
        const [attemptRows] = await connection.execute<AttemptRow[]>(
          `SELECT attempt.id, attempt.lifecycle_status AS lifecycleStatus,
                  attempt.version
           FROM capability_attempt AS attempt
           INNER JOIN capability_run AS capability
             ON capability.workspace_id = attempt.workspace_id
            AND capability.current_attempt_id = attempt.id
           WHERE capability.workspace_id = ? AND capability.id = ?
           LIMIT 1
           FOR UPDATE`,
          [scope.workspaceId, capabilityRunId],
        );
        const attempt = attemptRows[0];
        if (!attempt) {
          fail(
            "capability_run.lifecycle_conflict",
            "Capability Run has no current Attempt.",
          );
        }
        const cancelDeadlineAt = new Date(now.getTime() + 30_000);
        if (attempt.lifecycleStatus === "created") {
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
             SET lifecycle_status = 'cancelled', side_effect_state = 'not_started',
                 retry_disposition = 'terminal', cancel_requested_at = ?,
                 cancel_deadline_at = ?, version = version + 1,
                 updated_at = ?, completed_at = ?
             WHERE id = ? AND version = ?`,
            [now, cancelDeadlineAt, now, now, attempt.id, attempt.version],
          );
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
             SET lifecycle_status = 'cancelled', cancel_requested_at = ?,
                 cancel_deadline_at = ?, version = version + 1,
                 updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?`,
            [
              now,
              cancelDeadlineAt,
              now,
              now,
              scope.workspaceId,
              capabilityRunId,
              run.version,
            ],
          );
        } else if (attempt.lifecycleStatus === "running") {
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
             SET cancel_requested_at = ?, cancel_deadline_at = ?,
                 version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND cancel_requested_at IS NULL`,
            [now, cancelDeadlineAt, now, attempt.id, attempt.version],
          );
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
             SET cancel_requested_at = ?, cancel_deadline_at = ?,
                 version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND cancel_requested_at IS NULL`,
            [
              now,
              cancelDeadlineAt,
              now,
              scope.workspaceId,
              capabilityRunId,
              run.version,
            ],
          );
        } else {
          fail(
            "capability_run.lifecycle_conflict",
            "Capability Run Attempt cannot be cancelled from its current state.",
          );
        }
        await appendControlPlaneAuditEventInTransaction(connection, audit, {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          eventType: "capability.run.cancel_requested",
          action: "capability.run.cancel",
          resourceType: "capability_run",
          resourceId: capabilityRunId,
          outcome: "succeeded",
          decisionReasonCode: "capability.run.cancel_requested",
          severity: "info",
          authorizationDecision: { permission: "capability.run" },
          details: { attemptId: attempt.id },
          occurredAt: now,
        });
        const updated = await loadRun(
          connection,
          scope.workspaceId,
          capabilityRunId,
        );
        if (!updated)
          throw new Error("Capability Run disappeared after cancellation.");
        return runFrom(updated);
      });
    },
  });
}
