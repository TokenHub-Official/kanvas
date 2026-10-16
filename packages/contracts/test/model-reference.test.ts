import { describe, expect, it } from "vitest";

import { buildModelsDevReferenceDocument } from "../src/model-reference/index.js";

const model = {
  name: "GPT Test",
  description: "Canonical test model",
  attachment: false,
  reasoning: true,
  tool_call: true,
  modalities: { input: ["text"], output: ["text"] },
  limit: { context: 1_000_000, output: 128_000 },
};

describe("models.dev reference projection", () => {
  it("links only exact canonical identities and preserves Provider prices", () => {
    const document = buildModelsDevReferenceDocument({
      modelCatalog: { "openai/gpt-test": { id: "openai/gpt-test", ...model } },
      providerCatalog: {
        openai: {
          id: "openai",
          name: "OpenAI",
          doc: "https://example.com/docs",
          models: {
            "gpt-test": {
              id: "gpt-test",
              ...model,
              cost: { input: 1.25, output: 10, cache_read: 0.125 },
            },
          },
        },
        gateway: {
          id: "gateway",
          name: "Gateway",
          doc: "https://gateway.example.com/docs",
          models: {
            alias: { id: "alias", ...model, cost: { input: 2, output: 12 } },
          },
        },
      },
      sourceRevision: "test-revision",
      observedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(document.providers[0]?.models[0]).toMatchObject({
      upstreamModelId: "gpt-test",
      canonicalModelKey: "openai/gpt-test",
      cost: { input: 1.25, output: 10, cacheRead: 0.125 },
    });
    expect(document.providers[1]?.models[0]?.canonicalModelKey).toBeUndefined();
  });
});
