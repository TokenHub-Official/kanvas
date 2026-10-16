import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { monotonicFactory } from "ulid";

import {
  parseCapabilityCatalogRecommendationV1,
  parseCapabilityContractAssetV1,
  type CapabilityCatalogRecommendationV1,
} from "@kanvas/contracts/capability";

import {
  capabilityCatalogRecommendationFromPreparedPackageV1,
  CatalogPackageInstallError,
  prepareCatalogPackageV1,
  type PreparedCatalogPackageV1,
} from "./catalog-package-installer.js";
import { loadCatalogPackageV1 } from "./catalog-package-loader.js";
import { digestProviderValue } from "../runtime/provider-value-digest.js";

interface CatalogIdentityRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalDigest: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

export interface RegisterCapabilityCatalogEntryInTransactionOptions {
  readonly workspaceId: string;
  readonly entryId: string;
  readonly document: CapabilityCatalogRecommendationV1;
  readonly now: Date;
}

export interface RegisterCatalogPackageOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly packageRoot: string;
  readonly now?: Date;
  readonly nextId?: () => string;
}

export interface CatalogPackageRegistrationResult {
  readonly packageKey: string;
  readonly packageVersion: string;
  readonly packageDigest: string;
  readonly capabilityRecommendations: number;
  readonly modelResourceRecommendations: number;
  readonly replayed: boolean;
}

function conflict(message: string): never {
  throw new CatalogPackageInstallError("installed_revision_conflict", message);
}

function assertRegistrationIdentity(value: string, label: string): void {
  if (!idPattern.test(value)) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      `${label} must be a canonical uppercase ULID.`,
    );
  }
}

function nextCatalogId(nextId: () => string): string {
  const value = nextId();
  assertRegistrationIdentity(value, "Catalog entry ID");
  return value;
}

function capabilityKey(document: CapabilityCatalogRecommendationV1): string {
  const contract = document.assets.find(
    (asset) => asset.descriptor.kind === "capability_contract",
  );
  if (!contract) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      `Capability recommendation ${document.recommendationKey} has no Contract.`,
    );
  }
  return parseCapabilityContractAssetV1(contract.document).contractKey;
}

export async function registerCapabilityCatalogEntryInTransaction(
  connection: PoolConnection,
  options: RegisterCapabilityCatalogEntryInTransactionOptions,
): Promise<Readonly<{ entryId: string; replayed: boolean }>> {
  assertRegistrationIdentity(options.workspaceId, "Workspace ID");
  assertRegistrationIdentity(options.entryId, "Catalog entry ID");
  if (
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime())
  ) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      "Catalog registration time is invalid.",
    );
  }
  const document = parseCapabilityCatalogRecommendationV1(options.document);
  const canonicalDigest = digestProviderValue(document);
  const [rows] = await connection.execute<CatalogIdentityRow[]>(
    `SELECT id, canonical_digest AS canonicalDigest
     FROM capability_catalog_entry
     WHERE workspace_id = ? AND recommendation_key = ?
       AND package_version = ?
     LIMIT 1 FOR UPDATE`,
    [options.workspaceId, document.recommendationKey, document.package.version],
  );
  const existing = rows[0];
  if (existing) {
    if (existing.canonicalDigest !== canonicalDigest) {
      conflict(
        `Capability recommendation ${document.recommendationKey} differs from its registered version.`,
      );
    }
    return Object.freeze({ entryId: existing.id, replayed: true });
  }
  await connection.execute<ResultSetHeader>(
    `UPDATE capability_catalog_entry
     SET lifecycle_status = 'retired', updated_at = ?
     WHERE workspace_id = ? AND recommendation_key = ?
       AND lifecycle_status = 'active'`,
    [options.now, options.workspaceId, document.recommendationKey],
  );
  await connection.execute<ResultSetHeader>(
    `INSERT INTO capability_catalog_entry (
       id, workspace_id, recommendation_key, capability_key,
       package_key, package_version, package_digest,
       canonical_digest, document, lifecycle_status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      options.entryId,
      options.workspaceId,
      document.recommendationKey,
      capabilityKey(document),
      document.package.packageKey,
      document.package.version,
      document.package.contentDigest,
      canonicalDigest,
      JSON.stringify(document),
      options.now,
      options.now,
    ],
  );
  return Object.freeze({ entryId: options.entryId, replayed: false });
}

export async function registerPreparedCatalogPackageInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly prepared: PreparedCatalogPackageV1;
    readonly now: Date;
    readonly nextId: () => string;
  },
): Promise<CatalogPackageRegistrationResult> {
  if (
    options.prepared.workflows.size > 0 ||
    options.prepared.skills.length > 0
  ) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      "A Capability recommendation package must not contain Workflow or Skill assets.",
    );
  }
  let replayed = true;
  assertRegistrationIdentity(options.workspaceId, "Workspace ID");
  if (
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime())
  ) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      "Catalog registration time is invalid.",
    );
  }
  for (const resource of options.prepared.modelResources.values()) {
    const [rows] = await connection.execute<CatalogIdentityRow[]>(
      `SELECT id, canonical_digest AS canonicalDigest
       FROM model_resource_catalog_entry
       WHERE workspace_id = ? AND asset_key = ?
       LIMIT 1 FOR UPDATE`,
      [options.workspaceId, resource.assetKey],
    );
    const existing = rows[0];
    if (existing) {
      if (existing.canonicalDigest !== resource.digest) {
        conflict(
          `Model Resource recommendation ${resource.document.resourceKey} differs from its registered version.`,
        );
      }
      const [retired] = await connection.execute<ResultSetHeader>(
        `UPDATE model_resource_catalog_entry
         SET lifecycle_status = 'retired', updated_at = ?
         WHERE workspace_id = ? AND resource_key = ? AND asset_key <> ?
           AND lifecycle_status = 'active'`,
        [
          options.now,
          options.workspaceId,
          resource.document.resourceKey,
          resource.assetKey,
        ],
      );
      replayed = replayed && retired.affectedRows === 0;
      continue;
    }
    replayed = false;
    await connection.execute<ResultSetHeader>(
      `UPDATE model_resource_catalog_entry
       SET lifecycle_status = 'retired', updated_at = ?
       WHERE workspace_id = ? AND resource_key = ?
         AND lifecycle_status = 'active'`,
      [options.now, options.workspaceId, resource.document.resourceKey],
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO model_resource_catalog_entry (
         id, workspace_id, asset_key, resource_key, revision,
         canonical_digest, document, lifecycle_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        nextCatalogId(options.nextId),
        options.workspaceId,
        resource.assetKey,
        resource.document.resourceKey,
        resource.document.revision,
        resource.digest,
        JSON.stringify(resource.document),
        options.now,
        options.now,
      ],
    );
  }
  for (const recommendation of options.prepared.loaded.manifest
    .recommendations) {
    const result = await registerCapabilityCatalogEntryInTransaction(
      connection,
      {
        workspaceId: options.workspaceId,
        entryId: nextCatalogId(options.nextId),
        document: capabilityCatalogRecommendationFromPreparedPackageV1(
          options.prepared,
          recommendation,
        ),
        now: options.now,
      },
    );
    replayed = replayed && result.replayed;
  }
  return Object.freeze({
    packageKey: options.prepared.loaded.manifest.packageKey,
    packageVersion: options.prepared.loaded.manifest.version,
    packageDigest: options.prepared.loaded.manifest.contentDigest,
    capabilityRecommendations:
      options.prepared.loaded.manifest.recommendations.length,
    modelResourceRecommendations: options.prepared.modelResources.size,
    replayed,
  });
}

export async function registerCatalogPackageV1(
  options: RegisterCatalogPackageOptions,
): Promise<CatalogPackageRegistrationResult> {
  const prepared = prepareCatalogPackageV1(
    await loadCatalogPackageV1(options.packageRoot),
  );
  const connection = await options.pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await registerPreparedCatalogPackageInTransaction(
      connection,
      {
        workspaceId: options.workspaceId,
        prepared,
        now: options.now ?? new Date(),
        nextId: options.nextId ?? monotonicFactory(),
      },
    );
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
