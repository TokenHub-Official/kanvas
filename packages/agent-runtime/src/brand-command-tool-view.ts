import type {
  BrandKitDocument,
  BrandKitDraftRecord,
  BrandKitSummaryRecord,
} from "@kanvas/application";
import type { JSONSchema7 } from "json-schema";

import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export interface BrandCreateDraftToolInput {
  readonly name: string;
  readonly description?: string;
}

export interface BrandInspectDraftToolInput {
  readonly brandKitId: string;
}

export interface BrandUpdateDraftToolInput extends BrandKitDocument {
  readonly brandKitId: string;
  readonly expectedDraftVersion: number;
}

export interface BrandPublishProposalToolInput {
  readonly brandKitId: string;
  readonly expectedDraftVersion: number;
}

export function parseBrandPublishProposalToolInput(
  value: unknown,
): BrandPublishProposalToolInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Brand publication proposal must be an object.");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      (key) => key !== "brandKitId" && key !== "expectedDraftVersion",
    ) ||
    typeof input.brandKitId !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(input.brandKitId) ||
    typeof input.expectedDraftVersion !== "number" ||
    !Number.isInteger(input.expectedDraftVersion) ||
    input.expectedDraftVersion < 1
  ) {
    throw new TypeError("Brand publication proposal is invalid.");
  }
  return Object.freeze({
    brandKitId: input.brandKitId,
    expectedDraftVersion: input.expectedDraftVersion,
  });
}

export interface BrandCommandToolExecutors {
  readonly list: () => Promise<KanvasAgentToolExecution>;
  readonly inspectDraft: (
    input: BrandInspectDraftToolInput,
  ) => Promise<KanvasAgentToolExecution>;
  readonly createDraft: (
    input: BrandCreateDraftToolInput,
  ) => Promise<KanvasAgentToolExecution>;
  readonly updateDraft: (
    input: BrandUpdateDraftToolInput,
  ) => Promise<KanvasAgentToolExecution>;
  readonly proposePublish: (
    input: BrandPublishProposalToolInput,
  ) => Promise<KanvasAgentToolExecution>;
}

const idSchema = {
  type: "string",
  minLength: 26,
  maxLength: 26,
  pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
} as const satisfies JSONSchema7;

const stableKeySchema = {
  type: "string",
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
} as const satisfies JSONSchema7;

const documentProperties = {
  schemaVersion: { const: 1 },
  name: { type: "string", minLength: 1, maxLength: 160 },
  description: { type: "string", minLength: 1, maxLength: 500 },
  colors: {
    type: "array",
    maxItems: 64,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["key", "name", "role", "value", "position"],
      properties: {
        key: stableKeySchema,
        name: { type: "string", minLength: 1, maxLength: 120 },
        role: {
          enum: [
            "primary",
            "secondary",
            "accent",
            "background",
            "surface",
            "text_primary",
            "text_secondary",
          ],
        },
        value: {
          type: "string",
          pattern: "^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$",
        },
        position: { type: "integer", minimum: 0, maximum: 999 },
      },
    },
  },
  logos: {
    type: "array",
    maxItems: 12,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["key", "name", "role", "assetId", "artifactId", "position"],
      properties: {
        key: stableKeySchema,
        name: { type: "string", minLength: 1, maxLength: 120 },
        role: { enum: ["primary", "inverse", "icon"] },
        assetId: idSchema,
        artifactId: idSchema,
        position: { type: "integer", minimum: 0, maximum: 99 },
      },
    },
  },
  referenceImages: {
    type: "array",
    maxItems: 24,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["key", "name", "assetId", "artifactId", "position"],
      properties: {
        key: stableKeySchema,
        name: { type: "string", minLength: 1, maxLength: 120 },
        description: { type: "string", minLength: 1, maxLength: 500 },
        assetId: idSchema,
        artifactId: idSchema,
        position: { type: "integer", minimum: 0, maximum: 99 },
      },
    },
  },
  textStyles: {
    type: "array",
    maxItems: 16,
    items: {
      type: "object",
      additionalProperties: false,
      required: [
        "key",
        "name",
        "role",
        "fontId",
        "fontRevision",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "letterSpacing",
        "position",
      ],
      properties: {
        key: stableKeySchema,
        name: { type: "string", minLength: 1, maxLength: 120 },
        role: { enum: ["display", "title", "subtitle", "body", "caption"] },
        fontId: { type: "string", minLength: 1, maxLength: 120 },
        fontRevision: { type: "string", minLength: 1, maxLength: 120 },
        fontFamily: { type: "string", minLength: 1, maxLength: 160 },
        fontSize: { type: "number", minimum: 6, maximum: 512 },
        fontWeight: { type: "integer", minimum: 100, maximum: 900 },
        lineHeight: { type: "number", minimum: 0.5, maximum: 3 },
        letterSpacing: { type: "number", minimum: -10, maximum: 50 },
        colorKey: stableKeySchema,
        position: { type: "integer", minimum: 0, maximum: 99 },
      },
    },
  },
  guidelines: {
    type: "object",
    additionalProperties: false,
    required: ["principles", "avoid"],
    properties: {
      voice: { type: "string", minLength: 1, maxLength: 1000 },
      principles: {
        type: "array",
        maxItems: 12,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
      avoid: {
        type: "array",
        maxItems: 12,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  },
} as const satisfies Readonly<Record<string, JSONSchema7>>;

export function brandDraftModelOutput(draft: BrandKitDraftRecord) {
  return Object.freeze({
    brandKitId: draft.brandKitId,
    draftVersion: draft.draftVersion,
    lifecycleStatus: draft.lifecycleStatus,
    isDefault: draft.isDefault,
    latestPublished: Boolean(draft.latestPublishedRevision),
    document: draft.document,
  });
}

export function brandListModelOutput(items: readonly BrandKitSummaryRecord[]) {
  return Object.freeze({
    items: Object.freeze(
      items.slice(0, 50).map((item) =>
        Object.freeze({
          brandKitId: item.id,
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          draftVersion: item.draftVersion,
          isDefault: item.isDefault,
          latestPublished: Boolean(item.latestPublishedRevision),
        }),
      ),
    ),
  });
}

export function createBrandCommandToolProjection(
  executors: BrandCommandToolExecutors,
): AgentToolFamilyProjection {
  return Object.freeze({
    family: "brand_command" as const,
    digestMaterial: Object.freeze({ schemaVersion: 1 }),
    descriptors: Object.freeze([
      Object.freeze({
        key: "brand.list",
        description: "List the active Brand Drafts this Workspace can access.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: () => executors.list(),
        toModelOutput: (output: unknown) =>
          (output as KanvasAgentToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "brand.inspect-draft",
        description:
          "Read one current editable Brand Draft before changing or publishing it.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["brandKitId"],
          properties: { brandKitId: idSchema },
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.inspectDraft(input as BrandInspectDraftToolInput),
        toModelOutput: (output: unknown) =>
          (output as KanvasAgentToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "brand.create-draft",
        description:
          "Create one real editable Brand Draft. It remains unpublished.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", minLength: 1, maxLength: 500 },
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.createDraft(input as BrandCreateDraftToolInput),
        toModelOutput: (output: unknown) =>
          (output as KanvasAgentToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "brand.update-draft",
        description:
          "Replace one Brand Draft after inspecting its current draftVersion. Preserve every existing field that should remain.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: [
            "brandKitId",
            "expectedDraftVersion",
            "schemaVersion",
            "name",
            "colors",
            "logos",
            "referenceImages",
            "textStyles",
            "guidelines",
          ],
          properties: {
            brandKitId: idSchema,
            expectedDraftVersion: { type: "integer", minimum: 1 },
            ...documentProperties,
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.updateDraft(input as BrandUpdateDraftToolInput),
        toModelOutput: (output: unknown) =>
          (output as KanvasAgentToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "brand.propose-publish",
        description:
          "Prepare a reviewable publication of an inspected Brand Draft. Publication makes the current content available to future work.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["brandKitId", "expectedDraftVersion"],
          properties: {
            brandKitId: idSchema,
            expectedDraftVersion: { type: "integer", minimum: 1 },
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "before-commit" as const,
        executeCanonical: (input: unknown) =>
          executors.proposePublish(parseBrandPublishProposalToolInput(input)),
      }),
    ]),
  });
}
