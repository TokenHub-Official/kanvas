import { describe, expect, it } from "vitest";

import { ApiProblem } from "../api/transport.js";
import {
  retryStartingWorkspaceContext,
  workspaceContextIsStarting,
} from "./workspace-page.js";

describe("Workspace startup recovery", () => {
  const starting = new ApiProblem(
    503,
    "development.server_starting",
    "Starting",
  );

  it("distinguishes development startup from other service failures", () => {
    expect(workspaceContextIsStarting(starting)).toBe(true);
    expect(
      workspaceContextIsStarting(
        new ApiProblem(503, "workspace.unavailable", "Unavailable"),
      ),
    ).toBe(false);
    expect(workspaceContextIsStarting(new Error("offline"))).toBe(false);
  });

  it("retries startup for a bounded period", () => {
    expect(retryStartingWorkspaceContext(0, starting)).toBe(true);
    expect(retryStartingWorkspaceContext(44, starting)).toBe(true);
    expect(retryStartingWorkspaceContext(45, starting)).toBe(false);
  });
});
