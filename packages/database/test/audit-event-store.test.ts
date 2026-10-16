import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
  AuditEventStoreError,
  canonicalizeAuditDetails,
  computeAuthorizationDecisionDigest,
  computeAuditIntegrityDigest,
  type AppendAuditEvent,
  type AuditIntegrityMaterial,
  type AuditJsonObject,
} from "../src/runtime/audit-event-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const occurredAt = new Date("2026-07-28T12:00:00.000Z");

function event(overrides: Partial<AppendAuditEvent> = {}): AppendAuditEvent {
  return {
    id: id(1),
    schemaVersion: auditEventSchemaVersion,
    organizationId: id(2),
    workspaceId: id(3),
    actorPrincipalId: id(4),
    actorType: "human",
    authenticationRefType: "session",
    authenticationRefHash: digest("a"),
    authorityType: "human_membership",
    authorityId: id(5),
    authorityVersion: 2,
    authorizationModelVersion: 1,
    authorizationDecision: Object.freeze({
      action: "asset.read",
      modelVersion: 1,
      outcome: "succeeded",
      reasonCode: "permission.allowed",
    }),
    eventType: "asset.read",
    action: "asset.read",
    resourceType: "asset",
    resourceId: id(6),
    outcome: "succeeded",
    decisionReasonCode: "permission.allowed",
    severity: "info",
    requestId: "request-1",
    traceId: "trace-1",
    details: Object.freeze({
      zeta: 2,
      alpha: 1,
    }),
    occurredAt,
    recordedAt: occurredAt,
    ...overrides,
  };
}

describe("Audit Event Store", () => {
  it("appends canonical, bounded facts and computes both required digests inside the caller transaction", async () => {
    const execute = vi.fn(() => Promise.resolve([{ affectedRows: 1 }, []]));
    const connection = {
      execute,
    } as unknown as PoolConnection;

    const appended = await appendAuditEventInTransaction(connection, event());

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, parameters] = execute.mock.calls[0] as unknown as [
      string,
      readonly unknown[],
    ];
    expect(sql).toContain("schema_version");
    expect(sql).toContain("authorization_decision_digest");
    expect(sql).toContain("integrity_digest");
    expect(parameters).toContain('{"alpha":1,"zeta":2}');
    expect(appended.authorizationDecisionDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(appended.integrityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(appended.detailsBytes).toBe(20);
    expect(connection).not.toHaveProperty("beginTransaction");
  });

  it("uses key-order-independent canonical decision and integrity digests", () => {
    const left = computeAuthorizationDecisionDigest({
      result: "allow",
      facts: {
        zeta: 2,
        alpha: 1,
      },
    });
    const right = computeAuthorizationDecisionDigest({
      facts: {
        alpha: 1,
        zeta: 2,
      },
      result: "allow",
    });
    expect(left).toBe(right);

    const material: AuditIntegrityMaterial = {
      id: id(1),
      schemaVersion: 1,
      organizationId: id(2),
      workspaceId: id(3),
      actorPrincipalId: id(4),
      actorType: "human",
      authenticationRefType: "session",
      authenticationRefHash: digest("a"),
      authorityType: "human_membership",
      authorityId: id(5),
      authorityVersion: 2,
      authorizationModelVersion: 1,
      authorizationDecisionDigest: left,
      eventType: "asset.read",
      action: "asset.read",
      resourceType: "asset",
      resourceId: id(6),
      outcome: "succeeded",
      decisionReasonCode: "permission.allowed",
      severity: "info",
      requestId: "request-1",
      traceId: "trace-1",
      details: {
        alpha: 1,
        zeta: 2,
      },
      occurredAt: occurredAt.toISOString(),
      recordedAt: occurredAt.toISOString(),
    };
    expect(computeAuditIntegrityDigest(material)).not.toBe(
      computeAuditIntegrityDigest({
        ...material,
        outcome: "failed",
      }),
    );
  });

  it.each([
    {
      name: "a secret-like nested field",
      details: {
        safe: {
          apiToken: "must-not-be-stored",
        },
      },
    },
    {
      name: "a non-JSON class instance",
      details: {
        when: new Date(),
      },
    },
    {
      name: "a non-finite number",
      details: {
        value: Number.NaN,
      },
    },
    {
      name: "an oversized value",
      details: {
        value: "x".repeat(8_192),
      },
    },
  ])("rejects $name before SQL", ({ details }) => {
    expect(() =>
      canonicalizeAuditDetails(details as unknown as AuditJsonObject),
    ).toThrowError(AuditEventStoreError);
  });

  it("rejects cycles and excessive depth without recursion overflow", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      canonicalizeAuditDetails(cyclic as unknown as AuditJsonObject),
    ).toThrowError(
      expect.objectContaining({
        code: "audit.payload_unsafe",
      }),
    );

    let deep: Record<string, unknown> = {
      value: true,
    };
    for (let index = 0; index < 10; index += 1) {
      deep = {
        child: deep,
      };
    }
    expect(() =>
      canonicalizeAuditDetails(deep as unknown as AuditJsonObject),
    ).toThrowError(
      expect.objectContaining({
        code: "audit.payload_unsafe",
      }),
    );
  });
});
