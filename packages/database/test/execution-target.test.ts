import { describe, expect, it } from "vitest";

import {
  createExecutionTargetGate,
  defaultEnabledExecutionTargets,
  type ExecutionTarget,
} from "../src/runtime/execution-target.js";

describe("execution target enablement", () => {
  it("fails closed to worker-only by default", () => {
    const gate = createExecutionTargetGate();

    expect(defaultEnabledExecutionTargets).toEqual(["worker"]);
    expect(gate.enabledExecutionTargets).toEqual(["worker"]);
    expect(gate.allows("worker")).toBe(true);
    expect(gate.allows("provider")).toBe(false);
    expect(gate.allows("browser")).toBe(false);
  });

  it("copies and normalizes an explicit test/runtime allow-list", () => {
    const configured: ExecutionTarget[] = ["provider", "browser", "provider"];
    const gate = createExecutionTargetGate(configured);

    configured.splice(0, configured.length, "worker");

    expect(gate.enabledExecutionTargets).toEqual(["provider", "browser"]);
    expect(gate.allows("worker")).toBe(false);
    expect(gate.allows("provider")).toBe(true);
    expect(gate.allows("browser")).toBe(true);
  });

  it("rejects an unknown target instead of silently enabling it", () => {
    expect(() =>
      createExecutionTargetGate(["worker", "remote" as ExecutionTarget]),
    ).toThrowError("Unknown enabled execution target: remote");
  });
});
