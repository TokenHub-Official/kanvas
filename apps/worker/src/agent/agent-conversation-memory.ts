import type { AgentThreadMemoryRecord } from "@kanvas/application";

/** A timestamp alone cannot prove that a summary belongs to the selected branch. */
export function selectAgentConversationMemory<
  T extends { readonly id: string; readonly createdAt: Date },
>(
  messages: readonly T[],
  memory: AgentThreadMemoryRecord | undefined,
): {
  readonly messages: readonly T[];
  readonly memory?: AgentThreadMemoryRecord;
} {
  const anchor = memory?.sourceMessageId
    ? messages.findIndex((message) => message.id === memory.sourceMessageId)
    : -1;
  if (
    !memory ||
    anchor < 0 ||
    messages[anchor]!.createdAt.getTime() > memory.lastObservedAt.getTime()
  ) {
    return { messages };
  }
  return {
    memory,
    // Retain equal-timestamp messages and the anchor itself: timestamp precision
    // must never drop messages whose observation coverage is ambiguous.
    messages: messages.filter(
      (message, index) =>
        index >= anchor ||
        message.createdAt.getTime() >= memory.lastObservedAt.getTime(),
    ),
  };
}
