import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { JSONSchema7 } from "json-schema";
import type {
  KanvasAgentToolDescriptor,
  KanvasAgentToolExecution,
} from "./tool-view.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const attachmentFilesSchema: JSONSchema7 = {
  type: "array",
  maxItems: 8,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["path", "artifactId"],
    properties: {
      path: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description:
          "Relative PNG, JPEG or WebP file path under references/ or assets/.",
      },
      artifactId: { type: "string", pattern: idPattern.source },
    },
  },
};

export interface SkillAttachmentFile {
  readonly path: string;
  readonly artifactId: string;
}

export interface SkillDraftFilesProposalInput {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly files: readonly SkillAttachmentFile[];
}

export function parseSkillAttachmentFiles(
  value: unknown,
): readonly SkillAttachmentFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8)
    throw new TypeError("Skill attachments are invalid.");
  const paths = new Set<string>();
  return value.map((file: unknown) => {
    if (!file || typeof file !== "object" || Array.isArray(file))
      throw new TypeError("Skill attachment is invalid.");
    const item = file as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => key !== "path" && key !== "artifactId") ||
      typeof item.path !== "string" ||
      item.path.length > 500 ||
      !/^(?:references|assets)\/.+\.(?:png|jpg|jpeg|webp)$/iu.test(item.path) ||
      /[\\:\p{Cc}]/u.test(item.path) ||
      item.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      paths.has(item.path) ||
      typeof item.artifactId !== "string" ||
      !idPattern.test(item.artifactId)
    ) {
      throw new TypeError("Skill attachment path or identity is invalid.");
    }
    paths.add(item.path);
    return Object.freeze({ path: item.path, artifactId: item.artifactId });
  });
}

export function parseSkillDraftFilesProposalInput(
  value: unknown,
): SkillDraftFilesProposalInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Skill file proposal is invalid.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["draftId", "expectedDraftVersion", "files"].includes(key),
    ) ||
    typeof input.draftId !== "string" ||
    !idPattern.test(input.draftId) ||
    !Number.isInteger(input.expectedDraftVersion) ||
    Number(input.expectedDraftVersion) < 1
  )
    throw new TypeError("Skill draft identity is invalid.");
  const files = parseSkillAttachmentFiles(input.files);
  if (!files.length) throw new TypeError("Choose at least one attachment.");
  return {
    draftId: input.draftId,
    expectedDraftVersion: Number(input.expectedDraftVersion),
    files,
  };
}

export interface SkillDraftProposalInput {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly summary: string;
  readonly instructions: string;
  readonly visibility: "private" | "workspace";
  readonly category?: string;
  readonly tags: readonly string[];
  readonly exampleRequests: readonly string[];

  readonly sourceArtifactId?: string;
  readonly files?: readonly SkillAttachmentFile[];
}

export interface SkillCommandExecutor {
  listDrafts?: () => Promise<KanvasAgentToolExecution>;
  proposeFiles?: (
    input: SkillDraftFilesProposalInput,
  ) => Promise<KanvasAgentToolExecution>;
  proposeCreate(
    input: SkillDraftProposalInput,
  ): Promise<KanvasAgentToolExecution>;
}

export interface SkillCommandProjectionOptions {
  readonly resolveSourceArtifactId?: () => Promise<string>;
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  singleLine = false,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > maximum ||
    (singleLine && /[\r\n]/u.test(value))
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.trim();
}

function stringList(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
): readonly string[] {
  const items: readonly unknown[] = Array.isArray(value)
    ? (value as readonly unknown[])
    : [];
  if (
    !Array.isArray(value) ||
    items.length > maximumItems ||
    !items.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= maximumLength,
    )
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  const values = items.map((item) => String(item).trim());
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be unique.`);
  }
  return Object.freeze(values);
}

export function parseSkillDraftProposalInput(
  value: unknown,
): SkillDraftProposalInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Skill Draft proposal must be an object.");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowedKeys = new Set([
    "name",
    "displayName",
    "description",
    "summary",
    "instructions",
    "visibility",
    "category",
    "tags",
    "exampleRequests",

    "sourceArtifactId",
    "files",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Skill Draft proposal contains an unknown field.");
  }
  const name = boundedText(input.name, "Skill name", 80, true);
  if (!namePattern.test(name)) {
    throw new TypeError(
      "Skill name must use lowercase letters, digits and hyphens.",
    );
  }
  const visibility = input.visibility;
  const sourceArtifactId = input.sourceArtifactId;
  if (
    (visibility !== "private" && visibility !== "workspace") ||
    (sourceArtifactId !== undefined &&
      (typeof sourceArtifactId !== "string" ||
        !idPattern.test(sourceArtifactId)))
  ) {
    throw new TypeError("Skill Draft proposal identity is invalid.");
  }
  const category =
    input.category === undefined
      ? undefined
      : boundedText(input.category, "Skill category", 120, true);
  return Object.freeze({
    name,
    displayName: boundedText(
      input.displayName,
      "Skill display name",
      160,
      true,
    ),
    description: boundedText(input.description, "Skill description", 600, true),
    summary: boundedText(input.summary, "Skill summary", 600),
    instructions: boundedText(
      input.instructions,
      "Skill instructions",
      262_144,
    ),
    visibility,
    ...(category ? { category } : {}),
    tags: stringList(input.tags, "Skill tags", 20, 80),
    exampleRequests: stringList(
      input.exampleRequests,
      "Skill example requests",
      20,
      300,
    ),

    ...(sourceArtifactId ? { sourceArtifactId } : {}),
    ...(input.files !== undefined
      ? { files: parseSkillAttachmentFiles(input.files) }
      : {}),
  });
}

export function createSkillCommandToolProjection(
  executor: SkillCommandExecutor,
  options: SkillCommandProjectionOptions = {},
): AgentToolFamilyProjection {
  const inputSchema: JSONSchema7 = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        maxLength: 80,
      },
      displayName: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", minLength: 1, maxLength: 600 },
      summary: { type: "string", minLength: 1, maxLength: 600 },
      instructions: { type: "string", minLength: 1, maxLength: 262144 },
      visibility: {
        type: "string",
        enum: ["private", "workspace"],
        default: "private",
        description:
          "Use private unless the user explicitly asks to share this Skill with the Workspace.",
      },
      category: { type: "string", minLength: 1, maxLength: 120 },
      tags: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 80 },
      },
      exampleRequests: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 300 },
      },

      sourceArtifactId: {
        type: "string",
        pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
      },
      files: attachmentFilesSchema,
    },
    required: [
      "name",
      "displayName",
      "description",
      "summary",
      "instructions",
      "visibility",
      "tags",
      "exampleRequests",
    ],
  };
  return Object.freeze({
    family: "skill_command" as const,
    descriptors: Object.freeze([
      Object.freeze({
        key: "skill.propose-create",
        description:
          "Prepare a reviewable Skill Draft from the user's work method. Include files to preserve real conversation image attachments as references or assets. sourceArtifactId is only for deriving a Skill from a generated result, and is otherwise omitted.",
        inputSchema,
        effect: "internal-write" as const,
        approvalMode: "before-commit" as const,
        executeCanonical: async (input: unknown) => {
          const record: Readonly<Record<string, unknown>> | undefined =
            input && typeof input === "object" && !Array.isArray(input)
              ? (input as Readonly<Record<string, unknown>>)
              : undefined;
          const sourceArtifactId = record?.sourceArtifactId;
          const resolvedInput =
            record &&
            sourceArtifactId === undefined &&
            !record.files &&
            options.resolveSourceArtifactId
              ? {
                  ...record,
                  sourceArtifactId: await options.resolveSourceArtifactId(),
                }
              : input;
          return executor.proposeCreate(
            parseSkillDraftProposalInput(resolvedInput),
          );
        },
      }) satisfies KanvasAgentToolDescriptor,
      ...(executor.listDrafts
        ? [
            {
              key: "skill.list-drafts",
              description:
                "List editable Skill Drafts and their current versions before proposing file changes.",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              } as JSONSchema7,
              effect: "read" as const,
              approvalMode: "none" as const,
              executeCanonical: () => executor.listDrafts!(),
              toModelOutput: (output: unknown) =>
                (output as KanvasAgentToolExecution).modelOutput,
            },
          ]
        : []),
      ...(executor.proposeFiles
        ? [
            {
              key: "skill.propose-files",
              description:
                "Prepare a reviewable addition or replacement of real conversation image files in an existing Skill Draft. Preserve all other content. Read its current version with skill.list-drafts first.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["draftId", "expectedDraftVersion", "files"],
                properties: {
                  draftId: { type: "string", pattern: idPattern.source },
                  expectedDraftVersion: { type: "integer", minimum: 1 },
                  files: attachmentFilesSchema,
                },
              } as JSONSchema7,
              effect: "internal-write" as const,
              approvalMode: "before-commit" as const,
              executeCanonical: (input: unknown) =>
                executor.proposeFiles!(
                  parseSkillDraftFilesProposalInput(input),
                ),
            },
          ]
        : []),
    ]),
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      mode: "instructions-and-attachments",
    }),
  });
}
