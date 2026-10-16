import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import {
  executeCapabilityMappingPlanV1,
  parseCompiledCapabilityMappingPlanV1,
  type CompiledCapabilityMappingPlanV1,
} from "@kanvas/contracts/capability";

import {
  assertPinnedCandidateIdentity,
  assertPinnedRouteIdentity,
  findPinnedCandidate,
  parsePinnedCapabilityRoute,
  parseJson,
} from "./execution-plan.js";
import { digestProviderValue } from "./provider-value-digest.js";

export interface BrowserHumanAuthorityFacts {
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly authenticationRefHash: string;
  readonly authorityVersion: number;
}

export type BrowserExecutorBackend = "webgpu" | "wasm" | "javascript";

export interface BrowserCapabilityDeclaration {
  readonly id: string;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly backend: BrowserExecutorBackend;
  readonly probeProfileVersion: number;
  readonly probeResultDigest: string;
}

export interface RegisterBrowserExecutorSessionOptions {
  readonly sessionId: string;
  readonly authority: BrowserHumanAuthorityFacts;
  readonly runtimeReleaseId: string;
  readonly runtimeReleaseDigest: string;
  readonly capabilityManifestVersion: number;
  readonly capabilityManifestDigest: string;
  readonly capabilities: readonly BrowserCapabilityDeclaration[];
  readonly now: Date;
  readonly expiresAt: Date;
}

export interface RegisteredBrowserExecutorSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly state: "active";
  readonly expiresAt: Date;
  readonly capabilityIds: readonly string[];
}

export interface ClaimNextBrowserAttemptOptions {
  readonly sessionId: string;
  readonly authority: BrowserHumanAuthorityFacts;
  readonly assignmentId: string;
  readonly claimedEventId: string;
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
  readonly executionGeneration: number;
  readonly candidateLimit: number;
  readonly now: Date;
  readonly leaseUntil: Date;
}

export interface ClaimedBrowserAttempt {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly contractRevisionId: string;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly candidateAttemptNumber: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly backend: BrowserExecutorBackend;
  readonly probeProfileVersion: number;
  readonly probeResultDigest: string;
  readonly input: unknown;
  readonly leaseGeneration: number;
  readonly executionGeneration: number;
  readonly leaseExpiresAt: Date;
  readonly executionDeadlineAt: Date;
}

export interface HeartbeatBrowserAttemptOptions {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly attemptId: string;
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly transitionEventId: string;
  readonly now: Date;
  readonly leaseUntil: Date;
}

export type BrowserAttemptHeartbeatResult =
  "renewed" | "cancel_requested" | "revoked" | "rejected";

export interface AuthorizeBrowserAttemptOutputOptions {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly attemptId: string;
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly now: Date;
}

export type BrowserAttemptOutputAuthorizationResult =
  | Readonly<{
      status: "authorized";
      actorId: string;
      expiresAt: Date;
    }>
  | Readonly<{
      status: "cancel_requested" | "revoked" | "rejected";
    }>;

export interface MapBrowserAttemptOutputOptions {
  readonly workspaceId: string;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly adapterOutput: unknown;
}

export interface AcknowledgeBrowserAttemptCancellationOptions {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly cancelledEventId: string;
  readonly terminalOutboxEventId: string;
  readonly now: Date;
}

export type BrowserAttemptCancellationAcknowledgementResult =
  "acknowledged" | "replayed" | "revoked" | "rejected";

export interface BrowserSessionTransitionOptions {
  readonly sessionId: string;
  readonly authority: BrowserHumanAuthorityFacts;
  readonly now: Date;
}

export type BrowserExecutorSessionState =
  "active" | "draining" | "revoked" | "closed";

export interface BrowserSessionTransitionResult {
  readonly sessionId: string;
  readonly state: BrowserExecutorSessionState;
  readonly changed: boolean;
}

export interface BrowserControlPlaneStore {
  registerExecutorSession(
    options: RegisterBrowserExecutorSessionOptions,
  ): Promise<RegisteredBrowserExecutorSession>;
  claimNextAttempt(
    options: ClaimNextBrowserAttemptOptions,
  ): Promise<ClaimedBrowserAttempt | undefined>;
  heartbeatAttempt(
    options: HeartbeatBrowserAttemptOptions,
  ): Promise<BrowserAttemptHeartbeatResult>;
  authorizeAttemptOutput(
    options: AuthorizeBrowserAttemptOutputOptions,
  ): Promise<BrowserAttemptOutputAuthorizationResult>;
  mapAttemptOutput(options: MapBrowserAttemptOutputOptions): Promise<unknown>;
  acknowledgeAttemptCancellation(
    options: AcknowledgeBrowserAttemptCancellationOptions,
  ): Promise<BrowserAttemptCancellationAcknowledgementResult>;
  drainSession(
    options: BrowserSessionTransitionOptions,
  ): Promise<BrowserSessionTransitionResult>;
  revokeSession(
    options: BrowserSessionTransitionOptions,
  ): Promise<BrowserSessionTransitionResult>;
}

export interface CreateBrowserControlPlaneStoreOptions {
  readonly claimingEnabled?: boolean;
  readonly instanceId?: string;
}

export type BrowserControlPlaneStoreErrorCode =
  | "browser_control.invalid_argument"
  | "browser_control.claiming_disabled"
  | "browser_control.runtime_fenced"
  | "browser_control.registration_mismatch"
  | "browser_control.authority_mismatch"
  | "browser_control.state_conflict";

export class BrowserControlPlaneStoreError extends Error {
  constructor(
    readonly code: BrowserControlPlaneStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrowserControlPlaneStoreError";
  }
}

interface BrowserImplementationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
  readonly canonicalDigest: string;
  readonly contractRevisionId: string;
  readonly runtimeAdapterRevisionId: string;
}

interface BrowserRuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
  readonly deadline: Date | null;
}

interface BrowserCandidateRow extends RowDataPacket {
  readonly capabilityRunId: string;
  readonly attemptId: string;
}

interface CapabilityRunRow extends RowDataPacket {
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
  readonly cancelRequestedAt: Date | null;
  readonly version: number;
}

interface BrowserAttemptRow extends RowDataPacket {
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
  readonly notBefore: Date;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly version: number;
}

interface BrowserSessionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly authenticationRefHash: string;
  readonly authorityVersion: number;
  readonly runtimeReleaseId: string;
  readonly runtimeReleaseDigest: string;
  readonly capabilityManifestVersion: number;
  readonly capabilityManifestDigest: string;
  readonly state: BrowserExecutorSessionState;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly terminalAt: Date | null;
  readonly updatedAt: Date;
}

interface AssignmentIdentityRow extends RowDataPacket {
  readonly id: string;
}

interface BrowserExecutionContextRow extends RowDataPacket {
  readonly executorCapabilityId: string;
  readonly executorWorkspaceId: string;
  readonly executorSessionId: string;
  readonly executorImplementationRevisionId: string;
  readonly executorImplementationDigest: string;
  readonly executorAdapterKey: string;
  readonly backend: BrowserExecutorBackend;
  readonly probeProfileVersion: number;
  readonly probeResultDigest: string;
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId: string | null;
  readonly workflowWorkspaceId: string | null;
  readonly routeSnapshot: unknown;
  readonly nodeRunId: string | null;
  readonly nodeWorkspaceId: string | null;
  readonly nodeInput: unknown;
  readonly bindingId: string;
  readonly bindingWorkspaceId: string;
  readonly bindingContractRevisionId: string;
  readonly bindingImplementationRevisionId: string;
  readonly bindingVersion: number;
  readonly bindingLifecycleStatus: string;
  readonly contractLifecycleStatus: string;
  readonly implementationRevisionId: string;
  readonly implementationWorkspaceId: string;
  readonly implementationDigest: string;
  readonly implementationExecutionTarget: string;
  readonly implementationAdapterKey: string;
  readonly implementationLifecycleStatus: string;
  readonly implementationContractRevisionId: string;
  readonly implementationConfiguration: unknown;
  readonly inputMappingDigest: string;
  readonly compiledInputMapping: unknown;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapterRevisionStatus: string;
  readonly runtimeAdapterExecutionTarget: string;
  readonly runtimeAdapterKey: string;
  readonly runtimeAdapterDefinitionStatus: string;
}

interface BrowserOutputMappingRow extends RowDataPacket {
  readonly implementationDigest: string;
  readonly implementationStatus: string;
  readonly adapterKey: string;
  readonly outputMappingDigest: string;
  readonly compiledOutputMapping: unknown;
  readonly runtimeAdapterStatus: string;
  readonly runtimeAdapterKey: string;
  readonly runtimeAdapterExecutionTarget: string;
  readonly runtimeAdapterDefinitionStatus: string;
}

interface HeartbeatLocatorRow extends RowDataPacket {
  readonly attemptId: string;
  readonly capabilityRunId: string;
}

interface BrowserAssignmentRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly browserExecutorSessionId: string;
  readonly capabilityAttemptId: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly attemptGrantTokenHash: string;
  readonly state:
    | "active"
    | "cancel_requested"
    | "completed"
    | "cancelled"
    | "failed"
    | "fenced"
    | "expired"
    | "revoked";
  readonly claimedAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly leaseExpiresAt: Date;
}

const rawEnvironmentKeys = new Set([
  "ua",
  "useragent",
  "gpu",
  "renderer",
  "screen",
  "hardware",
  "hardwareconcurrency",
  "devicememory",
]);

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
    throw new BrowserControlPlaneStoreError(
      "browser_control.registration_mismatch",
      `Browser ${direction} mapping is unavailable or invalid.`,
    );
  }
}

function invalid(message: string): never {
  throw new BrowserControlPlaneStoreError(
    "browser_control.invalid_argument",
    message,
  );
}

function assertId(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value)
  ) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 hash.`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid(`${label} must be a canonical sha256 digest.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_294_967_295) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
}

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertBoundedText(
  value: string,
  label: string,
  maximum: number,
): void {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    invalid(
      `${label} must contain between 1 and ${String(maximum)} characters.`,
    );
  }
}

function assertNoRawEnvironmentFacts(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      candidate instanceof Date ||
      seen.has(candidate)
    ) {
      return;
    }
    seen.add(candidate);
    for (const [key, child] of Object.entries(candidate)) {
      const normalized = key.replaceAll(/[^a-z]/giu, "").toLowerCase();
      if (rawEnvironmentKeys.has(normalized)) {
        invalid(`Raw browser environment field ${key} is not accepted.`);
      }
      visit(child);
    }
  };
  visit(value);
}

function assertAuthority(authority: BrowserHumanAuthorityFacts): void {
  assertId(authority.workspaceId, "authority.workspaceId");
  assertId(authority.createdByPrincipalId, "authority.createdByPrincipalId");
  assertHash(
    authority.authenticationRefHash,
    "authority.authenticationRefHash",
  );
  assertPositiveInteger(
    authority.authorityVersion,
    "authority.authorityVersion",
  );
}

function authorityMatches(
  session: BrowserSessionRow,
  authority: BrowserHumanAuthorityFacts,
): boolean {
  return (
    session.workspaceId === authority.workspaceId &&
    session.createdByPrincipalId === authority.createdByPrincipalId &&
    session.authenticationRefHash === authority.authenticationRefHash &&
    session.authorityVersion === authority.authorityVersion
  );
}

function assertRegistration(
  options: RegisterBrowserExecutorSessionOptions,
): void {
  assertNoRawEnvironmentFacts(options);
  assertId(options.sessionId, "sessionId");
  assertAuthority(options.authority);
  assertId(options.runtimeReleaseId, "runtimeReleaseId");
  assertDigest(options.runtimeReleaseDigest, "runtimeReleaseDigest");
  assertPositiveInteger(
    options.capabilityManifestVersion,
    "capabilityManifestVersion",
  );
  assertDigest(options.capabilityManifestDigest, "capabilityManifestDigest");
  assertDate(options.now, "now");
  assertDate(options.expiresAt, "expiresAt");
  if (options.expiresAt <= options.now) {
    invalid("expiresAt must be later than now.");
  }
  if (!Array.isArray(options.capabilities)) {
    invalid("capabilities must be an array.");
  }
  const capabilities =
    options.capabilities as readonly BrowserCapabilityDeclaration[];
  if (capabilities.length < 1 || capabilities.length > 64) {
    invalid("capabilities must contain between 1 and 64 declarations.");
  }

  const capabilityIds = new Set<string>();
  const implementationIds = new Set<string>();
  for (const capability of capabilities) {
    assertId(capability.id, "capability.id");
    assertId(
      capability.implementationRevisionId,
      "capability.implementationRevisionId",
    );
    assertDigest(
      capability.implementationDigest,
      "capability.implementationDigest",
    );
    assertBoundedText(capability.adapterKey, "capability.adapterKey", 160);
    if (
      capability.backend !== "webgpu" &&
      capability.backend !== "wasm" &&
      capability.backend !== "javascript"
    ) {
      invalid("capability.backend must be webgpu, wasm or javascript.");
    }
    assertPositiveInteger(
      capability.probeProfileVersion,
      "capability.probeProfileVersion",
    );
    assertDigest(capability.probeResultDigest, "capability.probeResultDigest");
    if (capabilityIds.has(capability.id)) {
      invalid("capability ids must be unique.");
    }
    if (implementationIds.has(capability.implementationRevisionId)) {
      invalid("A session may declare each implementation revision only once.");
    }
    capabilityIds.add(capability.id);
    implementationIds.add(capability.implementationRevisionId);
  }
}

function assertClaim(options: ClaimNextBrowserAttemptOptions): void {
  assertId(options.sessionId, "sessionId");
  assertAuthority(options.authority);
  assertId(options.assignmentId, "assignmentId");
  assertId(options.claimedEventId, "claimedEventId");
  assertHash(options.attemptGrantTokenHash, "attemptGrantTokenHash");
  assertHash(options.domainLeaseTokenHash, "domainLeaseTokenHash");
  assertPositiveInteger(options.executionGeneration, "executionGeneration");
  if (
    !Number.isSafeInteger(options.candidateLimit) ||
    options.candidateLimit < 1 ||
    options.candidateLimit > 100
  ) {
    invalid("candidateLimit must be an integer between 1 and 100.");
  }
  assertDate(options.now, "now");
  assertDate(options.leaseUntil, "leaseUntil");
  if (options.leaseUntil <= options.now) {
    invalid("The lease must end after now.");
  }
}

function assertHeartbeat(options: HeartbeatBrowserAttemptOptions): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.sessionId, "sessionId");
  assertId(options.assignmentId, "assignmentId");
  assertId(options.attemptId, "attemptId");
  assertHash(options.attemptGrantTokenHash, "attemptGrantTokenHash");
  assertHash(options.domainLeaseTokenHash, "domainLeaseTokenHash");
  assertPositiveInteger(
    options.attemptLeaseGeneration,
    "attemptLeaseGeneration",
  );
  assertPositiveInteger(options.executionGeneration, "executionGeneration");
  assertId(options.transitionEventId, "transitionEventId");
  assertDate(options.now, "now");
  assertDate(options.leaseUntil, "leaseUntil");
  if (options.leaseUntil <= options.now) {
    invalid("leaseUntil must be later than now.");
  }
}

function assertOutputAuthorization(
  options: AuthorizeBrowserAttemptOutputOptions,
): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.sessionId, "sessionId");
  assertId(options.assignmentId, "assignmentId");
  assertId(options.attemptId, "attemptId");
  assertHash(options.attemptGrantTokenHash, "attemptGrantTokenHash");
  assertHash(options.domainLeaseTokenHash, "domainLeaseTokenHash");
  assertPositiveInteger(
    options.attemptLeaseGeneration,
    "attemptLeaseGeneration",
  );
  assertPositiveInteger(options.executionGeneration, "executionGeneration");
  assertDate(options.now, "now");
}

function assertCancellationAcknowledgement(
  options: AcknowledgeBrowserAttemptCancellationOptions,
): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.sessionId, "sessionId");
  assertId(options.assignmentId, "assignmentId");
  assertId(options.capabilityRunId, "capabilityRunId");
  assertId(options.attemptId, "attemptId");
  assertHash(options.attemptGrantTokenHash, "attemptGrantTokenHash");
  assertHash(options.domainLeaseTokenHash, "domainLeaseTokenHash");
  assertPositiveInteger(
    options.attemptLeaseGeneration,
    "attemptLeaseGeneration",
  );
  assertPositiveInteger(options.executionGeneration, "executionGeneration");
  assertId(options.cancelledEventId, "cancelledEventId");
  assertId(options.terminalOutboxEventId, "terminalOutboxEventId");
  assertDate(options.now, "now");
}

function assertSessionTransition(
  options: BrowserSessionTransitionOptions,
): void {
  assertId(options.sessionId, "sessionId");
  assertAuthority(options.authority);
  assertDate(options.now, "now");
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

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

async function assertBrowserRuntimeAllowed(
  connection: PoolConnection,
  instanceId: string | undefined,
  action: "register" | "claim" | "heartbeat" | "upload" | "cancel",
  executionGeneration: number | undefined,
  now: Date,
): Promise<boolean> {
  if (!instanceId) {
    return true;
  }
  const [rows] = await connection.execute<BrowserRuntimeStateRow[]>(
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
  const drainConvergenceAllowed =
    (action === "heartbeat" || action === "upload" || action === "cancel") &&
    runtime?.state === "DRAINING" &&
    runtime.deadline !== null &&
    runtime.deadline >= now;
  const maintenanceCancellationAllowed =
    action === "cancel" && runtime?.state === "MAINTENANCE";
  if (
    runtime &&
    executionGeneration !== undefined &&
    runtime.executionGeneration !== executionGeneration &&
    (action === "heartbeat" || action === "upload" || action === "cancel")
  ) {
    return false;
  }
  if (
    !runtime ||
    (executionGeneration !== undefined &&
      runtime.executionGeneration !== executionGeneration) ||
    (runtime.state !== "ACTIVE" &&
      !drainConvergenceAllowed &&
      !maintenanceCancellationAllowed)
  ) {
    throw new BrowserControlPlaneStoreError(
      "browser_control.runtime_fenced",
      "The runtime generation or state does not permit this browser executor action.",
    );
  }
  return true;
}

function isAttemptAssignmentRace(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    readonly code?: unknown;
    readonly errno?: unknown;
    readonly message?: unknown;
    readonly sqlMessage?: unknown;
  };
  if (candidate.code !== "ER_DUP_ENTRY" && candidate.errno !== 1062) {
    return false;
  }
  let detail = "";
  if (typeof candidate.sqlMessage === "string") {
    detail = candidate.sqlMessage;
  } else if (typeof candidate.message === "string") {
    detail = candidate.message;
  }
  return detail.includes("uq_browser_attempt_assignment_attempt");
}

function sessionResult(
  sessionId: string,
  state: BrowserExecutorSessionState,
  changed: boolean,
): BrowserSessionTransitionResult {
  return Object.freeze({
    sessionId,
    state,
    changed,
  });
}

function snapshotMatches(
  context: BrowserExecutionContextRow,
  capability: CapabilityRunRow,
  attempt: BrowserAttemptRow,
  session: BrowserSessionRow,
): boolean {
  if (
    context.executorWorkspaceId !== capability.workspaceId ||
    context.executorWorkspaceId !== session.workspaceId ||
    context.executorSessionId !== session.id ||
    context.executorImplementationRevisionId !==
      attempt.implementationRevisionId ||
    context.executorImplementationDigest !== context.implementationDigest ||
    context.executorAdapterKey !== context.implementationAdapterKey ||
    context.invocationKind !== capability.invocationKind ||
    (capability.invocationKind === "workflow"
      ? context.workflowWorkspaceId !== capability.workspaceId ||
        context.nodeWorkspaceId !== capability.workspaceId
      : context.workflowWorkspaceId !== null ||
        context.nodeWorkspaceId !== null) ||
    context.nodeRunId !== capability.nodeRunId ||
    context.bindingId !== attempt.bindingId ||
    context.bindingWorkspaceId !== capability.workspaceId ||
    context.bindingContractRevisionId !== capability.contractRevisionId ||
    context.implementationContractRevisionId !==
      capability.contractRevisionId ||
    context.implementationRevisionId !== attempt.implementationRevisionId ||
    context.implementationWorkspaceId !== capability.workspaceId ||
    context.implementationExecutionTarget !== "browser" ||
    context.runtimeAdapterDefinitionStatus !== "active" ||
    !["published", "deprecated"].includes(
      context.runtimeAdapterRevisionStatus,
    ) ||
    context.runtimeAdapterKey !== context.implementationAdapterKey ||
    context.runtimeAdapterExecutionTarget !==
      context.implementationExecutionTarget ||
    !["active", "disabled"].includes(context.bindingLifecycleStatus) ||
    !["published", "deprecated"].includes(context.contractLifecycleStatus) ||
    !["published", "deprecated"].includes(context.implementationLifecycleStatus)
  ) {
    return false;
  }

  try {
    const route = parsePinnedCapabilityRoute(context.routeSnapshot);
    assertPinnedRouteIdentity(route, {
      nodeKey: route.nodeKey,
      contractRevisionId: capability.contractRevisionId,
      contractDigest: route.contractDigest,
    });
    const candidate = findPinnedCandidate(route, attempt.routeCandidateIndex);
    assertPinnedCandidateIdentity(candidate, {
      candidateIndex: attempt.routeCandidateIndex,
      bindingId: attempt.bindingId,
      implementationRevisionId: attempt.implementationRevisionId,
      implementationDigest: context.implementationDigest,
      executionTarget: "browser",
      adapterKey: context.implementationAdapterKey,
    });
    return true;
  } catch {
    return false;
  }
}

async function lockSession(
  connection: PoolConnection,
  sessionId: string,
): Promise<BrowserSessionRow | undefined> {
  const [rows] = await connection.execute<BrowserSessionRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       created_by_principal_id AS createdByPrincipalId,
       authentication_ref_hash AS authenticationRefHash,
       authority_version AS authorityVersion,
       runtime_release_id AS runtimeReleaseId,
       runtime_release_digest AS runtimeReleaseDigest,
       capability_manifest_version AS capabilityManifestVersion,
       capability_manifest_digest AS capabilityManifestDigest,
       state,
       last_seen_at AS lastSeenAt,
       expires_at AS expiresAt,
       terminal_at AS terminalAt,
       updated_at AS updatedAt
     FROM browser_executor_session
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [sessionId],
  );
  return rows[0];
}

async function lockBrowserImplementation(
  connection: PoolConnection,
  implementationRevisionId: string,
): Promise<BrowserImplementationRow | undefined> {
  const [rows] = await connection.execute<BrowserImplementationRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       lifecycle_status AS lifecycleStatus,
       execution_target AS executionTarget,
       adapter_key AS adapterKey,
       canonical_digest AS canonicalDigest,
       contract_revision_id AS contractRevisionId,
       runtime_adapter_revision_id AS runtimeAdapterRevisionId
     FROM capability_implementation_revision
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [implementationRevisionId],
  );
  return rows[0];
}

export function createBrowserControlPlaneStore(
  pool: Pool,
  options: CreateBrowserControlPlaneStoreOptions = {},
): BrowserControlPlaneStore {
  const claimingEnabled = options.claimingEnabled ?? false;
  const instanceId = options.instanceId;

  return Object.freeze<BrowserControlPlaneStore>({
    async registerExecutorSession(registration) {
      assertRegistration(registration);
      const declarations = [...registration.capabilities].sort((left, right) =>
        left.implementationRevisionId.localeCompare(
          right.implementationRevisionId,
        ),
      );

      return inTransaction(pool, async (connection) => {
        await assertBrowserRuntimeAllowed(
          connection,
          instanceId,
          "register",
          undefined,
          registration.now,
        );
        const implementations = new Map<string, BrowserImplementationRow>();
        if (declarations.length > 0) {
          const placeholders = declarations.map(() => "?").join(", ");
          const [rows] = await connection.execute<BrowserImplementationRow[]>(
            `SELECT
               id,
               workspace_id AS workspaceId,
               lifecycle_status AS lifecycleStatus,
               execution_target AS executionTarget,
               adapter_key AS adapterKey,
               canonical_digest AS canonicalDigest,
               contract_revision_id AS contractRevisionId,
               runtime_adapter_revision_id AS runtimeAdapterRevisionId
             FROM capability_implementation_revision
             WHERE workspace_id = ?
               AND id IN (${placeholders})
             ORDER BY id
             FOR UPDATE`,
            [
              registration.authority.workspaceId,
              ...declarations.map(
                (declaration) => declaration.implementationRevisionId,
              ),
            ],
          );
          for (const row of rows) {
            implementations.set(row.id, row);
          }
        }

        for (const declaration of declarations) {
          const implementation = implementations.get(
            declaration.implementationRevisionId,
          );
          if (
            !implementation ||
            implementation.workspaceId !== registration.authority.workspaceId ||
            implementation.lifecycleStatus !== "published" ||
            implementation.executionTarget !== "browser" ||
            implementation.adapterKey !== declaration.adapterKey ||
            implementation.canonicalDigest !== declaration.implementationDigest
          ) {
            throw new BrowserControlPlaneStoreError(
              "browser_control.registration_mismatch",
              "A declared browser capability does not exactly match a published browser implementation.",
            );
          }
        }

        await connection.execute<ResultSetHeader>(
          `INSERT INTO browser_executor_session (
             id,
             workspace_id,
             created_by_principal_id,
             authentication_ref_hash,
             authority_version,
             runtime_release_id,
             runtime_release_digest,
             capability_manifest_version,
             capability_manifest_digest,
             state,
             last_seen_at,
             expires_at,
             terminal_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)`,
          [
            registration.sessionId,
            registration.authority.workspaceId,
            registration.authority.createdByPrincipalId,
            registration.authority.authenticationRefHash,
            registration.authority.authorityVersion,
            registration.runtimeReleaseId,
            registration.runtimeReleaseDigest,
            registration.capabilityManifestVersion,
            registration.capabilityManifestDigest,
            registration.now,
            registration.expiresAt,
            registration.now,
            registration.now,
          ],
        );

        for (const declaration of declarations) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO browser_executor_capability (
               id,
               workspace_id,
               browser_executor_session_id,
               implementation_revision_id,
               implementation_digest,
               adapter_key,
               backend,
               probe_profile_version,
               probe_result_digest,
               declared_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              declaration.id,
              registration.authority.workspaceId,
              registration.sessionId,
              declaration.implementationRevisionId,
              declaration.implementationDigest,
              declaration.adapterKey,
              declaration.backend,
              declaration.probeProfileVersion,
              declaration.probeResultDigest,
              registration.now,
            ],
          );
        }

        return Object.freeze({
          sessionId: registration.sessionId,
          workspaceId: registration.authority.workspaceId,
          state: "active" as const,
          expiresAt: registration.expiresAt,
          capabilityIds: Object.freeze(
            declarations.map((declaration) => declaration.id),
          ),
        });
      });
    },

    async claimNextAttempt(claim) {
      if (!claimingEnabled) {
        throw new BrowserControlPlaneStoreError(
          "browser_control.claiming_disabled",
          "Browser attempt claiming is disabled for this runtime.",
        );
      }
      assertClaim(claim);

      const [candidates] = await pool.query<BrowserCandidateRow[]>(
        `SELECT
           capability.id AS capabilityRunId,
           attempt.id AS attemptId
         FROM capability_attempt AS attempt
         INNER JOIN capability_run AS capability
           ON capability.id = attempt.capability_run_id
           AND capability.workspace_id = attempt.workspace_id
           AND capability.current_attempt_id = attempt.id
         INNER JOIN browser_executor_capability AS executor_capability
           ON executor_capability.workspace_id = attempt.workspace_id
           AND executor_capability.implementation_revision_id =
             attempt.implementation_revision_id
           AND executor_capability.browser_executor_session_id = ?
         WHERE attempt.workspace_id = ?
           AND attempt.execution_target = 'browser'
           AND attempt.lifecycle_status = 'created'
           AND attempt.not_before <= ?
           AND attempt.execution_deadline_at > ?
           AND attempt.cancel_requested_at IS NULL
           AND capability.lifecycle_status IN ('queued', 'running')
           AND capability.accepted_attempt_id IS NULL
           AND capability.cancel_requested_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM browser_attempt_assignment AS assigned_attempt
             WHERE assigned_attempt.capability_attempt_id = attempt.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM browser_attempt_assignment AS active_assignment
             WHERE active_assignment.browser_executor_session_id = ?
               AND active_assignment.state IN (
                 'active',
                 'cancel_requested'
               )
           )
         ORDER BY attempt.not_before, attempt.id
         LIMIT ?`,
        [
          claim.sessionId,
          claim.authority.workspaceId,
          claim.now,
          claim.now,
          claim.sessionId,
          claim.candidateLimit,
        ],
      );

      for (const candidate of candidates) {
        let claimed: ClaimedBrowserAttempt | undefined;
        try {
          claimed = await inTransaction(pool, async (connection) => {
            await assertBrowserRuntimeAllowed(
              connection,
              instanceId,
              "claim",
              claim.executionGeneration,
              claim.now,
            );
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
                 implementation_revision_id AS implementationRevisionId,
                 lifecycle_status AS lifecycleStatus,
                 current_attempt_id AS currentAttemptId,
                 accepted_attempt_id AS acceptedAttemptId,
                 cancel_requested_at AS cancelRequestedAt,
                 version
               FROM capability_run
               WHERE id = ?
               LIMIT 1
               FOR UPDATE`,
              [candidate.capabilityRunId],
            );
            const capability = capabilityRows[0];
            if (
              !capability ||
              capability.workspaceId !== claim.authority.workspaceId ||
              !["queued", "running"].includes(capability.lifecycleStatus) ||
              capability.currentAttemptId !== candidate.attemptId ||
              capability.acceptedAttemptId ||
              capability.cancelRequestedAt
            ) {
              return undefined;
            }

            const [attemptRows] = await connection.execute<BrowserAttemptRow[]>(
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
                 not_before AS notBefore,
                 lease_generation AS leaseGeneration,
                 lease_token_hash AS leaseTokenHash,
                 lease_expires_at AS leaseExpiresAt,
                 execution_deadline_at AS executionDeadlineAt,
                 cancel_requested_at AS cancelRequestedAt,
                 version
               FROM capability_attempt
               WHERE id = ?
                 AND capability_run_id = ?
               LIMIT 1
               FOR UPDATE`,
              [candidate.attemptId, capability.id],
            );
            const attempt = attemptRows[0];
            if (
              !attempt ||
              attempt.workspaceId !== capability.workspaceId ||
              attempt.capabilityRunId !== capability.id ||
              attempt.executionTarget !== "browser" ||
              attempt.lifecycleStatus !== "created" ||
              attempt.sideEffectState !== "not_started" ||
              attempt.notBefore > claim.now ||
              attempt.cancelRequestedAt ||
              !attempt.executionDeadlineAt ||
              attempt.executionDeadlineAt <= claim.now
            ) {
              return undefined;
            }

            const implementation = await lockBrowserImplementation(
              connection,
              attempt.implementationRevisionId,
            );
            if (
              !implementation ||
              implementation.workspaceId !== capability.workspaceId ||
              implementation.lifecycleStatus !== "published" ||
              implementation.executionTarget !== "browser"
            ) {
              return undefined;
            }

            const session = await lockSession(connection, claim.sessionId);
            if (
              !session ||
              !authorityMatches(session, claim.authority) ||
              session.state !== "active" ||
              session.expiresAt <= claim.now ||
              session.lastSeenAt > claim.now ||
              session.updatedAt > claim.now
            ) {
              return undefined;
            }

            const [assignmentRows] = await connection.execute<
              AssignmentIdentityRow[]
            >(
              `SELECT id
               FROM browser_attempt_assignment
               WHERE capability_attempt_id = ?
                  OR (
                    browser_executor_session_id = ?
                    AND state IN ('active', 'cancel_requested')
                  )
               LIMIT 1`,
              [attempt.id, session.id],
            );
            if (assignmentRows.length > 0) {
              return undefined;
            }

            const [contextRows] = await connection.execute<
              BrowserExecutionContextRow[]
            >(
              `SELECT
                 executor_capability.id AS executorCapabilityId,
                 executor_capability.workspace_id AS executorWorkspaceId,
                 executor_capability.browser_executor_session_id AS executorSessionId,
                 executor_capability.implementation_revision_id AS executorImplementationRevisionId,
                 executor_capability.implementation_digest AS executorImplementationDigest,
                 executor_capability.adapter_key AS executorAdapterKey,
                 executor_capability.backend,
                 executor_capability.probe_profile_version AS probeProfileVersion,
                 executor_capability.probe_result_digest AS probeResultDigest,
                 source.invocation_kind AS invocationKind,
                 workflow.id AS workflowRunId,
                 workflow.workspace_id AS workflowWorkspaceId,
                 source.route_snapshot AS routeSnapshot,
                 node.id AS nodeRunId,
                 node.workspace_id AS nodeWorkspaceId,
                 source.input AS nodeInput,
                 binding.id AS bindingId,
                 binding.workspace_id AS bindingWorkspaceId,
                 binding.contract_revision_id AS bindingContractRevisionId,
                 binding.implementation_revision_id AS bindingImplementationRevisionId,
                 binding.version AS bindingVersion,
                 binding.lifecycle_status AS bindingLifecycleStatus,
                 contract.lifecycle_status AS contractLifecycleStatus,
                 implementation.id AS implementationRevisionId,
                 implementation.workspace_id AS implementationWorkspaceId,
                 implementation.canonical_digest AS implementationDigest,
                 implementation.execution_target AS implementationExecutionTarget,
                 implementation.adapter_key AS implementationAdapterKey,
                 implementation.lifecycle_status AS implementationLifecycleStatus,
                 implementation.contract_revision_id AS implementationContractRevisionId,
                 implementation.configuration AS implementationConfiguration,
                 implementation.input_mapping_digest AS inputMappingDigest,
                 implementation.compiled_input_mapping AS compiledInputMapping,
                 runtime_adapter.id AS runtimeAdapterRevisionId,
                 runtime_adapter.canonical_digest AS runtimeAdapterRevisionDigest,
                 runtime_adapter.lifecycle_status AS runtimeAdapterRevisionStatus,
                 runtime_adapter.execution_target AS runtimeAdapterExecutionTarget,
                 runtime_adapter_definition.adapter_key AS runtimeAdapterKey,
                 runtime_adapter_definition.lifecycle_status AS runtimeAdapterDefinitionStatus
               FROM browser_executor_capability AS executor_capability
               INNER JOIN capability_implementation_revision AS implementation
                 ON implementation.id =
                   executor_capability.implementation_revision_id
               INNER JOIN runtime_adapter_revision AS runtime_adapter
                 ON runtime_adapter.id = implementation.runtime_adapter_revision_id
                AND runtime_adapter.workspace_id = executor_capability.workspace_id
               INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
                 ON runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
                AND runtime_adapter_definition.workspace_id = executor_capability.workspace_id
               INNER JOIN capability_binding AS binding
                 ON binding.id = ?
               INNER JOIN capability_contract_revision AS contract
                 ON contract.id = binding.contract_revision_id
                 AND contract.workspace_id = binding.workspace_id
               INNER JOIN capability_run AS source
                 ON source.id = ?
                AND source.workspace_id = binding.workspace_id
               LEFT JOIN node_run AS node
                 ON node.id = source.node_run_id
                AND node.workspace_id = source.workspace_id
               LEFT JOIN workflow_run AS workflow
                 ON workflow.id = node.workflow_run_id
                AND workflow.workspace_id = source.workspace_id
               WHERE executor_capability.browser_executor_session_id = ?
                 AND executor_capability.workspace_id = ?
                 AND executor_capability.implementation_revision_id = ?
               LIMIT 1`,
              [
                attempt.bindingId,
                capability.id,
                session.id,
                capability.workspaceId,
                attempt.implementationRevisionId,
              ],
            );
            const context = contextRows[0];
            if (
              !context ||
              implementation.id !== context.implementationRevisionId ||
              implementation.adapterKey !== context.implementationAdapterKey ||
              implementation.canonicalDigest !== context.implementationDigest ||
              implementation.lifecycleStatus !==
                context.implementationLifecycleStatus ||
              implementation.contractRevisionId !==
                context.implementationContractRevisionId ||
              implementation.runtimeAdapterRevisionId !==
                context.runtimeAdapterRevisionId ||
              !snapshotMatches(context, capability, attempt, session)
            ) {
              return undefined;
            }

            const deadline = attempt.executionDeadlineAt;
            if (
              deadline <= claim.now ||
              claim.leaseUntil > deadline ||
              claim.leaseUntil > session.expiresAt
            ) {
              return undefined;
            }
            const nextLeaseGeneration = attempt.leaseGeneration + 1;

            const [attemptUpdate] = await connection.execute<ResultSetHeader>(
              `UPDATE capability_attempt
               SET lifecycle_status = 'running',
                   lease_generation = ?,
                   lease_token_hash = ?,
                   lease_expires_at = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND capability_run_id = ?
                 AND lifecycle_status = 'created'
                 AND version = ?
                 AND execution_deadline_at >= ?`,
              [
                nextLeaseGeneration,
                claim.domainLeaseTokenHash,
                claim.leaseUntil,
                claim.now,
                attempt.id,
                capability.id,
                attempt.version,
                claim.leaseUntil,
              ],
            );
            if (attemptUpdate.affectedRows !== 1) {
              throw new BrowserControlPlaneStoreError(
                "browser_control.state_conflict",
                "The browser attempt changed while it was being claimed.",
              );
            }

            if (capability.lifecycleStatus === "queued") {
              const [capabilityUpdate] =
                await connection.execute<ResultSetHeader>(
                  `UPDATE capability_run
                 SET lifecycle_status = 'running',
                     version = version + 1,
                     updated_at = ?
                 WHERE id = ?
                   AND lifecycle_status = 'queued'
                   AND version = ?`,
                  [claim.now, capability.id, capability.version],
                );
              if (capabilityUpdate.affectedRows !== 1) {
                throw new BrowserControlPlaneStoreError(
                  "browser_control.state_conflict",
                  "The capability changed while its browser attempt was being claimed.",
                );
              }
            }

            await connection.execute<ResultSetHeader>(
              `INSERT INTO browser_attempt_assignment (
               id,
               workspace_id,
               browser_executor_session_id,
               capability_attempt_id,
               attempt_lease_generation,
               execution_generation,
               attempt_grant_token_hash,
               state,
               stable_reason_code,
               claimed_at,
               last_heartbeat_at,
               lease_expires_at,
               terminal_at,
               created_at,
               updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL, ?, ?
             )`,
              [
                claim.assignmentId,
                capability.workspaceId,
                session.id,
                attempt.id,
                nextLeaseGeneration,
                claim.executionGeneration,
                claim.attemptGrantTokenHash,
                claim.now,
                claim.now,
                claim.leaseUntil,
                claim.now,
                claim.now,
              ],
            );
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
             ) VALUES (?, ?, ?, 'claimed', 'claimed', ?, ?, NULL, ?, ?)`,
              [
                claim.claimedEventId,
                capability.workspaceId,
                claim.assignmentId,
                nextLeaseGeneration,
                claim.executionGeneration,
                claim.now,
                claim.now,
              ],
            );
            const [sessionUpdate] = await connection.execute<ResultSetHeader>(
              `UPDATE browser_executor_session
               SET last_seen_at = ?,
                   updated_at = ?
               WHERE id = ?
                 AND state = 'active'
                 AND updated_at = ?`,
              [claim.now, claim.now, session.id, session.updatedAt],
            );
            if (sessionUpdate.affectedRows !== 1) {
              throw new BrowserControlPlaneStoreError(
                "browser_control.state_conflict",
                "The browser executor session changed while its attempt was being claimed.",
              );
            }

            return Object.freeze({
              assignmentId: claim.assignmentId,
              sessionId: session.id,
              workspaceId: capability.workspaceId,
              invocationKind: capability.invocationKind,
              ...(context.workflowRunId
                ? { workflowRunId: context.workflowRunId }
                : {}),
              ...(capability.nodeRunId
                ? { nodeRunId: capability.nodeRunId }
                : {}),
              capabilityRunId: capability.id,
              attemptId: attempt.id,
              contractRevisionId: capability.contractRevisionId,
              bindingId: attempt.bindingId,
              routeCandidateIndex: attempt.routeCandidateIndex,
              candidateAttemptNumber: attempt.candidateAttemptNumber,
              implementationRevisionId: attempt.implementationRevisionId,
              implementationDigest: context.implementationDigest,
              adapterKey: context.implementationAdapterKey,
              runtimeAdapterRevisionId: context.runtimeAdapterRevisionId,
              runtimeAdapterRevisionDigest:
                context.runtimeAdapterRevisionDigest,
              backend: context.backend,
              probeProfileVersion: context.probeProfileVersion,
              probeResultDigest: context.probeResultDigest,
              input: executeCapabilityMappingPlanV1(
                verifiedCompiledMapping(
                  context.compiledInputMapping,
                  context.inputMappingDigest,
                  "input",
                ),
                {
                  input: parseJson(context.nodeInput),
                  configuration: parseJson(context.implementationConfiguration),
                },
              ),
              leaseGeneration: nextLeaseGeneration,
              executionGeneration: claim.executionGeneration,
              leaseExpiresAt: claim.leaseUntil,
              executionDeadlineAt: deadline,
            });
          });
        } catch (error) {
          if (isAttemptAssignmentRace(error)) {
            continue;
          }
          throw error;
        }

        if (claimed) {
          return claimed;
        }
      }
      return undefined;
    },

    async heartbeatAttempt(heartbeat) {
      assertHeartbeat(heartbeat);
      const [locatorRows] = await pool.query<HeartbeatLocatorRow[]>(
        `SELECT
           attempt.id AS attemptId,
           attempt.capability_run_id AS capabilityRunId
         FROM browser_attempt_assignment AS assignment
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = assignment.capability_attempt_id
         WHERE assignment.id = ?
           AND assignment.workspace_id = ?
           AND assignment.browser_executor_session_id = ?
           AND assignment.attempt_grant_token_hash = ?
           AND attempt.id = ?
         LIMIT 1`,
        [
          heartbeat.assignmentId,
          heartbeat.workspaceId,
          heartbeat.sessionId,
          heartbeat.attemptGrantTokenHash,
          heartbeat.attemptId,
        ],
      );
      const locator = locatorRows[0];
      if (!locator) {
        return "rejected";
      }

      return inTransaction(pool, async (connection) => {
        const runtimeAllowed = await assertBrowserRuntimeAllowed(
          connection,
          instanceId,
          "heartbeat",
          heartbeat.executionGeneration,
          heartbeat.now,
        );
        if (!runtimeAllowed) {
          return "rejected";
        }
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
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
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [locator.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== locator.attemptId ||
          capability.acceptedAttemptId
        ) {
          return "rejected";
        }

        const [attemptRows] = await connection.execute<BrowserAttemptRow[]>(
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
               not_before AS notBefore,
               lease_generation AS leaseGeneration,
               lease_token_hash AS leaseTokenHash,
               lease_expires_at AS leaseExpiresAt,
               execution_deadline_at AS executionDeadlineAt,
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_attempt
             WHERE id = ?
               AND capability_run_id = ?
             LIMIT 1
             FOR UPDATE`,
          [locator.attemptId, capability.id],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.id !== heartbeat.attemptId ||
          attempt.workspaceId !== capability.workspaceId ||
          attempt.workspaceId !== heartbeat.workspaceId ||
          attempt.executionTarget !== "browser" ||
          attempt.lifecycleStatus !== "running" ||
          attempt.leaseTokenHash !== heartbeat.domainLeaseTokenHash ||
          attempt.leaseGeneration !== heartbeat.attemptLeaseGeneration ||
          !attempt.leaseExpiresAt ||
          !attempt.executionDeadlineAt
        ) {
          return "rejected";
        }

        const [assignmentRows] = await connection.execute<
          BrowserAssignmentRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               browser_executor_session_id AS browserExecutorSessionId,
               capability_attempt_id AS capabilityAttemptId,
               attempt_lease_generation AS attemptLeaseGeneration,
               execution_generation AS executionGeneration,
               attempt_grant_token_hash AS attemptGrantTokenHash,
               state,
               claimed_at AS claimedAt,
               last_heartbeat_at AS lastHeartbeatAt,
               lease_expires_at AS leaseExpiresAt
             FROM browser_attempt_assignment
             WHERE capability_attempt_id = ?
               AND attempt_grant_token_hash = ?
             LIMIT 1
             FOR UPDATE`,
          [locator.attemptId, heartbeat.attemptGrantTokenHash],
        );
        const assignment = assignmentRows[0];
        if (
          !assignment ||
          assignment.id !== heartbeat.assignmentId ||
          assignment.workspaceId !== capability.workspaceId ||
          assignment.workspaceId !== heartbeat.workspaceId ||
          assignment.browserExecutorSessionId !== heartbeat.sessionId ||
          assignment.capabilityAttemptId !== attempt.id ||
          assignment.attemptLeaseGeneration !==
            heartbeat.attemptLeaseGeneration ||
          assignment.executionGeneration !== heartbeat.executionGeneration ||
          assignment.attemptGrantTokenHash !== heartbeat.attemptGrantTokenHash
        ) {
          return "rejected";
        }

        const session = await lockSession(
          connection,
          assignment.browserExecutorSessionId,
        );
        if (
          !session ||
          session.workspaceId !== capability.workspaceId ||
          heartbeat.now < assignment.lastHeartbeatAt ||
          heartbeat.now < session.lastSeenAt ||
          heartbeat.now < session.updatedAt
        ) {
          return "rejected";
        }

        if (session.state === "revoked" || session.state === "closed") {
          if (assignment.state === "revoked") {
            return "revoked";
          }
          if (
            assignment.state !== "active" &&
            assignment.state !== "cancel_requested"
          ) {
            return "rejected";
          }
          const reason =
            session.state === "closed"
              ? "browser.session_closed"
              : "browser.session_revoked";
          const [attemptUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_attempt
               SET lease_expires_at = LEAST(lease_expires_at, ?),
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND lifecycle_status = 'running'
                 AND lease_generation = ?
                 AND lease_token_hash = ?`,
            [
              heartbeat.now,
              heartbeat.now,
              attempt.id,
              heartbeat.attemptLeaseGeneration,
              heartbeat.domainLeaseTokenHash,
            ],
          );
          const [assignmentUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE browser_attempt_assignment
               SET state = 'revoked',
                   stable_reason_code = ?,
                   lease_expires_at = LEAST(lease_expires_at, ?),
                   terminal_at = ?,
                   updated_at = ?
               WHERE id = ?
                 AND state IN ('active', 'cancel_requested')
                 AND attempt_lease_generation = ?
                 AND execution_generation = ?`,
            [
              reason,
              heartbeat.now,
              heartbeat.now,
              heartbeat.now,
              assignment.id,
              heartbeat.attemptLeaseGeneration,
              heartbeat.executionGeneration,
            ],
          );
          if (
            attemptUpdate.affectedRows !== 1 ||
            assignmentUpdate.affectedRows !== 1
          ) {
            throw new BrowserControlPlaneStoreError(
              "browser_control.state_conflict",
              "The revoked browser assignment changed while fencing its lease.",
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
             ) VALUES (?, ?, ?, ?, 'revoked', ?, ?, ?, ?, ?)`,
            [
              heartbeat.transitionEventId,
              capability.workspaceId,
              assignment.id,
              `revoked:${String(heartbeat.attemptLeaseGeneration)}:${String(
                heartbeat.executionGeneration,
              )}`,
              heartbeat.attemptLeaseGeneration,
              heartbeat.executionGeneration,
              reason,
              heartbeat.now,
              heartbeat.now,
            ],
          );
          return "revoked";
        }

        if (
          (session.state !== "active" && session.state !== "draining") ||
          session.expiresAt <= heartbeat.now ||
          session.lastSeenAt > heartbeat.now ||
          session.updatedAt > heartbeat.now ||
          assignment.leaseExpiresAt <= heartbeat.now ||
          attempt.leaseExpiresAt <= heartbeat.now ||
          attempt.executionDeadlineAt <= heartbeat.now ||
          !sameInstant(assignment.leaseExpiresAt, attempt.leaseExpiresAt)
        ) {
          return "rejected";
        }

        if (
          assignment.state === "cancel_requested" ||
          capability.cancelRequestedAt ||
          attempt.cancelRequestedAt
        ) {
          if (assignment.state === "active") {
            const [assignmentUpdate] =
              await connection.execute<ResultSetHeader>(
                `UPDATE browser_attempt_assignment
                 SET state = 'cancel_requested',
                     stable_reason_code = 'browser.cancel_requested',
                     last_heartbeat_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND state = 'active'
                   AND attempt_lease_generation = ?
                   AND execution_generation = ?`,
                [
                  heartbeat.now,
                  heartbeat.now,
                  assignment.id,
                  heartbeat.attemptLeaseGeneration,
                  heartbeat.executionGeneration,
                ],
              );
            if (assignmentUpdate.affectedRows !== 1) {
              throw new BrowserControlPlaneStoreError(
                "browser_control.state_conflict",
                "The browser assignment changed while projecting cancellation.",
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
               ) VALUES (
                 ?, ?, ?, ?, 'cancel_signaled', ?, ?,
                 'browser.cancel_requested', ?, ?
               )`,
              [
                heartbeat.transitionEventId,
                capability.workspaceId,
                assignment.id,
                `cancel_signaled:${String(
                  heartbeat.attemptLeaseGeneration,
                )}:${String(heartbeat.executionGeneration)}`,
                heartbeat.attemptLeaseGeneration,
                heartbeat.executionGeneration,
                heartbeat.now,
                heartbeat.now,
              ],
            );
            const [sessionUpdate] = await connection.execute<ResultSetHeader>(
              `UPDATE browser_executor_session
                 SET last_seen_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND state IN ('active', 'draining')
                   AND updated_at = ?`,
              [heartbeat.now, heartbeat.now, session.id, session.updatedAt],
            );
            if (sessionUpdate.affectedRows !== 1) {
              throw new BrowserControlPlaneStoreError(
                "browser_control.state_conflict",
                "The browser session changed while projecting cancellation.",
              );
            }
          }
          return "cancel_requested";
        }

        if (
          assignment.state !== "active" ||
          heartbeat.leaseUntil <= assignment.leaseExpiresAt ||
          heartbeat.leaseUntil <= attempt.leaseExpiresAt ||
          heartbeat.leaseUntil > attempt.executionDeadlineAt ||
          heartbeat.leaseUntil > session.expiresAt
        ) {
          return "rejected";
        }

        const [attemptUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_attempt
             SET lease_expires_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND lifecycle_status = 'running'
               AND lease_generation = ?
               AND lease_token_hash = ?
               AND lease_expires_at = ?
               AND execution_deadline_at >= ?`,
          [
            heartbeat.leaseUntil,
            heartbeat.now,
            attempt.id,
            heartbeat.attemptLeaseGeneration,
            heartbeat.domainLeaseTokenHash,
            attempt.leaseExpiresAt,
            heartbeat.leaseUntil,
          ],
        );
        const [assignmentUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE browser_attempt_assignment
             SET last_heartbeat_at = ?,
                 lease_expires_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND state = 'active'
               AND attempt_lease_generation = ?
               AND execution_generation = ?
               AND lease_expires_at = ?`,
          [
            heartbeat.now,
            heartbeat.leaseUntil,
            heartbeat.now,
            assignment.id,
            heartbeat.attemptLeaseGeneration,
            heartbeat.executionGeneration,
            assignment.leaseExpiresAt,
          ],
        );
        const [sessionUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE browser_executor_session
             SET last_seen_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND state IN ('active', 'draining')
               AND updated_at = ?`,
          [heartbeat.now, heartbeat.now, session.id, session.updatedAt],
        );
        if (
          attemptUpdate.affectedRows !== 1 ||
          assignmentUpdate.affectedRows !== 1 ||
          sessionUpdate.affectedRows !== 1
        ) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.state_conflict",
            "The browser heartbeat lost its compare-and-set fence.",
          );
        }
        return "renewed";
      });
    },

    async authorizeAttemptOutput(authorization) {
      assertOutputAuthorization(authorization);
      const [locatorRows] = await pool.query<HeartbeatLocatorRow[]>(
        `SELECT
           attempt.id AS attemptId,
           attempt.capability_run_id AS capabilityRunId
         FROM browser_attempt_assignment AS assignment
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = assignment.capability_attempt_id
         WHERE assignment.id = ?
           AND assignment.workspace_id = ?
           AND assignment.browser_executor_session_id = ?
           AND assignment.attempt_grant_token_hash = ?
           AND attempt.id = ?
         LIMIT 1`,
        [
          authorization.assignmentId,
          authorization.workspaceId,
          authorization.sessionId,
          authorization.attemptGrantTokenHash,
          authorization.attemptId,
        ],
      );
      const locator = locatorRows[0];
      if (!locator) {
        return Object.freeze({ status: "rejected" as const });
      }

      return inTransaction(pool, async (connection) => {
        const runtimeAllowed = await assertBrowserRuntimeAllowed(
          connection,
          instanceId,
          "upload",
          authorization.executionGeneration,
          authorization.now,
        );
        if (!runtimeAllowed) {
          return Object.freeze({ status: "rejected" as const });
        }
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
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
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [locator.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.workspaceId !== authorization.workspaceId ||
          capability.lifecycleStatus !== "running" ||
          capability.currentAttemptId !== locator.attemptId ||
          capability.acceptedAttemptId
        ) {
          return Object.freeze({ status: "rejected" as const });
        }

        const [attemptRows] = await connection.execute<BrowserAttemptRow[]>(
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
               not_before AS notBefore,
               lease_generation AS leaseGeneration,
               lease_token_hash AS leaseTokenHash,
               lease_expires_at AS leaseExpiresAt,
               execution_deadline_at AS executionDeadlineAt,
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_attempt
             WHERE id = ?
               AND capability_run_id = ?
             LIMIT 1
             FOR UPDATE`,
          [locator.attemptId, capability.id],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.workspaceId !== capability.workspaceId ||
          attempt.executionTarget !== "browser" ||
          attempt.lifecycleStatus !== "running" ||
          attempt.leaseTokenHash !== authorization.domainLeaseTokenHash ||
          attempt.leaseGeneration !== authorization.attemptLeaseGeneration ||
          !attempt.leaseExpiresAt ||
          !attempt.executionDeadlineAt
        ) {
          return Object.freeze({ status: "rejected" as const });
        }

        const [assignmentRows] = await connection.execute<
          BrowserAssignmentRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               browser_executor_session_id AS browserExecutorSessionId,
               capability_attempt_id AS capabilityAttemptId,
               attempt_lease_generation AS attemptLeaseGeneration,
               execution_generation AS executionGeneration,
               attempt_grant_token_hash AS attemptGrantTokenHash,
               state,
               claimed_at AS claimedAt,
               last_heartbeat_at AS lastHeartbeatAt,
               lease_expires_at AS leaseExpiresAt
             FROM browser_attempt_assignment
             WHERE capability_attempt_id = ?
               AND attempt_grant_token_hash = ?
             LIMIT 1
             FOR UPDATE`,
          [attempt.id, authorization.attemptGrantTokenHash],
        );
        const assignment = assignmentRows[0];
        if (
          !assignment ||
          assignment.id !== authorization.assignmentId ||
          assignment.workspaceId !== authorization.workspaceId ||
          assignment.browserExecutorSessionId !== authorization.sessionId ||
          assignment.capabilityAttemptId !== attempt.id ||
          assignment.attemptLeaseGeneration !==
            authorization.attemptLeaseGeneration ||
          assignment.executionGeneration !== authorization.executionGeneration
        ) {
          return Object.freeze({ status: "rejected" as const });
        }

        const session = await lockSession(connection, authorization.sessionId);
        if (!session || session.workspaceId !== authorization.workspaceId) {
          return Object.freeze({ status: "rejected" as const });
        }
        if (
          session.state === "revoked" ||
          session.state === "closed" ||
          assignment.state === "revoked"
        ) {
          return Object.freeze({ status: "revoked" as const });
        }
        if (
          capability.cancelRequestedAt ||
          attempt.cancelRequestedAt ||
          assignment.state === "cancel_requested"
        ) {
          return Object.freeze({
            status: "cancel_requested" as const,
          });
        }
        if (
          assignment.state !== "active" ||
          (session.state !== "active" && session.state !== "draining") ||
          session.expiresAt <= authorization.now ||
          assignment.leaseExpiresAt <= authorization.now ||
          attempt.leaseExpiresAt <= authorization.now ||
          attempt.executionDeadlineAt <= authorization.now ||
          !sameInstant(assignment.leaseExpiresAt, attempt.leaseExpiresAt)
        ) {
          return Object.freeze({ status: "rejected" as const });
        }
        return Object.freeze({
          status: "authorized" as const,
          actorId: session.createdByPrincipalId,
          expiresAt: new Date(
            Math.min(
              session.expiresAt.getTime(),
              attempt.executionDeadlineAt.getTime(),
            ),
          ),
        });
      });
    },

    async mapAttemptOutput(options) {
      const [rows] = await pool.query<BrowserOutputMappingRow[]>(
        `SELECT
           implementation.canonical_digest AS implementationDigest,
           implementation.lifecycle_status AS implementationStatus,
           implementation.adapter_key AS adapterKey,
           implementation.output_mapping_digest AS outputMappingDigest,
           implementation.compiled_output_mapping AS compiledOutputMapping,
           runtime_adapter.lifecycle_status AS runtimeAdapterStatus,
           runtime_adapter.execution_target AS runtimeAdapterExecutionTarget,
           runtime_adapter_definition.adapter_key AS runtimeAdapterKey,
           runtime_adapter_definition.lifecycle_status AS runtimeAdapterDefinitionStatus
         FROM capability_implementation_revision AS implementation
         INNER JOIN runtime_adapter_revision AS runtime_adapter
           ON runtime_adapter.id = implementation.runtime_adapter_revision_id
          AND runtime_adapter.workspace_id = implementation.workspace_id
         INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
           ON runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
          AND runtime_adapter_definition.workspace_id = implementation.workspace_id
         WHERE implementation.workspace_id = ?
           AND implementation.id = ?
         LIMIT 1`,
        [options.workspaceId, options.implementationRevisionId],
      );
      const row = rows[0];
      if (
        !row ||
        row.implementationDigest !== options.implementationDigest ||
        row.adapterKey !== options.adapterKey ||
        row.runtimeAdapterKey !== options.adapterKey ||
        row.runtimeAdapterExecutionTarget !== "browser" ||
        row.runtimeAdapterDefinitionStatus !== "active" ||
        !["published", "deprecated"].includes(row.implementationStatus) ||
        !["published", "deprecated"].includes(row.runtimeAdapterStatus)
      ) {
        throw new BrowserControlPlaneStoreError(
          "browser_control.registration_mismatch",
          "Browser output mapping does not match the pinned implementation.",
        );
      }
      return executeCapabilityMappingPlanV1(
        verifiedCompiledMapping(
          row.compiledOutputMapping,
          row.outputMappingDigest,
          "output",
        ),
        { result: options.adapterOutput },
      );
    },

    async acknowledgeAttemptCancellation(acknowledgement) {
      assertCancellationAcknowledgement(acknowledgement);
      const [locatorRows] = await pool.query<HeartbeatLocatorRow[]>(
        `SELECT
           attempt.id AS attemptId,
           attempt.capability_run_id AS capabilityRunId
         FROM browser_attempt_assignment AS assignment
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = assignment.capability_attempt_id
         WHERE assignment.id = ?
           AND assignment.workspace_id = ?
           AND assignment.browser_executor_session_id = ?
           AND assignment.attempt_grant_token_hash = ?
           AND attempt.id = ?
           AND attempt.capability_run_id = ?
         LIMIT 1`,
        [
          acknowledgement.assignmentId,
          acknowledgement.workspaceId,
          acknowledgement.sessionId,
          acknowledgement.attemptGrantTokenHash,
          acknowledgement.attemptId,
          acknowledgement.capabilityRunId,
        ],
      );
      const locator = locatorRows[0];
      if (!locator) {
        return "rejected";
      }

      return inTransaction(pool, async (connection) => {
        const [capabilityRows] = await connection.execute<CapabilityRunRow[]>(
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
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_run
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
          [acknowledgement.capabilityRunId],
        );
        const capability = capabilityRows[0];
        if (
          !capability ||
          capability.workspaceId !== acknowledgement.workspaceId ||
          capability.currentAttemptId !== acknowledgement.attemptId
        ) {
          return "rejected";
        }

        const [attemptRows] = await connection.execute<BrowserAttemptRow[]>(
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
               not_before AS notBefore,
               lease_generation AS leaseGeneration,
               lease_token_hash AS leaseTokenHash,
               lease_expires_at AS leaseExpiresAt,
               execution_deadline_at AS executionDeadlineAt,
               cancel_requested_at AS cancelRequestedAt,
               version
             FROM capability_attempt
             WHERE id = ?
               AND capability_run_id = ?
             LIMIT 1
             FOR UPDATE`,
          [acknowledgement.attemptId, capability.id],
        );
        const attempt = attemptRows[0];
        if (
          !attempt ||
          attempt.workspaceId !== acknowledgement.workspaceId ||
          attempt.executionTarget !== "browser"
        ) {
          return "rejected";
        }

        const [assignmentRows] = await connection.execute<
          BrowserAssignmentRow[]
        >(
          `SELECT
               id,
               workspace_id AS workspaceId,
               browser_executor_session_id AS browserExecutorSessionId,
               capability_attempt_id AS capabilityAttemptId,
               attempt_lease_generation AS attemptLeaseGeneration,
               execution_generation AS executionGeneration,
               attempt_grant_token_hash AS attemptGrantTokenHash,
               state,
               claimed_at AS claimedAt,
               last_heartbeat_at AS lastHeartbeatAt,
               lease_expires_at AS leaseExpiresAt
             FROM browser_attempt_assignment
             WHERE id = ?
               AND capability_attempt_id = ?
             LIMIT 1
             FOR UPDATE`,
          [acknowledgement.assignmentId, attempt.id],
        );
        const assignment = assignmentRows[0];
        if (
          !assignment ||
          assignment.workspaceId !== acknowledgement.workspaceId ||
          assignment.browserExecutorSessionId !== acknowledgement.sessionId ||
          assignment.capabilityAttemptId !== attempt.id ||
          assignment.attemptLeaseGeneration !==
            acknowledgement.attemptLeaseGeneration ||
          assignment.executionGeneration !==
            acknowledgement.executionGeneration ||
          assignment.attemptGrantTokenHash !==
            acknowledgement.attemptGrantTokenHash
        ) {
          return "rejected";
        }

        const session = await lockSession(
          connection,
          acknowledgement.sessionId,
        );
        if (!session || session.workspaceId !== acknowledgement.workspaceId) {
          return "rejected";
        }

        if (
          capability.lifecycleStatus === "cancelled" &&
          capability.acceptedAttemptId === null &&
          attempt.lifecycleStatus === "abandoned" &&
          assignment.state === "cancelled"
        ) {
          return "replayed";
        }
        if (session.state === "revoked" || session.state === "closed") {
          return "revoked";
        }
        const runtimeAllowed = await assertBrowserRuntimeAllowed(
          connection,
          instanceId,
          "cancel",
          acknowledgement.executionGeneration,
          acknowledgement.now,
        );
        if (!runtimeAllowed) {
          return "rejected";
        }
        if (
          capability.lifecycleStatus !== "running" ||
          capability.acceptedAttemptId !== null ||
          !capability.cancelRequestedAt ||
          attempt.lifecycleStatus !== "running" ||
          !attempt.cancelRequestedAt ||
          attempt.leaseGeneration !== acknowledgement.attemptLeaseGeneration ||
          attempt.leaseTokenHash !== acknowledgement.domainLeaseTokenHash ||
          !attempt.leaseExpiresAt ||
          attempt.leaseExpiresAt <= acknowledgement.now ||
          assignment.leaseExpiresAt <= acknowledgement.now ||
          (assignment.state !== "active" &&
            assignment.state !== "cancel_requested") ||
          (session.state !== "active" && session.state !== "draining") ||
          session.expiresAt <= acknowledgement.now
        ) {
          return "rejected";
        }

        const nextCapabilityVersion = capability.version + 1;
        const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_run
             SET lifecycle_status = 'cancelled',
                 version = ?,
                 updated_at = ?,
                 completed_at = ?
             WHERE id = ?
               AND workspace_id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND current_attempt_id = ?
               AND accepted_attempt_id IS NULL
               AND cancel_requested_at IS NOT NULL`,
          [
            nextCapabilityVersion,
            acknowledgement.now,
            acknowledgement.now,
            capability.id,
            acknowledgement.workspaceId,
            capability.version,
            attempt.id,
          ],
        );
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
               AND workspace_id = ?
               AND capability_run_id = ?
               AND version = ?
               AND lifecycle_status = 'running'
               AND lease_generation = ?
               AND lease_token_hash = ?
               AND cancel_requested_at IS NOT NULL`,
          [
            JSON.stringify({
              code: "browser_attempt_cancelled_after_start",
              observedAt: acknowledgement.now.toISOString(),
            }),
            acknowledgement.now,
            acknowledgement.now,
            attempt.id,
            acknowledgement.workspaceId,
            capability.id,
            attempt.version,
            acknowledgement.attemptLeaseGeneration,
            acknowledgement.domainLeaseTokenHash,
          ],
        );
        const [assignmentUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE browser_attempt_assignment
             SET state = 'cancelled',
                 stable_reason_code = 'browser.cancel_acknowledged',
                 last_heartbeat_at = ?,
                 terminal_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND workspace_id = ?
               AND state IN ('active', 'cancel_requested')
               AND attempt_lease_generation = ?
               AND execution_generation = ?
               AND attempt_grant_token_hash = ?`,
          [
            acknowledgement.now,
            acknowledgement.now,
            acknowledgement.now,
            assignment.id,
            acknowledgement.workspaceId,
            acknowledgement.attemptLeaseGeneration,
            acknowledgement.executionGeneration,
            acknowledgement.attemptGrantTokenHash,
          ],
        );
        if (
          capabilityUpdate.affectedRows !== 1 ||
          attemptUpdate.affectedRows !== 1 ||
          assignmentUpdate.affectedRows !== 1
        ) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.state_conflict",
            "Browser cancellation acknowledgement lost its compare-and-set fence.",
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
           ) VALUES (?, ?, ?, ?, 'cancelled', ?, ?,
             'browser.cancel_acknowledged', ?, ?)`,
          [
            acknowledgement.cancelledEventId,
            acknowledgement.workspaceId,
            assignment.id,
            `cancelled:${String(
              acknowledgement.attemptLeaseGeneration,
            )}:${String(acknowledgement.executionGeneration)}`,
            acknowledgement.attemptLeaseGeneration,
            acknowledgement.executionGeneration,
            acknowledgement.now,
            acknowledgement.now,
          ],
        );
        let node:
          | (RowDataPacket & {
              readonly id: string;
              readonly workflowRunId: string;
            })
          | undefined;
        if (capability.invocationKind === "workflow") {
          const [nodeRows] = await connection.execute<
            (RowDataPacket & {
              readonly id: string;
              readonly workflowRunId: string;
            })[]
          >(
            `SELECT
               id,
               workflow_run_id AS workflowRunId
             FROM node_run
             WHERE id = ?
               AND workspace_id = ?
             LIMIT 1`,
            [capability.nodeRunId, acknowledgement.workspaceId],
          );
          node = nodeRows[0];
        }
        if (capability.invocationKind === "workflow" && !node) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.state_conflict",
            "Browser cancellation acknowledgement node run is missing.",
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
           ) VALUES (
             ?, ?, 'capability.run.cancelled', 'capability_run', ?, ?, ?,
             'pending', ?, 0, ?
           )`,
          [
            acknowledgement.terminalOutboxEventId,
            acknowledgement.workspaceId,
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
              attemptId: attempt.id,
              expectedGeneration: acknowledgement.executionGeneration,
              cause: "browser_abort_acknowledged",
            }),
            acknowledgement.now,
            acknowledgement.now,
          ],
        );
        return "acknowledged";
      });
    },

    async drainSession(transition) {
      assertSessionTransition(transition);
      return inTransaction(pool, async (connection) => {
        const session = await lockSession(connection, transition.sessionId);
        if (!session) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.authority_mismatch",
            "The browser executor session is not available to this authority.",
          );
        }
        if (!authorityMatches(session, transition.authority)) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.authority_mismatch",
            "The current Human authority facts do not match the session.",
          );
        }
        if (
          transition.now < session.lastSeenAt ||
          transition.now < session.updatedAt
        ) {
          invalid("Session transitions cannot move timestamps backwards.");
        }
        if (session.state !== "active") {
          return sessionResult(session.id, session.state, false);
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE browser_executor_session
           SET state = 'draining',
               last_seen_at = ?,
               updated_at = ?
           WHERE id = ?
             AND state = 'active'
             AND updated_at = ?`,
          [transition.now, transition.now, session.id, session.updatedAt],
        );
        if (result.affectedRows !== 1) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.state_conflict",
            "The browser executor session changed while draining.",
          );
        }
        return sessionResult(session.id, "draining", true);
      });
    },

    async revokeSession(transition) {
      assertSessionTransition(transition);
      return inTransaction(pool, async (connection) => {
        const session = await lockSession(connection, transition.sessionId);
        if (!session) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.authority_mismatch",
            "The browser executor session is not available to this authority.",
          );
        }
        if (!authorityMatches(session, transition.authority)) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.authority_mismatch",
            "The current Human authority facts do not match the session.",
          );
        }
        if (
          transition.now < session.lastSeenAt ||
          transition.now < session.updatedAt
        ) {
          invalid("Session transitions cannot move timestamps backwards.");
        }
        if (session.state !== "active" && session.state !== "draining") {
          return sessionResult(session.id, session.state, false);
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE browser_executor_session
           SET state = 'revoked',
               last_seen_at = ?,
               terminal_at = ?,
               updated_at = ?
           WHERE id = ?
             AND state = ?
             AND updated_at = ?`,
          [
            transition.now,
            transition.now,
            transition.now,
            session.id,
            session.state,
            session.updatedAt,
          ],
        );
        if (result.affectedRows !== 1) {
          throw new BrowserControlPlaneStoreError(
            "browser_control.state_conflict",
            "The browser executor session changed while revoking.",
          );
        }
        return sessionResult(session.id, "revoked", true);
      });
    },
  });
}
