import type { AgentToolFamily, AgentSurfaceView } from "@kanvas/application";

import type { KanvasAgentToolDescriptor } from "./tool-view.js";

export interface AgentWorkflowEntrypointBinding {
  readonly actionRef: string;
  readonly toolKey: string;
  readonly skillRevisionId: string;
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
}

export interface DynamicAgentToolView {
  readonly descriptors: readonly KanvasAgentToolDescriptor[];
  readonly projectedToolFamilies: readonly AgentToolFamily[];
  readonly workflowEntrypoints: ReadonlyMap<
    string,
    AgentWorkflowEntrypointBinding
  >;
  readonly toolViewDigest: string;
}

export interface AgentToolFamilyProjection {
  readonly family: AgentToolFamily;
  readonly descriptors: readonly KanvasAgentToolDescriptor[];
  readonly digestMaterial: unknown;
  readonly workflowEntrypoints?: ReadonlyMap<
    string,
    AgentWorkflowEntrypointBinding
  >;
}

export class AgentToolViewError extends Error {
  public readonly code = "agent.tool_family_unavailable";

  public constructor(message: string) {
    super(message);
    this.name = "AgentToolViewError";
  }
}

export interface CreateDynamicAgentToolViewOptions {
  readonly surfaceView: AgentSurfaceView;
  readonly projections?: readonly AgentToolFamilyProjection[];
  readonly digest: (value: unknown) => string;
}
export function mergeAgentToolFamilyProjections(
  projections: readonly [
    AgentToolFamilyProjection,
    ...AgentToolFamilyProjection[],
  ],
): AgentToolFamilyProjection {
  const family = projections[0].family;
  if (projections.some((projection) => projection.family !== family)) {
    throw new AgentToolViewError(
      "Only projections from one Agent Tool Family can be merged.",
    );
  }
  const workflowEntrypoints = new Map<string, AgentWorkflowEntrypointBinding>();
  for (const projection of projections) {
    for (const [toolKey, binding] of projection.workflowEntrypoints ?? []) {
      if (workflowEntrypoints.has(toolKey)) {
        throw new AgentToolViewError(
          "Agent Workflow Entrypoint binding is duplicated.",
        );
      }
      workflowEntrypoints.set(toolKey, binding);
    }
  }
  return Object.freeze({
    family,
    descriptors: Object.freeze(
      projections.flatMap((projection) => projection.descriptors),
    ),
    digestMaterial: Object.freeze({
      schemaVersion: 1,
      projections: Object.freeze(
        projections.map((projection) =>
          Object.freeze({
            digestMaterial: projection.digestMaterial,
            toolKeys: Object.freeze(
              projection.descriptors.map((descriptor) => descriptor.key),
            ),
          }),
        ),
      ),
    }),
    ...(workflowEntrypoints.size > 0
      ? { workflowEntrypoints: new Map(workflowEntrypoints) }
      : {}),
  });
}

export function createDynamicAgentToolView(
  options: CreateDynamicAgentToolViewOptions,
): DynamicAgentToolView {
  const projections = options.projections ?? [];
  const projectionFamilies = projections.map((projection) => projection.family);
  if (new Set(projectionFamilies).size !== projectionFamilies.length) {
    throw new AgentToolViewError("Agent Tool Family projection is duplicated.");
  }
  const registeredFamilies = new Set<AgentToolFamily>(projectionFamilies);
  const missingFamilies =
    options.surfaceView.profile.manifest.requiredToolFamilies.filter(
      (family) => !registeredFamilies.has(family),
    );
  if (missingFamilies.length > 0) {
    throw new AgentToolViewError(
      `Agent Profile requires unavailable Tool Family projections: ${missingFamilies.join(", ")}.`,
    );
  }
  const enabledProjections = projections.filter((projection) =>
    options.surfaceView.profile.manifest.allowedToolFamilies.includes(
      projection.family,
    ),
  );
  const descriptors = Object.freeze([
    ...enabledProjections.flatMap((projection) => projection.descriptors),
  ]);
  const descriptorKeys = descriptors.map((descriptor) => descriptor.key);
  if (new Set(descriptorKeys).size !== descriptorKeys.length) {
    throw new AgentToolViewError(
      "Agent Tool key is duplicated across Family projections.",
    );
  }
  const workflowEntrypoints = new Map<string, AgentWorkflowEntrypointBinding>();
  for (const projection of enabledProjections) {
    for (const [toolKey, binding] of projection.workflowEntrypoints ?? []) {
      if (workflowEntrypoints.has(toolKey)) {
        throw new AgentToolViewError(
          "Agent Workflow Entrypoint binding is duplicated.",
        );
      }
      workflowEntrypoints.set(toolKey, binding);
    }
  }
  const projectedToolFamilies = Object.freeze(
    enabledProjections.map((projection) => projection.family),
  );
  return Object.freeze({
    descriptors,
    projectedToolFamilies,
    workflowEntrypoints,
    toolViewDigest: options.digest({
      profileRevisionId: options.surfaceView.profile.id,
      skillViewDigest: options.surfaceView.skillViewDigest,
      projectedToolFamilies,
      bindings: [...workflowEntrypoints.values()],
      projections: enabledProjections.map((projection) => ({
        family: projection.family,
        digestMaterial: projection.digestMaterial,
        toolKeys: projection.descriptors.map((descriptor) => descriptor.key),
      })),
    }),
  });
}
