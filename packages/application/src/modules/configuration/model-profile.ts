import type {
  ProviderModelCapabilityKey,
  ProviderModelParameterDefinition,
  ProviderParameterResolution,
} from "@kanvas/contracts/provider-model";

import { DomainError } from "../../foundation/domain-error.js";
import {
  compileEffectiveProviderParametersForProfile,
  compileProviderParameterPolicyForProfile,
  parseModelProfileOperations,
  type CompiledProviderParameterPolicy,
  type ModelProfileOperation,
} from "./provider-parameter-policy.js";

export type ModelProfileModality =
  "text" | "image" | "mask" | "audio" | "video" | "pdf";

export interface ModelProfileSource {
  readonly kind: "models_dev" | "provider" | "manual";
  readonly reference: string;
  readonly observedAt: string;
  readonly sourceDigest: string;
}

export interface ModelProfileIdentity {
  readonly slug?: string;
  readonly displayName: string;
  readonly family: string;
  readonly description?: string;
  readonly inputModalities: readonly ModelProfileModality[];
  readonly outputModalities: readonly ModelProfileModality[];
  readonly contextWindow?: number;
  readonly maximumInputTokens?: number;
  readonly maximumOutputTokens?: number;
  readonly attachment?: boolean;
  readonly reasoning?: boolean;
  readonly toolCall?: boolean;
  readonly structuredOutput?: boolean;
  readonly temperature?: boolean;
}

export interface ModelProfileDocumentV1 {
  readonly schemaVersion: 1;
  readonly model: ModelProfileIdentity;
  readonly operations: Readonly<
    Partial<Record<ProviderModelCapabilityKey, ModelProfileOperation>>
  >;
  readonly sources: readonly ModelProfileSource[];
}

export interface TextGenerationModelProfile {
  readonly displayName: string;
  readonly parameters: readonly ProviderModelParameterDefinition[];
}

export interface CompileProviderParameterPolicyOptions {
  readonly modelProfileDocument: unknown;
  readonly capabilityKey: ProviderModelCapabilityKey;
  readonly capabilityParameterKeys: readonly string[];
  readonly routeParameterPolicies: unknown;
}

export interface CompileEffectiveProviderParametersOptions extends CompileProviderParameterPolicyOptions {
  readonly callerParameterValues: unknown;
}

const profileKeys = new Set([
  "schemaVersion",
  "model",
  "operations",
  "sources",
]);
const modelKeys = new Set([
  "slug",
  "displayName",
  "family",
  "description",
  "inputModalities",
  "outputModalities",
  "contextWindow",
  "maximumInputTokens",
  "maximumOutputTokens",
  "attachment",
  "reasoning",
  "toolCall",
  "structuredOutput",
  "temperature",
]);
const sourceKeys = new Set(["kind", "reference", "observedAt", "sourceDigest"]);
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u;
const familyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const modalitySet = new Set<ModelProfileModality>([
  "text",
  "image",
  "mask",
  "audio",
  "video",
  "pdf",
]);

function invalid(message: string): never {
  throw new DomainError("model_profile.invalid", message);
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalid(`${label} must be a plain JSON object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    )
  ) {
    return invalid(`${label} must contain enumerable data properties only.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function rejectUnknown(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) invalid(`${label} contains unknown field ${unknown}.`);
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    return invalid(`${label} must be bounded printable text.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return invalid(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return invalid(`${label} must be boolean.`);
  return value;
}

function modalities(
  value: unknown,
  label: string,
): readonly ModelProfileModality[] {
  if (!Array.isArray(value) || value.length > modalitySet.size) {
    return invalid(`${label} must be a bounded modality array.`);
  }
  const parsed = value.map((item) => {
    if (
      typeof item !== "string" ||
      !modalitySet.has(item as ModelProfileModality)
    ) {
      return invalid(`${label} contains an unsupported modality.`);
    }
    return item as ModelProfileModality;
  });
  if (new Set(parsed).size !== parsed.length) {
    return invalid(`${label} contains a duplicate modality.`);
  }
  return Object.freeze(parsed);
}

function sources(value: unknown): readonly ModelProfileSource[] {
  if (!Array.isArray(value) || value.length > 32) {
    return invalid("Model profile sources must be a bounded array.");
  }
  return Object.freeze(
    value.map((candidate, index) => {
      const label = `Model profile sources[${String(index)}]`;
      const source = record(candidate, label);
      rejectUnknown(source, sourceKeys, label);
      if (
        source.kind !== "models_dev" &&
        source.kind !== "provider" &&
        source.kind !== "manual"
      ) {
        return invalid(`${label}.kind is unsupported.`);
      }
      const observedAt = text(source.observedAt, `${label}.observedAt`, 40);
      if (!Number.isFinite(Date.parse(observedAt))) {
        return invalid(`${label}.observedAt is invalid.`);
      }
      const sourceDigest = text(
        source.sourceDigest,
        `${label}.sourceDigest`,
        71,
      );
      if (!digestPattern.test(sourceDigest)) {
        return invalid(`${label}.sourceDigest is invalid.`);
      }
      return Object.freeze({
        kind: source.kind,
        reference: text(source.reference, `${label}.reference`, 512),
        observedAt,
        sourceDigest,
      });
    }),
  );
}

function optionalField<T>(key: string, value: T | undefined) {
  return value === undefined ? {} : { [key]: value };
}

export function parseModelProfileDocumentV1(
  value: unknown,
): ModelProfileDocumentV1 {
  const input = record(value, "Model profile");
  rejectUnknown(input, profileKeys, "Model profile");
  if (input.schemaVersion !== 1) {
    return invalid("Model profile schemaVersion must equal 1.");
  }
  const model = record(input.model, "Model profile model");
  rejectUnknown(model, modelKeys, "Model profile model");
  const slug =
    model.slug === undefined
      ? undefined
      : text(model.slug, "Model profile model.slug", 160);
  if (slug !== undefined && !slugPattern.test(slug)) {
    return invalid("Model profile model.slug is invalid.");
  }
  const family = text(model.family, "Model profile model.family", 160);
  if (!familyPattern.test(family)) {
    return invalid("Model profile model.family is invalid.");
  }
  const contextWindow = optionalPositiveInteger(
    model.contextWindow,
    "Model profile model.contextWindow",
  );
  const maximumInputTokens = optionalPositiveInteger(
    model.maximumInputTokens,
    "Model profile model.maximumInputTokens",
  );
  const maximumOutputTokens = optionalPositiveInteger(
    model.maximumOutputTokens,
    "Model profile model.maximumOutputTokens",
  );
  if (
    contextWindow !== undefined &&
    maximumInputTokens !== undefined &&
    maximumInputTokens > contextWindow
  ) {
    return invalid("Model profile maximum input exceeds context window.");
  }
  return Object.freeze({
    schemaVersion: 1,
    model: Object.freeze({
      ...optionalField("slug", slug),
      displayName: text(
        model.displayName,
        "Model profile model.displayName",
        160,
      ),
      family,
      ...optionalField(
        "description",
        model.description === undefined
          ? undefined
          : text(model.description, "Model profile model.description", 10_000),
      ),
      inputModalities: modalities(
        model.inputModalities,
        "Model profile model.inputModalities",
      ),
      outputModalities: modalities(
        model.outputModalities,
        "Model profile model.outputModalities",
      ),
      ...optionalField("contextWindow", contextWindow),
      ...optionalField("maximumInputTokens", maximumInputTokens),
      ...optionalField("maximumOutputTokens", maximumOutputTokens),
      ...optionalField(
        "attachment",
        optionalBoolean(model.attachment, "Model profile model.attachment"),
      ),
      ...optionalField(
        "reasoning",
        optionalBoolean(model.reasoning, "Model profile model.reasoning"),
      ),
      ...optionalField(
        "toolCall",
        optionalBoolean(model.toolCall, "Model profile model.toolCall"),
      ),
      ...optionalField(
        "structuredOutput",
        optionalBoolean(
          model.structuredOutput,
          "Model profile model.structuredOutput",
        ),
      ),
      ...optionalField(
        "temperature",
        optionalBoolean(model.temperature, "Model profile model.temperature"),
      ),
    }),
    operations: parseModelProfileOperations(input.operations),
    sources: sources(input.sources),
  });
}

export function parseTextGenerationModelProfile(
  value: unknown,
): TextGenerationModelProfile {
  const profile = parseModelProfileDocumentV1(value);
  const operation = profile.operations["text.generate"];
  if (!operation) {
    return invalid("Model profile does not support text generation.");
  }
  return Object.freeze({
    displayName: profile.model.displayName,
    parameters: operation.parameters,
  });
}

export function compileProviderParameterPolicy(
  options: CompileProviderParameterPolicyOptions,
): CompiledProviderParameterPolicy {
  return compileProviderParameterPolicyForProfile({
    modelProfile: parseModelProfileDocumentV1(options.modelProfileDocument),
    capabilityKey: options.capabilityKey,
    capabilityParameterKeys: options.capabilityParameterKeys,
    routeParameterPolicies: options.routeParameterPolicies,
  });
}

export function compileEffectiveProviderParameters(
  options: CompileEffectiveProviderParametersOptions,
): ProviderParameterResolution {
  return compileEffectiveProviderParametersForProfile({
    modelProfile: parseModelProfileDocumentV1(options.modelProfileDocument),
    capabilityKey: options.capabilityKey,
    capabilityParameterKeys: options.capabilityParameterKeys,
    routeParameterPolicies: options.routeParameterPolicies,
    callerParameterValues: options.callerParameterValues,
  });
}
