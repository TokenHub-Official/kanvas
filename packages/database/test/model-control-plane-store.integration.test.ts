import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { TrustedWorkspaceScope } from "@kanvas/application";

import { createModelControlPlaneStore } from "../src/runtime/model-control-plane-store.js";
import {
  createProviderSettingsStore,
  providerSettingValidationDigest,
} from "../src/runtime/provider-settings-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";
import { bootstrapImageProviderSharedPolicy } from "../src/cli/bootstrap-image-provider-shared-policy.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-08-27T12:00:00.000Z");
const modelEvidence = Object.freeze([
  Object.freeze({
    kind: "provider_api" as const,
    reference: "tokenhub.models.list",
    observedAt: now.toISOString(),
    sourceDigest: digest("a"),
    confidence: "high" as const,
    claim: "identity" as const,
  }),
]);
const supportedModelEvidence = Object.freeze(
  modelEvidence.map((item) =>
    Object.freeze({ ...item, claim: "supported" as const }),
  ),
);
const catalogDocument = Object.freeze({
  schemaVersion: 1 as const,
  providerPreset: "tokenhub",
  discoveryMethod: "tokenhub.models.list",
  sourceDigest: digest("a"),
  models: Object.freeze(
    ["upstream-model-a", "upstream-model-b"].map((providerModelId) => {
      const imageReady = providerModelId === "upstream-model-a";
      return Object.freeze({
        providerModelId,
        displayName: providerModelId,
        inputModalities: Object.freeze(imageReady ? ["text" as const] : []),
        outputModalities: Object.freeze(
          imageReady ? (["text", "image"] as const) : [],
        ),
        operations: Object.freeze(
          imageReady
            ? {
                "text.generate": Object.freeze({
                  apiSurfaces: Object.freeze(["responses.v1"]),
                  parameters: Object.freeze([]),
                  evidence: supportedModelEvidence,
                }),
                "image.generate": Object.freeze({
                  apiSurfaces: Object.freeze(["generation.tasks.v1"]),
                  parameters: Object.freeze([]),
                  evidence: supportedModelEvidence,
                }),
              }
            : {},
        ),
        completeness: imageReady
          ? ("complete" as const)
          : ("identity_only" as const),
        evidence: modelEvidence,
      });
    }),
  ),
});

describe.skipIf(!integrationEnabled)(
  "model control plane store against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(1),
      principalId: id(2),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "model-control-test-session",
      authorityType: "human_membership",
      authorityId: id(3),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: ["credential.manage"] as const,
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
          `INSERT INTO human_principal (
             principal_id, auth_subject_id, created_at
           ) VALUES (?, 'model-control-test-human', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'model-control-test', 'Model Control Test',
                     'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'model-control-test', 'Model Control Test',
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
        await bootstrapImageProviderSharedPolicy(connection, {
          actorId: scope.principalId,
          workspaceId: scope.workspaceId,
        });
        const adapterDocument = {
          schemaVersion: "kanvas.runtime-adapter-definition/v1",
          adapterKey: "test.generation-tasks.image-generate.v1",
          revision: 1,
          displayName: {
            defaultLocale: "en-US",
            values: { "en-US": "Generation Tasks image generation" },
          },
          executionTarget: "provider",
          sourceKinds: ["model_service"],
          supportedModelFormats: [],
          invocationInputSchema: { type: "object" },
          invocationOutputSchema: { type: "object" },
          configurationSchema: { type: "object" },
          modelServiceSelector: {
            operation: "image.generate",
            apiSurface: "generation.tasks.v1",
          },
          artifactInputs: [],
          executable: {
            kind: "built_in",
            packageKey: "kanvas.test-provider-runtime",
            packageVersion: "1",
            entrypoint: "test.generation-tasks.image-generate.v1",
            releaseDigest: digest("d"),
          },
        };
        await connection.execute(
          `INSERT INTO runtime_adapter_definition (
             id, workspace_id, adapter_key, lifecycle_status,
             current_revision_id, version, created_at, updated_at
           ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
          [id(200), scope.workspaceId, adapterDocument.adapterKey, now, now],
        );
        await connection.execute(
          `INSERT INTO runtime_adapter_revision (
             id, workspace_id, runtime_adapter_definition_id, revision,
             lifecycle_status, execution_target, canonical_digest, document,
             created_at, published_at
           ) VALUES (?, ?, ?, 1, 'published', 'provider', ?, ?, ?, ?)`,
          [
            id(201),
            scope.workspaceId,
            id(200),
            digestProviderValue(adapterDocument),
            JSON.stringify(adapterDocument),
            now,
            now,
          ],
        );
        await connection.execute(
          `UPDATE runtime_adapter_definition
           SET current_revision_id = ?, version = 2, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
          [id(201), now, scope.workspaceId, id(200)],
        );
      } finally {
        connection.release();
      }
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("keeps one canonical slug while mapping two Provider models to it", async () => {
      const providerSettings = createProviderSettingsStore(pool!);
      const audit = (auditEventId: string) => ({
        auditEventId,
        actorPrincipalId: scope.principalId,
        actorType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefHash: digest("b"),
        authorityType: "human_membership" as const,
        authorityId: scope.authorityId,
        authorityVersion: 1,
        requestId: "model-control-test",
      });
      const createProvider = async (
        offset: number,
        name: string,
        modelKeys: readonly string[] = ["upstream-model-a"],
        idempotencyKey = `provider-${name}`,
      ) => {
        const baseUrlDigest = digestProviderValue({ baseUrl: name });
        const secretMaterialFingerprint = digestProviderValue({
          material: name,
        });
        return providerSettings.create({
          scope,
          settingId: id(offset),
          endpointId: id(offset + 1),
          credentialId: id(offset + 2),
          secretVersionId: id(offset + 3),
          displayName: name,
          preset: "tokenhub",
          adapterKind: "openai_compatible",
          baseUrl: "https://us-api.tokenhub.com",
          canonicalOrigin: "https://us-api.tokenhub.com",
          regionCode: "us",
          baseUrlDigest,
          modelKeys,
          modelCatalog: {
            snapshotId: id(offset + 4),
            document: catalogDocument,
            discoveredAt: now,
          },
          idempotencyKey,
          requestDigest: digestProviderValue({ provider: name }),
          providerKind: "tokenhub",
          authorityDigest: digest("c"),
          billingIdentityDigest: digest("d"),
          egressIdentityDigest: digest("e"),
          credentialIdentityDigest: digestProviderValue({ credential: name }),
          secretAadDigest: digestProviderValue({ secret: name }),
          secretMaterialFingerprint,
          secretSource: {
            kind: "plaintext_database",
            plaintext: {
              materialPlaintextBase64: Buffer.from(name).toString("base64"),
            },
          },
          validationDigest: providerSettingValidationDigest({
            providerSettingId: id(offset),
            providerEndpointId: id(offset + 1),
            preset: "tokenhub",
            baseUrlDigest,
            modelCatalogDigest: digestProviderValue(catalogDocument),
            modelCatalogSourceDigest: catalogDocument.sourceDigest,
            selectedModelKeys: modelKeys,
            secretMaterialFingerprint,
            validatedAt: now,
          }),
          validatedAt: now,
          createdAt: now,
          audit: audit(id(offset + 5)),
          secretAuditEventId: id(offset + 6),
        });
      };
      await createProvider(10, "Provider A");
      await createProvider(30, "Provider B");
      const emptyProvider = await createProvider(70, "Provider C", []);
      expect(emptyProvider.provider.modelKeys).toEqual([]);
      await expect(
        createProvider(90, "Provider C", [], "provider-c-retry"),
      ).resolves.toMatchObject({
        result: "replayed",
        provider: { id: id(70) },
      });
      await expect(
        providerSettings.activate({
          scope,
          settingId: id(70),
          expectedVersion: 1,
          hardLimitAmount: "20",
          idempotencyKey: "provider-empty-activate",
          requestDigest: digestProviderValue({ activate: "Provider C" }),
          now,
          audit: audit(id(77)),
          relatedAuditEventIds: [id(78)],
          resources: {
            budgetAccountId: id(79),
            models: [],
            workspacePolicyRevisionId: id(80),
          },
        }),
      ).resolves.toMatchObject({
        result: "activated",
        provider: { lifecycle: "active", modelKeys: [] },
      });

      const models = createModelControlPlaneStore(pool!);
      await expect(
        models.createCanonicalModel({
          scope,
          id: id(110),
          slug: "minimax/MiniMax-M3",
          sourceKind: "models_dev",
          sourceReference: "minimax/MiniMax-M3",
          now,
          audit: audit(id(111)),
        }),
      ).resolves.toMatchObject({
        model: { slug: "minimax/MiniMax-M3" },
      });
      const created = await models.createCanonicalModel({
        scope,
        id: id(50),
        slug: "openai/gpt-test",
        sourceKind: "models_dev",
        sourceReference: "openai/gpt-test",
        now,
        audit: audit(id(51)),
      });
      expect(created).toMatchObject({
        replayed: false,
        model: { id: id(50), slug: "openai/gpt-test", lifecycle: "draft" },
      });
      await expect(
        models.createCanonicalModel({
          scope,
          id: id(52),
          slug: "openai/gpt-test",
          sourceKind: "models_dev",
          sourceReference: "openai/gpt-test",
          now,
          audit: audit(id(53)),
        }),
      ).resolves.toMatchObject({ replayed: true, model: { id: id(50) } });
      await expect(
        models.createCanonicalModel({
          scope,
          id: id(54),
          slug: "openai/gpt-test",
          sourceKind: "manual",
          now,
          audit: audit(id(55)),
        }),
      ).resolves.toMatchObject({ replayed: true, model: { id: id(50) } });

      const profileDocument = {
        schemaVersion: 1 as const,
        model: {
          slug: "openai/gpt-test",
          displayName: "GPT Test",
          family: "gpt-test",
          description: "Canonical test model",
          inputModalities: ["text" as const],
          outputModalities: ["text" as const, "image" as const],
          contextWindow: 1_000_000,
          maximumOutputTokens: 128_000,
        },
        operations: {
          "text.generate": {
            parameters: [],
            evidence: supportedModelEvidence,
          },
          "image.generate": {
            parameters: [],
            evidence: supportedModelEvidence,
          },
        },
        sources: [
          {
            kind: "models_dev" as const,
            reference: "openai/gpt-test",
            observedAt: now.toISOString(),
            sourceDigest: digest("f"),
          },
        ],
      };
      await expect(
        models.publishCanonicalModel({
          scope,
          canonicalModelId: id(50),
          expectedVersion: 1,
          profileRevisionId: id(56),
          profileDocument,
          now,
          audit: audit(id(57)),
        }),
      ).resolves.toMatchObject({
        replayed: false,
        profileRevisionId: id(56),
        model: { lifecycle: "active", version: 2 },
      });
      await expect(
        models.publishCanonicalModel({
          scope,
          canonicalModelId: id(50),
          expectedVersion: 1,
          profileRevisionId: id(58),
          profileDocument,
          now,
          audit: audit(id(59)),
        }),
      ).resolves.toMatchObject({
        replayed: true,
        profileRevisionId: id(56),
        model: { lifecycle: "active", version: 2 },
      });

      await pool!.execute(
        `INSERT INTO model_deployment (
           id, workspace_id, provider_endpoint_id,
           provider_model_record_id, model_profile_revision_id,
           deployment_key, provider_model_id, generation,
           supersedes_model_deployment_id, deployment_digest,
           lifecycle_status, version, created_by_principal_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, NULL, ?, 'legacy.provider-c.image', ?, 1,
                   NULL, ?, 'active', 1, ?, ?, ?)`,
        [
          id(210),
          scope.workspaceId,
          id(71),
          id(56),
          "upstream-model-a",
          digest("1"),
          scope.principalId,
          now,
          now,
        ],
      );

      const importedA = await models.importProviderModels({
        scope,
        providerSettingId: id(10),
        catalogSnapshotId: id(14),
        models: [{ id: id(60), upstreamModelId: "upstream-model-a" }],
        now,
        audit: audit(id(61)),
      });
      const importedB = await models.importProviderModels({
        scope,
        providerSettingId: id(30),
        catalogSnapshotId: id(34),
        models: [{ id: id(62), upstreamModelId: "upstream-model-a" }],
        now,
        audit: audit(id(63)),
      });
      expect(importedA.models[0]).toMatchObject({ lifecycle: "discovered" });
      expect(importedA.models[0]?.canonicalModelId).toBeUndefined();
      expect(importedB.models[0]).toMatchObject({ lifecycle: "discovered" });
      await expect(
        models.listProviderCatalogModels(scope, id(10), now),
      ).resolves.toMatchObject([
        {
          upstreamModelId: "upstream-model-a",
          imported: { id: id(60), lifecycle: "discovered" },
        },
        { upstreamModelId: "upstream-model-b" },
      ]);
      await expect(
        models.importProviderModels({
          scope,
          providerSettingId: id(10),
          catalogSnapshotId: id(14),
          models: [{ id: id(68), upstreamModelId: "upstream-model-a" }],
          now: new Date("2026-08-27T00:01:00.000Z"),
          audit: audit(id(67)),
        }),
      ).resolves.toMatchObject({
        created: 0,
        refreshed: 1,
        models: [{ id: id(60), version: 1 }],
      });

      await expect(
        models.mapProviderModel({
          scope,
          providerSettingId: id(10),
          providerModelId: id(60),
          expectedVersion: 1,
          canonicalModelId: id(50),
          mappingSource: "models_dev",
          mappingConfidence: "exact",
          now,
          audit: audit(id(64)),
        }),
      ).resolves.toMatchObject({
        replayed: false,
        model: { lifecycle: "mapped", canonicalModelId: id(50), version: 2 },
      });
      await expect(
        models.mapProviderModel({
          scope,
          providerSettingId: id(10),
          providerModelId: id(60),
          expectedVersion: 1,
          canonicalModelId: id(50),
          mappingSource: "models_dev",
          mappingConfidence: "exact",
          now,
          audit: audit(id(66)),
        }),
      ).resolves.toMatchObject({
        replayed: true,
        model: { lifecycle: "mapped", version: 2 },
      });
      await expect(
        models.mapProviderModel({
          scope,
          providerSettingId: id(30),
          providerModelId: id(62),
          expectedVersion: 1,
          canonicalModelId: id(50),
          mappingSource: "manual",
          mappingConfidence: "manual",
          now,
          audit: audit(id(65)),
        }),
      ).resolves.toMatchObject({
        model: { lifecycle: "mapped", canonicalModelId: id(50) },
      });

      await models.importProviderModels({
        scope,
        providerSettingId: id(70),
        catalogSnapshotId: id(74),
        models: [{ id: id(81), upstreamModelId: "upstream-model-a" }],
        now,
        audit: audit(id(84)),
      });
      await models.mapProviderModel({
        scope,
        providerSettingId: id(70),
        providerModelId: id(81),
        expectedVersion: 1,
        canonicalModelId: id(50),
        mappingSource: "manual",
        mappingConfidence: "manual",
        now,
        audit: audit(id(85)),
      });
      await expect(
        models.publishProviderModel({
          scope,
          providerSettingId: id(70),
          providerModelId: id(81),
          expectedVersion: 2,
          modelDeploymentId: id(82),
          pricingRevisionId: id(83),
          agentModelBindingId: id(90),
          agentTextTransport: {
            apiSurface: "responses.v1",
            protocolKind: "openai_responses",
          },
          routePolicyRevisionIds: Array.from({ length: 32 }, (_, index) =>
            id(100 + index),
          ),
          pricing: {
            providerModelId: "upstream-model-a",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
          now: new Date("2026-08-27T12:01:00.000Z"),
          audit: audit(id(86)),
        }),
      ).resolves.toMatchObject({
        replayed: false,
        modelDeploymentId: id(82),
        pricingRevisionId: id(83),
        model: {
          lifecycle: "active",
          maximumCharge: {
            currencyCode: "USD",
            amount: "0.250000000000",
          },
          version: 3,
        },
      });
      const [providerCDeployments] = await pool!.query<
        (RowDataPacket & {
          readonly generation: number;
          readonly lifecycle: string;
        })[]
      >(
        `SELECT generation, lifecycle_status AS lifecycle
           FROM model_deployment
           WHERE workspace_id = ?
             AND provider_endpoint_id = ?
             AND provider_model_id = ?
           ORDER BY generation`,
        [scope.workspaceId, id(71), "upstream-model-a"],
      );
      expect(providerCDeployments).toMatchObject([
        { generation: 1, lifecycle: "superseded" },
        { generation: 2, lifecycle: "active" },
      ]);
      await expect(
        models.publishProviderModel({
          scope,
          providerSettingId: id(70),
          providerModelId: id(81),
          expectedVersion: 2,
          modelDeploymentId: id(87),
          pricingRevisionId: id(88),
          agentModelBindingId: id(91),
          agentTextTransport: {
            apiSurface: "responses.v1",
            protocolKind: "openai_responses",
          },
          routePolicyRevisionIds: Array.from({ length: 32 }, (_, index) =>
            id(140 + index),
          ),
          pricing: {
            providerModelId: "upstream-model-a",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
          now: new Date("2026-08-27T12:02:00.000Z"),
          audit: audit(id(89)),
        }),
      ).resolves.toMatchObject({
        replayed: true,
        modelDeploymentId: id(82),
        pricingRevisionId: id(83),
        model: { version: 3 },
      });

      await models.importProviderModels({
        scope,
        providerSettingId: id(70),
        catalogSnapshotId: id(74),
        models: [{ id: id(92), upstreamModelId: "upstream-model-b" }],
        now,
        audit: audit(id(93)),
      });
      await models.mapProviderModel({
        scope,
        providerSettingId: id(70),
        providerModelId: id(92),
        expectedVersion: 1,
        canonicalModelId: id(50),
        mappingSource: "manual",
        mappingConfidence: "manual",
        now,
        audit: audit(id(94)),
      });
      await expect(
        models.publishConfiguredModel({
          canonical: {
            scope,
            canonicalModelId: id(50),
            expectedVersion: 2,
            profileRevisionId: id(220),
            profileDocument: {
              ...profileDocument,
              model: {
                ...profileDocument.model,
                displayName: "Must Roll Back",
              },
            },
            now: new Date("2026-08-27T12:03:00.000Z"),
            audit: audit(id(221)),
          },
          provider: {
            scope,
            providerSettingId: id(70),
            providerModelId: id(92),
            expectedVersion: 2,
            modelDeploymentId: id(222),
            pricingRevisionId: id(223),
            agentModelBindingId: id(224),
            routePolicyRevisionIds: [],
            pricing: {
              providerModelId: "upstream-model-b",
              billingMode: "provider_reported",
              maximumChargeAmount: "1.000000000000",
            },
            now: new Date("2026-08-27T12:03:00.000Z"),
            audit: audit(id(225)),
          },
        }),
      ).rejects.toThrow(
        "Provider-reported pricing is unavailable for synchronous text models.",
      );
      const [rolledBackProfiles] = await pool!.query<
        (RowDataPacket & {
          readonly profiles: number;
          readonly version: number;
        })[]
      >(
        `SELECT model.version,
                (SELECT COUNT(*) FROM model_profile_revision AS profile
                 WHERE profile.workspace_id = model.workspace_id
                   AND profile.canonical_model_id = model.id) AS profiles
         FROM canonical_model AS model
         WHERE model.workspace_id = ? AND model.id = ?`,
        [scope.workspaceId, id(50)],
      );
      expect(rolledBackProfiles[0]).toMatchObject({ profiles: 1, version: 2 });
      await expect(
        models.publishProviderModel({
          scope,
          providerSettingId: id(70),
          providerModelId: id(92),
          expectedVersion: 2,
          modelDeploymentId: id(95),
          pricingRevisionId: id(96),
          agentModelBindingId: id(97),
          routePolicyRevisionIds: [],
          pricing: {
            providerModelId: "upstream-model-b",
            billingMode: "provider_reported",
            maximumChargeAmount: "1.000000000000",
          },
          now: new Date("2026-08-27T12:03:00.000Z"),
          audit: audit(id(98)),
        }),
      ).rejects.toThrow(
        "Provider-reported pricing is unavailable for synchronous text models.",
      );

      const [counts] = await pool!.query<
        (RowDataPacket & {
          readonly canonicalModels: number;
          readonly links: number;
          readonly agentBindings: number;
          readonly agentApiSurface: string;
          readonly agentProtocolKind: string;
          readonly providerRoutes: number;
          readonly defaultAgentModelId: string;
          readonly fastAgentModelId: string;
        })[]
      >(
        `SELECT
           (SELECT COUNT(*) FROM canonical_model WHERE workspace_id = ?) AS canonicalModels,
           (SELECT COUNT(*) FROM provider_model
             WHERE workspace_id = ? AND canonical_model_id = ?) AS links,
           (SELECT COUNT(*) FROM agent_model_binding
             WHERE workspace_id = ? AND lifecycle_status = 'enabled')
             AS agentBindings,
           (SELECT api_surface FROM agent_model_binding
             WHERE workspace_id = ? AND lifecycle_status = 'enabled'
             LIMIT 1) AS agentApiSurface,
           (SELECT protocol_kind FROM agent_model_binding
             WHERE workspace_id = ? AND lifecycle_status = 'enabled'
             LIMIT 1) AS agentProtocolKind,
           (SELECT COUNT(*) FROM route_policy_revision
             WHERE workspace_id = ? AND lifecycle_status = 'published'
               AND id = ?) AS providerRoutes,
           (SELECT default_canonical_model_id
              FROM workspace_agent_model_settings
             WHERE workspace_id = ?) AS defaultAgentModelId,
           (SELECT fast_canonical_model_id
              FROM workspace_agent_model_settings
             WHERE workspace_id = ?) AS fastAgentModelId`,
        [
          scope.workspaceId,
          scope.workspaceId,
          id(50),
          scope.workspaceId,
          scope.workspaceId,
          scope.workspaceId,
          scope.workspaceId,
          id(100),
          scope.workspaceId,
          scope.workspaceId,
        ],
      );
      expect(counts[0]).toMatchObject({
        canonicalModels: 2,
        links: 4,
        agentBindings: 1,
        agentApiSurface: "responses.v1",
        agentProtocolKind: "openai_responses",
        providerRoutes: 1,
        defaultAgentModelId: id(50),
        fastAgentModelId: id(50),
      });
      await expect(models.listModels(scope, now)).resolves.toMatchObject([
        {
          id: id(50),
          slug: "openai/gpt-test",
          lifecycle: "active",
          profile: { schemaVersion: 1 },
          providers: [
            { providerSettingId: id(10), lifecycle: "mapped" },
            { providerSettingId: id(30), lifecycle: "mapped" },
            {
              providerSettingId: id(70),
              lifecycle: "active",
              modelDeploymentId: id(82),
              pricingRevisionId: id(83),
              agentTextTransport: {
                apiSurface: "responses.v1",
                protocolKind: "openai_responses",
              },
            },
            {
              providerSettingId: id(70),
              upstreamModelId: "upstream-model-b",
              lifecycle: "mapped",
            },
          ],
        },
      ]);
      await expect(
        models.publishConfiguredModel({
          canonical: {
            scope,
            canonicalModelId: id(50),
            expectedVersion: 2,
            profileRevisionId: id(226),
            profileDocument: {
              ...profileDocument,
              model: { ...profileDocument.model, displayName: "Atomic Model" },
            },
            now: new Date("2026-08-27T12:04:00.000Z"),
            audit: audit(id(227)),
          },
          provider: {
            scope,
            providerSettingId: id(70),
            providerModelId: id(92),
            expectedVersion: 2,
            modelDeploymentId: id(228),
            pricingRevisionId: id(229),
            agentModelBindingId: id(230),
            agentTextTransport: {
              apiSurface: "chat.completions.v1",
              protocolKind: "openai_chat",
            },
            routePolicyRevisionIds: [],
            pricing: {
              providerModelId: "upstream-model-b",
              billingMode: "metered",
              rates: [
                {
                  metricKey: "input_tokens",
                  unitCode: "token",
                  quantity: "1000000",
                  amount: "1",
                },
                {
                  metricKey: "output_tokens",
                  unitCode: "token",
                  quantity: "1000000",
                  amount: "3",
                },
              ],
              maximumChargeAmount: "1",
            },
            now: new Date("2026-08-27T12:04:00.000Z"),
            audit: audit(id(231)),
          },
        }),
      ).resolves.toMatchObject({
        replayed: false,
        model: { lifecycle: "active", version: 3 },
      });
    });
  },
);
