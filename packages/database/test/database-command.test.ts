import { describe, expect, it } from "vitest";
import { parseDatabaseCommand } from "../src/cli/database-command.js";

describe("database deployment command", () => {
  it("keeps the existing default and plan flag compatible", () => {
    expect(parseDatabaseCommand([])).toBe("migrate");
    expect(parseDatabaseCommand(["--plan"])).toBe("plan");
    expect(parseDatabaseCommand(["status"])).toBe("status");
    expect(parseDatabaseCommand(["check"])).toBe("check");
    expect(parseDatabaseCommand(["--help"])).toBe("help");
  });
  it("rejects unknown or ambiguous arguments before touching a database", () => {
    expect(() => parseDatabaseCommand(["init", "--force"])).toThrow();
    expect(() => parseDatabaseCommand(["--plna"])).toThrow();
  });
});
