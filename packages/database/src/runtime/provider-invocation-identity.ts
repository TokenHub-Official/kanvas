import {
  compileEffectiveProviderParameters,
  parseProviderRouteSnapshot,
  type CurrentProviderRouteSnapshot,
  type ProviderRouteSnapshot,
} from "@kanvas/application";
import type { ProviderModelParameterValue } from "@kanvas/contracts/provider-model";
import {
  executeCapabilityMappingPlanV1,
  parseCompiledCapabilityMappingPlanV1,
  type CompiledCapabilityMappingPlanV1,
} from "@kanvas/contracts/capability";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  assertPinnedCandidateIdentity,
  assertPinnedRouteIdentity,
  findPinnedCandidate,
  parsePinnedCapabilityRoute,
  parseJson,
} from "./execution-plan.js";
import {
  InboxDeliveryError,
  type CanonicalInboxEvent,
} from "./inbox-receipt.js";
import {
  ProviderInvocationStoreError,
  type AppendProviderObservationOptions,
  type ClaimProviderDispatchOptions,
  type ProviderInvocationClaim,
  type ProviderInvocationWorkKind,
} from "./provider-invocation-contract.js";
import {
  digestProviderValue,
  ProviderValueCanonicalizationError,
} from "./provider-value-digest.js";
import { providerRouteModelProfileSchemaSupported } from "./provider-route-store.js";

export interface CapabilityRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly nodeRunId: string | null;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly contractRevisionId: string;
  readonly bindingId: string;
  readonly implementationRevisionId: string;
  readonly lifecycleStatus: string;
  readonly currentAttemptId: string | null;
  readonly acceptedAttemptId: string | null;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
}

export interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
  readonly lifecycleStatus: string;
  readonly sideEffectState: string;
  readonly error: unknown;
  readonly executionDeadlineAt: Date | null;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
}

export interface InvocationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityAttemptId: string;
  readonly implementationRevisionId: string;
  readonly providerEndpointId: string;
  readonly providerKey: string;
  readonly apiSurface: string;
  readonly credentialIdentityId: string;
  readonly credentialIdentityEpoch: number;
  readonly pinnedSecretVersionId: string | null;
  readonly modelDeploymentId: string | null;
  readonly pricingRevisionId: string | null;
  readonly budgetReservationId: string | null;
  readonly routeCandidateDigest: string;
  readonly requestScopeDigest: string;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly parameterResolutionDigest: string | null;
  readonly preparedRequestSnapshot: unknown;
  readonly preparedRequestDigest: string | null;
  readonly providerRequestId: string | null;
  readonly remoteStatus: string;
  readonly sideEffectState: string;
  readonly queryMode: string;
  readonly notFoundIsAuthoritative: number | boolean;
  readonly workState: string;
  readonly reconcileLeaseGeneration: number;
  readonly reconcileExecutionGeneration: number | null;
  readonly reconcileLeaseTokenHash: string | null;
  readonly reconcileLeaseExpiresAt: Date | null;
  readonly nextReconcileAt: Date | null;
  readonly version: number;
  readonly submissionStartedAt: Date | null;
  readonly acknowledgedAt: Date | null;
}

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId: string | null;
  readonly workflowWorkspaceId: string | null;
  readonly actorId: string;
  readonly nodeRunId: string | null;
  readonly nodeWorkspaceId: string | null;
  readonly input: unknown;
  readonly inputDigest: string;
  readonly routeSnapshot: unknown;
  readonly capabilityInputSchema: unknown;
  readonly adapterKey: string;
  readonly implementationExecutionTarget: string;
  readonly implementationWorkspaceId: string;
  readonly implementationLifecycleStatus: string;
  readonly implementationCanonicalDigest: string;
  readonly implementationContractRevisionId: string;
  readonly implementationConfiguration: unknown;
  readonly inputMappingDigest: string;
  readonly compiledInputMapping: unknown;
  readonly outputMappingDigest: string;
  readonly compiledOutputMapping: unknown;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapterRevisionStatus: string;
  readonly runtimeAdapterExecutionTarget: string;
  readonly runtimeAdapterKey: string;
  readonly runtimeAdapterDefinitionStatus: string;
}

interface ProviderImplementationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
  readonly lifecycleStatus: string;
  readonly canonicalDigest: string;
  readonly contractRevisionId: string;
  readonly runtimeAdapterRevisionId: string;
}

interface ProviderBindingRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly contractRevisionId: string;
  readonly lifecycleStatus: string;
  readonly contractWorkspaceId: string;
  readonly contractLifecycleStatus: string;
}

export interface PinnedProviderContext {
  readonly invocationKind?: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly adapterKey: string;
  readonly implementationDigest: string;
  readonly implementationLifecycleStatus: string;
  readonly route: ProviderRouteSnapshot;
  readonly input: unknown;
  readonly compiledOutputMapping: CompiledCapabilityMappingPlanV1;
  readonly effectiveParameters?: Readonly<
    Record<string, ProviderModelParameterValue>
  >;
  readonly parameterResolutionSnapshot?: Readonly<Record<string, unknown>>;
  readonly parameterResolutionDigest?: string;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
}

interface ModelProfileSnapshotRow extends RowDataPacket {
  readonly schemaVersion: number;
  readonly profileDocument: unknown;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
}

const kanvasIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const leaseTokenHashPattern = /^[a-f0-9]{64}$/;
const boundedFactPattern = /^[\x21-\x7e]+$/u;

function verifiedCompiledMapping(
  value: unknown,
  expectedDigest: string,
  direction: "input" | "output",
): CompiledCapabilityMappingPlanV1 {
  try {
    const mapping = parseCompiledCapabilityMappingPlanV1(parseJson(value));
    if (
      mapping.direction !== direction ||
      digestProviderValue(mapping) !== expectedDigest
    ) {
      throw new Error("mapping digest mismatch");
    }
    return mapping;
  } catch {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      `Provider ${direction} mapping is unavailable or invalid.`,
    );
  }
}

export function invalidArgument(message: string): never {
  throw new ProviderInvocationStoreError(
    "provider_invocation.invalid_argument",
    message,
  );
}

export function assertId(value: string, label: string): void {
  if (!kanvasIdPattern.test(value)) {
    invalidArgument(`${label} must be a 26-character Kanvas ULID.`);
  }
}

function assertDigest(value: string | undefined, label: string): void {
  if (value !== undefined && !digestPattern.test(value)) {
    invalidArgument(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertBoundedFact(
  value: string,
  label: string,
  maximumLength: number,
): void {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    !boundedFactPattern.test(value)
  ) {
    invalidArgument(`${label} must be a bounded non-whitespace ASCII fact.`);
  }
}

export function assertDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    invalidArgument(`${label} must be a valid timestamp.`);
  }
}

export function isCanonicalLeaseTokenHash(value: string): boolean {
  return leaseTokenHashPattern.test(value);
}

export function assertLeaseWindow(
  now: Date,
  leaseUntil: Date,
  leaseTokenHash: string,
  executionGeneration: number,
): void {
  assertDate(now, "now");
  assertDate(leaseUntil, "leaseUntil");
  if (
    leaseUntil <= now ||
    !leaseTokenHashPattern.test(leaseTokenHash) ||
    !Number.isSafeInteger(executionGeneration) ||
    executionGeneration < 1
  ) {
    invalidArgument("Provider invocation lease facts are invalid.");
  }
}

function digestProviderRequestInput(value: unknown): string {
  try {
    return digestProviderValue(value);
  } catch (error) {
    if (error instanceof ProviderValueCanonicalizationError) {
      return invalidArgument(
        `Provider request input is not canonical JSON: ${error.message}`,
      );
    }
    throw error;
  }
}

function plainRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      `${label} must be an object.`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function capabilityProviderParameterKeys(
  schemaValue: unknown,
  requiredPolicyKeys: readonly string[],
  requiredModelOperation: CurrentProviderRouteSnapshot["modelOperation"],
): readonly string[] {
  const schema = plainRecord(schemaValue, "Capability input schema");
  const configured = schema["x-kanvas-provider-parameter-keys"];
  const configuredOperation = schema["x-kanvas-provider-model-operation"];
  if (
    requiredModelOperation &&
    configuredOperation !== requiredModelOperation
  ) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Capability Contract and pinned Provider model operation differ.",
    );
  }
  if (configured === undefined) {
    if (requiredPolicyKeys.length === 0) {
      return Object.freeze([]);
    }
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Capability Contract does not expose Provider parameter keys.",
    );
  }
  const properties = plainRecord(
    schema.properties,
    "Capability input schema properties",
  );
  if (
    !Array.isArray(configured) ||
    configured.length > 64 ||
    configured.some(
      (key) =>
        typeof key !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9]*$/u.test(key) ||
        !Object.hasOwn(properties, key),
    ) ||
    new Set(configured).size !== configured.length ||
    requiredPolicyKeys.some((key) => !configured.includes(key))
  ) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Capability Contract Provider parameter keys are invalid or incomplete.",
    );
  }
  return Object.freeze(
    configured.filter((key): key is string => typeof key === "string"),
  );
}

function callerParameterValues(
  input: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (keys.length === 0) {
    return Object.freeze({});
  }
  const record = plainRecord(input, "Provider node input");
  return Object.freeze(
    Object.fromEntries(
      keys.flatMap((key) =>
        Object.hasOwn(record, key) ? [[key, record[key]] as const] : [],
      ),
    ),
  );
}

export function resolvePinnedProviderParameters(options: {
  readonly route: CurrentProviderRouteSnapshot;
  readonly modelProfileDocument: unknown;
  readonly modelProfileDigest: string;
  readonly capabilityInputSchema: unknown;
  readonly input: unknown;
}):
  | {
      readonly values: Readonly<Record<string, ProviderModelParameterValue>>;
      readonly snapshot: Readonly<Record<string, unknown>>;
      readonly digest: string;
    }
  | undefined {
  const { modelOperation, parameterPolicies, parameterPolicyDigest } =
    options.route;
  if (!modelOperation || !parameterPolicies || !parameterPolicyDigest) {
    return undefined;
  }
  if (digestProviderRequestInput(parameterPolicies) !== parameterPolicyDigest) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Pinned Provider parameter policy differs from its digest.",
    );
  }
  const policyKeys = Object.keys(parameterPolicies);
  const capabilityParameterKeys = capabilityProviderParameterKeys(
    options.capabilityInputSchema,
    policyKeys,
    modelOperation,
  );
  let resolution;
  try {
    resolution = compileEffectiveProviderParameters({
      modelProfileDocument: options.modelProfileDocument,
      capabilityKey: modelOperation,
      capabilityParameterKeys,
      routeParameterPolicies: parameterPolicies,
      callerParameterValues: callerParameterValues(
        options.input,
        capabilityParameterKeys,
      ),
    });
  } catch (error) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      error instanceof Error
        ? `Provider parameter resolution failed: ${error.message}`
        : "Provider parameter resolution failed.",
    );
  }
  const snapshot = Object.freeze({
    schemaVersion: 1,
    modelOperation,
    modelProfileRevisionId: options.route.modelProfileRevisionId,
    modelProfileDigest: options.modelProfileDigest,
    parameterPolicyDigest,
    inputDigest: digestProviderRequestInput(options.input),
    values: resolution.values,
    facts: resolution.facts,
  });
  return Object.freeze({
    values: resolution.values,
    snapshot,
    digest: digestProviderRequestInput(snapshot),
  });
}

function stableRequestKeyFor(attemptId: string): string {
  return `kanvas:v1:${attemptId}`;
}

function requirePayloadId(
  event: CanonicalInboxEvent,
  key: "workflowRunId" | "nodeRunId" | "capabilityRunId" | "attemptId",
): string {
  const value = event.payload[key];
  if (typeof value !== "string" || !kanvasIdPattern.test(value)) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

export function assertCanonicalDispatchEvent(
  event: CanonicalInboxEvent,
  options: ClaimProviderDispatchOptions,
): {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
} {
  if (
    event.messageType !== "attempt.dispatch.requested" ||
    event.aggregateType !== "capability_attempt"
  ) {
    throw new InboxDeliveryError("inbox.event.route_mismatch");
  }
  if (
    event.aggregateId !== options.attemptId ||
    event.expectedGeneration !== options.executionGeneration
  ) {
    throw new InboxDeliveryError("inbox.event.envelope_mismatch");
  }
  if (
    event.payload.executionTarget !== "provider" ||
    requirePayloadId(event, "capabilityRunId") !== options.capabilityRunId ||
    requirePayloadId(event, "attemptId") !== options.attemptId
  ) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  const workflowRunId = event.payload.workflowRunId;
  const nodeRunId = event.payload.nodeRunId;
  const invocationKind = event.payload.invocationKind;
  if (workflowRunId === undefined && nodeRunId === undefined) {
    if (
      invocationKind !== "user" &&
      invocationKind !== "agent" &&
      invocationKind !== "canvas"
    ) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
    return { invocationKind };
  }
  return {
    invocationKind: "workflow",
    workflowRunId: requirePayloadId(event, "workflowRunId"),
    nodeRunId: requirePayloadId(event, "nodeRunId"),
  };
}

export function classifyVersion(
  currentVersion: number,
  eventVersion: number,
): "current" | "stale" {
  if (currentVersion < eventVersion) {
    throw new InboxDeliveryError("inbox.event.future_version");
  }
  return currentVersion === eventVersion ? "current" : "stale";
}

export function isDuplicateEntryError(
  error: unknown,
): error is { readonly code: "ER_DUP_ENTRY" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

export function isTerminalRemoteStatus(value: string): boolean {
  return (
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "not_found"
  );
}

export async function inTransaction<TResult>(
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

export async function lockCapability(
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
       binding_id AS bindingId,
       implementation_revision_id AS implementationRevisionId,
       lifecycle_status AS lifecycleStatus,
       current_attempt_id AS currentAttemptId,
       accepted_attempt_id AS acceptedAttemptId,
       version,
       cancel_requested_at AS cancelRequestedAt,
       cancel_deadline_at AS cancelDeadlineAt
     FROM capability_run
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [capabilityRunId],
  );
  return rows[0];
}

export async function lockAttempt(
  connection: PoolConnection,
  capabilityRunId: string,
  attemptId: string,
): Promise<AttemptRow | undefined> {
  const [rows] = await connection.execute<AttemptRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       capability_run_id AS capabilityRunId,
       binding_id AS bindingId,
       route_candidate_index AS routeCandidateIndex,
       candidate_attempt_number AS candidateAttemptNumber,
       execution_target AS executionTarget,
       implementation_revision_id AS implementationRevisionId,
       lifecycle_status AS lifecycleStatus,
       side_effect_state AS sideEffectState,
       error,
       execution_deadline_at AS executionDeadlineAt,
       version,
       cancel_requested_at AS cancelRequestedAt,
       cancel_deadline_at AS cancelDeadlineAt
     FROM capability_attempt
     WHERE id = ?
       AND capability_run_id = ?
     LIMIT 1
     FOR UPDATE`,
    [attemptId, capabilityRunId],
  );
  return rows[0];
}

export async function lockInvocation(
  connection: PoolConnection,
  invocationId: string,
  attemptId: string,
): Promise<InvocationRow | undefined> {
  const [rows] = await connection.execute<InvocationRow[]>(
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
       budget_reservation_id AS budgetReservationId,
       route_candidate_digest AS routeCandidateDigest,
       request_scope_digest AS requestScopeDigest,
       stable_request_key AS stableRequestKey,
       request_fingerprint AS requestFingerprint,
       parameter_resolution_digest AS parameterResolutionDigest,
       prepared_request_snapshot AS preparedRequestSnapshot,
       prepared_request_digest AS preparedRequestDigest,
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
     WHERE id = ?
       AND capability_attempt_id = ?
     LIMIT 1
     FOR UPDATE`,
    [invocationId, attemptId],
  );
  return rows[0];
}

export async function loadPinnedProviderContext(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  requireExecutableImplementation = false,
): Promise<PinnedProviderContext> {
  let lockedImplementation: ProviderImplementationRow | undefined;
  let lockedBinding: ProviderBindingRow | undefined;
  if (requireExecutableImplementation) {
    const [bindingRows] = await connection.execute<ProviderBindingRow[]>(
      `SELECT
           binding.id,
           binding.workspace_id AS workspaceId,
           binding.contract_revision_id AS contractRevisionId,
           binding.lifecycle_status AS lifecycleStatus,
           contract.workspace_id AS contractWorkspaceId,
           contract.lifecycle_status AS contractLifecycleStatus
         FROM capability_binding AS binding
         INNER JOIN capability_contract_revision AS contract
           ON contract.id = binding.contract_revision_id
         WHERE binding.id = ?
         LIMIT 1
         FOR UPDATE`,
      [attempt.bindingId],
    );
    lockedBinding = bindingRows[0];
    const [implementationRows] = await connection.execute<
      ProviderImplementationRow[]
    >(
      `SELECT
           id,
           workspace_id AS workspaceId,
           execution_target AS executionTarget,
           adapter_key AS adapterKey,
           lifecycle_status AS lifecycleStatus,
           canonical_digest AS canonicalDigest,
           contract_revision_id AS contractRevisionId,
           runtime_adapter_revision_id AS runtimeAdapterRevisionId
         FROM capability_implementation_revision
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
      [attempt.implementationRevisionId],
    );
    lockedImplementation = implementationRows[0];
  }
  const [rows] = await connection.execute<ExecutionContextRow[]>(
    `SELECT
       source.invocation_kind AS invocationKind,
       workflow.id AS workflowRunId,
       workflow.workspace_id AS workflowWorkspaceId,
       source.created_by AS actorId,
       node.id AS nodeRunId,
       node.workspace_id AS nodeWorkspaceId,
       source.input,
       source.input_digest AS inputDigest,
       source.route_snapshot AS routeSnapshot,
       contract.input_schema AS capabilityInputSchema,
       implementation.contract_revision_id AS implementationContractRevisionId,
       implementation.adapter_key AS adapterKey,
       implementation.execution_target AS implementationExecutionTarget,
       implementation.workspace_id AS implementationWorkspaceId,
       implementation.lifecycle_status AS implementationLifecycleStatus,
       implementation.canonical_digest AS implementationCanonicalDigest,
       implementation.configuration AS implementationConfiguration,
       implementation.input_mapping_digest AS inputMappingDigest,
       implementation.compiled_input_mapping AS compiledInputMapping,
       implementation.output_mapping_digest AS outputMappingDigest,
       implementation.compiled_output_mapping AS compiledOutputMapping,
       runtime_adapter.id AS runtimeAdapterRevisionId,
       runtime_adapter.canonical_digest AS runtimeAdapterRevisionDigest,
       runtime_adapter.lifecycle_status AS runtimeAdapterRevisionStatus,
       runtime_adapter.execution_target AS runtimeAdapterExecutionTarget,
       runtime_adapter_definition.adapter_key AS runtimeAdapterKey,
       runtime_adapter_definition.lifecycle_status AS runtimeAdapterDefinitionStatus
     FROM capability_run AS source
     LEFT JOIN node_run AS node
       ON node.id = source.node_run_id
      AND node.workspace_id = source.workspace_id
     LEFT JOIN workflow_run AS workflow
       ON workflow.id = node.workflow_run_id
      AND workflow.workspace_id = source.workspace_id
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.id = ?
     INNER JOIN runtime_adapter_revision AS runtime_adapter
       ON runtime_adapter.id = implementation.runtime_adapter_revision_id
      AND runtime_adapter.workspace_id = source.workspace_id
     INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
       ON runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
      AND runtime_adapter_definition.workspace_id = source.workspace_id
     INNER JOIN capability_contract_revision AS contract
       ON contract.id = ?
      AND contract.workspace_id = source.workspace_id
     WHERE source.id = ?
     LIMIT 1`,
    [
      attempt.implementationRevisionId,
      capability.contractRevisionId,
      capability.id,
    ],
  );
  const context = rows[0];
  if (
    !context ||
    context.invocationKind !== capability.invocationKind ||
    context.implementationExecutionTarget !== "provider" ||
    attempt.executionTarget !== "provider" ||
    attempt.workspaceId !== capability.workspaceId ||
    (capability.invocationKind === "workflow"
      ? context.workflowWorkspaceId !== capability.workspaceId ||
        context.nodeWorkspaceId !== capability.workspaceId ||
        context.nodeRunId !== capability.nodeRunId
      : context.workflowWorkspaceId !== null ||
        context.nodeWorkspaceId !== null ||
        context.nodeRunId !== null) ||
    context.implementationWorkspaceId !== capability.workspaceId ||
    context.implementationContractRevisionId !==
      capability.contractRevisionId ||
    context.runtimeAdapterDefinitionStatus !== "active" ||
    !["published", "deprecated"].includes(
      context.runtimeAdapterRevisionStatus,
    ) ||
    context.runtimeAdapterKey !== context.adapterKey ||
    context.runtimeAdapterExecutionTarget !==
      context.implementationExecutionTarget ||
    (requireExecutableImplementation &&
      (!lockedBinding ||
        lockedBinding.id !== attempt.bindingId ||
        lockedBinding.workspaceId !== capability.workspaceId ||
        lockedBinding.contractRevisionId !== capability.contractRevisionId ||
        lockedBinding.contractWorkspaceId !== capability.workspaceId ||
        !["active", "disabled"].includes(lockedBinding.lifecycleStatus) ||
        !["published", "deprecated"].includes(
          lockedBinding.contractLifecycleStatus,
        ) ||
        !lockedImplementation ||
        lockedImplementation.id !== attempt.implementationRevisionId ||
        lockedImplementation.workspaceId !== capability.workspaceId ||
        lockedImplementation.contractRevisionId !==
          capability.contractRevisionId ||
        lockedImplementation.runtimeAdapterRevisionId !==
          context.runtimeAdapterRevisionId ||
        lockedImplementation.executionTarget !==
          context.implementationExecutionTarget ||
        lockedImplementation.adapterKey !== context.adapterKey ||
        lockedImplementation.lifecycleStatus !==
          context.implementationLifecycleStatus ||
        lockedImplementation.canonicalDigest !==
          context.implementationCanonicalDigest))
  ) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Provider execution facts do not match the pinned implementation.",
    );
  }
  let candidate;
  try {
    const route = parsePinnedCapabilityRoute(context.routeSnapshot);
    assertPinnedRouteIdentity(route, {
      nodeKey: route.nodeKey,
      contractRevisionId: capability.contractRevisionId,
      contractDigest: route.contractDigest,
    });
    candidate = findPinnedCandidate(route, attempt.routeCandidateIndex);
    assertPinnedCandidateIdentity(candidate, {
      candidateIndex: attempt.routeCandidateIndex,
      bindingId: attempt.bindingId,
      implementationRevisionId: attempt.implementationRevisionId,
      implementationDigest: context.implementationCanonicalDigest,
      executionTarget: "provider",
      adapterKey: context.adapterKey,
    });
  } catch {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Provider binding identity is missing or inconsistent.",
    );
  }
  if (candidate.executionTarget !== "provider") {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Provider candidate identity is missing or inconsistent.",
    );
  }
  const route = parseProviderRouteSnapshot(candidate.providerRoute);
  const capabilityInput = parseJson(context.input);
  if (digestProviderRequestInput(capabilityInput) !== context.inputDigest) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Provider node input is missing or differs from its persisted digest.",
    );
  }
  const compiledInputMapping = verifiedCompiledMapping(
    context.compiledInputMapping,
    context.inputMappingDigest,
    "input",
  );
  const compiledOutputMapping = verifiedCompiledMapping(
    context.compiledOutputMapping,
    context.outputMappingDigest,
    "output",
  );
  const input = executeCapabilityMappingPlanV1(compiledInputMapping, {
    input: capabilityInput,
    configuration: parseJson(context.implementationConfiguration),
  });
  let parameterResolutionSnapshot:
    Readonly<Record<string, unknown>> | undefined;
  let parameterResolutionDigest: string | undefined;
  let effectiveParameters:
    Readonly<Record<string, ProviderModelParameterValue>> | undefined;
  if (
    route.modelOperation &&
    route.parameterPolicies &&
    route.parameterPolicyDigest
  ) {
    if (
      digestProviderRequestInput(route.parameterPolicies) !==
      route.parameterPolicyDigest
    ) {
      throw new ProviderInvocationStoreError(
        "provider_invocation.snapshot_invalid",
        "Pinned Provider parameter policy differs from its digest.",
      );
    }
    const [profileRows] = await connection.execute<ModelProfileSnapshotRow[]>(
      `SELECT
           schema_version AS schemaVersion,
           profile_document AS profileDocument,
           canonical_digest AS canonicalDigest,
           lifecycle_status AS lifecycleStatus
         FROM model_profile_revision
         WHERE workspace_id = ?
           AND id = ?
         LIMIT 1
         FOR SHARE`,
      [capability.workspaceId, route.modelProfileRevisionId],
    );
    const profile = profileRows[0];
    if (
      !profile ||
      !providerRouteModelProfileSchemaSupported(profile.schemaVersion) ||
      profile.lifecycleStatus !== "published" ||
      digestProviderRequestInput(parseJson(profile.profileDocument)) !==
        profile.canonicalDigest
    ) {
      throw new ProviderInvocationStoreError(
        "provider_invocation.snapshot_invalid",
        "Pinned Provider model profile is unavailable or invalid.",
      );
    }
    const resolution = resolvePinnedProviderParameters({
      route,
      modelProfileDocument: parseJson(profile.profileDocument),
      modelProfileDigest: profile.canonicalDigest,
      capabilityInputSchema: context.capabilityInputSchema,
      input: capabilityInput,
    });
    effectiveParameters = resolution?.values;
    parameterResolutionSnapshot = resolution?.snapshot;
    parameterResolutionDigest = resolution?.digest;
  }
  const stableRequestKey = stableRequestKeyFor(attempt.id);
  const requestFingerprint = digestProviderRequestInput({
    schemaVersion: 1,
    implementationRevisionId: attempt.implementationRevisionId,
    implementationDigest: context.implementationCanonicalDigest,
    adapterKey: context.adapterKey,
    route,
    stableRequestKey,
    input,
    compiledOutputMapping,
    ...(parameterResolutionDigest ? { parameterResolutionDigest } : {}),
  });
  const pinnedContext = Object.freeze<PinnedProviderContext>({
    ...(context.invocationKind
      ? { invocationKind: context.invocationKind }
      : {}),
    ...(context.workflowRunId ? { workflowRunId: context.workflowRunId } : {}),
    ...(context.nodeRunId ? { nodeRunId: context.nodeRunId } : {}),
    workspaceId: capability.workspaceId,
    actorId: context.actorId,
    adapterKey: context.adapterKey,
    implementationDigest: context.implementationCanonicalDigest,
    implementationLifecycleStatus: context.implementationLifecycleStatus,
    route,
    input,
    compiledOutputMapping,
    ...(effectiveParameters ? { effectiveParameters } : {}),
    ...(parameterResolutionSnapshot && parameterResolutionDigest
      ? {
          parameterResolutionSnapshot,
          parameterResolutionDigest,
        }
      : {}),
    stableRequestKey,
    requestFingerprint,
  });
  if (requireExecutableImplementation) {
    requireExecutableProviderImplementation(pinnedContext);
  }
  return pinnedContext;
}

export function invocationMatchesPinnedContext(
  invocation: InvocationRow,
  context: PinnedProviderContext,
  capability: CapabilityRow,
  attempt: AttemptRow,
): boolean {
  const route = context.route;
  return (
    invocation.workspaceId === capability.workspaceId &&
    invocation.capabilityAttemptId === attempt.id &&
    invocation.implementationRevisionId === attempt.implementationRevisionId &&
    invocation.providerEndpointId === route.providerEndpointId &&
    invocation.providerKey === route.providerKey &&
    invocation.apiSurface === route.apiSurface &&
    invocation.credentialIdentityId === route.credentialIdentityId &&
    invocation.credentialIdentityEpoch === route.credentialIdentityEpoch &&
    (invocation.pinnedSecretVersionId ?? null) ===
      route.pinnedSecretVersionId &&
    invocation.modelDeploymentId === (route.modelDeploymentId ?? null) &&
    invocation.pricingRevisionId === (route.pricingRevisionId ?? null) &&
    invocation.routeCandidateDigest === route.routeCandidateDigest &&
    invocation.requestScopeDigest === route.requestScopeDigest &&
    invocation.stableRequestKey === context.stableRequestKey &&
    invocation.requestFingerprint === context.requestFingerprint &&
    invocation.parameterResolutionDigest ===
      (context.parameterResolutionDigest ?? null) &&
    invocation.queryMode === route.queryMode &&
    Boolean(invocation.notFoundIsAuthoritative) ===
      route.notFoundIsAuthoritative
  );
}

export function requireExecutableProviderImplementation(
  context: PinnedProviderContext,
): void {
  if (
    context.implementationLifecycleStatus !== "published" &&
    context.implementationLifecycleStatus !== "deprecated"
  ) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.snapshot_invalid",
      "Pinned provider implementation is not executable.",
    );
  }
}

export function claimFrom(
  workKind: ProviderInvocationWorkKind,
  invocation: InvocationRow,
  capability: CapabilityRow,
  attempt: AttemptRow,
  context: PinnedProviderContext,
): ProviderInvocationClaim {
  if (
    invocation.reconcileExecutionGeneration === null ||
    !invocation.reconcileLeaseExpiresAt ||
    !attempt.executionDeadlineAt
  ) {
    throw new ProviderInvocationStoreError(
      "provider_invocation.identity_conflict",
      "Claimed provider invocation has incomplete lease facts.",
    );
  }
  return Object.freeze({
    workKind,
    invocationId: invocation.id,
    capabilityRunId: capability.id,
    attemptId: attempt.id,
    ...(context.invocationKind
      ? { invocationKind: context.invocationKind }
      : {}),
    ...(context.workflowRunId ? { workflowRunId: context.workflowRunId } : {}),
    ...(context.nodeRunId ? { nodeRunId: context.nodeRunId } : {}),
    workspaceId: capability.workspaceId,
    actorId: context.actorId,
    implementationRevisionId: attempt.implementationRevisionId,
    implementationDigest: context.implementationDigest,
    adapterKey: context.adapterKey,
    route: context.route,
    input: context.input,
    compiledOutputMapping: context.compiledOutputMapping,
    ...(context.effectiveParameters
      ? {
          effectiveParameters: context.effectiveParameters,
        }
      : {}),
    ...(context.parameterResolutionDigest
      ? {
          parameterResolutionDigest: context.parameterResolutionDigest,
        }
      : {}),
    ...(invocation.preparedRequestDigest
      ? {
          preparedRequestSnapshot: plainRecord(
            invocation.preparedRequestSnapshot,
            "Prepared Provider request snapshot",
          ),
          preparedRequestDigest: invocation.preparedRequestDigest,
        }
      : {}),
    stableRequestKey: context.stableRequestKey,
    requestFingerprint: context.requestFingerprint,
    ...(invocation.providerRequestId
      ? { providerRequestId: invocation.providerRequestId }
      : {}),
    ...(invocation.budgetReservationId
      ? {
          budgetReservationId: invocation.budgetReservationId,
        }
      : {}),
    leaseGeneration: invocation.reconcileLeaseGeneration,
    executionGeneration: invocation.reconcileExecutionGeneration,
    leaseExpiresAt: invocation.reconcileLeaseExpiresAt,
    executionDeadlineAt: attempt.executionDeadlineAt,
  });
}

export function assertObservation(
  options: AppendProviderObservationOptions,
): void {
  assertId(options.observationId, "observationId");
  assertId(options.invocationId, "invocationId");
  assertId(options.capabilityRunId, "capabilityRunId");
  assertId(options.attemptId, "attemptId");
  assertBoundedFact(options.observationKey, "observationKey", 160);
  assertDate(options.observedAt, "observedAt");
  assertDate(options.recordedAt, "recordedAt");
  if (
    options.recordedAt < options.observedAt ||
    !leaseTokenHashPattern.test(options.leaseTokenHash) ||
    !Number.isSafeInteger(options.leaseGeneration) ||
    options.leaseGeneration < 1 ||
    !Number.isSafeInteger(options.executionGeneration) ||
    options.executionGeneration < 1
  ) {
    invalidArgument("Provider observation lease or timestamp is invalid.");
  }
  const requiresStableErrorCode =
    options.status === "failed" ||
    options.status === "cancelled" ||
    options.status === "unknown";
  if (requiresStableErrorCode !== (options.stableErrorCode !== undefined)) {
    invalidArgument(
      "Failed, cancelled, and unknown observations require exactly one stable error code.",
    );
  }
  if (options.stableErrorCode) {
    assertBoundedFact(options.stableErrorCode, "stableErrorCode", 120);
  }
  if (
    (options.status === "failed" || options.status === "cancelled") !==
    (options.retryability !== undefined)
  ) {
    invalidArgument(
      "Failed and cancelled observations require exactly one trusted retryability.",
    );
  }
  if (
    options.retryability !== undefined &&
    !["retryable", "terminal", "manual"].includes(options.retryability)
  ) {
    invalidArgument("Provider failure retryability is invalid.");
  }
  if (
    "callEffect" in options &&
    options.callEffect !== undefined &&
    options.callEffect !== "started" &&
    options.callEffect !== "not_started"
  ) {
    invalidArgument("Provider callEffect is invalid.");
  }
  if (
    options.providerRequestId !== undefined &&
    (options.providerRequestId.length < 1 ||
      options.providerRequestId.length > 512)
  ) {
    invalidArgument("providerRequestId must contain 1-512 characters.");
  }
  assertDigest(options.requestDigest, "requestDigest");
  assertDigest(options.responseDigest, "responseDigest");
  assertDigest(options.providerEventDigest, "providerEventDigest");
  if (
    options.operationKind === "callback" &&
    (options.source !== "provider_callback" || !options.providerEventDigest)
  ) {
    invalidArgument(
      "Callback observations require provider source and event digest.",
    );
  }
  if (
    options.status === "succeeded" &&
    (!Object.prototype.hasOwnProperty.call(options, "output") ||
      options.output === undefined)
  ) {
    invalidArgument("Succeeded provider observation requires output.");
  }
  if (options.status === "succeeded") {
    assertId(options.completionId, "completionId");
    if (!options.responseDigest) {
      invalidArgument(
        "Succeeded provider observation requires responseDigest.",
      );
    }
  } else if (Object.prototype.hasOwnProperty.call(options, "completionId")) {
    invalidArgument(
      "Only succeeded provider observation may carry completionId.",
    );
  }
  if (
    options.status === "failed" ||
    options.status === "cancelled" ||
    options.status === "not_found"
  ) {
    assertId(options.nextAttemptId, "nextAttemptId");
  } else if (Object.prototype.hasOwnProperty.call(options, "nextAttemptId")) {
    invalidArgument(
      "Only failed terminal provider observation may carry nextAttemptId.",
    );
  }
  if (
    options.status !== "succeeded" &&
    Object.prototype.hasOwnProperty.call(options, "output")
  ) {
    invalidArgument(
      "Only succeeded provider observation may carry domain output.",
    );
  }
  if (isTerminalRemoteStatus(options.status)) {
    if (!options.terminalOutboxEventId) {
      invalidArgument(
        "Terminal provider observation requires terminalOutboxEventId.",
      );
    }
    assertId(options.terminalOutboxEventId, "terminalOutboxEventId");
  } else if (
    Object.prototype.hasOwnProperty.call(options, "terminalOutboxEventId")
  ) {
    invalidArgument(
      "Only terminal provider observation may carry terminalOutboxEventId.",
    );
  }
  if (options.nextReconcileAt) {
    assertDate(options.nextReconcileAt, "nextReconcileAt");
    if (options.nextReconcileAt < options.recordedAt) {
      invalidArgument("nextReconcileAt cannot precede observation recording.");
    }
  }
}
