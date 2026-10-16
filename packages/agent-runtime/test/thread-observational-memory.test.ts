import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  createKanvasMastraModel,
  type KanvasAgentModelRequest,
} from "../src/kanvas-model.js";
import { observeKanvasThread } from "../src/thread-observational-memory.js";

describe("Kanvas Thread observational memory", () => {
  it.each([
    { finishReason: "stop", reflect: false, cancel: false },
    { finishReason: "stop", reflect: false, cancel: true },
    { finishReason: "length", reflect: false, cancel: false },
    { finishReason: "content-filter", reflect: false, cancel: false },
    { finishReason: "length", reflect: true, cancel: false },
  ] as const)(
    "only publishes complete memory ($finishReason, reflection=$reflect)",
    async ({ finishReason, reflect, cancel }) => {
      const abort = new AbortController();
      const requests: KanvasAgentModelRequest[] = [];
      const model = createKanvasMastraModel({
        modelProfileKey: "agent-fast",
        controls: { reasoningLevel: "low", webSearchMode: "off" },
        port: {
          stream: (request, signal) => {
            if (cancel) {
              abort.abort();
              expect(signal?.aborted).toBe(true);
            }
            requests.push(request);
            const actualFinish =
              reflect && requests.length === 1 ? "stop" : finishReason;
            return Promise.resolve({
              stream: new ReadableStream<LanguageModelV3StreamPart>({
                start(controller) {
                  controller.enqueue({ type: "stream-start", warnings: [] });
                  controller.enqueue({ type: "text-start", id: "text-0" });
                  controller.enqueue({
                    type: "text-delta",
                    id: "text-0",
                    delta: [
                      "<observations>",
                      "* 🔴 (10:00) User requires a Marriott summer marketing poster.",
                      "* 🟡 (10:01) Agent identified the poster workflow.",
                      "</observations>",
                      "<current-task>Create the poster</current-task>",
                      "<suggested-response>Continue production</suggested-response>",
                    ].join("\n"),
                  });
                  controller.enqueue({ type: "text-end", id: "text-0" });
                  controller.enqueue({
                    type: "finish",
                    usage: {
                      inputTokens: {
                        total: 1_500,
                        noCache: undefined,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 50,
                        text: 50,
                        reasoning: undefined,
                      },
                    },
                    finishReason: { unified: actualFinish, raw: actualFinish },
                  });
                  controller.close();
                },
              }),
            });
          },
          generate: (request, signal) => {
            if (cancel) {
              abort.abort();
              expect(signal?.aborted).toBe(true);
            }
            requests.push(request);
            const actualFinish =
              reflect && requests.length === 1 ? "stop" : finishReason;
            return Promise.resolve({
              content: [
                {
                  type: "text",
                  text: [
                    "<observations>",
                    "* 🔴 (10:00) User requires a Marriott summer marketing poster.",
                    "* 🟡 (10:01) Agent identified the poster workflow.",
                    "</observations>",
                    "<current-task>Create the poster</current-task>",
                    "<suggested-response>Continue production</suggested-response>",
                  ].join("\n"),
                },
              ],
              finishReason: actualFinish,
              usage: { inputTokens: 1_500, outputTokens: 50 },
            });
          },
        },
      });
      const createdAt = new Date("2026-08-27T10:00:00.000Z");
      const observation = observeKanvasThread({
        model,
        abortSignal: abort.signal,
        threadId: "01K00000000000000000000001",
        resourceId: "01K00000000000000000000002",
        existing: {
          activeObservations: "* Previous observed fact.",
          lastObservedAt: new Date(createdAt.getTime() + 1000),
        },
        messageTokens: 1_000,
        reflectionTokens: reflect ? 1 : 5_000,
        messages: [
          {
            id: "01K00000000000000000000003",
            role: "user",
            text: `Create a Marriott summer marketing poster. ${"context ".repeat(600)}`,
            createdAt,
          },
          {
            id: "01K00000000000000000000004",
            role: "assistant",
            text: "I will use the poster workflow.",
            modelMessages: {
              schemaVersion: 1,
              adapter: "mastra-message-list-v2",
              messages: [
                {
                  id: "native-observer-skill",
                  role: "assistant",
                  content: {
                    format: 2,
                    parts: [
                      {
                        type: "tool-invocation",
                        toolInvocation: {
                          state: "result",
                          toolCallId: "observer-read",
                          toolName: "skill",
                          args: { name: "poster" },
                          result: "PRESERVE_REFERENCE_ARTIFACT_123",
                        },
                      },
                    ],
                  },
                },
              ],
            },
            createdAt: new Date(createdAt.getTime() + 1_000),
          },
        ],
      });

      if (cancel) {
        await expect(observation).rejects.toMatchObject({ name: "AbortError" });
        return;
      }
      if (finishReason !== "stop") {
        await expect(observation).rejects.toThrow(
          "agent.memory_output_incomplete",
        );
        if (reflect) expect(requests.length).toBeGreaterThanOrEqual(2);
        expect(
          requests.every((request) => request.maxOutputTokens === undefined),
        ).toBe(true);
        return;
      }
      const result = await observation;
      expect(requests.length).toBeGreaterThan(0);
      expect(
        requests.every((request) => request.maxOutputTokens === undefined),
      ).toBe(true);
      expect(result).toMatchObject({
        observed: true,
        reflected: false,
      });
      expect(JSON.stringify(requests[0])).toContain(
        "PRESERVE_REFERENCE_ARTIFACT_123",
      );
      expect(result.activeObservations).toContain(
        "User requires a Marriott summer marketing poster",
      );
      expect(result.lastObservedAt?.getTime()).toBeGreaterThan(
        createdAt.getTime(),
      );
    },
  );
});
