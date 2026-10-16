import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import { BrowserSessionContextController } from "../src/http/browser-session-context.controller.js";
import type { ServerConfig } from "../src/config.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const sessionId = "01K00000000000000000000001";
const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
  },
} as ServerConfig;

describe("BrowserSessionContextController", () => {
  it("returns only a session-bound CSRF token", async () => {
    const authentication = {
      resolveBrowserSession: () =>
        Promise.resolve({
          authSubjectId: "01K00000000000000000000002",
          sessionId,
          authenticationStrength: "single_factor" as const,
        }),
      revokeSession: () => Promise.resolve(false),
      revokeAllHumanSessions: () => Promise.resolve(),
      getVerifiedContact: () => Promise.resolve(null),
    } satisfies AuthenticationGateway;
    const csrf = new CsrfTokenService(config);
    const controller = new BrowserSessionContextController(
      authentication,
      csrf,
    );
    const request = {
      raw: {
        headers: {
          cookie: "kanvas.session_token=opaque",
        },
      },
    } as FastifyRequest;

    const response = await controller.get(request);

    expect(response).toEqual({
      authenticated: true,
      csrfToken: csrf.issue(sessionId),
    });
    expect(response).not.toHaveProperty("authSubjectId");
    expect(response).not.toHaveProperty("sessionId");
  });
});
