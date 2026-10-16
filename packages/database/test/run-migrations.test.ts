import { describe, expect, it } from "vitest";

import {
  assertStoredProgramCreationAvailable,
  databaseMigrationLockName,
  validateMigrationHistory,
} from "../src/migrator/run-migrations.js";

const migration = (
  name: string,
  checksumCharacter: string,
): {
  readonly name: string;
  readonly checksum: string;
} =>
  Object.freeze({
    name,
    checksum: checksumCharacter.repeat(64),
  });

const inventory = Object.freeze([
  migration("0000_first.sql", "a"),
  migration("0001_second.sql", "b"),
  migration("0002_third.sql", "c"),
]);

describe("migration history authority", () => {
  it("uses one database-scoped, bounded lock across instance IDs", () => {
    const first = databaseMigrationLockName("kanvas");
    const second = databaseMigrationLockName("kanvas");
    const another = databaseMigrationLockName("kanvas_test");

    expect(first).toBe(second);
    expect(first).not.toBe(another);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it("accepts only a contiguous applied prefix", () => {
    const applied = validateMigrationHistory(inventory, [
      {
        ...inventory[0]!,
        state: "applied",
      },
      {
        ...inventory[1]!,
        state: "applied",
      },
    ]);

    expect([...applied]).toEqual(["0000_first.sql", "0001_second.sql"]);
  });

  it.each([
    {
      name: "interrupted DDL",
      history: [
        {
          ...inventory[0]!,
          state: "failed",
        },
      ],
      code: "migration.history_incomplete",
    },
    {
      name: "checksum drift",
      history: [
        {
          ...inventory[0]!,
          checksum: "f".repeat(64),
          state: "applied",
        },
      ],
      code: "migration.checksum_drift",
    },
    {
      name: "newer unknown migration",
      history: [
        {
          name: "9999_future.sql",
          checksum: "f".repeat(64),
          state: "applied",
        },
      ],
      code: "migration.history_unknown",
    },
    {
      name: "history gap",
      history: [
        {
          ...inventory[0]!,
          state: "applied",
        },
        {
          ...inventory[2]!,
          state: "applied",
        },
      ],
      code: "migration.history_gap",
    },
  ])("fails closed for $name", ({ history, code }) => {
    expect(() => validateMigrationHistory(inventory, history)).toThrowError(
      expect.objectContaining({
        code,
      }),
    );
  });

  it("rejects duplicate inventory names before migration execution", () => {
    expect(() =>
      validateMigrationHistory([inventory[0]!, inventory[0]!], []),
    ).toThrowError(
      expect.objectContaining({
        code: "migration.inventory_invalid",
      }),
    );
  });

  it("fails before DDL when pending triggers cannot be created under binary logging", () => {
    expect(() =>
      assertStoredProgramCreationAvailable({
        binaryLoggingEnabled: true,
        trustedFunctionCreators: false,
        pendingMigrations: [
          {
            name: "0001_trigger.sql",
            sql: "CREATE TRIGGER immutable BEFORE UPDATE ON fact FOR EACH ROW SIGNAL SQLSTATE '45000'",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "migration.trigger_creation_unavailable",
      }),
    );
  });

  it.each([
    {
      name: "binary log is disabled",
      binaryLoggingEnabled: false,
      trustedFunctionCreators: false,
      sql: "CREATE TRIGGER immutable BEFORE UPDATE ON fact FOR EACH ROW SET @x = 1",
    },
    {
      name: "trusted creators are enabled",
      binaryLoggingEnabled: true,
      trustedFunctionCreators: true,
      sql: "CREATE TRIGGER immutable BEFORE UPDATE ON fact FOR EACH ROW SET @x = 1",
    },
    {
      name: "no pending trigger exists",
      binaryLoggingEnabled: true,
      trustedFunctionCreators: false,
      sql: "CREATE TABLE fact (id INT PRIMARY KEY)",
    },
  ])(
    "accepts migration prerequisites when $name",
    ({ binaryLoggingEnabled, trustedFunctionCreators, sql }) => {
      expect(() =>
        assertStoredProgramCreationAvailable({
          binaryLoggingEnabled,
          trustedFunctionCreators,
          pendingMigrations: [
            {
              name: "0001_candidate.sql",
              sql,
            },
          ],
        }),
      ).not.toThrow();
    },
  );
});
