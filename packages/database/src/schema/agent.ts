import type {
  AgentActionApprovalMode,
  AgentActionEffect,
  AgentActionStatus,
  AgentContextSnapshotV1,
  AgentInteractionStatus,
  AgentQuestionRequestV1,
  AgentQuestionResponseV1,
  AgentModelAttemptStatus,
  AgentModelCallPurpose,
  AgentModelCallStatus,
  AgentRunStatus,
  AgentThreadLifecycle,
  AgentVisibleMessageV1,
  AgentModelMessagesV1,
} from "@kanvas/application";
import {
  bigint,
  boolean,
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mediumtext,
  decimal,
  mysqlTable,
  primaryKey,
  smallint,
  uniqueIndex,
  varchar,
  type MySqlTableExtraConfigValue,
} from "drizzle-orm/mysql-core";

import { canvasDraftTable } from "./canvas-draft.js";
import { brandKitRevisionTable } from "./brand.js";
import {
  capabilityRunTable,
  workflowDefinitionTable,
  workflowRunTable,
  workspaceTable,
} from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";
import { agentDefinitionTable } from "./agent-hub.js";
import {
  credentialTable,
  budgetAccountTable,
  modelDeploymentTable,
  modelProfileRevisionTable,
  pricingRevisionTable,
  providerEndpointTable,
} from "./configuration-provider.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export const agentThreadTable = mysqlTable(
  "agent_thread",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    agentDefinitionId: id("agent_definition_id").notNull(),
    agentProfileRevisionId: id("agent_profile_revision_id").notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<AgentThreadLifecycle>()
      .notNull(),
    title: varchar("title", { length: 240 }),
    titleSource: varchar("title_source", { length: 16 })
      .$type<"auto" | "manual">()
      .notNull(),
    activeLeafMessageId: id("active_leaf_message_id"),
    activeRunId: id("active_run_id"),
    creationRequestKey: varchar("creation_request_key", {
      length: 160,
    }).notNull(),
    creationRequestHash: digest("creation_request_hash").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    viewRevision: bigint("view_revision", { mode: "number", unsigned: true })
      .notNull()
      .default(1),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_agent_thread_active_run",
      columns: [table.workspaceId, table.activeRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    index("ix_agent_thread_active_run").on(
      table.workspaceId,
      table.activeRunId,
    ),
    foreignKey({
      name: "fk_agent_thread_definition",
      columns: [table.workspaceId, table.agentDefinitionId],
      foreignColumns: [
        agentDefinitionTable.workspaceId,
        agentDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_agent_thread_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_agent_thread_creation_request").on(
      table.workspaceId,
      table.creationRequestKey,
    ),
    index("ix_agent_thread_recent").on(
      table.workspaceId,
      table.createdByPrincipalId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const agentThreadMemoryTable = mysqlTable(
  "agent_thread_memory",
  {
    workspaceId: id("workspace_id").notNull(),
    threadId: id("thread_id").notNull(),
    activeObservations: mediumtext("active_observations").notNull(),
    observationsDigest: digest("observations_digest").notNull(),
    lastObservedAt: timestamp("last_observed_at").notNull(),
    observerModelBindingKey: varchar("observer_model_binding_key", {
      length: 96,
    }).notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.threadId] }),
    foreignKey({
      name: "fk_agent_thread_memory_thread",
      columns: [table.workspaceId, table.threadId],
      foreignColumns: [agentThreadTable.workspaceId, agentThreadTable.id],
    }),
  ],
);

export const agentRunTable = mysqlTable(
  "agent_run",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    threadId: id("thread_id").notNull(),
    parentRunId: id("parent_run_id"),
    triggerMessageId: id("trigger_message_id"),
    actorPrincipalId: id("actor_principal_id")
      .notNull()
      .references(() => principalTable.id),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<AgentRunStatus>()
      .notNull(),
    contextSnapshot: json("context_snapshot")
      .$type<AgentContextSnapshotV1>()
      .notNull(),
    contextDigest: digest("context_digest").notNull(),
    toolViewDigest: digest("tool_view_digest").notNull(),
    promptRevision: varchar("prompt_revision", { length: 80 }).notNull(),
    runtimeTimeoutSeconds: smallint("runtime_timeout_seconds", {
      unsigned: true,
    }),
    runtimeConfigurationVersion: int("runtime_configuration_version", {
      unsigned: true,
    }),
    maximumModelCalls: smallint("maximum_model_calls", {
      unsigned: true,
    }).notNull(),
    maximumToolCalls: smallint("maximum_tool_calls", {
      unsigned: true,
    }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    terminalReasonCode: varchar("terminal_reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    executionDeadlineAt: timestamp("execution_deadline_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_run_thread",
      columns: [table.workspaceId, table.threadId],
      foreignColumns: [agentThreadTable.workspaceId, agentThreadTable.id],
    }),
    uniqueIndex("uq_agent_run_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_agent_run_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_agent_run_thread_recent").on(
      table.workspaceId,
      table.threadId,
      table.createdAt,
      table.id,
    ),
    index("ix_agent_run_active").on(
      table.lifecycleStatus,
      table.executionDeadlineAt,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const agentMessageTable = mysqlTable(
  "agent_message",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    threadId: id("thread_id").notNull(),
    agentRunId: id("agent_run_id"),
    parentMessageId: id("parent_message_id"),
    sequenceNumber: int("sequence_number", { unsigned: true }).notNull(),
    alternativeIndex: int("alternative_index", { unsigned: true }).notNull(),
    role: varchar("role", { length: 16 })
      .$type<"user" | "assistant">()
      .notNull(),
    content: json("content").$type<AgentVisibleMessageV1>().notNull(),
    modelMessages: json("model_messages").$type<AgentModelMessagesV1>(),
    contentDigest: digest("content_digest").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_message_thread",
      columns: [table.workspaceId, table.threadId],
      foreignColumns: [agentThreadTable.workspaceId, agentThreadTable.id],
    }),
    foreignKey({
      name: "fk_agent_message_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    uniqueIndex("uq_agent_message_sequence").on(
      table.threadId,
      table.sequenceNumber,
    ),
    index("ix_agent_message_run").on(
      table.workspaceId,
      table.agentRunId,
      table.sequenceNumber,
    ),
  ],
);

export const agentModelCallTable = mysqlTable(
  "agent_model_call",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").notNull(),
    callNumber: smallint("call_number", { unsigned: true }).notNull(),
    purpose: varchar("purpose", { length: 32 })
      .$type<AgentModelCallPurpose>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<AgentModelCallStatus>()
      .notNull(),
    modelProfileKey: varchar("model_profile_key", { length: 96 }).notNull(),
    inputDigest: digest("input_digest").notNull(),
    outputDigest: digest("output_digest"),
    proposalDocument:
      json("proposal_document").$type<Readonly<Record<string, unknown>>>(),
    finishReason: varchar("finish_reason", { length: 40 }),
    terminalReasonCode: varchar("terminal_reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_model_call_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    uniqueIndex("uq_agent_model_call_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_agent_model_call_number").on(
      table.agentRunId,
      table.callNumber,
    ),
    index("ix_agent_model_call_status").on(
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const agentModelAttemptTable = mysqlTable(
  "agent_model_attempt",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    agentModelCallId: id("agent_model_call_id").notNull(),
    attemptNumber: smallint("attempt_number", { unsigned: true }).notNull(),
    transitionKind: varchar("transition_kind", { length: 16 })
      .$type<"initial" | "retry" | "fallback">()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<AgentModelAttemptStatus>()
      .notNull(),
    routeSnapshot: json("route_snapshot")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    routeDigest: digest("route_digest").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 512 }),
    acceptedMarker: boolean("accepted_marker"),
    usageDocument:
      json("usage_document").$type<Readonly<Record<string, unknown>>>(),
    usageDigest: digest("usage_digest"),
    terminalReasonCode: varchar("terminal_reason_code", { length: 120 }),
    createdAt: timestamp("created_at").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_model_attempt_call",
      columns: [table.workspaceId, table.agentModelCallId],
      foreignColumns: [agentModelCallTable.workspaceId, agentModelCallTable.id],
    }),
    uniqueIndex("uq_agent_model_attempt_number").on(
      table.agentModelCallId,
      table.attemptNumber,
    ),
    uniqueIndex("uq_agent_model_attempt_accepted").on(
      table.agentModelCallId,
      table.acceptedMarker,
    ),
    index("ix_agent_model_attempt_status").on(
      table.lifecycleStatus,
      table.createdAt,
      table.id,
    ),
  ],
);

export const agentActionReceiptTable = mysqlTable(
  "agent_action_receipt",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").notNull(),
    actionNumber: smallint("action_number", { unsigned: true }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 160 }).notNull(),
    toolKey: varchar("tool_key", { length: 96 }).notNull(),
    effect: varchar("effect", { length: 24 })
      .$type<AgentActionEffect>()
      .notNull(),
    approvalMode: varchar("approval_mode", { length: 24 })
      .$type<AgentActionApprovalMode>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<AgentActionStatus>()
      .notNull(),
    inputDigest: digest("input_digest").notNull(),
    outputDigest: digest("output_digest"),
    outcomeKind: varchar("outcome_kind", { length: 32 }),
    queryResultCount: int("query_result_count", { unsigned: true }),
    queryDiagnostics: json("query_diagnostics").$type<unknown>(),
    canvasDraftId: id("canvas_draft_id"),
    capabilityRunId: id("capability_run_id"),
    workflowRunId: id("workflow_run_id"),
    workflowDefinitionId: id("workflow_definition_id"),
    skillDraftId: id("skill_draft_id"),
    brandKitId: id("brand_kit_id"),
    brandKitRevisionId: id("brand_kit_revision_id"),
    beforeVersion: int("before_version", { unsigned: true }),
    afterVersion: int("after_version", { unsigned: true }),
    undoGroupId: varchar("undo_group_id", { length: 160 }),
    terminalReasonCode: varchar("terminal_reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_action_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_action_canvas",
      columns: [table.workspaceId, table.canvasDraftId],
      foreignColumns: [canvasDraftTable.workspaceId, canvasDraftTable.id],
    }),
    foreignKey({
      name: "fk_agent_action_capability",
      columns: [table.workspaceId, table.capabilityRunId],
      foreignColumns: [capabilityRunTable.workspaceId, capabilityRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_action_workflow_run",
      columns: [table.workspaceId, table.workflowRunId],
      foreignColumns: [workflowRunTable.workspaceId, workflowRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_action_workflow_definition",
      columns: [table.workspaceId, table.workflowDefinitionId],
      foreignColumns: [
        workflowDefinitionTable.workspaceId,
        workflowDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_action_brand_revision",
      columns: [table.workspaceId, table.brandKitId, table.brandKitRevisionId],
      foreignColumns: [
        brandKitRevisionTable.workspaceId,
        brandKitRevisionTable.brandKitId,
        brandKitRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_agent_action_number").on(
      table.agentRunId,
      table.actionNumber,
    ),
    uniqueIndex("uq_agent_action_tool_call").on(
      table.agentRunId,
      table.toolCallId,
    ),
    index("ix_agent_action_status").on(
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const agentInteractionTable = mysqlTable(
  "agent_interaction",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").notNull(),
    assistantMessageId: id("assistant_message_id").notNull(),
    interactionNumber: smallint("interaction_number", {
      unsigned: true,
    }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 256 }).notNull(),
    toolKey: varchar("tool_key", { length: 96 })
      .$type<"builtin.ask-question">()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<AgentInteractionStatus>()
      .notNull(),
    requestDocument: json("request_document")
      .$type<AgentQuestionRequestV1>()
      .notNull(),
    requestDigest: digest("request_digest").notNull(),
    responseDocument:
      json("response_document").$type<AgentQuestionResponseV1>(),
    responseDigest: digest("response_digest"),
    checkpointDocument: json("checkpoint_document").$type<unknown>().notNull(),
    checkpointDigest: digest("checkpoint_digest").notNull(),
    resolutionRequestKey: varchar("resolution_request_key", { length: 160 }),
    resolvedByPrincipalId: id("resolved_by_principal_id"),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_interaction_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_interaction_message",
      columns: [table.assistantMessageId],
      foreignColumns: [agentMessageTable.id],
    }),
    foreignKey({
      name: "fk_agent_interaction_resolver",
      columns: [table.resolvedByPrincipalId],
      foreignColumns: [principalTable.id],
    }),
    uniqueIndex("uq_agent_interaction_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_agent_interaction_number").on(
      table.agentRunId,
      table.interactionNumber,
    ),
    uniqueIndex("uq_agent_interaction_tool_call").on(
      table.agentRunId,
      table.toolCallId,
    ),
    index("ix_agent_interaction_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_agent_interaction_message").on(
      table.workspaceId,
      table.assistantMessageId,
      table.id,
    ),
  ],
);

export const agentModelBindingTable = mysqlTable(
  "agent_model_binding",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    bindingKey: varchar("binding_key", { length: 96 }).notNull(),
    modelProfileRevisionId: id("model_profile_revision_id").notNull(),
    modelDeploymentId: id("model_deployment_id").notNull(),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    credentialId: id("credential_id").notNull(),
    budgetAccountId: id("budget_account_id").notNull(),
    maximumChargeCurrencyCode: char("maximum_charge_currency_code", {
      length: 3,
    }).notNull(),
    maximumChargeAmount: decimal("maximum_charge_amount", {
      precision: 36,
      scale: 12,
      mode: "string",
    }).notNull(),
    pricingRevisionId: id("pricing_revision_id").notNull(),
    apiSurface: varchar("api_surface", { length: 40 })
      .$type<
        | "chat.completions.v1"
        | "responses.v1"
        | "generate-content.v1"
        | "messages.v1"
      >()
      .notNull(),
    protocolKind: varchar("protocol_kind", { length: 32 })
      .$type<
        | "openai_chat"
        | "deepseek_chat"
        | "openai_responses"
        | "gemini_generate_content"
        | "anthropic_messages"
      >()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<"enabled" | "disabled">()
      .notNull(),
    routeDigest: digest("route_digest").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    disabledAt: timestamp("disabled_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_model_binding_profile",
      columns: [table.workspaceId, table.modelProfileRevisionId],
      foreignColumns: [
        modelProfileRevisionTable.workspaceId,
        modelProfileRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_model_binding_deployment",
      columns: [table.workspaceId, table.modelDeploymentId],
      foreignColumns: [
        modelDeploymentTable.workspaceId,
        modelDeploymentTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_model_binding_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_model_binding_credential",
      columns: [table.workspaceId, table.credentialId],
      foreignColumns: [credentialTable.workspaceId, credentialTable.id],
    }),
    foreignKey({
      name: "fk_agent_model_binding_pricing",
      columns: [table.workspaceId, table.pricingRevisionId],
      foreignColumns: [
        pricingRevisionTable.workspaceId,
        pricingRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_model_binding_budget",
      columns: [table.workspaceId, table.budgetAccountId],
      foreignColumns: [budgetAccountTable.workspaceId, budgetAccountTable.id],
    }),
    uniqueIndex("uq_agent_model_binding_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_agent_model_binding_key").on(
      table.workspaceId,
      table.bindingKey,
    ),
    uniqueIndex("uq_agent_model_binding_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_agent_model_binding_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);
