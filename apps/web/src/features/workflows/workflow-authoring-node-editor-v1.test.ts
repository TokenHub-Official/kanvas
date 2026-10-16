import type { WorkflowAuthoringCapability } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  capabilityIdentity,
  compatibleVariables,
  inputFieldsWithDerivations,
  workflowParameterSectionV1,
} from "./workflow-authoring-node-editor-v1.js";

function capability(revision: number): WorkflowAuthoringCapability {
  return {
    contractId: "image.suggest",
    contractKey: "image.suggest",
    revision,
    canonicalDigest: `sha256:${String(revision).repeat(64)}`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    authoring: {
      schemaVersion: "kanvas.capability-declaration/v1",
      origin: "declared",
      catalog: {
        title: { "zh-CN": "建议", "en-US": "Suggest" },
        category: { "zh-CN": "图像处理", "en-US": "Image processing" },
        sourceKind: "built_in",
        tags: ["suggest"],
      },
      parameters: [],
      outputs: [],
    },
  };
}

describe("workflow capability selector identity", () => {
  it("keeps revisions with the same contract id as distinct options", () => {
    expect(capabilityIdentity(capability(1))).not.toBe(
      capabilityIdentity(capability(2)),
    );
  });

  it("derives a mask only from the selected foreground bundle", () => {
    const base = capability(1);
    const compose: WorkflowAuthoringCapability = {
      ...base,
      authoring: {
        ...base.authoring,
        parameters: [
          {
            key: "foregroundArtifactId",
            label: { "zh-CN": "透明前景", "en-US": "Foreground" },
            semanticType: "artifact.foreground",
            required: true,
            exposurePolicy: {
              allowed: ["workflow_author"],
              default: "workflow_author",
            },
            sourcePolicy: { allowed: ["upstream"], default: "upstream" },
            editor: "artifact_picker",
          },
          {
            key: "maskArtifactId",
            label: { "zh-CN": "蒙版", "en-US": "Mask" },
            semanticType: "artifact.mask",
            required: false,
            exposurePolicy: {
              allowed: ["hidden_derived"],
              default: "hidden_derived",
            },
            sourcePolicy: { allowed: ["derived"], default: "derived" },
            editor: "artifact_picker",
            derivation: {
              kind: "same_bundle_role",
              fromParameter: "foregroundArtifactId",
              role: "mask",
              optional: true,
            },
          },
        ],
      },
    };
    const foreground = {
      id: "remove-1:foreground",
      label: "Foreground",
      sourceLabel: "Remove",
      sourceNodeId: "remove-1",
      fieldKey: "foregroundArtifactId",
      semanticType: "artifact.foreground" as const,
      bundle: { key: "cutout_result", role: "foreground" },
      schema: { type: "string" },
      variable: {
        source: "node_output" as const,
        nodeKey: "remove_1",
        scope: "root" as const,
        path: ["foregroundArtifactId"],
      },
    };
    const mask = {
      ...foreground,
      id: "remove-1:mask",
      fieldKey: "maskArtifactId",
      semanticType: "artifact.mask" as const,
      bundle: { key: "cutout_result", role: "mask" },
      variable: {
        ...foreground.variable,
        path: ["maskArtifactId"],
      },
    };
    const fields = inputFieldsWithDerivations({
      capability: compose,
      fields: {},
      parameterKey: "foregroundArtifactId",
      value: { kind: "variable", variable: foreground.variable },
      variables: [foreground, mask],
    });
    expect(fields.maskArtifactId).toEqual({
      kind: "variable",
      variable: mask.variable,
    });
  });

  it("keeps image inputs available for a structured background source", () => {
    const background = {
      id: "workflow_input:backgroundArtifactId",
      label: "背景图",
      sourceLabel: "输入",
      sourceNodeId: "workflow_input",
      fieldKey: "backgroundArtifactId",
      semanticType: "artifact.image" as const,
      schema: {
        type: "string",
        "x-kanvas-file": { categories: ["image"], transfer: "both" },
      },
      variable: {
        source: "workflow_input" as const,
        path: ["backgroundArtifactId"],
      },
    };
    expect(
      compatibleVariables(
        { type: "object" },
        [background],
        "background.source",
      ),
    ).toEqual([background]);
  });

  it("accepts uploaded image lists for image-list capability inputs", () => {
    const references = {
      id: "workflow_input:references",
      label: "参考图片",
      sourceLabel: "工作流输入",
      sourceNodeId: "workflow_input",
      fieldKey: "references",
      semanticType: "artifact.image_list" as const,
      schema: {
        type: "array",
        items: { type: "string" },
        "x-kanvas-file": { categories: ["image"], transfer: "both" },
      },
      variable: {
        source: "workflow_input" as const,
        path: ["references"],
      },
    };
    expect(
      compatibleVariables(
        { type: "array", items: { type: "string" } },
        [references],
        "artifact.image_list",
      ),
    ).toEqual([references]);
  });

  it("groups parameters from semantic types instead of capability ids", () => {
    expect(workflowParameterSectionV1("artifact.foreground")).toBe("materials");
    expect(workflowParameterSectionV1("background.source")).toBe("materials");
    expect(workflowParameterSectionV1("prompt.rich")).toBe("content");
    expect(workflowParameterSectionV1("layout.placement")).toBe("layout");
    expect(workflowParameterSectionV1("number.scalar")).toBe("settings");
  });
});
