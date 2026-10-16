import {
  ProviderModelContractError,
  resolveProviderModelParameters,
  type ProviderModelCapabilityKey,
  type ProviderModelEvidence,
  type ProviderModelParameterDefinition,
  type ProviderModelParameterPolicies,
  type ProviderModelParameterPolicy,
  type ProviderModelParameterValue,
  type ProviderParameterResolution,
} from "@kanvas/contracts/provider-model";

import type { ModelProfileDocumentV1 } from "./model-profile.js";
import { DomainError } from "../../foundation/domain-error.js";

export interface ModelProfileOperation {
  readonly parameters: readonly ProviderModelParameterDefinition[];
  readonly evidence: readonly ProviderModelEvidence[];
}

export interface CompileProviderParameterPolicyForProfileOptions {
  readonly modelProfile: ModelProfileDocumentV1;
  readonly capabilityKey: ProviderModelCapabilityKey;
  readonly capabilityParameterKeys: readonly string[];
  readonly routeParameterPolicies: unknown;
}

export interface CompileEffectiveProviderParametersForProfileOptions extends CompileProviderParameterPolicyForProfileOptions {
  readonly callerParameterValues: unknown;
}

export interface CompiledProviderParameterPolicy {
  readonly modelProfile: ModelProfileDocumentV1;
  readonly operation: ModelProfileOperation;
  readonly policies: ProviderModelParameterPolicies;
  readonly capabilityParameterKeys: readonly string[];
}

const operationKeys = new Set(["parameters", "evidence"]);
const evidenceKeys = new Set([
  "kind",
  "reference",
  "observedAt",
  "sourceDigest",
  "confidence",
  "claim",
]);
const commonParameterKeys = [
  "key",
  "label",
  "description",
  "required",
  "evidence",
] as const;
const enumParameterKeys = new Set([
  ...commonParameterKeys,
  "valueType",
  "values",
]);
const integerParameterKeys = new Set([
  ...commonParameterKeys,
  "valueType",
  "minimum",
  "maximum",
  "step",
]);
const booleanParameterKeys = new Set([...commonParameterKeys, "valueType"]);
const stringParameterKeys = new Set([
  ...commonParameterKeys,
  "valueType",
  "maxLength",
]);
const routeParameterPolicyKeys = new Set([
  "callerPolicy",
  "defaultValue",
  "allowedValues",
  "minimum",
  "maximum",
]);
const capabilityKeys = new Set<ProviderModelCapabilityKey>([
  "text.generate",
  "image.generate",
  "image.edit",
]);
const parameterKeyPattern = /^[a-zA-Z][a-zA-Z0-9]*$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const minimumProviderInteger = -2_147_483_647;
const maximumProviderInteger = 4_294_967_295;

function invalidProfile(message: string): never {
  throw new DomainError("model_profile.invalid", message);
}

function invalidParameters(message: string, cause?: unknown): never {
  throw new DomainError(
    "effective_provider_parameters.invalid",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function plainRecord(
  value: unknown,
  label: string,
  invalid: (message: string) => never,
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

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
  invalid: (message: string) => never,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    invalid(`${label} contains unknown field ${unknown}.`);
  }
}

function boundedString(
  value: unknown,
  label: string,
  maximumLength: number,
  invalid: (message: string) => never,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    return invalid(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function parameterKey(
  value: unknown,
  label: string,
  invalid: (message: string) => never,
): string {
  const parsed = boundedString(value, label, 80, invalid);
  if (!parameterKeyPattern.test(parsed)) {
    return invalid(`${label} has an invalid format.`);
  }
  return parsed;
}

function parameterValue(
  value: unknown,
  label: string,
  invalid: (message: string) => never,
): ProviderModelParameterValue {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return invalid(`${label} must be a scalar JSON value.`);
  }
  if (
    (typeof value === "string" && (value.length < 1 || value.length > 255)) ||
    (typeof value === "number" &&
      (!Number.isSafeInteger(value) ||
        value < minimumProviderInteger ||
        value > maximumProviderInteger))
  ) {
    return invalid(`${label} is outside the bounded scalar contract.`);
  }
  return value;
}

function uniqueParameterValues(
  value: unknown,
  label: string,
  invalid: (message: string) => never,
): readonly ProviderModelParameterValue[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    return invalid(`${label} must contain between 1 and 128 values.`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((candidate, index) => {
      const parsed = parameterValue(
        candidate,
        `${label}[${String(index)}]`,
        invalid,
      );
      const identity = `${typeof parsed}:${String(parsed)}`;
      if (seen.has(identity)) {
        return invalid(`${label} contains a duplicate value.`);
      }
      seen.add(identity);
      return parsed;
    }),
  );
}

function evidenceList(
  value: unknown,
  label: string,
): readonly ProviderModelEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    return invalidProfile(`${label} must contain between 1 and 16 entries.`);
  }
  return Object.freeze(
    value.map((candidate, index) => {
      const itemLabel = `${label}[${String(index)}]`;
      const record = plainRecord(candidate, itemLabel, invalidProfile);
      rejectUnknownKeys(record, evidenceKeys, itemLabel, invalidProfile);
      if (
        record.kind !== "provider_api" &&
        record.kind !== "adapter_manifest" &&
        record.kind !== "administrator"
      ) {
        return invalidProfile(`${itemLabel}.kind is unsupported.`);
      }
      if (
        typeof record.observedAt !== "string" ||
        Number.isNaN(Date.parse(record.observedAt)) ||
        new Date(record.observedAt).toISOString() !== record.observedAt
      ) {
        return invalidProfile(
          `${itemLabel}.observedAt must be a canonical timestamp.`,
        );
      }
      if (
        typeof record.sourceDigest !== "string" ||
        !digestPattern.test(record.sourceDigest)
      ) {
        return invalidProfile(`${itemLabel}.sourceDigest must be canonical.`);
      }
      if (
        record.confidence !== "high" &&
        record.confidence !== "medium" &&
        record.confidence !== "low"
      ) {
        return invalidProfile(`${itemLabel}.confidence is unsupported.`);
      }
      if (
        record.claim !== "identity" &&
        record.claim !== "supported" &&
        record.claim !== "unsupported" &&
        record.claim !== "unknown"
      ) {
        return invalidProfile(`${itemLabel}.claim is unsupported.`);
      }
      return Object.freeze({
        kind: record.kind,
        reference: boundedString(
          record.reference,
          `${itemLabel}.reference`,
          255,
          invalidProfile,
        ),
        observedAt: record.observedAt,
        sourceDigest: record.sourceDigest,
        confidence: record.confidence,
        claim: record.claim,
      });
    }),
  );
}

function parameterDefinition(
  value: unknown,
  label: string,
): ProviderModelParameterDefinition {
  const record = plainRecord(value, label, invalidProfile);
  const valueType = record.valueType;
  let allowedKeys: ReadonlySet<string> | undefined;
  if (valueType === "enum") {
    allowedKeys = enumParameterKeys;
  } else if (valueType === "integer") {
    allowedKeys = integerParameterKeys;
  } else if (valueType === "boolean") {
    allowedKeys = booleanParameterKeys;
  } else if (valueType === "string") {
    allowedKeys = stringParameterKeys;
  }
  if (!allowedKeys) {
    return invalidProfile(`${label}.valueType is unsupported.`);
  }
  rejectUnknownKeys(record, allowedKeys, label, invalidProfile);
  if (record.required !== true && record.required !== false) {
    return invalidProfile(`${label}.required must be a boolean.`);
  }
  const common = {
    key: parameterKey(record.key, `${label}.key`, invalidProfile),
    label: boundedString(record.label, `${label}.label`, 120, invalidProfile),
    ...(record.description === undefined
      ? {}
      : {
          description: boundedString(
            record.description,
            `${label}.description`,
            500,
            invalidProfile,
          ),
        }),
    required: record.required,
    evidence: evidenceList(record.evidence, `${label}.evidence`),
  };
  if (valueType === "enum") {
    return Object.freeze({
      ...common,
      valueType,
      values: uniqueParameterValues(
        record.values,
        `${label}.values`,
        invalidProfile,
      ),
    });
  }
  if (valueType === "integer") {
    if (
      !Number.isSafeInteger(record.minimum) ||
      !Number.isSafeInteger(record.maximum) ||
      (record.minimum as number) < minimumProviderInteger ||
      (record.maximum as number) > maximumProviderInteger ||
      (record.minimum as number) > (record.maximum as number) ||
      (record.step !== undefined &&
        (!Number.isSafeInteger(record.step) ||
          (record.step as number) < 1 ||
          (record.step as number) > maximumProviderInteger))
    ) {
      return invalidProfile(`${label} has an invalid integer range.`);
    }
    return Object.freeze({
      ...common,
      valueType,
      minimum: record.minimum as number,
      maximum: record.maximum as number,
      ...(record.step === undefined ? {} : { step: record.step as number }),
    });
  }
  if (valueType === "boolean") {
    return Object.freeze({
      ...common,
      valueType,
    });
  }
  if (
    !Number.isSafeInteger(record.maxLength) ||
    (record.maxLength as number) < 1 ||
    (record.maxLength as number) > 32_000
  ) {
    return invalidProfile(`${label}.maxLength is invalid.`);
  }
  return Object.freeze({
    ...common,
    valueType: "string" as const,
    maxLength: record.maxLength as number,
  });
}

function modelOperation(value: unknown, label: string): ModelProfileOperation {
  const record = plainRecord(value, label, invalidProfile);
  rejectUnknownKeys(record, operationKeys, label, invalidProfile);
  if (!Array.isArray(record.parameters) || record.parameters.length > 64) {
    return invalidProfile(
      `${label}.parameters must contain at most 64 entries.`,
    );
  }
  const parameterKeys = new Set<string>();
  const parameters = Object.freeze(
    record.parameters.map((candidate, index) => {
      const parsed = parameterDefinition(
        candidate,
        `${label}.parameters[${String(index)}]`,
      );
      if (parameterKeys.has(parsed.key)) {
        return invalidProfile(
          `${label}.parameters contains duplicate key ${parsed.key}.`,
        );
      }
      parameterKeys.add(parsed.key);
      return parsed;
    }),
  );
  return Object.freeze({
    parameters,
    evidence: evidenceList(record.evidence, `${label}.evidence`),
  });
}

export function parseModelProfileOperations(
  value: unknown,
  label = "Model profile operations",
): Readonly<
  Partial<Record<ProviderModelCapabilityKey, ModelProfileOperation>>
> {
  const operationsRecord = plainRecord(value, label, invalidProfile);
  const operationEntries = Object.entries(operationsRecord);
  if (operationEntries.length < 1) {
    return invalidProfile(`${label} must contain at least one operation.`);
  }
  if (operationEntries.length > capabilityKeys.size) {
    return invalidProfile(`${label} contains too many operations.`);
  }
  const operations: Partial<
    Record<ProviderModelCapabilityKey, ModelProfileOperation>
  > = {};
  for (const [key, operation] of operationEntries) {
    if (!capabilityKeys.has(key as ProviderModelCapabilityKey)) {
      return invalidProfile(`${label} contains unsupported operation ${key}.`);
    }
    const capabilityKey = key as ProviderModelCapabilityKey;
    operations[capabilityKey] = modelOperation(
      operation,
      `${label}.${capabilityKey}`,
    );
  }
  return Object.freeze(operations);
}

export function parseProviderModelParameterPolicies(
  value: unknown,
): ProviderModelParameterPolicies {
  const record = plainRecord(
    value,
    "Route parameter policies",
    invalidParameters,
  );
  if (Object.keys(record).length > 64) {
    return invalidParameters(
      "Route parameter policies may contain at most 64 entries.",
    );
  }
  const result: Record<string, ProviderModelParameterPolicy> = {};
  for (const [key, candidate] of Object.entries(record)) {
    parameterKey(key, `Route parameter policy key ${key}`, invalidParameters);
    const label = `Route parameter policy ${key}`;
    const policy = plainRecord(candidate, label, invalidParameters);
    rejectUnknownKeys(
      policy,
      routeParameterPolicyKeys,
      label,
      invalidParameters,
    );
    if (
      policy.callerPolicy !== "fixed" &&
      policy.callerPolicy !== "optional" &&
      policy.callerPolicy !== "required"
    ) {
      return invalidParameters(`${label}.callerPolicy is unsupported.`);
    }
    const hasDefault = Object.hasOwn(policy, "defaultValue");
    if (policy.callerPolicy === "fixed" && !hasDefault) {
      return invalidParameters(
        `${label} is fixed and requires a default value.`,
      );
    }
    if (policy.callerPolicy === "required" && hasDefault) {
      return invalidParameters(
        `${label} is required and cannot define a default value.`,
      );
    }
    const minimum =
      policy.minimum === undefined
        ? undefined
        : integerBound(policy.minimum, `${label}.minimum`);
    const maximum =
      policy.maximum === undefined
        ? undefined
        : integerBound(policy.maximum, `${label}.maximum`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      return invalidParameters(`${label} has an invalid numeric range.`);
    }
    result[key] = Object.freeze({
      callerPolicy: policy.callerPolicy,
      ...(hasDefault
        ? {
            defaultValue: parameterValue(
              policy.defaultValue,
              `${label}.defaultValue`,
              invalidParameters,
            ),
          }
        : {}),
      ...(policy.allowedValues === undefined
        ? {}
        : {
            allowedValues: uniqueParameterValues(
              policy.allowedValues,
              `${label}.allowedValues`,
              invalidParameters,
            ),
          }),
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
    });
  }
  return Object.freeze(result);
}

function integerBound(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimumProviderInteger ||
    value > maximumProviderInteger
  ) {
    return invalidParameters(`${label} must be a bounded integer.`);
  }
  return value;
}

function capabilityParameterKeySet(
  value: readonly string[],
): ReadonlySet<string> {
  if (value.length > 64) {
    return invalidParameters(
      "Capability parameter keys may contain at most 64 entries.",
    );
  }
  const result = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const key = parameterKey(
      candidate,
      `Capability parameter keys[${String(index)}]`,
      invalidParameters,
    );
    if (result.has(key)) {
      return invalidParameters(
        "Capability parameter keys contains a duplicate value.",
      );
    }
    result.add(key);
  }
  return result;
}

function callerParameterRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const record = plainRecord(
    value,
    "Caller parameter values",
    invalidParameters,
  );
  if (Object.keys(record).length > 64) {
    return invalidParameters(
      "Caller parameter values may contain at most 64 entries.",
    );
  }
  for (const key of Object.keys(record)) {
    parameterKey(key, `Caller parameter key ${key}`, invalidParameters);
  }
  return record;
}

function sameParameterValue(
  left: ProviderModelParameterValue,
  right: ProviderModelParameterValue,
): boolean {
  return typeof left === typeof right && left === right;
}

function valueSupportedByModel(
  definition: ProviderModelParameterDefinition,
  value: ProviderModelParameterValue,
): boolean {
  if (definition.valueType === "enum") {
    return definition.values.some((candidate) =>
      sameParameterValue(candidate, value),
    );
  }
  if (definition.valueType === "integer") {
    return (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= definition.minimum &&
      value <= definition.maximum &&
      (definition.step === undefined ||
        (value - definition.minimum) % definition.step === 0)
    );
  }
  if (definition.valueType === "boolean") {
    return typeof value === "boolean";
  }
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= definition.maxLength
  );
}

function validateRoutePolicyAgainstModel(
  definition: ProviderModelParameterDefinition,
  policy: ProviderModelParameterPolicy,
): void {
  if (
    definition.valueType !== "integer" &&
    (policy.minimum !== undefined || policy.maximum !== undefined)
  ) {
    invalidParameters(
      `Route policy for ${definition.key} uses numeric bounds for a non-integer model parameter.`,
    );
  }
  if (
    definition.valueType === "integer" &&
    ((policy.minimum !== undefined && policy.minimum < definition.minimum) ||
      (policy.maximum !== undefined && policy.maximum > definition.maximum))
  ) {
    invalidParameters(
      `Route policy for ${definition.key} exceeds the model capability.`,
    );
  }
  if (
    policy.allowedValues?.some(
      (value) => !valueSupportedByModel(definition, value),
    )
  ) {
    invalidParameters(
      `Route policy for ${definition.key} exceeds the model capability.`,
    );
  }
  if (
    policy.allowedValues?.some(
      (value) =>
        typeof value === "number" &&
        ((policy.minimum !== undefined && value < policy.minimum) ||
          (policy.maximum !== undefined && value > policy.maximum)),
    )
  ) {
    invalidParameters(
      `Route policy for ${definition.key} has values outside its own numeric bounds.`,
    );
  }
  if (
    definition.valueType === "integer" &&
    !integerDomainHasValue(definition, policy)
  ) {
    invalidParameters(
      `Route policy for ${definition.key} has an empty intersection with the model capability.`,
    );
  }
  if (
    policy.defaultValue !== undefined &&
    (!valueSupportedByModel(definition, policy.defaultValue) ||
      (policy.allowedValues !== undefined &&
        !policy.allowedValues.some((candidate) =>
          sameParameterValue(candidate, policy.defaultValue!),
        )) ||
      (typeof policy.defaultValue === "number" &&
        ((policy.minimum !== undefined &&
          policy.defaultValue < policy.minimum) ||
          (policy.maximum !== undefined &&
            policy.defaultValue > policy.maximum))))
  ) {
    invalidParameters(
      `Route default for ${definition.key} is outside the effective model and route bounds.`,
    );
  }
}

function integerDomainHasValue(
  definition: Extract<
    ProviderModelParameterDefinition,
    { readonly valueType: "integer" }
  >,
  policy: ProviderModelParameterPolicy,
): boolean {
  if (policy.allowedValues) {
    return policy.allowedValues.length > 0;
  }
  const minimum = Math.max(
    definition.minimum,
    policy.minimum ?? definition.minimum,
  );
  const maximum = Math.min(
    definition.maximum,
    policy.maximum ?? definition.maximum,
  );
  const step = definition.step ?? 1;
  const offset = minimum - definition.minimum;
  const first =
    offset % step === 0 ? minimum : minimum + (step - (offset % step));
  return first <= maximum;
}

export function compileProviderParameterPolicyForProfile(
  options: CompileProviderParameterPolicyForProfileOptions,
): CompiledProviderParameterPolicy {
  const profile = options.modelProfile;
  const operation = profile.operations[options.capabilityKey];
  if (!operation) {
    return invalidParameters(
      `Model profile does not support capability ${options.capabilityKey}.`,
    );
  }
  const capabilityParameters = capabilityParameterKeySet(
    options.capabilityParameterKeys,
  );
  const policies = parseProviderModelParameterPolicies(
    options.routeParameterPolicies,
  );
  const definitions = new Map(
    operation.parameters.map((definition) => [definition.key, definition]),
  );
  for (const key of Object.keys(policies)) {
    if (!capabilityParameters.has(key)) {
      return invalidParameters(
        `Route parameter policy ${key} is not allowed by the Capability Contract.`,
      );
    }
    const definition = definitions.get(key);
    if (!definition) {
      return invalidParameters(
        `Route parameter policy ${key} is not supported by the model profile.`,
      );
    }
    validateRoutePolicyAgainstModel(definition, policies[key]!);
  }
  for (const definition of operation.parameters) {
    if (definition.required && !policies[definition.key]) {
      return invalidParameters(
        `Required model parameter ${definition.key} has no Route policy.`,
      );
    }
  }
  return Object.freeze({
    modelProfile: profile,
    operation,
    policies,
    capabilityParameterKeys: Object.freeze([...capabilityParameters]),
  });
}

export function compileEffectiveProviderParametersForProfile(
  options: CompileEffectiveProviderParametersForProfileOptions,
): ProviderParameterResolution {
  const compiled = compileProviderParameterPolicyForProfile(options);
  const callerValues = callerParameterRecord(options.callerParameterValues);
  const definitions = new Map(
    compiled.operation.parameters.map((definition) => [
      definition.key,
      definition,
    ]),
  );
  const capabilityParameters = new Set(compiled.capabilityParameterKeys);
  for (const key of Object.keys(callerValues)) {
    if (!capabilityParameters.has(key)) {
      return invalidParameters(
        `Caller parameter ${key} is not allowed by the Capability Contract.`,
      );
    }
    if (!definitions.has(key)) {
      return invalidParameters(
        `Caller parameter ${key} is not supported by the model profile.`,
      );
    }
    if (!compiled.policies[key]) {
      return invalidParameters(
        `Caller parameter ${key} is not enabled by the Route policy.`,
      );
    }
  }
  try {
    return resolveProviderModelParameters({
      definitions: compiled.operation.parameters,
      policies: compiled.policies,
      callerValues,
    });
  } catch (error) {
    if (error instanceof ProviderModelContractError) {
      return invalidParameters(error.message, error);
    }
    throw error;
  }
}
