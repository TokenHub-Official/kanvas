import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export const inboxDeliveryErrorCodes = [
  "inbox.delivery.invalid",
  "inbox.event.not_found",
  "inbox.event.payload_invalid",
  "inbox.event.envelope_mismatch",
  "inbox.event.route_mismatch",
  "inbox.event.aggregate_mismatch",
  "inbox.event.future_version",
  "inbox.event.fact_mismatch",
  "inbox.receipt.conflict",
  "inbox.effect.invalid",
] as const;

export type InboxDeliveryErrorCode = (typeof inboxDeliveryErrorCodes)[number];

export class InboxDeliveryError extends Error {
  readonly code: InboxDeliveryErrorCode;

  constructor(code: InboxDeliveryErrorCode) {
    super(code);
    this.name = "InboxDeliveryError";
    this.code = code;
  }
}

export interface InboxDelivery {
  readonly consumerName: string;
  readonly eventId: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
  readonly receivedAt: Date;
}

export interface CanonicalInboxEvent {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type InboxEffectOutcome = "applied" | "noop";

export interface InboxEffectResult<TResult> {
  readonly outcome: InboxEffectOutcome;
  readonly resultCode: string;
  readonly value: TResult;
}

export type InboxConsumptionResult<TResult> =
  | {
      readonly deliveryStatus: "processed";
      readonly event: CanonicalInboxEvent;
      readonly outcome: InboxEffectOutcome;
      readonly resultCode: string;
      readonly value: TResult;
    }
  | {
      readonly deliveryStatus: "duplicate";
      readonly event: CanonicalInboxEvent;
      readonly outcome: InboxEffectOutcome;
      readonly resultCode: string;
    };

interface CanonicalOutboxRow extends RowDataPacket {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: unknown;
}

interface InboxReceiptRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
  readonly effectOutcome: string;
  readonly resultCode: string;
}

const inboxPendingResultCode = "inbox.received";
const resultCodePattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const boundedAsciiPattern = /^[\x21-\x7e]+$/u;

function isBoundedAscii(value: string, maximumLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    boundedAsciiPattern.test(value)
  );
}

function isSafeUnsignedInteger(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

function assertDelivery(delivery: InboxDelivery): void {
  if (
    !isBoundedAscii(delivery.consumerName, 120) ||
    !isBoundedAscii(delivery.eventId, 26) ||
    delivery.eventId.length !== 26 ||
    !isBoundedAscii(delivery.workspaceId, 26) ||
    delivery.workspaceId.length !== 26 ||
    !isBoundedAscii(delivery.messageType, 120) ||
    !isSafeUnsignedInteger(delivery.schemaVersion, 1) ||
    !isBoundedAscii(delivery.aggregateType, 80) ||
    !isBoundedAscii(delivery.aggregateId, 26) ||
    delivery.aggregateId.length !== 26 ||
    !isSafeUnsignedInteger(delivery.aggregateVersion, 1) ||
    !isSafeUnsignedInteger(delivery.expectedGeneration, 1) ||
    Number.isNaN(delivery.receivedAt.getTime())
  ) {
    throw new InboxDeliveryError("inbox.delivery.invalid");
  }
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    throw new InboxDeliveryError("inbox.event.payload_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InboxDeliveryError("inbox.event.payload_invalid");
  }
  return Object.freeze(parsed as Record<string, unknown>);
}

function canonicalEventFrom(row: CanonicalOutboxRow): CanonicalInboxEvent {
  const payload = parsePayload(row.payload);
  const expectedGeneration = payload.expectedGeneration;
  if (
    typeof expectedGeneration !== "number" ||
    !isSafeUnsignedInteger(expectedGeneration, 1)
  ) {
    throw new InboxDeliveryError("inbox.event.payload_invalid");
  }
  if (
    !isSafeUnsignedInteger(row.schemaVersion, 1) ||
    !isSafeUnsignedInteger(row.aggregateVersion, 1)
  ) {
    throw new InboxDeliveryError("inbox.event.payload_invalid");
  }
  return Object.freeze({
    eventId: row.eventId,
    workspaceId: row.workspaceId,
    messageType: row.messageType,
    schemaVersion: row.schemaVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    expectedGeneration,
    payload,
  });
}

function deliveryMatchesEvent(
  delivery: InboxDelivery,
  event: CanonicalInboxEvent,
): boolean {
  return (
    delivery.eventId === event.eventId &&
    delivery.workspaceId === event.workspaceId &&
    delivery.messageType === event.messageType &&
    delivery.schemaVersion === event.schemaVersion &&
    delivery.aggregateType === event.aggregateType &&
    delivery.aggregateId === event.aggregateId &&
    delivery.aggregateVersion === event.aggregateVersion &&
    delivery.expectedGeneration === event.expectedGeneration
  );
}

function receiptMatchesEvent(
  row: InboxReceiptRow,
  event: CanonicalInboxEvent,
): boolean {
  return (
    row.workspaceId === event.workspaceId &&
    row.messageType === event.messageType &&
    row.schemaVersion === event.schemaVersion &&
    row.aggregateType === event.aggregateType &&
    row.aggregateId === event.aggregateId &&
    row.aggregateVersion === event.aggregateVersion &&
    row.expectedGeneration === event.expectedGeneration
  );
}

function isDuplicateEntryError(
  error: unknown,
): error is { readonly code: "ER_DUP_ENTRY" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function parseStoredOutcome(value: string): InboxEffectOutcome {
  if (value === "applied" || value === "noop") {
    return value;
  }
  throw new InboxDeliveryError("inbox.receipt.conflict");
}

function assertEffectResult<TResult>(effect: InboxEffectResult<TResult>): void {
  if (
    !effect ||
    typeof effect !== "object" ||
    (effect.outcome !== "applied" && effect.outcome !== "noop") ||
    !resultCodePattern.test(effect.resultCode) ||
    effect.resultCode === inboxPendingResultCode
  ) {
    throw new InboxDeliveryError("inbox.effect.invalid");
  }
}

async function findCanonicalEvent(
  connection: PoolConnection,
  eventId: string,
): Promise<CanonicalInboxEvent> {
  const [rows] = await connection.execute<CanonicalOutboxRow[]>(
    `SELECT
       id AS eventId,
       workspace_id AS workspaceId,
       message_type AS messageType,
       schema_version AS schemaVersion,
       aggregate_type AS aggregateType,
       aggregate_id AS aggregateId,
       aggregate_version AS aggregateVersion,
       payload
     FROM outbox_event
     WHERE id = ?
     LIMIT 1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) {
    throw new InboxDeliveryError("inbox.event.not_found");
  }
  return canonicalEventFrom(row);
}

async function findExistingReceipt(
  connection: PoolConnection,
  delivery: InboxDelivery,
): Promise<InboxReceiptRow> {
  const [rows] = await connection.execute<InboxReceiptRow[]>(
    `SELECT
       workspace_id AS workspaceId,
       message_type AS messageType,
       schema_version AS schemaVersion,
       aggregate_type AS aggregateType,
       aggregate_id AS aggregateId,
       aggregate_version AS aggregateVersion,
       expected_generation AS expectedGeneration,
       effect_outcome AS effectOutcome,
       result_code AS resultCode
     FROM inbox_receipt
     WHERE consumer_name = ?
       AND event_id = ?
     LIMIT 1
     FOR UPDATE`,
    [delivery.consumerName, delivery.eventId],
  );
  const row = rows[0];
  if (!row) {
    throw new InboxDeliveryError("inbox.receipt.conflict");
  }
  return row;
}

/**
 * Runs one durable queue effect on a caller-owned MySQL transaction.
 *
 * The caller must let every thrown error escape its transaction callback so
 * the provisional receipt and the domain writes roll back together.
 */
export async function consumeInboxEvent<
  TEffect extends InboxEffectResult<unknown>,
>(
  connection: PoolConnection,
  delivery: InboxDelivery,
  effect: (event: CanonicalInboxEvent) => Promise<TEffect>,
): Promise<InboxConsumptionResult<TEffect["value"]>> {
  assertDelivery(delivery);
  const event = await findCanonicalEvent(connection, delivery.eventId);
  if (!deliveryMatchesEvent(delivery, event)) {
    throw new InboxDeliveryError("inbox.event.envelope_mismatch");
  }

  try {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO inbox_receipt (
         consumer_name,
         event_id,
         workspace_id,
         message_type,
         schema_version,
         aggregate_type,
         aggregate_id,
         aggregate_version,
         expected_generation,
         effect_outcome,
         result_code,
         received_at,
         processed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'noop', ?, ?, ?)`,
      [
        delivery.consumerName,
        event.eventId,
        event.workspaceId,
        event.messageType,
        event.schemaVersion,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion,
        event.expectedGeneration,
        inboxPendingResultCode,
        delivery.receivedAt,
        delivery.receivedAt,
      ],
    );
  } catch (error) {
    if (!isDuplicateEntryError(error)) {
      throw error;
    }
    const receipt = await findExistingReceipt(connection, delivery);
    if (
      !receiptMatchesEvent(receipt, event) ||
      receipt.resultCode === inboxPendingResultCode ||
      !resultCodePattern.test(receipt.resultCode)
    ) {
      throw new InboxDeliveryError("inbox.receipt.conflict");
    }
    return Object.freeze({
      deliveryStatus: "duplicate",
      event,
      outcome: parseStoredOutcome(receipt.effectOutcome),
      resultCode: receipt.resultCode,
    });
  }

  const effectResult = await effect(event);
  assertEffectResult(effectResult);
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE inbox_receipt
     SET effect_outcome = ?,
         result_code = ?,
         processed_at = ?
     WHERE consumer_name = ?
       AND event_id = ?
       AND result_code = ?`,
    [
      effectResult.outcome,
      effectResult.resultCode,
      delivery.receivedAt,
      delivery.consumerName,
      delivery.eventId,
      inboxPendingResultCode,
    ],
  );
  if (result.affectedRows !== 1) {
    throw new InboxDeliveryError("inbox.receipt.conflict");
  }
  return Object.freeze({
    deliveryStatus: "processed",
    event,
    outcome: effectResult.outcome,
    resultCode: effectResult.resultCode,
    value: effectResult.value,
  });
}
