import type { CapabilityDefinitionSummary } from "@kanvas/contracts/api";
import { describe, expect, it, vi } from "vitest";

import {
  capabilityMetadataBody,
  capabilityMetadataEditorError,
  capabilityMetadataEditorFrom,
} from "./capability-metadata-editor.js";

const definition = {
  id: "01K00000000000000000000001",
  key: "image.example.generate",
  status: "active",
  version: 2,
  contractRevisionId: "01K00000000000000000000002",
  contractRevision: 1,
  contractDigest: `sha256:${"a".repeat(64)}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { prompt: { type: "string" } },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { imageArtifactId: { type: "string" } },
  },
  idempotencyMode: "keyed",
  supportedInvokers: ["workflow", "agent"],
  declarationRevisionId: "01K00000000000000000000003",
  declarationRevision: 2,
  declarationDigest: `sha256:${"b".repeat(64)}`,
  declaration: {
    schemaVersion: "kanvas.capability-declaration/v1",
    origin: "declared",
    catalog: {
      title: { "zh-CN": "示例生成", "en-US": "Example generate" },
      description: { "zh-CN": "生成图片", "en-US": "Generate an image" },
      category: { "zh-CN": "图像", "en-US": "Image" },
      sourceKind: "plugin",
      tags: ["image"],
    },
    parameters: [
      {
        key: "prompt",
        label: { "zh-CN": "提示词", "en-US": "Prompt" },
        semanticType: "prompt.rich",
        required: true,
        exposurePolicy: {
          allowed: ["workflow_author"],
          default: "workflow_author",
        },
        sourcePolicy: { allowed: ["constant"], default: "constant" },
        editor: "text",
      },
    ],
    outputs: [
      {
        key: "imageArtifactId",
        label: { "zh-CN": "图片", "en-US": "Image" },
        semanticType: "artifact.image",
        primary: true,
        visibility: "author",
      },
    ],
  },
  bindingCount: 1,
  activeBindingCount: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
} satisfies CapabilityDefinitionSummary;

describe("capability metadata editor", () => {
  it("changes discovery metadata without rewriting the contract", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "request-key" });
    const editor = capabilityMetadataEditorFrom(definition);
    const body = capabilityMetadataBody({
      ...editor,
      titleZh: "新版名称",
      tags: "image, generation",
    });

    expect(body).toMatchObject({
      title: { "zh-CN": "新版名称", "en-US": "Example generate" },
      tags: ["image", "generation"],
    });
    expect(body).not.toHaveProperty("key");
    expect(body).not.toHaveProperty("inputSchema");
    expect(body).not.toHaveProperty("outputSchema");
  });

  it("requires complete bilingual discovery metadata", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "request-key" });
    const editor = capabilityMetadataEditorFrom(definition);
    expect(
      capabilityMetadataEditorError({ ...editor, descriptionEn: "" }),
    ).toBe("description");
  });
});
