import { describe, expect, it } from "vitest";
import { ApiProblem } from "../api/transport.js";
import { skillErrorKey } from "./skill-error.js";

describe("Skill recovery messages", () => {
  it.each([
    [400, "skill_archive.encoding_invalid", "encoding"],
    [400, "skill_archive.required_file_missing", "missing"],
    [400, "skill_archive.multiple_skills", "multiple"],
    [403, "workspace.forbidden", "permission"],
    [409, "publication.conflict", "conflict"],
    [500, "s3_storage.unavailable", "storage"],
  ])("preserves the recovery direction for %s %s", (status, code, key) => {
    expect(
      skillErrorKey(new ApiProblem(status, code, "internal details")),
    ).toBe(`agent.skillErrors.${key}`);
  });
  it("does not present network uncertainty as a definite failed write", () => {
    expect(skillErrorKey(new TypeError("Failed to fetch"))).toBe(
      "agent.skillErrors.connection",
    );
  });
});
