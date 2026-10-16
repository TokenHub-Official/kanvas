import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { StoragePort } from "@kanvas/application";
import {
  createRecoveryOperationStore,
  loadDatabaseConnectionConfig,
  readMigrationInventory,
  type DatabaseConnectionConfig,
} from "@kanvas/database";
import { createPool, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createQuiescedBackupSet,
  verifyRecoveryEvidence,
  verifyQuiescedBackupSet,
  verifyStoredObjectInventory,
  type BackupMigrationEntry,
  type BackupSetEnvelopeV1,
} from "../src/index.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-28T22:00:00.000Z");

function disposableDatabaseName(): string {
  const name = `kanvas_recovery_verify_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function storage(storageProfileId: string): StoragePort {
  return {
    storageProfileId,
    kind: "local",
    capabilities: {
      uploadModes: ["server_stream"],
      writeProtectionModes: ["server_owned"],
      multipart: false,
      fullObjectChecksum: true,
      rangeRead: true,
      versionBoundIdentity: false,
      sealedIdentityImmutable: true,
      deploymentScope: "single_node",
      maximumObjectBytes: "9007199254740991",
      serverSideEncryption: "not_provided",
    },
    writeObject: vi.fn(),
    sealObject: vi.fn(),
    inspectObject: vi.fn(() => Promise.resolve(undefined)),
    openRead: vi.fn(),
    deleteObject: vi.fn(),
    cleanupUnpublishedObject: vi.fn(),
  };
}

function audit(serial: number) {
  return {
    auditEventId: identity(19_910_000 + serial),
    authenticationRefHash: digest("a"),
  };
}

describe.skipIf(!integrationEnabled)(
  "Recovery evidence verifier against disposable MySQL 8.0",
  () => {
    const databaseName = disposableDatabaseName();
    const instanceId = "recovery-evidence-integration";
    const recoveryOperationId = identity(19_920_001);
    const backupSetId = identity(19_920_002);
    const storageProfileId = identity(19_920_003);
    const deploymentId = "kanvas-recovery-test";
    const configManifestDigest = digest("c");
    const imageDigests = Object.freeze({
      app: digest("1"),
      web: digest("2"),
      mysql: digest("3"),
      redis: digest("4"),
    });
    let adminPool!: Pool;
    let pool!: Pool;
    let adapter!: StoragePort;
    let migrations!: readonly BackupMigrationEntry[];
    let backupSet!: BackupSetEnvelopeV1;
    let temporaryDirectory!: string;
    let databaseSnapshotPath!: string;

    beforeAll(async () => {
      const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
      let networkConfig: DatabaseConnectionConfig | undefined;
      if (socketPath) {
        adminPool = createPool({
          socketPath,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 2,
          multipleStatements: true,
          timezone: "Z",
        });
      } else {
        networkConfig = loadDatabaseConnectionConfig(process.env);
        adminPool = createPool({
          host: networkConfig.host,
          port: networkConfig.port,
          user: networkConfig.user,
          password: networkConfig.password,
          connectionLimit: 2,
          multipleStatements: true,
          timezone: "Z",
        });
      }
      await adminPool.query(
        `CREATE DATABASE \`${databaseName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const inventory = await readMigrationInventory(
        resolve(import.meta.dirname, "../../database/migrations"),
      );
      migrations = Object.freeze(
        inventory.map(({ name, checksum }) =>
          Object.freeze({ name, checksum }),
        ),
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${databaseName}\``);
        for (const migration of inventory) {
          await connection.query(migration.sql);
        }
        await connection.query(`
          CREATE TABLE kanvas_migration_history (
            name VARCHAR(255) NOT NULL PRIMARY KEY,
            checksum CHAR(64)
              CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            state VARCHAR(16)
              CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            started_at DATETIME(3) NULL,
            applied_at DATETIME(3) NOT NULL,
            completed_at DATETIME(3) NULL,
            failure_code VARCHAR(120) NULL,
            failure_message VARCHAR(1000) NULL,
            release_version VARCHAR(120) NOT NULL
          ) ENGINE=InnoDB
        `);
        for (const migration of migrations) {
          await connection.query(
            `INSERT INTO kanvas_migration_history (
               name, checksum, state, started_at, applied_at,
               completed_at, failure_code, failure_message,
               release_version
             ) VALUES (?, ?, 'applied', ?, ?, ?, NULL, NULL, ?)`,
            [
              migration.name,
              migration.checksum,
              now,
              now,
              now,
              "recovery-test",
            ],
          );
        }
      } finally {
        connection.release();
      }
      if (socketPath) {
        pool = createPool({
          socketPath,
          database: databaseName,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 8,
          timezone: "Z",
        });
      } else {
        if (!networkConfig) {
          throw new Error("Network database configuration is missing.");
        }
        pool = createPool({
          host: networkConfig.host,
          port: networkConfig.port,
          database: databaseName,
          user: networkConfig.user,
          password: networkConfig.password,
          connectionLimit: 8,
          timezone: "Z",
        });
      }
      adapter = storage(storageProfileId);
      const objectEvidence = await verifyStoredObjectInventory({
        pool,
        storage: adapter,
      });
      await pool.query(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (
           ?, 'MAINTENANCE', 9, 12, 'restore snapshot',
           NULL, 'integration-test', ?
         )`,
        [instanceId, now],
      );
      temporaryDirectory = await realpath(
        await mkdtemp(join(tmpdir(), "kanvas-recovery-evidence-")),
      );
      databaseSnapshotPath = join(temporaryDirectory, "database.sql");
      await writeFile(
        databaseSnapshotPath,
        "-- deterministic integration snapshot\n",
        "utf8",
      );
      const created = await createQuiescedBackupSet({
        pool,
        snapshotStorage: adapter,
        databaseSnapshotPath,
        expectedMigrations: migrations,
        deploymentId,
        configManifestDigest,
        imageDigests,
        instanceId,
        backupSetId,
        createdAt: now,
        databaseSnapshotId: "mysql-recovery-test",
        databasePosition: {
          mode: "binlog",
          file: "binlog.000001",
          position: "4",
        },
        objectCheckpointId: "objects-recovery-test",
        declaredRpoClass: "named-backup-only",
      });
      expect(objectEvidence.storedObjectReferenceCount).toBe("0");
      backupSet = created.backupSet;
      await expect(
        verifyQuiescedBackupSet({
          pool,
          snapshotStorage: adapter,
          databaseSnapshotPath,
          expectedMigrations: migrations,
          deploymentId,
          configManifestDigest,
          imageDigests,
          instanceId,
          backupSet,
        }),
      ).resolves.toMatchObject({
        backupSetId,
        manifestDigest: backupSet.manifestDigest,
      });
      const store = createRecoveryOperationStore(pool, {
        instanceId,
      });
      await store.begin({
        recoveryOperationId,
        backupSetId,
        manifestDigest: backupSet.manifestDigest,
        reasonCode: "recovery.integration_test",
        now,
        ...audit(1),
      });
      await store.startVerification({
        recoveryOperationId,
        expectedExecutionGeneration: 10,
        now,
        ...audit(2),
      });
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await adminPool.end();
      }
      if (temporaryDirectory) {
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    }, 30_000);

    it("proves all restored authority facts and emits one deterministic result", async () => {
      const result = await verifyRecoveryEvidence({
        pool,
        storage: adapter,
        backupSet,
        expectedMigrations: migrations,
        deploymentId,
        configManifestDigest,
        imageDigests,
        instanceId,
        recoveryOperationId,
        expectedExecutionGeneration: 10,
      });

      expect(result.summary).toMatchObject({
        schemaMigrationCount: migrations.length,
        storedObjectReferenceCount: "0",
        verifiedObjectCount: "0",
        invariantCheckCount: 12,
        pendingOutboxCount: "0",
        unknownBudgetReservationCount: "0",
        auditEventCount: "2",
      });
      expect(result.verificationResultDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(result.evidence.unknownProviderInvocationCount).toBe("0");
      expect(result.evidence.secrets).toMatchObject({
        encryptedSecretVersionCount: "0",
        deploymentSecretReferenceCount: "0",
        kekVersions: [],
      });
    });
  },
);
