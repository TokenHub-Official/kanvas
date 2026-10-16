import { describe, expect, it } from "vitest";

import { resourceAdoptionIdempotencyKey } from "./resource-adoption-key.js";
import { resourceCatalogBrowseQuery } from "./resource-catalog-picker.js";

describe("resource adoption identity", () => {
  it("uses source-appropriate defaults before the user searches", () => {
    expect(resourceCatalogBrowseQuery("openverse.v1")).toBe("background");
    expect(resourceCatalogBrowseQuery("iconify.v1")).toBe("shape");
  });

  it("is stable for one pinned candidate and changes with its license terms", async () => {
    const candidate = {
      sourceRevisionId: "01K00000000000000000000001",
      externalId: "upstream:item/1",
      license: { termsDigest: `sha256:${"a".repeat(64)}` },
    };
    const first = await resourceAdoptionIdempotencyKey(candidate);

    await expect(resourceAdoptionIdempotencyKey(candidate)).resolves.toBe(
      first,
    );
    await expect(
      resourceAdoptionIdempotencyKey({
        ...candidate,
        license: { termsDigest: `sha256:${"b".repeat(64)}` },
      }),
    ).resolves.not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(160);
  });
});
