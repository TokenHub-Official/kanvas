import type { TFunction } from "i18next";
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  canvasEscapeEventPathOwnsOverlayV1,
  canvasKeyboardEventPathOwnsInputV1,
  focusCanvasStageAfterPanelActionV1,
} from "./canvas-interaction-boundary-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  editorReducerV1,
  type EditorActionV1,
  type EditorStateV1,
} from "./editor-state-v1.js";
import { activePage, cloneNodeV1 } from "./canvas-workspace-model-v1.js";

const supportedClipboardImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ACCELERATED_MOVEMENT_DELTA = 10;
const ACCELERATED_ROTATION_DELTA = 15;
const CLONED_NODE_ID_SUFFIX_LENGTH = 8;
const PASTED_TEXT_MAX_LENGTH = 20_000;

export function canvasKeyboardMovementV1(
  key: string,
  accelerated: boolean,
): { readonly x: number; readonly y: number } | undefined {
  const delta = accelerated ? ACCELERATED_MOVEMENT_DELTA : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -delta, y: 0 };
    case "ArrowRight":
      return { x: delta, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -delta };
    case "ArrowDown":
      return { x: 0, y: delta };
    default:
      return undefined;
  }
}

export function canvasKeyboardRotationDeltaV1(
  key: string,
  accelerated: boolean,
): number | undefined {
  if (key !== "," && key !== ".") {
    return undefined;
  }
  return (
    (key === "," ? -1 : 1) * (accelerated ? ACCELERATED_ROTATION_DELTA : 1)
  );
}

export function useCanvasKeyboardShortcutsV1({
  addFiles,
  canEdit,
  closeImagePanel,
  closeInspector,
  commitPreview,
  contextMenuOpen,
  fitViewport,
  imagePanelView,
  insert,
  inspectorOpen,
  mutate,
  onCancelImageCrop,
  onCloseContextMenu,
  onClosePendingOperationTool,
  onDismissCanvasUi,
  onShowImagePanelHome,
  pendingOperationToolOpen,
  selectionHasLocked,
  setShortcutsOpen,
  setSpaceHeld,
  setState,
  shortcutsOpen,
  shortcutsTrigger,
  showActualSize,
  stage,
  state,
  t,
  typeToolbar,
}: {
  readonly addFiles: (files: readonly File[]) => Promise<boolean>;
  readonly canEdit: boolean;
  readonly closeImagePanel: () => void;
  readonly closeInspector: () => void;
  readonly commitPreview: () => void;
  readonly contextMenuOpen: boolean;
  readonly fitViewport: () => void;
  readonly imagePanelView: string | undefined;
  readonly insert: (payload: EditorNodeInsertionPayload) => void;
  readonly inspectorOpen: boolean;
  readonly mutate: (action: EditorActionV1) => void;
  readonly onCancelImageCrop: () => void;
  readonly onCloseContextMenu: () => void;
  readonly onClosePendingOperationTool: () => void;
  readonly onDismissCanvasUi: () => void;
  readonly onShowImagePanelHome: () => void;
  readonly pendingOperationToolOpen: boolean;
  readonly selectionHasLocked: boolean;
  readonly setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSpaceHeld: Dispatch<SetStateAction<boolean>>;
  readonly setState: Dispatch<SetStateAction<EditorStateV1>>;
  readonly shortcutsOpen: boolean;
  readonly shortcutsTrigger: RefObject<HTMLButtonElement | null>;
  readonly showActualSize: () => void;
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly state: EditorStateV1;
  readonly t: TFunction;
  readonly typeToolbar: RefObject<HTMLDivElement | null>;
}) {
  const clipboard = useRef<readonly EditorRuntimeNodeV1[]>([]);

  const duplicateSelected = useCallback(() => {
    const page = activePage(state);
    const selected = page.nodes.filter((node) =>
      state.selectedIds.includes(node.id),
    );
    if (selected.length === 0 || selected.some((node) => node.locked)) {
      return;
    }
    mutate({
      type: "add_nodes",
      nodes: selected.map((node) =>
        cloneNodeV1(
          node,
          crypto.randomUUID().slice(0, CLONED_NODE_ID_SUFFIX_LENGTH),
          true,
          t("canvas.names.copySuffix"),
          page,
        ),
      ),
    });
  }, [mutate, state, t]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented) {
        return;
      }
      if (
        event.key === "Escape" &&
        canvasEscapeEventPathOwnsOverlayV1(event.composedPath())
      ) {
        return;
      }
      if (event.key === "Escape" && contextMenuOpen) {
        event.preventDefault();
        onCloseContextMenu();
        focusCanvasStageAfterPanelActionV1(stage.current);
        return;
      }
      if (event.key === "Escape" && shortcutsOpen) {
        event.preventDefault();
        setShortcutsOpen(false);
        window.requestAnimationFrame(() => {
          shortcutsTrigger.current?.focus({
            preventScroll: true,
          });
        });
        return;
      }
      if (event.key === "Escape" && pendingOperationToolOpen) {
        event.preventDefault();
        onClosePendingOperationTool();
        onShowImagePanelHome();
        return;
      }
      if (event.key === "Escape" && imagePanelView) {
        event.preventDefault();
        if (imagePanelView === "crop") {
          onCancelImageCrop();
        } else if (imagePanelView !== "home") {
          commitPreview();
          onShowImagePanelHome();
        } else {
          closeImagePanel();
        }
        return;
      }
      if (event.key === "Escape" && inspectorOpen) {
        event.preventDefault();
        closeInspector();
        return;
      }
      const textEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "Escape" && !textEntry) {
        event.preventDefault();
        onDismissCanvasUi();
        return;
      }
      if (canvasKeyboardEventPathOwnsInputV1(event.composedPath())) {
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key === "F1") {
        event.preventDefault();
        typeToolbar.current
          ?.querySelector<HTMLElement>("button, select, input")
          ?.focus();
        return;
      }
      if (command && event.key === "F2") {
        event.preventDefault();
        stage.current?.focus();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (command && event.key === "0") {
        event.preventDefault();
        fitViewport();
        return;
      }
      if (command && event.key === "1") {
        event.preventDefault();
        showActualSize();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (command && event.key.toLowerCase() === "z") {
        if (!canEdit) {
          return;
        }
        event.preventDefault();
        mutate({
          type: event.shiftKey ? "redo" : "undo",
        });
        return;
      }
      if (command && event.key.toLowerCase() === "d") {
        if (!canEdit) {
          return;
        }
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (
        command &&
        (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "x")
      ) {
        const selected = activePage(state).nodes.filter((node) =>
          state.selectedIds.includes(node.id),
        );
        if (selected.length > 0) {
          event.preventDefault();
          clipboard.current = selected;
          if (
            event.key.toLowerCase() === "x" &&
            canEdit &&
            !selected.some((node) => node.locked)
          ) {
            mutate({ type: "delete_selected" });
          }
        }
        return;
      }
      if (
        command &&
        canEdit &&
        event.key.toLowerCase() === "v" &&
        clipboard.current.length > 0 &&
        clipboard.current.every((node) => !node.locked)
      ) {
        event.preventDefault();
        const page = activePage(state);
        mutate({
          type: "add_nodes",
          nodes: clipboard.current.map((node) =>
            cloneNodeV1(
              node,
              crypto.randomUUID().slice(0, CLONED_NODE_ID_SUFFIX_LENGTH),
              true,
              t("canvas.names.copySuffix"),
              page,
            ),
          ),
        });
        return;
      }
      if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const nodes = activePage(state).nodes.filter((node) => node.visible);
        if (nodes.length > 0) {
          let next = editorReducerV1(state, {
            type: "select",
            id: nodes[0]!.id,
          });
          for (const node of nodes.slice(1)) {
            next = editorReducerV1(next, {
              type: "select",
              id: node.id,
              mode: "add",
            });
          }
          setState(next);
        }
        return;
      }
      if (
        canEdit &&
        !selectionHasLocked &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        event.preventDefault();
        mutate({ type: "delete_selected" });
        return;
      }
      if (
        canEdit &&
        (event.key === "," || event.key === ".") &&
        state.selectedIds.length === 1
      ) {
        const node = activePage(state).nodes.find(
          (candidate) =>
            candidate.id === state.selectedIds[0] && !candidate.locked,
        );
        if (node) {
          event.preventDefault();
          const delta = canvasKeyboardRotationDeltaV1(
            event.key,
            event.shiftKey,
          )!;
          mutate({
            type: "transform_nodes",
            transforms: [
              {
                id: node.id,
                transform: {
                  ...node.transform,
                  rotation: node.transform.rotation + delta,
                },
              },
            ],
          });
        }
        return;
      }
      const movement = canvasKeyboardMovementV1(event.key, event.shiftKey);
      if (
        canEdit &&
        !selectionHasLocked &&
        movement &&
        state.selectedIds.length > 0
      ) {
        event.preventDefault();
        const nodes = activePage(state).nodes.filter((node) =>
          state.selectedIds.includes(node.id),
        );
        mutate({
          type: "transform_nodes",
          transforms: nodes.map((node) => ({
            id: node.id,
            transform: {
              ...node.transform,
              x: node.transform.x + movement.x,
              y: node.transform.y + movement.y,
            },
          })),
        });
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [
    canEdit,
    closeImagePanel,
    closeInspector,
    commitPreview,
    contextMenuOpen,
    duplicateSelected,
    fitViewport,
    imagePanelView,
    inspectorOpen,
    mutate,
    onCloseContextMenu,
    onCancelImageCrop,
    onClosePendingOperationTool,
    onDismissCanvasUi,
    onShowImagePanelHome,
    pendingOperationToolOpen,
    selectionHasLocked,
    setShortcutsOpen,
    setSpaceHeld,
    setState,
    shortcutsOpen,
    shortcutsTrigger,
    showActualSize,
    stage,
    state,
    t,
    typeToolbar,
  ]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        !canEdit ||
        canvasKeyboardEventPathOwnsInputV1(event.composedPath())
      ) {
        return;
      }
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        supportedClipboardImageTypes.has(file.type),
      );
      if (files.length > 0) {
        event.preventDefault();
        void addFiles(files);
        return;
      }
      const text = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (text) {
        event.preventDefault();
        insert({
          kind: "text",
          text: text.slice(0, PASTED_TEXT_MAX_LENGTH),
        });
      }
    };
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("paste", paste);
    };
  }, [addFiles, canEdit, insert]);

  return {
    duplicateSelected,
  };
}
