import { readFileSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const text = Type.String({ minLength: 1, maxLength: 2048, pattern: "\\S" });
const providerSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
    name: Type.String({ minLength: 1, maxLength: 64, pattern: "\\S" }),
    type: Type.Union([
      Type.Literal("github"),
      Type.Literal("google"),
      Type.Literal("microsoft"),
      Type.Literal("discord"),
      Type.Literal("oidc"),
    ]),
    clientId: text,
    clientSecretFile: Type.Optional(text),
    clientSecret: Type.Optional(text),
    discoveryUrl: Type.Optional(text),
    issuer: Type.Optional(text),
    tokenEndpointAuthMethod: Type.Optional(
      Type.Union([
        Type.Literal("client_secret_basic"),
        Type.Literal("client_secret_post"),
      ]),
    ),
  },
  { additionalProperties: false },
);
const configurationSchema = Type.Array(providerSchema, { maxItems: 20 });

export type OAuthProviderConfig = Omit<
  Static<typeof providerSchema>,
  "clientSecretFile"
> & {
  readonly clientSecret: string;
};

export function loadOAuthProviders(
  file: string | undefined,
  json?: string,
): readonly OAuthProviderConfig[] {
  if (file && json) throw new Error("Set only one OAuth configuration source.");
  if (!file?.trim() && !json) return [];
  const path = resolve(file || ".");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? readFileSync(path, "utf8"));
  } catch {
    throw new Error("Cannot read OAuth configuration as JSON.");
  }
  if (!Value.Check(configurationSchema, parsed)) {
    throw new Error("Invalid OAuth configuration fields.");
  }
  const ids = new Set<string>();
  return parsed.map((provider) => {
    if (
      ids.has(provider.id) ||
      (provider.type !== "oidc" && provider.id !== provider.type) ||
      (provider.type === "oidc" &&
        ["github", "google", "microsoft", "discord", "credential"].includes(
          provider.id,
        ))
    ) {
      throw new Error(
        "OAuth provider IDs must be unique; built-in IDs must match their type.",
      );
    }
    ids.add(provider.id);
    if (provider.type === "oidc") {
      for (const value of [provider.discoveryUrl, provider.issuer]) {
        let url: URL;
        try {
          url = new URL(value ?? "");
        } catch {
          throw new Error(
            "OIDC requires absolute HTTPS discoveryUrl and issuer URLs.",
          );
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.hash ||
          url.search
        ) {
          throw new Error(
            "OIDC requires HTTPS URLs without credentials, query or fragment.",
          );
        }
      }
    } else if (
      provider.discoveryUrl ||
      provider.issuer ||
      provider.tokenEndpointAuthMethod
    ) {
      throw new Error(
        "Only OIDC providers accept discovery, issuer and token authentication fields.",
      );
    }
    const {
      clientSecretFile,
      clientSecret: directSecret,
      ...configuration
    } = provider;
    if (Boolean(clientSecretFile) === Boolean(directSecret))
      throw new Error(
        "Each OAuth provider must have exactly one client secret source.",
      );
    let clientSecret: string;
    try {
      clientSecret =
        directSecret ??
        readFileSync(
          isAbsolute(clientSecretFile ?? "")
            ? (clientSecretFile ?? "")
            : resolve(dirname(path), clientSecretFile ?? ""),
          "utf8",
        ).trim();
    } catch {
      throw new Error("Cannot read an OAuth client secret file.");
    }
    if (!clientSecret)
      throw new Error("OAuth client secret files must not be empty.");
    return Object.freeze({
      ...configuration,
      ...(provider.type === "oidc"
        ? {
            tokenEndpointAuthMethod:
              provider.tokenEndpointAuthMethod ?? "client_secret_basic",
          }
        : {}),
      clientSecret,
    });
  });
}
