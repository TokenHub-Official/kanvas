import type {
  EditorCatalogReferenceV1,
  EditorLineNodeV1,
} from "@kanvas/contracts/editor";

import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";

import { canvasLineCatalogV1 } from "./line-catalog-v1.js";
import { canvasShapeCatalogV1 } from "./shape-catalog-v1.js";

export type CanvasQuickToolIdV1 =
  "draw" | "erase" | "line" | "note" | "select" | "shape" | "text";

export type CanvasQuickToolFlyoutV1 = "draw" | "line" | "note" | "shape";

export type CanvasBrushStyleIdV1 = "fine" | "marker" | "highlighter" | "pencil";

export interface CanvasBrushStyleV1 {
  readonly id: CanvasBrushStyleIdV1;
  readonly label: string;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}

export interface CanvasBrushSettingsV1 {
  readonly color: string;
  readonly opacity: number;
  readonly presetId: CanvasBrushStyleIdV1;
  readonly width: number;
}

export const canvasQuickToolDefinitionsV1 = [
  {
    id: "select",
    label: "选择",
    hasFlyout: false,
  },
  {
    id: "draw",
    label: "画笔",
    hasFlyout: true,
  },
  {
    id: "shape",
    label: "形状",
    hasFlyout: true,
  },
  {
    id: "line",
    label: "线条",
    hasFlyout: true,
  },
  {
    id: "note",
    label: "便签",
    hasFlyout: true,
  },
  {
    id: "text",
    label: "文字",
    hasFlyout: false,
  },
] as const satisfies readonly {
  readonly hasFlyout: boolean;
  readonly id: CanvasQuickToolIdV1;
  readonly label: string;
}[];

export const canvasBrushStylesV1 = [
  {
    id: "fine",
    label: "细笔",
    color: "#3048f5",
    width: 3,
    opacity: 1,
  },
  {
    id: "marker",
    label: "马克笔",
    color: "#ef3340",
    width: 10,
    opacity: 0.92,
  },
  {
    id: "highlighter",
    label: "荧光笔",
    color: "#ffd21f",
    width: 22,
    opacity: 0.46,
  },
  {
    id: "pencil",
    label: "铅笔",
    color: "#3f4650",
    width: 4,
    opacity: 0.72,
  },
] as const satisfies readonly CanvasBrushStyleV1[];

export function canvasBrushSettingsForStyleV1(
  presetId: CanvasBrushStyleIdV1,
): CanvasBrushSettingsV1 {
  const preset =
    canvasBrushStylesV1.find((candidate) => candidate.id === presetId) ??
    canvasBrushStylesV1[0];
  return {
    color: preset.color,
    opacity: preset.opacity,
    presetId: preset.id,
    width: preset.width,
  };
}

export function updateCanvasBrushSettingsV1(
  settings: CanvasBrushSettingsV1,
  patch: Partial<Omit<CanvasBrushSettingsV1, "presetId">>,
): CanvasBrushSettingsV1 {
  return {
    ...settings,
    ...(patch.color === undefined ? {} : { color: patch.color }),
    ...(patch.opacity === undefined
      ? {}
      : { opacity: Math.max(0.05, Math.min(1, patch.opacity)) }),
    ...(patch.width === undefined
      ? {}
      : { width: Math.max(1, Math.min(48, patch.width)) }),
  };
}

export function canvasFreehandEraserTargetIdV1(
  page: EditorRuntimePageV1,
  nodeId: string | undefined,
): string | undefined {
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  return node?.kind === "line" &&
    node.role === "freehand" &&
    node.visible &&
    !node.locked
    ? node.id
    : undefined;
}

export function appendCanvasFreehandEraserTargetV1(
  nodeIds: readonly string[],
  nodeId: string | undefined,
): readonly string[] {
  return !nodeId || nodeIds.includes(nodeId) ? nodeIds : [...nodeIds, nodeId];
}

export const canvasQuickNoteColorsV1 = [
  { label: "黄色", color: "#ffd21f" },
  { label: "橙色", color: "#ffb85a" },
  { label: "粉色", color: "#ff768d" },
  { label: "蓝色", color: "#7ab8ff" },
  { label: "绿色", color: "#59d687" },
  { label: "紫色", color: "#b77cff" },
] as const;

export function canvasQuickToolMenuStateV1(
  currentFlyout: CanvasQuickToolFlyoutV1 | undefined,
  requested: CanvasQuickToolIdV1,
): {
  readonly activeTool: CanvasQuickToolIdV1;
  readonly flyout?: CanvasQuickToolFlyoutV1;
} {
  const definition = canvasQuickToolDefinitionsV1.find(
    (tool) => tool.id === requested,
  )!;
  if (definition.hasFlyout && currentFlyout === requested) {
    return {
      activeTool: "select",
    };
  }
  return {
    activeTool: requested === "text" ? "select" : requested,
    ...(definition.hasFlyout
      ? {
          flyout: requested as CanvasQuickToolFlyoutV1,
        }
      : {}),
  };
}

function shapeReference(definitionId: string): EditorCatalogReferenceV1 {
  const definition = canvasShapeCatalogV1.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!definition) {
    throw new Error(`Quick shape ${definitionId} is not available.`);
  }
  return {
    catalogId: "kanvas.core.shapes",
    definitionId: definition.definitionId,
    revision: definition.revision,
  };
}

function lineReference(definitionId: string): EditorCatalogReferenceV1 {
  const definition = canvasLineCatalogV1.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!definition) {
    throw new Error(`Quick line ${definitionId} is not available.`);
  }
  return {
    catalogId: "kanvas.core.lines",
    definitionId: definition.definitionId,
    revision: definition.revision,
  };
}

const quickShapeDefinitions = [
  ["矩形", "basic.rectangle"],
  ["圆角矩形", "basic.rounded-rectangle"],
  ["圆形", "basic.ellipse"],
  ["三角形", "basic.triangle"],
  ["直角三角形", "basic.right-triangle"],
  ["菱形", "basic.diamond"],
  ["五边形", "basic.polygon-5"],
  ["六边形", "basic.polygon-6"],
] as const;

export const canvasQuickShapePresetsV1 = quickShapeDefinitions.map(
  ([label, definitionId]) => ({
    label,
    reference: shapeReference(definitionId),
  }),
) satisfies readonly {
  readonly label: string;
  readonly reference: EditorCatalogReferenceV1;
}[];

const quickLineDefinitions = [
  ["直线", "line.straight"],
  ["曲线", "line.curve"],
  ["折线", "line.elbow"],
] as const;

export const canvasQuickLinePresetsV1 = quickLineDefinitions.map(
  ([label, definitionId]) => ({
    label,
    reference: lineReference(definitionId),
  }),
) satisfies readonly {
  readonly label: string;
  readonly reference: EditorCatalogReferenceV1;
}[];

export interface CanvasFreehandPointV1 {
  readonly x: number;
  readonly y: number;
}

function distance(
  left: CanvasFreehandPointV1,
  right: CanvasFreehandPointV1,
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function appendCanvasFreehandPointV1(
  points: readonly CanvasFreehandPointV1[],
  point: CanvasFreehandPointV1,
  minimumDistance: number,
): readonly CanvasFreehandPointV1[] {
  const previous = points.at(-1);
  return previous && distance(previous, point) < Math.max(0, minimumDistance)
    ? points
    : [...points, point];
}

function samplePoints(
  points: readonly CanvasFreehandPointV1[],
  maximum = 256,
): readonly CanvasFreehandPointV1[] {
  if (points.length <= maximum) {
    return points;
  }
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (maximum - 1),
    );
    return points[sourceIndex]!;
  });
}

export function canvasFreehandPreviewPathV1(
  points: readonly CanvasFreehandPointV1[],
): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${String(point.x)} ${String(point.y)}`,
    )
    .join(" ");
}

export function createCanvasFreehandNodeV1({
  color,
  id,
  name = "画笔笔触",
  opacity = 1,
  points,
  width,
}: {
  readonly color: string;
  readonly id: string;
  readonly name?: string;
  readonly opacity?: number;
  readonly points: readonly CanvasFreehandPointV1[];
  readonly width: number;
}): EditorLineNodeV1 | undefined {
  if (points.length === 0) {
    return undefined;
  }
  const sampled = samplePoints(points);
  const effective =
    sampled.length === 1
      ? [
          sampled[0]!,
          {
            x: sampled[0]!.x + 0.01,
            y: sampled[0]!.y + 0.01,
          },
        ]
      : sampled;
  const strokeWidth = Math.max(1, Math.min(1_024, width));
  const padding = Math.max(1, strokeWidth / 2);
  const xs = effective.map((point) => point.x);
  const ys = effective.map((point) => point.y);
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const nodeWidth = Math.min(
    32_768,
    Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
  );
  const nodeHeight = Math.min(
    32_768,
    Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
  );
  const normalized = (value: number) => Math.max(-8, Math.min(8, value));
  return {
    id,
    name,
    kind: "line",
    transform: {
      x: left,
      y: top,
      width: nodeWidth,
      height: nodeHeight,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: Math.max(0, Math.min(1, opacity)),
    blendMode: "normal",
    visible: true,
    locked: false,
    pathKind: "polyline",
    points: effective.map((point) => ({
      x: normalized((point.x - left) / nodeWidth),
      y: normalized((point.y - top) / nodeHeight),
    })),
    stroke: {
      paint: {
        kind: "solid",
        color,
      },
      width: strokeWidth,
      alignment: "center",
    },
    startCap: "none",
    endCap: "none",
    role: "freehand",
    capStyle: "round",
    joinStyle: "round",
  };
}
