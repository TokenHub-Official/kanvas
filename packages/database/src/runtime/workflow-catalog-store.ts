import type {
  TrustedWorkspaceScope,
  WorkflowCatalogRepository,
  WorkflowTemplate,
} from "@kanvas/application";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import type { EffectiveInvocationSchemaProjector } from "./effective-invocation-schema-store.js";
import { parseWorkflowPresentation } from "./publication-documents.js";

interface TemplateRow extends RowDataPacket {
  readonly workflowDefinitionId: string;
  readonly workflowRevisionId: string;
  readonly workflowKey: string;
  readonly revision: number;
  readonly displayName: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly canonicalDigest: string;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly topology: unknown;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly presentation: unknown;
  readonly publishedAt: Date;
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function record(value: unknown, label: string) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} is not a JSON object.`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function fromRow(row: TemplateRow): WorkflowTemplate {
  const topology = parseJson(row.topology);
  if (!isWorkflowTopology(topology)) {
    throw new Error("Published Workflow template topology is invalid.");
  }
  return Object.freeze({
    workflowDefinitionId: row.workflowDefinitionId,
    workflowRevisionId: row.workflowRevisionId,
    workflowKey: row.workflowKey,
    revision: row.revision,
    displayName: row.displayName,
    ...(row.description ? { description: row.description } : {}),
    ...(row.category ? { category: row.category } : {}),
    canonicalDigest: row.canonicalDigest,
    runtimeStatus: row.runtimeStatus,
    topology,
    inputSchema: record(row.inputSchema, "Workflow input schema"),
    outputSchema: record(row.outputSchema, "Workflow output schema"),
    ...(row.presentation
      ? { presentation: parseWorkflowPresentation(row.presentation) }
      : {}),
    publishedAt: row.publishedAt,
  });
}

const select = `SELECT
  COALESCE(definition.id, revision.id) AS workflowDefinitionId,
  revision.id AS workflowRevisionId,
  revision.workflow_key AS workflowKey,
  revision.revision,
  COALESCE(definition.display_name, revision.workflow_key) AS displayName,
  definition.description,
  definition.category,
  revision.canonical_digest AS canonicalDigest,
  activation.runtime_status AS runtimeStatus,
  revision.topology,
  revision.input_schema AS inputSchema,
  revision.output_schema AS outputSchema,
  revision.presentation,
  revision.published_at AS publishedAt
FROM workflow_revision AS revision
LEFT JOIN workflow_definition AS definition
  ON definition.workspace_id = revision.workspace_id
  AND definition.id = revision.workflow_definition_id
INNER JOIN workflow_revision_activation AS activation
  ON activation.workspace_id = revision.workspace_id
  AND activation.workflow_revision_id = revision.id`;

async function transaction<TResult>(
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

export function createWorkflowCatalogStore(
  pool: Pool,
  options: {
    readonly effectiveInvocationSchemas?: EffectiveInvocationSchemaProjector;
  } = {},
): WorkflowCatalogRepository {
  return Object.freeze({
    list(authority: TrustedWorkspaceScope, now: Date) {
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "workflow.read",
          now,
        );
        const [rows] = await connection.execute<TemplateRow[]>(
          `${select}
           WHERE revision.workspace_id = ?
             AND revision.lifecycle_status = 'published'
             AND (
               definition.lifecycle_status = 'active'
               OR definition.id IS NULL
             )
           ORDER BY revision.published_at DESC, revision.id DESC
           LIMIT 200`,
          [authority.workspaceId],
        );
        return Object.freeze(rows.map(fromRow));
      });
    },
    get(
      authority: TrustedWorkspaceScope,
      workflowRevisionId: string,
      now: Date,
    ) {
      return transaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "workflow.read",
          now,
        );
        const [rows] = await connection.execute<TemplateRow[]>(
          `${select}
           WHERE revision.workspace_id = ?
             AND revision.id = ?
             AND revision.lifecycle_status = 'published'
           LIMIT 1`,
          [authority.workspaceId, workflowRevisionId],
        );
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        const template = fromRow(row);
        if (!options.effectiveInvocationSchemas) {
          return template;
        }
        const effectiveInvocationSchema =
          await options.effectiveInvocationSchemas.projectInTransaction(
            connection,
            {
              workspaceId: authority.workspaceId,
              workflowRevisionId: template.workflowRevisionId,
              topology: template.topology,
              inputSchema: template.inputSchema,
              now,
            },
          );
        return Object.freeze({
          ...template,
          effectiveInvocationSchema,
        });
      });
    },
  });
}
