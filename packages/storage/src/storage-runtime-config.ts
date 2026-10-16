import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import type {
  S3CompatibleEncryption,
  S3CompatibleStaticCredentials,
} from "./s3-compatible-adapter.js";

export type StorageEnvironment = "development" | "test" | "production";

export interface LocalStorageAdapterConfig {
  readonly kind: "local";
  readonly profileId: string;
  readonly container: "objects";
  readonly rootDirectory: string;
}

export interface S3StorageAdapterConfig {
  readonly kind: "s3";
  readonly profileId: string;
  readonly container: string;
  readonly endpoint: string;
  readonly keyPrefix?: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
  readonly stagingDirectory?: string;
  readonly credentials?: S3CompatibleStaticCredentials;
  readonly encryption: S3CompatibleEncryption;
}

export interface OssStorageAdapterConfig {
  readonly kind: "oss";
  readonly profileId: string;
  readonly container: string;
  readonly endpoint: string;
  readonly region: string;
  readonly keyPrefix: string;
  readonly stagingDirectory?: string;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly accessKeySecret: string;
    readonly securityToken?: string;
  };
}
export type StorageAdapterConfig =
  LocalStorageAdapterConfig | S3StorageAdapterConfig | OssStorageAdapterConfig;

function loadOssConfig(
  environment: NodeJS.ProcessEnv,
): OssStorageAdapterConfig {
  if (
    Object.entries(environment).some(
      ([key, value]) =>
        Boolean(value) && /^KANVAS_(?:S3|LOCAL_STORAGE)_/u.test(key),
    )
  )
    throw new Error(
      "OSS settings cannot be combined with another Storage provider.",
    );
  const required = (name: string) => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const profileId = required("KANVAS_OSS_STORAGE_PROFILE_ID");
  const container = required("KANVAS_OSS_BUCKET");
  const endpoint = required("KANVAS_OSS_ENDPOINT");
  const region = required("KANVAS_OSS_REGION");
  const keyPrefix = required("KANVAS_OSS_KEY_PREFIX");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid KANVAS_OSS_ENDPOINT.");
  }
  if (
    !ulidPattern.test(profileId) ||
    !bucketPattern.test(container) ||
    !regionPattern.test(region) ||
    !/^(?:[A-Za-z0-9_-]+\/)+$/u.test(keyPrefix) ||
    keyPrefix.length > 200 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid OSS profile, endpoint or prefix configuration.");
  const stagingDirectory = environment.KANVAS_OSS_STAGING_DIRECTORY?.trim();
  if (stagingDirectory && !isAbsolute(stagingDirectory))
    throw new Error("KANVAS_OSS_STAGING_DIRECTORY must be absolute.");
  const securityToken = environment.KANVAS_OSS_SECURITY_TOKEN;
  return {
    kind: "oss",
    profileId,
    container,
    endpoint: url.origin,
    region,
    keyPrefix,
    ...(stagingDirectory ? { stagingDirectory } : {}),
    credentials: {
      accessKeyId: required("KANVAS_OSS_ACCESS_KEY_ID"),
      accessKeySecret: required("KANVAS_OSS_ACCESS_KEY_SECRET"),
      ...(securityToken ? { securityToken } : {}),
    },
  };
}

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const bucketPattern = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/u;
const regionPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/u;

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

function present(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): boolean {
  return names.some((name) => Boolean(environment[name]?.trim()));
}

function readMountedSecret(path: string, name: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${name} must be an absolute mounted file path.`);
  }
  const value = readFileSync(path, "utf8").trim();
  if (!value) {
    throw new Error(`${name} is empty.`);
  }
  return value;
}

function parseStaticCredentials(
  environment: NodeJS.ProcessEnv,
): S3CompatibleStaticCredentials | undefined {
  const directAccessKey = environment.KANVAS_S3_ACCESS_KEY_ID?.trim();
  const directSecretKey = environment.KANVAS_S3_SECRET_ACCESS_KEY?.trim();
  const directSessionToken = environment.KANVAS_S3_SESSION_TOKEN?.trim();
  const accessKeyFile = environment.KANVAS_S3_ACCESS_KEY_ID_FILE?.trim();
  const secretKeyFile = environment.KANVAS_S3_SECRET_ACCESS_KEY_FILE?.trim();
  const sessionTokenFile = environment.KANVAS_S3_SESSION_TOKEN_FILE?.trim();
  const hasDirect = Boolean(
    directAccessKey || directSecretKey || directSessionToken,
  );
  const hasFiles = Boolean(accessKeyFile || secretKeyFile || sessionTokenFile);
  if (hasDirect && hasFiles) {
    throw new Error(
      "S3 static credentials must use either direct development values or mounted files, never both.",
    );
  }

  if (!hasDirect && !hasFiles) {
    return undefined;
  }
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;
  let sessionToken: string | undefined;
  if (hasFiles) {
    if (!accessKeyFile || !secretKeyFile) {
      throw new Error(
        "KANVAS_S3_ACCESS_KEY_ID_FILE and KANVAS_S3_SECRET_ACCESS_KEY_FILE must be configured together.",
      );
    }
    accessKeyId = readMountedSecret(
      accessKeyFile,
      "KANVAS_S3_ACCESS_KEY_ID_FILE",
    );
    secretAccessKey = readMountedSecret(
      secretKeyFile,
      "KANVAS_S3_SECRET_ACCESS_KEY_FILE",
    );
    sessionToken = sessionTokenFile
      ? readMountedSecret(sessionTokenFile, "KANVAS_S3_SESSION_TOKEN_FILE")
      : undefined;
  } else {
    if (!directAccessKey || !directSecretKey) {
      throw new Error(
        "KANVAS_S3_ACCESS_KEY_ID and KANVAS_S3_SECRET_ACCESS_KEY must be configured together.",
      );
    }
    accessKeyId = directAccessKey;
    secretAccessKey = directSecretKey;
    sessionToken = directSessionToken;
  }
  if (
    accessKeyId.length > 256 ||
    secretAccessKey.length > 2_048 ||
    (sessionToken?.length ?? 0) > 8_192
  ) {
    throw new Error("S3 static credential material exceeds its boundary.");
  }
  return Object.freeze({
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  });
}

function parseS3Endpoint(
  value: string,
  environment: NodeJS.ProcessEnv,
  environmentName: StorageEnvironment,
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("KANVAS_S3_ENDPOINT must be an absolute HTTP(S) origin.");
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    !["http:", "https:"].includes(endpoint.protocol)
  ) {
    throw new Error(
      "KANVAS_S3_ENDPOINT must be an exact HTTP(S) origin without credentials, path, query or fragment.",
    );
  }
  if (
    environmentName === "production" &&
    endpoint.protocol !== "https:" &&
    environment.KANVAS_S3_UNSAFE_HTTP_ACK?.trim() !==
      "I_ACKNOWLEDGE_UNENCRYPTED_S3_TRANSPORT"
  ) {
    throw new Error(
      "Production S3 endpoints must use HTTPS unless the explicit unsafe transport acknowledgement is set.",
    );
  }
  return endpoint.origin;
}

function parseEncryption(
  environment: NodeJS.ProcessEnv,
): S3CompatibleEncryption {
  const mode = environment.KANVAS_S3_SERVER_SIDE_ENCRYPTION?.trim() || "none";
  const kmsKeyId = environment.KANVAS_S3_KMS_KEY_ID?.trim();
  if (mode === "none") {
    if (kmsKeyId) {
      throw new Error(
        "KANVAS_S3_KMS_KEY_ID requires aws:kms server-side encryption.",
      );
    }
    return Object.freeze({ mode: "none" });
  }
  if (mode === "AES256") {
    if (kmsKeyId) {
      throw new Error(
        "KANVAS_S3_KMS_KEY_ID cannot be used with AES256 encryption.",
      );
    }
    return Object.freeze({ mode: "AES256" });
  }
  if (mode === "aws:kms") {
    if (
      !kmsKeyId ||
      kmsKeyId.length > 2_048 ||
      [...kmsKeyId].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    ) {
      throw new Error(
        "KANVAS_S3_KMS_KEY_ID is required for aws:kms encryption.",
      );
    }
    return Object.freeze({
      mode: "aws:kms",
      kmsKeyId,
    });
  }
  throw new Error(
    "KANVAS_S3_SERVER_SIDE_ENCRYPTION must be none, AES256 or aws:kms.",
  );
}

export function loadStorageAdapterConfig(
  environment: NodeJS.ProcessEnv,
  environmentName: StorageEnvironment,
): StorageAdapterConfig | undefined {
  if (environment.KANVAS_STORAGE_KIND === "oss")
    return loadOssConfig(environment);
  if (
    Object.keys(environment).some(
      (key) => /^KANVAS_(?:OSS)_/u.test(key) && environment[key],
    )
  )
    throw new Error("OSS configuration requires KANVAS_STORAGE_KIND=oss.");
  const localNames = [
    "KANVAS_LOCAL_STORAGE_ROOT",
    "KANVAS_LOCAL_STORAGE_PROFILE_ID",
    "KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK",
  ] as const;
  const s3Names = [
    "KANVAS_S3_ENDPOINT",
    "KANVAS_S3_REGION",
    "KANVAS_S3_BUCKET",
    "KANVAS_S3_STORAGE_PROFILE_ID",
    "KANVAS_S3_FORCE_PATH_STYLE",
    "KANVAS_S3_ACCESS_KEY_ID",
    "KANVAS_S3_SECRET_ACCESS_KEY",
    "KANVAS_S3_SESSION_TOKEN",
    "KANVAS_S3_ACCESS_KEY_ID_FILE",
    "KANVAS_S3_SECRET_ACCESS_KEY_FILE",
    "KANVAS_S3_SESSION_TOKEN_FILE",
    "KANVAS_S3_SERVER_SIDE_ENCRYPTION",
    "KANVAS_S3_KMS_KEY_ID",
    "KANVAS_S3_STAGING_DIRECTORY",
  ] as const;
  const hasLocal = present(environment, localNames);
  const hasS3 = present(environment, s3Names);
  const configuredKind = environment.KANVAS_STORAGE_KIND?.trim();
  let kind: "local" | "s3" | undefined;
  if (configuredKind) {
    if (configuredKind !== "local" && configuredKind !== "s3") {
      throw new Error("KANVAS_STORAGE_KIND must be local or s3.");
    }
    kind = configuredKind;
  } else if (hasLocal && !hasS3) {
    kind = "local";
  } else if (hasS3 && !hasLocal) {
    kind = "s3";
  } else if (hasLocal || hasS3) {
    throw new Error(
      "KANVAS_STORAGE_KIND is required when Local and S3 settings are both present.",
    );
  }
  if (!kind) {
    return undefined;
  }
  if (kind === "local") {
    if (hasS3) {
      throw new Error(
        "S3 settings cannot be configured for a Local Storage profile.",
      );
    }
    const rootDirectory = environment.KANVAS_LOCAL_STORAGE_ROOT?.trim();
    const profileId = environment.KANVAS_LOCAL_STORAGE_PROFILE_ID?.trim();
    if (
      !rootDirectory ||
      !profileId ||
      environment.KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK?.trim() !==
        "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT" ||
      !isAbsolute(rootDirectory) ||
      !ulidPattern.test(profileId)
    ) {
      throw new Error(
        "Local storage requires an absolute KANVAS_LOCAL_STORAGE_ROOT, a canonical KANVAS_LOCAL_STORAGE_PROFILE_ID and the trusted-root acknowledgement.",
      );
    }
    return Object.freeze({
      kind: "local",
      profileId,
      container: "objects",
      rootDirectory,
    });
  }
  if (hasLocal) {
    throw new Error(
      "Local settings cannot be configured for an S3 Storage profile.",
    );
  }
  const endpoint = environment.KANVAS_S3_ENDPOINT?.trim();
  const region = environment.KANVAS_S3_REGION?.trim();
  const bucket = environment.KANVAS_S3_BUCKET?.trim();
  const profileId = environment.KANVAS_S3_STORAGE_PROFILE_ID?.trim();
  const keyPrefix = environment.KANVAS_S3_KEY_PREFIX;
  if (
    keyPrefix &&
    (!/^(?:[A-Za-z0-9_-]+\/)+$/u.test(keyPrefix) || keyPrefix.length > 200)
  )
    throw new Error(
      "KANVAS_S3_KEY_PREFIX must contain safe path segments and end with a slash.",
    );
  const stagingDirectory = environment.KANVAS_S3_STAGING_DIRECTORY?.trim();
  if (
    !endpoint ||
    !region ||
    !bucket ||
    !profileId ||
    !regionPattern.test(region) ||
    !bucketPattern.test(bucket) ||
    !ulidPattern.test(profileId) ||
    (stagingDirectory && !isAbsolute(stagingDirectory))
  ) {
    throw new Error(
      "S3 storage requires a canonical profile ID, endpoint origin, region, bucket and optional absolute staging directory.",
    );
  }
  const credentials = parseStaticCredentials(environment);
  return Object.freeze({
    kind: "s3",
    profileId,
    container: bucket,
    ...(keyPrefix ? { keyPrefix } : {}),
    endpoint: parseS3Endpoint(endpoint, environment, environmentName),
    region,
    forcePathStyle: parseBoolean(
      environment.KANVAS_S3_FORCE_PATH_STYLE,
      true,
      "KANVAS_S3_FORCE_PATH_STYLE",
    ),
    encryption: parseEncryption(environment),
    ...(stagingDirectory ? { stagingDirectory } : {}),
    ...(credentials ? { credentials } : {}),
  });
}

export function storageAdapterPublicConfiguration(
  config: StorageAdapterConfig,
): Readonly<Record<string, unknown>> {
  if (config.kind === "local") {
    return Object.freeze({
      kind: config.kind,
      profileId: config.profileId,
      container: config.container,
      rootDirectory: config.rootDirectory,
    });
  }
  if (config.kind === "oss")
    return Object.freeze({
      kind: config.kind,
      profileId: config.profileId,
      container: config.container,
      endpoint: config.endpoint,
      region: config.region,
      keyPrefix: config.keyPrefix,
      ...(config.stagingDirectory
        ? { stagingDirectory: config.stagingDirectory }
        : {}),
    });
  return Object.freeze({
    kind: config.kind,
    profileId: config.profileId,
    container: config.container,
    endpoint: config.endpoint,
    ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    encryption: config.encryption,
    ...(config.stagingDirectory
      ? { stagingDirectory: config.stagingDirectory }
      : {}),
  });
}
