import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";
import type { ResourceImageCandidate } from "@kanvas/contracts/resource-source";
import type { TFunction } from "i18next";

import type { CanvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import type { EditorActionV1 } from "./editor-state-v1.js";
import { topLevelNodeIdForLocalImage } from "./canvas-workspace-model-v1.js";
import type { CanvasTextStyleSnapshotV1 } from "./canvas-text-style-v1.js";

const defaultCatalogGraphicSize = 240;
const defaultExternalImageSize = 1200;

export function canvasExternalImagePreviewInsertionV1(
  candidate: ResourceImageCandidate,
  localId: string,
): Extract<EditorNodeInsertionPayload, { kind: "image" }> | undefined {
  if (
    candidate.kind !== "image" ||
    candidate.preview.mediaType === "image/svg+xml"
  ) {
    return undefined;
  }
  const sizedMedia =
    candidate.original.width && candidate.original.height
      ? candidate.original
      : candidate.preview;
  return {
    kind: "image",
    source: {
      kind: "clipboard",
      localId,
      mediaType: candidate.preview.mediaType,
      name: candidate.title,
      previewUrl: candidate.preview.url,
    },
    intrinsicSize: {
      width: sizedMedia.width ?? defaultExternalImageSize,
      height: sizedMedia.height ?? defaultExternalImageSize,
    },
  };
}

export interface CanvasTextInsertionOptionsV1 {
  readonly editImmediately?: boolean;
  readonly font?: {
    readonly family?: string;
    readonly fontId: string;
    readonly revision: string;
    readonly source?: "builtin" | "workspace";
  };
  readonly preset?: EditorCatalogReferenceV1;
  readonly style?: CanvasTextStyleSnapshotV1;
  readonly text?: string;
}

export function createCanvasInsertionCommandsV1({
  beginTextEditing,
  focusStage,
  insert,
  mutate,
  page,
  selectedNodes,
  t,
}: {
  readonly beginTextEditing: (nodeId: string, value: string) => void;
  readonly focusStage: () => void;
  readonly insert: (payload: EditorNodeInsertionPayload) => string;
  readonly mutate: (action: EditorActionV1) => void;
  readonly page: EditorRuntimePageV1;
  readonly selectedNodes: readonly EditorRuntimeNodeV1[];
  readonly t: TFunction;
}) {
  const insertFrame = (definition: EditorCatalogReferenceV1) => {
    insert({ kind: "frame", definition });
    focusStage();
  };

  const insertGraphic = (definition: CanvasGraphicDefinitionV1) => {
    insert({
      kind: "graphic",
      source: {
        kind: "catalog",
        catalogId: definition.catalogId,
        resourceId: definition.resourceId,
        revision: definition.revision,
      },
      intrinsicSize: {
        width: defaultCatalogGraphicSize * definition.defaultAspectRatio,
        height: defaultCatalogGraphicSize,
      },
    });
    focusStage();
  };

  const insertGrid = (definition: EditorCatalogReferenceV1) => {
    insert({ kind: "grid", definition });
    focusStage();
  };

  const insertLine = (definition: EditorCatalogReferenceV1) => {
    insert({ kind: "line", definition });
    focusStage();
  };

  const insertNote = (color: string) => {
    const value = t("canvas.editor.stickyText");
    const nodeId = insert({
      kind: "note",
      color,
      text: value,
    });
    beginTextEditing(nodeId, value);
  };

  const insertShape = (definition: EditorCatalogReferenceV1) => {
    insert({ kind: "shape", definition });
    focusStage();
  };

  const insertText = (options?: CanvasTextInsertionOptionsV1) => {
    const value = options?.text ?? t("canvas.editor.bodyText");
    const nodeId = insert({
      kind: "text",
      text: value,
      ...(options?.preset ? { preset: options.preset } : {}),
      ...(options?.font ? { font: options.font } : {}),
      ...(options?.style ? { style: options.style } : {}),
    });
    if (options?.editImmediately) {
      beginTextEditing(nodeId, value);
    }
  };

  const selectUpload = (id: string) => {
    const nodeId = topLevelNodeIdForLocalImage(page.nodes, id);
    if (!nodeId) {
      return;
    }
    mutate({ type: "select", id: nodeId });
    focusStage();
  };

  const applySelectedImageAsBackground = () => {
    const selected = selectedNodes[0];
    if (
      selectedNodes.length !== 1 ||
      selected?.kind !== "image" ||
      selected.locked
    ) {
      return;
    }
    mutate({
      type: "set_image_node_as_background",
      pageId: page.id,
      nodeId: selected.id,
    });
  };

  return {
    applySelectedImageAsBackground,
    insertFrame,
    insertGraphic,
    insertGrid,
    insertLine,
    insertNote,
    insertShape,
    insertText,
    selectUpload,
  } as const;
}
