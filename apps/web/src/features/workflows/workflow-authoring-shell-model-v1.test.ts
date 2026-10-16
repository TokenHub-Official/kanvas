import { describe, expect, it } from "vitest";

import type { WorkflowAuthoringGraphV1 } from "@kanvas/contracts/workflow-authoring";

import {
  defaultWorkflowAuthoringShellLayout,
  workflowAuthoringNodeUsesCapabilityIdentity,
  workflowAuthoringShellIssues,
} from "./workflow-authoring-shell-model-v1.js";

const graph: WorkflowAuthoringGraphV1 = {
  schemaVersion: 1,
  workflowKey: "shell_probe",
  limits: { maxNodeRuns: 10, timeoutMs: 60_000 },
  nodes: [
    {
      id: "workflow_input",
      type: "input",
      displayName: "Input",
      schemaMetadata: {},
      fields: [],
    },
    {
      id: "prepare",
      nodeKey: "prepare",
      type: "capability",
      displayName: "Prepare",
      capability: {
        contractId: "image.prepare",
        revision: 1,
        canonicalDigest: `sha256:${"a".repeat(64)}`,
      },
      input: { kind: "object", fields: {} },
    },
    {
      id: "left",
      nodeKey: "left",
      type: "capability",
      displayName: "Left",
      capability: {
        contractId: "image.left",
        revision: 1,
        canonicalDigest: `sha256:${"b".repeat(64)}`,
      },
      input: { kind: "object", fields: {} },
    },
    {
      id: "right",
      nodeKey: "right",
      type: "capability",
      displayName: "Right",
      capability: {
        contractId: "image.right",
        revision: 1,
        canonicalDigest: `sha256:${"c".repeat(64)}`,
      },
      input: { kind: "object", fields: {} },
    },
    {
      id: "workflow_output",
      type: "output",
      displayName: "Output",
      schemaMetadata: {},
      fields: [],
    },
  ],
  edges: [
    {
      id: "start",
      source: "workflow_input",
      sourcePort: "start",
      target: "prepare",
    },
    { id: "left", source: "prepare", sourcePort: "out", target: "left" },
    { id: "right", source: "prepare", sourcePort: "out", target: "right" },
    {
      id: "left-end",
      source: "left",
      sourcePort: "out",
      target: "workflow_output",
    },
    {
      id: "right-end",
      source: "right",
      sourcePort: "out",
      target: "workflow_output",
    },
  ],
};

describe("workflow authoring immersive shell model", () => {
  it("recognizes legacy capability identifiers that should not be shown as titles", () => {
    const node = {
      ...graph.nodes[1],
      displayName: "image.prepare",
    } as Extract<
      WorkflowAuthoringGraphV1["nodes"][number],
      { type: "capability" }
    >;
    const capability = {
      contractId: "image.prepare",
      contractKey: "image_prepare",
      revision: 1,
    } as Parameters<typeof workflowAuthoringNodeUsesCapabilityIdentity>[1];

    expect(workflowAuthoringNodeUsesCapabilityIdentity(node, capability)).toBe(
      true,
    );
    expect(workflowAuthoringNodeUsesCapabilityIdentity(node)).toBe(true);
    expect(
      workflowAuthoringNodeUsesCapabilityIdentity(
        { ...node, displayName: "Prepare hero image" },
        capability,
      ),
    ).toBe(false);
  });

  it("lays parallel nodes in the same column and advances Output", () => {
    const layout = defaultWorkflowAuthoringShellLayout(graph);
    expect(layout.positions.left?.x).toBe(layout.positions.right?.x);
    expect(layout.positions.left?.y).not.toBe(layout.positions.right?.y);
    expect(layout.positions.workflow_output?.x).toBeGreaterThan(
      layout.positions.left?.x ?? 0,
    );
  });

  it("keeps boundary configuration problems attached to Input and Output", () => {
    expect(workflowAuthoringShellIssues(graph)).toEqual([
      { code: "input_fields_missing", nodeId: "workflow_input" },
      { code: "output_fields_missing", nodeId: "workflow_output" },
    ]);
  });

  it("surfaces missing data bindings for decision, batch, and output nodes", () => {
    const bindingGraph: WorkflowAuthoringGraphV1 = {
      ...graph,
      nodes: [
        {
          id: "workflow_input",
          type: "input",
          displayName: "Input",
          schemaMetadata: {},
          fields: [
            {
              key: "items",
              label: "Items",
              required: true,
              schema: { type: "array" },
            },
          ],
        },
        {
          id: "decision",
          nodeKey: "decision",
          type: "condition",
          displayName: "Decision",
          value: { kind: "literal", value: null },
          cases: [{ id: "case_1", label: "Yes", operator: "exists" }],
          defaultLabel: "Otherwise",
        },
        {
          id: "batch",
          nodeKey: "batch",
          type: "batch",
          displayName: "Batch",
          items: { kind: "literal", value: [] },
          scopeKey: {
            kind: "variable",
            variable: { source: "map_item", path: [] },
          },
          maxItems: 10,
          maxConcurrency: 2,
          failureMode: "fail_fast",
          capability: {
            contractId: "image.prepare",
            revision: 1,
            canonicalDigest: `sha256:${"a".repeat(64)}`,
          },
          input: { kind: "object", fields: {} },
        },
        {
          id: "workflow_output",
          type: "output",
          displayName: "Output",
          schemaMetadata: {},
          fields: [
            {
              key: "result",
              label: "Result",
              required: true,
              schema: { type: "string" },
              binding: { kind: "literal", value: null },
            },
          ],
        },
      ],
    };
    expect(workflowAuthoringShellIssues(bindingGraph)).toEqual([
      { code: "condition_value_missing", nodeId: "decision" },
      { code: "batch_items_missing", nodeId: "batch" },
      { code: "output_binding_missing", nodeId: "workflow_output" },
    ]);
  });
});
