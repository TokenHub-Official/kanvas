import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { createAtomicAttemptCompletionStore } from "../src/runtime/attempt-completion-store.js";
import { createWorkflowEngineStore } from "../src/runtime/workflow-engine-store.js";
import { createWorkflowExecutionPersistence } from "../src/runtime/workflow-execution-persistence.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const baseIds = Object.freeze({
  workspace: identity(1),
  actor: identity(2),
  contract: identity(3),
  implementation: identity(4),
  binding: identity(5),
  workflowRevision: identity(6),
  adapterDefinition: identity(7),
  adapterRevision: identity(8),
});
const leaseTokenHash = "a".repeat(64);
const runtimeInstanceId = "workflow-cancellation-integration";
const executionPlan = Object.freeze({
  schemaVersion: 1,
  topology: Object.freeze({
    schemaVersion: 1,
    key: "foundation_cancel_race",
    entryNodeKey: "invoke",
    limits: Object.freeze({ maxNodeRuns: 1, timeoutMs: 300_000 }),
    nodes: Object.freeze([
      Object.freeze({
        key: "invoke",
        kind: "invoke",
        capability: Object.freeze({
          contractId: "foundation.cancel-race",
          revision: 1,
          canonicalDigest: digest("1"),
        }),
        input: Object.freeze({}),
        next: Object.freeze([]),
      }),
    ]),
    outputs: Object.freeze({}),
  }),
  routes: Object.freeze([
    Object.freeze({
      nodeKey: "invoke",
      contractRevisionId: baseIds.contract,
      contractKey: "foundation.cancel-race",
      contractRevision: 1,
      contractDigest: digest("1"),
      candidates: Object.freeze([
        Object.freeze({
          candidateIndex: 0,
          idempotencyMode: "intrinsic",
          bindingId: baseIds.binding,
          bindingVersion: 1,
          implementationRevisionId: baseIds.implementation,
          implementationDigest: digest("2"),
          executionTarget: "worker",
          adapterKey: "test.cancel-race",
          retryPolicy: Object.freeze({
            maxAttempts: 1,
            backoff: "fixed",
            initialDelayMs: 0,
            maxDelayMs: 0,
          }),
          attemptTimeoutMs: 300_000,
          fallbackOn: Object.freeze([]),
        }),
      ]),
    }),
  ]),
});

interface Fixture {
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly startedAt: Date;
}

interface LifecycleRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly acceptedAttemptId: string | null;
  readonly cancelRequestedAt: Date | null;
}

describe.skipIf(!integrationEnabled)(
  "workflow cancellation against a real MySQL 8.0 database",
  () => {
    let pool: Pool;
    let outboxSequence = 900_000;

    const nextOutboxId = (): string => {
      outboxSequence += 1;
      return identity(outboxSequence);
    };

    const removeFixtures = async (
      connection: PoolConnection,
    ): Promise<void> => {
      if (!(await resetDisposableIntegrationDatabase(connection))) {
        throw new Error(
          "Workflow cancellation integration requires a runner-owned disposable database.",
        );
      }
    };

    const seedFoundation = async (): Promise<void> => {
      const now = new Date("2026-07-27T12:00:00.000Z");
      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (?, 'ACTIVE', 1, 1, 'integration_test', NULL,
                   'workflow-cancellation.integration', ?)`,
        [runtimeInstanceId, now],
      );
      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'cancel-race', 'Cancellation Race',
           'active', 1, ?, ?)`,
        [baseIds.workspace, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES (?, ?, 'cancel-race', 'Cancellation Race',
           'active', 1, ?, ?)`,
        [baseIds.workspace, baseIds.workspace, now, now],
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
         ) VALUES (?, ?, 'foundation.cancel-race', 1, 'published', ?, ?, ?, 'intrinsic', ?, ?, ?)`,
        [
          baseIds.contract,
          baseIds.workspace,
          digest("1"),
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          JSON.stringify(["workflow"]),
          now,
          now,
        ],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: baseIds.workspace,
        contractRevisionId: baseIds.contract,
        adapterDefinitionId: baseIds.adapterDefinition,
        adapterRevisionId: baseIds.adapterRevision,
        adapterKey: "test.cancel-race",
        executionTarget: "worker",
        implementationId: baseIds.implementation,
        implementationKey: "foundation.cancel-race.worker",
        canonicalDigest: digest("2"),
        createdAt: now,
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
         ) VALUES (?, ?, 'foundation.cancel-race.worker', ?, ?, 'active', 1, 1, ?, ?, ?)`,
        [
          baseIds.binding,
          baseIds.workspace,
          baseIds.contract,
          baseIds.implementation,
          JSON.stringify({}),
          now,
          now,
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
         ) VALUES (?, ?, 'foundation.cancel-race', 1, 'published', ?, ?, ?, ?, ?, ?)`,
        [
          baseIds.workflowRevision,
          baseIds.workspace,
          digest("3"),
          JSON.stringify(executionPlan.topology),
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          now,
          now,
        ],
      );
    };

    const createRunningFixture = async (seed: number): Promise<Fixture> => {
      const workflowRunId = identity(seed * 10);
      const nodeRunId = identity(seed * 10 + 1);
      const capabilityRunId = identity(seed * 10 + 2);
      const attemptId = identity(seed * 10 + 3);
      const startedAt = new Date(Date.UTC(2026, 6, 27, 13, 0, seed % 50));
      const leaseExpiresAt = new Date(startedAt.getTime() + 60_000);
      const executionDeadlineAt = new Date(startedAt.getTime() + 300_000);

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
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, ?, ?, ?, ?, 2, ?, ?, NULL)`,
        [
          workflowRunId,
          baseIds.workspace,
          baseIds.workflowRevision,
          `race-${String(seed)}`,
          digest("4"),
          JSON.stringify({ seed }),
          executionDeadlineAt,
          JSON.stringify(executionPlan),
          digest("5"),
          baseIds.actor,
          startedAt,
          startedAt,
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
           waiting_reason,
           version,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'invoke', 'root', 'invoke', 'running', NULL, 2, ?, ?)`,
        [nodeRunId, baseIds.workspace, workflowRunId, startedAt, startedAt],
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
           output,
           cancel_requested_at,
           cancel_deadline_at,
           version,
           created_at,
           updated_at
         ) VALUES (
           ?, ?, ?, 'workflow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'running', NULL, NULL, NULL, NULL, NULL, 2, ?, ?
         )`,
        [
          capabilityRunId,
          baseIds.workspace,
          nodeRunId,
          nodeRunId,
          baseIds.actor,
          JSON.stringify({ seed }),
          digestProviderValue({ seed }),
          JSON.stringify(executionPlan.routes[0]),
          digestProviderValue(executionPlan.routes[0]),
          executionDeadlineAt,
          baseIds.contract,
          baseIds.binding,
          baseIds.implementation,
          startedAt,
          startedAt,
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
           ?, ?, ?, ?, 0, 1, 'initial', 'integration.fixture',
           1, 'worker', ?, 'running', 'started', NULL, ?, 1, ?, ?, ?, 2, ?, ?
         )`,
        [
          attemptId,
          baseIds.workspace,
          capabilityRunId,
          baseIds.binding,
          baseIds.implementation,
          startedAt,
          leaseTokenHash,
          leaseExpiresAt,
          executionDeadlineAt,
          startedAt,
          startedAt,
        ],
      );
      await pool.execute(
        `UPDATE capability_run
         SET current_attempt_id = ?
         WHERE id = ?`,
        [attemptId, capabilityRunId],
      );

      return {
        workflowRunId,
        nodeRunId,
        capabilityRunId,
        attemptId,
        startedAt,
      };
    };

    const createQueuedFixture = async (
      seed: number,
    ): Promise<Pick<Fixture, "workflowRunId" | "nodeRunId" | "startedAt">> => {
      const workflowRunId = identity(seed * 10);
      const nodeRunId = identity(seed * 10 + 1);
      const startedAt = new Date("2026-07-27T15:00:00.000Z");
      const executionDeadlineAt = new Date(startedAt.getTime() + 300_000);
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
         ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          workflowRunId,
          baseIds.workspace,
          baseIds.workflowRevision,
          `queued-${String(seed)}`,
          digest("6"),
          JSON.stringify({}),
          executionDeadlineAt,
          JSON.stringify(executionPlan),
          digest("7"),
          baseIds.actor,
          startedAt,
          startedAt,
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
        [nodeRunId, baseIds.workspace, workflowRunId, startedAt, startedAt],
      );
      return { workflowRunId, nodeRunId, startedAt };
    };

    const persistence = (): ReturnType<
      typeof createWorkflowExecutionPersistence
    > => createWorkflowExecutionPersistence(pool);
    const engine = (): ReturnType<typeof createWorkflowEngineStore> =>
      createWorkflowEngineStore(pool);
    let completionSequence = 950_000;
    const nextCompletionId = (): string => {
      completionSequence += 1;
      return identity(completionSequence);
    };

    const requestCancellation = async (workflowRunId: string, now: Date) => {
      const repositories = persistence();
      return repositories.transactionManager.run((context) =>
        repositories.cancellations.request(
          {
            workspaceId: baseIds.workspace,
            workflowRunId,
            actorId: baseIds.actor,
            reasonCode: "user_requested",
            now,
            cancelDeadlineAt: new Date(now.getTime() + 30_000),
            outboxEventId: nextOutboxId(),
            executionGeneration: 1,
          },
          context,
        ),
      );
    };

    const complete = async (fixture: Fixture, now: Date): Promise<boolean> => {
      try {
        await createAtomicAttemptCompletionStore(pool, {
          instanceId: runtimeInstanceId,
        }).complete({
          workspaceId: baseIds.workspace,
          capabilityRunId: fixture.capabilityRunId,
          attemptId: fixture.attemptId,
          completionId: nextCompletionId(),
          terminalOutboxEventId: nextOutboxId(),
          executionGeneration: 1,
          target: {
            executionTarget: "worker",
            implementationRevisionId: baseIds.implementation,
            implementationDigest: digest("2"),
            adapterKey: "test.cancel-race",
            attemptLeaseGeneration: 1,
            domainLeaseTokenHash: leaseTokenHash,
          },
          capabilityOutput: { committed: true },
          outputs: [],
          initialUsage: [],
          now,
        });
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          [
            "attempt_completion.lease_rejected",
            "attempt_completion.state_conflict",
          ].includes(String(error.code))
        ) {
          return false;
        }
        throw error;
      }
    };

    const acknowledgeCancellation = async (
      fixture: Fixture,
      now: Date,
    ): Promise<boolean> =>
      engine().acknowledgeAttemptCancellation({
        capabilityRunId: fixture.capabilityRunId,
        attemptId: fixture.attemptId,
        leaseTokenHash,
        leaseGeneration: 1,
        now,
        outboxEventId: nextOutboxId(),
        executionGeneration: 1,
      });

    const readLifecycle = async (
      table:
        "workflow_run" | "node_run" | "capability_run" | "capability_attempt",
      recordId: string,
    ): Promise<LifecycleRow> => {
      const [rows] = await pool.query<LifecycleRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           ${
             table === "capability_run" ? "accepted_attempt_id" : "NULL"
           } AS acceptedAttemptId,
           ${
             table === "workflow_run" ||
             table === "capability_run" ||
             table === "capability_attempt"
               ? "cancel_requested_at"
               : "NULL"
           } AS cancelRequestedAt
         FROM ${table}
         WHERE id = ?`,
        [recordId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`Missing ${table} fixture ${recordId}.`);
      }
      return row;
    };

    beforeAll(async () => {
      const connection = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.user,
        password: connection.password,
        connectionLimit: 20,
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

    it("cancels a queued run without creating an execution attempt", async () => {
      const fixture = await createQueuedFixture(100);
      const requested = await requestCancellation(
        fixture.workflowRunId,
        fixture.startedAt,
      );
      expect(requested?.replayed).toBe(false);

      const settled = await engine().settleWorkflowCancellation({
        workflowRunId: fixture.workflowRunId,
        now: new Date(fixture.startedAt.getTime() + 1),
      });

      expect(settled).toBe(true);
      expect(
        (await readLifecycle("workflow_run", fixture.workflowRunId))
          .lifecycleStatus,
      ).toBe("cancelled");
      expect(
        (await readLifecycle("node_run", fixture.nodeRunId)).lifecycleStatus,
      ).toBe("cancelled");
    });

    it("makes a persisted cancellation intent defeat a late completion", async () => {
      const fixture = await createRunningFixture(110);
      const requestedAt = new Date(fixture.startedAt.getTime() + 100);
      expect(
        (await requestCancellation(fixture.workflowRunId, requestedAt))
          ?.replayed,
      ).toBe(false);
      expect(await complete(fixture, new Date(requestedAt.getTime() + 1))).toBe(
        false,
      );
      expect(
        await acknowledgeCancellation(
          fixture,
          new Date(requestedAt.getTime() + 2),
        ),
      ).toBe(true);
      expect(
        await engine().settleWorkflowCancellation({
          workflowRunId: fixture.workflowRunId,
          now: new Date(requestedAt.getTime() + 3),
        }),
      ).toBe(true);

      expect(
        (await readLifecycle("capability_run", fixture.capabilityRunId))
          .lifecycleStatus,
      ).toBe("cancelled");
      expect(
        (await readLifecycle("capability_attempt", fixture.attemptId))
          .lifecycleStatus,
      ).toBe("abandoned");
    });

    it("preserves a completion that commits before cancellation", async () => {
      const fixture = await createRunningFixture(120);
      const completedAt = new Date(fixture.startedAt.getTime() + 100);
      expect(await complete(fixture, completedAt)).toBe(true);
      expect(
        (
          await requestCancellation(
            fixture.workflowRunId,
            new Date(completedAt.getTime() + 1),
          )
        )?.replayed,
      ).toBe(false);
      expect(
        await engine().settleWorkflowCancellation({
          workflowRunId: fixture.workflowRunId,
          now: new Date(completedAt.getTime() + 2),
        }),
      ).toBe(true);

      const capability = await readLifecycle(
        "capability_run",
        fixture.capabilityRunId,
      );
      expect(capability.lifecycleStatus).toBe("completed");
      expect(capability.acceptedAttemptId).toBe(fixture.attemptId);
      expect(capability.cancelRequestedAt).toBeNull();
      expect(
        (await readLifecycle("workflow_run", fixture.workflowRunId))
          .lifecycleStatus,
      ).toBe("cancelled");
    });

    it("keeps the first cancellation facts on repeated requests", async () => {
      const fixture = await createQueuedFixture(130);
      const firstAt = new Date(fixture.startedAt.getTime() + 10);
      const first = await requestCancellation(fixture.workflowRunId, firstAt);
      const second = await requestCancellation(
        fixture.workflowRunId,
        new Date(firstAt.getTime() + 1_000),
      );

      expect(first?.replayed).toBe(false);
      expect(second?.replayed).toBe(true);
      expect(second?.run.cancelRequestedAt).toEqual(firstAt);
      const [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
        `SELECT COUNT(*) AS count
         FROM outbox_event
         WHERE aggregate_id = ?
           AND message_type = 'workflow.cancel.requested'`,
        [fixture.workflowRunId],
      );
      expect(rows[0]?.count).toBe(1);
    });

    it("serializes concurrent cancel/complete commits without mixed facts", async () => {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const fixture = await createRunningFixture(200 + iteration);
        const racedAt = new Date(fixture.startedAt.getTime() + 100);
        const [requested, completed] = await Promise.all([
          requestCancellation(fixture.workflowRunId, racedAt),
          complete(fixture, racedAt),
        ]);
        expect(requested).toBeDefined();

        if (!completed) {
          expect(
            await acknowledgeCancellation(
              fixture,
              new Date(racedAt.getTime() + 1),
            ),
          ).toBe(true);
        }
        expect(
          await engine().settleWorkflowCancellation({
            workflowRunId: fixture.workflowRunId,
            now: new Date(racedAt.getTime() + 2),
          }),
        ).toBe(true);

        const capability = await readLifecycle(
          "capability_run",
          fixture.capabilityRunId,
        );
        expect(["completed", "cancelled"]).toContain(
          capability.lifecycleStatus,
        );
        if (capability.lifecycleStatus === "completed") {
          expect(capability.acceptedAttemptId).toBe(fixture.attemptId);
          expect(capability.cancelRequestedAt).toBeNull();
        } else {
          expect(capability.acceptedAttemptId).toBeNull();
          expect(capability.cancelRequestedAt).not.toBeNull();
        }
        expect(
          (await readLifecycle("workflow_run", fixture.workflowRunId))
            .lifecycleStatus,
        ).toBe("cancelled");
      }
    });

    it("enforces cancellation fact constraints at the database boundary", async () => {
      const queued = await createQueuedFixture(300);
      await expect(
        pool.execute(
          `UPDATE workflow_run
           SET lifecycle_status = 'cancelling'
           WHERE id = ?`,
          [queued.workflowRunId],
        ),
      ).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });

      const running = await createRunningFixture(310);
      await expect(
        pool.execute(
          `UPDATE capability_attempt
           SET lifecycle_status = 'cancelled'
           WHERE id = ?`,
          [running.attemptId],
        ),
      ).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });
    });
  },
);
