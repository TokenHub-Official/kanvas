import type {
  EditorShapeNodeV1,
  EditorTextNodeV1,
} from "@kanvas/contracts/editor";
import type { CSSProperties } from "react";

import { canvasShapeDefinitionV1 } from "./shape-catalog-v1.js";
import {
  canvasStickyNoteFoldPathV1,
  materializeCanvasShapePathV1,
} from "./shape-geometry-v1.js";
import { CanvasTextNodeV1 } from "./canvas-text-node-v1.js";
import {
  safeSvgIdV1,
  SvgPaintGradientV1,
  svgPaintPresentationV1,
} from "./canvas-svg-paint-v1.js";

function blendMode(
  value: EditorShapeNodeV1["blendMode"],
): CSSProperties["mixBlendMode"] {
  return value.replaceAll("_", "-") as CSSProperties["mixBlendMode"];
}

function shapeStrokePresentationV1(node: EditorShapeNodeV1, nodeId: string) {
  if (node.stroke.alignment === "center") {
    return {
      strokeWidth: node.stroke.width,
    };
  }
  return {
    ...(node.stroke.alignment === "inside"
      ? { clipPath: `url(#${nodeId}-stroke-inside)` }
      : { mask: `url(#${nodeId}-stroke-outside)` }),
    strokeWidth: node.stroke.width * 2,
  };
}

export function canvasShapeLabelTextNodeV1(
  node: EditorShapeNodeV1,
): EditorTextNodeV1 | undefined {
  const label = node.label;
  if (!label) {
    return undefined;
  }
  return {
    id: node.id,
    name: `${node.name} 文字`,
    kind: "text",
    transform: {
      ...node.transform,
      x: node.transform.x + label.padding.left,
      y: node.transform.y + label.padding.top,
      width: Math.max(
        1,
        node.transform.width - label.padding.left - label.padding.right,
      ),
      height: Math.max(
        1,
        node.transform.height - label.padding.top - label.padding.bottom,
      ),
    },
    opacity: node.opacity,
    blendMode: node.blendMode,
    visible: node.visible,
    locked: node.locked,
    content: label.content,
    effects: [],
  };
}

export function CanvasShapeNodeV1({
  editingLabel = false,
  node,
}: {
  readonly editingLabel?: boolean;
  readonly node: EditorShapeNodeV1;
}) {
  const definition = canvasShapeDefinitionV1(node.definition);
  const path = materializeCanvasShapePathV1(definition, node.parameters);
  const nodeId = safeSvgIdV1(node.id);
  const fill = svgPaintPresentationV1(node.fill, `${nodeId}-fill`);
  const stroke = svgPaintPresentationV1(node.stroke.paint, `${nodeId}-stroke`);
  const transform = node.transform;
  const nodeBlendMode = blendMode(node.blendMode);
  const flipTranslateX = transform.flipX ? transform.width : 0;
  const flipTranslateY = transform.flipY ? transform.height : 0;

  const labelNode = canvasShapeLabelTextNodeV1(node);
  const strokePresentation = shapeStrokePresentationV1(node, nodeId);

  return (
    <>
      <g
        aria-label={node.name}
        data-node-id={node.id}
        data-node-kind="shape"
        opacity={node.opacity}
        style={{
          display: node.visible ? undefined : "none",
          mixBlendMode: nodeBlendMode,
        }}
        transform={`translate(${String(transform.x)} ${String(transform.y)})`}
      >
        <g
          transform={`rotate(${String(transform.rotation)} ${String(
            transform.width / 2,
          )} ${String(transform.height / 2)})`}
        >
          <g
            transform={`translate(${String(
              flipTranslateX,
            )} ${String(flipTranslateY)}) scale(${
              transform.flipX ? "-1" : "1"
            } ${transform.flipY ? "-1" : "1"})`}
          >
            <svg
              height={transform.height}
              overflow="visible"
              preserveAspectRatio="none"
              viewBox={path.viewBox}
              width={transform.width}
              x={0}
              y={0}
            >
              {fill.gradient ||
              stroke.gradient ||
              node.stroke.alignment !== "center" ? (
                <defs>
                  {fill.gradient ? (
                    <SvgPaintGradientV1 gradient={fill.gradient} />
                  ) : null}
                  {stroke.gradient ? (
                    <SvgPaintGradientV1 gradient={stroke.gradient} />
                  ) : null}
                  {node.stroke.alignment === "inside" ? (
                    <clipPath id={`${nodeId}-stroke-inside`}>
                      <path d={path.d} fillRule={path.fillRule} />
                    </clipPath>
                  ) : null}
                  {node.stroke.alignment === "outside" ? (
                    <mask
                      height="300%"
                      id={`${nodeId}-stroke-outside`}
                      width="300%"
                      x="-100%"
                      y="-100%"
                    >
                      <rect
                        fill="#ffffff"
                        height="300%"
                        width="300%"
                        x="-100%"
                        y="-100%"
                      />
                      <path
                        d={path.d}
                        fill="#000000"
                        fillRule={path.fillRule}
                      />
                    </mask>
                  ) : null}
                </defs>
              ) : null}
              <path
                d={path.d}
                fill={fill.fill}
                fillRule={path.fillRule}
                stroke="none"
              />
              <path
                {...strokePresentation}
                d={path.d}
                data-stroke-alignment={node.stroke.alignment}
                fill="none"
                stroke={stroke.fill}
                strokeDasharray={node.stroke.dash?.join(" ")}
                vectorEffect="non-scaling-stroke"
              />
              {definition.geometry.kind === "sticky_note" ? (
                <path
                  d={canvasStickyNoteFoldPathV1()}
                  fill="#000000"
                  opacity={0.14}
                  pointerEvents="none"
                />
              ) : null}
            </svg>
          </g>
        </g>
      </g>
      {labelNode ? (
        <CanvasTextNodeV1
          clipToBounds
          editing={editingLabel}
          node={labelNode}
        />
      ) : null}
    </>
  );
}
