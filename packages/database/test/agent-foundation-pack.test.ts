import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  defaultAgentWorkspaceProfileV1,
  parseAgentFoundationPackV1,
  parseAgentSkillMetadataV1,
} from "@kanvas/application";
import { describe, expect, it } from "vitest";

function record(value: unknown): Readonly<Record<string, unknown>> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Readonly<Record<string, unknown>>;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("First-party Agent Foundation Packs", () => {
  it("resolve every Skill instruction and Workflow entrypoint from data", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const pack = parseAgentFoundationPackV1(
      await json(
        resolve(
          repositoryRoot,
          "agent-packs/first-party/workspace-home/manifest.json",
        ),
      ),
    );
    expect(pack).toBeDefined();
    expect(pack?.profiles).toHaveLength(1);
    expect(
      pack?.profiles.find((profile) =>
        profile.surfaceBindings.includes("agent_workspace"),
      ),
    ).toEqual(defaultAgentWorkspaceProfileV1);
    expect(
      pack?.profiles.flatMap((profile) => profile.surfaceBindings),
    ).toEqual(["agent_workspace"]);
    expect(pack?.skills).toHaveLength(4);
    for (const source of pack?.skills ?? []) {
      const manifestPath = resolve(repositoryRoot, source.manifestPath);
      const manifest = record(await json(manifestPath));
      const metadata = parseAgentSkillMetadataV1(manifest);
      expect(metadata).toBeDefined();
      const markdown = await readFile(
        resolve(
          repositoryRoot,
          source.instructionRootPath,
          metadata?.instructionResourcePath ?? "",
        ),
        "utf8",
      );
      expect(markdown.trim().length).toBeGreaterThan(24);
      const entrypoints = Array.isArray(manifest.entrypoints)
        ? manifest.entrypoints.map((value) => record(value))
        : [];
      for (const binding of source.workflowEntrypoints) {
        const entrypoint = entrypoints.find(
          (value) => value.entrypointKey === binding.entrypointKey,
        );
        expect(entrypoint).toBeDefined();
        expect(entrypoint?.workflowPath).toBeTypeOf("string");
        const workflow = record(
          await json(
            resolve(
              dirname(manifestPath),
              "..",
              String(entrypoint?.workflowPath),
            ),
          ),
        );
        expect(workflow.key).toBe(binding.workflowKey);
      }
    }

    const brandSocialSource = pack?.skills.find(
      (source) =>
        source.manifestPath ===
        "scenario-packs/first-party/brand-social-starter/skill/manifest.json",
    );
    expect(brandSocialSource).toBeDefined();
    const brandSocialInstructions = await readFile(
      resolve(
        repositoryRoot,
        brandSocialSource?.instructionRootPath ?? "",
        "SKILL.md",
      ),
      "utf8",
    );
    expect(brandSocialInstructions).toContain("结果图");
    expect(brandSocialInstructions).toContain("可编辑画板");
    expect(brandSocialInstructions).toContain("同一品牌 Revision");
    expect(brandSocialInstructions).toContain(
      "Workflow 成功本身不代表用户目标完成",
    );
    expect(brandSocialInstructions).toContain("没有可用的图片生成提案 Tool");
  });
});
