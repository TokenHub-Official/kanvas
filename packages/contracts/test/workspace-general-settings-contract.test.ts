import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  getWorkspaceGeneralSettingsRoute,
  renameWorkspaceRoute,
  RenameWorkspaceBodySchema,
  routeRegistry,
  WorkspaceGeneralSettingsSchema,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Workspace general settings contracts", () => {
  it("registers one read and one CAS rename route", () => {
    expect(getWorkspaceGeneralSettingsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/workspace-settings",
      idempotency: "none",
    });
    expect(renameWorkspaceRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/workspace-settings/name",
      idempotency: "none",
    });
    for (const route of [
      getWorkspaceGeneralSettingsRoute,
      renameWorkspaceRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }
  });

  it("accepts a bounded projection and rejects empty names", () => {
    const ajv = createAjv();
    const validateSettings = ajv.compile(WorkspaceGeneralSettingsSchema);
    const validateRename = ajv.compile(RenameWorkspaceBodySchema);
    expect(
      validateSettings({
        workspaceId: "01K00000000000000000000001",
        slug: "kanvas-studio",
        name: "Kanvas Studio",
        version: 4,
        updatedAt: "2026-08-06T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      validateRename({
        expectedVersion: 4,
        name: "  ",
      }),
    ).toBe(false);
  });
});
