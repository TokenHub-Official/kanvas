import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { StoragePort } from "@kanvas/application";
import {
  MigrationRunnerError,
  validateMigrationHistory,
  type MigrationHistoryFact,
} from "@kanvas/database";
import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  createBackupSetEnvelope,
  digestBackupValue,
  parseBackupSetEnvelope,
  type BackupDatabasePosition,
  type BackupMigrationEntry,
  type BackupSetEnvelopeV1,
  type BackupSetManifestV1,
} from "./backup-set-manifest.js";
import {
  verifyAuditRecoveryEvidence,
  type AuditRecoveryEvidence,
} from "./audit-integrity-evidence.js";
import {
  migrationInventoryDigest,
  verifyMigrationRecoveryEvidence,
} from "./migration-evidence.js";
import { failRecoveryVerification } from "./recovery-verification-error.js";
import {
  collectSecretRecoveryEvidence,
  verifySecretRecoveryEvidence,
  type SecretRecoveryEvidence,
  type SecretRecoveryVerificationPorts,
} from "./secret-recovery-evidence.js";
import {
  StoredObjectInventoryError,
  verifyStoredObjectInventory,
  type StoredObjectInventoryEvidence,
} from "./stored-object-inventory.js";

interface RuntimeStateRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
  readonly stateVersion: number;
}

interface MigrationHistoryRow extends RowDataPacket {
  readonly name: string;
  readonly checksum: string;
  readonly state: string;
}

export interface QuiescedBackupCreationEvidence {
  readonly databaseSnapshotSha256: string;
  readonly migrationInventoryDigest: string;
  readonly objects: StoredObjectInventoryEvidence;
  readonly secrets: SecretRecoveryEvidence;
  readonly audit: AuditRecoveryEvidence;
}

export interface QuiescedBackupSetCreationResult {
  readonly backupSet: BackupSetEnvelopeV1;
  readonly evidence: QuiescedBackupCreationEvidence;
}

export interface QuiescedBackupVerificationEvidence extends QuiescedBackupCreationEvidence {
  readonly backupSetId: string;
  readonly manifestDigest: string;
  readonly verificationDigest: string;
}

interface QuiescedBackupCommonOptions extends SecretRecoveryVerificationPorts {
  readonly pool: Pool;
  readonly snapshotStorage: StoragePort;
  readonly databaseSnapshotPath: string;
  readonly expectedMigrations: readonly BackupMigrationEntry[];
  readonly deploymentId: string;
  readonly configManifestDigest: string;
  readonly imageDigests: BackupSetManifestV1["images"];
  readonly instanceId: string;
  readonly databaseBatchSize?: number;
  readonly verificationConcurrency?: number;
}

export interface CreateQuiescedBackupSetOptions extends QuiescedBackupCommonOptions {
  readonly backupSetId: string;
  readonly createdAt: Date;
  readonly databaseSnapshotId: string;
  readonly databasePosition: BackupDatabasePosition;
  readonly objectCheckpointId: string;
  readonly declaredRpoClass: "named-backup-only" | "coordinated-pitr";
}

export interface VerifyQuiescedBackupSetOptions extends QuiescedBackupCommonOptions {
  readonly backupSet: unknown;
}

function boundedReference(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}$/u.test(value)) {
    failRecoveryVerification(
      "recovery_verification.invalid_argument",
      `${label} is not a bounded reference.`,
    );
  }
}

async function hashRegularFile(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Database snapshot path must be absolute and normalized.",
    );
  }
  let facts;
  try {
    facts = await lstat(path);
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Database snapshot file is unavailable.",
      error,
    );
  }
  if (
    !facts.isFile() ||
    facts.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    facts.size < 1
  ) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Database snapshot must be a non-empty canonical regular file.",
    );
  }
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
    }
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Database snapshot could not be hashed.",
      error,
    );
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readMaintenanceRuntime(
  pool: Pool,
  instanceId: string,
): Promise<RuntimeStateRow> {
  let rows: readonly RuntimeStateRow[];
  try {
    [rows] = await pool.query<RuntimeStateRow[]>(
      `SELECT
         state,
         execution_generation AS executionGeneration,
         state_version AS stateVersion
       FROM instance_runtime_state
       WHERE instance_id = ?`,
      [instanceId],
    );
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.database_failure",
      "Backup runtime state could not be read.",
      error,
    );
  }
  const row = rows[0];
  if (!row || rows.length !== 1 || row.state !== "MAINTENANCE") {
    return failRecoveryVerification(
      "recovery_verification.runtime_mismatch",
      "Quiesced BackupSet requires MAINTENANCE runtime state.",
    );
  }
  return row;
}

async function assertCompleteMigrationHistory(
  pool: Pool,
  migrations: readonly BackupMigrationEntry[],
): Promise<void> {
  let rows: readonly MigrationHistoryRow[];
  try {
    [rows] = await pool.query<MigrationHistoryRow[]>(
      `SELECT name, checksum, state
       FROM kanvas_migration_history
       ORDER BY name ASC`,
    );
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.migration_mismatch",
      "Backup database migration history is unavailable.",
      error,
    );
  }
  try {
    const applied = validateMigrationHistory(
      migrations,
      rows satisfies readonly MigrationHistoryFact[],
    );
    if (applied.size !== migrations.length) {
      return failRecoveryVerification(
        "recovery_verification.migration_mismatch",
        "Backup database has unapplied release migrations.",
      );
    }
  } catch (error) {
    if (error instanceof MigrationRunnerError) {
      return failRecoveryVerification(
        "recovery_verification.migration_mismatch",
        "Backup database migration history is not authoritative.",
        error,
      );
    }
    throw error;
  }
}

async function objectEvidence(options: {
  readonly pool: Pool;
  readonly snapshotStorage: StoragePort;
  readonly databaseBatchSize?: number;
  readonly verificationConcurrency?: number;
}): Promise<StoredObjectInventoryEvidence> {
  if (options.snapshotStorage.kind !== "local") {
    return failRecoveryVerification(
      "recovery_verification.object_mismatch",
      "V0 quiesced BackupSet creation requires a Local snapshot adapter.",
    );
  }
  try {
    return await verifyStoredObjectInventory({
      pool: options.pool,
      storage: options.snapshotStorage,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
      ...(options.verificationConcurrency === undefined
        ? {}
        : {
            verificationConcurrency: options.verificationConcurrency,
          }),
    });
  } catch (error) {
    if (error instanceof StoredObjectInventoryError) {
      return failRecoveryVerification(
        "recovery_verification.object_mismatch",
        "Backup object checkpoint does not close database references.",
        error,
      );
    }
    throw error;
  }
}

function secretPorts(
  options: SecretRecoveryVerificationPorts,
): SecretRecoveryVerificationPorts {
  return {
    ...(options.verifyEncryptedSecret
      ? {
          verifyEncryptedSecret: options.verifyEncryptedSecret,
        }
      : {}),
    ...(options.verifyDeploymentSecretReference
      ? {
          verifyDeploymentSecretReference:
            options.verifyDeploymentSecretReference,
        }
      : {}),
  };
}

function imagesEqual(
  left: BackupSetManifestV1["images"],
  right: BackupSetManifestV1["images"],
): boolean {
  return (
    left.app === right.app &&
    left.web === right.web &&
    left.mysql === right.mysql &&
    left.redis === right.redis
  );
}

export async function createQuiescedBackupSet(
  options: CreateQuiescedBackupSetOptions,
): Promise<QuiescedBackupSetCreationResult> {
  boundedReference(options.databaseSnapshotId, "databaseSnapshotId");
  boundedReference(options.objectCheckpointId, "objectCheckpointId");
  if (
    !(options.createdAt instanceof Date) ||
    !Number.isFinite(options.createdAt.getTime())
  ) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "createdAt is invalid.",
    );
  }

  const runtime = await readMaintenanceRuntime(
    options.pool,
    options.instanceId,
  );
  await assertCompleteMigrationHistory(
    options.pool,
    options.expectedMigrations,
  );
  const [databaseSnapshotSha256, objects, secrets, audit] = await Promise.all([
    hashRegularFile(options.databaseSnapshotPath),
    objectEvidence(options),
    collectSecretRecoveryEvidence({
      pool: options.pool,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
      ...secretPorts(options),
    }),
    verifyAuditRecoveryEvidence({
      pool: options.pool,
      ...(options.databaseBatchSize === undefined
        ? {}
        : { batchSize: options.databaseBatchSize }),
    }),
  ]);
  const inventoryDigest = migrationInventoryDigest(options.expectedMigrations);
  const backupSet = createBackupSetEnvelope({
    schemaVersion: 1,
    backupSetId: options.backupSetId,
    deploymentId: options.deploymentId,
    createdAt: options.createdAt.toISOString(),
    runtime: {
      state: "MAINTENANCE",
      executionGeneration: runtime.executionGeneration,
      stateVersion: runtime.stateVersion,
    },
    database: {
      snapshotId: options.databaseSnapshotId,
      snapshotSha256: databaseSnapshotSha256,
      position: options.databasePosition,
      migrationInventoryDigest: inventoryDigest,
      migrations: options.expectedMigrations,
    },
    objects: {
      storageProfileId: options.snapshotStorage.storageProfileId,
      storageKind: "local",
      coverageMode: "quiesced_local_snapshot",
      checkpointId: options.objectCheckpointId,
      inventoryDigest: objects.inventoryDigest,
      storedObjectReferenceCount: objects.storedObjectReferenceCount,
    },
    keyReferences: {
      kekVersions: secrets.kekVersions,
      deploymentSecretReferenceCount: secrets.deploymentSecretReferenceCount,
    },
    configuration: {
      configManifestDigest: options.configManifestDigest,
    },
    images: options.imageDigests,
    declaredRpoClass: options.declaredRpoClass,
    verification: {
      status: "created",
    },
  });
  return Object.freeze({
    backupSet,
    evidence: Object.freeze({
      databaseSnapshotSha256,
      migrationInventoryDigest: inventoryDigest,
      objects,
      secrets,
      audit,
    }),
  });
}

export async function verifyQuiescedBackupSet(
  options: VerifyQuiescedBackupSetOptions,
): Promise<QuiescedBackupVerificationEvidence> {
  const backupSet = parseBackupSetEnvelope(options.backupSet);
  const manifest = backupSet.manifest;
  if (
    manifest.deploymentId !== options.deploymentId ||
    manifest.configuration.configManifestDigest !==
      options.configManifestDigest ||
    !imagesEqual(manifest.images, options.imageDigests) ||
    manifest.objects.storageKind !== "local" ||
    manifest.objects.coverageMode !== "quiesced_local_snapshot" ||
    manifest.objects.storageProfileId !==
      options.snapshotStorage.storageProfileId
  ) {
    return failRecoveryVerification(
      "recovery_verification.configuration_mismatch",
      "BackupSet does not match this quiesced deployment.",
    );
  }
  const runtime = await readMaintenanceRuntime(
    options.pool,
    options.instanceId,
  );
  if (
    runtime.executionGeneration !== manifest.runtime.executionGeneration ||
    runtime.stateVersion !== manifest.runtime.stateVersion
  ) {
    return failRecoveryVerification(
      "recovery_verification.runtime_mismatch",
      "BackupSet runtime fence does not match the quiesced database.",
    );
  }
  const [databaseSnapshotSha256, migration, objects, secrets, audit] =
    await Promise.all([
      hashRegularFile(options.databaseSnapshotPath),
      verifyMigrationRecoveryEvidence({
        pool: options.pool,
        manifest,
        expectedMigrations: options.expectedMigrations,
      }),
      objectEvidence(options),
      verifySecretRecoveryEvidence({
        pool: options.pool,
        manifest,
        ...(options.databaseBatchSize === undefined
          ? {}
          : { batchSize: options.databaseBatchSize }),
        ...secretPorts(options),
      }),
      verifyAuditRecoveryEvidence({
        pool: options.pool,
        ...(options.databaseBatchSize === undefined
          ? {}
          : { batchSize: options.databaseBatchSize }),
      }),
    ]);
  if (
    databaseSnapshotSha256 !== manifest.database.snapshotSha256 ||
    migration.inventoryDigest !== manifest.database.migrationInventoryDigest ||
    objects.inventoryDigest !== manifest.objects.inventoryDigest ||
    objects.storedObjectReferenceCount !==
      manifest.objects.storedObjectReferenceCount
  ) {
    return failRecoveryVerification(
      "recovery_verification.object_mismatch",
      "BackupSet snapshot evidence no longer matches its manifest.",
    );
  }
  const evidence = Object.freeze({
    backupSetId: manifest.backupSetId,
    manifestDigest: backupSet.manifestDigest,
    databaseSnapshotSha256,
    migrationInventoryDigest: migration.inventoryDigest,
    objects,
    secrets,
    audit,
  });
  return Object.freeze({
    ...evidence,
    verificationDigest: digestBackupValue(
      "kanvas:quiesced-backup-verification:v1",
      evidence,
    ),
  });
}
