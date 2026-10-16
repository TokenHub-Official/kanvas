import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import {
  createAtomicAttemptCompletionStore,
  type CompleteAttemptOptions,
  type InitialUsageEntry,
} from "../src/runtime/attempt-completion-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import {
  disposableIntegrationDatabase,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (character: string): string => character.repeat(64);

interface Fixture {
  readonly workspaceId: string;
  readonly otherWorkspaceId: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly implementationId: string;
  readonly uploadSessionId: string;
  readonly assignmentId?: string;
  readonly sessionId?: string;
  readonly options: CompleteAttemptOptions;
}

interface CompletionFactsRow extends RowDataPacket {
  readonly capabilityStatus: string;
  readonly acceptedAttemptId: string | null;
  readonly capabilityOutput: unknown;
  readonly attemptStatus: string;
  readonly sideEffectState: string;
  readonly completionManifestHash: string | null;
  readonly uploadState: string;
  readonly committedStoredObjectId: string | null;
  readonly nodeStatus: string;
  readonly workflowStatus: string;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

describe.skipIf(!integrationEnabled)(
  "Atomic Attempt Complete against real MySQL 8.0",
  () => {
    let pool!: Pool;
    let instanceId!: string;
    let executionGeneration!: number;
    const fixtureWorkspaces = new Set<string>();

    const removeFixtures = async (): Promise<void> => {
      if (!pool) {
        return;
      }
      if (disposableIntegrationDatabase) {
        const connection = await pool.getConnection();
        try {
          await resetDisposableIntegrationDatabase(connection);
        } finally {
          connection.release();
          fixtureWorkspaces.clear();
        }
        return;
      }
      if (fixtureWorkspaces.size === 0) {
        return;
      }
      const ids = [...fixtureWorkspaces];
      const placeholders = ids.map(() => "?").join(", ");
      const connection = await pool.getConnection();
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of [
          "usage_ledger_entry",
          "attempt_completion",
          "browser_attempt_assignment_event",
          "browser_attempt_assignment",
          "browser_executor_capability",
          "browser_executor_session",
          "provider_invocation_observation",
          "provider_invocation",
          "attempt_output",
          "artifact",
          "stored_object",
          "upload_session",
          "outbox_event",
          "capability_attempt",
          "capability_run",
          "node_run",
          "workflow_run",
          "capability_binding",
          "workflow_revision",
          "capability_implementation_revision",
          "runtime_adapter_revision",
          "runtime_adapter_definition",
          "capability_contract_revision",
        ]) {
          await connection.query(
            `DELETE FROM ${table} WHERE workspace_id IN (${placeholders})`,
            ids,
          );
        }
        await connection.query(
          `DELETE FROM workspace WHERE id IN (${placeholders})`,
          ids,
        );
        await connection.query(
          `DELETE FROM organization WHERE id IN (${placeholders})`,
          ids,
        );
      } finally {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        connection.release();
        fixtureWorkspaces.clear();
      }
    };

    beforeAll(async () => {
      const config = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectionLimit: 4,
        timezone: "Z",
        decimalNumbers: false,
      });
      const [migrationRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM kanvas_migration_history
         WHERE name = '0000_initial_schema.sql'`,
      );
      expect(Number(migrationRows[0]?.count ?? 0)).toBe(1);
      if (disposableIntegrationDatabase) {
        await removeFixtures();
        instanceId = "attempt-completion-integration-test";
        executionGeneration = 41;
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
           ) VALUES (
             ?, 'ACTIVE', ?, 1, 'integration_test', NULL,
             'attempt-completion-store.integration', ?
           )`,
          [
            instanceId,
            executionGeneration,
            new Date("2026-07-27T00:00:00.000Z"),
          ],
        );
      } else {
        const [runtimeRows] = await pool.query<
          (RowDataPacket & {
            readonly instanceId: string;
            readonly executionGeneration: number;
            readonly state: string;
          })[]
        >(
          `SELECT
             instance_id AS instanceId,
             execution_generation AS executionGeneration,
             state
           FROM instance_runtime_state
           ORDER BY instance_id
           LIMIT 1`,
        );
        const runtime = runtimeRows[0];
        expect(runtime?.state).toBe("ACTIVE");
        if (!runtime) {
          throw new Error("Integration database has no runtime fence fact.");
        }
        instanceId = runtime.instanceId;
        executionGeneration = runtime.executionGeneration;
        await removeFixtures();
      }
    }, 30_000);

    afterAll(async () => {
      if (pool) {
        await removeFixtures();
        await pool.end();
      }
    });

    const seedFixture = async (
      key: number,
      executionTarget: "worker" | "browser",
      fixtureNow: Date,
      overrides: {
        readonly leaseExpiresAt?: Date;
        readonly sessionExpiresAt?: Date;
        readonly uploadExpiresAt?: Date;
        readonly cancellationRequested?: boolean;
        readonly uploadWorkspaceMismatch?: boolean;
      } = {},
    ): Promise<Fixture> => {
      const base = 10_000_000 + key * 100;
      const workspaceId = identity(base + 1);
      const otherWorkspaceId = identity(base + 2);
      const principalId = identity(base + 3);
      const contractId = identity(base + 4);
      const implementationId = identity(base + 5);
      const adapterDefinitionId = identity(base + 20);
      const adapterRevisionId = identity(base + 21);
      const bindingId = identity(base + 6);
      const workflowRevisionId = identity(base + 7);
      const workflowRunId = identity(base + 8);
      const nodeRunId = identity(base + 9);
      const capabilityRunId = identity(base + 10);
      const attemptId = identity(base + 11);
      const uploadSessionId = identity(base + 12);
      const storedObjectId = identity(base + 13);
      const artifactId = identity(base + 14);
      const attemptOutputId = identity(base + 15);
      const completionId = identity(base + 16);
      const outboxId = identity(base + 17);
      const usageId = identity(base + 18);
      const storageProfileId = identity(base + 19);
      const sessionId =
        executionTarget === "browser" ? identity(base + 20) : undefined;
      const assignmentId =
        executionTarget === "browser" ? identity(base + 21) : undefined;
      const assignmentEventId =
        executionTarget === "browser" ? identity(base + 22) : undefined;
      fixtureWorkspaces.add(workspaceId);
      fixtureWorkspaces.add(otherWorkspaceId);

      const leaseExpiresAt =
        overrides.leaseExpiresAt ?? new Date(fixtureNow.getTime() + 60_000);
      const executionDeadlineAt = new Date(fixtureNow.getTime() + 120_000);
      const sessionExpiresAt =
        overrides.sessionExpiresAt ?? new Date(fixtureNow.getTime() + 180_000);
      const uploadExpiresAt =
        overrides.uploadExpiresAt ?? new Date(fixtureNow.getTime() + 240_000);
      const cleanupEligibleAt = new Date(uploadExpiresAt.getTime() + 60_000);
      const createdAt = new Date(fixtureNow.getTime() - 60_000);
      const cancelAt = overrides.cancellationRequested
        ? new Date(fixtureNow.getTime() - 1_000)
        : null;
      const cancelDeadline = overrides.cancellationRequested
        ? new Date(fixtureNow.getTime() + 30_000)
        : null;
      const adapterKey = `${executionTarget}.image`;
      const attemptGrantTokenHash = (key % 16).toString(16).repeat(64);
      const implementationDigest = digest(
        executionTarget === "worker" ? "1" : "2",
      );
      const plan = {
        schemaVersion: 1,
        topology: {
          schemaVersion: 1,
          key: "atomic_completion_integration",
          entryNodeKey: "main",
          limits: { maxNodeRuns: 1, timeoutMs: 120_000 },
          nodes: [
            {
              key: "main",
              kind: "invoke",
              capability: {
                contractId: "image.transform",
                revision: 1,
                canonicalDigest: digest("3"),
              },
              input: {},
              next: [],
            },
          ],
          outputs: {},
        },
        routes: [
          {
            nodeKey: "main",
            contractRevisionId: contractId,
            contractKey: "image.transform",
            contractRevision: 1,
            contractDigest: digest("3"),
            candidates: [
              {
                candidateIndex: 0,
                idempotencyMode: "keyed",
                bindingId,
                bindingVersion: 1,
                implementationRevisionId: implementationId,
                implementationDigest,
                adapterKey,
                executionTarget,
                retryPolicy: {
                  maxAttempts: 1,
                  backoff: "fixed",
                  initialDelayMs: 0,
                  maxDelayMs: 0,
                },
                attemptTimeoutMs: 120_000,
                fallbackOn: [],
              },
            ],
          },
        ],
      };
      const workflowDeadlineAt = new Date(createdAt.getTime() + 300_000);

      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES
          (?, ?, 'Atomic Complete', 'active', 1, ?, ?),
          (?, ?, 'Atomic Complete Other', 'active', 1, ?, ?)`,
        [
          workspaceId,
          `atomic-store-${String(key)}`,
          createdAt,
          createdAt,
          otherWorkspaceId,
          `atomic-store-other-${String(key)}`,
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES
          (?, ?, ?, 'Atomic Complete', 'active', 1, ?, ?),
          (?, ?, ?, 'Atomic Complete Other', 'active', 1, ?, ?)`,
        [
          workspaceId,
          workspaceId,
          `atomic-store-${String(key)}`,
          createdAt,
          createdAt,
          otherWorkspaceId,
          otherWorkspaceId,
          `atomic-store-other-${String(key)}`,
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `INSERT INTO capability_contract_revision
          (id, workspace_id, contract_key, revision, lifecycle_status,
           canonical_digest, input_schema, output_schema, idempotency_mode,
           supported_invokers, created_at, published_at)
         VALUES (?, ?, 'image.transform', 1, 'published', ?, '{}', '{}',
                 'keyed', '["workflow"]', ?, ?)`,
        [contractId, workspaceId, digest("3"), createdAt, createdAt],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId,
        contractRevisionId: contractId,
        adapterDefinitionId,
        adapterRevisionId,
        adapterKey,
        executionTarget,
        implementationId,
        implementationKey: `${executionTarget}.image`,
        canonicalDigest: implementationDigest,
        createdAt,
      });
      await pool.execute(
        `INSERT INTO capability_binding
          (id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status, priority, version,
           route_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, 1, '{}', ?, ?)`,
        [
          bindingId,
          workspaceId,
          `atomic-complete.${String(key)}`,
          contractId,
          implementationId,
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workflow_revision
          (id, workspace_id, workflow_key, revision, lifecycle_status,
           canonical_digest, topology, input_schema, output_schema,
           created_at, published_at)
         VALUES (?, ?, 'atomic-complete', 1, 'published', ?, ?, '{}', '{}',
                 ?, ?)`,
        [
          workflowRevisionId,
          workspaceId,
          digest("4"),
          asJson(plan.topology),
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workflow_run
          (id, workspace_id, workflow_revision_id, idempotency_key,
           request_hash, lifecycle_status, outcome, input,
           execution_deadline_at, execution_plan_snapshot,
           execution_plan_hash, created_by, version,
           created_at, updated_at, completed_at, cancel_requested_at,
           cancel_requested_by, cancel_reason_code, cancel_deadline_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?, ?, ?, ?, 1, ?, ?,
                 NULL, ?, ?, ?, ?)`,
        [
          workflowRunId,
          workspaceId,
          workflowRevisionId,
          `atomic-${String(key)}`,
          digest("5"),
          overrides.cancellationRequested ? "cancelling" : "running",
          workflowDeadlineAt,
          asJson(plan),
          digest("6"),
          principalId,
          createdAt,
          createdAt,
          cancelAt,
          overrides.cancellationRequested ? principalId : null,
          overrides.cancellationRequested ? "operator" : null,
          cancelDeadline,
        ],
      );
      await pool.execute(
        `INSERT INTO node_run
          (id, workspace_id, workflow_run_id, node_key, scope_key, kind,
           lifecycle_status, waiting_reason, input, output, error, version,
           created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'main', 'root', 'invoke', 'running', NULL, '{}',
                 NULL, NULL, 1, ?, ?, NULL)`,
        [nodeRunId, workspaceId, workflowRunId, createdAt, createdAt],
      );
      await pool.execute(
        `INSERT INTO capability_run
          (id, workspace_id, node_run_id, invocation_kind,
           invocation_reference_id, created_by, input, input_digest,
           route_snapshot, route_snapshot_hash, execution_deadline_at,
           contract_revision_id, binding_id,
           implementation_revision_id, lifecycle_status, current_attempt_id,
           accepted_attempt_id, output, cancel_requested_at,
           cancel_deadline_at, version, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'workflow', ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?,
                 'running', NULL, NULL, NULL, ?, ?, 1, ?, ?, NULL)`,
        [
          capabilityRunId,
          workspaceId,
          nodeRunId,
          nodeRunId,
          principalId,
          digestProviderValue({}),
          asJson(plan.routes[0]),
          digestProviderValue(plan.routes[0]),
          workflowDeadlineAt,
          contractId,
          bindingId,
          implementationId,
          cancelAt,
          cancelDeadline,
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `INSERT INTO capability_attempt
          (id, workspace_id, capability_run_id, binding_id,
           route_candidate_index, candidate_attempt_number, transition_kind,
           transition_reason_code, attempt_number,
           execution_target, implementation_revision_id, lifecycle_status,
           side_effect_state, retry_disposition, not_before, lease_generation,
           lease_token_hash, lease_expires_at, execution_deadline_at,
           cancel_requested_at, cancel_deadline_at, completion_manifest_hash,
           error, version, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, 0, 1, 'initial', 'test.initial', 1, ?, ?,
                 'running', ?, NULL, ?, 1, ?, ?, ?, ?, ?,
                 NULL, NULL, 1, ?, ?, NULL)`,
        [
          attemptId,
          workspaceId,
          capabilityRunId,
          bindingId,
          executionTarget,
          implementationId,
          executionTarget === "worker" ? "started" : "not_started",
          createdAt,
          hash("a"),
          leaseExpiresAt,
          executionDeadlineAt,
          cancelAt,
          cancelDeadline,
          createdAt,
          createdAt,
        ],
      );
      await pool.execute(
        `UPDATE capability_run
         SET current_attempt_id = ?
         WHERE id = ?`,
        [attemptId, capabilityRunId],
      );

      if (executionTarget === "browser" && sessionId && assignmentId) {
        await pool.execute(
          `INSERT INTO browser_executor_session
            (id, workspace_id, created_by_principal_id,
             authentication_ref_hash, authority_version, runtime_release_id,
             runtime_release_digest, capability_manifest_version,
             capability_manifest_digest, state, last_seen_at, expires_at,
             terminal_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, 'active', ?, ?, NULL, ?, ?)`,
          [
            sessionId,
            workspaceId,
            principalId,
            hash("b"),
            identity(base + 23),
            digest("7"),
            digest("8"),
            createdAt,
            sessionExpiresAt,
            createdAt,
            createdAt,
          ],
        );
        await pool.execute(
          `INSERT INTO browser_attempt_assignment
            (id, workspace_id, browser_executor_session_id,
             capability_attempt_id, attempt_lease_generation,
             execution_generation, attempt_grant_token_hash, state,
             stable_reason_code, claimed_at, last_heartbeat_at,
             lease_expires_at, terminal_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
          [
            assignmentId,
            workspaceId,
            sessionId,
            attemptId,
            executionGeneration,
            attemptGrantTokenHash,
            overrides.cancellationRequested ? "cancel_requested" : "active",
            createdAt,
            createdAt,
            leaseExpiresAt,
            createdAt,
            createdAt,
          ],
        );
      }

      const uploadWorkspaceId = overrides.uploadWorkspaceMismatch
        ? otherWorkspaceId
        : workspaceId;
      await pool.execute(
        `INSERT INTO upload_session
          (id, workspace_id, attempt_id, purpose, output_role, output_index,
           storage_profile_id, container, object_key, sealed_identity_hash,
           storage_version_id, provider_etag, upload_mode,
           write_protection_mode, state, version, expires_at,
           cleanup_eligible_at, cleanup_state, verified_size, verified_sha256,
           detected_media_type, verification_profile_version,
           committed_stored_object_id, created_at, updated_at, committed_at)
         VALUES (?, ?, ?, 'attempt_output', 'primary', 0, ?, 'atomic-test',
                 ?, ?, ?, ?, 'single', 'if-none-match', 'verified', 1, ?, ?,
                 'none', 128, ?, 'image/png', 'v1', NULL, ?, ?, NULL)`,
        [
          uploadSessionId,
          uploadWorkspaceId,
          attemptId,
          storageProfileId,
          `object-${String(key)}`,
          digest("0"),
          `storage-version-${String(key)}`,
          `etag-${String(key)}`,
          uploadExpiresAt,
          cleanupEligibleAt,
          hash("d"),
          createdAt,
          createdAt,
        ],
      );

      const usage: InitialUsageEntry = {
        id: usageId,
        entryKey: "duration.initial",
        metricKey: "duration_ms",
        valueDimension: "quantity",
        unitCode: "millisecond",
        numericValue: "12.5000",
        entryKind: "observation",
        sourceKind: "kanvas_measured",
        evidenceDigest: digest("9"),
        observedAt: fixtureNow,
      };
      const options: CompleteAttemptOptions = {
        workspaceId,
        capabilityRunId,
        attemptId,
        completionId,
        terminalOutboxEventId: outboxId,
        executionGeneration,
        target:
          executionTarget === "worker"
            ? {
                executionTarget: "worker",
                implementationRevisionId: implementationId,
                implementationDigest,
                adapterKey,
                attemptLeaseGeneration: 1,
                domainLeaseTokenHash: hash("a"),
              }
            : {
                executionTarget: "browser",
                implementationRevisionId: implementationId,
                implementationDigest,
                adapterKey,
                assignmentId: assignmentId!,
                sessionId: sessionId!,
                completedAssignmentEventId: assignmentEventId!,
                attemptLeaseGeneration: 1,
                attemptGrantTokenHash,
                domainLeaseTokenHash: hash("a"),
              },
        capabilityOutput: {
          artifactRole: "primary",
        },
        outputs: [
          {
            uploadSessionId,
            storedObjectId,
            artifactId,
            attemptOutputId,
            outputRole: "primary",
            outputIndex: 0,
            artifactType: "image",
            metadata: {
              width: 16,
              height: 16,
            },
          },
        ],
        initialUsage: [usage],
        now: fixtureNow,
      };
      return {
        workspaceId,
        otherWorkspaceId,
        workflowRunId,
        nodeRunId,
        capabilityRunId,
        attemptId,
        implementationId,
        uploadSessionId,
        ...(assignmentId ? { assignmentId } : {}),
        ...(sessionId ? { sessionId } : {}),
        options,
      };
    };

    const completionCounts = async (
      fixture: Fixture,
    ): Promise<Record<string, number>> => {
      const result: Record<string, number> = {};
      for (const table of [
        "stored_object",
        "artifact",
        "attempt_output",
        "attempt_completion",
        "usage_ledger_entry",
        "outbox_event",
      ]) {
        const [rows] = await pool.query<CountRow[]>(
          `SELECT COUNT(*) AS count
           FROM ${table}
           WHERE workspace_id = ?`,
          [fixture.workspaceId],
        );
        result[table] = Number(rows[0]?.count ?? 0);
      }
      return result;
    };

    const loadCompletionFacts = async (
      fixture: Fixture,
    ): Promise<CompletionFactsRow> => {
      const [rows] = await pool.query<CompletionFactsRow[]>(
        `SELECT
           capability.lifecycle_status AS capabilityStatus,
           capability.accepted_attempt_id AS acceptedAttemptId,
           capability.output AS capabilityOutput,
           attempt.lifecycle_status AS attemptStatus,
           attempt.side_effect_state AS sideEffectState,
           attempt.completion_manifest_hash AS completionManifestHash,
           upload.state AS uploadState,
           upload.committed_stored_object_id AS committedStoredObjectId,
           node.lifecycle_status AS nodeStatus,
           workflow.lifecycle_status AS workflowStatus
         FROM capability_run AS capability
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = capability.current_attempt_id
         INNER JOIN node_run AS node
           ON node.id = capability.node_run_id
         INNER JOIN workflow_run AS workflow
           ON workflow.id = node.workflow_run_id
         INNER JOIN upload_session AS upload
           ON upload.attempt_id = attempt.id
         WHERE capability.id = ?`,
        [fixture.capabilityRunId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error("Completion fixture disappeared.");
      }
      return row;
    };

    it("atomically completes Worker output/usage and replays the same manifest", async () => {
      const fixtureNow = new Date("2026-07-28T01:00:00.000Z");
      const fixture = await seedFixture(1, "worker", fixtureNow);
      const store = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });

      const completed = await store.complete(fixture.options);
      expect(completed.status).toBe("completed");
      expect(completed.manifestSchemaVersion).toBe(1);
      const facts = await loadCompletionFacts(fixture);
      expect(facts).toMatchObject({
        capabilityStatus: "completed",
        acceptedAttemptId: fixture.attemptId,
        attemptStatus: "completed",
        sideEffectState: "committed",
        uploadState: "committed",
        nodeStatus: "running",
        workflowStatus: "running",
      });
      expect(facts.committedStoredObjectId).toBe(
        fixture.options.outputs[0]?.storedObjectId,
      );
      expect(facts.completionManifestHash).toBe(
        completed.completionManifestHash,
      );
      const [storedRows] = await pool.query<RowDataPacket[]>(
        `SELECT
           storage_version_id AS storageVersionId,
           provider_etag AS providerEtag,
           immutable_identity_hash AS immutableIdentityHash
         FROM stored_object
         WHERE id = ?`,
        [fixture.options.outputs[0]?.storedObjectId],
      );
      expect(storedRows[0]).toMatchObject({
        storageVersionId: "storage-version-1",
        providerEtag: "etag-1",
        immutableIdentityHash: digest("0"),
      });
      const [completionRows] = await pool.query<RowDataPacket[]>(
        `SELECT manifest_schema_version AS manifestSchemaVersion
         FROM attempt_completion
         WHERE capability_attempt_id = ?`,
        [fixture.attemptId],
      );
      expect(completionRows[0]?.manifestSchemaVersion).toBe(1);
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 1,
        artifact: 1,
        attempt_output: 1,
        attempt_completion: 1,
        usage_ledger_entry: 1,
        outbox_event: 1,
      });

      const regeneratedStoredObjectId = identity(10_000_092);
      const regeneratedArtifactId = identity(10_000_093);
      const regeneratedAttemptOutputId = identity(10_000_094);
      const replay = await store.complete({
        ...fixture.options,
        completionId: identity(10_000_090),
        terminalOutboxEventId: identity(10_000_091),
        outputs: fixture.options.outputs.map((output) => ({
          ...output,
          storedObjectId: regeneratedStoredObjectId,
          artifactId: regeneratedArtifactId,
          attemptOutputId: regeneratedAttemptOutputId,
        })),
        initialUsage: fixture.options.initialUsage.map((entry) => ({
          ...entry,
          id: identity(10_000_095),
        })),
        now: new Date(fixtureNow.getTime() + 300_000),
      });
      expect(replay).toMatchObject({
        status: "replayed",
        completionId: fixture.options.completionId,
        manifestSchemaVersion: 1,
        terminalOutboxEventId: fixture.options.terminalOutboxEventId,
      });
      expect(replay.outputs).toEqual([
        {
          uploadSessionId: fixture.uploadSessionId,
          storedObjectId: fixture.options.outputs[0]?.storedObjectId,
          artifactId: fixture.options.outputs[0]?.artifactId,
          attemptOutputId: fixture.options.outputs[0]?.attemptOutputId,
          outputRole: "primary",
          outputIndex: 0,
        },
      ]);
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 1,
        artifact: 1,
        attempt_output: 1,
        attempt_completion: 1,
        usage_ledger_entry: 1,
        outbox_event: 1,
      });

      const committedStoredObjectId =
        fixture.options.outputs[0]?.storedObjectId;
      if (!committedStoredObjectId) {
        throw new Error("Worker fixture has no output identity.");
      }
      await pool.execute(
        `UPDATE stored_object
         SET immutable_identity_hash = NULL
         WHERE id = ?`,
        [committedStoredObjectId],
      );
      await expect(
        store.complete({
          ...fixture.options,
          now: new Date(fixtureNow.getTime() + 301_000),
        }),
      ).rejects.toMatchObject({
        code: "attempt_completion.asset_conflict",
      });
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 1,
        artifact: 1,
        attempt_output: 1,
        attempt_completion: 1,
        usage_ledger_entry: 1,
        outbox_event: 1,
      });
    });

    it("rejects a different Worker manifest without mutating committed facts", async () => {
      const fixtureNow = new Date("2026-07-28T02:00:00.000Z");
      const fixture = await seedFixture(2, "worker", fixtureNow);
      const store = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });
      await store.complete(fixture.options);

      await expect(
        store.complete({
          ...fixture.options,
          capabilityOutput: {
            artifactRole: "different",
          },
          now: new Date(fixtureNow.getTime() + 1_000),
        }),
      ).rejects.toMatchObject({
        code: "attempt_completion.manifest_conflict",
      });
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 1,
        artifact: 1,
        attempt_output: 1,
        attempt_completion: 1,
        usage_ledger_entry: 1,
        outbox_event: 1,
      });
    });

    it("completes a Worker capability with no output or initial Usage facts", async () => {
      const fixtureNow = new Date("2026-07-28T02:30:00.000Z");
      const fixture = await seedFixture(9, "worker", fixtureNow);
      await pool.execute("DELETE FROM upload_session WHERE id = ?", [
        fixture.uploadSessionId,
      ]);
      const store = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });

      const completed = await store.complete({
        ...fixture.options,
        capabilityOutput: {
          acknowledged: true,
        },
        outputs: [],
        initialUsage: [],
      });
      expect(completed).toMatchObject({
        status: "completed",
        outputs: [],
      });
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 0,
        artifact: 0,
        attempt_output: 0,
        attempt_completion: 1,
        usage_ledger_entry: 0,
        outbox_event: 1,
      });
    });

    it("atomically commits Browser Assignment, verified output, and Usage", async () => {
      const fixtureNow = new Date("2026-07-28T03:00:00.000Z");
      const fixture = await seedFixture(3, "browser", fixtureNow);
      const store = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });
      const result = await store.complete(fixture.options);
      expect(result.status).toBe("completed");

      const [assignmentRows] = await pool.query<RowDataPacket[]>(
        `SELECT state, terminal_at AS terminalAt
         FROM browser_attempt_assignment
         WHERE id = ?`,
        [fixture.assignmentId],
      );
      expect(assignmentRows[0]?.state).toBe("completed");
      expect(assignmentRows[0]?.terminalAt).toBeInstanceOf(Date);
      const [eventRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM browser_attempt_assignment_event
         WHERE browser_attempt_assignment_id = ?
           AND event_type = 'completed'`,
        [fixture.assignmentId],
      );
      expect(Number(eventRows[0]?.count ?? 0)).toBe(1);
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 1,
        artifact: 1,
        attempt_output: 1,
        attempt_completion: 1,
        usage_ledger_entry: 1,
        outbox_event: 1,
      });

      if (!fixture.sessionId) {
        throw new Error("Browser fixture has no session.");
      }
      await pool.execute(
        `UPDATE browser_executor_session
         SET state = 'revoked',
             terminal_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          new Date(fixtureNow.getTime() + 1_000),
          new Date(fixtureNow.getTime() + 1_000),
          fixture.sessionId,
        ],
      );
      await pool.execute(
        `UPDATE capability_implementation_revision
         SET lifecycle_status = 'revoked'
         WHERE id = ?`,
        [fixture.implementationId],
      );
      const replay = await store.complete({
        ...fixture.options,
        completionId: identity(10_000_390),
        terminalOutboxEventId: identity(10_000_391),
        outputs: fixture.options.outputs.map((output) => ({
          ...output,
          storedObjectId: identity(10_000_392),
          artifactId: identity(10_000_393),
          attemptOutputId: identity(10_000_394),
        })),
        initialUsage: fixture.options.initialUsage.map((entry) => ({
          ...entry,
          id: identity(10_000_395),
        })),
        now: new Date(fixtureNow.getTime() + 2_000),
      });
      expect(replay.status).toBe("replayed");
      expect(replay.outputs[0]).toMatchObject({
        storedObjectId: fixture.options.outputs[0]?.storedObjectId,
        artifactId: fixture.options.outputs[0]?.artifactId,
        attemptOutputId: fixture.options.outputs[0]?.attemptOutputId,
      });
    });

    it.each([
      ["attempt lease", "leaseExpiresAt"],
      ["session", "sessionExpiresAt"],
      ["upload", "uploadExpiresAt"],
    ] as const)(
      "treats an exactly expired Browser %s as invalid and rolls back",
      async (_label, field) => {
        const keys = {
          leaseExpiresAt: 4,
          sessionExpiresAt: 5,
          uploadExpiresAt: 6,
        } as const;
        const key = keys[field];
        const fixtureNow = new Date(`2026-07-28T0${String(key)}:00:00.000Z`);
        const fixture = await seedFixture(key, "browser", fixtureNow, {
          [field]: fixtureNow,
        });
        const store = createAtomicAttemptCompletionStore(pool, {
          instanceId,
        });

        await expect(store.complete(fixture.options)).rejects.toMatchObject({
          code:
            field === "uploadExpiresAt"
              ? "attempt_completion.asset_conflict"
              : "attempt_completion.lease_rejected",
        });
        expect(await completionCounts(fixture)).toEqual({
          stored_object: 0,
          artifact: 0,
          attempt_output: 0,
          attempt_completion: 0,
          usage_ledger_entry: 0,
          outbox_event: 0,
        });
        const facts = await loadCompletionFacts(fixture);
        expect(facts).toMatchObject({
          capabilityStatus: "running",
          attemptStatus: "running",
          uploadState: "verified",
        });
      },
    );

    it("lets cancellation win Browser Complete and preserves every pre-completion fact", async () => {
      const fixtureNow = new Date("2026-07-28T07:00:00.000Z");
      const fixture = await seedFixture(7, "browser", fixtureNow, {
        cancellationRequested: true,
      });
      const store = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });

      await expect(store.complete(fixture.options)).rejects.toMatchObject({
        code: "attempt_completion.state_conflict",
      });
      expect(await completionCounts(fixture)).toEqual({
        stored_object: 0,
        artifact: 0,
        attempt_output: 0,
        attempt_completion: 0,
        usage_ledger_entry: 0,
        outbox_event: 0,
      });
      const [assignmentRows] = await pool.query<RowDataPacket[]>(
        `SELECT state
         FROM browser_attempt_assignment
         WHERE id = ?`,
        [fixture.assignmentId],
      );
      expect(assignmentRows[0]?.state).toBe("cancel_requested");
    });

    it("rejects a cross-workspace UploadSession before Atomic Complete can observe it", async () => {
      const fixtureNow = new Date("2026-07-28T08:00:00.000Z");
      await expect(
        seedFixture(8, "browser", fixtureNow, {
          uploadWorkspaceMismatch: true,
        }),
      ).rejects.toMatchObject({
        code: "ER_NO_REFERENCED_ROW_2",
      });
      const [uploadRows] = await pool.query<RowDataPacket[]>(
        `SELECT state, committed_stored_object_id AS committedStoredObjectId
         FROM upload_session
         WHERE id = ?`,
        [identity(10_000_000 + 8 * 100 + 12)],
      );
      expect(uploadRows).toHaveLength(0);
    });
  },
);
