#!/usr/bin/env node

import { createPool, type RowDataPacket } from "mysql2/promise";

import { createEffectiveInvocationSchemaProjector } from "../runtime/effective-invocation-schema-store.js";
import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { readWorkspaceAgentModelSettings } from "../runtime/agent-profile-publication-store.js";
import { loadDefaultCatalogPackageV1 } from "./catalog-package-loader.js";
import { prepareCatalogPackageV1 } from "./catalog-package-installer.js";

// Controlled deployment CLI: reads only, never calls a model or prints secrets.
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 ||
    args[0] !== "--workspace-id" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(args[1]!))
) {
  throw new Error("Usage: kanvas preflight [--workspace-id ULID]");
}
const prepared = prepareCatalogPackageV1(await loadDefaultCatalogPackageV1());
const configuredBounds =
  process.env.KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON?.trim();
const providerDeploymentHardBounds: unknown = configuredBounds
  ? JSON.parse(configuredBounds)
  : undefined;
const capabilityProjector = createEffectiveInvocationSchemaProjector({
  providerDeploymentHardBounds,
});
const pool = createPool({
  ...loadDatabaseConnectionConfig(process.env),
  connectionLimit: 1,
  timezone: "Z",
});
const connection = await pool.getConnection();
try {
  await connection.query("START TRANSACTION READ ONLY");
  const [workspaces] = await connection.execute<
    (RowDataPacket & { id: string })[]
  >(
    "SELECT id FROM workspace WHERE status = 'active' AND (? IS NULL OR id = ?) ORDER BY id",
    [args[1] ?? null, args[1] ?? null],
  );
  const roles = (process.env.KANVAS_WORKER_ROLES ?? "")
    .split(",")
    .map((value) => value.trim());
  const configurationIssues: string[] = [];
  for (const role of [
    "agent",
    "provider-execution",
    "reconciler",
    "maintenance",
  ]) {
    if (!roles.includes(role))
      configurationIssues.push(`Enable Worker role: ${role}`);
  }
  if (!workspaces.length)
    configurationIssues.push(
      "Complete first-owner setup or select an active Workspace.",
    );
  const results = [];
  for (const workspace of workspaces) {
    const [adapters] = await connection.execute<
      (RowDataPacket & { adapterKey: string; available: number })[]
    >(
      `SELECT definition.adapter_key AS adapterKey, (definition.lifecycle_status = 'active' AND revision.lifecycle_status = 'published') AS available FROM runtime_adapter_definition AS definition
       LEFT JOIN runtime_adapter_revision AS revision ON revision.workspace_id = definition.workspace_id
         AND revision.id = definition.current_revision_id
       WHERE definition.workspace_id = ?`,
      [workspace.id],
    );
    const available = new Set(adapters.map((row) => row.adapterKey));
    const missingAdapters = [...prepared.adapters.values()]
      .map((adapter) => adapter.document.adapterKey)
      .filter((key) => !available.has(key));
    const [policies] = await connection.execute<RowDataPacket[]>(
      `SELECT workspace.workspace_id FROM workspace_policy_binding AS workspace
       INNER JOIN workspace_policy_revision AS revision ON revision.id = workspace.active_revision_id
         AND revision.workspace_id = workspace.workspace_id AND revision.lifecycle_status = 'published'
       WHERE workspace.workspace_id = ? AND EXISTS (
         SELECT 1 FROM instance_policy_binding AS binding
         INNER JOIN instance_policy_revision AS instance ON instance.id = binding.active_revision_id
         WHERE instance.lifecycle_status = 'published')`,
      [workspace.id],
    );
    const settings = await readWorkspaceAgentModelSettings(
      connection,
      workspace.id,
      new Date(),
    );
    const modelReady = (id: string | undefined): boolean =>
      Boolean(
        id &&
        settings?.options.some((option) => option.id === id && option.ready),
      );
    const defaultModelReady = modelReady(settings?.currentDefaultModelId);
    const fastModelReady = modelReady(settings?.currentFastModelId);
    const [capabilities] = await connection.execute<
      (RowDataPacket & {
        key: string;
        revision: number;
        digest: string;
        inputSchema: Readonly<Record<string, unknown>>;
      })[]
    >(
      `SELECT definition.capability_key AS \`key\`, contract.revision,
        contract.canonical_digest AS digest, contract.input_schema AS inputSchema
       FROM capability_definition definition JOIN capability_contract_revision contract
        ON contract.workspace_id = definition.workspace_id AND contract.id = definition.current_contract_revision_id
       WHERE definition.workspace_id = ? AND definition.lifecycle_status = 'active'
        AND EXISTS (SELECT 1 FROM capability_binding binding
          JOIN capability_implementation_revision implementation ON implementation.workspace_id = binding.workspace_id AND implementation.id = binding.implementation_revision_id
          WHERE binding.workspace_id = definition.workspace_id AND binding.contract_revision_id = contract.id
            AND binding.lifecycle_status = 'active' AND implementation.execution_target = 'provider')`,
      [workspace.id],
    );
    const capabilityReadiness = [];
    for (const capability of capabilities) {
      const effective =
        await capabilityProjector.projectCapabilityInTransaction(connection, {
          workspaceId: workspace.id,
          contractId: capability.key,
          revision: capability.revision,
          canonicalDigest: capability.digest,
          inputSchema: capability.inputSchema,
          now: new Date(),
        });
      capabilityReadiness.push({
        key: capability.key,
        ready: effective.availability === "available",
        ...(effective.availability === "unavailable"
          ? { reason: effective.reason }
          : {}),
      });
    }
    results.push({
      workspaceId: workspace.id,
      ready:
        !missingAdapters.length &&
        policies.length > 0 &&
        defaultModelReady &&
        fastModelReady &&
        capabilityReadiness.every((item) => item.ready),
      capabilityReadiness,
      missingAdapters,
      unavailableAdapters: adapters
        .filter((adapter) => Number(adapter.available) !== 1)
        .map((adapter) => adapter.adapterKey),
      policiesReady: policies.length > 0,
      agentProfileReady: Boolean(settings),
      defaultModelReady,
      fastModelReady,
      models:
        settings?.options.map(
          ({ id, modelName, ready, unavailableReasons }) => ({
            id,
            modelName,
            ready,
            unavailableReasons,
          }),
        ) ?? [],
    });
  }
  await connection.commit();
  const ready =
    configurationIssues.length === 0 && results.every((result) => result.ready);
  process.stdout.write(
    `${JSON.stringify(
      {
        ready,
        configurationIssues,
        workspaces: results,
        executionVerified: false,
        nextStep: ready
          ? "Run a representative Agent/Capability task and verify the downloaded result."
          : "Resolve configuration issues, run db migrate for missing system assets, and publish/select models in Workspace settings.",
      },
      null,
      2,
    )}\n`,
  );
  if (!ready) process.exitCode = 2;
} finally {
  connection.release();
  await pool.end();
}
