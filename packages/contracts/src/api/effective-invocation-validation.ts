import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  maximumEffectiveInvocationValidationSchemaLength,
  type EffectiveInvocationSchema,
  type EffectiveInvocationValidationSchema,
} from "./schemas.js";

const validationSchemaVersion =
  "kanvas.effective-invocation-validation-schema/v1" as const;
const maximumJsonSchemaDepth = 64;
const maximumValidationIssues = 20;
const maximumCachedValidators = 16;

function isJsonCompatible(
  value: unknown,
  stack: WeakSet<object>,
  depth: number,
): boolean {
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
  if (
    typeof value !== "object" ||
    depth > maximumJsonSchemaDepth ||
    stack.has(value)
  ) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return false;
  }
  stack.add(value);
  const compatible = (
    Array.isArray(value) ? value : Object.values(value)
  ).every((item) => isJsonCompatible(item, stack, depth + 1));
  stack.delete(value);
  return compatible;
}

export function createEffectiveInvocationValidationSchema(
  schema: unknown,
): EffectiveInvocationValidationSchema | undefined {
  if (
    schema === null ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    !isJsonCompatible(schema, new WeakSet<object>(), 0)
  ) {
    return undefined;
  }
  let document: string;
  try {
    document = JSON.stringify(schema);
  } catch {
    return undefined;
  }
  if (
    document.length < 2 ||
    document.length > maximumEffectiveInvocationValidationSchemaLength
  ) {
    return undefined;
  }
  const validationSchema = Object.freeze({
    schemaVersion: validationSchemaVersion,
    document,
  });
  return compiledValidator(validationSchema) ? validationSchema : undefined;
}

export function effectiveInvocationSchemaInvariantIssues(
  schema: EffectiveInvocationSchema,
): readonly string[] {
  if (schema.availability !== "available") {
    return Object.freeze([]);
  }
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const field of schema.fields) {
    if (keys.has(field.key)) {
      issues.push(`Duplicate invocation field: ${field.key}.`);
    }
    keys.add(field.key);
    if (
      field.valueType === "artifact_list" &&
      field.minItems > field.maxItems
    ) {
      issues.push(`Invalid Artifact list bounds: ${field.key}.`);
    }
  }
  if (
    schema.validationSchema.schemaVersion !== validationSchemaVersion ||
    schema.validationSchema.document.length < 2 ||
    schema.validationSchema.document.length >
      maximumEffectiveInvocationValidationSchemaLength ||
    !compiledValidator(schema.validationSchema)
  ) {
    issues.push("Invalid invocation validation schema envelope.");
  }
  return Object.freeze(issues);
}

export function registerKanvasJsonSchemaKeywords(ajv: Ajv2020): void {
  ajv.addKeyword({
    keyword: "x-kanvas-provider-model-operation",
    schemaType: "string",
    valid: true,
  });
  ajv.addKeyword({
    keyword: "x-kanvas-provider-parameter-keys",
    schemaType: "array",
    valid: true,
  });
  ajv.addKeyword({
    keyword: "x-kanvas-ui",
    schemaType: "object",
    valid: true,
  });
  ajv.addKeyword({
    keyword: "x-kanvas-file",
    schemaType: "object",
    valid: true,
  });
  ajv.addKeyword({
    keyword: "x-kanvas-semantic-type",
    schemaType: "string",
    valid: true,
  });
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  registerKanvasJsonSchemaKeywords(ajv);
  return ajv;
}

const validators = new Map<string, ValidateFunction>();

function compiledValidator(
  validationSchema: EffectiveInvocationValidationSchema,
): ValidateFunction | undefined {
  const cached = validators.get(validationSchema.document);
  if (cached) {
    validators.delete(validationSchema.document);
    validators.set(validationSchema.document, cached);
    return cached;
  }
  let schema: unknown;
  try {
    schema = JSON.parse(validationSchema.document) as unknown;
  } catch {
    return undefined;
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return undefined;
  }
  try {
    const validator = createAjv().compile(schema);
    validators.set(validationSchema.document, validator);
    if (validators.size > maximumCachedValidators) {
      const oldest = validators.keys().next().value;
      if (typeof oldest === "string") {
        validators.delete(oldest);
      }
    }
    return validator;
  } catch {
    return undefined;
  }
}

function validationIssue(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`.slice(
    0,
    1_000,
  );
}

export function validateEffectiveInvocationInput(
  validationSchema: EffectiveInvocationValidationSchema,
  value: unknown,
): readonly string[] {
  if (
    validationSchema.schemaVersion !== validationSchemaVersion ||
    validationSchema.document.length < 2 ||
    validationSchema.document.length >
      maximumEffectiveInvocationValidationSchemaLength
  ) {
    return Object.freeze(["Invocation validation schema envelope is invalid."]);
  }
  const validator = compiledValidator(validationSchema);
  if (!validator) {
    return Object.freeze(["Invocation validation schema cannot be compiled."]);
  }
  if (validator(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    (validator.errors ?? [])
      .slice(0, maximumValidationIssues)
      .map(validationIssue),
  );
}
