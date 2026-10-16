import { resolve } from "node:path";

import {
  createRuntimeFenceGuard,
  RuntimeFenceRejectedError,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { DatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import {
  createRecoveryOperationStore,
  type RecoveryOperationStore,
} from "../src/runtime/recovery-operation-store.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const startedAt = new Date("2026-07-28T20:00:00.000Z");
const verificationAt = new Date("2026-07-28T20:01:00.000Z");
const completedAt = new Date("2026-07-28T20:02:00.000Z");
const activatedAt = new Date("2026-07-28T20:03:00.000Z");

interface RuntimeRow extends RowDataPacket {
  readonly state: string;
  readonly executionGeneration: number;
  readonly stateVersion: number;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function disposableDatabaseName(): string {
  const name = `kanvas_recovery_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function audit(serial: number) {
  return {
    auditEventId: identity(19_900_000 + serial),
    authenticationRefHash: digest("a"),
  };
}

describe.skipIf(!integrationEnabled)(
  "RecoveryOperationStore against disposable MySQL 8.0",
  () => {
    const databaseName = disposableDatabaseName();
    const instanceId = "recovery-control-integration";
    const abortInstanceId = "recovery-abort-integration";
    let adminPool!: Pool;
    let pool!: Pool;
    let store!: RecoveryOperationStore;
    let abortStore!: RecoveryOperationStore;

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
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${databaseName}\``);
        const inventory = await readMigrationInventory(
          resolve(import.meta.dirname, "../migrations"),
        );
        for (const migration of inventory) {
          await connection.query(migration.sql);
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
          connectionLimit: 4,
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
          connectionLimit: 4,
          timezone: "Z",
        });
      }
      await pool.query(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES
           (?, 'MAINTENANCE', 40, 8, 'restore drill', NULL,
             'integration-test', ?),
           (?, 'MAINTENANCE', 7, 2, 'abort drill', NULL,
             'integration-test', ?)`,
        [instanceId, startedAt, abortInstanceId, startedAt],
      );
      store = createRecoveryOperationStore(pool, { instanceId });
      abortStore = createRecoveryOperationStore(pool, {
        instanceId: abortInstanceId,
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
    }, 30_000);

    it("fences restored execution, persists verification evidence, and activates a fresh generation", async () => {
      const recoveryOperationId = identity(19_800_001);
      const backupSetId = identity(19_800_002);
      const manifestDigest = digest("b");
      const begin = await store.begin({
        recoveryOperationId,
        backupSetId,
        manifestDigest,
        reasonCode: "recovery.restore_drill",
        now: startedAt,
        ...audit(1),
      });
      expect(begin).toMatchObject({
        lifecycleStatus: "restoring",
        fencedExecutionGeneration: 41,
        beginStateVersion: 9,
        replayed: false,
      });
      await expect(
        store.begin({
          recoveryOperationId,
          backupSetId,
          manifestDigest,
          reasonCode: "recovery.restore_drill",
          now: startedAt,
          ...audit(2),
        }),
      ).resolves.toMatchObject({ replayed: true });

      const runtimeReader = {
        async read() {
          const [rows] = await pool.query<RuntimeRow[]>(
            `SELECT state,
                    execution_generation AS executionGeneration,
                    state_version AS stateVersion
             FROM instance_runtime_state
             WHERE instance_id = ?`,
            [instanceId],
          );
          const row = rows[0];
          if (!row) {
            throw new Error("Runtime row is missing.");
          }
          return {
            state: row.state as "RESTORING",
            executionGeneration: row.executionGeneration,
            stateVersion: row.stateVersion,
          };
        },
      };
      const fence = createRuntimeFenceGuard(runtimeReader, {
        now: () => verificationAt,
      });
      await expect(
        fence.assertAllowed({
          action: "complete",
          expectedGeneration: 40,
        }),
      ).rejects.toBeInstanceOf(RuntimeFenceRejectedError);
      await expect(
        fence.assertAllowed({
          action: "claim",
          expectedGeneration: 41,
        }),
      ).rejects.toMatchObject({
        reasonCode: "runtime_state_disallowed",
      });

      await expect(
        store.startVerification({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          now: verificationAt,
          ...audit(3),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "verifying",
      });
      await expect(
        store.recordVerificationFailure({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          failureCode: "recovery.object_missing",
          now: verificationAt,
          ...audit(4),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "verifying",
        lastFailureCode: "recovery.object_missing",
      });

      const verificationSummary = Object.freeze({
        schemaMigrationCount: 20,
        storedObjectReferenceCount: "3",
        verifiedObjectCount: "3",
        invariantCheckCount: 12,
        pendingOutboxCount: "2",
        unknownBudgetReservationCount: "1",
        auditEventCount: "4",
      });
      const verificationResultDigest = digest("c");
      await expect(
        store.completeVerification({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          verificationResultDigest,
          verificationSummary,
          now: completedAt,
          ...audit(5),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "read_only",
        verificationResultDigest,
        verificationSummary,
        replayed: false,
      });

      await expect(
        store.activate({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          verificationResultDigest,
          activationAckDigest: digest("d"),
          now: activatedAt,
          ...audit(6),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "active",
        activationAckDigest: digest("d"),
        replayed: false,
      });

      await expect(
        store.activate({
          recoveryOperationId,
          expectedExecutionGeneration: 42,
          verificationResultDigest,
          activationAckDigest: digest("d"),
          now: activatedAt,
          ...audit(7),
        }),
      ).rejects.toMatchObject({
        code: "recovery.stale_execution_generation",
      });
      await expect(
        store.activate({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          verificationResultDigest,
          activationAckDigest: digest("d"),
          now: activatedAt,
          ...audit(8),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "active",
        replayed: true,
      });
      await expect(
        store.startVerification({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          now: activatedAt,
          ...audit(9),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "active",
        replayed: true,
      });
      await expect(
        store.completeVerification({
          recoveryOperationId,
          expectedExecutionGeneration: 41,
          verificationResultDigest,
          verificationSummary,
          now: activatedAt,
          ...audit(10),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "active",
        replayed: true,
      });
      await expect(
        store.begin({
          recoveryOperationId,
          backupSetId,
          manifestDigest,
          reasonCode: "recovery.restore_drill",
          now: activatedAt,
          ...audit(11),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "active",
        replayed: true,
      });

      const [runtimeRows] = await pool.query<RuntimeRow[]>(
        `SELECT state,
                execution_generation AS executionGeneration,
                state_version AS stateVersion
         FROM instance_runtime_state
         WHERE instance_id = ?`,
        [instanceId],
      );
      expect(runtimeRows[0]).toMatchObject({
        state: "ACTIVE",
        executionGeneration: 42,
        stateVersion: 12,
      });
      const [auditRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE resource_id = ?`,
        [recoveryOperationId],
      );
      expect(Number(auditRows[0]?.count)).toBe(5);
    });

    it("serializes concurrent recovery begins and aborts into a newly fenced maintenance generation", async () => {
      const firstOperationId = identity(19_800_010);
      const secondOperationId = identity(19_800_011);
      const contenders = await Promise.allSettled([
        abortStore.begin({
          recoveryOperationId: firstOperationId,
          backupSetId: identity(19_800_012),
          manifestDigest: digest("e"),
          reasonCode: "recovery.concurrent_drill",
          now: startedAt,
          ...audit(10),
        }),
        abortStore.begin({
          recoveryOperationId: secondOperationId,
          backupSetId: identity(19_800_013),
          manifestDigest: digest("f"),
          reasonCode: "recovery.concurrent_drill",
          now: startedAt,
          ...audit(11),
        }),
      ]);
      const fulfilled = contenders.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<RecoveryOperationStore["begin"]>>
        > => result.status === "fulfilled",
      );
      const rejected = contenders.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: "recovery.concurrent_operation",
      });
      const winner = fulfilled[0]!.value;

      await expect(
        abortStore.abort({
          recoveryOperationId: winner.id,
          expectedExecutionGeneration: winner.fencedExecutionGeneration,
          reasonCode: "recovery.operator_aborted",
          now: completedAt,
          ...audit(12),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "aborted",
        replayed: false,
      });
      await expect(
        abortStore.abort({
          recoveryOperationId: winner.id,
          expectedExecutionGeneration: winner.fencedExecutionGeneration + 1,
          reasonCode: "recovery.operator_aborted",
          now: completedAt,
          ...audit(13),
        }),
      ).rejects.toMatchObject({
        code: "recovery.stale_execution_generation",
      });
      await expect(
        abortStore.abort({
          recoveryOperationId: winner.id,
          expectedExecutionGeneration: winner.fencedExecutionGeneration,
          reasonCode: "recovery.operator_aborted",
          now: completedAt,
          ...audit(14),
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "aborted",
        replayed: true,
      });
      const [runtimeRows] = await pool.query<RuntimeRow[]>(
        `SELECT state,
                execution_generation AS executionGeneration,
                state_version AS stateVersion
         FROM instance_runtime_state
         WHERE instance_id = ?`,
        [abortInstanceId],
      );
      expect(runtimeRows[0]).toMatchObject({
        state: "MAINTENANCE",
        executionGeneration: 9,
        stateVersion: 4,
      });
    });
  },
);
