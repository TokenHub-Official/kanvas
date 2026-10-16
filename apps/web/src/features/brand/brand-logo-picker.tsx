import type { WorkspaceAssetSummary } from "@kanvas/contracts/api";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiProblem,
  fetchWorkspaceAsset,
  fetchWorkspaceAssets,
} from "../../api/transport.js";
import { httpStatus } from "../../api/http-status.js";
import { ActionLink } from "../../components/action-link.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { VisualAssetPickerDialog } from "../../components/visual-asset-picker-dialog.js";

export type BrandImageSelection = Pick<
  WorkspaceAssetSummary,
  "id" | "name" | "currentArtifact"
>;

type Props = {
  readonly applyLabel: string;
  readonly onCancel: () => void;
  readonly onSelect: (asset: BrandImageSelection) => void;
  readonly open: boolean;
  readonly title?: string;
  readonly workspaceId: string;
};

export function BrandLogoPickerModal(props: Props): React.JSX.Element | null {
  return props.open ? <BrandLogoPickerContent {...props} /> : null;
}

function BrandLogoPickerContent({
  applyLabel,
  onCancel,
  onSelect,
  title,
  workspaceId,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const assets = useInfiniteQuery({
    queryKey: ["visual-asset-pages", workspaceId, deferredSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchWorkspaceAssets(
        workspaceId,
        {
          ...(deferredSearch ? { q: deferredSearch } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
          lifecycleStatus: "active",
          mediaKind: "image",
          limit: "48",
        },
        fetch,
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
  const items = [
    ...new Map(
      (assets.data?.pages.flatMap((page) => page.items) ?? []).map((asset) => [
        asset.id,
        asset,
      ]),
    ).values(),
  ];
  let moreState: "ready" | "loading" | "error" = "ready";
  if (assets.isFetchingNextPage) moreState = "loading";
  else if (assets.isFetchNextPageError) moreState = "error";
  return (
    <VisualAssetPickerDialog
      title={title ?? t("brand.selectLogo")}
      applyLabel={applyLabel}
      onCancel={onCancel}
      sourceActions={
        <ActionLink params={{ workspaceId }} to="/w/$workspaceId/assets">
          {t("brand.openAssets")}
        </ActionLink>
      }
      source={{
        items: items.map((asset) => ({
          id: asset.id,
          name: asset.name,
          ...(!asset.currentArtifact?.artifactType.startsWith("image.") ||
          asset.currentArtifact.availabilityStatus !== "available"
            ? { unavailableReason: t("common.visualPicker.unavailable") }
            : {}),
          thumbnail: asset.currentArtifact ? (
            <ArtifactPreview
              alt=""
              artifactId={asset.currentArtifact.id}
              imageClassName="absolute inset-0 size-full object-contain p-2"
              thumbnail
              retryLabel={t("brand.retryPreview")}
              unavailableLabel={t("brand.previewFailed")}
              workspaceId={workspaceId}
            />
          ) : null,
          preview: asset.currentArtifact ? (
            <ArtifactPreview
              alt={asset.name}
              artifactId={asset.currentArtifact.id}
              imageClassName="absolute inset-0 size-full object-contain p-4"
              thumbnail
              retryLabel={t("brand.retryPreview")}
              unavailableLabel={t("brand.previewFailed")}
              workspaceId={workspaceId}
            />
          ) : null,
        })),
        query: search,
        onQueryChange: setSearch,
        loading: assets.isPending || search.trim() !== deferredSearch,
        ...(assets.isError && !assets.isFetchNextPageError
          ? { error: t("brand.logoLoadError") }
          : {}),
        onRetry: () => void assets.refetch(),
        ...(assets.hasNextPage
          ? {
              more: {
                state: moreState,
                onLoad: () => {
                  if (!assets.isFetching) void assets.fetchNextPage();
                },
              },
            }
          : {}),
      }}
      onApply={async (item) => {
        try {
          const asset = await fetchWorkspaceAsset(workspaceId, item.id);
          if (
            asset.lifecycleStatus !== "active" ||
            !asset.currentArtifact?.artifactType.startsWith("image.") ||
            asset.currentArtifact.availabilityStatus !== "available"
          )
            throw new Error(t("common.visualPicker.unavailable"));
          onSelect(asset);
        } catch (error) {
          if (error instanceof ApiProblem)
            throw new Error(
              t(
                error.status === httpStatus.forbidden ||
                  error.status === httpStatus.notFound
                  ? "common.visualPicker.unavailable"
                  : "common.visualPicker.applyFailed",
              ),
              { cause: error },
            );
          throw error;
        }
      }}
    />
  );
}
