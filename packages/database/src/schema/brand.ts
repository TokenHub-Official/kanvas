import type { BrandKitDocument } from "@kanvas/application";
import {
  type AnyMySqlColumn,
  boolean,
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

import { artifactTable, workspaceTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export type BrandKitLifecycle = "active" | "archived";

export const brandKitTable = mysqlTable(
  "brand_kit",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<BrandKitLifecycle>()
      .notNull(),
    defaultMarker: boolean("default_marker"),
    latestPublishedRevisionId: id("latest_published_revision_id").references(
      (): AnyMySqlColumn => brandKitRevisionTable.id,
    ),
    creationRequestKey: varchar("creation_request_key", {
      length: 160,
    }).notNull(),
    creationRequestHash: digest("creation_request_hash").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_brand_kit_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_brand_kit_creation_request").on(
      table.workspaceId,
      table.creationRequestKey,
    ),
    uniqueIndex("uq_brand_kit_default").on(
      table.workspaceId,
      table.defaultMarker,
    ),
    index("ix_brand_kit_list").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const brandKitDraftTable = mysqlTable(
  "brand_kit_draft",
  {
    workspaceId: id("workspace_id").notNull(),
    brandKitId: id("brand_kit_id").notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    contentDocument: json("content_document")
      .$type<BrandKitDocument>()
      .notNull(),
    contentDigest: digest("content_digest").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_brand_kit_draft",
      columns: [table.workspaceId, table.brandKitId],
    }),
    foreignKey({
      name: "fk_brand_kit_draft_kit",
      columns: [table.workspaceId, table.brandKitId],
      foreignColumns: [brandKitTable.workspaceId, brandKitTable.id],
    }),
  ],
);

export const brandKitRevisionTable = mysqlTable(
  "brand_kit_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    brandKitId: id("brand_kit_id").notNull(),
    revisionNumber: int("revision_number", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    contentDocument: json("content_document")
      .$type<BrandKitDocument>()
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
      name: "fk_brand_kit_revision_kit",
      columns: [table.workspaceId, table.brandKitId],
      foreignColumns: [brandKitTable.workspaceId, brandKitTable.id],
    }),
    uniqueIndex("uq_brand_kit_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_brand_kit_revision_scoped_id").on(
      table.workspaceId,
      table.brandKitId,
      table.id,
    ),
    uniqueIndex("uq_brand_kit_revision_number").on(
      table.workspaceId,
      table.brandKitId,
      table.revisionNumber,
    ),
    uniqueIndex("uq_brand_kit_revision_digest").on(
      table.workspaceId,
      table.brandKitId,
      table.contentDigest,
    ),
    uniqueIndex("uq_brand_kit_publication_request").on(
      table.workspaceId,
      table.publicationRequestKey,
    ),
    index("ix_brand_kit_revision_recent").on(
      table.workspaceId,
      table.brandKitId,
      table.revisionNumber,
    ),
  ],
);

export const brandKitRevisionArtifactReferenceTable = mysqlTable(
  "brand_kit_revision_artifact_reference",
  {
    workspaceId: id("workspace_id").notNull(),
    brandKitRevisionId: id("brand_kit_revision_id").notNull(),
    referenceKey: varchar("reference_key", { length: 80 }).notNull(),
    referenceRole: varchar("reference_role", { length: 32 })
      .$type<"primary" | "inverse" | "icon" | "reference">()
      .notNull(),
    assetId: id("asset_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    position: smallint("position", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_brand_kit_revision_artifact_reference",
      columns: [
        table.workspaceId,
        table.brandKitRevisionId,
        table.referenceKey,
      ],
    }),
    foreignKey({
      name: "fk_brand_revision_reference_revision",
      columns: [table.workspaceId, table.brandKitRevisionId],
      foreignColumns: [
        brandKitRevisionTable.workspaceId,
        brandKitRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_brand_revision_reference_artifact",
      columns: [table.workspaceId, table.assetId, table.artifactId],
      foreignColumns: [
        artifactTable.workspaceId,
        artifactTable.assetId,
        artifactTable.id,
      ],
    }),
    uniqueIndex("uq_brand_revision_reference_position").on(
      table.workspaceId,
      table.brandKitRevisionId,
      table.position,
    ),
    index("ix_brand_revision_reference_artifact").on(
      table.workspaceId,
      table.artifactId,
      table.brandKitRevisionId,
    ),
  ],
);
