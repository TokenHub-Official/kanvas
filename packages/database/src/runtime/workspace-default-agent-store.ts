import {
  agentManagementIdentityForProfileV1,
  authorizationModelVersion,
  defaultAgentWorkspaceProfileV1,
  type AgentFoundationPackProfileV1,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { ulid } from "ulid";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const defaultSummary = "General-purpose creative Agent";

interface WorkspaceRow extends RowDataPacket {
  readonly organizationId: string;
}

interface OwnerRow extends RowDataPacket {
  readonly principalId: string;
}

interface DefinitionRow extends RowDataPacket {
  readonly id: string;
  readonly agentKey: string;
  readonly managementKind: "system" | "workspace";
  readonly systemKey: string | null;
  readonly ownerPrincipalId: string;
}

interface ProfileRow extends RowDataPacket {
  readonly id: string;
  readonly agentDefinitionId: string;
}

interface ActivationRow extends RowDataPacket {
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
}

interface SurfaceBindingRow extends RowDataPacket {
  readonly profileRevisionId: string;
}

export interface WorkspaceDefaultAgentRecord {
  readonly agentDefinitionId: string;
  readonly profileRevisionId?: string;
  readonly changed: boolean;
  readonly surfaceBound: boolean;
}

export type WorkspaceDefaultAgentStoreErrorCode =
  | "workspace_default_agent.invalid_argument"
  | "workspace_default_agent.workspace_missing"
  | "workspace_default_agent.owner_missing"
  | "workspace_default_agent.identity_conflict";

export class WorkspaceDefaultAgentStoreError extends Error {
  public constructor(
    public readonly code: WorkspaceDefaultAgentStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceDefaultAgentStoreError";
  }
}

function fail(
  code: WorkspaceDefaultAgentStoreErrorCode,
  message: string,
): never {
  throw new WorkspaceDefaultAgentStoreError(code, message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    fail(
      "workspace_default_agent.invalid_argument",
      `${label} must be a canonical uppercase ULID.`,
    );
  }
}

function assertDate(value: unknown): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail(
      "workspace_default_agent.invalid_argument",
      "now must be a valid Date.",
    );
  }
}

async function requireWorkspace(
  connection: PoolConnection,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const [rows] = await connection.execute<WorkspaceRow[]>(
    `SELECT organization_id AS organizationId
       FROM workspace
      WHERE id = ? AND status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [workspaceId],
  );
  const workspace = rows[0];
  if (!workspace) {
    return fail(
      "workspace_default_agent.workspace_missing",
      "The active Workspace is unavailable.",
    );
  }
  return workspace;
}

async function resolveOwnerPrincipalId(
  connection: PoolConnection,
  workspaceId: string,
  explicitOwnerPrincipalId: string | undefined,
): Promise<string> {
  if (explicitOwnerPrincipalId) {
    assertId(explicitOwnerPrincipalId, "ownerPrincipalId");
    return explicitOwnerPrincipalId;
  }
  const [rows] = await connection.execute<OwnerRow[]>(
    `SELECT membership.principal_id AS principalId
       FROM workspace_membership AS membership
       INNER JOIN principal
         ON principal.id = membership.principal_id
        AND principal.principal_type = 'human'
        AND principal.status = 'active'
       INNER JOIN human_principal AS human
         ON human.principal_id = principal.id
      WHERE membership.workspace_id = ?
        AND membership.role = 'owner'
        AND membership.status = 'active'
      ORDER BY membership.created_at, membership.id
      LIMIT 1
      FOR SHARE`,
    [workspaceId],
  );
  const owner = rows[0];
  if (!owner) {
    return fail(
      "workspace_default_agent.owner_missing",
      "The Workspace has no active human owner for the system Agent identity.",
    );
  }
  return owner.principalId;
}

export async function ensureWorkspaceAgentProfileInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly ownerPrincipalId?: string;
    readonly profile: AgentFoundationPackProfileV1;
    readonly now: Date;
    readonly nextId?: () => string;
  },
): Promise<WorkspaceDefaultAgentRecord> {
  assertId(options.workspaceId, "workspaceId");
  assertDate(options.now);
  const workspace = await requireWorkspace(connection, options.workspaceId);
  const nextId = options.nextId ?? ulid;
  const management = agentManagementIdentityForProfileV1(
    options.profile.profileKey,
  );
  const [definitionRows] = await connection.execute<DefinitionRow[]>(
    `SELECT id, agent_key AS agentKey,
            management_kind AS managementKind, system_key AS systemKey,
            owner_principal_id AS ownerPrincipalId
       FROM agent_definition
      WHERE workspace_id = ?
        AND (agent_key = ? OR (? IS NOT NULL AND system_key = ?))
      ORDER BY id
      LIMIT 2
      FOR UPDATE`,
    [
      options.workspaceId,
      options.profile.profileKey,
      management.systemKey ?? null,
      management.systemKey ?? null,
    ],
  );
  if (definitionRows.length > 1) {
    return fail(
      "workspace_default_agent.identity_conflict",
      "The Workspace Agent identity is ambiguous.",
    );
  }

  let definition = definitionRows[0];
  if (definition) {
    if (
      definition.agentKey !== options.profile.profileKey ||
      definition.managementKind !== management.managementKind ||
      definition.systemKey !== (management.systemKey ?? null)
    ) {
      return fail(
        "workspace_default_agent.identity_conflict",
        "The stored Workspace Agent identity conflicts with the system Profile.",
      );
    }
    const [existingProfiles] = await connection.execute<ProfileRow[]>(
      `SELECT id, agent_definition_id AS agentDefinitionId
         FROM agent_profile_revision
        WHERE workspace_id = ? AND agent_definition_id = ?
        ORDER BY revision DESC, id DESC
        LIMIT 1
        FOR SHARE`,
      [options.workspaceId, definition.id],
    );
    const [existingBindings] = await connection.execute<SurfaceBindingRow[]>(
      `SELECT profile_revision_id AS profileRevisionId
           FROM agent_surface_profile_binding
          WHERE workspace_id = ? AND surface_kind = 'agent_workspace'
          LIMIT 1
          FOR SHARE`,
      [options.workspaceId],
    );
    return Object.freeze({
      agentDefinitionId: definition.id,
      ...(existingProfiles[0]
        ? { profileRevisionId: existingProfiles[0].id }
        : {}),
      changed: false,
      surfaceBound: Boolean(existingBindings[0]),
    });
  } else {
    const ownerPrincipalId = await resolveOwnerPrincipalId(
      connection,
      options.workspaceId,
      options.ownerPrincipalId,
    );
    const agentDefinitionId = nextId();
    assertId(agentDefinitionId, "agentDefinitionId");
    await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_definition (
         id, workspace_id, agent_key, management_kind, system_key,
         owner_principal_id, visibility, lifecycle_status,
         creation_request_key, creation_request_hash, version,
         created_by_principal_id, updated_by_principal_id,
         created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'workspace', 'active', ?, ?, 1, ?, ?, ?, ?, NULL)`,
      [
        agentDefinitionId,
        options.workspaceId,
        options.profile.profileKey,
        management.managementKind,
        management.systemKey ?? null,
        ownerPrincipalId,
        `initial-agent:${options.profile.profileKey}`,
        digestProviderValue({
          workspaceId: options.workspaceId,
          profileKey: options.profile.profileKey,
        }),
        ownerPrincipalId,
        ownerPrincipalId,
        options.now,
        options.now,
      ],
    );
    definition = {
      id: agentDefinitionId,
      agentKey: options.profile.profileKey,
      managementKind: management.managementKind,
      systemKey: management.systemKey ?? null,
      ownerPrincipalId,
    } as DefinitionRow;
  }

  const [presentationRows] = await connection.execute<RowDataPacket[]>(
    `SELECT agent_definition_id
       FROM agent_presentation
      WHERE workspace_id = ? AND agent_definition_id = ?
      LIMIT 1
      FOR UPDATE`,
    [options.workspaceId, definition.id],
  );
  if (!presentationRows[0]) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_presentation (
         workspace_id, agent_definition_id, display_name, summary,
         cover_asset_id, category, tags, version,
         updated_by_principal_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, CAST(? AS JSON), 1, ?, ?, ?)`,
      [
        options.workspaceId,
        definition.id,
        options.profile.manifest.displayName,
        defaultSummary,
        JSON.stringify([]),
        definition.ownerPrincipalId,
        options.now,
        options.now,
      ],
    );
  }

  const [profileRows] = await connection.execute<ProfileRow[]>(
    `SELECT id, agent_definition_id AS agentDefinitionId
       FROM agent_profile_revision
      WHERE workspace_id = ? AND profile_key = ? AND revision = ?
      LIMIT 1
      FOR UPDATE`,
    [options.workspaceId, options.profile.profileKey, options.profile.revision],
  );
  let profile = profileRows[0];
  if (profile && profile.agentDefinitionId !== definition.id) {
    return fail(
      "workspace_default_agent.identity_conflict",
      "The stored Workspace Agent Profile belongs to another Agent.",
    );
  }
  if (!profile) {
    const profileRevisionId = nextId();
    assertId(profileRevisionId, "profileRevisionId");
    await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_profile_revision (
         id, workspace_id, agent_definition_id, profile_key, revision,
         lifecycle_status, schema_version, manifest_document,
         canonical_digest, created_by_principal_id,
         published_by_principal_id, created_at, published_at
       ) VALUES (?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?, ?, ?)`,
      [
        profileRevisionId,
        options.workspaceId,
        definition.id,
        options.profile.profileKey,
        options.profile.revision,
        JSON.stringify(options.profile.manifest),
        digestProviderValue(options.profile.manifest),
        definition.ownerPrincipalId,
        definition.ownerPrincipalId,
        options.now,
        options.now,
      ],
    );
    profile = {
      id: profileRevisionId,
      agentDefinitionId: definition.id,
    } as ProfileRow;
  }

  const [activationRows] = await connection.execute<ActivationRow[]>(
    `SELECT runtime_status AS runtimeStatus
       FROM agent_profile_activation
      WHERE workspace_id = ? AND profile_revision_id = ?
      LIMIT 1
      FOR UPDATE`,
    [options.workspaceId, profile.id],
  );
  let activation = activationRows[0];
  if (!activation) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_profile_activation (
         workspace_id, profile_revision_id, runtime_status, reason_code,
         version, updated_by_principal_id, updated_at
       ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
      [
        options.workspaceId,
        profile.id,
        definition.ownerPrincipalId,
        options.now,
      ],
    );
    activation = { runtimeStatus: "enabled" } as ActivationRow;
  }

  let surfaceBound = false;
  if (activation.runtimeStatus === "enabled") {
    for (const surfaceKind of options.profile.surfaceBindings) {
      const [bindingRows] = await connection.execute<SurfaceBindingRow[]>(
        `SELECT profile_revision_id AS profileRevisionId
           FROM agent_surface_profile_binding
          WHERE workspace_id = ? AND surface_kind = ?
          LIMIT 1
          FOR UPDATE`,
        [options.workspaceId, surfaceKind],
      );
      if (!bindingRows[0]) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_surface_profile_binding (
             workspace_id, surface_kind, profile_revision_id, version,
             updated_by_principal_id, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?)`,
          [
            options.workspaceId,
            surfaceKind,
            profile.id,
            definition.ownerPrincipalId,
            options.now,
          ],
        );
        surfaceBound = true;
      } else if (bindingRows[0].profileRevisionId === profile.id) {
        surfaceBound = true;
      }
    }
  }

  const auditEventId = nextId();
  assertId(auditEventId, "auditEventId");
  await appendAuditEventInTransaction(connection, {
    id: auditEventId,
    schemaVersion: auditEventSchemaVersion,
    organizationId: workspace.organizationId,
    workspaceId: options.workspaceId,
    actorPrincipalId: null,
    actorType: "system",
    authenticationRefType: "none",
    authenticationRefHash: null,
    authorityType: "system",
    authorityId: null,
    authorityVersion: null,
    authorizationModelVersion,
    authorizationDecision: Object.freeze({
      action: "workspace.default_agent.initialize",
      outcome: "succeeded",
      reasonCode: "workspace.system_default_missing",
    }),
    eventType: "workspace.default_agent.initialized",
    action: "workspace.default_agent.initialize",
    resourceType: "agent_definition",
    resourceId: definition.id,
    outcome: "succeeded",
    decisionReasonCode: "workspace.system_default_missing",
    severity: "info",
    requestId: null,
    traceId: null,
    details: Object.freeze({
      profileKey: options.profile.profileKey,
      profileRevision: options.profile.revision,
      surfaceBound,
    }),
    occurredAt: options.now,
    recordedAt: options.now,
  });

  return Object.freeze({
    agentDefinitionId: definition.id,
    profileRevisionId: profile.id,
    changed: true,
    surfaceBound,
  });
}

export function ensureWorkspaceDefaultAgentInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly ownerPrincipalId?: string;
    readonly now: Date;
    readonly nextId?: () => string;
  },
): Promise<WorkspaceDefaultAgentRecord> {
  return ensureWorkspaceAgentProfileInTransaction(connection, {
    ...options,
    profile: defaultAgentWorkspaceProfileV1,
  });
}

export interface WorkspaceDefaultAgentStore {
  ensure(options: {
    readonly workspaceId: string;
    readonly now: Date;
  }): Promise<WorkspaceDefaultAgentRecord>;
}

export function createWorkspaceDefaultAgentStore(
  pool: Pool,
  options: { readonly nextId?: () => string } = {},
): WorkspaceDefaultAgentStore {
  return Object.freeze({
    async ensure(request: Parameters<WorkspaceDefaultAgentStore["ensure"]>[0]) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await ensureWorkspaceDefaultAgentInTransaction(
          connection,
          {
            ...request,
            ...(options.nextId ? { nextId: options.nextId } : {}),
          },
        );
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  });
}
