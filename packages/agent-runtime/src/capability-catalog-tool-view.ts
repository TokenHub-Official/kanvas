import type { JSONSchema7 } from "json-schema";

import type { AgentToolFamilyProjection } from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export interface CapabilityCatalogToolInput {
  readonly query?: string;
  readonly afterKey?: string;
}

export interface CapabilityInvokeToolInput {
  readonly capabilityKey: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type CapabilityCatalogToolExecution = KanvasAgentToolExecution;

export interface CapabilityCatalogToolExecutor {
  readonly search: (
    input: CapabilityCatalogToolInput,
  ) => Promise<CapabilityCatalogToolExecution>;
  readonly invoke: (
    input: CapabilityInvokeToolInput,
  ) => Promise<CapabilityCatalogToolExecution>;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilityInvokeModelOutput(
  output: CapabilityCatalogToolExecution,
): unknown {
  const modelOutput = output.modelOutput;
  if (!record(modelOutput) || modelOutput.status !== "awaiting_approval") {
    return modelOutput;
  }
  return Object.freeze({
    status: "prepared",
    ...(typeof modelOutput.title === "string"
      ? { title: modelOutput.title }
      : {}),
    taskStatusSource: "task_card",
    responseGuidance:
      "The task is ready. In the user's language, say they can check its progress in the task card. Do not ask the user to confirm in prose, and do not claim that execution has started or completed.",
  });
}

export function createCapabilityCatalogToolProjection(
  executor: CapabilityCatalogToolExecutor,
): AgentToolFamilyProjection {
  return Object.freeze({
    family: "capability" as const,
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      catalog: "published-capability-declarations",
      execution: "reviewable_capability_run_proposal_v1",
    }),
    descriptors: Object.freeze([
      Object.freeze({
        key: "capability.search",
        description:
          "Search the governed Workspace capability catalog by business name, description, key, or tag. Results describe available inputs and outputs but do not execute a capability.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            afterKey: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description:
                "Use nextCursor from a previous result to continue the same query.",
            },
            query: {
              type: "string",
              minLength: 1,
              maxLength: 200,
            },
          },
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          executor.search(input as CapabilityCatalogToolInput),
        toModelOutput: (output: unknown) =>
          (output as CapabilityCatalogToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "capability.invoke",
        description:
          "Prepare a reviewable invocation of a governed Workspace capability returned by capability.search. The caller supplies only the public capability key and its public input; model, provider, storage, adapter, and routing details remain internal.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["capabilityKey", "input"],
          properties: {
            capabilityKey: {
              type: "string",
              minLength: 3,
              maxLength: 160,
              pattern: "^[a-z0-9]+(?:[._:-][a-z0-9]+)+$",
            },
            input: {
              type: "object",
              additionalProperties: true,
            },
          },
        } satisfies JSONSchema7,
        effect: "compute" as const,
        approvalMode: "before-commit" as const,
        executeCanonical: (input: unknown) =>
          executor.invoke(input as CapabilityInvokeToolInput),
        toModelOutput: (output: unknown) =>
          capabilityInvokeModelOutput(output as CapabilityCatalogToolExecution),
      }),
    ]),
  });
}
