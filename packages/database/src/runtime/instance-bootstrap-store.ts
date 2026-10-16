import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

import {
  authorizationModelVersion,
  type AgentFoundationPackProfileV1,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { monotonicFactory } from "ulid";

import type { PreparedCatalogPackageV1 } from "../cli/catalog-package-installer.js";
import { ensureWorkspaceSystemCatalogInTransaction } from "./workspace-system-catalog.js";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { ensureWorkspaceAgentProfileInTransaction } from "./workspace-default-agent-store.js";

import { ensureDefaultProviderPolicies } from "./default-provider-policy.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const setupTokenPattern = /^knv_setup_v1_[A-Za-z0-9_-]{43}$/u;
const setupTokenPrefixLength = 20;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;

export type InstanceSetupBindingMode =
  "auth_subject" | "verified_email_hash" | "unbound";

export interface IssueInstanceSetupTokenOptions {
  readonly setupTokenId: string;
  readonly tokenPrefix: string;
  readonly tokenHash: string;
  readonly hashVersion: 1;
  readonly bindingMode: InstanceSetupBindingMode;
  readonly bindingHash?: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly auditEventId: string;
}

export interface IssuedInstanceSetupToken {
  readonly setupTokenId: string;
  readonly tokenPrefix: string;
  readonly bindingMode: InstanceSetupBindingMode;
  readonly expiresAt: Date;
}

export interface InspectInstanceSetupTokenOptions {
  readonly tokenHash: string;
  readonly verifiedEmail?: string;
  readonly now: Date;
}

export interface InspectedInstanceSetupToken {
  readonly bindingMode: InstanceSetupBindingMode;
  readonly verifiedEmailMatches: boolean | null;
}

export interface RedeemInstanceSetupTokenOptions {
  readonly tokenHash: string;
  readonly authSubjectId: string;
  readonly verifiedEmail?: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly organizationMembershipId: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly workspaceId: string;
  readonly workspaceMembershipId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly now: Date;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly auditEventId: string;
}

export interface RedeemedInstanceSetup {
  readonly principalId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly bindingMode: InstanceSetupBindingMode;
}

export interface InstanceBootstrapStore {
  issueSetupToken(
    options: IssueInstanceSetupTokenOptions,
  ): Promise<IssuedInstanceSetupToken>;
  inspectSetupToken(
    options: InspectInstanceSetupTokenOptions,
  ): Promise<InspectedInstanceSetupToken>;
  redeemSetupToken(
    options: RedeemInstanceSetupTokenOptions,
  ): Promise<RedeemedInstanceSetup>;
}

export interface CreateInstanceBootstrapStoreOptions {
  readonly instanceId: string;
  readonly initialCatalog?: PreparedCatalogPackageV1;
  readonly initialAgentProfiles?: readonly AgentFoundationPackProfileV1[];
  readonly nextId?: () => string;
}

export type InstanceBootstrapStoreErrorCode =
  | "instance_bootstrap.invalid_argument"
  | "instance_bootstrap.instance_missing"
  | "instance_bootstrap.already_initialized"
  | "instance_bootstrap.token_invalid"
  | "instance_bootstrap.token_expired"
  | "instance_bootstrap.binding_mismatch"
  | "instance_bootstrap.identity_conflict"
  | "instance_bootstrap.concurrent_change";

export class InstanceBootstrapStoreError extends Error {
  public constructor(
    public readonly code: InstanceBootstrapStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InstanceBootstrapStoreError";
  }
}

interface AdministratorRow extends RowDataPacket {
  readonly principalId: string;
}

interface SetupTokenRow extends RowDataPacket {
  readonly id: string;
  readonly bindingMode: InstanceSetupBindingMode;
  readonly bindingHash: string | null;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
}

interface HumanPrincipalRow extends RowDataPacket {
  readonly principalId: string;
  readonly status: "active" | "suspended" | "revoked";
}

function fail(code: InstanceBootstrapStoreErrorCode, message: string): never {
  throw new InstanceBootstrapStoreError(code, message);
}

function invalid(message: string): never {
  return fail("instance_bootstrap.invalid_argument", message);
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
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertOpaqueText(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  const hasControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    hasControlCharacter
  ) {
    invalid(`${label} is invalid.`);
  }
}

function assertSlug(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !slugPattern.test(value)) {
    invalid(
      `${label} must contain only lowercase letters, digits and internal hyphens.`,
    );
  }
}

function canonicalDigest(domain: string, value: string): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

export function digestInstanceSetupToken(rawToken: string): string {
  if (!setupTokenPattern.test(rawToken)) {
    invalid("Instance setup token format is invalid.");
  }
  return canonicalDigest("kanvas:instance-setup-token:v1", rawToken);
}

export function instanceSetupTokenPrefix(rawToken: string): string {
  if (!setupTokenPattern.test(rawToken)) {
    invalid("Instance setup token format is invalid.");
  }
  return rawToken.slice(0, setupTokenPrefixLength);
}

export function normalizeVerifiedEmail(email: string): string {
  assertOpaqueText(email, "verifiedEmail", 320);
  const separator = email.lastIndexOf("@");
  if (
    separator < 1 ||
    separator === email.length - 1 ||
    email.indexOf("@") !== separator
  ) {
    invalid("verifiedEmail has an invalid address shape.");
  }
  const local = email
    .slice(0, separator)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  const domain = domainToASCII(
    email.slice(separator + 1).normalize("NFKC"),
  ).toLowerCase();
  const normalized = `${local}@${domain}`;
  if (
    local.length < 1 ||
    local.length > 64 ||
    domain.length < 1 ||
    domain.length > 255 ||
    !domain.includes(".") ||
    normalized.length > 320 ||
    !/^[\x21-\x7e]+$/u.test(normalized)
  ) {
    invalid("verifiedEmail cannot be normalized safely.");
  }
  return normalized;
}

export function digestInstanceSetupBinding(
  mode: Exclude<InstanceSetupBindingMode, "unbound">,
  value: string,
): string {
  const normalized =
    mode === "verified_email_hash" ? normalizeVerifiedEmail(value) : value;
  assertOpaqueText(
    normalized,
    mode === "auth_subject" ? "authSubjectId" : "verifiedEmail",
    mode === "auth_subject" ? 240 : 320,
  );
  return canonicalDigest(
    `kanvas:instance-setup-binding:${mode}:v1`,
    normalized,
  );
}

function assertIssueOptions(options: IssueInstanceSetupTokenOptions): void {
  assertId(options.setupTokenId, "setupTokenId");
  assertId(options.auditEventId, "auditEventId");
  assertDigest(options.tokenHash, "tokenHash");
  assertOpaqueText(options.tokenPrefix, "tokenPrefix", 24);
  assertDate(options.now, "now");
  assertDate(options.expiresAt, "expiresAt");
  if (
    options.hashVersion !== 1 ||
    options.expiresAt <= options.now ||
    options.expiresAt.getTime() - options.now.getTime() >
      7 * 24 * 60 * 60 * 1000
  ) {
    invalid("Setup token expiry must be in the future and at most seven days.");
  }
  if (options.bindingMode === "unbound") {
    if (options.bindingHash !== undefined) {
      invalid("Unbound setup tokens cannot have a binding hash.");
    }
  } else {
    assertDigest(options.bindingHash, "bindingHash");
  }
}

function assertInspectOptions(options: InspectInstanceSetupTokenOptions): void {
  assertDigest(options.tokenHash, "tokenHash");
  assertDate(options.now, "now");
  if (options.verifiedEmail !== undefined) {
    normalizeVerifiedEmail(options.verifiedEmail);
  }
}

function assertRedeemOptions(options: RedeemInstanceSetupTokenOptions): void {
  assertDigest(options.tokenHash, "tokenHash");
  for (const [label, value] of [
    ["principalId", options.principalId],
    ["organizationId", options.organizationId],
    ["organizationMembershipId", options.organizationMembershipId],
    ["workspaceId", options.workspaceId],
    ["workspaceMembershipId", options.workspaceMembershipId],
    ["auditEventId", options.auditEventId],
  ] as const) {
    assertId(value, label);
  }
  assertOpaqueText(options.authSubjectId, "authSubjectId", 240);
  assertDigest(options.authenticationRefHash, "authenticationRefHash");
  assertSlug(options.organizationSlug, "organizationSlug");
  assertSlug(options.workspaceSlug, "workspaceSlug");
  assertOpaqueText(options.organizationName, "organizationName", 160);
  assertOpaqueText(options.workspaceName, "workspaceName", 160);
  assertDate(options.now, "now");
  if (options.requestId !== undefined) {
    assertOpaqueText(options.requestId, "requestId", 120);
  }
  if (options.traceId !== undefined) {
    assertOpaqueText(options.traceId, "traceId", 120);
  }
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

async function lockInstance(
  connection: PoolConnection,
  instanceId: string,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE instance_runtime_state
     SET state_version = state_version
     WHERE instance_id = ?`,
    [instanceId],
  );
  if (result.affectedRows !== 1) {
    fail(
      "instance_bootstrap.instance_missing",
      "Configured instance runtime state is missing.",
    );
  }
}

async function assertNoActiveAdministrator(
  connection: PoolConnection,
): Promise<void> {
  const [rows] = await connection.execute<AdministratorRow[]>(
    `SELECT principal_id AS principalId
     FROM instance_administrator
     WHERE status = 'active'
     ORDER BY principal_id ASC
     LIMIT 1
     FOR SHARE`,
  );
  if (rows.length > 0) {
    fail(
      "instance_bootstrap.already_initialized",
      "The instance already has an active administrator.",
    );
  }
}

async function requireUsableSetupToken(
  connection: PoolConnection,
  tokenHash: string,
  now: Date,
  lock: "FOR SHARE" | "FOR UPDATE",
): Promise<SetupTokenRow> {
  const [tokenRows] = await connection.execute<SetupTokenRow[]>(
    `SELECT
         id,
         binding_mode AS bindingMode,
         binding_hash AS bindingHash,
         expires_at AS expiresAt,
         used_at AS usedAt,
         revoked_at AS revokedAt
       FROM instance_setup_token
       WHERE token_hash = ?
       LIMIT 1
       ${lock}`,
    [tokenHash],
  );
  const token = tokenRows[0];
  if (!token || token.usedAt || token.revokedAt) {
    fail(
      "instance_bootstrap.token_invalid",
      "Instance setup token is invalid or already consumed.",
    );
  }
  if (token.expiresAt <= now) {
    fail(
      "instance_bootstrap.token_expired",
      "Instance setup token has expired.",
    );
  }
  return token;
}

function assertTokenBinding(
  row: SetupTokenRow,
  options: RedeemInstanceSetupTokenOptions,
): void {
  if (row.bindingMode === "unbound") {
    if (row.bindingHash !== null) {
      fail(
        "instance_bootstrap.token_invalid",
        "Unbound setup token has invalid persisted binding facts.",
      );
    }
    return;
  }
  const source =
    row.bindingMode === "auth_subject"
      ? options.authSubjectId
      : options.verifiedEmail;
  if (
    !source ||
    row.bindingHash !== digestInstanceSetupBinding(row.bindingMode, source)
  ) {
    fail(
      "instance_bootstrap.binding_mismatch",
      "Authenticated identity does not match the setup token binding.",
    );
  }
}

export function createInstanceBootstrapStore(
  pool: Pool,
  options: CreateInstanceBootstrapStoreOptions,
): InstanceBootstrapStore {
  assertOpaqueText(options.instanceId, "instanceId", 120);
  const nextId = options.nextId ?? monotonicFactory();
  return Object.freeze({
    async issueSetupToken(
      request: IssueInstanceSetupTokenOptions,
    ): Promise<IssuedInstanceSetupToken> {
      assertIssueOptions(request);
      return inTransaction(pool, async (connection) => {
        await lockInstance(connection, options.instanceId);
        await assertNoActiveAdministrator(connection);
        await connection.execute<ResultSetHeader>(
          `UPDATE instance_setup_token
           SET revoked_at = ?
           WHERE used_at IS NULL
             AND revoked_at IS NULL`,
          [request.now],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO instance_setup_token (
             id,
             token_prefix,
             token_hash,
             hash_version,
             binding_mode,
             binding_hash,
             expires_at,
             used_at,
             revoked_at,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          [
            request.setupTokenId,
            request.tokenPrefix,
            request.tokenHash,
            request.hashVersion,
            request.bindingMode,
            request.bindingHash ?? null,
            request.expiresAt,
            request.now,
          ],
        );
        await appendAuditEventInTransaction(connection, {
          id: request.auditEventId,
          schemaVersion: auditEventSchemaVersion,
          organizationId: null,
          workspaceId: null,
          actorPrincipalId: null,
          actorType: "system",
          authenticationRefType: "deployment",
          authenticationRefHash: canonicalDigest(
            "kanvas:instance-bootstrap-deployment:v1",
            options.instanceId,
          ),
          authorityType: "system",
          authorityId: null,
          authorityVersion: null,
          authorizationModelVersion,
          authorizationDecision: Object.freeze({
            action: "instance.bootstrap.issue",
            bindingMode: request.bindingMode,
            outcome: "succeeded",
          }),
          eventType: "instance.bootstrap.issued",
          action: "instance.bootstrap.issue",
          resourceType: "instance_setup",
          resourceId: request.setupTokenId,
          outcome: "succeeded",
          decisionReasonCode: "instance.uninitialized",
          severity: request.bindingMode === "unbound" ? "critical" : "high",
          requestId: null,
          traceId: null,
          details: Object.freeze({
            bindingMode: request.bindingMode,
            expiresAt: request.expiresAt.toISOString(),
          }),
          occurredAt: request.now,
          recordedAt: request.now,
        });
        return Object.freeze({
          setupTokenId: request.setupTokenId,
          tokenPrefix: request.tokenPrefix,
          bindingMode: request.bindingMode,
          expiresAt: request.expiresAt,
        });
      });
    },

    async inspectSetupToken(
      request: InspectInstanceSetupTokenOptions,
    ): Promise<InspectedInstanceSetupToken> {
      assertInspectOptions(request);
      return inTransaction(pool, async (connection) => {
        await assertNoActiveAdministrator(connection);
        const token = await requireUsableSetupToken(
          connection,
          request.tokenHash,
          request.now,
          "FOR SHARE",
        );
        const verifiedEmailMatches =
          token.bindingMode === "verified_email_hash" && request.verifiedEmail
            ? token.bindingHash ===
              digestInstanceSetupBinding(
                "verified_email_hash",
                request.verifiedEmail,
              )
            : null;
        return Object.freeze({
          bindingMode: token.bindingMode,
          verifiedEmailMatches,
        });
      });
    },

    async redeemSetupToken(
      request: RedeemInstanceSetupTokenOptions,
    ): Promise<RedeemedInstanceSetup> {
      assertRedeemOptions(request);
      return inTransaction(pool, async (connection) => {
        await lockInstance(connection, options.instanceId);
        await assertNoActiveAdministrator(connection);
        const token = await requireUsableSetupToken(
          connection,
          request.tokenHash,
          request.now,
          "FOR UPDATE",
        );
        assertTokenBinding(token, request);

        const [humanRows] = await connection.execute<HumanPrincipalRow[]>(
          `SELECT
               principal.id AS principalId,
               principal.status AS status
             FROM human_principal AS human
             INNER JOIN principal
               ON principal.id = human.principal_id
              AND principal.principal_type = 'human'
             WHERE human.auth_subject_id = ?
             LIMIT 1
             FOR UPDATE`,
          [request.authSubjectId],
        );
        const existingHuman = humanRows[0];
        const principalId = existingHuman?.principalId ?? request.principalId;
        if (existingHuman && existingHuman.status !== "active") {
          fail(
            "instance_bootstrap.identity_conflict",
            "Authenticated Human Principal is not active.",
          );
        }
        if (!existingHuman) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO principal (
               id,
               principal_type,
               status,
               version,
               created_at,
               updated_at
             ) VALUES (?, 'human', 'active', 1, ?, ?)`,
            [principalId, request.now, request.now],
          );
          await connection.execute<ResultSetHeader>(
            `INSERT INTO human_principal (
               principal_id,
               auth_subject_id,
               created_at
             ) VALUES (?, ?, ?)`,
            [principalId, request.authSubjectId, request.now],
          );
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, ?, ?, 'active', 1, ?, ?)`,
          [
            request.organizationId,
            request.organizationSlug,
            request.organizationName,
            request.now,
            request.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workspace (
             id,
             organization_id,
             slug,
             name,
             status,
             version,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
          [
            request.workspaceId,
            request.organizationId,
            request.workspaceSlug,
            request.workspaceName,
            request.now,
            request.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO instance_administrator (
             principal_id, status, version, created_at, updated_at
           ) VALUES (?, 'active', 1, ?, ?)`,
          [principalId, request.now, request.now],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO organization_membership (
             id,
             organization_id,
             principal_id,
             role,
             status,
             version,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'owner', 'active', 1, ?, ?)`,
          [
            request.organizationMembershipId,
            request.organizationId,
            principalId,
            request.now,
            request.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workspace_membership (
             id,
             organization_id,
             workspace_id,
             principal_id,
             role,
             status,
             version,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
          [
            request.workspaceMembershipId,
            request.organizationId,
            request.workspaceId,
            principalId,
            request.now,
            request.now,
          ],
        );
        await ensureDefaultProviderPolicies(connection, {
          actorId: principalId,
          workspaceId: request.workspaceId,
          now: request.now,
          nextId,
        });
        if (options.initialAgentProfiles?.length) {
          for (const profile of options.initialAgentProfiles) {
            await ensureWorkspaceAgentProfileInTransaction(connection, {
              workspaceId: request.workspaceId,
              ownerPrincipalId: principalId,
              profile,
              nextId,
              now: request.now,
            });
          }
        }
        if (options.initialCatalog) {
          await ensureWorkspaceSystemCatalogInTransaction(connection, {
            workspaceId: request.workspaceId,
            prepared: options.initialCatalog,
            now: request.now,
            nextId,
          });
        }
        const [consume] = await connection.execute<ResultSetHeader>(
          `UPDATE instance_setup_token
             SET used_at = ?
             WHERE id = ?
               AND used_at IS NULL
               AND revoked_at IS NULL
               AND expires_at > ?`,
          [request.now, token.id, request.now],
        );
        if (consume.affectedRows !== 1) {
          fail(
            "instance_bootstrap.concurrent_change",
            "Instance setup token changed during redemption.",
          );
        }
        await appendAuditEventInTransaction(connection, {
          id: request.auditEventId,
          schemaVersion: auditEventSchemaVersion,
          organizationId: request.organizationId,
          workspaceId: request.workspaceId,
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: request.authenticationRefHash,
          authorityType: "none",
          authorityId: null,
          authorityVersion: null,
          authorizationModelVersion,
          authorizationDecision: Object.freeze({
            action: "instance.bootstrap.redeem",
            bindingMode: token.bindingMode,
            outcome: "succeeded",
          }),
          eventType: "instance.bootstrap.redeemed",
          action: "instance.bootstrap.redeem",
          resourceType: "instance_setup",
          resourceId: token.id,
          outcome: "succeeded",
          decisionReasonCode: "setup_binding.satisfied",
          severity: "critical",
          requestId: request.requestId ?? null,
          traceId: request.traceId ?? null,
          details: Object.freeze({
            bindingMode: token.bindingMode,
            principalId,
            organizationId: request.organizationId,
            workspaceId: request.workspaceId,
          }),
          occurredAt: request.now,
          recordedAt: request.now,
        });
        return Object.freeze({
          principalId,
          organizationId: request.organizationId,
          workspaceId: request.workspaceId,
          bindingMode: token.bindingMode,
        });
      });
    },
  });
}
