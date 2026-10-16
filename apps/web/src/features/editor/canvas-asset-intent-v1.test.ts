import { describe, expect, it } from "vitest";

import { createEditorRuntimeNodeV1 } from "./editor-node-factory-v1.js";
import { canvasAssetInsertionTargetV1 } from "./canvas-asset-intent-v1.js";

const pageId = "page-1";
const image = createEditorRuntimeNodeV1(
  {
    intrinsicSize: { height: 100, width: 100 },
    kind: "image",
    source: {
      kind: "artifact",
      reference: { artifactId: "artifact-1", kind: "artifact" },
    },
  },
  "image-1",
  { height: 100, width: 100, x: 0, y: 0 },
);

describe("canvasAssetInsertionTargetV1", () => {
  it("keeps add as a normal board insertion", () => {
    expect(
      canvasAssetInsertionTargetV1({ intent: "add", pageId }),
    ).toBeUndefined();
  });

  it("projects replace and background into explicit insertion targets", () => {
    expect(
      canvasAssetInsertionTargetV1({
        intent: "replace",
        pageId,
        selectedNode: image,
      }),
    ).toEqual({ kind: "replace_node_content", nodeId: image.id, pageId });
    expect(
      canvasAssetInsertionTargetV1({ intent: "background", pageId }),
    ).toEqual({
      kind: "page_background",
      pageId,
    });
  });

  it("projects a chosen grid cell and rejects a stale fill intent", () => {
    expect(
      canvasAssetInsertionTargetV1({
        intent: "fill",
        mediaTarget: { kind: "grid", nodeId: "grid-1", slotId: "slot-2" },
        pageId,
      }),
    ).toEqual({
      gridId: "grid-1",
      kind: "grid_cell",
      pageId,
      slotId: "slot-2",
    });
    expect(() =>
      canvasAssetInsertionTargetV1({
        intent: "fill",
        pageId,
        selectedNode: image,
      }),
    ).toThrow("requires an unlocked frame or grid cell");
  });
});
