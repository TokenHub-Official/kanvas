import type {
  AgentModelAttemptRecord,
  AgentModelCallRecord,
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import {
  createAgentModelPreparationCoordinator,
  createGovernedAgentModelPort,
  GovernedAgentModelError,
  type AgentModelCallObservation,
} from "../src/governed-model-port.js";
import type {
  KanvasAgentModelRequest,
  KanvasAgentModelResponse,
} from "../src/kanvas-model.js";

const workspaceId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const agentRunId = "01K00000000000000000000003";
const modelCallId = "01K00000000000000000000004";
const attemptId = "01K00000000000000000000005";
const digest =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const now = new Date("2026-08-24T10:00:00.000Z");
const unusedStream = () => Promise.reject(new Error("unused"));

const authority: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000006",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000007",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run"],
  trusted: true,
};

const request: KanvasAgentModelRequest = {
  schemaVersion: "kanvas.agent-model-request/v1",
  controls: { reasoningLevel: "medium", webSearchMode: "off" },
  prompt: [
    { role: "system", content: "Plan the task." },
    { role: "user", content: [{ type: "text", text: "Create a poster." }] },
  ],
  tools: [],
};

const response: KanvasAgentModelResponse = {
  content: [{ type: "text", text: "Plan ready." }],
  finishReason: "stop",
  responseId: "provider-response-1",
  usage: { inputTokens: 20, outputTokens: 8 },
};

function modelCall(
  status: AgentModelCallRecord["lifecycleStatus"],
): AgentModelCallRecord {
  return {
    id: modelCallId,
    workspaceId,
    agentRunId,
    callNumber: 1,
    purpose: "plan",
    lifecycleStatus: status,
    modelProfileKey: "agent-planner",
    inputDigest: digest,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function modelAttempt(
  status: AgentModelAttemptRecord["lifecycleStatus"],
): AgentModelAttemptRecord {
  return {
    id: attemptId,
    workspaceId,
    agentModelCallId: modelCallId,
    attemptNumber: 1,
    transitionKind: "initial",
    lifecycleStatus: status,
    routeSnapshot: { route: "workspace-default" },
    routeDigest: digest,
    accepted: status === "succeeded",
    createdAt: now,
    startedAt: now,
  };
}

function factsHarness() {
  const beginModelCall = vi.fn<AgentRuntimeRepository["beginModelCall"]>(() =>
    Promise.resolve(modelCall("pending")),
  );
  const startModelAttempt = vi.fn<AgentRuntimeRepository["startModelAttempt"]>(
    () => Promise.resolve(modelAttempt("running")),
  );
  const completeModelAttempt = vi.fn<
    AgentRuntimeRepository["completeModelAttempt"]
  >(() =>
    Promise.resolve({
      call: modelCall("succeeded"),
      attempt: modelAttempt("succeeded"),
    }),
  );
  const unused = () => Promise.reject(new Error("unused"));
  const facts: AgentRuntimeRepository = {
    createThread: unused,
    autoRenameThread: unused,
    renameThread: unused,
    archiveThread: unused,
    listThreads: () => Promise.resolve({ items: [] }),
    getThread: () => Promise.resolve(undefined),
    getThreadMemory: () => Promise.resolve(undefined),
    saveThreadMemory: unused,
    startRun: unused,
    recordSkillUse: unused,
    recordCanvasExport: unused,
    regenerateRun: unused,
    selectThreadBranch: unused,
    getRun: () => Promise.resolve(undefined),
    getRunDiagnostics: () => Promise.resolve(undefined),
    getAssistantMessage: () => Promise.resolve(undefined),
    listThreadMessages: () => Promise.resolve([]),
    listRunMessages: () => Promise.resolve([]),
    getLatestThreadRun: () => Promise.resolve(undefined),
    listThreadActions: () => Promise.resolve([]),
    listThreadInteractions: () => Promise.resolve([]),
    listRunInteractions: () => Promise.resolve([]),
    getInteraction: () => Promise.resolve(undefined),
    getRunModelCallUsage: () =>
      Promise.resolve({
        mainCallCount: 0,
        maximumCallNumber: 0,
        threadTitleCallCount: 0,
      }),
    suspendForInteraction: unused,
    resolveInteraction: unused,
    transitionRun: unused,
    settleRun: unused,
    beginModelCall,
    startModelAttempt,
    completeModelAttempt,
    appendAssistantMessage: unused,
    proposeAction: unused,
    transitionAction: unused,
    completeAction: unused,
    recordActionPreview: unused,
    declinePendingAction: unused,
    getAction: () => Promise.resolve(undefined),
    listRunActions: () => Promise.resolve([]),
  };
  return { facts, beginModelCall, startModelAttempt, completeModelAttempt };
}

function budgetHarness() {
  const reservation = Object.freeze({ id: "reservation-1" });
  const reserve = vi.fn(() => Promise.resolve(reservation));
  const capture = vi.fn(() => Promise.resolve());
  const fail = vi.fn(() => Promise.resolve());
  return {
    budget: { reserve, capture, fail },
    reservation,
    reserve,
    capture,
    fail,
  };
}

describe("createGovernedAgentModelPort", () => {
  it("serializes concurrent model preparation without serializing transport", async () => {
    const coordinator = createAgentModelPreparationCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = coordinator.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = coordinator.run(() => {
      events.push("second:start");
      events.push("second:end");
      return Promise.resolve(2);
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("records a model call and accepted attempt around one transport request", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    const generate = vi.fn(() => Promise.resolve(response));
    const onObservation =
      vi.fn<(observation: AgentModelCallObservation) => void>();
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: {
        resolve: () =>
          Promise.resolve({
            snapshot: { route: "workspace-default" },
            value: { endpoint: "resolved" },
          }),
      },
      transport: { generate, stream: unusedStream },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: () => digest,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_failed",
      }),
      onObservation,
      now: () => now,
    });

    await expect(port.generate(request, undefined)).resolves.toEqual(response);
    expect(harness.beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ modelCallId, callNumber: 1 }),
    );
    expect(harness.startModelAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        routeSnapshot: { route: "workspace-default" },
      }),
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(budgets.reserve).toHaveBeenCalledOnce();
    expect(budgets.capture).toHaveBeenCalledWith(
      expect.objectContaining({ reservation: budgets.reservation, response }),
    );
    expect(budgets.fail).not.toHaveBeenCalled();
    const completion = harness.completeModelAttempt.mock.calls[0]?.[0];
    expect(completion).toMatchObject({
      status: "succeeded",
      providerRequestId: "provider-response-1",
    });
    expect(completion?.usageDocument).toMatchObject({
      inputTokens: 20,
      outputTokens: 8,
    });
    expect(onObservation.mock.calls.map(([item]) => item.event)).toEqual([
      "request_started",
      "succeeded",
    ]);
    expect(onObservation.mock.lastCall?.[0]).toMatchObject({
      agentRunId,
      modelCallId,
      purpose: "plan",
      providerRequestId: "provider-response-1",
      usage: { inputTokens: 20, outputTokens: 8 },
    });
  });

  it("canonicalizes response metadata before computing the output digest", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    const responseWithMetadata: KanvasAgentModelResponse = {
      ...response,
      startedAt: new Date("2026-08-24T09:59:58.000Z"),
      resolvedModelId: "provider-model-1",
      sources: [{ url: "https://example.com/source", title: "Source" }],
    };
    const digestValue = vi.fn((value: unknown) => {
      expect(value).not.toBeInstanceOf(Date);
      if (value && typeof value === "object" && "startedAt" in value) {
        expect(value).toMatchObject({
          startedAt: "2026-08-24T09:59:58.000Z",
          resolvedModelId: "provider-model-1",
          sources: [{ url: "https://example.com/source", title: "Source" }],
        });
      }
      return digest;
    });
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: {
        resolve: () =>
          Promise.resolve({
            snapshot: { route: "workspace-default" },
            value: { endpoint: "resolved" },
          }),
      },
      transport: {
        generate: () => Promise.resolve(responseWithMetadata),
        stream: unusedStream,
      },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: digestValue,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_failed",
      }),
      now: () => now,
    });

    await expect(port.generate(request, undefined)).resolves.toEqual(
      responseWithMetadata,
    );
    expect(harness.completeModelAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outputDigest: digest }),
    );
    expect(digestValue).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful model result when budget settlement needs recovery", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    budgets.capture.mockRejectedValueOnce(new Error("database unavailable"));
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: {
        resolve: () =>
          Promise.resolve({
            snapshot: { route: "workspace-default" },
            value: { endpoint: "resolved" },
          }),
      },
      transport: {
        generate: () => Promise.resolve(response),
        stream: unusedStream,
      },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: () => digest,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_failed",
      }),
      now: () => now,
    });

    await expect(port.generate(request, undefined)).resolves.toEqual(response);
    expect(harness.completeModelAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        providerRequestId: "provider-response-1",
      }),
    );
    expect(
      harness.completeModelAttempt.mock.calls[0]?.[0].usageDocument,
    ).toMatchObject({
      inputTokens: 20,
      outputTokens: 8,
    });
    expect(
      harness.completeModelAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(budgets.capture.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("observes the first meaningful streamed output exactly once", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    const onObservation =
      vi.fn<(observation: AgentModelCallObservation) => void>();
    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text-1" });
        controller.enqueue({
          type: "text-delta",
          id: "text-1",
          delta: "First",
        });
        controller.enqueue({
          type: "text-delta",
          id: "text-1",
          delta: " response",
        });
        controller.enqueue({ type: "text-end", id: "text-1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 20 },
            outputTokens: { total: 2, text: 2 },
            raw: {},
          },
        });
        controller.close();
      },
    });
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: {
        resolve: () =>
          Promise.resolve({
            snapshot: { route: "workspace-default" },
            value: { endpoint: "resolved" },
          }),
      },
      transport: {
        generate: () => Promise.resolve(response),
        stream: () => Promise.resolve({ stream: providerStream }),
      },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: () => digest,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_failed",
      }),
      onObservation,
      now: () => now,
    });

    const result = await port.stream(request, undefined);
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) {
      // Drain the governed stream so completion facts and observations settle.
    }

    expect(onObservation.mock.calls.map(([item]) => item.event)).toEqual([
      "request_started",
      "first_output",
      "succeeded",
    ]);
  });

  it("retries one classified preparation conflict before the Provider request", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    const generate = vi.fn(() => Promise.resolve(response));
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient route conflict"))
      .mockResolvedValue({
        snapshot: { route: "workspace-default" },
        value: { endpoint: "resolved" },
      });
    const onObservation =
      vi.fn<(observation: AgentModelCallObservation) => void>();
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: { resolve },
      transport: { generate, stream: unusedStream },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: () => digest,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_preparation_conflict",
        retryableBeforeProviderRequest: true,
      }),
      onObservation,
      now: () => now,
    });

    await expect(port.generate(request, undefined)).resolves.toEqual(response);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(harness.beginModelCall).toHaveBeenCalledOnce();
    expect(harness.startModelAttempt).toHaveBeenCalledOnce();
    expect(budgets.reserve).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
    expect(onObservation.mock.calls.map(([item]) => item.event)).toEqual([
      "request_started",
      "succeeded",
    ]);
  });

  it("records a stable terminal failure after one preparation retry", async () => {
    const harness = factsHarness();
    const budgets = budgetHarness();
    const generate = vi.fn(() => Promise.resolve(response));
    const resolve = vi.fn(() => Promise.reject(new Error("raw route failure")));
    const port = createGovernedAgentModelPort({
      authority,
      agentRunId,
      modelProfileKey: "agent-planner",
      purpose: "plan",
      facts: harness.facts,
      routes: { resolve },
      transport: { generate, stream: unusedStream },
      budget: budgets.budget,
      identities: {
        modelCallId: () => modelCallId,
        modelAttemptId: () => attemptId,
      },
      digest: () => digest,
      classifyFailure: () => ({
        status: "failed",
        stableReasonCode: "agent.model_route_unavailable",
        retryableBeforeProviderRequest: true,
      }),
      now: () => now,
    });

    await expect(port.generate(request, undefined)).rejects.toEqual(
      new GovernedAgentModelError("agent.model_route_unavailable"),
    );
    expect(generate).not.toHaveBeenCalled();
    expect(budgets.reserve).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(2);
    const attemptStart = harness.startModelAttempt.mock.calls[0]?.[0];
    expect(attemptStart?.routeSnapshot).toMatchObject({
      resolution: "failed",
      routeResolutionAttempts: 2,
    });
    expect(harness.completeModelAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        terminalForCall: true,
        terminalReasonCode: "agent.model_route_unavailable",
      }),
    );
  });
});
