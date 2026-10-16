import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ModelResourceManifest } from "@kanvas/contracts/api";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createModelResourceImportStore } from "../src/runtime/model-resource-import-store.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-01T08:00:00.000Z");

interface ResultRow extends RowDataPacket {
  readonly resourceCount: number | string;
  readonly revisionFileCount: number | string;
  readonly catalogCount: number | string;
}

describe.skipIf(!enabled)(
  "direct model resource publication against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(1),
      principalId: id(2),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "model-resource-direct-publication",
      authorityType: "human_membership",
      authorityId: id(3),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: ["capability.configure"] as const,
      trusted: true,
    });

    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
        await connection.execute(
          `INSERT INTO principal (
             id, principal_type, status, version, created_at, updated_at
           ) VALUES (?, 'human', 'active', 1, ?, ?)`,
          [scope.principalId, now, now],
        );
        await connection.execute(
          `INSERT INTO human_principal (principal_id, auth_subject_id, created_at)
           VALUES (?, 'model-resource-direct-publication', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'direct-model-resource', 'Direct Model Resource',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'direct-model-resource', 'Direct Model Resource',
             'active', 1, ?, ?)`,
          [scope.workspaceId, scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace_membership (
             id, organization_id, workspace_id, principal_id,
             role, status, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
          [
            scope.authorityId,
            scope.organizationId,
            scope.workspaceId,
            scope.principalId,
            now,
            now,
          ],
        );
      } finally {
        connection.release();
      }
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("publishes one upload without any Catalog entry", async () => {
      const uploadSessionId = id(10);
      const storedObjectId = id(11);
      const importId = id(12);
      const resourceId = id(13);
      const revisionId = id(14);
      const storageProfileId = id(15);
      const sha256 = "a".repeat(64);
      const immutableIdentityHash = `sha256:${"b".repeat(64)}`;
      const revisionDigest = `sha256:${"c".repeat(64)}`;
      const manifest: ModelResourceManifest = {
        schemaVersion: "kanvas.model-resource/v1",
        family: "portable",
        variant: "model",
        format: "onnx",
        executionTargets: ["browser"],
        sha256: `sha256:${sha256}`,
        byteSize: "4",
        mediaType: "application/octet-stream",
        license: { spdxId: "Apache-2.0" },
        source: { kind: "upload", fileName: "portable-model.onnx" },
        runtime: {},
      };

      await pool!.execute(
        `INSERT INTO upload_session (
           id, workspace_id, purpose, actor_id,
           storage_profile_id, container, object_key,
           upload_mode, write_protection_mode, state, version,
           expires_at, cleanup_eligible_at, cleanup_state,
           verified_size, verified_sha256, detected_media_type,
           verification_profile_version, created_at, updated_at
         ) VALUES (
           ?, ?, 'model_resource', ?, ?, 'objects', 'models/portable.onnx',
           'server_stream', 'server_owned', 'verified', 1,
           ?, ?, 'none', '4', ?, 'application/octet-stream',
           'model-resource-opaque-v1', ?, ?
         )`,
        [
          uploadSessionId,
          scope.workspaceId,
          scope.principalId,
          storageProfileId,
          new Date(now.getTime() + 3_600_000),
          new Date(now.getTime() + 7_200_000),
          sha256,
          now,
          now,
        ],
      );
      await pool!.execute(
        `INSERT INTO stored_object (
           id, workspace_id, created_from_upload_session_id,
           storage_profile_id, container, object_key,
           immutable_identity_hash, byte_size, sha256, media_type,
           delete_state, created_at
         ) VALUES (?, ?, ?, ?, 'objects', 'models/portable.onnx', ?, '4', ?,
           'application/octet-stream', 'active', ?)`,
        [
          storedObjectId,
          scope.workspaceId,
          uploadSessionId,
          storageProfileId,
          immutableIdentityHash,
          sha256,
          now,
        ],
      );
      await pool!.execute(
        `UPDATE upload_session
         SET state = 'committed', committed_stored_object_id = ?,
             committed_at = ?, version = 2, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
        [storedObjectId, now, now, scope.workspaceId, uploadSessionId],
      );
      await pool!.execute(
        `INSERT INTO model_resource_import (
           id, workspace_id, created_by_principal_id,
           idempotency_key, request_hash, source_kind, source,
           upload_session_id, lifecycle_status,
           suggested_key, suggested_display_name, detected_format,
           detected_license, compatible_adapters, required_user_inputs,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, 'direct-import', ?, 'upload', ?, ?, 'ready',
           'portable.model.onnx', 'Portable ONNX model', 'onnx', ?,
           JSON_ARRAY(), JSON_ARRAY(), 1, ?, ?)`,
        [
          importId,
          scope.workspaceId,
          scope.principalId,
          `sha256:${"d".repeat(64)}`,
          JSON.stringify(manifest.source),
          uploadSessionId,
          JSON.stringify({ spdxId: "Apache-2.0", confidence: "declared" }),
          now,
          now,
        ],
      );
      await pool!.execute(
        `INSERT INTO model_resource_import_file (
           workspace_id, model_resource_import_id, path, stored_object_id,
           media_type, byte_size, sha256, source_metadata, created_at
         ) VALUES (?, ?, 'portable-model.onnx', ?,
           'application/octet-stream', '4', ?, JSON_OBJECT(), ?)`,
        [scope.workspaceId, importId, storedObjectId, sha256, now],
      );

      const store = createModelResourceImportStore(pool!);
      const publication = {
        scope,
        importId,
        expectedVersion: 1,
        resourceId,
        revisionId,
        target: { kind: "new" as const, key: "portable.model.onnx" },
        displayName: "Portable ONNX model",
        manifest,
        revisionDigest,
        idempotencyKey: "publish-direct-model",
        requestHash: `sha256:${"e".repeat(64)}`,
        audit: {
          auditEventId: id(20),
          actorPrincipalId: scope.principalId,
          actorType: "human" as const,
          authenticationRefType: "session" as const,
          authenticationRefHash: `sha256:${"f".repeat(64)}`,
          authorityType: "human_membership" as const,
          authorityId: scope.authorityId,
          authorityVersion: scope.authorityVersion,
        },
        now,
      };

      await expect(store.finalizePublished(publication)).resolves.toEqual({
        resourceId,
        revisionId,
        replayed: false,
      });
      await expect(store.finalizePublished(publication)).resolves.toEqual({
        resourceId,
        revisionId,
        replayed: true,
      });

      const [rows] = await pool!.execute<ResultRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM model_resource
             WHERE workspace_id = ? AND id = ?) AS resourceCount,
           (SELECT COUNT(*) FROM model_resource_revision_file
             WHERE workspace_id = ? AND model_resource_revision_id = ?)
             AS revisionFileCount,
           (SELECT COUNT(*) FROM model_resource_catalog_entry
             WHERE workspace_id = ?) AS catalogCount`,
        [
          scope.workspaceId,
          resourceId,
          scope.workspaceId,
          revisionId,
          scope.workspaceId,
        ],
      );
      expect(rows[0]).toEqual({
        resourceCount: 1,
        revisionFileCount: 1,
        catalogCount: 0,
      });
    });

    it("reports download progress and completes a requested cancellation", async () => {
      const uploadSessionId = id(30);
      const importId = id(31);
      await pool!.execute(
        `INSERT INTO upload_session (
           id, workspace_id, purpose, actor_id,
           storage_profile_id, container, object_key,
           upload_mode, write_protection_mode, state, version,
           expires_at, cleanup_eligible_at, cleanup_state,
           expected_size, expected_sha256, expected_media_type,
           verification_profile_version, created_at, updated_at
         ) VALUES (
           ?, ?, 'model_resource', ?, ?, 'objects', 'models/cancel.onnx',
           'server_stream', 'server_owned', 'open', 1,
           ?, ?, 'none', '10485760', ?, 'application/octet-stream',
           'model-resource-opaque-v1', ?, ?
         )`,
        [
          uploadSessionId,
          scope.workspaceId,
          scope.principalId,
          id(32),
          new Date(now.getTime() + 3_600_000),
          new Date(now.getTime() + 7_200_000),
          "a".repeat(64),
          now,
          now,
        ],
      );
      await pool!.execute(
        `INSERT INTO model_resource_import (
           id, workspace_id, created_by_principal_id,
           idempotency_key, request_hash, source_kind, source,
           upload_session_id,
           lifecycle_status, compatible_adapters, required_user_inputs,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, 'cancel-import', ?, 'url', ?, ?,
           'fetching', JSON_ARRAY(), JSON_ARRAY(), 1, ?, ?)`,
        [
          importId,
          scope.workspaceId,
          scope.principalId,
          `sha256:${"b".repeat(64)}`,
          JSON.stringify({
            kind: "https",
            url: "https://models.example/cancel.onnx",
          }),
          uploadSessionId,
          now,
          now,
        ],
      );

      const store = createModelResourceImportStore(pool!);
      const claim = await store.claimNext({
        processingLeaseTokenHash: "c".repeat(64),
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      });
      if (!claim) throw new Error("Model download was not claimed.");
      await expect(
        store.reportDownloadProgress({
          importId,
          workspaceId: scope.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          downloadedBytes: "1048576",
          now: new Date(now.getTime() + 1_000),
        }),
      ).resolves.toBe("continue");
      const requested = await store.requestCancellation({
        scope,
        importId,
        now: new Date(now.getTime() + 2_000),
        audit: {
          auditEventId: id(33),
          actorPrincipalId: scope.principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: `sha256:${"d".repeat(64)}`,
          authorityType: "human_membership",
          authorityId: scope.authorityId,
          authorityVersion: scope.authorityVersion,
        },
      });
      expect(requested).toMatchObject({
        status: "fetching",
        downloadedBytes: "1048576",
        cancelRequestedAt: new Date(now.getTime() + 2_000),
      });
      await expect(
        store.reportDownloadProgress({
          importId,
          workspaceId: scope.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          downloadedBytes: "1048576",
          now: new Date(now.getTime() + 3_000),
        }),
      ).resolves.toBe("cancel_requested");
      await expect(
        store.completeCancellation({
          importId,
          workspaceId: scope.workspaceId,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: claim.processingLeaseTokenHash,
          now: new Date(now.getTime() + 4_000),
        }),
      ).resolves.toMatchObject({
        status: "cancelled",
        downloadedBytes: "1048576",
      });
    });
  },
);
