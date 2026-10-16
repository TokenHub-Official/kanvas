export const INBOX_SCHEMA_VERSION = 1 as const;

export const INBOX_CONSUMER_NAMES = Object.freeze({
  workflowOrchestration: "workflow-orchestration.v1",
  attemptDispatch: "attempt-dispatch.v1",
  providerAttemptDispatch: "provider-attempt-dispatch.v1",
  workflowCancellation: "workflow-cancellation.v1",
  contentEvent: "content-event.v1",
} as const);

export const INBOX_JOB_NAMES = Object.freeze({
  workflowOrchestration: "workflow-wakeup",
  attemptDispatch: "attempt-dispatch",
  providerAttemptDispatch: "provider-attempt-dispatch",
  workflowCancellation: "workflow-cancellation",
  contentEvent: "content-event",
} as const);

export type InboxConsumerName =
  (typeof INBOX_CONSUMER_NAMES)[keyof typeof INBOX_CONSUMER_NAMES];

export type InboxJobName =
  (typeof INBOX_JOB_NAMES)[keyof typeof INBOX_JOB_NAMES];

export type InboxMessageType =
  | "workflow.wakeup.requested"
  | "workflow.cancel.requested"
  | "capability.run.completed"
  | "capability.run.failed"
  | "capability.run.cancelled"
  | "approval.decision.recorded"
  | "attempt.dispatch.requested"
  | "artifact.user_imported"
  | "artifact.canvas_exported";

export type InboxAggregateType =
  | "workflow_run"
  | "workflow_deadline_schedule"
  | "workflow_approval_request"
  | "capability_run"
  | "capability_attempt"
  | "artifact";

export type QueueExecutionTarget = "worker" | "provider";

export type PermanentInboxDeliveryErrorCode =
  | "delivery.job_unsupported"
  | "delivery.payload_not_object"
  | "delivery.schema_version_unsupported"
  | "delivery.event_id_invalid"
  | "delivery.workspace_id_invalid"
  | "delivery.message_type_invalid"
  | "delivery.message_job_mismatch"
  | "delivery.aggregate_type_invalid"
  | "delivery.message_aggregate_mismatch"
  | "delivery.aggregate_id_invalid"
  | "delivery.aggregate_version_invalid"
  | "delivery.expected_generation_invalid"
  | "delivery.execution_target_invalid"
  | "delivery.job_target_mismatch"
  | "delivery.claimed_execution_target_mismatch"
  | "delivery.workflow_protocol_mismatch"
  | "delivery.payload_identity_invalid"
  | "delivery.aggregate_identity_mismatch";

export class PermanentInboxDeliveryError extends Error {
  public readonly code: PermanentInboxDeliveryErrorCode;

  public constructor(code: PermanentInboxDeliveryErrorCode) {
    super(code);
    this.name = "PermanentInboxDeliveryError";
    this.code = code;
  }
}

export function isPermanentInboxDeliveryError(
  error: unknown,
): error is PermanentInboxDeliveryError {
  return error instanceof PermanentInboxDeliveryError;
}

export interface InboxDeliveryMetadata {
  readonly consumerName: InboxConsumerName;
  readonly eventId: string;
  readonly workspaceId: string;
  readonly schemaVersion: typeof INBOX_SCHEMA_VERSION;
  readonly messageType: InboxMessageType;
  readonly aggregateType: InboxAggregateType;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
}

export interface WorkflowRunWakeupRequestedPayload {
  readonly messageType: "workflow.wakeup.requested";
  readonly workflowRunId: string;
  readonly expectedGeneration: number;
}

export interface WorkflowDeadlineWakeupRequestedPayload {
  readonly messageType: "workflow.wakeup.requested";
  readonly workflowRunId: string;
  readonly deadlineScheduleId: string;
  readonly expectedGeneration: number;
}

export interface WorkflowCancellationRequestedPayload {
  readonly messageType: "workflow.cancel.requested";
  readonly workflowRunId: string;
  readonly expectedGeneration: number;
}

export interface CapabilityTerminalPayload {
  readonly messageType:
    | "capability.run.completed"
    | "capability.run.failed"
    | "capability.run.cancelled";
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly capabilityRunId: string;
  readonly expectedGeneration: number;
}

export interface ApprovalDecisionRecordedPayload {
  readonly messageType: "approval.decision.recorded";
  readonly workflowRunId: string;
  readonly nodeRunId: string;
  readonly approvalRequestId: string;
  readonly expectedGeneration: number;
}

export interface AttemptDispatchRequestedPayload {
  readonly messageType: "attempt.dispatch.requested";
  readonly invocationKind: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly executionTarget: QueueExecutionTarget;
  readonly expectedGeneration: number;
}

export type WorkflowOrchestrationPayload =
  | WorkflowRunWakeupRequestedPayload
  | WorkflowDeadlineWakeupRequestedPayload
  | WorkflowCancellationRequestedPayload
  | CapabilityTerminalPayload
  | ApprovalDecisionRecordedPayload;

export interface WorkflowOrchestrationDelivery {
  readonly jobName: typeof INBOX_JOB_NAMES.workflowOrchestration;
  readonly delivery: InboxDeliveryMetadata;
  readonly payload: WorkflowOrchestrationPayload;
}

export interface AttemptDispatchDelivery {
  readonly jobName:
    | typeof INBOX_JOB_NAMES.attemptDispatch
    | typeof INBOX_JOB_NAMES.providerAttemptDispatch;
  readonly delivery: InboxDeliveryMetadata;
  readonly payload: AttemptDispatchRequestedPayload;
}

export interface WorkflowCancellationDelivery {
  readonly jobName: typeof INBOX_JOB_NAMES.workflowCancellation;
  readonly delivery: InboxDeliveryMetadata;
  readonly payload: WorkflowCancellationRequestedPayload;
}

export interface ArtifactContentPayload {
  readonly messageType: "artifact.user_imported" | "artifact.canvas_exported";
  readonly artifactId: string;
  readonly storedObjectId: string;
  readonly uploadSessionId: string;
  readonly expectedGeneration: number;
}

export interface ContentEventDelivery {
  readonly jobName: typeof INBOX_JOB_NAMES.contentEvent;
  readonly delivery: InboxDeliveryMetadata;
  readonly payload: ArtifactContentPayload;
}

export type ParsedInboxDelivery =
  | WorkflowOrchestrationDelivery
  | AttemptDispatchDelivery
  | WorkflowCancellationDelivery
  | ContentEventDelivery;

interface ParsedEnvelope {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly schemaVersion: typeof INBOX_SCHEMA_VERSION;
  readonly messageType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly expectedGeneration: number;
}

const KANVAS_ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function reject(code: PermanentInboxDeliveryErrorCode): never {
  throw new PermanentInboxDeliveryError(code);
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("delivery.payload_not_object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireUlid(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code:
    | "delivery.event_id_invalid"
    | "delivery.workspace_id_invalid"
    | "delivery.aggregate_id_invalid"
    | "delivery.payload_identity_invalid",
): string {
  const candidate = record[key];
  if (typeof candidate !== "string" || !KANVAS_ULID_PATTERN.test(candidate)) {
    return reject(code);
  }
  return candidate;
}

function optionalUlid(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return record[key] === undefined
    ? undefined
    : requireUlid(record, key, "delivery.payload_identity_invalid");
}

function requirePositiveInteger(
  candidate: unknown,
  code:
    | "delivery.aggregate_version_invalid"
    | "delivery.expected_generation_invalid",
): number {
  if (!Number.isSafeInteger(candidate) || (candidate as number) < 1) {
    return reject(code);
  }
  return candidate as number;
}

function parseEnvelope(value: unknown): {
  readonly record: Readonly<Record<string, unknown>>;
  readonly envelope: ParsedEnvelope;
} {
  const record = requireRecord(value);
  if (record.schemaVersion !== INBOX_SCHEMA_VERSION) {
    return reject("delivery.schema_version_unsupported");
  }
  const messageType = record.messageType;
  if (typeof messageType !== "string" || messageType.length === 0) {
    return reject("delivery.message_type_invalid");
  }
  const aggregateType = record.aggregateType;
  if (typeof aggregateType !== "string" || aggregateType.length === 0) {
    return reject("delivery.aggregate_type_invalid");
  }
  return {
    record,
    envelope: {
      eventId: requireUlid(
        record,
        "outboxEventId",
        "delivery.event_id_invalid",
      ),
      workspaceId: requireUlid(
        record,
        "workspaceId",
        "delivery.workspace_id_invalid",
      ),
      schemaVersion: INBOX_SCHEMA_VERSION,
      messageType,
      aggregateType,
      aggregateId: requireUlid(
        record,
        "aggregateId",
        "delivery.aggregate_id_invalid",
      ),
      aggregateVersion: requirePositiveInteger(
        record.aggregateVersion,
        "delivery.aggregate_version_invalid",
      ),
      expectedGeneration: requirePositiveInteger(
        record.expectedGeneration,
        "delivery.expected_generation_invalid",
      ),
    },
  };
}

function createDeliveryMetadata(
  consumerName: InboxConsumerName,
  envelope: ParsedEnvelope,
  messageType: InboxMessageType,
  aggregateType: InboxAggregateType,
): InboxDeliveryMetadata {
  return Object.freeze({
    consumerName,
    eventId: envelope.eventId,
    workspaceId: envelope.workspaceId,
    schemaVersion: envelope.schemaVersion,
    messageType,
    aggregateType,
    aggregateId: envelope.aggregateId,
    aggregateVersion: envelope.aggregateVersion,
    expectedGeneration: envelope.expectedGeneration,
  });
}

function requireAggregate(
  envelope: ParsedEnvelope,
  aggregateType: InboxAggregateType,
  identity: string,
): void {
  if (envelope.aggregateType !== aggregateType) {
    return reject("delivery.message_aggregate_mismatch");
  }
  if (envelope.aggregateId !== identity) {
    return reject("delivery.aggregate_identity_mismatch");
  }
}

function requireWorkflowIdentity(
  record: Readonly<Record<string, unknown>>,
): string {
  return requireUlid(
    record,
    "workflowRunId",
    "delivery.payload_identity_invalid",
  );
}

function requireQueueExecutionTarget(
  record: Readonly<Record<string, unknown>>,
): QueueExecutionTarget {
  const candidate = record.executionTarget;
  if (candidate !== "worker" && candidate !== "provider") {
    return reject("delivery.execution_target_invalid");
  }
  return candidate;
}

export function parseWorkflowOrchestrationDelivery(
  value: unknown,
): WorkflowOrchestrationDelivery {
  const { record, envelope } = parseEnvelope(value);

  if (envelope.messageType === "workflow.wakeup.requested") {
    const workflowRunId = requireWorkflowIdentity(record);
    if (envelope.aggregateType === "workflow_run") {
      requireAggregate(envelope, "workflow_run", workflowRunId);
      return Object.freeze({
        jobName: INBOX_JOB_NAMES.workflowOrchestration,
        delivery: createDeliveryMetadata(
          INBOX_CONSUMER_NAMES.workflowOrchestration,
          envelope,
          "workflow.wakeup.requested",
          "workflow_run",
        ),
        payload: Object.freeze({
          messageType: "workflow.wakeup.requested",
          workflowRunId,
          expectedGeneration: envelope.expectedGeneration,
        }),
      });
    }
    if (envelope.aggregateType !== "workflow_deadline_schedule") {
      return reject("delivery.message_aggregate_mismatch");
    }
    const deadlineScheduleId = requireUlid(
      record,
      "deadlineScheduleId",
      "delivery.payload_identity_invalid",
    );
    requireAggregate(
      envelope,
      "workflow_deadline_schedule",
      deadlineScheduleId,
    );
    return Object.freeze({
      jobName: INBOX_JOB_NAMES.workflowOrchestration,
      delivery: createDeliveryMetadata(
        INBOX_CONSUMER_NAMES.workflowOrchestration,
        envelope,
        "workflow.wakeup.requested",
        "workflow_deadline_schedule",
      ),
      payload: Object.freeze({
        messageType: "workflow.wakeup.requested",
        workflowRunId,
        deadlineScheduleId,
        expectedGeneration: envelope.expectedGeneration,
      }),
    });
  }

  if (envelope.messageType === "workflow.cancel.requested") {
    const workflowRunId = requireWorkflowIdentity(record);
    requireAggregate(envelope, "workflow_run", workflowRunId);
    return Object.freeze({
      jobName: INBOX_JOB_NAMES.workflowOrchestration,
      delivery: createDeliveryMetadata(
        INBOX_CONSUMER_NAMES.workflowOrchestration,
        envelope,
        "workflow.cancel.requested",
        "workflow_run",
      ),
      payload: Object.freeze({
        messageType: "workflow.cancel.requested",
        workflowRunId,
        expectedGeneration: envelope.expectedGeneration,
      }),
    });
  }

  if (
    envelope.messageType === "capability.run.completed" ||
    envelope.messageType === "capability.run.failed" ||
    envelope.messageType === "capability.run.cancelled"
  ) {
    const workflowRunId = requireWorkflowIdentity(record);
    const nodeRunId = requireUlid(
      record,
      "nodeRunId",
      "delivery.payload_identity_invalid",
    );
    const capabilityRunId = requireUlid(
      record,
      "capabilityRunId",
      "delivery.payload_identity_invalid",
    );
    requireAggregate(envelope, "capability_run", capabilityRunId);
    const messageType = envelope.messageType;
    return Object.freeze({
      jobName: INBOX_JOB_NAMES.workflowOrchestration,
      delivery: createDeliveryMetadata(
        INBOX_CONSUMER_NAMES.workflowOrchestration,
        envelope,
        messageType,
        "capability_run",
      ),
      payload: Object.freeze({
        messageType,
        workflowRunId,
        nodeRunId,
        capabilityRunId,
        expectedGeneration: envelope.expectedGeneration,
      }),
    });
  }

  if (envelope.messageType === "approval.decision.recorded") {
    const workflowRunId = requireWorkflowIdentity(record);
    const nodeRunId = requireUlid(
      record,
      "nodeRunId",
      "delivery.payload_identity_invalid",
    );
    const approvalRequestId = requireUlid(
      record,
      "approvalRequestId",
      "delivery.payload_identity_invalid",
    );
    requireAggregate(envelope, "workflow_approval_request", approvalRequestId);
    return Object.freeze({
      jobName: INBOX_JOB_NAMES.workflowOrchestration,
      delivery: createDeliveryMetadata(
        INBOX_CONSUMER_NAMES.workflowOrchestration,
        envelope,
        "approval.decision.recorded",
        "workflow_approval_request",
      ),
      payload: Object.freeze({
        messageType: "approval.decision.recorded",
        workflowRunId,
        nodeRunId,
        approvalRequestId,
        expectedGeneration: envelope.expectedGeneration,
      }),
    });
  }

  return reject("delivery.message_job_mismatch");
}

export function parseAttemptDispatchDelivery(
  value: unknown,
  expectedExecutionTarget: QueueExecutionTarget = "worker",
): AttemptDispatchDelivery {
  const { record, envelope } = parseEnvelope(value);
  if (envelope.messageType !== "attempt.dispatch.requested") {
    return reject("delivery.message_job_mismatch");
  }
  const executionTarget = requireQueueExecutionTarget(record);
  if (executionTarget !== expectedExecutionTarget) {
    return reject("delivery.job_target_mismatch");
  }
  const workflowRunId = optionalUlid(record, "workflowRunId");
  const nodeRunId = optionalUlid(record, "nodeRunId");
  const invocationKind = record.invocationKind;
  const workflowInvocation =
    workflowRunId !== undefined && nodeRunId !== undefined;
  const directInvocation =
    workflowRunId === undefined &&
    nodeRunId === undefined &&
    (invocationKind === "user" ||
      invocationKind === "agent" ||
      invocationKind === "canvas");
  if (!workflowInvocation && !directInvocation) {
    return reject("delivery.payload_identity_invalid");
  }
  const capabilityRunId = requireUlid(
    record,
    "capabilityRunId",
    "delivery.payload_identity_invalid",
  );
  const attemptId = requireUlid(
    record,
    "attemptId",
    "delivery.payload_identity_invalid",
  );
  requireAggregate(envelope, "capability_attempt", attemptId);
  const isProvider = expectedExecutionTarget === "provider";
  return Object.freeze({
    jobName: isProvider
      ? INBOX_JOB_NAMES.providerAttemptDispatch
      : INBOX_JOB_NAMES.attemptDispatch,
    delivery: createDeliveryMetadata(
      isProvider
        ? INBOX_CONSUMER_NAMES.providerAttemptDispatch
        : INBOX_CONSUMER_NAMES.attemptDispatch,
      envelope,
      "attempt.dispatch.requested",
      "capability_attempt",
    ),
    payload: Object.freeze({
      messageType: "attempt.dispatch.requested" as const,
      invocationKind: workflowInvocation
        ? "workflow"
        : (invocationKind as "user" | "agent" | "canvas"),
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(nodeRunId ? { nodeRunId } : {}),
      capabilityRunId,
      attemptId,
      executionTarget,
      expectedGeneration: envelope.expectedGeneration,
    }),
  });
}

export function parseWorkflowCancellationDelivery(
  value: unknown,
): WorkflowCancellationDelivery {
  const { record, envelope } = parseEnvelope(value);
  if (envelope.messageType !== "workflow.cancel.requested") {
    return reject("delivery.message_job_mismatch");
  }
  const workflowRunId = requireWorkflowIdentity(record);
  requireAggregate(envelope, "workflow_run", workflowRunId);
  return Object.freeze({
    jobName: INBOX_JOB_NAMES.workflowCancellation,
    delivery: createDeliveryMetadata(
      INBOX_CONSUMER_NAMES.workflowCancellation,
      envelope,
      "workflow.cancel.requested",
      "workflow_run",
    ),
    payload: Object.freeze({
      messageType: "workflow.cancel.requested",
      workflowRunId,
      expectedGeneration: envelope.expectedGeneration,
    }),
  });
}

export function parseContentEventDelivery(
  value: unknown,
): ContentEventDelivery {
  const { record, envelope } = parseEnvelope(value);
  if (
    envelope.messageType !== "artifact.user_imported" &&
    envelope.messageType !== "artifact.canvas_exported"
  ) {
    return reject("delivery.message_job_mismatch");
  }
  const artifactId = requireUlid(
    record,
    "artifactId",
    "delivery.payload_identity_invalid",
  );
  const storedObjectId = requireUlid(
    record,
    "storedObjectId",
    "delivery.payload_identity_invalid",
  );
  const uploadSessionId = requireUlid(
    record,
    "uploadSessionId",
    "delivery.payload_identity_invalid",
  );
  requireAggregate(envelope, "artifact", artifactId);
  return Object.freeze({
    jobName: INBOX_JOB_NAMES.contentEvent,
    delivery: createDeliveryMetadata(
      INBOX_CONSUMER_NAMES.contentEvent,
      envelope,
      envelope.messageType,
      "artifact",
    ),
    payload: Object.freeze({
      messageType: envelope.messageType,
      artifactId,
      storedObjectId,
      uploadSessionId,
      expectedGeneration: envelope.expectedGeneration,
    }),
  });
}

export function parseInboxDelivery(
  jobName: unknown,
  value: unknown,
): ParsedInboxDelivery {
  if (jobName === INBOX_JOB_NAMES.workflowOrchestration) {
    return parseWorkflowOrchestrationDelivery(value);
  }
  if (jobName === INBOX_JOB_NAMES.attemptDispatch) {
    return parseAttemptDispatchDelivery(value, "worker");
  }
  if (jobName === INBOX_JOB_NAMES.providerAttemptDispatch) {
    return parseAttemptDispatchDelivery(value, "provider");
  }
  if (jobName === INBOX_JOB_NAMES.workflowCancellation) {
    return parseWorkflowCancellationDelivery(value);
  }
  if (jobName === INBOX_JOB_NAMES.contentEvent) {
    return parseContentEventDelivery(value);
  }
  return reject("delivery.job_unsupported");
}
