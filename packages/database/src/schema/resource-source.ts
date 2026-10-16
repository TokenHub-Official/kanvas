import type {
  ArtTextPresetManifest,
  ResourceLicensePolicy,
  ResourceSourceCapability,
} from "@kanvas/contracts/resource-source";
import {
  type AnyMySqlColumn,
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

import {
  credentialTable,
  providerEndpointTable,
} from "./configuration-provider.js";
import { artifactTable, workspaceTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export type ResourceSourceLifecycle =
  "draft" | "validating" | "ready" | "published" | "failed" | "disabled";
export type ResourceSourceValidationStatus =
  "not_checked" | "pending" | "passed" | "failed";
export type ResourceSourceAuthMode = "none" | "api_key" | "client_credentials";
export type ResourceSourceOperationKind =
  "validate" | "disable" | "rotate_secret";
export type ResourceSourceOperationStatus = "pending" | "succeeded";

export const resourceSourceTable = mysqlTable(
  "resource_source",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    adapterKind: varchar("adapter_kind", { length: 120 }).notNull(),
    adapterVersion: varchar("adapter_version", { length: 80 }).notNull(),
    authMode: varchar("auth_mode", { length: 32 })
      .$type<ResourceSourceAuthMode>()
      .notNull(),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    credentialId: id("credential_id"),
    configurationDocument: json("configuration_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    configurationDigest: digest("configuration_digest").notNull(),
    licensePolicy: json("license_policy")
      .$type<ResourceLicensePolicy>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<ResourceSourceLifecycle>()
      .notNull(),
    validationStatus: varchar("validation_status", { length: 24 })
      .$type<ResourceSourceValidationStatus>()
      .notNull(),
    validationDigest: digest("validation_digest"),
    validationReasonCode: varchar("validation_reason_code", { length: 120 }),
    validatedAt: timestamp("validated_at"),
    currentRevisionId: id("current_revision_id").references(
      (): AnyMySqlColumn => resourceSourceRevisionTable.id,
    ),
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
      name: "fk_resource_source_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_resource_source_credential",
      columns: [table.workspaceId, table.credentialId],
      foreignColumns: [credentialTable.workspaceId, credentialTable.id],
    }),
    uniqueIndex("uq_resource_source_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_resource_source_endpoint").on(
      table.workspaceId,
      table.providerEndpointId,
    ),
    uniqueIndex("uq_resource_source_credential").on(
      table.workspaceId,
      table.credentialId,
    ),
    uniqueIndex("uq_resource_source_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_resource_source_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const resourceSourceRevisionTable = mysqlTable(
  "resource_source_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceId: id("source_id").notNull(),
    revisionNumber: int("revision_number", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    adapterKind: varchar("adapter_kind", { length: 120 }).notNull(),
    adapterVersion: varchar("adapter_version", { length: 80 }).notNull(),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    credentialId: id("credential_id"),
    configurationDocument: json("configuration_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    configurationDigest: digest("configuration_digest").notNull(),
    capabilities: json("capabilities")
      .$type<readonly ResourceSourceCapability[]>()
      .notNull(),
    licensePolicy: json("license_policy")
      .$type<ResourceLicensePolicy>()
      .notNull(),
    contentDigest: digest("content_digest").notNull(),
    publicationRequestKey: varchar("publication_request_key", {
      length: 160,
    }).notNull(),
    publicationRequestHash: digest("publication_request_hash").notNull(),
    publishedByPrincipalId: id("published_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    publishedAt: timestamp("published_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_resource_source_revision_source",
      columns: [table.workspaceId, table.sourceId],
      foreignColumns: [resourceSourceTable.workspaceId, resourceSourceTable.id],
    }),
    foreignKey({
      name: "fk_resource_source_revision_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_resource_source_revision_credential",
      columns: [table.workspaceId, table.credentialId],
      foreignColumns: [credentialTable.workspaceId, credentialTable.id],
    }),
    uniqueIndex("uq_resource_source_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_resource_source_revision_scoped_id").on(
      table.workspaceId,
      table.sourceId,
      table.id,
    ),
    uniqueIndex("uq_resource_source_revision_number").on(
      table.workspaceId,
      table.sourceId,
      table.revisionNumber,
    ),
    uniqueIndex("uq_resource_source_revision_digest").on(
      table.workspaceId,
      table.sourceId,
      table.contentDigest,
    ),
    uniqueIndex("uq_resource_source_publication_request").on(
      table.workspaceId,
      table.publicationRequestKey,
    ),
    index("ix_resource_source_revision_recent").on(
      table.workspaceId,
      table.sourceId,
      table.revisionNumber,
    ),
  ],
);

export const resourceSourceOperationTable = mysqlTable(
  "resource_source_operation",
  {
    workspaceId: id("workspace_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    operationId: id("operation_id").notNull(),
    sourceId: id("source_id").notNull(),
    operationKind: varchar("operation_kind", { length: 32 })
      .$type<ResourceSourceOperationKind>()
      .notNull(),
    requestHash: digest("request_hash").notNull(),
    plannedResourceId: id("planned_resource_id"),
    status: varchar("status", { length: 16 })
      .$type<ResourceSourceOperationStatus>()
      .notNull(),
    resultSourceVersion: int("result_source_version", { unsigned: true }),
    resultReasonCode: varchar("result_reason_code", { length: 120 }),
    createdAt: timestamp("created_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    primaryKey({
      name: "pk_resource_source_operation",
      columns: [table.workspaceId, table.idempotencyKey],
    }),
    foreignKey({
      name: "fk_resource_source_operation_source",
      columns: [table.workspaceId, table.sourceId],
      foreignColumns: [resourceSourceTable.workspaceId, resourceSourceTable.id],
    }),
    uniqueIndex("uq_resource_source_operation_id").on(
      table.workspaceId,
      table.operationId,
    ),
    index("ix_resource_source_operation_source").on(
      table.workspaceId,
      table.sourceId,
      table.createdAt,
    ),
  ],
);

export const artTextPresetRevisionTable = mysqlTable(
  "art_text_preset_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceId: id("source_id").notNull(),
    sourceRevisionId: id("source_revision_id").notNull(),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    manifestDocument: json("manifest_document")
      .$type<ArtTextPresetManifest>()
      .notNull(),
    manifestDigest: digest("manifest_digest").notNull(),
    provenanceDocument: json("provenance_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_art_text_preset_source_revision",
      columns: [table.workspaceId, table.sourceId, table.sourceRevisionId],
      foreignColumns: [
        resourceSourceRevisionTable.workspaceId,
        resourceSourceRevisionTable.sourceId,
        resourceSourceRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_art_text_preset_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_art_text_preset_manifest").on(
      table.workspaceId,
      table.sourceId,
      table.externalId,
      table.manifestDigest,
    ),
    uniqueIndex("uq_art_text_preset_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_art_text_preset_catalog").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const fontRevisionTable = mysqlTable(
  "font_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceId: id("source_id").notNull(),
    sourceRevisionId: id("source_revision_id").notNull(),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    family: varchar("family", { length: 240 }).notNull(),
    upstreamVersion: varchar("upstream_version", { length: 80 }).notNull(),
    descriptorDocument: json("descriptor_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    contentDigest: digest("content_digest").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_font_revision_source_revision",
      columns: [table.workspaceId, table.sourceId, table.sourceRevisionId],
      foreignColumns: [
        resourceSourceRevisionTable.workspaceId,
        resourceSourceRevisionTable.sourceId,
        resourceSourceRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_font_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_font_revision_content").on(
      table.workspaceId,
      table.sourceId,
      table.externalId,
      table.contentDigest,
    ),
    uniqueIndex("uq_font_revision_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_font_revision_catalog").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const fontRevisionFileTable = mysqlTable(
  "font_revision_file",
  {
    workspaceId: id("workspace_id").notNull(),
    fontRevisionId: id("font_revision_id").notNull(),
    variantKey: varchar("variant_key", { length: 160 }).notNull(),
    artifactId: id("artifact_id").notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    weight: int("weight", { unsigned: true }).notNull(),
    style: varchar("style", { length: 16 }).notNull(),
    subset: varchar("subset", { length: 80 }).notNull(),
    position: int("position", { unsigned: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_font_revision_file",
      columns: [table.workspaceId, table.fontRevisionId, table.variantKey],
    }),
    foreignKey({
      name: "fk_font_revision_file_revision",
      columns: [table.workspaceId, table.fontRevisionId],
      foreignColumns: [fontRevisionTable.workspaceId, fontRevisionTable.id],
    }),
    foreignKey({
      name: "fk_font_revision_file_artifact",
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    uniqueIndex("uq_font_revision_file_artifact").on(
      table.workspaceId,
      table.artifactId,
    ),
    uniqueIndex("uq_font_revision_file_position").on(
      table.workspaceId,
      table.fontRevisionId,
      table.position,
    ),
  ],
);
