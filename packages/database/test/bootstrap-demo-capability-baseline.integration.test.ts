import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createPool, type RowDataPacket } from "mysql2/promise";
import { describe, expect, it } from "vitest";

const enabled = process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const run = enabled ? it : it.skip;
const execFileAsync = promisify(execFile);

interface BaselineRow extends RowDataPacket {
  readonly activeDefinitionCount: number | string;
  readonly bindingCount: number | string;
  readonly implementationCount: number | string;
  readonly runtimeAdapterCount: number | string;
  readonly capabilityCatalogCount: number | string;
  readonly validRecommendationCount: number | string;
  readonly installationCount: number | string;
  readonly modelCatalogCount: number | string;
  readonly publishedModelCount: number | string;
  readonly workflowCount: number | string;
  readonly skillCount: number | string;
  readonly developmentFixtureCount: number | string;
  readonly orphanBindingCount: number | string;
}

interface BootstrapResult {
  readonly catalog: {
    readonly capabilityRecommendations: number;
    readonly modelResourceRecommendations: number;
    readonly replayed: boolean;
  };
  readonly runtimeAdapters: {
    readonly installed: number;
  };
  readonly modelServices: {
    readonly openAi: boolean;
    readonly generationTasks: boolean;
  };
}

function bootstrapResult(stdout: string): BootstrapResult {
  return JSON.parse(stdout) as BootstrapResult;
}

describe("demo Capability baseline", () => {
  run(
    "registers governed recommendations and runtime adapters without installing Capabilities",
    async () => {
      const pool = createPool({
        host: process.env.KANVAS_DATABASE_HOST ?? "127.0.0.1",
        port: Number(process.env.KANVAS_DATABASE_PORT ?? "3306"),
        database: process.env.KANVAS_DATABASE_NAME ?? "kanvas",
        user: process.env.KANVAS_DATABASE_USER ?? "root",
        password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
        connectionLimit: 1,
        timezone: "Z",
      });
      try {
        const workspaceId = "01K00000000000000000000000";
        const principalId = "01K0000000000000000000000A";
        const now = new Date("2026-08-30T00:00:00.000Z");
        await pool.execute(
          `INSERT INTO organization (
             id, slug, name, status, version, created_at, updated_at
           ) VALUES (?, 'baseline', 'Baseline', 'active', 1, ?, ?)`,
          [workspaceId, now, now],
        );
        await pool.execute(
          `INSERT INTO workspace (
             id, organization_id, slug, name, status, version,
             created_at, updated_at
           ) VALUES (?, ?, 'baseline', 'Baseline', 'active', 1, ?, ?)`,
          [workspaceId, workspaceId, now, now],
        );
        await pool.execute(
          `INSERT INTO principal (
             id, principal_type, status, version, created_at, updated_at
           ) VALUES (?, 'human', 'active', 1, ?, ?)`,
          [principalId, now, now],
        );
        await pool.execute(
          `INSERT INTO human_principal (
             principal_id, auth_subject_id, created_at
           ) VALUES (?, 'capability-baseline-admin', ?)`,
          [principalId, now],
        );
        await pool.execute(
          `INSERT INTO instance_administrator (
             principal_id, status, version, created_at, updated_at
           ) VALUES (?, 'active', 1, ?, ?)`,
          [principalId, now, now],
        );
        await pool.execute(
          `INSERT INTO workspace_membership (
             id, organization_id, workspace_id, principal_id,
             role, status, version, created_at, updated_at
           ) VALUES ('01K0000000000000000000000B', ?, ?, ?,
             'owner', 'active', 1, ?, ?)`,
          [workspaceId, workspaceId, principalId, now, now],
        );

        const bootstrapOptions = {
          cwd: process.cwd(),
          env: {
            ...process.env,
            KANVAS_DATABASE_CONNECTION_LIMIT: "1",
            KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "false",
            KANVAS_INSTANCE_ID: "disposable-capability-baseline",
            KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED: "false",
          },
          maxBuffer: 4 * 1024 * 1024,
        };
        const first = await execFileAsync(
          process.execPath,
          ["dist/cli/bootstrap-demo.js"],
          bootstrapOptions,
        );
        const replay = await execFileAsync(
          process.execPath,
          ["dist/cli/bootstrap-demo.js"],
          bootstrapOptions,
        );
        expect(bootstrapResult(first.stdout)).toMatchObject({
          catalog: {
            capabilityRecommendations: 14,
            modelResourceRecommendations: 3,
            replayed: false,
          },
          runtimeAdapters: { installed: 16 },
          modelServices: { openAi: false, generationTasks: false },
        });
        expect(bootstrapResult(replay.stdout)).toMatchObject({
          catalog: {
            capabilityRecommendations: 14,
            modelResourceRecommendations: 3,
            replayed: true,
          },
          runtimeAdapters: { installed: 16 },
          modelServices: { openAi: false, generationTasks: false },
        });

        const [rows] = await pool.execute<BaselineRow[]>(
          `SELECT
             (
               SELECT COUNT(*)
               FROM capability_definition AS definition
               WHERE definition.workspace_id = ?
                 AND definition.lifecycle_status = 'active'
             ) AS activeDefinitionCount,
             (SELECT COUNT(*) FROM capability_binding WHERE workspace_id = ?) AS bindingCount,
             (SELECT COUNT(*) FROM capability_implementation_revision WHERE workspace_id = ?) AS implementationCount,
             (SELECT COUNT(*) FROM runtime_adapter_revision WHERE workspace_id = ?) AS runtimeAdapterCount,
             (
               SELECT COUNT(*)
               FROM capability_catalog_entry
               WHERE workspace_id = ? AND lifecycle_status = 'active'
             ) AS capabilityCatalogCount,
             (
               SELECT COUNT(*)
               FROM capability_catalog_entry
               WHERE workspace_id = ?
                 AND lifecycle_status = 'active'
                 AND JSON_UNQUOTE(JSON_EXTRACT(document, '$.schemaVersion')) =
                       'kanvas.capability-catalog-recommendation/v1'
                 AND JSON_LENGTH(JSON_EXTRACT(document, '$.assets')) > 0
             ) AS validRecommendationCount,
             (
               SELECT COUNT(*)
               FROM capability_installation_operation
               WHERE workspace_id = ?
             ) AS installationCount,
             (SELECT COUNT(*) FROM model_resource_catalog_entry WHERE workspace_id = ?) AS modelCatalogCount,
             (SELECT COUNT(*) FROM model_resource WHERE workspace_id = ?) AS publishedModelCount,
             (SELECT COUNT(*) FROM workflow_revision WHERE workspace_id = ?) AS workflowCount,
             (SELECT COUNT(*) FROM skill_revision WHERE workspace_id = ?) AS skillCount,
             (
               SELECT COUNT(*)
               FROM capability_definition AS definition
               WHERE definition.workspace_id = ?
                 AND definition.capability_key IN (
                   'foundation.echo',
                   'test.image.background.remove'
                 )
             ) AS developmentFixtureCount,
             (
               SELECT COUNT(*)
               FROM capability_binding AS binding
               LEFT JOIN capability_definition AS definition
                 ON definition.workspace_id = binding.workspace_id
                AND definition.current_contract_revision_id =
                      binding.contract_revision_id
               WHERE binding.workspace_id = ?
                 AND binding.lifecycle_status <> 'revoked'
                 AND definition.id IS NULL
             ) AS orphanBindingCount`,
          [
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
          ],
        );
        const baseline = rows[0];
        expect(Number(baseline?.activeDefinitionCount)).toBe(0);
        expect(Number(baseline?.implementationCount)).toBe(0);
        expect(Number(baseline?.bindingCount)).toBe(0);
        expect(Number(baseline?.runtimeAdapterCount)).toBe(16);
        expect(Number(baseline?.capabilityCatalogCount)).toBe(14);
        expect(Number(baseline?.validRecommendationCount)).toBe(14);
        expect(Number(baseline?.installationCount)).toBe(0);
        expect(Number(baseline?.modelCatalogCount)).toBe(3);
        expect(Number(baseline?.publishedModelCount)).toBe(0);
        expect(Number(baseline?.workflowCount)).toBe(0);
        expect(Number(baseline?.skillCount)).toBe(0);
        expect(Number(baseline?.developmentFixtureCount)).toBe(0);
        expect(Number(baseline?.orphanBindingCount)).toBe(0);
      } finally {
        await pool.end();
      }
    },
    60_000,
  );
});
