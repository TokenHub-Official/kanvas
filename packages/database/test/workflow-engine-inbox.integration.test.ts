import {
  createLibraryConsumerAccessStore,
  retainLibraryConsumerAuthority,
} from "../src/runtime/library-consumer-access.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
import { createStorageUploadStore } from "../src/runtime/storage-upload-store.js";
import { createContentTransferStore } from "../src/runtime/content-transfer-store.js";
import { createRuntimeConfigurationStore } from "../src/runtime/runtime-configuration-store.js";
import {
  createProviderResultRecoveryStore,
  authorizeRecoveryCommit,
} from "../src/runtime/provider-result-recovery-store.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import {
  consumeInboxEvent,
  type InboxConsumptionResult,
  type InboxDelivery,
} from "../src/runtime/inbox-receipt.js";
import { createAttemptFailureStore } from "../src/runtime/attempt-failure-store.js";
import {
  createWorkflowEngineStore,
  type StartWorkflowResult,
} from "../src/runtime/workflow-engine-store.js";
import { createProviderInvocationStore } from "../src/runtime/provider-invocation-store.js";
import { createCapabilityRunStore } from "../src/runtime/capability-run-store.js";
import { createOperationalTimelineStore } from "../src/runtime/operational-timeline-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import {
  assertDisposableIntegrationDatabaseName,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const jsonDigest = digestProviderValue;

const ids = Object.freeze({
  workspace: identity(9_000_001),
  actor: identity(9_000_002),
  contract: identity(9_000_003),
  implementation: identity(9_000_004),
  binding: identity(9_000_005),
  workflowRevision: identity(9_000_006),
  browserImplementation: identity(9_000_007),
  browserBinding: identity(9_000_008),
  providerImplementation: identity(9_000_009),
  providerBinding: identity(9_000_010),
  workerAdapterDefinition: identity(9_000_011),
  workerAdapterRevision: identity(9_000_012),
  browserAdapterDefinition: identity(9_000_013),
  browserAdapterRevision: identity(9_000_014),
  providerAdapterDefinition: identity(9_000_015),
  providerAdapterRevision: identity(9_000_016),

  raceWorkflow: identity(9_100_001),
  raceNode: identity(9_100_002),
  raceWakeup: identity(9_100_003),
  raceCapability: identity(9_100_004),
  raceAttempt: identity(9_100_005),
  raceDispatch: identity(9_100_006),
  raceFailureNextAttempt: identity(9_100_007),
  raceFailureDispatch: identity(9_100_008),

  envelopeWorkflow: identity(9_200_001),
  envelopeNode: identity(9_200_002),
  envelopeWakeup: identity(9_200_003),
  envelopeCapability: identity(9_200_004),
  envelopeAttempt: identity(9_200_005),
  envelopeDispatch: identity(9_200_006),

  futureWorkflow: identity(9_300_001),
  futureNode: identity(9_300_002),
  futureWakeup: identity(9_300_003),
  futureCapability: identity(9_300_004),
  futureAttempt: identity(9_300_005),
  futureDispatch: identity(9_300_006),

  browserWorkflow: identity(9_400_001),
  browserNode: identity(9_400_002),
  browserWakeup: identity(9_400_003),
  browserCapability: identity(9_400_004),
  browserAttempt: identity(9_400_005),
  browserUnusedDispatch: identity(9_400_006),

  providerWorkflow: identity(9_500_001),
  providerNode: identity(9_500_002),
  providerWakeup: identity(9_500_003),
  providerCapability: identity(9_500_004),
  providerAttempt: identity(9_500_005),
  providerDispatch: identity(9_500_006),
  providerEndpoint: identity(9_500_007),
  providerCredentialIdentity: identity(9_500_008),
  providerModelDeployment: identity(9_500_009),
  providerPricingRevision: identity(9_500_010),
  providerInvocation: identity(9_500_011),
  providerUnknownObservation: identity(9_500_012),
  providerStaleObservation: identity(9_500_013),
  providerSuccessObservation: identity(9_500_014),
  providerTerminalEvent: identity(9_500_015),
  providerCompletion: identity(9_500_016),
  providerSecretVersion: identity(9_500_017),
  providerModelProfile: identity(9_500_018),
  providerBudgetAccount: identity(9_500_019),

  providerCancelWorkflow: identity(9_600_001),
  providerCancelNode: identity(9_600_002),
  providerCancelWakeup: identity(9_600_003),
  providerCancelCapability: identity(9_600_004),
  providerCancelAttempt: identity(9_600_005),
  providerCancelDispatch: identity(9_600_006),
  providerCancelInvocation: identity(9_600_007),
  providerCancelLateObservation: identity(9_600_008),
  providerCancelTerminalEvent: identity(9_600_009),
  providerCancelUnusedLateEvent: identity(9_600_010),
  providerCancelUnusedCompletion: identity(9_600_011),

  providerFailureWorkflow: identity(9_700_001),
  providerFailureNode: identity(9_700_002),
  providerFailureWakeup: identity(9_700_003),
  providerFailureCapability: identity(9_700_004),
  providerFailureAttempt: identity(9_700_005),
  providerFailureDispatch: identity(9_700_006),
  providerFailureInvocation: identity(9_700_007),
  providerFailureObservation: identity(9_700_008),
  providerFailureNextAttempt: identity(9_700_009),
  providerFailureRetryDispatch: identity(9_700_010),
  timelineMembership: identity(9_800_001),

  nodeInputWorkerWorkflow: identity(9_810_001),
  nodeInputWorkerNode: identity(9_810_002),
  nodeInputWorkerWakeup: identity(9_810_003),
  nodeInputWorkerCapability: identity(9_810_004),
  nodeInputWorkerAttempt: identity(9_810_005),
  nodeInputWorkerDispatch: identity(9_810_006),

  nodeInputProviderWorkflow: identity(9_820_001),
  nodeInputProviderNode: identity(9_820_002),
  nodeInputProviderWakeup: identity(9_820_003),
  nodeInputProviderCapability: identity(9_820_004),
  nodeInputProviderAttempt: identity(9_820_005),
  nodeInputProviderDispatch: identity(9_820_006),
  nodeInputProviderInvocation: identity(9_820_007),
});

const fixtureAt = new Date("2026-07-27T19:00:00.000Z");
const executionGeneration = 17;
const contractDigest = digest("a");
const implementationDigest = digest("b");
const retryPolicy = Object.freeze({
  maxAttempts: 3,
  backoff: "fixed",
  initialDelayMs: 0,
  maxDelayMs: 0,
});
const providerCredentialIdentityDigest = digest("3");
const providerRoute = Object.freeze({
  providerProtocolVersion: 1,
  providerKey: "openai",
  apiSurface: "async.jobs.v1",
  providerEndpointId: ids.providerEndpoint,
  credentialIdentityId: ids.providerCredentialIdentity,
  credentialIdentityEpoch: 1,
  modelDeploymentId: ids.providerModelDeployment,
  pricingRevisionId: ids.providerPricingRevision,
  pinnedSecretVersionId: ids.providerSecretVersion,
  credentialIdentityDigest: providerCredentialIdentityDigest,
  instancePolicyRevisionId: identity(9_820_021),
  workspacePolicyRevisionId: identity(9_820_022),
  routePolicyRevisionId: identity(9_820_023),
  modelProfileRevisionId: ids.providerModelProfile,
  budgetAccountId: ids.providerBudgetAccount,
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
  routeCandidateDigest: digest("1"),
  requestScopeDigest: digest("2"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});
const topology = Object.freeze({
  schemaVersion: 1,
  key: "foundation_inbox_engine",
  entryNodeKey: "invoke",
  limits: Object.freeze({ maxNodeRuns: 1, timeoutMs: 300_000 }),
  nodes: [
    {
      key: "invoke",
      kind: "invoke",
      capability: {
        contractId: "foundation.inbox-engine",
        revision: 1,
        canonicalDigest: contractDigest,
      },
      input: Object.freeze({}),
      next: [],
    },
  ],
  outputs: Object.freeze({}),
});
const targetBindings = Object.freeze({
  worker: Object.freeze({
    bindingId: ids.binding,
    implementationRevisionId: ids.implementation,
    implementationDigest,
    adapterKey: "test.inbox-engine",
  }),
  browser: Object.freeze({
    bindingId: ids.browserBinding,
    implementationRevisionId: ids.browserImplementation,
    implementationDigest: digest("f"),
    adapterKey: "test.inbox-engine.browser",
  }),
  provider: Object.freeze({
    bindingId: ids.providerBinding,
    implementationRevisionId: ids.providerImplementation,
    implementationDigest: digest("0"),
    adapterKey: "test.inbox-engine.provider",
  }),
});

const identityInputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", pointer: "" }),
});
const compiledIdentityInputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", path: [] }),
});
const identityOutputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", pointer: "" }),
});
const compiledIdentityOutputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", path: [] }),
});

function runtimeAdapterDocument(
  adapterKey: string,
  executionTarget: "browser" | "provider" | "worker",
) {
  return Object.freeze({
    schemaVersion: "kanvas.runtime-adapter-definition/v1",
    adapterKey,
    revision: 1,
    displayName: Object.freeze({
      defaultLocale: "en-US",
      values: Object.freeze({ "en-US": adapterKey, "zh-CN": adapterKey }),
    }),
    executionTarget,
    sourceKinds: Object.freeze(["plugin"]),
    supportedModelFormats: Object.freeze([]),
    invocationInputSchema: Object.freeze({ type: "object" }),
    invocationOutputSchema: Object.freeze({ type: "object" }),
    configurationSchema: Object.freeze({ type: "object" }),
    artifactInputs: Object.freeze([]),
    executable: Object.freeze({
      kind: "built_in",
      packageKey: "test.inbox-engine",
      packageVersion: "1",
      entrypoint: adapterKey,
      releaseDigest: digest(adapterKey.at(-1) ?? "d"),
    }),
  });
}

function executionPlanFor(
  executionTarget: "browser" | "worker" | "provider",
): Readonly<Record<string, unknown>> {
  const target = targetBindings[executionTarget];
  const providerIdentity =
    executionTarget === "provider"
      ? {
          providerRoute,
        }
      : {};
  return Object.freeze({
    schemaVersion: 1,
    topology,
    routes: [
      {
        nodeKey: "invoke",
        contractRevisionId: ids.contract,
        contractKey: "foundation.inbox-engine",
        contractRevision: 1,
        contractDigest,
        candidates: [
          {
            candidateIndex: 0,
            idempotencyMode: "intrinsic",
            bindingId: target.bindingId,
            bindingVersion: 1,
            implementationRevisionId: target.implementationRevisionId,
            implementationDigest: target.implementationDigest,
            executionTarget,
            adapterKey: target.adapterKey,
            ...providerIdentity,
            retryPolicy,
            attemptTimeoutMs: 300_000,
            fallbackOn: [],
          },
        ],
      },
    ],
  });
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface WorkflowStateRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface NodeStateRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface AttemptStateRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly leaseGeneration: number;
  readonly leaseTokenHash: string | null;
  readonly version: number;
}

interface AttemptTargetRow extends RowDataPacket {
  readonly executionTarget: string;
  readonly implementationRevisionId: string;
}

interface DispatchOutboxRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly schemaVersion: number;
  readonly payload: unknown;
}

interface DatabaseNameRow extends RowDataPacket {
  readonly databaseName: string | null;
}

async function replaceCapabilityInputFacts(
  pool: Pool,
  capabilityRunId: string,
  input: unknown,
  inputDigest: string | null,
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    const [databaseRows] = await connection.query<DatabaseNameRow[]>(
      "SELECT DATABASE() AS databaseName",
    );
    assertDisposableIntegrationDatabaseName(databaseRows[0]?.databaseName);
    // Only the disposable fixture may tamper with persisted input facts. The
    // application must still reject the resulting digest mismatch.
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE capability_run
         SET input = ?, input_digest = ?
         WHERE id = ?`,
      [JSON.stringify(input), inputDigest, capabilityRunId],
    );
    if (updated.affectedRows !== 1) {
      throw new Error(
        "Capability Run input corruption fixture was not applied.",
      );
    }
  } finally {
    connection.release();
  }
}

interface QueuedFixture {
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly wakeupEventId: string;
  readonly aggregateVersion: number;
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object payload.");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

const raceFixture: QueuedFixture = {
  workflowRunId: ids.raceWorkflow,
  nodeRunId: ids.raceNode,
  wakeupEventId: ids.raceWakeup,
  aggregateVersion: 1,
};

const envelopeFixture: QueuedFixture = {
  workflowRunId: ids.envelopeWorkflow,
  nodeRunId: ids.envelopeNode,
  wakeupEventId: ids.envelopeWakeup,
  aggregateVersion: 1,
};

const futureFixture: QueuedFixture = {
  workflowRunId: ids.futureWorkflow,
  nodeRunId: ids.futureNode,
  wakeupEventId: ids.futureWakeup,
  aggregateVersion: 2,
};

const browserFixture: QueuedFixture = {
  workflowRunId: ids.browserWorkflow,
  nodeRunId: ids.browserNode,
  wakeupEventId: ids.browserWakeup,
  aggregateVersion: 1,
};

const providerFixture: QueuedFixture = {
  workflowRunId: ids.providerWorkflow,
  nodeRunId: ids.providerNode,
  wakeupEventId: ids.providerWakeup,
  aggregateVersion: 1,
};

const providerCancelFixture: QueuedFixture = {
  workflowRunId: ids.providerCancelWorkflow,
  nodeRunId: ids.providerCancelNode,
  wakeupEventId: ids.providerCancelWakeup,
  aggregateVersion: 1,
};

const providerFailureFixture: QueuedFixture = {
  workflowRunId: ids.providerFailureWorkflow,
  nodeRunId: ids.providerFailureNode,
  wakeupEventId: ids.providerFailureWakeup,
  aggregateVersion: 1,
};

const nodeInputWorkerFixture: QueuedFixture = {
  workflowRunId: ids.nodeInputWorkerWorkflow,
  nodeRunId: ids.nodeInputWorkerNode,
  wakeupEventId: ids.nodeInputWorkerWakeup,
  aggregateVersion: 1,
};

const nodeInputProviderFixture: QueuedFixture = {
  workflowRunId: ids.nodeInputProviderWorkflow,
  nodeRunId: ids.nodeInputProviderNode,
  wakeupEventId: ids.nodeInputProviderWakeup,
  aggregateVersion: 1,
};

function wakeupDelivery(
  fixture: QueuedFixture,
  consumerName = "workflow-orchestration.v1",
): InboxDelivery {
  return {
    consumerName,
    eventId: fixture.wakeupEventId,
    workspaceId: ids.workspace,
    messageType: "workflow.wakeup.requested",
    schemaVersion: 1,
    aggregateType: "workflow_run",
    aggregateId: fixture.workflowRunId,
    aggregateVersion: fixture.aggregateVersion,
    expectedGeneration: executionGeneration,
    receivedAt: fixtureAt,
  };
}

describe.skipIf(!integrationEnabled)(
  "workflow engine Inbox paths against a real MySQL 8.0 database",
  () => {
    let pool!: Pool;
    let instanceId!: string;
    let migrationReady = false;

    const count = async (
      sql: string,
      parameters: readonly unknown[],
    ): Promise<number> => {
      const [rows] = await pool.query<CountRow[]>(sql, [...parameters]);
      return Number(rows[0]?.count ?? 0);
    };

    const removeFixtures = async (
      connection: PoolConnection,
    ): Promise<void> => {
      if (!(await resetDisposableIntegrationDatabase(connection))) {
        throw new Error(
          "Workflow Inbox integration requires a runner-owned disposable database.",
        );
      }
    };

    const seedQueuedFixture = async (
      fixture: QueuedFixture,
      idempotencyKey: string,
      executionTarget: "browser" | "worker" | "provider" = "worker",
    ): Promise<void> => {
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
          fixture.workflowRunId,
          ids.workspace,
          ids.workflowRevision,
          idempotencyKey,
          digest("d"),
          JSON.stringify({
            fixture: idempotencyKey,
          }),
          new Date(fixtureAt.getTime() + topology.limits.timeoutMs),
          JSON.stringify(executionPlanFor(executionTarget)),
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
          fixture.nodeRunId,
          ids.workspace,
          fixture.workflowRunId,
          fixtureAt,
          fixtureAt,
        ],
      );
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
         ) VALUES (?, ?, 'workflow.wakeup.requested', 1, 'workflow_run', ?, ?, ?, 'pending', ?, 0, ?)`,
        [
          fixture.wakeupEventId,
          ids.workspace,
          fixture.workflowRunId,
          fixture.aggregateVersion,
          JSON.stringify({
            workflowRunId: fixture.workflowRunId,
            expectedGeneration: executionGeneration,
          }),
          fixtureAt,
          fixtureAt,
        ],
      );
    };

    const seedFoundation = async (): Promise<void> => {
      const workerAdapter = runtimeAdapterDocument(
        targetBindings.worker.adapterKey,
        "worker",
      );
      const browserAdapter = runtimeAdapterDocument(
        targetBindings.browser.adapterKey,
        "browser",
      );
      const providerAdapter = runtimeAdapterDocument(
        targetBindings.provider.adapterKey,
        "provider",
      );
      await pool.execute(
        `INSERT INTO organization
          (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'inbox-engine-integration',
           'Inbox Engine Integration', 'active', 1, ?, ?)`,
        [ids.workspace, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO workspace
          (id, organization_id, slug, name, status, version,
           created_at, updated_at)
         VALUES (?, ?, 'inbox-engine-integration',
           'Inbox Engine Integration', 'active', 1, ?, ?)`,
        [ids.workspace, ids.workspace, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO principal (
           id, principal_type, status, version, created_at, updated_at
         ) VALUES (?, 'human', 'active', 1, ?, ?)`,
        [ids.actor, fixtureAt, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO human_principal (
           principal_id, auth_subject_id, created_at
         ) VALUES (?, 'timeline-admin', ?)`,
        [ids.actor, fixtureAt],
      );
      await pool.execute(
        `INSERT INTO provider_endpoint (
           id, workspace_id, endpoint_key, adapter_kind, preset_kind,
           base_url, canonical_origin, base_url_digest, region_code,
           network_policy, data_policy, lifecycle_status, validation_status,
           validation_digest, validated_at, version,
           created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'inbox-provider', 'openai_native', 'openai',
                   'https://provider.example/v1', 'https://provider.example',
                   ?, 'global', '{}', '{}', 'active', 'passed', ?, ?, 1,
                   ?, ?, ?)`,
        [
          ids.providerEndpoint,
          ids.workspace,
          digest("4"),
          digest("5"),
          fixtureAt,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO credential (
           id, workspace_id, provider_endpoint_id, credential_key,
           provider_kind, authority_digest, billing_identity_digest,
           egress_identity_digest, identity_digest, identity_epoch,
           material_generation, active_secret_version_id, lifecycle_status,
           version, created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'inbox-provider', 'openai', ?, ?, ?, ?, 1, 1,
                   NULL, 'active', 1, ?, ?, ?)`,
        [
          ids.providerCredentialIdentity,
          ids.workspace,
          ids.providerEndpoint,
          digest("6"),
          digest("7"),
          digest("8"),
          providerCredentialIdentityDigest,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO secret_version (
           id, workspace_id, credential_id, version, material_generation,
           source_kind, lifecycle_status, aad_digest, deployment_reference,
           material_fingerprint, format_version, drain_deadline_at,
           verified_at, activated_at, retired_at, revoked_at, destroyed_at,
           created_by_principal_id, created_at
         ) VALUES (?, ?, ?, 1, 1, 'deployment_reference', 'active', ?,
                   'deployment://inbox/provider', ?, 1, NULL, ?, ?, NULL,
                   NULL, NULL, ?, ?)`,
        [
          ids.providerSecretVersion,
          ids.workspace,
          ids.providerCredentialIdentity,
          digest("9"),
          digest("a"),
          fixtureAt,
          fixtureAt,
          ids.actor,
          fixtureAt,
        ],
      );
      await pool.execute(
        `UPDATE credential
         SET active_secret_version_id = ?
         WHERE workspace_id = ? AND id = ?`,
        [
          ids.providerSecretVersion,
          ids.workspace,
          ids.providerCredentialIdentity,
        ],
      );
      const modelProfileDocument = {
        schemaVersion: 1,
        model: {
          displayName: "Inbox Provider Model",
          family: "inbox-provider",
          inputModalities: ["text"],
          outputModalities: ["text"],
          toolCall: true,
        },
        operations: {
          "text.generate": {
            parameters: [],
            evidence: [
              {
                kind: "administrator",
                reference: "inbox-provider-model",
                observedAt: fixtureAt.toISOString(),
                sourceDigest: digest("8"),
                confidence: "high",
                claim: "supported",
              },
            ],
          },
        },
        sources: [],
      };
      await pool.execute(
        `INSERT INTO model_profile_revision (
           id, workspace_id, canonical_model_id, profile_key, revision,
           schema_version, profile_document, canonical_digest,
           lifecycle_status, created_by_principal_id,
           published_by_principal_id, created_at, published_at
         ) VALUES (?, ?, NULL, 'inbox-provider-model', 1, 1, ?, ?,
                   'published', ?, ?, ?, ?)`,
        [
          ids.providerModelProfile,
          ids.workspace,
          JSON.stringify(modelProfileDocument),
          jsonDigest(modelProfileDocument),
          ids.actor,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO model_deployment (
           id, workspace_id, provider_endpoint_id, model_profile_revision_id,
           deployment_key, provider_model_id, deployment_digest,
           lifecycle_status, version, created_by_principal_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'inbox-provider-model',
                   'inbox-provider-model', ?, 'active', 1, ?, ?, ?)`,
        [
          ids.providerModelDeployment,
          ids.workspace,
          ids.providerEndpoint,
          ids.providerModelProfile,
          digest("b"),
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      const pricingDocument = {
        schemaVersion: 1,
        billingMode: "fixed",
        fixedChargeAmount: "1",
      };
      await pool.execute(
        `INSERT INTO pricing_revision (
           id, workspace_id, provider_endpoint_id, model_deployment_id,
           pricing_key, revision, schema_version, currency_code,
           pricing_document, canonical_digest, lifecycle_status, source_kind,
           verified_at, effective_at, created_by_principal_id,
           published_by_principal_id, created_at, published_at
         ) VALUES (?, ?, ?, ?, 'inbox-provider-usd', 1, 1, 'USD', ?, ?,
                   'published', 'contract', ?, ?, ?, ?, ?, ?)`,
        [
          ids.providerPricingRevision,
          ids.workspace,
          ids.providerEndpoint,
          ids.providerModelDeployment,
          JSON.stringify(pricingDocument),
          jsonDigest(pricingDocument),
          fixtureAt,
          fixtureAt,
          ids.actor,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO budget_account (
           id, workspace_id, account_key, currency_code, period_start_at,
           period_end_at, hard_limit_amount, consumed_amount, reserved_amount,
           unknown_held_amount, lifecycle_status, version,
           created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'inbox-provider-usd', 'USD', ?, ?, 100, 0, 0, 0,
                   'active', 1, ?, ?, ?)`,
        [
          ids.providerBudgetAccount,
          ids.workspace,
          new Date(fixtureAt.getTime() - 60_000),
          new Date(fixtureAt.getTime() + 86_400_000),
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
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
         ) VALUES (?, ?, 'foundation.inbox-engine', 1, 'published', ?, ?, ?, 'intrinsic', ?, ?, ?)`,
        [
          ids.contract,
          ids.workspace,
          contractDigest,
          JSON.stringify({
            type: "object",
          }),
          JSON.stringify({
            type: "object",
          }),
          JSON.stringify(["workflow"]),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO runtime_adapter_definition (
           id, workspace_id, adapter_key, lifecycle_status,
           current_revision_id, version, created_at, updated_at
         ) VALUES
           (?, ?, ?, 'active', NULL, 1, ?, ?),
           (?, ?, ?, 'active', NULL, 1, ?, ?),
           (?, ?, ?, 'active', NULL, 1, ?, ?)`,
        [
          ids.workerAdapterDefinition,
          ids.workspace,
          targetBindings.worker.adapterKey,
          fixtureAt,
          fixtureAt,
          ids.browserAdapterDefinition,
          ids.workspace,
          targetBindings.browser.adapterKey,
          fixtureAt,
          fixtureAt,
          ids.providerAdapterDefinition,
          ids.workspace,
          targetBindings.provider.adapterKey,
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `INSERT INTO runtime_adapter_revision (
           id, workspace_id, runtime_adapter_definition_id, revision,
           lifecycle_status, execution_target, canonical_digest, document,
           created_at, published_at
         ) VALUES
           (?, ?, ?, 1, 'published', 'worker', ?, ?, ?, ?),
           (?, ?, ?, 1, 'published', 'browser', ?, ?, ?, ?),
           (?, ?, ?, 1, 'published', 'provider', ?, ?, ?, ?)`,
        [
          ids.workerAdapterRevision,
          ids.workspace,
          ids.workerAdapterDefinition,
          jsonDigest(workerAdapter),
          JSON.stringify(workerAdapter),
          fixtureAt,
          fixtureAt,
          ids.browserAdapterRevision,
          ids.workspace,
          ids.browserAdapterDefinition,
          jsonDigest(browserAdapter),
          JSON.stringify(browserAdapter),
          fixtureAt,
          fixtureAt,
          ids.providerAdapterRevision,
          ids.workspace,
          ids.providerAdapterDefinition,
          jsonDigest(providerAdapter),
          JSON.stringify(providerAdapter),
          fixtureAt,
          fixtureAt,
        ],
      );
      await pool.execute(
        `UPDATE runtime_adapter_definition
         SET current_revision_id = CASE id
           WHEN ? THEN ? WHEN ? THEN ? WHEN ? THEN ? END
         WHERE workspace_id = ? AND id IN (?, ?, ?)`,
        [
          ids.workerAdapterDefinition,
          ids.workerAdapterRevision,
          ids.browserAdapterDefinition,
          ids.browserAdapterRevision,
          ids.providerAdapterDefinition,
          ids.providerAdapterRevision,
          ids.workspace,
          ids.workerAdapterDefinition,
          ids.browserAdapterDefinition,
          ids.providerAdapterDefinition,
        ],
      );
      const insertImplementation = async (options: {
        readonly id: string;
        readonly key: string;
        readonly target: "browser" | "provider" | "worker";
        readonly adapterKey: string;
        readonly adapterRevisionId: string;
        readonly implementationDigest: string;
      }): Promise<void> => {
        await pool.execute(
          `INSERT INTO capability_implementation_revision (
             id, workspace_id, implementation_key, display_name, description,
             revision, lifecycle_status, contract_revision_id,
             runtime_adapter_revision_id, execution_target, adapter_key,
             source_kind, source_reference, canonical_digest,
             publication_request_key, publication_request_hash, configuration,
             input_mapping, input_mapping_digest, compiled_input_mapping,
             output_mapping, output_mapping_digest, compiled_output_mapping,
             fixture_suite, created_at, published_at
           ) VALUES (?, ?, ?, ?, NULL, 1, 'published', ?, ?, ?, ?, 'plugin',
             ?, ?, ?, ?, JSON_OBJECT(), ?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?, ?)`,
          [
            options.id,
            ids.workspace,
            options.key,
            JSON.stringify({
              defaultLocale: "en-US",
              values: { "en-US": options.key, "zh-CN": options.key },
            }),
            ids.contract,
            options.adapterRevisionId,
            options.target,
            options.adapterKey,
            JSON.stringify({
              kind: "plugin",
              plugin: {
                key: "test.inbox-engine",
                revision: 1,
                canonicalDigest: options.implementationDigest,
              },
            }),
            options.implementationDigest,
            `foundation.inbox-engine.${options.target}`,
            jsonDigest({ target: options.target }),
            JSON.stringify(identityInputMapping),
            jsonDigest(compiledIdentityInputMapping),
            JSON.stringify(compiledIdentityInputMapping),
            JSON.stringify(identityOutputMapping),
            jsonDigest(compiledIdentityOutputMapping),
            JSON.stringify(compiledIdentityOutputMapping),
            fixtureAt,
            fixtureAt,
          ],
        );
      };
      await insertImplementation({
        id: ids.implementation,
        key: "foundation.inbox-engine.worker",
        target: "worker",
        adapterKey: targetBindings.worker.adapterKey,
        adapterRevisionId: ids.workerAdapterRevision,
        implementationDigest,
      });
      await insertImplementation({
        id: ids.browserImplementation,
        key: "foundation.inbox-engine.browser",
        target: "browser",
        adapterKey: targetBindings.browser.adapterKey,
        adapterRevisionId: ids.browserAdapterRevision,
        implementationDigest: targetBindings.browser.implementationDigest,
      });
      await insertImplementation({
        id: ids.providerImplementation,
        key: "foundation.inbox-engine.provider",
        target: "provider",
        adapterKey: targetBindings.provider.adapterKey,
        adapterRevisionId: ids.providerAdapterRevision,
        implementationDigest: targetBindings.provider.implementationDigest,
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
         ) VALUES (?, ?, ?, ?, ?, 'active', 1, 1, ?, ?, ?)`,
        [
          ids.binding,
          ids.workspace,
          "foundation.inbox-engine.worker",
          ids.contract,
          ids.implementation,
          JSON.stringify({
            retryPolicy,
          }),
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
           created_at,
           updated_at
         ) VALUES
           (?, ?, ?, ?, ?, 'active', 2, 1, ?, ?, ?),
           (?, ?, ?, ?, ?, 'active', 3, 1, ?, ?, ?)`,
        [
          ids.browserBinding,
          ids.workspace,
          "foundation.inbox-engine.browser",
          ids.contract,
          ids.browserImplementation,
          JSON.stringify({ retryPolicy }),
          fixtureAt,
          fixtureAt,
          ids.providerBinding,
          ids.workspace,
          "foundation.inbox-engine.provider",
          ids.contract,
          ids.providerImplementation,
          JSON.stringify({
            retryPolicy,
            providerRoute,
          }),
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
         ) VALUES (?, ?, 'foundation.inbox-engine', 1, 'published', ?, ?, ?, ?, ?, ?)`,
        [
          ids.workflowRevision,
          ids.workspace,
          digest("c"),
          JSON.stringify(topology),
          JSON.stringify({
            type: "object",
          }),
          JSON.stringify({
            type: "object",
          }),
          fixtureAt,
          fixtureAt,
        ],
      );

      await seedQueuedFixture(raceFixture, "inbox-race");
      await seedQueuedFixture(envelopeFixture, "inbox-envelope");
      await seedQueuedFixture(futureFixture, "inbox-future");
      await seedQueuedFixture(browserFixture, "inbox-browser", "browser");
      await seedQueuedFixture(providerFixture, "inbox-provider", "provider");
      await seedQueuedFixture(
        providerCancelFixture,
        "inbox-provider-cancel",
        "provider",
      );
      await seedQueuedFixture(
        providerFailureFixture,
        "inbox-provider-failure",
        "provider",
      );
    };

    const consumeDirect = async (
      delivery: InboxDelivery,
      resultCode: string,
    ): Promise<InboxConsumptionResult<boolean>> => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await consumeInboxEvent(connection, delivery, () =>
          Promise.resolve({
            outcome: "noop" as const,
            resultCode,
            value: true,
          }),
        );
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
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

      const [migrationRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM kanvas_migration_history
         WHERE name = '0000_initial_schema.sql'`,
      );
      expect(Number(migrationRows[0]?.count ?? 0)).toBe(1);
      const cleanupConnection = await pool.getConnection();
      try {
        await removeFixtures(cleanupConnection);
      } finally {
        cleanupConnection.release();
      }
      instanceId = `provider-atomic-${ids.workspace}`;
      await pool.execute(
        `DELETE FROM instance_runtime_state
         WHERE instance_id = ?`,
        [instanceId],
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
         ) VALUES (?, 'ACTIVE', ?, 1, 'integration_test', NULL,
           'workflow-engine-inbox.integration', ?)`,
        [instanceId, executionGeneration, fixtureAt],
      );
      migrationReady = true;
      await seedFoundation();
    }, 30_000);

    afterAll(async () => {
      if (pool) {
        if (migrationReady) {
          const cleanupConnection = await pool.getConnection();
          try {
            await removeFixtures(cleanupConnection);
          } finally {
            cleanupConnection.release();
          }
          await pool.execute(
            `DELETE FROM instance_runtime_state
             WHERE instance_id = ?`,
            [instanceId],
          );
        }
        await pool.end();
      }
    });

    it("inherits library authority from the parent Workflow when consuming node inputs", async () => {
      const fixture: QueuedFixture = {
        workflowRunId: identity(9_900_501),
        nodeRunId: identity(9_900_502),
        wakeupEventId: identity(9_900_503),
        aggregateVersion: 1,
      };
      const membershipId = identity(9_900_504),
        artifactId = identity(9_900_505),
        libraryId = identity(9_900_506);
      const authority: TrustedWorkspaceScope = {
        workspaceId: ids.workspace,
        organizationId: ids.workspace,
        principalId: ids.actor,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: "workflow-library-test",
        authorityType: "human_membership",
        authorityId: membershipId,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: permissionsForWorkspaceRole("admin"),
        trusted: true,
      };
      await pool.execute(
        "INSERT INTO workspace_membership (id, organization_id, workspace_id, principal_id, role, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)",
        [
          membershipId,
          ids.workspace,
          ids.workspace,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      try {
        await createResourceLibraryStore(pool).save({
          authority,
          libraryId,
          revisionId: identity(9_900_507),
          expectedVersion: 0,
          requestKey: "workflow-consumer-library",
          document: {
            schemaVersion: 1,
            name: "Workflow references",
            description: "Authorization fixture",
            entries: [],
          },
          audit: {
            auditEventId: identity(9_900_508),
            authenticationRefHash: digest("a"),
          },
          now: fixtureAt,
        });
        await pool.execute(
          "INSERT INTO artifact (id, workspace_id, structured_content, content_digest, artifact_type, availability_status, data_classification, metadata, created_at) VALUES (?, ?, '{}', ?, 'document.text', 'available', 'internal', '{}', ?)",
          [artifactId, ids.workspace, jsonDigest({}), fixtureAt],
        );
        await pool.execute(
          "INSERT INTO resource_library_upload (workspace_id, library_id, artifact_id, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?)",
          [ids.workspace, libraryId, artifactId, ids.actor, fixtureAt],
        );
        await seedQueuedFixture(fixture, "workflow-library-authority");
        await pool.execute("UPDATE workflow_run SET input = ? WHERE id = ?", [
          JSON.stringify({ sourceArtifactId: artifactId }),
          fixture.workflowRunId,
        ]);
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await retainLibraryConsumerAuthority(connection, {
            authority,
            consumerKind: "workflow",
            consumerId: fixture.workflowRunId,
            artifacts: new Map([[artifactId, false]]),
            now: fixtureAt,
          });
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
        const capabilityRunId = identity(9_900_509);
        const engine = createWorkflowEngineStore(pool, {
          enabledExecutionTargets: ["worker"],
        });
        await engine.startWorkflow({
          workflowRunId: fixture.workflowRunId,
          ids: {
            capabilityRunId,
            attemptId: identity(9_900_510),
            outboxEventId: identity(9_900_511),
          },
          now: fixtureAt,
          executionGeneration,
          delivery: wakeupDelivery(fixture),
        });
        const access = createLibraryConsumerAccessStore(pool);
        const request = {
          workspaceId: ids.workspace,
          capabilityRunId,
          artifactId,
          now: fixtureAt,
        };
        await expect(
          access.authorizeArtifact(request),
        ).resolves.toBeUndefined();
        expect(
          await count(
            "SELECT COUNT(*) AS count FROM resource_library_consumer_input WHERE consumer_kind = 'capability' AND consumer_id = ?",
            [capabilityRunId],
          ),
        ).toBe(0);
        await expect(
          access.authorizeArtifact({
            ...request,
            capabilityRunId: identity(9_900_599),
          }),
        ).rejects.toMatchObject({
          code: "resource_library.consumer_unauthorized",
        });
        await pool.execute(
          "UPDATE workspace_membership SET status = 'revoked' WHERE id = ?",
          [membershipId],
        );
        await expect(access.authorizeArtifact(request)).rejects.toMatchObject({
          code: "authorization.forbidden",
        });
      } finally {
        await pool.execute("DELETE FROM workspace_membership WHERE id = ?", [
          membershipId,
        ]);
      }
    });

    it("claims the persisted Worker Capability input and rejects a mismatched digest", async () => {
      await seedQueuedFixture(
        nodeInputWorkerFixture,
        "node-input-worker",
        "worker",
      );
      const store = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker"],
      });
      const start = await store.startWorkflow({
        workflowRunId: nodeInputWorkerFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.nodeInputWorkerCapability,
          attemptId: ids.nodeInputWorkerAttempt,
          outboxEventId: ids.nodeInputWorkerDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: wakeupDelivery(nodeInputWorkerFixture),
      });
      expect(start).toMatchObject({
        deliveryStatus: "processed",
        value: {
          started: true,
          capabilityRunId: ids.nodeInputWorkerCapability,
          attemptId: ids.nodeInputWorkerAttempt,
        },
      });

      const nodeInput = Object.freeze({
        source: "resolved-node-input",
        parameters: Object.freeze({
          quality: "high",
          resolution: "4k",
        }),
      });
      const nonAuthoritativeNodeInput = Object.freeze({
        source: "corrupted-node-shadow",
      });
      await pool.execute(
        `UPDATE node_run
         SET input = ?,
             input_digest = ?
         WHERE id = ?`,
        [
          JSON.stringify(nonAuthoritativeNodeInput),
          digest("8"),
          ids.nodeInputWorkerNode,
        ],
      );
      await replaceCapabilityInputFacts(
        pool,
        ids.nodeInputWorkerCapability,
        nodeInput,
        digest("8"),
      );
      const delivery: InboxDelivery = {
        consumerName: "node-input-worker-dispatch.v1",
        eventId: ids.nodeInputWorkerDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.nodeInputWorkerAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 1),
      };
      const claim = {
        capabilityRunId: ids.nodeInputWorkerCapability,
        attemptId: ids.nodeInputWorkerAttempt,
        leaseTokenHash: "8".repeat(64),
        now: delivery.receivedAt,
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
        expectedExecutionTarget: "worker" as const,
        delivery,
      };

      await expect(store.claimAttempt(claim)).rejects.toMatchObject({
        code: "inbox.event.fact_mismatch",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [delivery.consumerName, delivery.eventId],
        ),
      ).toBe(0);

      await expect(
        replaceCapabilityInputFacts(
          pool,
          ids.nodeInputWorkerCapability,
          nodeInput,
          null,
        ),
      ).rejects.toMatchObject({ code: "ER_BAD_NULL_ERROR" });

      await replaceCapabilityInputFacts(
        pool,
        ids.nodeInputWorkerCapability,
        nodeInput,
        jsonDigest(nodeInput),
      );
      await expect(store.claimAttempt(claim)).resolves.toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        resultCode: "attempt.claim.applied",
        value: {
          attemptId: ids.nodeInputWorkerAttempt,
          input: nodeInput,
        },
      });
    });

    it("claims the persisted Provider Capability input and rejects a mismatched digest", async () => {
      await seedQueuedFixture(
        nodeInputProviderFixture,
        "node-input-provider",
        "provider",
      );
      const engine = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker", "provider"],
      });
      const start = await engine.startWorkflow({
        workflowRunId: nodeInputProviderFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.nodeInputProviderCapability,
          attemptId: ids.nodeInputProviderAttempt,
          outboxEventId: ids.nodeInputProviderDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: wakeupDelivery(nodeInputProviderFixture),
      });
      expect(start).toMatchObject({
        deliveryStatus: "processed",
        value: {
          started: true,
          capabilityRunId: ids.nodeInputProviderCapability,
          attemptId: ids.nodeInputProviderAttempt,
        },
      });

      const nodeInput = Object.freeze({
        source: "resolved-provider-node-input",
        parameters: Object.freeze({
          aspectRatio: "16:9",
          outputFormat: "webp",
        }),
      });
      const nonAuthoritativeNodeInput = Object.freeze({
        source: "corrupted-provider-node-shadow",
      });
      await pool.execute(
        `UPDATE node_run
         SET input = ?,
             input_digest = ?
         WHERE id = ?`,
        [
          JSON.stringify(nonAuthoritativeNodeInput),
          digest("7"),
          ids.nodeInputProviderNode,
        ],
      );
      await replaceCapabilityInputFacts(
        pool,
        ids.nodeInputProviderCapability,
        nodeInput,
        digest("7"),
      );
      const delivery: InboxDelivery = {
        consumerName: "node-input-provider-dispatch.v1",
        eventId: ids.nodeInputProviderDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.nodeInputProviderAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 1),
      };
      const store = createProviderInvocationStore(pool, {
        instanceId,
        claimingEnabled: true,
        enabledExecutionTargets: ["worker", "provider"],
      });
      const claim = {
        invocationId: ids.nodeInputProviderInvocation,
        capabilityRunId: ids.nodeInputProviderCapability,
        attemptId: ids.nodeInputProviderAttempt,
        leaseTokenHash: "7".repeat(64),
        now: delivery.receivedAt,
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
        delivery,
      };

      await expect(store.claimDispatch(claim)).rejects.toMatchObject({
        code: "provider_invocation.snapshot_invalid",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM provider_invocation
           WHERE id = ?`,
          [ids.nodeInputProviderInvocation],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [delivery.consumerName, delivery.eventId],
        ),
      ).toBe(0);

      await replaceCapabilityInputFacts(
        pool,
        ids.nodeInputProviderCapability,
        nodeInput,
        jsonDigest(nodeInput),
      );
      await expect(store.claimDispatch(claim)).resolves.toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        resultCode: "provider.dispatch.claimed",
        value: {
          invocationId: ids.nodeInputProviderInvocation,
          attemptId: ids.nodeInputProviderAttempt,
          input: nodeInput,
        },
      });
    });

    it("atomically deduplicates concurrent wakeup and dispatch deliveries", async () => {
      const stores = [
        createWorkflowEngineStore(pool),
        createWorkflowEngineStore(pool),
      ] as const;
      const delivery = wakeupDelivery(raceFixture);
      const startOptions = {
        workflowRunId: raceFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.raceCapability,
          attemptId: ids.raceAttempt,
          outboxEventId: ids.raceDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery,
      } as const;

      const starts = await Promise.all([
        stores[0].startWorkflow(startOptions),
        stores[1].startWorkflow(startOptions),
      ]);

      expect(
        starts.filter((result) => result.deliveryStatus === "processed"),
      ).toHaveLength(1);
      expect(
        starts.filter((result) => result.deliveryStatus === "duplicate"),
      ).toHaveLength(1);
      expect(starts.map((result) => result.resultCode)).toEqual([
        "workflow.start.applied",
        "workflow.start.applied",
      ]);
      const processedStart = starts.find(
        (
          result,
        ): result is Extract<
          InboxConsumptionResult<StartWorkflowResult>,
          { readonly deliveryStatus: "processed" }
        > => result.deliveryStatus === "processed",
      );
      expect(processedStart?.value).toEqual({
        started: true,
        capabilityRunId: ids.raceCapability,
        attemptId: ids.raceAttempt,
      });

      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [delivery.consumerName, delivery.eventId],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_run
           WHERE id = ? AND node_run_id = ?`,
          [ids.raceCapability, ids.raceNode],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE id = ? AND capability_run_id = ?`,
          [ids.raceAttempt, ids.raceCapability],
        ),
      ).toBe(1);

      const [dispatchRows] = await pool.query<DispatchOutboxRow[]>(
        `SELECT
           id,
           workspace_id AS workspaceId,
           schema_version AS schemaVersion,
           aggregate_id AS aggregateId,
           aggregate_version AS aggregateVersion,
           payload
         FROM outbox_event
         WHERE workspace_id = ?
           AND message_type = 'attempt.dispatch.requested'
           AND aggregate_id = ?`,
        [ids.workspace, ids.raceAttempt],
      );
      expect(dispatchRows).toHaveLength(1);
      expect(dispatchRows[0]).toEqual(
        expect.objectContaining({
          id: ids.raceDispatch,
          workspaceId: ids.workspace,
          schemaVersion: 1,
          aggregateId: ids.raceAttempt,
          aggregateVersion: 1,
        }),
      );
      expect(parsePayload(dispatchRows[0]?.payload)).toEqual(
        expect.objectContaining({
          workflowRunId: ids.raceWorkflow,
          nodeRunId: ids.raceNode,
          capabilityRunId: ids.raceCapability,
          attemptId: ids.raceAttempt,
          executionTarget: "worker",
          expectedGeneration: executionGeneration,
        }),
      );

      const dispatchDelivery: InboxDelivery = {
        consumerName: "attempt-dispatch.v1",
        eventId: ids.raceDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.raceAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 1),
      };
      const claimOptionsBase = {
        capabilityRunId: ids.raceCapability,
        attemptId: ids.raceAttempt,
        leaseTokenHash: "c".repeat(64),
        now: new Date(fixtureAt.getTime() + 1),
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionDeadlineAt: new Date(fixtureAt.getTime() + 300_000),
        executionGeneration,
        delivery: dispatchDelivery,
      } as const;
      await expect(
        stores[0].claimAttempt({
          ...claimOptionsBase,
          expectedExecutionTarget: "provider",
        }),
      ).rejects.toMatchObject({
        code: "inbox.event.fact_mismatch",
      });
      await pool.execute(
        `UPDATE capability_attempt
         SET execution_target = 'provider'
         WHERE id = ?`,
        [ids.raceAttempt],
      );
      await expect(
        stores[0].claimAttempt({
          ...claimOptionsBase,
          expectedExecutionTarget: "worker",
        }),
      ).rejects.toMatchObject({
        code: "inbox.event.fact_mismatch",
      });
      await pool.execute(
        `UPDATE capability_attempt
         SET execution_target = 'worker'
         WHERE id = ?`,
        [ids.raceAttempt],
      );
      await pool.execute(
        `UPDATE outbox_event
         SET payload = JSON_REMOVE(payload, '$.executionTarget')
         WHERE id = ?`,
        [ids.raceDispatch],
      );
      await expect(
        stores[0].claimAttempt({
          ...claimOptionsBase,
          expectedExecutionTarget: "provider",
        }),
      ).rejects.toMatchObject({
        code: "inbox.event.fact_mismatch",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [dispatchDelivery.consumerName, dispatchDelivery.eventId],
        ),
      ).toBe(0);
      const [unclaimedRows] = await pool.query<AttemptStateRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           lease_generation AS leaseGeneration,
           lease_token_hash AS leaseTokenHash,
           version
         FROM capability_attempt
         WHERE id = ?`,
        [ids.raceAttempt],
      );
      expect(unclaimedRows).toEqual([
        {
          lifecycleStatus: "created",
          leaseGeneration: 0,
          leaseTokenHash: null,
          version: 1,
        },
      ]);
      await pool.execute(
        `UPDATE outbox_event
         SET payload = JSON_SET(payload, '$.executionTarget', 'worker')
         WHERE id = ?`,
        [ids.raceDispatch],
      );
      const claimOptions = {
        ...claimOptionsBase,
        expectedExecutionTarget: "worker",
      } as const;
      const claims = await Promise.all([
        stores[0].claimAttempt(claimOptions),
        stores[1].claimAttempt(claimOptions),
      ]);

      expect(
        claims.filter((result) => result.deliveryStatus === "processed"),
      ).toHaveLength(1);
      expect(
        claims.filter((result) => result.deliveryStatus === "duplicate"),
      ).toHaveLength(1);
      expect(claims.map((result) => result.resultCode)).toEqual([
        "attempt.claim.applied",
        "attempt.claim.applied",
      ]);
      const processedClaim = claims.find(
        (result) => result.deliveryStatus === "processed",
      );
      expect(processedClaim?.value).toEqual(
        expect.objectContaining({
          executionTarget: "worker",
          implementationRevisionId: ids.implementation,
          implementationDigest,
        }),
      );
      const [attemptRows] = await pool.query<AttemptStateRow[]>(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           lease_generation AS leaseGeneration,
           lease_token_hash AS leaseTokenHash,
           version
         FROM capability_attempt
         WHERE id = ?`,
        [ids.raceAttempt],
      );
      expect(attemptRows).toEqual([
        {
          lifecycleStatus: "running",
          leaseGeneration: 1,
          leaseTokenHash: "c".repeat(64),
          version: 2,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [dispatchDelivery.consumerName, dispatchDelivery.eventId],
        ),
      ).toBe(1);

      if (
        processedClaim?.deliveryStatus !== "processed" ||
        !processedClaim.value
      ) {
        throw new Error("Expected one claimed Worker Attempt.");
      }
      const failureStore = createAttemptFailureStore(pool, {
        instanceId,
        enabledExecutionTargets: ["worker"],
      });
      const failureReport = {
        workspaceId: ids.workspace,
        capabilityRunId: ids.raceCapability,
        attemptId: ids.raceAttempt,
        nextAttemptId: ids.raceFailureNextAttempt,
        outboxEventId: ids.raceFailureDispatch,
        executionGeneration,
        target: {
          reporter: "worker" as const,
          executionTarget: "worker" as const,
          implementationRevisionId: ids.implementation,
          implementationDigest,
          adapterKey: "test.inbox-engine",
          attemptLeaseGeneration: 1,
          domainLeaseTokenHash: "c".repeat(64),
        },
        failure: {
          stableErrorCode: "worker.fixture_unavailable",
          sideEffectState: "not_started" as const,
          retryability: "retryable" as const,
          cause: "failed" as const,
          evidenceDigest: digest("8"),
        },
        now: new Date(fixtureAt.getTime() + 2),
      };
      await expect(
        failureStore.reportAttemptFailure(failureReport),
      ).resolves.toEqual({
        status: "retried",
        reasonCode: "attempt.transition.retry.not_started",
        nextAttemptId: ids.raceFailureNextAttempt,
        nextExecutionTarget: "worker",
      });
      await expect(
        failureStore.reportAttemptFailure(failureReport),
      ).resolves.toEqual({
        status: "noop",
        reasonCode: "worker.fixture_unavailable",
      });
      await expect(
        failureStore.reportAttemptFailure({
          ...failureReport,
          failure: {
            ...failureReport.failure,
            stableErrorCode: "worker.conflicting_failure",
          },
        }),
      ).rejects.toMatchObject({
        code: "attempt_failure.state_conflict",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE capability_run_id = ?`,
          [ids.raceCapability],
        ),
      ).toBe(2);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?
             AND message_type = 'attempt.dispatch.requested'
             AND aggregate_id = ?`,
          [ids.raceFailureDispatch, ids.raceFailureNextAttempt],
        ),
      ).toBe(1);
    });

    it("fails closed for disabled targets while allowing a mutable Binding rollout", async () => {
      const defaultStore = createWorkflowEngineStore(pool);
      const store = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker", "provider", "browser"],
      });
      const browserDelivery = wakeupDelivery(browserFixture);
      await expect(
        defaultStore.startWorkflow({
          workflowRunId: browserFixture.workflowRunId,
          ids: {
            capabilityRunId: ids.browserCapability,
            attemptId: ids.browserAttempt,
            outboxEventId: ids.browserUnusedDispatch,
          },
          now: fixtureAt,
          executionGeneration,
          delivery: browserDelivery,
        }),
      ).rejects.toMatchObject({
        code: "workflow.execution_target_disabled",
        executionTarget: "browser",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [browserDelivery.consumerName, browserDelivery.eventId],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE id = ?`,
          [ids.browserAttempt],
        ),
      ).toBe(0);

      const browserStart = await store.startWorkflow({
        workflowRunId: browserFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.browserCapability,
          attemptId: ids.browserAttempt,
          outboxEventId: ids.browserUnusedDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: browserDelivery,
      });
      expect(browserStart.deliveryStatus).toBe("processed");
      expect(browserStart.resultCode).toBe("workflow.start.applied");
      if (browserStart.deliveryStatus !== "processed") {
        throw new Error("Browser start was unexpectedly deduplicated.");
      }
      expect(browserStart.value.started).toBe(true);
      expect(browserStart.value.attemptId).toBe(ids.browserAttempt);
      const [browserAttempts] = await pool.query<AttemptTargetRow[]>(
        `SELECT
           execution_target AS executionTarget,
           implementation_revision_id AS implementationRevisionId
         FROM capability_attempt
         WHERE id = ?`,
        [ids.browserAttempt],
      );
      expect(browserAttempts).toEqual([
        {
          executionTarget: "browser",
          implementationRevisionId: ids.browserImplementation,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?
              OR (
                message_type = 'attempt.dispatch.requested'
                AND aggregate_id = ?
              )`,
          [ids.browserUnusedDispatch, ids.browserAttempt],
        ),
      ).toBe(0);

      const providerDelivery = wakeupDelivery(providerFixture);
      const providerStartOptions = {
        workflowRunId: providerFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.providerCapability,
          attemptId: ids.providerAttempt,
          outboxEventId: ids.providerDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: providerDelivery,
      } as const;
      await expect(
        defaultStore.startWorkflow(providerStartOptions),
      ).rejects.toMatchObject({
        code: "workflow.execution_target_disabled",
        executionTarget: "provider",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE id = ?`,
          [ids.providerAttempt],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?`,
          [ids.providerDispatch],
        ),
      ).toBe(0);

      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [providerDelivery.consumerName, providerDelivery.eventId],
        ),
      ).toBe(0);

      await pool.execute(
        `UPDATE capability_binding
         SET implementation_revision_id = ?,
             version = version + 1
         WHERE id = ?`,
        [ids.implementation, ids.providerBinding],
      );
      const providerStart = await store.startWorkflow(providerStartOptions);
      expect(providerStart.deliveryStatus).toBe("processed");
      const [providerOutboxRows] = await pool.query<DispatchOutboxRow[]>(
        `SELECT
             id,
             workspace_id AS workspaceId,
             schema_version AS schemaVersion,
             aggregate_id AS aggregateId,
             aggregate_version AS aggregateVersion,
             payload
           FROM outbox_event
           WHERE id = ?`,
        [ids.providerDispatch],
      );
      expect(providerOutboxRows).toHaveLength(1);
      expect(parsePayload(providerOutboxRows[0]?.payload)).toEqual(
        expect.objectContaining({
          attemptId: ids.providerAttempt,
          executionTarget: "provider",
          expectedGeneration: executionGeneration,
        }),
      );

      const providerDispatchDelivery: InboxDelivery = {
        consumerName: "provider-attempt-dispatch.v1",
        eventId: ids.providerDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.providerAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 1),
      };
      const providerInvocationStores = [
        createProviderInvocationStore(pool, {
          instanceId,
          claimingEnabled: true,
        }),
        createProviderInvocationStore(pool, {
          instanceId,
          claimingEnabled: true,
        }),
      ] as const;
      const providerClaimOptions = {
        invocationId: ids.providerInvocation,
        capabilityRunId: ids.providerCapability,
        attemptId: ids.providerAttempt,
        leaseTokenHash: "d".repeat(64),
        now: new Date(fixtureAt.getTime() + 1),
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
        delivery: providerDispatchDelivery,
      } as const;
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [
            providerDispatchDelivery.consumerName,
            providerDispatchDelivery.eventId,
          ],
        ),
      ).toBe(0);
      const providerClaims = await Promise.all([
        providerInvocationStores[0].claimDispatch(providerClaimOptions),
        providerInvocationStores[1].claimDispatch(providerClaimOptions),
      ]);
      expect(
        providerClaims.filter((claim) => claim.deliveryStatus === "processed"),
      ).toHaveLength(1);
      expect(
        providerClaims.filter((claim) => claim.deliveryStatus === "duplicate"),
      ).toHaveLength(1);
      const providerClaim = providerClaims.find(
        (claim) => claim.deliveryStatus === "processed",
      );
      if (providerClaim?.deliveryStatus !== "processed") {
        throw new Error("Provider invocation was not claimed.");
      }
      expect(providerClaim.value).toMatchObject({
        workKind: "submit",
        invocationId: ids.providerInvocation,
        attemptId: ids.providerAttempt,
        implementationRevisionId: ids.providerImplementation,
        implementationDigest: targetBindings.provider.implementationDigest,
        stableRequestKey: `kanvas:v1:${ids.providerAttempt}`,
        leaseGeneration: 1,
        executionGeneration,
        route: {
          providerEndpointId: ids.providerEndpoint,
          queryMode: "client_request_id",
        },
      });
      const [providerAttemptLeaseRows] = await pool.query<
        (RowDataPacket & {
          readonly lifecycleStatus: string;
          readonly sideEffectState: string;
          readonly leaseGeneration: number;
          readonly leaseTokenHash: string | null;
        })[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           side_effect_state AS sideEffectState,
           lease_generation AS leaseGeneration,
           lease_token_hash AS leaseTokenHash
         FROM capability_attempt
         WHERE id = ?`,
        [ids.providerAttempt],
      );
      expect(providerAttemptLeaseRows).toEqual([
        {
          lifecycleStatus: "running",
          sideEffectState: "not_started",
          leaseGeneration: 0,
          leaseTokenHash: null,
        },
      ]);

      const providerPreparedRequest = {
        schemaVersion: 1,
        operation: "integration-test-submit",
      };
      expect(
        await providerInvocationStores[0].recordPreparedRequest?.({
          invocationId: ids.providerInvocation,
          capabilityRunId: ids.providerCapability,
          attemptId: ids.providerAttempt,
          leaseTokenHash: "d".repeat(64),
          leaseGeneration: 1,
          executionGeneration,
          snapshot: providerPreparedRequest,
          digest: jsonDigest(providerPreparedRequest),
          now: new Date(fixtureAt.getTime() + 2),
        }),
      ).toBe(true);
      expect(
        await providerInvocationStores[0].markSubmissionStarted({
          invocationId: ids.providerInvocation,
          capabilityRunId: ids.providerCapability,
          attemptId: ids.providerAttempt,
          leaseTokenHash: "d".repeat(64),
          leaseGeneration: 1,
          executionGeneration,
          now: new Date(fixtureAt.getTime() + 2),
        }),
      ).toBe(true);
      const queryDueAt = new Date(fixtureAt.getTime() + 4);
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation({
          observationId: ids.providerUnknownObservation,
          observationKey: "invoke:ack-lost",
          invocationId: ids.providerInvocation,
          capabilityRunId: ids.providerCapability,
          attemptId: ids.providerAttempt,
          leaseTokenHash: "d".repeat(64),
          leaseGeneration: 1,
          executionGeneration,
          operationKind: "invoke",
          source: "adapter",
          status: "unknown",
          stableErrorCode: "provider.ack_lost",
          nextReconcileAt: queryDueAt,
          observedAt: new Date(fixtureAt.getTime() + 3),
          recordedAt: new Date(fixtureAt.getTime() + 3),
        }),
      ).resolves.toEqual({
        recorded: true,
        adoption: "applied",
        terminal: false,
      });
      await expect(
        providerInvocationStores[0].scanRecoveryCandidates({
          now: queryDueAt,
          batchSize: 10,
        }),
      ).resolves.toContainEqual({
        invocationId: ids.providerInvocation,
        reason: "due_query",
      });
      await pool.execute(
        `UPDATE capability_implementation_revision
         SET lifecycle_status = 'deprecated'
         WHERE id = ?`,
        [ids.providerImplementation],
      );
      const queryClaim = await providerInvocationStores[0].claimRecovery({
        invocationId: ids.providerInvocation,
        leaseTokenHash: "e".repeat(64),
        now: queryDueAt,
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
      });
      expect(queryClaim).toMatchObject({
        workKind: "query",
        invocationId: ids.providerInvocation,
        leaseGeneration: 2,
      });
      if (
        !queryClaim?.executionDeadlineAt ||
        !providerInvocationStores[0].renewLease
      )
        throw new Error("Missing renewable Provider claim");
      const renewal = {
        invocationId: ids.providerInvocation,
        capabilityRunId: ids.providerCapability,
        attemptId: ids.providerAttempt,
        leaseTokenHash: "e".repeat(64),
        leaseGeneration: 2,
        executionGeneration,
        now: new Date(fixtureAt.getTime() + 5),
        leaseUntil: new Date(queryClaim.executionDeadlineAt.getTime() + 1000),
      };
      await expect(
        providerInvocationStores[0].renewLease({
          ...renewal,
          leaseTokenHash: "d".repeat(64),
        }),
      ).resolves.toBeUndefined();
      await expect(
        providerInvocationStores[0].renewLease(renewal),
      ).resolves.toEqual(queryClaim.executionDeadlineAt);
      const confirm = providerInvocationStores[0].recordConfirmedResult?.bind(
        providerInvocationStores[0],
      );
      if (!confirm) throw new Error("Missing confirmed-result recording");
      const factsRequest = {
        ...renewal,
        observationId: `01K${"9".repeat(23)}`,
        operationKind: "query" as const,
        providerRequestId: "provider-request-fixture",
        facts: {
          resultEvidence: {
            urls: [
              "https://files.example.test/result.png?signature=private",
              "https://blocked.example.test/original.png?signature=private",
            ],
            totalCount: 2,
            omittedCount: 0,
          },
          resultUrls: [
            "https://files.example.test/result.png?signature=private",
          ],
          usage: [],
          reportedCharge: {
            source: "provider_reported" as const,
            currencyCode: "USD",
            amount: "0.72",
          },
        },
      };
      await expect(
        confirm({ ...factsRequest, leaseTokenHash: "d".repeat(64) }),
      ).resolves.toBe(false);
      await expect(confirm(factsRequest)).resolves.toBe(true);
      await expect(confirm(factsRequest)).resolves.toBe(true);
      const [savedResultLinks] = await pool.query<RowDataPacket[]>(
        "SELECT JSON_EXTRACT(result_facts, '$.resultUrls') AS urls FROM provider_invocation_observation WHERE id = ?",
        [factsRequest.observationId],
      );
      const storedUrls: unknown = savedResultLinks[0]?.urls;
      expect(
        typeof storedUrls === "string" ? JSON.parse(storedUrls) : storedUrls,
      ).toEqual(factsRequest.facts.resultUrls);
      const [savedEvidence] = await pool.query<RowDataPacket[]>(
        "SELECT JSON_EXTRACT(result_facts, '$.resultEvidence') AS evidence FROM provider_invocation_observation WHERE id = ?",
        [factsRequest.observationId],
      );
      const evidence: unknown = savedEvidence[0]?.evidence;
      expect(
        typeof evidence === "string" ? JSON.parse(evidence) : evidence,
      ).toEqual(factsRequest.facts.resultEvidence);

      const staleOutput = {
        artifactId: "artifact-must-not-adopt",
      };
      const staleObservation = {
        observationId: ids.providerStaleObservation,
        observationKey: "query:stale-success",
        invocationId: ids.providerInvocation,
        capabilityRunId: ids.providerCapability,
        attemptId: ids.providerAttempt,
        leaseTokenHash: "d".repeat(64),
        leaseGeneration: 1,
        executionGeneration,
        operationKind: "query",
        source: "adapter",
        status: "succeeded",
        providerRequestId: "provider-request-fixture",
        output: staleOutput,
        responseDigest: jsonDigest(staleOutput),
        completionId: ids.providerCompletion,
        terminalOutboxEventId: ids.providerTerminalEvent,
        observedAt: new Date(fixtureAt.getTime() + 5),
        recordedAt: new Date(fixtureAt.getTime() + 5),
      } as const;
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation(staleObservation),
      ).resolves.toEqual({
        recorded: true,
        adoption: "noop_stale",
        terminal: false,
      });
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation(staleObservation),
      ).resolves.toEqual({
        recorded: false,
        adoption: "noop_stale",
        terminal: false,
      });
      const providerOutput = {
        artifactId: "artifact-provider-result",
      };
      const successObservation = {
        observationId: ids.providerSuccessObservation,
        observationKey: "query:success",
        invocationId: ids.providerInvocation,
        capabilityRunId: ids.providerCapability,
        attemptId: ids.providerAttempt,
        leaseTokenHash: "e".repeat(64),
        leaseGeneration: 2,
        executionGeneration,
        operationKind: "query" as const,
        source: "adapter" as const,
        status: "succeeded" as const,
        providerRequestId: "provider-request-fixture",
        output: providerOutput,
        responseDigest: jsonDigest(providerOutput),
        completionId: ids.providerCompletion,
        terminalOutboxEventId: ids.providerTerminalEvent,
        observedAt: new Date(fixtureAt.getTime() + 6),
        recordedAt: new Date(fixtureAt.getTime() + 6),
      };
      await pool.execute(
        `UPDATE capability_binding
         SET lifecycle_status = 'revoked',
             version = version + 1
         WHERE id = ?`,
        [ids.providerBinding],
      );
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation(
          successObservation,
        ),
      ).rejects.toMatchObject({
        code: "attempt_completion.lifecycle_rejected",
      });
      await pool.execute(
        `UPDATE capability_binding
         SET lifecycle_status = 'disabled',
             version = version + 1
         WHERE id = ?`,
        [ids.providerBinding],
      );
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation({
          ...successObservation,
          terminalOutboxEventId: ids.providerDispatch,
        }),
      ).rejects.toMatchObject({
        code: "ER_DUP_ENTRY",
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM provider_invocation_observation
           WHERE id = ?`,
          [ids.providerSuccessObservation],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM attempt_completion
           WHERE capability_attempt_id = ?`,
          [ids.providerAttempt],
        ),
      ).toBe(0);
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation(
          successObservation,
        ),
      ).resolves.toEqual({
        recorded: true,
        adoption: "applied",
        terminal: true,
      });
      await expect(
        providerInvocationStores[0].appendAndAdoptObservation(
          successObservation,
        ),
      ).resolves.toEqual({
        recorded: false,
        adoption: "applied",
        terminal: true,
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM provider_invocation
           WHERE capability_attempt_id = ?`,
          [ids.providerAttempt],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM provider_invocation_observation
           WHERE provider_invocation_id = ?`,
          [ids.providerInvocation],
        ),
      ).toBe(4);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM attempt_completion
           WHERE id = ?
             AND capability_attempt_id = ?
             AND terminal_outbox_event_id = ?`,
          [
            ids.providerCompletion,
            ids.providerAttempt,
            ids.providerTerminalEvent,
          ],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?
             AND message_type = 'capability.run.completed'
             AND aggregate_id = ?`,
          [ids.providerTerminalEvent, ids.providerCapability],
        ),
      ).toBe(1);
      const [providerCapabilityRows] = await pool.query<
        (RowDataPacket & {
          readonly lifecycleStatus: string;
          readonly acceptedAttemptId: string | null;
          readonly output: unknown;
        })[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           accepted_attempt_id AS acceptedAttemptId,
           output
         FROM capability_run
         WHERE id = ?`,
        [ids.providerCapability],
      );
      expect(providerCapabilityRows).toEqual([
        {
          lifecycleStatus: "completed",
          acceptedAttemptId: ids.providerAttempt,
          output: {
            artifactId: "artifact-provider-result",
          },
        },
      ]);
    });

    it("atomically retries an allowlisted retryable Provider failure observation", async () => {
      const engine = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker", "provider"],
      });
      const invocationStore = createProviderInvocationStore(pool, {
        instanceId,
        claimingEnabled: true,
        enabledExecutionTargets: ["worker", "provider"],
      });
      const start = await engine.startWorkflow({
        workflowRunId: providerFailureFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.providerFailureCapability,
          attemptId: ids.providerFailureAttempt,
          outboxEventId: ids.providerFailureDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: wakeupDelivery(providerFailureFixture),
      });
      expect(start.deliveryStatus).toBe("processed");

      const dispatchDelivery: InboxDelivery = {
        consumerName: "provider-attempt-dispatch.v1",
        eventId: ids.providerFailureDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.providerFailureAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 20),
      };
      const leaseTokenHash = "7".repeat(64);
      const claim = await invocationStore.claimDispatch({
        invocationId: ids.providerFailureInvocation,
        capabilityRunId: ids.providerFailureCapability,
        attemptId: ids.providerFailureAttempt,
        leaseTokenHash,
        now: dispatchDelivery.receivedAt,
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
        delivery: dispatchDelivery,
      });
      expect(claim).toMatchObject({
        deliveryStatus: "processed",
        outcome: "applied",
        resultCode: "provider.dispatch.claimed",
        value: {
          invocationId: ids.providerFailureInvocation,
          attemptId: ids.providerFailureAttempt,
        },
      });
      const failurePreparedRequest = {
        schemaVersion: 1,
        operation: "integration-test-failure",
      };
      await expect(
        invocationStore.recordPreparedRequest?.({
          invocationId: ids.providerFailureInvocation,
          capabilityRunId: ids.providerFailureCapability,
          attemptId: ids.providerFailureAttempt,
          leaseTokenHash,
          leaseGeneration: 1,
          executionGeneration,
          snapshot: failurePreparedRequest,
          digest: jsonDigest(failurePreparedRequest),
          now: new Date(fixtureAt.getTime() + 20),
        }),
      ).resolves.toBe(true);
      await expect(
        invocationStore.markSubmissionStarted({
          invocationId: ids.providerFailureInvocation,
          capabilityRunId: ids.providerFailureCapability,
          attemptId: ids.providerFailureAttempt,
          leaseTokenHash,
          leaseGeneration: 1,
          executionGeneration,
          now: new Date(fixtureAt.getTime() + 20),
        }),
      ).resolves.toBe(true);

      const observation = {
        observationId: ids.providerFailureObservation,
        observationKey: "invoke:retryable-failure",
        invocationId: ids.providerFailureInvocation,
        capabilityRunId: ids.providerFailureCapability,
        attemptId: ids.providerFailureAttempt,
        leaseTokenHash,
        leaseGeneration: 1,
        executionGeneration,
        operationKind: "invoke" as const,
        source: "adapter" as const,
        status: "failed" as const,
        stableErrorCode: "provider.remote_failed",
        retryability: "retryable" as const,
        nextAttemptId: ids.providerFailureNextAttempt,
        terminalOutboxEventId: ids.providerFailureRetryDispatch,
        observedAt: new Date(fixtureAt.getTime() + 21),
        recordedAt: new Date(fixtureAt.getTime() + 21),
      };
      await expect(
        invocationStore.appendAndAdoptObservation(observation),
      ).resolves.toEqual({
        recorded: true,
        adoption: "applied",
        terminal: true,
        failureTransition: "retried",
      });

      const [attemptRows] = await pool.query<
        (RowDataPacket & {
          readonly id: string;
          readonly lifecycleStatus: string;
          readonly routeCandidateIndex: number;
          readonly candidateAttemptNumber: number;
          readonly transitionKind: string;
          readonly retryDisposition: string | null;
        })[]
      >(
        `SELECT
           id,
           lifecycle_status AS lifecycleStatus,
           route_candidate_index AS routeCandidateIndex,
           candidate_attempt_number AS candidateAttemptNumber,
           transition_kind AS transitionKind,
           retry_disposition AS retryDisposition
         FROM capability_attempt
         WHERE capability_run_id = ?
         ORDER BY attempt_number`,
        [ids.providerFailureCapability],
      );
      expect(attemptRows).toEqual([
        {
          id: ids.providerFailureAttempt,
          lifecycleStatus: "failed",
          routeCandidateIndex: 0,
          candidateAttemptNumber: 1,
          transitionKind: "initial",
          retryDisposition: "retryable",
        },
        {
          id: ids.providerFailureNextAttempt,
          lifecycleStatus: "created",
          routeCandidateIndex: 0,
          candidateAttemptNumber: 2,
          transitionKind: "retry",
          retryDisposition: null,
        },
      ]);
      const [capabilityRows] = await pool.query<
        (RowDataPacket & {
          readonly lifecycleStatus: string;
          readonly currentAttemptId: string;
          readonly acceptedAttemptId: string | null;
        })[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           current_attempt_id AS currentAttemptId,
           accepted_attempt_id AS acceptedAttemptId
         FROM capability_run
         WHERE id = ?`,
        [ids.providerFailureCapability],
      );
      expect(capabilityRows).toEqual([
        {
          lifecycleStatus: "running",
          currentAttemptId: ids.providerFailureNextAttempt,
          acceptedAttemptId: null,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?
             AND message_type = 'attempt.dispatch.requested'
             AND aggregate_id = ?`,
          [ids.providerFailureRetryDispatch, ids.providerFailureNextAttempt],
        ),
      ).toBe(1);

      await expect(
        invocationStore.appendAndAdoptObservation(observation),
      ).resolves.toEqual({
        recorded: false,
        adoption: "applied",
        terminal: true,
      });
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE capability_run_id = ?`,
          [ids.providerFailureCapability],
        ),
      ).toBe(2);
      await expect(
        invocationStore.appendAndAdoptObservation({
          ...observation,
          retryability: "terminal",
        }),
      ).rejects.toMatchObject({
        code: "provider_invocation.identity_conflict",
      });
    });

    it("lets cancellation win a leased late Provider success without Atomic adoption", async () => {
      const engine = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker", "provider"],
      });
      const invocationStore = createProviderInvocationStore(pool, {
        instanceId,
        claimingEnabled: true,
      });
      const cancellationRequestedAt = new Date(fixtureAt.getTime() + 3);
      const cancellationDeadlineAt = new Date(fixtureAt.getTime() + 4);
      const start = await engine.startWorkflow({
        workflowRunId: providerCancelFixture.workflowRunId,
        ids: {
          capabilityRunId: ids.providerCancelCapability,
          attemptId: ids.providerCancelAttempt,
          outboxEventId: ids.providerCancelDispatch,
        },
        now: fixtureAt,
        executionGeneration,
        delivery: wakeupDelivery(providerCancelFixture),
      });
      expect(start.deliveryStatus).toBe("processed");

      const dispatchDelivery: InboxDelivery = {
        consumerName: "provider-attempt-dispatch.v1",
        eventId: ids.providerCancelDispatch,
        workspaceId: ids.workspace,
        messageType: "attempt.dispatch.requested",
        schemaVersion: 1,
        aggregateType: "capability_attempt",
        aggregateId: ids.providerCancelAttempt,
        aggregateVersion: 1,
        expectedGeneration: executionGeneration,
        receivedAt: new Date(fixtureAt.getTime() + 1),
      };
      const claim = await invocationStore.claimDispatch({
        invocationId: ids.providerCancelInvocation,
        capabilityRunId: ids.providerCancelCapability,
        attemptId: ids.providerCancelAttempt,
        leaseTokenHash: "f".repeat(64),
        now: new Date(fixtureAt.getTime() + 1),
        leaseUntil: new Date(fixtureAt.getTime() + 60_000),
        executionGeneration,
        delivery: dispatchDelivery,
      });
      expect(claim).toMatchObject({
        deliveryStatus: "processed",
        value: {
          workKind: "submit",
          leaseGeneration: 1,
        },
      });
      const cancellationPreparedRequest = {
        schemaVersion: 1,
        operation: "integration-test-cancellation",
      };
      expect(
        await invocationStore.recordPreparedRequest?.({
          invocationId: ids.providerCancelInvocation,
          capabilityRunId: ids.providerCancelCapability,
          attemptId: ids.providerCancelAttempt,
          leaseTokenHash: "f".repeat(64),
          leaseGeneration: 1,
          executionGeneration,
          snapshot: cancellationPreparedRequest,
          digest: jsonDigest(cancellationPreparedRequest),
          now: new Date(fixtureAt.getTime() + 2),
        }),
      ).toBe(true);
      expect(
        await invocationStore.markSubmissionStarted({
          invocationId: ids.providerCancelInvocation,
          capabilityRunId: ids.providerCancelCapability,
          attemptId: ids.providerCancelAttempt,
          leaseTokenHash: "f".repeat(64),
          leaseGeneration: 1,
          executionGeneration,
          now: new Date(fixtureAt.getTime() + 2),
        }),
      ).toBe(true);

      const cancellationConnection = await pool.getConnection();
      try {
        await cancellationConnection.beginTransaction();
        await cancellationConnection.execute(
          `UPDATE workflow_run
           SET lifecycle_status = 'cancelling',
               cancel_requested_at = ?,
               cancel_requested_by = ?,
               cancel_reason_code = 'integration_test',
               cancel_deadline_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'running'
             AND cancel_requested_at IS NULL`,
          [
            cancellationRequestedAt,
            ids.actor,
            cancellationDeadlineAt,
            cancellationRequestedAt,
            ids.providerCancelWorkflow,
          ],
        );
        await cancellationConnection.execute(
          `UPDATE capability_run
           SET cancel_requested_at = ?,
               cancel_deadline_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'running'
             AND cancel_requested_at IS NULL`,
          [
            cancellationRequestedAt,
            cancellationDeadlineAt,
            cancellationRequestedAt,
            ids.providerCancelCapability,
          ],
        );
        await cancellationConnection.execute(
          `UPDATE capability_attempt
           SET cancel_requested_at = ?,
               cancel_deadline_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND lifecycle_status = 'running'
             AND cancel_requested_at IS NULL`,
          [
            cancellationRequestedAt,
            cancellationDeadlineAt,
            cancellationRequestedAt,
            ids.providerCancelAttempt,
          ],
        );
        await cancellationConnection.commit();
      } catch (error) {
        await cancellationConnection.rollback();
        throw error;
      } finally {
        cancellationConnection.release();
      }
      const lateProviderOutput = {
        artifactId: "must-not-be-adopted",
      };
      const lateSuccess = {
        observationId: ids.providerCancelLateObservation,
        observationKey: "invoke:late-success-after-cancel",
        invocationId: ids.providerCancelInvocation,
        capabilityRunId: ids.providerCancelCapability,
        attemptId: ids.providerCancelAttempt,
        leaseTokenHash: "f".repeat(64),
        leaseGeneration: 1,
        executionGeneration,
        operationKind: "invoke" as const,
        source: "adapter" as const,
        status: "succeeded" as const,
        providerRequestId: "late-provider-request",
        output: lateProviderOutput,
        responseDigest: jsonDigest(lateProviderOutput),
        completionId: ids.providerCancelUnusedCompletion,
        terminalOutboxEventId: ids.providerCancelTerminalEvent,
        observedAt: new Date(fixtureAt.getTime() + 3),
        recordedAt: new Date(fixtureAt.getTime() + 3),
      };
      await expect(
        invocationStore.appendAndAdoptObservation(lateSuccess),
      ).resolves.toEqual({
        recorded: true,
        adoption: "noop_cancelled",
        terminal: true,
      });
      await expect(
        invocationStore.appendAndAdoptObservation(lateSuccess),
      ).resolves.toEqual({
        recorded: false,
        adoption: "noop_cancelled",
        terminal: true,
      });

      const [cancelledRows] = await pool.query<
        (RowDataPacket & {
          readonly capabilityStatus: string;
          readonly acceptedAttemptId: string | null;
          readonly output: unknown;
          readonly attemptStatus: string;
          readonly attemptSideEffectState: string;
          readonly retryDisposition: string | null;
          readonly remoteStatus: string;
          readonly invocationSideEffectState: string;
          readonly workState: string;
          readonly reconcileLeaseTokenHash: string | null;
        })[]
      >(
        `SELECT
           capability.lifecycle_status AS capabilityStatus,
           capability.accepted_attempt_id AS acceptedAttemptId,
           capability.output,
           attempt.lifecycle_status AS attemptStatus,
           attempt.side_effect_state AS attemptSideEffectState,
           attempt.retry_disposition AS retryDisposition,
           invocation.remote_status AS remoteStatus,
           invocation.side_effect_state AS invocationSideEffectState,
           invocation.work_state AS workState,
           invocation.reconcile_lease_token_hash AS reconcileLeaseTokenHash
         FROM capability_run AS capability
         INNER JOIN capability_attempt AS attempt
           ON attempt.id = capability.current_attempt_id
         INNER JOIN provider_invocation AS invocation
           ON invocation.capability_attempt_id = attempt.id
         WHERE capability.id = ?`,
        [ids.providerCancelCapability],
      );
      expect(cancelledRows).toEqual([
        {
          capabilityStatus: "cancelled",
          acceptedAttemptId: null,
          output: null,
          attemptStatus: "abandoned",
          attemptSideEffectState: "committed",
          retryDisposition: "manual",
          remoteStatus: "succeeded",
          invocationSideEffectState: "committed",
          workState: "terminal",
          reconcileLeaseTokenHash: null,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?
             AND message_type = 'capability.run.cancelled'
             AND aggregate_id = ?`,
          [ids.providerCancelTerminalEvent, ids.providerCancelCapability],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM provider_invocation_observation
           WHERE provider_invocation_id = ?
             AND adoption_outcome = 'noop_cancelled'`,
          [ids.providerCancelInvocation],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM attempt_completion
           WHERE capability_attempt_id = ?`,
          [ids.providerCancelAttempt],
        ),
      ).toBe(0);
    });

    it("rejects a conflicting envelope without a domain effect and allows independent consumers", async () => {
      const canonicalDelivery = wakeupDelivery(envelopeFixture);
      await expect(
        createWorkflowEngineStore(pool).startWorkflow({
          workflowRunId: envelopeFixture.workflowRunId,
          ids: {
            capabilityRunId: ids.envelopeCapability,
            attemptId: ids.envelopeAttempt,
            outboxEventId: ids.envelopeDispatch,
          },
          now: fixtureAt,
          executionGeneration,
          delivery: {
            ...canonicalDelivery,
            aggregateVersion: canonicalDelivery.aggregateVersion + 1,
          },
        }),
      ).rejects.toMatchObject({
        code: "inbox.event.envelope_mismatch",
      });

      const [workflowRows] = await pool.query<WorkflowStateRow[]>(
        `SELECT lifecycle_status AS lifecycleStatus, version
         FROM workflow_run
         WHERE id = ?`,
        [envelopeFixture.workflowRunId],
      );
      expect(workflowRows).toEqual([
        {
          lifecycleStatus: "queued",
          version: 1,
        },
      ]);
      const [nodeRows] = await pool.query<NodeStateRow[]>(
        `SELECT lifecycle_status AS lifecycleStatus, version
         FROM node_run
         WHERE id = ?`,
        [envelopeFixture.nodeRunId],
      );
      expect(nodeRows).toEqual([
        {
          lifecycleStatus: "pending",
          version: 1,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_run
           WHERE id = ?`,
          [ids.envelopeCapability],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [canonicalDelivery.consumerName, canonicalDelivery.eventId],
        ),
      ).toBe(0);

      const independentDeliveries = [
        {
          ...canonicalDelivery,
          consumerName: "integration-probe-a.v1",
        },
        {
          ...canonicalDelivery,
          consumerName: "integration-probe-b.v1",
        },
      ] as const;
      const observations = await Promise.all([
        consumeDirect(independentDeliveries[0], "integration.probe_a.observed"),
        consumeDirect(independentDeliveries[1], "integration.probe_b.observed"),
      ]);

      expect(
        observations.every((result) => result.deliveryStatus === "processed"),
      ).toBe(true);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE event_id = ?
             AND consumer_name IN (?, ?)`,
          [
            canonicalDelivery.eventId,
            independentDeliveries[0].consumerName,
            independentDeliveries[1].consumerName,
          ],
        ),
      ).toBe(2);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_run
           WHERE node_run_id = ?`,
          [envelopeFixture.nodeRunId],
        ),
      ).toBe(0);
    });

    it("rolls back the provisional receipt for a future aggregate version", async () => {
      const delivery = wakeupDelivery(futureFixture);
      await expect(
        createWorkflowEngineStore(pool).startWorkflow({
          workflowRunId: futureFixture.workflowRunId,
          ids: {
            capabilityRunId: ids.futureCapability,
            attemptId: ids.futureAttempt,
            outboxEventId: ids.futureDispatch,
          },
          now: fixtureAt,
          executionGeneration,
          delivery,
        }),
      ).rejects.toMatchObject({
        code: "inbox.event.future_version",
      });

      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM inbox_receipt
           WHERE consumer_name = ?
             AND event_id = ?`,
          [delivery.consumerName, delivery.eventId],
        ),
      ).toBe(0);
      const [workflowRows] = await pool.query<WorkflowStateRow[]>(
        `SELECT lifecycle_status AS lifecycleStatus, version
         FROM workflow_run
         WHERE id = ?`,
        [futureFixture.workflowRunId],
      );
      expect(workflowRows).toEqual([
        {
          lifecycleStatus: "queued",
          version: 1,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_run
           WHERE id = ?`,
          [ids.futureCapability],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM capability_attempt
           WHERE id = ?`,
          [ids.futureAttempt],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*) AS count
           FROM outbox_event
           WHERE id = ?`,
          [ids.futureDispatch],
        ),
      ).toBe(0);
    });

    it("projects a redacted authority-checked Operational Timeline from canonical facts", async () => {
      await pool.execute(
        `INSERT INTO workspace_membership (
           id, organization_id, workspace_id, principal_id,
           role, status, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
        [
          ids.timelineMembership,
          ids.workspace,
          ids.workspace,
          ids.actor,
          fixtureAt,
          fixtureAt,
        ],
      );
      const authority: TrustedWorkspaceScope = {
        workspaceId: ids.workspace,
        organizationId: ids.workspace,
        principalId: ids.actor,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: identity(9_800_002),
        authorityType: "human_membership",
        authorityId: ids.timelineMembership,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: permissionsForWorkspaceRole("admin"),
        trusted: true,
      };
      const store = createOperationalTimelineStore(pool);
      const capabilityRuns = createCapabilityRunStore(pool, {
        instanceId,
        resultDownloadDeployment: {
          enabled: true,
          allowedOrigins: ["https://files.example.test"],
        },
      });
      const readAt = new Date("2026-07-27T20:00:00.000Z");
      expect(
        (await capabilityRuns.get(authority, ids.providerCapability, readAt))
          .externalResultUrls,
      ).toBeUndefined();
      const [originalRuns] = await pool.query<RowDataPacket[]>(
        "SELECT lifecycle_status, accepted_attempt_id, output, created_by, invocation_kind, node_run_id, idempotency_key, request_hash FROM capability_run WHERE id = ?",
        [ids.providerCapability],
      );
      const original = originalRuns[0]!;
      try {
        await pool.execute(
          "UPDATE capability_run SET lifecycle_status = 'failed', accepted_attempt_id = NULL, output = NULL WHERE id = ?",
          [ids.providerCapability],
        );
        expect(
          (await capabilityRuns.get(authority, ids.providerCapability, readAt))
            .externalResultUrls,
        ).toEqual(["https://files.example.test/result.png?signature=private"]);
        // Dynamic policy stores evidence without the old pre-approved link field.
        await pool.execute(
          "UPDATE provider_invocation_observation SET result_facts=JSON_REMOVE(result_facts, '$.resultUrls') WHERE id=?",
          [`01K${"9".repeat(23)}`],
        );
        expect(
          (await capabilityRuns.get(authority, ids.providerCapability, readAt))
            .externalResultUrls,
        ).toEqual(["https://files.example.test/result.png?signature=private"]);
        const disabledLinks = createCapabilityRunStore(pool, {
          instanceId,
          resultDownloadDeployment: { enabled: false, allowedOrigins: null },
        });
        expect(
          (await disabledLinks.get(authority, ids.providerCapability, readAt))
            .externalResultUrls,
        ).toBeUndefined();
        const policy = {
          activated: true,
          agent: {
            maximumModelCalls: 50,
            maximumToolCalls: 100,
            timeoutSeconds: 600,
          },
          downloads: {
            defaults: { enabled: true, allowedOrigins: [] },
            providers: [
              {
                workspaceId: ids.workspace,
                providerEndpointId: ids.providerEndpoint,
                rule: {
                  enabled: true,
                  allowedOrigins: ["https://blocked.example.test"],
                },
              },
            ],
          },
        };
        await pool.execute(
          "INSERT INTO instance_runtime_configuration_revision (instance_id,version,document,reason,published_by,published_at) VALUES (?,1,?,'test original links',?,?)",
          [instanceId, JSON.stringify(policy), ids.actor, readAt],
        );
        try {
          // The current service override replaces historical/deployment origin approval.
          expect(
            (
              await capabilityRuns.get(
                authority,
                ids.providerCapability,
                readAt,
              )
            ).externalResultUrls,
          ).toEqual([
            "https://blocked.example.test/original.png?signature=private",
          ]);
          expect(
            (await disabledLinks.get(authority, ids.providerCapability, readAt))
              .externalResultUrls,
          ).toBeUndefined();
          policy.downloads.providers = [];
          await pool.execute(
            "UPDATE instance_runtime_configuration_revision SET document=? WHERE instance_id=? AND version=1",
            [JSON.stringify(policy), instanceId],
          );
          expect(
            (
              await capabilityRuns.get(
                authority,
                ids.providerCapability,
                readAt,
              )
            ).externalResultUrls,
          ).toBeUndefined();
        } finally {
          await pool.execute(
            "DELETE FROM instance_runtime_configuration_revision WHERE instance_id=? AND version=1",
            [instanceId],
          );
        }
        const recovery = createProviderResultRecoveryStore(pool, instanceId);
        const ownerId = identity(9_899_010);
        const ownerMembership = identity(9_899_011);
        await pool.execute(
          "INSERT INTO principal (id,principal_type,status,version,created_at,updated_at) VALUES (?,'human','active',1,?,?)",
          [ownerId, readAt, readAt],
        );
        await pool.execute(
          "INSERT INTO human_principal (principal_id,auth_subject_id,created_at) VALUES (?,'recovery-owner',?)",
          [ownerId, readAt],
        );
        await pool.execute(
          "INSERT INTO workspace_membership (id,organization_id,workspace_id,principal_id,role,status,version,created_at,updated_at) VALUES (?,?,?,?,'editor','active',1,?,?)",
          [
            ownerMembership,
            ids.workspace,
            ids.workspace,
            ownerId,
            readAt,
            readAt,
          ],
        );
        const ownerAuthority: TrustedWorkspaceScope = {
          ...authority,
          principalId: ownerId,
          authorityId: ownerMembership,
          effectivePermissions: permissionsForWorkspaceRole("editor"),
        };
        await expect(
          recovery.view(ownerAuthority, ids.providerCapability, readAt),
        ).rejects.toBeDefined();
        await expect(
          recovery.enqueue(
            ownerAuthority,
            ids.providerCapability,
            "unauthorized",
            readAt,
          ),
        ).rejects.toBeDefined();
        await pool.execute(
          "UPDATE capability_run SET created_by=?,invocation_kind='agent',node_run_id=NULL,idempotency_key='admin-recovery-fixture',request_hash=? WHERE id=?",
          [ownerId, digest("f"), ids.providerCapability],
        );
        const queued = await recovery.enqueue(
          authority,
          ids.providerCapability,
          "recovery-test",
          readAt,
        );
        expect(queued.items).toHaveLength(2);
        expect(queued.canDownload).toBe(false);
        expect(
          queued.items.every((item) => item.initiatedByAdministrator),
        ).toBe(true);
        const ownerView = await recovery.view(
          ownerAuthority,
          ids.providerCapability,
          readAt,
        );
        expect(ownerView.canDownload).toBe(true);
        expect(ownerView.items).toEqual(queued.items);
        // A user request while an administrator's request is active reuses the batch.
        expect(
          (
            await recovery.enqueue(
              ownerAuthority,
              ids.providerCapability,
              "owner-concurrent",
              readAt,
            )
          ).items,
        ).toEqual(queued.items);
        expect(
          (
            await recovery.enqueue(
              authority,
              ids.providerCapability,
              "recovery-test",
              readAt,
            )
          ).items,
        ).toHaveLength(2);
        const claim = await recovery.claim("c".repeat(64), readAt);
        expect(claim?.url).toMatch(
          /^https:\/\/(files|blocked)\.example\.test\//u,
        );
        expect(await recovery.renew(claim!.id, "d".repeat(64), readAt)).toBe(
          false,
        );
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await expect(
            authorizeRecoveryCommit(connection, {
              id: claim!.id,
              leaseToken: "wrong",
              authority,
              uploadSessionId: claim!.uploadSessionId,
              storedObjectId: claim!.storedObjectId,
              artifactId: claim!.artifactId,
              now: readAt,
            }),
          ).rejects.toMatchObject({ code: "result_recovery.conflict" });
          expect(
            await authorizeRecoveryCommit(connection, {
              id: claim!.id,
              leaseToken: claim!.leaseToken,
              authority,
              uploadSessionId: claim!.uploadSessionId,
              storedObjectId: claim!.storedObjectId,
              artifactId: claim!.artifactId,
              now: readAt,
            }),
          ).toBe(ids.providerCapability);
          await connection.rollback();
        } finally {
          connection.release();
        }
        const storage = createStorageUploadStore(pool);
        await storage.recordCompatibilityProbe({
          id: identity(9_810_001),
          workspaceId: ids.workspace,
          probeKey: "local.content-transfer.v1",
          requestHash: digest("1"),
          storageProfileId: identity(9_810_002),
          profileConfigurationHash: digest("2"),
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
          resultHash: digest("3"),
          evidence: {
            serverOwned: true,
          },
          testedAt: readAt,
          validUntil: new Date(readAt.getTime() + 60_000),
          createdAt: readAt,
        });
        await storage.allocateUploadSession({
          id: claim!.uploadSessionId,
          workspaceId: ids.workspace,
          actorId: ids.actor,
          authority,
          allocationRequestKey: "content-transfer-primary",
          allocationRequestHash: digest("4"),
          purpose: "user_import",
          expectedSize: "68",
          expectedMediaType: "image/png",
          expectedSha256: "a".repeat(64),
          storageProfileId: identity(9_810_002),
          compatibilityProbeId: identity(9_810_001),
          profileConfigurationHash: digest("2"),
          container: "objects",
          objectKey: `workspaces/${ids.workspace}/user-imports/${claim!.uploadSessionId}`,
          uploadMode: "server_stream",
          writeProtectionMode: "server_owned",
          verificationProfileVersion: "trusted-image-structural-v1",
          now: readAt,
          expiresAt: new Date(readAt.getTime() + 60_000),
          cleanupEligibleAt: new Date(readAt.getTime() + 120_000),
        });
        await storage.beginUpload({
          workspaceId: ids.workspace,
          uploadSessionId: claim!.uploadSessionId,
          now: readAt,
        });
        await storage.beginSeal({
          workspaceId: ids.workspace,
          uploadSessionId: claim!.uploadSessionId,
          sealManifestHash: digest("5"),
          now: readAt,
        });
        await storage.recordSeal({
          workspaceId: ids.workspace,
          uploadSessionId: claim!.uploadSessionId,
          sealManifestHash: digest("5"),
          sealedIdentityHash: digest("6"),
          now: readAt,
        });
        const verificationToken = "b".repeat(64);
        const verificationClaim = await storage.claimVerification({
          workspaceId: ids.workspace,
          uploadSessionId: claim!.uploadSessionId,
          processingLeaseTokenHash: verificationToken,
          now: readAt,
          leaseExpiresAt: new Date(readAt.getTime() + 60_000),
        });
        await storage.recordVerified({
          workspaceId: ids.workspace,
          uploadSessionId: claim!.uploadSessionId,
          processingLeaseGeneration:
            verificationClaim.processingLeaseGeneration,
          processingLeaseTokenHash: verificationToken,
          verifiedSize: "68",
          verifiedSha256: "a".repeat(64),
          detectedMediaType: "image/png",
          verificationResultHash: digest("7"),
          now: readAt,
        });
        const transfers = createContentTransferStore(pool, { instanceId });
        const commit = {
          authority,
          recoveryId: claim!.id,
          leaseToken: claim!.leaseToken,
          uploadSessionId: claim!.uploadSessionId,
          storedObjectId: claim!.storedObjectId,
          artifactId: claim!.artifactId,
          outboxEventId: identity(9_899_003),
          artifactType: "image",
          dataClassification: "internal" as const,
          metadata: { recoveryId: claim!.id },
          audit: {
            auditEventId: identity(9_899_004),
            authenticationRefHash: digest("a"),
          },
          now: readAt,
        };
        await expect(
          transfers.commitRecoveredProviderResult({
            ...commit,
            leaseToken: "wrong",
          }),
        ).rejects.toMatchObject({ code: "result_recovery.conflict" });
        await pool.execute(
          "UPDATE workspace_membership SET role='editor' WHERE id=?",
          [authority.authorityId],
        );
        await expect(
          transfers.commitRecoveredProviderResult(commit),
        ).rejects.toBeDefined();
        await pool.execute(
          "UPDATE workspace_membership SET role='admin' WHERE id=?",
          [authority.authorityId],
        );
        await transfers.commitRecoveredProviderResult(commit);
        const [recovered] = await pool.query<RowDataPacket[]>(
          "SELECT a.created_by_capability_run_id AS runId,a.created_by_principal_id AS owner,r.actor_id AS operatorId,r.state FROM artifact a JOIN provider_result_recovery r ON r.artifact_id=a.id WHERE a.id=?",
          [claim!.artifactId],
        );
        expect(recovered[0]).toMatchObject({
          runId: ids.providerCapability,
          owner: null,
          operatorId: ids.actor,
          state: "succeeded",
        });
        expect(
          (await recovery.view(ownerAuthority, ids.providerCapability, readAt))
            .items,
        ).toContainEqual(
          expect.objectContaining({
            artifactId: claim!.artifactId,
            state: "succeeded",
            initiatedByAdministrator: true,
          }),
        );
        expect(
          await transfers.authorizeArtifactDownload({
            authority: ownerAuthority,
            artifactId: claim!.artifactId,
            purpose: "download",
            decisionId: identity(9_899_012),
            audit: {
              auditEventId: identity(9_899_013),
              authenticationRefHash: digest("a"),
            },
            now: readAt,
            validUntil: new Date(readAt.getTime() + 30000),
          }),
        ).toMatchObject({ decision: "allow" });
        expect(
          await transfers.authorizeArtifactDownload({
            authority,
            artifactId: claim!.artifactId,
            purpose: "download",
            decisionId: identity(9_899_014),
            audit: {
              auditEventId: identity(9_899_015),
              authenticationRefHash: digest("a"),
            },
            now: readAt,
            validUntil: new Date(readAt.getTime() + 30000),
          }),
        ).toMatchObject({ decision: "deny" });
        // Revoked delegation stops the remaining queued result before network I/O.
        await pool.execute(
          "UPDATE workspace_membership SET role='editor' WHERE id=?",
          [authority.authorityId],
        );
        expect(await recovery.claim("e".repeat(64), readAt)).toBeUndefined();
        await pool.execute(
          "UPDATE workspace_membership SET role='admin' WHERE id=?",
          [authority.authorityId],
        );
        const retried = await recovery.enqueue(
          authority,
          ids.providerCapability,
          "retry-incomplete",
          readAt,
        );
        expect(
          retried.items.filter((item) => item.state === "queued"),
        ).toHaveLength(1);
        expect(
          retried.items.filter((item) => item.state === "succeeded"),
        ).toHaveLength(1);
        const [unchanged] = await pool.query<RowDataPacket[]>(
          "SELECT lifecycle_status AS state FROM capability_run WHERE id=?",
          [ids.providerCapability],
        );
        expect(unchanged[0]?.state).toBe("failed");
        await recovery.fail(
          claim!.id,
          claim!.leaseToken,
          "provider.output_origin_not_allowed",
          readAt,
        );
        expect(
          JSON.stringify(
            await recovery.view(authority, ids.providerCapability, readAt),
          ),
        ).not.toContain("signature=private");
        await expect(
          recovery.view(
            { ...authority, principalId: identity(9_999_999) },
            ids.providerCapability,
            readAt,
          ),
        ).rejects.toBeDefined();

        await expect(
          capabilityRuns.get(
            { ...authority, principalId: identity(9_999_999) },
            ids.providerCapability,
            readAt,
          ),
        ).rejects.toBeDefined();
      } finally {
        await pool.execute(
          "UPDATE capability_run SET lifecycle_status = ?, accepted_attempt_id = ?, output = ?, created_by = ?, invocation_kind=?,node_run_id=?,idempotency_key=?,request_hash=? WHERE id = ?",
          [
            original.lifecycle_status,
            original.accepted_attempt_id,
            typeof original.output === "string"
              ? original.output
              : JSON.stringify(original.output),
            original.created_by,
            original.invocation_kind,
            original.node_run_id,
            original.idempotency_key,
            original.request_hash,
            ids.providerCapability,
          ],
        );
      }
      const timeline = await store.get({
        authority,
        workflowRunId: ids.raceWorkflow,
        now: new Date("2026-07-27T20:00:00.000Z"),
        limit: 100,
      });

      expect(timeline.truncated).toBe(false);
      expect(new Set(timeline.items.map(({ source }) => source))).toEqual(
        new Set([
          "workflow_run",
          "node_run",
          "capability_run",
          "capability_attempt",
          "outbox_event",
          "inbox_receipt",
        ]),
      );
      expect(
        timeline.items.every(
          (item, index, items) =>
            index === 0 || items[index - 1]!.occurredAt <= item.occurredAt,
        ),
      ).toBe(true);
      expect(JSON.stringify(timeline)).not.toContain("inbox-race");
      expect(JSON.stringify(timeline)).not.toContain("lease_token_hash");
      const timelineAttempt = timeline.items.find(
        ({ source }) => source === "capability_attempt",
      );
      expect(timelineAttempt?.facts).toHaveProperty("transitionKind");
      expect(timelineAttempt?.facts).toHaveProperty("transitionReasonCode");
      await expect(
        store.get({
          authority,
          workflowRunId: ids.raceWorkflow,
          now: new Date("2026-07-27T20:00:30.000Z"),
          limit: 1,
        }),
      ).resolves.toMatchObject({
        truncated: true,
        items: [{}],
      });
      await createRuntimeConfigurationStore(
        pool,
        instanceId,
      ).recordResultDecision({
        workspaceId: ids.workspace,
        invocationId: ids.providerInvocation,
        version: 7,
        origin: "https://blocked.example.test",
        source: "instance",
        outcome: "provider.output_origin_not_allowed",
      });
      const providerTimeline = await store.get({
        authority,
        workflowRunId: ids.providerWorkflow,
        now: new Date("2026-07-27T20:00:40.000Z"),
        limit: 100,
      });
      expect(
        providerTimeline.items.some((item) =>
          String(item.facts.resultOrigins ?? "").includes(
            "https://blocked.example.test",
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(providerTimeline)).not.toContain(
        "signature=private",
      );
      expect(JSON.stringify(providerTimeline)).not.toContain(
        'resultEvidence":',
      );

      expect(
        providerTimeline.items.find(
          (item) => item.kind === "provider.result_policy.checked",
        )?.facts,
      ).toMatchObject({
        policyVersion: 7,
        resultOrigin: "https://blocked.example.test",
      });
      const providerSources = new Set(
        providerTimeline.items.map(({ source }) => source),
      );
      expect(providerSources.has("provider_invocation")).toBe(true);
      expect(providerSources.has("provider_observation")).toBe(true);

      await pool.execute(
        `UPDATE workspace_membership
         SET status = 'revoked', version = version + 1, updated_at = ?
         WHERE id = ?`,
        [new Date("2026-07-27T20:01:00.000Z"), ids.timelineMembership],
      );
      await expect(
        store.get({
          authority,
          workflowRunId: ids.raceWorkflow,
          now: new Date("2026-07-27T20:02:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "operational_timeline.forbidden",
      });
    });
  },
);
