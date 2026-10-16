import { ArrowRightOutlined, FileImageOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowTemplate } from "@kanvas/contracts/api";

import { fetchWorkflowTemplates } from "../api/transport.js";
import { ArtifactPreview } from "../components/artifact-preview.js";
import { PageEmptyState, PageLoading } from "../components/feedback.js";
import { KanvasSearchInput } from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { WorkflowModuleNav } from "../components/workflow-module-nav.js";
import {
  WorkflowAuthoringLink,
  WorkflowPageHeader,
} from "../components/workflow-page-header.js";
import { WorkspacePage } from "../components/workspace-page.js";

const routeApi = getRouteApi("/w/$workspaceId/workflow-templates");

export function latestWorkflowTemplates(
  items: readonly WorkflowTemplate[],
): readonly WorkflowTemplate[] {
  const latest = new Map<string, WorkflowTemplate>();
  for (const item of items) {
    const current = latest.get(item.workflowKey);
    if (!current || item.revision > current.revision) {
      latest.set(item.workflowKey, item);
    }
  }
  return [...latest.values()];
}

export function newcomerWorkflowTemplates(
  items: readonly WorkflowTemplate[],
  includeTechnical = false,
): readonly WorkflowTemplate[] {
  const latest = latestWorkflowTemplates(items).filter(
    (item) => item.runtimeStatus === "enabled",
  );
  return includeTechnical
    ? latest
    : latest.filter((item) => item.displayName !== item.workflowKey);
}

export function WorkflowTemplatesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const [query, setQuery] = useState(search.q ?? "");
  const [category, setCategory] = useState(search.category ?? "");
  const deferredQuery = useDeferredValue(query.trim());

  function updateCategory(value: string): void {
    setCategory(value);
    void navigate({
      params: { workspaceId },
      replace: true,
      search: {
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(value ? { category: value } : {}),
      },
      to: "/w/$workspaceId/workflow-templates",
    });
  }

  function updateQuery(value: string): void {
    setQuery(value);
    void navigate({
      params: { workspaceId },
      replace: true,
      search: {
        ...(value.trim() ? { q: value.trim() } : {}),
        ...(category ? { category } : {}),
      },
      to: "/w/$workspaceId/workflow-templates",
    });
  }

  return (
    <WorkspacePage
      pageTitle={t("workflows.templates.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ workspace }) => (
        <TemplateCatalog
          canAuthor={workspace.permissions.includes("workflow.author")}
          category={category}
          onCategoryChange={updateCategory}
          onQueryChange={updateQuery}
          query={query}
          requestQuery={deferredQuery}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

function TemplateCatalog({
  canAuthor,
  category,
  onCategoryChange,
  onQueryChange,
  query,
  requestQuery,
  workspaceId,
}: {
  readonly canAuthor: boolean;
  readonly category: string;
  readonly onCategoryChange: (value: string) => void;
  readonly onQueryChange: (value: string) => void;
  readonly query: string;
  readonly requestQuery: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const templates = useQuery({
    queryKey: ["workflow-templates", workspaceId, requestQuery, category],
    queryFn: () =>
      fetchWorkflowTemplates(workspaceId, {
        ...(requestQuery ? { q: requestQuery } : {}),
        ...(category ? { category } : {}),
      }),
    retry: false,
  });
  if (templates.isPending) {
    return <PageLoading label={t("workflows.templates.loading")} />;
  }
  if (templates.isError) {
    return (
      <PageEmptyState
        action={() => void templates.refetch()}
        actionLabel={t("workflows.templates.reload")}
        title={t("workflows.templates.loadError")}
      >
        {t("workflows.templates.loadErrorDescription")}
      </PageEmptyState>
    );
  }
  const visibleTemplates = newcomerWorkflowTemplates(
    templates.data.items,
    Boolean(requestQuery),
  );
  return (
    <main className="mx-auto w-full max-w-320 pb-18" id="kanvas-main-content">
      <WorkflowModuleNav active="templates" workspaceId={workspaceId} />
      <WorkflowPageHeader
        action={
          canAuthor ? (
            <WorkflowAuthoringLink workspaceId={workspaceId} />
          ) : undefined
        }
        title={t("workflows.templates.heading")}
      />
      <section
        aria-label={t("workflows.templates.controlsLabel")}
        className="mb-7 flex flex-col gap-3 md:flex-row md:items-center"
      >
        <div className="w-full md:max-w-130">
          <KanvasSearchInput
            allowClear
            aria-label={t("workflows.templates.searchLabel")}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder={t("workflows.templates.searchPlaceholder")}
            size="large"
            value={query}
          />
        </div>
        <div className="w-full md:w-44">
          <KanvasSelect
            aria-label={t("workflows.templates.categoryLabel")}
            className="w-full"
            onChange={onCategoryChange}
            options={[
              {
                label: t("workflows.templates.allCategories"),
                value: "",
              },
              ...templates.data.categories.map((value) => ({
                label: value,
                value,
              })),
            ]}
            size="large"
            value={category}
          />
        </div>
      </section>

      {visibleTemplates.length === 0 ? (
        <section className="rounded-[20px] bg-paper px-6 py-16 text-center shadow-[0_10px_30px_rgb(35_32_68_/_5%)]">
          <h3>{t("workflows.templates.empty")}</h3>
          <p className="mt-2 text-sm text-muted">
            {t("workflows.templates.emptyDescription")}
          </p>
        </section>
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTemplates.map((item) => {
            const title = item.presentation?.title ?? item.displayName;
            const description =
              item.presentation?.description ??
              item.description ??
              t("workflows.templates.defaultDescription");
            const categoryLabel = item.presentation?.category ?? item.category;
            return (
              <Link
                aria-label={t("workflows.templates.openAria", {
                  name: title,
                })}
                className="group grid min-w-0 overflow-hidden rounded-[22px] bg-paper text-ink no-underline shadow-[0_10px_30px_rgb(35_32_68_/_6%)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgb(35_32_68_/_12%)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
                key={item.workflowRevisionId}
                params={{
                  workspaceId,
                  workflowRevisionId: item.workflowRevisionId,
                }}
                to="/w/$workspaceId/workflow-templates/$workflowRevisionId"
              >
                <span className="aspect-[4/3] overflow-hidden bg-canvas">
                  {item.presentation?.cover ? (
                    <ArtifactPreview
                      alt={item.presentation.cover.alt}
                      artifactId={item.presentation.cover.artifactId}
                      imageClassName="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      lazy
                      thumbnail
                      workspaceId={workspaceId}
                    />
                  ) : (
                    <span className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(72_92_255_/_35%),transparent_42%),linear-gradient(145deg,#17182a,#292b4e)] text-white">
                      <FileImageOutlined
                        aria-hidden="true"
                        className="text-8xl opacity-90"
                      />
                    </span>
                  )}
                </span>
                <span className="grid min-w-0 gap-3 p-5">
                  {categoryLabel ? (
                    <span className="text-xs font-semibold tracking-wide text-primary">
                      {categoryLabel}
                    </span>
                  ) : null}
                  <span className="grid gap-2">
                    <strong className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">
                      {title}
                    </strong>
                    <span className="line-clamp-2 min-h-10 text-sm leading-5 text-muted">
                      {description}
                    </span>
                  </span>
                  <span className="mt-1 inline-flex items-center justify-between text-sm font-semibold text-primary">
                    {t("workflows.templates.open")}
                    <ArrowRightOutlined className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </span>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
