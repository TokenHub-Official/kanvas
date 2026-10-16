import type { ResolvedAgentModelBinding } from "@kanvas/database/runtime";
import { describe, expect, it } from "vitest";

import {
  agentProviderReportedCharge,
  tokenHubAsyncTaskBilling,
} from "../src/provider/provider-reported-charge.js";

function route(presetKind: string): ResolvedAgentModelBinding {
  return {
    endpoint: { presetKind },
  } as ResolvedAgentModelBinding;
}

describe("Provider reported charge normalization", () => {
  it("normalizes exact xAI USD ticks without floating-point arithmetic", () => {
    expect(
      agentProviderReportedCharge(route("xai"), {
        cost_in_usd_ticks: 158_500,
      }),
    ).toEqual({ currencyCode: "USD", amount: "0.00001585" });
  });

  it("normalizes OpenRouter response cost", () => {
    expect(
      agentProviderReportedCharge(route("openrouter"), { cost: 0.0015 }),
    ).toEqual({ currencyCode: "USD", amount: "0.0015" });
  });

  it("fails closed for unsupported or unsettled Provider contracts", () => {
    expect(
      agentProviderReportedCharge(route("openai"), { cost: 1 }),
    ).toBeUndefined();
    expect(
      tokenHubAsyncTaskBilling({ amount: 7.2, currency: "CNY" }),
    ).toBeUndefined();
  });

  it("converts TokenHub quota to USD independently of display currency", () => {
    expect(
      tokenHubAsyncTaskBilling({
        quota: 500_000,
        amount: 7.2,
        currency: "CNY",
      }),
    ).toEqual({
      quota: "500000",
      reportedCharge: { currencyCode: "USD", amount: "1" },
    });
    expect(tokenHubAsyncTaskBilling({ quota: 3_600_000 })).toEqual({
      quota: "3600000",
      reportedCharge: { currencyCode: "USD", amount: "7.2" },
    });
    expect(() => tokenHubAsyncTaskBilling({ quota: 0.5 })).toThrow(
      /non-negative integer/u,
    );
  });
});
