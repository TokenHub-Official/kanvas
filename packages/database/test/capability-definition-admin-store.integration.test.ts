import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { createWorkflowAuthoringStore } from "../src/runtime/workflow-authoring-store.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-08-29T18:00:00.000Z");

interface RevisionRow extends RowDataPacket {
  readonly revision: number;
  readonly lifecycleStatus: string;
}

describe.skipIf(!integrationEnabled)(
  "Capability Definition administration against disposable MySQL",
  () => {
    let pool: Pool | undefined;
    const scope: TrustedWorkspaceScope = Object.freeze({
      workspaceId: id(1),
      organizationId: id(2),
      principalId: id(3),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "capability-definition-test-session",
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
      authorityVersion: 1,
    });
    const inputSchema = Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: Object.freeze({}),
    });
    const outputSchema = inputSchema;
    const declaration = (description: string) =>
      ({
        schemaVersion: "kanvas.capability-declaration/v1",
        origin: "declared",
        catalog: {
          title: { "zh-CN": "示例能力", "en-US": "Example capability" },
          description: { "zh-CN": description, "en-US": description },
          category: { "zh-CN": "测试", "en-US": "Test" },
          sourceKind: "plugin",
          tags: ["test"],
          surfaces: ["workflow", "agent"],
        },
        parameters: [],
        outputs: [],
      }) satisfies WorkflowCapabilityAuthoringDeclaration;

    beforeAll(async () => {
      pool = createDisposableIntegrationPool(2);
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
           ) VALUES (?, 'capability-definition-test-human', ?)`,
          [scope.principalId, now],
        );
        await connection.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'capability-definition-test',
             'Capability Definition Test', 'active', 1, ?, ?)`,
          [scope.organizationId, now, now],
        );
        await connection.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'capability-definition-test',
             'Capability Definition Test', 'active', 1, ?, ?)`,
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

    it("publishes, revises, replays, archives, and restores without rewriting history", async () => {
      if (!pool) throw new Error("Disposable database is unavailable.");
      const store = createCapabilityDefinitionAdminStore(pool);
      const firstDeclaration = declaration("First revision");
      const firstContractDigest = digestProviderValue({
        revision: 1,
        inputSchema,
        outputSchema,
      });
      const created = await store.create({
        scope,
        definitionId: id(10),
        contractRevisionId: id(11),
        declarationRevisionId: id(12),
        key: "image.example.process",
        inputSchema,
        outputSchema,
        idempotencyMode: "keyed",
        supportedInvokers: ["workflow", "agent"],
        contractDigest: firstContractDigest,
        declaration: firstDeclaration,
        declarationDigest: digestProviderValue(firstDeclaration),
        requestHash: digestProviderValue({ request: 1 }),
        idempotencyKey: "create-example-capability",
        now,
        audit: audit(20),
      });
      expect(created).toMatchObject({
        replayed: false,
        value: {
          key: "image.example.process",
          version: 1,
          contractRevision: 1,
          declarationRevision: 1,
          status: "active",
        },
      });
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: scope.workspaceId,
        contractRevisionId: id(11),
        adapterDefinitionId: id(30),
        adapterRevisionId: id(31),
        adapterKey: "test.image.example.v1",
        executionTarget: "worker",
        implementationId: id(15),
        implementationKey: "test.image.example.worker",
        canonicalDigest: digestProviderValue({ implementation: 1 }),
        createdAt: now,
      });
      await pool.execute(
        `INSERT INTO capability_binding (
           id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status, priority, version,
           route_policy, created_at, updated_at
         ) VALUES (?, ?, 'test.image.example.worker', ?, ?, 'active', 1, 1,
           JSON_OBJECT(), ?, ?)`,
        [id(16), scope.workspaceId, id(11), id(15), now, now],
      );
      const discovered = await store.searchAgentCatalog(
        scope,
        "example",
        20,
        now,
      );
      expect(discovered).toHaveLength(1);
      expect(discovered[0]).toMatchObject({
        key: "image.example.process",
        activeBindingCount: 1,
      });

      const exact = await store.resolveAgentCapability(
        scope,
        "image.example.process",
        now,
      );
      expect(exact?.availability).toEqual({
        status: "ready",
        stage: "invocation",
      });
      expect((await store.list(scope, now))[0]?.agentAvailability).toEqual(
        exact?.availability,
      );
      expect(
        await store.discoverAgentCatalog(scope, { query: "不存在" }, now),
      ).toMatchObject({ items: [], complete: true });

      const metadataUpdateOptions = {
        scope,
        definitionId: id(10),
        declarationRevisionId: id(14),
        expectedVersion: 1,
        title: {
          "zh-CN": "示例能力（更新）",
          "en-US": "Example capability updated",
        },
        description: {
          "zh-CN": "Second revision",
          "en-US": "Second revision",
        },
        category: { "zh-CN": "测试", "en-US": "Test" },
        tags: ["test", "updated"],
        idempotencyKey: "revise-example-capability-metadata",
        now,
        audit: audit(21),
      } as const;
      const metadataUpdate = await store.update(metadataUpdateOptions);
      expect(metadataUpdate.value).toMatchObject({
        version: 2,
        contractRevision: 1,
        declarationRevision: 2,
        activeBindingCount: 1,
        declaration: {
          catalog: {
            title: {
              "zh-CN": "示例能力（更新）",
              "en-US": "Example capability updated",
            },
          },
        },
      });

      await pool.execute(
        `UPDATE capability_binding
         SET lifecycle_status = 'disabled',
             version = version + 1,
             updated_at = ?
         WHERE workspace_id = ?
           AND id = ?`,
        [now, scope.workspaceId, id(16)],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId: scope.workspaceId,
        contractRevisionId: id(11),
        adapterDefinitionId: id(32),
        adapterRevisionId: id(33),
        adapterKey: "test.image.example.provider.v1",
        executionTarget: "provider",
        implementationId: id(19),
        implementationKey: "test.image.example.provider",
        canonicalDigest: digestProviderValue({ implementation: 2 }),
        createdAt: now,
      });
      await pool.execute(
        `INSERT INTO capability_binding (
           id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status, priority, version,
           route_policy, created_at, updated_at
         ) VALUES (?, ?, 'test.image.example.provider', ?, ?, 'active', 2, 1,
           JSON_OBJECT(), ?, ?)`,
        [id(20), scope.workspaceId, id(11), id(19), now, now],
      );
      expect(await store.searchAgentCatalog(scope, undefined, 20, now)).toEqual(
        [],
      );
      const excluded = await store.discoverAgentCatalog(
        scope,
        { query: "example" },
        now,
      );
      expect(excluded).toMatchObject({
        complete: true,
        items: [
          {
            capability: { key: "image.example.process" },
            availability: {
              status: "unavailable",
              stage: "binding",
              reason: "provider_unconfigured",
            },
          },
        ],
      });
      expect((await store.list(scope, now))[0]?.agentAvailability).toEqual(
        excluded.items[0]?.availability,
      );

      const preflight = spawnSync(
        process.execPath,
        [
          resolve(import.meta.dirname, "../dist/cli/deployment-readiness.js"),
          "--workspace-id",
          scope.workspaceId,
        ],
        {
          env: {
            ...process.env,
            KANVAS_WORKER_ROLES:
              "agent,provider-execution,reconciler,maintenance",
            KANVAS_PROVIDER_ACTIVE_KEK_VERSION: "",
            KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON: "",
          },
          encoding: "utf8",
        },
      );
      expect(preflight.status, preflight.stderr).toBe(2);
      const readiness = JSON.parse(preflight.stdout) as {
        configurationIssues: string[];
        workspaces: { capabilityReadiness: unknown[] }[];
      };
      expect(readiness.configurationIssues.join(" ")).not.toContain(
        "KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON",
      );
      expect(readiness.configurationIssues.join(" ")).not.toContain(
        "encryption key",
      );
      expect(readiness.workspaces[0]?.capabilityReadiness).toContainEqual({
        key: "image.example.process",
        ready: false,
        reason: "provider_unconfigured",
      });
      expect(
        await createWorkflowAuthoringStore(pool).listCapabilities(scope, now),
      ).toEqual([]);
      expect(
        (
          await store.update({
            ...metadataUpdateOptions,
            audit: audit(23),
          })
        ).replayed,
      ).toBe(true);
      const [revisions] = await pool.execute<RevisionRow[]>(
        `SELECT revision, lifecycle_status AS lifecycleStatus
         FROM capability_contract_revision
         WHERE workspace_id = ?
           AND contract_key = 'image.example.process'
         ORDER BY revision`,
        [scope.workspaceId],
      );
      expect(revisions).toEqual([
        expect.objectContaining({ revision: 1, lifecycleStatus: "published" }),
      ]);

      const archived = await store.setStatus({
        scope,
        definitionId: id(10),
        expectedVersion: 2,
        status: "archived",
        now,
        audit: audit(24),
      });
      expect(archived.value).toMatchObject({ status: "archived", version: 3 });
      const restored = await store.setStatus({
        scope,
        definitionId: id(10),
        expectedVersion: 3,
        status: "active",
        now,
        audit: audit(25),
      });
      expect(restored.value).toMatchObject({ status: "active", version: 4 });
    });
    it("pages candidates and finds exact keys beyond the old 500-row cap", async () => {
      if (!pool) throw new Error("Pool unavailable");
      const store = createCapabilityDefinitionAdminStore(pool);
      for (let i = 0; i < 502; i += 1) {
        const n = 1000 + i * 4;
        await store.create({
          scope,
          definitionId: id(n),
          contractRevisionId: id(n + 1),
          declarationRevisionId: id(n + 2),
          key: `image.page.${String(i).padStart(3, "0")}`,
          inputSchema,
          outputSchema,
          idempotencyMode: "keyed",
          supportedInvokers: ["agent"],
          contractDigest: digestProviderValue({ page: i }),
          declaration: declaration("Paging fixture"),
          declarationDigest: digestProviderValue(declaration("Paging fixture")),
          requestHash: digestProviderValue({ page: i }),
          idempotencyKey: `page-${i}`,
          now,
          audit: audit(n + 3),
        });
      }
      const first = await store.discoverAgentCatalog(
        scope,
        { query: "image.page", limit: 20 },
        now,
      );
      expect(first.items).toHaveLength(20);
      expect(first.complete).toBe(false);
      expect(first.nextCursor).toBe("image.page.019");
      const second = await store.discoverAgentCatalog(
        scope,
        { query: "image.page", afterKey: first.nextCursor!, limit: 20 },
        now,
      );
      expect(second.items[0]?.capability.key).toBe("image.page.020");
      const tail = await store.discoverAgentCatalog(
        scope,
        { query: "image.page.501" },
        now,
      );
      expect(tail).toMatchObject({
        complete: true,
        items: [
          {
            capability: { key: "image.page.501" },
            availability: { reason: "binding_unavailable" },
          },
        ],
      });
      const exact = await store.resolveAgentCapability(
        scope,
        "image.page.501",
        now,
      );
      expect(exact).toEqual(tail.items[0]);
    }, 60_000);
  },
);
