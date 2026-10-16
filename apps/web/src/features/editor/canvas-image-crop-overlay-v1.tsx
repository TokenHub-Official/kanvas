import type { PointerEvent } from "react";

import type { EditorResizeHandleV1 } from "./editor-geometry-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const CROP_GRID_DIVISIONS = 3;
const CROP_CONTRAST_STROKE_MULTIPLIER = 3;
const CROP_HANDLE_SIZE_PX = 10;
const CROP_SOURCE_STROKE_PX = 1.5;
const CROP_SOURCE_STROKE_OPACITY = 0.5;
const CROP_OUTSIDE_MASK_OPACITY = 0.42;
const CROP_HANDLE_RADIUS_RATIO = 0.22;
const resizeCursorClasses: Readonly<Record<EditorResizeHandleV1, string>> = {
  n: "cursor-ns-resize",
  ne: "cursor-nesw-resize",
  e: "cursor-ew-resize",
  se: "cursor-nwse-resize",
  s: "cursor-ns-resize",
  sw: "cursor-nesw-resize",
  w: "cursor-ew-resize",
  nw: "cursor-nwse-resize",
};

interface CropMaskRectV1 {
  readonly height: number;
  readonly id: "bottom" | "left" | "right" | "top";
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export function canvasImageCropMaskRectsV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
  sourceNode: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
): readonly CropMaskRectV1[] {
  const crop = node.image.crop;
  const source = sourceNode.transform;
  const cropX =
    (source.flipX ? 1 - crop.x - crop.width : crop.x) * source.width;
  const cropY =
    (source.flipY ? 1 - crop.y - crop.height : crop.y) * source.height;
  const cropWidth = crop.width * source.width;
  const cropHeight = crop.height * source.height;
  const cropRight = cropX + cropWidth;
  const cropBottom = cropY + cropHeight;
  const rects: readonly CropMaskRectV1[] = [
    { id: "top", x: 0, y: 0, width: source.width, height: cropY },
    {
      id: "bottom",
      x: 0,
      y: cropBottom,
      width: source.width,
      height: source.height - cropBottom,
    },
    { id: "left", x: 0, y: cropY, width: cropX, height: cropHeight },
    {
      id: "right",
      x: cropRight,
      y: cropY,
      width: source.width - cropRight,
      height: cropHeight,
    },
  ];
  return rects.filter((rect) => rect.width > 0 && rect.height > 0);
}

export function CanvasImageCropOverlayV1({
  freeCrop,
  node,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  sourceNode,
  zoom,
}: {
  readonly freeCrop: boolean;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "image" }>;
  readonly onResizePointerDown: (
    event: PointerEvent<SVGRectElement>,
    handle: EditorResizeHandleV1,
  ) => void;
  readonly onResizePointerMove: (event: PointerEvent<SVGRectElement>) => void;
  readonly onResizePointerUp: (event: PointerEvent<SVGRectElement>) => void;
  readonly onPointerDown: (event: PointerEvent<SVGRectElement>) => void;
  readonly onPointerMove: (event: PointerEvent<SVGRectElement>) => void;
  readonly onPointerUp: (event: PointerEvent<SVGRectElement>) => void;
  readonly sourceNode: Extract<EditorRuntimeNodeV1, { kind: "image" }>;
  readonly zoom: number;
}) {
  const transform = node.transform;
  const sourceTransform = sourceNode.transform;
  const maskRects = canvasImageCropMaskRectsV1(node, sourceNode);
  const strokeWidth = 2 / zoom;
  const handleSize = CROP_HANDLE_SIZE_PX / zoom;
  const handles = [
    ["nw", 0, 0],
    ["n", transform.width / 2, 0],
    ["ne", transform.width, 0],
    ["e", transform.width, transform.height / 2],
    ["se", transform.width, transform.height],
    ["s", transform.width / 2, transform.height],
    ["sw", 0, transform.height],
    ["w", 0, transform.height / 2],
  ] as const;
  return (
    <g data-image-crop-overlay="true">
      <g
        pointerEvents="none"
        transform={`translate(${String(sourceTransform.x)} ${String(
          sourceTransform.y,
        )}) rotate(${String(sourceTransform.rotation)} ${String(
          sourceTransform.width / 2,
        )} ${String(sourceTransform.height / 2)})`}
      >
        {maskRects.map((rect) => (
          <rect
            data-crop-mask-region={rect.id}
            fill="#111827"
            height={rect.height}
            key={rect.id}
            opacity={CROP_OUTSIDE_MASK_OPACITY}
            width={rect.width}
            x={rect.x}
            y={rect.y}
          />
        ))}
      </g>
      <g
        opacity={CROP_SOURCE_STROKE_OPACITY}
        pointerEvents="none"
        transform={`translate(${String(sourceTransform.x)} ${String(
          sourceTransform.y,
        )}) rotate(${String(sourceTransform.rotation)} ${String(
          sourceTransform.width / 2,
        )} ${String(sourceTransform.height / 2)})`}
      >
        <rect
          fill="none"
          height={sourceTransform.height}
          stroke="#3048f5"
          strokeWidth={CROP_SOURCE_STROKE_PX / zoom}
          width={sourceTransform.width}
        />
      </g>
      <g
        transform={`translate(${String(transform.x)} ${String(
          transform.y,
        )}) rotate(${String(transform.rotation)} ${String(
          transform.width / 2,
        )} ${String(transform.height / 2)})`}
      >
        <rect
          aria-label="Move image crop frame"
          className="cursor-move"
          fill="transparent"
          height={transform.height}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          pointerEvents="all"
          stroke="#ffffff"
          strokeWidth={strokeWidth * CROP_CONTRAST_STROKE_MULTIPLIER}
          width={transform.width}
        />
        <rect
          fill="none"
          height={transform.height}
          pointerEvents="none"
          stroke="#3048f5"
          strokeWidth={strokeWidth}
          width={transform.width}
        />
        {[1, 2].map((division) => (
          <g key={division} opacity={0.82} pointerEvents="none">
            <line
              stroke="#ffffff"
              strokeWidth={strokeWidth}
              x1={(transform.width * division) / CROP_GRID_DIVISIONS}
              x2={(transform.width * division) / CROP_GRID_DIVISIONS}
              y1={0}
              y2={transform.height}
            />
            <line
              stroke="#ffffff"
              strokeWidth={strokeWidth}
              x1={0}
              x2={transform.width}
              y1={(transform.height * division) / CROP_GRID_DIVISIONS}
              y2={(transform.height * division) / CROP_GRID_DIVISIONS}
            />
          </g>
        ))}
        {freeCrop
          ? handles.map(([handle, x, y]) => (
              <rect
                aria-label={`Resize crop ${handle}`}
                className={`canvas-v1-handle ${resizeCursorClasses[handle]}`}
                fill="#ffffff"
                height={handleSize}
                key={handle}
                onPointerDown={(event) => {
                  onResizePointerDown(event, handle);
                }}
                onPointerCancel={onResizePointerUp}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                rx={handleSize * CROP_HANDLE_RADIUS_RATIO}
                stroke="#3048f5"
                strokeWidth={strokeWidth}
                width={handleSize}
                x={x - handleSize / 2}
                y={y - handleSize / 2}
              />
            ))
          : null}
      </g>
    </g>
  );
}
