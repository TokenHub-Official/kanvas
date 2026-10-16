import { describe, expect, it } from "vitest";

import {
  modelResourcePublicationBody,
  modelResourcePublicationDraftError,
  modelResourcePublicationDraftFrom,
} from "./model-resource-import-editor.js";

const analysis = {
  id: "01K00000000000000000000021",
  status: "needs_input" as const,
  downloadedBytes: "100",
  version: 3,
  source: { kind: "upload" as const, fileName: "encoder.onnx" },
  suggestedKey: "model.encoder",
  suggestedDisplayName: "Encoder",
  format: "onnx" as const,
  files: [
    {
      path: "encoder.onnx",
      mediaType: "application/octet-stream",
      byteSize: "100",
      sha256: `sha256:${"a".repeat(64)}`,
    },
  ],
  license: { confidence: "unknown" as const },
  compatibleAdapters: [],
  requiredUserInputs: ["license" as const],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:01:00.000Z",
};

describe("model resource publication editor", () => {
  it("publishes analyzed bytes without asking users to invent a model interface", () => {
    const draft = {
      ...modelResourcePublicationDraftFrom(analysis, { kind: "new" as const }),
      licenseSpdxId: "Apache-2.0",
    };

    expect(modelResourcePublicationDraftError(draft)).toBeUndefined();
    expect(modelResourcePublicationBody(draft, analysis)).toEqual({
      expectedVersion: 3,
      target: { kind: "new", key: "model.encoder" },
      displayName: "Encoder",
      format: "onnx",
      license: { spdxId: "Apache-2.0" },
    });
  });

  it("keeps unknown licensing non-blocking without inventing a license", () => {
    const draft = modelResourcePublicationDraftFrom(analysis, {
      kind: "new",
    });
    expect(modelResourcePublicationDraftError(draft)).toBeUndefined();
    expect(draft.licenseSpdxId).toBe("NOASSERTION");
    expect(
      modelResourcePublicationDraftError({
        ...draft,
        licenseSpdxId: "MIT",
        licenseSourceUrl: "http://example.com/license",
      }),
    ).toBe("licenseUrl");
  });

  it("preserves an automatically verified Catalog interface", () => {
    const nativeInterface = {
      protocol: "tensor" as const,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["imageTensor"],
        properties: {
          imageTensor: {
            type: "array",
            items: { type: "number" },
            maxItems: 3_145_728,
            "x-kanvas-semantic-type": "tensor.image.rgb",
          },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["maskTensor"],
        properties: {
          maskTensor: {
            type: "array",
            items: { type: "number" },
            maxItems: 1_048_576,
            "x-kanvas-semantic-type": "tensor.mask.alpha",
          },
        },
      },
    };
    const catalogAnalysis = {
      ...analysis,
      catalogEntryId: "01K00000000000000000000022",
      nativeInterface,
      format: "onnx" as const,
      license: { spdxId: "MIT", confidence: "declared" as const },
      requiredUserInputs: [],
    };
    const draft = modelResourcePublicationDraftFrom(catalogAnalysis, {
      kind: "new",
    });

    expect(
      modelResourcePublicationBody(draft, catalogAnalysis).nativeInterface,
    ).toEqual(nativeInterface);
  });

  it("generates an internal key when analysis cannot suggest one", () => {
    const { suggestedKey, ...analysisWithoutSuggestedKey } = analysis;
    void suggestedKey;
    const draft = modelResourcePublicationDraftFrom(
      analysisWithoutSuggestedKey,
      { kind: "new" },
    );

    expect(draft.key).toBe("model.custom.01k00000000000000000000021");
  });
});
