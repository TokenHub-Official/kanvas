import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import type { Pool } from "mysql2/promise";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  createSiteCoverStore,
  type SiteCoverStore,
} from "../src/runtime/site-cover-store.js";
import { createSiteToolImageStore } from "../src/runtime/site-tool-image-store.js";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";
const id = (n: number) => `01K${String(n).padStart(23, "0")}`;
const scope: TrustedInstanceAdministratorScope = {
  instanceId: "site-cover",
  principalId: id(1),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "browser",
  authorityType: "instance_administrator",
  authorityId: id(1),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  trusted: true,
};
const input = {
  name: "cover.png",
  expectedSize: 24,
  expectedMediaType: "image/png" as const,
  identity: {
    storageProfileId: "test",
    container: "covers",
    objectKey: "sites/site-cover/test.png",
  },
};
describe.skipIf(!disposableIntegrationDatabase)(
  "site cover storage boundary",
  () => {
    let pool: Pool;
    let store: SiteCoverStore;
    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const c = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(c);
        for (const n of [1, 2]) {
          await c.execute(
            "INSERT INTO principal (id,principal_type,status,version,created_at,updated_at) VALUES (?,'human','active',1,NOW(3),NOW(3))",
            [id(n)],
          );
          await c.execute(
            "INSERT INTO human_principal (principal_id,auth_subject_id,created_at) VALUES (?,?,NOW(3))",
            [id(n), id(n)],
          );
          await c.execute(
            "INSERT INTO instance_administrator (principal_id,status,version,created_at,updated_at) VALUES (?,'active',1,NOW(3),NOW(3))",
            [id(n)],
          );
        }
        await c.execute(
          "INSERT INTO instance_runtime_state (instance_id,state,reason,changed_by,changed_at) VALUES (?,'ACTIVE','test','test',NOW(3))",
          [scope.instanceId],
        );
      } finally {
        c.release();
      }
      store = createSiteCoverStore(pool, scope.instanceId);
    });
    afterAll(async () => {
      await pool?.end();
    });
    it("commits with stable replay and keeps library images out of cleanup", async () => {
      const session = await store.allocate(scope, "one", input);
      await expect(
        store.get({ ...scope, instanceId: "another-site" }, session.record.id),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      await expect(
        createSiteCoverStore(pool, "another-site").get(
          scope,
          session.record.id,
        ),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      expect(
        (
          await store.allocate(scope, "one", {
            ...input,
            identity: { ...input.identity, objectKey: "unused" },
          })
        ).record.id,
      ).toBe(session.record.id);
      await expect(
        store.get(
          { ...scope, principalId: id(2), authorityId: id(2) },
          session.record.id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        store.allocate(scope, "one", { ...input, name: "different" }),
      ).rejects.toMatchObject({ code: "conflict" });
      let claim = await store.claim(scope, session.record.id);
      await store.release(scope, session.record.id, claim.token!);
      claim = await store.claim(scope, session.record.id);
      await store.release(scope, session.record.id, "stale-token");
      await expect(store.claim(scope, session.record.id)).rejects.toMatchObject(
        { code: "conflict" },
      );
      const object = {
        identity: input.identity,
        byteSize: "24",
        sha256: "a".repeat(64),
        immutableIdentityHash: "b".repeat(64),
      };
      await store.verified(
        scope,
        session.record.id,
        claim.token!,
        object,
        10,
        10,
      );
      expect(await store.commit(scope, session.record.id)).toEqual({
        imageId: session.record.id,
      });
      expect(await store.commit(scope, session.record.id)).toEqual({
        imageId: session.record.id,
      });
      expect(await store.list(scope)).toContainEqual({
        id: session.record.id,
        name: "cover.png",
      });
      const image = await createSiteToolImageStore(
        pool,
        scope.instanceId,
      ).readForAdministrator(scope, session.record.id);
      expect(image.storageObject).toEqual(object);
      expect(image.bytes.length).toBe(0);
      await pool.execute(
        "UPDATE site_cover_upload SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 DAY) WHERE id=?",
        [session.record.id],
      );
      expect(await store.claimCleanup()).toBeNull();
      // Two tools can reference the same image; a disabled tool still protects it.
      for (const n of [10, 11])
        await pool.execute(
          "INSERT INTO site_tool (id,instance_id,slug,display_name,summary,description_markdown,cover_image_id,tags,created_by_principal_id,usage_status,created_at,updated_at) VALUES (?,?,?,'test','','',?,'[]',?,'disabled',NOW(3),NOW(3))",
          [
            id(n),
            scope.instanceId,
            `tool-${n}`,
            session.record.id,
            scope.principalId,
          ],
        );
      await pool.execute(
        "UPDATE site_cover_upload SET unreferenced_since=DATE_SUB(NOW(3),INTERVAL 2 DAY) WHERE id=?",
        [session.record.id],
      );
      await pool.execute("UPDATE site_tool SET deleted_at=NOW(3) WHERE id=?", [
        id(10),
      ]);
      expect(await store.claimCleanup()).toBeNull();
      expect(
        await createSiteToolImageStore(
          pool,
          scope.instanceId,
        ).readForAdministrator(scope, session.record.id),
      ).toMatchObject({ id: session.record.id });
      await pool.execute("UPDATE site_tool SET deleted_at=NOW(3) WHERE id=?", [
        id(11),
      ]);
      expect(await store.claimCleanup()).toBeNull();
      await pool.execute(
        "UPDATE site_cover_upload SET unreferenced_since=DATE_SUB(NOW(3),INTERVAL 2 DAY) WHERE id=?",
        [session.record.id],
      );
      const unused = await store.claimCleanup();
      expect(unused?.id).toBe(session.record.id);
      await expect(
        createSiteToolImageStore(pool, scope.instanceId).readForAdministrator(
          scope,
          session.record.id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await store.finishCleanup(unused!.id, unused!.token);
    });
    it("cleans only expired abandoned sessions", async () => {
      const session = await store.allocate(scope, "orphan", {
        ...input,
        identity: { ...input.identity, objectKey: "orphan" },
      });
      await pool.execute(
        "UPDATE site_cover_upload SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 DAY) WHERE id=?",
        [session.record.id],
      );
      const cleanup = await store.claimCleanup();
      expect(cleanup?.id).toBe(session.record.id);
      await expect(
        store.commit(scope, session.record.id),
      ).rejects.toMatchObject({ code: "conflict" });
      await store.finishCleanup(cleanup!.id, cleanup!.token);
      expect(await store.claimCleanup()).toBeNull();
    });
    it("revalidates authority after allocation", async () => {
      const session = await store.allocate(scope, "revoked", input);
      await pool.execute(
        "UPDATE instance_administrator SET status='revoked',version=version+1 WHERE principal_id=?",
        [scope.principalId],
      );
      await expect(store.claim(scope, session.record.id)).rejects.toMatchObject(
        { code: "instance_access.forbidden" },
      );
      await expect(
        store.commit(scope, session.record.id),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
    });
  },
);
