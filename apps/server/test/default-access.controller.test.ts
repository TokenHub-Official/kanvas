import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  DefaultAccessController,
  DefaultAccessRecoveryController,
} from "../src/http/default-access.controller.js";
import { InstanceAdministratorContextStore } from "../src/http/instance-administrator-context.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerConfig } from "../src/config.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
const config = {
  auth: {
    trustedOrigins: ["http://localhost:3000"],
    secret: "test-only-secret-with-at-least-32-characters",
    oauthProviders: [{ type: "oidc", id: "company" }],
  },
} as unknown as ServerConfig;
const sessionId = "session-current-human";
describe("default access controllers", () => {
  it("rejects undeployed OIDC identities before changing policy", () => {
    const updatePolicy = vi.fn();
    const database = {
      defaultAccess: { updatePolicy },
    } as unknown as ServerDatabaseRuntime;
    const controller = new DefaultAccessController(
      database,
      config,
      new InstanceAdministratorContextStore(),
    );
    expect(() =>
      controller.update({} as FastifyRequest, {
        enabled: true,
        workspaceId: "01K00000000000000000000001",
        role: "operator",
        oidcProviderIds: ["attacker"],
        verifiedDomains: [],
        expectedVersion: 0,
      }),
    ).toThrow(BadRequestException);
    expect(updatePolicy).not.toHaveBeenCalled();
  });
  it("only retries the authenticated subject after Origin and session CSRF validation", async () => {
    const process = vi
      .fn()
      .mockResolvedValue({ state: "granted", reason: "assigned" });
    const database = {
      defaultAccess: { process },
    } as unknown as ServerDatabaseRuntime;
    const resolveBrowserSession = vi
      .fn()
      .mockResolvedValue({ authSubjectId: "current-user", sessionId });
    const authentication = {
      resolveBrowserSession,
    } as unknown as AuthenticationGateway;
    const csrf = new CsrfTokenService(config);
    const controller = new DefaultAccessRecoveryController(
      database,
      authentication,
      config,
      csrf,
    );
    const request = (headers: Record<string, string>) =>
      ({
        raw: { headers: {} },
        headers,
        body: { authSubjectId: "another-user" },
      }) as unknown as FastifyRequest;
    await expect(
      controller.retry(request({ origin: "http://localhost:3000" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.retry(
        request({
          origin: "https://attacker.test",
          "x-kanvas-csrf": csrf.issue(sessionId),
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.retry(
        request({
          origin: "http://localhost:3000",
          "sec-fetch-site": "cross-site",
          "x-kanvas-csrf": csrf.issue(sessionId),
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(process).not.toHaveBeenCalled();
    await expect(
      controller.retry(
        request({
          origin: "http://localhost:3000",
          "x-kanvas-csrf": csrf.issue(sessionId),
        }),
      ),
    ).resolves.toEqual({ state: "granted", reason: "assigned" });
    expect(process).toHaveBeenCalledExactlyOnceWith("current-user");
    resolveBrowserSession.mockResolvedValue(null);
    await expect(controller.retry(request({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
