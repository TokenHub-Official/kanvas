import { describe, expect, it, vi } from "vitest";

import {
  authorizationModelVersion,
  createDecideWorkflowApproval,
  DomainError,
  workflowApprovalAuthorizationDecisionId,
  type TrustedWorkspaceScope,
  type WorkflowApprovalDecisionContextRecord,
  type WorkflowApprovalDecisionPort,
  type WorkflowApprovalQueryRepository,
} from "../src/index.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-14T20:00:00.000Z");
const idempotencyKeyDigest = `sha256:${"b".repeat(64)}`;
const approval: WorkflowApprovalDecisionContextRecord = {
  id: id(3),
  workspaceId: id(1),
  workflowRunId: id(2),
  nodeRunId: id(4),
  nodeKey: "approval",
  requestPayload: { title: "Review" },
  decisionSchema: {
    type: "object",
    properties: { approved: { type: "boolean" } },
    required: ["approved"],
  },
  authorizationContextDigest: `sha256:${"a".repeat(64)}`,
  expiresAt: new Date(now.getTime() + 60_000),
  createdAt: new Date(now.getTime() - 60_000),
  lifecycleStatus: "pending",
};
const authority: TrustedWorkspaceScope = {
  workspaceId: id(1),
  organizationId: id(10),
  principalId: id(11),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: id(12),
  authorityType: "human_membership",
  authorityId: id(13),
  authorityVersion: 2,
  authorizationModelVersion,
  effectivePermissions: ["workflow.read", "approval.decide"],
  trusted: true,
};

function harness(overrides?: {
  readonly approval?: WorkflowApprovalDecisionContextRecord | undefined;
  readonly result?: Awaited<ReturnType<WorkflowApprovalDecisionPort["decide"]>>;
}) {
  let nextId = 21;
  const findApprovalDecisionContext = vi.fn(() =>
    Promise.resolve(
      overrides && "approval" in overrides ? overrides.approval : approval,
    ),
  );
  const decide = vi.fn(
    (options: Parameters<WorkflowApprovalDecisionPort["decide"]>[0]) => {
      return Promise.resolve(
        overrides?.result ?? {
          status: "recorded" as const,
          decisionId: options.decisionId,
          workflowRunId: id(2),
        },
      );
    },
  );
  const command = createDecideWorkflowApproval({
    clock: { now: () => now },
    runtimeStateReader: {
      read: () =>
        Promise.resolve({
          state: "ACTIVE" as const,
          executionGeneration: 7,
          stateVersion: 1,
        }),
    },
    ids: {
      next: () => {
        const value = id(nextId);
        nextId += 1;
        return value;
      },
    },
    digest: { of: () => idempotencyKeyDigest },
    queries: {
      findApprovalDecisionContext,
    } satisfies WorkflowApprovalQueryRepository,
    decisions: { decide } satisfies WorkflowApprovalDecisionPort,
  });
  return { command, decide, findApprovalDecisionContext };
}

describe("decide Workflow approval", () => {
  it("passes the exact bounded JSON decision to the pinned orchestrator", async () => {
    const { command, decide } = harness();
    const decision = { approved: false, reason: "Needs changes" };

    await expect(
      command({
        authority,
        workflowRunId: id(2),
        approvalRequestId: id(3),
        decision,
        idempotencyKey: "approval request retry key",
      }),
    ).resolves.toEqual({
      workflowRunId: id(2),
      approvalRequestId: id(3),
      decisionId: id(21),
      result: "recorded",
    });
    expect(decide.mock.calls[0]?.[0]).toMatchObject({
      approvalRequestId: id(3),
      authority,
      decision,
      decisionId: id(21),
      idempotencyKeyDigest,
      executionGeneration: 7,
      authorization: {
        actorPrincipalId: authority.principalId,
        authorizationDecisionId: workflowApprovalAuthorizationDecisionId(
          approval.id,
          idempotencyKeyDigest,
        ),
        authorizedAt: now,
        bindingDigest: approval.authorizationContextDigest,
        permission: "approval.decide",
      },
    });
  });

  it("binds unique authorization decisions to each approval request", () => {
    expect(
      workflowApprovalAuthorizationDecisionId(id(3), idempotencyKeyDigest),
    ).not.toBe(
      workflowApprovalAuthorizationDecisionId(id(4), idempotencyKeyDigest),
    );
  });

  it.each(["", "x".repeat(161)])(
    "rejects an idempotency key outside the public 1-160 character contract",
    async (idempotencyKey) => {
      const { command, findApprovalDecisionContext } = harness();
      await expect(
        command({
          authority,
          workflowRunId: id(2),
          approvalRequestId: id(3),
          decision: { approved: true },
          idempotencyKey,
        }),
      ).rejects.toMatchObject({
        code: "workflow_approval.idempotency_key_invalid",
      });
      expect(findApprovalDecisionContext).not.toHaveBeenCalled();
    },
  );

  it("rejects callers without approval.decide before reading the request", async () => {
    const { command, findApprovalDecisionContext } = harness();

    await expect(
      command({
        authority: { ...authority, effectivePermissions: ["workflow.read"] },
        workflowRunId: id(2),
        approvalRequestId: id(3),
        decision: { approved: true },
        idempotencyKey: id(20),
      }),
    ).rejects.toMatchObject({ code: "workflow_approval.forbidden" });
    expect(findApprovalDecisionContext).not.toHaveBeenCalled();
  });

  it("rejects an approval identity from another Run", async () => {
    const { command, decide } = harness({ approval: undefined });

    await expect(
      command({
        authority,
        workflowRunId: id(99),
        approvalRequestId: id(3),
        decision: { approved: true },
        idempotencyKey: id(20),
      }),
    ).rejects.toMatchObject({ code: "workflow_approval.not_found" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not write an expired decision", async () => {
    const { command, decide } = harness({
      approval: { ...approval, expiresAt: now },
    });

    await expect(
      command({
        authority,
        workflowRunId: id(2),
        approvalRequestId: id(3),
        decision: { approved: true },
        idempotencyKey: id(20),
      }),
    ).rejects.toMatchObject({ code: "workflow_approval.expired" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("maps first-decision-wins conflicts without replacing the decision", async () => {
    const { command } = harness({
      result: {
        status: "conflict",
        existingDecisionId: id(30),
        workflowRunId: id(2),
      },
    });

    await expect(
      command({
        authority,
        workflowRunId: id(2),
        approvalRequestId: id(3),
        decision: { approved: true },
        idempotencyKey: id(20),
      }),
    ).rejects.toMatchObject({ code: "workflow_approval.already_decided" });
  });

  it("propagates pinned-schema rejection from the orchestrator", async () => {
    const { command, decide } = harness();
    decide.mockRejectedValueOnce(
      new DomainError(
        "workflow_approval.decision_invalid",
        "Decision does not match the pinned schema.",
      ),
    );

    await expect(
      command({
        authority,
        workflowRunId: id(2),
        approvalRequestId: id(3),
        decision: { unexpected: true },
        idempotencyKey: id(20),
      }),
    ).rejects.toMatchObject({ code: "workflow_approval.decision_invalid" });
  });
});
