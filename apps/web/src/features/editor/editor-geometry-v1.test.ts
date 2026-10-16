import type { EditorNodeV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import {
  editorNodeBoundsV1,
  editorRectCenterV1,
  resizeEditorNodeV1,
  rotateEditorPointV1,
  rotateEditorNodeV1,
  snapEditorNodeMoveV1,
} from "./editor-geometry-v1.js";

function shape(id: string, x: number, y: number): EditorNodeV1 {
  return {
    id,
    name: id,
    kind: "shape",
    transform: {
      x,
      y,
      width: 100,
      height: 80,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    definition: {
      catalogId: "kanvas.core.shapes",
      definitionId: "basic.rectangle",
      revision: "2026-07-31",
    },
    parameters: {
      cornerRadius: 0,
    },
    fill: {
      kind: "solid",
      color: "#3048f5",
    },
    stroke: {
      paint: {
        kind: "none",
      },
      width: 0,
      alignment: "center",
    },
  };
}

describe("Canvas Core V1 geometry", () => {
  it("computes rotated bounds", () => {
    const node = shape("a", 100, 100);
    expect(
      editorNodeBoundsV1({
        ...node,
        transform: {
          ...node.transform,
          rotation: 90,
        },
      }),
    ).toMatchObject({
      x: 110,
      y: 90,
      width: 80,
      height: 100,
    });
  });

  it("snaps a moved node to page and sibling axes", () => {
    const result = snapEditorNodeMoveV1(
      {
        x: 447,
        y: 457,
        width: 100,
        height: 80,
      },
      {
        width: 1_000,
        height: 1_000,
      },
      [shape("other", 700, 200)],
      ["moving"],
      5,
    );
    expect(result).toEqual({
      rect: {
        x: 450,
        y: 460,
        width: 100,
        height: 80,
      },
      guides: {
        x: 500,
        y: 500,
      },
    });
  });

  it("keeps visible locked nodes as snapping references", () => {
    const locked = {
      ...shape("locked-guide", 300, 200),
      locked: true,
    };

    expect(
      snapEditorNodeMoveV1(
        { x: 197, y: 100, width: 100, height: 80 },
        { width: 1_000, height: 1_000 },
        [locked],
        ["moving"],
        5,
      ).rect.x,
    ).toBe(200);
  });

  it("resizes in rotated axes and preserves the fixed anchor", () => {
    const original = {
      x: 100,
      y: 100,
      width: 100,
      height: 80,
      rotation: 30,
      flipX: false,
      flipY: false,
    } as const;
    const resized = resizeEditorNodeV1(
      original,
      "se",
      {
        x: 240,
        y: 230,
      },
      false,
    );
    expect(resized.width).toBeGreaterThan(100);
    expect(resized.height).not.toBe(80);
    expect(resized.rotation).toBe(30);
    const fixedBefore = rotateEditorPointV1(
      {
        x: original.x,
        y: original.y,
      },
      editorRectCenterV1(original),
      original.rotation,
    );
    const fixedAfter = rotateEditorPointV1(
      {
        x: resized.x,
        y: resized.y,
      },
      editorRectCenterV1(resized),
      resized.rotation,
    );
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x);
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y);
  });

  it("rotates with optional 15 degree snapping", () => {
    expect(
      rotateEditorNodeV1(
        shape("a", 0, 0).transform,
        { x: 50, y: -50 },
        { x: 150, y: 40 },
        true,
      ).rotation % 15,
    ).toBe(0);
  });
});
