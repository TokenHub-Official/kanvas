import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export type CanvasInspectorModeV1 =
  "common" | "layers" | "position" | "style" | "text-effects" | "text-spacing";

const styleKinds = new Set<EditorRuntimeNodeV1["kind"]>([
  "frame",
  "graphic",
  "grid",
  "line",
  "shape",
]);

const textModes = new Set<CanvasInspectorModeV1>([
  "text-effects",
  "text-spacing",
]);

export function canvasInspectorModeSupportsSelectionV1(
  mode: CanvasInspectorModeV1,
  nodes: readonly Pick<EditorRuntimeNodeV1, "kind">[],
): boolean {
  if (nodes.length === 0) {
    return false;
  }
  if (mode === "layers" || mode === "position") {
    return true;
  }
  if (nodes.length !== 1) {
    return false;
  }
  const node = nodes[0]!;
  if (mode === "common") {
    return true;
  }
  if (mode === "style") {
    return styleKinds.has(node.kind);
  }
  return textModes.has(mode) && node.kind === "text";
}

export function canvasInspectorModeAfterSelectionV1(
  mode: CanvasInspectorModeV1 | undefined,
  nodes: readonly Pick<EditorRuntimeNodeV1, "kind">[],
): CanvasInspectorModeV1 | undefined {
  if (!mode || nodes.length === 0) {
    return undefined;
  }
  if (canvasInspectorModeSupportsSelectionV1(mode, nodes)) {
    return mode;
  }
  return nodes.length === 1 ? "common" : "position";
}

export function toggleCanvasInspectorModeV1(
  current: CanvasInspectorModeV1 | undefined,
  requested: CanvasInspectorModeV1,
): CanvasInspectorModeV1 | undefined {
  if (
    requested === "position" &&
    (current === "position" || current === "layers")
  ) {
    return undefined;
  }
  return current === requested ? undefined : requested;
}

export function canvasInspectorCloseTriggerV1<T>(
  actual: T | null | undefined,
  fallback: T | null | undefined,
): T | undefined {
  return actual ?? fallback ?? undefined;
}
