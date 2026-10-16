import type {
  AgentActionOutcomeReference,
  AgentActionReceiptRecord,
  AgentRuntimeRepository,
  TrustedWorkspaceScope,
} from "@kanvas/application";

import type {
  KanvasAgentToolApprovalMode,
  KanvasAgentToolDescriptor,
  KanvasAgentToolEffect,
} from "./tool-view.js";

export interface AgentToolReceiptIdentityFactory {
  readonly actionReceiptId: (actionNumber: number) => string;
}

export interface CreateAgentToolReceiptCoordinatorOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly facts: AgentRuntimeRepository;
  readonly descriptors: readonly KanvasAgentToolDescriptor[];
  readonly identities: AgentToolReceiptIdentityFactory;
  readonly digest: (value: unknown) => string;
  readonly initialActionNumber?: number;
  readonly now?: () => Date;
}

export interface AgentToolCallInputAvailable {
  readonly toolCallId: string;
  readonly toolKey: string;
  readonly input: unknown;
}

export interface CompleteAgentToolCallOptions {
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly output: unknown;
  readonly outcomeReference?: AgentActionOutcomeReference;
}

export interface FailAgentToolCallOptions {
  readonly actionReceiptId: string;
  readonly expectedVersion: number;
  readonly status: "failed" | "cancelled";
  readonly terminalReasonCode: string;
}

export interface AgentToolReceiptCoordinator {
  inputAvailable(
    options: AgentToolCallInputAvailable,
  ): Promise<AgentActionReceiptRecord>;
  approvalGranted(options: {
    readonly actionReceiptId: string;
    readonly expectedVersion: number;
  }): Promise<AgentActionReceiptRecord>;
  complete(
    options: CompleteAgentToolCallOptions,
  ): Promise<AgentActionReceiptRecord>;
  preview(options: {
    readonly actionReceiptId: string;
    readonly expectedVersion: number;
    readonly proposalDocument: Readonly<Record<string, unknown>>;
  }): Promise<AgentActionReceiptRecord>;
  fail(options: FailAgentToolCallOptions): Promise<AgentActionReceiptRecord>;
}

function actionEffect(
  effect: KanvasAgentToolEffect,
): AgentActionReceiptRecord["effect"] {
  if (effect === "internal-write") return "internal_write";
  if (effect === "external-write") return "external_write";
  return effect;
}

function approvalMode(
  mode: KanvasAgentToolApprovalMode,
): AgentActionReceiptRecord["approvalMode"] {
  if (mode === "before-call") return "before_call";
  if (mode === "before-commit") return "before_commit";
  return mode;
}

export function createAgentToolReceiptCoordinator(
  options: CreateAgentToolReceiptCoordinatorOptions,
): AgentToolReceiptCoordinator {
  const descriptors = new Map(
    options.descriptors.map((descriptor) => [descriptor.key, descriptor]),
  );
  const actionNumbers = new Map<string, number>();
  const initialActionNumber = options.initialActionNumber ?? 1;
  if (!Number.isSafeInteger(initialActionNumber) || initialActionNumber < 1) {
    throw new Error("Agent Tool receipt initial action number is invalid.");
  }
  let nextActionNumber = initialActionNumber;
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async inputAvailable(
      input: AgentToolCallInputAvailable,
    ): Promise<AgentActionReceiptRecord> {
      const descriptor = descriptors.get(input.toolKey);
      if (!descriptor) {
        throw new Error("Agent Tool Call is outside the current ToolView.");
      }
      let actionNumber = actionNumbers.get(input.toolCallId);
      if (actionNumber === undefined) {
        actionNumber = nextActionNumber;
        nextActionNumber += 1;
        actionNumbers.set(input.toolCallId, actionNumber);
      }
      const actionReceiptId = options.identities.actionReceiptId(actionNumber);
      const proposed = await options.facts.proposeAction({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId,
        actionNumber,
        toolCallId: input.toolCallId,
        toolKey: descriptor.key,
        effect: actionEffect(descriptor.effect),
        approvalMode: approvalMode(descriptor.approvalMode),
        inputDigest: options.digest(input.input),
        now: now(),
      });
      const targetStatus =
        descriptor.approvalMode === "before-call"
          ? "waiting_approval"
          : "running";
      if (
        proposed.lifecycleStatus === targetStatus ||
        proposed.lifecycleStatus === "succeeded"
      ) {
        return proposed;
      }
      if (proposed.lifecycleStatus !== "proposed") {
        throw new Error("Agent Tool Call replay is not executable.");
      }
      return options.facts.transitionAction({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId,
        expectedVersion: proposed.version,
        toStatus: targetStatus,
        now: now(),
      });
    },

    approvalGranted(input: {
      readonly actionReceiptId: string;
      readonly expectedVersion: number;
    }): Promise<AgentActionReceiptRecord> {
      return options.facts.transitionAction({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId: input.actionReceiptId,
        expectedVersion: input.expectedVersion,
        toStatus: "running",
        now: now(),
      });
    },

    complete(
      input: CompleteAgentToolCallOptions,
    ): Promise<AgentActionReceiptRecord> {
      return options.facts.completeAction({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId: input.actionReceiptId,
        expectedVersion: input.expectedVersion,
        status: "succeeded",
        outputDigest: options.digest(input.output),
        ...(input.outcomeReference
          ? { outcomeReference: input.outcomeReference }
          : {}),
        now: now(),
      });
    },

    preview(
      input: Parameters<AgentToolReceiptCoordinator["preview"]>[0],
    ): Promise<AgentActionReceiptRecord> {
      return options.facts.recordActionPreview({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId: input.actionReceiptId,
        expectedVersion: input.expectedVersion,
        outputDigest: options.digest(input.proposalDocument),
        proposalDocument: input.proposalDocument,
        now: now(),
      });
    },

    fail(input: FailAgentToolCallOptions): Promise<AgentActionReceiptRecord> {
      return options.facts.completeAction({
        authority: options.authority,
        agentRunId: options.agentRunId,
        actionReceiptId: input.actionReceiptId,
        expectedVersion: input.expectedVersion,
        status: input.status,
        terminalReasonCode: input.terminalReasonCode,
        now: now(),
      });
    },
  });
}
