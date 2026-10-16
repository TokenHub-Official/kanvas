import { inspectAndExtractSkillPackageArchive } from "@kanvas/database/runtime";
import { describe, expect, it } from "vitest";

import {
  buildSkillZip,
  parseSkillMarkdown,
  renderSkillMarkdown,
} from "../src/skills/skill-package.js";

describe("standard Skill packages", () => {
  it("round-trips SKILL.md frontmatter and a safe ZIP", () => {
    const markdown = renderSkillMarkdown({
      name: "seasonal-poster",
      description: "Create an on-brand internal seasonal poster.",
      bodyMarkdown:
        "# Seasonal poster\n\n1. Read the bound Brand.\n2. Create an image.",
    });
    expect(parseSkillMarkdown(Buffer.from(markdown))).toEqual({
      name: "seasonal-poster",
      description: "Create an on-brand internal seasonal poster.",
      bodyMarkdown:
        "# Seasonal poster\n\n1. Read the bound Brand.\n2. Create an image.",
    });

    const archive = inspectAndExtractSkillPackageArchive(
      buildSkillZip([
        { path: "SKILL.md", bytes: Buffer.from(markdown) },
        {
          path: "references/xxx/brand.md",
          bytes: Buffer.from("# Brand reference\n"),
        },
        {
          path: "references/xxx/yyy.jpg",
          bytes: Buffer.from([255, 216, 255, 224, 255, 217]),
        },
      ]),
    );
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "references/xxx/brand.md",
      "references/xxx/yyy.jpg",
    ]);
  });

  it("rejects a Skill index without standard frontmatter", () => {
    expect(() => parseSkillMarkdown(Buffer.from("# Instructions\n"))).toThrow(
      "must start with YAML frontmatter",
    );
  });
});
