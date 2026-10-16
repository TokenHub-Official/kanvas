import type {
  ApplicationRuntime,
  AgentRunRecord,
  AgentRuntimeRepository,
  AgentSurfaceView,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type { DatabaseRuntime } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  agentRunFailureKind,
  agentThreadInitialTitle,
  WorkspaceAgentService,
} from "../src/agent/workspace-agent.service.js";
import type { CapabilityRunService } from "../src/capabilities/capability-run.service.js";
import type { SkillLibraryService } from "../src/skills/skill-library.service.js";

function workspaceAgentService(
  database: DatabaseRuntime,
  runtime: ApplicationRuntime,
): WorkspaceAgentService {
  return new WorkspaceAgentService(
    database,
    runtime,
    {} as CapabilityRunService,
  );
}

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
  effectivePermissions: [
    "agent.run",
    "asset.read",
    "brand.read",
    "workflow.read",
    "canvas.read",
    "canvas.write",
  ],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

const surfaceView = {
  profile: {
    id: "01K00000000000000000000005",
    workspaceId: authority.workspaceId,
    agentDefinitionId: "01K0000000000000000000000M",
    profileKey: "workspace-profile",
    revision: 3,
    canonicalDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manifest: {
      schemaVersion: 1,
      displayName: "Workspace Profile",
      modelBindingKey: "workspace-agent-model",
      instructions: "Use only runtime-resolved Skills and Tools.",
      allowedSurfaceKinds: ["agent_workspace"],
      allowedToolFamilies: ["canvas_command", "workflow"],
      requiredToolFamilies: ["canvas_command", "workflow"],
      skillPolicy: {
        maximumCatalogItems: 20,
        maximumActivatedInstructionBytes: 262_144,
        maximumReferenceReadBytes: 262_144,
      },
      runLimits: {
        maximumModelCalls: 6,
        maximumToolCalls: 4,
        timeoutSeconds: 180,
      },
    },
  },
  skills: [],
  boundBrands: [],
  boundWorkflows: [],
  skillViewDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} as const satisfies AgentSurfaceView;

describe("WorkspaceAgentService", () => {
  it("projects a pinned Brand for an Operator without reading its managed Draft", async () => {
    const threadId = "01K0000000000000000000000A";
    const runId = "01K0000000000000000000000B";
    const messageId = "01K0000000000000000000000C";
    const brandKitId = "01K0000000000000000000000D";
    const brandKitRevisionId = "01K0000000000000000000000E";
    const getDraft = vi
      .fn()
      .mockRejectedValue(new Error("brand.manage required"));
    const getRevision = vi.fn().mockResolvedValue({
      id: brandKitRevisionId,
      brandKitId,
      document: {
        schemaVersion: 1,
        name: "Pinned Brand",
        colors: [],
        logos: [],
        referenceImages: [],
        textStyles: [],
        guidelines: { principles: [], avoid: [] },
      },
    });
    let snapshotReads = 0;
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: threadId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active",
              version: 1,
              viewRevision: snapshotReads++ === 0 ? 1 : 2,
              createdAt: now,
              updatedAt: now,
            }),
          getLatestThreadRun: () =>
            Promise.resolve({
              id: runId,
              lifecycleStatus: "succeeded",
              contextSnapshot: { brandKitRevisionId },
              updatedAt: now,
            }),
          listThreadMessages: () =>
            Promise.resolve([
              {
                id: messageId,
                agentRunId: runId,
                createdAt: now,
                message: {
                  schemaVersion: 1,
                  role: "user",
                  parts: [{ type: "text", text: "Use this Brand." }],
                  referencedResources: [
                    {
                      kind: "brand_kit_draft",
                      resourceId: brandKitId,
                      brandKitRevisionId,
                      displayName: "Pinned Brand",
                    },
                  ],
                },
              },
            ]),
          listThreadActions: () => Promise.resolve([]),
          listThreadInteractions: () => Promise.resolve([]),
        },
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: true }),
        },
        workspaceBrand: {
          getDraft,
          getRevision,
          list: () => Promise.resolve([]),
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.getThread({ authority, threadId, now }),
    ).resolves.toMatchObject({
      viewRevision: 2,
      brandContext: {
        brandKitId,
        brandKitRevisionId,
        name: "Pinned Brand",
      },
      relatedContent: [
        {
          kind: "brand",
          resourceId: brandKitId,
          brandKitRevisionId,
          state: "available",
        },
      ],
    });
    expect(getDraft).not.toHaveBeenCalled();
    expect(getRevision).toHaveBeenCalledWith(
      authority,
      brandKitId,
      brandKitRevisionId,
      now,
    );
  });

  it("forwards browser execution ownership from active Capability and Workflow tasks", async () => {
    const threadId = "01K0000000000000000000000A";
    const runId = "01K0000000000000000000000B";
    const capabilityRunId = "01K0000000000000000000000C";
    const workflowRunId = "01K0000000000000000000000D";
    const requiredCapabilityKeys = ["browser.image.palette.extract"];
    const taskAuthority: TrustedWorkspaceScope = {
      ...authority,
      effectivePermissions: ["agent.run", "capability.run", "workflow.read"],
    };
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: threadId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active",
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          getLatestThreadRun: () =>
            Promise.resolve({
              id: runId,
              lifecycleStatus: "succeeded",
              contextSnapshot: {},
              updatedAt: now,
            }),
          listThreadMessages: () => Promise.resolve([]),
          listThreadActions: () =>
            Promise.resolve([
              {
                id: "01K0000000000000000000000E",
                agentRunId: runId,
                lifecycleStatus: "succeeded",
                proposalDocument: {
                  schemaVersion: 1,
                  contractRevisionId: "01K0000000000000000000000F",
                  title: "Extract palette",
                  input: { source: "artifact" },
                },
                outcomeReference: {
                  kind: "capability_run",
                  capabilityRunId,
                },
              },
              {
                id: "01K0000000000000000000000G",
                agentRunId: runId,
                lifecycleStatus: "succeeded",
                proposalDocument: {
                  schemaVersion: 1,
                  workflowRevisionId: "01K0000000000000000000000H",
                  title: "Browser workflow",
                  input: { source: "artifact" },
                },
                outcomeReference: {
                  kind: "workflow_run",
                  workflowRunId,
                },
              },
            ]),
          listThreadInteractions: () => Promise.resolve([]),
        },
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: true }),
        },
        capabilityRuns: {
          get: () =>
            Promise.resolve({
              id: capabilityRunId,
              lifecycleStatus: "queued",
              browserExecution: { requiredCapabilityKeys },
            }),
        },
      } as unknown as DatabaseRuntime,
      {
        workflow: {
          getRun: () =>
            Promise.resolve({
              id: workflowRunId,
              lifecycleStatus: "running",
              browserExecution: { requiredCapabilityKeys },
            }),
        },
      } as unknown as ApplicationRuntime,
    );

    await expect(
      service.getThread({ authority: taskAuthority, threadId, now }),
    ).resolves.toMatchObject({
      tasks: [
        {
          capabilityRunId,
          lifecycleStatus: "running",
          browserExecution: { requiredCapabilityKeys },
        },
        {
          workflowRunId,
          lifecycleStatus: "running",
          browserExecution: { requiredCapabilityKeys },
        },
      ],
    });
  });

  it("uses the current localized Capability presentation while retaining the stored proposal as fallback", async () => {
    const threadId = "01K0000000000000000000000A";
    const runId = "01K0000000000000000000000B";
    const contractRevisionId = "01K0000000000000000000000C";
    const proposalDocument = Object.freeze({
      schemaVersion: 1,
      contractRevisionId,
      title: "Image edit · Model service",
      description: "Provides Image edit through Model service.",
      input: Object.freeze({ sourceArtifactId: "artifact" }),
    });
    const resolveAgentCatalogPresentations = vi.fn().mockResolvedValue([
      {
        contractRevisionId,
        declaration: {
          catalog: {
            title: { "zh-CN": "图生图", "en-US": "Image to image" },
          },
        },
      },
    ]);
    const taskAuthority: TrustedWorkspaceScope = {
      ...authority,
      effectivePermissions: ["agent.run", "capability.run"],
    };
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: threadId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active",
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          getLatestThreadRun: () =>
            Promise.resolve({
              id: runId,
              lifecycleStatus: "waiting_approval",
              contextSnapshot: {},
              updatedAt: now,
            }),
          listThreadMessages: () => Promise.resolve([]),
          listThreadActions: () =>
            Promise.resolve([
              {
                id: "01K0000000000000000000000D",
                agentRunId: runId,
                lifecycleStatus: "waiting_approval",
                proposalDocument,
              },
            ]),
          listThreadInteractions: () => Promise.resolve([]),
        },
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: true }),
        },
        capabilityDefinitions: { resolveAgentCatalogPresentations },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    const chineseView = await service.getThread({
      authority: taskAuthority,
      threadId,
      locale: "zh-CN",
      now,
    });
    expect(chineseView).toMatchObject({
      relatedContent: [
        {
          kind: "capability",
          resourceId: contractRevisionId,
          title: "图生图",
        },
      ],
      tasks: [
        {
          kind: "capability",
          capabilityContractRevisionId: contractRevisionId,
          title: "图生图",
        },
      ],
    });
    expect(chineseView.relatedContent[0]).not.toHaveProperty("description");
    expect(chineseView.tasks[0]).not.toHaveProperty("description");
    await expect(
      service.getThread({
        authority: taskAuthority,
        threadId,
        locale: "en-US",
        now,
      }),
    ).resolves.toMatchObject({
      relatedContent: [
        {
          title: "Image to image",
        },
      ],
      tasks: [
        {
          title: "Image to image",
        },
      ],
    });

    resolveAgentCatalogPresentations.mockResolvedValueOnce([]);
    await expect(
      service.getThread({
        authority: taskAuthority,
        threadId,
        locale: "zh-CN",
        now,
      }),
    ).resolves.toMatchObject({
      relatedContent: [
        {
          title: "Image edit · Model service",
          description: "Provides Image edit through Model service.",
        },
      ],
      tasks: [
        {
          title: "Image edit · Model service",
          description: "Provides Image edit through Model service.",
        },
      ],
    });
    resolveAgentCatalogPresentations.mockRejectedValueOnce(
      new Error("catalog read interrupted"),
    );
    const degradedView = await service.getThread({
      authority: taskAuthority,
      threadId,
      locale: "zh-CN",
      now,
    });
    expect(degradedView.relatedContent[0]?.title).toBe(
      "Image edit · Model service",
    );
    expect(degradedView.tasks[0]?.title).toBe("Image edit · Model service");
    expect(proposalDocument).toEqual({
      schemaVersion: 1,
      contractRevisionId,
      title: "Image edit · Model service",
      description: "Provides Image edit through Model service.",
      input: { sourceArtifactId: "artifact" },
    });
    expect(resolveAgentCatalogPresentations).toHaveBeenNthCalledWith(
      1,
      taskAuthority,
      [contractRevisionId],
      now,
    );
  });

  it("keeps message attachments pinned while excluding tasks from an unselected response", async () => {
    const threadId = "01K0000000000000000000000A";
    const runId = "01K0000000000000000000000B";
    const assetId = "01K0000000000000000000000C";
    const oldArtifactId = "01K0000000000000000000000D";
    const currentArtifactId = "01K0000000000000000000000E";
    const artifacts = [oldArtifactId, currentArtifactId].map((id) => ({
      id,
      availabilityStatus: "available",
      mediaType: "image/png",
      displayFilename: `${id}.png`,
    }));
    const getAsset = vi.fn(() =>
      Promise.resolve({
        id: assetId,
        name: "Current name",
        version: 2,
        currentArtifact: artifacts[1],
        artifacts,
      }),
    );
    const getWorkflow = vi.fn();
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: threadId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active",
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          getLatestThreadRun: () =>
            Promise.resolve({
              id: runId,
              lifecycleStatus: "succeeded",
              contextSnapshot: {},
              updatedAt: now,
            }),
          listThreadMessages: () =>
            Promise.resolve(
              [oldArtifactId, currentArtifactId].map((artifactId, index) => ({
                id:
                  index === 0
                    ? "01K0000000000000000000000F"
                    : "01K0000000000000000000000G",
                agentRunId: runId,
                createdAt: now,
                message: {
                  schemaVersion: 1,
                  role: "user",
                  parts: [{ type: "text", text: "Use this picture" }],
                  referencedResources: [
                    {
                      kind: "asset",
                      resourceId: assetId,
                      artifactId,
                      version: index + 1,
                      displayName:
                        index === 0 ? "Original name" : "Current name",
                    },
                  ],
                },
              })),
            ),
          listThreadActions: () =>
            Promise.resolve([
              {
                id: "01K0000000000000000000000H",
                agentRunId: "01K0000000000000000000000J",
                lifecycleStatus: "succeeded",
                toolKey: "workflow.propose.hidden",
                proposalDocument: {
                  workflowRevisionId: "01K0000000000000000000000K",
                  title: "Hidden branch",
                },
                outcomeReference: {
                  kind: "workflow_run",
                  workflowRunId: "01K0000000000000000000000M",
                },
              },
            ]),
          listThreadInteractions: () => Promise.resolve([]),
        },
        workspaceContentQueries: { getAsset },
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: true }),
        },
      } as unknown as DatabaseRuntime,
      { workflow: { getRun: getWorkflow } } as unknown as ApplicationRuntime,
    );
    const view = await service.getThread({ authority, threadId, now });
    expect(view.messages[0]?.relatedContent[0]).toMatchObject({
      artifactId: oldArtifactId,
      title: "Original name",
      version: 1,
    });
    expect(view.messages[1]?.relatedContent[0]).toMatchObject({
      artifactId: currentArtifactId,
      title: "Current name",
      version: 2,
    });
    expect(view.relatedContent[0]).toMatchObject({
      artifactId: currentArtifactId,
    });
    expect(view.tasks).toEqual([]);
    expect(getWorkflow).not.toHaveBeenCalled();
    expect(getAsset).toHaveBeenCalledWith(authority, assetId, {
      artifactId: oldArtifactId,
    });
  });

  it("accepts only a committed PNG from the requested Canvas snapshot", async () => {
    const request = {
      canvasDraftId: "01K0000000000000000000000A",
      documentVersion: 4,
      pageId: "page-1",
    };
    const recordCanvasExport = vi.fn().mockResolvedValue({});
    const getExport = vi.fn().mockResolvedValue({
      state: "committed",
      exportSessionId: "01K0000000000000000000000B",
      sourceRequest: {
        ...request,
        format: "png",
        displayFilename: "poster.png",
      },
      result: { artifactId: "01K0000000000000000000000C" },
    });
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getAction: vi.fn().mockResolvedValue({
            id: "01K0000000000000000000000D",
            agentRunId: "01K0000000000000000000000E",
            toolKey: "canvas.export-png",
            version: 3,
            proposalDocument: { kind: "canvas_export", request },
          }),
          recordCanvasExport,
        },
        canvasExports: { get: getExport },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );
    const options = {
      authority,
      actionReceiptId: "01K0000000000000000000000D",
      body: { exportSessionId: "01K0000000000000000000000B" },
      now,
    };
    await expect(service.completeCanvasExport(options)).resolves.toEqual({
      accepted: true,
    });
    expect(recordCanvasExport).toHaveBeenCalledWith(
      expect.objectContaining({
        request,
        completion: {
          status: "succeeded",
          exportSessionId: "01K0000000000000000000000B",
          artifactId: "01K0000000000000000000000C",
          filename: "poster.png",
        },
      }),
    );
    getExport.mockResolvedValueOnce({
      state: "committed",
      sourceRequest: { ...request, documentVersion: 5, format: "png" },
      result: { artifactId: "other" },
    });
    await expect(service.completeCanvasExport(options)).rejects.toMatchObject({
      code: "agent.canvas_export_mismatch",
    });
    expect(recordCanvasExport).toHaveBeenCalledTimes(1);
    await service.completeCanvasExport({
      ...options,
      body: {
        error: { code: "upload_failed", message: "Storage rejected upload" },
      },
    });
    expect(recordCanvasExport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        completion: {
          status: "failed",
          code: "upload_failed",
          message: "Storage rejected upload",
        },
      }),
    );
  });

  it("projects stable run failures into user-facing recovery kinds", () => {
    expect(agentRunFailureKind("agent.tool_view_changed")).toBe(
      "tools_changed",
    );
    expect(agentRunFailureKind("agent.limit_exceeded")).toBe("limit");
    expect(agentRunFailureKind("agent.output_limit_exceeded")).toBe("limit");
    expect(agentRunFailureKind("agent.model_budget_settlement_failed")).toBe(
      "model_setup",
    );
    expect(agentRunFailureKind("agent.model_web_search_unsupported")).toBe(
      "model_setup",
    );
    expect(agentRunFailureKind("agent.model_budget_failed")).toBe("budget");
    expect(agentRunFailureKind("agent.authorization_revoked")).toBe(
      "access_changed",
    );
    expect(agentRunFailureKind("agent.model_provider_transport_failed")).toBe(
      "runtime",
    );
  });

  it("creates a concise deterministic title from the first user message", () => {
    const cases = [
      ["我需要一张万豪酒店夏日营销海报", "万豪酒店夏日营销海报"],
      [
        "为万豪酒店策划一张夏日营销海报，给我一个标题。",
        "万豪酒店夏日营销海报",
      ],
      [
        "用这个品牌做一张「夏日会员礼遇」方形社媒海报，成品图和画板都要。",
        "「夏日会员礼遇」方形社媒海报",
      ],
      [
        "就用这个 Kanvas 活动品牌，帮我做一张万豪酒店官方夏日促销海报，品牌感要准确。",
        "万豪酒店官方夏日促销海报",
      ],
      [
        "帮我做张高端酒店的夏日活动海报，后面我自己还要改。",
        "高端酒店的夏日活动海报",
      ],
      ["介绍秋季精品咖啡，不要调用工具或创建制作任务。", "介绍秋季精品咖啡"],
    ] as const;
    for (const [message, title] of cases) {
      expect(agentThreadInitialTitle(message)).toBe(title);
    }
    expect(
      [
        ...agentThreadInitialTitle(
          "这是一条用于验证超长会话名称不会占满整个会话栏的用户消息，需要在创建时自动收敛为简短标题",
        ),
      ].length,
    ).toBeLessThanOrEqual(48);
  });

  it("validates and resolves a pending Agent question through the runtime seam", async () => {
    const interactionId = "01K0000000000000000000000A";
    const runId = "01K0000000000000000000000B";
    const interaction = {
      id: interactionId,
      workspaceId: authority.workspaceId,
      threadId: "01K0000000000000000000000C",
      agentRunId: runId,
      assistantMessageId: "01K0000000000000000000000D",
      interactionNumber: 1,
      toolCallId: "provider-question-1",
      toolKey: "builtin.ask-question" as const,
      lifecycleStatus: "pending" as const,
      request: {
        schemaVersion: 1 as const,
        kind: "question" as const,
        questions: [
          {
            key: "format",
            header: "Output",
            question: "Which result should be prepared?",
            options: [
              { key: "outline", label: "Outline" },
              { key: "draft", label: "Full draft" },
            ],
          },
        ],
      },
      checkpoint: {
        schemaVersion: 1 as const,
        adapter: "mastra-message-list-v2" as const,
        toolCallId: "provider-question-1",
        toolName: "ask_question" as const,
        toolCallCount: 1,
        continuationMessages: [{}],
      },
      requestDigest: `sha256:${"a".repeat(64)}`,
      checkpointDigest: `sha256:${"b".repeat(64)}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const resolveInteraction = vi.fn(() =>
      Promise.resolve({
        interaction: {
          ...interaction,
          lifecycleStatus: "submitted" as const,
          response: {
            schemaVersion: 1 as const,
            outcome: "submitted" as const,
            answers: [{ questionKey: "format", optionKeys: ["outline"] }],
          },
          version: 2,
        },
        run: {
          id: runId,
          lifecycleStatus: "queued" as const,
        },
        replayed: false,
      }),
    );
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getInteraction: () => Promise.resolve(interaction),
          resolveInteraction,
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.resolveInteraction({
        authority,
        interactionId,
        body: {
          expectedVersion: 1,
          outcome: "submitted",
          answers: [{ questionKey: "format", optionKeys: ["outline"] }],
        },
        idempotencyKey: "question-response-1",
        now,
      }),
    ).resolves.toEqual({
      interactionId,
      lifecycleStatus: "submitted",
      runId,
      runLifecycleStatus: "queued",
    });
    expect(resolveInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        resolutionRequestKey: "question-response-1",
        response: {
          schemaVersion: 1,
          outcome: "submitted",
          answers: [{ questionKey: "format", optionKeys: ["outline"] }],
        },
      }),
    );

    await expect(
      service.resolveInteraction({
        authority,
        interactionId,
        body: { expectedVersion: 1, outcome: "submitted", answers: [] },
        idempotencyKey: "question-response-invalid",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.interaction_invalid" });

    const projectionService = workspaceAgentService(
      {
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: interaction.threadId,
              workspaceId: authority.workspaceId,
              createdByPrincipalId: authority.principalId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active" as const,
              titleSource: "auto" as const,
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          listThreadMessages: () =>
            Promise.resolve([
              {
                id: interaction.assistantMessageId,
                workspaceId: authority.workspaceId,
                threadId: interaction.threadId,
                agentRunId: runId,
                sequenceNumber: 2,
                alternativeIndex: 1,
                alternativeCount: 1,
                message: {
                  schemaVersion: 1 as const,
                  role: "assistant" as const,
                  parts: [
                    {
                      type: "tool-call" as const,
                      toolCallId: interaction.toolCallId,
                      toolName: "ask_question",
                    },
                  ],
                },
                createdAt: now,
              },
            ]),
          getLatestThreadRun: () => Promise.resolve(undefined),
          listThreadActions: () => Promise.resolve([]),
          listThreadInteractions: () => Promise.resolve([interaction]),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: true }),
        },
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(undefined),
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );
    const projected = await projectionService.getThread({
      authority,
      threadId: interaction.threadId,
      now,
    });
    expect(projected.messages[0]).toMatchObject({
      id: interaction.assistantMessageId,
      parts: [],
      interactions: [
        {
          id: interactionId,
          kind: "question",
          lifecycleStatus: "pending",
          questions: interaction.request.questions,
        },
      ],
    });
    expect(JSON.stringify(projected.messages[0]?.interactions)).not.toContain(
      "checkpoint",
    );
    expect(JSON.stringify(projected.messages[0]?.interactions)).not.toContain(
      interaction.toolCallId,
    );
  });

  it("cancels the active run through the fenced dispatch store", async () => {
    const cancel = vi.fn(() =>
      Promise.resolve({
        id: "01K00000000000000000000009",
        lifecycleStatus: "cancelled" as const,
      }),
    );
    const service = workspaceAgentService(
      {
        agentRunDispatch: { cancel },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.cancelRun({
        authority,
        agentRunId: "01K00000000000000000000009",
        now,
      }),
    ).resolves.toEqual({
      runId: "01K00000000000000000000009",
      lifecycleStatus: "cancelled",
    });
    expect(cancel).toHaveBeenCalledWith({
      authority,
      agentRunId: "01K00000000000000000000009",
      now,
    });
  });

  it("creates an immutable alternative Run for one assistant message", async () => {
    const regenerateRun = vi.fn<AgentRuntimeRepository["regenerateRun"]>(() =>
      Promise.resolve({
        id: "01K0000000000000000000000A",
        workspaceId: authority.workspaceId,
        threadId: "01K00000000000000000000009",
        actorPrincipalId: authority.principalId,
        lifecycleStatus: "queued" as const,
      } as AgentRunRecord),
    );
    const autoRenameThread = vi.fn();
    const service = workspaceAgentService(
      {
        agentRuntime: { regenerateRun, autoRenameThread },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.regenerate({
        authority,
        threadId: "01K00000000000000000000009",
        body: { assistantMessageId: "01K00000000000000000000008" },
        idempotencyKey: "agent-regenerate-test-1",
        now,
      }),
    ).resolves.toEqual({
      threadId: "01K00000000000000000000009",
      runId: "01K0000000000000000000000A",
      lifecycleStatus: "queued",
    });
    expect(regenerateRun.mock.calls[0]?.[0]).toMatchObject({
      threadId: "01K00000000000000000000009",
      sourceAssistantMessageId: "01K00000000000000000000008",
      idempotencyKey: "agent-regenerate-test-1",
    });
    expect(autoRenameThread).not.toHaveBeenCalled();
  });

  it("retries a failed Run that produced no assistant message", async () => {
    const regenerateRun = vi.fn<AgentRuntimeRepository["regenerateRun"]>(() =>
      Promise.resolve({
        id: "01K0000000000000000000000A",
        workspaceId: authority.workspaceId,
        threadId: "01K00000000000000000000009",
        actorPrincipalId: authority.principalId,
        lifecycleStatus: "queued" as const,
      } as AgentRunRecord),
    );
    const service = workspaceAgentService(
      { agentRuntime: { regenerateRun } } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await service.regenerate({
      authority,
      threadId: "01K00000000000000000000009",
      body: { agentRunId: "01K00000000000000000000007" },
      idempotencyKey: "agent-retry-run-test-1",
      now,
    });

    expect(regenerateRun.mock.calls[0]?.[0]).toMatchObject({
      sourceRunId: "01K00000000000000000000007",
      threadId: "01K00000000000000000000009",
    });
  });

  it("switches the active response branch without rewriting messages", async () => {
    const selectThreadBranch = vi.fn(() =>
      Promise.resolve({
        id: "01K00000000000000000000009",
        workspaceId: authority.workspaceId,
        createdByPrincipalId: authority.principalId,
        lifecycleStatus: "active" as const,
        title: "Campaign",
        version: 3,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const service = workspaceAgentService(
      {
        agentRuntime: { selectThreadBranch },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.selectBranch({
        authority,
        threadId: "01K00000000000000000000009",
        body: {
          assistantMessageId: "01K00000000000000000000008",
          expectedVersion: 2,
        },
        now,
      }),
    ).resolves.toMatchObject({ id: "01K00000000000000000000009", version: 3 });
    expect(selectThreadBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: "01K00000000000000000000008",
        expectedVersion: 2,
      }),
    );
  });

  it("rejects an unavailable required Tool Family before creating Thread facts", async () => {
    const createThread = vi.fn();
    const unavailableView = {
      ...surfaceView,
      profile: {
        ...surfaceView.profile,
        manifest: {
          ...surfaceView.profile.manifest,
          allowedToolFamilies: ["brand_command"],
          requiredToolFamilies: ["brand_command"],
        },
      },
    } as const satisfies AgentSurfaceView;
    const service = workspaceAgentService(
      {
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(unavailableView),
        },
        agentRuntime: { createThread } as unknown as AgentRuntimeRepository,
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.create({
        authority: { ...authority, effectivePermissions: ["agent.run"] },
        body: { message: "Help with the current workspace." },
        idempotencyKey: "agent-unavailable-1",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.profile_unavailable" });
    expect(createThread).not.toHaveBeenCalled();
  });

  it("pins the current Profile and enqueues a real asynchronous Run", async () => {
    const brandArtifactIds = Array.from(
      { length: 24 },
      (_, index) => `01K${String(1000 + index).padStart(23, "0")}`,
    );
    const createThread = vi.fn<AgentRuntimeRepository["createThread"]>(
      (options) =>
        Promise.resolve({
          id: options.threadId,
          workspaceId: authority.workspaceId,
          createdByPrincipalId: authority.principalId,
          agentDefinitionId: options.agentDefinitionId,
          agentProfileRevisionId: options.agentProfileRevisionId,
          lifecycleStatus: "active",
          title: options.title ?? "Untitled",
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
    );
    const startRun = vi.fn<AgentRuntimeRepository["startRun"]>((options) =>
      Promise.resolve({
        id: options.runId,
        workspaceId: authority.workspaceId,
        threadId: options.threadId,
        actorPrincipalId: authority.principalId,
        lifecycleStatus: "queued",
        contextSnapshot: options.contextSnapshot,
        toolViewDigest: options.toolViewDigest,
        promptRevision: options.promptRevision,
        maximumModelCalls: options.maximumModelCalls,
        maximumToolCalls: options.maximumToolCalls,
        foundationContext: options.foundationContext,
        version: 1,
        executionDeadlineAt: options.executionDeadlineAt,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const getAgentAttachmentArtifact = vi.fn<
      DatabaseRuntime["workspaceContentQueries"]["getAgentAttachmentArtifact"]
    >((_scope, artifactId) =>
      Promise.resolve({
        id: artifactId,
        artifactType: "image.generated",
        displayFilename: "candidate.png",
        mediaType: "image/png",
        availabilityStatus: "available",
        createdAt: now,
      }),
    );
    const service = workspaceAgentService(
      {
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        agentRuntime: {
          createThread,
          startRun,
          getThread: () =>
            createThread.mock.results[0]!.value as ReturnType<
              AgentRuntimeRepository["getThread"]
            >,
          listThreadActions: () => Promise.resolve([]),
          listThreadMessages: () => Promise.resolve([]),
          getLatestThreadRun: () =>
            Promise.resolve({
              contextSnapshot: startRun.mock.calls.at(-1)![0].contextSnapshot,
            }),
        } as unknown as AgentRuntimeRepository,
        workspaceBrand: {
          getRevision: () =>
            Promise.resolve({
              id: "01K0000000000000000000000B",
              brandKitId: "01K0000000000000000000000A",
              workspaceId: authority.workspaceId,
              revisionNumber: 1,
              document: {
                schemaVersion: 1,
                name: "Kanvas Main",
                colors: [
                  {
                    key: "primary",
                    name: "Primary blue",
                    role: "primary",
                    value: "#3348FF",
                    position: 0,
                  },
                ],
                logos: [
                  {
                    key: "main",
                    name: "Main logo",
                    role: "primary",
                    assetId: "01K0000000000000000000000C",
                    artifactId: "01K0000000000000000000000D",
                    position: 0,
                  },
                ],
                referenceImages: brandArtifactIds.map((artifactId, index) => ({
                  key: `campaign-${index}`,
                  name: "Campaign reference",
                  description: "Natural light",
                  assetId: `01K${String(2000 + index).padStart(23, "0")}`,
                  artifactId,
                  position: index,
                })),
                textStyles: [],
                guidelines: { principles: [], avoid: [] },
              },
              contentDigest:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              publishedByPrincipalId: authority.principalId,
              publishedAt: now,
            }),
        },
        workspaceContentQueries: {
          getAgentAttachmentArtifact,
          getAsset: () =>
            Promise.resolve({
              id: "01K0000000000000000000000E",
              name: "Campaign source",
              assetType: "image.source",
              lifecycleStatus: "active" as const,
              version: 2,
              currentArtifact: {
                id: "01K0000000000000000000000F",
                artifactType: "image.source",
                displayFilename: "campaign.png",
                mediaType: "image/png",
                availabilityStatus: "available",
                dataClassification: "internal",
                isCurrent: true,
                origin: { kind: "user_import" as const },
                createdAt: now,
              },
              artifacts: [],
              artifactsTruncated: false,
              lineage: [],
              lineageTruncated: false,
              usedByBrands: [],
              createdAt: now,
              updatedAt: now,
            }),
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.create({
        authority,
        body: {
          message: "Prepare a campaign visual.",
          brandContext: {
            brandKitId: "01K0000000000000000000000A",
            brandKitRevisionId: "01K0000000000000000000000B",
          },
          attachments: [
            {
              artifactId: "01K0000000000000000000000N",
            },
            {
              assetId: "01K0000000000000000000000E",
              artifactId: "01K0000000000000000000000F",
            },
          ],
        },
        idempotencyKey: "agent-message-1",
        now,
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "queued" });
    expect(createThread.mock.calls[0]?.[0].title).toBe(
      "Prepare a campaign visual",
    );
    expect(startRun.mock.calls[0]?.[0]).toMatchObject({
      promptRevision: "profile-r3",
      maximumModelCalls: 6,
      maximumToolCalls: 4,
      foundationContext: {
        profileRevisionId: surfaceView.profile.id,
        skillViewDigest: surfaceView.skillViewDigest,
      },
      contextSnapshot: {
        surfaceKind: "agent_workspace",
        selectedArtifactIds: [
          "01K0000000000000000000000N",
          "01K0000000000000000000000F",
          ...brandArtifactIds,
        ],
        brandKitRevisionId: "01K0000000000000000000000B",
        brand: {
          name: "Kanvas Main",
          colors: [{ value: "#3348FFFF" }],
          logos: [
            { artifactId: "01K0000000000000000000000D", role: "primary" },
          ],
          referenceImages: brandArtifactIds.map((artifactId) => ({
            artifactId,
            description: "Natural light",
          })),
        },
      },
      userMessage: {
        referencedResources: [
          {
            kind: "artifact",
            resourceId: "01K0000000000000000000000N",
            artifactId: "01K0000000000000000000000N",
            displayName: "candidate.png",
          },
          {
            kind: "asset",
            resourceId: "01K0000000000000000000000E",
            artifactId: "01K0000000000000000000000F",
            version: 2,
          },
          {
            kind: "brand_kit_draft",
            resourceId: "01K0000000000000000000000A",
          },
        ],
      },
    });
    await service.create({
      authority,
      body: {
        message: "Continue with the same brand.",
        threadId: startRun.mock.calls[0]![0].threadId,
      },
      idempotencyKey: "agent-brand-follow-up",
      now,
    });
    expect(startRun.mock.calls[1]![0].contextSnapshot.brand).toEqual(
      startRun.mock.calls[0]![0].contextSnapshot.brand,
    );
    expect(startRun.mock.calls[1]![0].contextSnapshot.brandKitRevisionId).toBe(
      "01K0000000000000000000000B",
    );
    await service.create({
      authority,
      body: {
        message: "Continue without a brand.",
        threadId: startRun.mock.calls[0]![0].threadId,
        brandContext: null,
      },
      idempotencyKey: "agent-brand-clear",
      now,
    });
    expect(
      startRun.mock.calls[2]![0].contextSnapshot.brandKitRevisionId,
    ).toBeUndefined();
    expect(
      (startRun.mock.calls[2]![0].userMessage.referencedResources ?? []).some(
        (reference) => reference.kind === "brand_kit_draft",
      ),
    ).toBe(false);
    await service.create({
      authority,
      body: {
        message: "Shorten the title.",
        threadId: startRun.mock.calls[0]![0].threadId,
      },
      idempotencyKey: "agent-brand-clear-follow-up",
      now,
    });
    expect(
      startRun.mock.calls[3]![0].contextSnapshot.brandKitRevisionId,
    ).toBeUndefined();
    const threadId = startRun.mock.calls[0]![0].threadId;
    await service.create({
      authority,
      body: {
        message: "Improve this candidate.",
        threadId,
        attachments: [{ artifactId: "01K0000000000000000000000P" }],
      },
      idempotencyKey: "agent-result-follow-up",
      now,
    });
    expect(getAgentAttachmentArtifact).toHaveBeenCalledWith(
      authority,
      "01K0000000000000000000000P",
      threadId,
    );
    expect(startRun.mock.calls[4]![0]).toMatchObject({
      contextSnapshot: {
        selectedArtifactIds: ["01K0000000000000000000000P"],
      },
      userMessage: {
        referencedResources: [
          {
            kind: "artifact",
            resourceId: "01K0000000000000000000000P",
            artifactId: "01K0000000000000000000000P",
          },
        ],
      },
    });
  });

  it("pins a revalidated Canvas entry and selection to the Main Agent Run", async () => {
    const canvasDraftId = "01K0000000000000000000000A";
    const followUpCanvasDraftId = "01K0000000000000000000000C";
    const threadId = "01K0000000000000000000000B";
    const brandKitId = "01K0000000000000000000000D";
    const brandKitRevisionId = "01K0000000000000000000000E";
    const unrelatedBrandKitRevisionId = "01K0000000000000000000000F";
    const startRun = vi.fn<AgentRuntimeRepository["startRun"]>((options) =>
      Promise.resolve({
        id: options.runId,
        workspaceId: authority.workspaceId,
        threadId: options.threadId,
        actorPrincipalId: authority.principalId,
        lifecycleStatus: "queued",
        contextSnapshot: options.contextSnapshot,
        toolViewDigest: options.toolViewDigest,
        promptRevision: options.promptRevision,
        maximumModelCalls: options.maximumModelCalls,
        maximumToolCalls: options.maximumToolCalls,
        foundationContext: options.foundationContext,
        version: 1,
        executionDeadlineAt: options.executionDeadlineAt,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const service = workspaceAgentService(
      {
        agentFoundation: {
          resolveSurfaceView: () => Promise.resolve(surfaceView),
        },
        canvasDrafts: {
          get: (_authority: unknown, requestedCanvasDraftId: string) =>
            Promise.resolve({
              id: requestedCanvasDraftId,
              workspaceId: authority.workspaceId,
              document: {
                schemaVersion: "kanvas.editor-document/v1",
                documentId: requestedCanvasDraftId,
                workspaceId: authority.workspaceId,
                title: "秋日新品",
                pages: [
                  {
                    id: "page-1",
                    name: "页面 1",
                    width: 1080,
                    height: 1080,
                    background: { kind: "transparent" },
                    nodes: [
                      {
                        id: "headline",
                        name: "主标题",
                        kind: "text",
                        transform: {
                          x: 100,
                          y: 100,
                          width: 800,
                          height: 120,
                          rotation: 0,
                          flipX: false,
                          flipY: false,
                        },
                        opacity: 1,
                        blendMode: "normal",
                        visible: true,
                        locked: false,
                        content: {
                          paragraphs: [
                            {
                              align: "left",
                              direction: "auto",
                              lineHeight: 1.2,
                              spaceBefore: 0,
                              spaceAfter: 0,
                              runs: [
                                {
                                  text: "秋日新品",
                                  font: {
                                    source: "builtin",
                                    fontId: "noto-sans-sc",
                                    family: "Noto Sans SC",
                                  },
                                  fontSize: 72,
                                  fontWeight: 700,
                                  fontStyle: "normal",
                                  letterSpacing: 0,
                                  fill: { kind: "solid", color: "#151515" },
                                  decoration: {
                                    underline: false,
                                    strikeThrough: false,
                                  },
                                },
                              ],
                            },
                          ],
                          verticalAlign: "top",
                          resizeMode: "fixed",
                        },
                        effects: [],
                      },
                    ],
                  },
                ],
                metadata: { createdWith: "kanvas-web" },
              },
              version: 3,
              createdByPrincipalId: authority.principalId,
              updatedByPrincipalId: authority.principalId,
              createdAt: now,
              updatedAt: now,
            }),
        },
        agentRuntime: {
          getThread: () =>
            Promise.resolve({
              id: threadId,
              workspaceId: authority.workspaceId,
              createdByPrincipalId: authority.principalId,
              agentDefinitionId: surfaceView.profile.agentDefinitionId,
              agentProfileRevisionId: surfaceView.profile.id,
              lifecycleStatus: "active" as const,
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          listThreadActions: () => Promise.resolve([]),
          listThreadMessages: () =>
            Promise.resolve([
              {
                message: {
                  schemaVersion: 1,
                  role: "user",
                  parts: [{ type: "text", text: "从画板进入" }],
                  referencedResources: [
                    {
                      kind: "canvas_draft",
                      resourceId: canvasDraftId,
                      version: 3,
                    },
                  ],
                },
              },
              {
                message: {
                  schemaVersion: 1,
                  role: "user",
                  parts: [{ type: "text", text: "切换到新的画板" }],
                  referencedResources: [
                    {
                      kind: "canvas_draft",
                      resourceId: followUpCanvasDraftId,
                      version: 3,
                    },
                    {
                      kind: "brand_kit_draft",
                      resourceId: brandKitId,
                    },
                  ],
                },
              },
            ]),
          getLatestThreadRun: () =>
            Promise.resolve({
              contextSnapshot: {
                schemaVersion: 1,
                surfaceKind: "agent_workspace",
                brandKitRevisionId: unrelatedBrandKitRevisionId,
                brand: {
                  revisionId: unrelatedBrandKitRevisionId,
                  name: "Unrelated Brand",
                  colors: [
                    {
                      key: "primary",
                      name: "主色",
                      role: "primary",
                      value: "#3348FFFF",
                    },
                  ],
                  logos: [],
                },
              },
            }),
          createThread: () =>
            Promise.resolve({
              id: threadId,
              workspaceId: authority.workspaceId,
              createdByPrincipalId: authority.principalId,
              lifecycleStatus: "active",
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          startRun,
        } as unknown as AgentRuntimeRepository,
        workspaceBrand: {
          getDraft: () =>
            Promise.resolve({
              latestPublishedRevision: { id: brandKitRevisionId },
            }),
          getRevision: (
            _authority: unknown,
            requestedBrandKitId: string,
            requestedRevisionId: string,
          ) =>
            Promise.resolve(
              requestedBrandKitId === brandKitId &&
                requestedRevisionId === brandKitRevisionId
                ? {
                    id: brandKitRevisionId,
                    brandKitId,
                    document: {
                      schemaVersion: 1,
                      name: "Kanvas Activity",
                      description: "Campaign brand",
                      logos: [],
                      colors: [
                        {
                          key: "primary",
                          name: "主色",
                          role: "primary",
                          value: "#6D4AFFFF",
                        },
                      ],
                      typography: [],
                      imagery: [],
                      voice: [],
                      layouts: [],
                      rules: [],
                    },
                  }
                : undefined,
            ),
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await service.create({
      authority,
      body: {
        message: "把选中的标题改成红色。",
        entryContext: {
          originSurface: "canvas",
          canvasDraftId,
          canvasDraftVersion: 3,
          pageKey: "page-1",
          selectedElementKeys: ["headline"],
          returnTo: `/w/${authority.workspaceId}/boards/${canvasDraftId}`,
        },
      },
      idempotencyKey: "agent-canvas-entry-1",
      now,
    });

    expect(startRun.mock.calls[0]?.[0]).toMatchObject({
      userMessage: {
        referencedResources: [
          { kind: "canvas_draft", resourceId: canvasDraftId, version: 3 },
        ],
      },
      contextSnapshot: {
        surfaceKind: "agent_workspace",
        resource: {
          kind: "canvas_draft",
          resourceId: canvasDraftId,
          version: 3,
        },
        selectedElementKeys: ["headline"],
      },
    });

    await service.create({
      authority,
      body: {
        message: "继续调整排版。",
        threadId,
      },
      idempotencyKey: "agent-canvas-follow-up-1",
      now,
    });

    expect(startRun.mock.calls[1]?.[0]).toMatchObject({
      userMessage: {
        parts: [{ type: "text", text: "继续调整排版。" }],
      },
      contextSnapshot: {
        resource: {
          kind: "canvas_draft",
          resourceId: followUpCanvasDraftId,
          version: 3,
        },
      },
    });
    expect(startRun.mock.calls[1]?.[0].contextSnapshot.brand).toBeUndefined();
    expect(
      startRun.mock.calls[1]?.[0].contextSnapshot.brandKitRevisionId,
    ).toBeUndefined();
    expect(
      startRun.mock.calls[1]?.[0].userMessage.referencedResources,
    ).toBeUndefined();
    await expect(
      service.create({
        authority,
        body: {
          message: "继续修改。",
          entryContext: {
            originSurface: "canvas",
            canvasDraftId,
            canvasDraftVersion: 2,
            pageKey: "page-1",
            selectedElementKeys: ["headline"],
          },
        },
        idempotencyKey: "agent-canvas-entry-stale",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.canvas_context_changed" });
    await expect(
      service.create({
        authority: {
          ...authority,
          effectivePermissions: ["agent.run"],
        },
        body: {
          message: "继续修改。",
          entryContext: {
            originSurface: "canvas",
            canvasDraftId,
            canvasDraftVersion: 3,
            selectedElementKeys: [],
          },
        },
        idempotencyKey: "agent-canvas-entry-forbidden",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.canvas_context_unavailable" });
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  it("projects persistent thread lists, related content, tasks and approvals from Agent facts", async () => {
    const threadId = "01K00000000000000000000006";
    const runId = "01K00000000000000000000007";
    const actionId = "01K00000000000000000000008";
    const workflowRevisionId = "01K00000000000000000000009";
    const canvasDraftId = "01K0000000000000000000000E";
    const workflowRunId = "01K0000000000000000000000B";
    const intermediateArtifactId = "01K0000000000000000000000P";
    const brandKitId = "01K0000000000000000000000G";
    const brandKitRevisionId = "01K0000000000000000000000H";
    const updatedAt = new Date("2026-08-24T20:01:00.000Z");
    const thread = {
      id: threadId,
      workspaceId: authority.workspaceId,
      createdByPrincipalId: authority.principalId,
      agentDefinitionId: surfaceView.profile.agentDefinitionId,
      agentProfileRevisionId: surfaceView.profile.id,
      lifecycleStatus: "active" as const,
      title: "Prepare a campaign visual",
      version: 2,
      createdAt: now,
      updatedAt,
    };
    const service = workspaceAgentService(
      {
        agentFoundation: {
          resolveSurfaceView: () =>
            Promise.resolve({
              ...surfaceView,
              profile: {
                ...surfaceView.profile,
                manifest: {
                  ...surfaceView.profile.manifest,
                  displayName: "Example Studio 节气海报 Agent",
                },
              },
              skills: [
                {
                  bound: true,
                  skillDefinitionId: "01K0000000000000000000000J",
                  displayName: "公司节气宣传海报",
                  summary: "按照品牌要求制作节气海报。",
                },
              ],
              boundBrands: [
                {
                  brandKitId,
                  name: "Kanvas 活动品牌",
                  description: "用于活动推广与社交媒体",
                },
              ],
              boundWorkflows: [
                {
                  workflowDefinitionId: "01K0000000000000000000000K",
                  displayName: "生成图片",
                  description: "生成最终图片。",
                },
              ],
            } as unknown as AgentSurfaceView),
        },
        agentProfilePublications: {
          getModelSettings: () =>
            Promise.resolve({ actionConfirmationRequired: false }),
        },
        agentRuntime: {
          listThreads: () =>
            Promise.resolve({
              items: [
                {
                  ...thread,
                  latestRun: {
                    id: runId,
                    lifecycleStatus: "waiting_approval" as const,
                    updatedAt,
                  },
                },
              ],
              nextCursor: { id: threadId, updatedAt },
            }),
          getThread: () => Promise.resolve(thread),
          listThreadMessages: () =>
            Promise.resolve([
              {
                id: "01K0000000000000000000000A",
                workspaceId: authority.workspaceId,
                threadId,
                agentRunId: runId,
                sequenceNumber: 1,
                message: {
                  schemaVersion: 1 as const,
                  role: "user" as const,
                  parts: [
                    {
                      type: "text" as const,
                      text: "Prepare a campaign visual.",
                    },
                  ],
                  referencedResources: [
                    {
                      kind: "canvas_draft" as const,
                      resourceId: canvasDraftId,
                      version: 3,
                    },
                    {
                      kind: "brand_kit_draft" as const,
                      resourceId: brandKitId,
                      brandKitRevisionId,
                    },
                  ],
                },
                createdAt: now,
              },
              {
                id: "01K0000000000000000000000F",
                workspaceId: authority.workspaceId,
                threadId,
                agentRunId: runId,
                sequenceNumber: 2,
                message: {
                  schemaVersion: 1 as const,
                  role: "user" as const,
                  parts: [
                    {
                      type: "text" as const,
                      text: "Continue with the same Canvas.",
                    },
                  ],
                  referencedResources: [
                    {
                      kind: "canvas_draft" as const,
                      resourceId: canvasDraftId,
                      version: 2,
                    },
                  ],
                },
                createdAt: updatedAt,
              },
            ]),
          getLatestThreadRun: () =>
            Promise.resolve({
              id: runId,
              workspaceId: authority.workspaceId,
              threadId,
              actorPrincipalId: authority.principalId,
              lifecycleStatus: "waiting_approval" as const,
              contextSnapshot: {
                schemaVersion: 1 as const,
                surfaceKind: "workspace_home" as const,
                brandKitRevisionId,
              },
              toolViewDigest: surfaceView.skillViewDigest,
              promptRevision: "profile-r3",
              maximumModelCalls: 6,
              maximumToolCalls: 4,
              foundationContext: {
                schemaVersion: 1 as const,
                profileRevisionId: surfaceView.profile.id,
                profileCanonicalDigest: surfaceView.profile.canonicalDigest,
                skillViewDigest: surfaceView.skillViewDigest,
                skills: [],
              },
              version: 2,
              executionDeadlineAt: new Date(now.getTime() + 120_000),
              createdAt: now,
              updatedAt,
            }),
          listThreadActions: () =>
            Promise.resolve([
              {
                id: actionId,
                workspaceId: authority.workspaceId,
                agentRunId: runId,
                actionNumber: 1,
                toolCallId: "agent-tool-1",
                toolKey: "workflow.propose.entrypoint-1",
                effect: "compute" as const,
                approvalMode: "before_commit" as const,
                lifecycleStatus: "waiting_approval" as const,
                inputDigest: surfaceView.skillViewDigest,
                proposalDocument: {
                  workflowRevisionId,
                  title: "Campaign visual",
                  description: "Prepare one campaign visual.",
                  input: { prompt: "A calm summer campaign visual" },
                },
                version: 2,
                createdAt: now,
                updatedAt,
              },
              {
                id: "01K0000000000000000000000C",
                workspaceId: authority.workspaceId,
                agentRunId: runId,
                actionNumber: 2,
                toolCallId: "agent-tool-2",
                toolKey: "workflow.propose.entrypoint-2",
                effect: "compute" as const,
                approvalMode: "before_commit" as const,
                lifecycleStatus: "succeeded" as const,
                inputDigest: surfaceView.skillViewDigest,
                proposalDocument: {
                  workflowRevisionId,
                  title: "Generated image",
                  description: "Generate one image from the approved prompt.",
                  input: { prompt: "A generated campaign image" },
                },
                outcomeReference: {
                  kind: "workflow_run" as const,
                  workflowRunId,
                },
                version: 3,
                createdAt: now,
                updatedAt,
              },
              {
                id: "01K0000000000000000000000Q",
                workspaceId: authority.workspaceId,
                agentRunId: runId,
                actionNumber: 3,
                toolCallId: "brand-publish",
                toolKey: "brand.propose-publish",
                effect: "write" as const,
                approvalMode: "before_commit" as const,
                lifecycleStatus: "waiting_approval" as const,
                inputDigest: surfaceView.skillViewDigest,
                proposalDocument: {
                  schemaVersion: 1,
                  actionRef: "brand-publish",
                  presentation: {
                    kind: "brand_publish",
                    resourceName: "Kanvas Test Brand",
                  },
                  input: { brandKitId, expectedDraftVersion: 4 },
                },
                version: 2,
                createdAt: now,
                updatedAt,
              },
              {
                id: "01K0000000000000000000000R",
                workspaceId: authority.workspaceId,
                agentRunId: runId,
                actionNumber: 4,
                toolCallId: "skill-files",
                toolKey: "skill.propose-files",
                effect: "internal_write" as const,
                approvalMode: "before_commit" as const,
                lifecycleStatus: "waiting_approval" as const,
                inputDigest: surfaceView.skillViewDigest,
                proposalDocument: {
                  schemaVersion: 1,
                  actionRef: "skill-draft-files",
                  presentation: {
                    kind: "skill_images_update",
                    imageCount: 2,
                  },
                  input: {
                    draftId: "01K0000000000000000000000S",
                    expectedDraftVersion: 2,
                    files: [
                      {
                        path: "references/source.png",
                        artifactId: "01K0000000000000000000000T",
                      },
                      {
                        path: "assets/result.webp",
                        artifactId: "01K0000000000000000000000V",
                      },
                    ],
                  },
                },
                version: 2,
                createdAt: now,
                updatedAt,
              },
            ]),
          listThreadInteractions: () => Promise.resolve([]),
        } as unknown as AgentRuntimeRepository,
        canvasDrafts: {
          get: () =>
            Promise.resolve({
              id: canvasDraftId,
              document: {
                title: "Campaign Canvas",
                pages: [{}],
              },
              version: 2,
            }),
        },
        workspaceContentQueries: {
          listWorkflowRunArtifacts: () =>
            Promise.resolve([
              {
                id: intermediateArtifactId,
                artifactType: "image.generated",
                displayFilename: "draft.png",
                mediaType: "image/png",
                availabilityStatus: "available",
                createdAt: now,
              },
              {
                id: "01K0000000000000000000000D",
                artifactType: "image.generated",
                displayFilename: "result.png",
                mediaType: "image/png",
                availabilityStatus: "available",
                createdAt: updatedAt,
              },
            ]),
        },
        workspaceBrand: {
          getDraft: () =>
            Promise.resolve({
              document: {
                name: "Kanvas 活动品牌",
                description: "用于活动推广与社交媒体",
              },
              latestPublishedRevision: { id: brandKitRevisionId },
            }),
          getRevision: () =>
            Promise.resolve({
              id: brandKitRevisionId,
              brandKitId,
              document: {
                name: "Kanvas 活动品牌",
                description: "用于活动推广与社交媒体",
              },
            }),
        },
      } as unknown as DatabaseRuntime,
      {
        workflow: {
          getRun: () =>
            Promise.resolve({
              lifecycleStatus: "completed" as const,
              output: { image: "01K0000000000000000000000D" },
            }),
        },
      } as unknown as ApplicationRuntime,
    );

    await expect(
      service.listThreads({ authority, limit: 30, now }),
    ).resolves.toEqual({
      items: [
        {
          id: threadId,
          title: "Prepare a campaign visual",
          lifecycleStatus: "active",
          version: 2,
          latestRun: {
            id: runId,
            lifecycleStatus: "waiting_approval",
            updatedAt: updatedAt.toISOString(),
          },
          createdAt: now.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      nextCursor: { id: threadId, updatedAt },
    });
    await expect(
      service.getThread({ authority, threadId, now }),
    ).resolves.toMatchObject({
      id: threadId,
      agent: {
        id: surfaceView.profile.agentDefinitionId,
        displayName: "Example Studio 节气海报 Agent",
      },
      messages: [
        {
          id: "01K0000000000000000000000A",
          role: "user",
          parts: [{ type: "text", text: "Prepare a campaign visual." }],
          relatedContent: [
            {
              kind: "canvas",
              resourceId: canvasDraftId,
              version: 3,
            },
            {
              kind: "brand",
              resourceId: brandKitId,
              brandKitRevisionId,
            },
          ],
        },
        {
          id: "01K0000000000000000000000F",
          role: "user",
          parts: [{ type: "text", text: "Continue with the same Canvas." }],
          relatedContent: [],
        },
      ],
      relatedContent: [
        {
          kind: "workflow",
          resourceId: workflowRevisionId,
          title: "Generated image",
        },
        {
          kind: "canvas",
          resourceId: canvasDraftId,
          title: "Campaign Canvas",
        },
        {
          kind: "brand",
          resourceId: brandKitId,
          brandKitRevisionId,
          title: "Kanvas 活动品牌",
        },
      ],
      tasks: [
        {
          id: actionId,
          kind: "workflow",
          lifecycleStatus: "waiting_approval",
          title: "Campaign visual",
          workflowRevisionId,
          input: { prompt: "A calm summer campaign visual" },
        },
        {
          id: "01K0000000000000000000000C",
          kind: "workflow",
          lifecycleStatus: "succeeded",
          title: "Generated image",
          workflowRevisionId,
          input: { prompt: "A generated campaign image" },
          workflowRunId,
          resultArtifacts: [
            {
              resourceId: "01K0000000000000000000000D",
              kind: "image",
              title: "result.png",
              state: "available",
            },
          ],
        },
        {
          id: "01K0000000000000000000000Q",
          kind: "brand",
          lifecycleStatus: "waiting_approval",
          title: "Kanvas Test Brand",
          presentation: {
            kind: "brand_publish",
            resourceName: "Kanvas Test Brand",
          },
          brandKitId,
          input: { brandKitId, expectedDraftVersion: 4 },
        },
        {
          id: "01K0000000000000000000000R",
          kind: "skill",
          lifecycleStatus: "waiting_approval",
          title: "Skill",
          presentation: {
            kind: "skill_images_update",
            imageCount: 2,
          },
        },
      ],
    });
  });

  it.each(["running", "waiting_approval"] as const)(
    "commits one approved Capability proposal without closing a live model loop (%s)",
    async (initialStatus) => {
      const run = {
        id: "01K00000000000000000000008",
        workspaceId: authority.workspaceId,
        threadId: "01K00000000000000000000009",
        actorPrincipalId: authority.principalId,
        lifecycleStatus: initialStatus,
        contextSnapshot: {
          schemaVersion: 1,
          surfaceKind: "workspace_home",
          surfaceState: {
            kind: "workspace_home",
            attachmentState: "none",
            attachedResourceIds: [],
          },
        },
        toolViewDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        promptRevision: "profile-r3",
        maximumModelCalls: 6,
        maximumToolCalls: 4,
        foundationContext: {
          schemaVersion: 1,
          profileRevisionId: surfaceView.profile.id,
          profileCanonicalDigest: surfaceView.profile.canonicalDigest,
          skillViewDigest: surfaceView.skillViewDigest,
          skills: [],
        },
        version: 3,
        executionDeadlineAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
      } as const;
      const action = {
        id: "01K0000000000000000000000A",
        workspaceId: authority.workspaceId,
        agentRunId: run.id,
        actionNumber: 1,
        toolCallId: "agent-tool-1",
        toolKey: "capability.invoke",
        effect: "compute",
        approvalMode: "before_commit",
        lifecycleStatus: "waiting_approval",
        inputDigest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        outputDigest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        proposalDocument: {
          schemaVersion: 1,
          contractRevisionId: "01K0000000000000000000000B",
          title: "Prepare result",
          description: "Prepare one result.",
          input: { brief: "Campaign" },
        },
        version: 3,
        createdAt: now,
        updatedAt: now,
      } as const;
      const completeAction = vi.fn(() =>
        Promise.resolve({
          ...action,
          lifecycleStatus: "succeeded" as const,
          version: 5,
        }),
      );
      let runStatus: AgentRunRecord["lifecycleStatus"] = run.lifecycleStatus;
      let runVersion = run.version;
      const transitionRun = vi.fn<AgentRuntimeRepository["transitionRun"]>(
        (options) => {
          runStatus = options.toStatus;
          runVersion = options.expectedVersion + 1;
          return Promise.resolve({
            ...run,
            lifecycleStatus: runStatus,
            version: runVersion,
          });
        },
      );
      const facts = {
        getAction: () => Promise.resolve(action),
        getRun: () =>
          Promise.resolve({
            ...run,
            lifecycleStatus: runStatus,
            version: runVersion,
          }),
        listRunActions: () =>
          Promise.resolve([{ ...action, lifecycleStatus: "succeeded" }]),
        transitionRun,
        settleRun: () =>
          runStatus === "running"
            ? Promise.resolve({
                ...run,
                lifecycleStatus: runStatus,
                version: runVersion,
              })
            : transitionRun({
                authority,
                runId: run.id,
                expectedVersion: runVersion,
                toStatus: "succeeded",
                now,
              }),
        transitionAction: (
          options: Parameters<AgentRuntimeRepository["transitionAction"]>[0],
        ) =>
          Promise.resolve({
            ...action,
            lifecycleStatus: options.toStatus,
            version: options.expectedVersion + 1,
          }),
        completeAction,
      } as unknown as AgentRuntimeRepository;
      const start = vi.fn(() =>
        Promise.resolve({
          run: {
            id: "01K0000000000000000000000C",
            lifecycleStatus: "queued",
          },
          replayed: false,
        }),
      );
      const service = new WorkspaceAgentService(
        { agentRuntime: facts } as unknown as DatabaseRuntime,
        {} as ApplicationRuntime,
        { start } as unknown as CapabilityRunService,
      );

      await expect(
        service.confirm({
          authority: {
            ...authority,
            effectivePermissions: [
              ...authority.effectivePermissions,
              "capability.run",
            ],
          },
          actionReceiptId: action.id,
          idempotencyKey: "confirm-agent-action-1",
          now,
        }),
      ).resolves.toEqual({
        actionReceiptId: action.id,
        outcomeKind: "capability_run",
        capabilityRunId: "01K0000000000000000000000C",
        lifecycleStatus: "succeeded",
      });
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          invocationKind: "agent",
          contractRevisionId: "01K0000000000000000000000B",
          invocationReferenceId: action.id,
          idempotencyKey: `agent-capability:${action.id}`,
          input: { brief: "Campaign" },
        }),
      );
      expect(completeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outcomeReference: {
            kind: "capability_run",
            capabilityRunId: "01K0000000000000000000000C",
          },
        }),
      );
      expect(transitionRun.mock.calls.map(([value]) => value.toStatus)).toEqual(
        initialStatus === "running" ? [] : ["succeeded"],
      );
    },
  );

  it.each(["waiting_approval", "succeeded"] as const)(
    "confirms a second Capability proposal when its Agent Run is %s",
    async (parentStatus) => {
      const runId = "01K00000000000000000000008";
      const firstId = "01K0000000000000000000000A";
      const secondId = "01K0000000000000000000000D";
      let runStatus: AgentRunRecord["lifecycleStatus"] = "waiting_approval";
      let runVersion = 3;
      type ActionFixture = {
        id: string;
        agentRunId: string;
        lifecycleStatus: "waiting_approval" | "running" | "succeeded";
        version: number;
        proposalDocument: {
          schemaVersion: number;
          contractRevisionId: string;
          title: string;
          input: { brief: string };
        };
        outcomeReference?: { kind: "capability_run"; capabilityRunId: string };
      };
      const actions = new Map<string, ActionFixture>(
        [firstId, secondId].map((id, index) => [
          id,
          {
            id,
            agentRunId: runId,
            lifecycleStatus: "waiting_approval" as const,
            version: 3,
            proposalDocument: {
              schemaVersion: 1,
              contractRevisionId: "01K0000000000000000000000B",
              title: `Image ${index + 1}`,
              input: { brief: `Image ${index + 1}` },
            },
          },
        ]),
      );
      const transitionRun = vi.fn<AgentRuntimeRepository["transitionRun"]>(
        (options) => {
          runStatus = options.toStatus;
          runVersion += 1;
          return Promise.resolve({
            id: runId,
            lifecycleStatus: runStatus,
            version: runVersion,
          } as AgentRunRecord);
        },
      );
      const agentRuntime = {
        getAction: (_scope: TrustedWorkspaceScope, id: string) =>
          Promise.resolve(actions.get(id)),
        getRun: () =>
          Promise.resolve({
            id: runId,
            lifecycleStatus: runStatus,
            version: runVersion,
          } as AgentRunRecord),
        listRunActions: () => Promise.resolve([...actions.values()]),
        transitionRun,
        settleRun: () =>
          [...actions.values()].some(
            (action) => action.lifecycleStatus !== "succeeded",
          ) || runStatus === "succeeded"
            ? Promise.resolve({
                id: runId,
                lifecycleStatus: runStatus,
                version: runVersion,
              } as AgentRunRecord)
            : transitionRun({
                authority,
                runId,
                expectedVersion: runVersion,
                toStatus: "succeeded",
                now,
              }),
        transitionAction: (options: {
          actionReceiptId: string;
          toStatus: "running";
        }) => {
          const action = actions.get(options.actionReceiptId)!;
          const updated = {
            ...action,
            lifecycleStatus: options.toStatus,
            version: action.version + 1,
          };
          actions.set(action.id, updated);
          return Promise.resolve(updated);
        },
        completeAction: (options: {
          actionReceiptId: string;
          outcomeReference: { kind: "capability_run"; capabilityRunId: string };
        }) => {
          const action = actions.get(options.actionReceiptId)!;
          const updated = {
            ...action,
            lifecycleStatus: "succeeded" as const,
            version: action.version + 1,
            outcomeReference: options.outcomeReference,
          };
          actions.set(action.id, updated);
          return Promise.resolve(updated);
        },
      } as unknown as AgentRuntimeRepository;
      const start = vi.fn((options: { invocationReferenceId: string }) =>
        Promise.resolve({
          run: { id: options.invocationReferenceId, lifecycleStatus: "queued" },
          replayed: false,
        }),
      );
      const service = new WorkspaceAgentService(
        { agentRuntime } as unknown as DatabaseRuntime,
        {} as ApplicationRuntime,
        { start } as unknown as CapabilityRunService,
      );
      const scope = {
        ...authority,
        effectivePermissions: [
          ...authority.effectivePermissions,
          "capability.run",
        ],
      } satisfies TrustedWorkspaceScope;

      await expect(
        service.confirm({
          authority: scope,
          actionReceiptId: firstId,
          idempotencyKey: "first",
          now,
        }),
      ).resolves.toMatchObject({
        actionReceiptId: firstId,
        lifecycleStatus: "succeeded",
      });
      expect(runStatus).toBe("waiting_approval");
      await expect(
        service.confirm({
          authority: scope,
          actionReceiptId: firstId,
          idempotencyKey: "first-retry",
          now,
        }),
      ).resolves.toMatchObject({ actionReceiptId: firstId });
      expect(runStatus).toBe("waiting_approval");
      expect(start).toHaveBeenCalledTimes(1);
      if (parentStatus === "succeeded") {
        // Recover receipts left pending by the previous eager Run completion.
        runStatus = "succeeded";
        runVersion += 1;
      }
      await expect(
        service.confirm({
          authority: scope,
          actionReceiptId: secondId,
          idempotencyKey: "second",
          now,
        }),
      ).resolves.toMatchObject({
        actionReceiptId: secondId,
        lifecycleStatus: "succeeded",
      });
      expect(runStatus).toBe("succeeded");
      expect(start).toHaveBeenCalledTimes(2);
    },
  );

  it("creates an image-result Skill Draft from an Artifact in the current conversation", async () => {
    const sourceArtifactId = "01K0000000000000000000000F";
    const sourceRunId = "01K0000000000000000000000G";
    const skillDraftId = "01K0000000000000000000000H";
    const run = {
      id: "01K00000000000000000000008",
      workspaceId: authority.workspaceId,
      threadId: "01K00000000000000000000009",
      actorPrincipalId: authority.principalId,
      lifecycleStatus: "waiting_approval",
      contextSnapshot: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        surfaceState: {
          kind: "agent_workspace",
          originSurface: "agent",
          attachmentState: "none",
          attachedResourceIds: [],
          canUndo: false,
          canRedo: false,
        },
      },
      toolViewDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      promptRevision: "profile-r3",
      maximumModelCalls: 6,
      maximumToolCalls: 4,
      foundationContext: {
        schemaVersion: 1,
        profileRevisionId: surfaceView.profile.id,
        profileCanonicalDigest: surfaceView.profile.canonicalDigest,
        skillViewDigest: surfaceView.skillViewDigest,
        skills: [],
      },
      version: 3,
      executionDeadlineAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    } as const;
    const action = {
      id: "01K0000000000000000000000A",
      workspaceId: authority.workspaceId,
      agentRunId: run.id,
      actionNumber: 1,
      toolCallId: "agent-tool-1",
      toolKey: "skill.propose-create",
      effect: "internal-write",
      approvalMode: "before_commit",
      lifecycleStatus: "waiting_approval",
      inputDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      proposalDocument: {
        schemaVersion: 1,
        actionRef: "skill-draft-create",
        presentation: {
          kind: "skill_create",
          resourceName: "公司节气宣传海报",
          imageCount: 0,
        },
        input: {
          name: "seasonal-poster",
          displayName: "公司节气宣传海报",
          description: "根据公司品牌要求制作节气宣传海报。",
          summary: "制作遵循品牌要求的节气宣传海报。",
          instructions: "先读取已绑定品牌，再根据节气主题生成一张宣传海报。",
          visibility: "private",
          category: "品牌海报",
          tags: ["节气", "品牌"],
          exampleRequests: ["制作一张立秋宣传海报"],

          sourceArtifactId,
        },
      },
      version: 3,
      createdAt: now,
      updatedAt: now,
    } as const;
    let runStatus: AgentRunRecord["lifecycleStatus"] = run.lifecycleStatus;
    let runVersion = run.version;
    const transitionRun = vi.fn<AgentRuntimeRepository["transitionRun"]>(
      (options) => {
        runStatus = options.toStatus;
        runVersion = options.expectedVersion + 1;
        return Promise.resolve({
          ...run,
          lifecycleStatus: runStatus,
          version: runVersion,
        } as AgentRunRecord);
      },
    );
    const completeAction = vi.fn(() =>
      Promise.resolve({
        ...action,
        lifecycleStatus: "succeeded" as const,
        version: 5,
      }),
    );
    const agentRuntime = {
      getAction: () => Promise.resolve(action),
      getRun: () =>
        Promise.resolve({
          ...run,
          lifecycleStatus: runStatus,
          version: runVersion,
        } as AgentRunRecord),
      listRunActions: () =>
        Promise.resolve([{ ...action, lifecycleStatus: "succeeded" }]),
      transitionRun,
      settleRun: () =>
        transitionRun({
          authority,
          runId: run.id,
          expectedVersion: runVersion,
          toStatus: "succeeded",
          now,
        }),
      transitionAction: (
        options: Parameters<AgentRuntimeRepository["transitionAction"]>[0],
      ) =>
        Promise.resolve({
          ...action,
          lifecycleStatus: options.toStatus,
          version: options.expectedVersion + 1,
        }),
      completeAction,
    } as unknown as AgentRuntimeRepository;
    const resolveDerivationSource = vi.fn<
      (
        options: Parameters<SkillLibraryService["resolveDerivationSource"]>[0],
      ) => Promise<{ readonly sourceRunId: string }>
    >(() => Promise.resolve({ sourceRunId }));
    const createDraft = vi.fn<
      (
        options: Parameters<SkillLibraryService["createDraft"]>[0],
      ) => Promise<{ readonly id: string }>
    >(() => Promise.resolve({ id: skillDraftId }));
    const service = new WorkspaceAgentService(
      { agentRuntime } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
      {} as CapabilityRunService,
      {
        resolveDerivationSource,
        createDraft,
      } as unknown as SkillLibraryService,
    );

    await expect(
      service.confirm({
        authority: {
          ...authority,
          effectivePermissions: [
            ...authority.effectivePermissions,
            "skill.manage",
          ],
        },
        actionReceiptId: action.id,
        idempotencyKey: "confirm-skill-draft-1",
        now,
      }),
    ).resolves.toEqual({
      actionReceiptId: action.id,
      outcomeKind: "skill_draft",
      skillDraftId,
      lifecycleStatus: "succeeded",
    });
    expect(resolveDerivationSource.mock.calls[0]?.[0]).toMatchObject({
      authority: {
        workspaceId: authority.workspaceId,
        principalId: authority.principalId,
      },
      threadId: run.threadId,
      artifactId: sourceArtifactId,
      now,
    });
    expect(createDraft.mock.calls[0]?.[0]).toMatchObject({
      body: {
        name: "seasonal-poster",
      },
      idempotencyKey: `agent-skill:${action.id}`,
      derivation: {
        sourceThreadId: run.threadId,
        sourceRunId,
        sourceArtifactId,
      },
    });
    expect(completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeReference: { kind: "skill_draft", skillDraftId },
      }),
    );
    expect(transitionRun.mock.calls.map(([value]) => value.toStatus)).toEqual([
      "succeeded",
    ]);
  });

  it("publishes an inspected Brand Draft only after action confirmation", async () => {
    const brandKitId = "01K0000000000000000000000F";
    const brandKitRevisionId = "01K0000000000000000000000G";
    const run = {
      id: "01K00000000000000000000008",
      threadId: "01K00000000000000000000009",
      lifecycleStatus: "waiting_approval" as const,
      version: 3,
    };
    const action = {
      id: "01K0000000000000000000000A",
      agentRunId: run.id,
      lifecycleStatus: "waiting_approval" as const,
      version: 2,
      proposalDocument: {
        schemaVersion: 1,
        actionRef: "brand-publish",
        presentation: {
          kind: "brand_publish",
          resourceName: "Kanvas Main",
        },
        input: { brandKitId, expectedDraftVersion: 4 },
      },
    };
    let runStatus: "waiting_approval" | "running" | "succeeded" =
      run.lifecycleStatus;
    let runVersion = run.version;
    const transitionRun = vi.fn((options: { toStatus: typeof runStatus }) => {
      runStatus = options.toStatus;
      runVersion += 1;
      return Promise.resolve({
        ...run,
        lifecycleStatus: runStatus,
        version: runVersion,
      });
    });
    const completeAction = vi.fn(() =>
      Promise.resolve({ ...action, lifecycleStatus: "succeeded", version: 4 }),
    );
    const publish = vi.fn(() =>
      Promise.resolve({
        replayed: false,
        value: { id: brandKitRevisionId, brandKitId },
      }),
    );
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getAction: () => Promise.resolve(action),
          getRun: () =>
            Promise.resolve({
              ...run,
              lifecycleStatus: runStatus,
              version: runVersion,
            }),
          listRunActions: () =>
            Promise.resolve([{ ...action, lifecycleStatus: "succeeded" }]),
          transitionRun,
          settleRun: () => transitionRun({ toStatus: "succeeded" }),
          transitionAction: () =>
            Promise.resolve({
              ...action,
              lifecycleStatus: "running",
              version: 3,
            }),
          completeAction,
        },
      } as unknown as DatabaseRuntime,
      { workspaceBrand: { publish } } as unknown as ApplicationRuntime,
    );

    await expect(
      service.confirm({
        authority: {
          ...authority,
          effectivePermissions: [
            ...authority.effectivePermissions,
            "brand.manage",
          ],
        },
        actionReceiptId: action.id,
        idempotencyKey: "confirm-brand-publish-1",
        now,
      }),
    ).resolves.toEqual({
      actionReceiptId: action.id,
      outcomeKind: "brand_revision",
      brandKitId,
      brandKitRevisionId,
      lifecycleStatus: "succeeded",
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId,
        expectedDraftVersion: 4,
        idempotencyKey: `agent-brand-publish:${action.id}`,
      }),
    );
    expect(completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeReference: {
          kind: "brand_revision",
          brandKitId,
          brandKitRevisionId,
        },
      }),
    );
  });

  it("declines one pending proposal without requiring Workflow permission", async () => {
    const actionReceiptId = "01K0000000000000000000000D";
    const declinePendingAction = vi.fn<
      AgentRuntimeRepository["declinePendingAction"]
    >(() =>
      Promise.resolve({
        action: { id: actionReceiptId } as never,
        run: { id: "01K0000000000000000000000E" } as never,
        replayed: false,
      }),
    );
    const service = workspaceAgentService(
      {
        agentRuntime: { declinePendingAction },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );

    await expect(
      service.decline({
        authority: {
          ...authority,
          effectivePermissions: ["agent.run"],
        },
        actionReceiptId,
        idempotencyKey: "decline-agent-action-1",
        now,
      }),
    ).resolves.toEqual({
      actionReceiptId,
      lifecycleStatus: "cancelled",
    });
    expect(declinePendingAction).toHaveBeenCalledOnce();
    expect(declinePendingAction.mock.calls[0]?.[0]).toMatchObject({
      authority: {
        effectivePermissions: ["agent.run"],
      },
      actionReceiptId,
      now,
    });
  });

  it("replays a succeeded confirmation from its stored Workflow outcome", async () => {
    const workflowRunId = "01K0000000000000000000000F";
    const action = {
      id: "01K0000000000000000000000D",
      agentRunId: "01K0000000000000000000000E",
      lifecycleStatus: "succeeded",
      proposalDocument: {
        schemaVersion: 1,
        workflowRevisionId: "01K0000000000000000000000B",
        title: "Summer campaign",
        input: { prompt: "Summer campaign" },
      },
      outcomeReference: { kind: "workflow_run", workflowRunId },
    } as const;
    const createRun = vi.fn();
    const completeAction = vi.fn();
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getAction: () => Promise.resolve(action),
          getRun: () =>
            Promise.resolve({
              id: action.agentRunId,
              lifecycleStatus: "succeeded",
            }),
          completeAction,
          settleRun: () =>
            Promise.resolve({
              id: action.agentRunId,
              lifecycleStatus: "succeeded",
            } as AgentRunRecord),
        },
      } as unknown as DatabaseRuntime,
      { workflow: { createRun } } as unknown as ApplicationRuntime,
    );

    await expect(
      service.confirm({
        authority: {
          ...authority,
          effectivePermissions: [
            ...authority.effectivePermissions,
            "workflow.run",
          ],
        },
        actionReceiptId: action.id,
        idempotencyKey: "a-different-client-retry-key",
        now,
      }),
    ).resolves.toEqual({
      actionReceiptId: action.id,
      outcomeKind: "workflow_run",
      workflowRunId,
      lifecycleStatus: "succeeded",
    });
    expect(createRun).not.toHaveBeenCalled();
    expect(completeAction).not.toHaveBeenCalled();
  });

  it("repairs an Agent Run after a failed Workflow receipt response was lost", async () => {
    const action = {
      id: "01K0000000000000000000000M",
      agentRunId: "01K0000000000000000000000N",
      lifecycleStatus: "failed",
      terminalReasonCode: "agent.workflow_start_failed",
      proposalDocument: {
        schemaVersion: 1,
        workflowRevisionId: "01K0000000000000000000000B",
        title: "Summer campaign",
        input: { prompt: "Summer campaign" },
      },
    } as const;
    const transitionRun = vi.fn(() => Promise.resolve({} as never));
    const createRun = vi.fn();
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getAction: () => Promise.resolve(action),
          getRun: () =>
            Promise.resolve({
              id: action.agentRunId,
              lifecycleStatus: "running",
              version: 6,
            }),
          transitionRun,
          settleRun: vi.fn(() =>
            Promise.resolve({
              id: action.agentRunId,
              lifecycleStatus: "failed",
            } as AgentRunRecord),
          ),
        },
      } as unknown as DatabaseRuntime,
      { workflow: { createRun } } as unknown as ApplicationRuntime,
    );

    await expect(
      service.confirm({
        authority: {
          ...authority,
          effectivePermissions: [
            ...authority.effectivePermissions,
            "workflow.run",
          ],
        },
        actionReceiptId: action.id,
        idempotencyKey: "retry-failed-confirmation",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.action_state_conflict" });
    expect(transitionRun).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("recovers a running confirmation through the Action-bound Workflow identity", async () => {
    const workflowRunId = "01K0000000000000000000000J";
    const run = {
      id: "01K0000000000000000000000H",
      lifecycleStatus: "running",
      version: 4,
      contextSnapshot: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        selectedElementKeys: [],
        selectedArtifactIds: [],
        surfaceState: {
          kind: "agent_workspace",
          originSurface: "agent",
          attachmentState: "none",
          attachedResourceIds: [],
          canUndo: false,
          canRedo: false,
        },
      },
    } as const;
    const action = {
      id: "01K0000000000000000000000G",
      agentRunId: run.id,
      lifecycleStatus: "running",
      version: 4,
      proposalDocument: {
        schemaVersion: 1,
        workflowRevisionId: "01K0000000000000000000000B",
        title: "Summer campaign",
        input: { prompt: "Summer campaign" },
      },
    } as const;
    let runStatus: AgentRunRecord["lifecycleStatus"] = "running";
    let runVersion = run.version;
    const transitionRun = vi.fn<AgentRuntimeRepository["transitionRun"]>(
      (options) => {
        runStatus = options.toStatus;
        runVersion = options.expectedVersion + 1;
        return Promise.resolve({
          ...run,
          workspaceId: authority.workspaceId,
          threadId: "01K0000000000000000000000K",
          actorPrincipalId: authority.principalId,
          toolViewDigest:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          promptRevision: "profile-r3",
          maximumModelCalls: 6,
          maximumToolCalls: 4,
          foundationContext: {
            schemaVersion: 1,
            profileRevisionId: "01K00000000000000000000005",
            profileCanonicalDigest:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            skillViewDigest:
              "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            skills: [],
          },
          lifecycleStatus: runStatus,
          version: runVersion,
          executionDeadlineAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        });
      },
    );
    const completeAction = vi.fn(() =>
      Promise.resolve({ ...action, lifecycleStatus: "succeeded" as const }),
    );
    const transitionAction = vi.fn();
    const createRun = vi.fn(() =>
      Promise.resolve({
        run: { id: workflowRunId, lifecycleStatus: "queued" },
        replayed: true,
      }),
    );
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getAction: () => Promise.resolve(action),
          getRun: () =>
            Promise.resolve({
              ...run,
              lifecycleStatus: runStatus,
              version: runVersion,
            }),
          listRunActions: () =>
            Promise.resolve([{ ...action, lifecycleStatus: "succeeded" }]),
          transitionRun,
          settleRun: () =>
            transitionRun({
              authority,
              runId: run.id,
              expectedVersion: runVersion,
              toStatus: "succeeded",
              now,
            }),
          transitionAction,
          completeAction,
        },
      } as unknown as DatabaseRuntime,
      { workflow: { createRun } } as unknown as ApplicationRuntime,
    );

    await expect(
      service.confirm({
        authority: {
          ...authority,
          effectivePermissions: [
            ...authority.effectivePermissions,
            "workflow.run",
          ],
        },
        actionReceiptId: action.id,
        idempotencyKey: "retry-after-response-loss",
        now,
      }),
    ).resolves.toEqual({
      actionReceiptId: action.id,
      outcomeKind: "workflow_run",
      workflowRunId,
      lifecycleStatus: "succeeded",
    });
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `agent-workflow:${action.id}`,
      }),
    );
    expect(transitionAction).not.toHaveBeenCalled();
    expect(completeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        outcomeReference: { kind: "workflow_run", workflowRunId },
      }),
    );
    expect(transitionRun).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "succeeded" }),
    );
  });
});

describe("Workspace default Agent readiness", () => {
  it("rejects an unconfigured model before creating a thread or queued run", async () => {
    const createThread = vi.fn();
    const createRun = vi.fn();
    const service = workspaceAgentService(
      {
        agentRuntime: { createThread, createRun },
        agentFoundation: {
          resolveSurfaceView: () =>
            Promise.resolve({
              ...surfaceView,
              profile: {
                ...surfaceView.profile,
                profileKey: "first-party.main-agent",
              },
            }),
        },
        agentProfilePublications: {
          getModelSettings: () => Promise.resolve({ options: [] }),
        },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );
    await expect(
      service.create({
        authority,
        body: { message: "Hello" },
        idempotencyKey: "unconfigured-workspace",
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.model_not_configured" });
    expect(createThread).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });
});
