import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ModelResourceManifest } from "@kanvas/contracts/api";
import type {
  ModelResourceCatalogAssetV1,
  RuntimeAdapterDefinitionRevision,
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

export interface ModelResourceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly displayName: string;
  readonly description?: string;
  readonly status: "active" | "archived";
  readonly version: number;
  readonly revisionId: string;
  readonly revision: number;
  readonly revisionDigest: string;
  readonly manifest: ModelResourceManifest;
  readonly implementationCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ModelResourceCommand {
  readonly scope: TrustedWorkspaceScope;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface SetModelResourceStatusOptions extends ModelResourceCommand {
  readonly resourceId: string;
  readonly expectedVersion: number;
  readonly status: "active" | "archived";
}

export interface ModelResourceMutation {
  readonly value: ModelResourceRecord;
  readonly replayed: boolean;
}

export interface BrowserModelRuntimeCandidate {
  readonly capabilityKey: string;
  readonly bindingPriority: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly sourceKind: string;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapter: RuntimeAdapterDefinitionRevision;
  readonly implementationConfiguration: Readonly<Record<string, unknown>>;
  readonly modelResourceRevisionId?: string;
  readonly modelResourceRevisionDigest?: string;
  readonly manifest?: ModelResourceManifest;
  readonly storage?: ModelResourceStorageObject;
}

export interface ModelResourceStorageObject {
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly storageVersionId?: string;
  readonly immutableIdentityHash: string;
  readonly byteSize: string;
  readonly sha256: string;
}

export interface ModelResourceCatalogEntryRecord {
  readonly id: string;
  readonly assetKey: string;
  readonly canonicalDigest: string;
  readonly document: ModelResourceCatalogAssetV1;
}

export interface ModelResourceAdminStore {
  list(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ModelResourceRecord[]>;
  setStatus(
    options: SetModelResourceStatusOptions,
  ): Promise<ModelResourceMutation>;
  listCatalogEntries(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ModelResourceCatalogEntryRecord[]>;
  getCatalogEntry(
    scope: TrustedWorkspaceScope,
    catalogEntryId: string,
    now: Date,
  ): Promise<ModelResourceCatalogEntryRecord | undefined>;
  listBrowserRuntimeCandidates(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly BrowserModelRuntimeCandidate[]>;
  getBrowserRuntimeCandidate(
    scope: TrustedWorkspaceScope,
    modelResourceRevisionId: string,
    now: Date,
  ): Promise<BrowserModelRuntimeCandidate | undefined>;
}

export type ModelResourceAdminStoreErrorCode =
  | "model_resource.not_found"
  | "model_resource.version_conflict"
  | "model_resource.lifecycle_conflict";

export class ModelResourceAdminStoreError extends Error {
  public constructor(
    public readonly code: ModelResourceAdminStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelResourceAdminStoreError";
  }
}

interface ResourceRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly resourceKey: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly resourceStatus: "active" | "archived";
  readonly version: number;
  readonly revisionId: string;
  readonly revision: number;
  readonly revisionDigest: string;
  readonly manifest: ModelResourceManifest;
  readonly implementationCount: number | string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ResourceLockRow extends RowDataPacket {
  readonly id: string;
  readonly resourceKey: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly currentRevisionId: string;
  readonly version: number;
}

interface BrowserRuntimeRow extends RowDataPacket {
  readonly capabilityKey: string;
  readonly bindingPriority: number;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly sourceKind: string;
  readonly runtimeAdapterRevisionId: string;
  readonly runtimeAdapterRevisionDigest: string;
  readonly runtimeAdapter: RuntimeAdapterDefinitionRevision;
  readonly implementationConfiguration: Readonly<Record<string, unknown>>;
  readonly modelResourceRevisionId: string | null;
  readonly modelResourceRevisionDigest: string | null;
  readonly manifest: ModelResourceManifest | null;
  readonly storageProfileId: string | null;
  readonly container: string | null;
  readonly objectKey: string | null;
  readonly storageVersionId: string | null;
  readonly immutableIdentityHash: string | null;
  readonly byteSize: string | null;
  readonly sha256: string | null;
}

interface CatalogEntryRow extends RowDataPacket {
  readonly id: string;
  readonly assetKey: string;
  readonly canonicalDigest: string;
  readonly document: ModelResourceCatalogAssetV1;
}

function catalogEntryFrom(
  row: CatalogEntryRow,
): ModelResourceCatalogEntryRecord {
  return Object.freeze({
    id: row.id,
    assetKey: row.assetKey,
    canonicalDigest: row.canonicalDigest,
    document: row.document,
  });
}

const browserRuntimeSelect = `SELECT
  contract.contract_key AS capabilityKey,
  binding.priority AS bindingPriority,
  implementation.id AS implementationRevisionId,
  implementation.canonical_digest AS implementationDigest,
  implementation.adapter_key AS adapterKey,
  implementation.source_kind AS sourceKind,
  runtime_adapter.id AS runtimeAdapterRevisionId,
  runtime_adapter.canonical_digest AS runtimeAdapterRevisionDigest,
  runtime_adapter.document AS runtimeAdapter,
  implementation.configuration AS implementationConfiguration,
  revision.id AS modelResourceRevisionId,
  revision.canonical_digest AS modelResourceRevisionDigest,
  revision.manifest,
  stored_record.storage_profile_id AS storageProfileId,
  stored_record.container,
  stored_record.object_key AS objectKey,
  stored_record.storage_version_id AS storageVersionId,
  stored_record.immutable_identity_hash AS immutableIdentityHash,
  stored_record.byte_size AS byteSize,
  stored_record.sha256
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
 AND runtime_adapter.lifecycle_status IN ('published', 'deprecated')
INNER JOIN runtime_adapter_definition AS runtime_adapter_definition
  ON runtime_adapter_definition.workspace_id = runtime_adapter.workspace_id
 AND runtime_adapter_definition.id = runtime_adapter.runtime_adapter_definition_id
 AND runtime_adapter_definition.lifecycle_status = 'active'
LEFT JOIN capability_implementation_model_resource AS reference
  ON reference.workspace_id = implementation.workspace_id
 AND reference.implementation_revision_id = implementation.id
 AND reference.resource_role = 'primary'
LEFT JOIN model_resource_revision AS revision
  ON revision.workspace_id = reference.workspace_id
 AND revision.id = reference.model_resource_revision_id
 AND revision.lifecycle_status IN ('published', 'deprecated')
LEFT JOIN model_resource_revision_file AS revision_file
  ON revision_file.workspace_id = revision.workspace_id
 AND revision_file.model_resource_revision_id = revision.id
 AND revision_file.role = 'primary'
LEFT JOIN stored_object AS stored_record
  ON stored_record.workspace_id = revision_file.workspace_id
 AND stored_record.id = revision_file.stored_object_id
 AND stored_record.delete_state = 'active'
WHERE binding.workspace_id = ?
  AND binding.lifecycle_status = 'active'
  AND contract.lifecycle_status IN ('published', 'deprecated')
  AND implementation.lifecycle_status = 'published'
  AND implementation.execution_target = 'browser'`;

function browserRuntimeCandidate(
  row: BrowserRuntimeRow,
): BrowserModelRuntimeCandidate {
  const modelValues = [
    row.modelResourceRevisionId,
    row.modelResourceRevisionDigest,
    row.manifest,
    row.storageProfileId,
    row.container,
    row.objectKey,
    row.immutableIdentityHash,
    row.byteSize,
    row.sha256,
  ];
  const hasModel = modelValues.every((value) => value !== null);
  if (
    (row.sourceKind === "model_resource" && !hasModel) ||
    (row.sourceKind !== "model_resource" &&
      modelValues.some((value) => value !== null))
  ) {
    throw new Error("Browser Runtime Adapter model identity is incomplete.");
  }
  return Object.freeze({
    capabilityKey: row.capabilityKey,
    bindingPriority: row.bindingPriority,
    implementationRevisionId: row.implementationRevisionId,
    implementationDigest: row.implementationDigest,
    adapterKey: row.adapterKey,
    sourceKind: row.sourceKind,
    runtimeAdapterRevisionId: row.runtimeAdapterRevisionId,
    runtimeAdapterRevisionDigest: row.runtimeAdapterRevisionDigest,
    runtimeAdapter: row.runtimeAdapter,
    implementationConfiguration: row.implementationConfiguration,
    ...(hasModel
      ? {
          modelResourceRevisionId: row.modelResourceRevisionId!,
          modelResourceRevisionDigest: row.modelResourceRevisionDigest!,
          manifest: row.manifest!,
          storage: Object.freeze({
            storageProfileId: row.storageProfileId!,
            container: row.container!,
            objectKey: row.objectKey!,
            ...(row.storageVersionId
              ? { storageVersionId: row.storageVersionId }
              : {}),
            immutableIdentityHash: row.immutableIdentityHash!,
            byteSize: row.byteSize!,
            sha256: row.sha256!,
          }),
        }
      : {}),
  });
}

const resourceSelect = `SELECT
  resource.id,
  resource.workspace_id AS workspaceId,
  resource.resource_key AS resourceKey,
  revision.display_name AS displayName,
  revision.description,
  resource.lifecycle_status AS resourceStatus,
  resource.version,
  revision.id AS revisionId,
  revision.revision,
  revision.canonical_digest AS revisionDigest,
  revision.manifest,
  (
    SELECT COUNT(*)
    FROM capability_implementation_model_resource AS reference
    WHERE reference.workspace_id = resource.workspace_id
      AND reference.model_resource_revision_id IN (
        SELECT referenced_revision.id
        FROM model_resource_revision AS referenced_revision
        WHERE referenced_revision.workspace_id = resource.workspace_id
          AND referenced_revision.model_resource_id = resource.id
      )
  ) AS implementationCount,
  resource.created_at AS createdAt,
  resource.updated_at AS updatedAt
FROM model_resource AS resource
INNER JOIN model_resource_revision AS revision
  ON revision.workspace_id = resource.workspace_id
 AND revision.model_resource_id = resource.id
 AND revision.id = resource.current_revision_id`;

function recordFrom(row: ResourceRow): ModelResourceRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.resourceKey,
    displayName: row.displayName,
    ...(row.description ? { description: row.description } : {}),
    status: row.resourceStatus,
    version: row.version,
    revisionId: row.revisionId,
    revision: row.revision,
    revisionDigest: row.revisionDigest,
    manifest: row.manifest,
    implementationCount: Number(row.implementationCount),
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
  resourceId: string,
): Promise<ModelResourceRecord> {
  const [rows] = await connection.execute<ResourceRow[]>(
    `${resourceSelect}
     WHERE resource.workspace_id = ?
       AND resource.id = ?
     LIMIT 1`,
    [workspaceId, resourceId],
  );
  const row = rows[0];
  if (!row) {
    throw new ModelResourceAdminStoreError(
      "model_resource.not_found",
      "Model resource was not found.",
    );
  }
  return recordFrom(row);
}

async function lockResource(
  connection: PoolConnection,
  workspaceId: string,
  resourceId: string,
): Promise<ResourceLockRow> {
  const [rows] = await connection.execute<ResourceLockRow[]>(
    `SELECT
       id,
       resource_key AS resourceKey,
       lifecycle_status AS lifecycleStatus,
       current_revision_id AS currentRevisionId,
       version
     FROM model_resource
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, resourceId],
  );
  const row = rows[0];
  if (!row) {
    throw new ModelResourceAdminStoreError(
      "model_resource.not_found",
      "Model resource was not found.",
    );
  }
  return row;
}

async function appendAudit(
  connection: PoolConnection,
  options: ModelResourceCommand,
  event: {
    readonly resourceId: string;
    readonly action: string;
    readonly details: Readonly<Record<string, string | number>>;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, options.audit, {
    organizationId: options.scope.organizationId,
    workspaceId: options.scope.workspaceId,
    eventType: event.action,
    action: event.action,
    resourceType: "model_resource",
    resourceId: event.resourceId,
    outcome: "succeeded",
    decisionReasonCode: event.action,
    severity: "info",
    authorizationDecision: Object.freeze({
      permission: "capability.configure",
      authorityVersion: options.scope.authorityVersion,
    }),
    details: event.details,
    occurredAt: options.now,
  });
}

export function createModelResourceAdminStore(
  pool: Pool,
): ModelResourceAdminStore {
  return Object.freeze({
    async listCatalogEntries(scope: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<CatalogEntryRow[]>(
          `SELECT id, asset_key AS assetKey,
                  canonical_digest AS canonicalDigest, document
           FROM model_resource_catalog_entry
           WHERE workspace_id = ? AND lifecycle_status = 'active'
           ORDER BY resource_key, revision DESC, id
           LIMIT 500`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map(catalogEntryFrom));
      });
    },

    async getCatalogEntry(
      scope: TrustedWorkspaceScope,
      catalogEntryId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<CatalogEntryRow[]>(
          `SELECT id, asset_key AS assetKey,
                  canonical_digest AS canonicalDigest, document
           FROM model_resource_catalog_entry
           WHERE workspace_id = ? AND id = ? AND lifecycle_status = 'active'
           LIMIT 1`,
          [scope.workspaceId, catalogEntryId],
        );
        return rows[0] ? catalogEntryFrom(rows[0]) : undefined;
      });
    },

    async listBrowserRuntimeCandidates(
      scope: TrustedWorkspaceScope,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<BrowserRuntimeRow[]>(
          `${browserRuntimeSelect}
           ORDER BY binding.priority ASC, contract.contract_key ASC,
             implementation.id ASC
           LIMIT 64`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map(browserRuntimeCandidate));
      });
    },

    async getBrowserRuntimeCandidate(
      scope: TrustedWorkspaceScope,
      modelResourceRevisionId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.run",
          now,
        );
        const [rows] = await connection.execute<BrowserRuntimeRow[]>(
          `${browserRuntimeSelect}
             AND revision.id = ?
           ORDER BY binding.priority ASC, contract.contract_key ASC,
             implementation.id ASC
           LIMIT 1`,
          [scope.workspaceId, modelResourceRevisionId],
        );
        return rows[0] ? browserRuntimeCandidate(rows[0]) : undefined;
      });
    },

    async list(scope: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "capability.configure",
          now,
        );
        const [rows] = await connection.execute<ResourceRow[]>(
          `${resourceSelect}
           WHERE resource.workspace_id = ?
           ORDER BY resource.updated_at DESC, resource.id ASC
           LIMIT 500`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map(recordFrom));
      });
    },

    async setStatus(options: SetModelResourceStatusOptions) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "capability.configure",
          options.now,
        );
        const resource = await lockResource(
          connection,
          options.scope.workspaceId,
          options.resourceId,
        );
        if (resource.version !== options.expectedVersion) {
          throw new ModelResourceAdminStoreError(
            "model_resource.version_conflict",
            "Model resource changed before its status was updated.",
          );
        }
        if (resource.lifecycleStatus === options.status) {
          return Object.freeze({
            value: await loadRecord(
              connection,
              options.scope.workspaceId,
              options.resourceId,
            ),
            replayed: true,
          });
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE model_resource
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
            options.resourceId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new ModelResourceAdminStoreError(
            "model_resource.version_conflict",
            "Model resource changed before its status was updated.",
          );
        }
        const action =
          options.status === "archived"
            ? "model_resource.archived"
            : "model_resource.restored";
        await appendAudit(connection, options, {
          resourceId: options.resourceId,
          action,
          details: Object.freeze({
            resourceKey: resource.resourceKey,
            status: options.status,
          }),
        });
        return Object.freeze({
          value: await loadRecord(
            connection,
            options.scope.workspaceId,
            options.resourceId,
          ),
          replayed: false,
        });
      });
    },
  });
}
