import { sql } from "drizzle-orm";
import {
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  capabilityAttemptTable,
  capabilityRunTable,
  nodeRunTable,
  outboxEventTable,
  workflowRevisionTable,
  workflowRunTable,
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

export type WorkflowEdgeActivationKind =
  "entry" | "declared" | "switch" | "map_item";

export type WorkflowApprovalStatus =
  "pending" | "decided" | "expired" | "cancelled";

export type WorkflowMapFailureMode = "collect_all" | "fail_fast";

export type WorkflowMapStatus =
  "expanding" | "waiting" | "completed" | "fail_fast_stopping" | "failed";

export type WorkflowOutputResolution = "resolved" | "missing" | "invalid";

export const workflowSwitchDecisionTable = mysqlTable(
  "workflow_switch_decision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    nodeRunId: id("node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    inputValue: json("input_value").$type<unknown>().notNull(),
    inputDigest: digest("input_digest").notNull(),
    matchedCaseIndex: smallint("matched_case_index", {
      unsigned: true,
    }),
    selectedTargets: json("selected_targets")
      .$type<readonly string[]>()
      .notNull(),
    decisionDigest: digest("decision_digest").notNull(),
    decidedAt: timestamp("decided_at").notNull(),
  },
  (table) => [
    check(
      "chk_workflow_switch_targets",
      sql`JSON_TYPE(${table.selectedTargets}) = 'ARRAY' AND JSON_LENGTH(${table.selectedTargets}) BETWEEN 0 AND 20`,
    ),
    uniqueIndex("uq_workflow_switch_node").on(table.nodeRunId),
    uniqueIndex("uq_workflow_switch_digest").on(
      table.workflowRunId,
      table.decisionDigest,
    ),
    index("ix_workflow_switch_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.decidedAt,
    ),
  ],
);

export const workflowActivatedEdgeTable = mysqlTable(
  "workflow_activated_edge",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    sourceNodeRunId: id("source_node_run_id").references(() => nodeRunTable.id),
    sourceNodeKey: varchar("source_node_key", {
      length: 100,
    }).notNull(),
    sourceScopeKey: varchar("source_scope_key", {
      length: 160,
    }).notNull(),
    sourceNodeVersion: int("source_node_version", {
      unsigned: true,
    }).notNull(),
    targetNodeRunId: id("target_node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    targetNodeKey: varchar("target_node_key", {
      length: 100,
    }).notNull(),
    targetScopeKey: varchar("target_scope_key", {
      length: 160,
    }).notNull(),
    activationKind: varchar("activation_kind", {
      length: 16,
    })
      .$type<WorkflowEdgeActivationKind>()
      .notNull(),
    switchDecisionId: id("switch_decision_id").references(
      () => workflowSwitchDecisionTable.id,
    ),
    activationDigest: digest("activation_digest").notNull(),
    activatedAt: timestamp("activated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_edge").on(
      table.workflowRunId,
      table.sourceNodeKey,
      table.sourceScopeKey,
      table.targetNodeKey,
      table.targetScopeKey,
    ),
    index("ix_workflow_edge_target").on(
      table.workflowRunId,
      table.targetNodeRunId,
      table.activatedAt,
    ),
    index("ix_workflow_edge_source").on(
      table.workflowRunId,
      table.sourceNodeRunId,
      table.activatedAt,
    ),
  ],
);

export const workflowApprovalRequestTable = mysqlTable(
  "workflow_approval_request",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    nodeRunId: id("node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    definitionKind: varchar("definition_kind", { length: 32 })
      .notNull()
      .$type<"published_revision" | "publication_candidate">(),
    workflowRevisionId: id("workflow_revision_id").references(
      () => workflowRevisionTable.id,
    ),
    publicationCandidateId: id("publication_candidate_id"),
    executionPlanHash: digest("execution_plan_hash").notNull(),
    nodeInput: json("node_input").$type<unknown>().notNull(),
    nodeInputDigest: digest("node_input_digest").notNull(),
    requestPayload: json("request_payload").$type<unknown>().notNull(),
    requestDigest: digest("request_digest").notNull(),
    decisionSchema: json("decision_schema")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    decisionSchemaDigest: digest("decision_schema_digest").notNull(),
    requiredPermission: varchar("required_permission", {
      length: 120,
    }).notNull(),
    authorizationContextDigest: digest(
      "authorization_context_digest",
    ).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_approval_node").on(table.nodeRunId),
    uniqueIndex("uq_workflow_approval_request_scope").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_workflow_approval_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.createdAt,
    ),
  ],
);

export const workflowApprovalStateTable = mysqlTable(
  "workflow_approval_state",
  {
    approvalRequestId: id("approval_request_id")
      .primaryKey()
      .references(() => workflowApprovalRequestTable.id),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 16,
    })
      .$type<WorkflowApprovalStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    decidedAt: timestamp("decided_at"),
    expiredAt: timestamp("expired_at"),
    cancelledAt: timestamp("cancelled_at"),
  },
  (table) => [
    index("ix_workflow_approval_state_due").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.approvalRequestId,
    ),
  ],
);

export const workflowApprovalDecisionTable = mysqlTable(
  "workflow_approval_decision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    approvalRequestId: id("approval_request_id")
      .notNull()
      .references(() => workflowApprovalRequestTable.id),
    actorPrincipalId: id("actor_principal_id").notNull(),
    authorizationDecisionId: varchar("authorization_decision_id", {
      length: 160,
    }).notNull(),
    authorizationContext: json("authorization_context")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    authorizationDigest: digest("authorization_digest").notNull(),
    decision: json("decision").$type<unknown>().notNull(),
    decisionDigest: digest("decision_digest").notNull(),
    decidedAt: timestamp("decided_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_decision_request").on(table.approvalRequestId),
    uniqueIndex("uq_workflow_decision_authorization").on(
      table.workspaceId,
      table.authorizationDecisionId,
    ),
  ],
);

export const workflowMapExpansionTable = mysqlTable(
  "workflow_map_expansion",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    coordinatorNodeRunId: id("coordinator_node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    items: json("items").$type<readonly unknown[]>().notNull(),
    itemsDigest: digest("items_digest").notNull(),
    scopeKeys: json("scope_keys").$type<readonly string[]>().notNull(),
    scopeKeysDigest: digest("scope_keys_digest").notNull(),
    itemCount: int("item_count", { unsigned: true }).notNull(),
    maxItems: int("max_items", { unsigned: true }).notNull(),
    maxConcurrency: int("max_concurrency", {
      unsigned: true,
    }).notNull(),
    failureMode: varchar("failure_mode", {
      length: 16,
    })
      .$type<WorkflowMapFailureMode>()
      .notNull(),
    expansionDigest: digest("expansion_digest").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_map_coordinator").on(table.coordinatorNodeRunId),
    uniqueIndex("uq_workflow_map_expansion_scope").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_workflow_map_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.createdAt,
    ),
  ],
);

export const workflowMapStateTable = mysqlTable(
  "workflow_map_state",
  {
    mapExpansionId: id("map_expansion_id")
      .primaryKey()
      .references(() => workflowMapExpansionTable.id),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<WorkflowMapStatus>()
      .notNull(),
    nextItemIndex: int("next_item_index", {
      unsigned: true,
    }).notNull(),
    activeCount: int("active_count", { unsigned: true }).notNull(),
    completedCount: int("completed_count", {
      unsigned: true,
    }).notNull(),
    failedCount: int("failed_count", { unsigned: true }).notNull(),
    cancelledCount: int("cancelled_count", {
      unsigned: true,
    }).notNull(),
    skippedCount: int("skipped_count", {
      unsigned: true,
    }).notNull(),
    stopReasonCode: varchar("stop_reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("ix_workflow_map_state_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.mapExpansionId,
    ),
  ],
);

export const workflowMapItemTable = mysqlTable(
  "workflow_map_item",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    mapExpansionId: id("map_expansion_id")
      .notNull()
      .references(() => workflowMapExpansionTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    coordinatorNodeRunId: id("coordinator_node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    itemNodeRunId: id("item_node_run_id")
      .notNull()
      .references(() => nodeRunTable.id),
    itemIndex: int("item_index", { unsigned: true }).notNull(),
    scopeKey: varchar("scope_key", { length: 160 }).notNull(),
    itemValue: json("item_value").$type<unknown>().notNull(),
    itemDigest: digest("item_digest").notNull(),
    inputDigest: digest("input_digest").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_map_item_index").on(
      table.mapExpansionId,
      table.itemIndex,
    ),
    uniqueIndex("uq_workflow_map_item_node").on(table.itemNodeRunId),
    uniqueIndex("uq_workflow_map_item_scope").on(
      table.workflowRunId,
      table.coordinatorNodeRunId,
      table.scopeKey,
    ),
  ],
);

export const workflowOutputFactTable = mysqlTable(
  "workflow_output_fact",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    outputKey: varchar("output_key", { length: 100 }).notNull(),
    required: tinyint("required", { unsigned: true }).$type<0 | 1>().notNull(),
    resolutionStatus: varchar("resolution_status", {
      length: 16,
    })
      .$type<WorkflowOutputResolution>()
      .notNull(),
    value: json("value").$type<unknown>(),
    valueDigest: digest("value_digest"),
    reasonCode: varchar("reason_code", { length: 120 }),
    sourceRunVersion: int("source_run_version", {
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_output_key").on(
      table.workflowRunId,
      table.outputKey,
    ),
    index("ix_workflow_output_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.createdAt,
    ),
  ],
);

export const workflowDeadlineScheduleTable = mysqlTable(
  "workflow_deadline_schedule",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    executionPlanHash: digest("execution_plan_hash").notNull(),
    executionDeadlineAt: timestamp("execution_deadline_at").notNull(),
    outboxEventId: id("outbox_event_id")
      .notNull()
      .references(() => outboxEventTable.id),
    scheduleDigest: digest("schedule_digest").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_deadline_run").on(table.workflowRunId),
    uniqueIndex("uq_workflow_deadline_outbox").on(table.outboxEventId),
    index("ix_workflow_deadline_due").on(
      table.workspaceId,
      table.executionDeadlineAt,
      table.workflowRunId,
    ),
  ],
);

export const workflowCapabilityCancellationRequestTable = mysqlTable(
  "workflow_capability_cancellation_request",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    capabilityRunId: id("capability_run_id")
      .notNull()
      .references(() => capabilityRunTable.id),
    capabilityAttemptId: id("capability_attempt_id")
      .notNull()
      .references(() => capabilityAttemptTable.id),
    sourceKind: varchar("source_kind", { length: 24 })
      .$type<"workflow_deadline" | "map_fail_fast">()
      .notNull(),
    sourceId: id("source_id").notNull(),
    reasonCode: varchar("reason_code", { length: 120 }).notNull(),
    requestedAt: timestamp("requested_at").notNull(),
    cancelDeadlineAt: timestamp("cancel_deadline_at").notNull(),
    requestDigest: digest("request_digest").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_cap_cancel_capability").on(table.capabilityRunId),
    index("ix_workflow_cap_cancel_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.requestedAt,
      table.capabilityRunId,
    ),
  ],
);
