import { describe, expect, it } from "vitest";
import { parseAgentDiscoveryDiagnostics } from "../src/api/agent-discovery-diagnostics.js";
const diagnostic = {
  catalogState: "unavailable",
  complete: true,
  evaluatedAt: "2026-09-20T00:00:00.000Z",
  durationMs: 12,
  exclusions: [
    {
      key: "image.generate",
      stage: "invocation",
      status: "unavailable",
      reason: "deployment_policy_missing",
    },
  ],
};
describe("bounded discovery diagnostics", () => {
  it("round trips persisted diagnostics", () => {
    expect(parseAgentDiscoveryDiagnostics(JSON.stringify(diagnostic))).toEqual(
      diagnostic,
    );
  });
  it("rejects private fields, invalid times and unbounded records", () => {
    expect(() =>
      parseAgentDiscoveryDiagnostics({ ...diagnostic, credentials: "private" }),
    ).toThrow();
    expect(() =>
      parseAgentDiscoveryDiagnostics({ ...diagnostic, evaluatedAt: "invalid" }),
    ).toThrow();
    expect(() =>
      parseAgentDiscoveryDiagnostics({
        ...diagnostic,
        exclusions: Array(51).fill(diagnostic.exclusions[0]),
      }),
    ).toThrow();
  });
});
