import { describe, expect, it } from "vitest";

import {
  agentActionRequiresApproval,
  agentActionTransitionAllowed,
  agentModelCallTransitionAllowed,
  agentRunTransitionAllowed,
} from "../src/modules/agent/index.js";

describe("Agent runtime fact boundaries", () => {
  it("keeps AgentRun suspension limited to explicit approval", () => {
    expect(agentRunTransitionAllowed("queued", "running")).toBe(true);
    expect(agentRunTransitionAllowed("running", "waiting_approval")).toBe(true);
    expect(agentRunTransitionAllowed("waiting_approval", "running")).toBe(true);
    expect(agentRunTransitionAllowed("succeeded", "running")).toBe(false);
  });

  it("does not replay terminal model calls or actions", () => {
    expect(agentModelCallTransitionAllowed("pending", "running")).toBe(true);
    expect(agentModelCallTransitionAllowed("succeeded", "running")).toBe(false);
    expect(agentActionTransitionAllowed("proposed", "running")).toBe(true);
    expect(agentActionTransitionAllowed("succeeded", "running")).toBe(false);
  });

  it("requires approval semantics for high-risk actions", () => {
    expect(
      agentActionRequiresApproval({
        effect: "internal_write",
        approvalMode: "before_commit",
      }),
    ).toBe(false);
    expect(
      agentActionRequiresApproval({
        effect: "external_write",
        approvalMode: "before_call",
      }),
    ).toBe(true);
    expect(() =>
      agentActionRequiresApproval({
        effect: "destructive",
        approvalMode: "none",
      }),
    ).toThrow(/require an approval mode/u);
  });
});
