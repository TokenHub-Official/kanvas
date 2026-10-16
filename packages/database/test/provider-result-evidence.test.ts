import { describe, expect, it } from "vitest";
import { captureProviderResultEvidence } from "../src/runtime/provider-result-links.js";

describe("Private Provider result evidence", () => {
  it("preserves exact URL text and order without applying download origin policy", () => {
    const urls = [
      "http://127.0.0.1/output?a=1%2f2",
      "https://unknown.example:443/file?signature=secret#result",
    ];
    expect(captureProviderResultEvidence(urls)).toEqual({
      urls,
      totalCount: 2,
      omittedCount: 0,
    });
  });
  it("explicitly counts omitted oversized, malformed or credential-bearing entries", () => {
    expect(
      captureProviderResultEvidence([
        "https://valid.example/file",
        "https://user:password@host.test/file",
        "data:image/png;base64,private",
        null,
        "x".repeat(8193),
      ]),
    ).toEqual({
      urls: ["https://valid.example/file"],
      totalCount: 5,
      omittedCount: 4,
    });
    expect(
      captureProviderResultEvidence(
        Array.from({ length: 20 }, () => "https://valid.example/file"),
      ).omittedCount,
    ).toBe(4);
  });
  it("preserves an earlier omission count when normalizing at the storage boundary", () => {
    expect(
      captureProviderResultEvidence(["https://valid.example/file"], 4)
        .omittedCount,
    ).toBe(3);
    expect(() =>
      captureProviderResultEvidence(["https://valid.example/file"], 0),
    ).toThrow();
  });
});
