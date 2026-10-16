import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { TrustedWorkspaceScope } from "@kanvas/application";

import { createResourceSourceStore } from "../src/runtime/resource-source-store.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-08-27T06:00:00.000Z");

describe.skipIf(!integrationEnabled)(
  "Resource Source Store against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "resource-source-test-session",
      authorityType: "human_membership",
      authorityId: id(4),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: [
        "credential.manage",
        "asset.read",
        "asset.write",
      ] as const,
      trusted: true,
    });
    const audit = (value: number) => ({
      auditEventId: id(value),
      actorPrincipalId: scope.principalId,
      actorType: "human" as const,
      authenticationRefType: "session" as const,
      authenticationRefHash: digest("a"),
      authorityType: "human_membership" as const,
      authorityId: scope.authorityId,
      authorityVersion: 1,
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
          `INSERT INTO human_principal (
             principal_id, auth_subject_id, created_at
           ) VALUES (?, 'resource-source-test-human', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'resource-source-test', 'Resource Source Test',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'resource-source-test', 'Resource Source Test',
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

    it("persists publish, adoption, replay, and disable boundaries", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const store = createResourceSourceStore(pool);
      const sourceId = id(10);
      const sourceRevisionId = id(11);
      const presetRevisionId = id(12);
      const licensePolicy = {
        requireCommercialUse: true,
        allowAttribution: true,
        allowShareAlike: false,
        allowStandaloneRedistributionRestriction: true,
        allowUnknownModelRelease: true,
        allowUnknownPropertyRelease: true,
        allowedLicenseIds: ["CC0-1.0"],
      };
      const created = await store.createDraft({
        scope,
        sourceId,
        providerEndpointId: id(13),
        displayName: "Art Text Registry",
        adapterKind: "art-text-registry.v1",
        adapterVersion: "1.0.0",
        authMode: "none",
        endpointOrigin: "https://styles.example.com",
        configuration: { catalogPath: "/catalog.json" },
        licensePolicy,
        idempotencyKey: "create-art-text-source",
        now,
        audit: audit(20),
      });
      expect(created.value).toMatchObject({
        lifecycleStatus: "draft",
        secretConfigured: true,
        version: 1,
      });

      const validated = await store.recordValidation({
        scope,
        sourceId,
        expectedVersion: 1,
        outcome: "passed",
        validationDigest: digest("b"),
        reasonCode: "resource_source.connection_verified",
        now,
        audit: audit(21),
      });
      expect(validated).toMatchObject({
        lifecycleStatus: "ready",
        version: 2,
      });
      await expect(
        store.recordValidation({
          scope,
          sourceId,
          expectedVersion: 1,
          outcome: "passed",
          validationDigest: digest("b"),
          reasonCode: "resource_source.connection_verified",
          now,
          audit: audit(22),
        }),
      ).rejects.toMatchObject({ code: "resource_source.version_conflict" });

      const published = await store.publish({
        scope,
        sourceId,
        sourceRevisionId,
        expectedVersion: 2,
        capabilities: ["art_text.list", "art_text.import"],
        idempotencyKey: "publish-art-text-source",
        now,
        audit: audit(23),
      });
      expect(published.value).toMatchObject({ revisionNumber: 1 });
      await expect(store.listPublished(scope, now)).resolves.toEqual([
        expect.objectContaining({ id: sourceId, revisionId: sourceRevisionId }),
      ]);

      const manifest = {
        schemaVersion: 1 as const,
        id: "outline-title",
        revision: digest("c"),
        labels: { en: "Outline title", "zh-Hans": "描边标题" },
        fontRequirements: {
          requiredScripts: ["Hans"],
          fallbackCategory: "display" as const,
        },
        fill: { kind: "solid" as const, color: "#ffffff" },
        effects: [{ kind: "outline" as const, color: "#151515", width: 6 }],
        letterSpacing: 2,
        lineHeight: 1.1,
        alignment: "center" as const,
        editable: { text: true as const, font: true, colorSlots: [] },
        license: {
          licenseId: "CC0-1.0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          commercialUseAllowed: true,
          modificationAllowed: true,
          attributionRequired: false,
          shareAlikeRequired: false,
          standaloneRedistributionAllowed: true,
          modelReleaseStatus: "not_applicable" as const,
          propertyReleaseStatus: "not_applicable" as const,
          trademarkRisk: "none_declared" as const,
          capturedAt: now.toISOString(),
          termsDigest: digest("d"),
        },
      };
      const adopted = await store.adoptArtTextPreset({
        scope,
        sourceId,
        sourceRevisionId,
        artTextPresetRevisionId: presetRevisionId,
        externalId: "outline-title",
        manifest,
        provenance: { sourcePageUrl: "https://styles.example.com/outline" },
        idempotencyKey: "adopt-outline-title",
        now,
        audit: audit(24),
      });
      expect(adopted.replayed).toBe(false);
      const replay = await store.adoptArtTextPreset({
        scope,
        sourceId,
        sourceRevisionId,
        artTextPresetRevisionId: id(14),
        externalId: "outline-title",
        manifest,
        provenance: { sourcePageUrl: "https://styles.example.com/outline" },
        idempotencyKey: "adopt-outline-title",
        now,
        audit: audit(25),
      });
      expect(replay).toMatchObject({
        replayed: true,
        value: { id: presetRevisionId },
      });

      const disabled = await store.disable({
        scope,
        sourceId,
        expectedVersion: 3,
        now,
        audit: audit(26),
      });
      expect(disabled).toMatchObject({
        lifecycleStatus: "disabled",
        version: 4,
      });
      await expect(store.listPublished(scope, now)).resolves.toEqual([]);
      await expect(store.listArtTextPresets(scope, now)).resolves.toEqual([
        expect.objectContaining({ id: presetRevisionId, manifest }),
      ]);
      await pool.execute(
        `UPDATE provider_endpoint
            SET lifecycle_status = 'disabled'
          WHERE workspace_id = ? AND id = ?`,
        [scope.workspaceId, id(13)],
      );

      const revalidated = await store.recordValidation({
        scope,
        sourceId,
        expectedVersion: 4,
        outcome: "passed",
        validationDigest: digest("e"),
        reasonCode: "resource_source.connection_verified",
        now,
        audit: audit(27),
      });
      expect(revalidated).toMatchObject({
        lifecycleStatus: "ready",
        version: 5,
      });
      await store.publish({
        scope,
        sourceId,
        sourceRevisionId: id(15),
        expectedVersion: 5,
        capabilities: ["art_text.list", "art_text.import"],
        idempotencyKey: "republish-art-text-source",
        now,
        audit: audit(28),
      });
      await expect(store.listPublished(scope, now)).resolves.toEqual([
        expect.objectContaining({ id: sourceId, revisionId: sourceRevisionId }),
      ]);

      const [revisionRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS revisionCount
           FROM resource_source_revision
          WHERE workspace_id = ? AND source_id = ?`,
        [scope.workspaceId, sourceId],
      );
      expect(Number(revisionRows[0]?.revisionCount)).toBe(1);

      await store.createDraft({
        scope,
        sourceId: id(300),
        providerEndpointId: id(301),
        displayName: "Revoked source",
        adapterKind: "art-text-registry.v1",
        adapterVersion: "1.0.0",
        authMode: "none",
        endpointOrigin: "https://revoked.example.com",
        configuration: { catalogPath: "/catalog.json" },
        licensePolicy,
        idempotencyKey: "revoked-source",
        now,
        audit: audit(302),
      });
      await pool.execute(
        "UPDATE provider_endpoint SET lifecycle_status = 'revoked' WHERE id = ?",
        [id(301)],
      );
      await expect(
        store.recordValidation({
          scope,
          sourceId: id(300),
          expectedVersion: 1,
          outcome: "passed",
          validationDigest: digest("f"),
          reasonCode: "resource_source.connection_verified",
          now,
          audit: audit(303),
        }),
      ).rejects.toMatchObject({ code: "resource_source.lifecycle_conflict" });
      const [retainedSource] = await pool.query<RowDataPacket[]>(
        "SELECT source.version, source.lifecycle_status AS sourceState, endpoint.lifecycle_status AS endpointState FROM resource_source AS source JOIN provider_endpoint AS endpoint ON endpoint.id = source.provider_endpoint_id WHERE source.id = ?",
        [id(300)],
      );
      expect(retainedSource[0]).toMatchObject({
        version: 1,
        sourceState: "draft",
        endpointState: "revoked",
      });
    });
  },
);
