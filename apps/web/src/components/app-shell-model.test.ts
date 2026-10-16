import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  appShellRouteTitleKey,
  appShellSurface,
  conversationReturnPath,
  workspaceResourceNavigation,
  filterWorkspaceCandidates,
  isAppShellNavItemActive,
  shouldSearchWorkspaces,
} from "./app-shell-model.js";

type Workspace = CurrentHumanContext["workspaces"][number];

function workspace(
  name: string,
  organizationName: string,
  role: Workspace["membership"]["role"],
): Workspace {
  return {
    id: `${name}-workspace`,
    name,
    slug: name.toLocaleLowerCase().replaceAll(" ", "-"),
    organization: {
      id: `${organizationName}-organization`,
      name: organizationName,
    },
    membership: {
      id: `${name}-membership`,
      role,
      version: 1,
    },
    permissions: [],
  };
}

describe("app shell model", () => {
  it("maps only current first-level product areas", () => {
    const basePath = "/w/workspace";

    expect(
      isAppShellNavItemActive(
        "workbench",
        "/w/workspace/agent/thread-1",
        basePath,
      ),
    ).toBe(true);
    expect(
      isAppShellNavItemActive("skills", "/w/workspace/skills", basePath),
    ).toBe(true);
    expect(
      isAppShellNavItemActive("brand", "/w/workspace/brand", basePath),
    ).toBe(true);
    expect(
      isAppShellNavItemActive(
        "assets",
        "/w/workspace/assets/asset-1",
        basePath,
      ),
    ).toBe(true);
  });

  it("uses stable object titles in the shell instead of repeating page headings", () => {
    const basePath = "/w/workspace";

    expect(appShellRouteTitleKey("/w/workspace/agent/thread-1", basePath)).toBe(
      "workbench",
    );
    expect(
      appShellRouteTitleKey("/w/workspace/settings/general", basePath),
    ).toBe("settings");
    expect(appShellRouteTitleKey("/w/workspace/assets/asset-1", basePath)).toBe(
      "assets",
    );
    expect(appShellRouteTitleKey("/w/workspace/brand", basePath)).toBe("brand");
    expect(appShellRouteTitleKey("/w/workspace/new", basePath)).toBeUndefined();
  });

  it("only adds workspace search when the list is long", () => {
    expect(shouldSearchWorkspaces(8)).toBe(false);
    expect(shouldSearchWorkspaces(9)).toBe(true);
  });

  it("filters by workspace, organization, or role", () => {
    const workspaces = [
      workspace("Kanvas Studio", "Example Studio", "owner"),
      workspace("Brand Lab", "Creative Group", "editor"),
    ];

    expect(
      filterWorkspaceCandidates(workspaces, "example studio"),
    ).toHaveLength(1);
    expect(filterWorkspaceCandidates(workspaces, "editor")).toHaveLength(1);
    expect(filterWorkspaceCandidates(workspaces, "missing")).toHaveLength(0);
  });
});

describe("conversation and management surfaces", () => {
  const base = "/w/workspace";
  it("keeps conversation history scoped to conversation routes", () => {
    for (const path of [base, `${base}/agent`, `${base}/agent/thread-1`]) {
      expect(appShellSurface(path, base)).toBe("conversation");
    }
    for (const path of [
      `${base}/agents`,
      `${base}/agents/new`,
      `${base}/skills/skill-1/edit`,
      `${base}/assets`,
      `${base}/brand`,
      `${base}/workflows`,
    ]) {
      expect(appShellSurface(path, base)).toBe("resources");
    }
    expect(appShellSurface(`${base}/settings/general`, base)).toBe("settings");
  });
  it("only exposes resource management entries the member can read", () => {
    expect(workspaceResourceNavigation(["agent.run"])).toEqual([]);
    expect(
      workspaceResourceNavigation(["skill.read", "asset.read"]).map(
        (item) => item.key,
      ),
    ).toEqual(["assets", "skills"]);
  });
  it("returns to the originating conversation without accepting another workspace or arbitrary location", () => {
    const thread = `${base}/agent/01K00000000000000000000000`;
    expect(conversationReturnPath(thread, base)).toBe(thread);
    for (const candidate of [
      null,
      "/w/another/agent/01K00000000000000000000000",
      `${thread}?unexpected=true`,
      `${base}/assets`,
      "https://example.com",
    ]) {
      expect(conversationReturnPath(candidate, base)).toBe(base);
    }
  });
});
