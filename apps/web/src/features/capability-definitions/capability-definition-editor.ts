import type {
  CreateCapabilityDefinitionBody,
  RuntimeAdapterSummary,
  ProviderExecutionRouteSummary,
} from "@kanvas/contracts/api";
import type { CapabilityMappingJsonValue } from "@kanvas/contracts/capability";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";

import {
  defaultCapabilityFieldLabel,
  distinctCapabilityFieldLabels,
} from "./capability-field-labels.js";

import { defaultInterfaceSemanticType } from "../interfaces/interface-semantic-types.js";

export type CapabilityDefinitionCreateBody = Omit<
  CreateCapabilityDefinitionBody,
  "runMethod"
>;

export type CapabilityFieldType =
  "string" | "number" | "integer" | "boolean" | "object" | "array" | "enum";

export interface CapabilityFieldDraft {
  readonly id: string;
  readonly key: string;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly type: CapabilityFieldType;
  readonly semanticType: string;
  readonly required: boolean;
  readonly enumValues: string;
  readonly example: string;
  readonly defaultValue: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly primary: boolean;
}

export interface CapabilityDefinitionDraft {
  readonly requestKey: string;
  readonly key: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly categoryZh: string;
  readonly categoryEn: string;
  readonly tags: string;
  readonly surfaces: readonly ("workflow" | "agent" | "canvas")[];
  readonly sourceKind?: "model_resource" | "model_service" | "plugin";
  readonly sourceId: string;
  readonly runtimeAdapterRevisionId: string;
  readonly inputs: readonly CapabilityFieldDraft[];
  readonly outputs: readonly CapabilityFieldDraft[];
}

export type CapabilityDefinitionDraftError =
  | "key"
  | "title"
  | "description"
  | "category"
  | "surface"
  | "inputEmpty"
  | "outputEmpty"
  | "fieldKey"
  | "fieldDuplicate"
  | "fieldLabel"
  | "fieldSemantic"
  | "fieldEnum"
  | "fieldExample"
  | "fieldDefault"
  | "fieldRange"
  | "primary";

export type CapabilityEditorLocale = "zh-CN" | "en-US";

export function capabilityEditorLocale(
  language: string | undefined,
): CapabilityEditorLocale {
  return language?.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function capabilityEditorText(
  locale: CapabilityEditorLocale,
  zh: string,
  en: string,
): string {
  return locale === "zh-CN" ? zh : en;
}

export function capabilityDefinitionAdapterDefaults(
  current: CapabilityDefinitionDraft,
  adapter: RuntimeAdapterSummary,
): Pick<
  CapabilityDefinitionDraft,
  | "runtimeAdapterRevisionId"
  | "titleZh"
  | "titleEn"
  | "descriptionZh"
  | "descriptionEn"
> {
  return {
    runtimeAdapterRevisionId: adapter.id,
    titleZh:
      current.titleZh.trim() ||
      resolveLocalizedTextV1(adapter.displayName, "zh-CN"),
    titleEn:
      current.titleEn.trim() ||
      resolveLocalizedTextV1(adapter.displayName, "en-US"),
    descriptionZh: current.descriptionZh,
    descriptionEn: current.descriptionEn,
  };
}

export function visibleCapabilityOutputs<T extends { readonly key: string }>(
  outputs: readonly T[],
): readonly T[] {
  return outputs.filter((output) => output.key !== "schemaVersion");
}

export function updateCapabilityEditorText(
  locale: CapabilityEditorLocale,
  zh: string,
  en: string,
  value: string,
): Readonly<{ zh: string; en: string }> {
  return locale === "zh-CN"
    ? { zh: value, en: en.trim() ? en : value }
    : { zh: zh.trim() ? zh : value, en: value };
}

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u;
const fieldKeyPattern =
  /^(?!__proto__$|prototype$|constructor$)[A-Za-z][A-Za-z0-9_]{0,159}$/u;
const semanticPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;

export function emptyCapabilityField(): CapabilityFieldDraft {
  const id = crypto.randomUUID();
  return Object.freeze({
    id,
    key: `field_${id.replaceAll("-", "")}`,
    labelZh: "",
    labelEn: "",
    type: "string",
    semanticType: defaultInterfaceSemanticType("string"),
    required: true,
    enumValues: "",
    example: "sample",
    defaultValue: "",
    minimum: "",
    maximum: "",
    primary: false,
  });
}

export function emptyCapabilityDefinitionDraft(): CapabilityDefinitionDraft {
  const requestKey = crypto.randomUUID();
  return Object.freeze({
    requestKey,
    key: `capability.custom.${requestKey.replaceAll("-", "")}`,
    titleZh: "",
    titleEn: "",
    descriptionZh: "",
    descriptionEn: "",
    categoryZh: "",
    categoryEn: "",
    tags: "",
    surfaces: Object.freeze(["workflow", "agent", "canvas"] as const),
    sourceId: "",
    runtimeAdapterRevisionId: "",
    inputs: Object.freeze([]),
    outputs: Object.freeze([]),
  });
}

export function capabilityFieldDefaults(
  type: CapabilityFieldType,
  semanticType: string,
): Readonly<Pick<CapabilityFieldDraft, "type" | "semanticType" | "example">> {
  let example = "sample";
  if (semanticType === "artifact.image" || semanticType === "artifact.file") {
    example = "01K00000000000000000000001";
  } else if (type === "number" || type === "integer") {
    example = "1";
  } else if (type === "boolean") {
    example = "true";
  } else if (type === "object") {
    example = "{}";
  } else if (type === "array") {
    example =
      semanticType === "artifact.image_list"
        ? '["01K00000000000000000000001"]'
        : "[]";
  }
  return Object.freeze({ type, semanticType, example });
}

function parseFieldValue(
  field: CapabilityFieldDraft,
  raw: string,
): CapabilityMappingJsonValue {
  const value = raw.trim();
  if (field.type === "string" || field.type === "enum") return value;
  if (field.type === "number" || field.type === "integer") {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (field.type === "integer" && !Number.isInteger(number))
    ) {
      throw new TypeError("fieldExample");
    }
    return number;
  }
  if (field.type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new TypeError("fieldExample");
  }
  try {
    const parsed = JSON.parse(value) as CapabilityMappingJsonValue;
    if (
      (field.type === "array" && !Array.isArray(parsed)) ||
      (field.type === "object" &&
        (typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)))
    ) {
      throw new TypeError("fieldExample");
    }
    return parsed;
  } catch {
    throw new TypeError("fieldExample");
  }
}

function numericRange(
  field: CapabilityFieldDraft,
): Readonly<{ minimum?: number; maximum?: number }> {
  if (field.type !== "number" && field.type !== "integer") return {};
  const minimum = field.minimum.trim() ? Number(field.minimum) : undefined;
  const maximum = field.maximum.trim() ? Number(field.maximum) : undefined;
  if (
    (minimum !== undefined && !Number.isFinite(minimum)) ||
    (maximum !== undefined && !Number.isFinite(maximum)) ||
    (field.type === "integer" &&
      ((minimum !== undefined && !Number.isInteger(minimum)) ||
        (maximum !== undefined && !Number.isInteger(maximum)))) ||
    (minimum !== undefined && maximum !== undefined && minimum > maximum)
  ) {
    throw new TypeError("fieldRange");
  }
  return {
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
  };
}

function fieldsError(
  fields: readonly CapabilityFieldDraft[],
  empty: "inputEmpty" | "outputEmpty",
): CapabilityDefinitionDraftError | undefined {
  if (fields.length === 0) return empty;
  const keys = new Set<string>();
  for (const field of fields) {
    const key = field.key.trim();
    if (!fieldKeyPattern.test(key)) return "fieldKey";
    if (keys.has(key)) return "fieldDuplicate";
    keys.add(key);
    if (!field.labelZh.trim() || !field.labelEn.trim()) return "fieldLabel";
    if (!semanticPattern.test(field.semanticType.trim())) {
      return "fieldSemantic";
    }
    if (
      field.type === "enum" &&
      field.enumValues
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean).length === 0
    ) {
      return "fieldEnum";
    }
    if (!field.example.trim()) return "fieldExample";
    let range: ReturnType<typeof numericRange>;
    try {
      range = numericRange(field);
    } catch {
      return "fieldRange";
    }
    let example: unknown;
    try {
      example = parseFieldValue(field, field.example);
    } catch {
      return "fieldExample";
    }
    const enumValues = field.enumValues
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      (field.type === "enum" &&
        (typeof example !== "string" || !enumValues.includes(example))) ||
      (typeof example === "number" &&
        ((range.minimum !== undefined && example < range.minimum) ||
          (range.maximum !== undefined && example > range.maximum)))
    ) {
      return "fieldExample";
    }
    if (field.defaultValue.trim()) {
      try {
        const defaultValue = parseFieldValue(field, field.defaultValue);
        if (
          (field.type === "enum" &&
            (typeof defaultValue !== "string" ||
              !enumValues.includes(defaultValue))) ||
          (typeof defaultValue === "number" &&
            ((range.minimum !== undefined && defaultValue < range.minimum) ||
              (range.maximum !== undefined && defaultValue > range.maximum)))
        ) {
          return "fieldDefault";
        }
      } catch {
        return "fieldDefault";
      }
    }
  }
  return undefined;
}

export function capabilityDefinitionDraftError(
  draft: CapabilityDefinitionDraft,
): CapabilityDefinitionDraftError | undefined {
  if (!keyPattern.test(draft.key.trim())) return "key";
  if (!draft.titleZh.trim() || !draft.titleEn.trim()) return "title";
  if (
    Boolean(draft.descriptionZh.trim()) !== Boolean(draft.descriptionEn.trim())
  ) {
    return "description";
  }
  if (!draft.categoryZh.trim() || !draft.categoryEn.trim()) return "category";
  if (draft.surfaces.length === 0) return "surface";
  const fieldError =
    fieldsError(draft.inputs, "inputEmpty") ??
    fieldsError(draft.outputs, "outputEmpty");
  if (fieldError) return fieldError;
  if (draft.outputs.filter((field) => field.primary).length !== 1) {
    return "primary";
  }
  return undefined;
}

function fieldSchema(
  field: CapabilityFieldDraft,
): Readonly<Record<string, unknown>> {
  const example = parseFieldValue(field, field.example);
  const range = numericRange(field);
  const defaultValue = field.defaultValue.trim()
    ? { default: parseFieldValue(field, field.defaultValue) }
    : {};
  if (field.type === "enum") {
    return Object.freeze({
      type: "string",
      enum: field.enumValues
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      ...defaultValue,
      examples: [example],
      "x-kanvas-semantic-type": field.semanticType.trim(),
    });
  }
  return Object.freeze({
    type: field.type,
    ...range,
    ...defaultValue,
    examples: [example],
    "x-kanvas-semantic-type": field.semanticType.trim(),
  });
}

function schema(
  fields: readonly CapabilityFieldDraft[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: fields
      .filter((field) => field.required)
      .map((field) => field.key.trim()),
    properties: Object.fromEntries(
      fields.map((field) => [field.key.trim(), fieldSchema(field)]),
    ),
  });
}

function editorFor(
  field: CapabilityFieldDraft,
): CreateCapabilityDefinitionBody["parameters"][number]["editor"] {
  if (field.type === "enum") return "enum";
  if (field.type === "number" || field.type === "integer") return "number";
  if (field.type === "boolean") return "toggle";
  if (field.semanticType.startsWith("artifact.")) {
    return field.type === "array" ? "artifact_list_picker" : "artifact_picker";
  }
  return field.type === "object" || field.type === "array" ? "json" : "text";
}

export function capabilityDefinitionBody(
  draft: CapabilityDefinitionDraft,
): CapabilityDefinitionCreateBody {
  const error = capabilityDefinitionDraftError(draft);
  if (error) throw new TypeError(error);
  const supportedInvokers = [
    ...(draft.surfaces.includes("canvas") ? (["user"] as const) : []),
    ...(draft.surfaces.includes("workflow") ? (["workflow"] as const) : []),
    ...(draft.surfaces.includes("agent") ? (["agent"] as const) : []),
  ];
  return {
    key: draft.key.trim(),
    title: { "zh-CN": draft.titleZh.trim(), "en-US": draft.titleEn.trim() },
    ...(draft.descriptionZh.trim()
      ? {
          description: {
            "zh-CN": draft.descriptionZh.trim(),
            "en-US": draft.descriptionEn.trim(),
          },
        }
      : {}),
    category: {
      "zh-CN": draft.categoryZh.trim(),
      "en-US": draft.categoryEn.trim(),
    },
    tags: [
      ...new Set(
        draft.tags
          .split(/[,，]/u)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    sourceKind: "custom",
    surfaces: [...draft.surfaces],
    inputSchema: schema(draft.inputs),
    outputSchema: schema(draft.outputs),
    parameters: draft.inputs.map((field) => ({
      key: field.key.trim(),
      label: {
        "zh-CN": field.labelZh.trim(),
        "en-US": field.labelEn.trim(),
      },
      semanticType: field.semanticType.trim(),
      required: field.required,
      ...(field.defaultValue.trim()
        ? { defaultValue: parseFieldValue(field, field.defaultValue) }
        : {}),
      exposurePolicy: {
        allowed: ["workflow_author", "template_input"],
        default: "workflow_author",
      },
      sourcePolicy: {
        allowed: ["constant", "workflow_input", "upstream"],
        default: "workflow_input",
      },
      editor: editorFor(field),
    })),
    outputs: draft.outputs.map((field) => ({
      key: field.key.trim(),
      label: {
        "zh-CN": field.labelZh.trim(),
        "en-US": field.labelEn.trim(),
      },
      semanticType: field.semanticType.trim(),
      primary: field.primary,
      visibility: "author",
    })),
    idempotencyMode: "keyed",
    supportedInvokers,
  };
}

const artifactIdPattern = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";

function schemaRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function publicOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicOutputSchema);
  const object = schemaRecord(value);
  if (!object) return value;
  if (object["x-kanvas-attempt-output-artifact"] === true) {
    return {
      type: "string",
      pattern: artifactIdPattern,
      ...(typeof object["x-kanvas-semantic-type"] === "string"
        ? {
            "x-kanvas-semantic-type": object["x-kanvas-semantic-type"],
          }
        : {}),
    };
  }
  const outputProperties = schemaRecord(object.properties);
  const hidesSchemaVersion = Boolean(
    outputProperties &&
    typeof schemaRecord(outputProperties.schemaVersion)?.const === "string" &&
    String(schemaRecord(outputProperties.schemaVersion)?.const).startsWith(
      "kanvas.",
    ),
  );
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, item]) => {
      if (key === "$id") return [];
      if (key === "properties" && outputProperties && hidesSchemaVersion) {
        return [
          [
            key,
            Object.fromEntries(
              Object.entries(outputProperties)
                .filter(([propertyKey]) => propertyKey !== "schemaVersion")
                .map(([propertyKey, property]) => [
                  propertyKey,
                  publicOutputSchema(property),
                ]),
            ),
          ],
        ];
      }
      if (key === "required" && Array.isArray(item) && hidesSchemaVersion) {
        return [[key, item.filter((required) => required !== "schemaVersion")]];
      }
      return [[key, publicOutputSchema(item)]];
    }),
  );
}

function publicInputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicInputSchema);
  const object = schemaRecord(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => key !== "$id")
      .map(([key, item]) => [key, publicInputSchema(item)]),
  );
}

function declarationEditor(
  schemaValue: Readonly<Record<string, unknown>>,
): CreateCapabilityDefinitionBody["parameters"][number]["editor"] {
  const semantic = schemaValue["x-kanvas-semantic-type"];
  if (typeof semantic === "string" && semantic.startsWith("artifact.")) {
    return schemaValue.type === "array"
      ? "artifact_list_picker"
      : "artifact_picker";
  }
  if (Array.isArray(schemaValue.enum)) return "enum";
  if (schemaValue.type === "number" || schemaValue.type === "integer")
    return "number";
  if (schemaValue.type === "boolean") return "toggle";
  if (schemaValue.type === "object" || schemaValue.type === "array")
    return "json";
  return "text";
}

export function capabilityDefinitionBodyFromAdapter(
  draft: CapabilityDefinitionDraft,
  adapter: RuntimeAdapterSummary,
  route?: ProviderExecutionRouteSummary,
): CapabilityDefinitionCreateBody {
  if (
    !draft.titleZh.trim() ||
    !draft.titleEn.trim() ||
    !draft.categoryZh.trim() ||
    !draft.categoryEn.trim() ||
    !draft.sourceKind ||
    !draft.sourceId ||
    draft.runtimeAdapterRevisionId !== adapter.id
  ) {
    throw new TypeError("sourceCapability");
  }
  let inputSchema = publicInputSchema(
    adapter.invocationInputSchema,
  ) as Readonly<Record<string, unknown>>;
  if (route?.providerParameterDefinitions) {
    const properties = { ...schemaRecord(inputSchema.properties) };
    const controlled = Array.isArray(
      inputSchema["x-kanvas-provider-parameter-keys"],
    )
      ? (inputSchema["x-kanvas-provider-parameter-keys"] as string[])
      : [];
    for (const key of controlled) {
      const definition = route.providerParameterDefinitions.find(
        (parameter) => parameter.key === key,
      );
      const policy = route.providerParameterPolicies?.[key];
      if (!definition || policy?.callerPolicy === "fixed") {
        delete properties[key];
        continue;
      }
      const original = schemaRecord(properties[key]) ?? {};
      properties[key] = {
        ...original,
        ...(definition.valueType === "enum"
          ? {
              enum: definition.values.filter(
                (value) =>
                  !Array.isArray(original.enum) ||
                  original.enum.includes(value),
              ),
            }
          : {}),
        ...(definition.valueType === "integer"
          ? { minimum: definition.minimum, maximum: definition.maximum }
          : {}),
      };
    }
    if (
      route.modelInputModalities &&
      !route.modelInputModalities.includes("image")
    )
      delete properties.referenceArtifactIds;
    if (
      route.modelInputModalities &&
      !route.modelInputModalities.includes("mask")
    )
      delete properties.maskArtifactId;
    inputSchema = {
      ...inputSchema,
      properties,
      required: Array.isArray(inputSchema.required)
        ? inputSchema.required.filter(
            (key) => typeof key === "string" && Object.hasOwn(properties, key),
          )
        : [],
      "x-kanvas-provider-parameter-keys": controlled.filter((key) =>
        Object.hasOwn(properties, key),
      ),
    };
  }
  const outputSchema = publicOutputSchema(
    adapter.invocationOutputSchema,
  ) as Readonly<Record<string, unknown>>;
  const inputProperties = schemaRecord(inputSchema.properties) ?? {};
  const outputProperties = schemaRecord(outputSchema.properties) ?? {};
  const requiredInputs = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  const primaryOutput =
    Object.entries(outputProperties).find(([, value]) => {
      const semantic = schemaRecord(value)?.["x-kanvas-semantic-type"];
      return typeof semantic === "string" && semantic.startsWith("artifact.");
    })?.[0] ?? Object.keys(outputProperties)[0];
  return {
    key: draft.key,
    title: { "zh-CN": draft.titleZh.trim(), "en-US": draft.titleEn.trim() },
    ...(draft.descriptionZh.trim()
      ? {
          description: {
            "zh-CN": draft.descriptionZh.trim(),
            "en-US": draft.descriptionEn.trim(),
          },
        }
      : {}),
    category: {
      "zh-CN": draft.categoryZh.trim(),
      "en-US": draft.categoryEn.trim(),
    },
    tags: [],
    sourceKind: "custom",
    surfaces: ["workflow", "agent", "canvas"],
    inputSchema,
    outputSchema,
    parameters: distinctCapabilityFieldLabels(
      Object.entries(inputProperties).map(([key, value]) => {
        const field = schemaRecord(value) ?? {};
        return {
          key,
          label: defaultCapabilityFieldLabel(key, field),
          semanticType:
            typeof field["x-kanvas-semantic-type"] === "string"
              ? field["x-kanvas-semantic-type"]
              : "value.any",
          required: requiredInputs.has(key),
          exposurePolicy: {
            allowed: ["workflow_author", "template_input"],
            default: "workflow_author",
          },
          sourcePolicy: {
            allowed: ["constant", "workflow_input", "upstream"],
            default: "workflow_input",
          },
          editor: declarationEditor(field),
        };
      }),
    ),
    outputs: distinctCapabilityFieldLabels(
      Object.entries(outputProperties).map(([key, value]) => {
        const field = schemaRecord(value) ?? {};
        return {
          key,
          label: defaultCapabilityFieldLabel(key, field),
          semanticType:
            typeof field["x-kanvas-semantic-type"] === "string"
              ? field["x-kanvas-semantic-type"]
              : "value.any",
          primary: key === primaryOutput,
          visibility: "author",
        };
      }),
    ),
    idempotencyMode: "keyed",
    supportedInvokers: ["user", "workflow", "agent", "canvas"],
  };
}
