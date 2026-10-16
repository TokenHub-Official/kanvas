import type {
  InstanceRegistrationPolicy,
  MembershipStatus,
  OrganizationRole,
  OrganizationStatus,
  PrincipalStatus,
  ServiceGrantStatus,
  WorkspacePermissionId,
  WorkspaceRole,
} from "@kanvas/application";
import {
  boolean,
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { workspaceTable } from "./execution-core.js";
import { instanceRuntimeStateTable } from "./instance-runtime-state.js";

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

export const principalTable = mysqlTable(
  "principal",
  {
    id: id("id").primaryKey(),
    principalType: varchar("principal_type", {
      length: 16,
    })
      .$type<"human" | "service">()
      .notNull(),
    status: varchar("status", {
      length: 16,
    })
      .$type<PrincipalStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("ix_principal_status").on(table.status, table.id)],
);

export const humanPrincipalTable = mysqlTable(
  "human_principal",
  {
    principalId: id("principal_id")
      .primaryKey()
      .references(() => principalTable.id),
    authSubjectId: varchar("auth_subject_id", {
      length: 240,
    }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_human_principal_auth_subject").on(table.authSubjectId),
  ],
);

export const organizationTable = mysqlTable(
  "organization",
  {
    id: id("id").primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", {
      length: 24,
    })
      .$type<OrganizationStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_organization_slug").on(table.slug)],
);

export const servicePrincipalTable = mysqlTable(
  "service_principal",
  {
    principalId: id("principal_id")
      .primaryKey()
      .references(() => principalTable.id),
    organizationId: id("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    serviceKey: varchar("service_key", { length: 160 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_service_principal_key").on(
      table.organizationId,
      table.serviceKey,
    ),
    uniqueIndex("uq_service_principal_organization_id").on(
      table.organizationId,
      table.principalId,
    ),
  ],
);

export const instanceAdministratorTable = mysqlTable(
  "instance_administrator",
  {
    principalId: id("principal_id")
      .primaryKey()
      .references(() => humanPrincipalTable.principalId),
    status: varchar("status", {
      length: 16,
    })
      .$type<PrincipalStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ix_instance_administrator_status").on(
      table.status,
      table.principalId,
    ),
  ],
);

export const instanceRegistrationPolicyTable = mysqlTable(
  "instance_registration_policy",
  {
    instanceId: varchar("instance_id", { length: 120 })
      .primaryKey()
      .references(() => instanceRuntimeStateTable.instanceId),
    mode: varchar("mode", { length: 24 })
      .$type<InstanceRegistrationPolicy["mode"]>()
      .notNull(),
    emailPasswordEnabled: boolean("email_password_enabled").notNull(),
    emailVerificationRequired: boolean("email_verification_required").notNull(),
    oidcProviderIds: json("oidc_provider_ids")
      .$type<readonly string[]>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ix_instance_registration_policy_updated_by").on(
      table.updatedByPrincipalId,
    ),
  ],
);

export const instanceSetupTokenTable = mysqlTable(
  "instance_setup_token",
  {
    id: id("id").primaryKey(),
    tokenPrefix: varchar("token_prefix", { length: 24 }).notNull(),
    tokenHash: digest("token_hash").notNull(),
    hashVersion: smallint("hash_version", {
      unsigned: true,
    }).notNull(),
    bindingMode: varchar("binding_mode", {
      length: 24,
    })
      .$type<"auth_subject" | "verified_email_hash" | "unbound">()
      .notNull(),
    bindingHash: digest("binding_hash"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_instance_setup_token_hash").on(table.tokenHash),
    index("ix_instance_setup_token_prefix").on(
      table.tokenPrefix,
      table.expiresAt,
      table.id,
    ),
  ],
);

export const organizationMembershipTable = mysqlTable(
  "organization_membership",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    principalId: id("principal_id")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    role: varchar("role", {
      length: 16,
    })
      .$type<OrganizationRole>()
      .notNull(),
    status: varchar("status", {
      length: 16,
    })
      .$type<MembershipStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_organization_membership_principal").on(
      table.organizationId,
      table.principalId,
    ),
    uniqueIndex("uq_organization_membership_scope_id").on(
      table.organizationId,
      table.id,
    ),
    index("ix_organization_membership_owner").on(
      table.organizationId,
      table.status,
      table.role,
      table.id,
    ),
  ],
);

export const workspaceMembershipTable = mysqlTable(
  "workspace_membership",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    principalId: id("principal_id")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    role: varchar("role", {
      length: 16,
    })
      .$type<WorkspaceRole>()
      .notNull(),
    status: varchar("status", {
      length: 16,
    })
      .$type<MembershipStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_workspace_membership_principal").on(
      table.workspaceId,
      table.principalId,
    ),
    uniqueIndex("uq_workspace_membership_scope_id").on(
      table.workspaceId,
      table.id,
    ),
    index("ix_workspace_membership_owner").on(
      table.workspaceId,
      table.status,
      table.role,
      table.id,
    ),
    index("ix_workspace_membership_principal").on(
      table.principalId,
      table.status,
      table.workspaceId,
    ),
  ],
);

export const invitationTable = mysqlTable(
  "invitation",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    workspaceId: id("workspace_id").references(() => workspaceTable.id),
    targetEmailNormalized: varchar("target_email_normalized", {
      length: 320,
    }).notNull(),
    targetEmailHash: digest("target_email_hash").notNull(),
    targetPrincipalId: id("target_principal_id").references(
      () => humanPrincipalTable.principalId,
    ),
    organizationRole: varchar("organization_role", {
      length: 16,
    }).$type<OrganizationRole>(),
    workspaceRole: varchar("workspace_role", {
      length: 16,
    }).$type<WorkspaceRole>(),
    tokenPrefix: varchar("token_prefix", { length: 24 }).notNull(),
    tokenHash: digest("token_hash").notNull(),
    hashVersion: smallint("hash_version", {
      unsigned: true,
    }).notNull(),
    status: varchar("status", {
      length: 16,
    })
      .$type<"pending" | "accepted" | "revoked">()
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    revokedReasonCode: varchar("revoked_reason_code", {
      length: 120,
    }),
    version: int("version", { unsigned: true }).notNull(),
    invitedByPrincipalId: id("invited_by_principal_id")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_invitation_token_hash").on(table.tokenHash),
    index("ix_invitation_target").on(
      table.organizationId,
      table.targetEmailHash,
      table.status,
      table.expiresAt,
      table.id,
    ),
    index("ix_invitation_prefix").on(
      table.tokenPrefix,
      table.status,
      table.expiresAt,
      table.id,
    ),
  ],
);

export const serviceGrantTable = mysqlTable(
  "service_grant",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    servicePrincipalId: id("service_principal_id")
      .notNull()
      .references(() => servicePrincipalTable.principalId),
    workspaceId: id("workspace_id")
      .notNull()
      .references(() => workspaceTable.id),
    permissionSet: json("permission_set")
      .$type<readonly WorkspacePermissionId[]>()
      .notNull(),
    permissionDigest: digest("permission_digest").notNull(),
    status: varchar("status", {
      length: 16,
    })
      .$type<ServiceGrantStatus>()
      .notNull(),
    version: int("version", { unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_service_grant_workspace").on(
      table.servicePrincipalId,
      table.workspaceId,
    ),
    uniqueIndex("uq_service_grant_scope_id").on(table.workspaceId, table.id),
    index("ix_service_grant_workspace_status").on(
      table.workspaceId,
      table.status,
      table.id,
    ),
  ],
);

export const serviceApiTokenTable = mysqlTable(
  "service_api_token",
  {
    id: id("id").primaryKey(),
    serviceGrantId: id("service_grant_id")
      .notNull()
      .references(() => serviceGrantTable.id),
    tokenKeyId: varchar("token_key_id", { length: 80 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 24 }).notNull(),
    tokenHash: digest("token_hash").notNull(),
    hashVersion: smallint("hash_version", {
      unsigned: true,
    }).notNull(),
    permissionSet: json("permission_set")
      .$type<readonly WorkspacePermissionId[]>()
      .notNull(),
    permissionDigest: digest("permission_digest").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_service_api_token_key_id").on(table.tokenKeyId),
    uniqueIndex("uq_service_api_token_hash").on(table.tokenHash),
    index("ix_service_api_token_prefix").on(
      table.tokenPrefix,
      table.expiresAt,
      table.id,
    ),
  ],
);

export const auditEventTable = mysqlTable(
  "audit_event",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(
      () => organizationTable.id,
    ),
    workspaceId: id("workspace_id").references(() => workspaceTable.id),
    actorPrincipalId: id("actor_principal_id").references(
      () => principalTable.id,
    ),
    actorType: varchar("actor_type", {
      length: 16,
    })
      .$type<"human" | "service" | "system">()
      .notNull(),
    authenticationRefType: varchar("authentication_ref_type", {
      length: 32,
    })
      .$type<
        "session" | "service_api_token" | "deployment" | "cli_recovery" | "none"
      >()
      .notNull(),
    authenticationRefHash: digest("authentication_ref_hash"),
    authorityType: varchar("authority_type", {
      length: 32,
    })
      .$type<
        | "human_membership"
        | "service_grant"
        | "instance_administrator"
        | "system"
        | "none"
      >()
      .notNull(),
    authorityId: id("authority_id"),
    authorityVersion: int("authority_version", { unsigned: true }),
    authorizationModelVersion: int("authorization_model_version", {
      unsigned: true,
    }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    schemaVersion: smallint("schema_version", {
      unsigned: true,
    }).notNull(),
    authorizationDecisionDigest: digest(
      "authorization_decision_digest",
    ).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: id("resource_id"),
    outcome: varchar("outcome", {
      length: 16,
    })
      .$type<"succeeded" | "denied" | "failed">()
      .notNull(),
    decisionReasonCode: varchar("decision_reason_code", {
      length: 120,
    }).notNull(),
    severity: varchar("severity", {
      length: 16,
    })
      .$type<"info" | "warning" | "high" | "critical">()
      .notNull(),
    requestId: varchar("request_id", { length: 120 }),
    traceId: varchar("trace_id", { length: 120 }),
    details: json("details")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
    integrityDigest: digest("integrity_digest").notNull(),
  },
  (table) => [
    index("ix_audit_event_workspace_timeline").on(
      table.workspaceId,
      table.recordedAt,
      table.id,
    ),
    index("ix_audit_event_organization_timeline").on(
      table.organizationId,
      table.recordedAt,
      table.id,
    ),
    index("ix_audit_event_actor_timeline").on(
      table.actorPrincipalId,
      table.recordedAt,
      table.id,
    ),
    index("ix_audit_event_resource_timeline").on(
      table.resourceType,
      table.resourceId,
      table.recordedAt,
      table.id,
    ),
  ],
);

export const instanceDefaultAccessPolicyTable = mysqlTable(
  "instance_default_access_policy",
  {
    instanceId: varchar("instance_id", { length: 120 })
      .primaryKey()
      .references(() => instanceRuntimeStateTable.instanceId),
    policy: json("policy").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    updatedByPrincipalId: id("updated_by_principal_id")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    updatedAt: timestamp("updated_at").notNull(),
  },
);
export const defaultAccessEnrollmentTable = mysqlTable(
  "default_access_enrollment",
  {
    authSubjectId: varchar("auth_subject_id", { length: 240 }).notNull(),
    instanceId: varchar("instance_id", { length: 120 })
      .notNull()
      .references(() => instanceRuntimeStateTable.instanceId),
    source: varchar("source", { length: 24 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }),
    policySnapshot: json("policy_snapshot").notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    reason: varchar("reason", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.authSubjectId] }),
    index("ix_default_access_state").on(table.instanceId, table.state),
  ],
);

export const instanceRuntimeConfigurationRevisionTable = mysqlTable(
  "instance_runtime_configuration_revision",
  {
    instanceId: varchar("instance_id", { length: 120 })
      .notNull()
      .references(() => instanceRuntimeStateTable.instanceId),
    version: int("version", { unsigned: true }).notNull(),
    document: json("document").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    publishedBy: id("published_by")
      .notNull()
      .references(() => humanPrincipalTable.principalId),
    publishedAt: timestamp("published_at").notNull(),
    restoredFromVersion: int("restored_from_version", { unsigned: true }),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.version] })],
);
export const runtimeConfigurationWorkerObservationTable = mysqlTable(
  "runtime_configuration_worker_observation",
  {
    instanceId: varchar("instance_id", { length: 120 })
      .notNull()
      .references(() => instanceRuntimeStateTable.instanceId),
    workerId: varchar("worker_id", { length: 120 }).notNull(),
    deployment: json("deployment").notNull(),
    configurationVersion: int("configuration_version", { unsigned: true }),
    observedAt: timestamp("observed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.workerId] })],
);
