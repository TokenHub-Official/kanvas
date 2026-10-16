import { describe, expect, it } from "vitest";
import {
  defaultAccessIdentityMatches,
  emptyDefaultAccessPolicy,
  normalizeDefaultAccessPolicy,
} from "../src/runtime/default-access-store.js";
const policy = {
  ...emptyDefaultAccessPolicy,
  enabled: true,
  workspaceId: "01K00000000000000000000001",
  verifiedDomains: ["company.com"],
  oidcProviderIds: ["company"],
  version: 1,
};
describe("default Workspace access identity conditions", () => {
  it("requires actual email verification and exact domains", () => {
    expect(
      defaultAccessIdentityMatches(policy, "staff@company.com", false, null),
    ).toBe(false);
    expect(
      defaultAccessIdentityMatches(
        policy,
        "staff@company.com.attacker.com",
        true,
        null,
      ),
    ).toBe(false);
    expect(
      defaultAccessIdentityMatches(policy, "staff@sub.company.com", true, null),
    ).toBe(false);
    expect(
      defaultAccessIdentityMatches(policy, "Staff@COMPANY.COM", true, null),
    ).toBe(true);
  });
  it("accepts a verified trusted OIDC source independently of domain", () => {
    expect(
      defaultAccessIdentityMatches(policy, "staff@other.com", true, "company"),
    ).toBe(true);
    expect(
      defaultAccessIdentityMatches(policy, "staff@other.com", true, "other"),
    ).toBe(false);
    expect(
      defaultAccessIdentityMatches(policy, "staff@other.com", false, "company"),
    ).toBe(false);
    expect(
      defaultAccessIdentityMatches(
        { ...policy, enabled: false },
        "staff@company.com",
        true,
        "company",
      ),
    ).toBe(false);
  });
  it("normalizes domains and rejects wildcards, invalid destinations and privileged roles", () => {
    expect(
      normalizeDefaultAccessPolicy({
        ...policy,
        verifiedDomains: ["Company.COM", "company.com"],
      }).verifiedDomains,
    ).toEqual(["company.com"]);
    for (const domain of [
      "*.company.com",
      "@company.com",
      "https://company.com",
      "company.com/",
      "company..com",
    ])
      expect(() =>
        normalizeDefaultAccessPolicy({ ...policy, verifiedDomains: [domain] }),
      ).toThrow();
    expect(() =>
      normalizeDefaultAccessPolicy({ ...policy, workspaceId: null }),
    ).toThrow();
    expect(() =>
      normalizeDefaultAccessPolicy({
        ...policy,
        oidcProviderIds: [],
        verifiedDomains: [],
      }),
    ).toThrow();
    expect(() =>
      normalizeDefaultAccessPolicy({ ...policy, role: "admin" as "operator" }),
    ).toThrow();
  });
});
