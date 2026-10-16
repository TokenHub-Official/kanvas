import { describe, expect, it } from "vitest";

import {
  createEditorDocumentV1,
  editorPagePresetsV1,
} from "./editor-document-factory-v1.js";

describe("Canvas Core V1 document factory", () => {
  it("creates a contract-shaped white artboard", () => {
    const document = createEditorDocumentV1("01K00000000000000000000000");

    expect(document.schemaVersion).toBe("kanvas.editor-document/v1");
    expect(document.pages[0]).toMatchObject({
      width: 1080,
      height: 1080,
      background: {
        kind: "paint",
        paint: {
          kind: "solid",
          color: "#ffffff",
        },
      },
    });
  });

  it("provides only neutral format presets, not business scenarios", () => {
    expect(editorPagePresetsV1.map((preset) => preset.id)).toEqual([
      "square",
      "portrait",
      "story",
      "landscape",
      "document",
    ]);
    expect(
      editorPagePresetsV1.map((preset) => preset.label).join(" "),
    ).not.toMatch(/海报|电商|广告|社媒/);
  });
});
