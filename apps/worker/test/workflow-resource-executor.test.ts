import type {
  AgentActionReceiptRecord,
  TrustedWorkspaceScope,
  WorkflowCatalogRepository,
  WorkflowTemplate,
} from "@kanvas/application";
import type { PrepareAgentWorkflowOptions } from "@kanvas/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import { createAgentWorkflowResourceExecutor } from "../src/agent/workflow-resource-executor.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-14T18:00:00.000Z");
const authority = {
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "workflow-resource-test",
  authorityType: "human_membership",
  authorityId: id(4),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "workflow.read", "workflow.run"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

function workflow(options: {
  readonly definitionId: string;
  readonly revisionId: string;
  readonly name: string;
}): WorkflowTemplate {
  return {
    workflowDefinitionId: options.definitionId,
    workflowRevisionId: options.revisionId,
    workflowKey: `technical.${options.revisionId.toLocaleLowerCase()}`,
    revision: 1,
    displayName: `${options.name} internal`,
    canonicalDigest: `sha256:${"a".repeat(64)}`,
    runtimeStatus: "enabled",
    topology: { schemaVersion: 1, key: "test", nodes: [] },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["brief"],
      properties: { brief: { type: "string", minLength: 1 } },
    },
    outputSchema: {
      type: "object",
      properties: { artifactId: { type: "string" } },
    },
    presentation: {
      schemaVersion: 1,
      title: options.name,
      description: `Create output with ${options.name}.`,
      category: "Campaign",
      tags: ["launch"],
      availability: { standalone: true, canvas: true, directLink: true },
    },
    publishedAt: now,
  } as unknown as WorkflowTemplate;
}

function harness(scope: TrustedWorkspaceScope = authority) {
  const selected = workflow({
    definitionId: id(10),
    revisionId: id(11),
    name: "Selected Workflow",
  });
  const bound = workflow({
    definitionId: id(20),
    revisionId: id(21),
    name: "Bound Workflow",
  });
  const other = workflow({
    definitionId: id(30),
    revisionId: id(31),
    name: "Other Workflow",
  });
  const templates = [other, bound, selected];
  const list = vi.fn<WorkflowCatalogRepository["list"]>(() =>
    Promise.resolve(templates),
  );
  const get = vi.fn<WorkflowCatalogRepository["get"]>(
    (_authority, workflowRevisionId) =>
      Promise.resolve(
        templates.find(
          (template) => template.workflowRevisionId === workflowRevisionId,
        ),
      ),
  );
  const executeWithReceipt = vi.fn(
    async (
      _toolKey: string,
      _input: unknown,
      operation: (
        action: AgentActionReceiptRecord,
      ) => Promise<{ readonly modelOutput: unknown }>,
    ) => operation({} as AgentActionReceiptRecord),
  );
  const prepareProposal = vi.fn(
    (options: {
      readonly binding: PrepareAgentWorkflowOptions["binding"];
      readonly workflow: WorkflowTemplate;
      readonly input: Readonly<Record<string, unknown>>;
    }) =>
      Promise.resolve({
        modelOutput: {
          status: "awaiting_approval",
          workflow: options.workflow.presentation?.title,
        },
      }),
  );
  const executor = createAgentWorkflowResourceExecutor({
    authority: scope,
    catalog: { list, get },
    selectedWorkflowRevisionIds: new Set([selected.workflowRevisionId]),
    boundWorkflowDefinitionIds: new Set([bound.workflowDefinitionId]),
    now: () => now,
    prepareProposal,
    executeWithReceipt,
  });
  return { executor, list, get, prepareProposal, selected, bound, other };
}

describe("createAgentWorkflowResourceExecutor", () => {
  it("reports a partial catalog instead of implying every match was returned", async () => {
    const { executor, list, selected } = harness();
    list.mockResolvedValue([
      selected,
      ...Array.from({ length: 30 }, (_, index) =>
        workflow({
          definitionId: id(100 + index),
          revisionId: id(200 + index),
          name: `Workflow ${index}`,
        }),
      ),
    ]);
    const result = await executor.search({});
    expect(result.modelOutput).toMatchObject({
      truncated: true,
      totalResults: 31,
    });
    expect(
      (result.modelOutput as { workflows: unknown[] }).workflows,
    ).toHaveLength(20);
  });

  it("searches enabled published Workflows and prioritizes selected then bound", async () => {
    const { executor, selected, bound, other } = harness();
    const result = await executor.search({});

    expect(result.modelOutput).toMatchObject({
      workflows: [
        {
          workflowRevisionId: selected.workflowRevisionId,
          name: "Selected Workflow",
          selectedForRequest: true,
        },
        {
          workflowRevisionId: bound.workflowRevisionId,
          name: "Bound Workflow",
          boundToAgent: true,
        },
        {
          workflowRevisionId: other.workflowRevisionId,
          name: "Other Workflow",
        },
      ],
    });
    expect(JSON.stringify(result.modelOutput)).not.toContain("technical.");

    const focused = await executor.search({ query: "Other Workflow" });
    expect(focused.modelOutput).toMatchObject({
      workflows: [
        { workflowRevisionId: selected.workflowRevisionId },
        { workflowRevisionId: other.workflowRevisionId },
      ],
    });

    const categoryResult = await executor.search({ query: "Campaign" });
    expect(JSON.stringify(categoryResult.modelOutput)).toContain(
      "Selected Workflow",
    );
  });

  it("inspects one exact executable Revision and its public contracts", async () => {
    const { executor, selected } = harness();
    const result = await executor.inspect({
      workflowRevisionId: selected.workflowRevisionId,
    });

    expect(result.modelOutput).toMatchObject({
      workflow: {
        workflowRevisionId: selected.workflowRevisionId,
        name: "Selected Workflow",
        inputSchema: { required: ["brief"] },
        outputSchema: { type: "object" },
      },
    });
  });

  it("validates the exact published Revision before preparing one reviewable Action", async () => {
    const { executor, prepareProposal, selected } = harness();
    await expect(
      executor.propose!({
        binding: {
          source: "catalog",
          actionRef: "workflow-catalog",
          toolKey: "workflow.propose",
          workflowRevisionId: selected.workflowRevisionId,
        },
        input: { brief: "Launch" },
      }),
    ).resolves.toMatchObject({
      modelOutput: { status: "awaiting_approval" },
    });
    expect(prepareProposal.mock.lastCall?.[0].binding.workflowRevisionId).toBe(
      selected.workflowRevisionId,
    );
    expect(prepareProposal.mock.lastCall?.[0].workflow).toBe(selected);
    expect(prepareProposal.mock.lastCall?.[0].input).toEqual({
      brief: "Launch",
    });

    await expect(
      executor.propose!({
        binding: {
          source: "catalog",
          actionRef: "workflow-catalog",
          toolKey: "workflow.propose",
          workflowRevisionId: selected.workflowRevisionId,
        },
        input: {},
      }),
    ).rejects.toThrow("published contract");
    expect(prepareProposal).toHaveBeenCalledOnce();
  });

  it("does not project or authorize proposals without workflow.run", async () => {
    const readOnly = {
      ...authority,
      effectivePermissions: ["agent.run", "workflow.read"],
    } as const satisfies TrustedWorkspaceScope;
    const { executor, selected } = harness(readOnly);
    const withoutProposal = createAgentWorkflowResourceExecutor({
      authority: readOnly,
      catalog: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
      },
      selectedWorkflowRevisionIds: new Set(),
      boundWorkflowDefinitionIds: new Set(),
      now: () => now,
      executeWithReceipt: async (_toolKey, _input, operation) =>
        operation({} as AgentActionReceiptRecord),
    });

    expect(executor.propose).toBeDefined();
    await expect(
      executor.propose!({
        binding: {
          source: "catalog",
          actionRef: "workflow-catalog",
          toolKey: "workflow.propose",
          workflowRevisionId: selected.workflowRevisionId,
        },
        input: { brief: "Launch" },
      }),
    ).rejects.toMatchObject({ code: "agent.workflow_permission_denied" });
    expect(withoutProposal.propose).toBeUndefined();
  });
});
