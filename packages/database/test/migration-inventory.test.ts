import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import { validateMigrationHistory } from "../src/migrator/run-migrations.js";

describe("migration inventory", () => {
  it("is ordered and checksummed", async () => {
    const inventory = await readMigrationInventory(
      resolve(import.meta.dirname, "../migrations"),
    );

    expect(inventory.map(({ name }) => name)).toEqual([
      "0000_initial_schema.sql",
      "0001_instance_registration_policy.sql",
      "0002_instance_registration_email_verification_policy.sql",
      "0003_agent_thread_view_revision.sql",
      "0004_agent_memory_source_message.sql",
      "0005_capability_run_declaration_revision.sql",
      "0006_provider_result_facts.sql",
      "0007_site_tools.sql",
      "0008_site_tool_deletion.sql",
      "0009_site_cover_uploads.sql",
      "0010_site_cover_retention.sql",
      "0011_tool_visual_identity.sql",
      "0012_default_workspace_access.sql",
      "0013_invitation_operator_role.sql",
      "0014_runtime_configuration.sql",
      "0015_provider_result_recovery.sql",
      "0016_agent_runtime_timeout_snapshot.sql",
      "0017_provider_result_policy_decisions.sql",
      "0018_agent_model_messages.sql",
      "0019_resource_libraries.sql",
      "0020_agent_resource_library_bindings.sql",
      "0021_agent_library_runtime.sql",
      "0022_library_consumer_authority.sql",
      "0023_library_text_index.sql",
    ]);
    for (const migration of inventory) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("ships one current data-free baseline", async () => {
    const [baseline] = await readMigrationInventory(
      resolve(import.meta.dirname, "../migrations"),
    );

    expect(baseline?.sql.match(/^CREATE TABLE /gmu)).toHaveLength(143);
    expect(baseline?.sql).not.toMatch(/^CREATE TRIGGER /mu);
    expect(baseline?.sql).not.toMatch(
      /\b(?:backfill|legacy)\b|^\s*(?:INSERT\s+INTO|UPDATE\s+`|DELETE\s+FROM)\s/imu,
    );
    expect(baseline?.sql).not.toMatch(
      /^ALTER TABLE .*\b(?:ADD|DROP|MODIFY|CHANGE) COLUMN\b/mu,
    );
  });

  it("recognizes only the archived pre-release checksum without rewriting history", async () => {
    const inventory = await readMigrationInventory(
      resolve(import.meta.dirname, "../migrations"),
    );
    const legacy = await readFile(
      resolve(
        import.meta.dirname,
        "../migrations/legacy/0000_initial_schema.sql",
      ),
      "utf8",
    );
    const checksum = createHash("sha256").update(legacy).digest("hex");
    expect(inventory[0]?.compatibleChecksums).toEqual([checksum]);
    const record = {
      name: "0000_initial_schema.sql",
      checksum,
      state: "applied",
    };
    expect([...validateMigrationHistory(inventory, [record])]).toEqual([
      record.name,
    ]);
    expect(record.checksum).toBe(checksum);
    expect(() =>
      validateMigrationHistory(inventory, [
        { ...record, checksum: "f".repeat(64) },
      ]),
    ).toThrow(/checksum drift/);
    // Baseline compatibility covers identical table definitions, not arbitrary schema changes.
    expect(inventory[0]?.sql.split("SET TIME_ZONE=@OLD_TIME_ZONE;")[0]).toBe(
      legacy.split("CREATE TRIGGER")[0],
    );
  });
});
