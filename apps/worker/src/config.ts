import type { ProviderResultTimeouts } from "./provider/provider-http-transport.js";
import { readFileSync } from "node:fs";

import type { WorkerRole } from "@kanvas/application";
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
import { loadProviderSecretFileMaps } from "@kanvas/secrets";
import {
  loadArtifactPreviewConfig,
  loadTrustedImageStorageConfig,
  type ArtifactPreviewConfig,
  type TrustedImageStorageConfig,
} from "@kanvas/storage";

export type WorkerStorageConfig = TrustedImageStorageConfig &
  Readonly<{
    modelImport: {
      readonly pollIntervalMs: number;
      readonly leaseDurationMs: number;
      readonly downloadTimeoutMs: number;
      readonly proxyUrl?: string;
    };
    garbageCollection: {
      readonly pollIntervalMs: number;
      readonly claimLeaseMs: number;
      readonly baseRetryMs: number;
      readonly maximumRetryMs: number;
    };
  }>;

const knownRoles: readonly WorkerRole[] = Object.freeze([
  "orchestration",
  "execution",
  "provider-execution",
  "outbox-relay",
  "scheduler",
  "reconciler",
  "maintenance",
  "agent",
]);
const defaultRoles: readonly WorkerRole[] = Object.freeze(
  knownRoles.filter(
    (role) => role !== "provider-execution" && role !== "agent",
  ),
);

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly password?: string;
  readonly username?: string;
  readonly tls?: { readonly rejectUnauthorized: true; readonly ca?: string };
}

export interface WorkerConfig {
  readonly environment: "development" | "test" | "production";
  readonly instanceId: string;
  readonly serviceVersion: string;
  readonly roles: readonly WorkerRole[];
  readonly healthHost: string;
  readonly healthPort: number;
  readonly database: DatabaseConnectionConfig;
  readonly redis: RedisConnectionConfig;
  readonly enabledExecutionTargets: readonly ExecutionTarget[];
  readonly providerDeploymentHardBounds?: ProviderDeploymentHardBounds;
  readonly agentDevelopmentSkillFiles?: Readonly<Record<string, string>>;
  readonly workerAdapters: {
    /**
     * Generic SHA-derived PNG canary. It validates the Worker/Storage
     * transport only and is forbidden in production.
     */
    readonly deterministicImageEnabled: boolean;
  };
  readonly provider: {
    readonly resultTimeouts: ProviderResultTimeouts;
    /**
     * Development-only deterministic adapter used to close the Provider
     * transport/reconciliation vertical gate without external I/O.
     */
    readonly fakeAdapterEnabled: boolean;
    readonly adapterKeys: readonly ProviderHttpAdapterKey[];
    readonly allowedOrigins?: readonly string[];
    /** Provider-returned artifacts use an independent egress trust boundary. */
    readonly resultDownloadsEnabled: boolean;
    readonly resultAllowedOrigins?: readonly string[];
    /**
     * Explicit deployment-owned HTTP(S) CONNECT proxy. Provider traffic never
     * inherits ambient HTTP_PROXY/HTTPS_PROXY variables.
     */
    readonly proxyUrl?: string;
    readonly allowPrivateNetworks: boolean;
    readonly allowHttp: boolean;
    readonly maximumRequestBytes: number;
    readonly maximumResponseBytes: number;
    readonly deploymentSecretFiles: Readonly<Record<string, string>>;
    readonly kekValues?: Readonly<Record<string, string>>;
    readonly kekFiles: Readonly<Record<string, string>>;
  };
  readonly execution: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
    readonly attemptTimeoutMs: number;
  };
  readonly agent: {
    readonly runConcurrency: number;
  };
  readonly storage?: WorkerStorageConfig;
  readonly artifactPreview: ArtifactPreviewConfig;
  readonly reconciler: {
    readonly pollIntervalMs: number;
    readonly staleAfterMs: number;
    readonly batchSize: number;
  };
  readonly otlpEndpoint?: string;
  readonly checkConfigOnly: boolean;
}

export const providerTextHttpAdapterKeys = Object.freeze([
  "openai.responses.v1",
  "openai.chat-completions.v1",
  "openrouter.responses.v1",
  "openrouter.chat-completions.v1",
  "openai-compatible.responses.v1",
  "openai-compatible.chat-completions.v1",
] as const);

export const providerImageHttpAdapterKeys = Object.freeze([
  "openai-compatible.images.generations.v1",
  "gemini.generate-content.image.v1",
  "xai.images.edits.v1",
  "openai.images.edits.v1",
  "openai.image.upscale.reconstructive.v1",
  "openai.image.canvas-expand.v1",
  "openai.image.object-remove.v1",
  "generation-tasks.image.upscale.reconstructive.v1",
  "generation-tasks.image.canvas-expand.v1",
  "generation-tasks.image.object-remove.v1",
  "generation-tasks.image.generate.v1",
  "generation-tasks.image.edit.v1",
] as const);

export const providerHttpAdapterKeys = Object.freeze([
  ...providerTextHttpAdapterKeys,
  ...providerImageHttpAdapterKeys,
] as const);

export function requiresTrustedImageStorageRuntime(
  roles: readonly WorkerRole[],
): boolean {
  return (
    roles.includes("execution") ||
    roles.includes("provider-execution") ||
    roles.includes("maintenance") ||
    roles.includes("agent")
  );
}

export type ProviderHttpAdapterKey = (typeof providerHttpAdapterKeys)[number];

export type ProviderTextHttpAdapterKey =
  (typeof providerTextHttpAdapterKeys)[number];

export type ProviderImageHttpAdapterKey =
  (typeof providerImageHttpAdapterKeys)[number];

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required deployment configuration: ${name}`);
  }
  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum = 65_535,
): number {
  const parsed = Number(value?.trim() || String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

const absoluteMaximumAgentRunConcurrency = 32;
const reservedDatabaseConnections = 2;

function parseAgentRunConcurrency(
  value: string | undefined,
  databaseConnectionLimit: number,
): number {
  const maximum = Math.min(
    absoluteMaximumAgentRunConcurrency,
    Math.max(1, databaseConnectionLimit - reservedDatabaseConnections),
  );
  const fallback = Math.min(4, maximum);
  const parsed = Number(value?.trim() || String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(
      `KANVAS_AGENT_RUN_CONCURRENCY must be a positive integer no greater than ${String(maximum)} for database connection limit ${String(databaseConnectionLimit)}.`,
    );
  }
  return parsed;
}

function loadProviderDeploymentHardBounds(
  value: string | undefined,
): ProviderDeploymentHardBounds | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      "KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON must be valid JSON.",
    );
  }
  return parseProviderDeploymentHardBounds(parsed);
}

function loadRedisConnection(
  environment: NodeJS.ProcessEnv,
  environmentName: WorkerConfig["environment"],
): RedisConnectionConfig {
  if (environment.KANVAS_REDIS_URL) {
    if (
      [
        "KANVAS_REDIS_HOST",
        "KANVAS_REDIS_PORT",
        "KANVAS_REDIS_DB",
        "KANVAS_REDIS_PASSWORD",
        "KANVAS_REDIS_PASSWORD_FILE",
      ].some((key) => environment[key] !== undefined)
    )
      throw new Error(
        "Do not combine KANVAS_REDIS_URL with split connection fields.",
      );
    try {
      const url = new URL(environment.KANVAS_REDIS_URL);
      if (
        !["redis:", "rediss:"].includes(url.protocol) ||
        !url.hostname ||
        url.search ||
        url.hash
      )
        throw new Error();
      return Object.freeze({
        host: url.hostname.replace(/^\[|\]$/gu, ""),
        port: parsePositiveInteger(
          url.port || undefined,
          6379,
          "KANVAS_REDIS_PORT",
        ),
        db: loadRedisDatabase(url.pathname.slice(1)),
        password: decodeURIComponent(url.password),
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...loadRedisTls(environment, url.protocol === "rediss:"),
      });
    } catch {
      throw new Error(
        "Invalid KANVAS_REDIS_URL or TLS configuration; expected redis[s]://[username]:password@host:port/database without query or fragment.",
      );
    }
  }
  const password = loadRedisPassword(environment, environmentName);
  return Object.freeze({
    host: required(environment, "KANVAS_REDIS_HOST"),
    port: parsePositiveInteger(
      environment.KANVAS_REDIS_PORT,
      6379,
      "KANVAS_REDIS_PORT",
    ),
    db: loadRedisDatabase(environment.KANVAS_REDIS_DB),
    ...(password ? { password } : {}),
    ...loadRedisTls(environment, false),
  });
}

function loadRedisTls(
  environment: NodeJS.ProcessEnv,
  enabled: boolean,
): Pick<RedisConnectionConfig, "tls"> {
  const caPath = environment.KANVAS_REDIS_TLS_CA_FILE;
  if (!enabled && !caPath) return {};
  const ca = caPath ? readFileSync(caPath, "utf8") : undefined;
  if (ca !== undefined && !ca.trim())
    throw new Error("Redis CA file is empty.");
  return { tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

function loadRedisDatabase(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const database = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(database)) {
    throw new Error("KANVAS_REDIS_DB must be a non-negative safe integer.");
  }
  return database;
}

function loadRedisPassword(
  environment: NodeJS.ProcessEnv,
  environmentName: WorkerConfig["environment"],
): string | undefined {
  const direct = environment.KANVAS_REDIS_PASSWORD;
  const file = environment.KANVAS_REDIS_PASSWORD_FILE;
  if (direct && file) {
    throw new Error(
      "Set only one of KANVAS_REDIS_PASSWORD or KANVAS_REDIS_PASSWORD_FILE.",
    );
  }
  if (file) {
    const value = readFileSync(file, "utf8").trim();
    if (!value) {
      throw new Error("KANVAS_REDIS_PASSWORD_FILE is empty.");
    }
    return value;
  }
  if (direct) {
    return direct;
  }
  if (environmentName === "production") {
    throw new Error("Missing KANVAS_REDIS_PASSWORD_FILE deployment secret.");
  }
  return undefined;
}

function parseRoles(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): readonly WorkerRole[] {
  const argument = arguments_.find((value) => value.startsWith("--roles="));
  const requested = (
    argument?.slice("--roles=".length) ||
    environment.KANVAS_WORKER_ROLES?.trim() ||
    defaultRoles.join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];

  if (unique.length === 0) {
    throw new Error("At least one worker role must be enabled.");
  }
  for (const role of unique) {
    if (!knownRoles.includes(role as WorkerRole)) {
      throw new Error(`Unknown worker role: ${role}`);
    }
  }
  return Object.freeze(unique as WorkerRole[]);
}

function parseEnvironment(
  value: string | undefined,
): WorkerConfig["environment"] {
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

function parseProviderAdapterKeys(
  value: string | undefined,
): readonly ProviderHttpAdapterKey[] {
  const requested = (value?.trim() ?? "")
    .split(",")
    .map((adapter) => adapter.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  for (const adapter of unique) {
    if (!providerHttpAdapterKeys.includes(adapter as ProviderHttpAdapterKey)) {
      throw new Error(`Unknown Provider HTTP Adapter: ${adapter}`);
    }
  }
  return Object.freeze(unique as ProviderHttpAdapterKey[]);
}

function parseExactOrigins(
  value: string | undefined,
  variableName = "KANVAS_PROVIDER_ALLOWED_ORIGINS",
): readonly string[] {
  const requested = (value?.trim() ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const normalized = requested.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`${variableName} contains an invalid URL: ${origin}`);
    }
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !["https:", "http:"].includes(parsed.protocol)
    ) {
      throw new Error(
        `${variableName} must contain exact HTTP(S) origins without credentials, paths, query or fragments.`,
      );
    }
    return parsed.origin;
  });
  return Object.freeze([...new Set(normalized)]);
}

function parseExplicitProxyUrl(
  value: string | undefined,
  variableName: string,
): string | undefined {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${variableName} must be an exact HTTP(S) origin.`);
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !["https:", "http:"].includes(parsed.protocol)
  ) {
    throw new Error(
      `${variableName} must be an exact HTTP(S) origin without credentials, path, query or fragment.`,
    );
  }
  return parsed.origin;
}

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): WorkerConfig {
  const environmentName = parseEnvironment(environment.KANVAS_ENVIRONMENT);

  const database = loadDatabaseConnectionConfig(environment);
  const otlpEndpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const redisConnection = loadRedisConnection(environment, environmentName);
  const roles = parseRoles(environment, arguments_);
  const enabledExecutionTargets = parseExecutionTargets(
    environment.KANVAS_ENABLED_EXECUTION_TARGETS,
  );
  const providerDeploymentHardBounds = loadProviderDeploymentHardBounds(
    environment.KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON,
  );
  const agentDevelopmentSkillFiles = loadAgentDevelopmentSkillFiles(
    environment,
    environmentName,
  );
  const fakeAdapterEnabled = parseBoolean(
    environment.KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED,
    false,
    "KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED",
  );
  const deterministicImageAdapterEnabled = parseBoolean(
    environment.KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED,
    false,
    "KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED",
  );
  const providerAdapterKeys =
    !environment.KANVAS_PROVIDER_ADAPTER_KEYS?.trim() &&
    enabledExecutionTargets.includes("provider") &&
    !fakeAdapterEnabled
      ? providerHttpAdapterKeys
      : parseProviderAdapterKeys(environment.KANVAS_PROVIDER_ADAPTER_KEYS);
  const providerAllowedOrigins =
    !environment.KANVAS_PROVIDER_ALLOWED_ORIGINS?.trim()
      ? undefined
      : parseExactOrigins(environment.KANVAS_PROVIDER_ALLOWED_ORIGINS);
  const providerResultDownloadsEnabled = parseBoolean(
    environment.KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED,
    true,
    "KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED",
  );
  const providerResultAllowedOrigins =
    !environment.KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS?.trim()
      ? undefined
      : parseExactOrigins(
          environment.KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS,
          "KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS",
        );
  const providerProxyUrl = parseExplicitProxyUrl(
    environment.KANVAS_PROVIDER_PROXY_URL,
    "KANVAS_PROVIDER_PROXY_URL",
  );
  const modelImportProxyUrl = parseExplicitProxyUrl(
    environment.KANVAS_MODEL_IMPORT_PROXY_URL,
    "KANVAS_MODEL_IMPORT_PROXY_URL",
  );
  const storageAdapterConfig = loadTrustedImageStorageConfig(
    environment,
    environmentName,
  );
  const artifactPreview = loadArtifactPreviewConfig(environment);
  if (artifactPreview.mode === "async_persisted" && !storageAdapterConfig) {
    throw new Error(
      "async_persisted Artifact previews require a configured Storage profile.",
    );
  }
  const storageGarbageCollection = storageAdapterConfig
    ? Object.freeze({
        pollIntervalMs: parsePositiveInteger(
          environment.KANVAS_STORAGE_GC_POLL_INTERVAL_MS,
          5_000,
          "KANVAS_STORAGE_GC_POLL_INTERVAL_MS",
          3_600_000,
        ),
        claimLeaseMs: parsePositiveInteger(
          environment.KANVAS_STORAGE_GC_CLAIM_LEASE_MS,
          30_000,
          "KANVAS_STORAGE_GC_CLAIM_LEASE_MS",
          3_600_000,
        ),
        baseRetryMs: parsePositiveInteger(
          environment.KANVAS_STORAGE_GC_BASE_RETRY_MS,
          5_000,
          "KANVAS_STORAGE_GC_BASE_RETRY_MS",
          3_600_000,
        ),
        maximumRetryMs: parsePositiveInteger(
          environment.KANVAS_STORAGE_GC_MAX_RETRY_MS,
          300_000,
          "KANVAS_STORAGE_GC_MAX_RETRY_MS",
          86_400_000,
        ),
      })
    : undefined;
  const modelImport = storageAdapterConfig
    ? Object.freeze({
        pollIntervalMs: parsePositiveInteger(
          environment.KANVAS_MODEL_IMPORT_POLL_INTERVAL_MS,
          1_000,
          "KANVAS_MODEL_IMPORT_POLL_INTERVAL_MS",
          60_000,
        ),
        leaseDurationMs: parsePositiveInteger(
          environment.KANVAS_MODEL_IMPORT_LEASE_MS,
          3_600_000,
          "KANVAS_MODEL_IMPORT_LEASE_MS",
          3_600_000,
        ),
        downloadTimeoutMs: parsePositiveInteger(
          environment.KANVAS_MODEL_IMPORT_DOWNLOAD_TIMEOUT_MS,
          3_300_000,
          "KANVAS_MODEL_IMPORT_DOWNLOAD_TIMEOUT_MS",
          3_600_000,
        ),
        ...(modelImportProxyUrl ? { proxyUrl: modelImportProxyUrl } : {}),
      })
    : undefined;
  if (
    storageGarbageCollection &&
    storageGarbageCollection.maximumRetryMs <
      storageGarbageCollection.baseRetryMs
  ) {
    throw new Error(
      "KANVAS_STORAGE_GC_MAX_RETRY_MS cannot be below KANVAS_STORAGE_GC_BASE_RETRY_MS.",
    );
  }
  if (
    modelImport &&
    modelImport.downloadTimeoutMs + 30_000 > modelImport.leaseDurationMs
  ) {
    throw new Error(
      "KANVAS_MODEL_IMPORT_LEASE_MS must exceed the download timeout by at least 30000ms.",
    );
  }
  const allowPrivateNetworks = parseBoolean(
    environment.KANVAS_PROVIDER_ALLOW_PRIVATE_NETWORKS,
    false,
    "KANVAS_PROVIDER_ALLOW_PRIVATE_NETWORKS",
  );
  const allowHttp = parseBoolean(
    environment.KANVAS_PROVIDER_ALLOW_HTTP,
    false,
    "KANVAS_PROVIDER_ALLOW_HTTP",
  );
  const { deploymentSecretFiles, kekFiles, kekValues } =
    loadProviderSecretFileMaps(environment);
  if (
    roles.includes("provider-execution") &&
    !enabledExecutionTargets.includes("provider")
  ) {
    throw new Error(
      "The provider-execution role requires the provider execution target.",
    );
  }
  if (
    enabledExecutionTargets.includes("provider") &&
    !fakeAdapterEnabled &&
    providerAdapterKeys.length === 0
  ) {
    throw new Error(
      "Provider execution is not enabled until a configured Adapter is registered.",
    );
  }
  if (providerAdapterKeys.length > 0 && providerAllowedOrigins?.length === 0) {
    throw new Error(
      "KANVAS_PROVIDER_ALLOWED_ORIGINS must not be empty when supplied for Provider HTTP Adapters.",
    );
  }
  if (
    providerResultDownloadsEnabled &&
    providerResultAllowedOrigins?.length === 0
  ) {
    throw new Error(
      "KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS must not be empty when supplied for enabled downloads.",
    );
  }
  if (
    environmentName === "production" &&
    (allowHttp || allowPrivateNetworks) &&
    environment.KANVAS_PROVIDER_UNSAFE_NETWORK_ACK !==
      "I_ACKNOWLEDGE_PRIVATE_PROVIDER_EGRESS"
  ) {
    throw new Error(
      "Production HTTP or private Provider egress requires the explicit unsafe-network acknowledgement.",
    );
  }
  if (fakeAdapterEnabled && environmentName === "production") {
    throw new Error(
      "KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED cannot be used in production.",
    );
  }
  if (deterministicImageAdapterEnabled && environmentName === "production") {
    throw new Error(
      "KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED cannot be used in production.",
    );
  }
  if (deterministicImageAdapterEnabled && !roles.includes("execution")) {
    throw new Error(
      "The deterministic image Worker Adapter requires the execution role.",
    );
  }
  if (deterministicImageAdapterEnabled && !storageAdapterConfig) {
    throw new Error(
      "The deterministic image Worker Adapter requires a trusted Storage profile.",
    );
  }
  if (
    environmentName === "production" &&
    roles.includes("provider-execution") &&
    providerAdapterKeys.length > 0 &&
    !roles.includes("reconciler")
  ) {
    throw new Error(
      "Production Provider execution requires the reconciler role for terminal budget repair.",
    );
  }
  const leaseDurationMs = parsePositiveInteger(
    environment.KANVAS_ATTEMPT_LEASE_DURATION_MS,
    30_000,
    "KANVAS_ATTEMPT_LEASE_DURATION_MS",
    3_600_000,
  );
  const heartbeatIntervalMs = parsePositiveInteger(
    environment.KANVAS_ATTEMPT_HEARTBEAT_INTERVAL_MS,
    10_000,
    "KANVAS_ATTEMPT_HEARTBEAT_INTERVAL_MS",
    3_600_000,
  );
  const attemptTimeoutMs = parsePositiveInteger(
    environment.KANVAS_ATTEMPT_TIMEOUT_MS,
    300_000,
    "KANVAS_ATTEMPT_TIMEOUT_MS",
    86_400_000,
  );
  if (
    heartbeatIntervalMs >= leaseDurationMs ||
    leaseDurationMs > attemptTimeoutMs
  ) {
    throw new Error(
      "Attempt heartbeat interval must be shorter than the lease, and the lease must not exceed the attempt timeout.",
    );
  }
  return Object.freeze({
    environment: environmentName,
    instanceId: required(environment, "KANVAS_INSTANCE_ID"),
    serviceVersion:
      environment.KANVAS_RELEASE_VERSION?.trim() || "0.0.0-development",
    roles,
    healthHost: environment.KANVAS_WORKER_HEALTH_HOST?.trim() || "127.0.0.1",
    healthPort: parsePositiveInteger(
      environment.KANVAS_WORKER_HEALTH_PORT,
      3001,
      "KANVAS_WORKER_HEALTH_PORT",
    ),
    database,
    redis: redisConnection,
    enabledExecutionTargets,
    ...(providerDeploymentHardBounds ? { providerDeploymentHardBounds } : {}),
    ...(agentDevelopmentSkillFiles ? { agentDevelopmentSkillFiles } : {}),
    workerAdapters: Object.freeze({
      deterministicImageEnabled: deterministicImageAdapterEnabled,
    }),
    provider: Object.freeze({
      resultTimeouts: {
        connectMs: parsePositiveInteger(
          environment.KANVAS_PROVIDER_RESULT_CONNECT_TIMEOUT_MS,
          Math.min(20_000, attemptTimeoutMs),
          "KANVAS_PROVIDER_RESULT_CONNECT_TIMEOUT_MS",
          attemptTimeoutMs,
        ),
        headersMs: parsePositiveInteger(
          environment.KANVAS_PROVIDER_RESULT_HEADERS_TIMEOUT_MS,
          Math.min(60_000, attemptTimeoutMs),
          "KANVAS_PROVIDER_RESULT_HEADERS_TIMEOUT_MS",
          attemptTimeoutMs,
        ),
        firstByteMs: parsePositiveInteger(
          environment.KANVAS_PROVIDER_RESULT_FIRST_BYTE_TIMEOUT_MS,
          Math.min(60_000, attemptTimeoutMs),
          "KANVAS_PROVIDER_RESULT_FIRST_BYTE_TIMEOUT_MS",
          attemptTimeoutMs,
        ),
        idleMs: parsePositiveInteger(
          environment.KANVAS_PROVIDER_RESULT_IDLE_TIMEOUT_MS,
          Math.min(60_000, attemptTimeoutMs),
          "KANVAS_PROVIDER_RESULT_IDLE_TIMEOUT_MS",
          attemptTimeoutMs,
        ),
      },
      fakeAdapterEnabled,
      adapterKeys: providerAdapterKeys,
      ...(providerAllowedOrigins !== undefined
        ? { allowedOrigins: providerAllowedOrigins }
        : {}),
      resultDownloadsEnabled: providerResultDownloadsEnabled,
      ...(providerResultAllowedOrigins !== undefined
        ? { resultAllowedOrigins: providerResultAllowedOrigins }
        : {}),
      ...(providerProxyUrl ? { proxyUrl: providerProxyUrl } : {}),
      allowPrivateNetworks,
      allowHttp,
      maximumRequestBytes: parsePositiveInteger(
        environment.KANVAS_PROVIDER_MAX_REQUEST_BYTES,
        16_777_216,
        "KANVAS_PROVIDER_MAX_REQUEST_BYTES",
        67_108_864,
      ),
      maximumResponseBytes: parsePositiveInteger(
        environment.KANVAS_PROVIDER_MAX_RESPONSE_BYTES,
        33_554_432,
        "KANVAS_PROVIDER_MAX_RESPONSE_BYTES",
        134_217_728,
      ),
      deploymentSecretFiles,
      kekFiles,
      ...(kekValues ? { kekValues } : {}),
    }),
    execution: Object.freeze({
      leaseDurationMs,
      heartbeatIntervalMs,
      attemptTimeoutMs,
    }),
    agent: Object.freeze({
      runConcurrency: parseAgentRunConcurrency(
        environment.KANVAS_AGENT_RUN_CONCURRENCY,
        database.connectionLimit,
      ),
    }),
    ...(storageAdapterConfig && storageGarbageCollection && modelImport
      ? {
          storage: Object.freeze({
            ...storageAdapterConfig,
            garbageCollection: storageGarbageCollection,
            modelImport,
          }),
        }
      : {}),
    artifactPreview,
    reconciler: Object.freeze({
      pollIntervalMs: parsePositiveInteger(
        environment.KANVAS_RECONCILER_POLL_INTERVAL_MS,
        1000,
        "KANVAS_RECONCILER_POLL_INTERVAL_MS",
        300_000,
      ),
      staleAfterMs: parsePositiveInteger(
        environment.KANVAS_RECONCILER_STALE_AFTER_MS,
        15_000,
        "KANVAS_RECONCILER_STALE_AFTER_MS",
        3_600_000,
      ),
      batchSize: parsePositiveInteger(
        environment.KANVAS_RECONCILER_BATCH_SIZE,
        20,
        "KANVAS_RECONCILER_BATCH_SIZE",
        100,
      ),
    }),
    ...(otlpEndpoint ? { otlpEndpoint } : {}),
    checkConfigOnly: arguments_.includes("--check-config"),
  });
}
