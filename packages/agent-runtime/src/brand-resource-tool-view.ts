import type { JSONSchema7 } from "json-schema";

import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export interface BrandPublishedSearchToolInput {
  readonly query?: string;
}

export interface BrandPublishedInspectToolInput {
  readonly brandKitRevisionId: string;
}

export type BrandResourceToolExecution = KanvasAgentToolExecution;

export interface BrandResourceToolExecutor {
  readonly search: (
    input: BrandPublishedSearchToolInput,
  ) => Promise<BrandResourceToolExecution>;
  readonly inspectPublished: (
    input: BrandPublishedInspectToolInput,
  ) => Promise<BrandResourceToolExecution>;
}

const idSchema = {
  type: "string",
  minLength: 26,
  maxLength: 26,
  pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
} as const satisfies JSONSchema7;

export function createBrandResourceToolProjection(
  executor: BrandResourceToolExecutor,
): AgentToolFamilyProjection {
  return Object.freeze({
    family: "brand_command" as const,
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      catalog: "published-brand-revisions",
      access: "read-only",
    }),
    descriptors: Object.freeze([
      Object.freeze({
        key: "brand.search-published",
        description:
          "Search published Workspace Brands by business name or description. Agent bindings improve result order but never grant access, select a Brand, or expose editable Draft content.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 1, maxLength: 200 },
          },
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executor.search(input as BrandPublishedSearchToolInput),
        toModelOutput: (output: unknown) =>
          (output as BrandResourceToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "brand.inspect-published",
        description:
          "Read one exact published Brand revision returned by brand.search-published, including its creative guidance and pinned reusable visual references, without exposing or changing its Draft.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["brandKitRevisionId"],
          properties: { brandKitRevisionId: idSchema },
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executor.inspectPublished(input as BrandPublishedInspectToolInput),
        toModelOutput: (output: unknown) =>
          (output as BrandResourceToolExecution).modelOutput,
      }),
    ]),
  });
}
