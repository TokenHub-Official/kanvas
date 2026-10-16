import type { WorkflowAuthoringCapability } from "@kanvas/contracts/api";
import type {
  WorkflowAuthoringGraphV1,
  WorkflowAuthoringLayoutV1,
  WorkflowAuthoringNodeV1,
} from "@kanvas/contracts/workflow-authoring";

const horizontalGap = 300;
const verticalGap = 168;
const originX = 140;
const originY = 180;

function layoutStorageKey(draftId: string): string {
  return `kanvas:workflow-authoring-shell-layout:v1:${draftId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowAuthoringNodeUsesCapabilityIdentity(
  node: WorkflowAuthoringNodeV1,
  capability?: Pick<WorkflowAuthoringCapability, "contractId" | "contractKey">,
): boolean {
  if (node.type !== "capability" && node.type !== "batch") return false;
  const displayName = node.displayName.trim();
  return (
    displayName === node.nodeKey ||
    displayName === node.capability.contractId ||
    displayName === capability?.contractId ||
    displayName === capability?.contractKey
  );
}

export function readWorkflowAuthoringShellLayout(
  draftId: string,
): WorkflowAuthoringLayoutV1 | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = JSON.parse(
      localStorage.getItem(layoutStorageKey(draftId)) ?? "null",
    ) as unknown;
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !isRecord(value.positions)
    ) {
      return undefined;
    }
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, position] of Object.entries(value.positions)) {
      if (
        isRecord(position) &&
        typeof position.x === "number" &&
        Number.isFinite(position.x) &&
        typeof position.y === "number" &&
        Number.isFinite(position.y)
      ) {
        positions[id] = { x: position.x, y: position.y };
      }
    }
    return { schemaVersion: 1, positions };
  } catch {
    return undefined;
  }
}

export function writeWorkflowAuthoringShellLayout(
  draftId: string,
  layout: WorkflowAuthoringLayoutV1,
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(layoutStorageKey(draftId), JSON.stringify(layout));
}

function authoringDepths(
  graph: WorkflowAuthoringGraphV1,
): ReadonlyMap<string, number> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const edge of graph.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }
  const queue = graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const depths = new Map(graph.nodes.map((node) => [node.id, 0]));
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source) continue;
    for (const target of outgoing.get(source) ?? []) {
      depths.set(
        target,
        Math.max(depths.get(target) ?? 0, (depths.get(source) ?? 0) + 1),
      );
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  return depths;
}

export function defaultWorkflowAuthoringShellLayout(
  graph: WorkflowAuthoringGraphV1,
): WorkflowAuthoringLayoutV1 {
  const depths = authoringDepths(graph);
  const columns = new Map<number, WorkflowAuthoringNodeV1[]>();
  for (const node of graph.nodes) {
    const depth = depths.get(node.id) ?? 0;
    const nodes = columns.get(depth) ?? [];
    nodes.push(node);
    columns.set(depth, nodes);
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [depth, nodes] of columns) {
    const columnHeight = Math.max(0, (nodes.length - 1) * verticalGap);
    nodes.forEach((node, index) => {
      positions[node.id] = {
        x: originX + depth * horizontalGap,
        y: originY - columnHeight / 2 + index * verticalGap,
      };
    });
  }
  return { schemaVersion: 1, positions };
}

export type WorkflowAuthoringShellIssueCode =
  | "input_fields_missing"
  | "output_fields_missing"
  | "condition_value_missing"
  | "batch_items_missing"
  | "output_binding_missing";

export interface WorkflowAuthoringShellIssue {
  readonly code: WorkflowAuthoringShellIssueCode;
  readonly nodeId: string;
}

export function workflowAuthoringShellIssues(
  graph: WorkflowAuthoringGraphV1,
): readonly WorkflowAuthoringShellIssue[] {
  const issues: WorkflowAuthoringShellIssue[] = [];
  const input = graph.nodes.find((node) => node.type === "input");
  const output = graph.nodes.find((node) => node.type === "output");
  if (input?.type === "input" && input.fields.length === 0) {
    issues.push({ code: "input_fields_missing", nodeId: input.id });
  }
  if (output?.type === "output" && output.fields.length === 0) {
    issues.push({ code: "output_fields_missing", nodeId: output.id });
  }
  for (const node of graph.nodes) {
    if (
      node.type === "condition" &&
      node.value.kind === "literal" &&
      node.value.value === null
    ) {
      issues.push({ code: "condition_value_missing", nodeId: node.id });
    }
    if (
      node.type === "batch" &&
      node.items.kind === "literal" &&
      (node.items.value === null ||
        (Array.isArray(node.items.value) && node.items.value.length === 0))
    ) {
      issues.push({ code: "batch_items_missing", nodeId: node.id });
    }
    if (node.type === "output") {
      for (const field of node.fields) {
        if (field.binding.kind === "literal" && field.binding.value === null) {
          issues.push({ code: "output_binding_missing", nodeId: node.id });
          break;
        }
      }
    }
  }
  return issues;
}
