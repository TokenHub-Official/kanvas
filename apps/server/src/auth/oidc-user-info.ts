import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { OAuthProviderConfig } from "./oauth-config.js";
import { loadOidcMetadata } from "./oidc-metadata.js";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function oidcUserInfo(
  provider: OAuthProviderConfig,
): NonNullable<GenericOAuthConfig["getUserInfo"]> {
  let cachedJwksUri: string | undefined;
  let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  return async (tokens) => {
    if (
      !tokens.accessToken ||
      !tokens.idToken ||
      !provider.discoveryUrl ||
      !provider.issuer
    ) {
      return null;
    }

    try {
      const metadata = await loadOidcMetadata(provider);
      if (!metadata) return null;

      if (!cachedJwks || cachedJwksUri !== metadata.jwksUri.href) {
        cachedJwksUri = metadata.jwksUri.href;
        cachedJwks = createRemoteJWKSet(metadata.jwksUri, {
          cacheMaxAge: 600_000,
          cooldownDuration: 30_000,
          timeoutDuration: 10_000,
        });
      }
      const { payload } = await jwtVerify(tokens.idToken, cachedJwks, {
        algorithms: [...metadata.idTokenAlgorithms],
        audience: provider.clientId,
        issuer: provider.issuer,
        requiredClaims: ["sub", "exp", "iat"],
      });
      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== provider.clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== provider.clientId)
      ) {
        return null;
      }

      const response = await fetch(metadata.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const profile = object(await response.json());
      if (
        !profile ||
        profile.sub !== payload.sub ||
        typeof profile.email !== "string" ||
        !profile.email.trim() ||
        profile.email_verified !== true
      ) {
        return null;
      }
      return {
        id: payload.sub,
        email: profile.email,
        emailVerified: true,
        name:
          typeof profile.name === "string" && profile.name.trim()
            ? profile.name
            : profile.email,
      };
    } catch {
      return null;
    }
  };
}
