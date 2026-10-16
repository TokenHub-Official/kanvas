import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAuthenticationEngine,
  type AuthenticationDatabaseRuntime,
} from "../src/auth/authentication-engine.js";
import { issueInvitationAdmissionCookie } from "../src/auth/invitation-admission.js";
import type { ServerConfig } from "../src/config.js";

const baseConfig: ServerConfig = {
  environment: "test",
  instanceId: "auth-engine-test",
  host: "127.0.0.1",
  port: 3000,
  trustedProxyHops: 0,
  trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
  serviceVersion: "0.0.0-test",
  cancellationGraceMs: 30_000,
  demo: {
    enabled: false,
    workspaceId: "01K00000000000000000000000",
    actorId: "01K00000000000000000000001",
  },
  database: {
    host: "127.0.0.1",
    port: 3306,
    database: "kanvas",
    user: "kanvas",
    password: "test-only",
    connectionLimit: 1,
  },
  enabledExecutionTargets: ["worker"],
  providerSecrets: {
    deploymentSecretFiles: {},
    kekFiles: {},
  },
  auth: {
    baseUrl: "http://127.0.0.1:3000",
    basePath: "/api/auth",
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://127.0.0.1:3000"],
    secureCookies: false,
    emailAndPasswordEnabled: true,
    sessionExpiresInSeconds: 604_800,
    sessionUpdateAgeSeconds: 86_400,
  },
  browserExecutor: {
    enabled: false,
    controlPlaneVersion: 1,
    sessionTtlSeconds: 3_600,
    attemptLeaseDurationMs: 30_000,
    candidateLimit: 20,
  },
  checkConfigOnly: false,
};

const database = {
  defaultAccess: {
    recordRegistration: vi.fn().mockResolvedValue(undefined),
    process: vi
      .fn()
      .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
  },
  db: {},
  instanceAccess: {
    registrationAllowed: vi.fn(() => Promise.resolve(false)),
    readRegistrationPolicy: vi.fn(() =>
      Promise.resolve({ emailVerificationRequired: true }),
    ),
  },
} as unknown as AuthenticationDatabaseRuntime;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Kanvas Authentication Engine composition", () => {
  it("registers common social providers without enabling public signup", async () => {
    const types = ["github", "google", "microsoft", "discord"] as const;
    const auth = createAuthenticationEngine({
      database,
      config: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthProviders: types.map((type) => ({
            id: type,
            type,
            name: type,
            clientId: "test-client",
            clientSecret: "test-secret",
          })),
        },
      },
    });
    const context = await auth.$context;
    expect(context.socialProviders.map((provider) => provider.id)).toEqual([
      ...types,
    ]);
    for (const provider of context.socialProviders)
      expect(provider.options?.disableSignUp).toBe(true);
  });
  it.each([
    ["client_secret_basic", true],
    ["client_secret_post", false],
  ] as const)(
    "maps the standard %s token authentication method",
    async (tokenEndpointAuthMethod, expectsBasicHeader) => {
      const auth = createAuthenticationEngine({
        database,
        config: {
          ...baseConfig,
          auth: {
            ...baseConfig.auth,
            oauthProviders: [
              {
                id: "company",
                type: "oidc",
                name: "Company",
                clientId: "test-client",
                clientSecret: "test-secret",
                discoveryUrl:
                  "https://identity.example.com/.well-known/openid-configuration",
                issuer: "https://identity.example.com",
                tokenEndpointAuthMethod,
              },
            ],
          },
        },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            issuer: "https://identity.example.com",
            authorization_endpoint: "https://identity.example.com/auth",
            token_endpoint: "https://identity.example.com/token",
            userinfo_endpoint: "https://identity.example.com/userinfo",
            jwks_uri: "https://identity.example.com/keys",
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            token_endpoint_auth_methods_supported: [tokenEndpointAuthMethod],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            access_token: "access",
            id_token: "id-token",
            token_type: "Bearer",
          }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const context = await auth.$context;
      const oidc = context.socialProviders.find(
        (provider) => provider.id === "company",
      );

      await oidc?.validateAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "code-verifier",
        redirectURI: "http://127.0.0.1:3000/api/auth/oauth2/callback/company",
      });

      const tokenRequest = fetchMock.mock.calls[1]?.[1] as
        RequestInit | undefined;
      const headers = new Headers(tokenRequest?.headers);
      const body = tokenRequest?.body as URLSearchParams;
      expect(headers.has("authorization")).toBe(expectsBasicHeader);
      expect(body.has("client_secret")).toBe(!expectsBasicHeader);
    },
  );
  it("lets configured OIDC registration reach the current Instance policy", async () => {
    const registrationAllowed = vi.fn(() => Promise.resolve(true));
    const auth = createAuthenticationEngine({
      database: {
        defaultAccess: {
          recordRegistration: vi.fn().mockResolvedValue(undefined),
          process: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        db: {},
        instanceAccess: { registrationAllowed },
      } as unknown as AuthenticationDatabaseRuntime,
      config: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthProviders: [
            {
              id: "company",
              type: "oidc",
              name: "Company",
              clientId: "test-client",
              clientSecret: "test-secret",
              discoveryUrl:
                "https://identity.example.com/.well-known/openid-configuration",
              issuer: "https://identity.example.com",
              tokenEndpointAuthMethod: "client_secret_basic",
            },
          ],
        },
      },
    });
    const context = await auth.$context;
    expect(
      context.socialProviders.find(({ id }) => id === "company")?.options
        ?.disableSignUp,
    ).not.toBe(true);

    const before = auth.options.databaseHooks?.user?.create?.before;
    const user = {
      id: "01K00000000000000000000009",
      name: "OIDC User",
      email: "member@example.com",
      emailVerified: true,
      image: null,
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
      updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    await expect(
      before?.(user, {
        path: "/oauth2/callback/:providerId",
        params: { providerId: "company" },
      } as never),
    ).resolves.toEqual({ data: user });
    expect(registrationAllowed).toHaveBeenCalledWith({
      kind: "oidc",
      providerId: "company",
    });
  });
  it("requires a verified matching email for the invitation OIDC override", async () => {
    const recordRegistration = vi.fn().mockResolvedValue(undefined);
    const tokenHash = `sha256:${"c".repeat(64)}`;
    const resolveInvitation = vi.fn(() =>
      Promise.resolve({
        invitationId: "01K00000000000000000000010",
        organizationId: "01K00000000000000000000011",
        organizationName: "Kanvas",
        workspaceId: "01K00000000000000000000012",
        workspaceName: "Studio",
        workspaceRole: "editor" as const,
        targetEmail: "invited@example.com",
        targetEmailMasked: "in*****@example.com",
        state: "pending" as const,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const auth = createAuthenticationEngine({
      database: {
        defaultAccess: {
          recordRegistration,
          process: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        db: {},
        instanceAccess: {
          registrationAllowed: () => Promise.resolve(false),
        },
        team: { resolveInvitation },
      } as unknown as AuthenticationDatabaseRuntime,
      config: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthProviders: [
            {
              id: "company",
              type: "oidc",
              name: "Company",
              clientId: "test-client",
              clientSecret: "test-secret",
              discoveryUrl:
                "https://identity.example.com/.well-known/openid-configuration",
              issuer: "https://identity.example.com",
              tokenEndpointAuthMethod: "client_secret_basic",
            },
          ],
        },
      },
    });
    const [cookie] = issueInvitationAdmissionCookie({
      config: baseConfig.auth,
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitationTokenHash: tokenHash,
      now: new Date(),
    }).split(";", 1);
    if (!cookie) throw new Error("Invitation admission cookie was not issued.");
    const before = auth.options.databaseHooks?.user?.create?.before;
    const user = {
      id: "01K00000000000000000000009",
      name: "OIDC User",
      email: "invited@example.com",
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context = {
      path: "/oauth2/callback/:providerId",
      params: { providerId: "company" },
      headers: new Headers({ cookie }),
    } as never;

    await expect(before?.(user, context)).resolves.toBe(false);
    expect(resolveInvitation).not.toHaveBeenCalled();
    await expect(
      before?.({ ...user, emailVerified: true }, context),
    ).resolves.toEqual({ data: { ...user, emailVerified: true } });
    expect(resolveInvitation).toHaveBeenCalledWith(tokenHash, expect.any(Date));
    await auth.options.databaseHooks?.user?.create?.after?.(
      { ...user, emailVerified: true },
      context,
    );
    expect(recordRegistration).toHaveBeenCalledWith(
      user.id,
      "invitation",
      "company",
    );

    await expect(
      before?.(
        { ...user, email: "other@example.com", emailVerified: true },
        context,
      ),
    ).resolves.toBe(false);
  });
  it("leaves email signup admission to the dynamic Instance policy", () => {
    const auth = createAuthenticationEngine({
      config: baseConfig,
      database,
    });

    expect(auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      requireEmailVerification: false,
    });
    expect(auth.options.session?.cookieCache).toEqual({
      enabled: false,
    });
    expect(auth.options.account?.accountLinking?.disableImplicitLinking).toBe(
      true,
    );
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
    expect(auth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
    });
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([
      "x-kanvas-trusted-client-ip",
    ]);
  });

  it("materializes active verified or policy-exempt humans before creating a session", async () => {
    let emailVerificationRequired = true;
    const resolveHumanPrincipal = vi
      .fn()
      .mockResolvedValueOnce({
        principalId: "01K00000000000000000000010",
        status: "active",
        version: 1,
        created: true,
      })
      .mockResolvedValueOnce({
        principalId: "01K00000000000000000000010",
        status: "suspended",
        version: 2,
        created: false,
      });
    const auth = createAuthenticationEngine({
      config: baseConfig,
      database: {
        authorization: { resolveHumanPrincipal },
        defaultAccess: {
          recordRegistration: vi.fn().mockResolvedValue(undefined),
          process: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        db: {},
        instanceAccess: {
          registrationAllowed: () => Promise.resolve(false),
          readRegistrationPolicy: () =>
            Promise.resolve({ emailVerificationRequired }),
        },
        team: { resolveInvitation: () => Promise.resolve(null) },
      } as unknown as AuthenticationDatabaseRuntime,
    });
    const before = auth.options.databaseHooks?.session?.create?.before;
    const session = {
      id: "01K00000000000000000000011",
      token: "opaque-session-token",
      userId: "01K00000000000000000000012",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "192.0.2.1",
      userAgent: "Browser",
    };
    const findUserById = vi.fn();
    const context = {
      context: {
        internalAdapter: { findUserById },
      },
    } as never;

    findUserById.mockResolvedValueOnce({
      id: session.userId,
      email: "member@example.com",
      emailVerified: false,
      name: "Member",
    });
    await expect(before?.(session, context)).rejects.toThrow(
      "Email not verified",
    );
    expect(resolveHumanPrincipal).not.toHaveBeenCalled();

    emailVerificationRequired = false;
    findUserById.mockResolvedValue({
      id: session.userId,
      email: "member@example.com",
      emailVerified: false,
      name: "Member",
    });
    await expect(before?.(session, context)).resolves.toEqual({
      data: { ...session, ipAddress: null, userAgent: null },
    });
    expect(resolveHumanPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ authSubjectId: session.userId }),
    );

    findUserById.mockResolvedValue({
      id: session.userId,
      email: "member@example.com",
      emailVerified: true,
      name: "Member",
    });
    await expect(before?.(session, context)).resolves.toBe(false);
  });

  it("routes verified email signup through the current Instance policy", async () => {
    const registrationAllowed = vi.fn(() => Promise.resolve(true));
    const auth = createAuthenticationEngine({
      database: {
        defaultAccess: {
          recordRegistration: vi.fn().mockResolvedValue(undefined),
          process: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        db: {},
        instanceAccess: { registrationAllowed },
      } as unknown as AuthenticationDatabaseRuntime,
      config: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          emailVerificationDelivery: {
            kind: "development_outbox",
            file: "/tmp/kanvas-auth-engine-email-outbox.jsonl",
            fromAddress: "kanvas@localhost.invalid",
            fromName: "Kanvas",
          },
        },
      },
    });

    expect(auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      requireEmailVerification: false,
    });
    expect(auth.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3_600,
    });

    const before = auth.options.databaseHooks?.user?.create?.before;
    const user = {
      id: "01K00000000000000000000009",
      name: "Email User",
      email: "member@example.com",
      emailVerified: false,
      image: null,
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
      updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    await expect(
      before?.(user, {
        path: "/sign-up/email",
      } as never),
    ).resolves.toEqual({ data: user });
    expect(registrationAllowed).toHaveBeenCalledWith({
      kind: "email_password",
    });
  });

  it("uses an explicit Host cookie name only for secure deployments", () => {
    const insecure = createAuthenticationEngine({
      config: baseConfig,
      database,
    });
    const secure = createAuthenticationEngine({
      config: {
        ...baseConfig,
        environment: "production",
        auth: {
          ...baseConfig.auth,
          baseUrl: "https://kanvas.example.com",
          trustedOrigins: ["https://kanvas.example.com"],
          secureCookies: true,
        },
      },
      database,
    });

    expect(insecure.options.advanced?.cookiePrefix).toBe("kanvas");
    expect(insecure.options.advanced?.defaultCookieAttributes).toMatchObject({
      secure: false,
      httpOnly: true,
      path: "/",
    });
    expect(secure.options.advanced?.cookiePrefix).toBe("__Host-kanvas");
    expect(secure.options.advanced?.defaultCookieAttributes).toMatchObject({
      secure: true,
      httpOnly: true,
      path: "/",
    });
    expect("crossSubDomainCookies" in (secure.options.advanced ?? {})).toBe(
      false,
    );
  });

  it("removes IP and User-Agent before a session reaches the database", async () => {
    const resolveHumanPrincipal = vi.fn(() =>
      Promise.resolve({
        principalId: "01K00000000000000000000004",
        status: "active" as const,
        version: 1,
        created: true,
      }),
    );
    const auth = createAuthenticationEngine({
      config: baseConfig,
      database: {
        authorization: { resolveHumanPrincipal },
        defaultAccess: {
          recordRegistration: vi.fn().mockResolvedValue(undefined),
          process: vi
            .fn()
            .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
        },
        db: {},
        instanceAccess: {
          registrationAllowed: () => Promise.resolve(false),
        },
        team: { resolveInvitation: () => Promise.resolve(null) },
      } as unknown as AuthenticationDatabaseRuntime,
    });
    const before = auth.options.databaseHooks?.session?.create?.before;

    expect(before).toBeTypeOf("function");
    await expect(
      before?.(
        {
          id: "01K00000000000000000000002",
          token: "opaque-token",
          userId: "01K00000000000000000000003",
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-28T00:00:00.000Z"),
          ipAddress: "192.0.2.1",
          userAgent: "browser-fingerprint",
        },
        {
          context: {
            internalAdapter: {
              findUserById: () =>
                Promise.resolve({
                  id: "01K00000000000000000000003",
                  email: "member@example.com",
                  emailVerified: true,
                  name: "Member",
                }),
            },
          },
        } as never,
      ),
    ).resolves.toMatchObject({
      data: {
        ipAddress: null,
        userAgent: null,
      },
    });
  });
});
