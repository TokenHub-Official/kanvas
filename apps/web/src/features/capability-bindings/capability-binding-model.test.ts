import { describe, expect, it } from "vitest";

import { activeBindingCount } from "./capability-binding-model.js";

describe("Capability Binding presentation", () => {
  it("counts only enabled candidates", () => {
    expect(
      activeBindingCount([
        {
          id: "01K00000000000000000000001",
          status: "enabled",
          order: 1,
          version: 1,
          executionTarget: "browser",
          displayName: {
            defaultLocale: "en-US",
            values: { "en-US": "Browser example" },
          },
          sourceKind: "plugin",
          availabilityReason: "ready",
          implementationKey: "example.browser",
          implementationRevision: 1,
          adapterKey: "example.browser.v1",
          updatedAt: "2026-08-06T00:00:00.000Z",
        },
        {
          id: "01K00000000000000000000002",
          status: "paused",
          order: 2,
          version: 1,
          executionTarget: "worker",
          displayName: {
            defaultLocale: "en-US",
            values: { "en-US": "Worker example" },
          },
          sourceKind: "plugin",
          availabilityReason: "ready",
          implementationKey: "example.worker",
          implementationRevision: 1,
          adapterKey: "example.worker.v1",
          updatedAt: "2026-08-06T00:00:00.000Z",
        },
      ]),
    ).toBe(1);
  });
});
