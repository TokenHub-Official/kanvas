import type {
  WorkflowTopologyNodeV1,
  WorkflowTopologyV1,
} from "@kanvas/contracts/workflow";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import {
  probeWorkflowValueTemplate,
  resolveWorkflowValueTemplate,
  selectWorkflowSwitchTargets,
  workflowApprovalAuthorizationDecisionId,
  WorkflowValueProtocolError,
  type ResolveWorkflowValueContext,
  type TrustedWorkspaceScope,
  type WorkflowTerminalNodeStatus,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  findPinnedCandidate,
  findPinnedRoute,
  parseExecutionPlan,
  type PinnedCapabilityRoute,
  type PinnedExecutionPlan,
  type PinnedRouteCandidate,
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
  isQueueExecutionTarget,
  type ExecutionTarget,
  type ExecutionTargetGate,
} from "./execution-target.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";
import {
  AuthorizationStoreError,
  revalidateTrustedWorkspaceScopeInTransaction,
} from "./authorization-store.js";

const terminalNodeStatuses = new Set<NodeLifecycleStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
const canonicalDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const identifierPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const mapScopeKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type NodeLifecycleStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type WorkflowRuntimeIdPurpose =
  | "activated_edge"
  | "approval_decision"
  | "approval_request"
  | "attempt"
  | "capability_run"
  | "capability_cancellation"
  | "deadline_schedule"
  | "dispatch_outbox"
  | "map_expansion"
  | "map_item"
  | "map_item_node"
  | "output_fact"
  | "run_wakeup"
  | "switch_decision";

export interface WorkflowJsonSchemaValidationPort {
  /**
   * Returns an empty list when valid. Implementations must be synchronous,
   * deterministic, bounded, and side-effect free because validation runs
   * inside the orchestration transaction.
   */
  validate(
    schema: Readonly<Record<string, unknown>>,
    value: unknown,
  ): readonly string[];
}

export interface CreateBoundedWorkflowOrchestratorStoreOptions {
  readonly ids: {
    next(purpose: WorkflowRuntimeIdPurpose): string;
  };
  readonly schemaValidation: WorkflowJsonSchemaValidationPort;
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
  readonly maximumTransitionsPerWakeup?: number;
  readonly maximumNodeCreatesPerWakeup?: number;
  readonly continuationDelayMs?: number;
  readonly approvalTtlMs?: number;
  readonly cooperativeCancellationGraceMs?: number;
}

export interface ConsumeBoundedWorkflowFrontierOptions {
  readonly workflowRunId: string;
  readonly executionGeneration: number;
  readonly now: Date;
  readonly delivery: InboxDelivery;
}

export interface ConsumeBoundedWorkflowFrontierResult {
  readonly workflowRunId: string;
  readonly transitions: number;
  readonly nodeCreates: number;
  readonly continuationScheduled: boolean;
  readonly lifecycleStatus:
    | "queued"
    | "running"
    | "waiting"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
}

export interface AuthorizedApprovalDecisionContext {
  readonly effect: "allow";
  readonly authorizationDecisionId: string;
  readonly workspaceId: string;
  readonly approvalRequestId: string;
  readonly actorPrincipalId: string;
  readonly permission: "approval.decide";
  readonly bindingDigest: string;
  readonly policyRevision: string;
  readonly authorizedAt: Date;
  readonly validUntil: Date;
}

export interface DecideWorkflowApprovalOptions {
  readonly approvalRequestId: string;
  readonly workspaceId: string;
  readonly authority: TrustedWorkspaceScope;
  readonly idempotencyKeyDigest: string;
  readonly decisionId: string;
  readonly outboxEventId: string;
  readonly decision: unknown;
  readonly authorization: AuthorizedApprovalDecisionContext;
  readonly executionGeneration: number;
  readonly now: Date;
}

export type DecideWorkflowApprovalResult =
  | {
      readonly status: "recorded";
      readonly decisionId: string;
      readonly workflowRunId: string;
    }
  | {
      readonly status: "replayed";
      readonly decisionId: string;
      readonly workflowRunId: string;
    }
  | {
      readonly status: "conflict";
      readonly existingDecisionId: string;
      readonly workflowRunId: string;
    }
  | {
      readonly status: "no_progress";
      readonly reason: "cancelled" | "expired" | "run_terminal";
      readonly workflowRunId: string;
    };

export interface BoundedWorkflowOrchestratorStore {
  consumeFrontier(
    options: ConsumeBoundedWorkflowFrontierOptions,
  ): Promise<InboxConsumptionResult<ConsumeBoundedWorkflowFrontierResult>>;
  decideApproval(
    options: DecideWorkflowApprovalOptions,
  ): Promise<DecideWorkflowApprovalResult>;
}

export type BoundedWorkflowRuntimeErrorCode =
  | "workflow.v1.approval_authorization_invalid"
  | "workflow.v1.approval_decision_invalid"
  | "workflow.v1.approval_not_found"
  | "workflow.v1.fact_conflict"
  | "workflow.v1.id_invalid"
  | "workflow.v1.input_invalid"
  | "workflow.v1.limit_invalid"
  | "workflow.v1.map_scope_invalid"
  | "workflow.v1.plan_invalid"
  | "workflow.v1.route_invalid"
  | "workflow.v1.state_conflict";

export class BoundedWorkflowRuntimeError extends Error {
  public constructor(
    public readonly code: BoundedWorkflowRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BoundedWorkflowRuntimeError";
  }
}

export type BoundedJoinDecision =
  | "ready"
  | "wait"
  | "skip_branch_not_selected"
  | "skip_upstream_not_successful";

export interface EvaluateBoundedJoinOptions {
  readonly isEntry: boolean;
  readonly allPotentialIncomingResolved: boolean;
  readonly activatedSourceStatuses: readonly NodeLifecycleStatus[];
  readonly joinPolicy: "all_success" | "all_settled";
}

/**
 * Pure authority for a root-node frontier decision. The caller supplies only
 * sources from durable ActivatedEdge facts; static but unselected Switch
 * edges never enter activatedSourceStatuses.
 */
export function evaluateBoundedJoin(
  options: EvaluateBoundedJoinOptions,
): BoundedJoinDecision {
  if (options.isEntry) {
    return "ready";
  }
  if (!options.allPotentialIncomingResolved) {
    return "wait";
  }
  if (options.activatedSourceStatuses.length === 0) {
    return "skip_branch_not_selected";
  }
  if (
    options.joinPolicy === "all_success" &&
    options.activatedSourceStatuses.some(
      (status) => terminalNodeStatuses.has(status) && status !== "completed",
    )
  ) {
    return "skip_upstream_not_successful";
  }
  const ready =
    options.joinPolicy === "all_settled"
      ? options.activatedSourceStatuses.every((status) =>
          terminalNodeStatuses.has(status),
        )
      : options.activatedSourceStatuses.every(
          (status) => status === "completed",
        );
  return ready ? "ready" : "wait";
}

export function assertStableMapScopeKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value === "root" ||
    !mapScopeKeyPattern.test(value)
  ) {
    throw new BoundedWorkflowRuntimeError(
      "workflow.v1.map_scope_invalid",
      "A Map scope key must be a stable 1-160 character ASCII key and cannot equal root.",
    );
  }
  return value;
}

export function topologicallyOrderWorkflowNodes(
  topology: WorkflowTopologyV1,
): readonly WorkflowTopologyNodeV1[] {
  const byKey = new Map(
    topology.nodes.map((node, index) => [
      node.key,
      {
        node,
        index,
      },
    ]),
  );
  const indegree = new Map<string, number>(
    topology.nodes.map((node) => [node.key, 0]),
  );
  const outgoing = new Map<string, Set<string>>(
    topology.nodes.map((node) => [node.key, new Set<string>()]),
  );
  for (const node of topology.nodes) {
    const targets =
      node.kind === "switch"
        ? [
            ...node.cases.flatMap((candidate) => candidate.next),
            ...node.defaultNext,
          ]
        : node.next;
    for (const target of new Set(targets)) {
      const targetDegree = indegree.get(target);
      const sourceTargets = outgoing.get(node.key);
      if (targetDegree === undefined || !sourceTargets) {
        throw new BoundedWorkflowRuntimeError(
          "workflow.v1.plan_invalid",
          `Workflow topology references missing node ${target}.`,
        );
      }
      sourceTargets.add(target);
      indegree.set(target, targetDegree + 1);
    }
  }
  const ready = topology.nodes
    .filter((node) => indegree.get(node.key) === 0)
    .sort(
      (left, right) =>
        (byKey.get(left.key)?.index ?? 0) - (byKey.get(right.key)?.index ?? 0),
    );
  const ordered: WorkflowTopologyNodeV1[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) {
      break;
    }
    ordered.push(next);
    for (const target of outgoing.get(next.key) ?? []) {
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        const targetNode = byKey.get(target)?.node;
        if (targetNode) {
          ready.push(targetNode);
          ready.sort(
            (left, right) =>
              (byKey.get(left.key)?.index ?? 0) -
              (byKey.get(right.key)?.index ?? 0),
          );
        }
      }
    }
  }
  if (ordered.length !== topology.nodes.length) {
    throw new BoundedWorkflowRuntimeError(
      "workflow.v1.plan_invalid",
      "Workflow topology must be acyclic.",
    );
  }
  return Object.freeze(ordered);
}

interface WorkflowRunRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly definitionId: string;
  readonly lifecycleStatus:
    | "queued"
    | "running"
    | "waiting"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
  readonly outcome:
    "full_success" | "partial_success" | "no_usable_output" | null;
  readonly input: unknown;
  readonly output: unknown;
  readonly outputDigest: string | null;
  readonly terminalReasonCode: string | null;
  readonly executionDeadlineAt: Date;
  readonly executionPlanSnapshot: unknown;
  readonly executionPlanHash: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelRequestedBy: string | null;
  readonly cancelReasonCode: string | null;
  readonly cancelDeadlineAt: Date | null;
  readonly definitionCanonicalDigest: string;
  readonly outputSchema: unknown;
}

interface NodeRunRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeKey: string;
  readonly scopeKey: string;
  readonly kind: "invoke" | "switch" | "map" | "approval";
  readonly lifecycleStatus: NodeLifecycleStatus;
  readonly waitingReason: string | null;
  readonly activatedAt: Date | null;
  readonly activationReasonCode: string | null;
  readonly activationDigest: string | null;
  readonly input: unknown;
  readonly inputDigest: string | null;
  readonly output: unknown;
  readonly outputDigest: string | null;
  readonly error: unknown;
  readonly terminalReasonCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

interface MutableNodeRun {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  nodeKey: string;
  scopeKey: string;
  kind: "invoke" | "switch" | "map" | "approval";
  lifecycleStatus: NodeLifecycleStatus;
  waitingReason: string | null;
  activatedAt: Date | null;
  activationReasonCode: string | null;
  activationDigest: string | null;
  input: unknown;
  inputDigest: string | null;
  output: unknown;
  outputDigest: string | null;
  error: unknown;
  terminalReasonCode: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface CapabilityRunRow extends RowDataPacket {
  readonly attemptError?: unknown;
  readonly id: string;
  readonly nodeRunId: string;
  readonly currentAttemptId: string | null;
  readonly lifecycleStatus:
    "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly output: unknown;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly version: number;
}

interface MutableCapabilityRun {
  attemptError?: unknown;
  id: string;
  nodeRunId: string;
  currentAttemptId: string | null;
  lifecycleStatus: "queued" | "running" | "completed" | "failed" | "cancelled";
  output: unknown;
  cancelRequestedAt: Date | null;
  cancelDeadlineAt: Date | null;
  version: number;
}

interface DeadlineScheduleFact {
  readonly id: string;
  readonly workflowRunId: string;
  readonly executionPlanHash: string;
  readonly executionDeadlineAt: Date;
  readonly outboxEventId: string;
  readonly scheduleDigest: string;
}

interface CapabilityCancellationFact {
  readonly id: string;
  readonly capabilityRunId: string;
  readonly capabilityAttemptId: string;
  readonly sourceKind: "workflow_deadline" | "map_fail_fast";
  readonly sourceId: string;
  readonly reasonCode: string;
  readonly requestedAt: Date;
  readonly cancelDeadlineAt: Date;
  readonly requestDigest: string;
}

interface RouteAuthorityRow extends RowDataPacket {
  readonly contractRevisionId: string;
  readonly contractWorkspaceId: string;
  readonly contractKey: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly contractLifecycleStatus: string;
  readonly inputSchema: unknown;
  readonly bindingId: string;
  readonly bindingWorkspaceId: string;
  readonly bindingVersion: number;
  readonly bindingLifecycleStatus: string;
  readonly implementationRevisionId: string;
  readonly implementationWorkspaceId: string;
  readonly implementationDigest: string;
  readonly implementationLifecycleStatus: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
}

interface ActivatedEdgeFact {
  readonly id: string;
  readonly sourceNodeRunId: string | null;
  readonly sourceNodeKey: string;
  readonly sourceScopeKey: string;
  readonly sourceNodeVersion: number;
  readonly targetNodeRunId: string;
  readonly targetNodeKey: string;
  readonly targetScopeKey: string;
  readonly activationKind: "entry" | "declared" | "switch" | "map_item";
  readonly switchDecisionId: string | null;
  readonly activationDigest: string;
}

interface SwitchDecisionFact {
  readonly id: string;
  readonly nodeRunId: string;
  readonly inputValue: unknown;
  readonly inputDigest: string;
  readonly matchedCaseIndex: number | null;
  readonly selectedTargets: unknown;
  readonly decisionDigest: string;
}

interface ApprovalFact {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId: string | null;
  readonly publicationCandidateId: string | null;
  readonly executionPlanHash: string;
  readonly nodeInput: unknown;
  readonly nodeInputDigest: string;
  readonly requestPayload: unknown;
  readonly requestDigest: string;
  readonly decisionSchema: unknown;
  readonly decisionSchemaDigest: string;
  readonly requiredPermission: string;
  readonly authorizationContextDigest: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly lifecycleStatus: "pending" | "decided" | "expired" | "cancelled";
  readonly stateVersion: number;
}

interface ApprovalDecisionFact {
  readonly id: string;
  readonly approvalRequestId: string;
  readonly actorPrincipalId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationDigest: string;
  readonly decision: unknown;
  readonly decisionDigest: string;
  readonly decidedAt: Date;
}

interface MapExpansionRow extends RowDataPacket {
  readonly id: string;
  readonly coordinatorNodeRunId: string;
  readonly items: unknown;
  readonly itemsDigest: string;
  readonly scopeKeys: unknown;
  readonly scopeKeysDigest: string;
  readonly itemCount: number;
  readonly maxItems: number;
  readonly maxConcurrency: number;
  readonly failureMode: "collect_all" | "fail_fast";
  readonly expansionDigest: string;
  readonly lifecycleStatus:
    "expanding" | "waiting" | "completed" | "fail_fast_stopping" | "failed";
  readonly nextItemIndex: number;
  readonly activeCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly skippedCount: number;
  readonly stopReasonCode: string | null;
  readonly stateVersion: number;
  readonly completedAt: Date | null;
}

interface MutableMapExpansion {
  id: string;
  coordinatorNodeRunId: string;
  items: readonly unknown[];
  itemsDigest: string;
  scopeKeys: readonly string[];
  scopeKeysDigest: string;
  itemCount: number;
  maxItems: number;
  maxConcurrency: number;
  failureMode: "collect_all" | "fail_fast";
  expansionDigest: string;
  lifecycleStatus:
    "expanding" | "waiting" | "completed" | "fail_fast_stopping" | "failed";
  nextItemIndex: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  skippedCount: number;
  stopReasonCode: string | null;
  stateVersion: number;
  completedAt: Date | null;
}

interface MapItemFact {
  readonly id: string;
  readonly mapExpansionId: string;
  readonly coordinatorNodeRunId: string;
  readonly itemNodeRunId: string;
  readonly itemIndex: number;
  readonly scopeKey: string;
  readonly itemValue: unknown;
  readonly itemDigest: string;
  readonly inputDigest: string;
}

interface MutableRunState {
  id: string;
  workspaceId: string;
  definitionKind: "published_revision" | "publication_candidate";
  definitionId: string;
  lifecycleStatus: WorkflowRunRow["lifecycleStatus"];
  outcome: WorkflowRunRow["outcome"];
  input: unknown;
  output: unknown;
  outputDigest: string | null;
  terminalReasonCode: string | null;
  executionDeadlineAt: Date;
  executionPlanSnapshot: unknown;
  executionPlanHash: string;
  version: number;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelRequestedBy: string | null;
  cancelReasonCode: string | null;
  cancelDeadlineAt: Date | null;
  definitionCanonicalDigest: string;
  outputSchema: Readonly<Record<string, unknown>>;
}

interface RunWakeupSpec {
  readonly id: string;
  readonly messageType:
    "workflow.wakeup.requested" | "workflow.cancel.requested";
  readonly cause: string;
  readonly availableAt: Date;
}

interface FrontierState {
  readonly connection: PoolConnection;
  readonly configuration: NormalizedConfiguration;
  readonly executionGeneration: number;
  readonly now: Date;
  readonly topology: WorkflowTopologyV1;
  readonly plan: PinnedExecutionPlan;
  readonly orderedTopologyNodes: readonly WorkflowTopologyNodeV1[];
  readonly run: MutableRunState;
  readonly nodes: MutableNodeRun[];
  readonly nodesByIdentity: Map<string, MutableNodeRun>;
  readonly capabilitiesByNodeId: Map<string, MutableCapabilityRun>;
  readonly edges: ActivatedEdgeFact[];
  readonly switchDecisionsByNodeId: Map<string, SwitchDecisionFact>;
  readonly approvalsByNodeId: Map<string, ApprovalFact>;
  readonly approvalDecisionsByRequestId: Map<string, ApprovalDecisionFact>;
  readonly mapExpansionsByNodeId: Map<string, MutableMapExpansion>;
  readonly mapItemsByExpansionId: Map<string, MapItemFact[]>;
  readonly wakeups: RunWakeupSpec[];
  deadlineSchedule: DeadlineScheduleFact | undefined;
  readonly cancellationsByCapabilityId: Map<string, CapabilityCancellationFact>;
  readonly predecessorKeys: ReadonlyMap<string, readonly string[]>;
  transitions: number;
  nodeCreates: number;
  runChanged: boolean;
  continuationRequired: boolean;
}

interface NormalizedConfiguration {
  readonly ids: CreateBoundedWorkflowOrchestratorStoreOptions["ids"];
  readonly schemaValidation: WorkflowJsonSchemaValidationPort;
  readonly targetGate: ExecutionTargetGate;
  readonly maximumTransitionsPerWakeup: number;
  readonly maximumNodeCreatesPerWakeup: number;
  readonly continuationDelayMs: number;
  readonly approvalTtlMs: number;
  readonly cooperativeCancellationGraceMs: number;
}

function fail(code: BoundedWorkflowRuntimeErrorCode, message: string): never {
  throw new BoundedWorkflowRuntimeError(code, message);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(
      "workflow.v1.fact_conflict",
      "A persisted Workflow v1 JSON fact is malformed.",
    );
  }
}

function asRecord(
  value: unknown,
  description: string,
): Readonly<Record<string, unknown>> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "workflow.v1.fact_conflict",
      `${description} must be a JSON object.`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown, description: string): readonly unknown[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return fail(
      "workflow.v1.fact_conflict",
      `${description} must be a JSON array.`,
    );
  }
  return parsed;
}

function asStringArray(value: unknown, description: string): readonly string[] {
  const parsed = asArray(value, description);
  if (!parsed.every((candidate) => typeof candidate === "string")) {
    return fail(
      "workflow.v1.fact_conflict",
      `${description} must contain only strings.`,
    );
  }
  return parsed;
}

function assertIdentifier(value: string, field: string): void {
  if (!identifierPattern.test(value)) {
    fail(
      "workflow.v1.id_invalid",
      `${field} must be a canonical 26-character identifier.`,
    );
  }
}

function nextId(
  configuration: NormalizedConfiguration,
  purpose: WorkflowRuntimeIdPurpose,
): string {
  const value = configuration.ids.next(purpose);
  assertIdentifier(value, `${purpose} id`);
  return value;
}

function assertDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail("workflow.v1.input_invalid", `${field} must be a valid Date.`);
  }
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return fail(
      "workflow.v1.limit_invalid",
      `${field} must be between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}

function normalizeConfiguration(
  options: CreateBoundedWorkflowOrchestratorStoreOptions,
): NormalizedConfiguration {
  if (
    !options.ids ||
    typeof options.ids.next !== "function" ||
    !options.schemaValidation ||
    typeof options.schemaValidation.validate !== "function"
  ) {
    return fail(
      "workflow.v1.input_invalid",
      "Workflow v1 requires an ID source and deterministic JSON Schema validation port.",
    );
  }
  return Object.freeze({
    ids: options.ids,
    schemaValidation: options.schemaValidation,
    targetGate: createExecutionTargetGate(options.enabledExecutionTargets),
    maximumTransitionsPerWakeup: boundedInteger(
      options.maximumTransitionsPerWakeup ?? 64,
      1,
      500,
      "maximumTransitionsPerWakeup",
    ),
    maximumNodeCreatesPerWakeup: boundedInteger(
      options.maximumNodeCreatesPerWakeup ?? 32,
      1,
      100,
      "maximumNodeCreatesPerWakeup",
    ),
    continuationDelayMs: boundedInteger(
      options.continuationDelayMs ?? 0,
      0,
      60_000,
      "continuationDelayMs",
    ),
    approvalTtlMs: boundedInteger(
      options.approvalTtlMs ?? 86_400_000,
      60_000,
      2_592_000_000,
      "approvalTtlMs",
    ),
    cooperativeCancellationGraceMs: boundedInteger(
      options.cooperativeCancellationGraceMs ?? 30_000,
      0,
      300_000,
      "cooperativeCancellationGraceMs",
    ),
  });
}

function nodeIdentity(nodeKey: string, scopeKey: string): string {
  return `${nodeKey}\u0000${scopeKey}`;
}

function mutableNode(row: NodeRunRow): MutableNodeRun {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowRunId: row.workflowRunId,
    nodeKey: row.nodeKey,
    scopeKey: row.scopeKey,
    kind: row.kind,
    lifecycleStatus: row.lifecycleStatus,
    waitingReason: row.waitingReason,
    activatedAt: row.activatedAt,
    activationReasonCode: row.activationReasonCode,
    activationDigest: row.activationDigest,
    input: row.input === null ? null : parseJson(row.input),
    inputDigest: row.inputDigest,
    output: row.output === null ? null : parseJson(row.output),
    outputDigest: row.outputDigest,
    error: row.error === null ? null : parseJson(row.error),
    terminalReasonCode: row.terminalReasonCode,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function mutableCapability(row: CapabilityRunRow): MutableCapabilityRun {
  return {
    attemptError:
      row.attemptError == null ? undefined : parseJson(row.attemptError),
    id: row.id,
    nodeRunId: row.nodeRunId,
    currentAttemptId: row.currentAttemptId,
    lifecycleStatus: row.lifecycleStatus,
    output: row.output === null ? null : parseJson(row.output),
    cancelRequestedAt: row.cancelRequestedAt,
    cancelDeadlineAt: row.cancelDeadlineAt,
    version: row.version,
  };
}

function isTerminalNode(
  node: Pick<MutableNodeRun, "lifecycleStatus">,
): boolean {
  return terminalNodeStatuses.has(node.lifecycleStatus);
}

function takeTransition(state: FrontierState): boolean {
  if (state.transitions >= state.configuration.maximumTransitionsPerWakeup) {
    state.continuationRequired = true;
    return false;
  }
  state.transitions += 1;
  return true;
}

function takeNodeCreate(state: FrontierState): boolean {
  if (state.nodeCreates >= state.configuration.maximumNodeCreatesPerWakeup) {
    state.continuationRequired = true;
    return false;
  }
  state.nodeCreates += 1;
  return true;
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

function buildPredecessorKeys(
  topology: WorkflowTopologyV1,
): ReadonlyMap<string, readonly string[]> {
  const predecessors = new Map<string, string[]>(
    topology.nodes.map((node) => [node.key, []]),
  );
  for (const source of topology.nodes) {
    const targets =
      source.kind === "switch"
        ? [
            ...source.cases.flatMap((candidate) => candidate.next),
            ...source.defaultNext,
          ]
        : source.next;
    for (const target of new Set(targets)) {
      const targetPredecessors = predecessors.get(target);
      if (!targetPredecessors) {
        return fail(
          "workflow.v1.plan_invalid",
          `Workflow topology references missing node ${target}.`,
        );
      }
      targetPredecessors.push(source.key);
    }
  }
  return new Map(
    [...predecessors.entries()].map(([key, values]) => [
      key,
      Object.freeze(values),
    ]),
  );
}

function requirePayloadIdentifier(
  event: CanonicalInboxEvent,
  key: "workflowRunId" | "nodeRunId" | "capabilityRunId" | "approvalRequestId",
): string {
  const value = event.payload[key];
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return value;
}

function assertCanonicalCauseEnvelope(
  event: CanonicalInboxEvent,
  options: ConsumeBoundedWorkflowFrontierOptions,
): void {
  if (event.schemaVersion > 1) {
    throw new InboxDeliveryError("inbox.event.future_version");
  }
  if (
    event.schemaVersion !== 1 ||
    event.expectedGeneration !== options.executionGeneration
  ) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  const workflowRunId = requirePayloadIdentifier(event, "workflowRunId");
  if (
    workflowRunId !== options.workflowRunId ||
    event.workspaceId !== options.delivery.workspaceId
  ) {
    throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
  }
  if (event.messageType === "workflow.wakeup.requested") {
    if (event.aggregateType === "workflow_run") {
      if (event.aggregateId !== options.workflowRunId) {
        throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
      }
      return;
    }
    const deadlineScheduleId = event.payload.deadlineScheduleId;
    if (
      event.aggregateType !== "workflow_deadline_schedule" ||
      typeof deadlineScheduleId !== "string" ||
      !identifierPattern.test(deadlineScheduleId) ||
      event.aggregateId !== deadlineScheduleId
    ) {
      throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
    }
    return;
  }
  if (
    event.messageType === "capability.run.completed" ||
    event.messageType === "capability.run.failed" ||
    event.messageType === "capability.run.cancelled"
  ) {
    const capabilityRunId = requirePayloadIdentifier(event, "capabilityRunId");
    requirePayloadIdentifier(event, "nodeRunId");
    if (
      event.aggregateType !== "capability_run" ||
      event.aggregateId !== capabilityRunId
    ) {
      throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
    }
    return;
  }
  if (event.messageType === "approval.decision.recorded") {
    const approvalRequestId = requirePayloadIdentifier(
      event,
      "approvalRequestId",
    );
    requirePayloadIdentifier(event, "nodeRunId");
    if (
      event.aggregateType !== "workflow_approval_request" ||
      event.aggregateId !== approvalRequestId
    ) {
      throw new InboxDeliveryError("inbox.event.aggregate_mismatch");
    }
    return;
  }
  throw new InboxDeliveryError("inbox.event.route_mismatch");
}

async function lockWorkflowRun(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<MutableRunState> {
  const [rows] = await connection.execute<WorkflowRunRow[]>(
    `SELECT
       run.id,
       run.workspace_id AS workspaceId,
       run.definition_kind AS definitionKind,
       COALESCE(
         run.workflow_revision_id,
         run.publication_candidate_id
       ) AS definitionId,
       run.lifecycle_status AS lifecycleStatus,
       run.outcome,
       run.input,
       run.output,
       run.output_digest AS outputDigest,
       run.terminal_reason_code AS terminalReasonCode,
       run.execution_deadline_at AS executionDeadlineAt,
       run.execution_plan_snapshot AS executionPlanSnapshot,
       run.execution_plan_hash AS executionPlanHash,
       run.version,
       run.created_at AS createdAt,
       run.created_by AS createdBy,
       run.updated_at AS updatedAt,
       run.completed_at AS completedAt,
       run.cancel_requested_at AS cancelRequestedAt,
       run.cancel_requested_by AS cancelRequestedBy,
       run.cancel_reason_code AS cancelReasonCode,
       run.cancel_deadline_at AS cancelDeadlineAt,
       COALESCE(
         revision.canonical_digest,
         candidate.canonical_digest
       ) AS definitionCanonicalDigest,
       COALESCE(
         revision.output_schema,
         JSON_EXTRACT(candidate.content_document, '$.outputSchema')
       ) AS outputSchema
     FROM workflow_run AS run
     LEFT JOIN workflow_revision AS revision
       ON revision.id = run.workflow_revision_id
       AND revision.workspace_id = run.workspace_id
     LEFT JOIN publication_candidate AS candidate
       ON candidate.id = run.publication_candidate_id
       AND candidate.workspace_id = run.workspace_id
       AND candidate.subject_kind = 'workflow'
     WHERE run.id = ?
     LIMIT 1
     FOR UPDATE`,
    [workflowRunId],
  );
  const row = rows[0];
  if (!row) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    definitionKind: row.definitionKind,
    definitionId: row.definitionId,
    lifecycleStatus: row.lifecycleStatus,
    outcome: row.outcome,
    input: parseJson(row.input),
    output: row.output === null ? null : parseJson(row.output),
    outputDigest: row.outputDigest,
    terminalReasonCode: row.terminalReasonCode,
    executionDeadlineAt: row.executionDeadlineAt,
    executionPlanSnapshot: parseJson(row.executionPlanSnapshot),
    executionPlanHash: row.executionPlanHash,
    version: row.version,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    cancelRequestedAt: row.cancelRequestedAt,
    cancelRequestedBy: row.cancelRequestedBy,
    cancelReasonCode: row.cancelReasonCode,
    cancelDeadlineAt: row.cancelDeadlineAt,
    definitionCanonicalDigest: row.definitionCanonicalDigest,
    outputSchema: asRecord(row.outputSchema, "Workflow output schema"),
  };
}

function parsePlan(run: MutableRunState): {
  readonly plan: PinnedExecutionPlan;
  readonly topology: WorkflowTopologyV1;
} {
  if (
    !canonicalDigestPattern.test(run.executionPlanHash) ||
    digestProviderValue(run.executionPlanSnapshot) !== run.executionPlanHash
  ) {
    return fail(
      "workflow.v1.plan_invalid",
      "Workflow execution plan hash does not match its persisted snapshot.",
    );
  }
  const plan = parseExecutionPlan(run.executionPlanSnapshot);
  const definition =
    plan.workflowDefinition ??
    (plan.workflowRevision
      ? {
          kind: "published_revision" as const,
          ...plan.workflowRevision,
        }
      : undefined);
  if (
    !definition ||
    definition.kind !== run.definitionKind ||
    definition.id !== run.definitionId ||
    definition.canonicalDigest !== run.definitionCanonicalDigest
  ) {
    return fail(
      "workflow.v1.plan_invalid",
      "Execution plan Workflow Definition identity differs from the Run fact.",
    );
  }
  const rawPlan = asRecord(
    run.executionPlanSnapshot,
    "Workflow execution plan",
  );
  const rawTopology = rawPlan.topology;
  if (!isWorkflowTopology(rawTopology)) {
    return fail(
      "workflow.v1.plan_invalid",
      "Execution plan does not contain a valid bounded WorkflowTopology v1.",
    );
  }
  return Object.freeze({
    plan,
    topology: rawTopology,
  });
}

async function loadNodeRuns(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<MutableNodeRun[]> {
  const [rows] = await connection.execute<NodeRunRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       workflow_run_id AS workflowRunId,
       node_key AS nodeKey,
       scope_key AS scopeKey,
       kind,
       lifecycle_status AS lifecycleStatus,
       waiting_reason AS waitingReason,
       activated_at AS activatedAt,
       activation_reason_code AS activationReasonCode,
       activation_digest AS activationDigest,
       input,
       input_digest AS inputDigest,
       output,
       output_digest AS outputDigest,
       error,
       terminal_reason_code AS terminalReasonCode,
       version,
       created_at AS createdAt,
       updated_at AS updatedAt,
       completed_at AS completedAt
     FROM node_run
     WHERE workflow_run_id = ?
     ORDER BY node_key, scope_key, id
     FOR UPDATE`,
    [workflowRunId],
  );
  return rows.map(mutableNode);
}

async function loadCapabilityRuns(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<Map<string, MutableCapabilityRun>> {
  const [rows] = await connection.execute<CapabilityRunRow[]>(
    `SELECT
       capability.id,
       capability.node_run_id AS nodeRunId,
       capability.current_attempt_id AS currentAttemptId,
       capability.lifecycle_status AS lifecycleStatus,
       capability.output,
       (SELECT attempt.error FROM capability_attempt AS attempt WHERE attempt.id = capability.current_attempt_id) AS attemptError,
       capability.cancel_requested_at AS cancelRequestedAt,
       capability.cancel_deadline_at AS cancelDeadlineAt,
       capability.version
     FROM capability_run AS capability
     INNER JOIN node_run AS node
       ON node.id = capability.node_run_id
     WHERE node.workflow_run_id = ?
     ORDER BY capability.id
     FOR UPDATE`,
    [workflowRunId],
  );
  return new Map(rows.map((row) => [row.nodeRunId, mutableCapability(row)]));
}

async function loadActivatedEdges(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<ActivatedEdgeFact[]> {
  const [rows] = await connection.execute<
    (ActivatedEdgeFact & RowDataPacket)[]
  >(
    `SELECT
       id,
       source_node_run_id AS sourceNodeRunId,
       source_node_key AS sourceNodeKey,
       source_scope_key AS sourceScopeKey,
       source_node_version AS sourceNodeVersion,
       target_node_run_id AS targetNodeRunId,
       target_node_key AS targetNodeKey,
       target_scope_key AS targetScopeKey,
       activation_kind AS activationKind,
       switch_decision_id AS switchDecisionId,
       activation_digest AS activationDigest
     FROM workflow_activated_edge
     WHERE workflow_run_id = ?
     ORDER BY activated_at, id
     FOR UPDATE`,
    [workflowRunId],
  );
  return [...rows];
}

async function loadSwitchDecisions(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<Map<string, SwitchDecisionFact>> {
  const [rows] = await connection.execute<
    (SwitchDecisionFact & RowDataPacket)[]
  >(
    `SELECT
       id,
       node_run_id AS nodeRunId,
       input_value AS inputValue,
       input_digest AS inputDigest,
       matched_case_index AS matchedCaseIndex,
       selected_targets AS selectedTargets,
       decision_digest AS decisionDigest
     FROM workflow_switch_decision
     WHERE workflow_run_id = ?
     ORDER BY id
     FOR UPDATE`,
    [workflowRunId],
  );
  return new Map(
    rows.map((row) => [
      row.nodeRunId,
      {
        ...row,
        inputValue: parseJson(row.inputValue),
        selectedTargets: asStringArray(
          row.selectedTargets,
          "Switch selected targets",
        ),
      },
    ]),
  );
}

async function loadApprovals(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<{
  readonly approvals: Map<string, ApprovalFact>;
  readonly decisions: Map<string, ApprovalDecisionFact>;
}> {
  const [approvalRows] = await connection.execute<
    (ApprovalFact & RowDataPacket)[]
  >(
    `SELECT
       request.id,
       request.workspace_id AS workspaceId,
       request.workflow_run_id AS workflowRunId,
       request.node_run_id AS nodeRunId,
       request.definition_kind AS definitionKind,
       request.workflow_revision_id AS workflowRevisionId,
       request.publication_candidate_id AS publicationCandidateId,
       request.execution_plan_hash AS executionPlanHash,
       request.node_input AS nodeInput,
       request.node_input_digest AS nodeInputDigest,
       request.request_payload AS requestPayload,
       request.request_digest AS requestDigest,
       request.decision_schema AS decisionSchema,
       request.decision_schema_digest AS decisionSchemaDigest,
       request.required_permission AS requiredPermission,
       request.authorization_context_digest AS authorizationContextDigest,
       request.expires_at AS expiresAt,
       request.created_at AS createdAt,
       state.lifecycle_status AS lifecycleStatus,
       state.version AS stateVersion
     FROM workflow_approval_request AS request
     INNER JOIN workflow_approval_state AS state
       ON state.approval_request_id = request.id
       AND state.workspace_id = request.workspace_id
     WHERE request.workflow_run_id = ?
     ORDER BY request.id
     FOR UPDATE`,
    [workflowRunId],
  );
  const approvals = new Map(
    approvalRows.map((row) => [
      row.nodeRunId,
      {
        ...row,
        nodeInput: parseJson(row.nodeInput),
        requestPayload: parseJson(row.requestPayload),
        decisionSchema: asRecord(
          row.decisionSchema,
          "Approval decision schema",
        ),
      },
    ]),
  );
  if (approvalRows.length === 0) {
    return {
      approvals,
      decisions: new Map(),
    };
  }
  const [decisionRows] = await connection.execute<
    (ApprovalDecisionFact & RowDataPacket)[]
  >(
    `SELECT
         decision.id,
         decision.approval_request_id AS approvalRequestId,
         decision.actor_principal_id AS actorPrincipalId,
         decision.authorization_decision_id AS authorizationDecisionId,
         decision.authorization_digest AS authorizationDigest,
         decision.decision,
         decision.decision_digest AS decisionDigest,
         decision.decided_at AS decidedAt
       FROM workflow_approval_decision AS decision
       INNER JOIN workflow_approval_request AS request
         ON request.id = decision.approval_request_id
       WHERE request.workflow_run_id = ?
       ORDER BY decision.id
       FOR UPDATE`,
    [workflowRunId],
  );
  return {
    approvals,
    decisions: new Map(
      decisionRows.map((row) => [
        row.approvalRequestId,
        {
          ...row,
          decision: parseJson(row.decision),
        },
      ]),
    ),
  };
}

async function loadMaps(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<{
  readonly expansions: Map<string, MutableMapExpansion>;
  readonly items: Map<string, MapItemFact[]>;
}> {
  const [expansionRows] = await connection.execute<MapExpansionRow[]>(
    `SELECT
         expansion.id,
         expansion.coordinator_node_run_id AS coordinatorNodeRunId,
         expansion.items,
         expansion.items_digest AS itemsDigest,
         expansion.scope_keys AS scopeKeys,
         expansion.scope_keys_digest AS scopeKeysDigest,
         expansion.item_count AS itemCount,
         expansion.max_items AS maxItems,
         expansion.max_concurrency AS maxConcurrency,
         expansion.failure_mode AS failureMode,
         expansion.expansion_digest AS expansionDigest,
         state.lifecycle_status AS lifecycleStatus,
         state.next_item_index AS nextItemIndex,
         state.active_count AS activeCount,
         state.completed_count AS completedCount,
         state.failed_count AS failedCount,
         state.cancelled_count AS cancelledCount,
         state.skipped_count AS skippedCount,
         state.stop_reason_code AS stopReasonCode,
         state.version AS stateVersion,
         state.completed_at AS completedAt
       FROM workflow_map_expansion AS expansion
       INNER JOIN workflow_map_state AS state
         ON state.map_expansion_id = expansion.id
         AND state.workspace_id = expansion.workspace_id
       WHERE expansion.workflow_run_id = ?
       ORDER BY expansion.id
       FOR UPDATE`,
    [workflowRunId],
  );
  const expansions = new Map<string, MutableMapExpansion>();
  for (const row of expansionRows) {
    const items = asArray(row.items, "Map expansion items");
    const scopeKeys = asStringArray(row.scopeKeys, "Map expansion scope keys");
    if (
      items.length !== row.itemCount ||
      scopeKeys.length !== row.itemCount ||
      digestProviderValue(items) !== row.itemsDigest ||
      digestProviderValue(scopeKeys) !== row.scopeKeysDigest
    ) {
      fail(
        "workflow.v1.fact_conflict",
        "Map expansion immutable inputs do not match their persisted digests.",
      );
    }
    expansions.set(row.coordinatorNodeRunId, {
      id: row.id,
      coordinatorNodeRunId: row.coordinatorNodeRunId,
      items,
      itemsDigest: row.itemsDigest,
      scopeKeys,
      scopeKeysDigest: row.scopeKeysDigest,
      itemCount: row.itemCount,
      maxItems: row.maxItems,
      maxConcurrency: row.maxConcurrency,
      failureMode: row.failureMode,
      expansionDigest: row.expansionDigest,
      lifecycleStatus: row.lifecycleStatus,
      nextItemIndex: row.nextItemIndex,
      activeCount: row.activeCount,
      completedCount: row.completedCount,
      failedCount: row.failedCount,
      cancelledCount: row.cancelledCount,
      skippedCount: row.skippedCount,
      stopReasonCode: row.stopReasonCode,
      stateVersion: row.stateVersion,
      completedAt: row.completedAt,
    });
  }
  const mapItems = new Map<string, MapItemFact[]>();
  if (expansionRows.length === 0) {
    return {
      expansions,
      items: mapItems,
    };
  }
  const [itemRows] = await connection.execute<(MapItemFact & RowDataPacket)[]>(
    `SELECT
       item.id,
       item.map_expansion_id AS mapExpansionId,
       item.coordinator_node_run_id AS coordinatorNodeRunId,
       item.item_node_run_id AS itemNodeRunId,
       item.item_index AS itemIndex,
       item.scope_key AS scopeKey,
       item.item_value AS itemValue,
       item.item_digest AS itemDigest,
       item.input_digest AS inputDigest
     FROM workflow_map_item AS item
     WHERE item.workflow_run_id = ?
     ORDER BY item.map_expansion_id, item.item_index
     FOR UPDATE`,
    [workflowRunId],
  );
  for (const row of itemRows) {
    const parsed: MapItemFact = {
      ...row,
      itemValue: parseJson(row.itemValue),
    };
    const values = mapItems.get(row.mapExpansionId) ?? [];
    values.push(parsed);
    mapItems.set(row.mapExpansionId, values);
  }
  return {
    expansions,
    items: mapItems,
  };
}

async function loadDeadlineSchedule(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<DeadlineScheduleFact | undefined> {
  const [rows] = await connection.execute<
    (DeadlineScheduleFact & RowDataPacket)[]
  >(
    `SELECT
       id,
       workflow_run_id AS workflowRunId,
       execution_plan_hash AS executionPlanHash,
       execution_deadline_at AS executionDeadlineAt,
       outbox_event_id AS outboxEventId,
       schedule_digest AS scheduleDigest
     FROM workflow_deadline_schedule
     WHERE workflow_run_id = ?
     LIMIT 1
     FOR UPDATE`,
    [workflowRunId],
  );
  return rows[0];
}

async function loadCapabilityCancellations(
  connection: PoolConnection,
  workflowRunId: string,
): Promise<Map<string, CapabilityCancellationFact>> {
  const [rows] = await connection.execute<
    (CapabilityCancellationFact & RowDataPacket)[]
  >(
    `SELECT
       id,
       capability_run_id AS capabilityRunId,
       capability_attempt_id AS capabilityAttemptId,
       source_kind AS sourceKind,
       source_id AS sourceId,
       reason_code AS reasonCode,
       requested_at AS requestedAt,
       cancel_deadline_at AS cancelDeadlineAt,
       request_digest AS requestDigest
     FROM workflow_capability_cancellation_request
     WHERE workflow_run_id = ?
     ORDER BY capability_run_id
     FOR UPDATE`,
    [workflowRunId],
  );
  return new Map(rows.map((row) => [row.capabilityRunId, row]));
}

function assertCauseFact(
  event: CanonicalInboxEvent,
  state: FrontierState,
): "current" | "stale" {
  if (event.messageType === "workflow.wakeup.requested") {
    if (event.aggregateType === "workflow_deadline_schedule") {
      const schedule = state.deadlineSchedule;
      if (
        !schedule ||
        schedule.id !== event.aggregateId ||
        schedule.outboxEventId !== event.eventId ||
        event.aggregateVersion !== 1 ||
        schedule.workflowRunId !== state.run.id ||
        schedule.executionPlanHash !== state.run.executionPlanHash ||
        schedule.executionDeadlineAt.getTime() !==
          executionDeadline(state).getTime()
      ) {
        throw new InboxDeliveryError("inbox.event.fact_mismatch");
      }
      return "current";
    }
    if (event.aggregateVersion > state.run.version) {
      throw new InboxDeliveryError("inbox.event.future_version");
    }
    return event.aggregateVersion < state.run.version ? "stale" : "current";
  }
  if (
    event.messageType === "capability.run.completed" ||
    event.messageType === "capability.run.failed" ||
    event.messageType === "capability.run.cancelled"
  ) {
    const capabilityRunId = requirePayloadIdentifier(event, "capabilityRunId");
    const nodeRunId = requirePayloadIdentifier(event, "nodeRunId");
    const node = state.nodes.find((candidate) => candidate.id === nodeRunId);
    const capability = node
      ? state.capabilitiesByNodeId.get(node.id)
      : undefined;
    if (
      !node ||
      !capability ||
      capability.id !== capabilityRunId ||
      capability.id !== event.aggregateId
    ) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
    if (event.aggregateVersion > capability.version) {
      throw new InboxDeliveryError("inbox.event.future_version");
    }
    if (event.aggregateVersion < capability.version) {
      return "stale";
    }
    let expectedStatus = "cancelled";
    if (event.messageType === "capability.run.completed") {
      expectedStatus = "completed";
    } else if (event.messageType === "capability.run.failed") {
      expectedStatus = "failed";
    }
    if (capability.lifecycleStatus !== expectedStatus) {
      throw new InboxDeliveryError("inbox.event.fact_mismatch");
    }
    return "current";
  }
  const approvalRequestId = requirePayloadIdentifier(
    event,
    "approvalRequestId",
  );
  const nodeRunId = requirePayloadIdentifier(event, "nodeRunId");
  const approval = state.approvalsByNodeId.get(nodeRunId);
  if (
    !approval ||
    approval.id !== approvalRequestId ||
    approval.id !== event.aggregateId
  ) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  if (event.aggregateVersion > approval.stateVersion) {
    throw new InboxDeliveryError("inbox.event.future_version");
  }
  if (event.aggregateVersion < approval.stateVersion) {
    return "stale";
  }
  if (
    approval.lifecycleStatus !== "decided" ||
    !state.approvalDecisionsByRequestId.has(approval.id)
  ) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  return "current";
}

async function loadFrontierState(
  connection: PoolConnection,
  configuration: NormalizedConfiguration,
  options: ConsumeBoundedWorkflowFrontierOptions,
): Promise<FrontierState> {
  const run = await lockWorkflowRun(connection, options.workflowRunId);
  if (run.workspaceId !== options.delivery.workspaceId) {
    throw new InboxDeliveryError("inbox.event.fact_mismatch");
  }
  const { plan, topology } = parsePlan(run);
  const nodes = await loadNodeRuns(connection, run.id);
  const rootNodes = nodes.filter((node) => node.scopeKey === "root");
  const topologyByKey = new Map(topology.nodes.map((node) => [node.key, node]));
  if (
    rootNodes.length !== topology.nodes.length ||
    rootNodes.some((node) => {
      const topologyNode = topologyByKey.get(node.nodeKey);
      return !topologyNode || topologyNode.kind !== node.kind;
    })
  ) {
    return fail(
      "workflow.v1.fact_conflict",
      "Root NodeRun facts do not exactly match the pinned WorkflowTopology.",
    );
  }
  const [
    capabilitiesByNodeId,
    edges,
    switchDecisionsByNodeId,
    approvalFacts,
    mapFacts,
    deadlineSchedule,
    cancellationsByCapabilityId,
  ] = await Promise.all([
    loadCapabilityRuns(connection, run.id),
    loadActivatedEdges(connection, run.id),
    loadSwitchDecisions(connection, run.id),
    loadApprovals(connection, run.id),
    loadMaps(connection, run.id),
    loadDeadlineSchedule(connection, run.id),
    loadCapabilityCancellations(connection, run.id),
  ]);
  const nodesByIdentity = new Map(
    nodes.map((node) => [nodeIdentity(node.nodeKey, node.scopeKey), node]),
  );
  return {
    connection,
    configuration,
    executionGeneration: options.executionGeneration,
    now: options.now,
    topology,
    plan,
    orderedTopologyNodes: topologicallyOrderWorkflowNodes(topology),
    run,
    nodes,
    nodesByIdentity,
    capabilitiesByNodeId,
    edges,
    switchDecisionsByNodeId,
    approvalsByNodeId: approvalFacts.approvals,
    approvalDecisionsByRequestId: approvalFacts.decisions,
    mapExpansionsByNodeId: mapFacts.expansions,
    mapItemsByExpansionId: mapFacts.items,
    wakeups: [],
    deadlineSchedule,
    cancellationsByCapabilityId,
    predecessorKeys: buildPredecessorKeys(topology),
    transitions: 0,
    nodeCreates: 0,
    runChanged: false,
    continuationRequired: false,
  };
}

function sealExecutionDeadline(state: FrontierState): void {
  const pinnedDeadline = new Date(
    state.run.createdAt.getTime() + state.topology.limits.timeoutMs,
  );
  if (
    Number.isNaN(pinnedDeadline.getTime()) ||
    pinnedDeadline <= state.run.createdAt
  ) {
    fail(
      "workflow.v1.plan_invalid",
      "Pinned Workflow timeout does not produce a valid execution deadline.",
    );
  }
  if (state.run.executionDeadlineAt.getTime() !== pinnedDeadline.getTime()) {
    fail(
      "workflow.v1.fact_conflict",
      "WorkflowRun execution_deadline_at differs from the pinned topology timeout.",
    );
  }
}

function executionDeadline(state: FrontierState): Date {
  return state.run.executionDeadlineAt;
}

function executionDeadlineReached(state: FrontierState): boolean {
  return state.now >= executionDeadline(state);
}

async function ensureDeadlineSchedule(state: FrontierState): Promise<void> {
  const expectedDigest = digestProviderValue({
    workflowRunId: state.run.id,
    executionPlanHash: state.run.executionPlanHash,
    executionDeadlineAt: executionDeadline(state).toISOString(),
  });
  if (state.deadlineSchedule) {
    if (
      state.deadlineSchedule.workflowRunId !== state.run.id ||
      state.deadlineSchedule.executionPlanHash !==
        state.run.executionPlanHash ||
      state.deadlineSchedule.executionDeadlineAt.getTime() !==
        executionDeadline(state).getTime() ||
      state.deadlineSchedule.scheduleDigest !== expectedDigest
    ) {
      fail(
        "workflow.v1.fact_conflict",
        "Workflow deadline schedule differs from the sealed Run deadline.",
      );
    }
    return;
  }
  if (!takeTransition(state)) {
    return;
  }
  const scheduleId = nextId(state.configuration, "deadline_schedule");
  const outboxEventId = nextId(state.configuration, "run_wakeup");
  await state.connection.execute<ResultSetHeader>(
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
       publish_attempts,
       created_at
     ) VALUES (
       ?, ?, 'workflow.wakeup.requested', 1,
       'workflow_deadline_schedule', ?, 1, ?, 'pending', ?, 0, ?
     )`,
    [
      outboxEventId,
      state.run.workspaceId,
      scheduleId,
      jsonForDatabase({
        workflowRunId: state.run.id,
        deadlineScheduleId: scheduleId,
        executionDeadlineAt: executionDeadline(state).toISOString(),
        expectedGeneration: state.executionGeneration,
        cause: "workflow.deadline",
      }),
      executionDeadline(state),
      state.now,
    ],
  );
  await state.connection.execute<ResultSetHeader>(
    `INSERT INTO workflow_deadline_schedule (
       id,
       workspace_id,
       workflow_run_id,
       execution_plan_hash,
       execution_deadline_at,
       outbox_event_id,
       schedule_digest,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scheduleId,
      state.run.workspaceId,
      state.run.id,
      state.run.executionPlanHash,
      executionDeadline(state),
      outboxEventId,
      expectedDigest,
      state.now,
    ],
  );
  state.deadlineSchedule = {
    id: scheduleId,
    workflowRunId: state.run.id,
    executionPlanHash: state.run.executionPlanHash,
    executionDeadlineAt: executionDeadline(state),
    outboxEventId,
    scheduleDigest: expectedDigest,
  };
  state.runChanged = true;
}

async function requestCapabilityCancellation(
  state: FrontierState,
  capability: MutableCapabilityRun,
  sourceKind: "workflow_deadline" | "map_fail_fast",
  sourceId: string,
  reasonCode: string,
): Promise<boolean> {
  if (
    capability.lifecycleStatus === "completed" ||
    capability.lifecycleStatus === "failed" ||
    capability.lifecycleStatus === "cancelled"
  ) {
    return false;
  }
  if (!capability.currentAttemptId) {
    fail(
      "workflow.v1.fact_conflict",
      `Active CapabilityRun ${capability.id} has no current Attempt.`,
    );
  }
  const existing = state.cancellationsByCapabilityId.get(capability.id);
  if (existing) {
    if (
      existing.capabilityAttemptId !== capability.currentAttemptId ||
      capability.cancelRequestedAt === null ||
      capability.cancelDeadlineAt === null
    ) {
      fail(
        "workflow.v1.fact_conflict",
        `Capability cancellation fact ${existing.id} does not match mutable cancellation columns.`,
      );
    }
    return false;
  }
  if (
    capability.cancelRequestedAt !== null ||
    capability.cancelDeadlineAt !== null
  ) {
    if (
      capability.cancelRequestedAt === null ||
      capability.cancelDeadlineAt === null
    ) {
      fail(
        "workflow.v1.fact_conflict",
        `CapabilityRun ${capability.id} has a partial cancellation request.`,
      );
    }
    return false;
  }
  if (!takeTransition(state)) {
    return false;
  }
  const cancelDeadlineAt = new Date(
    Math.max(
      state.now.getTime(),
      Math.min(
        state.now.getTime() +
          state.configuration.cooperativeCancellationGraceMs,
        executionDeadline(state).getTime(),
      ),
    ),
  );
  const requestDigest = digestProviderValue({
    workflowRunId: state.run.id,
    capabilityRunId: capability.id,
    capabilityAttemptId: capability.currentAttemptId,
    sourceKind,
    sourceId,
    reasonCode,
    requestedAt: state.now.toISOString(),
    cancelDeadlineAt: cancelDeadlineAt.toISOString(),
  });
  const cancellationId = nextId(state.configuration, "capability_cancellation");
  const nextCapabilityVersion = capability.version + 1;
  const [capabilityUpdate] = await state.connection.execute<ResultSetHeader>(
    `UPDATE capability_run
       SET cancel_requested_at = ?,
           cancel_deadline_at = ?,
           version = ?,
           updated_at = ?
       WHERE id = ?
         AND version = ?
         AND lifecycle_status IN ('queued', 'running')
         AND current_attempt_id = ?
         AND accepted_attempt_id IS NULL
         AND cancel_requested_at IS NULL
         AND cancel_deadline_at IS NULL`,
    [
      state.now,
      cancelDeadlineAt,
      nextCapabilityVersion,
      state.now,
      capability.id,
      capability.version,
      capability.currentAttemptId,
    ],
  );
  if (capabilityUpdate.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `CapabilityRun ${capability.id} cancellation lost arbitration.`,
    );
  }
  const [attemptUpdate] = await state.connection.execute<ResultSetHeader>(
    `UPDATE capability_attempt
       SET cancel_requested_at = ?,
           cancel_deadline_at = ?,
           version = version + 1,
           updated_at = ?
       WHERE id = ?
         AND capability_run_id = ?
         AND lifecycle_status IN ('created', 'running')
         AND cancel_requested_at IS NULL
         AND cancel_deadline_at IS NULL`,
    [
      state.now,
      cancelDeadlineAt,
      state.now,
      capability.currentAttemptId,
      capability.id,
    ],
  );
  if (attemptUpdate.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `CapabilityAttempt ${capability.currentAttemptId} cancellation lost arbitration.`,
    );
  }
  await state.connection.execute<ResultSetHeader>(
    `INSERT INTO workflow_capability_cancellation_request (
       id,
       workspace_id,
       workflow_run_id,
       capability_run_id,
       capability_attempt_id,
       source_kind,
       source_id,
       reason_code,
       requested_at,
       cancel_deadline_at,
       request_digest
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cancellationId,
      state.run.workspaceId,
      state.run.id,
      capability.id,
      capability.currentAttemptId,
      sourceKind,
      sourceId,
      reasonCode,
      state.now,
      cancelDeadlineAt,
      requestDigest,
    ],
  );
  const fact: CapabilityCancellationFact = {
    id: cancellationId,
    capabilityRunId: capability.id,
    capabilityAttemptId: capability.currentAttemptId,
    sourceKind,
    sourceId,
    reasonCode,
    requestedAt: state.now,
    cancelDeadlineAt,
    requestDigest,
  };
  state.cancellationsByCapabilityId.set(capability.id, fact);
  capability.cancelRequestedAt = state.now;
  capability.cancelDeadlineAt = cancelDeadlineAt;
  capability.version = nextCapabilityVersion;
  state.runChanged = true;
  return true;
}

async function hasWorkflowCancellationOutbox(
  state: FrontierState,
): Promise<boolean> {
  const [rows] = await state.connection.execute<
    ({ readonly id: string } & RowDataPacket)[]
  >(
    `SELECT id
     FROM outbox_event
     WHERE workspace_id = ?
       AND message_type = 'workflow.cancel.requested'
       AND aggregate_type = 'workflow_run'
       AND aggregate_id = ?
     LIMIT 1`,
    [state.run.workspaceId, state.run.id],
  );
  return rows.length > 0;
}

async function propagateDeadlineCancellation(
  state: FrontierState,
): Promise<void> {
  if (
    state.run.lifecycleStatus !== "cancelling" ||
    state.run.cancelReasonCode !== "workflow.timeout"
  ) {
    if (!takeTransition(state)) {
      return;
    }
    state.run.lifecycleStatus = "cancelling";
    state.run.cancelRequestedAt = state.run.cancelRequestedAt ?? state.now;
    state.run.cancelRequestedBy =
      state.run.cancelRequestedBy ?? state.run.createdBy;
    state.run.cancelReasonCode = "workflow.timeout";
    state.run.cancelDeadlineAt = state.run.cancelDeadlineAt ?? state.now;
    state.runChanged = true;
  }
  const activeCapabilities = [...state.capabilitiesByNodeId.values()]
    .filter(
      (capability) =>
        capability.lifecycleStatus === "queued" ||
        capability.lifecycleStatus === "running",
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const capability of activeCapabilities) {
    await requestCapabilityCancellation(
      state,
      capability,
      "workflow_deadline",
      state.run.id,
      "workflow.timeout",
    );
    if (state.transitions >= state.configuration.maximumTransitionsPerWakeup) {
      break;
    }
  }
  const hasUnrequested = activeCapabilities.some(
    (capability) => capability.cancelRequestedAt === null,
  );
  if (hasUnrequested) {
    state.continuationRequired = true;
    return;
  }
  if (!(await hasWorkflowCancellationOutbox(state))) {
    if (!takeTransition(state)) {
      return;
    }
    state.wakeups.push({
      id: nextId(state.configuration, "run_wakeup"),
      messageType: "workflow.cancel.requested",
      cause: "workflow.timeout",
      availableAt: state.now,
    });
    state.runChanged = true;
  }
}

async function cancelApprovalStateForDeadline(
  state: FrontierState,
  node: MutableNodeRun,
): Promise<boolean> {
  const approval = state.approvalsByNodeId.get(node.id);
  if (!approval || approval.lifecycleStatus !== "pending") {
    return true;
  }
  if (!takeTransition(state)) {
    return false;
  }
  const nextVersion = approval.stateVersion + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE workflow_approval_state
     SET lifecycle_status = 'cancelled',
         version = ?,
         updated_at = ?,
         cancelled_at = ?
     WHERE approval_request_id = ?
       AND version = ?
       AND lifecycle_status = 'pending'`,
    [nextVersion, state.now, state.now, approval.id, approval.stateVersion],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      "Approval deadline cancellation lost state arbitration.",
    );
  }
  state.approvalsByNodeId.set(node.id, {
    ...approval,
    lifecycleStatus: "cancelled",
    stateVersion: nextVersion,
  });
  state.runChanged = true;
  return true;
}

async function convergeDeadlineCancellation(
  state: FrontierState,
): Promise<void> {
  await propagateDeadlineCancellation(state);
  const activeCapabilities = [...state.capabilitiesByNodeId.values()].filter(
    (capability) =>
      capability.lifecycleStatus === "queued" ||
      capability.lifecycleStatus === "running",
  );
  if (
    activeCapabilities.some(
      (capability) => capability.cancelRequestedAt === null,
    )
  ) {
    state.continuationRequired = true;
    return;
  }
  if (activeCapabilities.length > 0) {
    return;
  }
  const pendingNodes = state.nodes
    .filter((node) => !isTerminalNode(node))
    .sort((left, right) => {
      const leftRoot = left.scopeKey === "root" ? 1 : 0;
      const rightRoot = right.scopeKey === "root" ? 1 : 0;
      return (
        leftRoot - rightRoot ||
        left.nodeKey.localeCompare(right.nodeKey) ||
        left.scopeKey.localeCompare(right.scopeKey)
      );
    });
  for (const node of pendingNodes) {
    if (node.kind === "approval") {
      const cancelled = await cancelApprovalStateForDeadline(state, node);
      if (!cancelled) {
        return;
      }
    }
    if (node.kind === "map" && node.scopeKey === "root") {
      const expansion = state.mapExpansionsByNodeId.get(node.id);
      if (
        expansion &&
        expansion.lifecycleStatus !== "completed" &&
        expansion.lifecycleStatus !== "failed"
      ) {
        const persisted = await persistMapState(
          state,
          expansion,
          mapCounters(state, expansion),
          "failed",
          "workflow.timeout",
          state.now,
        );
        if (!persisted) {
          return;
        }
      }
    }
    if (!takeTransition(state)) {
      return;
    }
    await markNodeTerminal(
      state,
      node,
      "cancelled",
      "workflow.timeout",
      noJsonValue,
      errorEnvelope("workflow.timeout"),
    );
  }
  if (state.nodes.some((node) => !isTerminalNode(node))) {
    state.continuationRequired = true;
    return;
  }
  if (!takeTransition(state)) {
    return;
  }
  state.run.lifecycleStatus = "cancelled";
  state.run.outcome = null;
  state.run.output = null;
  state.run.outputDigest = null;
  state.run.terminalReasonCode = "workflow.timeout";
  state.run.completedAt = state.now;
  state.runChanged = true;
}

const noJsonValue = Symbol("no-json-value");

function jsonForDatabase(value: unknown): string {
  return canonicalizeProviderValue(value);
}

function errorEnvelope(
  code: string,
  detail?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    code,
    ...(detail ?? {}),
  });
}

function valueContext(
  state: FrontierState,
  currentScopeKey: string,
  mapItem?: unknown,
): ResolveWorkflowValueContext {
  return {
    workflowInput: state.run.input,
    currentScopeKey,
    ...(mapItem !== undefined ? { mapItem } : {}),
    getNodeResult(nodeKey, scopeKey) {
      const node = state.nodesByIdentity.get(nodeIdentity(nodeKey, scopeKey));
      if (!node || !isTerminalNode(node)) {
        return undefined;
      }
      const status = node.lifecycleStatus as WorkflowTerminalNodeStatus;
      return {
        status,
        ...(status === "completed" ? { output: node.output } : {}),
        ...(node.error !== null ? { error: node.error } : {}),
      };
    },
  };
}

async function updateNodeActivation(
  state: FrontierState,
  node: MutableNodeRun,
  reasonCode: string,
  activationDigest: string,
): Promise<void> {
  if (node.activatedAt !== null) {
    if (
      node.activationReasonCode !== reasonCode ||
      node.activationDigest !== activationDigest
    ) {
      fail(
        "workflow.v1.fact_conflict",
        `Node ${node.nodeKey}/${node.scopeKey} has a conflicting activation fact.`,
      );
    }
    return;
  }
  const nextVersion = node.version + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE node_run
     SET activated_at = ?,
         activation_reason_code = ?,
         activation_digest = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?
       AND workflow_run_id = ?
       AND version = ?
       AND lifecycle_status = 'pending'
       AND activated_at IS NULL`,
    [
      state.now,
      reasonCode,
      activationDigest,
      nextVersion,
      state.now,
      node.id,
      state.run.id,
      node.version,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `Node ${node.nodeKey}/${node.scopeKey} activation lost optimistic arbitration.`,
    );
  }
  node.activatedAt = state.now;
  node.activationReasonCode = reasonCode;
  node.activationDigest = activationDigest;
  node.version = nextVersion;
  node.updatedAt = state.now;
  state.runChanged = true;
}

function findEdge(
  state: FrontierState,
  sourceNodeKey: string,
  sourceScopeKey: string,
  targetNodeKey: string,
  targetScopeKey: string,
): ActivatedEdgeFact | undefined {
  return state.edges.find(
    (edge) =>
      edge.sourceNodeKey === sourceNodeKey &&
      edge.sourceScopeKey === sourceScopeKey &&
      edge.targetNodeKey === targetNodeKey &&
      edge.targetScopeKey === targetScopeKey,
  );
}

async function insertActivatedEdge(
  state: FrontierState,
  options: {
    readonly sourceNode: MutableNodeRun | undefined;
    readonly targetNode: MutableNodeRun;
    readonly activationKind: "entry" | "declared" | "switch" | "map_item";
    readonly switchDecisionId?: string;
    readonly switchDecisionDigest?: string;
  },
): Promise<ActivatedEdgeFact> {
  const sourceNodeKey = options.sourceNode?.nodeKey ?? "__entry__";
  const sourceScopeKey = options.sourceNode?.scopeKey ?? "root";
  const existing = findEdge(
    state,
    sourceNodeKey,
    sourceScopeKey,
    options.targetNode.nodeKey,
    options.targetNode.scopeKey,
  );
  const digest = digestProviderValue({
    workflowRunId: state.run.id,
    sourceNodeRunId: options.sourceNode?.id ?? null,
    sourceNodeKey,
    sourceScopeKey,
    sourceNodeVersion: options.sourceNode?.version ?? 1,
    targetNodeRunId: options.targetNode.id,
    targetNodeKey: options.targetNode.nodeKey,
    targetScopeKey: options.targetNode.scopeKey,
    activationKind: options.activationKind,
    switchDecisionDigest: options.switchDecisionDigest ?? null,
  });
  if (existing) {
    if (
      existing.sourceNodeRunId !== (options.sourceNode?.id ?? null) ||
      existing.targetNodeRunId !== options.targetNode.id ||
      existing.activationKind !== options.activationKind ||
      existing.switchDecisionId !== (options.switchDecisionId ?? null) ||
      existing.activationDigest !== digest
    ) {
      fail(
        "workflow.v1.fact_conflict",
        "An ActivatedEdge uniqueness key resolves to different immutable facts.",
      );
    }
    return existing;
  }
  const edge: ActivatedEdgeFact = {
    id: nextId(state.configuration, "activated_edge"),
    sourceNodeRunId: options.sourceNode?.id ?? null,
    sourceNodeKey,
    sourceScopeKey,
    sourceNodeVersion: options.sourceNode?.version ?? 1,
    targetNodeRunId: options.targetNode.id,
    targetNodeKey: options.targetNode.nodeKey,
    targetScopeKey: options.targetNode.scopeKey,
    activationKind: options.activationKind,
    switchDecisionId: options.switchDecisionId ?? null,
    activationDigest: digest,
  };
  await state.connection.execute<ResultSetHeader>(
    `INSERT INTO workflow_activated_edge (
       id,
       workspace_id,
       workflow_run_id,
       source_node_run_id,
       source_node_key,
       source_scope_key,
       source_node_version,
       target_node_run_id,
       target_node_key,
       target_scope_key,
       activation_kind,
       switch_decision_id,
       activation_digest,
       activated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      edge.id,
      state.run.workspaceId,
      state.run.id,
      edge.sourceNodeRunId,
      edge.sourceNodeKey,
      edge.sourceScopeKey,
      edge.sourceNodeVersion,
      edge.targetNodeRunId,
      edge.targetNodeKey,
      edge.targetScopeKey,
      edge.activationKind,
      edge.switchDecisionId,
      edge.activationDigest,
      state.now,
    ],
  );
  state.edges.push(edge);
  state.runChanged = true;
  return edge;
}

function declaredTargets(node: WorkflowTopologyNodeV1): readonly string[] {
  return node.kind === "switch" ? [] : node.next;
}

async function insertDeclaredOutgoingEdges(
  state: FrontierState,
  sourceNode: MutableNodeRun,
  topologyNode: WorkflowTopologyNodeV1,
): Promise<void> {
  for (const targetKey of declaredTargets(topologyNode)) {
    const targetNode = state.nodesByIdentity.get(
      nodeIdentity(targetKey, "root"),
    );
    if (!targetNode) {
      fail(
        "workflow.v1.fact_conflict",
        `Declared target ${targetKey} has no root NodeRun.`,
      );
    }
    await insertActivatedEdge(state, {
      sourceNode,
      targetNode,
      activationKind: "declared",
    });
  }
}

async function activateRootNode(
  state: FrontierState,
  node: MutableNodeRun,
  topologyNode: WorkflowTopologyNodeV1,
  reasonCode: string,
  activationDigest: string,
): Promise<void> {
  await updateNodeActivation(state, node, reasonCode, activationDigest);
  await insertDeclaredOutgoingEdges(state, node, topologyNode);
}

async function markNodeTerminal(
  state: FrontierState,
  node: MutableNodeRun,
  status: Extract<
    NodeLifecycleStatus,
    "completed" | "failed" | "skipped" | "cancelled"
  >,
  reasonCode: string,
  output: unknown,
  error: unknown,
): Promise<void> {
  if (!reasonCodePattern.test(reasonCode)) {
    fail(
      "workflow.v1.fact_conflict",
      `Invalid NodeRun terminal reason ${reasonCode}.`,
    );
  }
  if (isTerminalNode(node)) {
    return;
  }
  const persistedOutput =
    output === noJsonValue ? null : jsonForDatabase(output);
  const outputDigest =
    output === noJsonValue ? null : digestProviderValue(output);
  const persistedError = error === noJsonValue ? null : jsonForDatabase(error);
  const nextVersion = node.version + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE node_run
     SET lifecycle_status = ?,
         waiting_reason = NULL,
         output = ?,
         output_digest = ?,
         error = ?,
         terminal_reason_code = ?,
         version = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND workflow_run_id = ?
       AND version = ?
       AND lifecycle_status IN ('pending', 'running', 'waiting')`,
    [
      status,
      persistedOutput,
      outputDigest,
      persistedError,
      reasonCode,
      nextVersion,
      state.now,
      state.now,
      node.id,
      state.run.id,
      node.version,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `Node ${node.nodeKey}/${node.scopeKey} terminal projection lost optimistic arbitration.`,
    );
  }
  node.lifecycleStatus = status;
  node.waitingReason = null;
  node.output = output === noJsonValue ? null : output;
  node.outputDigest = outputDigest;
  node.error = error === noJsonValue ? null : error;
  node.terminalReasonCode = reasonCode;
  node.version = nextVersion;
  node.updatedAt = state.now;
  node.completedAt = state.now;
  state.runChanged = true;
}

async function markPendingNodeSkipped(
  state: FrontierState,
  node: MutableNodeRun,
  reason: "workflow.branch_not_selected" | "workflow.upstream_not_successful",
  incomingEdges: readonly ActivatedEdgeFact[],
): Promise<void> {
  if (reason === "workflow.upstream_not_successful") {
    const activationDigest = digestProviderValue({
      workflowRunId: state.run.id,
      nodeRunId: node.id,
      reason,
      incomingEdges: incomingEdges.map((edge) => ({
        id: edge.id,
        activationDigest: edge.activationDigest,
      })),
    });
    await updateNodeActivation(
      state,
      node,
      "join.upstream_not_successful",
      activationDigest,
    );
  }
  await markNodeTerminal(
    state,
    node,
    "skipped",
    reason,
    noJsonValue,
    errorEnvelope(reason),
  );
}

function sourceNodeForEdge(
  state: FrontierState,
  edge: ActivatedEdgeFact,
): MutableNodeRun | undefined {
  if (edge.sourceNodeRunId === null) {
    return undefined;
  }
  return state.nodes.find((node) => node.id === edge.sourceNodeRunId);
}

function allPotentialIncomingResolved(
  state: FrontierState,
  targetNodeKey: string,
): boolean {
  const predecessors = state.predecessorKeys.get(targetNodeKey) ?? [];
  const topologyByKey = new Map(
    state.topology.nodes.map((node) => [node.key, node]),
  );
  for (const predecessorKey of predecessors) {
    const source = state.nodesByIdentity.get(
      nodeIdentity(predecessorKey, "root"),
    );
    const sourceTopology = topologyByKey.get(predecessorKey);
    if (!source || !sourceTopology) {
      fail(
        "workflow.v1.fact_conflict",
        `Potential predecessor ${predecessorKey} has no pinned facts.`,
      );
    }
    const edge = findEdge(state, predecessorKey, "root", targetNodeKey, "root");
    if (sourceTopology.kind === "switch") {
      const decision = state.switchDecisionsByNodeId.get(source.id);
      if (decision) {
        const selectedTargets = asStringArray(
          decision.selectedTargets,
          "Switch selected targets",
        );
        if (selectedTargets.includes(targetNodeKey) !== Boolean(edge)) {
          fail(
            "workflow.v1.fact_conflict",
            `Switch decision and ActivatedEdge disagree for ${predecessorKey} -> ${targetNodeKey}.`,
          );
        }
        continue;
      }
      if (isTerminalNode(source)) {
        if (source.lifecycleStatus === "completed") {
          fail(
            "workflow.v1.fact_conflict",
            `Completed Switch ${predecessorKey} has no immutable decision.`,
          );
        }
        continue;
      }
      return false;
    }
    if (source.activatedAt !== null) {
      if (!edge) {
        fail(
          "workflow.v1.fact_conflict",
          `Activated source ${predecessorKey} is missing its declared edge to ${targetNodeKey}.`,
        );
      }
      continue;
    }
    if (isTerminalNode(source)) {
      continue;
    }
    return false;
  }
  return true;
}

async function activateOrSkipPendingRootNode(
  state: FrontierState,
  topologyNode: WorkflowTopologyNodeV1,
  node: MutableNodeRun,
): Promise<boolean> {
  if (node.lifecycleStatus !== "pending" || node.activatedAt !== null) {
    return false;
  }
  const isEntry = topologyNode.key === state.topology.entryNodeKey;
  let incomingEdges = state.edges.filter(
    (edge) =>
      edge.targetNodeRunId === node.id && edge.targetScopeKey === "root",
  );
  if (isEntry) {
    if (incomingEdges.length === 0) {
      if (!takeTransition(state)) {
        return false;
      }
      const edge = await insertActivatedEdge(state, {
        sourceNode: undefined,
        targetNode: node,
        activationKind: "entry",
      });
      incomingEdges = [edge];
    }
    const entryDigest = digestProviderValue({
      workflowRunId: state.run.id,
      nodeRunId: node.id,
      entryEdge: incomingEdges[0]?.activationDigest,
    });
    await activateRootNode(
      state,
      node,
      topologyNode,
      "workflow.entry",
      entryDigest,
    );
    return true;
  }
  const sourceStatuses = incomingEdges.map((edge) => {
    const source = sourceNodeForEdge(state, edge);
    if (!source) {
      fail(
        "workflow.v1.fact_conflict",
        "A non-entry ActivatedEdge has no source NodeRun.",
      );
    }
    return source.lifecycleStatus;
  });
  const decision = evaluateBoundedJoin({
    isEntry: false,
    allPotentialIncomingResolved: allPotentialIncomingResolved(
      state,
      node.nodeKey,
    ),
    activatedSourceStatuses: sourceStatuses,
    joinPolicy: topologyNode.joinPolicy ?? "all_success",
  });
  if (decision === "wait") {
    return false;
  }
  if (!takeTransition(state)) {
    return false;
  }
  if (decision === "skip_branch_not_selected") {
    await markPendingNodeSkipped(
      state,
      node,
      "workflow.branch_not_selected",
      incomingEdges,
    );
    return true;
  }
  if (decision === "skip_upstream_not_successful") {
    await markPendingNodeSkipped(
      state,
      node,
      "workflow.upstream_not_successful",
      incomingEdges,
    );
    return true;
  }
  const activationDigest = digestProviderValue({
    workflowRunId: state.run.id,
    nodeRunId: node.id,
    joinPolicy: topologyNode.joinPolicy ?? "all_success",
    incomingEdges: incomingEdges.map((edge) => ({
      id: edge.id,
      activationDigest: edge.activationDigest,
    })),
  });
  await activateRootNode(
    state,
    node,
    topologyNode,
    "workflow.join_ready",
    activationDigest,
  );
  return true;
}

async function synchronizeCapabilityTerminals(
  state: FrontierState,
): Promise<void> {
  for (const node of state.nodes) {
    if (node.kind !== "invoke" || node.lifecycleStatus !== "running") {
      continue;
    }
    const capability = state.capabilitiesByNodeId.get(node.id);
    if (
      !capability ||
      !["completed", "failed", "cancelled"].includes(capability.lifecycleStatus)
    ) {
      continue;
    }
    if (!takeTransition(state)) {
      return;
    }
    if (capability.lifecycleStatus === "completed") {
      await markNodeTerminal(
        state,
        node,
        "completed",
        "capability.completed",
        capability.output,
        noJsonValue,
      );
    } else if (capability.lifecycleStatus === "failed") {
      await markNodeTerminal(
        state,
        node,
        "failed",
        "capability.failed",
        noJsonValue,
        errorEnvelope("capability.failed", {
          capabilityRunId: capability.id,
          ...(capability.attemptError
            ? { cause: capability.attemptError }
            : {}),
        }),
      );
    } else {
      await markNodeTerminal(
        state,
        node,
        "cancelled",
        "capability.cancelled",
        noJsonValue,
        errorEnvelope("capability.cancelled", {
          capabilityRunId: capability.id,
        }),
      );
    }
  }
}

async function lockRouteAuthority(
  state: FrontierState,
  route: PinnedCapabilityRoute,
  candidate: PinnedRouteCandidate,
): Promise<RouteAuthorityRow> {
  const [rows] = await state.connection.execute<RouteAuthorityRow[]>(
    `SELECT
       contract.id AS contractRevisionId,
       contract.workspace_id AS contractWorkspaceId,
       contract.contract_key AS contractKey,
       contract.revision AS contractRevision,
       contract.canonical_digest AS contractDigest,
       contract.lifecycle_status AS contractLifecycleStatus,
       contract.input_schema AS inputSchema,
       binding.id AS bindingId,
       binding.workspace_id AS bindingWorkspaceId,
       binding.version AS bindingVersion,
       binding.lifecycle_status AS bindingLifecycleStatus,
       implementation.id AS implementationRevisionId,
       implementation.workspace_id AS implementationWorkspaceId,
       implementation.canonical_digest AS implementationDigest,
       implementation.lifecycle_status AS implementationLifecycleStatus,
       implementation.execution_target AS executionTarget,
       implementation.adapter_key AS adapterKey
     FROM capability_contract_revision AS contract
     INNER JOIN capability_binding AS binding
       ON binding.contract_revision_id = contract.id
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.id = binding.implementation_revision_id
     WHERE contract.id = ?
       AND binding.id = ?
       AND implementation.id = ?
     LIMIT 1
     FOR UPDATE`,
    [
      route.contractRevisionId,
      candidate.bindingId,
      candidate.implementationRevisionId,
    ],
  );
  const authority = rows[0];
  if (!authority) {
    return fail(
      "workflow.v1.route_invalid",
      `Pinned route ${route.nodeKey} no longer resolves to its exact authority facts.`,
    );
  }
  if (
    authority.contractWorkspaceId !== state.run.workspaceId ||
    authority.bindingWorkspaceId !== state.run.workspaceId ||
    authority.implementationWorkspaceId !== state.run.workspaceId ||
    authority.contractRevisionId !== route.contractRevisionId ||
    authority.contractKey !== route.contractKey ||
    authority.contractRevision !== route.contractRevision ||
    authority.contractDigest !== route.contractDigest ||
    authority.bindingId !== candidate.bindingId ||
    authority.bindingVersion !== candidate.bindingVersion ||
    authority.implementationRevisionId !== candidate.implementationRevisionId ||
    authority.implementationDigest !== candidate.implementationDigest ||
    authority.executionTarget !== candidate.executionTarget ||
    authority.adapterKey !== candidate.adapterKey
  ) {
    return fail(
      "workflow.v1.route_invalid",
      `Pinned route ${route.nodeKey} differs from current immutable authority facts.`,
    );
  }
  if (
    !["published", "deprecated"].includes(authority.contractLifecycleStatus) ||
    authority.bindingLifecycleStatus !== "active" ||
    authority.implementationLifecycleStatus !== "published"
  ) {
    return fail(
      "workflow.v1.route_invalid",
      `Pinned route ${route.nodeKey} is revoked or disabled.`,
    );
  }
  if (!state.configuration.targetGate.allows(candidate.executionTarget)) {
    return fail(
      "workflow.v1.route_invalid",
      `Execution target ${candidate.executionTarget} is disabled in this deployment.`,
    );
  }
  return {
    ...authority,
    inputSchema: asRecord(authority.inputSchema, "Capability input schema"),
  };
}

function validateAgainstSchema(
  state: FrontierState,
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
  code: "workflow.v1.input_invalid" | "workflow.v1.approval_decision_invalid",
  description: string,
): void {
  let issues: readonly string[];
  try {
    issues = state.configuration.schemaValidation.validate(schema, value);
  } catch (error) {
    return fail(
      code,
      `${description} validator failed closed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !Array.isArray(issues) ||
    issues.some((issue) => typeof issue !== "string") ||
    issues.length > 0
  ) {
    return fail(
      code,
      `${description} does not satisfy its pinned JSON Schema${
        issues.length > 0 ? `: ${issues.slice(0, 5).join("; ")}` : "."
      }`,
    );
  }
}

async function setNodeRunningWithInput(
  state: FrontierState,
  node: MutableNodeRun,
  input: unknown,
): Promise<void> {
  const inputDigest = digestProviderValue(input);
  const nextVersion = node.version + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE node_run
     SET lifecycle_status = 'running',
         waiting_reason = NULL,
         input = ?,
         input_digest = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?
       AND workflow_run_id = ?
       AND version = ?
       AND lifecycle_status = 'pending'
       AND activated_at IS NOT NULL`,
    [
      jsonForDatabase(input),
      inputDigest,
      nextVersion,
      state.now,
      node.id,
      state.run.id,
      node.version,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `Node ${node.nodeKey}/${node.scopeKey} could not enter running state.`,
    );
  }
  node.lifecycleStatus = "running";
  node.waitingReason = null;
  node.input = input;
  node.inputDigest = inputDigest;
  node.version = nextVersion;
  node.updatedAt = state.now;
  state.runChanged = true;
}

async function createInitialCapabilityInvocation(
  state: FrontierState,
  options: {
    readonly node: MutableNodeRun;
    readonly routeNodeKey: string;
    readonly capability: {
      readonly contractId: string;
      readonly revision: number;
      readonly canonicalDigest: string;
    };
    readonly input: unknown;
  },
): Promise<void> {
  const route = findPinnedRoute(state.plan, options.routeNodeKey);
  const candidate = findPinnedCandidate(route, 0);
  if (
    route.contractKey !== options.capability.contractId ||
    route.contractRevision !== options.capability.revision ||
    route.contractDigest !== options.capability.canonicalDigest
  ) {
    fail(
      "workflow.v1.route_invalid",
      `Pinned route ${options.routeNodeKey} differs from the topology Capability reference.`,
    );
  }
  const authority = await lockRouteAuthority(state, route, candidate);
  const inputSchema = asRecord(
    authority.inputSchema,
    "Capability input schema",
  );
  validateAgainstSchema(
    state,
    inputSchema,
    options.input,
    "workflow.v1.input_invalid",
    `Input for ${options.node.nodeKey}/${options.node.scopeKey}`,
  );

  const capabilityRunId = nextId(state.configuration, "capability_run");
  const attemptId = nextId(state.configuration, "attempt");
  const executionDeadlineAt = new Date(
    Math.min(
      state.now.getTime() + candidate.attemptTimeoutMs,
      executionDeadline(state).getTime(),
    ),
  );
  if (executionDeadlineAt <= state.now) {
    fail(
      "workflow.v1.route_invalid",
      "A CapabilityAttempt cannot start at or after the Workflow execution deadline.",
    );
  }
  await state.connection.execute<ResultSetHeader>(
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
       current_attempt_id,
       accepted_attempt_id,
       output,
       version,
       created_at,
       updated_at,
       completed_at
     ) VALUES (
       ?, ?, ?, 'workflow', ?, NULL, NULL, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, 'queued', NULL, NULL, NULL, 1, ?, ?, NULL
     )`,
    [
      capabilityRunId,
      state.run.workspaceId,
      options.node.id,
      options.node.id,
      state.run.createdBy,
      JSON.stringify(options.input),
      digestProviderValue(options.input),
      JSON.stringify(route),
      digestProviderValue(route),
      executionDeadline(state),
      route.contractRevisionId,
      candidate.bindingId,
      candidate.implementationRevisionId,
      state.now,
      state.now,
    ],
  );
  await state.connection.execute<ResultSetHeader>(
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
       ?, ?, ?, ?, 0, 1, 'initial', 'workflow.v1.initial',
       1, ?, ?, 'created', 'not_started', ?, ?, 0, 1, ?, ?
     )`,
    [
      attemptId,
      state.run.workspaceId,
      capabilityRunId,
      candidate.bindingId,
      candidate.executionTarget,
      candidate.implementationRevisionId,
      state.now,
      executionDeadlineAt,
      state.now,
      state.now,
    ],
  );
  const [capabilityUpdate] = await state.connection.execute<ResultSetHeader>(
    `UPDATE capability_run
       SET current_attempt_id = ?,
           updated_at = ?
       WHERE id = ?
         AND current_attempt_id IS NULL
         AND lifecycle_status = 'queued'
         AND version = 1`,
    [attemptId, state.now, capabilityRunId],
  );
  if (capabilityUpdate.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      "Initial CapabilityAttempt did not bind to its CapabilityRun.",
    );
  }
  await setNodeRunningWithInput(state, options.node, options.input);
  state.capabilitiesByNodeId.set(options.node.id, {
    id: capabilityRunId,
    nodeRunId: options.node.id,
    currentAttemptId: attemptId,
    lifecycleStatus: "queued",
    output: null,
    cancelRequestedAt: null,
    cancelDeadlineAt: null,
    version: 1,
  });
  if (isQueueExecutionTarget(candidate.executionTarget)) {
    const outboxEventId = nextId(state.configuration, "dispatch_outbox");
    await state.connection.execute<ResultSetHeader>(
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
         publish_attempts,
         created_at
       ) VALUES (
         ?, ?, 'attempt.dispatch.requested', 1,
         'capability_attempt', ?, 1, ?, 'pending', ?, 0, ?
       )`,
      [
        outboxEventId,
        state.run.workspaceId,
        attemptId,
        jsonForDatabase({
          workflowRunId: state.run.id,
          nodeRunId: options.node.id,
          capabilityRunId,
          attemptId,
          executionTarget: candidate.executionTarget,
          expectedGeneration: state.executionGeneration,
          cause: "workflow.v1.initial",
        }),
        state.now,
        state.now,
      ],
    );
  }
}

async function startInvokeNode(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "invoke" }>,
  node: MutableNodeRun,
): Promise<void> {
  let input: unknown;
  try {
    input = resolveWorkflowValueTemplate(
      topologyNode.input,
      valueContext(state, node.scopeKey),
    );
    await createInitialCapabilityInvocation(state, {
      node,
      routeNodeKey: topologyNode.key,
      capability: topologyNode.capability,
      input,
    });
  } catch (error) {
    if (
      error instanceof WorkflowValueProtocolError ||
      (error instanceof BoundedWorkflowRuntimeError &&
        (error.code === "workflow.v1.input_invalid" ||
          error.code === "workflow.v1.route_invalid"))
    ) {
      await markNodeTerminal(
        state,
        node,
        "failed",
        "workflow.invoke_start_failed",
        noJsonValue,
        errorEnvelope("workflow.invoke_start_failed", {
          cause:
            error instanceof WorkflowValueProtocolError
              ? error.code
              : error.code,
        }),
      );
      return;
    }
    throw error;
  }
}

async function executeSwitchNode(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "switch" }>,
  node: MutableNodeRun,
): Promise<void> {
  try {
    const probe = probeWorkflowValueTemplate(
      topologyNode.value,
      valueContext(state, node.scopeKey),
    );
    const selection = selectWorkflowSwitchTargets(topologyNode, probe);
    const inputFact = probe.found
      ? Object.freeze({
          found: true,
          value: probe.value,
        })
      : Object.freeze({
          found: false,
        });
    const inputDigest = digestProviderValue(inputFact);
    const decisionDigest = digestProviderValue({
      workflowRunId: state.run.id,
      nodeRunId: node.id,
      inputDigest,
      matchedCaseIndex: selection.caseIndex,
      selectedTargets: selection.next,
    });
    const existing = state.switchDecisionsByNodeId.get(node.id);
    let decisionId: string;
    if (existing) {
      if (
        existing.inputDigest !== inputDigest ||
        existing.matchedCaseIndex !== selection.caseIndex ||
        digestProviderValue(
          asStringArray(existing.selectedTargets, "Switch selected targets"),
        ) !== digestProviderValue(selection.next) ||
        existing.decisionDigest !== decisionDigest
      ) {
        fail(
          "workflow.v1.fact_conflict",
          `Switch ${node.nodeKey} has a conflicting immutable decision.`,
        );
      }
      decisionId = existing.id;
    } else {
      decisionId = nextId(state.configuration, "switch_decision");
      await state.connection.execute<ResultSetHeader>(
        `INSERT INTO workflow_switch_decision (
           id,
           workspace_id,
           workflow_run_id,
           node_run_id,
           input_value,
           input_digest,
           matched_case_index,
           selected_targets,
           decision_digest,
           decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          decisionId,
          state.run.workspaceId,
          state.run.id,
          node.id,
          jsonForDatabase(inputFact),
          inputDigest,
          selection.caseIndex,
          jsonForDatabase(selection.next),
          decisionDigest,
          state.now,
        ],
      );
      state.switchDecisionsByNodeId.set(node.id, {
        id: decisionId,
        nodeRunId: node.id,
        inputValue: inputFact,
        inputDigest,
        matchedCaseIndex: selection.caseIndex,
        selectedTargets: selection.next,
        decisionDigest,
      });
      state.runChanged = true;
    }
    await setNodeRunningWithInput(state, node, inputFact);
    for (const targetKey of selection.next) {
      const targetNode = state.nodesByIdentity.get(
        nodeIdentity(targetKey, "root"),
      );
      if (!targetNode) {
        fail(
          "workflow.v1.fact_conflict",
          `Switch target ${targetKey} has no root NodeRun.`,
        );
      }
      await insertActivatedEdge(state, {
        sourceNode: node,
        targetNode,
        activationKind: "switch",
        switchDecisionId: decisionId,
        switchDecisionDigest: decisionDigest,
      });
    }
    await markNodeTerminal(
      state,
      node,
      "completed",
      "workflow.switch_decided",
      Object.freeze({
        matchedCaseIndex: selection.caseIndex,
        selectedTargets: selection.next,
      }),
      noJsonValue,
    );
  } catch (error) {
    if (error instanceof WorkflowValueProtocolError) {
      await markNodeTerminal(
        state,
        node,
        "failed",
        "workflow.switch_resolution_failed",
        noJsonValue,
        errorEnvelope("workflow.switch_resolution_failed", {
          cause: error.code,
        }),
      );
      return;
    }
    throw error;
  }
}

async function setNodeWaitingForApproval(
  state: FrontierState,
  node: MutableNodeRun,
  input: unknown,
): Promise<void> {
  const inputDigest = digestProviderValue(input);
  const nextVersion = node.version + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE node_run
     SET lifecycle_status = 'waiting',
         waiting_reason = 'approval',
         input = ?,
         input_digest = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?
       AND workflow_run_id = ?
       AND version = ?
       AND lifecycle_status = 'pending'
       AND activated_at IS NOT NULL`,
    [
      jsonForDatabase(input),
      inputDigest,
      nextVersion,
      state.now,
      node.id,
      state.run.id,
      node.version,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `Approval node ${node.nodeKey} could not enter waiting state.`,
    );
  }
  node.lifecycleStatus = "waiting";
  node.waitingReason = "approval";
  node.input = input;
  node.inputDigest = inputDigest;
  node.version = nextVersion;
  node.updatedAt = state.now;
  state.runChanged = true;
}

function approvalBindingDigest(
  run: Pick<
    MutableRunState,
    | "id"
    | "workspaceId"
    | "definitionKind"
    | "definitionId"
    | "executionPlanHash"
  >,
  nodeRunId: string,
): string {
  return digestProviderValue({
    workspaceId: run.workspaceId,
    workflowRunId: run.id,
    nodeRunId,
    definitionKind: run.definitionKind,
    definitionId: run.definitionId,
    executionPlanHash: run.executionPlanHash,
    permission: "approval.decide",
  });
}

async function startApprovalNode(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "approval" }>,
  node: MutableNodeRun,
): Promise<void> {
  try {
    const requestPayload = resolveWorkflowValueTemplate(
      topologyNode.request,
      valueContext(state, node.scopeKey),
    );
    const requestDigest = digestProviderValue(requestPayload);
    const decisionSchemaDigest = digestProviderValue(
      topologyNode.decisionSchema,
    );
    const authorizationContextDigest = approvalBindingDigest(
      state.run,
      node.id,
    );
    const expiresAt = new Date(
      Math.min(
        state.now.getTime() + state.configuration.approvalTtlMs,
        executionDeadline(state).getTime(),
      ),
    );
    if (expiresAt <= state.now) {
      fail(
        "workflow.v1.input_invalid",
        "An ApprovalRequest cannot be created at or after the Workflow execution deadline.",
      );
    }
    const requestId = nextId(state.configuration, "approval_request");
    await state.connection.execute<ResultSetHeader>(
      `INSERT INTO workflow_approval_request (
         id,
         workspace_id,
         workflow_run_id,
         node_run_id,
         definition_kind,
         workflow_revision_id,
         publication_candidate_id,
         execution_plan_hash,
         node_input,
         node_input_digest,
         request_payload,
         request_digest,
         decision_schema,
         decision_schema_digest,
         required_permission,
         authorization_context_digest,
         expires_at,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approval.decide', ?, ?, ?)`,
      [
        requestId,
        state.run.workspaceId,
        state.run.id,
        node.id,
        state.run.definitionKind,
        state.run.definitionKind === "published_revision"
          ? state.run.definitionId
          : null,
        state.run.definitionKind === "publication_candidate"
          ? state.run.definitionId
          : null,
        state.run.executionPlanHash,
        jsonForDatabase(requestPayload),
        requestDigest,
        jsonForDatabase(requestPayload),
        requestDigest,
        jsonForDatabase(topologyNode.decisionSchema),
        decisionSchemaDigest,
        authorizationContextDigest,
        expiresAt,
        state.now,
      ],
    );
    await state.connection.execute<ResultSetHeader>(
      `INSERT INTO workflow_approval_state (
         approval_request_id,
         workspace_id,
         lifecycle_status,
         version,
         updated_at,
         decided_at,
         expired_at,
         cancelled_at
       ) VALUES (?, ?, 'pending', 1, ?, NULL, NULL, NULL)`,
      [requestId, state.run.workspaceId, state.now],
    );
    await setNodeWaitingForApproval(state, node, requestPayload);
    const approval: ApprovalFact = {
      id: requestId,
      workspaceId: state.run.workspaceId,
      workflowRunId: state.run.id,
      nodeRunId: node.id,
      definitionKind: state.run.definitionKind,
      workflowRevisionId:
        state.run.definitionKind === "published_revision"
          ? state.run.definitionId
          : null,
      publicationCandidateId:
        state.run.definitionKind === "publication_candidate"
          ? state.run.definitionId
          : null,
      executionPlanHash: state.run.executionPlanHash,
      nodeInput: requestPayload,
      nodeInputDigest: requestDigest,
      requestPayload,
      requestDigest,
      decisionSchema: topologyNode.decisionSchema,
      decisionSchemaDigest,
      requiredPermission: "approval.decide",
      authorizationContextDigest,
      expiresAt,
      createdAt: state.now,
      lifecycleStatus: "pending",
      stateVersion: 1,
    };
    state.approvalsByNodeId.set(node.id, approval);
    state.wakeups.push({
      id: nextId(state.configuration, "run_wakeup"),
      messageType: "workflow.wakeup.requested",
      cause: "approval.expires",
      availableAt: expiresAt,
    });
    state.runChanged = true;
  } catch (error) {
    if (error instanceof WorkflowValueProtocolError) {
      await markNodeTerminal(
        state,
        node,
        "failed",
        "workflow.approval_request_failed",
        noJsonValue,
        errorEnvelope("workflow.approval_request_failed", {
          cause: error.code,
        }),
      );
      return;
    }
    throw error;
  }
}

function assertApprovalBinding(
  state: FrontierState,
  node: MutableNodeRun,
  approval: ApprovalFact,
): void {
  if (
    approval.workspaceId !== state.run.workspaceId ||
    approval.workflowRunId !== state.run.id ||
    approval.nodeRunId !== node.id ||
    approval.definitionKind !== state.run.definitionKind ||
    (approval.workflowRevisionId ?? approval.publicationCandidateId) !==
      state.run.definitionId ||
    approval.executionPlanHash !== state.run.executionPlanHash ||
    approval.nodeInputDigest !== digestProviderValue(approval.nodeInput) ||
    approval.requestDigest !== digestProviderValue(approval.requestPayload) ||
    approval.decisionSchemaDigest !==
      digestProviderValue(approval.decisionSchema) ||
    approval.requiredPermission !== "approval.decide" ||
    approval.authorizationContextDigest !==
      approvalBindingDigest(state.run, node.id)
  ) {
    fail(
      "workflow.v1.fact_conflict",
      `Approval request ${approval.id} no longer matches its pinned Run and Node input facts.`,
    );
  }
}

async function synchronizeApprovalNode(
  state: FrontierState,
  node: MutableNodeRun,
): Promise<void> {
  if (node.lifecycleStatus !== "waiting" || node.waitingReason !== "approval") {
    return;
  }
  const approval = state.approvalsByNodeId.get(node.id);
  if (!approval) {
    fail(
      "workflow.v1.fact_conflict",
      `Waiting Approval node ${node.nodeKey} has no request fact.`,
    );
  }
  assertApprovalBinding(state, node, approval);
  if (
    approval.lifecycleStatus === "pending" &&
    state.now >= approval.expiresAt
  ) {
    if (!takeTransition(state)) {
      return;
    }
    const nextVersion = approval.stateVersion + 1;
    const [stateUpdate] = await state.connection.execute<ResultSetHeader>(
      `UPDATE workflow_approval_state
         SET lifecycle_status = 'expired',
             version = ?,
             updated_at = ?,
             expired_at = ?
         WHERE approval_request_id = ?
           AND version = ?
           AND lifecycle_status = 'pending'`,
      [nextVersion, state.now, state.now, approval.id, approval.stateVersion],
    );
    if (stateUpdate.affectedRows !== 1) {
      fail(
        "workflow.v1.state_conflict",
        "Approval expiration lost first-decision arbitration.",
      );
    }
    state.approvalsByNodeId.set(node.id, {
      ...approval,
      lifecycleStatus: "expired",
      stateVersion: nextVersion,
    });
    await markNodeTerminal(
      state,
      node,
      "failed",
      "approval.expired",
      noJsonValue,
      errorEnvelope("approval.expired", {
        approvalRequestId: approval.id,
      }),
    );
    return;
  }
  if (approval.lifecycleStatus === "decided") {
    const decision = state.approvalDecisionsByRequestId.get(approval.id);
    if (!decision) {
      fail(
        "workflow.v1.fact_conflict",
        `Decided Approval ${approval.id} has no immutable decision fact.`,
      );
    }
    if (!takeTransition(state)) {
      return;
    }
    validateAgainstSchema(
      state,
      approval.decisionSchema as Readonly<Record<string, unknown>>,
      decision.decision,
      "workflow.v1.approval_decision_invalid",
      `Decision for Approval ${approval.id}`,
    );
    await markNodeTerminal(
      state,
      node,
      "completed",
      "approval.decided",
      decision.decision,
      noJsonValue,
    );
    return;
  }
  if (approval.lifecycleStatus === "expired") {
    if (!takeTransition(state)) {
      return;
    }
    await markNodeTerminal(
      state,
      node,
      "failed",
      "approval.expired",
      noJsonValue,
      errorEnvelope("approval.expired", {
        approvalRequestId: approval.id,
      }),
    );
    return;
  }
  if (approval.lifecycleStatus === "cancelled") {
    if (!takeTransition(state)) {
      return;
    }
    await markNodeTerminal(
      state,
      node,
      "cancelled",
      "approval.cancelled",
      noJsonValue,
      errorEnvelope("approval.cancelled", {
        approvalRequestId: approval.id,
      }),
    );
  }
}

async function startMapExpansion(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "map" }>,
  coordinator: MutableNodeRun,
): Promise<MutableMapExpansion | undefined> {
  try {
    const resolvedItems = resolveWorkflowValueTemplate(
      topologyNode.items,
      valueContext(state, "root"),
    );
    if (!Array.isArray(resolvedItems)) {
      fail(
        "workflow.v1.input_invalid",
        `Map ${topologyNode.key} items must resolve to a JSON array.`,
      );
    }
    if (resolvedItems.length > topologyNode.maxItems) {
      fail(
        "workflow.v1.input_invalid",
        `Map ${topologyNode.key} resolved ${String(resolvedItems.length)} items, exceeding its pinned maxItems.`,
      );
    }
    if (
      state.nodes.length + resolvedItems.length >
      state.topology.limits.maxNodeRuns
    ) {
      fail(
        "workflow.v1.input_invalid",
        `Map ${topologyNode.key} would exceed Workflow limits.maxNodeRuns.`,
      );
    }
    const scopeKeys = resolvedItems.map((item) =>
      assertStableMapScopeKey(
        resolveWorkflowValueTemplate(
          topologyNode.scopeKey,
          valueContext(state, "__map_scope__", item),
        ),
      ),
    );
    const uniqueScopes = new Set(scopeKeys);
    if (uniqueScopes.size !== scopeKeys.length) {
      fail(
        "workflow.v1.map_scope_invalid",
        `Map ${topologyNode.key} resolved duplicate scope keys.`,
      );
    }
    for (const scopeKey of scopeKeys) {
      if (state.nodesByIdentity.has(nodeIdentity(topologyNode.key, scopeKey))) {
        fail(
          "workflow.v1.map_scope_invalid",
          `Map ${topologyNode.key} scope ${scopeKey} collides with an existing NodeRun.`,
        );
      }
    }
    const itemsDigest = digestProviderValue(resolvedItems);
    const scopeKeysDigest = digestProviderValue(scopeKeys);
    const expansionDigest = digestProviderValue({
      workflowRunId: state.run.id,
      coordinatorNodeRunId: coordinator.id,
      itemsDigest,
      scopeKeysDigest,
      itemCount: resolvedItems.length,
      maxItems: topologyNode.maxItems,
      maxConcurrency: topologyNode.maxConcurrency,
      failureMode: topologyNode.failureMode,
    });
    const expansionId = nextId(state.configuration, "map_expansion");
    await state.connection.execute<ResultSetHeader>(
      `INSERT INTO workflow_map_expansion (
         id,
         workspace_id,
         workflow_run_id,
         coordinator_node_run_id,
         items,
         items_digest,
         scope_keys,
         scope_keys_digest,
         item_count,
         max_items,
         max_concurrency,
         failure_mode,
         expansion_digest,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expansionId,
        state.run.workspaceId,
        state.run.id,
        coordinator.id,
        jsonForDatabase(resolvedItems),
        itemsDigest,
        jsonForDatabase(scopeKeys),
        scopeKeysDigest,
        resolvedItems.length,
        topologyNode.maxItems,
        topologyNode.maxConcurrency,
        topologyNode.failureMode,
        expansionDigest,
        state.now,
      ],
    );
    await state.connection.execute<ResultSetHeader>(
      `INSERT INTO workflow_map_state (
         map_expansion_id,
         workspace_id,
         lifecycle_status,
         next_item_index,
         active_count,
         completed_count,
         failed_count,
         cancelled_count,
         skipped_count,
         stop_reason_code,
         version,
         updated_at,
         completed_at
       ) VALUES (
         ?, ?, 'expanding', 0, 0, 0, 0, 0, 0, NULL, 1, ?, NULL
       )`,
      [expansionId, state.run.workspaceId, state.now],
    );
    await setNodeRunningWithInput(state, coordinator, {
      items: resolvedItems,
      itemsDigest,
      scopeKeysDigest,
    });
    const expansion: MutableMapExpansion = {
      id: expansionId,
      coordinatorNodeRunId: coordinator.id,
      items: resolvedItems,
      itemsDigest,
      scopeKeys,
      scopeKeysDigest,
      itemCount: resolvedItems.length,
      maxItems: topologyNode.maxItems,
      maxConcurrency: topologyNode.maxConcurrency,
      failureMode: topologyNode.failureMode,
      expansionDigest,
      lifecycleStatus: "expanding",
      nextItemIndex: 0,
      activeCount: 0,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      skippedCount: 0,
      stopReasonCode: null,
      stateVersion: 1,
      completedAt: null,
    };
    state.mapExpansionsByNodeId.set(coordinator.id, expansion);
    state.mapItemsByExpansionId.set(expansion.id, []);
    state.runChanged = true;
    return expansion;
  } catch (error) {
    if (
      error instanceof WorkflowValueProtocolError ||
      (error instanceof BoundedWorkflowRuntimeError &&
        (error.code === "workflow.v1.input_invalid" ||
          error.code === "workflow.v1.map_scope_invalid"))
    ) {
      await markNodeTerminal(
        state,
        coordinator,
        "failed",
        "workflow.map_expansion_failed",
        noJsonValue,
        errorEnvelope("workflow.map_expansion_failed", {
          cause:
            error instanceof WorkflowValueProtocolError
              ? error.code
              : error.code,
        }),
      );
      return undefined;
    }
    throw error;
  }
}

async function createMapItemNode(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "map" }>,
  coordinator: MutableNodeRun,
  expansion: MutableMapExpansion,
  itemIndex: number,
): Promise<void> {
  const item = expansion.items[itemIndex];
  const scopeKey = expansion.scopeKeys[itemIndex];
  if (item === undefined || scopeKey === undefined) {
    fail(
      "workflow.v1.fact_conflict",
      `Map ${topologyNode.key} has no immutable item at index ${String(itemIndex)}.`,
    );
  }
  if (
    state.nodes.length >= state.topology.limits.maxNodeRuns ||
    state.nodesByIdentity.has(nodeIdentity(topologyNode.key, scopeKey))
  ) {
    fail(
      "workflow.v1.map_scope_invalid",
      `Map ${topologyNode.key} cannot create duplicate or over-limit scope ${scopeKey}.`,
    );
  }
  let input: unknown;
  try {
    input = resolveWorkflowValueTemplate(
      topologyNode.invoke.input,
      valueContext(state, scopeKey, item),
    );
  } catch (error) {
    if (error instanceof WorkflowValueProtocolError) {
      fail(
        "workflow.v1.input_invalid",
        `Map ${topologyNode.key}/${scopeKey} input resolution failed: ${error.code}.`,
      );
    }
    throw error;
  }
  const itemDigest = digestProviderValue(item);
  const inputDigest = digestProviderValue(input);
  const nodeRunId = nextId(state.configuration, "map_item_node");
  const activationDigest = digestProviderValue({
    workflowRunId: state.run.id,
    coordinatorNodeRunId: coordinator.id,
    expansionDigest: expansion.expansionDigest,
    itemIndex,
    scopeKey,
    itemDigest,
    inputDigest,
  });
  await state.connection.execute<ResultSetHeader>(
    `INSERT INTO node_run (
       id,
       workspace_id,
       workflow_run_id,
       node_key,
       scope_key,
       kind,
       lifecycle_status,
       waiting_reason,
       activated_at,
       activation_reason_code,
       activation_digest,
       input,
       input_digest,
       output,
       output_digest,
       error,
       terminal_reason_code,
       version,
       created_at,
       updated_at,
       completed_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'invoke', 'pending', NULL,
       ?, 'map.item', ?, NULL, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL
     )`,
    [
      nodeRunId,
      state.run.workspaceId,
      state.run.id,
      topologyNode.key,
      scopeKey,
      state.now,
      activationDigest,
      state.now,
      state.now,
    ],
  );
  const itemNode: MutableNodeRun = {
    id: nodeRunId,
    workspaceId: state.run.workspaceId,
    workflowRunId: state.run.id,
    nodeKey: topologyNode.key,
    scopeKey,
    kind: "invoke",
    lifecycleStatus: "pending",
    waitingReason: null,
    activatedAt: state.now,
    activationReasonCode: "map.item",
    activationDigest,
    input: null,
    inputDigest: null,
    output: null,
    outputDigest: null,
    error: null,
    terminalReasonCode: null,
    version: 1,
    createdAt: state.now,
    updatedAt: state.now,
    completedAt: null,
  };
  state.nodes.push(itemNode);
  state.nodesByIdentity.set(nodeIdentity(topologyNode.key, scopeKey), itemNode);
  await insertActivatedEdge(state, {
    sourceNode: coordinator,
    targetNode: itemNode,
    activationKind: "map_item",
  });
  const mapItemId = nextId(state.configuration, "map_item");
  await state.connection.execute<ResultSetHeader>(
    `INSERT INTO workflow_map_item (
       id,
       workspace_id,
       map_expansion_id,
       workflow_run_id,
       coordinator_node_run_id,
       item_node_run_id,
       item_index,
       scope_key,
       item_value,
       item_digest,
       input_digest,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mapItemId,
      state.run.workspaceId,
      expansion.id,
      state.run.id,
      coordinator.id,
      itemNode.id,
      itemIndex,
      scopeKey,
      jsonForDatabase(item),
      itemDigest,
      inputDigest,
      state.now,
    ],
  );
  const fact: MapItemFact = {
    id: mapItemId,
    mapExpansionId: expansion.id,
    coordinatorNodeRunId: coordinator.id,
    itemNodeRunId: itemNode.id,
    itemIndex,
    scopeKey,
    itemValue: item,
    itemDigest,
    inputDigest,
  };
  const itemFacts = state.mapItemsByExpansionId.get(expansion.id) ?? [];
  itemFacts.push(fact);
  state.mapItemsByExpansionId.set(expansion.id, itemFacts);
  expansion.nextItemIndex = itemIndex + 1;
  state.runChanged = true;
  try {
    await createInitialCapabilityInvocation(state, {
      node: itemNode,
      routeNodeKey: topologyNode.key,
      capability: topologyNode.invoke.capability,
      input,
    });
  } catch (error) {
    if (
      error instanceof BoundedWorkflowRuntimeError &&
      (error.code === "workflow.v1.input_invalid" ||
        error.code === "workflow.v1.route_invalid")
    ) {
      await markNodeTerminal(
        state,
        itemNode,
        "failed",
        "workflow.map_item_start_failed",
        noJsonValue,
        errorEnvelope("workflow.map_item_start_failed", {
          cause: error.code,
        }),
      );
      return;
    }
    throw error;
  }
}

interface MapCounters {
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly skipped: number;
}

function mapCounters(
  state: FrontierState,
  expansion: MutableMapExpansion,
): MapCounters {
  const counters = {
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  };
  for (const fact of state.mapItemsByExpansionId.get(expansion.id) ?? []) {
    const node = state.nodes.find(
      (candidate) => candidate.id === fact.itemNodeRunId,
    );
    if (!node) {
      fail(
        "workflow.v1.fact_conflict",
        `Map item ${fact.id} has no scoped NodeRun.`,
      );
    }
    if (node.lifecycleStatus === "completed") {
      counters.completed += 1;
    } else if (node.lifecycleStatus === "failed") {
      counters.failed += 1;
    } else if (node.lifecycleStatus === "cancelled") {
      counters.cancelled += 1;
    } else if (node.lifecycleStatus === "skipped") {
      counters.skipped += 1;
    } else {
      counters.active += 1;
    }
  }
  return counters;
}

async function propagateMapFailFastCancellations(
  state: FrontierState,
  expansion: MutableMapExpansion,
): Promise<void> {
  const itemFacts = state.mapItemsByExpansionId.get(expansion.id) ?? [];
  for (const fact of itemFacts) {
    const node = state.nodes.find(
      (candidate) => candidate.id === fact.itemNodeRunId,
    );
    if (!node || isTerminalNode(node)) {
      continue;
    }
    const capability = state.capabilitiesByNodeId.get(node.id);
    if (
      !capability ||
      (capability.lifecycleStatus !== "queued" &&
        capability.lifecycleStatus !== "running")
    ) {
      continue;
    }
    await requestCapabilityCancellation(
      state,
      capability,
      "map_fail_fast",
      expansion.id,
      "workflow.map_fail_fast",
    );
    if (state.transitions >= state.configuration.maximumTransitionsPerWakeup) {
      state.continuationRequired = true;
      return;
    }
  }
}

async function persistMapState(
  state: FrontierState,
  expansion: MutableMapExpansion,
  counters: MapCounters,
  lifecycleStatus: MutableMapExpansion["lifecycleStatus"],
  stopReasonCode: string | null,
  completedAt: Date | null,
): Promise<boolean> {
  if (
    expansion.activeCount === counters.active &&
    expansion.completedCount === counters.completed &&
    expansion.failedCount === counters.failed &&
    expansion.cancelledCount === counters.cancelled &&
    expansion.skippedCount === counters.skipped &&
    expansion.lifecycleStatus === lifecycleStatus &&
    expansion.stopReasonCode === stopReasonCode &&
    expansion.completedAt?.getTime() === completedAt?.getTime()
  ) {
    return true;
  }
  if (!takeTransition(state)) {
    return false;
  }
  const nextVersion = expansion.stateVersion + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE workflow_map_state
     SET lifecycle_status = ?,
         next_item_index = ?,
         active_count = ?,
         completed_count = ?,
         failed_count = ?,
         cancelled_count = ?,
         skipped_count = ?,
         stop_reason_code = ?,
         version = ?,
         updated_at = ?,
         completed_at = ?
     WHERE map_expansion_id = ?
       AND version = ?`,
    [
      lifecycleStatus,
      expansion.nextItemIndex,
      counters.active,
      counters.completed,
      counters.failed,
      counters.cancelled,
      counters.skipped,
      stopReasonCode,
      nextVersion,
      state.now,
      completedAt,
      expansion.id,
      expansion.stateVersion,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      `Map ${expansion.id} state projection lost optimistic arbitration.`,
    );
  }
  expansion.lifecycleStatus = lifecycleStatus;
  expansion.activeCount = counters.active;
  expansion.completedCount = counters.completed;
  expansion.failedCount = counters.failed;
  expansion.cancelledCount = counters.cancelled;
  expansion.skippedCount = counters.skipped;
  expansion.stopReasonCode = stopReasonCode;
  expansion.stateVersion = nextVersion;
  expansion.completedAt = completedAt;
  state.runChanged = true;
  return true;
}

function mapResultItems(
  state: FrontierState,
  expansion: MutableMapExpansion,
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    [...(state.mapItemsByExpansionId.get(expansion.id) ?? [])]
      .sort((left, right) => left.itemIndex - right.itemIndex)
      .map((fact) => {
        const node = state.nodes.find(
          (candidate) => candidate.id === fact.itemNodeRunId,
        );
        if (!node || !isTerminalNode(node)) {
          fail(
            "workflow.v1.fact_conflict",
            `Map item ${fact.id} is not terminal during aggregation.`,
          );
        }
        return Object.freeze({
          scopeKey: fact.scopeKey,
          status: node.lifecycleStatus,
          ...(node.lifecycleStatus === "completed"
            ? { output: node.output }
            : {}),
          ...(node.error !== null ? { error: node.error } : {}),
        });
      }),
  );
}

async function reconcileMapNode(
  state: FrontierState,
  topologyNode: Extract<WorkflowTopologyNodeV1, { readonly kind: "map" }>,
  coordinator: MutableNodeRun,
): Promise<void> {
  let expansion = state.mapExpansionsByNodeId.get(coordinator.id);
  if (!expansion) {
    if (
      coordinator.lifecycleStatus !== "pending" ||
      coordinator.activatedAt === null
    ) {
      return;
    }
    if (!takeTransition(state)) {
      return;
    }
    expansion = await startMapExpansion(state, topologyNode, coordinator);
    if (!expansion) {
      return;
    }
  }
  if (isTerminalNode(coordinator)) {
    return;
  }
  let counters = mapCounters(state, expansion);
  const hasFailure =
    counters.failed + counters.cancelled + counters.skipped > 0;
  let stopping =
    expansion.lifecycleStatus === "fail_fast_stopping" ||
    (expansion.failureMode === "fail_fast" && hasFailure);
  if (stopping) {
    await propagateMapFailFastCancellations(state, expansion);
    const stopReason = "workflow.map_fail_fast";
    if (counters.active === 0) {
      if (!takeTransition(state)) {
        return;
      }
      if (
        !(await persistMapState(
          state,
          expansion,
          counters,
          "failed",
          stopReason,
          state.now,
        ))
      ) {
        return;
      }
      await markNodeTerminal(
        state,
        coordinator,
        "failed",
        stopReason,
        noJsonValue,
        errorEnvelope(stopReason, {
          cancellationMode: "cooperative_database_request",
          createdItems: expansion.nextItemIndex,
          totalItems: expansion.itemCount,
          items: mapResultItems(state, expansion),
        }),
      );
      return;
    }
    await persistMapState(
      state,
      expansion,
      counters,
      "fail_fast_stopping",
      "workflow.map_fail_fast_cancelling",
      null,
    );
    return;
  }

  const spawnCount = Math.min(
    expansion.itemCount - expansion.nextItemIndex,
    expansion.maxConcurrency - counters.active,
    state.configuration.maximumTransitionsPerWakeup - state.transitions,
    state.configuration.maximumNodeCreatesPerWakeup - state.nodeCreates,
  );
  for (let offset = 0; offset < spawnCount; offset += 1) {
    if (!takeTransition(state) || !takeNodeCreate(state)) {
      fail(
        "workflow.v1.state_conflict",
        "Precomputed Map frontier budget became inconsistent.",
      );
    }
    const itemIndex = expansion.nextItemIndex;
    await createMapItemNode(
      state,
      topologyNode,
      coordinator,
      expansion,
      itemIndex,
    );
    counters = mapCounters(state, expansion);
    if (
      expansion.failureMode === "fail_fast" &&
      counters.failed + counters.cancelled + counters.skipped > 0
    ) {
      stopping = true;
      break;
    }
  }
  if (
    !stopping &&
    expansion.nextItemIndex < expansion.itemCount &&
    counters.active < expansion.maxConcurrency
  ) {
    state.continuationRequired = true;
  }

  if (stopping) {
    await propagateMapFailFastCancellations(state, expansion);
    const stoppedPersisted = await persistMapState(
      state,
      expansion,
      counters,
      counters.active === 0 ? "failed" : "fail_fast_stopping",
      counters.active === 0
        ? "workflow.map_fail_fast"
        : "workflow.map_fail_fast_cancelling",
      counters.active === 0 ? state.now : null,
    );
    if (!stoppedPersisted) {
      return;
    }
    if (counters.active === 0) {
      await markNodeTerminal(
        state,
        coordinator,
        "failed",
        "workflow.map_fail_fast",
        noJsonValue,
        errorEnvelope("workflow.map_fail_fast", {
          cancellationMode: "cooperative_database_request",
          createdItems: expansion.nextItemIndex,
          totalItems: expansion.itemCount,
          items: mapResultItems(state, expansion),
        }),
      );
    }
    return;
  }

  counters = mapCounters(state, expansion);
  if (
    expansion.nextItemIndex === expansion.itemCount &&
    counters.active === 0
  ) {
    if (!takeTransition(state)) {
      return;
    }
    const output = Object.freeze({
      items: mapResultItems(state, expansion),
      summary: Object.freeze({
        total: expansion.itemCount,
        completed: counters.completed,
        failed: counters.failed,
        cancelled: counters.cancelled,
        skipped: counters.skipped,
      }),
    });
    if (
      !(await persistMapState(
        state,
        expansion,
        counters,
        "completed",
        null,
        state.now,
      ))
    ) {
      return;
    }
    await markNodeTerminal(
      state,
      coordinator,
      "completed",
      "workflow.map_completed",
      output,
      noJsonValue,
    );
    return;
  }
  await persistMapState(
    state,
    expansion,
    counters,
    expansion.nextItemIndex < expansion.itemCount ? "expanding" : "waiting",
    null,
    null,
  );
  if (
    expansion.nextItemIndex < expansion.itemCount &&
    counters.active < expansion.maxConcurrency
  ) {
    state.continuationRequired = true;
  }
}

async function processRootFrontier(state: FrontierState): Promise<void> {
  await synchronizeCapabilityTerminals(state);
  for (const topologyNode of state.orderedTopologyNodes) {
    const node = state.nodesByIdentity.get(
      nodeIdentity(topologyNode.key, "root"),
    );
    if (!node) {
      fail(
        "workflow.v1.fact_conflict",
        `Topology node ${topologyNode.key} has no root NodeRun.`,
      );
    }
    if (
      topologyNode.kind === "approval" &&
      node.lifecycleStatus === "waiting"
    ) {
      await synchronizeApprovalNode(state, node);
    } else if (
      topologyNode.kind === "map" &&
      node.lifecycleStatus === "running"
    ) {
      await reconcileMapNode(state, topologyNode, node);
    }
    if (isTerminalNode(node)) {
      continue;
    }
    if (node.lifecycleStatus === "pending" && node.activatedAt === null) {
      await activateOrSkipPendingRootNode(state, topologyNode, node);
    }
    if (node.lifecycleStatus !== "pending" || node.activatedAt === null) {
      continue;
    }
    if (topologyNode.kind === "map") {
      await reconcileMapNode(state, topologyNode, node);
      continue;
    }
    if (!takeTransition(state)) {
      continue;
    }
    if (topologyNode.kind === "invoke") {
      await startInvokeNode(state, topologyNode, node);
    } else if (topologyNode.kind === "switch") {
      await executeSwitchNode(state, topologyNode, node);
    } else {
      await startApprovalNode(state, topologyNode, node);
    }
  }
}

interface PendingOutputFact {
  readonly outputKey: string;
  readonly required: boolean;
  readonly resolutionStatus: "resolved" | "missing" | "invalid";
  readonly value: unknown;
  readonly valueDigest: string | null;
  readonly reasonCode: string | null;
}

function outputSelectionFacts(
  state: FrontierState,
): readonly PendingOutputFact[] {
  const facts: PendingOutputFact[] = [];
  for (const outputKey of Object.keys(state.topology.outputs).sort()) {
    const selection = state.topology.outputs[outputKey];
    if (!selection) {
      continue;
    }
    try {
      const probe = probeWorkflowValueTemplate(
        selection.value,
        valueContext(state, "root"),
      );
      if (!probe.found) {
        facts.push({
          outputKey,
          required: selection.required,
          resolutionStatus: "missing",
          value: noJsonValue,
          valueDigest: null,
          reasonCode: "workflow.output_missing",
        });
      } else {
        facts.push({
          outputKey,
          required: selection.required,
          resolutionStatus: "resolved",
          value: probe.value,
          valueDigest: digestProviderValue(probe.value),
          reasonCode: null,
        });
      }
    } catch (error) {
      if (!(error instanceof WorkflowValueProtocolError)) {
        throw error;
      }
      facts.push({
        outputKey,
        required: selection.required,
        resolutionStatus: "invalid",
        value: noJsonValue,
        valueDigest: null,
        reasonCode: "workflow.output_invalid",
      });
    }
  }
  return Object.freeze(facts);
}

function outputSchemaIssues(
  state: FrontierState,
  output: unknown,
): readonly string[] {
  try {
    const issues: unknown = state.configuration.schemaValidation.validate(
      state.run.outputSchema,
      output,
    );
    if (
      !Array.isArray(issues) ||
      issues.some((issue) => typeof issue !== "string")
    ) {
      return Object.freeze([
        "workflow output validator returned a malformed result",
      ]);
    }
    return Object.freeze(
      issues.filter(
        (issue: unknown): issue is string => typeof issue === "string",
      ),
    );
  } catch (error) {
    return Object.freeze([
      `workflow output validator failed closed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
}

async function persistOutputFacts(
  state: FrontierState,
  facts: readonly PendingOutputFact[],
): Promise<void> {
  const sourceRunVersion = state.run.version + 1;
  for (const fact of facts) {
    await state.connection.execute<ResultSetHeader>(
      `INSERT INTO workflow_output_fact (
         id,
         workspace_id,
         workflow_run_id,
         output_key,
         required,
         resolution_status,
         value,
         value_digest,
         reason_code,
         source_run_version,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId(state.configuration, "output_fact"),
        state.run.workspaceId,
        state.run.id,
        fact.outputKey,
        fact.required ? 1 : 0,
        fact.resolutionStatus,
        fact.value === noJsonValue ? null : jsonForDatabase(fact.value),
        fact.valueDigest,
        fact.reasonCode,
        sourceRunVersion,
        state.now,
      ],
    );
  }
}

function hasPartialExecution(state: FrontierState): boolean {
  return state.nodes.some(
    (node) =>
      node.lifecycleStatus === "failed" ||
      node.lifecycleStatus === "cancelled" ||
      (node.lifecycleStatus === "skipped" &&
        node.terminalReasonCode !== "workflow.branch_not_selected"),
  );
}

async function finalizeWorkflowIfReady(state: FrontierState): Promise<void> {
  if (
    state.nodes.some((node) => !isTerminalNode(node)) ||
    state.run.lifecycleStatus === "cancelling"
  ) {
    return;
  }
  if (!takeTransition(state)) {
    return;
  }
  const facts = outputSelectionFacts(state);
  const output = Object.create(null) as Record<string, unknown>;
  for (const fact of facts) {
    if (fact.resolutionStatus === "resolved" && fact.value !== noJsonValue) {
      output[fact.outputKey] = fact.value;
    }
  }
  const requiredFailure = facts.some(
    (fact) => fact.required && fact.resolutionStatus !== "resolved",
  );
  const schemaIssues = requiredFailure
    ? Object.freeze([] as string[])
    : outputSchemaIssues(state, output);
  await persistOutputFacts(state, facts);
  if (requiredFailure || schemaIssues.length > 0) {
    state.run.lifecycleStatus = "failed";
    state.run.outcome = "no_usable_output";
    state.run.output = null;
    state.run.outputDigest = null;
    state.run.terminalReasonCode = requiredFailure
      ? "workflow.required_output_missing"
      : "workflow.output_schema_invalid";
  } else {
    const optionalGap = facts.some(
      (fact) => !fact.required && fact.resolutionStatus !== "resolved",
    );
    state.run.lifecycleStatus = "completed";
    state.run.outcome =
      optionalGap || hasPartialExecution(state)
        ? "partial_success"
        : "full_success";
    state.run.output = output;
    state.run.outputDigest = digestProviderValue(output);
    state.run.terminalReasonCode =
      state.run.outcome === "partial_success"
        ? "workflow.completed_partial"
        : "workflow.completed_full";
  }
  state.run.completedAt = state.now;
  state.runChanged = true;
}

function recomputeActiveRunStatus(state: FrontierState): void {
  if (
    state.run.lifecycleStatus === "completed" ||
    state.run.lifecycleStatus === "failed" ||
    state.run.lifecycleStatus === "cancelled" ||
    state.run.lifecycleStatus === "cancelling"
  ) {
    return;
  }
  const hasRunning = state.nodes.some(
    (node) => node.lifecycleStatus === "running",
  );
  const hasWaiting = state.nodes.some(
    (node) => node.lifecycleStatus === "waiting",
  );
  const nextStatus = hasRunning || !hasWaiting ? "running" : "waiting";
  if (state.run.lifecycleStatus !== nextStatus) {
    state.run.lifecycleStatus = nextStatus;
    state.runChanged = true;
  }
}

function ensureContinuationWakeup(state: FrontierState): void {
  if (
    !state.continuationRequired ||
    state.run.lifecycleStatus === "completed" ||
    state.run.lifecycleStatus === "failed" ||
    state.run.lifecycleStatus === "cancelled" ||
    (state.run.lifecycleStatus === "cancelling" &&
      state.run.cancelReasonCode !== "workflow.timeout")
  ) {
    return;
  }
  state.wakeups.push({
    id: nextId(state.configuration, "run_wakeup"),
    messageType: "workflow.wakeup.requested",
    cause: "workflow.frontier_continuation",
    availableAt: new Date(
      state.now.getTime() + state.configuration.continuationDelayMs,
    ),
  });
}

async function persistRunState(state: FrontierState): Promise<void> {
  if (!state.runChanged) {
    return;
  }
  recomputeActiveRunStatus(state);
  ensureContinuationWakeup(state);
  const previousVersion = state.run.version;
  const nextVersion = previousVersion + 1;
  const [result] = await state.connection.execute<ResultSetHeader>(
    `UPDATE workflow_run
     SET lifecycle_status = ?,
         outcome = ?,
         output = ?,
         output_digest = ?,
         terminal_reason_code = ?,
         execution_deadline_at = ?,
         cancel_requested_at = ?,
         cancel_requested_by = ?,
         cancel_reason_code = ?,
         cancel_deadline_at = ?,
         version = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND workspace_id = ?
       AND version = ?`,
    [
      state.run.lifecycleStatus,
      state.run.outcome,
      state.run.output === null ? null : jsonForDatabase(state.run.output),
      state.run.outputDigest,
      state.run.terminalReasonCode,
      executionDeadline(state),
      state.run.cancelRequestedAt,
      state.run.cancelRequestedBy,
      state.run.cancelReasonCode,
      state.run.cancelDeadlineAt,
      nextVersion,
      state.now,
      state.run.completedAt,
      state.run.id,
      state.run.workspaceId,
      previousVersion,
    ],
  );
  if (result.affectedRows !== 1) {
    fail(
      "workflow.v1.state_conflict",
      "WorkflowRun frontier update lost optimistic arbitration.",
    );
  }
  state.run.version = nextVersion;
  state.run.updatedAt = state.now;
  for (const wakeup of state.wakeups) {
    await state.connection.execute<ResultSetHeader>(
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
         publish_attempts,
         created_at
       ) VALUES (?, ?, ?, 1, 'workflow_run', ?, ?, ?, 'pending', ?, 0, ?)`,
      [
        wakeup.id,
        state.run.workspaceId,
        wakeup.messageType,
        state.run.id,
        nextVersion,
        jsonForDatabase({
          workflowRunId: state.run.id,
          expectedGeneration: state.executionGeneration,
          cause: wakeup.cause,
          executionDeadlineAt: executionDeadline(state).toISOString(),
        }),
        wakeup.availableAt,
        state.now,
      ],
    );
  }
}

interface ApprovalRequestIdentityRow extends RowDataPacket {
  readonly workflowRunId: string;
}

interface ApprovalCommandRunRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: WorkflowRunRow["lifecycleStatus"];
  readonly executionPlanHash: string;
  readonly executionDeadlineAt: Date;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId: string | null;
  readonly publicationCandidateId: string | null;
}

interface ApprovalCommandFactRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId: string | null;
  readonly publicationCandidateId: string | null;
  readonly executionPlanHash: string;
  readonly decisionSchema: unknown;
  readonly decisionSchemaDigest: string;
  readonly authorizationContextDigest: string;
  readonly expiresAt: Date;
  readonly lifecycleStatus: "pending" | "decided" | "expired" | "cancelled";
  readonly stateVersion: number;
}

function authorizationDigest(
  authorization: AuthorizedApprovalDecisionContext,
): string {
  return digestProviderValue({
    effect: authorization.effect,
    authorizationDecisionId: authorization.authorizationDecisionId,
    workspaceId: authorization.workspaceId,
    approvalRequestId: authorization.approvalRequestId,
    actorPrincipalId: authorization.actorPrincipalId,
    permission: authorization.permission,
    bindingDigest: authorization.bindingDigest,
    policyRevision: authorization.policyRevision,
    authorizedAt: authorization.authorizedAt.toISOString(),
    validUntil: authorization.validUntil.toISOString(),
  });
}

function assertAuthorizedApprovalContext(
  options: DecideWorkflowApprovalOptions,
  request: ApprovalCommandFactRow,
): string {
  const authorization = options.authorization;
  assertDate(authorization.authorizedAt, "authorization.authorizedAt");
  assertDate(authorization.validUntil, "authorization.validUntil");
  const opaqueAscii = /^[\x21-\x7e]{1,160}$/u;
  if (
    authorization.effect !== "allow" ||
    authorization.workspaceId !== options.workspaceId ||
    authorization.approvalRequestId !== options.approvalRequestId ||
    authorization.permission !== "approval.decide" ||
    authorization.bindingDigest !== request.authorizationContextDigest ||
    authorization.actorPrincipalId !== options.authority.principalId ||
    authorization.workspaceId !== options.authority.workspaceId ||
    authorization.authorizationDecisionId !==
      workflowApprovalAuthorizationDecisionId(
        options.approvalRequestId,
        options.idempotencyKeyDigest,
      ) ||
    authorization.policyRevision !==
      `authorization-model.v${String(options.authority.authorizationModelVersion)}` ||
    !identifierPattern.test(authorization.actorPrincipalId) ||
    !opaqueAscii.test(authorization.authorizationDecisionId) ||
    !opaqueAscii.test(authorization.policyRevision) ||
    authorization.authorizedAt > options.now ||
    authorization.validUntil <= options.now ||
    authorization.validUntil <= authorization.authorizedAt
  ) {
    return fail(
      "workflow.v1.approval_authorization_invalid",
      "Approval decision is not bound to a current caller-authorized allow decision.",
    );
  }
  return authorizationDigest(authorization);
}

async function decideApprovalInTransaction(
  connection: PoolConnection,
  configuration: NormalizedConfiguration,
  options: DecideWorkflowApprovalOptions,
): Promise<DecideWorkflowApprovalResult> {
  assertIdentifier(options.approvalRequestId, "approvalRequestId");
  assertIdentifier(options.workspaceId, "workspaceId");
  assertIdentifier(options.decisionId, "decisionId");
  assertIdentifier(options.outboxEventId, "outboxEventId");
  assertDate(options.now, "now");
  if (!canonicalDigestPattern.test(options.idempotencyKeyDigest)) {
    return fail(
      "workflow.v1.approval_authorization_invalid",
      "Approval idempotency identity is not a canonical digest.",
    );
  }
  boundedInteger(
    options.executionGeneration,
    1,
    4_294_967_295,
    "executionGeneration",
  );
  try {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "approval.decide",
      options.now,
    );
  } catch (error) {
    if (error instanceof AuthorizationStoreError) {
      return fail(
        "workflow.v1.approval_authorization_invalid",
        "Approval decision authority is no longer current for this Workspace.",
      );
    }
    throw error;
  }
  let decisionDigest: string;
  try {
    decisionDigest = digestProviderValue(options.decision);
  } catch (error) {
    return fail(
      "workflow.v1.approval_decision_invalid",
      `Approval decision must be canonical JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const [identityRows] = await connection.execute<ApprovalRequestIdentityRow[]>(
    `SELECT workflow_run_id AS workflowRunId
       FROM workflow_approval_request
       WHERE id = ?
         AND workspace_id = ?
       LIMIT 1`,
    [options.approvalRequestId, options.workspaceId],
  );
  const workflowRunId = identityRows[0]?.workflowRunId;
  if (!workflowRunId) {
    return fail(
      "workflow.v1.approval_not_found",
      "Approval request was not found in the authorized Workspace.",
    );
  }
  const [runRows] = await connection.execute<ApprovalCommandRunRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       lifecycle_status AS lifecycleStatus,
       definition_kind AS definitionKind,
       workflow_revision_id AS workflowRevisionId,
       publication_candidate_id AS publicationCandidateId,
       execution_plan_hash AS executionPlanHash,
       execution_deadline_at AS executionDeadlineAt
     FROM workflow_run
     WHERE id = ?
       AND workspace_id = ?
     LIMIT 1
     FOR UPDATE`,
    [workflowRunId, options.workspaceId],
  );
  const run = runRows[0];
  if (!run) {
    return fail(
      "workflow.v1.fact_conflict",
      "Approval request references a missing WorkflowRun.",
    );
  }
  const [requestRows] = await connection.execute<ApprovalCommandFactRow[]>(
    `SELECT
         request.id,
         request.workspace_id AS workspaceId,
         request.workflow_run_id AS workflowRunId,
         request.node_run_id AS nodeRunId,
         request.definition_kind AS definitionKind,
         request.workflow_revision_id AS workflowRevisionId,
         request.publication_candidate_id AS publicationCandidateId,
         request.execution_plan_hash AS executionPlanHash,
         request.decision_schema AS decisionSchema,
         request.decision_schema_digest AS decisionSchemaDigest,
         request.authorization_context_digest AS authorizationContextDigest,
         request.expires_at AS expiresAt,
         state.lifecycle_status AS lifecycleStatus,
         state.version AS stateVersion
       FROM workflow_approval_request AS request
       INNER JOIN workflow_approval_state AS state
         ON state.approval_request_id = request.id
         AND state.workspace_id = request.workspace_id
       WHERE request.id = ?
         AND request.workspace_id = ?
         AND request.workflow_run_id = ?
       LIMIT 1
       FOR UPDATE`,
    [options.approvalRequestId, options.workspaceId, workflowRunId],
  );
  const request = requestRows[0];
  if (!request) {
    return fail(
      "workflow.v1.fact_conflict",
      "Approval request state is missing or cross-Workspace.",
    );
  }
  const schema = asRecord(request.decisionSchema, "Approval decision schema");
  if (
    request.definitionKind !== run.definitionKind ||
    request.workflowRevisionId !== run.workflowRevisionId ||
    request.publicationCandidateId !== run.publicationCandidateId ||
    request.executionPlanHash !== run.executionPlanHash ||
    request.decisionSchemaDigest !== digestProviderValue(schema)
  ) {
    return fail(
      "workflow.v1.fact_conflict",
      "Approval request binding or decision schema digest has drifted.",
    );
  }
  const authorizationDigestValue = assertAuthorizedApprovalContext(
    options,
    request,
  );
  const [existingRows] = await connection.execute<
    (ApprovalDecisionFact & RowDataPacket)[]
  >(
    `SELECT
         id,
         approval_request_id AS approvalRequestId,
         actor_principal_id AS actorPrincipalId,
         authorization_decision_id AS authorizationDecisionId,
         authorization_digest AS authorizationDigest,
         decision,
         decision_digest AS decisionDigest,
         decided_at AS decidedAt
       FROM workflow_approval_decision
       WHERE approval_request_id = ?
       LIMIT 1
       FOR UPDATE`,
    [request.id],
  );
  const existing = existingRows[0];
  if (existing) {
    if (
      existing.actorPrincipalId === options.authorization.actorPrincipalId &&
      existing.authorizationDecisionId ===
        options.authorization.authorizationDecisionId &&
      existing.decisionDigest === decisionDigest
    ) {
      return Object.freeze({
        status: "replayed",
        decisionId: existing.id,
        workflowRunId,
      });
    }
    return Object.freeze({
      status: "conflict",
      existingDecisionId: existing.id,
      workflowRunId,
    });
  }
  if (
    run.lifecycleStatus === "completed" ||
    run.lifecycleStatus === "failed" ||
    run.lifecycleStatus === "cancelled" ||
    run.lifecycleStatus === "cancelling"
  ) {
    return Object.freeze({
      status: "no_progress",
      reason: "run_terminal",
      workflowRunId,
    });
  }
  if (
    request.lifecycleStatus === "expired" ||
    options.now >= request.expiresAt ||
    options.now >= run.executionDeadlineAt
  ) {
    if (request.lifecycleStatus === "pending") {
      await connection.execute<ResultSetHeader>(
        `UPDATE workflow_approval_state
         SET lifecycle_status = 'expired',
             version = version + 1,
             updated_at = ?,
             expired_at = ?
         WHERE approval_request_id = ?
           AND version = ?
           AND lifecycle_status = 'pending'`,
        [options.now, options.now, request.id, request.stateVersion],
      );
    }
    return Object.freeze({
      status: "no_progress",
      reason: "expired",
      workflowRunId,
    });
  }
  if (request.lifecycleStatus === "cancelled") {
    return Object.freeze({
      status: "no_progress",
      reason: "cancelled",
      workflowRunId,
    });
  }
  if (request.lifecycleStatus !== "pending") {
    return fail(
      "workflow.v1.fact_conflict",
      "Approval state is decided without an immutable decision fact.",
    );
  }
  let issues: readonly string[];
  try {
    issues = configuration.schemaValidation.validate(schema, options.decision);
  } catch (error) {
    return fail(
      "workflow.v1.approval_decision_invalid",
      `Approval decision validator failed closed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !Array.isArray(issues) ||
    issues.some((issue) => typeof issue !== "string") ||
    issues.length > 0
  ) {
    return fail(
      "workflow.v1.approval_decision_invalid",
      `Approval decision does not satisfy its pinned schema${
        issues.length > 0 ? `: ${issues.slice(0, 5).join("; ")}` : "."
      }`,
    );
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO workflow_approval_decision (
       id,
       workspace_id,
       approval_request_id,
       actor_principal_id,
       authorization_decision_id,
       authorization_context,
       authorization_digest,
       decision,
       decision_digest,
       decided_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.decisionId,
      options.workspaceId,
      request.id,
      options.authorization.actorPrincipalId,
      options.authorization.authorizationDecisionId,
      jsonForDatabase({
        effect: options.authorization.effect,
        workspaceId: options.authorization.workspaceId,
        approvalRequestId: options.authorization.approvalRequestId,
        actorPrincipalId: options.authorization.actorPrincipalId,
        permission: options.authorization.permission,
        bindingDigest: options.authorization.bindingDigest,
        policyRevision: options.authorization.policyRevision,
        authorizedAt: options.authorization.authorizedAt.toISOString(),
        validUntil: options.authorization.validUntil.toISOString(),
      }),
      authorizationDigestValue,
      jsonForDatabase(options.decision),
      decisionDigest,
      options.now,
    ],
  );
  const nextStateVersion = request.stateVersion + 1;
  const [stateUpdate] = await connection.execute<ResultSetHeader>(
    `UPDATE workflow_approval_state
       SET lifecycle_status = 'decided',
           version = ?,
           updated_at = ?,
           decided_at = ?
       WHERE approval_request_id = ?
         AND version = ?
         AND lifecycle_status = 'pending'`,
    [
      nextStateVersion,
      options.now,
      options.now,
      request.id,
      request.stateVersion,
    ],
  );
  if (stateUpdate.affectedRows !== 1) {
    return fail(
      "workflow.v1.state_conflict",
      "Approval decision lost first-decision-wins arbitration.",
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
       publish_attempts,
       created_at
     ) VALUES (
       ?, ?, 'approval.decision.recorded', 1,
       'workflow_approval_request', ?, ?, ?, 'pending', ?, 0, ?
     )`,
    [
      options.outboxEventId,
      options.workspaceId,
      request.id,
      nextStateVersion,
      jsonForDatabase({
        workflowRunId,
        nodeRunId: request.nodeRunId,
        approvalRequestId: request.id,
        decisionId: options.decisionId,
        expectedGeneration: options.executionGeneration,
      }),
      options.now,
      options.now,
    ],
  );
  return Object.freeze({
    status: "recorded",
    decisionId: options.decisionId,
    workflowRunId,
  });
}

export function createBoundedWorkflowOrchestratorStore(
  pool: Pool,
  options: CreateBoundedWorkflowOrchestratorStoreOptions,
): BoundedWorkflowOrchestratorStore {
  const configuration = normalizeConfiguration(options);
  return Object.freeze({
    consumeFrontier(frontierOptions: ConsumeBoundedWorkflowFrontierOptions) {
      assertIdentifier(frontierOptions.workflowRunId, "workflowRunId");
      assertDate(frontierOptions.now, "now");
      boundedInteger(
        frontierOptions.executionGeneration,
        1,
        4_294_967_295,
        "executionGeneration",
      );
      return inTransaction(pool, (connection) =>
        consumeInboxEvent<
          InboxEffectResult<ConsumeBoundedWorkflowFrontierResult>
        >(connection, frontierOptions.delivery, async (event) => {
          assertCanonicalCauseEnvelope(event, frontierOptions);
          const state = await loadFrontierState(
            connection,
            configuration,
            frontierOptions,
          );
          const causeStatus = assertCauseFact(event, state);
          if (causeStatus === "stale") {
            return {
              outcome: "noop",
              resultCode: "workflow.v1.cause_stale",
              value: {
                workflowRunId: state.run.id,
                transitions: 0,
                nodeCreates: 0,
                continuationScheduled: false,
                lifecycleStatus: state.run.lifecycleStatus,
              },
            };
          }
          if (
            state.run.lifecycleStatus === "completed" ||
            state.run.lifecycleStatus === "failed" ||
            state.run.lifecycleStatus === "cancelled"
          ) {
            return {
              outcome: "noop",
              resultCode: "workflow.v1.run_not_active",
              value: {
                workflowRunId: state.run.id,
                transitions: 0,
                nodeCreates: 0,
                continuationScheduled: false,
                lifecycleStatus: state.run.lifecycleStatus,
              },
            };
          }
          sealExecutionDeadline(state);
          await ensureDeadlineSchedule(state);
          if (
            state.run.lifecycleStatus === "cancelling" &&
            state.run.cancelReasonCode !== "workflow.timeout"
          ) {
            return {
              outcome: "noop",
              resultCode: "workflow.v1.run_not_active",
              value: {
                workflowRunId: state.run.id,
                transitions: 0,
                nodeCreates: 0,
                continuationScheduled: false,
                lifecycleStatus: state.run.lifecycleStatus,
              },
            };
          }
          if (
            executionDeadlineReached(state) ||
            (state.run.lifecycleStatus === "cancelling" &&
              state.run.cancelReasonCode === "workflow.timeout")
          ) {
            await convergeDeadlineCancellation(state);
            await persistRunState(state);
            const deadlineApplied = state.runChanged || state.transitions > 0;
            const deadlineSettled = new Set<WorkflowRunRow["lifecycleStatus"]>([
              "cancelled",
            ]).has(state.run.lifecycleStatus);
            let resultCode = "workflow.v1.deadline_waiting";
            if (deadlineSettled) {
              resultCode = "workflow.v1.deadline_cancelled";
            } else if (deadlineApplied) {
              resultCode = "workflow.v1.deadline_cancellation_requested";
            }
            return {
              outcome: deadlineApplied ? "applied" : "noop",
              resultCode,
              value: {
                workflowRunId: state.run.id,
                transitions: state.transitions,
                nodeCreates: state.nodeCreates,
                continuationScheduled: state.continuationRequired,
                lifecycleStatus: state.run.lifecycleStatus,
              },
            };
          }
          await processRootFrontier(state);
          await finalizeWorkflowIfReady(state);
          await persistRunState(state);
          const applied = state.runChanged || state.transitions > 0;
          const terminalAfterFrontier = new Set<
            WorkflowRunRow["lifecycleStatus"]
          >(["completed", "failed", "cancelled"]).has(
            state.run.lifecycleStatus,
          );
          return {
            outcome: applied ? "applied" : "noop",
            resultCode: applied
              ? "workflow.v1.frontier_applied"
              : "workflow.v1.frontier_waiting",
            value: {
              workflowRunId: state.run.id,
              transitions: state.transitions,
              nodeCreates: state.nodeCreates,
              continuationScheduled:
                state.continuationRequired && !terminalAfterFrontier,
              lifecycleStatus: state.run.lifecycleStatus,
            },
          };
        }),
      );
    },

    decideApproval(decisionOptions: DecideWorkflowApprovalOptions) {
      return inTransaction(pool, (connection) =>
        decideApprovalInTransaction(connection, configuration, decisionOptions),
      );
    },
  });
}
