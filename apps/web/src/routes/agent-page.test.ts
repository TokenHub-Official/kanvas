import type { AgentThreadList, AgentThreadView } from "@kanvas/contracts/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "../api/transport.js";
import {
  acceptedAgentMessageQueueBarrierAction,
  agentActionAwaitingAutoConfirmation,
  agentComposerBlocksQueueTake,
  agentErrorKey,
  agentMessageQueueCanDrain,
  agentMessageQueuePauseReason,
  agentMessageQueueSnapshotIsCurrent,
  agentModelSetupBlocksSend,
  agentStopRaceAlreadySettled,
  agentThreadFallbackPollInterval,
  agentThreadIsMissing,
  agentThreadCanRetainCachedView,
  agentThreadBlocksComposer,
  agentThreadStreamRetryDelay,
  fetchFreshAcceptedAgentThread,
  regeneratingAssistantMessageId,
  reusableFailedAgentRequest,
  queuedAgentMessageComposerReferences,
  stageAgentResultComposerReference,
  persistRetrievedCanvasEntry,
  readRetrievedCanvasEntry,
  synchronizeAcceptedAgentMessage,
  threadListHasActiveRun,
  workspaceDefaultAgentModelReady,
} from "./agent-page.js";

function threadList(
  items: AgentThreadList["items"],
): readonly AgentThreadList[] {
  return [{ items }];
}

describe("Agent page request lifecycle", () => {
  it("blocks only the default Agent until its selected model is ready", () => {
    const modelId = "01K00000000000000000000007";
    const unready = {
      currentDefaultModelId: modelId,
      options: [{ id: modelId, modelName: "Default", ready: false }],
    };

    expect(workspaceDefaultAgentModelReady(unready)).toBe(false);
    expect(
      agentModelSetupBlocksSend({
        currentAgentIsDefault: true,
        settings: unready,
        settingsError: false,
        settingsPending: false,
      }),
    ).toBe(true);
    expect(
      agentModelSetupBlocksSend({
        currentAgentIsDefault: false,
        settings: unready,
        settingsError: false,
        settingsPending: false,
      }),
    ).toBe(false);
    const ready = {
      ...unready,
      options: [{ id: modelId, modelName: "Default", ready: true }],
    };
    expect(workspaceDefaultAgentModelReady(ready)).toBe(true);
    expect(
      agentModelSetupBlocksSend({
        currentAgentIsDefault: true,
        settings: ready,
        settingsError: false,
        settingsPending: false,
      }),
    ).toBe(false);
    expect(
      agentModelSetupBlocksSend({
        currentAgentIsDefault: true,
        settingsError: true,
        settingsPending: false,
      }),
    ).toBe(true);
  });

  it("maps a model setup race to the recoverable default Agent message", () => {
    expect(
      agentErrorKey(
        new ApiProblem(409, "agent.model_not_configured", "Configure a model"),
      ),
    ).toBe("agent.defaultModelSetup.sendBlocked");
  });

  it("restores a tool-changed request into the composer without retrying its pinned Run", () => {
    const thread = {
      latestRun: {
        id: "01K00000000000000000000009",
        lifecycleStatus: "failed",
        failureKind: "tools_changed",
        replacesMessageId: "01K00000000000000000000002",
        updatedAt: "2026-09-15T06:00:00.000Z",
      },
      messages: [
        {
          id: "01K00000000000000000000001",
          role: "user",
          parts: [{ type: "text", text: "  Create the current campaign.  " }],
          relatedContent: [],
          createdAt: "2026-09-15T05:59:00.000Z",
        },
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [{ type: "text", text: "Earlier response" }],
          relatedContent: [],
          createdAt: "2026-09-15T05:59:30.000Z",
        },
      ],
    } as Pick<AgentThreadView, "latestRun" | "messages">;

    expect(reusableFailedAgentRequest(thread)).toBe(
      "Create the current campaign.",
    );
    expect(
      reusableFailedAgentRequest({
        ...thread,
        latestRun: { ...thread.latestRun!, failureKind: "runtime" },
      }),
    ).toBeUndefined();
  });

  it("bypasses a global fresh cache after the server accepts a new Run", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 10_000, retry: false } },
    });
    const key = ["agent-thread", "workspace", "thread"];
    const view = {
      id: "01K00000000000000000000001",
      lifecycleStatus: "active",
      version: 2,
      actionConfirmationRequired: true,
      agent: {
        id: "01K00000000000000000000002",
        displayName: "Agent",
      },
      messages: [],
      relatedContent: [],
      tasks: [],
      createdAt: "2026-09-15T06:00:00.000Z",
      updatedAt: "2026-09-15T06:01:00.000Z",
    } as AgentThreadView;
    client.setQueryData(key, { ...view, version: 1 });
    const load = vi.fn(() => Promise.resolve(view));

    await expect(
      fetchFreshAcceptedAgentThread(client, "workspace", "thread", load),
    ).resolves.toMatchObject({ version: 2 });
    expect(load).toHaveBeenCalledOnce();
    expect(client.getQueryData(key)).toMatchObject({ version: 2 });
  });

  it("keeps loaded work on temporary read failure but hides it when access is denied", () => {
    expect(agentThreadCanRetainCachedView(new Error("offline"))).toBe(true);
    expect(
      agentThreadCanRetainCachedView(
        new ApiProblem(500, "server_error", "Failed"),
      ),
    ).toBe(true);
    expect(
      agentThreadCanRetainCachedView(
        new ApiProblem(403, "forbidden", "Denied"),
      ),
    ).toBe(false);
    expect(
      agentThreadCanRetainCachedView(
        new ApiProblem(401, "unauthorized", "Sign in"),
      ),
    ).toBe(false);
  });
  it("keeps brand publication pending even when ordinary tasks auto-confirm", () => {
    expect(
      agentActionAwaitingAutoConfirmation(
        {
          latestRun: {
            id: "01K00000000000000000000003",
            lifecycleStatus: "waiting_approval",
            updatedAt: "2026-09-08T08:00:00.000Z",
          },
          tasks: [
            {
              id: "01K00000000000000000000004",
              kind: "brand",
              lifecycleStatus: "waiting_approval",
              title: "发布测试品牌",
            },
          ],
        },
        new Set(),
      ),
    ).toBeUndefined();
  });

  it("waits for the Agent Run to publish its response before auto-confirming an action", () => {
    const action = {
      id: "01K00000000000000000000004",
      kind: "workflow" as const,
      lifecycleStatus: "waiting_approval" as const,
      title: "生成图片",
    };
    const running = {
      latestRun: {
        id: "01K00000000000000000000003",
        lifecycleStatus: "running" as const,
        updatedAt: "2026-09-04T12:00:00.000Z",
      },
      tasks: [action],
    };

    expect(
      agentActionAwaitingAutoConfirmation(running, new Set()),
    ).toBeUndefined();
    expect(
      agentActionAwaitingAutoConfirmation(
        {
          ...running,
          latestRun: {
            ...running.latestRun,
            lifecycleStatus: "waiting_approval",
          },
        },
        new Set(),
      ),
    ).toEqual(action);
    expect(
      agentActionAwaitingAutoConfirmation(
        {
          ...running,
          latestRun: {
            ...running.latestRun,
            lifecycleStatus: "waiting_approval",
          },
        },
        new Set([action.id]),
      ),
    ).toBeUndefined();
  });

  it("recovers a missing Thread as a new conversation without masking retryable failures", () => {
    expect(
      agentThreadIsMissing(
        new ApiProblem(404, "agent.thread_not_found", "Missing"),
      ),
    ).toBe(true);
    expect(
      agentThreadIsMissing(
        new ApiProblem(503, "agent.thread_unavailable", "Unavailable"),
      ),
    ).toBe(false);
    expect(agentThreadIsMissing({ status: 400 })).toBe(true);
    expect(agentThreadIsMissing({ status: 404 })).toBe(true);
    expect(agentThreadIsMissing(new Error("offline"))).toBe(false);
  });

  it("keeps the previous assistant stable for message and failed-Run retries", () => {
    const messages = [
      {
        id: "01K00000000000000000000001",
        role: "user",
        parts: [{ type: "text", text: "制作海报" }],
        relatedContent: [],
        createdAt: "2026-08-28T12:00:00.000Z",
      },
      {
        id: "01K00000000000000000000002",
        role: "assistant",
        parts: [{ type: "text", text: "已有回复" }],
        relatedContent: [],
        createdAt: "2026-08-28T12:00:01.000Z",
      },
    ] as const satisfies AgentThreadView["messages"];

    expect(
      regeneratingAssistantMessageId(
        { assistantMessageId: messages[1].id },
        messages,
      ),
    ).toBe(messages[1].id);
    expect(
      regeneratingAssistantMessageId(
        { agentRunId: "01K00000000000000000000003" },
        messages,
      ),
    ).toBe(messages[1].id);
  });

  it("does not poll the list for the active thread already covered by its event stream", () => {
    const currentThreadId = "01K00000000000000000000001";
    const running = {
      id: currentThreadId,
      lifecycleStatus: "active" as const,
      version: 1,
      latestRun: {
        id: "01K00000000000000000000002",
        lifecycleStatus: "running" as const,
        updatedAt: "2026-08-27T12:00:00.000Z",
      },
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };

    expect(threadListHasActiveRun(threadList([running]), currentThreadId)).toBe(
      false,
    );
    expect(threadListHasActiveRun(threadList([running]), undefined)).toBe(true);
    expect(agentThreadFallbackPollInterval(running)).toBe(2_000);
    expect(agentThreadFallbackPollInterval(running, true)).toBe(false);
    expect(
      agentThreadFallbackPollInterval({
        ...running,
        latestRun: { ...running.latestRun, lifecycleStatus: "succeeded" },
      }),
    ).toBe(false);
    expect(
      agentThreadFallbackPollInterval({
        latestRun: { ...running.latestRun, lifecycleStatus: "succeeded" },
        tasks: [
          {
            id: "01K00000000000000000000003",
            kind: "workflow",
            lifecycleStatus: "running",
            title: "生成图片",
          },
        ],
      }),
    ).toBe(2_000);
    expect(
      agentThreadBlocksComposer({
        latestRun: { ...running.latestRun, lifecycleStatus: "succeeded" },
        tasks: [
          {
            id: "01K00000000000000000000003",
            kind: "capability",
            lifecycleStatus: "running",
            title: "生成图片",
          },
        ],
      }),
    ).toBe(false);
    expect(
      agentThreadBlocksComposer({
        latestRun: {
          ...running.latestRun,
          lifecycleStatus: "waiting_approval",
        },
      }),
    ).toBe(true);
    const waitingForUser = {
      latestRun: {
        ...running.latestRun,
        lifecycleStatus: "waiting_for_user" as const,
      },
    };
    expect(agentThreadBlocksComposer(waitingForUser)).toBe(true);
    expect(agentThreadFallbackPollInterval(waitingForUser)).toBe(false);
  });

  it("reconnects a lost Thread stream with bounded jittered backoff", () => {
    expect(agentThreadStreamRetryDelay(0, () => 0)).toBe(250);
    expect(agentThreadStreamRetryDelay(1, () => 1)).toBe(625);
    expect(agentThreadStreamRetryDelay(20, () => 1)).toBe(5_000);
  });

  it("drains only after a normal end or an explicitly resumed failed Run", () => {
    const run = {
      id: "01K00000000000000000000009",
      lifecycleStatus: "running" as const,
      updatedAt: "2026-09-15T12:00:00.000Z",
    };
    expect(agentMessageQueueCanDrain({ latestRun: run })).toBe(false);
    expect(
      agentMessageQueueCanDrain({
        latestRun: { ...run, lifecycleStatus: "succeeded" },
      }),
    ).toBe(true);
    expect(
      agentMessageQueuePauseReason({
        latestRun: { ...run, lifecycleStatus: "failed" },
      }),
    ).toBe("failed");
    expect(
      agentMessageQueueCanDrain(
        { latestRun: { ...run, lifecycleStatus: "failed" } },
        run.id,
      ),
    ).toBe(true);
    expect(
      agentMessageQueuePauseReason({
        latestRun: { ...run, lifecycleStatus: "waiting_approval" },
      }),
    ).toBe("waiting_approval");
    expect(
      agentMessageQueuePauseReason(
        {
          latestRun: { ...run, lifecycleStatus: "waiting_for_user" },
        },
        run.id,
      ),
    ).toBe("waiting_for_user");
  });

  it("requires a visible, post-visibility Thread snapshot before queue mutation", () => {
    const current = {
      visible: true,
      mounted: true,
      dataUpdatedAt: 2_000,
      visibleSince: 1_000,
      currentRunId: "run-1",
      currentRunStatus: "succeeded",
      expectedRunId: "run-1",
      expectedRunStatus: "succeeded",
    };
    expect(agentMessageQueueSnapshotIsCurrent(current)).toBe(true);
    expect(
      agentMessageQueueSnapshotIsCurrent({ ...current, visible: false }),
    ).toBe(false);
    expect(
      agentMessageQueueSnapshotIsCurrent({
        ...current,
        dataUpdatedAt: 999,
      }),
    ).toBe(false);
    expect(
      agentMessageQueueSnapshotIsCurrent({
        ...current,
        currentRunId: "newer-run",
      }),
    ).toBe(false);
  });

  it("resolves an accepted barrier by Run id when a newer latest Run is visible", () => {
    expect(
      acceptedAgentMessageQueueBarrierAction({
        acceptedRunId: "accepted-run",
        latestRunId: "newer-run",
        resolvedRunId: "accepted-run",
        resolvedThreadId: "thread-1",
        threadId: "thread-1",
        pendingCount: 1,
      }),
    ).toBe("pause_and_settle");
    expect(
      acceptedAgentMessageQueueBarrierAction({
        acceptedRunId: "accepted-run",
        latestRunId: "newer-run",
        resolvedRunId: "accepted-run",
        resolvedThreadId: "another-thread",
        threadId: "thread-1",
        pendingCount: 1,
      }),
    ).toBe("wait");
    expect(
      acceptedAgentMessageQueueBarrierAction({
        acceptedRunId: "accepted-run",
        latestRunId: "accepted-run",
        pendingCount: 1,
      }),
    ).toBe("settle");
  });

  it("treats a failed Stop as satisfied when the same Run already settled", () => {
    const run = {
      id: "01K00000000000000000000009",
      lifecycleStatus: "succeeded" as const,
      updatedAt: "2026-09-15T13:56:31.000Z",
    };
    expect(agentStopRaceAlreadySettled(run.id, { latestRun: run })).toBe(true);
    expect(
      agentStopRaceAlreadySettled(run.id, {
        latestRun: { ...run, lifecycleStatus: "cancelled" },
      }),
    ).toBe(true);
    expect(
      agentStopRaceAlreadySettled(run.id, {
        latestRun: { ...run, lifecycleStatus: "running" },
      }),
    ).toBe(false);
    expect(
      agentStopRaceAlreadySettled(run.id, {
        latestRun: { ...run, id: "newer-run" },
      }),
    ).toBe(false);
  });

  it("blocks queue retrieval instead of overwriting any current Composer draft", () => {
    const empty = {
      message: "",
      attachmentCount: 0,
      referenceCount: 0,
      hasCanvasEntry: false,
      submissionPending: false,
    };
    expect(agentComposerBlocksQueueTake(empty)).toBe(false);
    expect(agentComposerBlocksQueueTake({ ...empty, message: " " })).toBe(true);
    expect(agentComposerBlocksQueueTake({ ...empty, attachmentCount: 1 })).toBe(
      true,
    );
    expect(agentComposerBlocksQueueTake({ ...empty, referenceCount: 1 })).toBe(
      true,
    );
    expect(
      agentComposerBlocksQueueTake({ ...empty, hasCanvasEntry: true }),
    ).toBe(true);
    expect(
      agentComposerBlocksQueueTake({ ...empty, submissionPending: true }),
    ).toBe(true);
  });

  it("rebuilds every persisted request reference for Composer retrieval", () => {
    const restored = queuedAgentMessageComposerReferences(
      {
        threadId: "thread-1",
        message: "Revise this",
        attachments: [{ assetId: "asset-1", artifactId: "artifact-1" }],
        references: [
          { kind: "canvas", resourceId: "canvas-1", version: 4 },
          { kind: "workflow", resourceId: "workflow-1" },
        ],
        brandContext: {
          brandKitId: "brand-1",
          brandKitRevisionId: "brand-revision-1",
        },
        skillRevisionId: "skill-revision-1",
      },
      {
        asset: "Asset",
        brand: "Brand",
        canvas: "Canvas",
        skill: "Skill",
        workflow: "Workflow",
      },
    );

    expect(restored).toEqual([
      expect.objectContaining({
        kind: "asset",
        assetId: "asset-1",
        artifactId: "artifact-1",
      }),
      expect.objectContaining({
        kind: "canvas",
        resourceId: "canvas-1",
        version: 4,
      }),
      expect.objectContaining({
        kind: "workflow",
        resourceId: "workflow-1",
      }),
      expect.objectContaining({
        kind: "brand",
        brandKitId: "brand-1",
        brandKitRevisionId: "brand-revision-1",
      }),
      expect.objectContaining({
        kind: "skill",
        skillRevisionId: "skill-revision-1",
      }),
    ]);
  });

  it("restores a queued private Artifact without turning it into an Asset reference", () => {
    const restored = queuedAgentMessageComposerReferences(
      {
        message: "Use this private screenshot",
        attachments: [{ artifactId: "artifact-private" }],
      },
      {
        asset: "Image",
        brand: "Brand",
        canvas: "Canvas",
        skill: "Skill",
        workflow: "Workflow",
      },
    );
    expect(restored).toEqual([
      {
        kind: "artifact",
        id: "artifact:artifact-private",
        title: "Image",
        artifactId: "artifact-private",
      },
    ]);
  });

  it("stages one exact result for a later message without changing the existing draft", () => {
    const references = [
      {
        kind: "canvas" as const,
        id: "canvas:current",
        title: "当前画板",
        resourceId: "canvas-current",
        version: 2,
      },
    ];
    const input = {
      references,
      activeReferenceCount: 1,
      uploadedAttachmentCount: 0,
      maximumAttachments: 8,
      maximumReferences: 12,
      artifactId: "artifact-result",
      title: "小雪候选图",
    };
    const added = stageAgentResultComposerReference(input);
    expect(added).toEqual({
      status: "added",
      references: [
        references[0],
        {
          kind: "artifact",
          id: "artifact:artifact-result",
          artifactId: "artifact-result",
          title: "小雪候选图",
        },
      ],
    });
    expect(references).toHaveLength(1);
    expect(
      stageAgentResultComposerReference({
        ...input,
        references: added.references,
        activeReferenceCount: 2,
      }),
    ).toEqual({ status: "existing", references: added.references });
    expect(
      stageAgentResultComposerReference({
        ...input,
        uploadedAttachmentCount: 8,
      }),
    ).toEqual({ status: "full", references });
  });

  it("recovers taken Canvas entry context but ignores a pre-take staging record", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const entryContext = {
      originSurface: "canvas" as const,
      canvasDraftId: "canvas-1",
      canvasDraftVersion: 7,
      pageKey: "page-1",
      selectedElementKeys: ["element-1"],
      returnTo: "/w/workspace/agent/thread-1",
    };

    expect(
      persistRetrievedCanvasEntry(
        "composer-key",
        "queue-item-1",
        entryContext,
        storage,
      ),
    ).toBe(true);
    expect(
      readRetrievedCanvasEntry("composer-key", new Set(), storage),
    ).toEqual(entryContext);
    expect(
      readRetrievedCanvasEntry(
        "composer-key",
        new Set(["queue-item-1"]),
        storage,
      ),
    ).toBeUndefined();
    expect(values.size).toBe(0);
  });

  it("does not turn an accepted message into a send failure when cache refresh fails", async () => {
    await expect(
      synchronizeAcceptedAgentMessage(
        () => Promise.reject(new Error("thread list refresh failed")),
        () => Promise.reject(new Error("thread refresh failed")),
      ),
    ).resolves.toBeUndefined();
  });
});
