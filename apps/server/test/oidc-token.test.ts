import { afterEach, describe, expect, it, vi } from "vitest";

import { oidcToken } from "../src/auth/oidc-token.js";

const provider = {
  id: "company",
  name: "Company",
  type: "oidc" as const,
  clientId: "client:id",
  clientSecret: "s ecret",
  discoveryUrl: "https://identity.example.com/.well-known/openid-configuration",
  issuer: "https://identity.example.com",
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};

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

describe("OIDC authorization code exchange", () => {
  it("requires the PKCE verifier before discovery or token exchange", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      oidcToken(provider)({
        code: "code",
        redirectURI:
          "https://kanvas.example.com/api/auth/oauth2/callback/company",
      }),
    ).rejects.toThrow("OIDC PKCE verifier is missing.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses RFC client_secret_basic encoding and PKCE at the validated endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(metadata()))
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          expires_in: 3600,
          id_token: "id-token",
          token_type: "Bearer",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      oidcToken(provider)({
        code: "code",
        codeVerifier: "verifier",
        redirectURI:
          "https://kanvas.example.com/api/auth/oauth2/callback/company",
      }),
    ).resolves.toMatchObject({
      accessToken: "access",
      idToken: "id-token",
      tokenType: "Bearer",
    });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    const body = request.body as URLSearchParams;
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("client%3Aid:s+ecret").toString("base64")}`,
    );
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.has("client_secret")).toBe(false);
  });

  it.each([
    metadata({ issuer: "https://wrong.example.com" }),
    metadata({ token_endpoint: "http://identity.example.com/token" }),
    metadata({ token_endpoint_auth_methods_supported: ["client_secret_post"] }),
  ])(
    "does not transmit credentials after invalid discovery",
    async (discovery) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(discovery));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        oidcToken(provider)({
          code: "code",
          codeVerifier: "verifier",
          redirectURI:
            "https://kanvas.example.com/api/auth/oauth2/callback/company",
        }),
      ).rejects.toThrow("OIDC discovery metadata is invalid.");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, "mac"])(
    "rejects unsupported token_type %s",
    async (tokenType) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json(metadata()))
        .mockResolvedValueOnce(
          Response.json({
            access_token: "access",
            id_token: "id-token",
            token_type: tokenType,
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        oidcToken(provider)({
          code: "code",
          codeVerifier: "verifier",
          redirectURI:
            "https://kanvas.example.com/api/auth/oauth2/callback/company",
        }),
      ).rejects.toThrow("OIDC token response is incomplete.");
    },
  );
});
