import type {
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
} from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { browserImageAdjustmentRuntimeConfig } from "./browser-image-adjustment-runtime.js";
import {
  denoiseBrowserPixels,
  enhanceBrowserLightPixels,
} from "./browser-image-adjustments.js";

function runtimeCapability(
  overrides: Partial<BrowserRuntimeCapability>,
): BrowserRuntimeCapability {
  return {
    capabilityKey: "image.denoise",
    implementationRevisionId: "01K00000000000000000000001",
    implementationDigest: `sha256:${"a".repeat(64)}`,
    runtimeAdapterRevisionId: "01K00000000000000000000002",
    runtimeAdapterRevisionDigest: `sha256:${"b".repeat(64)}`,
    adapterKey: "browser.image.denoise.median-blend.v1",
    runtimeRole: "image_denoise",
    runtimeProfileKind: "browser.image-adjustment.v1",
    runtimeProfileVersion: 1,
    runtimeProfileSettings: {
      backend: "javascript",
      role: "image_denoise",
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

describe("Browser image adjustments", () => {
  it("preserves alpha while applying deterministic denoise", () => {
    const source = new Uint8ClampedArray([
      30, 30, 30, 255, 30, 30, 30, 128, 30, 30, 30, 255, 30, 30, 30, 255, 255,
      255, 255, 64, 30, 30, 30, 255, 30, 30, 30, 255, 30, 30, 30, 0, 30, 30, 30,
      255,
    ]);
    const result = denoiseBrowserPixels({
      pixels: source,
      width: 3,
      height: 3,
      strength: 1,
    });

    expect([...result.pixels.subarray(16, 19)]).toEqual([30, 30, 30]);
    expect([...result.pixels].filter((_, index) => index % 4 === 3)).toEqual(
      [...source].filter((_, index) => index % 4 === 3),
    );
    expect(result.noiseEstimate).toBeGreaterThan(0);
  });

  it("leaves transparent RGBA untouched during light enhancement", () => {
    const source = new Uint8ClampedArray([40, 50, 60, 255, 7, 8, 9, 0]);
    const result = enhanceBrowserLightPixels({
      pixels: source,
      width: 2,
      height: 1,
      parameters: {
        exposureStops: 1,
        shadows: 0.25,
        highlights: -0.1,
        temperature: 0.2,
        tint: -0.1,
      },
    });

    expect(result.pixels[0]).toBeGreaterThan(40);
    expect([...result.pixels.subarray(4, 8)]).toEqual([7, 8, 9, 0]);
  });

  it("selects current published revisions from the runtime manifest", () => {
    const denoise = runtimeCapability({});
    const lightEnhance = runtimeCapability({
      capabilityKey: "image.light-enhance",
      implementationRevisionId: "01K00000000000000000000004",
      adapterKey: "browser.image.light-enhance.deterministic.v1",
      runtimeRole: "light_enhance",
      runtimeProfileSettings: {
        backend: "javascript",
        role: "light_enhance",
      },
    });
    const manifest = runtimeManifest([denoise, lightEnhance]);

    expect(
      browserImageAdjustmentRuntimeConfig(manifest, ["image.denoise"]),
    ).toEqual({
      runtimeReleaseId: manifest.runtimeReleaseId,
      runtimeReleaseDigest: manifest.runtimeReleaseDigest,
      capabilities: [denoise],
    });
    expect(() =>
      browserImageAdjustmentRuntimeConfig(
        runtimeManifest([
          runtimeCapability({ runtimeRole: "unknown_runtime" }),
        ]),
      ),
    ).toThrow(/manifest is invalid/u);
  });
});
