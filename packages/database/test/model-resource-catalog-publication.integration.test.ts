import { resolve } from "node:path";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ModelResourceManifest } from "@kanvas/contracts/api";
import type { ModelResourceCatalogAssetV1 } from "@kanvas/contracts/capability";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { installCatalogPackageV1 } from "../src/cli/catalog-package-installer.js";
import { createModelResourceImportStore } from "../src/runtime/model-resource-import-store.js";
import { createModelResourceAdminStore } from "../src/runtime/model-resource-admin-store.js";
import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";
import { createCapabilityRunStore } from "../src/runtime/capability-run-store.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-08-31T18:00:00.000Z");

interface CatalogRow extends RowDataPacket {
  readonly id: string;
  readonly document: ModelResourceCatalogAssetV1 | string;
}

interface CountRow extends RowDataPacket {
  readonly resourceCount: number | string;
  readonly fileCount: number | string;
  readonly activeBindingCount: number | string;
  readonly enabledWorkflowCount: number | string;
  readonly activeSkillCount: number | string;
}

describe.skipIf(!enabled)(
  "Catalog model resource publication against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(1),
      principalId: id(2),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "model-resource-catalog-publication",
      authorityType: "human_membership",
      authorityId: id(3),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: ["capability.configure", "capability.run"] as const,
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
           VALUES (?, 'model-resource-catalog-publication', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'model-resource-catalog', 'Model Resource Catalog',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'model-resource-catalog', 'Model Resource Catalog',
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
      await installCatalogPackageV1({
        pool,
        workspaceId: scope.workspaceId,
        actorPrincipalId: scope.principalId,
        packageRoot: resolve(
          import.meta.dirname,
          "../../../catalog-packages/kanvas-default",
        ),
        now,
      });
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("publishes one exact Catalog release and restores dependent runtime surfaces atomically", async () => {
      const [catalogRows] = await pool!.execute<CatalogRow[]>(
        `SELECT id, document
         FROM model_resource_catalog_entry
         WHERE workspace_id = ? AND resource_key = 'isnet.isnet-general'
         LIMIT 1`,
        [scope.workspaceId],
      );
      const catalogRow = catalogRows[0];
      if (!catalogRow)
        throw new Error("Catalog model recommendation is missing.");
      const catalog =
        typeof catalogRow.document === "string"
          ? (JSON.parse(catalogRow.document) as ModelResourceCatalogAssetV1)
          : catalogRow.document;
      const displayName =
        catalog.displayName.values[catalog.displayName.defaultLocale];
      if (!displayName) throw new Error("Catalog model name is missing.");
      const uploadSessionId = id(10);
      const storedObjectId = id(11);
      const importId = id(12);
      const resourceId = id(13);
      const revisionId = id(14);
      const storageProfileId = id(15);
      const byteSize = "1024";
      const sha256 = catalog.expectedSha256.slice("sha256:".length);
      const immutableIdentityHash = `sha256:${"d".repeat(64)}`;
      const manifest: ModelResourceManifest = {
        schemaVersion: "kanvas.model-resource/v1",
        family: catalog.family,
        variant: catalog.variant,
        format: catalog.format,
        executionTargets: [...catalog.executionTargets],
        sha256: catalog.expectedSha256,
        mediaType: catalog.mediaType,
        license: catalog.license,
        source: catalog.source,
        nativeInterface: catalog.nativeInterface,
        runtime: {},
      };
      expect(catalog.revisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

      await pool!.execute(
        `INSERT INTO upload_session (
           id, workspace_id, purpose, actor_id,
           storage_profile_id, container, object_key,
           upload_mode, write_protection_mode, state, version,
           expires_at, cleanup_eligible_at, cleanup_state,
           verified_size, verified_sha256, detected_media_type,
           verification_profile_version, created_at, updated_at
         ) VALUES (
           ?, ?, 'model_resource', ?, ?, 'models', 'isnet/model.onnx',
           'server_stream', 'server_owned', 'verified', 1,
           ?, ?, 'none', ?, ?, 'application/octet-stream',
           'opaque-model-sha256-v1', ?, ?
         )`,
        [
          uploadSessionId,
          scope.workspaceId,
          scope.principalId,
          storageProfileId,
          new Date(now.getTime() + 3_600_000),
          new Date(now.getTime() + 7_200_000),
          byteSize,
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
         ) VALUES (?, ?, ?, ?, 'models', 'isnet/model.onnx', ?, ?, ?,
           'application/octet-stream', 'active', ?)`,
        [
          storedObjectId,
          scope.workspaceId,
          uploadSessionId,
          storageProfileId,
          immutableIdentityHash,
          byteSize,
          sha256,
          now,
        ],
      );
      await pool!.execute(
        `UPDATE upload_session
         SET state = 'committed', committed_stored_object_id = ?,
             committed_at = ?, updated_at = ?
         WHERE id = ?`,
        [storedObjectId, now, now, uploadSessionId],
      );
      await pool!.execute(
        `INSERT INTO model_resource_import (
           id, workspace_id, created_by_principal_id,
           idempotency_key, request_hash, source_kind, source,
           catalog_entry_id, expected_sha256, upload_session_id,
           lifecycle_status, suggested_key, suggested_display_name,
           detected_format, detected_license, native_interface,
           compatible_adapters, required_user_inputs,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, 'catalog-import', ?, 'url', ?, ?, ?, ?,
           'ready', ?, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY(), 1, ?, ?)`,
        [
          importId,
          scope.workspaceId,
          scope.principalId,
          `sha256:${"a".repeat(64)}`,
          JSON.stringify(catalog.source),
          catalogRow.id,
          sha256,
          uploadSessionId,
          catalog.resourceKey,
          displayName,
          catalog.format,
          JSON.stringify({ ...catalog.license, confidence: "declared" }),
          JSON.stringify(catalog.nativeInterface),
          now,
          now,
        ],
      );
      await pool!.execute(
        `INSERT INTO model_resource_import_file (
           workspace_id, model_resource_import_id, path, stored_object_id,
           media_type, byte_size, sha256, source_metadata, created_at
         ) VALUES (?, ?, ?, ?, 'application/octet-stream', ?, ?, ?, ?)`,
        [
          scope.workspaceId,
          importId,
          catalog.source.kind === "hugging_face"
            ? catalog.source.filePath
            : "model.onnx",
          storedObjectId,
          byteSize,
          sha256,
          JSON.stringify(catalog.source),
          now,
        ],
      );

      const store = createModelResourceImportStore(pool!);
      const options = {
        scope,
        importId,
        expectedVersion: 1,
        resourceId,
        revisionId,
        target: {
          kind: "new" as const,
          key: catalog.resourceKey,
          revision: catalog.revision,
        },
        displayName,
        manifest,
        revisionDigest: catalog.revisionDigest,
        idempotencyKey: "publish-catalog-model",
        requestHash: `sha256:${"b".repeat(64)}`,
        audit: {
          auditEventId: id(20),
          actorPrincipalId: scope.principalId,
          actorType: "human" as const,
          authenticationRefType: "session" as const,
          authenticationRefHash: `sha256:${"c".repeat(64)}`,
          authorityType: "human_membership" as const,
          authorityId: scope.authorityId,
          authorityVersion: scope.authorityVersion,
        },
        now,
      };
      await expect(store.finalizePublished(options)).resolves.toEqual({
        resourceId,
        revisionId,
        replayed: false,
      });
      await expect(store.finalizePublished(options)).resolves.toEqual({
        resourceId,
        revisionId,
        replayed: true,
      });

      const [counts] = await pool!.execute<CountRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM model_resource
             WHERE workspace_id = ? AND id = ?) AS resourceCount,
           (SELECT COUNT(*) FROM model_resource_revision_file
             WHERE workspace_id = ? AND model_resource_revision_id = ?)
             AS fileCount,
           (SELECT COUNT(*)
              FROM capability_binding AS binding
              INNER JOIN capability_implementation_model_resource AS link
                ON link.workspace_id = binding.workspace_id
               AND link.implementation_revision_id =
                   binding.implementation_revision_id
             WHERE binding.workspace_id = ?
               AND link.model_resource_revision_id = ?
               AND binding.lifecycle_status = 'active') AS activeBindingCount,
           (SELECT COUNT(*) FROM workflow_revision_activation
             WHERE workspace_id = ? AND runtime_status = 'enabled')
             AS enabledWorkflowCount,
           (SELECT COUNT(*) FROM skill_revision_activation
             WHERE workspace_id = ? AND runtime_status = 'enabled')
             AS activeSkillCount`,
        [
          scope.workspaceId,
          resourceId,
          scope.workspaceId,
          revisionId,
          scope.workspaceId,
          revisionId,
          scope.workspaceId,
          scope.workspaceId,
        ],
      );
      expect(Number(counts[0]?.resourceCount)).toBe(1);
      expect(Number(counts[0]?.fileCount)).toBe(1);
      expect(Number(counts[0]?.activeBindingCount)).toBeGreaterThan(0);
      expect(Number(counts[0]?.enabledWorkflowCount)).toBe(0);
      expect(Number(counts[0]?.activeSkillCount)).toBe(0);

      const agentCatalog = await createCapabilityDefinitionAdminStore(
        pool!,
      ).searchAgentCatalog(scope, "background", 20, now);
      const backgroundRemoval = agentCatalog.find(
        (item) => item.key === "image.background.remove",
      );
      expect(backgroundRemoval).toBeDefined();
      expect(backgroundRemoval).not.toHaveProperty(
        "invocationWorkflowRevisionId",
      );
      expect(backgroundRemoval?.declaration.catalog.title).toEqual({
        "zh-CN": "背景移除",
        "en-US": "Background removal",
      });

      const canvasCatalog = await createCapabilityRunStore(pool!, {
        instanceId: "model-resource-catalog-publication",
      }).listCanvasCapabilities(
        scope,
        {
          actionGroup: "image.edit",
          selectedSemanticType: "artifact.image",
          locale: "en-US",
        },
        now,
      );
      expect(
        canvasCatalog.find(
          (item) => item.capabilityKey === "image.background.remove",
        ),
      ).toMatchObject({
        displayName: "Background removal",
        canvas: { actionGroup: "image.edit" },
      });

      const browserRuntimeCandidates = await createModelResourceAdminStore(
        pool!,
      ).listBrowserRuntimeCandidates(scope, now);
      expect(Object.isFrozen(browserRuntimeCandidates)).toBe(true);
    });
  },
);
