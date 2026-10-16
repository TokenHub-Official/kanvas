import { ProviderResultRecovery } from "../features/agent/provider-result-recovery.js";
import { AgentExternalResults } from "../features/agent/agent-task-failure.js";
import { agentCapabilityTaskQueryOptions } from "../features/agent/agent-capability-task-query.js";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { OperationalTimeline } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Spin } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { httpStatus } from "../api/http-status.js";
import {
  ApiProblem,
  fetchOperationalTimeline,
  fetchTaskTimeline,
} from "../api/transport.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { StatusBadge } from "../components/status-badge.js";
import { WorkspacePage } from "../components/workspace-page.js";
import {
  isOperationalIssue,
  operationalEventSummary,
  operationalEventTitle,
  operationalEventTone,
  operationalResponseStructureSummary,
  operationalStateLabel,
} from "../features/operations/operational-timeline-model.js";
import { cn } from "../lib/cn.js";

const operationsRouteApi = getRouteApi(
  "/w/$workspaceId/settings/runs/$workflowRunId",
);
const eventPageSize = 50;
const RUN_ID_DISPLAY_SUFFIX_LENGTH = 8;
const remediationLinkClassName =
  "inline-flex min-h-8 items-center justify-center rounded-control bg-[var(--control-fill-rest)] px-3 text-xs font-bold text-ink transition-[background-color,color] hover:bg-[var(--control-fill-hover)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";

const sourceLabelKeys: Record<
  OperationalTimeline["items"][number]["source"],
  string
> = {
  workflow_run: "workflow",
  node_run: "node",
  capability_run: "capability",
  capability_attempt: "attempt",
  outbox_event: "outbox",
  inbox_receipt: "inbox",
  provider_invocation: "providerCall",
  provider_observation: "providerObservation",
  usage_ledger: "usage",
  budget_reservation: "budgetReservation",
  budget_ledger: "budgetLedger",
  artifact_commit: "artifact",
  audit_event: "audit",
};

type OperationsView = "key" | "issues" | "all";

function isKeyOperationalEvent(
  item: OperationalTimeline["items"][number],
): boolean {
  return (
    isOperationalIssue(item) ||
    !["audit_event", "outbox_event", "inbox_receipt"].includes(item.source)
  );
}

function factValue(value: string | number | boolean | null): string {
  if (value === null) {
    return "null";
  }
  return typeof value === "string" ? value : String(value);
}

export function OperationsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId, workflowRunId } = operationsRouteApi.useParams();
  const search = operationsRouteApi.useSearch();
  return (
    <WorkspacePage pageTitle={t("operations.title")} workspaceId={workspaceId}>
      {({ workspace }) => (
        <OperationsContent
          key={`${search.kind ?? "workflow"}:${workflowRunId}`}
          kind={search.kind ?? "workflow"}
          canConfigureRoutes={workspace.permissions.includes(
            "capability.configure",
          )}
          canManageProviders={workspace.permissions.includes(
            "credential.manage",
          )}
          canReadUsage={workspace.permissions.includes("usage.read")}
          canReadCapabilities={workspace.permissions.includes("capability.run")}
          {...(search.returnTo ? { returnTo: search.returnTo } : {})}
          workflowRunId={workflowRunId}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

export function OperationsContent({
  embedded = false,
  onReturn,
  kind = "workflow",
  canConfigureRoutes,
  canManageProviders,
  canReadUsage,
  canReadCapabilities = false,
  returnTo,
  workflowRunId,
  workspaceId,
}: {
  readonly embedded?: boolean;
  readonly onReturn?: () => void;
  readonly kind?: "workflow" | "capability";
  readonly canConfigureRoutes: boolean;
  readonly canManageProviders: boolean;
  readonly canReadUsage: boolean;
  readonly canReadCapabilities?: boolean;
  readonly returnTo?: string;
  readonly workflowRunId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const [view, setView] = useState<OperationsView>("key");
  const [visibleEventLimit, setVisibleEventLimit] = useState(eventPageSize);
  const capability = useQuery({
    ...agentCapabilityTaskQueryOptions(
      workspaceId,
      kind === "capability" ? workflowRunId : undefined,
      canReadCapabilities,
    ),
    refetchInterval: false,
  });
  const timeline = useQuery<
    Pick<OperationalTimeline, "items" | "generatedAt" | "truncated">
  >({
    queryKey: ["operational-timeline", workspaceId, kind, workflowRunId],
    queryFn: () =>
      kind === "capability"
        ? fetchTaskTimeline(workspaceId, kind, workflowRunId)
        : fetchOperationalTimeline(workspaceId, workflowRunId),
    retry: false,
  });
  const timelineRecovery = usePageQueryRecovery(timeline.refetch);

  if (timeline.isPending) {
    return (
      <div className="flex min-h-90 items-center justify-center gap-2.5 text-xs text-muted">
        <Spin aria-hidden="true" size="small" />
        {t("operations.loading")}
      </div>
    );
  }
  if (timeline.isError && !timeline.data) {
    const notFound =
      timeline.error instanceof ApiProblem &&
      timeline.error.status === httpStatus.notFound;
    const forbidden =
      timeline.error instanceof ApiProblem &&
      timeline.error.status === httpStatus.forbidden;
    let actionLabel = t("operations.reload");
    let title = t("operations.loadErrorTitle");
    let description = t("operations.loadErrorDescription");
    if (notFound) {
      actionLabel = t("operations.return");
      title = t("operations.notFoundTitle");
      description = t("operations.notFoundDescription");
    } else if (forbidden) {
      actionLabel = t("operations.recheckPermission");
      title = t("operations.forbiddenTitle");
      description = t("operations.forbiddenDescription");
    }
    return (
      <EmptyState
        action={() => {
          if (notFound) {
            if (onReturn) {
              onReturn();
              return;
            }
            window.location.assign(returnTo ?? `/w/${workspaceId}/settings`);
            return;
          }
          if (forbidden) {
            window.location.reload();
            return;
          }
          timelineRecovery.retry();
        }}
        actionLabel={actionLabel}
        actionPending={!notFound && !forbidden && timelineRecovery.pending}
        title={title}
      >
        {description}
      </EmptyState>
    );
  }

  const workflowSnapshot = timeline.data.items.find(
    (item) =>
      item.source ===
        (kind === "capability" ? "capability_run" : "workflow_run") &&
      item.resourceId === workflowRunId,
  );
  const timelineItems = timeline.data.items.filter(
    (item) => item !== workflowSnapshot,
  );
  const workflowState = operationalStateLabel(
    workflowSnapshot?.outcome ?? workflowSnapshot?.status,
  );
  const orderedTimelineItems = [...timelineItems].reverse();
  const issueItems = orderedTimelineItems.filter(isOperationalIssue);
  const keyItems = orderedTimelineItems.filter(isKeyOperationalEvent);
  const issueCount = issueItems.length;
  const hasProviderIssue = issueItems.some(
    (item) =>
      item.source === "provider_invocation" ||
      item.source === "provider_observation",
  );
  const hasUsageIssue = issueItems.some(
    (item) =>
      item.source === "budget_reservation" ||
      item.source === "budget_ledger" ||
      item.source === "usage_ledger",
  );
  const hasExecutionIssue = issueItems.some(
    (item) =>
      item.source === "capability_run" ||
      item.source === "capability_attempt" ||
      item.source === "node_run",
  );
  let selectedItems = keyItems;
  if (view === "issues") {
    selectedItems = issueItems;
  } else if (view === "all") {
    selectedItems = orderedTimelineItems;
  }
  const visibleItems =
    view === "issues"
      ? selectedItems
      : selectedItems.slice(0, visibleEventLimit);
  const hasMoreVisibleEvents =
    view !== "issues" && visibleEventLimit < selectedItems.length;
  const returnLabel = returnTo?.includes("/settings/usage")
    ? t("operations.returnToUsage")
    : t("operations.returnToSettings");

  function selectTimelineView(nextView: OperationsView): void {
    setView(nextView);
    setVisibleEventLimit(eventPageSize);
  }

  function refreshRecord(): void {
    void timeline.refetch();
    if (kind === "capability" && canReadCapabilities) void capability.refetch();
  }

  return (
    <div className="mx-auto w-full max-w-[980px]">
      <header
        className={
          embedded
            ? "pb-5"
            : "grid grid-cols-[120px_minmax(0,1fr)] items-start gap-5 pt-3.5 pb-[34px] max-[760px]:grid-cols-[minmax(0,1fr)_auto]"
        }
      >
        {!embedded ? (
          <Button
            className="max-[760px]:col-span-full max-[760px]:justify-self-start"
            onClick={() => {
              window.location.assign(returnTo ?? `/w/${workspaceId}/settings`);
            }}
            type="text"
          >
            <ArrowLeftOutlined aria-hidden="true" />
            {returnLabel}
          </Button>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              className={
                embedded
                  ? "m-0 text-base font-semibold"
                  : "m-0 text-[clamp(28px,3.5vw,44px)] leading-[1.05] tracking-[-0.045em]"
              }
            >
              {embedded
                ? t("operations.title")
                : t("operations.runTitle", {
                    id: workflowRunId.slice(-RUN_ID_DISPLAY_SUFFIX_LENGTH),
                  })}
            </h2>
            <span className="mt-2.5 block text-xs text-muted">
              {t("operations.eventMeta", {
                count: timelineItems.length,
                date: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(new Date(timeline.data.generatedAt)),
              })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              color="default"
              loading={timeline.isFetching}
              onClick={refreshRecord}
              variant="filled"
            >
              <ReloadOutlined aria-hidden="true" />
              {t("operations.refresh")}
            </Button>
          </div>
        </div>
      </header>

      {kind === "capability" ? (
        <div className="mb-6 grid gap-4">
          {canReadCapabilities &&
          capability.data?.externalResultUrls?.length ? (
            <AgentExternalResults urls={capability.data.externalResultUrls} />
          ) : null}
          <ProviderResultRecovery
            workspaceId={workspaceId}
            runId={workflowRunId}
          />
        </div>
      ) : null}
      <section
        aria-label={t("operations.outcomeLabel")}
        className="mb-6 rounded-card bg-paper p-5 shadow-[0_8px_24px_rgb(35_32_68_/_5%)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-lg">
              {workflowState ?? t("operations.unknownState")}
            </strong>
            {!workflowState ? (
              <p className="mt-1 text-xs leading-5 text-muted">
                {t("operations.noSnapshot")}
              </p>
            ) : null}
          </div>
          <span className="text-xs font-bold text-muted">
            {t("operations.keyEventCount", {
              count: keyItems.length,
            })}
          </span>
        </div>
      </section>

      <div
        aria-label={t("operations.viewLabel")}
        className="mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-control bg-paper/70 p-1 shadow-sm"
        role="group"
      >
        {(
          [
            ["key", t("operations.views.key"), keyItems.length],
            ...(issueCount > 0
              ? ([
                  ["issues", t("operations.views.issues"), issueCount],
                ] as const)
              : []),
            ["all", t("operations.views.all"), orderedTimelineItems.length],
          ] as const
        ).map(([value, label, count]) => (
          <Button
            aria-pressed={view === value}
            key={value}
            onClick={() => selectTimelineView(value)}
            size="small"
            type={view === value ? "primary" : "text"}
          >
            {label} · {count}
          </Button>
        ))}
      </div>

      {issueCount > 0 &&
      (canConfigureRoutes || canManageProviders || canReadUsage) ? (
        <section
          aria-labelledby="operations-remediation-title"
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-card bg-paper px-5 py-4 shadow-[0_8px_24px_rgb(35_32_68_/_5%)]"
        >
          <div>
            <h3
              className="m-0 text-[13px] font-bold"
              id="operations-remediation-title"
            >
              {t("operations.remediation.title")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("operations.remediation.description")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageProviders && hasProviderIssue ? (
              <Link
                className={remediationLinkClassName}
                params={{ workspaceId }}
                to="/w/$workspaceId/settings/providers"
              >
                {t("operations.remediation.providers")}
              </Link>
            ) : null}
            {canConfigureRoutes && (hasExecutionIssue || hasProviderIssue) ? (
              <Link
                className={remediationLinkClassName}
                params={{ workspaceId }}
                to="/w/$workspaceId/settings/capabilities"
              >
                {t("operations.remediation.execution")}
              </Link>
            ) : null}
            {canReadUsage && hasUsageIssue ? (
              <Link
                className={remediationLinkClassName}
                params={{ workspaceId }}
                to="/w/$workspaceId/settings/usage"
              >
                {t("operations.remediation.usage")}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {timeline.data.truncated ? (
        <InlineNotice className="mb-6" title={t("operations.truncatedTitle")}>
          {t("operations.truncatedDescription", {
            count: timelineItems.length,
          })}
        </InlineNotice>
      ) : null}

      {timeline.isRefetchError ? (
        <InlineNotice
          className="mb-6"
          title={t("operations.refreshErrorTitle")}
          tone="danger"
        >
          <p>{t("operations.refreshErrorDescription")}</p>
          {timeline.error instanceof ApiProblem &&
          timeline.error.status === httpStatus.forbidden ? (
            <Button
              className="mt-3"
              color="default"
              onClick={() => {
                window.location.reload();
              }}
              variant="filled"
            >
              {t("operations.recheckPermission")}
            </Button>
          ) : null}
        </InlineNotice>
      ) : null}

      {timelineItems.length === 0 ? (
        <EmptyState
          action={() => {
            void timeline.refetch();
          }}
          actionLabel={t("operations.refresh")}
          title={t("operations.emptyTitle")}
        >
          {t("operations.emptyDescription")}
        </EmptyState>
      ) : null}
      {timelineItems.length > 0 && visibleItems.length === 0 ? (
        <EmptyState
          action={() => {
            setView("key");
          }}
          actionLabel={t("operations.viewKeyEvents")}
          title={t("operations.noIssuesTitle")}
        >
          {t("operations.noIssuesDescription")}
        </EmptyState>
      ) : null}
      {visibleItems.length > 0 ? (
        <div className="grid">
          {visibleItems.map((item) => {
            const tone = operationalEventTone(item);
            const summary = operationalEventSummary(item);
            const state = operationalStateLabel(item.outcome ?? item.status);
            let toneIcon = <InfoCircleOutlined aria-hidden="true" />;
            if (tone === "positive") {
              toneIcon = <CheckCircleOutlined aria-hidden="true" />;
            } else if (tone === "danger" || tone === "warning") {
              toneIcon = <ExclamationCircleOutlined aria-hidden="true" />;
            }
            return (
              <article
                className="operations-event grid grid-cols-[38px_minmax(0,1fr)] gap-3.5 last:[&_.operations-event-rail]:after:hidden max-[760px]:grid-cols-[28px_minmax(0,1fr)] max-[760px]:gap-[9px]"
                key={`${item.source}:${item.id}`}
              >
                <div className="operations-event-rail relative flex justify-center after:absolute after:top-[38px] after:bottom-0 after:z-0 after:w-px after:bg-line after:content-['']">
                  <span
                    className={cn(
                      "relative z-10 grid size-[34px] place-items-center rounded-[11px] border border-line bg-paper text-primary max-[760px]:size-7 max-[760px]:rounded-[9px]",
                      tone === "positive" &&
                        "border-positive/25 bg-positive-surface text-positive",
                      tone === "warning" &&
                        "border-[var(--warning)]/25 bg-[var(--warning-surface)] text-[var(--warning)]",
                      tone === "danger" &&
                        "border-danger/25 bg-danger-surface text-danger",
                    )}
                  >
                    {toneIcon}
                  </span>
                </div>
                <div className="mb-3.5 rounded-card bg-paper p-[17px] shadow-[0_8px_24px_rgb(35_32_68_/_5%)]">
                  <header className="flex items-start justify-between gap-5">
                    <div>
                      <h3 className="m-0 text-[13px]">
                        {operationalEventTitle(item)}
                      </h3>
                      {summary ? (
                        <p className="mt-1.5 text-xs leading-5 text-muted">
                          {summary}
                        </p>
                      ) : null}
                    </div>
                    <time
                      className="text-xs text-muted [font-variant-numeric:tabular-nums]"
                      dateTime={item.occurredAt}
                    >
                      {new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(item.occurredAt))}
                    </time>
                  </header>
                  {state ? (
                    <div className="mt-3 flex flex-wrap gap-[7px]">
                      <StatusBadge tone={tone}>{state}</StatusBadge>
                    </div>
                  ) : null}
                  <details className="mt-3 border-t border-line">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 pt-3 text-xs font-bold text-muted focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                      <InfoCircleOutlined aria-hidden="true" />
                      {t("operations.technicalDetails")}
                    </summary>
                    <dl className="mt-2.5 grid gap-px overflow-hidden rounded-[9px] bg-line [&>div]:grid [&>div]:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] [&>div]:gap-3 [&>div]:bg-mist [&>div]:px-2.5 [&>div]:py-2 [&>div]:text-xs max-[760px]:[&>div]:grid-cols-1 max-[760px]:[&>div]:gap-[3px] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dd]:font-mono">
                      <div>
                        <dt>{t("operations.facts.source")}</dt>
                        <dd>
                          {t(
                            `operations.sources.${sourceLabelKeys[item.source]}`,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("operations.facts.event")}</dt>
                        <dd>{item.kind}</dd>
                      </div>
                      <div>
                        <dt>{t("operations.facts.resource")}</dt>
                        <dd>
                          {item.resourceType} · {item.resourceId}
                        </dd>
                      </div>
                      {item.status ? (
                        <div>
                          <dt>{t("operations.facts.rawStatus")}</dt>
                          <dd>{item.status}</dd>
                        </div>
                      ) : null}
                      {item.outcome ? (
                        <div>
                          <dt>{t("operations.facts.rawOutcome")}</dt>
                          <dd>{item.outcome}</dd>
                        </div>
                      ) : null}
                      {Object.entries(item.facts).map(([key, value]) => {
                        if (key === "responseStructure") {
                          const structureSummary =
                            operationalResponseStructureSummary(item);
                          return (
                            <div key={key}>
                              <dt>
                                {t("operations.facts.safeResponseStructure")}
                              </dt>
                              <dd className="grid gap-1 font-sans">
                                <span>
                                  {structureSummary ??
                                    t("operations.facts.structureUnavailable")}
                                </span>
                                <code className="text-[11px] text-muted [overflow-wrap:anywhere]">
                                  {factValue(value)}
                                </code>
                              </dd>
                            </div>
                          );
                        }
                        return (
                          <div key={key}>
                            <dt>
                              {t(`operations.facts.${key}`, {
                                defaultValue: key,
                              })}
                            </dt>
                            <dd>{factValue(value)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {view !== "issues" && selectedItems.length > eventPageSize ? (
        <div className="flex justify-center py-5">
          <Button
            disabled={!hasMoreVisibleEvents}
            onClick={() => {
              setVisibleEventLimit((current) =>
                Math.min(current + eventPageSize, selectedItems.length),
              );
            }}
            type="text"
          >
            {hasMoreVisibleEvents
              ? t("operations.showMore", {
                  count: selectedItems.length - visibleItems.length,
                })
              : t("operations.allShown")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
