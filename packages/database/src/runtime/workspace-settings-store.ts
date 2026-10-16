import type { TrustedWorkspaceScope } from "@kanvas/application";
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

export interface WorkspaceSettingsRecord {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface RenameWorkspaceOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly expectedVersion: number;
  readonly name: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface WorkspaceSettingsStore {
  get(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<WorkspaceSettingsRecord>;
  rename(options: RenameWorkspaceOptions): Promise<WorkspaceSettingsRecord>;
}

interface WorkspaceSettingsRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly updatedAt: Date;
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

function settingsFrom(row: WorkspaceSettingsRow): WorkspaceSettingsRecord {
  return Object.freeze({
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    version: row.version,
    updatedAt: new Date(row.updatedAt),
  });
}

async function readWorkspace(
  connection: PoolConnection,
  workspaceId: string,
  lock: boolean,
): Promise<WorkspaceSettingsRow> {
  const [rows] = await connection.execute<WorkspaceSettingsRow[]>(
    `SELECT
         id AS workspaceId,
         slug,
         name,
         status,
         version,
         updated_at AS updatedAt
       FROM workspace
       WHERE id = ?
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId],
  );
  const workspace = rows[0];
  if (!workspace) {
    throw new Error("Workspace settings were not found.");
  }
  return workspace;
}

export function createWorkspaceSettingsStore(
  pool: Pool,
): WorkspaceSettingsStore {
  return Object.freeze({
    async get(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<WorkspaceSettingsRecord> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "workspace.manage",
          now,
        );
        return settingsFrom(
          await readWorkspace(connection, scope.workspaceId, false),
        );
      });
    },

    async rename(
      options: RenameWorkspaceOptions,
    ): Promise<WorkspaceSettingsRecord> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "workspace.manage",
          options.now,
        );
        const workspace = await readWorkspace(
          connection,
          options.scope.workspaceId,
          true,
        );
        if (workspace.version !== options.expectedVersion) {
          throw new Error("Workspace settings changed before this operation.");
        }
        if (workspace.status !== "active") {
          throw new Error(
            "Workspace settings cannot be changed in the current state.",
          );
        }
        if (workspace.name === options.name) {
          return settingsFrom(workspace);
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE workspace
             SET name = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND version = ?
               AND status = 'active'`,
          [
            options.name,
            options.now,
            options.scope.workspaceId,
            workspace.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new Error("Workspace settings changed before this operation.");
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "workspace.name.changed",
            action: "workspace.name.changed",
            resourceType: "workspace",
            resourceId: options.scope.workspaceId,
            outcome: "succeeded",
            decisionReasonCode: "workspace.name_updated",
            severity: "info",
            authorizationDecision: Object.freeze({
              permission: "workspace.manage",
              authorityVersion: options.scope.authorityVersion,
            }),
            details: Object.freeze({
              previousName: workspace.name,
              nextName: options.name,
              previousVersion: workspace.version,
              nextVersion: workspace.version + 1,
            }),
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          workspaceId: workspace.workspaceId,
          slug: workspace.slug,
          name: options.name,
          version: workspace.version + 1,
          updatedAt: new Date(options.now),
        });
      });
    },
  });
}
