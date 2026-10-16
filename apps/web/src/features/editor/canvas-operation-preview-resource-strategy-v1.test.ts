import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Canvas operation preview resource strategy", () => {
  it("loads bounded review previews and reuses the authorized original on apply", () => {
    const previewHookSource = readFileSync(
      new URL(
        "./use-canvas-operation-preview-resources-v1.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const applicationSource = readFileSync(
      new URL(
        "./canvas-operation-application-controller-v1.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(previewHookSource).toContain("downloadArtifactPreview(");
    expect(previewHookSource).not.toContain("downloadArtifact(");
    expect(previewHookSource).toContain('sourceQuality: "preview"');
    expect(applicationSource).toContain(
      "const originalUrl = URL.createObjectURL(reauthorizedArtifact)",
    );
    expect(applicationSource).toContain('sourceQuality: "original"');
  });
});
