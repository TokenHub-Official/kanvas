import { createHash } from "node:crypto";

import {
  authorizationModelVersion,
  evaluateHumanWorkspaceAuthorization,
  evaluateServiceWorkspaceAuthorization,
  isWorkspacePermissionId,
  normalizeWorkspacePermissionSet,
  permissionsForWorkspaceRole,
  serviceTokenPermissionsAreSubset,
  type AuthorizationDenialReason,
  type MembershipStatus,
  type OrganizationRole,
  type PrincipalStatus,
  type ServiceGrantStatus,
  type TrustedWorkspaceMembershipManagementScope,
  type TrustedWorkspaceScope,
  type WorkspacePermissionId,
  type WorkspaceRole,
  type WorkspaceStatus,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { ulid } from "ulid";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
  type AuditJsonObject,
} from "./audit-event-store.js";
import { normalizeVerifiedEmail } from "./instance-bootstrap-store.js";
import { emailVerificationRequiredInTransaction } from "./email-verification-policy.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const workspaceRoles = new Set<WorkspaceRole>([
  "owner",
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
]);

type ScopeResolutionReason =
  | AuthorizationDenialReason
  | "authentication_not_found"
  | "authorization_state_invalid";

export type WorkspaceScopeResolution =
  | {
      readonly status: "authorized";
      readonly scope: TrustedWorkspaceScope;
    }
  | {
      readonly status: "not_found" | "forbidden";
      readonly reason: ScopeResolutionReason;
    };

export interface ResolveHumanPrincipalOptions {
  readonly principalId: string;
  readonly authSubjectId: string;
  readonly now: Date;
  readonly audit: HumanAuditContext;
}

export interface ResolvedHumanPrincipal {
  readonly principalId: string;
  readonly status: PrincipalStatus;
  readonly version: number;
  readonly created: boolean;
}

export interface ResolveHumanWorkspaceScopeOptions {
  readonly authSubjectId: string;
  readonly sessionId: string;
  readonly requestedWorkspaceId: string;
  readonly requiredPermission: WorkspacePermissionId;
  readonly now: Date;
}

export interface ResolveServiceWorkspaceScopeOptions {
  /**
   * Domain-separated token digest from the Authentication Adapter. Raw token
   * material must never cross this store boundary.
   */
  readonly tokenHash: string;
  readonly requestedWorkspaceId: string;
  readonly requiredPermission: WorkspacePermissionId;
  readonly now: Date;
}

export interface ListHumanWorkspaceContextsOptions {
  readonly principalId: string;
}

export interface HumanWorkspaceContext {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationVersion: number;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly workspaceVersion: number;
  readonly membershipId: string;
  readonly membershipRole: WorkspaceRole;
  readonly membershipVersion: number;
  readonly permissions: readonly WorkspacePermissionId[];
}

export interface HumanAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

interface ChangeMembershipBase {
  readonly targetPrincipalId: string;
  readonly expectedTargetVersion: number;
  readonly nextStatus: MembershipStatus;
  readonly now: Date;
  readonly audit: HumanAuditContext;
}

export interface ChangeWorkspaceMembershipOptions extends ChangeMembershipBase {
  readonly authority: TrustedWorkspaceMembershipManagementScope;
  readonly workspaceId: string;
  readonly nextRole: WorkspaceRole;
}

export interface AddExistingWorkspaceMemberOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly workspaceId: string;
  readonly email: string;
  readonly role: WorkspaceRole;
  readonly now: Date;
  readonly audit: HumanAuditContext;
}

export interface ChangeOrganizationMembershipOptions extends ChangeMembershipBase {
  readonly actorPrincipalId: string;
  readonly organizationId: string;
  readonly nextRole: OrganizationRole;
}

export interface ChangedMembership {
  readonly membershipId: string;
  readonly role: WorkspaceRole | OrganizationRole;
  readonly status: MembershipStatus;
  readonly version: number;
}

export interface AuthorizationStore {
  resolveHumanPrincipal(
    options: ResolveHumanPrincipalOptions,
  ): Promise<ResolvedHumanPrincipal>;
  resolveHumanWorkspaceScope(
    options: ResolveHumanWorkspaceScopeOptions,
  ): Promise<WorkspaceScopeResolution>;
  resolveServiceWorkspaceScope(
    options: ResolveServiceWorkspaceScopeOptions,
  ): Promise<WorkspaceScopeResolution>;
  listHumanWorkspaceContexts(
    options: ListHumanWorkspaceContextsOptions,
  ): Promise<readonly HumanWorkspaceContext[]>;
  changeWorkspaceMembership(
    options: ChangeWorkspaceMembershipOptions,
  ): Promise<ChangedMembership>;
  changeWorkspaceMemberships(
    options: readonly ChangeWorkspaceMembershipOptions[],
  ): Promise<readonly ChangedMembership[]>;
  addExistingWorkspaceMember(
    options: AddExistingWorkspaceMemberOptions,
  ): Promise<ChangedMembership>;
  changeOrganizationMembership(
    options: ChangeOrganizationMembershipOptions,
  ): Promise<ChangedMembership>;
}

export type AuthorizationStoreErrorCode =
  | "authorization.invalid_argument"
  | "authorization.account_not_found"
  | "authorization.membership_exists"
  | "authorization.identity_conflict"
  | "authorization.state_invalid"
  | "authorization.scope_stale"
  | "authorization.forbidden"
  | "authorization.last_owner";

export class AuthorizationStoreError extends Error {
  public constructor(
    public readonly code: AuthorizationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationStoreError";
  }
}

interface HumanPrincipalRow extends RowDataPacket {
  readonly principalId: string;
  readonly principalStatus: PrincipalStatus;
  readonly principalVersion: number;
}

interface HumanScopeRow extends RowDataPacket {
  readonly principalId: string;
  readonly principalStatus: PrincipalStatus;
  readonly membershipId: string;
  readonly membershipRole: WorkspaceRole;
  readonly membershipStatus: MembershipStatus;
  readonly membershipVersion: number;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly workspaceStatus: WorkspaceStatus;
}

interface HumanWorkspaceContextRow extends RowDataPacket {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationVersion: number;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly workspaceVersion: number;
  readonly membershipId: string;
  readonly membershipRole: WorkspaceRole;
  readonly membershipVersion: number;
}

interface ServiceScopeRow extends RowDataPacket {
  readonly tokenId: string;
  readonly tokenPermissionSet: unknown;
  readonly tokenPermissionDigest: string;
  readonly tokenExpiresAt: Date;
  readonly tokenRevokedAt: Date | null;
  readonly grantId: string;
  readonly grantPermissionSet: unknown;
  readonly grantPermissionDigest: string;
  readonly grantStatus: ServiceGrantStatus;
  readonly grantVersion: number;
  readonly principalId: string;
  readonly principalStatus: PrincipalStatus;
  readonly organizationId: string;
  readonly serviceOrganizationId: string;
  readonly workspaceId: string;
  readonly workspaceOrganizationId: string;
  readonly workspaceStatus: WorkspaceStatus;
}

interface WorkspaceMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly role: WorkspaceRole;
  readonly status: MembershipStatus;
  readonly version: number;
}

interface OrganizationMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
  readonly version: number;
}

interface WorkspaceAuthorizationRow extends RowDataPacket {
  readonly id: string;
  readonly organizationId: string;
  readonly status: WorkspaceStatus;
}

interface OrganizationAuthorizationRow extends RowDataPacket {
  readonly id: string;
  readonly status: string;
}

interface OwnerRow extends RowDataPacket {
  readonly id: string;
  readonly principalId: string;
}

interface InstanceAdministratorAuthorityRow extends RowDataPacket {
  readonly principalId: string;
  readonly principalStatus: PrincipalStatus;
  readonly administratorStatus: "active" | "suspended" | "revoked";
  readonly administratorVersion: number;
}

interface ExistingAccountRow extends RowDataPacket {
  readonly principalId: string;
}

interface HumanAuditInsert {
  readonly id: string;
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly actorPrincipalId: string;
  readonly authenticationRefHash: string;
  readonly authorityType:
    "human_membership" | "instance_administrator" | "none";
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly decisionReasonCode: string;
  readonly severity: "info" | "warning" | "high" | "critical";
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly details: AuditJsonObject;
  readonly occurredAt: Date;
}

function fail(code: AuthorizationStoreErrorCode, message: string): never {
  throw new AuthorizationStoreError(code, message);
}

function invalid(message: string): never {
  return fail("authorization.invalid_argument", message);
}

function normalizeAccountEmail(value: string): string {
  try {
    return normalizeVerifiedEmail(value);
  } catch {
    return invalid("email must be a valid email address.");
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertPositiveVersion(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
}

function assertOpaqueText(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalid(
      `${label} must be a bounded opaque value without control characters.`,
    );
  }
}

function assertWorkspacePermission(
  value: unknown,
): asserts value is WorkspacePermissionId {
  if (!isWorkspacePermissionId(value)) {
    invalid("requiredPermission is not part of the fixed V0 model.");
  }
}

function assertAuditContext(context: HumanAuditContext): void {
  assertId(context.auditEventId, "audit.auditEventId");
  assertDigest(context.authenticationRefHash, "audit.authenticationRefHash");
  if (context.requestId !== undefined) {
    assertOpaqueText(context.requestId, "audit.requestId", 120);
  }
  if (context.traceId !== undefined) {
    assertOpaqueText(context.traceId, "audit.traceId", 120);
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function permissionDigest(
  permissions: readonly WorkspacePermissionId[],
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(permissions))
    .digest("hex")}`;
}

function parsePermissionFacts(
  value: unknown,
  digest: string,
): readonly WorkspacePermissionId[] | undefined {
  if (!digestPattern.test(digest)) {
    return undefined;
  }
  const permissions = normalizeWorkspacePermissionSet(parseJson(value));
  if (!permissions || permissionDigest(permissions) !== digest) {
    return undefined;
  }
  return permissions;
}

async function appendAudit(
  connection: PoolConnection,
  audit: HumanAuditInsert,
): Promise<void> {
  await appendAuditEventInTransaction(connection, {
    id: audit.id,
    schemaVersion: auditEventSchemaVersion,
    organizationId: audit.organizationId,
    workspaceId: audit.workspaceId,
    actorPrincipalId: audit.actorPrincipalId,
    actorType: "human",
    authenticationRefType: "session",
    authenticationRefHash: audit.authenticationRefHash,
    authorityType: audit.authorityType,
    authorityId: audit.authorityId,
    authorityVersion: audit.authorityVersion,
    authorizationModelVersion,
    authorizationDecision: Object.freeze({
      action: audit.action,
      authorityId: audit.authorityId,
      authorityType: audit.authorityType,
      authorityVersion: audit.authorityVersion,
      modelVersion: authorizationModelVersion,
      outcome: "succeeded",
      reasonCode: audit.decisionReasonCode,
    }),
    eventType: audit.eventType,
    action: audit.action,
    resourceType: audit.resourceType,
    resourceId: audit.resourceId,
    outcome: "succeeded",
    decisionReasonCode: audit.decisionReasonCode,
    severity: audit.severity,
    requestId: audit.requestId,
    traceId: audit.traceId,
    details: audit.details,
    occurredAt: audit.occurredAt,
    recordedAt: audit.occurredAt,
  });
}

async function inTransaction<TResult>(
  pool: Pool,
  callback: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function isRetryableIdentityRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === "ER_DUP_ENTRY" || code === "ER_LOCK_DEADLOCK";
}

async function resolveHumanPrincipalInTransaction(
  connection: PoolConnection,
  options: ResolveHumanPrincipalOptions,
): Promise<ResolvedHumanPrincipal> {
  const [rows] = await connection.execute<HumanPrincipalRow[]>(
    `SELECT
       principal.id AS principalId,
       principal.status AS principalStatus,
       principal.version AS principalVersion
     FROM human_principal AS human
     INNER JOIN principal
       ON principal.id = human.principal_id
      AND principal.principal_type = 'human'
     WHERE human.auth_subject_id = ?
     LIMIT 1
     FOR UPDATE`,
    [options.authSubjectId],
  );
  const existing = rows[0];
  if (existing) {
    return Object.freeze({
      principalId: existing.principalId,
      status: existing.principalStatus,
      version: existing.principalVersion,
      created: false,
    });
  }

  await connection.execute<ResultSetHeader>(
    `INSERT INTO principal (
       id,
       principal_type,
       status,
       version,
       created_at,
       updated_at
     ) VALUES (?, 'human', 'active', 1, ?, ?)`,
    [options.principalId, options.now, options.now],
  );
  await connection.execute<ResultSetHeader>(
    `INSERT INTO human_principal (
       principal_id,
       auth_subject_id,
       created_at
     ) VALUES (?, ?, ?)`,
    [options.principalId, options.authSubjectId, options.now],
  );
  await appendAudit(connection, {
    id: options.audit.auditEventId,
    organizationId: null,
    workspaceId: null,
    actorPrincipalId: options.principalId,
    authenticationRefHash: options.audit.authenticationRefHash,
    authorityType: "none",
    authorityId: null,
    authorityVersion: null,
    eventType: "principal.human.created",
    action: "principal.create",
    resourceType: "principal",
    resourceId: options.principalId,
    decisionReasonCode: "auth_subject.resolved",
    severity: "info",
    requestId: options.audit.requestId ?? null,
    traceId: options.audit.traceId ?? null,
    details: Object.freeze({
      principalId: options.principalId,
      principalType: "human",
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    principalId: options.principalId,
    status: "active",
    version: 1,
    created: true,
  });
}

async function resolveHumanWorkspaceScopeInTransaction(
  connection: PoolConnection,
  options: ResolveHumanWorkspaceScopeOptions,
): Promise<WorkspaceScopeResolution> {
  const [rows] = await connection.execute<HumanScopeRow[]>(
    `SELECT
       principal.id AS principalId,
       principal.status AS principalStatus,
       membership.id AS membershipId,
       membership.role AS membershipRole,
       membership.status AS membershipStatus,
       membership.version AS membershipVersion,
       workspace.organization_id AS organizationId,
       workspace.id AS workspaceId,
       workspace.status AS workspaceStatus
     FROM human_principal AS human
     INNER JOIN principal
       ON principal.id = human.principal_id
      AND principal.principal_type = 'human'
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = principal.id
      AND membership.workspace_id = ?
     INNER JOIN workspace
       ON workspace.id = membership.workspace_id
      AND workspace.organization_id = membership.organization_id
     WHERE human.auth_subject_id = ?
     LIMIT 1
     FOR SHARE`,
    [options.requestedWorkspaceId, options.authSubjectId],
  );
  const row = rows[0];
  if (!row) {
    return Object.freeze({
      status: "not_found",
      reason: "workspace_not_visible",
    });
  }
  const decision = evaluateHumanWorkspaceAuthorization({
    principalStatus: row.principalStatus,
    requestedWorkspaceId: options.requestedWorkspaceId,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspaceStatus,
    membershipStatus: row.membershipStatus,
    membershipRole: row.membershipRole,
    requiredPermission: options.requiredPermission,
  });
  if (decision.decision === "deny") {
    return Object.freeze({
      status: decision.disclosure,
      reason: decision.reason,
    });
  }
  return Object.freeze({
    status: "authorized",
    scope: Object.freeze({
      workspaceId: row.workspaceId,
      organizationId: row.organizationId,
      principalId: row.principalId,
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: options.sessionId,
      authorityType: "human_membership",
      authorityId: row.membershipId,
      authorityVersion: row.membershipVersion,
      authorizationModelVersion,
      effectivePermissions: decision.effectivePermissions,
      trusted: true,
    }),
  });
}

async function resolveServiceWorkspaceScopeInTransaction(
  connection: PoolConnection,
  options: ResolveServiceWorkspaceScopeOptions,
): Promise<WorkspaceScopeResolution> {
  const [rows] = await connection.execute<ServiceScopeRow[]>(
    `SELECT
       token.id AS tokenId,
       token.permission_set AS tokenPermissionSet,
       token.permission_digest AS tokenPermissionDigest,
       token.expires_at AS tokenExpiresAt,
       token.revoked_at AS tokenRevokedAt,
       grant_fact.id AS grantId,
       grant_fact.permission_set AS grantPermissionSet,
       grant_fact.permission_digest AS grantPermissionDigest,
       grant_fact.status AS grantStatus,
       grant_fact.version AS grantVersion,
       principal.id AS principalId,
       principal.status AS principalStatus,
       grant_fact.organization_id AS organizationId,
       service.organization_id AS serviceOrganizationId,
       workspace.id AS workspaceId,
       workspace.organization_id AS workspaceOrganizationId,
       workspace.status AS workspaceStatus
     FROM service_api_token AS token
     INNER JOIN service_grant AS grant_fact
       ON grant_fact.id = token.service_grant_id
     INNER JOIN service_principal AS service
       ON service.principal_id = grant_fact.service_principal_id
     INNER JOIN principal
       ON principal.id = service.principal_id
      AND principal.principal_type = 'service'
     INNER JOIN workspace
       ON workspace.id = grant_fact.workspace_id
     WHERE token.token_hash = ?
     LIMIT 1
     FOR SHARE`,
    [options.tokenHash],
  );
  const row = rows[0];
  if (!row) {
    return Object.freeze({
      status: "not_found",
      reason: "authentication_not_found",
    });
  }
  if (
    row.organizationId !== row.serviceOrganizationId ||
    row.organizationId !== row.workspaceOrganizationId
  ) {
    return Object.freeze({
      status: "forbidden",
      reason: "authorization_state_invalid",
    });
  }
  const grantPermissions = parsePermissionFacts(
    row.grantPermissionSet,
    row.grantPermissionDigest,
  );
  const tokenPermissions = parsePermissionFacts(
    row.tokenPermissionSet,
    row.tokenPermissionDigest,
  );
  if (
    !grantPermissions ||
    !tokenPermissions ||
    !serviceTokenPermissionsAreSubset(grantPermissions, tokenPermissions)
  ) {
    return Object.freeze({
      status: "forbidden",
      reason: "authorization_state_invalid",
    });
  }
  const decision = evaluateServiceWorkspaceAuthorization({
    principalStatus: row.principalStatus,
    requestedWorkspaceId: options.requestedWorkspaceId,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspaceStatus,
    grantStatus: row.grantStatus,
    grantPermissions,
    tokenPermissions,
    tokenExpiresAt: row.tokenExpiresAt,
    tokenRevokedAt: row.tokenRevokedAt,
    now: options.now,
    requiredPermission: options.requiredPermission,
  });
  if (decision.decision === "deny") {
    return Object.freeze({
      status: decision.disclosure,
      reason: decision.reason,
    });
  }
  return Object.freeze({
    status: "authorized",
    scope: Object.freeze({
      workspaceId: row.workspaceId,
      organizationId: row.organizationId,
      principalId: row.principalId,
      principalType: "service",
      authenticationRefType: "service_api_token",
      authenticationRefId: row.tokenId,
      authorityType: "service_grant",
      authorityId: row.grantId,
      authorityVersion: row.grantVersion,
      authorizationModelVersion,
      effectivePermissions: decision.effectivePermissions,
      trusted: true,
    }),
  });
}

function assertScopeInput(
  scope: TrustedWorkspaceScope,
  requiredPermission: WorkspacePermissionId,
  now: Date,
): void {
  if (
    scope.trusted !== true ||
    scope.authorizationModelVersion !== authorizationModelVersion
  ) {
    fail(
      "authorization.scope_stale",
      "Workspace Scope was not issued by the current authorization model.",
    );
  }
  assertId(scope.workspaceId, "scope.workspaceId");
  assertId(scope.organizationId, "scope.organizationId");
  assertId(scope.principalId, "scope.principalId");
  assertId(scope.authorityId, "scope.authorityId");
  assertPositiveVersion(scope.authorityVersion, "scope.authorityVersion");
  assertWorkspacePermission(requiredPermission);
  assertDate(now, "now");
  if (scope.principalType === "human") {
    if (
      scope.authenticationRefType !== "session" ||
      scope.authorityType !== "human_membership"
    ) {
      fail(
        "authorization.scope_stale",
        "Human Workspace Scope has an invalid authority shape.",
      );
    }
    assertOpaqueText(
      scope.authenticationRefId,
      "scope.authenticationRefId",
      240,
    );
  } else if (
    scope.authenticationRefType !== "service_api_token" ||
    scope.authorityType !== "service_grant"
  ) {
    fail(
      "authorization.scope_stale",
      "Service Workspace Scope has an invalid authority shape.",
    );
  } else {
    assertId(scope.authenticationRefId, "scope.authenticationRefId");
  }
}

export async function revalidateTrustedWorkspaceScopeInTransaction(
  connection: PoolConnection,
  scope: TrustedWorkspaceScope,
  requiredPermission: WorkspacePermissionId,
  now: Date,
): Promise<void> {
  assertScopeInput(scope, requiredPermission, now);
  if (scope.principalType === "human") {
    const [rows] = await connection.execute<HumanScopeRow[]>(
      `SELECT
         principal.id AS principalId,
         principal.status AS principalStatus,
         membership.id AS membershipId,
         membership.role AS membershipRole,
         membership.status AS membershipStatus,
         membership.version AS membershipVersion,
         workspace.organization_id AS organizationId,
         workspace.id AS workspaceId,
         workspace.status AS workspaceStatus
       FROM workspace_membership AS membership
       INNER JOIN principal
         ON principal.id = membership.principal_id
        AND principal.principal_type = 'human'
       INNER JOIN workspace
         ON workspace.id = membership.workspace_id
        AND workspace.organization_id = membership.organization_id
       WHERE membership.id = ?
         AND membership.workspace_id = ?
       LIMIT 1
       FOR SHARE`,
      [scope.authorityId, scope.workspaceId],
    );
    const row = rows[0];
    if (
      !row ||
      row.principalId !== scope.principalId ||
      row.organizationId !== scope.organizationId ||
      row.membershipVersion !== scope.authorityVersion
    ) {
      fail(
        "authorization.scope_stale",
        "Human Workspace Scope authority changed.",
      );
    }
    const decision = evaluateHumanWorkspaceAuthorization({
      principalStatus: row.principalStatus,
      requestedWorkspaceId: scope.workspaceId,
      workspaceId: row.workspaceId,
      workspaceStatus: row.workspaceStatus,
      membershipStatus: row.membershipStatus,
      membershipRole: row.membershipRole,
      requiredPermission,
    });
    if (decision.decision === "deny") {
      fail(
        "authorization.forbidden",
        "Human Workspace Scope is no longer authorized.",
      );
    }
    return;
  }

  const [rows] = await connection.execute<ServiceScopeRow[]>(
    `SELECT
       token.id AS tokenId,
       token.permission_set AS tokenPermissionSet,
       token.permission_digest AS tokenPermissionDigest,
       token.expires_at AS tokenExpiresAt,
       token.revoked_at AS tokenRevokedAt,
       grant_fact.id AS grantId,
       grant_fact.permission_set AS grantPermissionSet,
       grant_fact.permission_digest AS grantPermissionDigest,
       grant_fact.status AS grantStatus,
       grant_fact.version AS grantVersion,
       principal.id AS principalId,
       principal.status AS principalStatus,
       grant_fact.organization_id AS organizationId,
       service.organization_id AS serviceOrganizationId,
       workspace.id AS workspaceId,
       workspace.organization_id AS workspaceOrganizationId,
       workspace.status AS workspaceStatus
     FROM service_api_token AS token
     INNER JOIN service_grant AS grant_fact
       ON grant_fact.id = token.service_grant_id
     INNER JOIN service_principal AS service
       ON service.principal_id = grant_fact.service_principal_id
     INNER JOIN principal
       ON principal.id = service.principal_id
      AND principal.principal_type = 'service'
     INNER JOIN workspace
       ON workspace.id = grant_fact.workspace_id
     WHERE token.id = ?
       AND grant_fact.id = ?
     LIMIT 1
     FOR SHARE`,
    [scope.authenticationRefId, scope.authorityId],
  );
  const row = rows[0];
  const grantPermissions = row
    ? parsePermissionFacts(row.grantPermissionSet, row.grantPermissionDigest)
    : undefined;
  const tokenPermissions = row
    ? parsePermissionFacts(row.tokenPermissionSet, row.tokenPermissionDigest)
    : undefined;
  if (
    !row ||
    !grantPermissions ||
    !tokenPermissions ||
    !serviceTokenPermissionsAreSubset(grantPermissions, tokenPermissions) ||
    row.principalId !== scope.principalId ||
    row.organizationId !== scope.organizationId ||
    row.workspaceId !== scope.workspaceId ||
    row.organizationId !== row.serviceOrganizationId ||
    row.organizationId !== row.workspaceOrganizationId ||
    row.grantVersion !== scope.authorityVersion
  ) {
    fail(
      "authorization.scope_stale",
      "Service Workspace Scope authority changed.",
    );
  }
  const decision = evaluateServiceWorkspaceAuthorization({
    principalStatus: row.principalStatus,
    requestedWorkspaceId: scope.workspaceId,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspaceStatus,
    grantStatus: row.grantStatus,
    grantPermissions,
    tokenPermissions,
    tokenExpiresAt: row.tokenExpiresAt,
    tokenRevokedAt: row.tokenRevokedAt,
    now,
    requiredPermission,
  });
  if (decision.decision === "deny") {
    fail(
      "authorization.forbidden",
      "Service Workspace Scope is no longer authorized.",
    );
  }
}

export interface WorkspaceMembershipManager {
  readonly actorPrincipalId: string;
  readonly actorWorkspaceRole?: WorkspaceRole;
  readonly authorityType: "human_membership" | "instance_administrator";
  readonly authorityId: string;
  readonly authorityVersion: number;
  readonly decisionReasonCode:
    "membership.change.authorized" | "instance_administrator.active";
}

export async function revalidateWorkspaceMembershipManagementScopeInTransaction(
  connection: PoolConnection,
  authority: TrustedWorkspaceMembershipManagementScope,
  workspaceId: string,
  organizationId: string,
  instanceId: string | undefined,
): Promise<WorkspaceMembershipManager> {
  if (authority.authorityType === "instance_administrator") {
    if (!instanceId || authority.instanceId !== instanceId) {
      fail(
        "authorization.forbidden",
        "Instance Administrator authority does not belong to this instance.",
      );
    }
    const [rows] = await connection.execute<
      InstanceAdministratorAuthorityRow[]
    >(
      `SELECT
           administrator.principal_id AS principalId,
           principal.status AS principalStatus,
           administrator.status AS administratorStatus,
           administrator.version AS administratorVersion
         FROM instance_administrator AS administrator
         INNER JOIN principal
           ON principal.id = administrator.principal_id
          AND principal.principal_type = 'human'
         WHERE administrator.principal_id = ?
         LIMIT 1
         FOR SHARE`,
      [authority.principalId],
    );
    const administrator = rows[0];
    if (
      !administrator ||
      administrator.principalId !== authority.principalId ||
      administrator.principalStatus !== "active" ||
      administrator.administratorStatus !== "active" ||
      administrator.administratorVersion !== authority.authorityVersion
    ) {
      fail(
        "authorization.scope_stale",
        "Instance Administrator authority changed.",
      );
    }
    return Object.freeze({
      actorPrincipalId: authority.principalId,
      authorityType: "instance_administrator" as const,
      authorityId: authority.authorityId,
      authorityVersion: authority.authorityVersion,
      decisionReasonCode: "instance_administrator.active" as const,
    });
  }

  if (
    authority.authorityType !== "human_membership" ||
    authority.principalType !== "human" ||
    authority.workspaceId !== workspaceId
  ) {
    fail(
      "authorization.forbidden",
      "Only a Human Workspace membership can manage members.",
    );
  }
  const [rows] = await connection.execute<WorkspaceMembershipRow[]>(
    `SELECT
       id,
       organization_id AS organizationId,
       workspace_id AS workspaceId,
       principal_id AS principalId,
       role,
       status,
       version
     FROM workspace_membership
     WHERE workspace_id = ?
       AND principal_id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, authority.principalId],
  );
  const actor = rows[0];
  if (
    !actor ||
    actor.id !== authority.authorityId ||
    actor.organizationId !== organizationId ||
    actor.version !== authority.authorityVersion ||
    actor.status !== "active" ||
    !permissionsForWorkspaceRole(actor.role).includes("membership.manage")
  ) {
    fail("authorization.scope_stale", "Workspace authority changed.");
  }
  return Object.freeze({
    actorPrincipalId: actor.principalId,
    actorWorkspaceRole: actor.role,
    authorityType: "human_membership" as const,
    authorityId: actor.id,
    authorityVersion: actor.version,
    decisionReasonCode: "membership.change.authorized" as const,
  });
}

function activeOwnerCountAfterChange(
  owners: readonly OwnerRow[],
  targetPrincipalId: string,
  currentRole: WorkspaceRole | OrganizationRole,
  currentStatus: MembershipStatus,
  nextRole: WorkspaceRole | OrganizationRole,
  nextStatus: MembershipStatus,
): number {
  let count = owners.length;
  if (currentRole === "owner" && currentStatus === "active") {
    count -= 1;
  }
  if (nextRole === "owner" && nextStatus === "active") {
    count += 1;
  }
  const targetWasLocked = owners.some(
    (owner) => owner.principalId === targetPrincipalId,
  );
  if (
    currentRole === "owner" &&
    currentStatus === "active" &&
    !targetWasLocked
  ) {
    fail(
      "authorization.state_invalid",
      "Active owner membership was missing from the locked owner set.",
    );
  }
  return count;
}

async function changeWorkspaceMembershipInTransaction(
  connection: PoolConnection,
  options: ChangeWorkspaceMembershipOptions,
  instanceId: string | undefined,
): Promise<ChangedMembership> {
  const [workspaceRows] = await connection.execute<WorkspaceAuthorizationRow[]>(
    `SELECT
         id,
         organization_id AS organizationId,
         status
       FROM workspace
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
    [options.workspaceId],
  );
  const workspace = workspaceRows[0];
  if (!workspace) {
    fail("authorization.identity_conflict", "Workspace does not exist.");
  }
  const manager =
    await revalidateWorkspaceMembershipManagementScopeInTransaction(
      connection,
      options.authority,
      options.workspaceId,
      workspace.organizationId,
      instanceId,
    );
  const [targetRows] = await connection.execute<WorkspaceMembershipRow[]>(
    `SELECT
         id,
         organization_id AS organizationId,
         workspace_id AS workspaceId,
         principal_id AS principalId,
         role,
         status,
         version
       FROM workspace_membership
       WHERE workspace_id = ?
         AND principal_id = ?
       LIMIT 1
       FOR UPDATE`,
    [options.workspaceId, options.targetPrincipalId],
  );
  const target = targetRows[0];
  if (
    !target ||
    workspace.status !== "active" ||
    target.organizationId !== workspace.organizationId
  ) {
    fail(
      "authorization.forbidden",
      "Actor cannot manage this Workspace membership.",
    );
  }
  if (
    manager.actorWorkspaceRole === "admin" &&
    (target.role === "owner" || options.nextRole === "owner")
  ) {
    fail(
      "authorization.forbidden",
      "Workspace Admin cannot grant or remove Owner.",
    );
  }
  if (target.version !== options.expectedTargetVersion) {
    fail("authorization.scope_stale", "Workspace membership version changed.");
  }
  const [ownerRows] = await connection.execute<OwnerRow[]>(
    `SELECT
       id,
       principal_id AS principalId
     FROM workspace_membership
     WHERE workspace_id = ?
       AND role = 'owner'
       AND status = 'active'
     ORDER BY id
     FOR UPDATE`,
    [options.workspaceId],
  );
  if (
    activeOwnerCountAfterChange(
      ownerRows,
      target.principalId,
      target.role,
      target.status,
      options.nextRole,
      options.nextStatus,
    ) < 1
  ) {
    fail(
      "authorization.last_owner",
      "Workspace must retain at least one active Human Owner.",
    );
  }
  const nextVersion = target.version + 1;
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE workspace_membership
     SET role = ?,
         status = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?
       AND workspace_id = ?
       AND version = ?`,
    [
      options.nextRole,
      options.nextStatus,
      nextVersion,
      options.now,
      target.id,
      options.workspaceId,
      target.version,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "authorization.scope_stale",
      "Workspace membership changed before update.",
    );
  }
  await appendAudit(connection, {
    id: options.audit.auditEventId,
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    actorPrincipalId: manager.actorPrincipalId,
    authenticationRefHash: options.audit.authenticationRefHash,
    authorityType: manager.authorityType,
    authorityId: manager.authorityId,
    authorityVersion: manager.authorityVersion,
    eventType: "workspace.membership.changed",
    action: "membership.manage",
    resourceType: "workspace_membership",
    resourceId: target.id,
    decisionReasonCode: manager.decisionReasonCode,
    severity:
      target.role === "owner" || options.nextRole === "owner" ? "high" : "info",
    requestId: options.audit.requestId ?? null,
    traceId: options.audit.traceId ?? null,
    details: Object.freeze({
      targetPrincipalId: target.principalId,
      previousRole: target.role,
      nextRole: options.nextRole,
      previousStatus: target.status,
      nextStatus: options.nextStatus,
      previousVersion: target.version,
      nextVersion,
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    membershipId: target.id,
    role: options.nextRole,
    status: options.nextStatus,
    version: nextVersion,
  });
}

async function addExistingWorkspaceMemberInTransaction(
  connection: PoolConnection,
  options: AddExistingWorkspaceMemberOptions,
  instanceId: string | undefined,
  nextId: () => string,
): Promise<ChangedMembership> {
  const [workspaceRows] = await connection.execute<WorkspaceAuthorizationRow[]>(
    `SELECT id, organization_id AS organizationId, status
       FROM workspace
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
    [options.workspaceId],
  );
  const workspace = workspaceRows[0];
  if (!workspace || workspace.status !== "active") {
    fail("authorization.identity_conflict", "Workspace is unavailable.");
  }
  const manager =
    await revalidateWorkspaceMembershipManagementScopeInTransaction(
      connection,
      options.authority,
      options.workspaceId,
      workspace.organizationId,
      instanceId,
    );
  if (options.role === "owner" && manager.actorWorkspaceRole !== "owner") {
    fail(
      "authorization.forbidden",
      "Only a Workspace Owner can add another Owner.",
    );
  }

  const normalizedEmail = normalizeAccountEmail(options.email);
  const emailVerificationRequired =
    await emailVerificationRequiredInTransaction(connection, instanceId);
  const [accountRows] = await connection.execute<ExistingAccountRow[]>(
    `SELECT principal.id AS principalId
       FROM auth_user
       INNER JOIN human_principal AS human
         ON human.auth_subject_id = auth_user.id
       INNER JOIN principal
         ON principal.id = human.principal_id
        AND principal.principal_type = 'human'
        AND principal.status = 'active'
      WHERE auth_user.email = ?
        AND (auth_user.email_verified = 1 OR ? = 0)
      LIMIT 2
      FOR SHARE`,
    [normalizedEmail, emailVerificationRequired],
  );
  const target = accountRows[0];
  if (!target || accountRows.length !== 1) {
    fail(
      "authorization.account_not_found",
      "No active verified account matches this email.",
    );
  }

  const [workspaceMembershipRows] = await connection.execute<
    WorkspaceMembershipRow[]
  >(
    `SELECT id, organization_id AS organizationId,
              workspace_id AS workspaceId, principal_id AS principalId,
              role, status, version
         FROM workspace_membership
        WHERE workspace_id = ? AND principal_id = ?
        LIMIT 1
        FOR UPDATE`,
    [options.workspaceId, target.principalId],
  );
  if (workspaceMembershipRows[0]) {
    fail(
      "authorization.membership_exists",
      "The account already has a Workspace membership.",
    );
  }

  const [organizationMembershipRows] = await connection.execute<
    OrganizationMembershipRow[]
  >(
    `SELECT id, organization_id AS organizationId,
              principal_id AS principalId, role, status, version
         FROM organization_membership
        WHERE organization_id = ? AND principal_id = ?
        LIMIT 1
        FOR UPDATE`,
    [workspace.organizationId, target.principalId],
  );
  const organizationMembership = organizationMembershipRows[0];
  if (!organizationMembership) {
    const organizationMembershipId = nextId();
    assertId(organizationMembershipId, "organizationMembershipId");
    await connection.execute<ResultSetHeader>(
      `INSERT INTO organization_membership (
         id, organization_id, principal_id, role, status, version,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'member', 'active', 1, ?, ?)`,
      [
        organizationMembershipId,
        workspace.organizationId,
        target.principalId,
        options.now,
        options.now,
      ],
    );
  } else if (organizationMembership.status !== "active") {
    const [restored] = await connection.execute<ResultSetHeader>(
      `UPDATE organization_membership
          SET status = 'active', version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      [options.now, organizationMembership.id, organizationMembership.version],
    );
    if (restored.affectedRows !== 1) {
      fail(
        "authorization.scope_stale",
        "Organization membership changed before restoration.",
      );
    }
  }

  const membershipId = nextId();
  assertId(membershipId, "workspaceMembershipId");
  await connection.execute<ResultSetHeader>(
    `INSERT INTO workspace_membership (
       id, organization_id, workspace_id, principal_id, role, status,
       version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
    [
      membershipId,
      workspace.organizationId,
      options.workspaceId,
      target.principalId,
      options.role,
      options.now,
      options.now,
    ],
  );
  await appendAudit(connection, {
    id: options.audit.auditEventId,
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    actorPrincipalId: manager.actorPrincipalId,
    authenticationRefHash: options.audit.authenticationRefHash,
    authorityType: manager.authorityType,
    authorityId: manager.authorityId,
    authorityVersion: manager.authorityVersion,
    eventType: "workspace.membership.added",
    action: "membership.manage",
    resourceType: "workspace_membership",
    resourceId: membershipId,
    decisionReasonCode: manager.decisionReasonCode,
    severity: options.role === "owner" ? "high" : "info",
    requestId: options.audit.requestId ?? null,
    traceId: options.audit.traceId ?? null,
    details: Object.freeze({
      targetPrincipalId: target.principalId,
      nextRole: options.role,
      nextStatus: "active",
      nextVersion: 1,
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    membershipId,
    role: options.role,
    status: "active" as const,
    version: 1,
  });
}

async function changeOrganizationMembershipInTransaction(
  connection: PoolConnection,
  options: ChangeOrganizationMembershipOptions,
): Promise<ChangedMembership> {
  const [organizationRows] = await connection.execute<
    OrganizationAuthorizationRow[]
  >(
    `SELECT
         id,
         status
       FROM organization
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
    [options.organizationId],
  );
  const organization = organizationRows[0];
  if (!organization) {
    fail("authorization.identity_conflict", "Organization does not exist.");
  }
  const loadMembership = async (
    principalId: string,
  ): Promise<OrganizationMembershipRow | undefined> => {
    const [rows] = await connection.execute<OrganizationMembershipRow[]>(
      `SELECT
           id,
           organization_id AS organizationId,
           principal_id AS principalId,
           role,
           status,
           version
         FROM organization_membership
         WHERE organization_id = ?
           AND principal_id = ?
         LIMIT 1
         FOR UPDATE`,
      [options.organizationId, principalId],
    );
    return rows[0];
  };
  const actor = await loadMembership(options.actorPrincipalId);
  const target =
    options.targetPrincipalId === options.actorPrincipalId
      ? actor
      : await loadMembership(options.targetPrincipalId);
  if (
    !actor ||
    !target ||
    organization.status !== "active" ||
    actor.status !== "active" ||
    !["owner", "admin"].includes(actor.role)
  ) {
    fail(
      "authorization.forbidden",
      "Actor cannot manage this Organization membership.",
    );
  }
  if (
    actor.role === "admin" &&
    (target.role === "owner" || options.nextRole === "owner")
  ) {
    fail(
      "authorization.forbidden",
      "Organization Admin cannot grant or remove Owner.",
    );
  }
  if (target.version !== options.expectedTargetVersion) {
    fail(
      "authorization.scope_stale",
      "Organization membership version changed.",
    );
  }
  const [ownerRows] = await connection.execute<OwnerRow[]>(
    `SELECT
       id,
       principal_id AS principalId
     FROM organization_membership
     WHERE organization_id = ?
       AND role = 'owner'
       AND status = 'active'
     ORDER BY id
     FOR UPDATE`,
    [options.organizationId],
  );
  if (
    activeOwnerCountAfterChange(
      ownerRows,
      target.principalId,
      target.role,
      target.status,
      options.nextRole,
      options.nextStatus,
    ) < 1
  ) {
    fail(
      "authorization.last_owner",
      "Organization must retain at least one active Human Owner.",
    );
  }
  const nextVersion = target.version + 1;
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE organization_membership
     SET role = ?,
         status = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?
       AND organization_id = ?
       AND version = ?`,
    [
      options.nextRole,
      options.nextStatus,
      nextVersion,
      options.now,
      target.id,
      options.organizationId,
      target.version,
    ],
  );
  if (updated.affectedRows !== 1) {
    fail(
      "authorization.scope_stale",
      "Organization membership changed before update.",
    );
  }
  await appendAudit(connection, {
    id: options.audit.auditEventId,
    organizationId: organization.id,
    workspaceId: null,
    actorPrincipalId: actor.principalId,
    authenticationRefHash: options.audit.authenticationRefHash,
    authorityType: "human_membership",
    authorityId: actor.id,
    authorityVersion: actor.version,
    eventType: "organization.membership.changed",
    action: "organization.membership.manage",
    resourceType: "organization_membership",
    resourceId: target.id,
    decisionReasonCode: "membership.change.authorized",
    severity:
      target.role === "owner" || options.nextRole === "owner" ? "high" : "info",
    requestId: options.audit.requestId ?? null,
    traceId: options.audit.traceId ?? null,
    details: Object.freeze({
      targetPrincipalId: target.principalId,
      previousRole: target.role,
      nextRole: options.nextRole,
      previousStatus: target.status,
      nextStatus: options.nextStatus,
      previousVersion: target.version,
      nextVersion,
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    membershipId: target.id,
    role: options.nextRole,
    status: options.nextStatus,
    version: nextVersion,
  });
}

function validateHumanPrincipalOptions(
  options: ResolveHumanPrincipalOptions,
): void {
  assertId(options.principalId, "principalId");
  assertOpaqueText(options.authSubjectId, "authSubjectId", 240);
  assertDate(options.now, "now");
  assertAuditContext(options.audit);
}

function validateHumanScopeOptions(
  options: ResolveHumanWorkspaceScopeOptions,
): void {
  assertOpaqueText(options.authSubjectId, "authSubjectId", 240);
  assertOpaqueText(options.sessionId, "sessionId", 240);
  assertId(options.requestedWorkspaceId, "requestedWorkspaceId");
  assertWorkspacePermission(options.requiredPermission);
  assertDate(options.now, "now");
}

function validateServiceScopeOptions(
  options: ResolveServiceWorkspaceScopeOptions,
): void {
  assertDigest(options.tokenHash, "tokenHash");
  assertId(options.requestedWorkspaceId, "requestedWorkspaceId");
  assertWorkspacePermission(options.requiredPermission);
  assertDate(options.now, "now");
}

function validateListHumanWorkspaceContextsOptions(
  options: ListHumanWorkspaceContextsOptions,
): void {
  assertId(options.principalId, "principalId");
}

function validateMembershipOptions(
  options:
    ChangeWorkspaceMembershipOptions | ChangeOrganizationMembershipOptions,
): void {
  if ("workspaceId" in options) {
    assertId(options.authority.principalId, "authority.principalId");
    assertId(options.authority.authorityId, "authority.authorityId");
  } else {
    assertId(options.actorPrincipalId, "actorPrincipalId");
  }
  assertId(options.targetPrincipalId, "targetPrincipalId");
  assertPositiveVersion(options.expectedTargetVersion, "expectedTargetVersion");
  assertDate(options.now, "now");
  assertAuditContext(options.audit);
  if (
    options.nextStatus !== "active" &&
    options.nextStatus !== "suspended" &&
    options.nextStatus !== "revoked"
  ) {
    invalid("nextStatus is not a valid Membership status.");
  }
  if ("workspaceId" in options) {
    if (
      options.nextRole !== "owner" &&
      options.nextRole !== "admin" &&
      options.nextRole !== "editor" &&
      options.nextRole !== "operator" &&
      options.nextRole !== "reviewer" &&
      options.nextRole !== "viewer"
    ) {
      invalid("nextRole is not a valid Workspace role.");
    }
  } else if (
    options.nextRole !== "owner" &&
    options.nextRole !== "admin" &&
    options.nextRole !== "member"
  ) {
    invalid("nextRole is not a valid Organization role.");
  }
}

export interface CreateAuthorizationStoreOptions {
  readonly instanceId?: string;
  readonly nextId?: () => string;
}

export function createAuthorizationStore(
  pool: Pool,
  configuration: CreateAuthorizationStoreOptions = {},
): AuthorizationStore {
  const nextId = configuration.nextId ?? ulid;
  const store: AuthorizationStore = {
    async resolveHumanPrincipal(options) {
      validateHumanPrincipalOptions(options);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await inTransaction(pool, (connection) =>
            resolveHumanPrincipalInTransaction(connection, options),
          );
        } catch (error) {
          if (attempt === 0 && isRetryableIdentityRace(error)) {
            continue;
          }
          if (isRetryableIdentityRace(error)) {
            fail(
              "authorization.identity_conflict",
              "Human Principal identity could not be resolved.",
            );
          }
          throw error;
        }
      }
      return fail(
        "authorization.identity_conflict",
        "Human Principal identity could not be resolved.",
      );
    },
    resolveHumanWorkspaceScope(options) {
      validateHumanScopeOptions(options);
      return inTransaction(pool, (connection) =>
        resolveHumanWorkspaceScopeInTransaction(connection, options),
      );
    },
    resolveServiceWorkspaceScope(options) {
      validateServiceScopeOptions(options);
      return inTransaction(pool, (connection) =>
        resolveServiceWorkspaceScopeInTransaction(connection, options),
      );
    },
    listHumanWorkspaceContexts(options) {
      validateListHumanWorkspaceContextsOptions(options);
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<HumanWorkspaceContextRow[]>(
          `SELECT
               organization.id AS organizationId,
               organization.name AS organizationName,
               organization.version AS organizationVersion,
               workspace.id AS workspaceId,
               workspace.slug AS workspaceSlug,
               workspace.name AS workspaceName,
               workspace.version AS workspaceVersion,
               workspace_membership.id AS membershipId,
               workspace_membership.role AS membershipRole,
               workspace_membership.version AS membershipVersion
             FROM principal
             INNER JOIN workspace_membership
               ON workspace_membership.principal_id = principal.id
             INNER JOIN workspace
               ON workspace.id = workspace_membership.workspace_id
             INNER JOIN organization
               ON organization.id = workspace.organization_id
             WHERE principal.id = ?
               AND principal.principal_type = 'human'
               AND principal.status = 'active'
               AND workspace_membership.status = 'active'
               AND workspace.status = 'active'
               AND organization.status = 'active'
             ORDER BY organization.name, workspace.name, workspace.id`,
          [options.principalId],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              organizationId: row.organizationId,
              organizationName: row.organizationName,
              organizationVersion: row.organizationVersion,
              workspaceId: row.workspaceId,
              workspaceSlug: row.workspaceSlug,
              workspaceName: row.workspaceName,
              workspaceVersion: row.workspaceVersion,
              membershipId: row.membershipId,
              membershipRole: row.membershipRole,
              membershipVersion: row.membershipVersion,
              permissions: permissionsForWorkspaceRole(row.membershipRole),
            }),
          ),
        );
      });
    },
    changeWorkspaceMembership(options) {
      validateMembershipOptions(options);
      assertId(options.workspaceId, "workspaceId");
      return inTransaction(pool, (connection) =>
        changeWorkspaceMembershipInTransaction(
          connection,
          options,
          configuration.instanceId,
        ),
      );
    },
    changeWorkspaceMemberships(options) {
      if (options.length < 1 || options.length > 100) {
        fail(
          "authorization.invalid_argument",
          "Workspace membership batch must contain 1 to 100 changes.",
        );
      }
      const targets = new Set<string>();
      for (const option of options) {
        validateMembershipOptions(option);
        assertId(option.workspaceId, "workspaceId");
        if (targets.has(option.targetPrincipalId)) {
          fail(
            "authorization.invalid_argument",
            "Workspace membership batch contains a duplicate target.",
          );
        }
        targets.add(option.targetPrincipalId);
      }
      return inTransaction(pool, async (connection) => {
        const changed: ChangedMembership[] = [];
        for (const option of options) {
          changed.push(
            await changeWorkspaceMembershipInTransaction(
              connection,
              option,
              configuration.instanceId,
            ),
          );
        }
        return Object.freeze(changed);
      });
    },
    addExistingWorkspaceMember(options) {
      assertId(options.workspaceId, "workspaceId");
      assertId(options.authority.principalId, "authority.principalId");
      assertId(options.authority.authorityId, "authority.authorityId");
      assertDate(options.now, "now");
      assertAuditContext(options.audit);
      normalizeAccountEmail(options.email);
      if (!workspaceRoles.has(options.role)) {
        invalid("role is not a valid Workspace role.");
      }
      return inTransaction(pool, (connection) =>
        addExistingWorkspaceMemberInTransaction(
          connection,
          options,
          configuration.instanceId,
          nextId,
        ),
      );
    },
    changeOrganizationMembership(options) {
      validateMembershipOptions(options);
      assertId(options.organizationId, "organizationId");
      return inTransaction(pool, (connection) =>
        changeOrganizationMembershipInTransaction(connection, options),
      );
    },
  };
  return Object.freeze(store);
}
