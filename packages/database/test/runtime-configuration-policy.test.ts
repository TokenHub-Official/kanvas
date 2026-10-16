import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeConfiguration,
  resolveGovernedDownloadRule,
  initialGovernedAgentLimits,
} from "../src/runtime/runtime-configuration-policy.js";
const workspaceId = "01K00000000000000000000001";
const providerEndpointId = "01K00000000000000000000002";
const policy = () => ({
  activated: true,
  agent: initialGovernedAgentLimits,
  downloads: {
    defaults: {
      enabled: true,
      allowedOrigins: ["https://DEFAULT.example:443/"],
    },
    providers: [
      {
        workspaceId,
        providerEndpointId,
        rule: { enabled: true, allowedOrigins: ["https://provider.example"] },
      },
    ],
  },
});
describe("Runtime configuration policy", () => {
  it("normalizes exact origins and isolates service overrides", () => {
    const document = normalizeRuntimeConfiguration(policy());
    expect(document.downloads.defaults.allowedOrigins).toEqual([
      "https://default.example",
    ]);
    expect(
      resolveGovernedDownloadRule(document, workspaceId, providerEndpointId)
        .allowedOrigins,
    ).toEqual(["https://provider.example"]);
    expect(
      resolveGovernedDownloadRule(
        document,
        "01K00000000000000000000003",
        providerEndpointId,
      ),
    ).toEqual(document.downloads.defaults);
  });
  it("distinguishes explicit deny-all from no additional restriction", () => {
    const source = policy();
    source.downloads.defaults.allowedOrigins = [];
    expect(
      normalizeRuntimeConfiguration(source).downloads.defaults.allowedOrigins,
    ).toEqual([]);
    expect(
      normalizeRuntimeConfiguration({
        ...source,
        downloads: {
          defaults: { enabled: true, allowedOrigins: null },
          providers: [],
        },
      }).downloads.defaults.allowedOrigins,
    ).toBeNull();
  });
  it.each([
    "https://*.example",
    "http://example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://user:pass@example.com",
  ])("rejects non-origin input %s", (url) => {
    const source = policy();
    source.downloads.defaults.allowedOrigins = [url];
    expect(() => normalizeRuntimeConfiguration(source)).toThrow();
  });
  it("rejects duplicate service rules, invalid budgets and inactive governance", () => {
    const source = policy();
    source.downloads.providers.push(source.downloads.providers[0]!);
    expect(() => normalizeRuntimeConfiguration(source)).toThrow();
    expect(() =>
      normalizeRuntimeConfiguration({
        ...policy(),
        agent: { ...initialGovernedAgentLimits, maximumModelCalls: 65 },
      }),
    ).toThrow();
    expect(() =>
      resolveGovernedDownloadRule(
        { ...normalizeRuntimeConfiguration(policy()), activated: false },
        workspaceId,
        providerEndpointId,
      ),
    ).toThrow();
  });
});
