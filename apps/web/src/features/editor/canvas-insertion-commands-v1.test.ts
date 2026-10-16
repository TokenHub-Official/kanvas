import { describe, expect, it, vi } from "vitest";
import type { ResourceImageCandidate } from "@kanvas/contracts/resource-source";

import {
  canvasExternalImagePreviewInsertionV1,
  createCanvasInsertionCommandsV1,
} from "./canvas-insertion-commands-v1.js";
import { createEditorPageV1 } from "./editor-document-factory-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import type { EditorActionV1 } from "./editor-state-v1.js";

function createCommands() {
  const actions: EditorActionV1[] = [];
  const insertions: EditorNodeInsertionPayload[] = [];
  const beginTextEditing = vi.fn();
  const focusStage = vi.fn();
  const page = createEditorPageV1("page-1", "Page 1");
  const commands = createCanvasInsertionCommandsV1({
    beginTextEditing,
    focusStage,
    insert: (payload) => {
      insertions.push(payload);
      return `inserted-${String(insertions.length)}`;
    },
    mutate: (action) => {
      actions.push(action);
    },
    page,
    selectedNodes: [],
    t: ((key: string) => key) as never,
  });
  return {
    actions,
    beginTextEditing,
    commands,
    focusStage,
    insertions,
  };
}

describe("createCanvasInsertionCommandsV1", () => {
  it("creates an immediate external image preview with the original ratio", () => {
    const candidate = {
      kind: "image",
      title: "Portrait",
      preview: {
        url: "https://images.example/preview.jpg",
        mediaType: "image/jpeg",
        width: 300,
        height: 300,
      },
      original: {
        url: "https://images.example/original.jpg",
        mediaType: "image/jpeg",
        width: 1200,
        height: 1800,
      },
    } as ResourceImageCandidate;

    expect(
      canvasExternalImagePreviewInsertionV1(candidate, "local-1"),
    ).toMatchObject({
      kind: "image",
      intrinsicSize: { width: 1200, height: 1800 },
      source: {
        kind: "clipboard",
        localId: "local-1",
        previewUrl: candidate.preview.url,
      },
    });
  });

  it("inserts catalog nodes and restores stage focus", () => {
    const { commands, focusStage, insertions } = createCommands();

    commands.insertShape({
      catalogId: "builtin.shapes",
      definitionId: "rectangle",
      revision: "1",
    });

    expect(insertions).toEqual([
      {
        kind: "shape",
        definition: {
          catalogId: "builtin.shapes",
          definitionId: "rectangle",
          revision: "1",
        },
      },
    ]);
    expect(focusStage).toHaveBeenCalledOnce();
  });

  it("starts editing only for immediate text insertions", () => {
    const { beginTextEditing, commands } = createCommands();

    commands.insertText({ text: "Body" });
    commands.insertText({ editImmediately: true, text: "Heading" });

    expect(beginTextEditing).toHaveBeenCalledOnce();
    expect(beginTextEditing).toHaveBeenCalledWith("inserted-2", "Heading");
  });

  it("starts editing a newly inserted note", () => {
    const { beginTextEditing, commands, insertions } = createCommands();

    commands.insertNote("#fff36a");

    expect(insertions[0]).toEqual({
      kind: "note",
      color: "#fff36a",
      text: "canvas.editor.stickyText",
    });
    expect(beginTextEditing).toHaveBeenCalledWith(
      "inserted-1",
      "canvas.editor.stickyText",
    );
  });
});
