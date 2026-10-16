import type { EditorLineBindingV1 } from "@kanvas/contracts/editor";

import {
  editorRectCenterV1,
  rotateEditorPointV1,
  type EditorPointV1,
} from "./editor-geometry-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  updateCanvasLineWorldPointV1,
  type CanvasEditableLineV1,
} from "./canvas-line-editing-v1.js";

export type CanvasLineEndpointV1 = "end" | "start";

export interface CanvasShapeConnectionAnchorV1 {
  readonly anchor: EditorLineBindingV1["anchor"];
  readonly binding: EditorLineBindingV1;
  readonly point: EditorPointV1;
}

const anchorPositions = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
} as const;

type CanvasShapeNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "shape" }>;

export function canvasShapeConnectionAnchorsV1(
  node: CanvasShapeNodeV1,
): readonly CanvasShapeConnectionAnchorV1[] {
  const center = editorRectCenterV1(node.transform);
  return Object.entries(anchorPositions).map(([anchor, position]) => {
    const localX = position.x * node.transform.width;
    const localY = position.y * node.transform.height;
    const flipped = {
      x: node.transform.flipX ? node.transform.width - localX : localX,
      y: node.transform.flipY ? node.transform.height - localY : localY,
    };
    const point = rotateEditorPointV1(
      {
        x: node.transform.x + flipped.x,
        y: node.transform.y + flipped.y,
      },
      center,
      node.transform.rotation,
    );
    return {
      anchor: anchor as EditorLineBindingV1["anchor"],
      binding: {
        anchor: anchor as EditorLineBindingV1["anchor"],
        nodeId: node.id,
      },
      point,
    };
  });
}

export function canvasPageConnectionAnchorsV1(
  nodes: readonly EditorRuntimeNodeV1[],
): readonly CanvasShapeConnectionAnchorV1[] {
  return nodes.flatMap((node) =>
    node.kind === "shape" && node.visible
      ? canvasShapeConnectionAnchorsV1(node)
      : [],
  );
}

function shapeForBinding(
  nodes: readonly EditorRuntimeNodeV1[],
  binding: EditorLineBindingV1,
): CanvasShapeNodeV1 | undefined {
  const node = nodes.find((candidate) => candidate.id === binding.nodeId);
  return node?.kind === "shape" ? node : undefined;
}

export function canvasLineBindingPointV1(
  nodes: readonly EditorRuntimeNodeV1[],
  binding: EditorLineBindingV1,
): EditorPointV1 | undefined {
  const shape = shapeForBinding(nodes, binding);
  if (!shape) return undefined;
  return canvasShapeConnectionAnchorsV1(shape).find(
    (candidate) => candidate.anchor === binding.anchor,
  )?.point;
}

function withoutEndpointBinding(
  line: CanvasEditableLineV1,
  endpoint: CanvasLineEndpointV1,
): CanvasEditableLineV1 {
  if (endpoint === "start") {
    const { startBinding, ...next } = line;
    void startBinding;
    return next;
  }
  const { endBinding, ...next } = line;
  void endBinding;
  return next;
}

export function canvasLineWithEndpointBindingV1(
  line: CanvasEditableLineV1,
  endpoint: CanvasLineEndpointV1,
  binding: EditorLineBindingV1,
  nodes: readonly EditorRuntimeNodeV1[],
): CanvasEditableLineV1 {
  const point = canvasLineBindingPointV1(nodes, binding);
  if (!point) return withoutEndpointBinding(line, endpoint);
  const pointIndex = endpoint === "start" ? 0 : line.points.length - 1;
  const updated = updateCanvasLineWorldPointV1(line, pointIndex, point);
  return endpoint === "start"
    ? { ...updated, startBinding: binding }
    : { ...updated, endBinding: binding };
}

export function canvasLineWithSnappedEndpointV1(
  line: CanvasEditableLineV1,
  pointIndex: number,
  point: EditorPointV1,
  nodes: readonly EditorRuntimeNodeV1[],
  threshold: number,
): CanvasEditableLineV1 {
  let endpoint: CanvasLineEndpointV1 | undefined;
  if (pointIndex === 0) {
    endpoint = "start";
  } else if (pointIndex === line.points.length - 1) {
    endpoint = "end";
  }
  if (!endpoint) return updateCanvasLineWorldPointV1(line, pointIndex, point);
  const nearest = canvasPageConnectionAnchorsV1(nodes).reduce<
    { anchor: CanvasShapeConnectionAnchorV1; distance: number } | undefined
  >((best, anchor) => {
    const distance = Math.hypot(
      anchor.point.x - point.x,
      anchor.point.y - point.y,
    );
    return distance <= threshold && (!best || distance < best.distance)
      ? { anchor, distance }
      : best;
  }, undefined);
  if (nearest) {
    return canvasLineWithEndpointBindingV1(
      line,
      endpoint,
      nearest.anchor.binding,
      nodes,
    );
  }
  return withoutEndpointBinding(
    updateCanvasLineWorldPointV1(line, pointIndex, point),
    endpoint,
  );
}

export function canvasResolveLineBindingsV1(
  nodes: readonly EditorRuntimeNodeV1[],
): readonly EditorRuntimeNodeV1[] {
  let changed = false;
  const resolvedNodes = nodes.map((node) => {
    if (node.kind !== "line" || node.role === "freehand") return node;
    let resolved = node;
    if (resolved.startBinding) {
      resolved = canvasLineWithEndpointBindingV1(
        resolved,
        "start",
        resolved.startBinding,
        nodes,
      );
    }
    if (resolved.endBinding) {
      resolved = canvasLineWithEndpointBindingV1(
        resolved,
        "end",
        resolved.endBinding,
        nodes,
      );
    }
    if (resolved !== node) changed = true;
    return resolved;
  });
  return changed ? resolvedNodes : nodes;
}
