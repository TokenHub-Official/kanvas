import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { createAtomicAttemptCompletionStore } from "../src/runtime/attempt-completion-store.js";
import { createWorkflowReconcilerStore } from "../src/runtime/workflow-reconciler-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const ids = Object.freeze({
  workspace: identity(8_000_001),
  actor: identity(8_000_002),
  contract: identity(8_000_003),
  implementation: identity(8_000_004),
  binding: identity(8_000_005),
  workflowRevision: identity(8_000_006),
  wakeupWorkflow: identity(8_100_001),
  wakeupNode: identity(8_100_002),
  expiredWorkflow: identity(8_200_001),
  expiredNode: identity(8_200_002),
  expiredCapability: identity(8_200_003),
  expiredAttempt: identity(8_200_004),
  wakeupOutboxA: identity(8_300_001),
  wakeupOutboxB: identity(8_300_002),
  retryAttemptA: identity(8_400_001),
  retryAttemptB: identity(8_400_002),
  retryOutboxA: identity(8_500_001),
  retryOutboxB: identity(8_500_002),
  lateCompletionOutbox: identity(8_500_003),
  lateCompletion: identity(8_500_004),
  adapterDefinition: identity(8_000_007),
  adapterRevision: identity(8_000_008),
});

const fixtureAt = new Date("2026-07-27T17:00:00.000Z");
const staleBefore = new Date("2026-07-27T17:01:00.000Z");
const reconcileAt = new Date("2026-07-27T17:02:00.000Z");
const leaseTokenHash = "b".repeat(64);
const runtimeInstanceId = "workflow-reconciler-concurrency-test";

interface WorkflowRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly version: number;
  readonly updatedAt: Date;
}

interface CapabilityRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly currentAttemptId: string | null;
  readonly acceptedAttemptId: string | null;
  readonly version: number;
}

interface AttemptRow extends RowDataPacket {
  readonly id: string;
  readonly attemptNumber: number;
  readonly lifecycleStatus: string;
  readonly sideEffectState: string;
  readonly retryDisposition: string | null;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly version: number;
}

interface OutboxRow extends RowDataPacket {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly status: string;
  readonly payload: unknown;
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object payload.");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

describe.skipIf(!integrationEnabled)(
  "workflow reconciler concurrency against a real MySQL 8.0 database",
  () => {
    let pool: Pool;

    const removeFixtures = async (
      connection: PoolConnection,
    ): Promise<void> => {
      if (!(await resetDisposableIntegrationDatabase(connection))) {
        throw new Error(
          "Workflow reconciler integration requires a runner-owned disposable database.",
        );
      }
    };

    const seedFoundation = async (): Promise<void> => {
      const contractDigest = digest("a");
      const implementationDigest = digest("b");
      const topology = {
        schemaVersion: 1,
        key: "foundation_reconciler_concurrency",
        entryNodeKey: "invoke",
        limits: { maxNodeRuns: 1, timeoutMs: 300_000 },
        nodes: [
          {
            key: "invoke",
            kind: "invoke",
            capability: {
              contractId: "foundation.reconciler-concurrency",
              revision: 1,
              canonicalDigest: contractDigest,
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      };
      const retryPolicy = {
        maxAttempts: 3,
        backoff: "fixed",
        initialDelayMs: 0,
        maxDelayMs: 0,
      };

      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'reconciler-concurrency',
           'Reconciler Concurrency', 'active', 1, ?, ?)`,
        [ids.workspace, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES (?, ?, 'reconciler-concurrency',
           'Reconciler Concurrency', 'active', 1, ?, ?)`,
        [ids.workspace, ids.workspace, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id,
           state,
           execution_generation,
           state_version,
           reason,
           deadline,
           changed_by,
           changed_at
         ) VALUES (?, 'ACTIVE', 11, 1, 'integration_test', NULL,
           'workflow-reconciler-concurrency.integration', ?)`,
        [runtimeInstanceId, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO capability_contract_revision (
           id,
           workspace_id,
           contract_key,
           revision,
           lifecycle_status,
           canonical_digest,
           input_schema,
           output_schema,
           idempotency_mode,
           supported_invokers,
           created_at,
           published_at
         ) VALUES (?, ?, 'foundation.reconciler-concurrency', 1, 'published', ?, ?, ?, 'intrinsic', ?, ?, ?)`,
        [
          ids.contract,
          ids.workspace,
          contractDigest,
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          JSON.stringify(["workflow"]),
          fixtureAt,
          fixtureAt,
        ],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: ids.workspace,
        contractRevisionId: ids.contract,
        adapterDefinitionId: ids.adapterDefinition,
        adapterRevisionId: ids.adapterRevision,
        adapterKey: "test.reconciler-concurrency",
        executionTarget: "worker",
        implementationId: ids.implementation,
        implementationKey: "foundation.reconciler-concurrency.worker",
        canonicalDigest: implementationDigest,
        createdAt: fixtureAt,
      });
      await pool.execute(
        `INSERT INTO capability_binding (
           id,
           workspace_id,
           binding_key,
           contract_revision_id,
           implementation_revision_id,
           lifecycle_status,
           priority,
           version,
           route_policy,
           created_at,
           updated_at
         ) VALUES (?, ?, 'foundation.reconciler-concurrency.worker', ?, ?,
           'active', 1, 1, ?, ?, ?)`,
        [
          ids.binding,
          ids.workspace,
          ids.contract,
          ids.implementation,
          JSON.stringify({ retryPolicy }),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workflow_revision (
           id,
           workspace_id,
           workflow_key,
           revision,
           lifecycle_status,
           canonical_digest,
           topology,
           input_schema,
           output_schema,
           created_at,
           published_at
         ) VALUES (?, ?, 'foundation.reconciler-concurrency', 1, 'published', ?, ?, ?, ?, ?, ?)`,
        [
          ids.workflowRevision,
          ids.workspace,
          digest("c"),
          JSON.stringify(topology),
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          fixtureAt,
          fixtureAt,
        ],
      );

      const executionPlan = JSON.stringify({
        schemaVersion: 1,
        topology,
        routes: [
          {
            nodeKey: "invoke",
            contractRevisionId: ids.contract,
            contractKey: "foundation.reconciler-concurrency",
            contractRevision: 1,
            contractDigest,
            candidates: [
              {
                candidateIndex: 0,
                idempotencyMode: "intrinsic",
                bindingId: ids.binding,
                bindingVersion: 1,
                implementationRevisionId: ids.implementation,
                implementationDigest,
                executionTarget: "worker",
                adapterKey: "test.reconciler-concurrency",
                retryPolicy,
                attemptTimeoutMs: 300_000,
                fallbackOn: [],
              },
            ],
          },
        ],
      });
      const routeSnapshot = (
        JSON.parse(executionPlan) as { readonly routes: readonly unknown[] }
      ).routes[0];
      const workflowDeadlineAt = new Date(
        fixtureAt.getTime() + topology.limits.timeoutMs,
      );

      await pool.execute(
        `INSERT INTO workflow_run (
           id,
           workspace_id,
           workflow_revision_id,
           idempotency_key,
           request_hash,
           lifecycle_status,
           outcome,
           input,
           execution_deadline_at,
           execution_plan_snapshot,
           execution_plan_hash,
           created_by,
           version,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'reconciler-wakeup-race', ?, 'queued', NULL, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          ids.wakeupWorkflow,
          ids.workspace,
          ids.workflowRevision,
          digest("d"),
          JSON.stringify({}),
          workflowDeadlineAt,
          executionPlan,
          digest("e"),
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
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
         ) VALUES (?, ?, ?, 'invoke', 'root', 'invoke', 'pending', 1, ?, ?)`,
        [
          ids.wakeupNode,
          ids.workspace,
          ids.wakeupWorkflow,
          fixtureAt,
          fixtureAt,
        ],
      );

      await pool.execute(
        `INSERT INTO workflow_run (
           id,
           workspace_id,
           workflow_revision_id,
           idempotency_key,
           request_hash,
           lifecycle_status,
           outcome,
           input,
           execution_deadline_at,
           execution_plan_snapshot,
           execution_plan_hash,
           created_by,
           version,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'reconciler-expired-attempt-race', ?, 'running', NULL, ?, ?, ?, ?, ?, 2, ?, ?)`,
        [
          ids.expiredWorkflow,
          ids.workspace,
          ids.workflowRevision,
          digest("f"),
          JSON.stringify({}),
          workflowDeadlineAt,
          executionPlan,
          digest("0"),
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
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
         ) VALUES (?, ?, ?, 'invoke', 'root', 'invoke', 'running', 2, ?, ?)`,
        [
          ids.expiredNode,
          ids.workspace,
          ids.expiredWorkflow,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO capability_run (
           id,
           workspace_id,
           node_run_id,
           invocation_kind,
           invocation_reference_id,
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
           version,
           created_at,
           updated_at
         ) VALUES (
           ?, ?, ?, 'workflow', ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?,
           'running', NULL, NULL, 2, ?, ?
         )`,
        [
          ids.expiredCapability,
          ids.workspace,
          ids.expiredNode,
          ids.expiredNode,
          ids.actor,
          digestProviderValue({}),
          JSON.stringify(routeSnapshot),
          digestProviderValue(routeSnapshot),
          workflowDeadlineAt,
          ids.contract,
          ids.binding,
          ids.implementation,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
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
           retry_disposition,
           not_before,
           lease_generation,
           lease_token_hash,
           lease_expires_at,
           execution_deadline_at,
           version,
           created_at,
           updated_at
         ) VALUES (
           ?, ?, ?, ?, 0, 1, 'initial', 'workflow.start.initial',
           1, 'worker', ?, 'running', 'not_started', NULL, ?,
           1, ?, ?, ?, 2, ?, ?
         )`,
        [
          ids.expiredAttempt,
          ids.workspace,
          ids.expiredCapability,
          ids.binding,
          ids.implementation,
          fixtureAt,
          leaseTokenHash,
          new Date(fixtureAt.getTime() + 30_000),
          new Date(fixtureAt.getTime() + 300_000),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `UPDATE capability_run
         SET current_attempt_id = ?
         WHERE id = ?`,
        [ids.expiredAttempt, ids.expiredCapability],
      );
    };

    beforeAll(async () => {
      const connection = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.user,
        password: connection.password,
        connectionLimit: 10,
        timezone: "Z",
        decimalNumbers: false,
      });
      const cleanupConnection = await pool.getConnection();
      try {
        await removeFixtures(cleanupConnection);
      } finally {
        cleanupConnection.release();
      }
      const [migrationRows] = await pool.query<
        (RowDataPacket & { count: number })[]
      >(
        `SELECT COUNT(*) AS count
         FROM kanvas_migration_history
         WHERE name = '0000_initial_schema.sql'`,
      );
      expect(migrationRows[0]?.count).toBe(1);
      await seedFoundation();
    }, 30_000);

    afterAll(async () => {
      if (pool) {
        const cleanupConnection = await pool.getConnection();
        try {
          await removeFixtures(cleanupConnection);
        } finally {
          cleanupConnection.release();
          await pool.end();
        }
      }
    });

    it("allows only one store to rebuild a missing workflow wakeup", async () => {
      const stores = [
        createWorkflowReconcilerStore(pool, {
          instanceId: runtimeInstanceId,
        }),
        createWorkflowReconcilerStore(pool, {
          instanceId: runtimeInstanceId,
        }),
      ] as const;
      const outboxEventIds = [ids.wakeupOutboxA, ids.wakeupOutboxB] as const;
      const results = await Promise.all([
        stores[0].reconcileWorkflowWakeup(ids.wakeupWorkflow, {
          now: reconcileAt,
          staleBefore,
          executionGeneration: 11,
          outboxEventId: outboxEventIds[0],
        }),
        stores[1].reconcileWorkflowWakeup(ids.wakeupWorkflow, {
          now: reconcileAt,
          staleBefore,
          executionGeneration: 11,
          outboxEventId: outboxEventIds[1],
        }),
      ]);

      expect(
        results.filter((result) => result === "workflow_wakeup_rebuilt"),
      ).toHaveLength(1);
      expect(results.filter((result) => result === "noop")).toHaveLength(1);

      const winningIndex = results[0] === "workflow_wakeup_rebuilt" ? 0 : 1;
      const [workflowRows] = await pool.query<WorkflowRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           version,
           updated_at AS updatedAt
         FROM workflow_run
         WHERE id = ?`,
        [ids.wakeupWorkflow],
      );
      expect(workflowRows).toEqual([
        expect.objectContaining({
          lifecycleStatus: "queued",
          version: 2,
          updatedAt: reconcileAt,
        }),
      ]);

      const [outboxRows] = await pool.query<OutboxRow[]>(
        `SELECT
           id,
           aggregate_id AS aggregateId,
           aggregate_version AS aggregateVersion,
           status,
           payload
         FROM outbox_event
         WHERE workspace_id = ?
           AND message_type = 'workflow.wakeup.requested'
           AND aggregate_id = ?`,
        [ids.workspace, ids.wakeupWorkflow],
      );
      expect(outboxRows).toEqual([
        expect.objectContaining({
          id: outboxEventIds[winningIndex],
          aggregateId: ids.wakeupWorkflow,
          aggregateVersion: 2,
          status: "pending",
        }),
      ]);

      await expect(
        createAtomicAttemptCompletionStore(pool, {
          instanceId: runtimeInstanceId,
        }).complete({
          workspaceId: ids.workspace,
          capabilityRunId: ids.expiredCapability,
          attemptId: ids.expiredAttempt,
          completionId: ids.lateCompletion,
          terminalOutboxEventId: ids.lateCompletionOutbox,
          executionGeneration: 11,
          target: {
            executionTarget: "worker",
            implementationRevisionId: ids.implementation,
            implementationDigest: digest("b"),
            adapterKey: "test.reconciler-concurrency",
            attemptLeaseGeneration: 1,
            domainLeaseTokenHash: leaseTokenHash,
          },
          capabilityOutput: {
            stale: true,
          },
          outputs: [],
          initialUsage: [],
          now: new Date(reconcileAt.getTime() + 1),
        }),
      ).rejects.toMatchObject({
        code: "attempt_completion.lease_rejected",
      });
      const [lateOutboxRows] = await pool.query<OutboxRow[]>(
        `SELECT
           id,
           aggregate_id AS aggregateId,
           aggregate_version AS aggregateVersion,
           status,
           payload
         FROM outbox_event
         WHERE id = ?`,
        [ids.lateCompletionOutbox],
      );
      expect(lateOutboxRows).toHaveLength(0);
    });

    it("allows only one store to recover the same expired attempt", async () => {
      const stores = [
        createWorkflowReconcilerStore(pool, {
          instanceId: runtimeInstanceId,
        }),
        createWorkflowReconcilerStore(pool, {
          instanceId: runtimeInstanceId,
        }),
      ] as const;
      const nextAttemptIds = [ids.retryAttemptA, ids.retryAttemptB] as const;
      const outboxEventIds = [ids.retryOutboxA, ids.retryOutboxB] as const;
      const results = await Promise.all([
        stores[0].reconcileExpiredAttempt(
          ids.expiredCapability,
          ids.expiredAttempt,
          {
            now: reconcileAt,
            staleBefore,
            executionGeneration: 11,
            outboxEventId: outboxEventIds[0],
            nextAttemptId: nextAttemptIds[0],
            browserAssignmentEventId: ids.retryAttemptB,
          },
        ),
        stores[1].reconcileExpiredAttempt(
          ids.expiredCapability,
          ids.expiredAttempt,
          {
            now: reconcileAt,
            staleBefore,
            executionGeneration: 11,
            outboxEventId: outboxEventIds[1],
            nextAttemptId: nextAttemptIds[1],
            browserAssignmentEventId: ids.retryAttemptA,
          },
        ),
      ]);

      expect(
        results.filter((result) => result === "attempt_retried"),
      ).toHaveLength(1);
      expect(results.filter((result) => result === "noop")).toHaveLength(1);

      const winningIndex = results[0] === "attempt_retried" ? 0 : 1;
      const winningAttemptId = nextAttemptIds[winningIndex];
      const [capabilityRows] = await pool.query<CapabilityRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           current_attempt_id AS currentAttemptId,
           accepted_attempt_id AS acceptedAttemptId,
           version
         FROM capability_run
         WHERE id = ?`,
        [ids.expiredCapability],
      );
      expect(capabilityRows).toEqual([
        expect.objectContaining({
          lifecycleStatus: "running",
          currentAttemptId: winningAttemptId,
          acceptedAttemptId: null,
          version: 3,
        }),
      ]);

      const [attemptRows] = await pool.query<AttemptRow[]>(
        `SELECT
           id,
           attempt_number AS attemptNumber,
           lifecycle_status AS lifecycleStatus,
           side_effect_state AS sideEffectState,
           retry_disposition AS retryDisposition,
           lease_token_hash AS leaseTokenHash,
           lease_expires_at AS leaseExpiresAt,
           version
         FROM capability_attempt
         WHERE capability_run_id = ?
         ORDER BY attempt_number`,
        [ids.expiredCapability],
      );
      expect(attemptRows).toEqual([
        expect.objectContaining({
          id: ids.expiredAttempt,
          attemptNumber: 1,
          lifecycleStatus: "abandoned",
          sideEffectState: "not_started",
          retryDisposition: "retryable",
          leaseTokenHash: null,
          leaseExpiresAt: null,
          version: 3,
        }),
        expect.objectContaining({
          id: winningAttemptId,
          attemptNumber: 2,
          lifecycleStatus: "created",
          sideEffectState: "not_started",
          retryDisposition: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          version: 1,
        }),
      ]);

      const [outboxRows] = await pool.query<OutboxRow[]>(
        `SELECT
           id,
           aggregate_id AS aggregateId,
           aggregate_version AS aggregateVersion,
           status,
           payload
         FROM outbox_event
         WHERE workspace_id = ?
           AND message_type = 'attempt.dispatch.requested'
           AND aggregate_id IN (?, ?)`,
        [ids.workspace, ids.retryAttemptA, ids.retryAttemptB],
      );
      expect(outboxRows).toEqual([
        expect.objectContaining({
          id: outboxEventIds[winningIndex],
          aggregateId: winningAttemptId,
          aggregateVersion: 1,
          status: "pending",
        }),
      ]);
      expect(parsePayload(outboxRows[0]?.payload)).toEqual(
        expect.objectContaining({
          workflowRunId: ids.expiredWorkflow,
          nodeRunId: ids.expiredNode,
          capabilityRunId: ids.expiredCapability,
          attemptId: winningAttemptId,
          executionTarget: "worker",
          expectedGeneration: 11,
        }),
      );
    });
  },
);
