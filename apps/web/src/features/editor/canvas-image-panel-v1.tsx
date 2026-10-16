import {
  BorderOutlined,
  ExperimentOutlined,
  FullscreenOutlined,
  LeftOutlined,
  PictureOutlined,
  RightOutlined,
  ScissorOutlined,
  SlidersOutlined,
} from "@ant-design/icons";
import {
  Button,
  InputNumber,
  Radio,
  Slider,
  type RadioChangeEvent,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  canvasImageControlsForSectionV1,
  canvasImageCropPresetsV1,
  canvasImageFilterIsActiveV1,
  canvasImageFilterPresetsV1,
  canvasImageNodeWithAdjustmentV1,
  canvasImageNodeWithCropPresetV1,
  canvasImageNodeWithFilterV1,
  resetCanvasImageNodeV1,
  type CanvasImageCropPresetIdV1,
  type CanvasImageInspectorSectionV1,
} from "./canvas-image-inspector-model-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import { editorImageCssFilterV1 } from "./image-adjustments-v1.js";
import { canvasImageCropSourcePreviewNodeV1 } from "./canvas-image-crop-direct-v1.js";

type ImageNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "image" }>;
const SCROLL_EDGE_TOLERANCE_PX = 4;
const SCROLL_PAGE_RATIO = 0.72;
const MIN_SCROLL_PAGE_PX = 160;
const HALF_TURN_DEGREES = 180;
const FULL_TURN_DEGREES = 360;
const ROTATION_ZERO_TOLERANCE = 0.001;

export type CanvasImagePanelViewV1 = "home" | CanvasImageInspectorSectionV1;
export type CanvasImageCropModeV1 = "free" | CanvasImageCropPresetIdV1;

export interface CanvasImagePanelToolV1 {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly id: string;
  readonly interactionBehavior: "direct" | "form";
  readonly label: string;
}

const canvasImageToolCoverByCapabilityV1 = {
  edit: "/assets/canvas/image-tools/edit-image.png",
  denoise: "/assets/canvas/image-tools/denoise.png",
  removeBackground: "/assets/canvas/image-tools/remove-background.png",
} as const;

function canvasImageToolCoverV1(toolId: string): string | undefined {
  if (toolId.includes("background")) {
    return canvasImageToolCoverByCapabilityV1.removeBackground;
  }
  if (toolId.includes("denoise")) {
    return canvasImageToolCoverByCapabilityV1.denoise;
  }
  if (toolId.includes("edit")) {
    return canvasImageToolCoverByCapabilityV1.edit;
  }
  return undefined;
}

function ImageAdjustmentFieldV1({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  onCommit,
  step,
  value,
  valueKind = "percent",
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (value: number) => void;
  readonly onCommit: () => void;
  readonly step: number;
  readonly value: number;
  readonly valueKind?: "percent" | "pixels";
}) {
  const displayFactor = valueKind === "percent" ? 100 : 1;
  const displayValue = Math.round(value * displayFactor);
  const displayMaximum = Math.round(maximum * displayFactor);
  const displayMinimum = Math.round(minimum * displayFactor);
  const displayStep = Math.max(step * displayFactor, 1);
  const handleInputChange = (nextValue: number | null) => {
    if (typeof nextValue !== "number") {
      return;
    }
    onChange(nextValue / displayFactor);
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">{label}</span>
        <InputNumber
          aria-label={label}
          controls={false}
          disabled={disabled}
          max={displayMaximum}
          min={displayMinimum}
          onBlur={onCommit}
          onChange={handleInputChange}
          onPressEnter={onCommit}
          size="small"
          step={displayStep}
          suffix={valueKind === "pixels" ? "px" : undefined}
          value={displayValue}
          variant="filled"
        />
      </div>
      <Slider
        ariaLabelForHandle={label}
        disabled={disabled}
        max={maximum}
        min={minimum}
        onChange={onChange}
        onChangeComplete={onCommit}
        step={step}
        tooltip={{ open: false }}
        value={value}
      />
    </div>
  );
}

function ImageToolTileV1({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
  previewUrl,
  visual = "cover",
  interactionBehavior = "form",
}: {
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly previewUrl?: string;
  readonly visual?: "cover" | "plain";
  readonly interactionBehavior?: "direct" | "form";
}) {
  const { t } = useTranslation();
  let actionLabel = t("canvas.image.openTool", { tool: label });
  if (active) {
    actionLabel = t("canvas.image.cancelTool", { tool: label });
  } else if (interactionBehavior === "direct") {
    actionLabel = t("canvas.image.runTool", { tool: label });
  }
  let visualClassName =
    "border-line bg-mist text-primary group-hover:border-line-strong";
  if (active) {
    visualClassName =
      "border-primary bg-primary text-white shadow-[inset_0_0_0_1px_var(--primary)]";
  } else if (visual === "plain") {
    visualClassName =
      "border-line bg-transparent text-ink group-hover:border-line-strong";
  }
  return (
    <button
      aria-label={actionLabel}
      aria-pressed={active}
      className="group grid min-w-0 justify-items-center gap-2 px-1 py-1.5 text-center focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={`grid size-12 place-items-center overflow-hidden rounded-full border text-lg transition duration-150 group-hover:-translate-y-px group-hover:shadow-sm ${visualClassName}`}
      >
        {previewUrl ? (
          <img alt="" className="size-full object-cover" src={previewUrl} />
        ) : (
          icon
        )}
      </span>
      <span className="w-full truncate text-xs font-medium">{label}</span>
    </button>
  );
}

function ImagePreviewRailV1({
  activeId,
  disabled,
  items,
  onChange,
  previewUrl,
}: {
  readonly activeId?: string;
  readonly disabled: boolean;
  readonly items: readonly (typeof canvasImageFilterPresetsV1)[number][];
  readonly onChange: (
    preset: (typeof canvasImageFilterPresetsV1)[number],
  ) => void;
  readonly previewUrl?: string;
}) {
  const { t } = useTranslation();
  const railRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canNext: false,
    canPrevious: false,
  });
  const updateScrollState = useCallback(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const maximum = rail.scrollWidth - rail.clientWidth;
    setScrollState({
      canPrevious: rail.scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
      canNext: rail.scrollLeft < maximum - SCROLL_EDGE_TOLERANCE_PX,
    });
  }, []);
  const connectRail = useCallback(
    (rail: HTMLDivElement | null) => {
      railRef.current = rail;
      if (rail) {
        updateScrollState();
      }
    },
    [updateScrollState],
  );
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(rail);
    return () => {
      observer.disconnect();
    };
  }, [items, updateScrollState]);
  const move = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    rail.scrollBy({
      left:
        direction *
        Math.max(rail.clientWidth * SCROLL_PAGE_RATIO, MIN_SCROLL_PAGE_PX),
      behavior: "smooth",
    });
  };
  return (
    <div className="relative min-w-0 max-w-full overflow-hidden">
      <div
        className="flex w-full min-w-0 max-w-full snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={updateScrollState}
        ref={connectRail}
      >
        {items.map((preset) => (
          <button
            aria-pressed={preset.id === activeId}
            className="group grid w-20 shrink-0 snap-start gap-1.5 text-left focus-visible:outline-none"
            disabled={disabled}
            key={preset.id}
            onClick={() => {
              onChange(preset);
            }}
            type="button"
          >
            <span
              className={`aspect-square overflow-hidden rounded-xl border bg-mist transition duration-150 group-hover:border-line-strong group-focus-visible:border-primary group-focus-visible:shadow-[inset_0_0_0_1px_var(--primary)] ${
                preset.id === activeId
                  ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                  : "border-line"
              }`}
            >
              {previewUrl ? (
                <img
                  alt=""
                  className="size-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
                  src={previewUrl}
                  style={{
                    filter: editorImageCssFilterV1(preset.adjustments),
                  }}
                />
              ) : null}
            </span>
            <span
              className={`truncate px-0.5 text-center text-xs font-medium ${
                preset.id === activeId ? "text-primary" : "text-ink"
              }`}
            >
              {t(`canvas.filters.presets.${preset.labelKey}`)}
            </span>
          </button>
        ))}
      </div>
      {scrollState.canPrevious ? (
        <div className="pointer-events-none absolute left-0 top-0 flex h-20 w-12 items-center bg-gradient-to-r from-paper via-paper/90 to-transparent">
          <button
            aria-label={t("canvas.image.scrollPrevious")}
            className="pointer-events-auto grid size-8 place-items-center border-0 bg-transparent p-0 text-ink transition-colors hover:bg-transparent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              move(-1);
            }}
            type="button"
          >
            <LeftOutlined aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {scrollState.canNext ? (
        <div className="pointer-events-none absolute right-0 top-0 flex h-20 w-12 items-center justify-end bg-gradient-to-l from-paper via-paper/90 to-transparent">
          <button
            aria-label={t("canvas.image.scrollNext")}
            className="pointer-events-auto grid size-8 place-items-center border-0 bg-transparent p-0 text-ink transition-colors hover:bg-transparent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              move(1);
            }}
            type="button"
          >
            <RightOutlined aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasImagePanelV1({
  cropMode,
  disabled,
  node,
  onCancelCrop,
  onCommit,
  onConfirmCrop,
  onCropModeChange,
  onPreview,
  onReplace,
  onRestoreCrop,
  onTool,
  onViewChange,
  previewUrl,
  tools,
  view,
}: {
  readonly cropMode: CanvasImageCropModeV1;
  readonly disabled: boolean;
  readonly node: ImageNodeV1;
  readonly onCancelCrop: () => void;
  readonly onCommit: () => void;
  readonly onConfirmCrop: () => void;
  readonly onCropModeChange: (mode: CanvasImageCropModeV1) => void;
  readonly onPreview: (node: ImageNodeV1) => void;
  readonly onReplace: (node: ImageNodeV1) => void;
  readonly onRestoreCrop: () => void;
  readonly onTool: (toolId: string) => void;
  readonly onViewChange: (view: CanvasImagePanelViewV1) => void;
  readonly previewUrl?: string;
  readonly tools: readonly CanvasImagePanelToolV1[];
  readonly view: CanvasImagePanelViewV1;
}) {
  const { t } = useTranslation();
  const cropRatioRailRef = useRef<HTMLDivElement>(null);
  const activeFilterId = useMemo(
    () =>
      canvasImageFilterPresetsV1.find((preset) =>
        canvasImageFilterIsActiveV1(node.image, preset),
      )?.id,
    [node.image],
  );
  const renderAdjustmentSection = (id: "color" | "detail" | "light") => (
    <section className="grid gap-3" key={id}>
      <h3 className="text-sm font-bold">{t(`canvas.image.sections.${id}`)}</h3>
      {canvasImageControlsForSectionV1(id).map(
        ([key, minimum, maximum, step]) => {
          const value = node.image.adjustments?.[key] ?? 0;
          return (
            <ImageAdjustmentFieldV1
              disabled={disabled}
              key={key}
              label={t(`canvas.image.adjustments.${key}`)}
              maximum={maximum}
              minimum={minimum}
              onChange={(nextValue) => {
                onPreview(
                  canvasImageNodeWithAdjustmentV1(node, key, nextValue),
                );
              }}
              onCommit={onCommit}
              step={step}
              value={value}
              valueKind={key === "blur" ? "pixels" : "percent"}
            />
          );
        },
      )}
      {id === "detail" ? (
        <ImageAdjustmentFieldV1
          disabled={disabled}
          label={t("canvas.image.cornerRadius")}
          maximum={Math.min(node.transform.width, node.transform.height) / 2}
          minimum={0}
          onChange={(cornerRadius) => {
            onPreview({
              ...node,
              cornerRadius,
            });
          }}
          onCommit={onCommit}
          step={1}
          value={node.cornerRadius}
          valueKind="pixels"
        />
      ) : null}
    </section>
  );
  const runTool = (toolId: string) => {
    onCommit();
    onTool(toolId);
  };
  const applyFilter = (preset: (typeof canvasImageFilterPresetsV1)[number]) => {
    onCommit();
    onReplace(canvasImageNodeWithFilterV1(node, preset));
  };
  const resetImage = () => {
    onCommit();
    onReplace(resetCanvasImageNodeV1(node));
  };
  const handleFilterChange = (event: RadioChangeEvent) => {
    const preset = canvasImageFilterPresetsV1.find(
      (candidate) => candidate.id === event.target.value,
    );
    if (preset) {
      applyFilter(preset);
    }
  };
  const applyCropPreset = (presetId: CanvasImageCropPresetIdV1) => {
    onCropModeChange(presetId);
    onPreview(
      canvasImageNodeWithCropPresetV1(
        node,
        presetId,
        canvasImageCropSourcePreviewNodeV1(node).transform,
      ),
    );
  };
  const signedRotation =
    ((node.transform.rotation + HALF_TURN_DEGREES) % FULL_TURN_DEGREES) -
    HALF_TURN_DEGREES;
  const applyRotation = (rotation: number) => {
    onPreview({
      ...node,
      transform: {
        ...node.transform,
        rotation:
          ((rotation % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) %
          FULL_TURN_DEGREES,
      },
    });
  };

  if (view === "home") {
    const previewSections = [
      {
        id: "style",
        presets: canvasImageFilterPresetsV1.filter(
          (preset) => preset.group === "style",
        ),
      },
      {
        id: "filters",
        presets: canvasImageFilterPresetsV1.filter(
          (preset) => preset.group !== "style",
        ),
      },
    ] as const;
    return (
      <div className="grid min-w-0 content-start gap-6 overflow-hidden">
        <section className="grid min-w-0 content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {t("canvas.image.sections.tools")}
            </h3>
            <Button
              className="text-xs font-normal text-muted"
              size="small"
              type="text"
            >
              {t("canvas.image.viewAll")}
            </Button>
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-x-2 gap-y-3">
            <ImageToolTileV1
              disabled={disabled}
              icon={<SlidersOutlined aria-hidden="true" />}
              label={t("canvas.image.sections.adjust")}
              onClick={() => {
                onViewChange("adjust");
              }}
              visual="plain"
            />
            <ImageToolTileV1
              disabled={disabled}
              icon={<ScissorOutlined aria-hidden="true" />}
              label={t("canvas.image.sections.crop")}
              onClick={() => {
                onViewChange("crop");
              }}
              visual="plain"
            />
            {tools.map((tool) => {
              const toolCover = canvasImageToolCoverV1(tool.id);
              return (
                <ImageToolTileV1
                  active={tool.active}
                  disabled={disabled || tool.disabled}
                  icon={<ExperimentOutlined aria-hidden="true" />}
                  key={tool.id}
                  label={tool.label}
                  interactionBehavior={tool.interactionBehavior}
                  onClick={() => runTool(tool.id)}
                  {...(toolCover ? { previewUrl: toolCover } : {})}
                />
              );
            })}
          </div>
        </section>
        {previewSections.map((section) => (
          <section
            className="grid min-w-0 content-start gap-3 overflow-hidden"
            key={section.id}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {t(`canvas.image.sections.${section.id}`)}
              </h3>
              <Button
                className="text-xs font-normal text-muted"
                onClick={() => {
                  onViewChange("filters");
                }}
                size="small"
                type="text"
              >
                {t("canvas.image.viewAll")}
              </Button>
            </div>
            <ImagePreviewRailV1
              {...(activeFilterId ? { activeId: activeFilterId } : {})}
              disabled={disabled}
              items={section.presets}
              onChange={applyFilter}
              {...(previewUrl ? { previewUrl } : {})}
            />
          </section>
        ))}
      </div>
    );
  }

  if (view === "adjust") {
    return (
      <div className="grid gap-6">
        {renderAdjustmentSection("light")}
        {renderAdjustmentSection("color")}
        {renderAdjustmentSection("detail")}
        <Button disabled={disabled} onClick={resetImage}>
          {t("canvas.image.reset")}
        </Button>
      </div>
    );
  }

  if (view === "filters") {
    return (
      <div className="grid gap-5">
        {(["base", "temperature", "style"] as const).map((group) => (
          <section className="grid gap-2" key={group}>
            <h3 className="text-sm font-bold">
              {t(`canvas.filters.groups.${group}`)}
            </h3>
            <Radio.Group
              aria-label={t("canvas.image.filterGroup", {
                group: t(`canvas.filters.groups.${group}`),
              })}
              className="grid grid-cols-2 gap-2"
              disabled={disabled}
              onChange={handleFilterChange}
              value={activeFilterId}
            >
              {canvasImageFilterPresetsV1
                .filter((preset) => preset.group === group)
                .map((preset) => (
                  <Radio key={preset.id} value={preset.id}>
                    <span className="grid min-w-0 gap-2 rounded-xl bg-mist p-2 text-xs font-semibold">
                      {previewUrl ? (
                        <img
                          alt=""
                          className="aspect-square w-full rounded-lg object-cover"
                          src={previewUrl}
                          style={{
                            filter: editorImageCssFilterV1(preset.adjustments),
                          }}
                        />
                      ) : null}
                      <span>
                        {t(`canvas.filters.presets.${preset.labelKey}`)}
                      </span>
                    </span>
                  </Radio>
                ))}
            </Radio.Group>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 text-xs leading-5 text-muted">
        {t("canvas.crop.directHint")}
      </p>
      <section className="grid gap-3">
        <h3 className="m-0 text-sm font-bold">{t("canvas.crop.ratio")}</h3>
        <div className="relative min-w-0">
          <div
            className="grid auto-cols-[92px] grid-flow-col gap-2 overflow-x-auto pb-1 pr-8"
            ref={cropRatioRailRef}
          >
            <button
              aria-pressed={cropMode === "free"}
              className="grid min-h-24 place-items-center gap-2 rounded-xl border border-line bg-paper px-2 py-3 text-xs font-semibold transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:border-primary data-[active=true]:text-primary"
              data-active={cropMode === "free"}
              disabled={disabled}
              onClick={() => {
                onCropModeChange("free");
              }}
              type="button"
            >
              <FullscreenOutlined aria-hidden="true" className="text-xl" />
              <span>{t("canvas.crop.free")}</span>
            </button>
            {canvasImageCropPresetsV1.map((preset) => {
              const label =
                preset.id === "original"
                  ? t("canvas.crop.original")
                  : preset.id;
              return (
                <button
                  aria-label={t("canvas.crop.useRatio", { ratio: label })}
                  aria-pressed={cropMode === preset.id}
                  className="grid min-h-24 place-items-center gap-2 rounded-xl border border-line bg-paper px-2 py-3 text-xs font-semibold transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:border-primary data-[active=true]:text-primary"
                  data-active={cropMode === preset.id}
                  disabled={disabled}
                  key={preset.id}
                  onClick={() => {
                    applyCropPreset(preset.id);
                  }}
                  type="button"
                >
                  {preset.id === "original" ? (
                    <PictureOutlined aria-hidden="true" className="text-xl" />
                  ) : (
                    <BorderOutlined aria-hidden="true" className="text-xl" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <button
            aria-label={t("canvas.crop.moreRatios")}
            className="absolute right-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-paper/95 text-ink shadow-sm backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              cropRatioRailRef.current?.scrollBy({
                behavior: "smooth",
                left: cropRatioRailRef.current.clientWidth * SCROLL_PAGE_RATIO,
              });
            }}
            type="button"
          >
            <RightOutlined aria-hidden="true" />
          </button>
        </div>
      </section>
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-bold">{t("canvas.crop.rotation")}</h3>
          <Button
            disabled={
              disabled || Math.abs(signedRotation) < ROTATION_ZERO_TOLERANCE
            }
            onClick={() => {
              applyRotation(0);
            }}
            size="small"
            type="text"
          >
            {t("canvas.crop.resetRotation")}
          </Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-3">
          <Slider
            ariaLabelForHandle={t("canvas.crop.rotation")}
            disabled={disabled}
            max={HALF_TURN_DEGREES}
            min={-HALF_TURN_DEGREES}
            onChange={applyRotation}
            step={1}
            tooltip={{ formatter: (value) => `${String(value ?? 0)}°` }}
            value={signedRotation}
          />
          <InputNumber
            aria-label={t("canvas.crop.rotation")}
            controls={false}
            disabled={disabled}
            max={HALF_TURN_DEGREES}
            min={-HALF_TURN_DEGREES}
            onChange={(value) => {
              if (typeof value === "number") {
                applyRotation(value);
              }
            }}
            suffix="°"
            value={Math.round(signedRotation)}
            variant="filled"
          />
        </div>
      </section>
      <Button disabled={disabled} onClick={onRestoreCrop}>
        {t("canvas.crop.restore")}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancelCrop}>{t("canvas.crop.cancel")}</Button>
        <Button disabled={disabled} onClick={onConfirmCrop} type="primary">
          {t("canvas.crop.confirm")}
        </Button>
      </div>
    </div>
  );
}
