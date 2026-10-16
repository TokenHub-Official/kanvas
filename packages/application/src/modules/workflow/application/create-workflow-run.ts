import type { TrustedWorkspaceScope } from "../../authorization/permission-model.js";
import type { CanvasBrandContext } from "@kanvas/contracts/api";
import type { WorkflowTopology } from "@kanvas/contracts/workflow";

import type { Clock } from "../../../foundation/clock.js";
import { DomainError } from "../../../foundation/domain-error.js";
import type { IdGenerator } from "../../../foundation/id-generator.js";
import type { RuntimeStateReader } from "../../../foundation/runtime-fence.js";
import type {
  TransactionContext,
  TransactionManager,
} from "../../../foundation/transaction-context.js";
import {
  parseProviderRouteSnapshot,
  type ProviderRouteSnapshot,
} from "./provider-route-snapshot.js";

export interface PublishedWorkflowRevision {
  readonly id: string;
  readonly workspaceId: string;
  readonly canonicalDigest: string;
  readonly topology: WorkflowTopology;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface WorkflowPublicationCandidate {
  readonly id: string;
  readonly workspaceId: string;
  readonly canonicalDigest: string;
  readonly topology: WorkflowTopology;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export type ExecutableWorkflowDefinition =
  | (PublishedWorkflowRevision & {
      readonly definitionKind: "published_revision";
    })
  | (WorkflowPublicationCandidate & {
      readonly definitionKind: "publication_candidate";
    });

export type CapabilityExecutionTarget = "browser" | "provider" | "worker";

export type CapabilityIdempotencyMode =
  "intrinsic" | "keyed" | "non_idempotent";

export interface CapabilityRetryPolicySnapshot {
  readonly maxAttempts: number;
  readonly backoff: "fixed" | "exponential";
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export type AutomaticFallbackReason =
  "browser_executor_fenced" | "browser_lease_expired" | "not_started";

interface RouteCandidateSnapshotFacts {
  readonly candidateIndex: number;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly executionTarget: CapabilityExecutionTarget;
  readonly adapterKey: string;
  readonly idempotencyMode: CapabilityIdempotencyMode;
  readonly retryPolicy: CapabilityRetryPolicySnapshot;
  readonly attemptTimeoutMs: number;
  /**
   * The only automatic fallback classes approved when the immutable plan
   * was created. An empty list fails closed.
   */
  readonly fallbackOn: readonly AutomaticFallbackReason[];
}

export type RouteCandidateSnapshot =
  | (RouteCandidateSnapshotFacts & {
      readonly executionTarget: "provider";
      readonly providerRoute: ProviderRouteSnapshot;
    })
  | (RouteCandidateSnapshotFacts & {
      readonly executionTarget: "browser" | "worker";
      readonly providerRoute?: never;
    });

/**
 * ExecutionPlan v1 authority for one capability-bearing workflow node.
 * Candidates are ordered by a contiguous, zero-based candidateIndex.
 */
export interface CapabilityRouteSnapshot {
  readonly nodeKey: string;
  readonly contractRevisionId: string;
  readonly contractKey: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly candidates: readonly RouteCandidateSnapshot[];
}

export interface WorkflowRunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly brand?: CanvasBrandContext;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId?: string;
  readonly publicationCandidateId?: string;
  readonly nonProduction: boolean;
  readonly idempotencyKey: string;
  readonly requestHash: string;
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
  readonly executionDeadlineAt: Date;
  readonly input: unknown;
  readonly executionPlanSnapshot: Readonly<Record<string, unknown>>;
  readonly executionPlanHash: string;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface NodeRunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly nodeKey: string;
  readonly scopeKey: "root";
  readonly kind: "invoke" | "switch" | "map" | "approval";
  readonly lifecycleStatus: "pending";
  readonly version: 1;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OutboxEventRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly messageType: "workflow.wakeup.requested";
  readonly aggregateType: "workflow_run";
  readonly aggregateId: string;
  readonly aggregateVersion: 1;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: "pending";
  readonly availableAt: Date;
  readonly createdAt: Date;
}

export interface WorkflowRevisionRepository {
  findPublishedById(
    workspaceId: string,
    revisionId: string,
    context: TransactionContext,
  ): Promise<PublishedWorkflowRevision | undefined>;
}

export interface WorkflowCandidateRepository {
  findWorkflowCandidateById(
    workspaceId: string,
    candidateId: string,
    context: TransactionContext,
  ): Promise<WorkflowPublicationCandidate | undefined>;
}

export interface WorkflowRunRepository {
  findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
    context: TransactionContext,
  ): Promise<WorkflowRunRecord | undefined>;
  insert(
    record: WorkflowRunRecord,
    context: TransactionContext,
    agentInvocation?: WorkflowAgentInvocation,
  ): Promise<void>;
}

export interface WorkflowBrandContextResolver {
  resolve(
    workspaceId: string,
    requestedBrandKitRevisionId: string | null | undefined,
    canReadBrand: boolean,
    context: TransactionContext,
  ): Promise<CanvasBrandContext | undefined>;
}

export interface NodeRunRepository {
  insertMany(
    records: readonly NodeRunRecord[],
    context: TransactionContext,
  ): Promise<void>;
}

export interface OutboxRepository {
  append(record: OutboxEventRecord, context: TransactionContext): Promise<void>;
}

export interface CapabilityBindingResolver {
  resolveRoutesForWorkflow(
    revision: PublishedWorkflowRevision,
    context: TransactionContext,
    request: {
      readonly requestScopeDigest: string;
      readonly now: Date;
    },
  ): Promise<readonly CapabilityRouteSnapshot[]>;
}

export interface JsonSchemaInputValidator {
  validate(
    schema: Readonly<Record<string, unknown>>,
    value: unknown,
  ): readonly string[];
}

export interface CanonicalDigest {
  of(value: unknown): string;
}

export interface WorkflowAgentInvocation {
  readonly authority: TrustedWorkspaceScope;
  readonly actionReceiptId: string;
}

export interface CreateWorkflowRunCommand {
  readonly agentInvocation?: WorkflowAgentInvocation;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly workflowRevisionId: string;
  readonly brandKitRevisionId?: string | null;
  readonly canReadBrand?: boolean;
  readonly idempotencyKey: string;
  readonly input: unknown;
}

export interface CreateWorkflowRunResult {
  readonly run: WorkflowRunRecord;
  readonly replayed: boolean;
}

export type CreateWorkflowRun = (
  command: CreateWorkflowRunCommand,
) => Promise<CreateWorkflowRunResult>;

export interface CreateWorkflowRunDependencies {
  readonly clock: Clock;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly ids: IdGenerator;
  readonly digest: CanonicalDigest;
  readonly inputValidator: JsonSchemaInputValidator;
  readonly transactionManager: TransactionManager;
  readonly workflowRevisions: WorkflowRevisionRepository;
  readonly workflowCandidates?: WorkflowCandidateRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly brands?: WorkflowBrandContextResolver;
  readonly nodeRuns: NodeRunRepository;
  readonly outbox: OutboxRepository;
  readonly bindings: CapabilityBindingResolver;
}

export interface CreateWorkflowCandidateTestRunCommand {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly publicationCandidateId: string;
  readonly idempotencyKey: string;
  readonly input: unknown;
}

export type CreateWorkflowCandidateTestRun = (
  command: CreateWorkflowCandidateTestRunCommand,
) => Promise<CreateWorkflowRunResult>;

export type CreateWorkflowRunInTransactionDependencies = Omit<
  CreateWorkflowRunDependencies,
  "transactionManager"
>;

function assertBoundedIdempotencyKey(value: string): void {
  if (value.length < 1 || value.length > 160) {
    throw new DomainError(
      "workflow_run.idempotency_key_invalid",
      "Idempotency key must contain between 1 and 160 characters.",
    );
  }
}

function invalidRouteSnapshot(message: string): never {
  throw new DomainError("workflow_run.route_snapshot_invalid", message);
}

function snapshotRoutesForExecutionPlan(
  revision: PublishedWorkflowRevision,
  routes: readonly CapabilityRouteSnapshot[],
): readonly CapabilityRouteSnapshot[] {
  const capabilityNodes = new Map(
    revision.topology.nodes.flatMap((node) => {
      if (node.kind === "invoke") {
        return [[node.key, node.capability] as const];
      }
      if (node.kind === "map") {
        return [[node.key, node.invoke.capability] as const];
      }
      return [];
    }),
  );
  const seenNodes = new Set<string>();
  const snapshots = routes.map((route) => {
    const capability = capabilityNodes.get(route.nodeKey);
    if (!capability || seenNodes.has(route.nodeKey)) {
      return invalidRouteSnapshot(
        capability
          ? `Node ${route.nodeKey} has more than one route snapshot.`
          : `Route ${route.nodeKey} has no capability-bearing topology node.`,
      );
    }
    seenNodes.add(route.nodeKey);
    if (
      route.contractKey !== capability.contractId ||
      route.contractRevision !== capability.revision ||
      route.contractDigest !== capability.canonicalDigest
    ) {
      return invalidRouteSnapshot(
        `Route ${route.nodeKey} does not match its pinned Capability Contract revision.`,
      );
    }
    if (route.candidates.length < 1 || route.candidates.length > 8) {
      return invalidRouteSnapshot(
        `Route ${route.nodeKey} must contain between 1 and 8 candidates.`,
      );
    }
    let totalAttempts = 0;
    const bindingIds = new Set<string>();
    const candidates = route.candidates.map((candidate, index) => {
      if (
        candidate.candidateIndex !== index ||
        bindingIds.has(candidate.bindingId)
      ) {
        return invalidRouteSnapshot(
          `Route ${route.nodeKey} candidates must be unique, contiguous and zero-based.`,
        );
      }
      bindingIds.add(candidate.bindingId);
      totalAttempts += candidate.retryPolicy.maxAttempts;
      if (
        !Number.isSafeInteger(candidate.attemptTimeoutMs) ||
        candidate.attemptTimeoutMs < 1000 ||
        candidate.attemptTimeoutMs > 3_600_000 ||
        candidate.fallbackOn.length > 3 ||
        new Set(candidate.fallbackOn).size !== candidate.fallbackOn.length
      ) {
        return invalidRouteSnapshot(
          `Route ${route.nodeKey} candidate ${String(index)} has invalid timeout or fallback bounds.`,
        );
      }
      if (
        candidate.executionTarget !== "browser" &&
        candidate.fallbackOn.some((reason) => reason !== "not_started")
      ) {
        return invalidRouteSnapshot(
          `Route ${route.nodeKey} candidate ${String(index)} uses a Browser-only fallback reason.`,
        );
      }
      const facts = {
        candidateIndex: candidate.candidateIndex,
        bindingId: candidate.bindingId,
        bindingVersion: candidate.bindingVersion,
        implementationRevisionId: candidate.implementationRevisionId,
        implementationDigest: candidate.implementationDigest,
        executionTarget: candidate.executionTarget,
        adapterKey: candidate.adapterKey,
        idempotencyMode: candidate.idempotencyMode,
        retryPolicy: Object.freeze({
          maxAttempts: candidate.retryPolicy.maxAttempts,
          backoff: candidate.retryPolicy.backoff,
          initialDelayMs: candidate.retryPolicy.initialDelayMs,
          maxDelayMs: candidate.retryPolicy.maxDelayMs,
        }),
        attemptTimeoutMs: candidate.attemptTimeoutMs,
        fallbackOn: Object.freeze([...candidate.fallbackOn]),
      } as const;
      if (candidate.executionTarget === "provider") {
        return Object.freeze({
          ...facts,
          executionTarget: candidate.executionTarget,
          providerRoute: parseProviderRouteSnapshot(candidate.providerRoute),
        });
      }
      if (Object.hasOwn(candidate, "providerRoute")) {
        return invalidRouteSnapshot(
          `Route ${route.nodeKey} candidate ${String(index)} has Provider facts on a non-Provider target.`,
        );
      }
      return Object.freeze({
        ...facts,
        executionTarget: candidate.executionTarget,
      });
    });
    if (totalAttempts > 32) {
      return invalidRouteSnapshot(
        `Route ${route.nodeKey} permits more than 32 total attempts.`,
      );
    }
    return Object.freeze({
      nodeKey: route.nodeKey,
      contractRevisionId: route.contractRevisionId,
      contractKey: route.contractKey,
      contractRevision: route.contractRevision,
      contractDigest: route.contractDigest,
      candidates: Object.freeze(candidates),
    });
  });
  for (const nodeKey of capabilityNodes.keys()) {
    if (!seenNodes.has(nodeKey)) {
      invalidRouteSnapshot(
        `Capability-bearing node ${nodeKey} has no ordered route snapshot.`,
      );
    }
  }
  return Object.freeze(snapshots);
}

async function createWorkflowRunFromDefinitionInTransaction(
  dependencies: CreateWorkflowRunInTransactionDependencies,
  command: CreateWorkflowRunCommand | CreateWorkflowCandidateTestRunCommand,
  context: TransactionContext,
): Promise<CreateWorkflowRunResult> {
  assertBoundedIdempotencyKey(command.idempotencyKey);
  const agentInvocation =
    "agentInvocation" in command ? command.agentInvocation : undefined;
  if (
    agentInvocation &&
    (agentInvocation.authority.workspaceId !== command.workspaceId ||
      agentInvocation.authority.principalId !== command.actorId)
  )
    throw new DomainError(
      "authorization.permission_denied",
      "Workflow invocation authority does not match its owner.",
    );
  const candidateCommand = "publicationCandidateId" in command;
  const definitionKind = candidateCommand
    ? "publication_candidate"
    : "published_revision";
  const definitionId = candidateCommand
    ? command.publicationCandidateId
    : command.workflowRevisionId;
  const requestedBrandKitRevisionId = candidateCommand
    ? null
    : command.brandKitRevisionId;
  const canReadBrand = candidateCommand ? false : Boolean(command.canReadBrand);
  const requestHash = dependencies.digest.of({
    definitionKind,
    definitionId,
    brandSelection:
      requestedBrandKitRevisionId === null
        ? "without_brand"
        : (requestedBrandKitRevisionId ??
          (canReadBrand ? "workspace_default" : "without_brand")),
    input: command.input,
  });

  const existing = await dependencies.workflowRuns.findByIdempotencyKey(
    command.workspaceId,
    command.idempotencyKey,
    context,
  );
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError(
        "workflow_run.idempotency_conflict",
        "The idempotency key is already bound to a different request.",
      );
    }
    return {
      run: existing,
      replayed: true,
    };
  }

  const runtimeState = await dependencies.runtimeStateReader.read();
  if (runtimeState.state !== "ACTIVE") {
    throw new DomainError(
      "workflow_run.runtime_not_active",
      `New workflow runs are not accepted while runtime state is ${runtimeState.state}.`,
    );
  }

  const revision: ExecutableWorkflowDefinition | undefined =
    definitionKind === "published_revision"
      ? await dependencies.workflowRevisions
          .findPublishedById(command.workspaceId, definitionId, context)
          .then((value) =>
            value
              ? {
                  ...value,
                  definitionKind: "published_revision" as const,
                }
              : undefined,
          )
      : await dependencies.workflowCandidates
          ?.findWorkflowCandidateById(
            command.workspaceId,
            definitionId,
            context,
          )
          .then((value) =>
            value
              ? {
                  ...value,
                  definitionKind: "publication_candidate" as const,
                }
              : undefined,
          );
  if (!revision) {
    throw new DomainError(
      definitionKind === "published_revision"
        ? "workflow_revision.not_found"
        : "workflow_candidate.not_found",
      definitionKind === "published_revision"
        ? "Published workflow revision was not found."
        : "Workflow Publication Candidate was not found.",
    );
  }

  const inputErrors = dependencies.inputValidator.validate(
    revision.inputSchema,
    command.input,
  );
  if (inputErrors.length > 0) {
    throw new DomainError(
      "workflow_run.input_invalid",
      `Workflow input failed validation: ${inputErrors.join(", ")}`,
    );
  }

  let brand: CanvasBrandContext | undefined;
  if (!candidateCommand) {
    if (dependencies.brands) {
      brand = await dependencies.brands.resolve(
        command.workspaceId,
        command.brandKitRevisionId,
        canReadBrand,
        context,
      );
    } else if (
      typeof command.brandKitRevisionId === "string" ||
      (command.brandKitRevisionId === undefined && canReadBrand)
    ) {
      throw new DomainError(
        "workflow_run.brand_resolver_not_configured",
        "Workflow Brand context resolution is not configured.",
      );
    }
  }

  const now = dependencies.clock.now();
  const routes = snapshotRoutesForExecutionPlan(
    revision,
    await dependencies.bindings
      .resolveRoutesForWorkflow(revision, context, {
        requestScopeDigest: requestHash,
        now,
      })
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "provider_route.unavailable"
        ) {
          throw new DomainError(
            "workflow_run.route_unavailable",
            "A configured execution route is blocked until its provider or pending charge is reviewed.",
          );
        }
        throw error;
      }),
  );
  const plan = Object.freeze({
    schemaVersion: 1 as const,
    ...(revision.definitionKind === "published_revision"
      ? {
          workflowRevision: Object.freeze({
            id: revision.id,
            canonicalDigest: revision.canonicalDigest,
          }),
        }
      : {
          workflowDefinition: Object.freeze({
            kind: revision.definitionKind,
            id: revision.id,
            canonicalDigest: revision.canonicalDigest,
          }),
        }),
    topology: revision.topology,
    routes,
  });
  const executionDeadlineAt = new Date(
    now.getTime() + revision.topology.limits.timeoutMs,
  );
  const run: WorkflowRunRecord = Object.freeze({
    id: dependencies.ids.next(),
    workspaceId: command.workspaceId,
    ...(brand ? { brand } : {}),
    definitionKind: revision.definitionKind,
    ...(revision.definitionKind === "published_revision"
      ? { workflowRevisionId: revision.id }
      : { publicationCandidateId: revision.id }),
    nonProduction: revision.definitionKind === "publication_candidate",
    idempotencyKey: command.idempotencyKey,
    requestHash,
    lifecycleStatus: "queued",
    outcome: null,
    executionDeadlineAt,
    input: command.input,
    executionPlanSnapshot: plan,
    executionPlanHash: dependencies.digest.of(plan),
    createdBy: command.actorId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const nodes = revision.topology.nodes.map<NodeRunRecord>((node) =>
    Object.freeze({
      id: dependencies.ids.next(),
      workspaceId: command.workspaceId,
      workflowRunId: run.id,
      nodeKey: node.key,
      scopeKey: "root",
      kind: node.kind,
      lifecycleStatus: "pending",
      version: 1,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const event: OutboxEventRecord = Object.freeze({
    id: dependencies.ids.next(),
    workspaceId: command.workspaceId,
    messageType: "workflow.wakeup.requested",
    aggregateType: "workflow_run",
    aggregateId: run.id,
    aggregateVersion: 1,
    payload: Object.freeze({
      workflowRunId: run.id,
      cause: "workflow_run.created",
      expectedGeneration: runtimeState.executionGeneration,
    }),
    status: "pending",
    availableAt: now,
    createdAt: now,
  });

  await dependencies.workflowRuns.insert(run, context, agentInvocation);
  await dependencies.nodeRuns.insertMany(nodes, context);
  await dependencies.outbox.append(event, context);

  return {
    run,
    replayed: false,
  };
}

export function createWorkflowRunInTransaction(
  dependencies: CreateWorkflowRunInTransactionDependencies,
  command: CreateWorkflowRunCommand,
  context: TransactionContext,
): Promise<CreateWorkflowRunResult> {
  return createWorkflowRunFromDefinitionInTransaction(
    dependencies,
    command,
    context,
  );
}

export function createCreateWorkflowRun(
  dependencies: CreateWorkflowRunDependencies,
): CreateWorkflowRun {
  return (command) =>
    dependencies.transactionManager.run((context) =>
      createWorkflowRunInTransaction(dependencies, command, context),
    );
}

export function createCreateWorkflowCandidateTestRun(
  dependencies: CreateWorkflowRunDependencies,
): CreateWorkflowCandidateTestRun {
  return (command) =>
    dependencies.transactionManager.run((context) =>
      createWorkflowRunFromDefinitionInTransaction(
        dependencies,
        command,
        context,
      ),
    );
}
