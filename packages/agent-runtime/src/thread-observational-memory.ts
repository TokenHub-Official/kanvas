import { restoreAgentModelMessages } from "./model-messages.js";
import type { AgentModelMessagesV1 } from "@kanvas/application";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import type { MastraDBMessage } from "@mastra/core/agent/message-list";
import { InMemoryDB, InMemoryMemory } from "@mastra/core/storage";
import { ObservationalMemory } from "@mastra/memory/processors";

export interface KanvasThreadMemoryMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly modelMessages?: AgentModelMessagesV1;
  readonly createdAt: Date;
}

export interface ExistingKanvasThreadMemory {
  readonly activeObservations: string;
  readonly lastObservedAt: Date;
}

export interface ObserveKanvasThreadOptions {
  readonly model: LanguageModelV3;
  readonly abortSignal?: AbortSignal;
  readonly threadId: string;
  readonly resourceId: string;
  readonly messages: readonly KanvasThreadMemoryMessage[];
  readonly existing?: ExistingKanvasThreadMemory;
  readonly messageTokens?: number;
  readonly reflectionTokens?: number;
}

export interface ObservedKanvasThread {
  readonly observed: boolean;
  readonly reflected: boolean;
  readonly activeObservations?: string;
  readonly lastObservedAt?: Date;
}

function mastraMessage(
  message: KanvasThreadMemoryMessage,
  threadId: string,
  resourceId: string,
): MastraDBMessage {
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    threadId,
    resourceId,
    content: {
      format: 2,
      parts: [{ type: "text", text: message.text }],
    },
  };
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil([...text].length / 3));
}

export async function observeKanvasThread(
  options: ObserveKanvasThreadOptions,
): Promise<ObservedKanvasThread> {
  options.abortSignal?.throwIfAborted();
  const withAbort = (
    request: LanguageModelV3CallOptions,
  ): LanguageModelV3CallOptions => ({
    ...request,
    ...(options.abortSignal
      ? {
          abortSignal: request.abortSignal
            ? AbortSignal.any([request.abortSignal, options.abortSignal])
            : options.abortSignal,
        }
      : {}),
  });
  // Mastra may parse and accept well-formed observation markup even when the
  // provider truncated the response. Keep its staging storage private and never
  // publish a replacement memory unless every inference completed normally.
  const completions: boolean[] = [];
  const model: LanguageModelV3 = {
    specificationVersion: options.model.specificationVersion,
    provider: options.model.provider,
    modelId: options.model.modelId,
    supportedUrls: options.model.supportedUrls,
    async doGenerate(request) {
      const index = completions.push(false) - 1;
      const result = await options.model.doGenerate(withAbort(request));
      completions[index] = result.finishReason.unified === "stop";
      return result;
    },
    async doStream(request) {
      const index = completions.push(false) - 1;
      const result = await options.model.doStream(withAbort(request));
      let stopped = false;
      let failed = false;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "finish")
                stopped = part.finishReason.unified === "stop";
              if (part.type === "error") failed = true;
              controller.enqueue(part);
            },
            flush() {
              completions[index] = stopped && !failed;
            },
          }),
        ),
      };
    },
  };
  const storage = new InMemoryMemory({ db: new InMemoryDB() });
  const memory = new ObservationalMemory({
    storage,
    model,
    scope: "thread",
    obscureThreadIds: true,
    observation: {
      messageTokens: options.messageTokens ?? 12_000,
      bufferTokens: false,
      modelSettings: { temperature: 0.2 },
      providerOptions: {},
    },
    reflection: {
      observationTokens: options.reflectionTokens ?? 20_000,
      modelSettings: { temperature: 0.2 },
      providerOptions: {},
    },
  });
  const projectedMessages = options.messages.flatMap((message) =>
    message.modelMessages
      ? restoreAgentModelMessages(message.modelMessages).map((native) => ({
          ...native,
          threadId: options.threadId,
          resourceId: options.resourceId,
          // Observation coverage uses the owning persisted branch message.
          createdAt: new Date(message.createdAt),
        }))
      : [mastraMessage(message, options.threadId, options.resourceId)],
  );
  const messages = [
    ...new Map(
      projectedMessages.map((message) => [message.id, message]),
    ).values(),
  ];
  const initial = await memory.getStatus({
    threadId: options.threadId,
    resourceId: options.resourceId,
    messages: [],
  });
  if (options.existing) {
    await storage.updateActiveObservations({
      id: initial.record.id,
      observations: options.existing.activeObservations,
      tokenCount: approximateTokens(options.existing.activeObservations),
      // The caller supplies the branch-validated observation tail. Reobserve
      // its boundary rather than letting timestamp equality discard messages.
      lastObservedAt: new Date(
        messages.reduce(
          (cutoff, message) =>
            Math.min(cutoff, message.createdAt.getTime() - 1),
          options.existing.lastObservedAt.getTime(),
        ),
      ),
    });
  }
  const result = await memory.observe({
    threadId: options.threadId,
    resourceId: options.resourceId,
    messages,
    trigger: "manual",
  });
  options.abortSignal?.throwIfAborted();
  if (completions.some((complete) => !complete)) {
    throw new Error("agent.memory_output_incomplete");
  }
  const activeObservations = result.record.activeObservations.trim();
  return Object.freeze({
    observed: result.observed,
    reflected: result.reflected,
    ...(activeObservations ? { activeObservations } : {}),
    ...(result.record.lastObservedAt
      ? { lastObservedAt: new Date(result.record.lastObservedAt) }
      : {}),
  });
}
