import { describe, expect, it } from "vitest";

import {
  digestInvitationTargetEmail,
  digestInvitationToken,
  invitationTokenPrefix,
  maskInvitationEmail,
  TeamStoreError,
} from "../src/runtime/team-store.js";

describe("TeamStore invitation secrets", () => {
  it("domain-separates the stored token digest and exposes only a non-secret prefix", () => {
    const token = `knv_invite_v1_${"a".repeat(43)}`;
    const digest = digestInvitationToken(token);

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(digest).not.toContain(token);
    expect(invitationTokenPrefix(token)).toBe("knv_invite_v1_aaaaaaa");
  });

  it("normalizes target emails for matching while keeping projections masked", () => {
    expect(digestInvitationTargetEmail("Lin.Design@Example.COM")).toBe(
      digestInvitationTargetEmail("lin.design@example.com"),
    );
    expect(maskInvitationEmail("lin.design@example.com")).toBe(
      "li******@example.com",
    );
  });

  it("rejects malformed invitation tokens before persistence", () => {
    expect(() => digestInvitationToken("not-an-invitation")).toThrow(
      TeamStoreError,
    );
  });
});
