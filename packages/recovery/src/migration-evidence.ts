import {
  MigrationRunnerError,
  validateMigrationHistory,
  type MigrationHistoryFact,
} from "@kanvas/database";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  BackupMigrationEntry,
  BackupSetManifestV1,
} from "./backup-set-manifest.js";
import { digestBackupValue } from "./backup-set-manifest.js";
import { failRecoveryVerification } from "./recovery-verification-error.js";

interface MigrationHistoryRow extends RowDataPacket {
  readonly name: string;
  readonly checksum: string;
  readonly state: string;
}

export interface MigrationRecoveryEvidence {
  readonly inventoryDigest: string;
  readonly schemaMigrationCount: number;
}

export function migrationInventoryDigest(
  migrations: readonly BackupMigrationEntry[],
): string {
  return digestBackupValue("kanvas:migration-inventory:v1", migrations);
}

function inventoriesEqual(
  left: readonly BackupMigrationEntry[],
  right: readonly BackupMigrationEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (migration, index) =>
        migration.name === right[index]?.name &&
        migration.checksum === right[index]?.checksum,
    )
  );
}

export async function verifyMigrationRecoveryEvidence(options: {
  readonly pool: Pool;
  readonly manifest: BackupSetManifestV1;
  readonly expectedMigrations: readonly BackupMigrationEntry[];
}): Promise<MigrationRecoveryEvidence> {
  const manifestMigrations = options.manifest.database.migrations;
  if (
    options.expectedMigrations.length < 1 ||
    !inventoriesEqual(options.expectedMigrations, manifestMigrations)
  ) {
    return failRecoveryVerification(
      "recovery_verification.migration_mismatch",
      "BackupSet migration inventory does not match this release.",
    );
  }
  const inventoryDigest = migrationInventoryDigest(options.expectedMigrations);
  if (inventoryDigest !== options.manifest.database.migrationInventoryDigest) {
    return failRecoveryVerification(
      "recovery_verification.migration_mismatch",
      "BackupSet migration inventory digest is invalid.",
    );
  }

  let rows: readonly MigrationHistoryRow[];
  try {
    [rows] = await options.pool.query<MigrationHistoryRow[]>(
      `SELECT name, checksum, state
       FROM kanvas_migration_history
       ORDER BY name ASC`,
    );
  } catch (error) {
    return failRecoveryVerification(
      "recovery_verification.migration_mismatch",
      "Restored database migration history is unavailable.",
      error,
    );
  }

  try {
    const applied = validateMigrationHistory(
      options.expectedMigrations,
      rows satisfies readonly MigrationHistoryFact[],
    );
    if (applied.size !== options.expectedMigrations.length) {
      return failRecoveryVerification(
        "recovery_verification.migration_mismatch",
        "Restored database is missing one or more release migrations.",
      );
    }
  } catch (error) {
    if (error instanceof MigrationRunnerError) {
      return failRecoveryVerification(
        "recovery_verification.migration_mismatch",
        "Restored database migration history is not authoritative.",
        error,
      );
    }
    throw error;
  }

  return Object.freeze({
    inventoryDigest,
    schemaMigrationCount: options.expectedMigrations.length,
  });
}
