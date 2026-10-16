import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { AuditJsonObject } from "./audit-event-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

export type SecretSourceKind =
  "plaintext_database" | "encrypted_database" | "deployment_reference";
export type SecretVersionLifecycle =
  | "created"
  | "verified"
  | "active"
  | "draining"
  | "retired"
  | "revoked"
  | "restore_only"
  | "destroyed";

export interface EncryptedSecretEnvelope {
  readonly materialCiphertextBase64: string;
  readonly materialNonceBase64: string;
  readonly materialAuthTagBase64: string;
  readonly wrappedDekBase64: string;
  readonly wrapNonceBase64: string;
  readonly wrapAuthTagBase64: string;
  readonly kekVersion: string;
}

export interface PlaintextDatabaseSecret {
  readonly materialPlaintextBase64: string;
}

export type SecretVersionSource =
  | {
      readonly kind: "plaintext_database";
      readonly plaintext: PlaintextDatabaseSecret;
    }
  | {
      readonly kind: "encrypted_database";
      readonly envelope: EncryptedSecretEnvelope;
    }
  | {
      readonly kind: "deployment_reference";
      readonly deploymentReference: string;
    };

/**
 * Infrastructure-owned port. Secret material is scoped to the callback and is
 * never returned by the database store or placed in a DTO.
 */
export interface EncryptedDatabaseSecretResolverPort {
  withResolvedMaterial<TResult>(
    metadata: PinnedEncryptedDatabaseSecretMetadata,
    use: (material: Uint8Array) => Promise<TResult>,
  ): Promise<TResult>;
}

/**
 * Deployment integrations (Kubernetes, Vault agent, platform secret binding,
 * and similar) implement this port outside the database package.
 */
export interface DeploymentSecretResolverPort {
  withResolvedMaterial<TResult>(
    metadata: PinnedDeploymentSecretMetadata,
    use: (material: Uint8Array) => Promise<TResult>,
  ): Promise<TResult>;
}

/**
 * Reserved rewrap boundary. The store never changes wrapping material without
 * an explicitly supplied, controlled rewrap implementation.
 */
export interface SecretEnvelopeRewrapPort {
  rewrap(
    envelope: EncryptedSecretEnvelope,
    currentKekVersion: string,
  ): Promise<
    Pick<
      EncryptedSecretEnvelope,
      | "wrappedDekBase64"
      | "wrapNonceBase64"
      | "wrapAuthTagBase64"
      | "kekVersion"
    >
  >;
}

interface SecretIdentityMetadata {
  readonly id: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly version: number;
  readonly materialGeneration: number;
  readonly sourceKind: SecretSourceKind;
  readonly lifecycleStatus: SecretVersionLifecycle;
  readonly aadDigest: string;
  readonly materialFingerprint: string;
  readonly formatVersion: number;
  readonly drainDeadlineAt: Date | null;
}

export interface PinnedEncryptedDatabaseSecretMetadata extends SecretIdentityMetadata {
  readonly sourceKind: "encrypted_database";
  readonly envelope: EncryptedSecretEnvelope;
}

export interface PinnedPlaintextDatabaseSecretMetadata extends SecretIdentityMetadata {
  readonly sourceKind: "plaintext_database";
  readonly plaintext: PlaintextDatabaseSecret;
}

export interface PinnedDeploymentSecretMetadata extends SecretIdentityMetadata {
  readonly sourceKind: "deployment_reference";
  readonly deploymentReference: string;
}

export type PinnedSecretVersionMetadata =
  | PinnedPlaintextDatabaseSecretMetadata
  | PinnedEncryptedDatabaseSecretMetadata
  | PinnedDeploymentSecretMetadata;

export interface SecretVersionPin {
  readonly id: string;
  readonly credentialId: string;
  readonly version: number;
  readonly materialGeneration: number;
  readonly sourceKind: SecretSourceKind;
  readonly materialFingerprint: string;
  readonly lifecycleStatus: SecretVersionLifecycle;
  readonly drainDeadlineAt: Date | null;
}

export interface CreateSecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly source: SecretVersionSource;
  readonly aadDigest: string;
  readonly materialFingerprint: string;
  readonly formatVersion: number;
  readonly createdByPrincipalId: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface VerifySecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface RotateActiveSecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly candidateSecretVersionId: string;
  readonly expectedCredentialVersion: number;
  /**
   * Absolute, bounded draining window for the previous active version.
   */
  readonly previousDrainDeadlineAt: Date;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface RevokeSecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface RetireDrainingSecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface MarkSecretRestoreOnlyOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface DestroySecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ResolvePinnedSecretVersionOptions {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly pinnedSecretVersionId: string;
  readonly expectedCredentialIdentityEpoch: number;
  readonly expectedCredentialIdentityDigest: string;
  readonly expectedProviderEndpointId: string;
  readonly now: Date;
}

export interface SecretVersionStore {
  create(options: CreateSecretVersionOptions): Promise<SecretVersionPin>;
  verify(options: VerifySecretVersionOptions): Promise<SecretVersionPin>;
  rotateActive(
    options: RotateActiveSecretVersionOptions,
  ): Promise<SecretVersionPin>;
  revoke(options: RevokeSecretVersionOptions): Promise<SecretVersionPin>;
  retireDraining(
    options: RetireDrainingSecretVersionOptions,
  ): Promise<SecretVersionPin>;
  markRestoreOnly(
    options: MarkSecretRestoreOnlyOptions,
  ): Promise<SecretVersionPin>;
  destroy(options: DestroySecretVersionOptions): Promise<SecretVersionPin>;
  resolvePinnedMetadata(
    options: ResolvePinnedSecretVersionOptions,
  ): Promise<PinnedSecretVersionMetadata>;
  rewrapEncryptedEnvelope(): Promise<never>;
}

export type SecretVersionStoreErrorCode =
  | "secret_version.invalid_argument"
  | "secret_version.not_found"
  | "secret_version.identity_conflict"
  | "secret_version.lifecycle_conflict"
  | "secret_version.pinned_unavailable"
  | "secret_version.rewrap_unsupported";

export class SecretVersionStoreError extends Error {
  public constructor(
    public readonly code: SecretVersionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecretVersionStoreError";
  }
}

interface CredentialRow extends RowDataPacket {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly id: string;
  readonly providerEndpointId: string;
  readonly providerKind: string;
  readonly identityDigest: string;
  readonly identityEpoch: number;
  readonly materialGeneration: number;
  readonly activeSecretVersionId: string | null;
  readonly lifecycleStatus: string;
  readonly version: number;
}

interface SecretRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly version: number;
  readonly materialGeneration: number;
  readonly sourceKind: SecretSourceKind;
  readonly lifecycleStatus: SecretVersionLifecycle;
  readonly materialPlaintextBase64: string | null;
  readonly materialCiphertextBase64: string | null;
  readonly materialNonceBase64: string | null;
  readonly materialAuthTagBase64: string | null;
  readonly wrappedDekBase64: string | null;
  readonly wrapNonceBase64: string | null;
  readonly wrapAuthTagBase64: string | null;
  readonly kekVersion: string | null;
  readonly aadDigest: string;
  readonly deploymentReference: string | null;
  readonly materialFingerprint: string;
  readonly formatVersion: number;
  readonly drainDeadlineAt: Date | null;
}

interface SecretSequenceRow extends RowDataPacket {
  readonly maximumVersion: number | null;
  readonly maximumGeneration: number | null;
}

function fail(code: SecretVersionStoreErrorCode, message: string): never {
  throw new SecretVersionStoreError(code, message);
}

function invalid(message: string): never {
  return fail("secret_version.invalid_argument", message);
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

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function assertBoundedAscii(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[^\x20-\x7e]/u.test(value)
  ) {
    invalid(`${label} must be bounded printable ASCII.`);
  }
}

function assertBase64(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  assertBoundedAscii(value, label, maximumLength);
  if (!base64Pattern.test(value)) {
    invalid(`${label} must be canonical base64 text.`);
  }
}

function assertCommonOptions(options: {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly expectedCredentialVersion: number;
  readonly now: Date;
}): void {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.credentialId, "credentialId");
  assertVersion(options.expectedCredentialVersion, "expectedCredentialVersion");
  assertDate(options.now, "now");
}

function assertCreateOptions(options: CreateSecretVersionOptions): void {
  assertCommonOptions(options);
  assertId(options.secretVersionId, "secretVersionId");
  assertId(options.createdByPrincipalId, "createdByPrincipalId");
  assertDigest(options.aadDigest, "aadDigest");
  assertDigest(options.materialFingerprint, "materialFingerprint");
  if (
    !Number.isSafeInteger(options.formatVersion) ||
    options.formatVersion < 1 ||
    options.formatVersion > 65_535
  ) {
    invalid("formatVersion must be a positive unsigned 16-bit integer.");
  }
  if (options.source.kind === "plaintext_database") {
    assertBase64(
      options.source.plaintext.materialPlaintextBase64,
      "materialPlaintextBase64",
      87_384,
    );
  } else if (options.source.kind === "encrypted_database") {
    const envelope = options.source.envelope;
    assertBase64(
      envelope.materialCiphertextBase64,
      "materialCiphertextBase64",
      65_536,
    );
    assertBase64(envelope.materialNonceBase64, "materialNonceBase64", 32);
    assertBase64(envelope.materialAuthTagBase64, "materialAuthTagBase64", 32);
    assertBase64(envelope.wrappedDekBase64, "wrappedDekBase64", 512);
    assertBase64(envelope.wrapNonceBase64, "wrapNonceBase64", 32);
    assertBase64(envelope.wrapAuthTagBase64, "wrapAuthTagBase64", 32);
    assertBoundedAscii(envelope.kekVersion, "kekVersion", 120);
  } else {
    assertBoundedAscii(
      options.source.deploymentReference,
      "deploymentReference",
      512,
    );
  }
}

function assertTransitionOptions(
  options:
    | VerifySecretVersionOptions
    | RevokeSecretVersionOptions
    | RetireDrainingSecretVersionOptions
    | MarkSecretRestoreOnlyOptions
    | DestroySecretVersionOptions,
): void {
  assertCommonOptions(options);
  assertId(options.secretVersionId, "secretVersionId");
}

async function inTransaction<TResult>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original domain/database failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function lockCredential(
  connection: PoolConnection,
  workspaceId: string,
  credentialId: string,
  lockMode: "share" | "update" = "update",
): Promise<CredentialRow> {
  const [rows] = await connection.execute<CredentialRow[]>(
    `SELECT
       workspace.organization_id AS organizationId,
       credential.workspace_id AS workspaceId,
       credential.id,
       credential.provider_endpoint_id AS providerEndpointId,
       credential.provider_kind AS providerKind,
       credential.identity_digest AS identityDigest,
       credential.identity_epoch AS identityEpoch,
       credential.material_generation AS materialGeneration,
       credential.active_secret_version_id AS activeSecretVersionId,
       credential.lifecycle_status AS lifecycleStatus,
       credential.version
     FROM credential
     INNER JOIN workspace
       ON workspace.id = credential.workspace_id
     WHERE credential.workspace_id = ?
       AND credential.id = ?
     LIMIT 1
     ${lockMode === "share" ? "FOR SHARE" : "FOR UPDATE"}`,
    [workspaceId, credentialId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "secret_version.not_found",
      "Credential does not exist in the requested workspace.",
    );
  }
  return row;
}

function assertCredentialVersion(
  row: CredentialRow,
  expectedVersion: number,
): void {
  if (row.version !== expectedVersion) {
    fail(
      "secret_version.identity_conflict",
      "Credential version changed before the secret command committed.",
    );
  }
}

async function findSecret(
  connection: PoolConnection,
  workspaceId: string,
  credentialId: string,
  secretVersionId: string,
  lockMode: "share" | "update" = "update",
): Promise<SecretRow | undefined> {
  const [rows] = await connection.execute<SecretRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       credential_id AS credentialId,
       version,
       material_generation AS materialGeneration,
       source_kind AS sourceKind,
       lifecycle_status AS lifecycleStatus,
       material_plaintext_base64 AS materialPlaintextBase64,
       material_ciphertext_base64 AS materialCiphertextBase64,
       material_nonce_base64 AS materialNonceBase64,
       material_auth_tag_base64 AS materialAuthTagBase64,
       wrapped_dek_base64 AS wrappedDekBase64,
       wrap_nonce_base64 AS wrapNonceBase64,
       wrap_auth_tag_base64 AS wrapAuthTagBase64,
       kek_version AS kekVersion,
       aad_digest AS aadDigest,
       deployment_reference AS deploymentReference,
       material_fingerprint AS materialFingerprint,
       format_version AS formatVersion,
       drain_deadline_at AS drainDeadlineAt
     FROM secret_version
     WHERE workspace_id = ?
       AND credential_id = ?
       AND id = ?
     LIMIT 1
     ${lockMode === "share" ? "FOR SHARE" : "FOR UPDATE"}`,
    [workspaceId, credentialId, secretVersionId],
  );
  return rows[0];
}

async function lockSecret(
  connection: PoolConnection,
  workspaceId: string,
  credentialId: string,
  secretVersionId: string,
  lockMode: "share" | "update" = "update",
): Promise<SecretRow> {
  const row = await findSecret(
    connection,
    workspaceId,
    credentialId,
    secretVersionId,
    lockMode,
  );
  if (!row) {
    return fail(
      "secret_version.not_found",
      "Secret version does not exist for the credential.",
    );
  }
  return row;
}

function pinFrom(row: SecretRow): SecretVersionPin {
  return Object.freeze({
    id: row.id,
    credentialId: row.credentialId,
    version: row.version,
    materialGeneration: row.materialGeneration,
    sourceKind: row.sourceKind,
    materialFingerprint: row.materialFingerprint,
    lifecycleStatus: row.lifecycleStatus,
    drainDeadlineAt: row.drainDeadlineAt,
  });
}

function metadataFrom(row: SecretRow): PinnedSecretVersionMetadata {
  const common = {
    id: row.id,
    workspaceId: row.workspaceId,
    credentialId: row.credentialId,
    version: row.version,
    materialGeneration: row.materialGeneration,
    lifecycleStatus: row.lifecycleStatus,
    aadDigest: row.aadDigest,
    materialFingerprint: row.materialFingerprint,
    formatVersion: row.formatVersion,
    drainDeadlineAt: row.drainDeadlineAt,
  } as const;
  if (row.sourceKind === "deployment_reference") {
    if (!row.deploymentReference) {
      return fail(
        "secret_version.pinned_unavailable",
        "Pinned deployment secret metadata is incomplete.",
      );
    }
    return Object.freeze({
      ...common,
      sourceKind: "deployment_reference",
      deploymentReference: row.deploymentReference,
    });
  }
  if (row.sourceKind === "plaintext_database") {
    if (!row.materialPlaintextBase64) {
      return fail(
        "secret_version.pinned_unavailable",
        "Pinned plaintext secret metadata is incomplete.",
      );
    }
    return Object.freeze({
      ...common,
      sourceKind: "plaintext_database",
      plaintext: Object.freeze({
        materialPlaintextBase64: row.materialPlaintextBase64,
      }),
    });
  }
  if (
    !row.materialCiphertextBase64 ||
    !row.materialNonceBase64 ||
    !row.materialAuthTagBase64 ||
    !row.wrappedDekBase64 ||
    !row.wrapNonceBase64 ||
    !row.wrapAuthTagBase64 ||
    !row.kekVersion
  ) {
    return fail(
      "secret_version.pinned_unavailable",
      "Pinned encrypted secret metadata is incomplete.",
    );
  }
  return Object.freeze({
    ...common,
    sourceKind: "encrypted_database",
    envelope: Object.freeze({
      materialCiphertextBase64: row.materialCiphertextBase64,
      materialNonceBase64: row.materialNonceBase64,
      materialAuthTagBase64: row.materialAuthTagBase64,
      wrappedDekBase64: row.wrappedDekBase64,
      wrapNonceBase64: row.wrapNonceBase64,
      wrapAuthTagBase64: row.wrapAuthTagBase64,
      kekVersion: row.kekVersion,
    }),
  });
}

function auditDecision(expectedCredentialVersion: number): AuditJsonObject {
  return {
    authorized: true,
    expectedVersion: expectedCredentialVersion,
  };
}

async function appendSecretAudit(
  connection: PoolConnection,
  credential: CredentialRow,
  context: ControlPlaneAuditContext,
  event: {
    readonly eventType: string;
    readonly action: string;
    readonly resourceId: string;
    readonly decisionReasonCode: string;
    readonly details: AuditJsonObject;
    readonly now: Date;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, context, {
    organizationId: credential.organizationId,
    workspaceId: credential.workspaceId,
    eventType: event.eventType,
    action: event.action,
    resourceType: "secret_version",
    resourceId: event.resourceId,
    outcome: "succeeded",
    decisionReasonCode: event.decisionReasonCode,
    severity:
      event.action === "revoke" || event.action === "destroy" ? "high" : "info",
    authorizationDecision: auditDecision(credential.version),
    details: event.details,
    occurredAt: event.now,
  });
}

export function secretAadDigestFor(value: {
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly providerKind: string;
  readonly formatVersion: number;
}): string {
  assertBoundedAscii(value.instanceId, "instanceId", 120);
  assertId(value.workspaceId, "workspaceId");
  assertId(value.credentialId, "credentialId");
  assertId(value.secretVersionId, "secretVersionId");
  assertBoundedAscii(value.providerKind, "providerKind", 80);
  if (
    !Number.isSafeInteger(value.formatVersion) ||
    value.formatVersion < 1 ||
    value.formatVersion > 65_535
  ) {
    invalid("formatVersion must be a positive unsigned 16-bit integer.");
  }
  return digestProviderValue({
    domain: "kanvas.secret-envelope-aad.v1",
    instanceId: value.instanceId,
    workspaceId: value.workspaceId,
    credentialId: value.credentialId,
    secretVersionId: value.secretVersionId,
    providerKind: value.providerKind,
    formatVersion: value.formatVersion,
  });
}

export async function loadPinnedSecretVersionMetadataInTransaction(
  connection: PoolConnection,
  options: ResolvePinnedSecretVersionOptions,
): Promise<PinnedSecretVersionMetadata> {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.credentialId, "credentialId");
  assertId(options.pinnedSecretVersionId, "pinnedSecretVersionId");
  assertVersion(
    options.expectedCredentialIdentityEpoch,
    "expectedCredentialIdentityEpoch",
  );
  assertDigest(
    options.expectedCredentialIdentityDigest,
    "expectedCredentialIdentityDigest",
  );
  assertId(options.expectedProviderEndpointId, "expectedProviderEndpointId");
  assertDate(options.now, "now");

  // Lock order is always Credential -> SecretVersion. Runtime preparation
  // keeps both locks shared so concurrent reads never upgrade behind each
  // other; management mutations keep using the default exclusive locks.
  const credential = await lockCredential(
    connection,
    options.workspaceId,
    options.credentialId,
    "share",
  );
  if (
    credential.lifecycleStatus !== "active" ||
    credential.identityEpoch !== options.expectedCredentialIdentityEpoch ||
    credential.identityDigest !== options.expectedCredentialIdentityDigest ||
    credential.providerEndpointId !== options.expectedProviderEndpointId
  ) {
    return fail(
      "secret_version.identity_conflict",
      "Pinned credential authority no longer matches the route snapshot.",
    );
  }
  const row = await lockSecret(
    connection,
    options.workspaceId,
    options.credentialId,
    options.pinnedSecretVersionId,
    "share",
  );
  const activeAndCurrent =
    row.lifecycleStatus === "active" &&
    credential.activeSecretVersionId === row.id &&
    credential.materialGeneration === row.materialGeneration;
  const drainingAndPinned =
    row.lifecycleStatus === "draining" &&
    credential.activeSecretVersionId !== row.id &&
    row.materialGeneration < credential.materialGeneration &&
    row.drainDeadlineAt !== null &&
    row.drainDeadlineAt.getTime() > options.now.getTime();
  const usable = activeAndCurrent || drainingAndPinned;
  if (!usable) {
    return fail(
      "secret_version.pinned_unavailable",
      "The exact pinned secret version is not dispatchable.",
    );
  }
  return metadataFrom(row);
}

/**
 * Management-only read of an exact verified secret for a Provider setting
 * that has never been activated. Runtime dispatch must continue to use
 * loadPinnedSecretVersionMetadataInTransaction: this path deliberately
 * requires a disabled Credential with no active pointer and the newest exact
 * SecretVersion in `verified` state.
 */
export async function loadVerifiedSecretVersionMetadataForManagementInTransaction(
  connection: PoolConnection,
  options: ResolvePinnedSecretVersionOptions,
): Promise<PinnedSecretVersionMetadata> {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.credentialId, "credentialId");
  assertId(options.pinnedSecretVersionId, "pinnedSecretVersionId");
  assertVersion(
    options.expectedCredentialIdentityEpoch,
    "expectedCredentialIdentityEpoch",
  );
  assertDigest(
    options.expectedCredentialIdentityDigest,
    "expectedCredentialIdentityDigest",
  );
  assertId(options.expectedProviderEndpointId, "expectedProviderEndpointId");
  assertDate(options.now, "now");

  // Keep the same Credential -> SecretVersion lock order as runtime reads and
  // secret mutations. Credential creation/rotation is serialized by this lock.
  const credential = await lockCredential(
    connection,
    options.workspaceId,
    options.credentialId,
  );
  if (
    credential.lifecycleStatus !== "disabled" ||
    credential.activeSecretVersionId !== null ||
    credential.identityEpoch !== options.expectedCredentialIdentityEpoch ||
    credential.identityDigest !== options.expectedCredentialIdentityDigest ||
    credential.providerEndpointId !== options.expectedProviderEndpointId
  ) {
    return fail(
      "secret_version.identity_conflict",
      "Verified management credential authority is unavailable.",
    );
  }
  const row = await lockSecret(
    connection,
    options.workspaceId,
    options.credentialId,
    options.pinnedSecretVersionId,
  );
  if (row.lifecycleStatus !== "verified") {
    return fail(
      "secret_version.pinned_unavailable",
      "Management use requires an exact verified secret version.",
    );
  }
  const [sequenceRows] = await connection.execute<SecretSequenceRow[]>(
    `SELECT
         MAX(version) AS maximumVersion,
         MAX(material_generation) AS maximumGeneration
       FROM secret_version
       WHERE workspace_id = ?
         AND credential_id = ?`,
    [options.workspaceId, options.credentialId],
  );
  const sequence = sequenceRows[0];
  if (
    sequence?.maximumVersion !== row.version ||
    sequence.maximumGeneration !== row.materialGeneration
  ) {
    return fail(
      "secret_version.pinned_unavailable",
      "Management use requires the newest verified secret version.",
    );
  }
  return metadataFrom(row);
}

export function createSecretVersionStore(pool: Pool): SecretVersionStore {
  return Object.freeze({
    async create(
      options: CreateSecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertCreateOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        if (
          credential.lifecycleStatus === "revoked" ||
          credential.lifecycleStatus === "replaced"
        ) {
          return fail(
            "secret_version.lifecycle_conflict",
            "A revoked or replaced credential cannot receive new material.",
          );
        }
        const existing = await findSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (existing) {
          if (
            existing.aadDigest !== options.aadDigest ||
            existing.materialFingerprint !== options.materialFingerprint ||
            existing.formatVersion !== options.formatVersion ||
            existing.sourceKind !== options.source.kind
          ) {
            return fail(
              "secret_version.identity_conflict",
              "Secret version identity was reused with different material.",
            );
          }
          return pinFrom(existing);
        }
        const [sequenceRows] = await connection.execute<SecretSequenceRow[]>(
          `SELECT
               MAX(version) AS maximumVersion,
               MAX(material_generation) AS maximumGeneration
             FROM secret_version
             WHERE credential_id = ?`,
          [options.credentialId],
        );
        const sequence = sequenceRows[0];
        const version = (sequence?.maximumVersion ?? 0) + 1;
        const materialGeneration =
          Math.max(
            sequence?.maximumGeneration ?? 0,
            credential.materialGeneration,
          ) + 1;
        if (version > 4_294_967_295 || materialGeneration > 4_294_967_295) {
          return fail(
            "secret_version.identity_conflict",
            "Secret version sequence is exhausted.",
          );
        }
        const plaintext =
          options.source.kind === "plaintext_database"
            ? options.source.plaintext
            : undefined;
        const encrypted =
          options.source.kind === "encrypted_database"
            ? options.source.envelope
            : undefined;
        await connection.execute<ResultSetHeader>(
          `INSERT INTO secret_version (
             id,
             workspace_id,
             credential_id,
             version,
             material_generation,
             source_kind,
             lifecycle_status,
             material_plaintext_base64,
             material_ciphertext_base64,
             material_nonce_base64,
             material_auth_tag_base64,
             wrapped_dek_base64,
             wrap_nonce_base64,
             wrap_auth_tag_base64,
             kek_version,
             aad_digest,
             deployment_reference,
             material_fingerprint,
             format_version,
             drain_deadline_at,
             verified_at,
             activated_at,
             retired_at,
             revoked_at,
             destroyed_at,
             created_by_principal_id,
             created_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             NULL, NULL, NULL, NULL, NULL, ?, ?
           )`,
          [
            options.secretVersionId,
            options.workspaceId,
            options.credentialId,
            version,
            materialGeneration,
            options.source.kind,
            "created",
            plaintext?.materialPlaintextBase64 ?? null,
            encrypted?.materialCiphertextBase64 ?? null,
            encrypted?.materialNonceBase64 ?? null,
            encrypted?.materialAuthTagBase64 ?? null,
            encrypted?.wrappedDekBase64 ?? null,
            encrypted?.wrapNonceBase64 ?? null,
            encrypted?.wrapAuthTagBase64 ?? null,
            encrypted?.kekVersion ?? null,
            options.aadDigest,
            options.source.kind === "deployment_reference"
              ? options.source.deploymentReference
              : null,
            options.materialFingerprint,
            options.formatVersion,
            null,
            options.createdByPrincipalId,
            options.now,
          ],
        );
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.created",
          action: "create",
          resourceId: row.id,
          decisionReasonCode: "secret_version.created",
          details: {
            sourceKind: row.sourceKind,
            lifecycleStatus: row.lifecycleStatus,
            version: row.version,
            materialGeneration: row.materialGeneration,
            formatVersion: row.formatVersion,
          },
          now: options.now,
        });
        return pinFrom(row);
      });
    },

    async verify(
      options: VerifySecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertTransitionOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (
          row.lifecycleStatus === "verified" ||
          row.lifecycleStatus === "active"
        ) {
          return pinFrom(row);
        }
        if (row.lifecycleStatus !== "created") {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only a created secret version can be verified.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
           SET lifecycle_status = 'verified',
               verified_at = ?
           WHERE workspace_id = ?
             AND credential_id = ?
             AND id = ?
             AND lifecycle_status = 'created'`,
          [
            options.now,
            options.workspaceId,
            options.credentialId,
            options.secretVersionId,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Secret verification lost its compare-and-swap.",
          );
        }
        const verified = {
          ...row,
          lifecycleStatus: "verified" as const,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.verified",
          action: "verify",
          resourceId: row.id,
          decisionReasonCode: "secret_version.verified",
          details: {
            lifecycleStatus: "verified",
            version: row.version,
            materialGeneration: row.materialGeneration,
          },
          now: options.now,
        });
        return pinFrom(verified);
      });
    },

    async rotateActive(
      options: RotateActiveSecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertCommonOptions(options);
      assertId(options.candidateSecretVersionId, "candidateSecretVersionId");
      assertDate(options.previousDrainDeadlineAt, "previousDrainDeadlineAt");
      if (options.previousDrainDeadlineAt.getTime() <= options.now.getTime()) {
        invalid("previousDrainDeadlineAt must be after now.");
      }
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        if (credential.lifecycleStatus !== "active") {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only an active credential can rotate material.",
          );
        }
        const [rows] = await connection.execute<SecretRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             credential_id AS credentialId,
             version,
             material_generation AS materialGeneration,
             source_kind AS sourceKind,
             lifecycle_status AS lifecycleStatus,
             material_plaintext_base64 AS materialPlaintextBase64,
             material_ciphertext_base64 AS materialCiphertextBase64,
             material_nonce_base64 AS materialNonceBase64,
             material_auth_tag_base64 AS materialAuthTagBase64,
             wrapped_dek_base64 AS wrappedDekBase64,
             wrap_nonce_base64 AS wrapNonceBase64,
             wrap_auth_tag_base64 AS wrapAuthTagBase64,
             kek_version AS kekVersion,
             aad_digest AS aadDigest,
             deployment_reference AS deploymentReference,
             material_fingerprint AS materialFingerprint,
             format_version AS formatVersion,
             drain_deadline_at AS drainDeadlineAt
           FROM secret_version
           WHERE workspace_id = ?
             AND credential_id = ?
             AND (
               id = ?
               OR id = ?
             )
           ORDER BY id
           FOR UPDATE`,
          [
            options.workspaceId,
            options.credentialId,
            options.candidateSecretVersionId,
            credential.activeSecretVersionId ??
              options.candidateSecretVersionId,
          ],
        );
        const candidate = rows.find(
          (row) => row.id === options.candidateSecretVersionId,
        );
        if (!candidate) {
          return fail(
            "secret_version.not_found",
            "Rotation candidate does not exist.",
          );
        }
        if (
          candidate.lifecycleStatus === "active" &&
          credential.activeSecretVersionId === candidate.id
        ) {
          return pinFrom(candidate);
        }
        if (candidate.lifecycleStatus !== "verified") {
          return fail(
            "secret_version.lifecycle_conflict",
            "Rotation candidate must be verified.",
          );
        }
        const previous = credential.activeSecretVersionId
          ? rows.find((row) => row.id === credential.activeSecretVersionId)
          : undefined;
        if (
          credential.activeSecretVersionId &&
          (!previous || previous.lifecycleStatus !== "active")
        ) {
          return fail(
            "secret_version.identity_conflict",
            "Credential active pointer is inconsistent.",
          );
        }
        if (candidate.materialGeneration <= credential.materialGeneration) {
          return fail(
            "secret_version.identity_conflict",
            "Rotation candidate material generation is stale.",
          );
        }
        if (previous) {
          const [previousResult] = await connection.execute<ResultSetHeader>(
            `UPDATE secret_version
               SET lifecycle_status = 'draining',
                   drain_deadline_at = ?,
                   retired_at = NULL
               WHERE workspace_id = ?
                 AND credential_id = ?
                 AND id = ?
                 AND lifecycle_status = 'active'`,
            [
              options.previousDrainDeadlineAt,
              options.workspaceId,
              options.credentialId,
              previous.id,
            ],
          );
          if (previousResult.affectedRows !== 1) {
            return fail(
              "secret_version.identity_conflict",
              "Previous active secret lost its compare-and-swap.",
            );
          }
        }
        const [candidateResult] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
             SET lifecycle_status = 'active',
                 activated_at = ?
             WHERE workspace_id = ?
               AND credential_id = ?
               AND id = ?
               AND lifecycle_status = 'verified'`,
          [
            options.now,
            options.workspaceId,
            options.credentialId,
            candidate.id,
          ],
        );
        if (candidateResult.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Rotation candidate lost its compare-and-swap.",
          );
        }
        const [credentialResult] = await connection.execute<ResultSetHeader>(
          `UPDATE credential
             SET active_secret_version_id = ?,
                 material_generation = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = 'active'
               AND active_secret_version_id <=> ?`,
          [
            candidate.id,
            candidate.materialGeneration,
            options.now,
            options.workspaceId,
            options.credentialId,
            options.expectedCredentialVersion,
            credential.activeSecretVersionId,
          ],
        );
        if (credentialResult.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Credential rotation lost its compare-and-swap.",
          );
        }
        const activated = {
          ...candidate,
          lifecycleStatus: "active" as const,
          drainDeadlineAt: null,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.rotated",
          action: "rotate",
          resourceId: candidate.id,
          decisionReasonCode: "secret_version.rotated",
          details: {
            lifecycleStatus: "active",
            version: candidate.version,
            materialGeneration: candidate.materialGeneration,
            previousMode: previous ? "draining" : "none",
          },
          now: options.now,
        });
        return pinFrom(activated);
      });
    },

    async revoke(
      options: RevokeSecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertTransitionOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (
          row.lifecycleStatus !== "active" &&
          row.lifecycleStatus !== "draining"
        ) {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only active or draining material can be revoked.",
          );
        }
        const isCurrent = credential.activeSecretVersionId === row.id;
        const [secretResult] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
             SET lifecycle_status = 'revoked',
                 drain_deadline_at = NULL,
                 revoked_at = ?
             WHERE workspace_id = ?
               AND credential_id = ?
               AND id = ?
               AND lifecycle_status = ?`,
          [
            options.now,
            options.workspaceId,
            options.credentialId,
            row.id,
            row.lifecycleStatus,
          ],
        );
        if (secretResult.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Secret revocation lost its compare-and-swap.",
          );
        }
        if (isCurrent) {
          const [credentialResult] = await connection.execute<ResultSetHeader>(
            `UPDATE credential
               SET active_secret_version_id = NULL,
                   version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ?
                 AND id = ?
                 AND version = ?
                 AND active_secret_version_id = ?`,
            [
              options.now,
              options.workspaceId,
              options.credentialId,
              options.expectedCredentialVersion,
              row.id,
            ],
          );
          if (credentialResult.affectedRows !== 1) {
            return fail(
              "secret_version.identity_conflict",
              "Credential revoke lost its compare-and-swap.",
            );
          }
        }
        const revoked = {
          ...row,
          lifecycleStatus: "revoked" as const,
          drainDeadlineAt: null,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.revoked",
          action: "revoke",
          resourceId: row.id,
          decisionReasonCode: "secret_version.revoked",
          details: {
            lifecycleStatus: "revoked",
            version: row.version,
            materialGeneration: row.materialGeneration,
            currentPointerCleared: isCurrent,
          },
          now: options.now,
        });
        return pinFrom(revoked);
      });
    },

    async retireDraining(
      options: RetireDrainingSecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertTransitionOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (
          row.lifecycleStatus !== "draining" ||
          !row.drainDeadlineAt ||
          row.drainDeadlineAt.getTime() > options.now.getTime()
        ) {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only an expired draining secret can be retired.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
           SET lifecycle_status = 'retired',
               drain_deadline_at = NULL,
               retired_at = ?
           WHERE workspace_id = ?
             AND credential_id = ?
             AND id = ?
             AND lifecycle_status = 'draining'
             AND drain_deadline_at <= ?`,
          [
            options.now,
            options.workspaceId,
            options.credentialId,
            row.id,
            options.now,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Secret retirement lost its compare-and-swap.",
          );
        }
        const retired = {
          ...row,
          lifecycleStatus: "retired" as const,
          drainDeadlineAt: null,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.retired",
          action: "retire",
          resourceId: row.id,
          decisionReasonCode: "secret_version.retired",
          details: {
            lifecycleStatus: "retired",
            version: row.version,
            materialGeneration: row.materialGeneration,
          },
          now: options.now,
        });
        return pinFrom(retired);
      });
    },

    async markRestoreOnly(
      options: MarkSecretRestoreOnlyOptions,
    ): Promise<SecretVersionPin> {
      assertTransitionOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (row.lifecycleStatus !== "revoked") {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only revoked material can become restore-only.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
           SET lifecycle_status = 'restore_only'
           WHERE workspace_id = ?
             AND credential_id = ?
             AND id = ?
             AND lifecycle_status = 'revoked'`,
          [options.workspaceId, options.credentialId, row.id],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Restore-only transition lost its compare-and-swap.",
          );
        }
        const restoreOnly = {
          ...row,
          lifecycleStatus: "restore_only" as const,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.restore_only",
          action: "restore_only",
          resourceId: row.id,
          decisionReasonCode: "secret_version.restore_only",
          details: {
            lifecycleStatus: "restore_only",
            version: row.version,
            materialGeneration: row.materialGeneration,
          },
          now: options.now,
        });
        return pinFrom(restoreOnly);
      });
    },

    async destroy(
      options: DestroySecretVersionOptions,
    ): Promise<SecretVersionPin> {
      assertTransitionOptions(options);
      return inTransaction(pool, async (connection) => {
        const credential = await lockCredential(
          connection,
          options.workspaceId,
          options.credentialId,
        );
        assertCredentialVersion(credential, options.expectedCredentialVersion);
        const row = await lockSecret(
          connection,
          options.workspaceId,
          options.credentialId,
          options.secretVersionId,
        );
        if (
          row.lifecycleStatus !== "created" &&
          row.lifecycleStatus !== "verified" &&
          row.lifecycleStatus !== "retired"
        ) {
          return fail(
            "secret_version.lifecycle_conflict",
            "Only created, verified, or retired material can be destroyed.",
          );
        }
        if (credential.activeSecretVersionId === row.id) {
          return fail(
            "secret_version.identity_conflict",
            "The current active pointer cannot be destroyed.",
          );
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE secret_version
           SET lifecycle_status = 'destroyed',
               material_plaintext_base64 = NULL,
               material_ciphertext_base64 = NULL,
               material_nonce_base64 = NULL,
               material_auth_tag_base64 = NULL,
               wrapped_dek_base64 = NULL,
               wrap_nonce_base64 = NULL,
               wrap_auth_tag_base64 = NULL,
               kek_version = NULL,
               deployment_reference = NULL,
               destroyed_at = ?
           WHERE workspace_id = ?
             AND credential_id = ?
             AND id = ?
             AND lifecycle_status = ?`,
          [
            options.now,
            options.workspaceId,
            options.credentialId,
            row.id,
            row.lifecycleStatus,
          ],
        );
        if (result.affectedRows !== 1) {
          return fail(
            "secret_version.identity_conflict",
            "Secret destruction lost its compare-and-swap.",
          );
        }
        const destroyed = {
          ...row,
          lifecycleStatus: "destroyed" as const,
          materialPlaintextBase64: null,
          materialCiphertextBase64: null,
          materialNonceBase64: null,
          materialAuthTagBase64: null,
          wrappedDekBase64: null,
          wrapNonceBase64: null,
          wrapAuthTagBase64: null,
          kekVersion: null,
          deploymentReference: null,
        };
        await appendSecretAudit(connection, credential, options.audit, {
          eventType: "secret_version.destroyed",
          action: "destroy",
          resourceId: row.id,
          decisionReasonCode: "secret_version.destroyed",
          details: {
            lifecycleStatus: "destroyed",
            version: row.version,
            materialGeneration: row.materialGeneration,
            materialErased: true,
          },
          now: options.now,
        });
        return pinFrom(destroyed);
      });
    },

    async resolvePinnedMetadata(
      options: ResolvePinnedSecretVersionOptions,
    ): Promise<PinnedSecretVersionMetadata> {
      return inTransaction(pool, (connection) =>
        loadPinnedSecretVersionMetadataInTransaction(connection, options),
      );
    },

    rewrapEncryptedEnvelope(): Promise<never> {
      return Promise.reject(
        new SecretVersionStoreError(
          "secret_version.rewrap_unsupported",
          "Controlled KEK rewrap is intentionally unsupported in V0.",
        ),
      );
    },
  });
}
