import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Model Resource control-plane baseline", () => {
  it("ships immutable model releases without old implementation backfill", async () => {
    const sql = await readFile(
      resolve(import.meta.dirname, "../migrations/0000_initial_schema.sql"),
      "utf8",
    );
    const modelSql = [
      ...sql.matchAll(
        /CREATE TABLE `(?:model_resource(?:_[a-z_]+)?|capability_implementation_model_resource)` \([\s\S]*?;\n/gu,
      ),
    ]
      .map(([table]) => table)
      .join("\n");
    expect(modelSql).toContain("CREATE TABLE `model_resource` (");
    expect(modelSql).toContain("CREATE TABLE `model_resource_revision` (");
    expect(modelSql).toContain("CREATE TABLE `model_resource_import` (");
    expect(modelSql).toContain("CREATE TABLE `model_resource_import_file` (");
    expect(modelSql).toContain("CREATE TABLE `model_resource_revision_file` (");
    expect(modelSql).toContain(
      "CREATE TABLE `capability_implementation_model_resource` (",
    );
    expect(modelSql).not.toContain("INSERT INTO model_resource");
    expect(modelSql).not.toContain("UPDATE model_resource");
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(/secret_access_key|api_key|presigned/iu.test(modelSql)).toBe(false);
  });
});
