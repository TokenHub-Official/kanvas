import {
  createRuntimeConfigurationReader,
  type RuntimeConfigurationSnapshot,
} from "./runtime-configuration-reader.js";
import {
  authorizationModelVersion,
  type TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type {
  RuntimeConfigurationRevision,
  RuntimeConfigurationOverview,
  RuntimeConfigurationWorker,
  PublishRuntimeConfiguration,
  RestoreRuntimeConfiguration,
} from "@kanvas/contracts/api";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import { ulid } from "ulid";
import {
  inTransaction,
  validateAuthority,
  requireCurrentAdministrator,
  type InstanceAccessAuditContext,
} from "./instance-access-store.js";
import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import {
  normalizeRuntimeConfiguration,
  RuntimeConfigurationError,
} from "./runtime-configuration-policy.js";

interface RevisionRow extends RowDataPacket {
  version: number;
  document: unknown;
  reason: string;
  publishedBy: string;
  publishedAt: Date;
  restoredFromVersion: number | null;
}
const columns =
  "version, document, reason, published_by AS publishedBy, published_at AS publishedAt, restored_from_version AS restoredFromVersion";
function revision(row: RevisionRow): RuntimeConfigurationRevision {
  try {
    return {
      version: row.version,
      document: normalizeRuntimeConfiguration(
        typeof row.document === "string"
          ? JSON.parse(row.document)
          : row.document,
      ),
      reason: row.reason,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt.toISOString(),
      restoredFromVersion: row.restoredFromVersion,
    };
  } catch {
    throw new RuntimeConfigurationError(
      "runtime_configuration.unavailable",
      "Stored runtime configuration is invalid.",
    );
  }
}
export interface RuntimeConfigurationStore {
  recordResultDecision(decision: {
    readonly workspaceId: string;
    readonly invocationId: string;
    readonly version: number | null;
    readonly origin: string;
    readonly source: "environment" | "instance";
    readonly outcome: string;
  }): Promise<void>;
  overview(
    authority: TrustedInstanceAdministratorScope,
  ): Promise<RuntimeConfigurationOverview>;
  observeWorker(worker: RuntimeConfigurationWorker): Promise<void>;
  read(): Promise<RuntimeConfigurationRevision | null>;
  readEffective(): Promise<RuntimeConfigurationSnapshot>;
  history(
    authority: TrustedInstanceAdministratorScope,
  ): Promise<{ items: RuntimeConfigurationRevision[]; truncated: boolean }>;
  publish(
    authority: TrustedInstanceAdministratorScope,
    input: PublishRuntimeConfiguration,
    audit: InstanceAccessAuditContext,
  ): Promise<RuntimeConfigurationRevision>;
  restore(
    authority: TrustedInstanceAdministratorScope,
    input: RestoreRuntimeConfiguration,
    audit: InstanceAccessAuditContext,
  ): Promise<RuntimeConfigurationRevision>;
}
export async function readRuntimeConfiguration(
  connection: Pick<PoolConnection, "execute">,
  instanceId: string,
): Promise<RuntimeConfigurationRevision | null> {
  const [rows] = await connection.execute<RevisionRow[]>(
    `SELECT ${columns} FROM instance_runtime_configuration_revision WHERE instance_id = ? ORDER BY version DESC LIMIT 1`,
    [instanceId],
  );
  return rows[0] ? revision(rows[0]) : null;
}
export function createRuntimeConfigurationStore(
  pool: Pool,
  instanceId: string,
): RuntimeConfigurationStore {
  async function trusted(
    connection: PoolConnection,
    authority: TrustedInstanceAdministratorScope,
  ) {
    validateAuthority(authority, instanceId);
    await requireCurrentAdministrator(connection, authority);
  }
  async function publish(
    connection: PoolConnection,
    authority: TrustedInstanceAdministratorScope,
    input: PublishRuntimeConfiguration | RestoreRuntimeConfiguration,
    context: InstanceAccessAuditContext,
  ): Promise<RuntimeConfigurationRevision> {
    await trusted(connection, authority);
    await connection.execute(
      "SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? FOR UPDATE",
      [instanceId],
    );
    const current = await readRuntimeConfiguration(connection, instanceId);
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new RuntimeConfigurationError(
        "runtime_configuration.conflict",
        "Configuration changed. Reload before publishing.",
      );
    let source = "document" in input ? input.document : undefined;
    const restoredFromVersion =
      "sourceVersion" in input ? input.sourceVersion : null;
    if (restoredFromVersion !== null) {
      const [rows] = await connection.execute<RevisionRow[]>(
        `SELECT ${columns} FROM instance_runtime_configuration_revision WHERE instance_id = ? AND version = ?`,
        [instanceId, restoredFromVersion],
      );
      if (!rows[0])
        throw new RuntimeConfigurationError(
          "runtime_configuration.invalid",
          "Configuration revision does not exist.",
        );
      source = revision(rows[0]).document;
    }
    const document = normalizeRuntimeConfiguration(source);
    if (current?.document.activated && !document.activated)
      throw new RuntimeConfigurationError(
        "runtime_configuration.invalid",
        "Activated governance cannot revert to legacy configuration. Publish explicit limits or disable downloads instead.",
      );
    const reason = input.reason.trim();
    if (!reason || reason.length > 500)
      throw new RuntimeConfigurationError(
        "runtime_configuration.invalid",
        "A change reason is required.",
      );
    for (const entry of document.downloads.providers) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM provider_setting WHERE workspace_id = ? AND provider_endpoint_id = ?",
        [entry.workspaceId, entry.providerEndpointId],
      );
      if (!rows.length)
        throw new RuntimeConfigurationError(
          "runtime_configuration.invalid",
          "The selected model service does not exist in its Workspace.",
        );
    }
    const version = (current?.version ?? 0) + 1;
    const now = new Date();
    await connection.execute(
      "INSERT INTO instance_runtime_configuration_revision (instance_id, version, document, reason, published_by, published_at, restored_from_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        instanceId,
        version,
        JSON.stringify(document),
        reason,
        authority.principalId,
        now,
        restoredFromVersion,
      ],
    );
    const event =
      restoredFromVersion === null
        ? "instance.runtime_configuration.published"
        : "instance.runtime_configuration.restored";
    await appendAuditEventInTransaction(connection, {
      id: context.auditEventId ?? ulid(),
      schemaVersion: auditEventSchemaVersion,
      organizationId: null,
      workspaceId: null,
      actorPrincipalId: authority.principalId,
      actorType: "human",
      authenticationRefType: "session",
      authenticationRefHash: context.authenticationRefHash,
      authorityType: "instance_administrator",
      authorityId: authority.authorityId,
      authorityVersion: authority.authorityVersion,
      authorizationModelVersion,
      authorizationDecision: { action: event, instanceId, version },
      eventType: event,
      action: event,
      resourceType: "runtime_configuration",
      resourceId: null,
      outcome: "succeeded",
      decisionReasonCode: "runtime_configuration.published",
      severity: "info",
      requestId: context.requestId ?? null,
      traceId: context.traceId ?? null,
      details: {
        instanceId,
        version,
        previousVersion: current?.version ?? 0,
        restoredFromVersion,
        reason,
      },
      occurredAt: now,
      recordedAt: now,
    });
    return {
      version,
      document,
      reason,
      publishedBy: authority.principalId,
      publishedAt: now.toISOString(),
      restoredFromVersion,
    };
  }
  return {
    recordResultDecision: async (decision) => {
      const [result] = await pool.execute<ResultSetHeader>(
        "INSERT INTO provider_result_policy_decision (id,workspace_id,provider_invocation_id,policy_version,source,origin,outcome,occurred_at) SELECT ?,i.workspace_id,i.id,?,?,?,?,? FROM provider_invocation i WHERE i.workspace_id=? AND i.id=?",
        [
          ulid(),
          decision.version,
          decision.source,
          decision.origin,
          decision.outcome,
          new Date(),
          decision.workspaceId,
          decision.invocationId,
        ],
      );
      if (result.affectedRows !== 1)
        throw new RuntimeConfigurationError(
          "runtime_configuration.unavailable",
          "Result invocation could not be verified for policy evidence.",
        );
    },
    overview: (authority) =>
      inTransaction(pool, async (connection) => {
        await trusted(connection, authority);
        const current = await readRuntimeConfiguration(connection, instanceId);
        const [workerRows] = await connection.execute<RowDataPacket[]>(
          "SELECT worker_id AS workerId, deployment, configuration_version AS configurationVersion, observed_at AS observedAt FROM runtime_configuration_worker_observation WHERE instance_id = ? AND observed_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY) ORDER BY observed_at DESC LIMIT 100",
          [instanceId],
        );
        const [services] = await connection.execute<RowDataPacket[]>(
          "SELECT p.workspace_id AS workspaceId, p.provider_endpoint_id AS providerEndpointId, p.display_name AS name, w.name AS workspaceName FROM provider_setting p JOIN workspace w ON w.id = p.workspace_id ORDER BY w.name, p.display_name LIMIT 1001",
        );
        return {
          current,
          workers: workerRows.map((row) => ({
            workerId: String(row.workerId),
            deployment: (typeof row.deployment === "string"
              ? JSON.parse(row.deployment)
              : row.deployment) as RuntimeConfigurationWorker["deployment"],
            configurationVersion:
              row.configurationVersion === null
                ? null
                : Number(row.configurationVersion),
            observedAt: (row.observedAt as Date).toISOString(),
          })),
          services: services.slice(0, 1000).map((row) => ({
            workspaceId: String(row.workspaceId),
            providerEndpointId: String(row.providerEndpointId),
            name: String(row.name),
            workspaceName: String(row.workspaceName),
          })),
          servicesTruncated: services.length > 1000,
        };
      }),
    observeWorker: async (worker) => {
      await pool.execute(
        "INSERT INTO runtime_configuration_worker_observation (instance_id, worker_id, deployment, configuration_version, observed_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE deployment=VALUES(deployment), configuration_version=VALUES(configuration_version), observed_at=VALUES(observed_at)",
        [
          instanceId,
          worker.workerId,
          JSON.stringify(worker.deployment),
          worker.configurationVersion,
          new Date(worker.observedAt),
        ],
      );
    },
    readEffective: () =>
      createRuntimeConfigurationReader(() =>
        inTransaction(pool, (connection) =>
          readRuntimeConfiguration(connection, instanceId),
        ),
      ).read(),
    read: () =>
      inTransaction(pool, (connection) =>
        readRuntimeConfiguration(connection, instanceId),
      ),
    history: (authority) =>
      inTransaction(pool, async (connection) => {
        await trusted(connection, authority);
        const [rows] = await connection.execute<RevisionRow[]>(
          `SELECT ${columns} FROM instance_runtime_configuration_revision WHERE instance_id = ? ORDER BY version DESC LIMIT 101`,
          [instanceId],
        );
        return {
          items: rows.slice(0, 100).map(revision),
          truncated: rows.length > 100,
        };
      }),
    publish: (authority, input, context) =>
      inTransaction(pool, (connection) =>
        publish(connection, authority, input, context),
      ),
    restore: (authority, input, context) =>
      inTransaction(pool, (connection) =>
        publish(connection, authority, input, context),
      ),
  };
}
