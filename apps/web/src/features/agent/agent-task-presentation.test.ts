import type { AgentThreadView } from "@kanvas/contracts/api";
import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { agentTaskDisplayText } from "./agent-task-presentation.js";

type AgentTask = AgentThreadView["tasks"][number];

function task(presentation: NonNullable<AgentTask["presentation"]>): AgentTask {
  return {
    id: "01K00000000000000000000001",
    kind: presentation.kind === "brand_publish" ? "brand" : "skill",
    lifecycleStatus: "waiting_approval",
    title: "stored fallback",
    description: "stored fallback description",
    presentation,
  };
}

describe("Agent task presentation", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));

  it("localizes each built-in task from semantic facts", async () => {
    const update = task({
      kind: "skill_images_update",
      resourceName: "节气海报",
      imageCount: 2,
    });
    const create = task({
      kind: "skill_create",
      resourceName: "节气海报",
      imageCount: 1,
    });
    const publish = task({
      kind: "brand_publish",
      resourceName: "多麦品牌",
    });

    expect(agentTaskDisplayText(update, i18n.t)).toEqual({
      title: "更新“节气海报”的图片",
      description: "添加或替换 2 个图片文件，保留其他内容。",
    });
    expect(agentTaskDisplayText(create, i18n.t)).toEqual({
      title: "创建 Skill：节气海报",
      description: "保存工作方法及 1 个图片文件，创建一个可编辑的 Skill 草稿。",
    });
    expect(agentTaskDisplayText(publish, i18n.t)).toEqual({
      title: "发布品牌：多麦品牌",
      description: "发布后，当前品牌内容将用于之后的新创作。",
    });

    await i18n.changeLanguage("en-US");
    expect(agentTaskDisplayText(update, i18n.t)).toEqual({
      title: "Update images in “节气海报”",
      description:
        "Add or replace 2 image files while keeping the other content.",
    });
    expect(agentTaskDisplayText(create, i18n.t)).toEqual({
      title: "Create Skill: 节气海报",
      description:
        "Save this method and 1 image file as an editable Skill draft.",
    });
    expect(agentTaskDisplayText(publish, i18n.t)).toEqual({
      title: "Publish brand: 多麦品牌",
      description:
        "After publishing, this brand content will be available for future work.",
    });
  });

  it("uses localized generic copy when an image update has no resource name", () => {
    expect(
      agentTaskDisplayText(
        task({ kind: "skill_images_update", imageCount: 1 }),
        i18n.t,
      ),
    ).toEqual({
      title: "更新 Skill 图片",
      description: "添加或替换 1 个图片文件，保留其他内容。",
    });
  });

  it("preserves stored copy for every other task", () => {
    const ordinary: AgentTask = {
      id: "01K00000000000000000000001",
      kind: "workflow",
      lifecycleStatus: "running",
      title: "Campaign workflow",
      description: "Prepare a campaign.",
    };

    expect(agentTaskDisplayText(ordinary, i18n.t)).toEqual({
      title: "Campaign workflow",
      description: "Prepare a campaign.",
    });
  });
});
