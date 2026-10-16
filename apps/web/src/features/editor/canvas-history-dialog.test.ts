import type { CanvasDraftRevisionSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  canvasHistoryRevisionRelation,
  selectedCanvasHistoryRevision,
} from "./canvas-history-dialog.js";

function revision(version: number): CanvasDraftRevisionSummary {
  return {
    version,
    title: `版本 ${String(version)}`,
    contentDigest:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    kind: "save",
    createdByPrincipalId: "01K00000000000000000000000",
    createdAt: "2026-07-31T12:00:00.000Z",
  };
}

describe("Canvas history selection", () => {
  it("keeps revision previews page-scoped and thumbnail-backed", () => {
    const source = readFileSync(
      new URL("./canvas-history-dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("editorRuntimePageArtifactIdsV1");
    expect(source).toContain("artifactPreviewQueryOptionsV1");
    expect(source).not.toContain("hydrateEditorRuntimeDocumentV1");
    expect(source).not.toContain("downloadArtifact(");
  });

  it("selects the latest older revision when another window has already saved a newer one", () => {
    expect(
      selectedCanvasHistoryRevision(
        [revision(12), revision(11), revision(10)],
        undefined,
        11,
      ),
    ).toBe(10);
  });

  it("keeps an explicit retained selection and classifies its relation to the local version", () => {
    const items = [revision(12), revision(11), revision(10)];

    expect(selectedCanvasHistoryRevision(items, 12, 11)).toBe(12);
    expect(canvasHistoryRevisionRelation(12, 11)).toBe("newer");
    expect(canvasHistoryRevisionRelation(11, 11)).toBe("current");
    expect(canvasHistoryRevisionRelation(10, 11)).toBe("older");
  });
});
import { readFileSync } from "node:fs";
