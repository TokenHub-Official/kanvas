import {
  createResourceLifecycleOperations,
  type ResourceLifecycleOperations,
} from "./resource-lifecycle-store.js";
import {
  parseAgentProfileManifestV1,
  type AgentManagementKind,
  type AgentProfileRevisionRecord,
  type TrustedWorkspaceScope,
  workspaceDefaultAgentSystemKeyV1,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { ensureWorkspaceDefaultAgentInTransaction } from "./workspace-default-agent-store.js";

export type AgentHubVisibility = "private" | "workspace";
export type AgentBoundSkillWorkspaceAvailability =
  "available" | "private" | "disabled" | "deleted" | "revoked" | "unavailable";
export type AgentHubAvatar =
  | {
      readonly kind: "emoji";
      readonly value: string;
      readonly backgroundColor: string;
    }
  | {
      readonly kind: "icon";
      readonly value:
        | "robot"
        | "sparkles"
        | "palette"
        | "picture"
        | "bulb"
        | "pen"
        | "camera"
        | "team"
        | "brain"
        | "book"
        | "research"
        | "code"
        | "chart"
        | "compass"
        | "globe"
        | "rocket"
        | "target"
        | "puzzle"
        | "music"
        | "film"
        | "megaphone"
        | "briefcase"
        | "graduation"
        | "shield"
        | "heart"
        | "leaf"
        | "tree"
        | "sun"
        | "planet"
        | "cat"
        | "dog"
        | "butterfly"
        | "coffee"
        | "diamond"
        | "game"
        | "building"
        | "flask"
        | "calculator"
        | "translate"
        | "magic";
      readonly backgroundColor: string;
      readonly foregroundColor?: string;
    }
  | { readonly kind: "image"; readonly assetId: string };

export interface AgentHubAgentRecord {
  readonly id: string;
  readonly agentKey: string;
  readonly resourceState: "enabled" | "disabled" | "deleted";
  readonly managementKind: AgentManagementKind;
  readonly systemKey?: string;
  readonly displayName: string;
  readonly summary: string;

  readonly avatar?: AgentHubAvatar;
  readonly coverAssetId?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly ownerPrincipalId: string;
  readonly visibility: AgentHubVisibility;
  readonly version: number;
  readonly profileRevisionId: string;
  readonly profileRevision: number;
  readonly boundSkillCount: number;
  readonly updatedAt: Date;
}

export interface AgentHubSkillRecord {
  readonly id: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly coverAssetId?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly exampleRequests: readonly string[];

  readonly ownerPrincipalId: string;
  readonly visibility: AgentHubVisibility;
  readonly version: number;
  readonly skillRevisionId: string;
  readonly skillRevision: number;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly activationVersion: number;
  readonly updatedAt: Date;
}

export interface AgentHubAgentDetailRecord extends AgentHubAgentRecord {
  readonly ownerAuthSubjectId: string;
  readonly profile: AgentProfileRevisionRecord;
  readonly boundSkills: readonly {
    readonly id: string;
    readonly displayName?: string;
    readonly summary?: string;
    readonly workspaceAvailability: AgentBoundSkillWorkspaceAvailability;
  }[];
  readonly boundLibraries?: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly description?: string;
  }[];
  readonly boundBrands: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly description?: string;
  }[];
  readonly boundWorkflows: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly description?: string;
  }[];
}

export interface AgentHubStore extends ResourceLifecycleOperations {
  listAgents(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly AgentHubAgentRecord[]>;
  getAgent(
    authority: TrustedWorkspaceScope,
    agentDefinitionId: string,
    now: Date,
    options?: {
      readonly includeDeleted?: boolean;
      readonly profileRevisionId?: string;
    },
  ): Promise<AgentHubAgentDetailRecord | undefined>;
  listSkills(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly AgentHubSkillRecord[]>;
  setVisibility(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly subjectKind: "agent" | "skill";
    readonly subjectId: string;
    readonly expectedVersion: number;
    readonly visibility: AgentHubVisibility;
    readonly now: Date;
  }): Promise<void>;
}

interface AgentRow extends RowDataPacket {
  readonly id: string;
  readonly agentKey: string;
  readonly resourceState: "enabled" | "disabled" | "deleted";
  readonly managementKind: AgentManagementKind;
  readonly systemKey: string | null;
  readonly displayName: string;
  readonly summary: string;

  readonly avatar: unknown;
  readonly coverAssetId: string | null;
  readonly category: string | null;
  readonly tags: unknown;
  readonly ownerPrincipalId: string;
  readonly visibility: AgentHubVisibility;
  readonly version: number;
  readonly profileRevisionId: string;
  readonly profileRevision: number;
  readonly boundSkillCount: number | string;
  readonly updatedAt: Date;
}

interface SkillRow extends RowDataPacket {
  readonly id: string;
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly coverAssetId: string | null;
  readonly category: string | null;
  readonly tags: unknown;
  readonly exampleRequests: unknown;

  readonly ownerPrincipalId: string;
  readonly visibility: AgentHubVisibility;
  readonly version: number;
  readonly skillRevisionId: string;
  readonly skillRevision: number;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly activationVersion: number;
  readonly updatedAt: Date;
}

interface AgentDetailRow extends AgentRow {
  readonly ownerAuthSubjectId: string;
  readonly profileKey: string;
  readonly manifestDocument: unknown;
  readonly canonicalDigest: string;
}

interface AgentBoundSkillRow extends RowDataPacket {
  readonly id: string;
  readonly displayName: string | null;
  readonly summary: string | null;
  readonly workspaceAvailability: AgentBoundSkillWorkspaceAvailability;
}

interface AgentBoundResourceRow extends RowDataPacket {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const colorPattern = /^#[0-9A-Fa-f]{6}$/u;
const agentIconValues = new Set([
  "robot",
  "sparkles",
  "palette",
  "picture",
  "bulb",
  "pen",
  "camera",
  "team",
  "brain",
  "book",
  "research",
  "code",
  "chart",
  "compass",
  "globe",
  "rocket",
  "target",
  "puzzle",
  "music",
  "film",
  "megaphone",
  "briefcase",
  "graduation",
  "shield",
  "heart",
  "leaf",
  "tree",
  "sun",
  "planet",
  "cat",
  "dog",
  "butterfly",
  "coffee",
  "diamond",
  "game",
  "building",
  "flask",
  "calculator",
  "translate",
  "magic",
]);

export class AgentHubStoreError extends Error {
  public constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentHubStoreError";
  }
}

function fail(code: string, message: string): never {
  throw new AgentHubStoreError(code, message);
}

function stringList(value: unknown): readonly string[] {
  let decoded: unknown = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return fail("agent_hub.integrity", "Stored presentation is invalid.");
    }
  }
  if (
    !Array.isArray(decoded) ||
    !decoded.every((item) => typeof item === "string")
  ) {
    return fail("agent_hub.integrity", "Stored presentation is invalid.");
  }
  return Object.freeze(decoded);
}

function agentAvatar(value: unknown): AgentHubAvatar | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return agentAvatar(JSON.parse(value) as unknown);
    } catch {
      return fail("agent_hub.integrity", "Stored Agent avatar is invalid.");
    }
  }
  const decoded: unknown = value;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return fail("agent_hub.integrity", "Stored Agent avatar is invalid.");
  }
  const avatar = decoded as Record<string, unknown>;
  if (
    avatar.kind === "image" &&
    typeof avatar.assetId === "string" &&
    idPattern.test(avatar.assetId)
  ) {
    return Object.freeze({ kind: "image", assetId: avatar.assetId });
  }
  if (
    (avatar.kind === "emoji" || avatar.kind === "icon") &&
    typeof avatar.value === "string" &&
    avatar.value.length >= 1 &&
    avatar.value.length <= 32 &&
    typeof avatar.backgroundColor === "string" &&
    colorPattern.test(avatar.backgroundColor) &&
    (avatar.kind === "emoji" ||
      avatar.foregroundColor === undefined ||
      (typeof avatar.foregroundColor === "string" &&
        colorPattern.test(avatar.foregroundColor))) &&
    (avatar.kind === "emoji" || agentIconValues.has(avatar.value))
  ) {
    return Object.freeze({
      kind: avatar.kind,
      value: avatar.value,
      backgroundColor: avatar.backgroundColor,
      ...(avatar.kind === "icon" && avatar.foregroundColor
        ? { foregroundColor: avatar.foregroundColor }
        : {}),
    }) as AgentHubAvatar;
  }
  return fail("agent_hub.integrity", "Stored Agent avatar is invalid.");
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

function agentFrom(row: AgentRow): AgentHubAgentRecord {
  const avatar = agentAvatar(row.avatar);
  return Object.freeze({
    id: row.id,
    agentKey: row.agentKey,
    resourceState: row.resourceState,
    managementKind: row.managementKind,
    ...(row.systemKey ? { systemKey: row.systemKey } : {}),
    displayName: row.displayName,
    summary: row.summary,

    ...(avatar ? { avatar } : {}),
    ...(row.coverAssetId ? { coverAssetId: row.coverAssetId } : {}),
    ...(row.category ? { category: row.category } : {}),
    tags: stringList(row.tags),
    ownerPrincipalId: row.ownerPrincipalId,
    visibility: row.visibility,
    version: row.version,
    profileRevisionId: row.profileRevisionId,
    profileRevision: row.profileRevision,
    boundSkillCount: Number(row.boundSkillCount),
    updatedAt: new Date(row.updatedAt),
  });
}

function skillFrom(row: SkillRow): AgentHubSkillRecord {
  return Object.freeze({
    id: row.id,
    skillKey: row.skillKey,
    displayName: row.displayName,
    summary: row.summary,
    ...(row.coverAssetId ? { coverAssetId: row.coverAssetId } : {}),
    ...(row.category ? { category: row.category } : {}),
    tags: stringList(row.tags),
    exampleRequests: stringList(row.exampleRequests),

    ownerPrincipalId: row.ownerPrincipalId,
    visibility: row.visibility,
    version: row.version,
    skillRevisionId: row.skillRevisionId,
    skillRevision: row.skillRevision,
    runtimeStatus: row.runtimeStatus,
    activationVersion: row.activationVersion,
    updatedAt: new Date(row.updatedAt),
  });
}

function boundResourceFrom(row: AgentBoundResourceRow) {
  return Object.freeze({
    id: row.id,
    displayName: row.displayName,
    ...(row.description ? { description: row.description } : {}),
  });
}

function boundSkillFrom(row: AgentBoundSkillRow) {
  return Object.freeze({
    id: row.id,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    workspaceAvailability: row.workspaceAvailability,
  });
}

export function createAgentHubStore(pool: Pool): AgentHubStore {
  return Object.freeze({
    ...createResourceLifecycleOperations(pool),
    listAgents(authority: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.read",
          now,
        );
        const statement = `SELECT
             definition.id,
             definition.agent_key AS agentKey,
             definition.usage_status AS resourceState,
             definition.management_kind AS managementKind,
             definition.system_key AS systemKey,
             presentation.display_name AS displayName,
             presentation.summary,

             presentation.avatar,
             presentation.cover_asset_id AS coverAssetId,
             presentation.category,
             presentation.tags,
             definition.owner_principal_id AS ownerPrincipalId,
             definition.visibility,
             definition.version,
             profile.id AS profileRevisionId,
             profile.revision AS profileRevision,
             (SELECT COUNT(*)
                FROM agent_revision_skill_binding AS binding
               WHERE binding.workspace_id = definition.workspace_id
                 AND binding.profile_revision_id = profile.id)
               AS boundSkillCount,
             definition.updated_at AS updatedAt
           FROM agent_definition AS definition
           INNER JOIN agent_presentation AS presentation
             ON presentation.workspace_id = definition.workspace_id
            AND presentation.agent_definition_id = definition.id
           INNER JOIN agent_profile_revision AS profile
             ON profile.workspace_id = definition.workspace_id
            AND profile.agent_definition_id = definition.id
           INNER JOIN agent_profile_activation AS activation
             ON activation.workspace_id = profile.workspace_id
            AND activation.profile_revision_id = profile.id
           WHERE definition.workspace_id = ?
             AND definition.lifecycle_status = 'active'
             AND profile.lifecycle_status = 'published'
             AND activation.runtime_status = 'enabled'
             AND (definition.visibility = 'workspace'
               OR definition.owner_principal_id = ?)
             AND NOT EXISTS (
               SELECT 1
                 FROM agent_profile_revision AS newer
                 INNER JOIN agent_profile_activation AS newer_activation
                   ON newer_activation.workspace_id = newer.workspace_id
                  AND newer_activation.profile_revision_id = newer.id
                  AND newer_activation.runtime_status = 'enabled'
                WHERE newer.workspace_id = profile.workspace_id
                  AND newer.agent_definition_id = profile.agent_definition_id
                  AND newer.lifecycle_status = 'published'
                  AND (newer.revision > profile.revision
                    OR (newer.revision = profile.revision AND newer.id > profile.id))
             )
           ORDER BY definition.updated_at DESC, definition.id DESC
           LIMIT 100`;
        let [rows] = await connection.execute<AgentRow[]>(statement, [
          authority.workspaceId,
          authority.principalId,
        ]);
        if (
          !rows.some(
            (row) =>
              row.managementKind === "system" &&
              row.systemKey === workspaceDefaultAgentSystemKeyV1,
          )
        ) {
          await ensureWorkspaceDefaultAgentInTransaction(connection, {
            workspaceId: authority.workspaceId,
            now,
          });
          [rows] = await connection.execute<AgentRow[]>(
            `${statement} FOR SHARE`,
            [authority.workspaceId, authority.principalId],
          );
        }
        return Object.freeze(rows.map(agentFrom));
      });
    },

    getAgent(
      authority: TrustedWorkspaceScope,
      agentDefinitionId: string,
      now: Date,
      options?: {
        readonly includeDeleted?: boolean;
        readonly profileRevisionId?: string;
      },
    ) {
      if (!idPattern.test(agentDefinitionId)) {
        return Promise.reject(
          new AgentHubStoreError("agent_hub.invalid", "Agent ID is invalid."),
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.read",
          now,
        );
        const [rows] = await connection.execute<AgentDetailRow[]>(
          `SELECT
             definition.id,
             definition.agent_key AS agentKey,
             CASE WHEN definition.lifecycle_status = 'archived' THEN 'deleted' ELSE definition.usage_status END AS resourceState,
             definition.management_kind AS managementKind,
             definition.system_key AS systemKey,
             presentation.display_name AS displayName,
             presentation.summary,

             presentation.avatar,
             presentation.cover_asset_id AS coverAssetId,
             presentation.category,
             presentation.tags,
             definition.owner_principal_id AS ownerPrincipalId,
             owner.auth_subject_id AS ownerAuthSubjectId,
             definition.visibility,
             definition.version,
             profile.id AS profileRevisionId,
             profile.profile_key AS profileKey,
             profile.revision AS profileRevision,
             profile.manifest_document AS manifestDocument,
             profile.canonical_digest AS canonicalDigest,
             (SELECT COUNT(*)
                FROM agent_revision_skill_binding AS binding
               WHERE binding.workspace_id = definition.workspace_id
                 AND binding.profile_revision_id = profile.id)
               AS boundSkillCount,
             definition.updated_at AS updatedAt
           FROM agent_definition AS definition
           INNER JOIN agent_presentation AS presentation
             ON presentation.workspace_id = definition.workspace_id
            AND presentation.agent_definition_id = definition.id
           INNER JOIN human_principal AS owner
             ON owner.principal_id = definition.owner_principal_id
           INNER JOIN agent_profile_revision AS profile
             ON profile.workspace_id = definition.workspace_id
            AND profile.agent_definition_id = definition.id
           INNER JOIN agent_profile_activation AS activation
             ON activation.workspace_id = profile.workspace_id
            AND activation.profile_revision_id = profile.id
           WHERE definition.workspace_id = ?
             AND definition.id = ?
             AND (definition.lifecycle_status = 'active' OR ?)
             AND profile.lifecycle_status = 'published'
             AND (? IS NOT NULL OR activation.runtime_status = 'enabled')
             AND (? IS NULL OR profile.id = ?)
             AND (definition.visibility = 'workspace'
               OR definition.owner_principal_id = ?)
           ORDER BY profile.revision DESC, profile.id DESC
           LIMIT 1`,
          [
            authority.workspaceId,
            agentDefinitionId,
            options?.includeDeleted ?? false,
            options?.profileRevisionId ?? null,
            options?.profileRevisionId ?? null,
            options?.profileRevisionId ?? null,
            authority.principalId,
          ],
        );
        const row = rows[0];
        if (!row) return undefined;
        const manifest = parseAgentProfileManifestV1(row.manifestDocument);
        if (!manifest) {
          return fail(
            "agent_hub.integrity",
            "Stored Agent configuration is invalid.",
          );
        }
        const [skills, brands, workflows, libraries] = await Promise.all([
          connection.execute<AgentBoundSkillRow[]>(
            `SELECT definition.id,
                    CASE WHEN definition.visibility = 'workspace'
                           OR definition.owner_principal_id = ?
                         THEN presentation.display_name ELSE NULL END AS displayName,
                    CASE WHEN definition.visibility = 'workspace'
                           OR definition.owner_principal_id = ?
                         THEN presentation.summary ELSE NULL END AS summary,
                    CASE
                      WHEN definition.lifecycle_status <> 'active' THEN 'deleted'
                      WHEN definition.usage_status <> 'enabled' THEN 'disabled'
                      WHEN latest_skill.id IS NULL
                        OR latest_activation.runtime_status IS NULL THEN 'unavailable'
                      WHEN latest_activation.runtime_status = 'revoked' THEN 'revoked'
                      WHEN latest_activation.runtime_status = 'disabled' THEN 'disabled'
                      WHEN definition.visibility = 'private' THEN 'private'
                      WHEN latest_activation.runtime_status = 'enabled' THEN 'available'
                      ELSE 'unavailable'
                    END AS workspaceAvailability
               FROM agent_revision_skill_binding AS binding
               INNER JOIN skill_definition AS definition
                 ON definition.workspace_id = binding.workspace_id
                AND definition.id = binding.skill_definition_id
               INNER JOIN skill_presentation AS presentation
                 ON presentation.workspace_id = definition.workspace_id
                AND presentation.skill_definition_id = definition.id
               LEFT JOIN skill_revision AS latest_skill
                 ON latest_skill.workspace_id = definition.workspace_id
                AND latest_skill.skill_definition_id = definition.id
                AND latest_skill.lifecycle_status = 'published'
                AND NOT EXISTS (
                  SELECT 1
                    FROM skill_revision AS newer_skill
                   WHERE newer_skill.workspace_id = latest_skill.workspace_id
                     AND newer_skill.skill_definition_id = latest_skill.skill_definition_id
                     AND newer_skill.lifecycle_status = 'published'
                     AND (newer_skill.revision > latest_skill.revision
                       OR (newer_skill.revision = latest_skill.revision
                         AND newer_skill.id > latest_skill.id))
                )
               LEFT JOIN skill_revision_activation AS latest_activation
                 ON latest_activation.workspace_id = latest_skill.workspace_id
                AND latest_activation.skill_revision_id = latest_skill.id
              WHERE binding.workspace_id = ?
                AND binding.profile_revision_id = ?
              ORDER BY binding.ordinal`,
            [
              authority.principalId,
              authority.principalId,
              authority.workspaceId,
              row.profileRevisionId,
            ],
          ),
          connection.execute<AgentBoundResourceRow[]>(
            `SELECT brand.id, brand.name AS displayName, brand.description
               FROM agent_revision_brand_binding AS binding
               INNER JOIN brand_kit AS brand
                 ON brand.workspace_id = binding.workspace_id
                AND brand.id = binding.brand_kit_id
              WHERE binding.workspace_id = ?
                AND binding.profile_revision_id = ?
              ORDER BY binding.ordinal`,
            [authority.workspaceId, row.profileRevisionId],
          ),
          connection.execute<AgentBoundResourceRow[]>(
            `SELECT workflow.id, workflow.display_name AS displayName,
                    workflow.description
               FROM agent_revision_workflow_binding AS binding
               INNER JOIN workflow_definition AS workflow
                 ON workflow.workspace_id = binding.workspace_id
                AND workflow.id = binding.workflow_definition_id
              WHERE binding.workspace_id = ?
                AND binding.profile_revision_id = ?
              ORDER BY binding.ordinal`,
            [authority.workspaceId, row.profileRevisionId],
          ),
          connection.execute<AgentBoundResourceRow[]>(
            `SELECT library.id, library.name AS displayName, library.description
             FROM agent_revision_library_binding AS binding
             INNER JOIN resource_library AS library ON library.workspace_id = binding.workspace_id AND library.id = binding.library_id
             WHERE binding.workspace_id = ? AND binding.profile_revision_id = ? ORDER BY binding.ordinal`,
            [authority.workspaceId, row.profileRevisionId],
          ),
        ]);
        return Object.freeze({
          ...agentFrom(row),
          ownerAuthSubjectId: row.ownerAuthSubjectId,
          profile: Object.freeze({
            id: row.profileRevisionId,
            workspaceId: authority.workspaceId,
            agentDefinitionId: row.id,
            profileKey: row.profileKey,
            revision: row.profileRevision,
            manifest,
            canonicalDigest: row.canonicalDigest,
          }),
          boundSkills: Object.freeze(skills[0].map(boundSkillFrom)),
          boundBrands: Object.freeze(brands[0].map(boundResourceFrom)),
          boundLibraries: Object.freeze(libraries[0].map(boundResourceFrom)),
          boundWorkflows: Object.freeze(workflows[0].map(boundResourceFrom)),
        });
      });
    },

    listSkills(authority: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "skill.read",
          now,
        );
        const [rows] = await connection.execute<SkillRow[]>(
          `SELECT
             definition.id,
             definition.skill_key AS skillKey,
             presentation.display_name AS displayName,
             presentation.summary,
             presentation.cover_asset_id AS coverAssetId,
             presentation.category,
             presentation.tags,
             presentation.example_requests AS exampleRequests,

             definition.owner_principal_id AS ownerPrincipalId,
             definition.visibility,
             definition.version,
             skill.id AS skillRevisionId,
             skill.revision AS skillRevision,
             CASE WHEN activation.runtime_status = 'revoked' THEN 'revoked' WHEN definition.usage_status = 'disabled' THEN 'disabled' ELSE activation.runtime_status END AS runtimeStatus,
             activation.version AS activationVersion,
             definition.updated_at AS updatedAt
           FROM skill_definition AS definition
           INNER JOIN skill_presentation AS presentation
             ON presentation.workspace_id = definition.workspace_id
            AND presentation.skill_definition_id = definition.id
           INNER JOIN skill_revision AS skill
             ON skill.workspace_id = definition.workspace_id
            AND skill.skill_definition_id = definition.id
           INNER JOIN skill_revision_activation AS activation
             ON activation.workspace_id = skill.workspace_id
            AND activation.skill_revision_id = skill.id
           WHERE definition.workspace_id = ?
             AND definition.lifecycle_status = 'active'
             AND skill.lifecycle_status = 'published'
             AND (activation.runtime_status = 'enabled'
               OR definition.owner_principal_id = ?)
             AND (definition.visibility = 'workspace'
               OR definition.owner_principal_id = ?)
             AND EXISTS (
               SELECT 1 FROM skill_revision_resource AS resource
                WHERE resource.workspace_id = skill.workspace_id
                  AND resource.skill_revision_id = skill.id
                  AND resource.resource_kind = 'instructions'
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM skill_revision AS newer
                WHERE newer.workspace_id = skill.workspace_id
                  AND newer.skill_definition_id = skill.skill_definition_id
                  AND newer.lifecycle_status = 'published'
                  AND (newer.revision > skill.revision
                    OR (newer.revision = skill.revision AND newer.id > skill.id))
             )
           ORDER BY definition.updated_at DESC, definition.id DESC
           LIMIT 100`,
          [authority.workspaceId, authority.principalId, authority.principalId],
        );
        return Object.freeze(rows.map(skillFrom));
      });
    },

    setVisibility(options: Parameters<AgentHubStore["setVisibility"]>[0]) {
      if (
        !idPattern.test(options.subjectId) ||
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1 ||
        !["private", "workspace"].includes(options.visibility)
      ) {
        return Promise.reject(
          new AgentHubStoreError(
            "agent_hub.invalid",
            "Visibility update is invalid.",
          ),
        );
      }
      return inTransaction(pool, async (connection) => {
        const permission =
          options.subjectKind === "agent" ? "agent.manage" : "skill.manage";
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          permission,
          options.now,
        );
        const table =
          options.subjectKind === "agent"
            ? "agent_definition"
            : "skill_definition";
        const managementSelection =
          options.subjectKind === "agent"
            ? ", management_kind AS managementKind"
            : ", 'workspace' AS managementKind";
        const [rows] = await connection.execute<
          (RowDataPacket & {
            readonly managementKind: AgentManagementKind;
            readonly ownerPrincipalId: string;
            readonly version: number;
            readonly visibility: AgentHubVisibility;
          })[]
        >(
          `SELECT owner_principal_id AS ownerPrincipalId, version, visibility
                  ${managementSelection}
             FROM ${table}
            WHERE workspace_id = ? AND id = ? AND lifecycle_status = 'active'
            LIMIT 1
            FOR UPDATE`,
          [options.authority.workspaceId, options.subjectId],
        );
        const current = rows[0];
        if (!current) {
          fail("agent_hub.not_found", "This item is unavailable.");
        }
        if (
          options.subjectKind === "agent" &&
          current.managementKind === "system"
        ) {
          fail(
            "agent_hub.system_managed",
            "The built-in default Agent is managed by the system.",
          );
        }
        if (
          current.ownerPrincipalId !== options.authority.principalId &&
          !options.authority.effectivePermissions.includes("workspace.manage")
        ) {
          fail(
            "agent_hub.forbidden",
            "Only the owner or a workspace manager can change visibility.",
          );
        }
        if (current.version !== options.expectedVersion) {
          fail(
            "agent_hub.conflict",
            "This item changed. Refresh and try again.",
          );
        }
        if (current.visibility === options.visibility) return;
        if (
          options.subjectKind === "agent" &&
          options.visibility === "workspace"
        ) {
          const [privateSkillBindings] = await connection.execute<
            RowDataPacket[]
          >(
            `SELECT binding.skill_definition_id
               FROM agent_profile_revision AS profile
               INNER JOIN agent_profile_activation AS activation
                 ON activation.workspace_id = profile.workspace_id
                AND activation.profile_revision_id = profile.id
                AND activation.runtime_status = 'enabled'
               INNER JOIN agent_revision_skill_binding AS binding
                 ON binding.workspace_id = profile.workspace_id
                AND binding.profile_revision_id = profile.id
               INNER JOIN skill_definition AS skill
                 ON skill.workspace_id = binding.workspace_id
                AND skill.id = binding.skill_definition_id
              WHERE profile.workspace_id = ?
                AND profile.agent_definition_id = ?
                AND profile.lifecycle_status = 'published'
                AND skill.visibility = 'private'
                AND NOT EXISTS (
                  SELECT 1
                    FROM agent_profile_revision AS newer_profile
                    INNER JOIN agent_profile_activation AS newer_activation
                      ON newer_activation.workspace_id = newer_profile.workspace_id
                     AND newer_activation.profile_revision_id = newer_profile.id
                     AND newer_activation.runtime_status = 'enabled'
                   WHERE newer_profile.workspace_id = profile.workspace_id
                     AND newer_profile.agent_definition_id = profile.agent_definition_id
                     AND newer_profile.lifecycle_status = 'published'
                     AND (newer_profile.revision > profile.revision
                       OR (newer_profile.revision = profile.revision
                         AND newer_profile.id > profile.id))
                )
              LIMIT 1 FOR SHARE`,
            [options.authority.workspaceId, options.subjectId],
          );
          if (privateSkillBindings[0]) {
            fail(
              "agent_hub.skill_workspace_visibility_required",
              "A Workspace-visible Agent can only bind Workspace-visible Skills.",
            );
          }
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE ${table}
              SET visibility = ?, version = version + 1,
                  updated_by_principal_id = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.visibility,
            options.authority.principalId,
            options.now,
            options.authority.workspaceId,
            options.subjectId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "agent_hub.conflict",
            "This item changed. Refresh and try again.",
          );
        }
      });
    },
  });
}
