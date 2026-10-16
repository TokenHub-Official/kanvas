import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  parseProviderConstraintDocument,
  parseProviderRoutePolicyDocument,
  type ProviderConstraintDocumentV1,
  type ProviderRoutePolicyDocumentV1,
} from "./configuration-policy.js";
import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

export type ConfigurationProviderStoreErrorCode =
  | "configuration_provider.invalid_argument"
  | "configuration_provider.not_found"
  | "configuration_provider.not_configured"
  | "configuration_provider.integrity_violation";

export class ConfigurationProviderStoreError extends Error {
  public constructor(
    public readonly code: ConfigurationProviderStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConfigurationProviderStoreError";
  }
}

export interface PublishedInstancePolicyRevision {
  readonly id: string;
  readonly revision: number;
  readonly schemaVersion: 1;
  readonly canonicalDigest: string;
  readonly policy: ProviderConstraintDocumentV1;
  readonly publishedAt: Date;
}

export interface PublishedWorkspacePolicyRevision {
  readonly id: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly schemaVersion: 1;
  readonly canonicalDigest: string;
  readonly policy: ProviderConstraintDocumentV1;
  readonly publishedAt: Date;
}

export interface PublishedRoutePolicyRevision {
  readonly id: string;
  readonly workspaceId: string;
  readonly routeKey: string;
  readonly revision: number;
  readonly schemaVersion: 1;
  readonly canonicalDigest: string;
  readonly route: ProviderRoutePolicyDocumentV1;
  readonly publishedAt: Date;
}

export interface CurrentInstancePolicyRevision {
  readonly bindingVersion: number;
  readonly bindingUpdatedAt: Date;
  readonly policyRevision: PublishedInstancePolicyRevision;
}

export interface CurrentWorkspacePolicyRevision {
  readonly workspaceId: string;
  readonly bindingVersion: number;
  readonly bindingUpdatedAt: Date;
  readonly policyRevision: PublishedWorkspacePolicyRevision;
}

export interface ActiveProviderPolicySet {
  readonly instance: CurrentInstancePolicyRevision;
  readonly workspace: CurrentWorkspacePolicyRevision;
  readonly route: PublishedRoutePolicyRevision;
}

export interface ConfigurationProviderStore {
  readPublishedInstancePolicyRevision(
    revisionId: string,
  ): Promise<PublishedInstancePolicyRevision>;
  readCurrentInstancePolicyRevision(): Promise<CurrentInstancePolicyRevision>;
  readPublishedWorkspacePolicyRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<PublishedWorkspacePolicyRevision>;
  readCurrentWorkspacePolicyRevision(
    workspaceId: string,
  ): Promise<CurrentWorkspacePolicyRevision>;
  readPublishedRoutePolicyRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<PublishedRoutePolicyRevision>;
  resolveActivePolicySet(
    workspaceId: string,
    routePolicyRevisionId: string,
  ): Promise<ActiveProviderPolicySet>;
}

interface InstancePolicyRow extends RowDataPacket {
  readonly id: string;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly policyDocument: unknown;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
  readonly publishedAt: Date;
}

interface CurrentInstancePolicyRow extends InstancePolicyRow {
  readonly bindingVersion: number;
  readonly bindingUpdatedAt: Date;
}

interface WorkspacePolicyRow extends InstancePolicyRow {
  readonly workspaceId: string;
}

interface CurrentWorkspacePolicyRow extends WorkspacePolicyRow {
  readonly bindingVersion: number;
  readonly bindingUpdatedAt: Date;
}

interface RoutePolicyRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly routeKey: string;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly routeDocument: unknown;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
  readonly publishedAt: Date;
}

function fail(
  code: ConfigurationProviderStoreErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new ConfigurationProviderStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function invalidArgument(message: string): never {
  return fail("configuration_provider.invalid_argument", message);
}

function integrity(message: string, cause?: unknown): never {
  return fail("configuration_provider.integrity_violation", message, cause);
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalidArgument(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertPersistedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    return integrity(`${label} is not a canonical uppercase ULID.`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4_294_967_295
  ) {
    return integrity(`${label} is not a positive unsigned integer.`);
  }
  return value;
}

function assertPublishedAt(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return integrity(`${label} is not a valid timestamp.`);
  }
  return new Date(value.getTime());
}

function assertPublishedRevisionFacts(
  row: InstancePolicyRow,
  label: string,
): {
  readonly id: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly publishedAt: Date;
} {
  const id = assertPersistedId(row.id, `${label}.id`);
  const revision = assertPositiveInteger(row.revision, `${label}.revision`);
  if (row.schemaVersion !== 1) {
    return integrity(`${label} has an unsupported schema version.`);
  }
  if (row.lifecycleStatus !== "published") {
    return integrity(`${label} is not in the published lifecycle.`);
  }
  if (
    typeof row.canonicalDigest !== "string" ||
    !digestPattern.test(row.canonicalDigest)
  ) {
    return integrity(`${label} has an invalid canonical digest.`);
  }
  return Object.freeze({
    id,
    revision,
    canonicalDigest: row.canonicalDigest,
    publishedAt: assertPublishedAt(row.publishedAt, `${label}.publishedAt`),
  });
}

function decodeJsonDocument(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    return integrity(`${label} is not valid JSON.`, error);
  }
}

function verifyCanonicalDigest(
  document: unknown,
  expectedDigest: string,
  label: string,
): void {
  let actualDigest: string;
  try {
    actualDigest = digestProviderValue(document);
  } catch (error) {
    return integrity(`${label} is not canonical JSON data.`, error);
  }
  if (actualDigest !== expectedDigest) {
    integrity(`${label} does not match its canonical digest.`);
  }
}

function parseConstraintPolicy(
  value: unknown,
  expectedDigest: string,
  label: string,
): ProviderConstraintDocumentV1 {
  const document = decodeJsonDocument(value, label);
  verifyCanonicalDigest(document, expectedDigest, label);
  try {
    return parseProviderConstraintDocument(document, label);
  } catch (error) {
    return integrity(`${label} violates the V1 policy schema.`, error);
  }
}

function parseRoutePolicy(
  value: unknown,
  expectedDigest: string,
  label: string,
): ProviderRoutePolicyDocumentV1 {
  const document = decodeJsonDocument(value, label);
  verifyCanonicalDigest(document, expectedDigest, label);
  try {
    return parseProviderRoutePolicyDocument(document);
  } catch (error) {
    return integrity(`${label} violates the V1 route schema.`, error);
  }
}

function parsePublishedInstancePolicy(
  row: InstancePolicyRow,
): PublishedInstancePolicyRevision {
  const facts = assertPublishedRevisionFacts(row, "Instance policy revision");
  return Object.freeze({
    ...facts,
    schemaVersion: 1,
    policy: parseConstraintPolicy(
      row.policyDocument,
      facts.canonicalDigest,
      "Instance policy document",
    ),
  });
}

function parsePublishedWorkspacePolicy(
  row: WorkspacePolicyRow,
  expectedWorkspaceId: string,
): PublishedWorkspacePolicyRevision {
  const workspaceId = assertPersistedId(
    row.workspaceId,
    "Workspace policy revision.workspaceId",
  );
  if (workspaceId !== expectedWorkspaceId) {
    return integrity(
      "Workspace policy revision escaped its requested Workspace.",
    );
  }
  const facts = assertPublishedRevisionFacts(row, "Workspace policy revision");
  return Object.freeze({
    ...facts,
    workspaceId,
    schemaVersion: 1,
    policy: parseConstraintPolicy(
      row.policyDocument,
      facts.canonicalDigest,
      "Workspace policy document",
    ),
  });
}

function parsePublishedRoutePolicy(
  row: RoutePolicyRow,
  expectedWorkspaceId: string,
): PublishedRoutePolicyRevision {
  const workspaceId = assertPersistedId(
    row.workspaceId,
    "Route policy revision.workspaceId",
  );
  if (workspaceId !== expectedWorkspaceId) {
    return integrity("Route policy revision escaped its requested Workspace.");
  }
  const id = assertPersistedId(row.id, "Route policy revision.id");
  const revision = assertPositiveInteger(
    row.revision,
    "Route policy revision.revision",
  );
  if (
    typeof row.routeKey !== "string" ||
    row.routeKey.length < 1 ||
    row.routeKey.length > 160 ||
    row.routeKey !== row.routeKey.trim()
  ) {
    return integrity("Route policy revision.routeKey is invalid.");
  }
  if (row.schemaVersion !== 1) {
    return integrity(
      "Route policy revision has an unsupported schema version.",
    );
  }
  if (row.lifecycleStatus !== "published") {
    return integrity(
      "Route policy revision is not in the published lifecycle.",
    );
  }
  if (
    typeof row.canonicalDigest !== "string" ||
    !digestPattern.test(row.canonicalDigest)
  ) {
    return integrity("Route policy revision has an invalid canonical digest.");
  }
  return Object.freeze({
    id,
    workspaceId,
    routeKey: row.routeKey,
    revision,
    schemaVersion: 1,
    canonicalDigest: row.canonicalDigest,
    route: parseRoutePolicy(
      row.routeDocument,
      row.canonicalDigest,
      "Route policy document",
    ),
    publishedAt: assertPublishedAt(
      row.publishedAt,
      "Route policy revision.publishedAt",
    ),
  });
}

function parseBindingFacts(
  row: {
    readonly bindingVersion: unknown;
    readonly bindingUpdatedAt: unknown;
  },
  label: string,
): {
  readonly bindingVersion: number;
  readonly bindingUpdatedAt: Date;
} {
  return Object.freeze({
    bindingVersion: assertPositiveInteger(
      row.bindingVersion,
      `${label}.version`,
    ),
    bindingUpdatedAt: assertPublishedAt(
      row.bindingUpdatedAt,
      `${label}.updatedAt`,
    ),
  });
}

export async function readPublishedInstancePolicyRevisionInTransaction(
  connection: PoolConnection,
  revisionId: string,
): Promise<PublishedInstancePolicyRevision> {
  assertId(revisionId, "revisionId");
  const [rows] = await connection.execute<InstancePolicyRow[]>(
    `SELECT
       id,
       revision,
       schema_version AS schemaVersion,
       policy_document AS policyDocument,
       canonical_digest AS canonicalDigest,
       lifecycle_status AS lifecycleStatus,
       published_at AS publishedAt
     FROM instance_policy_revision
     WHERE id = ?
     LIMIT 1
     FOR SHARE`,
    [revisionId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "configuration_provider.not_found",
      "Published Instance policy revision does not exist.",
    );
  }
  return parsePublishedInstancePolicy(row);
}

export async function readCurrentInstancePolicyRevisionInTransaction(
  connection: PoolConnection,
): Promise<CurrentInstancePolicyRevision> {
  const [rows] = await connection.execute<CurrentInstancePolicyRow[]>(
    `SELECT
       revision.id,
       revision.revision,
       revision.schema_version AS schemaVersion,
       revision.policy_document AS policyDocument,
       revision.canonical_digest AS canonicalDigest,
       revision.lifecycle_status AS lifecycleStatus,
       revision.published_at AS publishedAt,
       binding.version AS bindingVersion,
       binding.updated_at AS bindingUpdatedAt
     FROM instance_policy_binding AS binding
     INNER JOIN instance_policy_revision AS revision
       ON revision.id = binding.active_revision_id
     WHERE binding.singleton_id = 1
     LIMIT 1
     FOR SHARE`,
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "configuration_provider.not_configured",
      "The active Instance policy binding is not configured.",
    );
  }
  return Object.freeze({
    ...parseBindingFacts(row, "Instance policy binding"),
    policyRevision: parsePublishedInstancePolicy(row),
  });
}

export async function readPublishedWorkspacePolicyRevisionInTransaction(
  connection: PoolConnection,
  workspaceId: string,
  revisionId: string,
): Promise<PublishedWorkspacePolicyRevision> {
  assertId(workspaceId, "workspaceId");
  assertId(revisionId, "revisionId");
  const [rows] = await connection.execute<WorkspacePolicyRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       revision,
       schema_version AS schemaVersion,
       policy_document AS policyDocument,
       canonical_digest AS canonicalDigest,
       lifecycle_status AS lifecycleStatus,
       published_at AS publishedAt
     FROM workspace_policy_revision
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, revisionId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "configuration_provider.not_found",
      "Published Workspace policy revision does not exist.",
    );
  }
  return parsePublishedWorkspacePolicy(row, workspaceId);
}

export async function readCurrentWorkspacePolicyRevisionInTransaction(
  connection: PoolConnection,
  workspaceId: string,
): Promise<CurrentWorkspacePolicyRevision> {
  assertId(workspaceId, "workspaceId");
  const [rows] = await connection.execute<CurrentWorkspacePolicyRow[]>(
    `SELECT
       revision.id,
       revision.workspace_id AS workspaceId,
       revision.revision,
       revision.schema_version AS schemaVersion,
       revision.policy_document AS policyDocument,
       revision.canonical_digest AS canonicalDigest,
       revision.lifecycle_status AS lifecycleStatus,
       revision.published_at AS publishedAt,
       binding.version AS bindingVersion,
       binding.updated_at AS bindingUpdatedAt
     FROM workspace_policy_binding AS binding
     INNER JOIN workspace_policy_revision AS revision
       ON revision.workspace_id = binding.workspace_id
      AND revision.id = binding.active_revision_id
     WHERE binding.workspace_id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "configuration_provider.not_configured",
      "The active Workspace policy binding is not configured.",
    );
  }
  return Object.freeze({
    workspaceId,
    ...parseBindingFacts(row, "Workspace policy binding"),
    policyRevision: parsePublishedWorkspacePolicy(row, workspaceId),
  });
}

export async function readPublishedRoutePolicyRevisionInTransaction(
  connection: PoolConnection,
  workspaceId: string,
  revisionId: string,
): Promise<PublishedRoutePolicyRevision> {
  assertId(workspaceId, "workspaceId");
  assertId(revisionId, "revisionId");
  const [rows] = await connection.execute<RoutePolicyRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       route_key AS routeKey,
       revision,
       schema_version AS schemaVersion,
       route_document AS routeDocument,
       canonical_digest AS canonicalDigest,
       lifecycle_status AS lifecycleStatus,
       published_at AS publishedAt
     FROM route_policy_revision
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, revisionId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "configuration_provider.not_found",
      "Published Route policy revision does not exist.",
    );
  }
  return parsePublishedRoutePolicy(row, workspaceId);
}

export async function resolveActiveProviderPolicySetInTransaction(
  connection: PoolConnection,
  workspaceId: string,
  routePolicyRevisionId: string,
): Promise<ActiveProviderPolicySet> {
  assertId(workspaceId, "workspaceId");
  assertId(routePolicyRevisionId, "routePolicyRevisionId");
  const instance =
    await readCurrentInstancePolicyRevisionInTransaction(connection);
  const workspace = await readCurrentWorkspacePolicyRevisionInTransaction(
    connection,
    workspaceId,
  );
  const route = await readPublishedRoutePolicyRevisionInTransaction(
    connection,
    workspaceId,
    routePolicyRevisionId,
  );
  return Object.freeze({
    instance,
    workspace,
    route,
  });
}

async function inReadTransaction<TResult>(
  pool: Pool,
  callback: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createConfigurationProviderStore(
  pool: Pool,
): ConfigurationProviderStore {
  return Object.freeze({
    async readPublishedInstancePolicyRevision(
      revisionId: string,
    ): Promise<PublishedInstancePolicyRevision> {
      assertId(revisionId, "revisionId");
      return inReadTransaction(pool, (connection) =>
        readPublishedInstancePolicyRevisionInTransaction(
          connection,
          revisionId,
        ),
      );
    },
    async readCurrentInstancePolicyRevision(): Promise<CurrentInstancePolicyRevision> {
      return inReadTransaction(pool, (connection) =>
        readCurrentInstancePolicyRevisionInTransaction(connection),
      );
    },
    async readPublishedWorkspacePolicyRevision(
      workspaceId: string,
      revisionId: string,
    ): Promise<PublishedWorkspacePolicyRevision> {
      assertId(workspaceId, "workspaceId");
      assertId(revisionId, "revisionId");
      return inReadTransaction(pool, (connection) =>
        readPublishedWorkspacePolicyRevisionInTransaction(
          connection,
          workspaceId,
          revisionId,
        ),
      );
    },
    async readCurrentWorkspacePolicyRevision(
      workspaceId: string,
    ): Promise<CurrentWorkspacePolicyRevision> {
      assertId(workspaceId, "workspaceId");
      return inReadTransaction(pool, (connection) =>
        readCurrentWorkspacePolicyRevisionInTransaction(
          connection,
          workspaceId,
        ),
      );
    },
    async readPublishedRoutePolicyRevision(
      workspaceId: string,
      revisionId: string,
    ): Promise<PublishedRoutePolicyRevision> {
      assertId(workspaceId, "workspaceId");
      assertId(revisionId, "revisionId");
      return inReadTransaction(pool, (connection) =>
        readPublishedRoutePolicyRevisionInTransaction(
          connection,
          workspaceId,
          revisionId,
        ),
      );
    },
    async resolveActivePolicySet(
      workspaceId: string,
      routePolicyRevisionId: string,
    ): Promise<ActiveProviderPolicySet> {
      assertId(workspaceId, "workspaceId");
      assertId(routePolicyRevisionId, "routePolicyRevisionId");
      return inReadTransaction(pool, (connection) =>
        resolveActiveProviderPolicySetInTransaction(
          connection,
          workspaceId,
          routePolicyRevisionId,
        ),
      );
    },
  });
}
