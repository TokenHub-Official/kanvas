import type { AutomaticFallbackReason } from "@kanvas/application";

import {
  findPinnedCandidate,
  type PinnedCapabilityRoute,
  type PinnedRouteCandidate,
} from "./execution-plan.js";

export type AttemptSideEffectState =
  "not_started" | "started" | "committed" | "unknown";

export type AttemptFailureRetryability = "retryable" | "terminal" | "manual";

export type AttemptTransitionCause =
  | "browser_executor_fenced"
  | "browser_lease_expired"
  | "cancel_requested"
  | "failed"
  | "provider_result_unknown";

export type AttemptTransitionReasonCode =
  | "attempt.transition.blocked.cancel_requested"
  | "attempt.transition.blocked.committed"
  | "attempt.transition.blocked.fallback_not_pinned"
  | "attempt.transition.blocked.intrinsic_retry_exhausted"
  | "attempt.transition.blocked.no_next_candidate"
  | "attempt.transition.blocked.provider_result_unknown"
  | "attempt.transition.blocked.retryability_manual"
  | "attempt.transition.blocked.retryability_terminal"
  | "attempt.transition.blocked.retry_exhausted"
  | "attempt.transition.blocked.keyed_without_stable_key"
  | "attempt.transition.blocked.unsafe_side_effect"
  | "attempt.transition.fallback.browser_executor_fenced"
  | "attempt.transition.fallback.browser_lease_expired"
  | "attempt.transition.fallback.not_started"
  | "attempt.transition.retry.intrinsic_started"
  | "attempt.transition.retry.keyed_effect"
  | "attempt.transition.retry.not_started";

export interface EvaluateAttemptTransitionOptions {
  readonly route: PinnedCapabilityRoute;
  readonly currentCandidateIndex: number;
  /**
   * One-based count of attempts already created for this candidate,
   * including the attempt whose terminal facts are being evaluated.
   */
  readonly candidateAttemptNumber: number;
  readonly sideEffectState: AttemptSideEffectState;
  readonly cause: AttemptTransitionCause;
  readonly cancellationRequested: boolean;
  /**
   * Trusted error classification. Reapers default to retryable; explicit
   * adapters should always provide it.
   */
  readonly retryability?: AttemptFailureRetryability;
  /**
   * True only when the current keyed implementation is known to use one
   * stable idempotency identity across domain Attempts.
   */
  readonly stableIdempotencyKeyAvailable?: boolean;
}

export interface RetrySameCandidateDecision {
  readonly action: "retry";
  readonly candidateIndex: number;
  readonly nextCandidateAttemptNumber: number;
  readonly reasonCode:
    | "attempt.transition.retry.intrinsic_started"
    | "attempt.transition.retry.keyed_effect"
    | "attempt.transition.retry.not_started";
}

export interface FallbackNextCandidateDecision {
  readonly action: "fallback";
  readonly fromCandidateIndex: number;
  readonly toCandidateIndex: number;
  readonly nextCandidateAttemptNumber: 1;
  readonly reasonCode:
    | "attempt.transition.fallback.browser_executor_fenced"
    | "attempt.transition.fallback.browser_lease_expired"
    | "attempt.transition.fallback.not_started";
}

export interface StopAttemptTransitionDecision {
  readonly action: "stop";
  readonly candidateIndex: number;
  readonly reasonCode: Exclude<
    AttemptTransitionReasonCode,
    | RetrySameCandidateDecision["reasonCode"]
    | FallbackNextCandidateDecision["reasonCode"]
  >;
}

export type AttemptTransitionDecision =
  | RetrySameCandidateDecision
  | FallbackNextCandidateDecision
  | StopAttemptTransitionDecision;

export class AttemptTransitionPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AttemptTransitionPolicyError";
  }
}

function stop(
  candidateIndex: number,
  reasonCode: StopAttemptTransitionDecision["reasonCode"],
): StopAttemptTransitionDecision {
  return Object.freeze({
    action: "stop",
    candidateIndex,
    reasonCode,
  });
}

function retry(
  candidate: PinnedRouteCandidate,
  candidateAttemptNumber: number,
  reasonCode: RetrySameCandidateDecision["reasonCode"],
): RetrySameCandidateDecision {
  return Object.freeze({
    action: "retry",
    candidateIndex: candidate.candidateIndex,
    nextCandidateAttemptNumber: candidateAttemptNumber + 1,
    reasonCode,
  });
}

function fallbackReasonFor(
  cause: AttemptTransitionCause,
  sideEffectState: AttemptSideEffectState,
): AutomaticFallbackReason | undefined {
  if (
    cause === "browser_executor_fenced" ||
    cause === "browser_lease_expired"
  ) {
    return cause;
  }
  return sideEffectState === "not_started" ? "not_started" : undefined;
}

function fallbackReasonCode(
  reason: AutomaticFallbackReason,
): FallbackNextCandidateDecision["reasonCode"] {
  switch (reason) {
    case "browser_executor_fenced":
      return "attempt.transition.fallback.browser_executor_fenced";
    case "browser_lease_expired":
      return "attempt.transition.fallback.browser_lease_expired";
    case "not_started":
      return "attempt.transition.fallback.not_started";
  }
}

function fallback(
  route: PinnedCapabilityRoute,
  candidate: PinnedRouteCandidate,
  reason: AutomaticFallbackReason,
): AttemptTransitionDecision {
  if (!candidate.fallbackOn.includes(reason)) {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.fallback_not_pinned",
    );
  }
  const nextIndex = candidate.candidateIndex + 1;
  if (!route.candidates[nextIndex]) {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.no_next_candidate",
    );
  }
  return Object.freeze({
    action: "fallback",
    fromCandidateIndex: candidate.candidateIndex,
    toCandidateIndex: nextIndex,
    nextCandidateAttemptNumber: 1,
    reasonCode: fallbackReasonCode(reason),
  });
}

function hasRetryBudget(
  candidate: PinnedRouteCandidate,
  candidateAttemptNumber: number,
): boolean {
  return candidateAttemptNumber < candidate.retryPolicy.maxAttempts;
}

/**
 * Decides only from immutable plan facts plus the terminal facts of one
 * Attempt. Authorization, current revocation, budget and egress gates remain
 * mandatory before the returned transition may be persisted.
 */
export function evaluateAttemptTransition(
  options: EvaluateAttemptTransitionOptions,
): AttemptTransitionDecision {
  const candidate = findPinnedCandidate(
    options.route,
    options.currentCandidateIndex,
  );
  if (
    !Number.isSafeInteger(options.candidateAttemptNumber) ||
    options.candidateAttemptNumber < 1 ||
    options.candidateAttemptNumber > candidate.retryPolicy.maxAttempts
  ) {
    throw new AttemptTransitionPolicyError(
      "candidateAttemptNumber is outside the pinned retry budget.",
    );
  }

  if (options.cancellationRequested || options.cause === "cancel_requested") {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.cancel_requested",
    );
  }
  if (options.sideEffectState === "committed") {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.committed",
    );
  }
  if (
    options.cause === "provider_result_unknown" ||
    (candidate.executionTarget === "provider" &&
      options.sideEffectState === "unknown")
  ) {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.provider_result_unknown",
    );
  }
  const retryability = options.retryability ?? "retryable";
  if (retryability === "manual") {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.retryability_manual",
    );
  }
  if (retryability === "terminal") {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.retryability_terminal",
    );
  }

  const browserMayAdvance =
    candidate.executionTarget === "browser" &&
    (options.cause === "browser_executor_fenced" ||
      options.cause === "browser_lease_expired");
  if (browserMayAdvance) {
    const reason = fallbackReasonFor(options.cause, options.sideEffectState);
    if (reason) {
      return fallback(options.route, candidate, reason);
    }
  }

  if (options.sideEffectState === "not_started") {
    if (hasRetryBudget(candidate, options.candidateAttemptNumber)) {
      return retry(
        candidate,
        options.candidateAttemptNumber,
        "attempt.transition.retry.not_started",
      );
    }
    const reason = fallbackReasonFor(options.cause, options.sideEffectState);
    if (reason) {
      return fallback(options.route, candidate, reason);
    }
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.retry_exhausted",
    );
  }

  const intrinsicEffectMayRetry =
    candidate.idempotencyMode === "intrinsic" &&
    (options.sideEffectState === "started" ||
      options.sideEffectState === "unknown");
  const keyedEffectMayRetry =
    candidate.idempotencyMode === "keyed" &&
    options.stableIdempotencyKeyAvailable === true &&
    (options.sideEffectState === "started" ||
      options.sideEffectState === "unknown");
  if (intrinsicEffectMayRetry || keyedEffectMayRetry) {
    return hasRetryBudget(candidate, options.candidateAttemptNumber)
      ? retry(
          candidate,
          options.candidateAttemptNumber,
          intrinsicEffectMayRetry
            ? "attempt.transition.retry.intrinsic_started"
            : "attempt.transition.retry.keyed_effect",
        )
      : stop(
          candidate.candidateIndex,
          intrinsicEffectMayRetry
            ? "attempt.transition.blocked.intrinsic_retry_exhausted"
            : "attempt.transition.blocked.retry_exhausted",
        );
  }
  if (
    candidate.idempotencyMode === "keyed" &&
    (options.sideEffectState === "started" ||
      options.sideEffectState === "unknown")
  ) {
    return stop(
      candidate.candidateIndex,
      "attempt.transition.blocked.keyed_without_stable_key",
    );
  }

  return stop(
    candidate.candidateIndex,
    "attempt.transition.blocked.unsafe_side_effect",
  );
}
