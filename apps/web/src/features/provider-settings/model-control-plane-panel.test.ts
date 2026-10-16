import type { CanonicalModelSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { editorFrom, modelOperations } from "./model-control-plane-panel.js";

function model(
  providerReportedPricingAvailable: boolean,
  supportedOperations: CanonicalModelSummary["providers"][number]["supportedOperations"] = [
    "image.generate",
  ],
): CanonicalModelSummary {
  return {
    id: "01K00000000000000000000001",
    slug: "tokenhub-model",
    lifecycle: "draft",
    sourceKind: "provider",
    sourceReference: "tokenhub-model",
    version: 1,
    providers: [
      {
        id: "01K00000000000000000000002",
        providerSettingId: "01K00000000000000000000003",
        providerName: "TokenHub",
        providerPreset: "tokenhub",
        upstreamModelId: "tokenhub-model",
        lifecycle: "mapped",
        supportedAgentTextTransports: [
          {
            apiSurface: "chat.completions.v1",
            protocolKind: "openai_chat",
          },
        ],
        supportedOperations,
        operations: {
          "image.generate": {
            parameters: [
              {
                key: "quality",
                label: "Quality",
                required: false,
                valueType: "enum",
                values: ["auto", "high"],
              },
            ],
          },
        },
        providerReportedPricingAvailable,
        version: 2,
      },
    ],
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

describe("model control plane editor", () => {
  it("keeps unknown token limits empty instead of inventing model capabilities", () => {
    expect(editorFrom(model(false, ["text.generate"]))).toMatchObject({
      contextWindow: "",
      maximumOutputTokens: "",
    });
  });
  it("prefills image modalities from the selected operation for unpublished models", () => {
    expect(editorFrom(model(true, ["image.generate"]))).toMatchObject({
      inputModalities: ["text"],
      outputModalities: ["image"],
    });
    expect(editorFrom(model(true, ["image.edit"]))).toMatchObject({
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
    });
  });
  it("uses the Provider catalog pricing capability instead of guessing from an absent profile", () => {
    expect(editorFrom(model(false)).pricingMode).toBe("metered");
    expect(editorFrom(model(true)).pricingMode).toBe("provider_reported");
  });

  it("publishes only operations evidenced for the selected Provider model", () => {
    const value = model(true);
    const editor = {
      ...editorFrom(value),
      inputModalities: ["text", "image"] as const,
      outputModalities: ["text", "image"] as const,
    };

    expect(modelOperations(editor, value.providers[0]!)).toEqual({
      "image.generate": {
        parameters: [
          {
            key: "quality",
            label: "Quality",
            required: false,
            valueType: "enum",
            values: ["auto", "high"],
          },
        ],
      },
    });
  });

  it("publishes text.generate for an identity-only model on a text-capable Provider", () => {
    const value = model(false, []);
    const editor = {
      ...editorFrom(value),
      inputModalities: ["text"] as const,
      outputModalities: ["text"] as const,
    };

    expect(modelOperations(editor, value.providers[0]!)).toEqual({
      "text.generate": { parameters: [] },
    });
  });
});
