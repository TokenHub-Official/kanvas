import type { ResourceLibraryDocument } from "@kanvas/application";
import {
  type MySqlTableExtraConfigValue,
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  mediumtext,
  primaryKey,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { artifactTable, workspaceTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";

const id = (name: string) => char(name, { length: 26 });
const timestamp = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export const resourceLibraryTable = mysqlTable(
  "resource_library",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 2000 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<"active" | "archived">()
      .notNull()
      .default("active"),
    version: int("version", { unsigned: true }).notNull(),
    currentRevisionId: id("current_revision_id"),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    uniqueIndex("uq_library_workspace_id").on(t.workspaceId, t.id),
    index("ix_library_list").on(t.workspaceId, t.lifecycleStatus, t.id),
    foreignKey({
      name: "fk_library_current_revision",
      columns: [t.workspaceId, t.id, t.currentRevisionId],
      foreignColumns: [
        resourceLibraryRevisionTable.workspaceId,
        resourceLibraryRevisionTable.libraryId,
        resourceLibraryRevisionTable.id,
      ],
    }),
  ],
);

export const resourceLibraryRevisionTable = mysqlTable(
  "resource_library_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    libraryId: id("library_id").notNull(),
    revisionNumber: int("revision_number", { unsigned: true }).notNull(),
    contentDocument: json("content_document")
      .$type<ResourceLibraryDocument>()
      .notNull(),
    contentDigest: char("content_digest", { length: 71 }).notNull(),
    requestKey: varchar("request_key", { length: 160 }).notNull(),
    requestHash: char("request_hash", { length: 71 }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    uniqueIndex("uq_library_revision_scope").on(
      t.workspaceId,
      t.libraryId,
      t.id,
    ),
    uniqueIndex("uq_library_revision_number").on(
      t.workspaceId,
      t.libraryId,
      t.revisionNumber,
    ),
    uniqueIndex("uq_library_revision_request").on(
      t.workspaceId,
      t.libraryId,
      t.requestKey,
    ),
    foreignKey({
      name: "fk_library_revision_owner",
      columns: [t.workspaceId, t.libraryId],
      foreignColumns: [
        resourceLibraryTable.workspaceId,
        resourceLibraryTable.id,
      ],
    }),
  ],
);

export const resourceLibraryEntryTable = mysqlTable(
  "resource_library_entry",
  {
    workspaceId: id("workspace_id").notNull(),
    libraryId: id("library_id").notNull(),
    revisionId: id("revision_id").notNull(),
    entryId: id("entry_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    sourceAssetId: id("source_asset_id"),
    name: varchar("name", { length: 240 }).notNull(),
    purpose: varchar("purpose", { length: 1000 }).notNull(),
    position: smallint("position", { unsigned: true }).notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    primaryKey({ columns: [t.workspaceId, t.revisionId, t.entryId] }),
    uniqueIndex("uq_library_entry_position").on(
      t.workspaceId,
      t.revisionId,
      t.position,
    ),
    index("ix_library_entry_artifact").on(t.workspaceId, t.artifactId),
    foreignKey({
      name: "fk_library_entry_revision",
      columns: [t.workspaceId, t.libraryId, t.revisionId],
      foreignColumns: [
        resourceLibraryRevisionTable.workspaceId,
        resourceLibraryRevisionTable.libraryId,
        resourceLibraryRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_library_entry_artifact",
      columns: [t.workspaceId, t.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    foreignKey({
      name: "fk_library_entry_asset",
      columns: [t.workspaceId, t.sourceAssetId, t.artifactId],
      foreignColumns: [
        artifactTable.workspaceId,
        artifactTable.assetId,
        artifactTable.id,
      ],
    }),
  ],
);

export const resourceLibraryUploadTable = mysqlTable(
  "resource_library_upload",
  {
    workspaceId: id("workspace_id").notNull(),
    libraryId: id("library_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    primaryKey({ columns: [t.workspaceId, t.libraryId, t.artifactId] }),
    foreignKey({
      name: "fk_library_upload_owner",
      columns: [t.workspaceId, t.libraryId],
      foreignColumns: [
        resourceLibraryTable.workspaceId,
        resourceLibraryTable.id,
      ],
    }),
    foreignKey({
      name: "fk_library_upload_artifact",
      columns: [t.workspaceId, t.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
  ],
);

// The SQL migration additionally creates an ngram FULLTEXT index (not expressible through this schema API).
export const resourceLibraryTextTable = mysqlTable(
  "resource_library_text",
  {
    workspaceId: id("workspace_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    contentDigest: char("content_digest", { length: 71 }).notNull(),
    extractorVersion: varchar("extractor_version", { length: 80 }).notNull(),
    textContent: mediumtext("text_content").notNull(),
    pageRanges: json("page_ranges").notNull(),
    extractionDigest: char("extraction_digest", { length: 71 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    primaryKey({ columns: [t.workspaceId, t.artifactId] }),
    foreignKey({
      name: "fk_library_text_artifact",
      columns: [t.workspaceId, t.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
  ],
);
