import { normalizeVerifiedEmail } from "@kanvas/database/runtime";

import type { ServerConfig } from "../config.js";

export interface DevelopmentBootstrapConfig {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
}

function optionalText(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  maximumLength: number,
): string {
  const value = environment[name]?.trim() || fallback;
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw new Error(
      `${name} must contain between 1 and ${String(maximumLength)} characters without control characters.`,
    );
  }
  return value;
}

function slug(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = optionalText(environment, name, fallback, 80);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(value)) {
    throw new Error(
      `${name} must contain only lowercase letters, digits and internal hyphens.`,
    );
  }
  return value;
}

function password(environment: NodeJS.ProcessEnv): string {
  const value = environment.KANVAS_DEV_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      "Missing KANVAS_DEV_ADMIN_PASSWORD. Store a local-only password in apps/server/.env.local.",
    );
  }
  if (
    value !== value.trim() ||
    value.length < 12 ||
    value.length > 128 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw new Error(
      "KANVAS_DEV_ADMIN_PASSWORD must contain 12 to 128 characters without surrounding whitespace or control characters.",
    );
  }
  return value;
}

export function loadDevelopmentBootstrapConfig(
  environment: NodeJS.ProcessEnv,
  server: ServerConfig,
): DevelopmentBootstrapConfig {
  if (server.environment !== "development") {
    throw new Error(
      "Development bootstrap is disabled unless KANVAS_ENVIRONMENT=development.",
    );
  }
  if (!server.auth.emailAndPasswordEnabled) {
    throw new Error(
      "Development bootstrap requires KANVAS_AUTH_EMAIL_PASSWORD_ENABLED=true.",
    );
  }

  return Object.freeze({
    email: normalizeVerifiedEmail(
      environment.KANVAS_DEV_ADMIN_EMAIL?.trim() || "admin@kanvas.local",
    ),
    password: password(environment),
    displayName: optionalText(
      environment,
      "KANVAS_DEV_ADMIN_NAME",
      "Kanvas Admin",
      255,
    ),
    organizationSlug: slug(
      environment,
      "KANVAS_DEV_ORGANIZATION_SLUG",
      "kanvas-local",
    ),
    organizationName: optionalText(
      environment,
      "KANVAS_DEV_ORGANIZATION_NAME",
      "Kanvas Local",
      160,
    ),
    workspaceSlug: slug(environment, "KANVAS_DEV_WORKSPACE_SLUG", "studio"),
    workspaceName: optionalText(
      environment,
      "KANVAS_DEV_WORKSPACE_NAME",
      "Kanvas Studio",
      160,
    ),
  });
}
