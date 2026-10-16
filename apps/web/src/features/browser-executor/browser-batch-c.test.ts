import type {
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
} from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { browserBatchCRuntimeConfig } from "./browser-batch-c-runtime.js";

function runtimeCapability(
  overrides: Partial<BrowserRuntimeCapability>,
): BrowserRuntimeCapability {
  return {
    capabilityKey: "image.crop.suggest",
    implementationRevisionId: "01K00000000000000000000001",
    implementationDigest: `sha256:${"a".repeat(64)}`,
    runtimeAdapterRevisionId: "01K00000000000000000000002",
    runtimeAdapterRevisionDigest: `sha256:${"b".repeat(64)}`,
    adapterKey: "browser.image.crop-suggest.deterministic.v1",
    runtimeRole: "crop_suggest",
    runtimeProfileKind: "browser.image-analysis.v1",
    runtimeProfileVersion: 1,
    runtimeProfileSettings: {
      backend: "javascript",
      role: "crop_suggest",
    },
    implementationConfiguration: {},
    backend: "javascript",
    probeProfileVersion: 1,
    probeResultDigest: `sha256:${"c".repeat(64)}`,
    ...overrides,
  };
}

function runtimeManifest(
  capabilities: readonly BrowserRuntimeCapability[],
): BrowserRuntimeManifest {
  return {
    schemaVersion: "kanvas.browser-runtime-manifest/v1",
    runtimeReleaseId: "01K00000000000000000000003",
    runtimeReleaseDigest: `sha256:${"d".repeat(64)}`,
    capabilities: [...capabilities],
  };
}

describe("Browser Batch C admission", () => {
  it("selects current published revisions from the runtime manifest", () => {
    const cropSuggest = runtimeCapability({});
    const backgroundCompose = runtimeCapability({
      capabilityKey: "image.background.compose",
      implementationRevisionId: "01K00000000000000000000004",
      adapterKey: "browser.image.background-compose.deterministic.v1",
      runtimeRole: "background_compose",
      runtimeProfileSettings: {
        backend: "javascript",
        role: "background_compose",
      },
    });
    const manifest = runtimeManifest([cropSuggest, backgroundCompose]);

    expect(
      browserBatchCRuntimeConfig(manifest, ["image.background.compose"]),
    ).toEqual({
      runtimeReleaseId: manifest.runtimeReleaseId,
      runtimeReleaseDigest: manifest.runtimeReleaseDigest,
      capabilities: [backgroundCompose],
    });
    expect(() =>
      browserBatchCRuntimeConfig(
        runtimeManifest([runtimeCapability({ runtimeProfileVersion: 2 })]),
      ),
    ).toThrow(/manifest is invalid/u);
  });
});
