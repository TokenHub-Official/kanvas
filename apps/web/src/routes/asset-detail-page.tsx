import type {
  WorkspaceAssetArtifactDetail,
  WorkspaceAssetArtifactOrigin,
  WorkspaceAssetLineageItem,
} from "@kanvas/contracts/api";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BgColorsOutlined,
  CompressOutlined,
  DownloadOutlined,
  FileImageOutlined,
  PlusOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import type { TFunction } from "i18next";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Alert, App as AntApp, Button, Tooltip } from "antd";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  ApiProblem,
  createCanvasDraft,
  downloadArtifact,
  fetchWorkspaceAsset,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { ArtifactPreview } from "../components/artifact-preview.js";
import type { ArtifactImageMetadata } from "../components/artifact-preview.js";
import { EmptyState, PageLoading } from "../components/feedback.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { StatusTag } from "../components/status-tag.js";
import { transparencySurfaceStyle } from "../components/transparency-surface.js";
import { WorkspacePage } from "../components/workspace-page.js";
import {
  useWorkspaceBrandChoiceV1,
  withoutBrandChoiceV1,
  workspaceBrandChoiceValueV1,
} from "../features/brand/use-workspace-brand-choice-v1.js";
import { createAssetReuseDraftV1 } from "../features/editor/asset-reuse-draft-v1.js";

const assetDetailRouteApi = getRouteApi("/w/$workspaceId/assets/$assetId");

type AssetArtifact = WorkspaceAssetArtifactDetail;
type AssetHistoryKind = "artifacts" | "lineage";
const BYTES_PER_KIBIBYTE = 1_024;
const BYTES_PER_MEBIBYTE = 1_048_576;
const PREVIEW_ZOOM_STEP = 0.2;
const PREVIEW_ZOOM_MAX = 1.8;
const previewStateClassName =
  "grid min-h-[inherit] w-full place-items-center content-center gap-2.5 text-xs text-muted";
const previewImageClassName =
  "block size-full max-h-[760px] object-contain p-[clamp(24px,5vw,56px)] drop-shadow-[0_20px_36px_rgb(21_21_21_/_16%)] transition-transform duration-240 ease-studio motion-reduce:transition-none [transform:scale(var(--asset-preview-scale,1))]";

function readableBytes(
  value: string | undefined,
  unknownLabel: string,
): string {
  if (!value) {
    return unknownLabel;
  }
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) {
    return unknownLabel;
  }
  if (bytes < BYTES_PER_KIBIBYTE) {
    return `${String(bytes)} B`;
  }
  if (bytes < BYTES_PER_MEBIBYTE) {
    return `${(bytes / BYTES_PER_KIBIBYTE).toFixed(1)} KB`;
  }
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
}

function formatDate(
  value: string,
  locale: string,
  unknownLabel: string,
): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : unknownLabel;
}

function mediaTypeLabel(value: string | undefined, fileLabel: string): string {
  const labels: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WebP",
  };
  return value ? (labels[value] ?? value) : fileLabel;
}

function originTitle(
  origin: WorkspaceAssetArtifactOrigin,
  translate: (key: string) => string,
): string {
  if (origin.kind === "canvas_export") {
    return translate("assets.detail.origin.canvas");
  }
  if (origin.kind === "capability_result") {
    return translate("assets.detail.origin.capability");
  }
  if (origin.kind === "user_import") {
    return translate("assets.detail.origin.import");
  }
  return translate("assets.detail.origin.unknown");
}

function originDescription(
  origin: WorkspaceAssetArtifactOrigin,
  translate: TFunction<"translation">,
): string {
  if (origin.kind === "canvas_export") {
    return translate("assets.detail.origin.canvasDescription", {
      width: String(origin.width),
      height: String(origin.height),
      format: origin.format.toUpperCase(),
    });
  }
  if (origin.kind === "capability_result") {
    return translate("assets.detail.origin.capabilityDescription");
  }
  if (origin.kind === "user_import") {
    return translate("assets.detail.origin.importDescription");
  }
  return translate("assets.detail.origin.unknownDescription");
}

function lineageRelationLabel(
  direction: "input" | "output",
  relation: "composed_from" | "derived_from" | "generated_from" | "supersedes",
  translate: (key: string) => string,
): string {
  if (direction === "input") {
    if (relation === "composed_from") {
      return translate("assets.detail.lineage.composed_from");
    }
    if (relation === "generated_from") {
      return translate("assets.detail.lineage.generated_from");
    }
    if (relation === "supersedes") {
      return translate("assets.detail.lineage.supersedesInput");
    }
    return translate("assets.detail.lineage.derived_from");
  }
  return relation === "supersedes"
    ? translate("assets.detail.lineage.supersedesOutput")
    : translate("assets.detail.lineage.output");
}

function artifactLabel(
  artifact: WorkspaceAssetArtifactDetail,
  currentLabel: string,
  historyLabel: string,
): string {
  return (
    artifact.displayFilename ??
    (artifact.isCurrent ? currentLabel : historyLabel)
  );
}

function availabilityLabel(
  value: string,
  translate: (key: string) => string,
): string {
  const known = new Set(["available", "expired", "rejected", "deleted"]);
  return known.has(value)
    ? translate(`assets.detail.availability.${value}`)
    : translate("assets.detail.availability.unknown");
}

function AssetDetailContent({
  assetId,
  canReadBrand,
  csrfToken,
  workspaceId,
}: {
  readonly assetId: string;
  readonly canReadBrand: boolean;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { q } = assetDetailRouteApi.useSearch();
  const locale = i18n.resolvedLanguage ?? "zh-CN";
  const unknownTime = t("assets.detail.timeUnknown");
  const unknownSize = t("assets.detail.sizeUnknown");
  const fileLabel = t("assets.detail.file");
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [reusing, setReusing] = useState(false);
  const [reuseError, setReuseError] = useState<string>();
  const [showTransparency, setShowTransparency] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const previewIdentity = selectedArtifactId ?? "current";
  const [previewState, setPreviewState] = useState<{
    readonly identity: string;
    readonly metadata?: ArtifactImageMetadata;
    readonly zoom: number;
  }>({
    identity: previewIdentity,
    zoom: 1,
  });
  const activePreviewState =
    previewState.identity === previewIdentity
      ? previewState
      : { identity: previewIdentity, zoom: 1 };
  const imageMetadata = activePreviewState.metadata;
  const previewZoom = activePreviewState.zoom;

  function setImageMetadata(metadata: ArtifactImageMetadata | undefined): void {
    setPreviewState({
      identity: previewIdentity,
      ...(metadata ? { metadata } : {}),
      zoom: previewZoom,
    });
  }

  function setPreviewZoom(
    update: number | ((current: number) => number),
  ): void {
    setPreviewState({
      ...activePreviewState,
      identity: previewIdentity,
      zoom: typeof update === "function" ? update(previewZoom) : update,
    });
  }
  const [extraArtifacts, setExtraArtifacts] = useState<AssetArtifact[]>([]);
  const [extraLineage, setExtraLineage] = useState<WorkspaceAssetLineageItem[]>(
    [],
  );
  const [artifactsCursor, setArtifactsCursor] = useState<
    string | null | undefined
  >(undefined);
  const [lineageCursor, setLineageCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [loadingHistory, setLoadingHistory] = useState<AssetHistoryKind>();
  const [historyError, setHistoryError] = useState<{
    readonly kind: AssetHistoryKind;
    readonly message: string;
  }>();
  const reuseRequestRef = useRef<
    | {
        readonly document: ReturnType<typeof createAssetReuseDraftV1>;
        readonly idempotencyKey: string;
        readonly brandKitRevisionId: string | null;
      }
    | undefined
  >(undefined);
  const asset = useQuery({
    queryKey: ["workspace-asset", workspaceId, assetId],
    queryFn: () => fetchWorkspaceAsset(workspaceId, assetId),
    retry: false,
  });
  const brandChoice = useWorkspaceBrandChoiceV1({
    canReadBrand,
    ...(asset.data?.currentArtifact?.brand?.brandKitId
      ? {
          preferredBrandKitId: asset.data.currentArtifact.brand.brandKitId,
        }
      : {}),
    workspaceId,
  });
  const brandChoicePending = canReadBrand && brandChoice.brands.isPending;
  const brandOptions = [
    ...brandChoice.publishedBrands.map((brand) => ({
      label: brand.isDefault
        ? t("studio.home.brandDefaultOption", { brand: brand.name })
        : brand.name,
      value: workspaceBrandChoiceValueV1(brand.id),
    })),
    {
      label: t("studio.home.withoutBrand"),
      value: withoutBrandChoiceV1,
    },
  ];
  const assetRecovery = usePageQueryRecovery(asset.refetch);

  if (asset.isPending) {
    return <PageLoading label={t("assets.detail.loading")} />;
  }
  if (asset.isError) {
    const forbidden =
      asset.error instanceof ApiProblem &&
      asset.error.status === httpStatus.forbidden;
    const missing =
      asset.error instanceof ApiProblem &&
      asset.error.status === httpStatus.notFound;
    let errorTitle = t("assets.detail.errors.load");
    if (forbidden) {
      errorTitle = t("assets.detail.errors.forbidden");
    } else if (missing) {
      errorTitle = t("assets.detail.errors.missing");
    }
    return (
      <EmptyState
        {...(!forbidden && !missing
          ? {
              action: assetRecovery.retry,
              actionLabel: t("assets.detail.reload"),
              actionPending: assetRecovery.pending,
            }
          : {})}
        title={errorTitle}
      >
        {forbidden || missing
          ? t("assets.detail.errors.restrictedDescription")
          : t("assets.detail.errors.loadDescription")}
      </EmptyState>
    );
  }

  const detail = asset.data;
  const current = detail.currentArtifact;
  const artifacts = [...detail.artifacts, ...extraArtifacts];
  const lineage = [...detail.lineage, ...extraLineage];
  const selected =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ??
    current ??
    artifacts[0];
  const selectedIsCurrent = selected?.isCurrent ?? false;
  const nextArtifactsCursor =
    artifactsCursor === undefined
      ? detail.artifactsNextCursor
      : (artifactsCursor ?? undefined);
  const nextLineageCursor =
    lineageCursor === undefined
      ? detail.lineageNextCursor
      : (lineageCursor ?? undefined);
  const canDownloadSelected =
    selected?.availabilityStatus === "available" &&
    (detail.availableActions.includes("download_artifacts") ||
      (selectedIsCurrent &&
        detail.availableActions.includes("download_current")));
  const reuseSize =
    imageMetadata ??
    (current?.origin.kind === "canvas_export"
      ? {
          width: current.origin.width,
          height: current.origin.height,
        }
      : undefined);
  const canReuse =
    selectedIsCurrent &&
    detail.availableActions.includes("reuse_on_canvas") &&
    current?.availabilityStatus === "available";
  const showLineage =
    lineage.length > 0 ||
    Boolean(nextLineageCursor) ||
    historyError?.kind === "lineage";
  const showContentHistory =
    artifacts.length > 1 ||
    Boolean(nextArtifactsCursor) ||
    historyError?.kind === "artifacts";
  const sourceCanvasDraftId =
    selected?.origin.kind === "canvas_export"
      ? selected.origin.canvasDraftId
      : undefined;

  async function loadHistory(
    kind: AssetHistoryKind,
    cursor: string,
  ): Promise<void> {
    if (loadingHistory) {
      return;
    }
    setLoadingHistory(kind);
    setHistoryError(undefined);
    try {
      const page = await fetchWorkspaceAsset(workspaceId, assetId, {
        historyKind: kind,
        cursor,
        limit: kind === "artifacts" ? "20" : "40",
      });
      if (kind === "artifacts") {
        setExtraArtifacts((items) => [...items, ...page.artifacts]);
        setArtifactsCursor(page.artifactsNextCursor ?? null);
      } else {
        setExtraLineage((items) => [...items, ...page.lineage]);
        setLineageCursor(page.lineageNextCursor ?? null);
      }
    } catch {
      setHistoryError({
        kind,
        message: t("assets.detail.errors.history"),
      });
    } finally {
      setLoadingHistory(undefined);
    }
  }

  async function reuseCurrent() {
    if (!current || !canReuse || !reuseSize) {
      return;
    }
    setReusing(true);
    setReuseError(undefined);
    const request = reuseRequestRef.current ?? {
      idempotencyKey: ulid(),
      brandKitRevisionId: brandChoice.selection.brandKitRevisionId ?? null,
      document: createAssetReuseDraftV1({
        workspaceId,
        assetId: detail.id,
        artifactId: current.id,
        assetName: detail.name,
        intrinsicSize: reuseSize,
        nodeId: `image-${ulid()}`,
      }),
    };
    const selectedBrandKitRevisionId =
      brandChoice.selection.brandKitRevisionId ?? null;
    const requestForSelection =
      request.brandKitRevisionId === selectedBrandKitRevisionId
        ? request
        : {
            idempotencyKey: ulid(),
            brandKitRevisionId: selectedBrandKitRevisionId,
            document: request.document,
          };
    reuseRequestRef.current = requestForSelection;
    try {
      const result = await createCanvasDraft(
        {
          csrfToken,
          workspaceId,
        },
        {
          document: requestForSelection.document,
          brandKitRevisionId: requestForSelection.brandKitRevisionId,
        },
        requestForSelection.idempotencyKey,
      );
      notification.success({
        message: t("assets.detail.boardCreated"),
        description: t("assets.detail.boardCreatedDescription"),
      });
      await navigate({
        to: "/w/$workspaceId/boards/$canvasDraftId",
        params: {
          workspaceId,
          canvasDraftId: result.draft.id,
        },
        search: {
          importImage: false,
        },
      });
    } catch (error) {
      let message = t("assets.detail.errors.reuseUnknown");
      if (
        error instanceof ApiProblem &&
        error.status === httpStatus.forbidden
      ) {
        message = t("assets.detail.errors.reuseForbidden");
      } else if (
        error instanceof ApiProblem &&
        (error.status === httpStatus.notFound ||
          error.status === httpStatus.unprocessableContent)
      ) {
        message = t("assets.detail.errors.reuseUnavailable");
      }
      setReuseError(message);
    } finally {
      setReusing(false);
    }
  }

  async function downloadSelected() {
    if (!selected || !canDownloadSelected) {
      return;
    }
    setDownloading(true);
    try {
      const blob = await downloadArtifact(workspaceId, selected.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = selected.displayFilename ?? detail.name;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      notification.success({
        message: selectedIsCurrent
          ? t("assets.detail.currentDownloadStarted")
          : t("assets.detail.historyDownloadStarted"),
        description: anchor.download,
      });
    } catch (error) {
      notification.error({
        message: t("assets.detail.downloadError"),
        description:
          error instanceof ApiProblem && error.status === httpStatus.forbidden
            ? t("assets.detail.errors.downloadForbidden")
            : t("assets.detail.errors.downloadChanged"),
      });
    } finally {
      setDownloading(false);
    }
  }

  let dimensionLabel = t("assets.detail.facts.dimensionsPending");
  if (imageMetadata) {
    dimensionLabel = `${String(imageMetadata.width)} × ${String(imageMetadata.height)} px`;
  } else if (selected?.origin.kind === "canvas_export") {
    dimensionLabel = `${String(selected.origin.width)} × ${String(selected.origin.height)} px`;
  }

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Link
        className="mb-5 inline-flex min-h-9 items-center gap-2 text-[13px] font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary focus-visible:outline-offset-3"
        params={{ workspaceId }}
        search={q ? { q } : {}}
        to="/w/$workspaceId/assets"
      >
        <ArrowLeftOutlined />
        {t("assets.detail.back")}
      </Link>

      <header className="mb-6 min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2
            className="m-0 min-w-0 overflow-hidden text-[clamp(28px,3vw,42px)] leading-[1.08] font-bold tracking-[-0.035em] text-ellipsis text-ink sm:whitespace-nowrap"
            title={detail.name}
          >
            {detail.name}
          </h2>
          <StatusTag>{t("assets.detail.teamAsset")}</StatusTag>
          {selected?.brand ? (
            <StatusTag tone="info">{selected.brand.name}</StatusTag>
          ) : null}
          {!selectedIsCurrent ? (
            <StatusTag tone="warning">
              {t("assets.detail.selectedHistory")}
            </StatusTag>
          ) : null}
          {detail.lifecycleStatus === "archived" ? (
            <StatusTag>{t("assets.detail.archived")}</StatusTag>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section
          aria-label={
            selectedIsCurrent
              ? t("assets.detail.currentPreviewLabel")
              : t("assets.detail.historyPreviewLabel")
          }
          className="relative grid min-h-[360px] place-items-center overflow-hidden rounded-[22px] sm:min-h-[520px] xl:min-h-[640px]"
          style={
            {
              ...(showTransparency
                ? transparencySurfaceStyle
                : { background: "var(--paper)" }),
              "--asset-preview-scale": String(previewZoom),
            } as CSSProperties & { "--asset-preview-scale": string }
          }
        >
          <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full bg-paper/92 p-1 shadow-[0_8px_24px_rgb(28_26_51_/_12%)] backdrop-blur-sm">
            <Tooltip title={t("assets.detail.previewControls.background")}>
              <Button
                aria-label={t("assets.detail.previewControls.background")}
                icon={<BgColorsOutlined />}
                onClick={() => {
                  setShowTransparency((value) => !value);
                }}
                shape="circle"
                size="small"
                type={showTransparency ? "primary" : "text"}
              />
            </Tooltip>
            <Tooltip title={t("assets.detail.previewControls.zoomOut")}>
              <Button
                aria-label={t("assets.detail.previewControls.zoomOut")}
                disabled={previewZoom <= 1}
                icon={<ZoomOutOutlined />}
                onClick={() => {
                  setPreviewZoom((value) =>
                    Math.max(1, value - PREVIEW_ZOOM_STEP),
                  );
                }}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
            <Tooltip title={t("assets.detail.previewControls.fit")}>
              <Button
                aria-label={t("assets.detail.previewControls.fit")}
                disabled={previewZoom === 1}
                icon={<CompressOutlined />}
                onClick={() => {
                  setPreviewZoom(1);
                }}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
            <Tooltip title={t("assets.detail.previewControls.zoomIn")}>
              <Button
                aria-label={t("assets.detail.previewControls.zoomIn")}
                disabled={previewZoom >= PREVIEW_ZOOM_MAX}
                icon={<ZoomInOutlined />}
                onClick={() => {
                  setPreviewZoom((value) =>
                    Math.min(PREVIEW_ZOOM_MAX, value + PREVIEW_ZOOM_STEP),
                  );
                }}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
          </div>
          {selected?.mediaType?.startsWith("image/") &&
          selected.availabilityStatus === "available" ? (
            <ArtifactPreview
              alt={t(
                selectedIsCurrent
                  ? "assets.detail.currentPreviewAlt"
                  : "assets.detail.historyPreviewAlt",
                { asset: detail.name },
              )}
              artifactId={selected.id}
              className={previewStateClassName}
              imageClassName={previewImageClassName}
              loadingLabel={t("assets.detail.previewLoading")}
              onMetadata={setImageMetadata}
              unavailableLabel={t("assets.detail.previewUnavailable")}
              workspaceId={workspaceId}
            />
          ) : (
            <div className={previewStateClassName}>
              <FileImageOutlined aria-hidden="true" className="text-3xl" />
              {selected
                ? t("assets.detail.unavailablePreview", {
                    status: availabilityLabel(selected.availabilityStatus, t),
                  })
                : t("assets.detail.noPreview")}
            </div>
          )}
        </section>

        <aside className="grid gap-4 xl:sticky xl:top-24">
          <div className="grid gap-2 rounded-[20px] bg-paper p-4 shadow-[0_12px_32px_rgb(35_32_68_/_6%)]">
            {canReuse ? (
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                {t("assets.detail.brandForNewCanvas")}
                <KanvasSelect
                  aria-label={t("assets.detail.brandForNewCanvas")}
                  className="w-full"
                  disabled={brandChoicePending}
                  loading={brandChoicePending}
                  onChange={(choice: string) => {
                    brandChoice.setChoice(
                      choice as Parameters<typeof brandChoice.setChoice>[0],
                    );
                  }}
                  options={brandOptions}
                  value={brandChoice.resolvedChoice}
                />
              </label>
            ) : null}
            {canReuse ? (
              <Button
                block
                disabled={!reuseSize || brandChoicePending}
                icon={<PlusOutlined />}
                loading={reusing}
                onClick={() => {
                  void reuseCurrent();
                }}
                size="large"
                type="primary"
              >
                {reuseSize
                  ? t("assets.detail.reuseCurrent")
                  : t("assets.detail.preparingSize")}
              </Button>
            ) : null}
            {!selectedIsCurrent && current ? (
              <Button
                block
                onClick={() => {
                  setSelectedArtifactId(current.id);
                }}
                size="large"
              >
                {t("assets.detail.backToCurrent")}
              </Button>
            ) : null}
            {canDownloadSelected ? (
              <Button
                block
                icon={<DownloadOutlined />}
                loading={downloading}
                onClick={() => {
                  void downloadSelected();
                }}
                size="large"
              >
                {selectedIsCurrent
                  ? t("assets.detail.download")
                  : t("assets.detail.downloadHistory")}
              </Button>
            ) : null}
          </div>

          {reuseError ? (
            <Alert
              description={reuseError}
              showIcon
              title={t("assets.detail.errors.reuseTitle")}
              type="error"
            />
          ) : null}

          <section className="rounded-[20px] bg-paper p-5">
            <h3 className="m-0 mb-4 text-base font-bold text-ink">
              {t("assets.detail.factsTitle")}
            </h3>
            {selected ? (
              <dl className="m-0 grid gap-3 text-[13px]">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.format")}
                  </dt>
                  <dd className="m-0 text-right font-semibold text-ink">
                    {mediaTypeLabel(selected.mediaType, fileLabel)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.dimensions")}
                  </dt>
                  <dd className="m-0 text-right font-semibold text-ink">
                    {dimensionLabel}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.size")}
                  </dt>
                  <dd className="m-0 text-right font-semibold text-ink">
                    {readableBytes(selected.byteSize, unknownSize)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.createdAt")}
                  </dt>
                  <dd className="m-0 text-right font-semibold text-ink">
                    {formatDate(selected.createdAt, locale, unknownTime)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.availability")}
                  </dt>
                  <dd className="m-0">
                    <StatusTag
                      tone={
                        selected.availabilityStatus === "available"
                          ? "positive"
                          : "neutral"
                      }
                    >
                      {availabilityLabel(selected.availabilityStatus, t)}
                    </StatusTag>
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">
                    {t("assets.detail.facts.brand")}
                  </dt>
                  <dd className="m-0 text-right font-semibold text-ink">
                    {selected.brand?.name ?? t("studio.home.withoutBrand")}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="m-0 text-[13px] text-muted">
                {t("assets.detail.noCurrentArtifact")}
              </p>
            )}
          </section>

          {selected ? (
            <section className="rounded-[20px] bg-paper p-5">
              <h3 className="m-0 mb-3 text-base font-bold text-ink">
                {t("assets.detail.originTitle")}
              </h3>
              <strong className="text-sm text-ink">
                {originTitle(selected.origin, t)}
              </strong>
              <p className="mt-1 mb-0 text-[13px] leading-5 text-muted">
                {originDescription(selected.origin, t)}
              </p>
              {sourceCanvasDraftId ? (
                <Button
                  className="!mt-4"
                  icon={<ArrowRightOutlined />}
                  iconPlacement="end"
                  onClick={() => {
                    void navigate({
                      params: {
                        workspaceId,
                        canvasDraftId: sourceCanvasDraftId,
                      },
                      search: { importImage: false },
                      to: "/w/$workspaceId/boards/$canvasDraftId",
                    });
                  }}
                  type="link"
                >
                  {t("assets.detail.openSourceBoard")}
                </Button>
              ) : null}
            </section>
          ) : null}

          {detail.usedByBrands.length > 0 ? (
            <section className="rounded-[20px] bg-paper p-5">
              <h3 className="m-0 mb-3 text-base font-bold text-ink">
                {t("assets.detail.usedByBrandsTitle")}
              </h3>
              <div className="grid gap-2">
                {detail.usedByBrands.map((brand) => (
                  <Link
                    className="flex items-center justify-between gap-3 rounded-[12px] bg-mist px-3 py-2 text-sm font-semibold text-ink no-underline hover:bg-mist-deep focus-visible:outline-3 focus-visible:outline-primary"
                    key={`${brand.brandKitId}:${brand.logoRole}`}
                    params={{ workspaceId }}
                    search={{}}
                    to="/w/$workspaceId/brand"
                  >
                    <span className="truncate">{brand.name}</span>
                    <span className="shrink-0 text-xs font-normal text-muted">
                      {t(`brand.logoRoles.${brand.logoRole}`)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {!canDownloadSelected ? (
            <Alert
              description={
                selected?.availabilityStatus === "available"
                  ? t("assets.detail.downloadPermission")
                  : t("assets.detail.artifactUnavailable")
              }
              showIcon
              title={
                selectedIsCurrent
                  ? t("assets.detail.downloadUnavailable")
                  : t("assets.detail.historyDownloadUnavailable")
              }
              type="warning"
            />
          ) : null}
        </aside>
      </div>

      {showLineage ? (
        <section className="mt-12">
          <h3 className="m-0 mb-5 text-xl font-bold text-ink">
            {t("assets.detail.lineageTitle")}
          </h3>
          {lineage.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {lineage.map((item) => (
                <article
                  className="grid gap-1 rounded-[18px] bg-paper p-4"
                  key={`${item.direction}:${item.relation}:${item.artifact.id}`}
                >
                  <span className="text-xs font-semibold text-muted">
                    {lineageRelationLabel(item.direction, item.relation, t)}
                  </span>
                  <strong className="overflow-hidden text-sm text-ellipsis whitespace-nowrap text-ink">
                    {item.artifact.displayFilename ??
                      t("assets.detail.unnamedArtifact")}
                  </strong>
                  <small className="text-xs text-muted">
                    {mediaTypeLabel(item.artifact.mediaType, fileLabel)}
                    <span aria-hidden="true"> · </span>
                    {formatDate(item.artifact.createdAt, locale, unknownTime)}
                  </small>
                </article>
              ))}
            </div>
          ) : null}
          {nextLineageCursor ? (
            <div className="pt-4">
              <Button
                loading={loadingHistory === "lineage"}
                onClick={() => {
                  void loadHistory("lineage", nextLineageCursor);
                }}
              >
                {t("assets.detail.loadOlderLineage")}
              </Button>
            </div>
          ) : null}
          {historyError?.kind === "lineage" ? (
            <Alert
              className="!mt-4"
              description={historyError.message}
              showIcon
              title={t("assets.detail.olderLineageError")}
              type="error"
            />
          ) : null}
        </section>
      ) : null}

      {showContentHistory ? (
        <section className="mt-12">
          <h3 className="m-0 mb-5 text-xl font-bold text-ink">
            {t("assets.detail.versionsTitle")}
          </h3>
          {artifacts.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {artifacts.map((artifact) => (
                <button
                  aria-pressed={artifact.id === selected?.id}
                  className={`grid min-h-28 w-full gap-2 rounded-[18px] bg-paper p-4 text-left transition-shadow hover:shadow-[0_10px_28px_rgb(35_32_68_/_8%)] focus-visible:outline-3 focus-visible:outline-primary focus-visible:outline-offset-3 ${
                    artifact.id === selected?.id ? "ring-2 ring-primary" : ""
                  }`}
                  key={artifact.id}
                  onClick={() => {
                    setSelectedArtifactId(artifact.id);
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusTag
                      tone={artifact.isCurrent ? "positive" : "neutral"}
                    >
                      {artifact.isCurrent
                        ? t("assets.detail.currentAccepted")
                        : t("assets.detail.historyLabel")}
                    </StatusTag>
                    <span className="text-xs text-muted">
                      {formatDate(artifact.createdAt, locale, unknownTime)}
                    </span>
                  </div>
                  <strong className="overflow-hidden text-sm text-ellipsis whitespace-nowrap text-ink">
                    {artifactLabel(
                      artifact,
                      t("assets.detail.currentArtifact"),
                      t("assets.detail.historyLabel"),
                    )}
                  </strong>
                  <small className="text-xs text-muted">
                    {originTitle(artifact.origin, t)}
                    <span aria-hidden="true"> · </span>
                    {mediaTypeLabel(artifact.mediaType, fileLabel)}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
          {nextArtifactsCursor ? (
            <div className="pt-4">
              <Button
                loading={loadingHistory === "artifacts"}
                onClick={() => {
                  void loadHistory("artifacts", nextArtifactsCursor);
                }}
              >
                {t("assets.detail.loadOlderArtifacts")}
              </Button>
            </div>
          ) : null}
          {historyError?.kind === "artifacts" ? (
            <Alert
              className="!mt-4"
              description={historyError.message}
              showIcon
              title={t("assets.detail.olderArtifactsError")}
              type="error"
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function AssetDetailPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId, assetId } = assetDetailRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("assets.detail.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <AssetDetailContent
          assetId={assetId}
          canReadBrand={workspace.permissions.includes("brand.read")}
          csrfToken={context.csrfToken}
          key={`${workspaceId}:${assetId}`}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}
