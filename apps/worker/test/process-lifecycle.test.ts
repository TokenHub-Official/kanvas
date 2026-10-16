import { describe, expect, it } from "vitest";

import { WorkerProcessLifecycle } from "../src/process-lifecycle.js";

describe("WorkerProcessLifecycle", () => {
  it("closes process-owned resources in drain order and only once", async () => {
    const order: string[] = [];
    const lifecycle = new WorkerProcessLifecycle({
      stopClaiming: () => {
        order.push("claims");
        return Promise.resolve();
      },
      stopHealth: () => {
        order.push("health");
        return Promise.resolve();
      },
      closeApplication: () => {
        order.push("application");
        return Promise.resolve();
      },
      closeRedis: () => {
        order.push("redis");
      },
      closeDatabase: () => {
        order.push("database");
        return Promise.resolve();
      },
      shutdownTelemetry: () => {
        order.push("telemetry");
        return Promise.resolve();
      },
    });

    await lifecycle.shutdown();
    await lifecycle.shutdown();

    expect(order).toEqual([
      "claims",
      "health",
      "application",
      "redis",
      "database",
      "telemetry",
    ]);
  });

  it("continues closing later resources after an earlier close fails", async () => {
    const order: string[] = [];
    const lifecycle = new WorkerProcessLifecycle({
      stopClaiming: () => Promise.reject(new Error("claim close failed")),
      stopHealth: () => {
        order.push("health");
        return Promise.resolve();
      },
      closeApplication: () => Promise.resolve(),
      closeRedis: () => undefined,
      closeDatabase: () => {
        order.push("database");
        return Promise.resolve();
      },
      shutdownTelemetry: () => {
        order.push("telemetry");
        return Promise.resolve();
      },
    });

    await expect(lifecycle.shutdown()).rejects.toBeInstanceOf(AggregateError);
    expect(order).toEqual(["health", "database", "telemetry"]);
  });
});
