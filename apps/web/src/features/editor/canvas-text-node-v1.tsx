import type {
  EditorTextEffectV1,
  EditorTextNodeV1,
} from "@kanvas/contracts/editor";
import {
  useEffect,
  useMemo,
  useReducer,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  browserCanvasTextMeasureV1,
  canvasTextFontLoadRequestsV1,
  canvasTextParagraphLayoutV1,
  watchCanvasTextFontsV1,
  type CanvasTextParagraphLayoutV1,
} from "./canvas-text-layout-v1.js";
import {
  safeSvgIdV1,
  SvgPaintGradientV1,
  svgPaintPresentationV1,
} from "./canvas-svg-paint-v1.js";

export {
  browserCanvasTextMeasureV1,
  canvasTextEditorVerticalOffsetV1,
  canvasTextFontLoadRequestsV1,
  canvasTextFontShorthandV1,
  canvasTextMeasureFromContextV1,
  canvasTextParagraphLayoutV1,
  watchCanvasTextFontsV1,
} from "./canvas-text-layout-v1.js";
export type { CanvasTextMeasureV1 } from "./canvas-text-layout-v1.js";

type TextParagraph = EditorTextNodeV1["content"]["paragraphs"][number];
const MIN_CURVE_CONTROL_OFFSET = 48;
const CURVE_CONTROL_WIDTH_RATIO = 0.24;

function incrementRevision(revision: number): number {
  return revision + 1;
}

function useCanvasTextFontMetricsV1(node: EditorTextNodeV1): void {
  const requests = useMemo(() => canvasTextFontLoadRequestsV1(node), [node]);
  const [, refreshLayout] = useReducer(incrementRevision, 0);

  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    return watchCanvasTextFontsV1(document.fonts, requests, refreshLayout);
  }, [requests]);
}

function blendMode(
  value: EditorTextNodeV1["blendMode"],
): CSSProperties["mixBlendMode"] {
  return value.replaceAll("_", "-") as CSSProperties["mixBlendMode"];
}

function effect<T extends EditorTextEffectV1["kind"]>(
  effects: readonly EditorTextEffectV1[],
  kind: T,
): Extract<EditorTextEffectV1, { kind: T }> | undefined {
  return effects.find(
    (candidate): candidate is Extract<EditorTextEffectV1, { kind: T }> =>
      candidate.kind === kind,
  );
}

function paragraphAnchor(align: TextParagraph["align"], width: number) {
  if (align === "center") {
    return {
      x: width / 2,
      textAnchor: "middle" as const,
    };
  }
  if (align === "right") {
    return {
      x: width,
      textAnchor: "end" as const,
    };
  }
  return {
    x: 0,
    textAnchor: "start" as const,
  };
}

function textPathStartOffset(align: TextParagraph["align"]): string {
  if (align === "center") {
    return "50%";
  }
  return align === "right" ? "100%" : "0%";
}

function curvePath(width: number, baseline: number, amount: number): string {
  const controlY =
    baseline -
    amount *
      Math.max(MIN_CURVE_CONTROL_OFFSET, width * CURVE_CONTROL_WIDTH_RATIO);
  return `M0 ${String(baseline)} Q${String(
    width / 2,
  )} ${String(controlY)} ${String(width)} ${String(baseline)}`;
}

function TextRuns({
  fillOverride,
  nodeId,
  paragraph,
  paragraphIndex,
}: {
  readonly fillOverride?: string;
  readonly nodeId: string;
  readonly paragraph: TextParagraph;
  readonly paragraphIndex: number;
}) {
  return paragraph.runs.map((run, runIndex) => {
    const fill = svgPaintPresentationV1(
      run.fill,
      `${nodeId}-p${String(paragraphIndex)}-r${String(runIndex)}`,
    );
    return (
      <tspan
        direction={
          paragraph.direction === "auto" ? undefined : paragraph.direction
        }
        fill={fillOverride ?? fill.fill}
        fontFamily={run.font.family}
        fontSize={run.fontSize}
        fontStyle={run.fontStyle}
        fontWeight={run.fontWeight}
        key={`${run.font.fontId}-${String(runIndex)}`}
        letterSpacing={run.letterSpacing}
        textDecoration={[
          run.decoration.underline ? "underline" : "",
          run.decoration.strikeThrough ? "line-through" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {run.text}
      </tspan>
    );
  });
}

function TextParagraphs({
  curve,
  fillOverride,
  layouts,
  node,
  nodeId,
}: {
  readonly curve: Extract<EditorTextEffectV1, { kind: "curve" }> | undefined;
  readonly fillOverride?: string;
  readonly layouts: readonly CanvasTextParagraphLayoutV1[];
  readonly node: EditorTextNodeV1;
  readonly nodeId: string;
}) {
  return layouts.map((layout, index) => {
    const anchor = paragraphAnchor(
      layout.paragraph.align,
      node.transform.width,
    );
    const pathId = `${nodeId}-curve-${String(index)}`;
    const runs = (
      <TextRuns
        {...(fillOverride ? { fillOverride } : {})}
        nodeId={nodeId}
        paragraph={layout.paragraph}
        paragraphIndex={index}
      />
    );
    return (
      <text
        dominantBaseline="alphabetic"
        key={`paragraph-${String(index)}`}
        textAnchor={anchor.textAnchor}
        x={curve ? undefined : anchor.x}
        y={curve ? undefined : layout.baseline}
      >
        {curve ? (
          <textPath
            href={`#${pathId}`}
            startOffset={textPathStartOffset(layout.paragraph.align)}
          >
            {runs}
          </textPath>
        ) : (
          runs
        )}
      </text>
    );
  });
}

function TextFilter({
  glow,
  id,
  shadow,
}: {
  readonly glow: Extract<EditorTextEffectV1, { kind: "glow" }> | undefined;
  readonly id: string;
  readonly shadow: Extract<EditorTextEffectV1, { kind: "shadow" }> | undefined;
}) {
  if (!glow && !shadow) {
    return null;
  }
  return (
    <filter height="300%" id={id} width="300%" x="-100%" y="-100%">
      {glow ? (
        <feDropShadow
          dx={0}
          dy={0}
          floodColor={glow.color}
          floodOpacity={glow.opacity}
          stdDeviation={glow.blur / 2}
        />
      ) : null}
      {shadow ? (
        <feDropShadow
          dx={shadow.offsetX}
          dy={shadow.offsetY}
          floodColor={shadow.color}
          floodOpacity={shadow.opacity}
          stdDeviation={shadow.blur / 2}
        />
      ) : null}
    </filter>
  );
}

function Curves({
  curve,
  layouts,
  node,
  nodeId,
}: {
  readonly curve: Extract<EditorTextEffectV1, { kind: "curve" }> | undefined;
  readonly layouts: readonly CanvasTextParagraphLayoutV1[];
  readonly node: EditorTextNodeV1;
  readonly nodeId: string;
}) {
  if (!curve) {
    return null;
  }
  return layouts.map((layout, index) => (
    <path
      d={curvePath(node.transform.width, layout.baseline, curve.amount)}
      fill="none"
      id={`${nodeId}-curve-${String(index)}`}
      key={`curve-${String(index)}`}
    />
  ));
}

function RunGradients({
  layouts,
  nodeId,
}: {
  readonly layouts: readonly CanvasTextParagraphLayoutV1[];
  readonly nodeId: string;
}) {
  const gradients: ReactNode[] = [];
  layouts.forEach(({ paragraph }, paragraphIndex) => {
    paragraph.runs.forEach((run, runIndex) => {
      const presentation = svgPaintPresentationV1(
        run.fill,
        `${nodeId}-p${String(paragraphIndex)}-r${String(runIndex)}`,
      );
      if (presentation.gradient) {
        gradients.push(
          <SvgPaintGradientV1
            gradient={presentation.gradient}
            key={presentation.gradient.id}
          />,
        );
      }
    });
  });
  return gradients;
}

export function CanvasTextNodeV1({
  clipToBounds = false,
  editing = false,
  node,
}: {
  readonly clipToBounds?: boolean;
  readonly editing?: boolean;
  readonly node: EditorTextNodeV1;
}) {
  useCanvasTextFontMetricsV1(node);
  const nodeId = safeSvgIdV1(node.id);
  const layouts = canvasTextParagraphLayoutV1(node, browserCanvasTextMeasureV1);
  const outline = effect(node.effects, "outline");
  const hollow = effect(node.effects, "hollow");
  const shadow = effect(node.effects, "shadow");
  const glow = effect(node.effects, "glow");
  const background = effect(node.effects, "background");
  const curve = effect(node.effects, "curve");
  const offsetLayers = effect(node.effects, "offset_layers");
  const skew = effect(node.effects, "skew");
  const filterId = `${nodeId}-effects`;
  const boundsClipId = `${nodeId}-bounds-clip`;
  const backgroundPaint = background
    ? svgPaintPresentationV1(background.paint, `${nodeId}-background`)
    : undefined;
  const transform = node.transform;
  const flipTranslateX = transform.flipX ? transform.width : 0;
  const flipTranslateY = transform.flipY ? transform.height : 0;
  const stroke = hollow ?? outline;
  const skewTransform = skew
    ? `translate(${String(transform.width / 2)} ${String(
        transform.height / 2,
      )}) skewX(${String(skew.x)}) skewY(${String(
        skew.y,
      )}) translate(${String(-transform.width / 2)} ${String(
        -transform.height / 2,
      )})`
    : undefined;

  return (
    <g
      aria-label={node.name}
      data-node-id={node.id}
      data-node-kind="text"
      opacity={node.opacity}
      style={{
        display: node.visible ? undefined : "none",
        mixBlendMode: blendMode(node.blendMode),
      }}
      transform={`translate(${String(transform.x)} ${String(transform.y)})`}
    >
      {clipToBounds ? (
        <defs>
          <clipPath id={boundsClipId}>
            <rect height={transform.height} width={transform.width} />
          </clipPath>
        </defs>
      ) : null}
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
          <g
            clipPath={clipToBounds ? `url(#${boundsClipId})` : undefined}
            transform={skewTransform}
          >
            <rect
              className="canvas-v1-text-hit-target"
              fill="transparent"
              height={transform.height}
              pointerEvents="all"
              width={transform.width}
            />
            <g data-text-visuals="" opacity={editing ? 0 : undefined}>
              <defs>
                <RunGradients layouts={layouts} nodeId={nodeId} />
                {backgroundPaint?.gradient ? (
                  <SvgPaintGradientV1 gradient={backgroundPaint.gradient} />
                ) : null}
                <TextFilter glow={glow} id={filterId} shadow={shadow} />
                <Curves
                  curve={curve}
                  layouts={layouts}
                  node={node}
                  nodeId={nodeId}
                />
              </defs>
              {background && backgroundPaint ? (
                <rect
                  fill={backgroundPaint.fill}
                  height={transform.height + background.paddingY * 2}
                  rx={background.cornerRadius}
                  width={transform.width + background.paddingX * 2}
                  x={-background.paddingX}
                  y={-background.paddingY}
                />
              ) : null}
              {offsetLayers?.layers.map((layer, index) => (
                <g
                  key={`offset-${String(index)}`}
                  opacity={layer.opacity}
                  transform={`translate(${String(
                    layer.offsetX,
                  )} ${String(layer.offsetY)})`}
                >
                  <TextParagraphs
                    curve={curve}
                    fillOverride={layer.color}
                    layouts={layouts}
                    node={node}
                    nodeId={nodeId}
                  />
                </g>
              ))}
              <g
                fill={hollow ? "none" : undefined}
                filter={glow || shadow ? `url(#${filterId})` : undefined}
                paintOrder={stroke ? "stroke fill" : undefined}
                stroke={stroke?.color}
                strokeLinejoin="round"
                strokeWidth={stroke?.width}
              >
                <TextParagraphs
                  curve={curve}
                  layouts={layouts}
                  node={node}
                  nodeId={nodeId}
                />
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
