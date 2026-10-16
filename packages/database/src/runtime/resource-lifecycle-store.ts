import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";

export type ManagedResourceState = "enabled" | "disabled" | "deleted";
export interface ResourceLifecycleRecord {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly state: ManagedResourceState;
  readonly version: number;
  readonly boundAgentCount: number;
  readonly draftIds: readonly string[];
  readonly canManage: boolean;
  readonly canEnable: boolean;
  readonly updatedAt: string;
}
export class ResourceLifecycleError extends DomainError {
  constructor(code: string) {
    super(code, code);
    this.name = "ResourceLifecycleError";
  }
}
interface LifecycleRow extends RowDataPacket {
  id: string;
  displayName: string;
  summary: string;
  version: number;
  ownerPrincipalId: string;
  lifecycleStatus: "active" | "archived";
  usageStatus: "enabled" | "disabled";
  managementKind: "system" | "workspace";
  updatedAt: Date;
  draftIds: unknown;
  boundAgentCount: number;
}
const activeRunSql =
  "run.lifecycle_status IN ('queued','running','waiting_approval','waiting_for_user')";
export async function activeResourceRuns(
  connection: PoolConnection,
  workspaceId: string,
  kind: "agent" | "skill",
  id: string,
): Promise<string[]> {
  const target =
    kind === "agent"
      ? "thread.agent_definition_id = ?"
      : `EXISTS (SELECT 1 FROM agent_run_foundation_context AS foundation JOIN
        JSON_TABLE(foundation.skill_context_snapshot, '$[*]' COLUMNS (revision_id char(26) PATH '$.skillRevisionId')) AS pinned ON TRUE
        LEFT JOIN skill_revision AS revision ON revision.workspace_id = foundation.workspace_id AND revision.id = pinned.revision_id
        LEFT JOIN publication_candidate AS candidate ON candidate.workspace_id = foundation.workspace_id AND candidate.id = pinned.revision_id
        LEFT JOIN skill_draft AS draft ON draft.workspace_id = candidate.workspace_id AND draft.id = candidate.source_draft_id
        WHERE foundation.workspace_id = run.workspace_id AND foundation.agent_run_id = run.id
          AND COALESCE(revision.skill_definition_id, draft.skill_definition_id) = ?)`;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT run.id FROM agent_run AS run
    INNER JOIN agent_thread AS thread ON thread.workspace_id = run.workspace_id AND thread.id = run.thread_id
    WHERE run.workspace_id = ? AND ${activeRunSql} AND ${target} FOR UPDATE`,
    [workspaceId, id],
  );
  return rows.map((row) => String(row.id));
}
export function createResourceLifecycleOperations(pool: Pool) {
  async function transaction<T>(
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
  return {
    listResourceStates(
      authority: TrustedWorkspaceScope,
      subjectKind: "agent" | "skill",
      now: Date,
    ): Promise<ResourceLifecycleRecord[]> {
      return transaction(async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          `${subjectKind}.read`,
          now,
        );
        const [rows] = await connection.execute<LifecycleRow[]>(
          `SELECT definition.id, presentation.display_name AS displayName, presentation.summary,
          definition.version, definition.owner_principal_id AS ownerPrincipalId, definition.lifecycle_status AS lifecycleStatus,
          definition.usage_status AS usageStatus, definition.updated_at AS updatedAt,
          ${subjectKind === "skill" ? `(SELECT JSON_ARRAYAGG(draft.id) FROM skill_draft AS draft WHERE draft.workspace_id = definition.workspace_id AND draft.skill_definition_id = definition.id)` : "NULL"} AS draftIds,
          ${subjectKind === "skill" ? `(SELECT COUNT(DISTINCT profile.agent_definition_id) FROM agent_revision_skill_binding AS binding INNER JOIN agent_profile_revision AS profile ON profile.workspace_id = binding.workspace_id AND profile.id = binding.profile_revision_id INNER JOIN agent_definition AS agent ON agent.workspace_id = profile.workspace_id AND agent.id = profile.agent_definition_id WHERE binding.workspace_id = definition.workspace_id AND binding.skill_definition_id = definition.id AND agent.lifecycle_status = 'active' AND NOT EXISTS (SELECT 1 FROM agent_profile_revision AS newer WHERE newer.workspace_id = profile.workspace_id AND newer.agent_definition_id = profile.agent_definition_id AND newer.revision > profile.revision))` : "0"} AS boundAgentCount,
          ${subjectKind === "agent" ? "definition.management_kind" : "'workspace'"} AS managementKind
          FROM ${subjectKind}_definition AS definition INNER JOIN ${subjectKind}_presentation AS presentation
          ON presentation.workspace_id = definition.workspace_id AND presentation.${subjectKind}_definition_id = definition.id
          WHERE definition.workspace_id = ? AND (definition.owner_principal_id = ? OR ${subjectKind === "skill" ? "(? = 1 AND definition.visibility = 'workspace')" : "? = 1"} OR (definition.visibility = 'workspace' AND definition.lifecycle_status = 'active') OR ${subjectKind === "agent" ? `EXISTS (SELECT 1 FROM agent_thread AS thread WHERE thread.workspace_id = definition.workspace_id AND thread.agent_definition_id = definition.id AND thread.created_by_principal_id = ?)` : `EXISTS (SELECT 1 FROM agent_revision_skill_binding AS binding INNER JOIN agent_profile_revision AS profile ON profile.workspace_id = binding.workspace_id AND profile.id = binding.profile_revision_id INNER JOIN agent_definition AS agent ON agent.workspace_id = profile.workspace_id AND agent.id = profile.agent_definition_id WHERE binding.workspace_id = definition.workspace_id AND binding.skill_definition_id = definition.id AND definition.visibility = 'workspace' AND agent.lifecycle_status = 'active' AND (agent.visibility = 'workspace' OR agent.owner_principal_id = ?))`})
          ORDER BY definition.updated_at DESC, definition.id DESC`,
          [
            authority.workspaceId,
            authority.principalId,
            authority.effectivePermissions.includes("workspace.manage") ? 1 : 0,
            authority.principalId,
          ],
        );
        return rows.map((row) => {
          const value: unknown =
            typeof row.draftIds === "string"
              ? JSON.parse(row.draftIds)
              : row.draftIds;
          const draftIds = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [];
          return {
            id: String(row.id),
            displayName: String(row.displayName),
            summary: String(row.summary),
            state:
              row.lifecycleStatus === "archived" ? "deleted" : row.usageStatus,
            draftIds,
            version: Number(row.version),
            boundAgentCount: Number(row.boundAgentCount),
            updatedAt: row.updatedAt.toISOString(),
            canEnable: authority.effectivePermissions.includes(
              `${subjectKind}.publish`,
            ),
            canManage:
              row.managementKind !== "system" &&
              authority.effectivePermissions.includes(
                `${subjectKind}.manage`,
              ) &&
              (row.ownerPrincipalId === authority.principalId ||
                authority.effectivePermissions.includes("workspace.manage")),
          };
        });
      });
    },
    changeResourceState(options: {
      authority: TrustedWorkspaceScope;
      subjectKind: "agent" | "skill";
      subjectId: string;
      expectedVersion: number;
      state: ManagedResourceState;
      now: Date;
      audit: ControlPlaneAuditContext;
    }): Promise<void> {
      return transaction(async (connection) => {
        const { authority, subjectKind, subjectId, now, state } = options;
        if (
          !["agent", "skill"].includes(subjectKind) ||
          !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(subjectId) ||
          !Number.isSafeInteger(options.expectedVersion) ||
          options.expectedVersion < 1 ||
          !["enabled", "disabled", "deleted"].includes(state)
        )
          throw new ResourceLifecycleError("resource_lifecycle.invalid");
        const permission = `${subjectKind}.manage` as const;
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          permission,
          now,
        );
        const [rows] = await connection.execute<LifecycleRow[]>(
          `SELECT version, owner_principal_id AS ownerPrincipalId, lifecycle_status AS lifecycleStatus, usage_status AS usageStatus,
          ${subjectKind === "agent" ? "management_kind" : "'workspace'"} AS managementKind FROM ${subjectKind}_definition WHERE workspace_id = ? AND id = ? FOR UPDATE`,
          [authority.workspaceId, subjectId],
        );
        const row = rows[0];
        if (!row)
          throw new ResourceLifecycleError("resource_lifecycle.not_found");
        if (
          row.managementKind === "system" ||
          (row.ownerPrincipalId !== authority.principalId &&
            !authority.effectivePermissions.includes("workspace.manage"))
        )
          throw new ResourceLifecycleError("resource_lifecycle.forbidden");
        if (row.version !== options.expectedVersion)
          throw new ResourceLifecycleError("resource_lifecycle.conflict");
        if (state === "enabled")
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            authority,
            `${subjectKind}.publish`,
            now,
          );
        const previous =
          row.lifecycleStatus === "archived" ? "deleted" : row.usageStatus;
        if (previous === state) return;
        if (previous === "deleted" && state !== "disabled")
          throw new ResourceLifecycleError(
            "resource_lifecycle.restore_disabled",
          );
        if (
          state === "deleted" &&
          (
            await activeResourceRuns(
              connection,
              authority.workspaceId,
              subjectKind,
              subjectId,
            )
          ).length
        )
          throw new ResourceLifecycleError("resource_lifecycle.run_active");
        if (state === "enabled" && subjectKind === "agent") {
          const [unavailable] = await connection.execute<RowDataPacket[]>(
            `SELECT binding.skill_definition_id FROM agent_revision_skill_binding AS binding
            INNER JOIN agent_profile_revision AS profile ON profile.workspace_id = binding.workspace_id AND profile.id = binding.profile_revision_id
            INNER JOIN skill_definition AS skill ON skill.workspace_id = binding.workspace_id AND skill.id = binding.skill_definition_id
            WHERE profile.workspace_id = ? AND profile.agent_definition_id = ?
              AND profile.revision = (SELECT MAX(latest.revision) FROM agent_profile_revision AS latest WHERE latest.workspace_id = profile.workspace_id AND latest.agent_definition_id = profile.agent_definition_id)
              AND (skill.lifecycle_status <> 'active' OR skill.usage_status <> 'enabled')`,
            [authority.workspaceId, subjectId],
          );
          if (unavailable.length)
            throw new ResourceLifecycleError(
              "resource_lifecycle.dependencies_unavailable",
            );
        }
        await connection.execute(
          `UPDATE ${subjectKind}_definition SET lifecycle_status = ?, usage_status = ?, archived_at = ?, version = version + 1, updated_at = ?, updated_by_principal_id = ? WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            state === "deleted" ? "archived" : "active",
            state === "enabled" ? "enabled" : "disabled",
            state === "deleted" ? now : null,
            now,
            authority.principalId,
            authority.workspaceId,
            subjectId,
            options.expectedVersion,
          ],
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: authority.organizationId,
            workspaceId: authority.workspaceId,
            eventType: "resource.lifecycle_changed",
            action: "change_resource_state",
            resourceType: `${subjectKind}_definition`,
            resourceId: subjectId,
            outcome: "succeeded",
            decisionReasonCode: "resource.lifecycle_changed",
            severity: "info",
            authorizationDecision: { authorized: true, permission },
            details: { previousState: previous, state },
            occurredAt: now,
          },
        );
      });
    },
  };
}
export type ResourceLifecycleOperations = ReturnType<
  typeof createResourceLifecycleOperations
>;

// Called inside new-run transactions; locks serialize admission with disable/delete.
export async function assertResourceAdmission(
  connection: PoolConnection,
  workspaceId: string,
  agentId: string,
  skillRevisionIds: readonly string[] = [],
): Promise<void> {
  const [agents] = await connection.execute<RowDataPacket[]>(
    "SELECT lifecycle_status, usage_status FROM agent_definition WHERE workspace_id = ? AND id = ? FOR UPDATE",
    [workspaceId, agentId],
  );
  if (
    agents[0]?.lifecycle_status !== "active" ||
    agents[0]?.usage_status !== "enabled"
  )
    throw new ResourceLifecycleError("resource_lifecycle.unavailable");
  if (!skillRevisionIds.length) return;
  const placeholders = skillRevisionIds.map(() => "?").join(",");
  const [skills] = await connection.execute<RowDataPacket[]>(
    `SELECT definition.lifecycle_status, definition.usage_status FROM skill_definition AS definition
    WHERE definition.workspace_id = ? AND (EXISTS (SELECT 1 FROM skill_revision AS revision WHERE revision.workspace_id = definition.workspace_id AND revision.skill_definition_id = definition.id AND revision.id IN (${placeholders}))
      OR EXISTS (SELECT 1 FROM skill_draft AS draft INNER JOIN publication_candidate AS candidate ON candidate.workspace_id = draft.workspace_id AND candidate.source_draft_id = draft.id WHERE draft.workspace_id = definition.workspace_id AND draft.skill_definition_id = definition.id AND candidate.id IN (${placeholders})))
    ORDER BY definition.id FOR UPDATE`,
    [workspaceId, ...skillRevisionIds, ...skillRevisionIds],
  );
  if (
    skills.some(
      (row) =>
        row.lifecycle_status !== "active" || row.usage_status !== "enabled",
    )
  )
    throw new ResourceLifecycleError("resource_lifecycle.unavailable");
}
