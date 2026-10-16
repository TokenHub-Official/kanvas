import { describe, expect, it } from "vitest";

import {
  canvasLineWithSnappedEndpointV1,
  canvasResolveLineBindingsV1,
  canvasShapeConnectionAnchorsV1,
} from "./canvas-line-connection-v1.js";
import { canvasLineWorldPointsV1 } from "./canvas-line-editing-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const common = {
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

const shape = {
  ...common,
  id: "shape-1",
  kind: "shape",
  name: "Process",
  transform: {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  definition: {
    catalogId: "kanvas.core.shapes",
    definitionId: "basic.rectangle",
    revision: "2026-07-31",
  },
  parameters: {},
  fill: { kind: "solid", color: "#3048f5" },
  stroke: {
    paint: { kind: "none" },
    width: 0,
    alignment: "center",
  },
} as const satisfies EditorRuntimeNodeV1;

const line = {
  ...common,
  id: "line-1",
  kind: "line",
  name: "Connector",
  transform: {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  pathKind: "straight",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  stroke: {
    paint: { kind: "solid", color: "#151515" },
    width: 4,
    alignment: "center",
  },
  startCap: "none",
  endCap: "arrow",
  role: "design",
} as const satisfies EditorRuntimeNodeV1;

describe("Canvas line connections", () => {
  it("materializes four rotation-aware Shape anchors", () => {
    expect(canvasShapeConnectionAnchorsV1(shape)).toMatchObject([
      { anchor: "top", point: { x: 200, y: 100 } },
      { anchor: "right", point: { x: 300, y: 150 } },
      { anchor: "bottom", point: { x: 200, y: 200 } },
      { anchor: "left", point: { x: 100, y: 150 } },
    ]);
  });

  it("snaps an endpoint, persists its binding and follows Shape movement", () => {
    const connected = canvasLineWithSnappedEndpointV1(
      line,
      1,
      { x: 296, y: 152 },
      [shape, line],
      8,
    );
    expect(connected.endBinding).toEqual({
      nodeId: "shape-1",
      anchor: "right",
    });
    expect(canvasLineWorldPointsV1(connected).at(-1)).toEqual({
      x: 300,
      y: 150,
    });

    const movedShape = {
      ...shape,
      transform: { ...shape.transform, x: 400 },
    };
    const resolved = canvasResolveLineBindingsV1([movedShape, connected]).find(
      (node) => node.id === connected.id,
    );
    expect(resolved?.kind).toBe("line");
    if (resolved?.kind === "line") {
      expect(canvasLineWorldPointsV1(resolved).at(-1)).toEqual({
        x: 600,
        y: 150,
      });
    }
  });

  it("detaches a missing target without moving the fallback endpoint", () => {
    const connected = canvasLineWithSnappedEndpointV1(
      line,
      1,
      { x: 300, y: 150 },
      [shape, line],
      8,
    );
    const fallback = canvasLineWorldPointsV1(connected).at(-1);
    const [resolved] = canvasResolveLineBindingsV1([connected]);

    expect(resolved?.kind).toBe("line");
    if (resolved?.kind === "line") {
      expect(resolved.endBinding).toBeUndefined();
      expect(canvasLineWorldPointsV1(resolved).at(-1)).toEqual(fallback);
    }
  });
});
