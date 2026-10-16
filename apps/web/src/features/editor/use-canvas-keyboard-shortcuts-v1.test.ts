import { describe, expect, it } from "vitest";

import {
  canvasKeyboardMovementV1,
  canvasKeyboardRotationDeltaV1,
} from "./use-canvas-keyboard-shortcuts-v1.js";

describe("Canvas keyboard shortcuts", () => {
  it("maps arrow keys to normal and accelerated movement", () => {
    expect(canvasKeyboardMovementV1("ArrowLeft", false)).toEqual({
      x: -1,
      y: 0,
    });
    expect(canvasKeyboardMovementV1("ArrowDown", true)).toEqual({
      x: 0,
      y: 10,
    });
    expect(canvasKeyboardMovementV1("Enter", false)).toBeUndefined();
  });

  it("maps punctuation keys to normal and accelerated rotation", () => {
    expect(canvasKeyboardRotationDeltaV1(",", false)).toBe(-1);
    expect(canvasKeyboardRotationDeltaV1(".", true)).toBe(15);
    expect(canvasKeyboardRotationDeltaV1("/", false)).toBeUndefined();
  });
});
