import type { ModelReferenceDocumentV1 } from "@kanvas/contracts/model-reference";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  loadLatestModelReference,
  refreshModelReference,
  resolveModelReferenceDefaults,
} from "../src/model-reference-sync.js";

const baseModel = {
  upstreamModelId: "doubao-seed-2-0-pro",
  displayName: "Doubao Seed 2.0 Pro",
  description: "Multimodal reasoning model",
  family: "seed",
  modalities: {
    input: ["text", "image", "video"] as const,
    output: ["text"] as const,
  },
  limit: { context: 256_000, output: 128_000 },
  cost: { input: 0.48, output: 2.41, cacheRead: 0.09644 },
};

function document(
  providers: ModelReferenceDocumentV1["providers"],
): ModelReferenceDocumentV1 {
  return {
    schemaVersion: 1,
    source: "models.dev",
    sourceRevision: "models.dev:test",
    observedAt: "2026-09-03T00:00:00.000Z",
    canonicalModels: [],
    providers,
  };
}

describe("model reference sync", () => {
  it("resolves Provider-only defaults without a canonicalModelKey", () => {
    const result = resolveModelReferenceDefaults({
      document: document([
        {
          slug: "aihubmix",
          displayName: "AIHubMix",
          documentationUrl: "https://example.com",
          models: [baseModel],
        },
      ]),
      canonicalReference: "doubao-seed-2-0-pro",
      upstreamModelId: "doubao-seed-2-0-pro",
      providerPreset: "tokenhub",
    });

    expect(result).toMatchObject({
      status: "resolved",
      metadataSource: "provider:aihubmix",
      pricingSource: "provider:aihubmix",
      defaults: {
        contextWindow: 256_000,
        maximumOutputTokens: 128_000,
        cost: { input: 0.48, output: 2.41, cacheRead: 0.09644 },
      },
    });
  });

  it("does not choose one conflicting Provider price", () => {
    const result = resolveModelReferenceDefaults({
      document: document([
        {
          slug: "first",
          displayName: "First",
          documentationUrl: "https://example.com/first",
          models: [baseModel],
        },
        {
          slug: "second",
          displayName: "Second",
          documentationUrl: "https://example.com/second",
          models: [{ ...baseModel, cost: { input: 1, output: 3 } }],
        },
      ]),
      canonicalReference: "doubao-seed-2-0-pro",
      upstreamModelId: "doubao-seed-2-0-pro",
      providerPreset: "tokenhub",
    });

    expect(result.status).toBe("partial");
    expect(result.warnings).toContain("pricing_conflict");
    expect(result.defaults).not.toHaveProperty("cost");
    expect(result.defaults).toMatchObject({ contextWindow: 256_000 });
  });

  it("resolves bare upstream identity through explicit canonical links despite provider metadata differences", () => {
    const source = document([
      {
        slug: "first",
        displayName: "First",
        documentationUrl: "https://example.com",
        models: [
          { ...baseModel, canonicalModelKey: "vendor/doubao-seed-2-0-pro" },
        ],
      },
      {
        slug: "second",
        displayName: "Second",
        documentationUrl: "https://example.com",
        models: [
          {
            ...baseModel,
            displayName: "Different label",
            limit: { context: 128000, output: 8192 },
            cost: { input: 1, output: 3 },
          },
        ],
      },
    ]);
    const result = resolveModelReferenceDefaults({
      document: {
        ...source,
        canonicalModels: [
          {
            key: "vendor/doubao-seed-2-0-pro",
            displayName: "Canonical model",
            description: "Canonical reference model",
            toolCall: true,
            limit: { context: 1000000, output: 384000 },
          },
        ],
      },
      canonicalReference: baseModel.upstreamModelId,
      upstreamModelId: baseModel.upstreamModelId,
      providerPreset: "tokenhub",
    });
    expect(result.defaults).toMatchObject({
      contextWindow: 1000000,
      maximumOutputTokens: 384000,
      toolCall: true,
    });
    expect(result.metadataSource).toBe("canonical:vendor/doubao-seed-2-0-pro");
    expect(result.warnings).toContain("pricing_conflict");
  });

  it("preserves consensus fields when unrelated metadata conflicts", () => {
    const result = resolveModelReferenceDefaults({
      document: document([
        {
          slug: "first",
          displayName: "First",
          documentationUrl: "https://example.com",
          models: [{ ...baseModel, toolCall: true }],
        },
        {
          slug: "second",
          displayName: "Second",
          documentationUrl: "https://example.com",
          models: [
            { ...baseModel, displayName: "Different label", toolCall: true },
          ],
        },
      ]),
      canonicalReference: baseModel.upstreamModelId,
      upstreamModelId: baseModel.upstreamModelId,
      providerPreset: "tokenhub",
    });
    expect(result.defaults).toMatchObject({
      contextWindow: 256000,
      maximumOutputTokens: 128000,
      toolCall: true,
    });
    expect(result.defaults).not.toHaveProperty("displayName");
    expect(result.warnings).toContain("metadata_conflict");
  });

  it("uses an exact unique canonical short ID without a first-party Provider entry, but never an ambiguous one", () => {
    const reference = {
      key: "vendor/doubao-seed-2-0-pro",
      displayName: "Canonical",
      description: "Model",
      toolCall: true,
      limit: { context: 1000000, output: 384000 },
    };
    const options = {
      canonicalReference: baseModel.upstreamModelId,
      upstreamModelId: baseModel.upstreamModelId,
      providerPreset: "tokenhub" as const,
    };
    expect(
      resolveModelReferenceDefaults({
        ...options,
        document: { ...document([]), canonicalModels: [reference] },
      }).defaults,
    ).toMatchObject({ contextWindow: 1000000, toolCall: true });
    expect(
      resolveModelReferenceDefaults({
        ...options,
        document: {
          ...document([]),
          canonicalModels: [
            reference,
            { ...reference, key: "other/doubao-seed-2-0-pro" },
          ],
        },
      }).status,
    ).toBe("not_found");
  });

  it("uses the last good snapshot when models.dev is temporarily unavailable", async () => {
    const snapshot = {
      id: "01K00000000000000000000001",
      revision: 1,
      sourceRevision: "models.dev:test",
      sourceDigest: `sha256:${"1".repeat(64)}`,
      fetchedAt: new Date("2026-09-02T00:00:00.000Z"),
      publishedAt: new Date("2026-09-02T00:00:00.000Z"),
      document: document([]),
    };
    const result = await loadLatestModelReference({
      store: {
        getCurrent: () => Promise.resolve(snapshot),
        publish: () => Promise.resolve({ snapshot, replayed: false }),
      },
      actorPrincipalId: "01K00000000000000000000002",
      now: new Date("2026-09-03T00:00:00.000Z"),
      requester: () => Promise.reject(new Error("offline")),
    });

    expect(result).toEqual({ snapshot, stale: true });
  });

  it("bypasses a fresh snapshot for an explicit latest-data request", async () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const snapshot = {
      id: "01K00000000000000000000001",
      revision: 1,
      sourceRevision: "models.dev:cached",
      sourceDigest: `sha256:${"1".repeat(64)}`,
      fetchedAt: now,
      publishedAt: now,
      document: document([]),
    };
    const requester = vi.fn(() => Promise.resolve(new Response("{}")));
    await loadLatestModelReference({
      store: {
        getCurrent: () => Promise.resolve(snapshot),
        publish: () => Promise.resolve({ snapshot, replayed: false }),
      },
      actorPrincipalId: "01K00000000000000000000002",
      now,
      requester,
      force: true,
    });
    expect(requester).toHaveBeenCalledTimes(2);
  });

  it("replays an unchanged models.dev source revision", async () => {
    const rawDigest = createHash("sha256")
      .update("{}")
      .update("\0")
      .update("{}")
      .digest("hex");
    const snapshot = {
      id: "01K00000000000000000000001",
      revision: 1,
      sourceRevision: `models.dev:${rawDigest}`,
      sourceDigest: `sha256:${"1".repeat(64)}`,
      fetchedAt: new Date("2026-09-02T00:00:00.000Z"),
      publishedAt: new Date("2026-09-02T00:00:00.000Z"),
      document: document([]),
    };
    const publish = vi.fn();

    await expect(
      refreshModelReference({
        store: {
          getCurrent: () => Promise.resolve(snapshot),
          publish,
        },
        actorPrincipalId: "01K00000000000000000000002",
        now: new Date("2026-09-03T00:00:00.000Z"),
        requester: () => Promise.resolve(new Response("{}")),
      }),
    ).resolves.toBe(snapshot);
    expect(publish).not.toHaveBeenCalled();
  });
});
