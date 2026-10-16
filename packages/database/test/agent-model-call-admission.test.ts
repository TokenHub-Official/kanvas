import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { agentModelCallAdmitted } from "../src/runtime/agent-model-call-admission.js";

const base = {
  workspaceId: "workspace",
  agentRunId: "run",
  now: new Date(1000),
  executionDeadlineAt: new Date(2000),
  workerClaim: { workerId: "worker", claimTokenDigest: "digest" },
};
describe("Agent model-call lifecycle admission", () => {
  it.each([
    ["running", "plan", true],
    ["succeeded", "plan", false],
    ["succeeded", "memory_observation", true],
    ["succeeded", "thread_title", true],
    ["waiting_approval", "memory_observation", true],
    ["waiting_for_user", "memory_observation", false],
    ["cancelled", "memory_observation", false],
    ["failed", "thread_title", false],
  ] as const)(
    "%s permits %s: %s",
    async (lifecycleStatus, purpose, allowed) => {
      const execute = vi
        .fn()
        .mockResolvedValue([[{ agent_run_id: "run" }], []]);
      expect(
        await agentModelCallAdmitted({ execute } as unknown as PoolConnection, {
          ...base,
          lifecycleStatus,
          purpose,
        }),
      ).toBe(allowed);
    },
  );
  it("rejects missing ownership, expired deadlines and stale lease tokens", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const connection = { execute } as unknown as PoolConnection;
    const options = {
      ...base,
      lifecycleStatus: "succeeded",
      purpose: "memory_observation" as const,
    };
    expect(await agentModelCallAdmitted(connection, options)).toBe(false);
    expect(
      await agentModelCallAdmitted(connection, {
        ...options,
        executionDeadlineAt: base.now,
      }),
    ).toBe(false);
    const unowned = {
      workspaceId: base.workspaceId,
      agentRunId: base.agentRunId,
      now: base.now,
      executionDeadlineAt: base.executionDeadlineAt,
      lifecycleStatus: options.lifecycleStatus,
      purpose: options.purpose,
    };
    expect(await agentModelCallAdmitted(connection, unowned)).toBe(false);
  });
});
