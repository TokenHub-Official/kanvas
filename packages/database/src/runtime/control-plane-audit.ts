import { authorizationModelVersion } from "@kanvas/application";
import type { PoolConnection } from "mysql2/promise";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
  type AuditActorType,
  type AuditAuthenticationRefType,
  type AuditAuthorityType,
  type AuditJsonObject,
  type AuditOutcome,
  type AuditSeverity,
} from "./audit-event-store.js";

export interface ControlPlaneAuditContext {
  readonly auditEventId: string;
  readonly actorPrincipalId: string | null;
  readonly actorType: AuditActorType;
  readonly authenticationRefType: AuditAuthenticationRefType;
  readonly authenticationRefHash: string | null;
  readonly authorityType: AuditAuthorityType;
  readonly authorityId: string | null;
  readonly authorityVersion: number | null;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface ControlPlaneAuditEvent {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly eventType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: AuditOutcome;
  readonly decisionReasonCode: string;
  readonly severity: AuditSeverity;
  readonly authorizationDecision: AuditJsonObject;
  readonly details: AuditJsonObject;
  readonly occurredAt: Date;
}

export async function appendControlPlaneAuditEventInTransaction(
  connection: PoolConnection,
  context: ControlPlaneAuditContext,
  event: ControlPlaneAuditEvent,
): Promise<void> {
  await appendAuditEventInTransaction(connection, {
    id: context.auditEventId,
    schemaVersion: auditEventSchemaVersion,
    organizationId: event.organizationId,
    workspaceId: event.workspaceId,
    actorPrincipalId: context.actorPrincipalId,
    actorType: context.actorType,
    authenticationRefType: context.authenticationRefType,
    authenticationRefHash: context.authenticationRefHash,
    authorityType: context.authorityType,
    authorityId: context.authorityId,
    authorityVersion: context.authorityVersion,
    authorizationModelVersion,
    authorizationDecision: event.authorizationDecision,
    eventType: event.eventType,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    decisionReasonCode: event.decisionReasonCode,
    severity: event.severity,
    requestId: context.requestId ?? null,
    traceId: context.traceId ?? null,
    details: event.details,
    occurredAt: event.occurredAt,
    recordedAt: event.occurredAt,
  });
}
