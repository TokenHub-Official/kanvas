import type { WorkspaceAssetSummary } from "@kanvas/contracts/api";
import { DownloadOutlined } from "@ant-design/icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { App as AntApp, Button, Empty, Spin, Tooltip } from "antd";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  downloadArtifact,
  fetchWorkspaceAssets,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { ArtifactPreview } from "../components/artifact-preview.js";
import { KanvasSearchInput } from "../components/kanvas-input.js";
import { StatusTag } from "../components/status-tag.js";
import { transparencySurfaceStyle } from "../components/transparency-surface.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { WorkspacePage } from "../components/workspace-page.js";

const assetsRouteApi = getRouteApi("/w/$workspaceId/assets");

export function AssetsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = assetsRouteApi.useParams();
  const search = assetsRouteApi.useSearch();
  return (
    <WorkspacePage
      pageTitle={t("assets.list.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ workspace }) => (
        <AssetsContent
          canCreate={
            workspace.permissions.includes("canvas.write") &&
            workspace.permissions.includes("asset.write")
          }
          canDownload={workspace.permissions.includes("artifact.download")}
          initialSearch={search.q ?? ""}
          workspaceId={workspace.id}
        />
      )}
    </WorkspacePage>
  );
}

function AssetsContent({
  canCreate,
  canDownload,
  initialSearch,
  workspaceId,
}: {
  readonly canCreate: boolean;
  readonly canDownload: boolean;
  readonly initialSearch: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const composingSearchRef = useRef(false);
  const [downloading, setDownloading] = useState<string>();
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const deferredSearch = useDeferredValue(searchTerm.trim());
  useEffect(() => {
    if (deferredSearch === initialSearch) return;
    void navigate({
      to: "/w/$workspaceId/assets",
      params: { workspaceId },
      search: deferredSearch ? { q: deferredSearch } : {},
      replace: true,
    });
  }, [deferredSearch, initialSearch, navigate, workspaceId]);
  const assets = useInfiniteQuery({
    queryKey: ["workspace-assets", workspaceId, { q: deferredSearch }],
    queryFn: ({ pageParam, signal }) =>
      fetchWorkspaceAssets(
        workspaceId,
        {
          ...(deferredSearch ? { q: deferredSearch } : {}),
          lifecycleStatus: "active",
          ...(pageParam ? { cursor: pageParam } : {}),
          limit: "48",
        },
        fetch,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: (previousData) => previousData,
    retry: false,
  });
  const assetsRecovery = usePageQueryRecovery(assets.refetch);
  const visibleAssets = useMemo(() => {
    const byId = new Map<string, WorkspaceAssetSummary>();
    for (const page of assets.data?.pages ?? []) {
      for (const asset of page.items) {
        byId.set(asset.id, asset);
      }
    }
    return [...byId.values()];
  }, [assets.data?.pages]);

  async function saveAsset(asset: WorkspaceAssetSummary) {
    if (!asset.currentArtifact) {
      return;
    }
    setDownloading(asset.id);
    try {
      const blob = await downloadArtifact(
        workspaceId,
        asset.currentArtifact.id,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.currentArtifact.displayFilename ?? asset.name;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      notification.success({
        title: t("assets.list.downloadStarted"),
        description: anchor.download,
        placement: "topRight",
      });
    } catch {
      notification.error({
        title: t("assets.list.downloadError"),
        description: t("assets.list.downloadErrorDescription"),
        placement: "topRight",
      });
    } finally {
      setDownloading(undefined);
    }
  }

  function completeSearchComposition(
    event: CompositionEvent<HTMLInputElement>,
  ): void {
    composingSearchRef.current = false;
    setSearchTerm(event.currentTarget.value);
  }

  function updateSearchDraft(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setSearchDraft(value);
    if (!composingSearchRef.current) {
      setSearchTerm(value);
    }
  }

  function clearAssetFilters(): void {
    setSearchDraft("");
    setSearchTerm("");
    void navigate({
      params: { workspaceId },
      replace: true,
      search: {},
      to: "/w/$workspaceId/assets",
    });
  }

  if (assets.isPending) {
    return (
      <div
        aria-live="polite"
        className="flex min-h-90 items-center justify-center gap-3 text-ui-body text-muted"
        role="status"
      >
        <Spin size="small" />
        {t("assets.list.loading")}
      </div>
    );
  }
  if (assets.isError) {
    const errorTitle =
      assets.error instanceof ApiProblem &&
      assets.error.status === httpStatus.forbidden
        ? t("assets.list.permissionError")
        : t("assets.list.loadError");
    return (
      <section
        aria-live="polite"
        className="mx-auto grid min-h-90 max-w-130 place-items-center px-6 text-center"
      >
        <div>
          <h2 className="m-0 text-ui-headline font-bold tracking-[-0.025em]">
            {errorTitle}
          </h2>
          <p className="mt-3 text-ui-body text-muted">
            {t("assets.list.loadErrorDescription")}
          </p>
          <Button
            className="mt-6"
            loading={assetsRecovery.pending}
            onClick={assetsRecovery.retry}
            type="primary"
          >
            {t("assets.list.reload")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-320 animate-[studio-page-in_360ms_cubic-bezier(0.16,1,0.3,1)]">
      <section
        aria-label={t("assets.list.controlsLabel")}
        className="mb-7 flex flex-col gap-3 md:flex-row md:items-center"
      >
        <div className="w-full md:max-w-130">
          <KanvasSearchInput
            allowClear
            aria-label={t("assets.list.searchLabel")}
            className="!bg-paper"
            onCompositionEnd={completeSearchComposition}
            onCompositionStart={() => {
              composingSearchRef.current = true;
            }}
            onChange={updateSearchDraft}
            placeholder={t("assets.list.searchPlaceholder")}
            size="large"
            suffix={
              assets.isFetching && !assets.isFetchingNextPage ? (
                <Spin size="small" />
              ) : undefined
            }
            value={searchDraft}
          />
        </div>
      </section>

      {visibleAssets.length === 0 ? (
        <section className="grid min-h-92 place-items-center py-8">
          <Empty
            description={
              <div className="grid gap-1">
                <strong className="text-ui-title text-ink">
                  {deferredSearch
                    ? t("assets.list.noMatch")
                    : t("assets.list.empty")}
                </strong>
                <span className="text-ui-body text-muted">
                  {deferredSearch
                    ? t("assets.list.noMatchDescription")
                    : t("assets.list.emptyDescription")}
                </span>
              </div>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {deferredSearch ? (
              <Button onClick={clearAssetFilters} type="primary">
                {t("assets.list.clearFilters")}
              </Button>
            ) : null}
            {!deferredSearch && canCreate ? (
              <Button
                onClick={() => {
                  void navigate({
                    params: { workspaceId },
                    to: "/w/$workspaceId/new",
                  });
                }}
                type="primary"
              >
                {t("assets.list.openImage")}
              </Button>
            ) : null}
          </Empty>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 lg:grid-cols-3 xl:grid-cols-4">
          {visibleAssets.map((asset) => {
            const available =
              asset.currentArtifact?.mediaType?.startsWith("image/") &&
              asset.currentArtifact.availabilityStatus === "available";
            const detailLabel = t("assets.list.viewAsset", {
              asset: asset.name,
            });
            return (
              <article
                className="asset-card group relative min-w-0"
                key={asset.id}
              >
                <Link
                  aria-label={detailLabel}
                  className="block overflow-hidden rounded-card bg-paper transition-shadow duration-280 ease-studio hover:shadow-[0_14px_34px_rgb(29_27_51_/_10%)] focus-visible:outline-3 focus-visible:outline-primary focus-visible:outline-offset-3"
                  params={{
                    workspaceId,
                    assetId: asset.id,
                  }}
                  search={deferredSearch ? { q: deferredSearch } : {}}
                  to="/w/$workspaceId/assets/$assetId"
                >
                  <div
                    className="relative grid aspect-square place-items-center overflow-hidden"
                    style={transparencySurfaceStyle}
                  >
                    {available && asset.currentArtifact ? (
                      <ArtifactPreview
                        alt={t("assets.list.previewAlt", {
                          asset: asset.name,
                        })}
                        artifactId={asset.currentArtifact.id}
                        className="grid size-full place-items-center p-4 text-ui-label text-muted"
                        imageClassName="absolute inset-0 block size-full object-contain drop-shadow-[0_8px_18px_rgb(21_21_21_/_12%)] transition-transform duration-300 ease-studio group-hover:scale-[1.01]"
                        lazy
                        loadingLabel={t("assets.list.previewLoading", {
                          asset: asset.name,
                        })}
                        thumbnail
                        unavailableLabel={t("assets.list.previewUnavailable")}
                        workspaceId={workspaceId}
                      />
                    ) : (
                      <div
                        aria-label={t("assets.list.previewUnavailable")}
                        className="grid size-full place-items-center px-4 text-center text-ui-label text-muted"
                        role="img"
                      >
                        {t("assets.list.previewUnavailable")}
                      </div>
                    )}
                    <div className="pointer-events-none absolute top-2.5 right-2.5 z-10 flex max-w-[calc(100%_-_20px)] items-center gap-1">
                      {asset.currentArtifact?.brand ? (
                        <StatusTag
                          className="min-w-0 max-w-full truncate !rounded-[6px] !border-0 !bg-paper/90 !px-1.5 !text-[10px] !leading-[18px] !text-primary shadow-[0_2px_8px_rgb(29_27_51_/_10%)] backdrop-blur-sm"
                          tone="info"
                        >
                          {asset.currentArtifact.brand.name}
                        </StatusTag>
                      ) : null}
                      <StatusTag className="shrink-0 !rounded-[6px] !border-0 !bg-paper/90 !px-1.5 !text-[10px] !leading-[18px] !text-muted shadow-[0_2px_8px_rgb(29_27_51_/_10%)] backdrop-blur-sm">
                        {t("assets.list.teamAsset")}
                      </StatusTag>
                    </div>
                  </div>
                  <div className="min-w-0 px-3 py-3">
                    <h3
                      className="m-0 overflow-hidden text-[13px] leading-5 font-semibold text-ellipsis whitespace-nowrap text-ink"
                      title={asset.name}
                    >
                      {asset.name}
                    </h3>
                  </div>
                </Link>
                {canDownload ? (
                  <Tooltip title={t("assets.list.downloadCurrent")}>
                    <Button
                      aria-label={t("assets.list.downloadAsset", {
                        asset: asset.name,
                      })}
                      className="absolute top-2.5 left-2.5 z-10 bg-paper/92 shadow-[var(--shadow-overlay-control)] backdrop-blur-sm transition-[opacity,transform] duration-200 [@media(hover:hover)]:translate-y-1 [@media(hover:hover)]:opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
                      disabled={
                        !asset.currentArtifact ||
                        asset.currentArtifact.availabilityStatus !== "available"
                      }
                      icon={<DownloadOutlined />}
                      loading={downloading === asset.id}
                      onClick={() => {
                        void saveAsset(asset);
                      }}
                      shape="circle"
                      size="small"
                      type="text"
                    />
                  </Tooltip>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {assets.hasNextPage ? (
        <div className="flex justify-center pt-8">
          <Button
            loading={assets.isFetchingNextPage}
            onClick={() => {
              void assets.fetchNextPage();
            }}
          >
            {assets.isFetchingNextPage
              ? t("assets.list.loadingMore")
              : t("assets.list.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
