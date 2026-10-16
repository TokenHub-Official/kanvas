import type { EditorPaintV1 } from "@kanvas/contracts/editor";
import { DeleteOutlined } from "@ant-design/icons";
import { Button, InputNumber, Segmented, Select } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { CanvasColorPickerV1 } from "./canvas-color-picker-v1.js";
import { CanvasInspectorRangeFieldV1 } from "./canvas-inspector-controls-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import { canvasShapeDefinitionV1 } from "./shape-catalog-v1.js";
import { shapeWithoutLabelV1 } from "./canvas-workspace-model-v1.js";
import { canvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import {
  canvasLineStrokePatternV1,
  canvasLineWithPathKindV1,
  canvasLineWithStrokePatternV1,
  canvasLineWorldPointsV1,
  updateCanvasLineWorldPointV1,
  type CanvasLinePathKindV1,
  type CanvasLineStrokePatternV1,
} from "./canvas-line-editing-v1.js";

const DASH_LENGTH = 8;
const DASH_GAP = 6;
const DOT_GAP = 5;
const DASHED_STROKE = [DASH_LENGTH, DASH_GAP];
const DOTTED_STROKE = [2, DOT_GAP];
const DEFAULT_GRADIENT_ANGLE = 0;
const MAXIMUM_GRADIENT_ANGLE = 360;
const DEFAULT_GRADIENT_SECOND_COLOR = "#bdf248";

function paintColor(paint: EditorPaintV1): string {
  if (paint.kind === "solid") return paint.color;
  return paint.kind === "linear_gradient"
    ? (paint.stops[0]?.color ?? "#3048f5")
    : "#3048f5";
}

function strokeDash(style: string): number[] | undefined {
  if (style === "dash") {
    return DASHED_STROKE;
  }
  return style === "dot" ? DOTTED_STROKE : undefined;
}

function strokeStyle(dash: readonly number[] | undefined): string {
  if (!dash || dash.length === 0) {
    return "solid";
  }
  return dash[0] === 2 ? "dot" : "dash";
}

type CanvasFillStrokeNodeV1 = Extract<
  EditorRuntimeNodeV1,
  { kind: "frame" | "shape" }
>;
type CanvasShapeNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "shape" }>;

function shapeLabelTextV1(node: CanvasShapeNodeV1): string {
  return (
    node.label?.content.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n") ?? ""
  );
}

function InspectorSectionV1({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="grid gap-3 border-b border-[var(--line)] pb-5 last:border-b-0 last:pb-0">
      <h3 className="m-0 text-[11px] font-semibold tracking-[0.04em] text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function nodeWithStrokeStyleV1(
  node: CanvasFillStrokeNodeV1,
  style: string,
): CanvasFillStrokeNodeV1 {
  const dash = strokeDash(style);
  const { dash: currentDash, ...strokeWithoutDash } = node.stroke;
  void currentDash;
  return {
    ...node,
    stroke: dash
      ? {
          ...node.stroke,
          dash,
        }
      : strokeWithoutDash,
  };
}

function lineWithoutEndpointBindingV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "line" }>,
  endpoint: "end" | "start",
) {
  if (endpoint === "start") {
    const { startBinding, ...next } = node;
    void startBinding;
    return next;
  }
  const { endBinding, ...next } = node;
  void endBinding;
  return next;
}

function CanvasFillInspectorV1({
  disabled,
  documentColors,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
  workspaceId,
}: {
  readonly disabled: boolean;
  readonly documentColors: readonly string[];
  readonly node: CanvasFillStrokeNodeV1;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  let fillMode: "gradient" | "hollow" | "solid" = "solid";
  if (node.fill.kind === "none") {
    fillMode = "hollow";
  } else if (node.fill.kind === "linear_gradient") {
    fillMode = "gradient";
  }
  const gradientFill =
    node.fill.kind === "linear_gradient" ? node.fill : undefined;
  const changeFillMode = (mode: string | number) => {
    if (mode === "hollow") {
      onChange({
        ...node,
        fill: { kind: "none" },
        stroke: {
          ...node.stroke,
          paint:
            node.stroke.paint.kind === "none"
              ? { kind: "solid", color: "#151515" }
              : node.stroke.paint,
          width: node.stroke.width > 0 ? node.stroke.width : 2,
        },
      });
      return;
    }
    if (mode === "gradient") {
      onChange({
        ...node,
        fill:
          node.fill.kind === "linear_gradient"
            ? node.fill
            : {
                kind: "linear_gradient",
                angle: DEFAULT_GRADIENT_ANGLE,
                stops: [
                  { color: paintColor(node.fill), offset: 0 },
                  { color: DEFAULT_GRADIENT_SECOND_COLOR, offset: 1 },
                ],
              },
      });
      return;
    }
    onChange({
      ...node,
      fill:
        node.fill.kind === "solid"
          ? node.fill
          : { kind: "solid", color: paintColor(node.fill) },
    });
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <span className="text-xs font-bold">{t("canvas.node.fillMode")}</span>
        <Segmented
          aria-label={t("canvas.node.fillMode")}
          block
          disabled={disabled}
          onChange={changeFillMode}
          options={(["solid", "gradient", "hollow"] as const).map((value) => ({
            value,
            label: t(`canvas.node.fillModes.${value}`),
          }))}
          size="small"
          value={fillMode}
        />
      </div>
      {node.fill.kind === "solid" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold">
            {t("canvas.node.fillColor")}
          </span>
          {disabled ? (
            <span
              aria-label={t("canvas.node.fillColor")}
              className="h-7 w-7 rounded-full border border-[var(--line)]"
              style={{ backgroundColor: paintColor(node.fill) }}
            />
          ) : (
            <CanvasColorPickerV1
              ariaLabel={t("canvas.node.fillColor")}
              color={paintColor(node.fill)}
              documentColors={documentColors}
              onChange={(color) => {
                onPreview({
                  ...node,
                  fill: { kind: "solid", color },
                });
              }}
              onCommit={onPreviewCommit}
              side="left"
              workspaceId={workspaceId}
            />
          )}
        </div>
      ) : null}
      {gradientFill ? (
        <div className="grid gap-4">
          {([0, gradientFill.stops.length - 1] as const).map(
            (stopIndex, colorIndex) => {
              const stop = gradientFill.stops[stopIndex];
              const label = t(
                colorIndex === 0
                  ? "canvas.node.gradientStartColor"
                  : "canvas.node.gradientEndColor",
              );
              return (
                <div
                  className="flex items-center justify-between gap-3"
                  key={label}
                >
                  <span className="text-xs font-bold">{label}</span>
                  {disabled ? (
                    <span
                      aria-label={label}
                      className="h-7 w-7 rounded-full border border-[var(--line)]"
                      style={{ backgroundColor: stop?.color ?? "#3048f5" }}
                    />
                  ) : (
                    <CanvasColorPickerV1
                      ariaLabel={label}
                      color={stop?.color ?? "#3048f5"}
                      documentColors={documentColors}
                      onChange={(color) => {
                        onPreview({
                          ...node,
                          fill: {
                            ...gradientFill,
                            stops: gradientFill.stops.map((candidate, index) =>
                              index === stopIndex
                                ? { ...candidate, color }
                                : candidate,
                            ),
                          },
                        });
                      }}
                      onCommit={onPreviewCommit}
                      side="left"
                      workspaceId={workspaceId}
                    />
                  )}
                </div>
              );
            },
          )}
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            formatValue={(value) => `${String(Math.round(value))}°`}
            label={t("canvas.node.gradientAngle")}
            maximum={MAXIMUM_GRADIENT_ANGLE}
            minimum={0}
            onChange={(angle) => {
              onPreview({
                ...node,
                fill: { ...gradientFill, angle },
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={gradientFill.angle}
          />
        </div>
      ) : null}
    </div>
  );
}

function CanvasStrokeInspectorV1({
  disabled,
  documentColors,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
  workspaceId,
}: {
  readonly disabled: boolean;
  readonly documentColors: readonly string[];
  readonly node: CanvasFillStrokeNodeV1;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold">
          {t("canvas.node.strokeColor")}
        </span>
        {disabled ? (
          <span
            aria-label={t("canvas.node.shapeStrokeColor")}
            className="h-7 w-7 rounded-full border border-[var(--line)]"
            style={{ backgroundColor: paintColor(node.stroke.paint) }}
          />
        ) : (
          <CanvasColorPickerV1
            ariaLabel={t("canvas.node.shapeStrokeColor")}
            color={paintColor(node.stroke.paint)}
            documentColors={documentColors}
            onChange={(color) => {
              onPreview({
                ...node,
                stroke: {
                  ...node.stroke,
                  paint: { kind: "solid", color },
                  width: node.stroke.width > 0 ? node.stroke.width : 2,
                },
              });
            }}
            onCommit={onPreviewCommit}
            side="left"
            workspaceId={workspaceId}
          />
        )}
      </div>
      <CanvasInspectorRangeFieldV1
        disabled={disabled}
        label={t("canvas.node.strokeWidth")}
        maximum={48}
        minimum={0}
        onChange={(width) => {
          onPreview({
            ...node,
            stroke: {
              ...node.stroke,
              paint:
                width > 0 && node.stroke.paint.kind === "none"
                  ? { kind: "solid", color: "#151515" }
                  : node.stroke.paint,
              width,
            },
          });
        }}
        onCommit={onPreviewCommit}
        step={1}
        value={node.stroke.width}
      />
      <div className="grid gap-2">
        <span className="text-xs font-bold">
          {t("canvas.node.strokeStyle")}
        </span>
        <Segmented
          aria-label={t("canvas.node.shapeStrokeStyle")}
          block
          disabled={disabled}
          onChange={(style) => {
            onChange(nodeWithStrokeStyleV1(node, String(style)));
          }}
          options={(["solid", "dash", "dot"] as const).map((value) => ({
            label: t(`canvas.node.strokeStyles.${value}`),
            value,
          }))}
          size="small"
          value={strokeStyle(node.stroke.dash)}
        />
      </div>
      {node.kind === "shape" ? (
        <div className="grid gap-2">
          <span className="text-xs font-bold">
            {t("canvas.node.strokeAlignment")}
          </span>
          <Segmented
            aria-label={t("canvas.node.strokeAlignment")}
            block
            disabled={disabled}
            onChange={(alignment) => {
              onChange({
                ...node,
                stroke: {
                  ...node.stroke,
                  alignment: String(
                    alignment,
                  ) as CanvasShapeNodeV1["stroke"]["alignment"],
                },
              });
            }}
            options={(["inside", "center", "outside"] as const).map(
              (value) => ({
                label: t(`canvas.node.strokeAlignments.${value}`),
                value,
              }),
            )}
            size="small"
            value={node.stroke.alignment}
          />
        </div>
      ) : null}
    </div>
  );
}

function CanvasShapeStyleInspectorV1({
  disabled,
  documentColors,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
  workspaceId,
}: {
  readonly disabled: boolean;
  readonly documentColors: readonly string[];
  readonly node: CanvasShapeNodeV1;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const parameters = canvasShapeDefinitionV1(node.definition).parameters;
  const labelText = shapeLabelTextV1(node);
  return (
    <>
      <InspectorSectionV1 title={t("canvas.node.fillSection")}>
        <CanvasFillInspectorV1
          disabled={disabled}
          documentColors={documentColors}
          node={node}
          onChange={onChange}
          onPreview={onPreview}
          onPreviewCommit={onPreviewCommit}
          workspaceId={workspaceId}
        />
      </InspectorSectionV1>
      <InspectorSectionV1 title={t("canvas.node.strokeSection")}>
        <CanvasStrokeInspectorV1
          disabled={disabled}
          documentColors={documentColors}
          node={node}
          onChange={onChange}
          onPreview={onPreview}
          onPreviewCommit={onPreviewCommit}
          workspaceId={workspaceId}
        />
      </InspectorSectionV1>
      {parameters.length > 0 ? (
        <InspectorSectionV1 title={t("canvas.node.geometrySection")}>
          <div className="grid gap-4">
            {parameters.map((parameter) => (
              <CanvasInspectorRangeFieldV1
                disabled={disabled}
                key={parameter.id}
                label={t(`canvas.node.shapeParameters.${parameter.id}`)}
                maximum={parameter.maximum}
                minimum={parameter.minimum}
                onChange={(value) => {
                  onPreview({
                    ...node,
                    parameters: {
                      ...node.parameters,
                      [parameter.id]: value,
                    },
                  });
                }}
                onCommit={onPreviewCommit}
                step={(parameter.maximum - parameter.minimum) / 100}
                value={Number(
                  node.parameters[parameter.id] ?? parameter.defaultValue,
                )}
              />
            ))}
          </div>
        </InspectorSectionV1>
      ) : null}
      {node.label ? (
        <InspectorSectionV1 title={t("canvas.node.contentSection")}>
          <div className="grid gap-2 rounded-xl bg-[var(--mist)] p-3">
            <span className="truncate text-sm font-medium text-[var(--ink)]">
              {labelText}
            </span>
            <Button
              className="justify-self-start px-0"
              danger
              disabled={disabled}
              icon={<DeleteOutlined aria-hidden="true" />}
              onClick={() => {
                onChange(shapeWithoutLabelV1(node));
              }}
              size="small"
              type="text"
            >
              {t("canvas.editor.removeInternalText")}
            </Button>
          </div>
        </InspectorSectionV1>
      ) : null}
    </>
  );
}

export function NodeStyleInspectorV1({
  disabled,
  documentColors,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
  workspaceId,
}: {
  readonly disabled: boolean;
  readonly documentColors: readonly string[];
  readonly node: Extract<
    EditorRuntimeNodeV1,
    { kind: "frame" | "graphic" | "grid" | "line" | "shape" }
  >;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const lineCapOptions = (
    [
      "none",
      "arrow",
      "triangle",
      "circle",
      "hollow_circle",
      "square",
      "hollow_square",
      "diamond",
      "hollow_diamond",
      "bar",
    ] as const
  ).map((value) => ({
    value,
    label: t(`canvas.node.lineCaps.${value}`),
  }));
  const linePathOptions = (["straight", "elbow", "curve"] as const).map(
    (value) => ({
      value,
      label: t(`canvas.node.linePaths.${value}`),
    }),
  );
  const linePatternOptions = (["solid", "dashed", "dotted"] as const).map(
    (value) => ({
      value,
      label: t(`canvas.node.strokePatterns.${value}`),
    }),
  );
  const graphicDefinition =
    node.kind === "graphic" && node.source.kind === "catalog"
      ? canvasGraphicDefinitionV1(
          node.source.catalogId,
          node.source.resourceId,
          node.source.revision,
        )
      : undefined;

  return (
    <div className="grid gap-5">
      {node.kind === "graphic" && graphicDefinition ? (
        <>
          <p className="m-0 rounded-xl bg-[#f7f7f8] p-3 text-xs leading-5 text-[var(--muted)]">
            {t("canvas.graphic.recolorableDescription")}
          </p>
          {(["primary", "secondary"] as const)
            .filter((slot) =>
              graphicDefinition.paths.some((path) => path.colorSlot === slot),
            )
            .map((slot) => (
              <div
                className="flex items-center justify-between gap-3"
                key={slot}
              >
                <span className="text-xs font-bold">
                  {t(`canvas.graphic.slots.${slot}`)}
                </span>
                <CanvasColorPickerV1
                  ariaLabel={t(`canvas.graphic.slots.${slot}`)}
                  color={
                    node.colorSlots[slot] ??
                    graphicDefinition.defaultColors[slot]
                  }
                  documentColors={documentColors}
                  onChange={(color) =>
                    onPreview({
                      ...node,
                      colorSlots: { ...node.colorSlots, [slot]: color },
                    })
                  }
                  onCommit={onPreviewCommit}
                  side="left"
                  workspaceId={workspaceId}
                />
              </div>
            ))}
          <Button
            disabled={disabled}
            onClick={() => onChange({ ...node, colorSlots: {} })}
          >
            {t("canvas.graphic.resetColors")}
          </Button>
        </>
      ) : null}
      {node.kind === "graphic" && !graphicDefinition ? (
        <p className="m-0 rounded-xl bg-[#fff3bf] p-3 text-xs leading-5 text-[#7a5a00]">
          {t("canvas.graphic.fixedDescription")}
        </p>
      ) : null}
      {node.kind === "shape" ? (
        <CanvasShapeStyleInspectorV1
          disabled={disabled}
          documentColors={documentColors}
          node={node}
          onChange={onChange}
          onPreview={onPreview}
          onPreviewCommit={onPreviewCommit}
          workspaceId={workspaceId}
        />
      ) : null}
      {node.kind === "line" ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold">
              {t("canvas.node.strokeColor")}
            </span>
            {disabled ? (
              <span
                aria-label={t("canvas.node.lineStrokeColor")}
                className="h-7 w-7 rounded-full border border-[var(--line)]"
                style={{
                  backgroundColor: paintColor(node.stroke.paint),
                }}
              />
            ) : (
              <CanvasColorPickerV1
                ariaLabel={t("canvas.node.lineStrokeColor")}
                color={paintColor(node.stroke.paint)}
                documentColors={documentColors}
                onChange={(color) => {
                  onPreview({
                    ...node,
                    stroke: {
                      ...node.stroke,
                      paint: {
                        kind: "solid",
                        color,
                      },
                    },
                  });
                }}
                onCommit={onPreviewCommit}
                side="left"
                workspaceId={workspaceId}
              />
            )}
          </div>
          {node.role === "design" ? (
            <div className="grid gap-2">
              <span className="text-xs font-bold">
                {t("canvas.node.linePath")}
              </span>
              <Segmented<CanvasLinePathKindV1>
                aria-label={t("canvas.node.linePath")}
                block
                disabled={disabled}
                onChange={(pathKind) => {
                  onChange(canvasLineWithPathKindV1(node, pathKind));
                }}
                options={linePathOptions}
                size="small"
                value={node.pathKind === "polyline" ? "elbow" : node.pathKind}
              />
            </div>
          ) : null}
          <div className="grid gap-2">
            <span className="text-xs font-bold">
              {t("canvas.node.strokePattern")}
            </span>
            <Segmented<CanvasLineStrokePatternV1>
              aria-label={t("canvas.node.strokePattern")}
              block
              disabled={disabled}
              onChange={(pattern) => {
                onChange(canvasLineWithStrokePatternV1(node, pattern));
              }}
              options={linePatternOptions}
              size="small"
              value={canvasLineStrokePatternV1(node)}
            />
          </div>
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            label={t("canvas.node.thickness")}
            maximum={48}
            minimum={1}
            onChange={(width) => {
              onPreview({
                ...node,
                stroke: {
                  ...node.stroke,
                  width,
                },
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={node.stroke.width}
          />
          {node.role === "freehand" ? (
            <CanvasInspectorRangeFieldV1
              disabled={disabled}
              formatValue={(value) => `${String(Math.round(value * 100))}%`}
              label={t("canvas.common.opacity")}
              maximum={1}
              minimum={0.05}
              onChange={(opacity) => {
                onPreview({
                  ...node,
                  opacity,
                });
              }}
              onCommit={onPreviewCommit}
              step={0.01}
              value={node.opacity}
            />
          ) : null}
          <div className="grid gap-2">
            <span className="text-xs font-bold">
              {t("canvas.node.capStyle")}
            </span>
            <Segmented
              aria-label={t("canvas.node.capStyle")}
              block
              disabled={disabled}
              onChange={(capStyle) => {
                onChange({
                  ...node,
                  capStyle,
                });
              }}
              options={(["butt", "round", "square"] as const).map((value) => ({
                value,
                label: t(`canvas.node.capStyles.${value}`),
              }))}
              size="small"
              value={node.capStyle ?? "round"}
            />
          </div>
          {node.pathKind === "straight" ? null : (
            <div className="grid gap-2">
              <span className="text-xs font-bold">
                {t("canvas.node.joinStyle")}
              </span>
              <Segmented
                aria-label={t("canvas.node.joinStyle")}
                block
                disabled={disabled}
                onChange={(joinStyle) => {
                  onChange({
                    ...node,
                    joinStyle,
                  });
                }}
                options={(["round", "bevel", "miter"] as const).map(
                  (value) => ({
                    value,
                    label: t(`canvas.node.joinStyles.${value}`),
                  }),
                )}
                size="small"
                value={node.joinStyle ?? "round"}
              />
            </div>
          )}
          {node.role === "design" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-2">
                  <span className="text-xs font-bold">
                    {t("canvas.node.start")}
                  </span>
                  <Select
                    aria-label={t("canvas.node.lineStart")}
                    disabled={disabled}
                    onChange={(value) => {
                      onChange({
                        ...node,
                        startCap: value,
                      });
                    }}
                    options={lineCapOptions}
                    size="small"
                    variant="filled"
                    value={node.startCap}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-xs font-bold">
                    {t("canvas.node.end")}
                  </span>
                  <Select
                    aria-label={t("canvas.node.lineEnd")}
                    disabled={disabled}
                    onChange={(value) => {
                      onChange({
                        ...node,
                        endCap: value,
                      });
                    }}
                    options={lineCapOptions}
                    size="small"
                    variant="filled"
                    value={node.endCap}
                  />
                </label>
              </div>
              <section className="grid gap-3">
                <h3 className="m-0 text-sm font-bold">
                  {t("canvas.node.connections")}
                </h3>
                {(["start", "end"] as const).map((endpoint) => {
                  const binding =
                    endpoint === "start" ? node.startBinding : node.endBinding;
                  return (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg bg-[var(--mist)] px-3 py-2"
                      key={endpoint}
                    >
                      <span className="min-w-0 truncate text-xs">
                        {t(`canvas.node.connectionEndpoints.${endpoint}`)}：
                        {binding
                          ? `${binding.nodeId} · ${t(
                              `canvas.node.connectionAnchors.${binding.anchor}`,
                            )}`
                          : t("canvas.node.notConnected")}
                      </span>
                      {binding ? (
                        <Button
                          disabled={disabled}
                          onClick={() => {
                            onChange(
                              lineWithoutEndpointBindingV1(node, endpoint),
                            );
                          }}
                          size="small"
                          type="text"
                        >
                          {t("canvas.node.disconnect")}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </section>
              <section className="grid gap-3">
                <h3 className="m-0 text-sm font-bold">
                  {t("canvas.node.linePoints")}
                </h3>
                {canvasLineWorldPointsV1(node).map((point, pointIndex) => (
                  <div
                    className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"
                    key={`${node.id}-point-${String(pointIndex)}`}
                  >
                    <span className="pb-1 text-xs font-bold text-[var(--muted)]">
                      {t("canvas.node.pointNumber", {
                        number: pointIndex + 1,
                      })}
                    </span>
                    <label className="grid gap-1 text-xs font-bold">
                      X
                      <InputNumber
                        aria-label={t("canvas.node.pointX", {
                          number: pointIndex + 1,
                        })}
                        disabled={disabled}
                        onChange={(x) => {
                          if (x !== null) {
                            onChange(
                              updateCanvasLineWorldPointV1(node, pointIndex, {
                                x,
                                y: point.y,
                              }),
                            );
                          }
                        }}
                        precision={1}
                        size="small"
                        value={Number(point.x.toFixed(1))}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-bold">
                      Y
                      <InputNumber
                        aria-label={t("canvas.node.pointY", {
                          number: pointIndex + 1,
                        })}
                        disabled={disabled}
                        onChange={(y) => {
                          if (y !== null) {
                            onChange(
                              updateCanvasLineWorldPointV1(node, pointIndex, {
                                x: point.x,
                                y,
                              }),
                            );
                          }
                        }}
                        precision={1}
                        size="small"
                        value={Number(point.y.toFixed(1))}
                      />
                    </label>
                  </div>
                ))}
              </section>
            </>
          ) : null}
        </>
      ) : null}
      {node.kind === "grid" ? (
        <>
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            label={t("canvas.node.gap")}
            maximum={96}
            minimum={0}
            onChange={(gap) => {
              onPreview({
                ...node,
                gap,
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={node.gap}
          />
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            label={t("canvas.node.cornerRadius")}
            maximum={96}
            minimum={0}
            onChange={(cornerRadius) => {
              onPreview({
                ...node,
                cornerRadius,
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={node.cornerRadius}
          />
        </>
      ) : null}
      {node.kind === "frame" ? (
        <>
          <InspectorSectionV1 title={t("canvas.node.fillSection")}>
            <CanvasFillInspectorV1
              disabled={disabled}
              documentColors={documentColors}
              node={node}
              onChange={onChange}
              onPreview={onPreview}
              onPreviewCommit={onPreviewCommit}
              workspaceId={workspaceId}
            />
          </InspectorSectionV1>
          <InspectorSectionV1 title={t("canvas.node.strokeSection")}>
            <CanvasStrokeInspectorV1
              disabled={disabled}
              documentColors={documentColors}
              node={node}
              onChange={onChange}
              onPreview={onPreview}
              onPreviewCommit={onPreviewCommit}
              workspaceId={workspaceId}
            />
          </InspectorSectionV1>
        </>
      ) : null}
    </div>
  );
}
