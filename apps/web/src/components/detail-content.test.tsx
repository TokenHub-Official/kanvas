import type { AgentHubAgentDetail } from "@kanvas/contracts/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n.js";
import { AgentDetailContent } from "./agent-detail-content.js";
import { SkillDetailContent } from "./skill-detail-content.js";

// A preview host has no page params, location, or workspace shell.
describe("detail content in a standalone preview host", () => {
  it("renders Agent instructions and caller-owned actions without a page router", () => {
    const detail = {
      id: "agent-preview",
      displayName: "Preview Agent",
      summary: "Design assistant",
      description: "Design assistant",
      instructions: "Portable agent instructions",
      visibility: "private",
      updatedAt: "2026-09-07T00:00:00.000Z",
      boundSkills: [],
      boundBrands: [],
      boundWorkflows: [],
    } as unknown as AgentHubAgentDetail;
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <AgentDetailContent
            detail={detail}
            workspaceId="workspace"
            creatorName="Creator"
            permissions={{
              assets: false,
              brands: false,
              skills: false,
              workflows: false,
            }}
            actions={<button>Host action</button>}
          />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain("Preview Agent");
    expect(html).toContain("Portable agent instructions");
    expect(html).toContain("Host action");
    expect(html).not.toContain("app-shell-page-title");
    client.clear();
  });
  it("identifies the system default Agent without presenting a human creator", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <AgentDetailContent
            detail={
              {
                id: "system-default-agent",
                displayName: "Kanvas Agent",
                summary: "General-purpose creative Agent",
                instructions: "Complete real Workspace work.",
                isDefault: true,
                managementKind: "system",
                systemKey: "workspace-default",
                visibility: "workspace",
                boundSkills: [],
                boundBrands: [],
                boundWorkflows: [],
              } as unknown as AgentHubAgentDetail
            }
            workspaceId="workspace"
            permissions={{
              assets: false,
              brands: false,
              skills: false,
              workflows: false,
            }}
          />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain(i18n.t("agent.hub.systemDefault"));
    expect(html).toContain(i18n.t("agent.hub.defaultAgentSummary"));
    expect(html).toContain(i18n.t("agent.hub.visibility.workspace"));
    expect(html.match(/<span class="ant-tag/g)).toHaveLength(1);
    expect(html).not.toContain("General-purpose creative Agent");
    expect(html).not.toContain(i18n.t("agent.hub.creator"));
    expect(html).not.toContain("<aside");
    client.clear();
  });
  it.each([true, false])(
    "keeps resource navigation owned by the host (embedded: %s)",
    (embedded) => {
      const client = new QueryClient();
      const detail = {
        id: "agent-preview",
        displayName: "Preview Agent",
        summary: "Design assistant",
        instructions: "Instructions",
        visibility: "private",
        boundSkills: [
          {
            id: "skill-one",
            displayName: "Linked Skill",
            workspaceAvailability: "available",
          },
        ],
        boundBrands: [{ id: "brand-one", displayName: "Restricted Brand" }],
        boundWorkflows: [],
      } as unknown as AgentHubAgentDetail;
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <AgentDetailContent
              detail={detail}
              workspaceId="workspace"
              creatorName="Creator"
              permissions={{
                assets: false,
                skills: true,
                brands: false,
                workflows: true,
              }}
              {...(embedded ? { onOpenResource: () => {} } : {})}
            />
          </I18nextProvider>
        </QueryClientProvider>,
      );
      expect(html).toContain("Linked Skill");
      expect(html).toContain("Restricted Brand");
      expect(html).toContain("<aside");
      expect(html.includes('href="/w/workspace/skills/skill-one')).toBe(
        !embedded,
      );
      expect(html).not.toContain('href="/w/workspace/brand');
      expect(html).not.toContain(i18n.t("agent.hub.noBoundResources"));
      client.clear();
    },
  );

  it("does not expose or link a private bound Skill to a teammate", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <AgentDetailContent
            detail={
              {
                id: "workspace-agent",
                displayName: "Shared Agent",
                summary: "Coordinates campaign work",
                instructions: "Prepare the requested campaign.",
                visibility: "workspace",
                boundSkills: [
                  {
                    id: "private-skill",
                    workspaceAvailability: "private",
                  },
                ],
                boundBrands: [],
                boundWorkflows: [],
              } as unknown as AgentHubAgentDetail
            }
            workspaceId="workspace"
            permissions={{
              assets: false,
              brands: false,
              skills: true,
              workflows: false,
            }}
          />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain(i18n.t("agent.editor.unavailableSkillName"));
    expect(html).toContain(
      i18n.t("agent.editor.boundSkillAvailability.private"),
    );
    expect(html).not.toContain('href="/w/workspace/skills/private-skill');
    expect(html).not.toContain("Secret Skill");
    client.clear();
  });
  it.each([true, false])(
    "renders Skill files without a page router (compact: %s)",
    (compact) => {
      const client = new QueryClient();
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <SkillDetailContent
              compact={compact}
              workspaceId="workspace"
              canReadAssets={false}
              detail={{
                displayName: "Preview Skill",
                summary: "A portable Skill",

                visibility: "private",
                instructions: "Portable skill instructions",
                resources: [],
              }}
              source={{ kind: "draft", id: "draft", version: 1 }}
              status={<span>Draft preview</span>}
              actions={<button>Host action</button>}
            />
          </I18nextProvider>
        </QueryClientProvider>,
      );
      expect(html).toContain("Preview Skill");
      expect(html).toContain("SKILL.md");
      expect(html).toContain("Portable skill instructions");
      expect(html).toContain("Draft preview");
      expect(html.includes('role="combobox"')).toBe(compact);
      expect(html).toContain("Host action");
      expect(html).not.toContain("app-shell-page-title");
      client.clear();
    },
  );

  it("opens a published Skill on its purpose and example tasks", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <SkillDetailContent
            workspaceId="workspace"
            canReadAssets={false}
            detail={{
              displayName: "Campaign Planner",
              summary: "Plan a campaign from a concise brief",
              description:
                "Use this when a campaign needs a clear channel plan.",
              exampleRequests: ["Plan our autumn launch"],
              visibility: "workspace",
              instructions: "Internal maintenance instructions",
              resources: [],
            }}
            source={{ kind: "published", id: "skill", revisionId: "revision" }}
            status={<span>Published</span>}
            renderExampleRequest={(request) => <button>{request}</button>}
          />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("Campaign Planner");
    expect(html).toContain(
      "Use this when a campaign needs a clear channel plan.",
    );
    expect(html).toContain("Plan our autumn launch");
    expect(html).toContain(i18n.t("agent.hub.overview"));
    expect(html).toContain(i18n.t("agent.authoring.skillFiles"));
    expect(html).not.toContain("Internal maintenance instructions");
    client.clear();
  });
});
