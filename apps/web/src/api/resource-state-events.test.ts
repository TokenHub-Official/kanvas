import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  notifyResourceStateChange,
  subscribeResourceStateChanges,
} from "./resource-state-events.js";

it("refreshes another tab's resource and conversation queries without touching another workspace", async () => {
  const workspaceId = "01K00000000000000000000000";
  const client = new QueryClient();
  const keys = [
    ["resource-states", workspaceId, "agent"],
    ["agent-thread", workspaceId, "thread"],
    ["agent-hub-skills", workspaceId],
    ["resource-states", "01K00000000000000000000001", "agent"],
  ];
  for (const key of keys) client.setQueryData(key, { state: "enabled" });
  const dispose = subscribeResourceStateChanges(client);
  try {
    notifyResourceStateChange(workspaceId);
    await vi.waitFor(() =>
      expect(client.getQueryState(keys[0]!)?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(keys[1]!)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys[2]!)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys[3]!)?.isInvalidated).toBe(false);
  } finally {
    dispose();
    client.clear();
  }
});
