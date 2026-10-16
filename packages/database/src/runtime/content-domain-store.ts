import { createHash } from "node:crypto";

import {
  authorizationModelVersion,
  type TrustedWorkspaceScope,
  type WorkspacePermissionId,
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
  type AuditJsonObject,
} from "./audit-event-store.js";
import {
  AuthorizationStoreError,
  revalidateTrustedWorkspaceScopeInTransaction,
} from "./authorization-store.js";
import { privateConversationArtifactOwner } from "./conversation-artifact-privacy.js";

export type ContentDataClassification =
  "internal" | "confidential" | "restricted";
export type AssetLifecycleStatus = "active" | "archived";
export type ArtifactEdgeRelation =
  "derived_from" | "supersedes" | "composed_from" | "generated_from";
export type AssetRelation =
  | "variant_of"
  | "template_of"
  | "related_to"
  | "channel_version_of"
  | "language_version_of";
export type ArtifactReferenceTarget =
  | {
      readonly type: "workflow_run";
      readonly id: string;
    }
  | {
      readonly type: "asset";
      readonly id: string;
    };

export interface ContentCommandAuditContext {
  readonly auditEventId: string;
  /**
   * Domain-separated digest produced by the Authentication Adapter. Raw
   * Session or Service Token references must not cross the Audit boundary.
   */
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface ContentDomainAuditEvent {
  readonly id: string;
  readonly scope: TrustedWorkspaceScope;
  readonly authenticationRefHash: string;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly decisionReasonCode: string;
  readonly severity: "info" | "warning" | "high" | "critical";
  readonly requestId?: string;
  readonly traceId?: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

/**
 * Narrow adapter until the identity package exposes its generic
 * transaction-bound audit writer. Implementations must use the supplied
 * connection and must never open or commit an independent transaction.
 */
export interface ContentDomainAuditPort {
  appendInTransaction(
    connection: PoolConnection,
    event: ContentDomainAuditEvent,
  ): Promise<void>;
}

interface CommandAuthority {
  readonly authority: TrustedWorkspaceScope;
}

export type InitialAssetArtifact =
  | {
      readonly kind: "adopt";
      readonly artifactId: string;
    }
  | {
      readonly kind: "structured";
      readonly artifactId: string;
      readonly artifactType: string;
      readonly structuredContent: Readonly<Record<string, unknown>>;
      readonly contentDigest: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly dataClassification?: ContentDataClassification;
    };

export interface ArtifactAdoptionTarget {
  readonly kind: "asset";
  readonly assetId: string;
}

export type StructuredArtifactTarget =
  | {
      readonly kind: "workspace";
    }
  | ArtifactAdoptionTarget;

export interface CreateAssetOptions extends CommandAuthority {
  readonly assetId: string;
  readonly assetKey: string;
  readonly name: string;
  readonly assetType: string;
  readonly initialArtifact?: InitialAssetArtifact;
  readonly now: Date;
}

export interface AdoptArtifactOptions extends CommandAuthority {
  readonly artifactId: string;
  readonly target: ArtifactAdoptionTarget;
  readonly now: Date;
}

export interface CreateStructuredArtifactOptions extends CommandAuthority {
  readonly artifactId: string;
  readonly artifactType: string;
  readonly structuredContent: Readonly<Record<string, unknown>>;
  readonly contentDigest: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly dataClassification?: ContentDataClassification;
  readonly target: StructuredArtifactTarget;
  readonly now: Date;
}

export interface AssetMutationResult {
  readonly status: "created" | "existing";
  readonly assetId: string;
  readonly version: number;
  readonly artifactId?: string;
}

export interface ArtifactOwnershipMutationResult {
  readonly status: "created" | "adopted" | "existing";
  readonly artifactId: string;
  readonly assetId: string | null;
}

export interface AddArtifactEdgeOptions extends CommandAuthority {
  readonly edgeId: string;
  readonly sourceArtifactId: string;
  readonly targetArtifactId: string;
  readonly relation: ArtifactEdgeRelation;
  readonly now: Date;
}

export interface AppendIdentityResult {
  readonly status: "created" | "existing";
  readonly id: string;
}

export interface SelectCurrentArtifactOptions extends CommandAuthority {
  readonly assetId: string;
  readonly artifactId: string;
  readonly expectedAssetVersion: number;
  readonly audit: ContentCommandAuditContext;
  readonly now: Date;
}

export interface CurrentArtifactSelectionResult {
  readonly assetId: string;
  readonly artifactId: string;
  readonly version: number;
}

export interface AddAssetRelationOptions extends CommandAuthority {
  readonly relationId: string;
  readonly sourceAssetId: string;
  readonly targetAssetId: string;
  readonly relation: AssetRelation;
  readonly now: Date;
}

export interface AddArtifactReferenceOptions extends CommandAuthority {
  readonly referenceId: string;
  readonly artifactId: string;
  readonly referenceRole: string;
  readonly target: ArtifactReferenceTarget;
  readonly now: Date;
}

export interface ContentDomainStore {
  createAsset(options: CreateAssetOptions): Promise<AssetMutationResult>;
  adoptArtifact(
    options: AdoptArtifactOptions,
  ): Promise<ArtifactOwnershipMutationResult>;
  createStructuredArtifact(
    options: CreateStructuredArtifactOptions,
  ): Promise<ArtifactOwnershipMutationResult>;
  addArtifactEdge(
    options: AddArtifactEdgeOptions,
  ): Promise<AppendIdentityResult>;
  selectCurrentArtifact(
    options: SelectCurrentArtifactOptions,
  ): Promise<CurrentArtifactSelectionResult>;
  addAssetRelation(
    options: AddAssetRelationOptions,
  ): Promise<AppendIdentityResult>;
  addArtifactReference(
    options: AddArtifactReferenceOptions,
  ): Promise<AppendIdentityResult>;
}

export type ContentDomainStoreErrorCode =
  | "content_domain.invalid_argument"
  | "content_domain.forbidden"
  | "content_domain.not_found"
  | "content_domain.identity_conflict"
  | "content_domain.state_conflict"
  | "content_domain.artifact_unavailable"
  | "content_domain.lineage_cycle";

export class ContentDomainStoreError extends Error {
  public constructor(
    public readonly code: ContentDomainStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContentDomainStoreError";
  }
}

export interface CreateContentDomainStoreOptions {
  /**
   * Test seam for proving that an Audit failure rolls the domain mutation
   * back. Production callers use the generic transaction-bound Audit writer.
   */
  readonly auditPort?: ContentDomainAuditPort;
}

interface WorkspaceRow extends RowDataPacket {
  readonly id: string;
  readonly organizationId: string;
  readonly status: string;
}

interface AssetRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly assetKey: string;
  readonly name: string;
  readonly assetType: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly currentArtifactId: string | null;
  readonly version: number;
  readonly createdByPrincipalId: string;
}

interface ArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly assetId: string | null;
  readonly createdByCapabilityRunId: string | null;
  readonly createdByPrincipalId: string | null;
  readonly storedObjectId: string | null;
  readonly structuredContent: unknown;
  readonly contentDigest: string;
  readonly artifactType: string;
  readonly availabilityStatus: string;
  readonly dataClassification: string;
  readonly metadata: unknown;
}

interface ConversationArtifactOwnerRow extends RowDataPacket {
  readonly assetId: string | null;
  readonly createdByPrincipalId: string | null;
  readonly createdByCapabilityPrincipalId: string | null;
  readonly capabilityInvocationKind: string | null;
  readonly createdByWorkflowPrincipalId: string | null;
  readonly workflowIdempotencyKey: string | null;
  readonly metadata: unknown;
}

interface ArtifactEdgeRow extends RowDataPacket {
  readonly id: string;
  readonly sourceArtifactId: string;
  readonly targetArtifactId: string;
  readonly relation: ArtifactEdgeRelation;
}

interface ReachabilityRow extends RowDataPacket {
  readonly artifactId: string;
}

interface AssetRelationRow extends RowDataPacket {
  readonly id: string;
  readonly sourceAssetId: string;
  readonly targetAssetId: string;
  readonly relation: AssetRelation;
}

interface ArtifactReferenceRow extends RowDataPacket {
  readonly id: string;
  readonly artifactId: string;
  readonly referenceRole: string;
  readonly targetType: ArtifactReferenceTarget["type"];
  readonly targetId: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const asciiFactPattern = /^[\x21-\x7e]+$/u;
const secretLikeAuditKeyPattern =
  /(token|secret|password|credential|authorization|cookie|session|email)/iu;
const artifactEdgeRelations = new Set<ArtifactEdgeRelation>([
  "derived_from",
  "supersedes",
  "composed_from",
  "generated_from",
]);
const assetRelations = new Set<AssetRelation>([
  "variant_of",
  "template_of",
  "related_to",
  "channel_version_of",
  "language_version_of",
]);
const maximumJsonDepth = 64;
const maximumJsonNodes = 20_000;
const maximumJsonBytes = 1_048_576;

function fail(code: ContentDomainStoreErrorCode, message: string): never {
  throw new ContentDomainStoreError(code, message);
}

function invalid(message: string): never {
  return fail("content_domain.invalid_argument", message);
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

function assertUint32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4_294_967_295
  ) {
    invalid(`${label} must be a positive unsigned 32-bit integer.`);
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
    [...value].length > maximumLength ||
    value !== value.trim() ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalid(`${label} must be bounded text without control characters.`);
  }
}

function assertAsciiFact(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    !asciiFactPattern.test(value)
  ) {
    invalid(`${label} must be bounded printable ASCII.`);
  }
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

interface JsonTraversalBudget {
  nodes: number;
}

function consumeJsonNode(budget: JsonTraversalBudget, path: string): void {
  budget.nodes += 1;
  if (budget.nodes > maximumJsonNodes) {
    invalid(`${path} exceeds the JSON node limit.`);
  }
}

function ownDataDescriptors(
  value: object,
  path: string,
): Readonly<Record<string, PropertyDescriptor>> {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) {
    invalid(`${path} cannot contain symbol keys.`);
  }
  const descriptors: Record<string, PropertyDescriptor> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      invalid(`${path}[${JSON.stringify(key)}] cannot be an accessor.`);
    }
    descriptors[key] = descriptor;
  }
  return descriptors;
}

function canonicalizeJsonValue(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  budget: JsonTraversalBudget,
): string {
  if (depth > maximumJsonDepth) {
    return invalid(`${path} exceeds the JSON nesting limit.`);
  }
  consumeJsonNode(budget, path);
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalid(`${path} contains a non-finite number.`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return invalid(`${path} contains an unsupported JSON value.`);
  }
  if (ancestors.has(value)) {
    return invalid(`${path} contains a cycle.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    return invalid(`${path} must contain only plain JSON values.`);
  }
  ancestors.add(value);
  try {
    const descriptors = ownDataDescriptors(value, path);
    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || typeof lengthDescriptor.value !== "number") {
        return invalid(`${path} has an invalid array length.`);
      }
      const length = lengthDescriptor.value;
      for (const key of Object.keys(descriptors)) {
        if (key === "length") {
          continue;
        }
        if (
          !/^(0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= length ||
          descriptors[key]?.enumerable !== true
        ) {
          return invalid(`${path} contains a non-JSON array property.`);
        }
      }
      const items: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          return invalid(`${path}[${String(index)}] cannot be sparse.`);
        }
        items.push(
          canonicalizeJsonValue(
            descriptor.value,
            `${path}[${String(index)}]`,
            depth + 1,
            ancestors,
            budget,
          ),
        );
      }
      return `[${items.join(",")}]`;
    }
    const keys = Object.keys(descriptors).sort(compareCanonicalText);
    const fields: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) {
        return invalid(`${path}[${JSON.stringify(key)}] must be enumerable.`);
      }
      if ([...key].length > 500) {
        return invalid(`${path} contains an oversized JSON key.`);
      }
      fields.push(
        `${JSON.stringify(key)}:${canonicalizeJsonValue(
          descriptor.value,
          `${path}[${JSON.stringify(key)}]`,
          depth + 1,
          ancestors,
          budget,
        )}`,
      );
    }
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJsonObject(
  value: unknown,
  label: string,
): {
  readonly text: string;
  readonly digest: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${label} must be a plain JSON object.`);
  }
  const text = canonicalizeJsonValue(value, label, 0, new WeakSet<object>(), {
    nodes: 0,
  });
  if (Buffer.byteLength(text, "utf8") > maximumJsonBytes) {
    return invalid(`${label} exceeds the canonical JSON byte limit.`);
  }
  return Object.freeze({
    text,
    digest: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
  });
}

function inspectAuditKeys(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (ancestors.has(value)) {
    return invalid(`${path} contains a cycle.`);
  }
  ancestors.add(value);
  try {
    const descriptors = ownDataDescriptors(value, path);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key !== "length" && secretLikeAuditKeyPattern.test(key)) {
        return invalid(
          `${path} contains prohibited secret-like audit detail key ${key}.`,
        );
      }
      if (key !== "length") {
        inspectAuditKeys(
          descriptor.value,
          `${path}[${JSON.stringify(key)}]`,
          ancestors,
        );
      }
    }
  } finally {
    ancestors.delete(value);
  }
}

export function assertContentDomainAuditDetailsSafe(
  value: Readonly<Record<string, unknown>>,
): void {
  canonicalJsonObject(value, "audit.details");
  inspectAuditKeys(value, "audit.details", new WeakSet<object>());
}

function assertAuditContext(context: ContentCommandAuditContext): void {
  assertId(context.auditEventId, "audit.auditEventId");
  assertDigest(context.authenticationRefHash, "audit.authenticationRefHash");
  if (context.requestId !== undefined) {
    assertAsciiFact(context.requestId, "audit.requestId", 120);
  }
  if (context.traceId !== undefined) {
    assertAsciiFact(context.traceId, "audit.traceId", 120);
  }
}

function assertAuthorityShape(authority: TrustedWorkspaceScope): void {
  if (
    authority.trusted !== true ||
    authority.authorizationModelVersion !== authorizationModelVersion
  ) {
    return fail(
      "content_domain.forbidden",
      "Command authority is not a current trusted Workspace scope.",
    );
  }
  assertId(authority.workspaceId, "authority.workspaceId");
  assertId(authority.organizationId, "authority.organizationId");
  assertId(authority.principalId, "authority.principalId");
  assertId(authority.authorityId, "authority.authorityId");
  assertUint32(authority.authorityVersion, "authority.authorityVersion");
  if (authority.principalType === "human") {
    if (
      authority.authenticationRefType !== "session" ||
      authority.authorityType !== "human_membership"
    ) {
      return fail(
        "content_domain.forbidden",
        "Human Workspace authority has an invalid shape.",
      );
    }
    assertBoundedText(
      authority.authenticationRefId,
      "authority.authenticationRefId",
      240,
    );
  } else {
    if (
      authority.authenticationRefType !== "service_api_token" ||
      authority.authorityType !== "service_grant"
    ) {
      return fail(
        "content_domain.forbidden",
        "Service Workspace authority has an invalid shape.",
      );
    }
    assertId(authority.authenticationRefId, "authority.authenticationRefId");
  }
}

function assertPermission(
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
): void {
  assertAuthorityShape(authority);
  if (!authority.effectivePermissions.includes(permission)) {
    fail(
      "content_domain.forbidden",
      `Command authority is missing ${permission}.`,
    );
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

async function lockWorkspace(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
  now: Date,
): Promise<WorkspaceRow> {
  assertPermission(authority, permission);
  const [rows] = await connection.execute<WorkspaceRow[]>(
    `SELECT
       id,
       organization_id AS organizationId,
       status
     FROM workspace
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [authority.workspaceId],
  );
  const workspace = rows[0];
  if (!workspace) {
    return fail("content_domain.not_found", "Workspace does not exist.");
  }
  if (
    workspace.organizationId !== authority.organizationId ||
    workspace.status !== "active"
  ) {
    return fail(
      "content_domain.forbidden",
      "Workspace authority is stale or inactive.",
    );
  }
  try {
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      authority,
      permission,
      now,
    );
  } catch (error) {
    if (error instanceof AuthorizationStoreError) {
      return fail(
        "content_domain.forbidden",
        "Workspace authority is stale or no longer authorized.",
      );
    }
    throw error;
  }
  return workspace;
}

async function appendAudit(
  connection: PoolConnection,
  auditPort: ContentDomainAuditPort,
  authority: TrustedWorkspaceScope,
  audit: ContentCommandAuditContext,
  event: Omit<
    ContentDomainAuditEvent,
    "id" | "scope" | "authenticationRefHash" | "requestId" | "traceId"
  >,
): Promise<void> {
  assertAuditContext(audit);
  assertContentDomainAuditDetailsSafe(event.details);
  await auditPort.appendInTransaction(connection, {
    ...event,
    id: audit.auditEventId,
    scope: authority,
    authenticationRefHash: audit.authenticationRefHash,
    ...(audit.requestId ? { requestId: audit.requestId } : {}),
    ...(audit.traceId ? { traceId: audit.traceId } : {}),
  });
}

const genericContentDomainAuditPort: ContentDomainAuditPort = Object.freeze({
  async appendInTransaction(
    connection: PoolConnection,
    event: ContentDomainAuditEvent,
  ): Promise<void> {
    const scope = event.scope;
    await appendAuditEventInTransaction(connection, {
      id: event.id,
      schemaVersion: auditEventSchemaVersion,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      actorPrincipalId: scope.principalId,
      actorType: scope.principalType,
      authenticationRefType: scope.authenticationRefType,
      authenticationRefHash: event.authenticationRefHash,
      authorityType: scope.authorityType,
      authorityId: scope.authorityId,
      authorityVersion: scope.authorityVersion,
      authorizationModelVersion: scope.authorizationModelVersion,
      authorizationDecision: Object.freeze({
        action: event.action,
        authorityId: scope.authorityId,
        authorityType: scope.authorityType,
        authorityVersion: scope.authorityVersion,
        modelVersion: scope.authorizationModelVersion,
        outcome: "succeeded",
        reasonCode: event.decisionReasonCode,
      }),
      eventType: event.eventType,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: "succeeded",
      decisionReasonCode: event.decisionReasonCode,
      severity: event.severity,
      requestId: event.requestId ?? null,
      traceId: event.traceId ?? null,
      details: event.details as AuditJsonObject,
      occurredAt: event.occurredAt,
      recordedAt: event.occurredAt,
    });
  },
});

const dataClassifications = new Set<ContentDataClassification>([
  "internal",
  "confidential",
  "restricted",
]);

function assertCommandBase(
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
  now: Date,
): void {
  assertPermission(authority, permission);
  assertDate(now, "now");
}

function assertDataClassification(value: ContentDataClassification): void {
  if (!dataClassifications.has(value)) {
    invalid("Data classification is invalid.");
  }
}

function validateCreateAsset(options: CreateAssetOptions): {
  readonly structuredContentText?: string;
  readonly metadataText?: string;
} {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.assetId, "assetId");
  assertAsciiFact(options.assetKey, "assetKey", 160);
  assertBoundedText(options.name, "name", 240);
  assertAsciiFact(options.assetType, "assetType", 120);
  if (!options.initialArtifact) {
    return {};
  }
  assertId(options.initialArtifact.artifactId, "initialArtifact.artifactId");
  if (options.initialArtifact.kind === "adopt") {
    return {};
  }
  assertAsciiFact(
    options.initialArtifact.artifactType,
    "initialArtifact.artifactType",
    120,
  );
  assertDigest(
    options.initialArtifact.contentDigest,
    "initialArtifact.contentDigest",
  );
  const content = canonicalJsonObject(
    options.initialArtifact.structuredContent,
    "initialArtifact.structuredContent",
  );
  if (content.digest !== options.initialArtifact.contentDigest) {
    invalid(
      "Structured Artifact contentDigest does not match canonical content.",
    );
  }
  const metadata = canonicalJsonObject(
    options.initialArtifact.metadata ?? {},
    "initialArtifact.metadata",
  );
  assertDataClassification(
    options.initialArtifact.dataClassification ?? "internal",
  );
  return Object.freeze({
    structuredContentText: content.text,
    metadataText: metadata.text,
  });
}

function validateArtifactTarget(target: StructuredArtifactTarget): void {
  switch (target.kind) {
    case "workspace":
      return;
    case "asset":
      assertId(target.assetId, "target.assetId");
  }
}

function validateAdoptArtifact(options: AdoptArtifactOptions): void {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.artifactId, "artifactId");
  validateArtifactTarget(options.target);
}

function validateCreateStructuredArtifact(
  options: CreateStructuredArtifactOptions,
): {
  readonly structuredContentText: string;
  readonly metadataText: string;
} {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.artifactId, "artifactId");
  assertAsciiFact(options.artifactType, "artifactType", 120);
  assertDigest(options.contentDigest, "contentDigest");
  validateArtifactTarget(options.target);
  assertDataClassification(options.dataClassification ?? "internal");
  const content = canonicalJsonObject(
    options.structuredContent,
    "structuredContent",
  );
  if (content.digest !== options.contentDigest) {
    invalid("contentDigest does not match canonical structuredContent.");
  }
  const metadata = canonicalJsonObject(options.metadata ?? {}, "metadata");
  return Object.freeze({
    structuredContentText: content.text,
    metadataText: metadata.text,
  });
}

function validateArtifactEdge(options: AddArtifactEdgeOptions): void {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.edgeId, "edgeId");
  assertId(options.sourceArtifactId, "sourceArtifactId");
  assertId(options.targetArtifactId, "targetArtifactId");
  if (options.sourceArtifactId === options.targetArtifactId) {
    invalid("Artifact lineage cannot self-reference.");
  }
  if (!artifactEdgeRelations.has(options.relation)) {
    invalid("Artifact edge relation is invalid.");
  }
}

function validateCurrentSelection(options: SelectCurrentArtifactOptions): void {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.assetId, "assetId");
  assertId(options.artifactId, "artifactId");
  assertUint32(options.expectedAssetVersion, "expectedAssetVersion");
  assertAuditContext(options.audit);
}

async function findAssetByIdentity(
  connection: PoolConnection,
  workspaceId: string,
  assetId: string,
  assetKey: string,
): Promise<readonly AssetRow[]> {
  const [rows] = await connection.execute<AssetRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       asset_key AS assetKey,
       name,
       asset_type AS assetType,
       lifecycle_status AS lifecycleStatus,
       current_artifact_id AS currentArtifactId,
       version,
       created_by_principal_id AS createdByPrincipalId
     FROM asset
     WHERE workspace_id = ?
       AND (id = ? OR asset_key = ?)
     ORDER BY id
     FOR UPDATE`,
    [workspaceId, assetId, assetKey],
  );
  return rows;
}

async function lockAsset(
  connection: PoolConnection,
  workspaceId: string,
  assetId: string,
): Promise<AssetRow> {
  const [rows] = await connection.execute<AssetRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       asset_key AS assetKey,
       name,
       asset_type AS assetType,
       lifecycle_status AS lifecycleStatus,
       current_artifact_id AS currentArtifactId,
       version,
       created_by_principal_id AS createdByPrincipalId
     FROM asset
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, assetId],
  );
  const asset = rows[0];
  if (!asset) {
    return fail(
      "content_domain.not_found",
      "Asset does not exist in the Workspace.",
    );
  }
  return asset;
}

async function findArtifactForUpdate(
  connection: PoolConnection,
  workspaceId: string,
  artifactId: string,
): Promise<ArtifactRow | undefined> {
  const [rows] = await connection.execute<ArtifactRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       asset_id AS assetId,
       created_by_capability_run_id AS createdByCapabilityRunId,
       created_by_principal_id AS createdByPrincipalId,
       stored_object_id AS storedObjectId,
       structured_content AS structuredContent,
       content_digest AS contentDigest,
       artifact_type AS artifactType,
       availability_status AS availabilityStatus,
       data_classification AS dataClassification,
       metadata
     FROM artifact
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, artifactId],
  );
  return rows[0];
}

async function lockArtifact(
  connection: PoolConnection,
  workspaceId: string,
  artifactId: string,
): Promise<ArtifactRow> {
  const artifact = await findArtifactForUpdate(
    connection,
    workspaceId,
    artifactId,
  );
  if (!artifact) {
    return fail(
      "content_domain.not_found",
      "Artifact does not exist in the Workspace.",
    );
  }
  return artifact;
}

async function assertConversationArtifactAdoptionAuthority(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  artifactId: string,
): Promise<void> {
  const [rows] = await connection.execute<ConversationArtifactOwnerRow[]>(
    `SELECT
       artifact.asset_id AS assetId,
       artifact.created_by_principal_id AS createdByPrincipalId,
       capability.created_by AS createdByCapabilityPrincipalId,
       capability.invocation_kind AS capabilityInvocationKind,
       workflow.created_by AS createdByWorkflowPrincipalId,
       workflow.idempotency_key AS workflowIdempotencyKey,
       artifact.metadata
     FROM artifact
     LEFT JOIN capability_run capability
       ON capability.workspace_id = artifact.workspace_id
      AND capability.id = artifact.created_by_capability_run_id
     LEFT JOIN node_run node
       ON node.workspace_id = capability.workspace_id
      AND node.id = capability.node_run_id
     LEFT JOIN workflow_run workflow
       ON workflow.workspace_id = node.workspace_id
      AND workflow.id = node.workflow_run_id
     WHERE artifact.workspace_id = ?
       AND artifact.id = ?
     LIMIT 1
     FOR SHARE`,
    [authority.workspaceId, artifactId],
  );
  const facts = rows[0];
  if (!facts) {
    return fail("content_domain.not_found", "Artifact was not found.");
  }
  const owner = privateConversationArtifactOwner(facts);
  if (owner && owner !== authority.principalId) {
    return fail(
      "content_domain.forbidden",
      "Private conversation content cannot be added to the Asset library by another principal.",
    );
  }
}

function assetCreationMatches(
  asset: AssetRow,
  options: CreateAssetOptions,
): boolean {
  return (
    asset.id === options.assetId &&
    asset.workspaceId === options.authority.workspaceId &&
    asset.assetKey === options.assetKey &&
    asset.name === options.name &&
    asset.assetType === options.assetType &&
    asset.lifecycleStatus === "active" &&
    asset.createdByPrincipalId === options.authority.principalId
  );
}

async function initialArtifactMatches(
  connection: PoolConnection,
  options: CreateAssetOptions,
): Promise<boolean> {
  if (!options.initialArtifact) {
    return true;
  }
  const artifact = await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.initialArtifact.artifactId,
  );
  if (
    artifact.assetId !== options.assetId ||
    artifact.availabilityStatus !== "available"
  ) {
    return false;
  }
  if (options.initialArtifact.kind === "adopt") {
    return true;
  }
  return (
    artifact.storedObjectId === null &&
    artifact.structuredContent !== null &&
    artifact.contentDigest === options.initialArtifact.contentDigest &&
    artifact.artifactType === options.initialArtifact.artifactType &&
    artifact.dataClassification ===
      (options.initialArtifact.dataClassification ?? "internal") &&
    artifact.createdByPrincipalId === options.authority.principalId
  );
}

async function adoptExistingArtifact(
  connection: PoolConnection,
  options: CreateAssetOptions,
  artifactId: string,
): Promise<void> {
  const artifact = await lockArtifact(
    connection,
    options.authority.workspaceId,
    artifactId,
  );
  if (artifact.availabilityStatus !== "available") {
    return fail(
      "content_domain.artifact_unavailable",
      "Only an available Artifact can be adopted into an Asset.",
    );
  }
  if (artifact.assetId !== null) {
    return fail(
      "content_domain.identity_conflict",
      "Artifact ownership is already assigned and cannot be changed.",
    );
  }
  await assertConversationArtifactAdoptionAuthority(
    connection,
    options.authority,
    artifact.id,
  );
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE artifact
     SET asset_id = ?
     WHERE workspace_id = ?
       AND id = ?
       AND asset_id IS NULL`,
    [options.assetId, options.authority.workspaceId, artifact.id],
  );
  if (updated.affectedRows !== 1) {
    return fail(
      "content_domain.state_conflict",
      "Artifact ownership changed during adoption.",
    );
  }
}

async function selectInitialArtifact(
  connection: PoolConnection,
  options: CreateAssetOptions,
  artifactId: string,
): Promise<void> {
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE asset
     SET current_artifact_id = ?
     WHERE workspace_id = ?
       AND id = ?
       AND version = 1
       AND current_artifact_id IS NULL`,
    [artifactId, options.authority.workspaceId, options.assetId],
  );
  if (updated.affectedRows !== 1) {
    return fail(
      "content_domain.state_conflict",
      "Asset changed before its initial Artifact was selected.",
    );
  }
}

async function insertInitialStructuredArtifact(
  connection: PoolConnection,
  options: CreateAssetOptions,
  initial: Extract<InitialAssetArtifact, { readonly kind: "structured" }>,
  structuredContentText: string,
  metadataText: string,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO artifact (
       id,
       workspace_id,
       asset_id,
       created_by_capability_run_id,
       created_by_principal_id,
       stored_object_id,
       structured_content,
       content_digest,
       artifact_type,
       availability_status,
       data_classification,
       display_filename,
       metadata,
       created_at
     ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'available', ?, NULL, ?, ?)`,
    [
      initial.artifactId,
      options.authority.workspaceId,
      options.assetId,
      options.authority.principalId,
      structuredContentText,
      initial.contentDigest,
      initial.artifactType,
      initial.dataClassification ?? "internal",
      metadataText,
      options.now,
    ],
  );
}

async function createAssetInTransaction(
  connection: PoolConnection,
  options: CreateAssetOptions,
  canonical: {
    readonly structuredContentText?: string;
    readonly metadataText?: string;
  },
): Promise<AssetMutationResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  const existing = await findAssetByIdentity(
    connection,
    options.authority.workspaceId,
    options.assetId,
    options.assetKey,
  );
  if (existing.length > 0) {
    const asset = existing[0];
    if (
      existing.length !== 1 ||
      !asset ||
      !assetCreationMatches(asset, options) ||
      !(await initialArtifactMatches(connection, options))
    ) {
      return fail(
        "content_domain.identity_conflict",
        "Asset ID, key, or initial Artifact is bound to different facts.",
      );
    }
    if (options.initialArtifact && asset.currentArtifactId === null) {
      await selectInitialArtifact(
        connection,
        options,
        options.initialArtifact.artifactId,
      );
    }
    return Object.freeze({
      status: "existing",
      assetId: asset.id,
      version: asset.version,
      ...(options.initialArtifact
        ? { artifactId: options.initialArtifact.artifactId }
        : {}),
    });
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO asset (
       id,
       workspace_id,
       asset_key,
       name,
       asset_type,
       lifecycle_status,
       current_artifact_id,
       version,
       created_by_principal_id,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, 'active', NULL, 1, ?, ?, ?)`,
    [
      options.assetId,
      options.authority.workspaceId,
      options.assetKey,
      options.name,
      options.assetType,
      options.authority.principalId,
      options.now,
      options.now,
    ],
  );
  if (options.initialArtifact?.kind === "adopt") {
    await adoptExistingArtifact(
      connection,
      options,
      options.initialArtifact.artifactId,
    );
  }
  if (options.initialArtifact?.kind === "structured") {
    if (!canonical.structuredContentText || !canonical.metadataText) {
      return fail(
        "content_domain.state_conflict",
        "Structured Artifact canonical facts are missing.",
      );
    }
    await insertInitialStructuredArtifact(
      connection,
      options,
      options.initialArtifact,
      canonical.structuredContentText,
      canonical.metadataText,
    );
  }
  if (options.initialArtifact) {
    await selectInitialArtifact(
      connection,
      options,
      options.initialArtifact.artifactId,
    );
  }
  return Object.freeze({
    status: "created",
    assetId: options.assetId,
    version: 1,
    ...(options.initialArtifact
      ? { artifactId: options.initialArtifact.artifactId }
      : {}),
  });
}

interface ResolvedArtifactOwnership {
  readonly assetId: string | null;
}

async function resolveArtifactOwnership(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  target: StructuredArtifactTarget,
): Promise<ResolvedArtifactOwnership> {
  if (target.kind === "workspace") {
    return Object.freeze({
      assetId: null,
    });
  }
  const asset = await lockAsset(
    connection,
    authority.workspaceId,
    target.assetId,
  );
  if (asset.lifecycleStatus !== "active") {
    return fail(
      "content_domain.state_conflict",
      "Artifact ownership can only target an active Asset.",
    );
  }
  return Object.freeze({
    assetId: asset.id,
  });
}

function artifactOwnershipMatches(
  artifact: ArtifactRow,
  ownership: ResolvedArtifactOwnership,
): boolean {
  return artifact.assetId === ownership.assetId;
}

async function adoptArtifactInTransaction(
  connection: PoolConnection,
  options: AdoptArtifactOptions,
): Promise<ArtifactOwnershipMutationResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  const ownership = await resolveArtifactOwnership(
    connection,
    options.authority,
    options.target,
  );
  const artifact = await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.artifactId,
  );
  if (artifactOwnershipMatches(artifact, ownership)) {
    return Object.freeze({
      status: "existing",
      artifactId: artifact.id,
      ...ownership,
    });
  }
  if (artifact.assetId !== null) {
    return fail(
      "content_domain.identity_conflict",
      "Artifact ownership is already assigned and cannot be changed.",
    );
  }
  if (artifact.availabilityStatus !== "available") {
    return fail(
      "content_domain.artifact_unavailable",
      "Only an available Artifact can be adopted.",
    );
  }
  await assertConversationArtifactAdoptionAuthority(
    connection,
    options.authority,
    artifact.id,
  );
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE artifact
     SET asset_id = ?
     WHERE workspace_id = ?
       AND id = ?
       AND asset_id IS NULL
       AND availability_status = 'available'`,
    [ownership.assetId, options.authority.workspaceId, artifact.id],
  );
  if (updated.affectedRows !== 1) {
    return fail(
      "content_domain.state_conflict",
      "Artifact ownership changed during adoption.",
    );
  }
  return Object.freeze({
    status: "adopted",
    artifactId: artifact.id,
    ...ownership,
  });
}

function structuredArtifactMatches(
  artifact: ArtifactRow,
  ownership: ResolvedArtifactOwnership,
  options: CreateStructuredArtifactOptions,
  structuredContentText: string,
  metadataText: string,
): boolean {
  return (
    artifactOwnershipMatches(artifact, ownership) &&
    artifact.createdByCapabilityRunId === null &&
    artifact.createdByPrincipalId === options.authority.principalId &&
    artifact.storedObjectId === null &&
    artifact.structuredContent !== null &&
    canonicalJsonObject(
      artifact.structuredContent,
      "persistedArtifact.structuredContent",
    ).text === structuredContentText &&
    artifact.contentDigest === options.contentDigest &&
    artifact.artifactType === options.artifactType &&
    artifact.availabilityStatus === "available" &&
    artifact.dataClassification ===
      (options.dataClassification ?? "internal") &&
    canonicalJsonObject(artifact.metadata, "persistedArtifact.metadata")
      .text === metadataText
  );
}

async function createStructuredArtifactInTransaction(
  connection: PoolConnection,
  options: CreateStructuredArtifactOptions,
  canonical: {
    readonly structuredContentText: string;
    readonly metadataText: string;
  },
): Promise<ArtifactOwnershipMutationResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  const ownership = await resolveArtifactOwnership(
    connection,
    options.authority,
    options.target,
  );
  const existing = await findArtifactForUpdate(
    connection,
    options.authority.workspaceId,
    options.artifactId,
  );
  if (existing) {
    if (
      !structuredArtifactMatches(
        existing,
        ownership,
        options,
        canonical.structuredContentText,
        canonical.metadataText,
      )
    ) {
      return fail(
        "content_domain.identity_conflict",
        "Artifact ID is already bound to different immutable facts.",
      );
    }
    return Object.freeze({
      status: "existing",
      artifactId: existing.id,
      ...ownership,
    });
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO artifact (
       id,
       workspace_id,
       asset_id,
       created_by_capability_run_id,
       created_by_principal_id,
       stored_object_id,
       structured_content,
       content_digest,
       artifact_type,
       availability_status,
       data_classification,
       display_filename,
       metadata,
       created_at
     ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'available', ?, NULL, ?, ?)`,
    [
      options.artifactId,
      options.authority.workspaceId,
      ownership.assetId,
      options.authority.principalId,
      canonical.structuredContentText,
      options.contentDigest,
      options.artifactType,
      options.dataClassification ?? "internal",
      canonical.metadataText,
      options.now,
    ],
  );
  return Object.freeze({
    status: "created",
    artifactId: options.artifactId,
    ...ownership,
  });
}

async function findArtifactEdgeByIdentity(
  connection: PoolConnection,
  options: AddArtifactEdgeOptions,
): Promise<readonly ArtifactEdgeRow[]> {
  const [rows] = await connection.execute<ArtifactEdgeRow[]>(
    `SELECT
       id,
       source_artifact_id AS sourceArtifactId,
       target_artifact_id AS targetArtifactId,
       relation
     FROM artifact_edge
     WHERE workspace_id = ?
       AND (
         id = ?
         OR (
           source_artifact_id = ?
           AND target_artifact_id = ?
           AND relation = ?
         )
       )
     ORDER BY id
     FOR UPDATE`,
    [
      options.authority.workspaceId,
      options.edgeId,
      options.sourceArtifactId,
      options.targetArtifactId,
      options.relation,
    ],
  );
  return rows;
}

function artifactEdgeMatches(
  row: ArtifactEdgeRow,
  options: AddArtifactEdgeOptions,
): boolean {
  return (
    row.id === options.edgeId &&
    row.sourceArtifactId === options.sourceArtifactId &&
    row.targetArtifactId === options.targetArtifactId &&
    row.relation === options.relation
  );
}

async function wouldCreateArtifactCycle(
  connection: PoolConnection,
  options: AddArtifactEdgeOptions,
): Promise<boolean> {
  const [rows] = await connection.execute<ReachabilityRow[]>(
    `WITH RECURSIVE reachable (artifactId) AS (
       SELECT id
       FROM artifact
       WHERE workspace_id = ?
         AND id = ?
       UNION DISTINCT
       SELECT edge.target_artifact_id
       FROM artifact_edge AS edge
       INNER JOIN reachable
         ON reachable.artifactId = edge.source_artifact_id
       WHERE edge.workspace_id = ?
     )
     SELECT artifactId
     FROM reachable
     WHERE artifactId = ?
     LIMIT 1`,
    [
      options.authority.workspaceId,
      options.targetArtifactId,
      options.authority.workspaceId,
      options.sourceArtifactId,
    ],
  );
  return rows.length > 0;
}

async function addArtifactEdgeInTransaction(
  connection: PoolConnection,
  options: AddArtifactEdgeOptions,
): Promise<AppendIdentityResult> {
  // The Workspace row serializes lineage graph writers so reachability checks
  // and edge insertion observe one graph state.
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.sourceArtifactId,
  );
  await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.targetArtifactId,
  );
  const existing = await findArtifactEdgeByIdentity(connection, options);
  if (existing.length > 0) {
    const edge = existing[0];
    if (existing.length !== 1 || !edge || !artifactEdgeMatches(edge, options)) {
      return fail(
        "content_domain.identity_conflict",
        "Artifact edge identity is bound to different facts.",
      );
    }
    return Object.freeze({
      status: "existing",
      id: edge.id,
    });
  }
  if (await wouldCreateArtifactCycle(connection, options)) {
    return fail(
      "content_domain.lineage_cycle",
      "Artifact edge would make the Workspace lineage graph cyclic.",
    );
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO artifact_edge (
       id,
       workspace_id,
       source_artifact_id,
       target_artifact_id,
       relation,
       created_by_principal_id,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      options.edgeId,
      options.authority.workspaceId,
      options.sourceArtifactId,
      options.targetArtifactId,
      options.relation,
      options.authority.principalId,
      options.now,
    ],
  );
  return Object.freeze({
    status: "created",
    id: options.edgeId,
  });
}

async function selectCurrentArtifactInTransaction(
  connection: PoolConnection,
  auditPort: ContentDomainAuditPort,
  options: SelectCurrentArtifactOptions,
): Promise<CurrentArtifactSelectionResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  const asset = await lockAsset(
    connection,
    options.authority.workspaceId,
    options.assetId,
  );
  if (asset.lifecycleStatus !== "active") {
    return fail(
      "content_domain.state_conflict",
      "Archived Asset cannot change Editorial Selection.",
    );
  }
  if (asset.version !== options.expectedAssetVersion) {
    return fail(
      "content_domain.state_conflict",
      "Asset version changed before Editorial Selection.",
    );
  }
  if (asset.currentArtifactId === options.artifactId) {
    return fail(
      "content_domain.state_conflict",
      "Artifact is already the Asset Editorial Selection.",
    );
  }
  const artifact = await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.artifactId,
  );
  if (artifact.assetId !== asset.id) {
    return fail(
      "content_domain.identity_conflict",
      "Editorial Selection must belong to the selected Asset.",
    );
  }
  if (artifact.availabilityStatus !== "available") {
    return fail(
      "content_domain.artifact_unavailable",
      "Editorial Selection must be an available Artifact.",
    );
  }
  const nextVersion = asset.version + 1;
  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE asset
     SET current_artifact_id = ?,
         version = ?,
         updated_at = ?
     WHERE workspace_id = ?
       AND id = ?
       AND version = ?
       AND lifecycle_status = 'active'`,
    [
      artifact.id,
      nextVersion,
      options.now,
      options.authority.workspaceId,
      asset.id,
      asset.version,
    ],
  );
  if (updated.affectedRows !== 1) {
    return fail(
      "content_domain.state_conflict",
      "Asset changed during Editorial Selection.",
    );
  }
  await appendAudit(connection, auditPort, options.authority, options.audit, {
    eventType: "asset.current_artifact.selected",
    action: "asset.current_artifact.select",
    resourceType: "asset",
    resourceId: asset.id,
    decisionReasonCode: "asset.editorial_selection.explicit",
    severity: "info",
    details: Object.freeze({
      assetId: asset.id,
      previousArtifactId: asset.currentArtifactId,
      selectedArtifactId: artifact.id,
      previousVersion: asset.version,
      nextVersion,
    }),
    occurredAt: options.now,
  });
  return Object.freeze({
    assetId: asset.id,
    artifactId: artifact.id,
    version: nextVersion,
  });
}

function validateAssetRelation(options: AddAssetRelationOptions): void {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.relationId, "relationId");
  assertId(options.sourceAssetId, "sourceAssetId");
  assertId(options.targetAssetId, "targetAssetId");
  if (options.sourceAssetId === options.targetAssetId) {
    invalid("Asset relation cannot self-reference.");
  }
  if (!assetRelations.has(options.relation)) {
    invalid("Asset relation is invalid.");
  }
}

function validateArtifactReference(options: AddArtifactReferenceOptions): void {
  assertCommandBase(options.authority, "asset.write", options.now);
  assertId(options.referenceId, "referenceId");
  assertId(options.artifactId, "artifactId");
  assertAsciiFact(options.referenceRole, "referenceRole", 80);
  assertId(options.target.id, "target.id");
}

async function findAssetRelationByIdentity(
  connection: PoolConnection,
  options: AddAssetRelationOptions,
): Promise<readonly AssetRelationRow[]> {
  const [rows] = await connection.execute<AssetRelationRow[]>(
    `SELECT
       id,
       source_asset_id AS sourceAssetId,
       target_asset_id AS targetAssetId,
       relation
     FROM asset_relation
     WHERE workspace_id = ?
       AND (
         id = ?
         OR (
           source_asset_id = ?
           AND target_asset_id = ?
           AND relation = ?
         )
       )
     ORDER BY id
     FOR UPDATE`,
    [
      options.authority.workspaceId,
      options.relationId,
      options.sourceAssetId,
      options.targetAssetId,
      options.relation,
    ],
  );
  return rows;
}

async function addAssetRelationInTransaction(
  connection: PoolConnection,
  options: AddAssetRelationOptions,
): Promise<AppendIdentityResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  await lockAsset(
    connection,
    options.authority.workspaceId,
    options.sourceAssetId,
  );
  await lockAsset(
    connection,
    options.authority.workspaceId,
    options.targetAssetId,
  );
  const existing = await findAssetRelationByIdentity(connection, options);
  if (existing.length > 0) {
    const relation = existing[0];
    if (
      existing.length !== 1 ||
      !relation ||
      relation.id !== options.relationId ||
      relation.sourceAssetId !== options.sourceAssetId ||
      relation.targetAssetId !== options.targetAssetId ||
      relation.relation !== options.relation
    ) {
      return fail(
        "content_domain.identity_conflict",
        "Asset relation identity is bound to different facts.",
      );
    }
    return Object.freeze({
      status: "existing",
      id: relation.id,
    });
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO asset_relation (
       id,
       workspace_id,
       source_asset_id,
       target_asset_id,
       relation,
       created_by_principal_id,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      options.relationId,
      options.authority.workspaceId,
      options.sourceAssetId,
      options.targetAssetId,
      options.relation,
      options.authority.principalId,
      options.now,
    ],
  );
  return Object.freeze({
    status: "created",
    id: options.relationId,
  });
}

async function findArtifactReferenceByIdentity(
  connection: PoolConnection,
  options: AddArtifactReferenceOptions,
): Promise<readonly ArtifactReferenceRow[]> {
  const [rows] = await connection.execute<ArtifactReferenceRow[]>(
    `SELECT
       id,
       artifact_id AS artifactId,
       reference_role AS referenceRole,
       target_type AS targetType,
       target_id AS targetId
     FROM artifact_reference
     WHERE workspace_id = ?
       AND (
         id = ?
         OR (
           artifact_id = ?
           AND reference_role = ?
           AND target_type = ?
           AND target_id = ?
         )
       )
     ORDER BY id
     FOR UPDATE`,
    [
      options.authority.workspaceId,
      options.referenceId,
      options.artifactId,
      options.referenceRole,
      options.target.type,
      options.target.id,
    ],
  );
  return rows;
}

async function requireReferenceTarget(
  connection: PoolConnection,
  workspaceId: string,
  target: ArtifactReferenceTarget,
): Promise<void> {
  let query: string;
  switch (target.type) {
    case "workflow_run":
      query =
        "SELECT id FROM workflow_run WHERE workspace_id = ? AND id = ? LIMIT 1 FOR SHARE";
      break;
    case "asset":
      query =
        "SELECT id FROM asset WHERE workspace_id = ? AND id = ? LIMIT 1 FOR SHARE";
      break;
  }
  const [rows] = await connection.execute<
    (RowDataPacket & { readonly id: string })[]
  >(query, [workspaceId, target.id]);
  if (!rows[0]) {
    return fail(
      "content_domain.not_found",
      "Artifact Reference target does not exist in the Workspace.",
    );
  }
}

function referenceTargetColumns(
  target: ArtifactReferenceTarget,
): readonly [string | null, string | null] {
  return [
    target.type === "workflow_run" ? target.id : null,
    target.type === "asset" ? target.id : null,
  ];
}

async function addArtifactReferenceInTransaction(
  connection: PoolConnection,
  options: AddArtifactReferenceOptions,
): Promise<AppendIdentityResult> {
  await lockWorkspace(
    connection,
    options.authority,
    "asset.write",
    options.now,
  );
  await lockArtifact(
    connection,
    options.authority.workspaceId,
    options.artifactId,
  );
  await requireReferenceTarget(
    connection,
    options.authority.workspaceId,
    options.target,
  );
  const existing = await findArtifactReferenceByIdentity(connection, options);
  if (existing.length > 0) {
    const reference = existing[0];
    if (
      existing.length !== 1 ||
      !reference ||
      reference.id !== options.referenceId ||
      reference.artifactId !== options.artifactId ||
      reference.referenceRole !== options.referenceRole ||
      reference.targetType !== options.target.type ||
      reference.targetId !== options.target.id
    ) {
      return fail(
        "content_domain.identity_conflict",
        "Artifact Reference identity is bound to different facts.",
      );
    }
    return Object.freeze({
      status: "existing",
      id: reference.id,
    });
  }
  const [workflowRunId, assetId] = referenceTargetColumns(options.target);
  await connection.execute<ResultSetHeader>(
    `INSERT INTO artifact_reference (
       id,
       workspace_id,
       artifact_id,
       reference_role,
       target_type,
       target_id,
       workflow_run_id,
       asset_id,
       created_by_principal_id,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.referenceId,
      options.authority.workspaceId,
      options.artifactId,
      options.referenceRole,
      options.target.type,
      options.target.id,
      workflowRunId,
      assetId,
      options.authority.principalId,
      options.now,
    ],
  );
  return Object.freeze({
    status: "created",
    id: options.referenceId,
  });
}

export function createContentDomainStore(
  pool: Pool,
  options: CreateContentDomainStoreOptions = {},
): ContentDomainStore {
  if (
    options.auditPort !== undefined &&
    typeof options.auditPort.appendInTransaction !== "function"
  ) {
    invalid("Content Domain Audit port is invalid.");
  }
  const auditPort = options.auditPort ?? genericContentDomainAuditPort;
  return Object.freeze({
    createAsset(command: CreateAssetOptions) {
      const canonical = validateCreateAsset(command);
      return inTransaction(pool, (connection) =>
        createAssetInTransaction(connection, command, canonical),
      );
    },
    adoptArtifact(command: AdoptArtifactOptions) {
      validateAdoptArtifact(command);
      return inTransaction(pool, (connection) =>
        adoptArtifactInTransaction(connection, command),
      );
    },
    createStructuredArtifact(command: CreateStructuredArtifactOptions) {
      const canonical = validateCreateStructuredArtifact(command);
      return inTransaction(pool, (connection) =>
        createStructuredArtifactInTransaction(connection, command, canonical),
      );
    },
    addArtifactEdge(command: AddArtifactEdgeOptions) {
      validateArtifactEdge(command);
      return inTransaction(pool, (connection) =>
        addArtifactEdgeInTransaction(connection, command),
      );
    },
    selectCurrentArtifact(command: SelectCurrentArtifactOptions) {
      validateCurrentSelection(command);
      return inTransaction(pool, (connection) =>
        selectCurrentArtifactInTransaction(connection, auditPort, command),
      );
    },
    addAssetRelation(command: AddAssetRelationOptions) {
      validateAssetRelation(command);
      return inTransaction(pool, (connection) =>
        addAssetRelationInTransaction(connection, command),
      );
    },
    addArtifactReference(command: AddArtifactReferenceOptions) {
      validateArtifactReference(command);
      return inTransaction(pool, (connection) =>
        addArtifactReferenceInTransaction(connection, command),
      );
    },
  });
}
