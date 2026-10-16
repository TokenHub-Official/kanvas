import type { EffectiveInvocationUnavailableReason } from "@kanvas/contracts/api";

import type { TrustedWorkspaceScope } from "../../authorization/index.js";
import type { AgentSurfaceKind } from "./agent-runtime.js";
import type { AgentRunFoundationContextV1 } from "./agent-runtime.js";

export type AgentToolFamily =
  | "query"
  | "canvas_command"
  | "capability"
  | "workflow"
  | "brand_command"
  | "workflow_authoring"
  | "review_command"
  | "skill_command";

export interface AgentProfileManifestV1 {
  readonly schemaVersion: 1;
  readonly displayName: string;
  readonly modelBindingKey: string;
  readonly instructions: string;
  readonly allowedSurfaceKinds: readonly AgentSurfaceKind[];
  readonly allowedToolFamilies: readonly AgentToolFamily[];
  readonly requiredToolFamilies: readonly AgentToolFamily[];
  readonly skillPolicy: {
    readonly maximumCatalogItems: number;
    readonly maximumActivatedInstructionBytes: number;
    readonly maximumReferenceReadBytes: number;
  };
  readonly runLimits: {
    readonly maximumModelCalls: number;
    readonly maximumToolCalls: number;
    readonly timeoutSeconds: number;
  };
}

export interface AgentProfileRevisionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentDefinitionId: string;
  readonly profileKey: string;
  readonly revision: number;
  readonly manifest: AgentProfileManifestV1;
  readonly canonicalDigest: string;
}

export interface AgentSkillMetadataV1 {
  readonly surfaceKinds: readonly AgentSurfaceKind[];
  readonly toolFamilies: readonly AgentToolFamily[];
  readonly summary: string;
  readonly exampleRequests: readonly string[];
  readonly instructionResourcePath: string;
}

export interface AgentSkillInstructionResource {
  readonly resourcePath: string;
  readonly storedObjectId: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly developmentLocalPath?: string;
}

export interface AgentSkillReferenceResource extends AgentSkillInstructionResource {
  readonly relativePath: string;
}

export interface AgentSkillEntrypointView {
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface AgentSkillUnavailableEntrypointView {
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category?: string;
  readonly reason: EffectiveInvocationUnavailableReason;
}

export interface AgentSkillCatalogItem {
  readonly skillDefinitionId: string;
  readonly skillRevisionId: string;
  readonly skillKey: string;
  readonly skillName: string;
  readonly revision: number;
  readonly candidate?: boolean;
  readonly bound: boolean;
  readonly displayName: string;
  readonly summary: string;
  readonly exampleRequests: readonly string[];
  readonly toolFamilies: readonly AgentToolFamily[];
  readonly canonicalDigest: string;
  readonly instructionResource: AgentSkillInstructionResource;
  readonly referenceResources: readonly AgentSkillReferenceResource[];
  readonly entrypoints: readonly AgentSkillEntrypointView[];
  readonly unavailableEntrypoints?: readonly AgentSkillUnavailableEntrypointView[];
}

export interface AgentBoundBrand {
  readonly brandKitId: string;
  readonly name: string;
  readonly description?: string;
}

export interface AgentBoundWorkflow {
  readonly workflowDefinitionId: string;
  readonly displayName: string;
  readonly description?: string;
}

export interface AgentSurfaceView {
  readonly profile: AgentProfileRevisionRecord;
  readonly skills: readonly AgentSkillCatalogItem[];
  readonly boundBrands: readonly AgentBoundBrand[];
  readonly boundWorkflows: readonly AgentBoundWorkflow[];
  readonly skillViewDigest: string;
}

export interface AgentFoundationRepository {
  resolveSurfaceView(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly surfaceKind: AgentSurfaceKind;
    readonly agentDefinitionId?: string;
    readonly profileRevisionId?: string;
    readonly skillRevisionIds?: readonly string[];
    readonly now: Date;
  }): Promise<AgentSurfaceView | undefined>;
  assertSkillUsable(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly skillRevisionId: string;
    readonly now: Date;
  }): Promise<void>;
}

export function agentRunFoundationContext(
  view: AgentSurfaceView,
): AgentRunFoundationContextV1 {
  return Object.freeze({
    schemaVersion: 1,
    profileRevisionId: view.profile.id,
    profileCanonicalDigest: view.profile.canonicalDigest,
    skillViewDigest: view.skillViewDigest,
    skills: Object.freeze(
      view.skills.map((skill) =>
        Object.freeze({
          skillRevisionId: skill.skillRevisionId,
          canonicalDigest: skill.canonicalDigest,
          instructionResourceDigest: skill.instructionResource.contentDigest,
          entrypointWorkflowRevisionIds: Object.freeze(
            skill.entrypoints.map(
              (entrypoint) => entrypoint.workflowRevisionId,
            ),
          ),
        }),
      ),
    ),
  });
}

const surfaceKinds = new Set<AgentSurfaceKind>([
  "agent_workspace",
  "workspace_home",
  "canvas",
  "asset",
  "workflow_run",
  "workflow_authoring",
  "brand",
]);

const toolFamilies = new Set<AgentToolFamily>([
  "query",
  "canvas_command",
  "capability",
  "workflow",
  "brand_command",
  "workflow_authoring",
  "review_command",
  "skill_command",
]);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : undefined;
}

function boundedStrings(
  value: unknown,
  options: { readonly maximumItems: number; readonly maximumLength: number },
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > options.maximumItems) {
    return undefined;
  }
  const items = value.map((item) =>
    boundedText(item, 1, options.maximumLength),
  );
  return items.every((item) => item !== undefined)
    ? Object.freeze(items)
    : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

export function parseAgentProfileManifestV1(
  value: unknown,
): AgentProfileManifestV1 | undefined {
  const candidate = record(value);
  const skillPolicy = record(candidate?.skillPolicy);
  const runLimits = record(candidate?.runLimits);
  const allowedSurfaceKinds = boundedStrings(candidate?.allowedSurfaceKinds, {
    maximumItems: surfaceKinds.size,
    maximumLength: 40,
  });
  const allowedToolFamilies = boundedStrings(candidate?.allowedToolFamilies, {
    maximumItems: toolFamilies.size,
    maximumLength: 40,
  });
  const requiredToolFamilies = boundedStrings(candidate?.requiredToolFamilies, {
    maximumItems: toolFamilies.size,
    maximumLength: 40,
  });
  const displayName = boundedText(candidate?.displayName, 1, 160);
  const modelBindingKey = boundedText(candidate?.modelBindingKey, 1, 96);
  // Instructions are a document: whitespace carries Markdown and code structure.
  const instructions =
    typeof candidate?.instructions === "string"
      ? candidate.instructions.trim()
      : undefined;
  const maximumInstructionLength = 8_000;
  const maximumCatalogItems = boundedInteger(
    skillPolicy?.maximumCatalogItems,
    1,
    200,
  );
  const maximumActivatedInstructionBytes = boundedInteger(
    skillPolicy?.maximumActivatedInstructionBytes,
    1_024,
    1_048_576,
  );
  const maximumReferenceReadBytes = boundedInteger(
    skillPolicy?.maximumReferenceReadBytes,
    0,
    1_048_576,
  );
  const maximumModelCalls = boundedInteger(runLimits?.maximumModelCalls, 1, 64);
  const maximumToolCalls = boundedInteger(runLimits?.maximumToolCalls, 0, 128);
  const timeoutSeconds = boundedInteger(runLimits?.timeoutSeconds, 5, 1_800);
  if (
    candidate?.schemaVersion !== 1 ||
    !displayName ||
    !modelBindingKey ||
    !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(modelBindingKey) ||
    !instructions ||
    instructions.length > maximumInstructionLength ||
    !allowedSurfaceKinds?.length ||
    !allowedSurfaceKinds.every((item) =>
      surfaceKinds.has(item as AgentSurfaceKind),
    ) ||
    !allowedToolFamilies ||
    !allowedToolFamilies.every((item) =>
      toolFamilies.has(item as AgentToolFamily),
    ) ||
    !requiredToolFamilies ||
    !requiredToolFamilies.every(
      (item) =>
        toolFamilies.has(item as AgentToolFamily) &&
        allowedToolFamilies.includes(item),
    ) ||
    new Set(requiredToolFamilies).size !== requiredToolFamilies.length ||
    maximumCatalogItems === undefined ||
    maximumActivatedInstructionBytes === undefined ||
    maximumReferenceReadBytes === undefined ||
    maximumModelCalls === undefined ||
    maximumToolCalls === undefined ||
    timeoutSeconds === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    displayName,
    modelBindingKey,
    instructions,
    allowedSurfaceKinds: Object.freeze(
      allowedSurfaceKinds as AgentSurfaceKind[],
    ),
    allowedToolFamilies: Object.freeze(
      allowedToolFamilies as AgentToolFamily[],
    ),
    requiredToolFamilies: Object.freeze(
      requiredToolFamilies as AgentToolFamily[],
    ),
    skillPolicy: Object.freeze({
      maximumCatalogItems,
      maximumActivatedInstructionBytes,
      maximumReferenceReadBytes,
    }),
    runLimits: Object.freeze({
      maximumModelCalls,
      maximumToolCalls,
      timeoutSeconds,
    }),
  });
}

export function parseAgentSkillMetadataV1(
  manifest: unknown,
): AgentSkillMetadataV1 | undefined {
  const candidate = record(manifest);
  const agent = record(candidate?.agent);
  const surfaceValues = boundedStrings(agent?.surfaceKinds, {
    maximumItems: surfaceKinds.size,
    maximumLength: 40,
  });
  const toolFamilyValues = boundedStrings(agent?.toolFamilies, {
    maximumItems: toolFamilies.size,
    maximumLength: 40,
  });
  const summary = boundedText(agent?.summary, 12, 600);
  const exampleRequests = boundedStrings(agent?.exampleRequests, {
    maximumItems: 20,
    maximumLength: 300,
  });
  const instructionResourcePath = boundedText(
    agent?.instructionResourcePath,
    1,
    500,
  );
  if (
    candidate?.schemaVersion !== 1 ||
    !surfaceValues?.length ||
    !surfaceValues.every((item) =>
      surfaceKinds.has(item as AgentSurfaceKind),
    ) ||
    !toolFamilyValues?.length ||
    !toolFamilyValues.every((item) =>
      toolFamilies.has(item as AgentToolFamily),
    ) ||
    !summary ||
    !exampleRequests ||
    !instructionResourcePath ||
    instructionResourcePath.startsWith("/") ||
    instructionResourcePath.includes("..")
  ) {
    return undefined;
  }
  return Object.freeze({
    surfaceKinds: Object.freeze(surfaceValues as AgentSurfaceKind[]),
    toolFamilies: Object.freeze(toolFamilyValues as AgentToolFamily[]),
    summary,
    exampleRequests,
    instructionResourcePath,
  });
}
