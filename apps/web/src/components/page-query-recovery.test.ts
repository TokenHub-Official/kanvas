import { describe, expect, it, vi } from "vitest";

import { runPageQueryRecovery } from "./page-query-recovery.js";

describe("page query recovery", () => {
  it("prevents a second retry while the first request is pending", async () => {
    let resolveRetry: ((result: { isError: boolean }) => void) | undefined;
    const refetch = vi.fn(
      () =>
        new Promise<{ isError: boolean }>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const lock = { current: false };
    const focusRecoveredPage = vi.fn();
    const first = runPageQueryRecovery({
      focusRecoveredPage,
      lock,
      refetch,
    });

    await expect(
      runPageQueryRecovery({
        focusRecoveredPage,
        lock,
        refetch,
      }),
    ).resolves.toBe(false);
    expect(refetch).toHaveBeenCalledOnce();

    resolveRetry?.({ isError: false });
    await expect(first).resolves.toBe(true);
    expect(focusRecoveredPage).toHaveBeenCalledOnce();
  });

  it("keeps focus on the retry state when the request still fails", async () => {
    const focusRecoveredPage = vi.fn();
    const lock = { current: false };

    await runPageQueryRecovery({
      focusRecoveredPage,
      lock,
      refetch: () => Promise.resolve({ isError: true }),
    });

    expect(focusRecoveredPage).not.toHaveBeenCalled();
    expect(lock.current).toBe(false);
  });

  it("releases the lock when refetch rejects so retry remains available", async () => {
    const lock = { current: false };

    await expect(
      runPageQueryRecovery({
        focusRecoveredPage: vi.fn(),
        lock,
        refetch: () => Promise.reject(new Error("offline")),
      }),
    ).resolves.toBe(true);
    expect(lock.current).toBe(false);
  });
});
