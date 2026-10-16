import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import type { ServerConfig } from "../src/config.js";
import { InstanceAdministratorContextStore } from "../src/http/instance-administrator-context.js";
import { InstanceAdministratorGuard } from "../src/http/instance-administrator.guard.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const principalId = "01K00000000000000000000001";
const sessionId = "01K00000000000000000000002";
const scope: TrustedInstanceAdministratorScope = {
  instanceId: "kanvas-test",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "instance_administrator",
  authorityId: principalId,
  authorityVersion: 2,
  authorizationModelVersion: 1,
  trusted: true,
};
const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://127.0.0.1:5173"],
  },
} as unknown as ServerConfig;

function request(
  method: string,
  headers: Readonly<Record<string, string>> = {},
): FastifyRequest {
  return {
    method,
    headers,
    raw: { headers },
  } as FastifyRequest;
}

function executionContext(value: FastifyRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => value }),
  } as unknown as ExecutionContext;
}

describe("InstanceAdministratorGuard", () => {
  const resolveBrowserSession =
    vi.fn<AuthenticationGateway["resolveBrowserSession"]>();
  const resolveAdministrator =
    vi.fn<ServerDatabaseRuntime["instanceAccess"]["resolveAdministrator"]>();
  const authentication = {
    resolveBrowserSession,
    revokeSession: vi.fn<AuthenticationGateway["revokeSession"]>(),
    revokeAllHumanSessions:
      vi.fn<AuthenticationGateway["revokeAllHumanSessions"]>(),
    getVerifiedContact: vi.fn<AuthenticationGateway["getVerifiedContact"]>(),
  } satisfies AuthenticationGateway;
  const database = {
    instanceAccess: { resolveAdministrator },
  } as unknown as ServerDatabaseRuntime;
  const csrf = new CsrfTokenService(config);
  let contexts: InstanceAdministratorContextStore;
  let guard: InstanceAdministratorGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    contexts = new InstanceAdministratorContextStore();
    guard = new InstanceAdministratorGuard(
      config,
      authentication,
      database,
      csrf,
      contexts,
    );
  });

  it("rejects a missing browser session", async () => {
    resolveBrowserSession.mockResolvedValue(null);
    await expect(
      guard.canActivate(executionContext(request("GET"))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveAdministrator).not.toHaveBeenCalled();
  });

  it("rejects a mutation before authority lookup when CSRF is missing", async () => {
    resolveBrowserSession.mockResolvedValue({
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor",
    });
    await expect(
      guard.canActivate(
        executionContext(request("PUT", { origin: "http://127.0.0.1:5173" })),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolveAdministrator).not.toHaveBeenCalled();
  });

  it("rejects a valid session without active Instance authority", async () => {
    resolveBrowserSession.mockResolvedValue({
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor",
    });
    resolveAdministrator.mockResolvedValue({ status: "not_found" });
    await expect(
      guard.canActivate(executionContext(request("GET"))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("materializes only the database-authorized Instance scope", async () => {
    const authenticated = {
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor" as const,
    };
    resolveBrowserSession.mockResolvedValue(authenticated);
    resolveAdministrator.mockResolvedValue({
      status: "authorized",
      scope,
    });
    const httpRequest = request("PUT", {
      origin: "http://127.0.0.1:5173",
      "sec-fetch-site": "same-site",
      "x-kanvas-csrf": csrf.issue(sessionId),
    });

    await expect(
      guard.canActivate(executionContext(httpRequest)),
    ).resolves.toBe(true);
    expect(resolveAdministrator).toHaveBeenCalledWith({
      authSubjectId: authenticated.authSubjectId,
      sessionId,
    });
    expect(contexts.require(httpRequest)).toEqual({
      authentication: authenticated,
      scope,
    });
  });
});
