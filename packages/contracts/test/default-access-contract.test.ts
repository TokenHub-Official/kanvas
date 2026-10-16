import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  UpdateDefaultAccessPolicyBodySchema,
  ApplyDefaultAccessBodySchema,
  retryDefaultAccessRoute,
  updateDefaultAccessPolicyRoute,
  applyDefaultAccessRoute,
  routeRegistry,
} from "../src/api/index.js";
describe("default access contract", () => {
  it("limits automatic roles and rejects client supplied authority", () => {
    const body = {
      enabled: true,
      workspaceId: "01K00000000000000000000001",
      role: "operator",
      oidcProviderIds: ["company"],
      verifiedDomains: [],
      expectedVersion: 0,
    };
    expect(Value.Check(UpdateDefaultAccessPolicyBodySchema, body)).toBe(true);
    for (const role of ["owner", "admin", "reviewer"])
      expect(
        Value.Check(UpdateDefaultAccessPolicyBodySchema, { ...body, role }),
      ).toBe(false);
    expect(
      Value.Check(UpdateDefaultAccessPolicyBodySchema, {
        ...body,
        authority: { trusted: true },
      }),
    ).toBe(false);
  });
  it("requires explicit bounded selections and mutation headers", () => {
    expect(
      Value.Check(ApplyDefaultAccessBodySchema, {
        expectedVersion: 1,
        principalIds: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(ApplyDefaultAccessBodySchema, {
        expectedVersion: 1,
        principalIds: [
          "01K00000000000000000000001",
          "01K00000000000000000000001",
        ],
      }),
    ).toBe(false);
    for (const route of [
      retryDefaultAccessRoute,
      updateDefaultAccessPolicyRoute,
      applyDefaultAccessRoute,
    ]) {
      expect(route.request.headers).toBeDefined();
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["browserSession"]);
    }
  });
});
