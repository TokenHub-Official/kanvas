#!/usr/bin/env node

import { resolve } from "node:path";

import { createPool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import {
  bootstrapGenerationTasksImagesControlPlane,
  loadGenerationTasksImagesControlPlaneConfiguration,
} from "./bootstrap-generation-tasks-images-control-plane.js";
import { installCatalogRuntimeAdaptersV1 } from "./catalog-package-installer.js";
import { registerCatalogPackageV1 } from "./catalog-package-registrar.js";
import {
  bootstrapOpenAiImagesControlPlane,
  loadOpenAiImagesControlPlaneConfiguration,
} from "./bootstrap-openai-images-control-plane.js";

const workspaceId = "01K00000000000000000000000";

interface PrincipalRow extends RowDataPacket {
  readonly id: string;
}

const connectionConfig = loadDatabaseConnectionConfig(process.env);
const pool = createPool({
  ...connectionConfig,
  connectionLimit: 2,
  timezone: "Z",
  decimalNumbers: false,
});
const connection = await pool.getConnection();

try {
  await connection.beginTransaction();
  await connection.execute(
    `INSERT INTO organization
       (id, slug, name, status, version, created_at, updated_at)
     VALUES (?, 'local-demo', 'Local Demo Workspace', 'active', 1,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE status = 'active', updated_at = VALUES(updated_at)`,
    [workspaceId],
  );
  await connection.execute(
    `INSERT INTO workspace
       (id, organization_id, slug, name, status, version, created_at, updated_at)
     VALUES (?, ?, 'local-demo', 'Local Demo Workspace', 'active', 1,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       organization_id = VALUES(organization_id),
       status = 'active', updated_at = VALUES(updated_at)`,
    [workspaceId, workspaceId],
  );
  const [principalRows] = await connection.execute<PrincipalRow[]>(
    `SELECT administrator.principal_id AS id
     FROM instance_administrator AS administrator
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = administrator.principal_id
      AND membership.workspace_id = ?
      AND membership.status = 'active'
     WHERE administrator.status = 'active'
     ORDER BY administrator.principal_id
     LIMIT 1 FOR SHARE`,
    [workspaceId],
  );
  const actorId = principalRows[0]?.id;
  if (!actorId) {
    throw new Error(
      "Default Catalog registration requires an active development administrator. Run bootstrap:dev first.",
    );
  }

  const instanceId = process.env.KANVAS_INSTANCE_ID?.trim();
  const openAiConfiguration = loadOpenAiImagesControlPlaneConfiguration(
    process.env,
  );
  const generationTasksConfiguration =
    loadGenerationTasksImagesControlPlaneConfiguration(process.env);
  if ((openAiConfiguration || generationTasksConfiguration) && !instanceId) {
    throw new Error(
      "KANVAS_INSTANCE_ID is required when a model-service control plane is enabled.",
    );
  }
  const openAi = openAiConfiguration
    ? await bootstrapOpenAiImagesControlPlane(connection, {
        workspaceId,
        actorId,
        instanceId: instanceId!,
        configuration: openAiConfiguration,
      })
    : undefined;
  const generationTasks = generationTasksConfiguration
    ? await bootstrapGenerationTasksImagesControlPlane(connection, {
        workspaceId,
        actorId,
        instanceId: instanceId!,
        configuration: generationTasksConfiguration,
      })
    : undefined;
  await connection.commit();

  const packageRoot = resolve(
    import.meta.dirname,
    "../../../../catalog-packages/kanvas-default",
  );
  const runtimeAdapters = await installCatalogRuntimeAdaptersV1({
    pool,
    workspaceId,
    packageRoot,
  });
  const catalog = await registerCatalogPackageV1({
    pool,
    workspaceId,
    packageRoot,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        workspaceId,
        actorId,
        catalog,
        runtimeAdapters,
        modelServices: {
          openAi: Boolean(openAi),
          generationTasks: Boolean(generationTasks),
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  try {
    await connection.rollback();
  } catch {
    // Catalog installation owns a separate transaction after bootstrap commit.
  }
  throw error;
} finally {
  connection.release();
  await pool.end();
}
