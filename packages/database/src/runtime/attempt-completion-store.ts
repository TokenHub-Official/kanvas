import { createHash } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  findPinnedCandidate,
  parsePinnedCapabilityRoute,
  parseJson,
} from "./execution-plan.js";
import type { ExecutionTarget } from "./execution-target.js";
import { appendControlPlaneAuditEventInTransaction } from "./control-plane-audit.js";

const kanvasIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const printableAsciiPattern = /^[\x21-\x7e]+$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const unsignedDecimalPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const unsignedIntegerPattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const maximumUnsignedBigInt = 18_446_744_073_709_551_615n;

const maximumOutputs = 64;
const maximumInitialUsageEntries = 256;
const manifestSchemaVersion = 1 as const;

export type AttemptCompletionManifestSchemaVersion = 1;

export type InitialUsageSourceKind =
  | "producer_reported"
  | "provider_reported"
  | "kanvas_measured"
  | "kanvas_calculated";

interface InitialUsageBase {
  readonly id: string;
  readonly entryKey: string;
  readonly metricKey: string;
  readonly sourceKind: InitialUsageSourceKind;
  readonly evidenceDigest: string;
  readonly providerInvocationId?: string;
  readonly pricingRevisionId?: string;
  readonly observedAt: Date;
}

interface InitialQuantityUsageBase extends InitialUsageBase {
  readonly valueDimension: "quantity";
  readonly unitCode: string;
  readonly currencyCode?: never;
}

interface InitialMoneyUsageBase extends InitialUsageBase {
  readonly valueDimension: "money";
  readonly unitCode?: never;
  readonly currencyCode: string;
}

export type InitialUsageEntry =
  | ((InitialQuantityUsageBase | InitialMoneyUsageBase) & {
      readonly entryKind: "observation";
      /**
       * DECIMAL values cross this boundary as strings. Number input is
       * deliberately unsupported because it cannot preserve DECIMAL(36,12).
       */
      readonly numericValue: string;
    })
  | ((InitialQuantityUsageBase | InitialMoneyUsageBase) & {
      readonly entryKind: "unknown";
      readonly numericValue?: never;
    });

export interface AttemptCompletionOutput {
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly attemptOutputId: string;
  readonly outputRole: string;
  readonly outputIndex: number;
  readonly artifactType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface CompletionTargetIdentityBase {
  readonly executionTarget: ExecutionTarget;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
}

export interface WorkerCompletionIdentity extends CompletionTargetIdentityBase {
  readonly executionTarget: "worker";
  readonly attemptLeaseGeneration: number;
  readonly domainLeaseTokenHash: string;
}

export interface ProviderCompletionIdentity extends CompletionTargetIdentityBase {
  readonly executionTarget: "provider";
  readonly invocationId: string;
  readonly succeededObservationId: string;
  readonly invocationLeaseGeneration: number;
  readonly routeCandidateDigest: string;
  readonly requestFingerprint: string;
  readonly stableRequestKey: string;
  readonly responseDigest?: string;
}

export interface BrowserCompletionIdentity extends CompletionTargetIdentityBase {
  readonly executionTarget: "browser";
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly completedAssignmentEventId: string;
  readonly attemptLeaseGeneration: number;
  readonly attemptGrantTokenHash: string;
  readonly domainLeaseTokenHash: string;
}

export type AttemptCompletionTargetIdentity =
  | WorkerCompletionIdentity
  | ProviderCompletionIdentity
  | BrowserCompletionIdentity;

export interface CompleteAttemptOptions {
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly completionId: string;
  readonly terminalOutboxEventId: string;
  readonly executionGeneration: number;
  readonly target: AttemptCompletionTargetIdentity;
  readonly capabilityOutput: unknown;
  readonly outputs: readonly AttemptCompletionOutput[];
  readonly initialUsage: readonly InitialUsageEntry[];
  readonly now: Date;
}

export type AtomicAttemptCompletionStatus = "completed" | "replayed";

export interface AtomicAttemptCompletionResult {
  readonly status: AtomicAttemptCompletionStatus;
  readonly completionId: string;
  /**
   * Logical API idempotency identity. The persisted completion_request_key is
   * constrained to the attempt ULID, while this API exposes a versioned key.
   */
  readonly completionRequestKey: string;
  readonly completionManifestHash: string;
  readonly manifestSchemaVersion: AttemptCompletionManifestSchemaVersion;
  readonly terminalOutboxEventId: string;
  readonly completedAt: Date;
  readonly outputs: readonly CompletedAttemptOutput[];
}

export interface CompletedAttemptOutput {
  readonly uploadSessionId: string;
  readonly storedObjectId: string;
  readonly artifactId: string;
  readonly attemptOutputId: string;
  readonly outputRole: string;
  readonly outputIndex: number;
}

export interface AtomicAttemptCompletionStore {
  complete(
    options: CompleteAttemptOptions,
  ): Promise<AtomicAttemptCompletionResult>;
}

export interface CreateAtomicAttemptCompletionStoreOptions {
  readonly instanceId: string;
}

export type AtomicAttemptCompletionStoreErrorCode =
  | "attempt_completion.invalid_argument"
  | "attempt_completion.runtime_fenced"
  | "attempt_completion.lifecycle_rejected"
  | "attempt_completion.identity_conflict"
  | "attempt_completion.lease_rejected"
  | "attempt_completion.state_conflict"
  | "attempt_completion.manifest_conflict"
  | "attempt_completion.asset_conflict";

export class AtomicAttemptCompletionStoreError extends Error {
  constructor(
    readonly code: AtomicAttemptCompletionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AtomicAttemptCompletionStoreError";
  }
}

interface CapabilityRow extends RowDataPacket {
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
  readonly output: unknown;
  readonly cancelRequestedAt: Date | null;
  readonly version: number;
}

interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly bindingId: string;
  readonly routeCandidateIndex: number;
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
  readonly lifecycleStatus: string;
  readonly sideEffectState: string;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly completionManifestHash: string | null;
  readonly version: number;
}

interface CompletionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly capabilityAttemptId: string;
  readonly completionRequestKey: string;
  readonly manifestSchemaVersion: number;
  readonly completionManifestHash: string;
  readonly outputCount: number;
  readonly initialUsageEntryCount: number;
  readonly terminalOutboxEventId: string;
  readonly completedAt: Date;
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
  readonly deadline: Date | null;
}

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly nodeRunId: string | null;
  readonly nodeWorkspaceId: string | null;
  readonly nodeLifecycleStatus: string | null;
  readonly nodeInput: unknown;
  readonly organizationId: string;
  readonly workflowRunId: string | null;
  readonly workflowWorkspaceId: string | null;
  readonly workflowLifecycleStatus: string | null;
  readonly routeSnapshot: unknown;
}

interface PinnedLifecycleRow extends RowDataPacket {
  readonly bindingWorkspaceId: string;
  readonly bindingContractRevisionId: string;
  readonly bindingLifecycleStatus: string;
  readonly contractWorkspaceId: string;
  readonly contractDigest: string;
  readonly contractLifecycleStatus: string;
  readonly implementationRevisionId: string;
  readonly implementationWorkspaceId: string;
  readonly implementationExecutionTarget: string;
  readonly implementationDigest: string;
  readonly implementationAdapterKey: string;
  readonly implementationLifecycleStatus: string;
}

interface UploadSessionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly attemptId: string | null;
  readonly purpose: string;
  readonly allocationRequestKey: string | null;
  readonly outputRole: string | null;
  readonly outputIndex: number | null;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly sealedIdentityHash: string | null;
  readonly state: string;
  readonly version: number;
  readonly expiresAt: Date;
  readonly cleanupState: string;
  readonly verifiedSize: string | null;
  readonly verifiedSha256: string | null;
  readonly detectedMediaType: string | null;
  readonly committedStoredObjectId: string | null;
}

interface StoredObjectRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdFromUploadSessionId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId: string | null;
  readonly providerEtag: string | null;
  readonly immutableIdentityHash: string | null;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly deleteState: string;
}

interface ArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly storedObjectId: string;
  readonly createdByCapabilityRunId: string | null;
  readonly contentDigest: string;
  readonly artifactType: string;
  readonly metadata: unknown;
}

interface AttemptOutputRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityAttemptId: string;
  readonly outputRole: string;
  readonly outputIndex: number;
  readonly artifactId: string;
}

interface ArtifactLineageSourceRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly availabilityStatus: string;
}

interface ArtifactEdgeRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceArtifactId: string;
  readonly targetArtifactId: string;
  readonly relation: string;
}

interface IdentityRow extends RowDataPacket {
  readonly id: string;
}

interface InitialUsageRow extends RowDataPacket {
  readonly entryKey: string;
  readonly metricKey: string;
  readonly valueDimension: string;
  readonly unitCode: string | null;
  readonly numericValue: string | null;
  readonly currencyCode: string | null;
  readonly entryKind: string;
  readonly recordingPhase: string;
  readonly sourceKind: string;
  readonly correctsUsageEntryId: string | null;
  readonly providerInvocationId: string | null;
  readonly pricingRevisionId: string | null;
  readonly evidenceDigest: string;
  readonly observedAt: Date;
}

interface BrowserAssignmentRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly browserExecutorSessionId: string;
  readonly capabilityAttemptId: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly attemptGrantTokenHash: string;
  readonly state: string;
  readonly leaseExpiresAt: Date;
}

interface BrowserSessionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly state: string;
  readonly expiresAt: Date;
}

interface ProviderInvocationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityAttemptId: string;
  readonly implementationRevisionId: string;
  readonly pricingRevisionId: string | null;
  readonly routeCandidateDigest: string;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly remoteStatus: string;
  readonly sideEffectState: string;
  readonly workState: string;
  readonly reconcileLeaseGeneration: number;
  readonly terminalAt: Date | null;
}

interface ProviderObservationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerInvocationId: string;
  readonly normalizedStatus: string;
  readonly responseDigest: string | null;
  readonly executionGeneration: number;
  readonly adoptionOutcome: string;
  readonly recordedAt: Date;
}

interface ResolvedOutput {
  readonly request: AttemptCompletionOutput;
  readonly upload: UploadSessionRow;
  readonly storedObject: StoredObjectRow | null;
}

interface ProviderCompletionFacts {
  readonly invocation: ProviderInvocationRow;
}

type TargetCompletionFacts =
  | {
      readonly kind: "worker";
    }
  | {
      readonly kind: "browser";
      readonly assignment: BrowserAssignmentRow;
      readonly session: BrowserSessionRow;
    }
  | ({
      readonly kind: "provider";
    } & ProviderCompletionFacts);

interface CompletionManifest {
  readonly schemaVersion: AttemptCompletionManifestSchemaVersion;
  readonly completionRequestKey: string;
  readonly workspaceId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly executionGeneration: number;
  readonly target: Readonly<Record<string, unknown>>;
  readonly capabilityOutput: unknown;
  readonly outputs: readonly Readonly<Record<string, unknown>>[];
  readonly initialUsage: readonly Readonly<Record<string, unknown>>[];
}

function fail(
  code: AtomicAttemptCompletionStoreErrorCode,
  message: string,
): never {
  throw new AtomicAttemptCompletionStoreError(code, message);
}

function invalid(message: string): never {
  return fail("attempt_completion.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !kanvasIdPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 hash.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
}

function assertOutputIndex(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be an unsigned 32-bit integer.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  asciiOnly = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    (asciiOnly && !printableAsciiPattern.test(value))
  ) {
    invalid(
      `${label} must be a non-empty${asciiOnly ? " printable ASCII" : ""} value no longer than ${String(maximumLength)} characters.`,
    );
  }
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

type CanonicalTextComparator = (left: string, right: string) => number;

function canonicalizeWithComparator(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  compareText: CanonicalTextComparator,
): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid(`${path} contains a non-finite number.`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      invalid(`${path} contains a cyclic array.`);
    }
    ancestors.add(value);
    const canonical = `[${value
      .map((item, index) =>
        canonicalizeWithComparator(
          item,
          `${path}[${String(index)}]`,
          ancestors,
          compareText,
        ),
      )
      .join(",")}]`;
    ancestors.delete(value);
    return canonical;
  }
  if (typeof value === "object" && value !== null) {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      invalid(`${path} must contain only JSON objects.`);
    }
    if (ancestors.has(value)) {
      invalid(`${path} contains a cyclic object.`);
    }
    ancestors.add(value);
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => compareText(left, right),
    );
    for (const [key, item] of entries) {
      if (item === undefined) {
        invalid(`${path}.${key} cannot be undefined.`);
      }
    }
    const canonical = `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalizeWithComparator(
            item,
            `${path}.${key}`,
            ancestors,
            compareText,
          )}`,
      )
      .join(",")}}`;
    ancestors.delete(value);
    return canonical;
  }
  return invalid(`${path} contains unsupported ${typeof value}.`);
}

function canonicalize(
  value: unknown,
  path = "$",
  ancestors = new WeakSet<object>(),
): string {
  return canonicalizeWithComparator(
    value,
    path,
    ancestors,
    compareCanonicalText,
  );
}

function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalize(value))
    .digest("hex")}`;
}

function assertSupportedManifestSchemaVersion(
  value: number,
): AttemptCompletionManifestSchemaVersion {
  if (!Number.isSafeInteger(value) || value !== manifestSchemaVersion) {
    fail(
      "attempt_completion.identity_conflict",
      `Stored completion manifest schema version ${String(value)} is unsupported.`,
    );
  }
  return manifestSchemaVersion;
}

function normalizeUnsignedDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !unsignedDecimalPattern.test(value)) {
    invalid(
      `${label} must be an unsigned base-10 DECIMAL string with at most 24 integer and 12 fractional digits.`,
    );
  }
  const [integer = "0", fraction] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=[0-9])/u, "");
  const normalizedFraction = fraction?.replace(/0+$/u, "");
  return normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
}

function normalizeUnsignedBigInt(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !unsignedIntegerPattern.test(value) ||
    BigInt(value) > maximumUnsignedBigInt
  ) {
    invalid(`${label} must be an unsigned 64-bit integer string.`);
  }
  return value;
}

function completionRequestKeyForUnchecked(attemptId: string): string {
  return `complete:v1:${attemptId}`;
}

export function completionRequestKeyFor(attemptId: string): string {
  assertId(attemptId, "attemptId");
  return completionRequestKeyForUnchecked(attemptId);
}

function validateUsageEntry(
  entry: InitialUsageEntry,
  index: number,
  executionTarget: ExecutionTarget,
  providerInvocationId: string | undefined,
): void {
  const label = `initialUsage[${String(index)}]`;
  assertId(entry.id, `${label}.id`);
  assertBoundedText(entry.entryKey, `${label}.entryKey`, 160, true);
  assertBoundedText(entry.metricKey, `${label}.metricKey`, 160, true);
  assertDigest(entry.evidenceDigest, `${label}.evidenceDigest`);
  assertDate(entry.observedAt, `${label}.observedAt`);
  if (
    entry.sourceKind !== "producer_reported" &&
    entry.sourceKind !== "provider_reported" &&
    entry.sourceKind !== "kanvas_measured" &&
    entry.sourceKind !== "kanvas_calculated"
  ) {
    invalid(`${label}.sourceKind is not valid for initial usage.`);
  }
  if (entry.providerInvocationId !== undefined) {
    assertId(entry.providerInvocationId, `${label}.providerInvocationId`);
  }
  if (entry.pricingRevisionId !== undefined) {
    assertId(entry.pricingRevisionId, `${label}.pricingRevisionId`);
  }
  if (
    executionTarget === "provider" &&
    entry.providerInvocationId !== undefined &&
    entry.providerInvocationId !== providerInvocationId
  ) {
    invalid(`${label}.providerInvocationId does not match the target.`);
  }
  if (
    executionTarget !== "provider" &&
    entry.providerInvocationId !== undefined
  ) {
    invalid(`${label} cannot reference a Provider invocation.`);
  }
  if (
    entry.sourceKind === "provider_reported" &&
    (executionTarget !== "provider" ||
      entry.providerInvocationId !== providerInvocationId)
  ) {
    invalid(
      `${label} provider-reported usage must reference the target invocation.`,
    );
  }
  if (entry.valueDimension === "quantity") {
    assertBoundedText(entry.unitCode, `${label}.unitCode`, 80, true);
    if ("currencyCode" in entry && entry.currencyCode !== undefined) {
      invalid(`${label}.currencyCode is invalid for quantity usage.`);
    }
  } else if (entry.valueDimension === "money") {
    if (
      typeof entry.currencyCode !== "string" ||
      !currencyPattern.test(entry.currencyCode)
    ) {
      invalid(`${label}.currencyCode must be an uppercase ISO-style code.`);
    }
    if ("unitCode" in entry && entry.unitCode !== undefined) {
      invalid(`${label}.unitCode is invalid for money usage.`);
    }
  } else {
    invalid(`${label}.valueDimension is invalid.`);
  }
  if (entry.entryKind === "observation") {
    normalizeUnsignedDecimal(entry.numericValue, `${label}.numericValue`);
  } else if (entry.entryKind === "unknown") {
    const runtimeNumericValue = (
      entry as InitialUsageEntry & {
        readonly numericValue?: unknown;
      }
    ).numericValue;
    if (
      "numericValue" in entry &&
      runtimeNumericValue !== undefined &&
      runtimeNumericValue !== null
    ) {
      invalid(
        `${label}.numericValue must be absent for unknown usage; zero is not an unknown cost.`,
      );
    }
  } else {
    invalid(`${label}.entryKind must be observation or unknown.`);
  }
}

function validateOptions(options: CompleteAttemptOptions): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.capabilityRunId, "capabilityRunId");
  assertId(options.attemptId, "attemptId");
  assertId(options.completionId, "completionId");
  assertId(options.terminalOutboxEventId, "terminalOutboxEventId");
  assertPositiveInteger(options.executionGeneration, "executionGeneration");
  assertDate(options.now, "now");
  canonicalize(options.capabilityOutput, "capabilityOutput");

  const target = options.target;
  assertId(target.implementationRevisionId, "target.implementationRevisionId");
  assertDigest(target.implementationDigest, "target.implementationDigest");
  assertBoundedText(target.adapterKey, "target.adapterKey", 160, true);
  if (target.executionTarget === "worker") {
    assertPositiveInteger(
      target.attemptLeaseGeneration,
      "target.attemptLeaseGeneration",
    );
    assertHash(target.domainLeaseTokenHash, "target.domainLeaseTokenHash");
  } else if (target.executionTarget === "browser") {
    assertId(target.assignmentId, "target.assignmentId");
    assertId(target.sessionId, "target.sessionId");
    assertId(
      target.completedAssignmentEventId,
      "target.completedAssignmentEventId",
    );
    assertPositiveInteger(
      target.attemptLeaseGeneration,
      "target.attemptLeaseGeneration",
    );
    assertHash(target.attemptGrantTokenHash, "target.attemptGrantTokenHash");
    assertHash(target.domainLeaseTokenHash, "target.domainLeaseTokenHash");
  } else if (target.executionTarget === "provider") {
    assertId(target.invocationId, "target.invocationId");
    assertId(target.succeededObservationId, "target.succeededObservationId");
    assertPositiveInteger(
      target.invocationLeaseGeneration,
      "target.invocationLeaseGeneration",
    );
    assertDigest(target.routeCandidateDigest, "target.routeCandidateDigest");
    assertDigest(target.requestFingerprint, "target.requestFingerprint");
    assertBoundedText(
      target.stableRequestKey,
      "target.stableRequestKey",
      160,
      true,
    );
    if (target.stableRequestKey !== `kanvas:v1:${options.attemptId}`) {
      invalid(
        "target.stableRequestKey does not match the Provider attempt identity.",
      );
    }
    if (target.responseDigest !== undefined) {
      assertDigest(target.responseDigest, "target.responseDigest");
    }
  } else {
    invalid("target.executionTarget is unsupported.");
  }

  if (options.outputs.length > maximumOutputs) {
    invalid(`outputs cannot exceed ${String(maximumOutputs)} entries.`);
  }
  const outputCoordinates = new Set<string>();
  const outputIds = new Set<string>();
  const uploadIds = new Set<string>();
  options.outputs.forEach((output, index) => {
    const label = `outputs[${String(index)}]`;
    assertId(output.uploadSessionId, `${label}.uploadSessionId`);
    assertId(output.storedObjectId, `${label}.storedObjectId`);
    assertId(output.artifactId, `${label}.artifactId`);
    assertId(output.attemptOutputId, `${label}.attemptOutputId`);
    assertBoundedText(output.outputRole, `${label}.outputRole`, 80, true);
    assertOutputIndex(output.outputIndex, `${label}.outputIndex`);
    assertBoundedText(output.artifactType, `${label}.artifactType`, 120);
    canonicalize(output.metadata, `${label}.metadata`);
    const coordinate = `${output.outputRole}\u0000${String(
      output.outputIndex,
    )}`;
    if (outputCoordinates.has(coordinate)) {
      invalid(`${label} duplicates an output role and index.`);
    }
    outputCoordinates.add(coordinate);
    if (uploadIds.has(output.uploadSessionId)) {
      invalid(`${label}.uploadSessionId is duplicated.`);
    }
    uploadIds.add(output.uploadSessionId);
    for (const id of [
      output.storedObjectId,
      output.artifactId,
      output.attemptOutputId,
    ]) {
      if (outputIds.has(id)) {
        invalid(`${label} reuses an output fact ID.`);
      }
      outputIds.add(id);
    }
  });

  if (options.initialUsage.length > maximumInitialUsageEntries) {
    invalid(
      `initialUsage cannot exceed ${String(maximumInitialUsageEntries)} entries.`,
    );
  }
  const usageIds = new Set<string>();
  const usageKeys = new Set<string>();
  const providerInvocationId =
    target.executionTarget === "provider" ? target.invocationId : undefined;
  options.initialUsage.forEach((entry, index) => {
    validateUsageEntry(
      entry,
      index,
      target.executionTarget,
      providerInvocationId,
    );
    if (usageIds.has(entry.id)) {
      invalid(`initialUsage[${String(index)}].id is duplicated.`);
    }
    if (usageKeys.has(entry.entryKey)) {
      invalid(`initialUsage[${String(index)}].entryKey is duplicated.`);
    }
    usageIds.add(entry.id);
    usageKeys.add(entry.entryKey);
    if (entry.observedAt > options.now) {
      invalid(
        `initialUsage[${String(index)}].observedAt cannot be in the future.`,
      );
    }
  });
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
       binding_id AS bindingId,
       implementation_revision_id AS implementationRevisionId,
       lifecycle_status AS lifecycleStatus,
       current_attempt_id AS currentAttemptId,
       accepted_attempt_id AS acceptedAttemptId,
       output,
       cancel_requested_at AS cancelRequestedAt,
       version
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
       capability_run_id AS capabilityRunId,
       binding_id AS bindingId,
       route_candidate_index AS routeCandidateIndex,
       execution_target AS executionTarget,
       implementation_revision_id AS implementationRevisionId,
       lifecycle_status AS lifecycleStatus,
       side_effect_state AS sideEffectState,
       lease_generation AS leaseGeneration,
       lease_token_hash AS leaseTokenHash,
       lease_expires_at AS leaseExpiresAt,
       execution_deadline_at AS executionDeadlineAt,
       cancel_requested_at AS cancelRequestedAt,
       completion_manifest_hash AS completionManifestHash,
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

async function lockCompletion(
  connection: PoolConnection,
  attemptId: string,
): Promise<CompletionRow | undefined> {
  const [rows] = await connection.execute<CompletionRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       capability_run_id AS capabilityRunId,
       capability_attempt_id AS capabilityAttemptId,
       completion_request_key AS completionRequestKey,
       manifest_schema_version AS manifestSchemaVersion,
       completion_manifest_hash AS completionManifestHash,
       output_count AS outputCount,
       initial_usage_entry_count AS initialUsageEntryCount,
       terminal_outbox_event_id AS terminalOutboxEventId,
       completed_at AS completedAt
     FROM attempt_completion
     WHERE capability_attempt_id = ?
     LIMIT 1
     FOR UPDATE`,
    [attemptId],
  );
  return rows[0];
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
  const drainCompletionAllowed =
    runtime?.state === "DRAINING" &&
    runtime.deadline !== null &&
    runtime.deadline > now;
  if (
    !runtime ||
    runtime.executionGeneration !== executionGeneration ||
    (runtime.state !== "ACTIVE" && !drainCompletionAllowed)
  ) {
    fail(
      "attempt_completion.runtime_fenced",
      "The runtime generation or state does not permit completion.",
    );
  }
}

async function loadExecutionContext(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  target: AttemptCompletionTargetIdentity,
  replay: boolean,
): Promise<ExecutionContextRow> {
  const [lifecycleRows] = await connection.execute<PinnedLifecycleRow[]>(
    `SELECT
         binding.workspace_id AS bindingWorkspaceId,
         binding.contract_revision_id AS bindingContractRevisionId,
         binding.lifecycle_status AS bindingLifecycleStatus,
         contract.workspace_id AS contractWorkspaceId,
         contract.canonical_digest AS contractDigest,
         contract.lifecycle_status AS contractLifecycleStatus,
         implementation.id AS implementationRevisionId,
         implementation.workspace_id AS implementationWorkspaceId,
         implementation.execution_target AS implementationExecutionTarget,
         implementation.canonical_digest AS implementationDigest,
         implementation.adapter_key AS implementationAdapterKey,
         implementation.lifecycle_status AS implementationLifecycleStatus
       FROM capability_binding AS binding
       INNER JOIN capability_contract_revision AS contract
         ON contract.id = ?
       INNER JOIN capability_implementation_revision AS implementation
         ON implementation.id = ?
       WHERE binding.id = ?
       LIMIT 1
       FOR SHARE`,
    [
      capability.contractRevisionId,
      attempt.implementationRevisionId,
      attempt.bindingId,
    ],
  );
  const lifecycle = lifecycleRows[0];
  if (
    !lifecycle ||
    lifecycle.bindingWorkspaceId !== capability.workspaceId ||
    lifecycle.bindingContractRevisionId !== capability.contractRevisionId ||
    lifecycle.contractWorkspaceId !== capability.workspaceId ||
    lifecycle.implementationWorkspaceId !== capability.workspaceId ||
    lifecycle.implementationRevisionId !== attempt.implementationRevisionId ||
    lifecycle.implementationRevisionId !== target.implementationRevisionId ||
    lifecycle.implementationExecutionTarget !== target.executionTarget ||
    lifecycle.implementationDigest !== target.implementationDigest ||
    lifecycle.implementationAdapterKey !== target.adapterKey
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Completion does not match the pinned execution identity.",
    );
  }
  if (
    !["active", "disabled"].includes(lifecycle.bindingLifecycleStatus) ||
    !["published", "deprecated"].includes(lifecycle.contractLifecycleStatus) ||
    !["published", "deprecated"].includes(
      lifecycle.implementationLifecycleStatus,
    )
  ) {
    fail(
      "attempt_completion.lifecycle_rejected",
      "A pinned Binding, Contract, or Implementation revision is revoked or invalid.",
    );
  }

  const [rows] = await connection.execute<ExecutionContextRow[]>(
    `SELECT
       source.invocation_kind AS invocationKind,
       node.id AS nodeRunId,
       node.workspace_id AS nodeWorkspaceId,
       node.lifecycle_status AS nodeLifecycleStatus,
       source.input AS nodeInput,
       workspace.organization_id AS organizationId,
       workflow.id AS workflowRunId,
       workflow.workspace_id AS workflowWorkspaceId,
       workflow.lifecycle_status AS workflowLifecycleStatus,
       source.route_snapshot AS routeSnapshot
     FROM capability_run AS source
     LEFT JOIN node_run AS node
       ON node.id = source.node_run_id
      AND node.workspace_id = source.workspace_id
     LEFT JOIN workflow_run AS workflow
       ON workflow.id = node.workflow_run_id
      AND workflow.workspace_id = source.workspace_id
     INNER JOIN workspace
       ON workspace.id = source.workspace_id
     WHERE source.id = ?
     LIMIT 1`,
    [capability.id],
  );
  const context = rows[0];
  if (
    !context ||
    context.invocationKind !== capability.invocationKind ||
    (capability.invocationKind === "workflow"
      ? context.nodeWorkspaceId !== capability.workspaceId ||
        context.workflowWorkspaceId !== capability.workspaceId ||
        context.nodeRunId !== capability.nodeRunId
      : context.nodeWorkspaceId !== null ||
        context.workflowWorkspaceId !== null ||
        context.nodeRunId !== null)
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Completion does not match the pinned execution identity.",
    );
  }
  if (
    !replay &&
    capability.invocationKind === "workflow" &&
    (context.nodeLifecycleStatus !== "running" ||
      context.workflowLifecycleStatus !== "running")
  ) {
    fail(
      "attempt_completion.state_conflict",
      "The parent node or workflow is not running.",
    );
  }
  let route;
  let candidate;
  try {
    route = parsePinnedCapabilityRoute(context.routeSnapshot);
    candidate = findPinnedCandidate(route, attempt.routeCandidateIndex);
  } catch {
    return fail(
      "attempt_completion.identity_conflict",
      "The pinned route candidate is missing.",
    );
  }
  if (
    route.contractRevisionId !== capability.contractRevisionId ||
    route.contractDigest !== lifecycle.contractDigest ||
    candidate.bindingId !== attempt.bindingId ||
    candidate.implementationRevisionId !== attempt.implementationRevisionId ||
    candidate.executionTarget !== target.executionTarget ||
    candidate.implementationDigest !== target.implementationDigest ||
    candidate.adapterKey !== target.adapterKey
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Completion conflicts with the immutable ExecutionPlan binding.",
    );
  }
  return context;
}

function lockWorkerTarget(
  attempt: AttemptRow,
  target: WorkerCompletionIdentity,
  now: Date,
  replay: boolean,
): TargetCompletionFacts {
  if (replay) {
    return { kind: "worker" };
  }
  if (
    attempt.lifecycleStatus !== "running" ||
    attempt.sideEffectState !== "started" ||
    attempt.leaseGeneration !== target.attemptLeaseGeneration ||
    attempt.leaseTokenHash !== target.domainLeaseTokenHash ||
    !attempt.leaseExpiresAt ||
    attempt.leaseExpiresAt <= now ||
    !attempt.executionDeadlineAt ||
    attempt.executionDeadlineAt <= now
  ) {
    fail(
      "attempt_completion.lease_rejected",
      "The Worker attempt lease is not valid for completion.",
    );
  }
  return { kind: "worker" };
}

async function lockBrowserTarget(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  target: BrowserCompletionIdentity,
  executionGeneration: number,
  now: Date,
  replay: boolean,
): Promise<TargetCompletionFacts> {
  const [assignmentRows] = await connection.execute<BrowserAssignmentRow[]>(
    `SELECT
         id,
         workspace_id AS workspaceId,
         browser_executor_session_id AS browserExecutorSessionId,
         capability_attempt_id AS capabilityAttemptId,
         attempt_lease_generation AS attemptLeaseGeneration,
         execution_generation AS executionGeneration,
         attempt_grant_token_hash AS attemptGrantTokenHash,
         state,
         lease_expires_at AS leaseExpiresAt
       FROM browser_attempt_assignment
       WHERE id = ?
         AND capability_attempt_id = ?
       LIMIT 1
       FOR UPDATE`,
    [target.assignmentId, attempt.id],
  );
  const assignment = assignmentRows[0];
  if (
    !assignment ||
    assignment.workspaceId !== capability.workspaceId ||
    assignment.browserExecutorSessionId !== target.sessionId ||
    assignment.capabilityAttemptId !== attempt.id ||
    assignment.attemptLeaseGeneration !== target.attemptLeaseGeneration ||
    assignment.executionGeneration !== executionGeneration ||
    assignment.attemptGrantTokenHash !== target.attemptGrantTokenHash
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "The Browser assignment identity does not match completion.",
    );
  }

  const [sessionRows] = await connection.execute<BrowserSessionRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       state,
       expires_at AS expiresAt
     FROM browser_executor_session
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [assignment.browserExecutorSessionId],
  );
  const session = sessionRows[0];
  if (!session || session.workspaceId !== capability.workspaceId) {
    fail(
      "attempt_completion.identity_conflict",
      "The Browser executor session does not match completion.",
    );
  }
  if (replay) {
    if (assignment.state !== "completed") {
      fail(
        "attempt_completion.state_conflict",
        "The replayed Browser assignment is not completed.",
      );
    }
    return { kind: "browser", assignment, session };
  }
  if (
    attempt.lifecycleStatus !== "running" ||
    !["not_started", "started"].includes(attempt.sideEffectState) ||
    attempt.leaseGeneration !== target.attemptLeaseGeneration ||
    attempt.leaseTokenHash !== target.domainLeaseTokenHash ||
    !attempt.leaseExpiresAt ||
    attempt.leaseExpiresAt <= now ||
    !attempt.executionDeadlineAt ||
    attempt.executionDeadlineAt <= now ||
    !["active", "cancel_requested"].includes(assignment.state) ||
    assignment.leaseExpiresAt <= now ||
    !["active", "draining"].includes(session.state) ||
    session.expiresAt <= now
  ) {
    fail(
      "attempt_completion.lease_rejected",
      "The Browser attempt, assignment, or session lease is not valid.",
    );
  }
  return { kind: "browser", assignment, session };
}

async function lockProviderTarget(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  target: ProviderCompletionIdentity,
  executionGeneration: number,
  now: Date,
  replay: boolean,
): Promise<TargetCompletionFacts> {
  const [invocationRows] = await connection.execute<ProviderInvocationRow[]>(
    `SELECT
         id,
         workspace_id AS workspaceId,
         capability_attempt_id AS capabilityAttemptId,
         implementation_revision_id AS implementationRevisionId,
         pricing_revision_id AS pricingRevisionId,
         route_candidate_digest AS routeCandidateDigest,
         stable_request_key AS stableRequestKey,
         request_fingerprint AS requestFingerprint,
         remote_status AS remoteStatus,
         side_effect_state AS sideEffectState,
         work_state AS workState,
         reconcile_lease_generation AS reconcileLeaseGeneration,
         terminal_at AS terminalAt
       FROM provider_invocation
       WHERE id = ?
         AND capability_attempt_id = ?
       LIMIT 1
       FOR UPDATE`,
    [target.invocationId, attempt.id],
  );
  const invocation = invocationRows[0];
  if (
    !invocation ||
    invocation.workspaceId !== capability.workspaceId ||
    invocation.capabilityAttemptId !== attempt.id ||
    invocation.implementationRevisionId !== target.implementationRevisionId ||
    invocation.routeCandidateDigest !== target.routeCandidateDigest ||
    invocation.requestFingerprint !== target.requestFingerprint ||
    invocation.stableRequestKey !== target.stableRequestKey ||
    invocation.reconcileLeaseGeneration !== target.invocationLeaseGeneration ||
    invocation.remoteStatus !== "succeeded" ||
    invocation.sideEffectState !== "committed" ||
    invocation.workState !== "terminal" ||
    !invocation.terminalAt ||
    invocation.terminalAt > now
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Provider completion requires the exact terminal succeeded invocation.",
    );
  }
  const [observationRows] = await connection.execute<ProviderObservationRow[]>(
    `SELECT
         id,
         workspace_id AS workspaceId,
         provider_invocation_id AS providerInvocationId,
         normalized_status AS normalizedStatus,
         response_digest AS responseDigest,
         execution_generation AS executionGeneration,
         adoption_outcome AS adoptionOutcome,
         recorded_at AS recordedAt
       FROM provider_invocation_observation
       WHERE id = ?
         AND provider_invocation_id = ?
       LIMIT 1
       FOR UPDATE`,
    [target.succeededObservationId, invocation.id],
  );
  const observation = observationRows[0];
  if (
    !observation ||
    observation.workspaceId !== capability.workspaceId ||
    observation.providerInvocationId !== invocation.id ||
    observation.normalizedStatus !== "succeeded" ||
    observation.adoptionOutcome !== "applied" ||
    observation.executionGeneration !== executionGeneration ||
    observation.recordedAt > now ||
    observation.responseDigest !== (target.responseDigest ?? null)
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Provider completion requires the exact adopted succeeded observation.",
    );
  }
  if (
    !replay &&
    (attempt.lifecycleStatus !== "running" ||
      !["unknown", "started", "committed"].includes(attempt.sideEffectState))
  ) {
    fail(
      "attempt_completion.state_conflict",
      "The Provider attempt is not awaiting completion.",
    );
  }
  return { kind: "provider", invocation };
}

async function lockTargetFacts(
  connection: PoolConnection,
  capability: CapabilityRow,
  attempt: AttemptRow,
  options: CompleteAttemptOptions,
  replay: boolean,
): Promise<TargetCompletionFacts> {
  const { target } = options;
  if (
    attempt.executionTarget !== target.executionTarget ||
    attempt.implementationRevisionId !== target.implementationRevisionId
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Attempt target identity does not match completion.",
    );
  }
  if (target.executionTarget === "worker") {
    return lockWorkerTarget(attempt, target, options.now, replay);
  }
  if (target.executionTarget === "browser") {
    return lockBrowserTarget(
      connection,
      capability,
      attempt,
      target,
      options.executionGeneration,
      options.now,
      replay,
    );
  }
  return lockProviderTarget(
    connection,
    capability,
    attempt,
    target,
    options.executionGeneration,
    options.now,
    replay,
  );
}

async function lockUploadSessions(
  connection: PoolConnection,
  options: CompleteAttemptOptions,
  replay: boolean,
): Promise<readonly ResolvedOutput[]> {
  const sorted = [...options.outputs].sort((left, right) =>
    compareCanonicalText(left.uploadSessionId, right.uploadSessionId),
  );
  const [eligibleRows] = await connection.execute<IdentityRow[]>(
    `SELECT id
     FROM upload_session
     WHERE workspace_id = ?
       AND attempt_id = ?
       AND purpose = 'attempt_output'
       AND state IN ('verified', 'committed')
     ORDER BY id
     FOR UPDATE`,
    [options.workspaceId, options.attemptId],
  );
  if (
    eligibleRows.length !== sorted.length ||
    eligibleRows.some((row, index) => row.id !== sorted[index]?.uploadSessionId)
  ) {
    fail(
      "attempt_completion.asset_conflict",
      "The verified UploadSession set does not exactly match the completion outputs.",
    );
  }
  const resolved: ResolvedOutput[] = [];
  for (const request of sorted) {
    const [rows] = await connection.execute<UploadSessionRow[]>(
      `SELECT
         id,
         workspace_id AS workspaceId,
         attempt_id AS attemptId,
         purpose,
         allocation_request_key AS allocationRequestKey,
         output_role AS outputRole,
         output_index AS outputIndex,
         storage_profile_id AS storageProfileId,
         container,
         object_key AS objectKey,
         storage_version_id AS storageVersionId,
         provider_etag AS providerEtag,
         sealed_identity_hash AS sealedIdentityHash,
         state,
         version,
         expires_at AS expiresAt,
         cleanup_state AS cleanupState,
         CAST(verified_size AS CHAR) AS verifiedSize,
         verified_sha256 AS verifiedSha256,
         detected_media_type AS detectedMediaType,
         committed_stored_object_id AS committedStoredObjectId
       FROM upload_session
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [request.uploadSessionId],
    );
    const upload = rows[0];
    if (
      !upload ||
      upload.workspaceId !== options.workspaceId ||
      upload.attemptId !== options.attemptId ||
      upload.purpose !== "attempt_output" ||
      upload.outputRole !== request.outputRole ||
      upload.outputIndex !== request.outputIndex ||
      upload.cleanupState !== "none" ||
      !["verified", "committed"].includes(upload.state) ||
      upload.verifiedSize === null ||
      upload.verifiedSha256 === null ||
      !hashPattern.test(upload.verifiedSha256) ||
      upload.detectedMediaType === null ||
      upload.detectedMediaType.length < 1 ||
      upload.detectedMediaType.length > 160 ||
      (upload.sealedIdentityHash !== null &&
        !digestPattern.test(upload.sealedIdentityHash)) ||
      (upload.allocationRequestKey !== null &&
        upload.sealedIdentityHash === null) ||
      (upload.storageVersionId !== null &&
        (upload.storageVersionId.length < 1 ||
          upload.storageVersionId.length > 240)) ||
      (upload.providerEtag !== null &&
        (upload.providerEtag.length < 1 || upload.providerEtag.length > 240)) ||
      (upload.state === "verified" &&
        (replay ||
          upload.expiresAt <= options.now ||
          upload.committedStoredObjectId !== null)) ||
      (upload.state === "committed" &&
        !replay &&
        upload.committedStoredObjectId !== request.storedObjectId)
    ) {
      fail(
        "attempt_completion.asset_conflict",
        `Upload session ${request.uploadSessionId} is not a verified output for this attempt.`,
      );
    }
    normalizeUnsignedBigInt(
      upload.verifiedSize,
      `Upload session ${upload.id} verified_size`,
    );
    let storedObject: StoredObjectRow | null = null;
    if (upload.state === "committed") {
      const storedObjectId = replay
        ? upload.committedStoredObjectId
        : request.storedObjectId;
      if (!storedObjectId) {
        fail(
          "attempt_completion.asset_conflict",
          `Committed upload ${upload.id} has no StoredObject identity.`,
        );
      }
      const [storedRows] = await connection.execute<StoredObjectRow[]>(
        `SELECT
             id,
             workspace_id AS workspaceId,
             created_from_upload_session_id AS createdFromUploadSessionId,
             storage_profile_id AS storageProfileId,
             container,
             object_key AS objectKey,
             storage_version_id AS storageVersionId,
             provider_etag AS providerEtag,
             immutable_identity_hash AS immutableIdentityHash,
             CAST(byte_size AS CHAR) AS byteSize,
             sha256,
             media_type AS mediaType,
             delete_state AS deleteState
           FROM stored_object
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
        [storedObjectId],
      );
      storedObject = storedRows[0] ?? null;
      if (
        !storedObject ||
        storedObject.workspaceId !== upload.workspaceId ||
        storedObject.createdFromUploadSessionId !== upload.id ||
        storedObject.storageProfileId !== upload.storageProfileId ||
        storedObject.container !== upload.container ||
        storedObject.objectKey !== upload.objectKey ||
        storedObject.storageVersionId !== upload.storageVersionId ||
        storedObject.providerEtag !== upload.providerEtag ||
        (storedObject.immutableIdentityHash !== null &&
          !digestPattern.test(storedObject.immutableIdentityHash)) ||
        storedObject.immutableIdentityHash !== upload.sealedIdentityHash ||
        storedObject.byteSize !== upload.verifiedSize ||
        storedObject.sha256 !== upload.verifiedSha256 ||
        storedObject.mediaType !== upload.detectedMediaType ||
        storedObject.deleteState !== "active"
      ) {
        fail(
          "attempt_completion.asset_conflict",
          `Committed upload ${upload.id} has inconsistent object facts.`,
        );
      }
    }
    resolved.push({ request, upload, storedObject });
  }
  return resolved;
}

async function assertAttemptOutputSet(
  connection: PoolConnection,
  options: CompleteAttemptOptions,
  persistedOutputs?: readonly CompletedAttemptOutput[],
): Promise<void> {
  const [rows] = await connection.execute<AttemptOutputRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       capability_attempt_id AS capabilityAttemptId,
       output_role AS outputRole,
       output_index AS outputIndex,
       artifact_id AS artifactId
     FROM attempt_output
     WHERE capability_attempt_id = ?
     ORDER BY output_role, output_index, id
     FOR UPDATE`,
    [options.attemptId],
  );
  const expected = [...options.outputs].sort((left, right) => {
    const role = compareCanonicalText(left.outputRole, right.outputRole);
    return role !== 0 ? role : left.outputIndex - right.outputIndex;
  });
  if (
    rows.length !== expected.length ||
    rows.some((row, index) => {
      const output = expected[index];
      const persisted = persistedOutputs?.find(
        (candidate) =>
          candidate.outputRole === row.outputRole &&
          candidate.outputIndex === row.outputIndex,
      );
      return (
        !output ||
        row.workspaceId !== options.workspaceId ||
        row.capabilityAttemptId !== options.attemptId ||
        row.outputRole !== output.outputRole ||
        row.outputIndex !== output.outputIndex ||
        (persistedOutputs
          ? !persisted ||
            row.id !== persisted.attemptOutputId ||
            row.artifactId !== persisted.artifactId
          : row.id !== output.attemptOutputId ||
            row.artifactId !== output.artifactId)
      );
    })
  ) {
    fail(
      "attempt_completion.asset_conflict",
      "The persisted AttemptOutput set does not exactly match completion.",
    );
  }
}

function targetManifestIdentity(
  target: AttemptCompletionTargetIdentity,
): Readonly<Record<string, unknown>> {
  const common = {
    executionTarget: target.executionTarget,
    implementationRevisionId: target.implementationRevisionId,
    implementationDigest: target.implementationDigest,
    adapterKey: target.adapterKey,
  };
  if (target.executionTarget === "worker") {
    return {
      ...common,
      attemptLeaseGeneration: target.attemptLeaseGeneration,
    };
  }
  if (target.executionTarget === "browser") {
    return {
      ...common,
      assignmentId: target.assignmentId,
      sessionId: target.sessionId,
      attemptLeaseGeneration: target.attemptLeaseGeneration,
    };
  }
  return {
    ...common,
    invocationId: target.invocationId,
    succeededObservationId: target.succeededObservationId,
    invocationLeaseGeneration: target.invocationLeaseGeneration,
    routeCandidateDigest: target.routeCandidateDigest,
    requestFingerprint: target.requestFingerprint,
    stableRequestKey: target.stableRequestKey,
    responseDigest: target.responseDigest ?? null,
  };
}

function usageManifestEntry(
  entry: InitialUsageEntry,
): Readonly<Record<string, unknown>> {
  return {
    entryKey: entry.entryKey,
    metricKey: entry.metricKey,
    valueDimension: entry.valueDimension,
    unitCode: entry.valueDimension === "quantity" ? entry.unitCode : null,
    numericValue:
      entry.entryKind === "observation"
        ? normalizeUnsignedDecimal(
            entry.numericValue,
            `initialUsage.${entry.entryKey}.numericValue`,
          )
        : null,
    currencyCode: entry.valueDimension === "money" ? entry.currencyCode : null,
    entryKind: entry.entryKind,
    sourceKind: entry.sourceKind,
    providerInvocationId: entry.providerInvocationId ?? null,
    pricingRevisionId: entry.pricingRevisionId ?? null,
    evidenceDigest: entry.evidenceDigest,
    observedAt: entry.observedAt.toISOString(),
  };
}

function manifestByteSize(
  verifiedSize: string,
  uploadSessionId: string,
): string {
  return normalizeUnsignedBigInt(
    verifiedSize,
    `UploadSession ${uploadSessionId} verifiedSize`,
  );
}

function buildManifest(
  options: CompleteAttemptOptions,
  outputs: readonly ResolvedOutput[],
): CompletionManifest {
  return {
    schemaVersion: manifestSchemaVersion,
    completionRequestKey: completionRequestKeyForUnchecked(options.attemptId),
    workspaceId: options.workspaceId,
    capabilityRunId: options.capabilityRunId,
    attemptId: options.attemptId,
    executionGeneration: options.executionGeneration,
    target: targetManifestIdentity(options.target),
    capabilityOutput: options.capabilityOutput,
    outputs: outputs
      .map(({ request, upload }) => ({
        uploadSessionId: request.uploadSessionId,
        outputRole: request.outputRole,
        outputIndex: request.outputIndex,
        artifactType: request.artifactType,
        metadata: request.metadata,
        byteSize: manifestByteSize(upload.verifiedSize ?? "", upload.id),
        sha256: upload.verifiedSha256,
        mediaType: upload.detectedMediaType,
        storageVersionId: upload.storageVersionId,
        providerEtag: upload.providerEtag,
        sealedIdentityHash: upload.sealedIdentityHash,
      }))
      .sort((left, right) => {
        const leftRole = String(left.outputRole);
        const rightRole = String(right.outputRole);
        const role = compareCanonicalText(leftRole, rightRole);
        return role !== 0
          ? role
          : Number(left.outputIndex) - Number(right.outputIndex);
      }),
    initialUsage: options.initialUsage
      .map(usageManifestEntry)
      .sort((left, right) => {
        const leftKey = String(left.entryKey);
        const rightKey = String(right.entryKey);
        return compareCanonicalText(leftKey, rightKey);
      }),
  };
}

export function buildAtomicAttemptCompletionManifestForTest(
  options: CompleteAttemptOptions,
  outputFacts: readonly {
    readonly uploadSessionId: string;
    readonly verifiedSize: string;
    readonly verifiedSha256: string;
    readonly detectedMediaType: string;
    readonly storageVersionId?: string | null;
    readonly providerEtag?: string | null;
    readonly sealedIdentityHash?: string | null;
  }[],
): {
  readonly manifest: unknown;
  readonly digest: string;
} {
  validateOptions(options);
  const byUploadId = new Map(
    outputFacts.map((fact) => [fact.uploadSessionId, fact]),
  );
  const resolved = options.outputs.map((request) => {
    const fact = byUploadId.get(request.uploadSessionId);
    if (!fact) {
      invalid(`Missing output facts for ${request.uploadSessionId}.`);
    }
    if (
      !hashPattern.test(fact.verifiedSha256) ||
      fact.detectedMediaType.length < 1
    ) {
      invalid(`Output facts for ${request.uploadSessionId} are invalid.`);
    }
    normalizeUnsignedBigInt(
      fact.verifiedSize,
      `Output facts for ${request.uploadSessionId} verifiedSize`,
    );
    return {
      request,
      upload: {
        id: request.uploadSessionId,
        workspaceId: options.workspaceId,
        attemptId: options.attemptId,
        purpose: "attempt_output",
        allocationRequestKey: null,
        outputRole: request.outputRole,
        outputIndex: request.outputIndex,
        storageProfileId: options.attemptId,
        container: "manifest-only",
        objectKey: request.uploadSessionId,
        storageVersionId: fact.storageVersionId ?? null,
        providerEtag: fact.providerEtag ?? null,
        sealedIdentityHash: fact.sealedIdentityHash ?? null,
        state: "verified",
        version: 1,
        expiresAt: new Date(options.now.getTime() + 1),
        cleanupState: "none",
        verifiedSize: fact.verifiedSize,
        verifiedSha256: fact.verifiedSha256,
        detectedMediaType: fact.detectedMediaType,
        committedStoredObjectId: null,
      } as unknown as UploadSessionRow,
      storedObject: null,
    } satisfies ResolvedOutput;
  });
  const manifest = buildManifest(options, resolved);
  return {
    manifest,
    digest: canonicalDigest(manifest),
  };
}

async function ensureStoredObject(
  connection: PoolConnection,
  resolved: ResolvedOutput,
  now: Date,
): Promise<void> {
  const { request, upload } = resolved;
  if (resolved.storedObject) {
    return;
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO stored_object (
       id,
       workspace_id,
       created_from_upload_session_id,
       storage_profile_id,
       container,
       object_key,
       storage_version_id,
       provider_etag,
       immutable_identity_hash,
       byte_size,
       sha256,
       media_type,
       delete_state,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      request.storedObjectId,
      upload.workspaceId,
      upload.id,
      upload.storageProfileId,
      upload.container,
      upload.objectKey,
      upload.storageVersionId,
      upload.providerEtag,
      upload.sealedIdentityHash,
      upload.verifiedSize,
      upload.verifiedSha256,
      upload.detectedMediaType,
      now,
    ],
  );
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE upload_session
     SET state = 'committed',
         committed_stored_object_id = ?,
         committed_at = ?,
         version = version + 1,
         updated_at = ?
     WHERE id = ?
       AND workspace_id = ?
       AND attempt_id = ?
       AND version = ?
       AND state = 'verified'
       AND cleanup_state = 'none'
       AND expires_at > ?
       AND committed_stored_object_id IS NULL`,
    [
      request.storedObjectId,
      now,
      now,
      upload.id,
      upload.workspaceId,
      upload.attemptId,
      upload.version,
      now,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "attempt_completion.asset_conflict",
      `Upload session ${upload.id} changed before commit.`,
    );
  }
}

async function ensureArtifact(
  connection: PoolConnection,
  resolved: ResolvedOutput,
  options: CompleteAttemptOptions,
): Promise<void> {
  const { request } = resolved;
  const [artifactRows] = await connection.execute<ArtifactRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       stored_object_id AS storedObjectId,
       created_by_capability_run_id AS createdByCapabilityRunId,
       content_digest AS contentDigest,
       artifact_type AS artifactType,
       metadata
     FROM artifact
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [request.artifactId],
  );
  const artifact = artifactRows[0];
  if (artifact) {
    if (
      artifact.workspaceId !== options.workspaceId ||
      artifact.storedObjectId !== request.storedObjectId ||
      artifact.createdByCapabilityRunId !== options.capabilityRunId ||
      artifact.contentDigest !== `sha256:${resolved.upload.verifiedSha256}` ||
      artifact.artifactType !== request.artifactType ||
      canonicalize(parseJson(artifact.metadata)) !==
        canonicalize(request.metadata)
    ) {
      fail(
        "attempt_completion.asset_conflict",
        `Artifact ${request.artifactId} conflicts with completion.`,
      );
    }
  } else {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO artifact (
         id,
         workspace_id,
         created_by_capability_run_id,
         stored_object_id,
         content_digest,
         artifact_type,
         metadata,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.artifactId,
        options.workspaceId,
        options.capabilityRunId,
        request.storedObjectId,
        `sha256:${resolved.upload.verifiedSha256}`,
        request.artifactType,
        canonicalize(request.metadata),
        options.now,
      ],
    );
  }

  const [outputRows] = await connection.execute<AttemptOutputRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       capability_attempt_id AS capabilityAttemptId,
       output_role AS outputRole,
       output_index AS outputIndex,
       artifact_id AS artifactId
     FROM attempt_output
     WHERE id = ?
       OR (
         capability_attempt_id = ?
         AND output_role = ?
         AND output_index = ?
       )
     ORDER BY id
     FOR UPDATE`,
    [
      request.attemptOutputId,
      options.attemptId,
      request.outputRole,
      request.outputIndex,
    ],
  );
  if (outputRows.length > 0) {
    const output = outputRows[0];
    if (
      outputRows.length !== 1 ||
      !output ||
      output.id !== request.attemptOutputId ||
      output.workspaceId !== options.workspaceId ||
      output.capabilityAttemptId !== options.attemptId ||
      output.outputRole !== request.outputRole ||
      output.outputIndex !== request.outputIndex ||
      output.artifactId !== request.artifactId
    ) {
      fail(
        "attempt_completion.asset_conflict",
        `Attempt output ${request.outputRole}:${String(request.outputIndex)} conflicts with completion.`,
      );
    }
  } else {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO attempt_output (
         id,
         workspace_id,
         capability_attempt_id,
         output_role,
         output_index,
         artifact_id,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        request.attemptOutputId,
        options.workspaceId,
        options.attemptId,
        request.outputRole,
        request.outputIndex,
        request.artifactId,
        options.now,
      ],
    );
  }
}

export function capabilityInputContainsArtifactId(
  input: unknown,
  artifactId: string,
): boolean {
  const active = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > 10_000 || depth > 64) {
      fail(
        "attempt_completion.identity_conflict",
        "Authoritative Capability input exceeds lineage validation bounds.",
      );
    }
    if (value === artifactId) {
      return true;
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    if (active.has(value)) {
      fail(
        "attempt_completion.identity_conflict",
        "Authoritative Capability input contains a cycle.",
      );
    }
    active.add(value);
    try {
      return Array.isArray(value)
        ? value.some((item) => visit(item, depth + 1))
        : Object.values(value as Readonly<Record<string, unknown>>).some(
            (item) => visit(item, depth + 1),
          );
    } finally {
      active.delete(value);
    }
  };
  return visit(input, 0);
}

async function ensureDerivedFromLineage(
  connection: PoolConnection,
  resolved: ResolvedOutput,
  options: CompleteAttemptOptions,
  context: ExecutionContextRow,
): Promise<void> {
  const sourceArtifactId = resolved.request.metadata.sourceArtifactId;
  if (sourceArtifactId === undefined) {
    return;
  }
  if (
    typeof sourceArtifactId !== "string" ||
    !capabilityInputContainsArtifactId(context.nodeInput, sourceArtifactId)
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Output lineage must reference an Artifact pinned in the authoritative Capability input.",
    );
  }
  const [sourceRows] = await connection.execute<ArtifactLineageSourceRow[]>(
    `SELECT
         id,
         workspace_id AS workspaceId,
         availability_status AS availabilityStatus
       FROM artifact
       WHERE id = ?
         AND workspace_id = ?
       LIMIT 1
       FOR SHARE`,
    [sourceArtifactId, options.workspaceId],
  );
  const source = sourceRows[0];
  if (
    !source ||
    source.workspaceId !== options.workspaceId ||
    source.availabilityStatus !== "available"
  ) {
    fail(
      "attempt_completion.asset_conflict",
      "Output lineage source Artifact is unavailable.",
    );
  }
  const edgeId = resolved.request.artifactId;
  const [edgeRows] = await connection.execute<ArtifactEdgeRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       source_artifact_id AS sourceArtifactId,
       target_artifact_id AS targetArtifactId,
       relation
     FROM artifact_edge
     WHERE id = ?
        OR (
          source_artifact_id = ?
          AND target_artifact_id = ?
          AND relation = 'derived_from'
        )
     ORDER BY id
     FOR UPDATE`,
    [edgeId, sourceArtifactId, resolved.request.artifactId],
  );
  if (edgeRows.length > 0) {
    const edge = edgeRows[0];
    if (
      edgeRows.length !== 1 ||
      !edge ||
      edge.id !== edgeId ||
      edge.workspaceId !== options.workspaceId ||
      edge.sourceArtifactId !== sourceArtifactId ||
      edge.targetArtifactId !== resolved.request.artifactId ||
      edge.relation !== "derived_from"
    ) {
      fail(
        "attempt_completion.asset_conflict",
        "Output Artifact lineage conflicts with an existing edge.",
      );
    }
    return;
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO artifact_edge (
       id,
       workspace_id,
       source_artifact_id,
       target_artifact_id,
       relation,
       created_by_principal_id,
       created_at
     ) VALUES (?, ?, ?, ?, 'derived_from', NULL, ?)`,
    [
      edgeId,
      options.workspaceId,
      sourceArtifactId,
      resolved.request.artifactId,
      options.now,
    ],
  );
}

async function verifyReplayOutputs(
  connection: PoolConnection,
  outputs: readonly ResolvedOutput[],
  options: CompleteAttemptOptions,
): Promise<readonly CompletedAttemptOutput[]> {
  const persisted: CompletedAttemptOutput[] = [];
  for (const resolved of outputs) {
    const { request } = resolved;
    const storedObject = resolved.storedObject;
    if (!storedObject) {
      fail(
        "attempt_completion.asset_conflict",
        "A replayed completion references an uncommitted upload.",
      );
    }
    const [outputRows] = await connection.execute<AttemptOutputRow[]>(
      `SELECT
           id,
           workspace_id AS workspaceId,
           capability_attempt_id AS capabilityAttemptId,
           output_role AS outputRole,
           output_index AS outputIndex,
           artifact_id AS artifactId
         FROM attempt_output
         WHERE capability_attempt_id = ?
           AND output_role = ?
           AND output_index = ?
         LIMIT 1
         FOR UPDATE`,
      [options.attemptId, request.outputRole, request.outputIndex],
    );
    const output = outputRows[0];
    if (
      !output ||
      output.workspaceId !== options.workspaceId ||
      output.capabilityAttemptId !== options.attemptId ||
      output.outputRole !== request.outputRole ||
      output.outputIndex !== request.outputIndex
    ) {
      fail(
        "attempt_completion.asset_conflict",
        `Stored AttemptOutput ${request.outputRole}:${String(request.outputIndex)} is inconsistent.`,
      );
    }
    const [artifactRows] = await connection.execute<ArtifactRow[]>(
      `SELECT
         id,
         workspace_id AS workspaceId,
         stored_object_id AS storedObjectId,
         artifact_type AS artifactType,
         metadata
       FROM artifact
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [output.artifactId],
    );
    const artifact = artifactRows[0];
    if (
      !artifact ||
      artifact.workspaceId !== options.workspaceId ||
      artifact.storedObjectId !== storedObject.id ||
      artifact.artifactType !== request.artifactType ||
      canonicalize(parseJson(artifact.metadata)) !==
        canonicalize(request.metadata)
    ) {
      fail(
        "attempt_completion.asset_conflict",
        `Stored Artifact for ${request.outputRole}:${String(request.outputIndex)} is inconsistent.`,
      );
    }
    persisted.push(
      Object.freeze({
        uploadSessionId: resolved.upload.id,
        storedObjectId: storedObject.id,
        artifactId: artifact.id,
        attemptOutputId: output.id,
        outputRole: output.outputRole,
        outputIndex: output.outputIndex,
      }),
    );
  }
  return Object.freeze(persisted);
}

async function verifyReplayUsage(
  connection: PoolConnection,
  completion: CompletionRow,
  options: CompleteAttemptOptions,
): Promise<void> {
  const [rows] = await connection.execute<InitialUsageRow[]>(
    `SELECT
       entry_key AS entryKey,
       metric_key AS metricKey,
       value_dimension AS valueDimension,
       unit_code AS unitCode,
       numeric_value AS numericValue,
       currency_code AS currencyCode,
       entry_kind AS entryKind,
       recording_phase AS recordingPhase,
       source_kind AS sourceKind,
       corrects_usage_entry_id AS correctsUsageEntryId,
       provider_invocation_id AS providerInvocationId,
       pricing_revision_id AS pricingRevisionId,
       evidence_digest AS evidenceDigest,
       observed_at AS observedAt
     FROM usage_ledger_entry
     WHERE attempt_completion_id = ?
     ORDER BY entry_key
     FOR UPDATE`,
    [completion.id],
  );
  const expected = [...options.initialUsage].sort((left, right) =>
    compareCanonicalText(left.entryKey, right.entryKey),
  );
  if (rows.length !== expected.length) {
    fail(
      "attempt_completion.identity_conflict",
      "Stored initial Usage count is inconsistent.",
    );
  }
  rows.forEach((row, index) => {
    const entry = expected[index];
    if (!entry) {
      fail(
        "attempt_completion.identity_conflict",
        "Stored initial Usage is inconsistent.",
      );
    }
    const numericValue =
      entry.entryKind === "observation"
        ? normalizeUnsignedDecimal(
            entry.numericValue,
            `initialUsage.${entry.entryKey}.numericValue`,
          )
        : null;
    if (
      row.entryKey !== entry.entryKey ||
      row.metricKey !== entry.metricKey ||
      row.valueDimension !== entry.valueDimension ||
      row.unitCode !==
        (entry.valueDimension === "quantity" ? entry.unitCode : null) ||
      (row.numericValue === null
        ? null
        : normalizeUnsignedDecimal(
            row.numericValue,
            `storedUsage.${row.entryKey}.numericValue`,
          )) !== numericValue ||
      row.currencyCode !==
        (entry.valueDimension === "money" ? entry.currencyCode : null) ||
      row.entryKind !== entry.entryKind ||
      row.recordingPhase !== "completion" ||
      row.sourceKind !== entry.sourceKind ||
      row.correctsUsageEntryId !== null ||
      row.providerInvocationId !== (entry.providerInvocationId ?? null) ||
      row.pricingRevisionId !== (entry.pricingRevisionId ?? null) ||
      row.evidenceDigest !== entry.evidenceDigest ||
      row.observedAt.getTime() !== entry.observedAt.getTime()
    ) {
      fail(
        "attempt_completion.identity_conflict",
        `Stored initial Usage ${entry.entryKey} is inconsistent.`,
      );
    }
  });
}

function verifyProviderUsagePricing(
  usage: readonly InitialUsageEntry[],
  targetFacts: TargetCompletionFacts,
): void {
  if (targetFacts.kind !== "provider") {
    return;
  }
  for (const entry of usage) {
    if (
      entry.pricingRevisionId !== undefined &&
      entry.pricingRevisionId !== targetFacts.invocation.pricingRevisionId
    ) {
      fail(
        "attempt_completion.identity_conflict",
        `Usage entry ${entry.entryKey} does not match the pinned Provider pricing revision.`,
      );
    }
  }
}

function assertInitialState(
  capability: CapabilityRow,
  attempt: AttemptRow,
  options: CompleteAttemptOptions,
): void {
  if (
    capability.workspaceId !== options.workspaceId ||
    attempt.workspaceId !== options.workspaceId ||
    capability.currentAttemptId !== attempt.id ||
    capability.acceptedAttemptId !== null ||
    capability.lifecycleStatus !== "running" ||
    attempt.lifecycleStatus !== "running" ||
    capability.cancelRequestedAt !== null ||
    attempt.cancelRequestedAt !== null
  ) {
    fail(
      "attempt_completion.state_conflict",
      "Attempt is no longer the current non-cancelled completion candidate.",
    );
  }
}

function verifyReplay(
  completion: CompletionRow,
  capability: CapabilityRow,
  attempt: AttemptRow,
  options: CompleteAttemptOptions,
  manifestSchemaVersion: AttemptCompletionManifestSchemaVersion,
  manifestHash: string,
): Omit<AtomicAttemptCompletionResult, "outputs"> {
  if (
    completion.workspaceId !== options.workspaceId ||
    completion.capabilityRunId !== options.capabilityRunId ||
    completion.capabilityAttemptId !== options.attemptId ||
    completion.completionRequestKey !== options.attemptId ||
    completion.manifestSchemaVersion !== manifestSchemaVersion ||
    completion.outputCount !== options.outputs.length ||
    completion.initialUsageEntryCount !== options.initialUsage.length ||
    capability.lifecycleStatus !== "completed" ||
    capability.acceptedAttemptId !== options.attemptId ||
    attempt.lifecycleStatus !== "completed" ||
    attempt.sideEffectState !== "committed" ||
    attempt.completionManifestHash !== completion.completionManifestHash
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Stored completion facts are inconsistent.",
    );
  }
  if (
    completion.completionManifestHash !== manifestHash ||
    canonicalize(parseJson(capability.output)) !==
      canonicalize(options.capabilityOutput)
  ) {
    fail(
      "attempt_completion.manifest_conflict",
      "This attempt was completed with a different manifest.",
    );
  }
  return Object.freeze({
    status: "replayed",
    completionId: completion.id,
    completionRequestKey: completionRequestKeyForUnchecked(options.attemptId),
    completionManifestHash: completion.completionManifestHash,
    manifestSchemaVersion,
    terminalOutboxEventId: completion.terminalOutboxEventId,
    completedAt: completion.completedAt,
  });
}

async function completeBrowserAssignment(
  connection: PoolConnection,
  target: BrowserCompletionIdentity,
  options: CompleteAttemptOptions,
): Promise<void> {
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE browser_attempt_assignment
     SET state = 'completed',
         stable_reason_code = NULL,
         terminal_at = ?,
         updated_at = ?
     WHERE id = ?
       AND workspace_id = ?
       AND browser_executor_session_id = ?
       AND capability_attempt_id = ?
       AND attempt_lease_generation = ?
       AND execution_generation = ?
       AND attempt_grant_token_hash = ?
       AND state IN ('active', 'cancel_requested')
       AND lease_expires_at > ?`,
    [
      options.now,
      options.now,
      target.assignmentId,
      options.workspaceId,
      target.sessionId,
      options.attemptId,
      target.attemptLeaseGeneration,
      options.executionGeneration,
      target.attemptGrantTokenHash,
      options.now,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "attempt_completion.state_conflict",
      "Browser assignment changed before completion.",
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
     ) VALUES (?, ?, ?, ?, 'completed', ?, ?, NULL, ?, ?)`,
    [
      target.completedAssignmentEventId,
      options.workspaceId,
      target.assignmentId,
      `completed:${String(
        target.attemptLeaseGeneration,
      )}:${String(options.executionGeneration)}`,
      target.attemptLeaseGeneration,
      options.executionGeneration,
      options.now,
      options.now,
    ],
  );
}

async function insertInitialUsage(
  connection: PoolConnection,
  completionId: string,
  options: CompleteAttemptOptions,
): Promise<void> {
  const sorted = [...options.initialUsage].sort((left, right) =>
    compareCanonicalText(left.entryKey, right.entryKey),
  );
  for (const entry of sorted) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_ledger_entry (
         id,
         workspace_id,
         capability_attempt_id,
         attempt_completion_id,
         entry_key,
         metric_key,
         value_dimension,
         unit_code,
         numeric_value,
         currency_code,
         entry_kind,
         recording_phase,
         source_kind,
         corrects_usage_entry_id,
         provider_invocation_id,
         pricing_revision_id,
         evidence_digest,
         observed_at,
         recorded_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completion', ?, NULL, ?, ?, ?, ?, ?
       )`,
      [
        entry.id,
        options.workspaceId,
        options.attemptId,
        completionId,
        entry.entryKey,
        entry.metricKey,
        entry.valueDimension,
        entry.valueDimension === "quantity" ? entry.unitCode : null,
        entry.entryKind === "observation"
          ? normalizeUnsignedDecimal(
              entry.numericValue,
              `initialUsage.${entry.entryKey}.numericValue`,
            )
          : null,
        entry.valueDimension === "money" ? entry.currencyCode : null,
        entry.entryKind,
        entry.sourceKind,
        entry.providerInvocationId ?? null,
        entry.pricingRevisionId ?? null,
        entry.evidenceDigest,
        entry.observedAt,
        options.now,
      ],
    );
  }
}

/**
 * Executes Atomic Complete on an existing transaction. Provider observation
 * adoption can call this after transitioning its invocation to terminal
 * succeeded in the same transaction, avoiding a crash window in which the
 * normalized Provider output exists only in process memory.
 */
export async function completeAttemptInTransaction(
  connection: PoolConnection,
  instanceId: string,
  options: CompleteAttemptOptions,
): Promise<AtomicAttemptCompletionResult> {
  validateOptions(options);
  const capability = await lockCapability(connection, options.capabilityRunId);
  if (!capability) {
    fail(
      "attempt_completion.identity_conflict",
      "Capability run does not exist.",
    );
  }
  const attempt = await lockAttempt(
    connection,
    options.capabilityRunId,
    options.attemptId,
  );
  if (
    !attempt ||
    capability.workspaceId !== options.workspaceId ||
    attempt.workspaceId !== options.workspaceId
  ) {
    fail(
      "attempt_completion.identity_conflict",
      "Attempt does not belong to the requested capability and workspace.",
    );
  }

  const existingCompletion = await lockCompletion(
    connection,
    options.attemptId,
  );

  if (existingCompletion) {
    const manifestSchemaVersion = assertSupportedManifestSchemaVersion(
      existingCompletion.manifestSchemaVersion,
    );
    const replayOutputs = await lockUploadSessions(connection, options, true);
    const replayManifest = buildManifest(options, replayOutputs);
    const replayManifestHash = canonicalDigest(replayManifest);
    const result = verifyReplay(
      existingCompletion,
      capability,
      attempt,
      options,
      manifestSchemaVersion,
      replayManifestHash,
    );
    const persistedOutputs = await verifyReplayOutputs(
      connection,
      replayOutputs,
      options,
    );
    await assertAttemptOutputSet(connection, options, persistedOutputs);
    await verifyReplayUsage(connection, existingCompletion, options);
    return Object.freeze({
      ...result,
      outputs: persistedOutputs,
    });
  }

  await lockRuntimeFence(
    connection,
    instanceId,
    options.executionGeneration,
    options.now,
  );
  const targetFacts = await lockTargetFacts(
    connection,
    capability,
    attempt,
    options,
    false,
  );
  const context = await loadExecutionContext(
    connection,
    capability,
    attempt,
    options.target,
    false,
  );
  verifyProviderUsagePricing(options.initialUsage, targetFacts);
  const outputs = await lockUploadSessions(connection, options, false);
  const manifest = buildManifest(options, outputs);
  const manifestHash = canonicalDigest(manifest);
  assertInitialState(capability, attempt, options);
  for (const output of outputs) {
    await ensureStoredObject(connection, output, options.now);
    await ensureArtifact(connection, output, options);
    await ensureDerivedFromLineage(connection, output, options, context);
  }
  await assertAttemptOutputSet(connection, options);

  if (options.target.executionTarget === "browser") {
    await completeBrowserAssignment(connection, options.target, options);
  }

  const [attemptUpdate] = await connection.execute<ResultSetHeader>(
    `UPDATE capability_attempt
     SET lifecycle_status = 'completed',
         side_effect_state = 'committed',
         retry_disposition = 'terminal',
         lease_token_hash = NULL,
         lease_expires_at = NULL,
         completion_manifest_hash = ?,
         error = NULL,
         version = version + 1,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND workspace_id = ?
       AND capability_run_id = ?
       AND binding_id = ?
       AND implementation_revision_id = ?
       AND execution_target = ?
       AND version = ?
       AND lifecycle_status = 'running'
       AND cancel_requested_at IS NULL`,
    [
      manifestHash,
      options.now,
      options.now,
      attempt.id,
      options.workspaceId,
      capability.id,
      attempt.bindingId,
      options.target.implementationRevisionId,
      options.target.executionTarget,
      attempt.version,
    ],
  );
  if (attemptUpdate.affectedRows !== 1) {
    fail(
      "attempt_completion.state_conflict",
      "Attempt changed before atomic completion.",
    );
  }

  const nextCapabilityVersion = capability.version + 1;
  const [capabilityUpdate] = await connection.execute<ResultSetHeader>(
    `UPDATE capability_run
       SET lifecycle_status = 'completed',
           accepted_attempt_id = ?,
           output = ?,
           version = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?
         AND workspace_id = ?
         AND version = ?
         AND lifecycle_status = 'running'
         AND current_attempt_id = ?
         AND accepted_attempt_id IS NULL
         AND cancel_requested_at IS NULL`,
    [
      attempt.id,
      canonicalize(options.capabilityOutput),
      nextCapabilityVersion,
      options.now,
      options.now,
      capability.id,
      options.workspaceId,
      capability.version,
      attempt.id,
    ],
  );
  if (capabilityUpdate.affectedRows !== 1) {
    fail(
      "attempt_completion.state_conflict",
      "Capability changed before atomic completion.",
    );
  }

  await connection.execute<ResultSetHeader>(
    `INSERT INTO outbox_event (
       id,
       workspace_id,
       message_type,
       schema_version,
       aggregate_type,
       aggregate_id,
       aggregate_version,
       payload,
       status,
       available_at,
       lease_token_hash,
       lease_expires_at,
       publish_attempts,
       published_at,
       last_error_code,
       quarantined_at,
       superseded_at,
       created_at
     ) VALUES (
       ?, ?, 'capability.run.completed', 1, 'capability_run', ?, ?, ?,
       'pending', ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?
     )`,
    [
      options.terminalOutboxEventId,
      options.workspaceId,
      capability.id,
      nextCapabilityVersion,
      canonicalize({
        ...(context.invocationKind === "workflow"
          ? {
              workflowRunId: context.workflowRunId,
              nodeRunId: context.nodeRunId,
            }
          : { invocationKind: context.invocationKind }),
        capabilityRunId: capability.id,
        attemptId: attempt.id,
        completionId: options.completionId,
        completionManifestHash: manifestHash,
        expectedGeneration: options.executionGeneration,
      }),
      options.now,
      options.now,
    ],
  );
  await connection.execute<ResultSetHeader>(
    `INSERT INTO attempt_completion (
       id,
       workspace_id,
       capability_run_id,
       capability_attempt_id,
       completion_request_key,
       manifest_schema_version,
       completion_manifest_hash,
       output_count,
       initial_usage_entry_count,
       terminal_outbox_event_id,
       completed_at,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.completionId,
      options.workspaceId,
      capability.id,
      attempt.id,
      // Persist the constrained attempt identity; the API returns its versioned key.
      attempt.id,
      manifestSchemaVersion,
      manifestHash,
      options.outputs.length,
      options.initialUsage.length,
      options.terminalOutboxEventId,
      options.now,
      options.now,
    ],
  );
  await insertInitialUsage(connection, options.completionId, options);
  await appendControlPlaneAuditEventInTransaction(
    connection,
    {
      auditEventId: options.completionId,
      actorPrincipalId: null,
      actorType: "system",
      authenticationRefType: "none",
      authenticationRefHash: null,
      authorityType: "system",
      authorityId: null,
      authorityVersion: null,
    },
    {
      organizationId: context.organizationId,
      workspaceId: options.workspaceId,
      eventType: "capability.run.completed",
      action: "capability.run.complete",
      resourceType: "capability_run",
      resourceId: capability.id,
      outcome: "succeeded",
      decisionReasonCode: "attempt_completion.atomic_commit",
      severity: "info",
      authorizationDecision: {
        executionGeneration: options.executionGeneration,
        executionTarget: options.target.executionTarget,
        leaseValidated: true,
        pinnedImplementationValidated: true,
      },
      details: {
        attemptId: attempt.id,
        completionId: options.completionId,
        completionManifestHash: manifestHash,
        outputCount: options.outputs.length,
        usageEntryCount: options.initialUsage.length,
        ...(context.workflowRunId
          ? { workflowRunId: context.workflowRunId }
          : {}),
        invocationKind: context.invocationKind,
      },
      occurredAt: options.now,
    },
  );

  return Object.freeze({
    status: "completed",
    completionId: options.completionId,
    completionRequestKey: completionRequestKeyForUnchecked(options.attemptId),
    completionManifestHash: manifestHash,
    manifestSchemaVersion,
    terminalOutboxEventId: options.terminalOutboxEventId,
    completedAt: options.now,
    outputs: Object.freeze(
      options.outputs.map((output) =>
        Object.freeze({
          uploadSessionId: output.uploadSessionId,
          storedObjectId: output.storedObjectId,
          artifactId: output.artifactId,
          attemptOutputId: output.attemptOutputId,
          outputRole: output.outputRole,
          outputIndex: output.outputIndex,
        }),
      ),
    ),
  });
}

export function createAtomicAttemptCompletionStore(
  pool: Pool,
  factoryOptions: CreateAtomicAttemptCompletionStoreOptions,
): AtomicAttemptCompletionStore {
  assertBoundedText(factoryOptions.instanceId, "instanceId", 120);
  return Object.freeze({
    complete(options: CompleteAttemptOptions) {
      return inTransaction(pool, (connection) =>
        completeAttemptInTransaction(
          connection,
          factoryOptions.instanceId,
          options,
        ),
      );
    },
  });
}
