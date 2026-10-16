import { BoldOutlined, HighlightOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type RefObject,
  type ReactNode,
} from "react";

import type { CanvasTextInsertionOptionsV1 } from "./canvas-insertion-commands-v1.js";
import {
  canvasArtTextInsertionOptionsV1,
  searchCanvasTextCatalogV1,
} from "./canvas-left-panel-catalog-v1.js";
import {
  backIconSpec,
  CanvasPanelIcon,
  CanvasPanelSection,
  canvasCatalogDragPropsV1,
  searchIconSpec,
} from "./canvas-left-panel-shared-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import {
  canvasTextPresetCatalogV1,
  canvasTextPresetReferenceV1,
} from "./text-preset-catalog-v1.js";
import type { CanvasDocumentTextStyleV1 } from "./canvas-text-style-v1.js";
import type { CanvasWorkspaceArtTextPresetV1 } from "./canvas-art-text-resources.js";
import type { CanvasFontDefinitionV1 } from "./font-catalog-v1.js";

const recentPresetCount = 4;
const documentStylePreviewMaximumFontSize = 24;
const artTextIcon = HighlightOutlined;
const fontIcon = BoldOutlined;
const textPresetButtonClass =
  "min-h-[52px] overflow-hidden rounded-lg border-0 bg-transparent p-2 text-base text-[var(--ink)] transition-colors hover:bg-[#eeeeF1]";
const fontButtonClass =
  "grid min-h-[52px] gap-0.5 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left hover:bg-[#f4f3f8]";
type TextCatalogSourceV1 = "external" | "library";

function TextPanelSourceTabs({
  active,
  externalAvailable,
  libraryLabel,
  onChange,
  tabsRef,
}: {
  readonly active: TextCatalogSourceV1;
  readonly externalAvailable: boolean;
  readonly libraryLabel: string;
  readonly onChange: (source: TextCatalogSourceV1) => void;
  readonly tabsRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const tabClass =
    "relative min-h-10 border-0 border-b-2 bg-transparent px-2 text-sm font-semibold";
  return (
    <div
      aria-label={t("canvas.resourceCatalog.catalogSource")}
      className="sticky top-0 z-10 mb-4 grid grid-cols-2 bg-[var(--paper)]"
      ref={tabsRef}
      role="tablist"
    >
      <button
        aria-selected={active === "library"}
        className={`${tabClass} ${active === "library" ? "border-[var(--primary)] text-[var(--primary)]" : "border-[#e4e4e8] text-[var(--muted)]"}`}
        onClick={() => onChange("library")}
        role="tab"
        type="button"
      >
        {libraryLabel}
      </button>
      {externalAvailable ? (
        <button
          aria-selected={active === "external"}
          className={`${tabClass} ${active === "external" ? "border-[var(--primary)] text-[var(--primary)]" : "border-[#e4e4e8] text-[var(--muted)]"}`}
          onClick={() => onChange("external")}
          role="tab"
          type="button"
        >
          {t("canvas.resourceCatalog.external")}
        </button>
      ) : null}
    </div>
  );
}

function TextPanelSearch({
  autoFocus = false,
  onChange,
  placeholder,
  value,
}: {
  readonly autoFocus?: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly placeholder: string;
  readonly value: string;
}) {
  return (
    <Input
      allowClear
      autoFocus={autoFocus}
      className="mb-4"
      onChange={onChange}
      placeholder={placeholder}
      prefix={<CanvasPanelIcon icon={searchIconSpec} />}
      value={value}
      variant="filled"
    />
  );
}

function TextPanelBack({
  context,
  onClick,
}: {
  readonly context: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      block
      className="mb-3 justify-start rounded-lg bg-[var(--mist)] px-2.5 text-xs font-semibold"
      icon={<CanvasPanelIcon icon={backIconSpec} />}
      onClick={onClick}
      type="text"
    >
      <span>文字</span>
      <span className="ml-auto truncate font-normal text-[var(--muted)]">
        {context}
      </span>
    </Button>
  );
}

export function CanvasTextPanelV1({
  documentStyles,
  externalArtTextLibrary,
  externalFontLibrary,
  fontCatalog,
  fontCatalogError = false,
  onCatalogDragEnd,
  onCatalogDragStart,
  onInsertText,
  workspaceArtTextPresets,
}: {
  readonly documentStyles: readonly CanvasDocumentTextStyleV1[];
  readonly externalArtTextLibrary?: ReactNode;
  readonly externalFontLibrary?: ReactNode;
  readonly fontCatalog: readonly CanvasFontDefinitionV1[];
  readonly fontCatalogError?: boolean;
  readonly onCatalogDragEnd: () => void;
  readonly onCatalogDragStart: (payload: EditorNodeInsertionPayload) => void;
  readonly onInsertText: (options?: CanvasTextInsertionOptionsV1) => void;
  readonly workspaceArtTextPresets: readonly CanvasWorkspaceArtTextPresetV1[];
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<"art-text" | "fonts" | "home">("home");
  const [catalogSource, setCatalogSource] =
    useState<TextCatalogSourceV1>("library");
  const [query, setQuery] = useState("");
  const sourceTabsRef = useRef<HTMLDivElement>(null);
  const normalized = query.trim().toLowerCase();
  const { fonts, presets, workspacePresets } = useMemo(() => {
    const builtins = searchCanvasTextCatalogV1(normalized);
    return {
      fonts: fontCatalog.filter((font) =>
        `${font.label} ${font.family} ${font.id}`
          .toLowerCase()
          .includes(normalized),
      ),
      presets: builtins.presets,
      workspacePresets: workspaceArtTextPresets.filter((preset) =>
        `${preset.label} ${preset.id}`.toLowerCase().includes(normalized),
      ),
    };
  }, [fontCatalog, normalized, workspaceArtTextPresets]);
  const fontsById = useMemo(
    () => new Map(fontCatalog.map((font) => [font.id, font])),
    [fontCatalog],
  );
  const presetsById = useMemo(
    () =>
      new Map(canvasTextPresetCatalogV1.map((preset) => [preset.id, preset])),
    [],
  );
  const workspacePresetsById = useMemo(
    () => new Map(workspaceArtTextPresets.map((preset) => [preset.id, preset])),
    [workspaceArtTextPresets],
  );

  const changeQuery = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };
  const showHome = () => {
    setView("home");
    setQuery("");
  };
  const showArtText = () => {
    setCatalogSource("library");
    setView("art-text");
  };
  const showFonts = () => {
    setCatalogSource("library");
    setView("fonts");
  };
  useEffect(() => {
    if (view !== "home") {
      sourceTabsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [catalogSource, view]);
  const insertPreset = (preset: (typeof canvasTextPresetCatalogV1)[number]) => {
    onInsertText(canvasArtTextInsertionOptionsV1(preset.id));
  };
  const insertFont = (font: CanvasFontDefinitionV1) => {
    onInsertText({
      editImmediately: true,
      text: font.label,
      font: {
        family: font.family,
        fontId: font.id,
        revision: font.revision,
        source: font.source,
      },
    });
  };
  const insertWorkspacePreset = (preset: CanvasWorkspaceArtTextPresetV1) => {
    onInsertText({
      editImmediately: true,
      text: preset.label,
      style: preset.style,
    });
  };
  const insertBasicText = (text: string) => {
    onInsertText({
      editImmediately: true,
      text,
    });
  };
  const insertFontFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    const font = fontsById.get(event.currentTarget.dataset.fontId ?? "");
    if (font) insertFont(font);
  };
  const insertPresetFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    const preset = presetsById.get(event.currentTarget.dataset.presetId ?? "");
    if (preset) insertPreset(preset);
  };
  const insertWorkspacePresetFromButton = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const preset = workspacePresetsById.get(
      event.currentTarget.dataset.presetId ?? "",
    );
    if (preset) insertWorkspacePreset(preset);
  };
  const insertBasicTextFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    const text = event.currentTarget.dataset.text;
    if (text) insertBasicText(text);
  };

  if (view === "art-text") {
    return (
      <>
        <TextPanelBack context="艺术字" onClick={showHome} />
        <TextPanelSourceTabs
          active={catalogSource}
          externalAvailable={Boolean(externalArtTextLibrary)}
          libraryLabel={t("canvas.resourceCatalog.artTextLibrary")}
          onChange={setCatalogSource}
          tabsRef={sourceTabsRef}
        />
        {catalogSource === "external" ? (
          externalArtTextLibrary
        ) : (
          <>
            <TextPanelSearch
              onChange={changeQuery}
              placeholder="搜索艺术字"
              value={query}
            />
            <div className="grid grid-cols-2 gap-2">
              {workspacePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={textPresetButtonClass}
                  data-preset-id={preset.id}
                  {...canvasCatalogDragPropsV1(
                    {
                      kind: "text",
                      text: preset.label,
                      style: preset.style,
                    },
                    onCatalogDragStart,
                    onCatalogDragEnd,
                  )}
                  onClick={insertWorkspacePresetFromButton}
                  style={{
                    color:
                      preset.style.fill.kind === "solid"
                        ? preset.style.fill.color
                        : undefined,
                    fontFamily: preset.style.font.family,
                    fontWeight: preset.style.fontWeight,
                  }}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={textPresetButtonClass}
                  data-preset-id={preset.id}
                  {...canvasCatalogDragPropsV1(
                    {
                      kind: "text",
                      text: "设计标题",
                      preset: canvasTextPresetReferenceV1(preset.id),
                    },
                    onCatalogDragStart,
                    onCatalogDragEnd,
                  )}
                  onClick={insertPresetFromButton}
                  style={{
                    fontFamily:
                      fontsById.get(preset.fontId)?.family ?? "sans-serif",
                    fontWeight: preset.fontWeight,
                  }}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  if (view === "fonts") {
    return (
      <>
        <TextPanelBack context="字体" onClick={showHome} />
        <TextPanelSourceTabs
          active={catalogSource}
          externalAvailable={Boolean(externalFontLibrary)}
          libraryLabel={t("canvas.resourceCatalog.fontLibrary")}
          onChange={setCatalogSource}
          tabsRef={sourceTabsRef}
        />
        {catalogSource === "external" ? (
          externalFontLibrary
        ) : (
          <>
            <TextPanelSearch
              onChange={changeQuery}
              placeholder="搜索字体"
              value={query}
            />
            <div className="grid gap-1">
              {fonts.map((font) => (
                <button
                  key={font.id}
                  className={fontButtonClass}
                  data-font-id={font.id}
                  {...canvasCatalogDragPropsV1(
                    {
                      kind: "text",
                      text: font.label,
                      font: {
                        family: font.family,
                        fontId: font.id,
                        revision: font.revision,
                        source: font.source,
                      },
                    },
                    onCatalogDragStart,
                    onCatalogDragEnd,
                  )}
                  onClick={insertFontFromButton}
                  style={{ fontFamily: font.family }}
                  type="button"
                >
                  <strong className="text-[15px]">{font.label}</strong>
                  <small className="font-sans text-xs text-[#8a8b94]">
                    {font.family}
                  </small>
                </button>
              ))}
            </div>
            {fontCatalogError ? (
              <p className="mt-3 text-xs text-red-600">
                {t("canvas.resourceCatalog.fontLoadFailed")}
              </p>
            ) : null}
          </>
        )}
      </>
    );
  }

  if (normalized) {
    return (
      <>
        <TextPanelSearch
          autoFocus
          onChange={changeQuery}
          placeholder="搜索文字样式、艺术字或字体"
          value={query}
        />
        <CanvasPanelSection
          title={`艺术字 · ${String(presets.length + workspacePresets.length)}`}
        >
          <div className="grid grid-cols-2 gap-2">
            {workspacePresets.map((preset) => (
              <button
                key={preset.id}
                className={textPresetButtonClass}
                data-preset-id={preset.id}
                onClick={insertWorkspacePresetFromButton}
                style={{
                  color:
                    preset.style.fill.kind === "solid"
                      ? preset.style.fill.color
                      : undefined,
                  fontFamily: preset.style.font.family,
                  fontWeight: preset.style.fontWeight,
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
            {presets.map((preset) => (
              <button
                key={preset.id}
                className={textPresetButtonClass}
                data-preset-id={preset.id}
                onClick={insertPresetFromButton}
                style={{
                  fontFamily:
                    fontsById.get(preset.fontId)?.family ?? "sans-serif",
                  fontWeight: preset.fontWeight,
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </CanvasPanelSection>
        <CanvasPanelSection title={`字体 · ${String(fonts.length)}`}>
          <div className="grid gap-1">
            {fonts.map((font) => (
              <button
                key={font.id}
                className={fontButtonClass}
                data-font-id={font.id}
                onClick={insertFontFromButton}
                style={{ fontFamily: font.family }}
                type="button"
              >
                <strong className="text-[15px]">{font.label}</strong>
                <small className="font-sans text-xs text-[#8a8b94]">
                  {font.family}
                </small>
              </button>
            ))}
          </div>
        </CanvasPanelSection>
      </>
    );
  }

  return (
    <>
      <TextPanelSearch
        onChange={changeQuery}
        placeholder="搜索文字样式、艺术字或字体"
        value={query}
      />
      <CanvasPanelSection title="添加文字">
        <div className="grid overflow-hidden rounded-xl bg-[#f7f7f8] [&>button:not(:last-child)]:border-b [&>button:not(:last-child)]:border-[#e4e4e8]">
          <button
            {...canvasCatalogDragPropsV1(
              {
                kind: "text",
                text: "添加标题",
              },
              onCatalogDragStart,
              onCatalogDragEnd,
            )}
            className="min-h-[50px] border-0 bg-transparent px-3 py-2 text-left text-[19px] font-bold hover:bg-[#eeeeF1]"
            data-text="添加标题"
            onClick={insertBasicTextFromButton}
            type="button"
          >
            添加标题
          </button>
          <button
            className="min-h-[42px] border-0 bg-transparent px-3 py-2 text-left hover:bg-[#eeeeF1]"
            data-text="添加副标题"
            onClick={insertBasicTextFromButton}
            type="button"
          >
            添加副标题
          </button>
          <button
            {...canvasCatalogDragPropsV1(
              {
                kind: "text",
                text: "添加正文",
              },
              onCatalogDragStart,
              onCatalogDragEnd,
            )}
            className="min-h-[42px] border-0 bg-transparent px-3 py-2 text-left hover:bg-[#eeeeF1]"
            data-text="添加正文"
            onClick={insertBasicTextFromButton}
            type="button"
          >
            添加正文
          </button>
        </div>
      </CanvasPanelSection>
      <CanvasPanelSection title="浏览">
        <div className="grid grid-cols-2 divide-x divide-[#e4e4e8] overflow-hidden rounded-lg bg-[#f7f7f8]">
          <button
            className="flex min-h-11 items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-xs transition-colors hover:bg-[#eeeeF1] [&>svg]:text-lg [&>svg]:text-[var(--muted)]"
            onClick={showArtText}
            type="button"
          >
            <CanvasPanelIcon icon={artTextIcon} />
            <strong>艺术字</strong>
          </button>
          <button
            className="flex min-h-11 items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-xs transition-colors hover:bg-[#eeeeF1] [&>svg]:text-lg [&>svg]:text-[var(--muted)]"
            onClick={showFonts}
            type="button"
          >
            <CanvasPanelIcon icon={fontIcon} />
            <strong>字体</strong>
          </button>
        </div>
      </CanvasPanelSection>
      {documentStyles.length > 0 ? (
        <CanvasPanelSection title="文档文字样式">
          <div className="grid divide-y divide-[#e4e4e8] overflow-hidden rounded-lg bg-[#f7f7f8]">
            {documentStyles.map((style) => (
              <button
                className="min-h-12 border-0 bg-transparent px-3 py-2 text-left hover:bg-[#eeeef1]"
                key={style.id}
                onClick={() => {
                  onInsertText({
                    editImmediately: true,
                    text: "添加文字",
                    style: style.snapshot,
                  });
                }}
                style={{
                  color:
                    style.snapshot.fill.kind === "solid"
                      ? style.snapshot.fill.color
                      : "#151515",
                  fontFamily: style.snapshot.font.family,
                  fontSize: Math.min(
                    style.snapshot.fontSize,
                    documentStylePreviewMaximumFontSize,
                  ),
                  fontStyle: style.snapshot.fontStyle,
                  fontWeight: style.snapshot.fontWeight,
                  letterSpacing: style.snapshot.letterSpacing,
                }}
                type="button"
              >
                <strong className="block truncate">{style.label}</strong>
              </button>
            ))}
          </div>
        </CanvasPanelSection>
      ) : null}
      <CanvasPanelSection title="最近艺术字">
        <div className="grid divide-y divide-[#e4e4e8]">
          {workspaceArtTextPresets.slice(0, recentPresetCount).map((preset) => (
            <button
              key={preset.id}
              className="min-h-11 border-0 bg-transparent px-1 text-left text-base text-[var(--ink)] transition-colors hover:bg-[#eeeef1]"
              data-preset-id={preset.id}
              onClick={insertWorkspacePresetFromButton}
              style={{
                color:
                  preset.style.fill.kind === "solid"
                    ? preset.style.fill.color
                    : undefined,
                fontFamily: preset.style.font.family,
                fontWeight: preset.style.fontWeight,
              }}
              type="button"
            >
              {preset.label}
            </button>
          ))}
          {canvasTextPresetCatalogV1
            .slice(0, recentPresetCount)
            .map((preset) => (
              <button
                key={preset.id}
                className="min-h-11 border-0 bg-transparent px-1 text-left text-base text-[var(--ink)] transition-colors hover:bg-[#eeeef1]"
                data-preset-id={preset.id}
                onClick={insertPresetFromButton}
                style={{
                  fontFamily:
                    fontsById.get(preset.fontId)?.family ?? "sans-serif",
                  fontWeight: preset.fontWeight,
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
        </div>
      </CanvasPanelSection>
    </>
  );
}
