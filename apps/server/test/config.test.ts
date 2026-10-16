import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadServerConfig } from "../src/config.js";

const baseEnvironment = {
  KANVAS_INSTANCE_ID: "server-config-test",
  KANVAS_DATABASE_HOST: "127.0.0.1",
  KANVAS_DATABASE_NAME: "kanvas",
  KANVAS_DATABASE_USER: "kanvas",
  KANVAS_DATABASE_PASSWORD: "test-only",
  KANVAS_AUTH_SECRET: "test-only-auth-secret-that-is-at-least-32-characters",
};

describe("server deployment config", () => {
  it("loads the deployment download rule used by original-file links", () => {
    expect(
      loadServerConfig(baseEnvironment, []).resultDownloadDeployment,
    ).toEqual({ enabled: true, allowedOrigins: null });
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "false",
          KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS:
            "https://cdn.example, https://cdn.example/",
        },
        [],
      ).resultDownloadDeployment,
    ).toEqual({ enabled: false, allowedOrigins: ["https://cdn.example"] });
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: "https://cdn.example/path",
        },
        [],
      ),
    ).toThrow(/exact HTTP/);
  });
  it("treats blank optional port, timing and boolean settings as omitted", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_HTTP_PORT: "",
          KANVAS_CANCEL_GRACE_MS: " ",
          KANVAS_AUTH_SESSION_EXPIRES_IN_SECONDS: " ",
          KANVAS_DEMO_MODE: " ",
        },
        [],
      ),
    ).toEqual(loadServerConfig(baseEnvironment, []));
  });

  it("accepts the minimal official deployment with durable default storage and optional KEK", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("KANVAS_") || key === "NODE_OPTIONS") delete env[key];
    }
    const example = parseEnv(
      readFileSync(
        new URL("../../../deploy/.env.example", import.meta.url),
        "utf8",
      ),
    );
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
          ...env,
          ...example,
          KANVAS_AUTH_SECRET: baseEnvironment.KANVAS_AUTH_SECRET,
        },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = loadServerConfig(
      JSON.parse(result.stdout) as NodeJS.ProcessEnv,
      ["--check-config"],
    );
    expect(config.environment).toBe("production");
    expect(config.instanceId).toBe("kanvas");
    expect(config.storage).toMatchObject({
      kind: "local",
      profileId: "01K00000000000000000000020",
      rootDirectory: "/var/lib/kanvas/objects",
    });
    expect(config.enabledExecutionTargets).toEqual(["worker", "provider"]);
    expect(config.providerSecrets.activeKekVersion).toBeUndefined();
    expect(config.trustedProxyHops).toBe(1);
  });

  it("parses the check-only composition", () => {
    expect(loadServerConfig(baseEnvironment, ["--check-config"])).toMatchObject(
      {
        environment: "development",
        instanceId: "server-config-test",
        port: 3000,
        trustedProxyHops: 0,
        cancellationGraceMs: 30_000,
        enabledExecutionTargets: ["worker"],
        browserExecutor: {
          enabled: false,
          controlPlaneVersion: 1,
          sessionTtlSeconds: 3_600,
          attemptLeaseDurationMs: 30_000,
          candidateLimit: 20,
        },
        artifactPreview: {
          mode: "on_demand",
          fallbackOnMiss: true,
          width: 640,
          height: 640,
        },
        auth: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secureCookies: false,
          sessionExpiresInSeconds: 604_800,
          sessionUpdateAgeSeconds: 86_400,
        },
        checkConfigOnly: true,
      },
    );
  });

  it("accepts only a bounded explicit reverse-proxy hop count", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_HTTP_TRUSTED_PROXY_HOPS: "1",
        },
        [],
      ).trustedProxyHops,
    ).toBe(1);
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_HTTP_TRUSTED_PROXY_HOPS: "5",
        },
        [],
      ),
    ).toThrow(/KANVAS_HTTP_TRUSTED_PROXY_HOPS/u);
  });

  it("configures verified email delivery through SMTP or a development outbox", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
          KANVAS_AUTH_EMAIL_SMTP_PORT: "465",
          KANVAS_AUTH_EMAIL_SMTP_SECURE: "true",
          KANVAS_AUTH_EMAIL_SMTP_REQUIRE_TLS: "true",
          KANVAS_AUTH_EMAIL_SMTP_USER: "kanvas",
          KANVAS_AUTH_EMAIL_SMTP_PASSWORD: "development-mail-secret",
          KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@example.com",
          KANVAS_AUTH_EMAIL_FROM_NAME: "Kanvas Workspace",
        },
        [],
      ).auth.emailVerificationDelivery,
    ).toEqual({
      kind: "smtp",
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTls: true,
      fromAddress: "kanvas@example.com",
      fromName: "Kanvas Workspace",
      authentication: {
        user: "kanvas",
        password: "development-mail-secret",
      },
    });

    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE:
            "/tmp/kanvas-verification-outbox.jsonl",
        },
        [],
      ).auth.emailVerificationDelivery,
    ).toEqual({
      kind: "development_outbox",
      file: "/tmp/kanvas-verification-outbox.jsonl",
      fromAddress: "kanvas@localhost.invalid",
      fromName: "Kanvas",
    });
  });

  it("fails closed for partial or unsafe email delivery configuration", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
          KANVAS_AUTH_EMAIL_SMTP_USER: "kanvas",
          KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@example.com",
        },
        [],
      ),
    ).toThrow(/configured together/u);
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE: "relative/outbox.jsonl",
        },
        [],
      ),
    ).toThrow(/absolute path/u);
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
          KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE: "/tmp/outbox.jsonl",
          KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@example.com",
        },
        [],
      ),
    ).toThrow(/not both/u);
  });

  it("supports environment and mounted SMTP credentials in production", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanvas-smtp-secret-"));
    const passwordFile = join(directory, "password");
    const authSecretFile = join(directory, "auth-secret");
    const databasePasswordFile = join(directory, "database-secret");
    writeFileSync(passwordFile, "smtp-secret\n");
    writeFileSync(
      authSecretFile,
      "production-auth-secret-that-is-at-least-32-characters\n",
    );
    writeFileSync(databasePasswordFile, "database-secret\n");
    try {
      expect(() =>
        loadServerConfig(
          {
            ...baseEnvironment,
            KANVAS_ENVIRONMENT: "production",
            KANVAS_DATABASE_PASSWORD: undefined,
            KANVAS_DATABASE_PASSWORD_FILE: databasePasswordFile,
            KANVAS_AUTH_SECRET: undefined,
            KANVAS_AUTH_SECRET_FILE: authSecretFile,
            KANVAS_AUTH_BASE_URL: "https://kanvas.example.com",
            KANVAS_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
            KANVAS_AUTH_EMAIL_SMTP_USER: "kanvas",
            KANVAS_AUTH_EMAIL_SMTP_PASSWORD: "direct-secret",
            KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@example.com",
          },
          [],
        ),
      ).not.toThrow();
      expect(
        loadServerConfig(
          {
            ...baseEnvironment,
            KANVAS_ENVIRONMENT: "production",
            KANVAS_DATABASE_PASSWORD: undefined,
            KANVAS_DATABASE_PASSWORD_FILE: databasePasswordFile,
            KANVAS_AUTH_SECRET: undefined,
            KANVAS_AUTH_SECRET_FILE: authSecretFile,
            KANVAS_AUTH_BASE_URL: "https://kanvas.example.com",
            KANVAS_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
            KANVAS_AUTH_EMAIL_SMTP_USER: "kanvas",
            KANVAS_AUTH_EMAIL_SMTP_PASSWORD_FILE: passwordFile,
            KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@example.com",
          },
          [],
        ).auth.emailVerificationDelivery,
      ).toMatchObject({ kind: "smtp" });
      expect(() =>
        loadServerConfig(
          {
            ...baseEnvironment,
            KANVAS_ENVIRONMENT: "production",
            KANVAS_DATABASE_PASSWORD: undefined,
            KANVAS_DATABASE_PASSWORD_FILE: databasePasswordFile,
            KANVAS_AUTH_SECRET: undefined,
            KANVAS_AUTH_SECRET_FILE: authSecretFile,
            KANVAS_AUTH_BASE_URL: "https://kanvas.example.com",
            KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE: "/tmp/outbox.jsonl",
          },
          [],
        ),
      ).toThrow(/cannot be used in production/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires Storage when persisted Artifact previews are enabled", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
        },
        ["--check-config"],
      ),
    ).toThrow(/require a configured Storage profile/u);
  });

  it("accepts an explicit bounded cancellation grace period", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_CANCEL_GRACE_MS: "45000",
        },
        [],
      ),
    ).toMatchObject({
      cancellationGraceMs: 45_000,
    });
  });

  it("accepts only an exact HTTP(S) Provider proxy origin", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_PROVIDER_PROXY_URL: "http://127.0.0.1:7897",
        },
        [],
      ).providerProxyUrl,
    ).toBe("http://127.0.0.1:7897");

    for (const value of [
      "socks5://127.0.0.1:7897",
      "http://user:secret@127.0.0.1:7897",
      "http://127.0.0.1:7897/path",
      "http://127.0.0.1:7897?token=secret",
    ]) {
      expect(() =>
        loadServerConfig(
          {
            ...baseEnvironment,
            KANVAS_PROVIDER_PROXY_URL: value,
          },
          [],
        ),
      ).toThrow(/KANVAS_PROVIDER_PROXY_URL/u);
    }
  });

  it("parses bounded Provider route deployment policy only when configured", () => {
    const config = loadServerConfig(
      {
        ...baseEnvironment,
        KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON: JSON.stringify({
          allowedAdapterKinds: ["openai_native"],
          allowedPresetKinds: ["openai"],
          allowedRegionCodes: ["global"],
          allowedProviderEndpointIds: ["01K0000000000000000000003A"],
          allowedRoutingModes: ["kanvas_fixed"],
          allowedExecutionTransparencies: ["full"],
          maximumCharge: {
            currencyCode: "USD",
            amount: "2",
          },
          maxProviderRequestSeconds: 180,
        }),
      },
      [],
    );

    expect(config.providerDeploymentHardBounds).toEqual({
      allowedAdapterKinds: ["openai_native"],
      allowedPresetKinds: ["openai"],
      allowedRegionCodes: ["global"],
      allowedProviderEndpointIds: ["01K0000000000000000000003A"],
      allowedRoutingModes: ["kanvas_fixed"],
      allowedExecutionTransparencies: ["full"],
      maximumCharge: {
        currencyCode: "USD",
        amount: "2",
      },
      maxProviderRequestSeconds: 180,
    });
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON: "{invalid",
        },
        [],
      ),
    ).toThrow(/KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON/u);
  });

  it("parses an explicitly acknowledged Local Storage profile", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/storage",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_STORAGE_MAX_INPUT_BYTES: "67108864",
          KANVAS_STORAGE_USER_IMPORT_TTL_MS: "7200000",
        },
        [],
      ).storage,
    ).toMatchObject({
      kind: "local",
      profileId: "01K00000000000000000000020",
      rootDirectory: "/var/lib/kanvas/storage",
      container: "objects",
      verificationProfileVersion: "trusted-image-structural-v1",
      verificationLeaseMilliseconds: 120_000,
      cleanupGraceMilliseconds: 3_600_000,
      userImportSessionTtlMilliseconds: 7_200_000,
      verificationLimits: {
        maximumInputBytes: 67_108_864,
        requireDecodedVerification: false,
      },
    });
  });

  it("parses an S3-compatible distributed Storage profile without hashing credentials", () => {
    const config = loadServerConfig(
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
        KANVAS_S3_STAGING_DIRECTORY: "/tmp/kanvas-s3",
      },
      [],
    );

    expect(config.storage).toMatchObject({
      kind: "s3",
      profileId: "01K00000000000000000000020",
      endpoint: "https://objects.example.com",
      region: "us-east-1",
      container: "kanvas-objects",
      forcePathStyle: false,
      stagingDirectory: "/tmp/kanvas-s3",
      encryption: { mode: "AES256" },
      credentials: {
        accessKeyId: "development-access",
        secretAccessKey: "development-secret",
      },
      verificationProfileVersion: "trusted-image-structural-v1",
    });
    expect(config.storage?.profileConfigurationHash).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    const withoutCredentials = loadServerConfig(
      {
        ...baseEnvironment,
        KANVAS_STORAGE_KIND: "s3",
        KANVAS_S3_STORAGE_PROFILE_ID: "01K00000000000000000000020",
        KANVAS_S3_ENDPOINT: "https://objects.example.com",
        KANVAS_S3_REGION: "us-east-1",
        KANVAS_S3_BUCKET: "kanvas-objects",
        KANVAS_S3_FORCE_PATH_STYLE: "false",
        KANVAS_S3_SERVER_SIDE_ENCRYPTION: "AES256",
        KANVAS_S3_STAGING_DIRECTORY: "/tmp/kanvas-s3",
      },
      [],
    );
    expect(withoutCredentials.storage?.profileConfigurationHash).toBe(
      config.storage?.profileConfigurationHash,
    );
  });

  it("rejects a partial or unacknowledged Local Storage profile", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/storage",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
        },
        [],
      ),
    ).toThrow(/trusted-root acknowledgement/u);
  });

  it("rejects a User Import lifetime outside the bounded storage window", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_LOCAL_STORAGE_ROOT: "/var/lib/kanvas/storage",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
          KANVAS_STORAGE_USER_IMPORT_TTL_MS: "299999",
        },
        [],
      ),
    ).toThrow(/KANVAS_STORAGE_USER_IMPORT_TTL_MS/u);
  });

  it.each(["999", "3600001", "1000.5", "not-a-number"])(
    "rejects invalid cancellation grace value %s",
    (value) => {
      expect(() =>
        loadServerConfig(
          {
            ...baseEnvironment,
            KANVAS_CANCEL_GRACE_MS: value,
          },
          [],
        ),
      ).toThrow(/KANVAS_CANCEL_GRACE_MS/u);
    },
  );

  it("accepts direct production database secrets", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENVIRONMENT: "production",
          KANVAS_AUTH_BASE_URL: "https://kanvas.example.com",
        },
        [],
      ),
    ).not.toThrow();
  });

  it("parses the same explicit execution-target gate as the worker", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,browser",
          KANVAS_BROWSER_RUNTIME_RELEASE_ID: "01K00000000000000000000010",
          KANVAS_BROWSER_RUNTIME_RELEASE_DIGEST:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        [],
      ),
    ).toMatchObject({
      enabledExecutionTargets: ["worker", "browser"],
      browserExecutor: {
        enabled: true,
        runtimeReleaseId: "01K00000000000000000000010",
        runtimeReleaseDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,unknown",
        },
        [],
      ),
    ).toThrow(/Unknown execution target/u);
  });

  it("fails closed when the enabled browser target lacks a pinned runtime", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENABLED_EXECUTION_TARGETS: "worker,browser",
        },
        [],
      ),
    ).toThrow(/KANVAS_BROWSER_RUNTIME_RELEASE_ID/u);

    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_BROWSER_RUNTIME_RELEASE_ID: "01K00000000000000000000010",
        },
        [],
      ),
    ).toThrow(/target is disabled/u);
  });

  it("accepts exact trusted origins and rejects path or wildcard trust", () => {
    expect(
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_BASE_URL: "http://127.0.0.1:3000",
          KANVAS_AUTH_TRUSTED_ORIGINS:
            "http://localhost:5173,http://127.0.0.1:3000",
        },
        [],
      ).auth.trustedOrigins,
    ).toEqual(["http://127.0.0.1:3000", "http://localhost:5173"]);

    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_TRUSTED_ORIGINS: "https://*.example.com",
        },
        [],
      ),
    ).toThrow(/exact origins/u);
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_TRUSTED_ORIGINS: "http://localhost:5173/path",
        },
        [],
      ),
    ).toThrow(/exact origins/u);
  });

  it("requires a strong auth secret and rejects missing secret files", () => {
    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_AUTH_SECRET: "too-short",
        },
        [],
      ),
    ).toThrow(/at least 32/u);

    expect(() =>
      loadServerConfig(
        {
          ...baseEnvironment,
          KANVAS_ENVIRONMENT: "production",
          KANVAS_DATABASE_PASSWORD: undefined,
          KANVAS_DATABASE_PASSWORD_FILE: "/definitely/missing/database-secret",
          KANVAS_AUTH_BASE_URL: "https://kanvas.example.com",
        },
        [],
      ),
    ).toThrow();
  });
});
