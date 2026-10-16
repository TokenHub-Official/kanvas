import { pinAgentLibrariesInTransaction } from "./agent-library-store.js";
import { createRuntimeConfigurationReader } from "./runtime-configuration-reader.js";
import { RuntimeConfigurationError } from "./runtime-configuration-policy.js";
import { readRuntimeConfiguration } from "./runtime-configuration-store.js";
import { agentModelCallAdmitted } from "./agent-model-call-admission.js";
import { parseAgentDiscoveryDiagnostics } from "@kanvas/contracts/api";
import { assertResourceAdmission } from "./resource-lifecycle-store.js";
import type {
  AgentActionApprovalMode,
  AgentActionEffect,
  AgentActionReceiptRecord,
  AgentActionStatus,
  AgentModelAttemptRecord,
  AgentMessageRecord,
  AgentModelMessagesV1,
  AgentModelAttemptStatus,
  AgentModelCallPurpose,
  AgentModelCallRecord,
  AgentModelCallStatus,
  AgentContextSnapshotV1,
  AgentInteractionRecord,
  AgentInteractionStatus,
  AgentQuestionRequestV1,
  AgentQuestionResponseV1,
  AgentRunRecord,
  AgentRunDiagnosticsRecord,
  AgentRunFoundationContextV1,
  AgentRunSkillContextV1,
  AgentRunStatus,
  AgentRuntimeRepository,
  AgentThreadLifecycle,
  AgentThreadListResult,
  AgentThreadMemoryRecord,
  AgentThreadRecord,
  AgentThreadSummaryRecord,
  AgentVisibleMessageV1,
  AppendAgentAssistantMessageOptions,
  ArchiveAgentThreadOptions,
  AutoRenameAgentThreadOptions,
  BeginAgentModelCallOptions,
  CompleteAgentModelAttemptOptions,
  CompleteAgentActionOptions,
  CreateAgentThreadOptions,
  DeclinePendingAgentActionOptions,
  ListAgentThreadsOptions,
  ProposeAgentActionOptions,
  RecordAgentRunSkillUseOptions,
  RecordAgentCanvasExportOptions,
  ResolveAgentQuestionInteractionOptions,
  RenameAgentThreadOptions,
  RegenerateAgentRunOptions,
  SaveAgentThreadMemoryOptions,
  SelectAgentThreadBranchOptions,
  PreviewAgentActionOptions,
  StartAgentModelAttemptOptions,
  StartAgentRunOptions,
  SuspendAgentQuestionInteractionOptions,
  TransitionAgentRunOptions,
  TransitionAgentActionOptions,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  agentInteractionStatusForResponse,
  agentActionTransitionAllowed,
  agentRunTransitionAllowed,
} from "@kanvas/application";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

interface AgentThreadRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByPrincipalId: string;
  readonly agentDefinitionId: string;
  readonly agentProfileRevisionId: string;
  readonly lifecycleStatus: AgentThreadLifecycle;
  readonly title: string | null;
  readonly titleSource: "auto" | "manual";
  readonly activeLeafMessageId: string | null;
  readonly activeRunId: string | null;
  readonly creationRequestKey: string;
  readonly creationRequestHash: string;
  readonly version: number;
  readonly viewRevision?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

interface AgentThreadSummaryRow extends AgentThreadRow {
  readonly latestRunId: string | null;
  readonly latestRunStatus: AgentRunStatus | null;
  readonly latestRunTerminalReasonCode: string | null;
  readonly latestRunUpdatedAt: Date | null;
}

interface AgentThreadMemoryRow extends RowDataPacket {
  readonly threadId: string;
  readonly activeObservations: string;
  readonly observationsDigest: string;
  readonly sourceMessageId: string | null;
  readonly lastObservedAt: Date;
  readonly observerModelBindingKey: string;
  readonly version: number;
  readonly updatedAt: Date;
}

function threadMemoryFrom(row: AgentThreadMemoryRow): AgentThreadMemoryRecord {
  return Object.freeze({
    threadId: row.threadId,
    activeObservations: row.activeObservations,
    observationsDigest: row.observationsDigest,
    ...(row.sourceMessageId ? { sourceMessageId: row.sourceMessageId } : {}),
    lastObservedAt: new Date(row.lastObservedAt),
    observerModelBindingKey: row.observerModelBindingKey,
    version: row.version,
    updatedAt: new Date(row.updatedAt),
  });
}

interface AgentRunRow extends RowDataPacket {
  readonly runtimeConfigurationVersion?: number | null;
  readonly runtimeTimeoutSeconds?: number | null;
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly parentRunId: string | null;
  readonly triggerMessageId: string | null;
  readonly actorPrincipalId: string;
  readonly lifecycleStatus: AgentRunStatus;
  readonly contextSnapshot: unknown;
  readonly contextDigest: string;
  readonly toolViewDigest: string;
  readonly promptRevision: string;
  readonly maximumModelCalls: number;
  readonly maximumToolCalls: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly terminalReasonCode: string | null;
  readonly version: number;
  readonly executionDeadlineAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly profileRevisionId: string;
  readonly profileCanonicalDigest: string;
  readonly skillViewDigest: string;
  readonly skillContextSnapshot: unknown;
}

interface MessageSequenceRow extends RowDataPacket {
  readonly nextSequence: number;
}

interface MessageAlternativeRow extends RowDataPacket {
  readonly nextAlternative: number;
}

interface AgentMessageRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly agentRunId: string;
  readonly parentMessageId: string | null;
  readonly sequenceNumber: number;
  readonly alternativeIndex: number;
  readonly alternativeCount: number;
  readonly previousAlternativeMessageId: string | null;
  readonly nextAlternativeMessageId: string | null;
  readonly content: unknown;
  readonly modelMessages?: unknown;
  readonly createdAt: Date;
}

function modelMessages(value: unknown): AgentModelMessagesV1 {
  const data =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !data ||
    typeof data !== "object" ||
    !("schemaVersion" in data) ||
    data.schemaVersion !== 1 ||
    !("adapter" in data) ||
    data.adapter !== "mastra-message-list-v2" ||
    !("messages" in data) ||
    !Array.isArray(data.messages) ||
    data.messages.some(
      (message: unknown) =>
        !message ||
        typeof message !== "object" ||
        !("id" in message) ||
        typeof message.id !== "string" ||
        !("role" in message) ||
        !["user", "assistant", "tool"].includes(String(message.role)) ||
        !("content" in message),
    )
  ) {
    return invalid(
      "agent.integrity_violation",
      "Agent model message transcript is invalid.",
    );
  }
  return data as unknown as AgentModelMessagesV1;
}

function diagnosticTokenCount(
  key: "inputTokens" | "outputTokens",
  value: unknown,
): Readonly<Record<string, number>> {
  if (typeof value !== "number" && typeof value !== "string") return {};
  if (typeof value === "string" && !/^\d+$/u.test(value)) return {};
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? { [key]: count } : {};
}

interface AgentModelCallRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentRunId: string;
  readonly callNumber: number;
  readonly purpose: AgentModelCallPurpose;
  readonly lifecycleStatus: AgentModelCallStatus;
  readonly modelProfileKey: string;
  readonly inputDigest: string;
  readonly outputDigest: string | null;
  readonly finishReason: string | null;
  readonly terminalReasonCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

interface AgentModelAttemptRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentModelCallId: string;
  readonly attemptNumber: number;
  readonly transitionKind: "initial" | "retry" | "fallback";
  readonly lifecycleStatus: AgentModelAttemptStatus;
  readonly routeSnapshot: unknown;
  readonly routeDigest: string;
  readonly providerRequestId: string | null;
  readonly acceptedMarker: number | null;
  readonly usageDocument: unknown;
  readonly usageDigest: string | null;
  readonly terminalReasonCode: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

interface AgentActionReceiptRow extends RowDataPacket {
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
  readonly outputDigest: string | null;
  readonly proposalDocument: unknown;
  readonly outcomeKind: string | null;
  readonly queryResultCount: number | null;
  readonly queryDiagnostics?: unknown;
  readonly canvasDraftId: string | null;
  readonly capabilityRunId: string | null;
  readonly workflowRunId: string | null;
  readonly workflowDefinitionId: string | null;
  readonly skillDraftId: string | null;
  readonly brandKitId: string | null;
  readonly brandKitRevisionId: string | null;
  readonly beforeVersion: number | null;
  readonly afterVersion: number | null;
  readonly undoGroupId: string | null;
  readonly terminalReasonCode: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

interface AgentInteractionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly agentRunId: string;
  readonly assistantMessageId: string;
  readonly interactionNumber: number;
  readonly toolCallId: string;
  readonly toolKey: "builtin.ask-question";
  readonly lifecycleStatus: AgentInteractionStatus;
  readonly requestDocument: unknown;
  readonly requestDigest: string;
  readonly responseDocument: unknown;
  readonly responseDigest: string | null;
  readonly checkpointDocument: unknown;
  readonly checkpointDigest: string;
  readonly resolutionRequestKey: string | null;
  readonly resolvedByPrincipalId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

const idPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const stableKeyPattern = /^[a-z0-9][a-z0-9._:-]{0,95}$/u;
const workerPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u;
const maximumInteractionCheckpointCharacters = 1_000_000;
const maximumToolCallIdCharacters = 256;
const maximumControlCharacterCode = 31;
const deleteCharacterCode = 127;

function validToolCallId(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= maximumToolCallIdCharacters &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        code <= maximumControlCharacterCode || code === deleteCharacterCode
      );
    })
  );
}

export type AgentRuntimeStoreErrorCode =
  | "agent.invalid_argument"
  | "agent.identity_conflict"
  | "agent.thread_not_found"
  | "agent.thread_inactive"
  | "agent.thread_forbidden"
  | "agent.profile_conflict"
  | "agent.run_active"
  | "agent.run_not_found"
  | "agent.run_inactive"
  | "agent.branch_unavailable"
  | "agent.retry_requires_task_recovery"
  | "agent.model_call_not_found"
  | "agent.model_attempt_not_found"
  | "agent.action_not_found"
  | "agent.interaction_not_found"
  | "agent.limit_exceeded"
  | "agent.state_conflict"
  | "agent.integrity_violation";

export class AgentRuntimeStoreError extends Error {
  public constructor(
    readonly code: AgentRuntimeStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeStoreError";
  }
}

function invalid(code: AgentRuntimeStoreErrorCode, message: string): never {
  throw new AgentRuntimeStoreError(code, message);
}

function assertId(value: string, label: string): void {
  if (!idPattern.test(value)) {
    invalid("agent.invalid_argument", `${label} is invalid.`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) {
    invalid("agent.invalid_argument", `${label} is invalid.`);
  }
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 1 || value.length > 160) {
    invalid(
      "agent.invalid_argument",
      "idempotencyKey must contain between 1 and 160 characters.",
    );
  }
}

function boundedTitle(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length < 1 || normalized.length > 240) {
    return invalid(
      "agent.invalid_argument",
      "Agent Thread title must contain between 1 and 240 characters.",
    );
  }
  return normalized;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function jsonRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return invalid("agent.integrity_violation", `${label} is invalid JSON.`);
    }
  }
  return (
    record(decoded) ??
    invalid("agent.integrity_violation", `${label} must be an object.`)
  );
}

function contextSnapshot(value: unknown): AgentContextSnapshotV1 {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.schemaVersion !== 1 ||
    ![
      "agent_workspace",
      "workspace_home",
      "canvas",
      "asset",
      "workflow_run",
      "workflow_authoring",
      "brand",
    ].includes(String(candidate.surfaceKind))
  ) {
    return invalid(
      "agent.integrity_violation",
      "Stored Agent context does not match schema version 1.",
    );
  }
  return value as AgentContextSnapshotV1;
}

function assertMessageParts(
  parts: unknown,
  role: "user" | "assistant",
  code: "agent.integrity_violation" | "agent.invalid_argument",
): asserts parts is AgentVisibleMessageV1["parts"] {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 64) {
    invalid(code, "Agent message parts are invalid.");
  }
  let textLength = 0;
  let reasoningLength = 0;
  let toolCallCount = 0;
  let sourceCount = 0;
  for (const value of parts) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(code, "Agent message part is invalid.");
    }
    const part = value as Readonly<Record<string, unknown>>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.trim().length < 1) {
        invalid(code, "Agent text part is invalid.");
      }
      textLength += part.text.length;
      continue;
    }
    if (role === "user") {
      invalid(code, "Agent user messages may contain only text parts.");
    }
    if (part.type === "reasoning") {
      if (typeof part.text !== "string" || part.text.trim().length < 1) {
        invalid(code, "Agent reasoning part is invalid.");
      }
      reasoningLength += part.text.length;
      continue;
    }
    if (part.type === "tool-call") {
      if (
        typeof part.toolCallId !== "string" ||
        part.toolCallId.length < 1 ||
        part.toolCallId.length > 256 ||
        typeof part.toolName !== "string" ||
        part.toolName.length < 1 ||
        part.toolName.length > 256
      ) {
        invalid(code, "Agent tool-call part is invalid.");
      }
      toolCallCount += 1;
      continue;
    }
    if (part.type === "source") {
      let url: URL;
      try {
        url = new URL(String(part.url));
      } catch {
        return invalid(code, "Agent source part is invalid.");
      }
      if (
        part.sourceType !== "url" ||
        typeof part.id !== "string" ||
        part.id.length < 1 ||
        part.id.length > 256 ||
        typeof part.url !== "string" ||
        url.protocol !== "https:" ||
        part.url.length > 2_048 ||
        (part.title !== undefined &&
          (typeof part.title !== "string" ||
            part.title.length < 1 ||
            part.title.length > 300))
      ) {
        invalid(code, "Agent source part is invalid.");
      }
      sourceCount += 1;
      continue;
    }
    invalid(code, "Agent message part type is invalid.");
  }
  if (
    (role === "user" &&
      (textLength < 1 || textLength > 8_000 || reasoningLength > 8_000)) ||
    toolCallCount > 32 ||
    sourceCount > 20
  ) {
    invalid(code, "Agent message parts exceed their bounds.");
  }
}

function visibleMessage(value: unknown): AgentVisibleMessageV1 {
  const candidate = jsonRecord(value, "Agent message");
  if (
    candidate.schemaVersion !== 1 ||
    !["user", "assistant"].includes(String(candidate.role))
  ) {
    return invalid(
      "agent.integrity_violation",
      "Stored Agent message does not match schema version 1.",
    );
  }
  assertMessageParts(
    candidate.parts,
    candidate.role as "user" | "assistant",
    "agent.integrity_violation",
  );
  return candidate as unknown as AgentVisibleMessageV1;
}

function assertMessage(message: AgentVisibleMessageV1): void {
  if (
    message.schemaVersion !== 1 ||
    message.role !== "user" ||
    (message.referencedResources?.length ?? 0) > 32
  ) {
    invalid("agent.invalid_argument", "Agent user message is invalid.");
  }
  assertMessageParts(message.parts, "user", "agent.invalid_argument");
  message.referencedResources?.forEach((resource) => {
    assertId(resource.resourceId, "referencedResource.resourceId");
    if (
      ![
        "canvas_draft",
        "asset",
        "artifact",
        "workflow_run",
        "brand_kit_draft",
        "skill_revision",
        "workflow_definition",
      ].includes(resource.kind) ||
      (resource.artifactId !== undefined &&
        !idPattern.test(resource.artifactId)) ||
      (resource.brandKitRevisionId !== undefined &&
        !idPattern.test(resource.brandKitRevisionId)) ||
      (resource.displayName !== undefined &&
        (typeof resource.displayName !== "string" ||
          resource.displayName.length > 240)) ||
      (resource.version !== undefined &&
        (!Number.isSafeInteger(resource.version) || resource.version < 1))
    ) {
      invalid("agent.invalid_argument", "Agent resource reference is invalid.");
    }
  });
}
function assertStartRun(options: StartAgentRunOptions): void {
  assertId(options.runId, "runId");
  assertId(options.threadId, "threadId");
  assertId(options.userMessageId, "userMessageId");
  assertDigest(options.toolViewDigest, "toolViewDigest");
  assertId(
    options.foundationContext.profileRevisionId,
    "foundationContext.profileRevisionId",
  );
  assertDigest(
    options.foundationContext.profileCanonicalDigest,
    "foundationContext.profileCanonicalDigest",
  );
  assertDigest(
    options.foundationContext.skillViewDigest,
    "foundationContext.skillViewDigest",
  );
  if (
    options.foundationContext.schemaVersion !== 1 ||
    options.foundationContext.skills.length > 200
  ) {
    invalid("agent.invalid_argument", "Agent Run foundation is invalid.");
  }
  for (const skill of options.foundationContext.skills) {
    assertId(skill.skillRevisionId, "foundationContext.skillRevisionId");
    assertDigest(skill.canonicalDigest, "foundationContext.canonicalDigest");
    assertDigest(
      skill.instructionResourceDigest,
      "foundationContext.instructionResourceDigest",
    );
    if (skill.entrypointWorkflowRevisionIds.length > 20) {
      invalid("agent.invalid_argument", "Agent Run Skill context is invalid.");
    }
    skill.entrypointWorkflowRevisionIds.forEach((id) =>
      assertId(id, "foundationContext.entrypointWorkflowRevisionId"),
    );
  }
  if (!stableKeyPattern.test(options.promptRevision)) {
    invalid("agent.invalid_argument", "promptRevision is invalid.");
  }
  if (
    options.maximumModelCalls < 1 ||
    options.maximumModelCalls > 64 ||
    options.maximumToolCalls < 0 ||
    options.maximumToolCalls > 128
  ) {
    invalid("agent.invalid_argument", "Agent Run limits are invalid.");
  }
  const duration =
    options.executionDeadlineAt.getTime() - options.now.getTime();
  if (duration < 1_000 || duration > 30 * 60_000) {
    invalid("agent.invalid_argument", "Agent Run deadline is invalid.");
  }
  assertMessage(options.userMessage);
}

function skillContextSnapshot(
  value: unknown,
): readonly AgentRunSkillContextV1[] {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return invalid(
        "agent.integrity_violation",
        "Stored Agent Skill context is invalid JSON.",
      );
    }
  }
  if (!Array.isArray(decoded) || decoded.length > 200) {
    return invalid(
      "agent.integrity_violation",
      "Stored Agent Skill context is invalid.",
    );
  }
  const skills: AgentRunSkillContextV1[] = [];
  for (const value of decoded) {
    const candidate = record(value);
    const entrypointIds = candidate?.entrypointWorkflowRevisionIds;
    const verifiedEntrypointIds: string[] = [];
    if (Array.isArray(entrypointIds)) {
      for (const entrypointId of entrypointIds) {
        if (typeof entrypointId === "string") {
          verifiedEntrypointIds.push(entrypointId);
        }
      }
    }
    if (
      !candidate ||
      typeof candidate.skillRevisionId !== "string" ||
      !idPattern.test(candidate.skillRevisionId) ||
      typeof candidate.canonicalDigest !== "string" ||
      !digestPattern.test(candidate.canonicalDigest) ||
      typeof candidate.instructionResourceDigest !== "string" ||
      !digestPattern.test(candidate.instructionResourceDigest) ||
      !Array.isArray(entrypointIds) ||
      entrypointIds.length > 20 ||
      verifiedEntrypointIds.length !== entrypointIds.length ||
      !verifiedEntrypointIds.every((entrypointId) =>
        idPattern.test(entrypointId),
      )
    ) {
      return invalid(
        "agent.integrity_violation",
        "Stored Agent Skill context is invalid.",
      );
    }
    skills.push(
      Object.freeze({
        skillRevisionId: candidate.skillRevisionId,
        canonicalDigest: candidate.canonicalDigest,
        instructionResourceDigest: candidate.instructionResourceDigest,
        entrypointWorkflowRevisionIds: Object.freeze(verifiedEntrypointIds),
      }),
    );
  }
  return Object.freeze(skills);
}

function foundationContext(row: AgentRunRow): AgentRunFoundationContextV1 {
  return Object.freeze({
    schemaVersion: 1,
    profileRevisionId: row.profileRevisionId,
    profileCanonicalDigest: row.profileCanonicalDigest,
    skillViewDigest: row.skillViewDigest,
    skills: skillContextSnapshot(row.skillContextSnapshot),
  });
}

function threadFrom(row: AgentThreadRow): AgentThreadRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    createdByPrincipalId: row.createdByPrincipalId,
    agentDefinitionId: row.agentDefinitionId,
    agentProfileRevisionId: row.agentProfileRevisionId,
    lifecycleStatus: row.lifecycleStatus,
    ...(row.title ? { title: row.title } : {}),
    titleSource: row.titleSource,
    ...(row.activeLeafMessageId
      ? { activeLeafMessageId: row.activeLeafMessageId }
      : {}),
    ...(row.activeRunId ? { activeRunId: row.activeRunId } : {}),
    version: row.version,
    ...(row.viewRevision !== undefined
      ? { viewRevision: Number(row.viewRevision) }
      : {}),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.archivedAt ? { archivedAt: new Date(row.archivedAt) } : {}),
  });
}

function threadSummaryFrom(
  row: AgentThreadSummaryRow,
): AgentThreadSummaryRecord {
  return Object.freeze({
    ...threadFrom(row),
    ...(row.latestRunId && row.latestRunStatus && row.latestRunUpdatedAt
      ? {
          latestRun: Object.freeze({
            id: row.latestRunId,
            lifecycleStatus: row.latestRunStatus,
            ...(row.latestRunTerminalReasonCode
              ? { terminalReasonCode: row.latestRunTerminalReasonCode }
              : {}),
            updatedAt: new Date(row.latestRunUpdatedAt),
          }),
        }
      : {}),
  });
}

function runFrom(row: AgentRunRow): AgentRunRecord {
  return Object.freeze({
    ...(row.runtimeConfigurationVersion
      ? { runtimeConfigurationVersion: row.runtimeConfigurationVersion }
      : {}),
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(row.triggerMessageId ? { triggerMessageId: row.triggerMessageId } : {}),
    actorPrincipalId: row.actorPrincipalId,
    lifecycleStatus: row.lifecycleStatus,
    contextSnapshot: contextSnapshot(row.contextSnapshot),
    toolViewDigest: row.toolViewDigest,
    promptRevision: row.promptRevision,
    maximumModelCalls: row.maximumModelCalls,
    maximumToolCalls: row.maximumToolCalls,
    foundationContext: foundationContext(row),
    version: row.version,
    executionDeadlineAt: new Date(row.executionDeadlineAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.completedAt ? { completedAt: new Date(row.completedAt) } : {}),
    ...(row.terminalReasonCode
      ? { terminalReasonCode: row.terminalReasonCode }
      : {}),
  });
}

function modelCallFrom(row: AgentModelCallRow): AgentModelCallRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    agentRunId: row.agentRunId,
    callNumber: row.callNumber,
    purpose: row.purpose,
    lifecycleStatus: row.lifecycleStatus,
    modelProfileKey: row.modelProfileKey,
    inputDigest: row.inputDigest,
    ...(row.outputDigest ? { outputDigest: row.outputDigest } : {}),
    ...(row.finishReason ? { finishReason: row.finishReason } : {}),
    ...(row.terminalReasonCode
      ? { terminalReasonCode: row.terminalReasonCode }
      : {}),
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.completedAt ? { completedAt: new Date(row.completedAt) } : {}),
  });
}

function modelAttemptFrom(row: AgentModelAttemptRow): AgentModelAttemptRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    agentModelCallId: row.agentModelCallId,
    attemptNumber: row.attemptNumber,
    transitionKind: row.transitionKind,
    lifecycleStatus: row.lifecycleStatus,
    routeSnapshot: jsonRecord(row.routeSnapshot, "Agent Model route snapshot"),
    routeDigest: row.routeDigest,
    ...(row.providerRequestId
      ? { providerRequestId: row.providerRequestId }
      : {}),
    accepted: row.acceptedMarker === 1,
    ...(row.usageDocument === null
      ? {}
      : {
          usageDocument: jsonRecord(
            row.usageDocument,
            "Agent Model usage document",
          ),
        }),
    ...(row.terminalReasonCode
      ? { terminalReasonCode: row.terminalReasonCode }
      : {}),
    createdAt: new Date(row.createdAt),
    ...(row.startedAt ? { startedAt: new Date(row.startedAt) } : {}),
    ...(row.completedAt ? { completedAt: new Date(row.completedAt) } : {}),
  });
}

function actionOutcomeReference(
  row: AgentActionReceiptRow,
): AgentActionReceiptRecord["outcomeReference"] {
  switch (row.outcomeKind) {
    case null:
      return undefined;
    case "query":
      return row.queryResultCount === null
        ? invalid(
            "agent.integrity_violation",
            "Agent query outcome is invalid.",
          )
        : Object.freeze({
            kind: "query" as const,
            resultCount: row.queryResultCount,
            ...(row.queryDiagnostics
              ? {
                  diagnostics: parseAgentDiscoveryDiagnostics(
                    row.queryDiagnostics,
                  ),
                }
              : {}),
          });
    case "canvas_command":
      return !row.canvasDraftId ||
        row.beforeVersion === null ||
        row.afterVersion === null
        ? invalid(
            "agent.integrity_violation",
            "Agent Canvas outcome is invalid.",
          )
        : Object.freeze({
            kind: "canvas_command" as const,
            canvasDraftId: row.canvasDraftId,
            beforeVersion: row.beforeVersion,
            afterVersion: row.afterVersion,
            ...(row.undoGroupId ? { undoGroupId: row.undoGroupId } : {}),
          });
    case "capability_run":
      return !row.capabilityRunId
        ? invalid(
            "agent.integrity_violation",
            "Agent Capability outcome is invalid.",
          )
        : Object.freeze({
            kind: "capability_run" as const,
            capabilityRunId: row.capabilityRunId,
          });
    case "workflow_run":
      return !row.workflowRunId
        ? invalid(
            "agent.integrity_violation",
            "Agent Workflow outcome is invalid.",
          )
        : Object.freeze({
            kind: "workflow_run" as const,
            workflowRunId: row.workflowRunId,
          });
    case "workflow_draft_command":
      return !row.workflowDefinitionId ||
        row.beforeVersion === null ||
        row.afterVersion === null
        ? invalid(
            "agent.integrity_violation",
            "Agent Workflow Draft outcome is invalid.",
          )
        : Object.freeze({
            kind: "workflow_draft_command" as const,
            workflowDefinitionId: row.workflowDefinitionId,
            beforeVersion: row.beforeVersion,
            afterVersion: row.afterVersion,
          });
    case "skill_draft":
      return !row.skillDraftId
        ? invalid(
            "agent.integrity_violation",
            "Agent Skill Draft outcome is invalid.",
          )
        : Object.freeze({
            kind: "skill_draft" as const,
            skillDraftId: row.skillDraftId,
          });
    case "brand_revision":
      return !row.brandKitId || !row.brandKitRevisionId
        ? invalid(
            "agent.integrity_violation",
            "Agent Brand Revision outcome is invalid.",
          )
        : Object.freeze({
            kind: "brand_revision" as const,
            brandKitId: row.brandKitId,
            brandKitRevisionId: row.brandKitRevisionId,
          });
    default:
      return invalid(
        "agent.integrity_violation",
        "Agent Action outcome kind is invalid.",
      );
  }
}

function actionReceiptFrom(
  row: AgentActionReceiptRow,
): AgentActionReceiptRecord {
  const outcomeReference = actionOutcomeReference(row);
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    agentRunId: row.agentRunId,
    actionNumber: row.actionNumber,
    toolCallId: row.toolCallId,
    toolKey: row.toolKey,
    effect: row.effect,
    approvalMode: row.approvalMode,
    lifecycleStatus: row.lifecycleStatus,
    inputDigest: row.inputDigest,
    ...(row.outputDigest ? { outputDigest: row.outputDigest } : {}),
    ...(row.proposalDocument === null
      ? {}
      : {
          proposalDocument: jsonRecord(
            row.proposalDocument,
            "Agent Action proposal document",
          ),
        }),
    ...(outcomeReference ? { outcomeReference } : {}),
    ...(row.terminalReasonCode
      ? { terminalReasonCode: row.terminalReasonCode }
      : {}),
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.completedAt ? { completedAt: new Date(row.completedAt) } : {}),
  });
}

function interactionFrom(row: AgentInteractionRow): AgentInteractionRecord {
  const request = jsonRecord(
    row.requestDocument,
    "Agent Interaction request document",
  );
  const checkpoint = jsonRecord(
    row.checkpointDocument,
    "Agent Interaction checkpoint document",
  );
  const response =
    row.responseDocument === null
      ? undefined
      : jsonRecord(row.responseDocument, "Agent Interaction response document");
  if (
    row.toolKey !== "builtin.ask-question" ||
    request.schemaVersion !== 1 ||
    request.kind !== "question" ||
    !Array.isArray(request.questions) ||
    (response !== undefined &&
      (response.schemaVersion !== 1 ||
        !["submitted", "skipped", "cancelled"].includes(
          String(response.outcome),
        )))
  ) {
    return invalid(
      "agent.integrity_violation",
      "Stored Agent Interaction is invalid.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    agentRunId: row.agentRunId,
    assistantMessageId: row.assistantMessageId,
    interactionNumber: row.interactionNumber,
    toolCallId: row.toolCallId,
    toolKey: row.toolKey,
    lifecycleStatus: row.lifecycleStatus,
    request: request as unknown as AgentQuestionRequestV1,
    ...(response
      ? { response: response as unknown as AgentQuestionResponseV1 }
      : {}),
    checkpoint,
    requestDigest: row.requestDigest,
    ...(row.responseDigest ? { responseDigest: row.responseDigest } : {}),
    checkpointDigest: row.checkpointDigest,
    ...(row.resolutionRequestKey
      ? { resolutionRequestKey: row.resolutionRequestKey }
      : {}),
    ...(row.resolvedByPrincipalId
      ? { resolvedByPrincipalId: row.resolvedByPrincipalId }
      : {}),
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.completedAt ? { completedAt: new Date(row.completedAt) } : {}),
  });
}

function assertStableReason(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(value)) {
    invalid("agent.invalid_argument", `${label} is invalid.`);
  }
}

function terminalModelCallStatus(
  status: "cancelled" | "failed" | "succeeded" | "unknown",
): AgentModelCallStatus {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function actionOutcomeValues(
  outcome: AgentActionReceiptRecord["outcomeReference"],
): readonly (null | number | string)[] {
  if (!outcome) {
    return [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
  }
  switch (outcome.kind) {
    case "query":
      return [
        "query",
        outcome.resultCount,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ];
    case "canvas_command":
      return [
        "canvas_command",
        null,
        outcome.canvasDraftId,
        null,
        null,
        null,
        null,
        outcome.beforeVersion,
        outcome.afterVersion,
        outcome.undoGroupId ?? null,
        null,
        null,
      ];
    case "capability_run":
      return [
        "capability_run",
        null,
        null,
        outcome.capabilityRunId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ];
    case "brand_revision":
      return [
        "brand_revision",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        outcome.brandKitId,
        outcome.brandKitRevisionId,
      ];
    case "workflow_run":
      return [
        "workflow_run",
        null,
        null,
        null,
        outcome.workflowRunId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ];
    case "workflow_draft_command":
      return [
        "workflow_draft_command",
        null,
        null,
        null,
        null,
        outcome.workflowDefinitionId,
        null,
        outcome.beforeVersion,
        outcome.afterVersion,
        null,
        null,
        null,
      ];
    case "skill_draft":
      return [
        "skill_draft",
        null,
        null,
        null,
        null,
        null,
        outcome.skillDraftId,
        null,
        null,
        null,
        null,
        null,
      ];
  }
}

function actionOutcomeMatches(
  left: AgentActionReceiptRecord["outcomeReference"],
  right: AgentActionReceiptRecord["outcomeReference"],
): boolean {
  return (
    JSON.stringify(actionOutcomeValues(left)) ===
      JSON.stringify(actionOutcomeValues(right)) &&
    digestProviderValue(
      left?.kind === "query" ? (left.diagnostics ?? null) : null,
    ) ===
      digestProviderValue(
        right?.kind === "query" ? (right.diagnostics ?? null) : null,
      )
  );
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Serialize visible mutations in thread order, then publish one durable revision. */
async function inThreadMutation<TResult>(
  pool: Pool,
  options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId?: string;
    readonly agentRunId?: string;
    readonly runId?: string;
    readonly interactionId?: string;
    readonly actionReceiptId?: string;
  },
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const workspaceId = options.authority.workspaceId;
  let kind: "thread" | "run" | "interaction" | "action" = "thread";
  let id = options.threadId;
  if (!id) {
    kind = "run";
    id = options.agentRunId ?? options.runId;
  }
  if (!id) {
    kind = "interaction";
    id = options.interactionId;
  }
  if (!id) {
    kind = "action";
    id = options.actionReceiptId;
  }
  if (!id)
    return invalid(
      "agent.invalid_argument",
      "Visible mutation has no conversation identity.",
    );
  const selector = { kind, id };
  return inTransaction(pool, async (connection) => {
    const tables = {
      thread: "agent_thread",
      run: "agent_run",
      interaction: "agent_interaction",
      action: "agent_action_receipt",
    } as const;
    const table = tables[selector.kind];
    let lookup = `SELECT thread_id AS threadId FROM ${table} WHERE workspace_id = ? AND id = ?`;
    if (selector.kind === "thread")
      lookup =
        "SELECT id AS threadId FROM agent_thread WHERE workspace_id = ? AND id = ?";
    if (selector.kind === "action" || selector.kind === "interaction")
      lookup = `SELECT run.thread_id AS threadId FROM ${table} item JOIN agent_run run ON run.workspace_id = item.workspace_id AND run.id = item.agent_run_id WHERE item.workspace_id = ? AND item.id = ?`;
    const [rows] = await connection.execute<
      (RowDataPacket & { threadId: string })[]
    >(lookup, [workspaceId, selector.id]);
    const threadId = rows[0]?.threadId;
    if (threadId)
      await connection.execute(
        "SELECT id FROM agent_thread WHERE workspace_id = ? AND id = ? FOR UPDATE",
        [workspaceId, threadId],
      );
    const result = await operation(connection);
    // A newly inserted Run is addressed by its known thread id by its caller.
    if (threadId)
      await connection.execute(
        "UPDATE agent_thread SET view_revision = view_revision + 1 WHERE workspace_id = ? AND id = ?",
        [workspaceId, threadId],
      );
    return result;
  });
}

async function readThread(
  connection: PoolConnection,
  workspaceId: string,
  selector: { readonly id?: string; readonly requestKey?: string },
  lock: boolean,
): Promise<AgentThreadRow | undefined> {
  const field = selector.id ? "id" : "creation_request_key";
  const value = selector.id ?? selector.requestKey;
  if (!value) {
    return invalid("agent.invalid_argument", "Agent Thread selector is empty.");
  }
  const [rows] = await connection.execute<AgentThreadRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       created_by_principal_id AS createdByPrincipalId,
       agent_definition_id AS agentDefinitionId,
       agent_profile_revision_id AS agentProfileRevisionId,
       lifecycle_status AS lifecycleStatus,
       title,
       title_source AS titleSource,
       active_leaf_message_id AS activeLeafMessageId,
       active_run_id AS activeRunId,
       creation_request_key AS creationRequestKey,
       creation_request_hash AS creationRequestHash,
       version, view_revision AS viewRevision,
       created_at AS createdAt,
       updated_at AS updatedAt,
       archived_at AS archivedAt
     FROM agent_thread
     WHERE workspace_id = ?
       AND ${field} = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, value],
  );
  return rows[0];
}

async function readRun(
  connection: PoolConnection,
  workspaceId: string,
  selector: {
    readonly id?: string;
    readonly idempotencyKey?: string;
    readonly threadId?: string;
  },
  lock = false,
): Promise<AgentRunRow | undefined> {
  let field = "run.thread_id";
  if (selector.id) {
    field = "run.id";
  } else if (selector.idempotencyKey) {
    field = "run.idempotency_key";
  }
  const value = selector.id ?? selector.idempotencyKey ?? selector.threadId;
  if (!value) {
    return invalid("agent.invalid_argument", "Agent Run selector is empty.");
  }
  const [rows] = await connection.execute<AgentRunRow[]>(
    `SELECT
       run.id,
       run.workspace_id AS workspaceId,
       run.thread_id AS threadId,
       run.parent_run_id AS parentRunId,
       run.trigger_message_id AS triggerMessageId,
       run.actor_principal_id AS actorPrincipalId,
       run.lifecycle_status AS lifecycleStatus,
       run.context_snapshot AS contextSnapshot,
       run.context_digest AS contextDigest,
       run.tool_view_digest AS toolViewDigest,
       run.prompt_revision AS promptRevision,
       run.runtime_configuration_version AS runtimeConfigurationVersion,
       run.runtime_timeout_seconds AS runtimeTimeoutSeconds,
       run.maximum_model_calls AS maximumModelCalls,
       run.maximum_tool_calls AS maximumToolCalls,
       run.idempotency_key AS idempotencyKey,
       run.request_hash AS requestHash,
       run.terminal_reason_code AS terminalReasonCode,
       run.version,
       run.execution_deadline_at AS executionDeadlineAt,
       run.created_at AS createdAt,
       run.updated_at AS updatedAt,
       run.completed_at AS completedAt,
       foundation.profile_revision_id AS profileRevisionId,
       foundation.profile_canonical_digest AS profileCanonicalDigest,
       foundation.skill_view_digest AS skillViewDigest,
       foundation.skill_context_snapshot AS skillContextSnapshot
     FROM agent_run AS run
     INNER JOIN agent_run_foundation_context AS foundation
       ON foundation.workspace_id = run.workspace_id
      AND foundation.agent_run_id = run.id
     WHERE run.workspace_id = ?
       AND ${field} = ?
     ${selector.threadId ? "ORDER BY run.created_at DESC, run.id DESC" : ""}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, value],
  );
  return rows[0];
}

async function readModelCall(
  connection: PoolConnection,
  workspaceId: string,
  selector: {
    readonly id?: string;
    readonly agentRunId?: string;
    readonly callNumber?: number;
  },
  lock: boolean,
): Promise<AgentModelCallRow | undefined> {
  const byId = selector.id !== undefined;
  if (!byId && (!selector.agentRunId || selector.callNumber === undefined)) {
    return invalid(
      "agent.invalid_argument",
      "Agent Model Call selector is empty.",
    );
  }
  const where = byId ? "id = ?" : "agent_run_id = ? AND call_number = ?";
  const values: (number | string)[] = [workspaceId];
  if (byId) {
    values.push(
      selector.id ?? invalid("agent.invalid_argument", "id is empty."),
    );
  } else {
    values.push(
      selector.agentRunId ??
        invalid("agent.invalid_argument", "agentRunId is empty."),
      selector.callNumber ??
        invalid("agent.invalid_argument", "callNumber is empty."),
    );
  }
  const [rows] = await connection.execute<AgentModelCallRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       agent_run_id AS agentRunId,
       call_number AS callNumber,
       purpose,
       lifecycle_status AS lifecycleStatus,
       model_profile_key AS modelProfileKey,
       input_digest AS inputDigest,
       output_digest AS outputDigest,
       finish_reason AS finishReason,
       terminal_reason_code AS terminalReasonCode,
       version,
       created_at AS createdAt,
       updated_at AS updatedAt,
       completed_at AS completedAt
     FROM agent_model_call
     WHERE workspace_id = ?
       AND ${where}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  return rows[0];
}

async function readModelAttempt(
  connection: PoolConnection,
  workspaceId: string,
  selector: {
    readonly id?: string;
    readonly modelCallId?: string;
    readonly attemptNumber?: number;
  },
  lock: boolean,
): Promise<AgentModelAttemptRow | undefined> {
  const byId = selector.id !== undefined;
  if (
    !byId &&
    (!selector.modelCallId || selector.attemptNumber === undefined)
  ) {
    return invalid(
      "agent.invalid_argument",
      "Agent Model Attempt selector is empty.",
    );
  }
  const where = byId
    ? "id = ?"
    : "agent_model_call_id = ? AND attempt_number = ?";
  const values: (number | string)[] = [workspaceId];
  if (byId) {
    values.push(
      selector.id ?? invalid("agent.invalid_argument", "id is empty."),
    );
  } else {
    values.push(
      selector.modelCallId ??
        invalid("agent.invalid_argument", "modelCallId is empty."),
      selector.attemptNumber ??
        invalid("agent.invalid_argument", "attemptNumber is empty."),
    );
  }
  const [rows] = await connection.execute<AgentModelAttemptRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       agent_model_call_id AS agentModelCallId,
       attempt_number AS attemptNumber,
       transition_kind AS transitionKind,
       lifecycle_status AS lifecycleStatus,
       route_snapshot AS routeSnapshot,
       route_digest AS routeDigest,
       provider_request_id AS providerRequestId,
       accepted_marker AS acceptedMarker,
       usage_document AS usageDocument,
       usage_digest AS usageDigest,
       terminal_reason_code AS terminalReasonCode,
       created_at AS createdAt,
       started_at AS startedAt,
       completed_at AS completedAt
     FROM agent_model_attempt
     WHERE workspace_id = ?
       AND ${where}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  return rows[0];
}

async function readActionReceipt(
  connection: PoolConnection,
  workspaceId: string,
  selector: {
    readonly id?: string;
    readonly agentRunId?: string;
    readonly actionNumber?: number;
  },
  lock: boolean,
): Promise<AgentActionReceiptRow | undefined> {
  const byId = selector.id !== undefined;
  if (!byId && (!selector.agentRunId || selector.actionNumber === undefined)) {
    return invalid("agent.invalid_argument", "Agent Action selector is empty.");
  }
  const where = byId ? "id = ?" : "agent_run_id = ? AND action_number = ?";
  const values: (number | string)[] = [workspaceId];
  if (byId) {
    values.push(
      selector.id ?? invalid("agent.invalid_argument", "id is empty."),
    );
  } else {
    values.push(
      selector.agentRunId ??
        invalid("agent.invalid_argument", "agentRunId is empty."),
      selector.actionNumber ??
        invalid("agent.invalid_argument", "actionNumber is empty."),
    );
  }
  const [rows] = await connection.execute<AgentActionReceiptRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       agent_run_id AS agentRunId,
       action_number AS actionNumber,
       tool_call_id AS toolCallId,
       tool_key AS toolKey,
       effect,
       approval_mode AS approvalMode,
       lifecycle_status AS lifecycleStatus,
       input_digest AS inputDigest,
       output_digest AS outputDigest,
       proposal_document AS proposalDocument,
       outcome_kind AS outcomeKind,
       query_result_count AS queryResultCount, query_diagnostics AS queryDiagnostics,
       canvas_draft_id AS canvasDraftId,
       capability_run_id AS capabilityRunId,
       workflow_run_id AS workflowRunId,
       workflow_definition_id AS workflowDefinitionId,
       skill_draft_id AS skillDraftId,
       brand_kit_id AS brandKitId,
       brand_kit_revision_id AS brandKitRevisionId,
       before_version AS beforeVersion,
       after_version AS afterVersion,
       undo_group_id AS undoGroupId,
       terminal_reason_code AS terminalReasonCode,
       version,
       created_at AS createdAt,
       updated_at AS updatedAt,
       completed_at AS completedAt
     FROM agent_action_receipt
     WHERE workspace_id = ? AND ${where}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  return rows[0];
}

async function readInteraction(
  connection: PoolConnection,
  workspaceId: string,
  interactionId: string,
  lock: boolean,
): Promise<AgentInteractionRow | undefined> {
  const [rows] = await connection.execute<AgentInteractionRow[]>(
    `SELECT
       interaction.id,
       interaction.workspace_id AS workspaceId,
       run.thread_id AS threadId,
       interaction.agent_run_id AS agentRunId,
       interaction.assistant_message_id AS assistantMessageId,
       interaction.interaction_number AS interactionNumber,
       interaction.tool_call_id AS toolCallId,
       interaction.tool_key AS toolKey,
       interaction.lifecycle_status AS lifecycleStatus,
       interaction.request_document AS requestDocument,
       interaction.request_digest AS requestDigest,
       interaction.response_document AS responseDocument,
       interaction.response_digest AS responseDigest,
       interaction.checkpoint_document AS checkpointDocument,
       interaction.checkpoint_digest AS checkpointDigest,
       interaction.resolution_request_key AS resolutionRequestKey,
       interaction.resolved_by_principal_id AS resolvedByPrincipalId,
       interaction.version,
       interaction.created_at AS createdAt,
       interaction.updated_at AS updatedAt,
       interaction.completed_at AS completedAt
     FROM agent_interaction AS interaction
     INNER JOIN agent_run AS run
       ON run.workspace_id = interaction.workspace_id
      AND run.id = interaction.agent_run_id
     WHERE interaction.workspace_id = ? AND interaction.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, interactionId],
  );
  return rows[0];
}

async function requireOwnedThread(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  threadId: string,
): Promise<AgentThreadRow> {
  const thread = await readThread(
    connection,
    authority.workspaceId,
    { id: threadId },
    true,
  );
  if (!thread) {
    return invalid("agent.thread_not_found", "Agent Thread was not found.");
  }
  if (thread.createdByPrincipalId !== authority.principalId) {
    return invalid(
      "agent.thread_forbidden",
      "Agent Thread belongs to another principal.",
    );
  }
  if (thread.lifecycleStatus !== "active") {
    return invalid("agent.thread_inactive", "Agent Thread is not active.");
  }
  return thread;
}

async function requireOwnedRun(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  runId: string,
  lock: boolean,
): Promise<AgentRunRow> {
  const run = await readRun(
    connection,
    authority.workspaceId,
    { id: runId },
    lock,
  );
  if (!run) {
    return invalid("agent.run_not_found", "Agent Run was not found.");
  }
  if (run.actorPrincipalId !== authority.principalId) {
    return invalid(
      "agent.thread_forbidden",
      "Agent Run belongs to another principal.",
    );
  }
  await requireOwnedThread(connection, authority, run.threadId);
  return run;
}

export function createAgentRuntimeStore(
  pool: Pool,
  governance?: { readonly instanceId: string },
): AgentRuntimeRepository {
  async function admission(
    connection: PoolConnection,
    defaults: {
      maximumModelCalls: number;
      maximumToolCalls: number;
      executionDeadlineAt: Date;
    },
    now: Date,
  ) {
    const snapshot = await createRuntimeConfigurationReader(() =>
      governance
        ? readRuntimeConfiguration(connection, governance.instanceId)
        : Promise.resolve(null),
    ).read();
    const setting = snapshot.agentLimits({
      maximumModelCalls: defaults.maximumModelCalls,
      maximumToolCalls: defaults.maximumToolCalls,
      timeoutSeconds:
        (defaults.executionDeadlineAt.getTime() - now.getTime()) / 1000,
    });
    if (setting.source === "profile")
      return {
        ...defaults,
        runtimeConfigurationVersion: undefined,
        runtimeTimeoutSeconds: undefined,
      };
    return {
      maximumModelCalls: setting.value.maximumModelCalls,
      maximumToolCalls: setting.value.maximumToolCalls,
      executionDeadlineAt: new Date(
        now.getTime() + setting.value.timeoutSeconds * 1000,
      ),
      runtimeConfigurationVersion: setting.version ?? undefined,
      runtimeTimeoutSeconds: setting.value.timeoutSeconds,
    };
  }

  async function saveConfigurationVersion(
    connection: PoolConnection,
    runId: string,
    version: number | undefined,
    timeoutSeconds: number | undefined,
  ) {
    if (version !== undefined) {
      if (timeoutSeconds === undefined)
        throw new RuntimeConfigurationError(
          "runtime_configuration.unavailable",
          "Run timeout snapshot is missing.",
        );
      await connection.execute(
        "UPDATE agent_run SET runtime_configuration_version = ?, runtime_timeout_seconds = ? WHERE id = ?",
        [version, timeoutSeconds, runId],
      );
    }
  }
  return Object.freeze({
    async createThread(
      options: CreateAgentThreadOptions,
    ): Promise<AgentThreadRecord> {
      assertId(options.threadId, "threadId");
      assertId(options.agentDefinitionId, "agentDefinitionId");
      assertId(options.agentProfileRevisionId, "agentProfileRevisionId");
      assertIdempotencyKey(options.idempotencyKey);
      const title = boundedTitle(options.title);
      const requestHash = digestProviderValue({
        principalId: options.authority.principalId,
        agentDefinitionId: options.agentDefinitionId,
        agentProfileRevisionId: options.agentProfileRevisionId,
        ...(title ? { title } : {}),
      });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const replay = await readThread(
          connection,
          options.authority.workspaceId,
          { requestKey: options.idempotencyKey },
          true,
        );
        if (replay) {
          if (replay.creationRequestHash !== requestHash) {
            return invalid(
              "agent.identity_conflict",
              "Agent Thread idempotency key was reused with different input.",
            );
          }
          return threadFrom(replay);
        }
        await assertResourceAdmission(
          connection,
          options.authority.workspaceId,
          options.agentDefinitionId,
        );
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_thread (
             id,
             workspace_id,
             created_by_principal_id,
             agent_definition_id,
             agent_profile_revision_id,
             lifecycle_status,
             title,
             title_source,
             active_leaf_message_id,
             creation_request_key,
             creation_request_hash,
             version,
             created_at,
             updated_at,
             archived_at
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, 'auto', NULL, ?, ?, 1, ?, ?, NULL)`,
          [
            options.threadId,
            options.authority.workspaceId,
            options.authority.principalId,
            options.agentDefinitionId,
            options.agentProfileRevisionId,
            title ?? null,
            options.idempotencyKey,
            requestHash,
            options.now,
            options.now,
          ],
        );
        if (inserted.affectedRows !== 1) {
          return invalid(
            "agent.identity_conflict",
            "Agent Thread could not be created.",
          );
        }
        return Object.freeze({
          id: options.threadId,
          workspaceId: options.authority.workspaceId,
          createdByPrincipalId: options.authority.principalId,
          agentDefinitionId: options.agentDefinitionId,
          agentProfileRevisionId: options.agentProfileRevisionId,
          lifecycleStatus: "active",
          ...(title ? { title } : {}),
          titleSource: "auto",
          version: 1,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async renameThread(
      options: RenameAgentThreadOptions,
    ): Promise<AgentThreadRecord> {
      assertId(options.threadId, "threadId");
      const title = boundedTitle(options.title);
      if (!title) {
        return invalid(
          "agent.invalid_argument",
          "Agent Thread title is required.",
        );
      }
      if (!Number.isSafeInteger(options.expectedVersion)) {
        return invalid("agent.invalid_argument", "Thread version is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (thread.version !== options.expectedVersion) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
           SET title = ?, title_source = 'manual',
               version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            title,
            options.now,
            options.authority.workspaceId,
            options.threadId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const renamed = await readThread(
          connection,
          options.authority.workspaceId,
          { id: options.threadId },
          false,
        );
        if (!renamed) {
          return invalid(
            "agent.thread_not_found",
            "Agent Thread was not found.",
          );
        }
        return threadFrom(renamed);
      });
    },

    async autoRenameThread(
      options: AutoRenameAgentThreadOptions,
    ): Promise<AgentThreadRecord> {
      assertId(options.threadId, "threadId");
      const title = boundedTitle(options.title);
      if (!title) {
        return invalid(
          "agent.invalid_argument",
          "Agent Thread title is required.",
        );
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (thread.titleSource === "manual") return threadFrom(thread);
        await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
              SET title = ?, version = version + 1, updated_at = ?
            WHERE workspace_id = ? AND id = ? AND title_source = 'auto'`,
          [title, options.now, options.authority.workspaceId, options.threadId],
        );
        const renamed = await readThread(
          connection,
          options.authority.workspaceId,
          { id: options.threadId },
          false,
        );
        if (!renamed) {
          return invalid(
            "agent.thread_not_found",
            "Agent Thread was not found.",
          );
        }
        return threadFrom(renamed);
      });
    },

    async archiveThread(
      options: ArchiveAgentThreadOptions,
    ): Promise<AgentThreadRecord> {
      assertId(options.threadId, "threadId");
      if (!Number.isSafeInteger(options.expectedVersion)) {
        return invalid("agent.invalid_argument", "Thread version is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (thread.version !== options.expectedVersion) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const [activeRuns] = await connection.execute<RowDataPacket[]>(
          `SELECT id
           FROM agent_run
           WHERE workspace_id = ? AND thread_id = ?
             AND lifecycle_status IN (
               'queued', 'running', 'waiting_approval', 'waiting_for_user'
             )
           LIMIT 1`,
          [options.authority.workspaceId, options.threadId],
        );
        if (activeRuns.length > 0) {
          return invalid(
            "agent.run_active",
            "Agent Thread still has work requiring attention.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
           SET lifecycle_status = 'archived', archived_at = ?,
               version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.now,
            options.now,
            options.authority.workspaceId,
            options.threadId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const archived = await readThread(
          connection,
          options.authority.workspaceId,
          { id: options.threadId },
          false,
        );
        if (!archived) {
          return invalid(
            "agent.thread_not_found",
            "Agent Thread was not found.",
          );
        }
        return threadFrom(archived);
      });
    },

    async listThreads(
      options: ListAgentThreadsOptions,
    ): Promise<AgentThreadListResult> {
      if (
        !Number.isSafeInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 50
      ) {
        invalid("agent.invalid_argument", "Thread limit is invalid.");
      }
      if (options.cursor) {
        assertId(options.cursor.id, "cursor.id");
        if (!Number.isFinite(options.cursor.updatedAt.getTime())) {
          invalid("agent.invalid_argument", "Thread cursor is invalid.");
        }
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const parameters: (Date | string)[] = [
          options.authority.workspaceId,
          options.authority.principalId,
        ];
        const cursorCondition = options.cursor
          ? "AND (thread.updated_at < ? OR (thread.updated_at = ? AND thread.id < ?))"
          : "";
        if (options.cursor) {
          parameters.push(
            options.cursor.updatedAt,
            options.cursor.updatedAt,
            options.cursor.id,
          );
        }
        const [rows] = await connection.execute<AgentThreadSummaryRow[]>(
          `SELECT
             thread.id,
             thread.workspace_id AS workspaceId,
             thread.created_by_principal_id AS createdByPrincipalId,
             thread.agent_definition_id AS agentDefinitionId,
             thread.agent_profile_revision_id AS agentProfileRevisionId,
             thread.lifecycle_status AS lifecycleStatus,
             thread.title,
             thread.title_source AS titleSource,
             thread.active_leaf_message_id AS activeLeafMessageId,
             thread.active_run_id AS activeRunId,
             thread.creation_request_key AS creationRequestKey,
             thread.creation_request_hash AS creationRequestHash,
             thread.version,
             thread.created_at AS createdAt,
             thread.updated_at AS updatedAt,
             thread.archived_at AS archivedAt,
             latest_run.id AS latestRunId,
             latest_run.lifecycle_status AS latestRunStatus,
             latest_run.terminal_reason_code AS latestRunTerminalReasonCode,
             latest_run.updated_at AS latestRunUpdatedAt
           FROM agent_thread AS thread
           LEFT JOIN agent_run AS latest_run
             ON latest_run.workspace_id = thread.workspace_id
            AND latest_run.id = thread.active_run_id
           WHERE thread.workspace_id = ?
             AND thread.created_by_principal_id = ?
             AND thread.lifecycle_status = 'active'
             ${cursorCondition}
           ORDER BY thread.updated_at DESC, thread.id DESC
           LIMIT ${String(options.limit + 1)}`,
          parameters,
        );
        const visibleRows = rows.slice(0, options.limit);
        const last = visibleRows.at(-1);
        return Object.freeze({
          items: Object.freeze(visibleRows.map(threadSummaryFrom)),
          ...(rows.length > options.limit && last
            ? {
                nextCursor: Object.freeze({
                  updatedAt: new Date(last.updatedAt),
                  id: last.id,
                }),
              }
            : {}),
        });
      });
    },

    async getThread(
      authority: TrustedWorkspaceScope,
      threadId: string,
      now: Date,
    ): Promise<AgentThreadRecord | undefined> {
      assertId(threadId, "threadId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const thread = await readThread(
          connection,
          authority.workspaceId,
          { id: threadId },
          false,
        );
        if (!thread) return undefined;
        if (thread.createdByPrincipalId !== authority.principalId) {
          return invalid(
            "agent.thread_forbidden",
            "Agent Thread belongs to another principal.",
          );
        }
        return threadFrom(thread);
      });
    },

    async getThreadMemory(
      authority: TrustedWorkspaceScope,
      threadId: string,
      now: Date,
    ): Promise<AgentThreadMemoryRecord | undefined> {
      assertId(threadId, "threadId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedThread(connection, authority, threadId);
        const [rows] = await connection.execute<AgentThreadMemoryRow[]>(
          `SELECT thread_id AS threadId,
                  active_observations AS activeObservations,
                  observations_digest AS observationsDigest,
                  source_message_id AS sourceMessageId,
                  last_observed_at AS lastObservedAt,
                  observer_model_binding_key AS observerModelBindingKey,
                  version, updated_at AS updatedAt
             FROM agent_thread_memory
            WHERE workspace_id = ? AND thread_id = ?
            LIMIT 1`,
          [authority.workspaceId, threadId],
        );
        const row = rows[0];
        if (!row) return undefined;
        if (
          digestProviderValue(row.activeObservations) !== row.observationsDigest
        ) {
          return invalid(
            "agent.integrity_violation",
            "Agent Thread memory differs from its digest.",
          );
        }
        return threadMemoryFrom(row);
      });
    },

    async saveThreadMemory(
      options: SaveAgentThreadMemoryOptions,
    ): Promise<AgentThreadMemoryRecord> {
      assertId(options.threadId, "threadId");
      if (Boolean(options.agentRunId) !== Boolean(options.workerClaim)) {
        return invalid(
          "agent.invalid_argument",
          "Memory publication requires both Run and worker claim.",
        );
      }
      if (options.agentRunId) assertId(options.agentRunId, "agentRunId");
      if (options.sourceMessageId)
        assertId(options.sourceMessageId, "sourceMessageId");
      if (
        !options.activeObservations.trim() ||
        options.activeObservations.length > 4_000_000 ||
        !digestPattern.test(options.observationsDigest) ||
        digestProviderValue(options.activeObservations) !==
          options.observationsDigest ||
        !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(options.observerModelBindingKey) ||
        options.lastObservedAt.getTime() > options.now.getTime()
      ) {
        return invalid("agent.invalid_argument", "Thread memory is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (options.agentRunId && options.workerClaim) {
          const run = await requireOwnedRun(
            connection,
            options.authority,
            options.agentRunId,
            true,
          );
          if (
            run.threadId !== options.threadId ||
            !(await agentModelCallAdmitted(connection, {
              ...options,
              agentRunId: options.agentRunId,
              workspaceId: options.authority.workspaceId,
              purpose: "memory_observation",
              lifecycleStatus: run.lifecycleStatus,
              executionDeadlineAt: run.executionDeadlineAt,
              lockLease: true,
            }))
          ) {
            return invalid(
              "agent.run_inactive",
              "Memory publication lost its Run or worker lease.",
            );
          }
        }
        if (options.sourceMessageId) {
          const [sourceRows] = await connection.execute<RowDataPacket[]>(
            "SELECT id FROM agent_message WHERE workspace_id = ? AND thread_id = ? AND id = ? AND created_at <= ?",
            [
              options.authority.workspaceId,
              options.threadId,
              options.sourceMessageId,
              options.lastObservedAt,
            ],
          );
          if (!sourceRows[0])
            return invalid(
              "agent.invalid_argument",
              "Memory source message is outside its observed Thread.",
            );
        }
        const [existingRows] = await connection.execute<AgentThreadMemoryRow[]>(
          `SELECT thread_id AS threadId,
                  active_observations AS activeObservations,
                  observations_digest AS observationsDigest,
                  source_message_id AS sourceMessageId,
                  last_observed_at AS lastObservedAt,
                  observer_model_binding_key AS observerModelBindingKey,
                  version, updated_at AS updatedAt
             FROM agent_thread_memory
            WHERE workspace_id = ? AND thread_id = ?
            LIMIT 1 FOR UPDATE`,
          [options.authority.workspaceId, options.threadId],
        );
        const existing = existingRows[0];
        if (
          existing &&
          existing.lastObservedAt.getTime() > options.lastObservedAt.getTime()
        ) {
          return threadMemoryFrom(existing);
        }
        await connection.execute(
          `INSERT INTO agent_thread_memory (
             workspace_id, thread_id, active_observations,
             observations_digest, source_message_id, last_observed_at,
             observer_model_binding_key, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON DUPLICATE KEY UPDATE
             active_observations = VALUES(active_observations),
             observations_digest = VALUES(observations_digest),
             source_message_id = VALUES(source_message_id),
             last_observed_at = VALUES(last_observed_at),
             observer_model_binding_key = VALUES(observer_model_binding_key),
             version = version + 1,
             updated_at = VALUES(updated_at)`,
          [
            options.authority.workspaceId,
            options.threadId,
            options.activeObservations,
            options.observationsDigest,
            options.sourceMessageId ?? null,
            options.lastObservedAt,
            options.observerModelBindingKey,
            options.now,
            options.now,
          ],
        );
        const [rows] = await connection.execute<AgentThreadMemoryRow[]>(
          `SELECT thread_id AS threadId,
                  active_observations AS activeObservations,
                  observations_digest AS observationsDigest,
                  source_message_id AS sourceMessageId,
                  last_observed_at AS lastObservedAt,
                  observer_model_binding_key AS observerModelBindingKey,
                  version, updated_at AS updatedAt
             FROM agent_thread_memory
            WHERE workspace_id = ? AND thread_id = ?
            LIMIT 1`,
          [options.authority.workspaceId, options.threadId],
        );
        const row = rows[0];
        if (!row) {
          return invalid(
            "agent.integrity_violation",
            "Agent Thread memory could not be reloaded.",
          );
        }
        return threadMemoryFrom(row);
      });
    },

    async startRun(options: StartAgentRunOptions): Promise<AgentRunRecord> {
      assertIdempotencyKey(options.idempotencyKey);
      assertStartRun(options);
      const contextDigest = digestProviderValue(options.contextSnapshot);
      const messageDigest = digestProviderValue(options.userMessage);
      const requestHash = digestProviderValue({
        threadId: options.threadId,
        actorPrincipalId: options.authority.principalId,
        contextDigest,
        toolViewDigest: options.toolViewDigest,
        promptRevision: options.promptRevision,
        maximumModelCalls: options.maximumModelCalls,
        maximumToolCalls: options.maximumToolCalls,
        foundationContext: options.foundationContext,
        userMessageId: options.userMessageId,
        ...(options.parentMessageId
          ? { parentMessageId: options.parentMessageId }
          : {}),
        messageDigest,
      });
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const replay = await readRun(
          connection,
          options.authority.workspaceId,
          {
            idempotencyKey: options.idempotencyKey,
          },
        );
        if (replay) {
          if (replay.requestHash !== requestHash) {
            return invalid(
              "agent.identity_conflict",
              "Agent Run idempotency key was reused with different input.",
            );
          }
          return runFrom(replay);
        }
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (
          thread.agentProfileRevisionId !==
          options.foundationContext.profileRevisionId
        ) {
          return invalid(
            "agent.profile_conflict",
            "This conversation is pinned to another Agent version.",
          );
        }
        await assertResourceAdmission(
          connection,
          options.authority.workspaceId,
          thread.agentDefinitionId,
          options.foundationContext.skills.map(
            (skill) => skill.skillRevisionId,
          ),
        );
        const parentMessageId =
          options.parentMessageId ?? thread.activeLeafMessageId ?? null;
        const [activeRuns] = await connection.execute<AgentRunRow[]>(
          `SELECT id
             FROM agent_run
             WHERE workspace_id = ?
               AND thread_id = ?
               AND lifecycle_status IN (
                 'queued', 'running', 'waiting_approval', 'waiting_for_user'
               )
             LIMIT 1`,
          [options.authority.workspaceId, options.threadId],
        );
        if (activeRuns[0]) {
          return invalid(
            "agent.run_active",
            "Agent Thread already has an active run.",
          );
        }
        const [sequences] = await connection.execute<MessageSequenceRow[]>(
          `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS nextSequence
             FROM agent_message
             WHERE workspace_id = ?
               AND thread_id = ?`,
          [options.authority.workspaceId, options.threadId],
        );
        const nextSequence = sequences[0]?.nextSequence ?? 1;
        const limits = await admission(connection, options, options.now);
        const [runInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run (
             id,
             workspace_id,
             thread_id,
             parent_run_id,
             trigger_message_id,
             actor_principal_id,
             lifecycle_status,
             context_snapshot,
             context_digest,
             tool_view_digest,
             prompt_revision,
             maximum_model_calls,
             maximum_tool_calls,
             idempotency_key,
             request_hash,
             terminal_reason_code,
             version,
             execution_deadline_at,
             created_at,
             updated_at,
             completed_at
           ) VALUES (?, ?, ?, NULL, NULL, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, NULL)`,
          [
            options.runId,
            options.authority.workspaceId,
            options.threadId,
            options.authority.principalId,
            JSON.stringify(options.contextSnapshot),
            contextDigest,
            options.toolViewDigest,
            options.promptRevision,
            limits.maximumModelCalls,
            limits.maximumToolCalls,
            options.idempotencyKey,
            requestHash,
            limits.executionDeadlineAt,
            options.now,
            options.now,
          ],
        );
        await pinAgentLibrariesInTransaction(connection, {
          authority: options.authority,
          runId: options.runId,
          libraryIds: options.contextSnapshot.selectedLibraryIds ?? [],
          source: "explicit",
          now: options.now,
        });
        await saveConfigurationVersion(
          connection,
          options.runId,
          limits.runtimeConfigurationVersion,
          limits.runtimeTimeoutSeconds,
        );
        const [messageInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_message (
             id,
             workspace_id,
             thread_id,
             agent_run_id,
             parent_message_id,
             sequence_number,
             alternative_index,
             role,
             content,
             content_digest,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, 'user', ?, ?, ?)`,
          [
            options.userMessageId,
            options.authority.workspaceId,
            options.threadId,
            options.runId,
            parentMessageId,
            nextSequence,
            JSON.stringify(options.userMessage),
            messageDigest,
            options.now,
          ],
        );
        const [dispatchInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run_dispatch (
             workspace_id, agent_run_id, delivery_status, available_at,
             claim_owner, claim_token_digest, lease_expires_at,
             delivery_count, last_error_code, version, created_at,
             updated_at, completed_at
           ) VALUES (?, ?, 'queued', ?, NULL, NULL, NULL, 0, NULL, 1, ?, ?, NULL)`,
          [
            options.authority.workspaceId,
            options.runId,
            options.now,
            options.now,
            options.now,
          ],
        );
        const [runTriggerUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run SET trigger_message_id = ?
            WHERE workspace_id = ? AND id = ? AND trigger_message_id IS NULL`,
          [options.userMessageId, options.authority.workspaceId, options.runId],
        );
        const [foundationInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run_foundation_context (
             workspace_id,
             agent_run_id,
             profile_revision_id,
             profile_canonical_digest,
             skill_view_digest,
             skill_context_snapshot,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            options.authority.workspaceId,
            options.runId,
            options.foundationContext.profileRevisionId,
            options.foundationContext.profileCanonicalDigest,
            options.foundationContext.skillViewDigest,
            JSON.stringify(options.foundationContext.skills),
            options.now,
          ],
        );
        const [threadUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
             SET active_leaf_message_id = ?,
                 active_run_id = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = 'active'`,
          [
            options.userMessageId,
            options.runId,
            options.now,
            options.authority.workspaceId,
            options.threadId,
            thread.version,
          ],
        );
        if (
          runInsert.affectedRows !== 1 ||
          messageInsert.affectedRows !== 1 ||
          runTriggerUpdate.affectedRows !== 1 ||
          dispatchInsert.affectedRows !== 1 ||
          foundationInsert.affectedRows !== 1 ||
          threadUpdate.affectedRows !== 1
        ) {
          return invalid(
            "agent.identity_conflict",
            "Agent Run could not be created atomically.",
          );
        }
        return Object.freeze({
          id: options.runId,
          workspaceId: options.authority.workspaceId,
          threadId: options.threadId,
          triggerMessageId: options.userMessageId,
          actorPrincipalId: options.authority.principalId,
          lifecycleStatus: "queued",
          contextSnapshot: options.contextSnapshot,
          toolViewDigest: options.toolViewDigest,
          promptRevision: options.promptRevision,
          maximumModelCalls: limits.maximumModelCalls,
          ...(limits.runtimeConfigurationVersion
            ? {
                runtimeConfigurationVersion: limits.runtimeConfigurationVersion,
              }
            : {}),
          maximumToolCalls: limits.maximumToolCalls,
          foundationContext: options.foundationContext,
          version: 1,
          executionDeadlineAt: new Date(limits.executionDeadlineAt),
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async recordSkillUse(
      options: RecordAgentRunSkillUseOptions,
    ): Promise<void> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.skillRevisionId, "skillRevisionId");
      assertDigest(options.canonicalDigest, "canonicalDigest");
      if (
        !(["bound", "explicit", "discovered"] as const).includes(options.source)
      ) {
        invalid("agent.invalid_argument", "Agent Skill use source is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "skill.use",
          options.now,
        );
        await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run_skill_use (
             workspace_id, agent_run_id, skill_revision_id,
             canonical_digest, source, first_used_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             skill_revision_id = VALUES(skill_revision_id)`,
          [
            options.authority.workspaceId,
            options.agentRunId,
            options.skillRevisionId,
            options.canonicalDigest,
            options.source,
            options.now,
          ],
        );
        const [rows] = await connection.execute<
          (RowDataPacket & {
            readonly canonicalDigest: string;
            readonly source: string;
          })[]
        >(
          `SELECT canonical_digest AS canonicalDigest, source
           FROM agent_run_skill_use
           WHERE workspace_id = ? AND agent_run_id = ?
             AND skill_revision_id = ?
           LIMIT 1`,
          [
            options.authority.workspaceId,
            options.agentRunId,
            options.skillRevisionId,
          ],
        );
        const use = rows[0];
        if (
          !use ||
          use.canonicalDigest !== options.canonicalDigest ||
          use.source !== options.source
        ) {
          invalid(
            "agent.integrity_violation",
            "Agent Skill use differs from its first recorded fact.",
          );
        }
      });
    },

    async regenerateRun(
      options: RegenerateAgentRunOptions,
    ): Promise<AgentRunRecord> {
      assertId(options.runId, "runId");
      assertId(options.threadId, "threadId");
      if (
        Boolean(options.sourceAssistantMessageId) ===
        Boolean(options.sourceRunId)
      ) {
        return invalid(
          "agent.invalid_argument",
          "Agent regeneration requires exactly one source.",
        );
      }
      if (options.sourceAssistantMessageId) {
        assertId(options.sourceAssistantMessageId, "sourceAssistantMessageId");
      }
      if (options.sourceRunId) assertId(options.sourceRunId, "sourceRunId");
      assertIdempotencyKey(options.idempotencyKey);
      const requestHash = digestProviderValue({
        threadId: options.threadId,
        sourceAssistantMessageId: options.sourceAssistantMessageId ?? null,
        sourceRunId: options.sourceRunId ?? null,
      });
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const replay = await readRun(
          connection,
          options.authority.workspaceId,
          { idempotencyKey: options.idempotencyKey },
        );
        if (replay) {
          if (replay.requestHash !== requestHash) {
            return invalid(
              "agent.identity_conflict",
              "Agent response branch identity conflicts.",
            );
          }
          return runFrom(replay);
        }
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        let sourceRun: AgentRunRow;
        let triggerMessageId: string;
        if (options.sourceAssistantMessageId) {
          const [messages] = await connection.execute<AgentMessageRow[]>(
            `SELECT id, workspace_id AS workspaceId, thread_id AS threadId,
                    agent_run_id AS agentRunId,
                    parent_message_id AS parentMessageId,
                    sequence_number AS sequenceNumber,
                    alternative_index AS alternativeIndex,
                    1 AS alternativeCount, content,
                    created_at AS createdAt
               FROM agent_message
              WHERE workspace_id = ? AND thread_id = ? AND id = ?
                AND role = 'assistant'
              LIMIT 1 FOR UPDATE`,
            [
              options.authority.workspaceId,
              options.threadId,
              options.sourceAssistantMessageId,
            ],
          );
          const sourceMessage = messages[0];
          if (!sourceMessage?.agentRunId || !sourceMessage.parentMessageId) {
            return invalid(
              "agent.branch_unavailable",
              "This Agent response cannot be regenerated.",
            );
          }
          sourceRun = await requireOwnedRun(
            connection,
            options.authority,
            sourceMessage.agentRunId,
            true,
          );
          triggerMessageId = sourceMessage.parentMessageId;
        } else {
          sourceRun = await requireOwnedRun(
            connection,
            options.authority,
            options.sourceRunId ??
              invalid("agent.invalid_argument", "sourceRunId is empty."),
            true,
          );
          if (
            sourceRun.threadId !== options.threadId ||
            !sourceRun.triggerMessageId
          ) {
            return invalid(
              "agent.branch_unavailable",
              "This Agent Run cannot be retried.",
            );
          }
          triggerMessageId = sourceRun.triggerMessageId;
        }
        const sourceContext = contextSnapshot(sourceRun.contextSnapshot);
        const sourceFoundation = foundationContext(sourceRun);
        await assertResourceAdmission(
          connection,
          options.authority.workspaceId,
          thread.agentDefinitionId,
          sourceFoundation.skills.map((skill) => skill.skillRevisionId),
        );
        if (
          !["succeeded", "failed", "cancelled"].includes(
            sourceRun.lifecycleStatus,
          )
        ) {
          return invalid("agent.run_active", "Agent response is still active.");
        }
        const [activeRuns] = await connection.execute<AgentRunRow[]>(
          `SELECT id FROM agent_run
            WHERE workspace_id = ? AND thread_id = ?
              AND lifecycle_status IN (
                'queued', 'running', 'waiting_approval', 'waiting_for_user'
              )
            LIMIT 1`,
          [options.authority.workspaceId, options.threadId],
        );
        if (activeRuns[0]) {
          return invalid(
            "agent.run_active",
            "Agent Thread already has an active run.",
          );
        }
        if (sourceRun.lifecycleStatus !== "succeeded") {
          const [acceptedActions] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM agent_action_receipt WHERE workspace_id = ? AND agent_run_id = ?
                AND effect <> 'read' AND lifecycle_status IN ('running', 'waiting_approval', 'succeeded') LIMIT 1`,
            [options.authority.workspaceId, sourceRun.id],
          );
          if (acceptedActions.length)
            return invalid(
              "agent.retry_requires_task_recovery",
              "Recover the existing business task before retrying this response.",
            );
        }
        const duration = Math.max(
          1,
          sourceRun.executionDeadlineAt.getTime() -
            sourceRun.createdAt.getTime(),
        );
        const limits = await admission(
          connection,
          {
            maximumModelCalls: sourceRun.maximumModelCalls,
            maximumToolCalls: sourceRun.maximumToolCalls,
            executionDeadlineAt: new Date(options.now.getTime() + duration),
          },
          options.now,
        );
        const executionDeadlineAt = limits.executionDeadlineAt;
        const [runInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run (
             id, workspace_id, thread_id, parent_run_id, trigger_message_id,
             actor_principal_id, lifecycle_status, context_snapshot,
             context_digest, tool_view_digest, prompt_revision,
             maximum_model_calls, maximum_tool_calls, idempotency_key,
             request_hash, terminal_reason_code, version,
             execution_deadline_at, created_at, updated_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?,
                     NULL, 1, ?, ?, ?, NULL)`,
          [
            options.runId,
            options.authority.workspaceId,
            options.threadId,
            sourceRun.id,
            triggerMessageId,
            options.authority.principalId,
            JSON.stringify(sourceContext),
            digestProviderValue(sourceContext),
            sourceRun.toolViewDigest,
            sourceRun.promptRevision,
            limits.maximumModelCalls,
            limits.maximumToolCalls,
            options.idempotencyKey,
            requestHash,
            executionDeadlineAt,
            options.now,
            options.now,
          ],
        );
        await pinAgentLibrariesInTransaction(connection, {
          authority: options.authority,
          runId: options.runId,
          libraryIds: sourceContext.selectedLibraryIds ?? [],
          source: "explicit",
          now: options.now,
        });
        await saveConfigurationVersion(
          connection,
          options.runId,
          limits.runtimeConfigurationVersion,
          limits.runtimeTimeoutSeconds,
        );
        const [dispatchInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run_dispatch (
             workspace_id, agent_run_id, delivery_status, available_at,
             claim_owner, claim_token_digest, lease_expires_at,
             delivery_count, last_error_code, version, created_at,
             updated_at, completed_at
           ) VALUES (?, ?, 'queued', ?, NULL, NULL, NULL, 0, NULL, 1, ?, ?, NULL)`,
          [
            options.authority.workspaceId,
            options.runId,
            options.now,
            options.now,
            options.now,
          ],
        );
        const [foundationInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_run_foundation_context (
             workspace_id, agent_run_id, profile_revision_id,
             profile_canonical_digest, skill_view_digest,
             skill_context_snapshot, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            options.authority.workspaceId,
            options.runId,
            sourceFoundation.profileRevisionId,
            sourceFoundation.profileCanonicalDigest,
            sourceFoundation.skillViewDigest,
            JSON.stringify(sourceFoundation.skills),
            options.now,
          ],
        );
        const [threadUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread SET active_run_id = ?, version = version + 1, updated_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.runId,
            options.now,
            options.authority.workspaceId,
            options.threadId,
            thread.version,
          ],
        );
        if (
          runInsert.affectedRows !== 1 ||
          dispatchInsert.affectedRows !== 1 ||
          foundationInsert.affectedRows !== 1 ||
          threadUpdate.affectedRows !== 1
        ) {
          return invalid(
            "agent.identity_conflict",
            "Agent response branch could not be created atomically.",
          );
        }
        return Object.freeze({
          id: options.runId,
          workspaceId: sourceRun.workspaceId,
          threadId: sourceRun.threadId,
          parentRunId: sourceRun.id,
          triggerMessageId,
          actorPrincipalId: sourceRun.actorPrincipalId,
          lifecycleStatus: "queued",
          contextSnapshot: sourceContext,
          toolViewDigest: sourceRun.toolViewDigest,
          promptRevision: sourceRun.promptRevision,
          maximumModelCalls: limits.maximumModelCalls,
          ...(limits.runtimeConfigurationVersion
            ? {
                runtimeConfigurationVersion: limits.runtimeConfigurationVersion,
              }
            : {}),
          maximumToolCalls: limits.maximumToolCalls,
          foundationContext: sourceFoundation,
          version: 1,
          executionDeadlineAt,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async selectThreadBranch(
      options: SelectAgentThreadBranchOptions,
    ): Promise<AgentThreadRecord> {
      assertId(options.threadId, "threadId");
      assertId(options.assistantMessageId, "assistantMessageId");
      if (!Number.isSafeInteger(options.expectedVersion)) {
        return invalid("agent.invalid_argument", "Thread version is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const thread = await requireOwnedThread(
          connection,
          options.authority,
          options.threadId,
        );
        if (thread.version !== options.expectedVersion) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const [activeRuns] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM agent_run WHERE workspace_id = ? AND thread_id = ?
             AND lifecycle_status IN ('queued', 'running', 'waiting_approval', 'waiting_for_user') LIMIT 1`,
          [options.authority.workspaceId, options.threadId],
        );
        if (activeRuns[0])
          return invalid(
            "agent.run_active",
            "Finish or stop the current response before switching branches.",
          );
        const [messages] = await connection.execute<AgentMessageRow[]>(
          `SELECT id, agent_run_id AS agentRunId FROM agent_message
            WHERE workspace_id = ? AND thread_id = ? AND id = ?
              AND role = 'assistant'
            LIMIT 1`,
          [
            options.authority.workspaceId,
            options.threadId,
            options.assistantMessageId,
          ],
        );
        if (!messages[0]) {
          return invalid(
            "agent.branch_unavailable",
            "Agent response branch was not found.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
              SET active_leaf_message_id = ?, active_run_id = ?, version = version + 1,
                  updated_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            options.assistantMessageId,
            messages[0].agentRunId,
            options.now,
            options.authority.workspaceId,
            options.threadId,
            options.expectedVersion,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid("agent.state_conflict", "Agent Thread has changed.");
        }
        const selected = await readThread(
          connection,
          options.authority.workspaceId,
          { id: options.threadId },
          false,
        );
        if (!selected) {
          return invalid(
            "agent.thread_not_found",
            "Agent Thread was not found.",
          );
        }
        return threadFrom(selected);
      });
    },

    async getRunDiagnostics(
      authority: TrustedWorkspaceScope,
      runId: string,
      now: Date,
    ): Promise<AgentRunDiagnosticsRecord | undefined> {
      assertId(runId, "runId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "audit.read",
          now,
        );
        const run = await readRun(connection, authority.workspaceId, {
          id: runId,
        });
        if (!run) return undefined;
        const [rows] = await connection.execute<RowDataPacket[]>(
          `SELECT call_fact.id, call_fact.purpose, call_fact.lifecycle_status AS lifecycleStatus,
             call_fact.terminal_reason_code AS reasonCode, call_fact.created_at AS createdAt,
             call_fact.updated_at AS updatedAt, attempt.id AS attemptId,
             call_fact.call_number AS callNumber, call_fact.finish_reason AS finishReason,
             call_fact.model_profile_key AS modelProfileKey,
             JSON_EXTRACT(attempt.usage_document, '$.inputTokens') AS inputTokens,
             JSON_EXTRACT(attempt.usage_document, '$.outputTokens') AS outputTokens,
             JSON_UNQUOTE(JSON_EXTRACT(attempt.route_snapshot, '$.resolution')) AS resolution,
             attempt.accepted_marker AS acceptedMarker, attempt.provider_request_id AS requestId
           FROM agent_model_call AS call_fact
           LEFT JOIN agent_model_attempt AS attempt
             ON attempt.workspace_id = call_fact.workspace_id
            AND attempt.agent_model_call_id = call_fact.id
            AND attempt.attempt_number = (SELECT MAX(latest.attempt_number)
              FROM agent_model_attempt AS latest WHERE latest.workspace_id = call_fact.workspace_id
                AND latest.agent_model_call_id = call_fact.id)
           WHERE call_fact.workspace_id = ? AND call_fact.agent_run_id = ?
           ORDER BY call_fact.call_number LIMIT 129`,
          [authority.workspaceId, runId],
        );
        const [discoveryRows] = await connection.execute<
          (RowDataPacket & { id: string; diagnostics: unknown })[]
        >(
          "SELECT id, query_diagnostics AS diagnostics FROM agent_action_receipt WHERE workspace_id = ? AND agent_run_id = ? AND query_diagnostics IS NOT NULL ORDER BY action_number LIMIT 129",
          [authority.workspaceId, runId],
        );
        const [actionRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, action_number AS actionNumber, tool_key AS toolKey,
             lifecycle_status AS lifecycleStatus, terminal_reason_code AS reasonCode,
             created_at AS createdAt, updated_at AS updatedAt
           FROM agent_action_receipt WHERE workspace_id = ? AND agent_run_id = ?
           ORDER BY action_number LIMIT 129`,
          [authority.workspaceId, runId],
        );
        return {
          ...(run.runtimeConfigurationVersion
            ? { runtimeConfigurationVersion: run.runtimeConfigurationVersion }
            : {}),
          limits: {
            maximumModelCalls: run.maximumModelCalls,
            maximumToolCalls: run.maximumToolCalls,
          },
          actions: actionRows.slice(0, 128).map((row) => ({
            id: String(row.id),
            actionNumber: Number(row.actionNumber),
            toolKey: String(row.toolKey),
            lifecycleStatus: row.lifecycleStatus as AgentActionStatus,
            ...(typeof row.reasonCode === "string"
              ? { reasonCode: row.reasonCode }
              : {}),
            createdAt: new Date(row.createdAt as Date),
            updatedAt: new Date(row.updatedAt as Date),
          })),
          runId: run.id,
          threadId: run.threadId,
          lifecycleStatus: run.lifecycleStatus,
          ...(run.terminalReasonCode
            ? { reasonCode: run.terminalReasonCode }
            : {}),
          createdAt: new Date(run.createdAt),
          updatedAt: new Date(run.updatedAt),
          truncated:
            rows.length > 128 ||
            discoveryRows.length > 128 ||
            actionRows.length > 128,
          discoveries: discoveryRows.slice(0, 128).map((item) => ({
            actionId: item.id,
            ...parseAgentDiscoveryDiagnostics(item.diagnostics),
          })),
          calls: rows.slice(0, 128).map((row) => ({
            id: String(row.id),
            callNumber: Number(row.callNumber),
            ...(typeof row.finishReason === "string"
              ? { finishReason: row.finishReason }
              : {}),
            ...(typeof row.modelProfileKey === "string"
              ? { modelProfileKey: row.modelProfileKey }
              : {}),
            ...diagnosticTokenCount("inputTokens", row.inputTokens),
            ...diagnosticTokenCount("outputTokens", row.outputTokens),
            purpose: row.purpose as AgentModelCallPurpose,
            lifecycleStatus: row.lifecycleStatus as AgentModelCallStatus,
            ...(typeof row.reasonCode === "string"
              ? { reasonCode: row.reasonCode }
              : {}),
            routeResolved: row.attemptId ? row.resolution !== "failed" : null,
            providerAccepted: Number(row.acceptedMarker) === 1,
            ...(typeof row.requestId === "string"
              ? { requestId: row.requestId }
              : {}),
            createdAt: new Date(row.createdAt as Date),
            updatedAt: new Date(row.updatedAt as Date),
          })),
        };
      });
    },

    async getRun(
      authority: TrustedWorkspaceScope,
      runId: string,
      now: Date,
    ): Promise<AgentRunRecord | undefined> {
      assertId(runId, "runId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const run = await readRun(connection, authority.workspaceId, {
          id: runId,
        });
        if (!run) {
          return undefined;
        }
        await requireOwnedThread(connection, authority, run.threadId);
        return runFrom(run);
      });
    },

    async getAssistantMessage(
      authority: TrustedWorkspaceScope,
      runId: string,
      now: Date,
    ): Promise<AgentVisibleMessageV1 | undefined> {
      assertId(runId, "runId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedRun(connection, authority, runId, false);
        const [rows] = await connection.execute<AgentMessageRow[]>(
          `SELECT content
             FROM agent_message
             WHERE workspace_id = ?
               AND agent_run_id = ?
               AND role = 'assistant'
             ORDER BY sequence_number DESC
             LIMIT 1`,
          [authority.workspaceId, runId],
        );
        return rows[0] ? visibleMessage(rows[0].content) : undefined;
      });
    },

    async listThreadMessages(
      authority: TrustedWorkspaceScope,
      threadId: string,
      limit: number,
      now: Date,
    ): Promise<readonly AgentMessageRecord[]> {
      assertId(threadId, "threadId");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        invalid("agent.invalid_argument", "Message limit is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const thread = await requireOwnedThread(
          connection,
          authority,
          threadId,
        );
        const branchQuery = thread.activeLeafMessageId
          ? `WITH RECURSIVE branch AS (
               SELECT message.id, message.workspace_id, message.thread_id, message.agent_run_id, message.parent_message_id, message.sequence_number, message.alternative_index, message.role, message.content, message.created_at
                 FROM agent_message AS message
                WHERE message.workspace_id = ? AND message.id = ?
               UNION ALL
               SELECT parent.id, parent.workspace_id, parent.thread_id, parent.agent_run_id, parent.parent_message_id, parent.sequence_number, parent.alternative_index, parent.role, parent.content, parent.created_at
                 FROM agent_message AS parent
                 INNER JOIN branch AS child
                   ON child.parent_message_id = parent.id
                  AND child.workspace_id = parent.workspace_id
             )
             SELECT id, workspace_id AS workspaceId, thread_id AS threadId,
                    agent_run_id AS agentRunId,
                    parent_message_id AS parentMessageId,
                    sequence_number AS sequenceNumber,
                    alternative_index AS alternativeIndex,
                    (SELECT COUNT(*) FROM agent_message AS sibling
                      WHERE sibling.workspace_id = branch.workspace_id
                        AND sibling.thread_id = branch.thread_id
                        AND sibling.parent_message_id <=> branch.parent_message_id
                        AND sibling.role = branch.role) AS alternativeCount,
                    (SELECT sibling.id FROM agent_message AS sibling
                      WHERE sibling.workspace_id = branch.workspace_id
                        AND sibling.thread_id = branch.thread_id
                        AND sibling.parent_message_id <=> branch.parent_message_id
                        AND sibling.role = branch.role
                        AND sibling.alternative_index = branch.alternative_index - 1
                      LIMIT 1) AS previousAlternativeMessageId,
                    (SELECT sibling.id FROM agent_message AS sibling
                      WHERE sibling.workspace_id = branch.workspace_id
                        AND sibling.thread_id = branch.thread_id
                        AND sibling.parent_message_id <=> branch.parent_message_id
                        AND sibling.role = branch.role
                        AND sibling.alternative_index = branch.alternative_index + 1
                      LIMIT 1) AS nextAlternativeMessageId,
                    content, created_at AS createdAt
               FROM branch
              ORDER BY sequence_number DESC
              LIMIT ${String(limit)}`
          : `SELECT id, workspace_id AS workspaceId, thread_id AS threadId,
                    agent_run_id AS agentRunId,
                    parent_message_id AS parentMessageId,
                    sequence_number AS sequenceNumber,
                    alternative_index AS alternativeIndex,
                    1 AS alternativeCount,
                    NULL AS previousAlternativeMessageId,
                    NULL AS nextAlternativeMessageId, content,
                    created_at AS createdAt
               FROM agent_message
              WHERE workspace_id = ? AND thread_id = ?
              ORDER BY sequence_number DESC
              LIMIT ${String(limit)}`;
        const [rows] = await connection.execute<AgentMessageRow[]>(
          branchQuery,
          [authority.workspaceId, thread.activeLeafMessageId ?? threadId],
        );
        return Object.freeze(
          rows.toReversed().map((row) =>
            Object.freeze({
              id: row.id,
              workspaceId: row.workspaceId,
              threadId: row.threadId,
              agentRunId: row.agentRunId,
              ...(row.parentMessageId
                ? { parentMessageId: row.parentMessageId }
                : {}),
              sequenceNumber: row.sequenceNumber,
              alternativeIndex: row.alternativeIndex,
              alternativeCount: row.alternativeCount,
              ...(row.previousAlternativeMessageId
                ? {
                    previousAlternativeMessageId:
                      row.previousAlternativeMessageId,
                  }
                : {}),
              ...(row.nextAlternativeMessageId
                ? { nextAlternativeMessageId: row.nextAlternativeMessageId }
                : {}),
              message: visibleMessage(row.content),
              createdAt: new Date(row.createdAt),
            }),
          ),
        );
      });
    },

    async listRunMessages(
      authority: TrustedWorkspaceScope,
      runId: string,
      limit: number | "all",
      now: Date,
    ): Promise<readonly AgentMessageRecord[]> {
      assertId(runId, "runId");
      if (
        limit !== "all" &&
        (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      ) {
        invalid("agent.invalid_argument", "Message limit is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const run = await requireOwnedRun(connection, authority, runId, false);
        if (!run.triggerMessageId) {
          return invalid(
            "agent.integrity_violation",
            "Agent Run has no triggering message.",
          );
        }
        const rows: AgentMessageRow[] = [];
        const seen = new Set<string>();
        let cursor: string | null = run.triggerMessageId;
        const batchSize = limit === "all" ? 200 : limit;
        while (cursor) {
          const [batch]: [AgentMessageRow[], unknown] =
            await connection.execute<AgentMessageRow[]>(
              `WITH RECURSIVE branch AS (
               SELECT message.id, message.workspace_id, message.thread_id, message.agent_run_id, message.parent_message_id, message.sequence_number, message.alternative_index, message.role, message.content, message.created_at, 0 AS depth FROM agent_message AS message
                WHERE message.workspace_id = ? AND message.thread_id = ? AND message.id = ?
               UNION ALL
               SELECT parent.id, parent.workspace_id, parent.thread_id, parent.agent_run_id, parent.parent_message_id, parent.sequence_number, parent.alternative_index, parent.role, parent.content, parent.created_at, child.depth + 1 FROM agent_message AS parent
               INNER JOIN branch AS child
                 ON child.parent_message_id = parent.id
                AND child.workspace_id = parent.workspace_id
                AND child.thread_id = parent.thread_id
                AND parent.sequence_number < child.sequence_number
               WHERE child.depth < ?
             )
             SELECT id, workspace_id AS workspaceId, thread_id AS threadId,
                    agent_run_id AS agentRunId, parent_message_id AS parentMessageId,
                    sequence_number AS sequenceNumber, alternative_index AS alternativeIndex,
                    1 AS alternativeCount, content, created_at AS createdAt
               FROM branch ORDER BY sequence_number DESC`,
              [authority.workspaceId, run.threadId, cursor, batchSize - 1],
            );
          if (batch.length === 0)
            return invalid(
              "agent.integrity_violation",
              "Agent branch has a missing parent message.",
            );
          // Do not carry native multimodal JSON through the recursive CTE or
          // its filesort. Fetch payloads only after branch identity/order is fixed.
          const [transcripts] = await connection.execute<
            (RowDataPacket & {
              readonly id: string;
              readonly modelMessages: unknown;
            })[]
          >(
            `SELECT id, model_messages AS modelMessages FROM agent_message
              WHERE workspace_id = ? AND id IN (${batch.map(() => "?").join(", ")})`,
            [authority.workspaceId, ...batch.map((row) => row.id)],
          );
          const transcriptsById = new Map(
            transcripts.map((row) => [row.id, row.modelMessages]),
          );
          for (const row of batch) {
            if (
              seen.has(row.id) ||
              (rows.length > 0 &&
                row.sequenceNumber >= rows.at(-1)!.sequenceNumber)
            ) {
              return invalid(
                "agent.integrity_violation",
                "Agent branch ancestry is inconsistent.",
              );
            }
            seen.add(row.id);
            rows.push({ ...row, modelMessages: transcriptsById.get(row.id) });
          }
          cursor = limit === "all" ? batch.at(-1)!.parentMessageId : null;
        }
        return Object.freeze(
          rows.toReversed().map((row) =>
            Object.freeze({
              id: row.id,
              workspaceId: row.workspaceId,
              threadId: row.threadId,
              agentRunId: row.agentRunId,
              ...(row.parentMessageId
                ? { parentMessageId: row.parentMessageId }
                : {}),
              sequenceNumber: row.sequenceNumber,
              alternativeIndex: row.alternativeIndex,
              alternativeCount: row.alternativeCount,
              message: visibleMessage(row.content),
              ...(row.modelMessages
                ? { modelMessages: modelMessages(row.modelMessages) }
                : {}),
              createdAt: new Date(row.createdAt),
            }),
          ),
        );
      });
    },

    async getLatestThreadRun(
      authority: TrustedWorkspaceScope,
      threadId: string,
      now: Date,
    ): Promise<AgentRunRecord | undefined> {
      assertId(threadId, "threadId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const thread = await requireOwnedThread(
          connection,
          authority,
          threadId,
        );
        if (!thread.activeRunId) return undefined;
        const run = await readRun(
          connection,
          authority.workspaceId,
          {
            id: thread.activeRunId,
          },
          false,
        );
        return run ? runFrom(run) : undefined;
      });
    },

    async listThreadActions(
      authority: TrustedWorkspaceScope,
      threadId: string,
      limit: number,
      now: Date,
    ): Promise<readonly AgentActionReceiptRecord[]> {
      assertId(threadId, "threadId");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        invalid("agent.invalid_argument", "Action limit is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedThread(connection, authority, threadId);
        const [rows] = await connection.execute<AgentActionReceiptRow[]>(
          `SELECT
             action.id,
             action.workspace_id AS workspaceId,
             action.agent_run_id AS agentRunId,
             action.action_number AS actionNumber,
             action.tool_call_id AS toolCallId,
             action.tool_key AS toolKey,
             action.effect,
             action.approval_mode AS approvalMode,
             action.lifecycle_status AS lifecycleStatus,
             action.input_digest AS inputDigest,
             action.output_digest AS outputDigest,
             action.proposal_document AS proposalDocument,
             action.outcome_kind AS outcomeKind,
             action.query_result_count AS queryResultCount, action.query_diagnostics AS queryDiagnostics,
             action.canvas_draft_id AS canvasDraftId,
             action.capability_run_id AS capabilityRunId,
             action.workflow_run_id AS workflowRunId,
             action.workflow_definition_id AS workflowDefinitionId,
             action.skill_draft_id AS skillDraftId,
             action.brand_kit_id AS brandKitId,
             action.brand_kit_revision_id AS brandKitRevisionId,
             action.before_version AS beforeVersion,
             action.after_version AS afterVersion,
             action.undo_group_id AS undoGroupId,
             action.terminal_reason_code AS terminalReasonCode,
             action.version,
             action.created_at AS createdAt,
             action.updated_at AS updatedAt,
             action.completed_at AS completedAt
           FROM agent_action_receipt AS action
           INNER JOIN agent_run AS run
             ON run.workspace_id = action.workspace_id
            AND run.id = action.agent_run_id
           WHERE run.workspace_id = ? AND run.thread_id = ?
           ORDER BY run.created_at DESC, action.action_number DESC
           LIMIT ${String(limit)}`,
          [authority.workspaceId, threadId],
        );
        return Object.freeze(rows.toReversed().map(actionReceiptFrom));
      });
    },

    async listThreadInteractions(
      authority: TrustedWorkspaceScope,
      threadId: string,
      limit: number,
      now: Date,
    ): Promise<readonly AgentInteractionRecord[]> {
      assertId(threadId, "threadId");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        invalid("agent.invalid_argument", "Interaction limit is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedThread(connection, authority, threadId);
        const [rows] = await connection.execute<AgentInteractionRow[]>(
          `SELECT
             interaction.id,
             interaction.workspace_id AS workspaceId,
             run.thread_id AS threadId,
             interaction.agent_run_id AS agentRunId,
             interaction.assistant_message_id AS assistantMessageId,
             interaction.interaction_number AS interactionNumber,
             interaction.tool_call_id AS toolCallId,
             interaction.tool_key AS toolKey,
             interaction.lifecycle_status AS lifecycleStatus,
             interaction.request_document AS requestDocument,
             interaction.request_digest AS requestDigest,
             interaction.response_document AS responseDocument,
             interaction.response_digest AS responseDigest,
             interaction.checkpoint_document AS checkpointDocument,
             interaction.checkpoint_digest AS checkpointDigest,
             interaction.resolution_request_key AS resolutionRequestKey,
             interaction.resolved_by_principal_id AS resolvedByPrincipalId,
             interaction.version,
             interaction.created_at AS createdAt,
             interaction.updated_at AS updatedAt,
             interaction.completed_at AS completedAt
           FROM agent_interaction AS interaction
           INNER JOIN agent_run AS run
             ON run.workspace_id = interaction.workspace_id
            AND run.id = interaction.agent_run_id
           WHERE run.workspace_id = ? AND run.thread_id = ?
           ORDER BY run.created_at DESC, interaction.interaction_number DESC
           LIMIT ${String(limit)}`,
          [authority.workspaceId, threadId],
        );
        return Object.freeze(rows.toReversed().map(interactionFrom));
      });
    },

    async listRunInteractions(
      authority: TrustedWorkspaceScope,
      agentRunId: string,
      now: Date,
    ): Promise<readonly AgentInteractionRecord[]> {
      assertId(agentRunId, "agentRunId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedRun(connection, authority, agentRunId, false);
        const [rows] = await connection.execute<AgentInteractionRow[]>(
          `SELECT
             interaction.id,
             interaction.workspace_id AS workspaceId,
             run.thread_id AS threadId,
             interaction.agent_run_id AS agentRunId,
             interaction.assistant_message_id AS assistantMessageId,
             interaction.interaction_number AS interactionNumber,
             interaction.tool_call_id AS toolCallId,
             interaction.tool_key AS toolKey,
             interaction.lifecycle_status AS lifecycleStatus,
             interaction.request_document AS requestDocument,
             interaction.request_digest AS requestDigest,
             interaction.response_document AS responseDocument,
             interaction.response_digest AS responseDigest,
             interaction.checkpoint_document AS checkpointDocument,
             interaction.checkpoint_digest AS checkpointDigest,
             interaction.resolution_request_key AS resolutionRequestKey,
             interaction.resolved_by_principal_id AS resolvedByPrincipalId,
             interaction.version,
             interaction.created_at AS createdAt,
             interaction.updated_at AS updatedAt,
             interaction.completed_at AS completedAt
           FROM agent_interaction AS interaction
           INNER JOIN agent_run AS run
             ON run.workspace_id = interaction.workspace_id
            AND run.id = interaction.agent_run_id
           WHERE interaction.workspace_id = ?
             AND interaction.agent_run_id = ?
           ORDER BY interaction.interaction_number`,
          [authority.workspaceId, agentRunId],
        );
        return Object.freeze(rows.map(interactionFrom));
      });
    },

    async getInteraction(
      authority: TrustedWorkspaceScope,
      interactionId: string,
      now: Date,
    ): Promise<AgentInteractionRecord | undefined> {
      assertId(interactionId, "interactionId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const interaction = await readInteraction(
          connection,
          authority.workspaceId,
          interactionId,
          false,
        );
        if (!interaction) return undefined;
        await requireOwnedRun(
          connection,
          authority,
          interaction.agentRunId,
          false,
        );
        return interactionFrom(interaction);
      });
    },

    async getRunModelCallUsage(
      authority: TrustedWorkspaceScope,
      agentRunId: string,
      now: Date,
    ): Promise<{
      readonly mainCallCount: number;
      readonly maximumCallNumber: number;
      readonly threadTitleCallCount: number;
    }> {
      assertId(agentRunId, "agentRunId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedRun(connection, authority, agentRunId, false);
        const [rows] = await connection.execute<
          (RowDataPacket & {
            readonly mainCallCount: number;
            readonly maximumCallNumber: number;
            readonly threadTitleCallCount: number;
          })[]
        >(
          `SELECT
             SUM(purpose NOT IN ('memory_observation', 'thread_title'))
               AS mainCallCount,
             COALESCE(MAX(call_number), 0) AS maximumCallNumber,
             SUM(purpose = 'thread_title') AS threadTitleCallCount
             FROM agent_model_call
            WHERE workspace_id = ? AND agent_run_id = ?`,
          [authority.workspaceId, agentRunId],
        );
        return Object.freeze({
          mainCallCount: Number(rows[0]?.mainCallCount ?? 0),
          maximumCallNumber: Number(rows[0]?.maximumCallNumber ?? 0),
          threadTitleCallCount: Number(rows[0]?.threadTitleCallCount ?? 0),
        });
      });
    },

    async suspendForInteraction(
      options: SuspendAgentQuestionInteractionOptions,
    ): Promise<AgentInteractionRecord> {
      assertId(options.interactionId, "interactionId");
      assertId(options.agentRunId, "agentRunId");
      assertId(options.assistantMessageId, "assistantMessageId");
      assertDigest(options.claimTokenDigest, "claimTokenDigest");
      if (
        !workerPattern.test(options.workerId) ||
        !validToolCallId(options.toolCallId) ||
        options.expectedRunVersion < 1 ||
        options.request.schemaVersion !== 1 ||
        options.request.kind !== "question" ||
        options.request.questions.length < 1 ||
        options.request.questions.length > 3 ||
        !record(options.checkpoint)
      ) {
        invalid("agent.invalid_argument", "Agent Interaction is invalid.");
      }
      let serializedCheckpoint: string;
      try {
        serializedCheckpoint = JSON.stringify(options.checkpoint);
      } catch {
        return invalid(
          "agent.invalid_argument",
          "Agent Interaction checkpoint is not serializable.",
        );
      }
      if (
        serializedCheckpoint.length < 1 ||
        serializedCheckpoint.length > maximumInteractionCheckpointCharacters
      ) {
        invalid(
          "agent.limit_exceeded",
          "Agent Interaction checkpoint exceeds its bounded limit.",
        );
      }
      const requestDigest = digestProviderValue(options.request);
      const checkpointDigest = digestProviderValue(options.checkpoint);
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const replay = await readInteraction(
          connection,
          options.authority.workspaceId,
          options.interactionId,
          true,
        );
        if (replay) {
          if (
            replay.agentRunId !== options.agentRunId ||
            replay.toolCallId !== options.toolCallId ||
            replay.requestDigest !== requestDigest ||
            replay.checkpointDigest !== checkpointDigest
          ) {
            return invalid(
              "agent.identity_conflict",
              "Agent Interaction identity was reused with different input.",
            );
          }
          return interactionFrom(replay);
        }
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        if (
          run.lifecycleStatus !== "running" ||
          run.version !== options.expectedRunVersion
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Run is not available for user interaction.",
          );
        }
        const [messages] = await connection.execute<
          (RowDataPacket & { readonly id: string })[]
        >(
          `SELECT id
             FROM agent_message
            WHERE workspace_id = ? AND id = ? AND agent_run_id = ?
              AND role = 'assistant'
            LIMIT 1`,
          [
            options.authority.workspaceId,
            options.assistantMessageId,
            options.agentRunId,
          ],
        );
        if (!messages[0]) {
          return invalid(
            "agent.integrity_violation",
            "Agent Interaction assistant message is unavailable.",
          );
        }
        const [pending] = await connection.execute<
          (RowDataPacket & { readonly id: string })[]
        >(
          `SELECT id
             FROM agent_interaction
            WHERE workspace_id = ? AND agent_run_id = ?
              AND lifecycle_status = 'pending'
            LIMIT 1 FOR UPDATE`,
          [options.authority.workspaceId, options.agentRunId],
        );
        if (pending[0]) {
          return invalid(
            "agent.state_conflict",
            "Agent Run already has a pending user interaction.",
          );
        }
        const [numbers] = await connection.execute<
          (RowDataPacket & { readonly nextNumber: number })[]
        >(
          `SELECT COALESCE(MAX(interaction_number), 0) + 1 AS nextNumber
             FROM agent_interaction
            WHERE workspace_id = ? AND agent_run_id = ?`,
          [options.authority.workspaceId, options.agentRunId],
        );
        const interactionNumber = Number(numbers[0]?.nextNumber ?? 1);
        if (interactionNumber < 1 || interactionNumber > 16) {
          return invalid(
            "agent.limit_exceeded",
            "Agent Run exceeded its interaction limit.",
          );
        }
        const [dispatchRows] = await connection.execute<
          (RowDataPacket & { readonly version: number })[]
        >(
          `SELECT version
             FROM agent_run_dispatch
            WHERE workspace_id = ? AND agent_run_id = ?
              AND delivery_status = 'claimed'
              AND claim_owner = ? AND claim_token_digest = ?
              AND lease_expires_at > ?
            LIMIT 1 FOR UPDATE`,
          [
            options.authority.workspaceId,
            options.agentRunId,
            options.workerId,
            options.claimTokenDigest,
            options.now,
          ],
        );
        const dispatch = dispatchRows[0];
        if (!dispatch) {
          return invalid(
            "agent.state_conflict",
            "Agent Interaction lost its Worker lease.",
          );
        }
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_interaction (
             id, workspace_id, agent_run_id, assistant_message_id,
             interaction_number, tool_call_id, tool_key, lifecycle_status,
             request_document, request_digest, response_document,
             response_digest, checkpoint_document, checkpoint_digest,
             resolution_request_key, resolved_by_principal_id, version,
             created_at, updated_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'builtin.ask-question', 'pending',
                     ?, ?, NULL, NULL, ?, ?, NULL, NULL, 1, ?, ?, NULL)`,
          [
            options.interactionId,
            options.authority.workspaceId,
            options.agentRunId,
            options.assistantMessageId,
            interactionNumber,
            options.toolCallId,
            JSON.stringify(options.request),
            requestDigest,
            serializedCheckpoint,
            checkpointDigest,
            options.now,
            options.now,
          ],
        );
        const [runUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run
              SET lifecycle_status = 'waiting_for_user',
                  version = version + 1, updated_at = ?
            WHERE workspace_id = ? AND id = ? AND version = ?
              AND lifecycle_status = 'running'`,
          [
            options.now,
            options.authority.workspaceId,
            options.agentRunId,
            run.version,
          ],
        );
        const [dispatchUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run_dispatch
              SET delivery_status = 'completed', claim_owner = NULL,
                  claim_token_digest = NULL, lease_expires_at = NULL,
                  version = version + 1, updated_at = ?, completed_at = ?
            WHERE workspace_id = ? AND agent_run_id = ? AND version = ?
              AND delivery_status = 'claimed'`,
          [
            options.now,
            options.now,
            options.authority.workspaceId,
            options.agentRunId,
            dispatch.version,
          ],
        );
        if (
          inserted.affectedRows !== 1 ||
          runUpdated.affectedRows !== 1 ||
          dispatchUpdated.affectedRows !== 1
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Interaction suspension lost concurrency.",
          );
        }
        const created = await readInteraction(
          connection,
          options.authority.workspaceId,
          options.interactionId,
          false,
        );
        return created
          ? interactionFrom(created)
          : invalid(
              "agent.integrity_violation",
              "Agent Interaction could not be reloaded.",
            );
      });
    },

    async resolveInteraction(options: ResolveAgentQuestionInteractionOptions) {
      assertId(options.interactionId, "interactionId");
      assertIdempotencyKey(options.resolutionRequestKey);
      if (
        options.expectedVersion < 1 ||
        options.response.schemaVersion !== 1 ||
        !["submitted", "skipped", "cancelled"].includes(
          options.response.outcome,
        )
      ) {
        invalid(
          "agent.invalid_argument",
          "Agent Interaction response is invalid.",
        );
      }
      const responseDigest = digestProviderValue(options.response);
      const targetStatus = agentInteractionStatusForResponse(options.response);
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const interaction = await readInteraction(
          connection,
          options.authority.workspaceId,
          options.interactionId,
          true,
        );
        if (!interaction) {
          return invalid(
            "agent.interaction_not_found",
            "Agent Interaction was not found.",
          );
        }
        const run = await requireOwnedRun(
          connection,
          options.authority,
          interaction.agentRunId,
          true,
        );
        if (interaction.lifecycleStatus !== "pending") {
          if (
            interaction.resolutionRequestKey === options.resolutionRequestKey &&
            interaction.responseDigest === responseDigest
          ) {
            return Object.freeze({
              interaction: interactionFrom(interaction),
              run: runFrom(run),
              replayed: true,
            });
          }
          return invalid(
            interaction.resolutionRequestKey === options.resolutionRequestKey
              ? "agent.identity_conflict"
              : "agent.state_conflict",
            "Agent Interaction has already been resolved.",
          );
        }
        if (
          interaction.version !== options.expectedVersion ||
          run.lifecycleStatus !== "waiting_for_user"
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Interaction is not waiting for a response.",
          );
        }
        const [interactionUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_interaction
                SET lifecycle_status = ?, response_document = ?,
                    response_digest = ?, resolution_request_key = ?,
                    resolved_by_principal_id = ?, version = version + 1,
                    updated_at = ?, completed_at = ?
              WHERE workspace_id = ? AND id = ? AND version = ?
                AND lifecycle_status = 'pending'`,
          [
            targetStatus,
            JSON.stringify(options.response),
            responseDigest,
            options.resolutionRequestKey,
            options.authority.principalId,
            options.now,
            options.now,
            options.authority.workspaceId,
            options.interactionId,
            interaction.version,
          ],
        );
        let runUpdated: ResultSetHeader;
        if (targetStatus === "cancelled") {
          [runUpdated] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run
                SET lifecycle_status = 'cancelled',
                    terminal_reason_code = 'agent.interaction_cancelled',
                    version = version + 1, updated_at = ?, completed_at = ?
              WHERE workspace_id = ? AND id = ? AND version = ?
                AND lifecycle_status = 'waiting_for_user'`,
            [
              options.now,
              options.now,
              options.authority.workspaceId,
              run.id,
              run.version,
            ],
          );
        } else {
          const activeDurationMs = Math.max(
            5_000,
            Math.min(
              1_800_000,
              run.runtimeTimeoutSeconds
                ? run.runtimeTimeoutSeconds * 1000
                : run.executionDeadlineAt.getTime() - run.createdAt.getTime(),
            ),
          );
          [runUpdated] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run
                SET lifecycle_status = 'queued', execution_deadline_at = ?,
                    version = version + 1, updated_at = ?
              WHERE workspace_id = ? AND id = ? AND version = ?
                AND lifecycle_status = 'waiting_for_user'`,
            [
              new Date(options.now.getTime() + activeDurationMs),
              options.now,
              options.authority.workspaceId,
              run.id,
              run.version,
            ],
          );
          const [dispatchUpdated] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_run_dispatch
                SET delivery_status = 'queued', available_at = ?,
                    claim_owner = NULL, claim_token_digest = NULL,
                    lease_expires_at = NULL, delivery_count = 0,
                    last_error_code = NULL, version = version + 1,
                    updated_at = ?, completed_at = NULL
              WHERE workspace_id = ? AND agent_run_id = ?
                AND delivery_status = 'completed'`,
            [options.now, options.now, options.authority.workspaceId, run.id],
          );
          if (dispatchUpdated.affectedRows !== 1) {
            return invalid(
              "agent.state_conflict",
              "Agent Interaction continuation could not be queued.",
            );
          }
        }
        if (
          interactionUpdated.affectedRows !== 1 ||
          runUpdated.affectedRows !== 1
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Interaction resolution lost concurrency.",
          );
        }
        const resolvedInteraction = await readInteraction(
          connection,
          options.authority.workspaceId,
          options.interactionId,
          false,
        );
        const resolvedRun = await readRun(
          connection,
          options.authority.workspaceId,
          { id: run.id },
          false,
        );
        if (!resolvedInteraction || !resolvedRun) {
          return invalid(
            "agent.integrity_violation",
            "Resolved Agent Interaction could not be reloaded.",
          );
        }
        return Object.freeze({
          interaction: interactionFrom(resolvedInteraction),
          run: runFrom(resolvedRun),
          replayed: false,
        });
      });
    },

    async settleRun(
      options: Parameters<AgentRuntimeRepository["settleRun"]>[0],
    ): Promise<AgentRunRecord> {
      assertId(options.runId, "runId");
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.runId,
          true,
        );
        if (!["running", "waiting_approval"].includes(run.lifecycleStatus))
          return runFrom(run);
        if (options.workerClaim) {
          const [claims] = await connection.execute<RowDataPacket[]>(
            `SELECT agent_run_id FROM agent_run_dispatch WHERE workspace_id = ? AND agent_run_id = ?
               AND delivery_status = 'claimed' AND claim_owner = ? AND claim_token_digest = ? AND lease_expires_at > ? FOR UPDATE`,
            [
              options.authority.workspaceId,
              options.runId,
              options.workerClaim.workerId,
              options.workerClaim.claimTokenDigest,
              options.now,
            ],
          );
          if (!claims.length)
            return invalid(
              "agent.state_conflict",
              "Agent Worker no longer owns the Run.",
            );
          const [messages] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM agent_message WHERE workspace_id = ? AND agent_run_id = ? AND role = 'assistant' AND model_messages IS NOT NULL LIMIT 1`,
            [options.authority.workspaceId, options.runId],
          );
          if (!messages.length)
            return invalid(
              "agent.state_conflict",
              "Final model messages must be saved before settling the Run.",
            );
        } else if (run.lifecycleStatus === "running") {
          // Action confirmation must not terminate a live model loop. Completed
          // dispatches permit recovery of legacy action-owned running Runs only.
          const [dispatches] = await connection.execute<RowDataPacket[]>(
            `SELECT delivery_status FROM agent_run_dispatch WHERE workspace_id = ? AND agent_run_id = ?`,
            [options.authority.workspaceId, options.runId],
          );
          if (dispatches[0]?.delivery_status !== "completed")
            return runFrom(run);
        }
        // Action completion and this read share the conversation mutation lock.
        // Never decide from an earlier, process-local 'waiting for approval' flag.
        const [actions] = await connection.execute<
          (RowDataPacket & {
            lifecycleStatus: string;
            terminalReasonCode: string | null;
          })[]
        >(
          `SELECT lifecycle_status AS lifecycleStatus, terminal_reason_code AS terminalReasonCode
             FROM agent_action_receipt WHERE workspace_id = ? AND agent_run_id = ? AND proposal_document IS NOT NULL`,
          [options.authority.workspaceId, options.runId],
        );
        const failure = actions.find(
          (action) => action.lifecycleStatus === "failed",
        );
        const pending = actions.some((action) =>
          ["waiting_approval", "running"].includes(action.lifecycleStatus),
        );
        let status: "failed" | "waiting_approval" | "succeeded" = "succeeded";
        if (failure) status = "failed";
        else if (pending) status = "waiting_approval";
        if (status === run.lifecycleStatus) return runFrom(run);
        const reason =
          failure?.terminalReasonCode ??
          (failure ? "agent.action_failed" : null);
        const completedAt = status === "waiting_approval" ? null : options.now;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run SET lifecycle_status = ?, terminal_reason_code = ?, version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ? AND lifecycle_status = ?`,
          [
            status,
            reason,
            options.now,
            completedAt,
            options.authority.workspaceId,
            options.runId,
            run.version,
            run.lifecycleStatus,
          ],
        );
        if (updated.affectedRows !== 1)
          return invalid(
            "agent.state_conflict",
            "Agent Run settlement lost concurrency.",
          );
        return runFrom({
          ...run,
          lifecycleStatus: status,
          terminalReasonCode: reason,
          version: run.version + 1,
          updatedAt: options.now,
          completedAt,
        });
      });
    },

    async transitionRun(
      options: TransitionAgentRunOptions,
    ): Promise<AgentRunRecord> {
      assertId(options.runId, "runId");
      if (options.expectedVersion < 1) {
        invalid("agent.invalid_argument", "expectedVersion is invalid.");
      }
      const terminal = ["succeeded", "failed", "cancelled"].includes(
        options.toStatus,
      );
      if (
        (terminal && options.toStatus !== "succeeded") !==
        (options.terminalReasonCode !== undefined)
      ) {
        invalid(
          "agent.invalid_argument",
          "Agent Run terminal reason does not match the target status.",
        );
      }
      if (options.terminalReasonCode) {
        assertStableReason(options.terminalReasonCode, "terminalReasonCode");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.runId,
          true,
        );
        if (
          run.lifecycleStatus === "queued" &&
          options.toStatus === "running"
        ) {
          return invalid(
            "agent.state_conflict",
            "Queued Agent Runs must enter running through a dispatch claim.",
          );
        }
        if (options.toStatus === "queued") {
          return invalid(
            "agent.state_conflict",
            "Agent Runs may be requeued only by resolving their pending interaction.",
          );
        }
        if (
          run.version !== options.expectedVersion ||
          !agentRunTransitionAllowed(run.lifecycleStatus, options.toStatus)
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Run transition lost optimistic concurrency.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run
             SET lifecycle_status = ?,
                 terminal_reason_code = ?,
                 version = version + 1,
                 updated_at = ?,
                 completed_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND lifecycle_status = ?`,
          [
            options.toStatus,
            options.terminalReasonCode ?? null,
            options.now,
            terminal ? options.now : null,
            options.authority.workspaceId,
            options.runId,
            run.version,
            run.lifecycleStatus,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Run transition lost optimistic concurrency.",
          );
        }
        return runFrom({
          ...run,
          lifecycleStatus: options.toStatus,
          terminalReasonCode: options.terminalReasonCode ?? null,
          version: run.version + 1,
          updatedAt: options.now,
          completedAt: terminal ? options.now : null,
        });
      });
    },

    async beginModelCall(
      options: BeginAgentModelCallOptions,
    ): Promise<AgentModelCallRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.modelCallId, "modelCallId");
      assertDigest(options.inputDigest, "inputDigest");
      if (
        !Number.isSafeInteger(options.callNumber) ||
        options.callNumber < 1 ||
        options.callNumber > 65_535 ||
        !stableKeyPattern.test(options.modelProfileKey)
      ) {
        invalid("agent.invalid_argument", "Agent Model Call input is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        if (
          !(await agentModelCallAdmitted(connection, {
            ...options,
            workspaceId: options.authority.workspaceId,
            lifecycleStatus: run.lifecycleStatus,
            executionDeadlineAt: run.executionDeadlineAt,
          }))
        ) {
          return invalid(
            "agent.run_inactive",
            "Agent Run cannot start a model call in its current state.",
          );
        }
        const replay = await readModelCall(
          connection,
          options.authority.workspaceId,
          { agentRunId: options.agentRunId, callNumber: options.callNumber },
          true,
        );
        if (replay) {
          if (
            replay.id !== options.modelCallId ||
            replay.purpose !== options.purpose ||
            replay.modelProfileKey !== options.modelProfileKey ||
            replay.inputDigest !== options.inputDigest
          ) {
            return invalid(
              "agent.identity_conflict",
              "Agent Model Call number was reused with different input.",
            );
          }
          return modelCallFrom(replay);
        }
        const [counts] = await connection.execute<
          (RowDataPacket & {
            readonly mainCount: number;
            readonly memoryCount: number;
            readonly titleCount: number;
          })[]
        >(
          `SELECT
             SUM(purpose NOT IN ('memory_observation', 'thread_title')) AS mainCount,
             SUM(purpose = 'memory_observation') AS memoryCount,
             SUM(purpose = 'thread_title') AS titleCount
           FROM agent_model_call
           WHERE workspace_id = ? AND agent_run_id = ?`,
          [options.authority.workspaceId, options.agentRunId],
        );
        const count = counts[0];
        if (
          (options.purpose === "memory_observation" &&
            Number(count?.memoryCount ?? 0) >= run.maximumModelCalls) ||
          (options.purpose === "thread_title" &&
            Number(count?.titleCount ?? 0) >= 1) ||
          (options.purpose !== "memory_observation" &&
            options.purpose !== "thread_title" &&
            Number(count?.mainCount ?? 0) >= run.maximumModelCalls)
        ) {
          return invalid(
            "agent.limit_exceeded",
            "Agent Run model call limit was exceeded.",
          );
        }
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_model_call (
             id,
             workspace_id,
             agent_run_id,
             call_number,
             purpose,
             lifecycle_status,
             model_profile_key,
             input_digest,
             output_digest,
             finish_reason,
             terminal_reason_code,
             version,
             created_at,
             updated_at,
             completed_at
           ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, 1, ?, ?, NULL)`,
          [
            options.modelCallId,
            options.authority.workspaceId,
            options.agentRunId,
            options.callNumber,
            options.purpose,
            options.modelProfileKey,
            options.inputDigest,
            options.now,
            options.now,
          ],
        );
        if (inserted.affectedRows !== 1) {
          return invalid(
            "agent.identity_conflict",
            "Agent Model Call could not be created.",
          );
        }
        return Object.freeze({
          id: options.modelCallId,
          workspaceId: options.authority.workspaceId,
          agentRunId: options.agentRunId,
          callNumber: options.callNumber,
          purpose: options.purpose,
          lifecycleStatus: "pending",
          modelProfileKey: options.modelProfileKey,
          inputDigest: options.inputDigest,
          version: 1,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async startModelAttempt(
      options: StartAgentModelAttemptOptions,
    ): Promise<AgentModelAttemptRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.modelCallId, "modelCallId");
      assertId(options.attemptId, "attemptId");
      if (options.attemptNumber < 1 || options.attemptNumber > 8) {
        invalid("agent.invalid_argument", "attemptNumber is invalid.");
      }
      const routeDigest = digestProviderValue(options.routeSnapshot);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const call = await readModelCall(
          connection,
          options.authority.workspaceId,
          { id: options.modelCallId },
          true,
        );
        if (!call || call.agentRunId !== options.agentRunId) {
          return invalid(
            "agent.model_call_not_found",
            "Agent Model Call was not found.",
          );
        }
        if (
          !(await agentModelCallAdmitted(connection, {
            ...options,
            purpose: call.purpose,
            workspaceId: options.authority.workspaceId,
            lifecycleStatus: run.lifecycleStatus,
            executionDeadlineAt: run.executionDeadlineAt,
          }))
        ) {
          return invalid(
            "agent.run_inactive",
            "Agent Run cannot start a model attempt in its current state.",
          );
        }
        if (!["pending", "running"].includes(call.lifecycleStatus)) {
          return invalid(
            "agent.state_conflict",
            "Agent Model Call is already terminal.",
          );
        }
        const replay = await readModelAttempt(
          connection,
          options.authority.workspaceId,
          {
            modelCallId: options.modelCallId,
            attemptNumber: options.attemptNumber,
          },
          true,
        );
        if (replay) {
          if (
            replay.id !== options.attemptId ||
            replay.transitionKind !== options.transitionKind ||
            replay.routeDigest !== routeDigest
          ) {
            return invalid(
              "agent.identity_conflict",
              "Agent Model Attempt number was reused with different input.",
            );
          }
          return modelAttemptFrom(replay);
        }
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_model_attempt (
             id,
             workspace_id,
             agent_model_call_id,
             attempt_number,
             transition_kind,
             lifecycle_status,
             route_snapshot,
             route_digest,
             provider_request_id,
             accepted_marker,
             usage_document,
             usage_digest,
             terminal_reason_code,
             created_at,
             started_at,
             completed_at
           ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
          [
            options.attemptId,
            options.authority.workspaceId,
            options.modelCallId,
            options.attemptNumber,
            options.transitionKind,
            JSON.stringify(options.routeSnapshot),
            routeDigest,
            options.now,
            options.now,
          ],
        );
        if (inserted.affectedRows !== 1) {
          return invalid(
            "agent.identity_conflict",
            "Agent Model Attempt could not be created.",
          );
        }
        if (call.lifecycleStatus === "pending") {
          const [callUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_model_call
               SET lifecycle_status = 'running',
                   version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ?
                 AND id = ?
                 AND version = ?
                 AND lifecycle_status = 'pending'`,
            [
              options.now,
              options.authority.workspaceId,
              options.modelCallId,
              call.version,
            ],
          );
          if (callUpdate.affectedRows !== 1) {
            return invalid(
              "agent.state_conflict",
              "Agent Model Call changed before its attempt started.",
            );
          }
        }
        return Object.freeze({
          id: options.attemptId,
          workspaceId: options.authority.workspaceId,
          agentModelCallId: options.modelCallId,
          attemptNumber: options.attemptNumber,
          transitionKind: options.transitionKind,
          lifecycleStatus: "running",
          routeSnapshot: options.routeSnapshot,
          routeDigest,
          accepted: false,
          createdAt: new Date(options.now),
          startedAt: new Date(options.now),
        });
      });
    },

    async completeModelAttempt(
      options: CompleteAgentModelAttemptOptions,
    ): Promise<{
      readonly call: AgentModelCallRecord;
      readonly attempt: AgentModelAttemptRecord;
    }> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.modelCallId, "modelCallId");
      assertId(options.attemptId, "attemptId");
      if (options.providerRequestId && options.providerRequestId.length > 512) {
        invalid("agent.invalid_argument", "providerRequestId is invalid.");
      }
      const usageDigest = options.usageDocument
        ? digestProviderValue(options.usageDocument)
        : undefined;
      if (options.status === "succeeded") {
        assertDigest(options.outputDigest, "outputDigest");
        if (
          options.finishReason.length < 1 ||
          options.finishReason.length > 40
        ) {
          invalid("agent.invalid_argument", "finishReason is invalid.");
        }
      } else {
        assertStableReason(options.terminalReasonCode, "terminalReasonCode");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const call = await readModelCall(
          connection,
          options.authority.workspaceId,
          { id: options.modelCallId },
          true,
        );
        if (!call || call.agentRunId !== options.agentRunId) {
          return invalid(
            "agent.model_call_not_found",
            "Agent Model Call was not found.",
          );
        }
        const attempt = await readModelAttempt(
          connection,
          options.authority.workspaceId,
          { id: options.attemptId },
          true,
        );
        if (!attempt || attempt.agentModelCallId !== options.modelCallId) {
          return invalid(
            "agent.model_attempt_not_found",
            "Agent Model Attempt was not found.",
          );
        }
        if (
          attempt.lifecycleStatus !== "running" ||
          call.lifecycleStatus !== "running"
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Model Attempt is already terminal.",
          );
        }
        const accepted = options.status === "succeeded";
        const [attemptUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_model_attempt
             SET lifecycle_status = ?,
                 provider_request_id = ?,
                 accepted_marker = ?,
                 usage_document = ?,
                 usage_digest = ?,
                 terminal_reason_code = ?,
                 completed_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND lifecycle_status = 'running'`,
          [
            options.status,
            options.providerRequestId ?? null,
            accepted ? true : null,
            options.usageDocument
              ? JSON.stringify(options.usageDocument)
              : null,
            usageDigest ?? null,
            options.status === "succeeded" ? null : options.terminalReasonCode,
            options.now,
            options.authority.workspaceId,
            options.attemptId,
          ],
        );
        if (attemptUpdate.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Model Attempt changed before completion.",
          );
        }
        const terminalForCall =
          options.status === "succeeded" || options.terminalForCall;
        let nextCall = call;
        if (terminalForCall) {
          const callStatus = terminalModelCallStatus(options.status);
          const [callUpdate] = await connection.execute<ResultSetHeader>(
            `UPDATE agent_model_call
               SET lifecycle_status = ?,
                   output_digest = ?,
                   finish_reason = ?,
                   terminal_reason_code = ?,
                   version = version + 1,
                   updated_at = ?,
                   completed_at = ?
               WHERE workspace_id = ?
                 AND id = ?
                 AND version = ?
                 AND lifecycle_status = 'running'`,
            [
              callStatus,
              options.status === "succeeded" ? options.outputDigest : null,
              options.status === "succeeded" ? options.finishReason : null,
              options.status === "succeeded"
                ? null
                : options.terminalReasonCode,
              options.now,
              options.now,
              options.authority.workspaceId,
              options.modelCallId,
              call.version,
            ],
          );
          if (callUpdate.affectedRows !== 1) {
            return invalid(
              "agent.state_conflict",
              "Agent Model Call changed before completion.",
            );
          }
          nextCall = {
            ...call,
            lifecycleStatus: callStatus,
            outputDigest:
              options.status === "succeeded" ? options.outputDigest : null,
            finishReason:
              options.status === "succeeded" ? options.finishReason : null,
            terminalReasonCode:
              options.status === "succeeded"
                ? null
                : options.terminalReasonCode,
            version: call.version + 1,
            updatedAt: options.now,
            completedAt: options.now,
          };
        }
        const nextAttempt: AgentModelAttemptRow = {
          ...attempt,
          lifecycleStatus: options.status,
          providerRequestId: options.providerRequestId ?? null,
          acceptedMarker: accepted ? 1 : null,
          usageDocument: options.usageDocument ?? null,
          usageDigest: usageDigest ?? null,
          terminalReasonCode:
            options.status === "succeeded" ? null : options.terminalReasonCode,
          completedAt: options.now,
        };
        return Object.freeze({
          call: modelCallFrom(nextCall),
          attempt: modelAttemptFrom(nextAttempt),
        });
      });
    },

    async recordCanvasExport(options: RecordAgentCanvasExportOptions) {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.actionReceiptId, "actionReceiptId");
      assertId(options.request.canvasDraftId, "canvasDraftId");
      if (
        !Number.isSafeInteger(options.request.documentVersion) ||
        options.request.documentVersion < 1 ||
        !options.request.pageId ||
        options.request.pageId.length > 160
      ) {
        return invalid(
          "agent.invalid_argument",
          "Canvas export request is invalid.",
        );
      }
      const payload = {
        kind: "canvas_export",
        request: options.request,
        ...(options.completion ? { completion: options.completion } : {}),
      };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized) > 16_384)
        return invalid(
          "agent.invalid_argument",
          "Canvas export receipt is too large.",
        );
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const action = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          true,
        );
        if (
          !action ||
          action.agentRunId !== run.id ||
          action.toolKey !== "canvas.export-png"
        )
          return invalid(
            "agent.action_not_found",
            "Canvas export action is unavailable.",
          );
        const previous =
          action.proposalDocument === null
            ? undefined
            : jsonRecord(action.proposalDocument, "Canvas export receipt");
        if (previous) {
          if (
            digestProviderValue(previous.request) !==
            digestProviderValue(options.request)
          )
            return invalid(
              "agent.identity_conflict",
              "Canvas export snapshot changed.",
            );
          if (previous.completion || !options.completion)
            return actionReceiptFrom(action);
        } else if (options.completion) {
          return invalid(
            "agent.state_conflict",
            "Canvas export was not requested.",
          );
        }
        const verifiedLateSuccess =
          options.completion?.status === "succeeded" &&
          (action.lifecycleStatus === "failed" ||
            action.lifecycleStatus === "cancelled");
        if (
          (!verifiedLateSuccess &&
            (run.lifecycleStatus !== "running" ||
              action.lifecycleStatus !== "running")) ||
          action.version !== options.expectedVersion
        )
          return invalid(
            "agent.state_conflict",
            "Canvas export is no longer running.",
          );
        await connection.execute(
          `UPDATE agent_action_receipt SET proposal_document = ?, output_digest = ?, version = version + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            serialized,
            digestProviderValue(payload),
            options.now,
            options.authority.workspaceId,
            action.id,
            action.version,
          ],
        );
        return actionReceiptFrom({
          ...action,
          proposalDocument: payload,
          outputDigest: digestProviderValue(payload),
          version: action.version + 1,
          updatedAt: options.now,
        });
      });
    },

    async proposeAction(
      options: ProposeAgentActionOptions,
    ): Promise<AgentActionReceiptRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.actionReceiptId, "actionReceiptId");
      assertDigest(options.inputDigest, "inputDigest");
      if (
        options.actionNumber < 1 ||
        options.toolCallId.length < 1 ||
        options.toolCallId.length > 160 ||
        !stableKeyPattern.test(options.toolKey) ||
        ![
          "read",
          "compute",
          "internal_write",
          "external_write",
          "destructive",
        ].includes(options.effect) ||
        !["none", "before_call", "before_commit"].includes(options.approvalMode)
      ) {
        invalid("agent.invalid_argument", "Agent Action proposal is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        if (
          run.lifecycleStatus !== "running" ||
          options.actionNumber > run.maximumToolCalls
        ) {
          return invalid(
            options.actionNumber > run.maximumToolCalls
              ? "agent.limit_exceeded"
              : "agent.run_inactive",
            "Agent Run cannot propose this action.",
          );
        }
        const replay = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          {
            agentRunId: options.agentRunId,
            actionNumber: options.actionNumber,
          },
          true,
        );
        if (replay) {
          if (
            replay.id !== options.actionReceiptId ||
            replay.toolCallId !== options.toolCallId ||
            replay.toolKey !== options.toolKey ||
            replay.effect !== options.effect ||
            replay.approvalMode !== options.approvalMode ||
            replay.inputDigest !== options.inputDigest
          ) {
            return invalid(
              "agent.identity_conflict",
              "Agent Action number was reused with different input.",
            );
          }
          return actionReceiptFrom(replay);
        }
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_action_receipt (
             id, workspace_id, agent_run_id, action_number, tool_call_id,
             tool_key, effect, approval_mode, lifecycle_status, input_digest,
             output_digest, outcome_kind, query_result_count, canvas_draft_id,
             capability_run_id, workflow_run_id, workflow_definition_id,
             before_version, after_version, undo_group_id,
             terminal_reason_code, version, created_at, updated_at,
             completed_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             NULL, 1, ?, ?, NULL
           )`,
          [
            options.actionReceiptId,
            options.authority.workspaceId,
            options.agentRunId,
            options.actionNumber,
            options.toolCallId,
            options.toolKey,
            options.effect,
            options.approvalMode,
            options.inputDigest,
            options.now,
            options.now,
          ],
        );
        if (inserted.affectedRows !== 1) {
          return invalid(
            "agent.identity_conflict",
            "Agent Action proposal could not be recorded.",
          );
        }
        return Object.freeze({
          id: options.actionReceiptId,
          workspaceId: options.authority.workspaceId,
          agentRunId: options.agentRunId,
          actionNumber: options.actionNumber,
          toolCallId: options.toolCallId,
          toolKey: options.toolKey,
          effect: options.effect,
          approvalMode: options.approvalMode,
          lifecycleStatus: "proposed",
          inputDigest: options.inputDigest,
          version: 1,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async transitionAction(
      options: TransitionAgentActionOptions,
    ): Promise<AgentActionReceiptRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.actionReceiptId, "actionReceiptId");
      if (options.expectedVersion < 1) {
        invalid("agent.invalid_argument", "expectedVersion is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const action = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          true,
        );
        if (!action || action.agentRunId !== options.agentRunId) {
          return invalid(
            "agent.action_not_found",
            "Agent Action was not found.",
          );
        }
        if (
          action.version !== options.expectedVersion ||
          !agentActionTransitionAllowed(
            action.lifecycleStatus,
            options.toStatus,
          )
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Action transition lost optimistic concurrency.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_action_receipt
             SET lifecycle_status = ?, version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = ?`,
          [
            options.toStatus,
            options.now,
            options.authority.workspaceId,
            options.actionReceiptId,
            action.version,
            action.lifecycleStatus,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Action transition lost optimistic concurrency.",
          );
        }
        return actionReceiptFrom({
          ...action,
          lifecycleStatus: options.toStatus,
          version: action.version + 1,
          updatedAt: options.now,
        });
      });
    },

    async recordActionPreview(
      options: PreviewAgentActionOptions,
    ): Promise<AgentActionReceiptRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.actionReceiptId, "actionReceiptId");
      assertDigest(options.outputDigest, "outputDigest");
      const proposalJson = JSON.stringify(options.proposalDocument);
      if (
        options.expectedVersion < 1 ||
        proposalJson.length < 2 ||
        Buffer.byteLength(proposalJson, "utf8") > 65_536 ||
        digestProviderValue(options.proposalDocument) !== options.outputDigest
      ) {
        invalid("agent.invalid_argument", "Agent Action preview is invalid.");
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const action = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          true,
        );
        if (!action || action.agentRunId !== options.agentRunId) {
          return invalid(
            "agent.action_not_found",
            "Agent Action was not found.",
          );
        }
        if (
          action.version !== options.expectedVersion ||
          action.lifecycleStatus !== "running" ||
          action.approvalMode !== "before_commit" ||
          !agentActionTransitionAllowed("running", "waiting_approval")
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Action cannot record a preview in its current state.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_action_receipt
             SET lifecycle_status = 'waiting_approval', output_digest = ?,
                 proposal_document = ?, version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = 'running'
               AND approval_mode = 'before_commit'`,
          [
            options.outputDigest,
            proposalJson,
            options.now,
            options.authority.workspaceId,
            options.actionReceiptId,
            action.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Action preview lost optimistic concurrency.",
          );
        }
        return actionReceiptFrom({
          ...action,
          lifecycleStatus: "waiting_approval",
          outputDigest: options.outputDigest,
          proposalDocument: options.proposalDocument,
          version: action.version + 1,
          updatedAt: options.now,
        });
      });
    },

    async declinePendingAction(options: DeclinePendingAgentActionOptions) {
      assertId(options.actionReceiptId, "actionReceiptId");
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const initial = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          false,
        );
        if (!initial) {
          return invalid(
            "agent.action_not_found",
            "Agent Action was not found.",
          );
        }
        const run = await requireOwnedRun(
          connection,
          options.authority,
          initial.agentRunId,
          true,
        );
        const action = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          true,
        );
        if (!action || action.agentRunId !== run.id) {
          return invalid(
            "agent.action_not_found",
            "Agent Action was not found.",
          );
        }
        const reason = "agent.action_declined";
        const terminalRun = ["succeeded", "failed", "cancelled"].includes(
          run.lifecycleStatus,
        );
        if (
          action.lifecycleStatus === "cancelled" &&
          action.terminalReasonCode === reason &&
          terminalRun
        ) {
          return Object.freeze({
            action: actionReceiptFrom(action),
            run: runFrom(run),
            replayed: true,
          });
        }
        if (
          action.lifecycleStatus !== "waiting_approval" ||
          (!terminalRun && run.lifecycleStatus !== "waiting_approval") ||
          !agentActionTransitionAllowed(action.lifecycleStatus, "cancelled") ||
          (!terminalRun &&
            !agentRunTransitionAllowed(run.lifecycleStatus, "cancelled"))
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Action is not waiting for a decision.",
          );
        }
        const [actionUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_action_receipt
             SET lifecycle_status = 'cancelled', terminal_reason_code = ?,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = 'waiting_approval'`,
          [
            reason,
            options.now,
            options.now,
            options.authority.workspaceId,
            action.id,
            action.version,
          ],
        );
        if (actionUpdated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Action decline lost optimistic concurrency.",
          );
        }
        if (terminalRun) {
          return Object.freeze({
            action: actionReceiptFrom({
              ...action,
              lifecycleStatus: "cancelled",
              terminalReasonCode: reason,
              version: action.version + 1,
              updatedAt: options.now,
              completedAt: options.now,
            }),
            run: runFrom(run),
            replayed: false,
          });
        }
        const [runUpdated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_run
             SET lifecycle_status = 'cancelled', terminal_reason_code = ?,
                 version = version + 1, updated_at = ?, completed_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = 'waiting_approval'`,
          [
            reason,
            options.now,
            options.now,
            options.authority.workspaceId,
            run.id,
            run.version,
          ],
        );
        if (runUpdated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Run decline lost optimistic concurrency.",
          );
        }
        return Object.freeze({
          action: actionReceiptFrom({
            ...action,
            lifecycleStatus: "cancelled",
            terminalReasonCode: reason,
            version: action.version + 1,
            updatedAt: options.now,
            completedAt: options.now,
          }),
          run: runFrom({
            ...run,
            lifecycleStatus: "cancelled",
            terminalReasonCode: reason,
            version: run.version + 1,
            updatedAt: options.now,
            completedAt: options.now,
          }),
          replayed: false,
        });
      });
    },

    async getAction(
      authority: TrustedWorkspaceScope,
      actionReceiptId: string,
      now: Date,
    ): Promise<AgentActionReceiptRecord | undefined> {
      assertId(actionReceiptId, "actionReceiptId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        const action = await readActionReceipt(
          connection,
          authority.workspaceId,
          { id: actionReceiptId },
          false,
        );
        if (!action) return undefined;
        await requireOwnedRun(connection, authority, action.agentRunId, false);
        return actionReceiptFrom(action);
      });
    },

    async listRunActions(
      authority: TrustedWorkspaceScope,
      agentRunId: string,
      now: Date,
    ): Promise<readonly AgentActionReceiptRecord[]> {
      assertId(agentRunId, "agentRunId");
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "agent.run",
          now,
        );
        await requireOwnedRun(connection, authority, agentRunId, false);
        const [rows] = await connection.execute<AgentActionReceiptRow[]>(
          `SELECT
             id, workspace_id AS workspaceId, agent_run_id AS agentRunId,
             action_number AS actionNumber, tool_call_id AS toolCallId,
             tool_key AS toolKey, effect, approval_mode AS approvalMode,
             lifecycle_status AS lifecycleStatus, input_digest AS inputDigest,
             output_digest AS outputDigest,
             proposal_document AS proposalDocument,
             outcome_kind AS outcomeKind,
             query_result_count AS queryResultCount, query_diagnostics AS queryDiagnostics,
             canvas_draft_id AS canvasDraftId,
             capability_run_id AS capabilityRunId,
             workflow_run_id AS workflowRunId,
             workflow_definition_id AS workflowDefinitionId,
             skill_draft_id AS skillDraftId,
             brand_kit_id AS brandKitId,
             brand_kit_revision_id AS brandKitRevisionId,
             before_version AS beforeVersion, after_version AS afterVersion,
             undo_group_id AS undoGroupId,
             terminal_reason_code AS terminalReasonCode, version,
             created_at AS createdAt, updated_at AS updatedAt,
             completed_at AS completedAt
           FROM agent_action_receipt
           WHERE workspace_id = ? AND agent_run_id = ?
           ORDER BY action_number`,
          [authority.workspaceId, agentRunId],
        );
        return Object.freeze(rows.map(actionReceiptFrom));
      });
    },

    async completeAction(
      options: CompleteAgentActionOptions,
    ): Promise<AgentActionReceiptRecord> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.actionReceiptId, "actionReceiptId");
      if (options.expectedVersion < 1) {
        invalid("agent.invalid_argument", "expectedVersion is invalid.");
      }
      if (options.status === "succeeded") {
        assertDigest(options.outputDigest, "outputDigest");
      } else {
        assertStableReason(options.terminalReasonCode, "terminalReasonCode");
      }
      const outcome =
        options.status === "succeeded" ? options.outcomeReference : undefined;
      if (outcome) {
        if (outcome.kind === "query" && outcome.resultCount < 0) {
          invalid("agent.invalid_argument", "Agent query outcome is invalid.");
        }
        if (outcome.kind === "canvas_command") {
          assertId(outcome.canvasDraftId, "canvasDraftId");
        } else if (outcome.kind === "capability_run") {
          assertId(outcome.capabilityRunId, "capabilityRunId");
        } else if (outcome.kind === "workflow_run") {
          assertId(outcome.workflowRunId, "workflowRunId");
        } else if (outcome.kind === "workflow_draft_command") {
          assertId(outcome.workflowDefinitionId, "workflowDefinitionId");
        } else if (outcome.kind === "skill_draft") {
          assertId(outcome.skillDraftId, "skillDraftId");
        } else if (outcome.kind === "brand_revision") {
          assertId(outcome.brandKitId, "brandKitId");
          assertId(outcome.brandKitRevisionId, "brandKitRevisionId");
        }
      }
      return inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        const action = await readActionReceipt(
          connection,
          options.authority.workspaceId,
          { id: options.actionReceiptId },
          true,
        );
        if (!action || action.agentRunId !== options.agentRunId) {
          return invalid(
            "agent.action_not_found",
            "Agent Action was not found.",
          );
        }
        if (action.lifecycleStatus === options.status) {
          const replay = actionReceiptFrom(action);
          const matches =
            options.status === "succeeded"
              ? replay.outputDigest === options.outputDigest &&
                actionOutcomeMatches(replay.outcomeReference, outcome)
              : replay.terminalReasonCode === options.terminalReasonCode;
          if (!matches) {
            return invalid(
              "agent.identity_conflict",
              "Agent Action completion was replayed with different output.",
            );
          }
          return replay;
        }
        if (
          action.version !== options.expectedVersion ||
          !agentActionTransitionAllowed(action.lifecycleStatus, options.status)
        ) {
          return invalid(
            "agent.state_conflict",
            "Agent Action completion lost optimistic concurrency.",
          );
        }
        const values = actionOutcomeValues(outcome);
        const diagnostics =
          outcome?.kind === "query" && outcome.diagnostics
            ? parseAgentDiscoveryDiagnostics(outcome.diagnostics)
            : undefined;

        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_action_receipt
             SET lifecycle_status = ?, output_digest = ?,
                 outcome_kind = ?, query_result_count = ?,
                 canvas_draft_id = ?, capability_run_id = ?,
                 workflow_run_id = ?, workflow_definition_id = ?,
                 skill_draft_id = ?, before_version = ?, after_version = ?, undo_group_id = ?,
                 brand_kit_id = ?, brand_kit_revision_id = ?,
                 terminal_reason_code = ?, version = version + 1,
                 updated_at = ?, completed_at = ?, query_diagnostics = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = ?`,
          [
            options.status,
            options.status === "succeeded" ? options.outputDigest : null,
            ...values,
            options.status === "succeeded" ? null : options.terminalReasonCode,
            options.now,
            options.now,
            diagnostics ? JSON.stringify(diagnostics) : null,
            options.authority.workspaceId,
            options.actionReceiptId,
            action.version,
            action.lifecycleStatus,
          ],
        );
        if (updated.affectedRows !== 1) {
          return invalid(
            "agent.state_conflict",
            "Agent Action completion lost optimistic concurrency.",
          );
        }
        const [
          outcomeKind,
          queryResultCount,
          canvasDraftId,
          capabilityRunId,
          workflowRunId,
          workflowDefinitionId,
          skillDraftId,
          beforeVersion,
          afterVersion,
          undoGroupId,
          brandKitId,
          brandKitRevisionId,
        ] = values;
        return actionReceiptFrom({
          ...action,
          queryDiagnostics: diagnostics ?? null,
          lifecycleStatus: options.status,
          outputDigest:
            options.status === "succeeded" ? options.outputDigest : null,
          outcomeKind: typeof outcomeKind === "string" ? outcomeKind : null,
          queryResultCount:
            typeof queryResultCount === "number" ? queryResultCount : null,
          canvasDraftId:
            typeof canvasDraftId === "string" ? canvasDraftId : null,
          capabilityRunId:
            typeof capabilityRunId === "string" ? capabilityRunId : null,
          workflowRunId:
            typeof workflowRunId === "string" ? workflowRunId : null,
          workflowDefinitionId:
            typeof workflowDefinitionId === "string"
              ? workflowDefinitionId
              : null,
          skillDraftId: typeof skillDraftId === "string" ? skillDraftId : null,
          beforeVersion:
            typeof beforeVersion === "number" ? beforeVersion : null,
          afterVersion: typeof afterVersion === "number" ? afterVersion : null,
          undoGroupId: typeof undoGroupId === "string" ? undoGroupId : null,
          brandKitId: typeof brandKitId === "string" ? brandKitId : null,
          brandKitRevisionId:
            typeof brandKitRevisionId === "string" ? brandKitRevisionId : null,
          terminalReasonCode:
            options.status === "succeeded" ? null : options.terminalReasonCode,
          version: action.version + 1,
          updatedAt: options.now,
          completedAt: options.now,
        });
      });
    },

    async appendAssistantMessage(
      options: AppendAgentAssistantMessageOptions,
    ): Promise<void> {
      assertId(options.agentRunId, "agentRunId");
      assertId(options.messageId, "messageId");
      if (
        options.message.schemaVersion !== 1 ||
        options.message.role !== "assistant"
      ) {
        invalid(
          "agent.invalid_argument",
          "Agent assistant message is invalid.",
        );
      }
      assertMessageParts(
        options.message.parts,
        "assistant",
        "agent.invalid_argument",
      );
      if (options.modelMessages) modelMessages(options.modelMessages);
      const contentDigest = digestProviderValue(options.message);
      await inThreadMutation(pool, options, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const run = await requireOwnedRun(
          connection,
          options.authority,
          options.agentRunId,
          true,
        );
        if (run.lifecycleStatus !== "running") {
          return invalid(
            "agent.run_inactive",
            "Agent Run cannot append an assistant message.",
          );
        }
        if (options.workerClaim) {
          const [claims] = await connection.execute<RowDataPacket[]>(
            `SELECT agent_run_id FROM agent_run_dispatch WHERE workspace_id = ? AND agent_run_id = ?
             AND delivery_status = 'claimed' AND claim_owner = ? AND claim_token_digest = ? AND lease_expires_at > ? FOR UPDATE`,
            [
              options.authority.workspaceId,
              options.agentRunId,
              options.workerClaim.workerId,
              options.workerClaim.claimTokenDigest,
              options.now,
            ],
          );
          if (!claims.length)
            return invalid(
              "agent.state_conflict",
              "Agent Worker no longer owns the Run.",
            );
        }
        const [existing] = await connection.execute<AgentMessageRow[]>(
          `SELECT id, workspace_id AS workspaceId, thread_id AS threadId,
                  agent_run_id AS agentRunId,
                  sequence_number AS sequenceNumber, content,
                  created_at AS createdAt
             FROM agent_message
            WHERE workspace_id = ? AND id = ?
            LIMIT 1 FOR UPDATE`,
          [options.authority.workspaceId, options.messageId],
        );
        const current = existing[0];
        if (current) {
          if (
            current.agentRunId !== options.agentRunId ||
            current.threadId !== run.threadId
          ) {
            return invalid(
              "agent.integrity_violation",
              "Agent assistant message identity is inconsistent.",
            );
          }
          await connection.execute<ResultSetHeader>(
            `UPDATE agent_message SET content = ?, content_digest = ?,
                   model_messages = COALESCE(?, model_messages)
              WHERE workspace_id = ? AND id = ?`,
            [
              JSON.stringify(options.message),
              contentDigest,
              options.modelMessages
                ? JSON.stringify(options.modelMessages)
                : null,
              options.authority.workspaceId,
              options.messageId,
            ],
          );
          return;
        }
        const [sequences] = await connection.execute<MessageSequenceRow[]>(
          `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS nextSequence
             FROM agent_message
             WHERE workspace_id = ?
               AND thread_id = ?`,
          [options.authority.workspaceId, run.threadId],
        );
        const triggerMessageId =
          run.triggerMessageId ??
          invalid(
            "agent.integrity_violation",
            "Agent Run has no triggering user message.",
          );
        const [alternatives] = await connection.execute<
          MessageAlternativeRow[]
        >(
          `SELECT COALESCE(MAX(alternative_index), 0) + 1 AS nextAlternative
             FROM agent_message
            WHERE workspace_id = ? AND thread_id = ?
              AND parent_message_id = ? AND role = 'assistant'`,
          [options.authority.workspaceId, run.threadId, triggerMessageId],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_message (
             id, workspace_id, thread_id, agent_run_id, parent_message_id,
             sequence_number, alternative_index, role, content,
             content_digest, created_at, model_messages
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'assistant', ?, ?, ?, ?)`,
          [
            options.messageId,
            options.authority.workspaceId,
            run.threadId,
            options.agentRunId,
            triggerMessageId,
            sequences[0]?.nextSequence ?? 1,
            alternatives[0]?.nextAlternative ?? 1,
            JSON.stringify(options.message),
            contentDigest,
            options.now,
            options.modelMessages
              ? JSON.stringify(options.modelMessages)
              : null,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE agent_thread
              SET active_leaf_message_id = ?, version = version + 1,
                  updated_at = ?
            WHERE workspace_id = ? AND id = ? AND active_run_id = ?`,
          [
            options.messageId,
            options.now,
            options.authority.workspaceId,
            run.threadId,
            options.agentRunId,
          ],
        );
      });
    },
  });
}
