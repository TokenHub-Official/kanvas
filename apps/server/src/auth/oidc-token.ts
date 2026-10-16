import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

import type { OAuthProviderConfig } from "./oauth-config.js";
import { loadOidcMetadata } from "./oidc-metadata.js";

function formEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function basicCredentials(clientId: string, clientSecret: string): string {
  const credentials = `${formEncode(clientId)}:${formEncode(clientSecret)}`;
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function oidcToken(
  provider: OAuthProviderConfig,
): NonNullable<GenericOAuthConfig["getToken"]> {
  return async ({ code, codeVerifier, redirectURI }) => {
    if (!codeVerifier) throw new Error("OIDC PKCE verifier is missing.");
    const metadata = await loadOidcMetadata(provider);
    if (!metadata) throw new Error("OIDC discovery metadata is invalid.");

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectURI,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    if (
      (provider.tokenEndpointAuthMethod ?? "client_secret_basic") ===
      "client_secret_basic"
    ) {
      headers.set(
        "Authorization",
        basicCredentials(provider.clientId, provider.clientSecret),
      );
    } else {
      body.set("client_id", provider.clientId);
      body.set("client_secret", provider.clientSecret);
    }

    const response = await fetch(metadata.tokenEndpoint, {
      body,
      headers,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("OIDC token exchange failed.");
    const token = object(await response.json());
    if (
      !token ||
      typeof token.access_token !== "string" ||
      !token.access_token ||
      typeof token.id_token !== "string" ||
      !token.id_token ||
      typeof token.token_type !== "string" ||
      token.token_type.toLowerCase() !== "bearer"
    ) {
      throw new Error("OIDC token response is incomplete.");
    }

    const expiresIn =
      typeof token.expires_in === "number" &&
      Number.isFinite(token.expires_in) &&
      token.expires_in > 0
        ? token.expires_in
        : undefined;
    const scopes =
      typeof token.scope === "string"
        ? token.scope.split(" ").filter(Boolean)
        : undefined;
    return {
      accessToken: token.access_token,
      ...(expiresIn
        ? { accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1_000) }
        : {}),
      idToken: token.id_token,
      ...(typeof token.refresh_token === "string" && token.refresh_token
        ? { refreshToken: token.refresh_token }
        : {}),
      ...(scopes ? { scopes } : {}),
      tokenType: token.token_type,
    };
  };
}
