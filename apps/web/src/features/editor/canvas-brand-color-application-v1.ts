import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export type CanvasBrandColorTargetV1 = "page" | "shape" | "text";

export function canvasBrandColorTargetV1(
  selectedNodes: readonly EditorRuntimeNodeV1[],
): CanvasBrandColorTargetV1 {
  if (selectedNodes.length !== 1) return "page";
  const selected = selectedNodes[0];
  if (!selected || selected.locked) return "page";
  if (selected.kind === "text") return "text";
  if (selected.kind === "shape") return "shape";
  return "page";
}
