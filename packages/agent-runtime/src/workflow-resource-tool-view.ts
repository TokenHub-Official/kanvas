import type {
  AgentSkillEntrypointView,
  AgentSurfaceView,
} from "@kanvas/application";
import type { JSONSchema7 } from "json-schema";

import type {
  AgentToolFamilyProjection,
  AgentWorkflowEntrypointBinding,
} from "./dynamic-tool-view.js";
import type { KanvasAgentToolExecution } from "./tool-view.js";

export interface WorkflowSearchToolInput {
  readonly query?: string;
}

export interface WorkflowInspectToolInput {
  readonly workflowRevisionId: string;
}

export interface WorkflowProposeToolInput {
  readonly workflowRevisionId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type AgentWorkflowProposalBinding =
  | {
      readonly source: "catalog";
      readonly actionRef: "workflow-catalog";
      readonly toolKey: "workflow.propose";
      readonly workflowRevisionId: string;
    }
  | (AgentWorkflowEntrypointBinding & {
      readonly source: "skill_entrypoint";
    });

export interface PrepareAgentWorkflowOptions {
  readonly binding: AgentWorkflowProposalBinding;
  readonly input: Readonly<Record<string, unknown>>;
}

export type WorkflowResourceToolExecution = KanvasAgentToolExecution;

export interface WorkflowResourceToolExecutor {
  readonly search: (
    input: WorkflowSearchToolInput,
  ) => Promise<WorkflowResourceToolExecution>;
  readonly inspect: (
    input: WorkflowInspectToolInput,
  ) => Promise<WorkflowResourceToolExecution>;
  readonly propose?: (
    options: PrepareAgentWorkflowOptions,
  ) => Promise<WorkflowResourceToolExecution>;
}

interface DynamicEntrypoint {
  readonly skillRevisionId: string;
  readonly entrypoint: AgentSkillEntrypointView;
}

const idSchema = {
  type: "string",
  minLength: 26,
  maxLength: 26,
  pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
} as const satisfies JSONSchema7;

function recordSchema(value: Readonly<Record<string, unknown>>): JSONSchema7 {
  if (value.type !== "object") {
    throw new Error(
      "Agent Workflow Entrypoint input schema must be an object schema.",
    );
  }
  const project = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(project);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node as Readonly<Record<string, unknown>>).flatMap(
        ([key, child]) =>
          key === "$id" || key === "$schema" ? [] : [[key, project(child)]],
      ),
    );
  };
  return project(value) as JSONSchema7;
}

function boundedDescription(entrypoint: AgentSkillEntrypointView): string {
  const value =
    `Prepare a reviewable Workflow action for ${entrypoint.displayName}. ${entrypoint.description}`
      .replace(/\s+/gu, " ")
      .trim();
  return value.slice(0, 512);
}

function inputRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent Workflow input must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function proposalInput(value: unknown): WorkflowProposeToolInput {
  const input = inputRecord(value);
  if (
    Object.keys(input).some(
      (key) => key !== "workflowRevisionId" && key !== "input",
    ) ||
    typeof input.workflowRevisionId !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(input.workflowRevisionId)
  ) {
    throw new TypeError("Agent Workflow proposal identity is invalid.");
  }
  return Object.freeze({
    workflowRevisionId: input.workflowRevisionId,
    input: inputRecord(input.input),
  });
}

function dynamicEntrypoints(
  view: AgentSurfaceView,
  eligibleWorkflowRevisionIds: ReadonlySet<string>,
): readonly DynamicEntrypoint[] {
  return Object.freeze(
    view.skills
      .flatMap((skill) =>
        skill.entrypoints.map((entrypoint) => ({
          skillRevisionId: skill.skillRevisionId,
          entrypoint,
        })),
      )
      .filter(({ entrypoint }) =>
        eligibleWorkflowRevisionIds.has(entrypoint.workflowRevisionId),
      )
      .toSorted(
        (left, right) =>
          left.skillRevisionId.localeCompare(right.skillRevisionId) ||
          left.entrypoint.entrypointKey.localeCompare(
            right.entrypoint.entrypointKey,
          ),
      ),
  );
}

export function createWorkflowResourceToolProjection(options: {
  readonly surfaceView: AgentSurfaceView;
  readonly eligibleWorkflowRevisionIds: ReadonlySet<string>;
  readonly executor: WorkflowResourceToolExecutor;
}): AgentToolFamilyProjection {
  const propose = options.executor.propose;
  const bindings = new Map<string, AgentWorkflowEntrypointBinding>();
  const proposalDescriptors = propose
    ? [
        Object.freeze({
          key: "workflow.propose",
          description:
            "Prepare a reviewable run of an exact published and enabled Workspace Workflow returned by workflow.search or workflow.inspect. The user does not need to provide an internal identifier.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["workflowRevisionId", "input"],
            properties: {
              workflowRevisionId: idSchema,
              input: { type: "object", additionalProperties: true },
            },
          } satisfies JSONSchema7,
          effect: "compute" as const,
          approvalMode: "before-commit" as const,
          executeCanonical: (value: unknown) => {
            const input = proposalInput(value);
            return propose({
              binding: Object.freeze({
                source: "catalog",
                actionRef: "workflow-catalog",
                toolKey: "workflow.propose",
                workflowRevisionId: input.workflowRevisionId,
              }),
              input: input.input,
            });
          },
          toModelOutput: (output: unknown) =>
            (output as WorkflowResourceToolExecution).modelOutput,
        }),
        ...dynamicEntrypoints(
          options.surfaceView,
          options.eligibleWorkflowRevisionIds,
        ).map(({ skillRevisionId, entrypoint }, index) => {
          const ordinal = index + 1;
          const actionRef = `workflow-entrypoint-${String(ordinal)}`;
          const toolKey = `workflow.propose.entrypoint-${String(ordinal)}`;
          const binding = Object.freeze({
            actionRef,
            toolKey,
            skillRevisionId,
            entrypointKey: entrypoint.entrypointKey,
            workflowRevisionId: entrypoint.workflowRevisionId,
          });
          bindings.set(toolKey, binding);
          return Object.freeze({
            key: toolKey,
            description: boundedDescription(entrypoint),
            inputSchema: recordSchema(entrypoint.inputSchema),
            effect: "compute" as const,
            approvalMode: "before-commit" as const,
            executeCanonical: (input: unknown) =>
              propose({
                binding: Object.freeze({
                  source: "skill_entrypoint",
                  ...binding,
                }),
                input: inputRecord(input),
              }),
            toModelOutput: (output: unknown) =>
              (output as WorkflowResourceToolExecution).modelOutput,
          });
        }),
      ]
    : [];
  return Object.freeze({
    family: "workflow" as const,
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      catalog: "published-enabled-workflow-revisions",
      proposal: propose ? "action-receipt-before-commit" : "unavailable",
      entrypoints: Object.freeze([...bindings.values()]),
    }),
    descriptors: Object.freeze([
      Object.freeze({
        key: "workflow.search",
        description:
          "Search published and enabled Workspace Workflows by business name, description, category, or tag. Agent bindings and an explicit request selection improve result order but never grant authority.",
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
          options.executor.search(input as WorkflowSearchToolInput),
        toModelOutput: (output: unknown) =>
          (output as WorkflowResourceToolExecution).modelOutput,
      }),
      Object.freeze({
        key: "workflow.inspect",
        description:
          "Inspect the business presentation and executable input contract of one exact published Workspace Workflow returned by workflow.search before proposing a run.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["workflowRevisionId"],
          properties: { workflowRevisionId: idSchema },
        } satisfies JSONSchema7,
        effect: "read" as const,
        approvalMode: "none" as const,
        executeCanonical: (input: unknown) =>
          options.executor.inspect(input as WorkflowInspectToolInput),
        toModelOutput: (output: unknown) =>
          (output as WorkflowResourceToolExecution).modelOutput,
      }),
      ...proposalDescriptors,
    ]),
    ...(bindings.size > 0 ? { workflowEntrypoints: new Map(bindings) } : {}),
  });
}
