#!/usr/bin/env node

import { createDatabaseRuntime } from "@kanvas/database";
import { createPool, type RowDataPacket } from "mysql2/promise";

import { loadServerConfig } from "../config.js";
import { refreshModelReference } from "../model-reference-sync.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const server = loadServerConfig(process.env, []);
const requestedActorPrincipalId = argument("--actor-principal-id");
if (requestedActorPrincipalId && !idPattern.test(requestedActorPrincipalId)) {
  throw new Error("--actor-principal-id must be a canonical ULID.");
}

const database = createDatabaseRuntime({
  connection: server.database,
  instanceId: server.instanceId,
  enabledExecutionTargets: server.enabledExecutionTargets,
  ...(server.providerDeploymentHardBounds
    ? { providerDeploymentHardBounds: server.providerDeploymentHardBounds }
    : {}),
});
const pool = createPool({
  ...server.database,
  connectionLimit: 1,
  timezone: "Z",
});

try {
  const [actors] = await pool.execute<
    (RowDataPacket & { readonly principalId: string })[]
  >(
    `SELECT administrator.principal_id AS principalId
       FROM instance_administrator AS administrator
       WHERE administrator.status = 'active'
       ORDER BY administrator.principal_id
       LIMIT 1`,
  );
  const actorPrincipalId = requestedActorPrincipalId ?? actors[0]?.principalId;
  if (!actorPrincipalId || !idPattern.test(actorPrincipalId)) {
    throw new Error(
      "Model reference sync requires an active instance administrator.",
    );
  }
  const snapshot = await refreshModelReference({
    store: database.modelReferences,
    actorPrincipalId,
    now: new Date(),
  });
  process.stdout.write(
    `${JSON.stringify({
      result: "synced",
      revision: snapshot.revision,
      sourceRevision: snapshot.sourceRevision,
      canonicalModels: snapshot.document.canonicalModels.length,
      providers: snapshot.document.providers.length,
      providerModels: snapshot.document.providers.reduce(
        (total, provider) => total + provider.models.length,
        0,
      ),
    })}\n`,
  );
} finally {
  await Promise.all([database.close(), pool.end()]);
}
