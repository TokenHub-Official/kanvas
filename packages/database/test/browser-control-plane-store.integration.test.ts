import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compileCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { DatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  createBrowserControlPlaneStore,
  type BrowserControlPlaneStore,
  type BrowserHumanAuthorityFacts,
  type ClaimNextBrowserAttemptOptions,
  type HeartbeatBrowserAttemptOptions,
} from "../src/runtime/browser-control-plane-store.js";
import { createWorkflowExecutionPersistence } from "../src/runtime/workflow-execution-persistence.js";
import { createWorkflowReconcilerStore } from "../src/runtime/workflow-reconciler-store.js";
import { createStorageUploadStore } from "../src/runtime/storage-upload-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_INTEGRATION === "1" ||
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const disposableIntegration =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";

function disposableDatabaseName(): string {
  const name = `kanvas_browser_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const digest = (value: string): string => `sha256:${hash(value)}`;

const fixtureAt = new Date("2026-07-27T22:00:00.000Z");
const claimAt = new Date("2026-07-27T22:01:00.000Z");
const initialLeaseUntil = new Date("2026-07-27T22:05:00.000Z");
const executionDeadlineAt = new Date("2026-07-27T22:30:00.000Z");
const sessionExpiresAt = new Date("2026-07-27T23:00:00.000Z");
const implementationDigest = digest("browser-control-implementation");
const adapterKey = "browser.remove-background";
const runtimeInstanceId = "browser-control-plane-test";
const emptyObjectSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({}),
});
const inputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1" as const,
  direction: "input" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "input" as const,
    pointer: "",
  }),
});
const outputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1" as const,
  direction: "output" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "result" as const,
    pointer: "",
  }),
});
const compiledInputMapping = compileCapabilityMappingPlanV1({
  document: inputMapping,
  sourceSchemas: {
    input: emptyObjectSchema,
    configuration: emptyObjectSchema,
  },
  targetSchema: emptyObjectSchema,
});
const compiledOutputMapping = compileCapabilityMappingPlanV1({
  document: outputMapping,
  sourceSchemas: {
    result: emptyObjectSchema,
    configuration: emptyObjectSchema,
  },
  targetSchema: emptyObjectSchema,
});

const ids = Object.freeze({
  workspace: identity(7_600_001),
  principal: identity(7_600_002),
  contract: identity(7_600_003),
  implementation: identity(7_600_004),
  binding: identity(7_600_005),
  workflowRevision: identity(7_600_006),
  runtimeRelease: identity(7_600_007),
  sessionA: identity(7_600_008),
  sessionB: identity(7_600_009),
  executorCapabilityA: identity(7_600_010),
  executorCapabilityB: identity(7_600_011),
  mismatchedSession: identity(7_600_012),
  mismatchedExecutorCapability: identity(7_600_013),
  runtimeAdapterDefinition: identity(7_600_014),
  runtimeAdapterRevision: identity(7_600_015),

  workflowA: identity(7_610_001),
  nodeA: identity(7_610_002),
  capabilityRunA: identity(7_610_003),
  attemptA: identity(7_610_004),

  workflowB: identity(7_620_001),
  nodeB: identity(7_620_002),
  capabilityRunB: identity(7_620_003),
  attemptB: identity(7_620_004),

  workflowC: identity(7_630_001),
  nodeC: identity(7_630_002),
  capabilityRunC: identity(7_630_003),
  attemptC: identity(7_630_004),

  cancellationOutbox: identity(7_650_001),
  reconciliationOutbox: identity(7_650_002),
  reconciliationReplayOutbox: identity(7_650_003),
  reconciliationNextAttempt: identity(7_650_004),
  reconciliationReplayNextAttempt: identity(7_650_005),
  reconciliationAssignmentEvent: identity(7_650_006),
  reconciliationReplayAssignmentEvent: identity(7_650_007),
  storageProfile: identity(7_660_001),
  storageProbe: identity(7_660_002),
  outputUpload: identity(7_660_003),
});

const authority: BrowserHumanAuthorityFacts = Object.freeze({
  workspaceId: ids.workspace,
  createdByPrincipalId: ids.principal,
  authenticationRefHash: hash("browser-control-human-authority"),
  authorityVersion: 3,
});

interface AttemptFixture {
  readonly key: string;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
}

const fixtures: readonly AttemptFixture[] = Object.freeze([
  Object.freeze({
    key: "a",
    workflowRunId: ids.workflowA,
    nodeRunId: ids.nodeA,
    capabilityRunId: ids.capabilityRunA,
    attemptId: ids.attemptA,
  }),
  Object.freeze({
    key: "b",
    workflowRunId: ids.workflowB,
    nodeRunId: ids.nodeB,
    capabilityRunId: ids.capabilityRunB,
    attemptId: ids.attemptB,
  }),
  Object.freeze({
    key: "c",
    workflowRunId: ids.workflowC,
    nodeRunId: ids.nodeC,
    capabilityRunId: ids.capabilityRunC,
    attemptId: ids.attemptC,
  }),
]);

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface SessionFactRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly state: string;
  readonly runtimeReleaseDigest: string;
  readonly capabilityManifestDigest: string;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly terminalAt: Date | null;
  readonly updatedAt: Date;
}

interface ExecutorCapabilityFactRow extends RowDataPacket {
  readonly id: string;
  readonly browserExecutorSessionId: string;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly backend: string;
  readonly probeProfileVersion: number;
  readonly probeResultDigest: string;
}

interface AttemptFactRow extends RowDataPacket {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly sideEffectState: string;
  readonly retryDisposition: string | null;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly executionDeadlineAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelDeadlineAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

interface CapabilityRunFactRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly currentAttemptId: string | null;
  readonly acceptedAttemptId: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

interface WorkflowRunFactRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly cancelRequestedAt: Date | null;
  readonly version: number;
}

interface ImplementationFactRow extends RowDataPacket {
  readonly lifecycleStatus: string;
}

interface AssignmentFactRow extends RowDataPacket {
  readonly id: string;
  readonly browserExecutorSessionId: string;
  readonly capabilityAttemptId: string;
  readonly attemptLeaseGeneration: number;
  readonly executionGeneration: number;
  readonly attemptGrantTokenHash: string;
  readonly state: string;
  readonly stableReasonCode: string | null;
  readonly lastHeartbeatAt: Date;
  readonly leaseExpiresAt: Date;
  readonly terminalAt: Date | null;
  readonly updatedAt: Date;
}

function executionPlan(nodeKey: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    topology: Object.freeze({
      schemaVersion: 1,
      key: "browser_control_integration",
      entryNodeKey: nodeKey,
      limits: Object.freeze({ maxNodeRuns: 1, timeoutMs: 300_000 }),
      nodes: Object.freeze([
        Object.freeze({
          key: nodeKey,
          kind: "invoke",
          capability: Object.freeze({
            contractId: "image.remove-background",
            revision: 1,
            canonicalDigest: digest("browser-control-contract"),
          }),
          input: Object.freeze({}),
          next: Object.freeze([]),
        }),
      ]),
      outputs: Object.freeze({}),
    }),
    routes: Object.freeze([
      Object.freeze({
        nodeKey,
        contractRevisionId: ids.contract,
        contractKey: "image.remove-background",
        contractRevision: 1,
        contractDigest: digest("browser-control-contract"),
        candidates: Object.freeze([
          Object.freeze({
            candidateIndex: 0,
            idempotencyMode: "keyed",
            bindingId: ids.binding,
            bindingVersion: 1,
            implementationRevisionId: ids.implementation,
            implementationDigest,
            executionTarget: "browser",
            adapterKey,
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
}

function assignmentId(serial: number): string {
  return identity(7_640_000 + serial * 10 + 1);
}

function claimedEventId(serial: number): string {
  return identity(7_640_000 + serial * 10 + 2);
}

function transitionEventId(serial: number): string {
  return identity(7_640_000 + serial * 10 + 3);
}

function claimOptions(
  sessionId: string,
  serial: number,
  overrides: Partial<ClaimNextBrowserAttemptOptions> = {},
): ClaimNextBrowserAttemptOptions {
  return {
    sessionId,
    authority,
    assignmentId: assignmentId(serial),
    claimedEventId: claimedEventId(serial),
    attemptGrantTokenHash: hash(`attempt-grant-${String(serial)}`),
    domainLeaseTokenHash: hash(`domain-lease-${String(serial)}`),
    executionGeneration: 17,
    candidateLimit: 20,
    now: claimAt,
    leaseUntil: initialLeaseUntil,
    ...overrides,
  };
}

function heartbeatOptions(
  claim: ClaimNextBrowserAttemptOptions,
  leaseGeneration: number,
  serial: number,
  overrides: Partial<HeartbeatBrowserAttemptOptions> = {},
): HeartbeatBrowserAttemptOptions {
  return {
    workspaceId: authority.workspaceId,
    sessionId: claim.sessionId,
    assignmentId: claim.assignmentId,
    attemptId: ids.attemptA,
    attemptGrantTokenHash: claim.attemptGrantTokenHash,
    domainLeaseTokenHash: claim.domainLeaseTokenHash,
    attemptLeaseGeneration: leaseGeneration,
    executionGeneration: claim.executionGeneration,
    transitionEventId: transitionEventId(serial),
    now: new Date("2026-07-27T22:02:00.000Z"),
    leaseUntil: new Date("2026-07-27T22:08:00.000Z"),
    ...overrides,
  };
}

async function withTimeout<TResult>(
  operation: Promise<TResult>,
  label: string,
  timeoutMs = 8_000,
): Promise<TResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} exceeded ${String(timeoutMs)}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function mysqlErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

async function waitUntilCapabilityIsWriteLocked(
  pool: Pool,
  capabilityRunId: string,
  racedOperation: Promise<unknown>,
  timeoutMs = 5_000,
): Promise<void> {
  let racedOperationSettled = false;
  void racedOperation.then(
    () => {
      racedOperationSettled = true;
    },
    () => {
      racedOperationSettled = true;
    },
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (racedOperationSettled) {
      throw new Error(
        "The raced operation settled before holding the capability row lock.",
      );
    }
    const probe = await pool.getConnection();
    let writeLockObserved = false;
    try {
      await probe.beginTransaction();
      try {
        await probe.execute(
          `SELECT id
           FROM capability_run
           WHERE id = ?
           LIMIT 1
           FOR UPDATE NOWAIT`,
          [capabilityRunId],
        );
      } catch (error) {
        if (mysqlErrorCode(error) === "ER_LOCK_NOWAIT") {
          writeLockObserved = true;
        } else {
          throw error;
        }
      }
    } finally {
      await probe.rollback();
      probe.release();
    }
    if (writeLockObserved) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  throw new Error("Timed out while observing the capability row write lock.");
}

describe.skipIf(!integrationEnabled)(
  "BrowserControlPlaneStore against a real MySQL 8.0 database",
  () => {
    let pool!: Pool;
    let adminPool: Pool | undefined;
    let disposableDatabase: string | undefined;
    let store!: BrowserControlPlaneStore;

    const removeFixtures = async (
      connection: PoolConnection,
    ): Promise<void> => {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        const fixtureTables = [
          "outbox_event",
          "upload_session",
          "storage_compatibility_probe",
          "browser_attempt_assignment_event",
          "browser_attempt_assignment",
          "browser_executor_capability",
          "browser_executor_session",
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
        ];
        if (disposableIntegration) {
          for (const table of [
            ...fixtureTables,
            "workspace",
            "organization",
            "instance_runtime_state",
          ]) {
            // The database exists only for this suite. TRUNCATE bypasses
            // production immutability triggers without weakening them in the
            // migrated schema used by the assertions.
            await connection.query(`TRUNCATE TABLE ${table}`);
          }
          return;
        }
        for (const table of fixtureTables) {
          await connection.query(
            `DELETE FROM ${table} WHERE workspace_id = ?`,
            [ids.workspace],
          );
        }
        await connection.query("DELETE FROM workspace WHERE id = ?", [
          ids.workspace,
        ]);
        await connection.query("DELETE FROM organization WHERE id = ?", [
          ids.workspace,
        ]);
        await connection.query(
          "DELETE FROM instance_runtime_state WHERE instance_id = ?",
          [runtimeInstanceId],
        );
      } finally {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    };

    const seedAttempt = async (
      fixture: AttemptFixture,
      notBefore: Date,
    ): Promise<void> => {
      const nodeKey = `remove_background_${fixture.key}`;
      const input = { sourceAssetId: `source-${fixture.key}` };
      const plan = executionPlan(nodeKey);
      const routeSnapshot = (plan.routes as readonly unknown[])[0];
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
         ) VALUES (
           ?, ?, ?, ?, ?, 'running', NULL, ?, ?, ?, ?, ?, 1, ?, ?, NULL
         )`,
        [
          fixture.workflowRunId,
          ids.workspace,
          ids.workflowRevision,
          `browser-control-${fixture.key}`,
          digest(`request-${fixture.key}`),
          JSON.stringify(input),
          executionDeadlineAt,
          JSON.stringify(plan),
          digest(`plan-${fixture.key}`),
          ids.principal,
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
           waiting_reason,
           input,
           output,
           error,
           version,
           created_at,
           updated_at,
           completed_at
         ) VALUES (
           ?, ?, ?, ?, 'root', 'invoke', 'running', NULL, ?, NULL, NULL,
           1, ?, ?, NULL
         )`,
        [
          fixture.nodeRunId,
          ids.workspace,
          fixture.workflowRunId,
          nodeKey,
          JSON.stringify({ assetId: `asset-${fixture.key}` }),
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
           output,
           version,
           created_at,
           updated_at,
           completed_at
         ) VALUES (
           ?, ?, ?, 'workflow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'queued', NULL, NULL, NULL, 1, ?, ?, NULL
         )`,
        [
          fixture.capabilityRunId,
          ids.workspace,
          fixture.nodeRunId,
          fixture.nodeRunId,
          ids.principal,
          JSON.stringify(input),
          digestProviderValue(input),
          JSON.stringify(routeSnapshot),
          digestProviderValue(routeSnapshot),
          executionDeadlineAt,
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
           completion_manifest_hash,
           error,
           version,
           created_at,
           updated_at,
           completed_at
         ) VALUES (
           ?, ?, ?, ?, 0, 1, 'initial', 'fixture.initial',
           1, 'browser', ?, 'created', 'not_started', NULL, ?, 0,
           NULL, NULL, ?, NULL, NULL, 1, ?, ?, NULL
         )`,
        [
          fixture.attemptId,
          ids.workspace,
          fixture.capabilityRunId,
          ids.binding,
          ids.implementation,
          notBefore,
          executionDeadlineAt,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `UPDATE capability_run
         SET current_attempt_id = ?
         WHERE id = ?`,
        [fixture.attemptId, fixture.capabilityRunId],
      );
    };

    const seedFoundation = async (): Promise<void> => {
      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'browser-control-plane', 'Browser Control Plane',
           'active', 1, ?, ?)`,
        [ids.workspace, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES (?, ?, 'browser-control-plane', 'Browser Control Plane',
           'active', 1, ?, ?)`,
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
         ) VALUES (?, 'ACTIVE', 17, 1, 'integration_test', NULL,
           'browser-control-plane.integration', ?)`,
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
         ) VALUES (
           ?, ?, 'image.remove-background', 1, 'published', ?, ?, ?,
           'keyed', ?, ?, ?
         )`,
        [
          ids.contract,
          ids.workspace,
          digest("browser-control-contract"),
          JSON.stringify(emptyObjectSchema),
          JSON.stringify(emptyObjectSchema),
          JSON.stringify(["workflow"]),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO runtime_adapter_definition (
           id, workspace_id, adapter_key, lifecycle_status,
           current_revision_id, version, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
        [
          ids.runtimeAdapterDefinition,
          ids.workspace,
          adapterKey,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO runtime_adapter_revision (
           id, workspace_id, runtime_adapter_definition_id, revision,
           lifecycle_status, execution_target, canonical_digest, document,
           created_at, published_at
         ) VALUES (?, ?, ?, 1, 'published', 'browser', ?, ?, ?, ?)`,
        [
          ids.runtimeAdapterRevision,
          ids.workspace,
          ids.runtimeAdapterDefinition,
          digest("browser-control-runtime-adapter"),
          JSON.stringify({
            schemaVersion: "kanvas.runtime-adapter-definition/v1",
            adapterKey,
          }),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `UPDATE runtime_adapter_definition
         SET current_revision_id = ?
         WHERE workspace_id = ? AND id = ?`,
        [
          ids.runtimeAdapterRevision,
          ids.workspace,
          ids.runtimeAdapterDefinition,
        ],
      );
      await pool.execute(
        `INSERT INTO capability_implementation_revision (
           id,
           workspace_id,
           implementation_key,
           display_name,
           description,
           revision,
           lifecycle_status,
           contract_revision_id,
           runtime_adapter_revision_id,
           execution_target,
           adapter_key,
           source_kind,
           source_reference,
           canonical_digest,
           publication_request_key,
           publication_request_hash,
           configuration,
           input_mapping,
           input_mapping_digest,
           compiled_input_mapping,
           output_mapping,
           output_mapping_digest,
           compiled_output_mapping,
           fixture_suite,
           created_at,
           published_at
         ) VALUES (
           ?, ?, 'image.remove-background.browser', ?, NULL, 1, 'published',
           ?, ?, 'browser', ?, 'plugin',
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?
         )`,
        [
          ids.implementation,
          ids.workspace,
          JSON.stringify({
            defaultLocale: "en-US",
            values: { "en-US": "Browser background removal" },
          }),
          ids.contract,
          ids.runtimeAdapterRevision,
          adapterKey,
          JSON.stringify({ kind: "plugin" }),
          implementationDigest,
          "browser-control-plane.integration",
          digest("browser-control-publication-request"),
          JSON.stringify({}),
          JSON.stringify(inputMapping),
          digestProviderValue(compiledInputMapping),
          JSON.stringify(compiledInputMapping),
          JSON.stringify(outputMapping),
          digestProviderValue(compiledOutputMapping),
          JSON.stringify(compiledOutputMapping),
          JSON.stringify([]),
          fixtureAt,
          fixtureAt,
        ],
      );
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
           route_policy_revision_id,
           created_at,
           updated_at
         ) VALUES (?, ?, 'image.remove-background.browser', ?, ?, 'active', 1, 1, ?, NULL, ?, ?)`,
        [
          ids.binding,
          ids.workspace,
          ids.contract,
          ids.implementation,
          JSON.stringify({}),
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
         ) VALUES (
           ?, ?, 'browser-control-plane', 1, 'published', ?, ?, ?, ?, ?, ?
         )`,
        [
          ids.workflowRevision,
          ids.workspace,
          digest("browser-control-workflow"),
          JSON.stringify({ nodes: [] }),
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          fixtureAt,
          fixtureAt,
        ],
      );

      for (const [index, fixture] of fixtures.entries()) {
        await seedAttempt(
          fixture,
          new Date(fixtureAt.getTime() + index * 1_000),
        );
      }
    };

    const registerSession = async (
      sessionId: string,
      executorCapabilityId: string,
    ): Promise<void> => {
      await store.registerExecutorSession({
        sessionId,
        authority,
        runtimeReleaseId: ids.runtimeRelease,
        runtimeReleaseDigest: digest("browser-runtime-release"),
        capabilityManifestVersion: 5,
        capabilityManifestDigest: digest(`browser-manifest-${sessionId}`),
        capabilities: [
          {
            id: executorCapabilityId,
            implementationRevisionId: ids.implementation,
            implementationDigest,
            adapterKey,
            backend: "webgpu",
            probeProfileVersion: 2,
            probeResultDigest: digest(`browser-probe-${sessionId}`),
          },
        ],
        now: fixtureAt,
        expiresAt: sessionExpiresAt,
      });
    };

    const count = async (
      table: string,
      predicate = "workspace_id = ?",
      parameters: readonly unknown[] = [ids.workspace],
    ): Promise<number> => {
      const [rows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${predicate}`,
        [...parameters],
      );
      return Number(rows[0]?.count ?? 0);
    };

    const readAttempt = async (attemptId: string): Promise<AttemptFactRow> => {
      const [rows] = await pool.query<AttemptFactRow[]>(
        `SELECT
           id,
           lifecycle_status AS lifecycleStatus,
           side_effect_state AS sideEffectState,
           retry_disposition AS retryDisposition,
           lease_generation AS leaseGeneration,
           lease_token_hash AS leaseTokenHash,
           lease_expires_at AS leaseExpiresAt,
           execution_deadline_at AS executionDeadlineAt,
           cancel_requested_at AS cancelRequestedAt,
           cancel_deadline_at AS cancelDeadlineAt,
           version,
           updated_at AS updatedAt
         FROM capability_attempt
         WHERE id = ?`,
        [attemptId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`Missing attempt fixture ${attemptId}.`);
      }
      return row;
    };

    const readCapability = async (
      capabilityRunId: string,
    ): Promise<CapabilityRunFactRow> => {
      const [rows] = await pool.query<CapabilityRunFactRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           current_attempt_id AS currentAttemptId,
           accepted_attempt_id AS acceptedAttemptId,
           cancel_requested_at AS cancelRequestedAt,
           version,
           updated_at AS updatedAt
         FROM capability_run
         WHERE id = ?`,
        [capabilityRunId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`Missing capability fixture ${capabilityRunId}.`);
      }
      return row;
    };

    const readWorkflow = async (
      workflowRunId: string,
    ): Promise<WorkflowRunFactRow> => {
      const [rows] = await pool.query<WorkflowRunFactRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           cancel_requested_at AS cancelRequestedAt,
           version
         FROM workflow_run
         WHERE id = ?`,
        [workflowRunId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`Missing workflow fixture ${workflowRunId}.`);
      }
      return row;
    };

    const readAssignment = async (
      assignmentIdentity: string,
    ): Promise<AssignmentFactRow> => {
      const [rows] = await pool.query<AssignmentFactRow[]>(
        `SELECT
           id,
           browser_executor_session_id AS browserExecutorSessionId,
           capability_attempt_id AS capabilityAttemptId,
           attempt_lease_generation AS attemptLeaseGeneration,
           execution_generation AS executionGeneration,
           attempt_grant_token_hash AS attemptGrantTokenHash,
           state,
           stable_reason_code AS stableReasonCode,
           last_heartbeat_at AS lastHeartbeatAt,
           lease_expires_at AS leaseExpiresAt,
           terminal_at AS terminalAt,
           updated_at AS updatedAt
         FROM browser_attempt_assignment
         WHERE id = ?`,
        [assignmentIdentity],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(
          `Missing browser assignment fixture ${assignmentIdentity}.`,
        );
      }
      return row;
    };

    beforeAll(async () => {
      if (disposableIntegration) {
        disposableDatabase = disposableDatabaseName();
        const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
        let networkConfig: DatabaseConnectionConfig | undefined;
        if (socketPath) {
          adminPool = createPool({
            socketPath,
            user: process.env.KANVAS_DATABASE_USER ?? "root",
            password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
            connectionLimit: 2,
            multipleStatements: true,
            timezone: "Z",
          });
        } else {
          networkConfig = loadDatabaseConnectionConfig(process.env);
          adminPool = createPool({
            host: networkConfig.host,
            port: networkConfig.port,
            user: networkConfig.user,
            password: networkConfig.password,
            connectionLimit: 2,
            multipleStatements: true,
            timezone: "Z",
          });
        }
        await adminPool.query(
          `CREATE DATABASE \`${disposableDatabase}\`
           CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
        );
        const inventory = await readMigrationInventory(
          resolve(import.meta.dirname, "../migrations"),
        );
        const migrationConnection = await adminPool.getConnection();
        try {
          await migrationConnection.query(`USE \`${disposableDatabase}\``);
          for (const migration of inventory) {
            await migrationConnection.query(migration.sql);
          }
        } finally {
          migrationConnection.release();
        }
        if (socketPath) {
          pool = createPool({
            socketPath,
            database: disposableDatabase,
            user: process.env.KANVAS_DATABASE_USER ?? "root",
            password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
            connectionLimit: 6,
            timezone: "Z",
          });
        } else {
          if (!networkConfig) {
            throw new Error("Network database configuration is missing.");
          }
          pool = createPool({
            host: networkConfig.host,
            port: networkConfig.port,
            database: disposableDatabase,
            user: networkConfig.user,
            password: networkConfig.password,
            connectionLimit: 6,
            timezone: "Z",
          });
        }
      } else {
        const connection = loadDatabaseConnectionConfig(process.env);
        pool = createPool({
          host: connection.host,
          port: connection.port,
          database: connection.database,
          user: connection.user,
          password: connection.password,
          connectionLimit: 6,
          timezone: "Z",
        });
      }

      if (!disposableIntegration) {
        const [migrationRows] = await pool.query<CountRow[]>(
          `SELECT COUNT(*) AS count
           FROM kanvas_migration_history
           WHERE name = '0000_initial_schema.sql'`,
        );
        expect(Number(migrationRows[0]?.count ?? 0)).toBe(1);
      }
      const cleanupConnection = await pool.getConnection();
      try {
        await removeFixtures(cleanupConnection);
      } finally {
        cleanupConnection.release();
      }
    }, 30_000);

    beforeEach(async () => {
      const cleanupConnection = await pool.getConnection();
      try {
        await removeFixtures(cleanupConnection);
      } finally {
        cleanupConnection.release();
      }
      await seedFoundation();
      store = createBrowserControlPlaneStore(pool, {
        claimingEnabled: true,
        instanceId: runtimeInstanceId,
      });
    }, 30_000);

    afterAll(async () => {
      if (pool) {
        const cleanupConnection = await pool.getConnection();
        try {
          await removeFixtures(cleanupConnection);
        } finally {
          cleanupConnection.release();
        }
        await pool.end();
      }
      if (adminPool && disposableDatabase) {
        await adminPool.query(
          `DROP DATABASE IF EXISTS \`${disposableDatabase}\``,
        );
        await adminPool.end();
      }
    });

    it("registers only an exact published browser implementation declaration", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);

      const [sessionRows] = await pool.query<SessionFactRow[]>(
        `SELECT
           id,
           workspace_id AS workspaceId,
           state,
           runtime_release_digest AS runtimeReleaseDigest,
           capability_manifest_digest AS capabilityManifestDigest,
           last_seen_at AS lastSeenAt,
           expires_at AS expiresAt,
           terminal_at AS terminalAt,
           updated_at AS updatedAt
         FROM browser_executor_session
         WHERE id = ?`,
        [ids.sessionA],
      );
      expect(sessionRows).toEqual([
        expect.objectContaining({
          id: ids.sessionA,
          workspaceId: ids.workspace,
          state: "active",
          runtimeReleaseDigest: digest("browser-runtime-release"),
          capabilityManifestDigest: digest(`browser-manifest-${ids.sessionA}`),
          lastSeenAt: fixtureAt,
          expiresAt: sessionExpiresAt,
          terminalAt: null,
          updatedAt: fixtureAt,
        }),
      ]);

      const [capabilityRows] = await pool.query<ExecutorCapabilityFactRow[]>(
        `SELECT
             id,
             browser_executor_session_id AS browserExecutorSessionId,
             implementation_revision_id AS implementationRevisionId,
             implementation_digest AS implementationDigest,
             adapter_key AS adapterKey,
             backend,
             probe_profile_version AS probeProfileVersion,
             probe_result_digest AS probeResultDigest
           FROM browser_executor_capability
           WHERE browser_executor_session_id = ?`,
        [ids.sessionA],
      );
      expect(capabilityRows).toEqual([
        {
          id: ids.executorCapabilityA,
          browserExecutorSessionId: ids.sessionA,
          implementationRevisionId: ids.implementation,
          implementationDigest,
          adapterKey,
          backend: "webgpu",
          probeProfileVersion: 2,
          probeResultDigest: digest(`browser-probe-${ids.sessionA}`),
        },
      ]);

      await expect(
        store.registerExecutorSession({
          sessionId: ids.mismatchedSession,
          authority,
          runtimeReleaseId: ids.runtimeRelease,
          runtimeReleaseDigest: digest("browser-runtime-release"),
          capabilityManifestVersion: 5,
          capabilityManifestDigest: digest("mismatched-manifest"),
          capabilities: [
            {
              id: ids.mismatchedExecutorCapability,
              implementationRevisionId: ids.implementation,
              implementationDigest,
              adapterKey: "browser.wrong-adapter",
              backend: "webgpu",
              probeProfileVersion: 2,
              probeResultDigest: digest("mismatched-probe"),
            },
          ],
          now: fixtureAt,
          expiresAt: sessionExpiresAt,
        }),
      ).rejects.toMatchObject({
        code: "browser_control.registration_mismatch",
      });
      expect(
        await count("browser_executor_session", "id = ?", [
          ids.mismatchedSession,
        ]),
      ).toBe(0);
    });

    it("serializes claims behind implementation deprecation and revocation", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);

      for (const [index, lifecycleStatus] of [
        "deprecated",
        "revoked",
      ].entries()) {
        const lifecycleConnection = await pool.getConnection();
        let committed = false;
        let claimPromise:
          ReturnType<BrowserControlPlaneStore["claimNextAttempt"]> | undefined;
        try {
          await lifecycleConnection.beginTransaction();
          await lifecycleConnection.execute(
            `SELECT id
               FROM capability_implementation_revision
               WHERE id = ?
               LIMIT 1
               FOR UPDATE`,
            [ids.implementation],
          );
          await lifecycleConnection.execute(
            `UPDATE capability_implementation_revision
               SET lifecycle_status = ?
               WHERE id = ?`,
            [lifecycleStatus, ids.implementation],
          );

          claimPromise = store.claimNextAttempt(
            claimOptions(ids.sessionA, 20 + index),
          );
          await withTimeout(
            waitUntilCapabilityIsWriteLocked(
              pool,
              ids.capabilityRunA,
              claimPromise,
            ),
            `observe claim blocked by ${lifecycleStatus}`,
          );

          await lifecycleConnection.commit();
          committed = true;
          await expect(
            withTimeout(
              claimPromise,
              `claim after implementation ${lifecycleStatus}`,
            ),
          ).resolves.toBeUndefined();
        } finally {
          if (!committed) {
            await lifecycleConnection.rollback();
          }
          lifecycleConnection.release();
          if (claimPromise) {
            await withTimeout(
              claimPromise.catch(() => undefined),
              "settle lifecycle-raced claim",
            );
          }
        }

        const [implementationRows] = await pool.query<ImplementationFactRow[]>(
          `SELECT lifecycle_status AS lifecycleStatus
               FROM capability_implementation_revision
               WHERE id = ?`,
          [ids.implementation],
        );
        expect(implementationRows).toEqual([{ lifecycleStatus }]);
        expect(
          await count(
            "browser_attempt_assignment",
            "capability_attempt_id = ?",
            [ids.attemptA],
          ),
        ).toBe(0);
        expect(await readCapability(ids.capabilityRunA)).toEqual(
          expect.objectContaining({
            lifecycleStatus: "queued",
            currentAttemptId: ids.attemptA,
            acceptedAttemptId: null,
          }),
        );
        expect(await readAttempt(ids.attemptA)).toEqual(
          expect.objectContaining({
            lifecycleStatus: "created",
            leaseGeneration: 0,
            leaseTokenHash: null,
            leaseExpiresAt: null,
          }),
        );
      }
    }, 20_000);

    it("allows exactly one of two concurrent sessions to claim the same attempt", async () => {
      await Promise.all([
        registerSession(ids.sessionA, ids.executorCapabilityA),
        registerSession(ids.sessionB, ids.executorCapabilityB),
      ]);
      const claimA = claimOptions(ids.sessionA, 1, {
        candidateLimit: 1,
      });
      const claimB = claimOptions(ids.sessionB, 2, {
        candidateLimit: 1,
      });

      const results = await Promise.all([
        store.claimNextAttempt(claimA),
        store.claimNextAttempt(claimB),
      ]);
      const winners = results.filter((result) => result !== undefined);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      if (!winner) {
        throw new Error("Expected one concurrent browser claim winner.");
      }
      expect(winner.attemptId).toBe(ids.attemptA);

      const [assignmentRows] = await pool.query<AssignmentFactRow[]>(
        `SELECT
             id,
             browser_executor_session_id AS browserExecutorSessionId,
             capability_attempt_id AS capabilityAttemptId,
             attempt_lease_generation AS attemptLeaseGeneration,
             execution_generation AS executionGeneration,
             attempt_grant_token_hash AS attemptGrantTokenHash,
             state,
             stable_reason_code AS stableReasonCode,
             last_heartbeat_at AS lastHeartbeatAt,
             lease_expires_at AS leaseExpiresAt,
             terminal_at AS terminalAt,
             updated_at AS updatedAt
           FROM browser_attempt_assignment
           WHERE capability_attempt_id = ?`,
        [ids.attemptA],
      );
      expect(assignmentRows).toHaveLength(1);
      expect(assignmentRows[0]).toEqual(
        expect.objectContaining({
          id: winner.assignmentId,
          browserExecutorSessionId: winner.sessionId,
          capabilityAttemptId: ids.attemptA,
          attemptLeaseGeneration: winner.leaseGeneration,
          executionGeneration: winner.executionGeneration,
          state: "active",
          stableReasonCode: null,
          leaseExpiresAt: initialLeaseUntil,
          terminalAt: null,
        }),
      );

      const winningOptions =
        winner.sessionId === ids.sessionA ? claimA : claimB;
      expect(assignmentRows[0]?.attemptGrantTokenHash).toBe(
        winningOptions.attemptGrantTokenHash,
      );
      expect(await readAttempt(ids.attemptA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "running",
          leaseGeneration: winner.leaseGeneration,
          leaseTokenHash: winningOptions.domainLeaseTokenHash,
          leaseExpiresAt: initialLeaseUntil,
          executionDeadlineAt,
        }),
      );

      const [capabilityRows] = await pool.query<CapabilityRunFactRow[]>(
        `SELECT
             lifecycle_status AS lifecycleStatus,
             version,
             updated_at AS updatedAt
           FROM capability_run
           WHERE id = ?`,
        [ids.capabilityRunA],
      );
      expect(capabilityRows).toEqual([
        {
          lifecycleStatus: "running",
          version: 2,
          updatedAt: claimAt,
        },
      ]);
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [winner.assignmentId],
        ),
      ).toBe(1);
    });

    it("prevents concurrent claims from giving one session two active assignments", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const results = await Promise.all([
        store.claimNextAttempt(
          claimOptions(ids.sessionA, 3, {
            candidateLimit: 2,
          }),
        ),
        store.claimNextAttempt(
          claimOptions(ids.sessionA, 4, {
            candidateLimit: 2,
          }),
        ),
      ]);
      const winners = results.filter((result) => result !== undefined);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.attemptId).toBe(ids.attemptA);
      expect(
        await count(
          "browser_attempt_assignment",
          "browser_executor_session_id = ? AND state IN ('active', 'cancel_requested')",
          [ids.sessionA],
        ),
      ).toBe(1);
      expect(await readAttempt(ids.attemptB)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "created",
          leaseGeneration: 0,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        }),
      );
    });

    it("serializes a browser claim with workflow cancellation without mixed facts", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 22);
      const cancellationAt = claim.now;
      const cancelDeadlineAt = new Date(cancellationAt.getTime() + 30_000);
      const persistence = createWorkflowExecutionPersistence(pool);
      const cancellationPromise = persistence.transactionManager.run(
        (context) =>
          persistence.cancellations.request(
            {
              workspaceId: ids.workspace,
              workflowRunId: ids.workflowA,
              actorId: ids.principal,
              reasonCode: "user_requested",
              now: cancellationAt,
              cancelDeadlineAt,
              outboxEventId: ids.cancellationOutbox,
              executionGeneration: claim.executionGeneration,
            },
            context,
          ),
      );
      const claimPromise = store.claimNextAttempt(claim);

      const [cancellation, claimed] = await withTimeout(
        Promise.all([cancellationPromise, claimPromise]),
        "concurrent browser claim and workflow cancellation",
        10_000,
      );
      expect(cancellation?.replayed).toBe(false);
      expect(cancellation?.run).toEqual(
        expect.objectContaining({
          id: ids.workflowA,
          lifecycleStatus: "cancelling",
          cancelRequestedAt: cancellationAt,
          cancelDeadlineAt,
        }),
      );
      expect(await readWorkflow(ids.workflowA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "cancelling",
          cancelRequestedAt: cancellationAt,
        }),
      );

      const capability = await readCapability(ids.capabilityRunA);
      const attempt = await readAttempt(ids.attemptA);
      expect(capability.cancelRequestedAt).toEqual(cancellationAt);
      expect(attempt.cancelRequestedAt).toEqual(cancellationAt);
      expect(attempt.cancelDeadlineAt).toEqual(cancelDeadlineAt);
      if (claimed?.attemptId === ids.attemptA) {
        expect(capability).toEqual(
          expect.objectContaining({
            lifecycleStatus: "running",
            currentAttemptId: ids.attemptA,
            acceptedAttemptId: null,
          }),
        );
        expect(attempt).toEqual(
          expect.objectContaining({
            lifecycleStatus: "running",
            leaseGeneration: claimed.leaseGeneration,
            leaseTokenHash: claim.domainLeaseTokenHash,
          }),
        );
        expect(
          await count(
            "browser_attempt_assignment",
            "capability_attempt_id = ? AND state = 'active'",
            [ids.attemptA],
          ),
        ).toBe(1);
        await expect(
          withTimeout(
            store.heartbeatAttempt(
              heartbeatOptions(claim, claimed.leaseGeneration, 22),
            ),
            "project cancellation to browser assignment",
          ),
        ).resolves.toBe("cancel_requested");
        expect(await readAssignment(claim.assignmentId)).toEqual(
          expect.objectContaining({
            state: "cancel_requested",
            stableReasonCode: "browser.cancel_requested",
          }),
        );
      } else if (claimed) {
        expect(claimed.attemptId).toBe(ids.attemptB);
        expect(capability).toEqual(
          expect.objectContaining({
            lifecycleStatus: "queued",
            currentAttemptId: ids.attemptA,
            acceptedAttemptId: null,
          }),
        );
        expect(attempt).toEqual(
          expect.objectContaining({
            lifecycleStatus: "created",
            leaseGeneration: 0,
            leaseTokenHash: null,
            leaseExpiresAt: null,
          }),
        );
        expect(await readCapability(ids.capabilityRunB)).toEqual(
          expect.objectContaining({
            lifecycleStatus: "running",
            currentAttemptId: ids.attemptB,
          }),
        );
        expect(await readAttempt(ids.attemptB)).toEqual(
          expect.objectContaining({
            lifecycleStatus: "running",
            leaseGeneration: claimed.leaseGeneration,
            leaseTokenHash: claim.domainLeaseTokenHash,
          }),
        );
        expect(
          await count(
            "browser_attempt_assignment",
            "capability_attempt_id = ? AND state = 'active'",
            [ids.attemptB],
          ),
        ).toBe(1);
      } else {
        expect(capability).toEqual(
          expect.objectContaining({
            lifecycleStatus: "queued",
            currentAttemptId: ids.attemptA,
            acceptedAttemptId: null,
          }),
        );
        expect(attempt).toEqual(
          expect.objectContaining({
            lifecycleStatus: "created",
            leaseGeneration: 0,
            leaseTokenHash: null,
            leaseExpiresAt: null,
          }),
        );
        expect(
          await count(
            "browser_attempt_assignment",
            "capability_attempt_id = ?",
            [ids.attemptA],
          ),
        ).toBe(0);
      }
      expect(
        await count(
          "outbox_event",
          "id = ? AND message_type = 'workflow.cancel.requested'",
          [ids.cancellationOutbox],
        ),
      ).toBe(1);
    }, 20_000);

    it("renews the assignment and domain leases together and only forwards them", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 5);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }

      const nonForwardHeartbeat = heartbeatOptions(
        claim,
        claimed.leaseGeneration,
        5,
        {
          leaseUntil: initialLeaseUntil,
        },
      );
      await expect(store.heartbeatAttempt(nonForwardHeartbeat)).resolves.toBe(
        "rejected",
      );

      const renewedLeaseUntil = new Date("2026-07-27T22:08:00.000Z");
      const heartbeat = heartbeatOptions(claim, claimed.leaseGeneration, 6, {
        leaseUntil: renewedLeaseUntil,
      });
      await expect(store.heartbeatAttempt(heartbeat)).resolves.toBe("renewed");

      const attempt = await readAttempt(ids.attemptA);
      const assignment = await readAssignment(claim.assignmentId);
      expect(attempt.leaseExpiresAt).toEqual(renewedLeaseUntil);
      expect(assignment.leaseExpiresAt).toEqual(renewedLeaseUntil);
      expect(assignment.lastHeartbeatAt).toEqual(heartbeat.now);
      expect(attempt.version).toBe(3);
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(1);
    });

    it("authorizes and binds one output allocation without extending the short heartbeat lease", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 27);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }
      const authorizeAt = new Date("2026-07-27T22:02:00.000Z");
      const authorization = await store.authorizeAttemptOutput({
        workspaceId: ids.workspace,
        sessionId: ids.sessionA,
        assignmentId: claim.assignmentId,
        attemptId: ids.attemptA,
        attemptGrantTokenHash: claim.attemptGrantTokenHash,
        domainLeaseTokenHash: claim.domainLeaseTokenHash,
        attemptLeaseGeneration: claimed.leaseGeneration,
        executionGeneration: claim.executionGeneration,
        now: authorizeAt,
      });
      expect(authorization).toEqual({
        status: "authorized",
        actorId: ids.principal,
        expiresAt: executionDeadlineAt,
      });

      const uploads = createStorageUploadStore(pool);
      const profileConfigurationHash = digest("browser-output-local-profile");
      await uploads.recordCompatibilityProbe({
        id: ids.storageProbe,
        workspaceId: ids.workspace,
        probeKey: "browser-output-local-v1",
        requestHash: digest("browser-output-probe-request"),
        storageProfileId: ids.storageProfile,
        profileConfigurationHash,
        adapterKey: "local-filesystem.v1",
        adapterVersion: "0.0.0-test",
        capabilityContractVersion: 1,
        capabilities: {
          supportsConditionalCreate: false,
          supportsServerOwnedWrite: true,
          supportsMultipart: false,
          supportsRangeRead: true,
          supportsVersionBoundIdentity: false,
          supportsFullObjectChecksum: true,
          sealedIdentityImmutable: true,
        },
        status: "passed",
        resultHash: digest("browser-output-probe-result"),
        evidence: {
          ownerControlledRoot: true,
        },
        testedAt: authorizeAt,
        validUntil: sessionExpiresAt,
        createdAt: authorizeAt,
      });
      await expect(
        uploads.allocateUploadSession({
          id: ids.outputUpload,
          workspaceId: ids.workspace,
          actorId: ids.principal,
          allocationRequestKey: "browser-output.integration.v1",
          allocationRequestHash: digest("browser-output-allocation"),
          purpose: "attempt_output",
          attemptId: ids.attemptA,
          outputRole: "primary",
          outputIndex: 0,
          expectedSize: "68",
          expectedMediaType: "image/png",
          storageProfileId: ids.storageProfile,
          compatibilityProbeId: ids.storageProbe,
          profileConfigurationHash,
          container: "objects",
          objectKey: `workspaces/${ids.workspace}/attempts/${ids.attemptA}/uploads/${ids.outputUpload}`,
          uploadMode: "server_stream",
          writeProtectionMode: "server_owned",
          verificationProfileVersion: "trusted-image-structural-v1",
          now: authorizeAt,
          expiresAt: executionDeadlineAt,
          cleanupEligibleAt: new Date(
            executionDeadlineAt.getTime() + 3_600_000,
          ),
        }),
      ).resolves.toMatchObject({
        id: ids.outputUpload,
        attemptId: ids.attemptA,
        state: "open",
        replayed: false,
      });
      await expect(
        uploads.readAttemptOutputUploadSession({
          workspaceId: ids.workspace,
          uploadSessionId: ids.outputUpload,
          attemptId: ids.attemptA,
          outputRole: "primary",
          outputIndex: 0,
        }),
      ).resolves.toMatchObject({
        id: ids.outputUpload,
        actorId: ids.principal,
        purpose: "attempt_output",
        expectedMediaType: "image/png",
        replayed: true,
      });
      await expect(
        uploads.readAttemptOutputUploadSession({
          workspaceId: ids.workspace,
          uploadSessionId: ids.outputUpload,
          attemptId: ids.attemptA,
          outputRole: "secondary",
          outputIndex: 0,
        }),
      ).rejects.toMatchObject({
        code: "storage_upload.not_found",
      });

      expect((await readAttempt(ids.attemptA)).leaseExpiresAt).toEqual(
        initialLeaseUntil,
      );
      expect((await readAssignment(claim.assignmentId)).leaseExpiresAt).toEqual(
        initialLeaseUntil,
      );
    });

    it("atomically acknowledges browser cancellation and replays without duplicate facts", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 30);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }
      const cancellationAt = new Date("2026-07-27T22:02:00.000Z");
      const cancelDeadlineAt = new Date("2026-07-27T22:02:30.000Z");
      const persistence = createWorkflowExecutionPersistence(pool);
      await persistence.transactionManager.run((context) =>
        persistence.cancellations.request(
          {
            workspaceId: ids.workspace,
            workflowRunId: ids.workflowA,
            actorId: ids.principal,
            reasonCode: "user_requested",
            now: cancellationAt,
            cancelDeadlineAt,
            outboxEventId: ids.cancellationOutbox,
            executionGeneration: claim.executionGeneration,
          },
          context,
        ),
      );
      await expect(
        store.heartbeatAttempt(
          heartbeatOptions(claim, claimed.leaseGeneration, 30),
        ),
      ).resolves.toBe("cancel_requested");

      const acknowledgement = {
        workspaceId: ids.workspace,
        sessionId: ids.sessionA,
        assignmentId: claim.assignmentId,
        capabilityRunId: ids.capabilityRunA,
        attemptId: ids.attemptA,
        attemptGrantTokenHash: claim.attemptGrantTokenHash,
        domainLeaseTokenHash: claim.domainLeaseTokenHash,
        attemptLeaseGeneration: claimed.leaseGeneration,
        executionGeneration: claim.executionGeneration,
        cancelledEventId: identity(7_650_001),
        terminalOutboxEventId: identity(7_650_002),
        now: new Date("2026-07-27T22:03:00.000Z"),
      } as const;
      await expect(
        store.acknowledgeAttemptCancellation(acknowledgement),
      ).resolves.toBe("acknowledged");
      await expect(
        store.acknowledgeAttemptCancellation({
          ...acknowledgement,
          cancelledEventId: identity(7_650_003),
          terminalOutboxEventId: identity(7_650_004),
          now: new Date("2026-07-27T22:04:00.000Z"),
        }),
      ).resolves.toBe("replayed");

      expect(await readCapability(ids.capabilityRunA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "cancelled",
          currentAttemptId: ids.attemptA,
          acceptedAttemptId: null,
        }),
      );
      expect(await readAttempt(ids.attemptA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "abandoned",
          leaseTokenHash: null,
          leaseExpiresAt: null,
        }),
      );
      expect(await readAssignment(claim.assignmentId)).toEqual(
        expect.objectContaining({
          state: "cancelled",
          stableReasonCode: "browser.cancel_acknowledged",
        }),
      );
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ? AND event_type = 'cancelled'",
          [claim.assignmentId],
        ),
      ).toBe(1);
      expect(
        await count(
          "outbox_event",
          "id = ? AND message_type = 'capability.run.cancelled'",
          [acknowledgement.terminalOutboxEventId],
        ),
      ).toBe(1);
    });

    it("stops new claims after drain while existing assignments can still heartbeat", async () => {
      await Promise.all([
        registerSession(ids.sessionA, ids.executorCapabilityA),
        registerSession(ids.sessionB, ids.executorCapabilityB),
      ]);
      const claim = claimOptions(ids.sessionA, 7);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }

      const drainAt = new Date("2026-07-27T22:02:00.000Z");
      await expect(
        store.drainSession({
          sessionId: ids.sessionA,
          authority,
          now: drainAt,
        }),
      ).resolves.toEqual({
        sessionId: ids.sessionA,
        state: "draining",
        changed: true,
      });
      await expect(
        store.drainSession({
          sessionId: ids.sessionB,
          authority,
          now: drainAt,
        }),
      ).resolves.toEqual({
        sessionId: ids.sessionB,
        state: "draining",
        changed: true,
      });

      const heartbeat = heartbeatOptions(claim, claimed.leaseGeneration, 7, {
        now: new Date("2026-07-27T22:03:00.000Z"),
        leaseUntil: new Date("2026-07-27T22:09:00.000Z"),
      });
      await expect(store.heartbeatAttempt(heartbeat)).resolves.toBe("renewed");
      expect((await readAssignment(claim.assignmentId)).leaseExpiresAt).toEqual(
        heartbeat.leaseUntil,
      );

      await expect(
        store.claimNextAttempt(
          claimOptions(ids.sessionB, 8, {
            now: new Date("2026-07-27T22:03:00.000Z"),
          }),
        ),
      ).resolves.toBeUndefined();
      expect(await readAttempt(ids.attemptB)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "created",
          leaseGeneration: 0,
        }),
      );
    });

    it("projects a revoked session on heartbeat and compresses the attempt lease", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 9);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }

      const revokeAt = new Date("2026-07-27T22:02:00.000Z");
      await expect(
        store.revokeSession({
          sessionId: ids.sessionA,
          authority,
          now: revokeAt,
        }),
      ).resolves.toEqual({
        sessionId: ids.sessionA,
        state: "revoked",
        changed: true,
      });

      const heartbeat = heartbeatOptions(claim, claimed.leaseGeneration, 9, {
        now: new Date("2026-07-27T22:03:00.000Z"),
        leaseUntil: new Date("2026-07-27T22:09:00.000Z"),
      });
      await expect(store.heartbeatAttempt(heartbeat)).resolves.toBe("revoked");

      const attempt = await readAttempt(ids.attemptA);
      const assignment = await readAssignment(claim.assignmentId);
      expect(attempt.leaseExpiresAt).toEqual(heartbeat.now);
      expect(assignment).toEqual(
        expect.objectContaining({
          state: "revoked",
          stableReasonCode: "browser.session_revoked",
          leaseExpiresAt: heartbeat.now,
          terminalAt: heartbeat.now,
          updatedAt: heartbeat.now,
        }),
      );
      const [sessionRows] = await pool.query<SessionFactRow[]>(
        `SELECT
           id,
           workspace_id AS workspaceId,
           state,
           runtime_release_digest AS runtimeReleaseDigest,
           capability_manifest_digest AS capabilityManifestDigest,
           last_seen_at AS lastSeenAt,
           expires_at AS expiresAt,
           terminal_at AS terminalAt,
           updated_at AS updatedAt
         FROM browser_executor_session
         WHERE id = ?`,
        [ids.sessionA],
      );
      expect(sessionRows[0]).toEqual(
        expect.objectContaining({
          state: "revoked",
          terminalAt: revokeAt,
          updatedAt: revokeAt,
        }),
      );
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(2);
    });

    it("reconciles a heartbeat-revoked assignment once without duplicating its event", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 23);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }

      const revokeAt = new Date("2026-07-27T22:02:00.000Z");
      await store.revokeSession({
        sessionId: ids.sessionA,
        authority,
        now: revokeAt,
      });
      const heartbeat = heartbeatOptions(claim, claimed.leaseGeneration, 23, {
        now: new Date("2026-07-27T22:03:00.000Z"),
        leaseUntil: new Date("2026-07-27T22:09:00.000Z"),
      });
      await expect(store.heartbeatAttempt(heartbeat)).resolves.toBe("revoked");
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(2);

      const reconciler = createWorkflowReconcilerStore(pool, {
        instanceId: runtimeInstanceId,
      });
      await expect(
        withTimeout(
          reconciler.reconcileExpiredAttempt(ids.capabilityRunA, ids.attemptA, {
            now: heartbeat.now,
            staleBefore: heartbeat.now,
            executionGeneration: claim.executionGeneration,
            outboxEventId: ids.reconciliationOutbox,
            nextAttemptId: ids.reconciliationNextAttempt,
            browserAssignmentEventId: ids.reconciliationAssignmentEvent,
          }),
          "reconcile heartbeat-revoked browser attempt",
        ),
      ).resolves.toBe("capability_failed");

      expect(await readAttempt(ids.attemptA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "abandoned",
          sideEffectState: "not_started",
          retryDisposition: "terminal",
          leaseTokenHash: null,
          leaseExpiresAt: null,
        }),
      );
      expect(await readCapability(ids.capabilityRunA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "failed",
          currentAttemptId: ids.attemptA,
          acceptedAttemptId: null,
        }),
      );
      expect(await readAssignment(claim.assignmentId)).toEqual(
        expect.objectContaining({
          state: "revoked",
          stableReasonCode: "browser.session_revoked",
          terminalAt: heartbeat.now,
        }),
      );
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(2);
      expect(
        await count(
          "outbox_event",
          "id = ? AND message_type = 'capability.run.failed'",
          [ids.reconciliationOutbox],
        ),
      ).toBe(1);

      await expect(
        withTimeout(
          reconciler.reconcileExpiredAttempt(ids.capabilityRunA, ids.attemptA, {
            now: new Date(heartbeat.now.getTime() + 1),
            staleBefore: heartbeat.now,
            executionGeneration: claim.executionGeneration,
            outboxEventId: ids.reconciliationReplayOutbox,
            nextAttemptId: ids.reconciliationReplayNextAttempt,
            browserAssignmentEventId: ids.reconciliationReplayAssignmentEvent,
          }),
          "replay heartbeat-revoked browser reconciliation",
        ),
      ).resolves.toBe("noop");
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(2);
      expect(
        await count("outbox_event", "id IN (?, ?)", [
          ids.reconciliationOutbox,
          ids.reconciliationReplayOutbox,
        ]),
      ).toBe(1);
    }, 20_000);

    it("fails closed across workspace and human authority boundaries", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);

      await expect(
        store.claimNextAttempt(
          claimOptions(ids.sessionA, 24, {
            authority: {
              ...authority,
              workspaceId: identity(7_699_001),
            },
          }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        store.claimNextAttempt(
          claimOptions(ids.sessionA, 25, {
            authority: {
              ...authority,
              createdByPrincipalId: identity(7_699_002),
              authenticationRefHash: hash("wrong-human-authority"),
            },
          }),
        ),
      ).resolves.toBeUndefined();

      expect(
        await count("browser_attempt_assignment", "capability_attempt_id = ?", [
          ids.attemptA,
        ]),
      ).toBe(0);
      expect(await readCapability(ids.capabilityRunA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "queued",
          currentAttemptId: ids.attemptA,
          acceptedAttemptId: null,
        }),
      );
      expect(await readAttempt(ids.attemptA)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "created",
          leaseGeneration: 0,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        }),
      );

      await expect(
        store.claimNextAttempt(claimOptions(ids.sessionA, 26)),
      ).resolves.toEqual(
        expect.objectContaining({
          sessionId: ids.sessionA,
          workspaceId: ids.workspace,
          attemptId: ids.attemptA,
        }),
      );
    });

    it("rejects wrong grants and generations without changing durable facts", async () => {
      await registerSession(ids.sessionA, ids.executorCapabilityA);
      const claim = claimOptions(ids.sessionA, 10);
      const claimed = await store.claimNextAttempt(claim);
      if (!claimed) {
        throw new Error("Expected a browser assignment.");
      }
      const attemptBefore = await readAttempt(ids.attemptA);
      const assignmentBefore = await readAssignment(claim.assignmentId);
      const eventCountBefore = await count(
        "browser_attempt_assignment_event",
        "browser_attempt_assignment_id = ?",
        [claim.assignmentId],
      );

      await expect(
        store.heartbeatAttempt(
          heartbeatOptions(claim, claimed.leaseGeneration, 10, {
            attemptGrantTokenHash: hash("wrong-attempt-grant"),
          }),
        ),
      ).resolves.toBe("rejected");
      await expect(
        store.heartbeatAttempt(
          heartbeatOptions(claim, claimed.leaseGeneration + 1, 11),
        ),
      ).resolves.toBe("rejected");
      await expect(
        store.heartbeatAttempt(
          heartbeatOptions(claim, claimed.leaseGeneration, 12, {
            executionGeneration: claim.executionGeneration + 1,
          }),
        ),
      ).resolves.toBe("rejected");

      expect(await readAttempt(ids.attemptA)).toEqual(attemptBefore);
      expect(await readAssignment(claim.assignmentId)).toEqual(
        assignmentBefore,
      );
      expect(
        await count(
          "browser_attempt_assignment_event",
          "browser_attempt_assignment_id = ?",
          [claim.assignmentId],
        ),
      ).toBe(eventCountBefore);
    });
  },
);
