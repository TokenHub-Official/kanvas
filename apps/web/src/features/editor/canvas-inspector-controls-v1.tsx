import { Input, Select, Slider, Switch } from "antd";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export function CanvasInspectorRangeFieldV1({
  disabled = false,
  formatValue = (value) => String(value),
  label,
  maximum,
  minimum,
  onChange,
  onCommit,
  step,
  value,
}: {
  readonly disabled?: boolean;
  readonly formatValue?: (value: number) => string;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (value: number) => void;
  readonly onCommit?: () => void;
  readonly step: number;
  readonly value: number;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-[var(--ink)]">{label}</span>
        <output className="text-xs tabular-nums text-[var(--muted)]">
          {formatValue(value)}
        </output>
      </div>
      <Slider
        ariaLabelForHandle={label}
        disabled={disabled}
        max={maximum}
        min={minimum}
        onChange={onChange}
        {...(onCommit ? { onChangeComplete: onCommit } : {})}
        range={false}
        step={step}
        tooltip={{
          formatter: (nextValue) =>
            nextValue === undefined ? null : formatValue(nextValue),
        }}
        value={value}
      />
    </div>
  );
}

export function CommonNodeInspectorV1({
  disabled,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
}: {
  readonly disabled: boolean;
  readonly node: EditorRuntimeNodeV1;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
}) {
  const { t } = useTranslation();
  const [nameDraftOverride, setNameDraftOverride] = useState<{
    readonly nodeId: string;
    readonly value: string;
  }>();
  const nameDraft =
    nameDraftOverride?.nodeId === node.id ? nameDraftOverride.value : node.name;
  const contentDisabled = disabled || node.locked;
  const blendModes = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color_dodge",
    "color_burn",
    "hard_light",
    "soft_light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ] as const;

  function commitNameDraft(): void {
    const name = nameDraft.trim();
    if (name && name !== node.name) {
      onChange({
        ...node,
        name,
      });
    }
    setNameDraftOverride(undefined);
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    setNameDraftOverride(undefined);
    event.currentTarget.blur();
  }

  return (
    <div className="grid gap-5">
      <label className="grid gap-2">
        <span className="text-xs font-bold">{t("canvas.common.name")}</span>
        <Input
          disabled={contentDisabled}
          maxLength={240}
          onBlur={commitNameDraft}
          onChange={(event) => {
            setNameDraftOverride({
              nodeId: node.id,
              value: event.target.value,
            });
          }}
          onPressEnter={commitNameDraft}
          onKeyDown={handleNameKeyDown}
          value={nameDraft}
          variant="filled"
        />
      </label>
      <div className="grid divide-y divide-[var(--canvas-panel-line)] overflow-hidden rounded-xl border border-[var(--canvas-panel-line)]">
        <label className="flex min-h-11 items-center justify-between gap-3 px-3">
          <span className="text-sm font-medium">
            {t("canvas.common.visible")}
          </span>
          <Switch
            aria-label={t("canvas.common.visible")}
            checked={node.visible}
            disabled={disabled}
            onChange={(visible) => {
              onChange({ ...node, visible });
            }}
            size="small"
          />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 px-3">
          <span className="text-sm font-medium">
            {t("canvas.common.locked")}
          </span>
          <Switch
            aria-label={t("canvas.common.locked")}
            checked={node.locked}
            disabled={disabled}
            onChange={(locked) => {
              onChange({ ...node, locked });
            }}
            size="small"
          />
        </label>
      </div>
      <CanvasInspectorRangeFieldV1
        disabled={contentDisabled}
        formatValue={(value) => `${String(Math.round(value * 100))}%`}
        label={t("canvas.common.opacity")}
        maximum={1}
        minimum={0}
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
      <label className="grid gap-2">
        <span className="text-xs font-bold">
          {t("canvas.common.blendMode")}
        </span>
        <Select
          aria-label={t("canvas.common.blendMode")}
          disabled={contentDisabled}
          onChange={(value) => {
            onChange({
              ...node,
              blendMode: value,
            });
          }}
          options={blendModes.map((value) => ({
            value,
            label: t(`canvas.common.blendModes.${value}`),
          }))}
          variant="filled"
          value={node.blendMode}
        />
      </label>
    </div>
  );
}
