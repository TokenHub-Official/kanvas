import { createHash } from "node:crypto";
import type {
  TrustedInstanceAdministratorScope,
  TrustedWorkspaceScope,
  StorageObjectInspection,
} from "@kanvas/application";
import { htmlToolPolicyVersion } from "@kanvas/contracts/api";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { revalidateInstanceAdministratorInTransaction } from "./instance-access-store.js";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { SiteToolStoreError } from "./site-tool-store.js";

export interface SiteToolImageContent {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}
export interface StoredSiteToolImage extends SiteToolImageContent {
  readonly id: string;
  readonly sha256: string;
  readonly storageObject?: StorageObjectInspection;
}
export interface SiteToolImageStore {
  upload(
    authority: TrustedInstanceAdministratorScope,
    key: string,
    image: SiteToolImageContent,
  ): Promise<{ imageId: string }>;
  readForAdministrator(
    authority: TrustedInstanceAdministratorScope,
    imageId: string,
  ): Promise<StoredSiteToolImage>;
  readForUser(
    scope: TrustedWorkspaceScope,
    imageId: string,
  ): Promise<StoredSiteToolImage>;
}
export function createSiteToolImageStore(
  pool: Pool,
  instanceId: string,
): SiteToolImageStore {
  function fail(code: SiteToolStoreError["code"], message: string): never {
    throw new SiteToolStoreError(code, message);
  }
  async function transaction<T>(
    action: (c: PoolConnection) => Promise<T>,
  ): Promise<T> {
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
  async function read(
    c: PoolConnection,
    imageId: string,
  ): Promise<StoredSiteToolImage> {
    if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(imageId))
      fail("not_found", "Image is unavailable.");
    const [rows] = await c.execute<
      (RowDataPacket & {
        id: string;
        content_bytes: Buffer | null;
        storage_object: StorageObjectInspection | string | null;
        content_sha256: string;
        width: number;
        height: number;
      })[]
    >(
      "SELECT id, content_bytes, storage_object, content_sha256, width, height FROM site_tool_image WHERE instance_id=? AND id=? AND retired_at IS NULL",
      [instanceId, imageId],
    );
    const row = rows[0] ?? fail("not_found", "Image is unavailable.");
    return {
      id: row.id,
      bytes: row.content_bytes ?? Buffer.alloc(0),
      ...(row.storage_object
        ? {
            storageObject: (typeof row.storage_object === "string"
              ? JSON.parse(row.storage_object)
              : row.storage_object) as StorageObjectInspection,
          }
        : {}),
      sha256: row.content_sha256,
      width: row.width,
      height: row.height,
    };
  }
  return {
    upload(authority, key, image) {
      if (
        !/^[A-Za-z0-9:_-]{1,160}$/.test(key) ||
        !image.bytes.length ||
        image.bytes.length > 524288 ||
        !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) ||
        image.width < 1 ||
        image.width > 2048 ||
        image.height < 1 ||
        image.height > 2048
      )
        fail("invalid", "The normalized image or operation key is invalid.");
      const digest = createHash("sha256").update(image.bytes).digest("hex");
      const requestHash = digestProviderValue({
        kind: "tool-image.upload",
        actor: authority.principalId,
        digest,
        width: image.width,
        height: image.height,
      });
      return transaction(async (c) => {
        await revalidateInstanceAdministratorInTransaction(
          c,
          authority,
          instanceId,
        );
        const [site] = await c.execute<RowDataPacket[]>(
          "SELECT instance_id FROM instance_runtime_state WHERE instance_id=? FOR UPDATE",
          [instanceId],
        );
        if (!site.length) fail("not_found", "Site is unavailable.");
        const [receipts] = await c.execute<RowDataPacket[]>(
          "SELECT request_hash, result FROM site_tool_operation WHERE instance_id=? AND idempotency_key=?",
          [instanceId, key],
        );
        if (receipts[0]) {
          if (receipts[0].request_hash !== requestHash)
            fail("conflict", "Operation key was used with different content.");
          const result = receipts[0].result as string | { imageId: string };
          return typeof result === "string"
            ? (JSON.parse(result) as { imageId: string })
            : result;
        }
        const [counts] = await c.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM site_tool_image WHERE instance_id=? AND retired_at IS NULL",
          [instanceId],
        );
        if (Number(counts[0]?.total) >= 1000)
          fail("limit", "Site tool artwork storage has reached its limit.");
        const imageId = ulid();
        const time = new Date();
        await c.execute(
          "INSERT INTO site_tool_image (id, instance_id, content_bytes, content_sha256, byte_size, width, height, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            imageId,
            instanceId,
            image.bytes,
            digest,
            image.bytes.length,
            image.width,
            image.height,
            authority.principalId,
            time,
          ],
        );
        await appendAuditEventInTransaction(c, {
          id: ulid(),
          schemaVersion: auditEventSchemaVersion,
          organizationId: null,
          workspaceId: null,
          actorPrincipalId: authority.principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({
            context: "site-tool-image",
            reference: authority.authenticationRefId,
          }),
          authorityType: "instance_administrator",
          authorityId: authority.authorityId,
          authorityVersion: authority.authorityVersion,
          authorizationModelVersion: authority.authorizationModelVersion,
          authorizationDecision: {
            instanceId,
            action: "site_tool_image.upload",
            authorityId: authority.authorityId,
          },
          eventType: "site_tool_image.uploaded",
          action: "site_tool_image.upload",
          resourceType: "site_tool_image",
          resourceId: imageId,
          outcome: "succeeded",
          decisionReasonCode: "instance_administrator.active",
          severity: "info",
          requestId: null,
          traceId: null,
          details: {
            byteSize: image.bytes.length,
            width: image.width,
            height: image.height,
          },
          occurredAt: time,
          recordedAt: time,
        });
        const result = { imageId };
        await c.execute(
          "INSERT INTO site_tool_operation (instance_id, idempotency_key, request_hash, result, created_at) VALUES (?, ?, ?, ?, ?)",
          [instanceId, key, requestHash, JSON.stringify(result), time],
        );
        return result;
      });
    },
    readForAdministrator(authority, imageId) {
      return transaction(async (c) => {
        await revalidateInstanceAdministratorInTransaction(
          c,
          authority,
          instanceId,
        );
        return read(c, imageId);
      });
    },
    readForUser(scope, imageId) {
      return transaction(async (c) => {
        if (
          scope.principalType !== "human" ||
          scope.authenticationRefType !== "session"
        )
          fail("not_found", "Image is unavailable.");
        await revalidateTrustedWorkspaceScopeInTransaction(
          c,
          scope,
          "workspace.read",
          new Date(),
        );
        const [references] = await c.execute<RowDataPacket[]>(
          `SELECT tool.id FROM site_tool AS tool INNER JOIN site_tool_revision AS revision
             ON revision.instance_id=tool.instance_id AND revision.tool_id=tool.id AND revision.id=tool.published_revision_id
           WHERE tool.instance_id=? AND tool.deleted_at IS NULL AND tool.usage_status='enabled' AND revision.lifecycle_status='published'
             AND revision.check_status='passed' AND revision.check_policy_version=?
             AND (tool.logo_image_id=? OR tool.cover_image_id=?) LIMIT 1`,
          [instanceId, htmlToolPolicyVersion, imageId, imageId],
        );
        if (!references.length) fail("not_found", "Image is unavailable.");
        return read(c, imageId);
      });
    },
  };
}
