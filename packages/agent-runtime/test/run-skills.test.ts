import type { AgentSkillCatalogItem } from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import {
  createKanvasRunSkills,
  resolveSkillResource,
} from "../src/run-skills.js";

function skill(
  ordinal: number,
  options: { readonly bound: boolean; readonly summary: string },
): AgentSkillCatalogItem {
  const suffix = String(ordinal).padStart(2, "0");
  return {
    skillDefinitionId: `01K000000000000000000000${suffix}`,
    skillRevisionId: `01K100000000000000000000${suffix}`,
    skillKey: `workspace.skill-${suffix}`,
    skillName: `workspace-skill-${suffix}`,
    revision: 1,
    bound: options.bound,
    displayName: `Skill ${suffix}`,
    summary: options.summary,
    exampleRequests: [],
    toolFamilies: ["workflow"],
    canonicalDigest: `sha256:${String(ordinal).repeat(64).slice(0, 64)}`,
    instructionResource: {
      resourcePath: "SKILL.md",
      storedObjectId: `01K200000000000000000000${suffix}`,
      storageProfileId: `01K300000000000000000000${suffix}`,
      container: "skills",
      objectKey: `skills/${suffix}/SKILL.md`,
      sha256: String(ordinal).repeat(64).slice(0, 64),
      immutableIdentityHash: `sha256:${String(ordinal + 1)
        .repeat(64)
        .slice(0, 64)}`,
      contentDigest: `sha256:${String(ordinal).repeat(64).slice(0, 64)}`,
      mediaType: "text/markdown",
      byteSize: "64",
    },
    referenceResources: [
      {
        relativePath: "brand.md",
        resourcePath: "references/brand.md",
        storedObjectId: `01K400000000000000000000${suffix}`,
        storageProfileId: `01K300000000000000000000${suffix}`,
        container: "skills",
        objectKey: `skills/${suffix}/references/brand.md`,
        sha256: String(ordinal + 2)
          .repeat(64)
          .slice(0, 64),
        immutableIdentityHash: `sha256:${String(ordinal + 3)
          .repeat(64)
          .slice(0, 64)}`,
        contentDigest: `sha256:${String(ordinal + 2)
          .repeat(64)
          .slice(0, 64)}`,
        mediaType: "text/markdown",
        byteSize: "32",
      },
    ],
    entrypoints: [],
  };
}

describe("Kanvas Run Skills", () => {
  it("resolves full nested paths before shorthand and never crosses directories", async () => {
    const base = skill(1, { bound: true, summary: "Nested references" });
    const paths = [
      "references/xxx/guide.md",
      "assets/xxx/guide.md",
      "references/assets/xxx/guide.md",
      "references/xxx/yyy.jpg",
      "scripts/hidden.jpg",
    ];
    const item = {
      ...base,
      referenceResources: paths.map((resourcePath) => ({
        ...base.referenceResources[0]!,
        resourcePath,
        relativePath: resourcePath.replace(/^references\//u, ""),
        mediaType: resourcePath.endsWith(".jpg")
          ? "image/jpeg"
          : "text/markdown",
      })),
    };
    const loadReference = vi.fn((_skill, path: string) =>
      Promise.resolve(`content:${path}`),
    );
    const assertUsable = vi.fn(async () => {});
    const registry = createKanvasRunSkills({
      skills: [item],
      maximumActivatedInstructionBytes: 4096,
      maximumReferenceReadBytes: 4096,
      loadInstructions: () =>
        Promise.resolve({
          skillRevisionId: item.skillRevisionId,
          markdown: "Read the files.",
        }),
      loadReference,
      assertUsable,
      recordUse: async () => {},
    });
    for (const path of paths.slice(0, 3)) {
      expect(await registry.getReference(item.skillName, path)).toBe(
        `content:${path}`,
      );
      expect(loadReference).toHaveBeenLastCalledWith(item, path);
    }
    expect(await registry.getReference(item.skillName, "xxx/guide.md")).toBe(
      "content:references/xxx/guide.md",
    );
    for (const path of [
      "references/../assets/xxx/guide.md",
      "/references/xxx/guide.md",
      "references//xxx/guide.md",
      "references/xxx/missing.md",
      "references/xxx/yyy.jpg",
      "scripts/hidden.jpg",
    ])
      expect(await registry.getReference(item.skillName, path)).toBeNull();
    expect(resolveSkillResource(item, "scripts/hidden.jpg")).toBeUndefined();
    expect(
      resolveSkillResource(item, "references/xxx/yyy.jpg")?.resourcePath,
    ).toBe("references/xxx/yyy.jpg");
    expect(assertUsable).toHaveBeenCalledTimes(4);
    expect((await registry.get(item.skillName))?.instructions).toContain(
      "references/xxx/yyy.jpg",
    );
  });
  it("retains scripts outside discovery and rejects script reference reads", async () => {
    const item = skill(1, { bound: true, summary: "Retained source" });
    const source = {
      ...item,
      referenceResources: [
        ...item.referenceResources,
        {
          ...item.referenceResources[0]!,
          resourcePath: "scripts/compose.py",
          relativePath: "scripts/compose.py",
          mediaType: "text/plain",
        },
      ],
    };
    const loadReference = vi.fn(() => Promise.resolve("must not be read"));
    const registry = createKanvasRunSkills({
      skills: [source],
      maximumActivatedInstructionBytes: 4096,
      maximumReferenceReadBytes: 4096,
      assertUsable: async () => {},
      recordUse: async () => {},
      loadReference,
      loadInstructions: () =>
        Promise.resolve({
          skillRevisionId: source.skillRevisionId,
          displayName: source.displayName,
          contentDigest: source.instructionResource.contentDigest,
          markdown: "Generate a poster",
        }),
    });
    expect(await registry.listScripts(source.skillName)).toEqual([]);
    expect(
      await registry.getReference(source.skillName, "scripts/compose.py"),
    ).toBeNull();
    expect(loadReference).not.toHaveBeenCalled();
    expect((await registry.get(source.skillName))?.instructions).toContain(
      "Do not claim to have run them",
    );
  });

  it("advertises bound Skills and discovers another accessible Skill", async () => {
    const bound = skill(1, {
      bound: true,
      summary: "Use the bound brand system.",
    });
    const discovered = skill(2, {
      bound: false,
      summary: "Create an internal solar term campaign poster.",
    });
    const assertUsable = vi.fn(() => Promise.resolve());
    const recordUse = vi.fn(() => Promise.resolve());
    const registry = createKanvasRunSkills({
      skills: [bound, discovered],
      maximumActivatedInstructionBytes: 4_096,
      maximumReferenceReadBytes: 4_096,
      loadInstructions: (value) =>
        Promise.resolve({
          skillRevisionId: value.skillRevisionId,
          markdown: `# ${value.displayName}\n\nFollow this process.`,
        }),
      loadReference: () => Promise.resolve("# Brand\n\nUse purple."),
      assertUsable,
      recordUse,
    });

    await expect(registry.list()).resolves.toEqual([
      expect.objectContaining({ name: bound.skillName }),
    ]);
    await expect(registry.search("solar term")).resolves.toEqual([
      expect.objectContaining({ skillName: discovered.skillName }),
    ]);
    const loaded = await registry.get(discovered.skillName);
    expect(loaded?.instructions).toContain("Follow");
    await expect(
      registry.getReference(discovered.skillName, "references/brand.md"),
    ).resolves.toContain("purple");
    expect(assertUsable).toHaveBeenCalledWith(discovered);
    expect(recordUse).toHaveBeenCalledWith(discovered, "discovered");
  });

  it("never exposes scripts and enforces the Run instruction budget", async () => {
    const candidate = skill(4, {
      bound: true,
      summary: "A bounded Skill.",
    });
    const registry = createKanvasRunSkills({
      skills: [candidate],
      maximumActivatedInstructionBytes: 4,
      maximumReferenceReadBytes: 4,
      loadInstructions: () =>
        Promise.resolve({
          skillRevisionId: candidate.skillRevisionId,
          markdown: "This content is deliberately larger than four bytes.",
        }),
      loadReference: () => Promise.resolve("larger than four bytes"),
      assertUsable: () => Promise.resolve(),
      recordUse: () => Promise.resolve(),
    });

    await expect(
      registry.getScript(candidate.skillName, "run.sh"),
    ).resolves.toBeNull();
    await expect(registry.listScripts(candidate.skillName)).resolves.toEqual(
      [],
    );
    await expect(registry.get(candidate.skillName)).rejects.toThrow(
      "instruction budget",
    );
  });
});
