import { Agent } from "@mastra/core/agent";
import {
  createKanvasRunSkills,
  createKanvasRunSkillTools,
} from "../src/run-skills.js";
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type {
  AgentProfileRevisionRecord,
  AgentSkillCatalogItem,
} from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import {
  createKanvasMastraModel,
  type KanvasAgentModelPort,
} from "../src/kanvas-model.js";
import { GovernedAgentModelError } from "../src/governed-model-port.js";
import {
  askQuestionToolName,
  resumeAgentQuestionCheckpoint,
} from "../src/builtin-tools.js";
import {
  maximumAgentSteps,
  runKanvasSurfaceAgent,
} from "../src/surface-agent.js";

import { createCanvasCommandToolProjection } from "../src/canvas-command-tool-view.js";

const userMessageIdentity = {
  id: "persisted-user-message",
  createdAt: new Date("2025-01-02T03:04:05.000Z"),
};

describe("maximumAgentSteps", () => {
  it("honors the persisted model and tool limits without a hidden cap", () => {
    expect(
      maximumAgentSteps({ maximumModelCalls: 16, maximumToolCalls: 24 }),
    ).toBe(16);
    expect(
      maximumAgentSteps({ maximumModelCalls: 64, maximumToolCalls: 3 }),
    ).toBe(4);
    expect(
      maximumAgentSteps({ maximumModelCalls: 64, maximumToolCalls: 128 }),
    ).toBe(64);
  });
});

describe("bounded Agent completion", () => {
  it("rejects output truncation even when earlier progress text is present", async () => {
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      expect(request.maxOutputTokens).toBeUndefined();
      expect(
        request.prompt
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n"),
      ).toContain("Use the user's language for every user-visible message");
      return Promise.resolve(
        textStream("I will start the image tasks now.", "length"),
      );
    });
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: [
          { ...userMessageIdentity, role: "user", text: "生成海报" },
        ],
        surfaceContext,
        runId: "truncated-run",
      }),
    ).rejects.toMatchObject({ code: "agent.output_limit_exceeded" });
  });

  it("does not execute a tool from a truncated model step", async () => {
    const loadSkillInstructions = vi.fn(() =>
      Promise.resolve({
        skillRevisionId: skill.skillRevisionId,
        markdown: "Use the campaign method.",
      }),
    );
    let calls = 0;
    const stream: KanvasAgentModelPort["stream"] = () =>
      Promise.resolve(
        ++calls === 1
          ? toolCallStream(
              "skill",
              "truncated-skill",
              JSON.stringify({ name: skill.skillName }),
              "length",
            )
          : textStream("Done"),
      );
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [skill],
        ...noSkillRuntime,
        loadSkillInstructions,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Use the campaign Skill.",
          },
        ],
        surfaceContext,
        runId: "truncated-tool-run",
      }),
    ).rejects.toMatchObject({ code: "agent.output_limit_exceeded" });
    expect(loadSkillInstructions).not.toHaveBeenCalled();
  });

  it("reserves the last model call for an honest Tool-free reply", async () => {
    let modelCall = 0;
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      modelCall += 1;
      if (modelCall === 1) {
        expect(request.tools.length).toBeGreaterThan(0);
        return Promise.resolve(
          toolCallStream(request.tools.at(-1)!.name, "bounded-call-1"),
        );
      }
      expect(request.tools).toEqual([]);
      expect(
        request.prompt
          .flatMap((message) =>
            message.role === "system" ? [message.content] : [],
          )
          .join("\n"),
      ).toContain("final model call allowed for this Run");
      return Promise.resolve(
        textStream("The inspection is complete. No requested work remains."),
      );
    });
    const executeCanonical = vi.fn(() =>
      Promise.resolve({ modelOutput: { inspected: true } }),
    );

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile: {
          ...profile,
          manifest: {
            ...profile.manifest,
            runLimits: {
              maximumModelCalls: 2,
              maximumToolCalls: 4,
              timeoutSeconds: 180,
            },
          },
        },
        skills: [],
        ...noSkillRuntime,
        tools: [
          {
            key: "thread.inspect-work",
            description:
              "Inspect the current thread's bounded production task summary.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
            effect: "read",
            approvalMode: "none",
            executeCanonical,
            toModelOutput: (output) =>
              (output as { readonly modelOutput: unknown }).modelOutput,
          },
        ],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Inspect the current work.",
          },
        ],
        surfaceContext,
        runId: "agent-run-step-limit",
      }),
    ).resolves.toMatchObject({
      text: "The inspection is complete. No requested work remains.",
      finishReason: "stop",
    });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(executeCanonical).toHaveBeenCalledOnce();
  });

  it.each(["empty", "partial", "error"])(
    "bounds repeat discovery only for a complete empty catalog (%s)",
    async (state) => {
      let calls = 0;
      const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
        calls += 1;
        if (calls === 1)
          return Promise.resolve(
            toolCallStream("capability.search", "search-1"),
          );
        expect(
          request.tools.some((tool) => tool.name === "capability_search"),
        ).toBe(state !== "empty");
        return Promise.resolve(textStream("Discovery completed."));
      });
      await runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "test",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [
          {
            key: "capability.search",
            description: "Search capabilities",
            inputSchema: { type: "object", properties: {} },
            effect: "read",
            approvalMode: "none",
            executeCanonical: () =>
              Promise.resolve({
                modelOutput: {
                  catalogState: state,
                  catalogScope: "all",
                  complete: state !== "partial",
                  capabilities: [],
                },
              }),
            toModelOutput: (value) =>
              (value as { modelOutput: unknown }).modelOutput,
          },
        ],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Find image generation.",
          },
        ],
        surfaceContext,
        runId: "catalog-bounds",
      });
      expect(calls).toBe(2);
    },
  );

  it("disables Tools immediately when no Tool call budget remains", async () => {
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      expect(request.tools).toEqual([]);
      return Promise.resolve(
        textStream(
          "I could not run another tool. The next step is to start a new turn.",
        ),
      );
    });
    const executeCanonical = vi.fn(() =>
      Promise.resolve({ modelOutput: { inspected: true } }),
    );

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [
          {
            key: "thread.inspect-work",
            description: "Inspect work.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
            effect: "read",
            approvalMode: "none",
            executeCanonical,
            toModelOutput: (output) =>
              (output as { readonly modelOutput: unknown }).modelOutput,
          },
        ],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Inspect the current work.",
          },
        ],
        remainingRunLimits: {
          maximumModelCalls: 1,
          maximumToolCalls: 0,
        },
        surfaceContext,
        runId: "agent-run-no-tool-budget",
      }),
    ).resolves.toMatchObject({ finishReason: "stop" });
    expect(stream).toHaveBeenCalledOnce();
    expect(executeCanonical).not.toHaveBeenCalled();
  });

  it("allows a native Skill read before the reserved final reply", async () => {
    let modelCall = 0;
    const loadSkillInstructions = vi.fn(() =>
      Promise.resolve({
        skillRevisionId: skill.skillRevisionId,
        markdown: "Use the approved campaign method.",
      }),
    );
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      modelCall += 1;
      if (modelCall === 1) {
        expect(request.tools.map((tool) => tool.name)).toContain("skill");
        return Promise.resolve(
          toolCallStream(
            "skill",
            "bounded-skill-call",
            JSON.stringify({ name: skill.skillName }),
          ),
        );
      }
      expect(request.tools).toEqual([]);
      expect(JSON.stringify(request.prompt)).toContain(
        "Use the approved campaign method.",
      );
      return Promise.resolve(
        textStream("The Skill guidance is loaded; no work remains."),
      );
    });

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [skill],
        ...noSkillRuntime,
        loadSkillInstructions,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Use the campaign Skill.",
          },
        ],
        remainingRunLimits: {
          maximumModelCalls: 2,
          maximumToolCalls: 1,
        },
        surfaceContext,
        runId: "agent-run-bounded-skill-read",
      }),
    ).resolves.toMatchObject({
      text: "The Skill guidance is loaded; no work remains.",
      finishReason: "stop",
    });
    expect(loadSkillInstructions).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("classifies an empty reserved final reply as limit exhaustion", async () => {
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: {
            generate: unusedGenerate,
            stream: () => Promise.resolve(textStream("")),
          },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Finish within this call.",
          },
        ],
        remainingRunLimits: {
          maximumModelCalls: 1,
          maximumToolCalls: 0,
        },
        surfaceContext,
        runId: "agent-run-empty-final-reply",
      }),
    ).rejects.toMatchObject({ code: "agent.limit_exceeded" });
  });

  it("does not misclassify a genuine empty stop as step exhaustion", async () => {
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: {
            generate: unusedGenerate,
            stream: () => Promise.resolve(textStream("")),
          },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Return an empty response.",
          },
        ],
        surfaceContext,
        runId: "agent-run-genuine-empty",
      }),
    ).resolves.toMatchObject({ text: "", finishReason: "stop" });
  });
});

function textStream(
  text: string,
  finishReason: "stop" | "length" = "stop",
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text-0" });
        controller.enqueue({
          type: "text-delta",
          id: "text-0",
          delta: text,
        });
        controller.enqueue({ type: "text-end", id: "text-0" });
        controller.enqueue({
          type: "finish",
          usage: {
            inputTokens: {
              total: 30,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: 12,
              text: 12,
              reasoning: undefined,
            },
          },
          finishReason: { unified: finishReason, raw: finishReason },
        });
        controller.close();
      },
    }),
  };
}

function toolCallStream(
  toolName: string,
  toolCallId = "call-1",
  input = "{}",
  finishReason: "tool-calls" | "length" = "tool-calls",
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "tool-call",
          toolCallId,
          toolName,
          input,
        });
        controller.enqueue({
          type: "finish",
          usage: {
            inputTokens: {
              total: 30,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: 8,
              text: 0,
              reasoning: 8,
            },
          },
          finishReason: { unified: finishReason, raw: finishReason },
        });
        controller.close();
      },
    }),
  };
}

const unusedGenerate = () => Promise.reject(new Error("unused"));
const noSkillRuntime = {
  loadSkillInstructions: () => Promise.reject(new Error("unused")),
  loadSkillReference: () => Promise.resolve(null),
  assertSkillUsable: () => Promise.resolve(),
  recordSkillUse: () => Promise.resolve(),
  runCreatedAt: new Date("2031-02-03T23:59:59.000Z"),
} as const;

const profile = {
  id: "01K00000000000000000000001",
  workspaceId: "01K00000000000000000000002",
  agentDefinitionId: "01K00000000000000000000007",
  profileKey: "runtime-profile",
  revision: 1,
  canonicalDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  manifest: {
    schemaVersion: 1,
    displayName: "Runtime Profile",
    modelBindingKey: "workspace-agent-model",
    instructions:
      "Understand the current request using only runtime-resolved context, Skills, and Tools.",
    allowedSurfaceKinds: ["workspace_home"],
    allowedToolFamilies: ["workflow"],
    requiredToolFamilies: ["workflow"],
    skillPolicy: {
      maximumCatalogItems: 20,
      maximumActivatedInstructionBytes: 262_144,
      maximumReferenceReadBytes: 262_144,
    },
    runLimits: {
      maximumModelCalls: 8,
      maximumToolCalls: 4,
      timeoutSeconds: 180,
    },
  },
} as const satisfies AgentProfileRevisionRecord;

const skill = {
  skillDefinitionId: "01K00000000000000000000008",
  skillRevisionId: "01K00000000000000000000003",
  skillKey: "workspace.dynamic-skill",
  skillName: "workspace-dynamic-skill",
  revision: 1,
  bound: true,
  displayName: "Dynamic Skill",
  summary: "Creates one result through a Workspace-published Workflow.",
  exampleRequests: ["Prepare a campaign visual."],
  toolFamilies: ["workflow"],
  canonicalDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  instructionResource: {
    resourcePath: "SKILL.md",
    storedObjectId: "01K00000000000000000000004",
    storageProfileId: "01K00000000000000000000005",
    container: "skills",
    objectKey: "workspace.dynamic-skill/SKILL.md",
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
      workflowRevisionId: "01K00000000000000000000006",
      displayName: "Prepare result",
      description: "Prepare one result from the supplied brief.",
      inputSchema: {
        type: "object",
        required: ["brief"],
        properties: { brief: { type: "string" } },
      },
    },
  ],
} satisfies AgentSkillCatalogItem;

const surfaceContext = {
  schemaVersion: 1,
  surfaceKind: "workspace_home",
  surfaceState: {
    kind: "workspace_home",
    attachmentState: "none",
    attachedResourceIds: [],
  },
} as const;
const controls = { reasoningLevel: "medium", webSearchMode: "off" } as const;

describe("data-driven Kanvas surface Agent", () => {
  it("delivers grounded selection rules and Canvas applicability to the model", async () => {
    const unusedCanvas = vi.fn(() => Promise.resolve({ modelOutput: {} }));
    const canvas = createCanvasCommandToolProjection({
      create: unusedCanvas,
      inspect: unusedCanvas,
      editText: unusedCanvas,
      addResultImage: unusedCanvas,
      exportPng: unusedCanvas,
    });
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      const instructions = request.prompt
        .flatMap((message) =>
          message.role === "system" ? [message.content] : [],
        )
        .join("\n");
      expect(instructions).toContain(
        "current UTC date for this Run is 2031-02-03",
      );
      expect(instructions).toContain("remains unchanged if the Run resumes");
      expect(instructions).toContain(
        "Never invent unprovided organization, event, date, time, location, activity",
      );
      expect(instructions).toContain(
        "user requests placeholders, keep them explicit and do not fill them with guesses",
      );
      expect(instructions).toContain(
        "user clearly requests fiction, examples, or imaginative copy",
      );
      expect(instructions).toContain(
        "Select Tools by the user's goal and requested deliverable",
      );
      expect(instructions).toContain(
        "satisfies its applicability conditions for the current request",
      );
      for (const descriptor of canvas.descriptors) {
        const tool = request.tools?.find(
          (tool) => tool.name === descriptor.key.replaceAll(".", "_"),
        );
        expect(tool).toBeDefined();
        expect(tool).toHaveProperty("description", descriptor.description);
        expect(descriptor.description).toContain(
          "Only use when the user explicitly requests Canvas work",
        );
        expect(descriptor.description).toContain(
          "Existing Canvas context alone is insufficient",
        );
      }
      return Promise.resolve(textStream("Grounded result."));
    });

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: canvas.descriptors,
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Draft a factual event notice and retain placeholders for missing details.",
          },
        ],
        surfaceContext,
        runId: "agent-run-grounding",
      }),
    ).resolves.toMatchObject({
      text: "Grounded result.",
      finishReason: "stop",
    });
    expect(stream).toHaveBeenCalledOnce();
  });

  it("returns a durable question suspension instead of an empty response", async () => {
    const question = {
      questions: [
        {
          key: "format",
          header: "Format",
          question: "Which format should I prepare?",
          options: [
            { key: "outline", label: "Outline", recommended: true },
            { key: "draft", label: "Full draft" },
          ],
        },
      ],
    };
    const response = await runKanvasSurfaceAgent({
      model: createKanvasMastraModel({
        modelProfileKey: "workspace-agent-model",
        port: {
          generate: unusedGenerate,
          stream: () =>
            Promise.resolve(
              toolCallStream(
                askQuestionToolName,
                "question-call-1",
                JSON.stringify(question),
              ),
            ),
        },
        controls,
      }),
      profile,
      skills: [],
      ...noSkillRuntime,
      tools: [],
      conversation: [
        {
          ...userMessageIdentity,
          role: "user",
          text: "Prepare the right output.",
        },
      ],
      surfaceContext,
      runId: "agent-run-question",
    });

    expect(response).toMatchObject({
      text: "",
      finishReason: "suspended",
      suspension: {
        toolCallId: "question-call-1",
        request: { kind: "question", questions: question.questions },
        checkpoint: {
          adapter: "mastra-message-list-v2",
          toolCallCount: 1,
        },
      },
    });
  });

  it("does not offer another question after the user skips clarification", async () => {
    const question = {
      questions: [
        {
          key: "examples",
          header: "Examples",
          question: "Should examples be included?",
          options: [
            { key: "include", label: "Include", recommended: true },
            { key: "omit", label: "Omit" },
          ],
        },
      ],
    };
    const initial = await runKanvasSurfaceAgent({
      model: createKanvasMastraModel({
        modelProfileKey: "workspace-agent-model",
        port: {
          generate: unusedGenerate,
          stream: () =>
            Promise.resolve(
              toolCallStream(
                askQuestionToolName,
                "question-call-skip",
                JSON.stringify(question),
              ),
            ),
        },
        controls,
      }),
      profile,
      skills: [],
      ...noSkillRuntime,
      tools: [],
      conversation: [
        {
          ...userMessageIdentity,
          role: "user",
          text: "Prepare the right output.",
        },
      ],
      surfaceContext,
      runId: "agent-run-question-skip-initial",
    });
    if (!initial.suspension) throw new Error("Missing question suspension.");
    const continuation = resumeAgentQuestionCheckpoint(
      initial.suspension.checkpoint,
      { schemaVersion: 1, outcome: "skipped" },
    );
    const resumedStream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      expect(request.tools.map((tool) => tool.name)).not.toContain(
        askQuestionToolName,
      );
      expect(
        request.prompt
          .flatMap((message) =>
            message.role === "system" ? [message.content] : [],
          )
          .join("\n"),
      ).toContain("user skipped the clarification");
      expect(JSON.stringify(request.prompt)).toContain(
        "final model call allowed for this Run",
      );
      return Promise.resolve(
        textStream("Proceeding with reasonable defaults."),
      );
    });

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream: resumedStream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Prepare the right output.",
          },
        ],
        continuation,
        remainingRunLimits: {
          maximumModelCalls: 1,
          maximumToolCalls: 0,
        },
        surfaceContext,
        runId: "agent-run-question-skip-resumed",
      }),
    ).resolves.toMatchObject({
      text: "Proceeding with reasonable defaults.",
      finishReason: "stop",
    });
    expect(resumedStream).toHaveBeenCalledOnce();
  });

  it("treats a submitted question as resolved before continuing the same run", async () => {
    const persistedConversation = [
      {
        id: "persisted-user-message",
        role: "user" as const,
        text: "Prepare the right output.",
        createdAt: new Date("2025-01-02T03:04:05.000Z"),
      },
    ];
    const question = {
      questions: [
        {
          key: "format",
          header: "Format",
          question: "Which format should I prepare?",
          options: [
            { key: "outline", label: "Outline", recommended: true },
            { key: "draft", label: "Full draft" },
          ],
        },
      ],
    };
    const initial = await runKanvasSurfaceAgent({
      model: createKanvasMastraModel({
        modelProfileKey: "workspace-agent-model",
        port: {
          generate: unusedGenerate,
          stream: () =>
            Promise.resolve(
              toolCallStream(
                askQuestionToolName,
                "question-call-submit",
                JSON.stringify(question),
              ),
            ),
        },
        controls,
      }),
      profile,
      skills: [],
      ...noSkillRuntime,
      tools: [],
      conversation: persistedConversation,
      surfaceContext,
      runId: "agent-run-question-submit-initial",
    });
    if (!initial.suspension) throw new Error("Missing question suspension.");
    const continuation = resumeAgentQuestionCheckpoint(
      initial.suspension.checkpoint,
      {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["outline"] }],
      },
    );
    let resumedCall = 0;
    const resumedStream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      resumedCall += 1;
      if (resumedCall > 1) {
        expect(JSON.stringify(request.prompt)).toContain(
          "This question was already answered in the current Run.",
        );
        return Promise.resolve(textStream("I will prepare an outline."));
      }
      expect(request.tools.map((tool) => tool.name)).toContain(
        askQuestionToolName,
      );
      expect(
        request.prompt
          .flatMap((message) =>
            message.role === "system" ? [message.content] : [],
          )
          .join("\n"),
      ).toContain("Never reuse an answered question key");
      expect(JSON.stringify(request.prompt)).toContain('"outcome":"submitted"');
      const answeredCall = request.prompt
        .flatMap((message) =>
          message.role === "assistant" ? message.content : [],
        )
        .find(
          (part) =>
            part.type === "tool-call" &&
            part.toolCallId === "question-call-submit",
        );
      const answeredResult = request.prompt
        .flatMap((message) => (message.role === "tool" ? message.content : []))
        .find(
          (part) =>
            part.type === "tool-result" &&
            part.toolCallId === "question-call-submit",
        );
      expect(answeredCall).toMatchObject({
        type: "tool-call",
        toolName: askQuestionToolName,
      });
      expect(answeredResult).toEqual({
        type: "tool-result",
        toolCallId: "question-call-submit",
        toolName: askQuestionToolName,
        output: {
          type: "json",
          value: {
            schemaVersion: 1,
            kind: "question_response",
            outcome: "submitted",
            answers: [
              {
                questionKey: "format",
                question: "Which format should I prepare?",
                selectedOptions: [{ key: "outline", label: "Outline" }],
              },
            ],
          },
        },
      });
      const userIndex = request.prompt.findIndex(
        (message) => message.role === "user",
      );
      const callIndex = request.prompt.findIndex((message) =>
        message.role === "assistant"
          ? message.content.some(
              (part) =>
                part.type === "tool-call" &&
                part.toolCallId === "question-call-submit",
            )
          : false,
      );
      const resultIndex = request.prompt.findIndex((message) =>
        message.role === "tool"
          ? message.content.some(
              (part) =>
                part.type === "tool-result" &&
                part.toolCallId === "question-call-submit",
            )
          : false,
      );
      expect(userIndex).toBeGreaterThanOrEqual(0);
      expect(callIndex).toBeGreaterThan(userIndex);
      expect(resultIndex).toBeGreaterThan(callIndex);
      if (resultIndex !== request.prompt.length - 1) {
        throw new Error(JSON.stringify(request.prompt.slice(-3)));
      }
      return Promise.resolve(
        toolCallStream(
          askQuestionToolName,
          "question-call-repeat",
          JSON.stringify(question),
        ),
      );
    });

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream: resumedStream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: persistedConversation,
        continuation,
        surfaceContext,
        runId: "agent-run-question-submit-resumed",
      }),
    ).resolves.toMatchObject({
      text: "I will prepare an outline.",
      finishReason: "stop",
    });
    expect(resumedStream).toHaveBeenCalledTimes(2);
  });

  it("preserves actual Skill image bytes through the Mastra loop", async () => {
    let modelCall = 0;
    const stream = vi.fn<KanvasAgentModelPort["stream"]>(() =>
      Promise.resolve(
        ++modelCall === 1
          ? toolCallStream(
              "skill_read",
              "image-call",
              JSON.stringify({
                skillName: skill.skillName,
                path: "references/xxx/yyy.jpg",
              }),
            )
          : textStream("image inspected"),
      ),
    );
    await runKanvasSurfaceAgent({
      model: createKanvasMastraModel({
        modelProfileKey: "workspace-agent-model",
        port: { generate: unusedGenerate, stream },
        controls,
      }),
      profile,
      skills: [
        {
          ...skill,
          referenceResources: [
            {
              ...skill.instructionResource,
              relativePath: "xxx/yyy.jpg",
              resourcePath: "references/xxx/yyy.jpg",
              mediaType: "image/jpeg",
            },
          ],
        },
      ],
      ...noSkillRuntime,
      loadSkillImage: () =>
        Promise.resolve({
          artifactId: "01K00000000000000000000009",
          mediaType: "image/jpeg",
          data: "AQID",
        }),
      tools: [],
      conversation: [
        { ...userMessageIdentity, role: "user", text: "Inspect the logo." },
      ],
      surfaceContext,
      runId: "01K00000000000000000000010",
    });
    const results = stream.mock.calls[1]?.[0].prompt.flatMap((message) =>
      message.role === "tool" ? message.content : [],
    );
    const output = results?.find((part) => part.type === "tool-result")?.output;
    expect(output?.type).toBe("content");
    if (output?.type !== "content") throw new Error("Missing image output");
    expect(output.value).toContainEqual({
      type: "image-data",
      data: "AQID",
      mediaType: "image/jpeg",
    });
  });

  it("feeds a projected canonical tool result into the next model step", async () => {
    let modelCall = 0;
    const stream = vi.fn<KanvasAgentModelPort["stream"]>((request) => {
      modelCall += 1;
      return Promise.resolve(
        modelCall === 1
          ? toolCallStream(request.tools.at(-1)!.name)
          : textStream("There are no production tasks."),
      );
    });

    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [
          {
            key: "thread.inspect-work",
            description:
              "Inspect the current thread's bounded production task summary.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
            effect: "read",
            approvalMode: "none",
            executeCanonical: () =>
              Promise.resolve({ modelOutput: { tasks: [], taskCount: 0 } }),
            toModelOutput: (output) =>
              (output as { readonly modelOutput: unknown }).modelOutput,
          },
        ],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "How many tasks are there?",
          },
        ],
        surfaceContext,
        runId: "agent-run-tool-result",
      }),
    ).resolves.toMatchObject({
      text: "There are no production tasks.",
      finishReason: "stop",
    });

    expect(stream).toHaveBeenCalledTimes(2);
    const secondRequest = stream.mock.calls[1]?.[0];
    const toolMessage = secondRequest?.prompt.find(
      (message) => message.role === "tool",
    );
    expect(
      toolMessage?.role === "tool" ? toolMessage.content : [],
    ).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        output: {
          type: "json",
          value: { tasks: [], taskCount: 0 },
        },
      }),
    );
  });

  it("propagates governed stream failures instead of returning an empty response", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        runKanvasSurfaceAgent({
          model: createKanvasMastraModel({
            modelProfileKey: "workspace-agent-model",
            port: {
              generate: unusedGenerate,
              stream: () =>
                Promise.reject(
                  new GovernedAgentModelError(
                    "agent.model_web_search_unsupported",
                  ),
                ),
            },
            controls,
          }),
          profile,
          skills: [],
          ...noSkillRuntime,
          tools: [],
          conversation: [
            { ...userMessageIdentity, role: "user", text: "Search the web." },
          ],
          surfaceContext,
          runId: "agent-run-search-unavailable",
        }),
      ).rejects.toMatchObject({
        code: "agent.model_web_search_unsupported",
      });
    } finally {
      logged.mockRestore();
    }
  });

  it("reserves Platform Built-in Tool names from business projections", async () => {
    const stream = vi
      .fn<KanvasAgentModelPort["stream"]>()
      .mockResolvedValue(textStream("unused"));
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [
          {
            key: "ask_question",
            description:
              "A colliding business projection that must never shadow the built-in.",
            inputSchema: { type: "object", properties: {} },
            effect: "read",
            approvalMode: "none",
            executeCanonical: () => Promise.resolve({}),
          },
        ],
        conversation: [
          { ...userMessageIdentity, role: "user", text: "Prepare a layout." },
        ],
        surfaceContext,
        runId: "agent-run-reserved-tool",
      }),
    ).rejects.toMatchObject({ code: "agent.tool_view_reserved_name" });
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    new URL("https://storage.example/signed-image"),
    new Uint8Array([1, 2, 3]),
  ])(
    "passes trusted image input through Mastra to the governed model port: %s",
    async (data) => {
      const stream = vi
        .fn<KanvasAgentModelPort["stream"]>()
        .mockResolvedValue(textStream("The image has red and blue fields."));
      await runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port: { generate: unusedGenerate, stream },
          controls,
        }),
        profile,
        skills: [],
        ...noSkillRuntime,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Describe the image.",
            files: [
              {
                data,
                mediaType: "image/png",
                filename: "canary.png",
              },
            ],
          },
        ],
        surfaceContext,
        runId: "agent-run-image-input",
      });

      const request = stream.mock.lastCall?.[0];
      const user = request?.prompt.find((message) => message.role === "user");
      expect(user?.role === "user" ? user.content : []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "file",
            data,
            mediaType: "image/png",
          }),
        ]),
      );
    },
  );

  it("advertises bound Skill metadata without preloading its instructions", async () => {
    const stream = vi
      .fn<KanvasAgentModelPort["stream"]>()
      .mockResolvedValueOnce(
        textStream(
          "I can prepare the result after you provide the campaign headline.",
        ),
      );
    const port: KanvasAgentModelPort = {
      generate: unusedGenerate,
      stream,
    };
    const loadSkillInstructions = vi.fn(() =>
      Promise.resolve({
        skillRevisionId: skill.skillRevisionId,
        markdown:
          "Ask for required inputs before proposing the published Workflow.",
      }),
    );
    await expect(
      runKanvasSurfaceAgent({
        model: createKanvasMastraModel({
          modelProfileKey: "workspace-agent-model",
          port,
          controls,
        }),
        profile,
        skills: [skill],
        ...noSkillRuntime,
        loadSkillInstructions,
        tools: [],
        conversation: [
          {
            ...userMessageIdentity,
            role: "user",
            text: "Prepare a campaign visual.",
          },
        ],
        surfaceContext,
        runId: "agent-run-response",
      }),
    ).resolves.toMatchObject({
      text: "I can prepare the result after you provide the campaign headline.",
      finishReason: "stop",
    });
    expect(stream).toHaveBeenCalledOnce();
    expect(loadSkillInstructions).not.toHaveBeenCalled();
    expect(JSON.stringify(stream.mock.calls[0])).toContain(
      "workspace-dynamic-skill",
    );
    expect(JSON.stringify(stream.mock.calls[0])).not.toContain(
      "Ask for required inputs before proposing the published Workflow.",
    );
    expect(JSON.stringify(stream.mock.calls[0])).toContain(
      "Never ask the user to confirm an action in prose",
    );
    expect(JSON.stringify(stream.mock.calls[0])).toContain(
      "use the user's language and plain product wording",
    );
    expect(JSON.stringify(stream.mock.calls[0])).toContain(
      "Do not mention lifecycle, source-of-truth, implementation state, or untranslated interface terms",
    );
  });

  it("loads a Skill through Mastra and records its exact Run use", async () => {
    let modelCall = 0;
    const stream = vi
      .fn<KanvasAgentModelPort["stream"]>()
      .mockImplementation(() => {
        modelCall += 1;
        return Promise.resolve(
          modelCall === 1
            ? toolCallStream(
                "skill",
                "skill-call-1",
                JSON.stringify({ name: skill.skillName }),
              )
            : textStream("The Skill is active."),
        );
      });
    const assertSkillUsable = vi.fn(() => Promise.resolve());
    const recordSkillUse = vi.fn(() => Promise.resolve());

    await runKanvasSurfaceAgent({
      model: createKanvasMastraModel({
        modelProfileKey: "workspace-agent-model",
        port: { generate: unusedGenerate, stream },
        controls,
      }),
      profile,
      skills: [skill],
      loadSkillInstructions: () =>
        Promise.resolve({
          skillRevisionId: skill.skillRevisionId,
          markdown: "Use the published image Workflow.",
        }),
      loadSkillReference: () => Promise.resolve(null),
      assertSkillUsable,
      recordSkillUse,
      tools: [],
      conversation: [
        { ...userMessageIdentity, role: "user", text: "Generate an image." },
      ],
      surfaceContext,
      runCreatedAt: noSkillRuntime.runCreatedAt,
      runId: "agent-run-skill-activation",
    });

    expect(stream).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(stream.mock.calls[1])).toContain(
      "Use the published image Workflow.",
    );
    expect(assertSkillUsable).toHaveBeenCalledWith(skill);
    expect(recordSkillUse).toHaveBeenCalledWith(skill, "bound");
  });
});

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("two-turn native Mastra replay", () => {
  it("retains Skill results with native history, but loses them with the visible-text projection", async () => {
    const instructions =
      "REFERENCE_IDENTITY: preserve the original mascot; sourceArtifactId=01K00000000000000000000009";
    let calls = 0;
    const prompts: unknown[] = [];
    const stream: KanvasAgentModelPort["stream"] = (request) => {
      prompts.push(request.prompt);
      return Promise.resolve(
        ++calls === 1
          ? toolCallStream(
              "skill",
              "read-skill-first-turn",
              JSON.stringify({ name: skill.skillName }),
            )
          : textStream("Prepared the first poster."),
      );
    };
    const model = createKanvasMastraModel({
      modelProfileKey: "replay",
      port: { generate: unusedGenerate, stream },
      controls,
    });
    const registry = createKanvasRunSkills({
      skills: [skill],
      maximumActivatedInstructionBytes: 262144,
      maximumReferenceReadBytes: 262144,
      loadInstructions: () =>
        Promise.resolve({
          skillRevisionId: skill.skillRevisionId,
          markdown: instructions,
        }),
      loadReference: () => Promise.resolve(null),
      assertUsable: async () => {},
      recordUse: async () => {},
    });
    const makeAgent = () =>
      new Agent({
        id: "replay",
        name: "Replay",
        instructions: "Follow the request.",
        model,
        tools: createKanvasRunSkillTools(registry),
      });
    const first = await makeAgent().stream("Make the first poster", {
      maxSteps: 3,
    });
    await first.consumeStream();
    const output = await first.getFullOutput();
    expect(JSON.stringify(prompts[1])).toContain(instructions);
    const serialized = jsonRoundTrip(output.messages);
    const second = await makeAgent().stream(
      [
        ...serialized,
        { role: "user", content: "Make the next poster with the same mascot" },
      ],
      { maxSteps: 1 },
    );
    await second.consumeStream();
    expect(JSON.stringify(prompts.at(-1))).toContain(instructions);
    const projected = await makeAgent().stream(
      [
        { role: "user", content: "Make the first poster" },
        { role: "assistant", content: output.text },
        { role: "user", content: "Make the next poster with the same mascot" },
      ],
      { maxSteps: 1 },
    );
    await projected.consumeStream();
    expect(JSON.stringify(prompts.at(-1))).not.toContain(instructions);
  });
});

describe("Kanvas model message handoff", () => {
  it("round-trips native Skill instructions and image results across turns without executing them again", async () => {
    const instruction =
      "KEEP_MASCOT_IDENTITY: use the reference image, never substitute a text description";
    const artifactId = "01K00000000000000000000009";
    const imageData = "aW1hZ2UtcmVmZXJlbmNl";
    const imageSkill = {
      ...skill,
      referenceResources: [
        {
          ...skill.instructionResource,
          relativePath: "mascot.png",
          resourcePath: "assets/mascot.png",
          mediaType: "image/png",
        },
      ],
    };
    const readInstructions = vi.fn(() =>
      Promise.resolve({
        skillRevisionId: skill.skillRevisionId,
        markdown: instruction,
      }),
    );
    const readImage = vi.fn(() =>
      Promise.resolve({
        artifactId,
        data: imageData,
        mediaType: "image/png",
      }),
    );
    const prompts: unknown[] = [];
    let calls = 0;
    const model = createKanvasMastraModel({
      modelProfileKey: "history",
      controls,
      port: {
        generate: unusedGenerate,
        stream: (request) =>
          Promise.resolve(
            (() => {
              prompts.push(request.prompt);
              calls++;
              if (calls === 1)
                return toolCallStream(
                  "skill",
                  "skill-history",
                  JSON.stringify({ name: skill.skillName }),
                );
              if (calls === 2)
                return toolCallStream(
                  "skill_read",
                  "image-history",
                  JSON.stringify({
                    skillName: skill.skillName,
                    path: "assets/mascot.png",
                  }),
                );
              return textStream("Poster ready");
            })(),
          ),
      },
    });
    const base = {
      model,
      profile,
      skills: [imageSkill],
      ...noSkillRuntime,
      loadSkillInstructions: readInstructions,
      loadSkillImage: readImage,
      tools: [],
      surfaceContext,
    };
    const first = await runKanvasSurfaceAgent({
      ...base,
      runId: "history-first",
      conversation: [
        {
          ...userMessageIdentity,
          role: "user",
          text: "First poster",
          files: [
            {
              data: Uint8Array.of(1, 2, 3, 4),
              mediaType: "image/png",
            },
          ],
        },
      ],
    });
    const persisted = jsonRoundTrip(first.modelMessages);
    expect(
      persisted.messages.every(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "role" in message &&
          ["user", "assistant"].includes(String(message.role)),
      ),
    ).toBe(true);
    const second = await runKanvasSurfaceAgent({
      ...base,
      runId: "history-second",
      runCreatedAt: new Date(base.runCreatedAt.getTime() + 16 * 60_000),
      conversation: [
        { ...userMessageIdentity, role: "user", text: "First poster" },
        {
          id: "persisted-assistant",
          role: "assistant",
          text: first.text,
          createdAt: userMessageIdentity.createdAt,
          modelMessages: persisted,
        },
        {
          id: "second-user",
          role: "user",
          text: "Next poster, same mascot",
          createdAt: userMessageIdentity.createdAt,
        },
      ],
    });
    const prompt = JSON.stringify(prompts.at(-1));
    expect(prompt).toContain(instruction);
    expect(prompt).toContain(artifactId);
    // Mastra must retain the actual multimodal result as well as its identifier.
    expect(prompt).toContain(imageData);
    expect(JSON.stringify(persisted)).toContain("AQIDBA==");
    expect(prompt).toContain('"0":1,"1":2,"2":3,"3":4');
    expect(prompt.split("First poster")).toHaveLength(2);
    // Native message clocks can differ from database clocks; the new request
    // must still come after the previous turn's tool results.
    expect(prompt.indexOf("Next poster, same mascot")).toBeGreaterThan(
      prompt.indexOf(instruction),
    );
    expect(readInstructions).toHaveBeenCalledOnce();
    expect(readImage).toHaveBeenCalledOnce();
    expect(JSON.stringify(second.modelMessages)).not.toContain(instruction);
    expect(JSON.stringify(second.modelMessages)).not.toContain("First poster");
  });
});

describe("native model history after question recovery", () => {
  it("keeps the resolved call and pre-question Skill result exactly once in the next turn", async () => {
    let calls = 0;
    const instruction = "PRE_QUESTION_SKILL_GUIDANCE";
    const prompts: unknown[] = [];
    const model = createKanvasMastraModel({
      modelProfileKey: "question-history",
      controls,
      port: {
        generate: unusedGenerate,
        stream: (request) =>
          Promise.resolve(
            (() => {
              prompts.push(request.prompt);
              calls++;
              if (calls === 1)
                return toolCallStream(
                  "skill",
                  "before-question",
                  JSON.stringify({ name: skill.skillName }),
                );
              if (calls === 2)
                return toolCallStream(
                  askQuestionToolName,
                  "choose-term",
                  JSON.stringify({
                    questions: [
                      {
                        key: "term",
                        header: "Term",
                        question: "Which term?",
                        options: [
                          { key: "summer", label: "Summer" },
                          { key: "autumn", label: "Autumn" },
                        ],
                      },
                    ],
                  }),
                );
              return textStream("Prepared");
            })(),
          ),
      },
    });
    const conversation = [
      { ...userMessageIdentity, role: "user" as const, text: "Make a poster" },
    ];
    const base = {
      model,
      profile,
      skills: [skill],
      ...noSkillRuntime,
      loadSkillInstructions: () =>
        Promise.resolve({
          skillRevisionId: skill.skillRevisionId,
          markdown: instruction,
        }),
      tools: [],
      conversation,
      surfaceContext,
      runId: "question-history",
    };
    const first = await runKanvasSurfaceAgent(base);
    if (!first.suspension) throw new Error("Expected question");
    const continuation = resumeAgentQuestionCheckpoint(
      jsonRoundTrip(first.suspension.checkpoint),
      {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "term", optionKeys: ["summer"] }],
      },
    );
    const resumed = await runKanvasSurfaceAgent({ ...base, continuation });
    await runKanvasSurfaceAgent({
      ...base,
      runId: "following-turn",
      conversation: [
        ...conversation,
        {
          id: "resumed-assistant",
          role: "assistant",
          text: resumed.text,
          createdAt: userMessageIdentity.createdAt,
          modelMessages: jsonRoundTrip(resumed.modelMessages),
        },
        {
          id: "followup-user",
          role: "user",
          text: "Continue",
          createdAt: userMessageIdentity.createdAt,
        },
      ],
    });
    const prompt = JSON.stringify(prompts.at(-1));
    expect(prompt.split(instruction)).toHaveLength(2);
    expect(prompt).toContain('"outcome":"submitted"');
    expect(prompt).toContain("Summer");
    expect(calls).toBe(4);
  });
});
