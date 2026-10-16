import type { OAuthProviderConfig } from "./oauth-config.js";
import { loadOidcMetadata } from "./oidc-metadata.js";

export async function verifyOidcDeploymentProviders(
  providers: readonly OAuthProviderConfig[] | undefined,
): Promise<void> {
  const oidcProviders = (providers ?? []).filter(
    (provider) => provider.type === "oidc",
  );
  const results = await Promise.all(oidcProviders.map(loadOidcMetadata));
  const failed = oidcProviders.find((_provider, index) => !results[index]);
  if (failed) {
    throw new Error(
      `OIDC discovery preflight failed for provider "${failed.id}".`,
    );
  }
}
