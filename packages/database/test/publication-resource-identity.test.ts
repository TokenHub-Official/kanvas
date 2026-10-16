import { describe, expect, it } from "vitest";

import { skillResourceMatchesStoredObject } from "../src/runtime/publication-governance-store.js";

describe("Skill publication resource identity", () => {
  it("accepts BIGINT byte sizes returned as strings by the Runtime Pool", () => {
    expect(
      skillResourceMatchesStoredObject(
        {
          sha256: "a".repeat(64),
          byteSize: "1385",
          mediaType: "text/markdown",
          deleteState: "active",
        },
        {
          contentDigest: `sha256:${"a".repeat(64)}`,
          byteSize: 1385,
          mediaType: "text/markdown",
        },
      ),
    ).toBe(true);
  });
});
