import type { WorkflowTemplate } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  latestWorkflowTemplates,
  newcomerWorkflowTemplates,
} from "./workflow-templates-page.js";

describe("Workflow template catalog", () => {
  it("shows only the latest revision for each Workflow", () => {
    const items = [
      { workflowKey: "poster", revision: 1, workflowRevisionId: "r1" },
      { workflowKey: "other", revision: 1, workflowRevisionId: "other-r1" },
      { workflowKey: "poster", revision: 2, workflowRevisionId: "r2" },
    ] as unknown as readonly WorkflowTemplate[];
    expect(latestWorkflowTemplates(items)).toMatchObject([
      { workflowKey: "poster", revision: 2, workflowRevisionId: "r2" },
      { workflowKey: "other", revision: 1, workflowRevisionId: "other-r1" },
    ]);
  });

  it("hides technical templates by default but keeps them searchable", () => {
    const items = [
      {
        workflowKey: "poster",
        displayName: "海报生成",
        revision: 1,
        runtimeStatus: "enabled",
        workflowRevisionId: "poster-r1",
      },
      {
        workflowKey: "image_generate",
        displayName: "image_generate",
        revision: 1,
        runtimeStatus: "enabled",
        workflowRevisionId: "image-r1",
      },
    ] as unknown as readonly WorkflowTemplate[];
    expect(newcomerWorkflowTemplates(items)).toHaveLength(1);
    expect(newcomerWorkflowTemplates(items, true)).toHaveLength(2);
  });

  it("keeps unavailable revisions out of the user catalog", () => {
    const items = [
      {
        workflowKey: "poster",
        displayName: "海报生成",
        revision: 1,
        runtimeStatus: "disabled",
        workflowRevisionId: "poster-r1",
      },
    ] as unknown as readonly WorkflowTemplate[];

    expect(newcomerWorkflowTemplates(items)).toEqual([]);
  });
});
