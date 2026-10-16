import { createWorkflowExecutionPersistence } from "../src/runtime/workflow-execution-persistence.js";
import type { WorkflowRunRecord } from "@kanvas/application";
import { createCanvasDraftStore } from "../src/runtime/canvas-draft-store.js";
import type { EditorDraftContentV1 } from "@kanvas/contracts/editor";
import {
  createAgentLibraryStore,
  recordAgentLibraryToolInputsInTransaction,
} from "../src/runtime/agent-library-store.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
import { assertResourceAdmission } from "../src/runtime/resource-lifecycle-store.js";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { createAgentFoundationStore } from "../src/runtime/agent-foundation-store.js";
import { createAgentHubStore } from "../src/runtime/agent-hub-store.js";
import { createAgentProfilePublicationStore } from "../src/runtime/agent-profile-publication-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-08-24T20:00:00.000Z");
const organizationId = id(9_100_001);
const workspaceId = id(9_100_002);
const principalId = id(9_100_003);
const membershipId = id(9_100_004);
const operatorPrincipalId = id(9_100_065);
const operatorMembershipId = id(9_100_066);
const profileRevisionId = id(9_100_005);
const agentDefinitionId = id(9_100_034);
const publicationCandidateId = id(9_100_006);
const skillRevisionId = id(9_100_007);
const skillDefinitionId = id(9_100_035);
const workflowRevisionId = id(9_100_008);
const uploadId = id(9_100_009);
const storedObjectId = id(9_100_010);
const storageProfileId = id(9_100_011);
const providerEndpointId = id(9_100_020);
const credentialId = id(9_100_021);
const secretVersionId = id(9_100_022);
const budgetAccountId = id(9_100_023);
const firstModelProfileId = id(9_100_024);
const firstCanonicalModelId = id(9_100_032);
const firstModelDeploymentId = id(9_100_025);
const firstPricingRevisionId = id(9_100_026);
const firstModelBindingId = id(9_100_027);
const secondModelProfileId = id(9_100_028);
const secondModelDeploymentId = id(9_100_029);
const secondPricingRevisionId = id(9_100_030);
const secondModelBindingId = id(9_100_031);
const secondCanonicalModelId = id(9_100_033);
const nonToolModelProfileId = id(9_100_044);
const nonToolCanonicalModelId = id(9_100_045);
const nonToolModelDeploymentId = id(9_100_046);
const nonToolPricingRevisionId = id(9_100_047);
const nonToolModelBindingId = id(9_100_048);
const profileManifest = Object.freeze({
  schemaVersion: 1 as const,
  displayName: "Workspace profile from data",
  modelBindingKey: "workspace-agent-model",
  instructions:
    "Use only the dynamically resolved SkillView and current ToolView for this request.",
  allowedSurfaceKinds: Object.freeze([
    "agent_workspace",
    "workspace_home",
  ] as const),
  allowedToolFamilies: Object.freeze(["query", "workflow"] as const),
  requiredToolFamilies: Object.freeze(["workflow"] as const),
  skillPolicy: Object.freeze({
    maximumCatalogItems: 20,
    maximumActivatedInstructionBytes: 262_144,
    maximumReferenceReadBytes: 262_144,
  }),
  runLimits: Object.freeze({
    maximumModelCalls: 8,
    maximumToolCalls: 4,
    timeoutSeconds: 180,
  }),
});

const authority = Object.freeze({
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: id(9_100_012),
  authorityType: "human_membership",
  authorityId: membershipId,
  authorityVersion: 1,
  authorizationModelVersion,
  effectivePermissions: permissionsForWorkspaceRole("owner"),
  trusted: true,
} as const satisfies TrustedWorkspaceScope);

const operatorAuthority = Object.freeze({
  ...authority,
  principalId: operatorPrincipalId,
  authenticationRefId: id(9_100_067),
  authorityId: operatorMembershipId,
  effectivePermissions: permissionsForWorkspaceRole("operator"),
} as const satisfies TrustedWorkspaceScope);

describe.skipIf(!integrationEnabled)(
  "Agent Foundation Store against a disposable MySQL database",
  () => {
    let pool!: Pool;

    beforeAll(async () => {
      const connection = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.user,
        password: connection.password,
        connectionLimit: 4,
        timezone: "Z",
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      const cleanup = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(cleanup);
      } finally {
        cleanup.release();
      }
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO human_principal
           (principal_id, auth_subject_id, created_at)
         VALUES (?, 'agent-foundation-subject', ?)`,
        [principalId, now],
      );
      await pool.execute(
        `INSERT INTO organization
           (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'agent-foundation', 'Agent Foundation', 'active', 1, ?, ?)`,
        [organizationId, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace
           (id, organization_id, slug, name, status, version,
            created_at, updated_at)
         VALUES (?, ?, 'agent-foundation', 'Agent Foundation',
                 'active', 1, ?, ?)`,
        [workspaceId, organizationId, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace_membership
           (id, organization_id, workspace_id, principal_id, role, status,
            version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
        [membershipId, organizationId, workspaceId, principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO principal
           (id, principal_type, status, version, created_at, updated_at)
         VALUES (?, 'human', 'active', 1, ?, ?)`,
        [operatorPrincipalId, now, now],
      );
      await pool.execute(
        `INSERT INTO human_principal
           (principal_id, auth_subject_id, created_at)
         VALUES (?, 'agent-foundation-operator', ?)`,
        [operatorPrincipalId, now],
      );
      await pool.execute(
        `INSERT INTO workspace_membership
           (id, organization_id, workspace_id, principal_id, role, status,
            version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'operator', 'active', 1, ?, ?)`,
        [
          operatorMembershipId,
          organizationId,
          workspaceId,
          operatorPrincipalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_definition (
           id, workspace_id, agent_key, owner_principal_id, visibility,
           lifecycle_status, creation_request_key, creation_request_hash,
           version, created_by_principal_id, updated_by_principal_id,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, 'workspace-profile-from-data', ?, 'workspace',
                   'active', 'agent-foundation-profile', ?, 1, ?, ?, ?, ?, NULL)`,
        [
          agentDefinitionId,
          workspaceId,
          principalId,
          digest("1"),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_presentation (
           workspace_id, agent_definition_id, display_name, summary,
           cover_asset_id, category, tags, version,
           updated_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'Workspace profile from data',
                   'A runtime test Agent',
                   NULL, NULL, '[]', 1, ?, ?, ?)`,
        [workspaceId, agentDefinitionId, principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO agent_profile_revision (
           id, workspace_id, agent_definition_id, profile_key, revision,
           lifecycle_status,
           schema_version, manifest_document, canonical_digest,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, 'workspace-profile-from-data', 1, 'published', 1,
                   ?, ?, ?, ?, ?, ?)`,
        [
          profileRevisionId,
          workspaceId,
          agentDefinitionId,
          JSON.stringify(profileManifest),
          digestProviderValue(profileManifest),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO agent_profile_activation (
           workspace_id, profile_revision_id, runtime_status, reason_code,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
        [workspaceId, profileRevisionId, principalId, now],
      );
      await pool.execute(
        `INSERT INTO agent_surface_profile_binding (
           workspace_id, surface_kind, profile_revision_id, version,
           updated_by_principal_id, updated_at
         ) VALUES
           (?, 'workspace_home', ?, 1, ?, ?),
           (?, 'agent_workspace', ?, 1, ?, ?)`,
        [
          workspaceId,
          profileRevisionId,
          principalId,
          now,
          workspaceId,
          profileRevisionId,
          principalId,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO provider_endpoint (
           id, workspace_id, endpoint_key, adapter_kind, preset_kind,
           base_url, canonical_origin, base_url_digest, region_code,
           network_policy, data_policy, lifecycle_status, validation_status,
           validation_digest, validated_at, version,
           created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'agent-model-settings', 'openai_compatible',
                   'tokenhub', 'https://models.example.test/v1',
                   'https://models.example.test', ?, 'global', '{}', '{}',
                   'active', 'passed', ?, ?, 1, ?, ?, ?)`,
        [
          providerEndpointId,
          workspaceId,
          digestProviderValue({ baseUrl: "https://models.example.test/v1" }),
          digestProviderValue({ validation: "agent-model-settings" }),
          now,
          principalId,
          now,
          now,
        ],
      );
      const credentialIdentityDigest = digestProviderValue({
        credential: "agent-model-settings",
      });
      await pool.execute(
        `INSERT INTO credential (
           id, workspace_id, provider_endpoint_id, credential_key,
           provider_kind, authority_digest, billing_identity_digest,
           egress_identity_digest, identity_digest, identity_epoch,
           material_generation, active_secret_version_id, lifecycle_status,
           version, created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'agent-model-settings', 'tokenhub', ?, ?, ?, ?,
                   1, 1, NULL, 'active', 1, ?, ?, ?)`,
        [
          credentialId,
          workspaceId,
          providerEndpointId,
          digestProviderValue({ authority: "agent-model-settings" }),
          digestProviderValue({ billing: "agent-model-settings" }),
          digestProviderValue({ egress: "agent-model-settings" }),
          credentialIdentityDigest,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO secret_version (
           id, workspace_id, credential_id, version, material_generation,
           source_kind, lifecycle_status, aad_digest, deployment_reference,
           material_fingerprint, format_version, drain_deadline_at,
           verified_at, activated_at, retired_at, revoked_at, destroyed_at,
           created_by_principal_id, created_at
         ) VALUES (?, ?, ?, 1, 1, 'deployment_reference', 'active', ?,
                   'deployment://agent-model-settings/key', ?, 1, NULL, ?, ?,
                   NULL, NULL, NULL, ?, ?)`,
        [
          secretVersionId,
          workspaceId,
          credentialId,
          digestProviderValue({ aad: "agent-model-settings" }),
          digestProviderValue({ material: "agent-model-settings" }),
          now,
          now,
          principalId,
          now,
        ],
      );
      await pool.execute(
        `UPDATE credential SET active_secret_version_id = ?
         WHERE workspace_id = ? AND id = ?`,
        [secretVersionId, workspaceId, credentialId],
      );
      await pool.execute(
        `INSERT INTO budget_account (
           id, workspace_id, account_key, currency_code, period_start_at,
           period_end_at, hard_limit_amount, consumed_amount, reserved_amount,
           unknown_held_amount, lifecycle_status, version,
           created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'agent-model-settings', 'USD', ?, ?, 100, 0, 0, 0,
                   'active', 1, ?, ?, ?)`,
        [
          budgetAccountId,
          workspaceId,
          new Date(now.getTime() - 60_000),
          new Date(now.getTime() + 86_400_000),
          principalId,
          now,
          now,
        ],
      );
      const modelFacts = [
        {
          canonicalModelId: firstCanonicalModelId,
          bindingId: firstModelBindingId,
          bindingKey: "workspace-agent-model",
          displayName: "Balanced model",
          providerModelId: "balanced-model",
          profileId: firstModelProfileId,
          deploymentId: firstModelDeploymentId,
          pricingId: firstPricingRevisionId,
          schemaVersion: 1,
        },
        {
          canonicalModelId: secondCanonicalModelId,
          bindingId: secondModelBindingId,
          bindingKey: "workspace-agent-quality",
          displayName: "Quality model",
          providerModelId: "quality-model",
          profileId: secondModelProfileId,
          deploymentId: secondModelDeploymentId,
          pricingId: secondPricingRevisionId,
          schemaVersion: 1,
        },
        {
          canonicalModelId: nonToolCanonicalModelId,
          bindingId: nonToolModelBindingId,
          bindingKey: "workspace-agent-no-tools",
          displayName: "Non-Tool model",
          providerModelId: "non-tool-model",
          profileId: nonToolModelProfileId,
          deploymentId: nonToolModelDeploymentId,
          pricingId: nonToolPricingRevisionId,
          schemaVersion: 1,
        },
      ] as const;
      for (const [index, model] of modelFacts.entries()) {
        const evidence = [
          {
            kind: "provider_api",
            reference: "test.models",
            observedAt: now.toISOString(),
            sourceDigest: digestProviderValue({ model: index }),
            confidence: "high",
            claim: "supported",
          },
        ];
        const profileDocument = {
          schemaVersion: 1,
          model: {
            slug: `test/${model.providerModelId}`,
            displayName: model.displayName,
            family: "agent-settings",
            description: "Model used by Agent settings integration tests.",
            inputModalities: ["text"],
            outputModalities: ["text"],
            contextWindow: 128_000,
            maximumOutputTokens: 8_192,
            ...(model.bindingId === nonToolModelBindingId
              ? {}
              : { toolCall: true }),
          },
          operations: {
            "text.generate": { parameters: [], evidence },
          },
          sources: [],
        };
        const pricingDocument = {
          schemaVersion: 1,
          billingMode: "fixed",
          fixedChargeAmount: "0.25",
          evidence: {
            priceVerified: true,
            sourceKind: "contract",
            sourceReference: `contract://agent-model/${String(index + 1)}`,
            observedAt: now.toISOString(),
            sourceDigest: digestProviderValue({ pricing: index }),
          },
        };
        await pool.execute(
          `INSERT INTO canonical_model (
             id, workspace_id, slug, lifecycle_status, source_kind,
             source_reference, version, created_by_principal_id,
             updated_by_principal_id, created_at, updated_at, activated_at,
             disabled_at, revoked_at
           ) VALUES (?, ?, ?, 'active', 'manual', NULL, 1, ?, ?, ?, ?, ?,
                     NULL, NULL)`,
          [
            model.canonicalModelId,
            workspaceId,
            model.providerModelId,
            principalId,
            principalId,
            now,
            now,
            now,
          ],
        );
        await pool.execute(
          `INSERT INTO model_profile_revision (
             id, workspace_id, canonical_model_id, profile_key,
             revision, schema_version,
             profile_document, canonical_digest, lifecycle_status,
             created_by_principal_id, published_by_principal_id,
             created_at, published_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'published', ?, ?, ?, ?)`,
          [
            model.profileId,
            workspaceId,
            model.canonicalModelId,
            model.bindingKey,
            model.schemaVersion,
            JSON.stringify(profileDocument),
            digestProviderValue(profileDocument),
            principalId,
            principalId,
            now,
            now,
          ],
        );
        const deploymentDigest = digestProviderValue({
          modelProfileRevisionId: model.profileId,
          providerModelId: model.providerModelId,
        });
        await pool.execute(
          `INSERT INTO model_deployment (
             id, workspace_id, provider_endpoint_id,
             model_profile_revision_id, deployment_key, provider_model_id,
             deployment_digest, lifecycle_status, version,
             created_by_principal_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
          [
            model.deploymentId,
            workspaceId,
            providerEndpointId,
            model.profileId,
            model.bindingKey,
            model.providerModelId,
            deploymentDigest,
            principalId,
            now,
            now,
          ],
        );
        await pool.execute(
          `INSERT INTO pricing_revision (
             id, workspace_id, provider_endpoint_id, model_deployment_id,
             pricing_key, revision, schema_version, currency_code,
             pricing_document, canonical_digest, lifecycle_status, source_kind,
             verified_at, effective_at, created_by_principal_id,
             published_by_principal_id, created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
                     'contract', ?, ?, ?, ?, ?, ?)`,
          [
            model.pricingId,
            workspaceId,
            providerEndpointId,
            model.deploymentId,
            model.bindingKey,
            JSON.stringify(pricingDocument),
            digestProviderValue(pricingDocument),
            now,
            now,
            principalId,
            principalId,
            now,
            now,
          ],
        );
        const routeFacts = {
          schemaVersion: 1,
          bindingId: model.bindingId,
          bindingKey: model.bindingKey,
          modelProfileRevisionId: model.profileId,
          modelDeploymentId: model.deploymentId,
          providerEndpointId,
          credentialId,
          pricingRevisionId: model.pricingId,
          budgetAccountId,
          maximumCharge: { currencyCode: "USD", amount: "1" },
          apiSurface: "chat.completions.v1",
          protocolKind: "openai_chat",
          providerModelId: model.providerModelId,
        };
        await pool.execute(
          `INSERT INTO agent_model_binding (
             id, workspace_id, binding_key, model_profile_revision_id,
             model_deployment_id, provider_endpoint_id, credential_id,
             budget_account_id, maximum_charge_currency_code,
             maximum_charge_amount, pricing_revision_id, api_surface,
             protocol_kind, lifecycle_status, route_digest,
             idempotency_key, request_hash, version,
             created_by_principal_id, updated_by_principal_id,
             created_at, updated_at, disabled_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', 1, ?,
                     'chat.completions.v1', 'openai_chat', 'enabled',
                     ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
          [
            model.bindingId,
            workspaceId,
            model.bindingKey,
            model.profileId,
            model.deploymentId,
            providerEndpointId,
            credentialId,
            budgetAccountId,
            model.pricingId,
            digestProviderValue(routeFacts),
            `agent-model-settings-${String(index + 1)}`,
            digestProviderValue({ request: index }),
            principalId,
            principalId,
            now,
            now,
          ],
        );
      }
      await pool.execute(
        `INSERT INTO workflow_revision (
           id, workspace_id, workflow_key, revision, lifecycle_status,
           canonical_digest, topology, input_schema, output_schema,
           created_at, published_at
         ) VALUES (?, ?, 'workspace-defined-workflow', 1, 'published', ?,
                   ?, ?, ?, ?, ?)`,
        [
          workflowRevisionId,
          workspaceId,
          digest("b"),
          JSON.stringify({
            schemaVersion: 1,
            key: "workspace_defined_workflow",
            entryNodeKey: "invoke",
            limits: { maxNodeRuns: 10, timeoutMs: 60_000 },
            nodes: [
              {
                key: "invoke",
                kind: "invoke",
                capability: {
                  contractId: "foundation.echo",
                  revision: 1,
                  canonicalDigest: digest("f"),
                },
                input: { source: "workflow_input" },
                next: [],
              },
            ],
            outputs: {},
          }),
          JSON.stringify({
            type: "object",
            required: ["brief"],
            properties: { brief: { type: "string" } },
          }),
          JSON.stringify({ type: "object" }),
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO workflow_revision_activation (
           workspace_id, workflow_revision_id, runtime_status, reason_code,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
        [workspaceId, workflowRevisionId, principalId, now],
      );
      await pool.execute(
        `INSERT INTO publication_candidate (
           id, workspace_id, subject_kind, subject_key, source_draft_id,
           source_draft_version, schema_version, content_document,
           canonical_digest, parser_profile_version,
           created_by_principal_id, created_at
         ) VALUES (?, ?, 'skill', 'workspace-defined-unknown-skill', ?, 1, 1,
                   ?, ?, 'agent-foundation-v1', ?, ?)`,
        [
          publicationCandidateId,
          workspaceId,
          id(9_100_013),
          JSON.stringify({ schemaVersion: 1 }),
          digest("c"),
          principalId,
          now,
        ],
      );
      const skillManifest = {
        schemaVersion: 1,
        skillKey: "workspace-defined.unknown-at-compile-time",
        displayName: "Runtime-discovered campaign builder",
        nonProduction: false,
        agent: {
          surfaceKinds: ["workspace_home"],
          toolFamilies: ["workflow"],
          summary:
            "Builds a campaign result from Workspace-provided inputs and published instructions.",
          exampleRequests: ["Prepare a campaign visual from these assets."],
          instructionResourcePath: "SKILL.md",
        },
        entrypoints: [
          {
            entrypointKey: "prepare",
            displayName: "Prepare campaign",
            description:
              "Use the Workspace-published workflow to prepare one campaign result.",
            category: "Campaign",
          },
        ],
      };
      await pool.execute(
        `INSERT INTO skill_definition (
           id, workspace_id, skill_key, owner_principal_id, visibility,
           lifecycle_status, creation_request_key, creation_request_hash,
           version, created_by_principal_id, updated_by_principal_id,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, 'workspace-defined.unknown-at-compile-time', ?,
                   'workspace', 'active', 'agent-foundation-skill', ?, 1,
                   ?, ?, ?, ?, NULL)`,
        [
          skillDefinitionId,
          workspaceId,
          principalId,
          digest("2"),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO skill_presentation (
           workspace_id, skill_definition_id, display_name, summary,
           cover_asset_id, category, tags, example_requests,
           version, updated_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'Runtime-discovered campaign builder',
                   'Builds campaign results', NULL, 'Campaign', '[]', '[]',
                   1, ?, ?, ?)`,
        [workspaceId, skillDefinitionId, principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO skill_revision (
           id, workspace_id, skill_definition_id, skill_key, revision,
           lifecycle_status,
           publication_candidate_id, schema_version, manifest_document,
           canonical_digest, package_digest, parser_profile_version,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, 'workspace-defined.unknown-at-compile-time', 1,
                   'published', ?, 1, ?, ?, ?, 'agent-foundation-v1',
                   ?, ?, ?, ?)`,
        [
          skillRevisionId,
          workspaceId,
          skillDefinitionId,
          publicationCandidateId,
          JSON.stringify(skillManifest),
          digest("d"),
          digest("e"),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO skill_revision_activation (
           workspace_id, skill_revision_id, runtime_status, reason_code,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
        [workspaceId, skillRevisionId, principalId, now],
      );
      await pool.execute(
        `INSERT INTO agent_revision_skill_binding (
           workspace_id, profile_revision_id, skill_definition_id,
           ordinal, created_at
         ) VALUES (?, ?, ?, 0, ?)`,
        [workspaceId, profileRevisionId, skillDefinitionId, now],
      );
      await pool.execute(
        `INSERT INTO skill_revision_workflow_entrypoint (
           skill_revision_id, workspace_id, entrypoint_key,
           workflow_revision_id, ordinal
         ) VALUES (?, ?, 'prepare', ?, 0)`,
        [skillRevisionId, workspaceId, workflowRevisionId],
      );
      const markdownSha = "f".repeat(64);
      await pool.execute(
        `INSERT INTO upload_session (
           id, workspace_id, attempt_id, purpose, output_role, output_index,
           storage_profile_id, container, object_key, upload_mode,
           write_protection_mode, state, version, expires_at,
           cleanup_eligible_at, cleanup_state, verified_size, verified_sha256,
           detected_media_type, verification_profile_version,
           committed_stored_object_id, created_at, updated_at, committed_at
         ) VALUES (?, ?, NULL, 'skill_package_import', NULL, NULL, ?,
                   'agent-foundation', 'skills/unknown/SKILL.md', 'single_put',
                   'conditional_create', 'verified', 1, ?, ?, 'none', 128, ?,
                   'text/markdown', 'agent-foundation-v1', NULL, ?, ?, NULL)`,
        [
          uploadId,
          workspaceId,
          storageProfileId,
          new Date(now.getTime() + 86_400_000),
          new Date(now.getTime() + 172_800_000),
          markdownSha,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO stored_object (
           id, workspace_id, created_from_upload_session_id,
           storage_profile_id, container, object_key, byte_size, sha256,
           immutable_identity_hash, media_type, delete_state, created_at
         ) VALUES (?, ?, ?, ?, 'agent-foundation',
                   'skills/unknown/SKILL.md', 128, ?, ?, 'text/markdown',
                   'active', ?)`,
        [
          storedObjectId,
          workspaceId,
          uploadId,
          storageProfileId,
          markdownSha,
          digest("9"),
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO skill_revision_resource (
           skill_revision_id, workspace_id, resource_path, resource_kind,
           stored_object_id, content_digest, media_type, byte_size, ordinal
         ) VALUES (?, ?, 'SKILL.md', 'instructions', ?, ?,
                   'text/markdown', 128, 0)`,
        [skillRevisionId, workspaceId, storedObjectId, digest("f")],
      );
    });

    afterAll(async () => pool?.end());

    it("limits distinct Skills without truncating their admitted entrypoints", async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT manifest_document AS manifest, canonical_digest AS digest FROM skill_revision WHERE id = ?",
        [skillRevisionId],
      );
      const original = rows[0]!;
      const manifest = (
        typeof original.manifest === "string"
          ? JSON.parse(original.manifest)
          : original.manifest
      ) as Record<string, unknown>;
      const entrypoints = Array.from({ length: 21 }, (_, index) => ({
        entrypointKey: index === 0 ? "prepare" : `catalog-test-${index}`,
        displayName: `Prepare ${index}`,
        description: "Prepare an admitted result.",
      }));
      const expanded = { ...manifest, entrypoints };
      const boundedProfile = {
        ...profileManifest,
        skillPolicy: { ...profileManifest.skillPolicy, maximumCatalogItems: 1 },
      };
      try {
        await pool.execute(
          "UPDATE skill_revision SET manifest_document = ?, canonical_digest = ? WHERE id = ?",
          [
            JSON.stringify(expanded),
            digestProviderValue(expanded),
            skillRevisionId,
          ],
        );
        await pool.execute(
          "UPDATE agent_profile_revision SET manifest_document = ?, canonical_digest = ? WHERE id = ?",
          [
            JSON.stringify(boundedProfile),
            digestProviderValue(boundedProfile),
            profileRevisionId,
          ],
        );
        for (let index = 1; index < entrypoints.length; index += 1)
          await pool.execute(
            "INSERT INTO skill_revision_workflow_entrypoint (skill_revision_id, workspace_id, entrypoint_key, workflow_revision_id, ordinal) VALUES (?, ?, ?, ?, ?)",
            [
              skillRevisionId,
              workspaceId,
              entrypoints[index]!.entrypointKey,
              workflowRevisionId,
              index,
            ],
          );
        const view = await createAgentFoundationStore(pool).resolveSurfaceView({
          authority,
          surfaceKind: "workspace_home",
          now,
        });
        expect(view?.skills).toHaveLength(1);
        expect(view?.skills[0]?.entrypoints).toHaveLength(21);
      } finally {
        await pool.execute(
          "DELETE FROM skill_revision_workflow_entrypoint WHERE skill_revision_id = ? AND entrypoint_key LIKE 'catalog-test-%'",
          [skillRevisionId],
        );
        await pool.execute(
          "UPDATE skill_revision SET manifest_document = ?, canonical_digest = ? WHERE id = ?",
          [JSON.stringify(manifest), original.digest, skillRevisionId],
        );
        await pool.execute(
          "UPDATE agent_profile_revision SET manifest_document = ?, canonical_digest = ? WHERE id = ?",
          [
            JSON.stringify(profileManifest),
            digestProviderValue(profileManifest),
            profileRevisionId,
          ],
        );
      }
    });

    it("publishes and replays a Profile plus its Surface binding from pack data", async () => {
      const store = createAgentProfilePublicationStore(pool);
      const published = await store.publish({
        authority,
        agentDefinitionId: id(9_100_015),
        profileRevisionId: id(9_100_014),
        managementKind: "workspace",
        profile: {
          profileKey: "workspace-profile-from-data",
          revision: 1,
          surfaceBindings: ["workspace_home"],
          manifest: profileManifest,
        },
        now,
        audit: {
          auditEventId: id(9_100_015),
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({ session: "profile" }),
          authorityType: "human_membership",
          authorityId: membershipId,
          authorityVersion: 1,
        },
      });
      expect(published).toMatchObject({
        id: profileRevisionId,
        profileKey: "workspace-profile-from-data",
        canonicalDigest: digestProviderValue(profileManifest),
      });
    });

    it("stores default and fast models by canonical model identity", async () => {
      const store = createAgentProfilePublicationStore(pool);
      await expect(
        store.getModelSettings(authority, now),
      ).resolves.toMatchObject({
        profileRevisionId,
        profileRevision: 1,
        version: 1,
        currentDefaultModelId: firstCanonicalModelId,
        currentFastModelId: firstCanonicalModelId,
        reasoningLevel: "medium",
        webSearchMode: "off",
        options: [
          {
            id: firstCanonicalModelId,
            modelName: "Balanced model",
            ready: true,
          },
          {
            id: secondCanonicalModelId,
            modelName: "Quality model",
            ready: true,
          },
          {
            id: nonToolCanonicalModelId,
            modelName: "Non-Tool model",
            ready: false,
            unavailableReasons: ["tool_call"],
          },
        ],
      });

      const changed = await store.setModelSettings({
        authority,
        expectedVersion: 1,
        defaultModelId: secondCanonicalModelId,
        fastModelId: firstCanonicalModelId,
        reasoningLevel: "high",
        webSearchMode: "auto",
        actionConfirmationRequired: false,
        now: new Date(now.getTime() + 1_000),
        audit: {
          auditEventId: id(9_100_041),
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({
            session: "agent-model-settings",
          }),
          authorityType: "human_membership",
          authorityId: membershipId,
          authorityVersion: 1,
        },
      });
      expect(changed).toMatchObject({
        profileRevisionId,
        profileRevision: 1,
        version: 1,
        currentDefaultModelId: secondCanonicalModelId,
        currentFastModelId: firstCanonicalModelId,
        reasoningLevel: "high",
        webSearchMode: "auto",
      });
      const [settingsRows] = await pool.query<
        (RowDataPacket & {
          readonly defaultModelId: string;
          readonly fastModelId: string;
          readonly reasoningLevel: string;
          readonly webSearchMode: string;
          readonly actionConfirmationRequired: number;
          readonly version: number;
        })[]
      >(
        `SELECT default_canonical_model_id AS defaultModelId,
                fast_canonical_model_id AS fastModelId,
                reasoning_level AS reasoningLevel,
                web_search_mode AS webSearchMode,
                action_confirmation_required AS actionConfirmationRequired,
                version
         FROM workspace_agent_model_settings
         WHERE workspace_id = ?`,
        [workspaceId],
      );
      expect(settingsRows).toEqual([
        {
          defaultModelId: secondCanonicalModelId,
          fastModelId: firstCanonicalModelId,
          reasoningLevel: "high",
          webSearchMode: "auto",
          actionConfirmationRequired: 0,
          version: 1,
        },
      ]);
      await expect(
        store.setModelSettings({
          authority,
          expectedVersion: 1,
          defaultModelId: secondCanonicalModelId,
          fastModelId: firstCanonicalModelId,
          reasoningLevel: "high",
          webSearchMode: "auto",
          actionConfirmationRequired: false,
          now: new Date(now.getTime() + 2_000),
          audit: {
            auditEventId: id(9_100_043),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digestProviderValue({
              session: "agent-model-settings-replay",
            }),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).resolves.toMatchObject({
        profileRevisionId,
        profileRevision: 1,
        version: 1,
        currentDefaultModelId: secondCanonicalModelId,
        currentFastModelId: firstCanonicalModelId,
        reasoningLevel: "high",
        webSearchMode: "auto",
      });
    });

    it("pins current local Skill bytes in a development SurfaceView", async () => {
      const directory = await mkdtemp(join(tmpdir(), "kanvas-foundation-"));
      const path = join(directory, "SKILL.md");
      const bytes = Buffer.from(
        "# Local Skill\n\nUse current development instructions.",
      );
      await writeFile(path, bytes);
      try {
        const store = createAgentFoundationStore(pool, {
          developmentSkillFiles: {
            "workspace-defined.unknown-at-compile-time": path,
          },
        });
        const view = await store.resolveSurfaceView({
          authority,
          surfaceKind: "workspace_home",
          now,
        });
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        expect(view?.skills[0]?.instructionResource).toMatchObject({
          developmentLocalPath: path,
          sha256,
          contentDigest: `sha256:${sha256}`,
          byteSize: String(bytes.byteLength),
        });
      } finally {
        await rm(directory, { recursive: true });
      }
    });

    it("lists only usable Agent and Skill identities in the Hub", async () => {
      const hub = createAgentHubStore(pool);
      await expect(hub.listAgents(authority, now)).resolves.toEqual([
        expect.objectContaining({
          managementKind: "system",
          systemKey: "workspace-default",
          resourceState: "enabled",
        }),
        expect.objectContaining({
          id: agentDefinitionId,
          profileRevisionId,
          displayName: "Workspace profile from data",
          visibility: "workspace",
          boundSkillCount: 1,
        }),
      ]);
      await expect(hub.listSkills(authority, now)).resolves.toEqual([
        expect.objectContaining({
          id: skillDefinitionId,
          skillRevisionId,
          displayName: "Runtime-discovered campaign builder",

          visibility: "workspace",
        }),
      ]);
    });

    it("pins library content per Run and reauthorizes reads after updates, archival and content revocation", async () => {
      const libraries = createResourceLibraryStore(pool);
      const runtime = createAgentLibraryStore(pool);
      const libraryId = id(9_100_300),
        revisionId = id(9_100_301),
        entryId = id(9_100_302),
        artifactId = id(9_100_303);
      const threadId = id(9_100_304),
        runId = id(9_100_305),
        nextRunId = id(9_100_306);
      const libraryAudit = (value: number) => ({
        auditEventId: id(value),
        authenticationRefHash: digest("a"),
      });
      await libraries.save({
        authority,
        libraryId,
        revisionId,
        expectedVersion: 0,
        requestKey: "create-run-library",
        document: {
          schemaVersion: 1,
          name: "Runtime library",
          description: "",
          entries: [],
        },
        audit: libraryAudit(9_100_307),
        now,
      });
      await pool.execute(
        `INSERT INTO artifact (id, workspace_id, stored_object_id, content_digest, artifact_type, availability_status, data_classification, metadata, created_at)
        SELECT ?, workspace_id, id, CONCAT('sha256:', sha256), 'document.text', 'available', 'internal', '{}', ? FROM stored_object WHERE workspace_id = ? AND id = ?`,
        [artifactId, now, workspaceId, storedObjectId],
      );
      await pool.execute(
        "INSERT INTO resource_library_upload (workspace_id, library_id, artifact_id, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?)",
        [workspaceId, libraryId, artifactId, principalId, now],
      );
      const document = {
        schemaVersion: 1 as const,
        name: "Runtime library",
        description: "Original facts",
        entries: [
          {
            id: entryId,
            name: "Original text",
            purpose: "Product facts",
            artifactId,
          },
        ],
      };
      const saved = await libraries.save({
        authority,
        libraryId,
        revisionId: id(9_100_308),
        expectedVersion: 1,
        requestKey: "add-run-reference",
        document,
        audit: libraryAudit(9_100_309),
        now,
      });
      await pool.execute(
        `INSERT INTO agent_thread (id, workspace_id, created_by_principal_id, agent_definition_id, agent_profile_revision_id, lifecycle_status, title_source, creation_request_key, creation_request_hash, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', 'auto', 'library-runtime-test', ?, 1, ?, ?)`,
        [
          threadId,
          workspaceId,
          principalId,
          agentDefinitionId,
          profileRevisionId,
          digest("a"),
          now,
          now,
        ],
      );
      for (const selectedRun of [runId, nextRunId])
        await pool.execute(
          `INSERT INTO agent_run (id, workspace_id, thread_id, actor_principal_id, lifecycle_status, context_snapshot, context_digest, tool_view_digest, prompt_revision, maximum_model_calls, maximum_tool_calls, idempotency_key, request_hash, version, execution_deadline_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'running', '{"schemaVersion":1,"surfaceKind":"agent_workspace"}', ?, ?, 'library-test', 8, 8, ?, ?, 1, ?, ?, ?)`,
          [
            selectedRun,
            workspaceId,
            threadId,
            principalId,
            digest("a"),
            digest("b"),
            selectedRun,
            digest("c"),
            new Date(now.getTime() + 60000),
            now,
            now,
          ],
        );
      const scope = { authority, runId, now };
      expect((await runtime.pin({ ...scope, libraryId })).id).toBe(
        saved.revision.id,
      );
      const replacementUploadId = id(9_100_340),
        replacementObjectId = id(9_100_341),
        replacementArtifactId = id(9_100_342);
      const replacementText = "Replacement durable steel";
      const replacementSha = createHash("sha256")
        .update(replacementText)
        .digest("hex");
      await pool.execute(
        `INSERT INTO upload_session (id, workspace_id, purpose, actor_id, allocation_request_key, allocation_request_hash, storage_profile_id, container, object_key, upload_mode, write_protection_mode, state, version, expires_at, cleanup_eligible_at, cleanup_state, verified_size, verified_sha256, detected_media_type, verification_profile_version, verified_at, created_at, updated_at)
        VALUES (?, ?, 'user_import', ?, NULL, NULL, ?, 'agent-foundation', 'libraries/replacement.md', 'single_put', 'conditional_create', 'verified', 1, ?, ?, 'none', 25, ?, 'text/markdown', 'agent-foundation-v1', ?, ?, ?)`,
        [
          replacementUploadId,
          workspaceId,
          principalId,
          storageProfileId,
          new Date(now.getTime() + 86400000),
          new Date(now.getTime() + 172800000),
          replacementSha,
          now,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO stored_object (id, workspace_id, created_from_upload_session_id, storage_profile_id, container, object_key, byte_size, sha256, immutable_identity_hash, media_type, delete_state, created_at)
        VALUES (?, ?, ?, ?, 'agent-foundation', 'libraries/replacement.md', 25, ?, ?, 'text/markdown', 'active', ?)`,
        [
          replacementObjectId,
          workspaceId,
          replacementUploadId,
          storageProfileId,
          replacementSha,
          digest("b"),
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO artifact (id, workspace_id, stored_object_id, content_digest, artifact_type, availability_status, data_classification, metadata, created_at) VALUES (?, ?, ?, ?, 'document.text', 'available', 'internal', '{}', ?)`,
        [
          replacementArtifactId,
          workspaceId,
          replacementObjectId,
          `sha256:${replacementSha}`,
          now,
        ],
      );
      await pool.execute(
        "INSERT INTO resource_library_upload (workspace_id, library_id, artifact_id, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?)",
        [workspaceId, libraryId, replacementArtifactId, principalId, now],
      );
      await libraries.save({
        authority,
        libraryId,
        revisionId: id(9_100_310),
        expectedVersion: 2,
        requestKey: "change-run-reference",
        document: {
          ...document,
          description: "New facts",
          entries: [
            {
              ...document.entries[0]!,
              name: "Updated text",
              artifactId: replacementArtifactId,
            },
          ],
        },
        audit: libraryAudit(9_100_311),
        now,
      });
      expect(
        (await runtime.pin({ ...scope, libraryId })).document.description,
      ).toBe("Original facts");
      expect(
        (await runtime.pin({ ...scope, runId: nextRunId, libraryId })).document
          .description,
      ).toBe("New facts");
      await libraries.setLifecycle({
        authority,
        libraryId,
        expectedVersion: 3,
        lifecycleStatus: "archived",
        audit: libraryAudit(9_100_312),
        now,
      });
      expect((await runtime.pin({ ...scope, libraryId })).id).toBe(
        saved.revision.id,
      );
      expect(
        await runtime.catalog({ ...scope, query: "Original facts" }),
      ).toMatchObject([
        { id: libraryId, description: "Original facts", selected: true },
      ]);
      const reference = await runtime.reference({
        ...scope,
        libraryId,
        entryId,
      });
      expect(reference.name).toBe("Original text");
      expect(reference.artifactId).toBe(artifactId);
      const replacementReference = await runtime.reference({
        ...scope,
        runId: nextRunId,
        libraryId,
        entryId,
      });
      expect(replacementReference).toMatchObject({
        artifactId: replacementArtifactId,
        storedObjectId: replacementObjectId,
        sha256: replacementSha,
      });
      expect(replacementReference.contentDigest).not.toBe(
        reference.contentDigest,
      );
      expect(await runtime.pendingText({ ...scope, libraryId })).toMatchObject([
        { libraryId, artifactId },
      ]);
      await pool.execute(
        "INSERT INTO resource_library_text (workspace_id, artifact_id, content_digest, extractor_version, text_content, page_ranges, extraction_digest, created_at) VALUES (?, ?, ?, 'utf8-v1', ?, '[]', ?, ?)",
        [
          workspaceId,
          artifactId,
          reference.contentDigest,
          "Original aluminium product 耐用",
          digestProviderValue({
            text: "Original aluminium product 耐用",
            extractorVersion: "utf8-v1",
            pageRanges: [],
          }),
          now,
        ],
      );
      await libraries.indexText({
        authority,
        libraryId,
        artifactId: replacementArtifactId,
        contentDigest: replacementReference.contentDigest,
        text: replacementText,
        now,
      });
      expect(
        (
          await libraries.getTextSource({
            authority,
            libraryId,
            artifactId: replacementArtifactId,
            now,
          })
        ).extraction?.text,
      ).toBe(replacementText);
      await expect(
        libraries.indexText({
          authority,
          libraryId,
          artifactId: replacementArtifactId,
          contentDigest: replacementReference.contentDigest,
          text: "wrong bytes",
          now,
        }),
      ).rejects.toMatchObject({ code: "resource_library.integrity" });
      expect(await runtime.searchText({ ...scope, query: "durable" })).toEqual(
        [],
      );
      expect(
        await runtime.searchText({
          ...scope,
          runId: nextRunId,
          query: "durable",
        }),
      ).toMatchObject([
        {
          reference: { artifactId: replacementArtifactId },
          text: "Replacement durable steel",
        },
      ]);
      expect(
        await runtime.searchText({ ...scope, query: "耐用" }),
      ).toMatchObject([{ reference: { artifactId } }]);
      const location = {
        number: 1,
        startLine: 1,
        endLine: 1,
        startOffset: 0,
        endOffset: replacementText.length,
      };
      await runtime.recordUse({
        ...scope,
        runId: nextRunId,
        reference: replacementReference,
        useKey: "exact-location",
        kind: "text_read",
        locations: [location],
      });
      expect(
        await runtime.listUses({
          authority,
          threadId,
          runIds: [nextRunId],
          now,
        }),
      ).toMatchObject([
        {
          artifactId: replacementArtifactId,
          revisionId: replacementReference.revisionId,
          locations: [location],
        },
      ]);
      await expect(
        runtime.recordUse({
          ...scope,
          runId: nextRunId,
          reference: replacementReference,
          useKey: "forged-location",
          kind: "text_read",
          locations: [{ ...location, startLine: 2 }],
        }),
      ).rejects.toMatchObject({ code: "resource_library.integrity" });
      expect(await runtime.pendingText({ ...scope, libraryId })).toEqual([]);
      expect(() => runtime.searchText({ ...scope, query: " " })).toThrow(
        "Search needs 1 to 200 characters",
      );
      // A repeated read is the same path used after a Worker resumes a pinned Run.
      expect(
        (await runtime.reference({ ...scope, libraryId, entryId })).artifactId,
      ).toBe(artifactId);

      await runtime.recordUse({
        ...scope,
        reference,
        useKey: "read-1",
        kind: "text_read",
      });
      await runtime.recordUse({
        ...scope,
        reference,
        useKey: "read-1",
        kind: "text_read",
      });
      await expect(
        runtime.recordUse({
          ...scope,
          reference,
          useKey: "read-1",
          kind: "tool_input",
        }),
      ).rejects.toMatchObject({ code: "resource_library.request_conflict" });
      const [uses] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM agent_run_library_use WHERE run_id = ?",
        [runId],
      );
      expect(Number(uses[0]?.count)).toBe(1);
      const actionId = id(9_100_315);
      await pool.execute(
        `INSERT INTO agent_action_receipt (id, workspace_id, agent_run_id, action_number, tool_call_id, tool_key, effect, approval_mode, lifecycle_status, input_digest, version, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'library-tool-input', 'capability.invoke', 'compute', 'none', 'running', ?, 1, ?, ?)`,
        [actionId, workspaceId, runId, digest("a"), now, now],
      );
      const inputConnection = await pool.getConnection();
      try {
        await inputConnection.beginTransaction();
        await recordAgentLibraryToolInputsInTransaction(inputConnection, {
          authority,
          invocationKind: "agent",
          invocationReferenceId: actionId,
          consumerId: id(9_100_316),
          input: { image: { artifactId } },
          now,
        });
        await inputConnection.commit();
      } catch (error) {
        await inputConnection.rollback();
        throw error;
      } finally {
        inputConnection.release();
      }
      const [toolUses] = await pool.execute<RowDataPacket[]>(
        "SELECT artifact_id AS artifactId, revision_id AS revisionId FROM agent_run_library_use WHERE run_id = ? AND use_kind = 'tool_input'",
        [runId],
      );
      expect(toolUses).toMatchObject([
        { artifactId, revisionId: saved.revision.id },
      ]);
      const workflows = createWorkflowExecutionPersistence(pool);
      const workflowRunRecord = (runId: string): WorkflowRunRecord => ({
        id: runId,
        workspaceId,
        definitionKind: "published_revision",
        workflowRevisionId,
        nonProduction: false,
        idempotencyKey: runId,
        requestHash: digest("a"),
        lifecycleStatus: "queued",
        outcome: null,
        input: { referenceArtifactId: artifactId },
        executionPlanSnapshot: {},
        executionPlanHash: digest("b"),
        createdBy: principalId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        executionDeadlineAt: new Date(now.getTime() + 60000),
      });
      const acceptedWorkflowId = id(9_100_330);
      await workflows.transactionManager.run((context) =>
        workflows.workflowRuns.insert(
          workflowRunRecord(acceptedWorkflowId),
          context,
          { authority, actionReceiptId: actionId },
        ),
      );
      const [workflowUses] = await pool.execute<RowDataPacket[]>(
        "SELECT use_key AS useKey FROM agent_run_library_use WHERE run_id = ? AND use_key LIKE 'workflow:%'",
        [runId],
      );
      expect(workflowUses).toEqual([
        {
          useKey: `workflow:${acceptedWorkflowId}:${saved.revision.id}:${entryId}`,
        },
      ]);
      const history = { authority, threadId, runIds: [runId], now };
      expect(await runtime.listUses(history)).toEqual([
        expect.objectContaining({
          runId,
          libraryId,
          entryId,
          name: "Original text",
          revisionNumber: saved.revision.revisionNumber,
          kind: "text_read",
        }),
        expect.objectContaining({
          runId,
          libraryId,
          entryId,
          name: "Original text",
          revisionNumber: saved.revision.revisionNumber,
          kind: "tool_input",
        }),
      ]);
      expect(
        await runtime.listUses({ ...history, runIds: [nextRunId] }),
      ).toMatchObject([
        { artifactId: replacementArtifactId, locations: [location] },
      ]);
      await expect(
        runtime.listUses({ ...history, threadId: id(9_100_399) }),
      ).rejects.toMatchObject({ code: "resource_library.not_found" });

      const canvases = createCanvasDraftStore(pool);
      const canvasDraftId = id(9_100_320);
      const canvasDocument: EditorDraftContentV1 = {
        schemaVersion: "kanvas.editor-document/v1",
        title: "Library placement",
        pages: [
          {
            id: "page-1",
            name: "Page",
            width: 100,
            height: 100,
            background: { kind: "transparent" },
            nodes: [],
          },
        ],
        metadata: { createdWith: "kanvas-web" },
      };
      await canvases.create({
        authority,
        canvasDraftId,
        idempotencyKey: "library-canvas",
        document: canvasDocument,
        now,
        audit: libraryAudit(9_100_321),
      });
      const placementDocument: EditorDraftContentV1 = {
        ...canvasDocument,
        pages: [
          {
            ...canvasDocument.pages[0]!,
            nodes: [
              {
                id: "image-1",
                kind: "image",
                name: "Invalid text placement",
                transform: {
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  rotation: 0,
                  flipX: false,
                  flipY: false,
                },
                opacity: 1,
                blendMode: "normal",
                visible: true,
                locked: false,
                image: {
                  source: { kind: "artifact", artifactId },
                  crop: { x: 0, y: 0, width: 1, height: 1 },
                  fit: "contain",
                  focalPoint: { x: 0.5, y: 0.5 },
                },
                cornerRadius: 0,
              },
            ],
          },
        ],
      };
      await expect(
        canvases.update({
          authority,
          canvasDraftId,
          expectedVersion: 1,
          document: placementDocument,
          libraryInput: {
            actionReceiptId: actionId,
            artifactId,
            libraryId,
            entryId,
          },
          now,
          audit: libraryAudit(9_100_322),
        }),
      ).rejects.toMatchObject({
        code: "resource_library.reference_unavailable",
      });
      const [canvasRows] = await pool.execute<RowDataPacket[]>(
        "SELECT version FROM canvas_draft WHERE id = ?",
        [canvasDraftId],
      );
      expect(canvasRows[0]?.version).toBe(1);
      const [retainedRows] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM canvas_draft_artifact_reference WHERE canvas_draft_id = ?",
        [canvasDraftId],
      );
      expect(Number(retainedRows[0]?.count)).toBe(0);
      expect(await runtime.listUses(history)).toHaveLength(2);

      await pool.execute(
        "UPDATE artifact SET availability_status = 'quarantined' WHERE id = ?",
        [artifactId],
      );
      await expect(
        runtime.reference({ ...scope, libraryId, entryId }),
      ).rejects.toMatchObject({
        code: "resource_library.reference_unavailable",
      });
      await pool.execute(
        "UPDATE agent_run SET lifecycle_status = 'cancelled', completed_at = ?, terminal_reason_code = 'cancelled' WHERE id = ?",
        [now, runId],
      );
      await expect(runtime.pin({ ...scope, libraryId })).rejects.toMatchObject({
        code: "resource_library.run_unavailable",
      });
      await expect(
        canvases.update({
          authority,
          canvasDraftId,
          expectedVersion: 1,
          document: placementDocument,
          libraryInput: {
            actionReceiptId: actionId,
            artifactId,
            libraryId,
            entryId,
          },
          now,
          audit: libraryAudit(9_100_323),
        }),
      ).rejects.toMatchObject({ code: "resource_library.not_selected" });
      const [cancelledCanvasRows] = await pool.execute<RowDataPacket[]>(
        "SELECT version FROM canvas_draft WHERE id = ?",
        [canvasDraftId],
      );
      expect(cancelledCanvasRows[0]?.version).toBe(1);
      const rejectedWorkflowId = id(9_100_331);
      await expect(
        workflows.transactionManager.run((context) =>
          workflows.workflowRuns.insert(
            workflowRunRecord(rejectedWorkflowId),
            context,
            { authority, actionReceiptId: actionId },
          ),
        ),
      ).rejects.toMatchObject({ code: "resource_library.not_selected" });
      const [rejectedWorkflowRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM workflow_run WHERE id = ?",
        [rejectedWorkflowId],
      );
      expect(rejectedWorkflowRows).toEqual([]);
      // Historic evidence remains readable after cancellation and quarantine;
      // this endpoint exposes source labels, never the underlying bytes.
      expect(await runtime.listUses(history)).toHaveLength(2);
    });

    it("shares one library across two Agent revisions and rejects archived bindings", async () => {
      const libraries = createResourceLibraryStore(pool);
      const publications = createAgentProfilePublicationStore(pool);
      const hub = createAgentHubStore(pool);
      const libraryId = id(9_100_210);
      await libraries.save({
        authority,
        libraryId,
        revisionId: id(9_100_211),
        expectedVersion: 0,
        requestKey: "shared-agent-library",
        document: {
          schemaVersion: 1,
          name: "Product facts",
          description: "Shared design and copy references",
          entries: [],
        },
        audit: {
          auditEventId: id(9_100_212),
          authenticationRefHash: digest("a"),
        },
        now,
      });
      const audit = (value: number) => ({
        auditEventId: id(value),
        actorPrincipalId: principalId,
        actorType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefHash: digest("a"),
        authorityType: "human_membership" as const,
        authorityId: membershipId,
        authorityVersion: 1,
      });
      for (const index of [0, 1]) {
        await publications.publish({
          authority,
          agentDefinitionId: id(9_100_220 + index),
          profileRevisionId: id(9_100_230 + index),
          managementKind: "workspace",
          visibility: "workspace",
          boundLibraryIds: [libraryId],
          presentation: {
            displayName: `Library Agent ${index}`,
            summary: "Uses shared product facts",
            tags: [],
          },
          profile: {
            profileKey: `workspace.library-agent-${index}`,
            revision: 1,
            surfaceBindings: [],
            manifest: {
              ...profileManifest,
              allowedSurfaceKinds: ["agent_workspace"],
            },
          },
          audit: audit(9_100_240 + index),
          now,
        });
        expect(
          await hub.getAgent(authority, id(9_100_220 + index), now),
        ).toMatchObject({
          boundLibraries: [{ id: libraryId, displayName: "Product facts" }],
        });
      }
      await libraries.setLifecycle({
        authority,
        libraryId,
        expectedVersion: 1,
        lifecycleStatus: "archived",
        audit: {
          auditEventId: id(9_100_250),
          authenticationRefHash: digest("a"),
        },
        now,
      });
      await expect(
        publications.publish({
          authority,
          agentDefinitionId: id(9_100_220),
          profileRevisionId: id(9_100_251),
          expectedAgentVersion: 1,
          managementKind: "workspace",
          visibility: "workspace",
          boundLibraryIds: [libraryId],
          presentation: {
            displayName: "Library Agent 0",
            summary: "Uses shared product facts",
            tags: [],
          },
          profile: {
            profileKey: "workspace.library-agent-0",
            revision: 2,
            surfaceBindings: [],
            manifest: {
              ...profileManifest,
              allowedSurfaceKinds: ["agent_workspace"],
            },
          },
          audit: audit(9_100_252),
          now,
        }),
      ).rejects.toMatchObject({
        code: "agent_profile_publication.library_unavailable",
      });
      expect(await hub.getAgent(authority, id(9_100_220), now)).toMatchObject({
        version: 1,
        boundLibraries: [{ id: libraryId }],
      });
      await publications.publish({
        authority,
        agentDefinitionId: id(9_100_220),
        profileRevisionId: id(9_100_253),
        expectedAgentVersion: 1,
        managementKind: "workspace",
        visibility: "workspace",
        boundLibraryIds: [],
        presentation: {
          displayName: "Library Agent 0",
          summary: "Unbound without deleting shared references",
          tags: [],
        },
        profile: {
          profileKey: "workspace.library-agent-0",
          revision: 2,
          surfaceBindings: [],
          manifest: {
            ...profileManifest,
            allowedSurfaceKinds: ["agent_workspace"],
          },
        },
        audit: audit(9_100_254),
        now,
      });
      expect(await hub.getAgent(authority, id(9_100_220), now)).toMatchObject({
        version: 2,
        boundLibraries: [],
      });
      expect(await hub.getAgent(authority, id(9_100_221), now)).toMatchObject({
        version: 1,
        boundLibraries: [{ id: libraryId }],
      });
      expect(
        (await libraries.getRevision({ authority, libraryId, now })).document
          .name,
      ).toBe("Product facts");
      const [oldBindings] = await pool.execute<RowDataPacket[]>(
        "SELECT library_id AS libraryId FROM agent_revision_library_binding WHERE workspace_id = ? AND profile_revision_id = ?",
        [workspaceId, id(9_100_230)],
      );
      expect(oldBindings).toEqual([{ libraryId }]);
    });

    it("reads Agent bindings and publishes a presentation-only revision", async () => {
      const publications = createAgentProfilePublicationStore(pool);
      const hub = createAgentHubStore(pool);
      const editableAgentId = id(9_100_060);
      const firstRevisionId = id(9_100_061);
      const secondRevisionId = id(9_100_062);
      const editableManifest = {
        ...profileManifest,
        displayName: "Editable Agent",
        allowedSurfaceKinds: ["agent_workspace"] as const,
      };
      const audit = (auditEventId: string) => ({
        auditEventId,
        actorPrincipalId: principalId,
        actorType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefHash: digestProviderValue({ auditEventId }),
        authorityType: "human_membership" as const,
        authorityId: membershipId,
        authorityVersion: 1,
      });
      await publications.publish({
        authority,
        agentDefinitionId: editableAgentId,
        profileRevisionId: firstRevisionId,
        managementKind: "workspace",
        visibility: "private",
        presentation: {
          displayName: "Editable Agent",
          summary: "Initial summary",

          avatar: {
            kind: "emoji",
            value: "🎨",
            backgroundColor: "#EEF2FF",
          },
          tags: [],
        },
        boundSkillDefinitionIds: [skillDefinitionId],
        profile: {
          profileKey: "workspace.editable-agent",
          revision: 1,
          surfaceBindings: [],
          manifest: editableManifest,
        },
        now,
        audit: audit(id(9_100_063)),
      });
      await expect(
        hub.getAgent(authority, editableAgentId, now),
      ).resolves.toMatchObject({
        displayName: "Editable Agent",
        avatar: { kind: "emoji", value: "🎨" },
        version: 1,
        profile: { id: firstRevisionId, revision: 1 },
        boundSkills: [
          { id: skillDefinitionId, workspaceAvailability: "available" },
        ],
      });

      const workspaceUpdate = {
        authority,
        agentDefinitionId: editableAgentId,
        profileRevisionId: secondRevisionId,
        managementKind: "workspace",
        expectedAgentVersion: 1,
        visibility: "workspace",
        presentation: {
          displayName: "Editable Agent",
          summary: "Updated summary",

          avatar: {
            kind: "icon",
            value: "palette",
            backgroundColor: "#E8F3FF",
            foregroundColor: "#3048F5",
          },
          tags: [],
        },
        boundSkillDefinitionIds: [skillDefinitionId],
        profile: {
          profileKey: "workspace.editable-agent",
          revision: 2,
          surfaceBindings: [],
          manifest: editableManifest,
        },
        now: new Date(now.getTime() + 1_000),
        audit: audit(id(9_100_064)),
      } as const;
      await expect(
        publications.publish({
          ...workspaceUpdate,
          visibility: "private",
          boundSkillDefinitionIds: [],
          presentation: {
            ...workspaceUpdate.presentation,
            avatar: { kind: "image", assetId: id(9_199_999) },
          },
        }),
      ).rejects.toMatchObject({
        code: "agent_profile_publication.avatar_unavailable",
      });
      await pool.execute(
        `UPDATE skill_definition SET visibility = 'private'
          WHERE workspace_id = ? AND id = ?`,
        [workspaceId, skillDefinitionId],
      );
      await expect(publications.publish(workspaceUpdate)).rejects.toMatchObject(
        {
          code: "agent_profile_publication.skill_workspace_visibility_required",
        },
      );
      await expect(
        hub.getAgent(authority, editableAgentId, now),
      ).resolves.toMatchObject({
        visibility: "private",
        version: 1,
        profile: { id: firstRevisionId, revision: 1 },
        boundSkills: [
          { id: skillDefinitionId, workspaceAvailability: "private" },
        ],
      });
      await expect(
        hub.setVisibility({
          authority,
          subjectKind: "agent",
          subjectId: editableAgentId,
          expectedVersion: 1,
          visibility: "workspace",
          now,
        }),
      ).rejects.toMatchObject({
        code: "agent_hub.skill_workspace_visibility_required",
      });

      await pool.execute(
        `UPDATE agent_definition SET visibility = 'workspace'
          WHERE workspace_id = ? AND id = ?`,
        [workspaceId, editableAgentId],
      );
      await expect(
        hub.getAgent(operatorAuthority, editableAgentId, now),
      ).resolves.toMatchObject({
        boundSkills: [
          {
            id: skillDefinitionId,
            workspaceAvailability: "private",
          },
        ],
      });
      const hiddenBinding = (
        await hub.getAgent(operatorAuthority, editableAgentId, now)
      )?.boundSkills[0];
      expect(hiddenBinding).not.toHaveProperty("displayName");
      expect(hiddenBinding).not.toHaveProperty("summary");
      expect(
        (await hub.listResourceStates(operatorAuthority, "skill", now)).some(
          (item) => item.id === skillDefinitionId,
        ),
      ).toBe(false);

      await pool.execute(
        `UPDATE agent_definition SET visibility = 'private'
          WHERE workspace_id = ? AND id = ?`,
        [workspaceId, editableAgentId],
      );
      await pool.execute(
        `UPDATE skill_definition SET visibility = 'workspace'
          WHERE workspace_id = ? AND id = ?`,
        [workspaceId, skillDefinitionId],
      );
      await publications.publish(workspaceUpdate);
      await expect(
        hub.getAgent(
          authority,
          editableAgentId,
          new Date(now.getTime() + 1_000),
        ),
      ).resolves.toMatchObject({
        summary: "Updated summary",
        avatar: { kind: "icon", value: "palette", foregroundColor: "#3048F5" },
        visibility: "workspace",
        version: 2,
        profile: { id: secondRevisionId, revision: 2 },
        boundSkills: [
          { id: skillDefinitionId, workspaceAvailability: "available" },
        ],
      });
    });

    it("soft deletes and restores managed resources while preserving bindings and gating new work", async () => {
      const hub = createAgentHubStore(pool);
      const editableId = id(9_100_060);
      let ordinal = 9_100_100;
      const change = async (
        kind: "agent" | "skill",
        subjectId: string,
        state: "enabled" | "disabled" | "deleted",
      ) => {
        const current = (
          await hub.listResourceStates(authority, kind, now)
        ).find((item) => item.id === subjectId)!;
        await hub.changeResourceState({
          authority,
          subjectKind: kind,
          subjectId,
          state,
          expectedVersion: current.version,
          now: new Date(now.getTime() + 5000),
          audit: {
            auditEventId: id(ordinal++),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digest("f"),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        });
      };
      await change("skill", skillDefinitionId, "disabled");
      const foundation = createAgentFoundationStore(pool);
      expect(
        (
          await foundation.resolveSurfaceView({
            authority,
            surfaceKind: "workspace_home",
            now,
          })
        )?.skills,
      ).toEqual([]);
      expect(
        (
          await foundation.resolveSurfaceView({
            authority,
            surfaceKind: "workspace_home",
            profileRevisionId,
            skillRevisionIds: [skillRevisionId],
            now,
          })
        )?.skills[0]?.skillRevisionId,
      ).toBe(skillRevisionId);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await expect(
          assertResourceAdmission(connection, workspaceId, editableId, [
            skillRevisionId,
          ]),
        ).rejects.toThrow("resource_lifecycle.unavailable");
        await connection.rollback();
      } finally {
        connection.release();
      }
      await change("agent", editableId, "disabled");
      await expect(change("agent", editableId, "enabled")).rejects.toThrow(
        "resource_lifecycle.dependencies_unavailable",
      );
      await change("skill", skillDefinitionId, "deleted");
      expect(
        (await hub.listSkills(authority, now)).some(
          (item) => item.id === skillDefinitionId,
        ),
      ).toBe(false);
      expect(
        (await hub.getAgent(authority, editableId, now))?.boundSkills[0]?.id,
      ).toBe(skillDefinitionId);
      await expect(
        change("skill", skillDefinitionId, "enabled"),
      ).rejects.toThrow("resource_lifecycle.restore_disabled");
      await change("skill", skillDefinitionId, "disabled");
      expect(
        (await hub.listResourceStates(authority, "skill", now)).find(
          (item) => item.id === skillDefinitionId,
        )?.state,
      ).toBe("disabled");
      await change("skill", skillDefinitionId, "enabled");
      await change("agent", editableId, "deleted");
      expect(await hub.getAgent(authority, editableId, now)).toBeUndefined();
      await change("agent", editableId, "disabled");
      expect(
        (await hub.getAgent(authority, editableId, now))?.resourceState,
      ).toBe("disabled");
      await change("agent", editableId, "enabled");
    });

    it("discovers and revokes a Workspace-defined Skill without code changes", async () => {
      const store = createAgentFoundationStore(pool);
      await expect(
        store.resolveSurfaceView({
          authority,
          surfaceKind: "workspace_home",
          now,
        }),
      ).resolves.toMatchObject({
        profile: {
          id: profileRevisionId,
          profileKey: "workspace-profile-from-data",
        },
        skills: [
          {
            skillRevisionId,
            skillKey: "workspace-defined.unknown-at-compile-time",
            displayName: "Runtime-discovered campaign builder",
            instructionResource: {
              resourcePath: "SKILL.md",
              storedObjectId,
            },
            entrypoints: [
              {
                entrypointKey: "prepare",
                workflowRevisionId,
                displayName: "Prepare campaign",
              },
            ],
          },
        ],
      });
      await expect(
        store.resolveSurfaceView({
          authority,
          surfaceKind: "brand",
          now,
        }),
      ).resolves.toBeUndefined();

      await pool.execute(
        `UPDATE skill_revision_activation
         SET runtime_status = 'disabled', version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND skill_revision_id = ?`,
        [new Date(now.getTime() + 1_000), workspaceId, skillRevisionId],
      );
      const disabled = await store.resolveSurfaceView({
        authority,
        surfaceKind: "workspace_home",
        now: new Date(now.getTime() + 2_000),
      });
      expect(disabled?.skills).toEqual([]);
    });

    it("projects the effective Workflow input schema into Agent ToolView", async () => {
      await pool.execute(
        `UPDATE skill_revision_activation
         SET runtime_status = 'enabled', version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND skill_revision_id = ?`,
        [new Date(now.getTime() + 3_000), workspaceId, skillRevisionId],
      );
      const projectInTransaction = vi.fn(() =>
        Promise.resolve({
          schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
          availability: "available" as const,
          controlledParameterKeys: ["background"],
          validationSchema: {
            schemaVersion:
              "kanvas.effective-invocation-validation-schema/v1" as const,
            document: JSON.stringify({
              type: "object",
              additionalProperties: false,
              required: ["brief"],
              properties: { brief: { type: "string" } },
            }),
          },
          fields: [
            {
              key: "brief",
              label: "Brief",
              required: true,
              valueType: "string" as const,
              maxLength: 8_000,
            },
          ],
        }),
      );
      const store = createAgentFoundationStore(pool, {
        effectiveInvocationSchemas: { projectInTransaction },
      });

      const view = await store.resolveSurfaceView({
        authority,
        surfaceKind: "workspace_home",
        now,
      });

      expect(view?.skills[0]?.entrypoints[0]?.inputSchema).toEqual({
        type: "object",
        additionalProperties: false,
        required: ["brief"],
        properties: {
          brief: {
            title: "Brief",
            type: "string",
            minLength: 1,
            maxLength: 8_000,
          },
        },
      });
      expect(projectInTransaction).toHaveBeenCalledOnce();

      const unavailableStore = createAgentFoundationStore(pool, {
        effectiveInvocationSchemas: {
          projectInTransaction: () =>
            Promise.resolve({
              schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
              availability: "unavailable" as const,
              reason: "budget_unavailable" as const,
              controlledParameterKeys: [],
            }),
        },
      });
      const unavailableView = await unavailableStore.resolveSurfaceView({
        authority,
        surfaceKind: "workspace_home",
        now,
      });
      expect(unavailableView?.skills[0]?.entrypoints).toEqual([]);
      expect(
        unavailableView?.skills[0]?.unavailableEntrypoints?.[0],
      ).toMatchObject({
        entrypointKey: "prepare",
        reason: "budget_unavailable",
      });
    });

    it("keeps a pinned Skill usable while new Runs remain latest-only", async () => {
      const nextCandidateId = id(9_100_090);
      const nextSkillRevisionId = id(9_100_091);
      const nextTime = new Date(now.getTime() + 4_000);
      await pool.execute(
        `INSERT INTO publication_candidate (
           id, workspace_id, subject_kind, subject_key, source_draft_id,
           source_draft_version, schema_version, content_document,
           canonical_digest, parser_profile_version,
           created_by_principal_id, created_at
         ) VALUES (?, ?, 'skill', 'workspace-defined-unknown-skill', ?, 1, 1,
                   ?, ?, 'agent-foundation-v1', ?, ?)`,
        [
          nextCandidateId,
          workspaceId,
          id(9_100_092),
          JSON.stringify({ schemaVersion: 1 }),
          digest("4"),
          principalId,
          nextTime,
        ],
      );
      await pool.execute(
        `INSERT INTO skill_revision (
           id, workspace_id, skill_definition_id, skill_key, revision,
           lifecycle_status, publication_candidate_id, schema_version,
           manifest_document, canonical_digest, package_digest,
           parser_profile_version, created_by_principal_id,
           published_by_principal_id, created_at, published_at
         )
         SELECT ?, workspace_id, skill_definition_id, skill_key, 2,
                'published', ?, schema_version, manifest_document, ?, ?,
                parser_profile_version, ?, ?, ?, ?
           FROM skill_revision
          WHERE workspace_id = ? AND id = ?`,
        [
          nextSkillRevisionId,
          nextCandidateId,
          digest("5"),
          digest("6"),
          principalId,
          principalId,
          nextTime,
          nextTime,
          workspaceId,
          skillRevisionId,
        ],
      );
      await pool.execute(
        `INSERT INTO skill_revision_activation (
           workspace_id, skill_revision_id, runtime_status, reason_code,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, 'enabled', NULL, 1, ?, ?)`,
        [workspaceId, nextSkillRevisionId, principalId, nextTime],
      );
      await pool.execute(
        `INSERT INTO skill_revision_resource (
           skill_revision_id, workspace_id, resource_path, resource_kind,
           stored_object_id, content_digest, media_type, byte_size, ordinal
         ) VALUES (?, ?, 'SKILL.md', 'instructions', ?, ?,
                   'text/markdown', 128, 0)`,
        [nextSkillRevisionId, workspaceId, storedObjectId, digest("7")],
      );
      const foundation = createAgentFoundationStore(pool);
      expect(
        (
          await foundation.resolveSurfaceView({
            authority,
            surfaceKind: "workspace_home",
            now: nextTime,
          })
        )?.skills[0]?.skillRevisionId,
      ).toBe(nextSkillRevisionId);
      await expect(
        foundation.assertSkillUsable({
          authority,
          skillRevisionId,
          now: nextTime,
        }),
      ).resolves.toBeUndefined();
      await pool.execute(
        `UPDATE skill_revision_activation
            SET runtime_status = 'revoked', reason_code = 'owner.revoked',
                version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND skill_revision_id = ?`,
        [
          new Date(nextTime.getTime() + 1_000),
          workspaceId,
          nextSkillRevisionId,
        ],
      );

      expect(
        (
          await foundation.resolveSurfaceView({
            authority,
            surfaceKind: "workspace_home",
            now: nextTime,
          })
        )?.skills,
      ).toEqual([]);
      expect(
        (
          await foundation.resolveSurfaceView({
            authority,
            surfaceKind: "workspace_home",
            profileRevisionId,
            skillRevisionIds: [skillRevisionId],
            now: nextTime,
          })
        )?.skills[0]?.skillRevisionId,
      ).toBe(skillRevisionId);
      await expect(
        foundation.assertSkillUsable({
          authority,
          skillRevisionId,
          now: nextTime,
        }),
      ).resolves.toBeUndefined();

      const hub = createAgentHubStore(pool);
      await expect(hub.listSkills(authority, nextTime)).resolves.toEqual([
        expect.objectContaining({
          id: skillDefinitionId,
          skillRevisionId: nextSkillRevisionId,
          runtimeStatus: "revoked",
        }),
      ]);
      await expect(
        hub.getAgent(authority, id(9_100_060), nextTime),
      ).resolves.toMatchObject({
        boundSkills: [
          {
            id: skillDefinitionId,
            workspaceAvailability: "revoked",
          },
        ],
      });
      const sharedAgent = await hub.getAgent(
        authority,
        id(9_100_060),
        nextTime,
      );
      expect(sharedAgent).toBeDefined();
      if (!sharedAgent) throw new Error("Expected the shared Agent fixture.");
      const publications = createAgentProfilePublicationStore(pool);
      await expect(
        publications.publish({
          authority,
          agentDefinitionId: sharedAgent.id,
          profileRevisionId: id(9_100_093),
          managementKind: "workspace",
          expectedAgentVersion: sharedAgent.version,
          visibility: "workspace",
          presentation: {
            displayName: sharedAgent.displayName,
            summary: sharedAgent.summary,
            ...(sharedAgent.avatar ? { avatar: sharedAgent.avatar } : {}),
            tags: sharedAgent.tags,
          },
          boundSkillDefinitionIds: [skillDefinitionId],
          profile: {
            profileKey: sharedAgent.profile.profileKey,
            revision: sharedAgent.profile.revision + 1,
            surfaceBindings: [],
            manifest: sharedAgent.profile.manifest,
          },
          now: nextTime,
          audit: {
            auditEventId: id(9_100_094),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digest("8"),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).rejects.toMatchObject({
        code: "agent_profile_publication.skill_unavailable",
      });

      await pool.execute(
        `UPDATE skill_revision_activation
            SET runtime_status = 'revoked', reason_code = 'owner.revoked',
                version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND skill_revision_id = ?`,
        [new Date(nextTime.getTime() + 2_000), workspaceId, skillRevisionId],
      );
      await expect(
        foundation.assertSkillUsable({
          authority,
          skillRevisionId,
          now: nextTime,
        }),
      ).rejects.toMatchObject({
        code: "agent.foundation_invalid_argument",
      });
    });
  },
);
