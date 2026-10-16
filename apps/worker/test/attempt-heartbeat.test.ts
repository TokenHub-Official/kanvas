import { describe, expect, it, vi } from "vitest";

import {
  AttemptCancellationRequestedError,
  AttemptHeartbeat,
  AttemptLeaseLostError,
} from "../src/queue/attempt-heartbeat.js";

describe("AttemptHeartbeat", () => {
  it("renews a lease from the current clock without exceeding its configured window", async () => {
    const heartbeat = vi.fn().mockResolvedValue("renewed");
    const controller = new AttemptHeartbeat({
      heartbeat,
      intervalMs: 10,
      leaseDurationMs: 30,
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(controller.runOnce()).resolves.toBe(true);
    expect(heartbeat).toHaveBeenCalledWith({
      now: new Date("2026-07-27T12:00:00.000Z"),
      leaseUntil: new Date("2026-07-27T12:00:00.030Z"),
    });
    expect(controller.signal.aborted).toBe(false);
    expect(() => controller.assertOwned()).not.toThrow();
  });

  it("aborts in-flight execution when the database rejects renewal", async () => {
    const controller = new AttemptHeartbeat({
      heartbeat: () => Promise.resolve("rejected"),
      intervalMs: 10,
      leaseDurationMs: 30,
    });

    await expect(controller.runOnce()).resolves.toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(() => controller.assertOwned()).toThrow(AttemptLeaseLostError);
  });

  it("aborts in-flight execution with a distinct cancellation signal", async () => {
    const controller = new AttemptHeartbeat({
      heartbeat: () => Promise.resolve("cancel_requested"),
      intervalMs: 10,
      leaseDurationMs: 30,
    });

    await expect(controller.runOnce()).resolves.toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(
      AttemptCancellationRequestedError,
    );
    expect(() => controller.assertOwned()).toThrow(
      AttemptCancellationRequestedError,
    );
  });

  it("fails closed when the renewal command errors", async () => {
    const controller = new AttemptHeartbeat({
      heartbeat: () => Promise.reject(new Error("database unavailable")),
      intervalMs: 10,
      leaseDurationMs: 30,
    });

    await expect(controller.runOnce()).resolves.toBe(false);
    expect(controller.signal.reason).toBeInstanceOf(AttemptLeaseLostError);
    expect(() => controller.assertOwned()).toThrow(
      /execution lease renewal failed/u,
    );
  });
});
