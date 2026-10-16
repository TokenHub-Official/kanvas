import { describe, expect, it, vi } from "vitest";

import {
  ApiProblem,
  acceptWorkspaceInvitation,
  allocateUserImport,
  archiveAgentThread,
  cancelAgentRun,
  cancelCapabilityRun,
  cancelModelResourceImport,
  changeWorkspaceMemberships,
  commitUserImport,
  createBrandKit,
  createWorkspaceAgentMessage,
  confirmAgentAction,
  declineAgentAction,
  createCanvasDraft,
  createWorkflowRun,
  createWorkspaceAssetFromArtifact,
  createWorkspaceInvitation,
  downloadArtifact,
  downloadArtifactPreview,
  fetchCanvasDraft,
  fetchAgentThread,
  fetchAgentThreads,
  fetchAgentRun,
  fetchCanvasDrafts,
  fetchCanvasDraftRevision,
  fetchCanvasDraftRevisions,
  fetchBrandKits,
  fetchBrandKitRevisions,
  fetchOperationalTimeline,
  fetchWorkflowRuns,
  fetchReadiness,
  resolveAgentInteraction,
  fetchWorkspaceCapabilityDefinitions,
  fetchWorkspaceAsset,
  fetchWorkspaceAssets,
  fetchWorkspaceCreationEntrypoints,
  fetchWorkspaceGeneralSettings,
  fetchWorkspaceTeam,
  fetchWorkspaceUsageSummary,
  installCapabilityRecommendation,
  moveCapabilityBinding,
  registerInstanceSetupAccount,
  registerInvitationAccount,
  regenerateAgentResponse,
  resolveUnknownBudgetHold,
  resolveInstanceSetup,
  resolveWorkspaceInvitation,
  renameWorkspace,
  renameAgentThread,
  restoreCanvasDraft,
  setCapabilityBindingStatus,
  selectAgentResponseBranch,
  streamAgentThread,
  publishBrandKit,
  updateCanvasDraft,
  uploadUserImport,
} from "./transport.js";

describe("Model resource transport", () => {
  it("cancels an import through the idempotent workspace route", async () => {
    const workspaceId = "01K00000000000000000000001";
    const importId = "01K00000000000000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: importId,
          status: "fetching",
          version: 2,
          source: { kind: "direct_url", url: "https://example.com/model.onnx" },
          downloadedBytes: "1048576",
          cancelRequestedAt: "2026-09-02T00:00:00.000Z",
          files: [],
          compatibleAdapters: [],
          requiredUserInputs: [],
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:01.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await cancelModelResourceImport(
      { workspaceId, csrfToken: "csrf-model" },
      importId,
      "cancel-request-1",
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `/api/v1/model-resource-imports/${importId}/cancel`,
    );
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe("{}");
    const headers = new Headers(request?.headers);
    expect(headers.get("idempotency-key")).toBe("cancel-request-1");
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe("csrf-model");
  });
});

describe("Capability run transport", () => {
  it("cancels a run through the idempotent workspace route", async () => {
    const workspaceId = "01K00000000000000000000001";
    const runId = "01K00000000000000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: runId,
          contractRevisionId: "01K00000000000000000000003",
          invocationKind: "user",
          lifecycleStatus: "running",
          input: {},
          version: 2,
          executionDeadlineAt: "2026-09-02T00:01:00.000Z",
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:01.000Z",
          cancelRequestedAt: "2026-09-02T00:00:01.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await cancelCapabilityRun(
      { workspaceId, csrfToken: "csrf-capability" },
      runId,
      "cancel-run-1",
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `/api/v1/capability-runs/${runId}/cancel`,
    );
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe("{}");
    const headers = new Headers(request?.headers);
    expect(headers.get("idempotency-key")).toBe("cancel-run-1");
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe("csrf-capability");
  });
});

describe("Workspace Agent transport", () => {
  it("starts regeneration as a new idempotent Run branch", async () => {
    const workspaceId = "01K00000000000000000000001";
    const threadId = "01K00000000000000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId,
          runId: "01K00000000000000000000003",
          lifecycleStatus: "queued",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    await regenerateAgentResponse(
      { workspaceId, csrfToken: "csrf-agent" },
      threadId,
      { assistantMessageId: "01K00000000000000000000004" },
      "agent-regenerate-1",
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(
      "agent-regenerate-1",
    );
    if (typeof request?.body !== "string") {
      throw new TypeError("Expected one JSON regeneration request body.");
    }
    expect(JSON.parse(request.body)).toEqual({
      assistantMessageId: "01K00000000000000000000004",
    });
  });

  it("selects an existing response branch with optimistic concurrency", async () => {
    const workspaceId = "01K00000000000000000000001";
    const threadId = "01K00000000000000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: threadId,
          lifecycleStatus: "active",
          version: 3,
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:00:01.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await selectAgentResponseBranch(
      { workspaceId, csrfToken: "csrf-agent" },
      threadId,
      "01K00000000000000000000004",
      2,
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    if (typeof request?.body !== "string") {
      throw new TypeError("Expected one JSON branch selection body.");
    }
    expect(JSON.parse(request.body)).toEqual({
      assistantMessageId: "01K00000000000000000000004",
      expectedVersion: 2,
    });
  });

  it("streams incremental Thread views over the governed event route", async () => {
    const workspaceId = "01K00000000000000000000001";
    const threadId = "01K00000000000000000000002";
    const encoder = new TextEncoder();
    const views = ["正在", "正在生成"];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        views.forEach((text) => {
          controller.enqueue(
            encoder.encode(
              `event: thread\ndata: ${JSON.stringify({
                id: threadId,
                lifecycleStatus: "active",
                version: 1,
                messages: [
                  {
                    id: "m",
                    role: "assistant",
                    parts: [{ type: "text", text }],
                  },
                ],
                relatedContent: [],
                tasks: [],
              })}\n\n`,
            ),
          );
        });
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const received: string[] = [];

    await streamAgentThread(
      workspaceId,
      threadId,
      (thread) =>
        received.push(
          thread.messages[0]?.parts.find((part) => part.type === "text")
            ?.text ?? "",
        ),
      new AbortController().signal,
      fetcher,
      "zh-CN",
    );

    expect(received).toEqual(views);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/agent/threads/${threadId}/events`,
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "text/event-stream",
          "accept-language": "zh-CN",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("enqueues messages, reads the Thread, and confirms actions through governed routes", async () => {
    const workspaceId = "01K00000000000000000000001";
    const csrfToken = "csrf-agent";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threadId: "01K00000000000000000000002",
            runId: "01K00000000000000000000003",
            lifecycleStatus: "queued",
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "01K00000000000000000000002",
            title: "Campaign visual",
            lifecycleStatus: "active",
            version: 1,
            messages: [],
            relatedContent: [],
            tasks: [],
            createdAt: "2026-08-25T12:00:00.000Z",
            updatedAt: "2026-08-25T12:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            actionReceiptId: "01K00000000000000000000004",
            lifecycleStatus: "cancelled",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "01K00000000000000000000003",
            lifecycleStatus: "cancelled",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            interactionId: "01K00000000000000000000006",
            lifecycleStatus: "submitted",
            runId: "01K00000000000000000000003",
            runLifecycleStatus: "queued",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threadId: "01K00000000000000000000002",
            runId: "01K00000000000000000000003",
            lifecycleStatus: "waiting_approval",
            messages: [],
            actions: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            actionReceiptId: "01K00000000000000000000004",
            workflowRunId: "01K00000000000000000000005",
            lifecycleStatus: "succeeded",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "01K00000000000000000000002",
            title: "Autumn campaign",
            lifecycleStatus: "active",
            version: 2,
            createdAt: "2026-08-25T12:00:00.000Z",
            updatedAt: "2026-08-25T12:01:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "01K00000000000000000000002",
            title: "Autumn campaign",
            lifecycleStatus: "archived",
            version: 3,
            createdAt: "2026-08-25T12:00:00.000Z",
            updatedAt: "2026-08-25T12:02:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await createWorkspaceAgentMessage(
      { workspaceId, csrfToken },
      { message: "Prepare a campaign visual." },
      "agent-message-1",
      fetcher,
    );
    await fetchAgentThreads(workspaceId, { limit: 30 }, fetcher);
    await fetchAgentThread(
      workspaceId,
      "01K00000000000000000000002",
      fetcher,
      "en-US",
    );
    await fetchAgentRun(workspaceId, "01K00000000000000000000003", fetcher);
    await cancelAgentRun(
      { workspaceId, csrfToken },
      "01K00000000000000000000003",
      fetcher,
    );
    await resolveAgentInteraction(
      { workspaceId, csrfToken },
      "01K00000000000000000000006",
      {
        expectedVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["outline"] }],
      },
      "agent-interaction-1",
      fetcher,
    );
    await confirmAgentAction(
      { workspaceId, csrfToken },
      "01K00000000000000000000004",
      "agent-action-1",
      fetcher,
    );
    await declineAgentAction(
      { workspaceId, csrfToken },
      "01K00000000000000000000004",
      "agent-action-decline-1",
      fetcher,
    );
    await renameAgentThread(
      { workspaceId, csrfToken },
      "01K00000000000000000000002",
      { title: "Autumn campaign", expectedVersion: 1 },
      fetcher,
    );
    await archiveAgentThread(
      { workspaceId, csrfToken },
      "01K00000000000000000000002",
      { expectedVersion: 2 },
      fetcher,
    );

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/workspaces/${workspaceId}/agent/messages`,
      `/api/v1/workspaces/${workspaceId}/agent/threads?limit=30`,
      `/api/v1/workspaces/${workspaceId}/agent/threads/01K00000000000000000000002`,
      "/api/v1/agent-runs/01K00000000000000000000003",
      "/api/v1/agent-runs/01K00000000000000000000003/cancel",
      "/api/v1/agent-interactions/01K00000000000000000000006/resolve",
      "/api/v1/agent-actions/01K00000000000000000000004/confirm",
      "/api/v1/agent-actions/01K00000000000000000000004/decline",
      `/api/v1/workspaces/${workspaceId}/agent/threads/01K00000000000000000000002`,
      `/api/v1/workspaces/${workspaceId}/agent/threads/01K00000000000000000000002/archive`,
    ]);
    const messageHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(messageHeaders.get("idempotency-key")).toBe("agent-message-1");
    const threadHeaders = new Headers(fetcher.mock.calls[2]?.[1]?.headers);
    expect(threadHeaders.get("accept-language")).toBe("en-US");
    expect(fetcher.mock.calls[4]?.[1]?.method).toBe("POST");
    const interactionHeaders = new Headers(fetcher.mock.calls[5]?.[1]?.headers);
    expect(interactionHeaders.get("idempotency-key")).toBe(
      "agent-interaction-1",
    );
    const actionHeaders = new Headers(fetcher.mock.calls[6]?.[1]?.headers);
    expect(actionHeaders.get("idempotency-key")).toBe("agent-action-1");
    const declineHeaders = new Headers(fetcher.mock.calls[7]?.[1]?.headers);
    expect(declineHeaders.get("idempotency-key")).toBe(
      "agent-action-decline-1",
    );
    expect(fetcher.mock.calls[8]?.[1]?.method).toBe("PATCH");
    expect(fetcher.mock.calls[9]?.[1]?.method).toBe("POST");
  });
});

class UploadRequestDouble {
  public onabort: XMLHttpRequest["onabort"] = null;
  public onerror: XMLHttpRequest["onerror"] = null;
  public onload: XMLHttpRequest["onload"] = null;
  public readonly upload = {
    onprogress: null as XMLHttpRequestUpload["onprogress"],
  };
  public status = 200;
  public responseText = JSON.stringify({
    uploadSessionId: "01K00000000000000000000003",
    state: "verified",
    replayed: false,
  });
  public withCredentials = false;
  public readonly abort = vi.fn();
  public readonly open = vi.fn();
  public readonly send = vi.fn();
  public readonly setRequestHeader = vi.fn();
}

describe("fetchReadiness", () => {
  it("returns the public bounded health response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          serviceVersion: "0.0.0-test",
          processRole: "server",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(fetchReadiness(fetcher)).resolves.toMatchObject({
      status: "ok",
      processRole: "server",
    });
  });

  it("maps an unready response without exposing dependency details", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(fetchReadiness(fetcher)).rejects.toBeInstanceOf(ApiProblem);
  });

  it("does not treat a successful transport response as runtime readiness", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "not_ready",
          serviceVersion: "0.0.0-test",
          processRole: "server",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(fetchReadiness(fetcher)).rejects.toMatchObject({
      code: "server_not_ready",
    });
  });
});

describe("Workspace Brand transport", () => {
  const workspaceId = "01K00000000000000000000001";
  const context = { workspaceId, csrfToken: "csrf-token" };

  it("lists the active Workspace brand projection without request fan-out", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );

    await fetchBrandKits(workspaceId, { lifecycleStatus: "active" }, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/brand-kits?lifecycleStatus=active",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("lists immutable brand versions within the selected Workspace", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
    const brandKitId = "01K00000000000000000000002";

    await fetchBrandKitRevisions(workspaceId, brandKitId, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/brand-kits/${brandKitId}/revisions`,
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("keeps create and publish mutations idempotent and Workspace scoped", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            brandKitId: "01K00000000000000000000002",
            workspaceId,
            name: "Acme",
            lifecycleStatus: "active",
            isDefault: false,
            brandKitVersion: 1,
            draftVersion: 1,
            colors: [],
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
          }),
          { status: 201 },
        ),
      ),
    );

    await createBrandKit(context, { name: "Acme" }, "brand-create-1", fetcher);
    await publishBrandKit(
      context,
      "01K00000000000000000000002",
      { expectedDraftVersion: 1 },
      "brand-publish-1",
      fetcher,
    );

    const createRequest = fetcher.mock.calls[0]?.[1];
    const publishRequest = fetcher.mock.calls[1]?.[1];
    expect(createRequest?.method).toBe("POST");
    expect(new Headers(createRequest?.headers).get("idempotency-key")).toBe(
      "brand-create-1",
    );
    expect(
      new Headers(createRequest?.headers).get("x-kanvas-workspace-id"),
    ).toBe(workspaceId);
    expect(publishRequest?.method).toBe("POST");
    expect(new Headers(publishRequest?.headers).get("idempotency-key")).toBe(
      "brand-publish-1",
    );
    expect(
      new Headers(publishRequest?.headers).get("x-kanvas-workspace-id"),
    ).toBe(workspaceId);
  });
});

describe("Workspace Team transport", () => {
  it("requests one independent cursor page without losing Workspace scope", async () => {
    const workspaceId = "01K00000000000000000000001";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [],
          invitations: [],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await fetchWorkspaceTeam(
      workspaceId,
      {
        pageKind: "members",
        cursor: "member_cursor",
        limit: "100",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/workspace-team?pageKind=members&cursor=member_cursor&limit=100",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("sends one bounded membership batch instead of client-side request fan-out", async () => {
    const workspaceId = "01K00000000000000000000001";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [
            {
              membershipId: "01K00000000000000000000002",
              role: "editor",
              status: "suspended",
              version: 4,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await changeWorkspaceMemberships(
      {
        csrfToken: "csrf-token",
        workspaceId,
      },
      {
        changes: [
          {
            targetPrincipalId: "01K00000000000000000000003",
            expectedVersion: 3,
            role: "editor",
            status: "suspended",
          },
        ],
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/workspace-memberships",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({
          changes: [
            {
              targetPrincipalId: "01K00000000000000000000003",
              expectedVersion: 3,
              role: "editor",
              status: "suspended",
            },
          ],
        }),
      }),
    );
  });
});

describe("Workspace transport boundaries", () => {
  const workspaceId = "01K00000000000000000000001";
  const csrfToken = "csrf-token";

  it("reads the usage summary within the selected Workspace", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-08-05T00:00:00.000Z",
          windowStartAt: "2026-07-06T00:00:00.000Z",
          windowEndAt: "2026-08-05T00:00:00.000Z",
          trackedAttemptCount: 0,
          unknownUsageCount: 0,
          budgets: [],
          unknownHolds: [],
          metrics: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await fetchWorkspaceUsageSummary(workspaceId, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/usage-summary", {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    });
  });

  it("resolves one unknown hold with Workspace mutation headers", async () => {
    const reservationId = "01K00000000000000000000009";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          budgetReservationId: reservationId,
          result: "resolved",
          lifecycleStatus: "released",
          chargedAmount: "0",
          resolvedAt: "2026-08-05T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await resolveUnknownBudgetHold(
      { workspaceId, csrfToken },
      reservationId,
      {
        expectedVersion: 2,
        resolution: "not_charged",
        evidenceReference: "TokenHub task history 2026-08-05",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/usage-summary/unknown-holds/${reservationId}/resolution`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-kanvas-csrf": csrfToken,
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("reads the unified capability administration projection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-08-05T00:00:00.000Z",
          definitions: [],
          providerRoutes: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await fetchWorkspaceCapabilityDefinitions(workspaceId, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/capability-definitions", {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    });
  });

  it("installs one capability recommendation with confirmed dependencies", async () => {
    const catalogEntryId = "01K00000000000000000000005";
    const expectedCatalogDigest = `sha256:${"a".repeat(64)}`;
    const selectedRoutePolicyRevisionId = "01K00000000000000000000006";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "01K00000000000000000000007",
          catalogEntryId,
          status: "installed",
          requiredAction: "none",
          installedDefinitionId: "01K00000000000000000000008",
          version: 1,
          replayed: false,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await installCapabilityRecommendation(
      { workspaceId, csrfToken },
      catalogEntryId,
      {
        expectedCatalogDigest,
        confirmDependencies: true,
        selectedRoutePolicyRevisionId,
      },
      "capability-install-1",
      fetcher,
    );

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe(
      `/api/v1/capability-recommendations/${catalogEntryId}/install`,
    );
    expect(call?.[1]?.method).toBe("POST");
    const requestBody = call?.[1]?.body;
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected one JSON Capability install request body.");
    }
    expect(JSON.parse(requestBody)).toEqual({
      expectedCatalogDigest,
      confirmDependencies: true,
      selectedRoutePolicyRevisionId,
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBe("capability-install-1");
  });

  it("reads general settings within the selected Workspace", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspaceId,
          slug: "kanvas-studio",
          name: "Kanvas Studio",
          version: 4,
          updatedAt: "2026-08-06T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await fetchWorkspaceGeneralSettings(workspaceId, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/workspace-settings", {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    });
  });

  it("renames the Workspace with CSRF and optimistic concurrency", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspaceId,
          slug: "kanvas-studio",
          name: "设计团队",
          version: 5,
          updatedAt: "2026-08-06T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await renameWorkspace(
      { csrfToken, workspaceId },
      {
        expectedVersion: 4,
        name: "设计团队",
      },
      fetcher,
    );

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/workspace-settings/name");
    expect(call?.[1]).toMatchObject({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({
        expectedVersion: 4,
        name: "设计团队",
      }),
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("limits the Workspace rename response-loss probe to an explicit development page query", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?kanvasDevResponseLoss=workspace-name-after-commit",
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspaceId,
          slug: "kanvas-studio",
          name: "设计团队",
          version: 5,
          updatedAt: "2026-08-06T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    try {
      await renameWorkspace(
        { csrfToken, workspaceId },
        {
          expectedVersion: 4,
          name: "设计团队",
        },
        fetcher,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/workspace-settings/name?kanvasDevDropResponse=after-commit",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("pauses one capability route with CSRF and optimistic concurrency", async () => {
    const bindingId = "01K00000000000000000000008";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          bindingId,
          version: 5,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await setCapabilityBindingStatus(
      { csrfToken, workspaceId },
      bindingId,
      {
        expectedVersion: 4,
        status: "paused",
      },
      fetcher,
    );

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe(`/api/v1/capability-bindings/${bindingId}/status`);
    expect(call?.[1]).toMatchObject({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({
        expectedVersion: 4,
        status: "paused",
      }),
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("moves only the current adjacent capability route using both versions", async () => {
    const bindingId = "01K00000000000000000000008";
    const adjacentBindingId = "01K00000000000000000000009";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          bindingId,
          version: 6,
          adjacentBindingId,
          adjacentVersion: 3,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await moveCapabilityBinding(
      { csrfToken, workspaceId },
      bindingId,
      {
        expectedVersion: 4,
        adjacentBindingId,
        expectedAdjacentVersion: 2,
        direction: "later",
      },
      fetcher,
    );

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe(`/api/v1/capability-bindings/${bindingId}/position`);
    expect(call?.[1]).toMatchObject({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({
        expectedVersion: 4,
        adjacentBindingId,
        expectedAdjacentVersion: 2,
        direction: "later",
      }),
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("reauthorizes Workflow creation with Workspace, CSRF and idempotency headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "01K00000000000000000000002",
          workflowRevisionId: "01K00000000000000000000003",
          lifecycleStatus: "queued",
          outcome: null,
          replayed: false,
          createdAt: "2026-08-03T00:00:00.000Z",
        }),
        {
          status: 202,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await createWorkflowRun(
      {
        workspaceId,
        csrfToken,
      },
      {
        workflowRevisionId: "01K00000000000000000000003",
        input: {
          source: {
            kind: "artifact",
            artifactId: "01K00000000000000000000004",
          },
        },
      },
      "canvas-operation-1",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/workflow-runs",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBe("canvas-operation-1");
  });

  it("lists recent runs for one published Workflow revision", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await fetchWorkflowRuns(
      workspaceId,
      {
        workflowRevisionId: "01K00000000000000000000003",
        state: "completed",
        limit: 4,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/workflow-runs?workflowRevisionId=01K00000000000000000000003&state=completed&limit=4",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("preserves Nest error messages when a problem detail is absent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 409,
          message: "Canvas Export is not eligible for commit.",
          error: "Conflict",
        }),
        {
          status: 409,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(
      allocateUserImport(
        {
          csrfToken,
          workspaceId,
        },
        {
          expectedMediaType: "image/png",
        },
        "allocation-key",
        { fetcher },
      ),
    ).rejects.toMatchObject({
      code: "api_request_failed",
      message: "Canvas Export is not eligible for commit.",
      status: 409,
    });
  });

  it("scopes Studio catalog reads without sending a CSRF token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [],
            truncated: false,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    await fetchWorkspaceAssets(workspaceId, {}, fetcher);
    await fetchWorkspaceAsset(
      workspaceId,
      "01K00000000000000000000002",
      {
        historyKind: "artifacts",
        cursor: "asset_cursor",
        limit: "20",
      },
      fetcher,
    );
    await fetchWorkspaceCreationEntrypoints(workspaceId, fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/assets",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/assets/01K00000000000000000000002?historyKind=artifacts&cursor=asset_cursor&limit=20",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/creation-entrypoints",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("encodes Asset library filters and cursor without leaking them into headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          truncated: false,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await fetchWorkspaceAssets(
      workspaceId,
      {
        q: "产品 图",
        mediaKind: "image",
        lifecycleStatus: "active",
        cursor: "cursor_1",
        limit: "48",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/assets?q=%E4%BA%A7%E5%93%81+%E5%9B%BE&mediaKind=image&lifecycleStatus=active&cursor=cursor_1&limit=48",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("forwards cancellation to Asset library reads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], truncated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const controller = new AbortController();

    await fetchWorkspaceAssets(workspaceId, {}, fetcher, controller.signal);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/assets",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("encodes a bounded recent Asset projection by ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          truncated: false,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const ids = [
      "01K00000000000000000000005",
      "01K00000000000000000000006",
    ].join(",");

    await fetchWorkspaceAssets(
      workspaceId,
      {
        ids,
        mediaKind: "image",
        lifecycleStatus: "active",
        limit: "24",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/assets?ids=${encodeURIComponent(ids)}&mediaKind=image&lifecycleStatus=active&limit=24`,
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("reads and saves Canvas Drafts with the correct Workspace mutation boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );
    const document = {
      schemaVersion: "kanvas.editor-document/v1" as const,
      title: "未命名画板",
      pages: [
        {
          id: "page-1",
          name: "页面 1",
          width: 1080,
          height: 1080,
          background: { kind: "transparent" as const },
          nodes: [],
        },
      ],
      metadata: {
        createdWith: "kanvas-web",
      },
    };
    const context = {
      workspaceId,
      csrfToken,
    };
    const canvasDraftId = "01K00000000000000000000002";

    await fetchCanvasDraft(workspaceId, canvasDraftId, fetcher);
    await createCanvasDraft(context, { document }, "create-draft-1", fetcher);
    await updateCanvasDraft(
      context,
      canvasDraftId,
      {
        expectedVersion: 2,
        document,
      },
      fetcher,
    );
    await fetchCanvasDraftRevisions(
      workspaceId,
      canvasDraftId,
      {
        beforeVersion: 8,
        limit: 30,
      },
      fetcher,
    );
    await fetchCanvasDraftRevision(workspaceId, canvasDraftId, 4, fetcher);
    await restoreCanvasDraft(
      context,
      canvasDraftId,
      {
        expectedVersion: 8,
        sourceVersion: 4,
      },
      fetcher,
    );
    await fetchCanvasDrafts(workspaceId, 4, fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/v1/canvas-drafts/${canvasDraftId}`,
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/canvas-drafts",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const createHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(createHeaders.get("idempotency-key")).toBe("create-draft-1");
    expect(createHeaders.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/v1/canvas-drafts/${canvasDraftId}`,
      expect.objectContaining({
        method: "PUT",
      }),
    );
    const updateHeaders = new Headers(fetcher.mock.calls[2]?.[1]?.headers);
    expect(updateHeaders.has("idempotency-key")).toBe(false);
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/api/v1/canvas-drafts/${canvasDraftId}/revisions?beforeVersion=8&limit=30`,
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      `/api/v1/canvas-drafts/${canvasDraftId}/revisions/4`,
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      6,
      `/api/v1/canvas-drafts/${canvasDraftId}/restore`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedVersion: 8,
          sourceVersion: 4,
        }),
      }),
    );
    const restoreHeaders = new Headers(fetcher.mock.calls[5]?.[1]?.headers);
    expect(restoreHeaders.get("x-kanvas-csrf")).toBe(csrfToken);
    expect(restoreHeaders.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(fetcher).toHaveBeenNthCalledWith(
      7,
      "/api/v1/canvas-drafts?limit=4",
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("limits the Canvas Draft response-loss probe to an explicit development page query", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?kanvasDevResponseLoss=canvas-draft-after-create",
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    try {
      await createCanvasDraft(
        {
          workspaceId,
          csrfToken,
        },
        {
          document: {
            schemaVersion: "kanvas.editor-document/v1",
            title: "响应丢失复用",
            pages: [],
            metadata: {
              createdWith: "kanvas-web",
            },
          },
        },
        "create-draft-response-loss",
        fetcher,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/canvas-drafts?kanvasDevDropResponse=after-create",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("limits the Canvas Draft permission-loss delay to an explicit development page query", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?kanvasDevPermissionLoss=canvas-draft-before-create",
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    try {
      await createCanvasDraft(
        {
          workspaceId,
          csrfToken,
        },
        {
          document: {
            schemaVersion: "kanvas.editor-document/v1",
            title: "权限变化复用",
            pages: [],
            metadata: {
              createdWith: "kanvas-web",
            },
          },
        },
        "create-draft-permission-loss",
        fetcher,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/canvas-drafts?kanvasDevDelay=before-create",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("limits the Asset read permission-loss delay to an explicit development page query", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?kanvasDevPermissionLoss=asset-before-read",
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    try {
      await fetchWorkspaceAsset(
        workspaceId,
        "01K00000000000000000000002",
        {},
        fetcher,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/assets/01K00000000000000000000002?kanvasDevDelay=asset-before-read",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("keeps setup credentials in request bodies during first-account enrollment", async () => {
    const setupToken = `knv_setup_v1_${"a".repeat(43)}`;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    await resolveInstanceSetup({ setupToken }, fetcher);
    await registerInstanceSetupAccount(
      {
        setupToken,
        email: "owner@example.com",
        displayName: "Owner",
        password: "long-enough-password",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/instance/setup/resolutions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ setupToken }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/instance/setup/registrations",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          setupToken,
          email: "owner@example.com",
          displayName: "Owner",
          password: "long-enough-password",
        }),
      }),
    );
  });

  it("keeps invitation resolution public but protects create and accept mutations", async () => {
    const invitationToken = `knv_invite_v1_${"a".repeat(43)}`;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    await resolveWorkspaceInvitation(invitationToken, fetcher);
    await registerInvitationAccount(
      {
        invitationToken,
        email: "designer@example.com",
        displayName: "Designer",
        password: "long-enough-password",
      },
      fetcher,
    );
    await createWorkspaceInvitation(
      {
        workspaceId,
        csrfToken,
      },
      {
        targetEmail: "designer@example.com",
        workspaceRole: "editor",
        expiresInHours: 168,
      },
      fetcher,
    );
    await acceptWorkspaceInvitation(
      csrfToken,
      {
        invitationToken,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/invitation-resolutions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          invitationToken,
        }),
      }),
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/invitation-registrations");
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        invitationToken,
        email: "designer@example.com",
        displayName: "Designer",
        password: "long-enough-password",
      }),
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe("/api/v1/workspace-invitations");
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
        "x-kanvas-workspace-id": workspaceId,
      },
    });
    expect(fetcher.mock.calls[3]?.[0]).toBe(
      "/api/v1/workspace-invitation-acceptances",
    );
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
    });
  });

  it("scopes operational diagnostics to one Workspace and one Run", async () => {
    const workflowRunId = "01K00000000000000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          workflowRunId,
          generatedAt: "2026-07-29T00:00:00.000Z",
          items: [],
          truncated: false,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await fetchOperationalTimeline(workspaceId, workflowRunId, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/workflow-runs/${workflowRunId}/operational-timeline`,
      {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": workspaceId,
        },
      },
    );
  });

  it("reports byte progress while uploading a user import", async () => {
    const request = new UploadRequestDouble();
    const file = new File(["proof"], "proof.png", {
      type: "image/png",
    });
    const onProgress = vi.fn();
    request.send.mockImplementation(() => {
      request.upload.onprogress?.call(
        request as unknown as XMLHttpRequest,
        {
          loaded: 3,
        } as ProgressEvent,
      );
      request.onload?.call(
        request as unknown as XMLHttpRequest,
        {} as ProgressEvent,
      );
    });

    await expect(
      uploadUserImport(
        {
          csrfToken,
          workspaceId,
        },
        "01K00000000000000000000003",
        file,
        {
          onProgress,
          requestFactory: () => request as unknown as XMLHttpRequest,
        },
      ),
    ).resolves.toMatchObject({
      state: "verified",
      replayed: false,
    });

    expect(request.open).toHaveBeenCalledWith(
      "PUT",
      "/api/v1/user-import-upload-sessions/01K00000000000000000000003/content",
    );
    expect(request.withCredentials).toBe(true);
    expect(request.setRequestHeader).toHaveBeenCalledWith(
      "x-kanvas-workspace-id",
      workspaceId,
    );
    expect(request.setRequestHeader).toHaveBeenCalledWith(
      "x-kanvas-csrf",
      csrfToken,
    );
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loadedBytes: 0,
      totalBytes: file.size,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      loadedBytes: 3,
      totalBytes: file.size,
    });
  });

  it("aborts the browser upload without accepting a response", async () => {
    const request = new UploadRequestDouble();
    const controller = new AbortController();
    const file = new File(["proof"], "proof.png", {
      type: "image/png",
    });
    request.abort.mockImplementation(() => {
      request.onabort?.call(
        request as unknown as XMLHttpRequest,
        {} as ProgressEvent,
      );
    });

    const result = uploadUserImport(
      {
        csrfToken,
        workspaceId,
      },
      "01K00000000000000000000003",
      file,
      {
        requestFactory: () => request as unknown as XMLHttpRequest,
        signal: controller.signal,
      },
    );
    const assertion = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();

    await assertion;
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it("passes cancellation through user import allocation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          uploadSessionId: "01K00000000000000000000003",
          state: "open",
          expiresAt: "2026-07-29T01:00:00.000Z",
          maximumBytes: "536870912",
          replayed: false,
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await allocateUserImport(
      {
        csrfToken,
        workspaceId,
      },
      {
        expectedMediaType: "image/png",
        expectedSize: "5",
      },
      "user-import-key",
      {
        fetcher,
        signal: controller.signal,
      },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/user-import-upload-sessions",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("passes cancellation through user import commit", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await commitUserImport(
      { csrfToken, workspaceId },
      "01K00000000000000000000003",
      {
        artifactType: "image.source",
        dataClassification: "internal",
      },
      fetcher,
      controller.signal,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/user-import-upload-sessions/01K00000000000000000000003/commit",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("passes Attempt cancellation through Artifact input download", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(["image"]), {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }),
    );

    await downloadArtifact(
      workspaceId,
      "01K00000000000000000000009",
      fetcher,
      controller.signal,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/artifacts/01K00000000000000000000009/content",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("requests the bounded Artifact preview for asset thumbnails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(["preview"]), {
        status: 200,
        headers: {
          "content-type": "image/webp",
        },
      }),
    );

    await downloadArtifactPreview(
      workspaceId,
      "01K00000000000000000000009",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/artifacts/01K00000000000000000000009/preview",
      expect.objectContaining({
        headers: {
          accept: "image/webp",
          "x-kanvas-workspace-id": workspaceId,
        },
      }),
    );
  });

  it("adopts a result Artifact into an idempotent Workspace Asset", async () => {
    const assetId = "01K00000000000000000000008";
    const artifactId = "01K00000000000000000000009";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "created",
          assetId,
          artifactId,
          version: 1,
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(
      createWorkspaceAssetFromArtifact(
        { csrfToken, workspaceId },
        {
          assetId,
          artifactId,
          name: "去背景结果",
        },
        fetcher,
      ),
    ).resolves.toMatchObject({
      status: "created",
      assetId,
      artifactId,
    });
    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/assets");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("idempotency-key")).toBe(assetId);
    expect(headers.get("x-kanvas-workspace-id")).toBe(workspaceId);
    expect(headers.get("x-kanvas-csrf")).toBe(csrfToken);
  });
});
