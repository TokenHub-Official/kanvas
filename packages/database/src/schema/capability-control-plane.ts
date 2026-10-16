import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import type { CapabilityCatalogRecommendationV1 } from "@kanvas/contracts/capability";
import {
  type AnyMySqlColumn,
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  capabilityContractRevisionTable,
  workspaceTable,
} from "./execution-core.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export type CapabilityDefinitionLifecycle = "active" | "archived";
export type CapabilityDeclarationLifecycle =
  "draft" | "published" | "deprecated" | "revoked";
export type CapabilityCatalogEntryLifecycle = "active" | "retired";
export type CapabilityInstallationLifecycle =
  "waiting_dependency" | "installing" | "installed" | "failed";

export const capabilityDefinitionTable = mysqlTable(
  "capability_definition",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    capabilityKey: varchar("capability_key", { length: 160 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<CapabilityDefinitionLifecycle>()
      .notNull(),
    currentContractRevisionId: id("current_contract_revision_id").notNull(),
    currentDeclarationRevisionId: id(
      "current_declaration_revision_id",
    ).references((): AnyMySqlColumn => capabilityDeclarationRevisionTable.id),
    createRequestKey: varchar("create_request_key", { length: 160 }).notNull(),
    createRequestHash: digest("create_request_hash").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_cap_definition_current_contract",
      columns: [table.workspaceId, table.currentContractRevisionId],
      foreignColumns: [
        capabilityContractRevisionTable.workspaceId,
        capabilityContractRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_cap_definition_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_cap_definition_key").on(
      table.workspaceId,
      table.capabilityKey,
    ),
    uniqueIndex("uq_cap_definition_create_request").on(
      table.workspaceId,
      table.createRequestKey,
    ),
    index("ix_cap_definition_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const capabilityDeclarationRevisionTable = mysqlTable(
  "capability_declaration_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    capabilityDefinitionId: id("capability_definition_id").notNull(),
    contractRevisionId: id("contract_revision_id").notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<CapabilityDeclarationLifecycle>()
      .notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    declaration: json("declaration")
      .$type<WorkflowCapabilityAuthoringDeclaration>()
      .notNull(),
    publicationRequestKey: varchar("publication_request_key", {
      length: 160,
    }).notNull(),
    publicationRequestHash: digest("publication_request_hash").notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_cap_declaration_definition",
      columns: [table.workspaceId, table.capabilityDefinitionId],
      foreignColumns: [
        capabilityDefinitionTable.workspaceId,
        capabilityDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_cap_declaration_contract",
      columns: [table.workspaceId, table.contractRevisionId],
      foreignColumns: [
        capabilityContractRevisionTable.workspaceId,
        capabilityContractRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_cap_declaration_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_cap_declaration_definition_id").on(
      table.workspaceId,
      table.capabilityDefinitionId,
      table.id,
    ),
    uniqueIndex("uq_cap_declaration_revision").on(
      table.workspaceId,
      table.capabilityDefinitionId,
      table.revision,
    ),
    uniqueIndex("uq_cap_declaration_publication_request").on(
      table.workspaceId,
      table.publicationRequestKey,
    ),
    index("ix_cap_declaration_contract").on(
      table.workspaceId,
      table.contractRevisionId,
    ),
  ],
);

export const capabilityCatalogEntryTable = mysqlTable(
  "capability_catalog_entry",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    recommendationKey: varchar("recommendation_key", {
      length: 160,
    }).notNull(),
    capabilityKey: varchar("capability_key", { length: 160 }).notNull(),
    packageKey: varchar("package_key", { length: 160 }).notNull(),
    packageVersion: varchar("package_version", { length: 80 }).notNull(),
    packageDigest: digest("package_digest").notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    document: json("document")
      .$type<CapabilityCatalogRecommendationV1>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<CapabilityCatalogEntryLifecycle>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_cap_catalog_entry_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_cap_catalog_entry_revision").on(
      table.workspaceId,
      table.recommendationKey,
      table.packageVersion,
    ),
    index("ix_cap_catalog_entry_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.capabilityKey,
      table.updatedAt,
    ),
  ],
);

export const capabilityInstallationOperationTable = mysqlTable(
  "capability_installation_operation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    catalogEntryId: id("catalog_entry_id").notNull(),
    organizationId: id("organization_id").notNull(),
    createdByPrincipalId: id("created_by_principal_id").notNull(),
    principalType: varchar("principal_type", { length: 24 })
      .$type<"human" | "service">()
      .notNull(),
    authenticationRefType: varchar("authentication_ref_type", { length: 32 })
      .$type<"session" | "service_api_token">()
      .notNull(),
    authenticationRefId: varchar("authentication_ref_id", {
      length: 160,
    }).notNull(),
    authenticationRefHash: digest("authentication_ref_hash").notNull(),
    authorityType: varchar("authority_type", { length: 32 })
      .$type<"human_membership" | "service_grant">()
      .notNull(),
    authorityId: id("authority_id").notNull(),
    authorityVersion: int("authority_version", { unsigned: true }).notNull(),
    authorizationModelVersion: int("authorization_model_version", {
      unsigned: true,
    }).notNull(),
    effectivePermissions: json("effective_permissions")
      .$type<readonly string[]>()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<CapabilityInstallationLifecycle>()
      .notNull(),
    selectedRoutePolicyRevisionId: id("selected_route_policy_revision_id"),
    modelResourceImportId: id("model_resource_import_id"),
    installedCapabilityDefinitionId: id("installed_capability_definition_id"),
    failure: json("failure").$type<Readonly<Record<string, unknown>>>(),
    continuationLeaseTokenHash: char("continuation_lease_token_hash", {
      length: 64,
    }),
    continuationLeaseExpiresAt: timestamp("continuation_lease_expires_at"),
    continuationAttempts: int("continuation_attempts", { unsigned: true })
      .notNull()
      .default(0),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_cap_install_catalog_entry",
      columns: [table.workspaceId, table.catalogEntryId],
      foreignColumns: [
        capabilityCatalogEntryTable.workspaceId,
        capabilityCatalogEntryTable.id,
      ],
    }),
    foreignKey({
      name: "fk_cap_install_definition",
      columns: [table.workspaceId, table.installedCapabilityDefinitionId],
      foreignColumns: [
        capabilityDefinitionTable.workspaceId,
        capabilityDefinitionTable.id,
      ],
    }),
    uniqueIndex("uq_cap_install_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_cap_install_request").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_cap_install_catalog_entry").on(
      table.workspaceId,
      table.catalogEntryId,
      table.lifecycleStatus,
    ),
    index("ix_cap_install_continuation").on(
      table.lifecycleStatus,
      table.continuationLeaseExpiresAt,
      table.updatedAt,
      table.id,
    ),
  ],
);
