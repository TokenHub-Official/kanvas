import type {
  EditorRuntimeNodeV1,
  EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";
import type { EditorNodeInsertionTarget } from "./editor-node-insertion.js";

export type CanvasMediaContentTargetV1 =
  | { readonly kind: "frame"; readonly nodeId: string }
  | {
      readonly kind: "grid";
      readonly nodeId: string;
      readonly slotId: string;
    };

export function canvasMediaInsertionTargetV1(
  target: CanvasMediaContentTargetV1,
  pageId: string,
): EditorNodeInsertionTarget {
  return target.kind === "frame"
    ? { kind: "frame_content", pageId, frameId: target.nodeId }
    : {
        kind: "grid_cell",
        pageId,
        gridId: target.nodeId,
        slotId: target.slotId,
      };
}

const minimumZoom = 1;
const maximumZoom = 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function canvasMediaTargetImageV1(
  node: EditorRuntimeNodeV1,
  target: CanvasMediaContentTargetV1,
): EditorRuntimePlacedImageV1 | undefined {
  if (node.id !== target.nodeId) return undefined;
  if (target.kind === "frame") {
    return node.kind === "frame" ? node.content?.image : undefined;
  }
  return node.kind === "grid"
    ? node.cells.find((cell) => cell.slotId === target.slotId)?.content?.image
    : undefined;
}

export function canvasMediaTargetNodeWithImageV1(
  node: EditorRuntimeNodeV1,
  target: CanvasMediaContentTargetV1,
  image: EditorRuntimePlacedImageV1,
): EditorRuntimeNodeV1 {
  if (node.id !== target.nodeId) return node;
  if (target.kind === "frame" && node.kind === "frame") {
    return { ...node, content: { image } };
  }
  if (target.kind === "grid" && node.kind === "grid") {
    return {
      ...node,
      cells: node.cells.map((cell) =>
        cell.slotId === target.slotId ? { ...cell, content: { image } } : cell,
      ),
    };
  }
  return node;
}

export function canvasPlacedImageZoomV1(
  image: EditorRuntimePlacedImageV1,
): number {
  return clamp(
    1 / Math.max(image.crop.width, image.crop.height),
    minimumZoom,
    maximumZoom,
  );
}

function cropAroundFocalPoint(
  image: EditorRuntimePlacedImageV1,
  focalPoint: { readonly x: number; readonly y: number },
  zoom: number,
): EditorRuntimePlacedImageV1 {
  const size = 1 / clamp(zoom, minimumZoom, maximumZoom);
  const x = clamp(focalPoint.x - size / 2, 0, 1 - size);
  const y = clamp(focalPoint.y - size / 2, 0, 1 - size);
  return {
    ...image,
    focalPoint: {
      x: clamp(focalPoint.x, 0, 1),
      y: clamp(focalPoint.y, 0, 1),
    },
    crop: { x, y, width: size, height: size },
  };
}

export function canvasPlacedImageWithZoomV1(
  image: EditorRuntimePlacedImageV1,
  zoom: number,
): EditorRuntimePlacedImageV1 {
  return cropAroundFocalPoint(image, image.focalPoint, zoom);
}

export function canvasPlacedImageWithFocalPointV1(
  image: EditorRuntimePlacedImageV1,
  x: number,
  y: number,
): EditorRuntimePlacedImageV1 {
  return cropAroundFocalPoint(image, { x, y }, canvasPlacedImageZoomV1(image));
}

export function canvasPlacedImageWithFitV1(
  image: EditorRuntimePlacedImageV1,
  fit: EditorRuntimePlacedImageV1["fit"],
): EditorRuntimePlacedImageV1 {
  return { ...image, fit };
}
