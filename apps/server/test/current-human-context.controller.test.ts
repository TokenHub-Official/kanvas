import type { CurrentHumanContext } from "@kanvas/contracts/api";
import type { DatabaseRuntime } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import type { ServerConfig } from "../src/config.js";
import { CurrentHumanContextController } from "../src/http/current-human-context.controller.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const sessionId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
  },
} as ServerConfig;

describe("CurrentHumanContextController", () => {
  it("resolves the Principal and returns only accessible Workspace projections", async () => {
    const authentication = {
      resolveBrowserSession: () =>
        Promise.resolve({
          authSubjectId: "better-auth-user-1",
          sessionId,
          authenticationStrength: "single_factor" as const,
          displayName: "林设计",
          verifiedContact: {
            email: "lin@example.com",
          },
        }),
      revokeSession: () => Promise.resolve(false),
      revokeAllHumanSessions: () => Promise.resolve(),
      getVerifiedContact: () => Promise.resolve(null),
    } satisfies AuthenticationGateway;
    let principalResolutionInput: unknown;
    const resolveHumanPrincipal = vi.fn((input: unknown) => {
      principalResolutionInput = input;
      return Promise.resolve({
        principalId,
        status: "active" as const,
        version: 3,
        created: false,
      });
    });
    const listHumanWorkspaceContexts = vi.fn().mockResolvedValue([
      {
        organizationId: "01K00000000000000000000003",
        organizationName: "Kanvas",
        organizationVersion: 2,
        workspaceId: "01K00000000000000000000004",
        workspaceSlug: "visual-design",
        workspaceName: "视觉设计",
        workspaceVersion: 4,
        membershipId: "01K00000000000000000000005",
        membershipRole: "editor",
        membershipVersion: 6,
        permissions: [
          "workspace.read",
          "canvas.read",
          "canvas.write",
          "asset.read",
        ],
      },
      {
        organizationId: "01K00000000000000000000006",
        organizationName: "内容团队",
        organizationVersion: 1,
        workspaceId: "01K00000000000000000000007",
        workspaceSlug: "content-studio",
        workspaceName: "内容工作室",
        workspaceVersion: 2,
        membershipId: "01K00000000000000000000008",
        membershipRole: "viewer",
        membershipVersion: 3,
        permissions: ["workspace.read", "asset.read"],
      },
    ]);
    const csrf = new CsrfTokenService(config);
    const controller = new CurrentHumanContextController(
      authentication,
      {
        authorization: {
          resolveHumanPrincipal,
          listHumanWorkspaceContexts,
        },
        defaultAccess: {
          readStatus: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        instanceAccess: {
          resolveAdministrator: () =>
            Promise.resolve({
              status: "authorized" as const,
              scope: {
                instanceId: "kanvas-test",
                principalId,
                principalType: "human" as const,
                authenticationRefType: "session" as const,
                authenticationRefId: sessionId,
                authorityType: "instance_administrator" as const,
                authorityId: principalId,
                authorityVersion: 2,
                authorizationModelVersion: 1 as const,
                trusted: true as const,
              },
            }),
        },
      } as unknown as Pick<
        DatabaseRuntime,
        "authorization" | "instanceAccess" | "defaultAccess"
      >,
      csrf,
    );
    const request = {
      id: "request-current-human",
      raw: {
        headers: {
          cookie: "kanvas.session_token=opaque",
        },
      },
    } as FastifyRequest;

    const response: CurrentHumanContext = await controller.get(request);

    expect(resolveHumanPrincipal).toHaveBeenCalledOnce();
    expect(principalResolutionInput).toMatchObject({
      authSubjectId: "better-auth-user-1",
      audit: {
        requestId: "request-current-human",
      },
    });
    expect(listHumanWorkspaceContexts).toHaveBeenCalledWith({
      principalId,
    });
    expect(response).toMatchObject({
      authenticated: true,
      csrfToken: csrf.issue(sessionId),
      human: {
        principalId,
        status: "active",
        displayName: "林设计",
        verifiedEmail: "lin@example.com",
      },
      instanceAdministrator: {
        version: 2,
      },
      workspaces: [
        {
          id: "01K00000000000000000000004",
          slug: "visual-design",
          name: "视觉设计",
          membership: {
            role: "editor",
            version: 6,
          },
        },
        {
          id: "01K00000000000000000000007",
          slug: "content-studio",
          name: "内容工作室",
          organization: {
            id: "01K00000000000000000000006",
            name: "内容团队",
          },
          membership: {
            role: "viewer",
            version: 3,
          },
        },
      ],
      authorizationModelVersion: 1,
    });
    expect(response.contextVersion).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(response).not.toHaveProperty("authSubjectId");
    expect(response).not.toHaveProperty("sessionId");
  });
});
