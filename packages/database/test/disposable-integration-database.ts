import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";

interface TableNameRow extends RowDataPacket {
  readonly tableName: string;
}

const tableNamePattern = /^[a-z0-9_]{1,64}$/u;
const migrationHistoryTable = "kanvas_migration_history";
const disposableDatabaseNamePattern =
  /^kanvas_integration_[0-9]+_[0-9a-f]{12}$/u;

export function assertDisposableIntegrationDatabaseName(
  databaseName: string | null | undefined,
): asserts databaseName is string {
  if (!databaseName || !disposableDatabaseNamePattern.test(databaseName)) {
    throw new Error(
      "Disposable integration reset requires a runner-created isolated database.",
    );
  }
}

export const disposableIntegrationDatabase =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";

export function createDisposableIntegrationPool(connectionLimit = 2): Pool {
  if (!disposableIntegrationDatabase) {
    throw new Error(
      "Disposable integration pool requires the runner-owned integration boundary.",
    );
  }
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    const database = process.env.KANVAS_DATABASE_NAME?.trim();
    const user = process.env.KANVAS_DATABASE_USER?.trim();
    if (!database || !user) {
      throw new Error(
        "Socket integration requires KANVAS_DATABASE_NAME and KANVAS_DATABASE_USER.",
      );
    }
    return createPool({
      socketPath,
      database,
      user,
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  return createPool({
    ...loadDatabaseConnectionConfig(process.env),
    connectionLimit,
    timezone: "Z",
    decimalNumbers: false,
  });
}

/**
 * A disposable integration database is the only context where Kanvas may
 * bypass its production immutability triggers. TRUNCATE is intentionally
 * database-wide, so the Vitest command must disable file parallelism and the
 * caller must point at an isolated database that may lose all fixture data.
 */
export async function resetDisposableIntegrationDatabase(
  connection: PoolConnection,
): Promise<boolean> {
  if (!disposableIntegrationDatabase) {
    return false;
  }
  const [databaseRows] = await connection.query<
    (RowDataPacket & {
      readonly databaseName: string | null;
    })[]
  >("SELECT DATABASE() AS databaseName");
  const databaseName = databaseRows[0]?.databaseName;
  assertDisposableIntegrationDatabaseName(databaseName);
  const [rows] = await connection.query<TableNameRow[]>(
    `SELECT table_name AS tableName
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const names = rows
    .map(({ tableName }) => tableName)
    .filter((name) => name !== migrationHistoryTable);
  if (names.some((name) => !tableNamePattern.test(name))) {
    throw new Error(
      "Disposable integration database contains an unsafe table name.",
    );
  }

  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const name of names) {
      await connection.query(`TRUNCATE TABLE \`${name}\``);
    }
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  return true;
}
