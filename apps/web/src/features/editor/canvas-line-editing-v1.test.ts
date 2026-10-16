import { describe, expect, it } from "vitest";

import {
  canvasLineStrokePatternV1,
  canvasLineRotationHandleV1,
  canvasLineWithPathKindV1,
  canvasLineWithStrokePatternV1,
  canvasLineWorldPointsV1,
  updateCanvasLineWorldPointV1,
  type CanvasEditableLineV1,
} from "./canvas-line-editing-v1.js";

function line(
  overrides: Partial<CanvasEditableLineV1> = {},
): CanvasEditableLineV1 {
  return {
    id: "line-1",
    name: "Line",
    kind: "line",
    transform: {
      x: 10,
      y: 20,
      width: 100,
      height: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    pathKind: "straight",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    stroke: {
      paint: { kind: "solid", color: "#151515" },
      width: 4,
      alignment: "center",
    },
    startCap: "none",
    endCap: "none",
    role: "design",
    capStyle: "round",
    joinStyle: "round",
    ...overrides,
  };
}

function expectPoint(
  value: { readonly x: number; readonly y: number },
  expected: { readonly x: number; readonly y: number },
): void {
  expect(value.x).toBeCloseTo(expected.x, 5);
  expect(value.y).toBeCloseTo(expected.y, 5);
}

describe("Canvas line editing", () => {
  it("places rotation controls on a path normal instead of the box bottom", () => {
    const straight = line({
      transform: {
        ...line().transform,
        height: 120,
      },
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    });

    expect(canvasLineRotationHandleV1(straight, 40)).toEqual({
      anchor: { x: 60, y: 80 },
      handle: { x: 60, y: 120 },
    });
    const curveHandle = canvasLineRotationHandleV1(
      line({
        pathKind: "curve",
        transform: {
          ...line().transform,
          height: 120,
        },
        points: [
          { x: 0, y: 1 },
          { x: 0.5, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
      40,
    );
    expect(curveHandle.handle.y).toBeGreaterThan(curveHandle.anchor.y);
  });
  it("moves an endpoint and renormalizes the line bounds", () => {
    const updated = updateCanvasLineWorldPointV1(line(), 1, {
      x: 160,
      y: 70,
    });
    const points = canvasLineWorldPointsV1(updated);

    expectPoint(points[0]!, { x: 10, y: 20 });
    expectPoint(points[1]!, { x: 160, y: 70 });
    expect(updated.transform.width).toBeCloseTo(150);
    expect(updated.transform.height).toBeCloseTo(50);
  });

  it("preserves rotated and flipped points while moving a curve control", () => {
    const original = line({
      pathKind: "curve",
      points: [
        { x: 0, y: 1 },
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
      ],
      transform: {
        x: 120,
        y: 80,
        width: 240,
        height: 120,
        rotation: 32,
        flipX: true,
        flipY: false,
      },
    });
    const before = canvasLineWorldPointsV1(original);
    const target = { x: 260, y: 52 };
    const updated = updateCanvasLineWorldPointV1(original, 1, target);
    const after = canvasLineWorldPointsV1(updated);

    expectPoint(after[0]!, before[0]!);
    expectPoint(after[1]!, target);
    expectPoint(after[2]!, before[2]!);
    expect(updated.transform.rotation).toBe(32);
    expect(updated.transform.flipX).toBe(true);
  });

  it("converts the selected line between straight, elbow, and curve paths", () => {
    const curved = canvasLineWithPathKindV1(line(), "curve");
    expect(curved.pathKind).toBe("curve");
    expect(curved.points).toHaveLength(3);

    const elbow = canvasLineWithPathKindV1(curved, "elbow");
    expect(elbow.pathKind).toBe("elbow");
    expect(elbow.points).toHaveLength(4);

    const straight = canvasLineWithPathKindV1(elbow, "straight");
    expect(straight.pathKind).toBe("straight");
    expect(straight.points).toHaveLength(2);
  });

  it("projects solid, dashed, and dotted stroke patterns", () => {
    const dashed = canvasLineWithStrokePatternV1(line(), "dashed");
    expect(canvasLineStrokePatternV1(dashed)).toBe("dashed");
    const dotted = canvasLineWithStrokePatternV1(dashed, "dotted");
    expect(canvasLineStrokePatternV1(dotted)).toBe("dotted");
    const solid = canvasLineWithStrokePatternV1(dotted, "solid");
    expect(canvasLineStrokePatternV1(solid)).toBe("solid");
    expect(solid.stroke).not.toHaveProperty("dash");
  });
});
