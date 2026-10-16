import type {
  EditorArtifactReferenceV1,
  EditorGraphicNodeV1,
  EditorPageV1,
} from "@kanvas/contracts/editor";

import type {
  EditorRuntimeDocumentV1,
  EditorRuntimeGroupNodeV1,
  EditorRuntimeNodeV1,
  EditorRuntimePageBackgroundV1,
  EditorRuntimePageV1,
  EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";
import {
  canvasResizeScalesVisualMetricsV1,
  scaleCanvasNodeVisualsV1,
} from "./canvas-node-scaling-v1.js";
import {
  commitEditorLocalImageV1,
  markEditorLocalImageUploadFailedV1,
} from "./editor-runtime-v1.js";
import { canvasResolveLineBindingsV1 } from "./canvas-line-connection-v1.js";

export interface EditorStateV1 {
  readonly activePageId: string;
  readonly document: EditorRuntimeDocumentV1;
  readonly future: readonly EditorHistorySnapshotV1[];
  readonly past: readonly EditorHistorySnapshotV1[];
  readonly preview?: EditorHistorySnapshotV1 | undefined;
  readonly selectedIds: readonly string[];
}

interface EditorHistorySnapshotV1 {
  readonly activePageId: string;
  readonly document: EditorRuntimeDocumentV1;
  readonly selectedIds: readonly string[];
}

export type EditorLayerMoveV1 = "backward" | "forward" | "to_back" | "to_front";

export type EditorAlignmentV1 =
  "bottom" | "center_horizontal" | "center_vertical" | "left" | "right" | "top";

type EditorPageGuideV1 = NonNullable<
  NonNullable<EditorPageV1["overlays"]>["guides"]
>[number];

export type EditorActionV1 =
  | {
      readonly id: string;
      readonly mode?: "add" | "replace" | "toggle";
      readonly type: "select";
    }
  | {
      readonly ids?: readonly string[];
      readonly type: "clear_selection";
    }
  | {
      readonly node: EditorRuntimeNodeV1;
      readonly pageId?: string;
      readonly type: "add_node";
    }
  | {
      readonly nodes: readonly EditorRuntimeNodeV1[];
      readonly pageId?: string;
      readonly type: "add_nodes";
    }
  | {
      readonly page: EditorRuntimePageV1;
      readonly type: "add_page";
    }
  | {
      readonly pageId: string;
      readonly type: "delete_page";
    }
  | {
      readonly name: string;
      readonly pageId: string;
      readonly type: "rename_page";
    }
  | {
      readonly direction: "backward" | "forward";
      readonly pageId: string;
      readonly type: "move_page";
    }
  | {
      readonly pageId: string;
      readonly targetIndex: number;
      readonly type: "reorder_page";
    }
  | {
      readonly height: number;
      readonly mode: "keep" | "scale";
      readonly pageId: string;
      readonly type: "resize_page";
      readonly width: number;
    }
  | {
      readonly guides: readonly EditorPageGuideV1[];
      readonly pageId: string;
      readonly type: "set_page_guides";
    }
  | {
      readonly node: EditorRuntimeNodeV1;
      readonly type: "replace_node";
    }
  | {
      readonly node: EditorRuntimeNodeV1;
      readonly type: "preview_replace_node";
    }
  | {
      readonly background: EditorRuntimePageBackgroundV1;
      readonly pageId: string;
      readonly type: "set_page_background";
    }
  | {
      readonly background: EditorRuntimePageBackgroundV1;
      readonly pageId: string;
      readonly type: "preview_page_background";
    }
  | {
      readonly nodeId: string;
      readonly pageId: string;
      readonly type: "set_image_node_as_background";
    }
  | {
      readonly node: EditorRuntimeNodeV1;
      readonly pageId: string;
      readonly type: "convert_background_to_image";
    }
  | {
      readonly frameId: string;
      readonly image: EditorRuntimePlacedImageV1;
      readonly pageId: string;
      readonly type: "set_frame_content";
    }
  | {
      readonly frameId: string;
      readonly pageId: string;
      readonly type: "remove_frame_content";
    }
  | {
      readonly gridId: string;
      readonly image: EditorRuntimePlacedImageV1;
      readonly pageId: string;
      readonly slotId: string;
      readonly type: "set_grid_cell_content";
    }
  | {
      readonly gridId: string;
      readonly pageId: string;
      readonly slotId: string;
      readonly type: "remove_grid_cell_content";
    }
  | {
      readonly image: EditorRuntimePlacedImageV1;
      readonly nodeId: string;
      readonly pageId: string;
      readonly type: "set_image_content";
    }
  | {
      readonly nodeId: string;
      readonly pageId: string;
      readonly source: EditorGraphicNodeV1["source"];
      readonly type: "set_graphic_content";
    }
  | {
      readonly id: string;
      readonly transform: EditorRuntimeNodeV1["transform"];
      readonly type: "transform_node";
    }
  | {
      readonly pageId?: string;
      readonly transforms: readonly {
        readonly id: string;
        readonly transform: EditorRuntimeNodeV1["transform"];
      }[];
      readonly type: "transform_nodes";
    }
  | {
      readonly type: "delete_selected";
    }
  | {
      readonly ids: readonly string[];
      readonly pageId?: string;
      readonly type: "delete_nodes";
    }
  | {
      readonly alignment: EditorAlignmentV1;
      readonly type: "align_selected";
    }
  | {
      readonly axis: "horizontal" | "vertical";
      readonly type: "distribute_selected";
    }
  | {
      readonly groupId: string;
      readonly name?: string;
      readonly type: "group_selected";
    }
  | {
      readonly groupId: string;
      readonly type: "ungroup";
    }
  | {
      readonly id: string;
      readonly move: EditorLayerMoveV1;
      readonly type: "move_layer";
    }
  | {
      readonly localId: string;
      readonly reference: EditorArtifactReferenceV1;
      readonly type: "commit_local_image";
    }
  | {
      readonly localId: string;
      readonly type: "fail_local_image";
    }
  | {
      readonly pageId: string;
      readonly type: "set_active_page";
    }
  | {
      readonly type: "undo";
    }
  | {
      readonly type: "redo";
    }
  | {
      readonly type: "commit_preview";
    }
  | {
      readonly type: "cancel_preview";
    };

const maximumHistory = 100;

interface LocatedNodeV1 {
  readonly index: number;
  readonly node: EditorRuntimeNodeV1;
  readonly parentPath: readonly string[];
}

interface Bounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

function snapshot(state: EditorStateV1): EditorHistorySnapshotV1 {
  return {
    activePageId: state.activePageId,
    document: state.document,
    selectedIds: state.selectedIds,
  };
}

function restore(
  state: EditorStateV1,
  value: EditorHistorySnapshotV1,
): EditorStateV1 {
  return {
    ...state,
    activePageId: value.activePageId,
    document: value.document,
    selectedIds: value.selectedIds,
  };
}

function mapHistoryDocuments(
  snapshots: readonly EditorHistorySnapshotV1[],
  updater: (document: EditorRuntimeDocumentV1) => EditorRuntimeDocumentV1,
): readonly EditorHistorySnapshotV1[] {
  return snapshots.map((item) => ({
    ...item,
    document: updater(item.document),
  }));
}

function changed(
  state: EditorStateV1,
  document: EditorRuntimeDocumentV1,
  selectedIds = state.selectedIds,
): EditorStateV1 {
  const resolvedDocument = {
    ...document,
    pages: document.pages.map((page) => {
      const nodes = canvasResolveLineBindingsV1(page.nodes);
      return nodes === page.nodes ? page : { ...page, nodes };
    }),
  };
  if (
    resolvedDocument.pages.every(
      (page, index) => page === state.document.pages[index],
    ) &&
    selectedIds === state.selectedIds
  ) {
    return state;
  }
  return {
    ...state,
    document: resolvedDocument,
    selectedIds,
    past: [
      ...state.past.slice(-(maximumHistory - 1)),
      state.preview ?? snapshot(state),
    ],
    future: [],
    preview: undefined,
  };
}

function previewChanged(
  state: EditorStateV1,
  document: EditorRuntimeDocumentV1,
  selectedIds = state.selectedIds,
): EditorStateV1 {
  const resolvedDocument = {
    ...document,
    pages: document.pages.map((page) => {
      const nodes = canvasResolveLineBindingsV1(page.nodes);
      return nodes === page.nodes ? page : { ...page, nodes };
    }),
  };
  return {
    ...state,
    document: resolvedDocument,
    selectedIds,
    preview: state.preview ?? snapshot(state),
  };
}

function activePage(state: EditorStateV1): EditorRuntimePageV1 {
  const page = state.document.pages.find(
    (candidate) => candidate.id === state.activePageId,
  );
  if (!page) {
    throw new Error(`Active Canvas page ${state.activePageId} does not exist.`);
  }
  return page;
}

function updatePage(
  document: EditorRuntimeDocumentV1,
  pageId: string,
  updater: (page: EditorRuntimePageV1) => EditorRuntimePageV1,
): EditorRuntimeDocumentV1 {
  let found = false;
  const pages = document.pages.map((page) => {
    if (page.id !== pageId) {
      return page;
    }
    found = true;
    return updater(page);
  });
  if (!found) {
    throw new Error(`Canvas page ${pageId} does not exist.`);
  }
  return {
    ...document,
    pages,
  };
}

function locateNode(
  nodes: readonly EditorRuntimeNodeV1[],
  id: string,
  parentPath: readonly string[] = [],
): LocatedNodeV1 | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return {
        node,
        index,
        parentPath,
      };
    }
    if (node.kind === "group") {
      const nested = locateNode(node.children, id, [...parentPath, node.id]);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function updateSiblingsAtPath(
  nodes: readonly EditorRuntimeNodeV1[],
  parentPath: readonly string[],
  updater: (
    siblings: readonly EditorRuntimeNodeV1[],
  ) => readonly EditorRuntimeNodeV1[],
): readonly EditorRuntimeNodeV1[] {
  if (parentPath.length === 0) {
    return updater(nodes);
  }
  const [groupId, ...remaining] = parentPath;
  let found = false;
  const updated = nodes.map((node) => {
    if (node.id !== groupId || node.kind !== "group") {
      return node;
    }
    found = true;
    return {
      ...node,
      children: [...updateSiblingsAtPath(node.children, remaining, updater)],
    };
  });
  if (!found) {
    throw new Error(
      `Canvas group path ${parentPath.join("/")} does not exist.`,
    );
  }
  return updated;
}

function mapNode(
  nodes: readonly EditorRuntimeNodeV1[],
  id: string,
  updater: (node: EditorRuntimeNodeV1) => EditorRuntimeNodeV1,
): readonly EditorRuntimeNodeV1[] {
  let found = false;
  const updated = nodes.map((node) => {
    if (node.id === id) {
      found = true;
      return updater(node);
    }
    if (node.kind === "group") {
      const children = mapNodeIfPresent(node.children, id, updater);
      if (children !== node.children) {
        found = true;
        return {
          ...node,
          children: [...children],
        };
      }
    }
    return node;
  });
  if (!found) {
    throw new Error(`Canvas node ${id} does not exist.`);
  }
  return updated;
}

function mapNodeIfPresent(
  nodes: readonly EditorRuntimeNodeV1[],
  id: string,
  updater: (node: EditorRuntimeNodeV1) => EditorRuntimeNodeV1,
): readonly EditorRuntimeNodeV1[] {
  let changedNodes = false;
  const updated = nodes.map((node) => {
    if (node.id === id) {
      changedNodes = true;
      return updater(node);
    }
    if (node.kind === "group") {
      const children = mapNodeIfPresent(node.children, id, updater);
      if (children !== node.children) {
        changedNodes = true;
        return {
          ...node,
          children: [...children],
        };
      }
    }
    return node;
  });
  return changedNodes ? updated : nodes;
}

function nodeBounds(node: EditorRuntimeNodeV1): Bounds {
  const transform = node.transform;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const radians = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = transform.width / 2;
  const halfHeight = transform.height / 2;
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const;
  const points = corners.map(([x, y]) => ({
    x: centerX + x * cosine - y * sine,
    y: centerY + x * sine + y * cosine,
  }));
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

function combinedBounds(nodes: readonly EditorRuntimeNodeV1[]): Bounds {
  const bounds = nodes.map(nodeBounds);
  const minimumX = Math.min(...bounds.map((item) => item.x));
  const minimumY = Math.min(...bounds.map((item) => item.y));
  const maximumX = Math.max(...bounds.map((item) => item.x + item.width));
  const maximumY = Math.max(...bounds.map((item) => item.y + item.height));
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

function alignNodes(
  nodes: readonly EditorRuntimeNodeV1[],
  selectedIds: ReadonlySet<string>,
  alignment: EditorAlignmentV1,
): readonly EditorRuntimeNodeV1[] {
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) {
    return nodes;
  }
  const bounds = combinedBounds(selected);
  return nodes.map((node) => {
    if (!selectedIds.has(node.id)) {
      return node;
    }
    const nodeRect = nodeBounds(node);
    let x = node.transform.x;
    if (alignment === "left") {
      x += bounds.x - nodeRect.x;
    } else if (alignment === "right") {
      x += bounds.x + bounds.width - nodeRect.x - nodeRect.width;
    } else if (alignment === "center_horizontal") {
      x += bounds.x + bounds.width / 2 - nodeRect.x - nodeRect.width / 2;
    }
    let y = node.transform.y;
    if (alignment === "top") {
      y += bounds.y - nodeRect.y;
    } else if (alignment === "bottom") {
      y += bounds.y + bounds.height - nodeRect.y - nodeRect.height;
    } else if (alignment === "center_vertical") {
      y += bounds.y + bounds.height / 2 - nodeRect.y - nodeRect.height / 2;
    }
    return {
      ...node,
      transform: {
        ...node.transform,
        x,
        y,
      },
    };
  });
}

function distributeNodes(
  nodes: readonly EditorRuntimeNodeV1[],
  selectedIds: ReadonlySet<string>,
  axis: "horizontal" | "vertical",
): readonly EditorRuntimeNodeV1[] {
  const selected = nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => ({
      node,
      bounds: nodeBounds(node),
    }))
    .sort((left, right) =>
      axis === "horizontal"
        ? left.bounds.x - right.bounds.x
        : left.bounds.y - right.bounds.y,
    );
  if (selected.length < 3) {
    return nodes;
  }
  const start =
    axis === "horizontal" ? selected[0]!.bounds.x : selected[0]!.bounds.y;
  const endItem = selected.at(-1)!;
  const end =
    axis === "horizontal"
      ? endItem.bounds.x + endItem.bounds.width
      : endItem.bounds.y + endItem.bounds.height;
  const totalSize = selected.reduce(
    (total, item) =>
      total + (axis === "horizontal" ? item.bounds.width : item.bounds.height),
    0,
  );
  const gap = (end - start - totalSize) / (selected.length - 1);
  const positions = new Map<string, number>();
  let cursor = start;
  for (const item of selected) {
    positions.set(item.node.id, cursor);
    cursor +=
      (axis === "horizontal" ? item.bounds.width : item.bounds.height) + gap;
  }
  return nodes.map((node) => {
    const position = positions.get(node.id);
    if (position === undefined) {
      return node;
    }
    const bounds = nodeBounds(node);
    return {
      ...node,
      transform: {
        ...node.transform,
        ...(axis === "horizontal"
          ? {
              x: node.transform.x + position - bounds.x,
            }
          : {
              y: node.transform.y + position - bounds.y,
            }),
      },
    };
  });
}

function groupSelectedSiblings(
  siblings: readonly EditorRuntimeNodeV1[],
  selectedIds: ReadonlySet<string>,
  groupId: string,
  name: string,
): readonly EditorRuntimeNodeV1[] {
  const selected = siblings.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) {
    throw new Error(
      "At least two sibling nodes are required to create a group.",
    );
  }
  const bounds = combinedBounds(selected);
  const children = selected.map((node) => ({
    ...node,
    transform: {
      ...node.transform,
      x: node.transform.x - bounds.x,
      y: node.transform.y - bounds.y,
    },
  }));
  const group: EditorRuntimeGroupNodeV1 = {
    id: groupId,
    name,
    kind: "group",
    transform: {
      ...bounds,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    children,
  };
  const insertionIndex = Math.min(
    ...siblings
      .map((node, index) =>
        selectedIds.has(node.id) ? index : Number.POSITIVE_INFINITY,
      )
      .filter(Number.isFinite),
  );
  return [
    ...siblings
      .filter((node) => !selectedIds.has(node.id))
      .slice(0, insertionIndex),
    group,
    ...siblings
      .filter((node) => !selectedIds.has(node.id))
      .slice(insertionIndex),
  ];
}

interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformMatrix(transform: EditorRuntimeNodeV1["transform"]): Matrix {
  const radians = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const flipX = transform.flipX ? -1 : 1;
  const flipY = transform.flipY ? -1 : 1;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  return {
    a: cosine * flipX,
    b: sine * flipX,
    c: -sine * flipY,
    d: cosine * flipY,
    e:
      centerX -
      cosine * flipX * (transform.width / 2) +
      sine * flipY * (transform.height / 2),
    f:
      centerY -
      sine * flipX * (transform.width / 2) -
      cosine * flipY * (transform.height / 2),
  };
}

function composeGroupChild(
  group: EditorRuntimeGroupNodeV1,
  child: EditorRuntimeNodeV1,
): EditorRuntimeNodeV1 {
  const matrix = multiply(
    transformMatrix(group.transform),
    transformMatrix(child.transform),
  );
  const center = {
    x:
      matrix.a * (child.transform.width / 2) +
      matrix.c * (child.transform.height / 2) +
      matrix.e,
    y:
      matrix.b * (child.transform.width / 2) +
      matrix.d * (child.transform.height / 2) +
      matrix.f,
  };
  const reflected = matrix.a * matrix.d - matrix.b * matrix.c < 0;
  const rotation =
    (Math.atan2(
      reflected ? -matrix.b : matrix.b,
      reflected ? -matrix.a : matrix.a,
    ) *
      180) /
    Math.PI;
  return {
    ...child,
    transform: {
      ...child.transform,
      x: center.x - child.transform.width / 2,
      y: center.y - child.transform.height / 2,
      rotation,
      flipX: reflected,
      flipY: false,
    },
    opacity: child.opacity * group.opacity,
    visible: child.visible && group.visible,
    locked: child.locked || group.locked,
    blendMode: child.blendMode === "normal" ? group.blendMode : child.blendMode,
  };
}

function ungroupSiblings(
  siblings: readonly EditorRuntimeNodeV1[],
  groupId: string,
): readonly EditorRuntimeNodeV1[] {
  const index = siblings.findIndex(
    (node) => node.id === groupId && node.kind === "group",
  );
  if (index >= 0) {
    const group = siblings[index] as EditorRuntimeGroupNodeV1;
    return [
      ...siblings.slice(0, index),
      ...group.children.map((child) => composeGroupChild(group, child)),
      ...siblings.slice(index + 1),
    ];
  }
  let found = false;
  const nested = siblings.map((node) => {
    if (node.kind !== "group") {
      return node;
    }
    const children = ungroupSiblings(node.children, groupId);
    if (children !== node.children) {
      found = true;
      return {
        ...node,
        children: [...children],
      };
    }
    return node;
  });
  if (!found) {
    throw new Error(`Canvas group ${groupId} does not exist.`);
  }
  return nested;
}

function deleteNodes(
  nodes: readonly EditorRuntimeNodeV1[],
  selectedIds: ReadonlySet<string>,
): readonly EditorRuntimeNodeV1[] {
  return nodes.flatMap((node) => {
    if (selectedIds.has(node.id)) {
      return [];
    }
    if (node.kind !== "group") {
      return [node];
    }
    const children = deleteNodes(node.children, selectedIds);
    if (children.length === 0) {
      return [];
    }
    if (children.length === 1) {
      return [composeGroupChild(node, children[0]!)];
    }
    return [
      children === node.children
        ? node
        : {
            ...node,
            children: [...children],
          },
    ];
  });
}

function scaleNode(
  node: EditorRuntimeNodeV1,
  scaleX: number,
  scaleY: number,
  scaleVisuals: boolean,
): EditorRuntimeNodeV1 {
  const transform = {
    ...node.transform,
    x: node.transform.x * scaleX,
    y: node.transform.y * scaleY,
    width: node.transform.width * scaleX,
    height: node.transform.height * scaleY,
  };
  if (node.kind === "group") {
    return {
      ...node,
      transform,
      children: node.children.map((child) =>
        scaleNode(child, scaleX, scaleY, scaleVisuals),
      ),
    };
  }
  const scaledNode = {
    ...node,
    transform,
  };
  return scaleVisuals
    ? scaleCanvasNodeVisualsV1(scaledNode, scaleX, scaleY)
    : scaledNode;
}

function transformNode(
  node: EditorRuntimeNodeV1,
  transform: EditorRuntimeNodeV1["transform"],
): EditorRuntimeNodeV1 {
  const scaleX =
    node.transform.width === 0 ? 1 : transform.width / node.transform.width;
  const scaleY =
    node.transform.height === 0 ? 1 : transform.height / node.transform.height;
  const scalesVisuals = canvasResizeScalesVisualMetricsV1(scaleX, scaleY);
  if (node.kind !== "group") {
    const transformed = {
      ...node,
      transform,
    };
    return scalesVisuals
      ? scaleCanvasNodeVisualsV1(transformed, scaleX, scaleY)
      : transformed;
  }
  return {
    ...node,
    transform,
    children: node.children.map((child) =>
      scaleNode(child, scaleX, scaleY, scalesVisuals),
    ),
  };
}

function moveLayer(
  siblings: readonly EditorRuntimeNodeV1[],
  id: string,
  move: EditorLayerMoveV1,
): readonly EditorRuntimeNodeV1[] {
  const index = siblings.findIndex((node) => node.id === id);
  if (index >= 0) {
    let target = Math.min(siblings.length - 1, index + 1);
    if (move === "to_back") {
      target = 0;
    } else if (move === "to_front") {
      target = siblings.length - 1;
    } else if (move === "backward") {
      target = Math.max(0, index - 1);
    }
    if (target === index) {
      return siblings;
    }
    const updated = [...siblings];
    const [node] = updated.splice(index, 1);
    updated.splice(target, 0, node!);
    return updated;
  }
  let changedNodes = false;
  const nested = siblings.map((node) => {
    if (node.kind !== "group") {
      return node;
    }
    const children = moveLayer(node.children, id, move);
    if (children !== node.children) {
      changedNodes = true;
      return {
        ...node,
        children: [...children],
      };
    }
    return node;
  });
  if (!changedNodes) {
    throw new Error(`Canvas node ${id} does not exist.`);
  }
  return nested;
}

function validatePageNodes(nodes: readonly EditorRuntimeNodeV1[]): void {
  const ids = new Set<string>();
  let total = 0;

  function visit(node: EditorRuntimeNodeV1): void {
    total += 1;
    if (total > 5_000) {
      throw new Error("A page cannot contain more than 5,000 nodes.");
    }
    if (ids.has(node.id)) {
      throw new Error(`Node ID ${node.id} is used more than once.`);
    }
    ids.add(node.id);
    if (node.kind === "grid") {
      const slots = new Set<string>();
      for (const cell of node.cells) {
        if (slots.has(cell.slotId)) {
          throw new Error(`Grid ${node.id} repeats slot ${cell.slotId}.`);
        }
        slots.add(cell.slotId);
      }
    }
    if (node.kind === "group") {
      if (node.children.length < 2) {
        throw new Error(`Group ${node.id} requires at least two children.`);
      }
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  for (const node of nodes) {
    visit(node);
  }
}

export function createEditorStateV1(
  document: EditorRuntimeDocumentV1,
): EditorStateV1 {
  const activePageId = document.pages[0]?.id;
  if (!activePageId) {
    throw new Error("Canvas document requires at least one page.");
  }
  for (const page of document.pages) {
    validatePageNodes(page.nodes);
  }
  return {
    document,
    activePageId,
    selectedIds: [],
    past: [],
    future: [],
  };
}

export function editorReducerV1(
  state: EditorStateV1,
  action: EditorActionV1,
): EditorStateV1 {
  if (action.type === "commit_local_image") {
    const updater = (document: EditorRuntimeDocumentV1) =>
      commitEditorLocalImageV1(document, action.localId, action.reference);
    return {
      ...state,
      document: updater(state.document),
      past: mapHistoryDocuments(state.past, updater),
      future: mapHistoryDocuments(state.future, updater),
    };
  }
  if (action.type === "fail_local_image") {
    const updater = (document: EditorRuntimeDocumentV1) =>
      markEditorLocalImageUploadFailedV1(document, action.localId);
    return {
      ...state,
      document: updater(state.document),
      past: mapHistoryDocuments(state.past, updater),
      future: mapHistoryDocuments(state.future, updater),
    };
  }
  if (action.type === "select") {
    const mode = action.mode ?? "replace";
    const selected = new Set(state.selectedIds);
    if (mode === "replace") {
      return {
        ...state,
        selectedIds: [action.id],
      };
    }
    if (mode === "toggle") {
      if (selected.has(action.id)) {
        selected.delete(action.id);
      } else {
        selected.add(action.id);
      }
    } else {
      selected.add(action.id);
    }
    return {
      ...state,
      selectedIds: [...selected],
    };
  }
  if (action.type === "clear_selection") {
    return {
      ...state,
      selectedIds: action.ids
        ? state.selectedIds.filter((id) => !action.ids!.includes(id))
        : [],
    };
  }
  if (action.type === "set_active_page") {
    if (!state.document.pages.some((page) => page.id === action.pageId)) {
      throw new Error(`Canvas page ${action.pageId} does not exist.`);
    }
    return {
      ...state,
      activePageId: action.pageId,
      selectedIds: [],
    };
  }
  if (action.type === "undo") {
    if (state.preview) {
      const { preview, ...current } = state;
      return restore(current, preview);
    }
    const previous = state.past.at(-1);
    if (!previous) {
      return state;
    }
    return {
      ...restore(state, previous),
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future],
    };
  }
  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) {
      return state;
    }
    return {
      ...restore(state, next),
      past: [...state.past, snapshot(state)],
      future: state.future.slice(1),
    };
  }
  if (action.type === "commit_preview") {
    if (!state.preview) {
      return state;
    }
    return {
      ...state,
      past: [...state.past.slice(-(maximumHistory - 1)), state.preview],
      future: [],
      preview: undefined,
    };
  }
  if (action.type === "cancel_preview") {
    if (!state.preview) return state;
    const { preview, ...current } = state;
    return restore(current, preview);
  }
  if (action.type === "preview_page_background") {
    return previewChanged(
      state,
      updatePage(state.document, action.pageId, (page) => ({
        ...page,
        background: action.background,
      })),
      [],
    );
  }
  if (action.type === "set_page_background") {
    return changed(
      state,
      updatePage(state.document, action.pageId, (page) => ({
        ...page,
        background: action.background,
      })),
      [],
    );
  }
  if (action.type === "set_image_node_as_background") {
    const document = updatePage(state.document, action.pageId, (page) => {
      const node = locateNode(page.nodes, action.nodeId)?.node;
      if (!node) {
        throw new Error(`Canvas node ${action.nodeId} does not exist.`);
      }
      if (node.kind !== "image") {
        throw new Error(`Canvas node ${action.nodeId} is not an image.`);
      }
      const nodes = deleteNodes(page.nodes, new Set([action.nodeId]));
      validatePageNodes(nodes);
      return {
        ...page,
        background: {
          kind: "image",
          image: {
            ...node.image,
            fit: "cover",
          },
          opacity: node.opacity,
        },
        nodes: [...nodes],
      };
    });
    return changed(state, document, []);
  }
  if (action.type === "convert_background_to_image") {
    if (action.node.kind !== "image") {
      throw new Error("Canvas background can only convert to an image node.");
    }
    const document = updatePage(state.document, action.pageId, (page) => {
      if (page.background.kind !== "image") {
        throw new Error("Canvas page background is not an image.");
      }
      const nodes = [...page.nodes, action.node];
      validatePageNodes(nodes);
      return {
        ...page,
        background: {
          kind: "transparent",
        },
        nodes,
      };
    });
    return changed(state, document, [action.node.id]);
  }
  if (action.type === "add_page") {
    if (state.document.pages.some((page) => page.id === action.page.id)) {
      throw new Error(`Canvas page ${action.page.id} already exists.`);
    }
    validatePageNodes(action.page.nodes);
    const next = changed(
      state,
      {
        ...state.document,
        pages: [...state.document.pages, action.page],
      },
      [],
    );
    return {
      ...next,
      activePageId: action.page.id,
    };
  }
  if (action.type === "delete_page") {
    if (state.document.pages.length === 1) {
      throw new Error("A Canvas document must retain at least one page.");
    }
    const index = state.document.pages.findIndex(
      (page) => page.id === action.pageId,
    );
    if (index < 0) {
      throw new Error(`Canvas page ${action.pageId} does not exist.`);
    }
    const pages = state.document.pages.filter(
      (page) => page.id !== action.pageId,
    );
    const next = changed(
      state,
      {
        ...state.document,
        pages,
      },
      [],
    );
    return {
      ...next,
      activePageId:
        state.activePageId === action.pageId
          ? pages[Math.min(index, pages.length - 1)]!.id
          : state.activePageId,
    };
  }
  if (action.type === "rename_page") {
    const name = action.name.trim();
    if (!name || name.length > 240) return state;
    return changed(
      state,
      updatePage(state.document, action.pageId, (page) => ({ ...page, name })),
    );
  }
  if (action.type === "move_page") {
    const index = state.document.pages.findIndex(
      (page) => page.id === action.pageId,
    );
    if (index < 0) {
      throw new Error(`Canvas page ${action.pageId} does not exist.`);
    }
    const target =
      action.direction === "backward"
        ? Math.max(0, index - 1)
        : Math.min(state.document.pages.length - 1, index + 1);
    if (target === index) {
      return state;
    }
    const pages = [...state.document.pages];
    const [page] = pages.splice(index, 1);
    pages.splice(target, 0, page!);
    return changed(state, {
      ...state.document,
      pages,
    });
  }
  if (action.type === "reorder_page") {
    const index = state.document.pages.findIndex(
      (page) => page.id === action.pageId,
    );
    const target = Math.max(
      0,
      Math.min(state.document.pages.length - 1, action.targetIndex),
    );
    if (index < 0 || index === target) return state;
    const pages = [...state.document.pages];
    const [page] = pages.splice(index, 1);
    pages.splice(target, 0, page!);
    return changed(state, { ...state.document, pages });
  }
  if (action.type === "resize_page") {
    if (
      !Number.isFinite(action.width) ||
      !Number.isFinite(action.height) ||
      action.width < 64 ||
      action.height < 64 ||
      action.width > 32_768 ||
      action.height > 32_768
    ) {
      throw new Error("Canvas page dimensions must be between 64 and 32768.");
    }
    return changed(
      state,
      updatePage(state.document, action.pageId, (page) => {
        const width = Math.round(action.width);
        const height = Math.round(action.height);
        if (action.mode === "keep") return { ...page, width, height };
        const scaleX = width / page.width;
        const scaleY = height / page.height;
        return {
          ...page,
          width,
          height,
          nodes: page.nodes.map((node) => ({
            ...node,
            transform: {
              ...node.transform,
              x: node.transform.x * scaleX,
              y: node.transform.y * scaleY,
              width: node.transform.width * scaleX,
              height: node.transform.height * scaleY,
            },
          })),
          ...(page.overlays?.guides
            ? {
                overlays: {
                  ...page.overlays,
                  guides: page.overlays.guides.map((guide) => ({
                    ...guide,
                    position:
                      guide.position *
                      (guide.axis === "vertical" ? scaleX : scaleY),
                  })),
                },
              }
            : {}),
        };
      }),
      [],
    );
  }
  if (action.type === "set_page_guides") {
    const ids = action.guides.map((guide) => guide.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Canvas page guide identities must be unique.");
    }
    return changed(
      state,
      updatePage(state.document, action.pageId, (page) => ({
        ...page,
        overlays: {
          ...page.overlays,
          guides: [...action.guides],
        },
      })),
    );
  }
  if (action.type === "set_frame_content") {
    const document = updatePage(state.document, action.pageId, (page) => {
      const nodes = mapNode(page.nodes, action.frameId, (node) => {
        if (node.kind !== "frame") {
          throw new Error(`Canvas node ${action.frameId} is not a frame.`);
        }
        return {
          ...node,
          content: {
            image: action.image,
          },
        };
      });
      validatePageNodes(nodes);
      return {
        ...page,
        nodes: [...nodes],
      };
    });
    return changed(state, document, [action.frameId]);
  }
  if (action.type === "remove_frame_content") {
    const document = updatePage(state.document, action.pageId, (page) => ({
      ...page,
      nodes: [
        ...mapNode(page.nodes, action.frameId, (node) => {
          if (node.kind !== "frame") {
            throw new Error(`Canvas node ${action.frameId} is not a frame.`);
          }
          const { content, ...frame } = node;
          void content;
          return frame;
        }),
      ],
    }));
    return changed(state, document, [action.frameId]);
  }
  if (action.type === "set_grid_cell_content") {
    const document = updatePage(state.document, action.pageId, (page) => {
      const nodes = mapNode(page.nodes, action.gridId, (node) => {
        if (node.kind !== "grid") {
          throw new Error(`Canvas node ${action.gridId} is not a grid.`);
        }
        if (!node.cells.some((cell) => cell.slotId === action.slotId)) {
          throw new Error(
            `Canvas grid ${action.gridId} has no slot ${action.slotId}.`,
          );
        }
        return {
          ...node,
          cells: node.cells.map((cell) =>
            cell.slotId === action.slotId
              ? {
                  ...cell,
                  content: {
                    image: action.image,
                  },
                }
              : cell,
          ),
        };
      });
      validatePageNodes(nodes);
      return {
        ...page,
        nodes: [...nodes],
      };
    });
    return changed(state, document, [action.gridId]);
  }
  if (action.type === "remove_grid_cell_content") {
    const document = updatePage(state.document, action.pageId, (page) => ({
      ...page,
      nodes: [
        ...mapNode(page.nodes, action.gridId, (node) => {
          if (node.kind !== "grid") {
            throw new Error(`Canvas node ${action.gridId} is not a grid.`);
          }
          return {
            ...node,
            cells: node.cells.map((cell) => {
              if (cell.slotId !== action.slotId) return cell;
              const { content, ...emptyCell } = cell;
              void content;
              return emptyCell;
            }),
          };
        }),
      ],
    }));
    return changed(state, document, [action.gridId]);
  }
  if (action.type === "set_image_content") {
    const document = updatePage(state.document, action.pageId, (page) => ({
      ...page,
      nodes: [
        ...mapNode(page.nodes, action.nodeId, (node) => {
          if (node.kind !== "image") {
            throw new Error(`Canvas node ${action.nodeId} is not an image.`);
          }
          return {
            ...node,
            image: action.image,
          };
        }),
      ],
    }));
    return changed(state, document, [action.nodeId]);
  }
  if (action.type === "set_graphic_content") {
    const document = updatePage(state.document, action.pageId, (page) => ({
      ...page,
      nodes: [
        ...mapNode(page.nodes, action.nodeId, (node) => {
          if (node.kind !== "graphic") {
            throw new Error(`Canvas node ${action.nodeId} is not a graphic.`);
          }
          return {
            ...node,
            source: action.source,
          };
        }),
      ],
    }));
    return changed(state, document, [action.nodeId]);
  }

  const page = activePage(state);
  if (action.type === "preview_replace_node") {
    if (action.node.id === "") {
      throw new Error("Canvas node id cannot be empty.");
    }
    const nodes = mapNode(page.nodes, action.node.id, (node) => {
      if (node.kind !== action.node.kind) {
        throw new Error(
          `Canvas node ${node.id} cannot change its semantic kind.`,
        );
      }
      return action.node;
    });
    validatePageNodes(nodes);
    return previewChanged(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
      [action.node.id],
    );
  }
  if (action.type === "add_node") {
    const pageId = action.pageId ?? page.id;
    const document = updatePage(state.document, pageId, (candidate) => {
      const nodes = [...candidate.nodes, action.node];
      validatePageNodes(nodes);
      return {
        ...candidate,
        nodes,
      };
    });
    return changed(state, document, [action.node.id]);
  }
  if (action.type === "add_nodes") {
    if (action.nodes.length === 0) {
      return state;
    }
    const pageId = action.pageId ?? page.id;
    const document = updatePage(state.document, pageId, (candidate) => {
      const nodes = [...candidate.nodes, ...action.nodes];
      validatePageNodes(nodes);
      return {
        ...candidate,
        nodes,
      };
    });
    return changed(
      state,
      document,
      action.nodes.map((node) => node.id),
    );
  }
  if (action.type === "replace_node") {
    if (action.node.id === "") {
      throw new Error("Canvas node ID cannot be empty.");
    }
    const nodes = mapNode(page.nodes, action.node.id, (node) => {
      if (
        node.kind !== action.node.kind &&
        !(
          (node.kind === "image" || node.kind === "graphic") &&
          (action.node.kind === "image" || action.node.kind === "graphic")
        )
      ) {
        throw new Error(
          "Canvas node replacement cannot change its semantic kind.",
        );
      }
      return action.node;
    });
    validatePageNodes(nodes);
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
    );
  }
  if (action.type === "transform_node") {
    const nodes = mapNode(page.nodes, action.id, (node) =>
      transformNode(node, action.transform),
    );
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
    );
  }
  if (action.type === "transform_nodes") {
    if (action.transforms.length === 0) {
      return state;
    }
    const pageId = action.pageId ?? page.id;
    const updates = new Map(
      action.transforms.map((update) => [update.id, update.transform]),
    );
    const document = updatePage(state.document, pageId, (candidate) => {
      let nodes = candidate.nodes;
      for (const [id, transform] of updates) {
        nodes = mapNode(nodes, id, (node) => transformNode(node, transform));
      }
      validatePageNodes(nodes);
      return {
        ...candidate,
        nodes: [...nodes],
      };
    });
    return changed(state, document);
  }
  if (action.type === "delete_selected") {
    if (state.selectedIds.length === 0) {
      return state;
    }
    const nodes = deleteNodes(page.nodes, new Set(state.selectedIds));
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
      [],
    );
  }
  if (action.type === "delete_nodes") {
    if (action.ids.length === 0) {
      return state;
    }
    const pageId = action.pageId ?? page.id;
    const ids = new Set(action.ids);
    const document = updatePage(state.document, pageId, (candidate) => {
      const nodes = deleteNodes(candidate.nodes, ids);
      validatePageNodes(nodes);
      return {
        ...candidate,
        nodes: [...nodes],
      };
    });
    return changed(
      state,
      document,
      state.selectedIds.filter((id) => !ids.has(id)),
    );
  }
  if (action.type === "align_selected") {
    if (state.selectedIds.length < 2) {
      return state;
    }
    const nodes = alignNodes(
      page.nodes,
      new Set(state.selectedIds),
      action.alignment,
    );
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
    );
  }
  if (action.type === "distribute_selected") {
    if (state.selectedIds.length < 3) {
      return state;
    }
    const nodes = distributeNodes(
      page.nodes,
      new Set(state.selectedIds),
      action.axis,
    );
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
    );
  }
  if (action.type === "group_selected") {
    const locations = state.selectedIds.map((id) => locateNode(page.nodes, id));
    if (locations.some((location) => !location)) {
      throw new Error("Every selected Canvas node must exist before grouping.");
    }
    const parentPath = locations[0]?.parentPath ?? [];
    if (
      locations.some(
        (location) => location!.parentPath.join("\0") !== parentPath.join("\0"),
      )
    ) {
      throw new Error("Canvas nodes must be siblings before grouping.");
    }
    const nodes = updateSiblingsAtPath(page.nodes, parentPath, (siblings) =>
      groupSelectedSiblings(
        siblings,
        new Set(state.selectedIds),
        action.groupId,
        action.name ?? "组合",
      ),
    );
    validatePageNodes(nodes);
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
      [action.groupId],
    );
  }
  if (action.type === "ungroup") {
    const nodes = ungroupSiblings(page.nodes, action.groupId);
    validatePageNodes(nodes);
    const group = locateNode(page.nodes, action.groupId)?.node;
    return changed(
      state,
      updatePage(state.document, page.id, (candidate) => ({
        ...candidate,
        nodes: [...nodes],
      })),
      group?.kind === "group" ? group.children.map((child) => child.id) : [],
    );
  }
  const nodes = moveLayer(page.nodes, action.id, action.move);
  if (nodes === page.nodes) {
    return state;
  }
  return changed(
    state,
    updatePage(state.document, page.id, (candidate) => ({
      ...candidate,
      nodes: [...nodes],
    })),
  );
}
