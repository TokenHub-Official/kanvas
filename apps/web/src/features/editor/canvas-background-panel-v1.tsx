import { FileImageOutlined } from "@ant-design/icons";
import { Button, Select, Tabs } from "antd";
import { useState } from "react";

import {
  CanvasAddColorTriggerV1,
  CanvasColorPickerV1,
} from "./canvas-color-picker-v1.js";
import {
  CanvasPanelIcon,
  CanvasPanelSection,
} from "./canvas-left-panel-shared-v1.js";
import { CanvasRangeControlV1 } from "./canvas-range-control-v1.js";

type CanvasBackgroundViewV1 = "color" | "gradient" | "image";
type CanvasBackgroundImageFitV1 = "contain" | "cover" | "fill";

const backgroundViews = [
  ["color", "颜色"],
  ["gradient", "渐变"],
  ["image", "图片"],
] as const satisfies readonly [CanvasBackgroundViewV1, string][];
const backgroundColors = [
  "#ffffff",
  "#f6f6f8",
  "#151515",
  "#3048f5",
  "#ff2f70",
  "#ff8a34",
  "#fff36a",
  "#5bd7b7",
  "#6c2cff",
  "#101c4d",
] as const;
const PRIMARY_GRADIENT_ANGLE = 135;
const SUNSET_GRADIENT_ANGLE = 120;
const CITRUS_GRADIENT_ANGLE = 145;
const NIGHT_GRADIENT_ANGLE = 125;
const defaultGradient = {
  first: "#3048f5",
  second: "#6c2cff",
  angle: PRIMARY_GRADIENT_ANGLE,
} as const;
const gradientPresets = [
  ["#3048f5", "#6c2cff", PRIMARY_GRADIENT_ANGLE],
  ["#ff2f70", "#ff8a34", SUNSET_GRADIENT_ANGLE],
  ["#0cc4ca", "#3048f5", PRIMARY_GRADIENT_ANGLE],
  ["#fff36a", "#ff7165", CITRUS_GRADIENT_ANGLE],
  ["#151515", "#3048f5", NIGHT_GRADIENT_ANGLE],
  ["#f5f5f5", "#ffffff", PRIMARY_GRADIENT_ANGLE],
] as const satisfies readonly [string, string, number][];
const imageFitOptions = [
  ["contain", "适应"],
  ["cover", "填满"],
  ["fill", "拉伸"],
] as const satisfies readonly [CanvasBackgroundImageFitV1, string][];
const fullCircleDegrees = 360;
const percentageScale = 100;
const opacityMaximum = 1;
const opacityMinimum = 0;
const opacityStep = 0.01;
const imageBackgroundIcon = FileImageOutlined;

export function CanvasBackgroundPanelV1({
  backgroundTransparent,
  backgroundColor,
  documentColors,
  gradientBackground,
  imageBackground,
  onBrowseImages,
  onColor,
  onColorPreview,
  onConvertImage,
  onGradient,
  onGradientPreview,
  onImageFocalPointPreview,
  onImageFit,
  onImageOpacityPreview,
  onPreviewCommit,
  onTransparent,
  onUseSelectedImage,
  selectedImageAvailable,
  workspaceId,
}: {
  readonly backgroundTransparent: boolean;
  readonly backgroundColor?: string;
  readonly documentColors: readonly string[];
  readonly gradientBackground?: {
    readonly angle: number;
    readonly first: string;
    readonly second: string;
  };
  readonly imageBackground?: {
    readonly fit: CanvasBackgroundImageFitV1;
    readonly focalPoint: {
      readonly x: number;
      readonly y: number;
    };
    readonly opacity: number;
  };
  readonly onBrowseImages: () => void;
  readonly onColor: (color: string) => void;
  readonly onColorPreview: (color: string) => void;
  readonly onConvertImage: () => void;
  readonly onGradient: (first: string, second: string, angle: number) => void;
  readonly onGradientPreview: (
    first: string,
    second: string,
    angle: number,
  ) => void;
  readonly onImageFocalPointPreview: (x: number, y: number) => void;
  readonly onImageFit: (fit: CanvasBackgroundImageFitV1) => void;
  readonly onImageOpacityPreview: (opacity: number) => void;
  readonly onPreviewCommit: () => void;
  readonly onTransparent: () => void;
  readonly onUseSelectedImage: () => void;
  readonly selectedImageAvailable: boolean;
  readonly workspaceId: string;
}) {
  let activeBackgroundView: CanvasBackgroundViewV1 = "color";
  if (imageBackground) {
    activeBackgroundView = "image";
  } else if (gradientBackground) {
    activeBackgroundView = "gradient";
  }
  const [viewSelection, setViewSelection] = useState<{
    readonly source: CanvasBackgroundViewV1;
    readonly view: CanvasBackgroundViewV1;
  }>();
  const view =
    viewSelection?.source === activeBackgroundView
      ? viewSelection.view
      : activeBackgroundView;
  const gradient = gradientBackground ?? defaultGradient;

  const selectView = (nextView: CanvasBackgroundViewV1) => {
    setViewSelection({
      source: activeBackgroundView,
      view: nextView,
    });
  };
  const previewGradientStart = (color: string) => {
    onGradientPreview(color, gradient.second, gradient.angle);
  };
  const previewGradientEnd = (color: string) => {
    onGradientPreview(gradient.first, color, gradient.angle);
  };
  const previewGradientAngle = (angle: number) => {
    onGradientPreview(gradient.first, gradient.second, angle);
  };
  const previewHorizontalFocalPoint = (x: number) => {
    if (imageBackground) {
      onImageFocalPointPreview(x, imageBackground.focalPoint.y);
    }
  };
  const previewVerticalFocalPoint = (y: number) => {
    if (imageBackground) {
      onImageFocalPointPreview(imageBackground.focalPoint.x, y);
    }
  };

  return (
    <section className="mt-6 grid gap-4 border-t border-[#e4e4ea] pt-5">
      <div className="grid gap-1">
        <h3 className="m-0 text-sm font-bold text-[#24252c]">页面背景</h3>
        <p className="m-0 text-xs leading-5 text-[#747580]">
          设置画板底色、渐变或背景图片
        </p>
      </div>
      <Tabs
        aria-label="背景类型"
        activeKey={view}
        classNames={{ header: "mb-1" }}
        items={backgroundViews.map(([value, label]) => ({ key: value, label }))}
        onChange={(value) => selectView(value as CanvasBackgroundViewV1)}
        size="small"
      />
      {view === "color" ? (
        <CanvasPanelSection title="快捷颜色">
          <div className="grid grid-cols-6 gap-2.5 py-1">
            <button
              aria-label="透明背景"
              aria-pressed={backgroundTransparent}
              className="grid size-8 place-items-center rounded-full border-2 border-white bg-white p-1 shadow-[0_0_0_1px_#d2d3d8] transition-transform hover:scale-105 aria-pressed:shadow-[0_0_0_2px_var(--primary)]"
              onClick={onTransparent}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-full rounded-full bg-[conic-gradient(#dfe0e6_25%,white_0_50%,#dfe0e6_0_75%,white_0)] [background-size:8px_8px]"
              />
            </button>
            {backgroundColors.map((color) => (
              <button
                aria-label={`背景颜色 ${color}`}
                aria-pressed={backgroundColor === color}
                className="size-8 rounded-full border-2 border-white shadow-[0_0_0_1px_#d2d3d8] transition-transform hover:scale-105 aria-pressed:shadow-[0_0_0_2px_var(--primary)]"
                key={color}
                onClick={() => onColor(color)}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
            <CanvasColorPickerV1
              ariaLabel="自定义背景颜色"
              color={documentColors[0] ?? "#ffffff"}
              documentColors={documentColors}
              onChange={onColorPreview}
              onCommit={onPreviewCommit}
              workspaceId={workspaceId}
            >
              <CanvasAddColorTriggerV1 className="!size-8 !rounded-full" />
            </CanvasColorPickerV1>
          </div>
        </CanvasPanelSection>
      ) : null}
      {view === "gradient" ? (
        <CanvasPanelSection title="渐变预设">
          <div className="grid grid-cols-6 gap-2 py-1">
            {gradientPresets.map(([first, second, angle]) => {
              const selected =
                gradient.first === first &&
                gradient.second === second &&
                gradient.angle === angle;
              return (
                <button
                  aria-label="渐变背景"
                  aria-pressed={selected}
                  className="h-8 rounded-lg border-2 border-white shadow-[0_0_0_1px_#d2d3d8] transition-transform hover:scale-105 aria-pressed:shadow-[0_0_0_2px_var(--primary)]"
                  key={`${first}-${second}`}
                  onClick={() => onGradient(first, second, angle)}
                  style={{
                    background: `linear-gradient(${String(
                      angle,
                    )}deg, ${first}, ${second})`,
                  }}
                  type="button"
                />
              );
            })}
          </div>
          <div className="grid gap-3 pt-2">
            <div className="flex items-center justify-between gap-3 text-xs text-[#555660]">
              <span>起点颜色</span>
              <CanvasColorPickerV1
                ariaLabel="渐变起点颜色"
                color={gradient.first}
                documentColors={documentColors}
                onChange={previewGradientStart}
                onCommit={onPreviewCommit}
                workspaceId={workspaceId}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-[#555660]">
              <span>终点颜色</span>
              <CanvasColorPickerV1
                ariaLabel="渐变终点颜色"
                color={gradient.second}
                documentColors={documentColors}
                onChange={previewGradientEnd}
                onCommit={onPreviewCommit}
                workspaceId={workspaceId}
              />
            </div>
            <CanvasRangeControlV1
              formatValue={(value) => `${String(Math.round(value))}°`}
              label="角度"
              maximum={fullCircleDegrees}
              minimum={0}
              onChange={previewGradientAngle}
              onCommit={onPreviewCommit}
              step={1}
              value={gradient.angle}
            />
          </div>
        </CanvasPanelSection>
      ) : null}
      {view === "image" && imageBackground ? (
        <CanvasPanelSection title="背景图片">
          <div className="grid gap-3">
            <div
              aria-live="polite"
              className="grid min-h-[54px] grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] bg-[#f2f2f4] px-2.5 py-2 text-[#34353e] [&>svg]:text-xl [&>svg]:text-[#555660]"
            >
              <CanvasPanelIcon icon={imageBackgroundIcon} />
              <span className="grid gap-0.5">
                <strong className="text-xs">当前图片背景</strong>
                <small className="text-[11px] text-[#6e7080]">
                  已同步到画板
                </small>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <span className="self-center text-xs text-[#555660]">
                适配方式
              </span>
              <Select<CanvasBackgroundImageFitV1>
                aria-label="背景图片适配方式"
                className="col-span-2"
                onChange={onImageFit}
                options={imageFitOptions.map(([value, label]) => ({
                  label,
                  value,
                }))}
                size="small"
                value={imageBackground.fit}
                variant="filled"
              />
            </div>
            <CanvasRangeControlV1
              formatValue={(value) =>
                `${String(Math.round(value * percentageScale))}%`
              }
              label="透明度"
              maximum={opacityMaximum}
              minimum={opacityMinimum}
              onChange={onImageOpacityPreview}
              onCommit={onPreviewCommit}
              step={opacityStep}
              value={imageBackground.opacity}
            />
            <div className="grid gap-2 pt-1 [&_label]:grid-cols-[42px_minmax(0,1fr)]">
              <strong className="text-xs text-[#454650]">图片焦点</strong>
              <CanvasRangeControlV1
                formatValue={(value) =>
                  `${String(Math.round(value * percentageScale))}%`
                }
                label="水平"
                maximum={opacityMaximum}
                minimum={opacityMinimum}
                onChange={previewHorizontalFocalPoint}
                onCommit={onPreviewCommit}
                step={opacityStep}
                value={imageBackground.focalPoint.x}
              />
              <CanvasRangeControlV1
                formatValue={(value) =>
                  `${String(Math.round(value * percentageScale))}%`
                }
                label="垂直"
                maximum={opacityMaximum}
                minimum={opacityMinimum}
                onChange={previewVerticalFocalPoint}
                onCommit={onPreviewCommit}
                step={opacityStep}
                value={imageBackground.focalPoint.y}
              />
            </div>
            <Button onClick={onBrowseImages} size="small">
              浏览图片替换
            </Button>
            <Button onClick={onConvertImage} size="small">
              转为普通图片
            </Button>
            {selectedImageAvailable ? (
              <Button onClick={onUseSelectedImage} size="small">
                用已选图片替换
              </Button>
            ) : null}
          </div>
        </CanvasPanelSection>
      ) : null}
      {view === "image" && !imageBackground ? (
        <div className="grid min-h-[260px] place-items-center content-center gap-2 text-center text-[#70717c] [&>svg]:mb-1 [&>svg]:text-[34px] [&>svg]:text-[#3048f5]">
          <CanvasPanelIcon icon={imageBackgroundIcon} />
          <strong className="text-sm text-[#151515]">使用图片作为背景</strong>
          <span className="max-w-60 text-xs leading-5">
            从已上传图片中选择，放入后可以调整填满方式和透明度。
          </span>
          {selectedImageAvailable ? (
            <Button onClick={onUseSelectedImage} size="small" type="primary">
              使用已选图片
            </Button>
          ) : null}
          <Button onClick={onBrowseImages} size="small" type="primary">
            浏览已上传图片
          </Button>
        </div>
      ) : null}
    </section>
  );
}
