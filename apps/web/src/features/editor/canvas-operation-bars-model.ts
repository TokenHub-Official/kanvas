import type { EditorNodeKindV1 } from "@kanvas/contracts/editor";

export type CanvasNodeQuickActionV1 = "delete" | "duplicate" | "lock";

export type CanvasNodeTypeActionV1 =
  | "align"
  | "corner_radius"
  | "crop"
  | "effects"
  | "fill"
  | "fit"
  | "flip"
  | "font"
  | "font_size"
  | "group"
  | "image_adjustments"
  | "image_filters"
  | "line_style"
  | "position"
  | "properties"
  | "set_as_background"
  | "shape_parameters"
  | "shape_style"
  | "text_spacing"
  | "text_style"
  | "ungroup";

export interface CanvasOperationBarProjectionV1 {
  readonly quickActions: readonly CanvasNodeQuickActionV1[];
  readonly typeActions: readonly CanvasNodeTypeActionV1[];
}

export interface CanvasSelectionBoundsV1 {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export function canvasLockControlV1(locked: boolean): {
  readonly icon: "lock" | "unlock";
} {
  return locked
    ? {
        icon: "unlock",
      }
    : {
        icon: "lock",
      };
}

const commonQuickActions = [
  "lock",
  "duplicate",
  "delete",
] as const satisfies readonly CanvasNodeQuickActionV1[];
const ROTATION_HANDLE_DISTANCE_MULTIPLIER = 3;
const OPERATION_BAR_SELECTION_GAP = 12;
const OPERATION_BAR_VIEWPORT_INSET = 8;
const OPERATION_BAR_FALLBACK_CLEARANCE = 64;

const typeActions = {
  image: [
    "image_adjustments",
    "image_filters",
    "corner_radius",
    "crop",
    "fit",
    "flip",
    "set_as_background",
    "position",
    "properties",
  ],
  text: [
    "font",
    "font_size",
    "text_style",
    "fill",
    "align",
    "text_spacing",
    "effects",
    "position",
    "properties",
  ],
  shape: [
    "fill",
    "shape_style",
    "shape_parameters",
    "flip",
    "position",
    "properties",
  ],
  line: ["fill", "line_style", "flip", "position", "properties"],
  graphic: ["fill", "flip", "position", "properties"],
  frame: ["shape_style", "flip", "position", "properties"],
  grid: ["shape_style", "flip", "position", "properties"],
  group: ["position", "properties", "ungroup"],
} as const satisfies Record<
  EditorNodeKindV1,
  readonly CanvasNodeTypeActionV1[]
>;

export function projectCanvasOperationBarsV1(
  kinds: readonly EditorNodeKindV1[],
): CanvasOperationBarProjectionV1 {
  if (kinds.length === 0) {
    return {
      quickActions: [],
      typeActions: [],
    };
  }
  if (kinds.length > 1) {
    return {
      quickActions: ["duplicate", "delete"],
      typeActions: ["align", "group", "position", "properties"],
    };
  }
  return {
    quickActions: commonQuickActions,
    typeActions: typeActions[kinds[0]!],
  };
}

export function canvasRotationHandleYV1(
  nodeHeight: number,
  handleSize: number,
): number {
  return nodeHeight + handleSize * ROTATION_HANDLE_DISTANCE_MULTIPLIER;
}

export function canvasSelectionShowsTransformHandlesV1(
  nodes: readonly { readonly locked: boolean }[],
): boolean {
  return nodes.length === 1 && !nodes[0]!.locked;
}

export function canvasNodeQuickBarPositionV1(
  bounds: CanvasSelectionBoundsV1,
  zoom: number,
  viewport?: {
    readonly height: number;
    readonly width: number;
  },
  barSize = { height: 40, width: 112 },
): {
  readonly left: number;
  readonly top: number;
} {
  const topEdge = bounds.y * zoom;
  const selectionBottom = (bounds.y + bounds.height) * zoom;
  const selectionLeft = bounds.x * zoom;
  const selectionRight = (bounds.x + bounds.width) * zoom;
  const above = topEdge - barSize.height - OPERATION_BAR_SELECTION_GAP;
  const below = selectionBottom + OPERATION_BAR_SELECTION_GAP;
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.max(minimum, Math.min(maximum, value));
  const horizontalInset = barSize.width / 2 + OPERATION_BAR_VIEWPORT_INSET;
  const verticalInset = OPERATION_BAR_VIEWPORT_INSET;
  const centeredLeft = (bounds.x + bounds.width / 2) * zoom;
  if (!viewport) {
    return {
      left: centeredLeft,
      top:
        topEdge >= OPERATION_BAR_FALLBACK_CLEARANCE
          ? above
          : selectionBottom + OPERATION_BAR_FALLBACK_CLEARANCE,
    };
  }
  const maximumTop = Math.max(
    verticalInset,
    viewport.height - barSize.height - verticalInset,
  );
  if (above >= verticalInset) {
    return {
      left: clamp(
        centeredLeft,
        horizontalInset,
        Math.max(horizontalInset, viewport.width - horizontalInset),
      ),
      top: Math.min(above, maximumTop),
    };
  }
  if (below <= maximumTop) {
    return {
      left: clamp(
        centeredLeft,
        horizontalInset,
        Math.max(horizontalInset, viewport.width - horizontalInset),
      ),
      top: Math.max(verticalInset, below),
    };
  }
  const selectionCenterY = (bounds.y + bounds.height / 2) * zoom;
  const rightCenter =
    selectionRight + barSize.width / 2 + OPERATION_BAR_SELECTION_GAP;
  const leftCenter =
    selectionLeft - barSize.width / 2 - OPERATION_BAR_SELECTION_GAP;
  let left = clamp(
    centeredLeft,
    horizontalInset,
    Math.max(horizontalInset, viewport.width - horizontalInset),
  );
  if (rightCenter <= viewport.width - OPERATION_BAR_VIEWPORT_INSET) {
    left = rightCenter;
  } else if (leftCenter >= OPERATION_BAR_VIEWPORT_INSET) {
    left = leftCenter;
  }
  return {
    left,
    top: clamp(
      selectionCenterY - barSize.height / 2,
      verticalInset,
      maximumTop,
    ),
  };
}
