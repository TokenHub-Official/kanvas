import {
  CheckOutlined,
  HighlightOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Popover } from "antd";
import {
  useMemo,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { useTranslation } from "react-i18next";

import {
  addRecentCanvasColorV1,
  normalizeCanvasHexColorV1,
  readRecentCanvasColorsV1,
  saveRecentCanvasColorsV1,
} from "./canvas-color-library-v1.js";
import { stopCanvasChromeWheelV1 } from "./canvas-interaction-boundary-v1.js";

const MAX_DOCUMENT_COLORS = 12;

const defaultColors = [
  "#151515",
  "#565762",
  "#ffffff",
  "#3048f5",
  "#18a9cf",
  "#5bd7b7",
  "#bdf248",
  "#fff36a",
  "#ff8a34",
  "#ff2f70",
  "#7f56d9",
  "#8c5a3c",
] as const;

export function CanvasColorPickerV1({
  ariaLabel,
  children,
  color,
  documentColors = [],
  onChange,
  onCommit,
  side = "right",
  workspaceId,
}: {
  readonly ariaLabel: string;
  readonly children?: ReactNode;
  readonly color: string;
  readonly documentColors?: readonly string[];
  readonly onChange: (color: string) => void;
  readonly onCommit: (color: string) => void;
  readonly side?: "left" | "right";
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const normalized = normalizeCanvasHexColorV1(color) ?? "#151515";
  const [draftOverride, setDraftOverride] = useState<string>();
  const draft = draftOverride ?? normalized;
  const [recent, setRecent] = useState<readonly string[]>(() =>
    readRecentCanvasColorsV1(workspaceId),
  );

  const designColors = useMemo(
    () =>
      [
        ...new Set(
          documentColors.flatMap((candidate) => {
            const value = normalizeCanvasHexColorV1(candidate);
            return value ? [value] : [];
          }),
        ),
      ].slice(0, MAX_DOCUMENT_COLORS),
    [documentColors],
  );

  const preview = (next: string) => {
    const value = normalizeCanvasHexColorV1(next);
    if (!value) {
      return;
    }
    setDraftOverride(value);
    onChange(value);
  };

  const commit = (next = draft) => {
    const value = normalizeCanvasHexColorV1(next);
    if (!value) {
      return;
    }
    const colors = addRecentCanvasColorV1(recent, value);
    setRecent(colors);
    saveRecentCanvasColorsV1(workspaceId, colors);
    onCommit(value);
  };

  const selectSwatch = (candidate: string): void => {
    preview(candidate);
    commit(candidate);
  };

  const swatches = (label: string, colors: readonly string[]) =>
    colors.length > 0 ? (
      <section className="grid gap-2.5">
        <h3 className="m-0 text-xs font-bold text-[#4b4c56]">{label}</h3>
        <div className="grid grid-cols-8 gap-2">
          {colors.map((candidate) => (
            <button
              aria-label={`${label} ${candidate}`}
              aria-pressed={candidate === draft}
              className="grid size-[26px] place-items-center rounded-lg border border-[rgb(21_21_21_/_16%)] p-0 shadow-[inset_0_0_0_1px_white] aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-[#3048f5] [&_svg]:size-3.5 [&_svg]:text-white [&_svg]:[filter:drop-shadow(0_1px_1px_rgb(0_0_0_/_60%))]"
              key={candidate}
              onClick={() => selectSwatch(candidate)}
              style={{ backgroundColor: candidate }}
              type="button"
            >
              {candidate === draft ? (
                <CheckOutlined aria-hidden="true" className="text-xs" />
              ) : null}
            </button>
          ))}
        </div>
      </section>
    ) : null;

  const content = (
    <div
      className="grid max-h-[min(620px,calc(100vh-32px))] w-[304px] gap-4 overflow-auto overscroll-contain p-4 text-[#151515] [&_.react-colorful]:h-[188px] [&_.react-colorful]:w-full [&_.react-colorful__hue]:mt-2 [&_.react-colorful__hue]:h-4 [&_.react-colorful__hue]:rounded-full [&_.react-colorful__pointer]:size-5 [&_.react-colorful__saturation]:rounded-[10px_10px_6px_6px]"
      data-canvas-wheel-owner=""
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onWheel={stopCanvasChromeWheelV1}
    >
      <header className="flex min-h-6 items-center justify-between gap-4">
        <strong className="text-sm">{ariaLabel}</strong>
        <span className="text-xs tabular-nums text-[#5f606b]">{draft}</span>
      </header>
      {swatches(t("canvas.colorPicker.documentColors"), designColors)}
      {swatches(t("canvas.colorPicker.recentColors"), recent)}
      <section className="grid gap-2.5">
        <h3 className="m-0 text-xs font-bold text-[#4b4c56]">
          {t("canvas.colorPicker.customColor")}
        </h3>
        <HexColorPicker
          aria-label={t("canvas.colorPicker.saturation")}
          color={draft}
          onChange={preview}
          onChangeEnd={commit}
        />
        <label className="grid h-[38px] grid-cols-[24px_auto_minmax(0,1fr)_32px] items-center gap-1.5 rounded-lg border border-[#d8d9e2] py-0 pr-1 pl-2">
          <span
            aria-hidden="true"
            className="size-5 rounded-md border border-[rgb(21_21_21_/_12%)]"
            style={{ backgroundColor: draft }}
          />
          <b className="text-[13px] font-semibold text-[#70717c]">#</b>
          <HexColorInput
            alpha={false}
            color={draft}
            className="min-w-0 border-0 outline-0 [font-variant-numeric:tabular-nums]"
            onBlur={() => {
              commit();
            }}
            onChange={preview}
            prefixed={false}
          />
          <button
            aria-label={t("canvas.colorPicker.eyedropperUnavailable")}
            className="grid size-[30px] place-items-center rounded-lg border-0 bg-[#f2f3f6] p-0 text-[#777884]"
            disabled
            type="button"
          >
            <HighlightOutlined aria-hidden="true" className="size-4 text-sm" />
          </button>
        </label>
      </section>
      {swatches(t("canvas.colorPicker.defaultColors"), defaultColors)}
    </div>
  );

  return (
    <Popover
      arrow
      content={content}
      onOpenChange={(open) => {
        if (!open) {
          commit();
          setDraftOverride(undefined);
        }
      }}
      placement={side === "left" ? "leftTop" : "rightTop"}
      styles={{
        container: { overflow: "hidden" },
        content: { padding: 0 },
      }}
      trigger="click"
    >
      {children ?? (
        <button
          aria-label={ariaLabel}
          className="size-[26px] flex-none rounded-full border-2 border-white shadow-[0_0_0_1px_#b8bac4]"
          style={{ backgroundColor: normalized }}
          type="button"
        />
      )}
    </Popover>
  );
}

export function CanvasAddColorTriggerV1({
  ariaLabel,
  className,
  ref,
  ...buttonProps
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  readonly ariaLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      {...buttonProps}
      aria-label={ariaLabel ?? t("canvas.colorPicker.addCustomColor")}
      className={[
        "grid size-8 place-items-center rounded-full border-2 border-white bg-[conic-gradient(from_45deg,#ff2f70,#ff8a34,#fff36a,#5bd7b7,#18a9cf,#3048f5,#7f56d9,#ff2f70)] text-[#3048f5] shadow-[0_0_0_1px_#d2d3d8,inset_0_0_0_4px_white]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      type="button"
    >
      <PlusOutlined
        aria-hidden="true"
        className="size-4 rounded-full bg-[#151515] p-0.5 text-sm text-white"
      />
    </button>
  );
}
