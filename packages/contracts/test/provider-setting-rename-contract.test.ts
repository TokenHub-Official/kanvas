import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  RenameProviderSettingBodySchema,
  renameWorkspaceProviderSettingRoute,
  routeRegistry,
} from "../src/api/index.js";

describe("Provider rename boundary", () => {
  it("registers a versioned name-only mutation", () => {
    expect(routeRegistry).toContain(renameWorkspaceProviderSettingRoute);
    expect(
      Value.Check(RenameProviderSettingBodySchema, {
        displayName: "Primary",
        expectedVersion: 1,
      }),
    ).toBe(true);
    expect(
      Value.Check(RenameProviderSettingBodySchema, { displayName: "Primary" }),
    ).toBe(false);
  });
  it.each(["baseUrl", "apiKey", "preset", "modelKeys"])(
    "rejects changes to %s through rename",
    (field) => {
      expect(
        Value.Check(RenameProviderSettingBodySchema, {
          displayName: "Primary",
          expectedVersion: 1,
          [field]: "unexpected",
        }),
      ).toBe(false);
    },
  );
});
