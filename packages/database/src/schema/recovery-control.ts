import {
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { instanceRuntimeStateTable } from "./instance-runtime-state.js";

export type RecoveryOperationLifecycleStatus =
  "restoring" | "verifying" | "read_only" | "active" | "aborted";

export const recoveryOperationTable = mysqlTable(
  "recovery_operation",
  {
    id: char("id", { length: 26 }).primaryKey(),
    instanceId: varchar("instance_id", { length: 120 })
      .notNull()
      .references(() => instanceRuntimeStateTable.instanceId),
    backupSetId: char("backup_set_id", { length: 26 }).notNull(),
    manifestDigest: char("manifest_digest", {
      length: 71,
    }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<RecoveryOperationLifecycleStatus>()
      .notNull(),
    fencedExecutionGeneration: int("fenced_execution_generation", {
      unsigned: true,
    }).notNull(),
    beginStateVersion: int("begin_state_version", {
      unsigned: true,
    }).notNull(),
    verificationResultDigest: char("verification_result_digest", {
      length: 71,
    }),
    verificationSummary: json("verification_summary").$type<
      Readonly<Record<string, string | number>>
    >(),
    activationAckDigest: char("activation_ack_digest", {
      length: 71,
    }),
    lastFailureCode: varchar("last_failure_code", {
      length: 120,
    }),
    version: int("version", { unsigned: true }).notNull(),
    startedAt: datetime("started_at", {
      mode: "date",
      fsp: 3,
    }).notNull(),
    verificationStartedAt: datetime("verification_started_at", {
      mode: "date",
      fsp: 3,
    }),
    verifiedAt: datetime("verified_at", {
      mode: "date",
      fsp: 3,
    }),
    activatedAt: datetime("activated_at", {
      mode: "date",
      fsp: 3,
    }),
    abortedAt: datetime("aborted_at", {
      mode: "date",
      fsp: 3,
    }),
    updatedAt: datetime("updated_at", {
      mode: "date",
      fsp: 3,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_recovery_operation_instance_id").on(
      table.instanceId,
      table.id,
    ),
    index("ix_recovery_operation_active").on(
      table.instanceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_recovery_operation_backup").on(
      table.backupSetId,
      table.manifestDigest,
      table.startedAt,
      table.id,
    ),
  ],
);
