import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  ActivateProviderSettingBodySchema,
  CreateProviderSettingBodySchema,
  activateWorkspaceProviderSettingRoute,
} from "../src/api/index.js";

describe("Provider pricing activation contract", () => {
  it("requires an explicit Provider budget before saving", () => {
    const provider = {
      displayName: "TokenHub",
      preset: "tokenhub",
      baseUrl: "https://us-api.tokenhub.com",
      apiKey: "test-key",
    } as const;
    expect(
      Value.Check(CreateProviderSettingBodySchema, {
        ...provider,
        hardLimitAmount: "20.00",
      }),
    ).toBe(true);
    expect(Value.Check(CreateProviderSettingBodySchema, provider)).toBe(false);
  });

  it("accepts bounded per-model settlement configuration", () => {
    expect(
      Value.Check(ActivateProviderSettingBodySchema, {
        expectedVersion: 2,
        hardLimitAmount: "20.00",
        modelPricingConfigurations: [
          {
            providerModelId: "gpt-image-2",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
          {
            providerModelId: "gpt-image-2-edit",
            billingMode: "provider_reported",
            maximumChargeAmount: "1",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(ActivateProviderSettingBodySchema, {
        expectedVersion: 2,
        hardLimitAmount: "20.00",
        modelPricingConfigurations: [],
      }),
    ).toBe(false);
  });

  it("uses the pricing-aware body on the activation route", () => {
    expect(activateWorkspaceProviderSettingRoute.request.body).toBe(
      ActivateProviderSettingBodySchema,
    );
  });
});
