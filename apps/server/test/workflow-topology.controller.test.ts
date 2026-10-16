import { describe, expect, it } from "vitest";
import {
  createApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";

import { WorkflowTopologyController } from "../src/http/workflow-topology.controller.js";

const activeStateReader: RuntimeStateReader = {
  read: () =>
    Promise.resolve({
      state: "ACTIVE",
      executionGeneration: 1,
      stateVersion: 1,
    }),
};

describe("WorkflowTopologyController", () => {
  it("delegates the HTTP adapter to the shared application use case", async () => {
    const runtime = createApplicationRuntime({
      clock: {
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      },
      runtimeStateReader: activeStateReader,
    });
    const controller = new WorkflowTopologyController(runtime);

    await expect(
      controller.validate({
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
      }),
    ).resolves.toEqual({
      valid: true,
      diagnostics: [],
    });
  });
});
