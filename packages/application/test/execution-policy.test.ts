import { describe, expect, it } from "vitest";

import {
  compareUnsignedDecimal,
  evaluateProviderCandidatePolicy,
  intersectExecutionPolicies,
  parseExecutionPolicyDocument,
} from "../src/index.js";

function policy(
  overrides: {
    readonly provider?: Readonly<Record<string, unknown>>;
    readonly egress?: Readonly<Record<string, unknown>>;
    readonly resources?: Readonly<Record<string, unknown>>;
    readonly cost?: Readonly<Record<string, unknown>>;
  } = {},
) {
  return parseExecutionPolicyDocument({
    schemaVersion: 1,
    provider: overrides.provider ?? {},
    egress: overrides.egress ?? {},
    resources: overrides.resources ?? {},
    cost: overrides.cost ?? {},
  });
}

describe("fixed execution policy", () => {
  it("intersects allowlists, unions denials, chooses hard minima, and never widens booleans", () => {
    const effective = intersectExecutionPolicies([
      policy({
        provider: {
          allowedAdapterKinds: ["openai-native", "openrouter-native"],
          deniedEndpointIds: ["01K00000000000000000000001"],
          minimumExecutionTransparency: "partial",
        },
        egress: {
          allowedRegionCodes: ["us", "eu"],
          allowPrivateEndpoints: false,
        },
        resources: {
          maximumRequestDurationMs: 60_000,
          maximumInputBytes: 10_000,
        },
        cost: {
          allowedCurrencyCodes: ["USD", "CNY"],
          maximumCharges: [
            {
              currencyCode: "USD",
              amount: "5.00",
            },
          ],
          requireKnownPricing: true,
        },
      }),
      policy({
        provider: {
          allowedAdapterKinds: ["openrouter-native", "openai-compatible"],
          deniedEndpointIds: ["01K00000000000000000000002"],
          minimumExecutionTransparency: "full",
        },
        egress: {
          allowedRegionCodes: ["us"],
          allowPrivateEndpoints: true,
        },
        resources: {
          maximumRequestDurationMs: 30_000,
          maximumInputBytes: 20_000,
        },
        cost: {
          allowedCurrencyCodes: ["USD"],
          maximumCharges: [
            {
              currencyCode: "USD",
              amount: "3.5",
            },
          ],
          requireKnownMaximumCharge: true,
        },
      }),
    ]);

    expect(effective).toMatchObject({
      provider: {
        allowedAdapterKinds: ["openrouter-native"],
        deniedEndpointIds: [
          "01K00000000000000000000001",
          "01K00000000000000000000002",
        ],
        minimumExecutionTransparency: "full",
      },
      egress: {
        allowedRegionCodes: ["us"],
        allowPrivateEndpoints: false,
      },
      resources: {
        maximumRequestDurationMs: 30_000,
        maximumInputBytes: 10_000,
      },
      cost: {
        allowedCurrencyCodes: ["USD"],
        maximumCharges: [
          {
            currencyCode: "USD",
            amount: "3.5",
          },
        ],
        requireKnownPricing: true,
        requireKnownMaximumCharge: true,
      },
    });
  });

  it("treats an explicit empty allowlist as deny-all", () => {
    const effective = intersectExecutionPolicies([
      policy({
        provider: {
          allowedAdapterKinds: ["openai-native"],
        },
      }),
      policy({
        provider: {
          allowedAdapterKinds: [],
        },
      }),
    ]);

    expect(effective.provider.allowedAdapterKinds).toEqual([]);
    expect(
      evaluateProviderCandidatePolicy(effective, {
        adapterKind: "openai-native",
        providerKind: "openai",
        endpointId: "01K00000000000000000000001",
        modelDeploymentId: "01K00000000000000000000002",
        routingMode: "kanvas_fixed",
        executionTransparency: "full",
        regionCode: "us",
        dataClassification: "internal",
        privateEndpoint: false,
        providerRetention: false,
        requestDurationMs: 1,
        inputBytes: 1,
        outputBytes: 1,
        pricingKnown: true,
        maximumCharge: {
          currencyCode: "USD",
          amount: "0",
        },
      }),
    ).toMatchObject({
      effect: "deny",
      reasons: ["policy.adapter_not_allowed"],
    });
  });

  it("returns all policy denials without relying on floating point money", () => {
    const effective = intersectExecutionPolicies([
      policy({
        provider: {
          allowedRoutingModes: ["kanvas_fixed"],
          minimumExecutionTransparency: "full",
        },
        egress: {
          allowedRegionCodes: ["eu"],
          allowProviderRetention: false,
        },
        resources: {
          maximumRequestDurationMs: 100,
        },
        cost: {
          allowedCurrencyCodes: ["USD"],
          maximumCharges: [
            {
              currencyCode: "USD",
              amount: "9007199254740993.000000000001",
            },
          ],
          requireKnownPricing: true,
          requireKnownMaximumCharge: true,
        },
      }),
    ]);

    expect(
      evaluateProviderCandidatePolicy(effective, {
        adapterKind: "openrouter-native",
        providerKind: "openrouter",
        endpointId: "01K00000000000000000000001",
        modelDeploymentId: "01K00000000000000000000002",
        routingMode: "gateway_managed",
        executionTransparency: "opaque",
        regionCode: "us",
        dataClassification: "internal",
        privateEndpoint: false,
        providerRetention: true,
        requestDurationMs: 101,
        inputBytes: 1,
        outputBytes: 1,
        pricingKnown: false,
        maximumCharge: {
          currencyCode: "USD",
          amount: "9007199254740993.000000000002",
        },
      }).reasons,
    ).toEqual([
      "policy.routing_mode_not_allowed",
      "policy.transparency_insufficient",
      "policy.region_not_allowed",
      "policy.provider_retention_denied",
      "policy.request_duration_exceeded",
      "policy.pricing_unknown",
      "policy.maximum_charge_exceeded",
    ]);
    expect(
      compareUnsignedDecimal(
        "9007199254740993.000000000002",
        "9007199254740993.000000000001",
      ),
    ).toBe(1);
  });

  it.each([
    {
      ...policy(),
      unknown: true,
    },
    {
      schemaVersion: 1,
      provider: {
        allowedAdapterKinds: ["openai-native", "openai-native"],
      },
      egress: {},
      resources: {},
      cost: {},
    },
    {
      schemaVersion: 1,
      provider: {},
      egress: {},
      resources: {},
      cost: {
        allowedCurrencyCodes: ["USD"],
        maximumCharges: [
          {
            currencyCode: "CNY",
            amount: "1",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      provider: {},
      egress: {},
      resources: {
        maximumInputBytes: 1.5,
      },
      cost: {},
    },
  ])("rejects unknown, ambiguous, or non-canonical policy input", (value) => {
    expect(() => parseExecutionPolicyDocument(value)).toThrowError(
      expect.objectContaining({
        code: "execution_policy.invalid",
      }),
    );
  });
});
