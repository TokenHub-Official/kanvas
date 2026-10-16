import { describe, expect, it, vi } from "vitest";

import { performSignOut } from "./sign-out.js";

describe("performSignOut", () => {
  it("allows only one revocation while a request is pending", async () => {
    let resolveRevocation: (() => void) | undefined;
    const revoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRevocation = resolve;
        }),
    );
    const lock = { current: false };
    const onRevoked = vi.fn();
    const first = performSignOut({
      lock,
      onFailure: vi.fn(),
      onRevoked,
      revoke,
    });

    await expect(
      performSignOut({
        lock,
        onFailure: vi.fn(),
        onRevoked,
        revoke,
      }),
    ).resolves.toBe(false);
    expect(revoke).toHaveBeenCalledOnce();

    resolveRevocation?.();
    await expect(first).resolves.toBe(true);
    expect(onRevoked).toHaveBeenCalledOnce();
  });

  it("releases the lock after failure so the user can retry", async () => {
    const lock = { current: false };
    const onFailure = vi.fn();
    const revoke = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();

    await performSignOut({
      lock,
      onFailure,
      onRevoked: vi.fn(),
      revoke,
    });
    expect(lock.current).toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();

    await performSignOut({
      lock,
      onFailure,
      onRevoked: vi.fn(),
      revoke,
    });
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
