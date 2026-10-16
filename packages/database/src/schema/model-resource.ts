import type {
  ModelResourceFormat,
  ModelResourceManifest,
} from "@kanvas/contracts/api";
import type { ModelResourceCatalogAssetV1 } from "@kanvas/contracts/capability";
import {
  type AnyMySqlColumn,
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
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  capabilityImplementationRevisionTable,
  storedObjectTable,
  uploadSessionTable,
  workspaceTable,
} from "./execution-core.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
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

export const modelResourceTable = mysqlTable(
  "model_resource",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    resourceKey: varchar("resource_key", { length: 160 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"active" | "archived">()
      .notNull(),
    currentRevisionId: id("current_revision_id").references(
      (): AnyMySqlColumn => modelResourceRevisionTable.id,
    ),
    createRequestKey: varchar("create_request_key", { length: 160 }).notNull(),
    createRequestHash: digest("create_request_hash").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    uniqueIndex("uq_model_resource_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_model_resource_key").on(
      table.workspaceId,
      table.resourceKey,
    ),
    uniqueIndex("uq_model_resource_create_request").on(
      table.workspaceId,
      table.createRequestKey,
    ),
    index("ix_model_resource_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const modelResourceImportTable = mysqlTable(
  "model_resource_import",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    createdByPrincipalId: id("created_by_principal_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: digest("request_hash").notNull(),
    sourceKind: varchar("source_kind", { length: 24 })
      .$type<"url" | "upload">()
      .notNull(),
    source: json("source").$type<Readonly<Record<string, unknown>>>().notNull(),
    catalogEntryId: id("catalog_entry_id"),
    expectedSha256: char("expected_sha256", { length: 64 }),
    expectedByteSize: varchar("expected_byte_size", { length: 20 }),
    downloadedBytes: unsignedBigintString("downloaded_bytes")
      .notNull()
      .default("0"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    uploadSessionId: id("upload_session_id").notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<
        | "waiting_upload"
        | "fetching"
        | "analyzing"
        | "needs_input"
        | "ready"
        | "published"
        | "failed"
        | "cancelled"
      >()
      .notNull(),
    suggestedKey: varchar("suggested_key", { length: 160 }),
    suggestedDisplayName: varchar("suggested_display_name", { length: 160 }),
    detectedFormat: varchar("detected_format", {
      length: 40,
    }).$type<ModelResourceFormat>(),
    detectedLicense:
      json("detected_license").$type<Readonly<Record<string, unknown>>>(),
    nativeInterface:
      json("native_interface").$type<Readonly<Record<string, unknown>>>(),
    compatibleAdapters: json("compatible_adapters")
      .$type<readonly Readonly<Record<string, unknown>>[]>()
      .notNull(),
    requiredUserInputs: json("required_user_inputs")
      .$type<readonly string[]>()
      .notNull(),
    failure: json("failure").$type<Readonly<Record<string, unknown>>>(),
    processingLeaseGeneration: int("processing_lease_generation", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    processingLeaseTokenHash: char("processing_lease_token_hash", {
      length: 64,
    }),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
    processingAttempts: int("processing_attempts", { unsigned: true })
      .notNull()
      .default(0),
    publishedModelResourceRevisionId: id(
      "published_model_resource_revision_id",
    ),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("uq_model_resource_import_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_model_resource_import_request").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("uq_model_resource_import_upload").on(
      table.workspaceId,
      table.uploadSessionId,
    ),
    index("ix_model_resource_import_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_model_resource_import_work").on(
      table.lifecycleStatus,
      table.processingLeaseExpiresAt,
      table.updatedAt,
      table.id,
    ),
    foreignKey({
      name: "fk_model_resource_import_catalog_entry",
      columns: [table.workspaceId, table.catalogEntryId],
      foreignColumns: [
        modelResourceCatalogEntryTable.workspaceId,
        modelResourceCatalogEntryTable.id,
      ],
    }),
    foreignKey({
      name: "fk_model_resource_import_upload",
      columns: [table.workspaceId, table.uploadSessionId],
      foreignColumns: [uploadSessionTable.workspaceId, uploadSessionTable.id],
    }),
    foreignKey({
      name: "fk_model_resource_import_published_revision",
      columns: [table.workspaceId, table.publishedModelResourceRevisionId],
      foreignColumns: [
        modelResourceRevisionTable.workspaceId,
        modelResourceRevisionTable.id,
      ],
    }),
  ],
);

export const modelResourceCatalogEntryTable = mysqlTable(
  "model_resource_catalog_entry",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    assetKey: varchar("asset_key", { length: 160 }).notNull(),
    resourceKey: varchar("resource_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    document: json("document").$type<ModelResourceCatalogAssetV1>().notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"active" | "retired">()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_model_resource_catalog_entry_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_model_resource_catalog_entry_asset").on(
      table.workspaceId,
      table.assetKey,
    ),
    uniqueIndex("uq_model_resource_catalog_entry_revision").on(
      table.workspaceId,
      table.resourceKey,
      table.revision,
    ),
    index("ix_model_resource_catalog_entry_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.resourceKey,
    ),
  ],
);

export const modelResourceRevisionTable = mysqlTable(
  "model_resource_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    modelResourceId: id("model_resource_id").notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"published" | "deprecated" | "revoked">()
      .notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    description: varchar("description", { length: 1_000 }),
    canonicalDigest: digest("canonical_digest").notNull(),
    manifest: json("manifest").$type<ModelResourceManifest>().notNull(),
    publicationRequestKey: varchar("publication_request_key", {
      length: 160,
    }).notNull(),
    publicationRequestHash: digest("publication_request_hash").notNull(),
    createdAt: timestamp("created_at").notNull(),
    publishedAt: timestamp("published_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_model_resource_revision_resource",
      columns: [table.workspaceId, table.modelResourceId],
      foreignColumns: [modelResourceTable.workspaceId, modelResourceTable.id],
    }),
    uniqueIndex("uq_model_resource_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_model_resource_revision_resource_id").on(
      table.workspaceId,
      table.modelResourceId,
      table.id,
    ),
    uniqueIndex("uq_model_resource_revision_number").on(
      table.workspaceId,
      table.modelResourceId,
      table.revision,
    ),
    uniqueIndex("uq_model_resource_publication_request").on(
      table.workspaceId,
      table.publicationRequestKey,
    ),
  ],
);

export const modelResourceImportFileTable = mysqlTable(
  "model_resource_import_file",
  {
    workspaceId: id("workspace_id").notNull(),
    modelResourceImportId: id("model_resource_import_id").notNull(),
    path: varchar("path", { length: 700 }).notNull(),
    storedObjectId: id("stored_object_id").notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    byteSize: varchar("byte_size", { length: 20 }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    sourceMetadata: json("source_metadata")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_model_resource_import_file",
      columns: [table.workspaceId, table.modelResourceImportId, table.path],
    }),
    foreignKey({
      name: "fk_model_resource_import_file_import",
      columns: [table.workspaceId, table.modelResourceImportId],
      foreignColumns: [
        modelResourceImportTable.workspaceId,
        modelResourceImportTable.id,
      ],
    }),
    foreignKey({
      name: "fk_model_resource_import_file_object",
      columns: [table.workspaceId, table.storedObjectId],
      foreignColumns: [storedObjectTable.workspaceId, storedObjectTable.id],
    }),
    uniqueIndex("uq_model_resource_import_file_object").on(
      table.workspaceId,
      table.storedObjectId,
    ),
  ],
);

export const modelResourceRevisionFileTable = mysqlTable(
  "model_resource_revision_file",
  {
    workspaceId: id("workspace_id").notNull(),
    modelResourceRevisionId: id("model_resource_revision_id").notNull(),
    path: varchar("path", { length: 700 }).notNull(),
    storedObjectId: id("stored_object_id").notNull(),
    role: varchar("role", { length: 80 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_model_resource_revision_file",
      columns: [table.workspaceId, table.modelResourceRevisionId, table.path],
    }),
    foreignKey({
      name: "fk_model_resource_revision_file_revision",
      columns: [table.workspaceId, table.modelResourceRevisionId],
      foreignColumns: [
        modelResourceRevisionTable.workspaceId,
        modelResourceRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_model_resource_revision_file_object",
      columns: [table.workspaceId, table.storedObjectId],
      foreignColumns: [storedObjectTable.workspaceId, storedObjectTable.id],
    }),
    index("ix_model_resource_revision_file_object").on(
      table.workspaceId,
      table.storedObjectId,
    ),
  ],
);

export const capabilityImplementationModelResourceTable = mysqlTable(
  "capability_implementation_model_resource",
  {
    workspaceId: id("workspace_id").notNull(),
    implementationRevisionId: id("implementation_revision_id").notNull(),
    modelResourceRevisionId: id("model_resource_revision_id").notNull(),
    resourceRole: varchar("resource_role", { length: 80 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_capability_implementation_model_resource",
      columns: [
        table.workspaceId,
        table.implementationRevisionId,
        table.resourceRole,
      ],
    }),
    foreignKey({
      name: "fk_cap_impl_model_resource_implementation",
      columns: [table.workspaceId, table.implementationRevisionId],
      foreignColumns: [
        capabilityImplementationRevisionTable.workspaceId,
        capabilityImplementationRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_cap_impl_model_resource_revision",
      columns: [table.workspaceId, table.modelResourceRevisionId],
      foreignColumns: [
        modelResourceRevisionTable.workspaceId,
        modelResourceRevisionTable.id,
      ],
    }),
    index("ix_cap_impl_model_resource_revision").on(
      table.workspaceId,
      table.modelResourceRevisionId,
      table.implementationRevisionId,
    ),
  ],
);
