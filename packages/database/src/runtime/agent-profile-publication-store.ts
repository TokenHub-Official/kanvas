import type {
  AgentFoundationPackProfileV1,
  AgentManagementKind,
  AgentReasoningLevel,
  AgentProfileRevisionRecord,
  AgentWebSearchMode,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  agentManagementIdentityForProfileV1,
  parseAgentProfileManifestV1,
  parseModelProfileDocumentV1,
  parseTextGenerationModelProfile,
  parseProviderPricingDocumentV1,
} from "@kanvas/application";
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
import type { AgentHubAvatar } from "./agent-hub-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { ensureWorkspaceDefaultAgentInTransaction } from "./workspace-default-agent-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export interface PublishAgentProfileOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentDefinitionId: string;
  readonly profileRevisionId: string;
  readonly managementKind: AgentManagementKind;
  readonly expectedAgentVersion?: number;
  readonly creationRequestHash?: string;
  readonly profile: AgentFoundationPackProfileV1;
  readonly visibility?: "private" | "workspace";
  readonly presentation?: {
    readonly displayName: string;
    readonly summary: string;

    readonly avatar?: AgentHubAvatar;
    readonly coverAssetId?: string;
    readonly category?: string;
    readonly tags: readonly string[];
  };
  readonly boundSkillDefinitionIds?: readonly string[];
  readonly boundBrandKitIds?: readonly string[];
  readonly boundLibraryIds?: readonly string[];
  readonly boundWorkflowDefinitionIds?: readonly string[];
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface AgentModelSettingOption {
  readonly id: string;
  readonly modelName: string;
  readonly ready: boolean;
  readonly unavailableReasons?: readonly string[];
  readonly bindingKeys: readonly string[];
}

export interface AgentModelSettingsRecord {
  readonly profileRevisionId: string;
  readonly profileRevision: number;
  readonly version: number;
  readonly currentDefaultModelId?: string;
  readonly currentFastModelId?: string;
  readonly reasoningLevel: AgentReasoningLevel;
  readonly webSearchMode: AgentWebSearchMode;
  readonly actionConfirmationRequired: boolean;
  readonly options: readonly AgentModelSettingOption[];
}

export interface SetAgentModelSettingsOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly expectedVersion: number;
  readonly defaultModelId: string;
  readonly fastModelId: string;
  readonly reasoningLevel: AgentReasoningLevel;
  readonly webSearchMode: AgentWebSearchMode;
  readonly actionConfirmationRequired: boolean;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface AgentProfilePublicationStore {
  readonly publish: (
    options: PublishAgentProfileOptions,
  ) => Promise<AgentProfileRevisionRecord>;
  readonly getModelSettings: (
    authority: TrustedWorkspaceScope,
    now: Date,
  ) => Promise<AgentModelSettingsRecord>;
  readonly setModelSettings: (
    options: SetAgentModelSettingsOptions,
  ) => Promise<AgentModelSettingsRecord>;
}

interface ProfileRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentDefinitionId: string;
  readonly revision: number;
  readonly lifecycleStatus: string;
  readonly manifestDocument: unknown;
  readonly canonicalDigest: string;
  readonly activationStatus: string | null;
}

interface AgentDefinitionRow extends RowDataPacket {
  readonly id: string;
  readonly managementKind: AgentManagementKind;
  readonly systemKey: string | null;
  readonly ownerPrincipalId: string;
  readonly lifecycleStatus: string;
  readonly creationRequestHash: string;
  readonly version: number;
}

interface BindingRow extends RowDataPacket {
  readonly profileRevisionId: string;
  readonly version: number;
}

interface BoundSkillDefinitionRow extends RowDataPacket {
  readonly visibility: "private" | "workspace";
  readonly ownerPrincipalId: string;
  readonly lifecycleStatus: string;
  readonly usageStatus: string;
}

function validAgentAvatar(avatar: AgentHubAvatar | undefined): boolean {
  if (!avatar) return true;
  if (avatar.kind === "image") return idPattern.test(avatar.assetId);
  return (
    avatar.value.length >= 1 &&
    avatar.value.length <= 32 &&
    /^#[0-9A-Fa-f]{6}$/u.test(avatar.backgroundColor) &&
    (avatar.kind !== "icon" ||
      avatar.foregroundColor === undefined ||
      /^#[0-9A-Fa-f]{6}$/u.test(avatar.foregroundColor)) &&
    (avatar.kind === "emoji" ||
      [
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
      ].includes(avatar.value))
  );
}

async function assertAvatarAssetAvailable(
  connection: PoolConnection,
  options: PublishAgentProfileOptions,
): Promise<void> {
  if (options.presentation?.avatar?.kind !== "image") return;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT asset.id
       FROM asset
       INNER JOIN artifact
         ON artifact.workspace_id = asset.workspace_id
        AND artifact.id = asset.current_artifact_id
       INNER JOIN stored_object object_fact
         ON object_fact.workspace_id = artifact.workspace_id
        AND object_fact.id = artifact.stored_object_id
        AND object_fact.delete_state = 'active'
      WHERE asset.workspace_id = ? AND asset.id = ?
        AND asset.lifecycle_status = 'active'
        AND artifact.availability_status = 'available'
        AND object_fact.media_type IN ('image/jpeg', 'image/png', 'image/webp')
      LIMIT 1 FOR SHARE`,
    [options.authority.workspaceId, options.presentation.avatar.assetId],
  );
  if (!rows[0]) {
    return fail(
      "agent_profile_publication.avatar_unavailable",
      "The selected Agent avatar is unavailable.",
    );
  }
}

interface CurrentProfileFacts {
  readonly id: string;
  readonly profileKey: string;
  readonly revision: number;
  readonly manifestDocument: unknown;
  readonly canonicalDigest: string;
  readonly bindingVersion: number;
}

type CurrentProfileRow = RowDataPacket & CurrentProfileFacts;

interface ModelBindingOptionRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalModelId: string | null;
  readonly bindingKey: string;
  readonly bindingStatus: string;
  readonly profileDocument: unknown;
  readonly profileStatus: string;
  readonly deploymentStatus: string;
  readonly endpointStatus: string;
  readonly endpointValidation: string;
  readonly credentialStatus: string;
  readonly activeSecretVersionId: string | null;
  readonly secretStatus: string | null;
  readonly pricingStatus: string;
  readonly pricingDocument: unknown;
  readonly pricingVerifiedAt: Date;
  readonly pricingEffectiveAt: Date;
  readonly budgetStatus: string;
  readonly budgetPeriodStartAt: Date;
  readonly budgetPeriodEndAt: Date;
}

interface AgentModelSettingsFacts {
  readonly defaultModelId: string;
  readonly fastModelId: string;
  readonly reasoningLevel: AgentReasoningLevel;
  readonly webSearchMode: AgentWebSearchMode;
  readonly actionConfirmationRequired: boolean | number;
  readonly version: number;
}

type AgentModelSettingsRow = RowDataPacket & AgentModelSettingsFacts;

export class AgentProfilePublicationStoreError extends Error {
  public constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentProfilePublicationStoreError";
  }
}

function fail(code: string, message: string): never {
  throw new AgentProfilePublicationStoreError(code, message);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value) as unknown);
    } catch {
      return fail(
        "agent_profile_publication.integrity",
        "Stored Agent Profile manifest is invalid JSON.",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "agent_profile_publication.integrity",
      "Stored Agent Profile manifest is invalid.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
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

async function readProfile(
  connection: PoolConnection,
  workspaceId: string,
  profileKey: string,
  revision: number,
): Promise<ProfileRow | undefined> {
  const [rows] = await connection.execute<ProfileRow[]>(
    `SELECT
       profile.id,
       profile.workspace_id AS workspaceId,
       profile.agent_definition_id AS agentDefinitionId,
       profile.revision,
       profile.lifecycle_status AS lifecycleStatus,
       profile.manifest_document AS manifestDocument,
       profile.canonical_digest AS canonicalDigest,
       activation.runtime_status AS activationStatus
     FROM agent_profile_revision AS profile
     LEFT JOIN agent_profile_activation AS activation
       ON activation.workspace_id = profile.workspace_id
      AND activation.profile_revision_id = profile.id
     WHERE profile.workspace_id = ?
       AND profile.profile_key = ?
       AND profile.revision = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, profileKey, revision],
  );
  return rows[0];
}

async function ensureAgentDefinition(
  connection: PoolConnection,
  options: PublishAgentProfileOptions,
): Promise<string> {
  const [rows] = await connection.execute<AgentDefinitionRow[]>(
    `SELECT id, management_kind AS managementKind, system_key AS systemKey,
            owner_principal_id AS ownerPrincipalId,
            lifecycle_status AS lifecycleStatus,
            creation_request_hash AS creationRequestHash, version
     FROM agent_definition
     WHERE workspace_id = ? AND agent_key = ?
     LIMIT 1
     FOR UPDATE`,
    [options.authority.workspaceId, options.profile.profileKey],
  );
  const expectedRequestHash =
    options.creationRequestHash ??
    digestProviderValue({
      workspaceId: options.authority.workspaceId,
      profileKey: options.profile.profileKey,
    });
  const existing = rows[0];
  const managementIdentity = agentManagementIdentityForProfileV1(
    options.profile.profileKey,
  );
  if (managementIdentity.managementKind !== options.managementKind) {
    return fail(
      "agent_profile_publication.management_conflict",
      "Agent management identity does not match the registered Profile.",
    );
  }
  if (existing) {
    if (
      existing.managementKind !== managementIdentity.managementKind ||
      existing.systemKey !== (managementIdentity.systemKey ?? null)
    ) {
      return fail(
        "agent_profile_publication.management_conflict",
        "Stored Agent management identity conflicts with the registered Profile.",
      );
    }
    if (existing.lifecycleStatus !== "active") {
      return fail(
        "agent_profile_publication.agent_archived",
        "The Agent is archived and cannot be published.",
      );
    }
    if (
      options.creationRequestHash &&
      existing.creationRequestHash !== expectedRequestHash
    ) {
      return fail(
        "agent_profile_publication.identity_conflict",
        "This Agent creation request was reused with different input.",
      );
    }
    if (options.expectedAgentVersion !== undefined) {
      if (existing.managementKind === "system") {
        return fail(
          "agent_profile_publication.system_managed",
          "The built-in default Agent is managed by the system.",
        );
      }
      if (
        existing.id !== options.agentDefinitionId ||
        !options.presentation ||
        !options.visibility
      ) {
        return fail(
          "agent_profile_publication.invalid",
          "Agent update does not match the published identity.",
        );
      }
      if (
        existing.ownerPrincipalId !== options.authority.principalId &&
        !options.authority.effectivePermissions.includes("workspace.manage")
      ) {
        return fail(
          "agent_profile_publication.forbidden",
          "Only the Agent owner or a workspace manager can update it.",
        );
      }
      if (existing.version !== options.expectedAgentVersion) {
        return fail(
          "agent_profile_publication.conflict",
          "This Agent changed. Refresh and try again.",
        );
      }
      const [updatedDefinition] = await connection.execute<ResultSetHeader>(
        `UPDATE agent_definition
            SET visibility = ?, version = version + 1,
                updated_by_principal_id = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ? AND version = ?`,
        [
          options.visibility,
          options.authority.principalId,
          options.now,
          options.authority.workspaceId,
          existing.id,
          options.expectedAgentVersion,
        ],
      );
      if (updatedDefinition.affectedRows !== 1) {
        return fail(
          "agent_profile_publication.conflict",
          "This Agent changed. Refresh and try again.",
        );
      }
      const [updatedPresentation] = await connection.execute<ResultSetHeader>(
        `UPDATE agent_presentation
            SET display_name = ?, summary = ?,
                avatar = CAST(? AS JSON), cover_asset_id = ?, category = ?,
                tags = CAST(? AS JSON),
                version = version + 1, updated_by_principal_id = ?,
                updated_at = ?
          WHERE workspace_id = ? AND agent_definition_id = ?`,
        [
          options.presentation.displayName,
          options.presentation.summary,

          options.presentation.avatar
            ? JSON.stringify(options.presentation.avatar)
            : null,
          options.presentation.coverAssetId ?? null,
          options.presentation.category ?? null,
          JSON.stringify(options.presentation.tags),
          options.authority.principalId,
          options.now,
          options.authority.workspaceId,
          existing.id,
        ],
      );
      if (updatedPresentation.affectedRows !== 1) {
        return fail(
          "agent_profile_publication.integrity",
          "The Agent presentation is unavailable.",
        );
      }
    }
    return existing.id;
  }
  if (options.expectedAgentVersion !== undefined) {
    return fail(
      "agent_profile_publication.not_found",
      "This Agent is unavailable.",
    );
  }
  const creationRequestKey = `agent-profile:${options.profile.profileKey}`;
  const presentation = options.presentation ?? {
    displayName: options.profile.manifest.displayName,
    summary: "General-purpose creative Agent",

    tags: [],
  };
  await connection.execute(
    `INSERT INTO agent_definition (
       id, workspace_id, agent_key, management_kind, system_key,
       owner_principal_id, visibility,
       lifecycle_status, creation_request_key, creation_request_hash,
       version, created_by_principal_id, updated_by_principal_id,
       created_at, updated_at, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?, NULL)`,
    [
      options.agentDefinitionId,
      options.authority.workspaceId,
      options.profile.profileKey,
      managementIdentity.managementKind,
      managementIdentity.systemKey ?? null,
      options.authority.principalId,
      managementIdentity.managementKind === "system"
        ? "workspace"
        : (options.visibility ?? "workspace"),
      creationRequestKey,
      expectedRequestHash,
      options.authority.principalId,
      options.authority.principalId,
      options.now,
      options.now,
    ],
  );
  await connection.execute(
    `INSERT INTO agent_presentation (
       workspace_id, agent_definition_id, display_name, summary,
       avatar, cover_asset_id, category, tags, version,
       updated_by_principal_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, CAST(? AS JSON), 1, ?, ?, ?)`,
    [
      options.authority.workspaceId,
      options.agentDefinitionId,
      presentation.displayName,
      presentation.summary,

      presentation.avatar ? JSON.stringify(presentation.avatar) : null,
      presentation.coverAssetId ?? null,
      presentation.category ?? null,
      JSON.stringify(presentation.tags),
      options.authority.principalId,
      options.now,
      options.now,
    ],
  );
  return options.agentDefinitionId;
}

async function bindAgentResources(
  connection: PoolConnection,
  options: PublishAgentProfileOptions,
  profileRevisionId: string,
): Promise<void> {
  const agentVisibility =
    options.managementKind === "system"
      ? "workspace"
      : (options.visibility ?? "workspace");
  for (const [ordinal, skillDefinitionId] of (
    options.boundSkillDefinitionIds ?? []
  ).entries()) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_revision_skill_binding (
         workspace_id, profile_revision_id, skill_definition_id,
         ordinal, created_at
       )
       SELECT ?, ?, definition.id, ?, ?
         FROM skill_definition AS definition
        WHERE definition.workspace_id = ? AND definition.id = ?
          AND definition.lifecycle_status = 'active' AND definition.usage_status = 'enabled'
          AND (definition.visibility = 'workspace'
            OR (? = 'private' AND definition.owner_principal_id = ?))
          AND EXISTS (
            SELECT 1
              FROM skill_revision AS current_skill
              INNER JOIN skill_revision_activation AS current_activation
                ON current_activation.workspace_id = current_skill.workspace_id
               AND current_activation.skill_revision_id = current_skill.id
             WHERE current_skill.workspace_id = definition.workspace_id
               AND current_skill.skill_definition_id = definition.id
               AND current_skill.lifecycle_status = 'published'
               AND current_activation.runtime_status = 'enabled'
               AND NOT EXISTS (
                 SELECT 1
                   FROM skill_revision AS newer_skill
                  WHERE newer_skill.workspace_id = current_skill.workspace_id
                    AND newer_skill.skill_definition_id = current_skill.skill_definition_id
                    AND newer_skill.lifecycle_status = 'published'
                    AND (newer_skill.revision > current_skill.revision
                      OR (newer_skill.revision = current_skill.revision
                        AND newer_skill.id > current_skill.id))
               )
          )`,
      [
        options.authority.workspaceId,
        profileRevisionId,
        ordinal,
        options.now,
        options.authority.workspaceId,
        skillDefinitionId,
        agentVisibility,
        options.authority.principalId,
      ],
    );
    if (inserted.affectedRows !== 1) {
      const [skillRows] = await connection.execute<BoundSkillDefinitionRow[]>(
        `SELECT visibility, owner_principal_id AS ownerPrincipalId,
                lifecycle_status AS lifecycleStatus,
                usage_status AS usageStatus
           FROM skill_definition
          WHERE workspace_id = ? AND id = ?
          LIMIT 1 FOR SHARE`,
        [options.authority.workspaceId, skillDefinitionId],
      );
      if (
        agentVisibility === "workspace" &&
        skillRows[0]?.visibility === "private"
      ) {
        return fail(
          "agent_profile_publication.skill_workspace_visibility_required",
          "A Workspace-visible Agent can only bind Workspace-visible Skills.",
        );
      }
      return fail(
        "agent_profile_publication.skill_unavailable",
        "A selected Skill is unavailable.",
      );
    }
  }
  for (const [ordinal, brandKitId] of (
    options.boundBrandKitIds ?? []
  ).entries()) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_revision_brand_binding (
         workspace_id, profile_revision_id, brand_kit_id, ordinal, created_at
       )
       SELECT ?, ?, brand.id, ?, ?
         FROM brand_kit AS brand
        WHERE brand.workspace_id = ? AND brand.id = ?
          AND brand.lifecycle_status = 'active'`,
      [
        options.authority.workspaceId,
        profileRevisionId,
        ordinal,
        options.now,
        options.authority.workspaceId,
        brandKitId,
      ],
    );
    if (inserted.affectedRows !== 1) {
      return fail(
        "agent_profile_publication.brand_unavailable",
        "A selected Brand is unavailable.",
      );
    }
  }
  if ((options.boundLibraryIds?.length ?? 0) > 0) {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "library.read",
      options.now,
    );
  }
  for (const [ordinal, libraryId] of (
    options.boundLibraryIds ?? []
  ).entries()) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_revision_library_binding (
         workspace_id, profile_revision_id, library_id, ordinal, created_at
       )
       SELECT ?, ?, library.id, ?, ?
         FROM resource_library AS library
        WHERE library.workspace_id = ? AND library.id = ?
          AND library.lifecycle_status = 'active'`,
      [
        options.authority.workspaceId,
        profileRevisionId,
        ordinal,
        options.now,
        options.authority.workspaceId,
        libraryId,
      ],
    );
    if (inserted.affectedRows !== 1) {
      return fail(
        "agent_profile_publication.library_unavailable",
        "A selected Resource Library is unavailable.",
      );
    }
  }
  for (const [ordinal, workflowDefinitionId] of (
    options.boundWorkflowDefinitionIds ?? []
  ).entries()) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO agent_revision_workflow_binding (
         workspace_id, profile_revision_id, workflow_definition_id,
         ordinal, created_at
       )
       SELECT ?, ?, workflow.id, ?, ?
         FROM workflow_definition AS workflow
        WHERE workflow.workspace_id = ? AND workflow.id = ?
          AND workflow.lifecycle_status = 'active'`,
      [
        options.authority.workspaceId,
        profileRevisionId,
        ordinal,
        options.now,
        options.authority.workspaceId,
        workflowDefinitionId,
      ],
    );
    if (inserted.affectedRows !== 1) {
      return fail(
        "agent_profile_publication.workflow_unavailable",
        "A selected Workflow is unavailable.",
      );
    }
  }
}

async function bindSurface(
  connection: PoolConnection,
  options: PublishAgentProfileOptions,
  profileRevisionId: string,
  surfaceKind: string,
): Promise<void> {
  const [rows] = await connection.execute<BindingRow[]>(
    `SELECT profile_revision_id AS profileRevisionId, version
     FROM agent_surface_profile_binding
     WHERE workspace_id = ? AND surface_kind = ?
     LIMIT 1
     FOR UPDATE`,
    [options.authority.workspaceId, surfaceKind],
  );
  const current = rows[0];
  if (!current) {
    await connection.execute(
      `INSERT INTO agent_surface_profile_binding (
         workspace_id, surface_kind, profile_revision_id, version,
         updated_by_principal_id, updated_at
       ) VALUES (?, ?, ?, 1, ?, ?)`,
      [
        options.authority.workspaceId,
        surfaceKind,
        profileRevisionId,
        options.authority.principalId,
        options.now,
      ],
    );
    return;
  }
  if (current.profileRevisionId === profileRevisionId) return;
  await connection.execute(
    `UPDATE agent_surface_profile_binding
     SET profile_revision_id = ?, version = version + 1,
         updated_by_principal_id = ?, updated_at = ?
     WHERE workspace_id = ? AND surface_kind = ? AND version = ?`,
    [
      profileRevisionId,
      options.authority.principalId,
      options.now,
      options.authority.workspaceId,
      surfaceKind,
      current.version,
    ],
  );
}

async function readCurrentProfile(
  connection: PoolConnection,
  workspaceId: string,
  lock: boolean,
): Promise<CurrentProfileRow | undefined> {
  const [rows] = await connection.execute<CurrentProfileRow[]>(
    `SELECT
       profile.id,
       profile.profile_key AS profileKey,
       profile.revision,
       profile.manifest_document AS manifestDocument,
       profile.canonical_digest AS canonicalDigest,
       binding.version AS bindingVersion
     FROM agent_surface_profile_binding AS binding
     INNER JOIN agent_profile_revision AS profile
       ON profile.workspace_id = binding.workspace_id
      AND profile.id = binding.profile_revision_id
     INNER JOIN agent_profile_activation AS activation
       ON activation.workspace_id = profile.workspace_id
      AND activation.profile_revision_id = profile.id
     WHERE binding.workspace_id = ?
       AND binding.surface_kind = 'agent_workspace'
       AND profile.lifecycle_status = 'published'
       AND activation.runtime_status = 'enabled'
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId],
  );
  return rows[0];
}

async function requireCurrentProfile(
  connection: PoolConnection,
  workspaceId: string,
  lock: boolean,
): Promise<CurrentProfileRow> {
  const current = await readCurrentProfile(connection, workspaceId, lock);
  if (!current) {
    return fail(
      "agent_model_settings.not_configured",
      "Workspace Agent Profile is not configured.",
    );
  }
  return current;
}

async function readModelOptions(
  connection: PoolConnection,
  workspaceId: string,
  now: Date,
): Promise<readonly AgentModelSettingOption[]> {
  const [rows] = await connection.execute<ModelBindingOptionRow[]>(
    `SELECT
       binding.id,
       profile.canonical_model_id AS canonicalModelId,
       binding.binding_key AS bindingKey,
       binding.lifecycle_status AS bindingStatus,
       profile.profile_document AS profileDocument,
       profile.lifecycle_status AS profileStatus,
       deployment.lifecycle_status AS deploymentStatus,
       endpoint.lifecycle_status AS endpointStatus,
       endpoint.validation_status AS endpointValidation,
       credential.lifecycle_status AS credentialStatus,
       credential.active_secret_version_id AS activeSecretVersionId,
       secret.lifecycle_status AS secretStatus,
       pricing.lifecycle_status AS pricingStatus,
       pricing.pricing_document AS pricingDocument,
       pricing.verified_at AS pricingVerifiedAt,
       pricing.effective_at AS pricingEffectiveAt,
       budget.lifecycle_status AS budgetStatus,
       budget.period_start_at AS budgetPeriodStartAt,
       budget.period_end_at AS budgetPeriodEndAt
     FROM agent_model_binding AS binding
     INNER JOIN model_profile_revision AS profile
       ON profile.workspace_id = binding.workspace_id
      AND profile.id = binding.model_profile_revision_id
     INNER JOIN model_deployment AS deployment
       ON deployment.workspace_id = binding.workspace_id
      AND deployment.id = binding.model_deployment_id
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = binding.workspace_id
      AND endpoint.id = binding.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = binding.workspace_id
      AND credential.id = binding.credential_id
     INNER JOIN pricing_revision AS pricing
       ON pricing.workspace_id = binding.workspace_id
      AND pricing.id = binding.pricing_revision_id
     LEFT JOIN secret_version AS secret
       ON secret.workspace_id = credential.workspace_id
      AND secret.credential_id = credential.id
      AND secret.id = credential.active_secret_version_id
     INNER JOIN budget_account AS budget
       ON budget.workspace_id = binding.workspace_id
      AND budget.id = binding.budget_account_id
     WHERE binding.workspace_id = ?
       AND binding.lifecycle_status = 'enabled'
     ORDER BY binding.updated_at DESC, binding.id
     LIMIT 128`,
    [workspaceId],
  );
  const models = new Map<string, AgentModelSettingOption>();
  for (const row of rows) {
    if (!row.canonicalModelId) continue;
    const profileDocument = record(row.profileDocument);
    const profile = parseTextGenerationModelProfile(profileDocument);
    const supportsAgentTools =
      parseModelProfileDocumentV1(profileDocument).model.toolCall === true;
    const pricingReady = (() => {
      try {
        const mode = parseProviderPricingDocumentV1(
          record(row.pricingDocument),
        ).billingMode;
        return ["metered", "fixed"].includes(mode);
      } catch {
        return false;
      }
    })();
    const unavailableReasons: string[] = [];
    if (row.bindingStatus !== "enabled" || row.profileStatus !== "published")
      unavailableReasons.push("profile");
    if (row.deploymentStatus !== "active")
      unavailableReasons.push("deployment");
    if (row.endpointStatus !== "active" || row.endpointValidation !== "passed")
      unavailableReasons.push("endpoint");
    if (
      row.credentialStatus !== "active" ||
      !row.activeSecretVersionId ||
      row.secretStatus !== "active"
    )
      unavailableReasons.push("credential");
    if (
      row.pricingStatus !== "published" ||
      !pricingReady ||
      !(row.pricingVerifiedAt <= now) ||
      !(row.pricingEffectiveAt <= now)
    )
      unavailableReasons.push("pricing");
    if (
      row.budgetStatus !== "active" ||
      !(row.budgetPeriodStartAt <= now) ||
      !(row.budgetPeriodEndAt > now)
    )
      unavailableReasons.push("budget");
    if (!supportsAgentTools) unavailableReasons.push("tool_call");
    const ready = unavailableReasons.length === 0;
    const existing = models.get(row.canonicalModelId);
    let reasons: readonly string[] = unavailableReasons;
    if (existing?.ready || ready) reasons = [];
    else if (
      existing?.unavailableReasons &&
      existing.unavailableReasons.length <= unavailableReasons.length
    )
      reasons = existing.unavailableReasons;
    models.set(
      row.canonicalModelId,
      Object.freeze({
        id: row.canonicalModelId,
        modelName: existing?.modelName ?? profile.displayName,
        ready: Boolean(existing?.ready || ready),
        unavailableReasons: reasons,
        bindingKeys: Object.freeze([
          ...(existing?.bindingKeys ?? []),
          row.bindingKey,
        ]),
      }),
    );
  }
  return Object.freeze([...models.values()]);
}

async function readStoredModelSettings(
  connection: PoolConnection,
  workspaceId: string,
  lock: boolean,
): Promise<AgentModelSettingsRow | undefined> {
  const [rows] = await connection.execute<AgentModelSettingsRow[]>(
    `SELECT
       default_canonical_model_id AS defaultModelId,
       fast_canonical_model_id AS fastModelId,
       reasoning_level AS reasoningLevel,
       web_search_mode AS webSearchMode,
       action_confirmation_required AS actionConfirmationRequired,
       version
     FROM workspace_agent_model_settings
     WHERE workspace_id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId],
  );
  return rows[0];
}

function settingsRecord(
  current: CurrentProfileFacts,
  options: readonly AgentModelSettingOption[],
  stored: AgentModelSettingsFacts | undefined,
): AgentModelSettingsRecord {
  const manifest = parseAgentProfileManifestV1(
    record(current.manifestDocument),
  );
  if (!manifest || digestProviderValue(manifest) !== current.canonicalDigest) {
    return fail(
      "agent_model_settings.integrity",
      "Workspace Agent Profile manifest is invalid.",
    );
  }
  const fallback = options.find((option) =>
    option.bindingKeys.includes(manifest.modelBindingKey),
  );
  return Object.freeze({
    profileRevisionId: current.id,
    profileRevision: current.revision,
    version: stored?.version ?? 1,
    ...((stored?.defaultModelId ?? fallback?.id)
      ? { currentDefaultModelId: stored?.defaultModelId ?? fallback!.id }
      : {}),
    ...((stored?.fastModelId ?? fallback?.id)
      ? { currentFastModelId: stored?.fastModelId ?? fallback!.id }
      : {}),
    reasoningLevel: stored?.reasoningLevel ?? "medium",
    webSearchMode: stored?.webSearchMode ?? "off",
    actionConfirmationRequired: Boolean(
      stored?.actionConfirmationRequired ?? false,
    ),
    options,
  });
}

/** Deployment diagnostics must never create or repair Workspace facts. */
export async function readWorkspaceAgentModelSettings(
  connection: PoolConnection,
  workspaceId: string,
  now: Date,
): Promise<AgentModelSettingsRecord | undefined> {
  const current = await readCurrentProfile(connection, workspaceId, false);
  if (!current) return undefined;
  return settingsRecord(
    current,
    await readModelOptions(connection, workspaceId, now),
    await readStoredModelSettings(connection, workspaceId, false),
  );
}

export function createAgentProfilePublicationStore(
  pool: Pool,
): AgentProfilePublicationStore {
  return Object.freeze({
    getModelSettings(authority: TrustedWorkspaceScope, now: Date) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        let current = await readCurrentProfile(
          connection,
          authority.workspaceId,
          false,
        );
        if (!current) {
          await ensureWorkspaceDefaultAgentInTransaction(connection, {
            workspaceId: authority.workspaceId,
            now,
          });
          current = await requireCurrentProfile(
            connection,
            authority.workspaceId,
            true,
          );
        }
        const [modelOptions, stored] = await Promise.all([
          readModelOptions(connection, authority.workspaceId, now),
          readStoredModelSettings(connection, authority.workspaceId, false),
        ]);
        return settingsRecord(current, modelOptions, stored);
      });
    },

    setModelSettings(options: SetAgentModelSettingsOptions) {
      if (
        !idPattern.test(options.defaultModelId) ||
        !idPattern.test(options.fastModelId) ||
        !["off", "low", "medium", "high"].includes(options.reasoningLevel) ||
        !["off", "auto", "required"].includes(options.webSearchMode) ||
        typeof options.actionConfirmationRequired !== "boolean" ||
        !Number.isSafeInteger(options.expectedVersion) ||
        options.expectedVersion < 1
      ) {
        return Promise.reject(
          new AgentProfilePublicationStoreError(
            "agent_model_settings.invalid",
            "Agent model settings mutation is invalid.",
          ),
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workspace.manage",
          options.now,
        );
        const currentProfile = await requireCurrentProfile(
          connection,
          options.authority.workspaceId,
          false,
        );
        const stored = await readStoredModelSettings(
          connection,
          options.authority.workspaceId,
          true,
        );
        if ((stored?.version ?? 1) !== options.expectedVersion) {
          return fail(
            "agent_model_settings.state_conflict",
            "Agent model settings changed before this update.",
          );
        }
        const modelOptions = await readModelOptions(
          connection,
          options.authority.workspaceId,
          options.now,
        );
        const defaultModel = modelOptions.find(
          (candidate) => candidate.id === options.defaultModelId,
        );
        const fastModel = modelOptions.find(
          (candidate) => candidate.id === options.fastModelId,
        );
        if (!defaultModel?.ready || !fastModel?.ready) {
          return fail(
            "agent_model_settings.model_unavailable",
            "Selected Agent models are not executable.",
          );
        }
        if (
          stored?.defaultModelId === options.defaultModelId &&
          stored.fastModelId === options.fastModelId &&
          stored.reasoningLevel === options.reasoningLevel &&
          stored.webSearchMode === options.webSearchMode &&
          Boolean(stored.actionConfirmationRequired) ===
            options.actionConfirmationRequired
        ) {
          return settingsRecord(currentProfile, modelOptions, stored);
        }
        const nextVersion = (stored?.version ?? 0) + 1;
        if (stored) {
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE workspace_agent_model_settings
             SET default_canonical_model_id = ?, fast_canonical_model_id = ?,
                 reasoning_level = ?, web_search_mode = ?,
                 action_confirmation_required = ?,
                 version = ?, updated_by_principal_id = ?, updated_at = ?
             WHERE workspace_id = ? AND version = ?`,
            [
              options.defaultModelId,
              options.fastModelId,
              options.reasoningLevel,
              options.webSearchMode,
              options.actionConfirmationRequired,
              nextVersion,
              options.authority.principalId,
              options.now,
              options.authority.workspaceId,
              stored.version,
            ],
          );
          if (updated.affectedRows !== 1) {
            return fail(
              "agent_model_settings.state_conflict",
              "Agent model settings update lost optimistic concurrency.",
            );
          }
        } else {
          await connection.execute(
            `INSERT INTO workspace_agent_model_settings (
               workspace_id, default_canonical_model_id,
               fast_canonical_model_id, reasoning_level, web_search_mode,
               action_confirmation_required,
               version,
               updated_by_principal_id, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [
              options.authority.workspaceId,
              options.defaultModelId,
              options.fastModelId,
              options.reasoningLevel,
              options.webSearchMode,
              options.actionConfirmationRequired,
              options.authority.principalId,
              options.now,
            ],
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.authority.organizationId,
            workspaceId: options.authority.workspaceId,
            eventType: "agent.model_settings_changed",
            action: "change_agent_models",
            resourceType: "workspace_agent_model_settings",
            resourceId: options.authority.workspaceId,
            outcome: "succeeded",
            decisionReasonCode: "agent.model_settings_changed",
            severity: "info",
            authorizationDecision: {
              authorized: true,
              permission: "workspace.manage",
            },
            details: {
              defaultModelId: options.defaultModelId,
              fastModelId: options.fastModelId,
              reasoningLevel: options.reasoningLevel,
              webSearchMode: options.webSearchMode,
              actionConfirmationRequired: options.actionConfirmationRequired,
            },
            occurredAt: options.now,
          },
        );
        return settingsRecord(currentProfile, modelOptions, {
          defaultModelId: options.defaultModelId,
          fastModelId: options.fastModelId,
          reasoningLevel: options.reasoningLevel,
          webSearchMode: options.webSearchMode,
          actionConfirmationRequired: options.actionConfirmationRequired,
          version: nextVersion,
        });
      });
    },

    publish(options: PublishAgentProfileOptions) {
      const bindingIds = [
        ...(options.boundSkillDefinitionIds ?? []),
        ...(options.boundBrandKitIds ?? []),
        ...(options.boundLibraryIds ?? []),
        ...(options.boundWorkflowDefinitionIds ?? []),
      ];
      if (
        !idPattern.test(options.agentDefinitionId) ||
        !idPattern.test(options.profileRevisionId) ||
        (options.expectedAgentVersion !== undefined &&
          (!Number.isSafeInteger(options.expectedAgentVersion) ||
            options.expectedAgentVersion < 1)) ||
        (options.creationRequestHash !== undefined &&
          !digestPattern.test(options.creationRequestHash)) ||
        bindingIds.some((value) => !idPattern.test(value)) ||
        new Set(options.boundSkillDefinitionIds ?? []).size !==
          (options.boundSkillDefinitionIds ?? []).length ||
        new Set(options.boundBrandKitIds ?? []).size !==
          (options.boundBrandKitIds ?? []).length ||
        new Set(options.boundWorkflowDefinitionIds ?? []).size !==
          (options.boundWorkflowDefinitionIds ?? []).length ||
        (options.boundSkillDefinitionIds?.length ?? 0) > 40 ||
        (options.boundBrandKitIds?.length ?? 0) > 8 ||
        (options.boundLibraryIds?.length ?? 0) > 8 ||
        new Set(options.boundLibraryIds ?? []).size !==
          (options.boundLibraryIds ?? []).length ||
        (options.boundWorkflowDefinitionIds?.length ?? 0) > 40 ||
        (options.visibility !== undefined &&
          !["private", "workspace"].includes(options.visibility)) ||
        (options.presentation !== undefined &&
          (options.presentation.displayName.trim().length < 1 ||
            options.presentation.displayName.length > 160 ||
            options.presentation.summary.trim().length < 1 ||
            options.presentation.summary.length > 600 ||
            !validAgentAvatar(options.presentation.avatar) ||
            options.presentation.tags.length > 20))
      ) {
        return Promise.reject(
          new AgentProfilePublicationStoreError(
            "agent_profile_publication.invalid",
            "Agent Profile revision ID is invalid.",
          ),
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.publish",
          options.now,
        );
        await assertAvatarAssetAvailable(connection, options);
        const agentDefinitionId = await ensureAgentDefinition(
          connection,
          options,
        );
        const managementIdentity = agentManagementIdentityForProfileV1(
          options.profile.profileKey,
        );
        const canonicalDigest = digestProviderValue(options.profile.manifest);
        const existing = await readProfile(
          connection,
          options.authority.workspaceId,
          options.profile.profileKey,
          options.profile.revision,
        );
        let profileRevisionId = options.profileRevisionId;
        if (existing) {
          if (
            existing.lifecycleStatus !== "published" ||
            existing.canonicalDigest !== canonicalDigest ||
            existing.activationStatus !== "enabled" ||
            existing.agentDefinitionId !== agentDefinitionId ||
            digestProviderValue(record(existing.manifestDocument)) !==
              canonicalDigest
          ) {
            return fail(
              "agent_profile_publication.identity_conflict",
              "Agent Profile revision conflicts with existing immutable facts.",
            );
          }
          profileRevisionId = existing.id;
        } else {
          await connection.execute(
            `INSERT INTO agent_profile_revision (
               id, workspace_id, agent_definition_id, profile_key, revision,
               lifecycle_status,
               schema_version, manifest_document, canonical_digest,
               created_by_principal_id, published_by_principal_id,
               created_at, published_at
             ) VALUES (?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?, ?, ?)`,
            [
              profileRevisionId,
              options.authority.workspaceId,
              agentDefinitionId,
              options.profile.profileKey,
              options.profile.revision,
              JSON.stringify(options.profile.manifest),
              canonicalDigest,
              options.authority.principalId,
              options.authority.principalId,
              options.now,
              options.now,
            ],
          );
          await connection.execute(
            `INSERT INTO agent_profile_activation (
               workspace_id, profile_revision_id, runtime_status, reason_code,
               version, updated_by_principal_id, updated_at
             ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
            [
              options.authority.workspaceId,
              profileRevisionId,
              options.authority.principalId,
              options.now,
            ],
          );
          await bindAgentResources(connection, options, profileRevisionId);
        }
        for (const surfaceKind of options.profile.surfaceBindings) {
          await bindSurface(
            connection,
            options,
            profileRevisionId,
            surfaceKind,
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.authority.organizationId,
            workspaceId: options.authority.workspaceId,
            eventType: "agent_profile_revision.published",
            action: "publish",
            resourceType: "agent_profile_revision",
            resourceId: profileRevisionId,
            outcome: "succeeded",
            decisionReasonCode: "agent_profile_revision.published",
            severity: "info",
            authorizationDecision: {
              authorized: true,
              permission: "agent.publish",
            },
            details: {
              managementKind: options.managementKind,
              ...(managementIdentity.systemKey
                ? { systemKey: managementIdentity.systemKey }
                : {}),
              profileKey: options.profile.profileKey,
              revision: options.profile.revision,
              canonicalDigest,
              surfaceBindings: options.profile.surfaceBindings,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          id: profileRevisionId,
          workspaceId: options.authority.workspaceId,
          agentDefinitionId,
          profileKey: options.profile.profileKey,
          revision: options.profile.revision,
          manifest: options.profile.manifest,
          canonicalDigest,
        });
      });
    },
  });
}
