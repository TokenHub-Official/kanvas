import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { digestProviderValue } from "../runtime/provider-value-digest.js";
import { bootstrapImageProviderSharedPolicy } from "./bootstrap-image-provider-shared-policy.js";

export interface ImageProviderResourceIds {
  readonly endpoint: string;
  readonly credential: string;
  readonly secretVersion: string;
  readonly modelProfileRevision: string;
  readonly modelDeployment: string;
  readonly pricingRevision: string;
  readonly routePolicyRevision: string;
  readonly budgetAccount: string;
}

export interface ImageProviderResourceDefinition {
  readonly endpointBaseUrl: string;
  readonly endpointBaseUrlDigest: string;
  readonly modelDeploymentDigest: string;
  readonly modelProfileDigest: string;
  readonly modelProfileDocument: unknown;
  readonly pricingDigest: string;
  readonly pricingDocument: unknown;
  readonly pricingRevisionSourceKind:
    | "provider_documentation"
    | "provider_api"
    | "manual"
    | "contract"
    | "unverified";
  readonly routePolicyDigest: string;
  readonly routePolicyDocument: unknown;
  readonly secretAadDigest: string;
}

export interface ImageProviderResourceSpec {
  readonly label: string;
  readonly ids: ImageProviderResourceIds;
  readonly endpoint: {
    readonly key: string;
    readonly adapterKind: "openai_native" | "openai_compatible";
    readonly presetKind: "openai" | "newapi" | "tokenhub";
    readonly canonicalOrigin: string;
    readonly regionCode: string;
    readonly networkPolicy: Readonly<Record<string, unknown>>;
    readonly dataPolicy: Readonly<Record<string, unknown>>;
  };
  readonly credential: {
    readonly key: string;
    readonly providerKind: string;
    readonly authority: string;
    readonly billingIdentity: string;
    readonly egressIdentity: string;
  };
  readonly modelProfileKey: string;
  readonly modelDeploymentKey: string;
  readonly pricingKey: string;
  readonly routeKey: string;
  readonly budget: {
    readonly key: string;
    readonly hardLimitAmount: string;
  };
  readonly providerModelId: string;
  readonly deploymentReference: string;
  readonly secretMaterialFingerprint: string;
  readonly endpointValidationDigest: string;
  readonly validatedAt: Date;
}

export interface ImageProviderControlPlaneBootstrapResult {
  readonly budgetAccountId: string;
  readonly endpointId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly routePolicyRevisionId: string;
}

interface DigestRow extends RowDataPacket {
  readonly canonicalDigest: string;
}

interface ReadinessRow extends RowDataPacket {
  readonly activeSecretVersionId: string | null;
  readonly budgetLifecycleStatus: string;
  readonly credentialIdentityDigest: string;
  readonly credentialLifecycleStatus: string;
  readonly credentialMaterialGeneration: number;
  readonly credentialProviderKind: string;
  readonly endpointAdapterKind: string;
  readonly endpointBaseUrlDigest: string;
  readonly endpointCanonicalOrigin: string;
  readonly endpointLifecycleStatus: string;
  readonly endpointPresetKind: string;
  readonly endpointRegionCode: string;
  readonly endpointValidationDigest: string | null;
  readonly endpointValidationStatus: string;
  readonly modelDeploymentDigest: string;
  readonly modelLifecycleStatus: string;
  readonly pricingLifecycleStatus: string;
  readonly secretAadDigest: string;
  readonly secretLifecycleStatus: string;
  readonly secretMaterialFingerprint: string;
  readonly secretMaterialGeneration: number;
}

async function assertImmutableDigest(
  connection: PoolConnection,
  label: string,
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
      `Existing ${label} control-plane revision ${id} has a different immutable digest.`,
    );
  }
}

async function assertPricingDigest(
  connection: PoolConnection,
  label: string,
  id: string,
  definition: ImageProviderResourceDefinition,
): Promise<void> {
  const [rows] = await connection.query<DigestRow[]>(
    `SELECT canonical_digest AS canonicalDigest
     FROM pricing_revision
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  const actual = rows[0]?.canonicalDigest;
  if (actual !== definition.pricingDigest) {
    throw new Error(
      `Existing ${label} pricing control-plane revision ${id} has a different immutable digest.`,
    );
  }
}

export async function bootstrapImageProviderResources(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly definition: ImageProviderResourceDefinition;
    readonly spec: ImageProviderResourceSpec;
    readonly workspaceId: string;
  },
): Promise<ImageProviderControlPlaneBootstrapResult> {
  const { definition, spec } = options;
  const { ids } = spec;
  if (spec.validatedAt.getTime() > Date.now()) {
    throw new Error(
      `${spec.label} endpoint validation evidence cannot be in the future.`,
    );
  }
  await bootstrapImageProviderSharedPolicy(connection, {
    actorId: options.actorId,
    workspaceId: options.workspaceId,
  });
  await connection.execute(
    `INSERT IGNORE INTO provider_endpoint (
       id, workspace_id, endpoint_key, adapter_kind, preset_kind,
       base_url, canonical_origin, base_url_digest, region_code,
       network_policy, data_policy, lifecycle_status,
       validation_status, validation_digest, validated_at, version,
       created_by_principal_id, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active',
       'passed', ?, ?, 1, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     )`,
    [
      ids.endpoint,
      options.workspaceId,
      spec.endpoint.key,
      spec.endpoint.adapterKind,
      spec.endpoint.presetKind,
      definition.endpointBaseUrl,
      spec.endpoint.canonicalOrigin,
      definition.endpointBaseUrlDigest,
      spec.endpoint.regionCode,
      JSON.stringify(spec.endpoint.networkPolicy),
      JSON.stringify(spec.endpoint.dataPolicy),
      spec.endpointValidationDigest,
      spec.validatedAt,
      options.actorId,
    ],
  );
  const credentialIdentityDigest = digestProviderValue({
    credentialKey: spec.credential.key,
    providerEndpointId: ids.endpoint,
    identityEpoch: 1,
  });
  await connection.execute(
    `INSERT IGNORE INTO credential (
       id, workspace_id, provider_endpoint_id, credential_key,
       provider_kind, authority_digest, billing_identity_digest,
       egress_identity_digest, identity_digest, identity_epoch,
       material_generation, active_secret_version_id,
       lifecycle_status, version, created_by_principal_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, 'active', 1, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.credential,
      options.workspaceId,
      ids.endpoint,
      spec.credential.key,
      spec.credential.providerKind,
      digestProviderValue({
        authority: spec.credential.authority,
      }),
      digestProviderValue({
        billingIdentity: spec.credential.billingIdentity,
      }),
      digestProviderValue({
        egressIdentity: spec.credential.egressIdentity,
      }),
      credentialIdentityDigest,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO secret_version (
       id, workspace_id, credential_id, version, material_generation,
       source_kind, lifecycle_status, aad_digest,
       deployment_reference, material_fingerprint, format_version,
       drain_deadline_at, verified_at, activated_at, retired_at,
       revoked_at, destroyed_at, created_by_principal_id, created_at
     ) VALUES (?, ?, ?, 1, 1, 'deployment_reference', 'active', ?, ?, ?,
       1, NULL, ?, ?, NULL, NULL, NULL, ?, ?)`,
    [
      ids.secretVersion,
      options.workspaceId,
      ids.credential,
      definition.secretAadDigest,
      spec.deploymentReference,
      spec.secretMaterialFingerprint,
      spec.validatedAt,
      spec.validatedAt,
      options.actorId,
      spec.validatedAt,
    ],
  );
  await connection.execute(
    `UPDATE credential
     SET active_secret_version_id = ?,
         updated_at = UTC_TIMESTAMP(3)
     WHERE workspace_id = ?
       AND id = ?
       AND active_secret_version_id IS NULL`,
    [ids.secretVersion, options.workspaceId, ids.credential],
  );
  await connection.execute(
    `INSERT IGNORE INTO model_profile_revision (
       id, workspace_id, profile_key, revision, schema_version,
       profile_document, canonical_digest, lifecycle_status,
       created_by_principal_id, published_by_principal_id,
       created_at, published_at
     ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.modelProfileRevision,
      options.workspaceId,
      spec.modelProfileKey,
      JSON.stringify(definition.modelProfileDocument),
      definition.modelProfileDigest,
      options.actorId,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO model_deployment (
       id, workspace_id, provider_endpoint_id,
       model_profile_revision_id, deployment_key, provider_model_id,
       deployment_digest, lifecycle_status, version,
       created_by_principal_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.modelDeployment,
      options.workspaceId,
      ids.endpoint,
      ids.modelProfileRevision,
      spec.modelDeploymentKey,
      spec.providerModelId,
      definition.modelDeploymentDigest,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO pricing_revision (
       id, workspace_id, provider_endpoint_id, model_deployment_id,
       pricing_key, revision, schema_version, currency_code,
       pricing_document, canonical_digest, lifecycle_status, source_kind,
       verified_at, effective_at, created_by_principal_id,
       published_by_principal_id, created_at, published_at
     ) VALUES (?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
       ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.pricingRevision,
      options.workspaceId,
      ids.endpoint,
      ids.modelDeployment,
      spec.pricingKey,
      JSON.stringify(definition.pricingDocument),
      definition.pricingDigest,
      definition.pricingRevisionSourceKind,
      options.actorId,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO route_policy_revision (
       id, workspace_id, route_key, revision, schema_version,
       route_document, canonical_digest, lifecycle_status,
       created_by_principal_id, published_by_principal_id,
       created_at, published_at
     ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.routePolicyRevision,
      options.workspaceId,
      spec.routeKey,
      JSON.stringify(definition.routePolicyDocument),
      definition.routePolicyDigest,
      options.actorId,
      options.actorId,
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO budget_account (
       id, workspace_id, account_key, currency_code,
       period_start_at, period_end_at, hard_limit_amount,
       consumed_amount, reserved_amount, unknown_held_amount,
       lifecycle_status, version, created_by_principal_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'USD', '2026-01-01 00:00:00.000',
       '2030-01-01 00:00:00.000', ?, 0, 0, 0, 'active', 1, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      ids.budgetAccount,
      options.workspaceId,
      spec.budget.key,
      spec.budget.hardLimitAmount,
      options.actorId,
    ],
  );
  for (const [table, id, expectedDigest] of [
    [
      "model_profile_revision",
      ids.modelProfileRevision,
      definition.modelProfileDigest,
    ],
    [
      "route_policy_revision",
      ids.routePolicyRevision,
      definition.routePolicyDigest,
    ],
  ] as const) {
    await assertImmutableDigest(
      connection,
      spec.label,
      table,
      id,
      expectedDigest,
    );
  }
  await assertPricingDigest(
    connection,
    spec.label,
    ids.pricingRevision,
    definition,
  );
  const [readinessRows] = await connection.execute<ReadinessRow[]>(
    `SELECT
       endpoint.adapter_kind AS endpointAdapterKind,
       endpoint.base_url_digest AS endpointBaseUrlDigest,
       endpoint.canonical_origin AS endpointCanonicalOrigin,
       endpoint.lifecycle_status AS endpointLifecycleStatus,
       endpoint.preset_kind AS endpointPresetKind,
       endpoint.region_code AS endpointRegionCode,
       endpoint.validation_status AS endpointValidationStatus,
       endpoint.validation_digest AS endpointValidationDigest,
       credential.identity_digest AS credentialIdentityDigest,
       credential.lifecycle_status AS credentialLifecycleStatus,
       credential.material_generation AS credentialMaterialGeneration,
       credential.provider_kind AS credentialProviderKind,
       credential.active_secret_version_id AS activeSecretVersionId,
       secret.aad_digest AS secretAadDigest,
       secret.lifecycle_status AS secretLifecycleStatus,
       secret.material_fingerprint AS secretMaterialFingerprint,
       secret.material_generation AS secretMaterialGeneration,
       model.deployment_digest AS modelDeploymentDigest,
       model.lifecycle_status AS modelLifecycleStatus,
       pricing.lifecycle_status AS pricingLifecycleStatus,
       budget.lifecycle_status AS budgetLifecycleStatus
     FROM provider_endpoint AS endpoint
     INNER JOIN credential
       ON credential.workspace_id = endpoint.workspace_id
      AND credential.provider_endpoint_id = endpoint.id
      AND credential.id = ?
     INNER JOIN secret_version AS secret
       ON secret.workspace_id = credential.workspace_id
      AND secret.credential_id = credential.id
      AND secret.id = credential.active_secret_version_id
     INNER JOIN model_deployment AS model
       ON model.workspace_id = endpoint.workspace_id
      AND model.provider_endpoint_id = endpoint.id
      AND model.id = ?
     INNER JOIN pricing_revision AS pricing
       ON pricing.workspace_id = endpoint.workspace_id
      AND pricing.provider_endpoint_id = endpoint.id
      AND pricing.model_deployment_id = model.id
      AND pricing.id = ?
     INNER JOIN budget_account AS budget
       ON budget.workspace_id = endpoint.workspace_id
      AND budget.id = ?
     WHERE endpoint.workspace_id = ?
       AND endpoint.id = ?
     LIMIT 1`,
    [
      ids.credential,
      ids.modelDeployment,
      ids.pricingRevision,
      ids.budgetAccount,
      options.workspaceId,
      ids.endpoint,
    ],
  );
  const ready = readinessRows[0];
  if (
    !ready ||
    ready.endpointAdapterKind !== spec.endpoint.adapterKind ||
    ready.endpointBaseUrlDigest !== definition.endpointBaseUrlDigest ||
    ready.endpointCanonicalOrigin !== spec.endpoint.canonicalOrigin ||
    ready.endpointLifecycleStatus !== "active" ||
    ready.endpointPresetKind !== spec.endpoint.presetKind ||
    ready.endpointRegionCode !== spec.endpoint.regionCode ||
    ready.endpointValidationStatus !== "passed" ||
    ready.endpointValidationDigest !== spec.endpointValidationDigest ||
    ready.credentialIdentityDigest !== credentialIdentityDigest ||
    ready.credentialLifecycleStatus !== "active" ||
    ready.credentialProviderKind !== spec.credential.providerKind ||
    ready.activeSecretVersionId !== ids.secretVersion ||
    ready.credentialMaterialGeneration !== ready.secretMaterialGeneration ||
    ready.secretAadDigest !== definition.secretAadDigest ||
    ready.secretLifecycleStatus !== "active" ||
    ready.secretMaterialFingerprint !== spec.secretMaterialFingerprint ||
    ready.modelDeploymentDigest !== definition.modelDeploymentDigest ||
    ready.modelLifecycleStatus !== "active" ||
    ready.pricingLifecycleStatus !== "published" ||
    ready.budgetLifecycleStatus !== "active"
  ) {
    throw new Error(
      `${spec.label} control-plane records are not active and internally consistent.`,
    );
  }
  return Object.freeze({
    endpointId: ids.endpoint,
    modelDeploymentId: ids.modelDeployment,
    pricingRevisionId: ids.pricingRevision,
    routePolicyRevisionId: ids.routePolicyRevision,
    budgetAccountId: ids.budgetAccount,
  });
}
