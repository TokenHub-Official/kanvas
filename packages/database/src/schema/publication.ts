import {
  bigint,
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
  artifactTable,
  storedObjectTable,
  workflowDefinitionTable,
  workflowRevisionTable,
  workspaceTable,
} from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";
import { agentRunTable, agentThreadTable } from "./agent.js";
import { skillDefinitionTable } from "./agent-hub.js";

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

type JsonObject = Readonly<Record<string, unknown>>;

export type PublicationSubjectKind = "workflow" | "skill";
export type PublicationCheckKind =
  "schema" | "resources" | "security" | "compatibility" | "eval";
export type PublicationCheckOutcome = "passed" | "failed";
export type PublicationReviewDecision = "approved" | "rejected";
export type PublicationDraftLifecycle = "active" | "archived";
export type PublishedSkillLifecycle = "published" | "deprecated";
export type RevisionRuntimeStatus = "enabled" | "disabled" | "revoked";
export type SkillResourceKind =
  "instructions" | "reference" | "template" | "asset" | "eval";
export type SkillPackageImportState =
  | "quarantined"
  | "validated"
  | "rejected"
  | "draft_adopted"
  | "candidate_linked";

export const publicationCandidateTable = mysqlTable(
  "publication_candidate",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    subjectKind: varchar("subject_kind", {
      length: 16,
    })
      .$type<PublicationSubjectKind>()
      .notNull(),
    subjectKey: varchar("subject_key", { length: 160 }).notNull(),
    sourceDraftId: id("source_draft_id").notNull(),
    sourceDraftVersion: int("source_draft_version", {
      unsigned: true,
    }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    contentDocument: json("content_document").$type<JsonObject>().notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    parserProfileVersion: varchar("parser_profile_version", {
      length: 80,
    }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_publication_candidate_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_publication_candidate_draft_version").on(
      table.workspaceId,
      table.subjectKind,
      table.sourceDraftId,
      table.sourceDraftVersion,
    ),
    index("ix_publication_candidate_subject").on(
      table.workspaceId,
      table.subjectKind,
      table.subjectKey,
      table.createdAt,
      table.id,
    ),
  ],
);

export const publicationCheckTable = mysqlTable(
  "publication_check",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    publicationCandidateId: id("publication_candidate_id").notNull(),
    checkKind: varchar("check_kind", {
      length: 24,
    })
      .$type<PublicationCheckKind>()
      .notNull(),
    checkProfileVersion: varchar("check_profile_version", {
      length: 80,
    }).notNull(),
    outcome: varchar("outcome", {
      length: 16,
    })
      .$type<PublicationCheckOutcome>()
      .notNull(),
    evidenceSummary: json("evidence_summary").$type<JsonObject>().notNull(),
    evidenceDigest: digest("evidence_digest").notNull(),
    checkedByPrincipalId: id("checked_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    checkedAt: timestamp("checked_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_publication_check_candidate",
      columns: [table.workspaceId, table.publicationCandidateId],
      foreignColumns: [
        publicationCandidateTable.workspaceId,
        publicationCandidateTable.id,
      ],
    }),
    uniqueIndex("uq_publication_check_slot").on(
      table.workspaceId,
      table.publicationCandidateId,
      table.checkKind,
    ),
    index("ix_publication_check_candidate").on(
      table.workspaceId,
      table.publicationCandidateId,
      table.outcome,
    ),
  ],
);

export const publicationReviewDecisionTable = mysqlTable(
  "publication_review_decision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    publicationCandidateId: id("publication_candidate_id").notNull(),
    decision: varchar("decision", {
      length: 16,
    })
      .$type<PublicationReviewDecision>()
      .notNull(),
    commentSummary: varchar("comment_summary", { length: 1000 }),
    candidateDigest: digest("candidate_digest").notNull(),
    reviewerPrincipalId: id("reviewer_principal_id")
      .notNull()
      .references(() => principalTable.id),
    decidedAt: timestamp("decided_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_publication_review_candidate",
      columns: [table.workspaceId, table.publicationCandidateId],
      foreignColumns: [
        publicationCandidateTable.workspaceId,
        publicationCandidateTable.id,
      ],
    }),
    uniqueIndex("uq_publication_review_candidate").on(
      table.workspaceId,
      table.publicationCandidateId,
    ),
  ],
);

export const skillRevisionTable = mysqlTable(
  "skill_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    skillDefinitionId: id("skill_definition_id").notNull(),
    skillKey: varchar("skill_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedSkillLifecycle>()
      .notNull(),
    publicationCandidateId: id("publication_candidate_id").notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    manifestDocument: json("manifest_document").$type<JsonObject>().notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    packageDigest: digest("package_digest").notNull(),
    parserProfileVersion: varchar("parser_profile_version", {
      length: 80,
    }).notNull(),
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
      name: "fk_skill_revision_definition",
      columns: [table.workspaceId, table.skillDefinitionId],
      foreignColumns: [
        skillDefinitionTable.workspaceId,
        skillDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_skill_revision_candidate",
      columns: [table.workspaceId, table.publicationCandidateId],
      foreignColumns: [
        publicationCandidateTable.workspaceId,
        publicationCandidateTable.id,
      ],
    }),
    uniqueIndex("uq_skill_revision_number").on(
      table.workspaceId,
      table.skillKey,
      table.revision,
    ),
    uniqueIndex("uq_skill_revision_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
    uniqueIndex("uq_skill_revision_candidate").on(
      table.workspaceId,
      table.publicationCandidateId,
    ),
    uniqueIndex("uq_skill_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const workflowDraftTable = mysqlTable(
  "workflow_draft",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    workflowDefinitionId: id("workflow_definition_id").references(
      () => workflowDefinitionTable.id,
    ),
    workflowKey: varchar("workflow_key", { length: 160 }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    contentDocument: json("content_document").$type<JsonObject>().notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 16,
    })
      .$type<PublicationDraftLifecycle>()
      .notNull(),
    derivedFromWorkflowRevisionId: id("derived_from_workflow_revision_id"),
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
      name: "fk_workflow_draft_derived",
      columns: [table.workspaceId, table.derivedFromWorkflowRevisionId],
      foreignColumns: [
        workflowRevisionTable.workspaceId,
        workflowRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_workflow_draft_key").on(
      table.workspaceId,
      table.workflowKey,
    ),
    uniqueIndex("uq_workflow_draft_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_workflow_draft_definition").on(
      table.workspaceId,
      table.workflowDefinitionId,
      table.lifecycleStatus,
    ),
  ],
);

export const skillDraftTable = mysqlTable(
  "skill_draft",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    skillDefinitionId: id("skill_definition_id").notNull(),
    skillKey: varchar("skill_key", { length: 160 }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    contentDocument: json("content_document").$type<JsonObject>().notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 16,
    })
      .$type<PublicationDraftLifecycle>()
      .notNull(),
    derivedFromSkillRevisionId: id("derived_from_skill_revision_id"),
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
      name: "fk_skill_draft_definition",
      columns: [table.workspaceId, table.skillDefinitionId],
      foreignColumns: [
        skillDefinitionTable.workspaceId,
        skillDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_skill_draft_derived",
      columns: [table.workspaceId, table.derivedFromSkillRevisionId],
      foreignColumns: [skillRevisionTable.workspaceId, skillRevisionTable.id],
    }),
    uniqueIndex("uq_skill_draft_key").on(table.workspaceId, table.skillKey),
    uniqueIndex("uq_skill_draft_workspace_id").on(table.workspaceId, table.id),
  ],
);

export const skillDerivationTable = mysqlTable(
  "skill_derivation",
  {
    workspaceId: id("workspace_id").notNull(),
    skillDefinitionId: id("skill_definition_id").notNull(),
    sourceThreadId: id("source_thread_id").notNull(),
    sourceRunId: id("source_run_id").notNull(),
    sourceArtifactId: id("source_artifact_id"),
    sourceDigest: digest("source_digest").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.skillDefinitionId] }),
    foreignKey({
      name: "fk_skill_derivation_definition",
      columns: [table.workspaceId, table.skillDefinitionId],
      foreignColumns: [
        skillDefinitionTable.workspaceId,
        skillDefinitionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_skill_derivation_thread",
      columns: [table.workspaceId, table.sourceThreadId],
      foreignColumns: [agentThreadTable.workspaceId, agentThreadTable.id],
    }),
    foreignKey({
      name: "fk_skill_derivation_run",
      columns: [table.workspaceId, table.sourceRunId],
      foreignColumns: [agentRunTable.workspaceId, agentRunTable.id],
    }),
    foreignKey({
      name: "fk_skill_derivation_artifact",
      columns: [table.workspaceId, table.sourceArtifactId],
      foreignColumns: [artifactTable.workspaceId, artifactTable.id],
    }),
    index("ix_skill_derivation_source_run").on(
      table.workspaceId,
      table.sourceRunId,
      table.skillDefinitionId,
    ),
  ],
);

export const skillPackageImportTable = mysqlTable(
  "skill_package_import",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    sourceStoredObjectId: id("source_stored_object_id").notNull(),
    rawArchiveSha256: char("raw_archive_sha256", {
      length: 64,
    }).notNull(),
    parserProfileVersion: varchar("parser_profile_version", {
      length: 80,
    }).notNull(),
    state: varchar("state", {
      length: 24,
    })
      .$type<SkillPackageImportState>()
      .notNull(),
    inventorySummary: json("inventory_summary").$type<JsonObject>(),
    inventoryDigest: digest("inventory_digest"),
    logicalPackageDigest: digest("logical_package_digest"),
    rejectionCode: varchar("rejection_code", { length: 120 }),
    adoptedSkillDraftId: id("adopted_skill_draft_id"),
    adoptedPublicationCandidateId: id("adopted_publication_candidate_id"),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_skill_import_source",
      columns: [table.workspaceId, table.sourceStoredObjectId],
      foreignColumns: [storedObjectTable.workspaceId, storedObjectTable.id],
    }),
    foreignKey({
      name: "fk_skill_import_draft",
      columns: [table.workspaceId, table.adoptedSkillDraftId],
      foreignColumns: [skillDraftTable.workspaceId, skillDraftTable.id],
    }),
    foreignKey({
      name: "fk_skill_import_candidate",
      columns: [table.workspaceId, table.adoptedPublicationCandidateId],
      foreignColumns: [
        publicationCandidateTable.workspaceId,
        publicationCandidateTable.id,
      ],
    }),
    uniqueIndex("uq_skill_import_source").on(
      table.workspaceId,
      table.sourceStoredObjectId,
      table.rawArchiveSha256,
      table.parserProfileVersion,
    ),
    index("ix_skill_import_state").on(
      table.workspaceId,
      table.state,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const workflowRevisionPublicationTable = mysqlTable(
  "workflow_revision_publication",
  {
    workflowRevisionId: id("workflow_revision_id")
      .primaryKey()
      .references(() => workflowRevisionTable.id),
    workspaceId: id("workspace_id").notNull(),
    publicationCandidateId: id("publication_candidate_id").notNull(),
    publishedByPrincipalId: id("published_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    publishedAt: timestamp("published_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_workflow_publication_revision",
      columns: [table.workspaceId, table.workflowRevisionId],
      foreignColumns: [
        workflowRevisionTable.workspaceId,
        workflowRevisionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_workflow_publication_candidate",
      columns: [table.workspaceId, table.publicationCandidateId],
      foreignColumns: [
        publicationCandidateTable.workspaceId,
        publicationCandidateTable.id,
      ],
    }),
    uniqueIndex("uq_workflow_publication_candidate").on(
      table.workspaceId,
      table.publicationCandidateId,
    ),
  ],
);

export const skillRevisionResourceTable = mysqlTable(
  "skill_revision_resource",
  {
    skillRevisionId: id("skill_revision_id").notNull(),
    workspaceId: id("workspace_id").notNull(),
    resourcePath: varchar("resource_path", { length: 500 }).notNull(),
    resourceKind: varchar("resource_kind", {
      length: 24,
    })
      .$type<SkillResourceKind>()
      .notNull(),
    storedObjectId: id("stored_object_id").notNull(),
    contentDigest: digest("content_digest").notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    byteSize: bigint("byte_size", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.skillRevisionId, table.resourcePath],
    }),
    foreignKey({
      name: "fk_skill_resource_revision",
      columns: [table.workspaceId, table.skillRevisionId],
      foreignColumns: [skillRevisionTable.workspaceId, skillRevisionTable.id],
    }),
    foreignKey({
      name: "fk_skill_resource_object",
      columns: [table.workspaceId, table.storedObjectId],
      foreignColumns: [storedObjectTable.workspaceId, storedObjectTable.id],
    }),
    uniqueIndex("uq_skill_resource_ordinal").on(
      table.skillRevisionId,
      table.ordinal,
    ),
  ],
);

export const skillRevisionWorkflowEntrypointTable = mysqlTable(
  "skill_revision_workflow_entrypoint",
  {
    skillRevisionId: id("skill_revision_id").notNull(),
    workspaceId: id("workspace_id").notNull(),
    entrypointKey: varchar("entrypoint_key", { length: 160 }).notNull(),
    workflowRevisionId: id("workflow_revision_id").notNull(),
    ordinal: int("ordinal", { unsigned: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.skillRevisionId, table.entrypointKey],
    }),
    foreignKey({
      name: "fk_skill_entrypoint_revision",
      columns: [table.workspaceId, table.skillRevisionId],
      foreignColumns: [skillRevisionTable.workspaceId, skillRevisionTable.id],
    }),
    foreignKey({
      name: "fk_skill_entrypoint_workflow",
      columns: [table.workspaceId, table.workflowRevisionId],
      foreignColumns: [
        workflowRevisionTable.workspaceId,
        workflowRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_skill_entrypoint_ordinal").on(
      table.skillRevisionId,
      table.ordinal,
    ),
  ],
);

export const workflowRevisionActivationTable = mysqlTable(
  "workflow_revision_activation",
  {
    workspaceId: id("workspace_id").notNull(),
    workflowRevisionId: id("workflow_revision_id").primaryKey(),
    runtimeStatus: varchar("runtime_status", {
      length: 16,
    })
      .$type<RevisionRuntimeStatus>()
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
      name: "fk_workflow_activation_revision",
      columns: [table.workspaceId, table.workflowRevisionId],
      foreignColumns: [
        workflowRevisionTable.workspaceId,
        workflowRevisionTable.id,
      ],
    }),
    index("ix_workflow_activation_status").on(
      table.workspaceId,
      table.runtimeStatus,
      table.updatedAt,
      table.workflowRevisionId,
    ),
  ],
);

export const skillRevisionActivationTable = mysqlTable(
  "skill_revision_activation",
  {
    workspaceId: id("workspace_id").notNull(),
    skillRevisionId: id("skill_revision_id").primaryKey(),
    runtimeStatus: varchar("runtime_status", {
      length: 16,
    })
      .$type<RevisionRuntimeStatus>()
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
      name: "fk_skill_activation_revision",
      columns: [table.workspaceId, table.skillRevisionId],
      foreignColumns: [skillRevisionTable.workspaceId, skillRevisionTable.id],
    }),
    index("ix_skill_activation_status").on(
      table.workspaceId,
      table.runtimeStatus,
      table.updatedAt,
      table.skillRevisionId,
    ),
  ],
);
