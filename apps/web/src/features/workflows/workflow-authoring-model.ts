import type {
  WorkflowAuthoringCapability,
  WorkflowAuthoringDocument,
} from "@kanvas/contracts/api";
import type {
  WorkflowJsonValue,
  WorkflowTopologyNodeV1,
  WorkflowValueReference,
  WorkflowValueTemplate,
} from "@kanvas/contracts/workflow";

export const workflowInputNodeId = "__workflow_input__";
export const workflowOutputNodeId = "__workflow_output__";

export type WorkflowSchemaFieldType =
  "string" | "number" | "integer" | "boolean" | "object" | "array";

export interface WorkflowSchemaField {
  readonly key: string;
  readonly title: string;
  readonly type: WorkflowSchemaFieldType;
  readonly required: boolean;
  readonly description?: string;
  readonly placeholder?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
}

export interface WorkflowVariableOption {
  readonly label: string;
  readonly sourceLabel: string;
  readonly value: WorkflowValueReference;
  readonly valueType?: string;
}

export interface WorkflowAuthoringLayout {
  readonly schemaVersion: 1;
  readonly positions: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function schemaType(value: unknown): WorkflowSchemaFieldType {
  if (
    value === "number" ||
    value === "integer" ||
    value === "boolean" ||
    value === "object" ||
    value === "array"
  ) {
    return value;
  }
  return "string";
}

export function workflowSchemaFields(
  schema: Readonly<Record<string, unknown>>,
): readonly WorkflowSchemaField[] {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return Object.entries(properties).map(([key, definition]) => {
    const value = isRecord(definition) ? definition : {};
    const ui = isRecord(value["x-kanvas-ui"]) ? value["x-kanvas-ui"] : {};
    return {
      key,
      title:
        typeof value.title === "string" && value.title.trim()
          ? value.title
          : key,
      type: schemaType(value.type),
      required: required.has(key),
      schema: value,
      ...(typeof value.description === "string" && value.description.trim()
        ? { description: value.description }
        : {}),
      ...(typeof ui.placeholder === "string" && ui.placeholder.trim()
        ? { placeholder: ui.placeholder }
        : {}),
    };
  });
}

export function isStandardWorkflowApprovalDecisionSchema(
  schema: Readonly<Record<string, unknown>>,
): boolean {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const definition = isRecord(properties.approved)
    ? properties.approved
    : undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const incompatibleKeywords = [
    "$ref",
    "allOf",
    "anyOf",
    "const",
    "else",
    "enum",
    "if",
    "not",
    "oneOf",
    "then",
  ];
  return (
    schema.type === "object" &&
    Object.keys(properties).length === 1 &&
    definition?.type === "boolean" &&
    required.length === 1 &&
    required[0] === "approved" &&
    incompatibleKeywords.every((key) => !Object.hasOwn(definition, key))
  );
}

export function workflowApprovalDecisionFields(
  schema: Readonly<Record<string, unknown>>,
  standardApprovedTitle?: string,
): readonly WorkflowSchemaField[] {
  const fields = workflowSchemaFields(schema);
  if (!standardApprovedTitle || fields.length !== 1) return fields;
  const approved = fields[0]!;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const definition = isRecord(properties.approved)
    ? properties.approved
    : undefined;
  const hasAuthoredTitle =
    typeof definition?.title === "string" && definition.title.trim().length > 0;
  if (!isStandardWorkflowApprovalDecisionSchema(schema) || hasAuthoredTitle) {
    return fields;
  }
  return [{ ...approved, title: standardApprovedTitle }];
}

export function workflowObjectSchema(
  previous: Readonly<Record<string, unknown>>,
  fields: readonly WorkflowSchemaField[],
): Readonly<Record<string, unknown>> {
  const previousProperties = isRecord(previous.properties)
    ? previous.properties
    : {};
  return Object.freeze({
    ...previous,
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      fields.map((field) => {
        const previousField = previousProperties[field.key];
        const existing = isRecord(previousField) ? previousField : {};
        return [
          field.key,
          Object.freeze({
            ...existing,
            type: field.type,
            title: field.title,
            ...(field.description ? { description: field.description } : {}),
          }),
        ];
      }),
    ),
    required: fields
      .filter((field) => field.required)
      .map((field) => field.key),
  });
}

export function targetKeys(node: WorkflowTopologyNodeV1): readonly string[] {
  return node.kind === "switch"
    ? [...node.cases.flatMap((item) => item.next), ...node.defaultNext]
    : node.next;
}

export function terminalNodeKeys(
  nodes: readonly WorkflowTopologyNodeV1[],
): ReadonlySet<string> {
  return new Set(
    nodes
      .filter((node) => targetKeys(node).length === 0)
      .map((node) => node.key),
  );
}

function upstreamNodeKeys(
  nodes: readonly WorkflowTopologyNodeV1[],
  selectedNodeKey: string,
): ReadonlySet<string> {
  const reverse = new Map<string, Set<string>>();
  for (const node of nodes) {
    for (const target of targetKeys(node)) {
      const values = reverse.get(target) ?? new Set<string>();
      values.add(node.key);
      reverse.set(target, values);
    }
  }
  const result = new Set<string>();
  const queue = [...(reverse.get(selectedNodeKey) ?? [])];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || result.has(key)) {
      continue;
    }
    result.add(key);
    queue.push(...(reverse.get(key) ?? []));
  }
  return result;
}

function capabilityForNode(
  node: WorkflowTopologyNodeV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): WorkflowAuthoringCapability | undefined {
  if (node.kind !== "invoke" && node.kind !== "map") {
    return undefined;
  }
  const reference =
    node.kind === "invoke" ? node.capability : node.invoke.capability;
  return capabilities.find(
    (capability) =>
      capability.contractId === reference.contractId &&
      capability.revision === reference.revision,
  );
}

export function workflowVariableOptions({
  capabilities,
  document,
  includeMapItem = false,
  selectedNodeKey,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly document: WorkflowAuthoringDocument;
  readonly includeMapItem?: boolean;
  readonly selectedNodeKey: string;
}): readonly WorkflowVariableOption[] {
  const options: WorkflowVariableOption[] = workflowSchemaFields(
    document.inputSchema,
  ).map((field) => ({
    label: field.title,
    sourceLabel: "workflow_input",
    valueType: field.type,
    value: {
      source: "workflow_input",
      pointer: `/${field.key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    },
  }));
  const upstream =
    selectedNodeKey === workflowOutputNodeId
      ? new Set(document.topology.nodes.map((node) => node.key))
      : upstreamNodeKeys(document.topology.nodes, selectedNodeKey);
  for (const node of document.topology.nodes) {
    if (!upstream.has(node.key)) {
      continue;
    }
    if (node.kind === "approval") {
      for (const field of workflowSchemaFields(node.decisionSchema)) {
        options.push({
          label: field.title,
          sourceLabel: node.key,
          valueType: field.type,
          value: {
            source: "node_output",
            nodeKey: node.key,
            scope: "root",
            pointer: `/${field.key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          },
        });
      }
      continue;
    }
    const capability = capabilityForNode(node, capabilities);
    if (!capability) {
      continue;
    }
    for (const field of workflowSchemaFields(capability.outputSchema)) {
      options.push({
        label: field.title,
        sourceLabel: node.key,
        valueType: field.type,
        value: {
          source: "node_output",
          nodeKey: node.key,
          scope: "root",
          pointer: `/${field.key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        },
      });
    }
  }
  if (includeMapItem) {
    options.push({
      label: "item",
      sourceLabel: "map_item",
      value: { source: "map_item", pointer: "" },
    });
  }
  return options;
}

export function workflowValueReference(
  value: WorkflowValueTemplate | undefined,
): WorkflowValueReference | undefined {
  const record: Record<string, unknown> | undefined = isRecord(value)
    ? value
    : undefined;
  const reference = record?.["$value"];
  return isRecord(reference)
    ? (reference as unknown as WorkflowValueReference)
    : undefined;
}

export function workflowValueMapping(
  value: WorkflowValueTemplate,
): Readonly<Record<string, WorkflowValueTemplate>> {
  if (!isRecord(value) || "$value" in value || "$literal" in value) {
    return {};
  }
  return value;
}

export function updateWorkflowValueMapping(
  value: WorkflowValueTemplate,
  key: string,
  nextValue: WorkflowValueTemplate | undefined,
): WorkflowValueTemplate {
  const next = { ...workflowValueMapping(value) };
  if (nextValue === undefined) {
    delete next[key];
  } else {
    next[key] = nextValue;
  }
  return next;
}

export function workflowReferenceToken(
  reference: WorkflowValueReference,
): string {
  return JSON.stringify(reference);
}

export function workflowReferenceFromToken(
  token: string,
): WorkflowValueReference | undefined {
  try {
    const parsed = JSON.parse(token) as unknown;
    if (!isRecord(parsed) || typeof parsed.source !== "string") {
      return undefined;
    }
    return parsed as unknown as WorkflowValueReference;
  } catch {
    return undefined;
  }
}

export function workflowLiteralValue(
  value: string,
  type: WorkflowSchemaFieldType,
): WorkflowJsonValue {
  if (type === "integer" || type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean") {
    return value === "true";
  }
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(value) as WorkflowJsonValue;
    } catch {
      return value;
    }
  }
  return value;
}

function layoutStorageKey(draftId: string): string {
  return `kanvas:workflow-authoring-layout:v1:${draftId}`;
}

export function readWorkflowAuthoringLayout(
  draftId: string,
): WorkflowAuthoringLayout | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(
      localStorage.getItem(layoutStorageKey(draftId)) ?? "null",
    ) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      !isRecord(parsed.positions)
    ) {
      return undefined;
    }
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [key, value] of Object.entries(parsed.positions)) {
      if (
        isRecord(value) &&
        typeof value.x === "number" &&
        Number.isFinite(value.x) &&
        typeof value.y === "number" &&
        Number.isFinite(value.y)
      ) {
        positions[key] = { x: value.x, y: value.y };
      }
    }
    return { schemaVersion: 1, positions };
  } catch {
    return undefined;
  }
}

export function writeWorkflowAuthoringLayout(
  draftId: string,
  positions: WorkflowAuthoringLayout["positions"],
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    layoutStorageKey(draftId),
    JSON.stringify({ schemaVersion: 1, positions }),
  );
}
