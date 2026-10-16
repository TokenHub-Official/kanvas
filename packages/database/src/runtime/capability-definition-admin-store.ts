import { capabilityBindingReadinessInTransaction } from "./capability-binding-admin-store.js";
import { createEffectiveInvocationSchemaProjector } from "./effective-invocation-schema-store.js";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  CapabilityIdempotencyMode,
  CapabilityInvoker,
  WorkflowCapabilityAuthoringDeclaration,
} from "@kanvas/contracts/api";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { availableCapabilityBindingCountSql } from "./capability-binding-availability-query.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { digestProviderValue } from "./provider-value-digest.js";
import {
  publishCapabilityImplementationRevisionInTransaction,
  type CapabilityImplementationPublicationResult,
  type PublishCapabilityImplementationRevisionOptions,
} from "./capability-implementation-admin-store.js";

export type CapabilityDefinitionStatus = "active" | "archived";

export interface CapabilityDefinitionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly status: CapabilityDefinitionStatus;
  readonly version: number;
  readonly contractRevisionId: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly contractStatus: "draft" | "published" | "deprecated" | "revoked";
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly idempotencyMode: CapabilityIdempotencyMode;
  readonly supportedInvokers: readonly CapabilityInvoker[];
  readonly declarationRevisionId: string;
  readonly declarationRevision: number;
  readonly declarationDigest: string;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
  readonly bindingCount: number;
  readonly activeBindingCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly agentAvailability?: AgentCapabilityAvailability;
}

export interface CapabilityDefinitionPublication {
  readonly key: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly idempotencyMode: CapabilityIdempotencyMode;
  readonly supportedInvokers: readonly CapabilityInvoker[];
  readonly contractDigest: string;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
  readonly declarationDigest: string;
  readonly requestHash: string;
}

interface CapabilityDefinitionCommand {
  readonly scope: TrustedWorkspaceScope;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CreateCapabilityDefinitionOptions
  extends CapabilityDefinitionCommand, CapabilityDefinitionPublication {
  readonly definitionId: string;
  readonly contractRevisionId: string;
  readonly declarationRevisionId: string;
  readonly idempotencyKey: string;
}

export interface UpdateCapabilityDefinitionOptions extends CapabilityDefinitionCommand {
  readonly definitionId: string;
  readonly declarationRevisionId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly title: WorkflowCapabilityAuthoringDeclaration["catalog"]["title"];
  readonly description?: WorkflowCapabilityAuthoringDeclaration["catalog"]["description"];
  readonly category: WorkflowCapabilityAuthoringDeclaration["catalog"]["category"];
  readonly tags: readonly string[];
}

export interface SetCapabilityDefinitionStatusOptions extends CapabilityDefinitionCommand {
  readonly definitionId: string;
  readonly expectedVersion: number;
  readonly status: CapabilityDefinitionStatus;
}

export interface CapabilityDefinitionMutation {
  readonly value: CapabilityDefinitionRecord;
  readonly replayed: boolean;
}

export interface CapabilityDefinitionAdminStore {
  list(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly CapabilityDefinitionRecord[]>;
  discoverAgentCatalog(
    scope: TrustedWorkspaceScope,
    options: {
      readonly query?: string;
      readonly afterKey?: string;
      readonly limit?: number;
    },
    now: Date,
  ): Promise<AgentCapabilityDiscovery>;
  resolveAgentCapability(
    scope: TrustedWorkspaceScope,
    key: string,
    now: Date,
  ): Promise<AgentCapabilityAssessment | undefined>;
  searchAgentCatalog(
    scope: TrustedWorkspaceScope,
    query: string | undefined,
    limit: number,
    now: Date,
  ): Promise<readonly AgentCapabilityCatalogRecord[]>;
  resolveAgentCatalogPresentations(
    scope: TrustedWorkspaceScope,
    contractRevisionIds: readonly string[],
    now: Date,
  ): Promise<readonly AgentCapabilityPresentationRecord[]>;
  create(
    options: CreateCapabilityDefinitionOptions,
  ): Promise<CapabilityDefinitionMutation>;
  createWithImplementation(
    definition: CreateCapabilityDefinitionOptions,
    implementation: PublishCapabilityImplementationRevisionOptions,
  ): Promise<
    Readonly<{
      definition: CapabilityDefinitionMutation;
      implementation: CapabilityImplementationPublicationResult;
    }>
  >;
  update(
    options: UpdateCapabilityDefinitionOptions,
  ): Promise<CapabilityDefinitionMutation>;
  setStatus(
    options: SetCapabilityDefinitionStatusOptions,
  ): Promise<CapabilityDefinitionMutation>;
}

export interface AgentCapabilityAvailability {
  readonly status: "ready" | "unavailable" | "unknown";
  readonly stage: "eligibility" | "binding" | "invocation";
  readonly reason?: string;
}
export interface AgentCapabilityAssessment {
  readonly capability: AgentCapabilityCatalogRecord;
  readonly availability: AgentCapabilityAvailability;
}
export interface AgentCapabilityDiscovery {
  readonly items: readonly AgentCapabilityAssessment[];
  readonly complete: boolean;
  readonly nextCursor?: string;
  readonly evaluatedAt: string;
}

export interface AgentCapabilityCatalogRecord {
  readonly key: string;
  readonly contractRevisionId: string;
  readonly contractRevision: number;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly activeBindingCount: number;
}

export interface AgentCapabilityPresentationRecord {
  readonly contractRevisionId: string;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
}

export type CapabilityDefinitionAdminStoreErrorCode =
  | "capability_definition.not_found"
  | "capability_definition.key_conflict"
  | "capability_definition.version_conflict"
  | "capability_definition.idempotency_conflict"
  | "capability_definition.lifecycle_conflict";

export class CapabilityDefinitionAdminStoreError extends Error {
  public constructor(
    public readonly code: CapabilityDefinitionAdminStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityDefinitionAdminStoreError";
  }
}

interface DefinitionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilityKey: string;
  readonly definitionStatus: CapabilityDefinitionStatus;
  readonly version: number;
  readonly contractRevisionId: string;
  readonly contractRevision: number;
  readonly contractDigest: string;
  readonly contractStatus: CapabilityDefinitionRecord["contractStatus"];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly idempotencyMode: CapabilityIdempotencyMode;
  readonly supportedInvokers: readonly CapabilityInvoker[];
  readonly declarationRevisionId: string | null;
  readonly declarationRevision: number | null;
  readonly declarationDigest: string | null;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
  readonly bindingCount: number | string;
  readonly activeBindingCount: number | string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface DefinitionLockRow extends RowDataPacket {
  readonly id: string;
  readonly capabilityKey: string;
  readonly lifecycleStatus: CapabilityDefinitionStatus;
  readonly currentContractRevisionId: string;
  readonly currentDeclarationRevisionId: string | null;
  readonly version: number;
}

interface RevisionIdentityRow extends RowDataPacket {
  readonly requestHash: string;
  readonly definitionId: string;
}

interface AgentCapabilityPresentationRow extends RowDataPacket {
  readonly contractRevisionId: string;
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
}

const definitionSelect = `SELECT
  definition.id,
  definition.workspace_id AS workspaceId,
  definition.capability_key AS capabilityKey,
  definition.lifecycle_status AS definitionStatus,
  definition.version,
  contract.id AS contractRevisionId,
  contract.revision AS contractRevision,
  contract.canonical_digest AS contractDigest,
  contract.lifecycle_status AS contractStatus,
  contract.input_schema AS inputSchema,
  contract.output_schema AS outputSchema,
  contract.idempotency_mode AS idempotencyMode,
  contract.supported_invokers AS supportedInvokers,
  declaration.id AS declarationRevisionId,
  declaration.revision AS declarationRevision,
  declaration.canonical_digest AS declarationDigest,
  declaration.declaration,
  (
    SELECT COUNT(*)
    FROM capability_binding AS binding
    WHERE binding.workspace_id = definition.workspace_id
      AND binding.contract_revision_id = contract.id
      AND binding.lifecycle_status <> 'revoked'
  ) AS bindingCount,
  (
    SELECT COUNT(*)
    FROM capability_binding AS binding
    WHERE binding.workspace_id = definition.workspace_id
      AND binding.contract_revision_id = contract.id
      AND binding.lifecycle_status = 'active'
  ) AS activeBindingCount,
  definition.created_at AS createdAt,
  definition.updated_at AS updatedAt
FROM capability_definition AS definition
INNER JOIN capability_contract_revision AS contract
  ON contract.workspace_id = definition.workspace_id
 AND contract.id = definition.current_contract_revision_id
INNER JOIN capability_declaration_revision AS declaration
  ON declaration.workspace_id = definition.workspace_id
 AND declaration.capability_definition_id = definition.id
 AND declaration.id = definition.current_declaration_revision_id`;

function recordFrom(row: DefinitionRow): CapabilityDefinitionRecord {
  if (
    !row.declarationRevisionId ||
    row.declarationRevision === null ||
    !row.declarationDigest ||
    !row.declaration
  ) {
    throw new Error("Capability Definition has no published Declaration.");
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.capabilityKey,
    status: row.definitionStatus,
    version: row.version,
    contractRevisionId: row.contractRevisionId,
    contractRevision: row.contractRevision,
    contractDigest: row.contractDigest,
    contractStatus: row.contractStatus,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    idempotencyMode: row.idempotencyMode,
    supportedInvokers: Object.freeze([...row.supportedInvokers]),
    declarationRevisionId: row.declarationRevisionId,
    declarationRevision: row.declarationRevision,
    declarationDigest: row.declarationDigest,
    declaration: row.declaration,
    bindingCount: Number(row.bindingCount),
    activeBindingCount: Number(row.activeBindingCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function inTransaction<TResult>(
  pool: Pool,
  callback: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function loadRecord(
  connection: PoolConnection,
  workspaceId: string,
  definitionId: string,
): Promise<CapabilityDefinitionRecord> {
  const [rows] = await connection.execute<DefinitionRow[]>(
    `${definitionSelect}
     WHERE definition.workspace_id = ?
       AND definition.id = ?
     LIMIT 1`,
    [workspaceId, definitionId],
  );
  const row = rows[0];
  if (!row) {
    throw new CapabilityDefinitionAdminStoreError(
      "capability_definition.not_found",
      "Capability was not found.",
    );
  }
  return recordFrom(row);
}

async function lockDefinition(
  connection: PoolConnection,
  workspaceId: string,
  definitionId: string,
): Promise<DefinitionLockRow> {
  const [rows] = await connection.execute<DefinitionLockRow[]>(
    `SELECT
       id,
       capability_key AS capabilityKey,
       lifecycle_status AS lifecycleStatus,
       current_contract_revision_id AS currentContractRevisionId,
       current_declaration_revision_id AS currentDeclarationRevisionId,
       version
     FROM capability_definition
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, definitionId],
  );
  const row = rows[0];
  if (!row) {
    throw new CapabilityDefinitionAdminStoreError(
      "capability_definition.not_found",
      "Capability was not found.",
    );
  }
  return row;
}

async function appendAudit(
  connection: PoolConnection,
  options: CapabilityDefinitionCommand,
  event: {
    readonly definitionId: string;
    readonly action: string;
    readonly reasonCode: string;
    readonly details: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, options.audit, {
    organizationId: options.scope.organizationId,
    workspaceId: options.scope.workspaceId,
    eventType: event.action,
    action: event.action,
    resourceType: "capability_definition",
    resourceId: event.definitionId,
    outcome: "succeeded",
    decisionReasonCode: event.reasonCode,
    severity: "info",
    authorizationDecision: Object.freeze({
      permission: "capability.configure",
      authorityVersion: options.scope.authorityVersion,
    }),
    details: event.details,
    occurredAt: options.now,
  });
}

function duplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

export async function createCapabilityDefinitionInTransaction(
  connection: PoolConnection,
  options: CreateCapabilityDefinitionOptions,
  authorize = true,
): Promise<CapabilityDefinitionMutation> {
  if (authorize) {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.scope,
      "capability.configure",
      options.now,
    );
  }
  const [replays] = await connection.execute<
    (RevisionIdentityRow & RowDataPacket)[]
  >(
    `SELECT
       id AS definitionId,
       create_request_hash AS requestHash
     FROM capability_definition
     WHERE workspace_id = ?
       AND create_request_key = ?
     LIMIT 1`,
    [options.scope.workspaceId, options.idempotencyKey],
  );
  const replay = replays[0];
  if (replay) {
    if (replay.requestHash !== options.requestHash) {
      throw new CapabilityDefinitionAdminStoreError(
        "capability_definition.idempotency_conflict",
        "Idempotency key was already used for a different Capability request.",
      );
    }
    return Object.freeze({
      value: await loadRecord(
        connection,
        options.scope.workspaceId,
        replay.definitionId,
      ),
      replayed: true,
    });
  }
  try {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO capability_contract_revision (
         id, workspace_id, contract_key, revision, lifecycle_status,
         canonical_digest, input_schema, output_schema,
         idempotency_mode, supported_invokers, created_at, published_at
       ) VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.contractRevisionId,
        options.scope.workspaceId,
        options.key,
        options.contractDigest,
        JSON.stringify(options.inputSchema),
        JSON.stringify(options.outputSchema),
        options.idempotencyMode,
        JSON.stringify(options.supportedInvokers),
        options.now,
        options.now,
      ],
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO capability_definition (
         id, workspace_id, capability_key, lifecycle_status,
         current_contract_revision_id, current_declaration_revision_id,
         create_request_key, create_request_hash, version,
         created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, 1, ?, ?, NULL)`,
      [
        options.definitionId,
        options.scope.workspaceId,
        options.key,
        options.contractRevisionId,
        options.idempotencyKey,
        options.requestHash,
        options.now,
        options.now,
      ],
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO capability_declaration_revision (
         id, workspace_id, capability_definition_id,
         contract_revision_id, revision, lifecycle_status,
         schema_version, canonical_digest, declaration,
         publication_request_key, publication_request_hash,
         created_at, published_at
       ) VALUES (?, ?, ?, ?, 1, 'published', 1, ?, ?, ?, ?, ?, ?)`,
      [
        options.declarationRevisionId,
        options.scope.workspaceId,
        options.definitionId,
        options.contractRevisionId,
        options.declarationDigest,
        JSON.stringify(options.declaration),
        options.idempotencyKey,
        options.requestHash,
        options.now,
        options.now,
      ],
    );
    await connection.execute<ResultSetHeader>(
      `UPDATE capability_definition
       SET current_declaration_revision_id = ?
       WHERE workspace_id = ? AND id = ?`,
      [
        options.declarationRevisionId,
        options.scope.workspaceId,
        options.definitionId,
      ],
    );
  } catch (error) {
    if (duplicateEntry(error)) {
      throw new CapabilityDefinitionAdminStoreError(
        "capability_definition.key_conflict",
        "Capability key already exists.",
      );
    }
    throw error;
  }
  await appendAudit(connection, options, {
    definitionId: options.definitionId,
    action: "capability_definition.created",
    reasonCode: "capability_definition.created",
    details: Object.freeze({
      capabilityKey: options.key,
      contractRevision: 1,
      declarationRevision: 1,
    }),
  });
  return Object.freeze({
    value: await loadRecord(
      connection,
      options.scope.workspaceId,
      options.definitionId,
    ),
    replayed: false,
  });
}

export function createCapabilityDefinitionAdminStore(
  pool: Pool,
  options: { readonly providerDeploymentHardBounds?: unknown } = {},
): CapabilityDefinitionAdminStore {
  const projector = createEffectiveInvocationSchemaProjector(options);
  async function assess(
    connection: PoolConnection,
    definition: CapabilityDefinitionRecord,
    now: Date,
  ): Promise<AgentCapabilityAssessment> {
    const capability: AgentCapabilityCatalogRecord = {
      key: definition.key,
      contractRevisionId: definition.contractRevisionId,
      contractRevision: definition.contractRevision,
      declaration: definition.declaration,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      activeBindingCount: 0,
    };
    const unavailable = (
      stage: AgentCapabilityAvailability["stage"],
      reason: string,
    ): AgentCapabilityAssessment => ({
      capability,
      availability: { status: "unavailable", stage, reason },
    });
    if (
      definition.status !== "active" ||
      definition.contractStatus !== "published"
    )
      return unavailable("eligibility", "contract_unavailable");
    if (
      !definition.supportedInvokers.includes("agent") ||
      !definition.declaration.catalog.surfaces?.includes("agent")
    )
      return unavailable("eligibility", "agent_not_exposed");
    const binding = await capabilityBindingReadinessInTransaction(
      connection,
      definition.workspaceId,
      definition.contractRevisionId,
      now,
    );
    if (binding.readyCount === 0)
      return unavailable("binding", binding.reason ?? "binding_unavailable");
    if (!definition.inputSchema["x-kanvas-provider-model-operation"])
      return {
        capability: { ...capability, activeBindingCount: binding.readyCount },
        availability: { status: "ready", stage: "invocation" },
      };
    let effective;
    try {
      effective = await projector.projectCapabilityInTransaction(connection, {
        workspaceId: definition.workspaceId,
        contractId: definition.key,
        revision: definition.contractRevision,
        canonicalDigest: definition.contractDigest,
        inputSchema: definition.inputSchema,
        now,
      });
    } catch {
      return {
        capability,
        availability: {
          status: "unknown",
          stage: "invocation",
          reason: "evaluation_failed",
        },
      };
    }
    if (effective.availability !== "available")
      return unavailable("invocation", effective.reason);
    const properties = {
      ...(definition.inputSchema.properties as Record<string, unknown>),
    };
    const required = new Set(
      Array.isArray(definition.inputSchema.required)
        ? (definition.inputSchema.required as string[])
        : [],
    );
    for (const key of effective.controlledParameterKeys) {
      const field = effective.fields.find((field) => field.key === key);
      if (!field) {
        delete properties[key];
        required.delete(key);
        continue;
      }
      const original = properties[key] as Record<string, unknown>;
      properties[key] = {
        ...original,
        ...(field.valueType === "enum" ? { enum: field.values } : {}),
        ...(field.valueType === "integer"
          ? {
              minimum: field.minimum,
              maximum: field.maximum,
              ...(field.step ? { multipleOf: field.step } : {}),
            }
          : {}),
        ...(field.valueType === "string" ? { maxLength: field.maxLength } : {}),
        ...(field.valueType === "boolean" && field.allowedValues
          ? { enum: field.allowedValues }
          : {}),
      };
      if (field.required) required.add(key);
    }
    return {
      capability: {
        ...capability,
        activeBindingCount: binding.readyCount,
        inputSchema: {
          ...definition.inputSchema,
          properties,
          required: [...required],
        },
      },
      availability: { status: "ready", stage: "invocation" },
    };
  }
  async function discover(
    scope: TrustedWorkspaceScope,
    input: {
      readonly query?: string;
      readonly afterKey?: string;
      readonly limit?: number;
    },
    now: Date,
  ): Promise<AgentCapabilityDiscovery> {
    return inTransaction(pool, async (connection) => {
      await revalidateTrustedWorkspaceScopeInTransaction(
        connection,
        scope,
        "capability.run",
        now,
      );
      const limit = Number.isSafeInteger(input.limit ?? 20)
        ? Math.min(50, Math.max(1, input.limit ?? 20))
        : 20;
      const query = input.query?.trim().toLowerCase() ?? "";
      const [rows] = await connection.execute<DefinitionRow[]>(
        `${definitionSelect} WHERE definition.workspace_id = ? AND definition.lifecycle_status = 'active'
         AND JSON_CONTAINS(contract.supported_invokers, JSON_QUOTE('agent')) = 1
         AND JSON_CONTAINS(JSON_EXTRACT(declaration.declaration, '$.catalog.surfaces'), JSON_QUOTE('agent')) = 1
         AND definition.capability_key > ?
         AND (? = '' OR INSTR(LOWER(CONCAT_WS(' ', CONVERT(definition.capability_key USING utf8mb4) COLLATE utf8mb4_bin,
           JSON_UNQUOTE(JSON_EXTRACT(declaration.declaration, '$.catalog.title')),
           JSON_UNQUOTE(JSON_EXTRACT(declaration.declaration, '$.catalog.description')),
           JSON_UNQUOTE(JSON_EXTRACT(declaration.declaration, '$.catalog.tags')))), ?) > 0)
         ORDER BY definition.capability_key ASC LIMIT ${String(limit + 1)}`,
        [scope.workspaceId, input.afterKey ?? "", query, query],
      );
      const selected = rows.slice(0, limit);
      const items: AgentCapabilityAssessment[] = [];
      for (const row of selected)
        items.push(await assess(connection, recordFrom(row), now));
      return {
        items,
        complete: rows.length <= limit,
        ...(rows.length > limit
          ? { nextCursor: selected.at(-1)!.capabilityKey }
          : {}),
        evaluatedAt: now.toISOString(),
      };
    });
  }
  return Object.freeze<CapabilityDefinitionAdminStore>({
    async list(scope: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<DefinitionRow[]>(
          `${definitionSelect}
           WHERE definition.workspace_id = ?
           ORDER BY definition.updated_at DESC, definition.id ASC
           LIMIT 500`,
          [scope.workspaceId],
        );
        const records: CapabilityDefinitionRecord[] = [];
        for (const row of rows) {
          const definition = recordFrom(row);
          const assessment = await assess(connection, definition, now);
          records.push({
            ...definition,
            agentAvailability: assessment.availability,
          });
        }
        return Object.freeze(records);
      });
    },

    async discoverAgentCatalog(scope, input, now) {
      return discover(scope, input, now);
    },
    async resolveAgentCapability(scope, key, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<DefinitionRow[]>(
          `${definitionSelect} WHERE definition.workspace_id = ? AND definition.capability_key = ? LIMIT 1`,
          [scope.workspaceId, key],
        );
        return rows[0]
          ? assess(connection, recordFrom(rows[0]), now)
          : undefined;
      });
    },
    async searchAgentCatalog(scope, query, limit, now) {
      const result = await discover(
        scope,
        { ...(query ? { query } : {}), limit },
        now,
      );
      return result.items
        .filter((item) => item.availability.status === "ready")
        .map((item) => item.capability);
    },

    async resolveAgentCatalogPresentations(
      scope: TrustedWorkspaceScope,
      contractRevisionIds: readonly string[],
      now: Date,
    ) {
      const ids = [...new Set(contractRevisionIds)].slice(0, 200);
      if (ids.length === 0) return Object.freeze([]);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<
          AgentCapabilityPresentationRow[]
        >(
          `SELECT
             requested_contract.id AS contractRevisionId,
             declaration.declaration
           FROM capability_contract_revision AS requested_contract
           INNER JOIN capability_declaration_revision AS requested_declaration
             ON requested_declaration.workspace_id = requested_contract.workspace_id
            AND requested_declaration.contract_revision_id = requested_contract.id
           INNER JOIN capability_definition AS definition
             ON definition.workspace_id = requested_declaration.workspace_id
            AND definition.id = requested_declaration.capability_definition_id
           INNER JOIN capability_contract_revision AS contract
             ON contract.workspace_id = definition.workspace_id
            AND contract.id = definition.current_contract_revision_id
           INNER JOIN capability_declaration_revision AS declaration
             ON declaration.workspace_id = definition.workspace_id
            AND declaration.capability_definition_id = definition.id
            AND declaration.id = definition.current_declaration_revision_id
           WHERE definition.workspace_id = ?
             AND definition.lifecycle_status = 'active'
             AND contract.lifecycle_status IN ('published', 'deprecated')
             AND JSON_CONTAINS(
               contract.supported_invokers,
               JSON_QUOTE('agent')
             ) = 1
             AND JSON_CONTAINS(
               JSON_EXTRACT(declaration.declaration, '$.catalog.surfaces'),
               JSON_QUOTE('agent')
             ) = 1
             AND ${availableCapabilityBindingCountSql} > 0
             AND requested_contract.id IN (${ids.map(() => "?").join(", ")})
           ORDER BY definition.capability_key ASC,
                    requested_contract.id ASC,
                    requested_declaration.revision ASC`,
          [scope.workspaceId, now, now, ...ids],
        );
        return Object.freeze([
          ...new Map(
            rows.map((row) => [
              row.contractRevisionId,
              Object.freeze({
                contractRevisionId: row.contractRevisionId,
                declaration: row.declaration,
              }),
            ]),
          ).values(),
        ]);
      });
    },

    create(options: CreateCapabilityDefinitionOptions) {
      return inTransaction(pool, (connection) =>
        createCapabilityDefinitionInTransaction(connection, options),
      );
    },

    createWithImplementation(definition, implementation) {
      return inTransaction(pool, async (connection) => {
        const definitionResult = await createCapabilityDefinitionInTransaction(
          connection,
          definition,
        );
        const implementationResult =
          await publishCapabilityImplementationRevisionInTransaction(
            connection,
            implementation,
            false,
          );
        return Object.freeze({
          definition: definitionResult,
          implementation: implementationResult,
        });
      });
    },

    async update(options: UpdateCapabilityDefinitionOptions) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const requestHash = digestProviderValue({
          schemaVersion: 1,
          command: "capability_metadata_update",
          definitionId: options.definitionId,
          expectedVersion: options.expectedVersion,
          title: options.title,
          description: options.description ?? null,
          category: options.category,
          tags: options.tags,
        });
        const [replays] = await connection.execute<
          (RevisionIdentityRow & RowDataPacket)[]
        >(
          `SELECT
             capability_definition_id AS definitionId,
             publication_request_hash AS requestHash
           FROM capability_declaration_revision
           WHERE workspace_id = ?
             AND publication_request_key = ?
           LIMIT 1`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = replays[0];
        if (replay) {
          if (
            replay.definitionId !== options.definitionId ||
            replay.requestHash !== requestHash
          ) {
            throw new CapabilityDefinitionAdminStoreError(
              "capability_definition.idempotency_conflict",
              "Idempotency key was already used for a different Capability request.",
            );
          }
          return Object.freeze({
            value: await loadRecord(
              connection,
              options.scope.workspaceId,
              options.definitionId,
            ),
            replayed: true,
          });
        }
        const definition = await lockDefinition(
          connection,
          options.scope.workspaceId,
          options.definitionId,
        );
        if (definition.version !== options.expectedVersion) {
          throw new CapabilityDefinitionAdminStoreError(
            "capability_definition.version_conflict",
            "Capability changed before this update was saved.",
          );
        }
        if (definition.lifecycleStatus !== "active") {
          throw new CapabilityDefinitionAdminStoreError(
            "capability_definition.lifecycle_conflict",
            "Archived Capability must be restored before it can be edited.",
          );
        }
        const current = await loadRecord(
          connection,
          options.scope.workspaceId,
          options.definitionId,
        );
        const declaration: WorkflowCapabilityAuthoringDeclaration =
          Object.freeze({
            ...current.declaration,
            catalog: Object.freeze({
              title: options.title,
              ...(options.description
                ? { description: options.description }
                : {}),
              category: options.category,
              sourceKind: current.declaration.catalog.sourceKind,
              tags: [...options.tags],
              ...(current.declaration.catalog.surfaces
                ? { surfaces: [...current.declaration.catalog.surfaces] }
                : {}),
            }),
            parameters: current.declaration.parameters.map((item) => ({
              ...item,
            })),
            outputs: current.declaration.outputs.map((item) => ({ ...item })),
            ...(current.declaration.canvas
              ? { canvas: current.declaration.canvas }
              : {}),
            ...(current.declaration.uiProfileKey
              ? { uiProfileKey: current.declaration.uiProfileKey }
              : {}),
          });
        const declarationDigest = digestProviderValue(
          Object.freeze({
            contractDigest: current.contractDigest,
            declaration,
          }),
        );
        const nextDeclarationRevision = (current.declarationRevision ?? 0) + 1;
        try {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO capability_declaration_revision (
               id, workspace_id, capability_definition_id,
               contract_revision_id, revision, lifecycle_status,
               schema_version, canonical_digest, declaration,
               publication_request_key, publication_request_hash,
               created_at, published_at
             ) VALUES (?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?, ?, ?)`,
            [
              options.declarationRevisionId,
              options.scope.workspaceId,
              options.definitionId,
              current.contractRevisionId,
              nextDeclarationRevision,
              declarationDigest,
              JSON.stringify(declaration),
              options.idempotencyKey,
              requestHash,
              options.now,
              options.now,
            ],
          );
          if (definition.currentDeclarationRevisionId) {
            await connection.execute<ResultSetHeader>(
              `UPDATE capability_declaration_revision
               SET lifecycle_status = 'deprecated'
               WHERE workspace_id = ?
                 AND id = ?
                 AND lifecycle_status = 'published'`,
              [
                options.scope.workspaceId,
                definition.currentDeclarationRevisionId,
              ],
            );
          }
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE capability_definition
             SET current_declaration_revision_id = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?`,
            [
              options.declarationRevisionId,
              options.now,
              options.scope.workspaceId,
              options.definitionId,
              options.expectedVersion,
            ],
          );
          if (updated.affectedRows !== 1) {
            throw new CapabilityDefinitionAdminStoreError(
              "capability_definition.version_conflict",
              "Capability changed before this update was saved.",
            );
          }
        } catch (error) {
          if (duplicateEntry(error)) {
            throw new CapabilityDefinitionAdminStoreError(
              "capability_definition.idempotency_conflict",
              "Capability metadata could not be published because its identity already exists.",
            );
          }
          throw error;
        }
        await appendAudit(connection, options, {
          definitionId: options.definitionId,
          action: "capability_definition.metadata_updated",
          reasonCode: "capability_definition.metadata_updated",
          details: Object.freeze({
            capabilityKey: current.key,
            contractRevision: current.contractRevision,
            declarationRevision: nextDeclarationRevision,
          }),
        });
        return Object.freeze({
          value: await loadRecord(
            connection,
            options.scope.workspaceId,
            options.definitionId,
          ),
          replayed: false,
        });
      });
    },
    async setStatus(options: SetCapabilityDefinitionStatusOptions) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const definition = await lockDefinition(
          connection,
          options.scope.workspaceId,
          options.definitionId,
        );
        if (definition.version !== options.expectedVersion) {
          throw new CapabilityDefinitionAdminStoreError(
            "capability_definition.version_conflict",
            "Capability changed before its status was updated.",
          );
        }
        if (definition.lifecycleStatus === options.status) {
          return Object.freeze({
            value: await loadRecord(
              connection,
              options.scope.workspaceId,
              options.definitionId,
            ),
            replayed: true,
          });
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_definition
           SET lifecycle_status = ?,
               version = version + 1,
               updated_at = ?,
               archived_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            options.status,
            options.now,
            options.status === "archived" ? options.now : null,
            options.scope.workspaceId,
            options.definitionId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new CapabilityDefinitionAdminStoreError(
            "capability_definition.version_conflict",
            "Capability changed before its status was updated.",
          );
        }
        await appendAudit(connection, options, {
          definitionId: options.definitionId,
          action:
            options.status === "archived"
              ? "capability_definition.archived"
              : "capability_definition.restored",
          reasonCode:
            options.status === "archived"
              ? "capability_definition.archived"
              : "capability_definition.restored",
          details: Object.freeze({
            capabilityKey: definition.capabilityKey,
            status: options.status,
          }),
        });
        return Object.freeze({
          value: await loadRecord(
            connection,
            options.scope.workspaceId,
            options.definitionId,
          ),
          replayed: false,
        });
      });
    },
  });
}
