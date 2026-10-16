import type { AgentHubSkill } from "@kanvas/contracts/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AgentStarterTasks,
  skillStarterTasks,
  homeCapabilitySummary,
} from "./agent-home-content.js";
import "../../i18n/i18n.js";

function skill(
  id: string,
  examples: string[],
  runtimeStatus: AgentHubSkill["runtimeStatus"] = "enabled",
): AgentHubSkill {
  return {
    id,
    skillKey: id,
    displayName: id,
    summary: "A reusable task",
    tags: [],
    exampleRequests: examples,
    ownerPrincipalId: "owner",
    visibility: "workspace",
    version: 1,
    skillRevisionId: `revision-${id}`,
    skillRevision: 1,
    runtimeStatus,
    activationVersion: 1,
    updatedAt: "2026-09-23T00:00:00Z",
  };
}

describe("home task discovery", () => {
  it("offers only runnable, nonempty examples while retaining the exact skill revision", () => {
    const ready = skill("ready", ["  ", " Make a poster "]);
    const tasks = skillStarterTasks([
      skill("off", ["Disabled task"], "disabled"),
      skill("revoked", ["Revoked task"], "revoked"),
      skill("empty", []),
      ready,
    ]);
    expect(tasks).toEqual([{ skill: ready, prompt: "Make a poster" }]);
    expect(tasks[0]?.skill.skillRevisionId).toBe("revision-ready");
  });
  it("balances tasks across skills and removes duplicate prompts", () => {
    const tasks = skillStarterTasks([
      skill("a", ["Poster", "Banner"]),
      skill("b", ["Poster", "Photo"]),
      skill("c", ["Poster"]),
    ]);
    expect(tasks.map((task) => [task.skill.id, task.prompt])).toEqual([
      ["a", "Poster"],
      ["b", "Photo"],
    ]);
  });
  it("does not reveal cached examples after skill access is removed", () => {
    const client = new QueryClient();
    client.setQueryData(["agent-hub-skills", "workspace"], {
      items: [skill("private", ["Private example"])],
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentStarterTasks
          workspaceId="workspace"
          permissions={[]}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(html).not.toContain("Private example");
    client.clear();
  });
  it("does not execute a task merely by showing the entry", () => {
    const client = new QueryClient();
    client.setQueryData(["agent-hub-skills", "workspace"], {
      items: [skill("poster", ["Make a poster"])],
    });
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentStarterTasks
          workspaceId="workspace"
          permissions={["skill.read"]}
          onSelect={onSelect}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("Make a poster");
    expect(onSelect).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("home capability summaries", () => {
  it("shows a concise first sentence without leaking subsequent invocation instructions", () => {
    expect(
      homeCapabilitySummary(
        "生成节气主题海报。用户只要输入节气，就应优先调用本 Skill。",
      ),
    ).toBe("生成节气主题海报。");
  });
  it("preserves names, abbreviations and sentence-free copy", () => {
    expect(homeCapabilitySummary("Generate v2.1 campaign images")).toBe(
      "Generate v2.1 campaign images",
    );
    expect(
      homeCapabilitySummary("Create a poster. Use this tool when needed."),
    ).toBe("Create a poster.");
  });
});
