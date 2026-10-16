import { describe, expect, it, vi } from "vitest";

import { loadCanvasArtifactResourcesV1 } from "./canvas-artifact-resource-loader-v1.js";
import type { EditorArtifactRuntimeResourceV1 } from "./editor-document-v1.js";

describe("loadCanvasArtifactResourcesV1", () => {
  it("deduplicates artifacts, limits concurrency and publishes each result immediately", async () => {
    const controller = new AbortController();
    let active = 0;
    let maximumActive = 0;
    const resources: string[] = [];
    await loadCanvasArtifactResourcesV1({
      artifactIds: ["a", "b", "a", "c"],
      concurrency: 2,
      onResource: (resource) => resources.push(resource.artifactId),
      resolveArtifactSource: async (artifactId) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return `blob:${artifactId}`;
      },
      signal: controller.signal,
    });

    expect(maximumActive).toBe(2);
    expect(resources).toEqual(["a", "b", "c"]);
  });

  it("reports one unavailable resource without blocking the remaining queue", async () => {
    const controller = new AbortController();
    const onResource =
      vi.fn<(resource: EditorArtifactRuntimeResourceV1) => void>();
    await loadCanvasArtifactResourcesV1({
      artifactIds: ["ok", "failed", "later"],
      concurrency: 1,
      onResource,
      resolveArtifactSource: async (artifactId) => {
        await Promise.resolve();
        if (artifactId === "failed") throw new Error("download failed");
        return `blob:${artifactId}`;
      },
      signal: controller.signal,
    });

    expect(onResource.mock.calls.map(([resource]) => resource)).toEqual([
      { artifactId: "ok", sourceUnavailable: false, sourceUrl: "blob:ok" },
      { artifactId: "failed", sourceUnavailable: true },
      {
        artifactId: "later",
        sourceUnavailable: false,
        sourceUrl: "blob:later",
      },
    ]);
  });

  it("publishes cached previews before upgrading resources to originals", async () => {
    const controller = new AbortController();
    const resources: EditorArtifactRuntimeResourceV1[] = [];
    await loadCanvasArtifactResourcesV1({
      artifactIds: ["a", "b"],
      concurrency: 2,
      onResource: (resource) => resources.push(resource),
      resolveArtifactPreview: (artifactId) =>
        Promise.resolve(`preview:${artifactId}`),
      resolveArtifactSource: (artifactId) =>
        Promise.resolve(`original:${artifactId}`),
      signal: controller.signal,
    });

    expect(resources).toHaveLength(4);
    for (const artifactId of ["a", "b"]) {
      const previewIndex = resources.findIndex(
        (resource) =>
          resource.artifactId === artifactId &&
          resource.sourceQuality === "preview",
      );
      const originalIndex = resources.findIndex(
        (resource) =>
          resource.artifactId === artifactId &&
          resource.sourceQuality === "original",
      );
      expect(previewIndex).toBeGreaterThanOrEqual(0);
      expect(originalIndex).toBeGreaterThan(previewIndex);
    }
  });

  it("does not let one slow preview block another artifact from upgrading", async () => {
    const controller = new AbortController();
    const resources: EditorArtifactRuntimeResourceV1[] = [];
    let releaseSlowPreview: ((value: string) => void) | undefined;
    const slowPreview = new Promise<string>((resolve) => {
      releaseSlowPreview = resolve;
    });
    const loading = loadCanvasArtifactResourcesV1({
      artifactIds: ["slow", "ready"],
      concurrency: 2,
      onResource: (resource) => resources.push(resource),
      resolveArtifactPreview: (artifactId) =>
        artifactId === "slow" ? slowPreview : Promise.resolve("preview:ready"),
      resolveArtifactSource: (artifactId) =>
        Promise.resolve(`original:${artifactId}`),
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(resources).toContainEqual(
        expect.objectContaining({
          artifactId: "ready",
          sourceQuality: "original",
        }),
      );
    });
    expect(resources).not.toContainEqual(
      expect.objectContaining({
        artifactId: "slow",
        sourceQuality: "preview",
      }),
    );

    releaseSlowPreview?.("preview:slow");
    await loading;
  });

  it("supports preview-only background prefetching", async () => {
    const controller = new AbortController();
    const resources: EditorArtifactRuntimeResourceV1[] = [];
    await loadCanvasArtifactResourcesV1({
      artifactIds: ["background"],
      onResource: (resource) => resources.push(resource),
      resolveArtifactPreview: () => Promise.resolve("preview:background"),
      signal: controller.signal,
    });

    expect(resources).toEqual([
      {
        artifactId: "background",
        sourceQuality: "preview",
        sourceUnavailable: false,
        sourceUrl: "preview:background",
      },
    ]);
  });

  it("stops publishing after cancellation", async () => {
    const controller = new AbortController();
    const onResource =
      vi.fn<(resource: EditorArtifactRuntimeResourceV1) => void>();
    await loadCanvasArtifactResourcesV1({
      artifactIds: ["first", "second"],
      concurrency: 1,
      onResource,
      resolveArtifactSource: async (artifactId) => {
        await Promise.resolve();
        controller.abort();
        return `blob:${artifactId}`;
      },
      signal: controller.signal,
    });

    expect(onResource).not.toHaveBeenCalled();
  });
});
