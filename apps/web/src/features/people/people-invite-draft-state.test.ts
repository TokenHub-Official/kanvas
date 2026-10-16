import { describe, expect, it } from "vitest";

import {
  initialPeopleInviteDraftState,
  reducePeopleInviteDraft,
} from "./people-invite-draft-state.js";

describe("reducePeopleInviteDraft", () => {
  it("clears the complete draft when the dialog closes", () => {
    const dirty = {
      email: "owner@example.com",
      error: "Try again",
      open: true,
      ownerRiskAcknowledged: true,
      role: "owner" as const,
      shareUrl: "https://example.test/invite",
    };

    expect(reducePeopleInviteDraft(dirty, { type: "close" })).toEqual(
      initialPeopleInviteDraftState,
    );
  });

  it("clears owner acknowledgement when the role changes", () => {
    const acknowledged = {
      ...initialPeopleInviteDraftState,
      ownerRiskAcknowledged: true,
      role: "owner" as const,
    };

    expect(
      reducePeopleInviteDraft(acknowledged, {
        type: "role_changed",
        role: "admin",
      }),
    ).toMatchObject({
      ownerRiskAcknowledged: false,
      role: "admin",
    });
  });

  it("keeps the dialog open and exposes the generated invite URL", () => {
    const open = reducePeopleInviteDraft(initialPeopleInviteDraftState, {
      type: "open",
    });

    expect(
      reducePeopleInviteDraft(open, {
        type: "created",
        shareUrl: "https://example.test/invite",
      }),
    ).toMatchObject({
      email: "",
      open: true,
      shareUrl: "https://example.test/invite",
    });
  });
});
