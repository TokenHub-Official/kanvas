export type ProviderModelCapabilityKey =
  "text.generate" | "image.generate" | "image.edit";

const providerModelCapabilityKeys = new Set<ProviderModelCapabilityKey>([
  "text.generate",
  "image.generate",
  "image.edit",
]);

export function isProviderModelCapabilityKey(
  value: string,
): value is ProviderModelCapabilityKey {
  return providerModelCapabilityKeys.has(value as ProviderModelCapabilityKey);
}

export type ProviderModelModality = "text" | "image" | "mask";

export type ProviderModelCatalogCompleteness =
  "identity_only" | "partial" | "complete";

export type ProviderModelEvidenceKind =
  "provider_api" | "adapter_manifest" | "administrator";

export type ProviderModelEvidenceConfidence = "high" | "medium" | "low";

export type ProviderModelEvidenceClaim =
  "identity" | "supported" | "unsupported" | "unknown";

export type ProviderModelParameterValue = string | number | boolean;

export interface ProviderModelEvidence {
  readonly kind: ProviderModelEvidenceKind;
  readonly reference: string;
  readonly observedAt: string;
  readonly sourceDigest: string;
  readonly confidence: ProviderModelEvidenceConfidence;
  readonly claim: ProviderModelEvidenceClaim;
}

interface ProviderModelParameterDefinitionBase {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly evidence: readonly ProviderModelEvidence[];
}

export interface ProviderModelEnumParameterDefinition extends ProviderModelParameterDefinitionBase {
  readonly valueType: "enum";
  readonly values: readonly ProviderModelParameterValue[];
}

export interface ProviderModelIntegerParameterDefinition extends ProviderModelParameterDefinitionBase {
  readonly valueType: "integer";
  readonly minimum: number;
  readonly maximum: number;
  readonly step?: number;
}

export interface ProviderModelBooleanParameterDefinition extends ProviderModelParameterDefinitionBase {
  readonly valueType: "boolean";
}

export interface ProviderModelStringParameterDefinition extends ProviderModelParameterDefinitionBase {
  readonly valueType: "string";
  readonly maxLength: number;
}

export type ProviderModelParameterDefinition =
  | ProviderModelEnumParameterDefinition
  | ProviderModelIntegerParameterDefinition
  | ProviderModelBooleanParameterDefinition
  | ProviderModelStringParameterDefinition;

export interface ProviderModelOperationDefinition {
  readonly apiSurfaces: readonly string[];
  readonly parameters: readonly ProviderModelParameterDefinition[];
  readonly evidence: readonly ProviderModelEvidence[];
}

export interface ProviderModelOperations {
  readonly "text.generate"?: ProviderModelOperationDefinition;
  readonly "image.generate"?: ProviderModelOperationDefinition;
  readonly "image.edit"?: ProviderModelOperationDefinition;
}

export interface ProviderModelCatalogEntry {
  readonly providerModelId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly inputModalities: readonly ProviderModelModality[];
  readonly outputModalities: readonly ProviderModelModality[];
  readonly operations: ProviderModelOperations;
  readonly completeness: ProviderModelCatalogCompleteness;
  readonly evidence: readonly ProviderModelEvidence[];
}

export interface ProviderModelCatalogDocument {
  readonly schemaVersion: 1;
  readonly providerPreset: string;
  readonly discoveryMethod: string;
  readonly sourceDigest: string;
  readonly models: readonly ProviderModelCatalogEntry[];
}

export type ProviderParameterCallerPolicy = "fixed" | "optional" | "required";

export interface ProviderModelParameterPolicy {
  readonly callerPolicy: ProviderParameterCallerPolicy;
  readonly defaultValue?: ProviderModelParameterValue;
  readonly allowedValues?: readonly ProviderModelParameterValue[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export type ProviderModelParameterPolicies = Readonly<
  Record<string, ProviderModelParameterPolicy>
>;

export interface EffectiveProviderParameter {
  readonly key: string;
  readonly value: ProviderModelParameterValue;
  readonly source: "caller" | "route_default";
}

export interface ProviderParameterResolution {
  readonly values: Readonly<Record<string, ProviderModelParameterValue>>;
  readonly facts: readonly EffectiveProviderParameter[];
}

export class ProviderModelContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderModelContractError";
  }
}

const parameterKeyPattern = /^[a-zA-Z][a-zA-Z0-9]*$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const minimumProviderInteger = -2_147_483_647;
const maximumProviderInteger = 4_294_967_295;
const catalogKeys = new Set([
  "schemaVersion",
  "providerPreset",
  "discoveryMethod",
  "sourceDigest",
  "models",
]);
const modelKeys = new Set([
  "providerModelId",
  "displayName",
  "description",
  "inputModalities",
  "outputModalities",
  "operations",
  "completeness",
  "evidence",
]);
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

function invalid(message: string): never {
  throw new ProviderModelContractError(message);
}

function plainRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalid(`${label} must be a plain JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    invalid(`${label}.${unknown} is unsupported.`);
  }
}

function boundedString(
  value: unknown,
  label: string,
  maximumLength: number,
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

function parameterValue(
  value: unknown,
  label: string,
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

function uniqueValues(
  values: readonly ProviderModelParameterValue[],
  label: string,
): readonly ProviderModelParameterValue[] {
  if (values.length < 1 || values.length > 128) {
    return invalid(`${label} must contain between 1 and 128 values.`);
  }
  const keys = new Set<string>();
  const result = values.map((value, index) => {
    const parsed = parameterValue(value, `${label}[${String(index)}]`);
    const key = `${typeof parsed}:${String(parsed)}`;
    if (keys.has(key)) {
      return invalid(`${label} contains a duplicate value.`);
    }
    keys.add(key);
    return parsed;
  });
  return Object.freeze(result);
}

function evidenceList(
  value: unknown,
  label: string,
): readonly ProviderModelEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    return invalid(`${label} must contain between 1 and 16 entries.`);
  }
  return Object.freeze(
    value.map((candidate, index) => {
      const record = plainRecord(candidate, `${label}[${String(index)}]`);
      rejectUnknownKeys(record, evidenceKeys, `${label}[${String(index)}]`);
      if (
        record.kind !== "provider_api" &&
        record.kind !== "adapter_manifest" &&
        record.kind !== "administrator"
      ) {
        return invalid(`${label}[${String(index)}].kind is unsupported.`);
      }
      if (
        typeof record.observedAt !== "string" ||
        Number.isNaN(Date.parse(record.observedAt)) ||
        new Date(record.observedAt).toISOString() !== record.observedAt
      ) {
        return invalid(
          `${label}[${String(index)}].observedAt must be a canonical timestamp.`,
        );
      }
      if (
        typeof record.sourceDigest !== "string" ||
        !digestPattern.test(record.sourceDigest)
      ) {
        return invalid(
          `${label}[${String(index)}].sourceDigest must be canonical.`,
        );
      }
      if (
        record.confidence !== "high" &&
        record.confidence !== "medium" &&
        record.confidence !== "low"
      ) {
        return invalid(`${label}[${String(index)}].confidence is unsupported.`);
      }
      if (
        record.claim !== "identity" &&
        record.claim !== "supported" &&
        record.claim !== "unsupported" &&
        record.claim !== "unknown"
      ) {
        return invalid(`${label}[${String(index)}].claim is unsupported.`);
      }
      return Object.freeze({
        kind: record.kind,
        reference: boundedString(
          record.reference,
          `${label}[${String(index)}].reference`,
          255,
        ),
        observedAt: record.observedAt,
        sourceDigest: record.sourceDigest,
        confidence: record.confidence,
        claim: record.claim,
      });
    }),
  );
}

function stringArray<const TValue extends string>(
  value: unknown,
  allowed: ReadonlySet<TValue>,
  label: string,
  maximumItems: number,
): readonly TValue[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return invalid(
      `${label} must be an array of at most ${String(maximumItems)} values.`,
    );
  }
  const seen = new Set<TValue>();
  const parsed = value.map((candidate, index) => {
    if (typeof candidate !== "string" || !allowed.has(candidate as TValue)) {
      return invalid(`${label}[${String(index)}] is unsupported.`);
    }
    const item = candidate as TValue;
    if (seen.has(item)) {
      return invalid(`${label} contains a duplicate value.`);
    }
    seen.add(item);
    return item;
  });
  return Object.freeze(parsed);
}

function parameterDefinition(
  value: unknown,
  label: string,
): ProviderModelParameterDefinition {
  const record = plainRecord(value, label);
  let allowedKeys: ReadonlySet<string> | undefined;
  if (record.valueType === "enum") {
    allowedKeys = enumParameterKeys;
  } else if (record.valueType === "integer") {
    allowedKeys = integerParameterKeys;
  } else if (record.valueType === "boolean") {
    allowedKeys = booleanParameterKeys;
  } else if (record.valueType === "string") {
    allowedKeys = stringParameterKeys;
  }
  if (!allowedKeys) {
    return invalid(`${label}.valueType is unsupported.`);
  }
  rejectUnknownKeys(record, allowedKeys, label);
  const key = boundedString(record.key, `${label}.key`, 80);
  if (!parameterKeyPattern.test(key)) {
    return invalid(`${label}.key has an invalid format.`);
  }
  const common = {
    key,
    label: boundedString(record.label, `${label}.label`, 120),
    ...(record.description === undefined
      ? {}
      : {
          description: boundedString(
            record.description,
            `${label}.description`,
            500,
          ),
        }),
    required: record.required === true,
    evidence: evidenceList(record.evidence, `${label}.evidence`),
  };
  if (record.required !== true && record.required !== false) {
    return invalid(`${label}.required must be a boolean.`);
  }
  if (record.valueType === "enum") {
    if (!Array.isArray(record.values)) {
      return invalid(`${label}.values must be an array.`);
    }
    return Object.freeze({
      ...common,
      valueType: "enum" as const,
      values: uniqueValues(record.values, `${label}.values`),
    });
  }
  if (record.valueType === "integer") {
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
      return invalid(`${label} has an invalid integer range.`);
    }
    return Object.freeze({
      ...common,
      valueType: "integer" as const,
      minimum: record.minimum as number,
      maximum: record.maximum as number,
      ...(record.step === undefined ? {} : { step: record.step as number }),
    });
  }
  if (record.valueType === "boolean") {
    return Object.freeze({
      ...common,
      valueType: "boolean" as const,
    });
  }
  if (
    record.valueType === "string" &&
    Number.isSafeInteger(record.maxLength) &&
    (record.maxLength as number) >= 1 &&
    (record.maxLength as number) <= 32_000
  ) {
    return Object.freeze({
      ...common,
      valueType: "string" as const,
      maxLength: record.maxLength as number,
    });
  }
  return invalid(`${label}.valueType is unsupported.`);
}

function boundedUniqueStrings(
  value: unknown,
  label: string,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimumItems ||
    value.length > maximumItems
  ) {
    return invalid(
      `${label} must contain between ${String(minimumItems)} and ${String(maximumItems)} entries.`,
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((candidate, index) => {
      const parsed = boundedString(
        candidate,
        `${label}[${String(index)}]`,
        maximumLength,
      );
      if (seen.has(parsed)) {
        return invalid(`${label} contains a duplicate value.`);
      }
      seen.add(parsed);
      return parsed;
    }),
  );
}

function operationDefinition(
  value: unknown,
  label: string,
): ProviderModelOperationDefinition {
  const record = plainRecord(value, label);
  const unknownKey = Object.keys(record).find(
    (key) =>
      key !== "apiSurfaces" && key !== "parameters" && key !== "evidence",
  );
  if (unknownKey) {
    return invalid(`${label}.${unknownKey} is unsupported.`);
  }
  if (!Array.isArray(record.parameters) || record.parameters.length > 64) {
    return invalid(`${label}.parameters must contain at most 64 entries.`);
  }
  const parameterKeys = new Set<string>();
  const parameters = record.parameters.map((parameter, parameterIndex) => {
    const parsed = parameterDefinition(
      parameter,
      `${label}.parameters[${String(parameterIndex)}]`,
    );
    if (parameterKeys.has(parsed.key)) {
      return invalid(
        `${label}.parameters contains duplicate key ${parsed.key}.`,
      );
    }
    parameterKeys.add(parsed.key);
    return parsed;
  });
  const operationEvidence = evidenceList(record.evidence, `${label}.evidence`);
  if (!operationEvidence.some(({ claim }) => claim === "supported")) {
    return invalid(`${label}.evidence must include a supported claim.`);
  }
  return Object.freeze({
    apiSurfaces: boundedUniqueStrings(
      record.apiSurfaces,
      `${label}.apiSurfaces`,
      1,
      16,
      160,
    ),
    parameters: Object.freeze(parameters),
    evidence: operationEvidence,
  });
}

export function parseProviderModelCatalogDocument(
  value: unknown,
): ProviderModelCatalogDocument {
  const record = plainRecord(value, "Provider model catalog");
  rejectUnknownKeys(record, catalogKeys, "Provider model catalog");
  if (record.schemaVersion !== 1) {
    return invalid("Provider model catalog schemaVersion must equal 1.");
  }
  if (
    typeof record.sourceDigest !== "string" ||
    !digestPattern.test(record.sourceDigest)
  ) {
    return invalid("Provider model catalog sourceDigest must be canonical.");
  }
  if (!Array.isArray(record.models) || record.models.length > 2_000) {
    return invalid(
      "Provider model catalog models must contain at most 2000 entries.",
    );
  }
  const modalities = new Set<ProviderModelModality>(["text", "image", "mask"]);
  const modelIds = new Set<string>();
  const models = record.models.map((candidate, index) => {
    const label = `Provider model catalog models[${String(index)}]`;
    const model = plainRecord(candidate, label);
    const providerModelId = boundedString(
      model.providerModelId,
      `${label}.providerModelId`,
      512,
    );
    if (modelIds.has(providerModelId)) {
      return invalid("Provider model catalog contains a duplicate model ID.");
    }
    modelIds.add(providerModelId);
    const completeness = model.completeness;
    if (
      completeness !== "identity_only" &&
      completeness !== "partial" &&
      completeness !== "complete"
    ) {
      return invalid(`${label}.completeness is unsupported.`);
    }
    if (
      Object.hasOwn(model, "capabilities") ||
      Object.hasOwn(model, "apiSurfaces") ||
      Object.hasOwn(model, "parameters")
    ) {
      return invalid(`${label} uses legacy flat operation fields.`);
    }
    rejectUnknownKeys(model, modelKeys, label);
    const operationRecord = plainRecord(
      model.operations,
      `${label}.operations`,
    );
    const operationKeys = Object.keys(operationRecord);
    const unsupportedOperation = operationKeys.find(
      (key) => !isProviderModelCapabilityKey(key),
    );
    if (unsupportedOperation) {
      return invalid(
        `${label}.operations.${unsupportedOperation} is unsupported.`,
      );
    }
    if (
      (completeness === "identity_only" && operationKeys.length !== 0) ||
      (completeness !== "identity_only" && operationKeys.length < 1)
    ) {
      return invalid(
        completeness === "identity_only"
          ? `${label}.operations must be empty for identity-only entries.`
          : `${label}.operations requires at least one evidenced operation.`,
      );
    }
    const operations: {
      "text.generate"?: ProviderModelOperationDefinition;
      "image.generate"?: ProviderModelOperationDefinition;
      "image.edit"?: ProviderModelOperationDefinition;
    } = {};
    for (const operationKey of operationKeys) {
      const typedKey = operationKey as ProviderModelCapabilityKey;
      operations[typedKey] = operationDefinition(
        operationRecord[operationKey],
        `${label}.operations.${operationKey}`,
      );
    }
    const inputModalities = stringArray(
      model.inputModalities,
      modalities,
      `${label}.inputModalities`,
      modalities.size,
    );
    const outputModalities = stringArray(
      model.outputModalities,
      modalities,
      `${label}.outputModalities`,
      modalities.size,
    );
    const hasImageOperation = Boolean(
      operations["image.generate"] || operations["image.edit"],
    );
    if (hasImageOperation && !outputModalities.includes("image")) {
      return invalid(
        `${label} declares an image operation without image output.`,
      );
    }
    if (
      operations["text.generate"] &&
      (!inputModalities.includes("text") || !outputModalities.includes("text"))
    ) {
      return invalid(
        `${label} declares text.generate without text input and output.`,
      );
    }
    if (operations["image.edit"] && !inputModalities.includes("image")) {
      return invalid(`${label} declares image.edit without image input.`);
    }
    const modelEvidence = evidenceList(model.evidence, `${label}.evidence`);
    if (!modelEvidence.some(({ claim }) => claim === "identity")) {
      return invalid(`${label}.evidence must include an identity claim.`);
    }
    return Object.freeze({
      providerModelId,
      displayName: boundedString(
        model.displayName,
        `${label}.displayName`,
        160,
      ),
      ...(model.description === undefined
        ? {}
        : {
            description: boundedString(
              model.description,
              `${label}.description`,
              1_000,
            ),
          }),
      inputModalities,
      outputModalities,
      operations: Object.freeze(operations),
      completeness,
      evidence: modelEvidence,
    });
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    providerPreset: boundedString(
      record.providerPreset,
      "Provider model catalog providerPreset",
      40,
    ),
    discoveryMethod: boundedString(
      record.discoveryMethod,
      "Provider model catalog discoveryMethod",
      120,
    ),
    sourceDigest: record.sourceDigest,
    models: Object.freeze(models),
  });
}

function valueSupportedByDefinition(
  definition: ProviderModelParameterDefinition,
  value: ProviderModelParameterValue,
): boolean {
  if (definition.valueType === "enum") {
    return definition.values.some(
      (candidate) => typeof candidate === typeof value && candidate === value,
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

function valueAllowedByPolicy(
  definition: ProviderModelParameterDefinition,
  policy: ProviderModelParameterPolicy,
  value: ProviderModelParameterValue,
): boolean {
  if (!valueSupportedByDefinition(definition, value)) {
    return false;
  }
  if (
    policy.allowedValues &&
    !policy.allowedValues.some(
      (candidate) => typeof candidate === typeof value && candidate === value,
    )
  ) {
    return false;
  }
  if (
    typeof value === "number" &&
    ((policy.minimum !== undefined && value < policy.minimum) ||
      (policy.maximum !== undefined && value > policy.maximum))
  ) {
    return false;
  }
  return true;
}

export function resolveProviderModelParameters(options: {
  readonly definitions: readonly ProviderModelParameterDefinition[];
  readonly policies: ProviderModelParameterPolicies;
  readonly callerValues: Readonly<Record<string, unknown>>;
}): ProviderParameterResolution {
  const definitions = new Map(
    options.definitions.map((definition) => [definition.key, definition]),
  );
  const unknownPolicy = Object.keys(options.policies).find(
    (key) => !definitions.has(key),
  );
  if (unknownPolicy) {
    return invalid(
      `Route parameter policy references unsupported parameter ${unknownPolicy}.`,
    );
  }
  const unknownCallerValue = Object.keys(options.callerValues).find(
    (key) => !definitions.has(key),
  );
  if (unknownCallerValue) {
    return invalid(
      `Caller supplied unsupported parameter ${unknownCallerValue}.`,
    );
  }
  const values: Record<string, ProviderModelParameterValue> = {};
  const facts: EffectiveProviderParameter[] = [];
  for (const definition of options.definitions) {
    const policy = options.policies[definition.key];
    if (!policy) {
      continue;
    }
    if (
      policy.allowedValues &&
      policy.allowedValues.some(
        (value) => !valueSupportedByDefinition(definition, value),
      )
    ) {
      return invalid(
        `Route policy for ${definition.key} exceeds the model capability.`,
      );
    }
    if (
      policy.minimum !== undefined &&
      policy.maximum !== undefined &&
      policy.minimum > policy.maximum
    ) {
      return invalid(
        `Route policy for ${definition.key} has an invalid range.`,
      );
    }
    const hasCallerValue = Object.hasOwn(options.callerValues, definition.key);
    if (policy.callerPolicy === "fixed" && hasCallerValue) {
      return invalid(
        `Caller cannot override fixed parameter ${definition.key}.`,
      );
    }
    if (policy.callerPolicy === "required" && !hasCallerValue) {
      return invalid(`Caller must supply parameter ${definition.key}.`);
    }
    const candidate = hasCallerValue
      ? parameterValue(
          options.callerValues[definition.key],
          `Caller parameter ${definition.key}`,
        )
      : policy.defaultValue;
    if (candidate === undefined) {
      if (policy.callerPolicy === "fixed" || definition.required) {
        return invalid(
          `Route parameter ${definition.key} requires a default value.`,
        );
      }
      continue;
    }
    if (!valueAllowedByPolicy(definition, policy, candidate)) {
      return invalid(
        `Parameter ${definition.key} is outside the effective model and route bounds.`,
      );
    }
    values[definition.key] = candidate;
    facts.push(
      Object.freeze({
        key: definition.key,
        value: candidate,
        source: hasCallerValue
          ? ("caller" as const)
          : ("route_default" as const),
      }),
    );
  }
  return Object.freeze({
    values: Object.freeze(values),
    facts: Object.freeze(facts),
  });
}
