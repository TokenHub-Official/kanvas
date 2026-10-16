import { describe, expect, it } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { loadDevelopmentBootstrapConfig } from "../src/cli/dev-bootstrap-config.js";

function serverConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    environment: "development",
    auth: {
      emailAndPasswordEnabled: true,
    },
    ...overrides,
  } as ServerConfig;
}

describe("development bootstrap configuration", () => {
  it("loads bounded development defaults without providing a password default", () => {
    const loaded = loadDevelopmentBootstrapConfig(
      {
        KANVAS_DEV_ADMIN_PASSWORD: "local-password-123",
      },
      serverConfig(),
    );

    expect(loaded).toEqual({
      email: "admin@kanvas.local",
      password: "local-password-123",
      displayName: "Kanvas Admin",
      organizationSlug: "kanvas-local",
      organizationName: "Kanvas Local",
      workspaceSlug: "studio",
      workspaceName: "Kanvas Studio",
    });
  });

  it("refuses production even when credentials are supplied", () => {
    expect(() =>
      loadDevelopmentBootstrapConfig(
        {
          KANVAS_DEV_ADMIN_PASSWORD: "local-password-123",
        },
        serverConfig({
          environment: "production",
        }),
      ),
    ).toThrow(/disabled unless/u);
  });

  it("requires an explicit bounded local password", () => {
    expect(() => loadDevelopmentBootstrapConfig({}, serverConfig())).toThrow(
      /KANVAS_DEV_ADMIN_PASSWORD/u,
    );
    expect(() =>
      loadDevelopmentBootstrapConfig(
        {
          KANVAS_DEV_ADMIN_PASSWORD: "too-short",
        },
        serverConfig(),
      ),
    ).toThrow(/12 to 128/u);
  });

  it("normalizes email and rejects unsafe slugs", () => {
    const loaded = loadDevelopmentBootstrapConfig(
      {
        KANVAS_DEV_ADMIN_EMAIL: "Admin@KANVAS.LOCAL",
        KANVAS_DEV_ADMIN_PASSWORD: "local-password-123",
      },
      serverConfig(),
    );
    expect(loaded.email).toBe("admin@kanvas.local");

    expect(() =>
      loadDevelopmentBootstrapConfig(
        {
          KANVAS_DEV_ADMIN_PASSWORD: "local-password-123",
          KANVAS_DEV_WORKSPACE_SLUG: "Design Studio",
        },
        serverConfig(),
      ),
    ).toThrow(/lowercase letters/u);
  });
});
