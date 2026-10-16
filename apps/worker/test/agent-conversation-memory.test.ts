import type { AgentThreadMemoryRecord } from "@kanvas/application";
import { describe, expect, it } from "vitest";
import { selectAgentConversationMemory } from "../src/agent/agent-conversation-memory.js";

const messages = Array.from({ length: 50 }, (_, index) => ({
  id: `message-${index}`,
  createdAt: new Date(index * 1000),
  text: `fact-${index}`,
}));
const memory: AgentThreadMemoryRecord = {
  threadId: "thread",
  activeObservations: "summary of initial messages",
  observationsDigest: "digest",
  sourceMessageId: "message-10",
  lastObservedAt: new Date(10000),
  observerModelBindingKey: "model",
  version: 1,
  updatedAt: new Date(11000),
};
describe("branch-aware conversation memory", () => {
  it("preserves every message after the observed boundary even beyond 24", () => {
    const selected = selectAgentConversationMemory(messages, memory);
    expect(selected.messages).toEqual(messages.slice(10));
    expect(selected.messages).toHaveLength(40);
    expect(selected.memory).toBe(memory);
  });
  it("retains equal-timestamp messages around the observed boundary", () => {
    const tied = messages.map((message) => ({
      ...message,
      createdAt: new Date(10000),
    }));
    expect(selectAgentConversationMemory(tied, memory).messages).toEqual(tied);
  });
  it("does not reuse a summary from an unselected branch", () => {
    const fork = messages.map((message) =>
      message.id === "message-10"
        ? { ...message, id: "alternate-reply" }
        : message,
    );
    expect(selectAgentConversationMemory(fork, memory)).toEqual({
      messages: fork,
    });
  });
  it("does not use legacy or missing memory to discard messages", () => {
    const legacy = { ...memory };
    delete legacy.sourceMessageId;
    expect(selectAgentConversationMemory(messages, legacy)).toEqual({
      messages,
    });
    expect(selectAgentConversationMemory(messages, undefined)).toEqual({
      messages,
    });
  });
  it("rejects inconsistent coverage timestamps", () => {
    expect(
      selectAgentConversationMemory(messages, {
        ...memory,
        lastObservedAt: new Date(9000),
      }),
    ).toEqual({ messages });
  });
});
