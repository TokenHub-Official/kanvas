import { describe, expect, it, vi } from "vitest";
import { confirmedResultLinks } from "../src/provider/provider-result-links.js";

describe("Confirmed result evidence", () => {
  it("retains denied original addresses without promoting them to usable links", () => {
    const url = "https://unlisted.example/result.png?signature=private";
    const facts = confirmedResultLinks(
      { request: vi.fn(), isResultUrlAllowed: () => false },
      [url],
    );
    expect(facts).toEqual({
      resultEvidence: { urls: [url], totalCount: 1, omittedCount: 0 },
    });
    expect(facts).not.toHaveProperty("resultUrls");
  });
  it("retains original evidence even when a result is allowed", () => {
    const url = "https://allowed.example/result.png?signature=private";
    expect(
      confirmedResultLinks(
        { request: vi.fn(), isResultUrlAllowed: () => true },
        [url],
      ),
    ).toEqual({
      resultUrls: [url],
      resultEvidence: { urls: [url], totalCount: 1, omittedCount: 0 },
    });
  });
});
