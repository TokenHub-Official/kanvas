import type { WorkspaceStatus } from "@kanvas/application";
import type { RuntimeAdapterDefinitionRevision } from "@kanvas/contracts/capability";
import {
  type AnyMySqlColumn,
  boolean,
  char,
  customType,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

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

const unsignedBigintString = customType<{
  data: string;
  driverData: string | number;
}>({
  dataType() {
    return "bigint unsigned";
  },
  fromDriver(value) {
    return String(value);
  },
  toDriver(value) {
    return value;
  },
});

export const workspaceTable = mysqlTable(
  "workspace",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", {
      length: 24,
    })
      .$type<WorkspaceStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workspace_slug").on(table.slug),
    uniqueIndex("uq_workspace_organization_id").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("uq_workspace_organization_slug").on(
      table.organizationId,
      table.slug,
    ),
    index("ix_workspace_organization_status").on(
      table.organizationId,
      table.status,
      table.id,
    ),
  ],
);

export const capabilityContractRevisionTable = mysqlTable(
  "capability_contract_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    contractKey: varchar("contract_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    inputSchema: json("input_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchema: json("output_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    presentation: json("presentation").$type<Record<string, unknown>>(),
    idempotencyMode: varchar("idempotency_mode", { length: 24 }).notNull(),
    supportedInvokers: json("supported_invokers")
      .$type<readonly string[]>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    uniqueIndex("uq_cap_contract_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_cap_contract_revision").on(
      table.workspaceId,
      table.contractKey,
      table.revision,
    ),
    uniqueIndex("uq_cap_contract_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
  ],
);

export const runtimeAdapterDefinitionTable = mysqlTable(
  "runtime_adapter_definition",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    adapterKey: varchar("adapter_key", { length: 160 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"active" | "archived">()
      .notNull(),
    currentRevisionId: id("current_revision_id").references(
      (): AnyMySqlColumn => runtimeAdapterRevisionTable.id,
    ),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_runtime_adapter_definition_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_runtime_adapter_definition_key").on(
      table.workspaceId,
      table.adapterKey,
    ),
    index("ix_runtime_adapter_definition_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const runtimeAdapterRevisionTable = mysqlTable(
  "runtime_adapter_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    runtimeAdapterDefinitionId: id("runtime_adapter_definition_id").notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"published" | "deprecated" | "revoked">()
      .notNull(),
    executionTarget: varchar("execution_target", { length: 24 })
      .$type<"browser" | "worker" | "provider">()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    document: json("document")
      .$type<RuntimeAdapterDefinitionRevision>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_runtime_adapter_revision_definition",
      columns: [table.workspaceId, table.runtimeAdapterDefinitionId],
      foreignColumns: [
        runtimeAdapterDefinitionTable.workspaceId,
        runtimeAdapterDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_runtime_adapter_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_runtime_adapter_revision_number").on(
      table.workspaceId,
      table.runtimeAdapterDefinitionId,
      table.revision,
    ),
    uniqueIndex("uq_runtime_adapter_revision_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
  ],
);

export const capabilityImplementationRevisionTable = mysqlTable(
  "capability_implementation_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    implementationKey: varchar("implementation_key", {
      length: 160,
    }).notNull(),
    displayName: json("display_name")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    description: json("description").$type<Readonly<Record<string, unknown>>>(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    contractRevisionId: id("contract_revision_id")
      .notNull()
      .references(() => capabilityContractRevisionTable.id),
    runtimeAdapterRevisionId: id("runtime_adapter_revision_id")
      .notNull()
      .references(() => runtimeAdapterRevisionTable.id),
    executionTarget: varchar("execution_target", { length: 24 }).notNull(),
    adapterKey: varchar("adapter_key", { length: 160 }).notNull(),
    sourceKind: varchar("source_kind", { length: 32 })
      .$type<"model_resource" | "model_service" | "plugin">()
      .notNull(),
    sourceReference: json("source_reference")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    publicationRequestKey: varchar("publication_request_key", {
      length: 160,
    }).notNull(),
    publicationRequestHash: digest("publication_request_hash").notNull(),
    configuration: json("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),
    inputMapping: json("input_mapping")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    inputMappingDigest: digest("input_mapping_digest").notNull(),
    compiledInputMapping: json("compiled_input_mapping")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    outputMapping: json("output_mapping")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    outputMappingDigest: digest("output_mapping_digest").notNull(),
    compiledOutputMapping: json("compiled_output_mapping")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    fixtureSuite: json("fixture_suite")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    uniqueIndex("uq_cap_impl_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_cap_impl_revision").on(
      table.workspaceId,
      table.implementationKey,
      table.revision,
    ),
    uniqueIndex("uq_cap_impl_publication_request").on(
      table.workspaceId,
      table.publicationRequestKey,
    ),
    index("ix_cap_impl_contract").on(
      table.workspaceId,
      table.contractRevisionId,
      table.lifecycleStatus,
    ),
    index("ix_cap_impl_adapter").on(
      table.workspaceId,
      table.runtimeAdapterRevisionId,
      table.lifecycleStatus,
    ),
  ],
);

export const capabilityBindingTable = mysqlTable(
  "capability_binding",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    bindingKey: varchar("binding_key", { length: 160 }).notNull(),
    contractRevisionId: id("contract_revision_id")
      .notNull()
      .references(() => capabilityContractRevisionTable.id),
    implementationRevisionId: id("implementation_revision_id")
      .notNull()
      .references(() => capabilityImplementationRevisionTable.id),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    priority: int("priority", { unsigned: true }).notNull(),
    version: int("version", { unsigned: true }).notNull(),
    routePolicy: json("route_policy")
      .$type<Record<string, unknown>>()
      .notNull(),
    routePolicyRevisionId: id("route_policy_revision_id"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_cap_binding_priority").on(
      table.workspaceId,
      table.contractRevisionId,
      table.priority,
    ),
    uniqueIndex("uq_cap_binding_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_cap_binding_key").on(table.workspaceId, table.bindingKey),
    index("ix_cap_binding_lookup").on(
      table.workspaceId,
      table.contractRevisionId,
      table.lifecycleStatus,
    ),
  ],
);

export type WorkflowDefinitionLifecycle = "active" | "archived";

export const workflowDefinitionTable = mysqlTable(
  "workflow_definition",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowKey: varchar("workflow_key", { length: 160 }).notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    description: varchar("description", { length: 1000 }),
    category: varchar("category", { length: 120 }),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 16,
    })
      .$type<WorkflowDefinitionLifecycle>()
      .notNull(),
    creationRequestKey: varchar("creation_request_key", {
      length: 160,
    }),
    creationRequestHash: digest("creation_request_hash"),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id").notNull(),
    updatedByPrincipalId: id("updated_by_principal_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workflow_definition_key").on(
      table.workspaceId,
      table.workflowKey,
    ),
    uniqueIndex("uq_workflow_definition_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_workflow_definition_creation_request").on(
      table.workspaceId,
      table.creationRequestKey,
    ),
    index("ix_workflow_definition_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const workflowRevisionTable = mysqlTable(
  "workflow_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowDefinitionId: id("workflow_definition_id").references(
      () => workflowDefinitionTable.id,
    ),
    workflowKey: varchar("workflow_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    topology: json("topology").$type<Record<string, unknown>>().notNull(),
    inputSchema: json("input_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchema: json("output_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    uniqueIndex("uq_workflow_revision").on(
      table.workspaceId,
      table.workflowKey,
      table.revision,
    ),
    uniqueIndex("uq_workflow_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
    uniqueIndex("uq_workflow_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_workflow_revision_definition").on(
      table.workspaceId,
      table.workflowDefinitionId,
      table.revision,
    ),
  ],
);

export const workflowRunTable = mysqlTable(
  "workflow_run",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    definitionKind: varchar("definition_kind", { length: 32 })
      .notNull()
      .$type<"published_revision" | "publication_candidate">(),
    workflowRevisionId: id("workflow_revision_id").references(
      () => workflowRevisionTable.id,
    ),
    publicationCandidateId: id("publication_candidate_id"),
    brandKitRevisionId: id("brand_kit_revision_id"),
    nonProduction: boolean("non_production").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    outcome: varchar("outcome", { length: 32 }),
    input: json("input").$type<unknown>().notNull(),
    output: json("output").$type<unknown>(),
    outputDigest: digest("output_digest"),
    terminalReasonCode: varchar("terminal_reason_code", {
      length: 120,
    }),
    executionDeadlineAt: timestamp("execution_deadline_at").notNull(),
    executionPlanSnapshot: json("execution_plan_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    executionPlanHash: digest("execution_plan_hash").notNull(),
    createdBy: id("created_by").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    cancelRequestedBy: id("cancel_requested_by"),
    cancelReasonCode: varchar("cancel_reason_code", { length: 64 }),
    cancelDeadlineAt: timestamp("cancel_deadline_at"),
  },
  (table) => [
    uniqueIndex("uq_workflow_run_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("uq_workflow_run_workspace_id").on(table.workspaceId, table.id),
    index("ix_workflow_run_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.createdAt,
    ),
    index("ix_workflow_run_reconcile").on(
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_workflow_run_cancel").on(
      table.lifecycleStatus,
      table.cancelDeadlineAt,
      table.updatedAt,
      table.id,
    ),
    index("ix_workflow_run_recent_by_creator").on(
      table.workspaceId,
      table.createdBy,
      table.definitionKind,
      table.nonProduction,
      table.lifecycleStatus,
      table.outcome,
      table.createdAt,
      table.id,
    ),
    index("ix_workflow_run_recent_by_creator_revision").on(
      table.workspaceId,
      table.createdBy,
      table.workflowRevisionId,
      table.definitionKind,
      table.nonProduction,
      table.lifecycleStatus,
      table.outcome,
      table.createdAt,
      table.id,
    ),
    index("ix_workflow_run_brand_recent").on(
      table.workspaceId,
      table.brandKitRevisionId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const nodeRunTable = mysqlTable(
  "node_run",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowRunId: id("workflow_run_id")
      .notNull()
      .references(() => workflowRunTable.id),
    nodeKey: varchar("node_key", { length: 100 }).notNull(),
    scopeKey: varchar("scope_key", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    waitingReason: varchar("waiting_reason", { length: 32 }),
    activatedAt: timestamp("activated_at"),
    activationReasonCode: varchar("activation_reason_code", {
      length: 120,
    }),
    activationDigest: digest("activation_digest"),
    input: json("input").$type<unknown>(),
    inputDigest: digest("input_digest"),
    output: json("output").$type<unknown>(),
    outputDigest: digest("output_digest"),
    error: json("error").$type<Record<string, unknown>>(),
    terminalReasonCode: varchar("terminal_reason_code", {
      length: 120,
    }),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("uq_node_run_scope").on(
      table.workflowRunId,
      table.nodeKey,
      table.scopeKey,
    ),
    index("ix_node_run_status").on(
      table.workspaceId,
      table.workflowRunId,
      table.lifecycleStatus,
    ),
    index("ix_node_run_activation").on(
      table.workflowRunId,
      table.activatedAt,
      table.lifecycleStatus,
      table.nodeKey,
      table.scopeKey,
    ),
  ],
);

export const capabilityRunTable = mysqlTable(
  "capability_run",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    nodeRunId: id("node_run_id").references(() => nodeRunTable.id),
    invocationKind: varchar("invocation_kind", { length: 24 })
      .$type<"user" | "agent" | "canvas" | "workflow">()
      .notNull(),
    invocationReferenceId: varchar("invocation_reference_id", {
      length: 160,
    }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }),
    requestHash: digest("request_hash"),
    createdBy: id("created_by").notNull(),
    input: json("input").$type<unknown>().notNull(),
    inputDigest: digest("input_digest").notNull(),
    routeSnapshot: json("route_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    routeSnapshotHash: digest("route_snapshot_hash").notNull(),
    executionDeadlineAt: timestamp("execution_deadline_at").notNull(),
    contractRevisionId: id("contract_revision_id")
      .notNull()
      .references(() => capabilityContractRevisionTable.id),
    bindingId: id("binding_id")
      .notNull()
      .references(() => capabilityBindingTable.id),
    implementationRevisionId: id("implementation_revision_id")
      .notNull()
      .references(() => capabilityImplementationRevisionTable.id),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    currentAttemptId: id("current_attempt_id"),
    acceptedAttemptId: id("accepted_attempt_id"),
    output: json("output").$type<unknown>(),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    cancelDeadlineAt: timestamp("cancel_deadline_at"),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("uq_cap_run_node").on(table.nodeRunId),
    uniqueIndex("uq_cap_run_idempotency").on(
      table.workspaceId,
      table.invocationKind,
      table.idempotencyKey,
    ),
    uniqueIndex("uq_capability_run_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_cap_run_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.createdAt,
    ),
    index("ix_capability_run_reconcile").on(
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_capability_run_cancel").on(
      table.lifecycleStatus,
      table.cancelDeadlineAt,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const capabilityAttemptTable = mysqlTable(
  "capability_attempt",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityRunId: id("capability_run_id")
      .notNull()
      .references(() => capabilityRunTable.id),
    bindingId: id("binding_id").notNull(),
    routeCandidateIndex: smallint("route_candidate_index", {
      unsigned: true,
    }).notNull(),
    candidateAttemptNumber: smallint("candidate_attempt_number", {
      unsigned: true,
    }).notNull(),
    transitionKind: varchar("transition_kind", { length: 16 })
      .$type<"initial" | "retry" | "fallback">()
      .notNull(),
    transitionReasonCode: varchar("transition_reason_code", {
      length: 120,
    }).notNull(),
    attemptNumber: int("attempt_number", { unsigned: true }).notNull(),
    executionTarget: varchar("execution_target", { length: 24 }).notNull(),
    implementationRevisionId: id("implementation_revision_id")
      .notNull()
      .references(() => capabilityImplementationRevisionTable.id),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull(),
    sideEffectState: varchar("side_effect_state", { length: 24 }).notNull(),
    retryDisposition: varchar("retry_disposition", { length: 24 }),
    notBefore: timestamp("not_before").notNull(),
    leaseGeneration: int("lease_generation", { unsigned: true })
      .notNull()
      .default(0),
    leaseTokenHash: char("lease_token_hash", { length: 64 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    executionDeadlineAt: timestamp("execution_deadline_at"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    cancelDeadlineAt: timestamp("cancel_deadline_at"),
    completionManifestHash: digest("completion_manifest_hash"),
    error: json("error").$type<Record<string, unknown>>(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_cap_attempt_binding_scope",
      columns: [table.workspaceId, table.bindingId],
      foreignColumns: [
        capabilityBindingTable.workspaceId,
        capabilityBindingTable.id,
      ],
    }),
    uniqueIndex("uq_cap_attempt_number").on(
      table.capabilityRunId,
      table.attemptNumber,
    ),
    uniqueIndex("uq_cap_attempt_candidate_attempt").on(
      table.capabilityRunId,
      table.routeCandidateIndex,
      table.candidateAttemptNumber,
    ),
    index("ix_cap_attempt_current_route").on(
      table.workspaceId,
      table.capabilityRunId,
      table.routeCandidateIndex,
      table.candidateAttemptNumber,
      table.lifecycleStatus,
    ),
    index("ix_cap_attempt_claim").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.notBefore,
    ),
    index("ix_capability_attempt_reconcile").on(
      table.lifecycleStatus,
      table.leaseExpiresAt,
      table.updatedAt,
      table.id,
    ),
    index("ix_capability_attempt_cancel").on(
      table.lifecycleStatus,
      table.cancelDeadlineAt,
      table.id,
    ),
    index("ix_capability_attempt_browser_claim").on(
      table.workspaceId,
      table.executionTarget,
      table.lifecycleStatus,
      table.notBefore,
      table.id,
    ),
    uniqueIndex("uq_cap_attempt_completion_scope").on(
      table.workspaceId,
      table.capabilityRunId,
      table.id,
    ),
    uniqueIndex("uq_cap_attempt_workspace_id").on(table.workspaceId, table.id),
  ],
);

export const storageCompatibilityProbeTable = mysqlTable(
  "storage_compatibility_probe",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    probeKey: varchar("probe_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    storageProfileId: id("storage_profile_id").notNull(),
    profileConfigurationHash: digest("profile_configuration_hash").notNull(),
    adapterKey: varchar("adapter_key", { length: 160 }).notNull(),
    adapterVersion: varchar("adapter_version", {
      length: 80,
    }).notNull(),
    capabilityContractVersion: smallint("capability_contract_version", {
      unsigned: true,
    }).notNull(),
    supportsConditionalCreate: tinyint("supports_conditional_create", {
      unsigned: true,
    }).notNull(),
    supportsServerOwnedWrite: tinyint("supports_server_owned_write", {
      unsigned: true,
    }).notNull(),
    supportsMultipart: tinyint("supports_multipart", {
      unsigned: true,
    }).notNull(),
    supportsRangeRead: tinyint("supports_range_read", {
      unsigned: true,
    }).notNull(),
    supportsVersionBoundIdentity: tinyint("supports_version_bound_identity", {
      unsigned: true,
    }).notNull(),
    supportsFullObjectChecksum: tinyint("supports_full_object_checksum", {
      unsigned: true,
    }).notNull(),
    sealedIdentityImmutable: tinyint("sealed_identity_immutable", {
      unsigned: true,
    }).notNull(),
    probeStatus: varchar("probe_status", { length: 16 }).notNull(),
    failureCode: varchar("failure_code", { length: 120 }),
    resultHash: digest("result_hash").notNull(),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    testedAt: timestamp("tested_at").notNull(),
    validUntil: timestamp("valid_until").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_storage_probe_request").on(
      table.workspaceId,
      table.probeKey,
    ),
    uniqueIndex("uq_storage_probe_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_storage_probe_profile").on(
      table.workspaceId,
      table.storageProfileId,
      table.profileConfigurationHash,
      table.probeStatus,
      table.validUntil,
    ),
  ],
);

export const uploadSessionTable = mysqlTable(
  "upload_session",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    attemptId: id("attempt_id"),
    purpose: varchar("purpose", { length: 40 }).notNull(),
    actorId: id("actor_id"),
    allocationRequestKey: varchar("allocation_request_key", {
      length: 160,
    }),
    allocationRequestHash: digest("allocation_request_hash"),
    outputRole: varchar("output_role", { length: 80 }),
    outputIndex: int("output_index", { unsigned: true }),
    expectedSize: unsignedBigintString("expected_size"),
    expectedMediaType: varchar("expected_media_type", { length: 160 }),
    expectedSha256: char("expected_sha256", { length: 64 }),
    storageProfileId: id("storage_profile_id").notNull(),
    compatibilityProbeId: id("compatibility_probe_id"),
    profileConfigurationHash: digest("profile_configuration_hash"),
    container: varchar("container", { length: 160 }).notNull(),
    objectKey: varchar("object_key", { length: 800 }).notNull(),
    uploadMode: varchar("upload_mode", { length: 32 }).notNull(),
    writeProtectionMode: varchar("write_protection_mode", {
      length: 32,
    }).notNull(),
    providerUploadId: varchar("provider_upload_id", { length: 240 }),
    uploadStartedAt: timestamp("upload_started_at"),
    sealManifestHash: digest("seal_manifest_hash"),
    sealStartedAt: timestamp("seal_started_at"),
    sealedIdentityHash: digest("sealed_identity_hash"),
    storageVersionId: varchar("storage_version_id", { length: 240 }),
    providerEtag: varchar("provider_etag", { length: 240 }),
    sealedAt: timestamp("sealed_at"),
    state: varchar("state", { length: 24 }).notNull(),
    stateReasonCode: varchar("state_reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    cleanupEligibleAt: timestamp("cleanup_eligible_at").notNull(),
    cleanupState: varchar("cleanup_state", { length: 24 }).notNull(),
    processingLeaseGeneration: int("processing_lease_generation", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    processingLeaseTokenHash: char("processing_lease_token_hash", {
      length: 64,
    }),
    processingClaimedAt: timestamp("processing_claimed_at"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
    verifiedSize: unsignedBigintString("verified_size"),
    verifiedSha256: char("verified_sha256", { length: 64 }),
    detectedMediaType: varchar("detected_media_type", { length: 160 }),
    verificationResultHash: digest("verification_result_hash"),
    verificationCompletedAt: timestamp("verification_completed_at"),
    verifiedAt: timestamp("verified_at"),
    verificationProfileVersion: varchar("verification_profile_version", {
      length: 80,
    }).notNull(),
    committedStoredObjectId: id("committed_stored_object_id"),
    cleanupTokenHash: char("cleanup_token_hash", { length: 64 }),
    cleanupClaimedAt: timestamp("cleanup_claimed_at"),
    cleanupLeaseExpiresAt: timestamp("cleanup_lease_expires_at"),
    cleanupAttempts: int("cleanup_attempts", { unsigned: true })
      .notNull()
      .default(0),
    cleanupRetryAt: timestamp("cleanup_retry_at"),
    cleanupErrorCode: varchar("cleanup_error_code", { length: 120 }),
    cleanupResult: varchar("cleanup_result", { length: 24 }),
    cleanedAt: timestamp("cleaned_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    committedAt: timestamp("committed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_upload_attempt_scope",
      columns: [table.workspaceId, table.attemptId],
      foreignColumns: [
        capabilityAttemptTable.workspaceId,
        capabilityAttemptTable.id,
      ],
    }),
    foreignKey({
      name: "fk_upload_probe_scope",
      columns: [table.workspaceId, table.compatibilityProbeId],
      foreignColumns: [
        storageCompatibilityProbeTable.workspaceId,
        storageCompatibilityProbeTable.id,
      ],
    }),
    uniqueIndex("uq_upload_object_identity").on(
      table.storageProfileId,
      table.container,
      table.objectKey,
    ),
    uniqueIndex("uq_upload_allocation_request").on(
      table.workspaceId,
      table.allocationRequestKey,
    ),
    uniqueIndex("uq_upload_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_upload_attempt_output").on(
      table.attemptId,
      table.outputRole,
      table.outputIndex,
    ),
    index("ix_upload_cleanup").on(
      table.workspaceId,
      table.state,
      table.cleanupState,
      table.cleanupEligibleAt,
    ),
    index("ix_upload_attempt_output_lookup").on(
      table.workspaceId,
      table.attemptId,
      table.outputRole,
      table.outputIndex,
    ),
    index("ix_upload_cleanup_global").on(
      table.cleanupState,
      table.cleanupLeaseExpiresAt,
      table.cleanupRetryAt,
      table.cleanupEligibleAt,
      table.state,
      table.id,
    ),
    index("ix_upload_processing_lease").on(
      table.processingLeaseExpiresAt,
      table.state,
      table.id,
    ),
  ],
);

export const storedObjectTable = mysqlTable(
  "stored_object",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    createdFromUploadSessionId: id("created_from_upload_session_id").notNull(),
    storageProfileId: id("storage_profile_id").notNull(),
    container: varchar("container", { length: 160 }).notNull(),
    objectKey: varchar("object_key", { length: 800 }).notNull(),
    storageVersionId: varchar("storage_version_id", { length: 240 }),
    providerEtag: varchar("provider_etag", { length: 240 }),
    immutableIdentityHash: digest("immutable_identity_hash"),
    byteSize: unsignedBigintString("byte_size").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    deleteState: varchar("delete_state", { length: 24 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_stored_upload_scope",
      columns: [table.workspaceId, table.createdFromUploadSessionId],
      foreignColumns: [uploadSessionTable.workspaceId, uploadSessionTable.id],
    }),
    uniqueIndex("uq_stored_upload").on(table.createdFromUploadSessionId),
    uniqueIndex("uq_stored_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_stored_identity").on(
      table.storageProfileId,
      table.container,
      table.objectKey,
    ),
    index("ix_stored_hash").on(table.workspaceId, table.sha256),
    index("ix_stored_delete").on(table.workspaceId, table.deleteState),
    index("ix_stored_delete_global").on(
      table.deleteState,
      table.createdAt,
      table.id,
    ),
  ],
);

export const artifactTable = mysqlTable(
  "artifact",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    assetId: id("asset_id"),
    createdByCapabilityRunId: id("created_by_capability_run_id"),
    createdByPrincipalId: id("created_by_principal_id"),
    storedObjectId: id("stored_object_id"),
    structuredContent: json("structured_content").$type<unknown>(),
    contentDigest: digest("content_digest").notNull(),
    artifactType: varchar("artifact_type", { length: 120 }).notNull(),
    availabilityStatus: varchar("availability_status", {
      length: 24,
    })
      .notNull()
      .default("available"),
    dataClassification: varchar("data_classification", {
      length: 24,
    })
      .notNull()
      .default("internal"),
    displayFilename: varchar("display_filename", { length: 255 }),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_artifact_stored_scope",
      columns: [table.workspaceId, table.storedObjectId],
      foreignColumns: [storedObjectTable.workspaceId, storedObjectTable.id],
    }),
    uniqueIndex("uq_artifact_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_artifact_workspace_asset_id").on(
      table.workspaceId,
      table.assetId,
      table.id,
    ),
    index("ix_artifact_workspace").on(table.workspaceId, table.createdAt),
    index("ix_artifact_asset").on(
      table.workspaceId,
      table.assetId,
      table.availabilityStatus,
      table.createdAt,
      table.id,
    ),
    index("ix_artifact_capability_run").on(
      table.workspaceId,
      table.createdByCapabilityRunId,
      table.createdAt,
      table.id,
    ),
    index("ix_artifact_availability").on(
      table.workspaceId,
      table.availabilityStatus,
      table.dataClassification,
      table.createdAt,
      table.id,
    ),
  ],
);

export const attemptOutputTable = mysqlTable(
  "attempt_output",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityAttemptId: id("capability_attempt_id").notNull(),
    outputRole: varchar("output_role", { length: 80 }).notNull(),
    outputIndex: int("output_index", { unsigned: true }).notNull(),
    artifactId: id("artifact_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_attempt_output_attempt_scope",
      columns: [table.workspaceId, table.capabilityAttemptId],
      foreignColumns: [
        capabilityAttemptTable.workspaceId,
        capabilityAttemptTable.id,
      ],
    }),
    foreignKey({
      name: "fk_attempt_output_artifact_scope",
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    uniqueIndex("uq_attempt_output_role").on(
      table.capabilityAttemptId,
      table.outputRole,
      table.outputIndex,
    ),
  ],
);

export const outboxEventTable = mysqlTable(
  "outbox_event",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    messageType: varchar("message_type", { length: 120 }).notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true })
      .notNull()
      .default(1),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: id("aggregate_id").notNull(),
    aggregateVersion: int("aggregate_version", { unsigned: true }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    availableAt: timestamp("available_at").notNull(),
    leaseTokenHash: char("lease_token_hash", { length: 64 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    publishAttempts: int("publish_attempts", { unsigned: true })
      .notNull()
      .default(0),
    publishedAt: timestamp("published_at"),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    quarantinedAt: timestamp("quarantined_at"),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("ix_outbox_relay").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    index("ix_outbox_aggregate").on(
      table.workspaceId,
      table.aggregateType,
      table.aggregateId,
    ),
    uniqueIndex("uq_outbox_workspace_id").on(table.workspaceId, table.id),
  ],
);

export const inboxReceiptTable = mysqlTable(
  "inbox_receipt",
  {
    consumerName: varchar("consumer_name", { length: 120 }).notNull(),
    eventId: id("event_id").notNull(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    messageType: varchar("message_type", { length: 120 }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: id("aggregate_id").notNull(),
    aggregateVersion: int("aggregate_version", { unsigned: true }).notNull(),
    expectedGeneration: int("expected_generation", {
      unsigned: true,
    }).notNull(),
    effectOutcome: varchar("effect_outcome", { length: 24 }).notNull(),
    resultCode: varchar("result_code", { length: 120 }).notNull(),
    receivedAt: timestamp("received_at").notNull(),
    processedAt: timestamp("processed_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.consumerName, table.eventId],
    }),
    index("ix_inbox_workspace").on(
      table.workspaceId,
      table.processedAt,
      table.eventId,
    ),
    index("ix_inbox_aggregate").on(
      table.consumerName,
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
  ],
);

export const queueDeliveryFailureTable = mysqlTable(
  "queue_delivery_failure",
  {
    consumerName: varchar("consumer_name", { length: 120 }).notNull(),
    queueName: varchar("queue_name", { length: 120 }).notNull(),
    jobId: varchar("job_id", { length: 160 }).notNull(),
    outboxEventId: id("outbox_event_id"),
    errorCode: varchar("error_code", { length: 120 }).notNull(),
    occurrenceCount: int("occurrence_count", { unsigned: true })
      .notNull()
      .default(1),
    resolutionStatus: varchar("resolution_status", {
      length: 24,
    }).notNull(),
    firstObservedAt: timestamp("first_observed_at").notNull(),
    lastObservedAt: timestamp("last_observed_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    primaryKey({
      columns: [table.consumerName, table.queueName, table.jobId],
    }),
    index("ix_queue_delivery_failure_status").on(
      table.resolutionStatus,
      table.lastObservedAt,
      table.consumerName,
      table.queueName,
    ),
    index("ix_queue_delivery_failure_event").on(
      table.outboxEventId,
      table.consumerName,
    ),
  ],
);
