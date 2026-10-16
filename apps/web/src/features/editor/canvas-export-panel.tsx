import type {
  CanvasExportFormat,
  WorkspaceAssetSummary,
} from "@kanvas/contracts/api";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Alert, Button, Checkbox, InputNumber, Select, Slider } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  WorkspaceAssetPicker,
  type WorkspaceAssetPickResult,
} from "../assets/workspace-asset-picker.js";

export interface CanvasExportPageView {
  readonly height: number;
  readonly id: string;
  readonly name: string;
  readonly transparentBackground: boolean;
  readonly width: number;
}

export type CanvasExportDestination =
  "download" | "existing_asset" | "new_asset";

export type CanvasExportPhase =
  | "committing"
  | "error"
  | "idle"
  | "preparing"
  | "rendering"
  | "success"
  | "uploading";

export interface CanvasExportSettings {
  readonly destination: CanvasExportDestination;
  readonly format: CanvasExportFormat;
  readonly quality: number;
  readonly scale: 1 | 2 | "custom";
  readonly customWidth: number;
  readonly transparentBackground: boolean;
}

export interface CanvasExportResultView {
  readonly exportSessionId?: string;
  readonly artifactId: string;
  readonly assetId?: string;
  readonly assetVersion?: number;
  readonly filename: string;
  readonly pageName: string;
}

const MIN_CUSTOM_EXPORT_WIDTH = 64;
const MAX_CUSTOM_EXPORT_WIDTH = 32_768;
const PERCENT_SCALE = 100;
const exportPanelClassName =
  "fixed top-[calc(var(--canvas-v1-topbar-height)_+_10px)] right-3.5 z-[80] flex max-h-[calc(100vh_-_var(--canvas-v1-topbar-height)_-_24px)] w-[min(390px,calc(100vw_-_28px))] flex-col overflow-hidden rounded-[18px] border border-[rgb(28_31_43_/_10%)] bg-white/98 text-[var(--ink)] shadow-[0_24px_70px_rgb(25_29_45_/_22%),0_4px_18px_rgb(25_29_45_/_10%)]";
const exportHeaderClassName =
  "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[var(--line)] py-2 pr-2.5 pl-[18px]";
const exportFieldsetClassName =
  "m-0 min-w-0 border-0 border-b border-[var(--line)] px-0 py-4 last:border-b-0 [&>legend]:mb-2.5 [&>legend]:w-full [&>legend]:p-0 [&>legend]:text-[13px] [&>legend]:font-bold";
const exportNoteClassName = "mt-[9px] mb-0 text-xs text-[var(--muted)]";
const exportResultListClassName =
  "grid w-full max-h-60 gap-1.5 overflow-y-auto [&>div]:grid [&>div]:min-h-12 [&>div]:grid-cols-[minmax(0,1fr)_auto] [&>div]:items-center [&>div]:gap-2 [&>div]:rounded-[10px] [&>div]:border [&>div]:border-[var(--line)] [&>div]:py-1.5 [&>div]:pr-[7px] [&>div]:pl-[11px] [&_span]:grid [&_span]:min-w-0 [&_span]:gap-0.5 [&_strong]:truncate [&_strong]:text-xs [&_small]:truncate [&_small]:text-xs [&_small]:text-[var(--muted)]";

function phaseLabel(
  phase: CanvasExportPhase,
  progress: number,
  t: TFunction,
): string {
  if (phase === "preparing") {
    return t("canvas.exportPanel.preparing");
  }
  if (phase === "rendering") {
    return t("canvas.exportPanel.rendering");
  }
  if (phase === "uploading") {
    return t("canvas.exportPanel.uploading", { progress });
  }
  if (phase === "committing") {
    return t("canvas.exportPanel.committing");
  }
  return "";
}

export function CanvasExportPanel({
  activePageId,
  brandName,
  canDownload,
  canExport,
  canViewAssets,
  error,
  existingAsset,
  onCancel,
  onClose,
  onDownload,
  onExistingAssetChange,
  onRetry,
  onRun,
  onSelectedPageIdsChange,
  onSettingsChange,
  onViewAssets,
  pages,
  phase,
  progress,
  results,
  retryable,
  selectedPageIds,
  settings,
  workspaceId,
}: {
  readonly activePageId: string;
  readonly brandName?: string;
  readonly canDownload: boolean;
  readonly canExport: boolean;
  readonly canViewAssets: boolean;
  readonly error?: string;
  readonly existingAsset?: WorkspaceAssetSummary;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly onDownload: (result: CanvasExportResultView) => void;
  readonly onExistingAssetChange: (
    asset: WorkspaceAssetSummary | undefined,
  ) => void;
  readonly onRetry: () => void;
  readonly onRun: () => void;
  readonly onSelectedPageIdsChange: (pageIds: readonly string[]) => void;
  readonly onSettingsChange: (settings: CanvasExportSettings) => void;
  readonly onViewAssets: (assetId?: string) => void;
  readonly pages: readonly CanvasExportPageView[];
  readonly phase: CanvasExportPhase;
  readonly progress: number;
  readonly results: readonly CanvasExportResultView[];
  readonly retryable: boolean;
  readonly selectedPageIds: readonly string[];
  readonly settings: CanvasExportSettings;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const [choosingAsset, setChoosingAsset] = useState(false);
  const busy =
    phase === "preparing" ||
    phase === "rendering" ||
    phase === "uploading" ||
    phase === "committing";
  const selectedPages = pages.filter((page) =>
    selectedPageIds.includes(page.id),
  );
  const sourcePage =
    selectedPages[0] ??
    pages.find((page) => page.id === activePageId) ??
    pages[0];
  let outputWidth = 0;
  if (sourcePage) {
    outputWidth =
      settings.scale === "custom"
        ? Math.max(MIN_CUSTOM_EXPORT_WIDTH, settings.customWidth)
        : sourcePage.width * settings.scale;
  }
  const outputHeight = sourcePage
    ? Math.round(outputWidth * (sourcePage.height / sourcePage.width))
    : 0;
  const customWidthValid =
    settings.scale !== "custom" ||
    (Number.isInteger(settings.customWidth) &&
      settings.customWidth >= MIN_CUSTOM_EXPORT_WIDTH &&
      settings.customWidth <= MAX_CUSTOM_EXPORT_WIDTH);
  const mixedPageSizes =
    selectedPages.length > 1 &&
    selectedPages.some(
      (page) =>
        page.width !== selectedPages[0]?.width ||
        page.height !== selectedPages[0]?.height,
    );
  const hasTransparentPage = selectedPages.some(
    (page) => page.transparentBackground,
  );
  const canRun =
    canExport &&
    selectedPages.length > 0 &&
    customWidthValid &&
    (settings.destination !== "download" || canDownload) &&
    (settings.destination !== "existing_asset" ||
      (selectedPages.length === 1 && Boolean(existingAsset)));
  let successTitle = t("canvas.exportPanel.assetUpdated");
  let runLabel = t("canvas.exportPanel.updateAsset");
  if (settings.destination === "download") {
    successTitle = t("canvas.exportPanel.complete");
    runLabel = t("canvas.exportPanel.downloadAction");
  } else if (settings.destination === "new_asset") {
    successTitle = t("canvas.exportPanel.saved");
    runLabel = t("canvas.exportPanel.saveAction");
  }
  const fileCountSuffix =
    selectedPages.length > 1
      ? t("canvas.exportPanel.fileCountSuffix", { count: selectedPages.length })
      : "";
  let customSizeHelp = `${String(outputWidth)} × ${String(outputHeight)} px${fileCountSuffix}`;
  if (!customWidthValid) {
    customSizeHelp = t("canvas.exportPanel.widthRange", {
      min: MIN_CUSTOM_EXPORT_WIDTH,
      max: MAX_CUSTOM_EXPORT_WIDTH,
    });
  } else if (mixedPageSizes) {
    customSizeHelp = t("canvas.exportPanel.mixedSizes", {
      count: selectedPages.length,
    });
  }

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    panelRef.current
      ?.querySelector<HTMLElement>("[data-export-heading]")
      ?.focus();
    return () => {
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>("[data-export-heading]")
      ?.focus();
  }, [choosingAsset]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const focusable = [
          ...(panelRef.current?.querySelectorAll<HTMLElement>(
            '[data-export-heading], button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? []),
        ].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (choosingAsset) {
        setChoosingAsset(false);
      } else if (!busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [busy, choosingAsset, onClose]);

  function returnToExportSettings(): void {
    setChoosingAsset(false);
  }

  function selectExistingAsset(
    assets: readonly WorkspaceAssetSummary[],
  ): Promise<WorkspaceAssetPickResult> {
    const asset = assets[0];
    if (!asset) {
      return Promise.resolve({
        failed: [],
        succeededIds: [],
      });
    }
    onExistingAssetChange(asset);
    setChoosingAsset(false);
    return Promise.resolve({
      failed: [],
      succeededIds: [asset.id],
    });
  }

  function updatePageSelection(pageId: string, checked: boolean): void {
    if (settings.destination === "existing_asset") {
      onSelectedPageIdsChange([pageId]);
      return;
    }
    onSelectedPageIdsChange(
      checked
        ? [...selectedPageIds, pageId]
        : selectedPageIds.filter((id) => id !== pageId),
    );
  }

  function selectExistingAssetDestination(): void {
    onSelectedPageIdsChange([selectedPageIds[0] ?? activePageId]);
    onSettingsChange({
      ...settings,
      destination: "existing_asset",
    });
  }

  if (choosingAsset) {
    return (
      <section
        aria-labelledby="canvas-export-asset-title"
        aria-modal="true"
        className={`${exportPanelClassName} h-[min(680px,calc(100vh_-_var(--canvas-v1-topbar-height)_-_24px))] [&>.asset-picker]:min-h-0 [&>.asset-picker]:flex-1 [&>.asset-picker]:overflow-y-auto [&>.asset-picker]:px-3.5 [&>.asset-picker]:pt-2.5 [&>.asset-picker]:pb-4`}
        ref={panelRef}
        role="dialog"
      >
        <header className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-[var(--line)] py-2 pr-2.5 pl-2">
          <Button
            aria-label={t("canvas.exportPanel.back")}
            icon={<ArrowLeftOutlined aria-hidden="true" />}
            onClick={returnToExportSettings}
            shape="circle"
            type="text"
          />
          <h2
            className="m-0 truncate text-[15px] font-bold tracking-[-0.01em]"
            data-export-heading
            id="canvas-export-asset-title"
            tabIndex={-1}
          >
            {t("canvas.exportPanel.chooseUpdate")}
          </h2>
          <Button
            aria-label={t("canvas.exportPanel.close")}
            icon={<CloseOutlined aria-hidden="true" />}
            onClick={onClose}
            shape="circle"
            type="text"
          />
        </header>
        <WorkspaceAssetPicker
          allowBatch={false}
          canEdit={!busy}
          importing={false}
          mode="library"
          onPickAssets={selectExistingAsset}
          onUploadFiles={() => undefined}
          workspaceId={workspaceId}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="canvas-export-title"
      aria-modal="true"
      className={exportPanelClassName}
      ref={panelRef}
      role="dialog"
    >
      <header className={exportHeaderClassName}>
        <h2
          className="m-0 truncate text-[15px] font-bold tracking-[-0.01em]"
          data-export-heading
          id="canvas-export-title"
          tabIndex={-1}
        >
          {t("canvas.exportPanel.title")}
        </h2>
        <Button
          aria-label={t("canvas.exportPanel.close")}
          disabled={busy}
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={onClose}
          shape="circle"
          type="text"
        />
      </header>

      <div className="mx-[18px] mt-4 flex items-center justify-between gap-3 rounded-[11px] bg-mist px-3 py-2.5 text-xs">
        <span className="font-semibold text-muted">
          {t("canvas.exportPanel.brand")}
        </span>
        <strong className="truncate text-ink">
          {brandName ?? t("canvas.exportPanel.noBrand")}
        </strong>
      </div>

      {phase === "success" ? (
        <div className="flex min-h-[280px] flex-col items-center gap-2.5 px-[18px] pt-7 pb-[18px]">
          <span className="grid size-10 place-items-center rounded-full bg-[var(--positive-surface)] text-[var(--positive)]">
            <CheckOutlined aria-hidden="true" />
          </span>
          <strong className="text-[15px]">{successTitle}</strong>
          {settings.destination === "existing_asset" ? (
            <p className={exportNoteClassName}>
              {results[0]?.assetVersion
                ? t("canvas.exportPanel.currentVersionNumberSet", {
                    version: results[0].assetVersion,
                  })
                : t("canvas.exportPanel.currentVersionSet")}
            </p>
          ) : null}
          {results.some((result) => result.assetId) && canViewAssets ? (
            <Button
              onClick={() => {
                onViewAssets(results.find((result) => result.assetId)?.assetId);
              }}
            >
              {t("canvas.exportPanel.viewAsset")}
            </Button>
          ) : null}
          <div className={`${exportResultListClassName} my-2`}>
            {results.map((result) => (
              <div key={result.artifactId}>
                <span>
                  <strong>{result.pageName}</strong>
                  <small>{result.filename}</small>
                </span>
                {canDownload ? (
                  <Button
                    aria-label={t("canvas.exportPanel.downloadPage", {
                      name: result.pageName,
                    })}
                    icon={<DownloadOutlined aria-hidden="true" />}
                    onClick={() => {
                      onDownload(result);
                    }}
                    shape="circle"
                    size="small"
                    type="text"
                  />
                ) : null}
              </div>
            ))}
          </div>
          {error ? (
            <Alert className="w-full" showIcon type="error" title={error} />
          ) : null}
          <Button block className="mt-auto" onClick={onClose} type="primary">
            {t("canvas.exportPanel.done")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-[18px] pt-1 pb-[18px]">
            <fieldset className={exportFieldsetClassName}>
              <legend>{t("canvas.exportPanel.pages")}</legend>
              <div className="mb-2 flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    onSelectedPageIdsChange([activePageId]);
                  }}
                  size="small"
                >
                  {t("canvas.exportPanel.currentPage")}
                </Button>
                <Button
                  disabled={busy || settings.destination === "existing_asset"}
                  onClick={() => {
                    onSelectedPageIdsChange(pages.map((page) => page.id));
                  }}
                  size="small"
                >
                  {t("canvas.exportPanel.all")}
                </Button>
              </div>
              <div className="grid max-h-[142px] gap-0.5 overflow-y-auto">
                {pages.map((page, index) => (
                  <label
                    className="grid min-h-[34px] grid-cols-[auto_22px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-[13px] hover:bg-[var(--mist)]"
                    key={page.id}
                  >
                    <Checkbox
                      checked={selectedPageIds.includes(page.id)}
                      disabled={busy}
                      onChange={(event) => {
                        updatePageSelection(page.id, event.target.checked);
                      }}
                    />
                    <span className="text-center text-xs text-[var(--muted)]">
                      {index + 1}
                    </span>
                    <span className="truncate">{page.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={exportFieldsetClassName}>
              <legend>{t("canvas.exportPanel.format")}</legend>
              <Select<CanvasExportFormat>
                aria-label={t("canvas.exportPanel.formatLabel")}
                className="w-full"
                disabled={busy}
                onChange={(format) => {
                  onSettingsChange({
                    ...settings,
                    format,
                    transparentBackground:
                      format === "jpeg"
                        ? false
                        : settings.transparentBackground,
                  });
                }}
                options={[
                  { label: "PNG", value: "png" },
                  { label: "JPEG", value: "jpeg" },
                  { label: "WebP", value: "webp" },
                ]}
                value={settings.format}
                variant="filled"
              />
              {settings.format !== "png" ? (
                <label className="mt-2.5 grid min-h-[38px] grid-cols-[auto_minmax(0,1fr)_30px] items-center gap-2.5 text-xs text-[var(--muted)]">
                  <span>{t("canvas.exportPanel.quality")}</span>
                  <Slider
                    disabled={busy}
                    max={PERCENT_SCALE}
                    min={10}
                    onChange={(quality) => {
                      onSettingsChange({
                        ...settings,
                        quality: quality / PERCENT_SCALE,
                      });
                    }}
                    tooltip={{ open: false }}
                    value={Math.round(settings.quality * PERCENT_SCALE)}
                  />
                  <output className="text-right text-[var(--ink)] tabular-nums">
                    {Math.round(settings.quality * PERCENT_SCALE)}
                  </output>
                </label>
              ) : null}
              {settings.format !== "jpeg" ? (
                <Checkbox
                  className="mt-2"
                  checked={settings.transparentBackground && hasTransparentPage}
                  disabled={busy || !hasTransparentPage}
                  onChange={(event) => {
                    onSettingsChange({
                      ...settings,
                      transparentBackground: event.target.checked,
                    });
                  }}
                >
                  {t("canvas.exportPanel.transparent")}
                </Checkbox>
              ) : (
                <p className={exportNoteClassName}>
                  {t("canvas.exportPanel.jpegBackground")}
                </p>
              )}
              {settings.format !== "jpeg" && !hasTransparentPage ? (
                <p className={exportNoteClassName}>
                  {t("canvas.exportPanel.opaqueBackground")}
                </p>
              ) : null}
            </fieldset>

            <fieldset className={exportFieldsetClassName}>
              <legend>{t("canvas.exportPanel.size")}</legend>
              <Select<CanvasExportSettings["scale"]>
                aria-label={t("canvas.exportPanel.sizeLabel")}
                className="w-full"
                disabled={busy}
                onChange={(scale) => {
                  onSettingsChange({
                    ...settings,
                    scale,
                    customWidth: sourcePage?.width ?? settings.customWidth,
                  });
                }}
                options={[
                  { label: "1×", value: 1 },
                  { label: "2×", value: 2 },
                  { label: t("canvas.exportPanel.custom"), value: "custom" },
                ]}
                value={settings.scale}
                variant="filled"
              />
              {settings.scale === "custom" ? (
                <label className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs text-[var(--muted)]">
                  <span>{t("canvas.exportPanel.width")}</span>
                  <InputNumber
                    aria-describedby="canvas-export-custom-size-help"
                    aria-invalid={!customWidthValid}
                    className="w-full"
                    controls={false}
                    disabled={busy}
                    max={MAX_CUSTOM_EXPORT_WIDTH}
                    min={MIN_CUSTOM_EXPORT_WIDTH}
                    onChange={(customWidth) => {
                      if (customWidth !== null) {
                        onSettingsChange({
                          ...settings,
                          customWidth,
                        });
                      }
                    }}
                    value={settings.customWidth}
                    variant="filled"
                  />
                  <span>px</span>
                </label>
              ) : null}
              <p
                className={
                  customWidthValid
                    ? `${exportNoteClassName} tabular-nums`
                    : "mt-[9px] mb-0 text-xs text-[var(--danger)]"
                }
                id="canvas-export-custom-size-help"
              >
                {customSizeHelp}
              </p>
            </fieldset>

            <fieldset className={exportFieldsetClassName}>
              <legend>{t("canvas.exportPanel.destination")}</legend>
              <div className="grid gap-[7px]">
                {canDownload ? (
                  <Button
                    aria-pressed={settings.destination === "download"}
                    block
                    className="justify-start"
                    color={
                      settings.destination === "download"
                        ? "primary"
                        : "default"
                    }
                    disabled={busy}
                    icon={<DownloadOutlined aria-hidden="true" />}
                    onClick={() => {
                      onSettingsChange({
                        ...settings,
                        destination: "download",
                      });
                    }}
                    variant={
                      settings.destination === "download"
                        ? "filled"
                        : "outlined"
                    }
                  >
                    {t("canvas.exportPanel.download")}
                  </Button>
                ) : null}
                <Button
                  aria-pressed={settings.destination === "new_asset"}
                  block
                  className="justify-start"
                  color={
                    settings.destination === "new_asset" ? "primary" : "default"
                  }
                  disabled={busy}
                  icon={<FolderOpenOutlined aria-hidden="true" />}
                  onClick={() => {
                    onSettingsChange({
                      ...settings,
                      destination: "new_asset",
                    });
                  }}
                  variant={
                    settings.destination === "new_asset" ? "filled" : "outlined"
                  }
                >
                  {t("canvas.exportPanel.saveAsset")}
                </Button>
                <Button
                  aria-pressed={settings.destination === "existing_asset"}
                  block
                  className="justify-start"
                  color={
                    settings.destination === "existing_asset"
                      ? "primary"
                      : "default"
                  }
                  disabled={busy}
                  icon={<ReloadOutlined aria-hidden="true" />}
                  onClick={selectExistingAssetDestination}
                  variant={
                    settings.destination === "existing_asset"
                      ? "filled"
                      : "outlined"
                  }
                >
                  {t("canvas.exportPanel.existingAsset")}
                </Button>
              </div>
              {settings.destination === "existing_asset" ? (
                <Button
                  block
                  className="mt-2.5 h-auto min-h-11 justify-between py-2 text-left"
                  disabled={busy}
                  onClick={() => {
                    setChoosingAsset(true);
                  }}
                >
                  {existingAsset ? (
                    <>
                      <span className="grid min-w-0 gap-0.5">
                        <strong className="truncate">
                          {existingAsset.name}
                        </strong>
                        <small className="truncate font-normal text-[var(--muted)]">
                          {t("canvas.exportPanel.currentVersion", {
                            version: existingAsset.version,
                          })}
                        </small>
                      </span>
                      {t("canvas.exportPanel.replace")}
                    </>
                  ) : (
                    t("canvas.exportPanel.chooseAsset")
                  )}
                </Button>
              ) : null}
            </fieldset>
          </div>

          {busy ? (
            <div
              aria-live="polite"
              className="m-[14px_18px_16px] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl bg-[var(--mist)] p-3"
            >
              <FileImageOutlined
                aria-hidden="true"
                className="text-[var(--primary)]"
              />
              <span className="grid gap-0.5">
                <strong className="text-[13px]">
                  {phaseLabel(phase, progress, t)}
                </strong>
                <small className="text-xs leading-snug text-[var(--muted)]">
                  {selectedPages.length > 1
                    ? t("canvas.exportPanel.sequential")
                    : t("canvas.exportPanel.stopKeepsResults")}
                </small>
              </span>
              <Button onClick={onCancel} size="small">
                {t("canvas.exportPanel.stopWaiting")}
              </Button>
            </div>
          ) : null}

          {phase === "error" && error ? (
            <Alert
              className="m-[14px_18px_16px]"
              showIcon
              type="error"
              title={error}
              description={
                results.length > 0
                  ? t("canvas.exportPanel.partialCompleted", {
                      count: results.length,
                    })
                  : undefined
              }
              action={
                retryable ? (
                  <Button onClick={onRetry} size="small">
                    {t("canvas.exportPanel.resume")}
                  </Button>
                ) : undefined
              }
            />
          ) : null}

          {phase === "error" && results.length > 0 ? (
            <div
              className={`${exportResultListClassName} mx-[18px] mb-4 w-auto`}
            >
              {results.map((result) => (
                <div key={result.artifactId}>
                  <span>
                    <strong>{result.pageName}</strong>
                    <small>
                      {t("canvas.exportPanel.completedFile", {
                        name: result.filename,
                      })}
                    </small>
                  </span>
                  {canDownload ? (
                    <Button
                      aria-label={t("canvas.exportPanel.downloadPage", {
                        name: result.pageName,
                      })}
                      icon={<DownloadOutlined aria-hidden="true" />}
                      onClick={() => {
                        onDownload(result);
                      }}
                      shape="circle"
                      size="small"
                      type="text"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {!busy ? (
            <footer className="flex justify-end border-t border-[var(--line)] bg-white px-[18px] pt-3 pb-4">
              <Button block disabled={!canRun} onClick={onRun} type="primary">
                {runLabel}
              </Button>
            </footer>
          ) : null}
        </>
      )}
    </section>
  );
}
