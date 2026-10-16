import { describe, expect, it } from "vitest";

import { evaluateAttemptTransition } from "../src/runtime/attempt-transition-policy.js";
import {
  findPinnedRoute,
  parseExecutionPlan,
} from "../src/runtime/execution-plan.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

function candidate(
  candidateIndex: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    candidateIndex,
    bindingId: id(10 + candidateIndex),
    bindingVersion: 1,
    implementationRevisionId: id(20 + candidateIndex),
    implementationDigest: digest(
      String.fromCharCode("a".charCodeAt(0) + candidateIndex),
    ),
    executionTarget: candidateIndex === 0 ? "browser" : "worker",
    adapterKey: candidateIndex === 0 ? "browser.image" : "worker.image",
    idempotencyMode: "intrinsic",
    retryPolicy: {
      maxAttempts: 2,
      backoff: "fixed",
      initialDelayMs: 0,
      maxDelayMs: 0,
    },
    attemptTimeoutMs: 120_000,
    fallbackOn:
      candidateIndex === 0
        ? ["not_started", "browser_executor_fenced", "browser_lease_expired"]
        : [],
    ...overrides,
  };
}

function routeFor(candidates: readonly Readonly<Record<string, unknown>>[]) {
  const plan = parseExecutionPlan({
    schemaVersion: 1,
    topology: {
      schemaVersion: 1,
      key: "attempt_transition_test",
      entryNodeKey: "invoke",
      limits: { maxNodeRuns: 1, timeoutMs: 120_000 },
      nodes: [
        {
          key: "invoke",
          kind: "invoke",
          capability: {
            contractId: "image.test",
            revision: 1,
            canonicalDigest: digest("f"),
          },
          input: {},
          next: [],
        },
      ],
      outputs: {},
    },
    routes: [
      {
        nodeKey: "invoke",
        contractRevisionId: id(1),
        contractKey: "image.test",
        contractRevision: 1,
        contractDigest: digest("f"),
        candidates,
      },
    ],
  });
  return findPinnedRoute(plan, "invoke");
}

describe("attempt transition policy", () => {
  it("blocks cancellation and a committed result before any retry", () => {
    const route = routeFor([candidate(0), candidate(1)]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "not_started",
        cause: "failed",
        cancellationRequested: true,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.cancel_requested",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "committed",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.committed",
    });
  });

  it("retries not-started work before advancing exactly one candidate", () => {
    const route = routeFor([candidate(0), candidate(1), candidate(2)]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "not_started",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "retry",
      candidateIndex: 0,
      nextCandidateAttemptNumber: 2,
      reasonCode: "attempt.transition.retry.not_started",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 2,
        sideEffectState: "not_started",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "fallback",
      fromCandidateIndex: 0,
      toCandidateIndex: 1,
      nextCandidateAttemptNumber: 1,
      reasonCode: "attempt.transition.fallback.not_started",
    });
  });

  it("allows a fenced or expired Browser attempt to advance", () => {
    const route = routeFor([candidate(0), candidate(1)]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "started",
        cause: "browser_executor_fenced",
        cancellationRequested: false,
      }),
    ).toMatchObject({
      action: "fallback",
      fromCandidateIndex: 0,
      toCandidateIndex: 1,
      reasonCode: "attempt.transition.fallback.browser_executor_fenced",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "unknown",
        cause: "browser_lease_expired",
        cancellationRequested: false,
      }),
    ).toMatchObject({
      action: "fallback",
      fromCandidateIndex: 0,
      toCandidateIndex: 1,
      reasonCode: "attempt.transition.fallback.browser_lease_expired",
    });
  });

  it("keeps intrinsic started work on the same candidate only", () => {
    const route = routeFor([candidate(0), candidate(1)]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "started",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "retry",
      candidateIndex: 0,
      nextCandidateAttemptNumber: 2,
      reasonCode: "attempt.transition.retry.intrinsic_started",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 2,
        sideEffectState: "started",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.intrinsic_retry_exhausted",
    });
  });

  it("blocks Provider unknown and keyed unknown side effects", () => {
    const providerRoute = {
      providerProtocolVersion: 1,
      providerKey: "openai",
      apiSurface: "responses.v1",
      providerEndpointId: id(30),
      credentialIdentityId: id(31),
      credentialIdentityEpoch: 1,
      modelDeploymentId: id(32),
      pricingRevisionId: id(33),
      pinnedSecretVersionId: id(34),
      credentialIdentityDigest: digest("e"),
      instancePolicyRevisionId: id(35),
      workspacePolicyRevisionId: id(36),
      routePolicyRevisionId: id(37),
      modelProfileRevisionId: id(38),
      budgetAccountId: id(39),
      routingMode: "kanvas_fixed",
      executionTransparency: "full",
      maximumCharge: { currencyCode: "USD", amount: "1" },
      routeCandidateDigest: digest("c"),
      requestScopeDigest: digest("d"),
      queryMode: "client_request_id",
      notFoundIsAuthoritative: true,
    };
    const provider = routeFor([
      candidate(0, {
        executionTarget: "provider",
        adapterKey: "provider.openai",
        providerRoute,
        idempotencyMode: "keyed",
        fallbackOn: ["not_started"],
      }),
      candidate(1),
    ]);

    expect(
      evaluateAttemptTransition({
        route: provider,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "unknown",
        cause: "provider_result_unknown",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.provider_result_unknown",
    });

    const keyedWorker = routeFor([
      candidate(0, {
        executionTarget: "worker",
        adapterKey: "worker.keyed",
        idempotencyMode: "keyed",
        fallbackOn: ["not_started"],
      }),
      candidate(1),
    ]);
    expect(
      evaluateAttemptTransition({
        route: keyedWorker,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "unknown",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.keyed_without_stable_key",
    });
  });

  it("retries keyed effects only with an explicit stable idempotency key", () => {
    const route = routeFor([
      candidate(0, {
        executionTarget: "worker",
        adapterKey: "worker.keyed",
        idempotencyMode: "keyed",
        fallbackOn: [],
      }),
    ]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "unknown",
        cause: "failed",
        cancellationRequested: false,
        stableIdempotencyKeyAvailable: true,
      }),
    ).toEqual({
      action: "retry",
      candidateIndex: 0,
      nextCandidateAttemptNumber: 2,
      reasonCode: "attempt.transition.retry.keyed_effect",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "started",
        cause: "failed",
        cancellationRequested: false,
        stableIdempotencyKeyAvailable: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.keyed_without_stable_key",
    });
  });

  it("honors trusted manual and terminal classifications", () => {
    const route = routeFor([candidate(0)]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "not_started",
        cause: "failed",
        cancellationRequested: false,
        retryability: "manual",
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.retryability_manual",
    });
    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "started",
        cause: "failed",
        cancellationRequested: false,
        retryability: "terminal",
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.retryability_terminal",
    });
  });

  it("fails closed when fallback was not pinned", () => {
    const route = routeFor([
      candidate(0, {
        retryPolicy: {
          maxAttempts: 1,
          backoff: "fixed",
          initialDelayMs: 0,
          maxDelayMs: 0,
        },
        fallbackOn: [],
      }),
      candidate(1),
    ]);

    expect(
      evaluateAttemptTransition({
        route,
        currentCandidateIndex: 0,
        candidateAttemptNumber: 1,
        sideEffectState: "not_started",
        cause: "failed",
        cancellationRequested: false,
      }),
    ).toEqual({
      action: "stop",
      candidateIndex: 0,
      reasonCode: "attempt.transition.blocked.fallback_not_pinned",
    });
  });
});
