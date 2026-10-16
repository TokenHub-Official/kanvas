import { describe, expect, it } from "vitest";

import {
  clearInvitationAdmissionCookie,
  invitationAdmissionTokenHash,
  issueInvitationAdmissionCookie,
} from "../src/auth/invitation-admission.js";

const config = {
  secret: "test-only-auth-secret-that-is-at-least-32-characters",
  secureCookies: false,
};
const tokenHash = `sha256:${"a".repeat(64)}`;
const now = new Date("2026-09-16T12:00:00.000Z");

function requestHeaders(setCookie: string): Headers {
  return new Headers({ cookie: setCookie.split(";", 1)[0] ?? "" });
}

describe("invitation OIDC admission", () => {
  it("accepts only an untampered short-lived token digest", () => {
    const cookie = issueInvitationAdmissionCookie({
      config,
      invitationExpiresAt: new Date("2026-09-16T13:00:00.000Z"),
      invitationTokenHash: tokenHash,
      now,
    });

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=300");
    expect(cookie).not.toContain(tokenHash);
    expect(
      invitationAdmissionTokenHash(requestHeaders(cookie), config, now),
    ).toBe(tokenHash);

    const [name, value] = cookie.split(";", 1)[0]?.split("=") ?? [];
    const tampered = `${name}=${value?.replace(/^./u, value[0] === "a" ? "b" : "a")}`;
    expect(
      invitationAdmissionTokenHash(
        new Headers({ cookie: tampered }),
        config,
        now,
      ),
    ).toBeUndefined();
    expect(
      invitationAdmissionTokenHash(
        requestHeaders(cookie),
        config,
        new Date("2026-09-16T12:05:01.000Z"),
      ),
    ).toBeUndefined();
  });

  it("uses host-only secure cookies in production and emits an explicit clear", () => {
    const secure = { ...config, secureCookies: true };
    const cookie = issueInvitationAdmissionCookie({
      config: secure,
      invitationExpiresAt: new Date("2026-09-16T12:01:00.000Z"),
      invitationTokenHash: tokenHash,
      now,
    });

    expect(cookie).toMatch(/^__Host-kanvas\.invitation_admission=/u);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=60");
    expect(clearInvitationAdmissionCookie(secure)).toContain("Max-Age=0");
  });
});
