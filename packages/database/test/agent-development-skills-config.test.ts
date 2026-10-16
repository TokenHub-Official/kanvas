import { describe, expect, it } from "vitest";

import { loadAgentDevelopmentSkillFiles } from "../src/configuration/agent-development-skills.js";

describe("Agent development Skill files config", () => {
  it("accepts explicit absolute files only in development", () => {
    expect(
      loadAgentDevelopmentSkillFiles(
        {
          KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON: JSON.stringify({
            "workspace.skill": "/workspace/skills/workspace.skill/SKILL.md",
          }),
        },
        "development",
      ),
    ).toEqual({
      "workspace.skill": "/workspace/skills/workspace.skill/SKILL.md",
    });
    expect(() =>
      loadAgentDevelopmentSkillFiles(
        {
          KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON: JSON.stringify({
            "workspace.skill": "relative/SKILL.md",
          }),
        },
        "development",
      ),
    ).toThrow(/absolute paths/u);
    expect(() =>
      loadAgentDevelopmentSkillFiles(
        {
          KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON: JSON.stringify({
            "workspace.skill": "/workspace/SKILL.md",
          }),
        },
        "production",
      ),
    ).toThrow(/development-only/u);
  });
});
