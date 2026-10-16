import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeConfigurationReader } from "@kanvas/database/runtime";
import type { RuntimeConfigurationRevision } from "@kanvas/contracts/api";
import { RuntimeConfigurationObserver } from "../src/provider/runtime-configuration-observer.js";
const revision: RuntimeConfigurationRevision = {
  version: 1,
  document: {
    activated: true,
    agent: {
      maximumModelCalls: 50,
      maximumToolCalls: 100,
      timeoutSeconds: 600,
    },
    downloads: {
      defaults: { enabled: true, allowedOrigins: [] },
      providers: [],
    },
  },
  reason: "test",
  publishedBy: "admin",
  publishedAt: new Date().toISOString(),
  restoredFromVersion: null,
};
afterEach(() => vi.useRealTimers());
describe("automatic runtime source observation", () => {
  it("reports the effective source and switches after activation without restarting", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<RuntimeConfigurationRevision | null>>()
      .mockResolvedValue(null);
    const reader = createRuntimeConfigurationReader(load);
    const observeWorker = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeConfigurationObserver(
      { readEffective: () => reader.read(), observeWorker },
      "worker",
      {
        downloadsEnabled: true,
        allowedOrigins: ["https://legacy.example"],
        serviceVersion: "test",
      },
      vi.fn(),
    );
    await observer.start();
    expect(observeWorker.mock.calls[0]?.[0]).toMatchObject({
      deployment: { source: "environment" },
      configurationVersion: null,
    });
    load.mockResolvedValue(revision);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(observeWorker.mock.calls[1]?.[0]).toMatchObject({
      deployment: { source: "instance" },
      configurationVersion: 1,
    });
    await observer.stop();
  });
  it("does not report legacy defaults as effective when reading fails", async () => {
    vi.useFakeTimers();
    const reader = createRuntimeConfigurationReader(
      vi.fn().mockRejectedValue(new Error("database unavailable")),
    );
    const observeWorker = vi.fn();
    const onError = vi.fn();
    const observer = new RuntimeConfigurationObserver(
      { readEffective: () => reader.read(), observeWorker },
      "worker",
      { downloadsEnabled: true, allowedOrigins: null, serviceVersion: "test" },
      onError,
    );
    await observer.start();
    expect(onError).toHaveBeenCalledOnce();
    expect(observeWorker).not.toHaveBeenCalled();
    await observer.stop();
  });
});
