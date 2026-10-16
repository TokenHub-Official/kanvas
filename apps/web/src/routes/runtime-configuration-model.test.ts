import { describe, expect, it } from "vitest";
import type { RuntimeConfigurationWorker } from "@kanvas/contracts/api";
import {
  deploymentImport,
  recentConfigurationWorkers,
} from "./runtime-configuration-model.js";
const now = Date.parse("2026-10-10T12:00:00Z");
const worker: RuntimeConfigurationWorker = {
  workerId: "worker",
  deployment: {
    source: "environment",
    downloadsEnabled: true,
    allowedOrigins: ["https://cdn.example"],
    serviceVersion: "test",
  },
  configurationVersion: null,
  observedAt: new Date(now).toISOString(),
};
describe("Runtime configuration migration review", () => {
  it("imports matching live deployment settings without activating them", () => {
    expect(deploymentImport([worker], now)).toMatchObject({
      activated: false,
      agent: {
        maximumModelCalls: 50,
        maximumToolCalls: 100,
        timeoutSeconds: 600,
      },
      downloads: {
        defaults: { enabled: true, allowedOrigins: ["https://cdn.example"] },
      },
    });
  });
  it("does not guess configuration from missing, stale or conflicting workers", () => {
    expect(deploymentImport([], now)).toBeUndefined();
    expect(
      deploymentImport(
        [{ ...worker, observedAt: new Date(now - 100_000).toISOString() }],
        now,
      ),
    ).toBeUndefined();
    expect(
      deploymentImport(
        [
          worker,
          {
            ...worker,
            workerId: "other",
            deployment: { ...worker.deployment, allowedOrigins: [] },
          },
        ],
        now,
      ),
    ).toBeUndefined();
    expect(
      recentConfigurationWorkers(
        [
          { ...worker, observedAt: "invalid" },
          { ...worker, observedAt: new Date(now + 60_000).toISOString() },
        ],
        now,
      ),
    ).toEqual([]);
  });
});
