import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import type { StoragePort } from "@kanvas/application";
import {
  loadDatabaseConnectionConfig,
  readMigrationInventory,
} from "@kanvas/database";
import type { PinnedSecretVersionMetadata } from "@kanvas/database/runtime";
import {
  createProviderSecretMaterialResolver,
  loadProviderSecretFileMaps,
} from "@kanvas/secrets";
import {
  createAwsS3CompatibleStorageAdapter,
  createAliyunOssStorageAdapter,
  createLocalFilesystemStorageAdapter,
  loadStorageAdapterConfig,
} from "@kanvas/storage";
import { createPool, type Pool } from "mysql2/promise";
import { ulid } from "ulid";

import type {
  BackupMigrationEntry,
  BackupSetManifestV1,
} from "../backup-set-manifest.js";
import type {
  DeploymentSecretRecoveryFact,
  EncryptedSecretRecoveryFact,
  SecretRecoveryVerificationPorts,
} from "../secret-recovery-evidence.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumJsonFileBytes = 8 * 1024 * 1024;

export interface CommandRuntime {
  readonly pool: Pool;
  readonly storage: StoragePort;
  readonly migrations: readonly BackupMigrationEntry[];
  readonly instanceId: string;
  readonly deploymentId: string;
  readonly configManifestDigest: string;
  readonly imageDigests: BackupSetManifestV1["images"];
  readonly authenticationRefHash: string;
  readonly operatorId: string;
  readonly secretVerification: SecretRecoveryVerificationPorts;
  readonly close: () => Promise<void>;
}

export type CommandFlags = Readonly<Record<string, string>>;

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required recovery configuration: ${name}`);
  }
  return value;
}

function environmentName(
  environment: NodeJS.ProcessEnv,
): "development" | "test" | "production" {
  const value = environment.KANVAS_ENVIRONMENT?.trim() || "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error(
      "KANVAS_ENVIRONMENT must be development, test or production.",
    );
  }
  return value;
}

function imageDigest(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironment(environment, name);
  if (digestPattern.test(value)) {
    return value;
  }
  const match = /@(?<digest>sha256:[0-9a-f]{64})$/u.exec(value);
  if (!match?.groups?.digest) {
    throw new Error(
      `${name} must be a canonical digest or an image reference pinned by digest.`,
    );
  }
  return match.groups.digest;
}

function assertBoundedReference(value: string, name: string): void {
  if (
    value.length < 1 ||
    value.length > 240 ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(`${name} is invalid.`);
  }
}

function metadataFromEncrypted(
  fact: EncryptedSecretRecoveryFact,
): PinnedSecretVersionMetadata {
  return Object.freeze({
    id: fact.id,
    workspaceId: fact.workspaceId,
    credentialId: fact.credentialId,
    version: fact.version,
    materialGeneration: fact.materialGeneration,
    sourceKind: "encrypted_database",
    lifecycleStatus: fact.lifecycleStatus,
    aadDigest: fact.aadDigest,
    materialFingerprint: fact.materialFingerprint,
    formatVersion: fact.formatVersion,
    drainDeadlineAt: fact.drainDeadlineAt,
    envelope: Object.freeze({
      materialCiphertextBase64: fact.materialCiphertextBase64,
      materialNonceBase64: fact.materialNonceBase64,
      materialAuthTagBase64: fact.materialAuthTagBase64,
      wrappedDekBase64: fact.wrappedDekBase64,
      wrapNonceBase64: fact.wrapNonceBase64,
      wrapAuthTagBase64: fact.wrapAuthTagBase64,
      kekVersion: fact.kekVersion,
    }),
  });
}

function metadataFromDeployment(
  fact: DeploymentSecretRecoveryFact,
): PinnedSecretVersionMetadata {
  return Object.freeze({
    id: fact.id,
    workspaceId: fact.workspaceId,
    credentialId: fact.credentialId,
    version: fact.version,
    materialGeneration: fact.materialGeneration,
    sourceKind: "deployment_reference",
    lifecycleStatus: fact.lifecycleStatus,
    aadDigest: fact.aadDigest,
    materialFingerprint: fact.materialFingerprint,
    formatVersion: fact.formatVersion,
    drainDeadlineAt: fact.drainDeadlineAt,
    deploymentReference: fact.deploymentReference,
  });
}

function secretVerificationPorts(
  environment: NodeJS.ProcessEnv,
): SecretRecoveryVerificationPorts {
  const resolver = createProviderSecretMaterialResolver(
    loadProviderSecretFileMaps(environment),
  );
  return Object.freeze({
    verifyEncryptedSecret: (fact: EncryptedSecretRecoveryFact) =>
      resolver.withResolvedMaterial(metadataFromEncrypted(fact), () =>
        Promise.resolve(),
      ),
    verifyDeploymentSecretReference: (fact: DeploymentSecretRecoveryFact) =>
      resolver.withResolvedMaterial(metadataFromDeployment(fact), () =>
        Promise.resolve(),
      ),
  });
}

async function createStorage(
  environment: NodeJS.ProcessEnv,
): Promise<StoragePort> {
  const config = loadStorageAdapterConfig(
    environment,
    environmentName(environment),
  );
  if (!config) {
    throw new Error(
      "Recovery commands require one configured Storage profile.",
    );
  }
  if (config.kind === "oss")
    return createAliyunOssStorageAdapter({
      storageProfileId: config.profileId,
      bucket: config.container,
      endpoint: config.endpoint,
      region: config.region,
      keyPrefix: config.keyPrefix,
      ...config.credentials,
      ...(config.stagingDirectory
        ? { stagingDirectory: config.stagingDirectory }
        : {}),
    });
  return config.kind === "local"
    ? createLocalFilesystemStorageAdapter({
        storageProfileId: config.profileId,
        rootDirectory: config.rootDirectory,
        acknowledgeTrustedProcessRoot: true,
      })
    : createAwsS3CompatibleStorageAdapter({
        storageProfileId: config.profileId,
        bucket: config.container,
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
        encryption: config.encryption,
        ...(config.credentials ? { credentials: config.credentials } : {}),
        ...(config.stagingDirectory
          ? { stagingDirectory: config.stagingDirectory }
          : {}),
      });
}

async function migrations(
  environment: NodeJS.ProcessEnv,
): Promise<readonly BackupMigrationEntry[]> {
  const configured = environment.KANVAS_MIGRATIONS_DIRECTORY?.trim();
  const directory =
    configured ?? resolve(import.meta.dirname, "../../../database/migrations");
  if (!isAbsolute(directory)) {
    throw new Error("KANVAS_MIGRATIONS_DIRECTORY must be absolute.");
  }
  const inventory = await readMigrationInventory(directory);
  return Object.freeze(
    inventory.map(({ name, checksum }) => Object.freeze({ name, checksum })),
  );
}

export async function loadCommandRuntime(
  environment: NodeJS.ProcessEnv,
): Promise<CommandRuntime> {
  const instanceId = requiredEnvironment(environment, "KANVAS_INSTANCE_ID");
  const deploymentId = requiredEnvironment(environment, "KANVAS_DEPLOYMENT_ID");
  const configManifestDigest = requiredEnvironment(
    environment,
    "KANVAS_CONFIG_MANIFEST_DIGEST",
  );
  const authenticationRefHash = requiredEnvironment(
    environment,
    "KANVAS_RECOVERY_AUTHENTICATION_REF_HASH",
  );
  const operatorId = requiredEnvironment(
    environment,
    "KANVAS_RECOVERY_OPERATOR_ID",
  );
  assertBoundedReference(instanceId, "KANVAS_INSTANCE_ID");
  assertBoundedReference(deploymentId, "KANVAS_DEPLOYMENT_ID");
  assertBoundedReference(operatorId, "KANVAS_RECOVERY_OPERATOR_ID");
  if (
    !digestPattern.test(configManifestDigest) ||
    !digestPattern.test(authenticationRefHash)
  ) {
    throw new Error(
      "Recovery configuration and authentication references must be canonical SHA-256 digests.",
    );
  }

  const database = loadDatabaseConnectionConfig(environment);
  const pool = createPool({
    ...database,
    connectionLimit: database.connectionLimit,
    timezone: "Z",
    decimalNumbers: false,
  });
  let storage: StoragePort | undefined;
  try {
    storage = await createStorage(environment);
    return Object.freeze({
      pool,
      storage,
      migrations: await migrations(environment),
      instanceId,
      deploymentId,
      configManifestDigest,
      imageDigests: Object.freeze({
        app: imageDigest(environment, "KANVAS_APP_IMAGE"),
        web: imageDigest(environment, "KANVAS_WEB_IMAGE"),
        mysql: imageDigest(environment, "KANVAS_MYSQL_IMAGE"),
        redis: imageDigest(environment, "KANVAS_REDIS_IMAGE"),
      }),
      authenticationRefHash,
      operatorId,
      secretVerification: secretVerificationPorts(environment),
      async close() {
        await storage?.close?.();
        await pool.end();
      },
    });
  } catch (error) {
    await storage?.close?.();
    await pool.end();
    throw error;
  }
}

export async function createSnapshotStorage(
  environment: NodeJS.ProcessEnv,
  rootDirectory: string,
): Promise<StoragePort> {
  const config = loadStorageAdapterConfig(
    environment,
    environmentName(environment),
  );
  if (!config || config.kind !== "local") {
    throw new Error(
      "Quiesced BackupSet commands require a Local Storage profile.",
    );
  }
  if (resolve(rootDirectory) === config.rootDirectory) {
    throw new Error(
      "Object checkpoint must be a separate snapshot root, not the live Local Storage root.",
    );
  }
  return createLocalFilesystemStorageAdapter({
    storageProfileId: config.profileId,
    rootDirectory,
    acknowledgeTrustedProcessRoot: true,
  });
}

export function parseCommandFlags(arguments_: readonly string[]): CommandFlags {
  const result: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (!token?.startsWith("--") || token.length < 3) {
      throw new Error(`Unexpected command argument: ${token ?? ""}`);
    }
    const equals = token.indexOf("=");
    const key = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const value =
      equals === -1 ? arguments_[index + 1] : token.slice(equals + 1);
    if (equals === -1) {
      index += 1;
    }
    if (
      !/^[a-z][a-z0-9-]{0,63}$/u.test(key) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(result, key)
    ) {
      throw new Error(`Invalid or duplicate command flag: --${key}`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

export function requiredFlag(flags: CommandFlags, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing required command flag: --${name}`);
  }
  return value;
}

export function rejectUnknownFlags(
  flags: CommandFlags,
  allowed: readonly string[],
): void {
  const supported = new Set(allowed);
  const unknown = Object.keys(flags).find((key) => !supported.has(key));
  if (unknown) {
    throw new Error(`Unsupported command flag: --${unknown}`);
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new Error("JSON input path must be absolute and normalized.");
  }
  const facts = await lstat(path);
  if (
    !facts.isFile() ||
    facts.isSymbolicLink() ||
    facts.size < 1 ||
    facts.size > maximumJsonFileBytes ||
    (await realpath(path)) !== path
  ) {
    throw new Error("JSON input must be a bounded canonical regular file.");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function writeJsonExclusive(
  path: string,
  value: unknown,
): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new Error("JSON output path must be absolute and normalized.");
  }
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${ulid()}`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, path);
    } catch (error) {
      throw new Error(
        `Could not create output ${basename(path)} without overwriting an existing file.`,
        { cause: error },
      );
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function newAuditContext(runtime: CommandRuntime): {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
} {
  return Object.freeze({
    auditEventId: ulid(),
    authenticationRefHash: runtime.authenticationRefHash,
  });
}

export function newIdentity(): string {
  return ulid();
}
