import type { AgentHubSkill, AgentHubSkills } from "@kanvas/contracts/api";
import type { QueryClient } from "@tanstack/react-query";

export async function synchronizePublishedSkillCaches({
  draftId,
  published,
  queryClient,
  workspaceId,
}: {
  readonly draftId: string;
  readonly published: AgentHubSkill;
  readonly queryClient: QueryClient;
  readonly workspaceId: string;
}): Promise<void> {
  const catalogKey = ["agent-hub-skills", workspaceId] as const;
  queryClient.setQueryData<AgentHubSkills>(catalogKey, (current) => {
    if (!current) return current;
    const existing = current.items.findIndex(
      (item) => item.id === published.id,
    );
    const items = [...current.items];
    if (existing >= 0) items[existing] = published;
    else items.unshift(published);
    return { ...current, items };
  });

  queryClient.removeQueries({
    exact: true,
    queryKey: ["agent-hub-skill", workspaceId, published.id],
  });
  queryClient.removeQueries({
    queryKey: ["conversation-catalog", workspaceId, "skills", published.id],
  });
  queryClient.removeQueries({
    queryKey: [
      "conversation-linked-resource",
      workspaceId,
      "skill",
      published.id,
    ],
  });

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["skill-drafts", workspaceId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["skill-draft", workspaceId, draftId],
    }),
    queryClient.invalidateQueries({ queryKey: catalogKey }),
  ]);
}
