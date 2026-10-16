import {
  bigint,
  boolean,
  char,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
  type MySqlTableExtraConfigValue,
} from "drizzle-orm/mysql-core";

import {
  capabilityAttemptTable,
  capabilityRunTable,
  workflowRunTable,
  workspaceTable,
} from "./execution-core.js";
import { principalTable } from "./identity-authorization.js";
import type { ProviderModelCatalogDocument } from "@kanvas/contracts/provider-model";
import type { ModelReferenceDocumentV1 } from "@kanvas/contracts/model-reference";

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

const money = (name: string) =>
  decimal(name, {
    precision: 36,
    scale: 12,
    mode: "string",
  });

export type PublishedRevisionLifecycle = "published" | "deprecated" | "revoked";
export type ProviderEndpointLifecycle =
  "active" | "disabled" | "draining" | "revoked";
export type CredentialLifecycle =
  "active" | "disabled" | "revoked" | "replaced";
export type SecretVersionLifecycle =
  | "created"
  | "verified"
  | "active"
  | "draining"
  | "retired"
  | "revoked"
  | "restore_only"
  | "destroyed";
export type SecretSourceKind =
  "plaintext_database" | "encrypted_database" | "deployment_reference";
export type ModelDeploymentLifecycle =
  "active" | "superseded" | "draining" | "disabled" | "revoked";
export type CanonicalModelLifecycle =
  "draft" | "active" | "disabled" | "revoked";
export type ProviderModelLifecycle =
  "discovered" | "mapped" | "active" | "disabled" | "removed";
export type BudgetAccountLifecycle =
  "active" | "frozen" | "exhausted" | "closed";
export type BudgetReservationLifecycle =
  "reserved" | "consuming" | "settled" | "released" | "unknown";
export type BudgetLedgerEntryKind =
  | "reserve"
  | "consume"
  | "release"
  | "unknown_hold"
  | "unknown_resolve"
  | "adjustment"
  | "expire";

export const instancePolicyRevisionTable = mysqlTable(
  "instance_policy_revision",
  {
    id: id("id").primaryKey(),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    policyDocument: json("policy_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedRevisionLifecycle>()
      .notNull(),
    supersedesRevisionId: id("supersedes_revision_id").references(
      (): AnyMySqlColumn => instancePolicyRevisionTable.id,
    ),
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
    uniqueIndex("uq_instance_policy_revision").on(table.revision),
    uniqueIndex("uq_instance_policy_digest").on(table.canonicalDigest),
  ],
);

export const instancePolicyBindingTable = mysqlTable(
  "instance_policy_binding",
  {
    singletonId: tinyint("singleton_id", {
      unsigned: true,
    }).primaryKey(),
    activeRevisionId: id("active_revision_id")
      .notNull()
      .references(() => instancePolicyRevisionTable.id),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedAt: timestamp("updated_at").notNull(),
  },
);

export const modelReferenceSnapshotTable = mysqlTable(
  "model_reference_snapshot",
  {
    id: id("id").primaryKey(),
    revision: bigint("revision", { mode: "number", unsigned: true })
      .autoincrement()
      .notNull(),
    schemaVersion: smallint("schema_version", { unsigned: true }).notNull(),
    sourceKind: varchar("source_kind", { length: 32 })
      .$type<"models_dev">()
      .notNull(),
    sourceRevision: varchar("source_revision", { length: 160 }).notNull(),
    sourceDigest: digest("source_digest").notNull(),
    referenceDocument: json("reference_document")
      .$type<ModelReferenceDocumentV1>()
      .notNull(),
    fetchedAt: timestamp("fetched_at").notNull(),
    publishedAt: timestamp("published_at").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_model_reference_snapshot_revision").on(table.revision),
    uniqueIndex("uq_model_reference_snapshot_source_digest").on(
      table.sourceDigest,
    ),
    uniqueIndex("uq_model_reference_snapshot_source_revision").on(
      table.sourceRevision,
    ),
  ],
);

export const workspacePolicyRevisionTable = mysqlTable(
  "workspace_policy_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    policyDocument: json("policy_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedRevisionLifecycle>()
      .notNull(),
    supersedesRevisionId: id("supersedes_revision_id"),
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
      name: "fk_workspace_policy_supersedes",
      columns: [table.workspaceId, table.supersedesRevisionId],
      foreignColumns: [table.workspaceId, table.id],
    }),
    uniqueIndex("uq_workspace_policy_revision").on(
      table.workspaceId,
      table.revision,
    ),
    uniqueIndex("uq_workspace_policy_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
    uniqueIndex("uq_workspace_policy_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const workspacePolicyBindingTable = mysqlTable(
  "workspace_policy_binding",
  {
    workspaceId: id("workspace_id")
      .primaryKey()
      .references(() => workspaceTable.id),
    activeRevisionId: id("active_revision_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_workspace_policy_binding_revision",
      columns: [table.workspaceId, table.activeRevisionId],
      foreignColumns: [
        workspacePolicyRevisionTable.workspaceId,
        workspacePolicyRevisionTable.id,
      ],
    }),
  ],
);

export const providerEndpointTable = mysqlTable(
  "provider_endpoint",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    endpointKey: varchar("endpoint_key", { length: 160 }).notNull(),
    adapterKind: varchar("adapter_kind", {
      length: 40,
    })
      .$type<
        | "openai_native"
        | "openrouter_native"
        | "openai_compatible"
        | "gemini_native"
        | "anthropic_native"
        | "resource_catalog"
      >()
      .notNull(),
    presetKind: varchar("preset_kind", {
      length: 40,
    })
      .$type<
        | "none"
        | "openai"
        | "anthropic"
        | "openrouter"
        | "xai"
        | "gemini"
        | "newapi"
        | "tokenhub"
      >()
      .notNull(),
    baseUrl: varchar("base_url", { length: 2048 }).notNull(),
    canonicalOrigin: varchar("canonical_origin", {
      length: 512,
    }).notNull(),
    baseUrlDigest: digest("base_url_digest").notNull(),
    regionCode: varchar("region_code", { length: 80 }).notNull(),
    networkPolicy: json("network_policy")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    dataPolicy: json("data_policy")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<ProviderEndpointLifecycle>()
      .notNull(),
    validationStatus: varchar("validation_status", {
      length: 24,
    })
      .$type<"pending" | "passed" | "failed">()
      .notNull(),
    validationDigest: digest("validation_digest"),
    validatedAt: timestamp("validated_at"),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_provider_endpoint_key").on(
      table.workspaceId,
      table.endpointKey,
    ),
    uniqueIndex("uq_provider_endpoint_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_provider_endpoint_status").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.adapterKind,
      table.id,
    ),
  ],
);

export const credentialTable = mysqlTable(
  "credential",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    credentialKey: varchar("credential_key", {
      length: 160,
    }).notNull(),
    providerKind: varchar("provider_kind", { length: 80 }).notNull(),
    authorityDigest: digest("authority_digest").notNull(),
    billingIdentityDigest: digest("billing_identity_digest").notNull(),
    egressIdentityDigest: digest("egress_identity_digest").notNull(),
    identityDigest: digest("identity_digest").notNull(),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    materialGeneration: int("material_generation", {
      unsigned: true,
    }).notNull(),
    activeSecretVersionId: id("active_secret_version_id"),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<CredentialLifecycle>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_credential_active_secret_version",
      columns: [table.workspaceId, table.id, table.activeSecretVersionId],
      foreignColumns: [
        secretVersionTable.workspaceId,
        secretVersionTable.credentialId,
        secretVersionTable.id,
      ],
    }),
    foreignKey({
      name: "fk_credential_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    uniqueIndex("uq_credential_key").on(table.workspaceId, table.credentialKey),
    uniqueIndex("uq_credential_workspace_id").on(table.workspaceId, table.id),
    index("ix_credential_endpoint_status").on(
      table.workspaceId,
      table.providerEndpointId,
      table.lifecycleStatus,
      table.id,
    ),
  ],
);

export const providerSettingTable = mysqlTable(
  "provider_setting",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    displayName: varchar("display_name", {
      length: 160,
    }).notNull(),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    credentialId: id("credential_id").notNull(),
    requestedModelKeys: json("requested_model_keys")
      .$type<readonly string[]>()
      .notNull(),
    modelPricingConfigurations: json("model_pricing_configurations").$type<
      readonly Readonly<Record<string, unknown>>[]
    >(),
    modelCatalogSnapshotId: id("model_catalog_snapshot_id"),
    modelCatalogRevision: int("model_catalog_revision", {
      unsigned: true,
    }),
    activatedModelCatalogSnapshotId: id("activated_model_catalog_snapshot_id"),
    activatedModelCatalogRevision: int("activated_model_catalog_revision", {
      unsigned: true,
    }),
    modelCatalogChangesPendingReview: boolean(
      "model_catalog_changes_pending_review",
    )
      .notNull()
      .default(false),
    modelProfileRevisionId: id("model_profile_revision_id"),
    modelDeploymentId: id("model_deployment_id"),
    pricingRevisionId: id("pricing_revision_id"),
    routePolicyRevisionId: id("route_policy_revision_id"),
    budgetAccountId: id("budget_account_id"),
    idempotencyKey: varchar("idempotency_key", {
      length: 160,
    }).notNull(),
    requestDigest: digest("request_digest").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    activatedAt: timestamp("activated_at"),
    disabledAt: timestamp("disabled_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_provider_setting_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_provider_setting_credential",
      columns: [table.workspaceId, table.credentialId],
      foreignColumns: [credentialTable.workspaceId, credentialTable.id],
    }),
    uniqueIndex("uq_provider_setting_endpoint").on(
      table.workspaceId,
      table.providerEndpointId,
    ),
    uniqueIndex("uq_provider_setting_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_provider_setting_credential").on(
      table.workspaceId,
      table.credentialId,
    ),
    uniqueIndex("uq_provider_setting_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("ix_provider_setting_workspace").on(
      table.workspaceId,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const canonicalModelTable = mysqlTable(
  "canonical_model",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    slug: varchar("slug", { length: 160 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<CanonicalModelLifecycle>()
      .notNull(),
    sourceKind: varchar("source_kind", { length: 16 })
      .$type<"models_dev" | "provider" | "manual">()
      .notNull(),
    sourceReference: varchar("source_reference", { length: 512 }),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    activatedAt: timestamp("activated_at"),
    disabledAt: timestamp("disabled_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    uniqueIndex("uq_canonical_model_slug").on(table.workspaceId, table.slug),
    uniqueIndex("uq_canonical_model_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_canonical_model_lifecycle").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const providerModelCatalogSnapshotTable = mysqlTable(
  "provider_model_catalog_snapshot",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerSettingId: id("provider_setting_id").notNull(),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    discoveryMethod: varchar("discovery_method", {
      length: 120,
    }).notNull(),
    sourceDigest: digest("source_digest").notNull(),
    catalogDocument: json("catalog_document")
      .$type<ProviderModelCatalogDocument>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    discoveredAt: timestamp("discovered_at").notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_provider_model_catalog_setting",
      columns: [table.workspaceId, table.providerSettingId],
      foreignColumns: [
        providerSettingTable.workspaceId,
        providerSettingTable.id,
      ],
    }),
    foreignKey({
      name: "fk_provider_model_catalog_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    uniqueIndex("uq_provider_model_catalog_revision").on(
      table.workspaceId,
      table.providerSettingId,
      table.revision,
    ),
    uniqueIndex("uq_provider_model_catalog_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_provider_model_catalog_latest").on(
      table.workspaceId,
      table.providerSettingId,
      table.revision,
      table.discoveredAt,
    ),
  ],
);

export const providerModelTable = mysqlTable(
  "provider_model",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerSettingId: id("provider_setting_id").notNull(),
    upstreamModelId: varchar("upstream_model_id", { length: 512 }).notNull(),
    canonicalModelId: id("canonical_model_id"),
    catalogSnapshotId: id("catalog_snapshot_id").notNull(),
    mappingSource: varchar("mapping_source", { length: 16 }).$type<
      "models_dev" | "provider" | "manual"
    >(),
    mappingConfidence: varchar("mapping_confidence", { length: 16 }).$type<
      "exact" | "suggested" | "manual"
    >(),
    maximumChargeCurrencyCode: char("maximum_charge_currency_code", {
      length: 3,
    }),
    maximumChargeAmount: money("maximum_charge_amount"),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 })
      .$type<ProviderModelLifecycle>()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    mappedAt: timestamp("mapped_at"),
    activatedAt: timestamp("activated_at"),
    disabledAt: timestamp("disabled_at"),
    removedAt: timestamp("removed_at"),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_provider_model_setting",
      columns: [table.workspaceId, table.providerSettingId],
      foreignColumns: [
        providerSettingTable.workspaceId,
        providerSettingTable.id,
      ],
    }),
    foreignKey({
      name: "fk_provider_model_canonical",
      columns: [table.workspaceId, table.canonicalModelId],
      foreignColumns: [canonicalModelTable.workspaceId, canonicalModelTable.id],
    }),
    foreignKey({
      name: "fk_provider_model_catalog",
      columns: [table.workspaceId, table.catalogSnapshotId],
      foreignColumns: [
        providerModelCatalogSnapshotTable.workspaceId,
        providerModelCatalogSnapshotTable.id,
      ],
    }),
    uniqueIndex("uq_provider_model_upstream").on(
      table.workspaceId,
      table.providerSettingId,
      table.upstreamModelId,
    ),
    uniqueIndex("uq_provider_model_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_provider_model_canonical").on(
      table.workspaceId,
      table.canonicalModelId,
      table.lifecycleStatus,
      table.id,
    ),
    index("ix_provider_model_setting_status").on(
      table.workspaceId,
      table.providerSettingId,
      table.lifecycleStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const secretVersionTable = mysqlTable(
  "secret_version",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    credentialId: id("credential_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    materialGeneration: int("material_generation", {
      unsigned: true,
    }).notNull(),
    sourceKind: varchar("source_kind", {
      length: 32,
    })
      .$type<SecretSourceKind>()
      .notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<SecretVersionLifecycle>()
      .notNull(),
    materialCiphertextBase64: mediumtext("material_ciphertext_base64"),
    materialPlaintextBase64: mediumtext("material_plaintext_base64"),
    materialNonceBase64: varchar("material_nonce_base64", {
      length: 32,
    }),
    materialAuthTagBase64: varchar("material_auth_tag_base64", {
      length: 32,
    }),
    wrappedDekBase64: varchar("wrapped_dek_base64", {
      length: 512,
    }),
    wrapNonceBase64: varchar("wrap_nonce_base64", {
      length: 32,
    }),
    wrapAuthTagBase64: varchar("wrap_auth_tag_base64", {
      length: 32,
    }),
    kekVersion: varchar("kek_version", { length: 120 }),
    aadDigest: digest("aad_digest").notNull(),
    deploymentReference: varchar("deployment_reference", {
      length: 512,
    }),
    materialFingerprint: digest("material_fingerprint").notNull(),
    formatVersion: smallint("format_version", {
      unsigned: true,
    }).notNull(),
    drainDeadlineAt: timestamp("drain_deadline_at"),
    verifiedAt: timestamp("verified_at"),
    activatedAt: timestamp("activated_at"),
    retiredAt: timestamp("retired_at"),
    revokedAt: timestamp("revoked_at"),
    destroyedAt: timestamp("destroyed_at"),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_secret_version_credential",
      columns: [table.workspaceId, table.credentialId],
      foreignColumns: [credentialTable.workspaceId, credentialTable.id],
    }),
    uniqueIndex("uq_secret_version_number").on(
      table.credentialId,
      table.version,
    ),
    uniqueIndex("uq_secret_version_generation").on(
      table.credentialId,
      table.materialGeneration,
    ),
    uniqueIndex("uq_secret_version_workspace_credential_id").on(
      table.workspaceId,
      table.credentialId,
      table.id,
    ),
    index("ix_secret_version_lifecycle").on(
      table.workspaceId,
      table.credentialId,
      table.lifecycleStatus,
      table.id,
    ),
  ],
);

export const modelProfileRevisionTable = mysqlTable(
  "model_profile_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    canonicalModelId: id("canonical_model_id"),
    profileKey: varchar("profile_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    profileDocument: json("profile_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedRevisionLifecycle>()
      .notNull(),
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
      name: "fk_model_profile_canonical",
      columns: [table.workspaceId, table.canonicalModelId],
      foreignColumns: [canonicalModelTable.workspaceId, canonicalModelTable.id],
    }),
    uniqueIndex("uq_model_profile_revision").on(
      table.workspaceId,
      table.profileKey,
      table.revision,
    ),
    uniqueIndex("uq_model_profile_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
    uniqueIndex("uq_model_profile_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_model_profile_canonical").on(
      table.workspaceId,
      table.canonicalModelId,
      table.lifecycleStatus,
      table.revision,
    ),
  ],
);

export const modelDeploymentTable = mysqlTable(
  "model_deployment",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    providerModelRecordId: id("provider_model_record_id"),
    modelProfileRevisionId: id("model_profile_revision_id").notNull(),
    deploymentKey: varchar("deployment_key", {
      length: 160,
    }).notNull(),
    providerModelId: varchar("provider_model_id", {
      length: 512,
    }).notNull(),
    generation: int("generation", { unsigned: true }).notNull().default(1),
    supersedesModelDeploymentId: id("supersedes_model_deployment_id"),
    deploymentDigest: digest("deployment_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<ModelDeploymentLifecycle>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_model_deployment_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_model_deployment_provider_model",
      columns: [table.workspaceId, table.providerModelRecordId],
      foreignColumns: [providerModelTable.workspaceId, providerModelTable.id],
    }),
    foreignKey({
      name: "fk_model_deployment_profile",
      columns: [table.workspaceId, table.modelProfileRevisionId],
      foreignColumns: [
        modelProfileRevisionTable.workspaceId,
        modelProfileRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_model_deployment_key").on(
      table.workspaceId,
      table.deploymentKey,
    ),
    foreignKey({
      name: "fk_model_deployment_supersedes",
      columns: [table.workspaceId, table.supersedesModelDeploymentId],
      foreignColumns: [table.workspaceId, table.id],
    }),
    uniqueIndex("uq_model_deployment_provider_generation").on(
      table.providerEndpointId,
      table.providerModelId,
      table.generation,
    ),
    uniqueIndex("uq_model_deployment_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_model_deployment_status").on(
      table.workspaceId,
      table.providerEndpointId,
      table.lifecycleStatus,
      table.id,
    ),
    index("ix_model_deployment_supersedes").on(
      table.workspaceId,
      table.supersedesModelDeploymentId,
    ),
    index("ix_model_deployment_provider_model").on(
      table.workspaceId,
      table.providerModelRecordId,
      table.lifecycleStatus,
      table.generation,
    ),
  ],
);

export const pricingRevisionTable = mysqlTable(
  "pricing_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    providerEndpointId: id("provider_endpoint_id").notNull(),
    modelDeploymentId: id("model_deployment_id"),
    pricingKey: varchar("pricing_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    pricingDocument: json("pricing_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedRevisionLifecycle>()
      .notNull(),
    sourceKind: varchar("source_kind", {
      length: 32,
    })
      .$type<
        | "provider_documentation"
        | "provider_api"
        | "manual"
        | "contract"
        | "unverified"
      >()
      .notNull(),
    verifiedAt: timestamp("verified_at").notNull(),
    effectiveAt: timestamp("effective_at").notNull(),
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
      name: "fk_pricing_revision_endpoint",
      columns: [table.workspaceId, table.providerEndpointId],
      foreignColumns: [
        providerEndpointTable.workspaceId,
        providerEndpointTable.id,
      ],
    }),
    foreignKey({
      name: "fk_pricing_revision_model",
      columns: [table.workspaceId, table.modelDeploymentId],
      foreignColumns: [
        modelDeploymentTable.workspaceId,
        modelDeploymentTable.id,
      ],
    }),
    uniqueIndex("uq_pricing_revision_number").on(
      table.workspaceId,
      table.pricingKey,
      table.revision,
    ),
    uniqueIndex("uq_pricing_revision_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_pricing_revision_scope").on(
      table.workspaceId,
      table.providerEndpointId,
      table.modelDeploymentId,
      table.lifecycleStatus,
      table.effectiveAt,
      table.id,
    ),
  ],
);

export const routePolicyRevisionTable = mysqlTable(
  "route_policy_revision",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    routeKey: varchar("route_key", { length: 160 }).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    routeDocument: json("route_document")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    canonicalDigest: digest("canonical_digest").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<PublishedRevisionLifecycle>()
      .notNull(),
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
    uniqueIndex("uq_route_policy_revision").on(
      table.workspaceId,
      table.routeKey,
      table.revision,
    ),
    uniqueIndex("uq_route_policy_digest").on(
      table.workspaceId,
      table.canonicalDigest,
    ),
    uniqueIndex("uq_route_policy_workspace_id").on(table.workspaceId, table.id),
  ],
);

export const budgetAccountTable = mysqlTable(
  "budget_account",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    accountKey: varchar("account_key", { length: 160 }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    periodStartAt: timestamp("period_start_at").notNull(),
    periodEndAt: timestamp("period_end_at").notNull(),
    hardLimitAmount: money("hard_limit_amount").notNull(),
    consumedAmount: money("consumed_amount").notNull(),
    reservedAmount: money("reserved_amount").notNull(),
    unknownHeldAmount: money("unknown_held_amount").notNull(),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<BudgetAccountLifecycle>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdByPrincipalId: id("created_by_principal_id")
      .notNull()
      .references(() => principalTable.id),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_budget_account_period").on(
      table.workspaceId,
      table.accountKey,
      table.periodStartAt,
    ),
    uniqueIndex("uq_budget_account_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_budget_account_active").on(
      table.workspaceId,
      table.lifecycleStatus,
      table.periodEndAt,
      table.id,
    ),
  ],
);

export const budgetReservationTable = mysqlTable(
  "budget_reservation",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    budgetAccountId: id("budget_account_id").notNull(),
    reservationKey: varchar("reservation_key", {
      length: 191,
    }).notNull(),
    requestDigest: digest("request_digest").notNull(),
    workflowRunId: id("workflow_run_id"),
    capabilityRunId: id("capability_run_id"),
    capabilityAttemptId: id("capability_attempt_id"),
    agentModelCallId: id("agent_model_call_id"),
    pricingRevisionId: id("pricing_revision_id"),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    reservedAmount: money("reserved_amount").notNull(),
    settledAmount: money("settled_amount"),
    unknownHoldAmount: money("unknown_hold_amount"),
    lifecycleStatus: varchar("lifecycle_status", {
      length: 24,
    })
      .$type<BudgetReservationLifecycle>()
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    settledAt: timestamp("settled_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_budget_reservation_account",
      columns: [table.workspaceId, table.budgetAccountId],
      foreignColumns: [budgetAccountTable.workspaceId, budgetAccountTable.id],
    }),
    foreignKey({
      name: "fk_budget_reservation_workflow",
      columns: [table.workspaceId, table.workflowRunId],
      foreignColumns: [workflowRunTable.workspaceId, workflowRunTable.id],
    }),
    foreignKey({
      name: "fk_budget_reservation_capability",
      columns: [table.workspaceId, table.capabilityRunId],
      foreignColumns: [capabilityRunTable.workspaceId, capabilityRunTable.id],
    }),
    foreignKey({
      name: "fk_budget_reservation_attempt",
      columns: [table.workspaceId, table.capabilityAttemptId],
      foreignColumns: [
        capabilityAttemptTable.workspaceId,
        capabilityAttemptTable.id,
      ],
    }),
    foreignKey({
      name: "fk_budget_reservation_pricing",
      columns: [table.workspaceId, table.pricingRevisionId],
      foreignColumns: [
        pricingRevisionTable.workspaceId,
        pricingRevisionTable.id,
      ],
    }),
    uniqueIndex("uq_budget_reservation_key").on(
      table.budgetAccountId,
      table.reservationKey,
    ),
    uniqueIndex("uq_budget_reservation_workspace_id").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("uq_budget_reservation_attempt").on(table.capabilityAttemptId),
    uniqueIndex("uq_budget_reservation_agent_model_call").on(
      table.agentModelCallId,
    ),
    index("ix_budget_reservation_expiry").on(
      table.lifecycleStatus,
      table.expiresAt,
      table.id,
    ),
    index("ix_budget_reservation_run").on(
      table.workspaceId,
      table.workflowRunId,
      table.lifecycleStatus,
      table.id,
    ),
    index("ix_budget_reservation_agent_run").on(
      table.workspaceId,
      table.agentModelCallId,
      table.lifecycleStatus,
      table.id,
    ),
  ],
);

export const budgetLedgerEntryTable = mysqlTable(
  "budget_ledger_entry",
  {
    id: id("id").primaryKey(),
    workspaceId: id("workspace_id").notNull(),
    budgetAccountId: id("budget_account_id").notNull(),
    budgetReservationId: id("budget_reservation_id"),
    entryKey: varchar("entry_key", { length: 191 }).notNull(),
    entryKind: varchar("entry_kind", {
      length: 32,
    })
      .$type<BudgetLedgerEntryKind>()
      .notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    reservedDelta: money("reserved_delta").notNull(),
    consumedDelta: money("consumed_delta").notNull(),
    unknownHeldDelta: money("unknown_held_delta").notNull(),
    reservedBalanceAfter: money("reserved_balance_after").notNull(),
    consumedBalanceAfter: money("consumed_balance_after").notNull(),
    unknownHeldBalanceAfter: money("unknown_held_balance_after").notNull(),
    requestDigest: digest("request_digest").notNull(),
    evidence: json("evidence")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    correctsEntryId: id("corrects_entry_id"),
    createdByPrincipalId: id("created_by_principal_id").references(
      () => principalTable.id,
    ),
    occurredAt: timestamp("occurred_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_budget_ledger_account",
      columns: [table.workspaceId, table.budgetAccountId],
      foreignColumns: [budgetAccountTable.workspaceId, budgetAccountTable.id],
    }),
    foreignKey({
      name: "fk_budget_ledger_reservation",
      columns: [table.workspaceId, table.budgetReservationId],
      foreignColumns: [
        budgetReservationTable.workspaceId,
        budgetReservationTable.id,
      ],
    }),
    foreignKey({
      name: "fk_budget_ledger_correction",
      columns: [
        table.workspaceId,
        table.budgetAccountId,
        table.correctsEntryId,
      ],
      foreignColumns: [table.workspaceId, table.budgetAccountId, table.id],
    }),
    uniqueIndex("uq_budget_ledger_entry_key").on(
      table.budgetAccountId,
      table.entryKey,
    ),
    uniqueIndex("uq_budget_ledger_workspace_account_id").on(
      table.workspaceId,
      table.budgetAccountId,
      table.id,
    ),
    index("ix_budget_ledger_reservation").on(
      table.budgetReservationId,
      table.recordedAt,
      table.id,
    ),
    index("ix_budget_ledger_timeline").on(
      table.workspaceId,
      table.budgetAccountId,
      table.recordedAt,
      table.id,
    ),
  ],
);
