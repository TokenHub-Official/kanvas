import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "../../api/transport.js";

const transport = vi.hoisted(() => ({
  claimBrowserAttempt: vi.fn(),
  drainBrowserExecutor: vi.fn(),
  registerBrowserExecutor: vi.fn(),
}));

vi.mock("./browser-executor-transport.js", () => transport);

import {
  browserExecutorAuthorityLost,
  startBrowserExecutorRuntime,
} from "./browser-executor-runtime.js";

describe("Browser Executor runtime authority recovery", () => {
  it("recognizes only authenticated authority failures as terminal", () => {
    expect(
      browserExecutorAuthorityLost(
        new ApiProblem(401, "session_expired", "expired"),
      ),
    ).toBe(true);
    expect(
      browserExecutorAuthorityLost(
        new ApiProblem(403, "executor_forbidden", "forbidden"),
      ),
    ).toBe(true);
    expect(
      browserExecutorAuthorityLost(
        new ApiProblem(500, "executor_failed", "failed"),
      ),
    ).toBe(false);
    expect(browserExecutorAuthorityLost({ status: 403 })).toBe(false);
  });

  it("stops claiming after the first 403 instead of creating a retry storm", async () => {
    transport.registerBrowserExecutor.mockResolvedValueOnce({
      sessionId: "01K00000000000000000000000",
    });
    transport.claimBrowserAttempt.mockRejectedValueOnce(
      new ApiProblem(403, "browser_executor_forbidden", "forbidden"),
    );
    const onError = vi.fn();
    const onReady = vi.fn();

    const runtime = startBrowserExecutorRuntime({
      context: {
        workspaceId: "01K00000000000000000000001",
        csrfToken: "csrf",
      },
      executeAssignment: vi.fn(),
      featureProbe: vi.fn(),
      onError,
      onReady,
      registrationBody: () => Promise.resolve({ schemaVersion: 1 } as never),
      runtimeLabel: "Test Browser Executor",
    });

    await runtime.done;

    expect(transport.claimBrowserAttempt).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(transport.drainBrowserExecutor).not.toHaveBeenCalled();
  });
});
