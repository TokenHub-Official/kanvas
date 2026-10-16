import {
  char,
  json,
  boolean,
  datetime,
  foreignKey,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  index,
  varchar,
} from "drizzle-orm/mysql-core";
import { agentRunTable } from "./agent.js";
import { artifactTable } from "./execution-core.js";
import {
  resourceLibraryRevisionTable,
  resourceLibraryEntryTable,
} from "./resource-library.js";
const id = (name: string) => char(name, { length: 26 });
export const agentRunLibraryTable = mysqlTable(
  "agent_run_library",
  {
    workspaceId: id("workspace_id").notNull(),
    runId: id("run_id").notNull(),
    libraryId: id("library_id").notNull(),
    revisionId: id("revision_id").notNull(),
    source: varchar("source", { length: 16 })
      .$type<"explicit" | "discovered">()
      .notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.runId, t.libraryId] }),
    uniqueIndex("uq_run_library_revision").on(
      t.workspaceId,
      t.runId,
      t.revisionId,
    ),
    foreignKey({
      name: "fk_run_library_run",
      columns: [t.workspaceId, t.runId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_run_library_revision",
      columns: [t.workspaceId, t.libraryId, t.revisionId],
      foreignColumns: [
        resourceLibraryRevisionTable.workspaceId,
        resourceLibraryRevisionTable.libraryId,
        resourceLibraryRevisionTable.id,
      ],
    }),
  ],
);
export const agentRunLibraryUseTable = mysqlTable(
  "agent_run_library_use",
  {
    workspaceId: id("workspace_id").notNull(),
    runId: id("run_id").notNull(),
    revisionId: id("revision_id").notNull(),
    entryId: id("entry_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    useKey: varchar("use_key", { length: 160 }).notNull(),
    locations: json("locations"),
    useKind: varchar("use_kind", { length: 24 })
      .$type<"text_read" | "image_view" | "tool_input">()
      .notNull(),
    contentDigest: char("content_digest", { length: 71 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.runId, t.useKey] }),
    index("ix_library_use_artifact").on(t.workspaceId, t.artifactId),
    foreignKey({
      name: "fk_library_use_pin",
      columns: [t.workspaceId, t.runId, t.revisionId],
      foreignColumns: [
        agentRunLibraryTable.workspaceId,
        agentRunLibraryTable.runId,
        agentRunLibraryTable.revisionId,
      ],
    }),
    foreignKey({
      name: "fk_library_use_entry",
      columns: [t.workspaceId, t.revisionId, t.entryId],
      foreignColumns: [
        resourceLibraryEntryTable.workspaceId,
        resourceLibraryEntryTable.revisionId,
        resourceLibraryEntryTable.entryId,
      ],
    }),
    foreignKey({
      name: "fk_library_use_artifact",
      columns: [t.workspaceId, t.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
  ],
);

export const resourceLibraryConsumerInputTable = mysqlTable(
  "resource_library_consumer_input",
  {
    workspaceId: id("workspace_id").notNull(),
    consumerKind: varchar("consumer_kind", { length: 16 })
      .$type<"capability" | "workflow">()
      .notNull(),
    consumerId: id("consumer_id").notNull(),
    artifactId: id("artifact_id").notNull(),
    authoritySnapshot: json("authority_snapshot").notNull(),
    authorityDigest: char("authority_digest", { length: 71 }).notNull(),
    requiresAssetRead: boolean("requires_asset_read").notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.workspaceId, t.consumerKind, t.consumerId, t.artifactId],
    }),
    foreignKey({
      name: "fk_library_consumer_artifact",
      columns: [t.workspaceId, t.artifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
  ],
);
