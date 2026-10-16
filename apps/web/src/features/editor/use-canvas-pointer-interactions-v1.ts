import type { TFunction } from "i18next";
import {
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import { focusCanvasStageAfterPanelActionV1 } from "./canvas-interaction-boundary-v1.js";
import {
  appendCanvasFreehandPointV1,
  appendCanvasFreehandEraserTargetV1,
  canvasFreehandEraserTargetIdV1,
  createCanvasFreehandNodeV1,
  type CanvasFreehandPointV1,
  type CanvasQuickToolIdV1,
} from "./canvas-quick-tools-v1.js";
import {
  editorNodeBoundsV1,
  editorSelectionBoundsV1,
  resizeEditorNodeV1,
  rotateEditorNodeV1,
  snapEditorNodeMoveV1,
  type EditorPointV1,
  type EditorResizeHandleV1,
} from "./editor-geometry-v1.js";

const FREEHAND_POINT_MIN_DISTANCE_PX = 1.5;
const NODE_SNAP_THRESHOLD_PX = 7;
const LINE_CONNECTION_SNAP_DISTANCE_PX = 18;
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import {
  editorReducerV1,
  type EditorActionV1,
  type EditorStateV1,
} from "./editor-state-v1.js";
import {
  eventTopLevelNodeId,
  topLevelNode,
} from "./canvas-workspace-model-v1.js";
import { canvasLineWithSnappedEndpointV1 } from "./canvas-line-connection-v1.js";

interface GestureV1 {
  readonly kind: "move" | "resize" | "rotate";
  readonly originals: ReadonlyMap<string, EditorRuntimeNodeV1["transform"]>;
  readonly pointerId: number;
  readonly start: EditorPointV1;
  readonly handle?: EditorResizeHandleV1;
}

interface MarqueeV1 {
  readonly append: boolean;
  readonly current: EditorPointV1;
  readonly pointerId: number;
  readonly start: EditorPointV1;
}

interface DrawingGestureV1 {
  readonly pointerId: number;
  readonly points: readonly CanvasFreehandPointV1[];
}

interface EraserGestureV1 {
  readonly nodeIds: readonly string[];
  readonly pointerId: number;
}

interface LinePointGestureV1 {
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "line" }>;
  readonly pointIndex: number;
  readonly pointerId: number;
}

export function useCanvasPointerInteractionsV1({
  activeQuickTool,
  brushStyle,
  canEdit,
  commitPreview,
  hideEditorPanels,
  mutate,
  page,
  pagePoint,
  setState,
  stage,
  state,
  t,
  zoom,
}: {
  readonly activeQuickTool: CanvasQuickToolIdV1;
  readonly brushStyle: {
    readonly color: string;
    readonly opacity: number;
    readonly presetId: string;
    readonly width: number;
  };
  readonly canEdit: boolean;
  readonly commitPreview: () => void;
  readonly hideEditorPanels: () => void;
  readonly mutate: (action: EditorActionV1) => void;
  readonly page: EditorRuntimePageV1;
  readonly pagePoint: (clientX: number, clientY: number) => EditorPointV1;
  readonly setState: Dispatch<SetStateAction<EditorStateV1>>;
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly state: EditorStateV1;
  readonly t: TFunction;
  readonly zoom: number;
}) {
  const [previewTransforms, setPreviewTransforms] = useState<
    ReadonlyMap<string, EditorRuntimeNodeV1["transform"]>
  >(new Map());
  const [guides, setGuides] = useState<{
    readonly x?: number;
    readonly y?: number;
  }>({});
  const [gesture, setGesture] = useState<GestureV1>();
  const [drawingGesture, setDrawingGesture] = useState<DrawingGestureV1>();
  const [eraserGesture, setEraserGesture] = useState<EraserGestureV1>();
  const [marquee, setMarquee] = useState<MarqueeV1>();
  const [linePointGesture, setLinePointGesture] =
    useState<LinePointGestureV1>();
  const [previewNodes, setPreviewNodes] = useState<
    ReadonlyMap<string, EditorRuntimeNodeV1>
  >(new Map());

  const eraserTargetAtPoint = (
    clientX: number,
    clientY: number,
  ): string | undefined => {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const nodeElement = element.closest("[data-node-id]");
      const nodeId = nodeElement?.getAttribute("data-node-id") ?? undefined;
      const targetId = canvasFreehandEraserTargetIdV1(page, nodeId);
      if (targetId) {
        return targetId;
      }
    }
    return undefined;
  };

  const beginNodePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    focusCanvasStageAfterPanelActionV1(stage.current);
    if (canEdit && activeQuickTool === "erase") {
      commitPreview();
      hideEditorPanels();
      mutate({ type: "clear_selection" });
      const nodeId = canvasFreehandEraserTargetIdV1(
        page,
        eventTopLevelNodeId(event, page),
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      setEraserGesture({
        pointerId: event.pointerId,
        nodeIds: nodeId ? [nodeId] : [],
      });
      event.preventDefault();
      return;
    }
    if (canEdit && activeQuickTool === "draw") {
      const point = pagePoint(event.clientX, event.clientY);
      commitPreview();
      hideEditorPanels();
      mutate({ type: "clear_selection" });
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawingGesture({
        pointerId: event.pointerId,
        points: [point],
      });
      event.preventDefault();
      return;
    }
    const nodeId = eventTopLevelNodeId(event, page);
    if (!nodeId) {
      const append = event.shiftKey || event.metaKey;
      if (!append) {
        mutate({ type: "clear_selection" });
      }
      const point = pagePoint(event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
      setMarquee({
        append,
        current: point,
        pointerId: event.pointerId,
        start: point,
      });
      return;
    }
    const node = topLevelNode(page, nodeId);
    if (!node) {
      return;
    }
    const append = event.shiftKey || event.metaKey;
    const alreadySelected = state.selectedIds.includes(nodeId);
    if (!alreadySelected || append) {
      commitPreview();
      hideEditorPanels();
      mutate({
        type: "select",
        id: nodeId,
        mode: append ? "toggle" : "replace",
      });
    }
    if (node.locked) {
      return;
    }
    if (!canEdit) {
      event.preventDefault();
      return;
    }
    const movingIds = alreadySelected && !append ? state.selectedIds : [nodeId];
    const originals = new Map(
      page.nodes
        .filter(
          (candidate) => movingIds.includes(candidate.id) && !candidate.locked,
        )
        .map((candidate) => [candidate.id, candidate.transform] as const),
    );
    if (originals.size === 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      kind: "move",
      pointerId: event.pointerId,
      start: pagePoint(event.clientX, event.clientY),
      originals,
    });
    event.preventDefault();
  };

  const beginHandlePointer = (
    event: PointerEvent<SVGElement>,
    kind: "resize" | "rotate",
    handle?: EditorResizeHandleV1,
  ) => {
    const selectedNodes = page.nodes.filter((node) =>
      state.selectedIds.includes(node.id),
    );
    const node = selectedNodes[0];
    if (!canEdit || !node || selectedNodes.length !== 1 || node.locked) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      kind,
      pointerId: event.pointerId,
      start: pagePoint(event.clientX, event.clientY),
      originals: new Map([[node.id, node.transform]]),
      ...(handle ? { handle } : {}),
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const beginLinePointPointer = (
    event: PointerEvent<SVGElement>,
    pointIndex: number,
  ) => {
    const selectedNodes = page.nodes.filter((node) =>
      state.selectedIds.includes(node.id),
    );
    const node = selectedNodes[0];
    if (
      !canEdit ||
      !node ||
      selectedNodes.length !== 1 ||
      node.kind !== "line" ||
      node.role === "freehand" ||
      node.locked ||
      !node.points[pointIndex]
    ) {
      return;
    }
    commitPreview();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLinePointGesture({
      node,
      pointIndex,
      pointerId: event.pointerId,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const updateGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (eraserGesture && event.pointerId === eraserGesture.pointerId) {
      const nodeId = eraserTargetAtPoint(event.clientX, event.clientY);
      setEraserGesture((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return current;
        }
        const nodeIds = appendCanvasFreehandEraserTargetV1(
          current.nodeIds,
          nodeId,
        );
        return nodeIds === current.nodeIds ? current : { ...current, nodeIds };
      });
      return;
    }
    if (drawingGesture && event.pointerId === drawingGesture.pointerId) {
      const point = pagePoint(event.clientX, event.clientY);
      setDrawingGesture((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return current;
        }
        return {
          ...current,
          points: appendCanvasFreehandPointV1(
            current.points,
            point,
            FREEHAND_POINT_MIN_DISTANCE_PX / zoom,
          ),
        };
      });
      return;
    }
    if (marquee && event.pointerId === marquee.pointerId) {
      setMarquee({
        ...marquee,
        current: pagePoint(event.clientX, event.clientY),
      });
      return;
    }
    if (linePointGesture && event.pointerId === linePointGesture.pointerId) {
      const node = canvasLineWithSnappedEndpointV1(
        linePointGesture.node,
        linePointGesture.pointIndex,
        pagePoint(event.clientX, event.clientY),
        page.nodes,
        LINE_CONNECTION_SNAP_DISTANCE_PX / zoom,
      );
      setPreviewNodes(new Map([[node.id, node]]));
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }
    const point = pagePoint(event.clientX, event.clientY);
    const next = new Map<string, EditorRuntimeNodeV1["transform"]>();
    if (gesture.kind === "move") {
      const nodes = page.nodes.filter((node) => gesture.originals.has(node.id));
      const bounds = editorSelectionBoundsV1(
        nodes.map((node) => ({
          ...node,
          transform: gesture.originals.get(node.id)!,
        })),
      );
      if (!bounds) {
        return;
      }
      const delta = {
        x: point.x - gesture.start.x,
        y: point.y - gesture.start.y,
      };
      const movedBounds = {
        ...bounds,
        x: bounds.x + delta.x,
        y: bounds.y + delta.y,
      };
      const snapped = snapEditorNodeMoveV1(
        movedBounds,
        page,
        page.nodes,
        [...gesture.originals.keys()],
        NODE_SNAP_THRESHOLD_PX / zoom,
      );
      const adjustX = snapped.rect.x - movedBounds.x;
      const adjustY = snapped.rect.y - movedBounds.y;
      for (const [id, original] of gesture.originals) {
        next.set(id, {
          ...original,
          x: original.x + delta.x + adjustX,
          y: original.y + delta.y + adjustY,
        });
      }
      setGuides(snapped.guides);
    } else {
      const [id, original] = [...gesture.originals][0]!;
      if (gesture.kind === "resize" && gesture.handle) {
        next.set(
          id,
          resizeEditorNodeV1(original, gesture.handle, point, !event.shiftKey),
        );
      } else {
        next.set(
          id,
          rotateEditorNodeV1(original, gesture.start, point, event.shiftKey),
        );
      }
    }
    setPreviewTransforms(next);
  };

  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (eraserGesture && event.pointerId === eraserGesture.pointerId) {
      const nodeIds = appendCanvasFreehandEraserTargetV1(
        eraserGesture.nodeIds,
        eraserTargetAtPoint(event.clientX, event.clientY),
      );
      if (nodeIds.length > 0) {
        mutate({
          type: "delete_nodes",
          ids: nodeIds,
          pageId: page.id,
        });
      }
      setEraserGesture(undefined);
      focusCanvasStageAfterPanelActionV1(stage.current);
      return;
    }
    if (drawingGesture && event.pointerId === drawingGesture.pointerId) {
      const points = appendCanvasFreehandPointV1(
        drawingGesture.points,
        pagePoint(event.clientX, event.clientY),
        0,
      );
      const node = createCanvasFreehandNodeV1({
        id: `drawing:${crypto.randomUUID()}`,
        points,
        color: brushStyle.color,
        name: t("canvas.names.brushStroke", {
          name: t(`canvas.quickTools.brushes.${brushStyle.presetId}`),
        }),
        opacity: brushStyle.opacity,
        width: brushStyle.width,
      });
      if (node) {
        mutate({
          type: "add_node",
          pageId: page.id,
          node,
        });
        mutate({ type: "clear_selection" });
      }
      setDrawingGesture(undefined);
      return;
    }
    if (marquee && event.pointerId === marquee.pointerId) {
      const left = Math.min(marquee.start.x, marquee.current.x);
      const top = Math.min(marquee.start.y, marquee.current.y);
      const right = Math.max(marquee.start.x, marquee.current.x);
      const bottom = Math.max(marquee.start.y, marquee.current.y);
      const matched = page.nodes.filter((node) => {
        if (!node.visible) {
          return false;
        }
        const bounds = editorNodeBoundsV1(node);
        return (
          bounds.x < right &&
          bounds.x + bounds.width > left &&
          bounds.y < bottom &&
          bounds.y + bounds.height > top
        );
      });
      setState((current) => {
        let next = marquee.append
          ? current
          : editorReducerV1(current, {
              type: "clear_selection",
            });
        for (const [index, node] of matched.entries()) {
          next = editorReducerV1(next, {
            type: "select",
            id: node.id,
            mode: marquee.append || index > 0 ? "add" : "replace",
          });
        }
        return next;
      });
      setMarquee(undefined);
      focusCanvasStageAfterPanelActionV1(stage.current);
      return;
    }
    if (linePointGesture && event.pointerId === linePointGesture.pointerId) {
      const node = previewNodes.get(linePointGesture.node.id);
      if (node) {
        mutate({
          type: "replace_node",
          node,
        });
      }
      setLinePointGesture(undefined);
      setPreviewNodes(new Map());
      focusCanvasStageAfterPanelActionV1(stage.current);
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }
    if (previewTransforms.size > 0) {
      mutate({
        type: "transform_nodes",
        pageId: state.activePageId,
        transforms: [...previewTransforms].map(([id, transform]) => ({
          id,
          transform,
        })),
      });
    }
    setGesture(undefined);
    setPreviewTransforms(new Map());
    setGuides({});
    focusCanvasStageAfterPanelActionV1(stage.current);
  };

  return {
    beginHandlePointer,
    beginLinePointPointer,
    beginNodePointer,
    cancelDrawing: () => {
      setDrawingGesture(undefined);
      setEraserGesture(undefined);
    },
    drawingGesture,
    eraserGesture,
    endGesture,
    gesture,
    guides,
    linePointGesture,
    marquee,
    previewTransforms,
    previewNodes,
    updateGesture,
  };
}
