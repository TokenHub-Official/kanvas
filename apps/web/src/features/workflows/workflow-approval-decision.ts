import {
  workflowSchemaFields,
  type WorkflowSchemaField,
} from "./workflow-authoring-model.js";

const unsupportedSchemaKeywords = [
  "allOf",
  "anyOf",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "not",
  "oneOf",
] as const;

const supportedObjectKeywords = new Set([
  "$comment",
  "$id",
  "$schema",
  "additionalProperties",
  "description",
  "properties",
  "required",
  "title",
  "type",
]);

const supportedFieldKeywords = new Set([
  "$comment",
  "description",
  "enum",
  "title",
  "type",
  "x-kanvas-ui",
]);

export type WorkflowApprovalDecisionForm =
  | { readonly kind: "standard_boolean" }
  | {
      readonly kind: "flat";
      readonly fields: readonly WorkflowSchemaField[];
    }
  | { readonly kind: "unsupported" };

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function scalarType(
  value: unknown,
): value is "boolean" | "integer" | "number" | "string" {
  return (
    value === "boolean" ||
    value === "integer" ||
    value === "number" ||
    value === "string"
  );
}

function scalarMatches(type: string, value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isSafeInteger(value);
  return typeof value === "number" && Number.isFinite(value);
}

function supportedField(value: unknown): boolean {
  const field = record(value);
  if (!field || !scalarType(field.type)) return false;
  if (
    unsupportedSchemaKeywords.some((key) => key in field) ||
    Object.keys(field).some((key) => !supportedFieldKeywords.has(key))
  ) {
    return false;
  }
  if (field.enum !== undefined) {
    if (
      !Array.isArray(field.enum) ||
      field.enum.length === 0 ||
      !field.enum.every((item) => scalarMatches(field.type as string, item))
    ) {
      return false;
    }
  }
  return true;
}

export function workflowApprovalDecisionForm(
  schema: Readonly<Record<string, unknown>>,
): WorkflowApprovalDecisionForm {
  if (
    schema.type !== "object" ||
    unsupportedSchemaKeywords.some((key) => key in schema) ||
    Object.keys(schema).some((key) => !supportedObjectKeywords.has(key))
  ) {
    return { kind: "unsupported" };
  }
  const properties = record(schema.properties);
  if (
    !properties ||
    Object.values(properties).some((field) => !supportedField(field))
  ) {
    return { kind: "unsupported" };
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    return { kind: "unsupported" };
  }
  const required = (schema.required ?? []) as readonly unknown[];
  if (
    required.some((value) => typeof value !== "string") ||
    new Set(required).size !== required.length
  ) {
    return { kind: "unsupported" };
  }
  const requiredKeys = required as readonly string[];
  if (requiredKeys.some((key) => !(key in properties))) {
    return { kind: "unsupported" };
  }
  const fields = workflowSchemaFields(schema);
  if (
    fields.length === 1 &&
    fields[0]?.key === "approved" &&
    fields[0].type === "boolean" &&
    fields[0].required &&
    !Array.isArray(fields[0].schema?.enum)
  ) {
    return { kind: "standard_boolean" };
  }
  return fields.length > 0 ? { kind: "flat", fields } : { kind: "unsupported" };
}

export function workflowApprovalDecisionValue(
  form: Extract<WorkflowApprovalDecisionForm, { readonly kind: "flat" }>,
  values: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const decision: Record<string, unknown> = {};
  for (const field of form.fields) {
    const value = values[field.key];
    if (value === undefined || value === "") {
      if (field.required) return undefined;
      continue;
    }
    const definition = field.schema ?? {};
    if (!scalarMatches(field.type, value)) return undefined;
    if (
      Array.isArray(definition.enum) &&
      !definition.enum.some((item) => item === value)
    ) {
      return undefined;
    }
    decision[field.key] = value;
  }
  return Object.keys(decision).length > 0 ? decision : undefined;
}

export function workflowApprovalDecisionFingerprint(
  decision: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(
    Object.entries(decision).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}
