import { resourceLibraryTable } from "./resource-library.js";
import type {
  AgentProfileManifestV1,
  AgentRunSkillContextV1,
  AgentSurfaceKind,
} from "@kanvas/application";
import {
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { workspaceTable } from "./execution-core.js";
import { workflowDefinitionTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";
import { agentRunTable } from "./agent.js";
import { agentDefinitionTable, skillDefinitionTable } from "./agent-hub.js";
import { brandKitTable } from "./brand.js";
import { skillRevisionTable } from "./publication.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export type AgentProfileLifecycle = "published" | "deprecated";
export type AgentProfileRuntimeStatus = "enabled" | "disabled" | "revoked";
export type AgentRunSkillUseSource = "bound" | "explicit" | "discovered";

export const agentProfileRevisionTable = mysqlTable(
  "agent_profile_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    agentDefinitionId: id("agent_definition_id").notNull(),
    profileKey: varchar("profile_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<AgentProfileLifecycle>()
      .notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    manifestDocument: json("manifest_document")
      .$type<AgentProfileManifestV1>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    publishedByPrincipalId: id("published_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_profile_revision_definition",
      columns: [table.workspaceId, table.agentDefinitionId],
      foreignColumns: [
        agentDefinitionTable.workspaceId,
        agentDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_agent_profile_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_agent_profile_revision_number").on(
      table.workspaceId,
      table.profileKey,
      table.revision,
    ),
    index("ix_agent_profile_revision_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
  ],
);

export const agentRevisionSkillBindingTable = mysqlTable(
  "agent_revision_skill_binding",
  {
    workspaceId: id("workspace_id").notNull(),
    profileRevisionId: id("profile_revision_id").notNull(),
    skillDefinitionId: id("skill_definition_id").notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.profileRevisionId,
        table.skillDefinitionId,
      ],
    }),
    foreignKey({
      name: "fk_agent_revision_skill_profile",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_revision_skill_definition",
      columns: [table.workspaceId, table.skillDefinitionId],
      foreignColumns: [
        skillDefinitionTable.workspaceId,
        skillDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_agent_revision_skill_ordinal").on(
      table.profileRevisionId,
      table.ordinal,
    ),
  ],
);

export const agentRevisionBrandBindingTable = mysqlTable(
  "agent_revision_brand_binding",
  {
    workspaceId: id("workspace_id").notNull(),
    profileRevisionId: id("profile_revision_id").notNull(),
    brandKitId: id("brand_kit_id").notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.profileRevisionId, table.brandKitId],
    }),
    foreignKey({
      name: "fk_agent_revision_brand_profile",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_revision_brand_kit",
      columns: [table.workspaceId, table.brandKitId],
      foreignColumns: [brandKitTable.workspaceId, brandKitTable.id],
    }),
    uniqueIndex("uq_agent_revision_brand_ordinal").on(
      table.profileRevisionId,
      table.ordinal,
    ),
  ],
);

export const agentRevisionLibraryBindingTable = mysqlTable(
  "agent_revision_library_binding",
  {
    workspaceId: id("workspace_id").notNull(),
    profileRevisionId: id("profile_revision_id").notNull(),
    libraryId: id("library_id").notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.profileRevisionId, table.libraryId],
    }),
    foreignKey({
      name: "fk_agent_library_profile",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_library_owner",
      columns: [table.workspaceId, table.libraryId],
      foreignColumns: [
        resourceLibraryTable.workspaceId,
        resourceLibraryTable.id,
      ],
    }),
    uniqueIndex("uq_agent_library_ordinal").on(
      table.workspaceId,
      table.profileRevisionId,
      table.ordinal,
    ),
  ],
);

export const agentRevisionWorkflowBindingTable = mysqlTable(
  "agent_revision_workflow_binding",
  {
    workspaceId: id("workspace_id").notNull(),
    profileRevisionId: id("profile_revision_id").notNull(),
    workflowDefinitionId: id("workflow_definition_id").notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.profileRevisionId,
        table.workflowDefinitionId,
      ],
    }),
    foreignKey({
      name: "fk_agent_revision_workflow_profile",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_revision_workflow_definition",
      columns: [table.workspaceId, table.workflowDefinitionId],
      foreignColumns: [
        workflowDefinitionTable.workspaceId,
        workflowDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_agent_revision_workflow_ordinal").on(
      table.profileRevisionId,
      table.ordinal,
    ),
  ],
);

export const agentProfileActivationTable = mysqlTable(
  "agent_profile_activation",
  {
    workspaceId: id("workspace_id").notNull(),
    profileRevisionId: id("profile_revision_id").primaryKey(),
    runtimeStatus: varchar("runtime_status", { length: 16 })
      .$type<AgentProfileRuntimeStatus>()
      .notNull(),
    reasonCode: varchar("reason_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_profile_activation_revision",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    index("ix_agent_profile_activation_status").on(
      table.workspaceId,
      table.runtimeStatus,
      table.updatedAt,
      table.profileRevisionId,
    ),
  ],
);

export const agentSurfaceProfileBindingTable = mysqlTable(
  "agent_surface_profile_binding",
  {
    workspaceId: id("workspace_id").notNull(),
    surfaceKind: varchar("surface_kind", { length: 32 })
      .$type<AgentSurfaceKind>()
      .notNull(),
    profileRevisionId: id("profile_revision_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.surfaceKind] }),
    foreignKey({
      name: "fk_agent_surface_profile_revision",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    index("ix_agent_surface_profile_revision").on(
      table.workspaceId,
      table.profileRevisionId,
      table.surfaceKind,
    ),
  ],
);

export const agentRunFoundationContextTable = mysqlTable(
  "agent_run_foundation_context",
  {
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").primaryKey(),
    profileRevisionId: id("profile_revision_id").notNull(),
    profileCanonicalDigest: digest("profile_canonical_digest").notNull(),
    skillViewDigest: digest("skill_view_digest").notNull(),
    skillContextSnapshot: json("skill_context_snapshot")
      .$type<readonly AgentRunSkillContextV1[]>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_run_foundation_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_run_foundation_profile",
      columns: [table.workspaceId, table.profileRevisionId],
      foreignColumns: [
        agentProfileRevisionTable.workspaceId,
        agentProfileRevisionTable.id,
      ],
    }),
    index("ix_agent_run_foundation_profile").on(
      table.workspaceId,
      table.profileRevisionId,
      table.agentRunId,
    ),
  ],
);

export const agentRunSkillUseTable = mysqlTable(
  "agent_run_skill_use",
  {
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").notNull(),
    skillRevisionId: id("skill_revision_id").notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    source: varchar("source", { length: 16 })
      .$type<AgentRunSkillUseSource>()
      .notNull(),
    firstUsedAt: timestamp("first_used_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.agentRunId, table.skillRevisionId],
    }),
    foreignKey({
      name: "fk_agent_run_skill_use_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_agent_run_skill_use_revision",
      columns: [table.workspaceId, table.skillRevisionId],
      foreignColumns: [skillRevisionTable.workspaceId, skillRevisionTable.id],
    }),
    index("ix_agent_run_skill_use_revision").on(
      table.workspaceId,
      table.skillRevisionId,
      table.firstUsedAt,
      table.agentRunId,
    ),
  ],
);

export type AgentRunDeliveryStatus =
  "queued" | "claimed" | "completed" | "quarantined";

export const agentRunDispatchTable = mysqlTable(
  "agent_run_dispatch",
  {
    workspaceId: id("workspace_id").notNull(),
    agentRunId: id("agent_run_id").primaryKey(),
    deliveryStatus: varchar("delivery_status", { length: 16 })
      .$type<AgentRunDeliveryStatus>()
      .notNull(),
    availableAt: timestamp("available_at").notNull(),
    claimOwner: varchar("claim_owner", { length: 160 }),
    claimTokenDigest: digest("claim_token_digest"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    deliveryCount: int("delivery_count", { unsigned: true }).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_agent_run_dispatch_run",
      columns: [table.workspaceId, table.agentRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    index("ix_agent_run_dispatch_claim").on(
      table.deliveryStatus,
      table.availableAt,
      table.leaseExpiresAt,
      table.agentRunId,
    ),
    index("ix_agent_run_dispatch_worker").on(
      table.claimOwner,
      table.deliveryStatus,
      table.leaseExpiresAt,
      table.agentRunId,
    ),
  ],
);
