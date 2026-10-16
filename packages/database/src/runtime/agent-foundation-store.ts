import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import type {
  AgentFoundationRepository,
  AgentProfileRevisionRecord,
  AgentSkillCatalogItem,
  AgentSkillEntrypointView,
  AgentSkillUnavailableEntrypointView,
  AgentSurfaceKind,
  AgentSurfaceView,
} from "@kanvas/application";
import {
  parseAgentProfileManifestV1,
  parseAgentSkillMetadataV1,
} from "@kanvas/application";
import type {
  EffectiveInvocationField,
  EffectiveInvocationSchema,
  EffectiveInvocationUnavailableReason,
} from "@kanvas/contracts/api";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { ensureWorkspaceDefaultAgentInTransaction } from "./workspace-default-agent-store.js";
import { parseSkillPublicationDocument } from "./publication-documents.js";
import type { EffectiveInvocationSchemaProjector } from "./effective-invocation-schema-store.js";

interface ProfileRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentDefinitionId: string;
  readonly profileKey: string;
  readonly revision: number;
  readonly manifestDocument: unknown;
  readonly canonicalDigest: string;
}

interface SkillEntrypointFact {
  readonly skillDefinitionId: string;
  readonly skillRevisionId: string;
  readonly skillKey: string;
  readonly revision: number;
  readonly manifestDocument: unknown;
  readonly canonicalDigest: string;
  readonly entrypointKey: string | null;
  readonly workflowRevisionId: string | null;
  readonly inputSchema: unknown;
  readonly availabilityReason?: EffectiveInvocationUnavailableReason;
  readonly topology: unknown;
  readonly resourcePath: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string | null;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: bigint | number | string;
  readonly entrypointOrdinal: number | null;
  readonly bound: number;
  readonly candidate: number;
}
type SkillEntrypointRow = RowDataPacket & SkillEntrypointFact;

interface SkillReferenceFact {
  readonly skillRevisionId: string;
  readonly resourcePath: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string | null;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: bigint | number | string;
}
type SkillReferenceRow = RowDataPacket & SkillReferenceFact;

interface CandidateSkillRow extends RowDataPacket {
  readonly candidateId: string;
  readonly skillDefinitionId: string;
  readonly skillKey: string;
  readonly canonicalDigest: string;
  readonly contentDocument: unknown;
}

interface CandidateObjectRow extends RowDataPacket {
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string | null;
}

interface BoundBrandRow extends RowDataPacket {
  readonly brandKitId: string;
  readonly name: string;
  readonly description: string | null;
}

interface BoundWorkflowRow extends RowDataPacket {
  readonly workflowDefinitionId: string;
  readonly displayName: string;
  readonly description: string | null;
}

export type AgentFoundationStoreErrorCode =
  "agent.foundation_integrity_violation" | "agent.foundation_invalid_argument";

export class AgentFoundationStoreError extends Error {
  public constructor(
    readonly code: AgentFoundationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentFoundationStoreError";
  }
}

function invalid(code: AgentFoundationStoreErrorCode, message: string): never {
  throw new AgentFoundationStoreError(code, message);
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return invalid(
        "agent.foundation_integrity_violation",
        `${label} is invalid JSON.`,
      );
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return invalid(
      "agent.foundation_integrity_violation",
      `${label} must be a JSON object.`,
    );
  }
  return decoded as Readonly<Record<string, unknown>>;
}

function effectiveFieldSchema(
  field: EffectiveInvocationField,
): Readonly<Record<string, unknown>> {
  const presentation = {
    title: field.label,
    ...(field.description ? { description: field.description } : {}),
  };
  switch (field.valueType) {
    case "constant":
      return Object.freeze({ ...presentation, const: field.value });
    case "enum":
      return Object.freeze({ ...presentation, enum: field.values });
    case "integer":
      return Object.freeze({
        ...presentation,
        type: "integer",
        minimum: field.minimum,
        maximum: field.maximum,
        ...(field.step ? { multipleOf: field.step } : {}),
      });
    case "boolean":
      return Object.freeze({
        ...presentation,
        type: "boolean",
        ...(field.allowedValues ? { enum: field.allowedValues } : {}),
      });
    case "string":
      return Object.freeze({
        ...presentation,
        type: "string",
        minLength: 1,
        maxLength: field.maxLength,
      });
    case "artifact":
      return Object.freeze({
        ...presentation,
        type: "string",
        pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
      });
    case "artifact_list":
      return Object.freeze({
        ...presentation,
        type: "array",
        minItems: field.minItems,
        maxItems: field.maxItems,
        uniqueItems: field.uniqueItems,
        items: {
          type: "string",
          pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
        },
      });
    case "json":
      return Object.freeze({ ...presentation, type: field.jsonType });
  }
}

function agentInputSchema(
  fields: readonly EffectiveInvocationField[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze(
      Object.fromEntries(
        fields.map((field) => [field.key, effectiveFieldSchema(field)]),
      ),
    ),
    required: Object.freeze(
      fields.filter((field) => field.required).map((field) => field.key),
    ),
  });
}

function profileFrom(row: ProfileRow): AgentProfileRevisionRecord {
  const manifest = parseAgentProfileManifestV1(
    record(row.manifestDocument, "Agent Profile manifest"),
  );
  if (!manifest) {
    return invalid(
      "agent.foundation_integrity_violation",
      "Published Agent Profile manifest is invalid.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    agentDefinitionId: row.agentDefinitionId,
    profileKey: row.profileKey,
    revision: row.revision,
    manifest,
    canonicalDigest: row.canonicalDigest,
  });
}

function manifestEntrypoint(
  manifest: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const entrypoints = manifest.entrypoints;
  if (!Array.isArray(entrypoints)) return undefined;
  return entrypoints.find((value) => {
    const candidate =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : undefined;
    return candidate?.entrypointKey === key;
  }) as Readonly<Record<string, unknown>> | undefined;
}

function boundedPresentation(
  value: unknown,
  maximum: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

function mastraSkillName(skillKey: string): string | undefined {
  const normalized = skillKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return normalized.length > 0 ? normalized : undefined;
}

function byteSize(
  value: bigint | number | string,
  maximum = 262_144n,
): string | undefined {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= maximum ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
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
  surfaceKind: AgentSurfaceKind,
  principalId: string,
  agentDefinitionId?: string,
  profileRevisionId?: string,
  lock = false,
): Promise<ProfileRow | undefined> {
  if (profileRevisionId) {
    const [rows] = await connection.execute<ProfileRow[]>(
      `SELECT
         profile.id,
         profile.workspace_id AS workspaceId,
         profile.agent_definition_id AS agentDefinitionId,
         profile.profile_key AS profileKey,
         profile.revision,
         profile.manifest_document AS manifestDocument,
         profile.canonical_digest AS canonicalDigest
       FROM agent_profile_revision AS profile
       INNER JOIN agent_profile_activation AS activation
         ON activation.workspace_id = profile.workspace_id
        AND activation.profile_revision_id = profile.id
       INNER JOIN agent_definition AS definition
         ON definition.workspace_id = profile.workspace_id
        AND definition.id = profile.agent_definition_id
       WHERE profile.workspace_id = ?
         AND profile.id = ?
         AND profile.lifecycle_status = 'published'
         AND activation.runtime_status = 'enabled'
         AND definition.lifecycle_status = 'active'
         AND (definition.visibility = 'workspace'
           OR definition.owner_principal_id = ?)
       LIMIT 1${lock ? " FOR SHARE" : ""}`,
      [workspaceId, profileRevisionId, principalId],
    );
    return rows[0];
  }
  if (agentDefinitionId) {
    const [rows] = await connection.execute<ProfileRow[]>(
      `SELECT
         profile.id,
         profile.workspace_id AS workspaceId,
         profile.agent_definition_id AS agentDefinitionId,
         profile.profile_key AS profileKey,
         profile.revision,
         profile.manifest_document AS manifestDocument,
         profile.canonical_digest AS canonicalDigest
       FROM agent_profile_revision AS profile
       INNER JOIN agent_profile_activation AS activation
         ON activation.workspace_id = profile.workspace_id
        AND activation.profile_revision_id = profile.id
       INNER JOIN agent_definition AS definition
         ON definition.workspace_id = profile.workspace_id
        AND definition.id = profile.agent_definition_id
       WHERE profile.workspace_id = ?
         AND profile.agent_definition_id = ?
         AND profile.lifecycle_status = 'published'
         AND activation.runtime_status = 'enabled'
         AND definition.lifecycle_status = 'active'
         AND (definition.visibility = 'workspace'
           OR definition.owner_principal_id = ?)
       ORDER BY profile.revision DESC, profile.id DESC
       LIMIT 1${lock ? " FOR SHARE" : ""}`,
      [workspaceId, agentDefinitionId, principalId],
    );
    return rows[0];
  }
  const [rows] = await connection.execute<ProfileRow[]>(
    `SELECT
       profile.id,
       profile.workspace_id AS workspaceId,
       profile.agent_definition_id AS agentDefinitionId,
       profile.profile_key AS profileKey,
       profile.revision,
       profile.manifest_document AS manifestDocument,
       profile.canonical_digest AS canonicalDigest
     FROM agent_surface_profile_binding AS binding
     INNER JOIN agent_profile_revision AS profile
       ON profile.workspace_id = binding.workspace_id
      AND profile.id = binding.profile_revision_id
     INNER JOIN agent_profile_activation AS activation
       ON activation.workspace_id = profile.workspace_id
      AND activation.profile_revision_id = profile.id
     INNER JOIN agent_definition AS definition
       ON definition.workspace_id = profile.workspace_id
      AND definition.id = profile.agent_definition_id
     WHERE binding.workspace_id = ?
       AND binding.surface_kind = ?
       AND profile.lifecycle_status = 'published'
       AND activation.runtime_status = 'enabled'
       AND definition.lifecycle_status = 'active'
       AND (definition.visibility = 'workspace'
         OR definition.owner_principal_id = ?)
     LIMIT 1${lock ? " FOR SHARE" : ""}`,
    [workspaceId, surfaceKind, principalId],
  );
  return rows[0];
}

async function readSkillRows(
  connection: PoolConnection,
  workspaceId: string,
  principalId: string,
  profileRevisionId: string,
  maximumCatalogItems: number,
  pinnedSkillRevisionIds?: readonly string[],
): Promise<readonly SkillEntrypointFact[]> {
  const pinnedPredicate = pinnedSkillRevisionIds?.length
    ? `AND skill.id IN (${pinnedSkillRevisionIds.map(() => "?").join(", ")})`
    : `AND NOT EXISTS (
         SELECT 1
         FROM skill_revision AS newer_skill
         WHERE newer_skill.workspace_id = skill.workspace_id
           AND newer_skill.skill_definition_id = skill.skill_definition_id
           AND newer_skill.lifecycle_status = 'published'
           AND (
             newer_skill.revision > skill.revision
             OR (
               newer_skill.revision = skill.revision
               AND newer_skill.id > skill.id
             )
           )
       )`;
  const [rows] = await connection.execute<SkillEntrypointRow[]>(
    `WITH ranked_skills AS (
     SELECT
       DENSE_RANK() OVER (
         ORDER BY CASE WHEN binding.skill_definition_id IS NULL THEN 0 ELSE 1 END DESC,
                  skill.published_at DESC, skill.id
       ) AS catalogRank,
       skill.skill_definition_id AS skillDefinitionId,
       skill.id AS skillRevisionId,
       skill.skill_key AS skillKey,
       skill.revision,
       skill.manifest_document AS manifestDocument,
       skill.canonical_digest AS canonicalDigest,
       CASE
         WHEN workflow.lifecycle_status = 'published'
          AND workflow_activation.runtime_status = 'enabled'
         THEN entrypoint.entrypoint_key
         ELSE NULL
       END AS entrypointKey,
       CASE
         WHEN workflow.lifecycle_status = 'published'
          AND workflow_activation.runtime_status = 'enabled'
         THEN entrypoint.workflow_revision_id
         ELSE NULL
       END AS workflowRevisionId,
       CASE
         WHEN workflow.lifecycle_status = 'published'
          AND workflow_activation.runtime_status = 'enabled'
         THEN workflow.input_schema
         ELSE NULL
       END AS inputSchema,
       CASE
         WHEN workflow.lifecycle_status = 'published'
          AND workflow_activation.runtime_status = 'enabled'
         THEN workflow.topology
         ELSE NULL
       END AS topology,
       resource.resource_path AS resourcePath,
       resource.stored_object_id AS storedObjectId,
       object_fact.storage_profile_id AS storageProfileId,
       object_fact.container,
       object_fact.object_key AS objectKey,
       object_fact.sha256,
       object_fact.immutable_identity_hash AS immutableIdentityHash,
       resource.content_digest AS contentDigest,
       resource.media_type AS mediaType,
       resource.byte_size AS byteSize,
       CASE
         WHEN workflow.lifecycle_status = 'published'
          AND workflow_activation.runtime_status = 'enabled'
         THEN entrypoint.ordinal
         ELSE NULL
       END AS entrypointOrdinal,
       CASE WHEN binding.skill_definition_id IS NULL THEN 0 ELSE 1 END AS bound,
       0 AS candidate
     FROM skill_revision AS skill
     INNER JOIN skill_definition AS definition
       ON definition.workspace_id = skill.workspace_id
      AND definition.id = skill.skill_definition_id
     INNER JOIN skill_revision_activation AS skill_activation
       ON skill_activation.workspace_id = skill.workspace_id
      AND skill_activation.skill_revision_id = skill.id
     LEFT JOIN agent_revision_skill_binding AS binding
       ON binding.workspace_id = skill.workspace_id
      AND binding.profile_revision_id = ?
      AND binding.skill_definition_id = skill.skill_definition_id
     LEFT JOIN skill_revision_workflow_entrypoint AS entrypoint
       ON entrypoint.workspace_id = skill.workspace_id
      AND entrypoint.skill_revision_id = skill.id
     LEFT JOIN workflow_revision AS workflow
       ON workflow.workspace_id = entrypoint.workspace_id
      AND workflow.id = entrypoint.workflow_revision_id
     LEFT JOIN workflow_revision_activation AS workflow_activation
       ON workflow_activation.workspace_id = workflow.workspace_id
      AND workflow_activation.workflow_revision_id = workflow.id
     INNER JOIN skill_revision_resource AS resource
       ON resource.workspace_id = skill.workspace_id
      AND resource.skill_revision_id = skill.id
      AND resource.resource_path = JSON_UNQUOTE(
        JSON_EXTRACT(skill.manifest_document, '$.agent.instructionResourcePath')
      )
     INNER JOIN stored_object AS object_fact
       ON object_fact.workspace_id = resource.workspace_id
      AND object_fact.id = resource.stored_object_id
      AND object_fact.delete_state = 'active'
     WHERE skill.workspace_id = ?
       AND skill.lifecycle_status = 'published'
       AND skill_activation.runtime_status = 'enabled'
       ${pinnedSkillRevisionIds !== undefined ? "" : "AND definition.usage_status = 'enabled'"}
       AND definition.lifecycle_status = 'active'
       AND (definition.visibility = 'workspace'
         OR definition.owner_principal_id = ?)
       ${pinnedPredicate}
       AND resource.resource_kind = 'instructions'
     )
     SELECT * FROM ranked_skills
      WHERE catalogRank <= ${String(maximumCatalogItems)}
      ORDER BY catalogRank, entrypointOrdinal`,
    [
      profileRevisionId,
      workspaceId,
      principalId,
      ...(pinnedSkillRevisionIds ?? []),
    ],
  );
  return rows;
}

async function readCandidateSkillRows(
  connection: PoolConnection,
  workspaceId: string,
  principalId: string,
  candidateIds: readonly string[],
): Promise<{
  readonly skills: readonly SkillEntrypointFact[];
  readonly references: readonly SkillReferenceFact[];
}> {
  if (candidateIds.length === 0) return { skills: [], references: [] };
  const placeholders = candidateIds.map(() => "?").join(", ");
  const [candidates] = await connection.execute<CandidateSkillRow[]>(
    `SELECT candidate.id AS candidateId,
            definition.id AS skillDefinitionId,
            definition.skill_key AS skillKey,
            candidate.canonical_digest AS canonicalDigest,
            candidate.content_document AS contentDocument
       FROM publication_candidate AS candidate
       INNER JOIN skill_draft AS draft
         ON draft.workspace_id = candidate.workspace_id
        AND draft.id = candidate.source_draft_id
        AND draft.version = candidate.source_draft_version
       INNER JOIN skill_definition AS definition
         ON definition.workspace_id = draft.workspace_id
        AND definition.id = draft.skill_definition_id
      WHERE candidate.workspace_id = ?
        AND candidate.subject_kind = 'skill'
        AND candidate.id IN (${placeholders})
        AND draft.lifecycle_status = 'active'
        AND definition.lifecycle_status = 'active'
        AND definition.owner_principal_id = ?`,
    [workspaceId, ...candidateIds, principalId],
  );
  const documents = candidates.map((candidate) => ({
    candidate,
    document: parseSkillPublicationDocument(candidate.contentDocument),
  }));
  const objectIds = [
    ...new Set(
      documents.flatMap(({ document }) =>
        document.resources.map((resource) => resource.storedObjectId),
      ),
    ),
  ];
  if (objectIds.length === 0) return { skills: [], references: [] };
  const objectPlaceholders = objectIds.map(() => "?").join(", ");
  const [objects] = await connection.execute<CandidateObjectRow[]>(
    `SELECT id AS storedObjectId, storage_profile_id AS storageProfileId,
            container, object_key AS objectKey, sha256,
            immutable_identity_hash AS immutableIdentityHash
       FROM stored_object
      WHERE workspace_id = ? AND id IN (${objectPlaceholders})
        AND delete_state = 'active'`,
    [workspaceId, ...objectIds],
  );
  const byId = new Map(
    objects.map((object) => [object.storedObjectId, object]),
  );
  const skills: SkillEntrypointFact[] = [];
  const references: SkillReferenceFact[] = [];
  for (const { candidate, document } of documents) {
    const agent = record(document.manifest.agent, "Skill agent metadata");
    const instructionPath =
      typeof agent.instructionResourcePath === "string"
        ? agent.instructionResourcePath
        : "SKILL.md";
    const instruction = document.resources.find(
      (resource) =>
        resource.path === instructionPath &&
        resource.resourceKind === "instructions",
    );
    const instructionObject = instruction
      ? byId.get(instruction.storedObjectId)
      : undefined;
    if (
      !instruction ||
      !instructionObject ||
      !instructionObject.immutableIdentityHash ||
      `sha256:${instructionObject.sha256}` !== instruction.contentDigest
    ) {
      continue;
    }
    skills.push({
      skillDefinitionId: candidate.skillDefinitionId,
      skillRevisionId: candidate.candidateId,
      skillKey: candidate.skillKey,
      revision: 0,
      manifestDocument: document.manifest,
      canonicalDigest: candidate.canonicalDigest,
      entrypointKey: null,
      workflowRevisionId: null,
      inputSchema: null,
      topology: null,
      resourcePath: instruction.path,
      storedObjectId: instruction.storedObjectId,
      storageProfileId: instructionObject.storageProfileId,
      container: instructionObject.container,
      objectKey: instructionObject.objectKey,
      sha256: instructionObject.sha256,
      immutableIdentityHash: instructionObject.immutableIdentityHash,
      contentDigest: instruction.contentDigest,
      mediaType: instruction.mediaType,
      byteSize: instruction.byteSize,
      entrypointOrdinal: null,
      bound: 0,
      candidate: 1,
    });
    for (const resource of document.resources) {
      if (
        !["reference", "asset"].includes(resource.resourceKind) ||
        ![
          "text/markdown",
          "text/plain",
          "application/json",
          "application/yaml",
          "text/yaml",
          "image/png",
          "image/jpeg",
          "image/webp",
        ].includes(resource.mediaType)
      ) {
        continue;
      }
      const object = byId.get(resource.storedObjectId);
      if (
        !object ||
        !object.immutableIdentityHash ||
        `sha256:${object.sha256}` !== resource.contentDigest
      ) {
        continue;
      }
      references.push({
        skillRevisionId: candidate.candidateId,
        resourcePath: resource.path,
        storedObjectId: resource.storedObjectId,
        storageProfileId: object.storageProfileId,
        container: object.container,
        objectKey: object.objectKey,
        sha256: object.sha256,
        immutableIdentityHash: object.immutableIdentityHash,
        contentDigest: resource.contentDigest,
        mediaType: resource.mediaType,
        byteSize: resource.byteSize,
      });
    }
  }
  return Object.freeze({
    skills: Object.freeze(skills),
    references: Object.freeze(references),
  });
}

async function readSkillReferenceRows(
  connection: PoolConnection,
  workspaceId: string,
  skillRevisionIds: readonly string[],
): Promise<readonly SkillReferenceFact[]> {
  if (skillRevisionIds.length === 0) return [];
  const placeholders = skillRevisionIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<SkillReferenceRow[]>(
    `SELECT
       resource.skill_revision_id AS skillRevisionId,
       resource.resource_path AS resourcePath,
       resource.stored_object_id AS storedObjectId,
       object_fact.storage_profile_id AS storageProfileId,
       object_fact.container,
       object_fact.object_key AS objectKey,
       object_fact.sha256,
       object_fact.immutable_identity_hash AS immutableIdentityHash,
       resource.content_digest AS contentDigest,
       resource.media_type AS mediaType,
       resource.byte_size AS byteSize
     FROM skill_revision_resource AS resource
     INNER JOIN stored_object AS object_fact
       ON object_fact.workspace_id = resource.workspace_id
      AND object_fact.id = resource.stored_object_id
      AND object_fact.delete_state = 'active'
     WHERE resource.workspace_id = ?
       AND resource.skill_revision_id IN (${placeholders})
       AND resource.resource_kind IN ('reference', 'asset')
       AND resource.media_type IN ('text/markdown', 'text/plain', 'application/json', 'application/yaml', 'text/yaml', 'image/png', 'image/jpeg', 'image/webp')
     ORDER BY resource.skill_revision_id, resource.ordinal`,
    [workspaceId, ...skillRevisionIds],
  );
  return rows;
}

async function readBoundResources(
  connection: PoolConnection,
  workspaceId: string,
  profileRevisionId: string,
): Promise<{
  readonly brands: readonly BoundBrandRow[];
  readonly workflows: readonly BoundWorkflowRow[];
}> {
  const [brands, workflows] = await Promise.all([
    connection.execute<BoundBrandRow[]>(
      `SELECT brand.id AS brandKitId, brand.name, brand.description
         FROM agent_revision_brand_binding AS binding
         INNER JOIN brand_kit AS brand
           ON brand.workspace_id = binding.workspace_id
          AND brand.id = binding.brand_kit_id
        WHERE binding.workspace_id = ? AND binding.profile_revision_id = ?
          AND brand.lifecycle_status = 'active'
        ORDER BY binding.ordinal`,
      [workspaceId, profileRevisionId],
    ),
    connection.execute<BoundWorkflowRow[]>(
      `SELECT workflow.id AS workflowDefinitionId,
              workflow.display_name AS displayName, workflow.description
         FROM agent_revision_workflow_binding AS binding
         INNER JOIN workflow_definition AS workflow
           ON workflow.workspace_id = binding.workspace_id
          AND workflow.id = binding.workflow_definition_id
        WHERE binding.workspace_id = ? AND binding.profile_revision_id = ?
          AND workflow.lifecycle_status = 'active'
        ORDER BY binding.ordinal`,
      [workspaceId, profileRevisionId],
    ),
  ]);
  return Object.freeze({
    brands: Object.freeze(brands[0]),
    workflows: Object.freeze(workflows[0]),
  });
}

async function projectEntrypointSchemas(
  connection: PoolConnection,
  rows: readonly SkillEntrypointFact[],
  projector: EffectiveInvocationSchemaProjector | undefined,
  workspaceId: string,
  now: Date,
): Promise<readonly SkillEntrypointFact[]> {
  if (!projector) return rows;
  const cache = new Map<string, Promise<EffectiveInvocationSchema>>();
  return Promise.all(
    rows.map(async (row) => {
      if (!row.workflowRevisionId || !row.inputSchema) return row;
      let projected = cache.get(row.workflowRevisionId);
      if (!projected) {
        projected = (async () => {
          const rawInputSchema = record(
            row.inputSchema,
            "Workflow input schema",
          );
          if (!isWorkflowTopology(row.topology)) {
            return {
              schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
              availability: "unavailable" as const,
              reason: "unsupported_topology" as const,
              controlledParameterKeys: [],
            };
          }
          const effective = await projector.projectInTransaction(connection, {
            workspaceId,
            workflowRevisionId: row.workflowRevisionId!,
            topology: row.topology,
            inputSchema: rawInputSchema,
            now,
          });
          return effective;
        })();
        cache.set(row.workflowRevisionId, projected);
      }
      const effective = await projected;
      return effective.availability === "available"
        ? Object.freeze({
            ...row,
            inputSchema: agentInputSchema(effective.fields),
          })
        : Object.freeze({
            ...row,
            inputSchema: null,
            availabilityReason: effective.reason,
          });
    }),
  );
}

function skillCatalog(
  rows: readonly SkillEntrypointFact[],
  referenceRows: readonly SkillReferenceFact[],
  surfaceKind: AgentSurfaceKind,
  maximumCatalogItems: number,
  includeWorkflowEntrypoints: boolean,
): readonly AgentSkillCatalogItem[] {
  const grouped = new Map<string, AgentSkillCatalogItem>();
  for (const row of rows) {
    const manifest = record(row.manifestDocument, "Skill manifest");
    const metadata = parseAgentSkillMetadataV1(manifest);
    if (!metadata?.surfaceKinds.includes(surfaceKind)) continue;
    const displayName = boundedPresentation(manifest.displayName, 160);
    const skillName = mastraSkillName(row.skillKey);
    const parsedByteSize = byteSize(row.byteSize);
    if (
      !displayName ||
      !skillName ||
      !parsedByteSize ||
      !row.immutableIdentityHash ||
      !["text/markdown", "text/plain"].includes(row.mediaType)
    ) {
      continue;
    }
    let entrypoint: AgentSkillEntrypointView | undefined;
    let unavailableEntrypoint: AgentSkillUnavailableEntrypointView | undefined;
    if (row.entrypointKey && row.workflowRevisionId) {
      const entrypointManifest = manifestEntrypoint(
        manifest,
        row.entrypointKey,
      );
      const entrypointDisplayName = boundedPresentation(
        entrypointManifest?.displayName,
        160,
      );
      const description = boundedPresentation(
        entrypointManifest?.description,
        600,
      );
      const category = boundedPresentation(entrypointManifest?.category, 120);
      if (entrypointDisplayName && description) {
        const presentation = {
          entrypointKey: row.entrypointKey,
          workflowRevisionId: row.workflowRevisionId,
          displayName: entrypointDisplayName,
          description,
          ...(category ? { category } : {}),
        } as const;
        if (includeWorkflowEntrypoints && row.inputSchema) {
          entrypoint = Object.freeze({
            ...presentation,
            inputSchema: record(row.inputSchema, "Workflow input schema"),
          });
        } else {
          unavailableEntrypoint = Object.freeze({
            ...presentation,
            reason: includeWorkflowEntrypoints
              ? (row.availabilityReason ?? "workflow_unavailable")
              : "permission_required",
          });
        }
      }
    }
    const current = grouped.get(row.skillRevisionId);
    if (current) {
      if (entrypoint || unavailableEntrypoint) {
        grouped.set(
          row.skillRevisionId,
          Object.freeze({
            ...current,
            ...(entrypoint
              ? {
                  entrypoints: Object.freeze([
                    ...current.entrypoints,
                    entrypoint,
                  ]),
                }
              : {}),
            ...(unavailableEntrypoint
              ? {
                  unavailableEntrypoints: Object.freeze([
                    ...(current.unavailableEntrypoints ?? []),
                    unavailableEntrypoint,
                  ]),
                }
              : {}),
          }),
        );
      }
      continue;
    }
    if (grouped.size >= maximumCatalogItems) continue;
    grouped.set(
      row.skillRevisionId,
      Object.freeze({
        skillDefinitionId: row.skillDefinitionId,
        skillRevisionId: row.skillRevisionId,
        skillKey: row.skillKey,
        skillName,
        revision: row.revision,
        candidate: row.candidate === 1,
        bound: row.bound === 1,
        displayName,
        summary: metadata.summary,
        exampleRequests: metadata.exampleRequests,
        toolFamilies: metadata.toolFamilies,
        canonicalDigest: row.canonicalDigest,
        instructionResource: Object.freeze({
          resourcePath: row.resourcePath,
          storedObjectId: row.storedObjectId,
          storageProfileId: row.storageProfileId,
          container: row.container,
          objectKey: row.objectKey,
          sha256: row.sha256,
          immutableIdentityHash: row.immutableIdentityHash,
          contentDigest: row.contentDigest,
          mediaType: row.mediaType,
          byteSize: parsedByteSize,
        }),
        referenceResources: Object.freeze(
          referenceRows
            .filter(
              (reference) => reference.skillRevisionId === row.skillRevisionId,
            )
            .flatMap((reference) => {
              const referenceByteSize = byteSize(
                reference.byteSize,
                reference.mediaType.startsWith("image/")
                  ? 32n * 1024n * 1024n
                  : 262_144n,
              );
              const relativePath = reference.resourcePath.replace(
                /^references\//u,
                "",
              );
              return referenceByteSize &&
                relativePath.length > 0 &&
                !relativePath.includes("..") &&
                reference.immutableIdentityHash
                ? [
                    Object.freeze({
                      relativePath,
                      resourcePath: reference.resourcePath,
                      storedObjectId: reference.storedObjectId,
                      storageProfileId: reference.storageProfileId,
                      container: reference.container,
                      objectKey: reference.objectKey,
                      sha256: reference.sha256,
                      immutableIdentityHash: reference.immutableIdentityHash,
                      contentDigest: reference.contentDigest,
                      mediaType: reference.mediaType,
                      byteSize: referenceByteSize,
                    }),
                  ]
                : [];
            }),
        ),
        entrypoints: Object.freeze(entrypoint ? [entrypoint] : []),
        unavailableEntrypoints: Object.freeze(
          unavailableEntrypoint ? [unavailableEntrypoint] : [],
        ),
      }),
    );
  }
  return Object.freeze([...grouped.values()]);
}

async function applyDevelopmentSkillFiles(
  skills: readonly AgentSkillCatalogItem[],
  files: Readonly<Record<string, string>> | undefined,
): Promise<readonly AgentSkillCatalogItem[]> {
  if (!files) return skills;
  return Object.freeze(
    await Promise.all(
      skills.map(async (skill) => {
        const path = files[skill.skillKey];
        if (!path) return skill;
        const handle = await open(path, "r").catch(() =>
          invalid(
            "agent.foundation_invalid_argument",
            "Agent development Skill instruction file is unavailable.",
          ),
        );
        try {
          const before = await handle.stat({ bigint: true });
          if (!before.isFile() || before.size < 1n || before.size > 262_144n) {
            return invalid(
              "agent.foundation_invalid_argument",
              "Agent development Skill instruction file is invalid.",
            );
          }
          const bytes = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeNs !== after.mtimeNs
          ) {
            return invalid(
              "agent.foundation_integrity_violation",
              "Agent development Skill changed while it was being read.",
            );
          }
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          return Object.freeze({
            ...skill,
            instructionResource: Object.freeze({
              ...skill.instructionResource,
              sha256,
              immutableIdentityHash: digestProviderValue({
                source: "development-local-agent-skill",
                path,
                sha256,
              }),
              contentDigest: `sha256:${sha256}`,
              byteSize: String(bytes.byteLength),
              developmentLocalPath: path,
            }),
          });
        } finally {
          await handle.close();
        }
      }),
    ),
  );
}

export function createAgentFoundationStore(
  pool: Pool,
  configuration: {
    readonly developmentSkillFiles?: Readonly<Record<string, string>>;
    readonly effectiveInvocationSchemas?: EffectiveInvocationSchemaProjector;
  } = {},
): AgentFoundationRepository {
  return Object.freeze({
    resolveSurfaceView(
      options: Parameters<AgentFoundationRepository["resolveSurfaceView"]>[0],
    ): Promise<AgentSurfaceView | undefined> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.read",
          options.now,
        );
        let row = await readProfile(
          connection,
          options.authority.workspaceId,
          options.surfaceKind,
          options.authority.principalId,
          options.agentDefinitionId,
          options.profileRevisionId,
        );
        if (
          !row &&
          options.surfaceKind === "agent_workspace" &&
          options.agentDefinitionId === undefined &&
          options.profileRevisionId === undefined
        ) {
          await ensureWorkspaceDefaultAgentInTransaction(connection, {
            workspaceId: options.authority.workspaceId,
            now: options.now,
          });
          row = await readProfile(
            connection,
            options.authority.workspaceId,
            options.surfaceKind,
            options.authority.principalId,
            undefined,
            undefined,
            true,
          );
        }
        if (!row) return undefined;
        const profile = profileFrom(row);
        if (
          !profile.manifest.allowedSurfaceKinds.includes(options.surfaceKind)
        ) {
          return invalid(
            "agent.foundation_integrity_violation",
            "Agent Profile binding targets a surface not declared by its manifest.",
          );
        }
        const skillRows = await readSkillRows(
          connection,
          options.authority.workspaceId,
          options.authority.principalId,
          profile.id,
          profile.manifest.skillPolicy.maximumCatalogItems,
          options.skillRevisionIds,
        );
        const candidateRows = await readCandidateSkillRows(
          connection,
          options.authority.workspaceId,
          options.authority.principalId,
          options.skillRevisionIds ?? [],
        );
        const referenceRows = await readSkillReferenceRows(
          connection,
          options.authority.workspaceId,
          [...new Set(skillRows.map((skill) => skill.skillRevisionId))],
        );
        const boundResources = await readBoundResources(
          connection,
          options.authority.workspaceId,
          profile.id,
        );
        const storedSkills = skillCatalog(
          await projectEntrypointSchemas(
            connection,
            [...skillRows, ...candidateRows.skills],
            configuration.effectiveInvocationSchemas,
            options.authority.workspaceId,
            options.now,
          ),
          [...referenceRows, ...candidateRows.references],
          options.surfaceKind,
          profile.manifest.skillPolicy.maximumCatalogItems,
          profile.manifest.allowedToolFamilies.includes("workflow") &&
            options.authority.effectivePermissions.includes("workflow.read"),
        );
        const skills = await applyDevelopmentSkillFiles(
          storedSkills,
          configuration.developmentSkillFiles,
        );
        return Object.freeze({
          profile,
          skills,
          boundBrands: Object.freeze(
            boundResources.brands.map((brand) =>
              Object.freeze({
                brandKitId: brand.brandKitId,
                name: brand.name,
                ...(brand.description
                  ? { description: brand.description }
                  : {}),
              }),
            ),
          ),
          boundWorkflows: Object.freeze(
            boundResources.workflows.map((workflow) =>
              Object.freeze({
                workflowDefinitionId: workflow.workflowDefinitionId,
                displayName: workflow.displayName,
                ...(workflow.description
                  ? { description: workflow.description }
                  : {}),
              }),
            ),
          ),
          skillViewDigest: digestProviderValue({
            profileRevisionId: profile.id,
            surfaceKind: options.surfaceKind,
            skills,
            boundBrands: boundResources.brands.map((brand) => brand.brandKitId),
            boundWorkflows: boundResources.workflows.map(
              (workflow) => workflow.workflowDefinitionId,
            ),
          }),
        });
      });
    },
    assertSkillUsable(
      options: Parameters<AgentFoundationRepository["assertSkillUsable"]>[0],
    ): Promise<void> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.use",
          options.now,
        );
        const [rows] = await connection.execute<RowDataPacket[]>(
          `SELECT skill.id
           FROM skill_revision AS skill
           INNER JOIN skill_revision_activation AS activation
             ON activation.workspace_id = skill.workspace_id
            AND activation.skill_revision_id = skill.id
           INNER JOIN skill_definition AS definition
             ON definition.workspace_id = skill.workspace_id
            AND definition.id = skill.skill_definition_id
           WHERE skill.workspace_id = ?
             AND skill.id = ?
             AND skill.lifecycle_status = 'published'
             AND activation.runtime_status = 'enabled'
             AND definition.lifecycle_status = 'active'
             AND (definition.visibility = 'workspace'
               OR definition.owner_principal_id = ?)
           LIMIT 1`,
          [
            options.authority.workspaceId,
            options.skillRevisionId,
            options.authority.principalId,
          ],
        );
        if (!rows[0]) {
          const [candidateRows] = await connection.execute<RowDataPacket[]>(
            `SELECT candidate.id
               FROM publication_candidate AS candidate
               INNER JOIN skill_draft AS draft
                 ON draft.workspace_id = candidate.workspace_id
                AND draft.id = candidate.source_draft_id
                AND draft.version = candidate.source_draft_version
               INNER JOIN skill_definition AS definition
                 ON definition.workspace_id = draft.workspace_id
                AND definition.id = draft.skill_definition_id
              WHERE candidate.workspace_id = ?
                AND candidate.id = ?
                AND candidate.subject_kind = 'skill'
                AND draft.lifecycle_status = 'active'
                AND definition.lifecycle_status = 'active'
                AND definition.owner_principal_id = ?
              LIMIT 1`,
            [
              options.authority.workspaceId,
              options.skillRevisionId,
              options.authority.principalId,
            ],
          );
          if (candidateRows[0]) return;
          invalid(
            "agent.foundation_invalid_argument",
            "This Skill is no longer available. Choose another Skill or ask its owner to restore access.",
          );
        }
      });
    },
  });
}
