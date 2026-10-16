import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import type { EditorPointV1 } from "./editor-geometry-v1.js";

export type CanvasEditableLineV1 = Extract<
  EditorRuntimeNodeV1,
  { kind: "line" }
>;

export type CanvasLinePathKindV1 = "curve" | "elbow" | "straight";
export type CanvasLineStrokePatternV1 = "dashed" | "dotted" | "solid";

export interface CanvasLineRotationHandleV1 {
  readonly anchor: EditorPointV1;
  readonly handle: EditorPointV1;
}

const MINIMUM_LINE_DIMENSION = 1;
const NORMALIZED_POINT_MINIMUM = -8;
const NORMALIZED_POINT_MAXIMUM = 8;
const CURVE_OFFSET_RATIO = 0.25;
const LONG_DASH_LENGTH = 12;
const LONG_DASH_GAP = 10;
const DOT_DASH_LENGTH = 1;
const DOT_DASH_GAP = 10;
const LONG_DASH = [LONG_DASH_LENGTH, LONG_DASH_GAP] as const;
const DOT_DASH = [DOT_DASH_LENGTH, DOT_DASH_GAP] as const;
const HALF_CIRCLE_DEGREES = 180;
const QUADRATIC_POINT_COUNT = 3;
const QUADRATIC_ENDPOINT_WEIGHT = 0.25;
const QUADRATIC_CONTROL_WEIGHT = 0.5;

function radians(degrees: number): number {
  return (degrees * Math.PI) / HALF_CIRCLE_DEGREES;
}

function rotatePoint(point: EditorPointV1, angle: number): EditorPointV1 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function normalizedDirection(
  start: EditorPointV1,
  end: EditorPointV1,
): EditorPointV1 {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function polylineMidpoint(points: readonly EditorPointV1[]): {
  readonly anchor: EditorPointV1;
  readonly tangent: EditorPointV1;
} {
  const segments = points.slice(1).map((point, index) => ({
    end: point,
    length: Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
    start: points[index]!,
  }));
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total / 2;
  for (const segment of segments) {
    if (remaining <= segment.length && segment.length > 0) {
      const ratio = remaining / segment.length;
      return {
        anchor: {
          x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
          y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
        },
        tangent: normalizedDirection(segment.start, segment.end),
      };
    }
    remaining -= segment.length;
  }
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points.at(-1) ?? start;
  return {
    anchor: end,
    tangent: normalizedDirection(start, end),
  };
}

export function canvasLineRotationHandleV1(
  node: CanvasEditableLineV1,
  offset: number,
): CanvasLineRotationHandleV1 {
  const points = canvasLineWorldPointsV1(node);
  const start = points[0] ?? { x: node.transform.x, y: node.transform.y };
  const end = points.at(-1) ?? start;
  let anchor: EditorPointV1;
  let tangent: EditorPointV1;
  if (node.pathKind === "curve" && points.length >= QUADRATIC_POINT_COUNT) {
    const control = points[1]!;
    anchor = {
      x:
        start.x * QUADRATIC_ENDPOINT_WEIGHT +
        control.x * QUADRATIC_CONTROL_WEIGHT +
        end.x * QUADRATIC_ENDPOINT_WEIGHT,
      y:
        start.y * QUADRATIC_ENDPOINT_WEIGHT +
        control.y * QUADRATIC_CONTROL_WEIGHT +
        end.y * QUADRATIC_ENDPOINT_WEIGHT,
    };
    tangent = normalizedDirection(start, end);
  } else {
    ({ anchor, tangent } = polylineMidpoint(points));
  }
  let normal = { x: -tangent.y, y: tangent.x };
  if (node.pathKind === "curve" && points[1]) {
    const chordMidpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    const bow = {
      x: points[1].x - chordMidpoint.x,
      y: points[1].y - chordMidpoint.y,
    };
    if (normal.x * bow.x + normal.y * bow.y > 0) {
      normal = { x: -normal.x, y: -normal.y };
    }
  } else if (normal.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return {
    anchor,
    handle: {
      x: anchor.x + normal.x * offset,
      y: anchor.y + normal.y * offset,
    },
  };
}

function clampNormalized(value: number): number {
  return Math.max(
    NORMALIZED_POINT_MINIMUM,
    Math.min(NORMALIZED_POINT_MAXIMUM, value),
  );
}

export function canvasLineWorldPointsV1(
  node: CanvasEditableLineV1,
): readonly EditorPointV1[] {
  const transform = node.transform;
  const center = {
    x: transform.width / 2,
    y: transform.height / 2,
  };
  const angle = radians(transform.rotation);
  return node.points.map((point) => {
    const local = {
      x: point.x * transform.width,
      y: point.y * transform.height,
    };
    const flipped = {
      x: transform.flipX ? transform.width - local.x : local.x,
      y: transform.flipY ? transform.height - local.y : local.y,
    };
    const rotated = rotatePoint(
      {
        x: flipped.x - center.x,
        y: flipped.y - center.y,
      },
      angle,
    );
    return {
      x: transform.x + center.x + rotated.x,
      y: transform.y + center.y + rotated.y,
    };
  });
}

export function canvasLineFromWorldPointsV1(
  node: CanvasEditableLineV1,
  worldPoints: readonly EditorPointV1[],
  pathKind: CanvasEditableLineV1["pathKind"] = node.pathKind,
): CanvasEditableLineV1 {
  if (worldPoints.length < 2) {
    return node;
  }
  const angle = radians(node.transform.rotation);
  const unrotated = worldPoints.map((point) => rotatePoint(point, -angle));
  const minimumX = Math.min(...unrotated.map((point) => point.x));
  const maximumX = Math.max(...unrotated.map((point) => point.x));
  const minimumY = Math.min(...unrotated.map((point) => point.y));
  const maximumY = Math.max(...unrotated.map((point) => point.y));
  const width = Math.max(MINIMUM_LINE_DIMENSION, maximumX - minimumX);
  const height = Math.max(MINIMUM_LINE_DIMENSION, maximumY - minimumY);
  const center = {
    x: width / 2,
    y: height / 2,
  };
  const rotatedMinimum = rotatePoint({ x: minimumX, y: minimumY }, angle);
  const rotatedCenter = rotatePoint(center, angle);
  return {
    ...node,
    pathKind,
    transform: {
      ...node.transform,
      x: rotatedMinimum.x - center.x + rotatedCenter.x,
      y: rotatedMinimum.y - center.y + rotatedCenter.y,
      width,
      height,
    },
    points: unrotated.map((point) => {
      const postFlipX = point.x - minimumX;
      const postFlipY = point.y - minimumY;
      const localX = node.transform.flipX ? width - postFlipX : postFlipX;
      const localY = node.transform.flipY ? height - postFlipY : postFlipY;
      return {
        x: clampNormalized(localX / width),
        y: clampNormalized(localY / height),
      };
    }),
  };
}

export function updateCanvasLineWorldPointV1(
  node: CanvasEditableLineV1,
  pointIndex: number,
  point: EditorPointV1,
): CanvasEditableLineV1 {
  const worldPoints = [...canvasLineWorldPointsV1(node)];
  if (!worldPoints[pointIndex]) {
    return node;
  }
  worldPoints[pointIndex] = point;
  return canvasLineFromWorldPointsV1(node, worldPoints);
}

export function canvasLineWithPathKindV1(
  node: CanvasEditableLineV1,
  pathKind: CanvasLinePathKindV1,
): CanvasEditableLineV1 {
  const current = canvasLineWorldPointsV1(node);
  const start = current[0];
  const end = current.at(-1);
  if (!start || !end) {
    return node;
  }
  if (pathKind === "straight") {
    return canvasLineFromWorldPointsV1(node, [start, end], "straight");
  }
  if (pathKind === "elbow") {
    const middleX = (start.x + end.x) / 2;
    return canvasLineFromWorldPointsV1(
      node,
      [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
      "elbow",
    );
  }
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  const distance = Math.hypot(delta.x, delta.y);
  const normal =
    distance > 0
      ? {
          x: delta.y / distance,
          y: -delta.x / distance,
        }
      : { x: 0, y: -1 };
  const control = {
    x: (start.x + end.x) / 2 + normal.x * distance * CURVE_OFFSET_RATIO,
    y: (start.y + end.y) / 2 + normal.y * distance * CURVE_OFFSET_RATIO,
  };
  return canvasLineFromWorldPointsV1(node, [start, control, end], "curve");
}

export function canvasLineStrokePatternV1(
  node: CanvasEditableLineV1,
): CanvasLineStrokePatternV1 {
  const dash = node.stroke.dash;
  if (!dash || dash.length === 0) {
    return "solid";
  }
  return dash[0] === 1 ? "dotted" : "dashed";
}

export function canvasLineWithStrokePatternV1(
  node: CanvasEditableLineV1,
  pattern: CanvasLineStrokePatternV1,
): CanvasEditableLineV1 {
  const { dash, ...stroke } = node.stroke;
  void dash;
  return {
    ...node,
    stroke:
      pattern === "solid"
        ? stroke
        : {
            ...stroke,
            dash: pattern === "dotted" ? [...DOT_DASH] : [...LONG_DASH],
          },
  };
}
