import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";

import { parseProviderConstraintDocument } from "./configuration-policy.js";
import { digestProviderValue } from "./provider-value-digest.js";

// Bounds apply in addition to deployment limits, route limits and team budgets.
// Endpoint admission belongs to each workspace, not to a fixed demo ID list.
const instanceDefaults = parseProviderConstraintDocument(
  {
    maximumCharge: { currencyCode: "USD", amount: "2" },
    maxProviderRequestSeconds: 300,
  },
  "Default instance Provider policy",
);
const workspaceDefaults = parseProviderConstraintDocument(
  { allowedProviderEndpointIds: [] },
  "Default workspace Provider policy",
);

/** Caller owns a transaction and the instance runtime row lock. Never replaces a binding. */
export async function ensureDefaultProviderPolicies(
  connection: PoolConnection,
  options: {
    actorId: string;
    workspaceId: string;
    now: Date;
    nextId?: () => string;
  },
): Promise<void> {
  const nextId = options.nextId ?? ulid;
  const [instance] = await connection.execute<RowDataPacket[]>(
    "SELECT singleton_id FROM instance_policy_binding WHERE singleton_id = 1 FOR UPDATE",
  );
  if (!instance.length) {
    const [revisions] = await connection.query<
      (RowDataPacket & { id: string; lifecycle_status: string })[]
    >(
      "SELECT id, lifecycle_status FROM instance_policy_revision ORDER BY revision DESC LIMIT 1",
    );
    const existing = revisions[0];
    if (existing && existing.lifecycle_status !== "published") {
      throw new Error(
        "Instance Provider policy requires administrator review before initialization.",
      );
    }
    const revisionId = existing?.id ?? nextId();
    if (!existing)
      await connection.execute(
        `INSERT INTO instance_policy_revision
       (id, revision, schema_version, policy_document, canonical_digest, lifecycle_status,
        supersedes_revision_id, created_by_principal_id, published_by_principal_id, created_at, published_at)
       SELECT ?, COALESCE(MAX(revision), 0) + 1, 1, ?, ?, 'published', NULL, ?, ?, ?, ?
       FROM instance_policy_revision`,
        [
          revisionId,
          JSON.stringify(instanceDefaults),
          digestProviderValue(instanceDefaults),
          options.actorId,
          options.actorId,
          options.now,
          options.now,
        ],
      );
    await connection.execute(
      `INSERT INTO instance_policy_binding
       (singleton_id, active_revision_id, version, updated_by_principal_id, updated_at)
       VALUES (1, ?, 1, ?, ?)`,
      [revisionId, options.actorId, options.now],
    );
  }
  const [workspace] = await connection.execute<RowDataPacket[]>(
    "SELECT workspace_id FROM workspace_policy_binding WHERE workspace_id = ? FOR UPDATE",
    [options.workspaceId],
  );
  if (!workspace.length) {
    const [revisions] = await connection.query<
      (RowDataPacket & { id: string; lifecycle_status: string })[]
    >(
      "SELECT id, lifecycle_status FROM workspace_policy_revision WHERE workspace_id = ? ORDER BY revision DESC LIMIT 1",
      [options.workspaceId],
    );
    const existing = revisions[0];
    if (existing && existing.lifecycle_status !== "published") {
      throw new Error(
        "Workspace Provider policy requires administrator review before initialization.",
      );
    }
    const revisionId = existing?.id ?? nextId();
    if (!existing)
      await connection.execute(
        `INSERT INTO workspace_policy_revision
       (id, workspace_id, revision, schema_version, policy_document, canonical_digest, lifecycle_status,
        supersedes_revision_id, created_by_principal_id, published_by_principal_id, created_at, published_at)
       SELECT ?, ?, COALESCE(MAX(revision), 0) + 1, 1, ?, ?, 'published', NULL, ?, ?, ?, ?
       FROM workspace_policy_revision WHERE workspace_id = ?`,
        [
          revisionId,
          options.workspaceId,
          JSON.stringify(workspaceDefaults),
          digestProviderValue(workspaceDefaults),
          options.actorId,
          options.actorId,
          options.now,
          options.now,
          options.workspaceId,
        ],
      );
    await connection.execute(
      `INSERT INTO workspace_policy_binding
       (workspace_id, active_revision_id, version, updated_by_principal_id, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
      [options.workspaceId, revisionId, options.actorId, options.now],
    );
  }
}

/** Completes installations created before setup initialized Provider policies. */
export async function backfillDefaultProviderPolicies(
  connection: PoolConnection,
): Promise<void> {
  await connection.beginTransaction();
  try {
    await connection.query(
      "SELECT instance_id FROM instance_runtime_state ORDER BY instance_id FOR UPDATE",
    );
    const [admins] = await connection.query<
      (RowDataPacket & { principalId: string })[]
    >(
      `SELECT administrator.principal_id AS principalId FROM instance_administrator AS administrator
       INNER JOIN principal ON principal.id = administrator.principal_id
       WHERE administrator.status = 'active' AND principal.status = 'active'
       ORDER BY administrator.principal_id LIMIT 1`,
    );
    if (admins[0]) {
      const [workspaces] = await connection.query<
        (RowDataPacket & { id: string })[]
      >("SELECT id FROM workspace WHERE status = 'active' ORDER BY id");
      const now = new Date();
      for (const workspace of workspaces) {
        await ensureDefaultProviderPolicies(connection, {
          actorId: admins[0].principalId,
          workspaceId: workspace.id,
          now,
        });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
