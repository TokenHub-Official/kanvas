import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyOidcDeploymentProviders } from "../src/auth/oidc-deployment-check.js";

const oidc = {
  id: "matrix",
  name: "Internal SSO",
  type: "oidc" as const,
  clientId: "client",
  clientSecret: "secret",
  discoveryUrl: "https://auth.example.com/.well-known/openid-configuration",
  issuer: "https://auth.example.com",
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};

afterEach(() => vi.unstubAllGlobals());

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: oidc.issuer,
    authorization_endpoint: `${oidc.issuer}/auth`,
    token_endpoint: `${oidc.issuer}/token`,
    userinfo_endpoint: `${oidc.issuer}/userinfo`,
    jwks_uri: `${oidc.issuer}/keys`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    ...overrides,
  };
}

describe("OIDC deployment preflight", () => {
  it("does not use the network when OIDC is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyOidcDeploymentProviders(undefined),
    ).resolves.toBeUndefined();
    await expect(
      verifyOidcDeploymentProviders([
        {
          id: "github",
          name: "GitHub",
          type: "github",
          clientId: "client",
          clientSecret: "secret",
        },
      ]),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts compatible provider metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(metadata())),
    );
    await expect(
      verifyOidcDeploymentProviders([oidc]),
    ).resolves.toBeUndefined();
  });

  it("identifies an incompatible provider without exposing credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          metadata({
            token_endpoint_auth_methods_supported: ["client_secret_post"],
          }),
        ),
      ),
    );

    await expect(verifyOidcDeploymentProviders([oidc])).rejects.toThrow(
      'OIDC discovery preflight failed for provider "matrix".',
    );
  });
});
