import {
  createPool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { bootstrapImageProviderSharedPolicy } from "./bootstrap-image-provider-shared-policy.js";

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function requiredId(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value || !ulidPattern.test(value)) {
    throw new Error(`${name} must be a canonical uppercase ULID.`);
  }
  return value;
}

const connection = loadDatabaseConnectionConfig(process.env);
const workspaceId = requiredId(
  process.env,
  process.env.KANVAS_PROVIDER_SETTINGS_WORKSPACE_ID
    ? "KANVAS_PROVIDER_SETTINGS_WORKSPACE_ID"
    : "KANVAS_DEMO_WORKSPACE_ID",
);
async function resolveActorId(
  session: PoolConnection,
  workspaceId: string,
): Promise<string> {
  if (process.env.KANVAS_PROVIDER_SETTINGS_ACTOR_ID) {
    return requiredId(process.env, "KANVAS_PROVIDER_SETTINGS_ACTOR_ID");
  }
  const [rows] = await session.execute<
    (RowDataPacket & { readonly principalId: string })[]
  >(
    `SELECT administrator.principal_id AS principalId
       FROM instance_administrator AS administrator
       INNER JOIN workspace_membership AS membership
         ON membership.principal_id = administrator.principal_id
        AND membership.workspace_id = ?
        AND membership.status = 'active'
       WHERE administrator.status = 'active'
       ORDER BY administrator.principal_id
       LIMIT 1`,
    [workspaceId],
  );
  const actorId = rows[0]?.principalId;
  if (!actorId || !ulidPattern.test(actorId)) {
    throw new Error(
      "The Provider Settings Workspace has no active administrator member.",
    );
  }
  return actorId;
}
const pool = createPool({
  ...connection,
  connectionLimit: 1,
  timezone: "Z",
  decimalNumbers: false,
});

try {
  const session = await pool.getConnection();
  try {
    await session.beginTransaction();
    const actorId = await resolveActorId(session, workspaceId);
    const result = await bootstrapImageProviderSharedPolicy(session, {
      actorId,
      workspaceId,
    });
    await session.commit();
    process.stdout.write(
      `${JSON.stringify({
        status: "published",
        workspaceId,
        ...result,
      })}\n`,
    );
  } catch (error) {
    await session.rollback();
    throw error;
  } finally {
    session.release();
  }
} finally {
  await pool.end();
}
