import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertProviderCanaryRuntime,
  expectedGenerationTasksImageProtocolRevision,
  verifyProviderCanaryRuntime,
} from "./provider-canary-runtime-preflight.mjs";

const currentRuntime = Object.freeze({
  status: "ok",
  serviceVersion: "0.1.0-development",
  processRole: "worker",
  roles: Object.freeze(["provider-execution", "reconciler"]),
  providerAdapterKeys: Object.freeze([
    "generation-tasks.image.upscale.reconstructive.v1",
    "generation-tasks.image.canvas-expand.v1",
    "generation-tasks.image.object-remove.v1",
  ]),
  generationTasksImageProtocolRevision:
    expectedGenerationTasksImageProtocolRevision,
  startedAt: "2026-08-06T03:33:01.072Z",
});

describe("Provider canary runtime preflight", () => {
  it("accepts the current protocol revision and selected Adapter", () => {
    assert.deepEqual(
      assertProviderCanaryRuntime(currentRuntime, ["reconstructiveUpscale"]),
      {
        serviceVersion: "0.1.0-development",
        startedAt: "2026-08-06T03:33:01.072Z",
        protocolRevision: expectedGenerationTasksImageProtocolRevision,
      },
    );
  });

  it("rejects the old health document before any submit", async () => {
    await assert.rejects(
      verifyProviderCanaryRuntime({
        baseUrl: "http://127.0.0.1:3002",
        selectedWorkflowKeys: ["reconstructiveUpscale"],
        fetcher: async () =>
          new Response(
            JSON.stringify({
              status: "ok",
              serviceVersion: "0.1.0-development",
              processRole: "worker",
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      }),
      /runtime endpoint returned HTTP 404/u,
    );
  });

  it("rejects stale revisions and missing selected Adapters", () => {
    assert.throws(
      () =>
        assertProviderCanaryRuntime(
          {
            ...currentRuntime,
            generationTasksImageProtocolRevision:
              "generation.tasks.images.v2.old",
          },
          ["reconstructiveUpscale"],
        ),
      /Restart the Provider Worker from the current build/u,
    );
    assert.throws(
      () =>
        assertProviderCanaryRuntime(
          {
            ...currentRuntime,
            providerAdapterKeys: [],
          },
          ["objectRemove"],
        ),
      /missing generation-tasks\.image\.object-remove\.v1/u,
    );
  });
});
