import { describe, expect, it } from "vitest";

import { validateAgentsSearch } from "./agents.js";
import { validateAssetSearch } from "./assets.js";
import { validateSkillsSearch } from "./skills.js";
import { skillMatchesQuery } from "./skills-page.js";

describe("resource navigation context", () => {
  it("keeps Agent list filters when opening a workbench", () => {
    expect(
      validateAgentsSearch({ q: "海报", scope: "mine", tab: "resources" }),
    ).toEqual({ q: "海报", scope: "mine" });
    expect(validateAgentsSearch({ q: [], scope: "invalid" })).toEqual({});
  });
  it("preserves Skill publication filters alongside the selected file", () => {
    expect(
      validateSkillsSearch({
        q: "海报",
        scope: "mine",
        status: "changes",
        file: "scripts/check.py",
        notice: "imported",
      }),
    ).toEqual({
      q: "海报",
      scope: "mine",
      status: "changes",
      file: "scripts/check.py",
      notice: "imported",
    });
    expect(
      validateSkillsSearch({ status: "unknown", notice: "unknown" }),
    ).toEqual({});
  });
  it("preserves Skill management scope and a safe source route", () => {
    expect(
      validateSkillsSearch({
        scope: "mine",
        q: " 海报 ",
        returnTo: "/w/studio/agents/designer",
      }),
    ).toEqual({
      scope: "mine",
      q: "海报",
      returnTo: "/w/studio/agents/designer",
    });
    expect(
      validateSkillsSearch({
        scope: "all",
        returnTo: "https://example.com",
        q: 42,
      }),
    ).toEqual({});
  });

  it("preserves the selected file between independent detail and editor pages", () => {
    expect(
      validateSkillsSearch({ file: "scripts/check.py", q: "poster" }),
    ).toEqual({ file: "scripts/check.py", q: "poster" });
    expect(validateSkillsSearch({ file: "" })).toEqual({});
    expect(validateSkillsSearch({ file: "SKILL.md" })).toEqual({});
  });

  it("uses names, descriptions and tags to find a Skill", () => {
    const skill = {
      displayName: "Poster",
      summary: "品牌宣传",
      tags: ["Example Studio"],
    };
    expect(skillMatchesQuery(skill, " POSTER ")).toBe(true);
    expect(skillMatchesQuery(skill, "宣传")).toBe(true);
    expect(skillMatchesQuery(skill, "example studio")).toBe(true);
    expect(skillMatchesQuery(skill, "video")).toBe(false);
  });

  it("keeps asset detail searches within the existing list query boundary", () => {
    expect(validateAssetSearch({ q: " logo " })).toEqual({ q: "logo" });
    expect(validateAssetSearch({ q: "x".repeat(121) })).toEqual({});
    expect(validateAssetSearch({ q: ["logo"] })).toEqual({});
  });
});
