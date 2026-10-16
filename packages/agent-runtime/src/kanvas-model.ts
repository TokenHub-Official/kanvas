import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type { AgentModelRuntimeControls } from "@kanvas/application";
import type { JSONSchema7 } from "json-schema";

import { completedToolStream } from "./model-tool-completion.js";

export type KanvasAgentModelFinishReason =
  "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export type KanvasAgentModelProviderMetadata = SharedV3ProviderMetadata;

export type KanvasAgentModelPromptPart =
  | {
      readonly type: "text";
      readonly text: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "reasoning";
      readonly text: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "file";
      readonly data: string | Uint8Array | URL;
      readonly mediaType: string;
      readonly filename?: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "tool-result";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly output: LanguageModelV3ToolResultOutput;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    };

export type KanvasAgentModelMessage =
  | { readonly role: "system"; readonly content: string }
  | {
      readonly role: "user" | "assistant" | "tool";
      readonly content: readonly KanvasAgentModelPromptPart[];
    };

export interface KanvasAgentModelTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JSONSchema7;
  readonly strict?: boolean;
}

export interface KanvasAgentModelRequest {
  readonly schemaVersion: "kanvas.agent-model-request/v1";
  readonly prompt: readonly KanvasAgentModelMessage[];
  readonly tools: readonly KanvasAgentModelTool[];
  readonly controls: AgentModelRuntimeControls;
  readonly webSearchToolAvailable?: boolean;
  readonly toolChoice?: LanguageModelV3ToolChoice;
  readonly responseFormat?: LanguageModelV3CallOptions["responseFormat"];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly stopSequences?: readonly string[];
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly seed?: number;
}

export type KanvasAgentModelResponseContent =
  | {
      readonly type: "text";
      readonly text: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "reasoning";
      readonly text: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: string;
      readonly providerMetadata?: SharedV3ProviderMetadata;
    };

export interface KanvasAgentModelUsage {
  readonly inputTokens?: number;
  readonly inputTokensNoCache?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly outputTokens?: number;
  readonly outputTextTokens?: number;
  readonly reasoningTokens?: number;
}

export interface KanvasAgentModelReportedCharge {
  readonly currencyCode: string;
  readonly amount: string;
}

export interface KanvasAgentModelResponse {
  readonly content: readonly KanvasAgentModelResponseContent[];
  readonly finishReason: KanvasAgentModelFinishReason;
  readonly rawFinishReason?: string;
  readonly usage?: KanvasAgentModelUsage;
  readonly reportedCharge?: KanvasAgentModelReportedCharge;
  readonly responseId?: string;
  readonly resolvedModelId?: string;
  readonly startedAt?: Date;
  readonly sources?: readonly {
    readonly url: string;
    readonly title?: string;
  }[];
}

export interface KanvasAgentModelPort {
  /**
   * The implementation owns current Workspace routing, credential resolution,
   * budget, usage accounting and audit. It must not return secret-bearing data.
   */
  readonly generate: (
    request: KanvasAgentModelRequest,
    signal: AbortSignal | undefined,
  ) => Promise<KanvasAgentModelResponse>;
  readonly stream: (
    request: KanvasAgentModelRequest,
    signal: AbortSignal | undefined,
  ) => PromiseLike<LanguageModelV3StreamResult>;
}

export interface CreateKanvasMastraModelOptions {
  readonly modelProfileKey: string;
  readonly port: KanvasAgentModelPort;
  readonly controls: AgentModelRuntimeControls;
  readonly webSearchToolAvailable?: boolean;
}

function hasEntries(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && Object.keys(value).length > 0
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function toolResultOutput(
  output: unknown,
  providerOptions: SharedV3ProviderMetadata | undefined,
): LanguageModelV3ToolResultOutput {
  const mastra = record(record(providerOptions)?.mastra);
  const value =
    mastra && Object.hasOwn(mastra, "modelOutput")
      ? mastra.modelOutput
      : output;
  const candidate = record(value);
  if (
    (candidate?.type === "text" || candidate?.type === "error-text") &&
    typeof candidate.value === "string"
  ) {
    return value as LanguageModelV3ToolResultOutput;
  }
  if (
    candidate?.type === "execution-denied" &&
    (candidate.reason === undefined || typeof candidate.reason === "string")
  ) {
    return value as LanguageModelV3ToolResultOutput;
  }
  if (
    (candidate?.type === "json" || candidate?.type === "error-json") &&
    Object.hasOwn(candidate, "value")
  ) {
    return value as LanguageModelV3ToolResultOutput;
  }
  if (candidate?.type === "content" && Array.isArray(candidate.value)) {
    // Mastra normalizes tool images to the v2 `media` shape even when
    // the custom model implements v3. Forwarding it drops the image downstream.
    const parts = candidate.value.map((part: unknown) => {
      const media = record(part);
      if (media?.type !== "media") return part;
      if (
        typeof media.data !== "string" ||
        typeof media.mediaType !== "string" ||
        !media.mediaType.startsWith("image/")
      )
        throw new Error("Unsupported Agent Tool media output.");
      if (/^https?:\/\//u.test(media.data))
        return { type: "image-url", url: media.data };
      return {
        type: "image-data",
        data: media.data.startsWith("data:")
          ? media.data.slice(media.data.indexOf(",") + 1)
          : media.data,
        mediaType: media.mediaType,
      };
    });
    return {
      type: "content",
      value: parts as Extract<
        LanguageModelV3ToolResultOutput,
        { type: "content" }
      >["value"],
    };
  }
  if (value === undefined) {
    throw new Error("Agent Tool model output is unavailable.");
  }
  return { type: "json", value: value as never };
}

function providerMetadataWithoutMastra(
  providerOptions: SharedV3ProviderMetadata | undefined,
): SharedV3ProviderMetadata | undefined {
  if (!providerOptions) return undefined;
  const providerMetadata = Object.fromEntries(
    Object.entries(providerOptions).filter(([key]) => key !== "mastra"),
  );
  return Object.keys(providerMetadata).length > 0
    ? providerMetadata
    : undefined;
}

function assertNoProviderOverrides(options: LanguageModelV3CallOptions): void {
  if (hasEntries(options.headers) || hasEntries(options.providerOptions)) {
    throw new Error(
      "Kanvas Agent Model does not accept caller-controlled Provider headers or options.",
    );
  }
}

function promptPart(
  part: Exclude<LanguageModelV3Message, { role: "system" }>["content"][number],
): KanvasAgentModelPromptPart {
  switch (part.type) {
    case "text":
      return Object.freeze({
        type: "text",
        text: part.text,
        ...(part.providerOptions
          ? { providerMetadata: part.providerOptions }
          : {}),
      });
    case "reasoning":
      return Object.freeze({
        type: "reasoning",
        text: part.text,
        ...(part.providerOptions
          ? { providerMetadata: part.providerOptions }
          : {}),
      });
    case "tool-call":
      if (part.providerExecuted) {
        throw new Error("Provider-executed Agent tools are not supported.");
      }
      return Object.freeze({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...(part.providerOptions
          ? { providerMetadata: part.providerOptions }
          : {}),
      });
    case "tool-result": {
      const providerMetadata = providerMetadataWithoutMastra(
        part.providerOptions,
      );
      return Object.freeze({
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: toolResultOutput(part.output, part.providerOptions),
        ...(providerMetadata ? { providerMetadata } : {}),
      });
    }
    case "file":
      if (
        !part.mediaType.startsWith("image/") ||
        !(
          part.data instanceof Uint8Array ||
          (part.data instanceof URL && part.data.protocol === "https:") ||
          (typeof part.data === "string" &&
            (part.data.startsWith("data:image/") ||
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
                part.data,
              )))
        )
      ) {
        throw new Error(
          "Agent Model file input is not a trusted image projection.",
        );
      }
      return Object.freeze({
        type: "file",
        data:
          typeof part.data === "string" && !part.data.startsWith("data:")
            ? new Uint8Array(Buffer.from(part.data, "base64"))
            : part.data,
        mediaType: part.mediaType,
        ...(part.filename ? { filename: part.filename } : {}),
        ...(part.providerOptions
          ? { providerMetadata: part.providerOptions }
          : {}),
      });
    case "tool-approval-response":
      throw new Error(
        "Provider-side Tool approval responses are not supported by Kanvas Agent Model.",
      );
  }
}

function promptMessage(
  message: LanguageModelV3Message,
): KanvasAgentModelMessage {
  if (message.role === "system") {
    return Object.freeze({ role: "system", content: message.content });
  }
  return Object.freeze({
    role: message.role,
    content: Object.freeze(message.content.map(promptPart)),
  });
}

function modelRequest(
  options: LanguageModelV3CallOptions,
  controls: AgentModelRuntimeControls,
  webSearchToolAvailable: boolean,
): KanvasAgentModelRequest {
  assertNoProviderOverrides(options);
  const tools = (options.tools ?? []).map((tool): KanvasAgentModelTool => {
    if (tool.type !== "function") {
      throw new Error("Provider-defined Agent tools are not supported.");
    }
    return Object.freeze({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
      ...(tool.strict === undefined ? {} : { strict: tool.strict }),
    });
  });

  return Object.freeze({
    schemaVersion: "kanvas.agent-model-request/v1",
    prompt: Object.freeze(options.prompt.map(promptMessage)),
    tools: Object.freeze(tools),
    controls,
    webSearchToolAvailable,
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    ...(options.responseFormat
      ? { responseFormat: options.responseFormat }
      : {}),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.stopSequences
      ? { stopSequences: Object.freeze([...options.stopSequences]) }
      : {}),
    ...(options.topP === undefined ? {} : { topP: options.topP }),
    ...(options.topK === undefined ? {} : { topK: options.topK }),
    ...(options.presencePenalty === undefined
      ? {}
      : { presencePenalty: options.presencePenalty }),
    ...(options.frequencyPenalty === undefined
      ? {}
      : { frequencyPenalty: options.frequencyPenalty }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });
}

function modelUsage(
  usage: KanvasAgentModelUsage | undefined,
): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage?.inputTokens,
      noCache: usage?.inputTokensNoCache,
      cacheRead: usage?.cacheReadTokens,
      cacheWrite: usage?.cacheWriteTokens,
    },
    outputTokens: {
      total: usage?.outputTokens,
      text: usage?.outputTextTokens,
      reasoning: usage?.reasoningTokens,
    },
  };
}

function finishReason(
  response: KanvasAgentModelResponse,
): LanguageModelV3FinishReason {
  return {
    unified: response.finishReason,
    raw: response.rawFinishReason,
  };
}

function modelContent(
  content: KanvasAgentModelResponseContent,
): LanguageModelV3Content {
  return content;
}

function generateResult(
  response: KanvasAgentModelResponse,
): LanguageModelV3GenerateResult {
  return {
    content: response.content.map(modelContent),
    finishReason: finishReason(response),
    usage: modelUsage(response.usage),
    warnings: [],
    response: {
      ...(response.responseId ? { id: response.responseId } : {}),
      ...(response.resolvedModelId
        ? { modelId: response.resolvedModelId }
        : {}),
      ...(response.startedAt ? { timestamp: response.startedAt } : {}),
    },
  };
}

export function createKanvasMastraModel(
  options: CreateKanvasMastraModelOptions,
): LanguageModelV3 {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(options.modelProfileKey)) {
    throw new Error("Kanvas Agent Model profile key is invalid.");
  }

  return Object.freeze({
    specificationVersion: "v3",
    provider: "kanvas",
    modelId: options.modelProfileKey,
    supportedUrls: { "image/*": [/^https:\/\//u] },
    doGenerate: async (callOptions) => {
      const response = await options.port.generate(
        modelRequest(
          callOptions,
          options.controls,
          options.webSearchToolAvailable === true,
        ),
        callOptions.abortSignal,
      );
      return generateResult(
        response.finishReason === "stop" ||
          response.finishReason === "tool-calls"
          ? response
          : {
              ...response,
              content: response.content.filter(
                (part) => part.type !== "tool-call",
              ),
            },
      );
    },
    doStream: async (callOptions) =>
      completedToolStream(
        await options.port.stream(
          modelRequest(
            callOptions,
            options.controls,
            options.webSearchToolAvailable === true,
          ),
          callOptions.abortSignal,
        ),
      ),
  });
}
