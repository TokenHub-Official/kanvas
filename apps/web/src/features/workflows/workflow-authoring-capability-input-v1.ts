import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import type { WorkflowJsonValue } from "@kanvas/contracts/workflow";
import type { WorkflowAuthoringBindingV1 } from "@kanvas/contracts/workflow-authoring";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowCapabilityInputDefaults(
  inputSchema: Readonly<Record<string, unknown>>,
  authoring?: WorkflowCapabilityAuthoringDeclaration,
): WorkflowAuthoringBindingV1 {
  const properties = isRecord(inputSchema.properties)
    ? inputSchema.properties
    : {};
  const fields: Record<string, WorkflowAuthoringBindingV1> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue;
    const hasDefault = Object.hasOwn(value, "default");
    const hasConstant = Object.hasOwn(value, "const");
    const declaration = authoring?.parameters.find((item) => item.key === key);
    const initialValue = declaration?.defaultValue;
    if (!hasDefault && !hasConstant && initialValue === undefined) continue;
    let selected: unknown = initialValue;
    if (hasConstant) selected = value.const;
    if (hasDefault) selected = value.default;
    fields[key] = {
      kind: "literal",
      value: selected as WorkflowJsonValue,
    };
  }
  return { kind: "object", fields };
}

export function workflowCapabilityInputWithDefaults(
  inputSchema: Readonly<Record<string, unknown>>,
  input: WorkflowAuthoringBindingV1,
  authoring?: WorkflowCapabilityAuthoringDeclaration,
): WorkflowAuthoringBindingV1 {
  const defaults = workflowCapabilityInputDefaults(inputSchema, authoring);
  if (defaults.kind !== "object") return input;
  if (input.kind !== "object") return defaults;
  return {
    kind: "object",
    fields: { ...defaults.fields, ...input.fields },
  };
}
