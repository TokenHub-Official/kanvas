import type {
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
  WorkflowRunQueryRepository,
} from "@kanvas/application";
import type { WorkspaceContentQueryStore } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createAgentThreadWorkQueryExecutor,
  findLatestAgentThreadResultArtifact,
  resolveAgentThreadResultArtifact,
} from "../src/agent/thread-agent-query-executor.js";

const now = new Date("2026-08-25T20:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "agent-run:test",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "workflow.read", "asset.read"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

describe("Agent thread work Query executor", () => {
  it("places only the exact original Logo pinned in the selected Brand", async () => {
    const getAsset = vi.fn().mockResolvedValue({
      artifacts: [],
      currentArtifact: {
        id: "logo-image",
        mediaType: "image/png",
        availabilityStatus: "available",
      },
    });
    const options = {
      authority: {
        ...authority,
        effectivePermissions: [...authority.effectivePermissions, "brand.read"],
      },
      threadId: "thread",
      artifactId: "logo-image",
      brandLogoKey: "primary",
      now,
      brand: {
        revisionId: "brand-r1",
        name: "EXAMPLE STUDIO",
        referenceImages: [],
        colors: [],
        logos: [
          {
            key: "primary",
            name: "Logo",
            role: "primary",
            assetId: "logo-asset",
            artifactId: "logo-image",
          },
        ],
      },
      facts: {} as AgentRuntimeRepository,
      content: { getAsset } as unknown as WorkspaceContentQueryStore,
    } as const;
    await expect(
      resolveAgentThreadResultArtifact(options),
    ).resolves.toMatchObject({ id: "logo-image", mediaType: "image/png" });
    expect(getAsset).toHaveBeenCalledWith(options.authority, "logo-asset", {
      artifactId: "logo-image",
    });
    await expect(
      resolveAgentThreadResultArtifact({
        ...options,
        artifactId: "another-image",
      }),
    ).rejects.toMatchObject({ code: "agent.result_not_linked" });
    await expect(
      resolveAgentThreadResultArtifact({ ...options, authority }),
    ).rejects.toMatchObject({ code: "agent.result_not_linked" });
    await expect(
      resolveAgentThreadResultArtifact({ ...options, capabilityRunId: "run" }),
    ).rejects.toMatchObject({ code: "agent.result_not_linked" });
    expect(getAsset).toHaveBeenCalledTimes(1);
  });

  it("resolves Capability images only from a linked unambiguous run", async () => {
    const listCapabilityRunArtifacts = vi.fn().mockResolvedValue([
      {
        id: "image",
        mediaType: "image/png",
        availabilityStatus: "available",
      },
    ]);
    const options = {
      authority,
      threadId: "thread",
      artifactId: "image",
      now,
      facts: {
        listThreadActions: vi.fn().mockResolvedValue([
          {
            outcomeReference: {
              kind: "capability_run",
              capabilityRunId: "cap-run",
            },
          },
        ]),
      } as unknown as AgentRuntimeRepository,
      content: {
        listCapabilityRunArtifacts,
      } as unknown as WorkspaceContentQueryStore,
    };
    await expect(
      resolveAgentThreadResultArtifact({
        ...options,
        capabilityRunId: "cap-run",
      }),
    ).resolves.toMatchObject({ id: "image", mediaType: "image/png" });
    expect(listCapabilityRunArtifacts).toHaveBeenCalledWith(
      authority,
      "cap-run",
    );
    for (const source of [
      { capabilityRunId: "other-run" },
      { capabilityRunId: "cap-run", workflowRunId: "workflow" },
      {},
    ]) {
      await expect(
        resolveAgentThreadResultArtifact({ ...options, ...source }),
      ).rejects.toMatchObject({ code: "agent.result_not_linked" });
    }
    expect(listCapabilityRunArtifacts).toHaveBeenCalledTimes(1);
  });

  it("returns direct Capability image outputs for a follow-up edit", async () => {
    const listCapabilityRunArtifacts = vi.fn().mockResolvedValue([
      {
        id: "image-result",
        mediaType: "image/png",
        availabilityStatus: "available",
      },
    ]);
    const executor = createAgentThreadWorkQueryExecutor({
      authority,
      threadId: "thread",
      facts: {
        listThreadActions: vi.fn().mockResolvedValue([
          {
            lifecycleStatus: "succeeded",
            proposalDocument: {
              title: "文生图",
              contractRevisionId: "contract",
            },
            outcomeReference: {
              kind: "capability_run",
              capabilityRunId: "run",
            },
          },
        ]),
      } as never,
      workflowRuns: {} as never,
      capabilityRuns: {
        get: vi.fn().mockResolvedValue({ lifecycleStatus: "completed" }),
      },
      content: { listCapabilityRunArtifacts } as never,
      includeArtifacts: true,
      now: () => now,
      executeWithReceipt: async (_key, _input, operation) =>
        operation({} as never),
    });
    expect(await executor.inspect!({})).toMatchObject({
      modelOutput: {
        tasks: [
          {
            title: "文生图",
            capabilityRunId: "run",
            lifecycleStatus: "completed",
            results: [{ resourceId: "image-result", kind: "image" }],
          },
        ],
      },
    });
    expect(listCapabilityRunArtifacts).toHaveBeenCalledWith(authority, "run");
  });

  it("returns the original Provider failure to the Agent without replacing its message or request ID", async () => {
    const error = {
      code: "provider.remote_invalid_request",
      upstream: {
        statusCode: 400,
        requestId: "fixture-tokenhub-400",
        body: '{"code":"invalid_request","message":"image is not allowed","data":null}',
      },
    };
    const executor = createAgentThreadWorkQueryExecutor({
      authority,
      threadId: "thread",
      facts: {
        listThreadActions: vi.fn().mockResolvedValue([
          {
            lifecycleStatus: "succeeded",
            proposalDocument: {
              title: "图生图",
              contractRevisionId: "contract",
            },
            outcomeReference: {
              kind: "capability_run",
              capabilityRunId: "run",
            },
          },
        ]),
      } as never,
      workflowRuns: {} as never,
      capabilityRuns: {
        get: vi.fn().mockResolvedValue({ lifecycleStatus: "failed", error }),
      },
      content: {} as never,
      includeArtifacts: false,
      now: () => now,
      executeWithReceipt: async (_key, _input, operation) =>
        operation({} as never),
    });
    expect(await executor.inspect!({})).toMatchObject({
      modelOutput: { tasks: [{ lifecycleStatus: "failed", error }] },
    });
  });

  it("returns current Workflow state and bounded visible result Artifacts", async () => {
    const workflowRunId = "01K00000000000000000000005";
    const listThreadActions = vi.fn(() =>
      Promise.resolve([
        {
          lifecycleStatus: "waiting_approval",
          proposalDocument: {
            title: "待确认制作",
            workflowRevisionId: "01K00000000000000000000017",
          },
        },
        {
          lifecycleStatus: "succeeded",
          proposalDocument: {
            title: "夏季主视觉",
            description: "生成一张方形图片。",
            workflowRevisionId: "01K00000000000000000000017",
          },
          outcomeReference: { kind: "workflow_run", workflowRunId },
        },
      ]),
    );
    const artifacts = Array.from({ length: 10 }, (_, index) => ({
      id: `01K000000000000000000000${String(index + 6).padStart(2, "0")}`,
      artifactType: "image",
      displayFilename: `result-${String(index + 1)}.png`,
      mediaType: "image/png",
      availabilityStatus: "available",
      createdAt: now,
    }));
    const executeWithReceipt = vi.fn(
      async (
        _toolKey: string,
        _input: unknown,
        operation: (action: never) => Promise<unknown>,
      ) => operation({} as never),
    );
    const listWorkflowRunArtifacts = vi.fn(() => Promise.resolve(artifacts));
    const executor = createAgentThreadWorkQueryExecutor({
      authority,
      threadId: "01K00000000000000000000016",
      facts: { listThreadActions } as unknown as AgentRuntimeRepository,
      workflowRuns: {
        findById: () =>
          Promise.resolve({ lifecycleStatus: "completed" } as never),
      } as unknown as WorkflowRunQueryRepository,
      content: {
        listWorkflowRunArtifacts,
      } as unknown as WorkspaceContentQueryStore,
      includeArtifacts: true,
      now: () => now,
      executeWithReceipt: executeWithReceipt as never,
    });

    expect(executor.inspect).toBeDefined();
    const result = await executor.inspect!({});

    expect(result).toMatchObject({
      modelOutput: {
        tasks: [
          { title: "待确认制作", lifecycleStatus: "waiting_approval" },
          {
            title: "夏季主视觉",
            lifecycleStatus: "completed",
            resultsTruncated: true,
            workflowRunId,
          },
        ],
        truncated: false,
      },
      outcomeReference: { kind: "query", resultCount: 2 },
    });
    const output = result.modelOutput as {
      readonly tasks: readonly { readonly results: readonly unknown[] }[];
    };
    expect(output.tasks[1]!.results).toHaveLength(8);
    expect(listThreadActions).toHaveBeenCalledWith(
      authority,
      "01K00000000000000000000016",
      40,
      now,
    );
    expect(executeWithReceipt.mock.calls[0]?.[0]).toBe("thread.inspect-work");

    await expect(
      resolveAgentThreadResultArtifact({
        authority,
        threadId: "01K00000000000000000000016",
        workflowRunId,
        artifactId: artifacts[0]!.id,
        facts: { listThreadActions } as unknown as AgentRuntimeRepository,
        content: {
          listWorkflowRunArtifacts,
        } as unknown as WorkspaceContentQueryStore,
        now,
      }),
    ).resolves.toMatchObject({
      id: artifacts[0]!.id,
      mediaType: "image/png",
    });
    await expect(
      resolveAgentThreadResultArtifact({
        authority,
        threadId: "01K00000000000000000000016",
        workflowRunId: "01K00000000000000000000018",
        artifactId: artifacts[0]!.id,
        facts: { listThreadActions } as unknown as AgentRuntimeRepository,
        content: {
          listWorkflowRunArtifacts,
        } as unknown as WorkspaceContentQueryStore,
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.result_not_linked" });

    await expect(
      findLatestAgentThreadResultArtifact({
        authority,
        threadId: "01K00000000000000000000016",
        facts: { listThreadActions } as unknown as AgentRuntimeRepository,
        content: {
          listWorkflowRunArtifacts,
        } as unknown as WorkspaceContentQueryStore,
        now,
      }),
    ).resolves.toMatchObject({
      id: artifacts.at(-1)!.id,
      mediaType: "image/png",
    });
  });
});
