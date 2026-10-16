import { createHash } from "node:crypto";

import {
  createPool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import type { DatabaseConnectionConfig } from "../configuration/database-config.js";
import type { MigrationFile } from "./migration-inventory.js";

import type { PreparedCatalogPackageV1 } from "../cli/catalog-package-installer.js";
import { backfillWorkspaceSystemCatalog } from "../runtime/workspace-system-catalog.js";

import { backfillDefaultProviderPolicies } from "../runtime/default-provider-policy.js";

interface AppliedMigrationRow extends RowDataPacket {
  readonly name: string;
  readonly checksum: string;
  readonly state: string;
}

interface MigrationHistoryColumnRow extends RowDataPacket {
  readonly columnName: string;
}

interface MySqlStoredProgramPrerequisiteRow extends RowDataPacket {
  readonly binaryLoggingEnabled: number | string;
  readonly trustedFunctionCreators: number | string;
}

export interface MigrationHistoryFact {
  readonly name: string;
  readonly checksum: string;
  readonly state: string;
}

export type MigrationRunnerErrorCode =
  | "migration.checksum_drift"
  | "migration.execution_failed"
  | "migration.history_gap"
  | "migration.history_incomplete"
  | "migration.history_unknown"
  | "migration.inventory_invalid"
  | "migration.lock_unavailable"
  | "migration.options_invalid"
  | "migration.trigger_creation_unavailable";

export class MigrationRunnerError extends Error {
  public constructor(
    public readonly code: MigrationRunnerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationRunnerError";
  }
}

export interface RunMigrationsOptions {
  readonly connection: DatabaseConnectionConfig;
  readonly instanceId: string;
  readonly migrations: readonly MigrationFile[];
  readonly initialCatalog?: PreparedCatalogPackageV1;
}

const migrationHistoryColumnDefinitions = Object.freeze({
  state:
    "state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'applied' AFTER checksum",
  started_at: "started_at DATETIME(3) NULL AFTER state",
  completed_at: "completed_at DATETIME(3) NULL AFTER applied_at",
  failure_code:
    "failure_code VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER completed_at",
  failure_message: "failure_message VARCHAR(1000) NULL AFTER failure_code",
});

function invalidOptions(message: string): never {
  throw new MigrationRunnerError("migration.options_invalid", message);
}

function assertBoundedDeploymentFact(
  value: string,
  label: string,
  maximumLength: number,
): void {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalidOptions(
      `${label} must be a bounded value without surrounding whitespace or control characters.`,
    );
  }
}

/**
 * GET_LOCK names are scoped by the MySQL server, not by an application
 * process. The database identity therefore owns the migration lock even when
 * multiple Kanvas instance IDs point at the same schema.
 */
export function databaseMigrationLockName(database: string): string {
  assertBoundedDeploymentFact(database, "connection.database", 255);
  return `kanvas:migrate:${createHash("sha256")
    .update(database)
    .digest("hex")
    .slice(0, 40)}`;
}

/**
 * Validates the complete history before any new DDL is attempted. An
 * interrupted MySQL DDL file is deliberately not replayed automatically:
 * MySQL commits many DDL statements independently, so guessing which
 * statements completed could corrupt schema authority.
 */
export function validateMigrationHistory(
  migrations: readonly Pick<
    MigrationFile,
    "name" | "checksum" | "compatibleChecksums"
  >[],
  history: readonly MigrationHistoryFact[],
): ReadonlySet<string> {
  const inventoryByName = new Map<string, readonly string[]>();
  for (const migration of migrations) {
    if (inventoryByName.has(migration.name)) {
      throw new MigrationRunnerError(
        "migration.inventory_invalid",
        `Migration inventory contains duplicate name ${migration.name}.`,
      );
    }
    inventoryByName.set(migration.name, [
      migration.checksum,
      ...(migration.compatibleChecksums ?? []),
    ]);
  }

  const historyByName = new Map<string, MigrationHistoryFact>();
  for (const row of history) {
    if (historyByName.has(row.name)) {
      throw new MigrationRunnerError(
        "migration.history_incomplete",
        `Migration history contains duplicate name ${row.name}.`,
      );
    }
    if (!inventoryByName.has(row.name)) {
      throw new MigrationRunnerError(
        "migration.history_unknown",
        `Database contains migration ${row.name}, which is unknown to this release.`,
      );
    }
    if (row.state !== "applied") {
      throw new MigrationRunnerError(
        "migration.history_incomplete",
        `Migration ${row.name} is ${row.state}; restore a pre-migration snapshot or complete a verified operator repair before retrying.`,
      );
    }
    const expectedChecksum = inventoryByName.get(row.name);
    if (!expectedChecksum?.includes(row.checksum)) {
      throw new MigrationRunnerError(
        "migration.checksum_drift",
        `Applied migration checksum drift detected: ${row.name}`,
      );
    }
    historyByName.set(row.name, row);
  }

  let encounteredPending = false;
  for (const migration of migrations) {
    if (!historyByName.has(migration.name)) {
      encounteredPending = true;
      continue;
    }
    if (encounteredPending) {
      throw new MigrationRunnerError(
        "migration.history_gap",
        `Applied migration ${migration.name} follows an unapplied migration.`,
      );
    }
  }

  return new Set(historyByName.keys());
}

const createTriggerPattern = /\bCREATE\s+TRIGGER\b/iu;

export function assertStoredProgramCreationAvailable(options: {
  readonly binaryLoggingEnabled: boolean;
  readonly trustedFunctionCreators: boolean;
  readonly pendingMigrations: readonly Pick<MigrationFile, "name" | "sql">[];
}): void {
  if (
    !options.binaryLoggingEnabled ||
    options.trustedFunctionCreators ||
    !options.pendingMigrations.some(({ sql }) => createTriggerPattern.test(sql))
  ) {
    return;
  }
  throw new MigrationRunnerError(
    "migration.trigger_creation_unavailable",
    "Pending Kanvas migrations create reviewed integrity triggers, but MySQL binary logging is enabled and log_bin_trust_function_creators is OFF. Configure the instance parameter before running any migration; do not grant SUPER to the application account.",
  );
}

function mysqlBoolean(value: number | string, field: string): boolean {
  if (value === 1 || value === "1") {
    return true;
  }
  if (value === 0 || value === "0") {
    return false;
  }
  throw new MigrationRunnerError(
    "migration.options_invalid",
    `MySQL returned an invalid ${field} deployment fact.`,
  );
}

async function assertPendingStoredProgramPrerequisites(
  connection: PoolConnection,
  pendingMigrations: readonly MigrationFile[],
): Promise<void> {
  if (!pendingMigrations.some(({ sql }) => createTriggerPattern.test(sql))) {
    return;
  }
  const [rows] = await connection.query<MySqlStoredProgramPrerequisiteRow[]>(
    `SELECT
         @@GLOBAL.log_bin AS binaryLoggingEnabled,
         @@GLOBAL.log_bin_trust_function_creators
           AS trustedFunctionCreators`,
  );
  const facts = rows[0];
  if (!facts) {
    throw new MigrationRunnerError(
      "migration.options_invalid",
      "MySQL did not return stored-program deployment prerequisites.",
    );
  }
  assertStoredProgramCreationAvailable({
    binaryLoggingEnabled: mysqlBoolean(facts.binaryLoggingEnabled, "log_bin"),
    trustedFunctionCreators: mysqlBoolean(
      facts.trustedFunctionCreators,
      "log_bin_trust_function_creators",
    ),
    pendingMigrations,
  });
}

async function ensureMigrationHistorySchema(
  connection: PoolConnection,
): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS kanvas_migration_history (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
        NOT NULL DEFAULT 'applied',
      started_at DATETIME(3) NULL,
      applied_at DATETIME(3) NOT NULL,
      completed_at DATETIME(3) NULL,
      failure_code
        VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL,
      failure_message VARCHAR(1000) NULL,
      release_version VARCHAR(120) NOT NULL
    ) ENGINE=InnoDB
  `);

  const [columnRows] = await connection.query<MigrationHistoryColumnRow[]>(
    `SELECT column_name AS columnName
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'kanvas_migration_history'`,
  );
  const existingColumns = new Set(columnRows.map((row) => row.columnName));
  for (const [name, definition] of Object.entries(
    migrationHistoryColumnDefinitions,
  )) {
    if (!existingColumns.has(name)) {
      await connection.query(
        `ALTER TABLE kanvas_migration_history ADD COLUMN ${definition}`,
      );
    }
  }
  await connection.query(
    `UPDATE kanvas_migration_history
     SET started_at = COALESCE(started_at, applied_at),
         completed_at = CASE
           WHEN state = 'applied'
             THEN COALESCE(completed_at, applied_at)
           ELSE completed_at
         END`,
  );
}

function boundedFailureFact(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  const candidate =
    error !== null && typeof error === "object"
      ? (error as {
          readonly code?: unknown;
          readonly message?: unknown;
        })
      : undefined;
  const rawCode =
    typeof candidate?.code === "string"
      ? candidate.code
      : "UNKNOWN_MIGRATION_ERROR";
  const code = /^[A-Za-z0-9._:-]{1,120}$/u.test(rawCode)
    ? rawCode
    : "UNKNOWN_MIGRATION_ERROR";
  const rawMessage =
    typeof candidate?.message === "string"
      ? candidate.message
      : "Migration execution failed.";
  const message =
    [...rawMessage]
      .map((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
          ? " "
          : character;
      })
      .join("")
      .trim()
      .slice(0, 1000) || "Migration execution failed.";
  return Object.freeze({ code, message });
}

export async function runMigrations(
  options: RunMigrationsOptions,
): Promise<void> {
  assertBoundedDeploymentFact(options.instanceId, "instanceId", 120);
  const releaseVersion =
    process.env.KANVAS_RELEASE_VERSION ?? "0.0.0-development";
  assertBoundedDeploymentFact(releaseVersion, "KANVAS_RELEASE_VERSION", 120);
  const pool = createPool({
    host: options.connection.host,
    port: options.connection.port,
    database: options.connection.database,
    user: options.connection.user,
    password: options.connection.password,
    ...(options.connection.ssl ? { ssl: options.connection.ssl } : {}),
    connectionLimit: 1,
    multipleStatements: true,
    timezone: "Z",
    decimalNumbers: false,
  });
  const connection = await pool.getConnection();
  const lockName = databaseMigrationLockName(options.connection.database);

  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [lockName],
    );
    if (lockRows[0]?.acquired !== 1) {
      throw new MigrationRunnerError(
        "migration.lock_unavailable",
        "Could not acquire the Kanvas database migration lock.",
      );
    }

    await ensureMigrationHistorySchema(connection);

    const [appliedRows] = await connection.query<AppliedMigrationRow[]>(
      `SELECT name, checksum, state
       FROM kanvas_migration_history
       ORDER BY name`,
    );
    const applied = validateMigrationHistory(options.migrations, appliedRows);
    const pendingMigrations = options.migrations.filter(
      ({ name }) => !applied.has(name),
    );
    await assertPendingStoredProgramPrerequisites(
      connection,
      pendingMigrations,
    );

    for (const migration of pendingMigrations) {
      await connection.execute(
        `INSERT INTO kanvas_migration_history
          (
            name,
            checksum,
            state,
            started_at,
            applied_at,
            completed_at,
            failure_code,
            failure_message,
            release_version
          )
         VALUES (
           ?, ?, 'applying', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3),
           NULL, NULL, NULL, ?
         )`,
        [migration.name, migration.checksum, releaseVersion],
      );
      try {
        await connection.query(migration.sql);
        await connection.execute(
          `UPDATE kanvas_migration_history
           SET state = 'applied',
               applied_at = UTC_TIMESTAMP(3),
               completed_at = UTC_TIMESTAMP(3),
               failure_code = NULL,
               failure_message = NULL
           WHERE name = ?
             AND checksum = ?
             AND state = 'applying'`,
          [migration.name, migration.checksum],
        );
      } catch (error) {
        const failure = boundedFailureFact(error);
        try {
          await connection.execute(
            `UPDATE kanvas_migration_history
             SET state = 'failed',
                 completed_at = UTC_TIMESTAMP(3),
                 failure_code = ?,
                 failure_message = ?
             WHERE name = ?
               AND checksum = ?
               AND state = 'applying'`,
            [failure.code, failure.message, migration.name, migration.checksum],
          );
        } catch {
          // The original DDL failure is authoritative. A lost connection
          // leaves the durable row in `applying`, which is also fail-closed.
        }
        throw new MigrationRunnerError(
          "migration.execution_failed",
          `Migration ${migration.name} failed with ${failure.code}; automatic replay is disabled because MySQL DDL may have partially committed.`,
          { cause: error },
        );
      }
    }

    await connection.execute(
      `INSERT IGNORE INTO instance_runtime_state
        (instance_id, state, execution_generation, state_version, reason, changed_by, changed_at)
       VALUES (?, 'ACTIVE', 1, 1, 'initial installation', 'migrator', UTC_TIMESTAMP(3))`,
      [options.instanceId],
    );
    await backfillDefaultProviderPolicies(connection);
    if (options.initialCatalog) {
      await backfillWorkspaceSystemCatalog(connection, options.initialCatalog);
    }
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      connection.release();
      await pool.end();
    }
  }
}
