import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { createHash, randomUUID } from "node:crypto";
import type {
  StorageObjectIdentity,
  StorageObjectInspection,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { revalidateInstanceAdministratorInTransaction } from "./instance-access-store.js";
import { SiteToolStoreError } from "./site-tool-store.js";

export interface SiteCoverRecord {
  id: string;
  name: string;
  expectedSize: number;
  expectedMediaType: "image/png" | "image/jpeg" | "image/webp";
  identity: StorageObjectIdentity;
  inspection?: StorageObjectInspection;
  width?: number;
  height?: number;
}
export interface SiteCoverSession {
  state: string;
  record: SiteCoverRecord;
  expiresAt: Date;
}
export interface SiteCoverStore {
  allocate(
    scope: TrustedInstanceAdministratorScope,
    key: string,
    input: Omit<SiteCoverRecord, "id" | "inspection" | "width" | "height">,
  ): Promise<SiteCoverSession>;
  get(
    scope: TrustedInstanceAdministratorScope,
    id: string,
  ): Promise<SiteCoverSession>;
  claim(
    scope: TrustedInstanceAdministratorScope,
    id: string,
  ): Promise<{ session: SiteCoverSession; token: string | null }>;
  verified(
    scope: TrustedInstanceAdministratorScope,
    id: string,
    token: string,
    inspection: StorageObjectInspection,
    width: number,
    height: number,
  ): Promise<void>;
  release(
    scope: TrustedInstanceAdministratorScope,
    id: string,
    token: string,
  ): Promise<void>;
  commit(
    scope: TrustedInstanceAdministratorScope,
    id: string,
  ): Promise<{ imageId: string }>;
  list(
    scope: TrustedInstanceAdministratorScope,
  ): Promise<Array<{ id: string; name: string }>>;
  claimCleanup(): Promise<{
    id: string;
    token: string;
    record: SiteCoverRecord;
  } | null>;
  finishCleanup(id: string, token: string): Promise<void>;
}
const ttl = 24 * 60 * 60 * 1000;
const leaseMilliseconds = 5 * 60 * 1000;
function fail(
  code: "invalid" | "not_found" | "conflict" | "limit",
  message: string,
): never {
  throw new SiteToolStoreError(code, message);
}
export function createSiteCoverStore(
  pool: Pool,
  instanceId: string,
): SiteCoverStore {
  async function tx<T>(action: (c: PoolConnection) => Promise<T>): Promise<T> {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await action(c);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  async function authorized(
    c: PoolConnection,
    scope: TrustedInstanceAdministratorScope,
  ) {
    await revalidateInstanceAdministratorInTransaction(c, scope, instanceId);
    await c.execute(
      "SELECT instance_id FROM instance_runtime_state WHERE instance_id=? FOR UPDATE",
      [instanceId],
    );
  }
  function parse(row: RowDataPacket): SiteCoverSession {
    return {
      state: row.state as string,
      record: (typeof row.record === "string"
        ? JSON.parse(row.record)
        : row.record) as SiteCoverRecord,
      expiresAt: new Date(row.expires_at as Date),
    };
  }
  async function load(
    c: PoolConnection,
    scope: TrustedInstanceAdministratorScope,
    id: string,
  ) {
    await authorized(c, scope);
    const [rows] = await c.execute<RowDataPacket[]>(
      "SELECT * FROM site_cover_upload WHERE instance_id=? AND principal_id=? AND id=? FOR UPDATE",
      [instanceId, scope.principalId, id],
    );
    const row = rows[0] ?? fail("not_found", "Cover upload is unavailable.");
    const session = parse(row);
    if (
      ["cleaning", "cleaned"].includes(session.state) ||
      (session.state !== "committed" &&
        session.expiresAt.getTime() <= Date.now())
    )
      fail("conflict", "Cover upload has expired.");
    return { row, session };
  }
  return {
    allocate(scope, key, input) {
      if (
        !/^[A-Za-z0-9:_-]{1,160}$/.test(key) ||
        !Number.isSafeInteger(input.expectedSize) ||
        input.expectedSize < 1 ||
        input.expectedSize > 2 * 1024 * 1024
      )
        fail("invalid", "Invalid cover upload size or key.");
      // The generated object key is deliberately excluded from replay identity.
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            name: input.name,
            size: input.expectedSize,
            type: input.expectedMediaType,
          }),
        )
        .digest("hex");
      return tx(async (c) => {
        await authorized(c, scope);
        const [rows] = await c.execute<RowDataPacket[]>(
          "SELECT * FROM site_cover_upload WHERE instance_id=? AND principal_id=? AND operation_key=? FOR UPDATE",
          [instanceId, scope.principalId, key],
        );
        if (rows[0]) {
          if (rows[0].request_hash !== hash)
            fail("conflict", "Upload key was used for another file.");
          return parse(rows[0]);
        }
        const [count] = await c.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM site_cover_upload WHERE instance_id=? AND state NOT IN ('cleaned')",
          [instanceId],
        );
        if (Number(count[0]?.n) >= 1000)
          fail("limit", "Site cover library has reached its limit.");
        const record = { ...input, id: ulid() };
        const expiresAt = new Date(Date.now() + ttl);
        await c.execute(
          "INSERT INTO site_cover_upload (id,instance_id,principal_id,operation_key,request_hash,state,record,expires_at,created_at) VALUES (?,?,?,?,?,'allocated',?,?,?)",
          [
            record.id,
            instanceId,
            scope.principalId,
            key,
            hash,
            JSON.stringify(record),
            expiresAt,
            new Date(),
          ],
        );
        return { state: "allocated", record, expiresAt };
      });
    },
    get(scope, id) {
      return tx(async (c) => (await load(c, scope, id)).session);
    },
    claim(scope, id) {
      return tx(async (c) => {
        const { row, session } = await load(c, scope, id);
        if (["verified", "committed"].includes(session.state))
          return { session, token: null };
        if (
          row.lease_until &&
          new Date(row.lease_until as Date).getTime() > Date.now()
        )
          fail("conflict", "This image is still uploading. Retry shortly.");
        const token = randomUUID();
        await c.execute(
          "UPDATE site_cover_upload SET state='uploading',lease_token=?,lease_until=? WHERE id=?",
          [token, new Date(Date.now() + leaseMilliseconds), id],
        );
        return { session, token };
      });
    },
    verified(scope, id, token, inspection, width, height) {
      return tx(async (c) => {
        const { row, session } = await load(c, scope, id);
        if (row.lease_token !== token || session.state !== "uploading")
          fail("conflict", "Upload ownership changed.");
        const record = { ...session.record, inspection, width, height };
        await c.execute(
          "UPDATE site_cover_upload SET state='verified',record=?,lease_token=NULL,lease_until=NULL WHERE id=?",
          [JSON.stringify(record), id],
        );
      });
    },
    release(scope, id, token) {
      return tx(async (c) => {
        await authorized(c, scope);
        await c.execute(
          "UPDATE site_cover_upload SET state='allocated',lease_token=NULL,lease_until=NULL WHERE instance_id=? AND principal_id=? AND id=? AND state='uploading' AND lease_token=?",
          [instanceId, scope.principalId, id, token],
        );
      });
    },
    commit(scope, id) {
      return tx(async (c) => {
        const { session } = await load(c, scope, id);
        if (session.state === "committed") return { imageId: id };
        const r = session.record;
        if (
          session.state !== "verified" ||
          !r.inspection ||
          !r.width ||
          !r.height
        )
          fail("conflict", "Upload the image before confirming it.");
        await c.execute(
          "INSERT INTO site_tool_image (id,instance_id,content_bytes,content_sha256,byte_size,width,height,created_by_principal_id,created_at,storage_object,display_name) VALUES (?,?,NULL,?,?,?,?,?,?,?,?)",
          [
            id,
            instanceId,
            r.inspection.sha256,
            Number(r.inspection.byteSize),
            r.width,
            r.height,
            scope.principalId,
            new Date(),
            JSON.stringify(r.inspection),
            r.name,
          ],
        );
        await c.execute(
          "UPDATE site_cover_upload SET state='committed' WHERE id=?",
          [id],
        );
        const time = new Date();
        await appendAuditEventInTransaction(c, {
          id: ulid(),
          schemaVersion: auditEventSchemaVersion,
          organizationId: null,
          workspaceId: null,
          actorPrincipalId: scope.principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({
            context: "site-cover",
            reference: scope.authenticationRefId,
          }),
          authorityType: "instance_administrator",
          authorityId: scope.authorityId,
          authorityVersion: scope.authorityVersion,
          authorizationModelVersion: scope.authorizationModelVersion,
          authorizationDecision: {
            instanceId,
            action: "site_tool_image.upload",
            authorityId: scope.authorityId,
          },
          eventType: "site_tool_image.uploaded",
          action: "site_tool_image.upload",
          resourceType: "site_tool_image",
          resourceId: id,
          outcome: "succeeded",
          decisionReasonCode: "instance_administrator.active",
          severity: "info",
          requestId: null,
          traceId: null,
          details: {
            byteSize: Number(r.inspection.byteSize),
            width: r.width,
            height: r.height,
            storage: "object",
          },
          occurredAt: time,
          recordedAt: time,
        });
        return { imageId: id };
      });
    },
    list(scope) {
      return tx(async (c) => {
        await authorized(c, scope);
        const [rows] = await c.execute<RowDataPacket[]>(
          "SELECT id,display_name FROM site_tool_image WHERE instance_id=? AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1000",
          [instanceId],
        );
        return rows.map((r) => ({
          id: r.id as string,
          name: (r.display_name as string) || "",
        }));
      });
    },
    claimCleanup() {
      return tx(async (c) => {
        const now = new Date();
        // Serialize retirement with tool mutations, which take this same site lock.
        await c.execute(
          "SELECT instance_id FROM instance_runtime_state WHERE instance_id=? FOR UPDATE",
          [instanceId],
        );
        const references =
          "EXISTS (SELECT 1 FROM site_tool t WHERE t.instance_id=u.instance_id AND t.deleted_at IS NULL AND (t.cover_image_id=u.id OR t.logo_image_id=u.id))";
        await c.execute(
          `UPDATE site_cover_upload u SET unreferenced_since=NULL WHERE u.instance_id=? AND u.state='committed' AND ${references}`,
          [instanceId],
        );
        await c.execute(
          `UPDATE site_cover_upload u SET unreferenced_since=COALESCE(unreferenced_since,?) WHERE u.instance_id=? AND u.state='committed' AND NOT ${references}`,
          [now, instanceId],
        );
        const [rows] = await c.execute<RowDataPacket[]>(
          "SELECT * FROM site_cover_upload WHERE instance_id=? AND state!='cleaned' AND ((state='committed' AND unreferenced_since<=?) OR (state!='committed' AND expires_at<=?)) AND (lease_until IS NULL OR lease_until<=?) ORDER BY expires_at LIMIT 1 FOR UPDATE SKIP LOCKED",
          [instanceId, new Date(Date.now() - ttl), now, now],
        );
        if (!rows[0]) return null;
        const token = randomUUID();
        const session = parse(rows[0]);
        await c.execute(
          "UPDATE site_cover_upload SET state='cleaning',lease_token=?,lease_until=? WHERE id=?",
          [token, new Date(Date.now() + leaseMilliseconds), session.record.id],
        );
        await c.execute(
          "UPDATE site_tool_image SET retired_at=? WHERE instance_id=? AND id=?",
          [now, instanceId, session.record.id],
        );
        return { id: session.record.id, token, record: session.record };
      });
    },
    finishCleanup(id, token) {
      return tx(async (c) => {
        await c.execute(
          "UPDATE site_cover_upload SET state='cleaned',lease_token=NULL,lease_until=NULL WHERE instance_id=? AND id=? AND state='cleaning' AND lease_token=?",
          [instanceId, id, token],
        );
      });
    },
  };
}
