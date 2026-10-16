import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Capability Definition control-plane baseline", () => {
  it("ships stable definitions and immutable declarations without data migration", async () => {
    const sql = await readFile(
      resolve(import.meta.dirname, "../migrations/0000_initial_schema.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE `capability_definition` (");
    expect(sql).toContain("CREATE TABLE `capability_declaration_revision` (");
    expect(sql).toContain("current_contract_revision_id");
    expect(sql).toContain("current_declaration_revision_id");
    expect(sql).toContain("UNIQUE KEY `uq_cap_declaration_revision");
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toContain("INSERT INTO capability_definition");
    expect(sql).not.toContain("UPDATE capability_definition");
  });
});
