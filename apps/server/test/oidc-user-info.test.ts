import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { oidcUserInfo } from "../src/auth/oidc-user-info.js";

const provider = {
  id: "company",
  name: "Company",
  type: "oidc" as const,
  clientId: "client",
  clientSecret: "secret",
  discoveryUrl: "https://identity.example.com/.well-known/openid-configuration",
  issuer: "https://identity.example.com",
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};

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

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: provider.issuer,
    authorization_endpoint: `${provider.issuer}/auth`,
    token_endpoint: `${provider.issuer}/token`,
    userinfo_endpoint: `${provider.issuer}/userinfo`,
    jwks_uri: `${provider.issuer}/keys`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    ...overrides,
  };
}

function requestUrl(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

async function idToken(
  overrides: {
    readonly audience?: string;
    readonly expiresAt?: number;
    readonly issuer?: string;
    readonly key?: SigningKey;
    readonly subject?: string;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: overrides.subject ?? "stable-subject" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? provider.issuer)
    .setAudience(overrides.audience ?? provider.clientId)
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 300)
    .sign(overrides.key ?? signingKey);
}

function stubOidc(
  discovery: Record<string, unknown>,
  profile: Record<string, unknown> = {
    sub: "stable-subject",
    email: "member@example.com",
    email_verified: true,
    name: "Member",
  },
) {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = requestUrl(input);
      if (url === provider.discoveryUrl)
        return Promise.resolve(Response.json(discovery));
      if (url === `${provider.issuer}/keys`)
        return Promise.resolve(Response.json({ keys: [publicJwk] }));
      if (url === `${provider.issuer}/userinfo`)
        return Promise.resolve(Response.json(profile));
      return Promise.resolve(new Response(null, { status: 404 }));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OIDC identity trust", () => {
  it("verifies the ID Token and binds UserInfo to the same stable subject", async () => {
    const fetchMock = stubOidc(metadata());
    const profile = await oidcUserInfo(provider)({
      accessToken: "access",
      idToken: await idToken(),
    });

    expect(profile).toMatchObject({
      id: "stable-subject",
      emailVerified: true,
    });
    const userInfoRequest = fetchMock.mock.calls.find(
      ([input]) => requestUrl(input) === `${provider.issuer}/userinfo`,
    );
    expect(userInfoRequest?.[1]).toMatchObject({
      headers: { Authorization: "Bearer access" },
      redirect: "error",
    });
  });

  it.each([
    ["wrong issuer", { issuer: "https://wrong.example.com" }],
    ["wrong audience", { audience: "another-client" }],
    ["expired token", { expiresAt: 1 }],
  ])("rejects an ID Token with %s", async (_label, overrides) => {
    stubOidc(metadata());
    await expect(
      oidcUserInfo(provider)({
        accessToken: "access",
        idToken: await idToken(overrides),
      }),
    ).resolves.toBeNull();
  });

  it("rejects an ID Token whose signature is not in the provider JWKS", async () => {
    const attacker = await generateKeyPair("RS256");
    stubOidc(metadata());
    await expect(
      oidcUserInfo(provider)({
        accessToken: "access",
        idToken: await idToken({ key: attacker.privateKey }),
      }),
    ).resolves.toBeNull();
  });

  it("uses the standard client_secret_basic default when metadata omits it", async () => {
    stubOidc(metadata({ token_endpoint_auth_methods_supported: undefined }));
    await expect(
      oidcUserInfo(provider)({
        accessToken: "access",
        idToken: await idToken(),
      }),
    ).resolves.toMatchObject({ id: "stable-subject" });
  });

  it("rejects UserInfo for a different subject", async () => {
    stubOidc(metadata(), {
      sub: "substitution-target",
      email: "member@example.com",
      email_verified: true,
    });
    await expect(
      oidcUserInfo(provider)({
        accessToken: "access",
        idToken: await idToken(),
      }),
    ).resolves.toBeNull();
  });

  it.each([false, "true", undefined])(
    "rejects emails without boolean verification: %s",
    async (verified) => {
      stubOidc(metadata(), {
        sub: "stable-subject",
        email: "member@example.com",
        email_verified: verified,
      });
      await expect(
        oidcUserInfo(provider)({
          accessToken: "access",
          idToken: await idToken(),
        }),
      ).resolves.toBeNull();
    },
  );

  it.each([
    metadata({ issuer: "https://wrong.example.com" }),
    metadata({ userinfo_endpoint: "http://identity.example.com/userinfo" }),
    metadata({ jwks_uri: "http://identity.example.com/keys" }),
    metadata({ response_types_supported: ["token"] }),
    metadata({ token_endpoint_auth_methods_supported: ["client_secret_post"] }),
  ])("does not send tokens after invalid discovery", async (discovery) => {
    const fetchMock = stubOidc(discovery);
    await expect(
      oidcUserInfo(provider)({
        accessToken: "access",
        idToken: await idToken(),
      }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
