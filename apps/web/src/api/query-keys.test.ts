import { describe, expect, it } from "vitest";

import { workspaceQueryKeys } from "./query-keys.js";

describe("workspace query keys", () => {
  it("scopes creation entrypoints by workspace", () => {
    expect(workspaceQueryKeys.creationEntrypoints("workspace-a")).toEqual([
      "workspace",
      "workspace-a",
      "creation-entrypoints",
    ]);
    expect(workspaceQueryKeys.creationEntrypoints("workspace-b")).not.toEqual(
      workspaceQueryKeys.creationEntrypoints("workspace-a"),
    );
  });

  it.each([
    ["capability definitions", workspaceQueryKeys.capabilityDefinitions],
    ["provider settings", workspaceQueryKeys.providerSettings],
    ["team", workspaceQueryKeys.team],
    ["usage summary", workspaceQueryKeys.usageSummary],
  ])("scopes %s by workspace", (_label, createKey) => {
    expect(createKey("workspace-a")).not.toEqual(createKey("workspace-b"));
  });
});
