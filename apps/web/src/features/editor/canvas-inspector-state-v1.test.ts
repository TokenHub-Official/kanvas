import { describe, expect, it } from "vitest";

import {
  canvasInspectorCloseTriggerV1,
  canvasInspectorModeAfterSelectionV1,
  canvasInspectorModeSupportsSelectionV1,
  toggleCanvasInspectorModeV1,
} from "./canvas-inspector-state-v1.js";

describe("Canvas inspector state", () => {
  it("keeps position and layers compatible with single and multiple selections", () => {
    const nodes = [{ kind: "image" }, { kind: "text" }] as const;

    expect(canvasInspectorModeSupportsSelectionV1("position", nodes)).toBe(
      true,
    );
    expect(canvasInspectorModeSupportsSelectionV1("layers", nodes)).toBe(true);
  });

  it("limits object and type modes to compatible single selections", () => {
    expect(
      canvasInspectorModeSupportsSelectionV1("common", [{ kind: "image" }]),
    ).toBe(true);
    expect(
      canvasInspectorModeSupportsSelectionV1("style", [{ kind: "shape" }]),
    ).toBe(true);
    expect(
      canvasInspectorModeSupportsSelectionV1("style", [{ kind: "image" }]),
    ).toBe(false);
    expect(
      canvasInspectorModeSupportsSelectionV1("text-spacing", [
        { kind: "text" },
        { kind: "text" },
      ]),
    ).toBe(false);
  });

  it("preserves compatible modes and falls back without leaving stale type panels", () => {
    expect(
      canvasInspectorModeAfterSelectionV1("common", [{ kind: "text" }]),
    ).toBe("common");
    expect(
      canvasInspectorModeAfterSelectionV1("text-effects", [{ kind: "shape" }]),
    ).toBe("common");
    expect(
      canvasInspectorModeAfterSelectionV1("style", [
        { kind: "shape" },
        { kind: "line" },
      ]),
    ).toBe("position");
    expect(canvasInspectorModeAfterSelectionV1("layers", [])).toBeUndefined();
  });

  it("uses one toggleable inspector mode", () => {
    expect(toggleCanvasInspectorModeV1(undefined, "common")).toBe("common");
    expect(toggleCanvasInspectorModeV1("common", "common")).toBeUndefined();
    expect(toggleCanvasInspectorModeV1("common", "position")).toBe("position");
    expect(toggleCanvasInspectorModeV1("layers", "position")).toBeUndefined();
  });

  it("restores the actual trigger before considering a mode fallback", () => {
    const actual = { id: "crop" };
    const fallback = { id: "edit-image" };

    expect(canvasInspectorCloseTriggerV1(actual, fallback)).toBe(actual);
    expect(canvasInspectorCloseTriggerV1(undefined, fallback)).toBe(fallback);
  });
});
