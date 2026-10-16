import { describe, expect, it } from "vitest";

import { modelReferenceDefaults } from "./model-reference-defaults.js";

describe("modelReferenceDefaults", () => {
  it("reads provider-specific prices without guessing gateway markups", () => {
    const catalog = {
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.6-terra": {
            cost: { input: 0.4, output: 1.5, cache_read: 0.1 },
          },
        },
      },
    };
    expect(modelReferenceDefaults(catalog, "openai", "gpt-5.6-terra")).toEqual({
      providerName: "OpenAI",
      inputPerMillion: "0.4",
      outputPerMillion: "1.5",
      cacheReadPerMillion: "0.1",
    });
    expect(
      modelReferenceDefaults(catalog, "newapi", "gpt-5.6-terra"),
    ).toBeUndefined();
  });
});
