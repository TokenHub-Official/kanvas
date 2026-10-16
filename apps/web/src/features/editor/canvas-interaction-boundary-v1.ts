import type { EditorTextContentV1 } from "@kanvas/contracts/editor";

import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import { shapeWithDefaultLabelV1 } from "./canvas-workspace-model-v1.js";

const HALF_TURN_DEGREES = 180;

export interface CanvasStoppablePointerEventV1 {
  stopPropagation(): void;
}

export function stopCanvasChromePointerDownV1(
  event: CanvasStoppablePointerEventV1,
): void {
  event.stopPropagation();
}

export function stopCanvasChromeWheelV1(
  event: CanvasStoppablePointerEventV1,
): void {
  event.stopPropagation();
}

export function canvasWheelEventPathOwnsOverlayV1(
  path: readonly EventTarget[],
): boolean {
  return path.some((target) => {
    if (!("getAttribute" in target)) {
      return false;
    }
    return (
      (target as Pick<Element, "getAttribute">).getAttribute(
        "data-canvas-wheel-owner",
      ) !== null
    );
  });
}

export function focusCanvasStageAfterPanelActionV1(
  stage: Pick<HTMLElement, "focus"> | null,
): void {
  stage?.focus({ preventScroll: true });
}

export function focusCanvasTextEditorAtEndV1(
  editor: Pick<
    HTMLTextAreaElement,
    "focus" | "selectionEnd" | "selectionStart" | "value"
  > | null,
): void {
  if (!editor) {
    return;
  }
  const end = editor.value.length;
  editor.focus({ preventScroll: true });
  editor.selectionStart = end;
  editor.selectionEnd = end;
}

const canvasReadOnlyActionsV1 = new Set([
  "clear_selection",
  "cancel_preview",
  "commit_local_image",
  "commit_preview",
  "fail_local_image",
  "select",
  "set_active_page",
]);

export function canvasEditorActionAllowedV1(
  canEdit: boolean,
  actionType: string,
): boolean {
  return canEdit || canvasReadOnlyActionsV1.has(actionType);
}

export function canvasStageTargetClearsSelectionV1(
  classNames: readonly string[],
  button: number,
): boolean {
  return (
    button === 0 &&
    classNames.some(
      (className) =>
        className === "canvas-v1-stage" ||
        className === "canvas-v1-stage-scroll",
    )
  );
}

export function canvasSelectionChangeClosesOverlaysV1(
  previousIds: readonly string[],
  nextIds: readonly string[],
): boolean {
  return (
    previousIds.length !== nextIds.length ||
    previousIds.some((id, index) => id !== nextIds[index])
  );
}

interface CanvasKeyboardEventTargetV1 {
  readonly isContentEditable?: boolean;
  readonly tagName?: string;
  getAttribute?(name: string): string | null;
}

const canvasKeyboardOwnerTagsV1 = new Set([
  "a",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
]);

const canvasKeyboardOwnerRolesV1 = new Set([
  "alertdialog",
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "listbox",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const canvasEscapeOwnerRolesV1 = new Set([
  "alertdialog",
  "dialog",
  "listbox",
  "menu",
]);

export function canvasEscapeEventPathOwnsOverlayV1(
  path: readonly EventTarget[],
): boolean {
  return path.some((entry) => {
    const target = entry as CanvasKeyboardEventTargetV1;
    const role = target.getAttribute?.("role");
    if (
      role?.toLowerCase() === "combobox" &&
      target.getAttribute?.("aria-expanded") === "true"
    ) {
      return true;
    }
    return Boolean(role && canvasEscapeOwnerRolesV1.has(role.toLowerCase()));
  });
}

export function canvasKeyboardEventPathOwnsInputV1(
  path: readonly EventTarget[],
): boolean {
  return path.some((entry) => {
    const target = entry as CanvasKeyboardEventTargetV1;
    const tagName = target.tagName?.toLowerCase();
    if (tagName && canvasKeyboardOwnerTagsV1.has(tagName)) {
      return true;
    }
    if (target.isContentEditable) {
      return true;
    }
    const contentEditable = target.getAttribute?.("contenteditable");
    if (
      contentEditable !== undefined &&
      contentEditable !== null &&
      contentEditable !== "false"
    ) {
      return true;
    }
    const explicitOwner = target.getAttribute?.("data-canvas-keyboard-owner");
    if (explicitOwner !== undefined && explicitOwner !== null) {
      return true;
    }
    const role = target.getAttribute?.("role");
    return Boolean(role && canvasKeyboardOwnerRolesV1.has(role.toLowerCase()));
  });
}

export interface CanvasPointerPointV1 {
  readonly x: number;
  readonly y: number;
}

function pointHitsNodeTransformV1(
  point: CanvasPointerPointV1,
  transform: EditorRuntimeNodeV1["transform"],
): boolean {
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const radians = (-transform.rotation * Math.PI) / HALF_TURN_DEGREES;
  const offsetX = point.x - centerX;
  const offsetY = point.y - centerY;
  const localX =
    centerX + offsetX * Math.cos(radians) - offsetY * Math.sin(radians);
  const localY =
    centerY + offsetX * Math.sin(radians) + offsetY * Math.cos(radians);
  return (
    localX >= transform.x &&
    localX <= transform.x + transform.width &&
    localY >= transform.y &&
    localY <= transform.y + transform.height
  );
}

export function canvasTextNodeIdForDoubleClickV1(
  pathNodeId: string | undefined,
  selectedNode: EditorRuntimeNodeV1 | undefined,
  point: CanvasPointerPointV1,
): string | undefined {
  if (pathNodeId) {
    return pathNodeId;
  }
  if (!selectedNode) {
    return undefined;
  }
  const editable =
    selectedNode.kind === "text" || selectedNode.kind === "shape";
  return editable && pointHitsNodeTransformV1(point, selectedNode.transform)
    ? selectedNode.id
    : undefined;
}

export interface CanvasTextEditingDraftV1 {
  readonly nodeId: string;
  readonly value: string;
}

export function canvasTextEditingDraftForDoubleClickV1(
  current: CanvasTextEditingDraftV1 | undefined,
  nodeId: string,
  value: string,
): CanvasTextEditingDraftV1 {
  return current?.nodeId === nodeId
    ? current
    : {
        nodeId,
        value,
      };
}

export function canvasPageForTextEditingV1(
  page: EditorRuntimePageV1,
  draft: CanvasTextEditingDraftV1 | undefined,
): EditorRuntimePageV1 {
  if (!draft) {
    return page;
  }
  const contentWithValue = (
    content: EditorTextContentV1,
  ): EditorTextContentV1 | undefined => {
    const templateParagraph = content.paragraphs[0];
    const templateRun = templateParagraph?.runs[0];
    if (!templateParagraph || !templateRun) {
      return undefined;
    }
    return {
      ...content,
      paragraphs: draft.value.split("\n").map((line, index) => {
        const paragraph = content.paragraphs[index] ?? templateParagraph;
        return {
          ...paragraph,
          runs: [
            {
              ...(paragraph.runs[0] ?? templateRun),
              text: line,
            },
          ],
        };
      }),
    };
  };
  let changed = false;
  const nodes = page.nodes.map((node) => {
    if (node.id !== draft.nodeId || !node.visible) {
      return node;
    }
    if (node.kind === "text") {
      const content = contentWithValue(node.content);
      if (!content) {
        return node;
      }
      changed = true;
      return {
        ...node,
        content,
      };
    }
    if (node.kind !== "shape") {
      return node;
    }
    const shape = shapeWithDefaultLabelV1(node, draft.value);
    const content = contentWithValue(shape.label!.content);
    if (!content) {
      return node;
    }
    changed = true;
    return {
      ...shape,
      label: {
        ...shape.label!,
        content,
      },
    };
  });
  return changed
    ? {
        ...page,
        nodes,
      }
    : page;
}
