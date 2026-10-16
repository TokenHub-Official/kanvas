import { describe, expect, it } from "vitest";

import {
  appendCanvasFreehandEraserTargetV1,
  appendCanvasFreehandPointV1,
  canvasBrushSettingsForStyleV1,
  canvasBrushStylesV1,
  canvasFreehandEraserTargetIdV1,
  canvasFreehandPreviewPathV1,
  canvasQuickLinePresetsV1,
  canvasQuickNoteColorsV1,
  canvasQuickShapePresetsV1,
  canvasQuickToolMenuStateV1,
  canvasQuickToolDefinitionsV1,
  createCanvasFreehandNodeV1,
  updateCanvasBrushSettingsV1,
} from "./canvas-quick-tools-v1.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";

describe("Canvas quick tools V1", () => {
  it("keeps the quick palette focused on the six requested authoring modes", () => {
    expect(canvasQuickToolDefinitionsV1.map((tool) => tool.id)).toEqual([
      "select",
      "draw",
      "shape",
      "line",
      "note",
      "text",
    ]);
    expect(
      canvasQuickToolDefinitionsV1
        .filter((tool) => tool.hasFlyout)
        .map((tool) => tool.id),
    ).toEqual(["draw", "shape", "line", "note"]);
  });

  it("exposes reusable brush, shape, line and note choices without scenario hardcoding", () => {
    expect(canvasBrushStylesV1.map((preset) => preset.id)).toEqual([
      "fine",
      "marker",
      "highlighter",
      "pencil",
    ]);
    expect(
      new Set(
        canvasBrushStylesV1.map(
          (preset) => `${String(preset.width)}:${String(preset.opacity)}`,
        ),
      ).size,
    ).toBe(canvasBrushStylesV1.length);
    expect(canvasQuickShapePresetsV1).toHaveLength(8);
    expect(
      canvasQuickShapePresetsV1.map((preset) => preset.reference.definitionId),
    ).toContain("basic.rectangle");
    expect(
      canvasQuickLinePresetsV1.map((preset) => preset.reference.definitionId),
    ).toEqual(["line.straight", "line.curve", "line.elbow"]);
    expect(canvasQuickNoteColorsV1.map((preset) => preset.label)).toEqual([
      "黄色",
      "橙色",
      "粉色",
      "蓝色",
      "绿色",
      "紫色",
    ]);
  });

  it("opens one flyout at a time and returns to selection when it is collapsed", () => {
    expect(canvasQuickToolMenuStateV1(undefined, "shape")).toEqual({
      activeTool: "shape",
      flyout: "shape",
    });
    expect(canvasQuickToolMenuStateV1("shape", "shape")).toEqual({
      activeTool: "select",
    });
    expect(canvasQuickToolMenuStateV1("shape", "line")).toEqual({
      activeTool: "line",
      flyout: "line",
    });
    expect(canvasQuickToolMenuStateV1("line", "draw")).toEqual({
      activeTool: "draw",
      flyout: "draw",
    });
  });

  it("deduplicates pointer noise and builds a bounded editable polyline", () => {
    const first = [{ x: 40, y: 80 }] as const;
    expect(appendCanvasFreehandPointV1(first, { x: 40.4, y: 80.3 }, 1)).toBe(
      first,
    );
    const points = Array.from({ length: 600 }, (_, index) => ({
      x: 40 + index,
      y: 80 + Math.sin(index / 12) * 20,
    }));
    const node = createCanvasFreehandNodeV1({
      id: "drawing-1",
      points,
      color: "#3048f5",
      name: "细笔笔触",
      opacity: 0.75,
      width: 6,
    });

    expect(node).toMatchObject({
      id: "drawing-1",
      name: "细笔笔触",
      kind: "line",
      pathKind: "polyline",
      role: "freehand",
      capStyle: "round",
      joinStyle: "round",
      opacity: 0.75,
      stroke: {
        paint: {
          kind: "solid",
          color: "#3048f5",
        },
        width: 6,
      },
    });
    expect(node?.points).toHaveLength(256);
    expect(
      node?.points.every(
        (point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
      ),
    ).toBe(true);
    expect(canvasFreehandPreviewPathV1(points.slice(0, 2))).toBe(
      `M40 80 L41 ${String(80 + Math.sin(1 / 12) * 20)}`,
    );
  });

  it("turns a click into a visible round-cap-compatible stroke", () => {
    const node = createCanvasFreehandNodeV1({
      id: "drawing-dot",
      points: [{ x: 12, y: 18 }],
      color: "#151515",
      width: 4,
    });

    expect(node?.points).toHaveLength(2);
    expect(node?.transform.width).toBeGreaterThanOrEqual(4);
    expect(node?.transform.height).toBeGreaterThanOrEqual(4);
  });

  it("keeps a selected preset while allowing bounded brush customization", () => {
    const marker = canvasBrushSettingsForStyleV1("marker");

    expect(marker).toEqual({
      color: "#ef3340",
      opacity: 0.92,
      presetId: "marker",
      width: 10,
    });
    expect(
      updateCanvasBrushSettingsV1(marker, {
        color: "#123456",
        opacity: 0,
        width: 999,
      }),
    ).toEqual({
      color: "#123456",
      opacity: 0.05,
      presetId: "marker",
      width: 48,
    });
  });

  it("erases only visible unlocked freehand strokes and deduplicates a drag", () => {
    const stroke = createCanvasFreehandNodeV1({
      id: "stroke-a",
      points: [
        { x: 12, y: 18 },
        { x: 80, y: 64 },
      ],
      color: "#151515",
      width: 4,
    })!;
    const page = {
      id: "page-1",
      name: "Page 1",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" },
      nodes: [
        stroke,
        { ...stroke, id: "stroke-locked", locked: true },
        { ...stroke, id: "stroke-hidden", visible: false },
        { ...stroke, id: "design-line", role: "design" },
      ],
    } as const satisfies EditorRuntimePageV1;

    expect(canvasFreehandEraserTargetIdV1(page, "stroke-a")).toBe("stroke-a");
    expect(
      canvasFreehandEraserTargetIdV1(page, "stroke-locked"),
    ).toBeUndefined();
    expect(
      canvasFreehandEraserTargetIdV1(page, "stroke-hidden"),
    ).toBeUndefined();
    expect(canvasFreehandEraserTargetIdV1(page, "design-line")).toBeUndefined();
    const first = appendCanvasFreehandEraserTargetV1([], "stroke-a");
    expect(appendCanvasFreehandEraserTargetV1(first, "stroke-a")).toBe(first);
  });
});
