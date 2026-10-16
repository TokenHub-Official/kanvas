import { describe, expect, it } from "vitest";

import { validateCapabilityDefinitionsSearch } from "./capability-definitions.js";

describe("capability definitions search", () => {
  it("keeps list context while a capability detail is open", () => {
    expect(
      validateCapabilityDefinitionsSearch({
        capabilityId: "01K00000000000000000000000",
        q: "image",
        view: "archived",
      }),
    ).toEqual({
      capabilityId: "01K00000000000000000000000",
      q: "image",
      view: "archived",
    });
  });

  it("drops unknown views and bounds the query", () => {
    expect(
      validateCapabilityDefinitionsSearch({ q: "x".repeat(200), view: "all" }),
    ).toEqual({ q: "x".repeat(160) });
  });
});
