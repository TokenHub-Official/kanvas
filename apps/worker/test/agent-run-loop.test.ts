import { describe, expect, it, vi } from "vitest";

import { AgentRunLoop } from "../src/agent/agent-run-loop.js";
import type { AgentRunProcessor } from "../src/agent/agent-run-processor.js";

describe("AgentRunLoop", () => {
  it("keeps polling free lanes while another run is slow", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const slow = new Promise<boolean>((resolve) => {
      release = () => resolve(false);
    });
    const processNext = vi
      .fn<AgentRunProcessor["processNext"]>()
      .mockReturnValueOnce(slow)
      .mockResolvedValue(false);
    const loop = new AgentRunLoop({
      processor: { processNext },
      logger: { error: vi.fn() },
      pollIntervalMs: 1000,
      concurrency: 2,
      canClaim: () => Promise.resolve(true),
    });
    try {
      loop.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(processNext).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(processNext.mock.calls.length).toBeGreaterThan(2);
    } finally {
      release();
      await loop.stop();
      vi.useRealTimers();
    }
  });

  it("drains bounded available claims and stops cleanly", async () => {
    vi.useFakeTimers();
    const processNext = vi
      .fn<AgentRunProcessor["processNext"]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const loop = new AgentRunLoop({
      processor: { processNext },
      logger: { error: vi.fn() },
      pollIntervalMs: 1_000,
      concurrency: 1,
      canClaim: () => Promise.resolve(true),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(2);
    await loop.stop();
    vi.useRealTimers();
  });

  it("rechecks the runtime fence between claims and stops all lane timers", async () => {
    vi.useFakeTimers();
    const processNext = vi
      .fn<AgentRunProcessor["processNext"]>()
      .mockResolvedValue(true);
    const canClaim = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const loop = new AgentRunLoop({
      processor: { processNext },
      logger: { error: vi.fn() },
      pollIntervalMs: 1000,
      concurrency: 2,
      canClaim,
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledOnce();
    await loop.stop();
    const count = canClaim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(canClaim).toHaveBeenCalledTimes(count);
    vi.useRealTimers();
  });

  it("does not claim while the runtime fence is inactive", async () => {
    vi.useFakeTimers();
    const processNext = vi.fn<AgentRunProcessor["processNext"]>();
    const loop = new AgentRunLoop({
      processor: { processNext },
      logger: { error: vi.fn() },
      pollIntervalMs: 1_000,
      concurrency: 1,
      canClaim: () => Promise.resolve(false),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).not.toHaveBeenCalled();
    await loop.stop();
    vi.useRealTimers();
  });

  it("processes only the configured number of Agent Runs concurrently", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const processNext = vi.fn<AgentRunProcessor["processNext"]>(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return false;
    });
    const loop = new AgentRunLoop({
      processor: { processNext },
      logger: { error: vi.fn() },
      pollIntervalMs: 1_000,
      concurrency: 3,
      canClaim: () => Promise.resolve(true),
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(3);
    releases.forEach((release) => release());
    await loop.stop();
    vi.useRealTimers();
  });
});
