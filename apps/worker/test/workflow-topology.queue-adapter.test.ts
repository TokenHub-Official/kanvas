import {
  createApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import { describe, expect, it } from "vitest";

import { WorkflowTopologyQueueAdapter } from "../src/queue/workflow-topology.queue-adapter.js";

const activeStateReader: RuntimeStateReader = {
  read: () =>
    Promise.resolve({
      state: "ACTIVE",
      executionGeneration: 3,
      stateVersion: 1,
    }),
};

describe("WorkflowTopologyQueueAdapter", () => {
  it("uses the same application result as the HTTP adapter after fencing", async () => {
    const runtime = createApplicationRuntime({
      clock: {
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      },
      runtimeStateReader: activeStateReader,
    });
    const adapter = new WorkflowTopologyQueueAdapter(runtime);

    await expect(
      adapter.handle({
        expectedGeneration: 3,
        topology: {
          schemaVersion: 1,
          key: "foundation_probe",
          entryNodeKey: "validate",
          limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
          nodes: [
            {
              key: "validate",
              kind: "invoke",
              capability: {
                contractId: "foundation.validate",
                revision: 1,
                canonicalDigest: `sha256:${"a".repeat(64)}`,
              },
              input: {},
              next: [],
            },
          ],
          outputs: {},
        },
      }),
    ).resolves.toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("rejects stale-generation jobs before the use case", async () => {
    const runtime = createApplicationRuntime({
      clock: {
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      },
      runtimeStateReader: activeStateReader,
    });
    const adapter = new WorkflowTopologyQueueAdapter(runtime);

    await expect(
      adapter.handle({
        expectedGeneration: 2,
        topology: {
          schemaVersion: 1,
          key: "stale_probe",
          entryNodeKey: "validate",
          limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
          nodes: [
            {
              key: "validate",
              kind: "invoke",
              capability: {
                contractId: "foundation.validate",
                revision: 1,
                canonicalDigest: `sha256:${"a".repeat(64)}`,
              },
              input: {},
              next: [],
            },
          ],
          outputs: {},
        },
      }),
    ).rejects.toMatchObject({
      code: "runtime_fence_rejected",
    });
  });
});
