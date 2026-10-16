import { backfillWorkspaceSystemCatalog } from "../src/runtime/workspace-system-catalog.js";
import { backfillDefaultProviderPolicies } from "../src/runtime/default-provider-policy.js";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { defaultAgentWorkspaceProfileV1 } from "@kanvas/application";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { prepareCatalogPackageV1 } from "../src/cli/catalog-package-installer.js";
import { loadCatalogPackageV1 } from "../src/cli/catalog-package-loader.js";
import {
  createInstanceBootstrapStore,
  digestInstanceSetupBinding,
  digestInstanceSetupToken,
  instanceSetupTokenPrefix,
} from "../src/runtime/instance-bootstrap-store.js";
import { resetDisposableIntegrationDatabase } from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const instanceId = "instance-bootstrap-integration";
const issuedAt = new Date("2026-07-28T12:00:00.000Z");
const redeemedAt = new Date("2026-07-28T12:01:00.000Z");
const boundToken = "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567";
const concurrentToken = `knv_setup_v1_${"B".repeat(43)}`;

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface BootstrapFactRow extends RowDataPacket {
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly administratorCount: number | string;
  readonly organizationCount: number | string;
  readonly workspaceCount: number | string;
  readonly organizationOwnerCount: number | string;
  readonly workspaceOwnerCount: number | string;
  readonly capabilityDefinitionCount: number | string;
  readonly capabilityCatalogCount: number | string;
  readonly modelCatalogCount: number | string;
  readonly modelResourceCount: number | string;
  readonly workflowRevisionCount: number | string;
  readonly skillRevisionCount: number | string;
  readonly agentProfileCount: number | string;
  readonly agentSurfaceBindingCount: number | string;
  readonly systemDefaultAgentCount: number | string;
}

function redeemOptions(
  serial: number,
  token: string,
  overrides: Readonly<{
    now?: Date;
    verifiedEmail?: string;
  }> = {},
) {
  return {
    tokenHash: digestInstanceSetupToken(token),
    authSubjectId: "better-auth-user-1",
    verifiedEmail: overrides.verifiedEmail ?? "Owner@Example.com",
    principalId: identity(8_100_000 + serial * 10 + 1),
    organizationId: identity(8_100_000 + serial * 10 + 2),
    organizationMembershipId: identity(8_100_000 + serial * 10 + 3),
    organizationSlug: `kanvas-${String(serial)}`,
    organizationName: `Kanvas ${String(serial)}`,
    workspaceId: identity(8_100_000 + serial * 10 + 4),
    workspaceMembershipId: identity(8_100_000 + serial * 10 + 5),
    workspaceSlug: `design-${String(serial)}`,
    workspaceName: `Design ${String(serial)}`,
    now: overrides.now ?? redeemedAt,
    authenticationRefHash: digest("b"),
    requestId: `bootstrap-request-${String(serial)}`,
    traceId: `bootstrap-trace-${String(serial)}`,
    auditEventId: identity(8_100_000 + serial * 10 + 6),
  };
}

describe.skipIf(!integrationEnabled)(
  "InstanceBootstrapStore against disposable MySQL 8.0",
  () => {
    let pool!: Pool;

    beforeAll(async () => {
      const config = loadDatabaseConnectionConfig(process.env);
      pool = createPool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectionLimit: 4,
        timezone: "Z",
        decimalNumbers: false,
      });
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
      } finally {
        connection.release();
      }
      await pool.execute(
        `INSERT INTO instance_runtime_state (
           instance_id, state, execution_generation, state_version,
           reason, deadline, changed_by, changed_at
         ) VALUES (?, 'ACTIVE', 1, 1, 'bootstrap integration',
                   NULL, 'integration-test', ?)`,
        [instanceId, issuedAt],
      );
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
    });

    it("rejects wrong identity and expiry without side effects, then serializes redemption and response-loss replay", async () => {
      const store = createInstanceBootstrapStore(pool, {
        instanceId,
        initialAgentProfiles: [defaultAgentWorkspaceProfileV1],
        initialCatalog: prepareCatalogPackageV1(
          await loadCatalogPackageV1(
            resolve(
              import.meta.dirname,
              "../../../catalog-packages/kanvas-default",
            ),
          ),
        ),
      });
      await expect(
        store.issueSetupToken({
          setupTokenId: identity(8_000_001),
          tokenPrefix: instanceSetupTokenPrefix(boundToken),
          tokenHash: digestInstanceSetupToken(boundToken),
          hashVersion: 1,
          bindingMode: "verified_email_hash",
          bindingHash: digestInstanceSetupBinding(
            "verified_email_hash",
            "owner@example.com",
          ),
          expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1_000),
          now: issuedAt,
          auditEventId: identity(8_000_002),
        }),
      ).resolves.toMatchObject({
        setupTokenId: identity(8_000_001),
        bindingMode: "verified_email_hash",
      });

      await expect(
        store.inspectSetupToken({
          tokenHash: digestInstanceSetupToken(boundToken),
          verifiedEmail: "Owner@Example.com",
          now: redeemedAt,
        }),
      ).resolves.toEqual({
        bindingMode: "verified_email_hash",
        verifiedEmailMatches: true,
      });
      await expect(
        store.inspectSetupToken({
          tokenHash: digestInstanceSetupToken(boundToken),
          verifiedEmail: "other@example.com",
          now: redeemedAt,
        }),
      ).resolves.toEqual({
        bindingMode: "verified_email_hash",
        verifiedEmailMatches: false,
      });

      await expect(
        store.redeemSetupToken(
          redeemOptions(0, boundToken, {
            verifiedEmail: "other@example.com",
          }),
        ),
      ).rejects.toMatchObject({
        code: "instance_bootstrap.binding_mismatch",
      });
      await expect(
        store.redeemSetupToken(
          redeemOptions(0, boundToken, {
            now: new Date(issuedAt.getTime() + 60 * 60 * 1_000),
          }),
        ),
      ).rejects.toMatchObject({
        code: "instance_bootstrap.token_expired",
      });
      const [rejectedFacts] = await pool.query<CountRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM instance_administrator)
             + (SELECT COUNT(*) FROM organization)
             + (SELECT COUNT(*) FROM workspace) AS count`,
      );
      expect(Number(rejectedFacts[0]?.count ?? 0)).toBe(0);

      const concurrentIssuedAt = new Date(
        issuedAt.getTime() + 2 * 60 * 60 * 1_000,
      );
      await store.issueSetupToken({
        setupTokenId: identity(8_000_003),
        tokenPrefix: instanceSetupTokenPrefix(concurrentToken),
        tokenHash: digestInstanceSetupToken(concurrentToken),
        hashVersion: 1,
        bindingMode: "verified_email_hash",
        bindingHash: digestInstanceSetupBinding(
          "verified_email_hash",
          "owner@example.com",
        ),
        expiresAt: new Date(concurrentIssuedAt.getTime() + 60 * 60 * 1_000),
        now: concurrentIssuedAt,
        auditEventId: identity(8_000_004),
      });
      const concurrentRedeemedAt = new Date(
        concurrentIssuedAt.getTime() + 60 * 1_000,
      );
      const contenders = await Promise.allSettled([
        store.redeemSetupToken(
          redeemOptions(1, concurrentToken, {
            now: concurrentRedeemedAt,
          }),
        ),
        store.redeemSetupToken(
          redeemOptions(2, concurrentToken, {
            now: concurrentRedeemedAt,
          }),
        ),
      ]);
      const winners = contenders.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof store.redeemSetupToken>>
        > => result.status === "fulfilled",
      );
      const losers = contenders.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]?.reason).toMatchObject({
        code: "instance_bootstrap.already_initialized",
      });
      await expect(
        store.redeemSetupToken(
          redeemOptions(3, concurrentToken, {
            now: new Date(concurrentRedeemedAt.getTime() + 1_000),
          }),
        ),
      ).rejects.toMatchObject({
        code: "instance_bootstrap.already_initialized",
      });

      const [initialPolicies] = await pool.query<RowDataPacket[]>(
        "SELECT (SELECT COUNT(*) FROM instance_policy_binding) AS instanceCount, (SELECT COUNT(*) FROM workspace_policy_binding) AS workspaceCount",
      );
      expect(Number(initialPolicies[0]?.instanceCount)).toBe(1);
      expect(Number(initialPolicies[0]?.workspaceCount)).toBe(1);
      const policyConnection = await pool.getConnection();
      try {
        const [before] = await policyConnection.query(
          "SELECT * FROM instance_policy_binding",
        );
        await backfillDefaultProviderPolicies(policyConnection);
        const [after] = await policyConnection.query(
          "SELECT * FROM instance_policy_binding",
        );
        expect(after).toEqual(before);
        // Simulate an older installation with missing bindings, preserving history.
        await policyConnection.query("DELETE FROM workspace_policy_binding");
        await policyConnection.query("DELETE FROM instance_policy_binding");
        await backfillDefaultProviderPolicies(policyConnection);
        const [repaired] = await policyConnection.query(
          "SELECT * FROM instance_policy_binding",
        );
        await backfillDefaultProviderPolicies(policyConnection);
        const [repeated] = await policyConnection.query(
          "SELECT * FROM instance_policy_binding",
        );
        expect(repeated).toEqual(repaired);
        const [counts] = await policyConnection.query<RowDataPacket[]>(
          "SELECT (SELECT COUNT(*) FROM instance_policy_revision) AS instanceCount, (SELECT COUNT(*) FROM workspace_policy_revision) AS workspaceCount, (SELECT COUNT(*) FROM workspace_policy_binding) AS bindingCount",
        );
        expect(Number(counts[0]?.instanceCount)).toBe(1);
        expect(Number(counts[0]?.workspaceCount)).toBe(1);
        expect(Number(counts[0]?.bindingCount)).toBe(1);
        // Older setup created no policy rows at all. Concurrent repair remains idempotent.
        await policyConnection.query("DELETE FROM workspace_policy_binding");
        await policyConnection.query("DELETE FROM instance_policy_binding");
        await policyConnection.query("DELETE FROM workspace_policy_revision");
        await policyConnection.query("DELETE FROM instance_policy_revision");
        const contender = await pool.getConnection();
        try {
          await Promise.all([
            backfillDefaultProviderPolicies(policyConnection),
            backfillDefaultProviderPolicies(contender),
          ]);
        } finally {
          contender.release();
        }
        const [repairedCounts] = await policyConnection.query<RowDataPacket[]>(
          "SELECT (SELECT COUNT(*) FROM instance_policy_revision) AS instanceCount, (SELECT COUNT(*) FROM workspace_policy_revision) AS workspaceCount",
        );
        expect(Number(repairedCounts[0]?.instanceCount)).toBe(1);
        expect(Number(repairedCounts[0]?.workspaceCount)).toBe(1);
      } finally {
        policyConnection.release();
      }

      const [facts] = await pool.query<BootstrapFactRow[]>(
        `SELECT
           token.used_at AS usedAt,
           token.revoked_at AS revokedAt,
           (SELECT COUNT(*) FROM instance_administrator
             WHERE status = 'active') AS administratorCount,
           (SELECT COUNT(*) FROM organization
             WHERE status = 'active') AS organizationCount,
           (SELECT COUNT(*) FROM workspace
             WHERE status = 'active') AS workspaceCount,
           (SELECT COUNT(*) FROM organization_membership
             WHERE role = 'owner' AND status = 'active')
             AS organizationOwnerCount,
           (SELECT COUNT(*) FROM workspace_membership
             WHERE role = 'owner' AND status = 'active')
             AS workspaceOwnerCount,
           (SELECT COUNT(*) FROM capability_definition)
             AS capabilityDefinitionCount,
           (SELECT COUNT(*) FROM capability_catalog_entry)
             AS capabilityCatalogCount,
           (SELECT COUNT(*) FROM model_resource_catalog_entry)
             AS modelCatalogCount,
           (SELECT COUNT(*) FROM model_resource)
             AS modelResourceCount,
           (SELECT COUNT(*) FROM workflow_revision)
             AS workflowRevisionCount,
           (SELECT COUNT(*) FROM skill_revision)
             AS skillRevisionCount,
           (SELECT COUNT(*) FROM agent_profile_revision)
             AS agentProfileCount,
           (SELECT COUNT(*) FROM agent_surface_profile_binding)
             AS agentSurfaceBindingCount,
           (SELECT COUNT(*) FROM agent_definition
             WHERE management_kind = 'system'
               AND system_key = 'workspace-default')
             AS systemDefaultAgentCount
         FROM instance_setup_token AS token
         WHERE token.id = ?`,
        [identity(8_000_003)],
      );
      expect(facts[0]).toMatchObject({
        usedAt: concurrentRedeemedAt,
        revokedAt: null,
        administratorCount: 1,
        organizationCount: 1,
        workspaceCount: 1,
        organizationOwnerCount: 1,
        workspaceOwnerCount: 1,
        capabilityDefinitionCount: 0,
        capabilityCatalogCount: 14,
        modelCatalogCount: 3,
        modelResourceCount: 0,
        workflowRevisionCount: 0,
        skillRevisionCount: 0,
        agentProfileCount: 1,
        agentSurfaceBindingCount: 1,
        systemDefaultAgentCount: 1,
      });
      const prepared = prepareCatalogPackageV1(
        await loadCatalogPackageV1(
          resolve(
            import.meta.dirname,
            "../../../catalog-packages/kanvas-default",
          ),
        ),
      );
      const catalogConnection = await pool.getConnection();
      try {
        const [initial] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        expect(initial).toHaveLength(
          new Set(
            [...prepared.adapters.values()].map(
              (adapter) => adapter.document.adapterKey,
            ),
          ).size,
        );
        expect(initial.every((row) => row.current_revision_id)).toBe(true);
        const [latest] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT definition.adapter_key AS adapterKey, revision.revision FROM runtime_adapter_definition AS definition INNER JOIN runtime_adapter_revision AS revision ON revision.id = definition.current_revision_id",
        );
        for (const row of latest) {
          expect(row.revision).toBe(
            Math.max(
              ...[...prepared.adapters.values()]
                .filter(
                  (adapter) => adapter.document.adapterKey === row.adapterKey,
                )
                .map((adapter) => adapter.document.revision),
            ),
          );
        }
        await backfillWorkspaceSystemCatalog(catalogConnection, prepared);
        const [replayed] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        expect(replayed).toEqual(initial);
        // Simulate the historical installation which registered only the catalog.
        await catalogConnection.query(
          "UPDATE runtime_adapter_definition SET current_revision_id = NULL",
        );
        await catalogConnection.query("DELETE FROM runtime_adapter_revision");
        await catalogConnection.query("DELETE FROM runtime_adapter_definition");
        const migration = spawnSync(
          process.execPath,
          [resolve(import.meta.dirname, "../dist/cli/main.js"), "migrate"],
          {
            env: { ...process.env, KANVAS_INSTANCE_ID: instanceId },
            encoding: "utf8",
          },
        );
        expect(migration.status, migration.stderr).toBe(0);
        const [repaired] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        expect(repaired).toHaveLength(
          new Set(
            [...prepared.adapters.values()].map(
              (adapter) => adapter.document.adapterKey,
            ),
          ).size,
        );
        await catalogConnection.execute(
          "UPDATE runtime_adapter_definition SET lifecycle_status = 'disabled' WHERE id = ?",
          [repaired[0]!.id],
        );
        // Keep an explicitly selected older revision during release backfill.
        const [olderRevisions] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT old.id, old.runtime_adapter_definition_id AS definitionId FROM runtime_adapter_revision AS old INNER JOIN runtime_adapter_revision AS newer ON newer.runtime_adapter_definition_id = old.runtime_adapter_definition_id AND newer.revision > old.revision LIMIT 1",
        );
        expect(olderRevisions).toHaveLength(1);
        await catalogConnection.execute(
          "UPDATE runtime_adapter_definition SET current_revision_id = ? WHERE id = ?",
          [olderRevisions[0]!.id, olderRevisions[0]!.definitionId],
        );
        const [before] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        await backfillWorkspaceSystemCatalog(catalogConnection, prepared);
        const [after] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        expect(after).toEqual(before);
        const preflight = spawnSync(
          process.execPath,
          [resolve(import.meta.dirname, "../dist/cli/deployment-readiness.js")],
          {
            env: {
              ...process.env,
              KANVAS_WORKER_ROLES:
                "agent,provider-execution,reconciler,maintenance",
              KANVAS_PROVIDER_ACTIVE_KEK_VERSION: "test-version",
            },
            encoding: "utf8",
          },
        );
        expect(preflight.status, preflight.stderr).toBe(2);
        const readiness = JSON.parse(preflight.stdout) as {
          workspaces: readonly Record<string, unknown>[];
        };
        expect(readiness).toMatchObject({
          ready: false,
          executionVerified: false,
          configurationIssues: [],
        });
        expect(readiness.workspaces).toHaveLength(1);
        expect(readiness.workspaces[0]).toMatchObject({
          missingAdapters: [],
          policiesReady: true,
          agentProfileReady: true,
          defaultModelReady: false,
          fastModelReady: false,
        });
        const [afterPreflight] = await catalogConnection.query<RowDataPacket[]>(
          "SELECT * FROM runtime_adapter_definition ORDER BY id",
        );
        expect(afterPreflight).toEqual(before);
      } finally {
        catalogConnection.release();
      }
      const [auditRows] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE event_type IN (
           'instance.bootstrap.issued',
           'instance.bootstrap.redeemed'
         )`,
      );
      expect(Number(auditRows[0]?.count ?? 0)).toBe(3);

      await expect(
        store.issueSetupToken({
          setupTokenId: identity(8_000_005),
          tokenPrefix: "knv_setup_v1_blocked",
          tokenHash: digest("c"),
          hashVersion: 1,
          bindingMode: "unbound",
          expiresAt: new Date(concurrentRedeemedAt.getTime() + 60 * 60 * 1_000),
          now: concurrentRedeemedAt,
          auditEventId: identity(8_000_006),
        }),
      ).rejects.toMatchObject({
        code: "instance_bootstrap.already_initialized",
      });
    });
  },
);
