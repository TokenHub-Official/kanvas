import { parseTrustedProxyCidrs } from "./trusted-proxy.js";
import { readFileSync } from "node:fs";
import type { ResultDownloadRule } from "@kanvas/contracts/api";
import { isAbsolute } from "node:path";
import {
  loadOAuthProviders,
  type OAuthProviderConfig,
} from "./auth/oauth-config.js";

import {
  loadAgentDevelopmentSkillFiles,
  loadDatabaseConnectionConfig,
  type DatabaseConnectionConfig,
} from "@kanvas/database";
import {
  parseProviderDeploymentHardBounds,
  type ExecutionTarget,
  type ProviderDeploymentHardBounds,
} from "@kanvas/database/runtime";
import {
  loadArtifactPreviewConfig,
  loadTrustedImageStorageConfig,
  type ArtifactPreviewConfig,
  type TrustedImageStorageConfig,
} from "@kanvas/storage";
import {
  loadProviderSecretFileMaps,
  type ProviderSecretFileMaps,
} from "@kanvas/secrets";

export type ServerStorageConfig = TrustedImageStorageConfig &
  Readonly<{
    userImportSessionTtlMilliseconds: number;
    modelResourceImportSessionTtlMilliseconds: number;
  }>;

export type EmailVerificationDeliveryConfig =
  | Readonly<{
      kind: "smtp";
      host: string;
      port: number;
      secure: boolean;
      requireTls: boolean;
      fromAddress: string;
      fromName: string;
      authentication?: Readonly<{
        user: string;
        password: string;
      }>;
    }>
  | Readonly<{
      kind: "development_outbox";
      file: string;
      fromAddress: string;
      fromName: string;
    }>;

export interface ServerConfig {
  readonly environment: "development" | "test" | "production";
  readonly instanceId: string;
  readonly host: string;
  readonly port: number;
  readonly trustedProxyHops: number;
  readonly trustedProxyCidrs: readonly string[];
  readonly serviceVersion: string;
  readonly cancellationGraceMs: number;
  readonly demo: {
    readonly enabled: boolean;
    readonly workspaceId: string;
    readonly actorId: string;
  };
  readonly database: DatabaseConnectionConfig;
  readonly enabledExecutionTargets: readonly ExecutionTarget[];
  readonly agentDevelopmentSkillFiles?: Readonly<Record<string, string>>;
  readonly providerDeploymentHardBounds?: ProviderDeploymentHardBounds;
  readonly providerProxyUrl?: string;
  readonly resultDownloadDeployment?: ResultDownloadRule;
  readonly providerSecrets: ProviderSecretFileMaps & {
    readonly activeKekVersion?: string;
  };
  readonly auth: {
    readonly oauthProviders?: readonly OAuthProviderConfig[];
    readonly baseUrl: string;
    readonly basePath: "/api/auth";
    readonly secret: string;
    readonly trustedOrigins: readonly string[];
    readonly secureCookies: boolean;
    readonly emailAndPasswordEnabled: boolean;
    readonly emailVerificationDelivery?: EmailVerificationDeliveryConfig;
    readonly sessionExpiresInSeconds: number;
    readonly sessionUpdateAgeSeconds: number;
  };
  readonly browserExecutor: {
    readonly enabled: boolean;
    readonly controlPlaneVersion: 1;
    readonly runtimeReleaseId?: string;
    readonly runtimeReleaseDigest?: string;
    readonly sessionTtlSeconds: number;
    readonly attemptLeaseDurationMs: number;
    readonly candidateLimit: number;
  };
  readonly storage?: ServerStorageConfig;
  readonly artifactPreview?: ArtifactPreviewConfig;
  readonly otlpEndpoint?: string;
  readonly checkConfigOnly: boolean;
}

function parseProviderProxyUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      "KANVAS_PROVIDER_PROXY_URL must be an exact HTTP(S) origin.",
    );
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    throw new Error(
      "KANVAS_PROVIDER_PROXY_URL must be an exact HTTP(S) origin without credentials, path, query or fragment.",
    );
  }
  return parsed.origin;
}

const defaultDemoWorkspaceId = "01K00000000000000000000000";
const defaultDemoActorId = "01K00000000000000000000001";
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (!value?.trim()) {
    return fallback;
  }
  if (value?.trim() === "true") {
    return true;
  }
  if (value?.trim() === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function resultDownloadDeployment(
  environment: NodeJS.ProcessEnv,
): ResultDownloadRule {
  const origins = environment.KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS?.trim();
  return {
    enabled: parseBoolean(
      environment.KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED,
      true,
      "KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED",
    ),
    allowedOrigins: origins
      ? [
          ...new Set(
            origins
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
              .map((value) => {
                const url = new URL(value);
                if (
                  !["http:", "https:"].includes(url.protocol) ||
                  url.username ||
                  url.password ||
                  url.pathname !== "/" ||
                  url.search ||
                  url.hash
                )
                  throw new Error(
                    "KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS must contain exact HTTP(S) origins.",
                  );
                return url.origin;
              }),
          ),
        ]
      : null,
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required deployment configuration: ${name}`);
  }
  return value;
}

function parseEnvironment(
  value: string | undefined,
): ServerConfig["environment"] {
  if (!value?.trim()) {
    return "development";
  }
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  throw new Error(
    "KANVAS_ENVIRONMENT must be development, test or production.",
  );
}

function parsePort(value: string | undefined): number {
  const port = Number(value?.trim() || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KANVAS_HTTP_PORT must be a valid TCP port.");
  }
  return port;
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = !value?.trim() ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function parseCancellationGrace(value: string | undefined): number {
  const milliseconds = Number(value?.trim() || "30000");
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1_000 ||
    milliseconds > 3_600_000
  ) {
    throw new Error(
      "KANVAS_CANCEL_GRACE_MS must be between 1000 and 3600000 milliseconds.",
    );
  }
  return milliseconds;
}

function loadAuthSecret(environment: NodeJS.ProcessEnv): string {
  const direct = environment.KANVAS_AUTH_SECRET;
  const file = environment.KANVAS_AUTH_SECRET_FILE?.trim();
  if (direct && file) {
    throw new Error(
      "Set only one of KANVAS_AUTH_SECRET or KANVAS_AUTH_SECRET_FILE.",
    );
  }

  const secret = file ? readFileSync(file, "utf8").trim() : direct;
  if (!secret) {
    throw new Error(
      "Missing KANVAS_AUTH_SECRET_FILE deployment secret reference.",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "The Better Auth secret must contain at least 32 characters.",
    );
  }
  return secret;
}

const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function readOptionalSecret(
  environment: NodeJS.ProcessEnv,
  directName: string,
  fileName: string,
): string | undefined {
  const direct = environment[directName];
  const file = environment[fileName]?.trim();
  if (direct && file) {
    throw new Error(`Set only one of ${directName} or ${fileName}.`);
  }

  const value = file ? readFileSync(file, "utf8").trim() : direct?.trim();
  return value || undefined;
}

function parseEmailVerificationDelivery(
  environment: NodeJS.ProcessEnv,
  environmentName: ServerConfig["environment"],
): EmailVerificationDeliveryConfig | undefined {
  const smtpHost = environment.KANVAS_AUTH_EMAIL_SMTP_HOST?.trim();
  const developmentOutboxFile =
    environment.KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE?.trim();
  if (smtpHost && developmentOutboxFile) {
    throw new Error(
      "Configure either SMTP email delivery or the development email outbox, not both.",
    );
  }
  if (!smtpHost && !developmentOutboxFile) return undefined;

  const fromAddress =
    environment.KANVAS_AUTH_EMAIL_FROM_ADDRESS?.trim() ||
    (developmentOutboxFile ? "kanvas@localhost.invalid" : undefined);
  if (!fromAddress || !emailAddressPattern.test(fromAddress)) {
    throw new Error(
      "KANVAS_AUTH_EMAIL_FROM_ADDRESS must be a valid email address when verification delivery is configured.",
    );
  }
  const fromName = environment.KANVAS_AUTH_EMAIL_FROM_NAME?.trim() || "Kanvas";
  if (fromName.length > 160 || /[\r\n]/u.test(fromName)) {
    throw new Error(
      "KANVAS_AUTH_EMAIL_FROM_NAME must contain at most 160 characters without line breaks.",
    );
  }

  if (developmentOutboxFile) {
    if (environmentName === "production") {
      throw new Error(
        "KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE cannot be used in production.",
      );
    }
    if (!isAbsolute(developmentOutboxFile)) {
      throw new Error(
        "KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE must be an absolute path.",
      );
    }
    return Object.freeze({
      kind: "development_outbox" as const,
      file: developmentOutboxFile,
      fromAddress,
      fromName,
    });
  }

  const smtpUser = environment.KANVAS_AUTH_EMAIL_SMTP_USER?.trim();
  const smtpPassword = readOptionalSecret(
    environment,
    "KANVAS_AUTH_EMAIL_SMTP_PASSWORD",
    "KANVAS_AUTH_EMAIL_SMTP_PASSWORD_FILE",
  );
  if ((smtpUser && !smtpPassword) || (!smtpUser && smtpPassword)) {
    throw new Error(
      "KANVAS_AUTH_EMAIL_SMTP_USER and its password must be configured together.",
    );
  }
  return Object.freeze({
    kind: "smtp" as const,
    host: smtpHost as string,
    port: parseBoundedInteger(
      environment.KANVAS_AUTH_EMAIL_SMTP_PORT,
      587,
      "KANVAS_AUTH_EMAIL_SMTP_PORT",
      1,
      65_535,
    ),
    secure: parseBoolean(
      environment.KANVAS_AUTH_EMAIL_SMTP_SECURE,
      false,
      "KANVAS_AUTH_EMAIL_SMTP_SECURE",
    ),
    requireTls: parseBoolean(
      environment.KANVAS_AUTH_EMAIL_SMTP_REQUIRE_TLS,
      true,
      "KANVAS_AUTH_EMAIL_SMTP_REQUIRE_TLS",
    ),
    fromAddress,
    fromName,
    ...(smtpUser && smtpPassword
      ? {
          authentication: Object.freeze({
            user: smtpUser,
            password: smtpPassword,
          }),
        }
      : {}),
  });
}

function parseAuthBaseUrl(
  environment: NodeJS.ProcessEnv,
  environmentName: ServerConfig["environment"],
  host: string,
  port: number,
): string {
  const configured = environment.KANVAS_AUTH_BASE_URL?.trim();
  if (environmentName === "production" && !configured) {
    throw new Error(
      "Missing required deployment configuration: KANVAS_AUTH_BASE_URL",
    );
  }
  const value = configured || `http://${host}:${port}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("KANVAS_AUTH_BASE_URL must be an absolute URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "KANVAS_AUTH_BASE_URL must be an origin without credentials, path, query or fragment.",
    );
  }
  if (environmentName === "production" && url.protocol !== "https:") {
    throw new Error("KANVAS_AUTH_BASE_URL must use HTTPS in production.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("KANVAS_AUTH_BASE_URL must use HTTP or HTTPS.");
  }
  return url.origin;
}

function parseTrustedOrigins(
  value: string | undefined,
  baseUrl: string,
  environmentName: ServerConfig["environment"],
): readonly string[] {
  const requested = [
    new URL(baseUrl).origin,
    ...(value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];
  const result: string[] = [];
  for (const origin of requested) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        "KANVAS_AUTH_TRUSTED_ORIGINS must contain absolute origins.",
      );
    }
    if (
      origin.includes("*") ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        "KANVAS_AUTH_TRUSTED_ORIGINS accepts exact origins only.",
      );
    }
    if (environmentName === "production" && parsed.protocol !== "https:") {
      throw new Error(
        "KANVAS_AUTH_TRUSTED_ORIGINS must use HTTPS in production.",
      );
    }
    if (!result.includes(parsed.origin)) {
      result.push(parsed.origin);
    }
  }
  return Object.freeze(result);
}

function parseExecutionTargets(
  value: string | undefined,
): readonly ExecutionTarget[] {
  const requested = (value?.trim() || "worker")
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  if (unique.length < 1) {
    throw new Error(
      "KANVAS_ENABLED_EXECUTION_TARGETS must enable at least one target.",
    );
  }
  for (const target of unique) {
    if (target !== "worker" && target !== "provider" && target !== "browser") {
      throw new Error(`Unknown execution target: ${target}`);
    }
  }
  return Object.freeze(unique as ExecutionTarget[]);
}

function parseBrowserExecutorConfig(
  environment: NodeJS.ProcessEnv,
  enabledExecutionTargets: readonly ExecutionTarget[],
): ServerConfig["browserExecutor"] {
  const enabled = enabledExecutionTargets.includes("browser");
  const runtimeReleaseId =
    environment.KANVAS_BROWSER_RUNTIME_RELEASE_ID?.trim();
  const runtimeReleaseDigest =
    environment.KANVAS_BROWSER_RUNTIME_RELEASE_DIGEST?.trim();
  if (enabled) {
    if (!runtimeReleaseId || !ulidPattern.test(runtimeReleaseId)) {
      throw new Error(
        "KANVAS_BROWSER_RUNTIME_RELEASE_ID must be a canonical uppercase ULID when the browser target is enabled.",
      );
    }
    if (!runtimeReleaseDigest || !digestPattern.test(runtimeReleaseDigest)) {
      throw new Error(
        "KANVAS_BROWSER_RUNTIME_RELEASE_DIGEST must be a canonical sha256 digest when the browser target is enabled.",
      );
    }
  } else if (runtimeReleaseId || runtimeReleaseDigest) {
    throw new Error(
      "Browser runtime release identity cannot be configured while the browser target is disabled.",
    );
  }
  return Object.freeze({
    enabled,
    controlPlaneVersion: 1 as const,
    ...(runtimeReleaseId ? { runtimeReleaseId } : {}),
    ...(runtimeReleaseDigest ? { runtimeReleaseDigest } : {}),
    sessionTtlSeconds: parseBoundedInteger(
      environment.KANVAS_BROWSER_SESSION_TTL_SECONDS,
      3_600,
      "KANVAS_BROWSER_SESSION_TTL_SECONDS",
      300,
      86_400,
    ),
    attemptLeaseDurationMs: parseBoundedInteger(
      environment.KANVAS_BROWSER_ATTEMPT_LEASE_MS,
      30_000,
      "KANVAS_BROWSER_ATTEMPT_LEASE_MS",
      5_000,
      120_000,
    ),
    candidateLimit: parseBoundedInteger(
      environment.KANVAS_BROWSER_CANDIDATE_LIMIT,
      20,
      "KANVAS_BROWSER_CANDIDATE_LIMIT",
      1,
      100,
    ),
  });
}

function parseStorageConfig(
  environment: NodeJS.ProcessEnv,
  environmentName: ServerConfig["environment"],
): ServerConfig["storage"] {
  const storageConfig = loadTrustedImageStorageConfig(
    environment,
    environmentName,
  );
  if (!storageConfig) {
    return undefined;
  }
  return Object.freeze({
    ...storageConfig,
    userImportSessionTtlMilliseconds: parseBoundedInteger(
      environment.KANVAS_STORAGE_USER_IMPORT_TTL_MS,
      3_600_000,
      "KANVAS_STORAGE_USER_IMPORT_TTL_MS",
      300_000,
      86_400_000,
    ),
    modelResourceImportSessionTtlMilliseconds: parseBoundedInteger(
      environment.KANVAS_MODEL_RESOURCE_IMPORT_TTL_MS,
      86_400_000,
      "KANVAS_MODEL_RESOURCE_IMPORT_TTL_MS",
      3_600_000,
      604_800_000,
    ),
  });
}

function parseProviderDeploymentBounds(
  value: string | undefined,
): ProviderDeploymentHardBounds | undefined {
  const configured = value?.trim();
  if (!configured) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured) as unknown;
  } catch {
    throw new Error(
      "KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON must be valid JSON.",
    );
  }
  return parseProviderDeploymentHardBounds(parsed);
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): ServerConfig {
  const environmentName = parseEnvironment(environment.KANVAS_ENVIRONMENT);

  const otlpEndpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const demoEnabled = parseBoolean(
    environment.KANVAS_DEMO_MODE,
    environmentName !== "production",
    "KANVAS_DEMO_MODE",
  );
  if (environmentName === "production" && demoEnabled) {
    throw new Error("KANVAS_DEMO_MODE cannot be enabled in production.");
  }
  const host = environment.KANVAS_HTTP_HOST?.trim() || "127.0.0.1";
  const port = parsePort(environment.KANVAS_HTTP_PORT);
  const authBaseUrl = parseAuthBaseUrl(
    environment,
    environmentName,
    host,
    port,
  );
  const emailVerificationDelivery = parseEmailVerificationDelivery(
    environment,
    environmentName,
  );
  const sessionExpiresInSeconds = parseBoundedInteger(
    environment.KANVAS_AUTH_SESSION_EXPIRES_IN_SECONDS,
    7 * 24 * 60 * 60,
    "KANVAS_AUTH_SESSION_EXPIRES_IN_SECONDS",
    15 * 60,
    30 * 24 * 60 * 60,
  );
  const sessionUpdateAgeSeconds = parseBoundedInteger(
    environment.KANVAS_AUTH_SESSION_UPDATE_AGE_SECONDS,
    24 * 60 * 60,
    "KANVAS_AUTH_SESSION_UPDATE_AGE_SECONDS",
    0,
    sessionExpiresInSeconds,
  );
  const enabledExecutionTargets = parseExecutionTargets(
    environment.KANVAS_ENABLED_EXECUTION_TARGETS,
  );
  const agentDevelopmentSkillFiles = loadAgentDevelopmentSkillFiles(
    environment,
    environmentName,
  );
  const storage = parseStorageConfig(environment, environmentName);
  const artifactPreview = loadArtifactPreviewConfig(environment);
  if (artifactPreview.mode === "async_persisted" && !storage) {
    throw new Error(
      "async_persisted Artifact previews require a configured Storage profile.",
    );
  }
  const providerDeploymentHardBounds = parseProviderDeploymentBounds(
    environment.KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON,
  );
  const providerProxyUrl = parseProviderProxyUrl(
    environment.KANVAS_PROVIDER_PROXY_URL,
  );
  const providerSecretFileMaps = loadProviderSecretFileMaps(environment);
  const activeKekVersion =
    environment.KANVAS_PROVIDER_ACTIVE_KEK_VERSION?.trim();
  if (
    activeKekVersion &&
    !providerSecretFileMaps.kekFiles[activeKekVersion] &&
    !providerSecretFileMaps.kekValues?.[activeKekVersion]
  ) {
    throw new Error(
      "KANVAS_PROVIDER_ACTIVE_KEK_VERSION is not present in KANVAS_PROVIDER_KEK_MAP_FILE.",
    );
  }
  return Object.freeze({
    environment: environmentName,
    instanceId: required(environment, "KANVAS_INSTANCE_ID"),
    host,
    port,
    trustedProxyCidrs: parseTrustedProxyCidrs(
      environment.KANVAS_HTTP_TRUSTED_PROXY_CIDRS,
    ),
    trustedProxyHops: parseBoundedInteger(
      environment.KANVAS_HTTP_TRUSTED_PROXY_HOPS,
      0,
      "KANVAS_HTTP_TRUSTED_PROXY_HOPS",
      0,
      4,
    ),
    serviceVersion:
      environment.KANVAS_RELEASE_VERSION?.trim() || "0.0.0-development",
    cancellationGraceMs: parseCancellationGrace(
      environment.KANVAS_CANCEL_GRACE_MS,
    ),
    demo: Object.freeze({
      enabled: demoEnabled,
      workspaceId:
        environment.KANVAS_DEMO_WORKSPACE_ID?.trim() || defaultDemoWorkspaceId,
      actorId: environment.KANVAS_DEMO_ACTOR_ID?.trim() || defaultDemoActorId,
    }),
    database: loadDatabaseConnectionConfig(environment),
    enabledExecutionTargets,
    ...(agentDevelopmentSkillFiles ? { agentDevelopmentSkillFiles } : {}),
    ...(providerDeploymentHardBounds ? { providerDeploymentHardBounds } : {}),
    ...(providerProxyUrl ? { providerProxyUrl } : {}),
    resultDownloadDeployment: resultDownloadDeployment(environment),
    providerSecrets: Object.freeze({
      ...providerSecretFileMaps,
      ...(activeKekVersion ? { activeKekVersion } : {}),
    }),
    auth: Object.freeze({
      oauthProviders: loadOAuthProviders(
        environment.KANVAS_AUTH_OAUTH_CONFIG_FILE,
        environment.KANVAS_AUTH_OAUTH_CONFIG_JSON,
      ),
      baseUrl: authBaseUrl,
      basePath: "/api/auth" as const,
      secret: loadAuthSecret(environment),
      trustedOrigins: parseTrustedOrigins(
        environment.KANVAS_AUTH_TRUSTED_ORIGINS,
        authBaseUrl,
        environmentName,
      ),
      secureCookies: environmentName === "production",
      emailAndPasswordEnabled: parseBoolean(
        environment.KANVAS_AUTH_EMAIL_PASSWORD_ENABLED,
        true,
        "KANVAS_AUTH_EMAIL_PASSWORD_ENABLED",
      ),
      ...(emailVerificationDelivery ? { emailVerificationDelivery } : {}),
      sessionExpiresInSeconds,
      sessionUpdateAgeSeconds,
    }),
    browserExecutor: parseBrowserExecutorConfig(
      environment,
      enabledExecutionTargets,
    ),
    ...(storage ? { storage } : {}),
    artifactPreview,
    ...(otlpEndpoint ? { otlpEndpoint } : {}),
    checkConfigOnly: arguments_.includes("--check-config"),
  });
}
