import {
  assertLibraryId,
  DomainError,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

export async function retainLibraryConsumerAuthority(
  connection: PoolConnection,
  options: {
    readonly authority: TrustedWorkspaceScope;
    readonly consumerKind: "capability" | "workflow";
    readonly consumerId: string;
    readonly artifacts: ReadonlyMap<string, boolean>;
    readonly now: Date;
  },
): Promise<void> {
  for (const [artifactId, requiresAssetRead] of options.artifacts) {
    await connection.execute(
      `INSERT INTO resource_library_consumer_input
      (workspace_id, consumer_kind, consumer_id, artifact_id, authority_snapshot, authority_digest, requires_asset_read, created_at)
      VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
      [
        options.authority.workspaceId,
        options.consumerKind,
        options.consumerId,
        artifactId,
        JSON.stringify(options.authority),
        digestProviderValue(options.authority),
        requiresAssetRead,
        options.now,
      ],
    );
  }
}

export interface LibraryConsumerAccessStore {
  authorizeArtifact(options: {
    readonly workspaceId: string;
    readonly capabilityRunId: string;
    readonly artifactId: string;
    readonly now: Date;
  }): Promise<void>;
}

export function createLibraryConsumerAccessStore(
  pool: Pool,
): LibraryConsumerAccessStore {
  return {
    async authorizeArtifact(options) {
      [
        options.workspaceId,
        options.capabilityRunId,
        options.artifactId,
      ].forEach(assertLibraryId);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<
          (RowDataPacket & {
            authority: unknown;
            digest: string;
            requiresAssetRead: number;
            principalId: string;
            status: string;
            cancelledAt: Date | null;
            deadline: Date;
            workflowStatus: string | null;
            availability: string;
          })[]
        >(
          `SELECT input.authority_snapshot AS authority, input.authority_digest AS digest, input.requires_asset_read AS requiresAssetRead,
            consumer.created_by AS principalId, consumer.lifecycle_status AS status, consumer.cancel_requested_at AS cancelledAt, consumer.execution_deadline_at AS deadline,
            workflow.lifecycle_status AS workflowStatus, artifact.availability_status AS availability
           FROM capability_run AS consumer
           LEFT JOIN node_run AS node ON node.workspace_id = consumer.workspace_id AND node.id = consumer.node_run_id
           LEFT JOIN workflow_run AS workflow ON workflow.workspace_id = node.workspace_id AND workflow.id = node.workflow_run_id
           INNER JOIN resource_library_consumer_input AS input ON input.workspace_id = consumer.workspace_id AND
             ((input.consumer_kind = 'capability' AND input.consumer_id = consumer.id) OR (input.consumer_kind = 'workflow' AND input.consumer_id = workflow.id))
           INNER JOIN artifact ON artifact.workspace_id = input.workspace_id AND artifact.id = input.artifact_id
           WHERE consumer.workspace_id = ? AND consumer.id = ? AND input.artifact_id = ? FOR SHARE`,
          [options.workspaceId, options.capabilityRunId, options.artifactId],
        );
        if (!rows.length) {
          const [uploads] = await connection.execute<RowDataPacket[]>(
            "SELECT artifact_id FROM resource_library_upload WHERE workspace_id = ? AND artifact_id = ? LIMIT 1",
            [options.workspaceId, options.artifactId],
          );
          if (uploads.length)
            throw new DomainError(
              "resource_library.consumer_unauthorized",
              "The library input has no retained consumer authority.",
            );
        }
        for (const row of rows) {
          const authority = (
            typeof row.authority === "string"
              ? JSON.parse(row.authority)
              : row.authority
          ) as TrustedWorkspaceScope;
          if (
            !authority ||
            digestProviderValue(authority) !== row.digest ||
            authority.workspaceId !== options.workspaceId ||
            authority.principalId !== row.principalId ||
            !["queued", "running"].includes(row.status) ||
            row.cancelledAt ||
            row.deadline.getTime() <= options.now.getTime() ||
            (row.workflowStatus &&
              !["queued", "running", "waiting"].includes(row.workflowStatus)) ||
            row.availability !== "available"
          )
            throw new DomainError(
              "resource_library.consumer_unauthorized",
              "The library input consumer is no longer authorized.",
            );
          await revalidateTrustedWorkspaceScopeInTransaction(
            connection,
            authority,
            "library.read",
            options.now,
          );
          if (row.requiresAssetRead)
            await revalidateTrustedWorkspaceScopeInTransaction(
              connection,
              authority,
              "asset.read",
              options.now,
            );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
