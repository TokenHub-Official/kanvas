import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { canAccessSettings, firstSettingsRoute } from "./settings-shell.js";

type Workspace = CurrentHumanContext["workspaces"][number];

function workspace(permissions: Workspace["permissions"]): Workspace {
  return {
    id: "01K00000000000000000000001",
    name: "Kanvas Studio",
    permissions,
  } as Workspace;
}

describe("settings shell navigation", () => {
  it("chooses the first page the current role can actually open", () => {
    expect(firstSettingsRoute(workspace(["audit.read"]))).toBe(
      "/w/$workspaceId/settings/tasks",
    );
    expect(firstSettingsRoute(workspace(["usage.read"]))).toBe(
      "/w/$workspaceId/settings/usage",
    );
    expect(
      firstSettingsRoute(
        workspace(["credential.manage", "capability.configure"]),
      ),
    ).toBe("/w/$workspaceId/settings/models");
  });

  it("keeps settings hidden when no management surface is available", () => {
    const readOnlyWorkspace = workspace(["workspace.read", "canvas.read"]);

    expect(canAccessSettings(readOnlyWorkspace)).toBe(false);
    expect(firstSettingsRoute(readOnlyWorkspace)).toBeUndefined();
  });
});
