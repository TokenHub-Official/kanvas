import {
  effectiveInvocationSchemaInvariantIssues,
  validateEffectiveInvocationInput,
  type EffectiveInvocationField,
  type EffectiveInvocationSchema,
} from "@kanvas/contracts/api";

type JsonPrimitive = string | number | boolean | null;

export type EffectiveInvocationJsonValue =
  | JsonPrimitive
  | {
      readonly [key: string]: EffectiveInvocationJsonValue;
    }
  | readonly EffectiveInvocationJsonValue[];

export type EffectiveInvocationValue = EffectiveInvocationJsonValue;

export type EffectiveInvocationValues = Readonly<
  Record<string, EffectiveInvocationValue | undefined>
>;

export function scalarOptionToken(value: EffectiveInvocationValue): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

export function valueFromScalarOption(
  field: EffectiveInvocationField,
  token: string,
): EffectiveInvocationValue | undefined {
  if (token.length === 0) {
    return undefined;
  }
  let values: readonly EffectiveInvocationValue[] = [];
  if (field.valueType === "enum") {
    values = field.values;
  } else if (field.valueType === "boolean") {
    values = field.allowedValues ?? [true, false];
  }
  return values.find((value) => scalarOptionToken(value) === token);
}

export function integerInvocationValue(value: string): number | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function unset(value: EffectiveInvocationValue | undefined): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

export function requiredInvocationField(
  fields: readonly EffectiveInvocationField[],
  values: EffectiveInvocationValues,
): EffectiveInvocationField | undefined {
  return fields.find(
    (field) =>
      field.required &&
      field.valueType !== "constant" &&
      unset(values[field.key]),
  );
}

function artifactValue(key: string, value: EffectiveInvocationValue): string {
  if (typeof value !== "string" || !artifactIdPattern.test(value.trim())) {
    throw new Error(`Invocation parameter ${key} is not a valid Artifact ID.`);
  }
  return value.trim();
}

function artifactListValue(
  field: Extract<
    EffectiveInvocationField,
    { readonly valueType: "artifact_list" }
  >,
  value: EffectiveInvocationValue,
): readonly string[] {
  let candidates: readonly string[];
  if (typeof value === "string") {
    candidates = value.split(/[,\n]/u);
  } else if (
    Array.isArray(value) &&
    value.every(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
  ) {
    candidates = value;
  } else {
    throw new Error(
      `Invocation parameter ${field.key} is not a valid Artifact ID list.`,
    );
  }
  const items = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  if (
    items.length < field.minItems ||
    items.length > field.maxItems ||
    items.some((item) => !artifactIdPattern.test(item)) ||
    (field.uniqueItems && new Set(items).size !== items.length)
  ) {
    throw new Error(
      `Invocation parameter ${field.key} is not a valid Artifact ID list.`,
    );
  }
  return Object.freeze(items);
}

function jsonCompatible(value: unknown): value is EffectiveInvocationJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(jsonCompatible);
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  return Object.values(value).every(jsonCompatible);
}

function jsonValue(
  field: Extract<EffectiveInvocationField, { readonly valueType: "json" }>,
  value: EffectiveInvocationValue,
): EffectiveInvocationJsonValue {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (value.length > field.maxLength) {
      throw new Error(`Invocation parameter ${field.key} is too large.`);
    }
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Invocation parameter ${field.key} is not valid JSON.`);
    }
  }
  const typeMatches =
    field.jsonType === "array"
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  if (!typeMatches || !jsonCompatible(parsed)) {
    throw new Error(
      `Invocation parameter ${field.key} is not a JSON ${field.jsonType}.`,
    );
  }
  if (JSON.stringify(parsed).length > field.maxLength) {
    throw new Error(`Invocation parameter ${field.key} is too large.`);
  }
  return parsed;
}

function sameScalar(
  left: EffectiveInvocationValue,
  right: string | number | boolean,
): boolean {
  return typeof left === typeof right && left === right;
}

export function effectiveInvocationInput(
  schema: EffectiveInvocationSchema,
  values: EffectiveInvocationValues,
): Readonly<Record<string, EffectiveInvocationValue>> {
  if (schema.availability !== "available") {
    throw new Error(`Invocation schema is unavailable: ${schema.reason}.`);
  }
  const invariantIssues = effectiveInvocationSchemaInvariantIssues(schema);
  if (invariantIssues.length > 0) {
    throw new Error(
      `Invocation schema is invalid: ${invariantIssues.join(" ")}`,
    );
  }
  const input: Record<string, EffectiveInvocationValue> = {};
  for (const field of schema.fields) {
    const key = field.key;
    const value = values[key];
    if (field.valueType === "constant") {
      if (value !== undefined && !sameScalar(value, field.value)) {
        throw new Error(
          `Invocation parameter ${key} cannot override its constant value.`,
        );
      }
      input[key] = field.value;
      continue;
    }
    if (value === undefined || unset(value)) {
      if (field.required) {
        throw new Error(`Invocation parameter ${key} is required.`);
      }
      continue;
    }
    if (field.valueType === "integer") {
      let parsed: number | undefined;
      if (typeof value === "number") {
        parsed = value;
      } else if (typeof value === "string") {
        parsed = integerInvocationValue(value);
      }
      if (
        parsed === undefined ||
        parsed < field.minimum ||
        parsed > field.maximum ||
        (field.step !== undefined &&
          (parsed - field.minimum) % field.step !== 0)
      ) {
        throw new Error(`Invocation parameter ${key} is not a valid integer.`);
      }
      input[key] = parsed;
      continue;
    }
    if (field.valueType === "boolean") {
      if (
        typeof value !== "boolean" ||
        (field.allowedValues !== undefined &&
          !field.allowedValues.includes(value))
      ) {
        throw new Error(`Invocation parameter ${key} is not a boolean.`);
      }
      input[key] = value;
      continue;
    }
    if (field.valueType === "enum") {
      if (
        !field.values.some(
          (candidate) =>
            typeof candidate === typeof value && candidate === value,
        )
      ) {
        throw new Error(`Invocation parameter ${key} is outside its enum.`);
      }
      input[key] = value;
      continue;
    }
    if (field.valueType === "artifact") {
      input[key] = artifactValue(key, value);
      continue;
    }
    if (field.valueType === "artifact_list") {
      input[key] = artifactListValue(field, value);
      continue;
    }
    if (field.valueType === "json") {
      input[key] = jsonValue(field, value);
      continue;
    }
    if (typeof value !== "string" || value.trim().length > field.maxLength) {
      throw new Error(`Invocation parameter ${key} is not a valid string.`);
    }
    input[key] = value.trim();
  }
  const validationIssues = validateEffectiveInvocationInput(
    schema.validationSchema,
    input,
  );
  if (validationIssues.length > 0) {
    throw new Error(
      `Invocation input failed its validation schema: ${validationIssues.join(
        ", ",
      )}`,
    );
  }
  return Object.freeze(input);
}
