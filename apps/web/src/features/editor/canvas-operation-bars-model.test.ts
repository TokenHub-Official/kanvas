import { describe, expect, it } from "vitest";

import {
  canvasLockControlV1,
  canvasNodeQuickBarPositionV1,
  canvasRotationHandleYV1,
  canvasSelectionShowsTransformHandlesV1,
  projectCanvasOperationBarsV1,
} from "./canvas-operation-bars-model.js";

describe("projectCanvasOperationBarsV1", () => {
  it("projects the icon and label for the action that will run", () => {
    expect(canvasLockControlV1(false)).toEqual({
      icon: "lock",
    });
    expect(canvasLockControlV1(true)).toEqual({
      icon: "unlock",
    });
  });

  it("keeps generic one-click actions out of the type-specific bar", () => {
    const projection = projectCanvasOperationBarsV1(["image"]);

    expect(projection.quickActions).toEqual(["lock", "duplicate", "delete"]);
    expect(projection.typeActions).toEqual([
      "image_adjustments",
      "image_filters",
      "corner_radius",
      "crop",
      "fit",
      "flip",
      "set_as_background",
      "position",
      "properties",
    ]);
  });

  it("projects text capabilities without losing generic actions", () => {
    const projection = projectCanvasOperationBarsV1(["text"]);

    expect(projection.typeActions).toContain("font");
    expect(projection.typeActions).toContain("font_size");
    expect(projection.typeActions).toContain("text_spacing");
    expect(projection.typeActions).toContain("effects");
    expect(projection.quickActions).toContain("delete");
    expect(projection.typeActions).not.toContain("group");
  });

  it("uses an explicit multi-selection projection", () => {
    expect(projectCanvasOperationBarsV1(["image", "text"])).toEqual({
      quickActions: ["duplicate", "delete"],
      typeActions: ["align", "group", "position", "properties"],
    });
  });

  it("keeps shape stroke, geometry and transforms in one type contract", () => {
    expect(projectCanvasOperationBarsV1(["shape"]).typeActions).toEqual([
      "fill",
      "shape_style",
      "shape_parameters",
      "flip",
      "position",
      "properties",
    ]);
  });

  it("does not expose disabled chrome for an empty selection", () => {
    expect(projectCanvasOperationBarsV1([])).toEqual({
      quickActions: [],
      typeActions: [],
    });
  });

  it("keeps the rotation handle below the node and flips the quick bar away from a tight top edge", () => {
    expect(canvasRotationHandleYV1(200, 10)).toBe(230);
    expect(
      canvasNodeQuickBarPositionV1({ x: 20, y: 10, width: 100, height: 80 }, 1),
    ).toEqual({
      left: 70,
      top: 154,
    });
  });

  it("keeps a locked selection visible without transform handles", () => {
    expect(canvasSelectionShowsTransformHandlesV1([{ locked: true }])).toBe(
      false,
    );
    expect(canvasSelectionShowsTransformHandlesV1([{ locked: false }])).toBe(
      true,
    );
    expect(
      canvasSelectionShowsTransformHandlesV1([
        { locked: false },
        { locked: false },
      ]),
    ).toBe(false);
  });

  it("places the quick bar above a selection when there is room", () => {
    expect(
      canvasNodeQuickBarPositionV1(
        { x: 20, y: 100, width: 100, height: 80 },
        1,
      ),
    ).toEqual({
      left: 70,
      top: 48,
    });
  });

  it.each([0.25, 1, 2])(
    "keeps the quick bar inside every viewport edge at %s zoom",
    (zoom) => {
      const viewport = { width: 320, height: 240 };
      for (const bounds of [
        { x: -200, y: -200, width: 20, height: 20 },
        { x: 1_000, y: -200, width: 20, height: 20 },
        { x: -200, y: 1_000, width: 20, height: 20 },
        { x: 1_000, y: 1_000, width: 20, height: 20 },
      ]) {
        const position = canvasNodeQuickBarPositionV1(bounds, zoom, viewport);
        expect(position.left).toBeGreaterThanOrEqual(64);
        expect(position.left).toBeLessThanOrEqual(256);
        expect(position.top).toBeGreaterThanOrEqual(8);
        expect(position.top).toBeLessThanOrEqual(192);
      }
    },
  );

  it("moves beside a tall edge selection instead of covering its handles", () => {
    const position = canvasNodeQuickBarPositionV1(
      { x: 80, y: 10, width: 80, height: 210 },
      1,
      { width: 420, height: 240 },
    );

    expect(position.left).toBeGreaterThan(216);
    expect(position.top).toBe(95);
  });
});
