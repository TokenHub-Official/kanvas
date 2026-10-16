import {
  CompressOutlined,
  QuestionCircleOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Button, InputNumber, Slider, Tooltip } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { stopCanvasChromeWheelV1 } from "./canvas-interaction-boundary-v1.js";
import {
  canvasViewportMaximumZoomV1,
  canvasViewportMinimumZoomV1,
} from "./canvas-viewport-v1.js";

type CanvasViewControlsV1Props = {
  onFit: () => void;
  onShortcutsOpenChange: (open: boolean) => void;
  onShortcutsTriggerRef?: (node: HTMLButtonElement | null) => void;
  onZoomChange: (zoom: number) => void;
  shortcutsOpen: boolean;
  showShortcuts?: boolean;
  zoom: number;
};
const ZOOM_BUTTON_STEP = 0.1;

const shortcutGroups = [
  {
    id: "view",
    items: ["pan", "fit", "actual", "help", "escape"],
  },
  {
    id: "edit",
    items: [
      "undo",
      "redo",
      "copy",
      "cut",
      "paste",
      "duplicate",
      "selectAll",
      "delete",
    ],
  },
  {
    id: "transform",
    items: ["nudge", "nudgeLarge", "rotate", "rotateLarge"],
  },
] as const;

export function CanvasViewControlsV1({
  onFit,
  onShortcutsOpenChange,
  onShortcutsTriggerRef,
  onZoomChange,
  shortcutsOpen,
  showShortcuts = true,
  zoom,
}: CanvasViewControlsV1Props) {
  const { t } = useTranslation();
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutsTriggerRef = useRef<HTMLElement>(null);
  const zoomPercent = Math.round(zoom * 100);
  const controlMinimumZoom =
    zoom < canvasViewportMinimumZoomV1 ? zoom : canvasViewportMinimumZoomV1;
  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !shortcutsRef.current?.contains(target) &&
        !shortcutsTriggerRef.current?.contains(target)
      ) {
        onShortcutsOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [onShortcutsOpenChange, shortcutsOpen]);
  return (
    <div
      aria-label={t("canvas.view.toolbarLabel")}
      className="canvas-v1-view-controls pointer-events-auto flex h-[38px] flex-none items-center gap-0.5 rounded-lg border border-[var(--canvas-panel-line)] bg-[rgb(251_251_252_/_94%)] p-1 shadow-[0_6px_18px_rgb(15_18_30_/_10%),0_1px_2px_rgb(15_18_30_/_6%)] backdrop-blur-xl"
      onWheel={stopCanvasChromeWheelV1}
      role="toolbar"
    >
      <Tooltip title={t("canvas.view.fit")}>
        <Button
          aria-label={t("canvas.view.fit")}
          icon={<CompressOutlined aria-hidden="true" />}
          onClick={onFit}
          shape="circle"
          size="small"
          type="text"
        />
      </Tooltip>
      <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-[#e2e3e8]" />
      <Tooltip title={t("canvas.view.zoomOut")}>
        <Button
          aria-label={t("canvas.view.zoomOut")}
          disabled={zoom <= canvasViewportMinimumZoomV1}
          icon={<ZoomOutOutlined aria-hidden="true" />}
          onClick={() => {
            onZoomChange(zoom - ZOOM_BUTTON_STEP);
          }}
          shape="circle"
          size="small"
          type="text"
        />
      </Tooltip>
      <div aria-label={t("canvas.view.zoom")} className="w-20">
        <Slider
          aria-label={t("canvas.view.zoom")}
          max={canvasViewportMaximumZoomV1}
          min={controlMinimumZoom}
          onChange={(value) => {
            onZoomChange(value);
          }}
          step={0.05}
          tooltip={{ open: false }}
          value={zoom}
        />
      </div>
      <label className="flex items-center gap-0.5">
        <span className="sr-only">{t("canvas.view.zoomPercent")}</span>
        <InputNumber
          aria-label={t("canvas.view.zoomPercent")}
          controls={false}
          max={canvasViewportMaximumZoomV1 * 100}
          min={Math.floor(controlMinimumZoom * 100)}
          onChange={(value) => {
            if (value !== null) {
              onZoomChange(Number(value) / 100);
            }
          }}
          size="small"
          style={{ width: 56 }}
          value={zoomPercent}
          variant="borderless"
        />
        <span>%</span>
      </label>
      <Tooltip title={t("canvas.view.zoomIn")}>
        <Button
          aria-label={t("canvas.view.zoomIn")}
          icon={<ZoomInOutlined aria-hidden="true" />}
          onClick={() => {
            onZoomChange(zoom + ZOOM_BUTTON_STEP);
          }}
          shape="circle"
          size="small"
          type="text"
        />
      </Tooltip>
      {showShortcuts ? (
        <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-[#e2e3e8]" />
      ) : null}
      {showShortcuts ? (
        <div className="relative grid">
          <Tooltip
            open={shortcutsOpen ? false : undefined}
            title={t("canvas.view.shortcuts.action")}
          >
            <Button
              aria-expanded={shortcutsOpen}
              aria-haspopup="dialog"
              aria-label={t("canvas.view.shortcuts.action")}
              icon={<QuestionCircleOutlined aria-hidden="true" />}
              onClick={() => {
                onShortcutsOpenChange(!shortcutsOpen);
              }}
              ref={(node) => {
                shortcutsTriggerRef.current = node;
                onShortcutsTriggerRef?.(
                  node instanceof HTMLButtonElement ? node : null,
                );
              }}
              shape="circle"
              size="small"
              type="text"
            />
          </Tooltip>
          {shortcutsOpen ? (
            <div
              aria-label={t("canvas.view.shortcuts.dialogLabel")}
              className="absolute right-0 bottom-[calc(100%+8px)] z-[140] grid max-h-[min(620px,calc(100vh-120px))] w-[300px] origin-bottom-right gap-1 overflow-y-auto rounded-[9px] border border-[rgb(21_21_21_/_12%)] bg-white p-2.5 text-[var(--ink)] shadow-[0_16px_40px_rgb(9_12_20_/_22%)] animate-[canvas-popover-enter_150ms_var(--canvas-ease-out)] motion-reduce:animate-none"
              ref={shortcutsRef}
              role="dialog"
            >
              <strong className="px-1 pt-0.5 pb-1.5 text-[13px] leading-tight text-[#30313a]">
                {t("canvas.view.shortcuts.title")}
              </strong>
              {shortcutGroups.map((group, groupIndex) => (
                <section
                  className={`grid gap-0.5 pt-1 ${
                    groupIndex > 0 ? "mt-1 border-t border-[var(--line)]" : ""
                  }`}
                  key={group.id}
                >
                  <h3 className="m-0 px-1 pt-[7px] pb-[3px] text-[11px] font-bold text-[var(--muted)]">
                    {t(`canvas.view.shortcuts.groups.${group.id}`)}
                  </h3>
                  {group.items.map((itemId) => (
                    <span
                      className="flex min-h-8 items-center justify-between gap-2.5 rounded-md px-1 text-xs text-[#565762] hover:bg-[#f5f5f8]"
                      key={itemId}
                    >
                      <kbd className="grid h-[26px] min-w-[38px] place-items-center rounded-[5px] border border-[#d7d9e0] bg-[#f5f6f8] px-1.5 text-center text-[11px] text-[#24262d]">
                        {t(`canvas.view.shortcuts.items.${itemId}.keys`)}
                      </kbd>
                      {t(`canvas.view.shortcuts.items.${itemId}.label`)}
                    </span>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
