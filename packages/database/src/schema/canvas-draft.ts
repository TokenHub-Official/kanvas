import type { EditorDraftContentV1 } from "@kanvas/contracts/editor";
import {
  char,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { artifactTable, workspaceTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";
import { brandKitRevisionTable } from "./brand.js";

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

export const canvasDraftTable = mysqlTable(
  "canvas_draft",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    brandKitRevisionId: id("brand_kit_revision_id"),
    title: varchar("title", { length: 240 }).notNull(),
    schemaVersion: varchar("schema_version", {
      length: 80,
    }).notNull(),
    document: json("document").$type<EditorDraftContentV1>().notNull(),
    contentDigest: digest("content_digest").notNull(),
    createRequestKey: digest("create_request_key").notNull(),
    createRequestHash: digest("create_request_hash").notNull(),
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
    foreignKey({
      name: "fk_canvas_draft_brand_revision",
      columns: [table.workspaceId, table.brandKitRevisionId],
      foreignColumns: [
        brandKitRevisionTable.workspaceId,
        brandKitRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_canvas_draft_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("uq_canvas_draft_create_request").on(
      table.workspaceId,
      table.createRequestKey,
    ),
    index("ix_canvas_draft_workspace_updated").on(
      table.workspaceId,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const canvasDraftArtifactReferenceTable = mysqlTable(
  "canvas_draft_artifact_reference",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    canvasDraftId: id("canvas_draft_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    referenceRole: varchar("reference_role", {
      length: 80,
    }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_canvas_draft_reference_draft",
      columns: [table.workspaceId, table.canvasDraftId],
      foreignColumns: [canvasDraftTable.workspaceId, canvasDraftTable.id],
    }),
    foreignKey({
      name: "fk_canvas_draft_reference_artifact",
      columns: [table.workspaceId, table.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    uniqueIndex("uq_canvas_draft_reference_identity").on(
      table.workspaceId,
      table.canvasDraftId,
      table.artifactId,
      table.referenceRole,
    ),
    index("ix_canvas_draft_reference_artifact").on(
      table.workspaceId,
      table.artifactId,
      table.canvasDraftId,
    ),
  ],
);

export const canvasDraftRevisionTable = mysqlTable(
  "canvas_draft_revision",
  {
    workspaceId: id("workspace_id").notNull(),
    canvasDraftId: id("canvas_draft_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    brandKitRevisionId: id("brand_kit_revision_id"),
    title: varchar("title", { length: 240 }).notNull(),
    schemaVersion: varchar("schema_version", {
      length: 80,
    }).notNull(),
    document: json("document").$type<EditorDraftContentV1>().notNull(),
    contentDigest: digest("content_digest").notNull(),
    revisionKind: varchar("revision_kind", {
      length: 24,
    })
      .$type<"brand_update" | "restore" | "save">()
      .notNull(),
    restoredFromVersion: int("restored_from_version", {
      unsigned: true,
    }),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_canvas_draft_revision",
      columns: [table.workspaceId, table.canvasDraftId, table.version],
    }),
    foreignKey({
      name: "fk_canvas_draft_revision_draft",
      columns: [table.workspaceId, table.canvasDraftId],
      foreignColumns: [canvasDraftTable.workspaceId, canvasDraftTable.id],
    }),
    foreignKey({
      name: "fk_canvas_draft_history_brand_revision",
      columns: [table.workspaceId, table.brandKitRevisionId],
      foreignColumns: [
        brandKitRevisionTable.workspaceId,
        brandKitRevisionTable.id,
      ],
    }),
    index("ix_canvas_draft_revision_recent").on(
      table.workspaceId,
      table.canvasDraftId,
      table.version,
    ),
  ],
);
