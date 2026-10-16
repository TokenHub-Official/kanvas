import type {
  ValidateWorkflowTopologyResult,
  WorkflowTopology,
  WorkflowTopologyDiagnostic,
  WorkflowTopologyNodeV1,
} from "@kanvas/contracts/workflow";

import {
  inspectWorkflowValueTemplate,
  WorkflowValueProtocolError,
  type WorkflowValueTemplateInspection,
} from "./workflow-values.js";

export interface ValidateWorkflowTopologyCommand {
  readonly topology: WorkflowTopology;
}

export type ValidateWorkflowTopology = (
  command: ValidateWorkflowTopologyCommand,
) => Promise<ValidateWorkflowTopologyResult>;

const maximumStaticEdgesPerNode = 20;
const maximumTopologyTemplateNodes = 100_000;
const maximumTopologyTemplateTextUnits = 4_000_000;

function outgoingTargets(node: WorkflowTopologyNodeV1): readonly string[] {
  if (node.kind !== "switch") {
    return node.next;
  }
  return Object.freeze([
    ...node.cases.flatMap(({ next }) => next),
    ...node.defaultNext,
  ]);
}

function buildAdjacency(
  topology: WorkflowTopology,
): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, ReadonlySet<string>>();
  for (const node of topology.nodes) {
    const targets = new Set(adjacency.get(node.key) ?? []);
    outgoingTargets(node).forEach((target) => {
      targets.add(target);
    });
    adjacency.set(node.key, targets);
  }
  return adjacency;
}

function findCycles(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): WorkflowTopologyDiagnostic[] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycleNodes = new Set<string>();

  const visit = (nodeKey: string): void => {
    if (state.get(nodeKey) === "visited") {
      return;
    }
    if (state.get(nodeKey) === "visiting") {
      const start = stack.lastIndexOf(nodeKey);
      stack.slice(Math.max(0, start)).forEach((key) => {
        cycleNodes.add(key);
      });
      return;
    }
    state.set(nodeKey, "visiting");
    stack.push(nodeKey);
    for (const target of adjacency.get(nodeKey) ?? []) {
      if (adjacency.has(target)) {
        visit(target);
      }
    }
    stack.pop();
    state.set(nodeKey, "visited");
  };

  [...adjacency.keys()].sort().forEach(visit);
  return [...cycleNodes].sort().map((nodeKey) => ({
    code: "cycle_detected",
    nodeKey,
    message: `Workflow topology contains a cycle involving node ${nodeKey}.`,
  }));
}

function reachableFrom(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const nodeKey = pending.pop();
    if (!nodeKey || reachable.has(nodeKey)) {
      continue;
    }
    reachable.add(nodeKey);
    for (const target of adjacency.get(nodeKey) ?? []) {
      if (adjacency.has(target) && !reachable.has(target)) {
        pending.push(target);
      }
    }
  }
  return reachable;
}

function canReach(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  target: string,
): boolean {
  return reachableFrom(adjacency, start).has(target);
}

interface TemplateValidationContext {
  readonly path: string;
  readonly nodeKey?: string;
  readonly allowMapItem: boolean;
  readonly requireDirectMapItem?: boolean;
  readonly outputSelection?: boolean;
}

interface TemplateTotals {
  nodes: number;
  textUnits: number;
  limitReported: boolean;
}

function validateTemplateReferences(
  inspection: WorkflowValueTemplateInspection,
  context: TemplateValidationContext,
  keys: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  diagnostics: WorkflowTopologyDiagnostic[],
): void {
  if (context.requireDirectMapItem) {
    const directMapItem =
      inspection.references.length === 1 &&
      inspection.references[0]?.path === context.path &&
      inspection.references[0].reference.source === "map_item";
    if (!directMapItem) {
      diagnostics.push({
        code: "invalid_value_template",
        ...(context.nodeKey ? { nodeKey: context.nodeKey } : {}),
        path: context.path,
        message:
          "Map scopeKey must be one direct map_item reference so replay identity is data-derived.",
      });
    }
  }

  for (const { path, reference } of inspection.references) {
    if (reference.source === "map_item") {
      if (!context.allowMapItem) {
        diagnostics.push({
          code: "map_item_out_of_scope",
          ...(context.nodeKey ? { nodeKey: context.nodeKey } : {}),
          path,
          message:
            "map_item references are only valid in map scopeKey and the inline invoke input.",
        });
      }
      continue;
    }
    if (
      reference.source !== "node_output" &&
      reference.source !== "node_result"
    ) {
      continue;
    }
    if (!keys.has(reference.nodeKey)) {
      diagnostics.push({
        code: "reference_node_missing",
        ...(context.nodeKey ? { nodeKey: context.nodeKey } : {}),
        targetKey: reference.nodeKey,
        path,
        message: `Value reference targets missing node ${reference.nodeKey}.`,
      });
      continue;
    }
    if (reference.scope !== "root") {
      diagnostics.push({
        code: "reference_scope_invalid",
        ...(context.nodeKey ? { nodeKey: context.nodeKey } : {}),
        targetKey: reference.nodeKey,
        path,
        message:
          "Workflow v1 has no nested subgraph; node references must use root scope.",
      });
    }
    if (
      context.nodeKey &&
      !context.outputSelection &&
      (reference.nodeKey === context.nodeKey ||
        !canReach(adjacency, reference.nodeKey, context.nodeKey))
    ) {
      diagnostics.push({
        code: "reference_not_upstream",
        nodeKey: context.nodeKey,
        targetKey: reference.nodeKey,
        path,
        message: `Node ${context.nodeKey} may only read a statically upstream terminal node.`,
      });
    }
  }
}

function validateTemplate(
  template: unknown,
  context: TemplateValidationContext,
  keys: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  diagnostics: WorkflowTopologyDiagnostic[],
  totals: TemplateTotals,
): void {
  try {
    const inspection = inspectWorkflowValueTemplate(template, context.path);
    totals.nodes += inspection.nodeCount;
    totals.textUnits += inspection.textUnits;
    validateTemplateReferences(
      inspection,
      context,
      keys,
      adjacency,
      diagnostics,
    );
    if (
      !totals.limitReported &&
      (totals.nodes > maximumTopologyTemplateNodes ||
        totals.textUnits > maximumTopologyTemplateTextUnits)
    ) {
      totals.limitReported = true;
      diagnostics.push({
        code: "limit_exceeded",
        path: context.path,
        message:
          "Combined workflow value templates exceed the publication budget.",
      });
    }
  } catch (error) {
    diagnostics.push({
      code: "invalid_value_template",
      ...(context.nodeKey ? { nodeKey: context.nodeKey } : {}),
      path:
        error instanceof WorkflowValueProtocolError ? error.path : context.path,
      message:
        error instanceof Error
          ? error.message
          : "Workflow value template is invalid.",
    });
  }
}

function validateTopology(
  topology: WorkflowTopology,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  keys: ReadonlySet<string>,
  diagnostics: WorkflowTopologyDiagnostic[],
): void {
  if (!keys.has(topology.entryNodeKey)) {
    diagnostics.push({
      code: "entry_node_missing",
      targetKey: topology.entryNodeKey,
      message: `Entry node ${topology.entryNodeKey} does not exist.`,
    });
  } else {
    const reachable = reachableFrom(adjacency, topology.entryNodeKey);
    for (const nodeKey of [...keys].sort()) {
      if (!reachable.has(nodeKey)) {
        diagnostics.push({
          code: "unreachable_node",
          nodeKey,
          message: `Node ${nodeKey} is not reachable from entry node ${topology.entryNodeKey}.`,
        });
      }
    }
  }

  const incoming = new Map<string, number>();
  for (const targets of adjacency.values()) {
    for (const target of targets) {
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  for (const node of topology.nodes) {
    if ((incoming.get(node.key) ?? 0) > 1 && node.joinPolicy === undefined) {
      diagnostics.push({
        code: "join_policy_required",
        nodeKey: node.key,
        message: `Node ${node.key} has multiple potential inputs and must declare joinPolicy.`,
      });
    }
  }

  const worstCaseNodeRuns =
    topology.nodes.length +
    topology.nodes.reduce(
      (total, node) => total + (node.kind === "map" ? node.maxItems : 0),
      0,
    );
  if (worstCaseNodeRuns > topology.limits.maxNodeRuns) {
    diagnostics.push({
      code: "limit_exceeded",
      path: "/limits/maxNodeRuns",
      message: `Worst-case expansion creates ${String(worstCaseNodeRuns)} NodeRuns, above the declared maximum ${String(topology.limits.maxNodeRuns)}.`,
    });
  }

  const totals: TemplateTotals = {
    nodes: 0,
    textUnits: 0,
    limitReported: false,
  };
  for (const node of topology.nodes) {
    const path = `/nodes/${node.key}`;
    if (node.kind === "invoke") {
      validateTemplate(
        node.input,
        {
          path: `${path}/input`,
          nodeKey: node.key,
          allowMapItem: false,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
    } else if (node.kind === "map") {
      validateTemplate(
        node.items,
        {
          path: `${path}/items`,
          nodeKey: node.key,
          allowMapItem: false,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
      validateTemplate(
        node.scopeKey,
        {
          path: `${path}/scopeKey`,
          nodeKey: node.key,
          allowMapItem: true,
          requireDirectMapItem: true,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
      validateTemplate(
        node.invoke.input,
        {
          path: `${path}/invoke/input`,
          nodeKey: node.key,
          allowMapItem: true,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
    } else if (node.kind === "switch") {
      validateTemplate(
        node.value,
        {
          path: `${path}/value`,
          nodeKey: node.key,
          allowMapItem: false,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
    } else {
      validateTemplate(
        node.request,
        {
          path: `${path}/request`,
          nodeKey: node.key,
          allowMapItem: false,
        },
        keys,
        adjacency,
        diagnostics,
        totals,
      );
    }
  }
  for (const [outputKey, selection] of Object.entries(topology.outputs).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    validateTemplate(
      selection.value,
      {
        path: `/outputs/${outputKey}/value`,
        allowMapItem: false,
        outputSelection: true,
      },
      keys,
      adjacency,
      diagnostics,
      totals,
    );
  }
}

export function validateWorkflowTopology({
  topology,
}: ValidateWorkflowTopologyCommand): ValidateWorkflowTopologyResult {
  const diagnostics: WorkflowTopologyDiagnostic[] = [];
  const counts = new Map<string, number>();

  for (const node of topology.nodes) {
    counts.set(node.key, (counts.get(node.key) ?? 0) + 1);
  }
  for (const [nodeKey, count] of [...counts].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (count > 1) {
      diagnostics.push({
        code: "duplicate_node_key",
        nodeKey,
        message: `Node key ${nodeKey} appears ${String(count)} times.`,
      });
    }
  }

  const keys = new Set(counts.keys());
  const adjacency = buildAdjacency(topology);
  for (const node of topology.nodes) {
    const targets = outgoingTargets(node);
    const uniqueTargets = new Set(targets);
    if (
      uniqueTargets.size > maximumStaticEdgesPerNode ||
      (node.kind !== "switch" && uniqueTargets.size !== targets.length)
    ) {
      diagnostics.push({
        code:
          uniqueTargets.size > maximumStaticEdgesPerNode
            ? "limit_exceeded"
            : "duplicate_target",
        nodeKey: node.key,
        message:
          uniqueTargets.size > maximumStaticEdgesPerNode
            ? `Node ${node.key} exceeds the maximum of ${String(maximumStaticEdgesPerNode)} static targets.`
            : `Node ${node.key} contains a duplicate target.`,
      });
    }
    for (const targetKey of uniqueTargets) {
      if (!keys.has(targetKey)) {
        diagnostics.push({
          code: "missing_target",
          nodeKey: node.key,
          targetKey,
          message: `Node ${node.key} targets missing node ${targetKey}.`,
        });
      }
    }
  }

  diagnostics.push(...findCycles(adjacency));
  validateTopology(topology, adjacency, keys, diagnostics);

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

export function createValidateWorkflowTopology(): ValidateWorkflowTopology {
  return (command) => Promise.resolve(validateWorkflowTopology(command));
}
