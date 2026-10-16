import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  artifactPreviewAccessibilityV1,
  artifactPreviewClassNameV1,
  type ArtifactPreviewVisualState,
  ArtifactPreview,
} from "./artifact-preview.js";

describe("ArtifactPreview recovery", () => {
  it("offers an opt-in accessible reload action without nesting it in an image role", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await client
      .fetchQuery({
        queryKey: ["artifacts", "workspace", "artifact", "content"],
        queryFn: () =>
          Promise.reject(new Error("Temporary connection failure")),
      })
      .catch(() => undefined);
    const render = (retryLabel?: string) =>
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ArtifactPreview, {
            alt: "Poster",
            artifactId: "artifact",
            workspaceId: "workspace",
            unavailableLabel: "Preview unavailable",
            ...(retryLabel ? { retryLabel } : {}),
          }),
        ),
      );
    expect(render()).not.toContain("<button");
    const markup = render("Reload preview");
    expect(markup).toContain("<button");
    expect(markup).toContain("Reload preview");
    expect(markup.slice(0, markup.indexOf(">"))).not.toContain('role="img"');
    client.clear();
  });
});

describe("ArtifactPreview stable media slot", () => {
  it("keeps the consumer slot class in every visual state", () => {
    const states = [
      "placeholder",
      "loading",
      "error",
      "image",
    ] as const satisfies readonly ArtifactPreviewVisualState[];

    for (const state of states) {
      expect(
        artifactPreviewClassNameV1(
          state,
          "asset-picker-thumbnail",
          "asset-visual-state",
        ).split(" "),
      ).toContain("asset-picker-thumbnail");
    }
  });

  it("adds state chrome only before the final image is available", () => {
    expect(
      artifactPreviewClassNameV1("placeholder", "slot", "state-shell"),
    ).toContain("artifact-image-state artifact-image-placeholder");
    expect(
      artifactPreviewClassNameV1("loading", "slot", "state-shell"),
    ).toContain("artifact-image-state artifact-image-loading");
    expect(
      artifactPreviewClassNameV1("error", "slot", "state-shell"),
    ).toContain("artifact-image-state artifact-image-error");
    expect(artifactPreviewClassNameV1("image", "slot", "state-shell")).toBe(
      "slot",
    );
  });
});

describe("ArtifactPreview accessibility", () => {
  it("keeps decorative repeated thumbnails hidden in every transient state", () => {
    for (const state of ["placeholder", "loading", "error"] as const) {
      expect(artifactPreviewAccessibilityV1(state, "")).toEqual({
        "aria-hidden": true,
      });
    }
  });

  it("exposes named loading and error states as stable images, not live regions", () => {
    expect(
      artifactPreviewAccessibilityV1("loading", "春季海报 当前版本"),
    ).toEqual({
      "aria-label": "春季海报 当前版本，正在载入",
      role: "img",
    });
    expect(
      artifactPreviewAccessibilityV1("error", "春季海报 当前版本"),
    ).toEqual({
      "aria-label": "春季海报 当前版本，暂时无法预览",
      role: "img",
    });
  });
});
