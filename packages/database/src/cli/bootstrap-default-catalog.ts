#!/usr/bin/env node

import { resolve } from "node:path";

import { createPool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { registerCatalogPackageV1 } from "./catalog-package-registrar.js";

const connection = loadDatabaseConnectionConfig(process.env);
const pool = createPool({
  ...connection,
  connectionLimit: 1,
  timezone: "Z",
  decimalNumbers: false,
});

try {
  const workspaceId =
    process.env.KANVAS_BOOTSTRAP_WORKSPACE_ID?.trim() ||
    "01K00000000000000000000000";
  const [actors] = await pool.execute<
    (RowDataPacket & { readonly id: string })[]
  >(
    `SELECT administrator.principal_id AS id
     FROM instance_administrator AS administrator
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = administrator.principal_id
      AND membership.workspace_id = ? AND membership.status = 'active'
     WHERE administrator.status = 'active'
     ORDER BY administrator.principal_id LIMIT 1`,
    [workspaceId],
  );
  const actorPrincipalId = actors[0]?.id;
  if (!actorPrincipalId) {
    throw new Error(
      "Default Catalog registration requires an active administrator.",
    );
  }
  const result = await registerCatalogPackageV1({
    pool,
    workspaceId,
    packageRoot: resolve(
      import.meta.dirname,
      "../../../../catalog-packages/kanvas-default",
    ),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
