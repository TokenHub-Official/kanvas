import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { WorkflowDefinitionSummary } from "@kanvas/contracts/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { Button, Empty, Modal, Tag } from "antd";
import {
  useDeferredValue,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  createWorkflowDraft,
  fetchWorkflowDefinitions,
} from "../api/transport.js";
import { PageEmptyState, PageLoading } from "../components/feedback.js";
import { KanvasInput, KanvasSearchInput } from "../components/kanvas-input.js";
import { useToast } from "../components/toast.js";
import {
  WorkflowAuthoringBreadcrumb,
  WorkflowPageHeader,
} from "../components/workflow-page-header.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { queryClient } from "../query-client.js";

const routeApi = getRouteApi("/w/$workspaceId/workflows");

export function newcomerWorkflowDefinitions(
  items: readonly WorkflowDefinitionSummary[],
): readonly WorkflowDefinitionSummary[] {
  return items.filter(
    (item) => item.displayName !== item.workflowKey || item.draft !== undefined,
  );
}

export function searchWorkflowDefinitions(
  items: readonly WorkflowDefinitionSummary[],
  query: string,
): readonly WorkflowDefinitionSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    [item.displayName, item.description, item.category].some((value) =>
      value?.toLocaleLowerCase().includes(normalized),
    ),
  );
}

const WORKFLOW_KEY_MAX_LENGTH = 80;

function stableKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, WORKFLOW_KEY_MAX_LENGTH);
  return /^[a-z]/u.test(normalized)
    ? normalized
    : `workflow_${normalized || "untitled"}`;
}

export function WorkflowsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = routeApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("workflows.list.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <WorkflowsContent
          canAuthor={workspace.permissions.includes("workflow.author")}
          csrfToken={context.csrfToken}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

function WorkflowsContent({
  canAuthor,
  csrfToken,
  workspaceId,
}: {
  readonly canAuthor: boolean;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [creationChoiceOpen, setCreationChoiceOpen] = useState(false);
  const workflows = useQuery({
    queryKey: ["workflow-definitions", workspaceId],
    queryFn: () => fetchWorkflowDefinitions(workspaceId, { limit: 100 }),
    retry: false,
  });
  const create = useMutation({
    mutationFn: async () => {
      const displayName = name.trim() || t("workflows.list.untitled");
      const workflowKey = stableKey(displayName);
      return createWorkflowDraft(
        { csrfToken, workspaceId },
        {
          workflowKey,
          displayName,
          document: {
            schemaVersion: 1,
            topology: {
              schemaVersion: 1,
              key: workflowKey,
              entryNodeKey: "review",
              limits: {
                maxNodeRuns: 50,
                timeoutMs: 900_000,
              },
              nodes: [
                {
                  key: "review",
                  kind: "approval",
                  request: {
                    title: displayName,
                    message: t("workflows.list.approvalMessage"),
                  },
                  decisionSchema: {
                    type: "object",
                    properties: {
                      approved: {
                        type: "boolean",
                        title: t(
                          "workflows.editor.approvalDecisionApprovedTitle",
                        ),
                      },
                    },
                    required: ["approved"],
                    additionalProperties: false,
                  },
                  next: ["review_outcome"],
                },
                {
                  key: "review_outcome",
                  kind: "switch",
                  value: {
                    $value: {
                      source: "node_output",
                      nodeKey: "review",
                      scope: "root",
                      pointer: "/approved",
                    },
                  },
                  cases: [
                    { when: { operator: "equals", value: true }, next: [] },
                  ],
                  defaultNext: [],
                },
              ],
              outputs: {},
            },
            inputSchema: {
              type: "object",
              additionalProperties: true,
            },
            outputSchema: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        ulid(),
      );
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ["workflow-definitions", workspaceId],
      });
      await navigate({
        to: "/w/$workspaceId/workflows/$workflowDefinitionId",
        params: {
          workspaceId,
          workflowDefinitionId: result.value.definition.id,
        },
      });
    },
    onError: () => {
      toast.notify({
        title: t("workflows.list.createError"),
        description: t("workflows.list.loadErrorDescription"),
        tone: "danger",
      });
    },
  });

  function submitWorkflow(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  function openCreationChoice(): void {
    setCreationChoiceOpen(true);
  }

  function closeCreationChoice(): void {
    setCreationChoiceOpen(false);
  }

  function updateName(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.currentTarget.value);
  }

  function updateQuery(event: ChangeEvent<HTMLInputElement>): void {
    setQuery(event.currentTarget.value);
  }

  if (workflows.isPending) {
    return <PageLoading label={t("workflows.list.loading")} />;
  }
  if (workflows.isError) {
    return (
      <PageEmptyState
        action={() => void workflows.refetch()}
        actionLabel={t("workflows.list.reload")}
        title={t("workflows.list.loadError")}
      >
        {workflows.error instanceof Error
          ? workflows.error.message
          : t("workflows.list.loadErrorDescription")}
      </PageEmptyState>
    );
  }

  const catalogWorkflows = newcomerWorkflowDefinitions(workflows.data.items);
  const visibleWorkflows = searchWorkflowDefinitions(
    catalogWorkflows,
    deferredQuery,
  );

  return (
    <main className="mx-auto w-full max-w-320 pb-18" id="kanvas-main-content">
      <WorkflowAuthoringBreadcrumb workspaceId={workspaceId} />
      <WorkflowPageHeader
        action={
          canAuthor ? (
            <Button
              icon={<PlusOutlined />}
              onClick={openCreationChoice}
              size="large"
              type="primary"
            >
              {t("workflows.list.create")}
            </Button>
          ) : undefined
        }
        title={t("workflows.list.heading")}
      />
      {catalogWorkflows.length > 0 ? (
        <section
          aria-label={t("workflows.list.searchLabel")}
          className="mb-7 w-full md:max-w-130"
        >
          <KanvasSearchInput
            allowClear
            aria-label={t("workflows.list.searchLabel")}
            onChange={updateQuery}
            placeholder={t("workflows.list.searchPlaceholder")}
            size="large"
            value={query}
          />
        </section>
      ) : null}

      {(() => {
        if (catalogWorkflows.length === 0) {
          return (
            <section className="rounded-[22px] bg-paper px-6 py-16 shadow-[0_10px_30px_rgb(35_32_68_/_5%)]">
              <Empty
                description={t(
                  canAuthor
                    ? "workflows.list.emptyDescription"
                    : "workflows.list.emptyReadonlyDescription",
                )}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                {canAuthor ? (
                  <Button onClick={openCreationChoice} type="primary">
                    <PlusOutlined />
                    {t("workflows.list.create")}
                  </Button>
                ) : null}
              </Empty>
            </section>
          );
        }
        if (visibleWorkflows.length === 0) {
          return (
            <section className="rounded-[22px] bg-paper px-6 py-16 shadow-[0_10px_30px_rgb(35_32_68_/_5%)]">
              <Empty
                description={t("workflows.list.noSearchResults", { query })}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </section>
          );
        }
        return (
          <section
            aria-label={t("workflows.list.tableLabel")}
            className="grid gap-3"
          >
            {visibleWorkflows.map((workflow) => (
              <Link
                aria-label={t("workflows.list.openAria", {
                  name: workflow.displayName,
                })}
                className="group grid min-w-0 gap-4 rounded-[18px] bg-paper px-5 py-5 text-ink no-underline shadow-[0_8px_24px_rgb(35_32_68_/_5%)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_14px_34px_rgb(35_32_68_/_10%)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={workflow.id}
                params={{
                  workspaceId,
                  workflowDefinitionId: workflow.id,
                }}
                to="/w/$workspaceId/workflows/$workflowDefinitionId"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-base font-semibold tracking-[-0.015em] text-ink transition-colors group-hover:text-primary">
                    {workflow.displayName}
                  </strong>
                  <span className="mt-1.5 block line-clamp-2 text-sm leading-5 text-muted">
                    {workflow.description ??
                      t("workflows.list.defaultDescription")}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-muted sm:justify-end">
                  <Tag
                    className="!m-0"
                    color={workflow.latestRevision ? "success" : "warning"}
                  >
                    {workflow.latestRevision
                      ? t("workflows.list.published")
                      : t("workflows.list.draft")}
                  </Tag>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <ClockCircleOutlined />
                    {new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(workflow.updatedAt))}
                  </span>
                  <ArrowRightOutlined className="text-primary transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </section>
        );
      })()}
      <Modal
        footer={null}
        onCancel={closeCreationChoice}
        open={creationChoiceOpen}
        title={t("workflows.list.startTitle")}
      >
        <div className="pt-2">
          <form className="grid gap-4" onSubmit={submitWorkflow}>
            <span className="grid gap-1">
              <strong className="text-sm text-ink">
                {t("workflows.list.startBasic")}
              </strong>
              <span className="text-xs leading-5 text-muted">
                {t("workflows.list.startBasicDescription")}
              </span>
            </span>
            <label className="grid gap-2 text-xs font-semibold text-ink">
              {t("workflows.list.createLabel")}
              <KanvasInput
                maxLength={240}
                onChange={updateName}
                placeholder={t("workflows.list.createPlaceholder")}
                size="large"
                value={name}
              />
            </label>
            <Button
              htmlType="submit"
              loading={create.isPending}
              size="large"
              type="primary"
            >
              {create.isPending
                ? t("workflows.list.creating")
                : t("workflows.list.startBasic")}
            </Button>
          </form>
        </div>
      </Modal>
    </main>
  );
}
