import { describe, expect, it } from "vitest";

import { loadArtifactPreviewConfig } from "../src/artifact-preview-config.js";

describe("Artifact preview configuration", () => {
  it("uses normal preview defaults for blank optional tuning", () => {
    expect(
      loadArtifactPreviewConfig({
        KANVAS_ARTIFACT_PREVIEW_WIDTH: "",
        KANVAS_ARTIFACT_PREVIEW_QUALITY: " ",
        KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS: " ",
      }),
    ).toEqual(loadArtifactPreviewConfig({}));
  });

  it("defaults to backward-compatible on-demand generation", () => {
    expect(loadArtifactPreviewConfig({})).toMatchObject({
      mode: "on_demand",
      fallbackOnMiss: true,
      width: 640,
      height: 640,
      quality: 80,
      effort: 4,
      workerConcurrency: 2,
      generationAttempts: 3,
      generationRetryMs: 5_000,
      variantKey: "interactive-preview",
    });
  });

  it("admits an asynchronous persisted strategy with bounded tuning", () => {
    const config = loadArtifactPreviewConfig({
      KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
      KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS: "false",
      KANVAS_ARTIFACT_PREVIEW_WIDTH: "512",
      KANVAS_ARTIFACT_PREVIEW_HEIGHT: "384",
      KANVAS_ARTIFACT_PREVIEW_QUALITY: "76",
      KANVAS_ARTIFACT_PREVIEW_EFFORT: "3",
      KANVAS_ARTIFACT_PREVIEW_WORKER_CONCURRENCY: "1",
    });

    expect(config).toMatchObject({
      mode: "async_persisted",
      fallbackOnMiss: false,
      width: 512,
      height: 384,
      quality: 76,
      effort: 3,
      workerConcurrency: 1,
    });
    expect(config.profileVersion).toMatch(
      /^artifact-preview-webp-v1:[0-9a-f]{64}$/u,
    );
  });

  it("rejects unsupported modes and unsafe tuning", () => {
    expect(() =>
      loadArtifactPreviewConfig({ KANVAS_ARTIFACT_PREVIEW_MODE: "eager" }),
    ).toThrow(/KANVAS_ARTIFACT_PREVIEW_MODE/u);
    expect(() =>
      loadArtifactPreviewConfig({ KANVAS_ARTIFACT_PREVIEW_WIDTH: "99999" }),
    ).toThrow(/KANVAS_ARTIFACT_PREVIEW_WIDTH/u);
  });
});
