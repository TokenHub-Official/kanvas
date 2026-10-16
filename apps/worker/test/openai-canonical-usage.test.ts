import { describe, expect, it } from "vitest";

import {
  canonicalOpenAiUsageMetrics,
  normalizeOpenAiUsage,
} from "../src/provider/openai-canonical-usage.js";

describe("OpenAI canonical usage", () => {
  it("normalizes chat aliases and nested cache/reasoning details", () => {
    const usage = normalizeOpenAiUsage(
      {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 8 },
      },
      { inputIsText: true, outputIsText: true },
    );

    expect(usage).toEqual({
      inputTokens: 120,
      inputTokensNoCache: 80,
      outputTokens: 30,
      totalTokens: 150,
      inputTextTokens: 120,
      outputTextTokens: 30,
      cacheReadTokens: 40,
      reasoningTokens: 8,
    });
    expect(canonicalOpenAiUsageMetrics(usage)).toEqual(
      expect.arrayContaining([
        {
          metricKey: "input_tokens_no_cache",
          numericValue: "80",
          unitCode: "token",
        },
        {
          metricKey: "input_text_tokens",
          numericValue: "120",
          unitCode: "token",
        },
        {
          metricKey: "cache_read_tokens",
          numericValue: "40",
          unitCode: "token",
        },
        {
          metricKey: "reasoning_tokens",
          numericValue: "8",
          unitCode: "token",
        },
      ]),
    );
  });

  it("keeps modality details separate from total input", () => {
    expect(
      normalizeOpenAiUsage({
        input_tokens: "20",
        output_tokens: 5,
        input_tokens_details: {
          text_tokens: 12,
          image_tokens: 8,
        },
      }),
    ).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      inputTextTokens: 12,
      inputImageTokens: 8,
    });
  });

  it("drops malformed or unsafe usage quantities", () => {
    expect(
      normalizeOpenAiUsage({
        input_tokens: -1,
        output_tokens: 9_007_199_254_740_992,
        total_tokens: "01",
      }),
    ).toEqual({});
  });
});
