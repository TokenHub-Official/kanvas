import {
  createWorkflowCatalog,
  type AgentActionReceiptRecord,
  type TrustedWorkspaceScope,
  type WorkflowCatalogRepository,
  type WorkflowTemplate,
} from "@kanvas/application";
import type {
  PrepareAgentWorkflowOptions,
  WorkflowInspectToolInput,
  WorkflowResourceToolExecution,
  WorkflowResourceToolExecutor,
  WorkflowSearchToolInput,
} from "@kanvas/agent-runtime";
import { validateEffectiveInvocationInput } from "@kanvas/contracts/api";
import { Ajv2020 } from "ajv/dist/2020.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumResults = 20;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function searchInput(value: unknown): WorkflowSearchToolInput {
  const input = record(value);
  const query = input?.query;
  if (
    !input ||
    Object.keys(input).some((key) => key !== "query") ||
    (query !== undefined &&
      (typeof query !== "string" ||
        query.trim().length < 1 ||
        [...query.trim()].length > 200))
  ) {
    throw new TypeError("Workflow search input is invalid.");
  }
  return Object.freeze({
    ...(typeof query === "string" ? { query: query.trim() } : {}),
  });
}

function inspectInput(value: unknown): WorkflowInspectToolInput {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "workflowRevisionId") ||
    typeof input.workflowRevisionId !== "string" ||
    !idPattern.test(input.workflowRevisionId)
  ) {
    throw new TypeError("Workflow inspection input is invalid.");
  }
  return Object.freeze({ workflowRevisionId: input.workflowRevisionId });
}

function workflowName(template: WorkflowTemplate): string {
  return template.presentation?.title ?? template.displayName;
}

function workflowDescription(template: WorkflowTemplate): string | undefined {
  return template.presentation?.description ?? template.description;
}

function workflowCategory(template: WorkflowTemplate): string | undefined {
  return template.presentation?.category ?? template.category;
}

function normalizedText(value: string | undefined): string {
  return value?.replace(/\s+/gu, " ").trim().toLocaleLowerCase() ?? "";
}

function workflowMatches(workflow: WorkflowTemplate, query: string): boolean {
  return (
    normalizedText(workflowName(workflow)).includes(query) ||
    normalizedText(workflowDescription(workflow)).includes(query) ||
    normalizedText(workflowCategory(workflow)).includes(query) ||
    (workflow.presentation?.tags ?? []).some((tag) =>
      normalizedText(tag).includes(query),
    )
  );
}

function workflowPriority(
  workflow: WorkflowTemplate,
  options: {
    readonly selectedWorkflowRevisionIds: ReadonlySet<string>;
    readonly boundWorkflowDefinitionIds: ReadonlySet<string>;
  },
): number {
  if (options.selectedWorkflowRevisionIds.has(workflow.workflowRevisionId)) {
    return 0;
  }
  if (options.boundWorkflowDefinitionIds.has(workflow.workflowDefinitionId)) {
    return 1;
  }
  return 2;
}

function assertWorkflowInput(
  workflow: WorkflowTemplate,
  input: Readonly<Record<string, unknown>>,
): void {
  const effective = workflow.effectiveInvocationSchema;
  if (effective?.availability === "unavailable") {
    throw Object.assign(new Error("Workflow invocation is unavailable."), {
      code: "agent.workflow_invocation_unavailable",
      effect: "not_started",
    });
  }
  if (effective?.availability === "available") {
    if (
      validateEffectiveInvocationInput(effective.validationSchema, input)
        .length > 0
    ) {
      throw new TypeError(
        "Workflow input does not match its effective invocation contract.",
      );
    }
    return;
  }
  const valid = (() => {
    try {
      return new Ajv2020({
        allErrors: true,
        strict: false,
        validateFormats: false,
      }).compile(workflow.inputSchema)(input);
    } catch {
      return false;
    }
  })();
  if (!valid) {
    throw new TypeError(
      "Workflow input does not match its published contract.",
    );
  }
}

function workflowModelOutput(
  workflow: WorkflowTemplate,
  options: {
    readonly selectedWorkflowRevisionIds: ReadonlySet<string>;
    readonly boundWorkflowDefinitionIds: ReadonlySet<string>;
    readonly includeContracts: boolean;
  },
) {
  const effective = workflow.effectiveInvocationSchema;
  return Object.freeze({
    workflowRevisionId: workflow.workflowRevisionId,
    name: workflowName(workflow),
    ...(workflowDescription(workflow)
      ? { description: workflowDescription(workflow) }
      : {}),
    ...(workflowCategory(workflow)
      ? { category: workflowCategory(workflow) }
      : {}),
    ...(workflow.presentation?.tags
      ? { tags: Object.freeze([...workflow.presentation.tags]) }
      : {}),
    revision: workflow.revision,
    selectedForRequest: options.selectedWorkflowRevisionIds.has(
      workflow.workflowRevisionId,
    ),
    boundToAgent: options.boundWorkflowDefinitionIds.has(
      workflow.workflowDefinitionId,
    ),
    inputAvailability: effective?.availability ?? "published_schema",
    ...(effective?.availability === "unavailable"
      ? { inputUnavailableReason: effective.reason }
      : {}),
    ...(options.includeContracts
      ? {
          inputSchema: workflow.inputSchema,
          outputSchema: workflow.outputSchema,
          ...(effective?.availability === "available"
            ? {
                effectiveInputFields: Object.freeze([...effective.fields]),
                controlledParameterKeys: Object.freeze([
                  ...effective.controlledParameterKeys,
                ]),
              }
            : {}),
        }
      : {}),
    publishedAt: workflow.publishedAt.toISOString(),
  });
}

export function createAgentWorkflowResourceExecutor(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly catalog: WorkflowCatalogRepository;
  readonly selectedWorkflowRevisionIds: ReadonlySet<string>;
  readonly boundWorkflowDefinitionIds: ReadonlySet<string>;
  readonly now: () => Date;
  readonly prepareProposal?: (options: {
    readonly binding: PrepareAgentWorkflowOptions["binding"];
    readonly workflow: WorkflowTemplate;
    readonly input: Readonly<Record<string, unknown>>;
  }) => Promise<WorkflowResourceToolExecution>;
  readonly executeWithReceipt: (
    toolKey: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<WorkflowResourceToolExecution>,
    failureReason: (error: unknown) => string,
  ) => Promise<WorkflowResourceToolExecution>;
}): WorkflowResourceToolExecutor {
  const prepareProposal = options.prepareProposal;
  const catalog = createWorkflowCatalog({
    repository: options.catalog,
    now: options.now,
  });
  const getExecutableWorkflow = async (
    workflowRevisionId: string,
  ): Promise<WorkflowTemplate> => {
    const workflow = await catalog.get(options.authority, workflowRevisionId);
    if (workflow.runtimeStatus !== "enabled") {
      throw Object.assign(new Error("Workflow is not executable."), {
        code: "agent.workflow_unavailable",
        effect: "not_started",
      });
    }
    return workflow;
  };
  return Object.freeze({
    search: (value: WorkflowSearchToolInput) => {
      const input = searchInput(value);
      return options.executeWithReceipt(
        "workflow.search",
        input,
        async () => {
          const available = await catalog.list(options.authority);
          const query = normalizedText(input.query);
          const queryMatches = query
            ? available.filter((workflow) => workflowMatches(workflow, query))
            : available;
          const selected = available.filter((workflow) =>
            options.selectedWorkflowRevisionIds.has(
              workflow.workflowRevisionId,
            ),
          );
          const matching = [
            ...new Map(
              [...selected, ...queryMatches].map((workflow) => [
                workflow.workflowRevisionId,
                workflow,
              ]),
            ).values(),
          ];
          const fallback = Boolean(query) && queryMatches.length === 0;
          const workflows = fallback ? available : matching;
          const results = workflows
            .toSorted((left, right) => {
              const leftPriority = workflowPriority(left, options);
              const rightPriority = workflowPriority(right, options);
              return (
                leftPriority - rightPriority ||
                workflowName(left).localeCompare(workflowName(right)) ||
                left.workflowRevisionId.localeCompare(right.workflowRevisionId)
              );
            })
            .slice(0, maximumResults)
            .map((workflow) =>
              workflowModelOutput(workflow, {
                selectedWorkflowRevisionIds:
                  options.selectedWorkflowRevisionIds,
                boundWorkflowDefinitionIds: options.boundWorkflowDefinitionIds,
                includeContracts: false,
              }),
            );
          return Object.freeze({
            modelOutput: Object.freeze({
              ...(fallback
                ? { queryMatched: false, showingAvailableWorkflows: true }
                : {}),
              workflows: Object.freeze(results),
              ...(workflows.length > results.length
                ? { truncated: true, totalResults: workflows.length }
                : {}),
            }),
            outcomeReference: {
              kind: "query" as const,
              resultCount: results.length,
            },
          });
        },
        () => "agent.workflow_catalog_unavailable",
      );
    },
    inspect: (value: WorkflowInspectToolInput) => {
      const input = inspectInput(value);
      return options.executeWithReceipt(
        "workflow.inspect",
        input,
        async () => {
          const workflow = await getExecutableWorkflow(
            input.workflowRevisionId,
          );
          return Object.freeze({
            modelOutput: Object.freeze({
              workflow: workflowModelOutput(workflow, {
                selectedWorkflowRevisionIds:
                  options.selectedWorkflowRevisionIds,
                boundWorkflowDefinitionIds: options.boundWorkflowDefinitionIds,
                includeContracts: true,
              }),
            }),
            outcomeReference: { kind: "query" as const, resultCount: 1 },
          });
        },
        () => "agent.workflow_read_failed",
      );
    },
    ...(prepareProposal
      ? {
          propose: async (proposal: PrepareAgentWorkflowOptions) => {
            if (
              !options.authority.effectivePermissions.includes("workflow.run")
            ) {
              throw Object.assign(
                new Error("Workflow execution permission is required."),
                {
                  code: "agent.workflow_permission_denied",
                  effect: "not_started",
                },
              );
            }
            const input = record(proposal.input);
            if (
              !input ||
              !idPattern.test(proposal.binding.workflowRevisionId)
            ) {
              throw new TypeError("Workflow proposal input is invalid.");
            }
            const workflow = await getExecutableWorkflow(
              proposal.binding.workflowRevisionId,
            );
            assertWorkflowInput(workflow, input);
            return prepareProposal({
              binding: proposal.binding,
              workflow,
              input,
            });
          },
        }
      : {}),
  });
}
