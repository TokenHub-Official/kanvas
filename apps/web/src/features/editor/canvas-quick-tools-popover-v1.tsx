import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";
import {
  BorderOutlined,
  ClearOutlined,
  EditOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  LineOutlined,
  SelectOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { canvasLineDefinitionV1 } from "./line-catalog-v1.js";
import {
  canvasBrushSettingsForStyleV1,
  canvasBrushStylesV1,
  canvasQuickLinePresetsV1,
  canvasQuickNoteColorsV1,
  canvasQuickShapePresetsV1,
  canvasQuickToolMenuStateV1,
  canvasQuickToolDefinitionsV1,
  updateCanvasBrushSettingsV1,
  type CanvasBrushSettingsV1,
  type CanvasQuickToolFlyoutV1,
  type CanvasQuickToolIdV1,
} from "./canvas-quick-tools-v1.js";
import { CanvasColorPickerV1 } from "./canvas-color-picker-v1.js";
import { CanvasInspectorRangeFieldV1 } from "./canvas-inspector-controls-v1.js";
import { canvasShapeDefinitionV1 } from "./shape-catalog-v1.js";
import { materializeCanvasShapePathV1 } from "./shape-geometry-v1.js";

const PREVIEW_COORDINATE_PADDING = 3;
const PREVIEW_COORDINATE_SCALE = 26;
const CURVE_POINT_COUNT = 3;
const MAX_BRUSH_PREVIEW_WIDTH = 12;

const toolIcons = {
  select: SelectOutlined,
  draw: EditOutlined,
  shape: BorderOutlined,
  line: LineOutlined,
  note: FileTextOutlined,
  text: FontSizeOutlined,
} as const;

const quickShapeLabelKeys: Readonly<Record<string, string>> = {
  "basic.rectangle": "rectangle",
  "basic.rounded-rectangle": "roundedRectangle",
  "basic.ellipse": "ellipse",
  "basic.triangle": "triangle",
  "basic.right-triangle": "rightTriangle",
  "basic.diamond": "diamond",
  "basic.polygon-5": "pentagon",
  "basic.polygon-6": "hexagon",
};

const quickLineLabelKeys: Readonly<Record<string, string>> = {
  "line.straight": "straight",
  "line.curve": "curve",
  "line.elbow": "elbow",
};

const quickNoteColorKeys = {
  "#ffd21f": "yellow",
  "#ffb85a": "orange",
  "#ff768d": "pink",
  "#7ab8ff": "blue",
  "#59d687": "green",
  "#b77cff": "purple",
} as const;

function ShapePreview({
  reference,
}: {
  readonly reference: EditorCatalogReferenceV1;
}) {
  const definition = canvasShapeDefinitionV1(reference);
  const path = materializeCanvasShapePathV1(definition);
  return (
    <svg aria-hidden="true" viewBox={path.viewBox}>
      <path d={path.d} fill="currentColor" fillRule={path.fillRule} />
    </svg>
  );
}

function linePath(reference: EditorCatalogReferenceV1): string {
  const definition = canvasLineDefinitionV1(reference);
  const points = definition.points.map((point) => ({
    x: PREVIEW_COORDINATE_PADDING + point.x * PREVIEW_COORDINATE_SCALE,
    y: PREVIEW_COORDINATE_PADDING + point.y * PREVIEW_COORDINATE_SCALE,
  }));
  if (definition.pathKind === "curve" && points.length >= CURVE_POINT_COUNT) {
    const [start, control, end] = points;
    return `M${String(start!.x)} ${String(
      start!.y,
    )} Q${String(control!.x)} ${String(
      control!.y,
    )} ${String(end!.x)} ${String(end!.y)}`;
  }
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${String(point.x)} ${String(point.y)}`,
    )
    .join(" ");
}

function LinePreview({
  reference,
}: {
  readonly reference: EditorCatalogReferenceV1;
}) {
  const definition = canvasLineDefinitionV1(reference);
  const start = definition.points[0];
  const end = definition.points.at(-1);
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path
        d={linePath(reference)}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
      />
      {(
        [
          ["start", start],
          ["end", end],
        ] as const
      ).map(([position, point]) =>
        point ? (
          <circle
            cx={PREVIEW_COORDINATE_PADDING + point.x * PREVIEW_COORDINATE_SCALE}
            cy={PREVIEW_COORDINATE_PADDING + point.y * PREVIEW_COORDINATE_SCALE}
            fill="white"
            key={position}
            r={2.15}
            stroke="currentColor"
            strokeWidth={1.6}
          />
        ) : null,
      )}
    </svg>
  );
}

function BrushPreview({
  color,
  opacity,
  width,
}: {
  readonly color: string;
  readonly opacity: number;
  readonly width: number;
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40">
      <path
        d="M5 25 C12 13 18 29 25 19 S32 14 36 20"
        fill="none"
        opacity={opacity}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={Math.min(MAX_BRUSH_PREVIEW_WIDTH, width)}
      />
    </svg>
  );
}

export function CanvasQuickToolsV1({
  activeTool,
  brushSettings,
  documentColors,
  onActiveToolChange,
  onBrushSettingsChange,
  onInsertLine,
  onInsertNote,
  onInsertShape,
  onInsertText,
  workspaceId,
}: {
  readonly activeTool: CanvasQuickToolIdV1;
  readonly brushSettings: CanvasBrushSettingsV1;
  readonly documentColors: readonly string[];
  readonly onActiveToolChange: (tool: CanvasQuickToolIdV1) => void;
  readonly onBrushSettingsChange: (settings: CanvasBrushSettingsV1) => void;
  readonly onInsertLine: (reference: EditorCatalogReferenceV1) => void;
  readonly onInsertNote: (color: string) => void;
  readonly onInsertShape: (reference: EditorCatalogReferenceV1) => void;
  readonly onInsertText: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const [flyout, setFlyout] = useState<CanvasQuickToolFlyoutV1 | undefined>();
  let visibleFlyout: CanvasQuickToolFlyoutV1 | undefined;
  if (activeTool === "erase") {
    visibleFlyout = "draw";
  } else if (
    activeTool === "draw" ||
    activeTool === "line" ||
    activeTool === "note" ||
    activeTool === "shape"
  ) {
    visibleFlyout = flyout;
  }

  const finishInsertion = () => {
    setFlyout(undefined);
    onActiveToolChange("select");
  };
  const selectQuickTool = (toolId: CanvasQuickToolIdV1) => {
    if (toolId === "text") {
      onInsertText();
      finishInsertion();
      return;
    }
    const next = canvasQuickToolMenuStateV1(visibleFlyout, toolId);
    onActiveToolChange(next.activeTool);
    setFlyout(next.flyout);
  };
  const selectBrushStyle = (style: CanvasBrushSettingsV1["presetId"]) => {
    onBrushSettingsChange(canvasBrushSettingsForStyleV1(style));
    onActiveToolChange("draw");
  };
  const insertShape = (preset: (typeof canvasQuickShapePresetsV1)[number]) => {
    onInsertShape(preset.reference);
    finishInsertion();
  };
  const insertLine = (preset: (typeof canvasQuickLinePresetsV1)[number]) => {
    onInsertLine(preset.reference);
    finishInsertion();
  };
  const insertNote = (preset: (typeof canvasQuickNoteColorsV1)[number]) => {
    onInsertNote(preset.color);
    finishInsertion();
  };

  return (
    <div
      aria-label={t("canvas.quickTools.dialog")}
      className="grid gap-5"
      role="group"
    >
      <div
        aria-label={t("canvas.quickTools.toolbar")}
        className="grid grid-cols-3 gap-1"
        role="toolbar"
      >
        {canvasQuickToolDefinitionsV1.map((tool) => {
          const Icon = toolIcons[tool.id];
          const label = t(`canvas.quickTools.tools.${tool.id}`);
          const expanded = tool.hasFlyout && visibleFlyout === tool.id;
          const selected =
            activeTool === tool.id ||
            (tool.id === "draw" && activeTool === "erase");
          return (
            <Button
              aria-expanded={tool.hasFlyout ? expanded : undefined}
              aria-label={label}
              aria-pressed={selected}
              className="h-[60px] min-w-0 flex-col gap-1 rounded-lg border-0 px-2 py-1.5 text-xs"
              color={selected ? "primary" : "default"}
              key={tool.id}
              onClick={() => selectQuickTool(tool.id)}
              type="text"
              variant={selected ? "filled" : "text"}
            >
              <Icon aria-hidden="true" className="text-xl" />
              <span>{label}</span>
            </Button>
          );
        })}
      </div>
      {visibleFlyout === "draw" ? (
        <div className="grid gap-5">
          <div
            aria-label={t("canvas.quickTools.drawMode")}
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
          >
            <Button
              aria-checked={activeTool === "draw"}
              icon={<EditOutlined aria-hidden="true" />}
              onClick={() => onActiveToolChange("draw")}
              role="radio"
              type={activeTool === "draw" ? "primary" : "default"}
            >
              {t("canvas.quickTools.modes.draw")}
            </Button>
            <Button
              aria-checked={activeTool === "erase"}
              icon={<ClearOutlined aria-hidden="true" />}
              onClick={() => onActiveToolChange("erase")}
              role="radio"
              type={activeTool === "erase" ? "primary" : "default"}
            >
              {t("canvas.quickTools.modes.erase")}
            </Button>
          </div>
          {activeTool === "erase" ? (
            <p className="m-0 rounded-xl bg-[#f7f7f8] px-3 py-3 text-xs leading-5 text-[var(--muted)]">
              {t("canvas.quickTools.eraserHelp")}
            </p>
          ) : (
            <>
              <div
                aria-label={t("canvas.quickTools.brushGroup")}
                className="grid grid-cols-4 gap-2"
                role="radiogroup"
              >
                {canvasBrushStylesV1.map((preset) => (
                  <Tooltip
                    key={preset.id}
                    title={t(`canvas.quickTools.brushes.${preset.id}`)}
                  >
                    <Button
                      aria-checked={brushSettings.presetId === preset.id}
                      aria-label={t(`canvas.quickTools.brushes.${preset.id}`)}
                      className="h-12 rounded-lg border-0 p-1.5 [&_svg]:h-8 [&_svg]:w-8"
                      color={
                        brushSettings.presetId === preset.id
                          ? "primary"
                          : "default"
                      }
                      onClick={() => selectBrushStyle(preset.id)}
                      role="radio"
                      type="text"
                      variant={
                        brushSettings.presetId === preset.id ? "filled" : "text"
                      }
                    >
                      <BrushPreview
                        color={preset.color}
                        opacity={preset.opacity}
                        width={preset.width}
                      />
                    </Button>
                  </Tooltip>
                ))}
              </div>
              <div className="grid gap-4 rounded-xl bg-[#f7f7f8] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold">
                    {t("canvas.quickTools.color")}
                  </span>
                  <CanvasColorPickerV1
                    ariaLabel={t("canvas.quickTools.color")}
                    color={brushSettings.color}
                    documentColors={documentColors}
                    onChange={(color) => {
                      onBrushSettingsChange(
                        updateCanvasBrushSettingsV1(brushSettings, { color }),
                      );
                    }}
                    onCommit={(color) => {
                      onBrushSettingsChange(
                        updateCanvasBrushSettingsV1(brushSettings, { color }),
                      );
                    }}
                    side="left"
                    workspaceId={workspaceId}
                  />
                </div>
                <CanvasInspectorRangeFieldV1
                  formatValue={(value) => `${String(Math.round(value))} px`}
                  label={t("canvas.quickTools.width")}
                  maximum={48}
                  minimum={1}
                  onChange={(width) => {
                    onBrushSettingsChange(
                      updateCanvasBrushSettingsV1(brushSettings, { width }),
                    );
                  }}
                  step={1}
                  value={brushSettings.width}
                />
                <CanvasInspectorRangeFieldV1
                  formatValue={(value) => `${String(Math.round(value * 100))}%`}
                  label={t("canvas.quickTools.opacity")}
                  maximum={1}
                  minimum={0.05}
                  onChange={(opacity) => {
                    onBrushSettingsChange(
                      updateCanvasBrushSettingsV1(brushSettings, { opacity }),
                    );
                  }}
                  step={0.01}
                  value={brushSettings.opacity}
                />
              </div>
            </>
          )}
        </div>
      ) : null}
      {visibleFlyout === "shape" ? (
        <div
          aria-label={t("canvas.quickTools.shapeGroup")}
          className="grid grid-cols-4 gap-2"
          role="group"
        >
          {canvasQuickShapePresetsV1.map((preset) => (
            <Tooltip
              key={preset.reference.definitionId}
              title={t(
                `canvas.quickTools.shapes.${quickShapeLabelKeys[preset.reference.definitionId]}`,
              )}
            >
              <Button
                aria-label={t(
                  `canvas.quickTools.shapes.${quickShapeLabelKeys[preset.reference.definitionId]}`,
                )}
                className="h-12 rounded-lg p-1.5 [&_svg]:h-7 [&_svg]:w-7"
                onClick={() => insertShape(preset)}
                type="text"
              >
                <ShapePreview reference={preset.reference} />
              </Button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {visibleFlyout === "line" ? (
        <div
          aria-label={t("canvas.quickTools.lineGroup")}
          className="grid grid-cols-4 gap-2"
          role="group"
        >
          {canvasQuickLinePresetsV1.map((preset) => (
            <Tooltip
              key={preset.reference.definitionId}
              title={t(
                `canvas.quickTools.lines.${quickLineLabelKeys[preset.reference.definitionId]}`,
              )}
            >
              <Button
                aria-label={t(
                  `canvas.quickTools.lines.${quickLineLabelKeys[preset.reference.definitionId]}`,
                )}
                className="h-12 rounded-lg p-1.5 [&_svg]:h-7 [&_svg]:w-7"
                onClick={() => insertLine(preset)}
                type="text"
              >
                <LinePreview reference={preset.reference} />
              </Button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {visibleFlyout === "note" ? (
        <div
          aria-label={t("canvas.quickTools.noteGroup")}
          className="grid grid-cols-4 gap-2"
          role="group"
        >
          {canvasQuickNoteColorsV1.map((preset) => (
            <Tooltip
              key={preset.color}
              title={t(
                `canvas.quickTools.noteColors.${quickNoteColorKeys[preset.color]}`,
              )}
            >
              <Button
                aria-label={t("canvas.quickTools.addNote", {
                  color: t(
                    `canvas.quickTools.noteColors.${quickNoteColorKeys[preset.color]}`,
                  ),
                })}
                className="h-12 rounded-lg p-1.5"
                onClick={() => insertNote(preset)}
                style={{ color: preset.color }}
                type="text"
              >
                <span className="h-7 w-7 rounded-lg bg-current shadow-[inset_0_0_0_1px_rgb(21_21_21_/_0.08)]" />
              </Button>
            </Tooltip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
