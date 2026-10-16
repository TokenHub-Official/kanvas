import type {
  AgentActionReceiptRecord,
  AgentContextSnapshotV1,
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
  WorkflowRunQueryRepository,
} from "@kanvas/application";
import type {
  ThreadWorkQueryToolExecution,
  ThreadWorkQueryToolExecutors,
  ThreadWorkQueryToolInput,
} from "@kanvas/agent-runtime";
import type {
  CapabilityRunStore,
  WorkspaceContentQueryStore,
} from "@kanvas/database/runtime";

const maximumTasks = 12;
const maximumArtifactsPerTask = 8;
const imageMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface AgentThreadResultArtifact {
  readonly id: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly displayFilename?: string;
}

export class AgentThreadResultError extends Error {
  public constructor(
    public readonly code:
      | "agent.result_not_linked"
      | "agent.result_unavailable"
      | "agent.result_not_image",
  ) {
    super("The conversation result cannot be used.");
    this.name = "AgentThreadResultError";
  }
}

function proposal(action: {
  readonly proposalDocument?: Readonly<Record<string, unknown>>;
}):
  | {
      readonly title: string;
      readonly description?: string;
    }
  | undefined {
  const value = action.proposalDocument;
  if (
    !value ||
    typeof value.title !== "string" ||
    (typeof value.workflowRevisionId !== "string" &&
      typeof value.contractRevisionId !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({
    title: value.title,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
  });
}

export async function resolveAgentThreadResultArtifact(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly workflowRunId?: string;
  readonly capabilityRunId?: string;
  readonly brandLogoKey?: string;
  readonly brand?: AgentContextSnapshotV1["brand"];
  readonly artifactId: string;
  readonly facts: AgentRuntimeRepository;
  readonly content: WorkspaceContentQueryStore;
  readonly now: Date;
}): Promise<AgentThreadResultArtifact> {
  if (
    [
      options.workflowRunId,
      options.capabilityRunId,
      options.brandLogoKey,
    ].filter((value) => value !== undefined).length !== 1
  ) {
    throw new AgentThreadResultError("agent.result_not_linked");
  }
  if (options.brandLogoKey !== undefined) {
    const logo = options.brand?.logos.find(
      (candidate) =>
        candidate.key === options.brandLogoKey &&
        candidate.artifactId === options.artifactId,
    );
    if (
      !logo?.assetId ||
      !options.authority.effectivePermissions.includes("brand.read")
    ) {
      throw new AgentThreadResultError("agent.result_not_linked");
    }
    const asset = await options.content.getAsset(
      options.authority,
      logo.assetId,
      { artifactId: options.artifactId },
    );
    const artifact = [asset.currentArtifact, ...asset.artifacts].find(
      (candidate) => candidate?.id === options.artifactId,
    );
    if (!artifact || artifact.availabilityStatus !== "available")
      throw new AgentThreadResultError("agent.result_unavailable");
    if (!artifact.mediaType || !imageMediaTypes.has(artifact.mediaType))
      throw new AgentThreadResultError("agent.result_not_image");
    return {
      id: artifact.id,
      mediaType: artifact.mediaType as AgentThreadResultArtifact["mediaType"],
      ...(artifact.displayFilename
        ? { displayFilename: artifact.displayFilename }
        : {}),
    };
  }
  const actions = await options.facts.listThreadActions(
    options.authority,
    options.threadId,
    40,
    options.now,
  );
  if (
    !actions.some(
      (action) =>
        (action.outcomeReference?.kind === "workflow_run" &&
          action.outcomeReference.workflowRunId === options.workflowRunId) ||
        (action.outcomeReference?.kind === "capability_run" &&
          action.outcomeReference.capabilityRunId === options.capabilityRunId),
    )
  ) {
    throw new AgentThreadResultError("agent.result_not_linked");
  }
  const artifacts = options.capabilityRunId
    ? await options.content.listCapabilityRunArtifacts(
        options.authority,
        options.capabilityRunId,
      )
    : await options.content.listWorkflowRunArtifacts(
        options.authority,
        options.workflowRunId!,
      );
  const artifact = artifacts.find(
    (candidate) => candidate.id === options.artifactId,
  );
  if (!artifact || artifact.availabilityStatus !== "available") {
    throw new AgentThreadResultError("agent.result_unavailable");
  }
  if (!artifact.mediaType || !imageMediaTypes.has(artifact.mediaType)) {
    throw new AgentThreadResultError("agent.result_not_image");
  }
  return Object.freeze({
    id: artifact.id,
    mediaType: artifact.mediaType as AgentThreadResultArtifact["mediaType"],
    ...(artifact.displayFilename
      ? { displayFilename: artifact.displayFilename }
      : {}),
  });
}

export async function findLatestAgentThreadResultArtifact(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly facts: AgentRuntimeRepository;
  readonly content: WorkspaceContentQueryStore;
  readonly now: Date;
}): Promise<AgentThreadResultArtifact> {
  const actions = await options.facts.listThreadActions(
    options.authority,
    options.threadId,
    40,
    options.now,
  );
  for (const action of actions.toReversed()) {
    if (action.outcomeReference?.kind !== "workflow_run") continue;
    const artifacts = await options.content.listWorkflowRunArtifacts(
      options.authority,
      action.outcomeReference.workflowRunId,
    );
    const artifact = artifacts
      .toReversed()
      .find(
        (candidate) =>
          candidate.availabilityStatus === "available" &&
          candidate.mediaType !== undefined &&
          imageMediaTypes.has(candidate.mediaType),
      );
    if (!artifact?.mediaType) continue;
    return Object.freeze({
      id: artifact.id,
      mediaType: artifact.mediaType as AgentThreadResultArtifact["mediaType"],
      ...(artifact.displayFilename
        ? { displayFilename: artifact.displayFilename }
        : {}),
    });
  }
  throw new AgentThreadResultError("agent.result_unavailable");
}

export function createAgentThreadWorkQueryExecutor(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly facts: AgentRuntimeRepository;
  readonly workflowRuns: WorkflowRunQueryRepository;
  readonly capabilityRuns?: Pick<CapabilityRunStore, "get">;
  readonly content: WorkspaceContentQueryStore;
  readonly includeArtifacts: boolean;
  readonly now: () => Date;
  readonly executeWithReceipt: (
    toolKey: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<ThreadWorkQueryToolExecution>,
    failureReason: (error: unknown) => string,
  ) => Promise<ThreadWorkQueryToolExecution>;
}): ThreadWorkQueryToolExecutors {
  return Object.freeze({
    inspect: (input: ThreadWorkQueryToolInput) =>
      options.executeWithReceipt(
        "thread.inspect-work",
        input,
        async () => {
          const actions = await options.facts.listThreadActions(
            options.authority,
            options.threadId,
            40,
            options.now(),
          );
          const candidates = actions.filter(
            (action) => proposal(action) !== undefined,
          );
          const tasks = await Promise.all(
            candidates.slice(-maximumTasks).map(async (action) => {
              const summary = proposal(action)!;
              if (action.outcomeReference?.kind === "capability_run") {
                const capabilityRunId = action.outcomeReference.capabilityRunId;
                const [run, artifacts] = await Promise.all([
                  options.capabilityRuns?.get(
                    options.authority,
                    capabilityRunId,
                    options.now(),
                  ),
                  options.includeArtifacts
                    ? options.content.listCapabilityRunArtifacts(
                        options.authority,
                        capabilityRunId,
                      )
                    : Promise.resolve([]),
                ]);
                return Object.freeze({
                  title: summary.title,
                  ...(summary.description
                    ? { description: summary.description }
                    : {}),
                  capabilityRunId,
                  ...(run?.error ? { error: run.error } : {}),
                  lifecycleStatus:
                    run?.lifecycleStatus ?? action.lifecycleStatus,
                  ...(artifacts.length > maximumArtifactsPerTask
                    ? { resultsTruncated: true, totalResults: artifacts.length }
                    : {}),
                  results: artifacts
                    .slice(0, maximumArtifactsPerTask)
                    .map((artifact) => ({
                      resourceId: artifact.id,
                      kind: artifact.mediaType?.startsWith("image/")
                        ? "image"
                        : "other",
                      ...(artifact.displayFilename
                        ? { title: artifact.displayFilename }
                        : {}),
                      state: artifact.availabilityStatus,
                    })),
                });
              }
              if (action.outcomeReference?.kind !== "workflow_run") {
                return Object.freeze({
                  title: summary.title,
                  ...(summary.description
                    ? { description: summary.description }
                    : {}),
                  lifecycleStatus: action.lifecycleStatus,
                  results: Object.freeze([]),
                });
              }
              const workflowRunId = action.outcomeReference.workflowRunId;
              const [run, artifacts] = await Promise.all([
                options.workflowRuns.findById(
                  options.authority.workspaceId,
                  workflowRunId,
                ),
                options.includeArtifacts
                  ? options.content.listWorkflowRunArtifacts(
                      options.authority,
                      workflowRunId,
                    )
                  : Promise.resolve([]),
              ]);
              return Object.freeze({
                title: summary.title,
                ...(summary.description
                  ? { description: summary.description }
                  : {}),
                workflowRunId,
                lifecycleStatus: run?.lifecycleStatus ?? action.lifecycleStatus,
                ...(artifacts.length > maximumArtifactsPerTask
                  ? { resultsTruncated: true, totalResults: artifacts.length }
                  : {}),
                results: Object.freeze(
                  artifacts.slice(0, maximumArtifactsPerTask).map((artifact) =>
                    Object.freeze({
                      resourceId: artifact.id,
                      kind: artifact.mediaType?.startsWith("image/")
                        ? "image"
                        : "other",
                      ...(artifact.displayFilename
                        ? { title: artifact.displayFilename }
                        : {}),
                      state:
                        artifact.availabilityStatus === "available"
                          ? "available"
                          : "unavailable",
                    }),
                  ),
                ),
              });
            }),
          );
          return Object.freeze({
            modelOutput: Object.freeze({
              tasks: Object.freeze(tasks),
              truncated:
                candidates.length > maximumTasks || actions.length === 40,
            }),
            outcomeReference: {
              kind: "query" as const,
              resultCount: tasks.length,
            },
          });
        },
        () => "agent.thread_query_failed",
      ),
  });
}
