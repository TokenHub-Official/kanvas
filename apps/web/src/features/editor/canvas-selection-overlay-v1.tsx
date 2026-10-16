import type { PointerEvent } from "react";

import {
  canvasRotationHandleYV1,
  canvasSelectionShowsTransformHandlesV1,
} from "./canvas-operation-bars-model.js";
import {
  editorSelectionBoundsV1,
  type EditorResizeHandleV1,
} from "./editor-geometry-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  canvasLineRotationHandleV1,
  canvasLineWorldPointsV1,
} from "./canvas-line-editing-v1.js";
import type { CanvasShapeConnectionAnchorV1 } from "./canvas-line-connection-v1.js";

const HANDLE_SIZE_PX = 10;
const RECT_HANDLE_RADIUS_RATIO = 0.22;
const ROTATION_HANDLE_RADIUS_RATIO = 0.62;
const MULTI_SELECTION_DASH_LENGTH_PX = 5;
const MULTI_SELECTION_DASH_GAP_PX = 4;
const MULTI_SELECTION_HANDLE_RADIUS_RATIO = 0.35;
const CURVE_POINT_COUNT = 3;
const LINE_ROTATION_HANDLE_OFFSET_PX = 34;
const LINE_CONTROL_DASH_PX = 4;
const LINE_POINT_HANDLE_RADIUS_RATIO = 0.72;
const LINE_SELECTION_HALO_PX = 5;
const CONNECTION_ANCHOR_RADIUS_RATIO = 0.58;
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

export function CanvasSelectionOverlayV1({
  connectionAnchors = [],
  editable = true,
  nodes,
  onHandlePointerDown,
  onLinePointPointerDown,
  zoom,
}: {
  readonly connectionAnchors?: readonly CanvasShapeConnectionAnchorV1[];
  readonly editable?: boolean;
  readonly nodes: readonly EditorRuntimeNodeV1[];
  readonly onHandlePointerDown: (
    event: PointerEvent<SVGElement>,
    kind: "resize" | "rotate",
    handle?: EditorResizeHandleV1,
  ) => void;
  readonly onLinePointPointerDown?: (
    event: PointerEvent<SVGElement>,
    pointIndex: number,
  ) => void;
  readonly zoom: number;
}) {
  const bounds = editorSelectionBoundsV1(nodes);
  if (!bounds) {
    return null;
  }
  const single = nodes.length === 1 ? nodes[0] : undefined;
  const size = HANDLE_SIZE_PX / zoom;
  const stroke = 2 / zoom;
  const handles = [
    ["nw", bounds.x, bounds.y],
    ["n", bounds.x + bounds.width / 2, bounds.y],
    ["ne", bounds.x + bounds.width, bounds.y],
    ["e", bounds.x + bounds.width, bounds.y + bounds.height / 2],
    ["se", bounds.x + bounds.width, bounds.y + bounds.height],
    ["s", bounds.x + bounds.width / 2, bounds.y + bounds.height],
    ["sw", bounds.x, bounds.y + bounds.height],
    ["w", bounds.x, bounds.y + bounds.height / 2],
  ] as const;
  if (single?.kind === "line" && single.role === "design") {
    const points = canvasLineWorldPointsV1(single);
    const path =
      single.pathKind === "curve" && points.length >= CURVE_POINT_COUNT
        ? `M${String(points[0]!.x)} ${String(points[0]!.y)} Q${String(
            points[1]!.x,
          )} ${String(points[1]!.y)} ${String(points[2]!.x)} ${String(
            points[2]!.y,
          )}`
        : points
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"}${String(point.x)} ${String(point.y)}`,
            )
            .join(" ");
    const rotation = canvasLineRotationHandleV1(
      single,
      LINE_ROTATION_HANDLE_OFFSET_PX / zoom,
    );
    const originalStrokeColor =
      single.stroke.paint.kind === "solid"
        ? single.stroke.paint.color
        : "#151515";
    const originalStrokeWidth = single.stroke.width / zoom;
    const originalDash = single.stroke.dash?.map((value) => value / zoom);
    return (
      <g data-selection-overlay="line">
        {connectionAnchors.map((anchor) => (
          <circle
            aria-label={`Connect to ${anchor.binding.nodeId} ${anchor.anchor}`}
            cx={anchor.point.x}
            cy={anchor.point.y}
            data-connection-anchor={anchor.anchor}
            data-connection-node-id={anchor.binding.nodeId}
            fill="#ffffff"
            key={`${anchor.binding.nodeId}-${anchor.anchor}`}
            pointerEvents="none"
            r={size * CONNECTION_ANCHOR_RADIUS_RATIO}
            stroke="#ff2f70"
            strokeWidth={stroke}
          />
        ))}
        <path
          data-line-selection-halo=""
          d={path}
          fill="none"
          opacity={0.22}
          pointerEvents="none"
          stroke="#3048f5"
          strokeLinecap={single.capStyle ?? "round"}
          strokeLinejoin={single.joinStyle ?? "round"}
          strokeWidth={originalStrokeWidth + LINE_SELECTION_HALO_PX / zoom}
        />
        <path
          data-line-selection-restore=""
          d={path}
          fill="none"
          opacity={single.opacity}
          pointerEvents="none"
          stroke={originalStrokeColor}
          strokeDasharray={originalDash?.join(" ")}
          strokeLinecap={single.capStyle ?? "round"}
          strokeLinejoin={single.joinStyle ?? "round"}
          strokeWidth={originalStrokeWidth}
        />
        {single.pathKind === "curve" && points.length >= CURVE_POINT_COUNT ? (
          <path
            d={`M${String(points[0]!.x)} ${String(points[0]!.y)} L${String(
              points[1]!.x,
            )} ${String(points[1]!.y)} L${String(points[2]!.x)} ${String(
              points[2]!.y,
            )}`}
            fill="none"
            pointerEvents="none"
            stroke="#9aa5ff"
            strokeDasharray={`${String(
              LINE_CONTROL_DASH_PX / zoom,
            )} ${String(LINE_CONTROL_DASH_PX / zoom)}`}
            strokeWidth={1 / zoom}
          />
        ) : null}
        {editable && !single.locked
          ? points.map((point, index) => (
              <circle
                aria-label={`Line point ${String(index + 1)}`}
                className="canvas-v1-handle cursor-move"
                cx={point.x}
                cy={point.y}
                fill={
                  single.pathKind === "curve" && index === 1
                    ? "#f0f2ff"
                    : "#ffffff"
                }
                key={`${single.id}-point-${String(index)}`}
                onPointerDown={(event) => {
                  onLinePointPointerDown?.(event, index);
                }}
                r={size * LINE_POINT_HANDLE_RADIUS_RATIO}
                stroke="#3048f5"
                strokeWidth={stroke}
              />
            ))
          : null}
        {editable && !single.locked ? (
          <>
            <line
              pointerEvents="none"
              stroke="#3048f5"
              strokeWidth={stroke}
              x1={rotation.anchor.x}
              x2={rotation.handle.x}
              y1={rotation.anchor.y}
              y2={rotation.handle.y}
            />
            <circle
              className="canvas-v1-handle-rotate cursor-grab"
              cx={rotation.handle.x}
              cy={rotation.handle.y}
              fill="#ffffff"
              onPointerDown={(event) => {
                onHandlePointerDown(event, "rotate");
              }}
              r={size * ROTATION_HANDLE_RADIUS_RATIO}
              stroke="#3048f5"
              strokeWidth={stroke}
            />
          </>
        ) : null}
      </g>
    );
  }
  if (single) {
    const transform = single.transform;
    const rotationHandleY = canvasRotationHandleYV1(transform.height, size);
    return (
      <g
        data-selection-overlay="true"
        transform={`translate(${String(
          transform.x,
        )} ${String(transform.y)}) rotate(${String(
          transform.rotation,
        )} ${String(transform.width / 2)} ${String(transform.height / 2)})`}
      >
        <rect
          fill="none"
          height={transform.height}
          pointerEvents="none"
          stroke="#3048f5"
          strokeWidth={stroke}
          width={transform.width}
        />
        {editable && canvasSelectionShowsTransformHandlesV1(nodes) ? (
          <>
            {(
              [
                ["nw", 0, 0],
                ["n", transform.width / 2, 0],
                ["ne", transform.width, 0],
                ["e", transform.width, transform.height / 2],
                ["se", transform.width, transform.height],
                ["s", transform.width / 2, transform.height],
                ["sw", 0, transform.height],
                ["w", 0, transform.height / 2],
              ] as const
            ).map(([handle, x, y]) => (
              <rect
                className={`canvas-v1-handle ${resizeCursorClasses[handle]}`}
                fill="#ffffff"
                height={size}
                key={handle}
                onPointerDown={(event) => {
                  onHandlePointerDown(event, "resize", handle);
                }}
                rx={size * RECT_HANDLE_RADIUS_RATIO}
                stroke="#3048f5"
                strokeWidth={stroke}
                width={size}
                x={x - size / 2}
                y={y - size / 2}
              />
            ))}
            <line
              pointerEvents="none"
              stroke="#3048f5"
              strokeWidth={stroke}
              x1={transform.width / 2}
              x2={transform.width / 2}
              y1={transform.height}
              y2={rotationHandleY}
            />
            <circle
              className="canvas-v1-handle-rotate cursor-grab"
              cx={transform.width / 2}
              cy={rotationHandleY}
              fill="#ffffff"
              onPointerDown={(event) => {
                onHandlePointerDown(event, "rotate");
              }}
              r={size * ROTATION_HANDLE_RADIUS_RATIO}
              stroke="#3048f5"
              strokeWidth={stroke}
            />
          </>
        ) : null}
      </g>
    );
  }
  return (
    <g data-selection-overlay="true">
      <rect
        fill="none"
        height={bounds.height}
        pointerEvents="none"
        stroke="#3048f5"
        strokeDasharray={`${String(
          MULTI_SELECTION_DASH_LENGTH_PX / zoom,
        )} ${String(MULTI_SELECTION_DASH_GAP_PX / zoom)}`}
        strokeWidth={stroke}
        width={bounds.width}
        x={bounds.x}
        y={bounds.y}
      />
      {handles.map(([handle, x, y]) => (
        <circle
          cx={x}
          cy={y}
          fill="#ffffff"
          key={handle}
          pointerEvents="none"
          r={size * MULTI_SELECTION_HANDLE_RADIUS_RATIO}
          stroke="#3048f5"
          strokeWidth={stroke}
        />
      ))}
    </g>
  );
}
