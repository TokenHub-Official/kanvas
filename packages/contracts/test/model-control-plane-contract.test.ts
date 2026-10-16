import { Value } from "@sinclair/typebox/value";
import { FormatRegistry } from "@sinclair/typebox/type";
import { describe, expect, it } from "vitest";

import {
  CreateCanonicalModelBodySchema,
  MapProviderModelBodySchema,
  PublishCanonicalModelBodySchema,
  PublishProviderModelBodySchema,
  ModelReferenceSearchResultSchema,
  ModelReferenceSyncResultSchema,
  ProviderModelCatalogSchema,
  WorkspaceModelsSchema,
  createWorkspaceModelRoute,
  getWorkspaceModelsRoute,
  importWorkspaceProviderModelsRoute,
  mapWorkspaceProviderModelRoute,
  publishWorkspaceModelRoute,
  publishWorkspaceProviderModelRoute,
  getWorkspaceProviderModelCatalogRoute,
  searchModelReferenceRoute,
  syncWorkspaceModelReferenceRoute,
} from "../src/api/index.js";

const id = "01K00000000000000000000001";

FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));

describe("Model control plane API contract", () => {
  it("keeps canonical identity separate from Provider model IDs", () => {
    expect(
      Value.Check(CreateCanonicalModelBodySchema, {
        slug: "gpt-5.6-sol",
        sourceKind: "models_dev",
        sourceReference: "openai/gpt-5.6-sol",
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateCanonicalModelBodySchema, {
        slug: "minimax/MiniMax-M3",
        sourceKind: "models_dev",
        sourceReference: "minimax/MiniMax-M3",
      }),
    ).toBe(true);
    expect(
      Value.Check(MapProviderModelBodySchema, {
        expectedVersion: 1,
        canonicalModelId: id,
        mappingSource: "manual",
        mappingConfidence: "manual",
      }),
    ).toBe(true);
    expect(
      Value.Check(PublishProviderModelBodySchema, {
        expectedVersion: 2,
        agentTextTransport: {
          apiSurface: "responses.v1",
          protocolKind: "openai_responses",
        },
        pricing: {
          providerModelId: "openai/gpt-5.6-sol",
          billingMode: "metered",
          rates: [
            {
              metricKey: "input_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: "1.25",
            },
          ],
          maximumChargeAmount: "10",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(PublishProviderModelBodySchema, {
        expectedVersion: 2,
        agentTextTransport: {
          apiSurface: "responses.v1",
          protocolKind: "anthropic_messages",
        },
        pricing: {
          providerModelId: "openai/gpt-5.6-sol",
          billingMode: "fixed",
          fixedChargeAmount: "0.01",
        },
      }),
    ).toBe(false);
  });

  it("publishes editable model facts without accepting internal evidence digests", () => {
    const body = {
      expectedVersion: 1,
      displayName: "GPT-5.6 Sol",
      family: "gpt-5.6",
      description: "General-purpose reasoning model.",
      inputModalities: ["text"],
      outputModalities: ["text"],
      contextWindow: 1_000_000,
      maximumOutputTokens: 128_000,
      reasoning: true,
      toolCall: true,
      operations: {
        "text.generate": { parameters: [] },
      },
    };
    expect(Value.Check(PublishCanonicalModelBodySchema, body)).toBe(true);
    expect(
      Value.Check(PublishCanonicalModelBodySchema, {
        ...body,
        sourceDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toBe(false);
  });

  it("returns business model facts and registers the eight routes", () => {
    expect(
      Value.Check(WorkspaceModelsSchema, {
        models: [
          {
            id,
            slug: "gpt-5.6-sol",
            lifecycle: "draft",
            sourceKind: "models_dev",
            version: 1,
            providers: [],
            createdAt: "2026-08-27T00:00:00.000Z",
            updatedAt: "2026-08-27T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProviderModelCatalogSchema, {
        models: [
          {
            upstreamModelId: "openai/gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            inputModalities: ["text"],
            outputModalities: ["text"],
            completeness: "identity_only",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(ModelReferenceSearchResultSchema, {
        models: [
          {
            key: "gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            description: "General-purpose model.",
            inputModalities: ["text"],
            outputModalities: ["text"],
            providers: [],
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(ModelReferenceSyncResultSchema, {
        status: "resolved",
        stale: false,
        sourceRevision: "models.dev:test",
        observedAt: "2026-09-03T00:00:00.000Z",
        metadataSource: "provider:aihubmix",
        pricingSource: "provider:aihubmix",
        warnings: [],
        defaults: {
          contextWindow: 256_000,
          maximumOutputTokens: 128_000,
          cost: { input: 0.48, output: 2.41, cacheRead: 0.09644 },
        },
      }),
    ).toBe(true);
    expect([
      getWorkspaceModelsRoute.path,
      createWorkspaceModelRoute.path,
      publishWorkspaceModelRoute.path,
      importWorkspaceProviderModelsRoute.path,
      mapWorkspaceProviderModelRoute.path,
      publishWorkspaceProviderModelRoute.path,
      getWorkspaceProviderModelCatalogRoute.path,
      searchModelReferenceRoute.path,
      syncWorkspaceModelReferenceRoute.path,
    ]).toEqual([
      "/api/v1/models",
      "/api/v1/models",
      "/api/v1/models/{modelId}/publications",
      "/api/v1/provider-settings/{providerSettingId}/model-imports",
      "/api/v1/provider-settings/{providerSettingId}/provider-models/{providerModelId}",
      "/api/v1/provider-settings/{providerSettingId}/provider-models/{providerModelId}/publications",
      "/api/v1/provider-settings/{providerSettingId}/provider-models",
      "/api/v1/model-reference",
      "/api/v1/models/{modelId}/reference-syncs",
    ]);
  });
});
