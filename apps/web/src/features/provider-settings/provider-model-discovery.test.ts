import type { ProviderModelDiscoveryResult } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  discoveredImageCapabilities,
  initialProviderModelDiscoveryDraftState,
  providerModelDiscoveryOptions,
  reduceProviderModelDiscoveryDraft,
  selectableProviderModelCount,
  selectedProviderModelKeys,
} from "./provider-model-discovery.js";

const evidence = [
  {
    kind: "adapter_manifest" as const,
    reference: "kanvas.image-provider.test.v1",
    observedAt: "2026-08-12T07:00:00.000Z",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    confidence: "high" as const,
    claim: "supported" as const,
  },
];
const identityEvidence = [
  {
    ...evidence[0]!,
    claim: "identity" as const,
  },
];

const discovery: ProviderModelDiscoveryResult = {
  schemaVersion: 1,
  providerPreset: "openrouter",
  discoveryMethod: "openrouter.images.models",
  sourceDigest: `sha256:${"b".repeat(64)}`,
  discoveredAt: "2026-08-12T07:00:00.000Z",
  models: [
    {
      providerModelId: "image-generate",
      displayName: "Image Generate",
      inputModalities: ["text"],
      outputModalities: ["image"],
      operations: {
        "image.generate": {
          apiSurfaces: ["images.generations.v1"],
          parameters: [],
          evidence,
        },
      },
      completeness: "partial",
      evidence: identityEvidence,
    },
    {
      providerModelId: "image-edit",
      displayName: "Image Edit",
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
      operations: {
        "image.edit": {
          apiSurfaces: ["images.edits.v1"],
          parameters: [],
          evidence,
        },
      },
      completeness: "complete",
      evidence: identityEvidence,
    },
    {
      providerModelId: "unknown-model",
      displayName: "Unknown Model",
      inputModalities: [],
      outputModalities: [],
      operations: {},
      completeness: "identity_only",
      evidence: identityEvidence,
    },
  ],
};

describe("Provider model discovery selection", () => {
  it("derives image capabilities per operation", () => {
    expect(discoveredImageCapabilities(discovery.models[0]!)).toEqual([
      "image.generate",
    ]);
    expect(discoveredImageCapabilities(discovery.models[1]!)).toEqual([
      "image.edit",
    ]);
    expect(discoveredImageCapabilities(discovery.models[2]!)).toEqual([]);
  });

  it("keeps identity-only models visible but disabled", () => {
    expect(providerModelDiscoveryOptions(discovery)).toEqual([
      {
        providerModelId: "image-generate",
        displayName: "Image Generate",
        capabilities: ["image.generate"],
        disabled: false,
      },
      {
        providerModelId: "image-edit",
        displayName: "Image Edit",
        capabilities: ["image.edit"],
        disabled: false,
      },
      {
        providerModelId: "unknown-model",
        displayName: "Unknown Model",
        capabilities: [],
        disabled: true,
      },
    ]);
    expect(selectableProviderModelCount(discovery)).toBe(2);
  });

  it("submits only unique selectable discovered model IDs", () => {
    expect(
      selectedProviderModelKeys(discovery, [
        "image-edit",
        "unknown-model",
        "image-edit",
        "not-discovered",
        "image-generate",
      ]),
    ).toEqual(["image-edit", "image-generate"]);
  });

  it("invalidates discovery and selected models when connection inputs change", () => {
    const resolved = reduceProviderModelDiscoveryDraft(
      initialProviderModelDiscoveryDraftState(),
      {
        type: "resolved",
        revision: 0,
        discovery,
      },
    );
    const selected = reduceProviderModelDiscoveryDraft(resolved, {
      type: "select",
      modelKeys: ["image-generate"],
    });

    expect(
      reduceProviderModelDiscoveryDraft(selected, {
        type: "invalidate",
      }),
    ).toEqual({
      revision: 1,
      selectedModelKeys: [],
    });
  });

  it("ignores a discovery response from an invalidated draft", () => {
    const invalidated = reduceProviderModelDiscoveryDraft(
      initialProviderModelDiscoveryDraftState(),
      { type: "invalidate" },
    );

    expect(
      reduceProviderModelDiscoveryDraft(invalidated, {
        type: "resolved",
        revision: 0,
        discovery,
      }),
    ).toBe(invalidated);
  });

  it("gives each discovery request a new revision and ignores the older response", () => {
    const initial = initialProviderModelDiscoveryDraftState();
    const firstRequest = reduceProviderModelDiscoveryDraft(initial, {
      type: "begin",
    });
    const secondRequest = reduceProviderModelDiscoveryDraft(firstRequest, {
      type: "begin",
    });

    expect(firstRequest.revision).toBe(1);
    expect(secondRequest.revision).toBe(2);
    expect(
      reduceProviderModelDiscoveryDraft(secondRequest, {
        type: "resolved",
        revision: firstRequest.revision,
        discovery,
      }),
    ).toBe(secondRequest);
  });
});
