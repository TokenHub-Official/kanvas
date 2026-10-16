import { describe, expect, it } from "vitest";
import { configurationChanges } from "./runtime-configuration-review.js";
import { initialRuntimeConfiguration } from "./runtime-configuration-model.js";
describe("configuration review differences", () => {
  it("shows only the edited limit", () => {
    const after = structuredClone(initialRuntimeConfiguration);
    after.agent.maximumModelCalls = 49;
    expect(configurationChanges(initialRuntimeConfiguration, after)).toEqual([
      { key: "modelCalls", before: 50, after: 49 },
    ]);
  });
  it("does not treat origin order as a policy change", () => {
    const before = structuredClone(initialRuntimeConfiguration);
    before.downloads.defaults.allowedOrigins = [
      "https://a.example",
      "https://b.example",
    ];
    const after = structuredClone(before);
    after.downloads.defaults.allowedOrigins!.reverse();
    expect(configurationChanges(before, after)).toEqual([]);
  });
  it("retains a removed service override as a return to inheritance", () => {
    const before = structuredClone(initialRuntimeConfiguration);
    before.downloads.providers = [
      {
        workspaceId: "workspace",
        providerEndpointId: "endpoint",
        rule: { enabled: false, allowedOrigins: [] },
      },
    ];
    const changes = configurationChanges(before, initialRuntimeConfiguration);
    expect(changes).toEqual([
      {
        key: "workspace:endpoint",
        before: { enabled: false, allowedOrigins: [] },
        after: undefined,
      },
    ]);
  });
  it("shows first-save values without inventing previous effective limits", () => {
    expect(
      configurationChanges(undefined, initialRuntimeConfiguration),
    ).toHaveLength(5);
    expect(
      configurationChanges(undefined, initialRuntimeConfiguration).every(
        (field) => field.before === undefined,
      ),
    ).toBe(true);
  });
});
