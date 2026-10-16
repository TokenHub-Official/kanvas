import {
  computeAuditIntegrityDigest,
  type AuditIntegrityMaterial,
} from "@kanvas/database";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { verifyAuditRecoveryEvidence } from "../src/index.js";

const material: AuditIntegrityMaterial = Object.freeze({
  id: "01K00000000000000000000001",
  schemaVersion: 1,
  organizationId: null,
  workspaceId: null,
  actorPrincipalId: null,
  actorType: "system",
  authenticationRefType: "cli_recovery",
  authenticationRefHash: `sha256:${"1".repeat(64)}`,
  authorityType: "system",
  authorityId: null,
  authorityVersion: null,
  authorizationModelVersion: 1,
  authorizationDecisionDigest: `sha256:${"2".repeat(64)}`,
  eventType: "recovery.verification_started",
  action: "verification_started",
  resourceType: "recovery_operation",
  resourceId: "01K00000000000000000000002",
  outcome: "succeeded",
  decisionReasonCode: "recovery.verification_started",
  severity: "high",
  requestId: null,
  traceId: null,
  details: {
    runtimeState: "VERIFYING",
  },
  occurredAt: "2026-07-28T22:00:00.000Z",
  recordedAt: "2026-07-28T22:00:00.000Z",
});

function poolFor(integrityDigest: string): Pool {
  let returned = false;
  return {
    query: vi.fn(() => {
      if (returned) {
        return Promise.resolve([[], []]);
      }
      returned = true;
      return Promise.resolve([
        [
          {
            ...material,
            details: material.details,
            occurredAt: new Date(material.occurredAt),
            recordedAt: new Date(material.recordedAt),
            integrityDigest,
          },
        ],
        [],
      ]);
    }),
  } as unknown as Pool;
}

describe("Audit recovery evidence", () => {
  it("recomputes every event integrity digest", async () => {
    const evidence = await verifyAuditRecoveryEvidence({
      pool: poolFor(computeAuditIntegrityDigest(material)),
    });

    expect(evidence.auditEventCount).toBe("1");
    expect(evidence.auditInventoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fails closed when a persisted event is changed", async () => {
    await expect(
      verifyAuditRecoveryEvidence({
        pool: poolFor(`sha256:${"f".repeat(64)}`),
      }),
    ).rejects.toMatchObject({
      code: "recovery_verification.audit_integrity_mismatch",
    });
  });
});
