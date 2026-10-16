import type { AgentThreadView } from "@kanvas/contracts/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  acceptedAgentThreadSnapshot,
  mergeAgentThreadSnapshot,
  shareAgentThreadSnapshot,
} from "./agent-thread-snapshot.js";

function snapshot(
  revision: number | undefined,
  runId = "old",
  status: NonNullable<
    AgentThreadView["latestRun"]
  >["lifecycleStatus"] = "running",
): AgentThreadView {
  return {
    id: "thread",
    version: 2,
    ...(revision === undefined ? {} : { viewRevision: revision }),
    lifecycleStatus: "active",
    messages: [],
    tasks: [],
    relatedContent: [],
    pendingCanvasExports: [],
    actionConfirmationRequired: false,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
    latestRun: {
      id: runId,
      lifecycleStatus: status,
      updatedAt: "2026-09-20T00:00:00Z",
      ...(status === "failed" ? { failureKind: "runtime" as const } : {}),
    },
  };
}

describe("Agent thread snapshot ordering", () => {
  it("rejects old stream and poll results after a retry succeeds", () => {
    const client = new QueryClient();
    client.setQueryDefaults(["agent-thread"], {
      structuralSharing: shareAgentThreadSnapshot,
    });
    const key = ["agent-thread", "workspace", "thread"];
    client.setQueryData(key, snapshot(3, "old", "failed"));
    client.setQueryData(
      key,
      acceptedAgentThreadSnapshot(
        snapshot(3, "old", "failed"),
        {
          id: "new",
          lifecycleStatus: "queued",
          updatedAt: "2026-09-20T00:01:00Z",
        },
        "old",
      ),
    );
    client.setQueryData(key, snapshot(3, "old", "failed"));
    expect(client.getQueryData<AgentThreadView>(key)?.latestRun?.id).toBe(
      "new",
    );
    client.setQueryData(key, snapshot(5, "new", "succeeded"));
    client.setQueryData(key, snapshot(4, "new", "running"));
    client.setQueryData(key, snapshot(3, "old", "failed"));
    expect(client.getQueryData<AgentThreadView>(key)?.latestRun).toMatchObject({
      id: "new",
      lifecycleStatus: "succeeded",
    });
    expect(
      client.getQueryData<AgentThreadView>(key)?.latestRun?.failureKind,
    ).toBeUndefined();
  });
  it("ignores a late acceptance after another Run already became current", () => {
    const current = snapshot(8, "newer", "succeeded");
    expect(
      acceptedAgentThreadSnapshot(
        current,
        {
          id: "late",
          lifecycleStatus: "queued",
          updatedAt: "2026-09-20T00:01:00Z",
        },
        "old",
      ),
    ).toBe(current);
  });

  it("does not allow an unversioned response to overwrite a versioned snapshot", () => {
    const current = snapshot(3);
    expect(mergeAgentThreadSnapshot(current, snapshot(undefined))).toBe(
      current,
    );
  });

  it("accepts a real newer failure and an explicit historical branch selection", () => {
    const next = snapshot(5, "new", "failed");
    expect(mergeAgentThreadSnapshot(snapshot(4, "new"), next)).toBe(next);
    const historical = snapshot(6, "old", "failed");
    expect(mergeAgentThreadSnapshot(next, historical)).toBe(historical);
  });
  it("does not interpret unrelated threads or ordinary task refreshes as stale", () => {
    const current = snapshot(3);
    const refreshed = { ...snapshot(3), title: "Updated tasks" };
    expect(mergeAgentThreadSnapshot(current, refreshed)).toBe(refreshed);
    const unrelated = { ...snapshot(1), id: "another" };
    expect(mergeAgentThreadSnapshot(current, unrelated)).toBe(unrelated);
  });
});
