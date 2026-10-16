import { ReadOutlined } from "@ant-design/icons";
import type { AgentHubSkill } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, Button, Skeleton } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAgentHubAgents,
  fetchAgentHubSkills,
} from "../../api/transport.js";
import { HomeSkillCover } from "./home-skill-cover.js";
import { AgentAvatar } from "../../components/agent-avatar.js";
import { agentDisplaySummary } from "./agent-presentation.js";

const starterPreviewLimit = 3;
const capabilityPreviewLimit = 6;
const sparseCapabilityLimit = 2;

export function homeCapabilitySummary(summary: string): string {
  return (
    summary.trim().split(/(?<=[。！？])\s*|(?<=[.!?])\s+(?=[A-Z])/u)[0] ??
    summary
  );
}

interface HomeProps {
  readonly workspaceId: string;
  readonly permissions: readonly string[];
  readonly onSelectSkill: (skill: AgentHubSkill, prompt?: string) => void;
}

function useHomeSkills(workspaceId: string, permissions: readonly string[]) {
  return useQuery({
    queryKey: ["agent-hub-skills", workspaceId],
    queryFn: () => fetchAgentHubSkills(workspaceId),
    enabled: permissions.includes("skill.read"),
    retry: false,
  });
}

export function skillStarterTasks(skills: readonly AgentHubSkill[]) {
  const seen = new Set<string>();
  return skills
    .filter((skill) => skill.runtimeStatus === "enabled")
    .flatMap((skill) => {
      // One task per skill keeps a single large example list from taking over the entry.
      const prompt = skill.exampleRequests
        .map((value) => value.trim())
        .find((value) => value && !seen.has(value));
      if (!prompt) return [];
      seen.add(prompt);
      return [{ skill, prompt }];
    });
}

export function AgentStarterTasks({
  workspaceId,
  permissions,
  onSelect,
}: {
  readonly workspaceId: string;
  readonly permissions: readonly string[];
  readonly onSelect: HomeProps["onSelectSkill"];
}) {
  const { t } = useTranslation();
  const skills = useHomeSkills(workspaceId, permissions);
  const [expanded, setExpanded] = useState(false);
  const tasks = skillStarterTasks(skills.data?.items ?? []);
  if (!permissions.includes("skill.read") || tasks.length === 0) return null;
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-2"
      aria-label={t("studio.home.exampleTasks")}
    >
      {tasks
        .slice(0, expanded ? tasks.length : starterPreviewLimit)
        .map(({ skill, prompt }) => (
          <button
            type="button"
            key={skill.id}
            title={`${skill.displayName} · ${prompt}`}
            onClick={() => onSelect(skill, prompt)}
            className="max-w-full truncate rounded-control border-0 bg-mist/55 px-3.5 py-2 text-left text-xs leading-5 text-ink transition-colors hover:bg-mist hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:max-w-64"
          >
            {prompt}
          </button>
        ))}
      {tasks.length > starterPreviewLimit ? (
        <Button
          type="text"
          size="small"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {t(expanded ? "studio.home.fewerTasks" : "studio.home.moreTasks")}
        </Button>
      ) : null}
    </div>
  );
}

export function AgentHomeContent({
  workspaceId,
  permissions,
  onSelectSkill,
  onSelectAgent,
}: HomeProps & {
  readonly onSelectAgent: (id: string) => void;
}) {
  const { t } = useTranslation();
  const agents = useQuery({
    queryKey: ["agent-hub-agents", workspaceId],
    queryFn: () => fetchAgentHubAgents(workspaceId),
    enabled: permissions.includes("agent.read"),
    retry: false,
  });
  const skills = useHomeSkills(workspaceId, permissions);
  const agentItems =
    agents.data?.items.filter(
      (item) => item.resourceState === "enabled" && !item.isDefault,
    ) ?? [];
  const skillItems =
    skills.data?.items.filter((item) => item.runtimeStatus === "enabled") ?? [];
  const canStart = permissions.includes("agent.run");
  const sparse =
    agentItems.length <= sparseCapabilityLimit &&
    skillItems.length <= sparseCapabilityLimit;
  const showAgents =
    permissions.includes("agent.read") &&
    (agents.isPending || agents.isError || agentItems.length > 0);
  const showSkills =
    permissions.includes("skill.read") &&
    (skills.isPending || skills.isError || skillItems.length > 0);
  const skillGallery =
    permissions.includes("asset.read") &&
    skillItems.some((skill) => Boolean(skill.coverAssetId));
  const sectionLinkClass =
    "shrink-0 rounded-md text-sm text-muted no-underline transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";
  return (
    <div
      className={`@container/home-capabilities mx-auto w-full ${sparse ? "max-w-[1040px]" : ""}`}
    >
      <div
        className={`grid gap-10 sm:gap-14 ${sparse && showAgents && showSkills ? "@[720px]/home-capabilities:grid-cols-2 @[720px]/home-capabilities:gap-x-16" : ""}`}
      >
        {showAgents ? (
          <section aria-labelledby="home-agents" className="min-w-0">
            <header className="mb-6 flex items-center justify-between gap-4">
              <h2
                id="home-agents"
                className="m-0 text-xl font-semibold tracking-tight"
              >
                {t("agent.hub.agentsTitle")}
              </h2>
              {agentItems.length > 1 ? (
                <Link
                  className={sectionLinkClass}
                  to="/w/$workspaceId/agents"
                  params={{ workspaceId }}
                >
                  {t("studio.home.viewAll")}
                </Link>
              ) : null}
            </header>
            {agents.isError ? (
              <Alert
                type="error"
                title={t("studio.home.agentsUnavailable")}
                action={
                  <Button size="small" onClick={() => void agents.refetch()}>
                    {t("studio.home.retry")}
                  </Button>
                }
              />
            ) : null}
            {agents.isPending ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : null}
            {!agents.isError && !agents.isPending ? (
              <div
                className={`grid gap-x-10 gap-y-7 ${sparse ? "" : "@[640px]/home-capabilities:grid-cols-2 @[1000px]/home-capabilities:grid-cols-3"}`}
              >
                {agentItems.slice(0, capabilityPreviewLimit).map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    disabled={!canStart}
                    onClick={() => onSelectAgent(agent.id)}
                    className="group flex min-w-0 items-center gap-4 rounded-control border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary disabled:opacity-60"
                  >
                    <AgentAvatar
                      alt=""
                      workspaceId={workspaceId}
                      canReadAssets={permissions.includes("asset.read")}
                      {...(agent.avatar ? { avatar: agent.avatar } : {})}
                      className="size-16 shrink-0 rounded-full text-[28px] transition-transform duration-200 group-hover:scale-105 motion-reduce:transform-none"
                    />
                    <span className="grid min-w-0 gap-1.5">
                      <span className="truncate text-base font-semibold text-ink transition-colors group-hover:text-primary">
                        {agent.displayName}
                      </span>
                      <span className="line-clamp-2 text-sm leading-6 text-muted">
                        {agentDisplaySummary(
                          agent,
                          t("agent.hub.defaultAgentSummary"),
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {showSkills ? (
          <section aria-labelledby="home-skills" className="min-w-0">
            <header className="mb-6 flex items-center justify-between gap-4">
              <h2
                id="home-skills"
                className="m-0 text-xl font-semibold tracking-tight"
              >
                {t("agent.hub.skillsTitle")}
              </h2>
              {skillItems.length > 1 ? (
                <Link
                  className={sectionLinkClass}
                  to="/w/$workspaceId/skills"
                  params={{ workspaceId }}
                >
                  {t("studio.home.viewAll")}
                </Link>
              ) : null}
            </header>
            {skills.isError ? (
              <Alert
                type="error"
                title={t("studio.home.skillsUnavailable")}
                action={
                  <Button size="small" onClick={() => void skills.refetch()}>
                    {t("studio.home.retry")}
                  </Button>
                }
              />
            ) : null}
            {skills.isPending ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : null}
            {!skills.isError && !skills.isPending ? (
              <div className="grid items-start justify-start gap-x-8 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),320px))]">
                {skillItems.slice(0, capabilityPreviewLimit).map((skill) => {
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      disabled={!canStart}
                      onClick={() => onSelectSkill(skill)}
                      className={`group min-w-0 rounded-control border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary disabled:opacity-60 ${skillGallery ? "grid gap-3" : "flex items-center gap-4"}`}
                    >
                      {skillGallery ? (
                        <HomeSkillCover
                          workspaceId={workspaceId}
                          {...(skill.coverAssetId
                            ? { assetId: skill.coverAssetId }
                            : {})}
                        />
                      ) : (
                        <span className="grid size-16 shrink-0 place-items-center rounded-control bg-mist/70 text-2xl text-muted">
                          <ReadOutlined aria-hidden="true" />
                        </span>
                      )}
                      <span className="grid min-w-0 gap-1.5">
                        <span className="truncate text-base font-semibold text-ink transition-colors group-hover:text-primary">
                          {skill.displayName}
                        </span>
                        <span className="line-clamp-2 text-sm leading-6 text-muted">
                          {homeCapabilitySummary(skill.summary)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
