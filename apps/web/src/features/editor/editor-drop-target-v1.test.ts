import type { EditorPageV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import { canvasImageInsertionTargetAtPointV1 } from "./editor-drop-target-v1.js";

const common = {
  name: "容器",
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

const page: EditorPageV1 = {
  id: "page-1",
  name: "页面 1",
  width: 1_000,
  height: 800,
  background: {
    kind: "transparent",
  },
  nodes: [
    {
      ...common,
      id: "frame-1",
      kind: "frame",
      transform: {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      definition: {
        catalogId: "kanvas.core.frames",
        definitionId: "frame.circle",
        revision: "2026-07-31",
      },
      fill: {
        kind: "none",
      },
      stroke: {
        paint: {
          kind: "none",
        },
        width: 0,
        alignment: "center",
      },
    },
    {
      ...common,
      id: "grid-1",
      kind: "grid",
      transform: {
        x: 400,
        y: 100,
        width: 300,
        height: 200,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      definition: {
        catalogId: "kanvas.core.grids",
        definitionId: "grid.two.columns",
        revision: "2026-07-31",
      },
      gap: 8,
      cornerRadius: 0,
      cells: [{ slotId: "left" }, { slotId: "right" }],
    },
  ],
};

describe("Canvas Core V1 image drop targeting", () => {
  it("fills a frame and the exact grid slot under the pointer", () => {
    expect(
      canvasImageInsertionTargetAtPointV1(page, {
        x: 180,
        y: 160,
      }),
    ).toEqual({
      kind: "frame_content",
      pageId: "page-1",
      frameId: "frame-1",
    });
    expect(
      canvasImageInsertionTargetAtPointV1(page, {
        x: 620,
        y: 180,
      }),
    ).toEqual({
      kind: "grid_cell",
      pageId: "page-1",
      gridId: "grid-1",
      slotId: "right",
    });
  });

  it("falls back to a top-level point outside containers", () => {
    expect(
      canvasImageInsertionTargetAtPointV1(page, {
        x: 800,
        y: 700,
      }),
    ).toEqual({
      kind: "canvas_point",
      pageId: "page-1",
      point: {
        x: 800,
        y: 700,
      },
    });
  });
});
