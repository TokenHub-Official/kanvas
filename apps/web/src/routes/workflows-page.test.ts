import type { WorkflowDefinitionSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  newcomerWorkflowDefinitions,
  searchWorkflowDefinitions,
} from "./workflows-page.js";

describe("Workflow list", () => {
  it("hides published internal definitions while keeping authored drafts", () => {
    const items = [
      { workflowKey: "poster", displayName: "海报生成" },
      { workflowKey: "image_generate", displayName: "image_generate" },
      {
        workflowKey: "workflow_untitled",
        displayName: "测试",
        draft: { id: "draft" },
      },
    ] as unknown as readonly WorkflowDefinitionSummary[];
    expect(newcomerWorkflowDefinitions(items)).toMatchObject([
      { workflowKey: "poster" },
      { workflowKey: "workflow_untitled" },
    ]);
  });

  it("searches author workflows by name, description, or category", () => {
    const items = [
      {
        displayName: "商品海报",
        description: "生成营销图片",
        category: "电商",
      },
      {
        displayName: "背景替换",
        description: "替换产品背景",
        category: "图片编辑",
      },
    ] as unknown as readonly WorkflowDefinitionSummary[];

    expect(searchWorkflowDefinitions(items, "海报")).toEqual([items[0]]);
    expect(searchWorkflowDefinitions(items, "产品背景")).toEqual([items[1]]);
    expect(searchWorkflowDefinitions(items, "电商")).toEqual([items[0]]);
    expect(searchWorkflowDefinitions(items, "  ")).toBe(items);
  });
});
