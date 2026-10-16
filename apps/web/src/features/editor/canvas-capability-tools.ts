import type { CanvasCapabilitySummary } from "@kanvas/contracts/api";

import type { CanvasOperationOutputMode } from "./canvas-operation-registry.js";

export type CanvasToolCompletionBehaviorV1 =
  "auto_replace_safe" | "review_required";
export type CanvasToolInteractionBehaviorV1 = "direct" | "form";

const defaultNumericMinimum = -1_000_000;
const defaultNumericMaximum = 1_000_000;
const decimalStep = 0.1;
const maximumTextLength = 2_000;
const defaultTextLength = 500;

export interface CanvasOperationParameterOption {
  readonly label: string;
  readonly value: string | number | boolean;
}

export interface CanvasOperationParameterField {
  readonly control: "select" | "text" | "integer" | "boolean";
  readonly defaultValue?: string | number | boolean;
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly options?: readonly CanvasOperationParameterOption[];
  readonly required: boolean;
  readonly step?: number;
}

export function canvasToolCompletionBehaviorV1(
  value: unknown,
): CanvasToolCompletionBehaviorV1 {
  return value === "auto_replace_safe"
    ? "auto_replace_safe"
    : "review_required";
}

export function canvasToolInteractionBehaviorV1(
  value: unknown,
): CanvasToolInteractionBehaviorV1 {
  return value === "direct" ? "direct" : "form";
}

export function canvasToolDefaultParametersV1(tool: {
  readonly interactionBehavior: CanvasToolInteractionBehaviorV1;
  readonly parameterFields: readonly CanvasOperationParameterField[];
}): Readonly<Record<string, unknown>> | undefined {
  if (tool.interactionBehavior !== "direct") return undefined;
  const parameters = Object.fromEntries(
    tool.parameterFields.flatMap((field) =>
      field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]],
    ),
  );
  return tool.parameterFields.some(
    (field) => field.required && field.defaultValue === undefined,
  )
    ? undefined
    : Object.freeze(parameters);
}

export interface CanvasImageCapabilityTool {
  readonly capabilityKey: string;
  readonly category: string;
  readonly completionBehavior: CanvasToolCompletionBehaviorV1;
  readonly contractRevisionId: string;
  readonly id: string;
  readonly interactionBehavior: CanvasToolInteractionBehaviorV1;
  readonly label: string;
  readonly operationId: string;
  readonly order: number;
  readonly outputArtifactPath: readonly (number | string)[];
  readonly maskArtifactPath?: readonly (number | string)[];
  readonly outputModes: readonly CanvasOperationOutputMode[];
  readonly parameterFields: readonly CanvasOperationParameterField[];
  readonly parametersSchemaId: string;
  readonly sourceParameterKey: string;
  readonly sourceValue: "artifact_id";
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function scalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function parameterField(
  parameter: CanvasCapabilitySummary["parameters"][number],
  schema: Readonly<Record<string, unknown>>,
  locale: "zh-CN" | "en-US",
): CanvasOperationParameterField | undefined {
  const common = {
    key: parameter.key,
    label: parameter.label[locale],
    required: parameter.required,
    ...(parameter.description
      ? { description: parameter.description[locale] }
      : {}),
  };
  const defaultValue = scalar(parameter.defaultValue)
    ? parameter.defaultValue
    : undefined;
  if (Array.isArray(schema.enum) && schema.enum.every(scalar)) {
    const options = schema.enum.map((value) => ({
      value,
      label: String(value),
    }));
    return Object.freeze({
      ...common,
      control: "select" as const,
      options: Object.freeze(options),
      ...(defaultValue !== undefined &&
      options.some((item) => item.value === defaultValue)
        ? { defaultValue }
        : {}),
    });
  }
  if (schema.type === "boolean") {
    return Object.freeze({
      ...common,
      control: "boolean" as const,
      ...(typeof defaultValue === "boolean" ? { defaultValue } : {}),
    });
  }
  if (schema.type === "integer" || schema.type === "number") {
    const minimum =
      typeof schema.minimum === "number"
        ? schema.minimum
        : defaultNumericMinimum;
    const maximum =
      typeof schema.maximum === "number"
        ? schema.maximum
        : defaultNumericMaximum;
    return Object.freeze({
      ...common,
      control: "integer" as const,
      minimum,
      maximum,
      step: schema.type === "integer" ? 1 : decimalStep,
      ...(typeof defaultValue === "number" ? { defaultValue } : {}),
    });
  }
  if (schema.type === "string") {
    return Object.freeze({
      ...common,
      control: "text" as const,
      maxLength:
        typeof schema.maxLength === "number" &&
        Number.isSafeInteger(schema.maxLength)
          ? Math.min(schema.maxLength, maximumTextLength)
          : defaultTextLength,
      ...(typeof defaultValue === "string" ? { defaultValue } : {}),
    });
  }
  return undefined;
}

export function parseCanvasImageCapabilityTool(
  capability: CanvasCapabilitySummary,
  locale: "zh-CN" | "en-US",
): CanvasImageCapabilityTool | undefined {
  const properties = record(capability.inputSchema.properties);
  const source = capability.parameters.filter(
    (parameter) =>
      parameter.semanticType.startsWith("artifact.") &&
      parameter.sourcePolicy.allowed.includes("canvas_selection"),
  );
  const primary = capability.outputs.find(
    (output) => output.primary && output.semanticType.startsWith("artifact."),
  );
  if (!properties || !capability.canvas || source.length !== 1 || !primary) {
    return undefined;
  }
  const sourceParameter = source[0]!;
  const parameterFields = capability.parameters.flatMap((parameter) => {
    if (
      parameter.key === sourceParameter.key ||
      parameter.semanticType.startsWith("artifact.")
    ) {
      return [];
    }
    const schema = record(properties[parameter.key]);
    const field = schema
      ? parameterField(parameter, schema, locale)
      : undefined;
    return field ? [field] : [];
  });
  if (
    capability.parameters.some(
      (parameter) =>
        parameter.key !== sourceParameter.key &&
        parameter.required &&
        !parameterFields.some((field) => field.key === parameter.key),
    )
  ) {
    return undefined;
  }
  const mask = capability.outputs.find(
    (output) =>
      output.semanticType === "artifact.mask" ||
      output.key === "maskArtifactId",
  );
  return Object.freeze({
    id: capability.contractRevisionId,
    contractRevisionId: capability.contractRevisionId,
    capabilityKey: capability.capabilityKey,
    category: capability.category,
    completionBehavior: canvasToolCompletionBehaviorV1(
      capability.canvas.completionBehavior,
    ),
    interactionBehavior: canvasToolInteractionBehaviorV1(
      capability.canvas.interactionBehavior,
    ),
    operationId: capability.capabilityKey,
    label: capability.displayName,
    sourceParameterKey: sourceParameter.key,
    sourceValue: "artifact_id",
    outputArtifactPath: Object.freeze([primary.key]),
    ...(mask ? { maskArtifactPath: Object.freeze([mask.key]) } : {}),
    outputModes: capability.canvas.outputModes,
    parameterFields: Object.freeze(parameterFields),
    parametersSchemaId:
      typeof capability.inputSchema.$id === "string"
        ? capability.inputSchema.$id
        : `kanvas.capability-input.${capability.contractRevisionId}`,
    order: capability.canvas.order,
  });
}

export function canvasImageCapabilityTools(
  capabilities: readonly CanvasCapabilitySummary[],
  locale: "zh-CN" | "en-US",
): readonly CanvasImageCapabilityTool[] {
  return Object.freeze(
    capabilities
      .flatMap((capability) => {
        const tool = parseCanvasImageCapabilityTool(capability, locale);
        return tool ? [tool] : [];
      })
      .sort(
        (left, right) =>
          left.order - right.order ||
          left.label.localeCompare(right.label, locale),
      ),
  );
}

export function readCanvasToolArtifactId(
  output: unknown,
  path: readonly (number | string)[],
): string | undefined {
  let current: unknown = output;
  for (const part of path) {
    if (typeof part === "number" && Array.isArray(current)) {
      current = current[part];
      continue;
    }
    if (
      typeof part === "string" &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      current = (current as Readonly<Record<string, unknown>>)[part];
      continue;
    }
    return undefined;
  }
  return typeof current === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(current)
    ? current
    : undefined;
}
