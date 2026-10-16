import { describe, expect, it } from "vitest";

import {
  editorNodeDefinition,
  editorNodeDefinitions,
  editorNodeKinds,
  editorNodeSupportsCommand,
} from "./editor-node-model.js";

describe("Canvas Core V1 node model", () => {
  it("defines every durable V1 node kind exactly once", () => {
    expect(Object.keys(editorNodeDefinitions).sort()).toEqual(
      [...editorNodeKinds].sort(),
    );
  });

  it("gives every node the common direct-manipulation contract", () => {
    for (const kind of editorNodeKinds) {
      expect(editorNodeDefinition(kind).commands).toEqual(
        expect.arrayContaining([
          "select",
          "move",
          "resize",
          "rotate",
          "copy",
          "duplicate",
          "delete",
          "layer",
          "visibility",
          "lock",
          "rename",
        ]),
      );
    }
  });

  it("keeps type-specific edit semantics out of unrelated nodes", () => {
    expect(editorNodeSupportsCommand("image", "crop")).toBe(true);
    expect(editorNodeSupportsCommand("text", "crop")).toBe(false);

    expect(editorNodeSupportsCommand("text", "text_effects")).toBe(true);
    expect(editorNodeSupportsCommand("shape", "text_effects")).toBe(false);

    expect(editorNodeSupportsCommand("shape", "edit_shape_parameters")).toBe(
      true,
    );
    expect(editorNodeSupportsCommand("line", "edit_line_path")).toBe(true);
  });

  it("creates groups from selection rather than exposing an empty group picker item", () => {
    expect(editorNodeDefinition("group").addable).toBe(false);
    expect(editorNodeSupportsCommand("group", "ungroup")).toBe(true);
  });

  it("models source as creation metadata instead of new node kinds", () => {
    expect(editorNodeDefinition("image").creationSources).toEqual(
      expect.arrayContaining([
        "local_file",
        "clipboard",
        "artifact",
        "brand",
        "generated_result",
      ]),
    );
    expect(editorNodeKinds).not.toContain("local_image");
    expect(editorNodeKinds).not.toContain("generated_image");
  });
});
