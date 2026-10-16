import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { capabilityRunTable } from "./execution-core.js";
import { instanceRuntimeStateTable } from "./instance-runtime-state.js";
import {
  providerInvocationTable,
  providerInvocationObservationTable,
} from "./provider-invocation.js";
const id = (name: string) => char(name, { length: 26 });
const timestamp = (name: string) => datetime(name, { mode: "date", fsp: 3 });
export const providerResultRecoveryTable = mysqlTable(
  "provider_result_recovery",
  {
    id: id("id").primaryKey(),
    instanceId: varchar("instance_id", { length: 120 })
      .notNull()
      .references(() => instanceRuntimeStateTable.instanceId),
    workspaceId: id("workspace_id").notNull(),
    capabilityRunId: id("capability_run_id")
      .notNull()
      .references(() => capabilityRunTable.id),
    attemptId: id("attempt_id").notNull(),
    observationId: id("observation_id")
      .notNull()
      .references(() => providerInvocationObservationTable.id),
    resultIndex: int("result_index", { unsigned: true }).notNull(),
    requestKey: varchar("request_key", { length: 160 }).notNull(),
    actorId: id("actor_id").notNull(),
    authoritySnapshot: json("authority_snapshot").notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    errorCode: varchar("error_code", { length: 160 }),
    policyVersion: int("policy_version", { unsigned: true }),
    leaseToken: char("lease_token", { length: 64 }),
    leaseUntil: timestamp("lease_until"),
    uploadSessionId: id("upload_session_id").notNull(),
    storedObjectId: id("stored_object_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_result_recovery_request").on(
      table.workspaceId,
      table.capabilityRunId,
      table.requestKey,
      table.resultIndex,
    ),
    index("ix_result_recovery_work").on(
      table.state,
      table.leaseUntil,
      table.createdAt,
    ),
    check(
      "chk_result_recovery_state",
      sql`${table.state} IN ('queued','running','succeeded','failed')`,
    ),
  ],
);
export const providerResultPolicyDecisionTable = mysqlTable(
  "provider_result_policy_decision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    providerInvocationId: id("provider_invocation_id")
      .notNull()
      .references(() => providerInvocationTable.id),
    policyVersion: int("policy_version", { unsigned: true }),
    source: varchar("source", { length: 16 }).notNull(),
    origin: varchar("origin", { length: 300 }).notNull(),
    outcome: varchar("outcome", { length: 80 }).notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
  },
  (table) => [
    index("ix_result_policy_invocation").on(
      table.workspaceId,
      table.providerInvocationId,
      table.occurredAt,
    ),
  ],
);
