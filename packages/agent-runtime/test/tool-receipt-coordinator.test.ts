import type {
  AgentActionReceiptRecord,
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import { createAgentToolReceiptCoordinator } from "../src/tool-receipt-coordinator.js";

const now = new Date("2026-08-24T20:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

function receipt(
  lifecycleStatus: AgentActionReceiptRecord["lifecycleStatus"],
  version: number,
): AgentActionReceiptRecord {
  return {
    id: "01K00000000000000000000005",
    workspaceId: authority.workspaceId,
    agentRunId: "01K00000000000000000000006",
    actionNumber: 1,
    toolCallId: "tool-call-1",
    toolKey: "workflow.propose.entrypoint-1",
    effect: "compute",
    approvalMode: "before_commit",
    lifecycleStatus,
    inputDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    version,
    createdAt: now,
    updatedAt: now,
  };
}

function factsHarness() {
  const proposeAction = vi.fn<AgentRuntimeRepository["proposeAction"]>(() =>
    Promise.resolve(receipt("proposed", 1)),
  );
  const transitionAction = vi.fn<AgentRuntimeRepository["transitionAction"]>(
    (options) =>
      Promise.resolve(receipt(options.toStatus, options.expectedVersion + 1)),
  );
  const completeAction = vi.fn<AgentRuntimeRepository["completeAction"]>(
    (options) =>
      Promise.resolve({
        ...receipt(options.status, options.expectedVersion + 1),
        ...(options.status === "succeeded"
          ? { outputDigest: options.outputDigest }
          : { terminalReasonCode: options.terminalReasonCode }),
      }),
  );
  const recordActionPreview = vi.fn<
    AgentRuntimeRepository["recordActionPreview"]
  >((options) =>
    Promise.resolve({
      ...receipt("waiting_approval", options.expectedVersion + 1),
      outputDigest: options.outputDigest,
      proposalDocument: options.proposalDocument,
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
    beginModelCall: unused,
    startModelAttempt: unused,
    completeModelAttempt: unused,
    appendAssistantMessage: unused,
    proposeAction,
    transitionAction,
    completeAction,
    recordActionPreview,
    declinePendingAction: unused,
    getAction: () => Promise.resolve(undefined),
    listRunActions: () => Promise.resolve([]),
  };
  return {
    facts,
    proposeAction,
    transitionAction,
    completeAction,
    recordActionPreview,
  };
}

describe("createAgentToolReceiptCoordinator", () => {
  it("records a dynamic Tool Call before execution and completes the receipt", async () => {
    const harness = factsHarness();
    const coordinator = createAgentToolReceiptCoordinator({
      authority,
      agentRunId: "01K00000000000000000000006",
      facts: harness.facts,
      descriptors: [
        {
          key: "workflow.propose.entrypoint-1",
          description:
            "Prepare one reviewable action from the current dynamic SkillView.",
          inputSchema: { type: "object" },
          effect: "compute",
          approvalMode: "before-commit",
          executeCanonical: () => Promise.resolve({}),
        },
      ],
      identities: {
        actionReceiptId: () => "01K00000000000000000000005",
      },
      digest: (value) =>
        value && typeof value === "object" && "prepared" in value
          ? "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          : "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      now: () => now,
    });

    const running = await coordinator.inputAvailable({
      toolCallId: "tool-call-1",
      toolKey: "workflow.propose.entrypoint-1",
      input: { brief: "Launch" },
    });
    expect(running).toMatchObject({ lifecycleStatus: "running", version: 2 });
    expect(harness.proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionNumber: 1,
        toolKey: "workflow.propose.entrypoint-1",
        approvalMode: "before_commit",
      }),
    );
    await expect(
      coordinator.complete({
        actionReceiptId: running.id,
        expectedVersion: running.version,
        output: { prepared: true },
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "succeeded", version: 3 });
    expect(harness.completeAction).toHaveBeenCalledOnce();
  });

  it("pauses before a Tool whose current descriptor requires approval", async () => {
    const harness = factsHarness();
    const coordinator = createAgentToolReceiptCoordinator({
      authority,
      agentRunId: "01K00000000000000000000006",
      facts: harness.facts,
      descriptors: [
        {
          key: "workflow.start.entrypoint-1",
          description:
            "Start the approved Workflow Entrypoint through canonical execution.",
          inputSchema: { type: "object" },
          effect: "internal-write",
          approvalMode: "before-call",
          executeCanonical: () => Promise.resolve({}),
        },
      ],
      identities: {
        actionReceiptId: () => "01K00000000000000000000005",
      },
      digest: () =>
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      now: () => now,
    });

    const waiting = await coordinator.inputAvailable({
      toolCallId: "tool-call-1",
      toolKey: "workflow.start.entrypoint-1",
      input: {},
    });
    expect(waiting.lifecycleStatus).toBe("waiting_approval");
    await expect(
      coordinator.approvalGranted({
        actionReceiptId: waiting.id,
        expectedVersion: waiting.version,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "running", version: 3 });
  });

  it("continues ActionReceipt numbering after a durable Run resume", async () => {
    const harness = factsHarness();
    const coordinator = createAgentToolReceiptCoordinator({
      authority,
      agentRunId: "01K00000000000000000000006",
      facts: harness.facts,
      descriptors: [
        {
          key: "canvas.create",
          description: "Create one recoverable Canvas Draft.",
          inputSchema: { type: "object" },
          effect: "internal-write",
          approvalMode: "none",
          executeCanonical: () => Promise.resolve({}),
        },
      ],
      identities: {
        actionReceiptId: () => "01K00000000000000000000005",
      },
      digest: () =>
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      initialActionNumber: 3,
      now: () => now,
    });

    await coordinator.inputAvailable({
      toolCallId: "tool-call-after-resume",
      toolKey: "canvas.create",
      input: {},
    });

    expect(harness.proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionNumber: 3 }),
    );
  });

  it("reuses a running or succeeded receipt without repeating its transition", async () => {
    const harness = factsHarness();
    const coordinator = createAgentToolReceiptCoordinator({
      authority,
      agentRunId: "01K00000000000000000000006",
      facts: harness.facts,
      descriptors: [
        {
          key: "canvas.create",
          description:
            "Create one recoverable Canvas Draft through its canonical command.",
          inputSchema: { type: "object" },
          effect: "internal-write",
          approvalMode: "none",
          executeCanonical: () => Promise.resolve({}),
        },
      ],
      identities: {
        actionReceiptId: () => "01K00000000000000000000005",
      },
      digest: () =>
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      now: () => now,
    });
    for (const status of ["running", "succeeded"] as const) {
      harness.proposeAction.mockResolvedValueOnce(receipt(status, 2));
      await expect(
        coordinator.inputAvailable({
          toolCallId: "tool-call-1",
          toolKey: "canvas.create",
          input: {},
        }),
      ).resolves.toMatchObject({ lifecycleStatus: status, version: 2 });
    }
    expect(harness.transitionAction).not.toHaveBeenCalled();
  });

  it("rejects Tool Calls outside the current ToolView", async () => {
    const harness = factsHarness();
    const coordinator = createAgentToolReceiptCoordinator({
      authority,
      agentRunId: "01K00000000000000000000006",
      facts: harness.facts,
      descriptors: [],
      identities: {
        actionReceiptId: () => "01K00000000000000000000005",
      },
      digest: () =>
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await expect(
      coordinator.inputAvailable({
        toolCallId: "tool-call-unknown",
        toolKey: "workflow.start.unknown",
        input: {},
      }),
    ).rejects.toThrow("outside the current ToolView");
    expect(harness.proposeAction).not.toHaveBeenCalled();
  });
});
