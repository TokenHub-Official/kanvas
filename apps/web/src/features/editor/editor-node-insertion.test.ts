import { describe, expect, it } from "vitest";

import {
  adjacentInsertionRect,
  cascadeInsertionRects,
  centeredInsertionRect,
  durableImageInsertionReference,
  fitNodeSizeForInsertion,
  insertionCreatesTopLevelNode,
  insertionPayloadNodeKind,
  pointedInsertionRect,
} from "./editor-node-insertion.js";

describe("Canvas Core V1 node insertion", () => {
  const visiblePageRect = {
    x: 100,
    y: 200,
    width: 1_000,
    height: 800,
  };

  it("fits large images inside the visible page while preserving aspect ratio", () => {
    expect(
      fitNodeSizeForInsertion(
        {
          width: 4_000,
          height: 2_000,
        },
        visiblePageRect,
      ),
    ).toEqual({
      width: 620,
      height: 310,
    });
  });

  it("does not upscale a small source on initial insertion", () => {
    expect(
      fitNodeSizeForInsertion(
        {
          width: 120,
          height: 80,
        },
        visiblePageRect,
      ),
    ).toEqual({
      width: 120,
      height: 80,
    });
  });

  it("centers click-added content in the visible part of the page", () => {
    expect(
      centeredInsertionRect(
        {
          width: 400,
          height: 200,
        },
        visiblePageRect,
      ),
    ).toEqual({
      x: 400,
      y: 500,
      width: 400,
      height: 200,
    });
  });

  it("places dragged content around the pointer without forcing it back inside the page", () => {
    expect(
      pointedInsertionRect(
        {
          width: 400,
          height: 200,
        },
        {
          x: 1_140,
          y: 720,
        },
        visiblePageRect,
      ),
    ).toEqual({
      x: 940,
      y: 620,
      width: 400,
      height: 200,
    });
  });

  it("offsets batch inserts so they never completely cover one another", () => {
    expect(
      cascadeInsertionRects([
        {
          x: 100,
          y: 100,
          width: 200,
          height: 100,
        },
        {
          x: 100,
          y: 100,
          width: 200,
          height: 100,
        },
        {
          x: 100,
          y: 100,
          width: 200,
          height: 100,
        },
      ]),
    ).toEqual([
      {
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      },
      {
        x: 132,
        y: 132,
        width: 200,
        height: 100,
      },
      {
        x: 164,
        y: 164,
        width: 200,
        height: 100,
      },
    ]);
  });

  it("places a generated result beside its source and keeps it inside the page", () => {
    expect(
      adjacentInsertionRect(
        {
          width: 1_000,
          height: 1_000,
        },
        {
          x: 190,
          y: 190,
          width: 620,
          height: 620,
        },
        {
          x: 0,
          y: 0,
          width: 1_000,
          height: 1_000,
        },
      ),
    ).toEqual({
      x: 380,
      y: 190,
      width: 620,
      height: 620,
    });
  });

  it("keeps transient image sources outside the durable document", () => {
    expect(
      durableImageInsertionReference({
        kind: "local_file",
        localId: "local-1",
        mediaType: "image/png",
        name: "商品图.png",
        previewUrl: "blob:https://kanvas.invalid/local-1",
        size: 1_024,
      }),
    ).toBeUndefined();

    expect(
      durableImageInsertionReference({
        kind: "artifact",
        reference: {
          kind: "artifact",
          artifactId: "01K00000000000000000000031",
        },
      }),
    ).toEqual({
      kind: "artifact",
      artifactId: "01K00000000000000000000031",
    });
  });

  it("distinguishes top-level insertion from content replacement", () => {
    expect(
      insertionCreatesTopLevelNode({
        kind: "canvas_adjacent",
        pageId: "page-1",
        sourceRect: {
          x: 100,
          y: 100,
          width: 300,
          height: 200,
        },
        visiblePageRect,
      }),
    ).toBe(true);
    expect(
      insertionCreatesTopLevelNode({
        kind: "canvas_point",
        pageId: "page-1",
        point: {
          x: 300,
          y: 400,
        },
      }),
    ).toBe(true);
    expect(
      insertionCreatesTopLevelNode({
        kind: "frame_content",
        pageId: "page-1",
        frameId: "frame-1",
      }),
    ).toBe(false);
  });

  it("never exposes group as a directly insertable payload", () => {
    expect(
      insertionPayloadNodeKind({
        kind: "grid",
        definition: {
          catalogId: "kanvas.core",
          definitionId: "grid.three.columns",
          revision: "2026-07-31",
        },
      }),
    ).toBe("grid");
    expect(
      insertionPayloadNodeKind({
        kind: "note",
        color: "#ffd21f",
      }),
    ).toBe("shape");
  });
});
