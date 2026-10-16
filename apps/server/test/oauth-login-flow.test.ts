import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createAuthenticationEngine,
  type AuthenticationDatabaseRuntime,
} from "../src/auth/authentication-engine.js";
import { issueInvitationAdmissionCookie } from "../src/auth/invitation-admission.js";
import { loadServerConfig } from "../src/config.js";

const origin = "http://127.0.0.1:3000";
const issuer = "https://identity.example.com";
const oidcProvider = {
  id: "company",
  name: "Company",
  type: "oidc" as const,
  clientId: "test-client",
  clientSecret: "test-secret",
  discoveryUrl: `${issuer}/.well-known/openid-configuration`,
  issuer,
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};
const config = loadServerConfig(
  {
    KANVAS_INSTANCE_ID: "oauth-flow-test",
    KANVAS_DATABASE_HOST: "127.0.0.1",
    KANVAS_DATABASE_NAME: "kanvas",
    KANVAS_DATABASE_USER: "kanvas",
    KANVAS_DATABASE_PASSWORD: "test-only",
    KANVAS_AUTH_SECRET: "test-only-auth-secret-that-is-at-least-32-characters",
  },
  [],
);

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signingKey: SigningKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    alg: "RS256",
    kid: "test-key",
    use: "sig",
  };
});

afterEach(() => vi.unstubAllGlobals());

function requestUrl(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

function providerMetadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/keys`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
  };
}

function stubProvider(email: string) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === oidcProvider.discoveryUrl)
        return Response.json(providerMetadata());
      if (url === `${issuer}/token`) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toMatch(/^Basic /u);
        const now = Math.floor(Date.now() / 1_000);
        const idToken = await new SignJWT({ sub: "external-subject" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(issuer)
          .setAudience(oidcProvider.clientId)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(signingKey);
        return Response.json({
          access_token: "test-access",
          expires_in: 300,
          id_token: idToken,
          token_type: "Bearer",
        });
      }
      if (url === `${issuer}/keys`) return Response.json({ keys: [publicJwk] });
      if (url === `${issuer}/userinfo`)
        return Response.json({
          sub: "external-subject",
          email,
          email_verified: true,
          name: "Member",
        });
      return new Response(null, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function fixture(
  email = "member@example.com",
  registrationAllowed = false,
  invitation?: {
    readonly state: "accepted" | "expired" | "pending" | "revoked";
    readonly targetEmail: string;
    readonly tokenHash: string;
  },
) {
  stubProvider(email);
  const registrationPolicyCheck = vi.fn(() =>
    Promise.resolve(registrationAllowed),
  );
  const resolveInvitation = vi.fn((tokenHash: string) =>
    Promise.resolve(
      invitation && tokenHash === invitation.tokenHash
        ? {
            invitationId: "01K00000000000000000000011",
            organizationId: "01K00000000000000000000012",
            organizationName: "Kanvas",
            workspaceId: "01K00000000000000000000013",
            workspaceName: "Studio",
            workspaceRole: "editor" as const,
            targetEmail: invitation.targetEmail,
            targetEmailMasked: "in*****@example.com",
            state: invitation.state,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
  );
  const template = createAuthenticationEngine({
    config: {
      ...config,
      auth: {
        ...config.auth,
        oauthProviders: [
          oidcProvider,
          {
            id: "github",
            type: "github",
            name: "GitHub",
            clientId: "test-github",
            clientSecret: "test-secret",
          },
        ],
      },
    },
    database: {
      defaultAccess: {
        recordRegistration: vi.fn().mockResolvedValue(undefined),
        process: vi
          .fn()
          .mockResolvedValue({ state: "excluded", reason: "not_eligible" }),
      },
      authorization: {
        resolveHumanPrincipal: () =>
          Promise.resolve({
            principalId: "01K00000000000000000000020",
            status: "active" as const,
            version: 1,
            created: false,
          }),
      },
      db: {},
      instanceAccess: {
        registrationAllowed: registrationPolicyCheck,
      },
      team: { resolveInvitation },
    } as unknown as AuthenticationDatabaseRuntime,
  });
  const auth = betterAuth({
    ...template.options,
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
    }),
    logger: { disabled: true },
    rateLimit: { enabled: false },
  });
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    email: "member@example.com",
    name: "Member",
    emailVerified: true,
  });
  // Obtain a signed browser session through the normal password endpoint.
  await context.internalAdapter.createAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash("test-only-password"),
  });
  const request = (path: string, body: unknown, cookie = "") =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      }),
    );
  const signedIn = await request("/sign-in/email", {
    email: user.email,
    password: "test-only-password",
  });
  expect(signedIn.status).toBe(200);
  return {
    auth,
    context,
    user,
    request,
    registrationPolicyCheck,
    resolveInvitation,
    sessionCookie: cookies(signedIn),
  };
}

describe("OAuth callback and explicit linking journey", () => {
  it("also rejects public signup through the generic provider's core callback", async () => {
    const { auth, request, context } = await fixture("new@example.com");
    const started = await request("/sign-in/social", {
      provider: "company",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    expect(started.status).toBe(200);
    const url = new URL(((await started.json()) as { url: string }).url);
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(started) } },
      ),
    );
    expect(response.headers.get("location")).toContain("error=");
    expect(
      await context.internalAdapter.findUserByEmail("new@example.com"),
    ).toBeNull();
  });

  it("creates an account through OIDC when account-only registration is open", async () => {
    const { auth, request, context, registrationPolicyCheck } = await fixture(
      "new@example.com",
      true,
    );
    const started = await request("/sign-in/oauth2", {
      providerId: "company",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    const url = new URL(((await started.json()) as { url: string }).url);
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(started) } },
      ),
    );

    expect(registrationPolicyCheck.mock.calls).toEqual([
      [{ kind: "oidc", providerId: "company" }],
    ]);
    expect(response.headers.get("location")).toBe("/");
    expect(
      await context.internalAdapter.findAccountByProviderId(
        "external-subject",
        "company",
      ),
    ).toBeTruthy();
    await expect(
      auth.api.getSession({
        headers: new Headers({ Cookie: cookies(response) }),
      }),
    ).resolves.toMatchObject({
      user: { email: "new@example.com" },
    });

    const nextStarted = await request("/sign-in/oauth2", {
      providerId: "company",
      callbackURL: "/account",
      errorCallbackURL: "/login",
    });
    const nextUrl = new URL(
      ((await nextStarted.json()) as { url: string }).url,
    );
    const nextResponse = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${nextUrl.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(nextStarted) } },
      ),
    );
    expect(nextResponse.headers.get("location")).toBe("/account");
    await expect(
      auth.api.getSession({
        headers: new Headers({ Cookie: cookies(nextResponse) }),
      }),
    ).resolves.toMatchObject({
      user: { email: "new@example.com" },
    });
  });

  it("admits a new verified OIDC identity through a pending email invitation", async () => {
    const tokenHash = `sha256:${"a".repeat(64)}`;
    const invitedEmail = "invited@example.com";
    const {
      auth,
      request,
      context,
      registrationPolicyCheck,
      resolveInvitation,
    } = await fixture(invitedEmail, false, {
      state: "pending",
      targetEmail: invitedEmail,
      tokenHash,
    });
    const admission = issueInvitationAdmissionCookie({
      config: config.auth,
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitationTokenHash: tokenHash,
      now: new Date(),
    }).split(";", 1)[0];
    const started = await request(
      "/sign-in/oauth2",
      {
        providerId: "company",
        callbackURL: "/invite/test-invitation",
        errorCallbackURL: "/login",
      },
      admission,
    );
    const authorization = new URL(
      ((await started.json()) as { readonly url: string }).url,
    );
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${authorization.searchParams.get("state") ?? ""}`,
        {
          headers: {
            Cookie: `${admission}; ${cookies(started)}`,
          },
        },
      ),
    );

    expect(registrationPolicyCheck).toHaveBeenCalledWith({
      kind: "oidc",
      providerId: "company",
    });
    expect(resolveInvitation).toHaveBeenCalledWith(tokenHash, expect.any(Date));
    expect(response.headers.get("location")).toBe("/invite/test-invitation");
    expect(
      response.headers
        .getSetCookie()
        .some(
          (cookie) =>
            cookie.includes("kanvas.invitation_admission=") &&
            cookie.includes("Max-Age=0"),
        ),
    ).toBe(true);
    await expect(
      context.internalAdapter.findUserByEmail(invitedEmail),
    ).resolves.toBeTruthy();
  });

  it.each([
    ["mismatched email", "pending", "other@example.com"],
    ["revoked invitation", "revoked", "invited@example.com"],
    ["expired invitation", "expired", "invited@example.com"],
  ] as const)(
    "rejects invited OIDC registration for %s and clears the admission",
    async (_case, state, targetEmail) => {
      const tokenHash = `sha256:${"b".repeat(64)}`;
      const { auth, request, context } = await fixture(
        "invited@example.com",
        false,
        { state, targetEmail, tokenHash },
      );
      const admission = issueInvitationAdmissionCookie({
        config: config.auth,
        invitationExpiresAt: new Date(Date.now() + 60_000),
        invitationTokenHash: tokenHash,
        now: new Date(),
      }).split(";", 1)[0];
      const started = await request(
        "/sign-in/oauth2",
        {
          providerId: "company",
          callbackURL: "/invite/test-invitation",
          errorCallbackURL: "/login",
        },
        admission,
      );
      const authorization = new URL(
        ((await started.json()) as { readonly url: string }).url,
      );
      const response = await auth.handler(
        new Request(
          `${origin}/api/auth/oauth2/callback/company?code=test&state=${authorization.searchParams.get("state") ?? ""}`,
          { headers: { Cookie: `${admission}; ${cookies(started)}` } },
        ),
      );

      expect(response.headers.get("location")).toContain("error=");
      expect(
        response.headers
          .getSetCookie()
          .some(
            (cookie) =>
              cookie.includes("kanvas.invitation_admission=") &&
              cookie.includes("Max-Age=0"),
          ),
      ).toBe(true);
      await expect(
        context.internalAdapter.findUserByEmail("invited@example.com"),
      ).resolves.toBeNull();
    },
  );

  it.each([true, false])(
    "signs in an existing verified account through internal OIDC with registrationAllowed=%s",
    async (registrationAllowed) => {
      const { auth, request, context, user } = await fixture(
        "member@example.com",
        registrationAllowed,
      );
      const started = await request("/sign-in/oauth2", {
        providerId: "company",
        callbackURL: "/",
        errorCallbackURL: "/login",
      });
      const url = new URL(((await started.json()) as { url: string }).url);
      const response = await auth.handler(
        new Request(
          `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
          { headers: { Cookie: cookies(started) } },
        ),
      );

      expect(response.headers.get("location")).toBe("/");
      expect(
        await context.internalAdapter.findAccountByProviderId(
          "external-subject",
          "company",
        ),
      ).toMatchObject({ userId: user.id });
      await expect(
        auth.api.getSession({
          headers: new Headers({ Cookie: cookies(response) }),
        }),
      ).resolves.toMatchObject({ user: { id: user.id } });
      expect(
        (await auth.$context).options.account?.accountLinking
          ?.disableImplicitLinking,
      ).toBe(true);
    },
  );

  it("keeps social implicit linking blocked after an internal OIDC callback", async () => {
    const { auth, request, context } = await fixture();
    const started = await request("/sign-in/oauth2", {
      providerId: "company",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    const url = new URL(((await started.json()) as { url: string }).url);
    const completed = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(started) } },
      ),
    );
    expect(completed.headers.get("location")).toBe("/");
    const github = context.socialProviders.find(
      (provider) => provider.id === "github",
    );
    if (!github) throw new Error("GitHub fixture missing");
    vi.spyOn(github, "validateAuthorizationCode").mockResolvedValue({
      accessToken: "test-social-token",
    });
    vi.spyOn(github, "getUserInfo").mockResolvedValue({
      user: {
        id: "social-subject",
        email: "member@example.com",
        emailVerified: true,
        name: "Member",
      },
      data: {},
    });
    const social = await request("/sign-in/social", {
      provider: "github",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    const socialUrl = new URL(((await social.json()) as { url: string }).url);
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/callback/github?code=test&state=${socialUrl.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(social) } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "/login?error=account_not_linked",
    );
    expect(
      await context.internalAdapter.findAccountByProviderId(
        "social-subject",
        "github",
      ),
    ).toBeNull();
  });
  it("rejects implicit OIDC linking to an unverified local account", async () => {
    const { auth, request, context, user } = await fixture();
    await context.internalAdapter.updateUser(user.id, { emailVerified: false });
    const started = await request("/sign-in/oauth2", {
      providerId: "company",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    const url = new URL(((await started.json()) as { url: string }).url);
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(started) } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "/login?error=account_not_linked",
    );
    expect(
      await context.internalAdapter.findAccountByProviderId(
        "external-subject",
        "company",
      ),
    ).toBeNull();
  });

  it("does not link an account with a different email", async () => {
    const { auth, request, sessionCookie, context } =
      await fixture("other@example.com");
    const started = await request(
      "/oauth2/link",
      {
        providerId: "company",
        callbackURL: "/account",
        errorCallbackURL: "/account",
      },
      sessionCookie,
    );
    const url = new URL(((await started.json()) as { url: string }).url);
    const response = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: `${sessionCookie}; ${cookies(started)}` } },
      ),
    );
    expect(
      new URL(response.headers.get("location") ?? "", origin).searchParams.get(
        "error",
      ),
    ).toBe("email_doesn't_match");
    expect(
      await context.internalAdapter.findAccountByProviderId(
        "external-subject",
        "company",
      ),
    ).toBeNull();
  });
  it("links in an existing session, then signs in and returns to the requested route", async () => {
    const { auth, request, sessionCookie, context, user } = await fixture();
    const linked = await request(
      "/oauth2/link",
      {
        providerId: "company",
        callbackURL: "/account",
        errorCallbackURL: "/account",
      },
      sessionCookie,
    );
    expect(linked.status).toBe(200);
    const authorization = new URL(
      ((await linked.json()) as { url: string }).url,
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const callback = `${origin}/api/auth/oauth2/callback/company?code=test&state=${authorization.searchParams.get("state") ?? ""}`;
    const completed = await auth.handler(
      new Request(callback, {
        headers: { Cookie: `${sessionCookie}; ${cookies(linked)}` },
      }),
    );
    expect(completed.headers.get("location")).toBe("/account");
    expect(
      await context.internalAdapter.findAccountByProviderId(
        "external-subject",
        "company",
      ),
    ).toMatchObject({ userId: user.id });

    const started = await request("/sign-in/oauth2", {
      providerId: "company",
      callbackURL: "/invite/test-invitation",
      errorCallbackURL: "/login",
    });
    const loginAuthorization = new URL(
      ((await started.json()) as { url: string }).url,
    );
    const signedIn = await auth.handler(
      new Request(
        `${origin}/api/auth/oauth2/callback/company?code=test&state=${loginAuthorization.searchParams.get("state") ?? ""}`,
        { headers: { Cookie: cookies(started) } },
      ),
    );
    expect(signedIn.headers.get("location")).toBe("/invite/test-invitation");
    const resolved = await auth.api.getSession({
      headers: new Headers({ Cookie: cookies(signedIn) }),
    });
    expect(resolved?.user.id).toBe(user.id);
    const replayed = await auth.handler(
      new Request(callback, {
        headers: { Cookie: `${sessionCookie}; ${cookies(linked)}` },
      }),
    );
    expect(replayed.headers.get("location")).toContain("error=");
  });

  it.each(["new@example.com"])(
    "does not register %s when registration is closed",
    async (email) => {
      const { auth, request, context } = await fixture(email);
      const started = await request("/sign-in/oauth2", {
        providerId: "company",
        callbackURL: "/",
        errorCallbackURL: "/login",
        requestSignUp: true,
      });
      const url = new URL(((await started.json()) as { url: string }).url);
      const response = await auth.handler(
        new Request(
          `${origin}/api/auth/oauth2/callback/company?code=test&state=${url.searchParams.get("state") ?? ""}`,
          { headers: { Cookie: cookies(started) } },
        ),
      );
      expect(response.headers.get("location")).toContain("/login?error=");
      expect(
        await context.internalAdapter.findAccountByProviderId(
          "external-subject",
          "company",
        ),
      ).toBeNull();
      expect(
        await auth.api.getSession({
          headers: new Headers({ Cookie: cookies(response) }),
        }),
      ).toBeNull();
    },
  );

  it("rejects linking without a session and external return URLs", async () => {
    const { request } = await fixture();
    expect(
      (
        await request("/oauth2/link", {
          providerId: "company",
          callbackURL: "/account",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/sign-in/oauth2", {
          providerId: "company",
          callbackURL: "https://attacker.example/",
        })
      ).status,
    ).toBe(403);
  });
});
