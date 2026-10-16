import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  authorizationModelVersion,
  createApplicationRuntime,
  type RuntimeStateReader,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  loadDatabaseConnectionConfig,
  readMigrationInventory,
  type DatabaseConnectionConfig,
} from "@kanvas/database";
import {
  AtomicAttemptCompletionStoreError,
  createAtomicAttemptCompletionStore,
  createStorageUploadStore,
  digestProviderValue,
  type AtomicAttemptCompletionStore,
  type StorageUploadStore,
} from "@kanvas/database/runtime";
import { resolveAttemptOutputArtifactReferences } from "@kanvas/contracts/capability";
import {
  createStorageGarbageCollectionCoordinator,
  createTrustedImageStorageRuntime,
  verifyTrustedImage,
  type TrustedImageStorageConfig,
  type TrustedImageStorageRuntime,
} from "@kanvas/storage";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkerAdapterExecutionResult } from "../src/adapter/worker-adapter.js";
import { createWorkerRuntimeAdapterRegistry } from "../src/adapter/worker-runtime-adapters.js";
import { createWorkerAttemptOutputMaterializer } from "../src/storage/worker-attempt-output-materializer.js";
import { createWorkerInputArtifactResolver } from "../src/storage/worker-input-artifact-resolver.js";
import { StorageGarbageCollectionLoop } from "../src/storage/storage-garbage-collection-loop.js";
import {
  createDeterministicRgbaPng,
  deterministicImageDerivedPngAdapterKey,
} from "./support/deterministic-image-derived-png-adapter.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const executionGeneration = 73;
const instanceId = "worker-trusted-image-round-trip";
const leaseTokenHash = "a".repeat(64);
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const ids = Object.freeze({
  organization: identity(16_000_001),
  workspace: identity(16_000_002),
  actor: identity(16_000_003),
  storageProfile: identity(16_000_004),
  sourceProbe: identity(16_000_005),
  sourceUpload: identity(16_000_006),
  sourceStoredObject: identity(16_000_007),
  sourceArtifact: identity(16_000_008),
  contractRevision: identity(16_000_009),
  implementationRevision: identity(16_000_010),
  binding: identity(16_000_011),
  workflowRevision: identity(16_000_012),
  workflowRun: identity(16_000_013),
  nodeRun: identity(16_000_014),
  capabilityRun: identity(16_000_015),
  attempt: identity(16_000_016),
  outputProbe: identity(16_000_022),
  outputUpload: identity(16_000_023),
  outputStoredObject: identity(16_000_024),
  outputArtifact: identity(16_000_025),
  attemptOutput: identity(16_000_026),
  randomObject: identity(16_000_027),
  completion: identity(16_000_028),
  terminalOutbox: identity(16_000_029),
  orphanWorkflowRun: identity(16_000_030),
  orphanNodeRun: identity(16_000_031),
  orphanCapabilityRun: identity(16_000_032),
  orphanAttempt: identity(16_000_033),
  orphanOutputProbe: identity(16_000_039),
  orphanOutputUpload: identity(16_000_040),
  orphanOutputStoredObject: identity(16_000_041),
  orphanOutputArtifact: identity(16_000_042),
  orphanAttemptOutput: identity(16_000_043),
  orphanRandomObject: identity(16_000_044),
  orphanCompletion: identity(16_000_045),
  orphanTerminalOutbox: identity(16_000_046),
  capabilityDefinition: identity(16_000_047),
  declarationRevision: identity(16_000_048),
  adapterDefinition: identity(16_000_049),
  adapterRevision: identity(16_000_050),
  authenticationRef: identity(16_000_051),
  workspaceMembership: identity(16_000_052),
  organizationMembership: identity(16_000_053),
});

const contractDigest = digest("3");
const implementationDigest = digest("1");
const workflowDigest = digest("4");
const adapterDigest = digest("2");
const sourceAuthority = Object.freeze({
  workspaceId: ids.workspace,
  organizationId: ids.organization,
  principalId: ids.actor,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: ids.authenticationRef,
  authorityType: "human_membership",
  authorityId: ids.workspaceMembership,
  authorityVersion: 1,
  authorizationModelVersion,
  effectivePermissions: Object.freeze(["asset.write"] as const),
  trusted: true,
} satisfies TrustedWorkspaceScope);
const inputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", pointer: "" }),
});
const compiledInputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", path: [] }),
});
const outputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", pointer: "" }),
});
const compiledOutputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", path: [] }),
});
const runtimeAdapterDocument = Object.freeze({
  schemaVersion: "kanvas.runtime-adapter-definition/v1" as const,
  adapterKey: deterministicImageDerivedPngAdapterKey,
  revision: 1,
  displayName: Object.freeze({
    defaultLocale: "en-US",
    values: Object.freeze({
      "en-US": "Deterministic image Adapter",
      "zh-CN": "确定性图片适配器",
    }),
  }),
  executionTarget: "worker" as const,
  sourceKinds: ["plugin" as const],
  supportedModelFormats: [],
  invocationInputSchema: Object.freeze({ type: "object" }),
  invocationOutputSchema: Object.freeze({ type: "object" }),
  configurationSchema: Object.freeze({ type: "object" }),
  artifactInputs: [],
  executable: Object.freeze({
    kind: "built_in" as const,
    packageKey: "kanvas.test-runtime",
    packageVersion: "1",
    entrypoint: deterministicImageDerivedPngAdapterKey,
    releaseDigest: adapterDigest,
  }),
});

interface CompletionFactsRow extends RowDataPacket {
  readonly capabilityStatus: string;
  readonly acceptedAttemptId: string | null;
  readonly attemptStatus: string;
  readonly uploadState: string;
  readonly artifactId: string;
  readonly storedObjectId: string;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface UploadCleanupFactsRow extends RowDataPacket {
  readonly state: string;
  readonly cleanupState: string;
  readonly cleanupResult: string | null;
  readonly committedStoredObjectId: string | null;
}

interface RuntimeStateRow extends RowDataPacket {
  readonly state: "ACTIVE" | "DRAINING" | "MAINTENANCE";
  readonly executionGeneration: number;
  readonly stateVersion: number;
  readonly deadline: Date | null;
}

function disposableDatabaseName(): string {
  const name = `kanvas_worker_image_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function createAdminPool(): {
  readonly pool: Pool;
  readonly networkConfig?: DatabaseConnectionConfig;
} {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return {
      pool: createPool({
        socketPath,
        user: process.env.KANVAS_DATABASE_USER ?? "root",
        password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
        connectionLimit: 2,
        multipleStatements: true,
        timezone: "Z",
        decimalNumbers: false,
      }),
    };
  }
  const networkConfig = loadDatabaseConnectionConfig(process.env);
  return {
    networkConfig,
    pool: createPool({
      host: networkConfig.host,
      port: networkConfig.port,
      user: networkConfig.user,
      password: networkConfig.password,
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
      decimalNumbers: false,
    }),
  };
}

function createDomainPool(
  databaseName: string,
  networkConfig?: DatabaseConnectionConfig,
): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      database: databaseName,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 6,
      timezone: "Z",
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  if (!networkConfig) {
    throw new Error(
      "Network database configuration is required without a socket.",
    );
  }
  return createPool({
    host: networkConfig.host,
    port: networkConfig.port,
    database: databaseName,
    user: networkConfig.user,
    password: networkConfig.password,
    connectionLimit: 6,
    timezone: "Z",
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

function storageConfig(rootDirectory: string): TrustedImageStorageConfig {
  const verificationLimits = Object.freeze({
    maximumInputBytes: 1_048_576,
    maximumWidth: 256,
    maximumHeight: 256,
    maximumPixels: 65_536,
    maximumDecodedBytes: 1_048_576,
    maximumExpansionRatio: 100_000,
    requireDecodedVerification: false as const,
  });
  const profileConfigurationHash = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        contract: "kanvas.worker-image-integration-storage/v1",
        profileId: ids.storageProfile,
        container: "objects",
        rootDirectory,
        verificationLimits,
      }),
    )
    .digest("hex")}`;
  return Object.freeze({
    kind: "local",
    profileId: ids.storageProfile,
    container: "objects",
    rootDirectory,
    profileConfigurationHash,
    verificationProfileVersion: "trusted-image-structural-v1",
    verificationLeaseMilliseconds: 5_000,
    cleanupGraceMilliseconds: 60_000,
    modelResourceMaximumInputBytes: 64 * 1024 * 1024,
    verificationLimits,
  });
}

async function* bytesBody(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function assertAdapterResult(
  value: unknown,
): asserts value is WorkerAdapterExecutionResult {
  if (
    !value ||
    typeof value !== "object" ||
    !("protocol" in value) ||
    value.protocol !== "kanvas.worker-adapter-result/v1" ||
    !("outputs" in value) ||
    !Array.isArray(value.outputs) ||
    !("capabilityOutput" in value)
  ) {
    throw new TypeError(
      "Deterministic Worker Adapter returned an invalid result.",
    );
  }
}

function executionPlan(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    topology: Object.freeze({
      schemaVersion: 1,
      key: "worker_image_integration",
      entryNodeKey: "main",
      limits: Object.freeze({ maxNodeRuns: 1, timeoutMs: 300_000 }),
      nodes: Object.freeze([
        Object.freeze({
          key: "main",
          kind: "invoke",
          capability: Object.freeze({
            contractId: "test.image.background.remove",
            revision: 1,
            canonicalDigest: contractDigest,
          }),
          input: Object.freeze({}),
          next: Object.freeze([]),
        }),
      ]),
      outputs: Object.freeze({}),
    }),
    routes: Object.freeze([
      Object.freeze({
        nodeKey: "main",
        contractRevisionId: ids.contractRevision,
        contractKey: "test.image.background.remove",
        contractRevision: 1,
        contractDigest,
        candidates: Object.freeze([
          Object.freeze({
            candidateIndex: 0,
            idempotencyMode: "keyed",
            bindingId: ids.binding,
            bindingVersion: 1,
            implementationRevisionId: ids.implementationRevision,
            implementationDigest,
            adapterKey: deterministicImageDerivedPngAdapterKey,
            executionTarget: "worker",
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

async function seedExecutionFixture(
  pool: Pool,
  input: unknown,
  fixtureNow: Date,
  executionDeadlineAt: Date,
): Promise<void> {
  const createdAt = new Date(fixtureNow.getTime() - 1_000);
  const leaseExpiresAt = new Date(fixtureNow.getTime() + 300_000);
  const plan = executionPlan();
  const routeSnapshot = (plan.routes as readonly unknown[])[0];

  await pool.execute(
    `INSERT INTO instance_runtime_state (
       instance_id, state, execution_generation, state_version,
       reason, deadline, changed_by, changed_at
     ) VALUES (?, 'ACTIVE', ?, 1, 'worker image integration',
               NULL, 'integration-test', ?)`,
    [instanceId, executionGeneration, createdAt],
  );
  await pool.execute(
    `INSERT INTO organization (
       id, slug, name, status, version, created_at, updated_at
     ) VALUES (?, 'worker-image-integration', 'Worker Image Integration',
               'active', 1, ?, ?)`,
    [ids.organization, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO workspace (
       id, organization_id, slug, name, status, version,
       created_at, updated_at
     ) VALUES (?, ?, 'worker-image-integration',
               'Worker Image Integration', 'active', 1, ?, ?)`,
    [ids.workspace, ids.organization, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO principal (
       id, principal_type, status, version, created_at, updated_at
     ) VALUES (?, 'human', 'active', 1, ?, ?)`,
    [ids.actor, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO human_principal (
       principal_id, auth_subject_id, created_at
     ) VALUES (?, 'worker-image-integration', ?)`,
    [ids.actor, createdAt],
  );
  await pool.execute(
    `INSERT INTO organization_membership (
       id, organization_id, principal_id, role, status, version,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
    [
      ids.organizationMembership,
      ids.organization,
      ids.actor,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO workspace_membership (
       id, organization_id, workspace_id, principal_id, role, status,
       version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
    [
      ids.workspaceMembership,
      ids.organization,
      ids.workspace,
      ids.actor,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_contract_revision (
       id, workspace_id, contract_key, revision, lifecycle_status,
       canonical_digest, input_schema, output_schema, idempotency_mode,
       supported_invokers, created_at, published_at
     ) VALUES (?, ?, 'test.image.background.remove', 1, 'published',
               ?, '{}', '{}', 'keyed', '["workflow"]', ?, ?)`,
    [ids.contractRevision, ids.workspace, contractDigest, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO capability_definition (
       id, workspace_id, capability_key, lifecycle_status,
       current_contract_revision_id, current_declaration_revision_id,
       create_request_key, create_request_hash, version,
       created_at, updated_at, archived_at
     ) VALUES (?, ?, 'test.image.background.remove', 'active', ?, NULL,
               'worker-image-definition', ?, 1, ?, ?, NULL)`,
    [
      ids.capabilityDefinition,
      ids.workspace,
      ids.contractRevision,
      digest("7"),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_declaration_revision (
       id, workspace_id, capability_definition_id, contract_revision_id,
       revision, lifecycle_status, schema_version, canonical_digest,
       declaration, publication_request_key, publication_request_hash,
       created_at, published_at
     ) VALUES (?, ?, ?, ?, 1, 'published', 1, ?, ?,
               'worker-image-declaration', ?, ?, ?)`,
    [
      ids.declarationRevision,
      ids.workspace,
      ids.capabilityDefinition,
      ids.contractRevision,
      digest("8"),
      JSON.stringify({
        schemaVersion: "kanvas.capability-declaration/v1",
        origin: "declared",
        catalog: {
          title: {
            "zh-CN": "确定性图片处理",
            "en-US": "Deterministic image processing",
          },
          category: { "zh-CN": "测试", "en-US": "Test" },
          sourceKind: "plugin",
          tags: ["test", "image"],
          surfaces: ["workflow"],
        },
        parameters: [],
        outputs: [],
      }),
      digest("9"),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `UPDATE capability_definition
     SET current_declaration_revision_id = ?
     WHERE workspace_id = ? AND id = ?`,
    [ids.declarationRevision, ids.workspace, ids.capabilityDefinition],
  );
  await pool.execute(
    `INSERT INTO runtime_adapter_definition (
       id, workspace_id, adapter_key, lifecycle_status,
       current_revision_id, version, created_at, updated_at
     ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
    [
      ids.adapterDefinition,
      ids.workspace,
      deterministicImageDerivedPngAdapterKey,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO runtime_adapter_revision (
       id, workspace_id, runtime_adapter_definition_id, revision,
       lifecycle_status, execution_target, canonical_digest, document,
       created_at, published_at
     ) VALUES (?, ?, ?, 1, 'published', 'worker', ?, ?, ?, ?)`,
    [
      ids.adapterRevision,
      ids.workspace,
      ids.adapterDefinition,
      adapterDigest,
      JSON.stringify(runtimeAdapterDocument),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `UPDATE runtime_adapter_definition
     SET current_revision_id = ?, version = 2, updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
    [ids.adapterRevision, createdAt, ids.workspace, ids.adapterDefinition],
  );
  await pool.execute(
    `INSERT INTO capability_implementation_revision (
       id, workspace_id, implementation_key, display_name, description,
       revision, lifecycle_status, contract_revision_id,
       runtime_adapter_revision_id, execution_target, adapter_key,
       source_kind, source_reference, canonical_digest,
       publication_request_key, publication_request_hash,
       configuration, input_mapping, input_mapping_digest,
       compiled_input_mapping, output_mapping, output_mapping_digest,
       compiled_output_mapping, fixture_suite, created_at, published_at
     ) VALUES (?, ?, 'test.image.background.remove.deterministic', ?, NULL, 1,
               'published', ?, ?, 'worker', ?, 'plugin', ?, ?,
               'worker-image-implementation', ?, '{}', ?, ?, ?, ?, ?, ?,
               JSON_ARRAY(JSON_OBJECT('name', 'deterministic')), ?, ?)`,
    [
      ids.implementationRevision,
      ids.workspace,
      JSON.stringify({
        defaultLocale: "en-US",
        values: {
          "en-US": "Deterministic image processing",
          "zh-CN": "确定性图片处理",
        },
      }),
      ids.contractRevision,
      ids.adapterRevision,
      deterministicImageDerivedPngAdapterKey,
      JSON.stringify({
        kind: "plugin",
        plugin: {
          key: "kanvas.test-runtime",
          revision: 1,
          canonicalDigest: adapterDigest,
        },
      }),
      implementationDigest,
      digest("a"),
      JSON.stringify(inputMapping),
      digest("b"),
      JSON.stringify(compiledInputMapping),
      JSON.stringify(outputMapping),
      digest("c"),
      JSON.stringify(compiledOutputMapping),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_binding (
       id, workspace_id, binding_key, contract_revision_id,
       implementation_revision_id, lifecycle_status, priority, version,
       route_policy, created_at, updated_at
     ) VALUES (?, ?, 'test.image.background.remove.deterministic.route', ?, ?,
               'active', 1, 1, ?, ?, ?)`,
    [
      ids.binding,
      ids.workspace,
      ids.contractRevision,
      ids.implementationRevision,
      JSON.stringify({
        retryPolicy: {
          maxAttempts: 1,
          backoff: "fixed",
          initialDelayMs: 0,
          maxDelayMs: 0,
        },
        attemptTimeoutMs: 300_000,
        fallbackOn: [],
        eligibility: {},
      }),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO workflow_revision (
       id, workspace_id, workflow_key, revision, lifecycle_status,
       canonical_digest, topology, input_schema, output_schema,
       created_at, published_at
     ) VALUES (?, ?, 'worker-image-integration', 1, 'published',
               ?, ?, '{}', '{}', ?, ?)`,
    [
      ids.workflowRevision,
      ids.workspace,
      workflowDigest,
      JSON.stringify(plan.topology),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO workflow_run (
       id, workspace_id, workflow_revision_id, idempotency_key,
       request_hash, lifecycle_status, outcome, input,
       execution_deadline_at, execution_plan_snapshot,
       execution_plan_hash, created_by, version,
       created_at, updated_at, completed_at, cancel_requested_at,
       cancel_requested_by, cancel_reason_code, cancel_deadline_at
     ) VALUES (?, ?, ?, 'worker-image-integration', ?, 'running', NULL,
               ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    [
      ids.workflowRun,
      ids.workspace,
      ids.workflowRevision,
      digest("5"),
      JSON.stringify(input),
      executionDeadlineAt,
      JSON.stringify(plan),
      digest("6"),
      ids.actor,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO node_run (
       id, workspace_id, workflow_run_id, node_key, scope_key, kind,
       lifecycle_status, waiting_reason, input, output, error, version,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, 'main', 'root', 'invoke', 'running', NULL, ?,
               NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.nodeRun,
      ids.workspace,
      ids.workflowRun,
      JSON.stringify(input),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_run (
       id, workspace_id, node_run_id, invocation_kind,
       invocation_reference_id, created_by, input, input_digest,
       route_snapshot, route_snapshot_hash, execution_deadline_at,
       contract_revision_id, binding_id,
       implementation_revision_id, lifecycle_status, current_attempt_id,
       accepted_attempt_id, output, cancel_requested_at,
       cancel_deadline_at, version, created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, 'workflow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'running', NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.capabilityRun,
      ids.workspace,
      ids.nodeRun,
      ids.nodeRun,
      ids.actor,
      JSON.stringify(input),
      digestProviderValue(input),
      JSON.stringify(routeSnapshot),
      digestProviderValue(routeSnapshot),
      executionDeadlineAt,
      ids.contractRevision,
      ids.binding,
      ids.implementationRevision,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_attempt (
       id, workspace_id, capability_run_id, binding_id,
       route_candidate_index, candidate_attempt_number, transition_kind,
       transition_reason_code, attempt_number, execution_target,
       implementation_revision_id, lifecycle_status, side_effect_state,
       retry_disposition, not_before, lease_generation, lease_token_hash,
       lease_expires_at, execution_deadline_at, cancel_requested_at,
       cancel_deadline_at, completion_manifest_hash, error, version,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, 0, 1, 'initial', 'test.initial', 1, 'worker',
               ?, 'running', 'started', NULL, ?, 1, ?, ?, ?, NULL, NULL,
               NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.attempt,
      ids.workspace,
      ids.capabilityRun,
      ids.binding,
      ids.implementationRevision,
      createdAt,
      leaseTokenHash,
      leaseExpiresAt,
      executionDeadlineAt,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `UPDATE capability_run
     SET current_attempt_id = ?
     WHERE id = ?`,
    [ids.attempt, ids.capabilityRun],
  );
}

async function seedAdditionalAttemptFixture(
  pool: Pool,
  input: unknown,
  fixtureNow: Date,
  executionDeadlineAt: Date,
): Promise<void> {
  const createdAt = new Date(fixtureNow.getTime() - 1_000);
  const leaseExpiresAt = new Date(fixtureNow.getTime() + 300_000);
  const plan = executionPlan();
  const routeSnapshot = (plan.routes as readonly unknown[])[0];
  await pool.execute(
    `INSERT INTO workflow_run (
       id, workspace_id, workflow_revision_id, idempotency_key,
       request_hash, lifecycle_status, outcome, input,
       execution_deadline_at, execution_plan_snapshot,
       execution_plan_hash, created_by, version,
       created_at, updated_at, completed_at, cancel_requested_at,
       cancel_requested_by, cancel_reason_code, cancel_deadline_at
     ) VALUES (?, ?, ?, 'worker-image-orphan', ?, 'running', NULL,
               ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    [
      ids.orphanWorkflowRun,
      ids.workspace,
      ids.workflowRevision,
      digest("7"),
      JSON.stringify(input),
      executionDeadlineAt,
      JSON.stringify(plan),
      digest("8"),
      ids.actor,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO node_run (
       id, workspace_id, workflow_run_id, node_key, scope_key, kind,
       lifecycle_status, waiting_reason, input, output, error, version,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, 'main', 'root', 'invoke', 'running', NULL, ?,
               NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.orphanNodeRun,
      ids.workspace,
      ids.orphanWorkflowRun,
      JSON.stringify(input),
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_run (
       id, workspace_id, node_run_id, invocation_kind,
       invocation_reference_id, created_by, input, input_digest,
       route_snapshot, route_snapshot_hash, execution_deadline_at,
       contract_revision_id, binding_id,
       implementation_revision_id, lifecycle_status, current_attempt_id,
       accepted_attempt_id, output, cancel_requested_at,
       cancel_deadline_at, version, created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, 'workflow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'running', NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.orphanCapabilityRun,
      ids.workspace,
      ids.orphanNodeRun,
      ids.orphanNodeRun,
      ids.actor,
      JSON.stringify(input),
      digestProviderValue(input),
      JSON.stringify(routeSnapshot),
      digestProviderValue(routeSnapshot),
      executionDeadlineAt,
      ids.contractRevision,
      ids.binding,
      ids.implementationRevision,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO capability_attempt (
       id, workspace_id, capability_run_id, binding_id,
       route_candidate_index, candidate_attempt_number, transition_kind,
       transition_reason_code, attempt_number, execution_target,
       implementation_revision_id, lifecycle_status, side_effect_state,
       retry_disposition, not_before, lease_generation, lease_token_hash,
       lease_expires_at, execution_deadline_at, cancel_requested_at,
       cancel_deadline_at, completion_manifest_hash, error, version,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, 0, 1, 'initial', 'test.initial', 1, 'worker',
               ?, 'running', 'started', NULL, ?, 1, ?, ?, ?, NULL, NULL,
               NULL, NULL, 1, ?, ?, NULL)`,
    [
      ids.orphanAttempt,
      ids.workspace,
      ids.orphanCapabilityRun,
      ids.binding,
      ids.implementationRevision,
      createdAt,
      leaseTokenHash,
      leaseExpiresAt,
      executionDeadlineAt,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `UPDATE capability_run
     SET current_attempt_id = ?
     WHERE id = ?`,
    [ids.orphanAttempt, ids.orphanCapabilityRun],
  );
}

async function commitSourceArtifactFixture(options: {
  readonly pool: Pool;
  readonly store: StorageUploadStore;
  readonly runtime: TrustedImageStorageRuntime;
  readonly sourceBytes: Buffer;
  readonly now: Date;
  readonly expiresAt: Date;
}): Promise<void> {
  const probe = await options.runtime.ensureCompatibilityProbe(
    ids.workspace,
    ids.sourceProbe,
    options.now,
  );
  const sourceSha256 = createHash("sha256")
    .update(options.sourceBytes)
    .digest("hex");
  const session = await options.store.allocateUploadSession({
    id: ids.sourceUpload,
    workspaceId: ids.workspace,
    actorId: ids.actor,
    authority: sourceAuthority,
    allocationRequestKey: "worker-image-source/v1",
    allocationRequestHash: `sha256:${sourceSha256}`,
    purpose: "server_package",
    expectedSize: options.sourceBytes.byteLength.toString(),
    expectedMediaType: "image/png",
    expectedSha256: sourceSha256,
    storageProfileId: options.runtime.profileId,
    compatibilityProbeId: probe.id,
    profileConfigurationHash: options.runtime.profileConfigurationHash,
    container: options.runtime.container,
    objectKey: `v1/w/${ids.workspace}/source/${ids.sourceUpload}`,
    uploadMode: "server_stream",
    writeProtectionMode: "server_owned",
    verificationProfileVersion: options.runtime.verificationProfileVersion,
    now: options.now,
    expiresAt: options.expiresAt,
    cleanupEligibleAt: new Date(
      options.expiresAt.getTime() + options.runtime.cleanupGraceMilliseconds,
    ),
  });
  await options.runtime.uploads.ingest({
    session,
    body: bytesBody(options.sourceBytes),
  });
  const profile = options.runtime.profiles.resolve(options.runtime.profileId);
  if (!profile) {
    throw new Error("Integration storage profile is unavailable.");
  }
  const inspection = await profile.adapter.inspectObject({
    storageProfileId: session.storageProfileId,
    container: session.container,
    objectKey: session.objectKey,
  });
  if (!inspection) {
    throw new Error("Integration source object is unavailable.");
  }

  const connection = await options.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO stored_object (
         id, workspace_id, created_from_upload_session_id,
         storage_profile_id, container, object_key, storage_version_id,
         provider_etag, immutable_identity_hash, byte_size, sha256,
         media_type, delete_state, created_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?,
                 'image/png', 'active', ?, NULL)`,
      [
        ids.sourceStoredObject,
        ids.workspace,
        ids.sourceUpload,
        session.storageProfileId,
        session.container,
        session.objectKey,
        inspection.immutableIdentityHash,
        inspection.byteSize,
        inspection.sha256,
        options.now,
      ],
    );
    await connection.execute(
      `UPDATE upload_session
       SET state = 'committed',
           committed_stored_object_id = ?,
           committed_at = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ?`,
      [ids.sourceStoredObject, options.now, options.now, ids.sourceUpload],
    );
    await connection.execute(
      `INSERT INTO artifact (
         id, workspace_id, stored_object_id, content_digest,
         artifact_type, availability_status, data_classification,
         display_filename, metadata, created_at
       ) VALUES (?, ?, ?, ?, 'image', 'available', 'internal',
                 'source.png', '{}', ?)`,
      [
        ids.sourceArtifact,
        ids.workspace,
        ids.sourceStoredObject,
        `sha256:${inspection.sha256}`,
        options.now,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function runAndMaterializeDeterministicAdapter(options: {
  readonly store: StorageUploadStore;
  readonly runtime: TrustedImageStorageRuntime;
  readonly input: unknown;
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly executionDeadlineAt: Date;
  readonly generatedIds: readonly string[];
}) {
  const signal = new AbortController().signal;
  const inputArtifacts = createWorkerInputArtifactResolver({
    runtime: options.runtime,
    store: options.store,
    allowedDataClassifications: ["internal"],
  }).bind({
    workspaceId: ids.workspace,
    input: options.input,
    signal,
  });
  const adapterResult = await createWorkerRuntimeAdapterRegistry({
    deterministicImageAdapterEnabled: true,
  }).execute(deterministicImageDerivedPngAdapterKey, options.input, signal, {
    workspaceId: ids.workspace,
    workflowRunId: options.workflowRunId,
    nodeRunId: options.nodeRunId,
    capabilityRunId: options.capabilityRunId,
    attemptId: options.attemptId,
    runtimeAdapterRevisionId: ids.adapterRevision,
    runtimeAdapterRevisionDigest: adapterDigest,
    runtimeAdapter: runtimeAdapterDocument,
    inputArtifacts,
  });
  assertAdapterResult(adapterResult);
  const generatedIds = options.generatedIds[Symbol.iterator]();
  const materialized = await createWorkerAttemptOutputMaterializer({
    runtime: options.runtime,
    store: options.store,
    nextId() {
      const next = generatedIds.next();
      if (next.done) {
        throw new Error("Worker image integration exhausted generated IDs.");
      }
      return next.value;
    },
    now: () => new Date(),
  }).materialize({
    context: {
      workspaceId: ids.workspace,
      actorId: ids.actor,
      attemptId: options.attemptId,
      executionDeadlineAt: options.executionDeadlineAt,
      executionTarget: "worker",
    },
    outputs: adapterResult.outputs,
    signal,
  });
  const capabilityOutput = resolveAttemptOutputArtifactReferences(
    adapterResult.capabilityOutput,
    materialized,
  );
  return Object.freeze({
    capabilityOutput,
    materialized,
  });
}

describe.skipIf(!integrationEnabled)(
  "Worker trusted image round trip against disposable MySQL 8.0 and Local Storage",
  () => {
    const databaseName = disposableDatabaseName();
    let adminPool: Pool | undefined;
    let pool: Pool | undefined;
    let storageStore: StorageUploadStore | undefined;
    let completionStore: AtomicAttemptCompletionStore | undefined;
    let storageRuntime: TrustedImageStorageRuntime | undefined;
    let storageRoot: string | undefined;

    beforeAll(async () => {
      const admin = createAdminPool();
      adminPool = admin.pool;
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const migrationConnection = await adminPool.getConnection();
      try {
        await migrationConnection.query(`USE \`${databaseName}\``);
        const inventory = await readMigrationInventory(
          resolve(import.meta.dirname, "../../../packages/database/migrations"),
        );
        for (const migration of inventory) {
          await migrationConnection.query(migration.sql);
        }
      } finally {
        migrationConnection.release();
      }
      pool = createDomainPool(databaseName, admin.networkConfig);
      storageStore = createStorageUploadStore(pool);
      completionStore = createAtomicAttemptCompletionStore(pool, {
        instanceId,
      });
      storageRoot = await realpath(
        await mkdtemp(join(tmpdir(), "kanvas-worker-image-")),
      );
      storageRuntime = await createTrustedImageStorageRuntime({
        config: storageConfig(storageRoot),
        store: storageStore,
        adapterVersion: "worker-image-integration/v1",
      });
    }, 60_000);

    afterAll(async () => {
      await storageRuntime?.close();
      await pool?.end();
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await adminPool.end();
      }
      if (storageRoot) {
        await rm(storageRoot, {
          recursive: true,
          force: true,
        });
      }
    });

    it("commits the happy path and reclaims a verified output after lease loss before Atomic Complete", async () => {
      if (!pool || !storageStore || !completionStore || !storageRuntime) {
        throw new Error(
          "Worker image integration fixture was not initialized.",
        );
      }
      const fixtureNow = new Date();
      const executionDeadlineAt = new Date(fixtureNow.getTime() + 600_000);
      const sourceBytes = createDeterministicRgbaPng({
        width: 4,
        height: 4,
        rgba: [220, 80, 40, 255],
      });
      const input = {
        sourceArtifactId: ids.sourceArtifact,
      };
      await seedExecutionFixture(pool, input, fixtureNow, executionDeadlineAt);
      await commitSourceArtifactFixture({
        pool,
        store: storageStore,
        runtime: storageRuntime,
        sourceBytes,
        now: new Date(),
        expiresAt: executionDeadlineAt,
      });

      const { capabilityOutput, materialized } =
        await runAndMaterializeDeterministicAdapter({
          store: storageStore,
          runtime: storageRuntime,
          input,
          workflowRunId: ids.workflowRun,
          nodeRunId: ids.nodeRun,
          capabilityRunId: ids.capabilityRun,
          attemptId: ids.attempt,
          executionDeadlineAt,
          generatedIds: [
            ids.outputProbe,
            ids.outputUpload,
            ids.outputStoredObject,
            ids.outputArtifact,
            ids.attemptOutput,
            ids.randomObject,
          ],
        });

      const completed = await completionStore.complete({
        workspaceId: ids.workspace,
        capabilityRunId: ids.capabilityRun,
        attemptId: ids.attempt,
        completionId: ids.completion,
        terminalOutboxEventId: ids.terminalOutbox,
        executionGeneration,
        target: {
          executionTarget: "worker",
          implementationRevisionId: ids.implementationRevision,
          implementationDigest,
          adapterKey: deterministicImageDerivedPngAdapterKey,
          attemptLeaseGeneration: 1,
          domainLeaseTokenHash: leaseTokenHash,
        },
        capabilityOutput,
        outputs: materialized,
        initialUsage: [],
        now: new Date(),
      });
      expect(completed).toMatchObject({
        status: "completed",
        outputs: [
          {
            uploadSessionId: ids.outputUpload,
            storedObjectId: ids.outputStoredObject,
            artifactId: ids.outputArtifact,
            attemptOutputId: ids.attemptOutput,
            outputRole: "primary",
            outputIndex: 0,
          },
        ],
      });

      const [factRows] = await pool.query<CompletionFactsRow[]>(
        `SELECT
             capability.lifecycle_status AS capabilityStatus,
             capability.accepted_attempt_id AS acceptedAttemptId,
             attempt.lifecycle_status AS attemptStatus,
             upload.state AS uploadState,
             artifact.id AS artifactId,
             artifact.stored_object_id AS storedObjectId
           FROM capability_run AS capability
           INNER JOIN capability_attempt AS attempt
             ON attempt.id = capability.accepted_attempt_id
           INNER JOIN attempt_output AS attempt_output
             ON attempt_output.capability_attempt_id = attempt.id
           INNER JOIN artifact AS artifact
             ON artifact.id = attempt_output.artifact_id
           INNER JOIN upload_session AS upload
             ON upload.committed_stored_object_id =
                artifact.stored_object_id
           WHERE capability.id = ?`,
        [ids.capabilityRun],
      );
      expect(factRows[0]).toMatchObject({
        capabilityStatus: "completed",
        acceptedAttemptId: ids.attempt,
        attemptStatus: "completed",
        uploadState: "committed",
        artifactId: ids.outputArtifact,
        storedObjectId: ids.outputStoredObject,
      });

      const outputObject = await storageStore.readAuthorizedCommittedObject({
        workspaceId: ids.workspace,
        artifactId: ids.outputArtifact,
        allowedDataClassifications: ["internal"],
      });
      const outputProfile = storageRuntime.profiles.resolve(
        outputObject.storageProfileId,
      );
      if (!outputProfile) {
        throw new Error("Committed output storage profile is unavailable.");
      }
      const outputRead = await outputProfile.adapter.openRead({
        identity: {
          storageProfileId: outputObject.storageProfileId,
          container: outputObject.container,
          objectKey: outputObject.objectKey,
          ...(outputObject.storageVersionId
            ? {
                storageVersionId: outputObject.storageVersionId,
              }
            : {}),
        },
        expectedByteSize: outputObject.byteSize,
        expectedSha256: outputObject.sha256,
        expectedImmutableIdentityHash: outputObject.immutableIdentityHash,
      });
      const outputBytes = await collect(outputRead.body);
      expect(outputBytes).not.toEqual(sourceBytes);
      const verification = await verifyTrustedImage({
        body: bytesBody(outputBytes),
        declaredMediaType: "image/png",
        limits: storageConfig(storageRoot ?? tmpdir()).verificationLimits,
        verificationProfileVersion: storageRuntime.verificationProfileVersion,
      });
      expect(verification).toMatchObject({
        byteSize: outputObject.byteSize,
        sha256: outputObject.sha256,
        detectedMediaType: "image/png",
      });

      const orphanFixtureNow = new Date();
      const orphanExecutionDeadlineAt = new Date(
        orphanFixtureNow.getTime() + 600_000,
      );
      const orphanInput = {
        sourceArtifactId: ids.sourceArtifact,
      };
      await seedAdditionalAttemptFixture(
        pool,
        orphanInput,
        orphanFixtureNow,
        orphanExecutionDeadlineAt,
      );
      const orphan = await runAndMaterializeDeterministicAdapter({
        store: storageStore,
        runtime: storageRuntime,
        input: orphanInput,
        workflowRunId: ids.orphanWorkflowRun,
        nodeRunId: ids.orphanNodeRun,
        capabilityRunId: ids.orphanCapabilityRun,
        attemptId: ids.orphanAttempt,
        executionDeadlineAt: orphanExecutionDeadlineAt,
        generatedIds: [
          ids.orphanOutputProbe,
          ids.orphanOutputUpload,
          ids.orphanOutputStoredObject,
          ids.orphanOutputArtifact,
          ids.orphanAttemptOutput,
          ids.orphanRandomObject,
        ],
      });
      const orphanSession = await storageStore.readAttemptOutputUploadSession({
        workspaceId: ids.workspace,
        uploadSessionId: ids.orphanOutputUpload,
        attemptId: ids.orphanAttempt,
        outputRole: "primary",
        outputIndex: 0,
      });
      expect(orphanSession.state).toBe("verified");
      const orphanProfile = storageRuntime.profiles.resolve(
        orphanSession.storageProfileId,
      );
      if (!orphanProfile) {
        throw new Error(
          "Verified orphan output storage profile is unavailable.",
        );
      }
      const orphanIdentity = Object.freeze({
        storageProfileId: orphanSession.storageProfileId,
        container: orphanSession.container,
        objectKey: orphanSession.objectKey,
      });
      expect(
        await orphanProfile.adapter.inspectObject(orphanIdentity),
      ).toBeDefined();

      const lateCompleteNow = new Date();
      await pool.execute(
        `UPDATE capability_attempt
         SET lease_expires_at = ?,
             updated_at = ?,
             version = version + 1
         WHERE id = ?`,
        [
          new Date(lateCompleteNow.getTime() - 1_000),
          lateCompleteNow,
          ids.orphanAttempt,
        ],
      );
      let completionFailure: unknown;
      try {
        await completionStore.complete({
          workspaceId: ids.workspace,
          capabilityRunId: ids.orphanCapabilityRun,
          attemptId: ids.orphanAttempt,
          completionId: ids.orphanCompletion,
          terminalOutboxEventId: ids.orphanTerminalOutbox,
          executionGeneration,
          target: {
            executionTarget: "worker",
            implementationRevisionId: ids.implementationRevision,
            implementationDigest,
            adapterKey: deterministicImageDerivedPngAdapterKey,
            attemptLeaseGeneration: 1,
            domainLeaseTokenHash: leaseTokenHash,
          },
          capabilityOutput: orphan.capabilityOutput,
          outputs: orphan.materialized,
          initialUsage: [],
          now: lateCompleteNow,
        });
      } catch (error) {
        completionFailure = error;
      }
      expect(completionFailure).toBeInstanceOf(
        AtomicAttemptCompletionStoreError,
      );
      expect(completionFailure).toMatchObject({
        code: "attempt_completion.lease_rejected",
      });

      const [beforeCleanupRows] = await pool.query<UploadCleanupFactsRow[]>(
        `SELECT
             state,
             cleanup_state AS cleanupState,
             cleanup_result AS cleanupResult,
             committed_stored_object_id AS committedStoredObjectId
           FROM upload_session
           WHERE id = ?`,
        [ids.orphanOutputUpload],
      );
      expect(beforeCleanupRows[0]).toMatchObject({
        state: "verified",
        cleanupState: "none",
        cleanupResult: null,
        committedStoredObjectId: null,
      });
      const [beforeCleanupCounts] = await pool.query<CountRow[]>(
        `SELECT
             (SELECT COUNT(*) FROM stored_object WHERE id = ?) +
             (SELECT COUNT(*) FROM artifact WHERE id = ?) +
             (SELECT COUNT(*) FROM attempt_output WHERE id = ?) +
             (SELECT COUNT(*) FROM attempt_completion WHERE id = ?) +
             (SELECT COUNT(*) FROM outbox_event WHERE id = ?) AS count`,
        [
          ids.orphanOutputStoredObject,
          ids.orphanOutputArtifact,
          ids.orphanAttemptOutput,
          ids.orphanCompletion,
          ids.orphanTerminalOutbox,
        ],
      );
      expect(Number(beforeCleanupCounts[0]?.count)).toBe(0);

      const cleanupNow = new Date(
        orphanExecutionDeadlineAt.getTime() +
          storageRuntime.cleanupGraceMilliseconds +
          1_000,
      );
      const runtimeStatePool = pool;
      const runtimeStateReader: RuntimeStateReader = Object.freeze({
        async read() {
          const [rows] = await runtimeStatePool.query<RuntimeStateRow[]>(
            `SELECT
                   state,
                   execution_generation AS executionGeneration,
                   state_version AS stateVersion,
                   deadline
                 FROM instance_runtime_state
                 WHERE instance_id = ?`,
            [instanceId],
          );
          const row = rows[0];
          if (!row) {
            throw new Error(
              "Worker image integration runtime state is missing.",
            );
          }
          return {
            state: row.state,
            executionGeneration: row.executionGeneration,
            stateVersion: row.stateVersion,
            ...(row.deadline ? { deadline: row.deadline } : {}),
          };
        },
      });
      const applicationRuntime = createApplicationRuntime({
        clock: {
          now: () => cleanupNow,
        },
        runtimeStateReader,
      });
      const garbageCollector = createStorageGarbageCollectionCoordinator({
        store: storageStore,
        profiles: storageRuntime.profiles,
        now: () => cleanupNow,
        claimLeaseMilliseconds: 10_000,
        baseRetryMilliseconds: 1_000,
        maximumRetryMilliseconds: 10_000,
        cleanupTokenHashFactory: () => "d".repeat(64),
      });
      const garbageCollectionLoop = new StorageGarbageCollectionLoop({
        runtime: applicationRuntime,
        runtimeStateReader,
        coordinator: garbageCollector,
        logger: {
          error() {
            return undefined;
          },
        },
        pollIntervalMs: 5_000,
      });
      await garbageCollectionLoop.runOnce();

      const [afterCleanupRows] = await pool.query<UploadCleanupFactsRow[]>(
        `SELECT
             state,
             cleanup_state AS cleanupState,
             cleanup_result AS cleanupResult,
             committed_stored_object_id AS committedStoredObjectId
           FROM upload_session
           WHERE id = ?`,
        [ids.orphanOutputUpload],
      );
      expect(afterCleanupRows[0]).toMatchObject({
        state: "aborted",
        cleanupState: "done",
        cleanupResult: "deleted",
        committedStoredObjectId: null,
      });
      expect(
        await orphanProfile.adapter.inspectObject(orphanIdentity),
      ).toBeUndefined();
      const [afterCleanupCounts] = await pool.query<CountRow[]>(
        `SELECT
             (SELECT COUNT(*) FROM stored_object WHERE id = ?) +
             (SELECT COUNT(*) FROM artifact WHERE id = ?) +
             (SELECT COUNT(*) FROM attempt_output WHERE id = ?) +
             (SELECT COUNT(*) FROM attempt_completion WHERE id = ?) +
             (SELECT COUNT(*) FROM outbox_event WHERE id = ?) AS count`,
        [
          ids.orphanOutputStoredObject,
          ids.orphanOutputArtifact,
          ids.orphanAttemptOutput,
          ids.orphanCompletion,
          ids.orphanTerminalOutbox,
        ],
      );
      expect(Number(afterCleanupCounts[0]?.count)).toBe(0);
      await expect(garbageCollector.runNext()).resolves.toEqual({
        status: "idle",
      });

      const sourceObject = await storageStore.readAuthorizedCommittedObject({
        workspaceId: ids.workspace,
        artifactId: ids.sourceArtifact,
        allowedDataClassifications: ["internal"],
      });
      const sourceProfile = storageRuntime.profiles.resolve(
        sourceObject.storageProfileId,
      );
      if (!sourceProfile) {
        throw new Error("Committed source storage profile is unavailable.");
      }
      expect(
        await sourceProfile.adapter.inspectObject({
          storageProfileId: sourceObject.storageProfileId,
          container: sourceObject.container,
          objectKey: sourceObject.objectKey,
          ...(sourceObject.storageVersionId
            ? {
                storageVersionId: sourceObject.storageVersionId,
              }
            : {}),
        }),
      ).toBeDefined();
    }, 60_000);
  },
);
