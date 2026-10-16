import type {
  EffectiveInvocationField,
  WorkflowAuthoringCapability,
  WorkflowCapabilityOutputDeclaration,
  WorkflowCapabilityParameterDeclaration,
  WorkflowCapabilitySemanticType,
} from "@kanvas/contracts/api";

import {
  workflowAuthoringFieldKind,
  workflowFileConfiguration,
} from "./workflow-authoring-field-schema-v1.js";

export type WorkflowCapabilityLocaleV1 = "zh-CN" | "en-US";

export function workflowCapabilityLocale(
  language: string,
): WorkflowCapabilityLocaleV1 {
  return language.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function workflowCapabilityText(
  value: Readonly<{ "zh-CN": string; "en-US": string }>,
  language: string,
): string {
  return value[workflowCapabilityLocale(language)];
}

export function workflowCapabilityParameter(
  capability: WorkflowAuthoringCapability | undefined,
  key: string,
): WorkflowCapabilityParameterDeclaration | undefined {
  return capability?.authoring.parameters.find((item) => item.key === key);
}

export function localizeEffectiveInvocationFields(
  fields: readonly EffectiveInvocationField[],
  capability: WorkflowAuthoringCapability | undefined,
  language: string,
): readonly EffectiveInvocationField[] {
  return Object.freeze(
    fields.map((field) => {
      const parameter = workflowCapabilityParameter(capability, field.key);
      if (!parameter) return field;
      const description = parameter.description
        ? workflowCapabilityText(parameter.description, language)
        : field.description;
      return Object.freeze({
        ...field,
        label: workflowCapabilityText(parameter.label, language),
        ...(description ? { description } : {}),
      });
    }),
  );
}

export function workflowCapabilityOutput(
  capability: WorkflowAuthoringCapability | undefined,
  key: string,
): WorkflowCapabilityOutputDeclaration | undefined {
  return capability?.authoring.outputs.find((item) => item.key === key);
}

export function workflowSemanticTypesCompatible(
  expected: WorkflowCapabilitySemanticType | undefined,
  actual: WorkflowCapabilitySemanticType | undefined,
): boolean {
  if (!expected || expected === "value.any") return true;
  if (!actual) return false;
  if (expected === actual) return true;
  if (expected === "artifact.any") return actual.startsWith("artifact.");
  if (expected === "artifact.image") {
    return actual === "artifact.foreground" || actual === "artifact.background";
  }
  if (expected === "background.source") {
    return (
      actual === "artifact.image" ||
      actual === "artifact.background" ||
      actual === "artifact.foreground"
    );
  }
  return false;
}

export function workflowInputSemanticType(
  schema: Readonly<Record<string, unknown>>,
): WorkflowCapabilitySemanticType {
  const kind = workflowAuthoringFieldKind(schema);
  if (kind === "file" || kind === "file_list") {
    const file = workflowFileConfiguration(schema);
    if (file.categories.includes("image")) {
      return kind === "file_list" ? "artifact.image_list" : "artifact.image";
    }
    return "artifact.any";
  }
  if (schema.type === "boolean") return "boolean.flag";
  if (schema.type === "number" || schema.type === "integer") {
    return "number.scalar";
  }
  if (schema.type === "string") return "text.plain";
  return "value.any";
}
