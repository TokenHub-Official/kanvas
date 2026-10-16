import { resolve } from "node:path";

import {
  parseProviderRouteSnapshot,
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
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  createBudgetReservationStore,
  type ReserveBudgetOptions,
} from "../src/runtime/budget-reservation-store.js";
import { createProviderRouteStore } from "../src/runtime/provider-route-store.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "../src/runtime/provider-value-digest.js";
import {
  createSecretVersionStore,
  secretAadDigestFor,
} from "../src/runtime/secret-version-store.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const now = new Date("2026-07-28T12:00:00.000Z");
const createdAt = new Date("2026-07-27T12:00:00.000Z");
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

const organizationId = id(1);
const workspaceId = id(2);
const principalId = id(3);
const membershipId = id(20);
const sessionId = id(21);
const instanceId = id(4);
const instancePolicyRevisionId = id(5);
const workspacePolicyRevisionId = id(6);
const endpointId = id(7);
const credentialId = id(8);
const oldSecretVersionId = id(9);
const nextSecretVersionId = id(10);
const modelProfileRevisionId = id(11);
const modelDeploymentId = id(12);
const pricingRevisionId = id(13);
const routePolicyRevisionId = id(14);
const budgetAccountId = id(15);
const contractRevisionId = id(16);
const implementationRevisionId = id(17);
const capabilityBindingId = id(18);
const workflowRevisionId = id(19);
const adapterDefinitionId = id(22);
const adapterRevisionId = id(23);
const resolutionScope = Object.freeze({
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "human_membership",
  authorityId: membershipId,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["usage.read", "credential.manage"],
  trusted: true,
} satisfies TrustedWorkspaceScope);

const baseUrlDigest = digestProviderValue({
  baseUrl: "https://tokenhub.internal.example/v1",
});
const endpointValidationDigest = digestProviderValue({
  endpointId,
  validation: "passed",
});
const credentialIdentityDigest = digestProviderValue({
  credential: "tokenhub-primary",
  identityEpoch: 1,
});
const authorityDigest = digestProviderValue({
  authority: "tokenhub-primary",
});
const billingIdentityDigest = digestProviderValue({
  billing: "tokenhub-primary",
});
const egressIdentityDigest = digestProviderValue({
  egress: "tokenhub-primary",
});
const oldSecretFingerprint = digestProviderValue({
  secret: "old",
  materialGeneration: 1,
});
const nextSecretFingerprint = digestProviderValue({
  secret: "next",
  materialGeneration: 2,
});
const modelProfileDocument = Object.freeze({
  schemaVersion: 1,
  model: Object.freeze({
    displayName: "GPT 5",
    family: "gpt",
    inputModalities: Object.freeze(["text"]),
    outputModalities: Object.freeze(["text"]),
    toolCall: true,
  }),
  operations: Object.freeze({
    "text.generate": Object.freeze({
      parameters: Object.freeze([]),
      evidence: Object.freeze([
        Object.freeze({
          kind: "administrator",
          reference: "gpt-primary",
          observedAt: "2026-07-15T12:00:00.000Z",
          sourceDigest: `sha256:${"8".repeat(64)}`,
          confidence: "high",
          claim: "supported",
        }),
      ]),
    }),
  }),
  sources: Object.freeze([]),
});
const pricingDocument = Object.freeze({
  schemaVersion: 1,
  billingMode: "fixed",
  fixedChargeAmount: "1",
  evidence: Object.freeze({
    priceVerified: true,
    sourceKind: "contract",
    sourceReference: "contract://test/provider/gpt-5",
    observedAt: "2026-07-15T12:00:00.000Z",
    sourceDigest: `sha256:${"9".repeat(64)}`,
  }),
});
const modelProfileDigest = digestProviderValue(modelProfileDocument);
const modelDeploymentDigest = digestProviderValue({
  modelProfileRevisionId,
  providerModelId: "gpt-5",
});
const pricingDigest = digestProviderValue(pricingDocument);

const instancePolicyDocument = Object.freeze({
  allowedAdapterKinds: Object.freeze(["openai_compatible"]),
  allowedPresetKinds: Object.freeze(["tokenhub"]),
  allowedRegionCodes: Object.freeze(["us"]),
  allowedRoutingModes: Object.freeze(["kanvas_fixed"]),
  allowedExecutionTransparencies: Object.freeze(["full"]),
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "80",
  }),
  maxProviderRequestSeconds: 60,
});
const workspacePolicyDocument = Object.freeze({
  allowedProviderEndpointIds: Object.freeze([endpointId]),
  allowedRegionCodes: Object.freeze(["us"]),
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "70",
  }),
  maxProviderRequestSeconds: 45,
});
const routePolicyDocument = Object.freeze({
  providerKey: "openai",
  apiSurface: "responses",
  providerEndpointId: endpointId,
  credentialId,
  modelDeploymentId,
  pricingRevisionId,
  budgetAccountId,
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "60",
  }),
  requestTimeoutSeconds: 30,
  queryMode: "provider_request_id",
  notFoundIsAuthoritative: true,
  constraints: Object.freeze({
    allowedProviderEndpointIds: Object.freeze([endpointId]),
    maximumCharge: Object.freeze({
      currencyCode: "USD",
      amount: "60",
    }),
    maxProviderRequestSeconds: 30,
  }),
});
const instancePolicyDigest = digestProviderValue(instancePolicyDocument);
const workspacePolicyDigest = digestProviderValue(workspacePolicyDocument);
const routePolicyDigest = digestProviderValue(routePolicyDocument);

const deploymentHardBounds = Object.freeze({
  allowedAdapterKinds: Object.freeze(["openai_compatible"]),
  allowedPresetKinds: Object.freeze(["tokenhub"]),
  allowedRegionCodes: Object.freeze(["us"]),
  allowedProviderEndpointIds: Object.freeze([endpointId]),
  allowedRoutingModes: Object.freeze(["kanvas_fixed"]),
  allowedExecutionTransparencies: Object.freeze(["full"]),
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "100",
  }),
  maxProviderRequestSeconds: 90,
});

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface BudgetAccountRow extends RowDataPacket {
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly version: number;
}

interface WorkflowHierarchy {
  readonly workflowRunId: string;
  readonly capabilityRunId: string;
  readonly capabilityAttemptId: string;
}

function databaseName(): string {
  const name = `kanvas_control_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function createAdminPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectionLimit: 2,
    multipleStatements: true,
    timezone: "Z",
    decimalNumbers: false,
  });
}

function createTestPool(name: string): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      database: name,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 8,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    database: name,
    user: config.user,
    password: config.password,
    connectionLimit: 8,
    timezone: "Z",
    decimalNumbers: false,
  });
}

function audit(auditEventId: string): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId,
    actorPrincipalId: null,
    actorType: "system",
    authenticationRefType: "none",
    authenticationRefHash: null,
    authorityType: "system",
    authorityId: null,
    authorityVersion: null,
  });
}

async function countRows(
  pool: Pool,
  tableName: "audit_event" | "budget_ledger_entry" | "budget_reservation",
  whereSql = "",
  parameters: readonly unknown[] = [],
): Promise<number> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS count FROM ${tableName} ${whereSql}`,
    [...parameters],
  );
  return Number(rows[0]?.count ?? 0);
}

async function seedExecutionHierarchy(
  connection: PoolConnection,
  index: number,
): Promise<WorkflowHierarchy> {
  const base = 1_000 + index * 10;
  const workflowRunId = id(base + 1);
  const nodeRunId = id(base + 2);
  const capabilityRunId = id(base + 3);
  const capabilityAttemptId = id(base + 4);
  const input = Object.freeze({
    request: index,
  });
  const executionPlan = Object.freeze({
    schemaVersion: 1,
    routePolicyRevisionId,
  });
  const workflowDeadlineAt = new Date(createdAt.getTime() + 300_000);
  await connection.execute(
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
      workflowRunId,
      workspaceId,
      workflowRevisionId,
      `control-integration-${String(index)}`,
      digestProviderValue(input),
      canonicalizeProviderValue(input),
      workflowDeadlineAt,
      canonicalizeProviderValue(executionPlan),
      digestProviderValue(executionPlan),
      principalId,
      createdAt,
      createdAt,
    ],
  );
  await connection.execute(
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
       ?, ?, ?, 'invoke', 'root', 'invoke', 'running', NULL,
       NULL, NULL, NULL, 1, ?, ?, NULL
     )`,
    [nodeRunId, workspaceId, workflowRunId, createdAt, createdAt],
  );
  await connection.execute(
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
       cancel_requested_at,
       version,
       created_at,
       updated_at,
       completed_at
     ) VALUES (
       ?, ?, ?, 'workflow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'running', NULL, NULL, NULL, 1, ?, ?, NULL
     )`,
    [
      capabilityRunId,
      workspaceId,
      nodeRunId,
      nodeRunId,
      principalId,
      canonicalizeProviderValue(input),
      digestProviderValue(input),
      canonicalizeProviderValue(executionPlan),
      digestProviderValue(executionPlan),
      workflowDeadlineAt,
      contractRevisionId,
      capabilityBindingId,
      implementationRevisionId,
      createdAt,
      createdAt,
    ],
  );
  await connection.execute(
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
       version,
       created_at,
       updated_at,
       completed_at
     ) VALUES (
       ?, ?, ?, ?, 0, 1, 'initial', 'route.initial', 1, 'provider',
       ?, 'created', 'not_started', NULL, ?, 0, 1, ?, ?, NULL
     )`,
    [
      capabilityAttemptId,
      workspaceId,
      capabilityRunId,
      capabilityBindingId,
      implementationRevisionId,
      createdAt,
      createdAt,
      createdAt,
    ],
  );
  await connection.execute(
    `UPDATE capability_run
     SET current_attempt_id = ?
     WHERE id = ?`,
    [capabilityAttemptId, capabilityRunId],
  );
  return Object.freeze({
    workflowRunId,
    capabilityRunId,
    capabilityAttemptId,
  });
}

async function seedFixture(pool: Pool): Promise<readonly WorkflowHierarchy[]> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO principal (
         id, principal_type, status, version, created_at, updated_at
       ) VALUES (?, 'human', 'active', 1, ?, ?)`,
      [principalId, createdAt, createdAt],
    );
    await connection.execute(
      `INSERT INTO human_principal (
         principal_id, auth_subject_id, created_at
       ) VALUES (?, 'control-plane-integration', ?)`,
      [principalId, createdAt],
    );
    await connection.execute(
      `INSERT INTO organization (
         id, slug, name, status, version, created_at, updated_at
       ) VALUES (
         ?, 'control-plane-integration', 'Control Plane Integration',
         'active', 1, ?, ?
       )`,
      [organizationId, createdAt, createdAt],
    );
    await connection.execute(
      `INSERT INTO workspace (
         id, organization_id, slug, name, status, version,
         created_at, updated_at
       ) VALUES (
         ?, ?, 'control-plane-integration', 'Control Plane Integration',
         'active', 1, ?, ?
       )`,
      [workspaceId, organizationId, createdAt, createdAt],
    );
    await connection.execute(
      `INSERT INTO workspace_membership (
         id,
         organization_id,
         workspace_id,
         principal_id,
         role,
         status,
         version,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, 'owner', 'active', 1, ?, ?
       )`,
      [
        membershipId,
        organizationId,
        workspaceId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO instance_policy_revision (
         id, revision, schema_version, policy_document, canonical_digest,
         lifecycle_status, supersedes_revision_id,
         created_by_principal_id, published_by_principal_id,
         created_at, published_at
       ) VALUES (
         ?, 1, 1, ?, ?, 'published', NULL, ?, ?, ?, ?
       )`,
      [
        instancePolicyRevisionId,
        canonicalizeProviderValue(instancePolicyDocument),
        instancePolicyDigest,
        principalId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO instance_policy_binding (
         singleton_id, active_revision_id, version,
         updated_by_principal_id, updated_at
       ) VALUES (1, ?, 1, ?, ?)`,
      [instancePolicyRevisionId, principalId, createdAt],
    );
    await connection.execute(
      `INSERT INTO workspace_policy_revision (
         id, workspace_id, revision, schema_version, policy_document,
         canonical_digest, lifecycle_status, supersedes_revision_id,
         created_by_principal_id, published_by_principal_id,
         created_at, published_at
       ) VALUES (
         ?, ?, 1, 1, ?, ?, 'published', NULL, ?, ?, ?, ?
       )`,
      [
        workspacePolicyRevisionId,
        workspaceId,
        canonicalizeProviderValue(workspacePolicyDocument),
        workspacePolicyDigest,
        principalId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO workspace_policy_binding (
         workspace_id, active_revision_id, version,
         updated_by_principal_id, updated_at
       ) VALUES (?, ?, 1, ?, ?)`,
      [workspaceId, workspacePolicyRevisionId, principalId, createdAt],
    );
    await connection.execute(
      `INSERT INTO provider_endpoint (
         id, workspace_id, endpoint_key, adapter_kind, preset_kind,
         base_url, canonical_origin, base_url_digest, region_code,
         network_policy, data_policy, lifecycle_status, validation_status,
         validation_digest, validated_at, version,
         created_by_principal_id, created_at, updated_at
       ) VALUES (
         ?, ?, 'tokenhub-primary', 'openai_compatible', 'tokenhub',
         'https://tokenhub.internal.example/v1',
         'https://tokenhub.internal.example', ?, 'us', '{}', '{}',
         'active', 'passed', ?, ?, 1, ?, ?, ?
       )`,
      [
        endpointId,
        workspaceId,
        baseUrlDigest,
        endpointValidationDigest,
        createdAt,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO credential (
         id, workspace_id, provider_endpoint_id, credential_key,
         provider_kind, authority_digest, billing_identity_digest,
         egress_identity_digest, identity_digest, identity_epoch,
         material_generation, active_secret_version_id, lifecycle_status,
         version, created_by_principal_id, created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'tokenhub-primary', 'openai', ?, ?, ?, ?, 1, 1,
         NULL, 'active', 1, ?, ?, ?
       )`,
      [
        credentialId,
        workspaceId,
        endpointId,
        authorityDigest,
        billingIdentityDigest,
        egressIdentityDigest,
        credentialIdentityDigest,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO secret_version (
         id, workspace_id, credential_id, version, material_generation,
         source_kind, lifecycle_status, aad_digest, deployment_reference,
         material_fingerprint, format_version, drain_deadline_at,
         verified_at, activated_at, retired_at, revoked_at, destroyed_at,
         created_by_principal_id, created_at
       ) VALUES (
         ?, ?, ?, 1, 1, 'deployment_reference', 'active', ?, ?,
         ?, 1, NULL, ?, ?, NULL, NULL, NULL, ?, ?
       )`,
      [
        oldSecretVersionId,
        workspaceId,
        credentialId,
        secretAadDigestFor({
          instanceId,
          workspaceId,
          credentialId,
          secretVersionId: oldSecretVersionId,
          providerKind: "openai",
          formatVersion: 1,
        }),
        "deployment://tokenhub/primary-v1",
        oldSecretFingerprint,
        createdAt,
        new Date("2026-07-27T14:00:00.000Z"),
        principalId,
        createdAt,
      ],
    );
    await connection.execute(
      `UPDATE credential
       SET active_secret_version_id = ?
       WHERE workspace_id = ? AND id = ?`,
      [oldSecretVersionId, workspaceId, credentialId],
    );
    await connection.execute(
      `INSERT INTO model_profile_revision (
         id, workspace_id, profile_key, revision, schema_version,
         profile_document, canonical_digest, lifecycle_status,
         created_by_principal_id, published_by_principal_id,
         created_at, published_at
       ) VALUES (
         ?, ?, 'gpt-primary', 1, 1, ?, ?, 'published', ?, ?, ?, ?
       )`,
      [
        modelProfileRevisionId,
        workspaceId,
        canonicalizeProviderValue(modelProfileDocument),
        modelProfileDigest,
        principalId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO model_deployment (
         id, workspace_id, provider_endpoint_id, model_profile_revision_id,
         deployment_key, provider_model_id, deployment_digest,
         lifecycle_status, version, created_by_principal_id,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, 'gpt-primary', 'gpt-5', ?, 'active', 1, ?, ?, ?
       )`,
      [
        modelDeploymentId,
        workspaceId,
        endpointId,
        modelProfileRevisionId,
        modelDeploymentDigest,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO pricing_revision (
         id, workspace_id, provider_endpoint_id, model_deployment_id,
         pricing_key, revision, schema_version, currency_code,
         pricing_document, canonical_digest, lifecycle_status, source_kind,
         verified_at, effective_at, created_by_principal_id,
         published_by_principal_id, created_at, published_at
       ) VALUES (
         ?, ?, ?, ?, 'gpt-primary-usd', 1, 1, 'USD', ?, ?,
         'published', 'contract', ?, ?, ?, ?, ?, ?
       )`,
      [
        pricingRevisionId,
        workspaceId,
        endpointId,
        modelDeploymentId,
        canonicalizeProviderValue(pricingDocument),
        pricingDigest,
        createdAt,
        createdAt,
        principalId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO route_policy_revision (
         id, workspace_id, route_key, revision, schema_version,
         route_document, canonical_digest, lifecycle_status,
         created_by_principal_id, published_by_principal_id,
         created_at, published_at
       ) VALUES (
         ?, ?, 'primary', 1, 1, ?, ?, 'published', ?, ?, ?, ?
       )`,
      [
        routePolicyRevisionId,
        workspaceId,
        canonicalizeProviderValue(routePolicyDocument),
        routePolicyDigest,
        principalId,
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO budget_account (
         id, workspace_id, account_key, currency_code,
         period_start_at, period_end_at, hard_limit_amount,
         consumed_amount, reserved_amount, unknown_held_amount,
         lifecycle_status, version, created_by_principal_id,
         created_at, updated_at
       ) VALUES (
         ?, ?, 'primary-usd', 'USD', ?, ?, 100, 0, 0, 0,
         'active', 1, ?, ?, ?
       )`,
      [
        budgetAccountId,
        workspaceId,
        new Date("2026-07-27T00:00:00.000Z"),
        new Date("2026-07-30T00:00:00.000Z"),
        principalId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO capability_contract_revision (
         id, workspace_id, contract_key, revision, lifecycle_status,
         canonical_digest, input_schema, output_schema, idempotency_mode,
         supported_invokers, created_at, published_at
       ) VALUES (
         ?, ?, 'provider.generate', 1, 'published', ?, '{}', '{}',
         'keyed', '["workflow"]', ?, ?
       )`,
      [
        contractRevisionId,
        workspaceId,
        digestProviderValue({
          contract: "provider.generate",
          revision: 1,
        }),
        createdAt,
        createdAt,
      ],
    );
    await insertCapabilityImplementationFixture(connection, {
      workspaceId,
      contractRevisionId,
      adapterDefinitionId,
      adapterRevisionId,
      adapterKey: "provider.v2",
      executionTarget: "provider",
      implementationId: implementationRevisionId,
      implementationKey: "provider.generate",
      canonicalDigest: digestProviderValue({
        implementation: "provider.generate",
        revision: 1,
      }),
      createdAt,
    });
    await connection.execute(
      `INSERT INTO capability_binding (
         id, workspace_id, binding_key, contract_revision_id,
         implementation_revision_id, lifecycle_status, priority, version,
         route_policy, route_policy_revision_id, created_at, updated_at
       ) VALUES (
         ?, ?, 'provider.generate', ?, ?, 'active', 1, 1, '{}', ?, ?, ?
       )`,
      [
        capabilityBindingId,
        workspaceId,
        contractRevisionId,
        implementationRevisionId,
        routePolicyRevisionId,
        createdAt,
        createdAt,
      ],
    );
    await connection.execute(
      `INSERT INTO workflow_revision (
         id, workspace_id, workflow_key, revision, lifecycle_status,
         canonical_digest, topology, input_schema, output_schema,
         created_at, published_at
       ) VALUES (
         ?, ?, 'provider-control-integration', 1, 'published',
         ?, '{"nodes":[]}', '{}', '{}', ?, ?
       )`,
      [
        workflowRevisionId,
        workspaceId,
        digestProviderValue({
          workflow: "provider-control-integration",
          revision: 1,
        }),
        createdAt,
        createdAt,
      ],
    );
    const hierarchies: WorkflowHierarchy[] = [];
    for (let index = 1; index <= 4; index += 1) {
      hierarchies.push(await seedExecutionHierarchy(connection, index));
    }
    await connection.commit();
    return Object.freeze(hierarchies);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

describe.skipIf(!integrationEnabled)(
  "Config, Secret, Provider Route v1, and Budget against disposable MySQL 8.0",
  () => {
    const disposableName = databaseName();
    let adminPool!: Pool;
    let pool!: Pool;

    beforeAll(async () => {
      adminPool = createAdminPool();
      await adminPool.query(
        `CREATE DATABASE \`${disposableName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const inventory = await readMigrationInventory(
        resolve(import.meta.dirname, "../migrations"),
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${disposableName}\``);
        for (const migration of inventory) {
          await connection.query(migration.sql);
        }
      } finally {
        connection.release();
      }
      pool = createTestPool(disposableName);
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${disposableName}\``);
        await adminPool.end();
      }
    }, 30_000);

    it("pins an immutable route and old secret while serializing budget reservation and audit", async () => {
      const hierarchies = await seedFixture(pool);
      const routeStore = createProviderRouteStore(pool, {
        deploymentHardBounds,
      });
      const requestScopeDigest = digestProviderValue({
        workspaceId,
        capabilityBindingId,
        request: "integration",
      });
      const routeSnapshot = await routeStore.resolve({
        workspaceId,
        capabilityBindingId,
        requestScopeDigest,
        now,
      });
      const withoutOverlay = await createProviderRouteStore(pool, {}).resolve({
        workspaceId,
        capabilityBindingId,
        requestScopeDigest,
        now,
      });
      expect(withoutOverlay).toEqual(routeSnapshot);
      await expect(
        createProviderRouteStore(pool, {
          deploymentHardBounds: {
            ...deploymentHardBounds,
            allowedRegionCodes: ["blocked-region"],
          },
        }).resolve({
          workspaceId,
          capabilityBindingId,
          requestScopeDigest,
          now,
        }),
      ).rejects.toThrow();
      const wireSnapshot = JSON.parse(JSON.stringify(routeSnapshot)) as unknown;
      const reparsedSnapshot = parseProviderRouteSnapshot(wireSnapshot);
      expect(reparsedSnapshot).toMatchObject({
        providerProtocolVersion: 1,
        providerEndpointId: endpointId,
        credentialIdentityId: credentialId,
        credentialIdentityEpoch: 1,
        pinnedSecretVersionId: oldSecretVersionId,
        instancePolicyRevisionId,
        workspacePolicyRevisionId,
        routePolicyRevisionId,
        modelProfileRevisionId,
        modelDeploymentId,
        pricingRevisionId,
        budgetAccountId,
        routingMode: "kanvas_fixed",
        executionTransparency: "full",
        maximumCharge: {
          currencyCode: "USD",
          amount: "60",
        },
        requestScopeDigest,
      });

      const secretStore = createSecretVersionStore(pool);
      await expect(
        secretStore.create({
          workspaceId,
          credentialId,
          secretVersionId: nextSecretVersionId,
          expectedCredentialVersion: 1,
          source: {
            kind: "deployment_reference",
            deploymentReference: "deployment://tokenhub/primary-v2",
          },
          aadDigest: secretAadDigestFor({
            instanceId,
            workspaceId,
            credentialId,
            secretVersionId: nextSecretVersionId,
            providerKind: "openai",
            formatVersion: 1,
          }),
          materialFingerprint: nextSecretFingerprint,
          formatVersion: 1,
          createdByPrincipalId: principalId,
          now,
          audit: audit(id(2_001)),
        }),
      ).resolves.toMatchObject({
        id: nextSecretVersionId,
        lifecycleStatus: "created",
        materialGeneration: 2,
      });
      await expect(
        secretStore.verify({
          workspaceId,
          credentialId,
          secretVersionId: nextSecretVersionId,
          expectedCredentialVersion: 1,
          now: new Date(now.getTime() + 1_000),
          audit: audit(id(2_002)),
        }),
      ).resolves.toMatchObject({
        id: nextSecretVersionId,
        lifecycleStatus: "verified",
        materialGeneration: 2,
      });
      const drainDeadlineAt = new Date(now.getTime() + 600_000);
      await expect(
        secretStore.rotateActive({
          workspaceId,
          credentialId,
          candidateSecretVersionId: nextSecretVersionId,
          expectedCredentialVersion: 1,
          previousDrainDeadlineAt: drainDeadlineAt,
          now: new Date(now.getTime() + 2_000),
          audit: audit(id(2_003)),
        }),
      ).resolves.toMatchObject({
        id: nextSecretVersionId,
        lifecycleStatus: "active",
        materialGeneration: 2,
      });
      await expect(
        secretStore.resolvePinnedMetadata({
          workspaceId,
          credentialId,
          pinnedSecretVersionId:
            reparsedSnapshot.providerProtocolVersion === 1
              ? reparsedSnapshot.pinnedSecretVersionId
              : "",
          expectedCredentialIdentityEpoch: 1,
          expectedCredentialIdentityDigest: credentialIdentityDigest,
          expectedProviderEndpointId: endpointId,
          now: new Date(now.getTime() + 60_000),
        }),
      ).resolves.toMatchObject({
        id: oldSecretVersionId,
        sourceKind: "deployment_reference",
        lifecycleStatus: "draining",
        deploymentReference: "deployment://tokenhub/primary-v1",
        drainDeadlineAt,
      });

      const budgetStore = createBudgetReservationStore(pool);
      const reservationOptions = hierarchies
        .slice(0, 2)
        .map((hierarchy, index): ReserveBudgetOptions => ({
          reservationId: id(3_001 + index * 10),
          ledgerEntryId: id(3_002 + index * 10),
          workspaceId,
          budgetAccountId,
          reservationKey: `attempt-${String(index + 1)}`,
          requestDigest: digestProviderValue({
            reservation: index + 1,
          }),
          workflowRunId: hierarchy.workflowRunId,
          capabilityRunId: hierarchy.capabilityRunId,
          capabilityAttemptId: hierarchy.capabilityAttemptId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "60",
          expiresAt: new Date(now.getTime() + 3_600_000),
          now: new Date(now.getTime() + 120_000),
          audit: audit(id(3_003 + index * 10)),
        }));
      const reservationResults = await Promise.all(
        reservationOptions.map((options) => budgetStore.reserve(options)),
      );
      expect(reservationResults.map(({ status }) => status).sort()).toEqual([
        "rejected",
        "reserved",
      ]);
      const winnerIndex = reservationResults.findIndex(
        ({ status }) => status === "reserved",
      );
      expect(winnerIndex).toBeGreaterThanOrEqual(0);
      const winner = reservationOptions[winnerIndex];
      if (!winner) {
        throw new Error("Concurrent reservation has no winner.");
      }
      expect(
        await countRows(
          pool,
          "budget_ledger_entry",
          "WHERE budget_account_id = ?",
          [budgetAccountId],
        ),
      ).toBe(1);

      const ledgerCountBeforeReplay = await countRows(
        pool,
        "budget_ledger_entry",
      );
      const auditCountBeforeReplay = await countRows(pool, "audit_event");
      await expect(budgetStore.reserve(winner)).resolves.toMatchObject({
        status: "replayed",
        reservationId: winner.reservationId,
        reservedAmount: "60",
      });
      expect(await countRows(pool, "budget_ledger_entry")).toBe(
        ledgerCountBeforeReplay,
      );
      expect(await countRows(pool, "audit_event")).toBe(auditCountBeforeReplay);

      const rollbackHierarchy = hierarchies[2];
      if (!rollbackHierarchy) {
        throw new Error("Rollback hierarchy is missing.");
      }
      const rollbackReservationId = id(3_021);
      await expect(
        budgetStore.reserve({
          reservationId: rollbackReservationId,
          ledgerEntryId: id(3_022),
          workspaceId,
          budgetAccountId,
          reservationKey: "attempt-rollback",
          requestDigest: digestProviderValue({
            reservation: "rollback",
          }),
          workflowRunId: rollbackHierarchy.workflowRunId,
          capabilityRunId: rollbackHierarchy.capabilityRunId,
          capabilityAttemptId: rollbackHierarchy.capabilityAttemptId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "10",
          expiresAt: new Date(now.getTime() + 3_600_000),
          now: new Date(now.getTime() + 180_000),
          audit: winner.audit,
        }),
      ).rejects.toBeDefined();
      expect(
        await countRows(pool, "budget_reservation", "WHERE id = ?", [
          rollbackReservationId,
        ]),
      ).toBe(0);
      expect(await countRows(pool, "budget_ledger_entry")).toBe(
        ledgerCountBeforeReplay,
      );
      expect(await countRows(pool, "audit_event")).toBe(auditCountBeforeReplay);

      const finalizeOptions = {
        workspaceId,
        budgetAccountId,
        reservationId: winner.reservationId,
        ledgerEntryId: id(3_031),
        ledgerEntryKey: `capture:${winner.reservationId}`,
        requestDigest: winner.requestDigest,
        kind: "capture" as const,
        capturedAmount: "30",
        now: new Date(now.getTime() + 240_000),
        audit: audit(id(3_032)),
      };
      await expect(
        budgetStore.finalize(finalizeOptions),
      ).resolves.toMatchObject({
        status: "finalized",
        lifecycleStatus: "settled",
        settledAmount: "30",
      });
      const ledgerCountAfterFinalize = await countRows(
        pool,
        "budget_ledger_entry",
      );
      const auditCountAfterFinalize = await countRows(pool, "audit_event");
      await expect(
        budgetStore.finalize(finalizeOptions),
      ).resolves.toMatchObject({
        status: "replayed",
        lifecycleStatus: "settled",
        settledAmount: "30",
      });
      expect(await countRows(pool, "budget_ledger_entry")).toBe(
        ledgerCountAfterFinalize,
      );
      expect(await countRows(pool, "audit_event")).toBe(
        auditCountAfterFinalize,
      );

      const [accountRows] = await pool.query<BudgetAccountRow[]>(
        `SELECT
           consumed_amount AS consumedAmount,
           reserved_amount AS reservedAmount,
           unknown_held_amount AS unknownHeldAmount,
           version
         FROM budget_account
         WHERE id = ?`,
        [budgetAccountId],
      );
      expect(accountRows[0]).toMatchObject({
        consumedAmount: "30.000000000000",
        reservedAmount: "0.000000000000",
        unknownHeldAmount: "0.000000000000",
        version: 3,
      });

      const unknownHierarchy = hierarchies[2];
      if (!unknownHierarchy) {
        throw new Error("Unknown-hold hierarchy was not seeded.");
      }
      const unknownReservationId = id(3_041);
      const unknownRequestDigest = digestProviderValue({
        reservation: "unknown-hold",
      });
      await expect(
        budgetStore.reserve({
          reservationId: unknownReservationId,
          ledgerEntryId: id(3_042),
          workspaceId,
          budgetAccountId,
          reservationKey: "attempt-unknown-hold",
          requestDigest: unknownRequestDigest,
          workflowRunId: unknownHierarchy.workflowRunId,
          capabilityRunId: unknownHierarchy.capabilityRunId,
          capabilityAttemptId: unknownHierarchy.capabilityAttemptId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "5",
          expiresAt: new Date(now.getTime() + 3_600_000),
          now: new Date(now.getTime() + 300_000),
          audit: audit(id(3_043)),
        }),
      ).resolves.toMatchObject({
        status: "reserved",
        reservedAmount: "5",
      });
      await expect(
        budgetStore.finalize({
          workspaceId,
          budgetAccountId,
          reservationId: unknownReservationId,
          ledgerEntryId: id(3_044),
          ledgerEntryKey: `unknown:${unknownReservationId}`,
          requestDigest: unknownRequestDigest,
          kind: "unknown_hold",
          now: new Date(now.getTime() + 301_000),
          audit: audit(id(3_045)),
        }),
      ).resolves.toMatchObject({
        status: "finalized",
        lifecycleStatus: "unknown",
        settledAmount: null,
        unknownHoldAmount: "5",
      });
      const [unknownAccountRows] = await pool.query<BudgetAccountRow[]>(
        `SELECT
           consumed_amount AS consumedAmount,
           reserved_amount AS reservedAmount,
           unknown_held_amount AS unknownHeldAmount,
           version
         FROM budget_account
         WHERE id = ?`,
        [budgetAccountId],
      );
      expect(unknownAccountRows[0]).toMatchObject({
        consumedAmount: "30.000000000000",
        reservedAmount: "0.000000000000",
        unknownHeldAmount: "5.000000000000",
        version: 5,
      });
      const afterUnknownHierarchy = hierarchies[3];
      if (!afterUnknownHierarchy) {
        throw new Error("Post-unknown-hold hierarchy was not seeded.");
      }
      await expect(
        budgetStore.reserve({
          reservationId: id(3_046),
          ledgerEntryId: id(3_047),
          workspaceId,
          budgetAccountId,
          reservationKey: "attempt-after-unknown-hold",
          requestDigest: digestProviderValue({
            reservation: "after-unknown-hold",
          }),
          workflowRunId: afterUnknownHierarchy.workflowRunId,
          capabilityRunId: afterUnknownHierarchy.capabilityRunId,
          capabilityAttemptId: afterUnknownHierarchy.capabilityAttemptId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "1",
          expiresAt: new Date(now.getTime() + 3_600_000),
          now: new Date(now.getTime() + 302_000),
          audit: audit(id(3_048)),
        }),
      ).resolves.toMatchObject({
        status: "reserved",
        reservedAmount: "1",
      });
      const resolveUnknownOptions = {
        scope: resolutionScope,
        reservationId: unknownReservationId,
        expectedVersion: 2,
        ledgerEntryId: id(3_049),
        ledgerEntryKey: `unknown-resolve:${unknownReservationId}:2`,
        requestDigest: digestProviderValue({
          reservation: "unknown-hold",
          resolution: "charged",
          chargedAmount: "3",
          evidenceReference: "provider-history-2026-07-28",
        }),
        resolution: "charged" as const,
        chargedAmount: "3",
        evidenceReference: "provider-history-2026-07-28",
        now: new Date(now.getTime() + 303_000),
        audit: audit(id(3_050)),
      };
      await expect(
        budgetStore.resolveUnknown(resolveUnknownOptions),
      ).resolves.toMatchObject({
        status: "resolved",
        lifecycleStatus: "settled",
        chargedAmount: "3",
      });
      const ledgerCountAfterResolution = await countRows(
        pool,
        "budget_ledger_entry",
      );
      await expect(
        budgetStore.resolveUnknown(resolveUnknownOptions),
      ).resolves.toMatchObject({
        status: "replayed",
        lifecycleStatus: "settled",
        chargedAmount: "3",
      });
      expect(await countRows(pool, "budget_ledger_entry")).toBe(
        ledgerCountAfterResolution,
      );
      const [resolvedAccountRows] = await pool.query<BudgetAccountRow[]>(
        `SELECT
           consumed_amount AS consumedAmount,
           reserved_amount AS reservedAmount,
           unknown_held_amount AS unknownHeldAmount,
           version
         FROM budget_account
         WHERE id = ?`,
        [budgetAccountId],
      );
      expect(resolvedAccountRows[0]).toMatchObject({
        consumedAmount: "33.000000000000",
        reservedAmount: "1.000000000000",
        unknownHeldAmount: "0.000000000000",
        version: 7,
      });
      await expect(
        budgetStore.reserve({
          reservationId: id(3_046),
          ledgerEntryId: id(3_047),
          workspaceId,
          budgetAccountId,
          reservationKey: "attempt-after-unknown-hold",
          requestDigest: digestProviderValue({
            reservation: "after-unknown-hold",
          }),
          workflowRunId: afterUnknownHierarchy.workflowRunId,
          capabilityRunId: afterUnknownHierarchy.capabilityRunId,
          capabilityAttemptId: afterUnknownHierarchy.capabilityAttemptId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "1",
          expiresAt: new Date(now.getTime() + 3_600_000),
          now: new Date(now.getTime() + 304_000),
          audit: audit(id(3_051)),
        }),
      ).resolves.toMatchObject({
        status: "replayed",
        reservedAmount: "1",
      });

      const agentDefinitionId = id(3_059);
      const agentProfileRevisionId = id(3_060);
      const agentThreadId = id(3_061);
      const agentRunId = id(3_062);
      const agentModelCallId = id(3_063);
      const agentReservationId = id(3_064);
      await pool.execute(
        `INSERT INTO agent_definition (
           id, workspace_id, agent_key, owner_principal_id, visibility,
           lifecycle_status, creation_request_key, creation_request_hash,
           version, created_by_principal_id, updated_by_principal_id,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, 'budget-agent', ?, 'private', 'active',
                   'budget-agent-definition', ?, 1, ?, ?, ?, ?, NULL)`,
        [
          agentDefinitionId,
          workspaceId,
          principalId,
          digestProviderValue({ agent: "budget-agent-definition" }),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_profile_revision (
           id, workspace_id, agent_definition_id, profile_key, revision,
           lifecycle_status,
           schema_version, manifest_document, canonical_digest,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, 'budget-agent-profile', 1, 'published', 1,
                   '{}', ?, ?, ?, ?, ?)`,
        [
          agentProfileRevisionId,
          workspaceId,
          agentDefinitionId,
          digestProviderValue({ profile: "budget-agent-profile" }),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_thread (
           id, workspace_id, created_by_principal_id, agent_definition_id,
           agent_profile_revision_id, lifecycle_status, title,
           creation_request_key, creation_request_hash, version,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, 'active', 'Budget Agent',
                   'budget-agent-thread', ?, 1, ?, ?, NULL)`,
        [
          agentThreadId,
          workspaceId,
          principalId,
          agentDefinitionId,
          agentProfileRevisionId,
          digestProviderValue({ thread: "budget-agent-thread" }),
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_run (
           id, workspace_id, thread_id, actor_principal_id, lifecycle_status,
           context_snapshot, context_digest, tool_view_digest,
           prompt_revision, maximum_model_calls, maximum_tool_calls,
           idempotency_key, request_hash, terminal_reason_code, version,
           execution_deadline_at, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'budget-agent-v1',
                   1, 0, 'budget-agent-run', ?, NULL, 2, ?, ?, ?, NULL)`,
        [
          agentRunId,
          workspaceId,
          agentThreadId,
          principalId,
          JSON.stringify({ schemaVersion: 1, surfaceKind: "workspace_home" }),
          digestProviderValue({ context: "budget-agent" }),
          digestProviderValue({ tools: [] }),
          digestProviderValue({ run: "budget-agent-run" }),
          new Date(now.getTime() + 3_600_000),
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_run_foundation_context (
           workspace_id, agent_run_id, profile_revision_id,
           profile_canonical_digest, skill_view_digest,
           skill_context_snapshot, created_at
         ) VALUES (?, ?, ?, ?, ?, '[]', ?)`,
        [
          workspaceId,
          agentRunId,
          agentProfileRevisionId,
          digestProviderValue({ profile: "budget-agent-profile" }),
          digestProviderValue({ skills: [] }),
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_model_call (
           id, workspace_id, agent_run_id, call_number, purpose,
           lifecycle_status, model_profile_key, input_digest, output_digest,
           finish_reason, terminal_reason_code, version, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, 1, 'plan', 'pending', 'gpt-primary', ?,
                   NULL, NULL, NULL, 1, ?, ?, NULL)`,
        [
          agentModelCallId,
          workspaceId,
          agentRunId,
          digestProviderValue({ prompt: "budget-agent" }),
          now,
          now,
        ],
      );
      const agentReservationRequest = {
        reservationId: agentReservationId,
        ledgerEntryId: id(3_065),
        workspaceId,
        budgetAccountId,
        reservationKey: "agent-model-call-budget",
        requestDigest: digestProviderValue({
          agentModelCallId,
          maximumChargeAmount: "2",
        }),
        consumerKind: "agent_model_call" as const,
        agentRunId,
        agentModelCallId,
        pricingRevisionId,
        currencyCode: "USD",
        maximumChargeAmount: "2",
        expiresAt: new Date(now.getTime() + 3_600_000),
        now: new Date(now.getTime() + 305_000),
        audit: audit(id(3_066)),
      };
      await expect(
        budgetStore.reserve(agentReservationRequest),
      ).resolves.toMatchObject({ status: "reserved", reservedAmount: "2" });
      await expect(
        budgetStore.reserve(agentReservationRequest),
      ).resolves.toMatchObject({ status: "replayed", reservedAmount: "2" });
      await expect(
        budgetStore.finalize({
          workspaceId,
          budgetAccountId,
          reservationId: agentReservationId,
          ledgerEntryId: id(3_067),
          ledgerEntryKey: `consume:${agentReservationId}`,
          requestDigest: agentReservationRequest.requestDigest,
          kind: "capture",
          capturedAmount: "0.5",
          now: new Date(now.getTime() + 306_000),
          audit: audit(id(3_068)),
        }),
      ).resolves.toMatchObject({
        status: "finalized",
        lifecycleStatus: "settled",
        settledAmount: "0.5",
      });

      const [retainedRoutes] = await pool.execute<RowDataPacket[]>(
        "SELECT route_document AS document FROM route_policy_revision WHERE id = ?",
        [routePolicyRevisionId],
      );
      expect(retainedRoutes[0]?.document).toEqual(routePolicyDocument);
    }, 120_000);
  },
);
