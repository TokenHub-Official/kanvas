import {
  char,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  capabilityAttemptTable,
  capabilityImplementationRevisionTable,
  workspaceTable,
} from "./execution-core.js";

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

export const browserExecutorSessionTable = mysqlTable(
  "browser_executor_session",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    createdByPrincipalId: id("created_by_principal_id").notNull(),
    authenticationRefHash: char("authentication_ref_hash", {
      length: 64,
    }).notNull(),
    authorityVersion: int("authority_version", {
      unsigned: true,
    }).notNull(),
    runtimeReleaseId: id("runtime_release_id").notNull(),
    runtimeReleaseDigest: digest("runtime_release_digest").notNull(),
    capabilityManifestVersion: int("capability_manifest_version", {
      unsigned: true,
    }).notNull(),
    capabilityManifestDigest: digest("capability_manifest_digest").notNull(),
    state: varchar("state", { length: 24 }).notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    terminalAt: timestamp("terminal_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ix_browser_executor_session_workspace_state").on(
      table.workspaceId,
      table.state,
      table.expiresAt,
      table.id,
    ),
    index("ix_browser_executor_session_expiry").on(
      table.state,
      table.expiresAt,
      table.id,
    ),
    index("ix_browser_executor_session_authentication_ref").on(
      table.workspaceId,
      table.authenticationRefHash,
    ),
  ],
);

export const browserExecutorCapabilityTable = mysqlTable(
  "browser_executor_capability",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    browserExecutorSessionId: id("browser_executor_session_id")
      .notNull()
      .references(() => browserExecutorSessionTable.id),
    implementationRevisionId: id("implementation_revision_id")
      .notNull()
      .references(() => capabilityImplementationRevisionTable.id),
    implementationDigest: digest("implementation_digest").notNull(),
    adapterKey: varchar("adapter_key", { length: 160 }).notNull(),
    backend: varchar("backend", { length: 16 }).notNull(),
    probeProfileVersion: int("probe_profile_version", {
      unsigned: true,
    }).notNull(),
    probeResultDigest: digest("probe_result_digest").notNull(),
    declaredAt: timestamp("declared_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_browser_executor_capability_session_implementation").on(
      table.browserExecutorSessionId,
      table.implementationRevisionId,
    ),
    index("ix_browser_executor_capability_lookup").on(
      table.workspaceId,
      table.implementationRevisionId,
      table.backend,
      table.browserExecutorSessionId,
    ),
  ],
);

export const browserAttemptAssignmentTable = mysqlTable(
  "browser_attempt_assignment",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    browserExecutorSessionId: id("browser_executor_session_id")
      .notNull()
      .references(() => browserExecutorSessionTable.id),
    capabilityAttemptId: id("capability_attempt_id")
      .notNull()
      .references(() => capabilityAttemptTable.id),
    attemptLeaseGeneration: int("attempt_lease_generation", {
      unsigned: true,
    }).notNull(),
    executionGeneration: int("execution_generation", {
      unsigned: true,
    }).notNull(),
    attemptGrantTokenHash: char("attempt_grant_token_hash", {
      length: 64,
    }).notNull(),
    state: varchar("state", { length: 24 }).notNull(),
    stableReasonCode: varchar("stable_reason_code", { length: 120 }),
    claimedAt: timestamp("claimed_at").notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at").notNull(),
    terminalAt: timestamp("terminal_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_browser_attempt_assignment_attempt").on(
      table.capabilityAttemptId,
    ),
    uniqueIndex("uq_browser_attempt_assignment_grant_token").on(
      table.attemptGrantTokenHash,
    ),
    index("ix_browser_attempt_assignment_session").on(
      table.browserExecutorSessionId,
      table.state,
      table.leaseExpiresAt,
      table.id,
    ),
    index("ix_browser_attempt_assignment_reconcile").on(
      table.workspaceId,
      table.state,
      table.leaseExpiresAt,
      table.id,
    ),
  ],
);

export const browserAttemptAssignmentEventTable = mysqlTable(
  "browser_attempt_assignment_event",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    browserAttemptAssignmentId: id("browser_attempt_assignment_id")
      .notNull()
      .references(() => browserAttemptAssignmentTable.id),
    eventKey: varchar("event_key", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 24 }).notNull(),
    attemptLeaseGeneration: int("attempt_lease_generation", {
      unsigned: true,
    }).notNull(),
    executionGeneration: int("execution_generation", {
      unsigned: true,
    }).notNull(),
    stableReasonCode: varchar("stable_reason_code", { length: 120 }),
    occurredAt: timestamp("occurred_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_browser_assignment_event_key").on(
      table.browserAttemptAssignmentId,
      table.eventKey,
    ),
    index("ix_browser_assignment_event_timeline").on(
      table.browserAttemptAssignmentId,
      table.recordedAt,
      table.id,
    ),
    index("ix_browser_assignment_event_workspace").on(
      table.workspaceId,
      table.recordedAt,
      table.id,
    ),
  ],
);
