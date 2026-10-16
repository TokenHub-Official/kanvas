import type { EditorTextEffectV1 } from "@kanvas/contracts/editor";
import {
  BorderOutlined,
  BulbOutlined,
  HighlightOutlined,
} from "@ant-design/icons";
import { Segmented, Switch } from "antd";
import { useTranslation } from "react-i18next";

import { CanvasColorPickerV1 } from "./canvas-color-picker-v1.js";
import { CanvasInspectorRangeFieldV1 } from "./canvas-inspector-controls-v1.js";
import {
  canvasTextFormattingV1,
  updateCanvasTextEffectV1,
  updateCanvasTextParagraphsV1,
  updateCanvasTextRunsV1,
  updateCanvasTextVerticalAlignV1,
} from "./canvas-text-formatting-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const LINE_HEIGHT_MAX = 3;
const LINE_HEIGHT_STEP = 0.05;
const LETTER_SPACING_MIN = -20;
const TEXT_SPACING_MAX = 120;
const EFFECT_BLUR_MAX = 48;
const EFFECT_OFFSET_MIN = -64;
const EFFECT_OFFSET_MAX = 64;
const EFFECT_OPACITY_STEP = 0.01;

export function TextSpacingInspectorV1({
  disabled,
  node,
  onChange,
  onPreview,
  onPreviewCommit,
}: {
  readonly disabled: boolean;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "text" }>;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
}) {
  const { t } = useTranslation();
  const formatting = canvasTextFormattingV1(node);
  const numericControls = [
    ["lineHeight", 0.5, LINE_HEIGHT_MAX, LINE_HEIGHT_STEP],
    ["letterSpacing", LETTER_SPACING_MIN, TEXT_SPACING_MAX, 1],
    ["spaceBefore", 0, TEXT_SPACING_MAX, 1],
    ["spaceAfter", 0, TEXT_SPACING_MAX, 1],
  ] as const;
  return (
    <div className="grid gap-5">
      <div className="grid gap-5">
        {numericControls.map(([key, minimum, maximum, step]) => {
          const value = formatting[key];
          return (
            <CanvasInspectorRangeFieldV1
              disabled={disabled}
              formatValue={(nextValue) =>
                key === "lineHeight"
                  ? nextValue.toFixed(2)
                  : String(Math.round(nextValue))
              }
              key={key}
              label={t(`canvas.text.controls.${key}`)}
              maximum={maximum}
              minimum={minimum}
              onChange={(nextValue) => {
                onPreview(
                  key === "letterSpacing"
                    ? updateCanvasTextRunsV1(node, {
                        letterSpacing: nextValue,
                      })
                    : updateCanvasTextParagraphsV1(node, {
                        [key]: nextValue,
                      }),
                );
              }}
              onCommit={onPreviewCommit}
              step={step}
              value={value}
            />
          );
        })}
      </div>
      <div className="grid gap-2">
        <span className="text-xs font-bold text-[var(--ink)]">
          {t("canvas.text.verticalAlign")}
        </span>
        <Segmented
          aria-label={t("canvas.text.verticalAlignGroup")}
          block
          disabled={disabled}
          onChange={(value) => {
            onChange(updateCanvasTextVerticalAlignV1(node, value));
          }}
          options={(["top", "middle", "bottom"] as const).map((value) => ({
            label: t(`canvas.text.vertical.${value}`),
            value,
          }))}
          size="small"
          value={formatting.verticalAlign}
        />
      </div>
    </div>
  );
}

export function TextEffectsInspectorV1({
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
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "text" }>;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const outline = node.effects.find(
    (effect): effect is Extract<EditorTextEffectV1, { kind: "outline" }> =>
      effect.kind === "outline",
  );
  const shadow = node.effects.find(
    (effect): effect is Extract<EditorTextEffectV1, { kind: "shadow" }> =>
      effect.kind === "shadow",
  );
  const glow = node.effects.find(
    (effect): effect is Extract<EditorTextEffectV1, { kind: "glow" }> =>
      effect.kind === "glow",
  );
  const replaceEffect = (
    kind: EditorTextEffectV1["kind"],
    next: EditorTextEffectV1 | undefined,
  ) => {
    onChange(updateCanvasTextEffectV1(node, kind, next));
  };
  const previewEffect = (
    kind: EditorTextEffectV1["kind"],
    next: EditorTextEffectV1,
  ) => {
    onPreview(updateCanvasTextEffectV1(node, kind, next));
  };
  const effectRows = [
    {
      active: Boolean(outline),
      description: t("canvas.text.effects.outlineDescription"),
      icon: <BorderOutlined aria-hidden="true" />,
      kind: "outline" as const,
      next: outline
        ? undefined
        : ({
            kind: "outline",
            color: "#151515",
            width: 4,
          } satisfies EditorTextEffectV1),
      title: t("canvas.text.effects.outline"),
    },
    {
      active: Boolean(shadow),
      description: t("canvas.text.effects.shadowDescription"),
      icon: <HighlightOutlined aria-hidden="true" />,
      kind: "shadow" as const,
      next: shadow
        ? undefined
        : ({
            kind: "shadow",
            color: "#151515",
            blur: 12,
            offsetX: 4,
            offsetY: 6,
            opacity: 0.45,
          } satisfies EditorTextEffectV1),
      title: t("canvas.text.effects.shadow"),
    },
    {
      active: Boolean(glow),
      description: t("canvas.text.effects.glowDescription"),
      icon: <BulbOutlined aria-hidden="true" />,
      kind: "glow" as const,
      next: glow
        ? undefined
        : ({
            kind: "glow",
            color: "#3048f5",
            blur: 18,
            opacity: 0.65,
          } satisfies EditorTextEffectV1),
      title: t("canvas.text.effects.glow"),
    },
  ];
  const colorControl = (
    label: string,
    color: string,
    onColor: (color: string) => void,
  ) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
      <CanvasColorPickerV1
        ariaLabel={label}
        color={color}
        documentColors={documentColors}
        onChange={onColor}
        onCommit={onPreviewCommit}
        side="left"
        workspaceId={workspaceId}
      />
    </div>
  );
  return (
    <div className="grid gap-4">
      <div
        aria-label={t("canvas.text.effectsGroup")}
        className="grid divide-y divide-[var(--canvas-panel-line)] overflow-hidden rounded-xl border border-[var(--canvas-panel-line)] bg-[var(--paper)]"
        role="group"
      >
        {effectRows.map((row) => (
          <label
            className="flex min-h-14 items-center gap-3 px-3 py-2.5"
            key={row.kind}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--mist)] text-base text-[var(--ink)]">
              {row.icon}
            </span>
            <span className="grid min-w-0 flex-1 text-left">
              <strong className="text-sm font-semibold">{row.title}</strong>
              <small className="truncate text-xs text-[var(--muted)]">
                {row.description}
              </small>
            </span>
            <Switch
              aria-label={row.title}
              checked={row.active}
              disabled={disabled}
              onChange={() => {
                replaceEffect(row.kind, row.next);
              }}
              size="small"
            />
          </label>
        ))}
      </div>
      {outline ? (
        <section className="grid gap-4 rounded-xl bg-[var(--mist)]/70 p-3">
          {colorControl(
            t("canvas.text.effects.effectColor", {
              effect: t("canvas.text.effects.outline"),
            }),
            outline.color,
            (color) => previewEffect("outline", { ...outline, color }),
          )}
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            label={t("canvas.text.effects.outlineWidth")}
            maximum={24}
            minimum={0}
            onChange={(value) => {
              previewEffect("outline", {
                ...outline,
                width: value,
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={outline.width}
          />
        </section>
      ) : null}
      {shadow ? (
        <section className="grid gap-4 rounded-xl bg-[var(--mist)]/70 p-3">
          {colorControl(
            t("canvas.text.effects.effectColor", {
              effect: t("canvas.text.effects.shadow"),
            }),
            shadow.color,
            (color) => previewEffect("shadow", { ...shadow, color }),
          )}
          {(
            [
              ["shadowBlur", "blur", 0, EFFECT_BLUR_MAX, 1],
              ["offsetX", "offsetX", EFFECT_OFFSET_MIN, EFFECT_OFFSET_MAX, 1],
              ["offsetY", "offsetY", EFFECT_OFFSET_MIN, EFFECT_OFFSET_MAX, 1],
              ["opacity", "opacity", 0, 1, EFFECT_OPACITY_STEP],
            ] as const
          ).map(([label, key, minimum, maximum, step]) => (
            <CanvasInspectorRangeFieldV1
              disabled={disabled}
              key={key}
              {...(key === "opacity"
                ? {
                    formatValue: (value: number) =>
                      `${String(Math.round(value * 100))}%`,
                  }
                : {})}
              label={t(`canvas.text.effects.${label}`)}
              maximum={maximum}
              minimum={minimum}
              onChange={(value) => {
                previewEffect("shadow", { ...shadow, [key]: value });
              }}
              onCommit={onPreviewCommit}
              step={step}
              value={shadow[key]}
            />
          ))}
        </section>
      ) : null}
      {glow ? (
        <section className="grid gap-4 rounded-xl bg-[var(--mist)]/70 p-3">
          {colorControl(
            t("canvas.text.effects.effectColor", {
              effect: t("canvas.text.effects.glow"),
            }),
            glow.color,
            (color) => previewEffect("glow", { ...glow, color }),
          )}
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            label={t("canvas.text.effects.glowRange")}
            maximum={64}
            minimum={0}
            onChange={(value) => {
              previewEffect("glow", {
                ...glow,
                blur: value,
              });
            }}
            onCommit={onPreviewCommit}
            step={1}
            value={glow.blur}
          />
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            formatValue={(value) => `${String(Math.round(value * 100))}%`}
            label={t("canvas.text.effects.opacity")}
            maximum={1}
            minimum={0}
            onChange={(value) => {
              previewEffect("glow", {
                ...glow,
                opacity: value,
              });
            }}
            onCommit={onPreviewCommit}
            step={0.01}
            value={glow.opacity}
          />
        </section>
      ) : null}
    </div>
  );
}
