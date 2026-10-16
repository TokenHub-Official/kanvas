import { useToolAvailability } from "../features/external-tools/use-tool-availability.js";
import {
  AppstoreOutlined,
  HomeOutlined,
  ReadOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { Link, useRouterState } from "@tanstack/react-router";
import { workspaceResourceNavigation } from "./app-shell-model.js";
import { Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConversationHistory } from "./conversation-history.js";
import {
  ConversationCatalogDrawer,
  type ConversationPanel,
} from "./conversation-catalog-drawer.js";
export function ConversationSidebar({
  context,
  workspace,
  threadId,
  currentAgentId,
  onSelectSkill,
  onOpenSkills,
  onSelectAgent,
  onConversationNavigate,
  onNavigate,
}: {
  readonly context: CurrentHumanContext;
  readonly workspace: CurrentHumanContext["workspaces"][number];
  readonly threadId?: string;
  readonly currentAgentId?: string;
  readonly onConversationNavigate?: () => void;
  readonly onNavigate?: () => void;
  readonly onOpenSkills?: () => void;
  readonly onSelectSkill?: (id: string) => void;
  readonly onSelectAgent?: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const homeActive = path.replace(/\/$/u, "") === `/w/${workspace.id}`;
  const permissions = workspace.permissions;
  const toolsAvailable = useToolAvailability(workspace.id, permissions);
  const toolsActive =
    path === `/w/${workspace.id}/tools` ||
    path.startsWith(`/w/${workspace.id}/tools/`);
  const [panel, setPanel] = useState<ConversationPanel>();
  const controls = (
    <div className="grid gap-1 px-3 pb-3">
      <Link
        to="/w/$workspaceId"
        params={{ workspaceId: workspace.id }}
        search={{}}
        aria-current={homeActive ? "page" : undefined}
        onClick={onNavigate}
        className={`flex h-10 items-center gap-2 rounded-control px-3 text-sm no-underline transition-colors focus-visible:outline-2 focus-visible:outline-primary ${homeActive ? "bg-paper font-medium text-primary" : "text-ink hover:bg-paper"}`}
      >
        <HomeOutlined aria-hidden="true" />
        {t("studio.home.navigation")}
      </Link>
      {permissions.includes("agent.read") ? (
        <Button
          block
          icon={<RobotOutlined />}
          className="!h-10 !justify-start !px-3 !font-normal"
          onClick={() => setPanel("agents")}
          type="text"
        >
          {t("agent.hub.agentsTitle")}
        </Button>
      ) : null}
      {permissions.includes("skill.read") ? (
        <Button
          block
          icon={<ReadOutlined />}
          className="!h-10 !justify-start !px-3 !font-normal"
          onClick={() => {
            if (onOpenSkills) {
              onNavigate?.();
              onOpenSkills();
            } else setPanel("skills");
          }}
          type="text"
        >
          {t("agent.hub.skillsTitle")}
        </Button>
      ) : null}
      {toolsAvailable ? (
        <Link
          to="/w/$workspaceId/tools"
          params={{ workspaceId: workspace.id }}
          onClick={onNavigate}
          aria-current={toolsActive ? "page" : undefined}
          className={`flex h-10 items-center gap-2 rounded-control px-3 text-sm no-underline focus-visible:outline-2 focus-visible:outline-primary ${toolsActive ? "bg-paper font-medium text-primary" : "text-ink hover:bg-paper"}`}
        >
          <AppstoreOutlined aria-hidden="true" />
          {t("common.appShell.nav.tools")}
        </Link>
      ) : null}
    </div>
  );
  const managementEntry = workspaceResourceNavigation(permissions)[0];
  const footer = (
    <div className="shrink-0 border-t border-line px-3 py-2">
      {managementEntry ? (
        <Link
          className="flex items-center gap-2 rounded-control px-3 py-2 text-sm text-ink no-underline hover:bg-paper focus-visible:outline-2 focus-visible:outline-primary"
          to={managementEntry.to}
          params={{ workspaceId: workspace.id }}
          onClick={onNavigate}
        >
          <SettingOutlined />
          {t("agent.navigation.manage")}
        </Link>
      ) : null}
    </div>
  );

  return (
    <>
      <ConversationHistory
        csrfToken={context.csrfToken}
        workspaceId={workspace.id}
        permissions={permissions}
        {...(threadId ? { threadId } : {})}
        {...(onNavigate ? { onNavigate } : {})}
        {...(onConversationNavigate ? { onConversationNavigate } : {})}
        controls={controls}
        footer={footer}
      />
      {panel ? (
        <ConversationCatalogDrawer
          key={panel}
          workspace={workspace}
          panel={panel}
          {...(currentAgentId ? { currentAgentId } : {})}
          {...(threadId ? { threadId } : {})}
          onClose={() => setPanel(undefined)}
          {...(onSelectSkill
            ? {
                onSelectSkill: (id: string) => {
                  onSelectSkill(id);
                  onNavigate?.();
                },
              }
            : {})}
          {...(onSelectAgent
            ? {
                onSelectAgent: (id: string) => {
                  onSelectAgent(id);
                  onNavigate?.();
                },
              }
            : {})}
        />
      ) : null}
    </>
  );
}
