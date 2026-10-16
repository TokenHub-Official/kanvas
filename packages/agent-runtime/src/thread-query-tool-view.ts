import type { JSONSchema7 } from "json-schema";

import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export type ThreadWorkQueryToolInput = Record<string, never>;

export type ThreadWorkQueryToolExecution = KanvasAgentToolExecution;

export interface WebSearchToolInput {
  readonly query: string;
}

export type WebSearchToolExecution = KanvasAgentToolExecution;

export interface ThreadWorkQueryToolExecutors {
  readonly inspect?: (
    input: ThreadWorkQueryToolInput,
  ) => Promise<ThreadWorkQueryToolExecution>;
  readonly search?: (
    input: WebSearchToolInput,
  ) => Promise<WebSearchToolExecution>;
}

export function createThreadWorkQueryToolProjection(
  executors: ThreadWorkQueryToolExecutors,
  options: { readonly includeArtifacts: boolean },
): AgentToolFamilyProjection {
  if (!executors.inspect && !executors.search) {
    throw new Error("Query Tool projection requires an executor.");
  }
  return Object.freeze({
    family: "query" as const,
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      includeArtifacts: options.includeArtifacts,
      webSearch: executors.search !== undefined,
    }),
    descriptors: Object.freeze([
      ...(executors.inspect
        ? [
            Object.freeze({
              key: "thread.inspect-work",
              description:
                "Read the current conversation's recent production tasks, current lifecycle states, and visible result resources.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {},
              } satisfies JSONSchema7,
              effect: "read" as const,
              approvalMode: "none" as const,
              executeCanonical: (input: unknown) =>
                executors.inspect!(input as ThreadWorkQueryToolInput),
              toModelOutput: (output: unknown) =>
                (output as ThreadWorkQueryToolExecution).modelOutput,
            }),
          ]
        : []),
      ...(executors.search
        ? [
            Object.freeze({
              key: "web_search",
              description:
                "Search the public web for current information and return a concise answer with supporting source URLs. Provide query when possible; when omitted, the current user request is used.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  query: {
                    type: "string",
                    minLength: 1,
                    maxLength: 500,
                  },
                },
              } satisfies JSONSchema7,
              effect: "read" as const,
              approvalMode: "none" as const,
              executeCanonical: (input: unknown) =>
                executors.search!(input as WebSearchToolInput),
              toModelOutput: (output: unknown) =>
                (output as WebSearchToolExecution).modelOutput,
            }),
          ]
        : []),
    ]),
  });
}
