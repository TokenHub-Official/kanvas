import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("mysql2/promise", () => ({ createPool: () => pool }));

import {
  assertCurrentMigrationStatus,
  assertInstanceInitialized,
  readMigrationStatus,
} from "../src/migrator/migration-status.js";

const connection = {
  host: "unused",
  port: 3306,
  database: "test",
  user: "test",
  password: "must-not-appear",
  connectionLimit: 1,
};
const migrations = [
  {
    name: "0000_first.sql",
    checksum: "a".repeat(64),
    sql: "",
    absolutePath: "/unused",
  },
  {
    name: "0001_second.sql",
    checksum: "b".repeat(64),
    sql: "",
    absolutePath: "/unused",
  },
];
const applied = (index: number) => ({
  name: migrations[index]?.name,
  checksum: migrations[index]?.checksum,
  state: "applied",
});

beforeEach(() => {
  vi.resetAllMocks();
  pool.execute.mockResolvedValue([
    [{ TABLE_NAME: "kanvas_migration_history" }],
  ]);
  pool.query.mockResolvedValue([[]]);
  pool.end.mockResolvedValue(undefined);
});
afterEach(() => {
  // status must never create/repair schema or update migration history.
  for (const [sql] of [...pool.execute.mock.calls, ...pool.query.mock.calls]) {
    expect(sql).toMatch(/^SELECT /u);
  }
  expect(pool.end).toHaveBeenCalledOnce();
});

describe("read-only migration status", () => {
  it("rejects a configured instance that the release job has not initialized", async () => {
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(
      assertInstanceInitialized(connection, "unregistered-instance"),
    ).rejects.toThrow("Instance runtime state is missing");
    expect(pool.execute).toHaveBeenCalledWith(
      "SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? LIMIT 1",
      ["unregistered-instance"],
    );
  });
  it("does not initialize a database that has no history table", async () => {
    pool.execute.mockResolvedValue([[]]);
    const result = await readMigrationStatus(connection, migrations);
    expect(result).toMatchObject({
      historyTableExists: false,
      initialized: false,
      state: "uninitialized",
    });
    expect(pool.query).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(connection.password);
    expect(() => assertCurrentMigrationStatus(result)).toThrow("uninitialized");
  });

  it("does not mistake a preflight-created empty history table for initialization", async () => {
    expect(await readMigrationStatus(connection, migrations)).toMatchObject({
      historyTableExists: true,
      initialized: false,
      state: "uninitialized",
      pending: ["0000_first.sql", "0001_second.sql"],
    });
  });

  it("distinguishes pending upgrades from the current schema", async () => {
    pool.query.mockResolvedValueOnce([[applied(0)]]);
    expect(await readMigrationStatus(connection, migrations)).toMatchObject({
      initialized: true,
      state: "pending",
      pending: ["0001_second.sql"],
    });
  });

  it("reports current only after all migrations are applied", async () => {
    pool.query.mockResolvedValueOnce([[applied(0), applied(1)]]);
    expect(await readMigrationStatus(connection, migrations)).toMatchObject({
      initialized: true,
      state: "current",
      pending: [],
    });
  });

  it.each([
    [{ ...applied(0), state: "failed" }],
    [{ ...applied(0), checksum: "c".repeat(64) }],
    [applied(1)],
  ])("rejects incomplete or inconsistent history", async (...history) => {
    pool.query.mockResolvedValueOnce([history]);
    await expect(readMigrationStatus(connection, migrations)).rejects.toThrow();
  });

  it("closes the pool when the connection fails", async () => {
    pool.execute.mockRejectedValueOnce(new Error("unavailable"));
    await expect(readMigrationStatus(connection, migrations)).rejects.toThrow(
      "unavailable",
    );
  });
});
