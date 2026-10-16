import { describe, expect, it } from "vitest";
import { agentBrowserCapabilitySignature } from "./agent-browser-requirements.js";

describe("Agent browser execution ownership", () => {
  it("uses only authoritative requirements on active tasks", () => {
    expect(
      agentBrowserCapabilitySignature([
        {
          lifecycleStatus: "running",
          browserExecution: {
            requiredCapabilityKeys: ["image.palette.extract"],
          },
        },
        { lifecycleStatus: "running" },
        {
          lifecycleStatus: "waiting_approval",
          browserExecution: { requiredCapabilityKeys: ["not-admitted"] },
        },
        {
          lifecycleStatus: "succeeded",
          browserExecution: { requiredCapabilityKeys: ["finished"] },
        },
      ]),
    ).toBe('["image.palette.extract"]');
  });

  it("keeps the registration identity stable across task order and repeated requirements", () => {
    const first = {
      lifecycleStatus: "running" as const,
      browserExecution: { requiredCapabilityKeys: ["b", "a"] },
    };
    const second = {
      lifecycleStatus: "running" as const,
      browserExecution: { requiredCapabilityKeys: ["a"] },
    };
    expect(agentBrowserCapabilitySignature([first, second])).toBe(
      agentBrowserCapabilitySignature([second, first]),
    );
    expect(agentBrowserCapabilitySignature([first, second])).toBe('["a","b"]');
  });

  it("releases ownership when the selected branch has no active browser work", () => {
    expect(
      agentBrowserCapabilitySignature([
        {
          lifecycleStatus: "cancelled",
          browserExecution: { requiredCapabilityKeys: ["a"] },
        },
      ]),
    ).toBe("[]");
    expect(agentBrowserCapabilitySignature([])).toBe("[]");
  });
});
