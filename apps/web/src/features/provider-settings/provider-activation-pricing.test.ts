import { describe, expect, it } from "vitest";

import {
  compileProviderActivationPricing,
  createProviderActivationPricingEntries,
  validProviderPricingAmount,
} from "./provider-activation-pricing.js";

const provider = {
  id: "01K00000000000000000000001",
  displayName: "TokenHub",
  preset: "tokenhub" as const,
  baseUrl: "https://us-api.tokenhub.com",
  modelKeys: ["gpt-image-2"],
  lifecycle: "disabled" as const,
  validation: "passed" as const,
  secretConfigured: true,
  canRefreshModelCatalog: true,
  version: 2,
  createdAt: "2026-08-12T07:00:00.000Z",
  updatedAt: "2026-08-12T07:00:00.000Z",
};

describe("Provider activation pricing", () => {
  it("accepts normalized positive decimals and rejects zero", () => {
    expect(validProviderPricingAmount("1.000000000000")).toBe(true);
    expect(validProviderPricingAmount("0.4286")).toBe(true);
    expect(validProviderPricingAmount("0.000000000000")).toBe(false);
  });

  it("defaults TokenHub to fixed pricing until its charge contract is final", () => {
    expect(createProviderActivationPricingEntries(provider)).toEqual([
      {
        providerModelId: "gpt-image-2",
        mode: "fixed",
        amount: "",
      },
    ]);
  });

  it("compiles positive amounts without leaking UI state", () => {
    expect(
      compileProviderActivationPricing([
        {
          providerModelId: "gpt-image-2",
          mode: "provider_reported",
          amount: "1.25",
        },
      ]),
    ).toEqual({
      status: "ready",
      configurations: [
        {
          providerModelId: "gpt-image-2",
          billingMode: "provider_reported",
          maximumChargeAmount: "1.25",
        },
      ],
    });
    expect(
      compileProviderActivationPricing([
        { providerModelId: "gpt-image-2", mode: "fixed", amount: "0" },
      ]),
    ).toEqual({ status: "invalid", invalidModelIds: ["gpt-image-2"] });
  });
});
