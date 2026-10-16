import type { CapabilityContractRevisionRef } from "../capability/index.js";
import {
  isWorkflowTopology,
  type WorkflowJsonValue,
  type WorkflowTopologyNodeV1,
  type WorkflowTopologyV1,
  type WorkflowValueReference,
  type WorkflowValueTemplate,
} from "../workflow/index.js";

export const workflowAuthoringInputNodeId = "workflow_input";
export const workflowAuthoringOutputNodeId = "workflow_output";

export type WorkflowAuthoringJoinPolicy = "all_success" | "all_settled";

export interface WorkflowAuthoringFieldV1 {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly schema: Readonly<Record<string, unknown>>;
}

export type WorkflowAuthoringVariableV1 =
  | {
      readonly source: "workflow_input";
      readonly path: readonly string[];
    }
  | {
      readonly source: "node_output" | "node_result";
      readonly nodeKey: string;
      readonly scope: "root" | "current";
      readonly path: readonly string[];
    }
  | {
      readonly source: "map_item";
      readonly path: readonly string[];
    };

export type WorkflowAuthoringBindingV1 =
  | {
      readonly kind: "variable";
      readonly variable: WorkflowAuthoringVariableV1;
    }
  | {
      readonly kind: "literal";
      readonly value: WorkflowJsonValue;
    }
  | {
      readonly kind: "text";
      readonly segments: readonly (
        | { readonly kind: "literal"; readonly text: string }
        | {
            readonly kind: "variable";
            readonly variable: WorkflowAuthoringVariableV1;
          }
      )[];
    }
  | {
      readonly kind: "coalesce";
      readonly variables: readonly WorkflowAuthoringVariableV1[];
    }
  | {
      readonly kind: "array";
      readonly items: readonly WorkflowAuthoringBindingV1[];
    }
  | {
      readonly kind: "object";
      readonly fields: Readonly<Record<string, WorkflowAuthoringBindingV1>>;
    };

interface WorkflowAuthoringNodeBaseV1 {
  readonly id: string;
  readonly displayName: string;
}

export interface WorkflowAuthoringInputNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "input";
  readonly schemaMetadata: Readonly<Record<string, unknown>>;
  readonly fields: readonly WorkflowAuthoringFieldV1[];
}

export interface WorkflowAuthoringOutputFieldV1 extends WorkflowAuthoringFieldV1 {
  readonly binding: WorkflowAuthoringBindingV1;
}

export interface WorkflowAuthoringOutputNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "output";
  readonly schemaMetadata: Readonly<Record<string, unknown>>;
  readonly fields: readonly WorkflowAuthoringOutputFieldV1[];
}

export interface WorkflowAuthoringCapabilityNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "capability";
  readonly nodeKey: string;
  readonly joinPolicy?: WorkflowAuthoringJoinPolicy;
  readonly capability: CapabilityContractRevisionRef;
  readonly input: WorkflowAuthoringBindingV1;
}

export type WorkflowAuthoringConditionOperatorV1 =
  "exists" | "equals" | "not_equals" | "in";

export interface WorkflowAuthoringConditionCaseV1 {
  readonly id: string;
  readonly label: string;
  readonly operator: WorkflowAuthoringConditionOperatorV1;
  readonly value?: WorkflowJsonValue;
}

export interface WorkflowAuthoringConditionNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "condition";
  readonly nodeKey: string;
  readonly joinPolicy?: WorkflowAuthoringJoinPolicy;
  readonly value: WorkflowAuthoringBindingV1;
  readonly cases: readonly WorkflowAuthoringConditionCaseV1[];
  readonly defaultLabel: string;
}

export interface WorkflowAuthoringBatchNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "batch";
  readonly nodeKey: string;
  readonly joinPolicy?: WorkflowAuthoringJoinPolicy;
  readonly items: WorkflowAuthoringBindingV1;
  readonly scopeKey: WorkflowAuthoringBindingV1;
  readonly maxItems: number;
  readonly maxConcurrency: number;
  readonly failureMode: "collect_all" | "fail_fast";
  readonly capability: CapabilityContractRevisionRef;
  readonly input: WorkflowAuthoringBindingV1;
}

export interface WorkflowAuthoringApprovalNodeV1 extends WorkflowAuthoringNodeBaseV1 {
  readonly type: "approval";
  readonly nodeKey: string;
  readonly joinPolicy?: WorkflowAuthoringJoinPolicy;
  readonly request: WorkflowAuthoringBindingV1;
  readonly decisionSchema: Readonly<Record<string, WorkflowJsonValue>>;
}

export type WorkflowAuthoringRuntimeNodeV1 =
  | WorkflowAuthoringCapabilityNodeV1
  | WorkflowAuthoringConditionNodeV1
  | WorkflowAuthoringBatchNodeV1
  | WorkflowAuthoringApprovalNodeV1;

export type WorkflowAuthoringNodeV1 =
  | WorkflowAuthoringInputNodeV1
  | WorkflowAuthoringRuntimeNodeV1
  | WorkflowAuthoringOutputNodeV1;

export interface WorkflowAuthoringControlEdgeV1 {
  readonly id: string;
  readonly source: string;
  readonly sourcePort: "start" | "out" | `case:${string}` | "default";
  readonly target: string;
}

export interface WorkflowAuthoringGraphV1 {
  readonly schemaVersion: 1;
  readonly workflowKey: string;
  readonly limits: WorkflowTopologyV1["limits"];
  readonly nodes: readonly WorkflowAuthoringNodeV1[];
  readonly edges: readonly WorkflowAuthoringControlEdgeV1[];
}

export interface WorkflowAuthoringLayoutV1 {
  readonly schemaVersion: 1;
  readonly positions: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  >;
  readonly viewport?: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
  };
}

export interface CompiledWorkflowAuthoringDocumentV1 {
  readonly schemaVersion: 1;
  readonly topology: WorkflowTopologyV1;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface CompiledWorkflowAuthoringWorkspaceV1 {
  readonly document: CompiledWorkflowAuthoringDocumentV1;
  readonly layout: WorkflowAuthoringLayoutV1;
}

export class WorkflowAuthoringCompileError extends Error {
  public constructor(
    public readonly code:
      | "input_node_required"
      | "output_node_required"
      | "duplicate_node_id"
      | "edge_target_missing"
      | "input_edge_invalid"
      | "output_edge_invalid"
      | "condition_edge_invalid"
      | "runtime_edge_invalid"
      | "edge_port_invalid"
      | "node_unreachable"
      | "output_unreachable"
      | "cycle_detected"
      | "topology_shape_invalid",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowAuthoringCompileError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerFromPath(path: readonly string[]): string {
  return path.length === 0
    ? ""
    : `/${path.map(escapePointerSegment).join("/")}`;
}

function pathFromPointer(pointer: string): readonly string[] {
  return pointer.length === 0
    ? []
    : pointer.slice(1).split("/").map(unescapePointerSegment);
}

function compileVariable(
  variable: WorkflowAuthoringVariableV1,
): WorkflowValueReference {
  if (variable.source === "workflow_input") {
    return {
      source: "workflow_input",
      pointer: pointerFromPath(variable.path),
    };
  }
  if (variable.source === "map_item") {
    return {
      source: "map_item",
      pointer: pointerFromPath(variable.path),
    };
  }
  return {
    source: variable.source,
    nodeKey: variable.nodeKey,
    scope: variable.scope,
    pointer: pointerFromPath(variable.path),
  };
}

export function compileWorkflowAuthoringBinding(
  binding: WorkflowAuthoringBindingV1,
): WorkflowValueTemplate {
  if (binding.kind === "variable") {
    return { $value: compileVariable(binding.variable) };
  }
  if (binding.kind === "literal") {
    return typeof binding.value === "object" && binding.value !== null
      ? { $literal: binding.value }
      : binding.value;
  }
  if (binding.kind === "text") {
    return {
      $string: binding.segments.map((segment) =>
        segment.kind === "literal"
          ? segment.text
          : { $value: compileVariable(segment.variable) },
      ),
    };
  }
  if (binding.kind === "coalesce") {
    return {
      $coalesce: binding.variables.map((variable) => ({
        $value: compileVariable(variable),
      })),
    };
  }
  if (binding.kind === "array") {
    return binding.items.map(compileWorkflowAuthoringBinding);
  }
  return Object.fromEntries(
    Object.entries(binding.fields).map(([key, value]) => [
      key,
      compileWorkflowAuthoringBinding(value),
    ]),
  );
}

function projectReference(
  reference: WorkflowValueReference,
): WorkflowAuthoringVariableV1 {
  if (reference.source === "workflow_input") {
    return {
      source: "workflow_input",
      path: pathFromPointer(reference.pointer),
    };
  }
  if (reference.source === "map_item") {
    return {
      source: "map_item",
      path: pathFromPointer(reference.pointer),
    };
  }
  return {
    source: reference.source,
    nodeKey: reference.nodeKey,
    scope: reference.scope,
    path: pathFromPointer(reference.pointer),
  };
}

export function projectWorkflowAuthoringBinding(
  value: WorkflowValueTemplate,
): WorkflowAuthoringBindingV1 {
  if (Array.isArray(value)) {
    return { kind: "array", items: value.map(projectWorkflowAuthoringBinding) };
  }
  if (isRecord(value)) {
    const record: Record<string, unknown> = value;
    const reference = record["$value"];
    if (isRecord(reference)) {
      return {
        kind: "variable",
        variable: projectReference(
          reference as unknown as WorkflowValueReference,
        ),
      };
    }
    if ("$literal" in record) {
      return {
        kind: "literal",
        value: record["$literal"] as WorkflowJsonValue,
      };
    }
    if (Array.isArray(record["$string"])) {
      return {
        kind: "text",
        segments: record["$string"].map((segment) => {
          if (typeof segment === "string") {
            return { kind: "literal" as const, text: segment };
          }
          const reference = isRecord(segment) ? segment["$value"] : undefined;
          return {
            kind: "variable" as const,
            variable: projectReference(reference as WorkflowValueReference),
          };
        }),
      };
    }
    if (Array.isArray(record["$coalesce"])) {
      return {
        kind: "coalesce",
        variables: record["$coalesce"].map((candidate) => {
          const reference = isRecord(candidate)
            ? candidate["$value"]
            : undefined;
          return projectReference(reference as WorkflowValueReference);
        }),
      };
    }
    return {
      kind: "object",
      fields: Object.fromEntries(
        Object.entries(record).map(([key, item]) => [
          key,
          projectWorkflowAuthoringBinding(item as WorkflowValueTemplate),
        ]),
      ),
    };
  }
  return { kind: "literal", value };
}

function schemaFields(
  schema: Readonly<Record<string, unknown>>,
): readonly WorkflowAuthoringFieldV1[] {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );
  return Object.entries(properties).map(([key, value]) => {
    const property = isRecord(value) ? value : {};
    return {
      key,
      label:
        typeof property.title === "string" && property.title.trim()
          ? property.title
          : key,
      required: required.has(key),
      schema: property,
    };
  });
}

function schemaMetadata(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const metadata = { ...schema };
  delete metadata.properties;
  delete metadata.required;
  return metadata;
}

function compileSchema(
  metadata: Readonly<Record<string, unknown>>,
  fields: readonly WorkflowAuthoringFieldV1[],
): Readonly<Record<string, unknown>> {
  return {
    ...metadata,
    type: "object",
    properties: Object.fromEntries(
      fields.map((field) => [
        field.key,
        { ...field.schema, title: field.label },
      ]),
    ),
    required: fields
      .filter((field) => field.required)
      .map((field) => field.key),
  };
}

function exactlyOneNode<T extends WorkflowAuthoringNodeV1["type"]>(
  graph: WorkflowAuthoringGraphV1,
  type: T,
  code: "input_node_required" | "output_node_required",
): Extract<WorkflowAuthoringNodeV1, { readonly type: T }> {
  const nodes = graph.nodes.filter(
    (node): node is Extract<WorkflowAuthoringNodeV1, { readonly type: T }> =>
      node.type === type,
  );
  if (nodes.length !== 1) {
    throw new WorkflowAuthoringCompileError(
      code,
      `Workflow authoring graph must contain exactly one ${type} node.`,
    );
  }
  return nodes[0]!;
}

function runtimeTargets(
  edges: readonly WorkflowAuthoringControlEdgeV1[],
  source: string,
  sourcePort: WorkflowAuthoringControlEdgeV1["sourcePort"],
): readonly string[] {
  return [
    ...new Set(
      edges
        .filter(
          (edge) => edge.source === source && edge.sourcePort === sourcePort,
        )
        .map((edge) => edge.target)
        .filter((target) => target !== workflowAuthoringOutputNodeId),
    ),
  ];
}

function compileConditionWhen(
  item: WorkflowAuthoringConditionCaseV1,
): Extract<
  WorkflowTopologyNodeV1,
  { readonly kind: "switch" }
>["cases"][number]["when"] {
  if (item.operator === "exists") return { operator: "exists" };
  if (item.operator === "in") {
    return {
      operator: "in",
      value: Array.isArray(item.value) ? item.value : [item.value ?? null],
    };
  }
  return { operator: item.operator, value: item.value ?? null };
}

function compileRuntimeNode(
  node: WorkflowAuthoringRuntimeNodeV1,
  edges: readonly WorkflowAuthoringControlEdgeV1[],
): WorkflowTopologyNodeV1 {
  const next = runtimeTargets(edges, node.id, "out");
  if (node.type === "capability") {
    return {
      key: node.nodeKey,
      kind: "invoke",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      capability: node.capability,
      input: compileWorkflowAuthoringBinding(node.input),
      next: [...next],
    };
  }
  if (node.type === "batch") {
    return {
      key: node.nodeKey,
      kind: "map",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      items: compileWorkflowAuthoringBinding(node.items),
      scopeKey: compileWorkflowAuthoringBinding(node.scopeKey),
      maxItems: node.maxItems,
      maxConcurrency: node.maxConcurrency,
      failureMode: node.failureMode,
      invoke: {
        capability: node.capability,
        input: compileWorkflowAuthoringBinding(node.input),
      },
      next: [...next],
    };
  }
  if (node.type === "approval") {
    return {
      key: node.nodeKey,
      kind: "approval",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      request: compileWorkflowAuthoringBinding(node.request),
      decisionSchema: node.decisionSchema,
      next: [...next],
    };
  }
  const cases = node.cases.map((item) => {
    const targets = runtimeTargets(edges, node.id, `case:${item.id}`);
    if (
      !edges.some(
        (edge) =>
          edge.source === node.id && edge.sourcePort === `case:${item.id}`,
      )
    ) {
      throw new WorkflowAuthoringCompileError(
        "condition_edge_invalid",
        `Condition ${node.id} case ${item.id} must target a runtime node or Output.`,
      );
    }
    const when = compileConditionWhen(item);
    return { when, next: [...targets] };
  });
  const defaultNext = runtimeTargets(edges, node.id, "default");
  if (
    !edges.some(
      (edge) => edge.source === node.id && edge.sourcePort === "default",
    )
  ) {
    throw new WorkflowAuthoringCompileError(
      "condition_edge_invalid",
      `Condition ${node.id} must have a default runtime target or Output.`,
    );
  }
  return {
    key: node.nodeKey,
    kind: "switch",
    ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
    value: compileWorkflowAuthoringBinding(node.value),
    cases,
    defaultNext: [...defaultNext],
  };
}

function assertGraphEdges(graph: WorkflowAuthoringGraphV1): void {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      throw new WorkflowAuthoringCompileError(
        "duplicate_node_id",
        `Duplicate authoring node id ${node.id}.`,
      );
    }
    ids.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new WorkflowAuthoringCompileError(
        "edge_target_missing",
        `Authoring edge ${edge.id} references a missing node.`,
      );
    }
  }
}

function assertEdgePorts(
  graph: WorkflowAuthoringGraphV1,
  input: WorkflowAuthoringInputNodeV1,
  output: WorkflowAuthoringOutputNodeV1,
): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source)!;
    if (edge.target === input.id) {
      throw new WorkflowAuthoringCompileError(
        "edge_port_invalid",
        "Input cannot receive control edges.",
      );
    }
    if (source.type === "output") {
      throw new WorkflowAuthoringCompileError(
        "output_edge_invalid",
        "Output cannot have outgoing control edges.",
      );
    }
    if (source.type === "input") {
      if (edge.sourcePort !== "start" || edge.target === output.id) {
        throw new WorkflowAuthoringCompileError(
          "input_edge_invalid",
          "Input may only use the Start port to one runtime node.",
        );
      }
      continue;
    }
    if (source.type === "condition") {
      const validCasePorts = new Set(
        source.cases.map((item) => `case:${item.id}`),
      );
      if (
        edge.sourcePort !== "default" &&
        !validCasePorts.has(edge.sourcePort)
      ) {
        throw new WorkflowAuthoringCompileError(
          "edge_port_invalid",
          `Condition ${source.id} uses an unknown branch port.`,
        );
      }
      continue;
    }
    if (edge.sourcePort !== "out") {
      throw new WorkflowAuthoringCompileError(
        "edge_port_invalid",
        `Node ${source.id} may only use its Control Out port.`,
      );
    }
  }
}

function reachableFrom(
  start: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      throw new WorkflowAuthoringCompileError(
        "cycle_detected",
        `Workflow authoring graph contains a cycle at ${nodeId}.`,
      );
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) visit(target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  visit(start);
  return visited;
}

function assertReachability(
  graph: WorkflowAuthoringGraphV1,
  input: WorkflowAuthoringInputNodeV1,
  output: WorkflowAuthoringOutputNodeV1,
): void {
  const adjacency = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.source) ?? new Set<string>();
    targets.add(edge.target);
    adjacency.set(edge.source, targets);
    const sources = reverse.get(edge.target) ?? new Set<string>();
    sources.add(edge.source);
    reverse.set(edge.target, sources);
  }
  const fromInput = reachableFrom(input.id, adjacency);
  for (const node of graph.nodes) {
    if (!fromInput.has(node.id)) {
      throw new WorkflowAuthoringCompileError(
        "node_unreachable",
        `Authoring node ${node.id} is not reachable from Input.`,
      );
    }
  }
  const toOutput = reachableFrom(output.id, reverse);
  for (const node of graph.nodes) {
    if (!toOutput.has(node.id)) {
      throw new WorkflowAuthoringCompileError(
        "output_unreachable",
        `Authoring node ${node.id} cannot reach Output.`,
      );
    }
  }
}

export function compileWorkflowAuthoringGraph(
  graph: WorkflowAuthoringGraphV1,
): CompiledWorkflowAuthoringDocumentV1 {
  assertGraphEdges(graph);
  const input = exactlyOneNode(graph, "input", "input_node_required");
  const output = exactlyOneNode(graph, "output", "output_node_required");
  assertEdgePorts(graph, input, output);
  const runtimeNodes = graph.nodes.filter(
    (node): node is WorkflowAuthoringRuntimeNodeV1 =>
      node.type !== "input" && node.type !== "output",
  );
  const inputEdges = graph.edges.filter((edge) => edge.source === input.id);
  if (
    inputEdges.length !== 1 ||
    inputEdges[0]!.sourcePort !== "start" ||
    inputEdges[0]!.target === output.id
  ) {
    throw new WorkflowAuthoringCompileError(
      "input_edge_invalid",
      "Input must have exactly one Start edge to a runtime node.",
    );
  }
  if (graph.edges.some((edge) => edge.source === output.id)) {
    throw new WorkflowAuthoringCompileError(
      "output_edge_invalid",
      "Output cannot have outgoing control edges.",
    );
  }
  if (!graph.edges.some((edge) => edge.target === output.id)) {
    throw new WorkflowAuthoringCompileError(
      "output_edge_invalid",
      "Output must receive at least one terminal control edge.",
    );
  }
  assertReachability(graph, input, output);
  const topology: WorkflowTopologyV1 = {
    schemaVersion: 1,
    key: graph.workflowKey,
    entryNodeKey: inputEdges[0]!.target,
    limits: graph.limits,
    nodes: runtimeNodes.map((node) => compileRuntimeNode(node, graph.edges)),
    outputs: Object.fromEntries(
      output.fields.map((field) => [
        field.key,
        {
          required: field.required,
          value: compileWorkflowAuthoringBinding(field.binding),
        },
      ]),
    ),
  };
  if (!isWorkflowTopology(topology)) {
    throw new WorkflowAuthoringCompileError(
      "topology_shape_invalid",
      "Compiled authoring graph does not match Workflow Topology V1.",
    );
  }
  return {
    schemaVersion: 1,
    topology,
    inputSchema: compileSchema(input.schemaMetadata, input.fields),
    outputSchema: compileSchema(output.schemaMetadata, output.fields),
  };
}

export function compileWorkflowAuthoringWorkspace(
  graph: WorkflowAuthoringGraphV1,
  layout: WorkflowAuthoringLayoutV1,
): CompiledWorkflowAuthoringWorkspaceV1 {
  return {
    document: compileWorkflowAuthoringGraph(graph),
    layout,
  };
}

function projectRuntimeNode(
  node: WorkflowTopologyNodeV1,
): WorkflowAuthoringRuntimeNodeV1 {
  if (node.kind === "invoke") {
    return {
      id: node.key,
      nodeKey: node.key,
      displayName: node.key,
      type: "capability",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      capability: node.capability,
      input: projectWorkflowAuthoringBinding(node.input),
    };
  }
  if (node.kind === "map") {
    return {
      id: node.key,
      nodeKey: node.key,
      displayName: node.key,
      type: "batch",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      items: projectWorkflowAuthoringBinding(node.items),
      scopeKey: projectWorkflowAuthoringBinding(node.scopeKey),
      maxItems: node.maxItems,
      maxConcurrency: node.maxConcurrency,
      failureMode: node.failureMode,
      capability: node.invoke.capability,
      input: projectWorkflowAuthoringBinding(node.invoke.input),
    };
  }
  if (node.kind === "approval") {
    return {
      id: node.key,
      nodeKey: node.key,
      displayName: node.key,
      type: "approval",
      ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
      request: projectWorkflowAuthoringBinding(node.request),
      decisionSchema: node.decisionSchema,
    };
  }
  return {
    id: node.key,
    nodeKey: node.key,
    displayName: node.key,
    type: "condition",
    ...(node.joinPolicy ? { joinPolicy: node.joinPolicy } : {}),
    value: projectWorkflowAuthoringBinding(node.value),
    cases: node.cases.map((item, index) => ({
      id: `case_${String(index + 1)}`,
      label: `Case ${String(index + 1)}`,
      operator: item.when.operator,
      ...(item.when.operator === "exists" ? {} : { value: item.when.value }),
    })),
    defaultLabel: "Default",
  };
}

export function projectWorkflowAuthoringGraph(
  document: CompiledWorkflowAuthoringDocumentV1,
): WorkflowAuthoringGraphV1 {
  const input: WorkflowAuthoringInputNodeV1 = {
    id: workflowAuthoringInputNodeId,
    type: "input",
    displayName: "Input",
    schemaMetadata: schemaMetadata(document.inputSchema),
    fields: schemaFields(document.inputSchema),
  };
  const output: WorkflowAuthoringOutputNodeV1 = {
    id: workflowAuthoringOutputNodeId,
    type: "output",
    displayName: "Output",
    schemaMetadata: schemaMetadata(document.outputSchema),
    fields: schemaFields(document.outputSchema).map((field) => ({
      ...field,
      binding: projectWorkflowAuthoringBinding(
        document.topology.outputs[field.key]?.value ?? "",
      ),
    })),
  };
  const runtimeNodes = document.topology.nodes.map(projectRuntimeNode);
  const edges: WorkflowAuthoringControlEdgeV1[] = [
    {
      id: `${input.id}:${document.topology.entryNodeKey}`,
      source: input.id,
      sourcePort: "start",
      target: document.topology.entryNodeKey,
    },
  ];
  for (const node of document.topology.nodes) {
    if (node.kind === "switch") {
      node.cases.forEach((item, index) => {
        for (const target of item.next.length > 0 ? item.next : [output.id]) {
          edges.push({
            id: `${node.key}:case_${String(index + 1)}:${target}`,
            source: node.key,
            sourcePort: `case:case_${String(index + 1)}`,
            target,
          });
        }
      });
      for (const target of node.defaultNext.length > 0
        ? node.defaultNext
        : [output.id]) {
        edges.push({
          id: `${node.key}:default:${target}`,
          source: node.key,
          sourcePort: "default",
          target,
        });
      }
      continue;
    }
    for (const target of node.next) {
      edges.push({
        id: `${node.key}:out:${target}`,
        source: node.key,
        sourcePort: "out",
        target,
      });
    }
  }
  const terminalNodes = document.topology.nodes.filter((node) => {
    if (node.kind === "switch") return false;
    return node.next.length === 0;
  });
  for (const node of terminalNodes) {
    edges.push({
      id: `${node.key}:${output.id}`,
      source: node.key,
      sourcePort: "out",
      target: output.id,
    });
  }
  return {
    schemaVersion: 1,
    workflowKey: document.topology.key,
    limits: document.topology.limits,
    nodes: [input, ...runtimeNodes, output],
    edges,
  };
}
