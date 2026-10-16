import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadOAuthProviders } from "../src/auth/oauth-config.js";

const directories: string[] = [];
function configuration(providers: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "kanvas-oauth-"));
  directories.push(directory);
  writeFileSync(join(directory, "secret"), "test-client-secret\n");
  const path = join(directory, "oauth.json");
  writeFileSync(path, JSON.stringify(providers));
  return path;
}
const github = {
  id: "github",
  name: "GitHub",
  type: "github",
  clientId: "client-id",
  clientSecretFile: "secret",
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("OAuth deployment configuration", () => {
  it("keeps OAuth disabled when not configured", () => {
    expect(loadOAuthProviders(undefined)).toEqual([]);
  });
  it("resolves secret files relative to the configuration file", () => {
    expect(loadOAuthProviders(configuration([github]))).toEqual([
      {
        id: "github",
        name: "GitHub",
        type: "github",
        clientId: "client-id",
        clientSecret: "test-client-secret",
      },
    ]);
  });
  it.each([
    [github, github],
    [{ ...github, id: "custom-github" }],
    [{ ...github, clientSecret: "secret-must-not-appear-in-errors" }],
    [{ ...github, clientSecretFile: "missing" }],
    [
      {
        ...github,
        type: "oidc",
        id: "company",
        discoveryUrl: "http://example.com/discovery",
        issuer: "https://example.com",
      },
    ],
    [
      {
        ...github,
        type: "oidc",
        id: "company",
        discoveryUrl: "https://example.com/discovery",
      },
    ],
  ])("rejects malformed or ambiguous configurations", (...providers) => {
    expect(() => loadOAuthProviders(configuration(providers))).toThrow();
  });
  it("does not echo credentials in validation errors", () => {
    try {
      loadOAuthProviders(
        configuration([{ ...github, clientSecret: "private-value" }]),
      );
    } catch (error) {
      expect(String(error)).not.toContain("private-value");
      return;
    }
    throw new Error("Expected validation failure");
  });
  it("accepts a custom OIDC provider", () => {
    expect(
      loadOAuthProviders(
        configuration([
          {
            ...github,
            type: "oidc",
            id: "company",
            discoveryUrl: "https://example.com/discovery",
            issuer: "https://example.com",
          },
        ]),
      )[0],
    ).toMatchObject({
      type: "oidc",
      tokenEndpointAuthMethod: "client_secret_basic",
    });
  });
  it("accepts the standard client secret POST method when declared", () => {
    expect(
      loadOAuthProviders(
        configuration([
          {
            ...github,
            type: "oidc",
            id: "company",
            discoveryUrl: "https://example.com/discovery",
            issuer: "https://example.com",
            tokenEndpointAuthMethod: "client_secret_post",
          },
        ]),
      )[0],
    ).toMatchObject({
      type: "oidc",
      tokenEndpointAuthMethod: "client_secret_post",
    });
  });
  it.each([
    { ...github, tokenEndpointAuthMethod: "client_secret_basic" },
    {
      ...github,
      type: "oidc",
      id: "company",
      discoveryUrl: "https://example.com/discovery",
      issuer: "https://example.com",
      tokenEndpointAuthMethod: "private_key_jwt",
    },
  ])(
    "rejects token authentication outside the supported OIDC profile",
    (entry) => {
      expect(() => loadOAuthProviders(configuration([entry]))).toThrow();
    },
  );
});

describe("environment OAuth configuration", () => {
  it("accepts direct JSON and rejects source conflicts", () => {
    const json = JSON.stringify([
      {
        id: "matrix",
        name: "SSO",
        type: "oidc",
        clientId: "test",
        clientSecret: "test-secret",
        issuer: "https://sso.example",
        discoveryUrl: "https://sso.example/.well-known/openid-configuration",
      },
    ]);
    expect(loadOAuthProviders(undefined, json)[0]?.clientSecret).toBe(
      "test-secret",
    );
    expect(() => loadOAuthProviders("/unused", json)).toThrow(/only one/u);
  });
});
