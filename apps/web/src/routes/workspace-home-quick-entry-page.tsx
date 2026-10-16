import { CanvasDraftPreview } from "../components/canvas-draft-preview.js";
import {
  ArrowRightOutlined,
  LockOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { CanvasDraftSummary } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Alert, Button, Empty, Skeleton } from "antd";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  createWorkspaceAgentMessage,
  fetchAgentHubAgents,
  fetchAgentThreads,
  fetchCanvasDrafts,
} from "../api/transport.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { canvasImportFileIssue } from "../features/editor/canvas-import-file-validation.js";
import { stageCanvasImportFiles } from "../features/editor/canvas-import-handoff.js";

import { useWorkspaceBrandChoiceV1 } from "../features/brand/use-workspace-brand-choice-v1.js";
import {
  AgentComposer,
  agentComposerHasFilePayload,
  agentComposerImageFiles,
} from "../features/agent/agent-composer.js";
import { agentDisplaySummary } from "../features/agent/agent-presentation.js";
import { useAgentComposerAttachments } from "../features/agent/use-agent-composer-attachments.js";

const workspaceHomeRouteApi = getRouteApi("/w/$workspaceId");
const RECENT_WORK_LIMIT = 6;
const RECENT_WORK_SKELETON_COUNT = 4;
const HOME_AGENT_LIMIT = 3;

export interface WorkspaceHomeRecentWork {
  readonly draft: CanvasDraftSummary;
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

const emptyCanvasDrafts: readonly CanvasDraftSummary[] = Object.freeze([]);

export function canCreateWorkspaceContent(
  permissions: readonly string[],
): boolean {
  return (
    permissions.includes("canvas.write") && permissions.includes("asset.write")
  );
}

export function workspaceHomeRecentWork(
  drafts: readonly CanvasDraftSummary[],
  limit = 6,
): readonly WorkspaceHomeRecentWork[] {
  return drafts
    .map((draft) => ({
      draft,
      id: `draft:${draft.id}`,
      title: draft.title,
      updatedAt: draft.updatedAt,
    }))
    .toSorted(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, limit));
}

export function workspaceAgentErrorMessageKey(error: unknown): string {
  if (!(error instanceof ApiProblem)) return "studio.home.agentError";
  if (error.code === "agent.profile_unavailable") {
    return "studio.home.agentNotReady";
  }
  if (error.code.includes("budget")) {
    return "studio.home.agentBudgetUnavailable";
  }
  return "studio.home.agentError";
}

function homeUpdatedAt(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function homeThreadAttentionKey(
  status: "failed" | "waiting_approval" | "waiting_for_user",
): string {
  if (status === "failed") return "agent.threadState.failed";
  if (status === "waiting_for_user") return "agent.threadState.needsInput";
  return "agent.threadState.needsConfirmation";
}

function RecentWorkPreview({
  item,
  workspaceId,
}: {
  readonly item: WorkspaceHomeRecentWork;
  readonly workspaceId: string;
}): React.JSX.Element {
  return (
    <div className="grid size-full place-items-center p-4">
      <div className="grid h-full min-h-0 w-[72%] min-w-0 place-items-center transition-transform duration-300 group-hover:-translate-y-1 group-hover:-rotate-1 [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:bg-paper [&>svg]:shadow-[0_16px_36px_rgb(35_32_68_/_14%)]">
        <CanvasDraftPreview
          canvasDraftId={item.draft.id}
          key={`${item.draft.id}:${String(item.draft.version)}`}
          version={item.draft.version}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}

function RecentWorkCardContent({
  item,
  locale,
  workspaceId,
}: {
  readonly item: WorkspaceHomeRecentWork;
  readonly locale: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const context = t("studio.home.pages", {
    count: item.draft.pageCount,
  });
  const activityTime = t("studio.home.editedAt", {
    time: homeUpdatedAt(item.updatedAt, locale),
  });

  return (
    <>
      <div className="relative aspect-square overflow-hidden bg-mist-deep sm:aspect-video">
        <RecentWorkPreview item={item} workspaceId={workspaceId} />
      </div>
      <div className="grid min-w-0 content-center gap-1 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-bold text-ink">
            {item.title}
          </h3>
          <ArrowRightOutlined
            aria-hidden="true"
            className="mt-1 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary"
          />
        </div>
        <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-ui-label text-muted">
          <span className="truncate">{context}</span>
          <span aria-hidden="true">·</span>
          <time className="shrink-0" dateTime={item.updatedAt}>
            {activityTime}
          </time>
        </p>
        {item.draft.brand ? (
          <StatusTag className="mt-1 w-fit max-w-full truncate text-[10px]">
            {item.draft.brand.name}
          </StatusTag>
        ) : null}
      </div>
    </>
  );
}

function RecentWorkCard({
  item,
  locale,
  workspaceId,
}: {
  readonly item: WorkspaceHomeRecentWork;
  readonly locale: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const className =
    "group grid min-w-0 grid-cols-[96px_minmax(0,1fr)] overflow-hidden rounded-card bg-paper text-ink no-underline shadow-[0_10px_28px_rgb(29_27_51_/_7%)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgb(29_27_51_/_12%)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary sm:block";
  const content = (
    <RecentWorkCardContent
      item={item}
      locale={locale}
      workspaceId={workspaceId}
    />
  );
  const ariaLabel = t("studio.home.openWork", {
    name: item.title,
  });

  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      params={{
        canvasDraftId: item.draft.id,
        workspaceId,
      }}
      search={{ importImage: false }}
      to="/w/$workspaceId/boards/$canvasDraftId"
    >
      {content}
    </Link>
  );
}

export function WorkspaceHomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = workspaceHomeRouteApi.useParams();

  return (
    <WorkspacePage
      pageTitle={t("studio.home.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <WorkspaceHomeContent
          canReadAgents={workspace.permissions.includes("agent.read")}
          canUseAgent={workspace.permissions.includes("agent.run")}
          canCreate={canCreateWorkspaceContent(workspace.permissions)}
          canReadBrand={workspace.permissions.includes("brand.read")}
          csrfToken={context.csrfToken}
          workspaceId={workspace.id}
        />
      )}
    </WorkspacePage>
  );
}

function WorkspaceHomeContent({
  canCreate,
  canReadAgents,
  canUseAgent,
  canReadBrand,
  csrfToken,
  workspaceId,
}: {
  readonly canCreate: boolean;
  readonly canReadAgents: boolean;
  readonly canUseAgent: boolean;
  readonly canReadBrand: boolean;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const agentDraftKey = `kanvas:agent-composer:${workspaceId}:new`;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const [agentMessage, setAgentMessage] = useState(() => {
    try {
      return sessionStorage.getItem(agentDraftKey) ?? "";
    } catch {
      return "";
    }
  });
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentErrorKey, setAgentErrorKey] = useState<string>();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const drafts = useQuery({
    queryKey: ["canvas-drafts", workspaceId, RECENT_WORK_LIMIT],
    queryFn: () => fetchCanvasDrafts(workspaceId, RECENT_WORK_LIMIT),
    retry: false,
  });
  const agents = useQuery({
    queryKey: ["agent-hub-agents", workspaceId],
    queryFn: () => fetchAgentHubAgents(workspaceId),
    enabled: canReadAgents,
    retry: false,
  });
  const threads = useQuery({
    queryKey: ["agent-threads", workspaceId, "recent"],
    queryFn: () => fetchAgentThreads(workspaceId, { limit: RECENT_WORK_LIMIT }),
    enabled: canUseAgent,
    retry: false,
  });
  const brandChoice = useWorkspaceBrandChoiceV1({
    canReadBrand,
    workspaceId,
  });
  const brandChoicePending = canReadBrand && brandChoice.brands.isPending;
  const agentAttachments = useAgentComposerAttachments({
    csrfToken,
    draftKey: agentDraftKey,
    workspaceId,
    onError: () => setAgentErrorKey("studio.home.agentAttachmentError"),
  });
  const agentBusy = agentSubmitting || agentAttachments.busy;
  const draftItems = drafts.data?.items ?? emptyCanvasDrafts;
  const recentWork = useMemo(
    () => workspaceHomeRecentWork(draftItems, RECENT_WORK_LIMIT),
    [draftItems],
  );
  const recentPending = recentWork.length === 0 && drafts.isPending;
  const recentFailed = drafts.isError;
  const showRecent = recentWork.length > 0 || recentPending || recentFailed;
  const showReadOnlyEmpty =
    !canCreate && !recentPending && !recentFailed && recentWork.length === 0;
  const retrying = drafts.isFetching;
  const homeAgentItems =
    agents.data?.items.filter((item) => item.resourceState === "enabled") ?? [];
  let homeAgentList: React.JSX.Element;
  if (agents.isPending) {
    homeAgentList = (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Skeleton active key={item} />
        ))}
      </div>
    );
  } else if (homeAgentItems.length > 0) {
    homeAgentList = (
      <div className="grid gap-3 md:grid-cols-3">
        {homeAgentItems.slice(0, HOME_AGENT_LIMIT).map((agent) => (
          <Link
            className="rounded-2xl border border-line/70 bg-paper p-4 text-ink no-underline transition hover:border-primary/40"
            key={agent.id}
            params={{ workspaceId }}
            search={{ agentDefinitionId: agent.id }}
            to="/w/$workspaceId/agent"
          >
            <h3 className="m-0 text-base font-bold">{agent.displayName}</h3>
            <p className="mb-0 mt-2 line-clamp-2 text-sm text-muted">
              {agentDisplaySummary(agent, t("agent.hub.defaultAgentSummary"))}
            </p>
          </Link>
        ))}
      </div>
    );
  } else {
    homeAgentList = (
      <Empty
        description={t("agent.hub.emptyAgents")}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  function changeAgentMessage(value: string): void {
    setAgentMessage(value);
    try {
      if (value) sessionStorage.setItem(agentDraftKey, value);
      else sessionStorage.removeItem(agentDraftKey);
    } catch {
      // The in-memory draft remains usable when browser storage is unavailable.
    }
  }

  function openBlankCanvas(): void {
    void navigate({
      params: {
        canvasDraftId: "new",
        workspaceId,
      },
      search: {
        importImage: false,
        ...(brandChoice.selection.brandKitRevisionId
          ? {
              brandKitRevisionId: brandChoice.selection.brandKitRevisionId,
            }
          : { withoutBrand: true }),
      },
      to: "/w/$workspaceId/boards/$canvasDraftId",
    });
  }

  function importImages(files: readonly File[]): void {
    const issue = canvasImportFileIssue(files);
    if (issue) {
      setImportError(t(`studio.create.fileErrors.${issue}`));
      return;
    }
    setImportError(undefined);
    const importToken = stageCanvasImportFiles(files);
    void navigate({
      params: {
        canvasDraftId: "new",
        workspaceId,
      },
      search: {
        importImage: true,
        importToken,
        ...(brandChoice.selection.brandKitRevisionId
          ? {
              brandKitRevisionId: brandChoice.selection.brandKitRevisionId,
            }
          : { withoutBrand: true }),
      },
      to: "/w/$workspaceId/boards/$canvasDraftId",
    });
  }

  function importSelectedImages(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) {
      importImages(files);
    }
  }

  function retryRecentThreads(): void {
    void threads.refetch();
  }

  function retryRecentWork(): void {
    if (drafts.isError) {
      void drafts.refetch();
    }
  }

  async function sendAgentMessage(): Promise<void> {
    const message = agentMessage.trim();
    if (!message || agentBusy || agentAttachments.hasError) return;
    setAgentSubmitting(true);
    setAgentErrorKey(undefined);
    try {
      const accepted = await createWorkspaceAgentMessage(
        { csrfToken, workspaceId },
        {
          message,
          ...(agentAttachments.references.length > 0
            ? { attachments: agentAttachments.references }
            : {}),
        },
        `agent-message:${crypto.randomUUID()}`,
      );
      changeAgentMessage("");
      agentAttachments.clearAttachments();
      await navigate({
        params: { workspaceId, threadId: accepted.threadId },
        to: "/w/$workspaceId/agent/$threadId",
      });
    } catch (error) {
      setAgentErrorKey(workspaceAgentErrorMessageKey(error));
    } finally {
      setAgentSubmitting(false);
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[1320px] animate-[studio-page-in_360ms_var(--ease-out-studio)]"
      onDragOver={(event) => {
        if (canUseAgent && agentComposerHasFilePayload(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (!canUseAgent || !agentComposerHasFilePayload(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        const files = agentComposerImageFiles(event.dataTransfer.files);
        if (files.length === 0) return;
        agentAttachments.addFiles(files);
      }}
      onPaste={(event) => {
        if (event.defaultPrevented || !canUseAgent) return;
        const files = agentComposerImageFiles(event.clipboardData.files);
        if (files.length === 0) return;
        event.preventDefault();
        agentAttachments.addFiles(files);
      }}
    >
      {importError ? (
        <Alert
          closable={{
            onClose: () => setImportError(undefined),
          }}
          className="mt-3"
          id="workspace-home-import-error"
          showIcon
          title={importError}
          type="error"
        />
      ) : null}

      {agentErrorKey ? (
        <Alert
          className="mt-3"
          showIcon
          title={t(agentErrorKey)}
          type="error"
        />
      ) : null}

      {canUseAgent ? (
        <section
          aria-label={t("studio.home.agentWelcome")}
          className="mx-auto flex w-full max-w-[960px] flex-col justify-center pb-8 pt-3"
        >
          <AgentComposer
            addAttachmentLabel={t("studio.home.agentAddAttachment")}
            ariaLabel={t("studio.home.agentInputLabel")}
            attachments={agentAttachments.attachments}
            disabled={agentSubmitting || agentAttachments.hasError}
            errorLabel={t("studio.home.agentAttachmentError")}
            onChange={changeAgentMessage}
            onFiles={agentAttachments.addFiles}
            onRemoveAttachment={agentAttachments.removeAttachment}
            onSend={() => void sendAgentMessage()}
            placeholder={t("studio.home.agentPlaceholder")}
            removeAttachmentLabel={t("studio.home.agentRemoveAttachment")}
            sendLabel={t("studio.home.agentSend")}
            uploadingLabel={t("studio.home.agentAttachmentUploading")}
            value={agentMessage}
          />
        </section>
      ) : null}

      {canUseAgent &&
      (threads.isPending || threads.isError || threads.data?.items.length) ? (
        <section
          aria-labelledby="workspace-home-threads-title"
          className="mb-8"
        >
          <header className="mb-3 flex items-center justify-between gap-4">
            <h2
              id="workspace-home-threads-title"
              className="m-0 text-base font-semibold text-ink"
            >
              {t("studio.home.recentThreads")}
            </h2>
            <Link params={{ workspaceId }} to="/w/$workspaceId/agent">
              {t("studio.home.viewAll")}
            </Link>
          </header>
          {threads.isPending ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : null}
          {threads.isError ? (
            <Alert
              showIcon
              type="error"
              title={t("studio.home.recentWorkError")}
              action={
                <Button
                  size="small"
                  loading={threads.isFetching}
                  onClick={retryRecentThreads}
                >
                  {t("studio.home.retry")}
                </Button>
              }
            />
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {threads.data?.items.map((thread) => (
              <Link
                key={thread.id}
                to="/w/$workspaceId/agent/$threadId"
                params={{ workspaceId, threadId: thread.id }}
                className="flex min-w-0 items-center gap-3 rounded-control border border-line/70 bg-paper px-4 py-3 text-ink no-underline transition-colors hover:bg-paper-hover focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {thread.title ?? t("agent.untitledThread")}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {homeUpdatedAt(thread.updatedAt, locale)}
                  </span>
                </span>
                {thread.latestRun?.lifecycleStatus === "failed" ||
                thread.latestRun?.lifecycleStatus === "waiting_approval" ||
                thread.latestRun?.lifecycleStatus === "waiting_for_user" ? (
                  <StatusTag tone="warning">
                    {t(
                      homeThreadAttentionKey(thread.latestRun.lifecycleStatus),
                    )}
                  </StatusTag>
                ) : null}
                {thread.latestRun?.lifecycleStatus === "running" ||
                thread.latestRun?.lifecycleStatus === "queued" ? (
                  <StatusTag tone="info">
                    {t("agent.threadState.working")}
                  </StatusTag>
                ) : null}
                <ArrowRightOutlined aria-hidden="true" className="text-muted" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {canReadAgents ? (
        <section aria-labelledby="workspace-home-agents-title" className="mb-8">
          <header className="mb-3 flex items-center justify-between gap-4">
            <h2
              className="m-0 text-base font-semibold text-ink"
              id="workspace-home-agents-title"
            >
              {t("agent.hub.agentsTitle")}
            </h2>
            <Link params={{ workspaceId }} to="/w/$workspaceId/agents">
              {t("studio.home.viewAll")}
            </Link>
          </header>
          {homeAgentList}
        </section>
      ) : null}

      {canCreate ? (
        <section
          aria-label={t("studio.home.directCreate")}
          className="mb-5 flex flex-wrap items-center gap-2"
        >
          <input
            accept="image/jpeg,image/png,image/webp"
            hidden
            multiple
            onChange={importSelectedImages}
            ref={imageInputRef}
            type="file"
          />
          <Button
            aria-describedby={
              importError ? "workspace-home-import-error" : undefined
            }
            disabled={brandChoicePending}
            icon={<PictureOutlined aria-hidden="true" />}
            onClick={() => imageInputRef.current?.click()}
          >
            {t("studio.home.openImage")}
          </Button>
          <Button
            disabled={brandChoicePending}
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={openBlankCanvas}
          >
            {t("studio.home.blankCanvas")}
          </Button>
        </section>
      ) : (
        <Alert
          icon={<LockOutlined aria-hidden="true" />}
          showIcon
          title={t("studio.home.readOnlyNotice")}
          type="info"
        />
      )}

      {showReadOnlyEmpty ? (
        <Empty
          className="mt-10 py-8"
          description={t("studio.home.readOnlyEmpty")}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : null}

      {showRecent ? (
        <section aria-labelledby="workspace-home-recent-title" className="mt-5">
          <header className="mb-4 flex items-center justify-between gap-4">
            <h2
              className="m-0 text-base font-semibold text-ink"
              id="workspace-home-recent-title"
            >
              {t("studio.home.recentWork")}
            </h2>
          </header>

          {recentFailed ? (
            <Alert
              action={
                <Button
                  icon={<ReloadOutlined aria-hidden="true" />}
                  loading={retrying}
                  onClick={retryRecentWork}
                  size="small"
                >
                  {retrying
                    ? t("studio.home.retrying")
                    : t("studio.home.retry")}
                </Button>
              }
              className="mb-4"
              showIcon
              title={t("studio.home.recentWorkError")}
              type="error"
            />
          ) : null}

          {recentPending ? (
            <div
              aria-label={t("studio.home.recentWorkLoading")}
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              role="status"
            >
              {Array.from({ length: RECENT_WORK_SKELETON_COUNT }, (_, item) => (
                <div
                  className="rounded-card bg-paper p-4 shadow-[0_10px_28px_rgb(29_27_51_/_7%)]"
                  key={item}
                >
                  <Skeleton active paragraph={{ rows: 2 }} />
                </div>
              ))}
            </div>
          ) : null}
          {!recentPending && recentWork.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
              {recentWork.map((item) => (
                <RecentWorkCard
                  item={item}
                  key={item.id}
                  locale={locale}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
