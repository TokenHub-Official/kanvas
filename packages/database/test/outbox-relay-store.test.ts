import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createOutboxRelayStore } from "../src/runtime/outbox-relay-store.js";

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
  } as ResultSetHeader;
}

describe("OutboxRelayStore", () => {
  it("claims raw payloads and schema versions without decoding the whole batch", async () => {
    const rows = [
      {
        id: "event-malformed",
        workspaceId: "workspace",
        messageType: "workflow.wakeup.requested",
        schemaVersion: 1,
        aggregateType: "workflow_run",
        aggregateId: "workflow-malformed",
        aggregateVersion: 1,
        publishAttempts: 0,
        payload: "{not-json",
      },
      {
        id: "event-valid",
        workspaceId: "workspace",
        messageType: "workflow.wakeup.requested",
        schemaVersion: 1,
        aggregateType: "workflow_run",
        aggregateId: "workflow-valid",
        aggregateVersion: 2,
        publishAttempts: 2,
        payload: {
          workflowRunId: "workflow-valid",
          expectedGeneration: 7,
        },
      },
    ];
    const query = vi.fn().mockResolvedValue([rows]);
    const execute = vi.fn().mockResolvedValue([result()]);
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query,
      execute,
      commit,
      rollback,
      release: vi.fn(),
    } as unknown as PoolConnection;
    const store = createOutboxRelayStore({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);

    await expect(
      store.claimBatch({
        batchSize: 20,
        leaseTokenHash: "lease",
        leaseUntil: new Date("2026-07-27T12:00:30.000Z"),
      }),
    ).resolves.toEqual([
      {
        ...rows[0],
        publishAttempts: 1,
      },
      {
        ...rows[1],
        publishAttempts: 3,
      },
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "schema_version AS schemaVersion",
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("atomically quarantines only the event held by the matching lease", async () => {
    const execute = vi.fn().mockResolvedValue([result()]);
    const store = createOutboxRelayStore({
      execute,
    } as unknown as Pool);
    const quarantinedAt = new Date("2026-07-27T12:00:00.000Z");

    await expect(
      store.markQuarantined({
        eventId: "event",
        leaseTokenHash: "lease",
        errorCode: "outbox.invalid_payload",
        quarantinedAt,
      }),
    ).resolves.toBe(true);

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("SET status = 'quarantined'");
    expect(sql).toContain("last_error_code = ?");
    expect(sql).toContain("quarantined_at = ?");
    expect(sql).toContain("AND status = 'leased'");
    expect(sql).toContain("AND lease_token_hash = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "outbox.invalid_payload",
      quarantinedAt,
      "event",
      "lease",
    ]);
  });

  it("atomically supersedes a stale-generation event held by the matching lease", async () => {
    const execute = vi.fn().mockResolvedValue([result()]);
    const store = createOutboxRelayStore({
      execute,
    } as unknown as Pool);
    const supersededAt = new Date("2026-07-27T12:00:00.000Z");

    await expect(
      store.markSuperseded({
        eventId: "event",
        leaseTokenHash: "lease",
        errorCode: "outbox.stale_execution_generation",
        supersededAt,
      }),
    ).resolves.toBe(true);

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("SET status = 'superseded'");
    expect(sql).toContain("superseded_at = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "outbox.stale_execution_generation",
      supersededAt,
      "event",
      "lease",
    ]);
  });
});
