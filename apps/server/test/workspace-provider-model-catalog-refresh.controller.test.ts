import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectedCatalogRuntimeDigest,
  type AdoptProviderModelCatalogOptions,
} from "@kanvas/database/runtime";

const providerMocks = vi.hoisted(() => ({
  discover: vi.fn<
    (
      options: {
        readonly preset: string;
        readonly baseUrl: string;
        readonly apiKey: Uint8Array;
        readonly refineModelKeys?: readonly string[];
      },
      request: (input: unknown) => Promise<unknown>,
    ) => Promise<unknown>
  >(),
  probe:
    vi.fn<
      (options: {
        readonly apiKey: Uint8Array;
        readonly modelKeys: readonly string[];
      }) => Promise<void>
    >(),
}));

vi.mock("../src/provider/provider-model-discovery.js", () => ({
  discoverProviderModelCatalog: providerMocks.discover,
  ProviderModelDiscoveryError: class extends Error {},
}));

vi.mock("../src/provider/provider-setting-probe.js", () => ({
  probeProviderSetting: providerMocks.probe,
  ProviderSettingProbeError: class extends Error {},
  requestProviderProbeJson: vi.fn(),
}));

import { WorkspaceProviderSettingsController } from "../src/http/workspace-provider-settings.controller.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const observedAt = "2026-08-12T08:00:00.000Z";

describe("Workspace Provider model catalog refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only after a new Provider is enabled", async () => {
    providerMocks.discover.mockResolvedValue({
      schemaVersion: 1,
      providerPreset: "tokenhub",
      discoveryMethod: "tokenhub.models.list",
      sourceDigest: digest("a"),
      models: [],
      discoveredAt: observedAt,
    });
    const create = vi
      .fn()
      .mockImplementation(
        (input: {
          readonly settingId: string;
          readonly displayName: string;
          readonly preset: string;
          readonly baseUrl: string;
          readonly createdAt: Date;
        }) =>
          Promise.resolve({
            result: "created",
            provider: {
              id: input.settingId,
              displayName: input.displayName,
              preset: input.preset,
              baseUrl: input.baseUrl,
              modelKeys: [],
              lifecycle: "draft",
              validation: "passed",
              secretConfigured: true,
              canRefreshModelCatalog: true,
              version: 1,
              createdAt: input.createdAt,
              updatedAt: input.createdAt,
            },
          }),
      );
    const activate = vi
      .fn()
      .mockImplementation((input: { readonly settingId: string }) =>
        Promise.resolve({
          result: "activated",
          provider: {
            id: input.settingId,
            displayName: "TokenHub",
            preset: "tokenhub",
            baseUrl: "https://us-api.tokenhub.com",
            modelKeys: [],
            lifecycle: "active",
            validation: "passed",
            secretConfigured: true,
            canRefreshModelCatalog: true,
            version: 2,
            createdAt: new Date(observedAt),
            updatedAt: new Date(observedAt),
            activatedAt: new Date(observedAt),
          },
        }),
      );
    const scope = {
      workspaceId: id(2),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human" as const,
      authenticationRefType: "session" as const,
      authenticationRefId: "session-redacted",
      authorityType: "human_membership" as const,
      authorityId: id(4),
      authorityVersion: 1,
    };
    const controller = new WorkspaceProviderSettingsController(
      { instanceId: "test" } as never,
      {
        providerSettings: { create, activate },
      } as never,
      {
        prepare: vi.fn().mockResolvedValue({
          aadDigest: digest("b"),
          materialFingerprint: digest("c"),
          source: {
            kind: "plaintext_database",
            plaintext: {
              materialPlaintextBase64:
                Buffer.from("test-key").toString("base64"),
            },
          },
        }),
        readiness: () => ({ ready: true }),
      } as never,
      {} as never,
      { require: () => ({ scope }) } as never,
    );

    const result = await controller.create(
      { id: "provider-create" } as never,
      "provider-save-key",
      {
        displayName: "TokenHub",
        preset: "tokenhub",
        baseUrl: "https://us-api.tokenhub.com",
        hardLimitAmount: "20.00",
        apiKey: "test-key",
      },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(result.provider.lifecycle).toBe("active");
  });

  it("uses only callback-scoped stored secret material and persists the server-discovered catalog", async () => {
    providerMocks.discover.mockResolvedValue({
      schemaVersion: 1,
      providerPreset: "openai",
      discoveryMethod: "openai.models+adapter-manifest",
      sourceDigest: digest("a"),
      models: [
        {
          providerModelId: "gpt-image-1",
          displayName: "GPT Image 1",
          inputModalities: ["text", "image"],
          outputModalities: ["image"],
          operations: {
            "image.generate": {
              apiSurfaces: ["openai.images.generations.v1"],
              parameters: [],
              evidence: [
                {
                  kind: "adapter_manifest",
                  reference: "openai.images.v1",
                  observedAt,
                  sourceDigest: digest("b"),
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
              reference: "openai.models.list",
              observedAt,
              sourceDigest: digest("a"),
              confidence: "high",
              claim: "identity",
            },
          ],
        },
      ],
    });
    providerMocks.probe.mockResolvedValue(undefined);
    const material = Buffer.from("sk-stored-only", "ascii");
    const refreshModelCatalog = vi
      .fn<
        (input: {
          readonly expectedVersion: number;
          readonly document: {
            readonly providerPreset: string;
            readonly sourceDigest: string;
          };
        }) => Promise<unknown>
      >()
      .mockResolvedValue({
        provider: {
          id: id(1),
          displayName: "OpenAI images",
          preset: "openai",
          baseUrl: "https://api.openai.com/v1",
          modelKeys: ["gpt-image-1"],
          modelCatalog: {
            revision: 2,
            activatedRevision: 1,
            discoveredAt: new Date(observedAt),
            sourceDigest: digest("a"),
            discoveryMethod: "openai.models+adapter-manifest",
            changesPendingReview: false,
          },
          lifecycle: "active",
          validation: "passed",
          secretConfigured: true,
          canRefreshModelCatalog: true,
          version: 4,
          createdAt: new Date(observedAt),
          updatedAt: new Date(observedAt),
        },
        result: "refreshed",
        changesPendingReview: false,
      });
    const scope = {
      workspaceId: id(2),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human" as const,
      authenticationRefType: "session" as const,
      authenticationRefId: "session-redacted",
      authorityType: "human_membership" as const,
      authorityId: id(4),
      authorityVersion: 1,
    };
    const controller = new WorkspaceProviderSettingsController(
      { instanceId: "test" } as never,
      {
        providerSettings: {
          resolveModelCatalogRefreshIdentity: vi.fn().mockResolvedValue({
            preset: "openai",
            baseUrl: "https://api.openai.com/v1",
            modelKeys: ["gpt-image-1"],
            secret: {
              id: id(5),
              workspaceId: scope.workspaceId,
              credentialId: id(6),
              version: 1,
              materialGeneration: 1,
              sourceKind: "encrypted_database",
              lifecycleStatus: "active",
              aadDigest: digest("c"),
              materialFingerprint: digest("d"),
              formatVersion: 1,
              drainDeadlineAt: null,
              envelope: {},
            },
          }),
          refreshModelCatalog,
        },
      } as never,
      { readiness: () => ({ ready: true }) } as never,
      {
        async withResolvedMaterial<TResult>(
          _metadata: unknown,
          use: (value: Uint8Array) => Promise<TResult>,
        ): Promise<TResult> {
          try {
            return await use(material);
          } finally {
            material.fill(0);
          }
        },
      },
      { require: () => ({ scope }) } as never,
    );

    const result = await controller.refreshModelCatalog(
      { id: "request-model-catalog-refresh" } as never,
      id(1),
      "refresh-idempotency-key",
      { expectedVersion: 3 },
    );

    expect(result).toMatchObject({
      result: "refreshed",
      changesPendingReview: false,
      provider: {
        modelCatalog: {
          revision: 2,
          activatedRevision: 1,
        },
      },
    });
    const discoveryInput = providerMocks.discover.mock.calls[0]?.[0];
    expect(discoveryInput).toMatchObject({
      preset: "openai",
      baseUrl: "https://api.openai.com/v1",
      refineModelKeys: ["gpt-image-1"],
    });
    expect(discoveryInput?.apiKey).toBeInstanceOf(Uint8Array);
    expect(typeof providerMocks.discover.mock.calls[0]?.[1]).toBe("function");
    const probeInput = providerMocks.probe.mock.calls[0]?.[0];
    expect(probeInput).toMatchObject({
      modelKeys: ["gpt-image-1"],
    });
    expect(probeInput?.apiKey).toBeInstanceOf(Uint8Array);
    const persisted = refreshModelCatalog.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      expectedVersion: 3,
      document: {
        providerPreset: "openai",
        sourceDigest: digest("a"),
      },
    });
    expect([...material]).toEqual(
      Array.from({ length: material.byteLength }, () => 0),
    );
    expect(JSON.stringify(result)).not.toContain("sk-stored-only");
  });

  it("re-discovers and probes the exact reviewed runtime facts before adoption", async () => {
    const catalog = {
      schemaVersion: 1 as const,
      providerPreset: "openai" as const,
      discoveryMethod: "openai.models+adapter-manifest",
      sourceDigest: digest("a"),
      models: [
        {
          providerModelId: "gpt-image-1",
          displayName: "GPT Image 1",
          inputModalities: ["text", "image"] as const,
          outputModalities: ["image"] as const,
          operations: {
            "image.generate": {
              apiSurfaces: ["openai.images.generations.v1"],
              parameters: [],
              evidence: [
                {
                  kind: "adapter_manifest" as const,
                  reference: "openai.images.v1",
                  observedAt,
                  sourceDigest: digest("b"),
                  confidence: "high" as const,
                  claim: "supported" as const,
                },
              ],
            },
          },
          completeness: "partial" as const,
          evidence: [
            {
              kind: "provider_api" as const,
              reference: "openai.models.list",
              observedAt,
              sourceDigest: digest("a"),
              confidence: "high" as const,
              claim: "identity" as const,
            },
          ],
        },
      ],
    };
    providerMocks.discover.mockResolvedValue(catalog);
    providerMocks.probe.mockResolvedValue(undefined);
    const runtimeDigest = selectedCatalogRuntimeDigest(catalog, [
      "gpt-image-1",
    ]);
    const material = Buffer.from("sk-adoption-stored-only", "ascii");
    const adoptModelCatalog = vi
      .fn<(input: AdoptProviderModelCatalogOptions) => Promise<unknown>>()
      .mockResolvedValue({
        provider: {
          id: id(1),
          displayName: "OpenAI images",
          preset: "openai",
          baseUrl: "https://api.openai.com/v1",
          modelKeys: ["gpt-image-1"],
          modelCatalog: {
            revision: 2,
            activatedRevision: 2,
            discoveredAt: new Date(observedAt),
            sourceDigest: digest("a"),
            discoveryMethod: "openai.models+adapter-manifest",
            changesPendingReview: false,
          },
          lifecycle: "active",
          validation: "passed",
          secretConfigured: true,
          canRefreshModelCatalog: true,
          version: 5,
          createdAt: new Date(observedAt),
          updatedAt: new Date(observedAt),
        },
        result: "adopted",
        adoptedRevision: 2,
      });
    const scope = {
      workspaceId: id(2),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human" as const,
      authenticationRefType: "session" as const,
      authenticationRefId: "session-redacted",
      authorityType: "human_membership" as const,
      authorityId: id(4),
      authorityVersion: 1,
    };
    const controller = new WorkspaceProviderSettingsController(
      { instanceId: "test" } as never,
      {
        providerSettings: {
          resolveModelCatalogAdoptionIdentity: vi.fn().mockResolvedValue({
            preset: "openai",
            baseUrl: "https://api.openai.com/v1",
            modelKeys: ["gpt-image-1"],
            currentRevision: 2,
            activatedRevision: 1,
            currentSourceDigest: digest("a"),
            currentRuntimeDigest: runtimeDigest,
            secret: {
              id: id(5),
              workspaceId: scope.workspaceId,
              credentialId: id(6),
              version: 1,
              materialGeneration: 3,
              sourceKind: "encrypted_database",
              lifecycleStatus: "active",
              aadDigest: digest("c"),
              materialFingerprint: digest("d"),
              formatVersion: 1,
              drainDeadlineAt: null,
              envelope: {},
            },
          }),
          adoptModelCatalog,
        },
      } as never,
      { readiness: () => ({ ready: true }) } as never,
      {
        async withResolvedMaterial<TResult>(
          _metadata: unknown,
          use: (value: Uint8Array) => Promise<TResult>,
        ): Promise<TResult> {
          try {
            return await use(material);
          } finally {
            material.fill(0);
          }
        },
      },
      { require: () => ({ scope }) } as never,
    );

    const result = await controller.adoptModelCatalog(
      { id: "request-model-catalog-adoption" } as never,
      id(1),
      "adoption-idempotency-key",
      {
        expectedVersion: 4,
        currentRevision: 2,
        activatedRevision: 1,
      },
    );

    expect(result).toMatchObject({
      result: "adopted",
      adoptedRevision: 2,
      provider: {
        modelCatalog: {
          revision: 2,
          activatedRevision: 2,
          changesPendingReview: false,
        },
      },
    });
    expect(providerMocks.discover).toHaveBeenCalledOnce();
    const probeInput = providerMocks.probe.mock.calls[0]?.[0];
    expect(probeInput).toMatchObject({
      modelKeys: ["gpt-image-1"],
    });
    expect(probeInput?.apiKey).toBeInstanceOf(Uint8Array);
    const persisted = adoptModelCatalog.mock.calls[0]?.[0];
    if (!persisted) {
      throw new TypeError("Expected model catalog adoption options.");
    }
    expect(persisted).toMatchObject({
      expectedVersion: 4,
      expectedCurrentRevision: 2,
      expectedActivatedRevision: 1,
      rediscoveredSourceDigest: digest("a"),
      rediscoveredRuntimeDigest: runtimeDigest,
      expectedActiveSecretVersionId: id(5),
      expectedSecretMaterialGeneration: 3,
    });
    expect(persisted.resources.models).toHaveLength(32);
    expect([...material]).toEqual(
      Array.from({ length: material.byteLength }, () => 0),
    );
    expect(JSON.stringify(result)).not.toContain("sk-adoption-stored-only");
  });
});
