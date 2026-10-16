import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import { compileCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCapabilityBindingAdminStore } from "../src/runtime/capability-binding-admin-store.js";
import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";
import { createCapabilityImplementationAdminStore } from "../src/runtime/capability-implementation-admin-store.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { createWorkflowAuthoringStore } from "../src/runtime/workflow-authoring-store.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-01T10:00:00.000Z");
const emptySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({}),
});
const inputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1" as const,
  direction: "input" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "input" as const,
    pointer: "",
  }),
});
const outputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1" as const,
  direction: "output" as const,
  expression: Object.freeze({
    op: "source" as const,
    root: "result" as const,
    pointer: "",
  }),
});
const compiledInputMapping = compileCapabilityMappingPlanV1({
  document: inputMapping,
  sourceSchemas: { input: emptySchema, configuration: emptySchema },
  targetSchema: emptySchema,
});
const compiledOutputMapping = compileCapabilityMappingPlanV1({
  document: outputMapping,
  sourceSchemas: { result: emptySchema, configuration: emptySchema },
  targetSchema: emptySchema,
});

interface BindingStateRow extends RowDataPacket {
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly implementationId: string;
  readonly implementationRevision: number;
  readonly implementationStatus: string;
}

describe.skipIf(!enabled)(
  "Capability core control plane against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "capability-core-control-plane",
      authorityType: "human_membership",
      authorityId: id(4),
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
           VALUES (?, 'capability-core-control-plane', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'capability-core', 'Capability Core',
             'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'capability-core', 'Capability Core',
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

    it("publishes, orders, pauses, replaces, and replays run methods without rewriting revisions", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const definitionStore = createCapabilityDefinitionAdminStore(pool);
      const implementationStore =
        createCapabilityImplementationAdminStore(pool);
      const bindingStore = createCapabilityBindingAdminStore(pool);
      const declaration = {
        schemaVersion: "kanvas.capability-declaration/v1",
        origin: "declared",
        catalog: {
          title: { "zh-CN": "示例能力", "en-US": "Example capability" },
          category: { "zh-CN": "测试", "en-US": "Test" },
          sourceKind: "plugin",
          tags: ["test"],
          surfaces: ["workflow", "agent"],
        },
        parameters: [],
        outputs: [],
      } satisfies WorkflowCapabilityAuthoringDeclaration;
      const contractDigest = digestProviderValue({
        inputSchema: emptySchema,
        outputSchema: emptySchema,
        idempotencyMode: "keyed",
        supportedInvokers: ["workflow", "agent"],
      });
      await definitionStore.create({
        scope,
        definitionId: id(10),
        contractRevisionId: id(11),
        declarationRevisionId: id(12),
        key: "document.example.process",
        inputSchema: emptySchema,
        outputSchema: emptySchema,
        idempotencyMode: "keyed",
        supportedInvokers: ["workflow", "agent"],
        contractDigest,
        declaration,
        declarationDigest: digestProviderValue({ contractDigest, declaration }),
        requestHash: digestProviderValue({ command: "create" }),
        idempotencyKey: "create-capability-core-example",
        now,
        audit: audit(60),
      });

      expect(
        await definitionStore.searchAgentCatalog(scope, undefined, 20, now),
      ).toEqual([]);
      expect(
        await createWorkflowAuthoringStore(pool).listCapabilities(scope, now),
      ).toEqual([]);

      const adapterKey = "test.document.processor.v1";
      const adapterRevisionId = id(31);
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: scope.workspaceId,
        contractRevisionId: id(11),
        adapterDefinitionId: id(30),
        adapterRevisionId,
        adapterKey,
        executionTarget: "worker",
        implementationId: id(32),
        implementationKey: "fixture.unbound.processor",
        canonicalDigest: digestProviderValue({ fixture: true }),
        createdAt: now,
      });
      const adapterDigest = digestProviderValue({
        adapterKey,
        adapterRevisionId,
      });
      const publication = (options: {
        readonly implementationRevisionId: string;
        readonly implementationKey: string;
        readonly implementationRevision: number;
        readonly bindingId: string;
        readonly bindingKey: string;
        readonly priority: number;
        readonly requestKey: string;
        readonly auditId: number;
        readonly replaceBinding?: Readonly<{
          bindingId: string;
          expectedVersion: number;
        }>;
      }) => ({
        scope,
        definitionId: id(10),
        expectedDefinitionVersion: 1,
        contractRevisionId: id(11),
        runtimeAdapterRevisionId: adapterRevisionId,
        expectedRuntimeAdapterDigest: adapterDigest,
        implementationRevisionId: options.implementationRevisionId,
        implementationKey: options.implementationKey,
        implementationRevision: options.implementationRevision,
        displayName: {
          defaultLocale: "en-US" as const,
          values: { "en-US": options.implementationKey },
        },
        executionTarget: "worker" as const,
        adapterKey,
        sourceKind: "plugin" as const,
        sourceReference: {
          kind: "plugin",
          plugin: {
            key: "kanvas.test-runtime",
            revision: 1,
            canonicalDigest: adapterDigest,
          },
        },
        canonicalDigest: digestProviderValue({
          implementationKey: options.implementationKey,
          implementationRevision: options.implementationRevision,
        }),
        publicationRequestKey: options.requestKey,
        publicationRequestHash: digestProviderValue({
          request: options.requestKey,
        }),
        configuration: {},
        inputMapping,
        inputMappingDigest: digestProviderValue(inputMapping),
        compiledInputMapping,
        outputMapping,
        outputMappingDigest: digestProviderValue(outputMapping),
        compiledOutputMapping,
        fixtureSuite: [{ name: "empty", input: {}, output: {} }],
        bindingId: options.bindingId,
        bindingKey: options.bindingKey,
        priority: options.priority,
        routePolicy: {
          retryPolicy: {
            maxAttempts: 1,
            backoff: "fixed",
            initialDelayMs: 0,
            maxDelayMs: 0,
          },
          attemptTimeoutMs: 120_000,
          fallbackOn: [],
          eligibility: {},
        },
        ...(options.replaceBinding
          ? { replaceBinding: options.replaceBinding }
          : {}),
        now,
        audit: audit(options.auditId),
      });

      const first = publication({
        implementationRevisionId: id(40),
        implementationKey: "document.example.primary",
        implementationRevision: 1,
        bindingId: id(50),
        bindingKey: "document.example.primary.route",
        priority: 10,
        requestKey: "publish-document-primary-v1",
        auditId: 61,
      });
      const second = publication({
        implementationRevisionId: id(41),
        implementationKey: "document.example.secondary",
        implementationRevision: 1,
        bindingId: id(51),
        bindingKey: "document.example.secondary.route",
        priority: 20,
        requestKey: "publish-document-secondary-v1",
        auditId: 62,
      });
      await expect(implementationStore.publish(first)).resolves.toMatchObject({
        bindingId: id(50),
        version: 1,
        replayed: false,
      });
      await expect(implementationStore.publish(second)).resolves.toMatchObject({
        bindingId: id(51),
        version: 1,
        replayed: false,
      });
      expect(
        await definitionStore.searchAgentCatalog(scope, undefined, 20, now),
      ).toHaveLength(1);
      expect(
        await createWorkflowAuthoringStore(pool).listCapabilities(scope, now),
      ).toHaveLength(1);

      await expect(
        bindingStore.move({
          scope,
          bindingId: id(51),
          expectedVersion: 1,
          adjacentBindingId: id(50),
          expectedAdjacentVersion: 1,
          direction: "earlier",
          now,
          audit: audit(63),
        }),
      ).resolves.toMatchObject({
        bindingId: id(51),
        version: 3,
        adjacentBindingId: id(50),
        adjacentVersion: 2,
      });
      await expect(
        bindingStore.setStatus({
          scope,
          bindingId: id(51),
          expectedVersion: 3,
          status: "disabled",
          now,
          audit: audit(64),
        }),
      ).resolves.toMatchObject({ version: 4 });
      await expect(
        bindingStore.setStatus({
          scope,
          bindingId: id(51),
          expectedVersion: 4,
          status: "active",
          now,
          audit: audit(65),
        }),
      ).resolves.toMatchObject({ version: 5 });

      const replacement = publication({
        implementationRevisionId: id(42),
        implementationKey: "document.example.primary",
        implementationRevision: 2,
        bindingId: id(52),
        bindingKey: "document.example.primary.replacement",
        priority: 10,
        requestKey: "publish-document-primary-v2",
        auditId: 66,
        replaceBinding: { bindingId: id(50), expectedVersion: 2 },
      });
      await expect(implementationStore.publish(replacement)).resolves.toEqual({
        bindingId: id(50),
        version: 3,
        replayed: false,
      });
      await expect(implementationStore.publish(replacement)).resolves.toEqual({
        bindingId: id(50),
        version: 3,
        replayed: true,
      });

      const [rows] = await pool.execute<BindingStateRow[]>(
        `SELECT
           binding.id AS bindingId,
           binding.version AS bindingVersion,
           implementation.id AS implementationId,
           implementation.revision AS implementationRevision,
           implementation.lifecycle_status AS implementationStatus
         FROM capability_implementation_revision AS implementation
         LEFT JOIN capability_binding AS binding
           ON binding.workspace_id = implementation.workspace_id
          AND binding.implementation_revision_id = implementation.id
         WHERE implementation.workspace_id = ?
           AND implementation.implementation_key = 'document.example.primary'
         ORDER BY implementation.revision`,
        [scope.workspaceId],
      );
      expect(rows).toEqual([
        {
          bindingId: null,
          bindingVersion: null,
          implementationId: id(40),
          implementationRevision: 1,
          implementationStatus: "deprecated",
        },
        {
          bindingId: id(50),
          bindingVersion: 3,
          implementationId: id(42),
          implementationRevision: 2,
          implementationStatus: "published",
        },
      ]);
    });

    it("creates the Definition and disabled first run method in one transaction", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const store = createCapabilityDefinitionAdminStore(pool);
      const adapterKey = "test.document.processor.v1";
      const adapterDigest = digestProviderValue({
        adapterKey,
        adapterRevisionId: id(31),
      });
      const declaration = {
        schemaVersion: "kanvas.capability-declaration/v1",
        origin: "declared",
        catalog: {
          title: { "zh-CN": "原子能力", "en-US": "Atomic capability" },
          category: { "zh-CN": "测试", "en-US": "Test" },
          sourceKind: "plugin",
          tags: ["test"],
          surfaces: ["workflow"],
        },
        parameters: [],
        outputs: [],
      } satisfies WorkflowCapabilityAuthoringDeclaration;
      const definition = {
        scope,
        definitionId: id(70),
        contractRevisionId: id(71),
        declarationRevisionId: id(72),
        key: "document.atomic.process",
        inputSchema: emptySchema,
        outputSchema: emptySchema,
        idempotencyMode: "keyed" as const,
        supportedInvokers: ["workflow" as const],
        contractDigest: digestProviderValue({ contract: "atomic" }),
        declaration,
        declarationDigest: digestProviderValue({ declaration: "atomic" }),
        requestHash: digestProviderValue({ request: "atomic" }),
        idempotencyKey: "create-document-atomic",
        now,
        audit: audit(70),
      };
      const implementation = {
        scope,
        definitionId: id(70),
        expectedDefinitionVersion: 1,
        contractRevisionId: id(71),
        runtimeAdapterRevisionId: id(31),
        expectedRuntimeAdapterDigest: adapterDigest,
        implementationRevisionId: id(73),
        implementationKey: "document.atomic.implementation",
        implementationRevision: 1,
        displayName: {
          defaultLocale: "en-US" as const,
          values: { "en-US": "Atomic implementation" },
        },
        executionTarget: "worker" as const,
        adapterKey,
        sourceKind: "plugin" as const,
        sourceReference: {
          kind: "plugin",
          plugin: {
            key: "kanvas.test-runtime",
            revision: 1,
            canonicalDigest: adapterDigest,
          },
        },
        canonicalDigest: digestProviderValue({ implementation: "atomic" }),
        publicationRequestKey: "create-document-atomic",
        publicationRequestHash: digestProviderValue({ publication: "atomic" }),
        configuration: {},
        inputMapping,
        inputMappingDigest: digestProviderValue(inputMapping),
        compiledInputMapping,
        outputMapping,
        outputMappingDigest: digestProviderValue(outputMapping),
        compiledOutputMapping,
        fixtureSuite: [{ name: "empty", input: {}, output: {} }],
        bindingId: id(74),
        bindingKey: "document.atomic.route",
        priority: 10,
        routePolicy: { eligibility: {}, fallbackOn: [] },
        bindingStatus: "disabled" as const,
        now,
        audit: audit(71),
      };
      await expect(
        store.createWithImplementation(definition, implementation),
      ).resolves.toMatchObject({
        definition: { replayed: false },
        implementation: { bindingId: id(74), replayed: false },
      });
      const [bindings] = await pool.execute<
        (RowDataPacket & { lifecycleStatus: string })[]
      >(
        `SELECT lifecycle_status AS lifecycleStatus
         FROM capability_binding
         WHERE workspace_id = ? AND id = ?`,
        [scope.workspaceId, id(74)],
      );
      expect(bindings[0]?.lifecycleStatus).toBe("disabled");

      await expect(
        store.createWithImplementation(
          {
            ...definition,
            definitionId: id(80),
            contractRevisionId: id(81),
            declarationRevisionId: id(82),
            key: "document.atomic.rollback",
            contractDigest: digestProviderValue({ contract: "rollback" }),
            declarationDigest: digestProviderValue({
              declaration: "rollback",
            }),
            idempotencyKey: "create-document-atomic-rollback",
            requestHash: digestProviderValue({ request: "rollback" }),
            audit: audit(72),
          },
          {
            ...implementation,
            definitionId: id(80),
            contractRevisionId: id(81),
            implementationRevisionId: id(83),
            implementationKey: "document.atomic.rollback.implementation",
            bindingId: id(84),
            bindingKey: "document.atomic.rollback.route",
            expectedRuntimeAdapterDigest: `sha256:${"f".repeat(64)}`,
            publicationRequestKey: "create-document-atomic-rollback",
            publicationRequestHash: digestProviderValue({
              publication: "rollback",
            }),
            audit: audit(73),
          },
        ),
      ).rejects.toThrow("Runtime Adapter is no longer available");
      expect(
        (await store.list(scope, now)).some(
          (item) => item.key === "document.atomic.rollback",
        ),
      ).toBe(false);
    });
  },
);
