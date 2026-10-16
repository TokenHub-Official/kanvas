import { describe, expect, it } from "vitest";

import {
  skillAvailability,
  skillPublicationStage,
} from "./skill-availability.js";

const published = {
  runtimeStatus: "enabled" as const,
  skillRevisionId: "01K00000000000000000000001",
};

describe("skillAvailability", () => {
  it("keeps the actual published revision usable while newer draft changes wait", () => {
    expect(
      skillAvailability({
        draft: {
          publishedCurrent: false,
          publishedSkillRevisionId: "01K00000000000000000000000",
        },
        published,
      }),
    ).toEqual({
      kind: "usable_with_changes",
      labelKey: "agent.skillWorkbench.availability.usableWithChanges",
      tone: "positive",
      publishedRevisionId: published.skillRevisionId,
    });
  });

  it("marks a first draft as needing publication", () => {
    expect(
      skillAvailability({
        draft: { publishedCurrent: false },
      }),
    ).toMatchObject({ kind: "needs_publish", tone: "info" });
  });

  it("lets resource and runtime unavailability override a published revision", () => {
    expect(
      skillAvailability({ published, resourceState: "disabled" }),
    ).toMatchObject({ kind: "disabled", tone: "warning" });
    expect(
      skillAvailability({
        published: { ...published, runtimeStatus: "revoked" },
        resourceState: "disabled",
      }),
    ).toMatchObject({ kind: "revoked", tone: "danger" });
    expect(
      skillAvailability({
        draft: {
          publishedCurrent: false,
          publishedSkillRevisionId: "01K00000000000000000000000",
        },
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("keeps publication filters independent from current availability", () => {
    expect(
      skillPublicationStage({
        draft: {},
      }),
    ).toBe("draft");
    expect(
      skillPublicationStage({
        draft: {
          publishedSkillRevisionId: "01K00000000000000000000000",
        },
        published,
      }),
    ).toBe("changes");
    expect(skillPublicationStage({ published })).toBe("published");
  });
});
