import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadWorkerConfig,
  providerHttpAdapterKeys,
  requiresTrustedImageStorageRuntime,
} from "../src/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function secretMapFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kanvas-provider-config-"));
  temporaryDirectories.push(directory);
  const secretPath = join(directory, "openai-api-key");
  const mapPath = join(directory, "deployment-secret-map.json");
  await writeFile(secretPath, "test-only");
  await writeFile(
    mapPath,
    JSON.stringify({
      "deployment://provider/openai": secretPath,
    }),
  );
  return mapPath;
}

const baseEnvironment = {
  KANVAS_INSTANCE_ID: "worker-config-test",
  KANVAS_DATABASE_HOST: "127.0.0.1",
  KANVAS_DATABASE_NAME: "kanvas",
  KANVAS_DATABASE_USER: "kanvas",
  KANVAS_DATABASE_PASSWORD: "test-only",
  KANVAS_REDIS_HOST: "127.0.0.1",
  KANVAS_REDIS_PASSWORD: "test-only",
};

describe("worker deployment config", () => {
  it("supports Redis URLs and rejects conflicting or unsupported connection options", () => {
    const env = {
      ...baseEnvironment,
      KANVAS_REDIS_HOST: undefined,
      KANVAS_REDIS_PASSWORD: undefined,
      KANVAS_REDIS_URL: "redis://:p%40ss@redis.example:6380/109",
    };
    expect(loadWorkerConfig(env, []).redis).toEqual({
      host: "redis.example",
      port: 6380,
      db: 109,
      password: "p@ss",
    });
    expect(
      loadWorkerConfig(
        { ...env, KANVAS_REDIS_URL: "redis://:secret@redis.example" },
        [],
      ).redis,
    ).toEqual({ host: "redis.example", port: 6379, db: 0, password: "secret" });
    expect(() =>
      loadWorkerConfig({ ...env, KANVAS_REDIS_DB: "1" }, []),
    ).toThrow(/Do not combine/u);
    expect(
      loadWorkerConfig(
        {
          ...env,
          KANVAS_REDIS_URL: "rediss://kanvas:p%40ss@redis.example:6380/0",
        },
        [],
      ).redis,
    ).toEqual({
      host: "redis.example",
      port: 6380,
      db: 0,
      username: "kanvas",
      password: "p@ss",
      tls: { rejectUnauthorized: true },
    });
    for (const url of [
      "https://host/1",
      "redis://:secret@host/-1",
      "redis://:secret@host/1?db=2",
    ]) {
      expect(() =>
        loadWorkerConfig({ ...env, KANVAS_REDIS_URL: url }, []),
      ).toThrow(/Invalid KANVAS_REDIS_URL/u);
    }
  });
  it("defaults Redis to database zero and supports a deployment-selected database", () => {
    expect(loadWorkerConfig(baseEnvironment, []).redis.db).toBe(0);
    expect(
      loadWorkerConfig({ ...baseEnvironment, KANVAS_REDIS_DB: "12" }, []).redis
        .db,
    ).toBe(12);
  });

  it.each(["-1", "1.5", "NaN", "1e2", "9007199254740992"])(
    "rejects invalid Redis database %s",
    (database) => {
      expect(() =>
        loadWorkerConfig({ ...baseEnvironment, KANVAS_REDIS_DB: database }, []),
      ).toThrow(/KANVAS_REDIS_DB/u);
    },
  );

  it("initializes trusted image Storage for local and Provider execution roles", () => {
    expect(requiresTrustedImageStorageRuntime(["execution"])).toBe(true);
    expect(
      requiresTrustedImageStorageRuntime(["provider-execution", "reconciler"]),
    ).toBe(true);
    expect(requiresTrustedImageStorageRuntime(["maintenance"])).toBe(true);
    expect(requiresTrustedImageStorageRuntime(["orchestration"])).toBe(false);
  });

  it("requires orchestration and Storage for asynchronous persisted previews", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
        },
        ["--roles=orchestration"],
      ),
    ).toThrow(/require a configured Storage/u);

    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_MODEL_IMPORT_PROXY_URL: "http://127.0.0.1:7890",
        },
        ["--roles=orchestration,maintenance"],
      ),
    ).toMatchObject({
      artifactPreview: {
        mode: "async_persisted",
        fallbackOnMiss: true,
        workerConcurrency: 2,
      },
    });
  });

  it("parses and deduplicates explicit roles", () => {
    expect(
      loadWorkerConfig(baseEnvironment, [
        "--check-config",
        "--roles=execution,orchestration,execution",
      ]),
    ).toMatchObject({
      roles: ["execution", "orchestration"],
      checkConfigOnly: true,
      reconciler: {
        pollIntervalMs: 1000,
        staleAfterMs: 15_000,
        batchSize: 20,
      },
      execution: {
        leaseDurationMs: 30_000,
        heartbeatIntervalMs: 10_000,
        attemptTimeoutMs: 300_000,
      },
      agent: {
        runConcurrency: 4,
      },
      enabledExecutionTargets: ["worker"],
      workerAdapters: {
        deterministicImageEnabled: false,
      },
      provider: {
        fakeAdapterEnabled: false,
      },
    });
  });

  it("bounds Agent Run concurrency by the database pool with an absolute ceiling", () => {
    expect(
      loadWorkerConfig(
        { ...baseEnvironment, KANVAS_DATABASE_CONNECTION_LIMIT: "3" },
        [],
      ),
    ).toMatchObject({ agent: { runConcurrency: 1 } });

    expect(
      loadWorkerConfig(
        { ...baseEnvironment, KANVAS_AGENT_RUN_CONCURRENCY: "8" },
        [],
      ),
    ).toMatchObject({ agent: { runConcurrency: 8 } });
    expect(() =>
      loadWorkerConfig(
        { ...baseEnvironment, KANVAS_AGENT_RUN_CONCURRENCY: "9" },
        [],
      ),
    ).toThrow(/no greater than 8 for database connection limit 10/u);

    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_AGENT_RUN_CONCURRENCY: "32",
          KANVAS_DATABASE_CONNECTION_LIMIT: "40",
        },
        [],
      ),
    ).toMatchObject({ agent: { runConcurrency: 32 } });
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_AGENT_RUN_CONCURRENCY: "33",
          KANVAS_DATABASE_CONNECTION_LIMIT: "40",
        },
        [],
      ),
    ).toThrow(/no greater than 32 for database connection limit 40/u);
  });

  it("reads Worker roles from deployment configuration when no CLI override is provided", () => {
    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_WORKER_ROLES: "execution,orchestration,execution",
        },
        [],
      ),
    ).toMatchObject({
      roles: ["execution", "orchestration"],
    });
  });

  it("rejects unknown roles", () => {
    expect(() =>
      loadWorkerConfig(baseEnvironment, ["--roles=execution,unknown"]),
    ).toThrow(/Unknown worker role/u);
  });

  it("rejects a heartbeat interval that cannot renew before lease expiry", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ATTEMPT_LEASE_DURATION_MS: "10000",
          KANVAS_ATTEMPT_HEARTBEAT_INTERVAL_MS: "10000",
        },
        [],
      ),
    ).toThrow(/heartbeat interval must be shorter/u);
  });

  it("allows an unauthenticated local Redis in development", () => {
    const localEnvironment: Record<string, string> = {
      ...baseEnvironment,
    };
    delete localEnvironment.KANVAS_REDIS_PASSWORD;

    expect(loadWorkerConfig(localEnvironment, [])).toMatchObject({
      environment: "development",
      redis: {
        host: "127.0.0.1",
        port: 6379,
      },
    });
  });

  it("accepts direct production database and Redis secrets", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENVIRONMENT: "production",
        },
        [],
      ),
    ).not.toThrow();
  });

  it("treats blank optional numeric, boolean and Provider settings as omitted", () => {
    const env = {
      ...baseEnvironment,
      KANVAS_ENABLED_EXECUTION_TARGETS: "provider",
    };
    expect(
      loadWorkerConfig(
        {
          ...env,
          KANVAS_REDIS_DB: " ",
          KANVAS_ATTEMPT_TIMEOUT_MS: "",
          KANVAS_AGENT_RUN_CONCURRENCY: " ",
          KANVAS_PROVIDER_ALLOW_HTTP: " ",
          KANVAS_PROVIDER_ADAPTER_KEYS: "",
          KANVAS_PROVIDER_ALLOWED_ORIGINS: "",
          KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: " ",
          KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "",
        },
        [],
      ),
    ).toEqual(loadWorkerConfig(env, []));
  });

  it("loads the actual standalone image defaults through the Worker parser", () => {
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("KANVAS_") || key === "NODE_OPTIONS")
        delete environment[key];
    }
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        new URL("../../../deploy/runtime/standalone-env.mjs", import.meta.url)
          .href,
        "-e",
        "console.log(JSON.stringify(process.env))",
      ],
      {
        env: {
          ...environment,
          ...parseEnv(
            readFileSync(
              new URL("../../../deploy/.env.example", import.meta.url),
              "utf8",
            ),
          ),
        },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = loadWorkerConfig(
      JSON.parse(result.stdout) as NodeJS.ProcessEnv,
      [],
    );
    expect(config.storage?.profileId).toBe("01K00000000000000000000020");
    expect(config.roles).toContain("agent");
    expect(config.roles).toContain("provider-execution");
    expect(config.enabledExecutionTargets).toEqual(["worker", "provider"]);
    expect(config.provider.adapterKeys).toEqual(providerHttpAdapterKeys);
    expect(config.provider.allowPrivateNetworks).toBe(false);
    expect(config.provider.allowHttp).toBe(false);
    expect(config.provider.resultDownloadsEnabled).toBe(true);
  });

  it("uses installed Provider adapters by default and preserves explicit subsets", () => {
    const env = {
      ...baseEnvironment,
      KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
      KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.example.com",
    };
    expect(loadWorkerConfig(env, []).provider.adapterKeys).toEqual(
      providerHttpAdapterKeys,
    );
    expect(
      loadWorkerConfig(
        { ...env, KANVAS_PROVIDER_ADAPTER_KEYS: "openai.responses.v1" },
        [],
      ).provider.adapterKeys,
    ).toEqual(["openai.responses.v1"]);
    expect(() =>
      loadWorkerConfig({ ...env, KANVAS_PROVIDER_ADAPTER_KEYS: ",," }, []),
    ).toThrow(/configured Adapter/u);
  });

  it("rejects a delimiter-only malformed API origin restriction", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "provider",
          KANVAS_PROVIDER_ALLOWED_ORIGINS: ", ,",
        },
        [],
      ),
    ).toThrow(/must not be empty/u);
  });

  it("allows saved Provider endpoints without an extra origin overlay and keeps fake opt-in", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).not.toThrow();

    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
          KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED: "true",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).toMatchObject({
      roles: ["provider-execution", "reconciler"],
      enabledExecutionTargets: ["worker", "provider"],
      provider: {
        fakeAdapterEnabled: true,
      },
    });
  });

  it("does not allow the development canary Adapter in production", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENVIRONMENT: "production",
          KANVAS_DATABASE_PASSWORD: undefined,
          KANVAS_DATABASE_PASSWORD_FILE: "/etc/hosts",
          KANVAS_REDIS_PASSWORD: undefined,
          KANVAS_REDIS_PASSWORD_FILE: "/etc/hosts",
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
          KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED: "true",
        },
        ["--roles=provider-execution"],
      ),
    ).toThrow(/cannot be used in production/u);
  });

  it("enables the deterministic image Adapter only with execution and trusted Storage", () => {
    const localImageEnvironment = {
      ...baseEnvironment,
      KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED: "true",
      KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
      KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
      KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
        "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
    };

    expect(
      loadWorkerConfig(localImageEnvironment, ["--roles=execution"]),
    ).toMatchObject({
      workerAdapters: {
        deterministicImageEnabled: true,
      },
      storage: {
        kind: "local",
      },
    });
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED: "true",
        },
        ["--roles=execution"],
      ),
    ).toThrow(/trusted Storage profile/u);
    expect(() =>
      loadWorkerConfig(localImageEnvironment, ["--roles=orchestration"]),
    ).toThrow(/requires the execution role/u);
  });

  it("fails closed when the deterministic image Adapter is enabled in production", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENVIRONMENT: "production",
          KANVAS_DATABASE_PASSWORD: undefined,
          KANVAS_DATABASE_PASSWORD_FILE: "/etc/hosts",
          KANVAS_REDIS_PASSWORD: undefined,
          KANVAS_REDIS_PASSWORD_FILE: "/etc/hosts",
          KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED: "true",
        },
        ["--roles=execution"],
      ),
    ).toThrow(
      /KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED cannot be used in production/u,
    );
  });

  it("accepts a fixed real Provider Adapter with exact egress and secret maps", async () => {
    const mapPath = await secretMapFile();

    const config = loadWorkerConfig(
      {
        ...baseEnvironment,
        KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
        KANVAS_PROVIDER_ADAPTER_KEYS:
          "openai.responses.v1,openai-compatible.images.generations.v1,gemini.generate-content.image.v1,openai.responses.v1",
        KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.openai.com",
        KANVAS_PROVIDER_PROXY_URL: "http://127.0.0.1:7890",
        KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: mapPath,
      },
      ["--roles=provider-execution,reconciler"],
    );
    expect(config).toMatchObject({
      provider: {
        adapterKeys: [
          "openai.responses.v1",
          "openai-compatible.images.generations.v1",
          "gemini.generate-content.image.v1",
        ],
        allowedOrigins: ["https://api.openai.com"],
        resultDownloadsEnabled: true,
        proxyUrl: "http://127.0.0.1:7890",
        allowPrivateNetworks: false,
        allowHttp: false,
        maximumRequestBytes: 16_777_216,
        maximumResponseBytes: 33_554_432,
      },
    });
    expect(
      config.provider.deploymentSecretFiles["deployment://provider/openai"],
    ).toContain("openai-api-key");
  });

  it("defaults to result downloads while preserving explicit switch and origin restrictions", async () => {
    const mapPath = await secretMapFile();
    const environment = {
      ...baseEnvironment,
      KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
      KANVAS_PROVIDER_ADAPTER_KEYS: "generation-tasks.image.generate.v1",
      KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://us-api.tokenhub.com",
      KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: mapPath,
    };

    expect(() =>
      loadWorkerConfig(
        {
          ...environment,
          KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "true",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).not.toThrow();

    expect(
      loadWorkerConfig(
        { ...environment, KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "false" },
        [],
      ).provider.resultDownloadsEnabled,
    ).toBe(false);
    expect(() =>
      loadWorkerConfig(
        { ...environment, KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: ", ," },
        [],
      ),
    ).toThrow(/must not be empty/u);
    expect(() =>
      loadWorkerConfig(
        {
          ...environment,
          KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "true",
          KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: "https://v3b.fal.media/path",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).toThrow(/KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS must contain exact/u);

    expect(
      loadWorkerConfig(
        {
          ...environment,
          KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "true",
          KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS:
            "https://v3b.fal.media,https://v3b.fal.media",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).toMatchObject({
      provider: {
        allowedOrigins: ["https://us-api.tokenhub.com"],
        resultDownloadsEnabled: true,
        resultAllowedOrigins: ["https://v3b.fal.media"],
      },
    });
  });

  it("rejects unknown Adapters and imprecise origins while allowing database-backed secrets", async () => {
    const mapPath = await secretMapFile();
    const realProviderEnvironment = {
      ...baseEnvironment,
      KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
      KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.openai.com",
      KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: mapPath,
    };

    expect(() =>
      loadWorkerConfig(
        {
          ...realProviderEnvironment,
          KANVAS_PROVIDER_ADAPTER_KEYS: "untrusted.dynamic-adapter",
        },
        ["--roles=provider-execution"],
      ),
    ).toThrow(/Unknown Provider HTTP Adapter/u);
    expect(() =>
      loadWorkerConfig(
        {
          ...realProviderEnvironment,
          KANVAS_PROVIDER_ADAPTER_KEYS: "openai.responses.v1",
          KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.openai.com/v1",
        },
        ["--roles=provider-execution"],
      ),
    ).toThrow(/must contain exact HTTP\(S\) origins/u);
    expect(() =>
      loadWorkerConfig(
        {
          ...realProviderEnvironment,
          KANVAS_PROVIDER_ADAPTER_KEYS: "openai.responses.v1",
          KANVAS_PROVIDER_PROXY_URL: "http://user:secret@127.0.0.1:7890/path",
        },
        ["--roles=provider-execution"],
      ),
    ).toThrow(/exact HTTP\(S\) origin without credentials/u);
    expect(() =>
      loadWorkerConfig(
        {
          ...realProviderEnvironment,
          KANVAS_PROVIDER_ADAPTER_KEYS: "openai.responses.v1",
          KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: undefined,
        },
        ["--roles=provider-execution"],
      ),
    ).not.toThrow();
  });

  it("requires an explicit production acknowledgement for private or HTTP Provider egress", async () => {
    const mapPath = await secretMapFile();
    const productionEnvironment = {
      ...baseEnvironment,
      KANVAS_ENVIRONMENT: "production",
      KANVAS_DATABASE_PASSWORD: undefined,
      KANVAS_DATABASE_PASSWORD_FILE: "/etc/hosts",
      KANVAS_REDIS_PASSWORD: undefined,
      KANVAS_REDIS_PASSWORD_FILE: "/etc/hosts",
      KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
      KANVAS_PROVIDER_ADAPTER_KEYS: "openai-compatible.responses.v1",
      KANVAS_PROVIDER_ALLOWED_ORIGINS: "http://provider.internal",
      KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: mapPath,
      KANVAS_PROVIDER_ALLOW_HTTP: "true",
      KANVAS_PROVIDER_ALLOW_PRIVATE_NETWORKS: "true",
    };

    expect(() =>
      loadWorkerConfig(productionEnvironment, ["--roles=provider-execution"]),
    ).toThrow(/unsafe-network acknowledgement/u);
    expect(
      loadWorkerConfig(
        {
          ...productionEnvironment,
          KANVAS_PROVIDER_UNSAFE_NETWORK_ACK:
            "I_ACKNOWLEDGE_PRIVATE_PROVIDER_EGRESS",
        },
        ["--roles=provider-execution,reconciler"],
      ),
    ).toMatchObject({
      environment: "production",
      provider: {
        allowHttp: true,
        allowPrivateNetworks: true,
      },
    });
  });

  it("parses a single-node Local Storage maintenance profile only with explicit trust acknowledgement", () => {
    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_MODEL_IMPORT_PROXY_URL: "http://127.0.0.1:7890",
        },
        ["--roles=maintenance"],
      ),
    ).toMatchObject({
      storage: {
        kind: "local",
        profileId: "01K00000000000000000000020",
        rootDirectory: "/var/lib/kanvas/objects",
        garbageCollection: {
          pollIntervalMs: 5_000,
          claimLeaseMs: 30_000,
          baseRetryMs: 5_000,
          maximumRetryMs: 300_000,
        },
        modelImport: {
          proxyUrl: "http://127.0.0.1:7890",
        },
      },
    });
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
        },
        ["--roles=maintenance"],
      ),
    ).toThrow(/trusted-root acknowledgement/u);
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_MODEL_IMPORT_PROXY_URL:
            "http://user:secret@127.0.0.1:7890/path",
        },
        ["--roles=maintenance"],
      ),
    ).toThrow(/KANVAS_MODEL_IMPORT_PROXY_URL.*without credentials/u);
  });

  it("parses the same S3-compatible maintenance profile as the Server", () => {
    expect(
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_S3_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_S3_ENDPOINT: "https://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
          KANVAS_S3_FORCE_PATH_STYLE: "false",
          KANVAS_S3_ACCESS_KEY_ID: "development-access",
          KANVAS_S3_SECRET_ACCESS_KEY: "development-secret",
          KANVAS_S3_SERVER_SIDE_ENCRYPTION: "AES256",
        },
        ["--roles=maintenance"],
      ),
    ).toMatchObject({
      storage: {
        kind: "s3",
        profileId: "01K00000000000000000000020",
        endpoint: "https://objects.example.com",
        region: "us-east-1",
        container: "kanvas-objects",
        forcePathStyle: false,
        encryption: { mode: "AES256" },
        garbageCollection: {
          pollIntervalMs: 5_000,
          claimLeaseMs: 30_000,
          baseRetryMs: 5_000,
          maximumRetryMs: 300_000,
        },
      },
    });
  });

  it("fails config-only validation when Local Storage GC retry bounds are inverted", () => {
    expect(() =>
      loadWorkerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/objects",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_STORAGE_GC_BASE_RETRY_MS: "6000",
          KANVAS_STORAGE_GC_MAX_RETRY_MS: "5000",
        },
        ["--check-config", "--roles=maintenance"],
      ),
    ).toThrow(/cannot be below/u);
  });
});
