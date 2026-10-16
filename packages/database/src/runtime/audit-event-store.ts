import { createHash } from "node:crypto";

import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

export const auditEventSchemaVersion = 1;
/**
 * The writer stays below the database's 8 KiB rendered-JSON ceiling so
 * MySQL's canonical whitespace cannot turn an accepted payload into a
 * constraint failure.
 */
export const maximumAuditDetailsBytes = 7_680;
export const maximumAuditJsonDepth = 8;
export const maximumAuditJsonNodes = 256;

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const secretLikeKeyPattern =
  /(^authorization$|authorization[_-]?header|auth[_-]?header|token|secret|password|credential|cookie|session|email)/iu;
const actorTypes = new Set<AuditActorType>(["human", "service", "system"]);
const authenticationRefTypes = new Set<AuditAuthenticationRefType>([
  "session",
  "service_api_token",
  "deployment",
  "cli_recovery",
  "none",
]);
const authorityTypes = new Set<AuditAuthorityType>([
  "human_membership",
  "service_grant",
  "instance_administrator",
  "system",
  "none",
]);
const outcomes = new Set<AuditOutcome>(["succeeded", "denied", "failed"]);
const severities = new Set<AuditSeverity>([
  "info",
  "warning",
  "high",
  "critical",
]);

export type AuditJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AuditJsonValue[]
  | AuditJsonObject;

export interface AuditJsonObject {
  readonly [key: string]: AuditJsonValue;
}

export type AuditActorType = "human" | "service" | "system";
export type AuditAuthenticationRefType =
  "session" | "service_api_token" | "deployment" | "cli_recovery" | "none";
export type AuditAuthorityType =
  | "human_membership"
  | "service_grant"
  | "instance_administrator"
  | "system"
  | "none";
export type AuditOutcome = "succeeded" | "denied" | "failed";
export type AuditSeverity = "info" | "warning" | "high" | "critical";

export interface AppendAuditEvent {
  readonly id: string;
  readonly schemaVersion: number;
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly actorPrincipalId: string | null;
  readonly actorType: AuditActorType;
  readonly authenticationRefType: AuditAuthenticationRefType;
  readonly authenticationRefHash: string | null;
  readonly authorityType: AuditAuthorityType;
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly authorizationModelVersion: number;
  /**
   * A bounded, secret-free decision fact set. Only its canonical digest is
   * persisted.
   */
  readonly authorizationDecision: AuditJsonObject;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly decisionReasonCode: string;
  readonly severity: AuditSeverity;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly details: AuditJsonObject;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}

export interface AuditIntegrityMaterial {
  readonly id: string;
  readonly schemaVersion: number;
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly actorPrincipalId: string | null;
  readonly actorType: AuditActorType;
  readonly authenticationRefType: AuditAuthenticationRefType;
  readonly authenticationRefHash: string | null;
  readonly authorityType: AuditAuthorityType;
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly authorizationModelVersion: number;
  readonly authorizationDecisionDigest: string;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly decisionReasonCode: string;
  readonly severity: AuditSeverity;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly details: AuditJsonObject;
  readonly occurredAt: string;
  readonly recordedAt: string;
}

export interface AppendedAuditEvent {
  readonly id: string;
  readonly authorizationDecisionDigest: string;
  readonly integrityDigest: string;
  readonly detailsBytes: number;
}

export type AuditEventStoreErrorCode =
  "audit.invalid_argument" | "audit.payload_unsafe";

export class AuditEventStoreError extends Error {
  public constructor(
    public readonly code: AuditEventStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuditEventStoreError";
  }
}

interface CanonicalizeOptions {
  readonly label: string;
  readonly maximumBytes: number;
  readonly rejectSecretLikeKeys: boolean;
}

function fail(code: AuditEventStoreErrorCode, message: string): never {
  throw new AuditEventStoreError(code, message);
}

function invalid(message: string): never {
  return fail("audit.invalid_argument", message);
}

function unsafe(message: string): never {
  return fail("audit.payload_unsafe", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertOptionalId(value: unknown, label: string): void {
  if (value !== null) {
    assertId(value, label);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
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

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
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
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalid(`${label} must be bounded text without control characters.`);
  }
}

function assertOptionalBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
): void {
  if (value !== null) {
    assertBoundedText(value, label, maximumLength);
  }
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalizeJson(
  value: unknown,
  options: CanonicalizeOptions,
): string {
  let nodes = 0;
  const activeObjects = new WeakSet<object>();

  const encode = (candidate: unknown, depth: number): string => {
    nodes += 1;
    if (nodes > maximumAuditJsonNodes) {
      unsafe(`${options.label} exceeds ${maximumAuditJsonNodes} JSON nodes.`);
    }
    if (depth > maximumAuditJsonDepth) {
      unsafe(`${options.label} exceeds JSON depth ${maximumAuditJsonDepth}.`);
    }
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "string"
    ) {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        unsafe(`${options.label} contains a non-finite number.`);
      }
      return JSON.stringify(candidate);
    }
    if (typeof candidate !== "object") {
      unsafe(`${options.label} must contain plain JSON values only.`);
    }
    if (activeObjects.has(candidate)) {
      unsafe(`${options.label} contains a cyclic reference.`);
    }
    activeObjects.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        if (
          Object.getOwnPropertySymbols(candidate).length > 0 ||
          Object.keys(candidate).length !== candidate.length
        ) {
          unsafe(`${options.label} contains a sparse or extended JSON array.`);
        }
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.hasOwn(candidate, index)) {
            unsafe(`${options.label} contains a sparse JSON array.`);
          }
        }
        return `[${candidate
          .map((item) => encode(item, depth + 1))
          .join(",")}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        unsafe(`${options.label} must contain plain JSON objects only.`);
      }
      const ownKeys = Reflect.ownKeys(candidate);
      if (ownKeys.some((key) => typeof key !== "string")) {
        unsafe(`${options.label} cannot contain Symbol keys.`);
      }
      const entries = ownKeys
        .map((key): readonly [string, unknown] => {
          if (typeof key !== "string") {
            return unsafe(`${options.label} cannot contain Symbol keys.`);
          }
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
          if (
            !descriptor ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            return unsafe(
              `${options.label} must use enumerable data properties.`,
            );
          }
          return [key, descriptor.value];
        })
        .sort(([left], [right]) => compareCodePoints(left, right));
      return `{${entries
        .map(([key, item]) => {
          assertBoundedText(key, `${options.label} key`, 120);
          if (options.rejectSecretLikeKeys && secretLikeKeyPattern.test(key)) {
            unsafe(
              `${options.label} contains prohibited secret-like key "${key}".`,
            );
          }
          return `${JSON.stringify(key)}:${encode(item, depth + 1)}`;
        })
        .join(",")}}`;
    } finally {
      activeObjects.delete(candidate);
    }
  };

  let canonical: string;
  try {
    canonical = encode(value, 0);
  } catch (error) {
    if (error instanceof AuditEventStoreError) {
      throw error;
    }
    return unsafe(`${options.label} could not be safely inspected.`);
  }
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > options.maximumBytes) {
    unsafe(`${options.label} exceeds ${options.maximumBytes} UTF-8 bytes.`);
  }
  return canonical;
}

function sha256(canonicalJson: string): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson, "utf8")
    .digest("hex")}`;
}

export function canonicalizeAuditDetails(details: AuditJsonObject): string {
  return canonicalizeJson(details, {
    label: "Audit details",
    maximumBytes: maximumAuditDetailsBytes,
    rejectSecretLikeKeys: true,
  });
}

export function computeAuthorizationDecisionDigest(
  decision: AuditJsonObject,
): string {
  return sha256(
    canonicalizeJson(decision, {
      label: "Authorization decision",
      maximumBytes: 4_096,
      rejectSecretLikeKeys: true,
    }),
  );
}

export function computeAuditIntegrityDigest(
  material: AuditIntegrityMaterial,
): string {
  assertDigest(
    material.authorizationDecisionDigest,
    "authorizationDecisionDigest",
  );
  return sha256(
    canonicalizeJson(material, {
      label: "Audit integrity material",
      maximumBytes: 16_384,
      rejectSecretLikeKeys: false,
    }),
  );
}

function validateShape(event: AppendAuditEvent): void {
  assertId(event.id, "id");
  assertPositiveVersion(event.schemaVersion, "schemaVersion");
  if (event.schemaVersion !== auditEventSchemaVersion) {
    invalid("schemaVersion is not supported by this Audit writer.");
  }
  assertOptionalId(event.organizationId, "organizationId");
  assertOptionalId(event.workspaceId, "workspaceId");
  if (event.workspaceId !== null && event.organizationId === null) {
    invalid("Workspace-scoped Audit events require an Organization.");
  }
  assertOptionalId(event.actorPrincipalId, "actorPrincipalId");
  if (!actorTypes.has(event.actorType)) {
    invalid("actorType is not supported.");
  }
  if (
    (event.actorType === "human" || event.actorType === "service") &&
    event.actorPrincipalId === null
  ) {
    invalid("Human and Service Audit actors require a Principal.");
  }
  if (event.actorType === "system" && event.actorPrincipalId !== null) {
    invalid("System Audit actors cannot carry a Principal.");
  }
  if (!authenticationRefTypes.has(event.authenticationRefType)) {
    invalid("authenticationRefType is not supported.");
  }
  if (event.authenticationRefType === "none") {
    if (event.authenticationRefHash !== null) {
      invalid("Authentication type none cannot carry a digest.");
    }
  } else {
    assertDigest(event.authenticationRefHash, "authenticationRefHash");
  }
  assertOptionalId(event.authorityId, "authorityId");
  if (!authorityTypes.has(event.authorityType)) {
    invalid("authorityType is not supported.");
  }
  if (event.authorityType === "none" || event.authorityType === "system") {
    if (event.authorityId !== null || event.authorityVersion !== null) {
      invalid("System and none authorities cannot carry identity or version.");
    }
  } else {
    assertId(event.authorityId, "authorityId");
    assertPositiveVersion(event.authorityVersion, "authorityVersion");
  }
  assertPositiveVersion(
    event.authorizationModelVersion,
    "authorizationModelVersion",
  );
  assertBoundedText(event.eventType, "eventType", 120);
  assertBoundedText(event.action, "action", 120);
  assertBoundedText(event.resourceType, "resourceType", 80);
  assertOptionalId(event.resourceId, "resourceId");
  if (!outcomes.has(event.outcome)) {
    invalid("outcome is not supported.");
  }
  assertBoundedText(event.decisionReasonCode, "decisionReasonCode", 120);
  assertOptionalBoundedText(event.requestId, "requestId", 120);
  assertOptionalBoundedText(event.traceId, "traceId", 120);
  if (!severities.has(event.severity)) {
    invalid("severity is not supported.");
  }
  assertDate(event.occurredAt, "occurredAt");
  assertDate(event.recordedAt, "recordedAt");
  if (event.recordedAt < event.occurredAt) {
    invalid("recordedAt cannot precede occurredAt.");
  }
}

export async function appendAuditEventInTransaction(
  connection: PoolConnection,
  event: AppendAuditEvent,
): Promise<AppendedAuditEvent> {
  validateShape(event);
  const detailsJson = canonicalizeAuditDetails(event.details);
  const details = JSON.parse(detailsJson) as AuditJsonObject;
  const authorizationDecisionDigest = computeAuthorizationDecisionDigest(
    event.authorizationDecision,
  );
  const integrityMaterial: AuditIntegrityMaterial = {
    id: event.id,
    schemaVersion: event.schemaVersion,
    organizationId: event.organizationId,
    workspaceId: event.workspaceId,
    actorPrincipalId: event.actorPrincipalId,
    actorType: event.actorType,
    authenticationRefType: event.authenticationRefType,
    authenticationRefHash: event.authenticationRefHash,
    authorityType: event.authorityType,
    authorityId: event.authorityId,
    authorityVersion: event.authorityVersion,
    authorizationModelVersion: event.authorizationModelVersion,
    authorizationDecisionDigest,
    eventType: event.eventType,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    decisionReasonCode: event.decisionReasonCode,
    severity: event.severity,
    requestId: event.requestId,
    traceId: event.traceId,
    details,
    occurredAt: event.occurredAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(),
  };
  const integrityDigest = computeAuditIntegrityDigest(integrityMaterial);

  await connection.execute<ResultSetHeader>(
    `INSERT INTO audit_event (
       id,
       organization_id,
       workspace_id,
       actor_principal_id,
       actor_type,
       authentication_ref_type,
       authentication_ref_hash,
       authority_type,
       authority_id,
       authority_version,
       authorization_model_version,
       event_type,
       schema_version,
       authorization_decision_digest,
       action,
       resource_type,
       resource_id,
       outcome,
       decision_reason_code,
       severity,
       request_id,
       trace_id,
       details,
       occurred_at,
       recorded_at,
       integrity_digest
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?
     )`,
    [
      event.id,
      event.organizationId,
      event.workspaceId,
      event.actorPrincipalId,
      event.actorType,
      event.authenticationRefType,
      event.authenticationRefHash,
      event.authorityType,
      event.authorityId,
      event.authorityVersion,
      event.authorizationModelVersion,
      event.eventType,
      event.schemaVersion,
      authorizationDecisionDigest,
      event.action,
      event.resourceType,
      event.resourceId,
      event.outcome,
      event.decisionReasonCode,
      event.severity,
      event.requestId,
      event.traceId,
      detailsJson,
      event.occurredAt,
      event.recordedAt,
      integrityDigest,
    ],
  );

  return Object.freeze({
    id: event.id,
    authorizationDecisionDigest,
    integrityDigest,
    detailsBytes: Buffer.byteLength(detailsJson, "utf8"),
  });
}
