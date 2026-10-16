import { describe, expect, it } from "vitest";

import {
  developmentProxyStartupGraceMilliseconds,
  isConnectionRefused,
  isExpectedStartupProxyRefusal,
} from "./development-api-proxy.js";

describe("development API proxy diagnostics", () => {
  it("recognizes only connection refusals", () => {
    expect(
      isConnectionRefused(
        Object.assign(new Error("not listening"), { code: "ECONNREFUSED" }),
      ),
    ).toBe(true);
    expect(
      isConnectionRefused(
        Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      ),
    ).toBe(false);
  });

  it("downgrades only expected proxy refusals during startup", () => {
    const refusal =
      "http proxy error: /api/v1/auth/current-human-context/\n" +
      "Error: connect ECONNREFUSED 127.0.0.1:3000";
    expect(isExpectedStartupProxyRefusal(refusal, 1_000)).toBe(true);
    expect(
      isExpectedStartupProxyRefusal(
        refusal,
        developmentProxyStartupGraceMilliseconds + 1,
      ),
    ).toBe(false);
    expect(
      isExpectedStartupProxyRefusal(
        "http proxy error: /api\nError: socket hang up",
        1_000,
      ),
    ).toBe(false);
  });
});
