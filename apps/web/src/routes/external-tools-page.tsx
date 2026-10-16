import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Input, Alert, Button, Empty, Skeleton } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspacePage } from "../components/workspace-page.js";
import { toolLibrary } from "../features/external-tools/library-api.js";
import { ToolArtwork } from "../features/external-tools/tool-artwork.js";
const routeApi = getRouteApi("/w/$workspaceId/tools");
export function ExternalToolsPage(): React.JSX.Element {
  const { workspaceId } = routeApi.useParams();
  const { t } = useTranslation();
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      pageTitle={t("studio.tools.title")}
    >
      <ToolGrid workspaceId={workspaceId} />
    </WorkspacePage>
  );
}
function ToolGrid({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const tools = useQuery({
    queryKey: ["tools", workspaceId],
    queryFn: () => toolLibrary.list(workspaceId),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const items =
    tools.data?.items.filter((item) =>
      item.displayName
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  function retry() {
    void tools.refetch();
  }
  return (
    <section className="mx-auto w-full max-w-[1240px]">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h2 className="m-0 text-[30px] font-semibold tracking-tight">
          {t("studio.tools.title")}
        </h2>
        <Input
          aria-label={t("studio.tools.search")}
          placeholder={t("studio.tools.search")}
          prefix={<SearchOutlined className="text-muted" />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
          className="max-w-[360px]"
          size="large"
        />
      </div>
      {tools.isPending ? <Skeleton active /> : null}
      {tools.isError ? (
        <Alert
          type="error"
          title={t("studio.tools.loadError")}
          action={<Button onClick={retry}>{t("studio.tools.retry")}</Button>}
        />
      ) : null}
      {!tools.isPending && !tools.isError && items.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.id}
              to="/w/$workspaceId/tools/$slug"
              params={{ workspaceId, slug: item.slug }}
              className="group overflow-hidden rounded-card border border-line/70 bg-paper text-ink no-underline transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="aspect-[4/3] overflow-hidden bg-mist/50">
                <ToolArtwork
                  symbol={item.symbol}
                  imageId={item.coverImageId ?? item.logoImageId}
                  workspaceId={workspaceId}
                  cover={Boolean(item.coverImageId)}
                />
              </div>
              <div className="px-5 py-5 text-center text-lg font-semibold">
                {item.displayName}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      {!tools.isPending && !tools.isError && !items.length ? (
        <div className="py-20">
          <Empty
            description={t(
              search ? "studio.tools.noMatches" : "studio.tools.empty",
            )}
          />
        </div>
      ) : null}
    </section>
  );
}
