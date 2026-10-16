#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

import {
  agentManagementIdentityForProfileV1,
  defaultAgentWorkspaceProfileV1,
  parseAgentFoundationPackV1,
  parseAgentSkillMetadataV1,
  type AgentFoundationPackSkillV1,
  type StoragePort,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { createDatabaseRuntime } from "@kanvas/database";
import { digestProviderValue } from "@kanvas/database/runtime";
import {
  createAwsS3CompatibleStorageAdapter,
  createAliyunOssStorageAdapter,
  createLocalFilesystemStorageAdapter,
} from "@kanvas/storage";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";

import { loadServerConfig, type ServerConfig } from "../config.js";

interface AdministratorRow extends RowDataPacket {
  readonly authSubjectId: string;
}

interface WorkflowRow extends RowDataPacket {
  readonly id: string;
}

interface StoredObjectRow extends RowDataPacket {
  readonly id: string;
  readonly byteSize: bigint | number | string;
  readonly sha256: string;
  readonly immutableIdentityHash: string | null;
}

interface DraftRow extends RowDataPacket {
  readonly id: string;
  readonly version: number;
  readonly canonicalDigest: string;
}

interface CandidateRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalDigest: string;
  readonly sourceDraftVersion: number;
}

interface CheckRow extends RowDataPacket {
  readonly checkKind: string;
}

interface ReviewRow extends RowDataPacket {
  readonly decision: string;
}

interface PublishedSkillRow extends RowDataPacket {
  readonly id: string;
  readonly runtimeStatus: string | null;
}

const keyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function repositoryPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error("Agent Foundation Pack path escapes the repository root.");
  }
  return absolute;
}

function jsonRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function byteStream(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return Object.freeze({
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      let emitted = false;
      return {
        next(): Promise<IteratorResult<Uint8Array>> {
          if (emitted) {
            return Promise.resolve({ done: true, value: undefined });
          }
          emitted = true;
          return Promise.resolve({ done: false, value: bytes });
        },
      };
    },
  });
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function createStorage(
  config: NonNullable<ServerConfig["storage"]>,
): Promise<StoragePort> {
  if (config.kind === "oss")
    return createAliyunOssStorageAdapter({
      storageProfileId: config.profileId,
      bucket: config.container,
      endpoint: config.endpoint,
      region: config.region,
      keyPrefix: config.keyPrefix,
      ...config.credentials,
      ...(config.stagingDirectory
        ? { stagingDirectory: config.stagingDirectory }
        : {}),
    });
  return config.kind === "local"
    ? createLocalFilesystemStorageAdapter({
        storageProfileId: config.profileId,
        rootDirectory: config.rootDirectory,
        acknowledgeTrustedProcessRoot: true,
      })
    : createAwsS3CompatibleStorageAdapter({
        storageProfileId: config.profileId,
        bucket: config.container,
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
        encryption: config.encryption,
        ...(config.credentials ? { credentials: config.credentials } : {}),
        ...(config.stagingDirectory
          ? { stagingDirectory: config.stagingDirectory }
          : {}),
      });
}

async function administratorSubject(
  pool: Pool,
  workspaceId: string,
): Promise<string> {
  const [rows] = await pool.execute<AdministratorRow[]>(
    `SELECT human.auth_subject_id AS authSubjectId
     FROM instance_administrator AS administrator
     INNER JOIN human_principal AS human
       ON human.principal_id = administrator.principal_id
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = administrator.principal_id
      AND membership.workspace_id = ?
      AND membership.status = 'active'
     WHERE administrator.status = 'active'
     ORDER BY administrator.principal_id
     LIMIT 1`,
    [workspaceId],
  );
  const authSubjectId = rows[0]?.authSubjectId;
  if (!authSubjectId) {
    throw new Error(
      "Agent Foundation bootstrap requires an active Workspace administrator.",
    );
  }
  return authSubjectId;
}

function audit(authority: TrustedWorkspaceScope, requestId: string) {
  return Object.freeze({
    auditEventId: ulid(),
    actorPrincipalId: authority.principalId,
    actorType: authority.principalType,
    authenticationRefType: authority.authenticationRefType,
    authenticationRefHash: digestProviderValue({
      bootstrap: "agent-foundation",
      authority: authority.authenticationRefId,
    }),
    authorityType: authority.authorityType,
    authorityId: authority.authorityId,
    authorityVersion: authority.authorityVersion,
    requestId,
  });
}

async function resolveWorkflowEntrypoints(
  pool: Pool,
  workspaceId: string,
  source: AgentFoundationPackSkillV1,
): Promise<
  readonly {
    readonly entrypointKey: string;
    readonly workflowRevisionId: string;
  }[]
> {
  const result = [];
  for (const entrypoint of source.workflowEntrypoints) {
    const [rows] = await pool.execute<WorkflowRow[]>(
      `SELECT workflow.id
       FROM workflow_revision AS workflow
       INNER JOIN workflow_revision_activation AS activation
         ON activation.workspace_id = workflow.workspace_id
        AND activation.workflow_revision_id = workflow.id
       WHERE workflow.workspace_id = ?
         AND workflow.workflow_key = ?
         AND workflow.lifecycle_status = 'published'
         AND activation.runtime_status = 'enabled'
       ORDER BY workflow.revision DESC
       LIMIT 1`,
      [workspaceId, entrypoint.workflowKey],
    );
    const workflowRevisionId = rows[0]?.id;
    if (!workflowRevisionId) {
      throw new Error(
        "Agent Skill references an unavailable Workflow entrypoint.",
      );
    }
    result.push(
      Object.freeze({
        entrypointKey: entrypoint.entrypointKey,
        workflowRevisionId,
      }),
    );
  }
  return Object.freeze(result);
}

async function registerInstructionObject(options: {
  readonly pool: Pool;
  readonly storage: StoragePort;
  readonly container: string;
  readonly workspaceId: string;
  readonly skillKey: string;
  readonly bytes: Uint8Array;
  readonly now: Date;
}): Promise<{
  readonly storedObjectId: string;
  readonly sha256: string;
  readonly contentDigest: string;
  readonly byteSize: number;
}> {
  const sha256 = createHash("sha256").update(options.bytes).digest("hex");
  const byteSize = options.bytes.byteLength;
  const objectKey = `agent-skills/${options.workspaceId}/${options.skillKey}/${sha256}/SKILL.md`;
  const identity = Object.freeze({
    storageProfileId: options.storage.storageProfileId,
    container: options.container,
    objectKey,
  });
  let inspection = await options.storage.inspectObject(identity);
  if (!inspection) {
    inspection = await options.storage.writeObject({
      identity,
      maximumBytes: String(byteSize),
      body: byteStream(options.bytes),
    });
  }
  if (
    inspection.byteSize !== String(byteSize) ||
    inspection.sha256 !== sha256
  ) {
    throw new Error(
      "Stored Agent Skill instruction facts do not match the Pack.",
    );
  }
  const [existingRows] = await options.pool.execute<StoredObjectRow[]>(
    `SELECT id, byte_size AS byteSize, sha256,
            immutable_identity_hash AS immutableIdentityHash
     FROM stored_object
     WHERE storage_profile_id = ? AND container = ? AND object_key = ?
     LIMIT 1`,
    [options.storage.storageProfileId, options.container, objectKey],
  );
  const existing = existingRows[0];
  if (existing) {
    if (
      String(existing.byteSize) !== String(byteSize) ||
      existing.sha256 !== sha256 ||
      existing.immutableIdentityHash !== inspection.immutableIdentityHash
    ) {
      throw new Error(
        "Stored Agent Skill database facts conflict with the Pack.",
      );
    }
    return Object.freeze({
      storedObjectId: existing.id,
      sha256,
      contentDigest: `sha256:${sha256}`,
      byteSize,
    });
  }
  const uploadId = ulid();
  const storedObjectId = ulid();
  const connection = await options.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO upload_session (
         id, workspace_id, attempt_id, purpose, output_role, output_index,
         storage_profile_id, container, object_key, upload_mode,
         write_protection_mode, state, version, expires_at,
         cleanup_eligible_at, cleanup_state, verified_size, verified_sha256,
         detected_media_type, verification_profile_version,
         committed_stored_object_id, created_at, updated_at, committed_at
       ) VALUES (?, ?, NULL, 'skill_package_import', NULL, NULL, ?, ?, ?,
                 'single_put', 'server_owned', 'verified', 1, ?, ?, 'none',
                 ?, ?, 'text/markdown', 'agent-foundation-pack-v1', NULL,
                 ?, ?, NULL)`,
      [
        uploadId,
        options.workspaceId,
        options.storage.storageProfileId,
        options.container,
        objectKey,
        new Date(options.now.getTime() + 86_400_000),
        new Date(options.now.getTime() + 172_800_000),
        byteSize,
        sha256,
        options.now,
        options.now,
      ],
    );
    await connection.execute(
      `INSERT INTO stored_object (
         id, workspace_id, created_from_upload_session_id,
         storage_profile_id, container, object_key, byte_size, sha256,
         immutable_identity_hash, media_type, delete_state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'text/markdown', 'active', ?)`,
      [
        storedObjectId,
        options.workspaceId,
        uploadId,
        options.storage.storageProfileId,
        options.container,
        objectKey,
        byteSize,
        sha256,
        inspection.immutableIdentityHash,
        options.now,
      ],
    );
    await connection.execute(
      `UPDATE upload_session
       SET state = 'committed', version = 2,
           committed_stored_object_id = ?, committed_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND state = 'verified' AND version = 1`,
      [storedObjectId, options.now, options.now, options.workspaceId, uploadId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return Object.freeze({
    storedObjectId,
    sha256,
    contentDigest: `sha256:${sha256}`,
    byteSize,
  });
}

async function publishSkill(options: {
  readonly database: ReturnType<typeof createDatabaseRuntime>;
  readonly pool: Pool;
  readonly storage: StoragePort;
  readonly container: string;
  readonly authority: TrustedWorkspaceScope;
  readonly repositoryRoot: string;
  readonly source: AgentFoundationPackSkillV1;
  readonly now: Date;
}): Promise<string> {
  const manifestPath = repositoryPath(
    options.repositoryRoot,
    options.source.manifestPath,
  );
  const manifest = jsonRecord(
    await readJson(manifestPath),
    "Agent Skill manifest",
  );
  const skillKey = manifest.skillKey;
  const metadata = parseAgentSkillMetadataV1(manifest);
  if (typeof skillKey !== "string" || !keyPattern.test(skillKey) || !metadata) {
    throw new Error(
      "Agent Skill manifest does not contain valid Agent metadata.",
    );
  }
  const declaredEntrypoints = Array.isArray(manifest.entrypoints)
    ? new Set(
        manifest.entrypoints.flatMap((value) => {
          const entrypoint =
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Readonly<Record<string, unknown>>)
              : undefined;
          return typeof entrypoint?.entrypointKey === "string"
            ? [entrypoint.entrypointKey]
            : [];
        }),
      )
    : new Set<string>();
  if (
    options.source.workflowEntrypoints.some(
      (entrypoint) => !declaredEntrypoints.has(entrypoint.entrypointKey),
    )
  ) {
    throw new Error(
      "Agent Pack entrypoint mapping is absent from its Skill manifest.",
    );
  }
  const instructionRoot = repositoryPath(
    options.repositoryRoot,
    options.source.instructionRootPath,
  );
  const instructionPath = repositoryPath(
    instructionRoot,
    metadata.instructionResourcePath,
  );
  if (
    dirname(instructionPath) !== instructionRoot ||
    basename(instructionPath) !== metadata.instructionResourcePath
  ) {
    throw new Error(
      "Agent Skill instruction resource must be a direct Pack file.",
    );
  }
  const bytes = new Uint8Array(await readFile(instructionPath));
  if (bytes.byteLength < 24 || bytes.byteLength > 262_144) {
    throw new Error(
      "Agent Skill instructions exceed the bounded text resource policy.",
    );
  }
  const resource = await registerInstructionObject({
    pool: options.pool,
    storage: options.storage,
    container: options.container,
    workspaceId: options.authority.workspaceId,
    skillKey,
    bytes,
    now: options.now,
  });
  const workflowEntrypoints = await resolveWorkflowEntrypoints(
    options.pool,
    options.authority.workspaceId,
    options.source,
  );
  const document = Object.freeze({
    schemaVersion: 1 as const,
    manifest,
    resources: Object.freeze([
      Object.freeze({
        path: metadata.instructionResourcePath,
        resourceKind: "instructions" as const,
        storedObjectId: resource.storedObjectId,
        contentDigest: resource.contentDigest,
        mediaType: "text/markdown",
        byteSize: resource.byteSize,
      }),
    ]),
    workflowEntrypoints,
  });
  const canonicalDigest = digestProviderValue(document);
  const [publishedRows] = await options.pool.execute<PublishedSkillRow[]>(
    `SELECT skill.id, activation.runtime_status AS runtimeStatus
     FROM skill_revision AS skill
     LEFT JOIN skill_revision_activation AS activation
       ON activation.workspace_id = skill.workspace_id
      AND activation.skill_revision_id = skill.id
     WHERE skill.workspace_id = ? AND skill.canonical_digest = ?
     LIMIT 1`,
    [options.authority.workspaceId, canonicalDigest],
  );
  const published = publishedRows[0];
  if (published) {
    if (published.runtimeStatus !== "enabled") {
      throw new Error("Existing Agent Skill revision is not enabled.");
    }
    return published.id;
  }
  const [draftRows] = await options.pool.execute<DraftRow[]>(
    `SELECT id, version, canonical_digest AS canonicalDigest
     FROM skill_draft
     WHERE workspace_id = ? AND skill_key = ?
     LIMIT 1`,
    [options.authority.workspaceId, skillKey],
  );
  const existingDraft = draftRows[0];
  const draft =
    existingDraft?.canonicalDigest === canonicalDigest
      ? Object.freeze({ id: existingDraft.id, version: existingDraft.version })
      : await options.database.publicationGovernance.saveDraft({
          draftId: existingDraft?.id ?? ulid(),
          workspaceId: options.authority.workspaceId,
          subjectKind: "skill",
          subjectKey: skillKey,
          visibility: "workspace",
          contentDocument: document,
          expectedVersion: existingDraft?.version ?? 0,
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(options.authority, "agent-foundation.skill-draft"),
        });
  const [candidateRows] = await options.pool.execute<CandidateRow[]>(
    `SELECT id, canonical_digest AS canonicalDigest,
            source_draft_version AS sourceDraftVersion
     FROM publication_candidate
     WHERE workspace_id = ? AND subject_kind = 'skill'
       AND source_draft_id = ? AND source_draft_version = ?
     LIMIT 1`,
    [options.authority.workspaceId, draft.id, draft.version],
  );
  const existingCandidate = candidateRows[0];
  const candidate = existingCandidate
    ? existingCandidate
    : await options.database.publicationGovernance.submitCandidate({
        candidateId: ulid(),
        draftId: draft.id,
        workspaceId: options.authority.workspaceId,
        subjectKind: "skill",
        expectedDraftVersion: draft.version,
        parserProfileVersion: "agent-foundation-pack-v1",
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(options.authority, "agent-foundation.skill-candidate"),
      });
  if (candidate.canonicalDigest !== canonicalDigest) {
    throw new Error("Agent Skill Candidate digest conflicts with the Pack.");
  }
  const [checkRows] = await options.pool.execute<CheckRow[]>(
    `SELECT check_kind AS checkKind
     FROM publication_check
     WHERE workspace_id = ? AND publication_candidate_id = ?`,
    [options.authority.workspaceId, candidate.id],
  );
  const completedChecks = new Set(checkRows.map((row) => row.checkKind));
  const evidence = {
    schema: { manifestSchemaVersion: manifest.schemaVersion },
    resources: {
      instructionDigest: resource.contentDigest,
      byteSize: resource.byteSize,
    },
    security: {
      policy: "agent-skill-instruction-isolation-v1",
      resourcePath: metadata.instructionResourcePath,
    },
    compatibility: {
      workflowRevisionIds: workflowEntrypoints.map(
        (entrypoint) => entrypoint.workflowRevisionId,
      ),
    },
    eval: {
      policy: "agent-foundation-pack-contract-v1",
      exampleRequestCount: metadata.exampleRequests.length,
    },
  } as const;
  for (const checkKind of [
    "schema",
    "resources",
    "security",
    "compatibility",
    "eval",
  ] as const) {
    if (completedChecks.has(checkKind)) continue;
    await options.database.publicationGovernance.recordCheck({
      checkId: ulid(),
      candidateId: candidate.id,
      workspaceId: options.authority.workspaceId,
      checkKind,
      checkProfileVersion: `agent-foundation-${checkKind}-v1`,
      outcome: "passed",
      evidenceSummary: evidence[checkKind],
      expectedCandidateDigest: canonicalDigest,
      actorPrincipalId: options.authority.principalId,
      now: options.now,
      audit: audit(
        options.authority,
        `agent-foundation.skill-check.${checkKind}`,
      ),
    });
  }
  const [reviewRows] = await options.pool.execute<ReviewRow[]>(
    `SELECT decision
     FROM publication_review_decision
     WHERE workspace_id = ? AND publication_candidate_id = ?
     LIMIT 1`,
    [options.authority.workspaceId, candidate.id],
  );
  if (reviewRows[0]?.decision === "rejected") {
    throw new Error("Agent Skill Candidate was rejected.");
  }
  if (!reviewRows[0]) {
    await options.database.publicationGovernance.reviewCandidate({
      reviewDecisionId: ulid(),
      candidateId: candidate.id,
      workspaceId: options.authority.workspaceId,
      decision: "approved",
      expectedCandidateDigest: canonicalDigest,
      commentSummary:
        "First-party Agent Foundation Pack passed repository release gates.",
      actorPrincipalId: options.authority.principalId,
      now: options.now,
      audit: audit(options.authority, "agent-foundation.skill-review"),
    });
  }
  const result = await options.database.publicationGovernance.publishSkill({
    candidateId: candidate.id,
    skillRevisionId: ulid(),
    workspaceId: options.authority.workspaceId,
    expectedCandidateDigest: canonicalDigest,
    actorPrincipalId: options.authority.principalId,
    now: options.now,
    audit: audit(options.authority, "agent-foundation.skill-publish"),
  });
  return result.id;
}

const server = loadServerConfig(process.env, []);
if (server.environment !== "development") {
  throw new Error("Agent Foundation bootstrap is restricted to development.");
}
if (!server.storage) {
  throw new Error(
    "Agent Foundation bootstrap requires configured object storage.",
  );
}
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const configuredPackPath = argument("--pack");
if (!configuredPackPath || isAbsolute(configuredPackPath)) {
  throw new Error(
    "Pass one repository-relative Agent Foundation Pack with --pack.",
  );
}
const workspaceId = argument("--workspace") ?? server.demo.workspaceId;
const packPath = repositoryPath(repositoryRoot, configuredPackPath);
const pack = parseAgentFoundationPackV1(await readJson(packPath));
if (!pack) {
  throw new Error("Agent Foundation Pack is invalid.");
}
const database = createDatabaseRuntime({
  connection: server.database,
  instanceId: server.instanceId,
  enabledExecutionTargets: server.enabledExecutionTargets,
  ...(server.providerDeploymentHardBounds
    ? { providerDeploymentHardBounds: server.providerDeploymentHardBounds }
    : {}),
});
const pool = createPool({
  ...server.database,
  connectionLimit: 2,
  timezone: "Z",
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const storage = await createStorage(server.storage);
try {
  const authSubjectId = await administratorSubject(pool, workspaceId);
  const resolution = await database.authorization.resolveHumanWorkspaceScope({
    authSubjectId,
    sessionId: "agent-foundation-bootstrap",
    requestedWorkspaceId: workspaceId,
    requiredPermission: "workspace.manage",
    now: new Date(),
  });
  if (resolution.status !== "authorized") {
    throw new Error(
      "Agent Foundation bootstrap is not authorized for this Workspace.",
    );
  }
  const now = new Date();
  const profileRevisionIds = [];
  for (const packagedProfile of pack.profiles) {
    const profile =
      packagedProfile.profileKey === defaultAgentWorkspaceProfileV1.profileKey
        ? defaultAgentWorkspaceProfileV1
        : packagedProfile;
    const published = await database.agentProfilePublications.publish({
      authority: resolution.scope,
      agentDefinitionId: ulid(),
      profileRevisionId: ulid(),
      managementKind: agentManagementIdentityForProfileV1(profile.profileKey)
        .managementKind,
      profile,
      now,
      audit: audit(resolution.scope, "agent-foundation.profile-publish"),
    });
    profileRevisionIds.push(published.id);
  }
  const skillRevisionIds = [];
  for (const source of pack.skills) {
    skillRevisionIds.push(
      await publishSkill({
        database,
        pool,
        storage,
        container: server.storage.container,
        authority: resolution.scope,
        repositoryRoot,
        source,
        now,
      }),
    );
  }
  const mainProfileRevisionId = profileRevisionIds[0];
  if (mainProfileRevisionId) {
    for (const [ordinal, skillRevisionId] of skillRevisionIds.entries()) {
      await pool.execute(
        `INSERT INTO agent_revision_skill_binding (
           workspace_id, profile_revision_id, skill_definition_id,
           ordinal, created_at
         )
         SELECT ?, ?, skill_definition_id, ?, ?
           FROM skill_revision
          WHERE workspace_id = ? AND id = ?
         ON DUPLICATE KEY UPDATE
           skill_definition_id = VALUES(skill_definition_id)`,
        [
          workspaceId,
          mainProfileRevisionId,
          ordinal,
          now,
          workspaceId,
          skillRevisionId,
        ],
      );
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      workspaceId,
      packKey: pack.packKey,
      profileRevisionCount: profileRevisionIds.length,
      skillRevisionCount: skillRevisionIds.length,
    })}\n`,
  );
} finally {
  await storage.close?.();
  await pool.end();
  await database.close();
}
