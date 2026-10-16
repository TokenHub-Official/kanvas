import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createQueueDeliveryFailureStore } from "../src/runtime/queue-delivery-failure-store.js";

const eventId = "01KYKA0QD12FBVGHM9711TDKGF";
const observedAt = new Date("2026-07-27T12:00:00.000Z");

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
  } as ResultSetHeader;
}

function poolWithConnection(execute: ReturnType<typeof vi.fn>): {
  readonly pool: Pool;
  readonly beginTransaction: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
} {
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const connection = {
    beginTransaction,
    commit,
    rollback,
    release,
    execute,
  } as unknown as PoolConnection;
  return {
    pool: {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool,
    beginTransaction,
    commit,
    rollback,
    release,
  };
}

describe("QueueDeliveryFailureStore", () => {
  it("records an allowlisted durable quarantine fact", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([
        [
          {
            consumerName: "attempt-dispatch.v1",
            queueName: "workflow-execution",
            jobId: eventId,
            outboxEventId: eventId,
            errorCode: "inbox.event.envelope_mismatch",
            occurrenceCount: 2,
            resolutionStatus: "quarantined",
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
            resolvedAt: null,
          },
        ],
      ]);
    const transaction = poolWithConnection(execute);
    const { pool } = transaction;
    const store = createQueueDeliveryFailureStore(pool);

    await expect(
      store.recordQuarantined({
        consumerName: "attempt-dispatch.v1",
        queueName: "workflow-execution",
        jobId: eventId,
        outboxEventId: eventId,
        errorCode: "inbox.event.envelope_mismatch",
        observedAt,
      }),
    ).resolves.toMatchObject({
      outboxEventId: eventId,
      occurrenceCount: 2,
      resolutionStatus: "quarantined",
    });
    expect(transaction.beginTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(transaction.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when a queue job identity points at a different event", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([
        [
          {
            consumerName: "attempt-dispatch.v1",
            queueName: "workflow-execution",
            jobId: eventId,
            outboxEventId: "01KYKA0QD12FBVGHM9711TDKGB",
            errorCode: "inbox.event.envelope_mismatch",
            occurrenceCount: 1,
            resolutionStatus: "quarantined",
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
            resolvedAt: null,
          },
        ],
      ]);
    const transaction = poolWithConnection(execute);
    const { pool } = transaction;
    const store = createQueueDeliveryFailureStore(pool);

    await expect(
      store.recordQuarantined({
        consumerName: "attempt-dispatch.v1",
        queueName: "workflow-execution",
        jobId: eventId,
        outboxEventId: eventId,
        errorCode: "inbox.event.envelope_mismatch",
        observedAt,
      }),
    ).rejects.toMatchObject({
      code: "queue_delivery_failure.identity_conflict",
    });
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.release).toHaveBeenCalledTimes(1);
  });

  it("allows an operator path to resolve a quarantined delivery", async () => {
    const execute = vi.fn().mockResolvedValue([result()]);
    const store = createQueueDeliveryFailureStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.setResolution({
        consumerName: "attempt-dispatch.v1",
        queueName: "workflow-execution",
        jobId: eventId,
        resolution: "resolved",
        resolvedAt: observedAt,
      }),
    ).resolves.toBe(true);
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "resolution_status = 'quarantined'",
    );
  });
});
