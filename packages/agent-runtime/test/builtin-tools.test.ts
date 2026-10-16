import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { describe, expect, it, vi } from "vitest";

import {
  agentBuiltinToolViewDigest,
  askQuestionToolName,
  assertAgentQuestionResponse,
  createAgentBuiltinToolSession,
  parseAgentQuestionRequest,
  resumeAgentQuestionCheckpoint,
} from "../src/builtin-tools.js";
import {
  createKanvasMastraModel,
  type KanvasAgentModelPort,
} from "../src/kanvas-model.js";

const questionInput = {
  questions: [
    {
      key: "format",
      header: "Format",
      question: "Which format should I use?",
      options: [
        {
          key: "square",
          label: "Square",
          description: "Use a 1:1 canvas.",
          recommended: true,
        },
        { key: "portrait", label: "Portrait" },
      ],
    },
  ],
};

function modelStream(
  parts: readonly LanguageModelV3StreamPart[],
  finishReason: "stop" | "tool-calls",
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        parts.forEach((part) => controller.enqueue(part));
        controller.enqueue({
          type: "finish",
          usage: {
            inputTokens: {
              total: 4,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: 2,
              text: 2,
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

function model(port: KanvasAgentModelPort) {
  return createKanvasMastraModel({
    modelProfileKey: "builtin-test",
    port,
    controls: { reasoningLevel: "off", webSearchMode: "off" },
  });
}

describe("Platform Built-in Tools", () => {
  it("projects one stable built-in digest independently of business tools", () => {
    const digest = (value: unknown) => JSON.stringify(value);
    const first = agentBuiltinToolViewDigest(digest, "business-a");
    const replay = agentBuiltinToolViewDigest(digest, "business-a");
    const changed = agentBuiltinToolViewDigest(digest, "business-b");
    expect(first).toBe(replay);
    expect(first).not.toBe(changed);
    expect(first).toContain(askQuestionToolName);
  });

  it("canonically validates stable question and option keys", () => {
    const parsed = parseAgentQuestionRequest(questionInput);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe("question");
    expect(parsed.questions[0]?.key).toBe("format");
    expect(parsed.questions[0]?.options[0]?.key).toBe("square");
    expect(() =>
      parseAgentQuestionRequest({
        questions: [
          {
            ...questionInput.questions[0],
            options: [
              { key: "same", label: "First" },
              { key: "same", label: "Second" },
            ],
          },
        ],
      }),
    ).toThrow("Question input is invalid");
  });

  it("rejects answers that do not match the original question contract", () => {
    const request = parseAgentQuestionRequest(questionInput);
    expect(
      assertAgentQuestionResponse(request, {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["square"] }],
      }),
    ).toMatchObject({ outcome: "submitted" });
    expect(() =>
      assertAgentQuestionResponse(request, {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["unknown"] }],
      }),
    ).toThrow("Question response is invalid");
  });

  it.each([false, true])(
    "checks the current question step, preserving the parallel-call guard (%s)",
    async (parallel) => {
      const session = createAgentBuiltinToolSession();
      let calls = 0;
      const agent = new Agent({
        id: "multi-step-question",
        name: "Question",
        instructions: "Read then ask.",
        model: model({
          generate: () => Promise.reject(new Error("unused")),
          stream: () =>
            Promise.resolve(
              modelStream(
                [
                  {
                    type: "tool-call",
                    toolCallId: ++calls === 1 ? "read-1" : "question-1",
                    toolName: calls === 1 ? "read" : askQuestionToolName,
                    input: JSON.stringify(calls === 1 ? {} : questionInput),
                  },
                  ...(parallel && calls === 2
                    ? [
                        {
                          type: "tool-call" as const,
                          toolCallId: "read-2",
                          toolName: "read",
                          input: "{}",
                        },
                      ]
                    : []),
                ],
                "tool-calls",
              ),
            ),
        }),
        tools: {
          ...session.tools,
          read: createTool({
            id: "read",
            description: "Read a resource",
            inputSchema: { type: "object", properties: {} },
            execute: () => Promise.resolve({ found: true }),
          }),
        },
      });
      const output = await agent.stream("Read then ask.", { maxSteps: 3 });
      await output.consumeStream();
      const full = await output.getFullOutput();
      expect(calls).toBe(2);
      const suspensionOptions = {
        finishReason: full.finishReason,
        suspendPayload: full.suspendPayload as unknown,
        messages: full.messages,
        toolCalls: full.toolCalls,
        steps: full.steps,
        inputMessageIds: [full.messages[0]!.id],
        previousToolCallCount: 0,
      };
      const suspend = () => session.suspension(suspensionOptions);
      if (parallel) {
        expect(suspend).toThrow(
          "Question Tool must be the only Tool in its model step.",
        );
      } else {
        expect(() =>
          session.suspension({ ...suspensionOptions, inputMessageIds: [] }),
        ).toThrowError(
          expect.objectContaining({
            code: "agent.question_input_identity_invalid",
          }),
        );
        expect(() =>
          session.suspension({ ...suspensionOptions, suspendPayload: {} }),
        ).toThrowError(
          expect.objectContaining({ code: "agent.question_payload_mismatch" }),
        );
        const suspension = suspend()!;
        expect(suspension).toMatchObject({
          toolCallId: "question-1",
          checkpoint: { toolCallCount: 2 },
        });
        const resumed = resumeAgentQuestionCheckpoint(suspension.checkpoint, {
          schemaVersion: 1,
          outcome: "submitted",
          answers: [{ questionKey: "format", optionKeys: ["square"] }],
        });
        expect(resumed.previousToolCallCount).toBe(2);
        expect(JSON.stringify(resumed.messages)).toContain('"found":true');
        expect(resumed.answeredQuestions[0]?.selectedOptionKeys).toEqual([
          "square",
        ]);
      }
    },
  );

  it("persists a bounded suspension and resumes it as a Tool result", async () => {
    const session = createAgentBuiltinToolSession();
    const initialPort: KanvasAgentModelPort = {
      generate: () => Promise.reject(new Error("unused")),
      stream: () =>
        Promise.resolve(
          modelStream(
            [
              {
                type: "tool-call",
                toolCallId: "question-call-1",
                toolName: askQuestionToolName,
                input: JSON.stringify(questionInput),
              },
            ],
            "tool-calls",
          ),
        ),
    };
    const initialAgent = new Agent({
      id: "builtin-test-agent",
      name: "Builtin Test",
      instructions: "Ask one question.",
      model: model(initialPort),
      tools: session.tools,
    });
    const output = await initialAgent.stream("Prepare a layout.", {
      runId: "builtin-question-run",
    });
    await output.consumeStream();
    const full = await output.getFullOutput();
    const suspension = session.suspension({
      finishReason: full.finishReason,
      suspendPayload: full.suspendPayload,
      messages: full.messages,
      toolCalls: full.toolCalls,
      steps: full.steps,
      inputMessageIds: [full.messages[0]!.id],
      previousToolCallCount: 0,
    });
    expect(suspension).toMatchObject({
      toolCallId: "question-call-1",
      request: { kind: "question" },
      checkpoint: { toolCallCount: 1 },
    });
    const continuation = resumeAgentQuestionCheckpoint(
      {
        ...suspension!.checkpoint,
        continuationMessages: [
          {
            id: "brand-query-message",
            role: "assistant",
            content: {
              format: 2,
              parts: [
                {
                  type: "tool-invocation",
                  toolInvocation: {
                    state: "result",
                    toolCallId: "brand-query-call",
                    toolName: "read_brand",
                    args: {},
                    result: {
                      tone: "friendly",
                      source: "verified-brand-resource",
                    },
                  },
                },
              ],
            },
          },
          {
            id: "unrelated-user-message",
            role: "user",
            content: { format: 2, parts: [{ type: "text", text: "Repeat" }] },
          },
          ...suspension!.checkpoint.continuationMessages,
        ],
      },
      {
        schemaVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["square"] }],
      },
    );
    expect(continuation.messages).toHaveLength(2);
    expect(JSON.stringify(continuation.messages)).toContain(
      "verified-brand-resource",
    );
    expect(JSON.stringify(continuation.messages)).not.toContain(
      "unrelated-user-message",
    );
    expect(continuation.answeredQuestions).toEqual([
      {
        questionKey: "format",
        question: "Which format should I use?",
        selectedOptionKeys: ["square"],
      },
    ]);
    const resumedRequests: unknown[] = [];
    const resumedAgent = new Agent({
      id: "builtin-test-agent",
      name: "Builtin Test",
      instructions: "Continue after the answer.",
      model: model({
        generate: () => Promise.reject(new Error("unused")),
        stream: vi.fn((request) => {
          resumedRequests.push(request);
          return Promise.resolve(
            modelStream(
              [
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: "Using a square layout.",
                },
                { type: "text-end", id: "text-1" },
              ],
              "stop",
            ),
          );
        }),
      }),
      tools: createAgentBuiltinToolSession().tools,
    });
    const resumed = await resumedAgent.stream([
      { role: "user", content: "Prepare a layout." },
      ...continuation.messages,
    ] as never[]);
    await resumed.consumeStream();
    expect(await resumed.text).toBe("Using a square layout.");
    expect(JSON.stringify(resumedRequests)).toContain('"outcome":"submitted"');
    expect(JSON.stringify(resumedRequests)).toContain('"type":"tool-result"');
    expect(JSON.stringify(resumedRequests)).toContain(
      "verified-brand-resource",
    );
    expect(continuation.questionOutcome).toBe("submitted");
    expect(() =>
      resumeAgentQuestionCheckpoint(suspension!.checkpoint, {
        schemaVersion: 1,
        outcome: "cancelled",
      }),
    ).toThrow("cannot be resumed");
  });
});
