import type { CurrentHumanContext } from "@kanvas/contracts/api";

export type AppShellWorkspace = CurrentHumanContext["workspaces"][number];

export type AppShellNavKey =
  | "agents"
  | "skills"
  | "assets"
  | "brand"
  | "libraries"
  | "workbench"
  | "tools";

export type AppShellRouteTitleKey = AppShellNavKey | "settings";

export const workspaceSearchThreshold = 8;

export function isAppShellNavItemActive(
  key: AppShellNavKey,
  path: string,
  basePath: string,
): boolean {
  switch (key) {
    case "workbench":
      return (
        path === basePath ||
        path === `${basePath}/` ||
        path === `${basePath}/agent` ||
        path.startsWith(`${basePath}/agent/`)
      );
    case "agents":
      return (
        path === `${basePath}/agents` || path.startsWith(`${basePath}/agents/`)
      );
    case "skills":
      return path.startsWith(`${basePath}/skills`);
    case "assets":
      return path.startsWith(`${basePath}/assets`);
    case "tools":
      return (
        path === `${basePath}/tools` || path.startsWith(`${basePath}/tools/`)
      );
    case "libraries":
      return path.startsWith(`${basePath}/libraries`);
    case "brand":
      return path.startsWith(`${basePath}/brand`);
  }
}

export function appShellRouteTitleKey(
  path: string,
  basePath: string,
): AppShellRouteTitleKey | undefined {
  if (path.startsWith(`${basePath}/settings`)) {
    return "settings";
  }
  for (const key of [
    "workbench",
    "tools",
    "agents",
    "skills",
    "assets",
    "brand",
    "libraries",
  ] as const) {
    if (isAppShellNavItemActive(key, path, basePath)) {
      return key;
    }
  }
  return undefined;
}

export function shouldSearchWorkspaces(count: number): boolean {
  return count > workspaceSearchThreshold;
}

export function filterWorkspaceCandidates(
  workspaces: readonly AppShellWorkspace[],
  query: string,
): readonly AppShellWorkspace[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return workspaces;
  }
  return workspaces.filter((workspace) =>
    [
      workspace.name,
      workspace.organization.name,
      workspace.membership.role,
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export const resourceNavigation = [
  {
    key: "libraries",
    permission: "library.read",
    labelKey: "libraries.title",
    to: "/w/$workspaceId/libraries",
  },
  {
    key: "assets",
    permission: "asset.read",
    labelKey: "common.appShell.nav.assets",
    to: "/w/$workspaceId/assets",
  },
  {
    key: "boards",
    permission: "canvas.read",
    labelKey: "agent.navigation.boards",
    to: "/w/$workspaceId/boards",
  },
  {
    key: "agents",
    permission: "agent.read",
    labelKey: "common.appShell.nav.agents",
    to: "/w/$workspaceId/agents",
  },
  {
    key: "skills",
    permission: "skill.read",
    labelKey: "common.appShell.nav.skills",
    to: "/w/$workspaceId/skills",
  },
  {
    key: "brand",
    permission: "brand.read",
    labelKey: "common.appShell.nav.brand",
    to: "/w/$workspaceId/brand",
  },
  {
    key: "workflows",
    permission: "workflow.read",
    labelKey: "agent.navigation.workflows",
    to: "/w/$workspaceId/workflows",
  },
] as const;

export function workspaceResourceNavigation(permissions: readonly string[]) {
  return resourceNavigation.filter((item) =>
    permissions.includes(item.permission),
  );
}

export function appShellSurface(
  path: string,
  basePath: string,
): "conversation" | "resources" | "settings" {
  if (isAppShellNavItemActive("workbench", path, basePath))
    return "conversation";
  return path === `${basePath}/settings` ||
    path.startsWith(`${basePath}/settings/`)
    ? "settings"
    : "resources";
}

export function conversationReturnPath(
  value: string | null,
  basePath: string,
): string {
  if (value === basePath || value === `${basePath}/agent`) return value;
  const prefix = `${basePath}/agent/`;
  return value?.startsWith(prefix) &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value.slice(prefix.length))
    ? value
    : basePath;
}
