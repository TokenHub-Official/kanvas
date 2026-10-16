import type { AgentHubSkill, AgentHubSkills } from "@kanvas/contracts/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { synchronizePublishedSkillCaches } from "./skill-publication-cache.js";

const workspaceId = "workspace-1";
const skillId = "skill-1";

function skill(revisionId: string, visibility: "private" | "workspace") {
  return {
    id: skillId,
    skillRevisionId: revisionId,
    visibility,
  } as AgentHubSkill;
}

describe("published Skill cache synchronization", () => {
  it("replaces the catalog projection and removes every stale published detail", async () => {
    const queryClient = new QueryClient();
    const previous = skill("revision-private", "private");
    const published = skill("revision-workspace", "workspace");
    queryClient.setQueryData<AgentHubSkills>(
      ["agent-hub-skills", workspaceId],
      { items: [previous] },
    );
    const staleDetailKeys = [
      ["agent-hub-skill", workspaceId, skillId],
      ["conversation-catalog", workspaceId, "skills", skillId, "thread-1"],
      ["conversation-linked-resource", workspaceId, "skill", skillId],
    ] as const;
    for (const key of staleDetailKeys) {
      queryClient.setQueryData(key, { skillRevisionId: "revision-private" });
    }

    await synchronizePublishedSkillCaches({
      draftId: "draft-1",
      published,
      queryClient,
      workspaceId,
    });

    expect(
      queryClient.getQueryData<AgentHubSkills>([
        "agent-hub-skills",
        workspaceId,
      ])?.items,
    ).toEqual([published]);
    for (const key of staleDetailKeys) {
      expect(queryClient.getQueryData(key)).toBeUndefined();
    }
    queryClient.clear();
  });
});
