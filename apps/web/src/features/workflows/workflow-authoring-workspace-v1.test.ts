import { readFileSync } from "node:fs";

import type {
  WorkflowAuthoringCapability,
  WorkflowDraft,
  WorkflowPresentation,
} from "@kanvas/contracts/api";
import {
  compileWorkflowAuthoringGraph,
  workflowAuthoringInputNodeId,
  workflowAuthoringOutputNodeId,
  type WorkflowAuthoringGraphV1,
} from "@kanvas/contracts/workflow-authoring";
import { describe, expect, it } from "vitest";

import {
  defaultWorkflowPresentation,
  groupAuthoringCapabilities,
  latestAuthoringCapabilities,
  localizeApprovalOutcomeGraph,
  normalizeWorkflowPresentation,
  preferredAuthoringInsertionEdge,
  replaceAuthoringEdgeWithApprovalGate,
} from "./workflow-authoring-workspace-v1.js";

function capability(
  contractId: string,
  revision: number,
): WorkflowAuthoringCapability {
  return {
    contractId,
    contractKey: contractId,
    revision,
    authoring: {
      origin: "declared",
      catalog: {
        title: { "zh-CN": contractId, "en-US": contractId },
        category: {
          "zh-CN": contractId.includes("generate") ? "图像生成" : "图像处理",
          "en-US": contractId.includes("generate")
            ? "Image generation"
            : "Image processing",
        },
      },
    },
  } as unknown as WorkflowAuthoringCapability;
}

describe("Workflow node library", () => {
  it("deduplicates revisions without imposing a presentation policy", () => {
    expect(
      latestAuthoringCapabilities([
        capability("image.generate", 1),
        capability("image.generate", 2),
        capability("foundation.echo", 1),
        capability("test.image.remove", 1),
      ]),
    ).toMatchObject([
      { contractId: "image.generate", revision: 2 },
      { contractId: "foundation.echo", revision: 1 },
      { contractId: "test.image.remove", revision: 1 },
    ]);
  });

  it("groups capabilities by business category", () => {
    expect(
      groupAuthoringCapabilities(
        [capability("image.generate", 2), capability("image.upscale", 1)],
        "zh-CN",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "图像生成",
          capabilities: [
            expect.objectContaining({ contractId: "image.generate" }),
          ],
        }),
        expect.objectContaining({
          label: "图像处理",
          capabilities: [
            expect.objectContaining({ contractId: "image.upscale" }),
          ],
        }),
      ]),
    );
  });

  it("drops the superseded outer input presentation map", () => {
    expect(
      normalizeWorkflowPresentation({
        schemaVersion: 1,
        title: "商品海报",
        tags: [],
        availability: {
          standalone: true,
          canvas: false,
          directLink: true,
        },
        inputUi: {
          schemaVersion: 1,
          fields: [{ key: "prompt", placeholder: "旧提示" }],
        },
      } as unknown as WorkflowPresentation),
    ).not.toHaveProperty("inputUi");
  });
});

describe("Workflow published presentation", () => {
  it("starts from definition metadata without a workflow-specific layout", () => {
    const draft = {
      definition: {
        displayName: "商品海报",
        description: "根据商品素材生成海报。",
        category: "海报制作",
      },
      draft: { document: {} },
    } as unknown as WorkflowDraft;
    expect(defaultWorkflowPresentation(draft)).toEqual({
      schemaVersion: 1,
      title: "商品海报",
      description: "根据商品素材生成海报。",
      category: "海报制作",
      tags: [],
      availability: {
        standalone: true,
        canvas: false,
        directLink: true,
      },
    });
  });
});

describe("Workflow author recovery boundary", () => {
  it("guards navigation and offers both 409 recovery choices", () => {
    const source = readFileSync(
      new URL("./workflow-authoring-workspace-v1.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<UnsavedChangesGuard");
    expect(source).toContain("writeWorkflowAuthoringRecovery");
    expect(source).toContain("error.status === apiConflictStatus");
    expect(source).toContain("keepLocalAfterConflict");
    expect(source).toContain("applyLatestAfterConflict");
  });
});

describe("Workflow approval gate authoring", () => {
  it("compiles the not-approved branch as terminal before the guarded node", () => {
    const guardedEdge = {
      id: "input:start:expensive",
      source: workflowAuthoringInputNodeId,
      sourcePort: "start" as const,
      target: "expensive",
    };
    const graph = {
      schemaVersion: 1,
      workflowKey: "approval_gate",
      limits: { maxNodeRuns: 10, timeoutMs: 60_000 },
      nodes: [
        {
          id: workflowAuthoringInputNodeId,
          type: "input",
          displayName: "Input",
          schemaMetadata: {},
          fields: [],
        },
        {
          id: "expensive",
          nodeKey: "expensive",
          type: "capability",
          displayName: "Expensive generation",
          capability: {
            contractId: "01K00000000000000000000000",
            revision: 1,
            canonicalDigest: `sha256:${"a".repeat(64)}`,
          },
          input: { kind: "literal", value: {} },
        },
        {
          id: workflowAuthoringOutputNodeId,
          type: "output",
          displayName: "Output",
          schemaMetadata: {},
          fields: [],
        },
      ],
      edges: [
        guardedEdge,
        {
          id: "expensive:out:output",
          source: "expensive",
          sourcePort: "out",
          target: workflowAuthoringOutputNodeId,
        },
      ],
    } satisfies WorkflowAuthoringGraphV1;
    const approval = {
      id: "approval",
      nodeKey: "approval",
      displayName: "Approval",
      type: "approval" as const,
      request: { kind: "literal" as const, value: {} },
      decisionSchema: {
        type: "object",
        properties: { approved: { type: "boolean" } },
        required: ["approved"],
      },
    };
    const outcome = {
      id: "approval_outcome",
      nodeKey: "approval_outcome",
      displayName: "Approval outcome",
      type: "condition" as const,
      value: {
        kind: "variable" as const,
        variable: {
          source: "node_output" as const,
          nodeKey: approval.nodeKey,
          scope: "root" as const,
          path: ["approved"],
        },
      },
      cases: [
        {
          id: "approved",
          label: "Approved",
          operator: "equals" as const,
          value: true,
        },
      ],
      defaultLabel: "Not approved",
    };

    const gatedGraph = replaceAuthoringEdgeWithApprovalGate(
      graph,
      guardedEdge,
      approval,
      outcome,
    );
    const compiled = compileWorkflowAuthoringGraph(gatedGraph);

    expect(compiled.topology.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "approval",
          next: ["approval_outcome"],
        }),
        expect.objectContaining({
          key: "approval_outcome",
          cases: [
            expect.objectContaining({
              when: { operator: "equals", value: true },
              next: ["expensive"],
            }),
          ],
          defaultNext: [],
        }),
      ]),
    );
    expect(
      preferredAuthoringInsertionEdge(gatedGraph, approval.id),
    ).toMatchObject({
      source: outcome.id,
      sourcePort: "case:approved",
      target: "expensive",
    });
    expect(
      preferredAuthoringInsertionEdge(gatedGraph, outcome.id),
    ).toMatchObject({
      source: outcome.id,
      sourcePort: "case:approved",
      target: "expensive",
    });

    const labels: Readonly<Record<string, string>> = {
      "workflows.editor.approvalOutcome": "Localized outcome",
      "workflows.editor.approvalAcceptedBranch": "Localized approved",
      "workflows.editor.approvalRejectedBranch": "Localized rejected",
    };
    const localized = localizeApprovalOutcomeGraph(
      gatedGraph,
      ((key: string) => labels[key] ?? key) as never,
    );
    expect(
      localized.nodes.find((node) => node.id === outcome.id),
    ).toMatchObject({
      displayName: "Localized outcome",
      cases: [{ label: "Localized approved" }],
      defaultLabel: "Localized rejected",
    });

    const misleadingGraph = {
      ...gatedGraph,
      edges: gatedGraph.edges.map((edge) =>
        edge.source === outcome.id && edge.sourcePort === "default"
          ? { ...edge, target: "expensive" }
          : edge,
      ),
    };
    expect(
      localizeApprovalOutcomeGraph(
        misleadingGraph,
        ((key: string) => labels[key] ?? key) as never,
      ).nodes.find((node) => node.id === outcome.id),
    ).toMatchObject({
      displayName: "Approval outcome",
      cases: [{ label: "Approved" }],
      defaultLabel: "Not approved",
    });
  });
});
