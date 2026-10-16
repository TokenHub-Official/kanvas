import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { AuthorizationStore } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import type { ServerConfig } from "../src/config.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "../src/http/workspace-authorization.guard.js";
import { WORKSPACE_PERMISSION_METADATA } from "../src/http/workspace-permission.decorator.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const workspaceId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const sessionId = "01K00000000000000000000003";
const authSubjectId = "01K00000000000000000000004";

const config = {
  environment: "test",
  demo: {
    enabled: false,
  },
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://127.0.0.1:5173"],
  },
} as unknown as ServerConfig;

const trustedScope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000005",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000006",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["workflow.run"],
  trusted: true,
};

function httpRequest(
  method: string,
  headers: Readonly<Record<string, string>> = {},
): FastifyRequest {
  return {
    method,
    id: "request-1",
    headers,
    raw: {
      headers,
    },
  } as FastifyRequest;
}

function executionContext(request: FastifyRequest): ExecutionContext {
  const handler = (): void => undefined;
  Reflect.defineMetadata(
    WORKSPACE_PERMISSION_METADATA,
    "workflow.run",
    handler,
  );
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("WorkspaceAuthorizationGuard", () => {
  const resolveBrowserSession =
    vi.fn<AuthenticationGateway["resolveBrowserSession"]>();
  const resolveHumanPrincipal =
    vi.fn<AuthorizationStore["resolveHumanPrincipal"]>();
  const resolveHumanWorkspaceScope =
    vi.fn<AuthorizationStore["resolveHumanWorkspaceScope"]>();
  const resolveServiceWorkspaceScope =
    vi.fn<AuthorizationStore["resolveServiceWorkspaceScope"]>();
  const authorization = {
    resolveHumanPrincipal,
    resolveHumanWorkspaceScope,
    resolveServiceWorkspaceScope,
    listHumanWorkspaceContexts: vi.fn<
      AuthorizationStore["listHumanWorkspaceContexts"]
    >(() => Promise.resolve([])),
    changeWorkspaceMembership:
      vi.fn<AuthorizationStore["changeWorkspaceMembership"]>(),
    changeWorkspaceMemberships:
      vi.fn<AuthorizationStore["changeWorkspaceMemberships"]>(),
    addExistingWorkspaceMember:
      vi.fn<AuthorizationStore["addExistingWorkspaceMember"]>(),
    changeOrganizationMembership:
      vi.fn<AuthorizationStore["changeOrganizationMembership"]>(),
  } satisfies AuthorizationStore;
  const authentication = {
    resolveBrowserSession,
    revokeSession: vi.fn<AuthenticationGateway["revokeSession"]>(),
    revokeAllHumanSessions:
      vi.fn<AuthenticationGateway["revokeAllHumanSessions"]>(),
    getVerifiedContact: vi.fn<AuthenticationGateway["getVerifiedContact"]>(),
  } satisfies AuthenticationGateway;
  const database = {
    authorization,
  } as unknown as ServerDatabaseRuntime;
  const csrf = new CsrfTokenService(config);
  let contexts: RequestAuthorizationContextStore;
  let guard: WorkspaceAuthorizationGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    contexts = new RequestAuthorizationContextStore();
    guard = new WorkspaceAuthorizationGuard(
      new Reflector(),
      config,
      authentication,
      database,
      csrf,
      contexts,
    );
  });

  it("rejects a missing session before any Principal write", async () => {
    resolveBrowserSession.mockResolvedValue(null);
    const request = httpRequest("GET", {
      "x-kanvas-workspace-id": workspaceId,
    });

    await expect(
      guard.canActivate(executionContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveHumanPrincipal).not.toHaveBeenCalled();
  });

  it("rejects mutation CSRF before any Principal write", async () => {
    resolveBrowserSession.mockResolvedValue({
      authSubjectId,
      sessionId,
      authenticationStrength: "single_factor",
    });
    const request = httpRequest("POST", {
      origin: "http://127.0.0.1:5173",
      "x-kanvas-workspace-id": workspaceId,
    });

    await expect(
      guard.canActivate(executionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolveHumanPrincipal).not.toHaveBeenCalled();
  });

  it("materializes only the database-authorized workspace scope", async () => {
    resolveBrowserSession.mockResolvedValue({
      authSubjectId,
      sessionId,
      authenticationStrength: "single_factor",
    });
    resolveHumanPrincipal.mockResolvedValue({
      principalId,
      status: "active",
      version: 1,
      created: false,
    });
    resolveHumanWorkspaceScope.mockResolvedValue({
      status: "authorized",
      scope: trustedScope,
    });
    const request = httpRequest("POST", {
      origin: "http://127.0.0.1:5173",
      "sec-fetch-site": "same-site",
      "x-kanvas-csrf": csrf.issue(sessionId),
      "x-kanvas-workspace-id": workspaceId,
    });

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(resolveHumanWorkspaceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        authSubjectId,
        sessionId,
        requestedWorkspaceId: workspaceId,
        requiredPermission: "workflow.run",
      }),
    );
    expect(contexts.require(request).scope).toBe(trustedScope);
  });

  it("preserves not-found disclosure for a non-visible workspace", async () => {
    resolveBrowserSession.mockResolvedValue({
      authSubjectId,
      sessionId,
      authenticationStrength: "single_factor",
    });
    resolveHumanPrincipal.mockResolvedValue({
      principalId,
      status: "active",
      version: 1,
      created: false,
    });
    resolveHumanWorkspaceScope.mockResolvedValue({
      status: "not_found",
      reason: "workspace_not_visible",
    });
    const request = httpRequest("GET", {
      "x-kanvas-workspace-id": workspaceId,
    });

    await expect(
      guard.canActivate(executionContext(request)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("authorizes a Service Bearer token without browser CSRF", async () => {
    const serviceScope: TrustedWorkspaceScope = {
      ...trustedScope,
      principalType: "service",
      authenticationRefType: "service_api_token",
      authenticationRefId: "01K00000000000000000000007",
      authorityType: "service_grant",
    };
    resolveServiceWorkspaceScope.mockResolvedValue({
      status: "authorized",
      scope: serviceScope,
    });
    const request = httpRequest("POST", {
      authorization: `Bearer kvs_${"a".repeat(48)}`,
      "x-kanvas-workspace-id": workspaceId,
    });

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(resolveBrowserSession).not.toHaveBeenCalled();
    const resolutionInput = resolveServiceWorkspaceScope.mock.calls[0]?.[0];
    expect(resolutionInput).toMatchObject({
      requestedWorkspaceId: workspaceId,
      requiredPermission: "workflow.run",
    });
    expect(resolutionInput?.tokenHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(contexts.require(request).scope).toBe(serviceScope);
  });
});
