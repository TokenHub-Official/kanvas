import type { AgentDiscoveryDiagnostics } from "@kanvas/contracts/api";
import type { TrustedWorkspaceScope } from "../../authorization/index.js";
import type {
  AgentInteractionRecord,
  ResolveAgentQuestionInteractionOptions,
  ResolvedAgentQuestionInteraction,
  SuspendAgentQuestionInteractionOptions,
} from "./agent-interaction.js";

export type AgentSurfaceKind =
  | "agent_workspace"
  | "workspace_home"
  | "canvas"
  | "asset"
  | "workflow_run"
  | "workflow_authoring"
  | "brand";

export type AgentThreadLifecycle = "active" | "archived";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentModelCallStatus =
  "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type AgentModelAttemptStatus =
  "prepared" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export type AgentActionStatus =
  | "proposed"
  | "waiting_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentActionEffect =
  "read" | "compute" | "internal_write" | "external_write" | "destructive";

export type AgentActionApprovalMode = "none" | "before_call" | "before_commit";

export type AgentModelCallPurpose =
  | "plan"
  | "tool_selection"
  | "final_response"
  | "structured_output"
  | "web_search"
  | "memory_observation"
  | "thread_title";

export type AgentReasoningLevel = "off" | "low" | "medium" | "high";
export type AgentWebSearchMode = "off" | "auto" | "required";

export interface AgentModelRuntimeControls {
  readonly reasoningLevel: AgentReasoningLevel;
  readonly webSearchMode: AgentWebSearchMode;
}

export interface AgentResourceContext {
  readonly kind:
    | "canvas_draft"
    | "asset"
    | "artifact"
    | "workflow_run"
    | "brand_kit_draft"
    | "skill_revision"
    | "workflow_definition";
  readonly resourceId: string;
  readonly version?: number;
  readonly artifactId?: string;
  readonly brandKitRevisionId?: string;
  readonly displayName?: string;
}

export type AgentSurfaceStateV1 =
  | {
      readonly kind: "agent_workspace";
      readonly originSurface: "agent" | "canvas" | "workspace_home";
      readonly attachmentState: "none" | "present";
      readonly attachedResourceIds: readonly string[];
      readonly pageKey?: string;
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }
  | {
      readonly kind: "workspace_home";
      readonly attachmentState: "none" | "present";
      readonly attachedResourceIds: readonly string[];
    }
  | {
      readonly kind: "canvas";
      readonly pageKey?: string;
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }
  | {
      readonly kind: "review";
      readonly availableArtifactIds: readonly string[];
    }
  | {
      readonly kind: "brand";
      readonly editingSection?: string;
      readonly publishedBrandKitRevisionId?: string;
    }
  | {
      readonly kind: "workflow_authoring";
      readonly selectedNodeKeys: readonly string[];
      readonly graphDigest: string;
      readonly validationStatus: "not_run" | "valid" | "invalid";
      readonly testStatus: "not_run" | "running" | "passed" | "failed";
    };

export interface AgentBrandContextV1 {
  readonly revisionId: string;
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly {
    readonly key: string;
    readonly name: string;
    readonly role:
      | "primary"
      | "secondary"
      | "accent"
      | "background"
      | "surface"
      | "text_primary"
      | "text_secondary";
    readonly value: string;
  }[];
  readonly logos: readonly {
    readonly key: string;
    readonly name: string;
    readonly role: "primary" | "inverse" | "icon";
    readonly assetId?: string;
    readonly artifactId: string;
  }[];
  readonly referenceImages: readonly {
    readonly key: string;
    readonly name: string;
    readonly description?: string;
    readonly artifactId: string;
  }[];
}

export interface AgentContextSnapshotV1 {
  readonly selectedLibraryIds?: readonly string[];
  readonly libraryTools?: boolean;
  readonly browserCanvasExport?: boolean;
  readonly schemaVersion: 1;
  readonly surfaceKind: AgentSurfaceKind;
  readonly surfaceState?: AgentSurfaceStateV1;
  readonly brand?: AgentBrandContextV1;
  readonly resource?: AgentResourceContext;
  readonly brandKitRevisionId?: string;
  readonly selectedElementKeys?: readonly string[];
  readonly selectedArtifactIds?: readonly string[];
  readonly requestedSkill?: {
    readonly skillRevisionId: string;
    readonly displayName: string;
    readonly source?: "published" | "candidate";
  };
}

export type AgentVisibleMessagePartV1 =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "source";
      readonly sourceType: "url";
      readonly id: string;
      readonly url: string;
      readonly title?: string;
    };

export interface AgentVisibleMessageV1 {
  readonly schemaVersion: 1;
  readonly role: "user" | "assistant";
  readonly parts: readonly AgentVisibleMessagePartV1[];
  readonly referencedResources?: readonly AgentResourceContext[];
}

export function agentVisibleMessageText(
  message: AgentVisibleMessageV1,
): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** Opaque runtime transcript; never projected into the public conversation API. */
export interface AgentModelMessagesV1 {
  readonly schemaVersion: 1;
  readonly adapter: "mastra-message-list-v2";
  readonly messages: readonly unknown[];
}

export interface AgentMessageRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly agentRunId: string;
  readonly parentMessageId?: string;
  readonly sequenceNumber: number;
  readonly alternativeIndex?: number;
  readonly alternativeCount?: number;
  readonly previousAlternativeMessageId?: string;
  readonly nextAlternativeMessageId?: string;
  readonly message: AgentVisibleMessageV1;
  readonly modelMessages?: AgentModelMessagesV1;
  readonly createdAt: Date;
}

export type AgentActionOutcomeReference =
  | {
      readonly kind: "query";
      readonly resultCount: number;
      readonly diagnostics?: AgentDiscoveryDiagnostics;
    }
  | {
      readonly kind: "canvas_command";
      readonly canvasDraftId: string;
      readonly beforeVersion: number;
      readonly afterVersion: number;
      readonly undoGroupId?: string;
    }
  | {
      readonly kind: "capability_run";
      readonly capabilityRunId: string;
    }
  | {
      readonly kind: "workflow_run";
      readonly workflowRunId: string;
    }
  | {
      readonly kind: "workflow_draft_command";
      readonly workflowDefinitionId: string;
      readonly beforeVersion: number;
      readonly afterVersion: number;
    }
  | {
      readonly kind: "skill_draft";
      readonly skillDraftId: string;
    }
  | {
      readonly kind: "brand_revision";
      readonly brandKitId: string;
      readonly brandKitRevisionId: string;
    };

export interface AgentThreadRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly agentDefinitionId: string;
  readonly agentProfileRevisionId: string;
  readonly lifecycleStatus: AgentThreadLifecycle;
  readonly title?: string;
  readonly titleSource?: "auto" | "manual";
  readonly activeLeafMessageId?: string;
  readonly activeRunId?: string;
  readonly version: number;
  readonly viewRevision?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt?: Date;
}

export interface AgentRunDiagnosticsRecord {
  readonly runtimeConfigurationVersion?: number;
  readonly runId: string;
  readonly threadId: string;
  readonly lifecycleStatus: AgentRunStatus;
  readonly reasonCode?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly truncated: boolean;
  readonly limits?: {
    readonly maximumModelCalls: number;
    readonly maximumToolCalls: number;
  };
  readonly actions?: readonly {
    readonly id: string;
    readonly actionNumber: number;
    readonly toolKey: string;
    readonly lifecycleStatus: AgentActionStatus;
    readonly reasonCode?: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }[];
  readonly discoveries?: readonly (AgentDiscoveryDiagnostics & {
    readonly actionId: string;
  })[];
  readonly calls: readonly {
    readonly id: string;
    readonly callNumber?: number;
    readonly finishReason?: string;
    readonly modelProfileKey?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly purpose: AgentModelCallPurpose;
    readonly lifecycleStatus: AgentModelCallStatus;
    readonly reasonCode?: string;
    readonly routeResolved: boolean | null;
    readonly providerAccepted: boolean;
    readonly requestId?: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }[];
}

export interface AgentThreadListCursor {
  readonly updatedAt: Date;
  readonly id: string;
}

export interface AgentThreadSummaryRecord extends AgentThreadRecord {
  readonly latestRun?: {
    readonly id: string;
    readonly lifecycleStatus: AgentRunStatus;
    readonly terminalReasonCode?: string;
    readonly updatedAt: Date;
  };
}

export interface AgentThreadMemoryRecord {
  readonly threadId: string;
  readonly activeObservations: string;
  readonly observationsDigest: string;
  readonly sourceMessageId?: string;
  readonly lastObservedAt: Date;
  readonly observerModelBindingKey: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface SaveAgentThreadMemoryOptions {
  readonly agentRunId?: string;
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly activeObservations: string;
  readonly observationsDigest: string;
  readonly sourceMessageId?: string;
  readonly lastObservedAt: Date;
  readonly observerModelBindingKey: string;
  readonly now: Date;
}

export interface ListAgentThreadsOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly cursor?: AgentThreadListCursor;
  readonly limit: number;
  readonly now: Date;
}

export interface AgentThreadListResult {
  readonly items: readonly AgentThreadSummaryRecord[];
  readonly nextCursor?: AgentThreadListCursor;
}

export interface AgentRunRecord {
  readonly runtimeConfigurationVersion?: number;
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly parentRunId?: string;
  readonly triggerMessageId?: string;
  readonly actorPrincipalId: string;
  readonly lifecycleStatus: AgentRunStatus;
  readonly contextSnapshot: AgentContextSnapshotV1;
  readonly toolViewDigest: string;
  readonly promptRevision: string;
  readonly maximumModelCalls: number;
  readonly maximumToolCalls: number;
  readonly foundationContext: AgentRunFoundationContextV1;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly executionDeadlineAt: Date;
  readonly completedAt?: Date;
  readonly terminalReasonCode?: string;
}

export interface AgentRunSkillContextV1 {
  readonly skillRevisionId: string;
  readonly canonicalDigest: string;
  readonly instructionResourceDigest: string;
  readonly entrypointWorkflowRevisionIds: readonly string[];
}

export interface AgentRunFoundationContextV1 {
  readonly schemaVersion: 1;
  readonly profileRevisionId: string;
  readonly profileCanonicalDigest: string;
  readonly skillViewDigest: string;
  readonly skills: readonly AgentRunSkillContextV1[];
}

export interface AgentModelCallRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentRunId: string;
  readonly callNumber: number;
  readonly purpose: AgentModelCallPurpose;
  readonly lifecycleStatus: AgentModelCallStatus;
  readonly modelProfileKey: string;
  readonly inputDigest: string;
  readonly outputDigest?: string;
  readonly finishReason?: string;
  readonly terminalReasonCode?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface AgentModelAttemptRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentModelCallId: string;
  readonly attemptNumber: number;
  readonly transitionKind: "initial" | "retry" | "fallback";
  readonly lifecycleStatus: AgentModelAttemptStatus;
  readonly routeSnapshot: Readonly<Record<string, unknown>>;
  readonly routeDigest: string;
  readonly providerRequestId?: string;
  readonly accepted: boolean;
  readonly usageDocument?: Readonly<Record<string, unknown>>;
  readonly terminalReasonCode?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
}

export interface AgentActionReceiptRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentRunId: string;
  readonly actionNumber: number;
  readonly toolCallId: string;
  readonly toolKey: string;
  readonly effect: AgentActionEffect;
  readonly approvalMode: AgentActionApprovalMode;
  readonly lifecycleStatus: AgentActionStatus;
  readonly inputDigest: string;
  readonly outputDigest?: string;
  readonly proposalDocument?: Readonly<Record<string, unknown>>;
  readonly outcomeReference?: AgentActionOutcomeReference;
  readonly terminalReasonCode?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface CreateAgentThreadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly agentDefinitionId: string;
  readonly agentProfileRevisionId: string;
  readonly title?: string;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface RecordAgentRunSkillUseOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly skillRevisionId: string;
  readonly canonicalDigest: string;
  readonly source: "bound" | "explicit" | "discovered";
  readonly now: Date;
}

export interface RenameAgentThreadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly expectedVersion: number;
  readonly title: string;
  readonly now: Date;
}

export interface AutoRenameAgentThreadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly title: string;
  readonly now: Date;
}

export interface ArchiveAgentThreadOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export interface StartAgentRunOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly threadId: string;
  readonly userMessageId: string;
  readonly userMessage: AgentVisibleMessageV1;
  readonly parentMessageId?: string;
  readonly contextSnapshot: AgentContextSnapshotV1;
  readonly toolViewDigest: string;
  readonly promptRevision: string;
  readonly maximumModelCalls: number;
  readonly maximumToolCalls: number;
  readonly foundationContext: AgentRunFoundationContextV1;
  readonly executionDeadlineAt: Date;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface RegenerateAgentRunOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly threadId: string;
  readonly sourceAssistantMessageId?: string;
  readonly sourceRunId?: string;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface SelectAgentThreadBranchOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly threadId: string;
  readonly assistantMessageId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export interface SettleAgentRunOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly now: Date;
  /** Only the model Worker may settle a running Run, after saving its final messages. */
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
}

export interface TransitionAgentRunOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly expectedVersion: number;
  readonly toStatus: AgentRunStatus;
  readonly terminalReasonCode?: string;
  readonly now: Date;
}

export interface BeginAgentModelCallOptions {
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly modelCallId: string;
  readonly callNumber: number;
  readonly purpose: AgentModelCallPurpose;
  readonly modelProfileKey: string;
  readonly inputDigest: string;
  readonly now: Date;
}

export interface AppendAgentAssistantMessageOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly messageId: string;
  readonly message: AgentVisibleMessageV1;
  readonly modelMessages?: AgentModelMessagesV1;
  readonly now: Date;
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
}

export interface ProposeAgentActionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly actionReceiptId: string;
  readonly actionNumber: number;
  readonly toolCallId: string;
  readonly toolKey: string;
  readonly effect: AgentActionEffect;
  readonly approvalMode: AgentActionApprovalMode;
  readonly inputDigest: string;
  readonly now: Date;
}

export interface TransitionAgentActionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly toStatus: "waiting_approval" | "running";
  readonly now: Date;
}

export interface PreviewAgentActionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly outputDigest: string;
  readonly proposalDocument: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export interface DeclinePendingAgentActionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly actionReceiptId: string;
  readonly now: Date;
}

export interface DeclinedPendingAgentAction {
  readonly action: AgentActionReceiptRecord;
  readonly run: AgentRunRecord;
  readonly replayed: boolean;
}

interface CompleteAgentActionBase {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export type CompleteAgentActionOptions =
  | (CompleteAgentActionBase & {
      readonly status: "succeeded";
      readonly outputDigest: string;
      readonly outcomeReference?: AgentActionOutcomeReference;
      readonly terminalReasonCode?: never;
    })
  | (CompleteAgentActionBase & {
      readonly status: "failed" | "cancelled";
      readonly outputDigest?: never;
      readonly outcomeReference?: never;
      readonly terminalReasonCode: string;
    });

export interface StartAgentModelAttemptOptions {
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly modelCallId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly transitionKind: "initial" | "retry" | "fallback";
  readonly routeSnapshot: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

interface CompleteAgentModelAttemptBase {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly modelCallId: string;
  readonly attemptId: string;
  readonly providerRequestId?: string;
  readonly usageDocument?: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export type CompleteAgentModelAttemptOptions =
  | (CompleteAgentModelAttemptBase & {
      readonly status: "succeeded";
      readonly outputDigest: string;
      readonly finishReason: string;
      readonly terminalReasonCode?: never;
      readonly terminalForCall?: never;
    })
  | (CompleteAgentModelAttemptBase & {
      readonly status: "failed" | "cancelled" | "unknown";
      readonly outputDigest?: never;
      readonly finishReason?: never;
      readonly terminalReasonCode: string;
      readonly terminalForCall: boolean;
    });

export interface AgentCanvasExportRequest {
  readonly canvasDraftId: string;
  readonly documentVersion: number;
  readonly pageId: string;
}

export type AgentCanvasExportCompletion =
  | {
      readonly status: "succeeded";
      readonly exportSessionId: string;
      readonly artifactId: string;
      readonly filename: string;
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly message: string;
    };

export interface RecordAgentCanvasExportOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly request: AgentCanvasExportRequest;
  readonly completion?: AgentCanvasExportCompletion;
  readonly now: Date;
}

export interface AgentRuntimeRepository {
  recordCanvasExport(
    options: RecordAgentCanvasExportOptions,
  ): Promise<AgentActionReceiptRecord>;
  createThread(options: CreateAgentThreadOptions): Promise<AgentThreadRecord>;
  renameThread(options: RenameAgentThreadOptions): Promise<AgentThreadRecord>;
  autoRenameThread(
    options: AutoRenameAgentThreadOptions,
  ): Promise<AgentThreadRecord>;
  archiveThread(options: ArchiveAgentThreadOptions): Promise<AgentThreadRecord>;
  listThreads(options: ListAgentThreadsOptions): Promise<AgentThreadListResult>;
  getThread(
    authority: TrustedWorkspaceScope,
    threadId: string,
    now: Date,
  ): Promise<AgentThreadRecord | undefined>;
  getThreadMemory(
    authority: TrustedWorkspaceScope,
    threadId: string,
    now: Date,
  ): Promise<AgentThreadMemoryRecord | undefined>;
  saveThreadMemory(
    options: SaveAgentThreadMemoryOptions,
  ): Promise<AgentThreadMemoryRecord>;
  startRun(options: StartAgentRunOptions): Promise<AgentRunRecord>;
  recordSkillUse(options: RecordAgentRunSkillUseOptions): Promise<void>;
  regenerateRun(options: RegenerateAgentRunOptions): Promise<AgentRunRecord>;
  selectThreadBranch(
    options: SelectAgentThreadBranchOptions,
  ): Promise<AgentThreadRecord>;
  getRun(
    authority: TrustedWorkspaceScope,
    runId: string,
    now: Date,
  ): Promise<AgentRunRecord | undefined>;
  getRunDiagnostics(
    authority: TrustedWorkspaceScope,
    runId: string,
    now: Date,
  ): Promise<AgentRunDiagnosticsRecord | undefined>;
  getAssistantMessage(
    authority: TrustedWorkspaceScope,
    runId: string,
    now: Date,
  ): Promise<AgentVisibleMessageV1 | undefined>;
  listThreadMessages(
    authority: TrustedWorkspaceScope,
    threadId: string,
    limit: number,
    now: Date,
  ): Promise<readonly AgentMessageRecord[]>;
  listRunMessages(
    authority: TrustedWorkspaceScope,
    runId: string,
    limit: number | "all",
    now: Date,
  ): Promise<readonly AgentMessageRecord[]>;
  getLatestThreadRun(
    authority: TrustedWorkspaceScope,
    threadId: string,
    now: Date,
  ): Promise<AgentRunRecord | undefined>;
  listThreadActions(
    authority: TrustedWorkspaceScope,
    threadId: string,
    limit: number,
    now: Date,
  ): Promise<readonly AgentActionReceiptRecord[]>;
  listThreadInteractions(
    authority: TrustedWorkspaceScope,
    threadId: string,
    limit: number,
    now: Date,
  ): Promise<readonly AgentInteractionRecord[]>;
  listRunInteractions(
    authority: TrustedWorkspaceScope,
    agentRunId: string,
    now: Date,
  ): Promise<readonly AgentInteractionRecord[]>;
  getInteraction(
    authority: TrustedWorkspaceScope,
    interactionId: string,
    now: Date,
  ): Promise<AgentInteractionRecord | undefined>;
  getRunModelCallUsage(
    authority: TrustedWorkspaceScope,
    agentRunId: string,
    now: Date,
  ): Promise<{
    readonly mainCallCount: number;
    readonly maximumCallNumber: number;
    readonly threadTitleCallCount: number;
  }>;
  suspendForInteraction(
    options: SuspendAgentQuestionInteractionOptions,
  ): Promise<AgentInteractionRecord>;
  resolveInteraction(
    options: ResolveAgentQuestionInteractionOptions,
  ): Promise<ResolvedAgentQuestionInteraction>;
  transitionRun(options: TransitionAgentRunOptions): Promise<AgentRunRecord>;
  settleRun(options: SettleAgentRunOptions): Promise<AgentRunRecord>;
  beginModelCall(
    options: BeginAgentModelCallOptions,
  ): Promise<AgentModelCallRecord>;
  startModelAttempt(
    options: StartAgentModelAttemptOptions,
  ): Promise<AgentModelAttemptRecord>;
  completeModelAttempt(options: CompleteAgentModelAttemptOptions): Promise<{
    readonly call: AgentModelCallRecord;
    readonly attempt: AgentModelAttemptRecord;
  }>;
  appendAssistantMessage(
    options: AppendAgentAssistantMessageOptions,
  ): Promise<void>;
  proposeAction(
    options: ProposeAgentActionOptions,
  ): Promise<AgentActionReceiptRecord>;
  transitionAction(
    options: TransitionAgentActionOptions,
  ): Promise<AgentActionReceiptRecord>;
  completeAction(
    options: CompleteAgentActionOptions,
  ): Promise<AgentActionReceiptRecord>;
  recordActionPreview(
    options: PreviewAgentActionOptions,
  ): Promise<AgentActionReceiptRecord>;
  declinePendingAction(
    options: DeclinePendingAgentActionOptions,
  ): Promise<DeclinedPendingAgentAction>;
  getAction(
    authority: TrustedWorkspaceScope,
    actionReceiptId: string,
    now: Date,
  ): Promise<AgentActionReceiptRecord | undefined>;
  listRunActions(
    authority: TrustedWorkspaceScope,
    agentRunId: string,
    now: Date,
  ): Promise<readonly AgentActionReceiptRecord[]>;
}

export interface AgentRunWorkerClaim {
  readonly workerId: string;
  readonly claimTokenDigest: string;
  readonly leaseExpiresAt: Date;
  readonly authority: TrustedWorkspaceScope;
  readonly run: AgentRunRecord;
  readonly modelBindingKey: string;
  readonly fastModelBindingKey: string;
  readonly modelControls: AgentModelRuntimeControls;
}

export interface AgentRunDispatchRepository {
  cancel(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentRunId: string;
    readonly now: Date;
  }): Promise<{
    readonly id: string;
    readonly lifecycleStatus: "cancelled";
  }>;
  claimNext(options: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
    readonly leaseExpiresAt: Date;
    readonly now: Date;
  }): Promise<AgentRunWorkerClaim | undefined>;
  heartbeat(options: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
    readonly agentRunId: string;
    readonly leaseExpiresAt: Date;
    readonly now: Date;
  }): Promise<void>;
  complete(options: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
    readonly agentRunId: string;
    readonly now: Date;
  }): Promise<void>;
}

function runStatuses(
  ...statuses: readonly AgentRunStatus[]
): readonly AgentRunStatus[] {
  return Object.freeze(statuses);
}

function modelCallStatuses(
  ...statuses: readonly AgentModelCallStatus[]
): readonly AgentModelCallStatus[] {
  return Object.freeze(statuses);
}

function actionStatuses(
  ...statuses: readonly AgentActionStatus[]
): readonly AgentActionStatus[] {
  return Object.freeze(statuses);
}

const agentRunTransitions: Readonly<
  Record<AgentRunStatus, readonly AgentRunStatus[]>
> = Object.freeze({
  queued: runStatuses("running", "failed", "cancelled"),
  running: runStatuses(
    "waiting_approval",
    "waiting_for_user",
    "succeeded",
    "failed",
    "cancelled",
  ),
  waiting_approval: runStatuses("running", "succeeded", "failed", "cancelled"),
  waiting_for_user: runStatuses("queued", "failed", "cancelled"),
  succeeded: runStatuses(),
  failed: runStatuses(),
  cancelled: runStatuses(),
});

const modelCallTransitions: Readonly<
  Record<AgentModelCallStatus, readonly AgentModelCallStatus[]>
> = Object.freeze({
  pending: modelCallStatuses("running", "cancelled"),
  running: modelCallStatuses("succeeded", "failed", "cancelled"),
  succeeded: modelCallStatuses(),
  failed: modelCallStatuses(),
  cancelled: modelCallStatuses(),
});

const actionTransitions: Readonly<
  Record<AgentActionStatus, readonly AgentActionStatus[]>
> = Object.freeze({
  proposed: actionStatuses("waiting_approval", "running", "cancelled"),
  waiting_approval: actionStatuses("running", "failed", "cancelled"),
  running: actionStatuses(
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
  ),
  succeeded: actionStatuses(),
  failed: actionStatuses(),
  cancelled: actionStatuses(),
});

export function agentRunTransitionAllowed(
  from: AgentRunStatus,
  to: AgentRunStatus,
): boolean {
  return agentRunTransitions[from].includes(to);
}

export function agentModelCallTransitionAllowed(
  from: AgentModelCallStatus,
  to: AgentModelCallStatus,
): boolean {
  return modelCallTransitions[from].includes(to);
}

export function agentActionTransitionAllowed(
  from: AgentActionStatus,
  to: AgentActionStatus,
): boolean {
  return actionTransitions[from].includes(to);
}

export function agentActionRequiresApproval(options: {
  readonly effect: AgentActionEffect;
  readonly approvalMode: AgentActionApprovalMode;
}): boolean {
  if (
    (options.effect === "external_write" || options.effect === "destructive") &&
    options.approvalMode === "none"
  ) {
    throw new Error("High-risk Agent actions require an approval mode.");
  }
  return options.approvalMode === "before_call";
}
