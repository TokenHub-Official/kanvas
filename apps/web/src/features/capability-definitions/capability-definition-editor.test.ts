import { describe, expect, it } from "vitest";

import {
  capabilityFieldDefaults,
  capabilityDefinitionBody,
  capabilityDefinitionBodyFromAdapter,
  capabilityDefinitionAdapterDefaults,
  capabilityDefinitionDraftError,
  capabilityEditorLocale,
  capabilityEditorText,
  emptyCapabilityDefinitionDraft,
  emptyCapabilityField,
  updateCapabilityEditorText,
  visibleCapabilityOutputs,
} from "./capability-definition-editor.js";

describe("capability definition editor", () => {
  it("edits the active locale without requiring duplicate input", () => {
    expect(capabilityEditorLocale("zh-CN")).toBe("zh-CN");
    expect(capabilityEditorLocale("en-US")).toBe("en-US");
    expect(capabilityEditorText("zh-CN", "名称", "Name")).toBe("名称");
    expect(updateCapabilityEditorText("zh-CN", "", "", "名称")).toEqual({
      zh: "名称",
      en: "名称",
    });
    expect(
      updateCapabilityEditorText("en-US", "保留已有翻译", "Name", "New name"),
    ).toEqual({
      zh: "保留已有翻译",
      en: "New name",
    });
  });

  it("creates internal identifiers and safe examples without user input", () => {
    const draft = emptyCapabilityDefinitionDraft();
    const field = emptyCapabilityField();

    expect(draft.key).toMatch(/^capability\.custom\.[a-f0-9]{32}$/u);
    expect(draft.surfaces).toEqual(["workflow", "agent", "canvas"]);
    expect(field.key).toMatch(/^field_[a-f0-9]{32}$/u);
    expect(field.example).toBe("sample");
    expect(capabilityFieldDefaults("string", "artifact.image")).toEqual({
      type: "string",
      semanticType: "artifact.image",
      example: "01K00000000000000000000001",
    });
    expect(capabilityFieldDefaults("array", "artifact.image_list")).toEqual({
      type: "array",
      semanticType: "artifact.image_list",
      example: '["01K00000000000000000000001"]',
    });
  });

  it("creates one public contract shared by Workflow, Agent, and Canvas", () => {
    const input = {
      ...emptyCapabilityField(),
      key: "image",
      labelZh: "图片",
      labelEn: "Image",
      semanticType: "artifact.image",
      example: "01K00000000000000000000001",
    };
    const output = {
      ...emptyCapabilityField(),
      key: "result",
      labelZh: "结果",
      labelEn: "Result",
      semanticType: "artifact.image",
      example: "01K00000000000000000000002",
      primary: true,
    };
    const draft = {
      ...emptyCapabilityDefinitionDraft(),
      key: "image.example.process",
      titleZh: "示例处理",
      titleEn: "Example processing",
      categoryZh: "图片处理",
      categoryEn: "Image processing",
      surfaces: ["workflow", "agent", "canvas"] as const,
      inputs: [input],
      outputs: [output],
    };
    expect(capabilityDefinitionDraftError(draft)).toBeUndefined();
    expect(capabilityDefinitionBody(draft)).toMatchObject({
      sourceKind: "custom",
      surfaces: ["workflow", "agent", "canvas"],
      supportedInvokers: ["user", "workflow", "agent"],
      inputSchema: {
        required: ["image"],
        properties: {
          image: {
            type: "string",
            examples: ["01K00000000000000000000001"],
            "x-kanvas-semantic-type": "artifact.image",
          },
        },
      },
      outputs: [{ key: "result", primary: true }],
    });
  });

  it("publishes numeric ranges and defaults as contract constraints", () => {
    const input = {
      ...emptyCapabilityField(),
      key: "strength",
      labelZh: "强度",
      labelEn: "Strength",
      type: "number" as const,
      semanticType: "number.scalar",
      example: "0.7",
      defaultValue: "0.5",
      minimum: "0",
      maximum: "1",
    };
    const output = {
      ...emptyCapabilityField(),
      key: "result",
      labelZh: "结果",
      labelEn: "Result",
      semanticType: "text.plain",
      example: "ready",
      primary: true,
    };
    const draft = {
      ...emptyCapabilityDefinitionDraft(),
      key: "example.adjust.strength",
      titleZh: "强度调整",
      titleEn: "Strength adjustment",
      categoryZh: "示例",
      categoryEn: "Example",
      inputs: [input],
      outputs: [output],
    };

    expect(capabilityDefinitionBody(draft)).toMatchObject({
      inputSchema: {
        properties: {
          strength: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.5,
          },
        },
      },
      parameters: [{ key: "strength", defaultValue: 0.5 }],
    });
  });

  it("exposes only the selected text-to-image model inputs, not the adapter superset", () => {
    const draft = {
      ...emptyCapabilityDefinitionDraft(),
      titleZh: "文生图",
      titleEn: "Text to image",
      categoryZh: "图像生成",
      categoryEn: "Image generation",
      sourceKind: "model_service" as const,
      sourceId: "01K00000000000000000000001",
      runtimeAdapterRevisionId: "01K00000000000000000000002",
    };
    const body = capabilityDefinitionBodyFromAdapter(
      draft,
      {
        id: draft.runtimeAdapterRevisionId,
        invocationInputSchema: {
          type: "object",
          required: ["prompt"],
          "x-kanvas-provider-parameter-keys": ["quality", "resolution"],
          properties: {
            prompt: { type: "string" },
            referenceArtifactIds: { type: "array", items: { type: "string" } },
            quality: { type: "string", enum: ["low", "high"] },
            resolution: { type: "string" },
          },
        },
        invocationOutputSchema: {
          type: "object",
          properties: { image: { type: "string" } },
        },
      } as never,
      {
        modelInputModalities: ["text"],
        providerParameterDefinitions: [
          { key: "quality", valueType: "enum", values: ["high"] },
        ],
      } as never,
    );
    expect(body.parameters.map((field) => field.key)).toEqual([
      "prompt",
      "quality",
    ]);
    expect(body.inputSchema).toMatchObject({
      properties: { quality: { enum: ["high"] } },
    });
  });

  it("derives a business contract from a selected model invocation interface", () => {
    const draft = {
      ...emptyCapabilityDefinitionDraft(),
      titleZh: "背景移除",
      titleEn: "Background removal",
      categoryZh: "图像处理",
      categoryEn: "Image processing",
      sourceKind: "model_resource" as const,
      sourceId: "01K00000000000000000000001",
      runtimeAdapterRevisionId: "01K00000000000000000000002",
    };
    const body = capabilityDefinitionBodyFromAdapter(draft, {
      id: draft.runtimeAdapterRevisionId,
      invocationInputSchema: {
        $id: "adapter.input",
        type: "object",
        additionalProperties: false,
        required: ["sourceArtifactId"],
        properties: {
          sourceArtifactId: {
            type: "string",
            description:
              "Primary image Artifact ID; filenames are not image inputs.",
            examples: ["01K00000000000000000000001"],
            "x-kanvas-semantic-type": "artifact.image",
          },
        },
      },
      invocationOutputSchema: {
        $id: "adapter.output",
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "foregroundArtifactId"],
        properties: {
          schemaVersion: { const: "kanvas.example-result/v1" },
          foregroundArtifactId: {
            type: "object",
            "x-kanvas-semantic-type": "artifact.foreground",
            "x-kanvas-attempt-output-artifact": true,
          },
        },
      },
    } as never);

    expect(body.inputSchema).not.toHaveProperty("$id");
    expect(body.inputSchema).toMatchObject({
      required: ["sourceArtifactId"],
      properties: {
        sourceArtifactId: {
          type: "string",
          description:
            "Primary image Artifact ID; filenames are not image inputs.",
          examples: ["01K00000000000000000000001"],
          "x-kanvas-semantic-type": "artifact.image",
        },
      },
    });
    expect(body.outputSchema).toMatchObject({
      required: ["foregroundArtifactId"],
      properties: {
        foregroundArtifactId: {
          type: "string",
          pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
          "x-kanvas-semantic-type": "artifact.foreground",
        },
      },
    });
    expect(body.outputSchema).not.toHaveProperty("properties.schemaVersion");
    expect(body.parameters).toMatchObject([
      { key: "sourceArtifactId", label: { "zh-CN": "原图" } },
    ]);
    expect(body.outputs).toMatchObject([
      {
        key: "foregroundArtifactId",
        label: { "zh-CN": "主体图片" },
        primary: true,
      },
    ]);
  });

  it("keeps technical Adapter copy out of a new Capability description", () => {
    const draft = emptyCapabilityDefinitionDraft();
    const defaults = capabilityDefinitionAdapterDefaults(draft, {
      id: "01K00000000000000000000002",
      displayName: {
        defaultLocale: "zh-CN",
        values: {
          "zh-CN": "图片生成",
          "en-US": "Image generation",
        },
      },
      description: {
        defaultLocale: "zh-CN",
        values: {
          "zh-CN": "将公开输入输出转换为模型服务运行协议。",
          "en-US": "Adapts the public contract to the model service protocol.",
        },
      },
    } as never);

    expect(defaults).toMatchObject({
      runtimeAdapterRevisionId: "01K00000000000000000000002",
      titleZh: "图片生成",
      titleEn: "Image generation",
      descriptionZh: "",
      descriptionEn: "",
    });
  });

  it("keeps internal result-version fields out of operator surfaces", () => {
    expect(
      visibleCapabilityOutputs([
        { key: "schemaVersion", label: "Result version" },
        { key: "imageArtifactId", label: "Image" },
      ]),
    ).toEqual([{ key: "imageArtifactId", label: "Image" }]);
  });
});
