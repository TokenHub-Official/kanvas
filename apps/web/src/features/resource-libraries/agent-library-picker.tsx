import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentResourcePicker } from "../../components/agent-resource-picker.js";
import { fetchLibraries } from "./api.js";

type Option = { id: string; displayName: string; summary?: string };
export function AgentLibraryPicker({
  workspaceId,
  value = [],
  onChange,
  disabled,
  bound = [],
}: {
  workspaceId: string;
  value?: string[];
  onChange?: (value: string[]) => void;
  disabled: boolean;
  bound?: readonly { id: string; displayName: string }[];
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [selected, setSelected] = useState<readonly Option[]>([]);
  const libraries = useInfiniteQuery({
    queryKey: ["library-picker", workspaceId, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      fetchLibraries(
        workspaceId,
        {
          query,
          lifecycleStatus: "active",
          ...(pageParam ? { afterId: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const results = (
    libraries.data?.pages.flatMap((page) => page.items) ?? []
  ).map((item) => ({
    id: item.id,
    displayName: item.name,
    summary: item.description,
  }));
  const knownResources = [
    ...new Map(
      [...bound, ...selected, ...results].map((item) => [item.id, item]),
    ).values(),
  ];
  const resources = knownResources.filter(
    (item) =>
      value.includes(item.id) ||
      results.some((result) => result.id === item.id),
  );

  function handleSelectionChange(ids: string[]) {
    setSelected(knownResources.filter((item) => ids.includes(item.id)));
    onChange?.(ids);
  }

  function handleSearchChange(nextSearch: string) {
    setSelected(knownResources);
    setSearch(nextSearch);
  }
  return (
    <AgentResourcePicker
      kind="libraries"
      workspaceId={workspaceId}
      canReadAssets={false}
      disabled={disabled}
      value={value}
      onChange={handleSelectionChange}
      resources={resources}
      loading={libraries.isPending}
      onSearchChange={handleSearchChange}
      matchingResourceIds={results.map((item) => item.id)}
      {...(libraries.hasNextPage
        ? {
            onLoadMore: () => void libraries.fetchNextPage(),
            loadingMore: libraries.isFetchingNextPage,
          }
        : {})}
      {...(libraries.isError
        ? {
            error: (
              <Alert
                type="error"
                showIcon
                title={t("libraries.loadFailed")}
                action={
                  <Button onClick={() => void libraries.refetch()}>
                    {t("libraries.retry")}
                  </Button>
                }
              />
            ),
          }
        : {})}
    />
  );
}
