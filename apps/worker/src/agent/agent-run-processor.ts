import { parseModelProfileDocumentV1 } from "@kanvas/application";
import { createAgentLibraryResourceExecutor } from "./library-resource-executor.js";
import type { AgentLibraryStore } from "@kanvas/database/runtime";
import type { StorageProfileRegistry } from "@kanvas/application";
import { selectAgentConversationMemory } from "./agent-conversation-memory.js";
import {
  agentBuiltinToolViewDigest,
  assertAgentQuestionResponse,
  createAgentToolReceiptCoordinator,
  brandDraftModelOutput,
  brandListModelOutput,
  createBrandCommandToolProjection,
  createBrandResourceToolProjection,
  createLibraryResourceToolProjection,
  createCanvasCommandToolProjection,
  createCapabilityCatalogToolProjection,
  createDynamicAgentToolView,
  createGovernedAgentModelPort,
  createAgentModelPreparationCoordinator,
  createKanvasMastraModel,
  createSkillCommandToolProjection,
  createThreadWorkQueryToolProjection,
  createWorkflowResourceToolProjection,
  mergeAgentToolFamilyProjections,
  observeKanvasThread,
  resumeAgentQuestionCheckpoint,
  resolveSkillResource,
  runKanvasSurfaceAgent,
  stableAgentRuntimeId,
  type AgentModelFailureClassification,
  type AgentModelCallObservation,
  type AgentModelTransport,
  type BrandCreateDraftToolInput,
  type BrandInspectDraftToolInput,
  type BrandPublishProposalToolInput,
  type BrandUpdateDraftToolInput,
  type KanvasAgentModelResponse,
  type KanvasAgentToolExecution,
  type WebSearchToolInput,
} from "@kanvas/agent-runtime";
import {
  agentVisibleMessageText,
  createWorkspaceBrand,
  type AgentVisibleMessagePartV1,
  type AgentActionReceiptRecord,
  type AgentFoundationRepository,
  type AgentInteractionRecord,
  type AgentModelCallPurpose,
  type AgentMessageRecord,
  type AgentRunDispatchRepository,
  type AgentRunWorkerClaim,
  type AgentRuntimeRepository,
  type AgentSkillCatalogItem,
  type AgentSurfaceView,
  type WorkflowRunQueryRepository,
  type WorkflowCatalogRepository,
  type WorkspaceBrandRepository,
} from "@kanvas/application";
import {
  digestProviderValue,
  type AgentModelBindingStore,
  type BudgetReservationStore,
  type CanvasDraftStore,
  type CapabilityRunStore,
  type CapabilityDefinitionAdminStore,
  type ResolvedAgentModelBinding,
  type WorkspaceContentQueryStore,
  type SkillLibraryStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";

import { createAgentModelBudgetPort } from "./agent-model-budget.js";
import type { createAgentSkillInstructionLoader } from "./agent-skill-instruction-loader.js";
import { createAgentCanvasCommandExecutors } from "./canvas-agent-command-executor.js";
import { effectiveAgentModelCapabilities } from "./effective-agent-model-capabilities.js";
import { createAgentCapabilityCatalogExecutor } from "./capability-catalog-executor.js";
import { createAgentBrandResourceExecutor } from "./brand-resource-executor.js";
import {
  AgentThreadResultError,
  createAgentThreadWorkQueryExecutor,
  resolveAgentThreadResultArtifact,
  type AgentThreadResultArtifact,
} from "./thread-agent-query-executor.js";
import { createAgentWorkflowResourceExecutor } from "./workflow-resource-executor.js";
import type { WorkerInputArtifactResolver } from "../storage/worker-input-artifact-resolver.js";

const assistantStreamFlushIntervalMs = 200;
const threadTitleMaximumCharacters = 32;
const threadTitleTimeoutMs = 20_000;

export function prepareAgentQuestionResume(
  messages: readonly AgentMessageRecord[],
  interactions: readonly AgentInteractionRecord[],
) {
  const resolvedInteractions = interactions.flatMap((interaction) => {
    const response = interaction.response;
    return response &&
      (interaction.lifecycleStatus === "submitted" ||
        interaction.lifecycleStatus === "skipped")
      ? [{ interaction, response }]
      : [];
  });
  const questionContinuations = resolvedInteractions.map(
    ({ interaction, response }) =>
      resumeAgentQuestionCheckpoint(
        interaction.checkpoint,
        assertAgentQuestionResponse(interaction.request, response),
      ),
  );
  const latest = questionContinuations.at(-1);
  const continuationMessages = new Map<string, unknown>();
  for (const item of questionContinuations) {
    for (const message of item.messages) {
      if (
        typeof message !== "object" ||
        message === null ||
        !("id" in message) ||
        typeof message.id !== "string"
      ) {
        throw new Error("Agent continuation message identity is unavailable.");
      }
      if (!continuationMessages.has(message.id))
        continuationMessages.set(message.id, message);
    }
  }
  const interactionMessageIds = new Set(
    resolvedInteractions.map(
      ({ interaction }) => interaction.assistantMessageId,
    ),
  );
  return Object.freeze({
    conversationMessages: Object.freeze(
      messages.filter((message) => !interactionMessageIds.has(message.id)),
    ),
    ...(latest
      ? {
          continuation: Object.freeze({
            messages: Object.freeze([...continuationMessages.values()]),
            previousToolCallCount: latest.previousToolCallCount,
            questionOutcome: latest.questionOutcome,
            answeredQuestions: Object.freeze(
              questionContinuations.flatMap((item) => item.answeredQuestions),
            ),
          }),
        }
      : {}),
  });
}

export function agentThreadTitleFromModelResponse(
  response: KanvasAgentModelResponse,
): string | undefined {
  if (response.finishReason !== "stop") return undefined;
  const firstLine = response.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .split(/[\r\n]/u)
    .map((line) => line.trim())
    .find(Boolean);
  const title = firstLine
    ?.replace(/^#+\s*/u, "")
    .replace(/^(?:标题|title)\s*[:：-]\s*/iu, "")
    .replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !title ||
    /^(?:好的|当然|以下|答案|根据|我会|我将|sure|here(?:'s| is))/iu.test(title)
  ) {
    return undefined;
  }
  return [...title].slice(0, threadTitleMaximumCharacters).join("");
}

export function shouldGenerateAgentThreadTitle(
  messages: readonly Pick<AgentMessageRecord, "sequenceNumber" | "message">[],
  parentRunId?: string,
): boolean {
  return (
    parentRunId === undefined &&
    messages.length === 1 &&
    messages[0]?.sequenceNumber === 1 &&
    messages[0].message.role === "user"
  );
}

export function agentWebSearchAnswer(
  response: KanvasAgentModelResponse,
): string {
  if (response.finishReason !== "stop") {
    throw Object.assign(new Error("Web search did not complete."), {
      code:
        response.finishReason === "length"
          ? "agent.output_limit_exceeded"
          : "agent.web_search_incomplete",
      effect: "not_started",
    });
  }
  const answer = response.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
  if (!answer) {
    throw Object.assign(new Error("Web search returned no answer."), {
      code: "agent.model_web_search_unsupported",
      effect: "not_started",
    });
  }
  return answer;
}

export function agentWebSearchQuery(
  input: unknown,
  fallbackQuery?: string,
): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("Web search input must be an object."), {
      code: "agent.web_search_invalid_input",
      effect: "not_started",
    });
  }
  const record = input as Readonly<Record<string, unknown>>;
  const query = record.query;
  if (
    query === undefined &&
    Object.keys(record).length === 0 &&
    fallbackQuery?.trim()
  ) {
    return [...fallbackQuery.trim()].slice(0, 500).join("");
  }
  if (
    typeof query !== "string" ||
    query.trim().length === 0 ||
    [...query.trim()].length > 500
  ) {
    throw Object.assign(new Error("Web search query is invalid."), {
      code: "agent.web_search_invalid_input",
      effect: "not_started",
    });
  }
  return query.trim();
}

async function selectedAgentInputFiles(
  resolver: WorkerInputArtifactResolver,
  claim: AgentRunWorkerClaim,
  signal: AbortSignal,
) {
  const artifactIds = claim.run.contextSnapshot.selectedArtifactIds ?? [];
  if (artifactIds.length === 0) return [];
  const access = resolver.bind({
    workspaceId: claim.authority.workspaceId,
    input: claim.run.contextSnapshot,
    signal,
  });
  return Promise.all(
    artifactIds.map(async (_artifactId, index) => {
      const artifact = await access.open({
        inputPointer: `/selectedArtifactIds/${String(index)}`,
      });
      // This input is persisted in the native transcript. Provider read URLs
      // expire, so materialize immutable content just as Skill image reads do.
      const chunks: Uint8Array[] = [];
      for await (const chunk of artifact.body) {
        signal.throwIfAborted();
        chunks.push(chunk);
      }
      const data = new Uint8Array(Buffer.concat(chunks));
      return Object.freeze({
        data,
        mediaType: artifact.mediaType,
        ...(artifact.displayFilename
          ? { filename: artifact.displayFilename }
          : {}),
      });
    }),
  );
}

class AgentActionReceiptCompletionError extends Error {
  public constructor(cause: unknown) {
    super("Agent Action receipt completion requires recovery.", { cause });
    this.name = "AgentActionReceiptCompletionError";
  }
}

export function classifyAgentModelFailure(
  error: unknown,
): AgentModelFailureClassification {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { status: "cancelled", stableReasonCode: "agent.cancelled" };
  }
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      break;
    }
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current as Readonly<Record<string, unknown>>;
    let code = "";
    if (typeof candidate.code === "string") {
      code = candidate.code;
    } else if (typeof candidate.stableErrorCode === "string") {
      code = candidate.stableErrorCode;
    }
    const effect = candidate.effect;
    if (/^agent\.[a-z0-9._-]+$/u.test(code)) {
      return {
        status: effect === "unknown" ? "unknown" : "failed",
        stableReasonCode: code,
      };
    }
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
      return {
        status: "failed",
        stableReasonCode: "agent.model_binding_preparation_conflict",
        retryableBeforeProviderRequest: true,
      };
    }
    if (code.startsWith("agent_model_binding.")) {
      return {
        status: "failed",
        stableReasonCode: "agent.model_binding_unavailable",
      };
    }
    if (code.startsWith("secret_version.")) {
      return {
        status: "failed",
        stableReasonCode: "agent.model_binding_credential_unavailable",
      };
    }
    if (code.startsWith("budget.")) {
      return {
        status: "failed",
        stableReasonCode: "agent.model_budget_failed",
      };
    }
    if (code.startsWith("s3_storage.")) {
      return {
        status: "failed",
        stableReasonCode: "agent.runtime_storage_unavailable",
      };
    }
    if (code.startsWith("provider.")) {
      return {
        status: effect === "unknown" ? "unknown" : "failed",
        stableReasonCode: `agent.model_${code.replaceAll(".", "_")}`,
      };
    }
    current = candidate.cause;
  }
  return { status: "failed", stableReasonCode: "agent.model_failed" };
}

function safeAgentErrorMetadata(
  error: unknown,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      break;
    }
    const record = current as Readonly<Record<string, unknown>>;
    const error = current as Error;
    const suffix = depth === 0 ? "" : `Cause${String(depth)}`;
    result[`error${suffix}Type`] =
      typeof error.name === "string" && error.name
        ? error.name.slice(0, 80)
        : "UnknownError";
    const code = record.code ?? record.stableErrorCode;
    if (typeof code === "string" && /^[a-z0-9._-]{1,120}$/iu.test(code)) {
      result[`error${suffix}Code`] = code;
    }
    const statusCode = record.statusCode;
    if (
      typeof statusCode === "number" &&
      Number.isSafeInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode <= 599
    ) {
      result[`error${suffix}StatusCode`] = statusCode;
    }
    if (record.effect === "not_started" || record.effect === "unknown") {
      result[`error${suffix}Effect`] = record.effect;
    }
    current = record.cause;
  }
  return Object.freeze(result);
}

function logAgentModelObservation(
  logger: Pick<Logger, "info" | "error">,
  claim: AgentRunWorkerClaim,
  observation: AgentModelCallObservation,
): void {
  const usage = observation.usage;
  const metadata = {
    event: `agent.model.${observation.event}`,
    observedAt: observation.observedAt.toISOString(),
    workspaceId: claim.authority.workspaceId,
    threadId: claim.run.threadId,
    agentRunId: observation.agentRunId,
    modelCallId: observation.modelCallId,
    callNumber: observation.callNumber,
    purpose: observation.purpose,
    modelProfileKey: observation.modelProfileKey,
    ...(observation.preparationDurationMs === undefined
      ? {}
      : { preparationDurationMs: observation.preparationDurationMs }),
    ...(observation.durationMs === undefined
      ? {}
      : { durationMs: observation.durationMs }),
    ...(observation.totalDurationMs === undefined
      ? {}
      : { totalDurationMs: observation.totalDurationMs }),
    ...(observation.finishReason
      ? { finishReason: observation.finishReason }
      : {}),
    ...(observation.providerRequestId
      ? { providerRequestId: observation.providerRequestId }
      : {}),
    ...(observation.resolvedModelId
      ? { resolvedModelId: observation.resolvedModelId }
      : {}),
    ...(usage?.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage?.inputTokensNoCache === undefined
      ? {}
      : { inputTokensNoCache: usage.inputTokensNoCache }),
    ...(usage?.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage?.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage?.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage?.outputTextTokens === undefined
      ? {}
      : { outputTextTokens: usage.outputTextTokens }),
    ...(usage?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
  };
  if (observation.event === "failed") {
    logger.error(
      {
        ...metadata,
        failureStatus: observation.failure?.status,
        terminalReasonCode: observation.failure?.stableReasonCode,
        ...safeAgentErrorMetadata(observation.error),
      },
      "Agent model call failed.",
    );
    return;
  }
  logger.info(metadata, `Agent model call ${observation.event}.`);
}

const skillCanvasImageMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function skillImageArtifactId(
  workspaceId: string,
  skillRevisionId: string,
  path: string,
): string {
  return stableAgentRuntimeId(
    "skill-image",
    `${workspaceId}:${skillRevisionId}:${path}`,
    1,
  );
}

export async function resolvePinnedSkillCanvasArtifact(options: {
  readonly authority: Parameters<
    SkillLibraryStore["materializeRunImage"]
  >[0]["authority"];
  readonly runId: string;
  readonly skills: readonly AgentSkillCatalogItem[];
  readonly assertSkillUsable?: AgentFoundationRepository["assertSkillUsable"];
  readonly materializeRunImage?: SkillLibraryStore["materializeRunImage"];
  readonly skillRevisionId: string;
  readonly skillResourcePath: string;
  readonly artifactId: string;
  readonly now: Date;
}): Promise<AgentThreadResultArtifact> {
  const skill = options.skills.find(
    (candidate) => candidate.skillRevisionId === options.skillRevisionId,
  );
  const resource = skill
    ? resolveSkillResource(skill, options.skillResourcePath)
    : undefined;
  if (
    !skill ||
    !resource ||
    resource.resourcePath !== options.skillResourcePath ||
    skillImageArtifactId(
      options.authority.workspaceId,
      options.skillRevisionId,
      options.skillResourcePath,
    ) !== options.artifactId
  ) {
    throw new AgentThreadResultError("agent.result_not_linked");
  }
  if (!skillCanvasImageMediaTypes.has(resource.mediaType)) {
    throw new AgentThreadResultError("agent.result_not_image");
  }
  if (!options.assertSkillUsable || !options.materializeRunImage) {
    throw new AgentThreadResultError("agent.result_unavailable");
  }
  try {
    await options.assertSkillUsable({
      authority: options.authority,
      skillRevisionId: options.skillRevisionId,
      now: options.now,
    });
    const materialized = await options.materializeRunImage({
      authority: options.authority,
      runId: options.runId,
      skillRevisionId: options.skillRevisionId,
      path: options.skillResourcePath,
      artifactId: options.artifactId,
      now: options.now,
    });
    if (materialized !== options.artifactId) {
      throw new AgentThreadResultError("agent.result_not_linked");
    }
  } catch (error) {
    if (error instanceof AgentThreadResultError) throw error;
    throw new AgentThreadResultError("agent.result_unavailable");
  }
  return Object.freeze({
    id: options.artifactId,
    mediaType: resource.mediaType as AgentThreadResultArtifact["mediaType"],
    displayFilename:
      options.skillResourcePath.split("/").at(-1) ?? "skill-image",
  });
}

function pinnedSurfaceView(
  claim: AgentRunWorkerClaim,
  current: AgentSurfaceView,
): AgentSurfaceView {
  const foundation = claim.run.foundationContext;
  if (
    current.profile.id !== foundation.profileRevisionId ||
    current.profile.canonicalDigest !== foundation.profileCanonicalDigest
  ) {
    throw Object.assign(
      new Error("Agent Run Profile no longer matches its pinned context."),
      { code: "agent.profile_context_changed", effect: "not_started" },
    );
  }
  const byId = new Map(
    current.skills.map((skill) => [skill.skillRevisionId, skill]),
  );
  const skills: AgentSkillCatalogItem[] = [];
  for (const pinned of foundation.skills) {
    const skill = byId.get(pinned.skillRevisionId);
    if (
      !skill ||
      skill.canonicalDigest !== pinned.canonicalDigest ||
      skill.instructionResource.contentDigest !==
        pinned.instructionResourceDigest ||
      pinned.entrypointWorkflowRevisionIds.some(
        (workflowRevisionId) =>
          !skill.entrypoints.some(
            (entrypoint) =>
              entrypoint.workflowRevisionId === workflowRevisionId,
          ),
      )
    ) {
      throw Object.assign(
        new Error("Agent Run Skill context was revoked or changed."),
        { code: "agent.skill_context_changed", effect: "not_started" },
      );
    }
    skills.push(skill);
  }
  return Object.freeze({
    profile: current.profile,
    skills: Object.freeze(skills),
    boundBrands: current.boundBrands,
    boundWorkflows: current.boundWorkflows,
    skillViewDigest: foundation.skillViewDigest,
  });
}

export interface AgentRunProcessorOptions {
  readonly workerId: string;
  readonly logger: Pick<Logger, "info" | "warn" | "error">;
  readonly dispatch: AgentRunDispatchRepository;
  readonly foundations: AgentFoundationRepository;
  readonly facts: AgentRuntimeRepository;
  readonly bindings: AgentModelBindingStore;
  readonly budgets: BudgetReservationStore;
  readonly canvasDrafts: CanvasDraftStore;
  readonly capabilities: CapabilityDefinitionAdminStore;
  readonly capabilityRuns?: CapabilityRunStore;
  readonly workflowCatalog: WorkflowCatalogRepository;
  readonly workflowRuns: WorkflowRunQueryRepository;
  readonly workspaceBrand?: WorkspaceBrandRepository;
  readonly agentLibraries?: AgentLibraryStore;
  readonly libraryStorageProfiles?: StorageProfileRegistry;
  readonly skillLibrary?: Pick<
    SkillLibraryStore,
    "listDrafts" | "materializeRunImage"
  >;
  readonly content: WorkspaceContentQueryStore;
  readonly inputArtifactResolver: WorkerInputArtifactResolver;
  readonly transport: AgentModelTransport<ResolvedAgentModelBinding>;
  readonly instructions: ReturnType<typeof createAgentSkillInstructionLoader>;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
}

export class AgentRunProcessor {
  readonly #now: () => Date;

  public constructor(private readonly options: AgentRunProcessorOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  public async processNext(): Promise<boolean> {
    const claimTokenDigest = digestProviderValue({
      workerId: this.options.workerId,
      nonce: this.options.nextId(),
    });
    const now = this.#now();
    const claim = await this.options.dispatch.claimNext({
      workerId: this.options.workerId,
      claimTokenDigest,
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseDurationMs),
      now,
    });
    if (!claim) return false;

    const claimedAt = this.#now();
    this.options.logger.info(
      {
        event: "agent.run.claimed",
        observedAt: claimedAt.toISOString(),
        workspaceId: claim.authority.workspaceId,
        threadId: claim.run.threadId,
        agentRunId: claim.run.id,
        workerId: claim.workerId,
        queueWaitMs: claimedAt.getTime() - claim.run.createdAt.getTime(),
        maximumModelCalls: claim.run.maximumModelCalls,
        maximumToolCalls: claim.run.maximumToolCalls,
        executionDeadlineAt: claim.run.executionDeadlineAt.toISOString(),
        reasoningLevel: claim.modelControls.reasoningLevel,
        webSearchMode: claim.modelControls.webSearchMode,
      },
      "Agent Run claimed.",
    );
    const abort = new AbortController();
    const auxiliaryTasks: Promise<void>[] = [];
    let heartbeatFailure: unknown;
    const heartbeat = setInterval(() => {
      void this.options.dispatch
        .heartbeat({
          workerId: claim.workerId,
          claimTokenDigest,
          agentRunId: claim.run.id,
          leaseExpiresAt: new Date(
            this.#now().getTime() + this.options.leaseDurationMs,
          ),
          now: this.#now(),
        })
        .catch((error: unknown) => {
          heartbeatFailure = error;
          abort.abort(error);
        });
    }, this.options.heartbeatIntervalMs);
    try {
      const lifecycleStatus = await this.#processClaim(
        claim,
        abort.signal,
        (task) => {
          auxiliaryTasks.push(task);
        },
      );
      if (lifecycleStatus === "waiting_for_user") clearInterval(heartbeat);
      await Promise.allSettled(auxiliaryTasks);
      if (heartbeatFailure && lifecycleStatus !== "waiting_for_user") {
        throw heartbeatFailure instanceof Error
          ? heartbeatFailure
          : new Error("Agent Run heartbeat failed.", {
              cause: heartbeatFailure,
            });
      }
      if (lifecycleStatus !== "waiting_for_user") {
        await this.options.dispatch.complete({
          workerId: claim.workerId,
          claimTokenDigest,
          agentRunId: claim.run.id,
          now: this.#now(),
        });
      }
      const completedAt = this.#now();
      this.options.logger.info(
        {
          event: "agent.run.completed",
          observedAt: completedAt.toISOString(),
          workspaceId: claim.authority.workspaceId,
          threadId: claim.run.threadId,
          agentRunId: claim.run.id,
          lifecycleStatus,
          durationMs: completedAt.getTime() - claimedAt.getTime(),
          totalDurationMs:
            completedAt.getTime() - claim.run.createdAt.getTime(),
        },
        "Agent Run completed.",
      );
      return true;
    } catch (error) {
      abort.abort(error);
      const failedAt = this.#now();
      const failure = classifyAgentModelFailure(error);
      this.options.logger.error(
        {
          event: "agent.run.failed",
          observedAt: failedAt.toISOString(),
          workspaceId: claim.authority.workspaceId,
          threadId: claim.run.threadId,
          agentRunId: claim.run.id,
          durationMs: failedAt.getTime() - claimedAt.getTime(),
          totalDurationMs: failedAt.getTime() - claim.run.createdAt.getTime(),
          failureStatus: failure.status,
          terminalReasonCode: failure.stableReasonCode,
          ...safeAgentErrorMetadata(error),
        },
        "Agent Run failed.",
      );
      if (error instanceof AgentActionReceiptCompletionError) throw error;
      const current = await this.options.facts.getRun(
        claim.authority,
        claim.run.id,
        this.#now(),
      );
      if (current?.lifecycleStatus === "running") {
        await this.options.facts.transitionRun({
          authority: claim.authority,
          runId: current.id,
          expectedVersion: current.version,
          toStatus: "failed",
          terminalReasonCode: failure.stableReasonCode,
          now: this.#now(),
        });
        await this.options.dispatch.complete({
          workerId: claim.workerId,
          claimTokenDigest,
          agentRunId: current.id,
          now: this.#now(),
        });
      }
      throw error;
    } finally {
      abort.abort();
      await Promise.allSettled(auxiliaryTasks);
      clearInterval(heartbeat);
    }
  }

  async #processClaim(
    claim: AgentRunWorkerClaim,
    signal: AbortSignal,
    registerAuxiliaryTask: (task: Promise<void>) => void,
  ): Promise<"waiting_approval" | "waiting_for_user" | "succeeded" | "failed"> {
    const currentView = await this.options.foundations.resolveSurfaceView({
      authority: claim.authority,
      surfaceKind: claim.run.contextSnapshot.surfaceKind,
      profileRevisionId: claim.run.foundationContext.profileRevisionId,
      skillRevisionIds: claim.run.foundationContext.skills.map(
        (skill) => skill.skillRevisionId,
      ),
      now: this.#now(),
    });
    if (!currentView) {
      throw Object.assign(new Error("Agent Surface Profile is unavailable."), {
        code: "agent.surface_profile_unavailable",
        effect: "not_started",
      });
    }
    const view = pinnedSurfaceView(claim, currentView);
    const assistantMessageId = stableAgentRuntimeId(
      "assistant-message",
      claim.run.id,
      1,
    );
    let streamedText = "";
    let completedStepText = "";
    let activeModelCallId: string | undefined;
    let activeModelAttemptId: string | undefined;
    let currentStepText = "";
    let streamedReasoning = "";
    let streamedToolCalls: readonly Extract<
      AgentVisibleMessagePartV1,
      { type: "tool-call" }
    >[] = [];
    let streamedSources: readonly {
      readonly id: string;
      readonly url: string;
      readonly title?: string;
    }[] = [];
    let persistedMessageDigest = "";
    let streamWrite: Promise<void> | undefined;
    let streamWriteFailure: unknown;
    let firstOutputPersisted = false;
    let immediateStreamFlushRequested = false;
    let executionNumber = 0;
    const visibleAssistantMessage = (text = streamedText) => {
      const parts = Object.freeze([
        ...(streamedReasoning.trim()
          ? [{ type: "reasoning" as const, text: streamedReasoning }]
          : []),
        ...streamedToolCalls,
        ...(text.trim() ? [{ type: "text" as const, text }] : []),
        ...streamedSources.map((source) => ({
          type: "source" as const,
          sourceType: "url" as const,
          id: source.id,
          url: source.url,
          ...(source.title ? { title: source.title } : {}),
        })),
      ]);
      return {
        schemaVersion: 1 as const,
        role: "assistant" as const,
        parts,
      };
    };
    const flushStreamedMessage = async (): Promise<void> => {
      if (streamWrite) return streamWrite;
      const message = visibleAssistantMessage();
      if (message.parts.length === 0) return;
      const messageDigest = digestProviderValue(message);
      if (messageDigest === persistedMessageDigest) return;
      streamWrite = this.options.facts
        .appendAssistantMessage({
          workerClaim: {
            workerId: claim.workerId,
            claimTokenDigest: claim.claimTokenDigest,
          },
          authority: claim.authority,
          agentRunId: claim.run.id,
          messageId: assistantMessageId,
          message,
          now: this.#now(),
        })
        .then(() => {
          persistedMessageDigest = messageDigest;
          if (!firstOutputPersisted) {
            firstOutputPersisted = true;
            const persistedAt = this.#now();
            this.options.logger.info(
              {
                event: "agent.run.first_output_persisted",
                observedAt: persistedAt.toISOString(),
                workspaceId: claim.authority.workspaceId,
                threadId: claim.run.threadId,
                agentRunId: claim.run.id,
                totalDurationMs:
                  persistedAt.getTime() - claim.run.createdAt.getTime(),
                textCharacters: streamedText.length,
                reasoningCharacters: streamedReasoning.length,
                toolCallCount: streamedToolCalls.length,
                sourceCount: streamedSources.length,
              },
              "Agent Run first output persisted.",
            );
          }
        })
        .finally(() => {
          streamWrite = undefined;
        });
      return streamWrite;
    };
    const flushFirstStreamOutput = (): void => {
      if (persistedMessageDigest || immediateStreamFlushRequested) return;
      immediateStreamFlushRequested = true;
      void flushStreamedMessage()
        .catch((error: unknown) => {
          streamWriteFailure = error;
        })
        .finally(() => {
          immediateStreamFlushRequested = false;
        });
    };
    const modelCallUsage = await this.options.facts.getRunModelCallUsage(
      claim.authority,
      claim.run.id,
      this.#now(),
    );
    let governedCallNumber = modelCallUsage.maximumCallNumber;
    const modelPreparation = createAgentModelPreparationCoordinator();
    const createModelPort = (
      bindingKey: string,
      purpose: AgentModelCallPurpose,
      streamToAssistant: boolean,
    ) =>
      createGovernedAgentModelPort({
        workerClaim: {
          workerId: claim.workerId,
          claimTokenDigest: claim.claimTokenDigest,
        },
        authority: claim.authority,
        agentRunId: claim.run.id,
        modelProfileKey: bindingKey,
        purpose,
        facts: this.options.facts,
        routes: {
          resolve: ({ agentRunId, now }) =>
            this.options.bindings
              .resolve({
                authority: claim.authority,
                agentRunId,
                bindingKey,
                purpose,
                workerClaim: {
                  workerId: claim.workerId,
                  claimTokenDigest: claim.claimTokenDigest,
                },
                now,
              })
              .then((binding) => ({
                snapshot: binding.snapshot,
                value: binding,
              })),
        },
        transport: this.options.transport,
        budget: createAgentModelBudgetPort({
          workerClaim: {
            workerId: claim.workerId,
            claimTokenDigest: claim.claimTokenDigest,
          },
          authority: claim.authority,
          budgets: this.options.budgets,
          identities: {
            reservationId: (modelCallId) =>
              stableAgentRuntimeId("budget-reservation", modelCallId, 1),
            reserveLedgerEntryId: (modelCallId) =>
              stableAgentRuntimeId("budget-reserve-ledger", modelCallId, 1),
            settleLedgerEntryId: (modelCallId) =>
              stableAgentRuntimeId("budget-settle-ledger", modelCallId, 1),
            auditEventId: (modelCallId, phase) =>
              stableAgentRuntimeId(`budget-audit-${phase}`, modelCallId, 1),
          },
          digest: digestProviderValue,
        }),
        identities: {
          modelCallId: (callNumber) =>
            stableAgentRuntimeId("model-call", claim.run.id, callNumber),
          modelAttemptId: (callNumber, attemptNumber) =>
            stableAgentRuntimeId(
              `model-attempt-${String(callNumber)}`,
              claim.run.id,
              attemptNumber,
            ),
        },
        // Thread naming is an independent side effect. It shares the Run only
        // as an audit and billing envelope, never its preparation queue.
        ...(purpose === "thread_title"
          ? {}
          : { preparation: modelPreparation }),
        nextCallNumber: () => {
          governedCallNumber += 1;
          return governedCallNumber;
        },
        digest: digestProviderValue,
        classifyFailure: classifyAgentModelFailure,
        now: this.#now,
        onObservation: (observation) =>
          logAgentModelObservation(this.options.logger, claim, observation),
        onStreamPart: (part, identity) => {
          if (!streamToAssistant) return;
          if (activeModelCallId !== identity.modelCallId) {
            completedStepText = streamedText;
            currentStepText = "";
            activeModelCallId = identity.modelCallId;
          }
          if (activeModelAttemptId !== identity.attemptId) {
            currentStepText = "";
            activeModelAttemptId = identity.attemptId;
          }
          if (part.type === "text-delta") {
            currentStepText += part.delta;
            streamedText = [completedStepText, currentStepText]
              .filter(Boolean)
              .join("\n\n");
          } else if (part.type === "reasoning-delta") {
            streamedReasoning += part.delta;
          } else if (
            part.type === "source" &&
            part.sourceType === "url" &&
            !streamedSources.some((source) => source.url === part.url)
          ) {
            streamedSources = [
              ...streamedSources,
              {
                id: part.id,
                url: part.url,
                ...(part.title ? { title: part.title } : {}),
              },
            ].slice(0, 20);
          } else if (
            part.type === "tool-call" &&
            !part.providerExecuted &&
            part.toolName.trim().length > 0 &&
            part.toolName !== "skill"
          ) {
            streamedToolCalls = [
              ...streamedToolCalls,
              {
                type: "tool-call" as const,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              },
            ].slice(0, 32);
          }
          if (visibleAssistantMessage().parts.length > 0) {
            flushFirstStreamOutput();
          }
        },
      });
    const messages = await this.options.facts.listRunMessages(
      claim.authority,
      claim.run.id,
      "all",
      this.#now(),
    );
    const interactions = await this.options.facts.listRunInteractions(
      claim.authority,
      claim.run.id,
      this.#now(),
    );
    const pendingInteraction = interactions.find(
      (interaction) => interaction.lifecycleStatus === "pending",
    );
    if (pendingInteraction) {
      throw Object.assign(
        new Error("Agent Run was dispatched with a pending interaction."),
        { code: "agent.interaction_state_conflict", effect: "not_started" },
      );
    }
    const questionResume = prepareAgentQuestionResume(messages, interactions);
    const continuation = questionResume.continuation;
    const conversationMessages = questionResume.conversationMessages;
    const remainingModelCalls =
      claim.run.maximumModelCalls - modelCallUsage.mainCallCount;
    const remainingToolCalls =
      claim.run.maximumToolCalls - (continuation?.previousToolCallCount ?? 0);
    if (remainingModelCalls < 1 || remainingToolCalls < 0) {
      throw Object.assign(new Error("Agent Run limits were exhausted."), {
        code: "agent.limit_exceeded",
        effect: "not_started",
      });
    }
    const existingActions = await this.options.facts.listRunActions(
      claim.authority,
      claim.run.id,
      this.#now(),
    );
    const maximumActionNumber = existingActions.reduce(
      (maximum, action) => Math.max(maximum, action.actionNumber),
      0,
    );
    executionNumber = maximumActionNumber;
    const storedMemory = await this.options.facts.getThreadMemory(
      claim.authority,
      claim.run.threadId,
      this.#now(),
    );
    const memoryContext = selectAgentConversationMemory(
      conversationMessages,
      storedMemory,
    );
    const existingMemory = memoryContext.memory;
    const threadObservations = existingMemory?.activeObservations;
    let threadTitleWorkStarted = false;
    const startThreadTitleWork = () => {
      if (threadTitleWorkStarted) return;
      threadTitleWorkStarted = true;
      if (
        modelCallUsage.threadTitleCallCount === 0 &&
        shouldGenerateAgentThreadTitle(messages, claim.run.parentRunId)
      ) {
        const titleMessage = messages[0]!;
        const titlePort = createModelPort(
          claim.fastModelBindingKey,
          "thread_title",
          false,
        );
        const titleSignal = AbortSignal.timeout(threadTitleTimeoutMs);
        // Fire and contain: title latency or failure must never delay, cancel,
        // or change the lifecycle of the user's Run.
        void titlePort
          .generate(
            {
              schemaVersion: "kanvas.agent-model-request/v1",
              controls: { reasoningLevel: "off", webSearchMode: "off" },
              prompt: [
                {
                  role: "system",
                  content:
                    "You are exclusively a thread title generator. Never answer the user's request. Output exactly one concise plain-text title in the user's language, with no quotes, label, markdown, explanation, or punctuation at the end.",
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: agentVisibleMessageText(titleMessage.message),
                    },
                  ],
                },
              ],
              tools: [],
            },
            titleSignal,
          )
          .then((response) => {
            const title = agentThreadTitleFromModelResponse(response);
            return title
              ? this.options.facts.autoRenameThread({
                  authority: claim.authority,
                  threadId: claim.run.threadId,
                  title,
                  now: this.#now(),
                })
              : undefined;
          })
          .catch((error: unknown) => {
            this.options.logger.warn(
              {
                event: "agent.auxiliary.failed",
                operation: "thread_title",
                workspaceId: claim.authority.workspaceId,
                threadId: claim.run.threadId,
                agentRunId: claim.run.id,
                ...safeAgentErrorMetadata(error),
              },
              "Agent auxiliary operation failed.",
            );
          })
          .then(() => undefined);
      }
    };
    // Naming starts from the persisted first message, before the conversational
    // model loop. It is not contingent on that loop producing output.
    startThreadTitleWork();
    let memoryWorkStarted = false;
    const startDeferredMemoryWork = () => {
      if (memoryWorkStarted) return;
      memoryWorkStarted = true;
      const observationContext = selectAgentConversationMemory(
        messages.slice(0, -1),
        existingMemory,
      );
      const observationMemory = observationContext.memory;
      const memoryModel = createKanvasMastraModel({
        modelProfileKey: claim.fastModelBindingKey,
        port: createModelPort(
          claim.fastModelBindingKey,
          "memory_observation",
          false,
        ),
        controls: {
          reasoningLevel: "low",
          webSearchMode: "off",
        },
      });
      registerAuxiliaryTask(
        observeKanvasThread({
          model: memoryModel,
          abortSignal: signal,
          threadId: claim.run.threadId,
          resourceId: claim.authority.workspaceId,
          messages: observationContext.messages.map((message) => ({
            id: message.id,
            role: message.message.role,
            ...(message.modelMessages
              ? { modelMessages: message.modelMessages }
              : {}),
            text: agentVisibleMessageText(message.message),
            createdAt: message.createdAt,
          })),
          ...(observationMemory
            ? {
                existing: {
                  activeObservations: observationMemory.activeObservations,
                  lastObservedAt: observationMemory.lastObservedAt,
                },
              }
            : {}),
        })
          .then(async (observed) => {
            if (
              observed.activeObservations &&
              observed.lastObservedAt &&
              (observed.observed || observed.reflected)
            ) {
              const observedAt = observed.lastObservedAt.getTime();
              const sourceMessage = messages
                .slice(0, -1)
                .findLast(
                  (message) => message.createdAt.getTime() <= observedAt,
                );
              await this.options.facts.saveThreadMemory({
                agentRunId: claim.run.id,
                workerClaim: {
                  workerId: claim.workerId,
                  claimTokenDigest: claim.claimTokenDigest,
                },
                authority: claim.authority,
                threadId: claim.run.threadId,
                activeObservations: observed.activeObservations,
                observationsDigest: digestProviderValue(
                  observed.activeObservations,
                ),
                lastObservedAt: observed.lastObservedAt,
                ...(sourceMessage ? { sourceMessageId: sourceMessage.id } : {}),
                observerModelBindingKey: claim.fastModelBindingKey,
                now: this.#now(),
              });
            }
          })
          .catch((error: unknown) => {
            this.options.logger.warn(
              {
                event: "agent.auxiliary.failed",
                operation: "memory_observation",
                workspaceId: claim.authority.workspaceId,
                threadId: claim.run.threadId,
                agentRunId: claim.run.id,
                ...safeAgentErrorMetadata(error),
              },
              "Agent auxiliary operation failed.",
            );
          }),
      );
    };
    if (!messages.some((message) => message.message.role === "user")) {
      throw new Error("Agent Run has no user message.");
    }
    const inputFiles = await selectedAgentInputFiles(
      this.options.inputArtifactResolver,
      claim,
      signal,
    );
    const candidateSearchBindingKeys = [
      claim.modelBindingKey,
      claim.fastModelBindingKey,
    ].filter(
      (bindingKey, index, values) => values.indexOf(bindingKey) === index,
    );
    const searchBindingKey =
      claim.modelControls.webSearchMode === "off"
        ? undefined
        : (
            await Promise.all(
              candidateSearchBindingKeys.map(async (bindingKey) => {
                try {
                  const binding = await this.options.bindings.resolve({
                    authority: claim.authority,
                    agentRunId: claim.run.id,
                    bindingKey,
                    now: this.#now(),
                  });
                  return effectiveAgentModelCapabilities(binding).webSearch ===
                    "native" &&
                    binding.protocolKind !== "gemini_generate_content"
                    ? bindingKey
                    : undefined;
                } catch {
                  return undefined;
                }
              }),
            )
          ).find((bindingKey) => bindingKey !== undefined);
    const model = createKanvasMastraModel({
      modelProfileKey: claim.modelBindingKey,
      port: createModelPort(claim.modelBindingKey, "plan", true),
      controls: claim.modelControls,
      webSearchToolAvailable: searchBindingKey !== undefined,
    });

    let webSearchFailure: unknown;
    const receiptCoordinator: {
      current?: ReturnType<typeof createAgentToolReceiptCoordinator>;
    } = {};
    const executeWithReceipt = async (
      toolKey: string,
      input: unknown,
      operation: (
        action: AgentActionReceiptRecord,
      ) => Promise<KanvasAgentToolExecution>,
      failureReason: (error: unknown) => string,
    ): Promise<KanvasAgentToolExecution> => {
      executionNumber += 1;
      const toolCallId = `agent-tool:${String(executionNumber)}:${digestProviderValue(input).slice(7, 23)}`;
      const coordinator = receiptCoordinator.current;
      if (!coordinator) {
        throw new Error("Agent Tool receipt coordinator is unavailable.");
      }
      let running = await coordinator.inputAvailable({
        toolCallId,
        toolKey,
        input,
      });
      let output: KanvasAgentToolExecution;
      try {
        output = await operation(running);
      } catch (error) {
        if (toolKey === "canvas.export-png")
          running =
            (await this.options.facts.getAction(
              claim.authority,
              running.id,
              this.#now(),
            )) ?? running;
        if (running.lifecycleStatus !== "succeeded") {
          await coordinator.fail({
            actionReceiptId: running.id,
            expectedVersion: running.version,
            status: "failed",
            terminalReasonCode: failureReason(error),
          });
        }
        throw error;
      }
      if (toolKey === "canvas.export-png")
        running =
          (await this.options.facts.getAction(
            claim.authority,
            running.id,
            this.#now(),
          )) ?? running;
      if (running.lifecycleStatus === "succeeded") return output;
      const complete = () =>
        coordinator.complete({
          actionReceiptId: running.id,
          expectedVersion: running.version,
          output: output.modelOutput,
          ...(output.outcomeReference
            ? { outcomeReference: output.outcomeReference }
            : {}),
        });
      try {
        await complete();
      } catch {
        try {
          await complete();
        } catch (error) {
          throw new AgentActionReceiptCompletionError(error);
        }
      }
      return output;
    };
    const skillLibrary = this.options.skillLibrary;
    const canvasProjection = createCanvasCommandToolProjection(
      createAgentCanvasCommandExecutors({
        authority: claim.authority,
        context: claim.run.contextSnapshot,
        canvasDrafts: this.options.canvasDrafts,
        nextId: this.options.nextId,
        now: this.#now,
        ...(claim.run.contextSnapshot.browserCanvasExport
          ? {
              exportCanvas: async (request, action) => {
                await this.options.facts.recordCanvasExport({
                  authority: claim.authority,
                  agentRunId: claim.run.id,
                  actionReceiptId: action.id,
                  expectedVersion: action.version,
                  request,
                  now: this.#now(),
                });
                const deadline = Math.min(
                  claim.run.executionDeadlineAt.getTime(),
                  Date.now() + 120_000,
                );
                while (Date.now() < deadline) {
                  signal.throwIfAborted();
                  const receipt = await this.options.facts.getAction(
                    claim.authority,
                    action.id,
                    this.#now(),
                  );
                  const completion = receipt?.proposalDocument?.completion;
                  if (
                    completion &&
                    typeof completion === "object" &&
                    !Array.isArray(completion)
                  ) {
                    const value = completion as Record<string, unknown>;
                    if (
                      value.status === "succeeded" &&
                      typeof value.artifactId === "string"
                    )
                      return {
                        modelOutput: {
                          status: "succeeded",
                          artifactId: value.artifactId,
                          filename: value.filename,
                          canvasDraftId: request.canvasDraftId,
                          documentVersion: request.documentVersion,
                        },
                        outcomeReference: { kind: "query", resultCount: 1 },
                      };
                    if (value.status === "failed")
                      throw Object.assign(new Error(String(value.message)), {
                        code: "agent.canvas_export_failed",
                        details: value,
                      });
                  }
                  await new Promise((resolve) => setTimeout(resolve, 750));
                }
                throw Object.assign(
                  new Error(
                    "No committed export was received from the browser before the deadline.",
                  ),
                  { code: "agent.canvas_export_timeout" },
                );
              },
            }
          : {}),
        resolveResultArtifact: async (source) => {
          if (source.libraryId || source.libraryEntryId) {
            if (
              !claim.run.contextSnapshot.libraryTools ||
              !source.libraryId ||
              !source.libraryEntryId ||
              !this.options.agentLibraries
            )
              throw new AgentThreadResultError("agent.result_not_linked");
            const reference = await this.options.agentLibraries.reference({
              authority: claim.authority,
              runId: claim.run.id,
              libraryId: source.libraryId,
              entryId: source.libraryEntryId,
              now: this.#now(),
            });
            if (reference.artifactId !== source.artifactId)
              throw new AgentThreadResultError("agent.result_not_linked");
            if (
              reference.mediaType !== "image/png" &&
              reference.mediaType !== "image/jpeg" &&
              reference.mediaType !== "image/webp"
            )
              throw new AgentThreadResultError("agent.result_not_image");
            return {
              id: reference.artifactId,
              mediaType: reference.mediaType,
              displayFilename: reference.name,
            };
          }

          if (source.skillRevisionId || source.skillResourcePath) {
            if (!source.skillRevisionId || !source.skillResourcePath) {
              return Promise.reject(
                new AgentThreadResultError("agent.result_not_linked"),
              );
            }
            return resolvePinnedSkillCanvasArtifact({
              authority: claim.authority,
              runId: claim.run.id,
              skills: view.skills,
              assertSkillUsable: (input) =>
                this.options.foundations.assertSkillUsable(input),
              ...(skillLibrary
                ? {
                    materializeRunImage: (input) =>
                      skillLibrary.materializeRunImage(input),
                  }
                : {}),
              skillRevisionId: source.skillRevisionId,
              skillResourcePath: source.skillResourcePath,
              artifactId: source.artifactId,
              now: this.#now(),
            });
          }
          return resolveAgentThreadResultArtifact({
            authority: claim.authority,
            threadId: claim.run.threadId,
            ...(source.workflowRunId
              ? { workflowRunId: source.workflowRunId }
              : {}),
            ...(source.capabilityRunId
              ? { capabilityRunId: source.capabilityRunId }
              : {}),
            ...(source.brandLogoKey
              ? { brandLogoKey: source.brandLogoKey }
              : {}),
            artifactId: source.artifactId,
            ...(claim.run.contextSnapshot.brand
              ? { brand: claim.run.contextSnapshot.brand }
              : {}),
            facts: this.options.facts,
            content: this.options.content,
            now: this.#now(),
          });
        },
        executeWithReceipt,
      }),
      { includeLibraryInputs: claim.run.contextSnapshot.libraryTools === true },
    );
    const canInspectThreadWork =
      claim.authority.effectivePermissions.includes("workflow.read");
    const baseQueryProjection =
      view.profile.manifest.allowedToolFamilies.includes("query")
        ? createThreadWorkQueryToolProjection(
            {
              ...(canInspectThreadWork
                ? createAgentThreadWorkQueryExecutor({
                    authority: claim.authority,
                    threadId: claim.run.threadId,
                    facts: this.options.facts,
                    workflowRuns: this.options.workflowRuns,
                    ...(this.options.capabilityRuns
                      ? { capabilityRuns: this.options.capabilityRuns }
                      : {}),
                    content: this.options.content,
                    includeArtifacts:
                      claim.authority.effectivePermissions.includes(
                        "asset.read",
                      ),
                    now: this.#now,
                    executeWithReceipt,
                  })
                : {}),
              search: async (input: WebSearchToolInput) => {
                const triggerMessage = messages.find(
                  (message) => message.id === claim.run.triggerMessageId,
                );
                const query = agentWebSearchQuery(
                  input,
                  triggerMessage
                    ? agentVisibleMessageText(triggerMessage.message)
                    : undefined,
                );
                if (!searchBindingKey) {
                  throw Object.assign(
                    new Error("Web search is unavailable for this Agent Run."),
                    {
                      code: "agent.model_web_search_unsupported",
                      effect: "not_started",
                    },
                  );
                }
                return executeWithReceipt(
                  "web_search",
                  input,
                  async () => {
                    const response = await createModelPort(
                      searchBindingKey,
                      "web_search",
                      false,
                    ).generate(
                      {
                        schemaVersion: "kanvas.agent-model-request/v1",
                        controls: {
                          reasoningLevel: "off",
                          webSearchMode: "required",
                        },
                        prompt: [
                          {
                            role: "system",
                            content:
                              "Search the public web for the user's query. Return a concise factual answer grounded in the search results. Do not perform unrelated tasks.",
                          },
                          {
                            role: "user",
                            content: [{ type: "text", text: query }],
                          },
                        ],
                        tools: [],
                      },
                      signal,
                    );
                    const answer = agentWebSearchAnswer(response);
                    const sources = (response.sources ?? [])
                      .filter((source) => source.url.startsWith("https://"))
                      .slice(0, 20);
                    for (const source of sources) {
                      if (
                        !streamedSources.some(
                          (candidate) => candidate.url === source.url,
                        )
                      ) {
                        streamedSources = [
                          ...streamedSources,
                          {
                            id: `web-search-${digestProviderValue(
                              source.url,
                            ).slice(7, 23)}`,
                            url: source.url,
                            ...(source.title ? { title: source.title } : {}),
                          },
                        ].slice(0, 20);
                      }
                    }
                    return Object.freeze({
                      modelOutput: Object.freeze({
                        answer,
                        sources: Object.freeze(sources),
                      }),
                      outcomeReference: {
                        kind: "query" as const,
                        resultCount: sources.length,
                      },
                    });
                  },
                  () => "agent.web_search_failed",
                ).catch((error: unknown) => {
                  webSearchFailure = error;
                  throw error;
                });
              },
            },
            {
              includeArtifacts:
                canInspectThreadWork &&
                claim.authority.effectivePermissions.includes("asset.read"),
            },
          )
        : undefined;
    const libraryProjection =
      claim.run.contextSnapshot.libraryTools &&
      this.options.agentLibraries &&
      this.options.libraryStorageProfiles &&
      claim.authority.effectivePermissions.includes("library.read")
        ? createLibraryResourceToolProjection(
            createAgentLibraryResourceExecutor({
              authority: claim.authority,
              runId: claim.run.id,
              libraries: this.options.agentLibraries,
              profiles: this.options.libraryStorageProfiles,
              canReadImages: async () => {
                const binding = await this.options.bindings.resolve({
                  authority: claim.authority,
                  agentRunId: claim.run.id,
                  bindingKey: claim.modelBindingKey,
                  now: this.#now(),
                });
                return parseModelProfileDocumentV1(
                  binding.modelProfile,
                ).model.inputModalities.includes("image");
              },
              signal,
              now: this.#now,
              executeWithReceipt,
            }),
          )
        : undefined;
    const queryProjection =
      baseQueryProjection && libraryProjection
        ? mergeAgentToolFamilyProjections([
            baseQueryProjection,
            libraryProjection,
          ])
        : baseQueryProjection;
    const latestUserText = agentVisibleMessageText(
      messages.toReversed().find((message) => message.message.role === "user")!
        .message,
    );
    const capabilityLocale = /\p{Script=Han}/u.test(latestUserText)
      ? ("zh-CN" as const)
      : ("en-US" as const);
    const capabilityProjection =
      view.profile.manifest.allowedToolFamilies.includes("capability") &&
      claim.authority.effectivePermissions.includes("capability.run")
        ? createCapabilityCatalogToolProjection(
            createAgentCapabilityCatalogExecutor({
              authority: claim.authority,
              catalog: this.options.capabilities,
              locale: capabilityLocale,
              now: this.#now,
              executeWithReceipt,
              prepareInvoke: async ({
                capabilityKey,
                contractRevisionId,
                title,
                description,
                input,
              }) => {
                executionNumber += 1;
                const toolInput = Object.freeze({ capabilityKey, input });
                const toolCallId = `agent-tool:${String(executionNumber)}:${digestProviderValue(toolInput).slice(7, 23)}`;
                const coordinator = receiptCoordinator.current;
                if (!coordinator) {
                  throw new Error(
                    "Agent Tool receipt coordinator is unavailable.",
                  );
                }
                const running = await coordinator.inputAvailable({
                  toolCallId,
                  toolKey: "capability.invoke",
                  input: toolInput,
                });
                const proposal = Object.freeze({
                  schemaVersion: 1,
                  actionRef: `capability:${capabilityKey}`,
                  contractRevisionId,
                  title,
                  description,
                  input,
                });
                await coordinator.preview({
                  actionReceiptId: running.id,
                  expectedVersion: running.version,
                  proposalDocument: proposal,
                });
                return Object.freeze({
                  modelOutput: Object.freeze({
                    status: "awaiting_approval",
                    capabilityKey,
                    title,
                  }),
                });
              },
            }),
          )
        : undefined;
    const skillCommandProjection =
      view.profile.manifest.allowedToolFamilies.includes("skill_command") &&
      claim.authority.effectivePermissions.includes("skill.manage")
        ? createSkillCommandToolProjection({
            listDrafts: () =>
              executeWithReceipt(
                "skill.list-drafts",
                {},
                async () => ({
                  modelOutput: {
                    items: (
                      (await this.options.skillLibrary?.listDrafts(
                        claim.authority,
                        this.#now(),
                      )) ?? []
                    ).map((draft) => ({
                      draftId: draft.id,
                      name: draft.displayName,
                      summary: draft.summary,
                      draftVersion: draft.draftVersion,
                    })),
                  },
                }),
                () => "agent.skill_draft_list_failed",
              ),
            proposeFiles: async (input) => {
              executionNumber += 1;
              const coordinator = receiptCoordinator.current;
              if (!coordinator)
                throw new Error(
                  "Agent Tool receipt coordinator is unavailable.",
                );
              const running = await coordinator.inputAvailable({
                toolCallId: `agent-tool:${executionNumber}:${digestProviderValue(input).slice(7, 23)}`,
                toolKey: "skill.propose-files",
                input,
              });
              await coordinator.preview({
                actionReceiptId: running.id,
                expectedVersion: running.version,
                proposalDocument: {
                  schemaVersion: 1,
                  actionRef: "skill-draft-files",
                  presentation: {
                    kind: "skill_images_update",
                    imageCount: input.files.length,
                  },
                  input,
                },
              });
              return { modelOutput: { status: "awaiting_approval" } };
            },
            proposeCreate: async (input) => {
              executionNumber += 1;
              const toolCallId = `agent-tool:${String(executionNumber)}:${digestProviderValue(input).slice(7, 23)}`;
              const coordinator = receiptCoordinator.current;
              if (!coordinator) {
                throw new Error(
                  "Agent Tool receipt coordinator is unavailable.",
                );
              }
              const running = await coordinator.inputAvailable({
                toolCallId,
                toolKey: "skill.propose-create",
                input,
              });
              await coordinator.preview({
                actionReceiptId: running.id,
                expectedVersion: running.version,
                proposalDocument: Object.freeze({
                  schemaVersion: 1,
                  actionRef: "skill-draft-create",
                  presentation: Object.freeze({
                    kind: "skill_create",
                    resourceName: input.displayName,
                    imageCount: input.files?.length ?? 0,
                  }),
                  input,
                }),
              });
              return Object.freeze({
                modelOutput: Object.freeze({
                  status: "awaiting_approval",
                  title: input.displayName,
                }),
              });
            },
          })
        : undefined;
    const brandService = this.options.workspaceBrand
      ? createWorkspaceBrand({
          repository: this.options.workspaceBrand,
          nextId: this.options.nextId,
          now: this.#now,
        })
      : undefined;
    const brandResourceProjection =
      this.options.workspaceBrand &&
      view.profile.manifest.allowedToolFamilies.includes("brand_command") &&
      claim.authority.effectivePermissions.includes("brand.read")
        ? createBrandResourceToolProjection(
            createAgentBrandResourceExecutor({
              authority: claim.authority,
              brands: this.options.workspaceBrand,
              boundBrandKitIds: new Set(
                view.boundBrands.map((brand) => brand.brandKitId),
              ),
              ...(claim.run.contextSnapshot.brand?.revisionId
                ? {
                    selectedBrandRevisionId:
                      claim.run.contextSnapshot.brand.revisionId,
                  }
                : {}),
              now: this.#now,
              executeWithReceipt,
            }),
          )
        : undefined;
    const brandCommandProjection =
      brandService &&
      view.profile.manifest.allowedToolFamilies.includes("brand_command") &&
      claim.authority.effectivePermissions.includes("brand.manage")
        ? createBrandCommandToolProjection({
            list: () =>
              executeWithReceipt(
                "brand.list",
                {},
                async () => ({
                  modelOutput: brandListModelOutput(
                    await brandService.list(claim.authority),
                  ),
                }),
                () => "agent.brand_list_failed",
              ),
            inspectDraft: (input: BrandInspectDraftToolInput) =>
              executeWithReceipt(
                "brand.inspect-draft",
                input,
                async () => ({
                  modelOutput: brandDraftModelOutput(
                    await brandService.getDraft(
                      claim.authority,
                      input.brandKitId,
                    ),
                  ),
                }),
                () => "agent.brand_read_failed",
              ),
            createDraft: (input: BrandCreateDraftToolInput) =>
              executeWithReceipt(
                "brand.create-draft",
                input,
                async (action) => ({
                  modelOutput: brandDraftModelOutput(
                    (
                      await brandService.create({
                        authority: claim.authority,
                        name: input.name,
                        ...(input.description
                          ? { description: input.description }
                          : {}),
                        idempotencyKey: `agent-brand-create:${action.id}`,
                        audit: {
                          auditEventId: this.options.nextId(),
                          authenticationRefHash: digestProviderValue(
                            claim.authority.authenticationRefId,
                          ),
                          requestId: `agent-action:${action.id}`,
                        },
                      })
                    ).value,
                  ),
                }),
                () => "agent.brand_create_failed",
              ),
            updateDraft: (input: BrandUpdateDraftToolInput) =>
              executeWithReceipt(
                "brand.update-draft",
                input,
                async (action) => {
                  const {
                    brandKitId,
                    expectedDraftVersion,
                    schemaVersion: _schemaVersion,
                    ...document
                  } = input;
                  void _schemaVersion;
                  return {
                    modelOutput: brandDraftModelOutput(
                      await brandService.updateDraft({
                        authority: claim.authority,
                        brandKitId,
                        expectedDraftVersion,
                        ...document,
                        audit: {
                          auditEventId: this.options.nextId(),
                          authenticationRefHash: digestProviderValue(
                            claim.authority.authenticationRefId,
                          ),
                          requestId: `agent-action:${action.id}`,
                        },
                      }),
                    ),
                  };
                },
                () => "agent.brand_update_failed",
              ),
            proposePublish: async (input: BrandPublishProposalToolInput) => {
              executionNumber += 1;
              const toolCallId = `agent-tool:${String(executionNumber)}:${digestProviderValue(input).slice(7, 23)}`;
              const coordinator = receiptCoordinator.current;
              if (!coordinator) {
                throw new Error(
                  "Agent Tool receipt coordinator is unavailable.",
                );
              }
              const draft = await brandService.getDraft(
                claim.authority,
                input.brandKitId,
              );
              if (draft.draftVersion !== input.expectedDraftVersion) {
                throw Object.assign(new Error("Brand Draft changed."), {
                  code: "agent.brand_changed",
                  effect: "not_started",
                });
              }
              const running = await coordinator.inputAvailable({
                toolCallId,
                toolKey: "brand.propose-publish",
                input,
              });
              await coordinator.preview({
                actionReceiptId: running.id,
                expectedVersion: running.version,
                proposalDocument: Object.freeze({
                  schemaVersion: 1,
                  actionRef: "brand-publish",
                  presentation: Object.freeze({
                    kind: "brand_publish",
                    resourceName: draft.document.name,
                  }),
                  input,
                }),
              });
              return Object.freeze({
                modelOutput: Object.freeze({
                  status: "awaiting_approval",
                  title: draft.document.name,
                }),
              });
            },
          })
        : undefined;
    const brandProjection =
      brandResourceProjection && brandCommandProjection
        ? mergeAgentToolFamilyProjections([
            brandResourceProjection,
            brandCommandProjection,
          ])
        : (brandResourceProjection ?? brandCommandProjection);
    const triggerMessage = messages.find(
      (message) => message.id === claim.run.triggerMessageId,
    );
    const selectedWorkflowRevisionIds = new Set(
      (triggerMessage?.message.referencedResources ?? []).flatMap((resource) =>
        resource.kind === "workflow_definition" ? [resource.resourceId] : [],
      ),
    );
    const workflowReadAllowed =
      view.profile.manifest.allowedToolFamilies.includes("workflow") &&
      claim.authority.effectivePermissions.includes("workflow.read");
    const workflowRunAllowed =
      workflowReadAllowed &&
      claim.authority.effectivePermissions.includes("workflow.run");
    const workflowProjection = workflowReadAllowed
      ? createWorkflowResourceToolProjection({
          surfaceView: view,
          eligibleWorkflowRevisionIds: new Set(
            view.skills.flatMap((skill) =>
              skill.entrypoints.map(
                (entrypoint) => entrypoint.workflowRevisionId,
              ),
            ),
          ),
          executor: createAgentWorkflowResourceExecutor({
            authority: claim.authority,
            catalog: this.options.workflowCatalog,
            selectedWorkflowRevisionIds,
            boundWorkflowDefinitionIds: new Set(
              view.boundWorkflows.map(
                (workflow) => workflow.workflowDefinitionId,
              ),
            ),
            now: this.#now,
            executeWithReceipt,
            ...(workflowRunAllowed
              ? {
                  prepareProposal: async ({ binding, workflow, input }) => {
                    executionNumber += 1;
                    const toolInput = Object.freeze({
                      workflowRevisionId: workflow.workflowRevisionId,
                      input,
                    });
                    const toolCallId = `agent-tool:${String(executionNumber)}:${digestProviderValue(toolInput).slice(7, 23)}`;
                    const coordinator = receiptCoordinator.current;
                    if (!coordinator) {
                      throw new Error(
                        "Agent Tool receipt coordinator is unavailable.",
                      );
                    }
                    const running = await coordinator.inputAvailable({
                      toolCallId,
                      toolKey: binding.toolKey,
                      input: toolInput,
                    });
                    const entrypoint =
                      binding.source === "skill_entrypoint"
                        ? view.skills
                            .find(
                              (skill) =>
                                skill.skillRevisionId ===
                                binding.skillRevisionId,
                            )
                            ?.entrypoints.find(
                              (candidate) =>
                                candidate.entrypointKey ===
                                  binding.entrypointKey &&
                                candidate.workflowRevisionId ===
                                  binding.workflowRevisionId,
                            )
                        : undefined;
                    if (binding.source === "skill_entrypoint" && !entrypoint) {
                      throw new Error(
                        "Agent Workflow Entrypoint is unavailable.",
                      );
                    }
                    const title =
                      entrypoint?.displayName ??
                      workflow.presentation?.title ??
                      workflow.displayName;
                    const description =
                      entrypoint?.description ??
                      workflow.presentation?.description ??
                      workflow.description ??
                      title;
                    await coordinator.preview({
                      actionReceiptId: running.id,
                      expectedVersion: running.version,
                      proposalDocument: Object.freeze({
                        schemaVersion: 1,
                        actionRef: binding.actionRef,
                        ...(binding.source === "skill_entrypoint"
                          ? {
                              skillRevisionId: binding.skillRevisionId,
                              entrypointKey: binding.entrypointKey,
                            }
                          : {}),
                        workflowRevisionId: workflow.workflowRevisionId,
                        title,
                        description,
                        input,
                      }),
                    });
                    return Object.freeze({
                      modelOutput: Object.freeze({
                        status: "awaiting_approval",
                        workflow: title,
                      }),
                    });
                  },
                }
              : {}),
          }),
        })
      : undefined;
    const toolView = createDynamicAgentToolView({
      surfaceView: view,
      digest: digestProviderValue,
      projections: [
        canvasProjection,
        ...(queryProjection ? [queryProjection] : []),
        ...(capabilityProjection ? [capabilityProjection] : []),
        ...(skillCommandProjection ? [skillCommandProjection] : []),
        ...(brandProjection ? [brandProjection] : []),
        ...(workflowProjection ? [workflowProjection] : []),
      ],
    });
    if (
      agentBuiltinToolViewDigest(
        digestProviderValue,
        toolView.toolViewDigest,
      ) !== claim.run.toolViewDigest
    ) {
      throw Object.assign(
        new Error("Agent ToolView differs from its pinned Run digest."),
        { code: "agent.tool_view_changed", effect: "not_started" },
      );
    }
    receiptCoordinator.current = createAgentToolReceiptCoordinator({
      authority: claim.authority,
      agentRunId: claim.run.id,
      facts: this.options.facts,
      descriptors: toolView.descriptors,
      identities: {
        actionReceiptId: (actionNumber) =>
          stableAgentRuntimeId("action-receipt", claim.run.id, actionNumber),
      },
      digest: digestProviderValue,
      initialActionNumber: maximumActionNumber + 1,
      now: this.#now,
    });
    const streamFlushInterval = setInterval(() => {
      void flushStreamedMessage().catch((error: unknown) => {
        streamWriteFailure = error;
      });
    }, assistantStreamFlushIntervalMs);
    let response: Awaited<ReturnType<typeof runKanvasSurfaceAgent>>;
    const loadedImages = new Map<
      string,
      Promise<{ artifactId: string; data: string; mediaType: string }>
    >();
    try {
      response = await runKanvasSurfaceAgent({
        model,
        profile: view.profile,
        skills: view.skills,
        boundBrands: view.boundBrands,
        boundWorkflows: view.boundWorkflows,
        ...(claim.run.contextSnapshot.requestedSkill
          ? {
              explicitSkillRevisionId:
                claim.run.contextSnapshot.requestedSkill.skillRevisionId,
            }
          : {}),
        loadSkillInstructions: (skill) =>
          this.options.instructions.load(
            skill,
            signal,
            view.profile.manifest.skillPolicy.maximumActivatedInstructionBytes,
          ),
        loadSkillReference: (skill, relativePath) =>
          this.options.instructions.loadReference(
            skill,
            relativePath,
            signal,
            view.profile.manifest.skillPolicy.maximumReferenceReadBytes,
          ),
        loadSkillImage: async (skill, path) => {
          const key = `${skill.skillRevisionId}:${path}`;
          const cached = loadedImages.get(key);
          if (cached) return cached;
          if (!this.options.skillLibrary || loadedImages.size >= 8)
            throw new Error(
              "Skill image reading is unavailable or exceeds the image limit.",
            );
          const library = this.options.skillLibrary;
          const pending = (async () => {
            const image = await this.options.instructions.loadImage(
              skill,
              path,
              signal,
            );
            const artifactId = await library.materializeRunImage({
              authority: claim.authority,
              runId: claim.run.id,
              skillRevisionId: skill.skillRevisionId,
              path,
              artifactId: skillImageArtifactId(
                claim.authority.workspaceId,
                skill.skillRevisionId,
                path,
              ),
              now: this.#now(),
            });
            const result = {
              data: image.data,
              mediaType: image.mediaType,
              artifactId,
            };
            return result;
          })();
          loadedImages.set(key, pending);
          return pending;
        },
        assertSkillUsable: (skill) =>
          this.options.foundations.assertSkillUsable({
            authority: claim.authority,
            skillRevisionId: skill.skillRevisionId,
            now: this.#now(),
          }),
        recordSkillUse: (skill, source) =>
          skill.candidate
            ? Promise.resolve()
            : this.options.facts.recordSkillUse({
                authority: claim.authority,
                agentRunId: claim.run.id,
                skillRevisionId: skill.skillRevisionId,
                canonicalDigest: skill.canonicalDigest,
                source,
                now: this.#now(),
              }),
        tools: toolView.descriptors,
        conversation: memoryContext.messages.map((message) => ({
          id: message.id,
          role: message.message.role,
          ...(message.modelMessages
            ? { modelMessages: message.modelMessages }
            : {}),
          createdAt: message.createdAt,
          text: [
            agentVisibleMessageText(message.message),
            ...(message.message.role === "user" &&
            message.message.referencedResources?.length
              ? [
                  `<attached_resources>${JSON.stringify(message.message.referencedResources)}</attached_resources>`,
                ]
              : []),
          ].join("\n"),
          ...(message.id === claim.run.triggerMessageId &&
          message.message.role === "user" &&
          inputFiles.length > 0
            ? { files: inputFiles }
            : {}),
        })),
        ...(continuation ? { continuation } : {}),
        remainingRunLimits: {
          maximumModelCalls: remainingModelCalls,
          maximumToolCalls: remainingToolCalls,
        },
        ...(threadObservations ? { threadObservations } : {}),
        surfaceContext: claim.run.contextSnapshot,
        runCreatedAt: claim.run.createdAt,
        runId: claim.run.id,
        abortSignal: signal,
      });
    } finally {
      clearInterval(streamFlushInterval);
    }
    if (webSearchFailure) {
      throw webSearchFailure instanceof Error
        ? webSearchFailure
        : new Error("Web search execution failed.", {
            cause: webSearchFailure,
          });
    }
    if (!response.suspension && !response.text.trim()) {
      throw new Error("Agent response is empty.");
    }
    // Keep the same step boundaries during streaming and final persistence.
    streamedText = streamedText || response.text;
    if (streamWrite) await streamWrite;
    const finalMessage = visibleAssistantMessage();
    await this.options.facts.appendAssistantMessage({
      workerClaim: {
        workerId: claim.workerId,
        claimTokenDigest: claim.claimTokenDigest,
      },
      authority: claim.authority,
      agentRunId: claim.run.id,
      messageId: assistantMessageId,
      message: finalMessage,
      modelMessages: response.modelMessages,
      now: this.#now(),
    });
    if (!response.suspension) startDeferredMemoryWork();
    if (response.suspension) {
      await this.options.facts.suspendForInteraction({
        authority: claim.authority,
        interactionId: stableAgentRuntimeId(
          "interaction",
          `${claim.run.id}:${response.suspension.toolCallId}`,
          1,
        ),
        agentRunId: claim.run.id,
        assistantMessageId,
        toolCallId: response.suspension.toolCallId,
        request: response.suspension.request,
        checkpoint: response.suspension.checkpoint,
        expectedRunVersion: claim.run.version,
        workerId: claim.workerId,
        claimTokenDigest: claim.claimTokenDigest,
        now: this.#now(),
      });
      return "waiting_for_user";
    }
    if (streamWriteFailure) {
      throw streamWriteFailure instanceof Error
        ? streamWriteFailure
        : new Error("Agent stream persistence failed.");
    }
    const settled = await this.options.facts.settleRun({
      authority: claim.authority,
      runId: claim.run.id,
      workerClaim: {
        workerId: claim.workerId,
        claimTokenDigest: claim.claimTokenDigest,
      },
      now: this.#now(),
    });
    if (
      !["waiting_approval", "succeeded", "failed"].includes(
        settled.lifecycleStatus,
      )
    ) {
      throw new Error(
        "Agent Run could not settle after saving model messages.",
      );
    }
    return settled.lifecycleStatus as
      "waiting_approval" | "succeeded" | "failed";
  }
}
