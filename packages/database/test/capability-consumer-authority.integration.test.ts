import { createLibraryConsumerAccessStore } from "../src/runtime/library-consumer-access.js";
import { createResourceLibraryStore } from "../src/runtime/resource-library-store.js";
import { createSiteToolStore } from "../src/runtime/site-tool-store.js";
import { toolSessionAuthenticationHash } from "../src/runtime/tool-session-store.js";
import { createOperationalTimelineStore } from "../src/runtime/operational-timeline-store.js";
import type {
  TrustedWorkspaceScope,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";
import { createCapabilityRunStore } from "../src/runtime/capability-run-store.js";
import { createAtomicAttemptCompletionStore } from "../src/runtime/attempt-completion-store.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { createWorkflowEngineStore } from "../src/runtime/workflow-engine-store.js";
import { createWorkflowAuthoringStore } from "../src/runtime/workflow-authoring-store.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-01T18:00:00.000Z");
const instanceId = "capability-consumer-authority";
const ids = Object.freeze({
  workspace: id(1),
  organization: id(2),
  principal: id(3),
  membership: id(4),
  definition: id(10),
  contract: id(11),
  declaration: id(12),
  adapterDefinition: id(13),
  adapterRevision: id(14),
  implementation: id(15),
  binding: id(16),
  run: id(17),
  attempt: id(18),
  dispatch: id(19),
  replacementAdapterDefinition: id(20),
  replacementAdapterRevision: id(21),
  replacementImplementation: id(22),
  completion: id(23),
  terminal: id(24),
  userRun: id(25),
  userAttempt: id(26),
  userDispatch: id(27),
  userCompletion: id(28),
  userTerminal: id(29),
});
const inputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["sourceArtifactId"],
  properties: Object.freeze({
    sourceArtifactId: Object.freeze({ type: "string", minLength: 26 }),
  }),
});
const outputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["imageArtifactId"],
  properties: Object.freeze({
    imageArtifactId: Object.freeze({ type: "string", minLength: 26 }),
  }),
});
const declaration = {
  schemaVersion: "kanvas.capability-declaration/v1",
  origin: "declared",
  catalog: {
    title: {
      "zh-CN": "共享图像处理",
      "en-US": "Shared image processing",
    },
    description: {
      "zh-CN": "使用一个公开接口处理图像。",
      "en-US": "Process an image through one public interface.",
    },
    category: { "zh-CN": "图像处理", "en-US": "Image processing" },
    sourceKind: "plugin",
    tags: ["image", "shared"],
    surfaces: ["workflow", "agent", "canvas"],
  },
  parameters: [
    {
      key: "sourceArtifactId",
      label: { "zh-CN": "源图片", "en-US": "Source image" },
      semanticType: "artifact.image",
      required: true,
      exposurePolicy: {
        allowed: ["workflow_author"],
        default: "workflow_author",
      },
      sourcePolicy: {
        allowed: ["workflow_input", "canvas_selection"],
        default: "workflow_input",
      },
      editor: "artifact_picker",
    },
  ],
  outputs: [
    {
      key: "imageArtifactId",
      label: { "zh-CN": "结果", "en-US": "Result" },
      semanticType: "artifact.image",
      primary: true,
      visibility: "author",
    },
  ],
  canvas: {
    actionGroup: "image.edit",
    interactionBehavior: "direct",
    completionBehavior: "review_required",
    outputModes: ["add_node", "replace_content"],
    order: 20,
  },
} satisfies WorkflowCapabilityAuthoringDeclaration;
const contractDigest = digestProviderValue({
  inputSchema,
  outputSchema,
  idempotencyMode: "keyed",
  supportedInvokers: ["user", "workflow", "agent", "canvas"],
});
const implementationDigest = digestProviderValue({ implementation: 1 });

function publicIdentity(value: {
  readonly contractKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly authoring: WorkflowCapabilityAuthoringDeclaration;
}) {
  return Object.freeze({
    key: value.contractKey,
    revision: value.revision,
    canonicalDigest: value.canonicalDigest,
    title: value.authoring.catalog.title,
    parameters: value.authoring.parameters,
    outputs: value.authoring.outputs,
  });
}

describe.skipIf(!enabled)(
  "Capability consumer authority against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: ids.workspace,
      organizationId: ids.organization,
      principalId: ids.principal,
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "capability-consumer-authority",
      authorityType: "human_membership",
      authorityId: ids.membership,
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: [
        "capability.configure",
        "capability.run",
        "workflow.read",
      ] as const,
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
           VALUES (?, 'capability-consumer-authority', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'capability-consumers', 'Capability Consumers',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'capability-consumers', 'Capability Consumers',
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
        await connection.execute(
          `INSERT INTO instance_runtime_state (
             instance_id, state, execution_generation, state_version,
             reason, deadline, changed_by, changed_at
           ) VALUES (?, 'ACTIVE', 1, 1, 'test', NULL, 'test', ?)`,
          [instanceId, now],
        );
      } finally {
        connection.release();
      }
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("lets Workflow, Agent, and Canvas share one Capability without Workflow or Skill coupling", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const definitions = createCapabilityDefinitionAdminStore(pool);
      await definitions.create({
        scope,
        definitionId: ids.definition,
        contractRevisionId: ids.contract,
        declarationRevisionId: ids.declaration,
        key: "image.shared.process",
        inputSchema,
        outputSchema,
        idempotencyMode: "keyed",
        supportedInvokers: ["user", "workflow", "agent", "canvas"],
        contractDigest,
        declaration,
        declarationDigest: digestProviderValue(declaration),
        requestHash: digestProviderValue({ command: "create-shared" }),
        idempotencyKey: "create-shared-image-capability",
        now,
        audit: audit(50),
      });
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: scope.workspaceId,
        contractRevisionId: ids.contract,
        adapterDefinitionId: ids.adapterDefinition,
        adapterRevisionId: ids.adapterRevision,
        adapterKey: "test.image.shared.v1",
        executionTarget: "worker",
        implementationId: ids.implementation,
        implementationKey: "test.image.shared.worker",
        canonicalDigest: implementationDigest,
        createdAt: now,
      });
      await pool.execute(
        `INSERT INTO capability_binding (
           id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status, priority, version,
           route_policy, created_at, updated_at
         ) VALUES (?, ?, 'test.image.shared.route', ?, ?, 'active', 1, 1,
           JSON_OBJECT(), ?, ?)`,
        [
          ids.binding,
          scope.workspaceId,
          ids.contract,
          ids.implementation,
          now,
          now,
        ],
      );

      const workflow = await createWorkflowAuthoringStore(
        pool,
      ).listCapabilities(scope, now);
      const agent = await definitions.searchAgentCatalog(
        scope,
        undefined,
        20,
        now,
      );
      const capabilityRuns = createCapabilityRunStore(pool, {
        instanceId,
        enabledExecutionTargets: ["worker"],
      });
      const canvas = await capabilityRuns.listCanvasCapabilities(
        scope,
        {
          actionGroup: "image.edit",
          selectedSemanticType: "artifact.image",
          locale: "en-US",
        },
        now,
      );

      const userCatalog = await capabilityRuns.listUserCapabilities(
        scope,
        "en-US",
        now,
      );
      expect(userCatalog).toHaveLength(1);
      expect(userCatalog[0]).toMatchObject({
        contractRevisionId: ids.contract,
        displayName: "Shared image processing",
      });
      expect(userCatalog[0]).not.toHaveProperty("bindings");
      expect(userCatalog[0]).not.toHaveProperty("canvas");
      expect(workflow).toHaveLength(1);
      expect(agent).toHaveLength(1);
      expect(canvas).toHaveLength(1);
      expect(agent[0]).not.toHaveProperty("invocationWorkflowRevisionId");
      expect(canvas[0]).toMatchObject({
        contractRevisionId: ids.contract,
        capabilityKey: "image.shared.process",
        displayName: "Shared image processing",
        category: "Image processing",
        canvas: { actionGroup: "image.edit" },
      });
      const expectedIdentity = publicIdentity(workflow[0]!);
      expect(
        publicIdentity({
          contractKey: agent[0]!.key,
          revision: agent[0]!.contractRevision,
          canonicalDigest: contractDigest,
          authoring: agent[0]!.declaration,
        }),
      ).toEqual(expectedIdentity);

      const direct = await capabilityRuns.createDirect({
        scope,
        invocationKind: "canvas",
        invocationReferenceId: "canvas-operation-1",
        contractRevisionId: ids.contract,
        idempotencyKey: "canvas-operation-1",
        input: { sourceArtifactId: id(99) },
        runId: ids.run,
        attemptId: ids.attempt,
        outboxEventId: ids.dispatch,
        now,
        audit: audit(51),
      });
      expect(direct).toMatchObject({
        replayed: false,
        run: {
          id: ids.run,
          invocationKind: "canvas",
          lifecycleStatus: "queued",
          outputDeclarations: declaration.outputs,
          inputDeclarations: declaration.parameters,
        },
      });
      const operations = createOperationalTimelineStore(pool);
      const supportScope: TrustedWorkspaceScope = {
        ...scope,
        effectivePermissions: [...scope.effectivePermissions, "audit.read"],
      };
      const directory = await operations.list({
        authority: supportScope,
        query: { reference: ids.run },
        now,
      });
      expect(directory.items).toMatchObject([
        {
          id: ids.run,
          kind: "capability",
          status: "queued",
          creatorId: ids.principal,
        },
      ]);
      const directTimeline = await operations.get({
        authority: supportScope,
        workflowRunId: ids.run,
        kind: "capability",
        now,
      });
      expect(
        directTimeline.items.some(
          (item) =>
            item.source === "capability_run" && item.resourceId === ids.run,
        ),
      ).toBe(true);
      expect(
        directTimeline.items.some(
          (item) =>
            item.source === "capability_attempt" &&
            item.resourceId === ids.attempt,
        ),
      ).toBe(true);
      await expect(
        operations.list({
          authority: { ...supportScope, authorityVersion: 99 },
          query: {},
          now,
        }),
      ).rejects.toMatchObject({ code: "operational_timeline.forbidden" });
      await expect(
        operations.get({
          authority: { ...supportScope, workspaceId: id(987) },
          workflowRunId: ids.run,
          kind: "capability",
          now,
        }),
      ).rejects.toMatchObject({ code: "operational_timeline.forbidden" });

      // A later declaration on the same contract must not rename a historical run.
      const renamed = {
        ...declaration,
        parameters: declaration.parameters.map((field) => ({
          ...field,
          label: { "zh-CN": "新原图名称", "en-US": "Renamed source" },
        })),
        outputs: declaration.outputs.map((field) => ({
          ...field,
          label: { "zh-CN": "新结果名称", "en-US": "Renamed result" },
        })),
      };
      await pool.execute(
        `INSERT INTO capability_declaration_revision
          (id, workspace_id, capability_definition_id, contract_revision_id, revision, lifecycle_status,
           schema_version, canonical_digest, declaration, publication_request_key, publication_request_hash, created_at, published_at)
          VALUES (?, ?, ?, ?, 2, 'published', 1, ?, ?, ?, ?, ?, ?)`,
        [
          id(90),
          ids.workspace,
          ids.definition,
          ids.contract,
          digestProviderValue(renamed),
          JSON.stringify(renamed),
          "renamed-declaration",
          digestProviderValue(renamed),
          new Date(now.getTime() + 1_000),
          new Date(now.getTime() + 1_000),
        ],
      );
      const read = await capabilityRuns.get(scope, ids.run, now);
      expect(read.inputDeclarations).toEqual(declaration.parameters);
      expect(read.outputDeclarations).toEqual(declaration.outputs);
      const replay = await capabilityRuns.createDirect({
        scope,
        invocationKind: "canvas",
        invocationReferenceId: "canvas-operation-1",
        contractRevisionId: ids.contract,
        idempotencyKey: "canvas-operation-1",
        input: { sourceArtifactId: id(99) },
        runId: id(91),
        attemptId: id(92),
        outboxEventId: id(93),
        now,
        audit: audit(94),
      });
      expect(replay.replayed).toBe(true);
      expect(replay.run.inputDeclarations).toEqual(declaration.parameters);
      expect(replay.run.outputDeclarations).toEqual(declaration.outputs);
      // Legacy rows have no pin: later publications must still be excluded.
      await pool.execute(
        "UPDATE capability_run SET declaration_revision_id = NULL WHERE id = ?",
        [ids.run],
      );
      const legacy = await capabilityRuns.get(scope, ids.run, now);
      expect(legacy.inputDeclarations).toEqual(declaration.parameters);
      expect(legacy.outputDeclarations).toEqual(declaration.outputs);
      const [directFacts] = await pool.query<
        (RowDataPacket & {
          readonly nodeRunId: string | null;
          readonly invocationKind: string;
          readonly workflowCount: number | string;
          readonly skillCount: number | string;
        })[]
      >(
        `SELECT
           capability.node_run_id AS nodeRunId,
           capability.invocation_kind AS invocationKind,
           (SELECT COUNT(*) FROM workflow_revision) AS workflowCount,
           (SELECT COUNT(*) FROM skill_revision) AS skillCount
         FROM capability_run AS capability
         WHERE capability.id = ?`,
        [ids.run],
      );
      expect(directFacts[0]).toMatchObject({
        nodeRunId: null,
        invocationKind: "canvas",
      });
      expect(Number(directFacts[0]?.workflowCount)).toBe(0);
      expect(Number(directFacts[0]?.skillCount)).toBe(0);

      const userRun = await capabilityRuns.createDirect({
        scope,
        invocationKind: "user",
        invocationReferenceId: "capability-test-1",
        contractRevisionId: ids.contract,
        idempotencyKey: "capability-test-1",
        input: { sourceArtifactId: id(99) },
        runId: ids.userRun,
        attemptId: ids.userAttempt,
        outboxEventId: ids.userDispatch,
        now,
        audit: audit(52),
      });
      expect(userRun.run).toMatchObject({
        id: ids.userRun,
        invocationKind: "user",
        lifecycleStatus: "queued",
      });

      const engine = createWorkflowEngineStore(pool, {
        enabledExecutionTargets: ["worker"],
      });
      const claimedAt = new Date(now.getTime() + 1);
      const leaseTokenHash = "b".repeat(64);
      const claim = await engine.claimAttempt({
        capabilityRunId: ids.run,
        attemptId: ids.attempt,
        leaseTokenHash,
        now: claimedAt,
        leaseUntil: new Date(claimedAt.getTime() + 30_000),
        executionGeneration: 1,
        expectedExecutionTarget: "worker",
        delivery: {
          consumerName: "attempt-dispatch.v1",
          eventId: ids.dispatch,
          workspaceId: scope.workspaceId,
          messageType: "attempt.dispatch.requested",
          schemaVersion: 1,
          aggregateType: "capability_attempt",
          aggregateId: ids.attempt,
          aggregateVersion: 1,
          expectedGeneration: 1,
          receivedAt: claimedAt,
        },
      });
      expect(claim).toMatchObject({
        deliveryStatus: "processed",
        value: {
          invocationKind: "canvas",
          capabilityRunId: ids.run,
          attemptId: ids.attempt,
        },
      });
      if (claim.deliveryStatus !== "processed" || !claim.value) {
        throw new Error("Direct Capability Attempt was not claimed.");
      }
      const claimed = claim.value;
      expect(claimed).not.toHaveProperty("workflowRunId");
      expect(
        await engine.markAttemptStarted({
          capabilityRunId: ids.run,
          attemptId: ids.attempt,
          leaseTokenHash,
          leaseGeneration: claimed.leaseGeneration,
          now: new Date(claimedAt.getTime() + 2),
        }),
      ).toBe(true);
      const completed = await createAtomicAttemptCompletionStore(pool, {
        instanceId,
      }).complete({
        workspaceId: scope.workspaceId,
        capabilityRunId: ids.run,
        attemptId: ids.attempt,
        completionId: ids.completion,
        terminalOutboxEventId: ids.terminal,
        executionGeneration: 1,
        target: {
          executionTarget: "worker",
          implementationRevisionId: ids.implementation,
          implementationDigest,
          adapterKey: "test.image.shared.v1",
          domainLeaseTokenHash: leaseTokenHash,
          attemptLeaseGeneration: claimed.leaseGeneration,
        },
        capabilityOutput: { imageArtifactId: id(99) },
        outputs: [],
        initialUsage: [],
        now: new Date(claimedAt.getTime() + 3),
      });
      expect(completed.status).toBe("completed");
      const successfulRecords = await operations.list({
        authority: supportScope,
        query: { reference: ids.run, status: "succeeded" },
        now,
      });
      expect(successfulRecords.items.map((item) => item.id)).toEqual([ids.run]);
      const completedTimeline = await operations.get({
        authority: supportScope,
        workflowRunId: ids.run,
        kind: "capability",
        now,
      });
      expect(
        completedTimeline.items.some(
          (item) => item.source === "artifact_commit",
        ),
      ).toBe(false);
      await pool.execute(
        `INSERT INTO artifact (id, workspace_id, created_by_capability_run_id, structured_content, content_digest, artifact_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, 'text.summary', '{}', ?)`,
        [
          id(95),
          ids.workspace,
          ids.run,
          JSON.stringify({ text: "Completed result" }),
          digestProviderValue({ text: "Completed result" }),
          now,
        ],
      );
      await pool.execute(
        "INSERT INTO attempt_output (id, workspace_id, capability_attempt_id, output_role, output_index, artifact_id, created_at) VALUES (?, ?, ?, 'summary', 0, ?, ?)",
        [id(96), ids.workspace, ids.attempt, id(95), now],
      );
      const materializedTimeline = await operations.get({
        authority: supportScope,
        workflowRunId: ids.run,
        kind: "capability",
        now,
      });
      expect(
        materializedTimeline.items.some(
          (item) =>
            item.source === "artifact_commit" && item.resourceId === id(95),
        ),
      ).toBe(true);

      const [terminalRows] = await pool.query<
        (RowDataPacket & { readonly payload: unknown })[]
      >("SELECT payload FROM outbox_event WHERE id = ?", [ids.terminal]);
      expect(terminalRows[0]?.payload).toMatchObject({
        invocationKind: "canvas",
        capabilityRunId: ids.run,
      });
      expect(terminalRows[0]?.payload).not.toHaveProperty("workflowRunId");

      const userClaimedAt = new Date(now.getTime() + 10);
      const userLeaseTokenHash = "c".repeat(64);
      const userClaim = await engine.claimAttempt({
        capabilityRunId: ids.userRun,
        attemptId: ids.userAttempt,
        leaseTokenHash: userLeaseTokenHash,
        now: userClaimedAt,
        leaseUntil: new Date(userClaimedAt.getTime() + 30_000),
        executionGeneration: 1,
        expectedExecutionTarget: "worker",
        delivery: {
          consumerName: "attempt-dispatch.v1",
          eventId: ids.userDispatch,
          workspaceId: scope.workspaceId,
          messageType: "attempt.dispatch.requested",
          schemaVersion: 1,
          aggregateType: "capability_attempt",
          aggregateId: ids.userAttempt,
          aggregateVersion: 1,
          expectedGeneration: 1,
          receivedAt: userClaimedAt,
        },
      });
      expect(userClaim).toMatchObject({
        deliveryStatus: "processed",
        value: {
          invocationKind: "user",
          capabilityRunId: ids.userRun,
          attemptId: ids.userAttempt,
        },
      });
      if (userClaim.deliveryStatus !== "processed" || !userClaim.value) {
        throw new Error("User Capability Attempt was not claimed.");
      }
      expect(userClaim.value).not.toHaveProperty("workflowRunId");
      expect(
        await engine.markAttemptStarted({
          capabilityRunId: ids.userRun,
          attemptId: ids.userAttempt,
          leaseTokenHash: userLeaseTokenHash,
          leaseGeneration: userClaim.value.leaseGeneration,
          now: new Date(userClaimedAt.getTime() + 1),
        }),
      ).toBe(true);
      await expect(
        createAtomicAttemptCompletionStore(pool, { instanceId }).complete({
          workspaceId: scope.workspaceId,
          capabilityRunId: ids.userRun,
          attemptId: ids.userAttempt,
          completionId: ids.userCompletion,
          terminalOutboxEventId: ids.userTerminal,
          executionGeneration: 1,
          target: {
            executionTarget: "worker",
            implementationRevisionId: ids.implementation,
            implementationDigest,
            adapterKey: "test.image.shared.v1",
            domainLeaseTokenHash: userLeaseTokenHash,
            attemptLeaseGeneration: userClaim.value.leaseGeneration,
          },
          capabilityOutput: { imageArtifactId: id(98) },
          outputs: [],
          initialUsage: [],
          now: new Date(userClaimedAt.getTime() + 2),
        }),
      ).resolves.toMatchObject({ status: "completed" });
      const [userTerminalRows] = await pool.query<
        (RowDataPacket & { readonly payload: unknown })[]
      >("SELECT payload FROM outbox_event WHERE id = ?", [ids.userTerminal]);
      expect(userTerminalRows[0]?.payload).toMatchObject({
        invocationKind: "user",
        capabilityRunId: ids.userRun,
      });
      expect(userTerminalRows[0]?.payload).not.toHaveProperty("workflowRunId");

      await insertCapabilityImplementationFixture(pool, {
        workspaceId: scope.workspaceId,
        contractRevisionId: ids.contract,
        adapterDefinitionId: ids.replacementAdapterDefinition,
        adapterRevisionId: ids.replacementAdapterRevision,
        adapterKey: "test.image.shared.v2",
        executionTarget: "worker",
        implementationId: ids.replacementImplementation,
        implementationKey: "test.image.shared.worker.v2",
        canonicalDigest: digestProviderValue({ implementation: 2 }),
        createdAt: now,
      });
      await pool.execute(
        `UPDATE capability_implementation_revision
         SET lifecycle_status = 'deprecated'
         WHERE workspace_id = ? AND id = ?`,
        [scope.workspaceId, ids.implementation],
      );
      await pool.execute(
        `UPDATE capability_binding
         SET implementation_revision_id = ?, version = version + 1,
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
        [ids.replacementImplementation, now, scope.workspaceId, ids.binding],
      );

      const workflowAfter = await createWorkflowAuthoringStore(
        pool,
      ).listCapabilities(scope, now);
      const agentAfter = await definitions.searchAgentCatalog(
        scope,
        undefined,
        20,
        now,
      );
      const canvasAfter = await capabilityRuns.listCanvasCapabilities(
        scope,
        {
          actionGroup: "image.edit",
          selectedSemanticType: "artifact.image",
          locale: "en-US",
        },
        now,
      );
      expect(publicIdentity(workflowAfter[0]!)).toEqual(expectedIdentity);
      expect(
        publicIdentity({
          contractKey: agentAfter[0]!.key,
          revision: agentAfter[0]!.contractRevision,
          canonicalDigest: contractDigest,
          authoring: agentAfter[0]!.declaration,
        }),
      ).toEqual(expectedIdentity);
      expect(canvasAfter[0]?.contractRevisionId).toBe(ids.contract);
      expect(
        await capabilityRuns.listUserCapabilities(scope, "en-US", now, []),
      ).toEqual([]);
      expect(
        (
          await capabilityRuns.listUserCapabilities(scope, "en-US", now, [
            ids.contract,
          ])
        ).map((item) => item.contractRevisionId),
      ).toEqual([ids.contract]);

      await pool.execute(
        "INSERT INTO instance_administrator (principal_id, status, version, created_at, updated_at) VALUES (?, 'active', 1, ?, ?)",
        [scope.principalId, now, now],
      );
      const siteAuthority: TrustedInstanceAdministratorScope = {
        instanceId,
        principalId: scope.principalId,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: scope.authenticationRefId,
        authorityType: "instance_administrator",
        authorityId: scope.principalId,
        authorityVersion: 1,
        authorizationModelVersion: 1,
        trusted: true,
      };
      const toolStore = createSiteToolStore(pool, { instanceId });
      expect(
        await toolStore.integrations(
          siteAuthority,
          { workspaceId: scope.workspaceId },
          "en-US",
        ),
      ).toMatchObject({
        items: [
          {
            contractRevisionId: ids.contract,
            workspaceId: scope.workspaceId,
            workspaceName: "Capability Consumers",
            displayName: "Shared image processing",
            contractDigest,
          },
        ],
        truncated: false,
      });
      expect(
        (
          await toolStore.integrations(
            siteAuthority,
            { query: "nonexistent" },
            "en-US",
          )
        ).items,
      ).toEqual([]);
      expect(
        (
          await toolStore.integrations(
            siteAuthority,
            { workspaceId: id(999) },
            "en-US",
          )
        ).items,
      ).toEqual([]);
      await expect(
        toolStore.integrations(
          { ...siteAuthority, authorityVersion: 99 },
          {},
          "en-US",
        ),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });

      // A tool grant is checked in the same transaction as run and dispatch creation.
      const toolId = id(800);
      const toolRevisionId = id(801);
      const toolSessionId = id(802);
      const toolDigest = digestProviderValue({ html: "tool-test" });
      await pool.execute(
        "INSERT INTO site_tool (id, instance_id, slug, display_name, summary, description_markdown, tags, created_by_principal_id, created_at, updated_at) VALUES (?, ?, 'integration-test-tool', 'Test tool', '', '', '[]', ?, ?, ?)",
        [toolId, instanceId, scope.principalId, now, now],
      );
      await pool.execute(
        "INSERT INTO site_tool_revision (id, instance_id, tool_id, revision_number, release_notes, source_filename, source_bytes, source_sha256, byte_size, allowed_contract_revision_ids, revision_digest, check_status, check_policy_version, lifecycle_status, created_by_principal_id, published_by_principal_id, created_at, published_at) VALUES (?, ?, ?, 1, '', 'tool.html', ?, ?, 7, ?, ?, 'passed', 'kanvas.html-tool/self-contained-v1', 'published', ?, ?, ?, ?)",
        [
          toolRevisionId,
          instanceId,
          toolId,
          Buffer.from("<html/>"),
          "a".repeat(64),
          JSON.stringify([ids.contract]),
          toolDigest,
          scope.principalId,
          scope.principalId,
          now,
          now,
        ],
      );
      await pool.execute(
        "UPDATE site_tool SET published_revision_id=? WHERE id=?",
        [toolRevisionId, toolId],
      );
      await pool.execute(
        "INSERT INTO site_tool_session (id, instance_id, workspace_id, tool_id, revision_id, revision_digest, principal_id, authentication_ref_hash, execution_epoch, session_kind, maximum_runs, allowed_contract_revision_ids, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'use', 1, ?, ?, ?)",
        [
          toolSessionId,
          instanceId,
          scope.workspaceId,
          toolId,
          toolRevisionId,
          toolDigest,
          scope.principalId,
          toolSessionAuthenticationHash(scope.authenticationRefId),
          JSON.stringify([ids.contract]),
          now,
          new Date(now.getTime() + 60000),
        ],
      );
      const toolRequest = (offset: number, requestKey = "first") => ({
        scope,
        invocationKind: "user" as const,
        invocationReferenceId: `tool:${toolSessionId}`,
        contractRevisionId: ids.contract,
        idempotencyKey: `tool:${toolSessionId}:${requestKey}`,
        input: { sourceArtifactId: id(90) },
        runId: id(offset),
        attemptId: id(offset + 1),
        outboxEventId: id(offset + 2),
        now,
        audit: audit(offset + 3),
        toolSession: { sessionId: toolSessionId, requestKey },
      });
      await expect(
        capabilityRuns.createDirect({
          ...toolRequest(810),
          contractRevisionId: id(899),
        }),
      ).rejects.toThrow("not granted");
      const [toolRun, toolReplay] = await Promise.all([
        capabilityRuns.createDirect(toolRequest(810)),
        capabilityRuns.createDirect(toolRequest(820)),
      ]);
      expect(toolRun.run.id).toBe(toolReplay.run.id);
      expect([toolRun.replayed, toolReplay.replayed].sort()).toEqual([
        false,
        true,
      ]);
      await expect(
        capabilityRuns.createDirect(toolRequest(830, "over-limit")),
      ).rejects.toThrow("execution limit");
      const disable = await pool.getConnection();
      try {
        await disable.beginTransaction();
        await disable.execute(
          "SELECT instance_id FROM instance_runtime_state WHERE instance_id=? FOR UPDATE",
          [instanceId],
        );
        await disable.execute(
          "UPDATE site_tool SET usage_status='disabled', execution_epoch=execution_epoch+1 WHERE id=?",
          [toolId],
        );
        const racingRun = capabilityRuns.createDirect(
          toolRequest(840, "disable-race"),
        );
        const denied = expect(racingRun).rejects.toThrow(
          "availability_changed",
        );
        await disable.commit();
        await denied;
      } finally {
        await disable.rollback();
        disable.release();
      }
      await pool.execute(
        "UPDATE site_tool SET usage_status='enabled', execution_epoch=execution_epoch+1 WHERE id=?",
        [toolId],
      );
      await expect(
        capabilityRuns.createDirect(toolRequest(850, "old-session")),
      ).rejects.toThrow("availability_changed");
      const [toolRuns] = await pool.execute<
        (RowDataPacket & { capability_run_id: string })[]
      >(
        "SELECT capability_run_id FROM site_tool_session_run WHERE session_id=?",
        [toolSessionId],
      );
      expect(toolRuns.map((row) => row.capability_run_id)).toEqual([
        toolRun.run.id,
      ]);
      const [blockedDispatches] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM outbox_event WHERE id IN (?, ?, ?)",
        [id(832), id(842), id(852)],
      );
      expect(blockedDispatches).toEqual([]);
      const retainedRun = await capabilityRuns.get(scope, toolRun.run.id, now);
      const beforeDelete = (await toolStore.detail(siteAuthority, toolId)).tool;
      const disabledForDelete = await toolStore.mutate(
        siteAuthority,
        "retention-disable",
        {
          kind: "availability",
          toolId,
          expectedVersion: beforeDelete.version,
          enabled: false,
        },
      );
      await toolStore.mutate(siteAuthority, "retention-delete", {
        kind: "delete",
        toolId,
        expectedVersion: disabledForDelete.version,
      });
      expect(await capabilityRuns.get(scope, toolRun.run.id, now)).toEqual(
        retainedRun,
      );
      const [retainedLinks] = await pool.execute<
        (RowDataPacket & { capability_run_id: string })[]
      >(
        "SELECT capability_run_id FROM site_tool_session_run WHERE session_id=?",
        [toolSessionId],
      );
      expect(retainedLinks.map((row) => row.capability_run_id)).toEqual([
        toolRun.run.id,
      ]);

      await pool.execute(
        "UPDATE capability_contract_revision SET supported_invokers = JSON_ARRAY('canvas') WHERE workspace_id = ? AND id = ?",
        [scope.workspaceId, ids.contract],
      );
      expect(
        await capabilityRuns.listUserCapabilities(scope, "en-US", now),
      ).toEqual([]);
      await pool.execute(
        "UPDATE capability_contract_revision SET supported_invokers = JSON_ARRAY('user', 'canvas') WHERE workspace_id = ? AND id = ?",
        [scope.workspaceId, ids.contract],
      );
      const libraryScope: TrustedWorkspaceScope = {
        ...scope,
        effectivePermissions: [
          ...scope.effectivePermissions,
          "library.read",
          "library.manage",
        ],
      };
      const libraries = createResourceLibraryStore(pool);
      await libraries.save({
        authority: libraryScope,
        libraryId: id(901),
        revisionId: id(902),
        expectedVersion: 0,
        requestKey: "consumer-library",
        document: {
          schemaVersion: 1,
          name: "Consumer authorization fixture",
          description: "",
          entries: [],
        },
        audit: {
          auditEventId: id(903),
          authenticationRefHash: digestProviderValue("session"),
        },
        now,
      });
      // Authorization fixture only; storage identity and actual image bytes are tested by the resolver suite.
      await pool.execute(
        "INSERT INTO artifact (id, workspace_id, structured_content, content_digest, artifact_type, availability_status, data_classification, metadata, created_at) VALUES (?, ?, '{}', ?, 'document.text', 'available', 'internal', '{}', ?)",
        [id(904), scope.workspaceId, digestProviderValue({}), now],
      );
      await pool.execute(
        "INSERT INTO resource_library_upload (workspace_id, library_id, artifact_id, created_by_principal_id, created_at) VALUES (?, ?, ?, ?, ?)",
        [scope.workspaceId, id(901), id(904), scope.principalId, now],
      );
      const libraryRun = await capabilityRuns.createDirect({
        scope: libraryScope,
        invocationKind: "canvas",
        invocationReferenceId: "library-consumer",
        contractRevisionId: ids.contract,
        idempotencyKey: "library-consumer",
        input: { sourceArtifactId: id(904) },
        runId: id(905),
        attemptId: id(906),
        outboxEventId: id(907),
        now,
        audit: audit(908),
      });
      const consumerAccess = createLibraryConsumerAccessStore(pool);
      const consumerRequest = {
        workspaceId: scope.workspaceId,
        capabilityRunId: libraryRun.run.id,
        artifactId: id(904),
        now,
      };
      await expect(
        consumerAccess.authorizeArtifact(consumerRequest),
      ).resolves.toBeUndefined();
      await expect(
        consumerAccess.authorizeArtifact({
          ...consumerRequest,
          now: new Date(now.getTime() + 86_400_000),
        }),
      ).rejects.toMatchObject({
        code: "resource_library.consumer_unauthorized",
      });
      await pool.execute(
        "UPDATE capability_run SET cancel_requested_at = ?, cancel_deadline_at = ? WHERE id = ?",
        [now, now, libraryRun.run.id],
      );
      await expect(
        consumerAccess.authorizeArtifact(consumerRequest),
      ).rejects.toMatchObject({
        code: "resource_library.consumer_unauthorized",
      });
      await pool.execute(
        "UPDATE capability_run SET cancel_requested_at = NULL, cancel_deadline_at = NULL WHERE id = ?",
        [libraryRun.run.id],
      );
      await expect(
        consumerAccess.authorizeArtifact({
          ...consumerRequest,
          capabilityRunId: ids.run,
        }),
      ).rejects.toMatchObject({
        code: "resource_library.consumer_unauthorized",
      });
      await pool.execute(
        "UPDATE capability_binding SET lifecycle_status = 'revoked' WHERE workspace_id = ? AND id = ?",
        [scope.workspaceId, ids.binding],
      );
      expect(
        await capabilityRuns.listUserCapabilities(scope, "en-US", now),
      ).toEqual([]);
      await pool.execute(
        "UPDATE workspace_membership SET status = 'revoked' WHERE workspace_id = ? AND id = ?",
        [scope.workspaceId, scope.authorityId],
      );
      await expect(
        consumerAccess.authorizeArtifact(consumerRequest),
      ).rejects.toMatchObject({ code: "authorization.forbidden" });
      await expect(
        capabilityRuns.listUserCapabilities(scope, "en-US", now),
      ).rejects.toThrow();
    });
  },
);
