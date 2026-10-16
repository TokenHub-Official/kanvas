import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export type QueueDeliveryFailureResolution =
  "quarantined" | "resolved" | "ignored";

export interface QueueDeliveryFailureRecord {
  readonly consumerName: string;
  readonly queueName: string;
  readonly jobId: string;
  readonly outboxEventId?: string;
  readonly errorCode: string;
  readonly occurrenceCount: number;
  readonly resolutionStatus: QueueDeliveryFailureResolution;
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
  readonly resolvedAt?: Date;
}
export interface RecordQueueDeliveryFailureOptions {
  readonly consumerName: string;
  readonly queueName: string;
  readonly jobId: string;
  readonly outboxEventId?: string;
  readonly errorCode: string;
  readonly observedAt: Date;
}

export interface ResolveQueueDeliveryFailureOptions {
  readonly consumerName: string;
  readonly queueName: string;
  readonly jobId: string;
  readonly resolution: "resolved" | "ignored";
  readonly resolvedAt: Date;
}

export interface QueueDeliveryFailureStore {
  recordQuarantined(
    options: RecordQueueDeliveryFailureOptions,
  ): Promise<QueueDeliveryFailureRecord>;
  setResolution(options: ResolveQueueDeliveryFailureOptions): Promise<boolean>;
}

export type QueueDeliveryFailureStoreErrorCode =
  | "queue_delivery_failure.invalid"
  | "queue_delivery_failure.identity_conflict"
  | "queue_delivery_failure.record_missing";

export class QueueDeliveryFailureStoreError extends Error {
  readonly code: QueueDeliveryFailureStoreErrorCode;

  constructor(code: QueueDeliveryFailureStoreErrorCode) {
    super(code);
    this.name = "QueueDeliveryFailureStoreError";
    this.code = code;
  }
}

interface QueueDeliveryFailureRow extends RowDataPacket {
  readonly consumerName: string;
  readonly queueName: string;
  readonly jobId: string;
  readonly outboxEventId: string | null;
  readonly errorCode: string;
  readonly occurrenceCount: number;
  readonly resolutionStatus: string;
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
  readonly resolvedAt: Date | null;
}

const boundedAsciiPattern = /^[\x21-\x7e]+$/u;
const errorCodePattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;

function isBoundedAscii(value: string, maximumLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    boundedAsciiPattern.test(value)
  );
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function assertRecordOptions(options: RecordQueueDeliveryFailureOptions): void {
  if (
    !isBoundedAscii(options.consumerName, 120) ||
    !isBoundedAscii(options.queueName, 120) ||
    !isBoundedAscii(options.jobId, 160) ||
    (options.outboxEventId !== undefined &&
      (!isBoundedAscii(options.outboxEventId, 26) ||
        options.outboxEventId.length !== 26)) ||
    !errorCodePattern.test(options.errorCode) ||
    !isValidDate(options.observedAt)
  ) {
    throw new QueueDeliveryFailureStoreError("queue_delivery_failure.invalid");
  }
}

function assertResolutionOptions(
  options: ResolveQueueDeliveryFailureOptions,
): void {
  if (
    !isBoundedAscii(options.consumerName, 120) ||
    !isBoundedAscii(options.queueName, 120) ||
    !isBoundedAscii(options.jobId, 160) ||
    (options.resolution !== "resolved" && options.resolution !== "ignored") ||
    !isValidDate(options.resolvedAt)
  ) {
    throw new QueueDeliveryFailureStoreError("queue_delivery_failure.invalid");
  }
}

function parseResolution(value: string): QueueDeliveryFailureResolution {
  if (value === "quarantined" || value === "resolved" || value === "ignored") {
    return value;
  }
  throw new QueueDeliveryFailureStoreError(
    "queue_delivery_failure.identity_conflict",
  );
}

function toRecord(row: QueueDeliveryFailureRow): QueueDeliveryFailureRecord {
  return Object.freeze({
    consumerName: row.consumerName,
    queueName: row.queueName,
    jobId: row.jobId,
    ...(row.outboxEventId ? { outboxEventId: row.outboxEventId } : {}),
    errorCode: row.errorCode,
    occurrenceCount: row.occurrenceCount,
    resolutionStatus: parseResolution(row.resolutionStatus),
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
  });
}

async function findFailure(
  connection: PoolConnection,
  options: {
    readonly consumerName: string;
    readonly queueName: string;
    readonly jobId: string;
  },
): Promise<QueueDeliveryFailureRow | undefined> {
  const [rows] = await connection.execute<QueueDeliveryFailureRow[]>(
    `SELECT
       consumer_name AS consumerName,
       queue_name AS queueName,
       job_id AS jobId,
       outbox_event_id AS outboxEventId,
       error_code AS errorCode,
       occurrence_count AS occurrenceCount,
       resolution_status AS resolutionStatus,
       first_observed_at AS firstObservedAt,
       last_observed_at AS lastObservedAt,
       resolved_at AS resolvedAt
     FROM queue_delivery_failure
     WHERE consumer_name = ?
       AND queue_name = ?
       AND job_id = ?
     LIMIT 1
     FOR UPDATE`,
    [options.consumerName, options.queueName, options.jobId],
  );
  return rows[0];
}

export function createQueueDeliveryFailureStore(
  pool: Pool,
): QueueDeliveryFailureStore {
  return Object.freeze<QueueDeliveryFailureStore>({
    async recordQuarantined(options) {
      assertRecordOptions(options);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute<ResultSetHeader>(
          `INSERT INTO queue_delivery_failure (
             consumer_name,
             queue_name,
             job_id,
             outbox_event_id,
             error_code,
             occurrence_count,
             resolution_status,
             first_observed_at,
             last_observed_at,
             resolved_at
           ) VALUES (?, ?, ?, ?, ?, 1, 'quarantined', ?, ?, NULL)
           ON DUPLICATE KEY UPDATE
             outbox_event_id = COALESCE(
               queue_delivery_failure.outbox_event_id,
               VALUES(outbox_event_id)
             ),
             error_code = VALUES(error_code),
             occurrence_count = occurrence_count + 1,
             resolution_status = 'quarantined',
             last_observed_at = GREATEST(
               last_observed_at,
               VALUES(last_observed_at)
             ),
             resolved_at = NULL`,
          [
            options.consumerName,
            options.queueName,
            options.jobId,
            options.outboxEventId ?? null,
            options.errorCode,
            options.observedAt,
            options.observedAt,
          ],
        );
        const row = await findFailure(connection, options);
        if (!row) {
          throw new QueueDeliveryFailureStoreError(
            "queue_delivery_failure.record_missing",
          );
        }
        if (
          options.outboxEventId !== undefined &&
          row.outboxEventId !== options.outboxEventId
        ) {
          throw new QueueDeliveryFailureStoreError(
            "queue_delivery_failure.identity_conflict",
          );
        }
        await connection.commit();
        return toRecord(row);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async setResolution(options) {
      assertResolutionOptions(options);
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE queue_delivery_failure
         SET resolution_status = ?,
             resolved_at = ?
         WHERE consumer_name = ?
           AND queue_name = ?
           AND job_id = ?
           AND resolution_status = 'quarantined'`,
        [
          options.resolution,
          options.resolvedAt,
          options.consumerName,
          options.queueName,
          options.jobId,
        ],
      );
      return result.affectedRows === 1;
    },
  });
}
