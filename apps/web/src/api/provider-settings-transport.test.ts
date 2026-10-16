import { describe, expect, it, vi } from "vitest";

import {
  activateWorkspaceProviderSetting,
  adoptWorkspaceProviderModelCatalog,
  createWorkspaceProviderSetting,
  renameWorkspaceProviderSetting,
  discoverWorkspaceProviderModels,
  fetchWorkspaceAgentModelSettings,
  fetchWorkspaceProviderModelCatalogReview,
  fetchWorkspaceProviderSettings,
  fetchWorkspaceModels,
  fetchWorkspaceProviderModelCatalog,
  importWorkspaceProviderModels,
  mapWorkspaceProviderModel,
  publishWorkspaceProviderModel,
  searchModelReference,
  syncWorkspaceModelReference,
  refreshWorkspaceProviderModelCatalog,
  rotateWorkspaceProviderSettingSecret,
  updateWorkspaceAgentModelSettings,
} from "./transport.js";

const workspaceId = "01K00000000000000000000001";
const providerId = "01K00000000000000000000002";
const context = {
  workspaceId,
  csrfToken: "csrf-provider-settings-test",
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Provider Settings transport", () => {
  it("renames with optimistic concurrency and CSRF without submitting credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ provider: {}, result: "renamed" }));
    await renameWorkspaceProviderSetting(
      context,
      providerId,
      { expectedVersion: 3, displayName: "Main provider" },
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/provider-settings/${providerId}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "x-kanvas-workspace-id": workspaceId,
          "x-kanvas-csrf": context.csrfToken,
        }) as unknown,
        body: JSON.stringify({
          expectedVersion: 3,
          displayName: "Main provider",
        }),
      }),
    );
  });

  it("uses the canonical Model and Provider Model endpoints", async () => {
    const providerModelId = "01K00000000000000000000003";
    const canonicalModelId = "01K00000000000000000000004";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ models: [] }))
      .mockResolvedValueOnce(jsonResponse({ models: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "not_found", stale: false, warnings: [] }),
      )
      .mockResolvedValueOnce(jsonResponse({ models: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ models: [], created: 1, refreshed: 0 }),
      )
      .mockResolvedValueOnce(jsonResponse({ model: {}, result: "mapped" }))
      .mockResolvedValueOnce(jsonResponse({ model: {}, result: "published" }));

    await fetchWorkspaceModels(workspaceId, fetcher);
    await searchModelReference(workspaceId, "gpt-5", fetcher);
    await syncWorkspaceModelReference(
      context,
      canonicalModelId,
      { providerModelId },
      fetcher,
    );
    await fetchWorkspaceProviderModelCatalog(workspaceId, providerId, fetcher);
    await importWorkspaceProviderModels(
      context,
      providerId,
      { upstreamModelIds: ["openai/gpt-5.6-sol"] },
      fetcher,
    );
    await mapWorkspaceProviderModel(
      context,
      providerId,
      providerModelId,
      {
        expectedVersion: 1,
        canonicalModelId,
        mappingSource: "manual",
        mappingConfidence: "manual",
      },
      fetcher,
    );
    await publishWorkspaceProviderModel(
      context,
      providerId,
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
      fetcher,
    );

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/models",
      "/api/v1/model-reference?q=gpt-5",
      `/api/v1/models/${canonicalModelId}/reference-syncs`,
      `/api/v1/provider-settings/${providerId}/provider-models`,
      `/api/v1/provider-settings/${providerId}/model-imports`,
      `/api/v1/provider-settings/${providerId}/provider-models/${providerModelId}`,
      `/api/v1/provider-settings/${providerId}/provider-models/${providerModelId}/publications`,
    ]);
    expect(
      [fetcher.mock.calls[2], ...fetcher.mock.calls.slice(4)].every((call) => {
        const [, init] = call!;
        const headers = new Headers(init?.headers);
        return headers.get("x-kanvas-csrf") === context.csrfToken;
      }),
    ).toBe(true);
  });

  it("reads and updates the governed Agent models", async () => {
    const settings = {
      version: 2,
      currentDefaultModelId: "01K00000000000000000000003",
      currentFastModelId: "01K00000000000000000000004",
      reasoningLevel: "medium" as const,
      webSearchMode: "off" as const,
      options: [],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(settings))
      .mockResolvedValueOnce(jsonResponse({ ...settings, version: 3 }));

    await expect(
      fetchWorkspaceAgentModelSettings(context, fetcher),
    ).resolves.toEqual(settings);
    await expect(
      updateWorkspaceAgentModelSettings(
        context,
        {
          expectedVersion: 2,
          defaultModelId: "01K00000000000000000000005",
          fastModelId: "01K00000000000000000000006",
          reasoningLevel: "high",
          webSearchMode: "auto",
          actionConfirmationRequired: false,
        },
        fetcher,
      ),
    ).resolves.toMatchObject({ version: 3 });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/agent-model-settings");
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(
      new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("x-kanvas-csrf"),
    ).toBe(context.csrfToken);
  });

  it("reads only the redacted Workspace projection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        credentialStorage: {
          ready: true,
          mode: "encrypted_database",
          kekVersion: "provider-kek-v1",
        },
        providers: [],
      }),
    );

    await fetchWorkspaceProviderSettings(workspaceId, fetcher);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/provider-settings");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("x-kanvas-workspace-id")).toBe(
      workspaceId,
    );
  });

  it("submits API Key once with CSRF and idempotency headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        provider: {},
        result: "created",
      }),
    );

    await createWorkspaceProviderSetting(
      context,
      {
        displayName: "TokenHub",
        preset: "tokenhub",
        hardLimitAmount: "20.00",
        apiKey: "sk-provider-test",
        modelKeys: ["gpt-image-2-edit"],
      },
      "provider-create-key",
      fetcher,
    );

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers)).toMatchObject(expect.any(Headers));
    const headers = new Headers(init?.headers);
    expect(headers.get("x-kanvas-csrf")).toBe(context.csrfToken);
    expect(headers.get("idempotency-key")).toBe("provider-create-key");
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected a JSON string request body.");
    }
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      apiKey: "sk-provider-test",
    });
  });

  it("discovers models with the draft credential and no idempotency header", async () => {
    const discovery = {
      schemaVersion: 1 as const,
      providerPreset: "newapi" as const,
      discoveryMethod: "openai-compatible.models",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      discoveredAt: "2026-08-12T07:00:00.000Z",
      models: [],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(discovery));

    await expect(
      discoverWorkspaceProviderModels(
        context,
        {
          preset: "newapi",
          baseUrl: "https://models.example.com/v1",
          apiKey: "sk-provider-discovery-test",
        },
        fetcher,
      ),
    ).resolves.toEqual(discovery);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/provider-settings/model-discovery");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-kanvas-csrf")).toBe(context.csrfToken);
    expect(headers.get("x-kanvas-workspace-id")).toBe(context.workspaceId);
    expect(headers.get("idempotency-key")).toBeNull();
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected a JSON string request body.");
    }
    expect(JSON.parse(init.body)).toEqual({
      preset: "newapi",
      baseUrl: "https://models.example.com/v1",
      apiKey: "sk-provider-discovery-test",
    });
    if (typeof url !== "string") {
      throw new TypeError("Expected a string request URL.");
    }
    expect(url).not.toContain("sk-provider-discovery-test");
  });

  it("uses bounded lifecycle endpoints and never places Key in the URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          provider: {},
          result: "activated",
        }),
      ),
    );

    await activateWorkspaceProviderSetting(
      context,
      providerId,
      {
        expectedVersion: 2,
        hardLimitAmount: "20.00",
        modelPricingConfigurations: [
          {
            providerModelId: "gpt-image-2",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
        ],
      },
      "provider-activate-key",
      fetcher,
    );
    await rotateWorkspaceProviderSettingSecret(
      context,
      providerId,
      {
        expectedVersion: 3,
        apiKey: "sk-rotated-provider-test",
        mode: "graceful",
      },
      "provider-rotate-key",
      fetcher,
    );

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `/api/v1/provider-settings/${providerId}/activation`,
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `/api/v1/provider-settings/${providerId}/secret-rotations`,
    );
    const activationBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof activationBody !== "string") {
      throw new TypeError("Expected a string activation body.");
    }
    expect(JSON.parse(activationBody)).toEqual({
      expectedVersion: 2,
      hardLimitAmount: "20.00",
      modelPricingConfigurations: [
        {
          providerModelId: "gpt-image-2",
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
        },
      ],
    });
    const rotationUrl = fetcher.mock.calls[1]?.[0];
    if (typeof rotationUrl !== "string") {
      throw new TypeError("Expected a string request URL.");
    }
    expect(rotationUrl).not.toContain("sk-rotated-provider-test");
    const rotationRequest = fetcher.mock.calls[1]?.[1];
    if (typeof rotationRequest?.body !== "string") {
      throw new TypeError("Expected a string request body.");
    }
    expect(JSON.parse(rotationRequest.body)).toEqual({
      expectedVersion: 3,
      apiKey: "sk-rotated-provider-test",
      mode: "graceful",
    });
    expect(rotationRequest.body).not.toContain("revoke_immediately");
  });

  it("refreshes the stored catalog with CAS and idempotency but no API key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        provider: {},
        result: "refreshed",
        changesPendingReview: false,
      }),
    );

    await refreshWorkspaceProviderModelCatalog(
      context,
      providerId,
      { expectedVersion: 4 },
      "provider-catalog-refresh-key",
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/v1/provider-settings/${providerId}/model-catalog-refreshes`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("idempotency-key")).toBe("provider-catalog-refresh-key");
    expect(headers.get("x-kanvas-csrf")).toBe(context.csrfToken);
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected a JSON string request body.");
    }
    expect(JSON.parse(init.body)).toEqual({
      expectedVersion: 4,
    });
    expect(init.body).not.toContain("apiKey");
  });

  it("reads the immutable catalog review and adopts its exact revisions", async () => {
    const review = {
      providerSettingId: providerId,
      version: 7,
      current: {
        snapshotId: "01K00000000000000000000003",
        revision: 3,
        canonicalDigest: `sha256:${"a".repeat(64)}`,
        sourceDigest: `sha256:${"b".repeat(64)}`,
      },
      activated: {
        snapshotId: "01K00000000000000000000004",
        revision: 2,
        canonicalDigest: `sha256:${"c".repeat(64)}`,
        sourceDigest: `sha256:${"d".repeat(64)}`,
      },
      selectedModels: [],
      blockers: [],
      canAdopt: true,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(review))
      .mockResolvedValueOnce(
        jsonResponse({
          provider: {},
          result: "adopted",
          adoptedRevision: 3,
        }),
      );

    await expect(
      fetchWorkspaceProviderModelCatalogReview(context, providerId, fetcher),
    ).resolves.toEqual(review);
    await adoptWorkspaceProviderModelCatalog(
      context,
      providerId,
      {
        expectedVersion: review.version,
        currentRevision: review.current.revision,
        activatedRevision: review.activated.revision,
      },
      "provider-catalog-adoption-key",
      fetcher,
    );

    const [reviewUrl, reviewInit] = fetcher.mock.calls[0] ?? [];
    expect(reviewUrl).toBe(
      `/api/v1/provider-settings/${providerId}/model-catalog-review`,
    );
    expect(reviewInit?.method).toBeUndefined();
    expect(new Headers(reviewInit?.headers).get("idempotency-key")).toBeNull();
    const [adoptionUrl, adoptionInit] = fetcher.mock.calls[1] ?? [];
    expect(adoptionUrl).toBe(
      `/api/v1/provider-settings/${providerId}/model-catalog-adoptions`,
    );
    expect(adoptionInit?.method).toBe("POST");
    const adoptionHeaders = new Headers(adoptionInit?.headers);
    expect(adoptionHeaders.get("idempotency-key")).toBe(
      "provider-catalog-adoption-key",
    );
    expect(adoptionHeaders.get("x-kanvas-csrf")).toBe(context.csrfToken);
    if (typeof adoptionInit?.body !== "string") {
      throw new TypeError("Expected a JSON string request body.");
    }
    expect(JSON.parse(adoptionInit.body)).toEqual({
      expectedVersion: 7,
      currentRevision: 3,
      activatedRevision: 2,
    });
  });
});
