import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export interface EditorPointV1 {
  readonly x: number;
  readonly y: number;
}

export interface EditorRectV1 extends EditorPointV1 {
  readonly height: number;
  readonly width: number;
}

export type EditorResizeHandleV1 =
  "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface EditorSnapResultV1 {
  readonly guides: {
    readonly x?: number;
    readonly y?: number;
  };
  readonly rect: EditorRectV1;
}

const minimumNodeSize = 12;

export function editorRectCenterV1(rect: EditorRectV1): EditorPointV1 {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function rotateEditorPointV1(
  point: EditorPointV1,
  center: EditorPointV1,
  degrees: number,
): EditorPointV1 {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

export function editorNodeBoundsV1(node: EditorRuntimeNodeV1): EditorRectV1 {
  const rect = node.transform;
  const rotation = ((rect.rotation % 360) + 360) % 360;
  if (rotation < 0.001) {
    return rect;
  }
  const center = editorRectCenterV1(rect);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    {
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    },
    { x: rect.x, y: rect.y + rect.height },
  ].map((point) => rotateEditorPointV1(point, center, rotation));
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function editorSelectionBoundsV1(
  nodes: readonly EditorRuntimeNodeV1[],
): EditorRectV1 | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const bounds = nodes.map(editorNodeBoundsV1);
  const left = Math.min(...bounds.map((rect) => rect.x));
  const top = Math.min(...bounds.map((rect) => rect.y));
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function candidateAxes(
  page: {
    readonly height: number;
    readonly width: number;
  },
  nodes: readonly EditorRuntimeNodeV1[],
  excludedIds: ReadonlySet<string>,
) {
  const x = [0, page.width / 2, page.width];
  const y = [0, page.height / 2, page.height];
  for (const node of nodes) {
    if (excludedIds.has(node.id) || !node.visible) {
      continue;
    }
    const bounds = editorNodeBoundsV1(node);
    x.push(bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width);
    y.push(bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height);
  }
  return { x, y };
}

function nearestAdjustment(
  anchors: readonly number[],
  candidates: readonly number[],
  threshold: number,
) {
  let adjustment = 0;
  let distance = threshold + 1;
  let guide: number | undefined;
  for (const anchor of anchors) {
    for (const candidate of candidates) {
      const nextAdjustment = candidate - anchor;
      const nextDistance = Math.abs(nextAdjustment);
      if (nextDistance <= threshold && nextDistance < distance) {
        adjustment = nextAdjustment;
        distance = nextDistance;
        guide = candidate;
      }
    }
  }
  return {
    adjustment,
    ...(guide === undefined ? {} : { guide }),
  };
}

export function snapEditorNodeMoveV1(
  rect: EditorRectV1,
  page: {
    readonly height: number;
    readonly width: number;
  },
  nodes: readonly EditorRuntimeNodeV1[],
  excludedIds: readonly string[],
  threshold: number,
): EditorSnapResultV1 {
  const candidates = candidateAxes(page, nodes, new Set(excludedIds));
  const horizontal = nearestAdjustment(
    [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    candidates.x,
    threshold,
  );
  const vertical = nearestAdjustment(
    [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
    candidates.y,
    threshold,
  );
  return {
    rect: {
      ...rect,
      x: rect.x + horizontal.adjustment,
      y: rect.y + vertical.adjustment,
    },
    guides: {
      ...(horizontal.guide === undefined ? {} : { x: horizontal.guide }),
      ...(vertical.guide === undefined ? {} : { y: vertical.guide }),
    },
  };
}

function oppositeAnchor(
  rect: EditorRectV1,
  handle: EditorResizeHandleV1,
): EditorPointV1 {
  const center = editorRectCenterV1(rect);
  let x = center.x;
  if (handle.includes("w")) {
    x = rect.x + rect.width;
  } else if (handle.includes("e")) {
    x = rect.x;
  }
  let y = center.y;
  if (handle.includes("n")) {
    y = rect.y + rect.height;
  } else if (handle.includes("s")) {
    y = rect.y;
  }
  return {
    x,
    y,
  };
}

function resizeUnrotated(
  original: EditorRectV1,
  handle: EditorResizeHandleV1,
  point: EditorPointV1,
  preserveAspectRatio: boolean,
): EditorRectV1 {
  const right = original.x + original.width;
  const bottom = original.y + original.height;
  let x = original.x;
  let y = original.y;
  let width = original.width;
  let height = original.height;
  if (handle.includes("e")) {
    width = Math.max(minimumNodeSize, point.x - original.x);
  }
  if (handle.includes("s")) {
    height = Math.max(minimumNodeSize, point.y - original.y);
  }
  if (handle.includes("w")) {
    width = Math.max(minimumNodeSize, right - point.x);
    x = right - width;
  }
  if (handle.includes("n")) {
    height = Math.max(minimumNodeSize, bottom - point.y);
    y = bottom - height;
  }
  if (
    preserveAspectRatio &&
    handle.length === 2 &&
    original.width > 0 &&
    original.height > 0
  ) {
    const ratio = original.width / original.height;
    if (width / height > ratio) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (handle.includes("w")) {
      x = right - width;
    }
    if (handle.includes("n")) {
      y = bottom - height;
    }
  }
  return { x, y, width, height };
}

export function resizeEditorNodeV1(
  original: EditorRuntimeNodeV1["transform"],
  handle: EditorResizeHandleV1,
  point: EditorPointV1,
  preserveAspectRatio: boolean,
): EditorRuntimeNodeV1["transform"] {
  const rotation = ((original.rotation % 360) + 360) % 360;
  const center = editorRectCenterV1(original);
  const localPoint = rotateEditorPointV1(point, center, -rotation);
  const resized = resizeUnrotated(
    original,
    handle,
    localPoint,
    preserveAspectRatio,
  );
  if (rotation < 0.001) {
    return {
      ...original,
      ...resized,
    };
  }
  const fixedBefore = rotateEditorPointV1(
    oppositeAnchor(original, handle),
    center,
    rotation,
  );
  const fixedAfter = rotateEditorPointV1(
    oppositeAnchor(resized, handle),
    editorRectCenterV1(resized),
    rotation,
  );
  return {
    ...original,
    ...resized,
    x: resized.x + fixedBefore.x - fixedAfter.x,
    y: resized.y + fixedBefore.y - fixedAfter.y,
  };
}

export function rotateEditorNodeV1(
  original: EditorRuntimeNodeV1["transform"],
  start: EditorPointV1,
  point: EditorPointV1,
  snap: boolean,
): EditorRuntimeNodeV1["transform"] {
  const center = editorRectCenterV1(original);
  const angle = (value: EditorPointV1) =>
    Math.atan2(value.y - center.y, value.x - center.x);
  const degrees =
    original.rotation + ((angle(point) - angle(start)) * 180) / Math.PI;
  const rotation = snap ? Math.round(degrees / 15) * 15 : degrees;
  return {
    ...original,
    rotation: ((rotation % 360) + 360) % 360,
  };
}
