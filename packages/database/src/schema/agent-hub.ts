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
import type { AgentManagementKind } from "@kanvas/application";

import { assetTable } from "./content-assets.js";
import { workspaceTable } from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";

const id = (name: string) => char(name, { length: 26 });
const digest = (name: string) => char(name, { length: 71 });
const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export type AgentHubVisibility = "private" | "workspace";
export type AgentHubLifecycle = "active" | "archived";
export type AgentHubAvatar =
  | {
      readonly kind: "emoji";
      readonly value: string;
      readonly backgroundColor: string;
    }
  | {
      readonly kind: "icon";
      readonly value:
        | "robot"
        | "sparkles"
        | "palette"
        | "picture"
        | "bulb"
        | "pen"
        | "camera"
        | "team"
        | "brain"
        | "book"
        | "research"
        | "code"
        | "chart"
        | "compass"
        | "globe"
        | "rocket"
        | "target"
        | "puzzle"
        | "music"
        | "film"
        | "megaphone"
        | "briefcase"
        | "graduation"
        | "shield"
        | "heart"
        | "leaf"
        | "tree"
        | "sun"
        | "planet"
        | "cat"
        | "dog"
        | "butterfly"
        | "coffee"
        | "diamond"
        | "game"
        | "building"
        | "flask"
        | "calculator"
        | "translate"
        | "magic";
      readonly backgroundColor: string;
      readonly foregroundColor?: string;
    }
  | { readonly kind: "image"; readonly assetId: string };

export const agentDefinitionTable = mysqlTable(
  "agent_definition",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    agentKey: varchar("agent_key", { length: 160 }).notNull(),
    managementKind: varchar("management_kind", { length: 16 })
      .$type<AgentManagementKind>()
      .notNull(),
    systemKey: varchar("system_key", { length: 80 }),
    ownerPrincipalId: id("owner_principal_id")
      .notNull()
      .references(() => principalTable.id),
    visibility: varchar("visibility", { length: 16 })
      .$type<AgentHubVisibility>()
      .notNull(),
    usageStatus: varchar("usage_status", { length: 16 })
      .$type<"enabled" | "disabled">()
      .notNull()
      .default("enabled"),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<AgentHubLifecycle>()
      .notNull(),
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
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    uniqueIndex("uq_agent_definition_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_agent_definition_key").on(
      table.workspaceId,
      table.agentKey,
    ),
    uniqueIndex("uq_agent_definition_system_key").on(
      table.workspaceId,
      table.systemKey,
    ),
    uniqueIndex("uq_agent_definition_creation_request").on(
      table.workspaceId,
      table.creationRequestKey,
    ),
    index("ix_agent_definition_discover").on(
      table.workspaceId,
      table.visibility,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_agent_definition_owner").on(
      table.workspaceId,
      table.ownerPrincipalId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const agentPresentationTable = mysqlTable(
  "agent_presentation",
  {
    workspaceId: id("workspace_id").notNull(),
    agentDefinitionId: id("agent_definition_id").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    summary: varchar("summary", { length: 600 }).notNull(),

    avatar: json("avatar").$type<AgentHubAvatar>(),
    coverAssetId: id("cover_asset_id"),
    category: varchar("category", { length: 120 }),
    tags: json("tags").$type<readonly string[]>().notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.agentDefinitionId] }),
    foreignKey({
      name: "fk_agent_presentation_definition",
      columns: [table.workspaceId, table.agentDefinitionId],
      foreignColumns: [
        agentDefinitionTable.workspaceId,
        agentDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_agent_presentation_cover_asset",
      columns: [table.workspaceId, table.coverAssetId],
      foreignColumns: [assetTable.workspaceId, assetTable.id],
    }),
  ],
);

export const skillDefinitionTable = mysqlTable(
  "skill_definition",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    skillKey: varchar("skill_key", { length: 160 }).notNull(),
    ownerPrincipalId: id("owner_principal_id")
      .notNull()
      .references(() => principalTable.id),
    visibility: varchar("visibility", { length: 16 })
      .$type<AgentHubVisibility>()
      .notNull(),
    usageStatus: varchar("usage_status", { length: 16 })
      .$type<"enabled" | "disabled">()
      .notNull()
      .default("enabled"),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<AgentHubLifecycle>()
      .notNull(),
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
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    uniqueIndex("uq_skill_definition_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_skill_definition_key").on(
      table.workspaceId,
      table.skillKey,
    ),
    uniqueIndex("uq_skill_definition_creation_request").on(
      table.workspaceId,
      table.creationRequestKey,
    ),
    index("ix_skill_definition_discover").on(
      table.workspaceId,
      table.visibility,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
    index("ix_skill_definition_owner").on(
      table.workspaceId,
      table.ownerPrincipalId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const skillPresentationTable = mysqlTable(
  "skill_presentation",
  {
    workspaceId: id("workspace_id").notNull(),
    skillDefinitionId: id("skill_definition_id").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    summary: varchar("summary", { length: 600 }).notNull(),
    coverAssetId: id("cover_asset_id"),
    category: varchar("category", { length: 120 }),
    tags: json("tags").$type<readonly string[]>().notNull(),
    exampleRequests: json("example_requests")
      .$type<readonly string[]>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.skillDefinitionId] }),
    foreignKey({
      name: "fk_skill_presentation_definition",
      columns: [table.workspaceId, table.skillDefinitionId],
      foreignColumns: [
        skillDefinitionTable.workspaceId,
        skillDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_skill_presentation_cover_asset",
      columns: [table.workspaceId, table.coverAssetId],
      foreignColumns: [assetTable.workspaceId, assetTable.id],
    }),
    index("ix_skill_presentation_category").on(
      table.workspaceId,
      table.category,
      table.updatedAt,
      table.skillDefinitionId,
    ),
  ],
);
