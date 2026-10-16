import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly publishAttempts: number;
  /**
   * Kept undecoded so a malformed payload can quarantine only its own event
   * instead of failing the entire claimed batch.
   */
  readonly payload: unknown;
}

export interface OutboxRelayStore {
  claimBatch(options: {
    readonly batchSize: number;
    readonly leaseTokenHash: string;
    readonly leaseUntil: Date;
  }): Promise<readonly ClaimedOutboxEvent[]>;
  markPublished(options: {
    readonly eventId: string;
    readonly leaseTokenHash: string;
    readonly publishedAt: Date;
  }): Promise<boolean>;
  markQuarantined(options: {
    readonly eventId: string;
    readonly leaseTokenHash: string;
    readonly errorCode: string;
    readonly quarantinedAt: Date;
  }): Promise<boolean>;
  markSuperseded(options: {
    readonly eventId: string;
    readonly leaseTokenHash: string;
    readonly errorCode: string;
    readonly supersededAt: Date;
  }): Promise<boolean>;
  releaseForRetry(options: {
    readonly eventId: string;
    readonly leaseTokenHash: string;
    readonly availableAt: Date;
  }): Promise<boolean>;
}

interface OutboxRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly publishAttempts: number;
  readonly payload: unknown;
}

export function createOutboxRelayStore(pool: Pool): OutboxRelayStore {
  return Object.freeze<OutboxRelayStore>({
    async claimBatch(options) {
      if (
        !Number.isSafeInteger(options.batchSize) ||
        options.batchSize < 1 ||
        options.batchSize > 100
      ) {
        throw new Error("Outbox relay batch size must be between 1 and 100.");
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query<OutboxRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             message_type AS messageType,
             schema_version AS schemaVersion,
             aggregate_type AS aggregateType,
             aggregate_id AS aggregateId,
             aggregate_version AS aggregateVersion,
             publish_attempts AS publishAttempts,
             payload
           FROM outbox_event
           WHERE (
               status = 'pending'
               AND available_at <= UTC_TIMESTAMP(3)
             )
             OR (
               status = 'leased'
               AND lease_expires_at < UTC_TIMESTAMP(3)
             )
           ORDER BY available_at, id
           LIMIT ?
           FOR UPDATE SKIP LOCKED`,
          [options.batchSize],
        );
        for (const row of rows) {
          await connection.execute<ResultSetHeader>(
            `UPDATE outbox_event
             SET status = 'leased',
                 lease_token_hash = ?,
                 lease_expires_at = ?,
                 publish_attempts = publish_attempts + 1
             WHERE id = ?`,
            [options.leaseTokenHash, options.leaseUntil, row.id],
          );
        }
        await connection.commit();
        return rows.map((row) =>
          Object.freeze({
            id: row.id,
            workspaceId: row.workspaceId,
            messageType: row.messageType,
            schemaVersion: row.schemaVersion,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            aggregateVersion: row.aggregateVersion,
            publishAttempts: row.publishAttempts + 1,
            payload: row.payload,
          }),
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async markPublished(options) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE outbox_event
         SET status = 'published',
             published_at = ?,
             lease_token_hash = NULL,
             lease_expires_at = NULL
         WHERE id = ?
           AND status = 'leased'
           AND lease_token_hash = ?`,
        [options.publishedAt, options.eventId, options.leaseTokenHash],
      );
      return result.affectedRows === 1;
    },
    async markQuarantined(options) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE outbox_event
         SET status = 'quarantined',
             last_error_code = ?,
             quarantined_at = ?,
             lease_token_hash = NULL,
             lease_expires_at = NULL
         WHERE id = ?
           AND status = 'leased'
           AND lease_token_hash = ?`,
        [
          options.errorCode,
          options.quarantinedAt,
          options.eventId,
          options.leaseTokenHash,
        ],
      );
      return result.affectedRows === 1;
    },
    async markSuperseded(options) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE outbox_event
         SET status = 'superseded',
             last_error_code = ?,
             superseded_at = ?,
             lease_token_hash = NULL,
             lease_expires_at = NULL
         WHERE id = ?
           AND status = 'leased'
           AND lease_token_hash = ?`,
        [
          options.errorCode,
          options.supersededAt,
          options.eventId,
          options.leaseTokenHash,
        ],
      );
      return result.affectedRows === 1;
    },
    async releaseForRetry(options) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE outbox_event
         SET status = 'pending',
             available_at = ?,
             lease_token_hash = NULL,
             lease_expires_at = NULL
         WHERE id = ?
           AND status = 'leased'
           AND lease_token_hash = ?`,
        [options.availableAt, options.eventId, options.leaseTokenHash],
      );
      return result.affectedRows === 1;
    },
  });
}
