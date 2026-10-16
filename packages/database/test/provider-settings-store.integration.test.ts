import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ProviderModelCatalogDocument } from "@kanvas/contracts/provider-model";

import { createCapabilityBindingAdminStore } from "../src/runtime/capability-binding-admin-store.js";
import { createProviderSettingsStore } from "../src/runtime/provider-settings-store.js";
import { createWorkspaceUsageSummaryStore } from "../src/runtime/workspace-usage-summary-store.js";
import { createProviderRouteStore } from "../src/runtime/provider-route-store.js";
import { createProviderBudgetSettlementStore } from "../src/runtime/provider-budget-settlement-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { ensureDefaultProviderPolicies } from "../src/runtime/default-provider-policy.js";
import { installCatalogPackageV1 } from "../src/cli/catalog-package-installer.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-08-04T12:00:00.000Z");
const qualityParameter = Object.freeze({
  key: "quality",
  label: "Quality",
  valueType: "enum" as const,
  values: Object.freeze(["low", "high"]),
  required: false,
  evidence: Object.freeze([
    Object.freeze({
      kind: "adapter_manifest" as const,
      reference: "generation-tasks.images.v1",
      observedAt: now.toISOString(),
      sourceDigest: digest("e"),
      confidence: "medium" as const,
      claim: "supported" as const,
    }),
  ]),
});
const resolutionParameter = Object.freeze({
  key: "resolution",
  label: "Resolution",
  valueType: "enum" as const,
  values: Object.freeze(["1k", "2k"]),
  required: false,
  evidence: qualityParameter.evidence,
});
const outputFormatParameter = Object.freeze({
  key: "outputFormat",
  label: "Output format",
  valueType: "enum" as const,
  values: Object.freeze(["png", "webp"]),
  required: false,
  evidence: qualityParameter.evidence,
});
const imageParameters = Object.freeze([
  qualityParameter,
  resolutionParameter,
  outputFormatParameter,
]);
const modelCatalog = Object.freeze({
  snapshotId: id(53),
  discoveredAt: now,
  document: Object.freeze({
    schemaVersion: 1 as const,
    providerPreset: "tokenhub",
    discoveryMethod: "tokenhub.models",
    sourceDigest: digest("d"),
    models: Object.freeze([
      ...["gpt-image-2", "gpt-image-2-edit"].map((providerModelId) =>
        Object.freeze({
          providerModelId,
          displayName: providerModelId,
          inputModalities: Object.freeze(["text" as const, "image" as const]),
          outputModalities: Object.freeze(["image" as const]),
          operations: Object.freeze({
            "image.generate": Object.freeze({
              apiSurfaces: Object.freeze(["generation.tasks.v1"]),
              parameters: imageParameters,
              evidence: Object.freeze([
                Object.freeze({
                  kind: "adapter_manifest" as const,
                  reference: "generation-tasks.images.v1",
                  observedAt: now.toISOString(),
                  sourceDigest: digest("e"),
                  confidence: "medium" as const,
                  claim: "supported" as const,
                }),
              ]),
            }),
            "image.edit": Object.freeze({
              apiSurfaces: Object.freeze(["generation.tasks.v1"]),
              parameters: imageParameters,
              evidence: Object.freeze([
                Object.freeze({
                  kind: "adapter_manifest" as const,
                  reference: "generation-tasks.images.v1",
                  observedAt: now.toISOString(),
                  sourceDigest: digest("e"),
                  confidence: "medium" as const,
                  claim: "supported" as const,
                }),
              ]),
            }),
          }),
          completeness: "partial" as const,
          evidence: Object.freeze([
            Object.freeze({
              kind: "provider_api" as const,
              reference: "tokenhub.models.list",
              observedAt: now.toISOString(),
              sourceDigest: digest("d"),
              confidence: "medium" as const,
              claim: "identity" as const,
            }),
          ]),
        }),
      ),
      Object.freeze({
        providerModelId: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        inputModalities: Object.freeze([]),
        outputModalities: Object.freeze([]),
        operations: Object.freeze({}),
        completeness: "identity_only" as const,
        evidence: Object.freeze([
          Object.freeze({
            kind: "provider_api" as const,
            reference: "tokenhub.models.list",
            observedAt: now.toISOString(),
            sourceDigest: digest("d"),
            confidence: "high" as const,
            claim: "identity" as const,
          }),
        ]),
      }),
    ]),
  }),
});

interface SecretRow extends RowDataPacket {
  readonly sourceKind: string;
  readonly plaintextBase64: string | null;
  readonly ciphertext: string | null;
  readonly fingerprint: string;
  readonly lifecycleStatus: string;
  readonly verifiedAt: Date | null;
}

interface StagedProviderFactRow extends RowDataPacket {
  readonly activeSecretVersionId: string | null;
  readonly credentialLifecycle: string;
  readonly endpointLifecycle: string;
  readonly validationDigest: string | null;
  readonly validationStatus: string;
  readonly validatedAt: Date | null;
}

interface BindingReconciliationAuditRow extends RowDataPacket {
  readonly details: unknown;
}

interface ReactivationFactRow extends RowDataPacket {
  readonly activeSecretVersionId: string | null;
  readonly budgetLifecycle: string;
  readonly budgetAccountId: string | null;
  readonly credentialLifecycle: string;
  readonly endpointLifecycle: string;
  readonly modelLifecycle: string;
  readonly modelDeploymentId: string | null;
  readonly secretLifecycle: string;
  readonly secretVersionId: string;
}

describe.skipIf(!integrationEnabled)(
  "Provider settings store against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(1),
      principalId: id(2),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "provider-settings-test-session",
      authorityType: "human_membership",
      authorityId: id(3),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: [
        "credential.manage",
        "capability.configure",
      ] as const,
      trusted: true,
    });

    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
        await connection.execute(
          `INSERT INTO principal (
             id, principal_type, status, version,
             created_at, updated_at
           ) VALUES (?, 'human', 'active', 1, ?, ?)`,
          [scope.principalId, now, now],
        );
        await connection.execute(
          `INSERT INTO human_principal (
             principal_id, auth_subject_id, created_at
           ) VALUES (?, 'provider-settings-test-human', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, 'provider-settings-test',
             'Provider Settings Test', 'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'provider-settings-test',
             'Provider Settings Test', 'active', 1, ?, ?)`,
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
        await ensureDefaultProviderPolicies(connection, {
          now,
          actorId: scope.principalId,
          workspaceId: scope.workspaceId,
        });
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

    it("connects a discovered provider catalog to immutable image.generate invocation facts", async () => {
      const store = createProviderSettingsStore(pool!);
      const options = {
        scope,
        settingId: id(4),
        endpointId: id(5),
        credentialId: id(6),
        secretVersionId: id(7),
        displayName: "TokenHub 主渠道",
        preset: "tokenhub" as const,
        adapterKind: "openai_compatible" as const,
        baseUrl: "https://us-api.tokenhub.com",
        canonicalOrigin: "https://us-api.tokenhub.com",
        regionCode: "us" as const,
        baseUrlDigest: digest("1"),
        modelKeys: ["gpt-image-2", "gpt-image-2-edit"],
        modelCatalog,
        providerKind: "tokenhub",
        authorityDigest: digest("2"),
        billingIdentityDigest: digest("3"),
        egressIdentityDigest: digest("4"),
        credentialIdentityDigest: digest("5"),
        secretAadDigest: digest("6"),
        secretMaterialFingerprint: digest("7"),
        secretSource: {
          kind: "plaintext_database" as const,
          plaintext: {
            materialPlaintextBase64: Buffer.from(
              "plaintext-database-test",
            ).toString("base64"),
          },
        },
        validationDigest: digestProviderValue({
          domain: "kanvas.provider-setting-validation.v1",
          providerSettingId: id(4),
          providerEndpointId: id(5),
          preset: "tokenhub",
          baseUrlDigest: digest("1"),
          modelCatalogDigest: digestProviderValue(modelCatalog.document),
          modelCatalogSourceDigest: modelCatalog.document.sourceDigest,
          selectedModelKeys: ["gpt-image-2", "gpt-image-2-edit"],
          secretMaterialFingerprint: digest("7"),
          validatedAt: now.toISOString(),
        }),
        validatedAt: now,
        idempotencyKey: "provider-setting-create-1",
        requestDigest: digest("8"),
        createdAt: now,
        audit: {
          auditEventId: id(8),
          actorPrincipalId: scope.principalId,
          actorType: "human" as const,
          authenticationRefType: "session" as const,
          authenticationRefHash: digest("9"),
          authorityType: "human_membership" as const,
          authorityId: scope.authorityId,
          authorityVersion: 1,
          requestId: "provider-settings-test",
        },
        secretAuditEventId: id(9),
      };
      const created = await store.create(options);
      expect(created.result).toBe("created");
      expect(created.provider).toMatchObject({
        id: id(4),
        preset: "tokenhub",
        lifecycle: "disabled",
        validation: "passed",
        validatedAt: now,
        version: 1,
        secretConfigured: true,
        secretFingerprintSuffix: "777777777777",
        modelKeys: ["gpt-image-2", "gpt-image-2-edit"],
      });

      const replayed = await store.create({
        ...options,
        settingId: id(10),
        endpointId: id(11),
        credentialId: id(12),
        secretVersionId: id(13),
        modelCatalog: {
          ...modelCatalog,
          snapshotId: id(54),
        },
        audit: {
          ...options.audit,
          auditEventId: id(14),
        },
        secretAuditEventId: id(15),
      });
      expect(replayed.result).toBe("replayed");
      expect(replayed.provider.id).toBe(id(4));

      const listed = await store.list(scope, now);
      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain("encrypted-not-plaintext");
      const [secretRows] = await pool!.query<SecretRow[]>(
        `SELECT
           source_kind AS sourceKind,
           material_plaintext_base64 AS plaintextBase64,
           material_ciphertext_base64 AS ciphertext,
           material_fingerprint AS fingerprint,
           lifecycle_status AS lifecycleStatus,
           verified_at AS verifiedAt
         FROM secret_version
         WHERE id = ?`,
        [id(7)],
      );
      expect(secretRows[0]).toMatchObject({
        sourceKind: "plaintext_database",
        plaintextBase64: Buffer.from("plaintext-database-test").toString(
          "base64",
        ),
        ciphertext: null,
      });
      expect(JSON.stringify(secretRows[0])).not.toContain(
        "plaintext-database-test",
      );
      expect(secretRows[0]?.fingerprint).toBe(digest("7"));
      expect(secretRows[0]).toMatchObject({
        lifecycleStatus: "verified",
        verifiedAt: now,
      });
      const [stagedRows] = await pool!.query<StagedProviderFactRow[]>(
        `SELECT
             endpoint.lifecycle_status AS endpointLifecycle,
             endpoint.validation_status AS validationStatus,
             endpoint.validation_digest AS validationDigest,
             endpoint.validated_at AS validatedAt,
             credential.lifecycle_status AS credentialLifecycle,
             credential.active_secret_version_id
               AS activeSecretVersionId
           FROM provider_setting AS setting
           INNER JOIN provider_endpoint AS endpoint
             ON endpoint.id = setting.provider_endpoint_id
           INNER JOIN credential
             ON credential.id = setting.credential_id
           WHERE setting.id = ?`,
        [id(4)],
      );
      expect(stagedRows[0]).toMatchObject({
        endpointLifecycle: "disabled",
        validationStatus: "passed",
        validationDigest: options.validationDigest,
        validatedAt: now,
        credentialLifecycle: "disabled",
        activeSecretVersionId: null,
      });
      const [unpublishedRows] = await pool!.query<
        (RowDataPacket & { readonly count: number })[]
      >(
        `SELECT COUNT(*) AS count
         FROM model_deployment
         WHERE workspace_id = ?
           AND provider_endpoint_id = ?`,
        [scope.workspaceId, id(5)],
      );
      expect(unpublishedRows[0]?.count).toBe(0);
      await expect(
        store.resolveValidationIdentity(
          scope,
          id(4),
          new Date(now.getTime() + 500),
        ),
      ).resolves.toMatchObject({
        preset: "tokenhub",
        baseUrl: "https://us-api.tokenhub.com",
        modelKeys: ["gpt-image-2", "gpt-image-2-edit"],
        secretMaterialFingerprint: digest("7"),
      });

      // Compatibility coverage for records staged by the former
      // pending-validation create flow.
      await pool!.execute(
        `UPDATE provider_endpoint
         SET validation_status = 'pending',
             validation_digest = NULL,
             validated_at = NULL
         WHERE workspace_id = ?
           AND id = ?`,
        [scope.workspaceId, id(5)],
      );
      await pool!.execute(
        `UPDATE secret_version
         SET lifecycle_status = 'created',
             verified_at = NULL
         WHERE workspace_id = ?
           AND id = ?`,
        [scope.workspaceId, id(7)],
      );
      const validated = await store.validate({
        scope,
        settingId: id(4),
        expectedVersion: 1,
        idempotencyKey: "provider-setting-validate-1",
        requestDigest: digest("c"),
        now: new Date(now.getTime() + 1_000),
        audit: {
          ...options.audit,
          auditEventId: id(16),
        },
        relatedAuditEventIds: [id(17)],
      });
      expect(validated).toMatchObject({
        result: "validated",
        provider: {
          lifecycle: "disabled",
          validation: "passed",
          version: 2,
        },
      });

      const activatedAt = new Date(now.getTime() + 2_000);
      const activated = await store.activate({
        scope,
        settingId: id(4),
        expectedVersion: 2,
        hardLimitAmount: "37.50",
        idempotencyKey: "provider-setting-activate-1",
        modelPricingConfigurations: [
          {
            providerModelId: "gpt-image-2",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
          {
            providerModelId: "gpt-image-2-edit",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
        ],
        requestDigest: digest("d"),
        now: activatedAt,
        audit: {
          ...options.audit,
          auditEventId: id(18),
        },
        relatedAuditEventIds: [id(19)],
        resources: {
          budgetAccountId: id(24),
          models: [
            {
              modelProfileRevisionId: id(20),
              modelDeploymentId: id(21),
              pricingRevisionId: id(22),
              routePolicyRevisionIds: [id(23), id(67)],
            },
            {
              modelProfileRevisionId: id(60),
              modelDeploymentId: id(61),
              pricingRevisionId: id(62),
              routePolicyRevisionIds: [id(63), id(68)],
            },
          ],
          workspacePolicyRevisionId: id(25),
        },
      });
      expect(activated).toMatchObject({
        result: "activated",
        provider: {
          lifecycle: "active",
          validation: "passed",
          version: 3,
        },
      });
      const [budgetRows] = await pool!.query<
        (RowDataPacket & { readonly hardLimitAmount: string })[]
      >(
        `SELECT CAST(hard_limit_amount AS CHAR) AS hardLimitAmount
           FROM budget_account
           WHERE workspace_id = ? AND id = ?`,
        [scope.workspaceId, id(24)],
      );
      expect(budgetRows[0]?.hardLimitAmount).toBe("37.500000000000");
      const [deploymentRows] = await pool!.query<
        (RowDataPacket & {
          readonly providerModelId: string;
        })[]
      >(
        `SELECT provider_model_id AS providerModelId
         FROM model_deployment
         WHERE workspace_id = ?
           AND provider_endpoint_id = ?
         ORDER BY provider_model_id`,
        [scope.workspaceId, id(5)],
      );
      expect(deploymentRows.map((row) => row.providerModelId)).toEqual([
        "gpt-image-2",
        "gpt-image-2-edit",
      ]);
      const bindingAdmin = createCapabilityBindingAdminStore(pool!);
      const providerRoutes = await bindingAdmin.listProviderRoutes(
        scope,
        activatedAt,
      );
      expect(
        providerRoutes
          .map(
            ({ providerModelId, modelOperation }) =>
              `${providerModelId}:${modelOperation ?? "legacy"}`,
          )
          .sort(),
      ).toEqual([
        "gpt-image-2-edit:image.edit",
        "gpt-image-2-edit:image.generate",
        "gpt-image-2:image.edit",
        "gpt-image-2:image.generate",
      ]);
      const [automaticBindingRows] = await pool!.query<
        (RowDataPacket & {
          readonly bindingId: string;
          readonly routePolicyRevisionId: string | null;
          readonly priority: number;
        })[]
      >(
        `SELECT
           binding.id AS bindingId,
           binding.route_policy_revision_id AS routePolicyRevisionId,
           binding.priority
         FROM capability_binding AS binding
         INNER JOIN capability_implementation_revision AS implementation
           ON implementation.workspace_id = binding.workspace_id
          AND implementation.id = binding.implementation_revision_id
         WHERE binding.workspace_id = ?
           AND binding.lifecycle_status = 'active'
           AND implementation.implementation_key =
             'first-party.image.generate.generation-tasks-provider'
         ORDER BY binding.priority`,
        [scope.workspaceId],
      );
      expect(
        automaticBindingRows.map(
          ({ routePolicyRevisionId }) => routePolicyRevisionId,
        ),
      ).toEqual([id(23), id(63)]);
      const providerBinding = automaticBindingRows[0];
      if (!providerBinding) {
        throw new Error("Catalog Provider binding was not activated.");
      }
      const [activationAuditRows] = await pool!.query<
        BindingReconciliationAuditRow[]
      >(
        `SELECT details
           FROM audit_event
           WHERE workspace_id = ?
             AND resource_type = 'provider_setting'
             AND resource_id = ?
             AND event_type = 'provider_setting.activated'
           ORDER BY occurred_at DESC
           LIMIT 1`,
        [scope.workspaceId, id(4)],
      );
      const activationAudit =
        typeof activationAuditRows[0]?.details === "string"
          ? (JSON.parse(activationAuditRows[0].details) as Readonly<
              Record<string, unknown>
            >)
          : (activationAuditRows[0]?.details as
              Readonly<Record<string, unknown>> | undefined);
      expect(activationAudit).toMatchObject({
        capabilityBindingsCreated: 2,
        capabilityBindingTemplatesRebound: 2,
        unmatchedCapabilityRoutes: 0,
      });
      expect(activationAudit?.capabilityBindingReconciliationDigest).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      );
      const routeStore = createProviderRouteStore(pool!, {
        deploymentHardBounds: {
          allowedAdapterKinds: ["openai_compatible"],
          allowedPresetKinds: ["tokenhub"],
          allowedRegionCodes: ["us"],
          allowedRoutingModes: ["gateway_managed"],
          allowedExecutionTransparencies: ["partial"],
          maximumCharge: {
            currencyCode: "USD",
            amount: "2",
          },
          maxProviderRequestSeconds: 300,
        },
      });
      const resolvedRoute = await routeStore.resolve({
        workspaceId: scope.workspaceId,
        capabilityBindingId: providerBinding.bindingId,
        requestScopeDigest: digest("e"),
        now: activatedAt,
      });
      expect(resolvedRoute).toMatchObject({
        providerProtocolVersion: 1,
        providerKey: "tokenhub",
        apiSurface: "generation.tasks.v1",
        providerEndpointId: id(5),
        pinnedSecretVersionId: id(7),
        routePolicyRevisionId: id(23),
        modelOperation: "image.generate",
        parameterPolicies: {},
      });

      const rotatedAt = new Date(now.getTime() + 3_000);
      const rotated = await store.rotateSecret({
        scope,
        settingId: id(4),
        expectedVersion: 3,
        idempotencyKey: "provider-setting-rotate-1",
        requestDigest: digest("f"),
        now: rotatedAt,
        audit: {
          ...options.audit,
          auditEventId: id(26),
        },
        relatedAuditEventIds: [id(27), id(28)],
        secretVersionId: id(29),
        secretAadDigest: digest("0"),
        secretMaterialFingerprint: digest("1"),
        secretSource: options.secretSource,
        mode: "graceful",
        drainDeadlineAt: new Date(rotatedAt.getTime() + 15 * 60 * 1_000),
      });
      expect(rotated).toMatchObject({
        result: "rotated",
        provider: {
          lifecycle: "active",
          version: 4,
          secretFingerprintSuffix: "111111111111",
        },
      });
      await expect(
        routeStore.resolve({
          workspaceId: scope.workspaceId,
          capabilityBindingId: providerBinding.bindingId,
          requestScopeDigest: digest("2"),
          now: rotatedAt,
        }),
      ).resolves.toMatchObject({
        pinnedSecretVersionId: id(29),
      });

      const disabled = await store.disable({
        scope,
        settingId: id(4),
        expectedVersion: 4,
        idempotencyKey: "provider-setting-disable-1",
        requestDigest: digest("3"),
        now: new Date(now.getTime() + 4_000),
        audit: {
          ...options.audit,
          auditEventId: id(33),
        },
        relatedAuditEventIds: [],
      });
      expect(disabled).toMatchObject({
        result: "disabled",
        provider: {
          lifecycle: "disabled",
          version: 5,
        },
      });
      await expect(
        routeStore.resolve({
          workspaceId: scope.workspaceId,
          capabilityBindingId: providerBinding.bindingId,
          requestScopeDigest: digest("4"),
          now: new Date(now.getTime() + 4_000),
        }),
      ).rejects.toMatchObject({
        code: "provider_route.unavailable",
      });

      const reactivatedAt = new Date(now.getTime() + 4_500);
      const [reactivationFacts] = await pool!.query<ReactivationFactRow[]>(
        `SELECT
             endpoint.lifecycle_status AS endpointLifecycle,
             credential.lifecycle_status
               AS credentialLifecycle,
             credential.active_secret_version_id
               AS activeSecretVersionId,
             secret.id AS secretVersionId,
             secret.lifecycle_status AS secretLifecycle,
             setting.model_deployment_id AS modelDeploymentId,
             deployment.lifecycle_status AS modelLifecycle,
             setting.budget_account_id AS budgetAccountId,
             budget.lifecycle_status AS budgetLifecycle
           FROM provider_setting AS setting
           INNER JOIN provider_endpoint AS endpoint
             ON endpoint.id = setting.provider_endpoint_id
           INNER JOIN credential
             ON credential.id = setting.credential_id
           INNER JOIN secret_version AS secret
             ON secret.id =
                credential.active_secret_version_id
           INNER JOIN model_deployment AS deployment
             ON deployment.id = setting.model_deployment_id
           INNER JOIN budget_account AS budget
             ON budget.id = setting.budget_account_id
           WHERE setting.id = ?`,
        [id(4)],
      );
      expect(reactivationFacts[0]).toMatchObject({
        endpointLifecycle: "draining",
        credentialLifecycle: "active",
        activeSecretVersionId: id(29),
        secretVersionId: id(29),
        secretLifecycle: "active",
        modelDeploymentId: id(21),
        modelLifecycle: "draining",
        budgetAccountId: id(24),
        budgetLifecycle: "active",
      });
      const reactivated = await store.activate({
        scope,
        settingId: id(4),
        expectedVersion: 5,
        hardLimitAmount: "20",
        idempotencyKey: "provider-setting-reactivate-1",
        requestDigest: digest("8"),
        now: reactivatedAt,
        audit: {
          ...options.audit,
          auditEventId: id(44),
        },
        relatedAuditEventIds: [id(45)],
        resources: {
          budgetAccountId: id(50),
          models: [
            {
              modelProfileRevisionId: id(46),
              modelDeploymentId: id(47),
              pricingRevisionId: id(48),
              routePolicyRevisionIds: [id(49)],
            },
          ],
          workspacePolicyRevisionId: id(51),
        },
      });
      expect(reactivated).toMatchObject({
        result: "activated",
        provider: {
          lifecycle: "active",
          version: 6,
        },
      });
      await expect(
        routeStore.resolve({
          workspaceId: scope.workspaceId,
          capabilityBindingId: providerBinding.bindingId,
          requestScopeDigest: digest("9"),
          now: reactivatedAt,
        }),
      ).resolves.toMatchObject({
        modelDeploymentId: id(21),
        pinnedSecretVersionId: id(29),
        routePolicyRevisionId: id(23),
      });

      const redisabled = await store.disable({
        scope,
        settingId: id(4),
        expectedVersion: 6,
        idempotencyKey: "provider-setting-disable-2",
        requestDigest: digest("a"),
        now: new Date(now.getTime() + 4_750),
        audit: {
          ...options.audit,
          auditEventId: id(52),
        },
        relatedAuditEventIds: [],
      });
      expect(redisabled).toMatchObject({
        result: "disabled",
        provider: {
          lifecycle: "disabled",
          version: 7,
        },
      });

      const concurrentOptions = {
        ...options,
        settingId: id(34),
        endpointId: id(35),
        credentialId: id(36),
        secretVersionId: id(37),
        modelCatalog: {
          ...modelCatalog,
          snapshotId: id(55),
        },
        displayName: "TokenHub 并发验证",
        idempotencyKey: "provider-setting-create-2",
        requestDigest: digest("5"),
        validationDigest: digestProviderValue({
          domain: "kanvas.provider-setting-validation.v1",
          providerSettingId: id(34),
          providerEndpointId: id(35),
          preset: "tokenhub",
          baseUrlDigest: digest("1"),
          modelCatalogDigest: digestProviderValue(modelCatalog.document),
          modelCatalogSourceDigest: modelCatalog.document.sourceDigest,
          selectedModelKeys: ["gpt-image-2", "gpt-image-2-edit"],
          secretMaterialFingerprint: digest("7"),
          validatedAt: now.toISOString(),
        }),
        audit: {
          ...options.audit,
          auditEventId: id(38),
        },
        secretAuditEventId: id(39),
      };
      await store.create(concurrentOptions);
      await pool!.execute(
        `UPDATE provider_endpoint
         SET validation_status = 'pending',
             validation_digest = NULL,
             validated_at = NULL
         WHERE workspace_id = ?
           AND id = ?`,
        [scope.workspaceId, id(35)],
      );
      await pool!.execute(
        `UPDATE secret_version
         SET lifecycle_status = 'created',
             verified_at = NULL
         WHERE workspace_id = ?
           AND id = ?`,
        [scope.workspaceId, id(37)],
      );
      const concurrentValidation = await Promise.allSettled([
        store.validate({
          scope,
          settingId: id(34),
          expectedVersion: 1,
          idempotencyKey: "provider-setting-concurrent-validate-a",
          requestDigest: digest("6"),
          now: new Date(now.getTime() + 5_000),
          audit: {
            ...options.audit,
            auditEventId: id(40),
          },
          relatedAuditEventIds: [id(41)],
        }),
        store.validate({
          scope,
          settingId: id(34),
          expectedVersion: 1,
          idempotencyKey: "provider-setting-concurrent-validate-b",
          requestDigest: digest("7"),
          now: new Date(now.getTime() + 5_001),
          audit: {
            ...options.audit,
            auditEventId: id(42),
          },
          relatedAuditEventIds: [id(43)],
        }),
      ]);
      expect(
        concurrentValidation.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        concurrentValidation.filter(({ status }) => status === "rejected"),
      ).toHaveLength(1);

      const refreshTarget = (
        await store.list(scope, new Date(now.getTime() + 5_100))
      ).find(({ id: settingId }) => settingId === id(34));
      expect(refreshTarget?.version).toBe(2);
      await store.activate({
        scope,
        settingId: id(34),
        expectedVersion: 2,
        hardLimitAmount: "20",
        idempotencyKey: "provider-setting-refresh-target-activate",
        modelPricingConfigurations: [
          {
            providerModelId: "gpt-image-2",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
          {
            providerModelId: "gpt-image-2-edit",
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
          },
        ],
        requestDigest: digest("b"),
        now: new Date(now.getTime() + 5_200),
        audit: {
          ...options.audit,
          auditEventId: id(200),
        },
        relatedAuditEventIds: [id(201)],
        resources: {
          budgetAccountId: id(202),
          models: [
            {
              modelProfileRevisionId: id(203),
              modelDeploymentId: id(204),
              pricingRevisionId: id(205),
              routePolicyRevisionIds: [id(206), id(207)],
            },
            {
              modelProfileRevisionId: id(208),
              modelDeploymentId: id(209),
              pricingRevisionId: id(210),
              routePolicyRevisionIds: [id(211), id(212)],
            },
          ],
          workspacePolicyRevisionId: id(213),
        },
      });
      await expect(
        store.resolveModelCatalogRefreshIdentity(
          scope,
          id(34),
          new Date(now.getTime() + 5_300),
        ),
      ).resolves.toMatchObject({
        preset: "tokenhub",
        baseUrl: "https://us-api.tokenhub.com",
        modelKeys: ["gpt-image-2", "gpt-image-2-edit"],
        secret: {
          id: id(37),
          sourceKind: "plaintext_database",
          lifecycleStatus: "active",
        },
      });

      const unchangedCatalogDocument: ProviderModelCatalogDocument = {
        ...modelCatalog.document,
        sourceDigest: digest("a"),
        discoveryMethod: "tokenhub.models.refresh",
      };
      const refreshed = await store.refreshModelCatalog({
        scope,
        settingId: id(34),
        expectedVersion: 3,
        idempotencyKey: "provider-setting-model-catalog-refresh-1",
        requestDigest: digest("c"),
        snapshotId: id(214),
        document: unchangedCatalogDocument,
        discoveredAt: new Date(now.getTime() + 5_300),
        expectedActiveSecretVersionId: id(37),
        expectedSecretMaterialGeneration: 1,
        now: new Date(now.getTime() + 5_400),
        audit: {
          ...options.audit,
          auditEventId: id(215),
        },
        relatedAuditEventIds: [],
      });
      expect(refreshed).toMatchObject({
        result: "refreshed",
        changesPendingReview: false,
        provider: {
          version: 4,
          modelCatalog: {
            revision: 2,
            activatedRevision: 1,
            discoveryMethod: "tokenhub.models.refresh",
            changesPendingReview: false,
          },
        },
      });
      await expect(
        store.refreshModelCatalog({
          scope,
          settingId: id(34),
          expectedVersion: 3,
          idempotencyKey: "provider-setting-model-catalog-refresh-1",
          requestDigest: digest("c"),
          snapshotId: id(216),
          document: unchangedCatalogDocument,
          discoveredAt: new Date(now.getTime() + 5_300),
          expectedActiveSecretVersionId: id(37),
          expectedSecretMaterialGeneration: 1,
          now: new Date(now.getTime() + 5_500),
          audit: {
            ...options.audit,
            auditEventId: id(217),
          },
          relatedAuditEventIds: [],
        }),
      ).resolves.toMatchObject({
        result: "replayed",
        provider: { version: 4 },
      });

      const changedCatalogDocument = {
        ...unchangedCatalogDocument,
        sourceDigest: digest("b"),
        models: unchangedCatalogDocument.models.map((model) => {
          const operation = model.operations["image.generate"];
          return operation
            ? {
                ...model,
                operations: {
                  ...model.operations,
                  "image.generate": {
                    ...operation,
                    parameters: operation.parameters.map((parameter) =>
                      parameter.key === "quality"
                        ? {
                            ...parameter,
                            values: ["low", "high", "auto"],
                          }
                        : parameter,
                    ),
                  },
                },
              }
            : model;
        }),
      };
      const changed = await store.refreshModelCatalog({
        scope,
        settingId: id(34),
        expectedVersion: 4,
        idempotencyKey: "provider-setting-model-catalog-refresh-2",
        requestDigest: digest("d"),
        snapshotId: id(218),
        document: changedCatalogDocument,
        discoveredAt: new Date(now.getTime() + 5_600),
        expectedActiveSecretVersionId: id(37),
        expectedSecretMaterialGeneration: 1,
        now: new Date(now.getTime() + 5_700),
        audit: {
          ...options.audit,
          auditEventId: id(219),
        },
        relatedAuditEventIds: [],
      });
      expect(changed).toMatchObject({
        result: "refreshed",
        changesPendingReview: true,
        provider: {
          lifecycle: "active",
          version: 5,
          modelCatalog: {
            revision: 3,
            activatedRevision: 1,
            changesPendingReview: true,
          },
        },
      });
      const changedReview = await store.getModelCatalogReview(
        scope,
        id(34),
        new Date(now.getTime() + 5_725),
      );
      expect(changedReview).toMatchObject({
        providerSettingId: id(34),
        version: 5,
        current: { revision: 3 },
        activated: { revision: 1 },
        canAdopt: true,
        blockers: [],
      });
      const changedModel = changedReview.selectedModels.find(
        (model) => model.providerModelId === "gpt-image-2",
      );
      expect(changedModel).toMatchObject({
        change: "changed",
      });
      const changedGenerate = changedModel?.operations.find(
        (operation) => operation.capabilityKey === "image.generate",
      );
      expect(changedGenerate).toMatchObject({
        change: "changed",
      });
      expect(
        changedGenerate?.parameters.find(
          (parameter) => parameter.key === "quality",
        ),
      ).toMatchObject({
        change: "changed",
        changedFields: ["values"],
      });
      const adoptionIdentity = await store.resolveModelCatalogAdoptionIdentity(
        scope,
        id(34),
        new Date(now.getTime() + 5_730),
      );
      const adoptionOptions = {
        scope,
        settingId: id(34),
        expectedVersion: 5,
        expectedCurrentRevision: 3,
        expectedActivatedRevision: 1,
        idempotencyKey: "provider-setting-model-catalog-adoption-1",
        requestDigest: digest("2"),
        rediscoveredSourceDigest: changedCatalogDocument.sourceDigest,
        rediscoveredRuntimeDigest: adoptionIdentity.currentRuntimeDigest,
        expectedActiveSecretVersionId: id(37),
        expectedSecretMaterialGeneration: 1,
        now: new Date(now.getTime() + 5_740),
        audit: {
          ...options.audit,
          auditEventId: id(300),
        },
        relatedAuditEventIds: [],
        resources: {
          models: [
            {
              modelProfileRevisionId: id(301),
              modelDeploymentId: id(302),
              pricingRevisionId: id(303),
              routePolicyRevisionIds: [id(304), id(305)],
            },
            {
              modelProfileRevisionId: id(306),
              modelDeploymentId: id(307),
              pricingRevisionId: id(308),
              routePolicyRevisionIds: [id(309), id(310)],
            },
          ],
        },
      } as const;
      const adopted = await store.adoptModelCatalog(adoptionOptions);
      expect(adopted).toMatchObject({
        result: "adopted",
        adoptedRevision: 3,
        provider: {
          lifecycle: "active",
          version: 6,
          modelCatalog: {
            revision: 3,
            activatedRevision: 3,
            changesPendingReview: false,
          },
        },
      });
      await expect(
        store.adoptModelCatalog(adoptionOptions),
      ).resolves.toMatchObject({
        result: "replayed",
        adoptedRevision: 3,
        provider: { version: 6 },
      });
      await expect(
        store.adoptModelCatalog({
          ...adoptionOptions,
          requestDigest: digest("3"),
        }),
      ).rejects.toThrow(/idempotency/u);
      const [deploymentGenerations] = await pool!.query<
        (RowDataPacket & {
          readonly providerModelId: string;
          readonly generation: number;
          readonly lifecycleStatus: string;
        })[]
      >(
        `SELECT
           provider_model_id AS providerModelId,
           generation,
           lifecycle_status AS lifecycleStatus
         FROM model_deployment
         WHERE workspace_id = ?
           AND provider_endpoint_id = ?
           AND provider_model_id IN (?, ?)
         ORDER BY provider_model_id, generation`,
        [scope.workspaceId, id(35), "gpt-image-2", "gpt-image-2-edit"],
      );
      expect(deploymentGenerations).toEqual([
        {
          providerModelId: "gpt-image-2",
          generation: 1,
          lifecycleStatus: "superseded",
        },
        {
          providerModelId: "gpt-image-2",
          generation: 2,
          lifecycleStatus: "active",
        },
        {
          providerModelId: "gpt-image-2-edit",
          generation: 1,
          lifecycleStatus: "superseded",
        },
        {
          providerModelId: "gpt-image-2-edit",
          generation: 2,
          lifecycleStatus: "active",
        },
      ]);
      const adoptedProviderRoutes = await createCapabilityBindingAdminStore(
        pool!,
      ).listProviderRoutes(scope, adoptionOptions.now);
      expect(
        adoptedProviderRoutes
          .filter(({ providerName }) => providerName === "TokenHub 并发验证")
          .map(
            ({ providerModelId, modelOperation }) =>
              `${providerModelId}:${modelOperation ?? "legacy"}`,
          )
          .sort(),
      ).toEqual([
        "gpt-image-2-edit:image.edit",
        "gpt-image-2-edit:image.generate",
        "gpt-image-2:image.edit",
        "gpt-image-2:image.generate",
      ]);
      const [routeLifecycles] = await pool!.query<
        (RowDataPacket & {
          readonly lifecycleStatus: string;
          readonly count: number;
        })[]
      >(
        `SELECT
           lifecycle_status AS lifecycleStatus,
           COUNT(*) AS count
         FROM route_policy_revision
         WHERE workspace_id = ?
           AND JSON_UNQUOTE(
             JSON_EXTRACT(
               route_document,
               '$.providerEndpointId'
             )
           ) = ?
         GROUP BY lifecycle_status
         ORDER BY lifecycle_status`,
        [scope.workspaceId, id(35)],
      );
      expect(routeLifecycles).toEqual([
        { lifecycleStatus: "deprecated", count: 4 },
        { lifecycleStatus: "published", count: 4 },
      ]);
      await expect(
        store.refreshModelCatalog({
          scope,
          settingId: id(34),
          expectedVersion: 6,
          idempotencyKey: "provider-setting-model-catalog-refresh-stale-secret",
          requestDigest: digest("1"),
          snapshotId: id(220),
          document: changedCatalogDocument,
          discoveredAt: new Date(now.getTime() + 5_750),
          expectedActiveSecretVersionId: id(29),
          expectedSecretMaterialGeneration: 2,
          now: new Date(now.getTime() + 5_800),
          audit: {
            ...options.audit,
            auditEventId: id(221),
          },
          relatedAuditEventIds: [],
        }),
      ).rejects.toThrow(/credential changed/u);
      const missingModelRefresh = await store.refreshModelCatalog({
        scope,
        settingId: id(34),
        expectedVersion: 6,
        idempotencyKey: "provider-setting-model-catalog-refresh-missing",
        requestDigest: digest("e"),
        snapshotId: id(311),
        document: {
          ...changedCatalogDocument,
          models: changedCatalogDocument.models.filter(
            (model) => model.providerModelId !== "gpt-image-2-edit",
          ),
        },
        discoveredAt: new Date(now.getTime() + 5_800),
        expectedActiveSecretVersionId: id(37),
        expectedSecretMaterialGeneration: 1,
        now: new Date(now.getTime() + 5_900),
        audit: {
          ...options.audit,
          auditEventId: id(312),
        },
        relatedAuditEventIds: [],
      });
      expect(missingModelRefresh).toMatchObject({
        result: "refreshed",
        changesPendingReview: true,
        provider: {
          lifecycle: "active",
          version: 7,
          modelCatalog: {
            revision: 4,
            activatedRevision: 3,
            changesPendingReview: true,
          },
        },
      });
      const missingModelReview = await store.getModelCatalogReview(
        scope,
        id(34),
        new Date(now.getTime() + 5_925),
      );
      expect(missingModelReview).toMatchObject({
        current: { revision: 4 },
        activated: { revision: 3 },
        canAdopt: false,
      });
      expect(missingModelReview.blockers).toContainEqual({
        code: "selected_model_removed",
        providerModelId: "gpt-image-2-edit",
      });
      await expect(
        store.resolveModelCatalogAdoptionIdentity(
          scope,
          id(34),
          new Date(now.getTime() + 5_950),
        ),
      ).rejects.toThrow(/not ready for adoption/u);
      // Refresh/adoption publishes new snapshots; it must not rewrite old revisions.
      const [catalogRows] = await pool!.query<
        (RowDataPacket & { readonly revision: number })[]
      >(
        `SELECT revision
         FROM provider_model_catalog_snapshot
         WHERE provider_setting_id = ?
         ORDER BY revision`,
        [id(34)],
      );
      expect(catalogRows.map(({ revision }) => revision)).toEqual([1, 2, 3, 4]);
      const reviewDisabled = await store.disable({
        scope,
        settingId: id(34),
        expectedVersion: 7,
        idempotencyKey: "provider-setting-review-required-disable",
        requestDigest: digest("f"),
        now: new Date(now.getTime() + 6_000),
        audit: {
          ...options.audit,
          auditEventId: id(224),
        },
        relatedAuditEventIds: [],
      });
      await expect(
        store.activate({
          scope,
          settingId: id(34),
          expectedVersion: reviewDisabled.provider.version,
          hardLimitAmount: "20",
          idempotencyKey: "provider-setting-stale-catalog-reactivation",
          requestDigest: digest("0"),
          now: new Date(now.getTime() + 6_100),
          audit: {
            ...options.audit,
            auditEventId: id(225),
          },
          relatedAuditEventIds: [],
          resources: {
            budgetAccountId: id(313),
            models: [],
            workspacePolicyRevisionId: id(314),
          },
        }),
      ).resolves.toMatchObject({
        result: "activated",
        provider: {
          lifecycle: "active",
          version: 9,
          modelCatalog: {
            revision: 4,
            activatedRevision: 3,
            changesPendingReview: true,
          },
        },
      });
      const usageSummary = createWorkspaceUsageSummaryStore(pool!);
      const summaryBeforeDelete = await usageSummary.get(
        scope,
        new Date(now.getTime() - 86_400_000),
        new Date(now.getTime() + 6_200),
      );
      expect(
        summaryBeforeDelete.budgets.some(
          ({ providerSettingId }) => providerSettingId === id(34),
        ),
      ).toBe(true);
      // A display-name edit must leave every execution/credential fact intact.
      const executionFacts = async () => {
        const [rows] = await pool!.query(
          `SELECT endpoint.id, endpoint.base_url, endpoint.base_url_digest,
             endpoint.validation_digest, endpoint.version, credential.identity_epoch,
             credential.identity_digest, credential.active_secret_version_id,
             credential.material_generation, credential.version AS credential_version,
             setting.model_catalog_snapshot_id, setting.model_deployment_id, setting.budget_account_id
           FROM provider_setting AS setting
           JOIN provider_endpoint AS endpoint ON endpoint.id = setting.provider_endpoint_id
           JOIN credential ON credential.id = setting.credential_id
           WHERE setting.id = ?`,
          [id(34)],
        );
        return rows;
      };
      const factsBeforeRename = await executionFacts();
      const renameOptions = {
        scope,
        settingId: id(34),
        expectedVersion: 9,
        displayName: "  Renamed provider  ",
        now: new Date(now.getTime() + 6_250),
        audit: { ...options.audit, auditEventId: id(800) },
      };
      const renamed = await store.rename(renameOptions);
      expect(renamed).toMatchObject({
        displayName: "Renamed provider",
        version: 10,
        lifecycle: "active",
      });
      expect(await executionFacts()).toEqual(factsBeforeRename);
      await expect(
        store.rename({ ...renameOptions, displayName: "Stale edit" }),
      ).rejects.toThrow("changed before");
      await expect(
        store.rename({
          ...renameOptions,
          expectedVersion: 10,
          displayName: "   ",
        }),
      ).rejects.toThrow("display name");
      await expect(
        store.rename({ ...renameOptions, expectedVersion: 10 }),
      ).resolves.toMatchObject({ version: 10 });
      const [renameAudits] = await pool!.query<RowDataPacket[]>(
        `SELECT event_type FROM audit_event WHERE id = ?`,
        [id(800)],
      );
      expect(renameAudits).toHaveLength(1);
      await store.delete({
        scope,
        settingId: id(34),
        expectedVersion: 10,
        idempotencyKey: "provider-setting-delete-current-view",
        requestDigest: digest("2"),
        now: new Date(now.getTime() + 6_300),
        audit: {
          ...options.audit,
          auditEventId: id(315),
        },
        relatedAuditEventIds: [],
      });
      const summaryAfterDelete = await usageSummary.get(
        scope,
        new Date(now.getTime() - 86_400_000),
        new Date(now.getTime() + 6_400),
      );
      expect(
        summaryAfterDelete.budgets.some(
          ({ providerSettingId }) => providerSettingId === id(34),
        ),
      ).toBe(false);
      await expect(
        createProviderBudgetSettlementStore(pool!).scanAgentPending({
          batchSize: 20,
        }),
      ).resolves.toEqual([]);
    });
  },
);
