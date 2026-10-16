import {
  authorizationModelVersion,
  registrationMethodAllowed,
  type InstanceRegistrationPolicy,
  type RegistrationMethod,
  type RegistrationMode,
  type TrustedInstanceAdministratorScope,
  type WorkspaceRole,
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
} from "./audit-event-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const grantableWorkspaceRoles = new Set<Exclude<WorkspaceRole, "owner">>([
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
]);

interface RegistrationPolicyRow extends RowDataPacket {
  readonly mode: string;
  readonly emailPasswordEnabled: boolean | number;
  readonly emailVerificationRequired: boolean | number;
  readonly oidcProviderIds: unknown;
  readonly version: number;
}

interface AdministratorRow extends RowDataPacket {
  readonly principalId: string;
  readonly principalStatus: string;
  readonly administratorStatus: string;
  readonly administratorVersion: number;
}

interface AccessPrincipalRow extends RowDataPacket {
  readonly principalId: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean | number;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
  readonly isInstanceAdministrator: boolean | number | string;
  readonly registeredAt: Date;
}

interface AccessPrincipalMembershipRow extends RowDataPacket {
  readonly membershipId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

interface AccessInvitationRow extends RowDataPacket {
  readonly invitationId: string;
  readonly workspaceId: string;
  readonly targetEmail: string;
  readonly workspaceRole: WorkspaceRole;
  readonly expiresAt: Date;
  readonly version: number;
  readonly createdAt: Date;
}

interface AccessWorkspaceRow extends RowDataPacket {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

interface OrganizationMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

interface WorkspaceMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

interface TargetPrincipalRow extends RowDataPacket {
  readonly principalId: string;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

interface OwnedWorkspaceRow extends RowDataPacket {
  readonly workspaceId: string;
}

interface EffectiveOwnerRow extends RowDataPacket {
  readonly principalId: string;
}

export interface ResolveInstanceAdministratorOptions {
  readonly authSubjectId: string;
  readonly sessionId: string;
}

export type InstanceAdministratorResolution =
  | {
      readonly status: "authorized";
      readonly scope: TrustedInstanceAdministratorScope;
    }
  | {
      readonly status: "not_found" | "forbidden";
    };

export interface InstanceAccessAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface UpdateInstanceRegistrationPolicyOptions {
  readonly authority: TrustedInstanceAdministratorScope;
  readonly expectedVersion: number;
  readonly mode: RegistrationMode;
  readonly emailPasswordEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly oidcProviderIds: readonly string[];
  readonly now: Date;
  readonly audit: InstanceAccessAuditContext;
}

export interface InstanceAccessPrincipalMembership {
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

export interface InstanceAccessPrincipal {
  readonly principalId: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
  readonly isInstanceAdministrator: boolean;
  readonly memberships: readonly InstanceAccessPrincipalMembership[];
  readonly registeredAt: Date;
}

export interface InstanceAccessWorkspace {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface InstanceAccessInvitation {
  readonly invitationId: string;
  readonly workspaceId: string;
  readonly targetEmail: string;
  readonly workspaceRole: WorkspaceRole;
  readonly state: "pending";
  readonly expiresAt: Date;
  readonly version: number;
  readonly createdAt: Date;
}

export interface InstanceAccessOverview {
  readonly principals: readonly InstanceAccessPrincipal[];
  readonly workspaces: readonly InstanceAccessWorkspace[];
  readonly invitations: readonly InstanceAccessInvitation[];
}

export interface ChangeInstancePrincipalStatusOptions {
  readonly authority: TrustedInstanceAdministratorScope;
  readonly targetPrincipalId: string;
  readonly expectedVersion: number;
  readonly status: "active" | "suspended";
  readonly now: Date;
  readonly audit: InstanceAccessAuditContext;
}

export interface ChangedInstancePrincipalStatus {
  readonly principalId: string;
  readonly status: "active" | "suspended";
  readonly version: number;
}

export interface GrantInstanceWorkspaceAccessAssignment {
  readonly workspaceId: string;
  readonly role: Exclude<WorkspaceRole, "owner">;
}

export interface GrantInstanceWorkspaceAccessOptions {
  readonly authority: TrustedInstanceAdministratorScope;
  readonly targetPrincipalId: string;
  readonly assignments: readonly GrantInstanceWorkspaceAccessAssignment[];
  readonly now: Date;
  readonly audit: Omit<InstanceAccessAuditContext, "auditEventId">;
}

export interface GrantedInstanceWorkspaceMembership {
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly role: Exclude<WorkspaceRole, "owner">;
  readonly status: "active";
  readonly version: number;
}

export interface InstanceAccessStore {
  readRegistrationPolicy(): Promise<InstanceRegistrationPolicy>;
  registrationAllowed(method: RegistrationMethod): Promise<boolean>;
  resolveAdministrator(
    options: ResolveInstanceAdministratorOptions,
  ): Promise<InstanceAdministratorResolution>;
  updateRegistrationPolicy(
    options: UpdateInstanceRegistrationPolicyOptions,
  ): Promise<InstanceRegistrationPolicy>;
  listAccessOverview(
    authority: TrustedInstanceAdministratorScope,
  ): Promise<InstanceAccessOverview>;
  grantWorkspaceAccess(
    options: GrantInstanceWorkspaceAccessOptions,
  ): Promise<readonly GrantedInstanceWorkspaceMembership[]>;
  changePrincipalStatus(
    options: ChangeInstancePrincipalStatusOptions,
  ): Promise<ChangedInstancePrincipalStatus>;
}

export type InstanceAccessStoreErrorCode =
  | "instance_access.invalid_argument"
  | "instance_access.state_invalid"
  | "instance_access.concurrent_change"
  | "instance_access.last_owner"
  | "instance_access.protected_principal"
  | "instance_access.forbidden";

export class InstanceAccessStoreError extends Error {
  public constructor(
    public readonly code: InstanceAccessStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InstanceAccessStoreError";
  }
}

function fail(code: InstanceAccessStoreErrorCode, message: string): never {
  throw new InstanceAccessStoreError(code, message);
}

function invalid(message: string): never {
  return fail("instance_access.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    [...value].some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point < 32 || point === 127);
    })
  ) {
    invalid(`${label} must be bounded text without control characters.`);
  }
}

function assertVersion(value: unknown, label: string, allowZero = false): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be a valid unsigned version.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeProviderIds(value: unknown): readonly string[] | undefined {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length > 20) return undefined;
  const unique = new Set<string>();
  for (const providerId of parsed) {
    if (
      typeof providerId !== "string" ||
      !providerIdPattern.test(providerId) ||
      unique.has(providerId)
    ) {
      return undefined;
    }
    unique.add(providerId);
  }
  return Object.freeze([...unique].sort());
}

function policyFromRow(
  row: RegistrationPolicyRow | undefined,
): InstanceRegistrationPolicy {
  if (!row) {
    return Object.freeze({
      mode: "closed",
      emailPasswordEnabled: false,
      emailVerificationRequired: true,
      oidcProviderIds: Object.freeze([]),
      version: 0,
    });
  }
  const oidcProviderIds = normalizeProviderIds(row.oidcProviderIds);
  const emailPasswordEnabled =
    row.emailPasswordEnabled === true || row.emailPasswordEnabled === 1;
  const emailVerificationRequired =
    row.emailVerificationRequired === true ||
    row.emailVerificationRequired === 1;
  if (
    (row.mode !== "closed" && row.mode !== "account_only") ||
    !oidcProviderIds ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    ![true, false, 0, 1].includes(row.emailVerificationRequired) ||
    (row.mode === "closed" &&
      (emailPasswordEnabled || oidcProviderIds.length > 0)) ||
    (row.mode === "account_only" &&
      !emailPasswordEnabled &&
      oidcProviderIds.length === 0)
  ) {
    return fail(
      "instance_access.state_invalid",
      "Instance Registration Policy facts are invalid.",
    );
  }
  return Object.freeze({
    mode: row.mode,
    emailPasswordEnabled,
    emailVerificationRequired,
    oidcProviderIds,
    version: row.version,
  });
}

function normalizePolicyInput(options: {
  readonly mode: RegistrationMode;
  readonly emailPasswordEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly oidcProviderIds: readonly string[];
}): Omit<InstanceRegistrationPolicy, "version"> {
  const oidcProviderIds = normalizeProviderIds(options.oidcProviderIds);
  if (
    !oidcProviderIds ||
    typeof options.emailPasswordEnabled !== "boolean" ||
    typeof options.emailVerificationRequired !== "boolean"
  ) {
    return invalid("Registration methods are invalid.");
  }
  if (options.mode !== "closed" && options.mode !== "account_only") {
    return invalid("Registration mode is invalid.");
  }
  if (
    (options.mode === "closed" &&
      (options.emailPasswordEnabled || oidcProviderIds.length > 0)) ||
    (options.mode === "account_only" &&
      !options.emailPasswordEnabled &&
      oidcProviderIds.length === 0)
  ) {
    return invalid("Registration mode and methods are inconsistent.");
  }
  return Object.freeze({
    mode: options.mode,
    emailPasswordEnabled: options.emailPasswordEnabled,
    emailVerificationRequired: options.emailVerificationRequired,
    oidcProviderIds,
  });
}

export async function inTransaction<TResult>(
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

async function readPolicy(
  connection: PoolConnection,
  instanceId: string,
  lock: boolean,
): Promise<InstanceRegistrationPolicy> {
  const [rows] = await connection.execute<RegistrationPolicyRow[]>(
    `SELECT
       mode,
       email_password_enabled AS emailPasswordEnabled,
       email_verification_required AS emailVerificationRequired,
       oidc_provider_ids AS oidcProviderIds,
       version
     FROM instance_registration_policy
     WHERE instance_id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [instanceId],
  );
  return policyFromRow(rows[0]);
}

export function validateAuthority(
  authority: TrustedInstanceAdministratorScope,
  instanceId: string,
): void {
  if (
    authority.trusted !== true ||
    authority.authorizationModelVersion !== authorizationModelVersion ||
    authority.instanceId !== instanceId ||
    authority.principalType !== "human" ||
    authority.authenticationRefType !== "session" ||
    authority.authorityType !== "instance_administrator"
  ) {
    fail(
      "instance_access.forbidden",
      "Instance Administrator authority is not trusted.",
    );
  }
  assertId(authority.principalId, "authority.principalId");
  assertId(authority.authorityId, "authority.authorityId");
  assertVersion(authority.authorityVersion, "authority.authorityVersion");
  assertBoundedText(
    authority.authenticationRefId,
    "authority.authenticationRefId",
    240,
  );
}

function validateAuditBase(
  audit: Omit<InstanceAccessAuditContext, "auditEventId">,
): void {
  if (
    typeof audit.authenticationRefHash !== "string" ||
    !digestPattern.test(audit.authenticationRefHash)
  ) {
    invalid("audit.authenticationRefHash must be a canonical SHA-256 digest.");
  }
  if (audit.requestId !== undefined) {
    assertBoundedText(audit.requestId, "audit.requestId", 120);
  }
  if (audit.traceId !== undefined) {
    assertBoundedText(audit.traceId, "audit.traceId", 120);
  }
}

function validateAudit(audit: InstanceAccessAuditContext): void {
  assertId(audit.auditEventId, "audit.auditEventId");
  validateAuditBase(audit);
}

export async function requireCurrentAdministrator(
  connection: PoolConnection,
  authority: TrustedInstanceAdministratorScope,
): Promise<void> {
  const [administratorRows] = await connection.execute<AdministratorRow[]>(
    `SELECT
       principal.id AS principalId,
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
  const administrator = administratorRows[0];
  if (
    !administrator ||
    administrator.principalStatus !== "active" ||
    administrator.administratorStatus !== "active" ||
    administrator.administratorVersion !== authority.authorityVersion
  ) {
    fail(
      "instance_access.forbidden",
      "Instance Administrator authority is no longer active.",
    );
  }
}

/** Revalidate site authority while the caller's mutation transaction is open. */
export async function revalidateInstanceAdministratorInTransaction(
  connection: PoolConnection,
  authority: TrustedInstanceAdministratorScope,
  instanceId: string,
): Promise<void> {
  validateAuthority(authority, instanceId);
  if (authority.authorityId !== authority.principalId) {
    fail(
      "instance_access.forbidden",
      "Administrator authority identity does not match.",
    );
  }
  await requireCurrentAdministrator(connection, authority);
}

export function createInstanceAccessStore(
  pool: Pool,
  options: {
    readonly instanceId: string;
    readonly nextId?: () => string;
  },
): InstanceAccessStore {
  assertBoundedText(options.instanceId, "instanceId", 120);
  const nextId = options.nextId ?? ulid;
  const issueId = (label: string): string => {
    const value = nextId();
    assertId(value, label);
    return value;
  };
  const store: InstanceAccessStore = {
    readRegistrationPolicy() {
      return inTransaction(pool, (connection) =>
        readPolicy(connection, options.instanceId, false),
      );
    },

    async registrationAllowed(method) {
      if (method.kind === "oidc") {
        if (!providerIdPattern.test(method.providerId)) {
          return false;
        }
      } else if (method.kind !== "email_password") {
        return false;
      }
      const policy = await this.readRegistrationPolicy();
      return registrationMethodAllowed(policy, method);
    },

    resolveAdministrator(request) {
      assertBoundedText(request.authSubjectId, "authSubjectId", 240);
      assertBoundedText(request.sessionId, "sessionId", 240);
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute<AdministratorRow[]>(
          `SELECT
             principal.id AS principalId,
             principal.status AS principalStatus,
             administrator.status AS administratorStatus,
             administrator.version AS administratorVersion
           FROM human_principal AS human
           INNER JOIN principal
             ON principal.id = human.principal_id
            AND principal.principal_type = 'human'
           INNER JOIN instance_administrator AS administrator
             ON administrator.principal_id = principal.id
           WHERE human.auth_subject_id = ?
           LIMIT 1
           FOR SHARE`,
          [request.authSubjectId],
        );
        const row = rows[0];
        if (!row) return Object.freeze({ status: "not_found" as const });
        if (
          row.principalStatus !== "active" ||
          row.administratorStatus !== "active" ||
          !Number.isSafeInteger(row.administratorVersion) ||
          row.administratorVersion < 1
        ) {
          return Object.freeze({ status: "forbidden" as const });
        }
        return Object.freeze({
          status: "authorized" as const,
          scope: Object.freeze({
            instanceId: options.instanceId,
            principalId: row.principalId,
            principalType: "human" as const,
            authenticationRefType: "session" as const,
            authenticationRefId: request.sessionId,
            authorityType: "instance_administrator" as const,
            authorityId: row.principalId,
            authorityVersion: row.administratorVersion,
            authorizationModelVersion,
            trusted: true as const,
          }),
        });
      });
    },

    updateRegistrationPolicy(request) {
      validateAuthority(request.authority, options.instanceId);
      assertVersion(request.expectedVersion, "expectedVersion", true);
      assertDate(request.now, "now");
      validateAudit(request.audit);
      const next = normalizePolicyInput(request);
      return inTransaction(pool, async (connection) => {
        await requireCurrentAdministrator(connection, request.authority);

        const current = await readPolicy(connection, options.instanceId, true);
        if (current.version !== request.expectedVersion) {
          return fail(
            "instance_access.concurrent_change",
            "Instance Registration Policy changed concurrently.",
          );
        }
        const nextVersion = current.version + 1;
        let revokedUnverifiedSessionCount = 0;
        if (
          !current.emailVerificationRequired &&
          next.emailVerificationRequired
        ) {
          const [revoked] = await connection.execute<ResultSetHeader>(
            `DELETE session
               FROM auth_session AS session
               INNER JOIN auth_user AS account
                 ON account.id = session.user_id
              WHERE account.email_verified = 0`,
          );
          revokedUnverifiedSessionCount = revoked.affectedRows;
        }
        if (current.version === 0) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO instance_registration_policy (
               instance_id,
               mode,
               email_password_enabled,
               email_verification_required,
               oidc_provider_ids,
               version,
               updated_by_principal_id,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              options.instanceId,
              next.mode,
              next.emailPasswordEnabled,
              next.emailVerificationRequired,
              JSON.stringify(next.oidcProviderIds),
              nextVersion,
              request.authority.principalId,
              request.now,
              request.now,
            ],
          );
        } else {
          const [updated] = await connection.execute<ResultSetHeader>(
            `UPDATE instance_registration_policy
             SET mode = ?,
                 email_password_enabled = ?,
                 email_verification_required = ?,
                 oidc_provider_ids = ?,
                 version = ?,
                 updated_by_principal_id = ?,
                 updated_at = ?
             WHERE instance_id = ?
               AND version = ?`,
            [
              next.mode,
              next.emailPasswordEnabled,
              next.emailVerificationRequired,
              JSON.stringify(next.oidcProviderIds),
              nextVersion,
              request.authority.principalId,
              request.now,
              options.instanceId,
              current.version,
            ],
          );
          if (updated.affectedRows !== 1) {
            return fail(
              "instance_access.concurrent_change",
              "Instance Registration Policy changed concurrently.",
            );
          }
        }

        await appendAuditEventInTransaction(connection, {
          id: request.audit.auditEventId,
          schemaVersion: auditEventSchemaVersion,
          organizationId: null,
          workspaceId: null,
          actorPrincipalId: request.authority.principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: request.audit.authenticationRefHash,
          authorityType: "instance_administrator",
          authorityId: request.authority.authorityId,
          authorityVersion: request.authority.authorityVersion,
          authorizationModelVersion,
          authorizationDecision: Object.freeze({
            action: "instance.registration_policy.manage",
            authorityId: request.authority.authorityId,
            authorityType: "instance_administrator",
            authorityVersion: request.authority.authorityVersion,
            modelVersion: authorizationModelVersion,
            outcome: "succeeded",
            reasonCode: "instance_administrator.active",
          }),
          eventType: "instance.registration_policy.updated",
          action: "instance.registration_policy.manage",
          resourceType: "instance_registration_policy",
          resourceId: null,
          outcome: "succeeded",
          decisionReasonCode: "instance_administrator.active",
          severity: next.mode === "closed" ? "info" : "warning",
          requestId: request.audit.requestId ?? null,
          traceId: request.audit.traceId ?? null,
          details: Object.freeze({
            previousMode: current.mode,
            nextMode: next.mode,
            previousDirectLocalMethodEnabled: current.emailPasswordEnabled,
            nextDirectLocalMethodEnabled: next.emailPasswordEnabled,
            previousAddressProofRequired: current.emailVerificationRequired,
            nextAddressProofRequired: next.emailVerificationRequired,
            revokedLoginCount: revokedUnverifiedSessionCount,
            previousOidcProviderIds: current.oidcProviderIds,
            nextOidcProviderIds: next.oidcProviderIds,
            previousVersion: current.version,
            nextVersion,
          }),
          occurredAt: request.now,
          recordedAt: request.now,
        });

        return Object.freeze({ ...next, version: nextVersion });
      });
    },

    listAccessOverview(authority) {
      validateAuthority(authority, options.instanceId);
      return inTransaction(pool, async (connection) => {
        await requireCurrentAdministrator(connection, authority);
        const [principalRows] = await connection.execute<AccessPrincipalRow[]>(
          `SELECT
             principal.id AS principalId,
             auth_user.name AS displayName,
             auth_user.email AS email,
             auth_user.email_verified AS emailVerified,
             principal.status,
             principal.version,
             CASE WHEN administrator.principal_id IS NULL THEN 0 ELSE 1 END
               AS isInstanceAdministrator,
             principal.created_at AS registeredAt
           FROM principal
           INNER JOIN human_principal AS human
             ON human.principal_id = principal.id
           INNER JOIN auth_user
             ON auth_user.id = human.auth_subject_id
           LEFT JOIN instance_administrator AS administrator
             ON administrator.principal_id = principal.id
            AND administrator.status = 'active'
           WHERE principal.principal_type = 'human'
           ORDER BY principal.created_at, principal.id
             LIMIT 200`,
        );
        const [membershipRows] = await connection.execute<
          AccessPrincipalMembershipRow[]
        >(
          `SELECT
               membership.id AS membershipId,
               membership.principal_id AS principalId,
               membership.workspace_id AS workspaceId,
               membership.role,
               membership.status,
               membership.version
             FROM workspace_membership AS membership
             INNER JOIN workspace
               ON workspace.id = membership.workspace_id
              AND workspace.status = 'active'
             INNER JOIN organization
               ON organization.id = workspace.organization_id
              AND organization.status = 'active'
             ORDER BY membership.principal_id, membership.workspace_id
             LIMIT 5000`,
        );
        const membershipsByPrincipal = new Map<
          string,
          InstanceAccessPrincipalMembership[]
        >();
        for (const membership of membershipRows) {
          const memberships =
            membershipsByPrincipal.get(membership.principalId) ?? [];
          memberships.push(
            Object.freeze({
              membershipId: membership.membershipId,
              workspaceId: membership.workspaceId,
              role: membership.role,
              status: membership.status,
              version: membership.version,
            }),
          );
          membershipsByPrincipal.set(membership.principalId, memberships);
        }
        const [workspaceRows] = await connection.execute<AccessWorkspaceRow[]>(
          `SELECT
             organization.id AS organizationId,
             organization.name AS organizationName,
             workspace.id AS workspaceId,
             workspace.name AS workspaceName
           FROM workspace
           INNER JOIN organization
             ON organization.id = workspace.organization_id
           WHERE workspace.status = 'active'
             AND organization.status = 'active'
           ORDER BY organization.name, workspace.name, workspace.id
           LIMIT 500`,
        );
        const [invitationRows] = await connection.execute<
          AccessInvitationRow[]
        >(
          `SELECT
               invitation.id AS invitationId,
               invitation.workspace_id AS workspaceId,
               invitation.target_email_normalized AS targetEmail,
               invitation.workspace_role AS workspaceRole,
               invitation.expires_at AS expiresAt,
               invitation.version,
               invitation.created_at AS createdAt
             FROM invitation
             INNER JOIN workspace
               ON workspace.id = invitation.workspace_id
              AND workspace.status = 'active'
             INNER JOIN organization
               ON organization.id = workspace.organization_id
              AND organization.status = 'active'
             WHERE invitation.status = 'pending'
               AND invitation.expires_at > CURRENT_TIMESTAMP(3)
               AND invitation.workspace_role IS NOT NULL
             ORDER BY invitation.created_at DESC, invitation.id DESC
             LIMIT 200`,
        );
        return Object.freeze({
          principals: Object.freeze(
            principalRows.map((row) =>
              Object.freeze({
                principalId: row.principalId,
                displayName: row.displayName.trim() || row.email,
                email: row.email,
                emailVerified:
                  row.emailVerified === true || row.emailVerified === 1,
                status: row.status,
                version: row.version,
                isInstanceAdministrator:
                  row.isInstanceAdministrator === true ||
                  row.isInstanceAdministrator === 1 ||
                  row.isInstanceAdministrator === "1",
                memberships: Object.freeze(
                  membershipsByPrincipal.get(row.principalId) ?? [],
                ),
                registeredAt: row.registeredAt,
              }),
            ),
          ),
          workspaces: Object.freeze(
            workspaceRows.map((row) =>
              Object.freeze({
                organizationId: row.organizationId,
                organizationName: row.organizationName,
                workspaceId: row.workspaceId,
                workspaceName: row.workspaceName,
              }),
            ),
          ),
          invitations: Object.freeze(
            invitationRows.map((row) =>
              Object.freeze({
                invitationId: row.invitationId,
                workspaceId: row.workspaceId,
                targetEmail: row.targetEmail,
                workspaceRole: row.workspaceRole,
                state: "pending" as const,
                expiresAt: row.expiresAt,
                version: row.version,
                createdAt: row.createdAt,
              }),
            ),
          ),
        });
      });
    },

    grantWorkspaceAccess(request) {
      validateAuthority(request.authority, options.instanceId);
      assertId(request.targetPrincipalId, "targetPrincipalId");
      assertDate(request.now, "now");
      validateAuditBase(request.audit);
      if (request.assignments.length < 1 || request.assignments.length > 50) {
        invalid("Workspace access grant must contain 1 to 50 assignments.");
      }
      const workspaceIds = new Set<string>();
      for (const assignment of request.assignments) {
        assertId(assignment.workspaceId, "assignments.workspaceId");
        if (
          !grantableWorkspaceRoles.has(assignment.role) ||
          workspaceIds.has(assignment.workspaceId)
        ) {
          invalid("Workspace access assignments are invalid or duplicated.");
        }
        workspaceIds.add(assignment.workspaceId);
      }

      return inTransaction(pool, async (connection) => {
        await requireCurrentAdministrator(connection, request.authority);
        const [targetRows] = await connection.execute<TargetPrincipalRow[]>(
          `SELECT principal.id AS principalId,
                  principal.status,
                  principal.version
             FROM principal
             INNER JOIN human_principal AS human
               ON human.principal_id = principal.id
             INNER JOIN auth_user
               ON auth_user.id = human.auth_subject_id
              AND auth_user.email_verified = 1
            WHERE principal.id = ?
              AND principal.principal_type = 'human'
            LIMIT 1
            FOR SHARE`,
          [request.targetPrincipalId],
        );
        const target = targetRows[0];
        if (!target || target.status !== "active") {
          return fail(
            "instance_access.state_invalid",
            "Target Human Principal is not active.",
          );
        }

        const granted: GrantedInstanceWorkspaceMembership[] = [];
        for (const assignment of request.assignments) {
          const [workspaceRows] = await connection.execute<
            AccessWorkspaceRow[]
          >(
            `SELECT
               organization.id AS organizationId,
               organization.name AS organizationName,
               workspace.id AS workspaceId,
               workspace.name AS workspaceName
             FROM workspace
             INNER JOIN organization
               ON organization.id = workspace.organization_id
             WHERE workspace.id = ?
               AND workspace.status = 'active'
               AND organization.status = 'active'
             LIMIT 1
             FOR SHARE`,
            [assignment.workspaceId],
          );
          const workspace = workspaceRows[0];
          if (!workspace) {
            return fail(
              "instance_access.state_invalid",
              "An assigned Workspace is not active.",
            );
          }

          const [organizationMembershipRows] = await connection.execute<
            OrganizationMembershipRow[]
          >(
            `SELECT id, role, status, version
             FROM organization_membership
             WHERE organization_id = ?
               AND principal_id = ?
             LIMIT 1
             FOR UPDATE`,
            [workspace.organizationId, request.targetPrincipalId],
          );
          const organizationMembership = organizationMembershipRows[0];
          if (!organizationMembership) {
            await connection.execute<ResultSetHeader>(
              `INSERT INTO organization_membership (
                 id, organization_id, principal_id, role, status, version,
                 created_at, updated_at
               ) VALUES (?, ?, ?, 'member', 'active', 1, ?, ?)`,
              [
                issueId("organizationMembershipId"),
                workspace.organizationId,
                request.targetPrincipalId,
                request.now,
                request.now,
              ],
            );
          } else if (organizationMembership.status !== "active") {
            const [updated] = await connection.execute<ResultSetHeader>(
              `UPDATE organization_membership
               SET role = 'member',
                   status = 'active',
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND version = ?`,
              [
                request.now,
                organizationMembership.id,
                organizationMembership.version,
              ],
            );
            if (updated.affectedRows !== 1) {
              return fail(
                "instance_access.concurrent_change",
                "Organization Membership changed concurrently.",
              );
            }
          }

          const [membershipRows] = await connection.execute<
            WorkspaceMembershipRow[]
          >(
            `SELECT id, role, status, version
             FROM workspace_membership
             WHERE workspace_id = ?
               AND principal_id = ?
             LIMIT 1
             FOR UPDATE`,
            [workspace.workspaceId, request.targetPrincipalId],
          );
          const existing = membershipRows[0];
          let membershipId: string;
          let membershipVersion: number;
          if (!existing) {
            membershipId = issueId("workspaceMembershipId");
            membershipVersion = 1;
            await connection.execute<ResultSetHeader>(
              `INSERT INTO workspace_membership (
                 id, organization_id, workspace_id, principal_id, role,
                 status, version, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
              [
                membershipId,
                workspace.organizationId,
                workspace.workspaceId,
                request.targetPrincipalId,
                assignment.role,
                request.now,
                request.now,
              ],
            );
          } else if (
            existing.status === "active" &&
            existing.role !== assignment.role
          ) {
            return fail(
              "instance_access.state_invalid",
              "Active Workspace Membership roles must be changed through Workspace membership management.",
            );
          } else if (existing.status !== "active") {
            membershipId = existing.id;
            membershipVersion = existing.version + 1;
            const [updated] = await connection.execute<ResultSetHeader>(
              `UPDATE workspace_membership
               SET role = ?,
                   status = 'active',
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?
                 AND version = ?`,
              [assignment.role, request.now, existing.id, existing.version],
            );
            if (updated.affectedRows !== 1) {
              return fail(
                "instance_access.concurrent_change",
                "Workspace Membership changed concurrently.",
              );
            }
          } else {
            membershipId = existing.id;
            membershipVersion = existing.version;
          }

          await appendAuditEventInTransaction(connection, {
            id: issueId("auditEventId"),
            schemaVersion: auditEventSchemaVersion,
            organizationId: workspace.organizationId,
            workspaceId: workspace.workspaceId,
            actorPrincipalId: request.authority.principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: request.audit.authenticationRefHash,
            authorityType: "instance_administrator",
            authorityId: request.authority.authorityId,
            authorityVersion: request.authority.authorityVersion,
            authorizationModelVersion,
            authorizationDecision: Object.freeze({
              action: "instance.workspace_access.grant",
              authorityId: request.authority.authorityId,
              authorityType: "instance_administrator",
              authorityVersion: request.authority.authorityVersion,
              modelVersion: authorizationModelVersion,
              outcome: "succeeded",
              reasonCode: "instance_administrator.active",
            }),
            eventType: "instance.workspace_access.granted",
            action: "instance.workspace_access.grant",
            resourceType: "workspace_membership",
            resourceId: membershipId,
            outcome: "succeeded",
            decisionReasonCode: "instance_administrator.active",
            severity: assignment.role === "admin" ? "warning" : "info",
            requestId: request.audit.requestId ?? null,
            traceId: request.audit.traceId ?? null,
            details: Object.freeze({
              targetPrincipalId: request.targetPrincipalId,
              workspaceRole: assignment.role,
              membershipVersion,
            }),
            occurredAt: request.now,
            recordedAt: request.now,
          });
          granted.push(
            Object.freeze({
              workspaceId: workspace.workspaceId,
              membershipId,
              role: assignment.role,
              status: "active" as const,
              version: membershipVersion,
            }),
          );
        }
        return Object.freeze(granted);
      });
    },

    changePrincipalStatus(request) {
      validateAuthority(request.authority, options.instanceId);
      assertId(request.targetPrincipalId, "targetPrincipalId");
      assertVersion(request.expectedVersion, "expectedVersion");
      assertDate(request.now, "now");
      validateAudit(request.audit);
      if (request.status !== "active" && request.status !== "suspended") {
        invalid("Principal status must be active or suspended.");
      }
      return inTransaction(pool, async (connection) => {
        await requireCurrentAdministrator(connection, request.authority);
        const [targetRows] = await connection.execute<TargetPrincipalRow[]>(
          `SELECT id AS principalId, status, version
             FROM principal
            WHERE id = ? AND principal_type = 'human'
            LIMIT 1
            FOR UPDATE`,
          [request.targetPrincipalId],
        );
        const target = targetRows[0];
        if (!target) {
          return fail(
            "instance_access.state_invalid",
            "Target Human Principal does not exist.",
          );
        }
        if (target.version !== request.expectedVersion) {
          return fail(
            "instance_access.concurrent_change",
            "Principal status changed concurrently.",
          );
        }
        if (target.status === "revoked") {
          return fail(
            "instance_access.state_invalid",
            "A revoked Principal cannot be restored through access management.",
          );
        }
        if (target.principalId === request.authority.principalId) {
          return fail(
            "instance_access.protected_principal",
            "An Instance Administrator cannot change their own account status.",
          );
        }
        const [administratorRows] = await connection.execute<RowDataPacket[]>(
          `SELECT principal_id
             FROM instance_administrator
            WHERE principal_id = ? AND status = 'active'
            LIMIT 1
            FOR SHARE`,
          [target.principalId],
        );
        if (administratorRows[0]) {
          return fail(
            "instance_access.protected_principal",
            "Active Instance Administrators cannot be suspended here.",
          );
        }
        if (target.status === request.status) {
          return Object.freeze({
            principalId: target.principalId,
            status: request.status,
            version: target.version,
          });
        }

        if (target.status === "active" && request.status === "suspended") {
          const [ownedWorkspaceRows] = await connection.execute<
            OwnedWorkspaceRow[]
          >(
            `SELECT membership.workspace_id AS workspaceId
                 FROM workspace_membership AS membership
                 INNER JOIN workspace
                   ON workspace.id = membership.workspace_id
                  AND workspace.status = 'active'
                 INNER JOIN organization
                   ON organization.id = workspace.organization_id
                  AND organization.status = 'active'
                WHERE membership.principal_id = ?
                  AND membership.role = 'owner'
                  AND membership.status = 'active'
                ORDER BY membership.workspace_id
                FOR SHARE`,
            [target.principalId],
          );
          for (const ownedWorkspace of ownedWorkspaceRows) {
            await connection.execute<RowDataPacket[]>(
              `SELECT id
                 FROM workspace
                WHERE id = ?
                LIMIT 1
                FOR UPDATE`,
              [ownedWorkspace.workspaceId],
            );
            const [ownerRows] = await connection.execute<EffectiveOwnerRow[]>(
              `SELECT membership.principal_id AS principalId
                   FROM workspace_membership AS membership
                   INNER JOIN principal
                     ON principal.id = membership.principal_id
                    AND principal.principal_type = 'human'
                    AND principal.status = 'active'
                  WHERE membership.workspace_id = ?
                    AND membership.role = 'owner'
                    AND membership.status = 'active'
                  ORDER BY membership.principal_id
                  FOR UPDATE`,
              [ownedWorkspace.workspaceId],
            );
            if (
              !ownerRows.some(
                (owner) => owner.principalId !== target.principalId,
              )
            ) {
              return fail(
                "instance_access.last_owner",
                "Every active Workspace must retain an active Human Owner.",
              );
            }
          }
        }

        const nextVersion = target.version + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE principal
              SET status = ?, version = ?, updated_at = ?
            WHERE id = ? AND version = ?`,
          [
            request.status,
            nextVersion,
            request.now,
            target.principalId,
            target.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "instance_access.concurrent_change",
            "Principal status changed concurrently.",
          );
        }
        await appendAuditEventInTransaction(connection, {
          id: request.audit.auditEventId,
          schemaVersion: auditEventSchemaVersion,
          organizationId: null,
          workspaceId: null,
          actorPrincipalId: request.authority.principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: request.audit.authenticationRefHash,
          authorityType: "instance_administrator",
          authorityId: request.authority.authorityId,
          authorityVersion: request.authority.authorityVersion,
          authorizationModelVersion,
          authorizationDecision: Object.freeze({
            action: "instance.principal_status.manage",
            authorityId: request.authority.authorityId,
            authorityType: "instance_administrator",
            authorityVersion: request.authority.authorityVersion,
            modelVersion: authorizationModelVersion,
            outcome: "succeeded",
            reasonCode: "instance_administrator.active",
          }),
          eventType: "instance.principal_status.changed",
          action: "instance.principal_status.manage",
          resourceType: "principal",
          resourceId: target.principalId,
          outcome: "succeeded",
          decisionReasonCode: "instance_administrator.active",
          severity: request.status === "suspended" ? "high" : "warning",
          requestId: request.audit.requestId ?? null,
          traceId: request.audit.traceId ?? null,
          details: Object.freeze({
            previousStatus: target.status,
            nextStatus: request.status,
            previousVersion: target.version,
            nextVersion,
          }),
          occurredAt: request.now,
          recordedAt: request.now,
        });
        return Object.freeze({
          principalId: target.principalId,
          status: request.status,
          version: nextVersion,
        });
      });
    },
  };
  return Object.freeze(store);
}
