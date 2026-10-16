import { PlusOutlined } from "@ant-design/icons";
import type { CanvasDraftSummary } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Alert, Button, Empty, Input, Skeleton } from "antd";
import { useTranslation } from "react-i18next";
import { fetchCanvasDrafts } from "../api/transport.js";
import { ActionLink } from "../components/action-link.js";
import { CanvasDraftPreview } from "../components/canvas-draft-preview.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { PageEmptyState } from "../components/feedback.js";

const boardsRouteApi = getRouteApi("/w/$workspaceId/boards");
const boardLimit = 50;
export function filterBoards(
  items: readonly CanvasDraftSummary[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  return items.filter((item) =>
    `${item.title} ${item.brand?.name ?? ""}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}
export function BoardsPage(): React.JSX.Element {
  const { workspaceId } = boardsRouteApi.useParams();
  const { t } = useTranslation();
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      pageTitle={t("agent.navigation.boards")}
    >
      {({ workspace }) =>
        workspace.permissions.includes("canvas.read") ? (
          <BoardsContent
            workspaceId={workspaceId}
            canCreate={
              workspace.permissions.includes("canvas.write") &&
              workspace.permissions.includes("asset.write")
            }
          />
        ) : (
          <PageEmptyState title={t("agent.polish.boardsUnavailable")}>
            {null}
          </PageEmptyState>
        )
      }
    </WorkspacePage>
  );
}
function BoardsContent({
  workspaceId,
  canCreate,
}: {
  readonly workspaceId: string;
  readonly canCreate: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { q = "" } = boardsRouteApi.useSearch();
  const boards = useQuery({
    queryKey: ["canvas-drafts", workspaceId, boardLimit],
    queryFn: () => fetchCanvasDrafts(workspaceId, boardLimit),
    retry: false,
  });
  const items = filterBoards(boards.data?.items ?? [], q);
  const returnTo = `/w/${workspaceId}/boards${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const dateFormat = new Intl.DateTimeFormat(
    i18n.resolvedLanguage ?? i18n.language,
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );
  return (
    <div className="mx-auto max-w-[1320px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Input.Search
          allowClear
          aria-label={t("agent.polish.searchBoards")}
          placeholder={t("agent.polish.searchBoards")}
          className="max-w-sm"
          key={q}
          defaultValue={q}
          onSearch={(value) =>
            void navigate({
              to: "/w/$workspaceId/boards",
              params: { workspaceId },
              search: value ? { q: value } : {},
              replace: true,
            })
          }
        />
        {canCreate ? (
          <ActionLink
            to="/w/$workspaceId/boards/$canvasDraftId"
            params={{ workspaceId, canvasDraftId: "new" }}
            search={{ importImage: false, returnTo }}
            color="primary"
            variant="solid"
            icon={<PlusOutlined />}
          >
            {t("agent.polish.newBoard")}
          </ActionLink>
        ) : null}
      </div>
      {boards.isError ? (
        <Alert
          type="error"
          title={t("studio.home.recentWorkError")}
          action={
            <Button onClick={() => void boards.refetch()}>
              {t("agent.retry")}
            </Button>
          }
        />
      ) : null}
      {boards.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton
              key={index}
              active
              className="rounded-card bg-paper p-6"
            />
          ))}
        </div>
      ) : null}
      {!boards.isPending && !boards.isError && items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(
            q ? "agent.polish.noBoardsMatch" : "agent.polish.noBoards",
          )}
        />
      ) : null}
      {boards.data?.truncated ? (
        <p className="mb-4 text-sm text-muted">
          {t("agent.polish.recentBoardsLimit", { count: boardLimit })}
        </p>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((board) => (
          <Link
            key={board.id}
            to="/w/$workspaceId/boards/$canvasDraftId"
            params={{ workspaceId, canvasDraftId: board.id }}
            search={{ importImage: false, returnTo }}
            className="group min-w-0 overflow-hidden rounded-card bg-paper text-ink no-underline transition-shadow duration-150 hover:shadow-[var(--shadow-section)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary"
            aria-label={t("studio.home.openWork", { name: board.title })}
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-mist-deep">
              <div className="absolute inset-5 grid min-h-0 min-w-0 place-items-center [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:bg-paper [&>svg]:shadow-sm">
                <CanvasDraftPreview
                  key={`${board.id}:${board.version}`}
                  workspaceId={workspaceId}
                  canvasDraftId={board.id}
                  version={board.version}
                />
              </div>
            </div>
            <div className="grid gap-2 p-4">
              <h2 className="m-0 truncate text-sm font-semibold">
                {board.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>
                  {t("studio.home.pages", { count: board.pageCount })}
                </span>
                <time dateTime={board.updatedAt}>
                  {dateFormat.format(new Date(board.updatedAt))}
                </time>
                {board.brand ? (
                  <span className="truncate">{board.brand.name}</span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
