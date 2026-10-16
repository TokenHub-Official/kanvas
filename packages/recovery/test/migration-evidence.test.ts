import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  migrationInventoryDigest,
  verifyMigrationRecoveryEvidence,
  type BackupMigrationEntry,
  type BackupSetManifestV1,
} from "../src/index.js";

const migrations: readonly BackupMigrationEntry[] = Object.freeze([
  Object.freeze({
    name: "0000_initial_schema.sql",
    checksum: "1".repeat(64),
  }),
  Object.freeze({
    name: "0001_example_change.sql",
    checksum: "2".repeat(64),
  }),
]);

function manifest(): BackupSetManifestV1 {
  return {
    database: {
      migrations,
      migrationInventoryDigest: migrationInventoryDigest(migrations),
    },
  } as BackupSetManifestV1;
}

function poolFor(
  history: readonly {
    readonly name: string;
    readonly checksum: string;
    readonly state: string;
  }[],
): Pool {
  return {
    query: vi.fn(() => Promise.resolve([[...history], []])),
  } as unknown as Pool;
}

describe("Migration recovery evidence", () => {
  it("requires the release, manifest, and database histories to match", async () => {
    const evidence = await verifyMigrationRecoveryEvidence({
      pool: poolFor(
        migrations.map((migration) => ({
          ...migration,
          state: "applied",
        })),
      ),
      manifest: manifest(),
      expectedMigrations: migrations,
    });

    expect(evidence).toEqual({
      inventoryDigest: migrationInventoryDigest(migrations),
      schemaMigrationCount: 2,
    });
  });

  it("rejects a restored database with an incomplete history", async () => {
    await expect(
      verifyMigrationRecoveryEvidence({
        pool: poolFor([
          {
            ...migrations[0]!,
            state: "applied",
          },
        ]),
        manifest: manifest(),
        expectedMigrations: migrations,
      }),
    ).rejects.toMatchObject({
      code: "recovery_verification.migration_mismatch",
    });
  });
});
