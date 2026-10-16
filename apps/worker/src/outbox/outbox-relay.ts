import { randomBytes } from "node:crypto";

import { RuntimeFenceRejectedError } from "@kanvas/application";
import type {
  ClaimedOutboxEvent,
  OutboxRelayStore,
} from "@kanvas/database/runtime";
import type { JobsOptions } from "bullmq";
import type { Logger } from "pino";

import type { QueueExecutionTarget } from "../queue/inbox-delivery.js";

export const WORKFLOW_WAKEUP_JOB = "workflow-wakeup";
export const ATTEMPT_DISPATCH_JOB = "attempt-dispatch";
export const PROVIDER_ATTEMPT_DISPATCH_JOB = "provider-attempt-dispatch";
export const WORKFLOW_CANCELLATION_JOB = "workflow-cancellation";
export const CONTENT_EVENT_JOB = "content-event";

export interface OutboxQueue {
  add(
    name: string,
    data: Readonly<Record<string, unknown>>,
    options: JobsOptions,
  ): Promise<unknown>;
}

export interface OutboxRelayQueues {
  readonly orchestration: OutboxQueue;
  readonly execution: OutboxQueue;
  readonly providerExecution: OutboxQueue;
}

export interface OutboxRelayOptions {
  readonly store: OutboxRelayStore;
  readonly queues: OutboxRelayQueues;
  readonly logger: Logger;
  readonly assertRelayAllowed: (
    expectedGeneration: number,
    messageType: string,
  ) => Promise<void>;
  readonly now?: () => Date;
  readonly pollIntervalMs?: number;
  readonly batchSize?: number;
  readonly contentEventAttempts?: number;
  readonly contentEventBackoffMs?: number;
}

interface OutboxRoute {
  readonly queue: keyof OutboxRelayQueues;
  readonly jobName: string;
}

const SUPPORTED_OUTBOX_SCHEMA_VERSION = 1;
const STALE_EXECUTION_GENERATION_CODE = "outbox.stale_execution_generation";

const permanentErrorCodes = {
  invalidEnvelope: "outbox.invalid_envelope",
  invalidExpectedGeneration: "outbox.invalid_expected_generation",
  invalidExecutionTarget: "outbox.invalid_execution_target",
  invalidPayload: "outbox.invalid_payload",
  mismatchedAggregate: "outbox.mismatched_aggregate",
  unsupportedMessageType: "outbox.unsupported_message_type",
  unsupportedSchemaVersion: "outbox.unsupported_schema_version",
} as const;

type PermanentErrorCode =
  (typeof permanentErrorCodes)[keyof typeof permanentErrorCodes];

class PermanentOutboxEventError extends Error {
  public readonly code: PermanentErrorCode;

  public constructor(code: PermanentErrorCode, message: string) {
    super(message);
    this.name = "PermanentOutboxEventError";
    this.code = code;
  }
}

function decodePayload(value: unknown): Readonly<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidPayload,
      "Outbox payload is not valid JSON.",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidPayload,
      "Outbox payload must be a JSON object.",
    );
  }
  return payload as Readonly<Record<string, unknown>>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertBaseEnvelope(event: ClaimedOutboxEvent): void {
  if (
    !isNonEmptyString(event.id) ||
    !isNonEmptyString(event.workspaceId) ||
    !isNonEmptyString(event.messageType) ||
    !isNonEmptyString(event.aggregateType) ||
    !isNonEmptyString(event.aggregateId) ||
    !Number.isSafeInteger(event.aggregateVersion) ||
    event.aggregateVersion < 1
  ) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidEnvelope,
      "Outbox event has an invalid trusted envelope.",
    );
  }
}

function assertPayloadIdentity(
  payload: Readonly<Record<string, unknown>>,
  key: "attemptId" | "capabilityRunId" | "workflowRunId",
  aggregateId: string,
): void {
  if (payload[key] !== aggregateId) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.mismatchedAggregate,
      "Outbox payload identity does not match its trusted aggregate.",
    );
  }
}

function assertContextIds(
  payload: Readonly<Record<string, unknown>>,
  keys: readonly ("capabilityRunId" | "nodeRunId" | "workflowRunId")[],
): void {
  if (keys.some((key) => !isNonEmptyString(payload[key]))) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidPayload,
      "Outbox payload has invalid execution context identifiers.",
    );
  }
}

function requireQueueExecutionTarget(
  payload: Readonly<Record<string, unknown>>,
): QueueExecutionTarget {
  const executionTarget = payload.executionTarget;
  if (executionTarget === undefined) {
    return "worker";
  }
  if (executionTarget !== "worker" && executionTarget !== "provider") {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidExecutionTarget,
      "Attempt dispatch has no queue-executable target.",
    );
  }
  return executionTarget;
}

function routeEvent(
  event: ClaimedOutboxEvent,
  payload: Readonly<Record<string, unknown>>,
): {
  readonly routes: readonly OutboxRoute[];
  readonly executionTarget?: QueueExecutionTarget;
} {
  if (event.messageType === "workflow.cancel.requested") {
    if (event.aggregateType !== "workflow_run") {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.mismatchedAggregate,
        "Workflow cancellation must target a workflow_run aggregate.",
      );
    }
    return {
      routes: [
        {
          queue: "orchestration",
          jobName: WORKFLOW_WAKEUP_JOB,
        },
        {
          queue: "execution",
          jobName: WORKFLOW_CANCELLATION_JOB,
        },
      ],
    };
  }
  if (
    event.messageType === "workflow.wakeup.requested" ||
    event.messageType === "capability.run.completed" ||
    event.messageType === "capability.run.failed" ||
    event.messageType === "capability.run.cancelled" ||
    event.messageType === "approval.decision.recorded"
  ) {
    let expectedAggregateType = "capability_run";
    if (event.messageType === "workflow.wakeup.requested") {
      expectedAggregateType =
        payload.deadlineScheduleId === undefined
          ? "workflow_run"
          : "workflow_deadline_schedule";
    } else if (event.messageType === "approval.decision.recorded") {
      expectedAggregateType = "workflow_approval_request";
    }
    if (
      event.aggregateType !== expectedAggregateType ||
      (event.messageType === "workflow.wakeup.requested" &&
        event.aggregateType === "workflow_deadline_schedule" &&
        payload.deadlineScheduleId !== event.aggregateId)
    ) {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.mismatchedAggregate,
        "Outbox message type does not match its aggregate type.",
      );
    }
    const directCapabilityTerminal =
      event.messageType.startsWith("capability.run.") &&
      (payload.invocationKind === "user" ||
        payload.invocationKind === "agent" ||
        payload.invocationKind === "canvas");
    return {
      routes: directCapabilityTerminal
        ? []
        : [
            {
              queue: "orchestration",
              jobName: WORKFLOW_WAKEUP_JOB,
            },
          ],
    };
  }
  if (event.messageType === "attempt.dispatch.requested") {
    if (event.aggregateType !== "capability_attempt") {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.mismatchedAggregate,
        "Attempt dispatch must target a capability_attempt aggregate.",
      );
    }
    const executionTarget = requireQueueExecutionTarget(payload);
    return {
      executionTarget,
      routes: [
        executionTarget === "provider"
          ? {
              queue: "providerExecution",
              jobName: PROVIDER_ATTEMPT_DISPATCH_JOB,
            }
          : {
              queue: "execution",
              jobName: ATTEMPT_DISPATCH_JOB,
            },
      ],
    };
  }
  if (
    event.messageType === "artifact.user_imported" ||
    event.messageType === "artifact.canvas_exported"
  ) {
    if (event.aggregateType !== "artifact") {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.mismatchedAggregate,
        "Artifact content events must target an artifact aggregate.",
      );
    }
    return {
      routes: [
        {
          queue: "orchestration",
          jobName: CONTENT_EVENT_JOB,
        },
      ],
    };
  }
  throw new PermanentOutboxEventError(
    permanentErrorCodes.unsupportedMessageType,
    "Outbox message type has no queue route.",
  );
}

function prepareEvent(event: ClaimedOutboxEvent): {
  readonly expectedGeneration: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly routes: readonly OutboxRoute[];
  readonly requiresRuntimeFence: boolean;
} {
  assertBaseEnvelope(event);
  if (event.schemaVersion !== SUPPORTED_OUTBOX_SCHEMA_VERSION) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.unsupportedSchemaVersion,
      "Outbox event schema version is not supported.",
    );
  }

  const payload = decodePayload(event.payload);
  const routed = routeEvent(event, payload);
  const expectedGeneration = payload.expectedGeneration;
  if (
    !Number.isSafeInteger(expectedGeneration) ||
    (expectedGeneration as number) < 1
  ) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.invalidExpectedGeneration,
      "Outbox event payload has no valid expectedGeneration.",
    );
  }

  if (event.messageType === "workflow.cancel.requested") {
    assertPayloadIdentity(payload, "workflowRunId", event.aggregateId);
  } else if (event.messageType === "workflow.wakeup.requested") {
    if (event.aggregateType === "workflow_run") {
      assertPayloadIdentity(payload, "workflowRunId", event.aggregateId);
    } else {
      assertContextIds(payload, ["workflowRunId"]);
    }
  } else if (event.messageType === "attempt.dispatch.requested") {
    assertPayloadIdentity(payload, "attemptId", event.aggregateId);
    assertContextIds(payload, ["capabilityRunId"]);
    const workflowContext =
      isNonEmptyString(payload.workflowRunId) &&
      isNonEmptyString(payload.nodeRunId) &&
      payload.invocationKind === undefined;
    const directContext =
      payload.workflowRunId === undefined &&
      payload.nodeRunId === undefined &&
      (payload.invocationKind === "user" ||
        payload.invocationKind === "agent" ||
        payload.invocationKind === "canvas");
    if (!workflowContext && !directContext) {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.invalidPayload,
        "Attempt dispatch has an invalid Capability invocation context.",
      );
    }
  } else if (
    event.messageType === "capability.run.completed" ||
    event.messageType === "capability.run.failed" ||
    event.messageType === "capability.run.cancelled"
  ) {
    assertPayloadIdentity(payload, "capabilityRunId", event.aggregateId);
    const directTerminal =
      payload.workflowRunId === undefined &&
      payload.nodeRunId === undefined &&
      (payload.invocationKind === "user" ||
        payload.invocationKind === "agent" ||
        payload.invocationKind === "canvas");
    if (!directTerminal) {
      assertContextIds(payload, ["workflowRunId", "nodeRunId"]);
    }
  } else if (event.messageType === "approval.decision.recorded") {
    if (
      payload.approvalRequestId !== event.aggregateId ||
      !isNonEmptyString(payload.workflowRunId) ||
      !isNonEmptyString(payload.nodeRunId)
    ) {
      throw new PermanentOutboxEventError(
        permanentErrorCodes.mismatchedAggregate,
        "Approval decision identity does not match its trusted aggregate.",
      );
    }
  } else if (
    payload.artifactId !== event.aggregateId ||
    !isNonEmptyString(payload.storedObjectId) ||
    !isNonEmptyString(payload.uploadSessionId)
  ) {
    throw new PermanentOutboxEventError(
      permanentErrorCodes.mismatchedAggregate,
      "Artifact import identity does not match its trusted aggregate.",
    );
  }

  return {
    expectedGeneration: expectedGeneration as number,
    payload:
      routed.executionTarget === undefined
        ? payload
        : Object.freeze({
            ...payload,
            executionTarget: routed.executionTarget,
          }),
    routes: routed.routes,
    requiresRuntimeFence:
      event.messageType !== "artifact.user_imported" &&
      event.messageType !== "artifact.canvas_exported",
  };
}

export class OutboxRelay {
  readonly #store: OutboxRelayStore;
  readonly #queues: OutboxRelayQueues;
  readonly #logger: Logger;
  readonly #assertRelayAllowed: (
    expectedGeneration: number,
    messageType: string,
  ) => Promise<void>;
  readonly #now: () => Date;
  readonly #pollIntervalMs: number;
  readonly #batchSize: number;
  readonly #contentEventAttempts: number;
  readonly #contentEventBackoffMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> | undefined;
  #stopping = false;

  public constructor(options: OutboxRelayOptions) {
    this.#store = options.store;
    this.#queues = options.queues;
    this.#logger = options.logger;
    this.#assertRelayAllowed = options.assertRelayAllowed;
    this.#now = options.now ?? (() => new Date());
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#batchSize = options.batchSize ?? 20;
    this.#contentEventAttempts = options.contentEventAttempts ?? 1;
    this.#contentEventBackoffMs = options.contentEventBackoffMs ?? 5_000;
  }

  public start(): void {
    if (this.#running || this.#timer) {
      return;
    }
    this.#stopping = false;
    this.#schedule(0);
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#running;
  }

  public async runOnce(): Promise<number> {
    const leaseTokenHash = randomBytes(32).toString("hex");
    const now = this.#now();
    const leaseUntil = new Date(now.getTime() + 30_000);
    const events = await this.#store.claimBatch({
      batchSize: this.#batchSize,
      leaseTokenHash,
      leaseUntil,
    });

    for (const event of events) {
      try {
        const { expectedGeneration, payload, routes, requiresRuntimeFence } =
          prepareEvent(event);
        if (requiresRuntimeFence) {
          await this.#assertRelayAllowed(expectedGeneration, event.messageType);
        }
        for (const route of routes) {
          await this.#queues[route.queue].add(
            route.jobName,
            {
              ...payload,
              outboxEventId: event.id,
              workspaceId: event.workspaceId,
              messageType: event.messageType,
              schemaVersion: event.schemaVersion,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              aggregateVersion: event.aggregateVersion,
            },
            {
              jobId: event.id,
              attempts:
                route.jobName === CONTENT_EVENT_JOB
                  ? this.#contentEventAttempts
                  : 1,
              ...(route.jobName === CONTENT_EVENT_JOB &&
              this.#contentEventAttempts > 1
                ? {
                    backoff: {
                      type: "exponential" as const,
                      delay: this.#contentEventBackoffMs,
                    },
                  }
                : {}),
              removeOnComplete: {
                age: 24 * 60 * 60,
                count: 1000,
              },
              removeOnFail: {
                age: 7 * 24 * 60 * 60,
                count: 5000,
              },
            },
          );
        }
        const published = await this.#store.markPublished({
          eventId: event.id,
          leaseTokenHash,
          publishedAt: this.#now(),
        });
        if (!published) {
          this.#logger.warn(
            {
              outboxEventId: event.id,
            },
            "Outbox event was enqueued but its publish lease was lost.",
          );
        }
      } catch (error) {
        if (error instanceof PermanentOutboxEventError) {
          await this.#quarantine(event, leaseTokenHash, error);
        } else if (
          error instanceof RuntimeFenceRejectedError &&
          error.reasonCode === "stale_execution_generation"
        ) {
          await this.#supersede(event, leaseTokenHash);
        } else {
          await this.#releaseForRetry(event, leaseTokenHash, error);
        }
      }
    }

    return events.length;
  }

  async #supersede(
    event: ClaimedOutboxEvent,
    leaseTokenHash: string,
  ): Promise<void> {
    try {
      const superseded = await this.#store.markSuperseded({
        eventId: event.id,
        leaseTokenHash,
        errorCode: STALE_EXECUTION_GENERATION_CODE,
        supersededAt: this.#now(),
      });
      if (!superseded) {
        this.#logger.warn(
          {
            outboxEventId: event.id,
            errorCode: STALE_EXECUTION_GENERATION_CODE,
          },
          "Stale outbox event lost its supersede lease.",
        );
        return;
      }
      this.#logger.info(
        {
          outboxEventId: event.id,
          errorCode: STALE_EXECUTION_GENERATION_CODE,
        },
        "Stale-generation outbox event was superseded.",
      );
    } catch (supersedeError) {
      this.#logger.error(
        {
          outboxEventId: event.id,
          errorCode: STALE_EXECUTION_GENERATION_CODE,
          errorType:
            supersedeError instanceof Error ? supersedeError.name : "unknown",
        },
        "Outbox supersede persistence failed.",
      );
      await this.#releaseForRetry(event, leaseTokenHash, supersedeError);
    }
  }

  async #quarantine(
    event: ClaimedOutboxEvent,
    leaseTokenHash: string,
    error: PermanentOutboxEventError,
  ): Promise<void> {
    try {
      const quarantined = await this.#store.markQuarantined({
        eventId: event.id,
        leaseTokenHash,
        errorCode: error.code,
        quarantinedAt: this.#now(),
      });
      if (!quarantined) {
        this.#logger.warn(
          {
            outboxEventId: event.id,
            errorCode: error.code,
          },
          "Permanent outbox event lost its quarantine lease.",
        );
        return;
      }
      this.#logger.error(
        {
          outboxEventId: event.id,
          errorCode: error.code,
          errorType: error.name,
        },
        "Permanent outbox event was quarantined.",
      );
    } catch (quarantineError) {
      this.#logger.error(
        {
          outboxEventId: event.id,
          errorCode: error.code,
          errorType:
            quarantineError instanceof Error ? quarantineError.name : "unknown",
        },
        "Outbox quarantine persistence failed.",
      );
      await this.#releaseForRetry(event, leaseTokenHash, quarantineError);
    }
  }

  async #releaseForRetry(
    event: ClaimedOutboxEvent,
    leaseTokenHash: string,
    error: unknown,
  ): Promise<void> {
    const exponent = Math.min(Math.max(event.publishAttempts - 1, 0), 6);
    const retryDelayMs = Math.min(60_000, 1000 * 2 ** exponent);
    try {
      const released = await this.#store.releaseForRetry({
        eventId: event.id,
        leaseTokenHash,
        availableAt: new Date(this.#now().getTime() + retryDelayMs),
      });
      if (!released) {
        this.#logger.warn(
          {
            outboxEventId: event.id,
          },
          "Outbox publish failure lost its retry lease.",
        );
      }
    } catch (releaseError) {
      this.#logger.error(
        {
          outboxEventId: event.id,
          errorType:
            releaseError instanceof Error ? releaseError.name : "unknown",
        },
        "Outbox retry release failed.",
      );
    }
    this.#logger.error(
      {
        outboxEventId: event.id,
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "Outbox publish failed and was released for retry.",
    );
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.runOnce()
        .catch((error: unknown) => {
          this.#logger.error(
            {
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Outbox relay iteration failed.",
          );
        })
        .finally(() => {
          this.#running = undefined;
          if (!this.#stopping) {
            this.#schedule(this.#pollIntervalMs);
          }
        });
    }, delay);
  }
}
