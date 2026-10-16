import {
  agentModelRequestDigestDocument,
  type AgentModelBudgetPort,
  type KanvasAgentModelResponse,
} from "@kanvas/agent-runtime";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  BudgetReservationStore,
  ResolvedAgentModelBinding,
} from "@kanvas/database/runtime";

import { resolveProviderCapturedAmount } from "../provider/provider-pricing-calculator.js";

export interface AgentModelBudgetIdentityFactory {
  readonly reservationId: (modelCallId: string) => string;
  readonly reserveLedgerEntryId: (modelCallId: string) => string;
  readonly settleLedgerEntryId: (modelCallId: string) => string;
  readonly auditEventId: (
    modelCallId: string,
    phase: "reserve" | "settle",
  ) => string;
}

export interface AgentModelBudgetReservation {
  readonly reservationId: string;
  readonly requestDigest: string;
}

export class AgentModelBudgetError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "AgentModelBudgetError";
  }
}

function snapshotString(
  snapshot: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = snapshot[key];
  if (typeof value !== "string") {
    throw new AgentModelBudgetError("agent.model_binding_invalid");
  }
  return value;
}

function usageMetrics(response: KanvasAgentModelResponse) {
  const metrics: Array<{
    readonly metricKey: string;
    readonly numericValue: string;
    readonly unitCode: "token";
  }> = [];
  const add = (metricKey: string, value: number | undefined): void => {
    if (value !== undefined) {
      metrics.push({
        metricKey,
        numericValue: String(value),
        unitCode: "token",
      });
    }
  };
  add("input_tokens", response.usage?.inputTokens);
  add("input_tokens_no_cache", response.usage?.inputTokensNoCache);
  add("input_text_tokens", response.usage?.inputTokens);
  add("cache_read_tokens", response.usage?.cacheReadTokens);
  add("cache_write_tokens", response.usage?.cacheWriteTokens);
  add("output_tokens", response.usage?.outputTokens);
  add("output_text_tokens", response.usage?.outputTextTokens);
  add("reasoning_tokens", response.usage?.reasoningTokens);
  return Object.freeze(metrics);
}

export function createAgentModelBudgetPort(options: {
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly budgets: BudgetReservationStore;
  readonly identities: AgentModelBudgetIdentityFactory;
  readonly digest: (value: unknown) => string;
}): AgentModelBudgetPort<
  ResolvedAgentModelBinding,
  AgentModelBudgetReservation
> {
  type BudgetPort = AgentModelBudgetPort<
    ResolvedAgentModelBinding,
    AgentModelBudgetReservation
  >;
  const audit = (modelCallId: string, phase: "reserve" | "settle") => ({
    auditEventId: options.identities.auditEventId(modelCallId, phase),
    actorPrincipalId: options.authority.principalId,
    actorType: options.authority.principalType,
    authenticationRefType: options.authority.authenticationRefType,
    authenticationRefHash: options.digest({
      authenticationRefId: options.authority.authenticationRefId,
    }),
    authorityType: options.authority.authorityType,
    authorityId: options.authority.authorityId,
    authorityVersion: options.authority.authorityVersion,
  });

  const port: BudgetPort = {
    async reserve(input: Parameters<BudgetPort["reserve"]>[0]) {
      const { route, modelCallId, request, agentRunId, now } = input;
      const requestDigest = options.digest({
        modelCallId,
        request: agentModelRequestDigestDocument(request),
        routeDigest: route.snapshot.routeDigest,
        maximumCharge: route.maximumCharge,
      });
      const result = await options.budgets.reserve({
        reservationId: options.identities.reservationId(modelCallId),
        ledgerEntryId: options.identities.reserveLedgerEntryId(modelCallId),
        workspaceId: options.authority.workspaceId,
        budgetAccountId: route.budgetAccountId,
        reservationKey: `agent-model:${modelCallId}`,
        requestDigest,
        consumerKind: "agent_model_call",
        ...(options.workerClaim ? { workerClaim: options.workerClaim } : {}),
        agentRunId,
        agentModelCallId: modelCallId,
        pricingRevisionId: snapshotString(route.snapshot, "pricingRevisionId"),
        currencyCode: route.maximumCharge.currencyCode,
        maximumChargeAmount: route.maximumCharge.amount,
        expiresAt: route.executionDeadlineAt,
        now,
        audit: audit(modelCallId, "reserve"),
      });
      if (result.status === "rejected") {
        throw new AgentModelBudgetError(`agent.model_${result.reason}`);
      }
      return Object.freeze({
        reservationId: result.reservationId,
        requestDigest,
      });
    },

    async capture(input: Parameters<BudgetPort["capture"]>[0]) {
      const { reservation, route, response, modelCallId, now } = input;
      const capturedAmount = resolveProviderCapturedAmount({
        pricing: route.pricing,
        usage: usageMetrics(response),
        ...(response.reportedCharge
          ? {
              reportedCharge: {
                source: "provider_reported" as const,
                ...response.reportedCharge,
              },
            }
          : {}),
        currencyCode: route.maximumCharge.currencyCode,
        maximumChargeAmount: route.maximumCharge.amount,
      });
      await options.budgets.finalize({
        workspaceId: options.authority.workspaceId,
        budgetAccountId: route.budgetAccountId,
        reservationId: reservation.reservationId,
        ledgerEntryId: options.identities.settleLedgerEntryId(modelCallId),
        ledgerEntryKey: `agent-model-terminal:${modelCallId}`,
        requestDigest: reservation.requestDigest,
        kind: capturedAmount === undefined ? "unknown_hold" : "capture",
        ...(capturedAmount === undefined ? {} : { capturedAmount }),
        now,
        audit: audit(modelCallId, "settle"),
      });
      if (capturedAmount === undefined) {
        throw new AgentModelBudgetError("agent.model_charge_unknown");
      }
    },

    async fail(input: Parameters<BudgetPort["fail"]>[0]) {
      const { reservation, route, failure, modelCallId, now } = input;
      await options.budgets.finalize({
        workspaceId: options.authority.workspaceId,
        budgetAccountId: route.budgetAccountId,
        reservationId: reservation.reservationId,
        ledgerEntryId: options.identities.settleLedgerEntryId(modelCallId),
        ledgerEntryKey: `agent-model-terminal:${modelCallId}`,
        requestDigest: reservation.requestDigest,
        kind: failure.status === "unknown" ? "unknown_hold" : "release",
        now,
        audit: audit(modelCallId, "settle"),
      });
    },
  };
  return Object.freeze(port);
}
