import type { JSONSchema7 } from "json-schema";

import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export interface CanvasCreateToolInput {
  readonly title: string;
  readonly width: number;
  readonly height: number;
}

export type CanvasInspectToolInput = Record<string, never>;

export type CanvasTextEditOperation =
  | {
      readonly type: "add_text";
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fontSize?: number;
      readonly color?: string;
    }
  | {
      readonly type: "update_text";
      readonly elementKey: string;
      readonly text?: string;
      readonly fontSize?: number;
      readonly color?: string;
    };

export interface CanvasEditTextToolInput {
  readonly expectedVersion: number;
  readonly pageKey: string;
  readonly operations: readonly CanvasTextEditOperation[];
}

export interface CanvasAddResultImageToolInput {
  readonly expectedVersion: number;
  readonly pageKey: string;
  readonly workflowRunId?: string;
  readonly capabilityRunId?: string;
  readonly brandLogoKey?: string;
  readonly skillRevisionId?: string;
  readonly skillResourcePath?: string;
  readonly libraryId?: string;
  readonly libraryEntryId?: string;
  readonly artifactId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fit?: "contain" | "cover" | "fill";
  readonly altText?: string;
}

export interface CanvasCommandToolExecutors {
  readonly exportPng?: (input: {
    readonly expectedVersion: number;
    readonly pageKey: string;
  }) => Promise<CanvasCommandToolExecution>;
  readonly create: (
    input: CanvasCreateToolInput,
  ) => Promise<CanvasCommandToolExecution>;
  readonly inspect: (
    input: CanvasInspectToolInput,
  ) => Promise<CanvasCommandToolExecution>;
  readonly editText: (
    input: CanvasEditTextToolInput,
  ) => Promise<CanvasCommandToolExecution>;
  readonly addResultImage: (
    input: CanvasAddResultImageToolInput,
  ) => Promise<CanvasCommandToolExecution>;
}

export type CanvasCommandToolExecution = KanvasAgentToolExecution;

const textStyleProperties = {
  fontSize: { type: "number", minimum: 1, maximum: 2_048 },
  color: { type: "string", minLength: 1, maxLength: 120 },
} as const satisfies Readonly<Record<string, JSONSchema7>>;

type CanvasModelTextInput = CanvasEditTextToolInput["operations"][number] & {
  readonly expectedVersion: number;
  readonly pageKey: string;
};

export function createCanvasCommandToolProjection(
  executors: CanvasCommandToolExecutors,
  options: { readonly includeLibraryInputs?: boolean } = {},
): AgentToolFamilyProjection {
  return Object.freeze({
    family: "canvas_command" as const,
    digestMaterial: Object.freeze({
      schemaVersion: options.includeLibraryInputs ? 3 : 2,
    }),
    descriptors: Object.freeze([
      Object.freeze({
        key: "canvas.create",
        description:
          "Only use when the user explicitly requests Canvas work or continues an explicitly requested Canvas task. Existing Canvas context alone is insufficient. Create one real editable Canvas Draft with the requested title and page size.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "width", "height"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 240 },
            width: { type: "integer", minimum: 64, maximum: 32_768 },
            height: { type: "integer", minimum: 64, maximum: 32_768 },
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.create(input as CanvasCreateToolInput),
        toModelOutput: (output: unknown) =>
          (output as CanvasCommandToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "canvas.inspect",
        description:
          "Only use when the user explicitly requests Canvas work or continues an explicitly requested Canvas task. Existing Canvas context alone is insufficient. Read the current Canvas Draft, its pages, latest version, and bounded text element facts.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.inspect(input as CanvasInspectToolInput),
        toModelOutput: (output: unknown) =>
          (output as CanvasCommandToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "canvas.edit-text",
        description:
          "Only use when the user explicitly requests Canvas work or continues an explicitly requested Canvas task. Existing Canvas context alone is insufficient. Add or update one Canvas text element. Text wraps inside its width; newlines create intentional paragraph breaks. For add_text include text, x, y, width and enough height for every line. For update_text include elementKey and at least one changed value.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["expectedVersion", "pageKey", "type"],
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            pageKey: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            },
            type: { enum: ["add_text", "update_text"] },
            elementKey: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            },
            text: {
              type: "string",
              minLength: 1,
              maxLength: 20_000,
              description:
                "Visible text. Use newlines only for intentional paragraph breaks; soft wrapping follows the text box width.",
            },
            x: { type: "number", minimum: -10_000_000, maximum: 10_000_000 },
            y: { type: "number", minimum: -10_000_000, maximum: 10_000_000 },
            width: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 32_768,
              description: "Text box width used for automatic line wrapping.",
            },
            height: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 32_768,
              description: "Text box height for all wrapped lines.",
            },
            ...textStyleProperties,
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) => {
          const edit = input as CanvasModelTextInput;
          const { expectedVersion, pageKey, ...operation } = edit;
          return executors.editText({
            expectedVersion,
            pageKey,
            operations: [operation],
          });
        },
        toModelOutput: (output: unknown) =>
          (output as CanvasCommandToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "canvas.add-result-image",
        description: options.includeLibraryInputs
          ? "Only use for explicitly requested Canvas work; existing Canvas context alone is insufficient. Place one visible image on the current Canvas. Choose exactly one source: capabilityRunId, workflowRunId, brandLogoKey, paired skillRevisionId/skillResourcePath, or paired libraryId/libraryEntryId from library.inspect/read. Use its exact artifactId. Skill and library sources must be pinned in this Run."
          : "Only use when the user explicitly requests Canvas work or continues an explicitly requested Canvas task. Existing Canvas context alone is insufficient. Place one visible image from this conversation on the current Canvas. Use exactly one source: capabilityRunId, workflowRunId, brandLogoKey (selected Brand's original Logo), or paired skillRevisionId and skillResourcePath (pinned Skill image). Use the source's exact artifactId.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: [
            "expectedVersion",
            "pageKey",
            "artifactId",
            "x",
            "y",
            "width",
            "height",
          ],
          oneOf: [
            { required: ["workflowRunId"] },
            { required: ["capabilityRunId"] },
            { required: ["brandLogoKey"] },
            { required: ["skillRevisionId", "skillResourcePath"] },
            ...(options.includeLibraryInputs
              ? [{ required: ["libraryId", "libraryEntryId"] }]
              : []),
          ],
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            pageKey: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            },
            workflowRunId: {
              type: "string",
              minLength: 26,
              maxLength: 26,
              pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
            },
            capabilityRunId: {
              type: "string",
              minLength: 26,
              maxLength: 26,
              pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
            },
            brandLogoKey: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description:
                "Logo key from the selected Brand context. Places the original file as an independent image layer; use contain to preserve proportions.",
            },
            skillRevisionId: {
              type: "string",
              minLength: 26,
              maxLength: 26,
              pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
              description:
                "Exact pinned Skill revision containing the image resource.",
            },
            skillResourcePath: {
              type: "string",
              minLength: 1,
              maxLength: 512,
              description:
                "Exact image path returned by the pinned Skill, such as assets/brand/logo.png.",
            },
            ...(options.includeLibraryInputs
              ? {
                  libraryId: {
                    type: "string" as const,
                    pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
                  },
                  libraryEntryId: {
                    type: "string" as const,
                    pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
                  },
                }
              : {}),
            artifactId: {
              type: "string",
              minLength: 26,
              maxLength: 26,
              pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
            },
            x: { type: "number", minimum: -10_000_000, maximum: 10_000_000 },
            y: { type: "number", minimum: -10_000_000, maximum: 10_000_000 },
            width: { type: "number", exclusiveMinimum: 0, maximum: 32_768 },
            height: { type: "number", exclusiveMinimum: 0, maximum: 32_768 },
            fit: { enum: ["contain", "cover", "fill"] },
            altText: { type: "string", minLength: 1, maxLength: 2_000 },
          },
        } satisfies JSONSchema7,
        effect: "internal-write" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executors.addResultImage(input as CanvasAddResultImageToolInput),
        toModelOutput: (output: unknown) =>
          (output as CanvasCommandToolExecution).modelOutput,
      }),
      ...(executors.exportPng
        ? [
            Object.freeze({
              key: "canvas.export-png",
              description:
                "Only use when the user explicitly requests Canvas work or continues an explicitly requested Canvas task. Existing Canvas context alone is insufficient. Export one page of the current Canvas at its fixed version as PNG. The open conversation renders and commits the file. Wait for the returned Artifact before claiming success; browser absence, changed versions or failed uploads are errors.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["expectedVersion", "pageKey"],
                properties: {
                  expectedVersion: { type: "integer", minimum: 1 },
                  pageKey: { type: "string", minLength: 1, maxLength: 160 },
                },
              } satisfies JSONSchema7,
              effect: "internal-write" as const,
              approvalMode: "none" as const,
              executeCanonical: (input: unknown) =>
                executors.exportPng!(
                  input as { expectedVersion: number; pageKey: string },
                ),
              toModelOutput: (output: unknown) =>
                (output as CanvasCommandToolExecution).modelOutput,
            }),
          ]
        : []),
    ]),
  });
}
