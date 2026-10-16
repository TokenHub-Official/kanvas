import { describe, expect, it } from "vitest";

import {
  isStandardWorkflowApprovalDecisionSchema,
  workflowApprovalDecisionFields,
  workflowOutputNodeId,
  updateWorkflowValueMapping,
  workflowObjectSchema,
  workflowSchemaFields,
  workflowValueMapping,
  workflowVariableOptions,
} from "./workflow-authoring-model.js";

describe("workflow authoring model", () => {
  it("projects and updates object schema fields", () => {
    const fields = workflowSchemaFields({
      type: "object",
      properties: {
        source: {
          type: "string",
          title: "Source image",
          "x-kanvas-ui": { placeholder: "Choose an image" },
        },
      },
      required: ["source"],
    });
    expect(fields).toEqual([
      {
        key: "source",
        title: "Source image",
        type: "string",
        required: true,
        placeholder: "Choose an image",
        schema: {
          type: "string",
          title: "Source image",
          "x-kanvas-ui": { placeholder: "Choose an image" },
        },
      },
    ]);
    expect(
      workflowObjectSchema({}, [
        ...fields,
        { key: "quality", title: "Quality", type: "integer", required: false },
      ]),
    ).toMatchObject({
      type: "object",
      required: ["source"],
      properties: {
        source: { type: "string", title: "Source image" },
        quality: { type: "integer", title: "Quality" },
      },
    });
  });

  it("reads approval decisions from object properties and localizes the standard field", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { approved: { type: "boolean" } },
      required: ["approved"],
    };

    expect(workflowApprovalDecisionFields(schema, "Whether approved")).toEqual([
      expect.objectContaining({
        key: "approved",
        title: "Whether approved",
        type: "boolean",
        required: true,
      }),
    ]);
    expect(
      workflowApprovalDecisionFields(
        {
          ...schema,
          properties: {
            approved: { type: "boolean", title: "Release approved" },
          },
        },
        "Whether approved",
      )[0]?.title,
    ).toBe("Release approved");
    expect(
      isStandardWorkflowApprovalDecisionSchema({
        ...schema,
        properties: { approved: { type: "boolean", const: false } },
      }),
    ).toBe(false);
  });

  it("moves whole-value references into explicit field mappings", () => {
    const next = updateWorkflowValueMapping(
      { $value: { source: "workflow_input", pointer: "" } },
      "source",
      { $value: { source: "workflow_input", pointer: "/source" } },
    );
    expect(workflowValueMapping(next)).toEqual({
      source: { $value: { source: "workflow_input", pointer: "/source" } },
    });
  });

  it("offers workflow inputs and upstream outputs without leaking downstream nodes", () => {
    const capability = {
      contractId: "capability-1",
      contractKey: "image.inspect",
      revision: 1,
      canonicalDigest: `sha256:${"a".repeat(64)}`,
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { score: { type: "number", title: "Score" } },
      },
      authoring: {
        schemaVersion: "kanvas.capability-declaration/v1" as const,
        origin: "declared" as const,
        catalog: {
          title: { "zh-CN": "图片检测", "en-US": "Image inspect" },
          category: { "zh-CN": "图像分析", "en-US": "Image analysis" },
          sourceKind: "built_in" as const,
          tags: ["inspect"],
        },
        parameters: [],
        outputs: [
          {
            key: "score",
            label: { "zh-CN": "评分", "en-US": "Score" },
            semanticType: "number.scalar" as const,
            primary: true,
            visibility: "author" as const,
          },
        ],
      },
    };
    const document = {
      schemaVersion: 1 as const,
      inputSchema: {
        type: "object",
        properties: { source: { type: "string", title: "Source" } },
      },
      outputSchema: { type: "object", properties: {} },
      topology: {
        schemaVersion: 1 as const,
        key: "quality_flow",
        entryNodeKey: "inspect",
        limits: { maxNodeRuns: 20, timeoutMs: 60_000 },
        outputs: {},
        nodes: [
          {
            key: "inspect",
            kind: "invoke" as const,
            capability: {
              contractId: capability.contractId,
              revision: 1,
              canonicalDigest: capability.canonicalDigest,
            },
            input: {},
            next: ["enhance"],
          },
          {
            key: "enhance",
            kind: "invoke" as const,
            capability: {
              contractId: capability.contractId,
              revision: 1,
              canonicalDigest: capability.canonicalDigest,
            },
            input: {},
            next: [],
          },
        ],
      },
    };
    expect(
      workflowVariableOptions({
        capabilities: [capability],
        document,
        selectedNodeKey: "enhance",
      }).map((item) => `${item.sourceLabel}:${item.label}`),
    ).toEqual(["workflow_input:Source", "inspect:Score"]);
    expect(
      workflowVariableOptions({
        capabilities: [capability],
        document,
        selectedNodeKey: workflowOutputNodeId,
      }).map((item) => item.sourceLabel),
    ).toEqual(["workflow_input", "inspect", "enhance"]);
  });

  it("offers approval properties as outputs without exposing the schema envelope", () => {
    const document = {
      schemaVersion: 1 as const,
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      topology: {
        schemaVersion: 1 as const,
        key: "approval_flow",
        entryNodeKey: "review",
        limits: { maxNodeRuns: 4, timeoutMs: 60_000 },
        outputs: {},
        nodes: [
          {
            key: "review",
            kind: "approval" as const,
            request: {},
            decisionSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                approved: { type: "boolean", title: "Approved" },
              },
              required: ["approved"],
            },
            next: [],
          },
        ],
      },
    };

    expect(
      workflowVariableOptions({
        capabilities: [],
        document,
        selectedNodeKey: workflowOutputNodeId,
      }).map((item) => `${item.sourceLabel}:${item.label}`),
    ).toEqual(["review:Approved"]);
  });
});
