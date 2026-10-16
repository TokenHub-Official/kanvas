import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { PublishCanonicalModelOptions } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceModelsController } from "../src/http/workspace-models.controller.js";

const scope: TrustedWorkspaceScope = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["credential.manage"],
  trusted: true,
};
const modelId = "01K00000000000000000000006";
const digest = `sha256:${"1".repeat(64)}`;

function contexts(request: FastifyRequest): RequestAuthorizationContextStore {
  const store = new RequestAuthorizationContextStore();
  store.set(request, {
    authentication: {
      authSubjectId: "model-control-plane",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return store;
}

function model(version = 1) {
  return {
    id: modelId,
    slug: "gpt-5.6-sol",
    lifecycle: "active" as const,
    sourceKind: "models_dev" as const,
    sourceReference: "openai/gpt-5.6-sol",
    version,
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
    updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    profile: {
      schemaVersion: 1 as const,
      model: {
        slug: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        family: "gpt-5.6",
        description: "General-purpose model.",
        inputModalities: ["text" as const],
        outputModalities: ["text" as const],
        contextWindow: 1_000_000,
        maximumOutputTokens: 128_000,
      },
      operations: {
        "text.generate": {
          parameters: [],
          evidence: [
            {
              kind: "administrator" as const,
              reference: "openai/gpt-5.6-sol",
              observedAt: "2026-08-27T00:00:00.000Z",
              sourceDigest: digest,
              confidence: "high" as const,
              claim: "supported" as const,
            },
          ],
        },
      },
      sources: [
        {
          kind: "models_dev" as const,
          reference: "openai/gpt-5.6-sol",
          observedAt: "2026-08-27T00:00:00.000Z",
          sourceDigest: digest,
        },
      ],
    },
    providers: [],
  };
}

describe("WorkspaceModelsController", () => {
  it("returns model facts without internal evidence or source digests", async () => {
    const request = { id: "models-get" } as FastifyRequest;
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: { listModels: vi.fn().mockResolvedValue([model()]) },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    const result = await controller.get(request);

    expect(result.models[0]).toMatchObject({
      slug: "gpt-5.6-sol",
      profile: { operations: { "text.generate": { parameters: [] } } },
    });
    expect(JSON.stringify(result)).not.toContain("sourceDigest");
    expect(JSON.stringify(result)).not.toContain("evidence");
  });

  it("returns importable Provider models and internal models.dev defaults", async () => {
    const request = { id: "model-reference" } as FastifyRequest;
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: {
          listProviderCatalogModels: vi.fn().mockResolvedValue([
            {
              upstreamModelId: "openai/gpt-5.6-sol",
              displayName: "GPT-5.6 Sol",
              inputModalities: ["text"],
              outputModalities: ["text"],
              completeness: "identity_only",
            },
          ]),
        },
        modelReferences: {
          getCurrent: vi.fn().mockResolvedValue({
            document: {
              canonicalModels: [
                {
                  key: "gpt-5.6-sol",
                  displayName: "GPT-5.6 Sol",
                  description: "General-purpose model.",
                  modalities: { input: ["text"], output: ["text"] },
                  limit: { context: 1_000_000, output: 128_000 },
                },
              ],
              providers: [
                {
                  slug: "openai",
                  displayName: "OpenAI",
                  models: [
                    {
                      upstreamModelId: "gpt-5.6-sol",
                      canonicalModelKey: "gpt-5.6-sol",
                      cost: { input: 1, output: 2 },
                    },
                  ],
                },
              ],
            },
          }),
        },
        providerSettings: {
          list: vi.fn().mockResolvedValue([
            {
              id: "01K00000000000000000000009",
              preset: "openai",
            },
          ]),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    await expect(
      controller.getProviderModelCatalog(request, "01K00000000000000000000009"),
    ).resolves.toMatchObject({
      models: [{ upstreamModelId: "openai/gpt-5.6-sol" }],
    });
    const reference = await controller.searchReference(request, {
      q: "5.6",
    });
    expect(reference.models[0]).toMatchObject({
      key: "gpt-5.6-sol",
      contextWindow: 1_000_000,
      providers: [
        {
          providerSlug: "openai",
          upstreamModelId: "gpt-5.6-sol",
          cost: { input: 1, output: 2 },
        },
      ],
    });
    expect(JSON.stringify(reference)).not.toContain("sourceDigest");
  });

  it("publishes non-text models without invented token limits", async () => {
    const request = { id: "image-model-publish" } as FastifyRequest;
    const imageModel = {
      ...model(),
      sourceKind: "provider" as const,
      profile: {
        ...model().profile,
        model: {
          slug: "image-model",
          displayName: "Image model",
          family: "image",
          description: "Image generation",
          inputModalities: ["text"],
          outputModalities: ["image"],
        },
        operations: {
          "image.generate": model().profile.operations["text.generate"],
        },
      },
    };
    const publishCanonicalModel = vi
      .fn()
      .mockResolvedValue({ replayed: false });
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: {
          listModels: vi.fn().mockResolvedValue([imageModel]),
          publishCanonicalModel,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );
    const result = await controller.publish(request, modelId, {
      expectedVersion: 1,
      displayName: "Image model",
      family: "image",
      description: "Image generation",
      inputModalities: ["text"],
      outputModalities: ["image"],
      operations: { "image.generate": { parameters: [] } },
    });
    const [options] = publishCanonicalModel.mock.calls[0] as [
      PublishCanonicalModelOptions,
    ];
    expect(options.profileDocument.model).not.toHaveProperty("contextWindow");
    expect(options.profileDocument.model).not.toHaveProperty(
      "maximumOutputTokens",
    );
    expect(result.model.profile).not.toHaveProperty("contextWindow");
  });

  it("rejects text publication with unknown token limits before saving", async () => {
    const request = { id: "unknown-text-limits" } as FastifyRequest;
    const publishCanonicalModel = vi.fn();
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: {
          listModels: vi.fn().mockResolvedValue([model()]),
          publishCanonicalModel,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );
    await expect(
      controller.publish(request, modelId, {
        expectedVersion: 1,
        displayName: "Text model",
        family: "text",
        description: "Text generation",
        inputModalities: ["text"],
        outputModalities: ["text"],
        operations: { "text.generate": { parameters: [] } },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(publishCanonicalModel).not.toHaveBeenCalled();
  });

  it("constructs publication evidence on the server", async () => {
    const request = { id: "models-publish" } as FastifyRequest;
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([model(1)])
      .mockResolvedValueOnce([model(2)]);
    const publishCanonicalModel = vi.fn().mockResolvedValue({
      model: model(2),
      profileRevisionId: "01K00000000000000000000007",
      replayed: false,
    });
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: { listModels, publishCanonicalModel },
        modelReferences: {
          getCurrent: vi.fn().mockResolvedValue({
            sourceDigest: digest,
            document: {
              observedAt: "2026-08-27T00:00:00.000Z",
              canonicalModels: [
                {
                  key: "openai/gpt-5.6-sol",
                  displayName: "GPT-5.6 Sol",
                  description: "General-purpose model.",
                  reasoning: true,
                  toolCall: true,
                  structuredOutput: true,
                  temperature: false,
                  limit: { input: 900_000 },
                },
              ],
            },
          }),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    await controller.publish(request, modelId, {
      expectedVersion: 1,
      displayName: "GPT-5.6 Sol",
      family: "gpt-5.6",
      description: "General-purpose model.",
      inputModalities: ["text"],
      outputModalities: ["text"],
      contextWindow: 1_000_000,
      maximumOutputTokens: 128_000,
      operations: { "text.generate": { parameters: [] } },
    });

    const [options] = publishCanonicalModel.mock.calls[0] as [
      PublishCanonicalModelOptions,
    ];
    expect(options).toMatchObject({
      canonicalModelId: modelId,
      expectedVersion: 1,
    });
    expect(options.profileDocument.sources[0]).toMatchObject({
      kind: "models_dev",
      observedAt: "2026-08-27T00:00:00.000Z",
      sourceDigest: digest,
    });
    expect(options.profileDocument.model).toMatchObject({
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      temperature: false,
      maximumInputTokens: 900_000,
    });
    expect(options.profileDocument.operations["text.generate"]).toMatchObject({
      parameters: [],
      evidence: [{ kind: "administrator" }],
    });
  });

  it("syncs defaults from an exact Provider-only models.dev entry", async () => {
    const request = { id: "model-reference-sync" } as FastifyRequest;
    const providerModelId = "01K00000000000000000000008";
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: {
          listModels: vi.fn().mockResolvedValue([
            {
              ...model(2),
              sourceKind: "provider",
              sourceReference: "doubao-seed-2-0-pro",
              providers: [
                {
                  id: providerModelId,
                  upstreamModelId: "doubao-seed-2-0-pro",
                  providerPreset: "tokenhub",
                },
              ],
            },
          ]),
        },
        modelReferences: {
          getCurrent: vi.fn().mockResolvedValue({
            id: "01K00000000000000000000009",
            revision: 1,
            sourceRevision: "models.dev:test",
            sourceDigest: digest,
            fetchedAt: new Date(),
            publishedAt: new Date(),
            document: {
              schemaVersion: 1,
              source: "models.dev",
              sourceRevision: "models.dev:test",
              observedAt: "2026-09-03T00:00:00.000Z",
              canonicalModels: [],
              providers: [
                {
                  slug: "aihubmix",
                  displayName: "AIHubMix",
                  documentationUrl: "https://example.com",
                  models: [
                    {
                      upstreamModelId: "doubao-seed-2-0-pro",
                      displayName: "Doubao Seed 2.0 Pro",
                      description: "Multimodal reasoning model",
                      family: "seed",
                      limit: { context: 256_000, output: 128_000 },
                      modalities: { input: ["text"], output: ["text"] },
                      cost: { input: 0.48, output: 2.41 },
                    },
                  ],
                },
              ],
            },
          }),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    await expect(
      controller.syncReference(request, modelId, { providerModelId }),
    ).resolves.toMatchObject({
      status: "resolved",
      defaults: {
        contextWindow: 256_000,
        maximumOutputTokens: 128_000,
        cost: { input: 0.48, output: 2.41 },
      },
    });
  });

  it("publishes one mapped Provider model as one selectable Deployment", async () => {
    const request = { id: "provider-model-publish" } as FastifyRequest;
    const providerModelId = "01K00000000000000000000008";
    const publishProviderModel = vi.fn().mockResolvedValue({
      model: {
        id: providerModelId,
        providerSettingId: "01K00000000000000000000009",
        upstreamModelId: "openai/gpt-5.6-sol",
        canonicalModelId: modelId,
        catalogSnapshotId: "01K00000000000000000000010",
        mappingSource: "manual",
        mappingConfidence: "manual",
        lifecycle: "active",
        lastSeenAt: new Date(),
        version: 3,
      },
      modelDeploymentId: "01K00000000000000000000011",
      pricingRevisionId: "01K00000000000000000000012",
      replayed: false,
    });
    const controller = new WorkspaceModelsController(
      {
        modelControlPlane: {
          publishProviderModel,
          listModels: vi.fn().mockResolvedValue([model(2)]),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    await expect(
      controller.publishProviderModel(
        request,
        "01K00000000000000000000009",
        providerModelId,
        {
          expectedVersion: 2,
          agentTextTransport: {
            apiSurface: "responses.v1",
            protocolKind: "openai_responses",
          },
          pricing: {
            providerModelId: "openai/gpt-5.6-sol",
            billingMode: "fixed",
            fixedChargeAmount: "0.01",
          },
        },
      ),
    ).resolves.toMatchObject({ result: "published", model: { id: modelId } });
    expect(publishProviderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerModelId,
        expectedVersion: 2,
        agentTextTransport: {
          apiSurface: "responses.v1",
          protocolKind: "openai_responses",
        },
        pricing: {
          providerModelId: "openai/gpt-5.6-sol",
          billingMode: "fixed",
          fixedChargeAmount: "0.01",
        },
      }),
    );
  });
});
