import { describe, expect, it } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
  },
} as ServerConfig;

describe("session-bound CSRF token", () => {
  it("is deterministic only within the exact session", () => {
    const service = new CsrfTokenService(config);
    const token = service.issue("01K00000000000000000000001");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(service.verify("01K00000000000000000000001", token)).toBe(true);
    expect(service.verify("01K00000000000000000000002", token)).toBe(false);
    expect(service.verify("01K00000000000000000000001", `${token}x`)).toBe(
      false,
    );
  });
});
