import type { TFunction } from "i18next";
import {
  useState,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  canvasStageTargetClearsSelectionV1,
  canvasTextEditingDraftForDoubleClickV1,
  canvasTextNodeIdForDoubleClickV1,
  focusCanvasStageAfterPanelActionV1,
  type CanvasTextEditingDraftV1,
} from "./canvas-interaction-boundary-v1.js";
import type { EditorPointV1 } from "./editor-geometry-v1.js";
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import type { EditorActionV1 } from "./editor-state-v1.js";
import {
  cloneNodeV1,
  eventTopLevelNodeId,
  shapeTextNodeForEditingV1,
  textNodeValue,
  topLevelNode,
} from "./canvas-workspace-model-v1.js";

const clonedNodeIdLength = 8;

export interface CanvasContextMenuV1 {
  readonly nodeId: string;
}

export function useCanvasStageInteractionsV1({
  canEdit,
  commitPreview,
  hideEditorPanels,
  mutate,
  page,
  pagePoint,
  selectedNodes,
  setEditingText,
  stage,
  t,
}: {
  readonly canEdit: boolean;
  readonly commitPreview: () => void;
  readonly hideEditorPanels: () => void;
  readonly mutate: (action: EditorActionV1) => void;
  readonly page: EditorRuntimePageV1;
  readonly pagePoint: (clientX: number, clientY: number) => EditorPointV1;
  readonly selectedNodes: readonly EditorRuntimeNodeV1[];
  readonly setEditingText: Dispatch<
    SetStateAction<CanvasTextEditingDraftV1 | undefined>
  >;
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly t: TFunction;
}) {
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuV1>();
  const contextMenuNode = contextMenu
    ? topLevelNode(page, contextMenu.nodeId)
    : undefined;

  const closeContextMenu = () => {
    setContextMenu(undefined);
  };

  const handleStagePointerDown = (event: PointerEvent<HTMLElement>) => {
    const target = event.target;
    const classNames = target instanceof Element ? [...target.classList] : [];
    if (!canvasStageTargetClearsSelectionV1(classNames, event.button)) {
      return;
    }
    commitPreview();
    hideEditorPanels();
    closeContextMenu();
    mutate({ type: "clear_selection" });
    event.currentTarget.focus();
  };

  const openNodeContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const pointerEvent = event as unknown as PointerEvent<HTMLDivElement>;
    const nodeId = eventTopLevelNodeId(pointerEvent, page);
    if (!nodeId) {
      return;
    }
    event.preventDefault();
    commitPreview();
    hideEditorPanels();
    mutate({ type: "select", id: nodeId });
    const node = topLevelNode(page, nodeId);
    if (!canEdit || node?.locked) {
      focusCanvasStageAfterPanelActionV1(stage.current);
      return;
    }
    setContextMenu({
      nodeId,
    });
  };

  const beginTextEditing = (event: MouseEvent<HTMLDivElement>) => {
    const nodeId = canvasTextNodeIdForDoubleClickV1(
      eventTopLevelNodeId(event, page),
      selectedNodes.length === 1 ? selectedNodes[0] : undefined,
      pagePoint(event.clientX, event.clientY),
    );
    const node = nodeId ? topLevelNode(page, nodeId) : undefined;
    const editableText = node ? shapeTextNodeForEditingV1(node) : undefined;
    if (!node || !editableText || node.locked || !canEdit) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitPreview();
    hideEditorPanels();
    mutate({ type: "select", id: node.id });
    setEditingText((current) =>
      canvasTextEditingDraftForDoubleClickV1(
        current,
        node.id,
        textNodeValue(editableText),
      ),
    );
  };

  const duplicateContextMenuNode = () => {
    if (!contextMenuNode) {
      return;
    }
    mutate({
      type: "add_node",
      pageId: page.id,
      node: cloneNodeV1(
        contextMenuNode,
        crypto.randomUUID().slice(0, clonedNodeIdLength),
        true,
        t("canvas.names.copySuffix"),
        page,
      ),
    });
  };

  const bringContextMenuNodeToFront = () => {
    if (!contextMenu) {
      return;
    }
    mutate({
      type: "move_layer",
      id: contextMenu.nodeId,
      move: "to_front",
    });
  };

  const sendContextMenuNodeToBack = () => {
    if (!contextMenu) {
      return;
    }
    mutate({
      type: "move_layer",
      id: contextMenu.nodeId,
      move: "to_back",
    });
  };

  const applyContextMenuImageAsBackground = () => {
    if (contextMenuNode?.kind !== "image") {
      return;
    }
    mutate({
      type: "set_image_node_as_background",
      pageId: page.id,
      nodeId: contextMenuNode.id,
    });
  };

  const deleteContextMenuNode = () => {
    if (!contextMenu) {
      return;
    }
    mutate({
      type: "delete_nodes",
      ids: [contextMenu.nodeId],
      pageId: page.id,
    });
  };

  return {
    applyContextMenuImageAsBackground,
    beginTextEditing,
    bringContextMenuNodeToFront,
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    deleteContextMenuNode,
    duplicateContextMenuNode,
    handleStagePointerDown,
    openNodeContextMenu,
    sendContextMenuNodeToBack,
  } as const;
}
