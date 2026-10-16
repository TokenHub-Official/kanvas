import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  consumeInboxEvent,
  type InboxDelivery,
} from "../src/runtime/inbox-receipt.js";

const eventId = "01KYKA0QD12FBVGHM9711TDKGF";
const workspaceId = "01KYKA0QD12FBVGHM9711TDKGA";
const aggregateId = "01KYKA0QD12FBVGHM9711TDKGB";
const receivedAt = new Date("2026-07-27T12:00:00.000Z");

const delivery: InboxDelivery = {
  consumerName: "workflow-orchestration.v1",
  eventId,
  workspaceId,
  messageType: "workflow.run.wakeup",
  schemaVersion: 1,
  aggregateType: "workflow_run",
  aggregateId,
  aggregateVersion: 2,
  expectedGeneration: 7,
  receivedAt,
};

const canonicalRow = {
  eventId,
  workspaceId,
  messageType: "workflow.run.wakeup",
  schemaVersion: 1,
  aggregateType: "workflow_run",
  aggregateId,
  aggregateVersion: 2,
  payload: {
    expectedGeneration: 7,
    workflowRunId: aggregateId,
  },
};

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
  } as ResultSetHeader;
}

describe("consumeInboxEvent", () => {
  it("runs the effect against the canonical event and persists its outcome", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[canonicalRow]])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([result()]);
    const effect = vi.fn().mockResolvedValue({
      outcome: "applied",
      resultCode: "workflow.started",
      value: {
        started: true,
      },
    });

    await expect(
      consumeInboxEvent(
        { execute } as unknown as PoolConnection,
        delivery,
        effect,
      ),
    ).resolves.toMatchObject({
      deliveryStatus: "processed",
      outcome: "applied",
      resultCode: "workflow.started",
      value: {
        started: true,
      },
      event: {
        payload: {
          workflowRunId: aggregateId,
        },
      },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      "INSERT INTO inbox_receipt",
    );
    expect(String(execute.mock.calls[2]?.[0])).toContain(
      "UPDATE inbox_receipt",
    );
  });

  it("returns the stored outcome without re-running a duplicate effect", async () => {
    const duplicate = Object.assign(new Error("duplicate"), {
      code: "ER_DUP_ENTRY",
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[canonicalRow]])
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce([
        [
          {
            workspaceId,
            messageType: delivery.messageType,
            schemaVersion: 1,
            aggregateType: delivery.aggregateType,
            aggregateId,
            aggregateVersion: 2,
            expectedGeneration: 7,
            effectOutcome: "noop",
            resultCode: "workflow.already_started",
          },
        ],
      ]);
    const effect = vi.fn();

    await expect(
      consumeInboxEvent(
        { execute } as unknown as PoolConnection,
        delivery,
        effect,
      ),
    ).resolves.toMatchObject({
      deliveryStatus: "duplicate",
      outcome: "noop",
      resultCode: "workflow.already_started",
    });
    expect(effect).not.toHaveBeenCalled();
    expect(String(execute.mock.calls[2]?.[0])).toContain("FOR UPDATE");
  });

  it("rejects queue metadata that disagrees with the canonical outbox event", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[canonicalRow]]);
    const effect = vi.fn();

    await expect(
      consumeInboxEvent(
        { execute } as unknown as PoolConnection,
        {
          ...delivery,
          workspaceId: "01KYKA0QD12FBVGHM9711TDKGC",
        },
        effect,
      ),
    ).rejects.toMatchObject({
      code: "inbox.event.envelope_mismatch",
    });
    expect(effect).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("lets an effect failure escape before a receipt can be finalized", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[canonicalRow]])
      .mockResolvedValueOnce([result()]);
    const effectError = new Error("domain write failed");

    await expect(
      consumeInboxEvent(
        { execute } as unknown as PoolConnection,
        delivery,
        async () => {
          await Promise.resolve();
          throw effectError;
        },
      ),
    ).rejects.toBe(effectError);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
