import { Readable } from "node:stream";

import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { BrowserExecutorControlPlaneService } from "../src/browser-executor/browser-executor-control-plane.service.js";
import { BrowserExecutorController } from "../src/browser-executor/browser-executor.controller.js";
import type { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";

const ids = Object.freeze({
  workspace: "01K00000000000000000000001",
  session: "01K00000000000000000000002",
  assignment: "01K00000000000000000000003",
  attempt: "01K00000000000000000000004",
  upload: "01K00000000000000000000005",
});

function createFixture() {
  const uploadAttemptOutput = vi
    .fn<BrowserExecutorControlPlaneService["uploadAttemptOutput"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "verified",
      replayed: false,
    });
  const controller = new BrowserExecutorController(
    {
      uploadAttemptOutput,
    } as unknown as BrowserExecutorControlPlaneService,
    {} as RequestAuthorizationContextStore,
  );
  return { controller, uploadAttemptOutput };
}

describe("BrowserExecutorController output ingestion", () => {
  it("validates bounded string headers before invoking the stream service", async () => {
    const fixture = createFixture();
    const body = Readable.from([Uint8Array.of(1, 2, 3)]);
    const headers = {
      "content-type": "image/png",
      "x-kanvas-workspace-id": ids.workspace,
      "x-kanvas-attempt-grant": "A".repeat(43),
      "x-kanvas-attempt-id": ids.attempt,
      "x-kanvas-attempt-lease-generation": "4",
      "x-kanvas-execution-generation": "7",
      "x-kanvas-output-role": "primary",
      "x-kanvas-output-index": "0",
    } satisfies FastifyRequest["headers"];

    await expect(
      fixture.controller.uploadOutput(
        headers,
        {
          browserExecutorSessionId: ids.session,
          browserAssignmentId: ids.assignment,
          uploadSessionId: ids.upload,
        },
        body,
      ),
    ).resolves.toMatchObject({
      state: "verified",
    });
    expect(fixture.uploadAttemptOutput).toHaveBeenCalledWith(
      ids.workspace,
      ids.session,
      ids.assignment,
      ids.upload,
      "A".repeat(43),
      ids.attempt,
      4,
      7,
      "primary",
      0,
      body,
    );
  });

  it("rejects content types outside the exact binary allowlist", async () => {
    const fixture = createFixture();
    await expect(
      fixture.controller.uploadOutput(
        {
          "content-type": "text/plain",
        },
        {
          browserExecutorSessionId: ids.session,
          browserAssignmentId: ids.assignment,
          uploadSessionId: ids.upload,
        },
        Readable.from(["not an image"]),
      ),
    ).rejects.toMatchObject({
      status: 415,
    });
    expect(fixture.uploadAttemptOutput).not.toHaveBeenCalled();
  });
});
