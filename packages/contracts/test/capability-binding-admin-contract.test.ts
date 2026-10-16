import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  CapabilityBindingSummarySchema,
  moveCapabilityBindingRoute,
  ProviderExecutionRouteSummarySchema,
  routeRegistry,
  setCapabilityBindingStatusRoute,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Capability Binding administration contracts", () => {
  it("registers the bounded mutation surface", () => {
    expect(setCapabilityBindingStatusRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/capability-bindings/{capabilityBindingId}/status",
    });
    expect(moveCapabilityBindingRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/capability-bindings/{capabilityBindingId}/position",
    });
    for (const route of [
      setCapabilityBindingStatusRoute,
      moveCapabilityBindingRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }
  });

  it("projects business routes without raw policy or credential material", () => {
    const validateProviderRoute = createAjv().compile(
      ProviderExecutionRouteSummarySchema,
    );
    expect(
      validateProviderRoute({
        routePolicyRevisionId: "01K00000000000000000000009",
        providerName: "OpenAI",
        providerModelId: "gpt-image-2",
        providerPreset: "openai",
        apiSurface: "images.generations.v1",
        modelOperation: "image.generate",
        providerParameterDefinitions: [
          {
            key: "quality",
            label: "Quality",
            required: false,
            valueType: "enum",
            values: ["standard", "high"],
            evidence: [
              {
                kind: "adapter_manifest",
                reference: "openai.images.v1",
                observedAt: "2026-08-06T00:00:00.000Z",
                sourceDigest: `sha256:${"a".repeat(64)}`,
                confidence: "high",
                claim: "supported",
              },
            ],
          },
        ],
        providerParameterPolicies: {
          quality: {
            callerPolicy: "optional",
            defaultValue: "standard",
            allowedValues: ["standard", "high"],
          },
        },
        availabilityReason: "ready",
        availableBudgetAmount: "100.00",
      }),
    ).toBe(true);

    const validateBinding = createAjv().compile(CapabilityBindingSummarySchema);
    const binding = {
      id: "01K00000000000000000000001",
      status: "enabled",
      order: 1,
      version: 2,
      executionTarget: "browser",
      displayName: {
        defaultLocale: "zh-CN",
        values: { "zh-CN": "浏览器本地处理", "en-US": "Local browser" },
      },
      sourceKind: "model_resource",
      availabilityReason: "ready",
      implementationKey: "first-party.image.background-remove.browser",
      implementationRevision: 1,
      adapterKey: "first-party.image.background-remove.browser.v1",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    expect(validateBinding(binding)).toBe(true);
    expect(
      validateBinding({
        ...binding,
        credentialSecret: "should-never-appear",
        routePolicy: { allow: "*" },
      }),
    ).toBe(false);
  });

  it("accepts the full uint32 seed domain in model facts and route policy", () => {
    const validate = createAjv().compile(ProviderExecutionRouteSummarySchema);
    expect(
      validate({
        routePolicyRevisionId: "01K00000000000000000000009",
        providerName: "OpenRouter",
        providerModelId: "vendor/image-model",
        providerPreset: "openrouter",
        apiSurface: "images.generations.v1",
        modelOperation: "image.generate",
        providerParameterDefinitions: [
          {
            key: "seed",
            label: "Seed",
            required: false,
            valueType: "integer",
            minimum: 0,
            maximum: 4_294_967_295,
            step: 1,
            evidence: [
              {
                kind: "adapter_manifest",
                reference: "openrouter.images.v1",
                observedAt: "2026-08-06T00:00:00.000Z",
                sourceDigest: `sha256:${"a".repeat(64)}`,
                confidence: "high",
                claim: "supported",
              },
            ],
          },
        ],
        providerParameterPolicies: {
          seed: {
            callerPolicy: "optional",
            defaultValue: 4_294_967_295,
            minimum: 0,
            maximum: 4_294_967_295,
          },
        },
        availabilityReason: "ready",
        availableBudgetAmount: "100.00",
      }),
    ).toBe(true);
  });
});
