import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import {
  ConfigurationPolicyError,
  assertProviderRouteAllowed,
  parseProviderRoutePolicyDocument,
  resolveProviderConstraintIntersection,
} from "../src/runtime/configuration-policy.js";
import { createProviderRouteStore } from "../src/runtime/provider-route-store.js";
import {
  decimalToUnits,
  decimalUnitsToString,
  minimumDecimal,
  signedDecimalToUnits,
} from "../src/runtime/fixed-decimal.js";
import {
  createSecretVersionStore,
  secretAadDigestFor,
} from "../src/runtime/secret-version-store.js";

const endpointId = "01K00000000000000000000001";
const credentialId = "01K00000000000000000000002";
const modelDeploymentId = "01K00000000000000000000003";
const pricingRevisionId = "01K00000000000000000000004";
const budgetAccountId = "01K00000000000000000000005";

const routeDocument = {
  providerKey: "tokenhub",
  apiSurface: "responses",
  providerEndpointId: endpointId,
  credentialId,
  modelDeploymentId,
  pricingRevisionId,
  budgetAccountId,
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: {
    currencyCode: "USD",
    amount: "4.250000000000",
  },
  requestTimeoutSeconds: 45,
  queryMode: "provider_request_id",
  notFoundIsAuthoritative: true,
  constraints: {
    allowedAdapterKinds: ["openai_compatible"],
    allowedPresetKinds: ["tokenhub"],
    allowedRegionCodes: ["us-west", "us-east"],
    deniedRegionCodes: ["us-east"],
    allowedRoutingModes: ["kanvas_fixed"],
    allowedExecutionTransparencies: ["full"],
    maximumCharge: {
      currencyCode: "USD",
      amount: "6",
    },
    maxProviderRequestSeconds: 60,
  },
} as const;

describe("Provider control-plane invariants", () => {
  it.each([null, {}, { allowedRegionCodes: [] }])(
    "rejects malformed explicit deployment bounds: %j",
    (deploymentHardBounds) => {
      expect(() =>
        createProviderRouteStore({} as Pool, { deploymentHardBounds }),
      ).toThrow();
    },
  );

  it("uses exact signed and unsigned fixed-point arithmetic", () => {
    expect(decimalToUnits("1.000000000001")).toBe(1_000_000_000_001n);
    expect(signedDecimalToUnits("-0.000000000001")).toBe(-1n);
    expect(decimalUnitsToString(-1_250_000_000_000n)).toBe("-1.25");
    expect(minimumDecimal(["10", "2.500000000000", "2.499999999999"])).toBe(
      "2.499999999999",
    );
    expect(() => decimalToUnits("0.0000000000001")).toThrow();
    expect(() => decimalToUnits("01")).toThrow();
  });

  it("intersects allowlists, unions denies, and takes every numeric minimum", () => {
    const route = parseProviderRoutePolicyDocument(routeDocument);
    const constraints = resolveProviderConstraintIntersection(
      {
        allowedAdapterKinds: ["openai_native", "openai_compatible"],
        allowedPresetKinds: ["newapi", "tokenhub"],
        allowedRegionCodes: ["us-west", "us-east", "eu-west"],
        deniedRegionCodes: ["eu-west"],
        allowedProviderEndpointIds: [endpointId],
        allowedRoutingModes: ["kanvas_fixed", "gateway_managed"],
        allowedExecutionTransparencies: ["full", "partial", "opaque"],
        maximumCharge: {
          currencyCode: "USD",
          amount: "20",
        },
        maxProviderRequestSeconds: 120,
      },
      {
        allowedAdapterKinds: ["openai_compatible"],
        allowedRegionCodes: ["us-west", "us-east"],
        maximumCharge: {
          currencyCode: "USD",
          amount: "10",
        },
        maxProviderRequestSeconds: 90,
      },
      {
        allowedPresetKinds: ["tokenhub"],
        deniedRegionCodes: ["us-east"],
        maximumCharge: {
          currencyCode: "USD",
          amount: "5",
        },
      },
      route.constraints,
    );

    expect(constraints).toMatchObject({
      allowedAdapterKinds: ["openai_compatible"],
      allowedPresetKinds: ["tokenhub"],
      allowedRegionCodes: ["us-west"],
      deniedRegionCodes: ["eu-west", "us-east"],
      allowedRoutingModes: ["kanvas_fixed"],
      allowedExecutionTransparencies: ["full"],
      maximumCharge: {
        currencyCode: "USD",
        amount: "5",
      },
      maxProviderRequestSeconds: 60,
    });
    expect(() =>
      assertProviderRouteAllowed(
        route,
        {
          id: endpointId,
          adapterKind: "openai_compatible",
          presetKind: "tokenhub",
          regionCode: "us-west",
        },
        constraints,
      ),
    ).not.toThrow();
  });

  it("fails closed on unknown policy fields and impossible gateway transparency", () => {
    expect(() =>
      parseProviderRoutePolicyDocument({
        ...routeDocument,
        unexpected: true,
      }),
    ).toThrow(ConfigurationPolicyError);
    expect(() =>
      parseProviderRoutePolicyDocument({
        ...routeDocument,
        routingMode: "gateway_managed",
        executionTransparency: "full",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "configuration_policy.invalid",
      }),
    );
  });

  it("domain-separates Secret envelope AAD and leaves KEK rewrap unsupported", async () => {
    const common = {
      instanceId: "01K00000000000000000000010",
      workspaceId: "01K00000000000000000000011",
      credentialId,
      secretVersionId: "01K00000000000000000000012",
      providerKind: "tokenhub",
      formatVersion: 1,
    } as const;
    const first = secretAadDigestFor(common);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(secretAadDigestFor(common)).toBe(first);
    expect(
      secretAadDigestFor({
        ...common,
        secretVersionId: "01K00000000000000000000013",
      }),
    ).not.toBe(first);

    const store = createSecretVersionStore({} as unknown as Pool);
    await expect(store.rewrapEncryptedEnvelope()).rejects.toEqual(
      expect.objectContaining({
        code: "secret_version.rewrap_unsupported",
      }),
    );
  });
});
