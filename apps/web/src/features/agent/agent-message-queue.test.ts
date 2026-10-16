import type { CreateWorkspaceAgentMessageBody } from "@kanvas/contracts/api";
import { describe, expect, it, vi } from "vitest";

import {
  acceptAgentMessageDelivery,
  agentMessageQueueStorageKey,
  emptyAgentMessageQueueState,
  enqueueAgentMessage,
  failAgentMessageDelivery,
  nextAgentMessageForDelivery,
  parseAgentMessageQueueState,
  pauseAgentMessageQueue,
  persistAgentMessageQueue,
  readAgentMessageQueue,
  recoverExpiredAgentMessageDelivery,
  removeQueuedAgentMessage,
  resumeAgentMessageQueue,
  settleAcceptedAgentMessage,
  startAgentMessageDelivery,
  takeQueuedAgentMessage,
  withAgentMessageQueueDeliveryLock,
  withAgentMessageQueueMutationLock,
  type AgentMessageQueueScope,
} from "./agent-message-queue.js";

const scope: AgentMessageQueueScope = {
  principalId: "01K00000000000000000000001",
  workspaceId: "01K00000000000000000000002",
  threadId: "01K00000000000000000000003",
};

const request: CreateWorkspaceAgentMessageBody = {
  threadId: scope.threadId,
  message: "Create the launch image",
  libraryIds: ["01K00000000000000000000009"],
  browserCanvasExport: true,
  attachments: [
    {
      assetId: "01K00000000000000000000004",
      artifactId: "01K00000000000000000000005",
    },
  ],
  references: [
    {
      kind: "canvas",
      resourceId: "01K00000000000000000000006",
      version: 7,
    },
  ],
  brandContext: {
    brandKitId: "01K00000000000000000000007",
    brandKitRevisionId: "01K00000000000000000000008",
  },
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("Agent pending message queue", () => {
  it("persists an exact request snapshot under principal, Workspace, and Thread scope", () => {
    const storage = memoryStorage();
    const enqueued = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      request,
      {
        createId: () => "queue-item-1",
        now: () => new Date("2026-09-15T12:00:00.000Z"),
      },
    );
    request.attachments?.splice(0);

    expect(enqueued.item).toMatchObject({
      id: "queue-item-1",
      idempotencyKey: "agent-message:queue-item-1",
      status: "queued",
      request: {
        message: "Create the launch image",
        libraryIds: ["01K00000000000000000000009"],
        attachments: [
          {
            assetId: "01K00000000000000000000004",
            artifactId: "01K00000000000000000000005",
          },
        ],
        references: [{ kind: "canvas", version: 7 }],
      },
    });
    expect(persistAgentMessageQueue(scope, enqueued.state, storage)).toBe(true);
    expect(readAgentMessageQueue(scope, storage)).toEqual(enqueued.state);
    expect(agentMessageQueueStorageKey(scope)).toContain(scope.principalId);
    expect(
      readAgentMessageQueue({ ...scope, threadId: "another-thread" }, storage),
    ).toEqual(emptyAgentMessageQueueState());
  });

  it("delivers one FIFO item and fences editing or removal after delivery begins", () => {
    const first = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      { ...request, attachments: [], message: "first" },
      { createId: () => "first" },
    );
    const second = enqueueAgentMessage(
      first.state,
      scope,
      { ...request, attachments: [], message: "second" },
      { createId: () => "second" },
    );

    expect(nextAgentMessageForDelivery(second.state)?.id).toBe("first");
    const sending = startAgentMessageDelivery(
      second.state,
      "first",
      "tab-a",
      1_000,
    );
    expect(sending.changed).toBe(true);
    expect(nextAgentMessageForDelivery(sending.state)).toBeUndefined();
    expect(takeQueuedAgentMessage(sending.state, "first").changed).toBe(false);
    expect(removeQueuedAgentMessage(sending.state, "first").changed).toBe(
      false,
    );
    expect(
      startAgentMessageDelivery(sending.state, "second", "tab-b", 1_000)
        .changed,
    ).toBe(false);
  });

  it("uses an accepted tombstone until the accepted Run is visible", () => {
    const enqueued = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      { ...request, attachments: [] },
      { createId: () => "accepted-item" },
    );
    const sending = startAgentMessageDelivery(
      enqueued.state,
      enqueued.item.id,
      "tab-a",
      1_000,
    );
    const accepted = acceptAgentMessageDelivery(
      sending.state,
      enqueued.item.id,
      "tab-a",
      {
        threadId: scope.threadId,
        runId: "01K00000000000000000000009",
        lifecycleStatus: "queued",
      },
      new Date("2026-09-15T12:01:00.000Z"),
    );

    expect(accepted.state.items).toEqual([]);
    expect(accepted.state.accepted).toMatchObject({
      itemId: "accepted-item",
      runId: "01K00000000000000000000009",
    });
    expect(nextAgentMessageForDelivery(accepted.state)).toBeUndefined();
    expect(
      settleAcceptedAgentMessage(accepted.state, "different-run").changed,
    ).toBe(false);
    expect(
      settleAcceptedAgentMessage(accepted.state, "01K00000000000000000000009")
        .state.accepted,
    ).toBeUndefined();
  });

  it("pauses an uncertain outcome and retries the same snapshot and idempotency key", () => {
    const enqueued = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      { ...request, attachments: [] },
      {
        createId: () => "uncertain-item",
        idempotencyKey: "agent-message:original-attempt",
      },
    );
    const sending = startAgentMessageDelivery(
      enqueued.state,
      enqueued.item.id,
      "tab-a",
      1_000,
    );
    const uncertain = failAgentMessageDelivery(
      sending.state,
      enqueued.item.id,
      "tab-a",
      true,
      2_000,
    );

    expect(uncertain.state).toMatchObject({
      paused: true,
      pauseReason: "delivery_uncertain",
      items: [
        {
          idempotencyKey: "agent-message:original-attempt",
          request: { message: "Create the launch image" },
          status: "uncertain",
        },
      ],
    });
    expect(
      takeQueuedAgentMessage(uncertain.state, enqueued.item.id).changed,
    ).toBe(false);
    const resumed = resumeAgentMessageQueue(uncertain.state);
    expect(nextAgentMessageForDelivery(resumed.state)?.idempotencyKey).toBe(
      "agent-message:original-attempt",
    );
  });

  it("recovers an expired sender lease as an explicitly resumable uncertain item", () => {
    const enqueued = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      { ...request, attachments: [] },
      { createId: () => "expired-item" },
    );
    const sending = startAgentMessageDelivery(
      enqueued.state,
      enqueued.item.id,
      "closed-tab",
      1_000,
    );

    expect(
      recoverExpiredAgentMessageDelivery(sending.state, 1_001).changed,
    ).toBe(false);
    const recovered = recoverExpiredAgentMessageDelivery(
      sending.state,
      100_000,
    );
    expect(recovered.state).toMatchObject({
      paused: true,
      pauseReason: "delivery_uncertain",
      items: [{ status: "uncertain" }],
    });
  });

  it("atomically takes only a still-queued item without changing pause state", () => {
    const first = enqueueAgentMessage(
      emptyAgentMessageQueueState(),
      scope,
      { ...request, attachments: [], message: "first" },
      { createId: () => "take-first" },
    );
    const second = enqueueAgentMessage(
      first.state,
      scope,
      { ...request, attachments: [], message: "second" },
      { createId: () => "take-second" },
    );
    const paused = pauseAgentMessageQueue(second.state, "stopped");
    const taken = takeQueuedAgentMessage(paused.state, "take-first");

    expect(taken.item).toEqual(first.item);
    expect(taken.state).toMatchObject({
      paused: true,
      pauseReason: "stopped",
      items: [{ id: "take-second", request: { message: "second" } }],
    });
  });

  it("keeps pause transitions explicit and reports unavailable persistence", () => {
    const paused = pauseAgentMessageQueue(
      emptyAgentMessageQueueState(),
      "waiting_for_user",
    );
    expect(paused.state.paused).toBe(true);
    expect(resumeAgentMessageQueue(paused.state).state).toMatchObject({
      paused: false,
    });
    expect(
      persistAgentMessageQueue(scope, paused.state, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
  });

  it("drops malformed or cross-Thread stored requests", () => {
    expect(
      parseAgentMessageQueueState(
        {
          version: 1,
          revision: 1,
          paused: false,
          items: [
            {
              id: "wrong-thread",
              idempotencyKey: "agent-message:wrong-thread",
              request: { ...request, threadId: "different-thread" },
              enqueuedAt: "2026-09-15T12:00:00.000Z",
              updatedAt: "2026-09-15T12:00:00.000Z",
              status: "queued",
            },
          ],
        },
        scope,
      ).items,
    ).toEqual([]);
  });

  it("does not run a second sender when the cross-tab delivery lock is unavailable", async () => {
    const operation = vi.fn(() => Promise.resolve("sent"));
    let lockRequests = 0;
    const unavailable = {
      request<T>(
        _name: string,
        _options: { readonly ifAvailable: true; readonly mode: "exclusive" },
        callback: (lock: object | null) => Promise<T | undefined>,
      ): Promise<T | undefined> {
        lockRequests += 1;
        return callback(null);
      },
    };
    await expect(
      withAgentMessageQueueDeliveryLock(scope, operation, unavailable),
    ).resolves.toBeUndefined();
    expect(lockRequests).toBe(1);
    expect(operation).not.toHaveBeenCalled();
  });

  it("serializes cross-tab mutations and fails closed without Web Locks", async () => {
    let tail: Promise<void> = Promise.resolve();
    const lockManager = {
      request<T>(
        _name: string,
        _options: { readonly mode: "exclusive" },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> {
        const result = tail.then(callback);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const order: string[] = [];
    await Promise.all([
      withAgentMessageQueueMutationLock(
        scope,
        async () => {
          order.push("first:start");
          await Promise.resolve();
          order.push("first:end");
        },
        lockManager,
      ),
      withAgentMessageQueueMutationLock(
        scope,
        () => {
          order.push("second:start");
          order.push("second:end");
        },
        lockManager,
      ),
    ]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);

    await expect(
      withAgentMessageQueueMutationLock(
        scope,
        () => Promise.resolve("unsafe"),
        undefined,
      ),
    ).rejects.toThrow("Web Locks");
  });
});
