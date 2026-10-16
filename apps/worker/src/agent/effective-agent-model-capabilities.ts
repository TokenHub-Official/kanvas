import {
  parseModelProfileDocumentV1,
  parseTextGenerationModelProfile,
  type ModelProfileModality,
} from "@kanvas/application";
import type { ResolvedAgentModelBinding } from "@kanvas/database/runtime";

export interface EffectiveAgentModelCapabilities {
  readonly inputModalities: readonly ModelProfileModality[];
  readonly outputModalities: readonly ModelProfileModality[];
  readonly reasoning: boolean;
  readonly reasoningLevels: readonly ("low" | "medium" | "high")[];
  readonly webSearch: "native" | "none";
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly acceptedProviderParameters: ReadonlySet<string>;
}

export type EffectiveAgentWebSearchMode =
  "native" | "tool" | "disabled" | "unavailable";

export function selectAgentWebSearchMode(options: {
  readonly requested: "off" | "auto" | "required";
  readonly nativeAvailable: boolean;
  readonly nativeToolCompatible: boolean;
  readonly toolAvailable: boolean;
}): EffectiveAgentWebSearchMode {
  if (options.requested === "off") return "disabled";
  if (options.nativeAvailable && options.nativeToolCompatible) return "native";
  if (options.toolAvailable) return "tool";
  return options.requested === "required" ? "unavailable" : "disabled";
}

export function effectiveAgentModelCapabilities(
  route: Pick<ResolvedAgentModelBinding, "modelProfile" | "protocolKind">,
): EffectiveAgentModelCapabilities {
  const textProfile = parseTextGenerationModelProfile(route.modelProfile);
  const acceptedProviderParameters = new Set(
    textProfile.parameters.map((parameter) => parameter.key),
  );
  const reasoning = textProfile.parameters.find(
    (parameter) =>
      parameter.key === "reasoningEffort" && parameter.valueType === "enum",
  );
  const reasoningLevels =
    reasoning?.valueType === "enum"
      ? reasoning.values.filter(
          (value): value is "low" | "medium" | "high" =>
            value === "low" || value === "medium" || value === "high",
        )
      : [];
  const profile = parseModelProfileDocumentV1(route.modelProfile);
  if (profile.model.maximumOutputTokens !== undefined) {
    acceptedProviderParameters.add("maxOutputTokens");
  }
  if (profile.model.temperature === true) {
    acceptedProviderParameters.add("temperature");
  }
  if (profile.model.structuredOutput === true) {
    acceptedProviderParameters.add("responseFormat");
  }
  return Object.freeze({
    inputModalities: profile.model.inputModalities,
    outputModalities: profile.model.outputModalities,
    reasoning: profile.model.reasoning === true,
    reasoningLevels: Object.freeze(reasoningLevels),
    webSearch:
      acceptedProviderParameters.has("webSearch") &&
      (route.protocolKind === "openai_responses" ||
        route.protocolKind === "gemini_generate_content" ||
        route.protocolKind === "anthropic_messages")
        ? "native"
        : "none",
    toolCalling: profile.model.toolCall === true,
    structuredOutput: profile.model.structuredOutput === true,
    acceptedProviderParameters,
  });
}
