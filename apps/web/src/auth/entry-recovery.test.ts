import { describe, expect, it, vi } from "vitest";

import {
  authenticationRecoveryDecision,
  clearWorkspacePreference,
  lastWorkspacePreferenceKey,
  loginErrorCode,
  returnToFromLocation,
  safeReturnTo,
  shouldRedirectAuthenticatedLogin,
} from "./entry-recovery.js";

describe("entry recovery", () => {
  it("preserves a new shared session when a stale tab reaches recovery", async () => {
    const client = {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: { id: "new-session" } } }),
      ),
      signOut: vi.fn(),
    };

    await expect(authenticationRecoveryDecision(client)).resolves.toBe(
      "resume",
    );
    expect(client.getSession).toHaveBeenCalledOnce();
    expect(client.signOut).not.toHaveBeenCalled();
  });

  it("keeps sign-in available when recovery finds no valid session", async () => {
    const client = {
      getSession: vi.fn(() => Promise.resolve({ data: null })),
      signOut: vi.fn(),
    };

    await expect(authenticationRecoveryDecision(client)).resolves.toBe(
      "sign_in",
    );
    expect(client.signOut).not.toHaveBeenCalled();
  });

  it("keeps OAuth callback errors visible even with a cached session", () => {
    expect(
      shouldRedirectAuthenticatedLogin({
        authenticationRecoveryRequired: false,
        hasOAuthError: true,
        hasSession: true,
      }),
    ).toBe(false);
    expect(
      shouldRedirectAuthenticatedLogin({
        authenticationRecoveryRequired: false,
        hasOAuthError: false,
        hasSession: true,
      }),
    ).toBe(true);
    expect(
      shouldRedirectAuthenticatedLogin({
        authenticationRecoveryRequired: true,
        hasOAuthError: false,
        hasSession: true,
      }),
    ).toBe(false);
  });

  it("preserves a bounded same-origin path and query", () => {
    expect(
      safeReturnTo("/w/01K00000000000000000000000/assets?source=team"),
    ).toBe("/w/01K00000000000000000000000/assets?source=team");
    expect(
      returnToFromLocation({
        pathname: "/w/01K00000000000000000000000/assets",
        search: "?q=launch",
        hash: "#details",
      }),
    ).toBe("/w/01K00000000000000000000000/assets?q=launch#details");
    expect(safeReturnTo("/setup#setup=knv_setup_v1_example")).toBeUndefined();
  });

  it("rejects external, recursive, malformed, and oversized targets", () => {
    for (const value of [
      "https://example.com",
      "//example.com/path",
      "/\\example.com",
      "/login?returnTo=/login",
      " /assets",
      `/assets?value=${"a".repeat(2_100)}`,
    ]) {
      expect(safeReturnTo(value)).toBeUndefined();
    }
  });

  it("clears only the Workspace UI preference", () => {
    const removeItem = vi.fn();
    clearWorkspacePreference({ removeItem });
    expect(removeItem).toHaveBeenCalledWith(lastWorkspacePreferenceKey);
  });

  it("separates credential, account, rate, and service errors", () => {
    expect(loginErrorCode(401)).toBe("credentials");
    expect(loginErrorCode(403)).toBe("accountUnavailable");
    expect(loginErrorCode(403, "EMAIL_NOT_VERIFIED")).toBe("emailNotVerified");
    expect(loginErrorCode(429)).toBe("rateLimited");
    expect(loginErrorCode(500)).toBe("unavailable");
  });
});
