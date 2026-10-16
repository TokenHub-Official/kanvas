import type { WorkspaceAssetPickIntent } from "../assets/workspace-asset-picker.js";
import type { CanvasMediaContentTargetV1 } from "./canvas-media-container-v1.js";
import { canvasMediaInsertionTargetV1 } from "./canvas-media-container-v1.js";
import type { EditorNodeInsertionTarget } from "./editor-node-insertion.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export function canvasAssetInsertionTargetV1({
  intent,
  mediaTarget,
  pageId,
  selectedNode,
}: {
  readonly intent: WorkspaceAssetPickIntent;
  readonly mediaTarget?: CanvasMediaContentTargetV1;
  readonly pageId: string;
  readonly selectedNode?: EditorRuntimeNodeV1;
}): EditorNodeInsertionTarget | undefined {
  if (intent === "add") {
    return undefined;
  }
  if (intent === "background") {
    return { kind: "page_background", pageId };
  }
  if (intent === "replace") {
    if (selectedNode?.kind !== "image" || selectedNode.locked) {
      throw new Error("Replacing an asset requires one unlocked image.");
    }
    return {
      kind: "replace_node_content",
      nodeId: selectedNode.id,
      pageId,
    };
  }
  const resolvedMediaTarget =
    mediaTarget ??
    (selectedNode?.kind === "frame" && !selectedNode.locked
      ? { kind: "frame" as const, nodeId: selectedNode.id }
      : undefined);
  if (!resolvedMediaTarget) {
    throw new Error(
      "Filling an asset requires an unlocked frame or grid cell.",
    );
  }
  return canvasMediaInsertionTargetV1(resolvedMediaTarget, pageId);
}
