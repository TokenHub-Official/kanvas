import { describe, expect, it } from "vitest";

import { validateCapabilityDefinitionPublication } from "../src/http/capability-definition-validation.js";

const body = {
  key: "image.example.process",
  title: { "zh-CN": "示例处理", "en-US": "Example process" },
  description: { "zh-CN": "处理一张图片。", "en-US": "Process one image." },
  category: { "zh-CN": "图像处理", "en-US": "Image processing" },
  tags: ["image"],
  sourceKind: "plugin" as const,
  surfaces: ["workflow" as const, "agent" as const],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["sourceArtifactId"],
    properties: {
      sourceArtifactId: { type: "string", minLength: 26, maxLength: 26 },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["imageArtifactId"],
    properties: {
      imageArtifactId: { type: "string", minLength: 26, maxLength: 26 },
    },
  },
  parameters: [
    {
      key: "sourceArtifactId",
      label: { "zh-CN": "源图片", "en-US": "Source image" },
      semanticType: "artifact.image" as const,
      required: true,
      exposurePolicy: {
        allowed: ["template_input" as const],
        default: "template_input" as const,
      },
      sourcePolicy: {
        allowed: ["workflow_input" as const, "upstream" as const],
        default: "workflow_input" as const,
      },
      editor: "artifact_picker" as const,
    },
  ],
  outputs: [
    {
      key: "imageArtifactId",
      label: { "zh-CN": "结果图", "en-US": "Result image" },
      semanticType: "artifact.image" as const,
      primary: true,
      visibility: "author" as const,
    },
  ],
  idempotencyMode: "keyed" as const,
  supportedInvokers: ["workflow" as const, "agent" as const],
};

describe("validateCapabilityDefinitionPublication", () => {
  it("builds stable Contract and Declaration publication material", () => {
    const result = validateCapabilityDefinitionPublication(body);
    expect(result.contractDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.declarationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.declaration.catalog.title["zh-CN"]).toBe("示例处理");
    expect(result.supportedInvokers).toEqual(["workflow", "agent"]);
  });

  it("rejects open root objects", () => {
    expect(() =>
      validateCapabilityDefinitionPublication({
        ...body,
        inputSchema: { ...body.inputSchema, additionalProperties: true },
      }),
    ).toThrow("closed object");
  });

  it("rejects declaration and Schema drift", () => {
    expect(() =>
      validateCapabilityDefinitionPublication({
        ...body,
        parameters: [],
      }),
    ).toThrow("cover every input Schema property");
    expect(() =>
      validateCapabilityDefinitionPublication({
        ...body,
        parameters: [
          {
            ...body.parameters[0]!,
            semanticType: "number.scalar",
          },
        ],
      }),
    ).toThrow("business semantic");
  });

  it("rejects references and conflicting primary outputs", () => {
    expect(() =>
      validateCapabilityDefinitionPublication({
        ...body,
        inputSchema: {
          ...body.inputSchema,
          properties: { sourceArtifactId: { $ref: "https://example.invalid" } },
        },
      }),
    ).toThrow("references");
    expect(() =>
      validateCapabilityDefinitionPublication({
        ...body,
        outputSchema: {
          ...body.outputSchema,
          required: ["imageArtifactId", "maskArtifactId"],
          properties: {
            ...body.outputSchema.properties,
            maskArtifactId: { type: "string" },
          },
        },
        outputs: [
          ...body.outputs,
          {
            key: "maskArtifactId",
            label: { "zh-CN": "蒙版", "en-US": "Mask" },
            semanticType: "artifact.mask" as const,
            primary: true,
            visibility: "author" as const,
          },
        ],
      }),
    ).toThrow("at most one primary output");
  });
});
