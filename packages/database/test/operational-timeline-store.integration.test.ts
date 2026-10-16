import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { createPool, type Pool } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "../src/runtime/audit-event-store.js";
import { createOperationalTimelineStore } from "../src/runtime/operational-timeline-store.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const organizationId = id(7_100_001);
const workspaceId = id(7_100_002);
const principalId = id(7_100_003);
const membershipId = id(7_100_004);
const workflowRevisionId = id(7_100_005);
const workflowRunId = id(7_100_006);
const eventIds = Object.freeze([
  id(7_100_010),
  id(7_100_011),
  id(7_100_012),
  id(7_100_013),
  id(7_100_014),
]);
const occurredAt = new Date("2026-08-05T20:00:00.000Z");

describe.skipIf(!integrationEnabled)(
  "Operational Timeline Store against a disposable MySQL database",
  () => {
    let pool!: Pool;

    beforeAll(async () => {
      const connectionConfig = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: connectionConfig.host,
        port: connectionConfig.port,
        database: connectionConfig.database,
        user: connectionConfig.user,
        password: connectionConfig.password,
        connectionLimit: 4,
        timezone: "Z",
        decimalNumbers: false,
      });
      const cleanupConnection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(cleanupConnection);
      } finally {
        cleanupConnection.release();
      }

      const topology = {
        schemaVersion: 1,
        key: "operational_timeline_integration",
        entryNodeKey: "review",
        limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
        nodes: [
          {
            key: "review",
            kind: "approval",
            request: {},
            decisionSchema: { approved: true },
            next: [],
          },
        ],
        outputs: {},
      } as const;
      await pool.execute(
        `INSERT INTO principal (
           id, principal_type, status, version, created_at, updated_at
         ) VALUES (?, 'human', 'active', 1, ?, ?)`,
        [principalId, occurredAt, occurredAt],
      );
      await pool.execute(
        `INSERT INTO human_principal (
           principal_id, auth_subject_id, created_at
         ) VALUES (?, 'operational-timeline-integration', ?)`,
        [principalId, occurredAt],
      );
      await pool.execute(
        `INSERT INTO organization (
           id, slug, name, status, version, created_at, updated_at
         ) VALUES (
           ?, 'operational-timeline-integration',
           'Operational Timeline Integration', 'active', 1, ?, ?
         )`,
        [organizationId, occurredAt, occurredAt],
      );
      await pool.execute(
        `INSERT INTO workspace (
           id, organization_id, slug, name, status, version,
           created_at, updated_at
         ) VALUES (
           ?, ?, 'operational-timeline-integration',
           'Operational Timeline Integration', 'active', 1, ?, ?
         )`,
        [workspaceId, organizationId, occurredAt, occurredAt],
      );
      await pool.execute(
        `INSERT INTO workspace_membership (
           id, organization_id, workspace_id, principal_id,
           role, status, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
        [
          membershipId,
          organizationId,
          workspaceId,
          principalId,
          occurredAt,
          occurredAt,
        ],
      );
      await pool.execute(
        `INSERT INTO workflow_revision (
           id, workspace_id, workflow_key, revision, lifecycle_status,
           canonical_digest, topology, input_schema, output_schema,
           created_at, published_at
         ) VALUES (
           ?, ?, 'operational-timeline-integration', 1, 'published',
           ?, ?, ?, ?, ?, ?
         )`,
        [
          workflowRevisionId,
          workspaceId,
          digest("a"),
          JSON.stringify(topology),
          JSON.stringify({ type: "object" }),
          JSON.stringify({ type: "object" }),
          occurredAt,
          occurredAt,
        ],
      );
      const runUpdatedAt = new Date(occurredAt.getTime() + 6_000);
      await pool.execute(
        `INSERT INTO workflow_run (
           id, workspace_id, workflow_revision_id,
           idempotency_key, request_hash, lifecycle_status, outcome,
           input, execution_deadline_at, execution_plan_snapshot,
           execution_plan_hash,
           created_by, version, created_at, updated_at, completed_at
         ) VALUES (
           ?, ?, ?, 'operational-timeline-integration', ?,
           'failed', 'no_usable_output', ?, ?, ?, ?, ?, 1, ?, ?, ?
         )`,
        [
          workflowRunId,
          workspaceId,
          workflowRevisionId,
          digest("b"),
          JSON.stringify({}),
          new Date(occurredAt.getTime() + topology.limits.timeoutMs),
          JSON.stringify({
            schemaVersion: 1,
            topology,
            routes: [],
          }),
          digest("c"),
          principalId,
          occurredAt,
          runUpdatedAt,
          runUpdatedAt,
        ],
      );

      const auditConnection = await pool.getConnection();
      try {
        for (let index = 0; index < eventIds.length; index += 1) {
          const eventId = eventIds[index];
          if (!eventId) {
            throw new Error(
              "Operational Timeline fixture Event ID is missing.",
            );
          }
          const eventOccurredAt = new Date(
            occurredAt.getTime() + (index + 1) * 1_000,
          );
          await appendAuditEventInTransaction(auditConnection, {
            id: eventId,
            schemaVersion: auditEventSchemaVersion,
            organizationId,
            workspaceId,
            actorPrincipalId: null,
            actorType: "system",
            authenticationRefType: "none",
            authenticationRefHash: null,
            authorityType: "system",
            authorityId: null,
            authorityVersion: null,
            authorizationModelVersion,
            authorizationDecision: {
              decision: "allow",
              permission: "audit.read",
            },
            eventType: "operational.timeline.integration",
            action: `operational.timeline.event.${String(index)}`,
            resourceType: "workflow_run",
            resourceId: workflowRunId,
            outcome: "succeeded",
            decisionReasonCode: "operational.timeline.integration.recorded",
            severity: "info",
            requestId: `operational-timeline-${String(index)}`,
            traceId: null,
            details: {
              index,
            },
            occurredAt: eventOccurredAt,
            recordedAt: eventOccurredAt,
          });
        }
      } finally {
        auditConnection.release();
      }
    }, 30_000);

    afterAll(async () => {
      await pool?.end();
    });

    it("returns the latest bounded set in chronological order", async () => {
      const authority: TrustedWorkspaceScope = {
        workspaceId,
        organizationId,
        principalId,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: id(7_100_020),
        authorityType: "human_membership",
        authorityId: membershipId,
        authorityVersion: 1,
        authorizationModelVersion,
        effectivePermissions: permissionsForWorkspaceRole("admin"),
        trusted: true,
      };
      const timeline = await createOperationalTimelineStore(pool).get({
        authority,
        workflowRunId,
        now: new Date("2026-08-05T20:01:00.000Z"),
        limit: 3,
      });

      const store = createOperationalTimelineStore(pool);
      const list = await store.list({
        authority,
        query: { status: "failed", creator: principalId },
        now: occurredAt,
      });
      expect(list.items).toMatchObject([
        { id: workflowRunId, kind: "workflow", status: "failed" },
      ]);
      expect(
        (
          await store.list({
            authority,
            query: { reference: id(999) },
            now: occurredAt,
          })
        ).items,
      ).toEqual([]);
      await expect(
        store.list({
          authority,
          query: { cursor: "invalid" },
          now: occurredAt,
        }),
      ).rejects.toMatchObject({
        code: "operational_timeline.invalid_argument",
      });

      for (const [index, status, outcome] of [
        [1, "completed", "full_success"],
        [2, "running", null],
      ] as const) {
        await pool.execute(
          `INSERT INTO workflow_run (id, workspace_id, workflow_revision_id, idempotency_key, request_hash, lifecycle_status, outcome, input, execution_deadline_at, execution_plan_snapshot, execution_plan_hash, created_by, version, created_at, updated_at, completed_at)
           SELECT ?, workspace_id, workflow_revision_id, ?, request_hash, ?, ?, input, execution_deadline_at, execution_plan_snapshot, execution_plan_hash, created_by, 1, created_at, updated_at, ? FROM workflow_run WHERE id = ?`,
          [
            id(7_100_100 + index),
            "directory-" + index,
            status,
            outcome,
            status === "completed" ? occurredAt : null,
            workflowRunId,
          ],
        );
      }
      const firstPage = await store.list({
        authority,
        query: { limit: "2" },
        now: occurredAt,
      });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toBeDefined();
      const nextPage = await store.list({
        authority,
        query: { limit: "2", cursor: firstPage.nextCursor! },
        now: occurredAt,
      });
      expect(nextPage.items.map((item) => item.id)).toEqual([workflowRunId]);
      expect(
        (
          await store.list({
            authority,
            query: { status: "succeeded" },
            now: occurredAt,
          })
        ).items,
      ).toHaveLength(1);
      expect(
        (
          await store.list({
            authority,
            query: { status: "active" },
            now: occurredAt,
          })
        ).items,
      ).toHaveLength(1);
      await pool.execute(
        "UPDATE workspace_membership SET role = 'viewer', version = 2 WHERE id = ?",
        [membershipId],
      );
      await expect(
        store.list({
          authority: { ...authority, authorityVersion: 2 },
          query: {},
          now: occurredAt,
        }),
      ).rejects.toMatchObject({ code: "operational_timeline.forbidden" });
      expect(timeline.truncated).toBe(true);
      expect(timeline.items.map(({ id: itemId }) => itemId)).toEqual([
        eventIds[3],
        eventIds[4],
        workflowRunId,
      ]);
      expect(
        timeline.items.every(
          (item, index, items) =>
            index === 0 || items[index - 1]!.occurredAt <= item.occurredAt,
        ),
      ).toBe(true);
    });
  },
);
