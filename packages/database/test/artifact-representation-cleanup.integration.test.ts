import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { createArtifactRepresentationStore } from "../src/runtime/artifact-representation-store.js";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const id = (n: number) => `01K${String(n).padStart(23, "0")}`;
const now = new Date("2026-09-18T00:00:00Z");

describe.skipIf(!disposableIntegrationDatabase)(
  "representation cleanup without triggers",
  () => {
    let pool: Pool;
    beforeAll(async () => {
      pool = createDisposableIntegrationPool(4);
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
      } finally {
        connection.release();
      }
      await pool.execute(
        `INSERT INTO organization (id, slug, name, status, version, created_at, updated_at)
      VALUES (?, 'cleanup', 'Cleanup', 'active', 1, ?, ?)`,
        [id(1), now, now],
      );
      await pool.execute(
        `INSERT INTO workspace (id, organization_id, slug, name, status, version, created_at, updated_at)
      VALUES (?, ?, 'cleanup', 'Cleanup', 'active', 1, ?, ?)`,
        [id(2), id(1), now, now],
      );
      for (const n of [3, 4]) {
        await pool.execute(
          `INSERT INTO artifact (id, workspace_id, structured_content, content_digest, artifact_type, metadata, created_at)
        VALUES (?, ?, JSON_OBJECT(), ?, 'image', JSON_OBJECT(), ?)`,
          [id(n), id(2), `sha256:${"a".repeat(64)}`, now],
        );
        await pool.execute(
          `INSERT INTO artifact_representation
        (id, workspace_id, source_artifact_id, variant_key, profile_version, storage_profile_id, container, object_key,
         immutable_identity_hash, byte_size, sha256, media_type, width, height, state, created_at)
        VALUES (?, ?, ?, 'thumbnail', 'v1', ?, 'objects', ?, ?, 10, ?, 'image/webp', 1, 1, 'available', ?)`,
          [
            id(n + 10),
            id(2),
            id(n),
            id(20),
            `thumb/${n}`,
            `sha256:${"b".repeat(64)}`,
            "c".repeat(64),
            now,
          ],
        );
      }
    });
    afterAll(async () => {
      await pool?.end();
    });

    it("hides expired sources immediately and serializes cleanup claims and retries", async () => {
      const store = createArtifactRepresentationStore(pool);
      const query = {
        workspaceId: id(2),
        sourceArtifactId: id(3),
        variantKey: "thumbnail",
        profileVersion: "v1",
      };
      expect(await store.findAvailable(query)).toMatchObject({ id: id(13) });
      const lease = { now, leaseExpiresAt: new Date(now.getTime() + 60000) };
      expect(
        await store.claimNextCleanup({
          ...lease,
          cleanupTokenHash: "d".repeat(64),
        }),
      ).toBeUndefined();
      // Trusted fixture establishes the source fact. No trigger updates its representation.
      await pool.execute(
        "UPDATE artifact SET availability_status = 'expired' WHERE id = ?",
        [id(3)],
      );
      expect(await store.findAvailable(query)).toBeUndefined();
      const claims = await Promise.all(
        ["d", "e"].map((char) =>
          store.claimNextCleanup({
            ...lease,
            cleanupTokenHash: char.repeat(64),
          }),
        ),
      );
      const winners = claims.filter((claim) => claim !== undefined);
      expect(winners).toHaveLength(1);
      const winner = winners[0]!;
      expect(winner).toMatchObject({
        id: id(13),
        state: "deletion_pending",
        cleanupAttempt: 1,
      });
      await store.finalizeCleanupFailure({
        id: winner.id,
        cleanupTokenHash: winner.cleanupTokenHash,
        errorCode: "temporary",
        retryAt: new Date(now.getTime() + 120000),
      });
      expect(
        await store.claimNextCleanup({
          ...lease,
          cleanupTokenHash: "f".repeat(64),
        }),
      ).toBeUndefined();
      const retryNow = new Date(now.getTime() + 120001);
      const retry = await store.claimNextCleanup({
        now: retryNow,
        leaseExpiresAt: new Date(retryNow.getTime() + 60000),
        cleanupTokenHash: "f".repeat(64),
      });
      expect(retry).toMatchObject({ id: id(13), cleanupAttempt: 2 });
      await store.finalizeCleanupSuccess({
        id: id(13),
        cleanupTokenHash: "f".repeat(64),
        result: "deleted",
        now: retryNow,
      });
      expect(
        await store.findAvailable({ ...query, sourceArtifactId: id(4) }),
      ).toMatchObject({ id: id(14), state: "available" });
    });
  },
);
