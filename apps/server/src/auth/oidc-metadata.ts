import type { OAuthProviderConfig } from "./oauth-config.js";

const supportedIdTokenAlgorithms = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

export interface OidcMetadata {
  readonly authorizationEndpoint: URL;
  readonly idTokenAlgorithms: readonly string[];
  readonly jwksUri: URL;
  readonly tokenEndpoint: URL;
  readonly userInfoEndpoint: URL;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

function httpsEndpoint(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function parseMetadata(
  value: unknown,
  provider: OAuthProviderConfig,
): OidcMetadata | null {
  const metadata = object(value);
  if (!metadata || metadata.issuer !== provider.issuer) return null;

  const authorizationEndpoint = httpsEndpoint(metadata.authorization_endpoint);
  const tokenEndpoint = httpsEndpoint(metadata.token_endpoint);
  const userInfoEndpoint = httpsEndpoint(metadata.userinfo_endpoint);
  const jwksUri = httpsEndpoint(metadata.jwks_uri);
  const responseTypes = stringArray(metadata.response_types_supported);
  const subjectTypes = stringArray(metadata.subject_types_supported);
  const advertisedAlgorithms = stringArray(
    metadata.id_token_signing_alg_values_supported,
  );
  if (
    !authorizationEndpoint ||
    !tokenEndpoint ||
    !userInfoEndpoint ||
    !jwksUri ||
    !responseTypes?.includes("code") ||
    !subjectTypes?.some((type) => type === "public" || type === "pairwise") ||
    !advertisedAlgorithms
  ) {
    return null;
  }

  const idTokenAlgorithms = advertisedAlgorithms.filter((algorithm) =>
    supportedIdTokenAlgorithms.has(algorithm),
  );
  if (idTokenAlgorithms.length === 0) return null;

  const scopes =
    metadata.scopes_supported === undefined
      ? undefined
      : stringArray(metadata.scopes_supported);
  if (scopes === null || (scopes && !scopes.includes("openid"))) return null;

  const challengeMethods =
    metadata.code_challenge_methods_supported === undefined
      ? undefined
      : stringArray(metadata.code_challenge_methods_supported);
  if (
    challengeMethods === null ||
    (challengeMethods && !challengeMethods.includes("S256"))
  ) {
    return null;
  }

  const tokenAuthenticationMethods =
    metadata.token_endpoint_auth_methods_supported === undefined
      ? ["client_secret_basic"]
      : stringArray(metadata.token_endpoint_auth_methods_supported);
  const configuredTokenAuthentication =
    provider.tokenEndpointAuthMethod ?? "client_secret_basic";
  if (!tokenAuthenticationMethods?.includes(configuredTokenAuthentication)) {
    return null;
  }

  return {
    authorizationEndpoint,
    idTokenAlgorithms,
    jwksUri,
    tokenEndpoint,
    userInfoEndpoint,
  };
}

export async function loadOidcMetadata(
  provider: OAuthProviderConfig,
): Promise<OidcMetadata | null> {
  if (!provider.discoveryUrl || !provider.issuer) return null;
  try {
    const response = await fetch(provider.discoveryUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? parseMetadata(await response.json(), provider) : null;
  } catch {
    return null;
  }
}
