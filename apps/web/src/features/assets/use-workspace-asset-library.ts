import type { WorkspaceAssetSummary } from "@kanvas/contracts/api";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchWorkspaceAssets } from "../../api/transport.js";

export type WorkspaceAssetView = "all" | "recent";

const ASSET_PAGE_LIMIT = "48";

interface WorkspaceAssetLibraryInput {
  readonly assetType: string | undefined;
  readonly enabled: boolean;
  readonly recentIds: readonly string[];
  readonly search: string;
  readonly view: WorkspaceAssetView;
  readonly workspaceId: string;
}

export function useWorkspaceAssetLibrary({
  assetType,
  enabled,
  recentIds,
  search,
  view,
  workspaceId,
}: WorkspaceAssetLibraryInput) {
  const assetsQuery = useInfiniteQuery({
    queryKey: ["workspace-assets", workspaceId, { q: search, assetType }],
    queryFn: ({ pageParam, signal }) =>
      fetchWorkspaceAssets(
        workspaceId,
        {
          ...(search ? { q: search } : {}),
          mediaKind: "image",
          ...(assetType ? { assetType } : {}),
          lifecycleStatus: "active",
          ...(pageParam ? { cursor: pageParam } : {}),
          limit: ASSET_PAGE_LIMIT,
        },
        fetch,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && view === "all",
    retry: false,
  });

  const allAssets = useMemo(() => {
    const byId = new Map<string, WorkspaceAssetSummary>();
    for (const page of assetsQuery.data?.pages ?? []) {
      for (const asset of page.items) {
        byId.set(asset.id, asset);
      }
    }
    return [...byId.values()];
  }, [assetsQuery.data?.pages]);

  const recentAssetsQuery = useQuery({
    queryKey: [
      "workspace-assets",
      workspaceId,
      "recent",
      { ids: recentIds, q: search, assetType },
    ],
    queryFn: ({ signal }) =>
      fetchWorkspaceAssets(
        workspaceId,
        {
          ids: recentIds.join(","),
          ...(search ? { q: search } : {}),
          mediaKind: "image",
          ...(assetType ? { assetType } : {}),
          lifecycleStatus: "active",
          limit: String(Math.max(1, recentIds.length)),
        },
        fetch,
        signal,
      ),
    enabled: enabled && view === "recent" && recentIds.length > 0,
    retry: false,
  });

  const visibleAssets = useMemo(() => {
    if (view === "all") {
      return allAssets;
    }
    const byId = new Map(
      (recentAssetsQuery.data?.items ?? []).map((asset) => [asset.id, asset]),
    );
    return recentIds.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [asset] : [];
    });
  }, [allAssets, recentAssetsQuery.data?.items, recentIds, view]);
  const queriedAssetTypes = assetsQuery.data?.pages[0]?.facets?.assetTypes;
  const availableAssetTypes =
    queriedAssetTypes && queriedAssetTypes.length > 0
      ? queriedAssetTypes
      : [...new Set(allAssets.map((asset) => asset.assetType))];
  const pending =
    view === "recent"
      ? recentIds.length > 0 && recentAssetsQuery.isPending
      : assetsQuery.isPending;
  const error =
    view === "recent" ? recentAssetsQuery.isError : assetsQuery.isError;

  function refetch(): void {
    if (view === "recent") {
      void recentAssetsQuery.refetch();
      return;
    }
    void assetsQuery.refetch();
  }

  return {
    allAssets,
    allError: assetsQuery.isError,
    allPending: assetsQuery.isPending,
    availableAssetTypes,
    error,
    fetchNextPage: assetsQuery.fetchNextPage,
    hasNextPage: assetsQuery.hasNextPage,
    isFetchingNextPage: assetsQuery.isFetchingNextPage,
    pending,
    refetch,
    refetchAll: assetsQuery.refetch,
    visibleAssets,
  };
}
