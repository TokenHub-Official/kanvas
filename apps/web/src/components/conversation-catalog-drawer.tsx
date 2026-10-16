import { ActionLink } from "./action-link.js";
import {
  ArrowLeftOutlined,
  SettingOutlined,
  SearchOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import type {
  CurrentHumanContext,
  AgentHubAgentDetail,
  AgentHubSkillDetail,
} from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Drawer, Empty, Input, Skeleton } from "antd";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAgentHubAgents,
  fetchAgentHubAgent,
  fetchAgentHubSkills,
  fetchAgentHubSkill,
} from "../api/transport.js";
import type { AgentLinkedResource } from "./agent-detail-content.js";
import { ResourceActions, useResourceStates } from "./resource-lifecycle.js";
import { AgentAvatar } from "./agent-avatar.js";
import { agentDisplaySummary } from "../features/agent/agent-presentation.js";

const ResourcePreview = lazy(() =>
  import("./conversation-resource-preview.js").then((module) => ({
    default: module.ConversationResourcePreview,
  })),
);
const AgentContent = lazy(() =>
  import("./agent-detail-content.js").then((module) => ({
    default: module.AgentDetailContent,
  })),
);
const Instructions = lazy(() =>
  import("streamdown").then((module) => ({ default: module.Streamdown })),
);

export type ConversationPanel = "agents" | "skills";
export function ConversationCatalogDrawer({
  workspace,
  csrfToken,
  panel,
  initialDetailId,
  currentAgentId,
  threadId,
  onClose,
  onSelectSkill,
  onSelectAgent,
}: {
  readonly workspace: CurrentHumanContext["workspaces"][number];
  readonly csrfToken?: string;
  readonly panel: ConversationPanel;
  readonly initialDetailId?: string;
  readonly currentAgentId?: string;
  readonly threadId?: string;
  readonly onClose: () => void;
  readonly onSelectSkill?: (id: string) => void;
  readonly onSelectAgent?: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceId = workspace.id;
  const permissions = workspace.permissions;
  const [query, setQuery] = useState("");
  const [resource, setResource] = useState<AgentLinkedResource>();
  const resourceTriggerRef = useRef<HTMLElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef(0);
  function openResource(next: AgentLinkedResource): void {
    savedScrollTopRef.current = detailScrollRef.current?.scrollTop ?? 0;
    resourceTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setResource(next);
    requestAnimationFrame(() =>
      document.getElementById("conversation-resource-back")?.focus(),
    );
  }
  function backToAgent(): void {
    setResource(undefined);
    requestAnimationFrame(() => {
      if (detailScrollRef.current)
        detailScrollRef.current.scrollTop = savedScrollTopRef.current;
      resourceTriggerRef.current?.focus({ preventScroll: true });
    });
  }
  const returnTo = threadId
    ? `/w/${workspace.id}/agent/${threadId}`
    : `/w/${workspace.id}/agent`;
  let managementPath = "";
  if (resource?.kind === "skill")
    managementPath = `/w/${workspace.id}/skills/${resource.id}`;
  if (resource?.kind === "brand")
    managementPath = `/w/${workspace.id}/brand?brandKitId=${resource.id}`;
  if (resource?.kind === "workflow")
    managementPath = `/w/${workspace.id}/workflows/${resource.id}`;
  const resourceManagementHref = `${managementPath}${resource?.kind === "brand" ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
  const [detailId, setDetailId] = useState<string | undefined>(initialDetailId);
  const states = useResourceStates(
    workspaceId,
    panel === "agents" ? "agent" : "skill",
    Boolean(detailId),
  );
  const retainedResource = states.data?.items.find(
    (item) => item.id === detailId,
  );
  const isDeleted = retainedResource?.state === "deleted";
  const agents = useQuery({
    queryKey: ["agent-hub-agents", workspaceId],
    queryFn: () => fetchAgentHubAgents(workspaceId),
    enabled: panel === "agents" && permissions.includes("agent.read"),
    retry: false,
  });
  const skills = useQuery({
    queryKey: ["agent-hub-skills", workspaceId],
    queryFn: () => fetchAgentHubSkills(workspaceId),
    enabled: panel === "skills" && permissions.includes("skill.read"),
    retry: false,
  });
  const detail = useQuery<AgentHubAgentDetail | AgentHubSkillDetail>({
    queryKey: ["conversation-catalog", workspaceId, panel, detailId, threadId],
    queryFn: () =>
      panel === "agents"
        ? fetchAgentHubAgent(
            workspaceId,
            detailId!,
            fetch,
            detailId === currentAgentId ? threadId : undefined,
          )
        : fetchAgentHubSkill(workspaceId, detailId!),
    enabled: Boolean(detailId),
    retry: false,
  });
  const catalog = panel === "agents" ? agents : skills;
  const items = (
    catalog.data?.items.filter((item) => {
      if ("resourceState" in item && item.resourceState !== "enabled")
        return false;
      if ("runtimeStatus" in item && item.runtimeStatus !== "enabled")
        return false;
      const summary =
        "managementKind" in item
          ? agentDisplaySummary(item, t("agent.hub.defaultAgentSummary"))
          : item.summary;
      return `${item.displayName} ${summary}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase());
    }) ?? []
  ).toSorted((left, right) => {
    if (panel !== "agents") return 0;
    const leftDefault = "isDefault" in left && left.isDefault;
    const rightDefault = "isDefault" in right && right.isDefault;
    return Number(rightDefault) - Number(leftDefault);
  });
  const canRun = permissions.includes("agent.run");
  function selectAgent(id: string): void {
    onClose();
    if (onSelectAgent) {
      onSelectAgent(id);
      return;
    }
    void navigate({
      to: "/w/$workspaceId/agent",
      params: { workspaceId },
      search: { agentDefinitionId: id, draftId: crypto.randomUUID() },
    });
  }
  function selectSkill(id: string): void {
    if (onSelectSkill) onSelectSkill(id);
    else
      void navigate({
        to: "/w/$workspaceId/agent",
        params: { workspaceId },
        search: { skillRevisionId: id },
      });
    onClose();
  }
  function selectDetail(): void {
    if (!detail.data) return;
    if ("skillRevisionId" in detail.data)
      selectSkill(detail.data.skillRevisionId);
    else selectAgent(detail.data.id);
  }
  const titleKey = {
    agents: "agent.hub.agentsTitle",
    skills: "agent.hub.skillsTitle",
  } as const;
  const selectionLabel =
    panel === "agents"
      ? t("agent.polish.newThreadWithAgent")
      : t("agent.navigation.addSkill");
  const detailUnavailable =
    !detail.data ||
    !canRun ||
    ("resourceState" in detail.data &&
      detail.data.resourceState !== "enabled") ||
    ("runtimeStatus" in detail.data && detail.data.runtimeStatus !== "enabled");
  const canManageAgent =
    panel === "agents" &&
    detail.data &&
    "canEdit" in detail.data &&
    detail.data.canEdit;
  const isDefaultAgent =
    panel === "agents" &&
    detail.data &&
    "isDefault" in detail.data &&
    detail.data.isDefault;
  let manageAgentHref: string | undefined;
  if (isDefaultAgent && permissions.includes("credential.manage")) {
    manageAgentHref = `/w/${workspaceId}/settings/models`;
  } else if (canManageAgent && detailId) {
    manageAgentHref = `/w/${workspaceId}/agents/${detailId}/edit`;
  }
  const detailFooter = !isDeleted ? (
    <div className="flex items-center justify-between gap-2">
      {csrfToken && retainedResource?.canManage ? (
        <ResourceActions
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind={panel === "agents" ? "agent" : "skill"}
          id={retainedResource.id}
          onDeleted={() => {}}
        />
      ) : null}
      {manageAgentHref ? (
        <Button href={manageAgentHref} icon={<SettingOutlined />}>
          {t(
            isDefaultAgent
              ? "agent.hub.defaultAgentSettings"
              : "agent.polish.manageAgent",
          )}
        </Button>
      ) : null}
      <Button
        className="ml-auto"
        type="primary"
        disabled={detailUnavailable}
        onClick={selectDetail}
      >
        {selectionLabel}
      </Button>
    </div>
  ) : null;
  let drawerFooter = detailId ? (
    detailFooter
  ) : (
    <ActionLink
      block
      icon={<SettingOutlined />}
      to={
        panel === "agents" ? "/w/$workspaceId/agents" : "/w/$workspaceId/skills"
      }
      params={{ workspaceId }}
    >
      {panel === "agents"
        ? t("agent.navigation.manageAgents")
        : t("agent.navigation.manageSkills")}
    </ActionLink>
  );
  if (isDeleted && csrfToken && retainedResource.canManage) {
    drawerFooter = (
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs leading-5 text-muted">
          {t("agent.lifecycle.restoreDisabledHint")}
        </span>
        <ResourceActions
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind={panel === "agents" ? "agent" : "skill"}
          id={retainedResource.id}
        />
      </div>
    );
  }
  if (resource) drawerFooter = null;
  let drawerExtra =
    detailId && !initialDetailId ? (
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => setDetailId(undefined)}
      >
        {t("agent.navigation.backToList")}
      </Button>
    ) : null;
  if (resource)
    drawerExtra = (
      <Button
        id="conversation-resource-back"
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={backToAgent}
      >
        {t("agent.polish.backToAgent")}
      </Button>
    );
  const drawerTitle = resource
    ? resource.name
    : t(
        detailId && panel === "agents"
          ? "agent.polish.agentDetails"
          : titleKey[panel],
      );
  return (
    <Drawer
      {...(detailId && panel === "agents"
        ? { id: "conversation-agent-details" }
        : {})}
      title={drawerTitle}
      open
      onClose={onClose}
      size={480}
      destroyOnHidden
      styles={{
        header: { borderBottom: 0 },
        body: { padding: 0, overflow: "hidden" },
        footer: { padding: "16px 20px" },
      }}
      extra={drawerExtra}
      footer={drawerFooter}
    >
      {resource ? (
        <div className="h-full min-h-0">
          <Suspense fallback={<Skeleton active />}>
            <ResourcePreview
              key={`${resource.kind}:${resource.id}`}
              resource={resource}
              workspaceId={workspaceId}
              canReadAssets={permissions.includes("asset.read")}
              managementHref={resourceManagementHref}
              {...(manageAgentHref ? { manageAgentHref } : {})}
              onBack={backToAgent}
            />
          </Suspense>
        </div>
      ) : null}
      <div
        ref={detailScrollRef}
        className={resource ? "hidden" : "h-full overflow-y-auto p-5"}
      >
        {detailId ? (
          <div className="grid gap-6">
            {detail.isPending ? <Skeleton active /> : null}
            {detail.isError ? (
              <Alert
                type="error"
                title={t("agent.lifecycle.detailLoadError")}
                action={
                  <Button onClick={() => void detail.refetch()}>
                    {t("agent.retry")}
                  </Button>
                }
              />
            ) : null}
            {detail.data && "boundSkills" in detail.data ? (
              <Suspense fallback={<Skeleton active />}>
                <AgentContent
                  detail={detail.data}
                  onOpenResource={openResource}
                  workspaceId={workspaceId}
                  {...(!detail.data.isDefault
                    ? {
                        creatorName:
                          detail.data.creatorDisplayName ??
                          t("agent.hub.teamMember"),
                      }
                    : {})}
                  resourceReturnTo={
                    threadId
                      ? `/w/${workspaceId}/agent/${threadId}`
                      : `/w/${workspaceId}/agent`
                  }
                  permissions={{
                    assets: permissions.includes("asset.read"),
                    brands: permissions.includes("brand.read"),
                    skills: permissions.includes("skill.read"),
                    workflows: permissions.includes("workflow.read"),
                  }}
                />
              </Suspense>
            ) : null}
            {!isDeleted && detail.data && "skillRevisionId" in detail.data ? (
              <>
                <section className="grid gap-3">
                  <h2 className="m-0 text-xl font-semibold tracking-tight">
                    {detail.data.displayName}
                  </h2>
                  <p className="m-0 text-sm leading-6 text-muted">
                    {detail.data.summary}
                  </p>
                  {"runtimeStatus" in detail.data &&
                  detail.data.runtimeStatus !== "enabled" ? (
                    <span role="status" className="text-sm text-muted">
                      {t(`agent.hub.skillRuntime.${detail.data.runtimeStatus}`)}
                    </span>
                  ) : null}
                </section>
                {"exampleRequests" in detail.data &&
                detail.data.exampleRequests.length > 0 ? (
                  <section>
                    <h3 className="m-0 mb-3 text-xs font-medium text-muted">
                      {t("agent.polish.examples")}
                    </h3>
                    <ul className="m-0 grid list-disc gap-3 pl-5 text-sm leading-6 text-ink">
                      {detail.data.exampleRequests.map((example) => (
                        <li key={example}>{example}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <details className="rounded-[14px] bg-mist/65 p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("agent.navigation.instructions")}
                  </summary>
                  <Suspense
                    fallback={<Skeleton active paragraph={{ rows: 3 }} />}
                  >
                    <Instructions
                      className="agent-markdown mt-4 min-w-0"
                      mode="static"
                    >
                      {detail.data.instructions}
                    </Instructions>
                  </Suspense>
                </details>
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              aria-label={t("agent.navigation.searchCatalog")}
              placeholder={t("agent.navigation.searchCatalog")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mb-2"
            />
            {catalog.isPending ? <Skeleton active /> : null}
            {catalog.isError ? (
              <Alert
                type="error"
                title={t("agent.listError")}
                action={
                  <Button onClick={() => void catalog.refetch()}>
                    {t("agent.retry")}
                  </Button>
                }
              />
            ) : null}
            {!catalog.isPending && !catalog.isError && items.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("agent.polish.noCatalogMatch")}
              />
            ) : null}
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-[14px] bg-mist/65 p-4 transition-colors duration-150 hover:bg-mist"
              >
                <button
                  type="button"
                  aria-label={t("agent.polish.openDetails", {
                    name: item.displayName,
                  })}
                  onClick={() => setDetailId(item.id)}
                  className="flex min-w-0 flex-1 gap-3 rounded-control border-0 bg-transparent p-0 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                >
                  {panel === "agents" ? (
                    <AgentAvatar
                      isDefault={"isDefault" in item && item.isDefault}
                      workspaceId={workspaceId}
                      canReadAssets={permissions.includes("asset.read")}
                      {...("avatar" in item && item.avatar
                        ? { avatar: item.avatar }
                        : {})}
                      alt=""
                      className="size-9 shrink-0 rounded-[10px]"
                    />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/8 text-primary">
                      <ReadOutlined />
                    </span>
                  )}
                  <span className="grid min-w-0 gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-semibold leading-5">
                        {item.displayName}
                      </strong>
                      {"isDefault" in item && item.isDefault ? (
                        <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] leading-3 text-primary">
                          {t("agent.hub.systemDefault")}
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-muted">
                      {"managementKind" in item
                        ? agentDisplaySummary(
                            item,
                            t("agent.hub.defaultAgentSummary"),
                          )
                        : item.summary}
                    </span>
                    {"runtimeStatus" in item &&
                    item.runtimeStatus !== "enabled" ? (
                      <span className="text-xs text-muted">
                        {t(`agent.hub.skillRuntime.${item.runtimeStatus}`)}
                      </span>
                    ) : null}
                  </span>
                </button>
                <Button
                  size="small"
                  className="min-h-8 shrink-0"
                  disabled={
                    !canRun ||
                    ("runtimeStatus" in item &&
                      item.runtimeStatus !== "enabled")
                  }
                  onClick={() => {
                    if ("skillRevisionId" in item)
                      selectSkill(item.skillRevisionId);
                    else selectAgent(item.id);
                  }}
                >
                  {t(
                    panel === "agents"
                      ? "agent.polish.newThreadWithAgent"
                      : "agent.polish.use",
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
