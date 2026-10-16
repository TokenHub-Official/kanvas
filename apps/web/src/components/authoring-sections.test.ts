import { describe, expect, it } from "vitest";
import {
  agentEditorSection,
  skillEditorSection,
  skillPackageName,
} from "./authoring-sections.js";
import { skillFileTree } from "./skill-content-browser.js";
import { agentComposerSkillPayload } from "../features/agent/agent-composer-reference-picker.js";

describe("authoring and composer task boundaries", () => {
  it("reveals the section containing a hidden invalid field", () => {
    expect(agentEditorSection("instructions")).toBe("instructions");
    expect(agentEditorSection("skillDefinitionIds")).toBe("resources");
    expect(skillEditorSection("name")).toBe("basics");
    expect(skillEditorSection("exampleRequests")).toBe("examples");
  });
  it("creates a valid package name without requiring an English display name", () => {
    expect(skillPackageName("", "海报制作", "1234abcd")).toBe("skill-1234abcd");
    expect(skillPackageName("", "Poster Design", "1234abcd")).toBe(
      "poster-design",
    );
    expect(skillPackageName("my-package", "ignored", "1234abcd")).toBe(
      "my-package",
    );
  });
  it("uses actual file paths and does not duplicate SKILL.md", () => {
    const tree = skillFileTree([
      "SKILL.md",
      "scripts/build.py",
      "scripts/test.py",
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[1]?.children?.map((file) => file.key)).toEqual([
      "scripts/build.py",
      "scripts/test.py",
    ]);
  });
  it("can use a normal Skill without inventing a workflow entrypoint", () => {
    expect(
      agentComposerSkillPayload({
        kind: "skill",
        id: "skill:revision",
        title: "Poster",
        skillRevisionId: "revision",
      }),
    ).toEqual({ skillRevisionId: "revision" });
  });
});
