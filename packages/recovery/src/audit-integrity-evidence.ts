import { createHash } from "node:crypto";

import {
  computeAuditIntegrityDigest,
  type AuditActorType,
  type AuditAuthenticationRefType,
  type AuditAuthorityType,
  type AuditIntegrityMaterial,
  type AuditJsonObject,
  type AuditOutcome,
  type AuditSeverity,
} from "@kanvas/database";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { canonicalizeBackupValue } from "./backup-set-manifest.js";
import { failRecoveryVerification } from "./recovery-verification-error.js";

interface AuditEventRow extends RowDataPacket {
  readonly id: string;
  readonly schemaVersion: number;
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly actorPrincipalId: string | null;
  readonly actorType: string;
  readonly authenticationRefType: string;
  readonly authenticationRefHash: string | null;
  readonly authorityType: string;
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly authorizationModelVersion: number;
  readonly authorizationDecisionDigest: string;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: string;
  readonly decisionReasonCode: string;
  readonly severity: string;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly details: unknown;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly integrityDigest: string;
}

export interface AuditRecoveryEvidence {
  readonly auditEventCount: string;
  readonly auditInventoryDigest: string;
}

const actorTypes = new Set<string>(["human", "service", "system"]);
const authenticationRefTypes = new Set<string>([
  "session",
  "service_api_token",
  "deployment",
  "cli_recovery",
  "none",
]);
const authorityTypes = new Set<string>([
  "human_membership",
  "service_grant",
  "instance_administrator",
  "system",
  "none",
]);
const outcomes = new Set<string>(["succeeded", "denied", "failed"]);
const severities = new Set<string>(["info", "warning", "high", "critical"]);

function boundedBatchSize(value: number | undefined): number {
  const result = value ?? 250;
  if (!Number.isSafeInteger(result) || result < 1 || result > 1_000) {
    return failRecoveryVerification(
      "recovery_verification.invalid_argument",
      "Audit verification batch size is outside its bounded range.",
    );
  }
  return result;
}

function jsonObject(value: unknown): AuditJsonObject {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch (error) {
      return failRecoveryVerification(
        "recovery_verification.audit_integrity_mismatch",
        "Audit details contain invalid JSON.",
        error,
      );
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failRecoveryVerification(
      "recovery_verification.audit_integrity_mismatch",
      "Audit details are not a JSON object.",
    );
  }
  return parsed as AuditJsonObject;
}

function canonicalTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return failRecoveryVerification(
      "recovery_verification.audit_integrity_mismatch",
      "Audit timestamps were not read as UTC database timestamps.",
    );
  }
  return value.toISOString();
}

function materialFrom(row: AuditEventRow): AuditIntegrityMaterial {
  if (
    !actorTypes.has(row.actorType) ||
    !authenticationRefTypes.has(row.authenticationRefType) ||
    !authorityTypes.has(row.authorityType) ||
    !outcomes.has(row.outcome) ||
    !severities.has(row.severity)
  ) {
    return failRecoveryVerification(
      "recovery_verification.audit_integrity_mismatch",
      "Audit event contains an unsupported enum fact.",
    );
  }
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    actorPrincipalId: row.actorPrincipalId,
    actorType: row.actorType as AuditActorType,
    authenticationRefType:
      row.authenticationRefType as AuditAuthenticationRefType,
    authenticationRefHash: row.authenticationRefHash,
    authorityType: row.authorityType as AuditAuthorityType,
    authorityId: row.authorityId,
    authorityVersion: row.authorityVersion,
    authorizationModelVersion: row.authorizationModelVersion,
    authorizationDecisionDigest: row.authorizationDecisionDigest,
    eventType: row.eventType,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome as AuditOutcome,
    decisionReasonCode: row.decisionReasonCode,
    severity: row.severity as AuditSeverity,
    requestId: row.requestId,
    traceId: row.traceId,
    details: jsonObject(row.details),
    occurredAt: canonicalTimestamp(row.occurredAt),
    recordedAt: canonicalTimestamp(row.recordedAt),
  };
}

export async function verifyAuditRecoveryEvidence(options: {
  readonly pool: Pool;
  readonly batchSize?: number;
}): Promise<AuditRecoveryEvidence> {
  const batchSize = boundedBatchSize(options.batchSize);
  const hash = createHash("sha256");
  hash.update("kanvas:audit-integrity-inventory:v1\0", "utf8");
  hash.update('{"events":[', "utf8");
  let cursor = "";
  let count = 0n;
  let first = true;

  while (true) {
    let rows: readonly AuditEventRow[];
    try {
      [rows] = await options.pool.query<AuditEventRow[]>(
        `SELECT
           id,
           schema_version AS schemaVersion,
           organization_id AS organizationId,
           workspace_id AS workspaceId,
           actor_principal_id AS actorPrincipalId,
           actor_type AS actorType,
           authentication_ref_type AS authenticationRefType,
           authentication_ref_hash AS authenticationRefHash,
           authority_type AS authorityType,
           authority_id AS authorityId,
           authority_version AS authorityVersion,
           authorization_model_version AS authorizationModelVersion,
           authorization_decision_digest
             AS authorizationDecisionDigest,
           event_type AS eventType,
           action,
           resource_type AS resourceType,
           resource_id AS resourceId,
           outcome,
           decision_reason_code AS decisionReasonCode,
           severity,
           request_id AS requestId,
           trace_id AS traceId,
           details,
           occurred_at AS occurredAt,
           recorded_at AS recordedAt,
           integrity_digest AS integrityDigest
         FROM audit_event
         WHERE id > ?
         ORDER BY id ASC
         LIMIT ?`,
        [cursor, batchSize],
      );
    } catch (error) {
      return failRecoveryVerification(
        "recovery_verification.database_failure",
        "Audit events could not be read during recovery verification.",
        error,
      );
    }
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      let actual: string;
      try {
        actual = computeAuditIntegrityDigest(materialFrom(row));
      } catch (error) {
        return failRecoveryVerification(
          "recovery_verification.audit_integrity_mismatch",
          "Audit event integrity material is invalid.",
          error,
        );
      }
      if (actual !== row.integrityDigest) {
        return failRecoveryVerification(
          "recovery_verification.audit_integrity_mismatch",
          "Audit event integrity digest does not match persisted facts.",
        );
      }
      if (!first) {
        hash.update(",", "utf8");
      }
      hash.update(
        canonicalizeBackupValue({
          id: row.id,
          integrityDigest: row.integrityDigest,
        }),
        "utf8",
      );
      first = false;
      count += 1n;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) {
      break;
    }
  }

  hash.update("]}", "utf8");
  return Object.freeze({
    auditEventCount: count.toString(),
    auditInventoryDigest: `sha256:${hash.digest("hex")}`,
  });
}
