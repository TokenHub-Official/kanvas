import { describe, expect, it, vi } from "vitest";

import {
  createListWorkflowRuns,
  type WorkflowRunQueryRepository,
} from "../src/modules/workflow/index.js";

describe("list workflow runs", () => {
  it("keeps the actor and revision scope while bounding the result size", async () => {
    const listForActor = vi.fn().mockResolvedValue({ items: [] });
    const list = createListWorkflowRuns({
      findById: vi.fn(),
      listForActor,
    } satisfies WorkflowRunQueryRepository);

    await expect(
      list({
        workspaceId: "workspace",
        actorId: "principal",
        workflowRevisionId: "revision",
        state: "completed",
        limit: 99,
      }),
    ).resolves.toEqual({ items: [] });
    expect(listForActor).toHaveBeenCalledWith({
      workspaceId: "workspace",
      actorId: "principal",
      workflowRevisionId: "revision",
      state: "completed",
      limit: 40,
    });
  });
});
