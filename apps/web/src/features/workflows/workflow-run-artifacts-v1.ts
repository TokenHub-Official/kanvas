import type {
  WorkflowAuthoringCapability,
  WorkflowRunDetails,
} from "@kanvas/contracts/api";
import type {
  WorkflowAuthoringGraphV1,
  WorkflowAuthoringNodeV1,
  WorkflowAuthoringVariableV1,
} from "@kanvas/contracts/workflow-authoring";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

export interface WorkflowRunArtifactV1 {
  readonly artifactId: string;
  readonly fieldKey: string;
  readonly label: Readonly<{ "zh-CN": string; "en-US": string }>;
  readonly nodeKey?: string;
  readonly primary: boolean;
  readonly semanticType: string;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function artifactIds(value: unknown): readonly string[] {
  if (typeof value === "string" && artifactIdPattern.test(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string =>
        typeof item === "string" && artifactIdPattern.test(item),
    );
  }
  return [];
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    const source = recordOf(current);
    if (!(segment in source)) return undefined;
    current = source[segment];
  }
  return current;
}

function capabilityForNode(
  node: WorkflowAuthoringNodeV1 | undefined,
  capabilities: readonly WorkflowAuthoringCapability[],
): WorkflowAuthoringCapability | undefined {
  if (!node || (node.type !== "capability" && node.type !== "batch")) {
    return undefined;
  }
  return capabilities.find(
    (capability) =>
      capability.contractId === node.capability.contractId &&
      capability.revision === node.capability.revision,
  );
}

function sourceVariable(
  graph: WorkflowAuthoringGraphV1,
  fieldKey: string,
): WorkflowAuthoringVariableV1 | undefined {
  const output = graph.nodes.find((node) => node.type === "output");
  const binding =
    output?.type === "output"
      ? output.fields.find((field) => field.key === fieldKey)?.binding
      : undefined;
  return binding?.kind === "variable" ? binding.variable : undefined;
}

function declarationArtifacts(
  nodeKey: string,
  output: unknown,
  graph: WorkflowAuthoringGraphV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): readonly WorkflowRunArtifactV1[] {
  const node = graph.nodes.find(
    (candidate) =>
      (candidate.type === "capability" || candidate.type === "batch") &&
      candidate.nodeKey === nodeKey,
  );
  const capability = capabilityForNode(node, capabilities);
  const record = recordOf(output);
  return (capability?.authoring.outputs ?? []).flatMap((declaration) => {
    if (!declaration.semanticType.startsWith("artifact.")) return [];
    return artifactIds(record[declaration.key]).map((artifactId) => ({
      artifactId,
      fieldKey: declaration.key,
      label: declaration.label,
      nodeKey,
      primary: declaration.primary,
      semanticType: declaration.semanticType,
    }));
  });
}

export function workflowRunFinalArtifactsV1(
  run: Pick<WorkflowRunDetails, "output">,
  graph: WorkflowAuthoringGraphV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): readonly WorkflowRunArtifactV1[] {
  const output = recordOf(run.output);
  const outputNode = graph.nodes.find((node) => node.type === "output");
  if (!outputNode || outputNode.type !== "output") return [];

  return outputNode.fields.flatMap((field) => {
    const variable = sourceVariable(graph, field.key);
    if (
      !variable ||
      (variable.source !== "node_output" &&
        variable.source !== "node_result") ||
      variable.path.length < 1
    ) {
      return [];
    }
    const sourceNode = graph.nodes.find(
      (candidate) =>
        (candidate.type === "capability" || candidate.type === "batch") &&
        candidate.nodeKey === variable.nodeKey,
    );
    const capability = capabilityForNode(sourceNode, capabilities);
    const declaration = capability?.authoring.outputs.find(
      (item) => item.key === variable.path[0],
    );
    if (!declaration?.semanticType.startsWith("artifact.")) return [];
    return artifactIds(output[field.key]).map((artifactId) => ({
      artifactId,
      fieldKey: field.key,
      label: {
        "zh-CN": field.label,
        "en-US": field.label,
      },
      nodeKey: variable.nodeKey,
      primary: declaration.primary,
      semanticType: declaration.semanticType,
    }));
  });
}

/**
 * Projects recoverable user results from fields explicitly wired to the Workflow
 * output. Node artifacts that are only implementation intermediates stay out of
 * the result surface.
 */
export function workflowRunAvailableArtifacts(
  run: Pick<WorkflowRunDetails, "nodes" | "output">,
  graph: WorkflowAuthoringGraphV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): readonly WorkflowRunArtifactV1[] {
  const projected = [...workflowRunFinalArtifactsV1(run, graph, capabilities)];
  const seen = new Set(projected.map((artifact) => artifact.artifactId));
  const outputNode = graph.nodes.find((node) => node.type === "output");
  if (!outputNode || outputNode.type !== "output") return projected;

  for (const field of outputNode.fields) {
    const variable = sourceVariable(graph, field.key);
    if (
      !variable ||
      (variable.source !== "node_output" &&
        variable.source !== "node_result") ||
      variable.path.length < 1
    ) {
      continue;
    }
    const sourceNode = graph.nodes.find(
      (node) =>
        (node.type === "capability" || node.type === "batch") &&
        node.nodeKey === variable.nodeKey,
    );
    const declaration = capabilityForNode(
      sourceNode,
      capabilities,
    )?.authoring.outputs.find((item) => item.key === variable.path[0]);
    if (!declaration?.semanticType.startsWith("artifact.")) continue;
    const nodeRun = run.nodes.find((node) => node.nodeKey === variable.nodeKey);
    for (const artifactId of artifactIds(
      valueAtPath(nodeRun?.output, variable.path),
    )) {
      if (seen.has(artifactId)) continue;
      seen.add(artifactId);
      projected.push({
        artifactId,
        fieldKey: field.key,
        label: { "zh-CN": field.label, "en-US": field.label },
        nodeKey: variable.nodeKey,
        primary: declaration.primary,
        semanticType: declaration.semanticType,
      });
    }
  }
  return projected;
}

export function workflowRunNodeArtifactsV1(
  nodeKey: string,
  output: unknown,
  graph: WorkflowAuthoringGraphV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): readonly WorkflowRunArtifactV1[] {
  return declarationArtifacts(nodeKey, output, graph, capabilities);
}
