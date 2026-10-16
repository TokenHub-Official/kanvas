import { RuntimeFenceRejectedError } from "@kanvas/application";
import {
  InboxDeliveryError,
  type QueueDeliveryFailureStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { PermanentInboxDeliveryError } from "../src/queue/inbox-delivery.js";
import {
  createUnsupportedQueueJobError,
  runQueueJobSafely,
} from "../src/queue/queue-job-safety.js";

const now = new Date("2026-07-27T12:00:00.000Z");
const eventId = "01K00000000000000000000001";

function dependencies() {
  const recordQuarantined = vi.fn().mockResolvedValue(undefined);
  const warn = vi.fn();
  return {
    failureStore: {
      recordQuarantined,
    } as unknown as Pick<QueueDeliveryFailureStore, "recordQuarantined">,
    logger: {
      warn,
    } as unknown as Pick<Logger, "warn">,
    recordQuarantined,
    warn,
  };
}

describe("runQueueJobSafely", () => {
  it("is transparent for a successful handler", async () => {
    const subject = dependencies();
    const value = Object.freeze({ claimed: true });

    await expect(
      runQueueJobSafely({
        queueName: "kanvas-execution",
        consumerName: "attempt-dispatch.v1",
        jobId: eventId,
        data: { outboxEventId: eventId },
        handler: () => Promise.resolve(value),
        failureStore: subject.failureStore,
        logger: subject.logger,
        now: () => now,
      }),
    ).resolves.toBe(value);
    expect(subject.recordQuarantined).not.toHaveBeenCalled();
    expect(subject.warn).not.toHaveBeenCalled();
  });

  it("durably quarantines and ACKs a permanent parser error", async () => {
    const subject = dependencies();
    const data = {
      outboxEventId: eventId,
      secretPrompt: "must-never-be-recorded-or-logged",
    };

    const result = await runQueueJobSafely({
      queueName: "kanvas-execution",
      consumerName: "attempt-dispatch.v1",
      jobId: "bull-job-7",
      data,
      handler: () =>
        Promise.reject(
          new PermanentInboxDeliveryError(
            "delivery.schema_version_unsupported",
          ),
        ),
      failureStore: subject.failureStore,
      logger: subject.logger,
      now: () => now,
    });

    expect(result).toEqual({
      deliveryStatus: "quarantined",
      resultCode: "queue.delivery.quarantined",
      jobId: "bull-job-7",
      errorCode: "delivery.schema_version_unsupported",
    });
    expect(subject.recordQuarantined).toHaveBeenCalledWith({
      consumerName: "attempt-dispatch.v1",
      queueName: "kanvas-execution",
      jobId: "bull-job-7",
      outboxEventId: eventId,
      errorCode: "delivery.schema_version_unsupported",
      observedAt: now,
    });
    const observableOutput = JSON.stringify({
      persisted: subject.recordQuarantined.mock.calls,
      logged: subject.warn.mock.calls,
      result,
    });
    expect(observableOutput).not.toContain(data.secretPrompt);
    expect(subject.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "delivery.schema_version_unsupported",
      }),
      "Permanent queue delivery was quarantined.",
    );
  });

  it("also quarantines a canonical database Inbox delivery error", async () => {
    const subject = dependencies();

    await expect(
      runQueueJobSafely({
        queueName: "kanvas-orchestration",
        consumerName: "workflow-orchestration.v1",
        jobId: eventId,
        data: { outboxEventId: "not-a-trusted-id" },
        handler: () =>
          Promise.reject(
            new InboxDeliveryError("inbox.event.envelope_mismatch"),
          ),
        failureStore: subject.failureStore,
        logger: subject.logger,
        now: () => now,
      }),
    ).resolves.toEqual({
      deliveryStatus: "quarantined",
      resultCode: "queue.delivery.quarantined",
      jobId: eventId,
      errorCode: "inbox.event.envelope_mismatch",
    });
    expect(subject.recordQuarantined).toHaveBeenCalledWith({
      consumerName: "workflow-orchestration.v1",
      queueName: "kanvas-orchestration",
      jobId: eventId,
      errorCode: "inbox.event.envelope_mismatch",
      observedAt: now,
    });
  });

  it("ACKs a stale execution generation without recording poison", async () => {
    const subject = dependencies();

    await expect(
      runQueueJobSafely({
        queueName: "kanvas-execution",
        consumerName: "attempt-dispatch.v1",
        jobId: eventId,
        data: { outboxEventId: eventId },
        handler: () =>
          Promise.reject(
            new RuntimeFenceRejectedError(
              "claim",
              "ACTIVE",
              "stale_execution_generation",
              "sensitive runtime explanation",
            ),
          ),
        failureStore: subject.failureStore,
        logger: subject.logger,
        now: () => now,
      }),
    ).resolves.toEqual({
      deliveryStatus: "ignored",
      resultCode: "queue.delivery.stale_execution_generation",
      jobId: eventId,
      reasonCode: "stale_execution_generation",
    });
    expect(subject.recordQuarantined).not.toHaveBeenCalled();
    expect(JSON.stringify(subject.warn.mock.calls)).not.toContain(
      "sensitive runtime explanation",
    );
  });

  it.each([
    {
      name: "runtime state disallowed",
      error: new RuntimeFenceRejectedError(
        "claim",
        "MAINTENANCE",
        "runtime_state_disallowed",
        "retry after activation",
      ),
    },
    {
      name: "unknown handler failure",
      error: new Error("transient database outage"),
    },
  ])("rethrows $name", async ({ error }) => {
    const subject = dependencies();

    await expect(
      runQueueJobSafely({
        queueName: "kanvas-execution",
        consumerName: "attempt-dispatch.v1",
        jobId: eventId,
        data: { outboxEventId: eventId },
        handler: () => Promise.reject(error),
        failureStore: subject.failureStore,
        logger: subject.logger,
        now: () => now,
      }),
    ).rejects.toBe(error);
    expect(subject.recordQuarantined).not.toHaveBeenCalled();
    expect(subject.warn).not.toHaveBeenCalled();
  });

  it("rethrows a quarantine persistence failure instead of ACKing", async () => {
    const subject = dependencies();
    const persistenceFailure = new Error("database unavailable");
    subject.recordQuarantined.mockRejectedValueOnce(persistenceFailure);

    await expect(
      runQueueJobSafely({
        queueName: "kanvas-execution",
        consumerName: "attempt-dispatch.v1",
        jobId: eventId,
        data: { outboxEventId: eventId },
        handler: () =>
          Promise.reject(
            new PermanentInboxDeliveryError("delivery.payload_not_object"),
          ),
        failureStore: subject.failureStore,
        logger: subject.logger,
        now: () => now,
      }),
    ).rejects.toBe(persistenceFailure);
    expect(subject.warn).not.toHaveBeenCalled();
  });

  it("uses a stable canonical SHA-256 fingerprint when BullMQ has no job id", async () => {
    const first = dependencies();
    const second = dependencies();

    const firstResult = await runQueueJobSafely({
      queueName: "kanvas-execution",
      consumerName: "attempt-dispatch.v1",
      data: {
        nested: { second: 2, first: 1 },
        list: ["x", true],
      },
      handler: () =>
        Promise.reject(
          new PermanentInboxDeliveryError("delivery.event_id_invalid"),
        ),
      failureStore: first.failureStore,
      logger: first.logger,
      now: () => now,
    });
    const secondResult = await runQueueJobSafely({
      queueName: "kanvas-execution",
      consumerName: "attempt-dispatch.v1",
      data: {
        list: ["x", true],
        nested: { first: 1, second: 2 },
      },
      handler: () =>
        Promise.reject(
          new PermanentInboxDeliveryError("delivery.event_id_invalid"),
        ),
      failureStore: second.failureStore,
      logger: second.logger,
      now: () => now,
    });

    expect(firstResult.deliveryStatus).toBe("quarantined");
    expect(firstResult.jobId).toMatch(/^payload-sha256:[a-f0-9]{64}$/u);
    expect(secondResult).toMatchObject({
      deliveryStatus: "quarantined",
      jobId: firstResult.jobId,
    });
    expect(first.recordQuarantined.mock.calls[0]?.[0]).toMatchObject({
      jobId: firstResult.jobId,
    });
  });

  it("creates an allowlisted unsupported-job error without embedding a job name", () => {
    const error = createUnsupportedQueueJobError();

    expect(error).toBeInstanceOf(PermanentInboxDeliveryError);
    expect(error.code).toBe("delivery.job_unsupported");
    expect(error.message).toBe("delivery.job_unsupported");
  });
});
