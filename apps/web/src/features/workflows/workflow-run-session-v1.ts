import type {
  EffectiveInvocationSchema,
  WorkflowRunDetails,
} from "@kanvas/contracts/api";

const ACTIVE_RUN_FAST_POLL_INTERVAL_MS = 750;
const ACTIVE_RUN_SETTLED_POLL_INTERVAL_MS = 2_000;
const ACTIVE_RUN_FAST_POLL_WINDOW_MS = 30_000;

export type WorkflowRunExperienceStateV1 =
  | "cancelled"
  | "complete"
  | "failed"
  | "partial"
  | "preparing"
  | "stopping"
  | "waiting"
  | "working";

export function workflowRunExperienceStateV1(
  lifecycleStatus: WorkflowRunDetails["lifecycleStatus"],
  outcome: WorkflowRunDetails["outcome"] = null,
): WorkflowRunExperienceStateV1 {
  if (lifecycleStatus === "completed" && outcome === "partial_success") {
    return "partial";
  }
  if (lifecycleStatus === "completed" && outcome === "no_usable_output") {
    return "failed";
  }
  if (lifecycleStatus === "completed") return "complete";
  if (lifecycleStatus === "failed") return "failed";
  if (lifecycleStatus === "cancelled") return "cancelled";
  if (lifecycleStatus === "waiting") return "waiting";
  if (lifecycleStatus === "cancelling") return "stopping";
  if (lifecycleStatus === "queued") return "preparing";
  return "working";
}

export function workflowRunIsTerminalV1(
  run: Pick<WorkflowRunDetails, "lifecycleStatus"> | undefined,
): boolean {
  return (
    run?.lifecycleStatus === "completed" ||
    run?.lifecycleStatus === "failed" ||
    run?.lifecycleStatus === "cancelled"
  );
}

export function workflowRunPollIntervalV1(
  run: Pick<WorkflowRunDetails, "createdAt" | "lifecycleStatus"> | undefined,
  now = Date.now(),
): number | false {
  if (workflowRunIsTerminalV1(run)) return false;
  const createdAt = run ? Date.parse(run.createdAt) : Number.NaN;
  return Number.isFinite(createdAt) &&
    now - createdAt >= ACTIVE_RUN_FAST_POLL_WINDOW_MS
    ? ACTIVE_RUN_SETTLED_POLL_INTERVAL_MS
    : ACTIVE_RUN_FAST_POLL_INTERVAL_MS;
}

export function workflowRunCompletedStepCountV1(
  nodes: WorkflowRunDetails["nodes"],
): number {
  return nodes.filter(
    (node) =>
      node.lifecycleStatus === "completed" ||
      node.lifecycleStatus === "skipped",
  ).length;
}

export function workflowRunProgressV1(
  nodes: WorkflowRunDetails["nodes"],
): number {
  if (nodes.length === 0) return 0;
  return Math.round(
    (workflowRunCompletedStepCountV1(nodes) / nodes.length) * 100,
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

export interface WorkflowRunDisplayOutputField {
  readonly key: string;
  readonly label?: string;
  readonly value: unknown;
}

export function workflowRunDisplayOutputFields(
  output: unknown,
  outputSchema?: Readonly<Record<string, unknown>>,
): readonly WorkflowRunDisplayOutputField[] {
  if (output === undefined || output === null) return [];
  if (typeof output !== "object" || Array.isArray(output)) {
    if (Array.isArray(output) && output.length === 0) return [];
    return [{ key: "output", value: output }];
  }
  const properties = record(outputSchema?.properties);
  return Object.entries(record(output))
    .filter(([key]) => key !== "schemaVersion")
    .map(([key, value]) => {
      const definition = record(properties[key]);
      const title =
        typeof definition.title === "string" && definition.title.trim()
          ? definition.title
          : undefined;
      return title ? { key, label: title, value } : { key, value };
    });
}

export function workflowRunSourceArtifactIdsV1(
  schema: EffectiveInvocationSchema | undefined,
  input: unknown,
): readonly string[] {
  if (!schema || schema.availability !== "available") return [];
  const values = record(input);
  const artifactIds: string[] = [];
  for (const field of schema.fields) {
    if (field.valueType === "artifact") {
      const value = values[field.key];
      if (typeof value === "string") artifactIds.push(value);
    } else if (field.valueType === "artifact_list") {
      const value = values[field.key];
      if (Array.isArray(value)) {
        artifactIds.push(
          ...value.filter((item): item is string => typeof item === "string"),
        );
      }
    }
  }
  return [...new Set(artifactIds)];
}
