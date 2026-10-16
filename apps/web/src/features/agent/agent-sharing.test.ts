import { describe, expect, it } from "vitest";

import { privateSkillIdsForWorkspaceAgent } from "./agent-sharing.js";

describe("Workspace Agent Skill sharing", () => {
  it("finds private selected Skills without exposing hidden presentation", () => {
    expect(
      privateSkillIdsForWorkspaceAgent(
        ["workspace-skill", "own-private", "hidden-private"],
        [
          { id: "workspace-skill", visibility: "workspace" },
          { id: "own-private", visibility: "private" },
        ],
        [
          {
            id: "hidden-private",
            workspaceAvailability: "private",
          },
        ],
      ),
    ).toEqual(["own-private", "hidden-private"]);
  });

  it("does not treat a disabled Workspace Skill as a privacy expansion", () => {
    expect(
      privateSkillIdsForWorkspaceAgent(
        ["disabled-workspace"],
        [],
        [
          {
            id: "disabled-workspace",
            workspaceAvailability: "disabled",
          },
        ],
      ),
    ).toEqual([]);
  });
});
