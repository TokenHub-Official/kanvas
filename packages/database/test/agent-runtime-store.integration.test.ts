import { createAgentLibraryStore } from "../src/runtime/agent-library-store.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
import { createAgentHubStore } from "../src/runtime/agent-hub-store.js";
import {
  agentVisibleMessageText,
  authorizationModelVersion,
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { createAgentRuntimeStore } from "../src/runtime/agent-runtime-store.js";
import { createAgentRunDispatchStore } from "../src/runtime/agent-run-dispatch-store.js";
import { createAgentModelBindingStore } from "../src/runtime/agent-model-binding-store.js";
import { createBudgetReservationStore } from "../src/runtime/budget-reservation-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled = process.env.KANVAS_DATABASE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-08-24T12:00:00.000Z");
const organizationId = id(8_200_001);
const workspaceId = id(8_200_002);
const principalId = id(8_200_003);
const membershipId = id(8_200_004);
const threadId = id(8_200_005);
const runId = id(8_200_006);
const userMessageId = id(8_200_007);
const assistantMessageId = id(8_200_008);
const modelCallId = id(8_200_009);
const modelAttemptId = id(8_200_010);
const profileRevisionId = id(8_200_012);
const agentDefinitionId = id(8_200_053);
const actionReceiptId = id(8_200_013);
const providerEndpointId = id(8_200_014);
const modelProfileRevisionId = id(8_200_015);
const canonicalModelId = id(8_200_046);
const modelDeploymentId = id(8_200_016);
const pricingRevisionId = id(8_200_017);
const budgetAccountId = id(8_200_018);
const budgetReservationId = id(8_200_019);
const credentialId = id(8_200_024);
const secretVersionId = id(8_200_025);
const agentModelBindingId = id(8_200_026);
const branchRunId = id(8_200_027);
const branchAssistantMessageId = id(8_200_028);
const retryRunId = id(8_200_029);
const cancelThreadId = id(8_200_030);
const cancelRunId = id(8_200_031);
const cancelUserMessageId = id(8_200_032);
const declineThreadId = id(8_200_040);
const declineRunId = id(8_200_041);
const declineUserMessageId = id(8_200_042);
const declineActionReceiptId = id(8_200_043);
const continuedRunId = id(8_200_044);
const continuedUserMessageId = id(8_200_045);
const orphanThreadId = id(8_200_047);
const orphanRunId = id(8_200_048);
const orphanUserMessageId = id(8_200_049);
const orphanModelCallId = id(8_200_050);
const orphanModelAttemptId = id(8_200_051);
const orphanBudgetReservationId = id(8_200_052);
const interactionThreadId = id(8_200_060);
const interactionRunId = id(8_200_061);
const interactionUserMessageId = id(8_200_062);
const interactionAssistantMessageId = id(8_200_063);
const interactionId = id(8_200_064);
const digest =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const foundationContext = {
  schemaVersion: 1,
  profileRevisionId,
  profileCanonicalDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  skillViewDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  skills: [],
} as const;

const authority = Object.freeze({
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: id(8_200_011),
  authorityType: "human_membership",
  authorityId: membershipId,
  authorityVersion: 1,
  authorizationModelVersion,
  effectivePermissions: permissionsForWorkspaceRole("admin"),
  trusted: true,
} as const satisfies TrustedWorkspaceScope);

interface AgentFactCountRow extends RowDataPacket {
  readonly messageCount: number;
  readonly callCount: number;
  readonly attemptCount: number;
  readonly actionCount: number;
  readonly usageInputTokens: number;
  readonly usageOutputTokens: number;
}

interface RevokedRunRow extends RowDataPacket {
  readonly lifecycleStatus: string;
  readonly terminalReasonCode: string | null;
  readonly deliveryStatus: string;
}

function credentialLockUpgradeBarrierPool(pool: Pool): Pool {
  let sharedBindingLocks = 0;
  let releaseSharedBindingLocks!: () => void;
  const bothSharedBindingLocksHeld = new Promise<void>((resolve) => {
    releaseSharedBindingLocks = resolve;
  });

  return {
    getConnection: async () => {
      const connection = await pool.getConnection();
      return new Proxy(connection, {
        get(target, property, receiver) {
          if (property === "execute") {
            return async (...args: Parameters<typeof connection.execute>) => {
              const result = await connection.execute(...args);
              const statement: unknown = args[0];
              if (
                typeof statement === "string" &&
                statement.includes("FROM agent_model_binding AS binding") &&
                statement.includes("FOR SHARE")
              ) {
                sharedBindingLocks += 1;
                if (sharedBindingLocks === 2) releaseSharedBindingLocks();
                await bothSharedBindingLocksHeld;
              }
              return result;
            };
          }
          if (property === "beginTransaction") {
            return () => target.beginTransaction();
          }
          if (property === "commit") return () => target.commit();
          if (property === "rollback") return () => target.rollback();
          if (property === "release") return () => target.release();
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    },
  } as unknown as Pool;
}

describe.skipIf(!integrationEnabled)(
  "Agent Runtime Store against a disposable MySQL database",
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
         VALUES (?, 'agent-runtime-integration', ?)`,
        [principalId, now],
      );
      await pool.execute(
        `INSERT INTO organization
           (id, slug, name, status, version, created_at, updated_at)
         VALUES (?, 'agent-runtime-integration', 'Agent Runtime Integration',
                 'active', 1, ?, ?)`,
        [organizationId, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace
           (id, organization_id, slug, name, status, version,
            created_at, updated_at)
         VALUES (?, ?, 'agent-runtime-integration', 'Agent Runtime Integration',
                 'active', 1, ?, ?)`,
        [workspaceId, organizationId, now, now],
      );
      await pool.execute(
        `INSERT INTO workspace_membership
           (id, organization_id, workspace_id, principal_id, role, status,
            version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
        [membershipId, organizationId, workspaceId, principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO agent_definition (
           id, workspace_id, agent_key, owner_principal_id, visibility,
           lifecycle_status, creation_request_key, creation_request_hash,
           version, created_by_principal_id, updated_by_principal_id,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, 'agent-runtime-integration', ?, 'workspace',
                   'active', 'agent-runtime-integration', ?, 1, ?, ?, ?, ?, NULL)`,
        [
          agentDefinitionId,
          workspaceId,
          principalId,
          digest,
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
         ) VALUES (?, ?, 'Agent Runtime Integration', 'Runtime test Agent',
                   NULL, NULL, '[]',
                   1, ?, ?, ?)`,
        [workspaceId, agentDefinitionId, principalId, now, now],
      );
      await pool.execute(
        `INSERT INTO agent_profile_revision (
           id, workspace_id, agent_definition_id, profile_key, revision,
           lifecycle_status,
           schema_version, manifest_document, canonical_digest,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, 'agent-runtime-integration', 1, 'published', 1,
                   ?, ?, ?, ?, ?, ?)`,
        [
          profileRevisionId,
          workspaceId,
          agentDefinitionId,
          JSON.stringify({
            schemaVersion: 1,
            displayName: "Agent Runtime Integration",
            modelBindingKey: "legacy-agent-budget-model",
            instructions:
              "Use only the pinned Profile and Skill context for the current Agent Run.",
            allowedSurfaceKinds: ["workspace_home"],
            allowedToolFamilies: [],
            requiredToolFamilies: [],
            skillPolicy: {
              maximumCatalogItems: 10,
              maximumActivatedInstructionBytes: 262_144,
              maximumReferenceReadBytes: 262_144,
            },
            runLimits: {
              maximumModelCalls: 1,
              maximumToolCalls: 1,
              timeoutSeconds: 120,
            },
          }),
          foundationContext.profileCanonicalDigest,
          principalId,
          principalId,
          now,
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
         ) VALUES (?, ?, 'agent-budget-endpoint', 'openai_compatible',
                   'tokenhub', 'https://agent-budget.example/v1',
                   'https://agent-budget.example', ?, 'global', '{}', '{}',
                   'active', 'passed', ?, ?, 1, ?, ?, ?)`,
        [
          providerEndpointId,
          workspaceId,
          digestProviderValue({ baseUrl: "https://agent-budget.example/v1" }),
          digestProviderValue({ validation: "passed" }),
          now,
          principalId,
          now,
          now,
        ],
      );
      const credentialIdentityDigest = digestProviderValue({
        credential: "agent-budget-credential",
      });
      await pool.execute(
        `INSERT INTO credential (
           id, workspace_id, provider_endpoint_id, credential_key,
           provider_kind, authority_digest, billing_identity_digest,
           egress_identity_digest, identity_digest, identity_epoch,
           material_generation, active_secret_version_id, lifecycle_status,
           version, created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'agent-budget-credential', 'openai', ?, ?, ?, ?,
                   1, 1, NULL, 'active', 1, ?, ?, ?)`,
        [
          credentialId,
          workspaceId,
          providerEndpointId,
          digestProviderValue({ authority: "agent-budget" }),
          digestProviderValue({ billing: "agent-budget" }),
          digestProviderValue({ egress: "agent-budget" }),
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
                   'deployment://agent-budget/credential', ?, 1, NULL, ?, ?,
                   NULL, NULL, NULL, ?, ?)`,
        [
          secretVersionId,
          workspaceId,
          credentialId,
          digestProviderValue({ aad: "agent-budget" }),
          digestProviderValue({ material: "agent-budget" }),
          now,
          now,
          principalId,
          now,
        ],
      );
      await pool.execute(
        `UPDATE credential
         SET active_secret_version_id = ?
         WHERE workspace_id = ? AND id = ?`,
        [secretVersionId, workspaceId, credentialId],
      );
      const modelEvidence = [
        {
          kind: "provider_api",
          reference: "provider.models.text",
          observedAt: now.toISOString(),
          sourceDigest: digestProviderValue({ evidence: "agent-budget" }),
          confidence: "high",
          claim: "supported",
        },
      ];
      const modelProfileDocument = {
        schemaVersion: 1,
        model: {
          slug: "agent-budget-model",
          displayName: "Agent Budget Model",
          family: "agent-budget",
          description: "Agent budget integration test model.",
          inputModalities: ["text"],
          outputModalities: ["text"],
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
          toolCall: true,
        },
        operations: {
          "text.generate": {
            parameters: [],
            evidence: modelEvidence,
          },
        },
        sources: [],
      };
      await pool.execute(
        `INSERT INTO canonical_model (
           id, workspace_id, slug, lifecycle_status, source_kind,
           source_reference, version, created_by_principal_id,
           updated_by_principal_id, created_at, updated_at, activated_at,
           disabled_at, revoked_at
         ) VALUES (?, ?, 'agent-budget-model', 'active', 'manual', NULL, 1,
                   ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          canonicalModelId,
          workspaceId,
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
         ) VALUES (?, ?, ?, 'agent-budget-model', 1, 1, ?, ?, 'published',
                   ?, ?, ?, ?)`,
        [
          modelProfileRevisionId,
          workspaceId,
          canonicalModelId,
          JSON.stringify(modelProfileDocument),
          digestProviderValue(modelProfileDocument),
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO model_deployment (
           id, workspace_id, provider_endpoint_id, model_profile_revision_id,
           deployment_key, provider_model_id, deployment_digest,
           lifecycle_status, version, created_by_principal_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'agent-budget-model', 'agent-budget-model', ?,
                   'active', 1, ?, ?, ?)`,
        [
          modelDeploymentId,
          workspaceId,
          providerEndpointId,
          modelProfileRevisionId,
          digestProviderValue({ deployment: "agent-budget-model" }),
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
         ) VALUES (?, ?, ?, ?, 'agent-budget-usd', 1, 1, 'USD', ?, ?,
                   'published', 'contract', ?, ?, ?, ?, ?, ?)`,
        [
          pricingRevisionId,
          workspaceId,
          providerEndpointId,
          modelDeploymentId,
          JSON.stringify({
            schemaVersion: 1,
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
            evidence: {
              priceVerified: true,
              sourceKind: "provider_api",
              sourceReference: "provider.billing.response",
              observedAt: now.toISOString(),
              sourceDigest: digestProviderValue({ pricing: "agent-budget" }),
            },
          }),
          digestProviderValue({
            schemaVersion: 1,
            billingMode: "fixed",
            fixedChargeAmount: "0.25",
            evidence: {
              priceVerified: true,
              sourceKind: "provider_api",
              sourceReference: "provider.billing.response",
              observedAt: now.toISOString(),
              sourceDigest: digestProviderValue({ pricing: "agent-budget" }),
            },
          }),
          now,
          now,
          principalId,
          principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        `INSERT INTO budget_account (
           id, workspace_id, account_key, currency_code, period_start_at,
           period_end_at, hard_limit_amount, consumed_amount, reserved_amount,
           unknown_held_amount, lifecycle_status, version,
           created_by_principal_id, created_at, updated_at
         ) VALUES (?, ?, 'agent-budget-usd', 'USD', ?, ?, 10, 0, 0, 0,
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
      await pool.execute(
        `INSERT INTO workspace_agent_model_settings (
           workspace_id, default_canonical_model_id, fast_canonical_model_id,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, ?, 1, ?, ?)`,
        [workspaceId, canonicalModelId, canonicalModelId, principalId, now],
      );
    });

    afterAll(async () => pool?.end());

    it("persists and replays one governed Agent Run foundation", async () => {
      const bindings = createAgentModelBindingStore(pool);
      await expect(
        bindings.configure({
          authority,
          bindingId: id(8_200_047),
          bindingKey: "agent-budget-model-invalid-surface",
          modelProfileRevisionId,
          modelDeploymentId,
          providerEndpointId,
          credentialId,
          pricingRevisionId,
          budgetAccountId,
          apiSurface: "responses.v1",
          protocolKind: "openai_chat",
          maximumCharge: { currencyCode: "USD", amount: "1" },
          idempotencyKey: "agent-model-binding-invalid-surface",
          now,
          audit: {
            auditEventId: id(8_200_048),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digestProviderValue({ session: "agent" }),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).rejects.toThrow("Agent Model protocol does not match its API surface.");
      const configuredBinding = await bindings.configure({
        authority,
        bindingId: agentModelBindingId,
        bindingKey: "agent-budget-model",
        modelProfileRevisionId,
        modelDeploymentId,
        providerEndpointId,
        credentialId,
        pricingRevisionId,
        budgetAccountId,
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
        maximumCharge: { currencyCode: "USD", amount: "1" },
        idempotencyKey: "agent-model-binding-integration-1",
        now,
        audit: {
          auditEventId: id(8_200_027),
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({ session: "agent" }),
          authorityType: "human_membership",
          authorityId: membershipId,
          authorityVersion: 1,
        },
      });
      expect(configuredBinding).toMatchObject({
        id: agentModelBindingId,
        bindingKey: "agent-budget-model",
        lifecycleStatus: "enabled",
        maximumCharge: { currencyCode: "USD", amount: "1" },
      });
      const instanceId = "agent-governance-integration";
      await pool.execute(
        "INSERT INTO instance_runtime_state (instance_id,state,execution_generation,state_version,reason,changed_by,changed_at) VALUES (?,'ACTIVE',1,1,'test','test',?)",
        [instanceId, now],
      );
      const store = createAgentRuntimeStore(pool, { instanceId });
      await store.createThread({
        authority,
        threadId,
        agentDefinitionId,
        agentProfileRevisionId: profileRevisionId,
        title: "Summer poster",
        idempotencyKey: "agent-thread-integration-1",
        now,
      });
      const observations =
        "* 🔴 User requires a summer promotion poster for the current Thread.";
      await expect(
        store.saveThreadMemory({
          authority,
          threadId,
          activeObservations: observations,
          observationsDigest: digestProviderValue(observations),
          lastObservedAt: now,
          observerModelBindingKey: "agent-budget-model",
          now,
        }),
      ).resolves.toMatchObject({
        threadId,
        activeObservations: observations,
        version: 1,
      });
      await expect(
        store.getThreadMemory(authority, threadId, now),
      ).resolves.toMatchObject({
        observationsDigest: digestProviderValue(observations),
        observerModelBindingKey: "agent-budget-model",
      });
      const selectedLibraryId = id(8_900_100);
      const selectedLibraryRevisionId = id(8_900_101);
      await createResourceLibraryStore(pool).save({
        authority,
        libraryId: selectedLibraryId,
        revisionId: selectedLibraryRevisionId,
        expectedVersion: 0,
        requestKey: "explicit-run-library",
        document: {
          schemaVersion: 1,
          name: "Explicit task references",
          description: "",
          entries: [],
        },
        audit: { auditEventId: id(8_900_102), authenticationRefHash: digest },
        now,
      });
      await store.startRun({
        authority,
        runId,
        threadId,
        userMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [{ type: "text", text: "用商品图做一张夏季促销海报" }],
        },
        contextSnapshot: {
          schemaVersion: 1,
          surfaceKind: "workspace_home",
          selectedLibraryIds: [selectedLibraryId],
        },
        toolViewDigest: digest,
        promptRevision: "home-shadow-plan-v1",
        maximumModelCalls: 1,
        maximumToolCalls: 1,
        foundationContext,
        executionDeadlineAt: new Date(now.getTime() + 120_000),
        idempotencyKey: "agent-plan-integration-1",
        now,
      });
      const [libraryPins] = await pool.execute<RowDataPacket[]>(
        "SELECT revision_id AS revisionId, source FROM agent_run_library WHERE workspace_id = ? AND run_id = ?",
        [workspaceId, runId],
      );
      expect(libraryPins).toMatchObject([
        { revisionId: selectedLibraryRevisionId, source: "explicit" },
      ]);
      const lifecycle = createAgentHubStore(pool);
      const lifecycleCommand = {
        authority,
        subjectKind: "agent" as const,
        subjectId: agentDefinitionId,
        expectedVersion: 1,
        now,
        audit: {
          auditEventId: id(9_900_100),
          actorPrincipalId: principalId,
          actorType: "human" as const,
          authenticationRefType: "session" as const,
          authenticationRefHash: digest,
          authorityType: "human_membership" as const,
          authorityId: membershipId,
          authorityVersion: 1,
        },
      };
      await expect(
        lifecycle.changeResourceState({
          ...lifecycleCommand,
          state: "deleted",
        }),
      ).rejects.toThrow("resource_lifecycle.run_active");
      await lifecycle.changeResourceState({
        ...lifecycleCommand,
        state: "disabled",
      });
      await expect(
        store.createThread({
          authority,
          threadId: id(9_900_101),
          agentDefinitionId,
          agentProfileRevisionId: profileRevisionId,
          idempotencyKey: "disabled-agent-thread",
          now,
        }),
      ).rejects.toThrow("resource_lifecycle.unavailable");
      const dispatch = createAgentRunDispatchStore(pool, store);
      const claimTokenDigest = digestProviderValue({ claim: "agent-run-1" });
      const claim = await dispatch.claimNext({
        workerId: "agent-worker-integration",
        claimTokenDigest,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        now,
      });
      expect(claim).toMatchObject({
        modelBindingKey: "agent-budget-model",
        fastModelBindingKey: "agent-budget-model",
        modelControls: {
          reasoningLevel: "medium",
          webSearchMode: "off",
        },
        run: { id: runId, lifecycleStatus: "running" },
        authority: { principalId, authorityId: membershipId },
      });
      if (!claim) throw new Error("Agent Run dispatch was not claimed.");
      await lifecycle.changeResourceState({
        ...lifecycleCommand,
        state: "enabled",
        expectedVersion: 2,
        audit: { ...lifecycleCommand.audit, auditEventId: id(9_900_102) },
      });
      const concurrentBindings = createAgentModelBindingStore(
        credentialLockUpgradeBarrierPool(pool),
      );
      await expect(
        Promise.all([
          concurrentBindings.resolve({
            authority,
            agentRunId: runId,
            bindingKey: "agent-budget-model",
            now,
          }),
          concurrentBindings.resolve({
            authority,
            agentRunId: runId,
            bindingKey: "agent-budget-model",
            now,
          }),
        ]),
      ).resolves.toEqual([
        expect.objectContaining({ providerModelId: "agent-budget-model" }),
        expect.objectContaining({ providerModelId: "agent-budget-model" }),
      ]);
      const running = claim.run;
      await dispatch.heartbeat({
        workerId: claim.workerId,
        claimTokenDigest,
        agentRunId: runId,
        leaseExpiresAt: new Date(now.getTime() + 90_000),
        now: new Date(now.getTime() + 1_000),
      });
      await expect(
        dispatch.claimNext({
          workerId: "agent-worker-other",
          claimTokenDigest: digestProviderValue({ claim: "other" }),
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          now: new Date(now.getTime() + 2_000),
        }),
      ).resolves.toBeUndefined();
      await expect(
        bindings.resolve({
          authority,
          agentRunId: runId,
          bindingKey: "agent-budget-model",
          now,
        }),
      ).resolves.toMatchObject({
        providerModelId: "agent-budget-model",
        budgetAccountId,
        maximumCharge: { currencyCode: "USD", amount: "1" },
      });
      await store.beginModelCall({
        authority,
        agentRunId: runId,
        modelCallId,
        callNumber: 1,
        purpose: "plan",
        modelProfileKey: "deterministic-shadow-v1",
        inputDigest: digest,
        now,
      });
      const budgets = createBudgetReservationStore(pool);
      const agentBudgetRequestDigest = digestProviderValue({
        agentModelCallId: modelCallId,
        maximumChargeAmount: "1",
      });
      await expect(
        budgets.reserve({
          reservationId: budgetReservationId,
          ledgerEntryId: id(8_200_020),
          workspaceId,
          budgetAccountId,
          reservationKey: "agent-model-call-1",
          requestDigest: agentBudgetRequestDigest,
          consumerKind: "agent_model_call",
          agentRunId: runId,
          agentModelCallId: modelCallId,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "1",
          expiresAt: new Date(now.getTime() + 60_000),
          now,
          audit: {
            auditEventId: id(8_200_021),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digestProviderValue({ session: "agent" }),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).resolves.toMatchObject({ status: "reserved", reservedAmount: "1" });
      await store.startModelAttempt({
        authority,
        agentRunId: runId,
        modelCallId,
        attemptId: modelAttemptId,
        attemptNumber: 1,
        transitionKind: "initial",
        routeSnapshot: {
          schemaVersion: 1,
          kind: "deterministic_shadow",
        },
        now,
      });
      await store.completeModelAttempt({
        authority,
        agentRunId: runId,
        modelCallId,
        attemptId: modelAttemptId,
        status: "succeeded",
        outputDigest: digest,
        finishReason: "stop",
        usageDocument: {
          schemaVersion: 1,
          inputTokens: 0,
          outputTokens: 0,
        },
        now,
      });
      await expect(
        budgets.finalize({
          workspaceId,
          budgetAccountId,
          reservationId: budgetReservationId,
          ledgerEntryId: id(8_200_022),
          ledgerEntryKey: `consume:${budgetReservationId}`,
          requestDigest: agentBudgetRequestDigest,
          kind: "capture",
          capturedAmount: "0.25",
          now,
          audit: {
            auditEventId: id(8_200_023),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digestProviderValue({ session: "agent" }),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "settled",
        settledAmount: "0.25",
      });
      const proposed = await store.proposeAction({
        authority,
        agentRunId: runId,
        actionReceiptId,
        actionNumber: 1,
        toolCallId: "tool-call-integration-1",
        toolKey: "workflow.propose.entrypoint-1",
        effect: "compute",
        approvalMode: "before_commit",
        inputDigest: digest,
        now,
      });
      const executing = await store.transitionAction({
        authority,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: proposed.version,
        toStatus: "running",
        now,
      });
      const proposalDocument = {
        schemaVersion: 1,
        actionRef: "workflow-entrypoint-1",
        skillRevisionId: profileRevisionId,
        entrypointKey: "prepare",
        workflowRevisionId: id(8_200_030),
        title: "Prepare result",
        description: "Prepare one result through the published Workflow.",
        input: { brief: "Campaign" },
      };
      const previewed = await store.recordActionPreview({
        authority,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: executing.version,
        outputDigest: digestProviderValue(proposalDocument),
        proposalDocument,
        now,
      });
      const approved = await store.transitionAction({
        authority,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: previewed.version,
        toStatus: "running",
        now,
      });
      await store.completeAction({
        authority,
        agentRunId: runId,
        actionReceiptId,
        expectedVersion: approved.version,
        status: "succeeded",
        outputDigest: digest,
        now,
      });
      // The user confirms while the model is still replying: completing the
      // action must not close the Run or invalidate the model writer.
      await expect(
        store.settleRun({ authority, runId, now }),
      ).resolves.toMatchObject({
        lifecycleStatus: "running",
        version: running.version,
      });
      await expect(
        store.settleRun({
          authority,
          runId,
          now,
          workerClaim: { workerId: claim.workerId, claimTokenDigest },
        }),
      ).rejects.toMatchObject({ code: "agent.state_conflict" });
      const assistantMessage = {
        schemaVersion: 1,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: JSON.stringify({
              summary: "根据商品图和品牌信息准备一张促销海报。",
              missingInformation: ["促销标题"],
              recommendedCandidateKeys: ["poster.simple"],
              warnings: ["本次不会启动制作。"],
            }),
          },
        ],
      } as const;
      const modelMessages = {
        schemaVersion: 1,
        adapter: "mastra-message-list-v2",
        messages: [
          {
            id: userMessageId,
            role: "user",
            createdAt: now.toISOString(),
            content: {
              format: 2,
              parts: [{ type: "text", text: "Original model input" }],
            },
          },
          {
            id: "native-skill-result",
            role: "assistant",
            createdAt: now.toISOString(),
            content: {
              format: 2,
              parts: [
                {
                  type: "tool-invocation",
                  toolInvocation: {
                    state: "result",
                    toolCallId: "skill-1",
                    toolName: "skill",
                    args: { name: "poster" },
                    result:
                      "PINNED_REFERENCE: original mascot" +
                      "x".repeat(3_000_000),
                  },
                },
              ],
            },
          },
        ],
      } as const;
      await store.appendAssistantMessage({
        authority,
        agentRunId: runId,
        messageId: assistantMessageId,
        message: assistantMessage,
        modelMessages,
        now,
      });
      const streamedThread = await store.getThread(authority, threadId, now);
      await expect(
        store.appendAssistantMessage({
          authority,
          agentRunId: runId,
          messageId: assistantMessageId,
          message: assistantMessage,
          now,
          workerClaim: {
            workerId: claim.workerId,
            claimTokenDigest: digestProviderValue({ wrong: true }),
          },
        }),
      ).rejects.toMatchObject({ code: "agent.state_conflict" });
      expect(
        (await store.getThread(authority, threadId, now))?.viewRevision,
      ).toBe(streamedThread?.viewRevision);
      const completedAssistantMessage = {
        ...assistantMessage,
        parts: [
          {
            type: "text" as const,
            text: agentVisibleMessageText(assistantMessage).replace(
              "本次不会启动制作。",
              `${"完整方案内容。".repeat(1500)}END-OF-RESPONSE`,
            ),
          },
        ],
      };
      await store.appendAssistantMessage({
        authority,
        agentRunId: runId,
        messageId: assistantMessageId,
        message: completedAssistantMessage,
        workerClaim: { workerId: claim.workerId, claimTokenDigest },
        now,
      });
      await expect(
        store.saveThreadMemory({
          authority,
          threadId,
          activeObservations: observations,
          observationsDigest: digestProviderValue(observations),
          lastObservedAt: now,
          observerModelBindingKey: "agent-budget-model",
          sourceMessageId: assistantMessageId,
          now,
        }),
      ).resolves.toMatchObject({ sourceMessageId: assistantMessageId });
      await expect(
        store.getThreadMemory(authority, threadId, now),
      ).resolves.toMatchObject({ sourceMessageId: assistantMessageId });
      await expect(
        store.saveThreadMemory({
          authority,
          threadId,
          activeObservations: observations,
          observationsDigest: digestProviderValue(observations),
          lastObservedAt: now,
          observerModelBindingKey: "agent-budget-model",
          sourceMessageId: "01K0000000000000000000ZZZ",
          now,
        }),
      ).rejects.toMatchObject({ code: "agent.invalid_argument" });
      const updatedThread = await store.getThread(authority, threadId, now);
      expect(updatedThread?.version).toBe(streamedThread?.version);
      expect(updatedThread?.viewRevision).toBeGreaterThan(
        streamedThread?.viewRevision ?? 0,
      );
      await expect(
        store.settleRun({
          authority,
          runId,
          now,
          workerClaim: { workerId: claim.workerId, claimTokenDigest },
        }),
      ).resolves.toMatchObject({ lifecycleStatus: "succeeded" });
      await expect(
        store.getAssistantMessage(authority, runId, now),
      ).resolves.toEqual(completedAssistantMessage);
      const auxiliaryClaim = { workerId: claim.workerId, claimTokenDigest };
      const memoryPublication = {
        authority,
        agentRunId: runId,
        threadId,
        workerClaim: auxiliaryClaim,
        activeObservations: observations,
        observationsDigest: digestProviderValue(observations),
        sourceMessageId: assistantMessageId,
        lastObservedAt: now,
        observerModelBindingKey: "agent-budget-model",
        now,
      };
      await expect(
        store.saveThreadMemory({
          ...memoryPublication,
          workerClaim: {
            ...auxiliaryClaim,
            claimTokenDigest: digestProviderValue("old-worker"),
          },
        }),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      await expect(
        store.saveThreadMemory(memoryPublication),
      ).resolves.toMatchObject({ sourceMessageId: assistantMessageId });

      const auxiliaryCall = {
        authority,
        agentRunId: runId,
        modelCallId: id(8_400_001),
        callNumber: 2,
        purpose: "memory_observation" as const,
        modelProfileKey: "deterministic-shadow-v1",
        inputDigest: digest,
        now,
      };
      await expect(store.beginModelCall(auxiliaryCall)).rejects.toMatchObject({
        code: "agent.run_inactive",
      });
      await expect(
        store.beginModelCall({
          ...auxiliaryCall,
          purpose: "plan",
          workerClaim: auxiliaryClaim,
        }),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      await store.beginModelCall({
        ...auxiliaryCall,
        workerClaim: auxiliaryClaim,
      });
      const auxiliaryRoute = await bindings.resolve({
        authority,
        agentRunId: runId,
        bindingKey: "agent-budget-model",
        purpose: "memory_observation",
        workerClaim: auxiliaryClaim,
        now,
      });
      await store.startModelAttempt({
        authority,
        agentRunId: runId,
        modelCallId: auxiliaryCall.modelCallId,
        attemptId: id(8_400_002),
        attemptNumber: 1,
        transitionKind: "initial",
        routeSnapshot: auxiliaryRoute.snapshot,
        workerClaim: auxiliaryClaim,
        now,
      });
      const auxiliaryAudit = {
        auditEventId: id(8_400_003),
        actorPrincipalId: principalId,
        actorType: "human" as const,
        authenticationRefType: "session" as const,
        authenticationRefHash: digestProviderValue({ session: "agent" }),
        authorityType: "human_membership" as const,
        authorityId: membershipId,
        authorityVersion: 1,
      };
      await expect(
        budgets.reserve({
          consumerKind: "agent_model_call",
          agentRunId: runId,
          agentModelCallId: auxiliaryCall.modelCallId,
          workerClaim: auxiliaryClaim,
          reservationId: id(8_400_004),
          ledgerEntryId: id(8_400_005),
          workspaceId,
          budgetAccountId,
          reservationKey: "auxiliary-after-success",
          requestDigest: digest,
          pricingRevisionId,
          currencyCode: "USD",
          maximumChargeAmount: "1",
          expiresAt: new Date(now.getTime() + 60000),
          audit: auxiliaryAudit,
          now,
        }),
      ).resolves.toMatchObject({ status: "reserved" });
      await store.completeModelAttempt({
        authority,
        agentRunId: runId,
        modelCallId: auxiliaryCall.modelCallId,
        attemptId: id(8_400_002),
        status: "succeeded",
        outputDigest: digest,
        finishReason: "stop",
        now,
      });
      await budgets.finalize({
        workspaceId,
        budgetAccountId,
        reservationId: id(8_400_004),
        ledgerEntryId: id(8_400_006),
        ledgerEntryKey: "auxiliary-after-success-release",
        requestDigest: digest,
        kind: "release",
        now,
        audit: { ...auxiliaryAudit, auditEventId: id(8_400_007) },
      });
      await dispatch.complete({
        workerId: claim.workerId,
        claimTokenDigest,
        agentRunId: runId,
        now,
      });
      await expect(
        store.beginModelCall({
          ...auxiliaryCall,
          modelCallId: id(8_400_008),
          callNumber: 3,
          workerClaim: auxiliaryClaim,
        }),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      await expect(
        bindings.resolve({
          authority,
          agentRunId: runId,
          bindingKey: "agent-budget-model",
          purpose: "memory_observation",
          workerClaim: auxiliaryClaim,
          now,
        }),
      ).rejects.toMatchObject({ code: "agent_model_binding.unavailable" });

      const memoryAfterRelease = await store.getThreadMemory(
        authority,
        threadId,
        now,
      );
      await expect(
        store.saveThreadMemory(memoryPublication),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      expect(await store.getThreadMemory(authority, threadId, now)).toEqual(
        memoryAfterRelease,
      );

      const autoNamed = await store.autoRenameThread({
        authority,
        threadId,
        title: "夏日促销海报方案",
        now,
      });
      expect(autoNamed).toMatchObject({
        title: "夏日促销海报方案",
        titleSource: "auto",
      });
      const manuallyNamed = await store.renameThread({
        authority,
        threadId,
        expectedVersion: autoNamed.version,
        title: "用户指定的会话名称",
        now,
      });
      await expect(
        store.autoRenameThread({
          authority,
          threadId,
          title: "迟到的自动名称",
          now,
        }),
      ).resolves.toMatchObject({
        title: "用户指定的会话名称",
        titleSource: "manual",
        version: manuallyNamed.version,
      });

      const replayNow = new Date(now.getTime() + 1_000);
      await expect(
        store.startRun({
          authority,
          runId,
          threadId,
          userMessageId,
          userMessage: {
            schemaVersion: 1,
            role: "user",
            parts: [{ type: "text", text: "用商品图做一张夏季促销海报" }],
          },
          contextSnapshot: {
            schemaVersion: 1,
            surfaceKind: "workspace_home",
            selectedLibraryIds: [selectedLibraryId],
          },
          toolViewDigest: digest,
          promptRevision: "home-shadow-plan-v1",
          maximumModelCalls: 1,
          maximumToolCalls: 1,
          foundationContext,
          executionDeadlineAt: new Date(replayNow.getTime() + 120_000),
          idempotencyKey: "agent-plan-integration-1",
          now: replayNow,
        }),
      ).resolves.toMatchObject({ lifecycleStatus: "succeeded", version: 3 });
      await expect(
        store.getAssistantMessage(authority, runId, replayNow),
      ).resolves.toEqual(completedAssistantMessage);

      const [facts] = await pool.query<AgentFactCountRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM agent_message WHERE agent_run_id = ?) AS messageCount,
           (SELECT COUNT(*) FROM agent_model_call WHERE agent_run_id = ?) AS callCount,
           (SELECT COUNT(*) FROM agent_model_attempt
              WHERE agent_model_call_id = ?) AS attemptCount,
           (SELECT COUNT(*) FROM agent_action_receipt
              WHERE agent_run_id = ?) AS actionCount,
           JSON_EXTRACT(usage_document, '$.inputTokens') AS usageInputTokens,
           JSON_EXTRACT(usage_document, '$.outputTokens') AS usageOutputTokens
         FROM agent_model_attempt
         WHERE id = ?`,
        [runId, runId, modelCallId, runId, modelAttemptId],
      );
      expect(facts[0]).toMatchObject({
        messageCount: 2,
        callCount: 2,
        attemptCount: 1,
        actionCount: 1,
        usageInputTokens: 0,
        usageOutputTokens: 0,
      });

      const beforeRetryState = (
        await lifecycle.listResourceStates(authority, "agent", now)
      ).find((item) => item.id === agentDefinitionId)!;
      await lifecycle.changeResourceState({
        ...lifecycleCommand,
        expectedVersion: beforeRetryState.version,
        state: "disabled",
        audit: { ...lifecycleCommand.audit, auditEventId: id(9_900_110) },
      });
      await expect(
        store.regenerateRun({
          authority,
          runId: id(9_900_111),
          threadId,
          sourceAssistantMessageId: assistantMessageId,
          idempotencyKey: "disabled-agent-regenerate",
          now,
        }),
      ).rejects.toThrow("resource_lifecycle.unavailable");
      await lifecycle.changeResourceState({
        ...lifecycleCommand,
        expectedVersion: beforeRetryState.version + 1,
        state: "enabled",
        audit: { ...lifecycleCommand.audit, auditEventId: id(9_900_112) },
      });

      await pool.execute(
        "INSERT INTO instance_runtime_configuration_revision (instance_id,version,document,reason,published_by,published_at) VALUES (?,1,?,'retry policy',?,?)",
        [
          instanceId,
          JSON.stringify({
            activated: true,
            agent: {
              maximumModelCalls: 50,
              maximumToolCalls: 100,
              timeoutSeconds: 600,
            },
            downloads: {
              defaults: { enabled: true, allowedOrigins: [] },
              providers: [],
            },
          }),
          authority.principalId,
          now,
        ],
      );
      const branchNow = new Date(now.getTime() + 1_500);
      await expect(
        store.regenerateRun({
          authority,
          runId: branchRunId,
          threadId,
          sourceAssistantMessageId: assistantMessageId,
          idempotencyKey: "agent-regenerate-integration-1",
          now: branchNow,
        }),
      ).resolves.toMatchObject({
        id: branchRunId,
        parentRunId: runId,
        triggerMessageId: userMessageId,
        lifecycleStatus: "queued",
        maximumModelCalls: 50,
        maximumToolCalls: 100,
        runtimeConfigurationVersion: 1,
      });
      await pool.execute(
        "DELETE FROM instance_runtime_configuration_revision WHERE instance_id=?",
        [instanceId],
      );
      const branchClaimToken = digestProviderValue({ claim: "branch" });
      await expect(
        store.getLatestThreadRun(authority, threadId, branchNow),
      ).resolves.toMatchObject({ id: branchRunId, lifecycleStatus: "queued" });
      const branchClaim = await dispatch.claimNext({
        workerId: "agent-worker-branch",
        claimTokenDigest: branchClaimToken,
        leaseExpiresAt: new Date(branchNow.getTime() + 60_000),
        now: branchNow,
      });
      if (!branchClaim)
        throw new Error("Agent response branch was not claimed.");
      const alternativeMessage = {
        schemaVersion: 1,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "这是同一用户请求的替代回复，旧回复和资源保持不变。",
          },
          {
            type: "source",
            sourceType: "url",
            id: "source-current",
            url: "https://example.com/current",
            title: "Current source",
          },
        ],
      } as const;
      await store.appendAssistantMessage({
        authority,
        agentRunId: branchRunId,
        messageId: branchAssistantMessageId,
        message: alternativeMessage,
        modelMessages: {
          ...modelMessages,
          messages: [
            {
              id: "native-other-branch",
              role: "assistant",
              createdAt: now.toISOString(),
              content: {
                format: 2,
                parts: [{ type: "text", text: "OTHER_BRANCH_REFERENCE" }],
              },
            },
          ],
        },
        now: branchNow,
      });
      // Opposite ordering: model finishes while two confirmations are pending.
      const pendingActions = [];
      for (const ordinal of [1, 2]) {
        const proposedAction = await store.proposeAction({
          authority,
          agentRunId: branchRunId,
          actionReceiptId: id(8_500_000 + ordinal),
          actionNumber: ordinal,
          toolCallId: `branch-proposal-${ordinal}`,
          toolKey: "workflow.propose",
          effect: "compute",
          approvalMode: "before_commit",
          inputDigest: digest,
          now: branchNow,
        });
        const executingAction = await store.transitionAction({
          authority,
          agentRunId: branchRunId,
          actionReceiptId: proposedAction.id,
          expectedVersion: proposedAction.version,
          toStatus: "running",
          now: branchNow,
        });
        pendingActions.push(
          await store.recordActionPreview({
            authority,
            agentRunId: branchRunId,
            actionReceiptId: proposedAction.id,
            expectedVersion: executingAction.version,
            outputDigest: digestProviderValue(proposalDocument),
            proposalDocument,
            now: branchNow,
          }),
        );
      }
      await expect(
        store.settleRun({
          authority,
          runId: branchRunId,
          now: branchNow,
          workerClaim: {
            workerId: branchClaim.workerId,
            claimTokenDigest: digestProviderValue({ wrong: true }),
          },
        }),
      ).rejects.toMatchObject({ code: "agent.state_conflict" });
      await expect(
        store.settleRun({
          authority,
          runId: branchRunId,
          now: branchNow,
          workerClaim: {
            workerId: branchClaim.workerId,
            claimTokenDigest: branchClaimToken,
          },
        }),
      ).resolves.toMatchObject({ lifecycleStatus: "waiting_approval" });
      for (const [index, pendingAction] of pendingActions.entries()) {
        const accepted = await store.transitionAction({
          authority,
          agentRunId: branchRunId,
          actionReceiptId: pendingAction.id,
          expectedVersion: pendingAction.version,
          toStatus: "running",
          now: branchNow,
        });
        await store.completeAction({
          authority,
          agentRunId: branchRunId,
          actionReceiptId: accepted.id,
          expectedVersion: accepted.version,
          status: "succeeded",
          outputDigest: digest,
          now: branchNow,
        });
        await expect(
          store.settleRun({ authority, runId: branchRunId, now: branchNow }),
        ).resolves.toMatchObject({
          lifecycleStatus: index === 0 ? "waiting_approval" : "succeeded",
        });
      }
      await expect(
        store.settleRun({ authority, runId: branchRunId, now: branchNow }),
      ).resolves.toMatchObject({ lifecycleStatus: "succeeded" });
      await dispatch.complete({
        workerId: branchClaim.workerId,
        claimTokenDigest: branchClaimToken,
        agentRunId: branchRunId,
        now: branchNow,
      });
      const branchMessages = await store.listThreadMessages(
        authority,
        threadId,
        200,
        branchNow,
      );
      expect(
        branchMessages.map((message) =>
          agentVisibleMessageText(message.message),
        ),
      ).toEqual([
        "用商品图做一张夏季促销海报",
        agentVisibleMessageText(alternativeMessage),
      ]);
      expect(branchMessages.at(-1)).toMatchObject({
        alternativeIndex: 2,
        alternativeCount: 2,
      });
      const branchedThread = await store.getThread(
        authority,
        threadId,
        branchNow,
      );
      if (!branchedThread)
        throw new Error("Branched Agent Thread was not found.");
      await store.selectThreadBranch({
        authority,
        threadId,
        assistantMessageId,
        expectedVersion: branchedThread.version,
        now: branchNow,
      });
      const originalBranchMessages = await store.listThreadMessages(
        authority,
        threadId,
        200,
        branchNow,
      );
      await expect(
        store.getLatestThreadRun(authority, threadId, branchNow),
      ).resolves.toMatchObject({ id: runId });
      const selectedSummary = await store.listThreads({
        authority,
        limit: 50,
        now: branchNow,
      });
      expect(
        selectedSummary.items.find((item) => item.id === threadId)?.latestRun
          ?.id,
      ).toBe(runId);
      expect(
        originalBranchMessages.map((message) =>
          agentVisibleMessageText(message.message),
        ),
      ).toEqual([
        "用商品图做一张夏季促销海报",
        agentVisibleMessageText(completedAssistantMessage),
      ]);
      expect(originalBranchMessages.at(-1)).toMatchObject({
        alternativeIndex: 1,
        alternativeCount: 2,
        nextAlternativeMessageId: branchAssistantMessageId,
      });
      await expect(
        store.listThreadActions(authority, threadId, 200, branchNow),
      ).resolves.toHaveLength(3);
      // The private transcript follows the selected ancestry, not the latest run.
      // The intervening text-only streaming update must not erase it.
      expect(
        originalBranchMessages.every(
          (message) => message.modelMessages === undefined,
        ),
      ).toBe(true);
      for (const [offset, parent, expected, absent] of [
        [0, assistantMessageId, "PINNED_REFERENCE", "OTHER_BRANCH_REFERENCE"],
        [
          1,
          branchAssistantMessageId,
          "OTHER_BRANCH_REFERENCE",
          "PINNED_REFERENCE",
        ],
      ] as const) {
        const replayRunId = id(8_400_000 + offset);
        await store.startRun({
          authority,
          runId: replayRunId,
          threadId,
          userMessageId: id(8_400_010 + offset),
          parentMessageId: parent,
          userMessage: {
            schemaVersion: 1,
            role: "user",
            parts: [{ type: "text", text: "Continue this branch" }],
          },
          contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
          toolViewDigest: digest,
          promptRevision: "profile-r1",
          maximumModelCalls: 4,
          maximumToolCalls: 4,
          foundationContext,
          executionDeadlineAt: new Date(branchNow.getTime() + 120_000),
          idempotencyKey: `transcript-branch-${offset}`,
          now: branchNow,
        });
        const restored = await store.listRunMessages(
          authority,
          replayRunId,
          "all",
          branchNow,
        );
        const transcripts = JSON.stringify(
          restored.map((message) => message.modelMessages),
        );
        expect(transcripts).toContain(expected);
        expect(transcripts).not.toContain(absent);
        if (offset === 0)
          expect(
            restored.find((message) => message.id === assistantMessageId)
              ?.modelMessages,
          ).toEqual(modelMessages);
        await dispatch.cancel({
          authority,
          agentRunId: replayRunId,
          now: branchNow,
        });
      }
      await expect(
        store.regenerateRun({
          authority,
          runId: retryRunId,
          threadId,
          sourceRunId: runId,
          idempotencyKey: "agent-retry-failed-run-integration-1",
          now: branchNow,
        }),
      ).resolves.toMatchObject({
        id: retryRunId,
        parentRunId: runId,
        triggerMessageId: userMessageId,
        promptRevision: "home-shadow-plan-v1",
      });
      await dispatch.cancel({
        authority,
        agentRunId: retryRunId,
        now: branchNow,
      });

      // A cancelled response can still own an externally accepted business task.
      await pool.execute(
        `INSERT INTO agent_action_receipt
        (id, workspace_id, agent_run_id, action_number, tool_call_id, tool_key, effect, approval_mode, lifecycle_status, input_digest, version, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'uncertain-image', 'capability.invoke', 'compute', 'none', 'running', ?, 1, ?, ?)`,
        [id(8_200_095), workspaceId, retryRunId, digest, branchNow, branchNow],
      );
      await expect(
        store.regenerateRun({
          authority,
          runId: id(8_200_094),
          threadId,
          sourceRunId: retryRunId,
          idempotencyKey: "must-recover-accepted-image",
          now: branchNow,
        }),
      ).rejects.toMatchObject({ code: "agent.retry_requires_task_recovery" });
      expect(
        await store.getRun(authority, id(8_200_094), branchNow),
      ).toBeUndefined();

      const cancelNow = new Date(now.getTime() + 2_000);
      await store.createThread({
        authority,
        threadId: cancelThreadId,
        agentDefinitionId,
        agentProfileRevisionId: profileRevisionId,
        title: "Cancel one response",
        idempotencyKey: "agent-thread-cancel-integration-1",
        now: cancelNow,
      });
      await store.startRun({
        authority,
        runId: cancelRunId,
        threadId: cancelThreadId,
        userMessageId: cancelUserMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [{ type: "text", text: "Start a response that I can stop." }],
        },
        contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
        toolViewDigest: digest,
        promptRevision: "profile-r1",
        maximumModelCalls: 1,
        maximumToolCalls: 0,
        foundationContext,
        executionDeadlineAt: new Date(cancelNow.getTime() + 120_000),
        idempotencyKey: "agent-run-cancel-integration-1",
        now: cancelNow,
      });
      const cancelClaimToken = digestProviderValue({ claim: "cancel" });
      const cancelClaim = await dispatch.claimNext({
        workerId: "agent-worker-cancel",
        claimTokenDigest: cancelClaimToken,
        leaseExpiresAt: new Date(cancelNow.getTime() + 60_000),
        now: cancelNow,
      });
      if (!cancelClaim)
        throw new Error("Cancelable Agent Run was not claimed.");
      const lateMessage = {
        authority,
        agentRunId: cancelRunId,
        messageId: id(8_200_093),
        message: {
          schemaVersion: 1 as const,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "Last streamed paragraph" }],
        },
        workerClaim: {
          workerId: cancelClaim.workerId,
          claimTokenDigest: cancelClaimToken,
        },
        now: cancelNow,
      };
      const raced = await Promise.allSettled([
        store.appendAssistantMessage(lateMessage),
        dispatch.cancel({ authority, agentRunId: cancelRunId, now: cancelNow }),
      ]);
      expect(raced[1]).toEqual({
        status: "fulfilled",
        value: { id: cancelRunId, lifecycleStatus: "cancelled" },
      });
      if (raced[0].status === "rejected")
        expect(raced[0].reason).toMatchObject({ code: "agent.run_inactive" });
      await expect(
        store.appendAssistantMessage(lateMessage),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      await expect(
        dispatch.heartbeat({
          workerId: cancelClaim.workerId,
          claimTokenDigest: cancelClaimToken,
          agentRunId: cancelRunId,
          leaseExpiresAt: new Date(cancelNow.getTime() + 90_000),
          now: new Date(cancelNow.getTime() + 1_000),
        }),
      ).rejects.toMatchObject({ code: "agent_dispatch.lease_lost" });
      await expect(
        store.getRun(authority, cancelRunId, cancelNow),
      ).resolves.toMatchObject({
        lifecycleStatus: "cancelled",
        terminalReasonCode: "agent.cancelled_by_user",
      });

      await expect(
        store.saveThreadMemory({
          ...memoryPublication,
          agentRunId: cancelRunId,
          threadId: cancelThreadId,
          workerClaim: {
            workerId: cancelClaim.workerId,
            claimTokenDigest: cancelClaimToken,
          },
          sourceMessageId: cancelUserMessageId,
          lastObservedAt: cancelNow,
          now: cancelNow,
        }),
      ).rejects.toMatchObject({ code: "agent.run_inactive" });
      expect(
        await store.getThreadMemory(authority, cancelThreadId, cancelNow),
      ).toBeUndefined();

      const declineNow = new Date(now.getTime() + 3_000);
      await store.createThread({
        authority,
        threadId: declineThreadId,
        agentDefinitionId,
        agentProfileRevisionId: profileRevisionId,
        title: "Decline one proposal",
        idempotencyKey: "agent-thread-decline-integration-1",
        now: declineNow,
      });
      await store.startRun({
        authority,
        runId: declineRunId,
        threadId: declineThreadId,
        userMessageId: declineUserMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [
            { type: "text", text: "Prepare a proposal that I can decline." },
          ],
        },
        contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
        toolViewDigest: digest,
        promptRevision: "profile-r1",
        maximumModelCalls: 1,
        maximumToolCalls: 1,
        foundationContext,
        executionDeadlineAt: new Date(declineNow.getTime() + 120_000),
        idempotencyKey: "agent-run-decline-integration-1",
        now: declineNow,
      });
      const declineClaimToken = digestProviderValue({ claim: "decline" });
      const declineClaim = await dispatch.claimNext({
        workerId: "agent-worker-decline",
        claimTokenDigest: declineClaimToken,
        leaseExpiresAt: new Date(declineNow.getTime() + 60_000),
        now: declineNow,
      });
      if (!declineClaim) throw new Error("Decline Agent Run was not claimed.");
      await expect(
        dispatch.claimNext({
          workerId: "agent-worker-decline-early",
          claimTokenDigest: digestProviderValue({ claim: "decline-early" }),
          leaseExpiresAt: new Date(declineNow.getTime() + 90_000),
          now: new Date(declineNow.getTime() + 30_000),
        }),
      ).resolves.toBeUndefined();
      const recoveredAt = new Date(declineNow.getTime() + 60_001);
      const recoveredClaimToken = digestProviderValue({
        claim: "decline-recovered",
      });
      await pool.execute(
        "UPDATE agent_run_dispatch SET delivery_count = 10 WHERE workspace_id = ? AND agent_run_id = ?",
        [workspaceId, declineRunId],
      );
      const recoveredClaim = await dispatch.claimNext({
        workerId: "agent-worker-decline-recovered",
        claimTokenDigest: recoveredClaimToken,
        leaseExpiresAt: new Date(recoveredAt.getTime() + 60_000),
        now: recoveredAt,
      });
      expect(recoveredClaim).toMatchObject({
        run: { id: declineRunId, lifecycleStatus: "running" },
      });
      if (!recoveredClaim) {
        throw new Error("Expired Agent Run lease was not recovered.");
      }
      const actionNow = new Date(recoveredAt.getTime() + 1_000);
      await expect(
        store.appendAssistantMessage({
          authority,
          agentRunId: declineRunId,
          messageId: id(8_200_098),
          message: {
            schemaVersion: 1,
            role: "assistant",
            parts: [{ type: "text", text: "Stale Worker output" }],
          },
          now: actionNow,
          workerClaim: {
            workerId: declineClaim.workerId,
            claimTokenDigest: declineClaimToken,
          },
        }),
      ).rejects.toMatchObject({ code: "agent.state_conflict" });
      const proposedForDecline = await store.proposeAction({
        authority,
        agentRunId: declineRunId,
        actionReceiptId: declineActionReceiptId,
        actionNumber: 1,
        toolCallId: "tool-call-decline-1",
        toolKey: "workflow.propose.entrypoint-1",
        effect: "compute",
        approvalMode: "before_commit",
        inputDigest: digest,
        now: actionNow,
      });
      const runningForDecline = await store.transitionAction({
        authority,
        agentRunId: declineRunId,
        actionReceiptId: declineActionReceiptId,
        expectedVersion: proposedForDecline.version,
        toStatus: "running",
        now: actionNow,
      });
      await store.recordActionPreview({
        authority,
        agentRunId: declineRunId,
        actionReceiptId: declineActionReceiptId,
        expectedVersion: runningForDecline.version,
        outputDigest: digestProviderValue(proposalDocument),
        proposalDocument,
        now: actionNow,
      });
      await store.transitionRun({
        authority,
        runId: declineRunId,
        expectedVersion: recoveredClaim.run.version,
        toStatus: "waiting_approval",
        now: actionNow,
      });
      await dispatch.complete({
        workerId: recoveredClaim.workerId,
        claimTokenDigest: recoveredClaimToken,
        agentRunId: declineRunId,
        now: actionNow,
      });

      const declined = await store.declinePendingAction({
        authority,
        actionReceiptId: declineActionReceiptId,
        now: new Date(actionNow.getTime() + 1_000),
      });
      expect(declined).toMatchObject({
        replayed: false,
        action: {
          lifecycleStatus: "cancelled",
          terminalReasonCode: "agent.action_declined",
        },
        run: {
          lifecycleStatus: "cancelled",
          terminalReasonCode: "agent.action_declined",
        },
      });
      await expect(
        store.declinePendingAction({
          authority,
          actionReceiptId: declineActionReceiptId,
          now: new Date(actionNow.getTime() + 2_000),
        }),
      ).resolves.toMatchObject({ replayed: true });

      const orphanNow = new Date(actionNow.getTime() + 3_000);
      await store.createThread({
        authority,
        threadId: orphanThreadId,
        agentDefinitionId,
        agentProfileRevisionId: profileRevisionId,
        title: "Orphaned model call recovery",
        idempotencyKey: "agent-orphan-thread-integration-1",
        now: orphanNow,
      });
      await store.startRun({
        authority,
        runId: orphanRunId,
        threadId: orphanThreadId,
        userMessageId: orphanUserMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [{ type: "text", text: "Exercise terminal recovery." }],
        },
        contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
        toolViewDigest: digest,
        promptRevision: "profile-r1",
        maximumModelCalls: 1,
        maximumToolCalls: 1,
        foundationContext,
        executionDeadlineAt: new Date(orphanNow.getTime() + 120_000),
        idempotencyKey: "agent-orphan-run-integration-1",
        now: orphanNow,
      });
      const orphanClaimToken = digestProviderValue({ claim: "orphan" });
      const orphanClaim = await dispatch.claimNext({
        workerId: "agent-worker-orphan",
        claimTokenDigest: orphanClaimToken,
        leaseExpiresAt: new Date(orphanNow.getTime() + 5_000),
        now: orphanNow,
      });
      if (!orphanClaim) throw new Error("Orphan test Run was not claimed.");
      await store.beginModelCall({
        authority,
        agentRunId: orphanRunId,
        modelCallId: orphanModelCallId,
        callNumber: 1,
        purpose: "thread_title",
        modelProfileKey: "deterministic-shadow-v1",
        inputDigest: digest,
        now: orphanNow,
      });
      const orphanRequestDigest = digestProviderValue({
        agentModelCallId: orphanModelCallId,
        maximumChargeAmount: "1",
      });
      await budgets.reserve({
        reservationId: orphanBudgetReservationId,
        ledgerEntryId: id(8_200_053),
        workspaceId,
        budgetAccountId,
        reservationKey: "agent-model-call-orphan",
        requestDigest: orphanRequestDigest,
        consumerKind: "agent_model_call",
        agentRunId: orphanRunId,
        agentModelCallId: orphanModelCallId,
        pricingRevisionId,
        currencyCode: "USD",
        maximumChargeAmount: "1",
        expiresAt: new Date(orphanNow.getTime() + 60_000),
        now: orphanNow,
        audit: {
          auditEventId: id(8_200_054),
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({ session: "orphan" }),
          authorityType: "human_membership",
          authorityId: membershipId,
          authorityVersion: 1,
        },
      });
      await store.startModelAttempt({
        authority,
        agentRunId: orphanRunId,
        modelCallId: orphanModelCallId,
        attemptId: orphanModelAttemptId,
        attemptNumber: 1,
        transitionKind: "initial",
        routeSnapshot: { schemaVersion: 1, kind: "orphan-test" },
        now: orphanNow,
      });
      await budgets.finalize({
        workspaceId,
        budgetAccountId,
        reservationId: orphanBudgetReservationId,
        ledgerEntryId: id(8_200_055),
        ledgerEntryKey: `unknown:${orphanBudgetReservationId}`,
        requestDigest: orphanRequestDigest,
        kind: "unknown_hold",
        now: orphanNow,
        audit: {
          auditEventId: id(8_200_056),
          actorPrincipalId: principalId,
          actorType: "human",
          authenticationRefType: "session",
          authenticationRefHash: digestProviderValue({ session: "orphan" }),
          authorityType: "human_membership",
          authorityId: membershipId,
          authorityVersion: 1,
        },
      });
      await store.transitionRun({
        authority,
        runId: orphanRunId,
        expectedVersion: orphanClaim.run.version,
        toStatus: "failed",
        terminalReasonCode: "agent.model_provider_failure",
        now: new Date(orphanNow.getTime() + 1_000),
      });
      await expect(
        dispatch.claimNext({
          workerId: "agent-worker-reconciler",
          claimTokenDigest: digestProviderValue({ claim: "orphan-repair" }),
          leaseExpiresAt: new Date(orphanNow.getTime() + 66_000),
          now: new Date(orphanNow.getTime() + 6_000),
        }),
      ).resolves.toBeUndefined();
      const [orphanRows] = await pool.query<
        (RowDataPacket & {
          readonly callStatus: string;
          readonly attemptStatus: string;
          readonly dispatchStatus: string;
          readonly terminalReasonCode: string | null;
        })[]
      >(
        `SELECT model_call.lifecycle_status AS callStatus,
                attempt.lifecycle_status AS attemptStatus,
                dispatch.delivery_status AS dispatchStatus,
                model_call.terminal_reason_code AS terminalReasonCode
           FROM agent_model_call AS model_call
           INNER JOIN agent_model_attempt AS attempt
             ON attempt.workspace_id = model_call.workspace_id
            AND attempt.agent_model_call_id = model_call.id
           INNER JOIN agent_run_dispatch AS dispatch
             ON dispatch.workspace_id = model_call.workspace_id
            AND dispatch.agent_run_id = model_call.agent_run_id
          WHERE model_call.workspace_id = ? AND model_call.id = ?`,
        [workspaceId, orphanModelCallId],
      );
      expect(orphanRows[0]).toMatchObject({
        callStatus: "failed",
        attemptStatus: "unknown",
        dispatchStatus: "completed",
        terminalReasonCode: "agent.model_call_orphaned",
      });

      const interactionNow = new Date(actionNow.getTime() + 10_000);
      await store.createThread({
        authority,
        threadId: interactionThreadId,
        agentDefinitionId,
        agentProfileRevisionId: profileRevisionId,
        title: "Durable user question",
        idempotencyKey: "agent-interaction-thread-integration-1",
        now: interactionNow,
      });
      await store.startRun({
        authority,
        runId: interactionRunId,
        threadId: interactionThreadId,
        userMessageId: interactionUserMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [{ type: "text", text: "Prepare the right output." }],
        },
        contextSnapshot: {
          schemaVersion: 1,
          surfaceKind: "workspace_home",
          selectedLibraryIds: [selectedLibraryId],
        },
        toolViewDigest: digest,
        promptRevision: "profile-r1",
        maximumModelCalls: 2,
        maximumToolCalls: 2,
        foundationContext,
        executionDeadlineAt: new Date(interactionNow.getTime() + 120_000),
        idempotencyKey: "agent-interaction-run-integration-1",
        now: interactionNow,
      });
      const interactionClaimToken = digestProviderValue({
        claim: "interaction",
      });
      const interactionClaim = await dispatch.claimNext({
        workerId: "agent-worker-interaction",
        claimTokenDigest: interactionClaimToken,
        leaseExpiresAt: new Date(interactionNow.getTime() + 60_000),
        now: interactionNow,
      });
      if (!interactionClaim) {
        throw new Error("Interaction test Run was not claimed.");
      }
      await store.appendAssistantMessage({
        authority,
        agentRunId: interactionRunId,
        messageId: interactionAssistantMessageId,
        message: {
          schemaVersion: 1,
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "provider-question-1",
              toolName: "ask_question",
            },
          ],
        },
        now: interactionNow,
      });
      const questionRequest = {
        schemaVersion: 1 as const,
        kind: "question" as const,
        questions: [
          {
            key: "format",
            header: "Output",
            question: "Which output should be prepared?",
            options: [
              { key: "outline", label: "Outline" },
              { key: "draft", label: "Full draft" },
            ],
          },
        ],
      };
      const checkpoint = {
        schemaVersion: 1 as const,
        adapter: "mastra-message-list-v2" as const,
        toolCallId: "provider-question-1",
        toolName: "ask_question" as const,
        toolCallCount: 1,
        continuationMessages: [
          {
            role: "assistant",
            content: {
              parts: [
                {
                  type: "tool-invocation",
                  toolInvocation: {
                    toolCallId: "provider-question-1",
                    toolName: "ask_question",
                    state: "call",
                    args: questionRequest,
                  },
                },
              ],
            },
          },
        ],
      };
      await expect(
        store.suspendForInteraction({
          authority,
          interactionId,
          agentRunId: interactionRunId,
          assistantMessageId: interactionAssistantMessageId,
          toolCallId: "provider-question-1",
          request: questionRequest,
          checkpoint,
          expectedRunVersion: interactionClaim.run.version,
          workerId: interactionClaim.workerId,
          claimTokenDigest: interactionClaimToken,
          now: interactionNow,
        }),
      ).resolves.toMatchObject({
        id: interactionId,
        lifecycleStatus: "pending",
        request: questionRequest,
        checkpoint,
      });
      await expect(
        store.listThreadInteractions(
          authority,
          interactionThreadId,
          20,
          interactionNow,
        ),
      ).resolves.toMatchObject([
        { id: interactionId, checkpoint, lifecycleStatus: "pending" },
      ]);
      await expect(
        store.getRun(authority, interactionRunId, interactionNow),
      ).resolves.toMatchObject({ lifecycleStatus: "waiting_for_user" });
      await expect(
        store.startRun({
          authority,
          runId: id(8_200_065),
          threadId: interactionThreadId,
          userMessageId: id(8_200_066),
          userMessage: {
            schemaVersion: 1,
            role: "user",
            parts: [{ type: "text", text: "Do not bypass the question." }],
          },
          contextSnapshot: {
            schemaVersion: 1,
            surfaceKind: "workspace_home",
          },
          toolViewDigest: digest,
          promptRevision: "profile-r1",
          maximumModelCalls: 1,
          maximumToolCalls: 1,
          foundationContext,
          executionDeadlineAt: new Date(interactionNow.getTime() + 120_000),
          idempotencyKey: "agent-interaction-bypass-integration-1",
          now: interactionNow,
        }),
      ).rejects.toMatchObject({ code: "agent.run_active" });
      await pool.execute(
        "UPDATE agent_run SET runtime_timeout_seconds=120, created_at=? WHERE id=?",
        [new Date(interactionNow.getTime() - 3_600_000), interactionRunId],
      );
      await createResourceLibraryStore(pool).save({
        authority,
        libraryId: selectedLibraryId,
        revisionId: id(8_900_103),
        expectedVersion: 1,
        requestKey: "edit-while-run-suspended",
        document: {
          schemaVersion: 1,
          name: "Updated task references",
          description: "Changed while waiting for the user",
          entries: [],
        },
        audit: { auditEventId: id(8_900_104), authenticationRefHash: digest },
        now: interactionNow,
      });
      const questionResponse = {
        schemaVersion: 1 as const,
        outcome: "submitted" as const,
        answers: [{ questionKey: "format", optionKeys: ["outline"] }],
      };
      const resolved = await store.resolveInteraction({
        authority,
        interactionId,
        expectedVersion: 1,
        resolutionRequestKey: "agent-interaction-response-1",
        response: questionResponse,
        now: new Date(interactionNow.getTime() + 100),
      });
      expect(resolved).toMatchObject({
        replayed: false,
        interaction: { lifecycleStatus: "submitted", version: 2 },
        run: { lifecycleStatus: "queued" },
      });
      expect(resolved.run.executionDeadlineAt.getTime()).toBe(
        interactionNow.getTime() + 100 + 120_000,
      );
      await expect(
        store.resolveInteraction({
          authority,
          interactionId,
          expectedVersion: 1,
          resolutionRequestKey: "agent-interaction-response-1",
          response: questionResponse,
          now: new Date(interactionNow.getTime() + 150),
        }),
      ).resolves.toMatchObject({ replayed: true });
      const resumedClaim = await dispatch.claimNext({
        workerId: "agent-worker-interaction-resume",
        claimTokenDigest: digestProviderValue({ claim: "interaction-resume" }),
        leaseExpiresAt: new Date(interactionNow.getTime() + 60_200),
        now: new Date(interactionNow.getTime() + 200),
      });
      expect(resumedClaim).toMatchObject({
        run: { id: interactionRunId, lifecycleStatus: "running" },
      });
      if (!resumedClaim) throw new Error("Interaction Run was not resumed.");
      const resumedLibrary = await createAgentLibraryStore(pool).pin({
        authority: resumedClaim.authority,
        runId: interactionRunId,
        libraryId: selectedLibraryId,
        now: new Date(interactionNow.getTime() + 201),
      });
      expect(resumedLibrary).toMatchObject({
        id: selectedLibraryRevisionId,
        document: { name: "Explicit task references" },
      });
      expect(
        await createResourceLibraryStore(pool).getRevision({
          authority,
          libraryId: selectedLibraryId,
          now: interactionNow,
        }),
      ).toMatchObject({
        id: id(8_900_103),
        document: { name: "Updated task references" },
      });

      const discoveryDiagnostics = {
        catalogState: "unavailable" as const,
        complete: true,
        evaluatedAt: interactionNow.toISOString(),
        durationMs: 12,
        exclusions: [
          {
            key: "image.generate",
            status: "unavailable" as const,
            stage: "invocation" as const,
            reason: "deployment_policy_missing",
          },
        ],
      };
      const discoveryAction = await store.proposeAction({
        authority,
        agentRunId: interactionRunId,
        actionReceiptId: id(8_200_097),
        actionNumber: 1,
        toolCallId: "discovery-diagnostic",
        toolKey: "capability.search",
        effect: "read",
        approvalMode: "none",
        inputDigest: digest,
        now: interactionNow,
      });
      const discoveryRunning = await store.transitionAction({
        authority,
        agentRunId: interactionRunId,
        actionReceiptId: discoveryAction.id,
        expectedVersion: discoveryAction.version,
        toStatus: "running",
        now: interactionNow,
      });
      await store.completeAction({
        authority,
        agentRunId: interactionRunId,
        actionReceiptId: discoveryAction.id,
        expectedVersion: discoveryRunning.version,
        status: "succeeded",
        outputDigest: digestProviderValue(discoveryDiagnostics),
        outcomeReference: {
          kind: "query",
          resultCount: 0,
          diagnostics: discoveryDiagnostics,
        },
        now: interactionNow,
      });
      const persistedDiscovery = await store.getAction(
        authority,
        discoveryAction.id,
        interactionNow,
      );
      expect(persistedDiscovery?.outcomeReference).toEqual({
        kind: "query",
        resultCount: 0,
        diagnostics: discoveryDiagnostics,
      });
      await expect(
        store.completeAction({
          authority,
          agentRunId: interactionRunId,
          actionReceiptId: discoveryAction.id,
          expectedVersion: discoveryRunning.version,
          status: "succeeded",
          outputDigest: digestProviderValue(discoveryDiagnostics),
          outcomeReference: {
            kind: "query",
            resultCount: 0,
            diagnostics: { ...discoveryDiagnostics, durationMs: 13 },
          },
          now: interactionNow,
        }),
      ).rejects.toMatchObject({ code: "agent.identity_conflict" });
      const recoveredDiagnostics = await store.getRunDiagnostics(
        authority,
        interactionRunId,
        interactionNow,
      );
      expect(recoveredDiagnostics?.discoveries).toEqual([
        { actionId: discoveryAction.id, ...discoveryDiagnostics },
      ]);
      expect(recoveredDiagnostics?.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: discoveryAction.id,
            toolKey: "capability.search",
            lifecycleStatus: "succeeded",
          }),
        ]),
      );
      expect(recoveredDiagnostics?.limits?.maximumModelCalls).toBeGreaterThan(
        0,
      );

      const resumed = await store.transitionRun({
        authority,
        runId: interactionRunId,
        expectedVersion: resumedClaim.run.version,
        toStatus: "succeeded",
        now: new Date(interactionNow.getTime() + 300),
      });
      await dispatch.complete({
        workerId: resumedClaim.workerId,
        claimTokenDigest: resumedClaim.claimTokenDigest,
        agentRunId: interactionRunId,
        now: new Date(interactionNow.getTime() + 300),
      });
      expect(resumed.lifecycleStatus).toBe("succeeded");

      const continued = await store.startRun({
        authority,
        runId: continuedRunId,
        threadId: declineThreadId,
        userMessageId: continuedUserMessageId,
        userMessage: {
          schemaVersion: 1,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Continue after declining the previous proposal.",
            },
          ],
        },
        contextSnapshot: { schemaVersion: 1, surfaceKind: "workspace_home" },
        toolViewDigest: digest,
        promptRevision: "profile-r1",
        maximumModelCalls: 1,
        maximumToolCalls: 1,
        foundationContext,
        executionDeadlineAt: new Date(declineNow.getTime() + 120_000),
        idempotencyKey: "agent-run-after-decline-integration-1",
        now: new Date(actionNow.getTime() + 13_000),
      });
      expect(continued.lifecycleStatus).toBe("queued");

      // Runtime history uses bounded SQL batches, not a semantic 200-message cap.
      const originalHistory = await store.listRunMessages(
        authority,
        runId,
        200,
        now,
      );
      let parentMessageId = userMessageId;
      const longBranchIds: string[] = [];
      for (let index = 0; index < 1005; index += 1) {
        const messageId = id(8_300_000 + index);
        const content = {
          schemaVersion: 1,
          role: "user",
          parts: [{ type: "text", text: `history-${index}` }],
        };
        await pool.execute(
          `INSERT INTO agent_message
            (id, workspace_id, thread_id, agent_run_id, parent_message_id, sequence_number, alternative_index, role, content, content_digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'user', ?, ?, ?)`,
          [
            messageId,
            workspaceId,
            threadId,
            runId,
            parentMessageId,
            10000 + index,
            JSON.stringify(content),
            digestProviderValue(content),
            now,
          ],
        );
        parentMessageId = messageId;
        longBranchIds.push(messageId);
      }
      await pool.execute(
        "UPDATE agent_run SET trigger_message_id = ? WHERE id = ?",
        [parentMessageId, runId],
      );
      const fullHistory = await store.listRunMessages(
        authority,
        runId,
        "all",
        now,
      );
      expect(fullHistory.map((message) => message.id)).toEqual([
        ...originalHistory.map((message) => message.id),
        ...longBranchIds,
      ]);
      const boundedHistory = await store.listRunMessages(
        authority,
        runId,
        200,
        now,
      );
      expect(boundedHistory.map((message) => message.id)).toEqual(
        longBranchIds.slice(-200),
      );
      await pool.execute(
        "UPDATE agent_run SET trigger_message_id = ? WHERE id = ?",
        [userMessageId, runId],
      );

      await expect(
        bindings.disable({
          authority,
          bindingKey: "agent-budget-model",
          expectedVersion: configuredBinding.version,
          now: replayNow,
          audit: {
            auditEventId: id(8_200_028),
            actorPrincipalId: principalId,
            actorType: "human",
            authenticationRefType: "session",
            authenticationRefHash: digestProviderValue({ session: "agent" }),
            authorityType: "human_membership",
            authorityId: membershipId,
            authorityVersion: 1,
          },
        }),
      ).resolves.toMatchObject({
        lifecycleStatus: "disabled",
        version: 2,
      });

      await pool.execute(
        `UPDATE workspace_membership
            SET role = 'viewer'
          WHERE id = ? AND workspace_id = ?`,
        [membershipId, workspaceId],
      );
      await expect(
        dispatch.claimNext({
          workerId: "agent-worker-revoked",
          claimTokenDigest: digestProviderValue({ claim: "revoked" }),
          leaseExpiresAt: new Date(actionNow.getTime() + 69_000),
          now: new Date(actionNow.getTime() + 15_000),
        }),
      ).resolves.toBeUndefined();
      const [revokedRows] = await pool.query<RevokedRunRow[]>(
        `SELECT run.lifecycle_status AS lifecycleStatus,
                run.terminal_reason_code AS terminalReasonCode,
                dispatch.delivery_status AS deliveryStatus
           FROM agent_run AS run
           INNER JOIN agent_run_dispatch AS dispatch
             ON dispatch.workspace_id = run.workspace_id
            AND dispatch.agent_run_id = run.id
           WHERE run.workspace_id = ? AND run.id = ?`,
        [workspaceId, continuedRunId],
      );
      expect(revokedRows[0]).toMatchObject({
        lifecycleStatus: "cancelled",
        terminalReasonCode: "agent.authorization_revoked",
        deliveryStatus: "completed",
      });
    });
  },
);
