import {
  decodeSkillFile,
  mergeSkillFiles,
  validateSkillFilePaths,
  validateEditableSkillPath,
} from "./skill-files.js";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { Inject, Injectable } from "@nestjs/common";
import { stableAgentRuntimeId } from "@kanvas/agent-runtime";
import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import type {
  SkillFileInput,
  AgentHubSkill,
  AgentHubSkillDetail,
  ChangeSkillRuntimeStatusBody,
  CreateSkillDraftBody,
  RecordSkillCandidateTestBody,
  SkillDraftList,
  SkillDraftDetail,
  SkillDraftSummary,
  SkillRuntimeStatus,
  UpdateSkillDraftBody,
} from "@kanvas/contracts/api";
import {
  AgentHubStoreError,
  inspectAndExtractSkillPackageArchive,
  PublicationDocumentError,
  PublicationGovernanceStoreError,
  parseSkillPublicationDocument,
  SkillLibraryStoreError,
  SkillPackageArchiveError,
  type SkillArchiveFilenameEncoding,
  SkillPackageImportStoreError,
  StorageUploadStoreError,
  digestProviderValue,
  type ControlPlaneAuditContext,
  type DatabaseRuntime,
  type ExtractedSkillArchiveEntry,
  type SkillPublicationDocumentV1,
} from "@kanvas/database/runtime";
import {
  ServerStreamUploadError,
  S3CompatibleStorageError,
  LocalFilesystemStorageError,
} from "@kanvas/storage";

import { DATABASE_RUNTIME, SERVER_STORAGE_RUNTIME } from "../tokens.js";
import type { ServerStorageRuntime } from "../storage/server-storage-runtime.js";
import {
  buildSkillZip,
  parseSkillMarkdown,
  renderSkillMarkdown,
  titleFromSkillBody,
  validateSkillPackageName,
} from "./skill-package.js";

const staticCheckKinds = [
  "schema",
  "resources",
  "security",
  "compatibility",
] as const;
const skillImportPersistenceConcurrency = 4;

async function mapInSettledBatches<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  operation: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const outputs: TOutput[] = [];
  for (let offset = 0; offset < inputs.length; offset += concurrency) {
    const batch = inputs.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map((input, index) => operation(input, offset + index)),
    );
    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;
      outputs.push(result.value);
    }
  }
  return outputs;
}

function mapError(error: unknown): never {
  if (
    (error instanceof S3CompatibleStorageError &&
      error.code === "s3_storage.object_missing") ||
    (error instanceof LocalFilesystemStorageError &&
      error.code === "local_storage.object_missing")
  ) {
    throw new DomainError(
      "skill_library.integrity",
      "Skill content is missing. Its creator must restore or republish the package.",
    );
  }
  if (
    error instanceof AgentHubStoreError ||
    error instanceof PublicationGovernanceStoreError ||
    error instanceof PublicationDocumentError ||
    error instanceof SkillLibraryStoreError ||
    error instanceof SkillPackageArchiveError ||
    error instanceof SkillPackageImportStoreError ||
    error instanceof StorageUploadStoreError ||
    error instanceof ServerStreamUploadError
  ) {
    throw new DomainError(
      "code" in error && typeof error.code === "string"
        ? error.code
        : "skill_library.invalid_package",
      error.message,
    );
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    throw new DomainError("skill_library.invalid_package", error.message);
  }
  throw error;
}

function audit(
  authority: TrustedWorkspaceScope,
  auditEventId: string,
): ControlPlaneAuditContext {
  return {
    auditEventId,
    actorPrincipalId: authority.principalId,
    actorType: authority.principalType,
    authenticationRefType: authority.authenticationRefType,
    authenticationRefHash: digestProviderValue(authority.authenticationRefId),
    authorityType: authority.authorityType,
    authorityId: authority.authorityId,
    authorityVersion: authority.authorityVersion,
  };
}

function draftRecord(
  value: Awaited<
    ReturnType<DatabaseRuntime["skillLibrary"]["listDrafts"]>
  >[number],
): SkillDraftSummary {
  return {
    ...value,
    tags: [...value.tags],
    exampleRequests: [...value.exampleRequests],
    updatedAt: value.updatedAt.toISOString(),
  };
}

function resourceKind(entry: Pick<ExtractedSkillArchiveEntry, "path">) {
  if (entry.path === "SKILL.md") return "instructions" as const;
  if (entry.path.startsWith("references/")) return "reference" as const;
  if (entry.path.startsWith("templates/")) return "template" as const;
  if (entry.path.startsWith("evals/")) return "eval" as const;
  if (entry.path.startsWith("assets/")) return "asset" as const;
  return "reference" as const;
}

export function skillPublicationResource(resource: {
  readonly storedObjectId: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256?: string;
}) {
  return Object.freeze({
    storedObjectId: resource.storedObjectId,
    contentDigest: resource.contentDigest,
    mediaType: resource.mediaType,
    byteSize: resource.byteSize,
  });
}

function skillManifest(options: {
  readonly skillKey: string;
  readonly displayName: string;
  readonly summary: string;
  readonly exampleRequests: readonly string[];
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    skillKey: options.skillKey,
    displayName: options.displayName,
    nonProduction: false,
    agent: Object.freeze({
      surfaceKinds: Object.freeze(["agent_workspace"]),
      toolFamilies: Object.freeze(["query", "canvas_command", "workflow"]),
      summary: options.summary,
      exampleRequests: Object.freeze([...options.exampleRequests]),
      instructionResourcePath: "SKILL.md",
    }),
    entrypoints: Object.freeze([]),
  });
}

@Injectable()
export class SkillLibraryService {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined = undefined,
  ) {}

  public async listDrafts(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<SkillDraftList> {
    try {
      const items = await this.database.skillLibrary.listDrafts(authority, now);
      return { items: items.map(draftRecord) };
    } catch (error) {
      return mapError(error);
    }
  }

  public async getPublishedSkill(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId: string;
    readonly now: Date;
  }): Promise<AgentHubSkillDetail> {
    try {
      const item = (
        await this.database.agentHub.listSkills(options.authority, options.now)
      ).find((skill) => skill.id === options.skillDefinitionId);
      if (!item) {
        throw new DomainError(
          "skill_library.not_found",
          "Published Skill was not found.",
        );
      }
      const skill = await this.database.skillLibrary.readRevisionPackage({
        authority: options.authority,
        skillDefinitionId: item.id,
        skillRevisionId: item.skillRevisionId,
        now: options.now,
      });
      const instructions = skill.resources.find(
        (resource) => resource.resourceKind === "instructions",
      );
      if (!instructions) {
        throw new DomainError(
          "skill_library.integrity",
          "Published Skill instructions are unavailable.",
        );
      }
      const profile = this.requireStorage().profiles.resolve(
        instructions.storageProfileId,
      );
      if (!profile) {
        throw new DomainError(
          "skill_library.storage_unavailable",
          "Skill resource storage is unavailable.",
        );
      }
      const handle = await profile.adapter.openRead({
        identity: {
          storageProfileId: instructions.storageProfileId,
          container: instructions.container,
          objectKey: instructions.objectKey,
          ...(instructions.storageVersionId
            ? { storageVersionId: instructions.storageVersionId }
            : {}),
        },
        expectedByteSize: String(instructions.byteSize),
        expectedSha256: instructions.sha256,
        expectedImmutableIdentityHash: instructions.immutableIdentityHash,
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of handle.body) chunks.push(chunk);
      const parsed = parseSkillMarkdown(Buffer.concat(chunks));
      return {
        id: item.id,
        skillKey: item.skillKey,
        displayName: item.displayName,
        summary: item.summary,
        ...(item.coverAssetId ? { coverAssetId: item.coverAssetId } : {}),
        ...(item.category ? { category: item.category } : {}),
        tags: [...item.tags],
        exampleRequests: [...item.exampleRequests],

        ownerPrincipalId: item.ownerPrincipalId,
        visibility: item.visibility,
        version: item.version,
        skillRevisionId: item.skillRevisionId,
        skillRevision: item.skillRevision,
        runtimeStatus: item.runtimeStatus,
        activationVersion: item.activationVersion,
        updatedAt: item.updatedAt.toISOString(),
        description: parsed.description,
        instructions: parsed.bodyMarkdown,
        resources: skill.resources.map((resource) => ({
          path: resource.path,
          resourceKind: resource.resourceKind,
          mediaType: resource.mediaType,
          byteSize: resource.byteSize,
        })),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async createDraft(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly body: CreateSkillDraftBody;
    readonly idempotencyKey: string;
    readonly now: Date;
    readonly agentAttachments?: {
      readonly runId: string;
      readonly files: readonly {
        readonly path: string;
        readonly artifactId: string;
      }[];
    };
    readonly derivation?: {
      readonly sourceThreadId: string;
      readonly sourceRunId: string;
      readonly sourceArtifactId?: string;
      readonly sourceDigest: string;
    };
  }): Promise<SkillDraftSummary> {
    try {
      const attachmentResources = await this.resolveAgentAttachments(
        options.authority,
        options.agentAttachments,
        options.now,
      );
      const name = validateSkillPackageName(options.body.name);
      const skillKey = `workspace.${name}`;
      const identity = digestProviderValue({
        workspaceId: options.authority.workspaceId,
        principalId: options.authority.principalId,
        idempotencyKey: options.idempotencyKey,
      });
      const draftId = stableAgentRuntimeId("skill-draft", identity, 1);
      const markdown = renderSkillMarkdown({
        name,
        description: options.body.description,
        bodyMarkdown: options.body.instructions,
      });
      const resource = await this.persistResource({
        authority: options.authority,
        identity,
        ordinal: 1,
        path: "SKILL.md",
        mediaType: "text/markdown",
        bytes: Buffer.from(markdown, "utf8"),
        now: options.now,
      });
      const files = await this.persistFiles({
        authority: options.authority,
        identity,
        files: options.body.files ?? [],
        now: options.now,
      });
      const document: SkillPublicationDocumentV1 = {
        schemaVersion: 1,
        manifest: skillManifest({
          skillKey,
          displayName: options.body.displayName.trim(),
          summary: options.body.summary.trim(),
          exampleRequests: options.body.exampleRequests,
        }),
        resources: [
          ...files,
          ...attachmentResources,
          {
            path: "SKILL.md",
            resourceKind: "instructions",
            ...skillPublicationResource(resource),
          },
        ],
        workflowEntrypoints: [],
      };
      validateSkillFilePaths(document.resources.map((file) => file.path));
      const replay = await this.database.publicationGovernance.getDraft(
        options.authority.workspaceId,
        "skill",
        draftId,
      );
      if (replay) {
        if (
          replay.subjectKey !== skillKey ||
          replay.canonicalDigest !== digestProviderValue(document)
        ) {
          throw new DomainError(
            "skill_library.identity_conflict",
            "Skill creation was replayed with different content.",
          );
        }
        return await this.requireDraft(options.authority, draftId, options.now);
      }
      await this.database.publicationGovernance.saveDraft({
        draftId,
        workspaceId: options.authority.workspaceId,
        subjectKind: "skill",
        subjectKey: skillKey,
        visibility: options.body.visibility,
        contentDocument: document,
        expectedVersion: 0,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-draft-audit", identity, 1),
        ),
      });
      await this.database.skillLibrary.updatePresentation({
        authority: options.authority,
        skillDefinitionId: draftId,
        expectedVersion: 1,
        displayName: options.body.displayName.trim(),
        summary: options.body.summary.trim(),
        ...(options.body.coverAssetId
          ? { coverAssetId: options.body.coverAssetId }
          : {}),
        ...(options.body.category
          ? { category: options.body.category.trim() }
          : {}),
        tags: options.body.tags,
        exampleRequests: options.body.exampleRequests,

        now: options.now,
      });
      if (options.derivation) {
        await this.database.skillLibrary.recordDerivation({
          authority: options.authority,
          skillDefinitionId: draftId,
          ...options.derivation,
          now: options.now,
        });
      }
      return await this.requireDraft(options.authority, draftId, options.now);
    } catch (error) {
      return mapError(error);
    }
  }

  public async resolveDerivationSource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly artifactId: string;
    readonly now: Date;
  }): Promise<{ readonly sourceRunId: string }> {
    try {
      return await this.database.skillLibrary.resolveDerivationSource(options);
    } catch (error) {
      return mapError(error);
    }
  }

  public async getDraft(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly now: Date;
  }): Promise<SkillDraftDetail> {
    try {
      const summary = await this.requireDraft(
        options.authority,
        options.draftId,
        options.now,
      );
      const draft = await this.database.publicationGovernance.getDraft(
        options.authority.workspaceId,
        "skill",
        options.draftId,
      );
      if (!draft) {
        throw new DomainError(
          "skill_library.not_found",
          "Skill Draft was not found.",
        );
      }
      const document = parseSkillPublicationDocument(draft.contentDocument);
      const agent =
        document.manifest.agent &&
        typeof document.manifest.agent === "object" &&
        !Array.isArray(document.manifest.agent)
          ? (document.manifest.agent as Readonly<Record<string, unknown>>)
          : {};
      const path =
        typeof agent.instructionResourcePath === "string"
          ? agent.instructionResourcePath
          : "SKILL.md";
      const resource = document.resources.find(
        (item) => item.resourceKind === "instructions" && item.path === path,
      );
      if (!resource) {
        throw new DomainError(
          "skill_library.integrity",
          "Skill Draft instructions are unavailable.",
        );
      }
      const stored = await this.database.skillLibrary.readDraftResource({
        authority: options.authority,
        draftId: draft.id,
        storedObjectId: resource.storedObjectId,
        now: options.now,
      });
      const profile = this.requireStorage().profiles.resolve(
        stored.storageProfileId,
      );
      if (!profile) {
        throw new DomainError(
          "skill_library.storage_unavailable",
          "Skill resource storage is unavailable.",
        );
      }
      const handle = await profile.adapter.openRead({
        identity: {
          storageProfileId: stored.storageProfileId,
          container: stored.container,
          objectKey: stored.objectKey,
          ...(stored.storageVersionId
            ? { storageVersionId: stored.storageVersionId }
            : {}),
        },
        expectedByteSize: String(stored.byteSize),
        expectedSha256: stored.sha256,
        expectedImmutableIdentityHash: stored.immutableIdentityHash,
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of handle.body) chunks.push(chunk);
      const parsed = parseSkillMarkdown(Buffer.concat(chunks));
      return {
        ...summary,
        packageName: parsed.name,
        resources: document.resources.map((file) => ({
          path: file.path,
          resourceKind: file.resourceKind,
          mediaType: file.mediaType,
          byteSize: file.byteSize,
        })),
        description: parsed.description,
        instructions: parsed.bodyMarkdown,
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async updateDraft(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly body: UpdateSkillDraftBody;
    readonly now: Date;
    readonly agentAttachments?: {
      readonly runId: string;
      readonly files: readonly {
        readonly path: string;
        readonly artifactId: string;
      }[];
    };
  }): Promise<SkillDraftSummary> {
    try {
      await this.requireDraft(options.authority, options.draftId, options.now);
      const attachmentResources = await this.resolveAgentAttachments(
        options.authority,
        options.agentAttachments,
        options.now,
      );
      const current = await this.database.publicationGovernance.getDraft(
        options.authority.workspaceId,
        "skill",
        options.draftId,
      );
      if (!current || !current.skillDefinitionId) {
        throw new DomainError(
          "skill_library.not_found",
          "Skill Draft was not found.",
        );
      }
      if (current.version !== options.body.expectedDraftVersion)
        throw new DomainError(
          "publication.version_conflict",
          "Skill Draft changed. Reload before saving.",
        );
      const previous = parseSkillPublicationDocument(current.contentDocument);
      const previousAgent =
        previous.manifest.agent &&
        typeof previous.manifest.agent === "object" &&
        !Array.isArray(previous.manifest.agent)
          ? (previous.manifest.agent as Record<string, unknown>)
          : {};
      for (const path of options.body.removedPaths ?? [])
        validateEditableSkillPath(path);
      const name = validateSkillPackageName(
        current.subjectKey.replace(/^workspace\./u, ""),
      );
      const identity = digestProviderValue({
        workspaceId: options.authority.workspaceId,
        draftId: options.draftId,
        draftVersion: options.body.expectedDraftVersion,
        content: options.body.instructions,
        description: options.body.description,
        files: options.body.files ?? [],
        removedPaths: options.body.removedPaths ?? [],
      });
      const markdown = renderSkillMarkdown({
        name,
        description: options.body.description,
        bodyMarkdown: options.body.instructions,
      });
      const resource = await this.persistResource({
        authority: options.authority,
        identity,
        ordinal: 1,
        path: "SKILL.md",
        mediaType: "text/markdown",
        bytes: Buffer.from(markdown, "utf8"),
        now: options.now,
      });
      const files = await this.persistFiles({
        authority: options.authority,
        identity,
        files: options.body.files ?? [],
        now: options.now,
      });
      const document = mergeSkillFiles(
        previous,
        [
          {
            path: "SKILL.md",
            resourceKind: "instructions",
            ...skillPublicationResource(resource),
          },
          ...files,
          ...attachmentResources,
        ],
        options.body.removedPaths,
      );
      await this.database.publicationGovernance.saveDraft({
        draftId: current.id,
        workspaceId: options.authority.workspaceId,
        subjectKind: "skill",
        subjectKey: current.subjectKey,
        contentDocument: {
          ...document,
          manifest: {
            ...document.manifest,
            displayName: options.body.displayName.trim(),
            agent: {
              ...previousAgent,
              summary: options.body.summary.trim(),
              exampleRequests: options.body.exampleRequests,
            },
          },
        },
        expectedVersion: options.body.expectedDraftVersion,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-draft-update-audit", identity, 1),
        ),
      });
      await this.database.skillLibrary.updatePresentation({
        authority: options.authority,
        skillDefinitionId: current.skillDefinitionId,
        expectedVersion: options.body.expectedPresentationVersion,
        displayName: options.body.displayName.trim(),
        summary: options.body.summary.trim(),
        ...(options.body.coverAssetId
          ? { coverAssetId: options.body.coverAssetId }
          : {}),
        ...(options.body.category
          ? { category: options.body.category.trim() }
          : {}),
        tags: options.body.tags,
        exampleRequests: options.body.exampleRequests,

        now: options.now,
      });
      await this.database.agentHub.setVisibility({
        authority: options.authority,
        subjectKind: "skill",
        subjectId: current.skillDefinitionId,
        expectedVersion: options.body.expectedDefinitionVersion,
        visibility: options.body.visibility,
        now: options.now,
      });
      return await this.requireDraft(
        options.authority,
        current.id,
        options.now,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async importPackage(options: {
    readonly filenameEncoding?: SkillArchiveFilenameEncoding;
    readonly authority: TrustedWorkspaceScope;
    readonly idempotencyKey: string;
    readonly bytes: Uint8Array;
    readonly now: Date;
  }): Promise<SkillDraftSummary> {
    const identity = digestProviderValue({
      workspaceId: options.authority.workspaceId,
      principalId: options.authority.principalId,
      idempotencyKey: options.idempotencyKey,
    });
    const importId = stableAgentRuntimeId("skill-import", identity, 1);
    try {
      const compatibilityProbeId = (
        await this.requireStorage().ensureCompatibilityProbe(
          options.authority.workspaceId,
          stableAgentRuntimeId("skill-package-probe", identity, 1),
          options.now,
        )
      ).id;
      const archiveResource = await this.persistResource({
        authority: options.authority,
        identity,
        ordinal: 0,
        path: "skill.zip",
        mediaType: "application/zip",
        bytes: options.bytes,
        now: options.now,
        compatibilityProbeId,
      });
      let imported = await this.database.skillPackageImports.createQuarantine({
        importId,
        workspaceId: options.authority.workspaceId,
        sourceStoredObjectId: archiveResource.storedObjectId,
        rawArchiveSha256: archiveResource.sha256,
        parserProfileVersion: "agent-skills-zip-v1",
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-import-audit", identity, 1),
        ),
      });
      let archive;
      try {
        archive = inspectAndExtractSkillPackageArchive(
          options.bytes,
          undefined,
          options.filenameEncoding,
        );
        const index = archive.entries.find(
          (entry) => entry.path === "SKILL.md",
        );
        if (!index)
          throw new TypeError("Skill ZIP must contain SKILL.md at its root.");
        parseSkillMarkdown(index.bytes);
      } catch (error) {
        await this.database.skillPackageImports.reject({
          importId,
          workspaceId: options.authority.workspaceId,
          expectedVersion: imported.version,
          rejectionCode:
            error instanceof SkillPackageArchiveError
              ? error.code
              : "skill_library.invalid_package",
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(
            options.authority,
            stableAgentRuntimeId("skill-import-reject-audit", identity, 1),
          ),
        });
        throw error;
      }
      imported = await this.database.skillPackageImports.recordValidated({
        importId,
        workspaceId: options.authority.workspaceId,
        expectedVersion: imported.version,
        archive,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-import-validate-audit", identity, 1),
        ),
      });
      const index = archive.entries.find((entry) => entry.path === "SKILL.md");
      if (!index)
        throw new TypeError("Skill ZIP must contain SKILL.md at its root.");
      const parsed = parseSkillMarkdown(index.bytes);
      const skillKey = `workspace.${parsed.name}`;
      const resources = await mapInSettledBatches(
        archive.entries,
        skillImportPersistenceConcurrency,
        async (entry, entryIndex) => {
          const stored = await this.persistResource({
            authority: options.authority,
            identity,
            ordinal: entryIndex + 1,
            path: entry.path,
            mediaType: entry.mediaType,
            bytes: entry.bytes,
            now: options.now,
            compatibilityProbeId,
          });
          return {
            path: entry.path,
            resourceKind: resourceKind(entry),
            ...skillPublicationResource(stored),
          };
        },
      );
      const draftId = stableAgentRuntimeId("skill-import-draft", identity, 1);
      const displayName = titleFromSkillBody(parsed.bodyMarkdown, parsed.name);
      await this.database.publicationGovernance.saveDraft({
        draftId,
        workspaceId: options.authority.workspaceId,
        subjectKind: "skill",
        subjectKey: skillKey,
        contentDocument: {
          schemaVersion: 1,
          manifest: skillManifest({
            skillKey,
            displayName,
            summary: parsed.description,
            exampleRequests: [],
          }),
          resources,
          workflowEntrypoints: [],
        },
        expectedVersion: 0,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-import-draft-audit", identity, 1),
        ),
      });
      await this.database.skillLibrary.updatePresentation({
        authority: options.authority,
        skillDefinitionId: draftId,
        expectedVersion: 1,
        displayName,
        summary: parsed.description,
        tags: [],
        exampleRequests: [],

        now: options.now,
      });
      await this.database.skillPackageImports.linkDraft({
        importId,
        workspaceId: options.authority.workspaceId,
        expectedVersion: imported.version,
        skillDraftId: draftId,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-import-link-audit", identity, 1),
        ),
      });
      return await this.requireDraft(options.authority, draftId, options.now);
    } catch (error) {
      return mapError(error);
    }
  }

  public async archiveDraft(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly now: Date;
  }): Promise<void> {
    try {
      const identity = `${options.draftId}:${options.expectedVersion}`;
      await this.database.publicationGovernance.archiveDraft({
        draftId: options.draftId,
        workspaceId: options.authority.workspaceId,
        subjectKind: "skill",
        expectedVersion: options.expectedVersion,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-archive-audit", identity, 1),
        ),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  public async submitCandidate(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<SkillDraftSummary> {
    try {
      const identity = digestProviderValue({
        workspaceId: options.authority.workspaceId,
        draftId: options.draftId,
        draftVersion: options.expectedDraftVersion,
        idempotencyKey: options.idempotencyKey,
      });
      const candidateId = stableAgentRuntimeId("skill-candidate", identity, 1);
      const candidate =
        await this.database.publicationGovernance.submitCandidate({
          candidateId,
          draftId: options.draftId,
          workspaceId: options.authority.workspaceId,
          subjectKind: "skill",
          expectedDraftVersion: options.expectedDraftVersion,
          parserProfileVersion: "agent-skills-v1",
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(
            options.authority,
            stableAgentRuntimeId("skill-candidate-audit", identity, 1),
          ),
        });
      const recorded = new Set(
        await this.database.publicationGovernance.listCandidateChecks(
          options.authority.workspaceId,
          candidate.id,
        ),
      );
      for (const [index, checkKind] of staticCheckKinds.entries()) {
        if (recorded.has(checkKind)) continue;
        await this.database.publicationGovernance.recordCheck({
          checkId: stableAgentRuntimeId(
            "skill-candidate-check",
            identity,
            index + 1,
          ),
          candidateId: candidate.id,
          workspaceId: options.authority.workspaceId,
          checkKind,
          checkProfileVersion: "agent-skills-v1",
          outcome: "passed",
          evidenceSummary: Object.freeze({
            candidateDigest: candidate.canonicalDigest,
            profile: "agent-skills-v1",
          }),
          expectedCandidateDigest: candidate.canonicalDigest,
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(
            options.authority,
            stableAgentRuntimeId("skill-check-audit", identity, index + 1),
          ),
        });
      }
      return await this.requireDraft(
        options.authority,
        options.draftId,
        options.now,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async publishCandidate(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly expectedCandidateDigest: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<AgentHubSkill> {
    try {
      const candidate = await this.database.publicationGovernance.getCandidate(
        options.authority.workspaceId,
        options.candidateId,
      );
      if (!candidate || candidate.subjectKind !== "skill") {
        throw new DomainError(
          "skill_library.not_found",
          "Skill Candidate was not found.",
        );
      }
      const identity = digestProviderValue({
        candidateId: candidate.id,
        candidateDigest: options.expectedCandidateDigest,
        idempotencyKey: options.idempotencyKey,
      });
      await this.database.publicationGovernance.publishSkill({
        candidateId: candidate.id,
        skillRevisionId: stableAgentRuntimeId("skill-revision", identity, 1),
        workspaceId: options.authority.workspaceId,
        expectedCandidateDigest: options.expectedCandidateDigest,
        actorPrincipalId: options.authority.principalId,
        now: options.now,
        audit: audit(
          options.authority,
          stableAgentRuntimeId("skill-publish-audit", identity, 1),
        ),
      });
      const item = (
        await this.database.agentHub.listSkills(options.authority, options.now)
      ).find((value) => value.skillKey === candidate.subjectKey);
      if (!item)
        throw new DomainError(
          "skill_library.integrity",
          "Published Skill cannot be reloaded.",
        );
      return {
        ...item,
        tags: [...item.tags],
        exampleRequests: [...item.exampleRequests],
        updatedAt: item.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async recordCandidateTest(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly candidateId: string;
    readonly body: RecordSkillCandidateTestBody;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<SkillDraftSummary> {
    try {
      const candidate = await this.database.publicationGovernance.getCandidate(
        options.authority.workspaceId,
        options.candidateId,
      );
      if (
        !candidate ||
        candidate.subjectKind !== "skill" ||
        candidate.canonicalDigest !== options.body.expectedCandidateDigest
      ) {
        throw new DomainError(
          "skill_library.candidate_changed",
          "Skill Candidate was not found or has changed.",
        );
      }
      await this.database.skillLibrary.verifyCandidateTestEvidence({
        authority: options.authority,
        candidateId: candidate.id,
        threadId: options.body.threadId,
        runId: options.body.runId,
        ...(options.body.artifactId
          ? { artifactId: options.body.artifactId }
          : {}),
        now: options.now,
      });
      const recorded =
        await this.database.publicationGovernance.listCandidateChecks(
          options.authority.workspaceId,
          candidate.id,
        );
      if (!recorded.includes("eval")) {
        const identity = digestProviderValue({
          candidateId: candidate.id,
          runId: options.body.runId,
          idempotencyKey: options.idempotencyKey,
        });
        await this.database.publicationGovernance.recordCheck({
          checkId: stableAgentRuntimeId("skill-candidate-eval", identity, 1),
          candidateId: candidate.id,
          workspaceId: options.authority.workspaceId,
          checkKind: "eval",
          checkProfileVersion: "agent-skill-candidate-run-v1",
          outcome: "passed",
          evidenceSummary: Object.freeze({
            threadId: options.body.threadId,
            runId: options.body.runId,
            ...(options.body.artifactId
              ? { artifactId: options.body.artifactId }
              : {}),
            testRequest: options.body.testRequest.trim(),
          }),
          expectedCandidateDigest: candidate.canonicalDigest,
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(
            options.authority,
            stableAgentRuntimeId("skill-candidate-eval-audit", identity, 1),
          ),
        });
      }
      return await this.requireDraft(
        options.authority,
        candidate.sourceDraftId,
        options.now,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async changeRuntimeStatus(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillRevisionId: string;
    readonly body: ChangeSkillRuntimeStatusBody;
    readonly now: Date;
  }): Promise<SkillRuntimeStatus> {
    try {
      const result =
        await this.database.publicationGovernance.changeRuntimeStatus({
          workspaceId: options.authority.workspaceId,
          subjectKind: "skill",
          revisionId: options.skillRevisionId,
          expectedVersion: options.body.expectedVersion,
          runtimeStatus: options.body.runtimeStatus,
          ...(options.body.reasonCode
            ? { reasonCode: options.body.reasonCode }
            : {}),
          actorPrincipalId: options.authority.principalId,
          now: options.now,
          audit: audit(
            options.authority,
            stableAgentRuntimeId(
              "skill-runtime-status-audit",
              `${options.skillRevisionId}:${options.body.expectedVersion}`,
              1,
            ),
          ),
        });
      return {
        skillRevisionId: result.revisionId,
        runtimeStatus: result.runtimeStatus,
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async exportPackage(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId: string;
    readonly now: Date;
  }): Promise<{ readonly filename: string; readonly bytes: Buffer }> {
    try {
      const storage = this.requireStorage();
      const skill =
        await this.database.skillLibrary.readRevisionPackage(options);
      const entries: { path: string; bytes: Uint8Array }[] = [];
      for (const resource of skill.resources) {
        const profile = storage.profiles.resolve(resource.storageProfileId);
        if (!profile) {
          throw new DomainError(
            "skill_library.storage_unavailable",
            "Skill resource storage is unavailable.",
          );
        }
        const handle = await profile.adapter.openRead({
          identity: {
            storageProfileId: resource.storageProfileId,
            container: resource.container,
            objectKey: resource.objectKey,
            ...(resource.storageVersionId
              ? { storageVersionId: resource.storageVersionId }
              : {}),
          },
          expectedByteSize: String(resource.byteSize),
          expectedSha256: resource.sha256,
          expectedImmutableIdentityHash: resource.immutableIdentityHash,
        });
        const chunks: Uint8Array[] = [];
        for await (const chunk of handle.body) chunks.push(chunk);
        entries.push({ path: resource.path, bytes: Buffer.concat(chunks) });
      }
      if (!entries.some((entry) => entry.path === "kanvas.yaml")) {
        entries.push({
          path: "kanvas.yaml",
          bytes: Buffer.from(
            [
              "schemaVersion: 1",
              `skillKey: ${JSON.stringify(skill.skillKey)}`,
              `revision: ${String(skill.skillRevision)}`,
              `packageDigest: ${JSON.stringify(skill.packageDigest)}`,
              "",
            ].join("\n"),
            "utf8",
          ),
        });
      }
      const name = skill.skillKey
        .replace(/^workspace\./u, "")
        .replaceAll(".", "-");
      return { filename: `${name}.zip`, bytes: buildSkillZip(entries) };
    } catch (error) {
      return mapError(error);
    }
  }

  public async readFile(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillDefinitionId?: string;
    readonly skillRevisionId?: string;
    readonly draftId?: string;
    readonly draftVersion?: number;
    readonly path: string;
    readonly now: Date;
  }): Promise<{ bytes: Buffer; mediaType: string; filename: string }> {
    try {
      if (options.draftId) {
        const summary = await this.requireDraft(
          options.authority,
          options.draftId,
          options.now,
        );
        if (summary.draftVersion !== options.draftVersion)
          throw new DomainError(
            "publication.version_conflict",
            "Skill Draft changed. Reopen it before reading this file.",
          );
        const draft = await this.database.publicationGovernance.getDraft(
          options.authority.workspaceId,
          "skill",
          options.draftId,
        );
        if (!draft || draft.version !== options.draftVersion)
          throw new DomainError(
            "publication.version_conflict",
            "Skill Draft changed.",
          );
        const document = parseSkillPublicationDocument(draft.contentDocument);
        const file = document.resources.find(
          (item) => item.path === options.path,
        );
        if (!file)
          throw new DomainError(
            "skill_library.not_found",
            "Skill file was not found.",
          );
        const stored = await this.database.skillLibrary.readDraftResource({
          authority: options.authority,
          draftId: options.draftId,
          storedObjectId: file.storedObjectId,
          now: options.now,
        });
        return {
          bytes: await this.readResourceBytes(stored),
          mediaType: file.mediaType,
          filename: options.path.split("/").at(-1)!,
        };
      }
      if (!options.skillDefinitionId)
        throw new TypeError("Skill identity is required.");
      const revision = await this.database.skillLibrary.readRevisionPackage({
        authority: options.authority,
        skillDefinitionId: options.skillDefinitionId,
        ...(options.skillRevisionId
          ? { skillRevisionId: options.skillRevisionId }
          : {}),
        now: options.now,
      });
      const file = revision.resources.find(
        (item) => item.path === options.path,
      );
      if (!file)
        throw new DomainError(
          "skill_library.not_found",
          "Skill file was not found.",
        );
      return {
        bytes: await this.readResourceBytes(file),
        mediaType: file.mediaType,
        filename: options.path.split("/").at(-1)!,
      };
    } catch (error) {
      return mapError(error);
    }
  }

  private async readResourceBytes(resource: {
    storageProfileId: string;
    container: string;
    objectKey: string;
    storageVersionId?: string;
    byteSize: number;
    sha256: string;
    immutableIdentityHash: string;
  }): Promise<Buffer> {
    const profile = this.requireStorage().profiles.resolve(
      resource.storageProfileId,
    );
    if (!profile)
      throw new DomainError(
        "skill_library.storage_unavailable",
        "Skill storage is unavailable.",
      );
    const handle = await profile.adapter.openRead({
      identity: {
        storageProfileId: resource.storageProfileId,
        container: resource.container,
        objectKey: resource.objectKey,
        ...(resource.storageVersionId
          ? { storageVersionId: resource.storageVersionId }
          : {}),
      },
      expectedByteSize: String(resource.byteSize),
      expectedSha256: resource.sha256,
      expectedImmutableIdentityHash: resource.immutableIdentityHash,
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of handle.body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  private async persistFiles(options: {
    authority: TrustedWorkspaceScope;
    identity: string;
    files: readonly SkillFileInput[];
    now: Date;
  }): Promise<SkillPublicationDocumentV1["resources"]> {
    if (
      new Set(options.files.map((file) => file.path)).size !==
      options.files.length
    )
      throw new TypeError("Skill file paths must be unique.");
    validateSkillFilePaths([
      "SKILL.md",
      "kanvas.yaml",
      ...options.files.map((file) => file.path),
    ]);
    const result = [];
    for (const [index, input] of options.files.entries()) {
      const file = decodeSkillFile(input);
      const stored = await this.persistResource({
        authority: options.authority,
        identity: options.identity,
        ordinal: index + 2,
        ...file,
        now: options.now,
      });
      result.push({
        path: file.path,
        resourceKind: resourceKind(file),
        ...skillPublicationResource(stored),
      });
    }
    return result;
  }

  private requireStorage(): ServerStorageRuntime {
    if (!this.storage) {
      throw new DomainError(
        "skill_library.storage_unavailable",
        "Skill package storage is not configured.",
      );
    }
    return this.storage;
  }

  private async persistResource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly identity: string;
    readonly ordinal: number;
    readonly path: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
    readonly now: Date;
    readonly compatibilityProbeId?: string;
  }) {
    const storage = this.requireStorage();
    if (
      options.bytes.byteLength < 1 ||
      options.bytes.byteLength > 64 * 1024 * 1024
    ) {
      throw new RangeError("Skill package resource exceeds the 64 MiB limit.");
    }
    const sha256 = createHash("sha256").update(options.bytes).digest("hex");
    const uploadSessionId = stableAgentRuntimeId(
      "skill-package-upload",
      options.identity,
      options.ordinal + 1,
    );
    const storedObjectId = stableAgentRuntimeId(
      "skill-package-object",
      options.identity,
      options.ordinal + 1,
    );
    const compatibilityProbeId =
      options.compatibilityProbeId ??
      (
        await storage.ensureCompatibilityProbe(
          options.authority.workspaceId,
          stableAgentRuntimeId(
            "skill-package-probe",
            options.identity,
            options.ordinal + 1,
          ),
          options.now,
        )
      ).id;
    const expiresAt = new Date(options.now.getTime() + 10 * 60_000);
    const session = await this.database.storageUploads.allocateUploadSession({
      id: uploadSessionId,
      workspaceId: options.authority.workspaceId,
      actorId: options.authority.principalId,
      authority: options.authority,
      allocationRequestKey: `skill-package:${uploadSessionId}`,
      allocationRequestHash: digestProviderValue({
        identity: options.identity,
        ordinal: options.ordinal,
        path: options.path,
        mediaType: options.mediaType,
        byteSize: options.bytes.byteLength,
        sha256,
      }),
      purpose: "server_package",
      expectedSize: String(options.bytes.byteLength),
      expectedMediaType: options.mediaType,
      expectedSha256: sha256,
      storageProfileId: storage.profileId,
      compatibilityProbeId,
      profileConfigurationHash: storage.profileConfigurationHash,
      container: storage.container,
      objectKey: [
        "workspaces",
        options.authority.workspaceId,
        "skill-packages",
        uploadSessionId,
        createHash("sha256").update(options.path).digest("hex"),
      ].join("/"),
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      verificationProfileVersion: "skill-package-opaque-v1",
      now: options.now,
      expiresAt,
      cleanupEligibleAt: new Date(
        expiresAt.getTime() + storage.cleanupGraceMilliseconds,
      ),
    });
    if (session.state !== "committed") {
      await storage.packageUploads.ingest({
        session,
        body: Readable.from([Buffer.from(options.bytes)]),
      });
    }
    return await this.database.skillLibrary.commitPackageResource({
      authority: options.authority,
      uploadSessionId,
      storedObjectId,
      now: options.now,
    });
  }

  private async resolveAgentAttachments(
    authority: TrustedWorkspaceScope,
    attachments:
      | {
          readonly runId: string;
          readonly files: readonly {
            readonly path: string;
            readonly artifactId: string;
          }[];
        }
      | undefined,
    now: Date,
  ): Promise<SkillPublicationDocumentV1["resources"]> {
    if (!attachments?.files.length) return [];
    const messages = await this.database.agentRuntime.listRunMessages(
      authority,
      attachments.runId,
      200,
      now,
    );
    const allowed = new Set(
      messages
        .filter((message) => message.message.role === "user")
        .flatMap((message) =>
          (message.message.referencedResources ?? []).flatMap((resource) =>
            resource.artifactId ? [resource.artifactId] : [],
          ),
        ),
    );
    const resources: SkillPublicationDocumentV1["resources"][number][] = [];
    for (const file of attachments.files) {
      validateEditableSkillPath(file.path);
      if (!allowed.has(file.artifactId))
        throw new DomainError(
          "skill_library.attachment_unavailable",
          "Choose an image attached to this conversation.",
        );
      const source =
        await this.database.storageUploads.readAuthorizedCommittedObject({
          workspaceId: authority.workspaceId,
          artifactId: file.artifactId,
          allowedDataClassifications: [
            "internal",
            "confidential",
            "restricted",
          ],
        });
      const media = source.mediaType;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(media) ||
        (media === "image/png" && !/\.png$/iu.test(file.path)) ||
        (media === "image/jpeg" && !/\.jpe?g$/iu.test(file.path)) ||
        (media === "image/webp" && !/\.webp$/iu.test(file.path))
      )
        throw new DomainError(
          "skill_library.invalid_package",
          "The file extension must match the attached image.",
        );
      resources.push({
        path: file.path,
        resourceKind: resourceKind(file),
        storedObjectId: source.storedObjectId,
        mediaType: media,
        byteSize: Number(source.byteSize),
        contentDigest: `sha256:${source.sha256}`,
      });
    }
    return resources;
  }

  private async requireDraft(
    authority: TrustedWorkspaceScope,
    draftId: string,
    now: Date,
  ): Promise<SkillDraftSummary> {
    const draft = (
      await this.database.skillLibrary.listDrafts(authority, now)
    ).find((item) => item.id === draftId);
    if (!draft)
      throw new DomainError(
        "skill_library.not_found",
        "Skill Draft was not found.",
      );
    return draftRecord(draft);
  }
}
