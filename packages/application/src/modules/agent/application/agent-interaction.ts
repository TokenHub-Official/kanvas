import type { TrustedWorkspaceScope } from "../../authorization/index.js";
import type { AgentRunRecord } from "./agent-runtime.js";

export type AgentInteractionStatus =
  "pending" | "submitted" | "skipped" | "cancelled";

export interface AgentQuestionOptionV1 {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;
}

export interface AgentQuestionItemV1 {
  readonly key: string;
  readonly header: string;
  readonly question: string;
  readonly multiSelect?: boolean;
  readonly options: readonly AgentQuestionOptionV1[];
}

export interface AgentQuestionRequestV1 {
  readonly schemaVersion: 1;
  readonly kind: "question";
  readonly questions: readonly AgentQuestionItemV1[];
}

export interface AgentQuestionAnswerV1 {
  readonly questionKey: string;
  readonly optionKeys: readonly string[];
  readonly customText?: string;
}

export type AgentQuestionResponseV1 =
  | {
      readonly schemaVersion: 1;
      readonly outcome: "submitted";
      readonly answers: readonly AgentQuestionAnswerV1[];
      readonly supplement?: string;
    }
  | { readonly schemaVersion: 1; readonly outcome: "skipped" }
  | { readonly schemaVersion: 1; readonly outcome: "cancelled" };

export interface AgentInteractionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly agentRunId: string;
  readonly assistantMessageId: string;
  readonly interactionNumber: number;
  readonly toolCallId: string;
  readonly toolKey: "builtin.ask-question";
  readonly lifecycleStatus: AgentInteractionStatus;
  readonly request: AgentQuestionRequestV1;
  readonly response?: AgentQuestionResponseV1;
  readonly checkpoint: unknown;
  readonly requestDigest: string;
  readonly responseDigest?: string;
  readonly checkpointDigest: string;
  readonly resolutionRequestKey?: string;
  readonly resolvedByPrincipalId?: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export interface SuspendAgentQuestionInteractionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly interactionId: string;
  readonly agentRunId: string;
  readonly assistantMessageId: string;
  readonly toolCallId: string;
  readonly request: AgentQuestionRequestV1;
  readonly checkpoint: unknown;
  readonly expectedRunVersion: number;
  readonly workerId: string;
  readonly claimTokenDigest: string;
  readonly now: Date;
}

export interface ResolveAgentQuestionInteractionOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly interactionId: string;
  readonly expectedVersion: number;
  readonly resolutionRequestKey: string;
  readonly response: AgentQuestionResponseV1;
  readonly now: Date;
}

export interface ResolvedAgentQuestionInteraction {
  readonly interaction: AgentInteractionRecord;
  readonly run: AgentRunRecord;
  readonly replayed: boolean;
}

export function agentInteractionStatusForResponse(
  response: AgentQuestionResponseV1,
): Exclude<AgentInteractionStatus, "pending"> {
  return response.outcome;
}
