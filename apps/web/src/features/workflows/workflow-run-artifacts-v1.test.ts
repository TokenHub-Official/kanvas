import { describe, expect, it } from "vitest";
import type { WorkflowAuthoringGraphV1 } from "@kanvas/contracts/workflow-authoring";

import {
  workflowRunAvailableArtifacts,
  workflowRunFinalArtifactsV1,
  workflowRunNodeArtifactsV1,
} from "./workflow-run-artifacts-v1.js";

const artifactId = "01M0CCNR0J26MC8HDHTYXP96PM";
const capability = {
  contractId: "image.background.compose",
  revision: 1,
  authoring: {
    outputs: [
      {
        key: "imageArtifactId",
        label: { "zh-CN": "合成图片", "en-US": "Composed image" },
        semanticType: "artifact.image",
        primary: true,
      },
    ],
  },
} as const;
const graph = {
  nodes: [
    {
      id: "compose_poster",
      nodeKey: "compose_poster",
      type: "capability",
      capability: { contractId: capability.contractId, revision: 1 },
    },
    {
      id: "workflow_output",
      type: "output",
      fields: [
        {
          key: "resultImageArtifactId",
          label: "最终海报",
          binding: {
            kind: "variable",
            variable: {
              source: "node_output",
              nodeKey: "compose_poster",
              scope: "root",
              path: ["imageArtifactId"],
            },
          },
        },
      ],
    },
  ],
} as unknown as WorkflowAuthoringGraphV1;

describe("Workflow Run Artifact projection", () => {
  it("projects declared image artifacts from the final Workflow output", () => {
    expect(
      workflowRunFinalArtifactsV1(
        { output: { resultImageArtifactId: artifactId } },
        graph,
        [capability] as never,
      ),
    ).toEqual([
      expect.objectContaining({
        artifactId,
        fieldKey: "resultImageArtifactId",
        primary: true,
        semanticType: "artifact.image",
      }),
    ]);
  });

  it("projects only semantically declared Artifact outputs for a node", () => {
    expect(
      workflowRunNodeArtifactsV1(
        "compose_poster",
        { imageArtifactId: artifactId, schemaVersion: "v1" },
        graph,
        [capability] as never,
      ),
    ).toEqual([
      expect.objectContaining({ artifactId, fieldKey: "imageArtifactId" }),
    ]);
  });

  it("recovers only output-bound node artifacts when the terminal output is missing", () => {
    const intermediateArtifactId = "01M0CCNR0J26MC8HDHTYXP96PN";
    const graphWithIntermediate = {
      ...graph,
      nodes: [
        ...graph.nodes.slice(0, 1),
        {
          id: "intermediate",
          nodeKey: "intermediate",
          type: "capability",
          capability: { contractId: capability.contractId, revision: 1 },
        },
        ...graph.nodes.slice(1),
      ],
    } as WorkflowAuthoringGraphV1;

    expect(
      workflowRunAvailableArtifacts(
        {
          output: null,
          nodes: [
            {
              nodeKey: "compose_poster",
              output: { imageArtifactId: artifactId },
            },
            {
              nodeKey: "intermediate",
              output: { imageArtifactId: intermediateArtifactId },
            },
          ],
        } as never,
        graphWithIntermediate,
        [capability] as never,
      ),
    ).toEqual([
      expect.objectContaining({
        artifactId,
        fieldKey: "resultImageArtifactId",
      }),
    ]);
  });
});
