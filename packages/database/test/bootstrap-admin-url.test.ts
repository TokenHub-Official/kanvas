import { describe, expect, it } from "vitest";

import { formatInstanceSetupUrl } from "../src/cli/bootstrap-admin-url.js";

const token = `knv_setup_v1_${"a".repeat(43)}`;

describe("bootstrap admin setup URL", () => {
  it("returns a deployable relative link when no public origin is configured", () => {
    expect(formatInstanceSetupUrl(token)).toBe(`/setup#setup=${token}`);
  });

  it("uses the configured public origin without putting the credential in the request path", () => {
    expect(formatInstanceSetupUrl(token, "https://kanvas.example")).toBe(
      `https://kanvas.example/setup#setup=${token}`,
    );
  });

  it("rejects credential-bearing or non-HTTP origins", () => {
    expect(() =>
      formatInstanceSetupUrl(token, "https://user:password@kanvas.example"),
    ).toThrow(/credential-free/u);
    expect(() => formatInstanceSetupUrl(token, "file:///srv/kanvas")).toThrow(
      /HTTP\(S\)/u,
    );
  });
});
