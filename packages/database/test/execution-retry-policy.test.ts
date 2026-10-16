import { describe, expect, it } from "vitest";

import {
  defaultAttemptTimeoutMs,
  maximumAttemptTimeoutMs,
  minimumAttemptTimeoutMs,
  normalizeAttemptTimeoutMs,
  normalizeRetryPolicy,
  retryDelayMs,
} from "../src/runtime/execution-retry-policy.js";

describe("execution retry policy", () => {
  it("fails closed when a binding has no retry policy", () => {
    expect(normalizeRetryPolicy({})).toEqual({
      maxAttempts: 1,
      backoff: "fixed",
      initialDelayMs: 0,
      maxDelayMs: 0,
    });
  });

  it("normalizes and bounds exponential retry delay", () => {
    const policy = normalizeRetryPolicy({
      retryPolicy: {
        maxAttempts: 5,
        backoff: "exponential",
        initialDelayMs: 1000,
        maxDelayMs: 2500,
      },
    });

    expect(retryDelayMs(policy, 2)).toBe(1000);
    expect(retryDelayMs(policy, 3)).toBe(2000);
    expect(retryDelayMs(policy, 4)).toBe(2500);
  });

  it("rejects an unsafe unbounded retry policy", () => {
    expect(() =>
      normalizeRetryPolicy({
        retryPolicy: {
          maxAttempts: 100,
          backoff: "fixed",
        },
      }),
    ).toThrow(/maxAttempts/u);
  });

  it("pins a bounded attempt timeout independently from retry delay", () => {
    expect(normalizeAttemptTimeoutMs({})).toBe(defaultAttemptTimeoutMs);
    expect(
      normalizeAttemptTimeoutMs({
        attemptTimeoutMs: minimumAttemptTimeoutMs,
      }),
    ).toBe(minimumAttemptTimeoutMs);
    expect(() =>
      normalizeAttemptTimeoutMs({
        attemptTimeoutMs: maximumAttemptTimeoutMs + 1,
      }),
    ).toThrow(/attemptTimeoutMs/u);
  });

  it("rejects unknown retry-policy facts", () => {
    expect(() =>
      normalizeRetryPolicy({
        retryPolicy: {
          maxAttempts: 1,
          backoff: "fixed",
          initialDelayMs: 0,
          maxDelayMs: 0,
          retryForever: true,
        },
      }),
    ).toThrow(/unknown field retryForever/u);
  });
});
