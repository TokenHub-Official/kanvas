import { describe, expect, it, vi } from "vitest";
import { WorkspaceProviderSettingsController } from "../src/http/workspace-provider-settings.controller.js";

const scope = {
  workspaceId: "workspace",
  organizationId: "org",
  principalId: "owner",
  principalType: "human",
  authenticationRefId: "session",
  authenticationRefType: "session",
  authorityType: "human_membership",
  authorityId: "membership",
  authorityVersion: 1,
};
function setup() {
  const rename = vi.fn().mockResolvedValue({
    id: "provider",
    displayName: "Main",
    preset: "tokenhub",
    baseUrl: "https://us-api.tokenhub.com",
    modelKeys: [],
    lifecycle: "active",
    validation: "passed",
    secretConfigured: true,
    canRefreshModelCatalog: true,
    version: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const controller = new WorkspaceProviderSettingsController(
    {} as never,
    { providerSettings: { rename } } as never,
    {} as never,
    {} as never,
    { require: () => ({ scope }) } as never,
  );
  return { controller, rename };
}
describe("Provider name editing", () => {
  it("updates only the display name with the trusted scope and expected version", async () => {
    const { controller, rename } = setup();
    const result = await controller.rename(
      { id: "request" } as never,
      "provider",
      { displayName: " Main ", expectedVersion: 3 },
    );
    expect(rename).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        settingId: "provider",
        displayName: "Main",
        expectedVersion: 3,
        audit: expect.objectContaining({
          actorPrincipalId: "owner",
        }) as unknown,
      }),
    );
    expect(result).toMatchObject({
      result: "renamed",
      provider: { displayName: "Main", version: 4 },
    });
  });
  it("rejects whitespace-only names before storage", async () => {
    const { controller, rename } = setup();
    await expect(
      controller.rename({} as never, "provider", {
        displayName: "  ",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(rename).not.toHaveBeenCalled();
  });
  it("reports concurrent edits as a conflict", async () => {
    const { controller, rename } = setup();
    rename.mockRejectedValue(
      new Error("Provider setting changed before this operation."),
    );
    await expect(
      controller.rename({ id: "request" } as never, "provider", {
        displayName: "Main",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
