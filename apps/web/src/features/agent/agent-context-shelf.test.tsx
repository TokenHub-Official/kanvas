import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { AgentContextShelf } from "./agent-context-shelf.js";
import {
  agentWorkbenchResourceEntry,
  agentWorkbenchTaskEntry,
} from "./agent-resource-workbench.js";

describe("Agent context shelf", () => {
  it("keeps a long task title and status readable without horizontal scrolling", async () => {
    await i18n.changeLanguage("en-US");
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AgentContextShelf
          entries={[
            agentWorkbenchTaskEntry({
              id: "01K00000000000000000000006",
              kind: "skill",
              lifecycleStatus: "succeeded",
              title: "Create Skill: Palette Notes",
            }),
          ]}
          onOpen={vi.fn()}
          workspaceId="01K00000000000000000000002"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("Production tasks");
    expect(markup).toContain("Create Skill: Palette Notes");
    expect(markup).toContain("Result ready");
    expect(markup).toContain("overflow-x-clip");
    expect(markup).toContain("grid-cols-[minmax(0,1fr)]");
    expect(markup).not.toContain("truncate");
  });

  it("keeps a selected Brand visible in the conversation context", () => {
    const markup = renderToStaticMarkup(
      <AgentContextShelf
        entries={[
          agentWorkbenchResourceEntry({
            kind: "brand",
            resourceId: "01K00000000000000000000001",
            title: "Kanvas 主品牌",
            description: "用于产品与日常内容创作",
            state: "available",
          }),
        ]}
        onOpen={vi.fn()}
        workspaceId="01K00000000000000000000002"
      />,
    );

    expect(markup).toContain("Kanvas 主品牌");
    expect(markup).toMatch(/品牌|Brand/u);
  });

  it("keeps separate production tasks visible even when their titles and revisions match", () => {
    const workflowRevisionId = "01K00000000000000000000003";
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AgentContextShelf
          entries={[
            agentWorkbenchTaskEntry({
              id: "01K00000000000000000000004",
              kind: "workflow",
              lifecycleStatus: "failed",
              title: "生成图片",
              workflowRevisionId,
            }),
            agentWorkbenchTaskEntry({
              id: "01K00000000000000000000005",
              kind: "workflow",
              lifecycleStatus: "succeeded",
              title: "生成图片",
              workflowRevisionId,
            }),
          ]}
          onOpen={vi.fn()}
          workspaceId="01K00000000000000000000002"
        />
      </QueryClientProvider>,
    );

    expect(markup.match(/生成图片/gu)).toHaveLength(2);
    expect(markup).not.toMatch(/2 次尝试|2 attempts/iu);
  });
});
