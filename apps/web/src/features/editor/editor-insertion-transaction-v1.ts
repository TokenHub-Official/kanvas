import {
  adjacentInsertionRect,
  centeredInsertionRect,
  pointedInsertionRect,
  type EditorGraphicInsertionSource,
  type EditorImageInsertionSource,
  type EditorNodeInsertionIntent,
  type EditorRect,
} from "./editor-node-insertion.js";
import {
  createEditorRuntimeNodeV1,
  createEditorRuntimePlacedImageV1,
  defaultEditorNodeSizeV1,
} from "./editor-node-factory-v1.js";
import type { EditorRuntimePlacedImageV1 } from "./editor-runtime-v1.js";
import { editorReducerV1, type EditorStateV1 } from "./editor-state-v1.js";

const INSERTED_NODE_NAME_MAX_LENGTH = 140;

function insertionNodeId(requestId: string): string {
  const normalized = requestId
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, INSERTED_NODE_NAME_MAX_LENGTH);
  return `insert:${normalized || "node"}`;
}

function imagePayload(intent: EditorNodeInsertionIntent): {
  readonly intrinsicSize: {
    readonly height: number;
    readonly width: number;
  };
  readonly source: EditorImageInsertionSource;
} {
  if (intent.payload.kind !== "image") {
    throw new Error(`${intent.target.kind} accepts image content only.`);
  }
  return intent.payload;
}

function placedImage(
  intent: EditorNodeInsertionIntent,
  fit: EditorRuntimePlacedImageV1["fit"],
): EditorRuntimePlacedImageV1 {
  const payload = imagePayload(intent);
  return {
    ...createEditorRuntimePlacedImageV1(payload.source, payload.intrinsicSize),
    fit,
  };
}

function graphicSource(source: EditorGraphicInsertionSource) {
  return source.kind === "artifact" ? source.reference : source;
}

function pageForInsertion(state: EditorStateV1, pageId: string) {
  const page = state.document.pages.find(
    (candidate) => candidate.id === pageId,
  );
  if (!page) {
    throw new Error(`Canvas page ${pageId} does not exist.`);
  }
  return page;
}

export function applyEditorNodeInsertionV1(
  state: EditorStateV1,
  intent: EditorNodeInsertionIntent,
): EditorStateV1 {
  const target = intent.target;
  if (
    target.kind === "canvas_adjacent" ||
    target.kind === "canvas_center" ||
    target.kind === "canvas_point"
  ) {
    const page = pageForInsertion(state, target.pageId);
    const size = defaultEditorNodeSizeV1(intent.payload);
    let rect: EditorRect;
    if (target.kind === "canvas_adjacent") {
      rect = adjacentInsertionRect(
        size,
        target.sourceRect,
        target.visiblePageRect,
      );
    } else if (target.kind === "canvas_center") {
      rect = centeredInsertionRect(size, target.visiblePageRect);
    } else {
      rect = pointedInsertionRect(size, target.point, {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      });
    }
    return editorReducerV1(state, {
      type: "add_node",
      pageId: target.pageId,
      node: createEditorRuntimeNodeV1(
        intent.payload,
        insertionNodeId(intent.requestId),
        rect,
      ),
    });
  }
  if (target.kind === "frame_content") {
    return editorReducerV1(state, {
      type: "set_frame_content",
      pageId: target.pageId,
      frameId: target.frameId,
      image: placedImage(intent, "cover"),
    });
  }
  if (target.kind === "grid_cell") {
    return editorReducerV1(state, {
      type: "set_grid_cell_content",
      pageId: target.pageId,
      gridId: target.gridId,
      slotId: target.slotId,
      image: placedImage(intent, "cover"),
    });
  }
  if (target.kind === "page_background") {
    return editorReducerV1(state, {
      type: "set_page_background",
      pageId: target.pageId,
      background: {
        kind: "image",
        image: placedImage(intent, "cover"),
        opacity: 1,
      },
    });
  }
  if (intent.payload.kind === "image") {
    return editorReducerV1(state, {
      type: "set_image_content",
      pageId: target.pageId,
      nodeId: target.nodeId,
      image: placedImage(intent, "contain"),
    });
  }
  if (intent.payload.kind === "graphic") {
    return editorReducerV1(state, {
      type: "set_graphic_content",
      pageId: target.pageId,
      nodeId: target.nodeId,
      source: graphicSource(intent.payload.source),
    });
  }
  throw new Error(
    "replace_node_content accepts image or graphic content only.",
  );
}
