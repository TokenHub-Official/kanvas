import { describe, expect, it } from "vitest";

import {
  invitationAcceptanceErrorCode,
  invitationPrimaryAction,
  type InvitationAuthenticationState,
} from "./invitation-recovery.js";

describe("invitation recovery", () => {
  it("maps acceptance failures to stable recovery language", () => {
    expect(invitationAcceptanceErrorCode(401)).toBe("sessionExpired");
    expect(invitationAcceptanceErrorCode(403)).toBe("accountMismatch");
    expect(invitationAcceptanceErrorCode(404)).toBe("missing");
    expect(invitationAcceptanceErrorCode(409)).toBe("changed");
    expect(invitationAcceptanceErrorCode(429)).toBe("rateLimited");
    expect(invitationAcceptanceErrorCode()).toBe("unavailable");
  });

  it("takes an accepted invitation to its Workspace", () => {
    expect(
      invitationPrimaryAction("accepted", "authenticated", true, "matched"),
    ).toBe("enter-workspace");
    expect(
      invitationPrimaryAction(
        "accepted",
        "unauthenticated",
        false,
        "signed_out",
      ),
    ).toBe("login-then-enter");
  });

  it("distinguishes removed access from a mismatched account", () => {
    expect(
      invitationPrimaryAction("accepted", "authenticated", false, "matched"),
    ).toBe("access-removed");
    expect(
      invitationPrimaryAction("accepted", "authenticated", false, "mismatched"),
    ).toBe("switch-account-to-enter");
  });

  it("keeps a pending invitation recoverable across auth states", () => {
    const expected = new Map<
      InvitationAuthenticationState,
      readonly [string, "matched" | "signed_out"]
    >([
      ["authenticated", ["accept", "matched"]],
      ["unauthenticated", ["register-or-login", "signed_out"]],
      ["pending", ["verify-identity", "signed_out"]],
      ["error", ["retry-identity", "signed_out"]],
    ]);
    for (const [authenticationState, [action, identityStatus]] of expected) {
      expect(
        invitationPrimaryAction(
          "pending",
          authenticationState,
          false,
          identityStatus,
        ),
      ).toBe(action);
    }
  });

  it("never offers acceptance to the wrong or unverified account", () => {
    for (const identityStatus of ["mismatched", "unverified"] as const) {
      expect(
        invitationPrimaryAction(
          "pending",
          "authenticated",
          false,
          identityStatus,
        ),
      ).toBe("switch-account-to-accept");
    }
  });

  it("does not offer acceptance for terminal invalid states", () => {
    for (const state of ["expired", "revoked"] as const) {
      expect(
        invitationPrimaryAction(state, "authenticated", false, "matched"),
      ).toBe("return-home");
      expect(
        invitationPrimaryAction(state, "unauthenticated", false, "signed_out"),
      ).toBe("return-home");
    }
  });
});
