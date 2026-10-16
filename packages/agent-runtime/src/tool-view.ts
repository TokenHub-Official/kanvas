import { createTool, type Tool } from "@mastra/core/tools";
import type { AgentActionOutcomeReference } from "@kanvas/application";
import type { JSONSchema7 } from "json-schema";

export type KanvasAgentToolEffect =
  "read" | "compute" | "internal-write" | "external-write" | "destructive";

export type KanvasAgentToolApprovalMode =
  "none" | "before-call" | "before-commit";

export interface KanvasAgentToolExecution {
  readonly modelOutput: unknown;
  readonly outcomeReference?: AgentActionOutcomeReference;
}

export interface KanvasAgentToolDescriptor<
  TInput = unknown,
  TOutput = unknown,
> {
  readonly key: string;
  readonly description: string;
  readonly inputSchema: JSONSchema7;
  readonly outputSchema?: JSONSchema7;
  readonly effect: KanvasAgentToolEffect;
  readonly approvalMode: KanvasAgentToolApprovalMode;
  /**
   * This executor must re-run canonical validation, current authorization,
   * budget, egress and resource checks. The Mastra schema is not a security
   * boundary.
   */
  readonly executeCanonical: (input: TInput) => Promise<TOutput>;
  readonly toModelOutput?: (output: TOutput) => unknown;
}

const toolKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

const serverOwnedFields = new Set([
  "billingAccount",
  "costOverride",
  "credentialId",
  "executionTarget",
  "permission",
  "subjectId",
  "workspaceId",
]);

const unsupportedSchemaKeywords = new Set([
  "$id",
  "$ref",
  "$schema",
  "$recursiveRef",
  "$dynamicRef",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function assertAgentFacingSchemaNode(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertAgentFacingSchemaNode(entry, path + "[" + String(index) + "]"),
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (unsupportedSchemaKeywords.has(key)) {
      throw new Error(
        "Agent-facing schema " +
          path +
          " contains unsupported keyword " +
          key +
          ".",
      );
    }
    if (key === "properties" && isRecord(child)) {
      for (const propertyName of Object.keys(child)) {
        if (serverOwnedFields.has(propertyName)) {
          throw new Error(
            "Agent-facing schema " +
              path +
              " exposes server-owned field " +
              propertyName +
              ".",
          );
        }
      }
    }
    assertAgentFacingSchemaNode(child, path + "." + key);
  }
}

function assertDescriptor(
  descriptor: KanvasAgentToolDescriptor,
  seenKeys: Set<string>,
): void {
  if (descriptor.key.length > 96 || !toolKeyPattern.test(descriptor.key)) {
    throw new Error("Agent Tool key " + descriptor.key + " is invalid.");
  }
  if (seenKeys.has(descriptor.key)) {
    throw new Error("Agent Tool key " + descriptor.key + " is duplicated.");
  }
  seenKeys.add(descriptor.key);

  const description = descriptor.description.trim();
  if (description.length < 12 || description.length > 512) {
    throw new Error(
      "Agent Tool " +
        descriptor.key +
        " description must contain 12 to 512 characters.",
    );
  }
  if (containsControlCharacter(description)) {
    throw new Error(
      "Agent Tool " +
        descriptor.key +
        " description must be a single plain-text line.",
    );
  }
  if (descriptor.inputSchema.type !== "object") {
    throw new Error(
      "Agent Tool " +
        descriptor.key +
        " input schema must be an object schema.",
    );
  }
  if (
    (descriptor.effect === "external-write" ||
      descriptor.effect === "destructive") &&
    descriptor.approvalMode === "none"
  ) {
    throw new Error(
      "Agent Tool " + descriptor.key + " requires an explicit approval mode.",
    );
  }

  assertAgentFacingSchemaNode(descriptor.inputSchema, descriptor.key);
  if (descriptor.outputSchema) {
    assertAgentFacingSchemaNode(
      descriptor.outputSchema,
      descriptor.key + ".output",
    );
  }
}

export function createKanvasMastraTools(
  descriptors: readonly KanvasAgentToolDescriptor[],
): Readonly<Record<string, Tool<unknown, unknown>>> {
  const seenKeys = new Set<string>();
  const tools: Record<string, Tool<unknown, unknown>> = {};

  for (const descriptor of descriptors) {
    assertDescriptor(descriptor, seenKeys);

    tools[descriptor.key] = createTool({
      id: descriptor.key,
      description: descriptor.description.trim(),
      inputSchema: descriptor.inputSchema,
      ...(descriptor.outputSchema
        ? { outputSchema: descriptor.outputSchema }
        : {}),
      requireApproval: descriptor.approvalMode === "before-call",
      execute: async (input) => descriptor.executeCanonical(input),
      ...(descriptor.toModelOutput
        ? { toModelOutput: descriptor.toModelOutput }
        : {}),
    });
  }

  return Object.freeze(tools);
}
