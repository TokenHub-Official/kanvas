import { recordAgentLibraryToolInputsInTransaction } from "./agent-library-store.js";
import {
  DomainError,
  type AutomaticFallbackReason,
  type CapabilityBindingResolver,
  type CapabilityExecutionTarget,
  type CapabilityIdempotencyMode,
  type CapabilityRouteSnapshot,
  type NodeRunRepository,
  type OutboxEventRecord,
  type OutboxRepository,
  type TransactionContext,
  type TransactionManager,
  type WorkflowCancellationReasonCode,
  type WorkflowCancellationRecord,
  type WorkflowCancellationRepository,
  type WorkflowCandidateRepository,
  type WorkflowBrandContextResolver,
  type WorkflowRevisionRepository,
  type WorkflowRunRecord,
  type WorkflowRunRepository,
} from "@kanvas/application";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  normalizeAttemptTimeoutMs,
  normalizeRetryPolicy,
} from "./execution-retry-policy.js";
import {
  parseProviderDeploymentHardBounds,
  type ProviderDeploymentHardBounds,
} from "./configuration-policy.js";
import {
  createMysqlTransactionRuntime,
  type MysqlTransactionRuntime,
} from "./mysql-transaction-runtime.js";
import {
  ProviderRouteStoreError,
  resolveProviderRouteInTransaction,
} from "./provider-route-store.js";
import { parseWorkflowPublicationDocument } from "./publication-documents.js";

interface WorkflowRevisionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly canonicalDigest: string;
  readonly topology: unknown;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

interface WorkflowRunRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly definitionKind: "published_revision" | "publication_candidate";
  readonly workflowRevisionId: string | null;
  readonly publicationCandidateId: string | null;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly nonProduction: number | boolean;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly lifecycleStatus: WorkflowRunRecord["lifecycleStatus"];
  readonly outcome: WorkflowRunRecord["outcome"];
  readonly executionDeadlineAt: Date;
  readonly input: unknown;
  readonly executionPlanSnapshot: unknown;
  readonly executionPlanHash: string;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

interface WorkflowBrandRevisionRow extends RowDataPacket {
  readonly brandKitRevisionId: string;
  readonly brandKitId: string;
  readonly brandName: string;
  readonly brandRevisionNumber: number | string;
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

interface CancellationRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly cancelRequestedAt: Date | null;
  readonly cancelRequestedBy: string | null;
  readonly cancelReasonCode: WorkflowCancellationReasonCode | null;
  readonly cancelDeadlineAt: Date | null;
}

interface CancellationCapabilityRow extends RowDataPacket {
  readonly id: string;
  readonly currentAttemptId: string | null;
}

export interface WorkflowExecutionPersistence {
  readonly transactionManager: TransactionManager;
  readonly workflowRevisions: WorkflowRevisionRepository;
  readonly workflowCandidates: WorkflowCandidateRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly brands: WorkflowBrandContextResolver;
  readonly nodeRuns: NodeRunRepository;
  readonly outbox: OutboxRepository;
  readonly bindings: CapabilityBindingResolver;
  readonly cancellations: WorkflowCancellationRepository;
}

export interface CreateWorkflowExecutionPersistenceOptions {
  readonly providerDeploymentHardBounds?: unknown;
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function asExecutionTarget(value: string): CapabilityExecutionTarget {
  if (value === "browser" || value === "worker" || value === "provider") {
    return value;
  }
  throw new Error(`Unknown execution target in published binding: ${value}`);
}

function asIdempotencyMode(value: string): CapabilityIdempotencyMode {
  if (
    value === "intrinsic" ||
    value === "keyed" ||
    value === "non_idempotent"
  ) {
    return value;
  }
  throw new Error(`Unknown idempotency mode in published contract: ${value}`);
}

const automaticFallbackReasons = new Set<AutomaticFallbackReason>([
  "browser_executor_fenced",
  "browser_lease_expired",
  "not_started",
]);

function normalizeFallbackOn(
  routePolicy: Readonly<Record<string, unknown>>,
  executionTarget: CapabilityExecutionTarget,
): readonly AutomaticFallbackReason[] {
  if (routePolicy.fallbackOn === undefined) {
    return Object.freeze([]);
  }
  if (
    !Array.isArray(routePolicy.fallbackOn) ||
    routePolicy.fallbackOn.length > automaticFallbackReasons.size
  ) {
    throw new DomainError(
      "capability_binding.fallback_policy_invalid",
      "fallbackOn must be a bounded array of supported reasons.",
    );
  }
  const seen = new Set<AutomaticFallbackReason>();
  const reasons = routePolicy.fallbackOn.map((value) => {
    if (
      typeof value !== "string" ||
      !automaticFallbackReasons.has(value as AutomaticFallbackReason)
    ) {
      throw new DomainError(
        "capability_binding.fallback_policy_invalid",
        `Unsupported fallback reason: ${String(value)}.`,
      );
    }
    const reason = value as AutomaticFallbackReason;
    if (seen.has(reason)) {
      throw new DomainError(
        "capability_binding.fallback_policy_invalid",
        `Duplicate fallback reason: ${reason}.`,
      );
    }
    if (executionTarget !== "browser" && reason !== "not_started") {
      throw new DomainError(
        "capability_binding.fallback_policy_invalid",
        `${reason} is only valid for a Browser candidate.`,
      );
    }
    seen.add(reason);
    return reason;
  });
  return Object.freeze(reasons);
}

export function createWorkflowExecutionPersistence(
  pool: Pool,
  transactions: MysqlTransactionRuntime = createMysqlTransactionRuntime(pool),
  options: CreateWorkflowExecutionPersistenceOptions = {},
): WorkflowExecutionPersistence {
  const providerDeploymentHardBounds: ProviderDeploymentHardBounds | undefined =
    options.providerDeploymentHardBounds === undefined
      ? undefined
      : parseProviderDeploymentHardBounds(options.providerDeploymentHardBounds);
  const { transactionManager } = transactions;
  const connectionFor = (context: TransactionContext) =>
    transactions.connectionFor(context);

  const workflowRevisions: WorkflowRevisionRepository =
    Object.freeze<WorkflowRevisionRepository>({
      async findPublishedById(workspaceId, revisionId, context) {
        const [rows] = await connectionFor(context).execute<
          WorkflowRevisionRow[]
        >(
          `SELECT
           id,
           workspace_id AS workspaceId,
           canonical_digest AS canonicalDigest,
           topology,
           input_schema AS inputSchema,
           output_schema AS outputSchema
         FROM workflow_revision
         WHERE id = ?
           AND workspace_id = ?
           AND lifecycle_status = 'published'
         LIMIT 1`,
          [revisionId, workspaceId],
        );
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        const topology = parseJson(row.topology);
        if (!isWorkflowTopology(topology)) {
          throw new DomainError(
            "workflow_revision.topology_invalid",
            "Published workflow topology does not satisfy its immutable contract.",
          );
        }
        return {
          id: row.id,
          workspaceId: row.workspaceId,
          canonicalDigest: row.canonicalDigest,
          topology,
          inputSchema: asRecord(row.inputSchema, "Workflow input schema"),
          outputSchema: asRecord(row.outputSchema, "Workflow output schema"),
        };
      },
    });

  const workflowCandidates: WorkflowCandidateRepository =
    Object.freeze<WorkflowCandidateRepository>({
      async findWorkflowCandidateById(workspaceId, candidateId, context) {
        const [rows] = await connectionFor(context).execute<
          (RowDataPacket & {
            readonly id: string;
            readonly workspaceId: string;
            readonly canonicalDigest: string;
            readonly contentDocument: unknown;
          })[]
        >(
          `SELECT
             id,
             workspace_id AS workspaceId,
             canonical_digest AS canonicalDigest,
             content_document AS contentDocument
           FROM publication_candidate
           WHERE id = ?
             AND workspace_id = ?
             AND subject_kind = 'workflow'
           LIMIT 1`,
          [candidateId, workspaceId],
        );
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        const document = parseWorkflowPublicationDocument(
          parseJson(row.contentDocument),
        );
        if (!isWorkflowTopology(document.topology)) {
          throw new DomainError(
            "workflow_candidate.topology_invalid",
            "Workflow Candidate topology does not satisfy its immutable contract.",
          );
        }
        return {
          id: row.id,
          workspaceId: row.workspaceId,
          canonicalDigest: row.canonicalDigest,
          topology: document.topology,
          inputSchema: document.inputSchema,
          outputSchema: document.outputSchema,
        };
      },
    });

  const brands: WorkflowBrandContextResolver =
    Object.freeze<WorkflowBrandContextResolver>({
      async resolve(
        workspaceId,
        requestedBrandKitRevisionId,
        canReadBrand,
        context,
      ) {
        if (requestedBrandKitRevisionId === null) {
          return undefined;
        }
        if (!canReadBrand) {
          if (requestedBrandKitRevisionId !== undefined) {
            throw new DomainError(
              "workflow_run.brand_forbidden",
              "The selected Brand is not available to this actor.",
            );
          }
          return undefined;
        }
        const parameters = [workspaceId];
        const selection = requestedBrandKitRevisionId
          ? "AND revision.id = ?"
          : `AND kit.default_marker = TRUE
             AND revision.id = kit.latest_published_revision_id`;
        if (requestedBrandKitRevisionId) {
          parameters.push(requestedBrandKitRevisionId);
        }
        const [rows] = await connectionFor(context).execute<
          WorkflowBrandRevisionRow[]
        >(
          `SELECT
             revision.id AS brandKitRevisionId,
             revision.brand_kit_id AS brandKitId,
             JSON_UNQUOTE(JSON_EXTRACT(revision.content_document, '$.name')) AS brandName,
             revision.revision_number AS brandRevisionNumber
           FROM brand_kit AS kit
           INNER JOIN brand_kit_revision AS revision
             ON revision.workspace_id = kit.workspace_id
             AND revision.brand_kit_id = kit.id
           WHERE kit.workspace_id = ?
             AND kit.lifecycle_status = 'active'
             ${selection}
           LIMIT 1
           FOR SHARE`,
          parameters,
        );
        const row = rows[0];
        if (!row) {
          if (requestedBrandKitRevisionId) {
            throw new DomainError(
              "workflow_run.brand_not_found",
              "The selected Brand is unavailable in this Workspace.",
            );
          }
          return undefined;
        }
        return Object.freeze({
          brandKitId: row.brandKitId,
          brandKitRevisionId: row.brandKitRevisionId,
          name: row.brandName,
          revisionNumber: Number(row.brandRevisionNumber),
        });
      },
    });

  const workflowRuns: WorkflowRunRepository =
    Object.freeze<WorkflowRunRepository>({
      async findByIdempotencyKey(workspaceId, idempotencyKey, context) {
        const [rows] = await connectionFor(context).execute<WorkflowRunRow[]>(
          `SELECT
           run.id,
           run.workspace_id AS workspaceId,
           run.definition_kind AS definitionKind,
           run.workflow_revision_id AS workflowRevisionId,
           run.publication_candidate_id AS publicationCandidateId,
           run.brand_kit_revision_id AS brandKitRevisionId,
           brand_revision.brand_kit_id AS brandKitId,
           JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
           brand_revision.revision_number AS brandRevisionNumber,
           run.non_production AS nonProduction,
           run.idempotency_key AS idempotencyKey,
           run.request_hash AS requestHash,
           run.lifecycle_status AS lifecycleStatus,
           run.outcome,
           run.execution_deadline_at AS executionDeadlineAt,
           run.input,
           run.execution_plan_snapshot AS executionPlanSnapshot,
           run.execution_plan_hash AS executionPlanHash,
           run.created_by AS createdBy,
           run.version,
           run.created_at AS createdAt,
           run.updated_at AS updatedAt,
           run.completed_at AS completedAt
         FROM workflow_run AS run
         LEFT JOIN brand_kit_revision AS brand_revision
           ON brand_revision.workspace_id = run.workspace_id
           AND brand_revision.id = run.brand_kit_revision_id
         WHERE run.workspace_id = ? AND run.idempotency_key = ?
         LIMIT 1
         FOR UPDATE`,
          [workspaceId, idempotencyKey],
        );
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        return {
          id: row.id,
          workspaceId: row.workspaceId,
          ...(row.brandKitRevisionId &&
          row.brandKitId &&
          row.brandName &&
          row.brandRevisionNumber !== null
            ? {
                brand: {
                  brandKitId: row.brandKitId,
                  brandKitRevisionId: row.brandKitRevisionId,
                  name: row.brandName,
                  revisionNumber: Number(row.brandRevisionNumber),
                },
              }
            : {}),
          definitionKind: row.definitionKind,
          ...(row.workflowRevisionId
            ? { workflowRevisionId: row.workflowRevisionId }
            : {}),
          ...(row.publicationCandidateId
            ? {
                publicationCandidateId: row.publicationCandidateId,
              }
            : {}),
          nonProduction: Boolean(row.nonProduction),
          idempotencyKey: row.idempotencyKey,
          requestHash: row.requestHash,
          lifecycleStatus: row.lifecycleStatus,
          outcome: row.outcome,
          executionDeadlineAt: row.executionDeadlineAt,
          input: parseJson(row.input),
          executionPlanSnapshot: asRecord(
            row.executionPlanSnapshot,
            "Execution plan snapshot",
          ),
          executionPlanHash: row.executionPlanHash,
          createdBy: row.createdBy,
          version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(row.completedAt ? { completedAt: row.completedAt } : {}),
        };
      },
      async insert(record, context, agentInvocation) {
        await connectionFor(context).execute<ResultSetHeader>(
          `INSERT INTO workflow_run (
           id,
           workspace_id,
           definition_kind,
           workflow_revision_id,
           publication_candidate_id,
           brand_kit_revision_id,
           non_production,
           idempotency_key,
           request_hash,
           lifecycle_status,
           outcome,
           execution_deadline_at,
           input,
           execution_plan_snapshot,
           execution_plan_hash,
           created_by,
           version,
           created_at,
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.workspaceId,
            record.definitionKind,
            record.workflowRevisionId ?? null,
            record.publicationCandidateId ?? null,
            record.brand?.brandKitRevisionId ?? null,
            record.nonProduction,
            record.idempotencyKey,
            record.requestHash,
            record.lifecycleStatus,
            record.outcome,
            record.executionDeadlineAt ?? null,
            JSON.stringify(record.input),
            JSON.stringify(record.executionPlanSnapshot),
            record.executionPlanHash,
            record.createdBy,
            record.version,
            record.createdAt,
            record.updatedAt,
            record.completedAt ?? null,
          ],
        );
        if (agentInvocation)
          await recordAgentLibraryToolInputsInTransaction(
            connectionFor(context),
            {
              authority: agentInvocation.authority,
              invocationKind: "agent",
              invocationReferenceId: agentInvocation.actionReceiptId,
              consumerKind: "workflow",
              consumerId: record.id,
              input: record.input,
              now: record.createdAt,
            },
          );
      },
    });

  const nodeRuns: NodeRunRepository = Object.freeze<NodeRunRepository>({
    async insertMany(records, context) {
      const connection = connectionFor(context);
      for (const record of records) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO node_run (
             id,
             workspace_id,
             workflow_run_id,
             node_key,
             scope_key,
             kind,
             lifecycle_status,
             version,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.workspaceId,
            record.workflowRunId,
            record.nodeKey,
            record.scopeKey,
            record.kind,
            record.lifecycleStatus,
            record.version,
            record.createdAt,
            record.updatedAt,
          ],
        );
      }
    },
  });

  const outbox: OutboxRepository = Object.freeze<OutboxRepository>({
    async append(record: OutboxEventRecord, context) {
      await connectionFor(context).execute<ResultSetHeader>(
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          record.id,
          record.workspaceId,
          record.messageType,
          record.aggregateType,
          record.aggregateId,
          record.aggregateVersion,
          JSON.stringify(record.payload),
          record.status,
          record.availableAt,
          record.createdAt,
        ],
      );
    },
  });

  const bindings: CapabilityBindingResolver =
    Object.freeze<CapabilityBindingResolver>({
      async resolveRoutesForWorkflow(revision, context, request) {
        const routes: CapabilityRouteSnapshot[] = [];
        for (const node of revision.topology.nodes) {
          if (node.kind !== "invoke" && node.kind !== "map") {
            continue;
          }
          const capability =
            node.kind === "invoke" ? node.capability : node.invoke.capability;
          const [rows] = await connectionFor(context).execute<BindingRow[]>(
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
             ON binding.contract_revision_id = contract.id
             AND binding.workspace_id = contract.workspace_id
             AND binding.lifecycle_status = 'active'
           INNER JOIN capability_implementation_revision AS implementation
             ON implementation.id = binding.implementation_revision_id
             AND implementation.workspace_id = binding.workspace_id
             AND implementation.lifecycle_status = 'published'
           WHERE contract.workspace_id = ?
             AND contract.contract_key = ?
             AND contract.revision = ?
             AND contract.canonical_digest = ?
             AND contract.lifecycle_status = 'published'
           ORDER BY binding.priority ASC
           LIMIT 65`,
            [
              revision.workspaceId,
              capability.contractId,
              capability.revision,
              capability.canonicalDigest,
            ],
          );
          if (rows.length === 0) {
            throw new DomainError(
              "capability_binding.not_found",
              `No active implementation binding exists for node ${node.key}.`,
            );
          }
          if (rows.length > 64) {
            throw new DomainError(
              "capability_binding.route_too_broad",
              `Node ${node.key} has more than 64 active implementation bindings.`,
            );
          }
          let totalAttempts = 0;
          const candidates: CapabilityRouteSnapshot["candidates"][number][] =
            [];
          for (const row of rows) {
            const candidateIndex = candidates.length;
            const executionTarget = asExecutionTarget(row.executionTarget);
            const routePolicy = asRecord(
              row.routePolicy,
              "Capability route policy",
            );
            const retryPolicy = normalizeRetryPolicy(routePolicy);
            totalAttempts += retryPolicy.maxAttempts;
            const candidateFacts = {
              candidateIndex,
              bindingId: row.bindingId,
              bindingVersion: row.bindingVersion,
              implementationRevisionId: row.implementationRevisionId,
              implementationDigest: row.implementationDigest,
              executionTarget,
              adapterKey: row.adapterKey,
              idempotencyMode: asIdempotencyMode(row.idempotencyMode),
              retryPolicy,
              attemptTimeoutMs: normalizeAttemptTimeoutMs(routePolicy),
              fallbackOn: normalizeFallbackOn(routePolicy, executionTarget),
            } as const;
            if (executionTarget === "provider") {
              if (!row.routePolicyRevisionId) {
                totalAttempts -= retryPolicy.maxAttempts;
                continue;
              }
              let providerRoute;
              try {
                providerRoute = await resolveProviderRouteInTransaction(
                  connectionFor(context),
                  providerDeploymentHardBounds,
                  {
                    workspaceId: revision.workspaceId,
                    capabilityBindingId: row.bindingId,
                    requestScopeDigest: request.requestScopeDigest,
                    now: request.now,
                  },
                );
              } catch (error) {
                if (
                  error instanceof ProviderRouteStoreError &&
                  (error.code === "provider_route.not_configured" ||
                    error.code === "provider_route.unavailable")
                ) {
                  totalAttempts -= retryPolicy.maxAttempts;
                  continue;
                }
                throw error;
              }
              candidates.push(
                Object.freeze({
                  ...candidateFacts,
                  executionTarget,
                  providerRoute,
                }),
              );
            } else {
              candidates.push(
                Object.freeze({
                  ...candidateFacts,
                  executionTarget,
                }),
              );
            }
            if (candidates.length > 8) {
              throw new DomainError(
                "capability_binding.route_too_broad",
                `Node ${node.key} has more than eight dispatchable route candidates.`,
              );
            }
          }
          if (candidates.length === 0) {
            throw new DomainError(
              "capability_binding.not_found",
              `No dispatchable implementation binding exists for node ${node.key}.`,
            );
          }
          if (totalAttempts > 32) {
            throw new DomainError(
              "capability_binding.route_attempt_budget_exceeded",
              `Node ${node.key} route permits more than 32 total attempts.`,
            );
          }
          const contract = rows[0];
          if (!contract) {
            throw new Error("Capability route row disappeared.");
          }
          routes.push(
            Object.freeze({
              nodeKey: node.key,
              contractRevisionId: contract.contractRevisionId,
              contractKey: contract.contractKey,
              contractRevision: contract.contractRevision,
              contractDigest: contract.contractDigest,
              candidates: Object.freeze(candidates),
            }),
          );
        }
        return Object.freeze(routes);
      },
    });

  const cancellations: WorkflowCancellationRepository =
    Object.freeze<WorkflowCancellationRepository>({
      async request(options, context) {
        const connection = connectionFor(context);
        const [rows] = await connection.execute<CancellationRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             lifecycle_status AS lifecycleStatus,
             version,
             cancel_requested_at AS cancelRequestedAt,
             cancel_requested_by AS cancelRequestedBy,
             cancel_reason_code AS cancelReasonCode,
             cancel_deadline_at AS cancelDeadlineAt
           FROM workflow_run
           WHERE id = ? AND workspace_id = ?
           LIMIT 1
           FOR UPDATE`,
          [options.workflowRunId, options.workspaceId],
        );
        const run = rows[0];
        if (!run) {
          return undefined;
        }
        if (
          run.lifecycleStatus === "cancelling" ||
          run.lifecycleStatus === "cancelled"
        ) {
          if (
            !run.cancelRequestedAt ||
            !run.cancelRequestedBy ||
            !run.cancelReasonCode ||
            !run.cancelDeadlineAt
          ) {
            throw new Error("Workflow cancellation facts are incomplete.");
          }
          return {
            run: Object.freeze<WorkflowCancellationRecord>({
              id: run.id,
              workspaceId: run.workspaceId,
              lifecycleStatus: run.lifecycleStatus,
              version: run.version,
              cancelRequestedAt: run.cancelRequestedAt,
              cancelRequestedBy: run.cancelRequestedBy,
              cancelReasonCode: run.cancelReasonCode,
              cancelDeadlineAt: run.cancelDeadlineAt,
            }),
            replayed: true,
          };
        }
        if (
          run.lifecycleStatus === "completed" ||
          run.lifecycleStatus === "failed"
        ) {
          throw new DomainError(
            "workflow_run.already_terminal",
            `Workflow run is already ${run.lifecycleStatus}.`,
          );
        }

        const [capabilityRows] = await connection.execute<
          CancellationCapabilityRow[]
        >(
          `SELECT
               capability.id,
               capability.current_attempt_id AS currentAttemptId
             FROM node_run AS node
             INNER JOIN capability_run AS capability
               ON capability.node_run_id = node.id
             WHERE node.workflow_run_id = ?
               AND capability.lifecycle_status IN ('queued', 'running')
             ORDER BY node.id, capability.id
             FOR UPDATE`,
          [run.id],
        );
        for (const capability of capabilityRows) {
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_run
             SET cancel_requested_at = ?,
                 cancel_deadline_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND lifecycle_status IN ('queued', 'running')
               AND cancel_requested_at IS NULL`,
            [options.now, options.cancelDeadlineAt, options.now, capability.id],
          );
          if (capability.currentAttemptId) {
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_attempt
               SET cancel_requested_at = ?,
                   cancel_deadline_at = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND lifecycle_status IN ('created', 'running')
                 AND cancel_requested_at IS NULL`,
              [
                options.now,
                options.cancelDeadlineAt,
                options.now,
                capability.currentAttemptId,
              ],
            );
          }
        }

        const nextVersion = run.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE workflow_run
           SET lifecycle_status = 'cancelling',
               cancel_requested_at = ?,
               cancel_requested_by = ?,
               cancel_reason_code = ?,
               cancel_deadline_at = ?,
               version = ?,
               updated_at = ?
           WHERE id = ?
             AND version = ?
             AND lifecycle_status IN ('queued', 'running', 'waiting')
             AND cancel_requested_at IS NULL`,
          [
            options.now,
            options.actorId,
            options.reasonCode,
            options.cancelDeadlineAt,
            nextVersion,
            options.now,
            run.id,
            run.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new DomainError(
            "workflow_run.cancel_conflict",
            "Workflow run cancellation lost its state transition race.",
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
           ) VALUES (?, ?, 'workflow.cancel.requested', 'workflow_run', ?, ?, ?, 'pending', ?, 0, ?)`,
          [
            options.outboxEventId,
            run.workspaceId,
            run.id,
            nextVersion,
            JSON.stringify({
              workflowRunId: run.id,
              expectedGeneration: options.executionGeneration,
              cause: "workflow_run.cancel_requested",
            }),
            options.now,
            options.now,
          ],
        );

        return {
          run: Object.freeze<WorkflowCancellationRecord>({
            id: run.id,
            workspaceId: run.workspaceId,
            lifecycleStatus: "cancelling",
            version: nextVersion,
            cancelRequestedAt: options.now,
            cancelRequestedBy: options.actorId,
            cancelReasonCode: options.reasonCode,
            cancelDeadlineAt: options.cancelDeadlineAt,
          }),
          replayed: false,
        };
      },
    });

  return Object.freeze({
    transactionManager,
    workflowRevisions,
    workflowCandidates,
    brands,
    workflowRuns,
    nodeRuns,
    outbox,
    bindings,
    cancellations,
  });
}
