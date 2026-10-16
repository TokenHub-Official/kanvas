import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const id = (value: number) => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-23T10:00:00Z");
describe.skipIf(!disposableIntegrationDatabase)(
  "site tool persistence boundaries",
  () => {
    let pool: Pool;
    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
        await connection.execute(
          "INSERT INTO principal (id, principal_type, status, version, created_at, updated_at) VALUES (?, 'human', 'active', 1, ?, ?)",
          [id(1), now, now],
        );
        for (const instance of ["tools-site-a", "tools-site-b"]) {
          await connection.execute(
            "INSERT INTO instance_runtime_state (instance_id, state, reason, changed_by, changed_at) VALUES (?, 'ACTIVE', 'test', 'test', ?)",
            [instance, now],
          );
        }
      } finally {
        connection.release();
      }
    });
    afterAll(async () => {
      await pool?.end();
    });

    const createTool = (tool: number, instance: string, slug: string) =>
      pool.execute(
        "INSERT INTO site_tool (id, instance_id, slug, display_name, summary, description_markdown, tags, created_by_principal_id, created_at, updated_at) VALUES (?, ?, ?, 'Tool', '', '', '[]', ?, ?, ?)",
        [id(tool), instance, slug, id(1), now, now],
      );

    it("creates tools without a Workspace and enforces per-site slug uniqueness", async () => {
      await createTool(10, "tools-site-a", "calculator");
      await expect(
        createTool(11, "tools-site-a", "calculator"),
      ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await createTool(12, "tools-site-b", "calculator");
    });

    it("rejects revisions linked across sites and incomplete publication", async () => {
      const insert = (
        instance: string,
        state: string,
        publishedAt: Date | null,
        publisher: string | null,
      ) =>
        pool.execute(
          `INSERT INTO site_tool_revision (id, instance_id, tool_id, release_notes, source_filename, source_bytes, source_sha256, byte_size, allowed_contract_revision_ids, revision_digest, check_status, lifecycle_status, created_by_principal_id, published_by_principal_id, created_at, published_at)
       VALUES (?, ?, ?, '', 'tool.html', ?, ?, 7, '[]', ?, 'passed', ?, ?, ?, ?, ?)`,
          [
            id(20),
            instance,
            id(10),
            Buffer.from("<html/>"),
            "a".repeat(64),
            `sha256:${"a".repeat(64)}`,
            state,
            id(1),
            publisher,
            now,
            publishedAt,
          ],
        );
      await expect(
        insert("tools-site-b", "draft", null, null),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(
        insert("tools-site-a", "published", now, id(1)),
      ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
      await insert("tools-site-a", "draft", null, null);
      await expect(
        pool.execute("UPDATE site_tool SET current_draft_id = ? WHERE id = ?", [
          id(20),
          id(12),
        ]),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    });

    it("allows a zero-call administrator preview without a Workspace but never a use session", async () => {
      const insert = (kind: string, maximumRuns: number) =>
        pool.execute(
          `INSERT INTO site_tool_session (id, instance_id, tool_id, revision_id, revision_digest, principal_id, authentication_ref_hash, execution_epoch, session_kind, maximum_runs, created_at, expires_at)
       VALUES (?, 'tools-site-a', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            id(30),
            id(10),
            id(20),
            `sha256:${"a".repeat(64)}`,
            id(1),
            "a".repeat(64),
            kind,
            maximumRuns,
            now,
            new Date(now.getTime() + 60000),
          ],
        );
      await expect(insert("use", 1)).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });
      await expect(insert("preview", 1)).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });
      await insert("preview", 0);
    });
  },
);
