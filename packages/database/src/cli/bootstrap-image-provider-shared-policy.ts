import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { parseProviderConstraintDocument } from "../runtime/configuration-policy.js";
import { digestProviderValue } from "../runtime/provider-value-digest.js";
import {
  allImageProviderEndpointIds,
  imageProviderSharedPolicyIds,
} from "./image-provider-control-plane-ids.js";

interface DigestRow extends RowDataPacket {
  readonly canonicalDigest: string;
}

export interface ImageProviderSharedPolicyDefinition {
  readonly instancePolicyDocument: unknown;
  readonly instancePolicyDigest: string;
  readonly workspacePolicyDocument: unknown;
  readonly workspacePolicyDigest: string;
}

export function buildImageProviderSharedPolicyDefinition(): ImageProviderSharedPolicyDefinition {
  const instanceConstraints = Object.freeze({
    allowedAdapterKinds: Object.freeze([
      "openai_native",
      "openrouter_native",
      "gemini_native",
      "openai_compatible",
    ]),
    allowedPresetKinds: Object.freeze([
      "openai",
      "openrouter",
      "xai",
      "gemini",
      "newapi",
      "tokenhub",
    ]),
    allowedRegionCodes: Object.freeze(["global", "us", "private"]),
    allowedRoutingModes: Object.freeze(["kanvas_fixed", "gateway_managed"]),
    allowedExecutionTransparencies: Object.freeze([
      "full",
      "partial",
      "opaque",
    ]),
    maximumCharge: Object.freeze({
      currencyCode: "USD",
      amount: "2",
    }),
    maxProviderRequestSeconds: 300,
  });
  const workspaceConstraints = Object.freeze({
    ...instanceConstraints,
    allowedProviderEndpointIds: allImageProviderEndpointIds,
  });
  const instancePolicyDocument = parseProviderConstraintDocument(
    instanceConstraints,
    "Image Provider instance policy",
  );
  const workspacePolicyDocument = parseProviderConstraintDocument(
    workspaceConstraints,
    "Image Provider workspace policy",
  );
  return Object.freeze({
    instancePolicyDocument,
    instancePolicyDigest: digestProviderValue(instancePolicyDocument),
    workspacePolicyDocument,
    workspacePolicyDigest: digestProviderValue(workspacePolicyDocument),
  });
}

async function assertDigest(
  connection: PoolConnection,
  table: string,
  id: string,
  expectedDigest: string,
): Promise<void> {
  const [rows] = await connection.query<DigestRow[]>(
    `SELECT canonical_digest AS canonicalDigest
     FROM ${table}
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  if (rows[0]?.canonicalDigest !== expectedDigest) {
    throw new Error(
      `Existing shared Image Provider policy ${id} has a different immutable digest.`,
    );
  }
}

export async function bootstrapImageProviderSharedPolicy(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly workspaceId: string;
  },
): Promise<{
  readonly instancePolicyRevisionId: string;
  readonly workspacePolicyRevisionId: string;
}> {
  const definition = buildImageProviderSharedPolicyDefinition();
  const ids = imageProviderSharedPolicyIds;
  await connection.execute(
    `INSERT IGNORE INTO instance_policy_revision (
       id, revision, schema_version, policy_document, canonical_digest,
       lifecycle_status, supersedes_revision_id,
       created_by_principal_id, published_by_principal_id,
       created_at, published_at
     )
     SELECT ?, COALESCE(MAX(revision), 0) + 1, 1, ?, ?,
       'published', NULL, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     FROM instance_policy_revision`,
    [
      ids.instancePolicyRevision,
      JSON.stringify(definition.instancePolicyDocument),
      definition.instancePolicyDigest,
      options.actorId,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT INTO instance_policy_binding (
       singleton_id, active_revision_id, version,
       updated_by_principal_id, updated_at
     ) VALUES (1, ?, 1, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       active_revision_id = VALUES(active_revision_id),
       updated_by_principal_id = VALUES(updated_by_principal_id),
       version = IF(
         active_revision_id = VALUES(active_revision_id),
         version,
         version + 1
       ),
       updated_at = IF(
         active_revision_id = VALUES(active_revision_id),
         updated_at,
         VALUES(updated_at)
       )`,
    [ids.instancePolicyRevision, options.actorId],
  );
  await connection.execute(
    `INSERT IGNORE INTO workspace_policy_revision (
       id, workspace_id, revision, schema_version, policy_document,
       canonical_digest, lifecycle_status, supersedes_revision_id,
       created_by_principal_id, published_by_principal_id,
       created_at, published_at
     )
     SELECT ?, ?, COALESCE(MAX(revision), 0) + 1, 1, ?, ?,
       'published', NULL, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     FROM workspace_policy_revision
     WHERE workspace_id = ?`,
    [
      ids.workspacePolicyRevision,
      options.workspaceId,
      JSON.stringify(definition.workspacePolicyDocument),
      definition.workspacePolicyDigest,
      options.actorId,
      options.actorId,
      options.workspaceId,
    ],
  );
  await connection.execute(
    `INSERT INTO workspace_policy_binding (
       workspace_id, active_revision_id, version,
       updated_by_principal_id, updated_at
     ) VALUES (?, ?, 1, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       active_revision_id = VALUES(active_revision_id),
       updated_by_principal_id = VALUES(updated_by_principal_id),
       version = IF(
         active_revision_id = VALUES(active_revision_id),
         version,
         version + 1
       ),
       updated_at = IF(
         active_revision_id = VALUES(active_revision_id),
         updated_at,
         VALUES(updated_at)
       )`,
    [options.workspaceId, ids.workspacePolicyRevision, options.actorId],
  );
  await assertDigest(
    connection,
    "instance_policy_revision",
    ids.instancePolicyRevision,
    definition.instancePolicyDigest,
  );
  await assertDigest(
    connection,
    "workspace_policy_revision",
    ids.workspacePolicyRevision,
    definition.workspacePolicyDigest,
  );
  return Object.freeze({
    instancePolicyRevisionId: ids.instancePolicyRevision,
    workspacePolicyRevisionId: ids.workspacePolicyRevision,
  });
}
