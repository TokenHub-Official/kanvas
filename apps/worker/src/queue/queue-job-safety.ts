import { createHash, type Hash } from "node:crypto";

import { RuntimeFenceRejectedError } from "@kanvas/application";
import {
  InboxDeliveryError,
  type QueueDeliveryFailureStore,
} from "@kanvas/database/runtime";
import type { Logger } from "pino";

import {
  PermanentInboxDeliveryError,
  isPermanentInboxDeliveryError,
  type PermanentInboxDeliveryErrorCode,
} from "./inbox-delivery.js";

export const QUEUE_DELIVERY_QUARANTINED_RESULT =
  "queue.delivery.quarantined" as const;
export const QUEUE_DELIVERY_STALE_GENERATION_RESULT =
  "queue.delivery.stale_execution_generation" as const;

export interface QueueJobQuarantinedResult {
  readonly deliveryStatus: "quarantined";
  readonly resultCode: typeof QUEUE_DELIVERY_QUARANTINED_RESULT;
  readonly jobId: string;
  readonly errorCode:
    PermanentInboxDeliveryErrorCode | InboxDeliveryError["code"];
}

export interface QueueJobIgnoredResult {
  readonly deliveryStatus: "ignored";
  readonly resultCode: typeof QUEUE_DELIVERY_STALE_GENERATION_RESULT;
  readonly jobId: string;
  readonly reasonCode: "stale_execution_generation";
}

export type SafeQueueJobResult<TResult> =
  TResult | QueueJobQuarantinedResult | QueueJobIgnoredResult;

export interface RunQueueJobSafelyOptions<TResult> {
  readonly queueName: string;
  readonly consumerName: string;
  readonly jobId?: string;
  readonly data: unknown;
  readonly handler: () => Promise<TResult>;
  readonly failureStore: Pick<QueueDeliveryFailureStore, "recordQuarantined">;
  readonly logger: Pick<Logger, "warn">;
  readonly now: () => Date;
}

const KANVAS_ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const SAFE_JOB_ID_PATTERN = /^[\x21-\x7e]{1,160}$/u;

function updateLengthPrefixed(hash: Hash, prefix: string, value: string): void {
  hash.update(prefix);
  hash.update(String(Buffer.byteLength(value, "utf8")));
  hash.update(":");
  hash.update(value);
  hash.update(";");
}

function updateCanonicalHash(
  hash: Hash,
  value: unknown,
  state: {
    readonly seen: WeakMap<object, number>;
    nextReference: number;
  },
  depth: number,
): void {
  if (depth > 64) {
    hash.update("depth-limit;");
    return;
  }
  if (value === null) {
    hash.update("null;");
    return;
  }

  switch (typeof value) {
    case "string":
      updateLengthPrefixed(hash, "string:", value);
      return;
    case "boolean":
      hash.update(value ? "boolean:true;" : "boolean:false;");
      return;
    case "number":
      if (Number.isNaN(value)) {
        hash.update("number:nan;");
      } else if (value === Number.POSITIVE_INFINITY) {
        hash.update("number:positive-infinity;");
      } else if (value === Number.NEGATIVE_INFINITY) {
        hash.update("number:negative-infinity;");
      } else if (Object.is(value, -0)) {
        hash.update("number:negative-zero;");
      } else {
        hash.update(`number:${String(value)};`);
      }
      return;
    case "bigint":
      hash.update(`bigint:${String(value)};`);
      return;
    case "undefined":
      hash.update("undefined;");
      return;
    case "symbol":
      hash.update("symbol;");
      return;
    case "function":
      hash.update("function;");
      return;
    case "object":
      break;
  }

  const objectValue = value;
  const existingReference = state.seen.get(objectValue);
  if (existingReference !== undefined) {
    hash.update(`reference:${String(existingReference)};`);
    return;
  }
  const reference = state.nextReference;
  state.nextReference += 1;
  state.seen.set(objectValue, reference);

  if (objectValue instanceof Date) {
    const time = objectValue.getTime();
    hash.update(
      Number.isNaN(time)
        ? "date:invalid;"
        : `date:${objectValue.toISOString()};`,
    );
    return;
  }
  if (objectValue instanceof Uint8Array) {
    hash.update(`bytes:${String(objectValue.byteLength)}:`);
    hash.update(objectValue);
    hash.update(";");
    return;
  }
  if (Array.isArray(objectValue)) {
    hash.update(`array:${String(objectValue.length)}:[`);
    for (const entry of objectValue) {
      updateCanonicalHash(hash, entry, state, depth + 1);
    }
    hash.update("];");
    return;
  }

  let keys: string[];
  try {
    keys = Object.keys(objectValue).sort();
  } catch {
    hash.update("object:uninspectable;");
    return;
  }

  hash.update(`object:${String(keys.length)}:{`);
  for (const key of keys) {
    updateLengthPrefixed(hash, "key:", key);
    try {
      updateCanonicalHash(
        hash,
        Reflect.get(objectValue, key),
        state,
        depth + 1,
      );
    } catch {
      hash.update("property:unreadable;");
    }
  }
  hash.update("};");
}

function fingerprintJobData(data: unknown): string {
  const hash = createHash("sha256");
  updateCanonicalHash(
    hash,
    data,
    {
      seen: new WeakMap<object, number>(),
      nextReference: 1,
    },
    0,
  );
  return `payload-sha256:${hash.digest("hex")}`;
}

function resolveJobId(jobId: string | undefined, data: unknown): string {
  return jobId && SAFE_JOB_ID_PATTERN.test(jobId)
    ? jobId
    : fingerprintJobData([jobId ?? null, data]);
}

function trustedOutboxEventId(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = Reflect.get(data, "outboxEventId");
  } catch {
    return undefined;
  }
  return typeof candidate === "string" && KANVAS_ULID_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

function permanentErrorCode(
  error: unknown,
): PermanentInboxDeliveryErrorCode | InboxDeliveryError["code"] | undefined {
  if (isPermanentInboxDeliveryError(error)) {
    return error.code;
  }
  if (error instanceof InboxDeliveryError) {
    return error.code;
  }
  return undefined;
}

export function createUnsupportedQueueJobError(): PermanentInboxDeliveryError {
  return new PermanentInboxDeliveryError("delivery.job_unsupported");
}

/**
 * Applies queue delivery failure policy without persisting or logging the raw
 * job data or an exception message.
 *
 * Successful handlers remain transparent. Permanent delivery errors are ACKed
 * only after their durable quarantine fact commits.
 */
export async function runQueueJobSafely<TResult>(
  options: RunQueueJobSafelyOptions<TResult>,
): Promise<SafeQueueJobResult<TResult>> {
  try {
    return await options.handler();
  } catch (error) {
    const jobId = resolveJobId(options.jobId, options.data);

    if (
      error instanceof RuntimeFenceRejectedError &&
      error.reasonCode === "stale_execution_generation"
    ) {
      options.logger.warn(
        {
          queueName: options.queueName,
          consumerName: options.consumerName,
          jobId,
          reasonCode: error.reasonCode,
        },
        "Stale queue delivery was acknowledged without execution.",
      );
      return Object.freeze({
        deliveryStatus: "ignored",
        resultCode: QUEUE_DELIVERY_STALE_GENERATION_RESULT,
        jobId,
        reasonCode: error.reasonCode,
      });
    }

    const errorCode = permanentErrorCode(error);
    if (!errorCode) {
      throw error;
    }

    const outboxEventId = trustedOutboxEventId(options.data);
    await options.failureStore.recordQuarantined({
      consumerName: options.consumerName,
      queueName: options.queueName,
      jobId,
      ...(outboxEventId ? { outboxEventId } : {}),
      errorCode,
      observedAt: options.now(),
    });

    options.logger.warn(
      {
        queueName: options.queueName,
        consumerName: options.consumerName,
        jobId,
        ...(outboxEventId ? { outboxEventId } : {}),
        errorCode,
      },
      "Permanent queue delivery was quarantined.",
    );
    return Object.freeze({
      deliveryStatus: "quarantined",
      resultCode: QUEUE_DELIVERY_QUARANTINED_RESULT,
      jobId,
      errorCode,
    });
  }
}
