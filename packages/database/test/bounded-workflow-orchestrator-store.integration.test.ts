import type { WorkflowTopologyV1 } from "@kanvas/contracts/workflow";
import {
  authorizationModelVersion,
  workflowApprovalAuthorizationDecisionId,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import {
  createBoundedWorkflowOrchestratorStore,
  type AuthorizedApprovalDecisionContext,
  type BoundedWorkflowOrchestratorStore,
  type DecideWorkflowApprovalOptions,
} from "../src/runtime/bounded-workflow-orchestrator-store.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "../src/runtime/provider-value-digest.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;

let identitySequence = 51_000_000;
const nextIdentity = (): string => {
  const value = identity(identitySequence);
  identitySequence += 1;
  return value;
};

const workspaceId = identity(50_000_001);
const actorId = identity(50_000_002);
const membershipId = identity(50_000_008);
const contractRevisionId = identity(50_000_003);
const implementationRevisionId = identity(50_000_004);
const bindingId = identity(50_000_005);
const adapterDefinitionId = identity(50_000_006);
const adapterRevisionId = identity(50_000_007);
const contractDigest = digestProviderValue({
  contract: "tool.echo",
  revision: 1,
});
const implementationDigest = digestProviderValue({
  implementation: "worker.tool.echo",
  revision: 1,
});

function createIntegrationPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    const database = process.env.KANVAS_DATABASE_NAME?.trim();
    if (!database) {
      throw new Error(
        "KANVAS_DATABASE_NAME is required with KANVAS_DATABASE_SOCKET.",
      );
    }
    return createPool({
      socketPath,
      database,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 8,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const connection = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    connectionLimit: 8,
    timezone: "Z",
    decimalNumbers: false,
  });
}

const cleanupTables = [
  "inbox_receipt",
  "workflow_capability_cancellation_request",
  "workflow_deadline_schedule",
  "workflow_output_fact",
  "workflow_map_item",
  "workflow_map_state",
  "workflow_map_expansion",
  "workflow_approval_decision",
  "workflow_approval_state",
  "workflow_approval_request",
  "workflow_activated_edge",
  "workflow_switch_decision",
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
] as const;

async function removeFixtures(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    if (await resetDisposableIntegrationDatabase(connection)) {
      return;
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of cleanupTables) {
      await connection.query(`DELETE FROM ${table} WHERE workspace_id = ?`, [
        workspaceId,
      ]);
    }
    await connection.query(
      "DELETE FROM workspace_membership WHERE workspace_id = ?",
      [workspaceId],
    );
    await connection.query("DELETE FROM workspace WHERE id = ?", [workspaceId]);
    await connection.query("DELETE FROM organization WHERE id = ?", [
      workspaceId,
    ]);
    await connection.query(
      "DELETE FROM human_principal WHERE principal_id = ?",
      [actorId],
    );
    await connection.query("DELETE FROM principal WHERE id = ?", [actorId]);
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    connection.release();
  }
}

interface SeededWorkflow {
  readonly workflowRunId: string;
  readonly workflowRevisionId: string;
  readonly nodeIdsByKey: ReadonlyMap<string, string>;
  readonly initialEventId: string;
  readonly createdAt: Date;
  readonly deadlineAt: Date;
}

function workerRoute(nodeKey: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    nodeKey,
    contractRevisionId,
    contractKey: "tool.echo",
    contractRevision: 1,
    contractDigest,
    candidates: Object.freeze([
      Object.freeze({
        candidateIndex: 0,
        bindingId,
        bindingVersion: 1,
        implementationRevisionId,
        implementationDigest,
        executionTarget: "worker",
        adapterKey: "worker.tool.echo",
        idempotencyMode: "intrinsic",
        retryPolicy: Object.freeze({
          maxAttempts: 1,
          backoff: "fixed",
          initialDelayMs: 0,
          maxDelayMs: 0,
        }),
        attemptTimeoutMs: 5_000,
        fallbackOn: Object.freeze([]),
      }),
    ]),
  });
}

async function seedWorkflow(
  pool: Pool,
  options: {
    readonly key: string;
    readonly topology: WorkflowTopologyV1;
    readonly routes?: readonly Readonly<Record<string, unknown>>[];
    readonly input?: unknown;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
    readonly createdAt: Date;
  },
): Promise<SeededWorkflow> {
  const workflowRevisionId = nextIdentity();
  const workflowRunId = nextIdentity();
  const initialEventId = nextIdentity();
  const revisionDigest = digestProviderValue({
    key: options.key,
    topology: options.topology,
  });
  const plan = Object.freeze({
    schemaVersion: 1,
    workflowRevision: Object.freeze({
      id: workflowRevisionId,
      canonicalDigest: revisionDigest,
    }),
    topology: options.topology,
    routes: Object.freeze([...(options.routes ?? [])]),
  });
  const planHash = digestProviderValue(plan);
  const input = options.input ?? {};
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
     ) VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?, ?)`,
    [
      workflowRevisionId,
      workspaceId,
      options.key,
      revisionDigest,
      canonicalizeProviderValue(options.topology),
      canonicalizeProviderValue({ type: "object" }),
      canonicalizeProviderValue(options.outputSchema ?? { type: "object" }),
      options.createdAt,
      options.createdAt,
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
       output,
       output_digest,
       terminal_reason_code,
       execution_deadline_at,
       execution_plan_snapshot,
       execution_plan_hash,
       created_by,
       version,
       created_at,
       updated_at,
       completed_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'queued', NULL, ?, NULL, NULL, NULL, ?,
       ?, ?, ?, 1, ?, ?, NULL
     )`,
    [
      workflowRunId,
      workspaceId,
      workflowRevisionId,
      `workflow-v1-${options.key}`,
      digestProviderValue(input),
      canonicalizeProviderValue(input),
      new Date(options.createdAt.getTime() + options.topology.limits.timeoutMs),
      canonicalizeProviderValue(plan),
      planHash,
      actorId,
      options.createdAt,
      options.createdAt,
    ],
  );
  const nodeIdsByKey = new Map<string, string>();
  for (const node of options.topology.nodes) {
    const nodeId = nextIdentity();
    nodeIdsByKey.set(node.key, nodeId);
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
         ?, ?, ?, ?, 'root', ?, 'pending', NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL
       )`,
      [
        nodeId,
        workspaceId,
        workflowRunId,
        node.key,
        node.kind,
        options.createdAt,
        options.createdAt,
      ],
    );
  }
  await pool.execute(
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
       ?, ?, 'workflow.wakeup.requested', 1, 'workflow_run', ?, 1,
       ?, 'pending', ?, 0, ?
     )`,
    [
      initialEventId,
      workspaceId,
      workflowRunId,
      canonicalizeProviderValue({
        workflowRunId,
        expectedGeneration: 1,
        cause: "workflow.created",
      }),
      options.createdAt,
      options.createdAt,
    ],
  );
  return Object.freeze({
    workflowRunId,
    workflowRevisionId,
    nodeIdsByKey,
    initialEventId,
    createdAt: options.createdAt,
    deadlineAt: new Date(
      options.createdAt.getTime() + options.topology.limits.timeoutMs,
    ),
  });
}

interface OutboxDeliveryRow extends RowDataPacket {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: unknown;
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

async function consumeEvent(
  pool: Pool,
  store: BoundedWorkflowOrchestratorStore,
  workflowRunId: string,
  eventId: string,
  now: Date,
) {
  const [rows] = await pool.execute<OutboxDeliveryRow[]>(
    `SELECT
       id AS eventId,
       workspace_id AS workspaceId,
       message_type AS messageType,
       schema_version AS schemaVersion,
       aggregate_type AS aggregateType,
       aggregate_id AS aggregateId,
       aggregate_version AS aggregateVersion,
       payload
     FROM outbox_event
     WHERE id = ?`,
    [eventId],
  );
  const event = rows[0];
  if (!event) {
    throw new Error(`Missing OutboxEvent ${eventId}.`);
  }
  const payload = parseJson(event.payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Malformed OutboxEvent ${eventId}.`);
  }
  const expectedGeneration = (payload as Readonly<Record<string, unknown>>)
    .expectedGeneration;
  if (typeof expectedGeneration !== "number") {
    throw new Error(`OutboxEvent ${eventId} has no generation.`);
  }
  return store.consumeFrontier({
    workflowRunId,
    executionGeneration: expectedGeneration,
    now,
    delivery: {
      consumerName: "workflow-v1-integration",
      eventId: event.eventId,
      workspaceId: event.workspaceId,
      messageType: event.messageType,
      schemaVersion: event.schemaVersion,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      expectedGeneration,
      receivedAt: now,
    },
  });
}

interface ApprovalRow extends RowDataPacket {
  readonly id: string;
  readonly nodeRunId: string;
  readonly authorizationContextDigest: string;
}

async function loadApproval(
  pool: Pool,
  workflowRunId: string,
  nodeRunId: string,
): Promise<ApprovalRow> {
  const [rows] = await pool.execute<ApprovalRow[]>(
    `SELECT
       id,
       node_run_id AS nodeRunId,
       authorization_context_digest AS authorizationContextDigest
     FROM workflow_approval_request
     WHERE workflow_run_id = ?
       AND node_run_id = ?`,
    [workflowRunId, nodeRunId],
  );
  const approval = rows[0];
  if (!approval) {
    throw new Error(`Missing ApprovalRequest for ${nodeRunId}.`);
  }
  return approval;
}

function approvalDecisionOptions(
  approval: ApprovalRow,
  options: {
    readonly decisionId: string;
    readonly outboxEventId: string;
    readonly decision: unknown;
    readonly now: Date;
  },
): DecideWorkflowApprovalOptions {
  const authority = {
    workspaceId,
    organizationId: workspaceId,
    principalId: actorId,
    principalType: "human",
    authenticationRefType: "session",
    authenticationRefId: "workflow-v1-integration-session",
    authorityType: "human_membership",
    authorityId: membershipId,
    authorityVersion: 1,
    authorizationModelVersion,
    effectivePermissions: ["approval.decide"],
    trusted: true,
  } satisfies TrustedWorkspaceScope;
  const idempotencyKeyDigest = digestProviderValue({
    kind: "workflow_approval_decision_idempotency",
    approvalRequestId: approval.id,
    idempotencyKey: options.decisionId,
  });
  const authorization = {
    effect: "allow",
    authorizationDecisionId: workflowApprovalAuthorizationDecisionId(
      approval.id,
      idempotencyKeyDigest,
    ),
    workspaceId,
    approvalRequestId: approval.id,
    actorPrincipalId: actorId,
    permission: "approval.decide",
    bindingDigest: approval.authorizationContextDigest,
    policyRevision: "authorization-model.v1",
    authorizedAt: new Date(options.now.getTime() - 100),
    validUntil: new Date(options.now.getTime() + 10_000),
  } satisfies AuthorizedApprovalDecisionContext;
  return Object.freeze({
    approvalRequestId: approval.id,
    workspaceId,
    authority,
    idempotencyKeyDigest,
    decisionId: options.decisionId,
    outboxEventId: options.outboxEventId,
    decision: options.decision,
    authorization,
    executionGeneration: 1,
    now: options.now,
  });
}

interface CapabilityFactRow extends RowDataPacket {
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly nodeRunId: string;
  readonly scopeKey: string;
  readonly capabilityVersion: number;
  readonly attemptVersion: number;
}

async function loadCapabilityFacts(
  pool: Pool,
  workflowRunId: string,
): Promise<readonly CapabilityFactRow[]> {
  const [rows] = await pool.execute<CapabilityFactRow[]>(
    `SELECT
       capability.id AS capabilityRunId,
       capability.current_attempt_id AS attemptId,
       node.id AS nodeRunId,
       node.scope_key AS scopeKey,
       capability.version AS capabilityVersion,
       attempt.version AS attemptVersion
     FROM capability_run AS capability
     INNER JOIN node_run AS node
       ON node.id = capability.node_run_id
     INNER JOIN capability_attempt AS attempt
       ON attempt.id = capability.current_attempt_id
     WHERE node.workflow_run_id = ?
     ORDER BY node.scope_key, capability.id`,
    [workflowRunId],
  );
  return rows;
}

async function settleCapability(
  connection: PoolConnection,
  fact: CapabilityFactRow,
  status: "completed" | "failed" | "cancelled",
  now: Date,
  output?: unknown,
): Promise<{ readonly eventId: string; readonly version: number }> {
  const nextAttemptVersion = fact.attemptVersion + 1;
  await connection.execute(
    `UPDATE capability_attempt
     SET lifecycle_status = ?,
         side_effect_state = ?,
         retry_disposition = ?,
         version = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND version = ?`,
    [
      status,
      status === "completed" ? "committed" : "not_started",
      status === "failed" ? "terminal" : null,
      nextAttemptVersion,
      now,
      now,
      fact.attemptId,
      fact.attemptVersion,
    ],
  );
  const nextCapabilityVersion = fact.capabilityVersion + 1;
  await connection.execute(
    `UPDATE capability_run
     SET lifecycle_status = ?,
         accepted_attempt_id = ?,
         output = ?,
         version = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?
       AND version = ?`,
    [
      status,
      status === "completed" ? fact.attemptId : null,
      status === "completed" ? canonicalizeProviderValue(output ?? {}) : null,
      nextCapabilityVersion,
      now,
      now,
      fact.capabilityRunId,
      fact.capabilityVersion,
    ],
  );
  const eventId = nextIdentity();
  const messageType = `capability.run.${status}`;
  await connection.execute(
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
       ?, ?, ?, 1, 'capability_run', ?, ?, ?, 'pending', ?, 0, ?
     )`,
    [
      eventId,
      workspaceId,
      messageType,
      fact.capabilityRunId,
      nextCapabilityVersion,
      canonicalizeProviderValue({
        workflowRunId: (
          await connection.execute<
            ({ readonly workflowRunId: string } & RowDataPacket)[]
          >(
            `SELECT node.workflow_run_id AS workflowRunId
             FROM node_run AS node
             WHERE node.id = ?`,
            [fact.nodeRunId],
          )
        )[0][0]?.workflowRunId,
        nodeRunId: fact.nodeRunId,
        capabilityRunId: fact.capabilityRunId,
        expectedGeneration: 1,
      }),
      now,
      now,
    ],
  );
  return Object.freeze({
    eventId,
    version: nextCapabilityVersion,
  });
}

function expectObjectSchema(
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
): readonly string[] {
  const issues: string[] = [];
  if (
    schema.type === "object" &&
    (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    issues.push("must be an object");
    return issues;
  }
  const required = schema.required;
  if (Array.isArray(required) && value && typeof value === "object") {
    for (const key of required) {
      if (typeof key === "string" && !Object.hasOwn(value, key)) {
        issues.push(`missing ${key}`);
      }
    }
  }
  const properties = schema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    for (const [key, rawDefinition] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      if (
        !rawDefinition ||
        typeof rawDefinition !== "object" ||
        Array.isArray(rawDefinition)
      ) {
        continue;
      }
      const definition = rawDefinition as Readonly<Record<string, unknown>>;
      const fieldValue = (value as Readonly<Record<string, unknown>>)[key];
      if (
        (definition.type === "boolean" && typeof fieldValue !== "boolean") ||
        (definition.type === "string" && typeof fieldValue !== "string") ||
        (definition.type === "number" &&
          (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))) ||
        (definition.type === "integer" && !Number.isSafeInteger(fieldValue))
      ) {
        issues.push(`${key} has the wrong type`);
      }
    }
  }
  return issues;
}

describe.skipIf(!integrationEnabled)(
  "bounded Workflow v1 Orchestrator against a real MySQL 8.0 database",
  () => {
    let pool!: Pool;
    let store!: BoundedWorkflowOrchestratorStore;

    beforeAll(async () => {
      pool = createIntegrationPool();
      const [versionRows] = await pool.query<
        ({ readonly version: string } & RowDataPacket)[]
      >("SELECT VERSION() AS version");
      expect(versionRows[0]?.version).toMatch(/^8\.0\./u);
      const [tableRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = 'workflow_deadline_schedule'`,
      );
      expect(Number(tableRows[0]?.count ?? 0)).toBe(1);
      await removeFixtures(pool);
      const at = new Date("2026-07-28T00:00:00.000Z");
      await pool.execute(
        `INSERT INTO organization (
           id, slug, name, status, version, created_at, updated_at
         ) VALUES (
           ?, 'workflow-v1-integration', 'Workflow v1 Integration',
           'active', 1, ?, ?
         )`,
        [workspaceId, at, at],
      );
      await pool.execute(
        `INSERT INTO workspace (
           id, organization_id, slug, name, status, version,
           created_at, updated_at
         ) VALUES (
           ?, ?, 'workflow-v1-integration', 'Workflow v1 Integration',
           'active', 1, ?, ?
         )`,
        [workspaceId, workspaceId, at, at],
      );
      await pool.execute(
        `INSERT INTO principal (
           id, principal_type, status, version, created_at, updated_at
         ) VALUES (?, 'human', 'active', 1, ?, ?)`,
        [actorId, at, at],
      );
      await pool.execute(
        `INSERT INTO human_principal (
           principal_id, auth_subject_id, created_at
         ) VALUES (?, 'workflow-v1-integration-subject', ?)`,
        [actorId, at],
      );
      await pool.execute(
        `INSERT INTO workspace_membership (
           id, organization_id, workspace_id, principal_id, role, status,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [membershipId, workspaceId, workspaceId, actorId, at, at],
      );
      await pool.execute(
        `INSERT INTO capability_contract_revision (
           id, workspace_id, contract_key, revision, lifecycle_status,
           canonical_digest, input_schema, output_schema, idempotency_mode,
           supported_invokers, created_at, published_at
         ) VALUES (
           ?, ?, 'tool.echo', 1, 'published', ?, ?, ?, 'intrinsic',
           '["workflow"]', ?, ?
         )`,
        [
          contractRevisionId,
          workspaceId,
          contractDigest,
          canonicalizeProviderValue({ type: "object" }),
          canonicalizeProviderValue({ type: "object" }),
          at,
          at,
        ],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId,
        contractRevisionId,
        adapterDefinitionId,
        adapterRevisionId,
        adapterKey: "worker.tool.echo",
        executionTarget: "worker",
        implementationId: implementationRevisionId,
        implementationKey: "worker.tool.echo",
        canonicalDigest: implementationDigest,
        createdAt: at,
      });
      await pool.execute(
        `INSERT INTO capability_binding (
           id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status, priority, version,
           route_policy, created_at, updated_at
         ) VALUES (?, ?, 'worker.tool.echo', ?, ?, 'active', 1, 1, '{}', ?, ?)`,
        [
          bindingId,
          workspaceId,
          contractRevisionId,
          implementationRevisionId,
          at,
          at,
        ],
      );
      store = createBoundedWorkflowOrchestratorStore(pool, {
        ids: {
          next: nextIdentity,
        },
        schemaValidation: {
          validate: expectObjectSchema,
        },
        enabledExecutionTargets: ["worker"],
        maximumTransitionsPerWakeup: 64,
        maximumNodeCreatesPerWakeup: 32,
        cooperativeCancellationGraceMs: 500,
      });
    });

    afterAll(async () => {
      if (pool) {
        await removeFixtures(pool);
        await pool.end();
      }
    });

    it("serializes branch, join, Approval first-decision, output, and duplicate Inbox facts", async () => {
      const createdAt = new Date("2026-07-28T00:10:00.000Z");
      const decisionSchema = {
        type: "object",
        properties: {
          approved: { type: "boolean" },
        },
        required: ["approved"],
      };
      const topology = {
        schemaVersion: 1,
        key: "approval_branch",
        entryNodeKey: "choose",
        limits: {
          maxNodeRuns: 4,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "choose",
            kind: "switch",
            value: {
              $value: {
                source: "workflow_input",
                pointer: "/path",
              },
            },
            cases: [
              {
                when: {
                  operator: "equals",
                  value: "left",
                },
                next: ["left"],
              },
            ],
            defaultNext: ["right"],
          },
          {
            key: "left",
            kind: "approval",
            request: {
              side: "left",
            },
            decisionSchema,
            next: ["join"],
          },
          {
            key: "right",
            kind: "approval",
            request: {
              side: "right",
            },
            decisionSchema,
            next: ["join"],
          },
          {
            key: "join",
            kind: "approval",
            joinPolicy: "all_success",
            request: {
              side: "join",
            },
            decisionSchema,
            next: [],
          },
        ],
        outputs: {
          left_decision: {
            required: true,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "left",
                scope: "root",
                pointer: "",
              },
            },
          },
          right_decision: {
            required: false,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "right",
                scope: "root",
                pointer: "",
              },
            },
          },
        },
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "approval_branch",
        topology,
        input: {
          path: "left",
        },
        createdAt,
      });
      const first = await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      expect(first).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        value: {
          lifecycleStatus: "waiting",
        },
      });
      const [initialRunRows] = await pool.execute<
        ({ readonly version: number } & RowDataPacket)[]
      >("SELECT version FROM workflow_run WHERE id = ?", [
        fixture.workflowRunId,
      ]);
      const initialVersion = initialRunRows[0]?.version;
      const duplicate = await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 101),
      );
      expect(duplicate.deliveryStatus).toBe("duplicate");
      const [duplicateRunRows] = await pool.execute<
        ({ readonly version: number } & RowDataPacket)[]
      >("SELECT version FROM workflow_run WHERE id = ?", [
        fixture.workflowRunId,
      ]);
      expect(duplicateRunRows[0]?.version).toBe(initialVersion);

      const rightNodeId = fixture.nodeIdsByKey.get("right");
      const leftNodeId = fixture.nodeIdsByKey.get("left");
      if (!rightNodeId || !leftNodeId) {
        throw new Error("Missing branch node fixture.");
      }
      const [branchRows] = await pool.execute<
        ({
          readonly nodeKey: string;
          readonly lifecycleStatus: string;
          readonly terminalReasonCode: string | null;
        } & RowDataPacket)[]
      >(
        `SELECT
           node_key AS nodeKey,
           lifecycle_status AS lifecycleStatus,
           terminal_reason_code AS terminalReasonCode
         FROM node_run
         WHERE workflow_run_id = ?
         ORDER BY node_key`,
        [fixture.workflowRunId],
      );
      expect(branchRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeKey: "choose",
            lifecycleStatus: "completed",
          }),
          expect.objectContaining({
            nodeKey: "left",
            lifecycleStatus: "waiting",
          }),
          expect.objectContaining({
            nodeKey: "right",
            lifecycleStatus: "skipped",
            terminalReasonCode: "workflow.branch_not_selected",
          }),
        ]),
      );
      const [factCountRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(*) FROM workflow_switch_decision
             WHERE workflow_run_id = ?) AS switchCount,
           (SELECT COUNT(*) FROM workflow_deadline_schedule
             WHERE workflow_run_id = ?) AS deadlineCount`,
        [fixture.workflowRunId, fixture.workflowRunId],
      );
      expect(Number(factCountRows[0]?.switchCount ?? 0)).toBe(1);
      expect(Number(factCountRows[0]?.deadlineCount ?? 0)).toBe(1);
      const [originalSwitchFacts] = await pool.execute<RowDataPacket[]>(
        "SELECT * FROM workflow_switch_decision WHERE workflow_run_id = ?",
        [fixture.workflowRunId],
      );

      const leftApproval = await loadApproval(
        pool,
        fixture.workflowRunId,
        leftNodeId,
      );
      const decisionAt = new Date(createdAt.getTime() + 1_000);
      const revokedAuthorityDecision = approvalDecisionOptions(leftApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: { approved: true },
        now: decisionAt,
      });
      await pool.execute(
        `UPDATE workspace_membership
         SET status = 'revoked'
         WHERE id = ?`,
        [membershipId],
      );
      try {
        await expect(
          store.decideApproval(revokedAuthorityDecision),
        ).rejects.toMatchObject({
          code: "workflow.v1.approval_authorization_invalid",
        });
      } finally {
        await pool.execute(
          `UPDATE workspace_membership
           SET status = 'active'
           WHERE id = ?`,
          [membershipId],
        );
      }
      const staleAuthorityDecision = approvalDecisionOptions(leftApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: { approved: true },
        now: decisionAt,
      });
      await pool.execute(
        `UPDATE workspace_membership
         SET version = 2
         WHERE id = ?`,
        [membershipId],
      );
      try {
        await expect(
          store.decideApproval(staleAuthorityDecision),
        ).rejects.toMatchObject({
          code: "workflow.v1.approval_authorization_invalid",
        });
      } finally {
        await pool.execute(
          `UPDATE workspace_membership
           SET version = 1
           WHERE id = ?`,
          [membershipId],
        );
      }
      const invalidDecision = approvalDecisionOptions(leftApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: { approved: "yes" },
        now: decisionAt,
      });
      await expect(store.decideApproval(invalidDecision)).rejects.toMatchObject(
        {
          code: "workflow.v1.approval_decision_invalid",
        },
      );
      const [invalidDecisionRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id
         FROM workflow_approval_decision
         WHERE approval_request_id = ?`,
        [leftApproval.id],
      );
      expect(invalidDecisionRows).toHaveLength(0);
      const candidateA = approvalDecisionOptions(leftApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: {
          approved: true,
          winner: "A",
        },
        now: decisionAt,
      });
      const candidateB = approvalDecisionOptions(leftApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: {
          approved: true,
          winner: "B",
        },
        now: decisionAt,
      });
      const arbitration = await Promise.all([
        store.decideApproval(candidateA),
        store.decideApproval(candidateB),
      ]);
      expect(arbitration.map(({ status }) => status).sort()).toEqual([
        "conflict",
        "recorded",
      ]);
      const winner =
        arbitration[0]?.status === "recorded" ? candidateA : candidateB;
      const loser = winner === candidateA ? candidateB : candidateA;
      await expect(store.decideApproval(winner)).resolves.toMatchObject({
        status: "replayed",
      });
      await expect(
        store.decideApproval({
          ...winner,
          decisionId: nextIdentity(),
          outboxEventId: nextIdentity(),
        }),
      ).resolves.toMatchObject({
        status: "replayed",
        decisionId: winner.decisionId,
      });
      await expect(store.decideApproval(loser)).resolves.toMatchObject({
        status: "conflict",
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        winner.outboxEventId,
        new Date(decisionAt.getTime() + 100),
      );

      const joinNodeId = fixture.nodeIdsByKey.get("join");
      if (!joinNodeId) {
        throw new Error("Missing join node fixture.");
      }
      const joinApproval = await loadApproval(
        pool,
        fixture.workflowRunId,
        joinNodeId,
      );
      const joinDecision = approvalDecisionOptions(joinApproval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: {
          approved: true,
        },
        now: new Date(decisionAt.getTime() + 1_000),
      });
      await expect(store.decideApproval(joinDecision)).resolves.toMatchObject({
        status: "recorded",
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        joinDecision.outboxEventId,
        new Date(decisionAt.getTime() + 1_100),
      );
      const [runRows] = await pool.execute<
        ({
          readonly lifecycleStatus: string;
          readonly outcome: string;
          readonly output: unknown;
        } & RowDataPacket)[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           outcome,
           output
         FROM workflow_run
         WHERE id = ?`,
        [fixture.workflowRunId],
      );
      expect(runRows[0]).toMatchObject({
        lifecycleStatus: "completed",
        outcome: "partial_success",
      });
      const output = parseJson(runRows[0]?.output);
      expect(output).toMatchObject({
        left_decision: {
          approved: true,
        },
      });
      const [outputRows] = await pool.execute<
        ({
          readonly outputKey: string;
          readonly resolutionStatus: string;
        } & RowDataPacket)[]
      >(
        `SELECT
           output_key AS outputKey,
           resolution_status AS resolutionStatus
         FROM workflow_output_fact
         WHERE workflow_run_id = ?
         ORDER BY output_key`,
        [fixture.workflowRunId],
      );
      expect(outputRows).toEqual([
        expect.objectContaining({
          outputKey: "left_decision",
          resolutionStatus: "resolved",
        }),
        expect.objectContaining({
          outputKey: "right_decision",
          resolutionStatus: "invalid",
        }),
      ]);
      const [retainedSwitchFacts] = await pool.execute<RowDataPacket[]>(
        "SELECT * FROM workflow_switch_decision WHERE workflow_run_id = ?",
        [fixture.workflowRunId],
      );
      expect(retainedSwitchFacts).toEqual(originalSwitchFacts);
    });

    it("ends a default rejected gate without dispatching its guarded Capability", async () => {
      const createdAt = new Date("2026-07-28T00:15:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "default_approval_gate",
        entryNodeKey: "review",
        limits: {
          maxNodeRuns: 3,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "review",
            kind: "approval",
            request: { title: "Review before generation" },
            decisionSchema: {
              type: "object",
              properties: { approved: { type: "boolean" } },
              required: ["approved"],
            },
            next: ["review_outcome"],
          },
          {
            key: "review_outcome",
            kind: "switch",
            value: {
              $value: {
                source: "node_output",
                nodeKey: "review",
                scope: "root",
                pointer: "/approved",
              },
            },
            cases: [
              {
                when: { operator: "equals", value: true },
                next: ["expensive_generation"],
              },
            ],
            defaultNext: [],
          },
          {
            key: "expensive_generation",
            kind: "invoke",
            capability: {
              contractId: "tool.echo",
              revision: 1,
              canonicalDigest: contractDigest,
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "default_approval_gate",
        topology,
        routes: [workerRoute("expensive_generation")],
        input: {},
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const reviewNodeId = fixture.nodeIdsByKey.get("review");
      if (!reviewNodeId) throw new Error("Missing review node fixture.");
      const approval = await loadApproval(
        pool,
        fixture.workflowRunId,
        reviewNodeId,
      );
      const decision = approvalDecisionOptions(approval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: { approved: false },
        now: new Date(createdAt.getTime() + 1_000),
      });
      await expect(store.decideApproval(decision)).resolves.toMatchObject({
        status: "recorded",
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        decision.outboxEventId,
        new Date(createdAt.getTime() + 1_100),
      );
      const [dispatchRows] = await pool.execute<RowDataPacket[]>(
        `SELECT capability.id
         FROM capability_run AS capability
         INNER JOIN node_run AS node
           ON node.id = capability.node_run_id
          AND node.workspace_id = capability.workspace_id
         WHERE node.workflow_run_id = ?`,
        [fixture.workflowRunId],
      );
      expect(dispatchRows).toHaveLength(0);
      const [runRows] = await pool.execute<
        ({ readonly lifecycleStatus: string } & RowDataPacket)[]
      >(
        `SELECT lifecycle_status AS lifecycleStatus
         FROM workflow_run
         WHERE id = ?`,
        [fixture.workflowRunId],
      );
      expect(runRows[0]?.lifecycleStatus).toBe("completed");
    });

    it("expires a pending approval without recording a late decision", async () => {
      const createdAt = new Date("2026-07-28T00:17:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "expired_approval",
        entryNodeKey: "review",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 1_000,
        },
        nodes: [
          {
            key: "review",
            kind: "approval",
            request: { title: "Review before expiry" },
            decisionSchema: {
              type: "object",
              properties: { approved: { type: "boolean" } },
              required: ["approved"],
            },
            next: [],
          },
        ],
        outputs: {},
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "expired_approval",
        topology,
        input: {},
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const reviewNodeId = fixture.nodeIdsByKey.get("review");
      if (!reviewNodeId) throw new Error("Missing review node fixture.");
      const approval = await loadApproval(
        pool,
        fixture.workflowRunId,
        reviewNodeId,
      );
      const lateDecision = approvalDecisionOptions(approval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: { approved: true },
        now: new Date(createdAt.getTime() + 1_000),
      });

      await expect(store.decideApproval(lateDecision)).resolves.toMatchObject({
        status: "no_progress",
        reason: "expired",
      });
      const [decisionRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id
         FROM workflow_approval_decision
         WHERE approval_request_id = ?`,
        [approval.id],
      );
      expect(decisionRows).toHaveLength(0);
      const [stateRows] = await pool.execute<
        ({ readonly lifecycleStatus: string } & RowDataPacket)[]
      >(
        `SELECT lifecycle_status AS lifecycleStatus
         FROM workflow_approval_state
         WHERE approval_request_id = ?`,
        [approval.id],
      );
      expect(stateRows[0]?.lifecycleStatus).toBe("expired");
    });

    it("propagates one immutable deadline to every active Capability and converges the Run", async () => {
      const createdAt = new Date("2026-07-28T00:20:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "deadline_parallel",
        entryNodeKey: "fanout",
        limits: {
          maxNodeRuns: 3,
          timeoutMs: 1_000,
        },
        nodes: [
          {
            key: "fanout",
            kind: "switch",
            value: true,
            cases: [
              {
                when: {
                  operator: "equals",
                  value: true,
                },
                next: ["first", "second"],
              },
            ],
            defaultNext: ["first"],
          },
          {
            key: "first",
            kind: "invoke",
            capability: {
              contractId: "tool.echo",
              revision: 1,
              canonicalDigest: contractDigest,
            },
            input: {
              key: "first",
            },
            next: [],
          },
          {
            key: "second",
            kind: "invoke",
            capability: {
              contractId: "tool.echo",
              revision: 1,
              canonicalDigest: contractDigest,
            },
            input: {
              key: "second",
            },
            next: [],
          },
        ],
        outputs: {},
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "deadline_parallel",
        topology,
        routes: [workerRoute("first"), workerRoute("second")],
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const capabilities = await loadCapabilityFacts(
        pool,
        fixture.workflowRunId,
      );
      expect(capabilities).toHaveLength(2);
      const [deadlineRows] = await pool.execute<
        ({
          readonly id: string;
          readonly outboxEventId: string;
          readonly executionDeadlineAt: Date;
        } & RowDataPacket)[]
      >(
        `SELECT
           id,
           outbox_event_id AS outboxEventId,
           execution_deadline_at AS executionDeadlineAt
         FROM workflow_deadline_schedule
         WHERE workflow_run_id = ?`,
        [fixture.workflowRunId],
      );
      expect(deadlineRows).toHaveLength(1);
      expect(deadlineRows[0]?.executionDeadlineAt).toEqual(fixture.deadlineAt);
      const deadlineEventId = deadlineRows[0]?.outboxEventId;
      if (!deadlineEventId) {
        throw new Error("Missing deadline OutboxEvent.");
      }
      const deadlineResult = await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        deadlineEventId,
        fixture.deadlineAt,
      );
      expect(deadlineResult).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        value: {
          lifecycleStatus: "cancelling",
        },
      });
      const [propagationRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(*) FROM workflow_capability_cancellation_request
             WHERE workflow_run_id = ?) AS requestCount,
           (SELECT COUNT(*) FROM capability_run AS capability
             INNER JOIN node_run AS node ON node.id = capability.node_run_id
             WHERE node.workflow_run_id = ?
               AND capability.cancel_requested_at IS NOT NULL
               AND capability.cancel_deadline_at IS NOT NULL) AS runCount,
           (SELECT COUNT(*) FROM capability_attempt AS attempt
             INNER JOIN capability_run AS capability
               ON capability.id = attempt.capability_run_id
             INNER JOIN node_run AS node ON node.id = capability.node_run_id
             WHERE node.workflow_run_id = ?
               AND attempt.cancel_requested_at IS NOT NULL
               AND attempt.cancel_deadline_at IS NOT NULL) AS attemptCount,
           (SELECT COUNT(*) FROM workflow_deadline_schedule
             WHERE workflow_run_id = ?) AS scheduleCount`,
        [
          fixture.workflowRunId,
          fixture.workflowRunId,
          fixture.workflowRunId,
          fixture.workflowRunId,
        ],
      );
      expect(Number(propagationRows[0]?.requestCount ?? 0)).toBe(2);
      expect(Number(propagationRows[0]?.runCount ?? 0)).toBe(2);
      expect(Number(propagationRows[0]?.attemptCount ?? 0)).toBe(2);
      expect(Number(propagationRows[0]?.scheduleCount ?? 0)).toBe(1);
      const duplicateDeadline = await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        deadlineEventId,
        new Date(fixture.deadlineAt.getTime() + 1),
      );
      expect(duplicateDeadline.deliveryStatus).toBe("duplicate");

      const refreshedCapabilities = await loadCapabilityFacts(
        pool,
        fixture.workflowRunId,
      );
      const connection = await pool.getConnection();
      let terminalEventId: string | undefined;
      try {
        await connection.beginTransaction();
        for (const [index, fact] of refreshedCapabilities.entries()) {
          const event = await settleCapability(
            connection,
            fact,
            "cancelled",
            new Date(fixture.deadlineAt.getTime() + 100 + index),
          );
          terminalEventId ??= event.eventId;
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      if (!terminalEventId) {
        throw new Error("Missing terminal Capability event.");
      }
      const converged = await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        terminalEventId,
        new Date(fixture.deadlineAt.getTime() + 200),
      );
      expect(converged).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        value: {
          lifecycleStatus: "cancelled",
        },
      });
      const [runRows] = await pool.execute<
        ({
          readonly lifecycleStatus: string;
          readonly terminalReasonCode: string;
        } & RowDataPacket)[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           terminal_reason_code AS terminalReasonCode
         FROM workflow_run
         WHERE id = ?`,
        [fixture.workflowRunId],
      );
      expect(runRows[0]).toMatchObject({
        lifecycleStatus: "cancelled",
        terminalReasonCode: "workflow.timeout",
      });
      const [nodeRows] = await pool.execute<
        ({
          readonly nodeKey: string;
          readonly lifecycleStatus: string;
        } & RowDataPacket)[]
      >(
        `SELECT
           node_key AS nodeKey,
           lifecycle_status AS lifecycleStatus
         FROM node_run
         WHERE workflow_run_id = ?
         ORDER BY node_key`,
        [fixture.workflowRunId],
      );
      expect(
        nodeRows
          .filter(({ nodeKey }) => nodeKey !== "fanout")
          .map(({ lifecycleStatus }) => lifecycleStatus),
      ).toEqual(["cancelled", "cancelled"]);
    });

    it("stops a fail-fast Map without creating more work and cooperatively cancels active items", async () => {
      const createdAt = new Date("2026-07-28T00:30:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "map_fail_fast",
        entryNodeKey: "items",
        limits: {
          maxNodeRuns: 4,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "items",
            kind: "map",
            items: [
              {
                id: "item-a",
                value: 1,
              },
              {
                id: "item-b",
                value: 2,
              },
              {
                id: "item-c",
                value: 3,
              },
            ],
            scopeKey: {
              $value: {
                source: "map_item",
                pointer: "/id",
              },
            },
            maxItems: 3,
            maxConcurrency: 2,
            failureMode: "fail_fast",
            invoke: {
              capability: {
                contractId: "tool.echo",
                revision: 1,
                canonicalDigest: contractDigest,
              },
              input: {
                $value: {
                  source: "map_item",
                  pointer: "",
                },
              },
            },
            next: [],
          },
        ],
        outputs: {},
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "map_fail_fast",
        topology,
        routes: [workerRoute("items")],
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const initialCapabilities = await loadCapabilityFacts(
        pool,
        fixture.workflowRunId,
      );
      expect(initialCapabilities.map(({ scopeKey }) => scopeKey)).toEqual([
        "item-a",
        "item-b",
      ]);
      const connection = await pool.getConnection();
      let failureEventId: string;
      try {
        await connection.beginTransaction();
        const failed = initialCapabilities[0];
        if (!failed) {
          throw new Error("Missing first Map item.");
        }
        failureEventId = (
          await settleCapability(
            connection,
            failed,
            "failed",
            new Date(createdAt.getTime() + 1_000),
          )
        ).eventId;
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        failureEventId,
        new Date(createdAt.getTime() + 1_100),
      );
      const [stoppingRows] = await pool.execute<
        ({
          readonly lifecycleStatus: string;
          readonly nextItemIndex: number;
          readonly activeCount: number;
          readonly failedCount: number;
        } & RowDataPacket)[]
      >(
        `SELECT
           state.lifecycle_status AS lifecycleStatus,
           state.next_item_index AS nextItemIndex,
           state.active_count AS activeCount,
           state.failed_count AS failedCount
         FROM workflow_map_state AS state
         INNER JOIN workflow_map_expansion AS expansion
           ON expansion.id = state.map_expansion_id
         WHERE expansion.workflow_run_id = ?`,
        [fixture.workflowRunId],
      );
      expect(stoppingRows[0]).toMatchObject({
        lifecycleStatus: "fail_fast_stopping",
        nextItemIndex: 2,
        activeCount: 1,
        failedCount: 1,
      });
      const [cancelRows] = await pool.execute<
        ({
          readonly sourceKind: string;
          readonly scopeKey: string;
        } & RowDataPacket)[]
      >(
        `SELECT
           request.source_kind AS sourceKind,
           node.scope_key AS scopeKey
         FROM workflow_capability_cancellation_request AS request
         INNER JOIN capability_run AS capability
           ON capability.id = request.capability_run_id
         INNER JOIN node_run AS node
           ON node.id = capability.node_run_id
         WHERE request.workflow_run_id = ?`,
        [fixture.workflowRunId],
      );
      expect(cancelRows).toEqual([
        expect.objectContaining({
          sourceKind: "map_fail_fast",
          scopeKey: "item-b",
        }),
      ]);
      const stoppingCapabilities = await loadCapabilityFacts(
        pool,
        fixture.workflowRunId,
      );
      const active = stoppingCapabilities.find(
        ({ scopeKey }) => scopeKey === "item-b",
      );
      if (!active) {
        throw new Error("Missing active Map item.");
      }
      const cancellationConnection = await pool.getConnection();
      let cancellationEventId: string;
      try {
        await cancellationConnection.beginTransaction();
        cancellationEventId = (
          await settleCapability(
            cancellationConnection,
            active,
            "cancelled",
            new Date(createdAt.getTime() + 1_200),
          )
        ).eventId;
        await cancellationConnection.commit();
      } catch (error) {
        await cancellationConnection.rollback();
        throw error;
      } finally {
        cancellationConnection.release();
      }
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        cancellationEventId,
        new Date(createdAt.getTime() + 1_300),
      );
      const [terminalRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           run.lifecycle_status AS runStatus,
           run.outcome,
           coordinator.lifecycle_status AS coordinatorStatus,
           state.lifecycle_status AS mapStatus,
           state.next_item_index AS nextItemIndex,
           (SELECT COUNT(*) FROM workflow_map_item AS item
             WHERE item.workflow_run_id = run.id) AS itemCount
         FROM workflow_run AS run
         INNER JOIN node_run AS coordinator
           ON coordinator.workflow_run_id = run.id
          AND coordinator.scope_key = 'root'
         INNER JOIN workflow_map_expansion AS expansion
           ON expansion.coordinator_node_run_id = coordinator.id
         INNER JOIN workflow_map_state AS state
           ON state.map_expansion_id = expansion.id
         WHERE run.id = ?`,
        [fixture.workflowRunId],
      );
      expect(terminalRows[0]).toMatchObject({
        runStatus: "completed",
        outcome: "partial_success",
        coordinatorStatus: "failed",
        mapStatus: "failed",
        nextItemIndex: 2,
        itemCount: 2,
      });
    });

    it("collects every Map item in stable order after a partial failure", async () => {
      const createdAt = new Date("2026-07-28T00:35:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "map_collect_all",
        entryNodeKey: "items",
        limits: {
          maxNodeRuns: 4,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "items",
            kind: "map",
            items: [
              {
                id: "item-a",
                value: 1,
              },
              {
                id: "item-b",
                value: 2,
              },
              {
                id: "item-c",
                value: 3,
              },
            ],
            scopeKey: {
              $value: {
                source: "map_item",
                pointer: "/id",
              },
            },
            maxItems: 3,
            maxConcurrency: 2,
            failureMode: "collect_all",
            invoke: {
              capability: {
                contractId: "tool.echo",
                revision: 1,
                canonicalDigest: contractDigest,
              },
              input: {
                $value: {
                  source: "map_item",
                  pointer: "",
                },
              },
            },
            next: [],
          },
        ],
        outputs: {
          batch: {
            required: true,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "items",
                scope: "root",
                pointer: "",
              },
            },
          },
        },
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "map_collect_all",
        topology,
        routes: [workerRoute("items")],
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const firstWave = await loadCapabilityFacts(pool, fixture.workflowRunId);
      expect(firstWave.map(({ scopeKey }) => scopeKey)).toEqual([
        "item-a",
        "item-b",
      ]);
      const firstConnection = await pool.getConnection();
      let firstEventId: string;
      try {
        await firstConnection.beginTransaction();
        const first = firstWave[0];
        const second = firstWave[1];
        if (!first || !second) {
          throw new Error("Missing collect-all first wave.");
        }
        firstEventId = (
          await settleCapability(
            firstConnection,
            first,
            "completed",
            new Date(createdAt.getTime() + 1_000),
            {
              value: 1,
            },
          )
        ).eventId;
        await settleCapability(
          firstConnection,
          second,
          "failed",
          new Date(createdAt.getTime() + 1_001),
        );
        await firstConnection.commit();
      } catch (error) {
        await firstConnection.rollback();
        throw error;
      } finally {
        firstConnection.release();
      }
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        firstEventId,
        new Date(createdAt.getTime() + 1_100),
      );
      const secondWave = await loadCapabilityFacts(pool, fixture.workflowRunId);
      expect(secondWave.map(({ scopeKey }) => scopeKey)).toEqual([
        "item-a",
        "item-b",
        "item-c",
      ]);
      const third = secondWave.find(({ scopeKey }) => scopeKey === "item-c");
      if (!third) {
        throw new Error("Collect-all did not create the third item.");
      }
      const secondConnection = await pool.getConnection();
      let thirdEventId: string;
      try {
        await secondConnection.beginTransaction();
        thirdEventId = (
          await settleCapability(
            secondConnection,
            third,
            "completed",
            new Date(createdAt.getTime() + 1_200),
            {
              value: 3,
            },
          )
        ).eventId;
        await secondConnection.commit();
      } catch (error) {
        await secondConnection.rollback();
        throw error;
      } finally {
        secondConnection.release();
      }
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        thirdEventId,
        new Date(createdAt.getTime() + 1_300),
      );
      const [rows] = await pool.execute<
        ({
          readonly lifecycleStatus: string;
          readonly outcome: string;
          readonly runOutput: unknown;
          readonly coordinatorOutput: unknown;
        } & RowDataPacket)[]
      >(
        `SELECT
           run.lifecycle_status AS lifecycleStatus,
           run.outcome,
           run.output AS runOutput,
           coordinator.output AS coordinatorOutput
         FROM workflow_run AS run
         INNER JOIN node_run AS coordinator
           ON coordinator.workflow_run_id = run.id
          AND coordinator.scope_key = 'root'
         WHERE run.id = ?`,
        [fixture.workflowRunId],
      );
      expect(rows[0]).toMatchObject({
        lifecycleStatus: "completed",
        outcome: "partial_success",
      });
      const coordinatorOutput = parseJson(rows[0]?.coordinatorOutput) as {
        readonly items?: readonly {
          readonly scopeKey?: string;
          readonly status?: string;
        }[];
        readonly summary?: Readonly<Record<string, number>>;
      };
      expect(
        coordinatorOutput.items?.map(({ scopeKey, status }) => ({
          scopeKey,
          status,
        })),
      ).toEqual([
        {
          scopeKey: "item-a",
          status: "completed",
        },
        {
          scopeKey: "item-b",
          status: "failed",
        },
        {
          scopeKey: "item-c",
          status: "completed",
        },
      ]);
      expect(coordinatorOutput.summary).toMatchObject({
        total: 3,
        completed: 2,
        failed: 1,
        cancelled: 0,
        skipped: 0,
      });
      expect(parseJson(rows[0]?.runOutput)).toMatchObject({
        batch: {
          summary: {
            total: 3,
            completed: 2,
            failed: 1,
          },
        },
      });
    });

    it("persists resolved output facts but fails closed when the Run output schema rejects them", async () => {
      const createdAt = new Date("2026-07-28T00:37:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "output_schema_invalid",
        entryNodeKey: "approval",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "approval",
            kind: "approval",
            request: {
              purpose: "schema-test",
            },
            decisionSchema: {
              type: "object",
            },
            next: [],
          },
        ],
        outputs: {
          decision: {
            required: true,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "approval",
                scope: "root",
                pointer: "",
              },
            },
          },
        },
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "output_schema_invalid",
        topology,
        outputSchema: {
          type: "object",
          required: ["must_exist"],
        },
        createdAt,
      });
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      const nodeRunId = fixture.nodeIdsByKey.get("approval");
      if (!nodeRunId) {
        throw new Error("Missing output schema Approval node.");
      }
      const approval = await loadApproval(
        pool,
        fixture.workflowRunId,
        nodeRunId,
      );
      const decision = approvalDecisionOptions(approval, {
        decisionId: nextIdentity(),
        outboxEventId: nextIdentity(),
        decision: {
          approved: true,
        },
        now: new Date(createdAt.getTime() + 1_000),
      });
      await store.decideApproval(decision);
      await consumeEvent(
        pool,
        store,
        fixture.workflowRunId,
        decision.outboxEventId,
        new Date(createdAt.getTime() + 1_100),
      );
      const [runRows] = await pool.execute<
        ({
          readonly lifecycleStatus: string;
          readonly outcome: string;
          readonly terminalReasonCode: string;
          readonly output: unknown;
        } & RowDataPacket)[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           outcome,
           terminal_reason_code AS terminalReasonCode,
           output
         FROM workflow_run
         WHERE id = ?`,
        [fixture.workflowRunId],
      );
      expect(runRows[0]).toMatchObject({
        lifecycleStatus: "failed",
        outcome: "no_usable_output",
        terminalReasonCode: "workflow.output_schema_invalid",
        output: null,
      });
      const [factRows] = await pool.execute<
        ({
          readonly resolutionStatus: string;
          readonly value: unknown;
        } & RowDataPacket)[]
      >(
        `SELECT
           resolution_status AS resolutionStatus,
           value
         FROM workflow_output_fact
         WHERE workflow_run_id = ?
           AND output_key = 'decision'`,
        [fixture.workflowRunId],
      );
      expect(factRows[0]?.resolutionStatus).toBe("resolved");
      expect(parseJson(factRows[0]?.value)).toEqual({
        approved: true,
      });
    });

    it("persists a durable continuation at a one-transition budget and never bumps a waiting no-op", async () => {
      const createdAt = new Date("2026-07-28T00:40:00.000Z");
      const topology = {
        schemaVersion: 1,
        key: "transition_budget",
        entryNodeKey: "approval",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "approval",
            kind: "approval",
            request: {
              reason: "bounded",
            },
            decisionSchema: {
              type: "object",
            },
            next: [],
          },
        ],
        outputs: {},
      } satisfies WorkflowTopologyV1;
      const fixture = await seedWorkflow(pool, {
        key: "transition_budget",
        topology,
        createdAt,
      });
      const boundedStore = createBoundedWorkflowOrchestratorStore(pool, {
        ids: {
          next: nextIdentity,
        },
        schemaValidation: {
          validate: expectObjectSchema,
        },
        enabledExecutionTargets: ["worker"],
        maximumTransitionsPerWakeup: 1,
        maximumNodeCreatesPerWakeup: 1,
        continuationDelayMs: 0,
      });
      let result = await consumeEvent(
        pool,
        boundedStore,
        fixture.workflowRunId,
        fixture.initialEventId,
        new Date(createdAt.getTime() + 100),
      );
      expect(result).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        value: {
          transitions: 1,
          continuationScheduled: true,
        },
      });

      for (let index = 0; index < 4; index += 1) {
        const [continuationRows] = await pool.execute<
          ({ readonly eventId: string } & RowDataPacket)[]
        >(
          `SELECT event.id AS eventId
           FROM outbox_event AS event
           LEFT JOIN inbox_receipt AS receipt
             ON receipt.event_id = event.id
            AND receipt.consumer_name = 'workflow-v1-integration'
           WHERE event.workspace_id = ?
             AND event.aggregate_type = 'workflow_run'
             AND event.aggregate_id = ?
             AND event.message_type = 'workflow.wakeup.requested'
             AND JSON_UNQUOTE(
               JSON_EXTRACT(event.payload, '$.cause')
             ) = 'workflow.frontier_continuation'
             AND receipt.event_id IS NULL
           ORDER BY event.created_at, event.id
           LIMIT 1`,
          [workspaceId, fixture.workflowRunId],
        );
        const continuationEventId = continuationRows[0]?.eventId;
        if (!continuationEventId) {
          break;
        }
        result = await consumeEvent(
          pool,
          boundedStore,
          fixture.workflowRunId,
          continuationEventId,
          new Date(createdAt.getTime() + 200 + index),
        );
        if (result.deliveryStatus === "processed") {
          expect(result.value.transitions).toBeLessThanOrEqual(1);
        }
      }
      expect(result).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        value: {
          transitions: 1,
          continuationScheduled: false,
          lifecycleStatus: "waiting",
        },
      });
      const [beforeNoopRows] = await pool.execute<
        ({ readonly version: number } & RowDataPacket)[]
      >("SELECT version FROM workflow_run WHERE id = ?", [
        fixture.workflowRunId,
      ]);
      const beforeNoopVersion = beforeNoopRows[0]?.version;
      if (beforeNoopVersion === undefined) {
        throw new Error("Missing bounded WorkflowRun.");
      }
      const noopEventId = nextIdentity();
      const noopAt = new Date(createdAt.getTime() + 1_000);
      await pool.execute(
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
           ?, ?, 'workflow.wakeup.requested', 1, 'workflow_run', ?, ?,
           ?, 'pending', ?, 0, ?
         )`,
        [
          noopEventId,
          workspaceId,
          fixture.workflowRunId,
          beforeNoopVersion,
          canonicalizeProviderValue({
            workflowRunId: fixture.workflowRunId,
            expectedGeneration: 1,
            cause: "workflow.integration_noop",
          }),
          noopAt,
          noopAt,
        ],
      );
      const noop = await consumeEvent(
        pool,
        boundedStore,
        fixture.workflowRunId,
        noopEventId,
        noopAt,
      );
      expect(noop).toMatchObject({
        deliveryStatus: "processed",
        outcome: "noop",
        resultCode: "workflow.v1.frontier_waiting",
        value: {
          transitions: 0,
          continuationScheduled: false,
          lifecycleStatus: "waiting",
        },
      });
      const [afterNoopRows] = await pool.execute<
        ({ readonly version: number } & RowDataPacket)[]
      >("SELECT version FROM workflow_run WHERE id = ?", [
        fixture.workflowRunId,
      ]);
      expect(afterNoopRows[0]?.version).toBe(beforeNoopVersion);
      const [scheduleRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
         FROM workflow_deadline_schedule
         WHERE workflow_run_id = ?`,
        [fixture.workflowRunId],
      );
      expect(Number(scheduleRows[0]?.count ?? 0)).toBe(1);
    });
  },
);
