import { describe, expect, it } from "vitest";

import { validateBrandSearch } from "./brand.js";

describe("Agent Hub detail links", () => {
  it("keeps valid Brand targets across a page reload", () => {
    const detailId = "01K00000000000000000000001";
    expect(
      validateBrandSearch({
        brandKitId: detailId,
        returnTo: "/w/01K00000000000000000000000/agent",
      }),
    ).toEqual({
      brandKitId: detailId,
      returnTo: "/w/01K00000000000000000000000/agent",
    });
  });

  it("drops invalid or unsafe detail-link state", () => {
    expect(
      validateBrandSearch({
        brandKitId: "brand",
        returnTo: "https://example.com",
      }),
    ).toEqual({});
  });
});
