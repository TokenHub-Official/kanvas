import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Capability Implementation control-plane baseline", () => {
  it("pins contract, adapter revision, source, compiled mappings and fixtures", async () => {
    const sql = await readFile(
      resolve(import.meta.dirname, "../migrations/0000_initial_schema.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE `runtime_adapter_definition` (");
    expect(sql).toContain("CREATE TABLE `runtime_adapter_revision` (");
    const implementation = sql.slice(
      sql.indexOf("CREATE TABLE `capability_implementation_revision` ("),
      sql.indexOf("CREATE TABLE `capability_run` ("),
    );
    for (const column of [
      "`contract_revision_id`",
      "`runtime_adapter_revision_id`",
      "`source_kind`",
      "`source_reference`",
      "`input_mapping`",
      "`input_mapping_digest`",
      "`compiled_input_mapping`",
      "`output_mapping`",
      "`output_mapping_digest`",
      "`compiled_output_mapping`",
      "`fixture_suite`",
    ]) {
      expect(implementation).toContain(column);
    }
    expect(implementation).toContain(
      "`source_kind` in (_utf8mb4'model_resource',_utf8mb4'model_service',_utf8mb4'plugin')",
    );
    expect(implementation).not.toMatch(/_utf8mb4'(?:workflow|api|mcp)'/u);
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toMatch(/INSERT INTO runtime_adapter/iu);
  });
});
