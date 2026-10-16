import { createHash } from "node:crypto";

import {
  authorizationModelVersion,
  type TrustedWorkspaceMembershipManagementScope,
  type TrustedWorkspaceScope,
  type WorkspaceRole,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { normalizeVerifiedEmail } from "./instance-bootstrap-store.js";
import { emailVerificationRequiredInTransaction } from "./email-verification-policy.js";
import {
  revalidateWorkspaceMembershipManagementScopeInTransaction,
  revalidateTrustedWorkspaceScopeInTransaction,
  type WorkspaceMembershipManager,
} from "./authorization-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const invitationTokenPattern = /^knv_invite_v1_[A-Za-z0-9_-]{43}$/u;
const workspaceRoles = new Set<WorkspaceRole>([
  "owner",
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
]);

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export interface TeamAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface WorkspaceTeamMember {
  readonly membershipId: string;
  readonly principalId: string;
  readonly authSubjectId: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceInvitation {
  readonly invitationId: string;
  readonly targetEmail: string;
  readonly workspaceRole: WorkspaceRole;
  readonly state: InvitationState;
  readonly expiresAt: Date;
  readonly version: number;
  readonly invitedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceTeamProjection {
  readonly members: readonly WorkspaceTeamMember[];
  readonly invitations: readonly WorkspaceInvitation[];
  readonly membersNextCursor?: WorkspaceTeamMemberCursor;
  readonly invitationsNextCursor?: WorkspaceTeamInvitationCursor;
}

export interface WorkspaceTeamMemberCursor {
  readonly statusRank: number;
  readonly roleRank: number;
  readonly id: string;
}

export interface WorkspaceTeamInvitationCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface WorkspaceTeamQuery {
  readonly pageKind?: "members" | "invitations";
  readonly cursor?: WorkspaceTeamMemberCursor | WorkspaceTeamInvitationCursor;
  readonly limit?: number;
}

export interface InvitationSummary {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceRole: WorkspaceRole;
  readonly targetEmail: string;
  readonly targetEmailMasked: string;
  readonly state: InvitationState;
  readonly expiresAt: Date;
}

export interface CreateWorkspaceInvitationOptions {
  readonly authority: TrustedWorkspaceMembershipManagementScope;
  readonly workspaceId: string;
  readonly invitationId: string;
  readonly targetEmail: string;
  readonly workspaceRole: WorkspaceRole;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly audit: TeamAuditContext;
}

export interface CreatedWorkspaceInvitation {
  readonly invitationId: string;
  readonly targetEmailMasked: string;
  readonly workspaceRole: WorkspaceRole;
  readonly expiresAt: Date;
  readonly version: number;
}

export interface ResendWorkspaceInvitationOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly invitationId: string;
  readonly expectedVersion: number;
  readonly replacementInvitationId: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly audit: TeamAuditContext;
}

export interface RevokeWorkspaceInvitationOptions {
  readonly authority: TrustedWorkspaceMembershipManagementScope;
  readonly workspaceId: string;
  readonly invitationId: string;
  readonly expectedVersion: number;
  readonly reasonCode: "cancelled" | "superseded";
  readonly now: Date;
  readonly audit: TeamAuditContext;
}

export interface RevokedWorkspaceInvitation {
  readonly invitationId: string;
  readonly state: "revoked";
  readonly version: number;
  readonly revokedAt: Date;
}

export interface AcceptWorkspaceInvitationOptions {
  readonly tokenHash: string;
  readonly principalId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly organizationMembershipId: string;
  readonly workspaceMembershipId: string;
  readonly now: Date;
  readonly audit: TeamAuditContext;
}

export interface AcceptedWorkspaceInvitation {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly membershipRole: WorkspaceRole;
  readonly membershipVersion: number;
  readonly acceptedAt: Date;
  readonly replayed: boolean;
}

export interface TeamStore {
  listWorkspaceTeam(
    authority: TrustedWorkspaceScope,
    now: Date,
    query?: WorkspaceTeamQuery,
  ): Promise<WorkspaceTeamProjection>;
  resolveInvitation(
    tokenHash: string,
    now: Date,
  ): Promise<InvitationSummary | undefined>;
  createWorkspaceInvitation(
    options: CreateWorkspaceInvitationOptions,
  ): Promise<CreatedWorkspaceInvitation>;
  resendWorkspaceInvitation(
    options: ResendWorkspaceInvitationOptions,
  ): Promise<CreatedWorkspaceInvitation>;
  revokeWorkspaceInvitation(
    options: RevokeWorkspaceInvitationOptions,
  ): Promise<RevokedWorkspaceInvitation>;
  acceptWorkspaceInvitation(
    options: AcceptWorkspaceInvitationOptions,
  ): Promise<AcceptedWorkspaceInvitation>;
}

export interface CreateTeamStoreOptions {
  readonly instanceId?: string;
}

export type TeamStoreErrorCode =
  | "team.invalid_argument"
  | "team.forbidden"
  | "team.invitation_not_found"
  | "team.invitation_inactive"
  | "team.invitation_expired"
  | "team.identity_mismatch"
  | "team.concurrent_change"
  | "team.state_invalid";

export class TeamStoreError extends Error {
  public constructor(
    public readonly code: TeamStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamStoreError";
  }
}

interface TeamMemberRow extends RowDataPacket {
  readonly membershipId: string;
  readonly principalId: string;
  readonly authSubjectId: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly statusRank: number | string;
  readonly roleRank: number | string;
}

interface InvitationRow extends RowDataPacket {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly targetEmailNormalized: string;
  readonly targetEmailHash: string;
  readonly targetPrincipalId: string | null;
  readonly workspaceRole: WorkspaceRole | null;
  readonly status: "pending" | "accepted" | "revoked";
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly version: number;
  readonly invitedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface InvitationWorkspaceRow extends RowDataPacket {
  readonly organizationId: string;
  readonly status: "active" | "archived";
}

interface InvitationManagementAuthority extends WorkspaceMembershipManager {
  readonly organizationId: string;
  readonly workspaceId: string;
}

interface ExistingMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

interface ExistingOrganizationMembershipRow extends RowDataPacket {
  readonly id: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "suspended" | "revoked";
  readonly version: number;
}

function fail(code: TeamStoreErrorCode, message: string): never {
  throw new TeamStoreError(code, message);
}

function invalid(message: string): never {
  return fail("team.invalid_argument", message);
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

function assertVersion(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
}

function assertRole(value: unknown): asserts value is WorkspaceRole {
  if (
    typeof value !== "string" ||
    !workspaceRoles.has(value as WorkspaceRole)
  ) {
    invalid("workspaceRole is invalid.");
  }
}

function assertAudit(audit: TeamAuditContext): void {
  assertId(audit.auditEventId, "audit.auditEventId");
  assertDigest(audit.authenticationRefHash, "audit.authenticationRefHash");
}

function canonicalDigest(domain: string, value: string): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

export function digestInvitationToken(rawToken: string): string {
  if (!invitationTokenPattern.test(rawToken)) {
    invalid("Invitation token format is invalid.");
  }
  return canonicalDigest("kanvas:invitation-token:v1", rawToken);
}

export function invitationTokenPrefix(rawToken: string): string {
  if (!invitationTokenPattern.test(rawToken)) {
    invalid("Invitation token format is invalid.");
  }
  return rawToken.slice(0, 21);
}

export function digestInvitationTargetEmail(email: string): string {
  return canonicalDigest(
    "kanvas:invitation-target-email:v1",
    normalizeVerifiedEmail(email),
  );
}

export function maskInvitationEmail(email: string): string {
  const normalized = normalizeVerifiedEmail(email);
  const separator = normalized.lastIndexOf("@");
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  const visible =
    local.length <= 2
      ? local.slice(0, 1)
      : `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 2))}`;
  return `${visible}@${domain}`;
}

function stateFor(
  row: Pick<InvitationRow, "status" | "expiresAt">,
  now: Date,
): InvitationState {
  return row.status === "pending" && row.expiresAt <= now
    ? "expired"
    : row.status;
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

async function appendTeamAudit(
  connection: PoolConnection,
  input: {
    readonly audit: TeamAuditContext;
    readonly organizationId: string;
    readonly workspaceId: string;
    readonly actorPrincipalId: string;
    readonly authorityType:
      "human_membership" | "instance_administrator" | "none";
    readonly authorityId: string | null;
    readonly authorityVersion: number | null;
    readonly eventType: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly reasonCode: string;
    readonly severity: "info" | "warning" | "high";
    readonly details: Readonly<Record<string, string | number | boolean>>;
    readonly now: Date;
  },
): Promise<void> {
  await appendAuditEventInTransaction(connection, {
    id: input.audit.auditEventId,
    schemaVersion: auditEventSchemaVersion,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorPrincipalId: input.actorPrincipalId,
    actorType: "human",
    authenticationRefType: "session",
    authenticationRefHash: input.audit.authenticationRefHash,
    authorityType: input.authorityType,
    authorityId: input.authorityId,
    authorityVersion: input.authorityVersion,
    authorizationModelVersion,
    authorizationDecision: Object.freeze({
      action: input.action,
      modelVersion: authorizationModelVersion,
      outcome: "succeeded",
      reasonCode: input.reasonCode,
    }),
    eventType: input.eventType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: "succeeded",
    decisionReasonCode: input.reasonCode,
    severity: input.severity,
    requestId: input.audit.requestId ?? null,
    traceId: input.audit.traceId ?? null,
    details: input.details,
    occurredAt: input.now,
    recordedAt: input.now,
  });
}

function validateAuthorityInput(
  authority: TrustedWorkspaceScope,
  now: Date,
): void {
  assertId(authority.workspaceId, "authority.workspaceId");
  assertId(authority.organizationId, "authority.organizationId");
  assertId(authority.principalId, "authority.principalId");
  assertDate(now, "now");
}

function validateMembershipManagementAuthorityInput(
  authority: TrustedWorkspaceMembershipManagementScope,
  workspaceId: string,
  now: Date,
): void {
  assertId(workspaceId, "workspaceId");
  assertId(authority.principalId, "authority.principalId");
  assertId(authority.authorityId, "authority.authorityId");
  if (authority.authorityType === "human_membership") {
    assertId(authority.workspaceId, "authority.workspaceId");
    assertId(authority.organizationId, "authority.organizationId");
  }
  assertDate(now, "now");
}

async function resolveInvitationManagementAuthority(
  connection: PoolConnection,
  authority: TrustedWorkspaceMembershipManagementScope,
  workspaceId: string,
  instanceId: string | undefined,
): Promise<InvitationManagementAuthority> {
  const [workspaceRows] = await connection.execute<InvitationWorkspaceRow[]>(
    `SELECT organization_id AS organizationId, status
       FROM workspace
      WHERE id = ?
      LIMIT 1
      FOR SHARE`,
    [workspaceId],
  );
  const workspace = workspaceRows[0];
  if (!workspace || workspace.status !== "active") {
    fail("team.state_invalid", "Workspace is unavailable.");
  }
  const manager =
    await revalidateWorkspaceMembershipManagementScopeInTransaction(
      connection,
      authority,
      workspaceId,
      workspace.organizationId,
      instanceId,
    );
  return Object.freeze({
    ...manager,
    organizationId: workspace.organizationId,
    workspaceId,
  });
}

async function readInvitationByHash(
  connection: PoolConnection,
  tokenHash: string,
  lock: boolean,
): Promise<InvitationRow | undefined> {
  const [rows] = await connection.execute<InvitationRow[]>(
    `SELECT
       invitation.id AS invitationId,
       invitation.organization_id AS organizationId,
       organization.name AS organizationName,
       invitation.workspace_id AS workspaceId,
       workspace.name AS workspaceName,
       invitation.target_email_normalized AS targetEmailNormalized,
       invitation.target_email_hash AS targetEmailHash,
       invitation.target_principal_id AS targetPrincipalId,
       invitation.workspace_role AS workspaceRole,
       invitation.status,
       invitation.expires_at AS expiresAt,
       invitation.accepted_at AS acceptedAt,
       invitation.version,
       invitation.invited_by_principal_id AS invitedByPrincipalId,
       invitation.created_at AS createdAt,
       invitation.updated_at AS updatedAt
     FROM invitation
     INNER JOIN organization
       ON organization.id = invitation.organization_id
     INNER JOIN workspace
       ON workspace.id = invitation.workspace_id
      AND workspace.organization_id = invitation.organization_id
     WHERE invitation.token_hash = ?
     LIMIT 1
     ${lock ? "FOR UPDATE" : ""}`,
    [tokenHash],
  );
  return rows[0];
}

async function createInvitationInTransaction(
  connection: PoolConnection,
  options: CreateWorkspaceInvitationOptions,
  manager: InvitationManagementAuthority,
  revokeMatching: boolean,
): Promise<CreatedWorkspaceInvitation> {
  if (
    options.workspaceRole === "owner" &&
    manager.actorWorkspaceRole !== undefined &&
    manager.actorWorkspaceRole !== "owner"
  ) {
    fail(
      "team.forbidden",
      "Current membership cannot grant this Workspace role.",
    );
  }
  const normalizedEmail = normalizeVerifiedEmail(options.targetEmail);
  const targetEmailHash = digestInvitationTargetEmail(normalizedEmail);
  if (revokeMatching) {
    await connection.execute<ResultSetHeader>(
      `UPDATE invitation
       SET status = 'revoked',
           revoked_at = ?,
           revoked_reason_code = 'superseded',
           version = version + 1,
           updated_at = ?
       WHERE workspace_id = ?
         AND target_email_hash = ?
         AND status = 'pending'`,
      [options.now, options.now, manager.workspaceId, targetEmailHash],
    );
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO invitation (
       id,
       organization_id,
       workspace_id,
       target_email_normalized,
       target_email_hash,
       target_principal_id,
       organization_role,
       workspace_role,
       token_prefix,
       token_hash,
       hash_version,
       status,
       expires_at,
       accepted_at,
       revoked_at,
       revoked_reason_code,
       version,
       invited_by_principal_id,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, 'member', ?, ?, ?, 1,
               'pending', ?, NULL, NULL, NULL, 1, ?, ?, ?)`,
    [
      options.invitationId,
      manager.organizationId,
      manager.workspaceId,
      normalizedEmail,
      targetEmailHash,
      options.workspaceRole,
      options.tokenPrefix,
      options.tokenHash,
      options.expiresAt,
      manager.actorPrincipalId,
      options.now,
      options.now,
    ],
  );
  await appendTeamAudit(connection, {
    audit: options.audit,
    organizationId: manager.organizationId,
    workspaceId: manager.workspaceId,
    actorPrincipalId: manager.actorPrincipalId,
    authorityType: manager.authorityType,
    authorityId: manager.authorityId,
    authorityVersion: manager.authorityVersion,
    eventType: "workspace.invitation.created",
    action: "membership.manage",
    resourceType: "invitation",
    resourceId: options.invitationId,
    reasonCode: manager.decisionReasonCode,
    severity: options.workspaceRole === "owner" ? "high" : "info",
    details: Object.freeze({
      workspaceRole: options.workspaceRole,
      expiryEpochSeconds: Math.floor(options.expiresAt.getTime() / 1_000),
    }),
    now: options.now,
  });
  return Object.freeze({
    invitationId: options.invitationId,
    targetEmailMasked: maskInvitationEmail(normalizedEmail),
    workspaceRole: options.workspaceRole,
    expiresAt: options.expiresAt,
    version: 1,
  });
}

export function createTeamStore(
  pool: Pool,
  configuration: CreateTeamStoreOptions = {},
): TeamStore {
  const store: TeamStore = {
    listWorkspaceTeam(authority, now, query = {}) {
      validateAuthorityInput(authority, now);
      const limit = query.limit ?? 100;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (query.cursor && !query.pageKind)
      ) {
        invalid("Workspace Team query is invalid.");
      }
      if (query.cursor) {
        assertId(query.cursor.id, "query.cursor.id");
        if (
          query.pageKind === "members" &&
          !(
            "statusRank" in query.cursor &&
            "roleRank" in query.cursor &&
            Number.isInteger(query.cursor.statusRank) &&
            query.cursor.statusRank >= 1 &&
            query.cursor.statusRank <= 3 &&
            Number.isInteger(query.cursor.roleRank) &&
            query.cursor.roleRank >= 1 &&
            query.cursor.roleRank <= 5
          )
        ) {
          invalid("Workspace member cursor is invalid.");
        }
        if (
          query.pageKind === "invitations" &&
          !(
            "createdAt" in query.cursor &&
            query.cursor.createdAt instanceof Date &&
            Number.isFinite(query.cursor.createdAt.getTime())
          )
        ) {
          invalid("Workspace invitation cursor is invalid.");
        }
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "membership.manage",
          now,
        );
        const shouldReadMembers =
          !query.pageKind || query.pageKind === "members";
        const memberCursor =
          query.pageKind === "members" && query.cursor
            ? (query.cursor as WorkspaceTeamMemberCursor)
            : undefined;
        const [allMemberRows] = shouldReadMembers
          ? await connection.query<TeamMemberRow[]>(
              `SELECT
               membership.id AS membershipId,
               membership.principal_id AS principalId,
               human.auth_subject_id AS authSubjectId,
               membership.role,
               membership.status,
               membership.version,
               membership.created_at AS createdAt,
               membership.updated_at AS updatedAt,
               FIELD(
                 membership.status,
                 'active', 'suspended', 'revoked'
               ) AS statusRank,
               FIELD(
                 membership.role,
                 'owner', 'admin', 'editor', 'reviewer', 'viewer'
               ) AS roleRank
             FROM workspace_membership AS membership
             INNER JOIN human_principal AS human
               ON human.principal_id = membership.principal_id
             WHERE membership.workspace_id = ?
               ${
                 memberCursor
                   ? `AND (
                       FIELD(
                         membership.status,
                         'active', 'suspended', 'revoked'
                       ) > ?
                       OR (
                         FIELD(
                           membership.status,
                           'active', 'suspended', 'revoked'
                         ) = ?
                         AND FIELD(
                           membership.role,
                           'owner', 'admin', 'editor', 'reviewer', 'viewer'
                         ) > ?
                       )
                       OR (
                         FIELD(
                           membership.status,
                           'active', 'suspended', 'revoked'
                         ) = ?
                         AND FIELD(
                           membership.role,
                           'owner', 'admin', 'editor', 'reviewer', 'viewer'
                         ) = ?
                         AND membership.id > ?
                       )
                     )`
                   : ""
               }
             ORDER BY
               FIELD(membership.status, 'active', 'suspended', 'revoked'),
               FIELD(membership.role, 'owner', 'admin', 'editor', 'reviewer', 'viewer'),
               membership.id
             LIMIT ?`,
              [
                authority.workspaceId,
                ...(memberCursor
                  ? [
                      memberCursor.statusRank,
                      memberCursor.statusRank,
                      memberCursor.roleRank,
                      memberCursor.statusRank,
                      memberCursor.roleRank,
                      memberCursor.id,
                    ]
                  : []),
                limit + 1,
              ],
            )
          : [[] as TeamMemberRow[], []];
        const memberRows = allMemberRows.slice(0, limit);
        const shouldReadInvitations =
          !query.pageKind || query.pageKind === "invitations";
        const invitationCursor =
          query.pageKind === "invitations" && query.cursor
            ? (query.cursor as WorkspaceTeamInvitationCursor)
            : undefined;
        const [allInvitationRows] = shouldReadInvitations
          ? await connection.query<InvitationRow[]>(
              `SELECT
               invitation.id AS invitationId,
               invitation.organization_id AS organizationId,
               organization.name AS organizationName,
               invitation.workspace_id AS workspaceId,
               workspace.name AS workspaceName,
               invitation.target_email_normalized AS targetEmailNormalized,
               invitation.target_email_hash AS targetEmailHash,
               invitation.target_principal_id AS targetPrincipalId,
               invitation.workspace_role AS workspaceRole,
               invitation.status,
               invitation.expires_at AS expiresAt,
               invitation.accepted_at AS acceptedAt,
               invitation.version,
               invitation.invited_by_principal_id AS invitedByPrincipalId,
               invitation.created_at AS createdAt,
               invitation.updated_at AS updatedAt
             FROM invitation
             INNER JOIN organization
               ON organization.id = invitation.organization_id
             INNER JOIN workspace
               ON workspace.id = invitation.workspace_id
             WHERE invitation.workspace_id = ?
               AND invitation.status = 'pending'
               AND invitation.expires_at > ?
               ${
                 invitationCursor
                   ? `AND (
                       invitation.created_at < ?
                       OR (
                         invitation.created_at = ?
                         AND invitation.id < ?
                       )
                     )`
                   : ""
               }
             ORDER BY invitation.created_at DESC, invitation.id DESC
             LIMIT ?`,
              [
                authority.workspaceId,
                now,
                ...(invitationCursor
                  ? [
                      invitationCursor.createdAt,
                      invitationCursor.createdAt,
                      invitationCursor.id,
                    ]
                  : []),
                limit + 1,
              ],
            )
          : [[] as InvitationRow[], []];
        const invitationRows = allInvitationRows.slice(0, limit);
        const lastMember = memberRows.at(-1);
        const lastInvitation = invitationRows.at(-1);
        return Object.freeze({
          members: Object.freeze(
            memberRows.map((row) => Object.freeze({ ...row })),
          ),
          invitations: Object.freeze(
            invitationRows.map((row) =>
              Object.freeze({
                invitationId: row.invitationId,
                targetEmail: row.targetEmailNormalized,
                workspaceRole: row.workspaceRole ?? "viewer",
                state: stateFor(row, now),
                expiresAt: row.expiresAt,
                version: row.version,
                invitedByPrincipalId: row.invitedByPrincipalId,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }),
            ),
          ),
          ...(allMemberRows.length > limit && lastMember
            ? {
                membersNextCursor: Object.freeze({
                  statusRank: Number(lastMember.statusRank),
                  roleRank: Number(lastMember.roleRank),
                  id: lastMember.membershipId,
                }),
              }
            : {}),
          ...(allInvitationRows.length > limit && lastInvitation
            ? {
                invitationsNextCursor: Object.freeze({
                  createdAt: lastInvitation.createdAt,
                  id: lastInvitation.invitationId,
                }),
              }
            : {}),
        });
      });
    },

    resolveInvitation(tokenHash, now) {
      assertDigest(tokenHash, "tokenHash");
      assertDate(now, "now");
      return inTransaction(pool, async (connection) => {
        const row = await readInvitationByHash(connection, tokenHash, false);
        if (!row || !row.workspaceRole) {
          return undefined;
        }
        return Object.freeze({
          invitationId: row.invitationId,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          workspaceId: row.workspaceId,
          workspaceName: row.workspaceName,
          workspaceRole: row.workspaceRole,
          targetEmail: row.targetEmailNormalized,
          targetEmailMasked: maskInvitationEmail(row.targetEmailNormalized),
          state: stateFor(row, now),
          expiresAt: row.expiresAt,
        });
      });
    },

    createWorkspaceInvitation(options) {
      validateMembershipManagementAuthorityInput(
        options.authority,
        options.workspaceId,
        options.now,
      );
      assertId(options.invitationId, "invitationId");
      assertRole(options.workspaceRole);
      assertDigest(options.tokenHash, "tokenHash");
      assertDate(options.expiresAt, "expiresAt");
      assertAudit(options.audit);
      if (options.expiresAt <= options.now) {
        invalid("expiresAt must be in the future.");
      }
      return inTransaction(pool, async (connection) => {
        const manager = await resolveInvitationManagementAuthority(
          connection,
          options.authority,
          options.workspaceId,
          configuration.instanceId,
        );
        return createInvitationInTransaction(
          connection,
          options,
          manager,
          true,
        );
      });
    },

    resendWorkspaceInvitation(options) {
      validateAuthorityInput(options.authority, options.now);
      assertId(options.invitationId, "invitationId");
      assertId(options.replacementInvitationId, "replacementInvitationId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertDigest(options.tokenHash, "tokenHash");
      assertDate(options.expiresAt, "expiresAt");
      assertAudit(options.audit);
      return inTransaction(pool, async (connection) => {
        const manager = await resolveInvitationManagementAuthority(
          connection,
          options.authority,
          options.authority.workspaceId,
          configuration.instanceId,
        );
        const [rows] = await connection.execute<InvitationRow[]>(
          `SELECT
             invitation.id AS invitationId,
             invitation.organization_id AS organizationId,
             organization.name AS organizationName,
             invitation.workspace_id AS workspaceId,
             workspace.name AS workspaceName,
             invitation.target_email_normalized AS targetEmailNormalized,
             invitation.target_email_hash AS targetEmailHash,
             invitation.target_principal_id AS targetPrincipalId,
             invitation.workspace_role AS workspaceRole,
             invitation.status,
             invitation.expires_at AS expiresAt,
             invitation.accepted_at AS acceptedAt,
             invitation.version,
             invitation.invited_by_principal_id AS invitedByPrincipalId,
             invitation.created_at AS createdAt,
             invitation.updated_at AS updatedAt
           FROM invitation
           INNER JOIN organization
             ON organization.id = invitation.organization_id
           INNER JOIN workspace
             ON workspace.id = invitation.workspace_id
           WHERE invitation.id = ?
             AND invitation.workspace_id = ?
           LIMIT 1
           FOR UPDATE`,
          [options.invitationId, options.authority.workspaceId],
        );
        const existing = rows[0];
        if (!existing) {
          fail("team.invitation_not_found", "Invitation was not found.");
        }
        if (
          existing.status !== "pending" ||
          existing.version !== options.expectedVersion ||
          !existing.workspaceRole
        ) {
          fail("team.concurrent_change", "Invitation is no longer resendable.");
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE invitation
           SET status = 'revoked',
               revoked_at = ?,
               revoked_reason_code = 'superseded',
               version = version + 1,
               updated_at = ?
           WHERE id = ?
             AND version = ?
             AND status = 'pending'`,
          [options.now, options.now, existing.invitationId, existing.version],
        );
        return createInvitationInTransaction(
          connection,
          {
            authority: options.authority,
            workspaceId: options.authority.workspaceId,
            invitationId: options.replacementInvitationId,
            targetEmail: existing.targetEmailNormalized,
            workspaceRole: existing.workspaceRole,
            tokenHash: options.tokenHash,
            tokenPrefix: options.tokenPrefix,
            expiresAt: options.expiresAt,
            now: options.now,
            audit: options.audit,
          },
          manager,
          false,
        );
      });
    },

    revokeWorkspaceInvitation(options) {
      validateMembershipManagementAuthorityInput(
        options.authority,
        options.workspaceId,
        options.now,
      );
      assertId(options.invitationId, "invitationId");
      assertVersion(options.expectedVersion, "expectedVersion");
      assertAudit(options.audit);
      return inTransaction(pool, async (connection) => {
        const manager = await resolveInvitationManagementAuthority(
          connection,
          options.authority,
          options.workspaceId,
          configuration.instanceId,
        );
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE invitation
             SET status = 'revoked',
                 revoked_at = ?,
                 revoked_reason_code = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND workspace_id = ?
               AND status = 'pending'
               AND version = ?`,
          [
            options.now,
            options.reasonCode,
            options.now,
            options.invitationId,
            options.workspaceId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          fail(
            "team.concurrent_change",
            "Invitation changed before revocation.",
          );
        }
        await appendTeamAudit(connection, {
          audit: options.audit,
          organizationId: manager.organizationId,
          workspaceId: manager.workspaceId,
          actorPrincipalId: manager.actorPrincipalId,
          authorityType: manager.authorityType,
          authorityId: manager.authorityId,
          authorityVersion: manager.authorityVersion,
          eventType: "workspace.invitation.revoked",
          action: "membership.manage",
          resourceType: "invitation",
          resourceId: options.invitationId,
          reasonCode: manager.decisionReasonCode,
          severity: "warning",
          details: Object.freeze({
            previousVersion: options.expectedVersion,
            nextVersion: options.expectedVersion + 1,
            reasonCode: options.reasonCode,
          }),
          now: options.now,
        });
        return Object.freeze({
          invitationId: options.invitationId,
          state: "revoked" as const,
          version: options.expectedVersion + 1,
          revokedAt: options.now,
        });
      });
    },

    acceptWorkspaceInvitation(options) {
      assertDigest(options.tokenHash, "tokenHash");
      assertId(options.principalId, "principalId");
      assertId(options.organizationMembershipId, "organizationMembershipId");
      assertId(options.workspaceMembershipId, "workspaceMembershipId");
      assertDate(options.now, "now");
      assertAudit(options.audit);
      if (typeof options.emailVerified !== "boolean") {
        invalid("emailVerified must be a boolean.");
      }
      const normalizedEmail = normalizeVerifiedEmail(options.email);
      const targetEmailHash = digestInvitationTargetEmail(normalizedEmail);

      return inTransaction(pool, async (connection) => {
        if (
          !options.emailVerified &&
          (await emailVerificationRequiredInTransaction(
            connection,
            configuration.instanceId,
          ))
        ) {
          fail(
            "team.identity_mismatch",
            "This invitation requires control of the target email address.",
          );
        }
        const invitation = await readInvitationByHash(
          connection,
          options.tokenHash,
          true,
        );
        if (!invitation || !invitation.workspaceRole) {
          fail("team.invitation_not_found", "Invitation token is invalid.");
        }
        if (
          invitation.targetEmailHash !== targetEmailHash ||
          (invitation.targetPrincipalId !== null &&
            invitation.targetPrincipalId !== options.principalId)
        ) {
          fail(
            "team.identity_mismatch",
            "Verified identity does not match this invitation.",
          );
        }
        if (invitation.expiresAt <= options.now) {
          fail("team.invitation_expired", "Invitation has expired.");
        }
        if (invitation.status === "revoked") {
          fail("team.invitation_inactive", "Invitation has been revoked.");
        }
        const [principalRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id
             FROM principal
             WHERE id = ?
               AND principal_type = 'human'
               AND status = 'active'
             LIMIT 1
             FOR SHARE`,
          [options.principalId],
        );
        if (!principalRows[0]) {
          fail("team.state_invalid", "Active Human Principal is missing.");
        }
        if (invitation.status === "accepted") {
          const [replayedMembershipRows] = await connection.execute<
            ExistingMembershipRow[]
          >(
            `SELECT id, role, status, version
               FROM workspace_membership
               WHERE workspace_id = ?
                 AND principal_id = ?
               LIMIT 1
               FOR SHARE`,
            [invitation.workspaceId, options.principalId],
          );
          const replayedMembership = replayedMembershipRows[0];
          if (!replayedMembership) {
            fail(
              "team.state_invalid",
              "Accepted invitation has no Workspace membership.",
            );
          }
          return Object.freeze({
            invitationId: invitation.invitationId,
            organizationId: invitation.organizationId,
            workspaceId: invitation.workspaceId,
            membershipId: replayedMembership.id,
            membershipRole: replayedMembership.role,
            membershipVersion: replayedMembership.version,
            acceptedAt: invitation.acceptedAt ?? invitation.updatedAt,
            replayed: true,
          });
        }

        const [organizationMembershipRows] = await connection.execute<
          ExistingOrganizationMembershipRow[]
        >(
          `SELECT id, role, status, version
             FROM organization_membership
             WHERE organization_id = ?
               AND principal_id = ?
             LIMIT 1
             FOR UPDATE`,
          [invitation.organizationId, options.principalId],
        );
        const organizationMembership = organizationMembershipRows[0];
        if (!organizationMembership) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO organization_membership (
               id, organization_id, principal_id, role, status,
               version, created_at, updated_at
             ) VALUES (?, ?, ?, 'member', 'active', 1, ?, ?)`,
            [
              options.organizationMembershipId,
              invitation.organizationId,
              options.principalId,
              options.now,
              options.now,
            ],
          );
        } else if (organizationMembership.status !== "active") {
          await connection.execute<ResultSetHeader>(
            `UPDATE organization_membership
             SET role = 'member',
                 status = 'active',
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND version = ?`,
            [
              options.now,
              organizationMembership.id,
              organizationMembership.version,
            ],
          );
        }

        const [workspaceMembershipRows] = await connection.execute<
          ExistingMembershipRow[]
        >(
          `SELECT id, role, status, version
             FROM workspace_membership
             WHERE workspace_id = ?
               AND principal_id = ?
             LIMIT 1
             FOR UPDATE`,
          [invitation.workspaceId, options.principalId],
        );
        const existingMembership = workspaceMembershipRows[0];
        let membershipId = options.workspaceMembershipId;
        let membershipRole = invitation.workspaceRole;
        let membershipVersion = 1;
        if (!existingMembership) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO workspace_membership (
               id, organization_id, workspace_id, principal_id,
               role, status, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
            [
              membershipId,
              invitation.organizationId,
              invitation.workspaceId,
              options.principalId,
              membershipRole,
              options.now,
              options.now,
            ],
          );
        } else {
          membershipId = existingMembership.id;
          if (existingMembership.status === "active") {
            membershipRole = existingMembership.role;
            membershipVersion = existingMembership.version;
          } else {
            membershipVersion = existingMembership.version + 1;
            await connection.execute<ResultSetHeader>(
              `UPDATE workspace_membership
               SET role = ?,
                   status = 'active',
                   version = ?,
                   updated_at = ?
               WHERE id = ?
                 AND version = ?`,
              [
                membershipRole,
                membershipVersion,
                options.now,
                membershipId,
                existingMembership.version,
              ],
            );
          }
        }

        const [accepted] = await connection.execute<ResultSetHeader>(
          `UPDATE invitation
             SET status = 'accepted',
                 target_principal_id = ?,
                 accepted_at = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?
               AND status = 'pending'
               AND version = ?`,
          [
            options.principalId,
            options.now,
            options.now,
            invitation.invitationId,
            invitation.version,
          ],
        );
        if (accepted.affectedRows !== 1) {
          fail(
            "team.concurrent_change",
            "Invitation changed before acceptance.",
          );
        }
        await appendTeamAudit(connection, {
          audit: options.audit,
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          actorPrincipalId: options.principalId,
          authorityType: "none",
          authorityId: null,
          authorityVersion: null,
          eventType: "workspace.invitation.accepted",
          action: "invitation.accept",
          resourceType: "invitation",
          resourceId: invitation.invitationId,
          reasonCode: "invitation.accept.identity_matched",
          severity: "info",
          details: Object.freeze({
            membershipId,
            membershipRole,
            membershipVersion,
          }),
          now: options.now,
        });
        return Object.freeze({
          invitationId: invitation.invitationId,
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          membershipId,
          membershipRole,
          membershipVersion,
          acceptedAt: options.now,
          replayed: false,
        });
      });
    },
  };
  return Object.freeze(store);
}
