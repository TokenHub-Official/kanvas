import {
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  MoreOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { AgentThreadList, AgentThreadView } from "@kanvas/contracts/api";
import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Skeleton,
  Tooltip,
} from "antd";
import {
  Fragment,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  archiveAgentThread,
  fetchAgentThread,
  fetchAgentThreads,
  renameAgentThread,
} from "../api/transport.js";
import { queryClient } from "../query-client.js";
import { cn } from "../lib/cn.js";
const THREAD_PAGE_SIZE = 30;
const THREAD_POLL_INTERVAL_MS = 2_000;
export function threadListHasActiveRun(
  pages: readonly AgentThreadList[] | undefined,
  excludedThreadId: string | undefined,
): boolean {
  return Boolean(
    pages?.some((page) =>
      page.items.some(
        (item) =>
          item.id !== excludedThreadId &&
          (item.latestRun?.lifecycleStatus === "queued" ||
            item.latestRun?.lifecycleStatus === "running"),
      ),
    ),
  );
}

function threadUpdatedAt(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function threadAttentionKey(
  item: AgentThreadList["items"][number],
): string | undefined {
  switch (item.latestRun?.lifecycleStatus) {
    case "queued":
      return "agent.threadState.queued";
    case "running":
      return "agent.threadState.working";
    case "waiting_approval":
      return "agent.threadState.needsConfirmation";
    case "waiting_for_user":
      return "agent.threadState.needsInput";
    case "failed":
      return "agent.threadState.failed";
    default:
      return undefined;
  }
}

function threadAttentionIcon(
  status: AgentThreadList["items"][number]["latestRun"],
) {
  if (status?.lifecycleStatus === "failed") {
    return <ExclamationCircleOutlined aria-hidden="true" />;
  }
  return status?.lifecycleStatus === "queued" ||
    status?.lifecycleStatus === "waiting_approval" ||
    status?.lifecycleStatus === "waiting_for_user" ? (
    <ClockCircleOutlined aria-hidden="true" />
  ) : (
    <LoadingOutlined
      aria-hidden="true"
      className="motion-reduce:!animate-none"
      spin
    />
  );
}

function threadAttentionColor(
  run: AgentThreadList["items"][number]["latestRun"],
) {
  switch (run?.lifecycleStatus) {
    case "failed":
      return "text-danger";
    case "waiting_approval":
    case "waiting_for_user":
      return "text-warning";
    default:
      return "text-muted";
  }
}

export function ConversationHistory({
  workspaceId,
  threadId,
  csrfToken,
  permissions,
  controls,
  onConversationNavigate,
  onNavigate,
  footer,
}: {
  readonly workspaceId: string;
  readonly threadId?: string;
  readonly csrfToken: string;
  readonly permissions: readonly string[];
  readonly controls: ReactNode;
  readonly onConversationNavigate?: () => void;
  readonly onNavigate?: () => void;
  readonly footer: ReactNode;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const [modal, modalContext] = Modal.useModal();
  const [threadQuery, setThreadQuery] = useState("");
  const [renamingThread, setRenamingThread] =
    useState<AgentThreadList["items"][number]>();
  const [renameValue, setRenameValue] = useState("");
  const [threadActionPending, setThreadActionPending] = useState(false);
  const [messageErrorKey, setMessageErrorKey] = useState<string>();
  const threads = useInfiniteQuery({
    queryKey: ["agent-threads", workspaceId],
    queryFn: ({ pageParam }) =>
      fetchAgentThreads(workspaceId, {
        limit: THREAD_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      threadListHasActiveRun(query.state.data?.pages, threadId)
        ? THREAD_POLL_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
    enabled: permissions.includes("agent.run"),
    retry: false,
  });
  // Subscribe to the active conversation's existing stream cache without
  // fetching again. Its list snapshot may still say queued after dispatch.
  const activeRun = useQuery({
    queryKey: ["agent-thread", workspaceId, threadId],
    queryFn: threadId
      ? () =>
          fetchAgentThread(
            workspaceId,
            threadId,
            undefined,
            i18n.resolvedLanguage ?? i18n.language,
          )
      : skipToken,
    enabled: false,
    select: (view: AgentThreadView) => view.latestRun,
  }).data;
  const threadItems = useMemo(
    () =>
      threads.data?.pages.flatMap((page) =>
        page.items.map((item) =>
          item.id === threadId &&
          activeRun &&
          (!item.latestRun ||
            Date.parse(activeRun.updatedAt) >=
              Date.parse(item.latestRun.updatedAt))
            ? { ...item, latestRun: activeRun }
            : item,
        ),
      ) ?? [],
    [threads.data?.pages, threadId, activeRun],
  );
  const visibleThreadItems = useMemo(() => {
    const query = threadQuery.trim().toLocaleLowerCase();
    return query
      ? threadItems.filter((item) =>
          (item.title ?? t("agent.untitledThread"))
            .toLocaleLowerCase()
            .includes(query),
        )
      : threadItems;
  }, [t, threadItems, threadQuery]);
  function beginRenameThread(item: AgentThreadList["items"][number]): void {
    setRenamingThread(item);
    setRenameValue(item.title ?? t("agent.untitledThread"));
  }

  async function saveThreadName(): Promise<void> {
    const title = renameValue.trim();
    if (!renamingThread || !title || threadActionPending) return;
    setThreadActionPending(true);
    setMessageErrorKey(undefined);
    try {
      await renameAgentThread({ csrfToken, workspaceId }, renamingThread.id, {
        title,
        expectedVersion: renamingThread.version,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, renamingThread.id],
        }),
      ]);
      setRenamingThread(undefined);
    } catch {
      setMessageErrorKey("agent.threadActionError");
    } finally {
      setThreadActionPending(false);
    }
  }

  function confirmArchiveThread(item: AgentThreadList["items"][number]): void {
    modal.confirm({
      title: t("agent.archiveThreadTitle"),
      content: t("agent.archiveThreadDescription"),
      okText: t("agent.archiveThread"),
      cancelText: t("agent.cancel"),
      async onOk() {
        setMessageErrorKey(undefined);
        try {
          await archiveAgentThread({ csrfToken, workspaceId }, item.id, {
            expectedVersion: item.version,
          });
          await queryClient.invalidateQueries({
            queryKey: ["agent-threads", workspaceId],
          });
          if (item.id === threadId) {
            await navigate({
              params: { workspaceId },
              to: "/w/$workspaceId/agent",
              replace: true,
            });
          }
        } catch {
          setMessageErrorKey("agent.threadActionError");
          throw new Error(t("agent.threadActionError"));
        }
      },
    });
  }

  function notifyConversationNavigation(): void {
    onNavigate?.();
    onConversationNavigate?.();
  }

  function startNewConversation(
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): void {
    event.preventDefault();
    void navigate({
      to: "/w/$workspaceId/agent",
      params: { workspaceId },
      search: { draftId: crypto.randomUUID() },
    });
    notifyConversationNavigation();
  }

  if (!permissions.includes("agent.run"))
    return (
      <aside className="flex h-full flex-col">
        {controls}
        <div className="flex-1" />
        {footer}
      </aside>
    );

  return (
    <>
      {messageErrorKey ? (
        <Alert
          title={t(messageErrorKey)}
          type="error"
          closable={{ onClose: () => setMessageErrorKey(undefined) }}
        />
      ) : null}
      <aside className="flex h-full min-h-0 min-w-0 flex-col bg-mist/65">
        <div className="flex shrink-0 items-center px-3 pt-3 pb-2">
          <Link
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[11px] bg-paper px-4 text-sm font-medium text-ink no-underline transition-[background-color,transform] hover:bg-mist-deep active:scale-[0.98] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transform-none motion-reduce:transition-none"
            params={{ workspaceId }}
            search={{}}
            onClick={startNewConversation}
            to="/w/$workspaceId/agent"
          >
            <PlusOutlined aria-hidden="true" />
            {t("agent.newThread")}
          </Link>
        </div>
        {controls}
        <div className="shrink-0 px-3 pb-2">
          <Input
            allowClear
            aria-label={t("agent.searchThreads")}
            onChange={(event) => setThreadQuery(event.target.value)}
            placeholder={t("agent.searchThreads")}
            prefix={<SearchOutlined aria-hidden="true" />}
            value={threadQuery}
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
          {threads.isPending ? (
            <Skeleton active paragraph={{ rows: 5 }} title={false} />
          ) : null}
          {threads.isError ? (
            <Alert
              action={
                <Button onClick={() => void threads.refetch()} size="small">
                  {t("agent.retry")}
                </Button>
              }
              showIcon
              title={t("agent.listError")}
              type="error"
            />
          ) : null}
          <nav
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
            aria-label={t("agent.threads")}
          >
            {visibleThreadItems.map((item, index) => {
              const attentionKey = threadAttentionKey(item);
              const hasActiveRun =
                item.latestRun?.lifecycleStatus === "queued" ||
                item.latestRun?.lifecycleStatus === "running" ||
                item.latestRun?.lifecycleStatus === "waiting_approval" ||
                item.latestRun?.lifecycleStatus === "waiting_for_user";
              const updatedAt = item.latestRun?.updatedAt ?? item.updatedAt;
              const dateLabel = new Intl.DateTimeFormat(
                i18n.resolvedLanguage ?? i18n.language,
                {
                  month: "short",
                  day: "numeric",
                  ...(new Date(updatedAt).getFullYear() !==
                  new Date().getFullYear()
                    ? { year: "numeric" as const }
                    : {}),
                },
              ).format(new Date(updatedAt));
              const previous = visibleThreadItems[index - 1];
              const beginsDay =
                !previous ||
                new Date(
                  previous.latestRun?.updatedAt ?? previous.updatedAt,
                ).toDateString() !== new Date(updatedAt).toDateString();
              return (
                <Fragment key={item.id}>
                  {beginsDay ? (
                    <h2 className="m-0 px-3 pt-4 pb-1.5 text-xs font-normal text-muted">
                      {dateLabel}
                    </h2>
                  ) : null}
                  <div
                    className={cn(
                      "group relative min-w-0 rounded-control",
                      item.id === threadId ? "bg-paper" : "hover:bg-mist-deep",
                    )}
                  >
                    <Link
                      aria-current={item.id === threadId ? "page" : undefined}
                      title={threadUpdatedAt(
                        updatedAt,
                        i18n.resolvedLanguage ?? i18n.language,
                      )}
                      className="flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-control px-3 py-2 pr-9 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      params={{ workspaceId, threadId: item.id }}
                      onClick={notifyConversationNavigation}
                      to="/w/$workspaceId/agent/$threadId"
                    >
                      <strong
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          item.id === threadId ? "font-medium" : "font-normal",
                        )}
                      >
                        {item.title ?? t("agent.untitledThread")}
                      </strong>
                      {attentionKey ? (
                        <Tooltip title={t(attentionKey)}>
                          <span
                            aria-label={t(attentionKey)}
                            className={cn(
                              "grid size-5 shrink-0 place-items-center text-xs",
                              threadAttentionColor(item.latestRun),
                            )}
                            role="img"
                          >
                            {threadAttentionIcon(item.latestRun)}
                          </span>
                        </Tooltip>
                      ) : (
                        <span aria-hidden="true" className="size-5 shrink-0" />
                      )}
                    </Link>
                    <Dropdown
                      menu={{
                        items: [
                          {
                            icon: <EditOutlined />,
                            key: "rename",
                            label: t("agent.renameThread"),
                          },
                          {
                            danger: true,
                            disabled: hasActiveRun,
                            icon: <InboxOutlined />,
                            key: "archive",
                            label: t("agent.archiveThread"),
                          },
                        ],
                        onClick: ({ key }) => {
                          if (key === "rename") beginRenameThread(item);
                          if (key === "archive") confirmArchiveThread(item);
                        },
                      }}
                      trigger={["click"]}
                    >
                      <Button
                        aria-label={t("agent.threadActions", {
                          title: item.title ?? t("agent.untitledThread"),
                        })}
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                        icon={<MoreOutlined />}
                        size="small"
                        type="text"
                      />
                    </Dropdown>
                  </div>
                </Fragment>
              );
            })}
          </nav>
          {!threads.isPending && visibleThreadItems.length === 0 ? (
            <Empty
              className="mt-6"
              description={t("agent.noMatchingThreads")}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : null}
          {threads.hasNextPage ? (
            <Button
              block
              className="mt-2"
              loading={threads.isFetchingNextPage}
              onClick={() => void threads.fetchNextPage()}
              size="small"
            >
              {t("agent.loadMore")}
            </Button>
          ) : null}
        </div>
        {footer}
      </aside>
      {modalContext}
      <Modal
        cancelText={t("agent.cancel")}
        destroyOnHidden
        okButtonProps={{ disabled: !renameValue.trim() }}
        okText={t("agent.saveThreadName")}
        onCancel={() => setRenamingThread(undefined)}
        onOk={() => void saveThreadName()}
        open={renamingThread !== undefined}
        confirmLoading={threadActionPending}
        title={t("agent.renameThread")}
      >
        <Input
          aria-label={t("agent.threadName")}
          maxLength={240}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void saveThreadName()}
          value={renameValue}
        />
      </Modal>
    </>
  );
}
