import {
  DomainError,
  type ArchiveWorkflowDraftPersistenceOptions,
  type CreateWorkflowDraftPersistenceOptions,
  type TrustedWorkspaceScope,
  type UpdateWorkflowDraftPersistenceOptions,
  type WorkflowAuthoringDocument,
  type WorkflowAuthoringCapability,
  type WorkflowAuthoringRepository,
  type WorkflowDefinitionList,
  type WorkflowDefinitionSummary,
  type WorkflowDraftMutationResult,
  type WorkflowDraftView,
} from "@kanvas/application";
import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { availableCapabilityBindingCountSql } from "./capability-binding-availability-query.js";
import { appendControlPlaneAuditEventInTransaction } from "./control-plane-audit.js";
import type { AuditJsonObject } from "./audit-event-store.js";
import { parseWorkflowPublicationDocument } from "./publication-documents.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";

const workflowKeyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;

interface DefinitionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowKey: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly lifecycleStatus: "active" | "archived";
  readonly creationRequestKey: string | null;
  readonly creationRequestHash: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly draftId: string | null;
  readonly draftVersion: number | null;
  readonly draftLifecycleStatus: "active" | "archived" | null;
  readonly draftCanonicalDigest: string | null;
  readonly draftContentDocument: unknown;
  readonly draftDerivedFromWorkflowRevisionId: string | null;
  readonly draftCreatedByPrincipalId: string | null;
  readonly draftUpdatedByPrincipalId: string | null;
  readonly draftCreatedAt: Date | null;
  readonly draftUpdatedAt: Date | null;
  readonly latestRevisionId: string | null;
  readonly latestRevision: number | null;
  readonly latestRevisionLifecycleStatus: string | null;
  readonly latestRevisionRuntimeStatus: string | null;
  readonly latestRevisionPublishedAt: Date | null;
}

interface CapabilityRow extends RowDataPacket {
  readonly contractId: string;
  readonly contractKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly authoring: WorkflowCapabilityAuthoringDeclaration;
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

function invalid(code: string, message: string): never {
  throw new DomainError(code, message);
}

function assertText(value: string, label: string, maximum: number): void {
  if (value.trim().length < 1 || value.length > maximum) {
    invalid(
      "workflow_authoring.invalid_argument",
      `${label} must contain between 1 and ${String(maximum)} characters.`,
    );
  }
}

function assertOptionalText(
  value: string | undefined,
  label: string,
  maximum: number,
): void {
  if (
    value !== undefined &&
    (value.trim().length < 1 || value.length > maximum)
  ) {
    invalid(
      "workflow_authoring.invalid_argument",
      `${label} must be omitted or contain between 1 and ${String(maximum)} characters.`,
    );
  }
}

function parseDocument(value: unknown): WorkflowAuthoringDocument {
  try {
    const parsed = parseWorkflowPublicationDocument(value);
    return Object.freeze({
      schemaVersion: 1,
      topology:
        parsed.topology as unknown as WorkflowAuthoringDocument["topology"],
      inputSchema: parsed.inputSchema,
      outputSchema: parsed.outputSchema,
      ...(parsed.presentation ? { presentation: parsed.presentation } : {}),
    });
  } catch (error) {
    return invalid(
      "workflow_authoring.document_invalid",
      error instanceof Error
        ? error.message
        : "Workflow authoring document is invalid.",
    );
  }
}

function summaryFromRow(row: DefinitionRow): WorkflowDefinitionSummary {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    workflowKey: row.workflowKey,
    displayName: row.displayName,
    ...(row.description ? { description: row.description } : {}),
    ...(row.category ? { category: row.category } : {}),
    lifecycleStatus: row.lifecycleStatus,
    version: row.version,
    ...(row.draftId &&
    row.draftVersion !== null &&
    row.draftLifecycleStatus &&
    row.draftUpdatedAt
      ? {
          draft: Object.freeze({
            id: row.draftId,
            version: row.draftVersion,
            lifecycleStatus: row.draftLifecycleStatus,
            updatedAt: new Date(row.draftUpdatedAt),
          }),
        }
      : {}),
    ...(row.latestRevisionId &&
    row.latestRevision !== null &&
    row.latestRevisionLifecycleStatus
      ? {
          latestRevision: Object.freeze({
            id: row.latestRevisionId,
            revision: row.latestRevision,
            lifecycleStatus: row.latestRevisionLifecycleStatus,
            ...(row.latestRevisionRuntimeStatus
              ? { runtimeStatus: row.latestRevisionRuntimeStatus }
              : {}),
            ...(row.latestRevisionPublishedAt
              ? {
                  publishedAt: new Date(row.latestRevisionPublishedAt),
                }
              : {}),
          }),
        }
      : {}),
    createdByPrincipalId: row.createdByPrincipalId,
    updatedByPrincipalId: row.updatedByPrincipalId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });
}

function detailFromRow(row: DefinitionRow): WorkflowDraftView {
  if (
    !row.draftId ||
    row.draftVersion === null ||
    !row.draftLifecycleStatus ||
    !row.draftCanonicalDigest ||
    !row.draftCreatedByPrincipalId ||
    !row.draftUpdatedByPrincipalId ||
    !row.draftCreatedAt ||
    !row.draftUpdatedAt
  ) {
    return invalid(
      "workflow_authoring.integrity_violation",
      "Workflow Definition does not have a readable Draft.",
    );
  }
  return Object.freeze({
    definition: summaryFromRow(row),
    draft: Object.freeze({
      id: row.draftId,
      version: row.draftVersion,
      lifecycleStatus: row.draftLifecycleStatus,
      canonicalDigest: row.draftCanonicalDigest,
      document: parseDocument(row.draftContentDocument),
      ...(row.draftDerivedFromWorkflowRevisionId
        ? {
            derivedFromWorkflowRevisionId:
              row.draftDerivedFromWorkflowRevisionId,
          }
        : {}),
      createdByPrincipalId: row.draftCreatedByPrincipalId,
      updatedByPrincipalId: row.draftUpdatedByPrincipalId,
      createdAt: new Date(row.draftCreatedAt),
      updatedAt: new Date(row.draftUpdatedAt),
    }),
  });
}

const definitionSelect = `
  SELECT
    definition.id,
    definition.workspace_id AS workspaceId,
    definition.workflow_key AS workflowKey,
    definition.display_name AS displayName,
    definition.description,
    definition.category,
    definition.lifecycle_status AS lifecycleStatus,
    definition.creation_request_key AS creationRequestKey,
    definition.creation_request_hash AS creationRequestHash,
    definition.version,
    definition.created_by_principal_id AS createdByPrincipalId,
    definition.updated_by_principal_id AS updatedByPrincipalId,
    definition.created_at AS createdAt,
    definition.updated_at AS updatedAt,
    draft.id AS draftId,
    draft.version AS draftVersion,
    draft.lifecycle_status AS draftLifecycleStatus,
    draft.canonical_digest AS draftCanonicalDigest,
    draft.content_document AS draftContentDocument,
    draft.derived_from_workflow_revision_id
      AS draftDerivedFromWorkflowRevisionId,
    draft.created_by_principal_id AS draftCreatedByPrincipalId,
    draft.updated_by_principal_id AS draftUpdatedByPrincipalId,
    draft.created_at AS draftCreatedAt,
    draft.updated_at AS draftUpdatedAt,
    revision.id AS latestRevisionId,
    revision.revision AS latestRevision,
    revision.lifecycle_status AS latestRevisionLifecycleStatus,
    activation.runtime_status AS latestRevisionRuntimeStatus,
    revision.published_at AS latestRevisionPublishedAt
  FROM workflow_definition AS definition
  LEFT JOIN workflow_draft AS draft
    ON draft.workspace_id = definition.workspace_id
    AND draft.workflow_definition_id = definition.id
  LEFT JOIN workflow_revision AS revision
    ON revision.workspace_id = definition.workspace_id
    AND revision.workflow_definition_id = definition.id
    AND revision.revision = (
      SELECT MAX(candidate.revision)
      FROM workflow_revision AS candidate
      WHERE candidate.workspace_id = definition.workspace_id
        AND candidate.workflow_definition_id = definition.id
    )
  LEFT JOIN workflow_revision_activation AS activation
    ON activation.workspace_id = revision.workspace_id
    AND activation.workflow_revision_id = revision.id`;

async function readDefinition(
  connection: PoolConnection,
  workspaceId: string,
  definitionId: string,
  lock: boolean,
): Promise<DefinitionRow | undefined> {
  const [rows] = await connection.execute<DefinitionRow[]>(
    `${definitionSelect}
     WHERE definition.workspace_id = ?
       AND definition.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, definitionId],
  );
  return rows[0];
}

async function appendAudit(
  connection: PoolConnection,
  options:
    | CreateWorkflowDraftPersistenceOptions
    | UpdateWorkflowDraftPersistenceOptions
    | ArchiveWorkflowDraftPersistenceOptions,
  action: string,
  reasonCode: string,
  details: AuditJsonObject,
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(
    connection,
    {
      auditEventId: options.audit.auditEventId,
      actorPrincipalId: options.actorPrincipalId,
      actorType: options.authority.principalType,
      authenticationRefType: options.authority.authenticationRefType,
      authenticationRefHash: options.audit.authenticationRefHash,
      authorityType: options.authority.authorityType,
      authorityId: options.authority.authorityId,
      authorityVersion: options.authority.authorityVersion,
      ...(options.audit.requestId !== undefined
        ? { requestId: options.audit.requestId }
        : {}),
      ...(options.audit.traceId !== undefined
        ? { traceId: options.audit.traceId }
        : {}),
    },
    {
      organizationId: options.authority.organizationId,
      workspaceId: options.authority.workspaceId,
      eventType: action,
      action,
      resourceType: "workflow_definition",
      resourceId: options.definitionId,
      outcome: "succeeded",
      decisionReasonCode: reasonCode,
      severity: "info",
      authorizationDecision: Object.freeze({
        permission: "workflow.author",
        authorityVersion: options.authority.authorityVersion,
      }),
      details,
      occurredAt: options.now,
    },
  );
}

export function createWorkflowAuthoringStore(
  pool: Pool,
): WorkflowAuthoringRepository {
  const repository: WorkflowAuthoringRepository = {
    async listCapabilities(
      authority: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly WorkflowAuthoringCapability[]> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "workflow.read",
          now,
        );
        const [rows] = await connection.execute<CapabilityRow[]>(
          `SELECT
             contract.contract_key AS contractId,
             contract.contract_key AS contractKey,
             contract.revision,
             contract.canonical_digest AS canonicalDigest,
             contract.input_schema AS inputSchema,
             contract.output_schema AS outputSchema,
             declaration.declaration AS authoring
           FROM capability_definition AS definition
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
               JSON_QUOTE('workflow')
             ) = 1
             AND JSON_CONTAINS(
               JSON_EXTRACT(declaration.declaration, '$.catalog.surfaces'),
               JSON_QUOTE('workflow')
             ) = 1
             AND ${availableCapabilityBindingCountSql} > 0
           ORDER BY contractKey ASC, revision ASC`,
          [authority.workspaceId, now, now],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              contractId: row.contractId,
              contractKey: row.contractKey,
              revision: row.revision,
              canonicalDigest: row.canonicalDigest,
              inputSchema: row.inputSchema,
              outputSchema: row.outputSchema,
              authoring: row.authoring,
            }),
          ),
        );
      });
    },

    async list(
      authority: TrustedWorkspaceScope,
      options: {
        readonly includeArchived: boolean;
        readonly limit: number;
        readonly now: Date;
      },
    ): Promise<WorkflowDefinitionList> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "workflow.read",
          options.now,
        );
        const [rows] = await connection.execute<DefinitionRow[]>(
          `${definitionSelect}
           WHERE definition.workspace_id = ?
             ${
               options.includeArchived
                 ? ""
                 : "AND definition.lifecycle_status = 'active'"
             }
           ORDER BY definition.updated_at DESC, definition.id DESC
           LIMIT ${String(options.limit + 1)}`,
          [authority.workspaceId],
        );
        return Object.freeze({
          items: Object.freeze(
            rows.slice(0, options.limit).map(summaryFromRow),
          ),
          truncated: rows.length > options.limit,
        });
      });
    },

    async get(
      authority: TrustedWorkspaceScope,
      definitionId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "workflow.read",
          now,
        );
        const row = await readDefinition(
          connection,
          authority.workspaceId,
          definitionId,
          false,
        );
        return row ? detailFromRow(row) : undefined;
      });
    },

    async create(
      options: CreateWorkflowDraftPersistenceOptions,
    ): Promise<WorkflowDraftMutationResult> {
      assertText(options.workflowKey, "workflowKey", 160);
      if (!workflowKeyPattern.test(options.workflowKey)) {
        return invalid(
          "workflow_authoring.invalid_argument",
          "workflowKey must use the stable lowercase key profile.",
        );
      }
      assertText(options.displayName, "displayName", 240);
      assertOptionalText(options.description, "description", 1000);
      assertOptionalText(options.category, "category", 120);
      assertText(options.idempotencyKey, "idempotencyKey", 160);
      const document = parseDocument(options.document);
      const canonicalText = canonicalizeProviderValue(document);
      const canonicalDigest = digestProviderValue(document);
      const requestHash = digestProviderValue({
        workflowKey: options.workflowKey,
        displayName: options.displayName,
        description: options.description ?? null,
        category: options.category ?? null,
        derivedFromWorkflowRevisionId:
          options.derivedFromWorkflowRevisionId ?? null,
        document,
      });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workflow.author",
          options.now,
        );
        const [replayRows] = await connection.execute<DefinitionRow[]>(
          `${definitionSelect}
             WHERE definition.workspace_id = ?
               AND definition.creation_request_key = ?
             LIMIT 1
             FOR UPDATE`,
          [options.authority.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (replay.creationRequestHash !== requestHash) {
            return invalid(
              "workflow_authoring.idempotency_conflict",
              "Idempotency key is already bound to another Workflow request.",
            );
          }
          return Object.freeze({
            value: detailFromRow(replay),
            replayed: true,
          });
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_definition (
             id,
             workspace_id,
             workflow_key,
             display_name,
             description,
             category,
             lifecycle_status,
             creation_request_key,
             creation_request_hash,
             version,
             created_by_principal_id,
             updated_by_principal_id,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?)`,
          [
            options.definitionId,
            options.authority.workspaceId,
            options.workflowKey,
            options.displayName.trim(),
            options.description?.trim() ?? null,
            options.category?.trim() ?? null,
            options.idempotencyKey,
            requestHash,
            options.actorPrincipalId,
            options.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_draft (
             id,
             workspace_id,
             workflow_definition_id,
             workflow_key,
             schema_version,
             content_document,
             canonical_digest,
             lifecycle_status,
             derived_from_workflow_revision_id,
             version,
             created_by_principal_id,
             updated_by_principal_id,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, 1, CAST(? AS JSON), ?, 'active', ?, 1, ?, ?, ?, ?)`,
          [
            options.draftId,
            options.authority.workspaceId,
            options.definitionId,
            options.workflowKey,
            canonicalText,
            canonicalDigest,
            options.derivedFromWorkflowRevisionId ?? null,
            options.actorPrincipalId,
            options.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await appendAudit(
          connection,
          options,
          "workflow.draft.created",
          "workflow.draft_created",
          Object.freeze({
            workflowKey: options.workflowKey,
            draftId: options.draftId,
            canonicalDigest,
          }),
        );
        const created = await readDefinition(
          connection,
          options.authority.workspaceId,
          options.definitionId,
          false,
        );
        if (!created) {
          return invalid(
            "workflow_authoring.integrity_violation",
            "Created Workflow Draft cannot be read back.",
          );
        }
        return Object.freeze({
          value: detailFromRow(created),
          replayed: false,
        });
      });
    },

    async update(
      options: UpdateWorkflowDraftPersistenceOptions,
    ): Promise<WorkflowDraftMutationResult> {
      assertText(options.displayName, "displayName", 240);
      assertOptionalText(options.description, "description", 1000);
      assertOptionalText(options.category, "category", 120);
      const document = parseDocument(options.document);
      const canonicalText = canonicalizeProviderValue(document);
      const canonicalDigest = digestProviderValue(document);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workflow.author",
          options.now,
        );
        const existing = await readDefinition(
          connection,
          options.authority.workspaceId,
          options.definitionId,
          true,
        );
        if (!existing || existing.draftId !== options.draftId) {
          return invalid(
            "workflow_authoring.not_found",
            "Workflow Definition or Draft was not found.",
          );
        }
        if (
          existing.lifecycleStatus !== "active" ||
          existing.draftLifecycleStatus !== "active"
        ) {
          return invalid(
            "workflow_authoring.lifecycle_conflict",
            "Archived Workflow Draft cannot be updated.",
          );
        }
        if (
          existing.version !== options.expectedDefinitionVersion ||
          existing.draftVersion !== options.expectedDraftVersion
        ) {
          return invalid(
            "workflow_authoring.version_conflict",
            "Workflow Definition or Draft changed before this save.",
          );
        }
        const [definitionUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE workflow_definition
             SET display_name = ?,
                 description = ?,
                 category = ?,
                 version = version + 1,
                 updated_by_principal_id = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = 'active'`,
          [
            options.displayName.trim(),
            options.description?.trim() ?? null,
            options.category?.trim() ?? null,
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.definitionId,
            options.expectedDefinitionVersion,
          ],
        );
        const [draftUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE workflow_draft
             SET content_document = CAST(? AS JSON),
                 canonical_digest = ?,
                 version = version + 1,
                 updated_by_principal_id = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND workflow_definition_id = ?
               AND version = ?
               AND lifecycle_status = 'active'`,
          [
            canonicalText,
            canonicalDigest,
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.draftId,
            options.definitionId,
            options.expectedDraftVersion,
          ],
        );
        if (
          definitionUpdate.affectedRows !== 1 ||
          draftUpdate.affectedRows !== 1
        ) {
          return invalid(
            "workflow_authoring.version_conflict",
            "Workflow save lost its compare-and-swap.",
          );
        }
        await appendAudit(
          connection,
          options,
          "workflow.draft.updated",
          "workflow.draft_updated",
          Object.freeze({
            draftId: options.draftId,
            previousDefinitionVersion: options.expectedDefinitionVersion,
            nextDefinitionVersion: options.expectedDefinitionVersion + 1,
            previousDraftVersion: options.expectedDraftVersion,
            nextDraftVersion: options.expectedDraftVersion + 1,
            canonicalDigest,
          }),
        );
        const updated = await readDefinition(
          connection,
          options.authority.workspaceId,
          options.definitionId,
          false,
        );
        if (!updated) {
          return invalid(
            "workflow_authoring.integrity_violation",
            "Updated Workflow Draft cannot be read back.",
          );
        }
        return Object.freeze({
          value: detailFromRow(updated),
          replayed: false,
        });
      });
    },

    async archive(
      options: ArchiveWorkflowDraftPersistenceOptions,
    ): Promise<WorkflowDraftMutationResult> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workflow.author",
          options.now,
        );
        const existing = await readDefinition(
          connection,
          options.authority.workspaceId,
          options.definitionId,
          true,
        );
        if (!existing || existing.draftId !== options.draftId) {
          return invalid(
            "workflow_authoring.not_found",
            "Workflow Definition or Draft was not found.",
          );
        }
        if (
          existing.version !== options.expectedDefinitionVersion ||
          existing.draftVersion !== options.expectedDraftVersion
        ) {
          return invalid(
            "workflow_authoring.version_conflict",
            "Workflow Definition or Draft changed before archive.",
          );
        }
        if (
          existing.lifecycleStatus === "archived" &&
          existing.draftLifecycleStatus === "archived"
        ) {
          return Object.freeze({
            value: detailFromRow(existing),
            replayed: true,
          });
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE workflow_definition
           SET lifecycle_status = 'archived',
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.definitionId,
            options.expectedDefinitionVersion,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE workflow_draft
           SET lifecycle_status = 'archived',
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND workflow_definition_id = ?
             AND version = ?`,
          [
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.draftId,
            options.definitionId,
            options.expectedDraftVersion,
          ],
        );
        await appendAudit(
          connection,
          options,
          "workflow.draft.archived",
          "workflow.draft_archived",
          Object.freeze({
            draftId: options.draftId,
            previousDefinitionVersion: options.expectedDefinitionVersion,
            previousDraftVersion: options.expectedDraftVersion,
          }),
        );
        const archived = await readDefinition(
          connection,
          options.authority.workspaceId,
          options.definitionId,
          false,
        );
        if (!archived) {
          return invalid(
            "workflow_authoring.integrity_violation",
            "Archived Workflow Draft cannot be read back.",
          );
        }
        return Object.freeze({
          value: detailFromRow(archived),
          replayed: false,
        });
      });
    },
  };
  return Object.freeze(repository);
}
