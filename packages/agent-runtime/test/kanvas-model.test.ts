import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import {
  createKanvasMastraModel,
  type KanvasAgentModelPort,
} from "../src/kanvas-model.js";

const textCall: LanguageModelV3CallOptions = {
  prompt: [
    { role: "system", content: "Plan visual production work." },
    {
      role: "user",
      content: [{ type: "text", text: "Create a summer poster." }],
    },
  ],
  responseFormat: {
    type: "json",
    schema: {
      type: "object",
      properties: { summary: { type: "string" } },
    },
  },
};
const controls = { reasoningLevel: "medium", webSearchMode: "off" } as const;

function deterministicPort(text: string): KanvasAgentModelPort {
  const generate: KanvasAgentModelPort["generate"] = vi.fn(() =>
    Promise.resolve({
      content: [{ type: "text" as const, text }],
      finishReason: "stop" as const,
      usage: {
        inputTokens: 42,
        outputTokens: 18,
        outputTextTokens: 18,
      },
      responseId: "agent-response-1",
      resolvedModelId: "test-model",
      startedAt: new Date("2026-08-24T00:00:00.000Z"),
    }),
  );
  return {
    generate,
    stream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "response-metadata",
              id: "agent-response-1",
              modelId: "test-model",
              timestamp: new Date("2026-08-24T00:00:00.000Z"),
            });
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
                  total: 42,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 18,
                  text: 18,
                  reasoning: undefined,
                },
              },
              finishReason: { unified: "stop", raw: "stop" },
            });
            controller.close();
          },
        }),
      }),
  };
}

describe("createKanvasMastraModel", () => {
  it.each(["length", "content-filter", "error", "other"] as const)(
    "does not expose non-streaming tools on incomplete %s",
    async (finishReason) => {
      const model = createKanvasMastraModel({
        modelProfileKey: "agent-test",
        controls,
        port: {
          ...deterministicPort("unused"),
          generate: () =>
            Promise.resolve({
              content: [
                { type: "text", text: "Partial progress" },
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "produce",
                  input: "{}",
                },
              ],
              finishReason,
              usage: { outputTokens: 3000 },
            }),
        },
      });
      const result = await model.doGenerate(textCall);
      expect(result.content).toEqual([
        { type: "text", text: "Partial progress" },
      ]);
      expect(result.finishReason.unified).toBe(finishReason);
      expect(result.usage.outputTokens.total).toBe(3000);
    },
  );
  it("projects an AI SDK request into the Kanvas model port", async () => {
    const port = deterministicPort('{"summary":"Summer poster"}');
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port,
      controls,
    });

    const result = await model.doGenerate(textCall);
    expect(model.supportedUrls).toEqual({
      "image/*": [/^https:\/\//u],
    });
    expect(port.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: "kanvas.agent-model-request/v1",
        prompt: textCall.prompt,
        responseFormat: textCall.responseFormat,
        controls,
      }),
      undefined,
    );
    expect(result.content).toEqual([
      { type: "text", text: '{"summary":"Summer poster"}' },
    ]);
    expect(result.usage.inputTokens.total).toBe(42);
    expect(result.response).toMatchObject({
      id: "agent-response-1",
      modelId: "test-model",
    });
  });

  it("passes through the governed standard model stream", async () => {
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port: deterministicPort("ready"),
      controls,
    });
    const { stream } = await model.doStream(textCall);
    const parts: LanguageModelV3StreamPart[] = [];
    for await (const part of stream) {
      parts.push(part);
    }

    expect(parts.map(({ type }) => type)).toEqual([
      "stream-start",
      "response-metadata",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
  });

  it("round-trips protocol metadata needed by multi-step Provider tools", async () => {
    const generate: KanvasAgentModelPort["generate"] = vi.fn(() =>
      Promise.resolve({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call-1",
            toolName: "load_skill",
            input: '{"name":"poster"}',
            providerMetadata: {
              kanvas: {
                protocol: "gemini_generate_content",
                thoughtSignature: "signed-thought-1",
              },
            },
          },
        ],
        finishReason: "tool-calls" as const,
      }),
    );
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port: {
        generate,
        stream: () => Promise.reject(new Error("unused")),
      },
      controls,
    });
    const result = await model.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "prior-call",
              toolName: "load_skill",
              input: { name: "poster" },
              providerOptions: {
                kanvas: {
                  protocol: "gemini_generate_content",
                  thoughtSignature: "prior-signature",
                },
              },
            },
          ],
        },
      ],
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          expect.objectContaining({
            content: [
              expect.objectContaining({
                providerMetadata: {
                  kanvas: {
                    protocol: "gemini_generate_content",
                    thoughtSignature: "prior-signature",
                  },
                },
              }),
            ],
          }),
        ],
      }),
      undefined,
    );
    expect(result.content[0]).toMatchObject({
      providerMetadata: {
        kanvas: { thoughtSignature: "signed-thought-1" },
      },
    });
  });

  it("projects Mastra modelOutput into a standard tool result", async () => {
    const port = deterministicPort("done");
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port,
      controls,
    });

    await model.doGenerate({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "thread.inspect-work",
              output: undefined as never,
              providerOptions: {
                mastra: { modelOutput: { tasks: [], taskCount: 0 } },
              },
            },
          ],
        },
      ],
    });

    expect(port.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "thread.inspect-work",
                output: {
                  type: "json",
                  value: { tasks: [], taskCount: 0 },
                },
              },
            ],
          },
        ],
      }),
      undefined,
    );
  });

  it("converts Mastra media tool results to AI SDK v3 image parts", async () => {
    const port = deterministicPort("done");
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port,
      controls,
    });
    await model.doGenerate({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "image-read",
              toolName: "skill_read",
              output: undefined as never,
              providerOptions: {
                mastra: {
                  modelOutput: {
                    type: "content",
                    value: [
                      { type: "text", text: "Actual image" },
                      { type: "media", data: "AQID", mediaType: "image/png" },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    });
    expect(port.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "image-read",
                toolName: "skill_read",
                output: {
                  type: "content",
                  value: [
                    { type: "text", text: "Actual image" },
                    {
                      type: "image-data",
                      data: "AQID",
                      mediaType: "image/png",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
      undefined,
    );
  });

  it("rejects caller overrides and accepts only trusted image projections", async () => {
    const port = deterministicPort("unused");
    const model = createKanvasMastraModel({
      modelProfileKey: "agent-default",
      port,
      controls,
    });

    await expect(
      model.doGenerate({
        ...textCall,
        headers: { authorization: "Bearer forbidden" },
      }),
    ).rejects.toThrow(/does not accept caller-controlled Provider/u);

    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: "base64-data",
                mediaType: "image/png",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/trusted image projection/u);

    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image." },
              {
                type: "file",
                data: new URL("https://storage.example/signed-image"),
                mediaType: "image/png",
                filename: "reference.png",
              },
            ],
          },
        ],
      }),
    ).resolves.toBeDefined();
    const projected = vi.mocked(port.generate).mock.lastCall?.[0];
    const user = projected?.prompt[0];
    expect(user?.role === "user" ? user.content : []).toContainEqual({
      type: "file",
      data: new URL("https://storage.example/signed-image"),
      mediaType: "image/png",
      filename: "reference.png",
    });
  });
});
