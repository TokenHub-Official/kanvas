import { describe, expect, it } from "vitest";
import { modelReferenceFeedback } from "./model-reference-feedback.js";

describe("model reference feedback", () => {
  it("does not present empty metadata with pricing conflicts as successful parameter sync", () => {
    expect(
      modelReferenceFeedback(
        {
          status: "partial",
          stale: false,
          warnings: ["pricing_conflict", "metadata_conflict"],
          defaults: {},
        },
        0,
        true,
      ),
    ).toEqual({
      title: "noChanges",
      incomplete: true,
      missing: ["contextWindow", "maximumOutputTokens", "toolCall"],
    });
  });
  it("does not treat explicit unsupported tool calling as a missing field", () => {
    expect(
      modelReferenceFeedback(
        {
          status: "resolved",
          stale: false,
          warnings: [],
          defaults: {
            contextWindow: 1000000,
            maximumOutputTokens: 65536,
            toolCall: false,
          },
        },
        3,
        true,
      ),
    ).toEqual({
      title: "updatedDraft",
      incomplete: false,
      missing: [],
    });
  });
});
