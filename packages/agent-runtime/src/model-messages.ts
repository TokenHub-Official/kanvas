import type { AgentModelMessagesV1 } from "@kanvas/application";
import {
  convertMessages,
  type MessageListInput,
} from "@mastra/core/agent/message-list";

/** Restore the native representation using Mastra's own message converter. */
export function restoreAgentModelMessages(transcript: AgentModelMessagesV1) {
  if (
    transcript.schemaVersion !== 1 ||
    transcript.adapter !== "mastra-message-list-v2" ||
    !Array.isArray(transcript.messages)
  )
    throw new Error("agent.model_messages_invalid");
  return convertMessages(transcript.messages as MessageListInput).to(
    "Mastra.V2",
  );
}
