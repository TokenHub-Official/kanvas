import type { WorkspaceAssetSummary } from "@kanvas/contracts/api";
import {
  CheckOutlined,
  CloseOutlined,
  FileImageOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Button, Input, Select, Tabs } from "antd";
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ArtifactPreview,
  type ArtifactImageMetadata,
} from "../../components/artifact-preview.js";
import { transparencySurfaceStyle } from "../../components/transparency-surface.js";
import { cn } from "../../lib/cn.js";
import { supportedCanvasImages } from "../editor/image-import.js";
import {
  useWorkspaceAssetLibrary,
  type WorkspaceAssetView,
} from "./use-workspace-asset-library.js";

type AssetPickerTab = "external" | "library" | "upload";

export const kanvasAssetDragMime = "application/x-kanvas-workspace-asset";
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const RECENT_ASSET_LIMIT = 24;
const UPLOAD_REUSE_PREVIEW_LIMIT = 12;

export interface WorkspaceAssetPickFailure {
  readonly assetId: string;
  readonly message: string;
}

export interface WorkspaceAssetPickResult {
  readonly failed: readonly WorkspaceAssetPickFailure[];
  readonly succeededIds: readonly string[];
}

export type WorkspaceAssetPickIntent =
  "add" | "background" | "fill" | "replace";

export interface WorkspaceAssetUploadItem {
  readonly canCancel?: boolean;
  readonly id: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly progress?: number;
  readonly status: "failed" | "processing" | "uploading";
}

function assetTypeKey(assetType: string): string {
  const known: Readonly<Record<string, string>> = {
    "image.canvas_export": "canvasExport",
    "image.cutout": "cutout",
    "image.generated": "generated",
    "image.source": "source",
  };
  return known[assetType] ?? "other";
}

function mediaLabel(mediaType: string | undefined, fallback: string): string {
  const subtype = mediaType?.split("/")[1]?.split("+")[0];
  return subtype ? subtype.toUpperCase() : fallback;
}

function byteLabel(value: number | string | undefined): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  if (bytes >= BYTES_PER_MEBIBYTE) {
    return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KIBIBYTE))} KB`;
}

function recentStorageKey(workspaceId: string): string {
  return `kanvas.recent-assets.${workspaceId}`;
}

function readRecentAssetIds(workspaceId: string): readonly string[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(
      localStorage.getItem(recentStorageKey(workspaceId)) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function WorkspaceAssetLibraryCard({
  asset,
  batchMode,
  canEdit,
  compact,
  onActivate,
  onDragEnd,
  onDragStart,
  picking,
  selected,
  workspaceId,
}: {
  readonly asset: WorkspaceAssetSummary;
  readonly batchMode: boolean;
  readonly canEdit: boolean;
  readonly compact: boolean;
  readonly onActivate: () => void;
  readonly onDragEnd: () => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly picking: boolean;
  readonly selected: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState<ArtifactImageMetadata>();
  const artifact = asset.currentArtifact;
  const available = artifact?.availabilityStatus === "available";
  const format = mediaLabel(artifact?.mediaType, t("canvas.assetPicker.image"));
  const dimensions = metadata
    ? `${String(metadata.width)}×${String(metadata.height)}`
    : "";
  const size = byteLabel(metadata?.byteSize ?? artifact?.byteSize);
  const summary = [format, dimensions].filter(Boolean);
  const fullDetails = [format, dimensions, size].filter(Boolean);

  return (
    <article
      className={cn(
        "min-w-0 [contain-intrinsic-size:auto_190px] [content-visibility:auto]",
        !available && "opacity-65",
      )}
      draggable={Boolean(available && canEdit)}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <button
        aria-pressed={batchMode ? selected : undefined}
        className="group grid w-full min-w-0 gap-1 border-0 bg-transparent p-0 text-left text-ink"
        disabled={!available || !canEdit || picking}
        onClick={onActivate}
        type="button"
      >
        <span
          className={cn(
            "relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[11px] border border-line transition-colors group-hover:border-primary [&>.artifact-image-state]:min-h-0",
            selected &&
              "border-primary shadow-[inset_0_0_0_1px_var(--primary)]",
          )}
          style={transparencySurfaceStyle}
        >
          {artifact ? (
            <ArtifactPreview
              alt=""
              artifactId={artifact.id}
              imageClassName="absolute inset-0 size-full object-contain"
              lazy
              onMetadata={setMetadata}
              thumbnail
              workspaceId={workspaceId}
            />
          ) : (
            <FileImageOutlined aria-hidden="true" className="text-xl" />
          )}
          {batchMode ? (
            <i
              aria-hidden="true"
              className={cn(
                "absolute top-[7px] right-[7px] grid size-5 place-items-center rounded-[7px] border border-white/90 bg-[rgb(21_21_21_/_48%)] text-white not-italic",
                selected && "bg-primary",
              )}
            >
              {selected ? (
                <CheckOutlined aria-hidden="true" className="text-xs" />
              ) : null}
            </i>
          ) : null}
          {!available ? (
            <em className="absolute right-[7px] bottom-[7px] rounded-md bg-[rgb(21_21_21_/_76%)] px-1.5 py-[3px] text-[11px] font-bold text-white not-italic">
              {t("canvas.assetPicker.unavailable")}
            </em>
          ) : null}
        </span>
        <strong className="mt-0.5 truncate text-xs font-bold">
          {asset.name}
        </strong>
        {compact ? null : (
          <small
            className="truncate text-xs leading-[1.3] text-muted"
            title={fullDetails.join(" · ")}
          >
            {summary.join(" · ")}
          </small>
        )}
      </button>
    </article>
  );
}

export function WorkspaceAssetPicker({
  allowBatch = true,
  canEdit,
  compact = false,
  externalLibrary,
  importing,
  initialTab = "upload",
  mode = "all",
  onAssetDragEnd,
  onAssetDragStart,
  onPickAssets,
  onCancelUpload,
  onRetryUpload,
  onSelectUpload,
  onUploadFiles,
  pickIntent = "add",
  uploadError,
  uploadItems = [],
  workspaceId,
}: {
  readonly allowBatch?: boolean;
  readonly canEdit: boolean;
  readonly compact?: boolean;
  readonly externalLibrary?: ReactNode;
  readonly importing: boolean;
  readonly initialTab?: AssetPickerTab;
  readonly mode?: "all" | AssetPickerTab;
  readonly onAssetDragEnd?: () => void;
  readonly onAssetDragStart?: (asset: WorkspaceAssetSummary) => void;
  readonly onPickAssets: (
    assets: readonly WorkspaceAssetSummary[],
    intent: WorkspaceAssetPickIntent,
  ) => Promise<WorkspaceAssetPickResult>;
  readonly onCancelUpload?: (id: string) => void;
  readonly onRetryUpload?: (id: string) => void;
  readonly onSelectUpload?: (id: string) => void;
  readonly onUploadFiles: (files: readonly File[]) => void;
  readonly pickIntent?: WorkspaceAssetPickIntent;
  readonly uploadError?: string;
  readonly uploadItems?: readonly WorkspaceAssetUploadItem[];
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [tabSelection, setTabSelection] = useState<{
    readonly initialTab: AssetPickerTab;
    readonly mode: "all" | AssetPickerTab;
    readonly tab: AssetPickerTab;
  }>({
    initialTab,
    mode,
    tab: initialTab,
  });
  const tab =
    tabSelection.initialTab === initialTab && tabSelection.mode === mode
      ? tabSelection.tab
      : initialTab;
  const activeTab = mode === "all" ? tab : mode;
  const [dropActive, setDropActive] = useState(false);
  const [pickerError, setPickerError] = useState<string>();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [assetType, setAssetType] = useState<string>();
  const [view, setView] = useState<WorkspaceAssetView>("all");
  const [batchMode, setBatchMode] = useState(false);
  const selectionScope = `${assetType ?? ""}\u0000${deferredSearch}\u0000${view}`;
  const [selection, setSelection] = useState<{
    readonly ids: Set<string>;
    readonly scope: string;
  }>(() => ({
    ids: new Set(),
    scope: selectionScope,
  }));
  const selectedIds =
    selection.scope === selectionScope ? selection.ids : new Set<string>();
  const [picking, setPicking] = useState(false);
  const batchAvailable = allowBatch && pickIntent === "add";
  const storedRecentIds = useMemo(
    () => readRecentAssetIds(workspaceId),
    [workspaceId],
  );
  const [recentSelection, setRecentSelection] = useState<{
    readonly ids: readonly string[];
    readonly workspaceId: string;
  }>(() => ({
    ids: storedRecentIds,
    workspaceId,
  }));
  const recentIds =
    recentSelection.workspaceId === workspaceId
      ? recentSelection.ids
      : storedRecentIds;
  const inputRef = useRef<HTMLInputElement>(null);

  function setTab(nextTab: AssetPickerTab): void {
    setTabSelection({
      initialTab,
      mode,
      tab: nextTab,
    });
  }

  function setSelectedIds(
    update: Set<string> | ((current: Set<string>) => Set<string>),
  ): void {
    setSelection((currentSelection) => {
      const current =
        currentSelection.scope === selectionScope
          ? currentSelection.ids
          : new Set<string>();
      return {
        ids: typeof update === "function" ? update(current) : update,
        scope: selectionScope,
      };
    });
  }

  const {
    allAssets,
    allError,
    allPending,
    availableAssetTypes,
    error: libraryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    pending: libraryPending,
    refetch: refetchLibrary,
    refetchAll,
    visibleAssets,
  } = useWorkspaceAssetLibrary({
    assetType,
    enabled: mode === "upload" || activeTab === "library",
    recentIds,
    search: deferredSearch,
    view,
    workspaceId,
  });
  let libraryEmptyLabel = t("canvas.assetPicker.noLibraryAssets");
  if (view === "recent") {
    libraryEmptyLabel = t("canvas.assetPicker.noRecent");
  } else if (deferredSearch) {
    libraryEmptyLabel = t("canvas.assetPicker.noSearchResults");
  }

  function chooseFiles(files: FileList | null) {
    const supported = supportedCanvasImages(files ?? []);
    if (supported.length === 0) {
      if (files && files.length > 0) {
        setPickerError(t("canvas.assetPicker.unsupportedFile"));
      }
      return;
    }
    setPickerError(undefined);
    onUploadFiles(allowBatch ? supported : supported.slice(0, 1));
  }

  function recordRecent(ids: readonly string[]) {
    const next = [...ids, ...recentIds.filter((id) => !ids.includes(id))].slice(
      0,
      RECENT_ASSET_LIMIT,
    );
    setRecentSelection({
      ids: next,
      workspaceId,
    });
    try {
      localStorage.setItem(recentStorageKey(workspaceId), JSON.stringify(next));
    } catch {
      // Recent usage is a convenience and must never block insertion.
    }
  }

  async function pickAssets(candidates: readonly WorkspaceAssetSummary[]) {
    if (!canEdit || candidates.length === 0 || picking) {
      return;
    }
    setPicking(true);
    setPickerError(undefined);
    try {
      const result = await onPickAssets(candidates, pickIntent);
      recordRecent(result.succeededIds);
      setSelectedIds(new Set(result.failed.map((failure) => failure.assetId)));
      if (result.failed.length > 0) {
        setPickerError(
          result.succeededIds.length > 0
            ? t("canvas.assetPicker.partialFailure", {
                succeeded: result.succeededIds.length,
                failed: result.failed.length,
              })
            : (result.failed[0]?.message ?? t("canvas.assetPicker.addError")),
        );
      } else {
        setBatchMode(false);
      }
    } finally {
      setPicking(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  const handleUploadDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setDropActive(false);
  };
  const handleUploadDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    if (canEdit) {
      chooseFiles(event.dataTransfer.files);
    }
  };
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFiles(event.target.files);
    event.target.value = "";
  };
  const toggleBatchMode = () => {
    setBatchMode((current) => !current);
    setSelectedIds(new Set());
  };
  const startAssetDrag = (
    event: DragEvent<HTMLElement>,
    asset: WorkspaceAssetSummary,
    available: boolean,
  ) => {
    if (!available || !canEdit) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(kanvasAssetDragMime, asset.id);
    onAssetDragStart?.(asset);
  };

  return (
    <div className={cn("grid", compact ? "gap-2.5" : "gap-3")}>
      {mode === "all" ? (
        <Tabs
          activeKey={activeTab}
          aria-label={t("canvas.assetPicker.sourceLabel")}
          classNames={{ header: "mb-0" }}
          items={[
            {
              label: t("canvas.assetPicker.upload"),
              key: "upload",
            },
            {
              label: t("canvas.assetPicker.library"),
              key: "library",
            },
            ...(externalLibrary
              ? [
                  {
                    label: t("canvas.assetPicker.external"),
                    key: "external",
                  },
                ]
              : []),
          ]}
          onChange={(value) => setTab(value as AssetPickerTab)}
          size="small"
        />
      ) : null}

      {activeTab === "external" && externalLibrary ? externalLibrary : null}
      {activeTab === "upload" ? (
        <>
          <div
            className={cn(
              "flex min-h-[172px] flex-col items-center justify-center gap-[7px] rounded-[12px] border border-dashed border-line-strong bg-mist p-[22px] text-center transition-[border-color,background-color] duration-150",
              dropActive && "border-primary bg-primary-soft",
            )}
            onDragEnter={(event) => {
              if (Array.from(event.dataTransfer.types).includes("Files")) {
                event.preventDefault();
                setDropActive(true);
              }
            }}
            onDragLeave={handleUploadDragLeave}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.types).includes("Files")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = canEdit ? "copy" : "none";
              }
            }}
            onDrop={handleUploadDrop}
          >
            <input
              accept="image/jpeg,image/png,image/webp"
              disabled={!canEdit}
              hidden
              multiple={allowBatch}
              onChange={handleFileInputChange}
              ref={inputRef}
              type="file"
            />
            <span className="mb-[3px] grid size-[38px] place-items-center rounded-[11px] bg-primary text-white">
              <UploadOutlined aria-hidden="true" className="text-2xl" />
            </span>
            <strong className="text-[13px]">
              {t(
                pickIntent === "add"
                  ? "canvas.assetPicker.dropTitle"
                  : "canvas.assetPicker.contextDropTitle",
              )}
            </strong>
            <p className="mt-0 mb-[7px] text-xs text-muted">
              {t("canvas.assetPicker.fileHint")}
            </p>
            <Button
              disabled={!canEdit}
              loading={importing && uploadItems.length === 0}
              onClick={() => {
                inputRef.current?.click();
              }}
              size="small"
              type="primary"
            >
              {t("canvas.assetPicker.chooseImages")}
            </Button>
          </div>

          {uploadItems.length > 0 ? (
            <div
              aria-live="polite"
              aria-label={t("canvas.assetPicker.processingLabel")}
              className="grid gap-1"
              role="status"
            >
              {uploadItems.map((item) => {
                let uploadLabel = t("canvas.assetPicker.uploadProgress", {
                  progress: item.progress ?? 0,
                });
                if (item.status === "failed") {
                  uploadLabel = t("canvas.assetPicker.uploadFailedRetained");
                } else if (item.status === "processing") {
                  uploadLabel = t("canvas.assetPicker.uploadProcessing");
                }
                return (
                  <div
                    className="grid min-h-14 grid-cols-[44px_minmax(0,1fr)_30px] items-center gap-[9px] rounded-[10px] bg-mist p-1.5"
                    key={item.id}
                  >
                    <button
                      aria-label={t("canvas.assetPicker.selectUpload", {
                        name: item.name,
                      })}
                      className="size-11 overflow-hidden rounded-lg border-0 bg-paper p-0"
                      onClick={() => {
                        onSelectUpload?.(item.id);
                      }}
                      type="button"
                    >
                      <img
                        alt=""
                        className="size-full object-cover"
                        src={item.previewUrl}
                      />
                    </button>
                    <span className="relative grid min-w-0 gap-0.5 pb-[5px]">
                      <strong className="truncate text-[11px]">
                        {item.name}
                      </strong>
                      <small className="truncate text-[10px] text-muted">
                        {uploadLabel}
                      </small>
                      {item.status === "uploading" ? (
                        <i
                          aria-hidden="true"
                          className="absolute right-0 bottom-0 left-0 h-0.5 origin-left rounded-full bg-primary"
                          style={{
                            transform: `scaleX(${String(
                              (item.progress ?? 0) / 100,
                            )})`,
                          }}
                        />
                      ) : null}
                    </span>
                    {item.status === "failed" ? (
                      <Button
                        aria-label={t("canvas.assetPicker.retryUpload", {
                          name: item.name,
                        })}
                        disabled={!canEdit}
                        icon={<ReloadOutlined aria-hidden="true" />}
                        onClick={() => {
                          onRetryUpload?.(item.id);
                        }}
                        shape="circle"
                        size="small"
                        type="text"
                      />
                    ) : null}
                    {item.status !== "failed" && item.canCancel ? (
                      <Button
                        aria-label={t("canvas.assetPicker.cancelUpload", {
                          name: item.name,
                        })}
                        danger
                        disabled={!canEdit}
                        icon={<CloseOutlined aria-hidden="true" />}
                        onClick={() => {
                          onCancelUpload?.(item.id);
                        }}
                        shape="circle"
                        size="small"
                        type="text"
                      />
                    ) : null}
                    {item.status !== "failed" && !item.canCancel ? (
                      <LoadingOutlined
                        aria-hidden="true"
                        className="text-muted"
                        spin
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <section className="mt-[18px] grid gap-2.5 border-t border-line pt-4">
            <strong className="text-[13px]">
              {t("canvas.assetPicker.uploaded")}
            </strong>
            {allPending ? (
              <div className="flex min-h-24 items-center justify-center gap-2.5 text-xs text-muted">
                <LoadingOutlined
                  aria-hidden="true"
                  className="animate-spin text-xl text-primary"
                />
                {t("canvas.assetPicker.loading")}
              </div>
            ) : null}
            {allError ? (
              <div
                className="flex min-h-[180px] flex-col items-center justify-center gap-[7px] text-center text-muted"
                role="alert"
              >
                <FileImageOutlined aria-hidden="true" className="text-xl" />
                <strong className="text-[13px] text-ink">
                  {t("canvas.assetPicker.uploadedReadError")}
                </strong>
                <Button
                  onClick={() => {
                    void refetchAll();
                  }}
                  size="small"
                  type="link"
                >
                  {t("canvas.assetPicker.retry")}
                </Button>
              </div>
            ) : null}
            {!allPending && !allError && allAssets.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-[7px] text-center text-muted">
                <FileImageOutlined aria-hidden="true" className="text-xl" />
                <strong className="text-[13px] text-ink">
                  {t("canvas.assetPicker.noUploads")}
                </strong>
              </div>
            ) : null}
            {!allPending && !allError && allAssets.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {allAssets.slice(0, UPLOAD_REUSE_PREVIEW_LIMIT).map((asset) => {
                  const artifact = asset.currentArtifact;
                  const available =
                    artifact?.availabilityStatus === "available";
                  return (
                    <button
                      aria-label={t(
                        `canvas.assetPicker.assetActions.${pickIntent}`,
                        { name: asset.name },
                      )}
                      className="group grid min-w-0 gap-[5px] border-0 bg-transparent p-0 text-left text-ink"
                      disabled={!available || !canEdit || picking}
                      key={asset.id}
                      onClick={() => {
                        void pickAssets([asset]);
                      }}
                      type="button"
                    >
                      {artifact ? (
                        <ArtifactPreview
                          alt=""
                          artifactId={artifact.id}
                          imageClassName="aspect-square h-auto min-h-0 w-full rounded-[9px] border border-line bg-mist object-cover transition-colors group-hover:border-primary"
                          lazy
                          thumbnail
                          workspaceId={workspaceId}
                        />
                      ) : (
                        <span className="grid aspect-square w-full place-items-center rounded-[9px] border border-line bg-mist text-muted transition-colors group-hover:border-primary">
                          <FileImageOutlined
                            aria-hidden="true"
                            className="text-2xl"
                          />
                        </span>
                      )}
                      <span className="truncate text-xs">{asset.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {activeTab === "library" ? (
        <div className="relative grid min-h-[238px] gap-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              allowClear
              aria-label={t("canvas.assetPicker.searchLibrary")}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder={t("canvas.assetPicker.searchImages")}
              prefix={<SearchOutlined aria-hidden="true" />}
              size="medium"
              type="search"
              value={search}
              variant="filled"
            />
            {batchAvailable ? (
              <Button
                aria-pressed={batchMode}
                onClick={toggleBatchMode}
                size="medium"
                type={batchMode ? "default" : "text"}
              >
                {batchMode
                  ? t("canvas.assetPicker.cancelBatch")
                  : t("canvas.assetPicker.batch")}
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-[44px_112px] items-center gap-2">
            <span className="text-xs font-semibold text-[var(--muted)]">
              范围
            </span>
            <Select<WorkspaceAssetView>
              aria-label={t("canvas.assetPicker.scopeLabel")}
              className="w-[112px]"
              onChange={setView}
              options={[
                {
                  label: t("canvas.assetPicker.all"),
                  value: "all",
                },
                {
                  label: t("canvas.assetPicker.recent"),
                  value: "recent",
                },
              ]}
              size="small"
              value={view}
              variant="filled"
            />
          </div>

          {availableAssetTypes.length > 1 ? (
            <Select<string>
              aria-label={t("canvas.assetPicker.categoryLabel")}
              className="w-full"
              onChange={(value) => {
                setAssetType(value || undefined);
              }}
              options={[
                {
                  label: t("canvas.assetPicker.allImages"),
                  value: "",
                },
                ...availableAssetTypes.map((type) => ({
                  label: t(
                    `canvas.assetPicker.assetTypes.${assetTypeKey(type)}`,
                  ),
                  value: type,
                })),
              ]}
              size="medium"
              value={assetType ?? ""}
              variant="filled"
            />
          ) : null}

          {libraryPending ? (
            <div className="flex min-h-24 items-center justify-center gap-2.5 text-xs text-muted">
              <LoadingOutlined
                aria-hidden="true"
                className="animate-spin text-xl text-primary"
              />
              {t("canvas.assetPicker.loading")}
            </div>
          ) : null}
          {libraryError ? (
            <div
              className="flex min-h-[180px] flex-col items-center justify-center gap-[7px] text-center text-muted"
              role="alert"
            >
              <FileImageOutlined aria-hidden="true" className="text-xl" />
              <strong className="text-[13px] text-ink">
                {t("canvas.assetPicker.libraryReadError")}
              </strong>
              <Button
                onClick={() => {
                  refetchLibrary();
                }}
                size="small"
                type="link"
              >
                {t("canvas.assetPicker.retry")}
              </Button>
            </div>
          ) : null}
          {!libraryPending && !libraryError && visibleAssets.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-[7px] text-center text-muted">
              <FileImageOutlined aria-hidden="true" className="text-xl" />
              <strong className="text-[13px] text-ink">
                {libraryEmptyLabel}
              </strong>
              {mode === "all" && view !== "recent" ? (
                <Button
                  onClick={() => {
                    setTab("upload");
                  }}
                  size="small"
                  type="link"
                >
                  {t("canvas.assetPicker.addFromComputer")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {!libraryPending && !libraryError && visibleAssets.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-x-2.5 gap-y-[13px]">
                {visibleAssets.map((asset) => {
                  const available =
                    asset.currentArtifact?.availabilityStatus === "available";
                  return (
                    <WorkspaceAssetLibraryCard
                      asset={asset}
                      batchMode={batchMode}
                      canEdit={canEdit}
                      compact={compact}
                      key={asset.id}
                      onActivate={() => {
                        if (batchMode) {
                          toggleSelected(asset.id);
                        } else {
                          void pickAssets([asset]);
                        }
                      }}
                      onDragEnd={() => {
                        onAssetDragEnd?.();
                      }}
                      onDragStart={(event) =>
                        startAssetDrag(event, asset, available)
                      }
                      picking={picking}
                      selected={selectedIds.has(asset.id)}
                      workspaceId={workspaceId}
                    />
                  );
                })}
              </div>

              {view === "all" && hasNextPage ? (
                <Button
                  block
                  disabled={isFetchingNextPage}
                  loading={isFetchingNextPage}
                  onClick={() => {
                    void fetchNextPage();
                  }}
                  size="small"
                >
                  {t("canvas.assetPicker.showMore")}
                </Button>
              ) : null}
            </>
          ) : null}

          {batchMode && selectedIds.size > 0 ? (
            <div className="sticky bottom-0 z-2 -m-0.5 mt-0.5 flex min-h-[54px] items-center justify-between gap-3 rounded-[12px] border border-line bg-white/94 px-2.5 py-2 text-xs font-bold shadow-[0_12px_34px_rgb(32_29_52_/_13%)] backdrop-blur-[12px]">
              <span>
                {t("canvas.assetPicker.selectedCount", {
                  count: selectedIds.size,
                })}
              </span>
              <Button
                loading={picking}
                onClick={() => {
                  void pickAssets(
                    visibleAssets.filter((asset) => selectedIds.has(asset.id)),
                  );
                }}
                size="small"
                type="primary"
              >
                {t("canvas.assetPicker.addToBoard")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {uploadError || pickerError ? (
        <p
          className="m-0 flex items-center gap-[7px] text-xs leading-[1.45] font-bold text-danger"
          role="alert"
        >
          <FileImageOutlined aria-hidden="true" className="text-base" />
          {uploadError ?? pickerError}
        </p>
      ) : null}
    </div>
  );
}
