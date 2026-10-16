import {
  parseProviderRouteSnapshot,
  type AutomaticFallbackReason,
  type CapabilityExecutionTarget,
  type CapabilityIdempotencyMode,
  type CapabilityRouteSnapshot,
  type RouteCandidateSnapshot,
} from "@kanvas/application";
import {
  isWorkflowTopology,
  type WorkflowTopology,
} from "@kanvas/contracts/workflow";

import {
  normalizeAttemptTimeoutMs,
  normalizeRetryPolicy,
} from "./execution-retry-policy.js";

export const maximumRouteCandidates = 8;
export const maximumRouteTotalAttempts = 32;

const canonicalDigest = /^sha256:[a-f0-9]{64}$/;
const executionTargets = new Set<CapabilityExecutionTarget>([
  "browser",
  "provider",
  "worker",
]);
const idempotencyModes = new Set<CapabilityIdempotencyMode>([
  "intrinsic",
  "keyed",
  "non_idempotent",
]);
const fallbackReasons = new Set<AutomaticFallbackReason>([
  "browser_executor_fenced",
  "browser_lease_expired",
  "not_started",
]);

const topLevelKeys = new Set([
  "routes",
  "schemaVersion",
  "topology",
  "workflowDefinition",
  "workflowRevision",
]);
const workflowRevisionKeys = new Set(["canonicalDigest", "id"]);
const workflowDefinitionKeys = new Set(["canonicalDigest", "id", "kind"]);
const routeKeys = new Set([
  "candidates",
  "contractDigest",
  "contractKey",
  "contractRevision",
  "contractRevisionId",
  "nodeKey",
]);
const candidateKeys = new Set([
  "adapterKey",
  "attemptTimeoutMs",
  "bindingId",
  "bindingVersion",
  "candidateIndex",
  "executionTarget",
  "fallbackOn",
  "idempotencyMode",
  "implementationDigest",
  "implementationRevisionId",
  "providerRoute",
  "retryPolicy",
]);

export class ExecutionPlanSnapshotError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanSnapshotError";
  }
}

export interface PinnedPlanNode {
  readonly key: string;
  readonly kind: "invoke" | "switch" | "map" | "approval";
  readonly next: readonly string[];
}

export interface PinnedWorkflowRevisionIdentity {
  readonly id: string;
  readonly canonicalDigest: string;
}

export interface PinnedWorkflowDefinitionIdentity {
  readonly kind: "published_revision" | "publication_candidate";
  readonly id: string;
  readonly canonicalDigest: string;
}

export type PinnedRouteCandidate = RouteCandidateSnapshot;
export type PinnedCapabilityRoute = CapabilityRouteSnapshot;

export interface PinnedExecutionPlan {
  readonly schemaVersion: 1;
  readonly workflowRevision?: PinnedWorkflowRevisionIdentity;
  readonly workflowDefinition?: PinnedWorkflowDefinitionIdentity;
  readonly topology: {
    readonly nodes: readonly PinnedPlanNode[];
  };
  readonly routes: readonly PinnedCapabilityRoute[];
}

function parseWorkflowDefinition(
  value: unknown,
): PinnedWorkflowDefinitionIdentity | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordOf(value, "workflowDefinition");
  assertOnlyKeys(record, workflowDefinitionKeys, "workflowDefinition");
  if (
    record.kind !== "published_revision" &&
    record.kind !== "publication_candidate"
  ) {
    return invalid(
      "workflowDefinition.kind must be published_revision or publication_candidate.",
    );
  }
  return Object.freeze({
    kind: record.kind,
    id: boundedString(record.id, "workflowDefinition.id"),
    canonicalDigest: parseDigest(
      record.canonicalDigest,
      "workflowDefinition.canonicalDigest",
    ),
  });
}

export interface PinnedRouteIdentity {
  readonly nodeKey: string;
  readonly contractRevisionId: string;
  readonly contractDigest: string;
}

export interface PinnedCandidateIdentity {
  readonly candidateIndex: number;
  readonly bindingId: string;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly executionTarget: CapabilityExecutionTarget;
  readonly adapterKey: string;
}

function invalid(message: string): never {
  throw new ExecutionPlanSnapshotError(
    `Workflow execution plan snapshot is malformed: ${message}`,
  );
}

function recordOf(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${field} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey) {
    invalid(`${field} contains unknown field ${unknownKey}.`);
  }
}

function boundedString(
  value: unknown,
  field: string,
  maximumLength = 160,
): string {
  const containsControlCharacter =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    containsControlCharacter
  ) {
    return invalid(`${field} must be a non-empty bounded opaque identifier.`);
  }
  return value;
}

function parseNodeKey(value: unknown, field: string): string {
  return boundedString(value, field, 100);
}

function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !canonicalDigest.test(value)) {
    return invalid(`${field} must be a canonical SHA-256 digest.`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    return invalid(
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value as number;
}

function parseExecutionTarget(
  value: unknown,
  field: string,
): CapabilityExecutionTarget {
  if (
    typeof value !== "string" ||
    !executionTargets.has(value as CapabilityExecutionTarget)
  ) {
    return invalid(`${field} is not a supported execution target.`);
  }
  return value as CapabilityExecutionTarget;
}

function parseIdempotencyMode(
  value: unknown,
  field: string,
): CapabilityIdempotencyMode {
  if (
    typeof value !== "string" ||
    !idempotencyModes.has(value as CapabilityIdempotencyMode)
  ) {
    return invalid(`${field} is not a supported idempotency mode.`);
  }
  return value as CapabilityIdempotencyMode;
}

function projectCanonicalTopology(topology: WorkflowTopology): {
  readonly nodes: readonly PinnedPlanNode[];
} {
  const nodes: readonly PinnedPlanNode[] = topology.nodes.map((node) => {
    const next =
      node.kind === "switch"
        ? [
            ...node.cases.flatMap((candidate) => candidate.next),
            ...node.defaultNext,
          ]
        : node.next;
    return Object.freeze({
      key: node.key,
      kind: node.kind,
      next: Object.freeze([...new Set(next)]),
    });
  });
  return Object.freeze({
    nodes: Object.freeze(nodes),
  });
}

function parseTopology(value: unknown): {
  readonly nodes: readonly PinnedPlanNode[];
} {
  if (!isWorkflowTopology(value)) {
    return invalid(
      "topology does not satisfy the bounded WorkflowTopology v1 contract.",
    );
  }
  return projectCanonicalTopology(value);
}

function parseWorkflowRevision(
  value: unknown,
): PinnedWorkflowRevisionIdentity | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordOf(value, "workflowRevision");
  assertOnlyKeys(record, workflowRevisionKeys, "workflowRevision");
  return Object.freeze({
    id: boundedString(record.id, "workflowRevision.id"),
    canonicalDigest: parseDigest(
      record.canonicalDigest,
      "workflowRevision.canonicalDigest",
    ),
  });
}

function parseRetryPolicy(
  value: unknown,
  field: string,
): RouteCandidateSnapshot["retryPolicy"] {
  const retryPolicy = recordOf(value, field);
  try {
    return normalizeRetryPolicy({ retryPolicy });
  } catch (error) {
    return invalid(
      `${field} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseAttemptTimeout(value: unknown, field: string): number {
  if (value === undefined) {
    return invalid(`${field} is required.`);
  }
  try {
    return normalizeAttemptTimeoutMs({ attemptTimeoutMs: value });
  } catch (error) {
    return invalid(
      `${field} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseFallbackOn(
  value: unknown,
  field: string,
): readonly AutomaticFallbackReason[] {
  if (!Array.isArray(value) || value.length > fallbackReasons.size) {
    return invalid(
      `${field} must be an array of supported automatic fallback reasons.`,
    );
  }
  const seen = new Set<AutomaticFallbackReason>();
  const result = value.map((candidate, index) => {
    if (
      typeof candidate !== "string" ||
      !fallbackReasons.has(candidate as AutomaticFallbackReason)
    ) {
      return invalid(`${field}[${String(index)}] is unsupported.`);
    }
    const parsed = candidate as AutomaticFallbackReason;
    if (seen.has(parsed)) {
      return invalid(`${field} contains duplicate reason ${parsed}.`);
    }
    seen.add(parsed);
    return parsed;
  });
  return Object.freeze(result);
}

function parseCandidate(
  value: unknown,
  routeIndex: number,
  candidatePosition: number,
): PinnedRouteCandidate {
  const field = `routes[${String(routeIndex)}].candidates[${String(candidatePosition)}]`;
  const record = recordOf(value, field);
  assertOnlyKeys(record, candidateKeys, field);
  const candidateIndex = boundedInteger(
    record.candidateIndex,
    0,
    maximumRouteCandidates - 1,
    `${field}.candidateIndex`,
  );
  const executionTarget = parseExecutionTarget(
    record.executionTarget,
    `${field}.executionTarget`,
  );
  const parsedFallbackOn = parseFallbackOn(
    record.fallbackOn,
    `${field}.fallbackOn`,
  );
  if (
    executionTarget !== "browser" &&
    parsedFallbackOn.some((reason) => reason !== "not_started")
  ) {
    return invalid(
      `${field}.fallbackOn contains a Browser-only reason for ${executionTarget}.`,
    );
  }
  const facts = {
    candidateIndex,
    bindingId: boundedString(record.bindingId, `${field}.bindingId`),
    bindingVersion: boundedInteger(
      record.bindingVersion,
      1,
      4_294_967_295,
      `${field}.bindingVersion`,
    ),
    implementationRevisionId: boundedString(
      record.implementationRevisionId,
      `${field}.implementationRevisionId`,
    ),
    implementationDigest: parseDigest(
      record.implementationDigest,
      `${field}.implementationDigest`,
    ),
    executionTarget,
    adapterKey: boundedString(record.adapterKey, `${field}.adapterKey`, 160),
    idempotencyMode: parseIdempotencyMode(
      record.idempotencyMode,
      `${field}.idempotencyMode`,
    ),
    retryPolicy: parseRetryPolicy(record.retryPolicy, `${field}.retryPolicy`),
    attemptTimeoutMs: parseAttemptTimeout(
      record.attemptTimeoutMs,
      `${field}.attemptTimeoutMs`,
    ),
    fallbackOn: parsedFallbackOn,
  } as const;

  if (executionTarget === "provider") {
    if (record.providerRoute === undefined) {
      return invalid(`${field}.providerRoute is required for Provider.`);
    }
    return Object.freeze({
      ...facts,
      executionTarget,
      providerRoute: parseProviderRouteSnapshot(record.providerRoute),
    });
  }
  if (Object.hasOwn(record, "providerRoute")) {
    return invalid(
      `${field}.providerRoute is forbidden for ${executionTarget}.`,
    );
  }
  return Object.freeze({
    ...facts,
    executionTarget,
  });
}

function assertCandidateBudgets(
  candidates: readonly PinnedRouteCandidate[],
  field: string,
): void {
  let totalAttempts = 0;
  const bindingIds = new Set<string>();
  candidates.forEach((candidate, position) => {
    if (candidate.candidateIndex !== position) {
      invalid(
        `${field} candidateIndex values must be contiguous and zero-based.`,
      );
    }
    if (bindingIds.has(candidate.bindingId)) {
      invalid(`${field} contains duplicate binding ${candidate.bindingId}.`);
    }
    bindingIds.add(candidate.bindingId);
    totalAttempts += candidate.retryPolicy.maxAttempts;
  });
  if (totalAttempts > maximumRouteTotalAttempts) {
    invalid(
      `${field} permits ${String(totalAttempts)} attempts; the maximum is ${String(maximumRouteTotalAttempts)}.`,
    );
  }
}

function parseRoutes(value: unknown): readonly PinnedCapabilityRoute[] {
  if (!Array.isArray(value) || value.length > 500) {
    return invalid("routes must be an array of at most 500 routes.");
  }
  const seenNodes = new Set<string>();
  const routes = value.map((routeValue, routeIndex) => {
    const field = `routes[${String(routeIndex)}]`;
    const record = recordOf(routeValue, field);
    assertOnlyKeys(record, routeKeys, field);
    const routeNodeKey = parseNodeKey(record.nodeKey, `${field}.nodeKey`);
    if (seenNodes.has(routeNodeKey)) {
      return invalid(`routes contains duplicate node ${routeNodeKey}.`);
    }
    seenNodes.add(routeNodeKey);
    if (
      !Array.isArray(record.candidates) ||
      record.candidates.length < 1 ||
      record.candidates.length > maximumRouteCandidates
    ) {
      return invalid(
        `${field}.candidates must contain between 1 and ${String(maximumRouteCandidates)} candidates.`,
      );
    }
    const candidates = Object.freeze(
      record.candidates.map((candidate, candidateIndex) =>
        parseCandidate(candidate, routeIndex, candidateIndex),
      ),
    );
    assertCandidateBudgets(candidates, `${field}.candidates`);
    return Object.freeze({
      nodeKey: routeNodeKey,
      contractRevisionId: boundedString(
        record.contractRevisionId,
        `${field}.contractRevisionId`,
      ),
      contractKey: boundedString(record.contractKey, `${field}.contractKey`),
      contractRevision: boundedInteger(
        record.contractRevision,
        1,
        4_294_967_295,
        `${field}.contractRevision`,
      ),
      contractDigest: parseDigest(
        record.contractDigest,
        `${field}.contractDigest`,
      ),
      candidates,
    });
  });
  return Object.freeze(routes);
}

function assertRoutesMatchTopology(
  topology: PinnedExecutionPlan["topology"],
  routes: readonly PinnedCapabilityRoute[],
): void {
  const nodes = new Map(topology.nodes.map((node) => [node.key, node]));
  for (const route of routes) {
    const node = nodes.get(route.nodeKey);
    if (!node) {
      invalid(`route for ${route.nodeKey} has no topology node.`);
    }
    if (node.kind !== "invoke" && node.kind !== "map") {
      invalid(
        `route for ${route.nodeKey} targets non-capability node kind ${node.kind}.`,
      );
    }
  }
  const routeNodes = new Set(routes.map((route) => route.nodeKey));
  for (const node of topology.nodes) {
    if (
      (node.kind === "invoke" || node.kind === "map") &&
      !routeNodes.has(node.key)
    ) {
      invalid(
        `capability-bearing topology node ${node.key} has no pinned route.`,
      );
    }
  }
}

export function parseJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

export function parseExecutionPlan(value: unknown): PinnedExecutionPlan {
  let parsed: unknown;
  try {
    parsed = parseJson(value);
  } catch {
    return invalid("value is not valid JSON.");
  }
  const plan = recordOf(parsed, "plan");
  if (plan.schemaVersion !== 1) {
    return invalid("schemaVersion must equal 1.");
  }
  assertOnlyKeys(plan, topLevelKeys, "plan");
  if (!Object.hasOwn(plan, "routes")) {
    return invalid("schemaVersion 1 requires routes.");
  }
  const topology = parseTopology(plan.topology);
  const routes = parseRoutes(plan.routes);
  assertRoutesMatchTopology(topology, routes);
  const workflowRevision = parseWorkflowRevision(plan.workflowRevision);
  const workflowDefinition = parseWorkflowDefinition(plan.workflowDefinition);
  if (workflowRevision && workflowDefinition) {
    return invalid(
      "plan cannot contain both workflowDefinition and workflowRevision.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    ...(workflowRevision ? { workflowRevision } : {}),
    ...(workflowDefinition ? { workflowDefinition } : {}),
    topology,
    routes,
  });
}

export function parsePinnedCapabilityRoute(
  value: unknown,
): PinnedCapabilityRoute {
  let parsed: unknown;
  try {
    parsed = parseJson(value);
  } catch {
    return invalid("Capability route snapshot is not valid JSON.");
  }
  const routes = parseRoutes([parsed]);
  return routes[0]!;
}

export function findPinnedRoute(
  plan: PinnedExecutionPlan,
  routeNodeKey: string,
): PinnedCapabilityRoute {
  const route = plan.routes.find(
    (candidate) => candidate.nodeKey === routeNodeKey,
  );
  if (!route) {
    throw new ExecutionPlanSnapshotError(
      `Execution plan has no route for node ${routeNodeKey}.`,
    );
  }
  return route;
}

export function findPinnedCandidate(
  route: PinnedCapabilityRoute,
  candidateIndex: number,
): PinnedRouteCandidate {
  const candidate = route.candidates[candidateIndex];
  if (!candidate || candidate.candidateIndex !== candidateIndex) {
    throw new ExecutionPlanSnapshotError(
      `Execution plan route ${route.nodeKey} has no candidate ${String(candidateIndex)}.`,
    );
  }
  return candidate;
}

export function assertPinnedRouteIdentity(
  route: PinnedCapabilityRoute,
  expected: PinnedRouteIdentity,
): void {
  if (
    route.nodeKey !== expected.nodeKey ||
    route.contractRevisionId !== expected.contractRevisionId ||
    route.contractDigest !== expected.contractDigest
  ) {
    throw new ExecutionPlanSnapshotError(
      `Execution plan route identity does not match node ${expected.nodeKey}.`,
    );
  }
}

export function assertPinnedCandidateIdentity(
  candidate: PinnedRouteCandidate,
  expected: PinnedCandidateIdentity,
): void {
  if (
    candidate.candidateIndex !== expected.candidateIndex ||
    candidate.bindingId !== expected.bindingId ||
    candidate.implementationRevisionId !== expected.implementationRevisionId ||
    candidate.implementationDigest !== expected.implementationDigest ||
    candidate.executionTarget !== expected.executionTarget ||
    candidate.adapterKey !== expected.adapterKey
  ) {
    throw new ExecutionPlanSnapshotError(
      `Execution plan candidate identity does not match candidate ${String(expected.candidateIndex)}.`,
    );
  }
}
