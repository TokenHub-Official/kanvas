import { describe, expect, it } from "vitest";

import {
  compileWorkflowAuthoringGraph,
  workflowAuthoringInputNodeId,
  workflowAuthoringOutputNodeId,
  type WorkflowAuthoringBindingV1,
  type WorkflowAuthoringGraphV1,
  type WorkflowAuthoringVariableV1,
} from "../src/workflow-authoring/index.js";

const digest = `sha256:${"b".repeat(64)}`;
const capability = (contractId: string, revision = 1) => ({
  contractId,
  revision,
  canonicalDigest: digest,
});
const workflowInput = (key: string): WorkflowAuthoringVariableV1 => ({
  source: "workflow_input",
  path: [key],
});
const nodeOutput = (
  nodeKey: string,
  key: string,
): WorkflowAuthoringVariableV1 => ({
  source: "node_output",
  nodeKey,
  scope: "root",
  path: [key],
});
const variable = (
  value: WorkflowAuthoringVariableV1,
): WorkflowAuthoringBindingV1 => ({ kind: "variable", variable: value });
const literal = (value: string | number | boolean | null) => ({
  kind: "literal" as const,
  value,
});
const prompt = (
  prefix: string,
  inputKey: string,
): WorkflowAuthoringBindingV1 => ({
  kind: "text",
  segments: [
    { kind: "literal", text: prefix },
    { kind: "variable", variable: workflowInput(inputKey) },
  ],
});
const edge = (
  id: string,
  source: string,
  target: string,
  sourcePort: "start" | "out" | `case:${string}` | "default" = "out",
) => ({ id, source, sourcePort, target });

function boundary(
  fields: readonly {
    key: string;
    label: string;
    schema: Readonly<Record<string, unknown>>;
  }[],
) {
  return {
    id: workflowAuthoringInputNodeId,
    type: "input" as const,
    displayName: "输入",
    schemaMetadata: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
    },
    fields: fields.map((field) => ({ ...field, required: true })),
  };
}

describe("poster Workflow authoring scenarios", () => {
  it("compiles the simple poster prompt into a bounded string template", () => {
    const graph: WorkflowAuthoringGraphV1 = {
      schemaVersion: 1,
      workflowKey: "poster_simple",
      limits: { maxNodeRuns: 4, timeoutMs: 300_000 },
      nodes: [
        boundary([
          {
            key: "userPrompt",
            label: "海报需求",
            schema: { type: "string", minLength: 1, maxLength: 2000 },
          },
        ]),
        {
          id: "generate_poster",
          nodeKey: "generate_poster",
          type: "capability",
          displayName: "生成海报",
          capability: capability("image.generate", 2),
          input: {
            kind: "object",
            fields: {
              prompt: prompt(
                "生成构图完整并保留文字空间的商业海报。额外需求：",
                "userPrompt",
              ),
              numberOfImages: literal(1),
            },
          },
        },
        {
          id: workflowAuthoringOutputNodeId,
          type: "output",
          displayName: "输出",
          schemaMetadata: {},
          fields: [
            {
              key: "resultImage",
              label: "结果图",
              required: true,
              schema: { type: "string" },
              binding: variable(
                nodeOutput("generate_poster", "imageArtifactId"),
              ),
            },
          ],
        },
      ],
      edges: [
        edge("start", workflowAuthoringInputNodeId, "generate_poster", "start"),
        edge("finish", "generate_poster", workflowAuthoringOutputNodeId),
      ],
    };

    const compiled = compileWorkflowAuthoringGraph(graph);
    const generate = compiled.topology.nodes.find(
      (node) => node.key === "generate_poster",
    );
    expect(generate).toMatchObject({
      kind: "invoke",
      input: {
        prompt: {
          $string: [
            "生成构图完整并保留文字空间的商业海报。额外需求：",
            {
              $value: { source: "workflow_input", pointer: "/userPrompt" },
            },
          ],
        },
      },
    });
  });

  it("compiles the complete poster branches into one coalesced result", () => {
    const graph: WorkflowAuthoringGraphV1 = {
      schemaVersion: 1,
      workflowKey: "poster_complete",
      limits: { maxNodeRuns: 8, timeoutMs: 600_000 },
      nodes: [
        boundary([
          {
            key: "requirements",
            label: "额外需求",
            schema: { type: "string" },
          },
          {
            key: "referenceImages",
            label: "参考图片",
            schema: { type: "array", items: { type: "string" } },
          },
        ]),
        {
          id: "has_reference",
          nodeKey: "has_reference",
          type: "condition",
          displayName: "是否有参考图",
          value: variable(workflowInput("referenceImages")),
          cases: [
            {
              id: "with_reference",
              label: "有参考图",
              operator: "exists",
            },
          ],
          defaultLabel: "无参考图",
        },
        {
          id: "generate_poster",
          nodeKey: "generate_poster",
          type: "capability",
          displayName: "直接生成",
          capability: capability("image.generate", 2),
          input: {
            kind: "object",
            fields: { prompt: prompt("生成完整商业海报：", "requirements") },
          },
        },
        {
          id: "edit_poster",
          nodeKey: "edit_poster",
          type: "capability",
          displayName: "参考图编辑",
          capability: capability("image.edit", 2),
          input: {
            kind: "object",
            fields: {
              prompt: prompt("基于参考图生成商业海报：", "requirements"),
            },
          },
        },
        {
          id: workflowAuthoringOutputNodeId,
          type: "output",
          displayName: "输出",
          schemaMetadata: {},
          fields: [
            {
              key: "resultImage",
              label: "生成结果",
              required: true,
              schema: { type: "string" },
              binding: {
                kind: "coalesce",
                variables: [
                  nodeOutput("generate_poster", "imageArtifactId"),
                  nodeOutput("edit_poster", "imageArtifactId"),
                ],
              },
            },
          ],
        },
      ],
      edges: [
        edge("start", workflowAuthoringInputNodeId, "has_reference", "start"),
        edge("with-ref", "has_reference", "edit_poster", "case:with_reference"),
        edge("without-ref", "has_reference", "generate_poster", "default"),
        edge("generated", "generate_poster", workflowAuthoringOutputNodeId),
        edge("edited", "edit_poster", workflowAuthoringOutputNodeId),
      ],
    };

    const compiled = compileWorkflowAuthoringGraph(graph);
    expect(compiled.topology.outputs.resultImage?.value).toEqual({
      $coalesce: [
        {
          $value: {
            source: "node_output",
            nodeKey: "generate_poster",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
        {
          $value: {
            source: "node_output",
            nodeKey: "edit_poster",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
      ],
    });
  });

  it("compiles the complex poster chain with explicit cutout pairing", () => {
    const graph: WorkflowAuthoringGraphV1 = {
      schemaVersion: 1,
      workflowKey: "poster_complex",
      limits: { maxNodeRuns: 8, timeoutMs: 600_000 },
      nodes: [
        boundary([
          {
            key: "backgroundImage",
            label: "背景图",
            schema: { type: "string" },
          },
          {
            key: "subjectPrompt",
            label: "主体描述",
            schema: { type: "string" },
          },
        ]),
        {
          id: "generate_subject",
          nodeKey: "generate_subject",
          type: "capability",
          displayName: "生成主体",
          capability: capability("image.generate", 2),
          input: {
            kind: "object",
            fields: { prompt: prompt("生成单一清晰主体：", "subjectPrompt") },
          },
        },
        {
          id: "remove_background",
          nodeKey: "remove_background",
          type: "capability",
          displayName: "提取主体",
          capability: capability("image.background.remove", 2),
          input: {
            kind: "object",
            fields: {
              sourceArtifactId: variable(
                nodeOutput("generate_subject", "imageArtifactId"),
              ),
              refinement: literal("fine"),
            },
          },
        },
        {
          id: "compose_poster",
          nodeKey: "compose_poster",
          type: "capability",
          displayName: "融入背景",
          capability: capability("image.background.compose"),
          input: {
            kind: "object",
            fields: {
              foregroundArtifactId: variable(
                nodeOutput("remove_background", "foregroundArtifactId"),
              ),
              maskArtifactId: variable(
                nodeOutput("remove_background", "maskArtifactId"),
              ),
              background: {
                kind: "object",
                fields: {
                  kind: literal("artifact"),
                  artifactId: variable(workflowInput("backgroundImage")),
                  fit: literal("cover"),
                },
              },
              canvas: {
                kind: "literal",
                value: { width: 1024, height: 1024 },
              },
              placement: {
                kind: "literal",
                value: {
                  x: 128,
                  y: 128,
                  width: 768,
                  height: 768,
                  fit: "contain",
                  opacity: 1,
                },
              },
            },
          },
        },
        {
          id: workflowAuthoringOutputNodeId,
          type: "output",
          displayName: "输出",
          schemaMetadata: {},
          fields: [
            {
              key: "resultImage",
              label: "最终海报",
              required: true,
              schema: { type: "string" },
              binding: variable(
                nodeOutput("compose_poster", "imageArtifactId"),
              ),
            },
          ],
        },
      ],
      edges: [
        edge(
          "start",
          workflowAuthoringInputNodeId,
          "generate_subject",
          "start",
        ),
        edge("cutout", "generate_subject", "remove_background"),
        edge("compose", "remove_background", "compose_poster"),
        edge("finish", "compose_poster", workflowAuthoringOutputNodeId),
      ],
    };

    const compiled = compileWorkflowAuthoringGraph(graph);
    const compose = compiled.topology.nodes.find(
      (node) => node.key === "compose_poster",
    );
    expect(compose).toMatchObject({
      kind: "invoke",
      input: {
        foregroundArtifactId: {
          $value: {
            source: "node_output",
            nodeKey: "remove_background",
            pointer: "/foregroundArtifactId",
          },
        },
        maskArtifactId: {
          $value: {
            source: "node_output",
            nodeKey: "remove_background",
            pointer: "/maskArtifactId",
          },
        },
        background: {
          kind: "artifact",
          artifactId: {
            $value: {
              source: "workflow_input",
              pointer: "/backgroundImage",
            },
          },
        },
      },
    });
  });
});
