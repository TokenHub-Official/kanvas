import type { CanvasDraftSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../api/transport.js";
import {
  canCreateWorkspaceContent,
  workspaceAgentErrorMessageKey,
  workspaceHomeRecentWork,
} from "./workspace-home-quick-entry-page.js";

function draft(index: number, branded = false): CanvasDraftSummary {
  return {
    id: `01K0000000000000000000000${index}`,
    workspaceId: "01K00000000000000000000000",
    title: `画板 ${index}`,
    pageCount: 1,
    version: 1,
    ...(branded
      ? {
          brand: {
            brandKitId: "01K00000000000000000000008",
            brandKitRevisionId: "01K00000000000000000000009",
            name: "Kanvas 主品牌",
            revisionNumber: 2,
          },
        }
      : {}),
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: `2026-08-0${index}T00:00:00.000Z`,
  };
}

describe("workspace home routing facts", () => {
  it("requires the existing workspace content permissions before promising creation", () => {
    expect(canCreateWorkspaceContent(["canvas.write"])).toBe(false);
    expect(canCreateWorkspaceContent(["asset.write"])).toBe(false);
    expect(canCreateWorkspaceContent(["canvas.write", "asset.write"])).toBe(
      true,
    );
  });

  it("shows recent canvases by edit time without project work-session projections", () => {
    expect(
      workspaceHomeRecentWork([draft(4), draft(6), draft(5)]).map(
        (item) => item.draft.id,
      ),
    ).toEqual([
      "01K00000000000000000000006",
      "01K00000000000000000000005",
      "01K00000000000000000000004",
    ]);
  });

  it("limits the recent canvas list", () => {
    expect(
      workspaceHomeRecentWork([draft(2), draft(3), draft(4)], 2),
    ).toHaveLength(2);
  });

  it("preserves the visible brand context on recent work", () => {
    expect(workspaceHomeRecentWork([draft(4, true)])[0]?.draft.brand).toEqual({
      brandKitId: "01K00000000000000000000008",
      brandKitRevisionId: "01K00000000000000000000009",
      name: "Kanvas 主品牌",
      revisionNumber: 2,
    });
  });

  it("turns Agent readiness and budget failures into user-facing states", () => {
    expect(
      workspaceAgentErrorMessageKey(
        new ApiProblem(409, "agent.profile_unavailable", "unavailable"),
      ),
    ).toBe("studio.home.agentNotReady");
    expect(
      workspaceAgentErrorMessageKey(
        new ApiProblem(409, "budget.insufficient", "unavailable"),
      ),
    ).toBe("studio.home.agentBudgetUnavailable");
    expect(workspaceAgentErrorMessageKey(new Error("offline"))).toBe(
      "studio.home.agentError",
    );
  });
});
