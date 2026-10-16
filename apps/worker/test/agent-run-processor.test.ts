import type {
  AgentFoundationRepository,
  AgentInteractionRecord,
  AgentMessageRecord,
  AgentRunDispatchRepository,
  AgentRuntimeRepository,
  AgentSurfaceView,
  TrustedWorkspaceScope,
  WorkflowTemplate,
  WorkflowRunQueryRepository,
} from "@kanvas/application";
import {
  agentBuiltinToolViewDigest,
  createDynamicAgentToolView,
  createThreadWorkQueryToolProjection,
  createWorkflowResourceToolProjection,
  stableAgentRuntimeId,
  type KanvasAgentModelResponse,
} from "@kanvas/agent-runtime";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import {
  digestProviderValue,
  type AgentModelBindingStore,
  type BudgetReservationStore,
  type CanvasDraftStore,
  type CapabilityDefinitionAdminStore,
  type ResolvedAgentModelBinding,
  type WorkspaceContentQueryStore,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  AgentRunProcessor,
  agentThreadTitleFromModelResponse,
  agentWebSearchQuery,
  agentWebSearchAnswer,
  classifyAgentModelFailure,
  prepareAgentQuestionResume,
  resolvePinnedSkillCanvasArtifact,
  shouldGenerateAgentThreadTitle,
} from "../src/agent/agent-run-processor.js";

const now = new Date("2026-08-24T20:00:00.000Z");
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
  effectivePermissions: [
    "agent.run",
    "skill.read",
    "skill.use",
    "workflow.read",
    "workflow.run",
  ],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

const view = {
  profile: {
    id: "01K00000000000000000000005",
    workspaceId: authority.workspaceId,
    agentDefinitionId: "01K0000000000000000000000H",
    profileKey: "workspace-profile",
    revision: 1,
    canonicalDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manifest: {
      schemaVersion: 1,
      displayName: "Workspace Profile",
      modelBindingKey: "workspace-agent-model",
      instructions: "Use only runtime-resolved Skills and Tools.",
      allowedSurfaceKinds: ["workspace_home"],
      allowedToolFamilies: ["query", "workflow"],
      requiredToolFamilies: ["workflow"],
      skillPolicy: {
        maximumCatalogItems: 20,
        maximumActivatedInstructionBytes: 262_144,
        maximumReferenceReadBytes: 262_144,
      },
      runLimits: {
        maximumModelCalls: 4,
        maximumToolCalls: 2,
        timeoutSeconds: 180,
      },
    },
  },
  skills: [
    {
      skillDefinitionId: "01K0000000000000000000000J",
      skillRevisionId: "01K00000000000000000000006",
      skillKey: "workspace.runtime-skill",
      skillName: "workspace-runtime-skill",
      revision: 1,
      bound: true,
      displayName: "Runtime Skill",
      summary: "Prepares one result from the supplied brief.",
      exampleRequests: ["Prepare a campaign result."],
      toolFamilies: ["query", "workflow"],
      canonicalDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      instructionResource: {
        resourcePath: "SKILL.md",
        storedObjectId: "01K00000000000000000000007",
        storageProfileId: "01K00000000000000000000008",
        container: "skills",
        objectKey: "runtime/SKILL.md",
        sha256: "c".repeat(64),
        immutableIdentityHash:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        contentDigest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        mediaType: "text/markdown",
        byteSize: "128",
      },
      referenceResources: [],
      entrypoints: [
        {
          entrypointKey: "prepare",
          workflowRevisionId: "01K00000000000000000000009",
          displayName: "Prepare result",
          description: "Prepare a reviewable result from the supplied brief.",
          inputSchema: {
            type: "object",
            required: ["brief"],
            properties: { brief: { type: "string" } },
          },
        },
      ],
    },
  ],
  boundBrands: [],
  boundWorkflows: [],
  skillViewDigest:
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
} as const satisfies AgentSurfaceView;

const toolViewDigest = agentBuiltinToolViewDigest(
  digestProviderValue,
  createDynamicAgentToolView({
    surfaceView: view,
    projections: [
      createThreadWorkQueryToolProjection(
        {
          inspect: () => Promise.resolve({ modelOutput: { tasks: [] } }),
          search: () => Promise.resolve({ modelOutput: { answer: "unused" } }),
        },
        { includeArtifacts: false },
      ),
      createWorkflowResourceToolProjection({
        surfaceView: view,
        eligibleWorkflowRevisionIds: new Set(["01K00000000000000000000009"]),
        executor: {
          search: () => Promise.resolve({ modelOutput: { workflows: [] } }),
          inspect: () => Promise.resolve({ modelOutput: { workflow: {} } }),
          propose: () => Promise.resolve({ modelOutput: {} }),
        },
      }),
    ],
    digest: digestProviderValue,
  }).toolViewDigest,
);

const workflowTemplate = {
  workflowDefinitionId: "01K0000000000000000000000K",
  workflowRevisionId: "01K00000000000000000000009",
  workflowKey: "campaign.prepare",
  revision: 1,
  displayName: "Prepare result",
  description: "Prepare a reviewable result from the supplied brief.",
  canonicalDigest:
    "sha256:9999999999999999999999999999999999999999999999999999999999999999",
  runtimeStatus: "enabled",
  topology: { schemaVersion: 1, key: "campaign-prepare", nodes: [] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["brief"],
    properties: { brief: { type: "string" } },
  },
  outputSchema: { type: "object" },
  publishedAt: now,
} as unknown as WorkflowTemplate;

function binding(): ResolvedAgentModelBinding {
  return {
    snapshot: {
      routeDigest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      pricingRevisionId: "01K0000000000000000000000A",
    },
    endpoint: {
      id: "01K0000000000000000000000B",
      adapterKind: "openai_compatible",
      presetKind: "none",
      baseUrl: "https://provider.example/v1",
    },
    apiSurface: "chat.completions.v1",
    protocolKind: "openai_chat",
    providerModelId: "runtime-model",
    modelProfile: {},
    pricing: {
      schemaVersion: 1,
      billingMode: "fixed",
      fixedChargeAmount: "0.01",
      evidence: {
        priceVerified: true,
        sourceKind: "provider_api",
        sourceReference: "provider.billing.response",
        observedAt: now.toISOString(),
        sourceDigest:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      },
    },
    budgetAccountId: "01K0000000000000000000000C",
    maximumCharge: { currencyCode: "USD", amount: "1" },
    secret: {} as never,
    executionDeadlineAt: new Date(now.getTime() + 60_000),
  };
}

describe("AgentRunProcessor", () => {
  it("materializes only the exact image Artifact from a Skill pinned to this Run", async () => {
    const baseSkill = view.skills[0];
    const skill = {
      ...baseSkill,
      referenceResources: [
        {
          ...baseSkill.instructionResource,
          relativePath: "brand/vertical-frame.png",
          resourcePath: "assets/brand/vertical-frame.png",
          mediaType: "image/png",
        },
        {
          ...baseSkill.instructionResource,
          relativePath: "brand/reference-frame.png",
          resourcePath: "references/brand/reference-frame.png",
          mediaType: "image/png",
        },
        {
          ...baseSkill.instructionResource,
          relativePath: "scripts/hidden.png",
          resourcePath: "scripts/hidden.png",
          mediaType: "image/png",
        },
      ],
    };
    const runId = "01K0000000000000000000000L";
    const artifactId = stableAgentRuntimeId(
      "skill-image",
      `${authority.workspaceId}:${skill.skillRevisionId}:assets/brand/vertical-frame.png`,
      1,
    );
    const assertSkillUsable = vi.fn(() => Promise.resolve());
    const materializeRunImage = vi.fn(() => Promise.resolve(artifactId));
    const options = {
      authority,
      runId,
      skills: [skill],
      assertSkillUsable,
      materializeRunImage,
      skillRevisionId: skill.skillRevisionId,
      skillResourcePath: "assets/brand/vertical-frame.png",
      artifactId,
      now,
    };

    await expect(resolvePinnedSkillCanvasArtifact(options)).resolves.toEqual({
      id: artifactId,
      mediaType: "image/png",
      displayFilename: "vertical-frame.png",
    });
    expect(materializeRunImage).toHaveBeenCalledWith({
      authority,
      runId,
      skillRevisionId: skill.skillRevisionId,
      path: "assets/brand/vertical-frame.png",
      artifactId,
      now,
    });
    expect(assertSkillUsable).toHaveBeenCalledWith({
      authority,
      skillRevisionId: skill.skillRevisionId,
      now,
    });

    for (const invalid of [
      { artifactId: "01K0000000000000000000000M" },
      { skillRevisionId: "01K0000000000000000000000N" },
      { skillResourcePath: "assets/brand/missing.png" },
      { skillResourcePath: "brand/reference-frame.png" },
      {
        skillResourcePath: "references/../assets/brand/vertical-frame.png",
      },
      { skillResourcePath: "scripts/hidden.png" },
    ]) {
      await expect(
        resolvePinnedSkillCanvasArtifact({ ...options, ...invalid }),
      ).rejects.toMatchObject({ code: "agent.result_not_linked" });
    }
    expect(assertSkillUsable).toHaveBeenCalledOnce();
    expect(materializeRunImage).toHaveBeenCalledOnce();
  });

  it("fails closed when the pinned Skill image cannot be reauthorized", async () => {
    const baseSkill = view.skills[0];
    const skill = {
      ...baseSkill,
      referenceResources: [
        {
          ...baseSkill.instructionResource,
          relativePath: "brand/logo.png",
          resourcePath: "assets/brand/logo.png",
          mediaType: "image/png",
        },
      ],
    };
    const artifactId = stableAgentRuntimeId(
      "skill-image",
      `${authority.workspaceId}:${skill.skillRevisionId}:assets/brand/logo.png`,
      1,
    );
    const assertSkillUsable = vi.fn(() =>
      Promise.reject(new Error("current Skill use was revoked")),
    );
    const materializeRunImage = vi.fn(() => Promise.resolve(artifactId));

    await expect(
      resolvePinnedSkillCanvasArtifact({
        authority,
        runId: "01K0000000000000000000000L",
        skills: [skill],
        assertSkillUsable,
        materializeRunImage,
        skillRevisionId: skill.skillRevisionId,
        skillResourcePath: "assets/brand/logo.png",
        artifactId,
        now,
      }),
    ).rejects.toMatchObject({ code: "agent.result_unavailable" });
    expect(assertSkillUsable).toHaveBeenCalledOnce();
    expect(materializeRunImage).not.toHaveBeenCalled();
  });

  it("replaces a persisted question card with its exact answered Tool result", () => {
    const questionRequest = {
      schemaVersion: 1,
      kind: "question",
      questions: [
        {
          key: "skill_name",
          header: "Skill name",
          question: "Which Skill name should be used?",
          options: [
            {
              key: "internal-notice-writer",
              label: "Internal notice writer",
            },
            { key: "event-writer", label: "Event writer" },
          ],
        },
      ],
    } as const;
    const toolCallId = "question-call-resolved";
    const userMessage = {
      id: "01K0000000000000000000000L",
      workspaceId: authority.workspaceId,
      threadId: "01K0000000000000000000000M",
      agentRunId: "01K0000000000000000000000N",
      sequenceNumber: 1,
      message: {
        schemaVersion: 1,
        role: "user",
        parts: [{ type: "text", text: "Create a reusable Skill." }],
      },
      createdAt: now,
    } as const satisfies AgentMessageRecord;
    const questionMessage = {
      ...userMessage,
      id: "01K0000000000000000000000P",
      sequenceNumber: 2,
      message: {
        schemaVersion: 1,
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId, toolName: "ask_question" }],
      },
    } as const satisfies AgentMessageRecord;
    const interaction = {
      id: "01K0000000000000000000000Q",
      workspaceId: authority.workspaceId,
      threadId: userMessage.threadId,
      agentRunId: userMessage.agentRunId,
      assistantMessageId: questionMessage.id,
      interactionNumber: 1,
      toolCallId,
      toolKey: "builtin.ask-question",
      lifecycleStatus: "submitted",
      request: questionRequest,
      response: {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [
          {
            questionKey: "skill_name",
            optionKeys: ["internal-notice-writer"],
          },
        ],
      },
      checkpoint: {
        schemaVersion: 1,
        adapter: "mastra-message-list-v2",
        toolCallId,
        toolName: "ask_question",
        toolCallCount: 1,
        continuationMessages: [
          {
            id: "mastra-question-message",
            role: "assistant",
            content: {
              format: 2,
              parts: [
                {
                  type: "tool-invocation",
                  toolInvocation: {
                    state: "call",
                    toolCallId,
                    toolName: "ask_question",
                    args: { questions: questionRequest.questions },
                  },
                },
              ],
            },
          },
        ],
      },
      requestDigest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      responseDigest:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      checkpointDigest:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      resolutionRequestKey: "question-resolution",
      resolvedByPrincipalId: authority.principalId,
      version: 2,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    } as const satisfies AgentInteractionRecord;

    const prepared = prepareAgentQuestionResume(
      [userMessage, questionMessage],
      [interaction],
    );

    expect(prepared.conversationMessages.map((message) => message.id)).toEqual([
      userMessage.id,
    ]);
    expect(prepared.continuation?.answeredQuestions).toEqual([
      {
        questionKey: "skill_name",
        question: "Which Skill name should be used?",
        selectedOptionKeys: ["internal-notice-writer"],
      },
    ]);
    expect(JSON.stringify(prepared.continuation?.messages)).toContain(
      '"label":"Internal notice writer"',
    );
    expect(JSON.stringify(prepared.continuation?.messages)).toContain(
      '"state":"result"',
    );
  });

  it("accepts only one concise title from the title generator", () => {
    expect(
      agentThreadTitleFromModelResponse({
        content: [{ type: "text", text: '标题："夏日会员微度假"\n说明' }],
        finishReason: "stop",
      }),
    ).toBe("夏日会员微度假");
    expect(
      agentThreadTitleFromModelResponse({
        content: [{ type: "text", text: "当然，以下是完整回答" }],
        finishReason: "stop",
      }),
    ).toBeUndefined();
    expect(
      agentThreadTitleFromModelResponse({
        content: [{ type: "text", text: "Generate a" }],
        finishReason: "length",
      }),
    ).toBeUndefined();
  });

  it("only generates a title for the first user message", () => {
    const user = {
      sequenceNumber: 1,
      message: {
        schemaVersion: 1 as const,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "First message" }],
      },
    };
    expect(shouldGenerateAgentThreadTitle([user])).toBe(true);
    expect(shouldGenerateAgentThreadTitle([user], "parent-run")).toBe(false);
    expect(
      shouldGenerateAgentThreadTitle([
        user,
        {
          sequenceNumber: 2,
          message: {
            schemaVersion: 1,
            role: "assistant",
            parts: [{ type: "text", text: "Existing response" }],
          },
        },
      ]),
    ).toBe(false);
  });

  it.each([
    "length",
    "content-filter",
    "error",
    "tool-calls",
    "other",
  ] as const)(
    "rejects incomplete search text (%s) before publishing it as evidence",
    (finishReason) => {
      expect(() =>
        agentWebSearchAnswer({
          content: [
            { type: "text", text: "A plausible but incomplete answer" },
          ],
          finishReason,
        }),
      ).toThrow("Web search did not complete.");
    },
  );
  it("accepts complete search text and rejects empty answers", () => {
    expect(
      agentWebSearchAnswer({
        content: [{ type: "text", text: " Verified answer " }],
        finishReason: "stop",
      }),
    ).toBe("Verified answer");
    expect(() =>
      agentWebSearchAnswer({ content: [], finishReason: "stop" }),
    ).toThrow("Web search returned no answer.");
  });

  it("canonically validates bounded web search input", () => {
    expect(agentWebSearchQuery({ query: "  current release  " })).toBe(
      "current release",
    );
    expect(() => agentWebSearchQuery({ query: "" })).toThrow(
      "Web search query is invalid.",
    );
    expect(() => agentWebSearchQuery({ query: "x".repeat(501) })).toThrow(
      "Web search query is invalid.",
    );
    expect(agentWebSearchQuery({}, "  current user request  ")).toBe(
      "current user request",
    );
    expect(() => agentWebSearchQuery({})).toThrow(
      "Web search query is invalid.",
    );
    expect(() =>
      agentWebSearchQuery({ unexpected: "query" }, "fallback"),
    ).toThrow("Web search query is invalid.");
  });

  it("preserves a safe Provider transport reason from stableErrorCode", () => {
    expect(
      classifyAgentModelFailure({
        stableErrorCode: "provider.transport_dns_failed",
        effect: "not_started",
      }),
    ).toEqual({
      status: "failed",
      stableReasonCode: "agent.model_provider_transport_dns_failed",
    });
  });

  it("classifies transient Skill storage failures as runtime availability", () => {
    expect(
      classifyAgentModelFailure({ code: "s3_storage.provider_failure" }),
    ).toEqual({
      status: "failed",
      stableReasonCode: "agent.runtime_storage_unavailable",
    });
  });

  it("classifies a database lock conflict as retryable before Provider work", () => {
    expect(
      classifyAgentModelFailure({
        code: "ER_LOCK_DEADLOCK",
        errno: 1213,
        sqlState: "40001",
      }),
    ).toEqual({
      status: "failed",
      stableReasonCode: "agent.model_binding_preparation_conflict",
      retryableBeforeProviderRequest: true,
    });
  });

  it("preserves a safe credential classification through an error cause", () => {
    expect(
      classifyAgentModelFailure(
        new Error("route resolution failed", {
          cause: Object.assign(new Error("secret unavailable"), {
            code: "secret_version.pinned_unavailable",
          }),
        }),
      ),
    ).toEqual({
      status: "failed",
      stableReasonCode: "agent.model_binding_credential_unavailable",
    });
  });

  it.each([
    "I prepared a production proposal for your confirmation.",
    `${"完整方案内容。".repeat(1500)}END-OF-RESPONSE`,
  ])(
    "persists the full main response independently of title preparation (%#)",
    async (finalText) => {
      const runCreatedAt = new Date("2026-08-23T23:59:59.000Z");
      const run = {
        id: "01K0000000000000000000000D",
        workspaceId: authority.workspaceId,
        threadId: "01K0000000000000000000000E",
        triggerMessageId: "01K0000000000000000000000F",
        actorPrincipalId: authority.principalId,
        lifecycleStatus: "running",
        contextSnapshot: {
          schemaVersion: 1,
          surfaceKind: "agent_workspace",
          selectedElementKeys: [],
          selectedArtifactIds: Array.from(
            { length: 24 },
            (_, index) => `01K${String(1000 + index).padStart(23, "0")}`,
          ),
          surfaceState: {
            kind: "agent_workspace",
            originSurface: "agent",
            attachmentState: "present",
            attachedResourceIds: ["01K0000000000000000000000I"],
            canUndo: false,
            canRedo: false,
          },
        },
        toolViewDigest,
        promptRevision: "workspace-agent-v1",
        maximumModelCalls: 4,
        maximumToolCalls: 2,
        foundationContext: {
          schemaVersion: 1,
          profileRevisionId: view.profile.id,
          profileCanonicalDigest: view.profile.canonicalDigest,
          skillViewDigest: view.skillViewDigest,
          skills: [
            {
              skillRevisionId: view.skills[0].skillRevisionId,
              canonicalDigest: view.skills[0].canonicalDigest,
              instructionResourceDigest:
                view.skills[0].instructionResource.contentDigest,
              entrypointWorkflowRevisionIds: [
                view.skills[0].entrypoints[0].workflowRevisionId,
              ],
            },
          ],
        },
        version: 2,
        executionDeadlineAt: new Date(now.getTime() + 60_000),
        createdAt: runCreatedAt,
        updatedAt: now,
      } as const;
      const completeDispatch = vi.fn(() => Promise.resolve());
      const dispatch = {
        cancel: () => Promise.reject(new Error("unused")),
        claimNext: () =>
          Promise.resolve({
            workerId: "agent-worker-test",
            claimTokenDigest:
              "sha256:3333333333333333333333333333333333333333333333333333333333333333",
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            authority,
            run,
            modelBindingKey: "workspace-agent-model",
            fastModelBindingKey: "workspace-fast-model",
            modelControls: {
              reasoningLevel: "medium",
              webSearchMode: "off",
            },
          }),
        heartbeat: () => Promise.resolve(),
        complete: completeDispatch,
      } satisfies AgentRunDispatchRepository;
      const appendAssistantMessage = vi.fn<
        AgentRuntimeRepository["appendAssistantMessage"]
      >(() => Promise.resolve());
      const transitionRun = vi.fn<AgentRuntimeRepository["transitionRun"]>(
        (options) =>
          Promise.resolve({
            ...run,
            lifecycleStatus: options.toStatus,
            version: options.expectedVersion + 1,
          }),
      );
      const settleRun = vi.fn<AgentRuntimeRepository["settleRun"]>(() =>
        Promise.resolve({
          ...run,
          lifecycleStatus: "waiting_approval",
          version: run.version + 1,
        }),
      );
      const recordActionPreview = vi.fn<
        AgentRuntimeRepository["recordActionPreview"]
      >((options) =>
        Promise.resolve({
          id: options.actionReceiptId,
          workspaceId: authority.workspaceId,
          agentRunId: run.id,
          actionNumber: 1,
          toolCallId: "agent-tool-call",
          toolKey: "workflow.propose",
          effect: "compute",
          approvalMode: "before_commit",
          lifecycleStatus: "waiting_approval",
          inputDigest:
            "sha256:6666666666666666666666666666666666666666666666666666666666666666",
          outputDigest: options.outputDigest,
          proposalDocument: options.proposalDocument,
          version: options.expectedVersion + 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const modelCalls = new Map<string, number>();
      const autoRenameThread = vi.fn(() => Promise.resolve({} as never));
      let markTitlePreparationStarted!: () => void;
      const titlePreparationStarted = new Promise<void>((resolve) => {
        markTitlePreparationStarted = resolve;
      });
      let releaseTitlePreparation!: () => void;
      const titlePreparationGate = new Promise<void>((resolve) => {
        releaseTitlePreparation = resolve;
      });
      const facts = {
        createThread: () => Promise.reject(new Error("unused")),
        autoRenameThread,
        renameThread: () => Promise.reject(new Error("unused")),
        archiveThread: () => Promise.reject(new Error("unused")),
        listThreads: () => Promise.resolve({ items: [] }),
        getThread: () => Promise.resolve(undefined),
        getThreadMemory: () => Promise.resolve(undefined),
        saveThreadMemory: () => Promise.reject(new Error("unused")),
        startRun: () => Promise.reject(new Error("unused")),
        recordSkillUse: () => Promise.resolve(),
        recordCanvasExport: () => Promise.reject(new Error("unused")),
        regenerateRun: () => Promise.reject(new Error("unused")),
        selectThreadBranch: () => Promise.reject(new Error("unused")),
        getRun: () => Promise.resolve(run),
        getRunDiagnostics: () => Promise.resolve(undefined),
        getAssistantMessage: () => Promise.resolve(undefined),
        listThreadMessages: () => Promise.resolve([]),
        listRunMessages: () =>
          Promise.resolve([
            {
              id: "01K0000000000000000000000F",
              workspaceId: authority.workspaceId,
              threadId: run.threadId,
              agentRunId: run.id,
              sequenceNumber: 1,
              message: {
                schemaVersion: 1,
                role: "user",
                parts: [{ type: "text", text: "Prepare a campaign result." }],
                referencedResources: [
                  {
                    kind: "workflow_definition",
                    resourceId: workflowTemplate.workflowRevisionId,
                    displayName: "Prepare result",
                  },
                ],
              },
              createdAt: now,
            },
          ]),
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
        suspendForInteraction: () => Promise.reject(new Error("unused")),
        resolveInteraction: () => Promise.reject(new Error("unused")),
        transitionRun,
        settleRun,
        beginModelCall: async (options) => {
          if (options.purpose === "thread_title") {
            markTitlePreparationStarted();
            await titlePreparationGate;
          }
          modelCalls.set(options.modelCallId, options.callNumber);
          return {
            id: options.modelCallId,
            workspaceId: authority.workspaceId,
            agentRunId: run.id,
            callNumber: options.callNumber,
            purpose: options.purpose,
            lifecycleStatus: "pending",
            modelProfileKey: options.modelProfileKey,
            inputDigest: options.inputDigest,
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
        },
        startModelAttempt: (options) =>
          Promise.resolve({
            id: options.attemptId,
            workspaceId: authority.workspaceId,
            agentModelCallId: options.modelCallId,
            attemptNumber: options.attemptNumber,
            transitionKind: options.transitionKind,
            lifecycleStatus: "running",
            routeSnapshot: options.routeSnapshot,
            routeDigest: digestProviderValue(options.routeSnapshot),
            accepted: false,
            createdAt: now,
            startedAt: now,
          }),
        completeModelAttempt: (options) =>
          Promise.resolve({
            call: {
              id: options.modelCallId,
              workspaceId: authority.workspaceId,
              agentRunId: run.id,
              callNumber: modelCalls.get(options.modelCallId) ?? 1,
              purpose: "plan",
              lifecycleStatus:
                options.status === "succeeded" ? "succeeded" : "failed",
              modelProfileKey: "workspace-agent-model",
              inputDigest:
                "sha256:4444444444444444444444444444444444444444444444444444444444444444",
              version: 2,
              createdAt: now,
              updatedAt: now,
            },
            attempt: {
              id: options.attemptId,
              workspaceId: authority.workspaceId,
              agentModelCallId: options.modelCallId,
              attemptNumber: 1,
              transitionKind: "initial",
              lifecycleStatus: options.status,
              routeSnapshot: {},
              routeDigest:
                "sha256:5555555555555555555555555555555555555555555555555555555555555555",
              accepted: options.status === "succeeded",
              createdAt: now,
              completedAt: now,
            },
          }),
        appendAssistantMessage,
        proposeAction: (options) =>
          Promise.resolve({
            id: options.actionReceiptId,
            workspaceId: authority.workspaceId,
            agentRunId: run.id,
            actionNumber: options.actionNumber,
            toolCallId: options.toolCallId,
            toolKey: options.toolKey,
            effect: options.effect,
            approvalMode: options.approvalMode,
            lifecycleStatus: "proposed",
            inputDigest: options.inputDigest,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
        transitionAction: (options) =>
          Promise.resolve({
            id: "01K0000000000000000000000H",
            workspaceId: authority.workspaceId,
            agentRunId: run.id,
            actionNumber: 1,
            toolCallId: "agent-tool-call",
            toolKey: "workflow.propose",
            effect: "compute",
            approvalMode: "before_commit",
            lifecycleStatus: options.toStatus,
            inputDigest:
              "sha256:6666666666666666666666666666666666666666666666666666666666666666",
            version: options.expectedVersion + 1,
            createdAt: now,
            updatedAt: now,
          }),
        completeAction: () => Promise.reject(new Error("unused")),
        recordActionPreview,
        declinePendingAction: () => Promise.reject(new Error("unused")),
        getAction: () => Promise.resolve(undefined),
        listRunActions: () => Promise.resolve([]),
      } satisfies AgentRuntimeRepository;
      const resolveBinding = vi.fn<AgentModelBindingStore["resolve"]>(
        (options) =>
          options.bindingKey === "workspace-fast-model"
            ? Promise.reject(
                Object.assign(new Error("title credential unavailable"), {
                  code: "secret_version.pinned_unavailable",
                }),
              )
            : Promise.resolve(binding()),
      );
      const bindings = {
        configure: () => Promise.reject(new Error("unused")),
        disable: () => Promise.reject(new Error("unused")),
        resolve: resolveBinding,
      } satisfies AgentModelBindingStore;
      const budgets = {
        reserve: (options) =>
          Promise.resolve({
            status: "reserved" as const,
            reservationId: options.reservationId,
            lifecycleStatus: "reserved" as const,
            reservedAmount: options.maximumChargeAmount,
            accountVersion: 2,
          }),
        finalize: (options) =>
          Promise.resolve({
            status: "finalized" as const,
            reservationId: options.reservationId,
            lifecycleStatus:
              options.kind === "capture"
                ? ("settled" as const)
                : ("released" as const),
            settledAmount:
              options.kind === "capture"
                ? (options.capturedAmount ?? "0")
                : null,
            unknownHoldAmount: null,
            accountVersion: 3,
          }),
        resolveUnknown: () => Promise.reject(new Error("unused")),
      } satisfies BudgetReservationStore;
      const mainResponses = [
        {
          content: [
            {
              type: "text" as const,
              text: "I will inspect the available tools.",
            },
            ...[1, 2, 3].map((ordinal) => ({
              type: "tool-call" as const,
              toolCallId: `skill-search-${ordinal}`,
              toolName: "skill_search",
              input: JSON.stringify({ query: `campaign ${ordinal}` }),
            })),
            {
              type: "reasoning" as const,
              text: " \n",
            },
            {
              type: "tool-call" as const,
              toolCallId: "provider-tool-call-1",
              toolName: "workflow.propose",
              input: JSON.stringify({
                workflowRevisionId: workflowTemplate.workflowRevisionId,
                input: { brief: "Prepare a campaign result." },
              }),
            },
          ],
          finishReason: "tool-calls" as const,
        },
        {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "provider-search-call-1",
              toolName: "",
              input: "{}",
            },
            {
              type: "text" as const,
              text: finalText,
            },
          ],
          finishReason: "stop" as const,
        },
      ];
      const nextModelResponse = (
        request: unknown,
      ): KanvasAgentModelResponse => ({
        ...(JSON.stringify(request).includes("title generator")
          ? {
              content: [{ type: "text" as const, text: "Campaign proposal" }],
              finishReason: "stop" as const,
            }
          : (mainResponses.shift() ?? {
              content: [],
              finishReason: "stop" as const,
            })),
        usage: { inputTokens: 20, outputTokens: 10 },
      });
      const modelStream = (
        response: KanvasAgentModelResponse,
      ): ReadableStream<LanguageModelV3StreamPart> =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            response.content.forEach((part, index) => {
              const id = `${part.type}-${String(index)}`;
              if (part.type === "text") {
                controller.enqueue({ type: "text-start", id });
                controller.enqueue({
                  type: "text-delta",
                  id,
                  delta: part.text,
                });
                controller.enqueue({ type: "text-end", id });
              } else if (part.type === "reasoning") {
                controller.enqueue({ type: "reasoning-start", id });
                controller.enqueue({
                  type: "reasoning-delta",
                  id,
                  delta: part.text,
                });
                controller.enqueue({ type: "reasoning-end", id });
              } else {
                controller.enqueue({ ...part, input: part.input });
              }
            });
            controller.enqueue({
              type: "finish",
              usage: {
                inputTokens: {
                  total: response.usage?.inputTokens,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: response.usage?.outputTokens,
                  text: response.usage?.outputTextTokens,
                  reasoning: response.usage?.reasoningTokens,
                },
              },
              finishReason: {
                unified: response.finishReason,
                raw: response.rawFinishReason,
              },
            });
            controller.close();
          },
        });
      const streamedRequests: unknown[] = [];
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const processor = new AgentRunProcessor({
        workerId: "agent-worker-test",
        logger,
        dispatch,
        foundations: {
          resolveSurfaceView: () => Promise.resolve(view),
          assertSkillUsable: () => Promise.resolve(),
        } satisfies AgentFoundationRepository,
        facts,
        bindings,
        budgets,
        canvasDrafts: {
          list: () => Promise.reject(new Error("unused")),
          get: () => Promise.reject(new Error("unused")),
          create: () => Promise.reject(new Error("unused")),
          getRevision: () => Promise.reject(new Error("unused")),
          recoverMutation: () => Promise.reject(new Error("unused")),
          listRevisions: () => Promise.reject(new Error("unused")),
          restore: () => Promise.reject(new Error("unused")),
          update: () => Promise.reject(new Error("unused")),
          updateBrand: () => Promise.reject(new Error("unused")),
        } satisfies CanvasDraftStore,
        capabilities: {
          searchAgentCatalog: () => Promise.resolve([]),
        } as unknown as CapabilityDefinitionAdminStore,
        workflowCatalog: {
          list: () => Promise.resolve([workflowTemplate]),
          get: (_authority, workflowRevisionId) =>
            Promise.resolve(
              workflowRevisionId === workflowTemplate.workflowRevisionId
                ? workflowTemplate
                : undefined,
            ),
        },
        workflowRuns: {} as WorkflowRunQueryRepository,
        content: {} as WorkspaceContentQueryStore,
        inputArtifactResolver: {
          bind: () => ({
            open: () =>
              Promise.resolve({
                artifactId: "01K0000000000000000000000H",
                storedObjectId: "01K0000000000000000000000J",
                artifactType: "image.source",
                dataClassification: "internal",
                displayFilename: "canary.png",
                byteSize: "4",
                sha256:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                mediaType: "image/png",
                createProviderReadUrl: () =>
                  Promise.reject(
                    new Error(
                      "Expiring links must not enter persisted model history",
                    ),
                  ),
                body: {
                  async *[Symbol.asyncIterator]() {
                    yield await Promise.resolve(Uint8Array.of(1, 2, 3, 4));
                  },
                },
              }),
          }),
        },
        transport: {
          generate: ({ request }) =>
            Promise.resolve(nextModelResponse(request.prompt)),
          stream: ({ request }) => {
            streamedRequests.push(request);
            return Promise.resolve({
              stream: modelStream(nextModelResponse(request.prompt)),
            });
          },
        },
        instructions: {
          load: () =>
            Promise.resolve({
              skillRevisionId: view.skills[0].skillRevisionId,
              displayName: view.skills[0].displayName,
              contentDigest: view.skills[0].instructionResource.contentDigest,
              markdown:
                "Use the published Workflow only after inputs are valid.",
            }),
          loadReference: () => Promise.resolve(null),
          loadImage: () => Promise.reject(new Error("unused")),
        },
        nextId: () => "01K0000000000000000000000G",
        now: () => now,
        leaseDurationMs: 60_000,
        heartbeatIntervalMs: 10_000,
      });

      const processing = processor.processNext();
      await titlePreparationStarted;
      await vi.waitFor(() => {
        expect(settleRun).toHaveBeenCalled();
        expect(completeDispatch).toHaveBeenCalledOnce();
      });
      await expect(processing).resolves.toBe(true);
      expect(autoRenameThread).not.toHaveBeenCalled();
      releaseTitlePreparation();
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "agent.auxiliary.failed",
            operation: "thread_title",
            errorCode: "agent.model_binding_credential_unavailable",
          }),
          "Agent auxiliary operation failed.",
        );
      });
      const assistantMessage =
        appendAssistantMessage.mock.lastCall?.[0].message;
      expect(assistantMessage?.role).toBe("assistant");
      expect(
        appendAssistantMessage.mock.lastCall?.[0].modelMessages,
      ).toMatchObject({
        schemaVersion: 1,
        adapter: "mastra-message-list-v2",
      });
      expect(
        Array.isArray(
          appendAssistantMessage.mock.lastCall?.[0].modelMessages?.messages,
        ),
      ).toBe(true);
      expect(assistantMessage?.parts).not.toContainEqual(
        expect.objectContaining({ type: "reasoning" }),
      );
      expect(
        JSON.stringify(
          appendAssistantMessage.mock.lastCall?.[0].modelMessages,
        ).match(/AQIDBA==/gu),
      ).toHaveLength(24);
      expect(JSON.stringify(streamedRequests[0])).not.toContain(
        "signed-canary",
      );
      expect(JSON.stringify(streamedRequests[0])).toContain(
        "current UTC date for this Run is 2026-08-23",
      );
      expect(JSON.stringify(streamedRequests[0])).not.toContain(
        "current UTC date for this Run is 2026-08-24",
      );
      expect(assistantMessage?.parts).toContainEqual({
        type: "tool-call",
        toolCallId: "provider-tool-call-1",
        toolName: "workflow.propose",
      });
      expect(assistantMessage?.parts).not.toContainEqual(
        expect.objectContaining({ toolCallId: "provider-search-call-1" }),
      );
      expect(assistantMessage?.parts).toContainEqual({
        type: "text",
        text: `I will inspect the available tools.\n\n${finalText}`,
      });
      expect(settleRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: run.id,
          workerClaim: {
            workerId: "agent-worker-test",
            claimTokenDigest: expect.any(String) as string,
          },
        }),
      );
      expect(
        appendAssistantMessage.mock.invocationCallOrder.at(-1),
      ).toBeLessThan(settleRun.mock.invocationCallOrder[0]!);
      expect(
        recordActionPreview.mock.lastCall?.[0].proposalDocument,
      ).toMatchObject({
        actionRef: "workflow-catalog",
        workflowRevisionId: workflowTemplate.workflowRevisionId,
        title: "Prepare result",
        input: { brief: "Prepare a campaign result." },
      });
      expect(
        [...modelCalls.values()].sort((left, right) => left - right),
      ).toEqual([1, 2, 3]);
      expect(resolveBinding).toHaveBeenCalledWith(
        expect.objectContaining({ bindingKey: "workspace-fast-model" }),
      );
      expect(autoRenameThread).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "agent.run.claimed",
          agentRunId: run.id,
          maximumModelCalls: 4,
          maximumToolCalls: 2,
        }),
        "Agent Run claimed.",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "agent.run.first_output_persisted",
          agentRunId: run.id,
        }),
        "Agent Run first output persisted.",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "agent.model.succeeded",
          inputTokens: 20,
          outputTokens: 10,
        }),
        "Agent model call succeeded.",
      );
    },
  );
});
