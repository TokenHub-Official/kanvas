import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";

import { KanvasSelect } from "../../components/kanvas-select.js";
import { canvasFontCatalogV1 } from "./font-catalog-v1.js";
import type { CanvasFontDefinitionV1 } from "./font-catalog-v1.js";
import { stopCanvasChromeWheelV1 } from "./canvas-interaction-boundary-v1.js";
import {
  addRecentCanvasFontV1,
  readRecentCanvasFontsV1,
  saveRecentCanvasFontsV1,
} from "./canvas-font-history-v1.js";

const FONT_MENU_HEIGHT = 256;
export function CanvasFontSelectV1({
  onChange,
  documentFontIds,
  fonts = canvasFontCatalogV1,
  value,
  workspaceId,
}: {
  readonly documentFontIds: readonly string[];
  readonly fonts?: readonly CanvasFontDefinitionV1[];
  readonly onChange: (fontId: string) => void;
  readonly value: string;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const [recentFontIds, setRecentFontIds] = useState<readonly string[]>(() =>
    readRecentCanvasFontsV1(workspaceId),
  );
  const canvasFontsById = useMemo(
    () => new Map(fonts.map((font) => [font.id, font])),
    [fonts],
  );
  const orderedFonts = useMemo(() => {
    const ids = new Set([...recentFontIds, ...documentFontIds]);
    return [
      ...[...ids].flatMap((id) => {
        const font = canvasFontsById.get(id);
        return font ? [font] : [];
      }),
      ...fonts.filter((font) => !ids.has(font.id)),
    ];
  }, [canvasFontsById, documentFontIds, fonts, recentFontIds]);
  const missing = !canvasFontsById.has(value);
  return (
    <KanvasSelect
      aria-label={t("canvas.editor.font")}
      className="w-[132px] !bg-[var(--mist)] !shadow-none"
      labelRender={({ value: selectedValue }) => {
        const font = canvasFontsById.get(String(selectedValue));
        return (
          <span className="block truncate" style={{ fontFamily: font?.family }}>
            {font?.label ??
              t("canvas.text.missingFont", { font: selectedValue })}
          </span>
        );
      }}
      listHeight={FONT_MENU_HEIGHT}
      onChange={(fontId) => {
        const value = String(fontId);
        const recent = addRecentCanvasFontV1(recentFontIds, value);
        setRecentFontIds(recent);
        saveRecentCanvasFontsV1(workspaceId, recent);
        onChange(value);
      }}
      optionFilterProp="label"
      optionRender={(option) => {
        const font = canvasFontsById.get(String(option.value));
        return (
          <span
            className="block truncate text-sm leading-6"
            style={{ fontFamily: font?.family }}
          >
            {font?.label ??
              (typeof option.label === "string" ? option.label : "")}
          </span>
        );
      }}
      options={[
        ...(missing
          ? [
              {
                disabled: true,
                label: t("canvas.text.missingFont", { font: value }),
                value,
              },
            ]
          : []),
        ...orderedFonts.map((font) => ({
          label: font.label,
          value: font.id,
        })),
      ]}
      popupMatchSelectWidth={288}
      popupRender={(menu) => (
        <div
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
          data-canvas-wheel-owner=""
          onWheel={stopCanvasChromeWheelV1}
        >
          {menu}
        </div>
      )}
      showSearch
      size="small"
      value={value}
    />
  );
}
