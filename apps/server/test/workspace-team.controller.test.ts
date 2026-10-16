import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  digestInvitationToken,
  type CreateWorkspaceInvitationOptions,
  type AcceptWorkspaceInvitationOptions,
  type ChangeWorkspaceMembershipOptions,
} from "@kanvas/database/runtime";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import type { ServerConfig } from "../src/config.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceTeamController } from "../src/http/workspace-team.controller.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const workspaceId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const sessionId = "01K00000000000000000000003";
const config = {
  auth: {
    baseUrl: "http://localhost:4177",
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    secureCookies: false,
    trustedOrigins: ["http://localhost:4177"],
  },
} as unknown as ServerConfig;
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000004",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["membership.manage"],
  trusted: true,
};

function unusedAuthentication(): AuthenticationGateway {
  return {
    resolveBrowserSession: () => Promise.resolve(null),
    revokeSession: () => Promise.resolve(false),
    revokeAllHumanSessions: () => Promise.resolve(),
    getVerifiedContact: () => Promise.resolve(null),
  };
}

function authorizedContexts(
  request: FastifyRequest,
): RequestAuthorizationContextStore {
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return contexts;
}

describe("WorkspaceTeamController", () => {
  it("sends one atomic batch with explicit versions and distinct audit facts", async () => {
    const request = {
      id: "request-change-team-batch",
    } as FastifyRequest;
    let received: readonly ChangeWorkspaceMembershipOptions[] | undefined;
    const controller = new WorkspaceTeamController(
      config,
      unusedAuthentication(),
      {
        authorization: {
          changeWorkspaceMemberships: (
            options: readonly ChangeWorkspaceMembershipOptions[],
          ) => {
            received = options;
            return Promise.resolve(
              options.map((option, index) => ({
                membershipId:
                  index === 0
                    ? "01K00000000000000000000008"
                    : "01K00000000000000000000009",
                role: option.nextRole,
                status: option.nextStatus,
                version: option.expectedTargetVersion + 1,
              })),
            );
          },
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
      authorizedContexts(request),
    );

    const result = await controller.changeMemberships(request, {
      changes: [
        {
          targetPrincipalId: "01K00000000000000000000006",
          expectedVersion: 2,
          role: "editor",
          status: "suspended",
        },
        {
          targetPrincipalId: "01K00000000000000000000007",
          expectedVersion: 5,
          role: "reviewer",
          status: "suspended",
        },
      ],
    });

    expect(result.members).toHaveLength(2);
    expect(received?.map((option) => option.targetPrincipalId)).toEqual([
      "01K00000000000000000000006",
      "01K00000000000000000000007",
    ]);
    expect(received?.[0]?.now).toEqual(received?.[1]?.now);
    expect(received?.[0]?.audit.auditEventId).not.toBe(
      received?.[1]?.audit.auditEventId,
    );
  });

  it("decodes one member page and returns independent opaque cursors", async () => {
    const request = {
      id: "request-list-team",
    } as FastifyRequest;
    let receivedQuery: unknown;
    const controller = new WorkspaceTeamController(
      config,
      {
        ...unusedAuthentication(),
        getHumanProfile: () =>
          Promise.resolve({
            displayName: "Lin",
            verifiedEmail: "lin@example.com",
          }),
      },
      {
        team: {
          listWorkspaceTeam: (
            _scope: TrustedWorkspaceScope,
            _now: Date,
            query: unknown,
          ) => {
            receivedQuery = query;
            return Promise.resolve({
              members: [
                {
                  membershipId: "01K00000000000000000000008",
                  principalId,
                  authSubjectId: "auth-subject",
                  role: "owner",
                  status: "active",
                  version: 2,
                  createdAt: new Date("2026-08-05T01:00:00.000Z"),
                  updatedAt: new Date("2026-08-05T02:00:00.000Z"),
                },
              ],
              invitations: [],
              membersNextCursor: {
                statusRank: 1,
                roleRank: 1,
                id: "01K00000000000000000000008",
              },
              invitationsNextCursor: {
                createdAt: new Date("2026-08-05T00:00:00.000Z"),
                id: "01K00000000000000000000009",
              },
            });
          },
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
      authorizedContexts(request),
    );
    const cursor = Buffer.from(
      JSON.stringify({
        statusRank: 1,
        roleRank: 2,
        id: "01K00000000000000000000007",
      }),
      "utf8",
    ).toString("base64url");

    const result = await controller.get(request, {
      pageKind: "members",
      cursor,
      limit: "25",
    });

    expect(receivedQuery).toMatchObject({
      pageKind: "members",
      cursor: {
        statusRank: 1,
        roleRank: 2,
        id: "01K00000000000000000000007",
      },
      limit: 25,
    });
    expect(result.members[0]).toMatchObject({
      displayName: "Lin",
      verifiedEmail: "lin@example.com",
      isCurrentHuman: true,
    });
    expect(result.membersNextCursor).toBeTruthy();
    expect(result.invitationsNextCursor).toBeTruthy();
  });

  it("returns a raw invitation token once but persists only its digest and prefix", async () => {
    let createInput: CreateWorkspaceInvitationOptions | undefined;
    const createWorkspaceInvitation = vi.fn(
      (input: CreateWorkspaceInvitationOptions) => {
        createInput = input;
        return Promise.resolve({
          invitationId: input.invitationId,
          targetEmailMasked: "de******@example.com",
          workspaceRole: input.workspaceRole,
          expiresAt: input.expiresAt,
          version: 1,
        });
      },
    );
    const request = {
      id: "request-create-invitation",
    } as FastifyRequest;
    const controller = new WorkspaceTeamController(
      config,
      unusedAuthentication(),
      {
        team: {
          createWorkspaceInvitation,
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
      authorizedContexts(request),
    );

    const result = await controller.create(request, {
      targetEmail: "designer@example.com",
      workspaceRole: "editor",
      expiresInHours: 168,
    });

    expect(result.invitationToken).toMatch(
      /^knv_invite_v1_[A-Za-z0-9_-]{43}$/u,
    );
    expect(result.invitePath).toBe(`/invite/${result.invitationToken}`);
    expect(createInput).toMatchObject({
      authority: scope,
      tokenHash: digestInvitationToken(result.invitationToken),
    });
    expect(createInput).not.toHaveProperty("invitationToken");
    expect(createInput?.tokenPrefix).not.toBe(result.invitationToken);
  });

  it("reports whether the signed-in identity matches the invitation without exposing its email", async () => {
    const invitationToken = `knv_invite_v1_${"b".repeat(43)}`;
    const request = {
      raw: {
        headers: {
          cookie: "kanvas.session_token=opaque",
        },
      },
    } as FastifyRequest;
    const responseHeaders = new Map<string, string>();
    const reply = {
      header: (name: string, value: string) => {
        responseHeaders.set(name.toLowerCase(), value);
        return reply;
      },
    } as unknown as FastifyReply;
    const controller = new WorkspaceTeamController(
      config,
      {
        ...unusedAuthentication(),
        resolveBrowserSession: () =>
          Promise.resolve({
            authSubjectId: "auth-subject",
            sessionId,
            authenticationStrength: "single_factor",
            verifiedContact: {
              email: "other@example.com",
            },
          }),
      },
      {
        team: {
          resolveInvitation: () =>
            Promise.resolve({
              invitationId: "01K00000000000000000000006",
              organizationId: scope.organizationId,
              organizationName: "Kanvas",
              workspaceId,
              workspaceName: "Studio",
              workspaceRole: "editor",
              targetEmail: "designer@example.com",
              targetEmailMasked: "de******@example.com",
              state: "pending",
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
            }),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
      new RequestAuthorizationContextStore(),
    );

    await expect(
      controller.resolve(
        request,
        {
          invitationToken,
        },
        reply,
      ),
    ).resolves.toMatchObject({
      identityStatus: "mismatched",
      targetEmailMasked: "de******@example.com",
    });
    expect(responseHeaders.get("cache-control")).toBe("no-store");
    expect(responseHeaders.get("set-cookie")).toContain(
      "kanvas.invitation_admission=",
    );
    expect(responseHeaders.get("set-cookie")).toContain("HttpOnly");
    expect(responseHeaders.get("set-cookie")).not.toContain(invitationToken);
  });

  it("starts email verification only for the exact invitation email", async () => {
    const invitationToken = `knv_invite_v1_${"c".repeat(43)}`;
    const registerInvitationEmailAccount = vi.fn(
      (): Promise<
        "created" | "unavailable" | "verification_resent" | "account_exists"
      > => Promise.resolve("created"),
    );
    const controller = new WorkspaceTeamController(
      config,
      {
        ...unusedAuthentication(),
        registerInvitationEmailAccount,
      },
      {
        team: {
          resolveInvitation: () =>
            Promise.resolve({
              invitationId: "01K00000000000000000000006",
              organizationId: scope.organizationId,
              organizationName: "Kanvas",
              workspaceId,
              workspaceName: "Studio",
              workspaceRole: "editor",
              targetEmail: "designer@example.com",
              targetEmailMasked: "de******@example.com",
              state: "pending",
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
            }),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
      new RequestAuthorizationContextStore(),
    );

    await expect(
      controller.registerInvitationAccount({
        invitationToken,
        email: "Designer@Example.com",
        displayName: "Designer",
        password: "long-enough-password",
      }),
    ).resolves.toEqual({
      targetEmailMasked: "de******@example.com",
    });
    expect(registerInvitationEmailAccount).toHaveBeenCalledWith({
      email: "designer@example.com",
      displayName: "Designer",
      password: "long-enough-password",
      verificationCallbackUrl: `http://localhost:4177/email-verification?returnTo=${encodeURIComponent(`/invite/${invitationToken}`)}`,
    });

    await expect(
      controller.registerInvitationAccount({
        invitationToken,
        email: "other@example.com",
        displayName: "Other",
        password: "long-enough-password",
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    registerInvitationEmailAccount.mockResolvedValueOnce("account_exists");
    await expect(
      controller.registerInvitationAccount({
        invitationToken,
        email: "designer@example.com",
        displayName: "Existing",
        password: "long-enough-password",
      }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("accepts only with the verified session identity and passes a digest to persistence", async () => {
    const invitationToken = `knv_invite_v1_${"a".repeat(43)}`;
    let acceptInput: AcceptWorkspaceInvitationOptions | undefined;
    const csrf = new CsrfTokenService(config);
    const authentication: AuthenticationGateway = {
      resolveBrowserSession: () =>
        Promise.resolve({
          authSubjectId: "auth-subject",
          sessionId,
          authenticationStrength: "single_factor",
          accountEmail: {
            email: "designer@example.com",
            emailVerified: true,
          },
          verifiedContact: {
            email: "designer@example.com",
          },
        }),
      revokeSession: () => Promise.resolve(false),
      revokeAllHumanSessions: () => Promise.resolve(),
      getVerifiedContact: () => Promise.resolve(null),
    };
    const request = {
      id: "request-accept-invitation",
      headers: {
        origin: "http://localhost:4177",
        "sec-fetch-site": "same-origin",
      },
      raw: {
        headers: {
          cookie: "kanvas.session_token=opaque",
        },
      },
    } as FastifyRequest;
    const controller = new WorkspaceTeamController(
      config,
      authentication,
      {
        authorization: {
          resolveHumanPrincipal: () =>
            Promise.resolve({
              principalId,
              status: "active",
              version: 1,
              created: false,
            }),
        },
        team: {
          acceptWorkspaceInvitation: (
            input: AcceptWorkspaceInvitationOptions,
          ) => {
            acceptInput = input;
            return Promise.resolve({
              invitationId: "01K00000000000000000000006",
              organizationId: scope.organizationId,
              workspaceId,
              membershipId: "01K00000000000000000000007",
              membershipRole: "editor",
              membershipVersion: 1,
              acceptedAt: input.now,
              replayed: false,
            });
          },
        },
      } as unknown as ServerDatabaseRuntime,
      csrf,
      new RequestAuthorizationContextStore(),
    );

    await expect(
      controller.accept(request, csrf.issue(sessionId), {
        invitationToken,
      }),
    ).resolves.toMatchObject({
      workspaceId,
      membershipRole: "editor",
      replayed: false,
    });
    expect(acceptInput).toMatchObject({
      tokenHash: digestInvitationToken(invitationToken),
      principalId,
      email: "designer@example.com",
      emailVerified: true,
    });
    expect(acceptInput).not.toHaveProperty("invitationToken");
  });

  it("matches and accepts an unverified account email only while policy exempts verification", async () => {
    const invitationToken = `knv_invite_v1_${"d".repeat(43)}`;
    let emailVerificationRequired = false;
    let acceptInput: AcceptWorkspaceInvitationOptions | undefined;
    const csrf = new CsrfTokenService(config);
    const request = {
      id: "request-accept-policy-exempt-invitation",
      headers: {
        origin: "http://localhost:4177",
        "sec-fetch-site": "same-origin",
      },
      raw: {
        headers: { cookie: "kanvas.session_token=opaque" },
      },
    } as FastifyRequest;
    const authentication: AuthenticationGateway = {
      ...unusedAuthentication(),
      resolveBrowserSession: () =>
        Promise.resolve({
          authSubjectId: "auth-subject",
          sessionId,
          authenticationStrength: "single_factor",
          accountEmail: {
            email: "Designer@Example.com",
            emailVerified: false,
          },
        }),
    };
    const controller = new WorkspaceTeamController(
      config,
      authentication,
      {
        authorization: {
          resolveHumanPrincipal: () =>
            Promise.resolve({
              principalId,
              status: "active",
              version: 1,
              created: false,
            }),
        },
        instanceAccess: {
          readRegistrationPolicy: () =>
            Promise.resolve({ emailVerificationRequired }),
        },
        team: {
          resolveInvitation: () =>
            Promise.resolve({
              invitationId: "01K00000000000000000000006",
              organizationId: scope.organizationId,
              organizationName: "Kanvas",
              workspaceId,
              workspaceName: "Studio",
              workspaceRole: "editor",
              targetEmail: "designer@example.com",
              targetEmailMasked: "de******@example.com",
              state: "pending",
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
            }),
          acceptWorkspaceInvitation: (
            input: AcceptWorkspaceInvitationOptions,
          ) => {
            acceptInput = input;
            return Promise.resolve({
              invitationId: "01K00000000000000000000006",
              organizationId: scope.organizationId,
              workspaceId,
              membershipId: "01K00000000000000000000007",
              membershipRole: "editor",
              membershipVersion: 1,
              acceptedAt: input.now,
              replayed: false,
            });
          },
        },
      } as unknown as ServerDatabaseRuntime,
      csrf,
      new RequestAuthorizationContextStore(),
    );

    await expect(
      controller.resolve(request, { invitationToken }),
    ).resolves.toMatchObject({ identityStatus: "matched" });
    await expect(
      controller.accept(request, csrf.issue(sessionId), { invitationToken }),
    ).resolves.toMatchObject({ replayed: false });
    expect(acceptInput).toMatchObject({
      email: "Designer@Example.com",
      emailVerified: false,
    });

    emailVerificationRequired = true;
    await expect(
      controller.resolve(request, { invitationToken }),
    ).resolves.toMatchObject({ identityStatus: "unverified" });
    await expect(
      controller.accept(request, csrf.issue(sessionId), { invitationToken }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
