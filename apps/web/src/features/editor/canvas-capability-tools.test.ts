import type { CanvasCapabilitySummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { parseCanvasImageCapabilityTool } from "./canvas-capability-tools.js";

function capability(
  sourceModes: CanvasCapabilitySummary["parameters"][number]["sourcePolicy"]["allowed"] = [
    "canvas_selection",
  ],
): CanvasCapabilitySummary {
  return {
    contractRevisionId: "01K00000000000000000000001",
    capabilityKey: "image.background.remove",
    displayName: "背景移除",
    description: "移除图片背景。",
    category: "图像处理",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sourceArtifactId", "refinement"],
      properties: {
        sourceArtifactId: { type: "string" },
        maskArtifactId: { type: "string" },
        refinement: { type: "string", enum: ["fast", "fine"] },
      },
    },
    parameters: [
      {
        key: "sourceArtifactId",
        label: { "zh-CN": "源图片", "en-US": "Source image" },
        semanticType: "artifact.image",
        required: true,
        exposurePolicy: {
          allowed: ["workflow_author"],
          default: "workflow_author",
        },
        sourcePolicy: {
          allowed: sourceModes,
          default: sourceModes[0] ?? "workflow_input",
        },
        editor: "artifact_picker",
      },
      {
        key: "maskArtifactId",
        label: { "zh-CN": "蒙版", "en-US": "Mask" },
        semanticType: "artifact.mask",
        required: false,
        exposurePolicy: {
          allowed: ["workflow_author"],
          default: "workflow_author",
        },
        sourcePolicy: {
          allowed: ["workflow_input"],
          default: "workflow_input",
        },
        editor: "artifact_picker",
      },
      {
        key: "refinement",
        label: { "zh-CN": "边缘精度", "en-US": "Refinement" },
        semanticType: "setting.refinement",
        required: true,
        exposurePolicy: {
          allowed: ["workflow_author"],
          default: "workflow_author",
        },
        sourcePolicy: {
          allowed: ["constant"],
          default: "constant",
        },
        editor: "enum",
        defaultValue: "fine",
      },
    ],
    outputs: [
      {
        key: "foregroundArtifactId",
        label: { "zh-CN": "主体", "en-US": "Foreground" },
        semanticType: "artifact.image",
        primary: true,
        visibility: "author",
      },
      {
        key: "maskArtifactId",
        label: { "zh-CN": "蒙版", "en-US": "Mask" },
        semanticType: "artifact.mask",
        primary: false,
        visibility: "advanced",
      },
    ],
    canvas: {
      actionGroup: "image.edit",
      interactionBehavior: "form",
      completionBehavior: "review_required",
      outputModes: ["add_node", "replace_content"],
      order: 20,
    },
  };
}

describe("Canvas Capability tools", () => {
  it("projects governed Canvas placement and semantic input without Workflow identity", () => {
    expect(parseCanvasImageCapabilityTool(capability(), "zh-CN")).toEqual(
      expect.objectContaining({
        id: "01K00000000000000000000001",
        contractRevisionId: "01K00000000000000000000001",
        capabilityKey: "image.background.remove",
        category: "图像处理",
        sourceParameterKey: "sourceArtifactId",
        outputArtifactPath: ["foregroundArtifactId"],
        maskArtifactPath: ["maskArtifactId"],
        parameterFields: [
          expect.objectContaining({
            key: "refinement",
            control: "select",
            defaultValue: "fine",
          }),
        ],
      }),
    );
  });

  it("rejects a Capability that does not accept the Canvas selection", () => {
    expect(
      parseCanvasImageCapabilityTool(capability(["workflow_input"]), "zh-CN"),
    ).toBeUndefined();
  });
});
