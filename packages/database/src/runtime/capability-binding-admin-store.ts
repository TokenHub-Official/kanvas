import {
  parseModelProfileDocumentV1,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  ProviderModelCapabilityKey,
  ProviderModelParameterDefinition,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";
import { isProviderModelCapabilityKey } from "@kanvas/contracts/provider-model";
import type { LocalizedTextV1 } from "@kanvas/contracts/capability";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { parseProviderRoutePolicyDocument } from "./configuration-policy.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { reconcileCatalogRuntimeInTransaction } from "./catalog-runtime-reconciler.js";

export type CapabilityBindingAvailabilityReason =
  | "ready"
  | "contract_unavailable"
  | "implementation_unavailable"
  | "provider_unconfigured"
  | "provider_unavailable"
  | "credential_unavailable"
  | "budget_unavailable";

export interface CapabilityBindingAdminRecord {
  readonly id: string;
  readonly contractRevisionId: string;
  readonly capabilityKey: string;
  readonly capabilityRevision: number;
  readonly bindingStatus: "active" | "disabled" | "revoked";
  readonly priority: number;
  readonly version: number;
  readonly executionTarget: "browser" | "worker" | "provider";
  readonly implementationDisplayName: LocalizedTextV1;
  readonly implementationDescription?: LocalizedTextV1;
  readonly sourceKind: "model_resource" | "model_service" | "plugin";
  readonly implementationKey: string;
  readonly implementationRevision: number;
  readonly adapterKey: string;
  readonly routePolicyRevisionId?: string;
  readonly providerName?: string;
  readonly providerModelId?: string;
  readonly apiSurface?: string;
  readonly availabilityReason: CapabilityBindingAvailabilityReason;
  readonly updatedAt: Date;
}

export interface ProviderRouteAdminRecord {
  readonly routePolicyRevisionId: string;
  readonly providerName: string;
  readonly providerModelId: string;
  readonly providerPreset: string;
  readonly apiSurface: string;
  readonly modelInputModalities?: readonly string[];
  readonly modelOperation?: ProviderModelCapabilityKey;
  readonly providerParameterDefinitions?: readonly ProviderModelParameterDefinition[];
  readonly providerParameterPolicies?: ProviderModelParameterPolicies;
  readonly availabilityReason:
    "ready" | "provider_unavailable" | "budget_unavailable";
  readonly availableBudgetAmount: string;
}

export interface SetCapabilityBindingStatusOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly bindingId: string;
  readonly expectedVersion: number;
  readonly status: "active" | "disabled";
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface MoveCapabilityBindingOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly bindingId: string;
  readonly expectedVersion: number;
  readonly adjacentBindingId: string;
  readonly expectedAdjacentVersion: number;
  readonly direction: "earlier" | "later";
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CapabilityBindingMutationRecord {
  readonly bindingId: string;
  readonly version: number;
  readonly adjacentBindingId?: string;
  readonly adjacentVersion?: number;
}

export interface CapabilityBindingAdminStore {
  list(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly CapabilityBindingAdminRecord[]>;
  listProviderRoutes(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ProviderRouteAdminRecord[]>;
  setStatus(
    options: SetCapabilityBindingStatusOptions,
  ): Promise<CapabilityBindingMutationRecord>;
  move(
    options: MoveCapabilityBindingOptions,
  ): Promise<CapabilityBindingMutationRecord>;
}

interface BindingRow extends RowDataPacket {
  readonly id: string;
  readonly contractRevisionId: string;
  readonly capabilityKey: string;
  readonly capabilityRevision: number;
  readonly contractStatus: string;
  readonly bindingStatus: "active" | "disabled" | "revoked";
  readonly priority: number;
  readonly version: number;
  readonly executionTarget: "browser" | "worker" | "provider";
  readonly implementationDisplayName: LocalizedTextV1;
  readonly implementationDescription: LocalizedTextV1 | null;
  readonly sourceKind: CapabilityBindingAdminRecord["sourceKind"];
  readonly implementationKey: string;
  readonly implementationRevision: number;
  readonly implementationStatus: string;
  readonly adapterKey: string;
  readonly runtimeAdapterKey: string;
  readonly runtimeAdapterStatus: string;
  readonly runtimeAdapterDefinitionStatus: string;
  readonly runtimeAdapterExecutionTarget: string;
  readonly modelResourceReady: number | string;
  readonly routePolicyRevisionId: string | null;
  readonly routeDocument: unknown;
  readonly providerModelId: string | null;
  readonly apiSurface: string | null;
  readonly routePolicyStatus: string | null;
  readonly providerName: string | null;
  readonly providerStatus: string | null;
  readonly providerValidation: string | null;
  readonly activeSecretVersionId: string | null;
  readonly budgetStatus: string | null;
  readonly budgetPeriodStartAt: Date | null;
  readonly budgetPeriodEndAt: Date | null;
  readonly updatedAt: Date;
}

interface ProviderRouteRow extends RowDataPacket {
  readonly routePolicyRevisionId: string;
  readonly providerName: string;
  readonly providerModelId: string;
  readonly apiSurface: string;
  readonly routeDocument: unknown;
  readonly modelProfileSchemaVersion: number;
  readonly modelProfileDocument: unknown;
  readonly modelProfileCanonicalDigest: string;
  readonly modelProfileStatus: string;
  readonly routeStatus: string;
  readonly endpointStatus: string;
  readonly endpointValidation: string;
  readonly modelStatus: string;
  readonly credentialStatus: string;
  readonly secretStatus: string | null;
  readonly budgetStatus: string;
  readonly budgetPeriodStartAt: Date;
  readonly budgetPeriodEndAt: Date;
  readonly availableBudgetAmount: string;
}

interface MoveRow extends RowDataPacket {
  readonly id: string;
  readonly contractRevisionId: string;
  readonly priority: number;
  readonly version: number;
}

function decodeJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function providerRouteOperationFacts(input: {
  readonly routeDocument: unknown;
  readonly modelProfileSchemaVersion: number | null;
  readonly modelProfileDocument: unknown;
  readonly modelProfileCanonicalDigest: string | null;
  readonly modelProfileStatus: string | null;
}): {
  readonly modelInputModalities?: readonly string[];
  readonly modelOperation?: ProviderModelCapabilityKey;
  readonly providerParameterDefinitions?: readonly ProviderModelParameterDefinition[];
  readonly providerParameterPolicies?: ProviderModelParameterPolicies;
} {
  const route = parseProviderRoutePolicyDocument(
    decodeJson(input.routeDocument, "Provider route policy"),
  );
  if (
    !route.capabilityKey ||
    !isProviderModelCapabilityKey(route.capabilityKey)
  ) {
    return {};
  }
  const modelOperation = route.capabilityKey;
  const operationFact = Object.freeze({ modelOperation });
  if (
    !route.parameterPolicies ||
    input.modelProfileSchemaVersion !== 1 ||
    input.modelProfileStatus !== "published" ||
    !input.modelProfileCanonicalDigest
  ) {
    return operationFact;
  }
  const profileDocument = decodeJson(
    input.modelProfileDocument,
    "Model profile",
  );
  if (
    digestProviderValue(profileDocument) !== input.modelProfileCanonicalDigest
  ) {
    throw new Error("Model profile differs from its canonical digest.");
  }
  const profile = parseModelProfileDocumentV1(profileDocument);
  const operation = profile.operations[modelOperation];
  if (!operation) {
    throw new Error("Provider route is not supported by its Model Profile.");
  }
  return Object.freeze({
    modelOperation,
    modelInputModalities: profile.model.inputModalities,
    providerParameterDefinitions: operation.parameters,
    providerParameterPolicies: route.parameterPolicies,
  });
}

function availabilityReason(
  row: BindingRow,
  now: Date,
): CapabilityBindingAvailabilityReason {
  if (!["published", "deprecated"].includes(row.contractStatus)) {
    return "contract_unavailable";
  }
  if (
    !["published", "deprecated"].includes(row.implementationStatus) ||
    row.runtimeAdapterDefinitionStatus !== "active" ||
    !["published", "deprecated"].includes(row.runtimeAdapterStatus) ||
    row.runtimeAdapterKey !== row.adapterKey ||
    row.runtimeAdapterExecutionTarget !== row.executionTarget ||
    (row.sourceKind === "model_resource" &&
      Number(row.modelResourceReady) !== 1)
  ) {
    return "implementation_unavailable";
  }
  if (row.executionTarget !== "provider") return "ready";
  if (!row.providerName || row.routePolicyStatus !== "published") {
    return "provider_unconfigured";
  }
  if (row.providerStatus !== "active" || row.providerValidation !== "passed") {
    return "provider_unavailable";
  }
  if (!row.activeSecretVersionId) return "credential_unavailable";
  if (
    row.budgetStatus !== "active" ||
    !row.budgetPeriodStartAt ||
    !row.budgetPeriodEndAt ||
    row.budgetPeriodStartAt > now ||
    row.budgetPeriodEndAt <= now
  ) {
    return "budget_unavailable";
  }
  return "ready";
}

function recordFrom(row: BindingRow, now: Date): CapabilityBindingAdminRecord {
  return Object.freeze({
    id: row.id,
    contractRevisionId: row.contractRevisionId,
    capabilityKey: row.capabilityKey,
    capabilityRevision: row.capabilityRevision,
    bindingStatus: row.bindingStatus,
    priority: row.priority,
    version: row.version,
    executionTarget: row.executionTarget,
    implementationDisplayName: row.implementationDisplayName,
    ...(row.implementationDescription
      ? { implementationDescription: row.implementationDescription }
      : {}),
    sourceKind: row.sourceKind,
    implementationKey: row.implementationKey,
    implementationRevision: row.implementationRevision,
    adapterKey: row.adapterKey,
    ...(row.routePolicyRevisionId
      ? { routePolicyRevisionId: row.routePolicyRevisionId }
      : {}),
    ...(row.providerName ? { providerName: row.providerName } : {}),
    ...(row.providerModelId ? { providerModelId: row.providerModelId } : {}),
    ...(row.apiSurface ? { apiSurface: row.apiSurface } : {}),
    availabilityReason: availabilityReason(row, now),
    updatedAt: new Date(row.updatedAt),
  });
}

function providerRouteRecordFrom(
  row: ProviderRouteRow,
  now: Date,
): ProviderRouteAdminRecord {
  const providerReady =
    row.routeStatus === "published" &&
    row.endpointStatus === "active" &&
    row.endpointValidation === "passed" &&
    row.modelStatus === "active" &&
    row.credentialStatus === "active" &&
    row.secretStatus === "active";
  const budgetReady =
    row.budgetStatus === "active" &&
    row.budgetPeriodStartAt <= now &&
    row.budgetPeriodEndAt > now;
  const parameterFacts = providerRouteOperationFacts(row);
  const providerPreset = parseProviderRoutePolicyDocument(
    decodeJson(row.routeDocument, "Provider route policy"),
  ).providerKey;
  let availabilityReason: ProviderRouteAdminRecord["availabilityReason"] =
    "ready";
  if (!providerReady) {
    availabilityReason = "provider_unavailable";
  } else if (!budgetReady) {
    availabilityReason = "budget_unavailable";
  }
  return Object.freeze({
    routePolicyRevisionId: row.routePolicyRevisionId,
    providerName: row.providerName,
    providerModelId: row.providerModelId,
    providerPreset,
    apiSurface: row.apiSurface,
    ...parameterFacts,
    availabilityReason,
    availableBudgetAmount: row.availableBudgetAmount,
  });
}

const bindingSelect = `SELECT
  binding.id,
  binding.contract_revision_id AS contractRevisionId,
  contract.contract_key AS capabilityKey,
  contract.revision AS capabilityRevision,
  contract.lifecycle_status AS contractStatus,
  binding.lifecycle_status AS bindingStatus,
  binding.priority,
  binding.version,
  implementation.execution_target AS executionTarget,
  implementation.display_name AS implementationDisplayName,
  implementation.description AS implementationDescription,
  implementation.source_kind AS sourceKind,
  implementation.implementation_key AS implementationKey,
  implementation.revision AS implementationRevision,
  implementation.lifecycle_status AS implementationStatus,
  implementation.adapter_key AS adapterKey,
  runtime_adapter_definition.adapter_key AS runtimeAdapterKey,
  runtime_adapter.lifecycle_status AS runtimeAdapterStatus,
  runtime_adapter_definition.lifecycle_status AS runtimeAdapterDefinitionStatus,
  runtime_adapter.execution_target AS runtimeAdapterExecutionTarget,
  CASE WHEN EXISTS (
    SELECT 1
    FROM capability_implementation_model_resource AS model_reference
    INNER JOIN model_resource_revision AS model_revision
      ON model_revision.workspace_id = model_reference.workspace_id
     AND model_revision.id = model_reference.model_resource_revision_id
     AND model_revision.lifecycle_status IN ('published', 'deprecated')
    INNER JOIN model_resource AS model_resource
      ON model_resource.workspace_id = model_revision.workspace_id
     AND model_resource.id = model_revision.model_resource_id
     AND model_resource.lifecycle_status = 'active'
    INNER JOIN model_resource_revision_file AS model_file
      ON model_file.workspace_id = model_revision.workspace_id
     AND model_file.model_resource_revision_id = model_revision.id
     AND model_file.role = 'primary'
    INNER JOIN stored_object AS model_object
      ON model_object.workspace_id = model_file.workspace_id
     AND model_object.id = model_file.stored_object_id
     AND model_object.delete_state = 'active'
    WHERE model_reference.workspace_id = implementation.workspace_id
      AND model_reference.implementation_revision_id = implementation.id
      AND model_reference.resource_role = 'primary'
  ) THEN 1 ELSE 0 END AS modelResourceReady,
  binding.route_policy_revision_id AS routePolicyRevisionId,
  route.route_document AS routeDocument,
  route.lifecycle_status AS routePolicyStatus,
  setting.display_name AS providerName,
  deployment.provider_model_id AS providerModelId,
  JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.apiSurface')) AS apiSurface,
  endpoint.lifecycle_status AS providerStatus,
  endpoint.validation_status AS providerValidation,
  credential.active_secret_version_id AS activeSecretVersionId,
  budget.lifecycle_status AS budgetStatus,
  budget.period_start_at AS budgetPeriodStartAt,
  budget.period_end_at AS budgetPeriodEndAt,
  binding.updated_at AS updatedAt
FROM capability_binding AS binding
INNER JOIN capability_contract_revision AS contract
  ON contract.workspace_id = binding.workspace_id
 AND contract.id = binding.contract_revision_id
INNER JOIN capability_implementation_revision AS implementation
  ON implementation.workspace_id = binding.workspace_id
 AND implementation.id = binding.implementation_revision_id
INNER JOIN runtime_adapter_revision AS runtime_adapter
  ON runtime_adapter.workspace_id = implementation.workspace_id
 AND runtime_adapter.id = implementation.runtime_adapter_revision_id
INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
  ON runtime_adapter_definition.workspace_id = runtime_adapter.workspace_id
 AND runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
LEFT JOIN route_policy_revision AS route
  ON route.workspace_id = binding.workspace_id
 AND route.id = binding.route_policy_revision_id
LEFT JOIN model_deployment AS deployment
  ON deployment.workspace_id = binding.workspace_id
 AND deployment.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.modelDeploymentId'))
LEFT JOIN provider_endpoint AS endpoint
  ON endpoint.workspace_id = binding.workspace_id
 AND endpoint.id = deployment.provider_endpoint_id
LEFT JOIN provider_setting AS setting
  ON setting.workspace_id = binding.workspace_id
 AND setting.provider_endpoint_id = endpoint.id
LEFT JOIN credential
  ON credential.workspace_id = binding.workspace_id
 AND credential.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.credentialId'))
LEFT JOIN budget_account AS budget
  ON budget.workspace_id = binding.workspace_id
 AND budget.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.budgetAccountId'))`;

const providerRouteSelect = `SELECT
  route.id AS routePolicyRevisionId,
  setting.display_name AS providerName,
  deployment.provider_model_id AS providerModelId,
  route.route_document AS routeDocument,
  profile.schema_version AS modelProfileSchemaVersion,
  profile.profile_document AS modelProfileDocument,
  profile.canonical_digest AS modelProfileCanonicalDigest,
  profile.lifecycle_status AS modelProfileStatus,
  JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.apiSurface')) AS apiSurface,
  route.lifecycle_status AS routeStatus,
  endpoint.lifecycle_status AS endpointStatus,
  endpoint.validation_status AS endpointValidation,
  deployment.lifecycle_status AS modelStatus,
  credential.lifecycle_status AS credentialStatus,
  secret.lifecycle_status AS secretStatus,
  budget.lifecycle_status AS budgetStatus,
  budget.period_start_at AS budgetPeriodStartAt,
  budget.period_end_at AS budgetPeriodEndAt,
  CAST(
    budget.hard_limit_amount - budget.consumed_amount -
    budget.reserved_amount - budget.unknown_held_amount AS CHAR
  ) AS availableBudgetAmount
FROM route_policy_revision AS route
INNER JOIN model_deployment AS deployment
  ON deployment.workspace_id = route.workspace_id
 AND deployment.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.modelDeploymentId'))
INNER JOIN provider_endpoint AS endpoint
  ON endpoint.workspace_id = route.workspace_id
 AND endpoint.id = deployment.provider_endpoint_id
INNER JOIN model_profile_revision AS profile
  ON profile.workspace_id = deployment.workspace_id
 AND profile.id = deployment.model_profile_revision_id
INNER JOIN provider_setting AS setting
  ON setting.workspace_id = route.workspace_id
 AND setting.provider_endpoint_id = endpoint.id
INNER JOIN credential
  ON credential.workspace_id = route.workspace_id
 AND credential.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.credentialId'))
LEFT JOIN secret_version AS secret
  ON secret.workspace_id = credential.workspace_id
 AND secret.id = credential.active_secret_version_id
INNER JOIN budget_account AS budget
  ON budget.workspace_id = route.workspace_id
 AND budget.id = JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.budgetAccountId'))`;

/** Internal read: caller must revalidate Workspace authority in this transaction. */
export async function capabilityBindingReadinessInTransaction(
  connection: PoolConnection,
  workspaceId: string,
  contractRevisionId: string,
  now: Date,
): Promise<{
  readonly readyCount: number;
  readonly reason?:
    | CapabilityBindingAvailabilityReason
    | "binding_unavailable"
    | "route_ambiguous";
}> {
  const [rows] = await connection.execute<BindingRow[]>(
    `${bindingSelect} WHERE binding.workspace_id = ? AND binding.contract_revision_id = ?
     AND binding.lifecycle_status = 'active' ORDER BY binding.priority, binding.id LIMIT 65`,
    [workspaceId, contractRevisionId],
  );
  if (rows.length > 64) return { readyCount: 0, reason: "route_ambiguous" };
  const reasons = rows.map((row) =>
    row.implementationStatus !== "published"
      ? ("implementation_unavailable" as const)
      : availabilityReason(row, now),
  );
  const readyCount = reasons.filter((reason) => reason === "ready").length;
  return readyCount > 0
    ? { readyCount }
    : { readyCount: 0, reason: reasons[0] ?? "binding_unavailable" };
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function appendBindingAudit(
  connection: PoolConnection,
  scope: TrustedWorkspaceScope,
  audit: ControlPlaneAuditContext,
  event: {
    readonly bindingId: string;
    readonly action: string;
    readonly reasonCode: string;
    readonly details: Readonly<Record<string, string | number>>;
    readonly now: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, audit, {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    eventType: event.action,
    action: event.action,
    resourceType: "capability_binding",
    resourceId: event.bindingId,
    outcome: "succeeded",
    decisionReasonCode: event.reasonCode,
    severity: "info",
    authorizationDecision: Object.freeze({
      permission: "capability.configure",
      authorityVersion: scope.authorityVersion,
    }),
    details: event.details,
    occurredAt: event.now,
  });
}

export function createCapabilityBindingAdminStore(
  pool: Pool,
): CapabilityBindingAdminStore {
  return Object.freeze<CapabilityBindingAdminStore>({
    async list(scope, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<BindingRow[]>(
          `${bindingSelect}
           WHERE binding.workspace_id = ?
           ORDER BY contract.contract_key, contract.revision DESC,
                    binding.priority, binding.id
           LIMIT 512`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map((row) => recordFrom(row, now)));
      });
    },

    async listProviderRoutes(scope, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<ProviderRouteRow[]>(
          `${providerRouteSelect}
           WHERE route.workspace_id = ?
             AND route.lifecycle_status = 'published'
             AND deployment.lifecycle_status = 'active'
             AND route.revision = (
               SELECT MAX(newer.revision)
               FROM route_policy_revision AS newer
               WHERE newer.workspace_id = route.workspace_id
                 AND newer.route_key = route.route_key
                 AND newer.lifecycle_status = 'published'
             )
           ORDER BY setting.display_name, deployment.provider_model_id, route.id
           LIMIT 512`,
          [scope.workspaceId],
        );
        return Object.freeze(
          rows.map((row) => providerRouteRecordFrom(row, now)),
        );
      });
    },

    async setStatus(options) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const [rows] = await connection.execute<BindingRow[]>(
          `${bindingSelect}
           WHERE binding.workspace_id = ? AND binding.id = ?
           LIMIT 1 FOR UPDATE`,
          [options.scope.workspaceId, options.bindingId],
        );
        const binding = rows[0];
        if (!binding) throw new Error("Capability Binding was not found.");
        if (binding.version !== options.expectedVersion) {
          throw new Error("Capability Binding changed before this operation.");
        }
        if (binding.bindingStatus === "revoked") {
          throw new Error("A revoked Capability Binding cannot be changed.");
        }
        if (binding.bindingStatus === options.status) {
          return Object.freeze({
            bindingId: binding.id,
            version: binding.version,
          });
        }
        if (
          options.status === "active" &&
          availabilityReason(binding, options.now) !== "ready"
        ) {
          throw new Error("Capability Binding dependencies are not ready.");
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_binding
           SET lifecycle_status = ?,
               route_policy = JSON_SET(
                 route_policy,
                 '$.catalogDesiredEnabled',
                 ? = 'active'
               ),
               version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?
             AND lifecycle_status = ?`,
          [
            options.status,
            options.status,
            options.now,
            options.scope.workspaceId,
            binding.id,
            binding.version,
            binding.bindingStatus,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new Error("Capability Binding changed before this operation.");
        }
        await reconcileCatalogRuntimeInTransaction(connection, {
          workspaceId: options.scope.workspaceId,
          actorPrincipalId: options.scope.principalId,
          now: options.now,
        });
        await appendBindingAudit(connection, options.scope, options.audit, {
          bindingId: binding.id,
          action: "capability_binding.status.changed",
          reasonCode: `capability_binding.${options.status}`,
          details: Object.freeze({
            previousStatus: binding.bindingStatus,
            nextStatus: options.status,
          }),
          now: options.now,
        });
        return Object.freeze({
          bindingId: binding.id,
          version: binding.version + 1,
        });
      });
    },

    async move(options) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const [identityRows] = await connection.execute<MoveRow[]>(
          `SELECT id, contract_revision_id AS contractRevisionId,
                  priority, version
           FROM capability_binding
           WHERE workspace_id = ? AND id = ?
           LIMIT 1 FOR UPDATE`,
          [options.scope.workspaceId, options.bindingId],
        );
        const identity = identityRows[0];
        if (!identity) throw new Error("Capability Binding was not found.");
        const [rows] = await connection.execute<MoveRow[]>(
          `SELECT id, contract_revision_id AS contractRevisionId,
                  priority, version
           FROM capability_binding
           WHERE workspace_id = ? AND contract_revision_id = ?
             AND lifecycle_status <> 'revoked'
           ORDER BY priority, id FOR UPDATE`,
          [options.scope.workspaceId, identity.contractRevisionId],
        );
        const currentIndex = rows.findIndex(
          (row) => row.id === options.bindingId,
        );
        const adjacentIndex =
          options.direction === "earlier" ? currentIndex - 1 : currentIndex + 1;
        const current = rows[currentIndex];
        const adjacent = rows[adjacentIndex];
        if (
          !current ||
          !adjacent ||
          adjacent.id !== options.adjacentBindingId
        ) {
          throw new Error(
            "Capability Binding order changed before this operation.",
          );
        }
        if (
          current.version !== options.expectedVersion ||
          adjacent.version !== options.expectedAdjacentVersion
        ) {
          throw new Error("Capability Binding changed before this operation.");
        }
        const temporaryPriority =
          Math.max(...rows.map((row) => row.priority)) + 1;
        if (temporaryPriority > 4_294_967_295) {
          throw new Error("Capability Binding priorities cannot be reordered.");
        }
        const updates: readonly (readonly [number, string, number])[] = [
          [temporaryPriority, current.id, current.version],
          [current.priority, adjacent.id, adjacent.version],
          [adjacent.priority, current.id, current.version + 1],
        ];
        for (const [priority, id, version] of updates) {
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_binding
             SET priority = ?, version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?`,
            [priority, options.now, options.scope.workspaceId, id, version],
          );
          if (updated.affectedRows !== 1) {
            throw new Error(
              "Capability Binding changed before this operation.",
            );
          }
        }
        await appendBindingAudit(connection, options.scope, options.audit, {
          bindingId: current.id,
          action: "capability_binding.priority.changed",
          reasonCode: `capability_binding.moved_${options.direction}`,
          details: Object.freeze({
            adjacentBindingId: adjacent.id,
            previousPriority: current.priority,
            nextPriority: adjacent.priority,
          }),
          now: options.now,
        });
        return Object.freeze({
          bindingId: current.id,
          version: current.version + 2,
          adjacentBindingId: adjacent.id,
          adjacentVersion: adjacent.version + 1,
        });
      });
    },
  });
}
