import {
  BgColorsOutlined,
  BranchesOutlined,
  FileImageOutlined,
  LayoutOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchWorkflowRun } from "../../api/transport.js";
import { StatusTag } from "../../components/status-tag.js";
import { cn } from "../../lib/cn.js";
import {
  agentCardClassName,
  agentCardIconClassName,
  agentTaskPresentationStatus,
  agentTaskStatusTone,
} from "./agent-presentation.js";
import {
  agentWorkbenchEntryKey,
  type AgentWorkbenchEntry,
  type AgentWorkbenchResource,
} from "./agent-resource-workbench.js";
import { agentTaskDisplayText } from "./agent-task-presentation.js";
import { workflowRunPollIntervalV1 } from "../workflows/workflow-run-session-v1.js";

type AgentWorkbenchTaskEntry = Extract<
  AgentWorkbenchEntry,
  { readonly entryKind: "task" }
>;

export function latestAgentShelfTaskGroups(
  entries: readonly AgentWorkbenchEntry[],
): readonly {
  readonly entry: AgentWorkbenchTaskEntry;
  readonly attemptCount: number;
}[] {
  const groups = new Map<
    string,
    { readonly entry: AgentWorkbenchTaskEntry; readonly attemptCount: number }
  >();
  for (const entry of entries) {
    if (entry.entryKind !== "task") continue;
    const task = entry.task;
    const key = `${task.kind}:${task.id}`;
    groups.set(key, {
      entry,
      attemptCount: (groups.get(key)?.attemptCount ?? 0) + 1,
    });
  }
  return [...groups.values()];
}

function ResourceIcon({
  kind,
}: {
  readonly kind: AgentWorkbenchResource["kind"];
}): React.JSX.Element {
  if (kind === "canvas") return <LayoutOutlined aria-hidden="true" />;
  if (kind === "workflow") return <BranchesOutlined aria-hidden="true" />;
  if (kind === "brand") return <BgColorsOutlined aria-hidden="true" />;
  return <FileImageOutlined aria-hidden="true" />;
}

function TaskShelfButton({
  attemptCount,
  entry,
  onOpen,
  workspaceId,
}: {
  readonly attemptCount: number;
  readonly entry: AgentWorkbenchTaskEntry;
  readonly onOpen: (entry: AgentWorkbenchEntry) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const taskDisplay = agentTaskDisplayText(entry.task, t);
  const workflow = useQuery({
    queryKey: ["agent-workflow-task", workspaceId, entry.task.workflowRunId],
    queryFn: () => fetchWorkflowRun(workspaceId, entry.task.workflowRunId!),
    enabled: Boolean(entry.task.workflowRunId),
    refetchInterval: (query) => workflowRunPollIntervalV1(query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const status = agentTaskPresentationStatus(
    entry.task.lifecycleStatus,
    workflow.data?.lifecycleStatus,
    entry.task.kind,
    entry.task.capabilityRunStatus,
  );
  return (
    <button
      className={cn(
        agentCardClassName,
        "w-full min-w-0 max-w-full bg-paper/70 hover:bg-paper",
      )}
      onClick={() => onOpen(entry)}
      type="button"
    >
      <span className={cn(agentCardIconClassName, "bg-mist-deep")}>
        <ThunderboltOutlined aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block break-words text-xs leading-4 font-semibold whitespace-normal text-ink">
          {taskDisplay.title}
        </strong>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusTag
            className="shrink-0 text-xs"
            tone={agentTaskStatusTone(status)}
          >
            {t(`agent.taskStatus.${status}`)}
          </StatusTag>
          {attemptCount > 1 ? (
            <span className="text-xs text-ink-muted">
              {t("agent.taskAttemptCount", { count: attemptCount })}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export function AgentContextShelf({
  entries,
  onOpen,
  workspaceId,
}: {
  readonly entries: readonly AgentWorkbenchEntry[];
  readonly onOpen: (entry: AgentWorkbenchEntry) => void;
  readonly workspaceId: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  const resources = entries.filter((entry) => entry.entryKind === "resource");
  const taskGroups = latestAgentShelfTaskGroups(entries);
  const visibleEntryCount = resources.length + taskGroups.length;
  return (
    <section
      aria-label={t("agent.contextShelf")}
      className="flex max-h-[min(70dvh,640px)] w-72 min-w-0 max-w-full flex-col overflow-hidden rounded-[16px] border border-line/70 bg-mist/95 p-3"
      id="agent-context-shelf-panel"
    >
      <header className="flex min-w-0 items-center justify-between gap-2 px-1 pb-2">
        <strong className="min-w-0 break-words text-sm text-ink">
          {t("agent.contextTitle")}
        </strong>
        <span className="mt-0.5 block shrink-0 text-xs text-ink-muted">
          {visibleEntryCount}
        </span>
      </header>

      <div className="min-h-0 w-full min-w-0 overflow-x-clip overflow-y-auto pr-1">
        {taskGroups.length > 0 ? (
          <section
            aria-labelledby="agent-context-tasks"
            className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
          >
            <h3
              className="m-0 min-w-0 px-1 pt-2 pb-1 text-xs font-bold text-ink-muted"
              id="agent-context-tasks"
            >
              {t("agent.contextTasks")}
            </h3>
            {taskGroups.map(({ attemptCount, entry }) => (
              <TaskShelfButton
                attemptCount={attemptCount}
                entry={entry}
                key={agentWorkbenchEntryKey(entry)}
                onOpen={onOpen}
                workspaceId={workspaceId}
              />
            ))}
          </section>
        ) : null}

        {resources.length > 0 ? (
          <details
            aria-labelledby="agent-context-resources"
            className="min-w-0"
          >
            <summary
              className="cursor-pointer px-1 pt-2 pb-1 text-xs font-medium text-muted"
              id="agent-context-resources"
            >
              {t("agent.contextResources")}
            </summary>
            <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
              {resources.map((entry) => {
                const resource = entry.resource;
                return (
                  <button
                    className={cn(
                      agentCardClassName,
                      "w-full min-w-0 max-w-full bg-paper/70 hover:bg-paper",
                    )}
                    key={agentWorkbenchEntryKey(entry)}
                    onClick={() => onOpen(entry)}
                    type="button"
                  >
                    <span
                      className={cn(agentCardIconClassName, "bg-mist-deep")}
                    >
                      <ResourceIcon kind={resource.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block break-words text-xs leading-4 font-semibold whitespace-normal text-ink">
                        {resource.title ??
                          t(`agent.resourceKind.${resource.kind}`)}
                      </strong>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {t(`agent.resourceKind.${resource.kind}`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
