import { describe, expect, it } from "vitest";

import {
  addRecentCanvasFontV1,
  readRecentCanvasFontsV1,
  saveRecentCanvasFontsV1,
} from "./canvas-font-history-v1.js";
import { createEditorRuntimeNodeV1 } from "./editor-node-factory-v1.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";
import {
  canvasDocumentTextStylesV1,
  canvasTextStyleSnapshotV1,
} from "./canvas-text-style-v1.js";

const rect = {
  x: 80,
  y: 120,
  width: 520,
  height: 160,
};

describe("Canvas document text styles V1", () => {
  it("reuses a document style without copying its text content", () => {
    const source = createEditorRuntimeNodeV1(
      { kind: "text", text: "Source" },
      "text-source",
      rect,
    );
    if (source.kind !== "text") throw new Error("Expected text node.");
    const snapshot = canvasTextStyleSnapshotV1(source);
    const inserted = createEditorRuntimeNodeV1(
      { kind: "text", text: "New content", style: snapshot },
      "text-new",
      rect,
    );

    expect(inserted).toMatchObject({
      kind: "text",
      effects: source.effects,
      content: {
        paragraphs: [
          {
            runs: [
              {
                text: "New content",
                font: snapshot.font,
                fontSize: snapshot.fontSize,
                fontWeight: snapshot.fontWeight,
              },
            ],
          },
        ],
      },
    });
  });

  it("deduplicates styles from the current document and keeps newest first", () => {
    const first = createEditorRuntimeNodeV1(
      { kind: "text", text: "First" },
      "text-first",
      rect,
    );
    const second = createEditorRuntimeNodeV1(
      { kind: "text", text: "Second" },
      "text-second",
      rect,
    );
    const page = {
      id: "page-1",
      name: "Page 1",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" },
      nodes: [first, second],
    } as const satisfies EditorRuntimePageV1;

    expect(canvasDocumentTextStylesV1(page)).toHaveLength(1);
    expect(canvasDocumentTextStylesV1(page)[0]?.id).toContain("text-second");
  });

  it("stores a bounded most-recent font order without blocking on storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const recent = addRecentCanvasFontV1(["inter", "oswald"], "oswald");
    expect(recent).toEqual(["oswald", "inter"]);
    saveRecentCanvasFontsV1("workspace-1", recent, storage);
    expect(readRecentCanvasFontsV1("workspace-1", storage)).toEqual(recent);
  });
});
