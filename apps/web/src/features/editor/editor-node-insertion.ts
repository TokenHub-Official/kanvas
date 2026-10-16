import type {
  EditorArtifactReferenceV1,
  EditorCatalogReferenceV1,
  EditorNodeKindV1,
} from "@kanvas/contracts/editor";
import type { CanvasTextStyleSnapshotV1 } from "./canvas-text-style-v1.js";

export interface EditorPoint {
  readonly x: number;
  readonly y: number;
}

export interface EditorRect extends EditorPoint {
  readonly height: number;
  readonly width: number;
}

export interface EditorIntrinsicSize {
  readonly height: number;
  readonly width: number;
}

export type EditorImageInsertionSource =
  | {
      readonly kind: "artifact";
      readonly reference: EditorArtifactReferenceV1;
    }
  | {
      readonly kind: "clipboard";
      readonly localId: string;
      readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
      readonly name: string;
      readonly previewUrl: string;
    }
  | {
      readonly kind: "generated_result";
      readonly reference: EditorArtifactReferenceV1;
      readonly runId: string;
    }
  | {
      readonly kind: "local_file";
      readonly localId: string;
      readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
      readonly name: string;
      readonly previewUrl: string;
      readonly size: number;
    };

export type EditorGraphicInsertionSource =
  | {
      readonly kind: "artifact";
      readonly reference: EditorArtifactReferenceV1;
    }
  | {
      readonly catalogId: string;
      readonly kind: "catalog";
      readonly resourceId: string;
      readonly revision: string;
    };

export type EditorNodeInsertionPayload =
  | {
      readonly intrinsicSize: EditorIntrinsicSize;
      readonly kind: "image";
      readonly source: EditorImageInsertionSource;
    }
  | {
      readonly font?: {
        readonly family?: string;
        readonly fontId: string;
        readonly revision: string;
        readonly source?: "builtin" | "workspace";
      };
      readonly kind: "text";
      readonly preset?: EditorCatalogReferenceV1;
      readonly style?: CanvasTextStyleSnapshotV1;
      readonly text?: string;
    }
  | {
      readonly definition: EditorCatalogReferenceV1;
      readonly kind: "shape";
    }
  | {
      readonly definition: EditorCatalogReferenceV1;
      readonly kind: "line";
    }
  | {
      readonly color: string;
      readonly kind: "note";
      readonly text?: string;
    }
  | {
      readonly intrinsicSize: EditorIntrinsicSize;
      readonly kind: "graphic";
      readonly source: EditorGraphicInsertionSource;
    }
  | {
      readonly definition: EditorCatalogReferenceV1;
      readonly kind: "frame";
    }
  | {
      readonly definition: EditorCatalogReferenceV1;
      readonly kind: "grid";
    };

export type EditorNodeInsertionTarget =
  | {
      readonly kind: "canvas_adjacent";
      readonly pageId: string;
      readonly sourceRect: EditorRect;
      readonly visiblePageRect: EditorRect;
    }
  | {
      readonly kind: "canvas_center";
      readonly pageId: string;
      readonly visiblePageRect: EditorRect;
    }
  | {
      readonly kind: "canvas_point";
      readonly pageId: string;
      readonly point: EditorPoint;
    }
  | {
      readonly frameId: string;
      readonly kind: "frame_content";
      readonly pageId: string;
    }
  | {
      readonly gridId: string;
      readonly kind: "grid_cell";
      readonly pageId: string;
      readonly slotId: string;
    }
  | {
      readonly kind: "page_background";
      readonly pageId: string;
    }
  | {
      readonly kind: "replace_node_content";
      readonly nodeId: string;
      readonly pageId: string;
    };

export interface EditorNodeInsertionIntent {
  readonly payload: EditorNodeInsertionPayload;
  readonly requestId: string;
  readonly target: EditorNodeInsertionTarget;
}

const maximumVisibleFraction = 0.62;

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function fitNodeSizeForInsertion(
  intrinsicSize: EditorIntrinsicSize,
  availableRect: EditorRect,
): EditorIntrinsicSize {
  const intrinsicWidth = positive(intrinsicSize.width);
  const intrinsicHeight = positive(intrinsicSize.height);
  const maximumWidth = positive(availableRect.width) * maximumVisibleFraction;
  const maximumHeight = positive(availableRect.height) * maximumVisibleFraction;
  const scale = Math.min(
    1,
    maximumWidth / intrinsicWidth,
    maximumHeight / intrinsicHeight,
  );

  return {
    width: intrinsicWidth * scale,
    height: intrinsicHeight * scale,
  };
}

export function centeredInsertionRect(
  intrinsicSize: EditorIntrinsicSize,
  visiblePageRect: EditorRect,
): EditorRect {
  const size = fitNodeSizeForInsertion(intrinsicSize, visiblePageRect);

  return {
    x: visiblePageRect.x + (visiblePageRect.width - size.width) / 2,
    y: visiblePageRect.y + (visiblePageRect.height - size.height) / 2,
    width: size.width,
    height: size.height,
  };
}

export function pointedInsertionRect(
  intrinsicSize: EditorIntrinsicSize,
  point: EditorPoint,
  sizingRect: EditorRect,
): EditorRect {
  const size = fitNodeSizeForInsertion(intrinsicSize, sizingRect);

  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function overlapArea(left: EditorRect, right: EditorRect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

export function adjacentInsertionRect(
  intrinsicSize: EditorIntrinsicSize,
  sourceRect: EditorRect,
  visiblePageRect: EditorRect,
  gap = 32,
): EditorRect {
  const size = fitNodeSizeForInsertion(intrinsicSize, visiblePageRect);
  const minimumX = visiblePageRect.x;
  const minimumY = visiblePageRect.y;
  const maximumX = visiblePageRect.x + visiblePageRect.width - size.width;
  const maximumY = visiblePageRect.y + visiblePageRect.height - size.height;
  const sourceCenterX = sourceRect.x + sourceRect.width / 2;
  const sourceCenterY = sourceRect.y + sourceRect.height / 2;
  const rectAt = (centerX: number, centerY: number) => ({
    x: clamp(centerX - size.width / 2, minimumX, maximumX),
    y: clamp(centerY - size.height / 2, minimumY, maximumY),
    ...size,
  });
  const candidates = [
    rectAt(
      sourceRect.x + sourceRect.width + gap + size.width / 2,
      sourceCenterY,
    ),
    rectAt(sourceRect.x - gap - size.width / 2, sourceCenterY),
    rectAt(
      sourceCenterX,
      sourceRect.y + sourceRect.height + gap + size.height / 2,
    ),
    rectAt(sourceCenterX, sourceRect.y - gap - size.height / 2),
  ];

  return candidates.reduce((best, candidate) =>
    overlapArea(candidate, sourceRect) < overlapArea(best, sourceRect)
      ? candidate
      : best,
  );
}

export function cascadeInsertionRects(
  rects: readonly EditorRect[],
  offset = 32,
): readonly EditorRect[] {
  return rects.map((rect, index) => ({
    ...rect,
    x: rect.x + index * offset,
    y: rect.y + index * offset,
  }));
}

export function durableImageInsertionReference(
  source: EditorImageInsertionSource,
): EditorArtifactReferenceV1 | undefined {
  return source.kind === "artifact" || source.kind === "generated_result"
    ? source.reference
    : undefined;
}

export function insertionCreatesTopLevelNode(
  target: EditorNodeInsertionTarget,
): boolean {
  return (
    target.kind === "canvas_adjacent" ||
    target.kind === "canvas_center" ||
    target.kind === "canvas_point"
  );
}

export function insertionPayloadNodeKind(
  payload: EditorNodeInsertionPayload,
): Exclude<EditorNodeKindV1, "group"> {
  return payload.kind === "note" ? "shape" : payload.kind;
}
