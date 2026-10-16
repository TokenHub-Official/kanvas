import {
  char,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  capabilityAttemptTable,
  outboxEventTable,
  workspaceTable,
} from "./execution-core.js";
import { providerInvocationTable } from "./provider-invocation.js";

const id = (name: string) =>
  char(name, {
    length: 26,
  });

const digest = (name: string) =>
  char(name, {
    length: 71,
  });

const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export const attemptCompletionTable = mysqlTable(
  "attempt_completion",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityRunId: id("capability_run_id").notNull(),
    capabilityAttemptId: id("capability_attempt_id").notNull(),
    completionRequestKey: id("completion_request_key").notNull(),
    manifestSchemaVersion: smallint("manifest_schema_version", {
      unsigned: true,
    }).notNull(),
    completionManifestHash: digest("completion_manifest_hash").notNull(),
    outputCount: int("output_count", { unsigned: true }).notNull(),
    initialUsageEntryCount: int("initial_usage_entry_count", {
      unsigned: true,
    }).notNull(),
    terminalOutboxEventId: id("terminal_outbox_event_id").notNull(),
    completedAt: timestamp("completed_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_attempt_completion_attempt_scope",
      columns: [
        table.workspaceId,
        table.capabilityRunId,
        table.capabilityAttemptId,
      ],
      foreignColumns: [
        capabilityAttemptTable.workspaceId,
        capabilityAttemptTable.capabilityRunId,
        capabilityAttemptTable.id,
      ],
    }),
    foreignKey({
      name: "fk_attempt_completion_outbox_scope",
      columns: [table.workspaceId, table.terminalOutboxEventId],
      foreignColumns: [outboxEventTable.workspaceId, outboxEventTable.id],
    }),
    uniqueIndex("uq_attempt_completion_attempt").on(table.capabilityAttemptId),
    uniqueIndex("uq_attempt_completion_run").on(table.capabilityRunId),
    uniqueIndex("uq_attempt_completion_request").on(
      table.workspaceId,
      table.completionRequestKey,
    ),
    uniqueIndex("uq_attempt_completion_outbox").on(table.terminalOutboxEventId),
    uniqueIndex("uq_attempt_completion_usage_scope").on(
      table.workspaceId,
      table.capabilityAttemptId,
      table.id,
    ),
    index("ix_attempt_completion_workspace").on(
      table.workspaceId,
      table.completedAt,
      table.id,
    ),
  ],
);

export const usageLedgerEntryTable = mysqlTable(
  "usage_ledger_entry",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityAttemptId: id("capability_attempt_id").notNull(),
    attemptCompletionId: id("attempt_completion_id").notNull(),
    entryKey: varchar("entry_key", { length: 160 }).notNull(),
    metricKey: varchar("metric_key", { length: 160 }).notNull(),
    valueDimension: varchar("value_dimension", {
      length: 16,
    }).notNull(),
    unitCode: varchar("unit_code", { length: 80 }),
    numericValue: decimal("numeric_value", {
      precision: 36,
      scale: 12,
      mode: "string",
    }),
    currencyCode: char("currency_code", { length: 3 }),
    entryKind: varchar("entry_kind", { length: 24 }).notNull(),
    recordingPhase: varchar("recording_phase", {
      length: 24,
    }).notNull(),
    sourceKind: varchar("source_kind", { length: 32 }).notNull(),
    correctsUsageEntryId: id("corrects_usage_entry_id"),
    providerInvocationId: id("provider_invocation_id"),
    pricingRevisionId: id("pricing_revision_id"),
    evidenceDigest: digest("evidence_digest").notNull(),
    observedAt: timestamp("observed_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_usage_ledger_completion_scope",
      columns: [
        table.workspaceId,
        table.capabilityAttemptId,
        table.attemptCompletionId,
      ],
      foreignColumns: [
        attemptCompletionTable.workspaceId,
        attemptCompletionTable.capabilityAttemptId,
        attemptCompletionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_usage_ledger_provider_scope",
      columns: [
        table.workspaceId,
        table.capabilityAttemptId,
        table.providerInvocationId,
      ],
      foreignColumns: [
        providerInvocationTable.workspaceId,
        providerInvocationTable.capabilityAttemptId,
        providerInvocationTable.id,
      ],
    }),
    foreignKey({
      name: "fk_usage_ledger_correction_scope",
      columns: [
        table.workspaceId,
        table.capabilityAttemptId,
        table.correctsUsageEntryId,
      ],
      foreignColumns: [table.workspaceId, table.capabilityAttemptId, table.id],
    }),
    uniqueIndex("uq_usage_ledger_attempt_entry").on(
      table.capabilityAttemptId,
      table.entryKey,
    ),
    uniqueIndex("uq_usage_ledger_correction_scope").on(
      table.workspaceId,
      table.capabilityAttemptId,
      table.id,
    ),
    index("ix_usage_ledger_completion").on(
      table.attemptCompletionId,
      table.recordedAt,
      table.id,
    ),
    index("ix_usage_ledger_metric").on(
      table.workspaceId,
      table.metricKey,
      table.recordedAt,
      table.id,
    ),
    index("ix_usage_ledger_provider").on(
      table.providerInvocationId,
      table.recordedAt,
      table.id,
    ),
    index("ix_usage_ledger_correction").on(
      table.correctsUsageEntryId,
      table.recordedAt,
      table.id,
    ),
  ],
);
