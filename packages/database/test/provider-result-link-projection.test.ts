import { describe, expect, it } from "vitest";
import { projectProviderResultLinks } from "../src/runtime/provider-result-links.js";

const url = "https://v3b.fal.media/result.png?signature=opaque";
const allow = { enabled: true, allowedOrigins: null };
describe("Provider result link projection", () => {
  it("projects retained evidence without requiring the obsolete resultUrls field", () => {
    expect(
      projectProviderResultLinks({ resultEvidence: { urls: [url] } }, allow),
    ).toEqual([url]);
    expect(projectProviderResultLinks({ resultUrls: [url] }, allow)).toEqual([
      url,
    ]);
  });
  it("applies the current rule to both new evidence and legacy links", () => {
    for (const facts of [
      { resultEvidence: { urls: [url] } },
      { resultUrls: [url] },
    ]) {
      expect(
        projectProviderResultLinks(facts, { ...allow, enabled: false }),
      ).toEqual([]);
      expect(
        projectProviderResultLinks(facts, {
          ...allow,
          allowedOrigins: ["https://other.example"],
        }),
      ).toEqual([]);
      expect(
        projectProviderResultLinks(facts, {
          ...allow,
          allowedOrigins: ["https://v3b.fal.media"],
        }),
      ).toEqual([url]);
    }
  });
  it("does not expose unsafe evidence or fall back around an empty evidence list", () => {
    expect(
      projectProviderResultLinks(
        {
          resultEvidence: {
            urls: [
              "http://cdn.example/result",
              "https://user:secret@cdn.example/result",
              "https://localhost/result",
              "https://127.0.0.1/result",
              "https://[::1]/result",
              "https://[::ffff:127.0.0.1]/result",
              "https://192.168.1.1/result",
              "https://cdn.example/result#secret",
              url,
              url,
            ],
          },
        },
        allow,
      ),
    ).toEqual([url]);
    expect(
      projectProviderResultLinks(
        { resultEvidence: { urls: [] }, resultUrls: [url] },
        allow,
      ),
    ).toEqual([]);
  });
});
