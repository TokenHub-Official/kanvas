import {
  bigint,
  char,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { principalTable } from "./identity-authorization.js";
import {
  artifactTable,
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

export const assetTable = mysqlTable(
  "asset",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    assetKey: varchar("asset_key", { length: 160 }).notNull(),
    name: varchar("name", { length: 240 }).notNull(),
    assetType: varchar("asset_type", { length: 120 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .$type<"active" | "archived">()
      .notNull(),
    currentArtifactId: id("current_artifact_id"),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_asset_current_artifact",
      columns: [table.workspaceId, table.id, table.currentArtifactId],
      foreignColumns: [
        artifactTable.workspaceId,
        artifactTable.assetId,
        artifactTable.id,
      ],
    }),
    uniqueIndex("uq_asset_workspace_key").on(table.workspaceId, table.assetKey),
    uniqueIndex("uq_asset_workspace_id").on(table.workspaceId, table.id),
    index("ix_asset_workspace_lifecycle").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const artifactEdgeTable = mysqlTable(
  "artifact_edge",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceArtifactId: id("source_artifact_id").notNull(),
    targetArtifactId: id("target_artifact_id").notNull(),
    relation: varchar("relation", { length: 32 })
      .$type<
        "derived_from" | "supersedes" | "composed_from" | "generated_from"
      >()
      .notNull(),
    createdByPrincipalId: id("created_by_principal_id").references(
      () => principalTable.id,
    ),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_artifact_edge_source",
      columns: [table.workspaceId, table.sourceArtifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    foreignKey({
      name: "fk_artifact_edge_target",
      columns: [table.workspaceId, table.targetArtifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    uniqueIndex("uq_artifact_edge_identity").on(
      table.sourceArtifactId,
      table.targetArtifactId,
      table.relation,
    ),
    index("ix_artifact_edge_target").on(
      table.workspaceId,
      table.targetArtifactId,
      table.relation,
      table.sourceArtifactId,
    ),
    index("ix_artifact_edge_source").on(
      table.workspaceId,
      table.sourceArtifactId,
      table.relation,
      table.targetArtifactId,
    ),
  ],
);

export const artifactRepresentationTable = mysqlTable(
  "artifact_representation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceArtifactId: id("source_artifact_id").notNull(),
    variantKey: varchar("variant_key", { length: 160 }).notNull(),
    profileVersion: varchar("profile_version", { length: 120 }).notNull(),
    storageProfileId: id("storage_profile_id").notNull(),
    container: varchar("container", { length: 160 }).notNull(),
    objectKey: varchar("object_key", { length: 800 }).notNull(),
    immutableIdentityHash: digest("immutable_identity_hash").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint", unsigned: true }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    width: int("width", { unsigned: true }).notNull(),
    height: int("height", { unsigned: true }).notNull(),
    state: varchar("state", { length: 24 })
      .$type<"available" | "deletion_pending" | "deleted" | "missing">()
      .notNull(),
    cleanupTokenHash: char("cleanup_token_hash", { length: 64 }),
    cleanupLeaseExpiresAt: timestamp("cleanup_lease_expires_at"),
    cleanupAttempts: int("cleanup_attempts", { unsigned: true }).notNull(),
    cleanupRetryAt: timestamp("cleanup_retry_at"),
    cleanupErrorCode: varchar("cleanup_error_code", { length: 120 }),
    createdAt: timestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_artifact_representation_source",
      columns: [table.workspaceId, table.sourceArtifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    uniqueIndex("uq_artifact_representation_variant").on(
      table.workspaceId,
      table.sourceArtifactId,
      table.variantKey,
      table.profileVersion,
    ),
    uniqueIndex("uq_artifact_representation_object").on(
      table.storageProfileId,
      table.container,
      table.objectKey,
    ),
    index("ix_artifact_representation_cleanup").on(
      table.state,
      table.cleanupRetryAt,
      table.cleanupLeaseExpiresAt,
      table.id,
    ),
  ],
);

export const assetRelationTable = mysqlTable(
  "asset_relation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    sourceAssetId: id("source_asset_id").notNull(),
    targetAssetId: id("target_asset_id").notNull(),
    relation: varchar("relation", { length: 40 })
      .$type<
        | "variant_of"
        | "template_of"
        | "related_to"
        | "channel_version_of"
        | "language_version_of"
      >()
      .notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_asset_relation_source",
      columns: [table.workspaceId, table.sourceAssetId],
      foreignColumns: [assetTable.workspaceId, assetTable.id],
    }),
    foreignKey({
      name: "fk_asset_relation_target",
      columns: [table.workspaceId, table.targetAssetId],
      foreignColumns: [assetTable.workspaceId, assetTable.id],
    }),
    uniqueIndex("uq_asset_relation_identity").on(
      table.sourceAssetId,
      table.targetAssetId,
      table.relation,
    ),
    index("ix_asset_relation_target").on(
      table.workspaceId,
      table.targetAssetId,
      table.relation,
      table.sourceAssetId,
    ),
  ],
);

export const artifactReferenceTable = mysqlTable(
  "artifact_reference",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    referenceRole: varchar("reference_role", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 32 })
      .$type<"workflow_run" | "asset">()
      .notNull(),
    targetId: id("target_id").notNull(),
    workflowRunId: id("workflow_run_id"),
    assetId: id("asset_id"),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_artifact_reference_artifact",
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    foreignKey({
      name: "fk_artifact_reference_workflow",
      columns: [table.workspaceId, table.workflowRunId],
      foreignColumns: [workflowRunTable.workspaceId, workflowRunTable.id],
    }),
    foreignKey({
      name: "fk_artifact_reference_asset",
      columns: [table.workspaceId, table.assetId],
      foreignColumns: [assetTable.workspaceId, assetTable.id],
    }),
    uniqueIndex("uq_artifact_reference_identity").on(
      table.workspaceId,
      table.artifactId,
      table.referenceRole,
      table.targetType,
      table.targetId,
    ),
    index("ix_artifact_reference_workflow").on(
      table.workspaceId,
      table.workflowRunId,
      table.referenceRole,
      table.artifactId,
    ),
  ],
);
