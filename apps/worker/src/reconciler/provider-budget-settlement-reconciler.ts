import {
  RuntimeFenceRejectedError,
  type ApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import type {
  AgentBudgetSettlementCandidate,
  BudgetReservationStore,
  ProviderBudgetSettlementCandidate,
  ProviderBudgetSettlementStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";

import { resolveProviderCapturedAmount } from "../provider/provider-pricing-calculator.js";

export interface ProviderBudgetSettlementReconcilerOptions {
  readonly runtime: ApplicationRuntime;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly settlements: ProviderBudgetSettlementStore;
  readonly budgets: BudgetReservationStore;
  readonly logger: Pick<Logger, "error">;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
}

export interface ProviderBudgetSettlementSummary {
  readonly scanned: number;
  readonly finalized: number;
  readonly replayed: number;
  readonly failed: number;
}

function assertBatchSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError(
      "Provider budget settlement batch size must be between 1 and 100.",
    );
  }
}

function assertPollInterval(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new RangeError(
      "Provider budget settlement poll interval must be between 1 and 3600000 milliseconds.",
    );
  }
}

function candidateLogFields(
  candidate: ProviderBudgetSettlementCandidate,
): Readonly<Record<string, string>> {
  return {
    reconciliationKind: "provider_budget_settlement",
    invocationId: candidate.invocationId,
    reservationId: candidate.reservationId,
    remoteStatus: candidate.remoteStatus,
    sideEffectState: candidate.sideEffectState,
  };
}

const agentUsageMetrics = Object.freeze([
  ["inputTokens", "input_tokens"],
  ["inputTokensNoCache", "input_tokens_no_cache"],
  ["cacheReadTokens", "cache_read_tokens"],
  ["cacheWriteTokens", "cache_write_tokens"],
  ["outputTokens", "output_tokens"],
  ["outputTextTokens", "output_text_tokens"],
  ["reasoningTokens", "reasoning_tokens"],
] as const);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function agentSettlementEvidence(candidate: AgentBudgetSettlementCandidate) {
  const document = candidate.usageDocument;
  const usage = agentUsageMetrics.flatMap(([property, metricKey]) => {
    const value = document?.[property];
    return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? [{ metricKey, numericValue: String(value), unitCode: "token" }]
      : [];
  });
  const reported = record(document?.reportedCharge);
  const reportedCharge =
    typeof reported?.currencyCode === "string" &&
    typeof reported.amount === "string"
      ? {
          source: "provider_reported" as const,
          currencyCode: reported.currencyCode,
          amount: reported.amount,
        }
      : undefined;
  return { usage: Object.freeze(usage), reportedCharge };
}

/**
 * Repairs the bounded crash window between a terminal invocation commit and
 * its idempotent budget finalization. It also converts an expired manual
 * invocation with unknown remote effect into an unknown hold. Success and
 * possible external effects stay reserved until an exact pricing calculation
 * exists; authoritative not-found and persisted `not_started` evidence safely
 * release the reservation.
 */
export class ProviderBudgetSettlementReconciler {
  readonly #runtime: ApplicationRuntime;
  readonly #runtimeStateReader: RuntimeStateReader;
  readonly #settlements: ProviderBudgetSettlementStore;
  readonly #budgets: BudgetReservationStore;
  readonly #logger: Pick<Logger, "error">;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #batchSize: number;
  readonly #pollIntervalMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: ProviderBudgetSettlementReconcilerOptions) {
    this.#runtime = options.runtime;
    this.#runtimeStateReader = options.runtimeStateReader;
    this.#settlements = options.settlements;
    this.#budgets = options.budgets;
    this.#logger = options.logger;
    this.#nextId = options.nextId;
    this.#now = options.now ?? (() => new Date());
    this.#batchSize = options.batchSize ?? 20;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    assertBatchSize(this.#batchSize);
    assertPollInterval(this.#pollIntervalMs);
  }

  public start(): void {
    if (this.#running || this.#timer) {
      return;
    }
    this.#stopping = false;
    this.#schedule(0);
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#running;
  }

  public async runOnce(): Promise<ProviderBudgetSettlementSummary> {
    const snapshot = await this.#runtimeStateReader.read();
    await this.#runtime.runtimeFence.assertAllowed({
      action: "repair",
      expectedGeneration: snapshot.executionGeneration,
    });
    const candidates = await this.#settlements.scanPending({
      batchSize: this.#batchSize,
    });
    const agentCandidates = await this.#settlements.scanAgentPending({
      batchSize: this.#batchSize,
    });
    const summary = {
      scanned: candidates.length + agentCandidates.length,
      finalized: 0,
      replayed: 0,
      failed: 0,
    };
    for (const candidate of candidates) {
      await this.#runtime.runtimeFence.assertAllowed({
        action: "repair",
        expectedGeneration: snapshot.executionGeneration,
      });
      try {
        const now = this.#now();
        const audit = {
          auditEventId: this.#nextId(),
          actorPrincipalId: null,
          actorType: "system" as const,
          authenticationRefType: "none" as const,
          authenticationRefHash: null,
          authorityType: "system" as const,
          authorityId: null,
          authorityVersion: null,
        };
        let capturedAmount: string | undefined;
        if (candidate.remoteStatus === "succeeded") {
          const evidence = await this.#settlements.loadEvidence(candidate);
          capturedAmount = resolveProviderCapturedAmount({
            pricing: evidence.pricingDocument,
            usage: evidence.usage,
            ...(evidence.reportedCharge
              ? {
                  reportedCharge: {
                    source: "provider_reported" as const,
                    ...evidence.reportedCharge,
                  },
                }
              : {}),
            currencyCode: evidence.currencyCode,
            maximumChargeAmount: evidence.maximumChargeAmount,
          });
        }
        let result;
        if (candidate.reservationLifecycle === "unknown") {
          if (
            capturedAmount === undefined &&
            candidate.sideEffectState !== "not_started"
          )
            continue;
          result = await this.#budgets.resolveUnknown({
            workspaceId: candidate.workspaceId,
            reservationId: candidate.reservationId,
            expectedVersion: candidate.reservationVersion,
            ledgerEntryId: this.#nextId(),
            ledgerEntryKey: `provider-unknown-terminal:${candidate.invocationId}`,
            requestDigest: candidate.requestDigest,
            resolution:
              capturedAmount !== undefined ? "charged" : "not_charged",
            ...(capturedAmount !== undefined
              ? { chargedAmount: capturedAmount }
              : {}),
            evidenceReference:
              capturedAmount !== undefined
                ? `provider.confirmed_result:${candidate.invocationId}`
                : "provider.side_effect.not_started",
            now,
            audit,
          });
        } else {
          let kind: "capture" | "release" | "unknown_hold" = "unknown_hold";
          if (
            candidate.remoteStatus === "not_found" ||
            candidate.sideEffectState === "not_started"
          ) {
            kind = "release";
          } else if (capturedAmount !== undefined) {
            kind = "capture";
          }
          result = await this.#budgets.finalize({
            workspaceId: candidate.workspaceId,
            budgetAccountId: candidate.budgetAccountId,
            reservationId: candidate.reservationId,
            ledgerEntryId: this.#nextId(),
            ledgerEntryKey: `provider-terminal:${candidate.invocationId}`,
            requestDigest: candidate.requestDigest,
            kind,
            ...(capturedAmount !== undefined && kind === "capture"
              ? { capturedAmount }
              : {}),
            now,
            audit,
          });
        }
        if (result.status === "finalized" || result.status === "resolved") {
          summary.finalized += 1;
        } else {
          summary.replayed += 1;
        }
      } catch (error) {
        if (error instanceof RuntimeFenceRejectedError) {
          throw error;
        }
        summary.failed += 1;
        this.#logger.error(
          {
            ...candidateLogFields(candidate),
            errorCode: "provider.budget_settlement.candidate_failed",
            errorType: error instanceof Error ? error.name : "unknown",
          },
          "Provider budget settlement candidate failed; continuing.",
        );
      }
    }
    for (const candidate of agentCandidates) {
      await this.#runtime.runtimeFence.assertAllowed({
        action: "repair",
        expectedGeneration: snapshot.executionGeneration,
      });
      try {
        const now = this.#now();
        let kind: "capture" | "release" | "unknown_hold" = "unknown_hold";
        let capturedAmount: string | undefined;
        if (candidate.attemptStatus === "succeeded") {
          const evidence = agentSettlementEvidence(candidate);
          capturedAmount = resolveProviderCapturedAmount({
            pricing: candidate.pricingDocument,
            usage: evidence.usage,
            ...(evidence.reportedCharge
              ? { reportedCharge: evidence.reportedCharge }
              : {}),
            currencyCode: candidate.currencyCode,
            maximumChargeAmount: candidate.maximumChargeAmount,
          });
          if (capturedAmount !== undefined) kind = "capture";
        } else if (
          candidate.attemptStatus === "failed" ||
          candidate.attemptStatus === "cancelled"
        ) {
          kind = "release";
        }
        const result = await this.#budgets.finalize({
          workspaceId: candidate.workspaceId,
          budgetAccountId: candidate.budgetAccountId,
          reservationId: candidate.reservationId,
          ledgerEntryId: this.#nextId(),
          ledgerEntryKey: `agent-model-terminal:${candidate.modelCallId}`,
          requestDigest: candidate.requestDigest,
          kind,
          ...(capturedAmount !== undefined && kind === "capture"
            ? { capturedAmount }
            : {}),
          now,
          audit: {
            auditEventId: this.#nextId(),
            actorPrincipalId: null,
            actorType: "system",
            authenticationRefType: "none",
            authenticationRefHash: null,
            authorityType: "system",
            authorityId: null,
            authorityVersion: null,
          },
        });
        if (result.status === "finalized") summary.finalized += 1;
        else summary.replayed += 1;
      } catch (error) {
        if (error instanceof RuntimeFenceRejectedError) throw error;
        summary.failed += 1;
        this.#logger.error(
          {
            reconciliationKind: "agent_budget_settlement",
            modelCallId: candidate.modelCallId,
            reservationId: candidate.reservationId,
            errorCode: "agent.budget_settlement.candidate_failed",
            errorType: error instanceof Error ? error.name : "unknown",
          },
          "Agent budget settlement candidate failed; continuing.",
        );
      }
    }
    return Object.freeze(summary);
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#logger.error(
            {
              errorCode: "provider.budget_settlement.iteration_failed",
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Provider budget settlement iteration failed.",
          );
        })
        .finally(() => {
          this.#running = undefined;
          if (!this.#stopping) {
            this.#schedule(this.#pollIntervalMs);
          }
        });
    }, delay);
  }
}
