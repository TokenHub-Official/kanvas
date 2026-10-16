import type { WorkflowAuthoringFieldV1 } from "@kanvas/contracts/workflow-authoring";

export const workflowArtifactIdPattern = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";

export type WorkflowAuthoringFieldKindV1 =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "file"
  | "file_list";

export type WorkflowFileCategoryV1 =
  "document" | "image" | "audio" | "video" | "other";

export type WorkflowFileTransferV1 = "upload" | "url" | "both";

export interface WorkflowAuthoringFieldIssueV1 {
  readonly code:
    | "duplicate_key"
    | "invalid_key"
    | "label_required"
    | "range_invalid"
    | "file_category_required";
  readonly fieldIndex: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowAuthoringFieldKind(
  schema: Readonly<Record<string, unknown>>,
): WorkflowAuthoringFieldKindV1 {
  if (
    schema.type === "string" &&
    schema.pattern === workflowArtifactIdPattern
  ) {
    return "file";
  }
  if (
    schema.type === "array" &&
    isRecord(schema.items) &&
    schema.items.type === "string" &&
    schema.items.pattern === workflowArtifactIdPattern
  ) {
    return "file_list";
  }
  if (
    schema.type === "number" ||
    schema.type === "integer" ||
    schema.type === "boolean" ||
    schema.type === "object" ||
    schema.type === "array"
  ) {
    return schema.type;
  }
  if (Object.hasOwn(schema, "const")) {
    if (typeof schema.const === "number") return "number";
    if (typeof schema.const === "boolean") return "boolean";
    return "string";
  }
  if (
    isRecord(schema.properties) ||
    (Array.isArray(schema.oneOf) &&
      schema.oneOf.some((item) => isRecord(item) && item.type === "object"))
  ) {
    return "object";
  }
  return "string";
}

export function workflowAuthoringSchemaForKind(
  kind: WorkflowAuthoringFieldKindV1,
): Readonly<Record<string, unknown>> {
  if (kind === "file" || kind === "file_list") {
    const file = {
      categories: ["image"],
      transfer: "both",
    } satisfies {
      readonly categories: readonly WorkflowFileCategoryV1[];
      readonly transfer: WorkflowFileTransferV1;
    };
    if (kind === "file") {
      return {
        type: "string",
        pattern: workflowArtifactIdPattern,
        "x-kanvas-file": file,
      };
    }
    return {
      type: "array",
      items: { type: "string", pattern: workflowArtifactIdPattern },
      minItems: 0,
      maxItems: 10,
      uniqueItems: true,
      "x-kanvas-file": file,
    };
  }
  if (kind === "string") {
    return { type: "string", minLength: 0, maxLength: 2000 };
  }
  if (kind === "array") {
    return {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 100,
      uniqueItems: false,
    };
  }
  if (kind === "object") {
    return { type: "object", additionalProperties: true };
  }
  return { type: kind };
}

export function workflowFileConfiguration(
  schema: Readonly<Record<string, unknown>>,
): {
  readonly categories: readonly WorkflowFileCategoryV1[];
  readonly transfer: WorkflowFileTransferV1;
} {
  const value = schema["x-kanvas-file"];
  if (!isRecord(value)) {
    return { categories: ["image"], transfer: "both" };
  }
  const categories = Array.isArray(value.categories)
    ? value.categories.filter(
        (item): item is WorkflowFileCategoryV1 =>
          item === "document" ||
          item === "image" ||
          item === "audio" ||
          item === "video" ||
          item === "other",
      )
    : [];
  const transfer =
    value.transfer === "upload" || value.transfer === "url"
      ? value.transfer
      : "both";
  return { categories, transfer };
}

export function workflowEnumValues(
  schema: Readonly<Record<string, unknown>>,
): readonly string[] {
  const source =
    schema.type === "array" && isRecord(schema.items)
      ? schema.items.enum
      : schema.enum;
  return Array.isArray(source)
    ? source.filter((item): item is string => typeof item === "string")
    : [];
}

export function withWorkflowEnumValues(
  schema: Readonly<Record<string, unknown>>,
  values: readonly string[],
): Readonly<Record<string, unknown>> {
  if (schema.type === "array") {
    const items = isRecord(schema.items) ? schema.items : { type: "string" };
    return {
      ...schema,
      items: {
        ...items,
        ...(values.length > 0 ? { enum: [...values] } : {}),
      },
    };
  }
  const next = { ...schema };
  if (values.length > 0) next.enum = [...values];
  else delete next.enum;
  return next;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function rangeKeys(kind: WorkflowAuthoringFieldKindV1): {
  readonly minimum: string;
  readonly maximum: string;
} {
  if (kind === "string") {
    return { minimum: "minLength", maximum: "maxLength" };
  }
  if (kind === "array" || kind === "file_list") {
    return { minimum: "minItems", maximum: "maxItems" };
  }
  return { minimum: "minimum", maximum: "maximum" };
}

export function workflowFieldNumber(
  schema: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  return finiteNumber(schema[key]);
}

export function workflowFieldPlaceholder(
  schema: Readonly<Record<string, unknown>>,
): string | undefined {
  const ui = schema["x-kanvas-ui"];
  if (!isRecord(ui)) return undefined;
  return typeof ui.placeholder === "string" && ui.placeholder.trim()
    ? ui.placeholder
    : undefined;
}

export function withWorkflowFieldPlaceholder(
  schema: Readonly<Record<string, unknown>>,
  placeholder: string,
): Readonly<Record<string, unknown>> {
  const next = { ...schema };
  const currentUi = isRecord(schema["x-kanvas-ui"])
    ? { ...schema["x-kanvas-ui"] }
    : {};
  if (placeholder.trim()) {
    next["x-kanvas-ui"] = { ...currentUi, placeholder };
    return next;
  }
  delete currentUi.placeholder;
  if (Object.keys(currentUi).length > 0) next["x-kanvas-ui"] = currentUi;
  else delete next["x-kanvas-ui"];
  return next;
}

export function validateWorkflowAuthoringFields(
  fields: readonly WorkflowAuthoringFieldV1[],
): readonly WorkflowAuthoringFieldIssueV1[] {
  const issues: WorkflowAuthoringFieldIssueV1[] = [];
  const counts = new Map<string, number>();
  for (const field of fields) {
    counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
  }
  fields.forEach((field, fieldIndex) => {
    if (!/^[A-Za-z_][A-Za-z0-9._-]*$/u.test(field.key)) {
      issues.push({ code: "invalid_key", fieldIndex });
    }
    if ((counts.get(field.key) ?? 0) > 1) {
      issues.push({ code: "duplicate_key", fieldIndex });
    }
    if (!field.label.trim()) {
      issues.push({ code: "label_required", fieldIndex });
    }
    const kind = workflowAuthoringFieldKind(field.schema);
    const keys = rangeKeys(kind);
    const minimum = workflowFieldNumber(field.schema, keys.minimum);
    const maximum = workflowFieldNumber(field.schema, keys.maximum);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      issues.push({ code: "range_invalid", fieldIndex });
    }
    if (
      (kind === "file" || kind === "file_list") &&
      workflowFileConfiguration(field.schema).categories.length === 0
    ) {
      issues.push({ code: "file_category_required", fieldIndex });
    }
  });
  return issues;
}

export function workflowFieldRenderKey(index: number): string {
  return `workflow-field-row-${String(index)}`;
}
