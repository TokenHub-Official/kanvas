import type {
  WorkflowAuthoringBindingV1,
  WorkflowAuthoringVariableV1,
} from "@kanvas/contracts/workflow-authoring";

export interface WorkflowTextTemplateVariableV1 {
  readonly id: string;
  readonly variable: WorkflowAuthoringVariableV1;
}

const variableTokenPattern = /\{\{([^{}]+)\}\}/gu;

export function workflowVariableIdentity(
  sourceNodeId: string,
  fieldKey: string,
): string {
  return `${sourceNodeId}:${fieldKey}`;
}

function sameVariable(
  left: WorkflowAuthoringVariableV1,
  right: WorkflowAuthoringVariableV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function workflowTextTemplateSource(
  binding: WorkflowAuthoringBindingV1,
  variables: readonly WorkflowTextTemplateVariableV1[],
): string {
  if (binding.kind === "literal") {
    return typeof binding.value === "string" ? binding.value : "";
  }
  if (binding.kind === "variable") {
    const option = variables.find((item) =>
      sameVariable(item.variable, binding.variable),
    );
    return option ? `{{${option.id}}}` : "";
  }
  if (binding.kind !== "text") return "";
  return binding.segments
    .map((segment) => {
      if (segment.kind === "literal") return segment.text;
      const option = variables.find((item) =>
        sameVariable(item.variable, segment.variable),
      );
      return option ? `{{${option.id}}}` : "";
    })
    .join("");
}

export function workflowTextTemplateBinding(
  source: string,
  variables: readonly WorkflowTextTemplateVariableV1[],
): WorkflowAuthoringBindingV1 {
  const byId = new Map(variables.map((item) => [item.id, item.variable]));
  const segments: Extract<
    WorkflowAuthoringBindingV1,
    { readonly kind: "text" }
  >["segments"][number][] = [];
  let cursor = 0;
  for (const match of source.matchAll(variableTokenPattern)) {
    const start = match.index;
    const token = match[0];
    const id = match[1] ?? "";
    const variable = byId.get(id);
    if (start > cursor) {
      segments.push({ kind: "literal", text: source.slice(cursor, start) });
    }
    if (variable) segments.push({ kind: "variable", variable });
    else segments.push({ kind: "literal", text: token });
    cursor = start + token.length;
  }
  if (cursor < source.length || segments.length === 0) {
    segments.push({ kind: "literal", text: source.slice(cursor) });
  }
  return { kind: "text", segments };
}

export function insertWorkflowVariableToken(
  source: string,
  variableId: string,
  selectionStart: number,
  selectionEnd: number,
): { readonly source: string; readonly cursor: number } {
  const token = `{{${variableId}}}`;
  const next = `${source.slice(0, selectionStart)}${token}${source.slice(selectionEnd)}`;
  return { source: next, cursor: selectionStart + token.length };
}
