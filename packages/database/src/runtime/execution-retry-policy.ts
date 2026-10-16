import {
  DomainError,
  type CapabilityRetryPolicySnapshot,
} from "@kanvas/application";

export type PinnedRetryPolicy = CapabilityRetryPolicySnapshot;

export const defaultAttemptTimeoutMs = 5 * 60_000;
export const minimumAttemptTimeoutMs = 1_000;
export const maximumAttemptTimeoutMs = 60 * 60_000;

const retryPolicyKeys = new Set([
  "backoff",
  "initialDelayMs",
  "maxAttempts",
  "maxDelayMs",
]);

function recordOf(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new DomainError(
      "capability_binding.retry_policy_invalid",
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value as number;
}

function rejectUnknownRetryPolicyField(
  retry: Readonly<Record<string, unknown>>,
): void {
  const unknownKey = Object.keys(retry).find(
    (key) => !retryPolicyKeys.has(key),
  );
  if (unknownKey) {
    throw new DomainError(
      "capability_binding.retry_policy_invalid",
      `retryPolicy contains unknown field ${unknownKey}.`,
    );
  }
}

export function normalizeRetryPolicy(
  routePolicy: Readonly<Record<string, unknown>>,
): PinnedRetryPolicy {
  if (routePolicy.retryPolicy === undefined) {
    return Object.freeze({
      maxAttempts: 1,
      backoff: "fixed",
      initialDelayMs: 0,
      maxDelayMs: 0,
    });
  }
  const retry = recordOf(routePolicy.retryPolicy);
  if (!retry) {
    throw new DomainError(
      "capability_binding.retry_policy_invalid",
      "retryPolicy must be a JSON object.",
    );
  }
  rejectUnknownRetryPolicyField(retry);
  const maxAttempts = boundedInteger(
    retry.maxAttempts,
    1,
    10,
    "retryPolicy.maxAttempts",
  );
  const backoff = retry.backoff ?? "fixed";
  if (backoff !== "fixed" && backoff !== "exponential") {
    throw new DomainError(
      "capability_binding.retry_policy_invalid",
      "retryPolicy.backoff must be fixed or exponential.",
    );
  }
  const initialDelayMs =
    retry.initialDelayMs === undefined
      ? 1000
      : boundedInteger(
          retry.initialDelayMs,
          0,
          300_000,
          "retryPolicy.initialDelayMs",
        );
  const maxDelayMs =
    retry.maxDelayMs === undefined
      ? Math.max(initialDelayMs, 30_000)
      : boundedInteger(
          retry.maxDelayMs,
          initialDelayMs,
          3_600_000,
          "retryPolicy.maxDelayMs",
        );
  return Object.freeze({
    maxAttempts,
    backoff,
    initialDelayMs,
    maxDelayMs,
  });
}

/**
 * Pins an Attempt's absolute execution timeout independently from its lease.
 * Route policies may omit the field and receive the conservative platform default.
 */
export function normalizeAttemptTimeoutMs(
  routePolicy: Readonly<Record<string, unknown>>,
): number {
  if (routePolicy.attemptTimeoutMs === undefined) {
    return defaultAttemptTimeoutMs;
  }
  return boundedInteger(
    routePolicy.attemptTimeoutMs,
    minimumAttemptTimeoutMs,
    maximumAttemptTimeoutMs,
    "attemptTimeoutMs",
  );
}

export function retryDelayMs(
  policy: PinnedRetryPolicy,
  nextAttemptNumber: number,
): number {
  if (policy.backoff === "fixed") {
    return policy.initialDelayMs;
  }
  const exponent = Math.max(0, nextAttemptNumber - 2);
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** exponent);
}
