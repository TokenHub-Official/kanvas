import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createAgentRuntimeStore } from "../src/runtime/agent-runtime-store.js";

const workspaceId = "01K00000000000000000000001";
const organizationId = "01K00000000000000000000002";
const principalId = "01K00000000000000000000003";
const authorityId = "01K00000000000000000000004";
const threadId = "01K00000000000000000000005";
const agentDefinitionId = "01K0000000000000000000000D";
const runId = "01K00000000000000000000006";
const messageId = "01K00000000000000000000007";
const assistantMessageId = "01K0000000000000000000000A";
const modelCallId = "01K00000000000000000000008";
const modelAttemptId = "01K00000000000000000000009";
const actionReceiptId = "01K0000000000000000000000C";
const now = new Date("2026-08-24T09:00:00.000Z");
const digest =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const foundationContext = {
  schemaVersion: 1,
  profileRevisionId: "01K0000000000000000000000B",
  profileCanonicalDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  skillViewDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  skills: [],
} as const;

const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "workspace.read"],
  trusted: true,
};

const authorizationRow = {
  principalId,
  principalStatus: "active",
  membershipId: authorityId,
  membershipRole: "editor",
  membershipStatus: "active",
  membershipVersion: 1,
  organizationId,
  workspaceId,
  workspaceStatus: "active",
};

function result(affectedRows = 1): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function queuedPool(
  results: readonly unknown[],
  diagnosticActions: readonly unknown[] = [],
  runtimeRevision?: unknown,
) {
  const queue = [...results];
  const beginTransaction = vi.fn(() => Promise.resolve());
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const release = vi.fn();
  const execute = vi.fn((...arguments_: readonly unknown[]) => {
    const sql = String(arguments_[0]);
    if (sql.includes("FROM instance_runtime_configuration_revision"))
      return Promise.resolve([runtimeRevision ? [runtimeRevision] : [], []]);
    if (sql.startsWith("UPDATE agent_run SET runtime_configuration_version"))
      return Promise.resolve([result(), []]);
    if (sql.includes(" AS threadId FROM "))
      return Promise.resolve([[{ threadId }], []]);
    if (
      sql ===
      "SELECT id FROM agent_thread WHERE workspace_id = ? AND id = ? FOR UPDATE"
    )
      return Promise.resolve([[{ id: threadId }], []]);
    if (sql.startsWith("UPDATE agent_thread SET view_revision"))
      return Promise.resolve([result(), []]);
    if (sql.startsWith("SELECT id, query_diagnostics AS diagnostics"))
      return Promise.resolve([[], []]);
    if (sql.startsWith("SELECT id, action_number AS actionNumber"))
      return Promise.resolve([diagnosticActions, []]);
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("Unexpected SQL execution."));
    }
    return Promise.resolve(next);
  });
  const connection = {
    beginTransaction,
    commit,
    rollback,
    release,
    execute,
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(() => Promise.resolve(connection)),
  } as unknown as Pool;
  return {
    pool,
    commit,
    execute,
    rollback,
    remaining: () => queue.length,
  };
}

function threadRow() {
  return {
    id: threadId,
    workspaceId,
    createdByPrincipalId: principalId,
    agentDefinitionId,
    agentProfileRevisionId: foundationContext.profileRevisionId,
    lifecycleStatus: "active",
    title: "Summer campaign",
    creationRequestKey: "agent-thread-1",
    creationRequestHash: digest,
    version: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function runRow(status: "queued" | "running" | "succeeded" = "running") {
  return {
    id: runId,
    workspaceId,
    threadId,
    parentRunId: null,
    triggerMessageId: messageId,
    actorPrincipalId: principalId,
    lifecycleStatus: status,
    contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
    contextDigest: digest,
    toolViewDigest: digest,
    promptRevision: "creative-assistant-v1",
    maximumModelCalls: 4,
    maximumToolCalls: 4,
    idempotencyKey: "agent-run-1",
    requestHash: digest,
    terminalReasonCode: null,
    version: 1,
    executionDeadlineAt: new Date(now.getTime() + 120_000),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    profileRevisionId: foundationContext.profileRevisionId,
    profileCanonicalDigest: foundationContext.profileCanonicalDigest,
    skillViewDigest: foundationContext.skillViewDigest,
    skillContextSnapshot: foundationContext.skills,
  };
}

function modelCallRow(status: "pending" | "running" = "running") {
  return {
    id: modelCallId,
    workspaceId,
    agentRunId: runId,
    callNumber: 1,
    purpose: "plan",
    lifecycleStatus: status,
    modelProfileKey: "agent-planner",
    inputDigest: digest,
    outputDigest: null,
    finishReason: null,
    terminalReasonCode: null,
    version: status === "pending" ? 1 : 2,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function modelAttemptRow() {
  return {
    id: modelAttemptId,
    workspaceId,
    agentModelCallId: modelCallId,
    attemptNumber: 1,
    transitionKind: "initial",
    lifecycleStatus: "running",
    routeSnapshot: { provider: "workspace-default" },
    routeDigest: digest,
    providerRequestId: null,
    acceptedMarker: null,
    usageDocument: null,
    usageDigest: null,
    terminalReasonCode: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
  };
}

function actionReceiptRow(status: "proposed" | "running" = "proposed") {
  return {
    id: actionReceiptId,
    workspaceId,
    agentRunId: runId,
    actionNumber: 1,
    toolCallId: "tool-call-1",
    toolKey: "workflow.propose.entrypoint-1",
    effect: "compute",
    approvalMode: "before_commit",
    lifecycleStatus: status,
    inputDigest: digest,
    outputDigest: null,
    proposalDocument: null,
    outcomeKind: null,
    queryResultCount: null,
    canvasDraftId: null,
    capabilityRunId: null,
    workflowRunId: null,
    workflowDefinitionId: null,
    skillDraftId: null,
    beforeVersion: null,
    afterVersion: null,
    undoGroupId: null,
    terminalReasonCode: null,
    version: status === "proposed" ? 1 : 2,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe("Agent Runtime Store", () => {
  it("restricts diagnostics to audit permission and projects only bounded diagnostic facts", async () => {
    const denied = queuedPool([[[authorizationRow], []]]);
    await expect(
      createAgentRuntimeStore(denied.pool).getRunDiagnostics(scope, runId, now),
    ).rejects.toThrow();
    expect(
      denied.execute.mock.calls.some(([sql]) =>
        String(sql).includes("FROM agent_run"),
      ),
    ).toBe(false);
    const allowed = queuedPool(
      [
        [[{ ...authorizationRow, membershipRole: "admin" }], []],
        [[runRow()], []],
        [
          [
            {
              id: modelCallId,
              purpose: "plan",
              callNumber: 16,
              finishReason: "tool-calls",
              modelProfileKey: "agent.test",
              inputTokens: "12320",
              outputTokens: 135,
              lifecycleStatus: "failed",
              reasonCode: "agent.model_binding_preparation_conflict",
              createdAt: now,
              updatedAt: now,
              attemptId: modelAttemptId,
              resolution: "failed",
              acceptedMarker: 0,
              requestId: null,
              credential: "must-not-leak",
              requestBody: { prompt: "private input" },
            },
          ],
          [],
        ],
      ],
      [
        {
          id: actionReceiptId,
          actionNumber: "1",
          toolKey: "capability.search",
          lifecycleStatus: "failed",
          reasonCode: "capability.unavailable",
          createdAt: now,
          updatedAt: now,
          input: "private input",
          credential: "must-not-leak",
        },
      ],
    );
    const view = await createAgentRuntimeStore(allowed.pool).getRunDiagnostics(
      {
        ...scope,
        effectivePermissions: [...scope.effectivePermissions, "audit.read"],
      },
      runId,
      now,
    );
    expect(view?.calls[0]).toMatchObject({
      callNumber: 16,
      finishReason: "tool-calls",
      modelProfileKey: "agent.test",
      inputTokens: 12320,
      outputTokens: 135,
      routeResolved: false,
      providerAccepted: false,
      reasonCode: "agent.model_binding_preparation_conflict",
    });
    expect(view?.limits).toEqual({
      maximumModelCalls: 4,
      maximumToolCalls: runRow().maximumToolCalls,
    });
    expect(view?.actions).toEqual([
      {
        id: actionReceiptId,
        actionNumber: 1,
        toolKey: "capability.search",
        lifecycleStatus: "failed",
        reasonCode: "capability.unavailable",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("must-not-leak");
    expect(JSON.stringify(view)).not.toContain("private input");
    expect(allowed.execute.mock.calls[1]?.[1]).toEqual([workspaceId, runId]);
  });
  it("persists an export request only for its running owned action and rejects snapshot substitution", async () => {
    const request = {
      canvasDraftId: threadId,
      documentVersion: 4,
      pageId: "page-1",
    };
    const row = {
      ...actionReceiptRow("running"),
      toolKey: "canvas.export-png",
      approvalMode: "none",
    };
    const write = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[row], []],
      [result(), []],
    ]);
    const options = {
      authority: scope,
      agentRunId: runId,
      actionReceiptId,
      expectedVersion: row.version,
      request,
      now,
    };
    await expect(
      createAgentRuntimeStore(write.pool).recordCanvasExport(options),
    ).resolves.toMatchObject({
      proposalDocument: { kind: "canvas_export", request },
      version: row.version + 1,
    });
    expect(write.remaining()).toBe(0);
    const changed = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[{ ...row, proposalDocument: { kind: "canvas_export", request } }], []],
    ]);
    await expect(
      createAgentRuntimeStore(changed.pool).recordCanvasExport({
        ...options,
        request: { ...request, documentVersion: 5 },
      }),
    ).rejects.toMatchObject({ code: "agent.identity_conflict" });
  });

  it("records a verified late export without rewriting a failed action", async () => {
    const request = {
      canvasDraftId: threadId,
      documentVersion: 4,
      pageId: "page-1",
    };
    const row = {
      ...actionReceiptRow("running"),
      toolKey: "canvas.export-png",
      lifecycleStatus: "failed",
      terminalReasonCode: "agent.canvas_export_timeout",
      completedAt: now,
      proposalDocument: { kind: "canvas_export", request },
    };
    const completion = {
      status: "succeeded" as const,
      exportSessionId: messageId,
      artifactId: assistantMessageId,
      filename: "poster.png",
    };
    const db = queuedPool([
      [[authorizationRow], []],
      [[runRow("succeeded")], []],
      [[threadRow()], []],
      [[row], []],
      [result(), []],
    ]);
    await expect(
      createAgentRuntimeStore(db.pool).recordCanvasExport({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: row.version,
        request,
        completion,
        now,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "failed",
      terminalReasonCode: "agent.canvas_export_timeout",
      proposalDocument: { request, completion },
    });
    expect(db.remaining()).toBe(0);
  });

  it("commits and returns the published Brand identity in the same completion transaction", async () => {
    const completion = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[actionReceiptRow("running")], []],
      [result(), []],
    ]);
    const outcomeReference = {
      kind: "brand_revision" as const,
      brandKitId: "01K0000000000000000000000E",
      brandKitRevisionId: "01K0000000000000000000000F",
    };
    await expect(
      createAgentRuntimeStore(completion.pool).completeAction({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: 2,
        status: "succeeded",
        outputDigest: digest,
        outcomeReference,
        now,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "succeeded",
      outcomeReference,
    });
    expect(completion.commit).toHaveBeenCalledOnce();
    expect(completion.rollback).not.toHaveBeenCalled();
  });
  it("creates a personal Agent Thread after current agent permission revalidation", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[], []],
      [[{ lifecycle_status: "active", usage_status: "enabled" }], []],
      [result(), []],
    ]);
    const store = createAgentRuntimeStore(queued.pool);

    await expect(
      store.createThread({
        authority: scope,
        threadId,
        agentDefinitionId,
        agentProfileRevisionId: foundationContext.profileRevisionId,
        title: "Summer campaign",
        idempotencyKey: "agent-thread-1",
        now,
      }),
    ).resolves.toMatchObject({
      id: threadId,
      workspaceId,
      createdByPrincipalId: principalId,
      lifecycleStatus: "active",
      title: "Summer campaign",
      version: 1,
    });
    expect(queued.remaining()).toBe(0);
    expect(queued.commit).toHaveBeenCalledOnce();
    expect(queued.rollback).not.toHaveBeenCalled();
  });

  it("renames and archives an inactive owned Agent Thread with optimistic concurrency", async () => {
    const renamedRow = {
      ...threadRow(),
      title: "Autumn campaign",
      version: 2,
    };
    const rename = queuedPool([
      [[authorizationRow], []],
      [[threadRow()], []],
      [result(), []],
      [[renamedRow], []],
    ]);
    await expect(
      createAgentRuntimeStore(rename.pool).renameThread({
        authority: scope,
        threadId,
        expectedVersion: 1,
        title: "Autumn campaign",
        now,
      }),
    ).resolves.toMatchObject({ title: "Autumn campaign", version: 2 });
    expect(rename.remaining()).toBe(0);

    const archivedRow = {
      ...renamedRow,
      lifecycleStatus: "archived",
      archivedAt: now,
      version: 3,
    };
    const archive = queuedPool([
      [[authorizationRow], []],
      [[renamedRow], []],
      [[], []],
      [result(), []],
      [[archivedRow], []],
    ]);
    await expect(
      createAgentRuntimeStore(archive.pool).archiveThread({
        authority: scope,
        threadId,
        expectedVersion: 2,
        now,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "archived",
      version: 3,
      archivedAt: now,
    });
    expect(archive.remaining()).toBe(0);
  });

  it("lists personal threads and reads the latest run and thread actions", async () => {
    const olderThreadId = "01K0000000000000000000000D";
    const list = queuedPool([
      [[authorizationRow], []],
      [
        [
          {
            ...threadRow(),
            latestRunId: runId,
            latestRunStatus: "running",
            latestRunUpdatedAt: now,
          },
          {
            ...threadRow(),
            id: olderThreadId,
            updatedAt: new Date(now.getTime() - 1_000),
            latestRunId: null,
            latestRunStatus: null,
            latestRunUpdatedAt: null,
          },
        ],
        [],
      ],
    ]);
    await expect(
      createAgentRuntimeStore(list.pool).listThreads({
        authority: scope,
        limit: 1,
        now,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: threadId,
          title: "Summer campaign",
          latestRun: {
            id: runId,
            lifecycleStatus: "running",
            updatedAt: now,
          },
        }),
      ],
      nextCursor: { id: threadId, updatedAt: now },
    });
    expect(list.remaining()).toBe(0);

    const latestRun = queuedPool([
      [[authorizationRow], []],
      [[{ ...threadRow(), activeRunId: runId }], []],
      [[runRow()], []],
    ]);
    await expect(
      createAgentRuntimeStore(latestRun.pool).getLatestThreadRun(
        scope,
        threadId,
        now,
      ),
    ).resolves.toMatchObject({ id: runId, lifecycleStatus: "running" });
    expect(latestRun.remaining()).toBe(0);
    const pinnedRun = queuedPool([
      [[authorizationRow], []],
      [
        [
          {
            ...threadRow(),
            activeLeafMessageId: assistantMessageId,
            activeRunId: runId,
          },
        ],
        [],
      ],
      [[runRow()], []],
    ]);
    await createAgentRuntimeStore(pinnedRun.pool).getLatestThreadRun(
      scope,
      threadId,
      now,
    );
    expect(pinnedRun.execute.mock.calls[2]?.[0]).toContain("AND run.id = ?");
    expect(pinnedRun.execute.mock.calls[2]?.[0]).not.toContain(
      "brandKitRevisionId')) = 'STRING'",
    );
    expect(pinnedRun.execute.mock.calls[2]?.[1]).toEqual([workspaceId, runId]);
    expect(pinnedRun.remaining()).toBe(0);

    const actions = queuedPool([
      [[authorizationRow], []],
      [[threadRow()], []],
      [[actionReceiptRow()], []],
    ]);
    await expect(
      createAgentRuntimeStore(actions.pool).listThreadActions(
        scope,
        threadId,
        20,
        now,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: actionReceiptId,
        lifecycleStatus: "proposed",
      }),
    ]);
    expect(actions.remaining()).toBe(0);
  });

  it.each([false, true])(
    "atomically starts one bounded run with governance=%s",
    async (governed) => {
      const queued = queuedPool(
        [
          [[authorizationRow], []],
          [[], []],
          [[threadRow()], []],
          [[{ lifecycle_status: "active", usage_status: "enabled" }], []],
          [[], []],
          [[{ nextSequence: 1 }], []],
          [result(), []],
          [result(), []],
          [result(), []],
          [result(), []],
          [result(), []],
          [result(), []],
        ],
        [],
        governed
          ? {
              version: 3,
              document: {
                activated: true,
                agent: {
                  maximumModelCalls: 50,
                  maximumToolCalls: 100,
                  timeoutSeconds: 600,
                },
                downloads: {
                  defaults: { enabled: true, allowedOrigins: [] },
                  providers: [],
                },
              },
              reason: "test",
              publishedBy: principalId,
              publishedAt: now,
              restoredFromVersion: null,
            }
          : undefined,
      );
      const store = createAgentRuntimeStore(
        queued.pool,
        governed ? { instanceId: "test" } : undefined,
      );

      await expect(
        store.startRun({
          authority: scope,
          runId,
          threadId,
          userMessageId: messageId,
          userMessage: {
            schemaVersion: 1,
            role: "user",
            parts: [
              {
                type: "text",
                text: "Create a summer poster from the selected product image.",
              },
            ],
          },
          contextSnapshot: {
            schemaVersion: 1,
            surfaceKind: "workspace_home",
          },
          toolViewDigest: digest,
          promptRevision: "creative-assistant-v1",
          maximumModelCalls: 4,
          maximumToolCalls: 0,
          foundationContext,
          executionDeadlineAt: new Date(now.getTime() + 120_000),
          idempotencyKey: "agent-run-1",
          now,
        }),
      ).resolves.toMatchObject({
        id: runId,
        threadId,
        lifecycleStatus: "queued",
        maximumModelCalls: governed ? 50 : 4,
        maximumToolCalls: governed ? 100 : 0,
        ...(governed
          ? {
              runtimeConfigurationVersion: 3,
              executionDeadlineAt: new Date(now.getTime() + 600_000),
            }
          : {}),
        foundationContext,
      });
      expect(queued.remaining()).toBe(0);
      expect(queued.commit).toHaveBeenCalledOnce();
      expect(queued.rollback).not.toHaveBeenCalled();
    },
  );

  it("appends and reads the user-visible assistant result", async () => {
    const assistantMessage = {
      schemaVersion: 1,
      role: "assistant",
      parts: [{ type: "text", text: '{"summary":"Summer plan"}' }],
    } as const;
    const append = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[], []],
      [[{ nextSequence: 2 }], []],
      [[{ nextAlternative: 1 }], []],
      [result(), []],
      [result(), []],
    ]);
    await expect(
      createAgentRuntimeStore(append.pool).appendAssistantMessage({
        authority: scope,
        agentRunId: runId,
        messageId: assistantMessageId,
        message: assistantMessage,
        now,
      }),
    ).resolves.toBeUndefined();
    expect(append.remaining()).toBe(0);

    const read = queuedPool([
      [[authorizationRow], []],
      [[runRow("succeeded")], []],
      [[threadRow()], []],
      [[{ content: assistantMessage }], []],
    ]);
    await expect(
      createAgentRuntimeStore(read.pool).getAssistantMessage(scope, runId, now),
    ).resolves.toEqual(assistantMessage);
    expect(read.remaining()).toBe(0);
  });

  it.each([2, 4])(
    "uses configured independent memory call budget (used=%s)",
    async (memoryCount) => {
      const fixture = queuedPool([
        [[authorizationRow], []],
        [[runRow()], []],
        [[threadRow()], []],
        [[], []],
        [[{ memoryCount, titleCount: 1, mainCount: 4 }], []],
        ...(memoryCount < 4 ? [[result(), []]] : []),
      ]);
      const pending = createAgentRuntimeStore(fixture.pool).beginModelCall({
        authority: scope,
        agentRunId: runId,
        modelCallId,
        callNumber: 69,
        purpose: "memory_observation",
        modelProfileKey: "agent-planner",
        inputDigest: digest,
        now,
      });
      if (memoryCount < 4)
        await expect(pending).resolves.toMatchObject({
          lifecycleStatus: "pending",
        });
      else
        await expect(pending).rejects.toMatchObject({
          code: "agent.limit_exceeded",
        });
      expect(fixture.remaining()).toBe(0);
    },
  );

  it("persists one successful model call and accepted attempt without a WorkflowRun", async () => {
    const beginCall = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[], []],
      [[{ memoryCount: 0, titleCount: 0, mainCount: 0 }], []],
      [result(), []],
    ]);
    const beginStore = createAgentRuntimeStore(beginCall.pool);
    await expect(
      beginStore.beginModelCall({
        authority: scope,
        agentRunId: runId,
        modelCallId,
        callNumber: 1,
        purpose: "plan",
        modelProfileKey: "agent-planner",
        inputDigest: digest,
        now,
      }),
    ).resolves.toMatchObject({
      id: modelCallId,
      agentRunId: runId,
      lifecycleStatus: "pending",
    });
    expect(beginCall.remaining()).toBe(0);

    const startAttempt = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[modelCallRow("pending")], []],
      [[], []],
      [result(), []],
      [result(), []],
    ]);
    const attemptStore = createAgentRuntimeStore(startAttempt.pool);
    await expect(
      attemptStore.startModelAttempt({
        authority: scope,
        agentRunId: runId,
        modelCallId,
        attemptId: modelAttemptId,
        attemptNumber: 1,
        transitionKind: "initial",
        routeSnapshot: { provider: "workspace-default" },
        now,
      }),
    ).resolves.toMatchObject({
      id: modelAttemptId,
      agentModelCallId: modelCallId,
      lifecycleStatus: "running",
      accepted: false,
    });
    expect(startAttempt.remaining()).toBe(0);

    const completeAttempt = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[modelCallRow()], []],
      [[modelAttemptRow()], []],
      [result(), []],
      [result(), []],
    ]);
    const completionStore = createAgentRuntimeStore(completeAttempt.pool);
    await expect(
      completionStore.completeModelAttempt({
        authority: scope,
        agentRunId: runId,
        modelCallId,
        attemptId: modelAttemptId,
        status: "succeeded",
        outputDigest: digest,
        finishReason: "stop",
        providerRequestId: "response-1",
        usageDocument: {
          inputTokens: 120,
          outputTokens: 40,
        },
        now,
      }),
    ).resolves.toMatchObject({
      call: {
        lifecycleStatus: "succeeded",
        outputDigest: digest,
        finishReason: "stop",
      },
      attempt: {
        lifecycleStatus: "succeeded",
        accepted: true,
        providerRequestId: "response-1",
      },
    });
    expect(completeAttempt.remaining()).toBe(0);
  });

  it("records one proposed Tool action before canonical execution and completes it", async () => {
    const proposal = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[], []],
      [result(), []],
    ]);
    const proposalStore = createAgentRuntimeStore(proposal.pool);
    await expect(
      proposalStore.proposeAction({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        actionNumber: 1,
        toolCallId: "tool-call-1",
        toolKey: "workflow.propose.entrypoint-1",
        effect: "compute",
        approvalMode: "before_commit",
        inputDigest: digest,
        now,
      }),
    ).resolves.toMatchObject({
      id: actionReceiptId,
      lifecycleStatus: "proposed",
      version: 1,
    });
    expect(proposal.remaining()).toBe(0);

    const transition = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[actionReceiptRow()], []],
      [result(), []],
    ]);
    const transitionStore = createAgentRuntimeStore(transition.pool);
    await expect(
      transitionStore.transitionAction({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: 1,
        toStatus: "running",
        now,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "running",
      version: 2,
    });
    expect(transition.remaining()).toBe(0);

    const completion = queuedPool([
      [[authorizationRow], []],
      [[runRow()], []],
      [[threadRow()], []],
      [[actionReceiptRow("running")], []],
      [result(), []],
    ]);
    const completionStore = createAgentRuntimeStore(completion.pool);
    await expect(
      completionStore.completeAction({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: 2,
        status: "succeeded",
        outputDigest: digest,
        outcomeReference: { kind: "query", resultCount: 1 },
        now,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "succeeded",
      outputDigest: digest,
      outcomeReference: { kind: "query", resultCount: 1 },
      version: 3,
    });
    expect(
      completion.execute.mock.calls.find((call) =>
        String(call[0]).includes("SET lifecycle_status = ?, output_digest = ?"),
      )?.[1],
    ).toHaveLength(22);
    expect(completion.remaining()).toBe(0);

    const replay = queuedPool([
      [[authorizationRow], []],
      [[runRow("succeeded")], []],
      [[threadRow()], []],
      [
        [
          {
            ...actionReceiptRow("running"),
            lifecycleStatus: "succeeded",
            outputDigest: digest,
            outcomeKind: "query",
            queryResultCount: 1,
            version: 3,
            completedAt: now,
          },
        ],
        [],
      ],
    ]);
    await expect(
      createAgentRuntimeStore(replay.pool).completeAction({
        authority: scope,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: 2,
        status: "succeeded",
        outputDigest: digest,
        outcomeReference: { kind: "query", resultCount: 1 },
        now,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "succeeded", version: 3 });
    expect(replay.remaining()).toBe(0);
  });
});

it.each(["succeeded", "failed", "cancelled"])(
  "declines a pending action without rewriting a %s run",
  async (status) => {
    const run = { ...runRow(), lifecycleStatus: status, completedAt: now };
    const action = {
      ...actionReceiptRow(),
      lifecycleStatus: "waiting_approval",
    };
    const db = queuedPool([
      [[authorizationRow], []],
      [[action], []],
      [[run], []],
      [[threadRow()], []],
      [[action], []],
      [result(), []],
    ]);
    await expect(
      createAgentRuntimeStore(db.pool).declinePendingAction({
        authority: scope,
        actionReceiptId,
        now,
      }),
    ).resolves.toMatchObject({
      action: { lifecycleStatus: "cancelled" },
      run: { lifecycleStatus: status },
      replayed: false,
    });
    expect(
      db.execute.mock.calls.some(
        ([sql]) => typeof sql === "string" && /UPDATE agent_run\s/u.test(sql),
      ),
    ).toBe(false);
    expect(db.remaining()).toBe(0);
    const replayAction = {
      ...action,
      lifecycleStatus: "cancelled",
      terminalReasonCode: "agent.action_declined",
      completedAt: now,
    };
    const replay = queuedPool([
      [[authorizationRow], []],
      [[replayAction], []],
      [[run], []],
      [[threadRow()], []],
      [[replayAction], []],
    ]);
    await expect(
      createAgentRuntimeStore(replay.pool).declinePendingAction({
        authority: scope,
        actionReceiptId,
        now,
      }),
    ).resolves.toMatchObject({
      replayed: true,
      run: { lifecycleStatus: status },
    });
  },
);
