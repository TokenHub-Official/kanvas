import { createPool, type RowDataPacket } from "mysql2/promise";

import type { DatabaseConnectionConfig } from "../configuration/database-config.js";
import type { MigrationFile } from "./migration-inventory.js";
import { validateMigrationHistory } from "./run-migrations.js";

export function assertCurrentMigrationStatus(status: {
  readonly state: "uninitialized" | "pending" | "current";
}): void {
  if (status.state !== "current") {
    throw new Error(
      `Database schema is ${status.state}. Run kanvas-db migrate with the release image before starting the application.`,
    );
  }
}

export async function assertInstanceInitialized(
  connection: DatabaseConnectionConfig,
  instanceId: string,
): Promise<void> {
  if (!instanceId.trim())
    throw new Error("Missing KANVAS_INSTANCE_ID for startup check.");
  const pool = createPool({ ...connection, connectionLimit: 1 });
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? LIMIT 1",
      [instanceId],
    );
    if (rows.length === 0)
      throw new Error(
        "Instance runtime state is missing. Run kanvas-db migrate with the configured instance ID before starting the application.",
      );
  } finally {
    await pool.end();
  }
}

/** Read-only: status must never initialize schema or repair history. */
export async function readMigrationStatus(
  connection: DatabaseConnectionConfig,
  migrations: readonly MigrationFile[],
) {
  const pool = createPool({ ...connection, connectionLimit: 1 });
  try {
    const [tables] = await pool.execute<RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kanvas_migration_history'",
      [connection.database],
    );
    const history = tables.length
      ? (
          await pool.query<
            (RowDataPacket & {
              name: string;
              checksum: string;
              state: string;
            })[]
          >(
            "SELECT name, checksum, state FROM kanvas_migration_history ORDER BY name",
          )
        )[0]
      : [];
    const applied = validateMigrationHistory(migrations, history);
    const pending = migrations
      .filter(({ name }) => !applied.has(name))
      .map(({ name }) => name);
    let state: "uninitialized" | "pending" | "current" = "current";
    if (applied.size === 0) state = "uninitialized";
    else if (pending.length > 0) state = "pending";
    return {
      schemaVersion: 1,
      historyTableExists: tables.length > 0,
      initialized: applied.size > 0,
      state,
      applied: [...applied],
      pending,
    };
  } finally {
    await pool.end();
  }
}
