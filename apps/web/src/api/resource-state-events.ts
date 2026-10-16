import type { QueryClient } from "@tanstack/react-query";

const channelName = "kanvas-resource-state";
const queryKeys = [
  "resource-states",
  "conversation-catalog",
  "agent-hub-agents",
  "agent-hub-agent",
  "agent-hub-skills",
  "agent-hub-skill",
  "skill-drafts",
  "skill-draft",
  "agent-threads",
  "agent-thread",
];
export async function invalidateResourceQueries(
  client: QueryClient,
  workspaceId: string,
): Promise<void> {
  await Promise.all(
    queryKeys.map((key) =>
      client.invalidateQueries({ queryKey: [key, workspaceId] }),
    ),
  );
}
export function notifyResourceStateChange(workspaceId: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage({ workspaceId });
  channel.close();
}
export function subscribeResourceStateChanges(client: QueryClient): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("workspaceId" in data) ||
      typeof data.workspaceId !== "string" ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(data.workspaceId)
    )
      return;
    void invalidateResourceQueries(client, data.workspaceId);
  };
  return () => channel.close();
}
