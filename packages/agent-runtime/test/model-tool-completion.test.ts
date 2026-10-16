import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { completedToolStream } from "../src/model-tool-completion.js";

const tool: LanguageModelV3StreamPart = {
  type: "tool-call",
  toolCallId: "call-1",
  toolName: "produce",
  input: '{"prompt":"poster"}',
};
function finish(
  reason: "stop" | "tool-calls" | "length" | "content-filter",
): LanguageModelV3StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
  };
}
async function collect(parts: LanguageModelV3StreamPart[]) {
  const output: LanguageModelV3StreamPart[] = [];
  const { stream } = completedToolStream({
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  });
  for await (const part of stream) output.push(part);
  return output;
}

describe("model tool completion gate", () => {
  it.each(["stop", "tool-calls"] as const)(
    "releases tools on clean %s completion",
    async (reason) => {
      expect(await collect([tool, finish(reason)])).toEqual([
        tool,
        finish(reason),
      ]);
    },
  );
  it.each(["length", "content-filter"] as const)(
    "discards all tool events on %s",
    async (reason) => {
      expect(
        await collect([
          { type: "tool-input-start", id: "call-1", toolName: "produce" },
          { type: "tool-input-delta", id: "call-1", delta: "{}" },
          { type: "tool-input-end", id: "call-1" },
          tool,
          finish(reason),
        ]),
      ).toEqual([finish(reason)]);
    },
  );
  it("does not release tools if the stream contains an error", async () => {
    const error = { type: "error", error: "connection lost" } as const;
    expect(await collect([tool, error, finish("tool-calls")])).toEqual([
      error,
      finish("tool-calls"),
    ]);
  });
  it("rejects a missing completion marker", async () => {
    await expect(collect([tool])).rejects.toMatchObject({
      code: "agent.model_output_incomplete",
    });
  });
  it("streams visible text immediately but waits for clean EOF before releasing tools", async () => {
    let source!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
    const { stream } = completedToolStream({
      stream: new ReadableStream({
        start(controller) {
          source = controller;
        },
      }),
    });
    const reader = stream.getReader();
    source.enqueue({ type: "text-start", id: "text-1" });
    expect((await reader.read()).value).toEqual({
      type: "text-start",
      id: "text-1",
    });
    source.enqueue(tool);
    source.enqueue(finish("tool-calls"));
    // A late transport error after a finish marker still cannot execute tools.
    const pending = reader.read();
    source.error(new Error("late disconnect"));
    await expect(pending).rejects.toThrow("late disconnect");
  });
});
