import {
  editorNodeBoundsV1,
  type EditorPointV1,
} from "./editor-geometry-v1.js";
import type { EditorNodeInsertionTarget } from "./editor-node-insertion.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";
import { canvasGridDefinitionV1 } from "./frame-grid-catalog-v1.js";

const HALF_TURN_DEGREES = 180;

export function canvasImageInsertionTargetAtPointV1(
  page: EditorRuntimePageV1,
  point: EditorPointV1,
): EditorNodeInsertionTarget {
  for (const node of [...page.nodes].reverse()) {
    if (!node.visible || node.locked) {
      continue;
    }
    const bounds = editorNodeBoundsV1(node);
    if (
      point.x < bounds.x ||
      point.x > bounds.x + bounds.width ||
      point.y < bounds.y ||
      point.y > bounds.y + bounds.height
    ) {
      continue;
    }
    if (node.kind === "frame") {
      return {
        kind: "frame_content",
        pageId: page.id,
        frameId: node.id,
      };
    }
    if (node.kind === "grid") {
      const center = {
        x: node.transform.x + node.transform.width / 2,
        y: node.transform.y + node.transform.height / 2,
      };
      const radians = (-node.transform.rotation * Math.PI) / HALF_TURN_DEGREES;
      const relativeX = point.x - center.x;
      const relativeY = point.y - center.y;
      const localX =
        center.x +
        relativeX * Math.cos(radians) -
        relativeY * Math.sin(radians) -
        node.transform.x;
      const localY =
        center.y +
        relativeX * Math.sin(radians) +
        relativeY * Math.cos(radians) -
        node.transform.y;
      const definition = canvasGridDefinitionV1(node.definition);
      const slot = definition.slots.find(
        (candidate) =>
          localX >= candidate.x * node.transform.width &&
          localX <= (candidate.x + candidate.width) * node.transform.width &&
          localY >= candidate.y * node.transform.height &&
          localY <= (candidate.y + candidate.height) * node.transform.height,
      );
      if (slot) {
        return {
          kind: "grid_cell",
          pageId: page.id,
          gridId: node.id,
          slotId: slot.id,
        };
      }
    }
  }
  return {
    kind: "canvas_point",
    pageId: page.id,
    point,
  };
}
