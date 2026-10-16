import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  FileImageOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import type {
  WorkflowRunSummary,
  WorkflowTemplate,
} from "@kanvas/contracts/api";
import { projectWorkflowAuthoringGraph } from "@kanvas/contracts/workflow-authoring";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Button, Empty, Segmented, Skeleton, Tag } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  fetchWorkflowAuthoringCapabilities,
  fetchWorkflowRuns,
  fetchWorkflowTemplate,
} from "../api/transport.js";
import { ArtifactPreview } from "../components/artifact-preview.js";
import { PageEmptyState } from "../components/feedback.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkflowModuleNav } from "../components/workflow-module-nav.js";
import {
  WorkflowAuthoringLink,
  WorkflowPageHeader,
} from "../components/workflow-page-header.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { workflowRunFinalArtifactsV1 } from "../features/workflows/workflow-run-artifacts-v1.js";
import {
  workflowRunsRefetchIntervalV1,
  type WorkflowRunsViewState,
} from "../features/workflows/workflow-runs-polling-v1.js";

const routeApi = getRouteApi("/w/$workspaceId/workflow-runs");
const PAGE_SIZE = 20;
const activeRunStatuses = new Set<WorkflowRunSummary["lifecycleStatus"]>([
  "queued",
  "running",
  "waiting",
  "cancelling",
]);

function formatRunDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function runStatusColor(
  status: WorkflowRunSummary["lifecycleStatus"],
): "error" | "processing" | "success" | "warning" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "waiting") return "warning";
  return "processing";
}

function RunPreview({
  artifactId,
  cover,
  name,
  workspaceId,
}: {
  readonly artifactId?: string;
  readonly cover?: NonNullable<WorkflowTemplate["presentation"]>["cover"];
  readonly name: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const preview = artifactId
    ? { artifactId, alt: t("workflows.runs.resultAlt", { name }) }
    : cover;
  if (preview) {
    return (
      <ArtifactPreview
        alt={preview.alt}
        artifactId={preview.artifactId}
        imageClassName="h-full w-full object-cover"
        lazy
        thumbnail
        workspaceId={workspaceId}
      />
    );
  }
  return (
    <span className="grid h-full w-full place-items-center bg-canvas text-white">
      <FileImageOutlined aria-hidden="true" className="text-6xl opacity-85" />
    </span>
  );
}

export function WorkflowRunsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = routeApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("workflows.runs.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ workspace }) => (
        <WorkflowRunsContent
          canAuthor={workspace.permissions.includes("workflow.author")}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

function WorkflowRunsContent({
  canAuthor,
  workspaceId,
}: {
  readonly canAuthor: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { state } = routeApi.useSearch();
  const runs = useInfiniteQuery({
    queryKey: ["workflow-runs", workspaceId, state],
    queryFn: ({ pageParam }) =>
      fetchWorkflowRuns(workspaceId, {
        ...(state === "all" ? {} : { state }),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      workflowRunsRefetchIntervalV1(state, Boolean(query.state.error)),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const items = useMemo(() => {
    const byId = new Map<string, WorkflowRunSummary>();
    for (const page of runs.data?.pages ?? []) {
      for (const item of page.items) byId.set(item.id, item);
    }
    return [...byId.values()];
  }, [runs.data?.pages]);
  const revisionIds = useMemo(
    () => [...new Set(items.map((item) => item.workflowRevisionId))],
    [items],
  );
  const templateQueries = useQueries({
    queries: revisionIds.map((workflowRevisionId) => ({
      queryKey: ["workflow-template", workspaceId, workflowRevisionId],
      queryFn: () => fetchWorkflowTemplate(workspaceId, workflowRevisionId),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const capabilities = useQuery({
    queryKey: ["workflow-authoring-capabilities", workspaceId],
    queryFn: () => fetchWorkflowAuthoringCapabilities(workspaceId),
    retry: false,
    staleTime: 60_000,
  });
  const templates = useMemo(
    () =>
      new Map(
        revisionIds.flatMap((id, index) => {
          const template = templateQueries[index]?.data;
          return template ? [[id, template] as const] : [];
        }),
      ),
    [revisionIds, templateQueries],
  );
  const artifactIds = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of items) {
      const template = templates.get(item.workflowRevisionId);
      if (!template) continue;
      const graph = projectWorkflowAuthoringGraph({
        schemaVersion: 1,
        inputSchema: template.inputSchema,
        outputSchema: template.outputSchema,
        topology: template.topology,
      });
      const artifact = workflowRunFinalArtifactsV1(
        item,
        graph,
        capabilities.data?.items ?? [],
      )[0];
      if (artifact) result.set(item.id, artifact.artifactId);
    }
    return result;
  }, [capabilities.data?.items, items, templates]);
  const options = (["all", "active", "completed", "unfinished"] as const).map(
    (value) => ({
      label: t(`workflows.runs.tabs.${value}`),
      value,
    }),
  );

  function changeState(value: string | number): void {
    void navigate({
      to: "/w/$workspaceId/workflow-runs",
      params: { workspaceId },
      search: { state: value as WorkflowRunsViewState },
      replace: true,
    });
  }

  if (runs.isError) {
    return (
      <main className="mx-auto w-full max-w-320" id="kanvas-main-content">
        <WorkflowModuleNav active="runs" workspaceId={workspaceId} />
        <PageEmptyState
          action={() => void runs.refetch()}
          actionLabel={t("workflows.runs.reload")}
          title={t("workflows.runs.loadError")}
        >
          {t("workflows.runs.loadErrorDescription")}
        </PageEmptyState>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-320" id="kanvas-main-content">
      <WorkflowModuleNav active="runs" workspaceId={workspaceId} />
      <WorkflowPageHeader
        action={
          canAuthor ? (
            <WorkflowAuthoringLink workspaceId={workspaceId} />
          ) : undefined
        }
        title={t("workflows.runs.heading")}
      />
      <section
        aria-label={t("workflows.runs.filterLabel")}
        className="mb-7 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Segmented
          className="w-max bg-paper/55"
          classNames={{ label: "px-4" }}
          onChange={changeState}
          options={options}
          value={state}
        />
      </section>

      {(() => {
        if (runs.isPending) {
          return (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton.Node
                  active
                  className="!h-64 !w-full !rounded-[20px]"
                  key={index}
                />
              ))}
            </div>
          );
        }
        if (items.length === 0) {
          return (
            <Empty
              description={t(`workflows.runs.empty.${state}`)}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Link
                className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white no-underline hover:bg-primary-deep focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
                params={{ workspaceId }}
                to="/w/$workspaceId/workflow-templates"
              >
                <PlayCircleOutlined />
                {t("workflows.runs.start")}
              </Link>
            </Empty>
          );
        }
        if (state === "completed") {
          return (
            <section
              aria-label={t("workflows.runs.tabs.completed")}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {items.map((item) => {
                const template = templates.get(item.workflowRevisionId);
                return (
                  <Link
                    className="group grid min-w-0 overflow-hidden rounded-[20px] bg-paper text-ink no-underline shadow-[0_10px_30px_rgb(35_32_68_/_6%)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgb(35_32_68_/_11%)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
                    key={item.id}
                    params={{ workflowRunId: item.id, workspaceId }}
                    to="/w/$workspaceId/workflow-runs/$workflowRunId"
                  >
                    <span className="aspect-[4/3] overflow-hidden bg-canvas">
                      <RunPreview
                        name={item.displayName}
                        workspaceId={workspaceId}
                        {...(artifactIds.get(item.id)
                          ? { artifactId: artifactIds.get(item.id)! }
                          : {})}
                        {...(template?.presentation?.cover
                          ? { cover: template.presentation.cover }
                          : {})}
                      />
                    </span>
                    <span className="grid gap-2 p-4">
                      <strong className="truncate text-base text-ink">
                        {item.displayName}
                      </strong>
                      {item.brand ? (
                        <StatusTag className="w-fit max-w-full truncate text-[10px]">
                          {item.brand.name}
                        </StatusTag>
                      ) : null}
                      <span className="flex items-center justify-between gap-3 text-xs text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <ClockCircleOutlined />
                          {formatRunDate(item.createdAt, i18n.language)}
                        </span>
                        <ArrowRightOutlined className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </span>
                  </Link>
                );
              })}
            </section>
          );
        }
        return (
          <section
            aria-label={t(`workflows.runs.tabs.${state}`)}
            className="grid gap-3"
          >
            {items.map((item) => {
              const template = templates.get(item.workflowRevisionId);
              return (
                <Link
                  className="group grid min-w-0 grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[18px] bg-paper p-3 text-ink no-underline shadow-[0_8px_24px_rgb(35_32_68_/_5%)] transition-shadow hover:shadow-[0_14px_34px_rgb(35_32_68_/_10%)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary sm:grid-cols-[144px_minmax(0,1fr)_auto]"
                  key={item.id}
                  params={{ workflowRunId: item.id, workspaceId }}
                  to="/w/$workspaceId/workflow-runs/$workflowRunId"
                >
                  <span className="aspect-[4/3] overflow-hidden rounded-[12px] bg-canvas">
                    <RunPreview
                      name={item.displayName}
                      workspaceId={workspaceId}
                      {...(artifactIds.get(item.id)
                        ? { artifactId: artifactIds.get(item.id)! }
                        : {})}
                      {...(template?.presentation?.cover
                        ? { cover: template.presentation.cover }
                        : {})}
                    />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-base text-ink">
                      {item.displayName}
                    </strong>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Tag
                        className="!m-0"
                        color={runStatusColor(item.lifecycleStatus)}
                      >
                        {activeRunStatuses.has(item.lifecycleStatus) ? (
                          <LoadingOutlined spin />
                        ) : null}
                        {t(
                          `workflows.templateDetail.runStatus.${item.lifecycleStatus}`,
                        )}
                      </Tag>
                      {item.brand ? (
                        <StatusTag className="max-w-44 truncate text-[10px]">
                          {item.brand.name}
                        </StatusTag>
                      ) : null}
                      {formatRunDate(item.createdAt, i18n.language)}
                    </span>
                  </span>
                  <ArrowRightOutlined className="mr-2 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              );
            })}
          </section>
        );
      })()}

      {runs.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <Button
            loading={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
            size="large"
          >
            {t("workflows.runs.loadMore")}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
