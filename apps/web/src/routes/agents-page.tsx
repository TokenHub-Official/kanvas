import {
  ResourceActions,
  ResourceTrash,
  ResourceUnavailable,
} from "../components/resource-lifecycle.js";
import { ActionLink } from "../components/action-link.js";
import {
  ArrowLeftOutlined,
  BgColorsOutlined,
  BranchesOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  ReadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useParams,
  useSearch,
  useNavigate,
} from "@tanstack/react-router";
import {
  Alert,
  Empty,
  Skeleton,
  Tag,
  Tabs,
  Select,
  Input,
  Segmented,
  Button,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import { fetchAgentHubAgent, fetchAgentHubAgents } from "../api/transport.js";
import { AgentAvatar } from "../components/agent-avatar.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { agentDisplaySummary } from "../features/agent/agent-presentation.js";

const catalogRowClassName =
  "group relative grid grid-cols-[minmax(240px,1fr)_minmax(200px,240px)_80px_minmax(168px,max-content)] items-center gap-5 px-4 py-3 transition-colors duration-150 hover:bg-mist focus-within:bg-mist motion-reduce:transition-none max-[1100px]:grid-cols-[minmax(200px,1fr)_minmax(180px,220px)_minmax(160px,max-content)] max-[1100px]:gap-3 max-[767px]:grid-cols-1";
const catalogEntryLinkClassName =
  "after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:shadow-none focus-visible:after:outline-[3px] focus-visible:after:outline-offset-2 focus-visible:after:outline-primary focus-visible:after:shadow-[0_0_0_5px_var(--focus-halo)]";
const catalogActionClassName =
  "relative z-10 min-w-0 justify-self-end max-[767px]:col-start-1 max-[767px]:row-start-3 max-[767px]:w-full";

export function AgentsPage(): React.JSX.Element {
  return <AgentHubPage />;
}

export function AgentProfilePage(): React.JSX.Element {
  const { agentDefinitionId } = useParams({ strict: false });
  if (!agentDefinitionId)
    throw new Error("Agent profile route requires an Agent.");
  return <AgentHubPage selectedAgentId={agentDefinitionId} />;
}

function AgentHubPage({
  selectedAgentId,
}: {
  readonly selectedAgentId?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = useParams({ strict: false });
  if (!workspaceId) throw new Error("Agents route requires a Workspace.");
  return (
    <WorkspacePage
      pageTitle={t("agent.hub.agentsTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <AgentsContent
          csrfToken={context.csrfToken}
          canCreate={
            workspace.permissions.includes("agent.manage") &&
            workspace.permissions.includes("agent.publish")
          }
          canReadBrand={workspace.permissions.includes("brand.read")}
          canReadAssets={workspace.permissions.includes("asset.read")}
          canReadSkills={workspace.permissions.includes("skill.read")}
          canReadWorkflow={workspace.permissions.includes("workflow.read")}
          canManageModels={workspace.permissions.includes("credential.manage")}
          canRun={workspace.permissions.includes("agent.run")}
          currentHumanName={context.human.displayName}
          currentPrincipalId={context.human.principalId}
          {...(selectedAgentId ? { selectedAgentId } : {})}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

function AgentsContent({
  csrfToken,
  canCreate,
  canReadAssets,
  canReadBrand,
  canReadSkills,
  canReadWorkflow,
  canRun,
  canManageModels,
  currentHumanName,
  currentPrincipalId,
  selectedAgentId,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly canCreate: boolean;
  readonly canReadAssets: boolean;
  readonly canReadBrand: boolean;
  readonly canReadSkills: boolean;
  readonly canReadWorkflow: boolean;
  readonly canRun: boolean;
  readonly canManageModels: boolean;
  readonly currentHumanName: string;
  readonly currentPrincipalId: string;
  readonly selectedAgentId?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const [detailTab, setDetailTab] = useState<
    "overview" | "instructions" | "resources"
  >(
    search.tab === "resources" || search.tab === "instructions"
      ? search.tab
      : "instructions",
  );
  const agents = useQuery({
    queryKey: ["agent-hub-agents", workspaceId],
    queryFn: () => fetchAgentHubAgents(workspaceId),
    retry: false,
  });
  const selectedAgent = useQuery({
    queryKey: ["agent-hub-agent", workspaceId, selectedAgentId],
    queryFn: () => fetchAgentHubAgent(workspaceId, selectedAgentId!),
    enabled: Boolean(selectedAgentId),
    retry: false,
  });
  const agentItems = agents.data?.items ?? [];
  const [query, setQuery] = useState(search.q ?? "");
  const mine = search.scope === "mine";
  const listSearch = {
    ...(query ? { q: query } : {}),
    ...(mine ? { scope: "mine" as const } : {}),
  };
  const defaultAgent = agentItems.find((agent) => agent.isDefault);
  const workspaceDefaultSummary = t("agent.hub.defaultAgentSummary");
  const filteredAgents = agentItems.filter(
    (agent) =>
      !agent.isDefault &&
      (!mine || agent.ownerPrincipalId === currentPrincipalId) &&
      [agent.displayName, agent.summary, ...agent.tags].some((value) =>
        value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
  );
  const defaultAgentMatches = Boolean(
    !mine &&
    defaultAgent &&
    [
      defaultAgent.displayName,
      agentDisplaySummary(defaultAgent, workspaceDefaultSummary),
      ...defaultAgent.tags,
    ].some((value) =>
      value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  function filterAgents(q: string, onlyMine: boolean): void {
    setQuery(q);
    void navigate({
      to: "/w/$workspaceId/agents",
      params: { workspaceId },
      search: {
        ...(q ? { q } : {}),
        ...(onlyMine ? { scope: "mine" as const } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  }
  let agentList: React.JSX.Element;
  if (agents.isPending) {
    agentList = (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((value) => (
          <Skeleton active key={value} />
        ))}
      </div>
    );
  } else if (agents.isError) {
    agentList = (
      <Alert
        title={t("agent.hub.loadError")}
        showIcon
        type="error"
        action={
          <Button size="small" onClick={() => void agents.refetch()}>
            {t("agent.editor.retry")}
          </Button>
        }
      />
    );
  } else if (!defaultAgentMatches && filteredAgents.length === 0) {
    agentList = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t(
          query || mine ? "agent.editor.noMatches" : "agent.hub.emptyAgents",
        )}
      />
    );
  } else {
    const renderAgentList = (items: typeof agentItems) => (
      <div className="overflow-hidden rounded-xl bg-paper">
        {items.map((agent) => {
          const summary = agentDisplaySummary(agent, workspaceDefaultSummary);
          return (
            <article className={catalogRowClassName} key={agent.id}>
              <div className="flex min-w-0 items-start gap-3 overflow-hidden">
                <AgentAvatar
                  isDefault={agent.isDefault}
                  alt=""
                  {...(agent.avatar ? { avatar: agent.avatar } : {})}
                  canReadAssets={canReadAssets}
                  workspaceId={workspaceId}
                  className="size-9 shrink-0 rounded-lg text-base"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 min-w-0 max-w-full truncate text-sm leading-5 font-semibold">
                    <Link
                      to="/w/$workspaceId/agents/$agentDefinitionId"
                      params={{
                        workspaceId,
                        agentDefinitionId: agent.id,
                      }}
                      search={listSearch}
                      className={`${catalogEntryLinkClassName} inline-flex max-w-full min-w-0 items-center gap-2 rounded text-ink no-underline hover:text-primary`}
                    >
                      <span className="truncate">{agent.displayName}</span>
                      <RightOutlined
                        aria-hidden="true"
                        className="shrink-0 text-xs text-muted"
                      />
                    </Link>
                  </h3>
                  <p
                    className="m-0 mt-1 max-w-[60ch] truncate text-sm leading-5 text-muted"
                    title={summary}
                  >
                    {summary}
                  </p>
                </div>
              </div>

              <div className="grid min-w-0 gap-1 text-xs text-muted max-[767px]:col-start-1 max-[767px]:row-start-2">
                <div className="flex min-w-0 items-center gap-3">
                  {!agent.isDefault ? (
                    <span className="truncate">
                      {agent.ownerPrincipalId === currentPrincipalId
                        ? currentHumanName
                        : t("agent.hub.teamMember")}
                    </span>
                  ) : null}
                  <span className="shrink-0 whitespace-nowrap">
                    {t(`agent.hub.visibility.${agent.visibility}`)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="whitespace-nowrap">
                    {t("agent.design.skillCount", {
                      count: agent.boundSkillCount,
                    })}
                  </span>
                  {agent.resourceState === "disabled" && (
                    <StatusTag tone="warning">
                      {t("agent.lifecycle.disabled")}
                    </StatusTag>
                  )}
                  {agent.category ? (
                    <span className="max-w-32 truncate" title={agent.category}>
                      {agent.category}
                    </span>
                  ) : null}
                </div>
              </div>

              <time
                className="text-xs text-muted max-[1100px]:hidden"
                dateTime={agent.updatedAt}
              >
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(agent.updatedAt))}
              </time>

              <div
                className={`${catalogActionClassName} flex max-w-full flex-wrap items-center justify-end gap-1`}
              >
                <ResourceActions
                  workspaceId={workspaceId}
                  csrfToken={csrfToken}
                  kind="agent"
                  id={agent.id}
                  showStatus={false}
                />
                {canRun && agent.resourceState === "enabled" ? (
                  <ActionLink
                    className="min-h-8 max-w-full py-1.5 text-center leading-4"
                    styles={{ root: { height: "auto", whiteSpace: "normal" } }}
                    color="primary"
                    params={{ workspaceId }}
                    search={{ agentDefinitionId: agent.id }}
                    size="small"
                    to="/w/$workspaceId/agent"
                    variant="filled"
                  >
                    {t("agent.hub.useAgent")}
                  </ActionLink>
                ) : (
                  <span />
                )}
              </div>
            </article>
          );
        })}
      </div>
    );
    agentList = (
      <div className="grid gap-6">
        {defaultAgentMatches && defaultAgent ? (
          <section className="grid gap-2">
            <h2 className="m-0 text-sm font-semibold text-muted">
              {t("agent.hub.systemDefault")}
            </h2>
            {renderAgentList([defaultAgent])}
          </section>
        ) : null}
        {filteredAgents.length > 0 ? (
          <section className="grid gap-2">
            <h2 className="m-0 text-sm font-semibold text-muted">
              {t("agent.hub.customAgents")}
            </h2>
            {renderAgentList(filteredAgents)}
          </section>
        ) : null}
      </div>
    );
  }

  const detail = selectedAgent.data;
  const creatorName =
    detail && !detail.isDefault
      ? (detail.creatorDisplayName ??
        (detail.ownerPrincipalId === currentPrincipalId
          ? currentHumanName
          : t("agent.hub.teamMember")))
      : undefined;
  let content = agentList;
  if (selectedAgentId) {
    if (selectedAgent.isPending) {
      content = <Skeleton active paragraph={{ rows: 10 }} />;
    } else if (selectedAgent.isError || !detail) {
      content = (
        <div className="grid gap-3">
          <ResourceUnavailable
            workspaceId={workspaceId}
            csrfToken={csrfToken}
            kind="agent"
            id={selectedAgentId}
          >
            <Alert
              action={
                <ActionLink
                  params={{ workspaceId }}
                  to="/w/$workspaceId/agents"
                  size="small"
                >
                  {t("agent.hub.backToAgents")}
                </ActionLink>
              }
              title={t("agent.hub.agentLoadError")}
              showIcon
              type="error"
            />
          </ResourceUnavailable>
        </div>
      );
    } else {
      const resourceCount =
        detail.boundSkills.length +
        detail.boundBrands.length +
        detail.boundWorkflows.length;
      const updatedAt = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(new Date(detail.updatedAt));
      const resourceLinkClassName =
        "group flex min-h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-[12px] bg-paper px-3.5 py-3 text-ink no-underline transition-colors duration-150 hover:bg-mist-deep/65";
      const resourceEmptyClassName =
        "flex min-h-14 w-full min-w-0 items-center rounded-[12px] bg-mist-deep/60 px-3.5 py-3 text-sm text-muted";
      let managementAction: React.JSX.Element | null = null;
      if (detail.isDefault && canManageModels) {
        managementAction = (
          <ActionLink
            params={{ workspaceId }}
            to="/w/$workspaceId/settings/models"
            icon={<SettingOutlined aria-hidden="true" />}
          >
            {t("agent.hub.defaultAgentSettings")}
          </ActionLink>
        );
      } else if (detail.canEdit) {
        managementAction = (
          <ActionLink
            params={{
              workspaceId,
              agentDefinitionId: detail.id,
            }}
            to="/w/$workspaceId/agents/$agentDefinitionId/edit"
            icon={<EditOutlined aria-hidden="true" />}
          >
            {t("agent.hub.editAgent")}
          </ActionLink>
        );
      }
      let identityStatus: React.JSX.Element | null = null;
      if (
        detail.resourceState === "disabled" ||
        detail.resourceState === "deleted"
      ) {
        identityStatus = (
          <StatusTag
            tone={detail.resourceState === "deleted" ? "danger" : "warning"}
          >
            {t(`agent.lifecycle.${detail.resourceState}`)}
          </StatusTag>
        );
      } else if (detail.isDefault) {
        identityStatus = <StatusTag>{t("agent.hub.systemDefault")}</StatusTag>;
      }
      content = (
        <div className="grid gap-5">
          <Link
            className="inline-flex w-fit items-center gap-2 text-sm text-muted no-underline transition-colors hover:text-primary"
            params={{ workspaceId }}
            search={{}}
            to="/w/$workspaceId/agents"
          >
            <ArrowLeftOutlined aria-hidden="true" />
            {t("agent.hub.backToAgents")}
          </Link>

          <Select
            className="mb-5 w-72 max-w-full"
            aria-label={t("agent.authoring.switchAgent")}
            showSearch={{ optionFilterProp: "label" }}
            value={detail.id}
            options={agentItems
              .toSorted(
                (left, right) =>
                  Number(right.isDefault) - Number(left.isDefault),
              )
              .map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
            onChange={(id) =>
              void navigate({
                to: "/w/$workspaceId/agents/$agentDefinitionId",
                params: { workspaceId, agentDefinitionId: id },
              })
            }
          />
          <header className="flex flex-col gap-5 pb-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4 sm:flex-1">
              <AgentAvatar
                alt={detail.displayName}
                isDefault={detail.isDefault}
                {...(detail.avatar ? { avatar: detail.avatar } : {})}
                canReadAssets={canReadAssets}
                className="size-16 rounded-[18px] text-2xl shadow-[inset_0_0_0_1px_rgb(255_255_255_/_55%)]"
                workspaceId={workspaceId}
              />
              <div className="min-w-0 pt-0.5">
                <h1 className="m-0 break-words text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">
                  {detail.displayName}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
                  {identityStatus}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {detail.visibility === "workspace" ? (
                      <TeamOutlined aria-hidden="true" />
                    ) : (
                      <LockOutlined aria-hidden="true" />
                    )}
                    {t(`agent.hub.visibility.${detail.visibility}`)}
                  </span>
                  {!detail.isDefault && creatorName ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <span>{t("agent.hub.creator")}</span>
                      <span className="truncate font-medium text-ink">
                        {creatorName}
                      </span>
                    </span>
                  ) : null}
                  {detail.category ? <span>{detail.category}</span> : null}
                  <time dateTime={detail.updatedAt}>
                    {t("agent.hub.updated")} · {updatedAt}
                  </time>
                </div>
                <p className="mt-3 mb-0 max-w-3xl text-sm leading-6 text-muted">
                  {agentDisplaySummary(detail, workspaceDefaultSummary)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1">
              {managementAction}
              <ResourceActions
                workspaceId={workspaceId}
                csrfToken={csrfToken}
                kind="agent"
                id={detail.id}
                showStatus={false}
              />
              {canRun && detail.resourceState === "enabled" ? (
                <ActionLink
                  params={{ workspaceId }}
                  search={{ agentDefinitionId: detail.id }}
                  to="/w/$workspaceId/agent"
                  color="primary"
                  variant="solid"
                >
                  {t("agent.hub.useAgent")}
                </ActionLink>
              ) : null}
            </div>
          </header>

          <Tabs
            activeKey={detailTab}
            items={[
              { key: "overview", label: t("agent.hub.overview") },
              { key: "instructions", label: t("agent.hub.instructions") },
              {
                key: "resources",
                label: `${t("agent.hub.boundResources")} ${resourceCount}`,
              },
            ]}
            onChange={(key) =>
              setDetailTab(key as "overview" | "instructions" | "resources")
            }
          />

          <div className="grid gap-6">
            <div className="min-w-0">
              {detailTab === "overview" ? (
                <div className="grid gap-9">
                  {detail.tags.length > 0 ? (
                    <section>
                      <h2 className="m-0 text-lg font-bold text-ink">
                        {t("agent.hub.tags")}
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {detailTab === "instructions" ? (
                <section>
                  <div className="mb-4">
                    <h2 className="m-0 text-lg font-bold text-ink">
                      {t("agent.hub.instructions")}
                    </h2>
                  </div>
                  <div className="overflow-auto rounded-[16px] bg-paper p-6">
                    <Streamdown
                      className="agent-markdown min-w-0"
                      mode="static"
                    >
                      {detail.instructions}
                    </Streamdown>
                  </div>
                </section>
              ) : null}

              {detailTab === "resources" ? (
                <section className="grid gap-8">
                  <p className="m-0 max-w-[70ch] text-sm leading-6 text-muted">
                    {t("agent.hub.boundResourcesDescription")}
                  </p>
                  <div className="grid min-w-0 gap-7 md:grid-cols-2">
                    <div className="grid min-w-0 content-start gap-2">
                      <h3 className="m-0 text-sm font-bold text-ink">
                        {t("agent.hub.skillsTitle")}
                      </h3>
                      {detail.boundSkills.length > 0 ? (
                        detail.boundSkills.map((skill) => {
                          const name =
                            skill.displayName ??
                            t("agent.editor.unavailableSkillName");
                          const availability = t(
                            `agent.editor.boundSkillAvailability.${skill.workspaceAvailability}`,
                          );
                          const readable =
                            canReadSkills &&
                            (skill.workspaceAvailability === "available" ||
                              (skill.workspaceAvailability === "private" &&
                                Boolean(skill.displayName)));
                          const content = (
                            <>
                              <ReadOutlined
                                aria-hidden="true"
                                className={
                                  readable ? "text-primary" : "text-muted"
                                }
                              />
                              <span className="min-w-0">
                                <strong className="block truncate text-sm">
                                  {name}
                                </strong>
                                <span className="block truncate text-xs text-muted">
                                  {skill.workspaceAvailability === "available"
                                    ? skill.summary
                                    : `${availability}${skill.summary ? ` · ${skill.summary}` : ""}`}
                                </span>
                              </span>
                            </>
                          );
                          return readable ? (
                            <Link
                              className={resourceLinkClassName}
                              key={skill.id}
                              params={{
                                workspaceId,
                                skillDefinitionId: skill.id,
                              }}
                              search={{
                                returnTo: `/w/${workspaceId}/agents/${detail.id}?tab=resources`,
                              }}
                              to="/w/$workspaceId/skills/$skillDefinitionId"
                            >
                              {content}
                            </Link>
                          ) : (
                            <span
                              className={resourceEmptyClassName}
                              key={skill.id}
                            >
                              {content}
                            </span>
                          );
                        })
                      ) : (
                        <span className={resourceEmptyClassName}>
                          {t("agent.hub.noBoundResources")}
                        </span>
                      )}
                    </div>
                    <div className="grid min-w-0 content-start gap-2">
                      <h3 className="m-0 text-sm font-bold text-ink">
                        {t("agent.hub.brands")}
                      </h3>
                      {detail.boundBrands.length > 0 ? (
                        detail.boundBrands.map((brand) =>
                          canReadBrand ? (
                            <Link
                              className={resourceLinkClassName}
                              key={brand.id}
                              params={{ workspaceId }}
                              search={{
                                brandKitId: brand.id,
                                returnTo: `/w/${workspaceId}/agents/${detail.id}?tab=resources`,
                              }}
                              to="/w/$workspaceId/brand"
                            >
                              <BgColorsOutlined
                                aria-hidden="true"
                                className="text-primary"
                              />
                              <span className="min-w-0">
                                <strong className="block truncate text-sm">
                                  {brand.displayName}
                                </strong>
                                {brand.description ? (
                                  <span className="block truncate text-xs text-muted">
                                    {brand.description}
                                  </span>
                                ) : null}
                              </span>
                            </Link>
                          ) : (
                            <span
                              className={resourceLinkClassName}
                              key={brand.id}
                            >
                              {brand.displayName}
                            </span>
                          ),
                        )
                      ) : (
                        <span className={resourceEmptyClassName}>
                          {t("agent.hub.noBoundResources")}
                        </span>
                      )}
                    </div>
                    <div className="grid min-w-0 content-start gap-2">
                      <h3 className="m-0 text-sm font-bold text-ink">
                        {t("agent.hub.workflows")}
                      </h3>
                      {detail.boundWorkflows.length > 0 ? (
                        detail.boundWorkflows.map((workflow) =>
                          canReadWorkflow ? (
                            <Link
                              className={resourceLinkClassName}
                              key={workflow.id}
                              params={{
                                workspaceId,
                                workflowDefinitionId: workflow.id,
                              }}
                              search={{
                                returnTo: `/w/${workspaceId}/agents/${detail.id}?tab=resources`,
                              }}
                              to="/w/$workspaceId/workflows/$workflowDefinitionId"
                            >
                              <BranchesOutlined
                                aria-hidden="true"
                                className="text-primary"
                              />
                              <span className="min-w-0">
                                <strong className="block truncate text-sm">
                                  {workflow.displayName}
                                </strong>
                                {workflow.description ? (
                                  <span className="block truncate text-xs text-muted">
                                    {workflow.description}
                                  </span>
                                ) : null}
                              </span>
                            </Link>
                          ) : (
                            <span
                              className={resourceLinkClassName}
                              key={workflow.id}
                            >
                              {workflow.displayName}
                            </span>
                          ),
                        )
                      ) : (
                        <span className={resourceEmptyClassName}>
                          {t("agent.hub.noBoundResources")}
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      {!selectedAgentId ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Input
              size="middle"
              className="w-96 max-w-full"
              allowClear
              prefix={<SearchOutlined aria-hidden="true" />}
              value={query}
              onChange={(event) => filterAgents(event.target.value, mine)}
              placeholder={t("agent.hub.searchAgents")}
              aria-label={t("agent.hub.searchAgents")}
            />
            <Segmented
              size="middle"
              value={mine ? "mine" : "all"}
              onChange={(value) => filterAgents(query, value === "mine")}
              options={[
                { value: "all", label: t("agent.skillWorkbench.allSkills") },
                { value: "mine", label: t("agent.hub.myAgents") },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <ResourceTrash
              workspaceId={workspaceId}
              csrfToken={csrfToken}
              kind="agent"
            />
            {canCreate ? (
              <ActionLink
                params={{ workspaceId }}
                to="/w/$workspaceId/agents/new"
                search={listSearch}
                size="middle"
                icon={<PlusOutlined aria-hidden="true" />}
                color="primary"
                variant="solid"
              >
                {t("agent.hub.createAgent")}
              </ActionLink>
            ) : null}
          </div>
        </div>
      ) : null}

      {content}
    </div>
  );
}
