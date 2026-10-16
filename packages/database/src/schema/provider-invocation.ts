import {
  boolean,
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  smallint,
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

export const providerInvocationTable = mysqlTable(
  "provider_invocation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityAttemptId: id("capability_attempt_id")
      .notNull()
      .references(() => capabilityAttemptTable.id),
    implementationRevisionId: id("implementation_revision_id")
      .notNull()
      .references(() => capabilityImplementationRevisionTable.id),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    providerKey: varchar("provider_key", { length: 80 }).notNull(),
    apiSurface: varchar("api_surface", { length: 80 }).notNull(),
    credentialIdentityId: id("credential_identity_id").notNull(),
    credentialIdentityEpoch: int("credential_identity_epoch", {
      unsigned: true,
    }).notNull(),
    pinnedSecretVersionId: id("pinned_secret_version_id"),
    modelDeploymentId: id("model_deployment_id"),
    pricingRevisionId: id("pricing_revision_id"),
    budgetReservationId: id("budget_reservation_id"),
    routeCandidateDigest: digest("route_candidate_digest").notNull(),
    requestScopeDigest: digest("request_scope_digest").notNull(),
    stableRequestKey: varchar("stable_request_key", {
      length: 160,
    }).notNull(),
    requestFingerprint: digest("request_fingerprint").notNull(),
    parameterResolutionSnapshot: json("parameter_resolution_snapshot").$type<
      Record<string, unknown>
    >(),
    parameterResolutionDigest: digest("parameter_resolution_digest"),
    preparedRequestSnapshot: json("prepared_request_snapshot").$type<
      Record<string, unknown>
    >(),
    preparedRequestDigest: digest("prepared_request_digest"),
    providerRequestId: varchar("provider_request_id", {
      length: 512,
    }),
    remoteStatus: varchar("remote_status", { length: 24 }).notNull(),
    sideEffectState: varchar("side_effect_state", {
      length: 24,
    }).notNull(),
    queryMode: varchar("query_mode", { length: 32 }).notNull(),
    notFoundIsAuthoritative: boolean("not_found_is_authoritative").notNull(),
    workState: varchar("work_state", { length: 32 }).notNull(),
    reconcileLeaseGeneration: int("reconcile_lease_generation", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    reconcileExecutionGeneration: int("reconcile_execution_generation", {
      unsigned: true,
    }),
    reconcileLeaseTokenHash: char("reconcile_lease_token_hash", {
      length: 64,
    }),
    reconcileLeaseExpiresAt: timestamp("reconcile_lease_expires_at"),
    nextReconcileAt: timestamp("next_reconcile_at"),
    submissionAttempts: smallint("submission_attempts", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    queryAttempts: smallint("query_attempts", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    cancelAttempts: smallint("cancel_attempts", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    version: int("version", { unsigned: true }).notNull(),
    preparedAt: timestamp("prepared_at").notNull(),
    submissionStartedAt: timestamp("submission_started_at"),
    acknowledgedAt: timestamp("acknowledged_at"),
    lastObservedAt: timestamp("last_observed_at"),
    terminalAt: timestamp("terminal_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_provider_invocation_attempt").on(table.capabilityAttemptId),
    uniqueIndex("uq_provider_invocation_stable_request").on(
      table.requestScopeDigest,
      table.stableRequestKey,
    ),
    index("ix_provider_invocation_reconcile").on(
      table.workState,
      table.nextReconcileAt,
      table.id,
    ),
    index("ix_provider_invocation_reconcile_lease").on(
      table.workState,
      table.reconcileLeaseExpiresAt,
      table.id,
    ),
    index("ix_provider_invocation_work").on(
      table.workState,
      table.updatedAt,
      table.id,
    ),
    index("ix_provider_invocation_provider_request").on(
      table.requestScopeDigest,
      table.providerRequestId,
    ),
    index("ix_provider_invocation_workspace").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("uq_provider_invocation_usage_scope").on(
      table.workspaceId,
      table.capabilityAttemptId,
      table.id,
    ),
  ],
);

export const providerInvocationObservationTable = mysqlTable(
  "provider_invocation_observation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerInvocationId: id("provider_invocation_id")
      .notNull()
      .references(() => providerInvocationTable.id),
    observationKey: varchar("observation_key", {
      length: 160,
    }).notNull(),
    operationKind: varchar("operation_kind", {
      length: 24,
    }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    normalizedStatus: varchar("normalized_status", {
      length: 24,
    }).notNull(),
    stableErrorCode: varchar("stable_error_code", {
      length: 120,
    }),
    requestDigest: digest("request_digest"),
    responseDigest: digest("response_digest"),
    providerEventDigest: digest("provider_event_digest"),
    resultFacts: json("result_facts"),
    executionGeneration: int("execution_generation", {
      unsigned: true,
    }).notNull(),
    adoptionOutcome: varchar("adoption_outcome", {
      length: 24,
    }).notNull(),
    observedAt: timestamp("observed_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_provider_observation_key").on(
      table.providerInvocationId,
      table.observationKey,
    ),
    index("ix_provider_observation_timeline").on(
      table.providerInvocationId,
      table.recordedAt,
      table.id,
    ),
    index("ix_provider_observation_workspace").on(
      table.workspaceId,
      table.recordedAt,
      table.id,
    ),
    index("ix_provider_observation_event").on(
      table.providerInvocationId,
      table.providerEventDigest,
    ),
  ],
);
