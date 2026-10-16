import { describe, expect, it } from "vitest";

import {
  compileWorkflowAuthoringBinding,
  compileWorkflowAuthoringGraph,
  compileWorkflowAuthoringWorkspace,
  projectWorkflowAuthoringBinding,
  projectWorkflowAuthoringGraph,
  workflowAuthoringInputNodeId,
  workflowAuthoringOutputNodeId,
  type WorkflowAuthoringGraphV1,
  type WorkflowAuthoringLayoutV1,
} from "../src/workflow-authoring/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const capability = (contractId: string) => ({
  contractId,
  revision: 1,
  canonicalDigest: digest,
});
const inputField = {
  key: "source_artifact_id",
  label: "Source image",
  required: true,
  schema: { type: "string", format: "ulid" },
};
const inputVariable = {
  kind: "variable" as const,
  variable: {
    source: "workflow_input" as const,
    path: ["source_artifact_id"],
  },
};
const outputVariable = (nodeKey: string, field: string) => ({
  kind: "variable" as const,
  variable: {
    source: "node_output" as const,
    nodeKey,
    scope: "root" as const,
    path: [field],
  },
});

function acceptanceGraph(): WorkflowAuthoringGraphV1 {
  return {
    schemaVersion: 1,
    workflowKey: "product_image_review",
    limits: { maxNodeRuns: 100, timeoutMs: 300_000 },
    nodes: [
      {
        id: workflowAuthoringInputNodeId,
        type: "input",
        displayName: "Input",
        schemaMetadata: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
        },
        fields: [inputField],
      },
      {
        id: "detect_subject",
        nodeKey: "detect_subject",
        type: "capability",
        displayName: "Detect subject",
        capability: capability("image.subject.detect"),
        input: {
          kind: "object",
          fields: { sourceArtifactId: inputVariable },
        },
      },
      {
        id: "remove_background",
        nodeKey: "remove_background",
        type: "capability",
        displayName: "Remove background",
        capability: capability("image.background.remove"),
        input: {
          kind: "object",
          fields: { sourceArtifactId: inputVariable },
        },
      },
      {
        id: "batch_enhance",
        nodeKey: "batch_enhance",
        type: "batch",
        displayName: "Enhance candidates",
        joinPolicy: "all_success",
        items: outputVariable("remove_background", "candidates"),
        scopeKey: {
          kind: "variable",
          variable: { source: "map_item", path: ["artifactId"] },
        },
        maxItems: 12,
        maxConcurrency: 3,
        failureMode: "collect_all",
        capability: capability("image.light.enhance"),
        input: {
          kind: "object",
          fields: {
            sourceArtifactId: {
              kind: "variable",
              variable: { source: "map_item", path: ["artifactId"] },
            },
          },
        },
      },
      {
        id: "quality_gate",
        nodeKey: "quality_gate",
        type: "condition",
        displayName: "Quality gate",
        value: outputVariable("batch_enhance", "summary"),
        cases: [
          {
            id: "needs_review",
            label: "Needs review",
            operator: "exists",
          },
        ],
        defaultLabel: "Ready",
      },
      {
        id: "review_result",
        nodeKey: "review_result",
        type: "approval",
        displayName: "Review result",
        request: {
          kind: "object",
          fields: {
            items: outputVariable("batch_enhance", "items"),
          },
        },
        decisionSchema: {
          approved: { type: "boolean" },
        },
      },
      {
        id: "package_result",
        nodeKey: "package_result",
        type: "capability",
        displayName: "Package result",
        capability: capability("artifact.package"),
        input: {
          kind: "object",
          fields: { items: outputVariable("batch_enhance", "items") },
        },
      },
      {
        id: workflowAuthoringOutputNodeId,
        type: "output",
        displayName: "Output",
        schemaMetadata: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
        },
        fields: [
          {
            key: "result_artifact_id",
            label: "Result image",
            required: true,
            schema: { type: "string", format: "ulid" },
            binding: outputVariable("package_result", "artifactId"),
          },
        ],
      },
    ],
    edges: [
      {
        id: "start",
        source: workflowAuthoringInputNodeId,
        sourcePort: "start",
        target: "detect_subject",
      },
      {
        id: "detect-remove",
        source: "detect_subject",
        sourcePort: "out",
        target: "remove_background",
      },
      {
        id: "detect-batch",
        source: "detect_subject",
        sourcePort: "out",
        target: "batch_enhance",
      },
      {
        id: "remove-batch",
        source: "remove_background",
        sourcePort: "out",
        target: "batch_enhance",
      },
      {
        id: "batch-quality",
        source: "batch_enhance",
        sourcePort: "out",
        target: "quality_gate",
      },
      {
        id: "review",
        source: "quality_gate",
        sourcePort: "case:needs_review",
        target: "review_result",
      },
      {
        id: "ready",
        source: "quality_gate",
        sourcePort: "default",
        target: "package_result",
      },
      {
        id: "review-package",
        source: "review_result",
        sourcePort: "out",
        target: "package_result",
      },
      {
        id: "finish",
        source: "package_result",
        sourcePort: "out",
        target: workflowAuthoringOutputNodeId,
      },
    ],
  };
}

describe("workflow authoring graph v1", () => {
  it("round-trips text templates with embedded variables", () => {
    const binding = {
      kind: "text" as const,
      segments: [
        { kind: "literal" as const, text: "Describe " },
        {
          kind: "variable" as const,
          variable: {
            source: "workflow_input" as const,
            path: ["source_artifact_id"],
          },
        },
      ],
    };
    const compiled = compileWorkflowAuthoringBinding(binding);
    expect(compiled).toEqual({
      $string: [
        "Describe ",
        {
          $value: {
            source: "workflow_input",
            pointer: "/source_artifact_id",
          },
        },
      ],
    });
    expect(projectWorkflowAuthoringBinding(compiled)).toEqual(binding);
  });

  it("round-trips ordered branch result coalescing", () => {
    const binding = {
      kind: "coalesce" as const,
      variables: [
        outputVariable("generate", "imageArtifactId").variable,
        outputVariable("edit", "imageArtifactId").variable,
      ],
    };
    const compiled = compileWorkflowAuthoringBinding(binding);
    expect(compiled).toEqual({
      $coalesce: [
        {
          $value: {
            source: "node_output",
            nodeKey: "generate",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
        {
          $value: {
            source: "node_output",
            nodeKey: "edit",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
      ],
    });
    expect(projectWorkflowAuthoringBinding(compiled)).toEqual(binding);
  });
  it("round-trips semantic variable paths and collision-safe literal objects", () => {
    const variable = {
      kind: "variable" as const,
      variable: {
        source: "workflow_input" as const,
        path: ["source/image", "~metadata"],
      },
    };
    expect(compileWorkflowAuthoringBinding(variable)).toEqual({
      $value: {
        source: "workflow_input",
        pointer: "/source~1image/~0metadata",
      },
    });
    expect(
      projectWorkflowAuthoringBinding(
        compileWorkflowAuthoringBinding(variable),
      ),
    ).toEqual(variable);

    const literal = {
      kind: "literal" as const,
      value: { $value: "ordinary business data" },
    };
    expect(compileWorkflowAuthoringBinding(literal)).toEqual({
      $literal: { $value: "ordinary business data" },
    });
    expect(
      projectWorkflowAuthoringBinding(compileWorkflowAuthoringBinding(literal)),
    ).toEqual(literal);
  });

  it("compiles all six authoring nodes without adding Input, Output, Parallel, or Join NodeRuns", () => {
    const document = compileWorkflowAuthoringGraph(acceptanceGraph());
    expect(document.topology.nodes.map((node) => node.kind)).toEqual([
      "invoke",
      "invoke",
      "map",
      "switch",
      "approval",
      "invoke",
    ]);
    expect(document.topology.entryNodeKey).toBe("detect_subject");
    expect(document.topology.outputs.result_artifact_id).toMatchObject({
      required: true,
      value: {
        $value: {
          source: "node_output",
          nodeKey: "package_result",
          pointer: "/artifactId",
        },
      },
    });
    expect(document.topology.nodes).toHaveLength(6);
  });

  it("preserves fixed parallel edges, activated-edge joins, condition ports, and batch scope", () => {
    const document = compileWorkflowAuthoringGraph(acceptanceGraph());
    expect(document.topology.nodes[0]).toMatchObject({
      key: "detect_subject",
      next: ["remove_background", "batch_enhance"],
    });
    expect(document.topology.nodes[2]).toMatchObject({
      key: "batch_enhance",
      kind: "map",
      joinPolicy: "all_success",
      maxItems: 12,
      maxConcurrency: 3,
      failureMode: "collect_all",
    });
    expect(document.topology.nodes[3]).toMatchObject({
      key: "quality_gate",
      kind: "switch",
      cases: [{ when: { operator: "exists" }, next: ["review_result"] }],
      defaultNext: ["package_result"],
    });
  });

  it("preserves an explicit terminal condition branch without accepting a disconnected branch", () => {
    const graph = acceptanceGraph();
    const terminalGraph = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === "ready"
          ? { ...edge, target: workflowAuthoringOutputNodeId }
          : edge,
      ),
    };
    const compiled = compileWorkflowAuthoringGraph(terminalGraph);
    expect(
      compiled.topology.nodes.find((node) => node.key === "quality_gate"),
    ).toMatchObject({ defaultNext: [] });
    const projected = projectWorkflowAuthoringGraph(compiled);
    expect(projected.edges).toContainEqual(
      expect.objectContaining({
        source: "quality_gate",
        sourcePort: "default",
        target: workflowAuthoringOutputNodeId,
      }),
    );
    expect(compileWorkflowAuthoringGraph(projected).topology).toEqual(
      compiled.topology,
    );
    expect(() =>
      compileWorkflowAuthoringGraph({
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== "ready"),
      }),
    ).toThrow(/default runtime target or Output/u);
  });

  it("projects an existing document and recompiles it without changing execution facts", () => {
    const original = compileWorkflowAuthoringGraph(acceptanceGraph());
    const projected = projectWorkflowAuthoringGraph(original);
    const recompiled = compileWorkflowAuthoringGraph(projected);
    expect(recompiled).toEqual(original);
  });

  it("keeps authoring layout outside the compiled document", () => {
    const graph = acceptanceGraph();
    const left: WorkflowAuthoringLayoutV1 = {
      schemaVersion: 1,
      positions: { detect_subject: { x: 40, y: 120 } },
    };
    const right: WorkflowAuthoringLayoutV1 = {
      schemaVersion: 1,
      positions: { detect_subject: { x: 840, y: 520 } },
      viewport: { x: -240, y: 80, zoom: 0.8 },
    };
    const leftWorkspace = compileWorkflowAuthoringWorkspace(graph, left);
    const rightWorkspace = compileWorkflowAuthoringWorkspace(graph, right);
    expect(leftWorkspace.layout).not.toEqual(rightWorkspace.layout);
    expect(leftWorkspace.document).toEqual(rightWorkspace.document);
  });

  it("rejects cycles and nodes that cannot reach the Output boundary", () => {
    const graph = acceptanceGraph();
    const cycle = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "package-cycle",
          source: "package_result",
          sourcePort: "out" as const,
          target: "detect_subject",
        },
      ],
    };
    expect(() => compileWorkflowAuthoringGraph(cycle)).toThrowError(
      expect.objectContaining({ code: "cycle_detected" }),
    );

    const withoutOutput = {
      ...graph,
      edges: graph.edges.filter(
        (edge) => edge.target !== workflowAuthoringOutputNodeId,
      ),
    };
    expect(() => compileWorkflowAuthoringGraph(withoutOutput)).toThrowError(
      expect.objectContaining({ code: "output_edge_invalid" }),
    );
  });
});
