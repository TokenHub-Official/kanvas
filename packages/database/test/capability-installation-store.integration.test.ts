import { resolve } from "node:path";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  capabilityCatalogRecommendationFromPreparedPackageV1,
  prepareCatalogPackageV1,
} from "../src/cli/catalog-package-installer.js";
import { registerCatalogPackageV1 } from "../src/cli/catalog-package-registrar.js";
import { loadCatalogPackageV1 } from "../src/cli/catalog-package-loader.js";
import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";
import { createCapabilityInstallationStore } from "../src/runtime/capability-installation-store.js";
import { createCapabilityBindingAdminStore } from "../src/runtime/capability-binding-admin-store.js";
import { createModelResourceAdminStore } from "../src/runtime/model-resource-admin-store.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-01T18:00:00.000Z");
const packageRoot = resolve(
  import.meta.dirname,
  "../../../catalog-packages/kanvas-default",
);

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

describe.skipIf(!enabled)(
  "Capability installation control plane against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "capability-installation",
      authorityType: "human_membership",
      authorityId: id(4),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: ["capability.configure", "capability.run"] as const,
      trusted: true,
    });
    const audit = (value: number): ControlPlaneAuditContext => ({
      auditEventId: id(value),
      actorPrincipalId: scope.principalId,
      actorType: "human",
      authenticationRefType: "session",
      authenticationRefHash: `sha256:${"a".repeat(64)}`,
      authorityType: "human_membership",
      authorityId: scope.authorityId,
      authorityVersion: scope.authorityVersion,
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
           VALUES (?, 'capability-installation', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'cap-install', 'Capability Installation',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'cap-install', 'Capability Installation',
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

    it("keeps a recommendation read-only until its one default route is ready", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const prepared = prepareCatalogPackageV1(
        await loadCatalogPackageV1(packageRoot),
      );
      const recommendation =
        capabilityCatalogRecommendationFromPreparedPackageV1(prepared, {
          recommendationKey: "recommendation.image.text.extract",
          defaultBindingAssetKey:
            "binding.first-party-image-text-extract-tesseract-eng-worker.r2",
        });
      const installations = createCapabilityInstallationStore(pool);
      await installations.registerCatalogEntry({
        workspaceId: scope.workspaceId,
        entryId: id(10),
        document: recommendation,
        now,
      });

      expect(await installations.listCatalogEntries(scope, now)).toMatchObject([
        {
          id: id(10),
          capabilityKey: "image.text.extract",
        },
      ]);
      expect(
        await createCapabilityDefinitionAdminStore(pool).list(scope, now),
      ).toEqual([]);

      const waiting = await installations.install({
        scope,
        operationId: id(11),
        catalogEntryId: id(10),
        idempotencyKey: "install-image-text-extract",
        now,
        nextId: () => id(900),
        requestedAudit: audit(20),
        completedAudit: audit(21),
      });
      expect(waiting).toMatchObject({
        status: "waiting_dependency",
        requiredModelResourceAssetKey: "model.tesseract.tessdata-fast-eng",
      });
      expect(
        await createCapabilityDefinitionAdminStore(pool).list(scope, now),
      ).toEqual([]);

      const model = [...prepared.modelResources.values()].find(
        (item) => item.document.resourceKey === "tesseract.tessdata-fast-eng",
      );
      if (!model) throw new Error("Tesseract recommendation is unavailable.");
      const connection = await pool.getConnection();
      try {
        await connection.execute(
          `INSERT INTO model_resource_catalog_entry (
             id, workspace_id, asset_key, resource_key, revision,
             canonical_digest, document, lifecycle_status,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [
            id(17),
            scope.workspaceId,
            model.assetKey,
            model.document.resourceKey,
            model.document.revision,
            model.digest,
            JSON.stringify(model.document),
            now,
            now,
          ],
        );
        const byteSize = model.document.expectedByteSize ?? "1";
        const sha256 = model.document.expectedSha256.slice("sha256:".length);
        await connection.execute(
          `INSERT INTO upload_session (
             id, workspace_id, purpose, actor_id,
             storage_profile_id, container, object_key,
             upload_mode, write_protection_mode, state, version,
             expires_at, cleanup_eligible_at, cleanup_state,
             verified_size, verified_sha256, detected_media_type,
             verification_profile_version, created_at, updated_at
           ) VALUES (
             ?, ?, 'model_resource', ?, ?, 'objects', 'models/tesseract.bin',
             'server_stream', 'server_owned', 'verified', 1,
             ?, ?, 'none', ?, ?, ?, 'model-resource-opaque-v1', ?, ?
           )`,
          [
            id(32),
            scope.workspaceId,
            scope.principalId,
            id(34),
            new Date(now.getTime() + 3_600_000),
            new Date(now.getTime() + 7_200_000),
            byteSize,
            sha256,
            model.document.mediaType,
            now,
            now,
          ],
        );
        await connection.execute(
          `INSERT INTO stored_object (
             id, workspace_id, created_from_upload_session_id,
             storage_profile_id, container, object_key,
             immutable_identity_hash, byte_size, sha256, media_type,
             delete_state, created_at
           ) VALUES (?, ?, ?, ?, 'objects', 'models/tesseract.bin', ?, ?, ?, ?,
             'active', ?)`,
          [
            id(33),
            scope.workspaceId,
            id(32),
            id(34),
            digestProviderValue({ object: "tesseract" }),
            byteSize,
            sha256,
            model.document.mediaType,
            now,
          ],
        );
        await connection.execute(
          `UPDATE upload_session
           SET state = 'committed', committed_stored_object_id = ?,
               committed_at = ?, version = 2, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
          [id(33), now, now, scope.workspaceId, id(32)],
        );
        await connection.execute(
          `INSERT INTO model_resource_import (
             id, workspace_id, created_by_principal_id,
             idempotency_key, request_hash, source_kind, source,
             catalog_entry_id, expected_sha256, expected_byte_size,
             upload_session_id, lifecycle_status,
             suggested_key, suggested_display_name, detected_format,
             detected_license, native_interface, compatible_adapters,
             required_user_inputs, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'url', ?, ?, ?, ?, ?, 'ready',
             ?, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY(), 1, ?, ?)`,
          [
            id(18),
            scope.workspaceId,
            scope.principalId,
            "catalog-model-import",
            digestProviderValue({ import: model.document.resourceKey }),
            JSON.stringify(model.document.source),
            id(17),
            sha256,
            byteSize,
            id(32),
            model.document.resourceKey,
            "Tesseract English",
            model.document.format,
            JSON.stringify({
              ...model.document.license,
              confidence: "declared",
            }),
            JSON.stringify(model.document.nativeInterface),
            now,
            now,
          ],
        );
        await connection.execute(
          `INSERT INTO model_resource_import_file (
             workspace_id, model_resource_import_id, path, stored_object_id,
             media_type, byte_size, sha256, source_metadata, created_at
           ) VALUES (?, ?, 'tesseract.bin', ?, ?, ?, ?, ?, ?)`,
          [
            scope.workspaceId,
            id(18),
            id(33),
            model.document.mediaType,
            byteSize,
            sha256,
            JSON.stringify(model.document.source),
            now,
          ],
        );
      } finally {
        connection.release();
      }

      await installations.attachModelResourceImport({
        scope,
        operationId: waiting.id,
        expectedVersion: waiting.version,
        modelResourceImportId: id(18),
        now,
      });
      let nextIdentity = 100;
      await expect(
        installations.continueNextCatalogModelInstallation({
          now,
          nextId: () => id((nextIdentity += 1)),
          leaseTokenHash: "b".repeat(64),
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        }),
      ).resolves.toBe(true);
      const installedEntry = (
        await installations.listCatalogEntries(scope, now)
      )[0];
      expect(installedEntry).toMatchObject({
        installationStatus: "installed",
        updateAvailable: false,
      });

      const definitions = await createCapabilityDefinitionAdminStore(pool).list(
        scope,
        now,
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        key: "image.text.extract",
        bindingCount: 1,
        activeBindingCount: 1,
      });
      for (const table of ["workflow_definition", "skill_revision"] as const) {
        const [rows] = await pool.execute<CountRow[]>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`,
          [scope.workspaceId],
        );
        expect(Number(rows[0]?.count ?? -1)).toBe(0);
      }

      await installations.registerCatalogEntry({
        workspaceId: scope.workspaceId,
        entryId: id(15),
        document: {
          ...recommendation,
          package: {
            ...recommendation.package,
            version: "2.0.1",
            contentDigest: `sha256:${"e".repeat(64)}`,
          },
        },
        now,
      });
      expect(await installations.listCatalogEntries(scope, now)).toMatchObject([
        {
          id: id(15),
          installedDefinitionId: installedEntry?.installedDefinitionId,
          updateAvailable: true,
        },
      ]);
      await expect(
        installations.install({
          scope,
          operationId: id(16),
          catalogEntryId: id(15),
          idempotencyKey: "install-image-text-extract-update",
          now,
          nextId: () => id(901),
          requestedAudit: audit(25),
          completedAudit: audit(26),
        }),
      ).rejects.toThrow("already owned by another installation");
      expect(
        await createCapabilityDefinitionAdminStore(pool).list(scope, now),
      ).toHaveLength(1);

      const modelResources = createModelResourceAdminStore(pool);
      const installedResource = (await modelResources.list(scope, now))[0];
      if (!installedResource) {
        throw new Error("Automatically published model resource is missing.");
      }
      await modelResources.setStatus({
        scope,
        resourceId: installedResource.id,
        expectedVersion: installedResource.version,
        status: "archived",
        now,
        audit: audit(24),
      });
      expect(
        (await createCapabilityDefinitionAdminStore(pool).list(scope, now))[0],
      ).toMatchObject({ bindingCount: 1, activeBindingCount: 1 });
      expect(
        (await createCapabilityBindingAdminStore(pool).list(scope, now))[0],
      ).toMatchObject({
        bindingStatus: "active",
        availabilityReason: "implementation_unavailable",
      });
      const [resources] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count FROM model_resource
         WHERE workspace_id = ? AND id = ?`,
        [scope.workspaceId, installedResource.id],
      );
      expect(Number(resources[0]?.count ?? -1)).toBe(1);
    });

    it("registers the official package without installing its recommendations", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const catalogScope: TrustedWorkspaceScope = Object.freeze({
        ...scope,
        workspaceId: id(1_000),
        organizationId: id(1_001),
        authorityId: id(1_002),
        authenticationRefId: "official-capability-catalog",
      });
      const connection = await pool.getConnection();
      try {
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'official-catalog', 'Official Catalog',
             'active', 1, ?, ?)`,
          [catalogScope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'official-catalog', 'Official Catalog',
             'active', 1, ?, ?)`,
          [catalogScope.workspaceId, catalogScope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace_membership (
             id, organization_id, workspace_id, principal_id,
             role, status, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
          [
            catalogScope.authorityId,
            catalogScope.organizationId,
            catalogScope.workspaceId,
            catalogScope.principalId,
            now,
            now,
          ],
        );
      } finally {
        connection.release();
      }

      await pool.execute(
        `INSERT INTO model_resource_catalog_entry (
           id, workspace_id, asset_key, resource_key, revision,
           canonical_digest, document, lifecycle_status, created_at, updated_at
         ) VALUES
           (?, ?, 'model.isnet.isnet-general', 'isnet.isnet-general', 1,
            ?, JSON_OBJECT(), 'active', ?, ?),
           (?, ?, 'model.isnet.isnet-general-fp16', 'isnet.isnet-general-fp16', 1,
            ?, JSON_OBJECT(), 'active', ?, ?)`,
        [
          id(2_100),
          catalogScope.workspaceId,
          `sha256:${"1".repeat(64)}`,
          now,
          now,
          id(2_101),
          catalogScope.workspaceId,
          `sha256:${"2".repeat(64)}`,
          now,
          now,
        ],
      );

      let registrationIdentity = 2_000;
      await expect(
        registerCatalogPackageV1({
          pool,
          workspaceId: catalogScope.workspaceId,
          packageRoot,
          now,
          nextId: () => id((registrationIdentity += 1)),
        }),
      ).resolves.toMatchObject({
        packageVersion: "2.1.1",
        capabilityRecommendations: 14,
        modelResourceRecommendations: 3,
        replayed: false,
      });
      await expect(
        registerCatalogPackageV1({
          pool,
          workspaceId: catalogScope.workspaceId,
          packageRoot,
          now,
          nextId: () => id((registrationIdentity += 1)),
        }),
      ).resolves.toMatchObject({ replayed: true });

      const installations = createCapabilityInstallationStore(pool);
      const recommendations = await installations.listCatalogEntries(
        catalogScope,
        now,
      );
      expect(recommendations).toHaveLength(14);
      expect(
        await createModelResourceAdminStore(pool).listCatalogEntries(
          catalogScope,
          now,
        ),
      ).toHaveLength(3);
      const [retiredResources] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM model_resource_catalog_entry
         WHERE workspace_id = ? AND lifecycle_status = 'retired'`,
        [catalogScope.workspaceId],
      );
      expect(Number(retiredResources[0]?.count ?? -1)).toBe(2);
      for (const table of [
        "capability_definition",
        "runtime_adapter_definition",
        "model_resource",
        "workflow_revision",
        "skill_revision",
      ] as const) {
        const [rows] = await pool.execute<CountRow[]>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`,
          [catalogScope.workspaceId],
        );
        expect(Number(rows[0]?.count ?? -1)).toBe(0);
      }

      const selected = recommendations.find(
        (recommendation) =>
          recommendation.capabilityKey === "image.background.compose",
      );
      if (!selected) {
        throw new Error("Background compose recommendation is missing.");
      }
      let installationIdentity = 3_000;
      await expect(
        installations.install({
          scope: catalogScope,
          operationId: id(3_900),
          catalogEntryId: selected.id,
          idempotencyKey: "install-background-compose",
          now,
          nextId: () => id((installationIdentity += 1)),
          requestedAudit: {
            ...audit(3_910),
            authorityId: catalogScope.authorityId,
          },
          completedAudit: {
            ...audit(3_911),
            authorityId: catalogScope.authorityId,
          },
        }),
      ).resolves.toMatchObject({ status: "installed" });
      expect(
        await createCapabilityDefinitionAdminStore(pool).list(
          catalogScope,
          now,
        ),
      ).toHaveLength(1);
      for (const table of ["workflow_revision", "skill_revision"] as const) {
        const [rows] = await pool.execute<CountRow[]>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`,
          [catalogScope.workspaceId],
        );
        expect(Number(rows[0]?.count ?? -1)).toBe(0);
      }
    });
  },
);
