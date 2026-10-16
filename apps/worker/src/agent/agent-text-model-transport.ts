import type { AgentModelTransport } from "@kanvas/agent-runtime";
import type { ResolvedAgentModelBinding } from "@kanvas/database/runtime";
import type { ProviderSecretMaterialResolver } from "@kanvas/secrets";

import type { ProviderHttpTransport } from "../provider/provider-http-transport.js";
import { agentProviderReportedCharge } from "../provider/provider-reported-charge.js";
import {
  generateWithAiSdkAnthropic,
  generateWithAiSdkDeepSeek,
  generateWithAiSdkGemini,
  generateWithAiSdkOpenAICompatible,
  generateWithAiSdkOpenAIResponses,
  streamWithAiSdkAnthropic,
  streamWithAiSdkDeepSeek,
  streamWithAiSdkGemini,
  streamWithAiSdkOpenAICompatible,
  streamWithAiSdkOpenAIResponses,
} from "./ai-sdk-agent-model-transport.js";
import { effectiveAgentModelCapabilities } from "./effective-agent-model-capabilities.js";

export class AgentTextModelTransportError extends Error {
  public constructor(
    readonly code: string,
    readonly effect: "not_started" | "unknown",
  ) {
    super(code);
    this.name = "AgentTextModelTransportError";
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function credentialValue(material: Uint8Array): string {
  const value = Buffer.from(material).toString("utf8").trim();
  if (value.length < 1 || value.length > 4_096 || /[^\x21-\x7e]/u.test(value)) {
    throw new AgentTextModelTransportError(
      "agent.model_credential_invalid",
      "not_started",
    );
  }
  return value;
}

function providerErrorDetail(body: unknown): string {
  const error = record(record(body)?.error);
  const values = [error?.code, error?.param].flatMap((value) => {
    if (typeof value !== "string") return [];
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 32);
    return normalized ? [normalized] : [];
  });
  const providerMessage =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  const fields = [
    "reasoning_content",
    "tool_call_id",
    "tool_calls",
    "tool_choice",
    "messages",
    "assistant",
    "content",
  ].filter((candidate) => providerMessage.includes(candidate));
  return [...values, ...fields].join("_").slice(0, 48);
}

function responseErrorCode(statusCode: number, body: unknown): string {
  if (statusCode === 401 || statusCode === 403) {
    return "agent.model_provider_authentication_failed";
  }
  if (statusCode === 408 || statusCode === 504) {
    return "agent.model_provider_timeout";
  }
  if (statusCode === 429) return "agent.model_provider_rate_limited";
  if (statusCode >= 500) {
    return `agent.model_provider_unavailable_${String(statusCode)}`;
  }
  const detail = providerErrorDetail(body);
  return `agent.model_provider_rejected_${String(statusCode)}${
    detail ? `_${detail}` : ""
  }`.slice(0, 120);
}

function mapAiSdkFailure(error: unknown): never {
  let cause = error;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = record(cause);
    const statusCode = integer(candidate?.statusCode);
    if (statusCode !== undefined && statusCode >= 400) {
      throw new AgentTextModelTransportError(
        responseErrorCode(statusCode, candidate?.data),
        statusCode < 500 ? "not_started" : "unknown",
      );
    }
    const code = candidate?.code ?? candidate?.stableErrorCode;
    if (
      typeof code === "string" &&
      (code.startsWith("agent.") || code.startsWith("provider."))
    ) {
      throw cause;
    }
    if (
      typeof code === "string" &&
      [
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
      ].includes(code)
    ) {
      throw new AgentTextModelTransportError(
        "agent.model_provider_timeout",
        "unknown",
      );
    }
    if (
      typeof code === "string" &&
      [
        "ECONNRESET",
        "ECONNREFUSED",
        "EAI_AGAIN",
        "ENOTFOUND",
        "UND_ERR_SOCKET",
      ].includes(code)
    ) {
      throw new AgentTextModelTransportError(
        "agent.model_provider_transport_failed",
        "unknown",
      );
    }
    cause = candidate?.cause;
  }
  throw error;
}

function assertSurface(route: ResolvedAgentModelBinding): void {
  if (
    (route.protocolKind === "openai_chat" &&
      route.apiSurface !== "chat.completions.v1") ||
    (route.protocolKind === "deepseek_chat" &&
      route.apiSurface !== "chat.completions.v1") ||
    (route.protocolKind === "openai_responses" &&
      route.apiSurface !== "responses.v1") ||
    (route.protocolKind === "gemini_generate_content" &&
      route.apiSurface !== "generate-content.v1") ||
    (route.protocolKind === "anthropic_messages" &&
      route.apiSurface !== "messages.v1")
  ) {
    throw new AgentTextModelTransportError(
      "agent.model_surface_unsupported",
      "not_started",
    );
  }
}

export function agentReasoningEffort(
  route: ResolvedAgentModelBinding,
  requested: "off" | "low" | "medium" | "high" = "medium",
): "low" | "medium" | "high" | undefined {
  if (requested === "off") return undefined;
  try {
    const values = effectiveAgentModelCapabilities(route).reasoningLevels;
    return values.includes(requested) ? requested : undefined;
  } catch {
    return undefined;
  }
}

export function agentWebSearchEnabled(
  route: ResolvedAgentModelBinding,
  mode: "off" | "auto" | "required" = "auto",
): boolean {
  if (mode === "off") return false;
  try {
    return effectiveAgentModelCapabilities(route).webSearch === "native";
  } catch {
    return false;
  }
}

export function createAgentTextModelTransport(options: {
  readonly http: ProviderHttpTransport;
  readonly secrets: ProviderSecretMaterialResolver;
}): AgentModelTransport<ResolvedAgentModelBinding> {
  const modelOptions = (
    route: ResolvedAgentModelBinding,
    request: Parameters<
      AgentModelTransport<ResolvedAgentModelBinding>["generate"]
    >[0]["request"],
    signal: AbortSignal | undefined,
    key: Uint8Array,
  ) => ({
    http: options.http,
    route,
    key: credentialValue(key),
    request,
    ...(signal ? { signal } : {}),
  });
  const generate: AgentModelTransport<ResolvedAgentModelBinding>["generate"] =
    async ({ route, request, signal }) => {
      assertSurface(route);
      return options.secrets.withResolvedMaterial(route.secret, async (key) => {
        const invocation = modelOptions(route, request, signal, key);
        try {
          switch (route.protocolKind) {
            case "openai_chat":
              return await generateWithAiSdkOpenAICompatible(invocation);
            case "deepseek_chat":
              return await generateWithAiSdkDeepSeek(invocation);
            case "openai_responses":
              return await generateWithAiSdkOpenAIResponses(invocation);
            case "gemini_generate_content":
              return await generateWithAiSdkGemini(invocation);
            case "anthropic_messages":
              return await generateWithAiSdkAnthropic(invocation);
          }
        } catch (error) {
          return mapAiSdkFailure(error);
        }
      });
    };
  const stream: AgentModelTransport<ResolvedAgentModelBinding>["stream"] =
    async ({ route, request, signal }) => {
      assertSurface(route);
      return options.secrets.withResolvedMaterial(route.secret, async (key) => {
        const invocation = modelOptions(route, request, signal, key);
        try {
          switch (route.protocolKind) {
            case "openai_chat":
              return await streamWithAiSdkOpenAICompatible(invocation);
            case "deepseek_chat":
              return await streamWithAiSdkDeepSeek(invocation);
            case "openai_responses":
              return await streamWithAiSdkOpenAIResponses(invocation);
            case "gemini_generate_content":
              return await streamWithAiSdkGemini(invocation);
            case "anthropic_messages":
              return await streamWithAiSdkAnthropic(invocation);
          }
        } catch (error) {
          return mapAiSdkFailure(error);
        }
      });
    };
  const reportedCharge: NonNullable<
    AgentModelTransport<ResolvedAgentModelBinding>["reportedCharge"]
  > = ({ route, rawUsage }) => agentProviderReportedCharge(route, rawUsage);
  return Object.freeze({
    generate,
    stream,
    reportedCharge,
  });
}
