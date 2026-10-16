import { describe, expect, it, vi } from "vitest";

import {
  completeBrowserAttempt,
  fetchBrowserRuntimeManifest,
  uploadBrowserAttemptOutput,
} from "./browser-executor-transport.js";

const grant = {
  workspaceId: "01K00000000000000000000001",
  sessionId: "01K00000000000000000000002",
  assignmentId: "01K00000000000000000000003",
  attemptGrant: "a".repeat(43),
};
const workspace = {
  workspaceId: grant.workspaceId,
  csrfToken: "csrf-token",
};

describe("Browser Executor transport", () => {
  it("loads only the governed runtime manifest", async () => {
    const manifest = {
      schemaVersion: "kanvas.browser-runtime-manifest/v1" as const,
      runtimeReleaseId: "01K00000000000000000000010",
      runtimeReleaseDigest: `sha256:${"a".repeat(64)}`,
    };
    const current = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(manifest), { status: 200 }),
      );
    await expect(
      fetchBrowserRuntimeManifest(workspace, undefined, current),
    ).resolves.toEqual(manifest);
    expect(
      new Headers(current.mock.calls[0]?.[1]?.headers).get(
        "x-kanvas-workspace-id",
      ),
    ).toBe(grant.workspaceId);
  });

  it("uploads output bytes with only the bounded Attempt Grant authority", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          uploadSessionId: "01K00000000000000000000004",
          state: "verified",
          replayed: false,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    await uploadBrowserAttemptOutput(
      grant,
      {
        attemptId: "01K00000000000000000000005",
        blob: new Blob(["png"], { type: "image/png" }),
        executionGeneration: 7,
        leaseGeneration: 3,
        outputIndex: 0,
        outputRole: "foreground",
        uploadSessionId: "01K00000000000000000000004",
      },
      undefined,
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(request).toMatchObject({
      method: "PUT",
      credentials: "omit",
    });
    const headers = new Headers(request?.headers);
    expect(headers.get("x-kanvas-attempt-grant")).toBe(grant.attemptGrant);
    expect(headers.get("x-kanvas-output-role")).toBe("foreground");
    expect(headers.get("x-kanvas-attempt-lease-generation")).toBe("3");
    expect(headers.has("x-kanvas-csrf")).toBe(false);
  });

  it("replays an identical completion body after a lost response", async () => {
    const completion = {
      controlPlaneVersion: 1 as const,
      attemptId: "01K00000000000000000000005",
      capabilityRunId: "01K00000000000000000000006",
      leaseGeneration: 3,
      executionGeneration: 7,
      implementationRevisionId: "01K00000000000000000000007",
      implementationDigest: `sha256:${"b".repeat(64)}`,
      adapterKey: "first-party.image.background-remove.isnet.browser.v1",
      capabilityOutput: {
        foregroundArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "foreground",
          outputIndex: 0,
        },
      },
      outputs: [],
      initialUsage: [],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("response connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "replayed",
            completionId: "01K00000000000000000000008",
            completionManifestHash: `sha256:${"c".repeat(64)}`,
            manifestSchemaVersion: 1,
            terminalOutboxEventId: "01K00000000000000000000009",
            completedAt: "2026-08-03T00:00:00.000Z",
            outputs: [],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );

    await expect(
      completeBrowserAttempt(grant, completion, undefined, fetcher),
    ).rejects.toThrow(/connection lost/u);
    await expect(
      completeBrowserAttempt(grant, completion, undefined, fetcher),
    ).resolves.toMatchObject({
      status: "replayed",
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      fetcher.mock.calls[1]?.[1]?.body,
    );
  });
});
