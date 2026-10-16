import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  CompiledCapabilityMappingPlanV1,
  LocalizedTextV1,
} from "@kanvas/contracts/capability";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";

export interface PublishCapabilityImplementationRevisionOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly expectedDefinitionVersion: number;
  readonly contractRevisionId: string;
  readonly runtimeAdapterRevisionId: string;
  readonly expectedRuntimeAdapterDigest: string;
  readonly implementationRevisionId: string;
  readonly implementationKey: string;
  readonly implementationRevision: number;
  readonly displayName: LocalizedTextV1;
  readonly description?: LocalizedTextV1;
  readonly executionTarget: "browser" | "worker" | "provider";
  readonly adapterKey: string;
  readonly sourceKind: "model_resource" | "model_service" | "plugin";
  readonly sourceReference: Readonly<Record<string, unknown>>;
  readonly modelResourceRevisionId?: string;
  readonly expectedModelResourceRevisionDigest?: string;
  readonly routePolicyRevisionId?: string;
  readonly canonicalDigest: string;
  readonly publicationRequestKey: string;
  readonly publicationRequestHash: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly inputMapping: Readonly<Record<string, unknown>>;
  readonly inputMappingDigest: string;
  readonly compiledInputMapping: CompiledCapabilityMappingPlanV1;
  readonly outputMapping: Readonly<Record<string, unknown>>;
  readonly outputMappingDigest: string;
  readonly compiledOutputMapping: CompiledCapabilityMappingPlanV1;
  readonly fixtureSuite: readonly Readonly<Record<string, unknown>>[];
  readonly bindingId: string;
  readonly bindingKey: string;
  readonly priority: number;
  readonly routePolicy: Readonly<Record<string, unknown>>;
  readonly bindingStatus?: "active" | "disabled";
  readonly replaceBinding?: Readonly<{
    bindingId: string;
    expectedVersion: number;
  }>;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CapabilityImplementationPublicationResult {
  readonly bindingId: string;
  readonly version: number;
  readonly replayed: boolean;
}

export interface CapabilityImplementationAdminStore {
  publish(
    options: PublishCapabilityImplementationRevisionOptions,
  ): Promise<CapabilityImplementationPublicationResult>;
}

export type CapabilityImplementationAdminStoreErrorCode =
  | "capability_implementation.invalid_argument"
  | "capability_implementation.not_found"
  | "capability_implementation.idempotency_conflict"
  | "capability_implementation.version_conflict"
  | "capability_implementation.lifecycle_conflict"
  | "capability_implementation.priority_conflict";

export class CapabilityImplementationAdminStoreError extends Error {
  public constructor(
    readonly code: CapabilityImplementationAdminStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityImplementationAdminStoreError";
  }
}

interface ReplayRow extends RowDataPacket {
  readonly id: string;
  readonly requestHash: string;
}

interface DefinitionRow extends RowDataPacket {
  readonly version: number;
  readonly lifecycleStatus: "active" | "archived";
  readonly contractRevisionId: string;
  readonly currentContractRevisionId: string;
  readonly contractStatus: string;
}

interface AdapterRow extends RowDataPacket {
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
  readonly executionTarget: string;
  readonly adapterKey: string;
}

interface BindingRow extends RowDataPacket {
  readonly id: string;
  readonly bindingKey: string;
  readonly contractRevisionId: string;
  readonly implementationRevisionId: string;
  readonly implementationKey: string;
  readonly implementationRevision: number;
  readonly priority: number;
  readonly version: number;
}

interface ResourceRow extends RowDataPacket {
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
  readonly resourceStatus: string;
}

interface RouteRow extends RowDataPacket {
  readonly lifecycleStatus: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const keyPattern = /^[a-z0-9]+(?:[._:-][a-z0-9]+)+$/u;

function fail(
  code: CapabilityImplementationAdminStoreErrorCode,
  message: string,
): never {
  throw new CapabilityImplementationAdminStoreError(code, message);
}

function assertOptions(
  options: PublishCapabilityImplementationRevisionOptions,
): void {
  const ids = [
    options.definitionId,
    options.contractRevisionId,
    options.runtimeAdapterRevisionId,
    options.implementationRevisionId,
    options.bindingId,
    ...(options.modelResourceRevisionId
      ? [options.modelResourceRevisionId]
      : []),
    ...(options.routePolicyRevisionId ? [options.routePolicyRevisionId] : []),
    ...(options.replaceBinding ? [options.replaceBinding.bindingId] : []),
  ];
  if (
    ids.some((value) => !idPattern.test(value)) ||
    !keyPattern.test(options.implementationKey) ||
    !keyPattern.test(options.bindingKey) ||
    !digestPattern.test(options.expectedRuntimeAdapterDigest) ||
    !digestPattern.test(options.canonicalDigest) ||
    !digestPattern.test(options.publicationRequestHash) ||
    !digestPattern.test(options.inputMappingDigest) ||
    !digestPattern.test(options.outputMappingDigest) ||
    (options.expectedModelResourceRevisionDigest !== undefined &&
      !digestPattern.test(options.expectedModelResourceRevisionDigest)) ||
    !Number.isSafeInteger(options.expectedDefinitionVersion) ||
    options.expectedDefinitionVersion < 1 ||
    !Number.isSafeInteger(options.implementationRevision) ||
    options.implementationRevision < 1 ||
    !Number.isSafeInteger(options.priority) ||
    options.priority < 1 ||
    options.publicationRequestKey.length < 1 ||
    options.publicationRequestKey.length > 160 ||
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime()) ||
    (options.sourceKind === "model_resource" &&
      (!options.modelResourceRevisionId ||
        !options.expectedModelResourceRevisionDigest ||
        options.routePolicyRevisionId !== undefined)) ||
    (options.sourceKind === "model_service" &&
      (!options.routePolicyRevisionId ||
        options.modelResourceRevisionId !== undefined ||
        options.expectedModelResourceRevisionDigest !== undefined)) ||
    (options.sourceKind === "plugin" &&
      (options.routePolicyRevisionId !== undefined ||
        options.modelResourceRevisionId !== undefined ||
        options.expectedModelResourceRevisionDigest !== undefined))
  ) {
    fail(
      "capability_implementation.invalid_argument",
      "Invalid Capability implementation publication.",
    );
  }
}

function duplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

async function transaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
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

const bindingSelect = `SELECT
  binding.id,
  binding.binding_key AS bindingKey,
  binding.contract_revision_id AS contractRevisionId,
  binding.implementation_revision_id AS implementationRevisionId,
  implementation.implementation_key AS implementationKey,
  implementation.revision AS implementationRevision,
  binding.priority,
  binding.version
FROM capability_binding AS binding
INNER JOIN capability_implementation_revision AS implementation
  ON implementation.workspace_id = binding.workspace_id
 AND implementation.id = binding.implementation_revision_id`;

async function replayResult(
  connection: PoolConnection,
  options: PublishCapabilityImplementationRevisionOptions,
  replay: ReplayRow,
): Promise<CapabilityImplementationPublicationResult> {
  if (replay.requestHash !== options.publicationRequestHash) {
    fail(
      "capability_implementation.idempotency_conflict",
      "Idempotency key was used for another Capability implementation.",
    );
  }
  const [bindings] = await connection.execute<BindingRow[]>(
    options.replaceBinding
      ? `${bindingSelect}
         WHERE binding.workspace_id = ? AND binding.id = ?
         LIMIT 1`
      : `${bindingSelect}
         WHERE binding.workspace_id = ? AND binding.binding_key = ?
         LIMIT 1`,
    [
      options.scope.workspaceId,
      options.replaceBinding?.bindingId ?? options.bindingKey,
    ],
  );
  const binding = bindings[0];
  if (!binding) {
    fail(
      "capability_implementation.lifecycle_conflict",
      "Published implementation lost its Capability binding.",
    );
  }
  return Object.freeze({
    bindingId: binding.id,
    version: binding.version,
    replayed: true,
  });
}

export async function publishCapabilityImplementationRevisionInTransaction(
  connection: PoolConnection,
  options: PublishCapabilityImplementationRevisionOptions,
  authorize = true,
): Promise<CapabilityImplementationPublicationResult> {
  assertOptions(options);
  if (authorize) {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.scope,
      "capability.configure",
      options.now,
    );
  }
  const [replays] = await connection.execute<ReplayRow[]>(
    `SELECT id, publication_request_hash AS requestHash
           FROM capability_implementation_revision
           WHERE workspace_id = ? AND publication_request_key = ?
           LIMIT 1
           FOR UPDATE`,
    [options.scope.workspaceId, options.publicationRequestKey],
  );
  if (replays[0]) {
    return replayResult(connection, options, replays[0]);
  }

  const [definitions] = await connection.execute<DefinitionRow[]>(
    `SELECT
             definition.version,
             definition.lifecycle_status AS lifecycleStatus,
             contract.id AS contractRevisionId,
             definition.current_contract_revision_id AS currentContractRevisionId,
             contract.lifecycle_status AS contractStatus
           FROM capability_definition AS definition
           INNER JOIN capability_contract_revision AS contract
             ON contract.workspace_id = definition.workspace_id
            AND contract.id = ?
            AND contract.contract_key = definition.capability_key
           WHERE definition.workspace_id = ? AND definition.id = ?
           LIMIT 1
           FOR UPDATE`,
    [
      options.contractRevisionId,
      options.scope.workspaceId,
      options.definitionId,
    ],
  );
  const definition = definitions[0];
  if (!definition) {
    fail("capability_implementation.not_found", "Capability was not found.");
  }
  if (
    definition.version !== options.expectedDefinitionVersion ||
    definition.contractRevisionId !== options.contractRevisionId
  ) {
    fail(
      "capability_implementation.version_conflict",
      "Capability changed before its implementation was published.",
    );
  }
  if (
    definition.lifecycleStatus !== "active" ||
    definition.currentContractRevisionId !== options.contractRevisionId ||
    (definition.contractStatus !== "published" &&
      definition.contractStatus !== "deprecated")
  ) {
    fail(
      "capability_implementation.lifecycle_conflict",
      "Capability is not available for a new implementation.",
    );
  }

  const [adapters] = await connection.execute<AdapterRow[]>(
    `SELECT
             revision.canonical_digest AS canonicalDigest,
             revision.lifecycle_status AS lifecycleStatus,
             revision.execution_target AS executionTarget,
             definition.adapter_key AS adapterKey
           FROM runtime_adapter_revision AS revision
           INNER JOIN runtime_adapter_definition AS definition
             ON definition.workspace_id = revision.workspace_id
            AND definition.id = revision.runtime_adapter_definition_id
           WHERE revision.workspace_id = ? AND revision.id = ?
           LIMIT 1
           FOR SHARE`,
    [options.scope.workspaceId, options.runtimeAdapterRevisionId],
  );
  const adapter = adapters[0];
  if (
    !adapter ||
    adapter.canonicalDigest !== options.expectedRuntimeAdapterDigest ||
    adapter.lifecycleStatus !== "published" ||
    adapter.executionTarget !== options.executionTarget ||
    adapter.adapterKey !== options.adapterKey
  ) {
    fail(
      "capability_implementation.lifecycle_conflict",
      "Selected Runtime Adapter is no longer available.",
    );
  }

  if (options.sourceKind === "model_resource") {
    const [resources] = await connection.execute<ResourceRow[]>(
      `SELECT
               revision.canonical_digest AS canonicalDigest,
               revision.lifecycle_status AS lifecycleStatus,
               resource.lifecycle_status AS resourceStatus
             FROM model_resource_revision AS revision
             INNER JOIN model_resource AS resource
               ON resource.workspace_id = revision.workspace_id
              AND resource.id = revision.model_resource_id
             WHERE revision.workspace_id = ? AND revision.id = ?
             LIMIT 1
             FOR SHARE`,
      [options.scope.workspaceId, options.modelResourceRevisionId!],
    );
    const resource = resources[0];
    if (
      !resource ||
      resource.canonicalDigest !==
        options.expectedModelResourceRevisionDigest ||
      (resource.lifecycleStatus !== "published" &&
        resource.lifecycleStatus !== "deprecated") ||
      resource.resourceStatus !== "active"
    ) {
      fail(
        "capability_implementation.lifecycle_conflict",
        "Selected model resource is no longer available.",
      );
    }
  } else if (options.sourceKind === "model_service") {
    const [routes] = await connection.execute<RouteRow[]>(
      `SELECT lifecycle_status AS lifecycleStatus
             FROM route_policy_revision
             WHERE workspace_id = ? AND id = ?
             LIMIT 1
             FOR SHARE`,
      [options.scope.workspaceId, options.routePolicyRevisionId!],
    );
    if (
      !routes[0] ||
      (routes[0].lifecycleStatus !== "published" &&
        routes[0].lifecycleStatus !== "deprecated")
    ) {
      fail(
        "capability_implementation.lifecycle_conflict",
        "Selected model service route is no longer available.",
      );
    }
  }

  let bindingVersion = 1;
  let replacedImplementationId: string | undefined;
  if (options.replaceBinding) {
    const [bindings] = await connection.execute<BindingRow[]>(
      `${bindingSelect}
             WHERE binding.workspace_id = ? AND binding.id = ?
             LIMIT 1
             FOR UPDATE`,
      [options.scope.workspaceId, options.replaceBinding.bindingId],
    );
    const binding = bindings[0];
    if (!binding) {
      fail(
        "capability_implementation.not_found",
        "Capability run method was not found.",
      );
    }
    if (
      binding.version !== options.replaceBinding.expectedVersion ||
      binding.contractRevisionId !== options.contractRevisionId ||
      binding.implementationKey !== options.implementationKey ||
      binding.implementationRevision + 1 !== options.implementationRevision
    ) {
      fail(
        "capability_implementation.version_conflict",
        "Capability run method changed before publication.",
      );
    }
    replacedImplementationId = binding.implementationRevisionId;
    bindingVersion = binding.version + 1;
  }

  try {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO capability_implementation_revision (
               id, workspace_id, implementation_key, display_name,
               description, revision,
               lifecycle_status, contract_revision_id,
               runtime_adapter_revision_id, execution_target, adapter_key,
               source_kind, source_reference, canonical_digest,
               publication_request_key, publication_request_hash,
               configuration, input_mapping, input_mapping_digest,
               compiled_input_mapping, output_mapping, output_mapping_digest,
               compiled_output_mapping, fixture_suite, created_at, published_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?
             )`,
      [
        options.implementationRevisionId,
        options.scope.workspaceId,
        options.implementationKey,
        JSON.stringify(options.displayName),
        options.description ? JSON.stringify(options.description) : null,
        options.implementationRevision,
        options.contractRevisionId,
        options.runtimeAdapterRevisionId,
        options.executionTarget,
        options.adapterKey,
        options.sourceKind,
        JSON.stringify(options.sourceReference),
        options.canonicalDigest,
        options.publicationRequestKey,
        options.publicationRequestHash,
        JSON.stringify(options.configuration),
        JSON.stringify(options.inputMapping),
        options.inputMappingDigest,
        JSON.stringify(options.compiledInputMapping),
        JSON.stringify(options.outputMapping),
        options.outputMappingDigest,
        JSON.stringify(options.compiledOutputMapping),
        JSON.stringify(options.fixtureSuite),
        options.now,
        options.now,
      ],
    );
    if (options.modelResourceRevisionId) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO capability_implementation_model_resource (
                 workspace_id, implementation_revision_id,
                 model_resource_revision_id, resource_role, created_at
               ) VALUES (?, ?, ?, 'primary', ?)`,
        [
          options.scope.workspaceId,
          options.implementationRevisionId,
          options.modelResourceRevisionId,
          options.now,
        ],
      );
    }
    if (options.replaceBinding) {
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE capability_binding
               SET implementation_revision_id = ?, route_policy = ?,
                   route_policy_revision_id = ?, version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ? AND id = ? AND version = ?`,
        [
          options.implementationRevisionId,
          JSON.stringify(options.routePolicy),
          options.routePolicyRevisionId ?? null,
          options.now,
          options.scope.workspaceId,
          options.replaceBinding.bindingId,
          options.replaceBinding.expectedVersion,
        ],
      );
      if (updated.affectedRows !== 1) {
        fail(
          "capability_implementation.version_conflict",
          "Capability run method changed before publication.",
        );
      }
      await connection.execute<ResultSetHeader>(
        `UPDATE capability_implementation_revision
               SET lifecycle_status = 'deprecated'
               WHERE workspace_id = ? AND id = ?
                 AND lifecycle_status = 'published'`,
        [options.scope.workspaceId, replacedImplementationId!],
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO capability_binding (
                 id, workspace_id, binding_key, contract_revision_id,
                 implementation_revision_id, lifecycle_status, priority,
                 version, route_policy, route_policy_revision_id,
                 created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          options.bindingId,
          options.scope.workspaceId,
          options.bindingKey,
          options.contractRevisionId,
          options.implementationRevisionId,
          options.bindingStatus ?? "active",
          options.priority,
          JSON.stringify(options.routePolicy),
          options.routePolicyRevisionId ?? null,
          options.now,
          options.now,
        ],
      );
    }
  } catch (error) {
    if (duplicateEntry(error)) {
      fail(
        "capability_implementation.priority_conflict",
        "Another run method already uses this priority.",
      );
    }
    throw error;
  }

  await appendControlPlaneAuditEventInTransaction(connection, options.audit, {
    organizationId: options.scope.organizationId,
    workspaceId: options.scope.workspaceId,
    eventType: "capability_implementation.published",
    action: "capability_implementation.publish",
    resourceType: "capability_binding",
    resourceId: options.replaceBinding?.bindingId ?? options.bindingId,
    outcome: "succeeded",
    decisionReasonCode: "authorized",
    severity: "info",
    authorizationDecision: Object.freeze({
      permission: "capability.configure",
      authorityVersion: options.scope.authorityVersion,
    }),
    details: Object.freeze({
      capabilityDefinitionId: options.definitionId,
      contractRevisionId: options.contractRevisionId,
      implementationRevisionId: options.implementationRevisionId,
      sourceKind: options.sourceKind,
      executionTarget: options.executionTarget,
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    bindingId: options.replaceBinding?.bindingId ?? options.bindingId,
    version: bindingVersion,
    replayed: false,
  });
}

export function createCapabilityImplementationAdminStore(
  pool: Pool,
): CapabilityImplementationAdminStore {
  return Object.freeze<CapabilityImplementationAdminStore>({
    publish(options) {
      return transaction(pool, (connection) =>
        publishCapabilityImplementationRevisionInTransaction(
          connection,
          options,
        ),
      );
    },
  });
}
