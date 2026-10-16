import { LibraryUseReferences } from "../resource-libraries/library-use-references.js";
import {
  ArrowDownOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  ExportOutlined,
  GlobalOutlined,
  LinkOutlined,
  LoadingOutlined,
  LeftOutlined,
  LayoutOutlined,
  ProfileOutlined,
  ReadOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { AgentThreadView } from "@kanvas/contracts/api";
import {
  AssistantRuntimeProvider,
  ActionBarPrimitive,
  AuiIf,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Typography } from "antd";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import "streamdown/styles.css";

import { fetchWorkflowRun } from "../../api/transport.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { StatusTag } from "../../components/status-tag.js";
import { InlineNotice } from "../../components/feedback.js";
import { cn } from "../../lib/cn.js";
import {
  AgentComposer,
  type AgentComposerAttachment,
} from "./agent-composer.js";
import { focusAgentComposer } from "./agent-focus.js";
import {
  AgentPendingMessageQueue,
  type AgentPendingMessageView,
  type AgentQueuePauseReason,
} from "./agent-pending-message-queue.js";
import type {
  AgentComposerReference,
  AgentComposerReferenceKind,
} from "./agent-composer-reference-picker.js";
import {
  AgentResultCard,
  AgentArtifactContextMenu,
} from "./agent-result-actions.js";
import { AgentQuestionCard } from "./agent-question-card.js";
import { AgentTaskFailure } from "./agent-task-failure.js";
import { agentCapabilityTaskQueryOptions } from "./agent-capability-task-query.js";
import { agentTaskDisplayText } from "./agent-task-presentation.js";
import { AgentRunStatus } from "./agent-run-status.js";
import { AgentResourceReference } from "./agent-resource-reference.js";
import {
  agentTaskPresentationStatus,
  agentTaskStatusTone,
} from "./agent-presentation.js";
import {
  workflowRunIsTerminalV1,
  workflowRunPollIntervalV1,
} from "../workflows/workflow-run-session-v1.js";

type AgentTask = AgentThreadView["tasks"][number];
type AgentRelatedContent = AgentThreadView["relatedContent"][number];
type UserMessageImageAttachment = AgentRelatedContent & {
  readonly artifactId: string;
};
type AgentMessage = AgentThreadView["messages"][number] & {
  readonly tasks: readonly AgentTask[];
};
type AssistantSource = {
  readonly url: string;
  readonly title?: string;
};
type AssistantToolActivityKind =
  | "canvas"
  | "inspectWork"
  | "other"
  | "production"
  | "skillRead"
  | "skillSearch"
  | "webSearch";
type AssistantToolActivity = {
  readonly count: number;
  readonly kind: AssistantToolActivityKind;
};

const assistantMarkdownControls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: true },
  image: false,
} as const;

const assistantMarkdownClassName = "agent-markdown min-w-0";
const reasoningFollowThreshold = 24;

function toolActivityKind(toolName: string): AssistantToolActivityKind {
  if (toolName === "skill_search") return "skillSearch";
  if (toolName === "skill" || toolName === "skill_read") return "skillRead";
  if (toolName === "web_search" || toolName === "google_search") {
    return "webSearch";
  }
  if (
    toolName === "thread.inspect-work" ||
    toolName === "thread_inspect-work" ||
    toolName === "thread_inspect_work"
  ) {
    return "inspectWork";
  }
  if (toolName.startsWith("canvas.") || toolName.startsWith("canvas_")) {
    return "canvas";
  }
  if (
    toolName.startsWith("workflow.propose.") ||
    toolName.startsWith("workflow_propose_")
  ) {
    return "production";
  }
  return "other";
}

function toolActivities(
  message: AgentMessage,
): readonly AssistantToolActivity[] {
  const counts = new Map<AssistantToolActivityKind, number>();
  for (const part of message.parts) {
    if (part.type !== "tool-call") continue;
    if (part.toolName === "ask_question") continue;
    const kind = toolActivityKind(part.toolName);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

function sourceLabel(source: AssistantSource): string {
  const title = source.title?.trim();
  if (title) return title;
  try {
    const url = new URL(source.url);
    const path = decodeURIComponent(url.pathname).replace(/\/$/u, "");
    return `${url.hostname}${path}`;
  } catch {
    return source.url;
  }
}

function sourceHostname(source: AssistantSource): string {
  const title = source.title?.trim();
  if (title && /^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(title)) return title;
  try {
    return new URL(source.url).hostname.replace(/^www\./u, "");
  } catch {
    return source.url;
  }
}

function isUserMessageImageAttachment(
  item: AgentRelatedContent,
): item is UserMessageImageAttachment {
  return (
    (item.kind === "asset" || item.kind === "artifact") &&
    Boolean(item.artifactId)
  );
}

function toThreadMessage(message: AgentMessage): ThreadMessageLike {
  type ContentPart = Exclude<ThreadMessageLike["content"], string>[number];
  const content: ContentPart[] = [];
  const activities = toolActivities(message);
  const sources = [
    ...new Map(
      message.parts
        .filter((part) => part.type === "source")
        .map((part) => [
          part.url,
          {
            url: part.url,
            ...(part.title ? { title: part.title } : {}),
          } satisfies AssistantSource,
        ]),
    ).values(),
  ];
  let toolActivityEmitted = false;
  let interactionsEmitted = false;
  const emitInteractions = (): void => {
    if (interactionsEmitted) return;
    interactionsEmitted = true;
    message.interactions?.forEach((interaction) => {
      content.push({ type: "data-interaction", data: interaction });
    });
  };
  for (const part of message.parts) {
    if (part.type === "text") {
      emitInteractions();
      content.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning") {
      content.push({ type: "data-reasoning", data: part.text });
    } else if (part.type === "source") {
      continue;
    } else if (!toolActivityEmitted && activities.length > 0) {
      toolActivityEmitted = true;
      content.push({ type: "data-tool-activity", data: activities });
    }
  }
  emitInteractions();
  if (message.libraryUses?.length)
    content.push({ type: "data-library-uses", data: message.libraryUses });
  if (sources.length > 0) {
    content.push({ type: "data-sources", data: sources });
  }
  if (message.branch) {
    content.push({ type: "data-branch", data: message.branch });
  }
  if (message.relatedContent.length > 0) {
    content.push({ type: "data-resources", data: message.relatedContent });
  }
  if (message.selectedSkill) {
    content.push({ type: "data-selected-skill", data: message.selectedSkill });
  }
  message.tasks.forEach((task) => {
    content.push({ type: "data-task", data: task });
  });
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content,
  };
}

function useStreamingDisclosure(streaming: boolean): {
  readonly markManual: () => void;
  readonly onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => void;
  readonly open: boolean;
} {
  const [open, setOpen] = useState(streaming);
  const manuallyToggledRef = useRef(false);
  useEffect(() => {
    if (!manuallyToggledRef.current) setOpen(streaming);
  }, [streaming]);
  return {
    open,
    markManual: () => {
      manuallyToggledRef.current = true;
    },
    onToggle: (event) => setOpen(event.currentTarget.open),
  };
}

function AssistantMarkdown({
  streaming,
  text,
}: {
  readonly streaming: boolean;
  readonly text: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const translations = useMemo(
    () => ({
      close: t("agent.markdown.close"),
      copied: t("agent.markdown.copied"),
      copyCode: t("agent.markdown.copyCode"),
      copyLink: t("agent.markdown.copyLink"),
      copyTable: t("agent.markdown.copyTable"),
      copyTableAsCsv: t("agent.markdown.copyTableAsCsv"),
      copyTableAsMarkdown: t("agent.markdown.copyTableAsMarkdown"),
      copyTableAsTsv: t("agent.markdown.copyTableAsTsv"),
      externalLinkWarning: t("agent.markdown.externalLinkWarning"),
      exitFullscreen: t("agent.markdown.exitFullscreen"),
      openExternalLink: t("agent.markdown.openExternalLink"),
      openLink: t("agent.markdown.openLink"),
      tableFormatCsv: t("agent.markdown.tableFormatCsv"),
      tableFormatMarkdown: t("agent.markdown.tableFormatMarkdown"),
      tableFormatTsv: t("agent.markdown.tableFormatTsv"),
      viewFullscreen: t("agent.markdown.viewFullscreen"),
    }),
    [t],
  );
  return (
    <Streamdown
      animated={
        streaming
          ? {
              animation: "fadeIn",
              duration: 120,
              maxBacklogMs: 140,
              sep: "char",
              stagger: 3,
            }
          : false
      }
      {...(streaming ? { caret: "circle" as const } : {})}
      className={assistantMarkdownClassName}
      codeBlockMaxHeight={420}
      controls={assistantMarkdownControls}
      dir="auto"
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      normalizeHtmlIndentation
      tableMaxHeight={360}
      translations={translations}
    >
      {text}
    </Streamdown>
  );
}

function ReasoningDisclosure({
  streaming,
  text,
}: {
  readonly streaming: boolean;
  readonly text: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const disclosure = useStreamingDisclosure(streaming);
  const bodyRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  useEffect(() => {
    const body = bodyRef.current;
    if (streaming && body && followsLatestRef.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [streaming, text]);
  function handleReasoningScroll(event: React.UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    followsLatestRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      reasoningFollowThreshold;
  }
  return (
    <details
      className="group m-0 overflow-hidden rounded-[12px] border border-ink/8 bg-mist/55 text-sm text-ink-muted open:bg-mist/75 open:text-ink"
      onToggle={disclosure.onToggle}
      open={disclosure.open}
    >
      <summary
        className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-[11px] px-3 py-2 font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        onClick={disclosure.markManual}
      >
        {streaming ? (
          <LoadingOutlined aria-hidden="true" spin />
        ) : (
          <BulbOutlined aria-hidden="true" />
        )}
        {t(streaming ? "agent.reasoningActive" : "agent.reasoning")}
      </summary>
      <div
        className="mx-3 mb-3 max-h-72 overflow-y-auto overscroll-contain border-t border-ink/8 pt-3 text-[13px] leading-6 text-ink-muted"
        onScroll={handleReasoningScroll}
        ref={bodyRef}
      >
        <Streamdown
          className="!space-y-3 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0"
          controls={false}
          dir="auto"
          isAnimating={streaming}
          mode={streaming ? "streaming" : "static"}
        >
          {text}
        </Streamdown>
      </div>
    </details>
  );
}

function ToolActivityIcon({
  kind,
}: {
  readonly kind: AssistantToolActivityKind;
}): React.JSX.Element {
  if (kind === "webSearch") return <GlobalOutlined aria-hidden="true" />;
  if (kind === "inspectWork") return <ProfileOutlined aria-hidden="true" />;
  if (kind === "canvas") return <LayoutOutlined aria-hidden="true" />;
  if (kind === "production") return <ThunderboltOutlined aria-hidden="true" />;
  if (kind === "skillRead") return <ReadOutlined aria-hidden="true" />;
  if (kind === "skillSearch") return <SearchOutlined aria-hidden="true" />;
  return <ToolOutlined aria-hidden="true" />;
}

function ToolActivityStateIcon({
  state,
}: {
  readonly state: "done" | "stopped" | "working";
}): React.JSX.Element {
  if (state === "working") return <LoadingOutlined aria-hidden="true" spin />;
  if (state === "stopped") {
    return <CloseCircleOutlined aria-hidden="true" className="text-danger" />;
  }
  return <CheckCircleOutlined aria-hidden="true" className="text-positive" />;
}

function ToolActivityDisclosure({
  activities,
  failed,
  streaming,
}: {
  readonly activities: readonly AssistantToolActivity[];
  readonly failed: boolean;
  readonly streaming: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const disclosure = useStreamingDisclosure(streaming);
  const count = activities.reduce(
    (total, activity) => total + activity.count,
    0,
  );
  let state: "done" | "stopped" | "working" = "done";
  if (streaming) state = "working";
  else if (failed) state = "stopped";
  return (
    <details
      className="m-0 w-fit max-w-full text-xs text-ink-muted"
      onToggle={disclosure.onToggle}
      open={disclosure.open}
    >
      <summary
        className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-[9px] pr-2 outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        onClick={disclosure.markManual}
      >
        <ToolOutlined aria-hidden="true" />
        {t(streaming ? "agent.toolActivityRunning" : "agent.toolActivityDone", {
          count,
        })}
      </summary>
      <ul className="mt-1.5 grid list-none gap-1.5 pl-0" role="list">
        {activities.map((activity) => (
          <li
            className="flex min-h-8 items-center gap-2 rounded-[9px] bg-mist/70 px-2.5"
            key={activity.kind}
          >
            <span className="grid size-5 shrink-0 place-items-center text-primary">
              <ToolActivityIcon kind={activity.kind} />
            </span>
            <span className="min-w-0 flex-1 text-ink-muted">
              {t(`agent.toolKind.${activity.kind}`)}
              {activity.count > 1 ? ` × ${String(activity.count)}` : ""}
            </span>
            <span className="grid size-5 shrink-0 place-items-center">
              <ToolActivityStateIcon state={state} />
            </span>
            <span className="sr-only">{t(`agent.toolState.${state}`)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AssistantSources({
  sources,
}: {
  readonly sources: readonly AssistantSource[];
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("agent.sources", { count: sources.length })}
      className="m-0 grid max-w-[680px] gap-2.5"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <LinkOutlined aria-hidden="true" />
        {t("agent.sources", { count: sources.length })}
      </span>
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {sources.map((source, index) => {
          const label = sourceLabel(source);
          const hostname = sourceHostname(source);
          return (
            <li className="min-w-0" key={source.url}>
              <a
                aria-label={t("agent.openSource", {
                  index: index + 1,
                  title: label,
                })}
                className="group flex min-h-13 min-w-0 items-center gap-2.5 rounded-[11px] border border-line bg-paper px-2.5 py-2 text-ink no-underline transition-[border-color,background-color,transform] hover:border-line-strong hover:bg-mist/55 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transform-none"
                href={source.url}
                rel="noreferrer"
                target="_blank"
                title={label}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-mist text-[11px] font-semibold text-primary [font-variant-numeric:tabular-nums]"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">
                    {label}
                  </span>
                  {hostname === label ? null : (
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {hostname}
                    </span>
                  )}
                </span>
                <ExportOutlined
                  aria-hidden="true"
                  className="shrink-0 text-[11px] text-muted transition-colors group-hover:text-primary"
                />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function AssistantResourceGroup({
  inverse = false,
  items,
  onOpen,
  workspaceId,
}: {
  readonly inverse?: boolean;
  readonly items: AgentThreadView["relatedContent"];
  readonly onOpen: (item: AgentThreadView["relatedContent"][number]) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const uniqueItems = [
    ...new Map(
      items.map((item) => [`${item.kind}:${item.resourceId}`, item]),
    ).values(),
  ];
  return (
    <section aria-label={t("agent.relatedContent")} className="m-0">
      <h3
        className={cn(
          "m-0 mb-2 text-xs font-semibold text-ink-muted",
          inverse && "sr-only",
        )}
      >
        {t("agent.relatedContent")}
      </h3>
      <div className="grid max-w-[680px] gap-2 sm:grid-cols-2">
        {uniqueItems.map((item) => (
          <AgentResourceReference
            className="mt-0 w-full min-w-0 max-w-none"
            item={item}
            key={`${item.kind}:${item.resourceId}`}
            onOpen={onOpen}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </section>
  );
}

function UserMessageImageGallery({
  items,
  workspaceId,
  canSaveAsset,
  csrfToken,
}: {
  readonly items: readonly UserMessageImageAttachment[];
  readonly workspaceId: string;
  readonly canSaveAsset: boolean;
  readonly csrfToken?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const uniqueItems = [
    ...new Map(
      items.map((item) => [`${item.kind}:${item.resourceId}`, item]),
    ).values(),
  ];
  return (
    <section
      aria-label={t("agent.relatedContent")}
      className="mb-2 flex max-w-full flex-wrap justify-end gap-2"
      data-user-message-attachments
    >
      {uniqueItems.map((item) => {
        const title = item.title ?? t(`agent.resourceKind.${item.kind}`);
        return (
          <div
            className="grid w-max max-w-full shrink-0 justify-items-end gap-1"
            key={`${item.kind}:${item.resourceId}`}
          >
            <AgentArtifactContextMenu
              artifactId={item.artifactId}
              {...(item.assetId ? { assetId: item.assetId } : {})}
              {...(csrfToken ? { csrfToken } : {})}
              canSave={item.kind === "artifact" && canSaveAsset}
              name={title}
              workspaceId={workspaceId}
            >
              <ArtifactPreview
                alt={title}
                artifactId={item.artifactId}
                className="relative size-24 cursor-zoom-in overflow-hidden rounded-[14px] border border-line bg-mist shadow-[0_1px_2px_rgb(35_32_68_/_7%)] transition-[border-color] hover:border-line-strong sm:size-28 [&_.ant-image-mask]:rounded-[13px]"
                imageClassName="size-full object-cover"
                lazy
                previewable
                thumbnail
                workspaceId={workspaceId}
              />
            </AgentArtifactContextMenu>
          </div>
        );
      })}
    </section>
  );
}

function ResponseBranchControls({
  disabled,
  branch,
  messageId,
  onSelect,
}: {
  readonly disabled: boolean;
  readonly branch: NonNullable<AgentThreadView["messages"][number]["branch"]>;
  readonly messageId: string;
  readonly onSelect: (assistantMessageId: string) => Promise<void>;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (branch.count <= 1) return null;
  return (
    <div
      aria-label={t("agent.responseBranches")}
      className="ml-1 inline-flex min-h-8 items-center gap-1 text-xs text-ink-muted"
      role="group"
    >
      <button
        aria-label={t("agent.previousBranch")}
        className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 transition-colors hover:bg-mist disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        disabled={disabled || !branch.previousMessageId}
        onClick={() =>
          branch.previousMessageId
            ? void onSelect(branch.previousMessageId)
            : undefined
        }
        type="button"
      >
        <LeftOutlined aria-hidden="true" />
      </button>
      <span aria-live="polite" className="min-w-9 text-center">
        {branch.index} / {branch.count}
      </span>
      <button
        aria-label={t("agent.nextBranch")}
        className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 transition-colors hover:bg-mist disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        disabled={
          disabled ||
          !branch.nextMessageId ||
          branch.nextMessageId === messageId
        }
        onClick={() =>
          branch.nextMessageId ? void onSelect(branch.nextMessageId) : undefined
        }
        type="button"
      >
        <RightOutlined aria-hidden="true" />
      </button>
    </div>
  );
}
function AgentTaskCard({
  canManageBrand,
  canDownloadArtifact,
  canSaveAsset,
  csrfToken,
  onContinueTask,
  onAddResultToComposer,
  canReadCapabilities,
  canManageModels,
  canReadWorkflow,
  canRunWorkflow,
  confirming,
  declining,
  onConfirm,
  onDecline,
  onOpen,
  task,
  workspaceId,
}: {
  readonly canManageBrand: boolean;
  readonly canDownloadArtifact: boolean;
  readonly canSaveAsset: boolean;
  readonly csrfToken?: string;
  readonly onContinueTask?: (task: AgentTask) => Promise<void>;
  readonly onAddResultToComposer?: (artifactId: string, title: string) => void;
  readonly canReadCapabilities: boolean;
  readonly canManageModels: boolean;
  readonly canReadWorkflow: boolean;
  readonly canRunWorkflow: boolean;
  readonly confirming: boolean;
  readonly declining: boolean;
  readonly onConfirm: (actionId: string) => Promise<void>;
  readonly onDecline: (actionId: string) => Promise<void>;
  readonly onOpen: (task: AgentTask) => void;
  readonly task: AgentTask;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const taskDisplay = agentTaskDisplayText(task, t);
  const queryClient = useQueryClient();
  const workflow = useQuery({
    queryKey: ["agent-workflow-task", workspaceId, task.workflowRunId],
    queryFn: () => fetchWorkflowRun(workspaceId, task.workflowRunId!),
    enabled: canReadWorkflow && Boolean(task.workflowRunId),
    refetchInterval: (query) => workflowRunPollIntervalV1(query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const capability = useQuery(
    agentCapabilityTaskQueryOptions(
      workspaceId,
      task.capabilityRunId,
      canReadCapabilities,
    ),
  );
  const capabilityTerminal = Boolean(
    capability.data &&
    ["completed", "failed", "cancelled"].includes(
      capability.data.lifecycleStatus,
    ),
  );
  const workflowTerminal = workflowRunIsTerminalV1(workflow.data);
  useEffect(() => {
    if (!workflowTerminal && !capabilityTerminal) return;
    void queryClient.invalidateQueries({
      queryKey: ["agent-thread", workspaceId],
    });
  }, [queryClient, workflowTerminal, capabilityTerminal, workspaceId]);
  const statusKey = agentTaskPresentationStatus(
    workflow.isError || capability.isError
      ? "unavailable"
      : task.lifecycleStatus,
    workflow.data?.lifecycleStatus,
    task.kind,
    capability.data?.lifecycleStatus ?? task.capabilityRunStatus,
  );
  let confirmationLabel = "agent.confirmTask";
  if (task.kind === "brand")
    confirmationLabel =
      task.lifecycleStatus === "running"
        ? "agent.retryBrandPublication"
        : "agent.confirmBrandPublication";
  let approvalControl: React.JSX.Element | null = null;
  if (
    task.lifecycleStatus === "waiting_approval" ||
    (task.kind === "brand" && task.lifecycleStatus === "running" && !confirming)
  ) {
    approvalControl = (
      task.kind === "brand" ? canManageBrand : canRunWorkflow
    ) ? (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          loading={confirming}
          onClick={() => void onConfirm(task.id)}
          type="primary"
        >
          {t(confirmationLabel)}
        </Button>
        {task.lifecycleStatus === "waiting_approval" && (
          <Button
            disabled={confirming}
            loading={declining}
            onClick={() => void onDecline(task.id)}
          >
            {t(
              task.kind === "brand"
                ? "agent.declineBrandPublication"
                : "agent.declineTask",
            )}
          </Button>
        )}
      </div>
    ) : (
      <div className="mt-3">
        <p className="m-0 text-sm text-ink-muted">
          {t(
            task.kind === "brand"
              ? "agent.brandPublishPermissionRequired"
              : "agent.taskPermissionRequired",
          )}
        </p>
        {task.lifecycleStatus === "waiting_approval" && (
          <Button
            className="mt-2"
            loading={declining}
            onClick={() => void onDecline(task.id)}
          >
            {t("agent.declineTask")}
          </Button>
        )}
      </div>
    );
  }
  const resultImages =
    task.resultArtifacts?.filter(
      (artifact) => artifact.kind === "image" && artifact.state === "available",
    ) ?? [];

  return (
    <section className="m-0 w-fit max-w-full text-ink">
      <button
        className={cn(
          "flex min-h-8 w-fit max-w-full items-center gap-2 rounded-[9px] px-1.5 text-left text-xs text-ink-muted transition-colors hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
        onClick={() => onOpen(task)}
        type="button"
      >
        <ThunderboltOutlined aria-hidden="true" className="shrink-0" />
        <strong className="min-w-0 flex-1 truncate font-medium text-ink-muted">
          {taskDisplay.title}
        </strong>
        <StatusTag
          tone={
            capability.data?.externalResultUrls?.length
              ? "warning"
              : agentTaskStatusTone(statusKey)
          }
        >
          {t(
            capability.data?.externalResultUrls?.length
              ? "agent.taskFailure.externalResultTitle"
              : `agent.taskStatus.${statusKey}`,
          )}
        </StatusTag>
        <RightOutlined aria-hidden="true" className="shrink-0 text-[10px]" />
      </button>

      {statusKey === "failed" ? (
        <div className="mt-2">
          <AgentTaskFailure
            presentation="inline"
            onOpenDetails={() => onOpen(task)}
            agentRunId={task.agentRunId}
            workflowRunId={task.workflowRunId}
            {...(task.capabilityRunId
              ? { capabilityRunId: task.capabilityRunId }
              : {})}
            {...(workflow.data ? { run: workflow.data } : {})}
            workspaceId={workspaceId}
            canReadCapabilities={canReadCapabilities}
            canManageModels={canManageModels}
          />
        </div>
      ) : null}

      {resultImages.length > 0 ? (
        <section
          aria-label={t("agent.taskResult")}
          className={cn(
            "mt-3 grid max-w-[560px] gap-2",
            resultImages.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {resultImages.map((artifact, index) => {
            const title =
              artifact.title ??
              (resultImages.length > 1
                ? `${taskDisplay.title} · ${t("agent.taskResultNumber", { count: index + 1 })}`
                : taskDisplay.title);
            return (
              <AgentResultCard
                task={task}
                artifact={artifact}
                workspaceId={workspaceId}
                canDownload={canDownloadArtifact}
                canSave={canSaveAsset}
                key={artifact.resourceId}
                {...(csrfToken ? { csrfToken } : {})}
                {...(onAddResultToComposer &&
                task.lifecycleStatus === "succeeded"
                  ? {
                      onAddToComposer: () =>
                        onAddResultToComposer(artifact.resourceId, title),
                    }
                  : {})}
                {...(onContinueTask && task.lifecycleStatus === "succeeded"
                  ? { onEdit: onContinueTask }
                  : {})}
                onDetails={() => onOpen(task)}
              >
                <div className="relative aspect-square overflow-hidden rounded-[14px] bg-mist">
                  <ArtifactPreview
                    alt={t("agent.taskResultImage", {
                      title: taskDisplay.title,
                    })}
                    artifactId={artifact.resourceId}
                    className="size-full cursor-zoom-in"
                    imageClassName="size-full object-contain"
                    lazy
                    previewable
                    thumbnail
                    workspaceId={workspaceId}
                  />
                </div>
              </AgentResultCard>
            );
          })}
        </section>
      ) : null}

      {task.lifecycleStatus === "waiting_approval" &&
      taskDisplay.description ? (
        <p className="mt-2 mb-0 px-3 text-sm leading-6 text-ink-muted">
          {taskDisplay.description}
        </p>
      ) : null}
      {approvalControl}

      {workflow.isError ? (
        <p className="m-0 mt-2 px-3 text-xs text-ink-muted">
          {t("agent.taskUnavailable")}
        </p>
      ) : null}
    </section>
  );
}

export function MainAgentThread({
  onOpenDiagnostics,
  emptyAgentSummary,
  entryShortcuts,
  canManageBrand = false,
  canDownloadArtifact = false,
  canSaveAsset = false,
  csrfToken,
  onContinueTask,
  onAddResultToComposer,
  canReadCapabilities = false,
  canManageModels,
  canReadWorkflow,
  canRunWorkflow,
  composerAttachments,
  composerBusy = false,
  composerInputRef,
  composerReferences = [],
  composerReferenceKinds = [],
  composerValue,
  contextRailReserved = false,
  confirmingActionId,
  decliningActionId,
  failedRunId,
  activeRunAssistantMessageId,
  branchActionPending = false,
  isRunning,
  messages,
  onConfirm,
  onDecline,
  onComposerFiles,
  onComposerChange,
  onEditPendingMessage,
  onOpenComposerReferencePicker,
  onRemoveComposerAttachment,
  onRemoveComposerReference,
  onRemovePendingMessage,
  onOpenResource,
  onOpenTask,
  onReuseFailedRequest,
  onRegenerate,
  onResolveInteraction,
  onSelectBranch,
  onSend,
  onStop,
  onPauseQueue,
  onResumeQueue,
  onToggleQueueExpanded,
  pendingMessages = [],
  queueActive = false,
  queueExpanded = false,
  queuePaused = false,
  queuePauseReason,
  tasks,
  pendingCanvasTitle,
  pendingSelectionCount = 0,
  regeneratingMessageId,
  resolvingInteractionId,
  runStatus,
  runUpdatedAt,
  sendBlocked = false,
  sendDisabled = false,
  systemError,
  runFailureKind,
  workspaceId,
}: {
  readonly onOpenDiagnostics?: (runId: string) => void;
  readonly emptyAgentSummary?: string;
  readonly entryShortcuts?: ReactNode;
  readonly canDownloadArtifact?: boolean;
  readonly canSaveAsset?: boolean;
  readonly csrfToken?: string;
  readonly canManageBrand?: boolean;
  readonly onContinueTask?: (task: AgentTask) => Promise<void>;
  readonly onAddResultToComposer?: (artifactId: string, title: string) => void;
  readonly canReadCapabilities?: boolean;
  readonly canManageModels: boolean;
  readonly canReadWorkflow: boolean;
  readonly canRunWorkflow: boolean;
  readonly composerAttachments?: readonly AgentComposerAttachment[];
  readonly composerBusy?: boolean;
  readonly composerInputRef?: RefObject<HTMLTextAreaElement | null>;
  readonly composerReferences?: readonly AgentComposerReference[];
  readonly composerReferenceKinds?: readonly AgentComposerReferenceKind[];
  readonly composerValue: string;
  readonly contextRailReserved?: boolean;
  readonly confirmingActionId?: string;
  readonly decliningActionId?: string;
  readonly failedRunId?: string;
  readonly activeRunAssistantMessageId?: string;
  readonly branchActionPending?: boolean;
  readonly isRunning: boolean;
  readonly messages: AgentThreadView["messages"];
  readonly onConfirm: (actionId: string) => Promise<void>;
  readonly onDecline: (actionId: string) => Promise<void>;
  readonly onComposerFiles?: (files: readonly File[]) => void;
  readonly onComposerChange: (value: string) => void;
  readonly onEditPendingMessage?: (
    id: string,
  ) => boolean | void | Promise<boolean | void>;
  readonly onOpenComposerReferencePicker?: (
    kind: AgentComposerReferenceKind,
  ) => void;
  readonly onRemoveComposerAttachment?: (id: string) => void;
  readonly onRemoveComposerReference?: (id: string) => void;
  readonly onRemovePendingMessage?: (id: string) => void;
  readonly onOpenResource: (
    item: AgentThreadView["relatedContent"][number],
  ) => void;
  readonly onOpenTask: (task: AgentTask) => void;
  readonly onReuseFailedRequest?: () => void;
  readonly onRegenerate: (
    target:
      { readonly assistantMessageId: string } | { readonly agentRunId: string },
  ) => Promise<void>;
  readonly onResolveInteraction: React.ComponentProps<
    typeof AgentQuestionCard
  >["onResolve"];
  readonly onSelectBranch: (assistantMessageId: string) => Promise<void>;
  readonly onSend: (message: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
  readonly onPauseQueue?: () => boolean | void | Promise<boolean | void>;
  readonly onResumeQueue?: () => void;
  readonly onToggleQueueExpanded?: () => void;
  readonly pendingMessages?: readonly AgentPendingMessageView[];
  readonly queueActive?: boolean;
  readonly queueExpanded?: boolean;
  readonly queuePaused?: boolean;
  readonly queuePauseReason?: AgentQueuePauseReason;
  readonly tasks: AgentThreadView["tasks"];
  readonly pendingCanvasTitle?: string;
  readonly pendingSelectionCount?: number;
  readonly regeneratingMessageId?: string;
  readonly resolvingInteractionId?: string;
  readonly runStatus?: "queued" | "running";
  readonly runUpdatedAt?: string;
  readonly sendBlocked?: boolean;
  readonly sendDisabled?: boolean;
  readonly systemError?: string;
  readonly runFailureKind?:
    | "model_setup"
    | "budget"
    | "access_changed"
    | "tools_changed"
    | "limit"
    | "runtime";
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const visibleMessages = useMemo<readonly AgentMessage[]>(() => {
    const displayedMessages =
      isRunning && regeneratingMessageId
        ? messages.filter((message) => message.id !== regeneratingMessageId)
        : messages;
    return displayedMessages.map((message) => ({
      ...message,
      tasks: tasks.filter((task) => task.messageId === message.id),
    }));
  }, [isRunning, messages, regeneratingMessageId, tasks]);
  const runtime = useExternalStoreRuntime({
    messages: visibleMessages,
    convertMessage: toThreadMessage,
    isRunning,
    isSendDisabled: isRunning || sendBlocked || sendDisabled,
    onNew: () => Promise.resolve(),
  });
  const hasStreamingAssistant =
    isRunning &&
    visibleMessages.some(
      (message) =>
        message.id === activeRunAssistantMessageId &&
        message.role === "assistant",
    );
  const [sending, setSending] = useState(false);
  const queueMode = queueActive || isRunning || pendingMessages.length > 0;
  async function sendComposerMessage(): Promise<void> {
    const message = composerValue.trim();
    if (!message || composerBusy || sendBlocked || sendDisabled || sending)
      return;
    setSending(true);
    try {
      await onSend(message);
    } catch {
      /* The conversation host displays the send error and keeps the draft. */
    } finally {
      setSending(false);
      requestAnimationFrame(() =>
        focusAgentComposer(composerInputRef?.current),
      );
    }
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport
          autoScroll
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pt-5 sm:px-6 sm:pt-6",
            contextRailReserved && "xl:pr-[312px]",
          )}
          turnAnchor="top"
        >
          <div className="mx-auto w-full min-w-0 max-w-[880px]">
            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (
                  message.role === "assistant" &&
                  message.content.length === 0
                )
                  return null;
                const isStreamingMessage =
                  isRunning && message.id === activeRunAssistantMessageId;
                const isStreamingAssistant =
                  isStreamingMessage && message.role === "assistant";
                const messageFailed =
                  message.role === "assistant" &&
                  message.id === activeRunAssistantMessageId &&
                  Boolean(runFailureKind);
                const branchPart = message.content.find(
                  (part) => part.type === "data" && part.name === "branch",
                );
                const branch =
                  branchPart?.type === "data" && branchPart.name === "branch"
                    ? (branchPart.data as NonNullable<
                        AgentThreadView["messages"][number]["branch"]
                      >)
                    : undefined;
                const messageResourcesPart = message.content.find(
                  (part) => part.type === "data" && part.name === "resources",
                );
                const messageResources =
                  messageResourcesPart?.type === "data" &&
                  messageResourcesPart.name === "resources"
                    ? (messageResourcesPart.data as AgentThreadView["relatedContent"])
                    : [];
                const userImageAttachments =
                  message.role === "user"
                    ? messageResources.filter(isUserMessageImageAttachment)
                    : [];
                return (
                  <div
                    className={
                      message.role === "user"
                        ? "mb-8 ml-auto w-fit max-w-[calc(100vw-2rem)] [contain-intrinsic-size:auto_100px] [content-visibility:auto] sm:max-w-[min(68%,640px)]"
                        : "mb-10 w-full min-w-0 max-w-[780px] [contain-intrinsic-size:auto_240px] [content-visibility:auto]"
                    }
                    data-role={message.role}
                  >
                    {userImageAttachments.length > 0 ? (
                      <UserMessageImageGallery
                        items={userImageAttachments}
                        workspaceId={workspaceId}
                        canSaveAsset={canSaveAsset}
                        {...(csrfToken ? { csrfToken } : {})}
                      />
                    ) : null}
                    <article
                      aria-busy={isStreamingAssistant || undefined}
                      aria-label={
                        message.role === "assistant"
                          ? t("agent.assistantResponse")
                          : undefined
                      }
                      className={
                        message.role === "user"
                          ? "ml-auto w-fit max-w-full rounded-[15px] bg-mist px-4 py-3 text-[15px] leading-6 text-ink"
                          : "agent-message-content min-w-0 max-w-full text-[15px] leading-7 text-ink"
                      }
                    >
                      {message.content.map((part, partIndex) => {
                        if (part.type === "data" && part.name === "reasoning") {
                          return (
                            <ReasoningDisclosure
                              key={`reasoning:${String(partIndex)}`}
                              streaming={isStreamingAssistant}
                              text={String(part.data)}
                            />
                          );
                        }
                        if (
                          part.type === "data" &&
                          part.name === "tool-activity"
                        ) {
                          return (
                            <ToolActivityDisclosure
                              activities={
                                part.data as readonly AssistantToolActivity[]
                              }
                              failed={messageFailed}
                              key={`tool-activity:${String(partIndex)}`}
                              streaming={isStreamingAssistant}
                            />
                          );
                        }
                        if (part.type === "text") {
                          return message.role === "assistant" ? (
                            <AssistantMarkdown
                              key={`text:${String(partIndex)}`}
                              streaming={isStreamingAssistant}
                              text={part.text}
                            />
                          ) : (
                            <span
                              className="whitespace-pre-wrap"
                              key={`text:${String(partIndex)}`}
                            >
                              {part.text}
                            </span>
                          );
                        }
                        if (part.type === "data" && part.name === "task") {
                          const task = part.data as AgentTask;
                          return (
                            <AgentTaskCard
                              key={task.id}
                              canDownloadArtifact={canDownloadArtifact}
                              canSaveAsset={canSaveAsset}
                              {...(csrfToken ? { csrfToken } : {})}
                              {...(onContinueTask ? { onContinueTask } : {})}
                              {...(onAddResultToComposer
                                ? { onAddResultToComposer }
                                : {})}
                              canReadCapabilities={canReadCapabilities}
                              canManageModels={canManageModels}
                              canReadWorkflow={canReadWorkflow}
                              canRunWorkflow={canRunWorkflow}
                              canManageBrand={canManageBrand}
                              confirming={confirmingActionId === task.id}
                              declining={decliningActionId === task.id}
                              onConfirm={onConfirm}
                              onDecline={onDecline}
                              onOpen={onOpenTask}
                              task={task}
                              workspaceId={workspaceId}
                            />
                          );
                        }
                        if (
                          part.type === "data" &&
                          part.name === "interaction"
                        ) {
                          const interaction = part.data as NonNullable<
                            AgentThreadView["messages"][number]["interactions"]
                          >[number];
                          return (
                            <AgentQuestionCard
                              interaction={interaction}
                              key={interaction.id}
                              onResolve={onResolveInteraction}
                              resolving={
                                resolvingInteractionId === interaction.id
                              }
                            />
                          );
                        }
                        if (part.type === "data" && part.name === "resources") {
                          const items =
                            part.data as AgentThreadView["relatedContent"];
                          const visibleItems =
                            message.role === "user"
                              ? items.filter(
                                  (item) => !isUserMessageImageAttachment(item),
                                )
                              : items;
                          if (visibleItems.length === 0) return null;
                          return (
                            <AssistantResourceGroup
                              inverse={message.role === "user"}
                              items={visibleItems}
                              key={`resources:${String(partIndex)}`}
                              onOpen={onOpenResource}
                              workspaceId={workspaceId}
                            />
                          );
                        }
                        if (
                          part.type === "data" &&
                          part.name === "library-uses"
                        ) {
                          const uses = part.data as NonNullable<
                            AgentMessage["libraryUses"]
                          >;
                          return (
                            <LibraryUseReferences
                              key={`library-uses:${String(partIndex)}`}
                              workspaceId={workspaceId}
                              uses={uses}
                            />
                          );
                        }
                        if (
                          part.type === "data" &&
                          part.name === "selected-skill"
                        ) {
                          const skill = part.data as { name: string };
                          return (
                            <p
                              key={`skill:${String(partIndex)}`}
                              className="m-0 text-xs text-muted"
                            >
                              {t("agent.context.selectedSkill", {
                                name: skill.name,
                              })}
                            </p>
                          );
                        }
                        if (part.type === "data" && part.name === "branch") {
                          return null;
                        }
                        if (part.type === "data" && part.name === "sources") {
                          return (
                            <AssistantSources
                              key={`sources:${String(partIndex)}`}
                              sources={part.data as readonly AssistantSource[]}
                            />
                          );
                        }
                        return null;
                      })}
                    </article>
                    <div
                      className={cn(
                        "mt-1 flex min-h-8 items-center gap-0.5",
                        message.role === "user" && "justify-end",
                      )}
                    >
                      <ActionBarPrimitive.Root
                        aria-label={t("agent.messageActions")}
                        autohide="not-last"
                        autohideFloat="single-branch"
                        className="flex min-h-8 items-center gap-0.5 text-muted data-[floating=true]:rounded-[9px] data-[floating=true]:bg-paper data-[floating=true]:p-0.5 data-[floating=true]:shadow-sm"
                        hideWhenRunning
                        role="toolbar"
                      >
                        <ActionBarPrimitive.Copy
                          aria-label={t("agent.copyMessage")}
                          className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-muted transition-[background-color,color,transform] hover:bg-mist-deep hover:text-ink active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transform-none"
                          copiedDuration={1800}
                          title={t("agent.copyMessage")}
                        >
                          <AuiIf
                            condition={(state) =>
                              state.message.isCopied !== true
                            }
                          >
                            <CopyOutlined aria-hidden="true" />
                          </AuiIf>
                          <AuiIf
                            condition={(state) =>
                              state.message.isCopied === true
                            }
                          >
                            <CheckOutlined
                              aria-hidden="true"
                              className="text-positive"
                            />
                          </AuiIf>
                          <span aria-live="polite" className="sr-only">
                            <AuiIf
                              condition={(state) =>
                                state.message.isCopied === true
                              }
                            >
                              {t("agent.copied")}
                            </AuiIf>
                          </span>
                        </ActionBarPrimitive.Copy>
                        {message.role === "assistant" &&
                        runFailureKind !== "tools_changed" &&
                        runFailureKind !== "limit" ? (
                          <button
                            aria-label={t("agent.regenerate")}
                            className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-muted transition-[background-color,color,transform] hover:bg-mist-deep hover:text-ink active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transform-none"
                            onClick={() =>
                              void onRegenerate({
                                assistantMessageId: message.id,
                              }).finally(() =>
                                requestAnimationFrame(() =>
                                  focusAgentComposer(composerInputRef?.current),
                                ),
                              )
                            }
                            disabled={branchActionPending || isRunning}
                            title={t("agent.regenerate")}
                            type="button"
                          >
                            <ReloadOutlined aria-hidden="true" />
                          </button>
                        ) : null}
                      </ActionBarPrimitive.Root>
                      {message.role === "assistant" && branch && !isRunning ? (
                        <ResponseBranchControls
                          branch={branch}
                          messageId={message.id}
                          disabled={branchActionPending || isRunning}
                          onSelect={onSelectBranch}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              }}
            </ThreadPrimitive.Messages>
            {systemError ? (
              <InlineNotice
                tone="danger"
                title={systemError}
                className="mb-6 max-w-[780px]"
              />
            ) : null}
            {runFailureKind ? (
              <InlineNotice
                tone={runFailureKind === "limit" ? "warning" : "danger"}
                title={t(`agent.runFailure.${runFailureKind}.title`)}
                className="mb-8 max-w-[780px]"
                action={
                  <div className="flex flex-wrap gap-2">
                    {failedRunId && onOpenDiagnostics ? (
                      <Button
                        size="small"
                        onClick={() => onOpenDiagnostics(failedRunId)}
                      >
                        {t("agent.diagnostics.open")}
                      </Button>
                    ) : null}
                    {failedRunId &&
                    runFailureKind !== "tools_changed" &&
                    runFailureKind !== "limit" ? (
                      <Button
                        icon={<ReloadOutlined />}
                        disabled={branchActionPending || isRunning}
                        onClick={() =>
                          void onRegenerate({ agentRunId: failedRunId })
                        }
                        size="small"
                      >
                        {t("agent.runFailure.retry")}
                      </Button>
                    ) : null}
                    {runFailureKind === "tools_changed" &&
                    onReuseFailedRequest ? (
                      <Button
                        onClick={onReuseFailedRequest}
                        size="small"
                        type="primary"
                      >
                        {t("agent.runFailure.reuseRequest")}
                      </Button>
                    ) : null}
                    {runFailureKind === "model_setup" && canManageModels ? (
                      <Button
                        href={`/w/${workspaceId}/settings/models`}
                        size="small"
                      >
                        {t("agent.runFailure.openModels")}
                      </Button>
                    ) : null}
                  </div>
                }
              >
                <div className="grid gap-2">
                  <span>
                    {t(
                      `agent.runFailure.${runFailureKind}.${canManageModels ? "manager" : "member"}`,
                    )}
                  </span>
                  {failedRunId ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{t("agent.diagnostics.reference")}</span>
                      <Typography.Text
                        code
                        copyable={{
                          text: failedRunId,
                          tooltips: [
                            t("agent.diagnostics.copyReference"),
                            t("agent.diagnostics.referenceCopied"),
                          ],
                        }}
                      >
                        {failedRunId}
                      </Typography.Text>
                    </span>
                  ) : null}
                </div>
              </InlineNotice>
            ) : null}
            {isRunning && !hasStreamingAssistant ? (
              <AgentRunStatus
                {...(runStatus ? { status: runStatus } : {})}
                {...(runUpdatedAt ? { updatedAt: runUpdatedAt } : {})}
              />
            ) : null}
          </div>

          {messages.length > 0 ? (
            <ThreadPrimitive.ScrollToBottom
              aria-label={t("agent.scrollToBottom")}
              behavior="smooth"
              className="sticky bottom-24 z-10 mx-auto mb-2 grid size-9 shrink-0 place-items-center rounded-full border-0 bg-paper text-ink-muted shadow-[0_5px_18px_rgb(35_32_68_/_14%)] transition-[opacity,transform,background-color] hover:bg-mist active:scale-[0.96] disabled:pointer-events-none disabled:translate-y-1 disabled:opacity-0 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <ArrowDownOutlined aria-hidden="true" />
            </ThreadPrimitive.ScrollToBottom>
          ) : null}

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "sticky bottom-0 z-5 shrink-0 bg-gradient-to-t from-paper via-paper to-transparent pt-6 pb-5",
              messages.length === 0 ? "my-auto" : "mt-auto",
            )}
          >
            <div className="mx-auto w-full max-w-[880px]">
              {messages.length === 0 && emptyAgentSummary && !isRunning ? (
                <p className="mb-5 max-w-[44rem] text-sm leading-6 text-muted">
                  {emptyAgentSummary}
                </p>
              ) : null}
              <AgentPendingMessageQueue
                expanded={queueExpanded}
                messages={pendingMessages}
                {...(onEditPendingMessage
                  ? { onEditMessage: onEditPendingMessage }
                  : {})}
                {...(onPauseQueue ? { onPause: onPauseQueue } : {})}
                {...(onRemovePendingMessage
                  ? { onRemoveMessage: onRemovePendingMessage }
                  : {})}
                {...(onResumeQueue ? { onResume: onResumeQueue } : {})}
                {...(onToggleQueueExpanded
                  ? { onToggleExpanded: onToggleQueueExpanded }
                  : {})}
                {...(queuePauseReason ? { pauseReason: queuePauseReason } : {})}
                paused={queuePaused}
              />
              {pendingCanvasTitle ? (
                <div className="mb-2 flex items-center gap-2 rounded-[12px] bg-mist px-3 py-2 text-xs text-ink">
                  <strong className="min-w-0 truncate">
                    {pendingCanvasTitle}
                  </strong>
                  <span className="shrink-0 text-ink-muted">
                    {pendingSelectionCount > 0
                      ? t("agent.canvasSelectionCount", {
                          count: pendingSelectionCount,
                        })
                      : t("agent.canvasAttached")}
                  </span>
                </div>
              ) : null}
              {sending ? (
                <div
                  role="status"
                  className="mb-2 flex items-center gap-2 text-xs text-muted"
                >
                  <LoadingOutlined spin />
                  {t("agent.sendingMessage")}
                </div>
              ) : null}
              <AgentComposer
                workspaceId={workspaceId}
                addAttachmentLabel={t("agent.addAttachment")}
                addFileLabel={t("agent.addFile")}
                ariaLabel={t("agent.composerLabel")}
                {...(composerAttachments
                  ? { attachments: composerAttachments }
                  : {})}
                disabled={sendDisabled || sending}
                errorLabel={t("agent.attachmentError")}
                {...(composerInputRef ? { inputRef: composerInputRef } : {})}
                availableReferenceKinds={composerReferenceKinds}
                onChange={onComposerChange}
                {...(onComposerFiles ? { onFiles: onComposerFiles } : {})}
                {...(onOpenComposerReferencePicker
                  ? {
                      onOpenReferencePicker: onOpenComposerReferencePicker,
                    }
                  : {})}
                {...(onRemoveComposerAttachment
                  ? { onRemoveAttachment: onRemoveComposerAttachment }
                  : {})}
                {...(onRemoveComposerReference
                  ? { onRemoveReference: onRemoveComposerReference }
                  : {})}
                onSend={() => void sendComposerMessage()}
                onStop={() => void onStop()}
                placeholder={t("agent.composerPlaceholder")}
                removeAttachmentLabel={t("agent.removeAttachment")}
                removeReferenceLabel={t("agent.removeReference")}
                queueMode={queueMode}
                references={composerReferences}
                referenceKindLabels={{
                  asset: t("agent.referenceKind.asset"),
                  brand: t("agent.referenceKind.brand"),
                  library: t("agent.referenceKind.library"),
                  canvas: t("agent.referenceKind.canvas"),
                  skill: t("agent.referenceKind.skill"),
                  workflow: t("agent.referenceKind.workflow"),
                }}
                sendBlocked={
                  composerBusy || sendBlocked || sendDisabled || sending
                }
                sendLabel={t("agent.send")}
                stopLabel={t("agent.stop")}
                running={isRunning}
                uploadingLabel={t("agent.attachmentUploading")}
                value={composerValue}
              />
              {messages.length === 0 && !isRunning && entryShortcuts ? (
                <fieldset
                  disabled={sending}
                  className="m-0 min-w-0 border-0 p-0"
                >
                  {entryShortcuts}
                </fieldset>
              ) : null}
            </div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
