import type {
  ApplicationRuntime,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { WorkflowRunController } from "../src/http/workflow-run.controller.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";

const workspaceId = "01K00000000000000000000001";
const actorId = "01K00000000000000000000002";
const request = {} as FastifyRequest;
const contexts = new RequestAuthorizationContextStore();
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000003",
  principalId: actorId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: [
    "workflow.read",
    "workflow.run",
    "brand.read",
    "approval.decide",
  ],
  trusted: true,
};
contexts.set(request, {
  authentication: {
    authSubjectId: "01K00000000000000000000006",
    sessionId: "01K00000000000000000000004",
    authenticationStrength: "single_factor",
  },
  scope,
});

describe("WorkflowRunController cancellation adapter", () => {
  it("pins the selected Brand context when starting a Workflow Run", async () => {
    const createRun = vi.fn().mockResolvedValue({
      run: {
        id: "01K000000000000000000000007",
        workspaceId,
        brand: {
          brandKitId: "01K000000000000000000000020",
          brandKitRevisionId: "01K000000000000000000000021",
          name: "Kanvas 主品牌",
          revisionNumber: 3,
        },
        definitionKind: "published_revision",
        workflowRevisionId: "01K000000000000000000000008",
        nonProduction: false,
        lifecycleStatus: "queued",
        outcome: null,
        createdAt: new Date("2026-08-20T05:00:00.000Z"),
      },
      replayed: false,
    });
    const runtime = {
      workflow: { createRun },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);

    await expect(
      controller.create(request, "run-1", {
        workflowRevisionId: "01K000000000000000000000008",
        brandKitRevisionId: "01K000000000000000000000021",
        input: { prompt: "活动海报" },
      }),
    ).resolves.toMatchObject({
      brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
    });
    expect(createRun).toHaveBeenCalledWith({
      workspaceId,
      actorId,
      workflowRevisionId: "01K000000000000000000000008",
      brandKitRevisionId: "01K000000000000000000000021",
      canReadBrand: true,
      idempotencyKey: "run-1",
      input: { prompt: "活动海报" },
    });
  });

  it("lists only recent runs owned by the current principal", async () => {
    const nextCursorDate = new Date("2026-08-20T04:00:00.000Z");
    const listRuns = vi.fn().mockResolvedValue({
      items: [
        {
          id: "01K000000000000000000000007",
          brand: {
            brandKitId: "01K000000000000000000000020",
            brandKitRevisionId: "01K000000000000000000000021",
            name: "Kanvas 主品牌",
            revisionNumber: 3,
          },
          workflowRevisionId: "01K000000000000000000000008",
          displayName: "海报制作",
          lifecycleStatus: "completed",
          outcome: "full_success",
          output: { imageArtifactId: "artifact" },
          createdAt: new Date("2026-08-20T05:00:00.000Z"),
          completedAt: new Date("2026-08-20T05:01:00.000Z"),
        },
      ],
      nextCursor: {
        createdAt: nextCursorDate,
        id: "01K000000000000000000000009",
      },
    });
    const runtime = {
      workflow: { listRuns },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-20T06:00:00.000Z",
        id: "01K00000000000000000000000",
      }),
      "utf8",
    ).toString("base64url");

    const result = await controller.list(request, {
      workflowRevisionId: "01K000000000000000000000008",
      cursor,
      limit: "4",
    });
    expect(result).toMatchObject({
      items: [
        {
          id: "01K000000000000000000000007",
          brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
          displayName: "海报制作",
          lifecycleStatus: "completed",
          createdAt: "2026-08-20T05:00:00.000Z",
        },
      ],
    });
    expect(typeof result.nextCursor).toBe("string");
    expect(listRuns).toHaveBeenCalledWith({
      workspaceId,
      actorId,
      workflowRevisionId: "01K000000000000000000000008",
      state: "all",
      cursor: {
        createdAt: new Date("2026-08-20T06:00:00.000Z"),
        id: "01K00000000000000000000000",
      },
      limit: 4,
    });
  });

  it("delegates cancellation identity and returns the first durable facts", async () => {
    const cancelRun = vi.fn().mockResolvedValue({
      run: {
        id: "01K000000000000000000000003",
        workspaceId,
        lifecycleStatus: "cancelling",
        version: 4,
        cancelRequestedAt: new Date("2026-07-27T12:00:00.000Z"),
        cancelRequestedBy: actorId,
        cancelReasonCode: "policy_denied",
        cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
      },
      replayed: true,
    });
    const runtime = {
      workflow: {
        cancelRun,
      },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);

    await expect(
      controller.cancel(
        request,
        {
          workflowRunId: "01K000000000000000000000003",
        },
        {
          reasonCode: "policy_denied",
        },
      ),
    ).resolves.toEqual({
      id: "01K000000000000000000000003",
      lifecycleStatus: "cancelling",
      version: 4,
      cancelRequestedAt: "2026-07-27T12:00:00.000Z",
      cancelReasonCode: "policy_denied",
      cancelDeadlineAt: "2026-07-27T12:00:30.000Z",
      replayed: true,
    });
    expect(cancelRun).toHaveBeenCalledWith({
      workspaceId,
      actorId,
      workflowRunId: "01K000000000000000000000003",
      reasonCode: "policy_denied",
    });
  });

  it("omits an unspecified reason so the application default owns semantics", async () => {
    const cancelRun = vi.fn().mockResolvedValue({
      run: {
        id: "01K000000000000000000000003",
        workspaceId,
        lifecycleStatus: "cancelled",
        version: 5,
        cancelRequestedAt: new Date("2026-07-27T12:00:00.000Z"),
        cancelRequestedBy: actorId,
        cancelReasonCode: "user_requested",
        cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
      },
      replayed: false,
    });
    const runtime = {
      workflow: {
        cancelRun,
      },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);

    await controller.cancel(
      request,
      {
        workflowRunId: "01K000000000000000000000003",
      },
      {},
    );

    expect(cancelRun).toHaveBeenCalledWith({
      workspaceId,
      actorId,
      workflowRunId: "01K000000000000000000000003",
    });
  });

  it("exposes durable cancellation facts from the workflow query", async () => {
    const getRun = vi.fn().mockResolvedValue({
      id: "01K000000000000000000000003",
      workspaceId,
      workflowRevisionId: "01K000000000000000000000004",
      pendingApprovals: [
        {
          id: "01K000000000000000000000030",
          nodeRunId: "01K000000000000000000000031",
          nodeKey: "review",
          title: "检查结果",
          message: "确认后继续",
          decisionSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
            required: ["approved"],
          },
          expiresAt: new Date("2026-07-27T12:30:00.000Z"),
        },
      ],
      browserExecution: {
        requiredCapabilityKeys: ["image.palette.extract"],
      },
      brand: {
        brandKitId: "01K000000000000000000000020",
        brandKitRevisionId: "01K000000000000000000000021",
        name: "Kanvas 主品牌",
        revisionNumber: 3,
      },
      lifecycleStatus: "cancelled",
      outcome: null,
      version: 5,
      input: {
        source: "artifact",
      },
      output: null,
      nodes: [
        {
          id: "01K00000000000000000000040",
          nodeKey: "generate",
          scopeKey: "root",
          kind: "invoke",
          lifecycleStatus: "failed",
          output: null,
          error: {
            code: "capability.failed",
            capabilityRunId: "01K00000000000000000000041",
            cause: {
              code: "provider.remote_invalid_request",
              upstream: {
                statusCode: 400,
                requestId: "workflow-provider-request-400",
                body: '{"message":"private Workflow prompt"}',
              },
            },
          },
          createdAt: new Date("2026-07-27T11:59:01.000Z"),
          updatedAt: new Date("2026-07-27T12:00:04.000Z"),
          completedAt: new Date("2026-07-27T12:00:04.000Z"),
        },
      ],
      executionDeadlineAt: new Date("2026-07-27T12:59:00.000Z"),
      createdAt: new Date("2026-07-27T11:59:00.000Z"),
      updatedAt: new Date("2026-07-27T12:00:05.000Z"),
      completedAt: new Date("2026-07-27T12:00:05.000Z"),
      cancelRequestedAt: new Date("2026-07-27T12:00:00.000Z"),
      cancelReasonCode: "user_requested",
      cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
    });
    const runtime = {
      workflow: {
        getRun,
      },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);

    const result = await controller.get(request, {
      workflowRunId: "01K000000000000000000000003",
    });
    expect(result).toMatchObject({
      id: "01K000000000000000000000003",
      lifecycleStatus: "cancelled",
      outcome: null,
      version: 5,
      pendingApprovals: [
        {
          id: "01K000000000000000000000030",
          title: "检查结果",
          expiresAt: "2026-07-27T12:30:00.000Z",
        },
      ],
      browserExecution: {
        requiredCapabilityKeys: ["image.palette.extract"],
      },
      brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
      executionDeadlineAt: "2026-07-27T12:59:00.000Z",
      completedAt: "2026-07-27T12:00:05.000Z",
      cancelRequestedAt: "2026-07-27T12:00:00.000Z",
      cancelReasonCode: "user_requested",
      cancelDeadlineAt: "2026-07-27T12:00:30.000Z",
      nodes: [
        {
          error: {
            code: "capability.failed",
            capabilityRunId: "01K00000000000000000000041",
            cause: {
              code: "provider.remote_invalid_request",
              upstream: { requestId: "workflow-provider-request-400" },
            },
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private Workflow prompt");
    expect(getRun).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: "01K000000000000000000000003",
      actorId,
    });
  });

  it("delegates a generic Approval decision without treating rejection as cancellation", async () => {
    const decideApproval = vi.fn().mockResolvedValue({
      workflowRunId: "01K000000000000000000000003",
      approvalRequestId: "01K000000000000000000000030",
      decisionId: "01K000000000000000000000032",
      result: "recorded",
    });
    const runtime = {
      workflow: { decideApproval },
    } as unknown as ApplicationRuntime;
    const controller = new WorkflowRunController(runtime, contexts);

    await expect(
      controller.decideApproval(
        request,
        "01K000000000000000000000032",
        { workflowRunId: "01K000000000000000000000003" },
        {
          approvalRequestId: "01K000000000000000000000030",
          decision: { approved: false },
        },
      ),
    ).resolves.toMatchObject({ result: "recorded" });
    expect(decideApproval).toHaveBeenCalledWith({
      authority: scope,
      workflowRunId: "01K000000000000000000000003",
      approvalRequestId: "01K000000000000000000000030",
      decision: { approved: false },
      idempotencyKey: "01K000000000000000000000032",
    });
  });
});
