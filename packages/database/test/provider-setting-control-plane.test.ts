import { describe, expect, it } from "vitest";

import {
  buildProviderAgentTextControlPlaneDefinition,
  buildProviderSettingControlPlaneDefinition,
  providerRuntimeAdaptersForRoute,
} from "../src/runtime/provider-setting-control-plane.js";

const ids = Object.freeze({
  endpointId: "01K00000000000000000000001",
  credentialId: "01K00000000000000000000002",
  modelProfileRevisionId: "01K00000000000000000000003",
  modelDeploymentId: "01K00000000000000000000004",
  pricingRevisionId: "01K00000000000000000000005",
  routePolicyRevisionIds: ["01K00000000000000000000006"],
  budgetAccountId: "01K00000000000000000000007",
});

function runtimeAdapter(options: {
  readonly operation: "image.generate" | "image.edit";
  readonly apiSurface: string;
  readonly usageMetrics?: readonly Readonly<{
    metricKey: string;
    unitCode: string;
  }>[];
}) {
  const adapterKey = `test.${options.operation}.${options.apiSurface}`;
  return Object.freeze({
    adapterKey,
    document: {
      schemaVersion: "kanvas.runtime-adapter-definition/v1" as const,
      adapterKey,
      revision: 1,
      displayName: {
        defaultLocale: "en-US",
        values: { "zh-CN": adapterKey, "en-US": adapterKey },
      },
      executionTarget: "provider" as const,
      sourceKinds: ["model_service" as const],
      supportedModelFormats: [],
      invocationInputSchema: {},
      invocationOutputSchema: {},
      configurationSchema: {},
      modelServiceSelector: {
        operation: options.operation,
        apiSurface: options.apiSurface,
      },
      usageMetrics: [...(options.usageMetrics ?? [])],
      artifactInputs: [],
      executable: {
        kind: "built_in" as const,
        packageKey: "test.provider-runtime",
        packageVersion: "1",
        entrypoint: adapterKey,
        releaseDigest: `sha256:${"c".repeat(64)}`,
      },
    },
  });
}

describe("Provider setting control-plane compiler", () => {
  it("compiles one governed Agent text model with cache-aware metered pricing", () => {
    const definition = buildProviderAgentTextControlPlaneDefinition({
      providerSettingId: "01K00000000000000000000008",
      providerEndpointId: ids.endpointId,
      credentialId: ids.credentialId,
      budgetAccountId: ids.budgetAccountId,
      bindingId: "01K00000000000000000000009",
      modelProfileRevisionId: ids.modelProfileRevisionId,
      modelDeploymentId: ids.modelDeploymentId,
      pricingRevisionId: ids.pricingRevisionId,
      preset: "tokenhub",
      providerModelId: "gpt-5.6-terra",
      displayName: "GPT-5.6 Terra",
      pricing: {
        inputPerMillion: "2",
        outputPerMillion: "12",
        cacheReadPerMillion: "0.2",
        maximumChargeAmount: "1",
      },
      observedAt: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(definition.bindingKey).toMatch(/^agent\.[0-9a-f]{32}$/u);
    expect(definition.modelProfileDocument).toMatchObject({
      schemaVersion: 1,
      model: {
        displayName: "GPT-5.6 Terra",
        family: "agent-text",
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCall: true,
      },
      operations: {
        "text.generate": { parameters: [] },
      },
    });
    expect(definition.modelProfileDocument.model).not.toHaveProperty(
      "providerPreset",
    );
    expect(definition.modelProfileDocument.model).not.toHaveProperty(
      "providerModelId",
    );
    expect(definition.pricingDocument).toMatchObject({
      billingMode: "metered",
      rates: [
        { metricKey: "input_tokens_no_cache", amount: "2" },
        { metricKey: "cache_read_tokens", amount: "0.2" },
        { metricKey: "output_tokens", amount: "12" },
      ],
    });
    expect(definition.routeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(definition).toMatchObject({
      apiSurface: "chat.completions.v1",
      protocolKind: "openai_chat",
    });
  });

  it("pins Anthropic Agent text models to the Messages protocol", () => {
    const definition = buildProviderAgentTextControlPlaneDefinition({
      providerSettingId: "01K00000000000000000000008",
      providerEndpointId: ids.endpointId,
      credentialId: ids.credentialId,
      budgetAccountId: ids.budgetAccountId,
      bindingId: "01K00000000000000000000009",
      modelProfileRevisionId: ids.modelProfileRevisionId,
      modelDeploymentId: ids.modelDeploymentId,
      pricingRevisionId: ids.pricingRevisionId,
      preset: "anthropic",
      providerModelId: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      pricing: {
        inputPerMillion: "3",
        outputPerMillion: "15",
        maximumChargeAmount: "1",
      },
      observedAt: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(definition).toMatchObject({
      apiSurface: "messages.v1",
      protocolKind: "anthropic_messages",
      modelProfileDocument: {
        schemaVersion: 1,
        model: { family: "agent-text", toolCall: true },
        operations: { "text.generate": { parameters: [] } },
      },
    });
  });

  it("matches model service routes from published Runtime Adapter metadata", () => {
    const adapter = runtimeAdapter({
      operation: "image.edit",
      apiSurface: "images.edits.v1",
    });
    expect(
      providerRuntimeAdaptersForRoute([adapter], {
        preset: "xai",
        capabilityKey: "image.edit",
        apiSurface: "images.edits.v1",
      }),
    ).toEqual([adapter]);
  });

  it.each([
    {
      preset: "openai" as const,
      model: "gpt-image-1.5",
      apiSurface: "images.edits.v1",
      adapter: "openai_native",
      routingMode: "kanvas_fixed",
      queryMode: "none",
    },
    {
      preset: "openrouter" as const,
      model: "openai/gpt-image-1",
      apiSurface: "images.generations.v1",
      adapter: "openrouter_native",
      routingMode: "gateway_managed",
      queryMode: "none",
    },
    {
      preset: "xai" as const,
      model: "grok-imagine-image",
      apiSurface: "images.generations.v1",
      adapter: "openai_compatible",
      routingMode: "kanvas_fixed",
      queryMode: "none",
    },
    {
      preset: "gemini" as const,
      model: "gemini-3.1-flash-image-preview",
      apiSurface: "generate-content.image.v1",
      adapter: "gemini_native",
      routingMode: "kanvas_fixed",
      queryMode: "none",
    },
    {
      preset: "newapi" as const,
      model: "gpt-image-2-edit",
      apiSurface: "generation.tasks.v1",
      adapter: "openai_compatible",
      routingMode: "gateway_managed",
      queryMode: "provider_request_id",
    },
    {
      preset: "tokenhub" as const,
      model: "gpt-image-2-edit",
      apiSurface: "generation.tasks.v1",
      adapter: "openai_compatible",
      routingMode: "gateway_managed",
      queryMode: "provider_request_id",
    },
  ])(
    "compiles $preset into a pinned executable route",
    ({ preset, model, apiSurface, adapter, routingMode, queryMode }) => {
      const definition = buildProviderSettingControlPlaneDefinition({
        ids,
        providerSettingId: "01K00000000000000000000008",
        preset,
        providerModelId: model,
        runtimeAdapters: [
          runtimeAdapter({
            operation:
              apiSurface === "images.edits.v1"
                ? "image.edit"
                : "image.generate",
            apiSurface,
          }),
        ],
        pricingConfiguration: {
          providerModelId: model,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
        },
        observedAt: new Date("2026-08-12T07:00:00.000Z"),
        catalogEntry: {
          providerModelId: model,
          displayName: model,
          inputModalities: ["text", "image"],
          outputModalities: ["image"],
          operations: {
            [apiSurface === "images.edits.v1"
              ? "image.edit"
              : "image.generate"]: {
              apiSurfaces: [apiSurface],
              parameters: [],
              evidence: [
                {
                  kind: "adapter_manifest",
                  reference: "test.manifest.v1",
                  observedAt: "2026-08-12T07:00:00.000Z",
                  sourceDigest: `sha256:${"a".repeat(64)}`,
                  confidence: "high",
                  claim: "supported",
                },
              ],
            },
          },
          completeness: "partial",
          evidence: [
            {
              kind: "provider_api",
              reference: "test.models.list",
              observedAt: "2026-08-12T07:00:00.000Z",
              sourceDigest: `sha256:${"b".repeat(64)}`,
              confidence: "high",
              claim: "identity",
            },
          ],
        },
      });

      expect(definition.routes).toHaveLength(1);
      expect(definition.routes[0]).toMatchObject({
        apiSurface,
        routePolicyDocument: {
          providerKey: preset,
          apiSurface,
          providerEndpointId: ids.endpointId,
          credentialId: ids.credentialId,
          modelDeploymentId: ids.modelDeploymentId,
          pricingRevisionId: ids.pricingRevisionId,
          budgetAccountId: ids.budgetAccountId,
          routingMode,
          queryMode,
        },
      });
      expect(definition.modelProfileDocument).toMatchObject({
        schemaVersion: 1,
        model: {
          displayName: model,
          inputModalities: ["text", "image"],
          outputModalities: ["image"],
        },
      });
      expect(definition.modelProfileDocument.model).not.toHaveProperty(
        "providerModelId",
      );
      expect(
        definition.modelProfileDocument.operations[
          apiSurface === "images.edits.v1" ? "image.edit" : "image.generate"
        ],
      ).not.toHaveProperty("apiSurfaces");
      expect(definition.routeConstraints.allowedAdapterKinds).toEqual([
        adapter,
      ]);
      expect(definition.modelDeploymentDigest).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      );
      expect(definition.pricingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(definition.pricingDocument).toMatchObject({
        schemaVersion: 1,
        billingMode: "fixed",
        fixedChargeAmount: "0.25",
        evidence: {
          priceVerified: true,
          sourceKind: "contract",
          observedAt: "2026-08-12T07:00:00.000Z",
        },
      });
      if (definition.pricingDocument.billingMode !== "fixed") {
        throw new Error("Expected fixed Provider pricing.");
      }
      expect(definition.pricingDocument.evidence.sourceReference).toMatch(
        /^kanvas:provider-setting:01K00000000000000000000008:model:[0-9a-f]{16}$/u,
      );
      expect(definition.pricingDocument.evidence.sourceDigest).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      );
      expect(definition.pricingRevisionSourceKind).toBe("contract");
      expect(definition.maximumCharge.amount).toBe("0.25");
    },
  );

  it("uses TokenHub Generation Tasks quota as the exact reported charge contract", () => {
    const definition = buildProviderSettingControlPlaneDefinition({
      ids,
      providerSettingId: "01K00000000000000000000008",
      preset: "tokenhub",
      providerModelId: "gpt-image-2",
      runtimeAdapters: [
        runtimeAdapter({
          operation: "image.generate",
          apiSurface: "generation.tasks.v1",
        }),
      ],
      pricingConfiguration: {
        providerModelId: "gpt-image-2",
        billingMode: "provider_reported",
        maximumChargeAmount: "1",
      },
      observedAt: new Date("2026-08-31T00:00:00.000Z"),
      catalogEntry: {
        providerModelId: "gpt-image-2",
        displayName: "GPT Image 2",
        inputModalities: ["text"],
        outputModalities: ["image"],
        operations: {
          "image.generate": {
            apiSurfaces: ["generation.tasks.v1"],
            parameters: [],
            evidence: [
              {
                kind: "adapter_manifest",
                reference: "test.manifest.v1",
                observedAt: "2026-08-31T00:00:00.000Z",
                sourceDigest: `sha256:${"a".repeat(64)}`,
                confidence: "high",
                claim: "supported",
              },
            ],
          },
        },
        completeness: "partial",
        evidence: [
          {
            kind: "provider_api",
            reference: "tokenhub.models.list",
            observedAt: "2026-08-31T00:00:00.000Z",
            sourceDigest: `sha256:${"b".repeat(64)}`,
            confidence: "high",
            claim: "identity",
          },
        ],
      },
    });

    expect(definition.pricingDocument).toMatchObject({
      billingMode: "provider_reported",
      currencyCode: "USD",
      evidence: {
        chargeVerified: true,
        sourceReference: "tokenhub.generation-task.quota",
      },
    });
    expect(definition.maximumCharge.amount).toBe("1");
  });

  it("keeps optional discovered parameters disabled until an administrator publishes a caller policy", () => {
    const definition = buildProviderSettingControlPlaneDefinition({
      ids,
      providerSettingId: "01K00000000000000000000008",
      preset: "openrouter",
      providerModelId: "openai/gpt-image-2",
      runtimeAdapters: [
        runtimeAdapter({
          operation: "image.generate",
          apiSurface: "images.generations.v1",
        }),
      ],
      pricingConfiguration: {
        providerModelId: "openai/gpt-image-2",
        billingMode: "fixed",
        fixedChargeAmount: "0.25",
      },
      observedAt: new Date("2026-08-12T07:00:00.000Z"),
      catalogEntry: {
        providerModelId: "openai/gpt-image-2",
        displayName: "GPT Image 2",
        inputModalities: ["text"],
        outputModalities: ["image"],
        operations: {
          "image.generate": {
            apiSurfaces: ["images.generations.v1"],
            parameters: [
              {
                key: "quality",
                label: "Quality",
                valueType: "enum",
                values: ["low", "high"],
                required: false,
                evidence: [
                  {
                    kind: "provider_api",
                    reference: "openrouter.images.model-endpoints",
                    observedAt: "2026-08-12T07:00:00.000Z",
                    sourceDigest: `sha256:${"a".repeat(64)}`,
                    confidence: "high",
                    claim: "supported",
                  },
                ],
              },
            ],
            evidence: [
              {
                kind: "provider_api",
                reference: "openrouter.images.model-endpoints",
                observedAt: "2026-08-12T07:00:00.000Z",
                sourceDigest: `sha256:${"a".repeat(64)}`,
                confidence: "high",
                claim: "supported",
              },
            ],
          },
        },
        completeness: "partial",
        evidence: [
          {
            kind: "provider_api",
            reference: "openrouter.images.models",
            observedAt: "2026-08-12T07:00:00.000Z",
            sourceDigest: `sha256:${"b".repeat(64)}`,
            confidence: "high",
            claim: "identity",
          },
        ],
      },
    });

    expect(definition.routes[0]?.parameterPolicies).toEqual({
      quality: {
        callerPolicy: "optional",
        allowedValues: ["low", "high"],
      },
    });
    expect(
      definition.modelProfileDocument.operations["image.generate"]?.parameters,
    ).toHaveLength(1);
  });

  it("rejects metered pricing when an Adapter cannot emit the required metric", () => {
    expect(() =>
      buildProviderSettingControlPlaneDefinition({
        ids,
        providerSettingId: "01K00000000000000000000008",
        preset: "newapi",
        providerModelId: "gpt-image-2",
        runtimeAdapters: [
          runtimeAdapter({
            operation: "image.generate",
            apiSurface: "generation.tasks.v1",
          }),
        ],
        pricingConfiguration: {
          providerModelId: "gpt-image-2",
          billingMode: "metered",
          maximumChargeAmount: "1",
          rates: [
            {
              metricKey: "input_tokens",
              unitCode: "token",
              quantity: "1000",
              amount: "0.1",
            },
          ],
        },
        observedAt: new Date("2026-08-12T07:00:00.000Z"),
        catalogEntry: {
          providerModelId: "gpt-image-2",
          displayName: "GPT Image 2",
          inputModalities: ["text"],
          outputModalities: ["image"],
          operations: {
            "image.generate": {
              apiSurfaces: ["generation.tasks.v1"],
              parameters: [],
              evidence: [
                {
                  kind: "adapter_manifest",
                  reference: "test.manifest.v1",
                  observedAt: "2026-08-12T07:00:00.000Z",
                  sourceDigest: `sha256:${"a".repeat(64)}`,
                  confidence: "high",
                  claim: "supported",
                },
              ],
            },
          },
          completeness: "partial",
          evidence: [
            {
              kind: "provider_api",
              reference: "test.models.list",
              observedAt: "2026-08-12T07:00:00.000Z",
              sourceDigest: `sha256:${"b".repeat(64)}`,
              confidence: "high",
              claim: "identity",
            },
          ],
        },
      }),
    ).toThrow(/not emitted/u);
  });
});
