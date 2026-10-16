import { describe, expect, it, vi } from "vitest";

import {
  createSkillCommandToolProjection,
  parseSkillDraftProposalInput,
  parseSkillDraftFilesProposalInput,
} from "../src/skill-command-tool-view.js";

const input = {
  name: "seasonal-poster",
  displayName: "节气宣传海报",
  description: "用于公司内部节气宣传海报制作。",
  summary: "遵循品牌要求制作节气宣传图片。",
  instructions: "# 工作顺序\n\n1. 读取品牌。\n2. 生成真实图片。",
  visibility: "private",
  category: "品牌设计",
  tags: ["海报"],
  exampleRequests: ["制作一张公司内部夏至宣传海报"],

  sourceArtifactId: "01K00000000000000000000001",
} as const;

describe("Skill command ToolView", () => {
  it("creates a method with real attachments without requiring a generated result", () => {
    const { sourceArtifactId: artifactId, ...method } = input;
    const files = [{ path: "references/logo.png", artifactId }];
    expect(parseSkillDraftProposalInput({ ...method, files })).toEqual({
      ...method,
      files,
    });
    expect(
      parseSkillDraftFilesProposalInput({
        draftId: artifactId,
        expectedDraftVersion: 2,
        files,
      }),
    ).toMatchObject({ expectedDraftVersion: 2, files });
    expect(() =>
      parseSkillDraftFilesProposalInput({
        draftId: artifactId,
        expectedDraftVersion: 2,
        files: [{ path: "references/../logo.png", artifactId }],
      }),
    ).toThrow();
    expect(() =>
      parseSkillDraftProposalInput({
        ...method,
        files: [{ path: "scripts/code.png", artifactId }],
      }),
    ).toThrow();
  });
  it("exposes one bounded image-result Draft proposal", async () => {
    const proposeCreate = vi.fn(() =>
      Promise.resolve({ modelOutput: { status: "awaiting_approval" } }),
    );
    const projection = createSkillCommandToolProjection({ proposeCreate });
    expect(projection.family).toBe("skill_command");
    expect(projection.descriptors.map((tool) => tool.key)).toEqual([
      "skill.propose-create",
    ]);
    await projection.descriptors[0]?.executeCanonical(input);
    expect(proposeCreate).toHaveBeenCalledWith(input);
  });

  it("resolves the current conversation image without exposing its id to the model", async () => {
    const proposeCreate = vi.fn(() =>
      Promise.resolve({ modelOutput: { status: "awaiting_approval" } }),
    );
    const resolveSourceArtifactId = vi.fn(() =>
      Promise.resolve(input.sourceArtifactId),
    );
    const projection = createSkillCommandToolProjection(
      { proposeCreate },
      { resolveSourceArtifactId },
    );
    const modelInput: Record<string, unknown> = { ...input };
    delete modelInput.sourceArtifactId;

    await projection.descriptors[0]?.executeCanonical(modelInput);

    expect(resolveSourceArtifactId).toHaveBeenCalledOnce();
    expect(proposeCreate).toHaveBeenCalledWith(input);
    expect(projection.descriptors[0]?.inputSchema.required).not.toContain(
      "sourceArtifactId",
    );
  });

  it("rejects scripts from the proposal shape", () => {
    expect(() =>
      parseSkillDraftProposalInput({
        ...input,
        script: "echo unsafe",
      }),
    ).toThrow("unknown field");
  });
});
